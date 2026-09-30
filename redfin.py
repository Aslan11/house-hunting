#!/usr/bin/env python3
"""
Pull live listings from Redfin and print them as JSON.

Redfin's /stingray/api/* endpoints are CloudFront-blocked when called directly, but the
responses are server-rendered into the search page HTML under
root.__reactServerState.InitialContext -> ReactServerAgent.cache.dataCache. This reads them
from there, then confirms each candidate against its own detail page.

    python3 redfin.py search                 # run the standard sweep, print candidates
    python3 redfin.py detail <redfin-url>    # full detail for one property

Two things this guards against, both of which have burned earlier runs:

  * Search payloads include nearby homes OUTSIDE the queried zip. Results are filtered on the
    `city` field, never on which zip page they came from.
  * Redfin's `has-pool` filter is loose. Pool status is only ever taken from the MLS
    POOL_PRIVATE_YN field on the detail page, never from marketing text.
"""

import json
import re
import sys
import time
import urllib.request

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

CITIES = {"Placerville", "Shingle Springs", "Rescue"}
ZIPS = ["95667", "95682", "95672"]

# Kept loose on purpose. Over-fetching then filtering locally is how we found out that
# Shingle Springs and Rescue have pool-and-acreage inventory but nothing at 5 bedrooms.
FILTERS = [
    "min-beds=5,min-baths=3,max-price=1.5M,min-lot-size=2.5-acre",
    "min-beds=5,max-price=1.5M,has-pool",
    "max-price=1.5M,min-lot-size=2.5-acre,has-pool",
]


class Throttled(Exception):
    """Redfin answered, but with nothing usable — almost always rate limiting."""


def get(url, tries=4):
    """Fetch a page, retrying on both transport errors and throttled empty bodies.

    Redfin throttles by returning a 200 with an empty or stub body rather than a 429. That
    must never be mistaken for 'no listings matched' — see the guard in sweep().
    """
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40) as r:
                html = r.read().decode("utf-8", "replace")
            if len(html) > 50000:
                return html
            last = Throttled(f"{url} returned {len(html)} bytes")
        except Exception as e:
            last = e
        if i < tries - 1:
            time.sleep(5 * (i + 1))
    raise last


def initial_context(html):
    """Extract the InitialContext JSON blob by brace-matching (it contains nested braces)."""
    marker = "reactServerState.InitialContext = "
    i = html.find(marker)
    if i < 0:
        return None
    j = i + len(marker)
    depth, k, instr, esc = 0, j, False, False
    while k < len(html):
        c = html[k]
        if instr:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                instr = False
        else:
            if c == '"':
                instr = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    break
        k += 1
    return json.loads(html[j:k + 1])


def v(x):
    return x.get("value") if isinstance(x, dict) else x


def search_homes(html):
    ctx = initial_context(html)
    if not ctx:
        return []
    cache = ctx["ReactServerAgent.cache"]["dataCache"]
    homes = []
    for key in (k for k in cache if k.startswith("/stingray/api/gis?")):
        txt = cache[key]["res"].get("text", "")
        if "{" not in txt:
            continue
        # Responses are prefixed with the anti-hijacking token `{}&&`.
        body = json.loads(txt[txt.index("{", txt.index("&&")) if "&&" in txt else txt.index("{"):])
        payload = body.get("payload", {})
        for bucket in ("homes", "originalHomes", "nearbyHomes"):
            b = payload.get(bucket)
            if isinstance(b, dict):
                b = b.get("homes", [])
            if isinstance(b, list):
                homes.extend(b)
    return homes


def normalize(h):
    lot = v(h.get("lotSize"))
    return {
        "address": v(h.get("streetLine")),
        "city": h.get("city"),
        "zip": h.get("zip"),
        "mls": v(h.get("mlsId")),
        "mlsStatus": h.get("mlsStatus"),
        "price": v(h.get("price")),
        "beds": h.get("beds"),
        "baths": h.get("baths"),
        "sqft": v(h.get("sqFt")),
        "acres": round(lot / 43560, 2) if lot else None,
        "yearBuilt": v(h.get("yearBuilt")),
        "url": "https://www.redfin.com" + h["url"] if h.get("url") else None,
    }


def detail(url):
    # Unescape the JSON that lives inside script string literals.
    u = get(url).replace('\\"', '"').replace("\\u002F", "/").replace("\\u0027", "'")

    def one(pat, cast=None):
        m = re.search(pat, u)
        if not m:
            return None
        return cast(m.group(1)) if cast else m.group(1)

    pool_feat = one(r'"Pool Features","referenceName":"POOL_FEATURES","accessLevel":\d+,'
                    r'"displayLevel":\d+,"amenityValues":\[([^\]]*)\]')
    mls = one(r'"mlsId":"(\d+)"')
    photos = [p for p in dict.fromkeys(
        re.findall(r"https://ssl\.cdn-redfin\.com/photo/\d+/bigphoto/\d+/[^\"\\ ]+?\.jpg", u))
        if mls and mls in p]

    return {
        "url": url,
        "mls": mls,
        "price": one(r'"priceInfo":\{"amount":(\d+)', int),
        "mlsStatus": one(r'"mlsStatus":"([^"]+)"'),
        "hasPrivatePool": one(r'"hasPrivatePool":(true|false)') == "true",
        "poolFeatures": [x.strip('"') for x in pool_feat.split(",")] if pool_feat else [],
        "daysOnMarket": one(r'"daysOnMarket":\{"value":(\d+)', int),
        "agent": one(r'"listingAgentName":"([^"]+)"'),
        "broker": one(r'"listingBrokerName":"([^"]+)"'),
        "lotAcres": one(r'"amenityName":"Lot Size Acres"[^\]]*"amenityValues":\["([^"]+)"'),
        "description": one(r'marketingRemark":"(.{100,3000}?)","'),
        "photos": photos[:4],
    }


def sweep():
    seen = {}
    failed = []
    for zipcode in ZIPS:
        for f in FILTERS:
            url = f"https://www.redfin.com/zipcode/{zipcode}/filter/{f}"
            try:
                html = get(url)
            except Exception as e:
                failed.append(f"{zipcode} [{f}]: {e}")
                continue
            homes = search_homes(html)
            if not homes:
                # A real zero is possible, but a page that rendered no GIS payload at all is
                # a fetch failure wearing a zero's clothes. Distinguish them.
                if "reactServerState.InitialContext" not in html:
                    failed.append(f"{zipcode} [{f}]: page carried no search payload")
            for h in homes:
                n = normalize(h)
                # Filter on city, NOT on which zip page produced the row.
                if n["city"] in CITIES and n["address"]:
                    seen.setdefault((n["address"], n["zip"]), n)
            time.sleep(4)

    if failed:
        # Loudly, and on stderr, because an under-reported sweep is the exact failure this
        # repo already got burned by. Never let it read as thin inventory.
        raise Throttled("incomplete sweep — DO NOT treat these results as complete:\n  "
                        + "\n  ".join(failed))
    return sorted(seen.values(), key=lambda r: (r["city"], r["address"]))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "search"
    if cmd == "detail":
        print(json.dumps(detail(sys.argv[2]), indent=1))
    else:
        rows = sweep()
        print(json.dumps(rows, indent=1))
        print(f"\n# {len(rows)} candidates in {', '.join(sorted(CITIES))}", file=sys.stderr)
        print("# Confirm pool + status per property with: python3 redfin.py detail <url>",
              file=sys.stderr)
