#!/usr/bin/env python3
"""Pull active listings for the three target cities from the Coldwell Banker IDX feed."""
import re, json, subprocess, sys, time

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

CITIES = [
    ("Shingle Springs", "https://www.coldwellbankerhomes.com/ca/shingle-springs/"),
    ("Rescue",          "https://www.coldwellbankerhomes.com/ca/rescue/"),
    ("Placerville",     "https://www.coldwellbankerhomes.com/ca/placerville/"),
]


def fetch(url):
    r = subprocess.run(["curl", "-sSL", "-m", "40", "-A", UA, url],
                       capture_output=True, text=True, errors="replace")
    return r.stdout


def parse(html):
    out = []
    for b in re.findall(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', html, re.S):
        try:
            d = json.loads(b)
        except Exception:
            continue
        if not isinstance(d, dict):
            continue
        for node in d.get("@graph", []):
            me = node.get("mainEntity") if isinstance(node, dict) else None
            if isinstance(me, dict) and me.get("@type") == "ItemList":
                out.extend(me.get("itemListElement", []))
    return out


def norm(it):
    m = it.get("mainEntity", {}) or {}
    a = m.get("address", {}) or {}
    fs = (m.get("floorSize") or {}).get("value")
    return {
        "pid": it.get("@id"),
        "address": a.get("streetAddress"),
        "city": a.get("addressLocality"),
        "zip": a.get("postalCode"),
        "price": (it.get("offers") or {}).get("price"),
        "beds": m.get("numberOfBedrooms"),
        "baths": m.get("numberOfBathroomsTotal"),
        "sqft": int(fs) if fs and str(fs).isdigit() else None,
        "photo": it.get("image"),
        "url": it.get("url"),
        "lat": (m.get("geo") or {}).get("latitude"),
        "lon": (m.get("geo") or {}).get("longitude"),
        "type": m.get("@type"),
    }


all_rows = {}
for city, base in CITIES:
    seen_pages = 0
    for page in range(1, 20):
        url = base if page == 1 else f"{base}p_{page}/"
        html = fetch(url)
        items = parse(html)
        if not items:
            break
        n = 0
        for it in items:
            r = norm(it)
            if r["pid"] and r["pid"] not in all_rows:
                all_rows[r["pid"]] = r
                n += 1
        seen_pages += 1
        sys.stderr.write(f"{city} page {page}: {len(items)} items, {n} new\n")
        if n == 0 or len(items) < 20:
            break
        time.sleep(1)

rows = list(all_rows.values())
json.dump(rows, open("raw_listings.json", "w"), indent=1)
print(f"TOTAL {len(rows)}")
for r in sorted(rows, key=lambda x: (x["city"] or "", -(x["price"] or 0))):
    print(f'{r["city"]:16} {str(r["beds"]):>3}bd {str(r["baths"]):>4}ba  ${r["price"]:>9,}  {r["address"]}')
