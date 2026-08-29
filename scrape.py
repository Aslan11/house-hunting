#!/usr/bin/env python3
"""
Refresh listings.json from the Coldwell Banker IDX mirror of MetroList.

    python3 scrape.py            # crawl, merge, and rewrite listings.json
    python3 scrape.py --dry-run  # crawl and print, touch nothing
    node build.js                # then rebuild index.html

Why this source: the portals (Zillow, Redfin, Realtor, Trulia, Homes, Movoto) all bot-block
this container regardless of the network policy. coldwellbankerhomes.com serves the same
MetroList inventory, embeds the full MLS amenity table as JSON-LD on every detail page, and
does not block. See README and NETWORK.md.

Only stdlib plus curl. No dependencies to install.
"""
import argparse, json, os, re, subprocess, sys, time
from datetime import date

BASE = "https://www.coldwellbankerhomes.com"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(HERE, "listings.json")
CACHE = os.path.join(HERE, ".cache")

CITIES = ["shingle-springs", "rescue", "placerville"]
# Second pass over the ZIPs. These pull in neighbouring towns too, so they act as a coverage
# check on the city pages rather than as a primary source.
ZIPS = ["95682", "95672", "95667"]
TARGET_CITIES = {"Shingle Springs", "Rescue", "Placerville"}

MIN_BEDS, MIN_BATHS, MAX_PRICE, MIN_ACRES = 4, 3, 1_500_000, 2.5
# Near-miss floor: a pool on a lot this size is close enough to be worth showing.
NEAR_ACRES = 1.5

CARD = re.compile(r'<div class="property-snapshot-psr-panel"')

# MLS amenity keys worth carrying onto the page, in no particular order.
KEEP = {"Year Built", "Square Feet", "Garage Spaces", "Property View", "Horse Property",
        "Other Structures", "Water", "Sewer", "Cooling Type", "Heating Type",
        "Utility Description", "Architectural Style", "Stories/Levels", "Lot Description",
        "Fencing (Description)", "School District", "Association Fee", "Assoc. Fees Include",
        "Total Bedrooms", "Total Bathrooms", "Zoning", "APN", "Cross Streets",
        "Horse Facility Desc.", "Pool Description", "Spa", "Spa Description", "Parking",
        "Foundation", "Roof", "County"}


def clean(s):
    s = (s or "").replace("\xa0", " ").replace("&nbsp;", " ").replace("&amp;", "&")
    s = re.sub(r'\s+', ' ', s).strip().strip(",").strip()
    # The IDX writes thousands separators as "5, 351". Undo that.
    return re.sub(r'(?<=\d), (?=\d{3}\b)', ',', s)


def fetch(url, name, tries=4):
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, name)
    if os.path.exists(p) and os.path.getsize(p) > 2000:
        return open(p, encoding="utf-8", errors="replace").read()
    code = "000"
    for attempt in range(tries):
        r = subprocess.run(["curl", "-sS", "--max-time", "60", "-A", UA,
                            "-o", p, "-w", "%{http_code}", url],
                           capture_output=True, text=True)
        code = r.stdout.strip()[-3:]
        if code == "200":
            time.sleep(1.0)
            return open(p, encoding="utf-8", errors="replace").read()
        time.sleep(2 ** attempt)
    print(f"  ! {code} {url}", file=sys.stderr)
    if os.path.exists(p):
        os.remove(p)
    return ""


# ------------------------------------------------------------------ crawling

def parse_cards(html):
    """One dict per result card on a search page."""
    out = []
    for chunk in CARD.split(html)[1:]:
        def grp(pat, cast=str):
            m = re.search(pat, chunk)
            if not m:
                return None
            v = m.group(1)
            return cast(v.replace(",", "")) if cast is float else v

        detail = grp(r'data-detailurl="([^"]+)"')
        street = grp(r'<span class="street-address">([^<]*)</span>') or ""
        unit = grp(r'<span class="unit-number">([^<]*)</span>') or ""
        out.append({
            "pid": grp(r'data-pid="(\d+)"'),
            "url": BASE + detail if detail else None,
            "street": clean(street + " " + unit),
            "cityzip": clean(grp(r'<span class="city-st-zip[^"]*">([^<]*)</span>') or ""),
            "price": grp(r'<div class="price-normal">\$([\d,]+)</div>', float),
            "mls": grp(r'MLS # ([\w-]+)'),
            "tags": [clean(s) for s in re.findall(r'<li>([^<]+)</li>', chunk)[:4]],
            "beds": grp(r'<li class="beds"><div class="val">([\d,.]+)</div>', float),
            "totalBaths": grp(r'<li class="total-baths"><div class="val">([\d,.]+)</div>', float),
            "sqft": grp(r'<li class="sq\.-ft\."><div class="val">([\d,.]+)</div>', float),
            "updated": clean(grp(r'class="updated-info">([^<]+)</li>') or "") or None,
        })
    return out


def crawl(slug, max_pages=30):
    cards, seen, total, page = [], set(), 0, 1
    while page <= max_pages:
        url = f"{BASE}/ca/{slug}/" if page == 1 else f"{BASE}/ca/{slug}/p_{page}/"
        html = fetch(url, f"{slug}_p{page}.html")
        if not html:
            break
        if page == 1:
            m = re.search(r'([\d,]+) Results', html)
            total = int(m.group(1).replace(",", "")) if m else 0
        fresh = [c for c in parse_cards(html) if c["pid"] and c["pid"] not in seen]
        if not fresh:
            break
        seen.update(c["pid"] for c in fresh)
        cards += fresh
        if len(cards) >= total:
            break
        page += 1
    print(f"  {slug}: {len(cards)}/{total}")
    return cards


# ------------------------------------------------------------------- details

def parse_detail(html):
    """Pull the MLS amenity table, photos and blurb out of the page's JSON-LD."""
    node = None
    for b in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
        try:
            d = json.loads(b)
        except ValueError:
            continue
        for n in (d.get("@graph") or [d]):
            t = n.get("@type")
            if t and ("RealEstateListing" in t if isinstance(t, list) else t == "RealEstateListing"):
                node = n
    if not node:
        return None
    me = node.get("mainEntity") or {}
    feats = {}
    for f in (me.get("amenityFeature") or []):
        if f.get("name") is not None:
            feats.setdefault(f["name"], []).append(str(f.get("value")))
    return {
        "images": node.get("image", [])[:6],
        "description": clean(node.get("description", "")),
        "features": {k: clean(" | ".join(v)) for k, v in feats.items()},
    }


def acres_of(det):
    f = det["features"]
    if "Lot Size (Acres)" in f:
        try:
            return float(f["Lot Size (Acres)"].split("|")[0].replace(",", "").strip())
        except ValueError:
            pass
    if "Lot Size (Sq. Ft.)" in f:
        try:
            return round(float(re.sub(r'[^\d.]', '', f["Lot Size (Sq. Ft.)"].split("|")[0])) / 43560, 2)
        except ValueError:
            pass
    return None


def has_pool(det):
    """A pool the property actually has. 'Pool: No' and prose alone don't count."""
    v = det["features"].get("Pool", "")
    return bool(v) and not re.fullmatch(r'(no|none|false)', v.strip(), re.I)


# --------------------------------------------------------------------- merge

def slug_id(street, city):
    return re.sub(r'[^a-z0-9]+', '-', f"{street} {city}".lower()).strip("-")


def city_of(c):
    return clean(re.sub(r',.*', '', c["cityzip"]))


def run(dry=False):
    today = date.today().isoformat()
    print("Crawling city pages:")
    pool = {}
    for slug in CITIES:
        for c in crawl(slug):
            pool[c["pid"]] = c
    city_pids = set(pool)
    print("Coverage check over ZIP pages:")
    for z in ZIPS:
        for c in crawl(z):
            pool.setdefault(c["pid"], c)
    gaps = [c for pid, c in pool.items()
            if pid not in city_pids and city_of(c) in TARGET_CITIES]
    if gaps:
        # Already merged into `pool` above, so the run is still complete — but worth naming,
        # since a growing count means the city pages are drifting out of coverage.
        print(f"  + {len(gaps)} target-city listing(s) only the ZIP pass found: "
              + ", ".join(f"{g['street']}, {g['cityzip']}" for g in gaps))

    in_target = [c for c in pool.values() if city_of(c) in TARGET_CITIES]
    cands = [c for c in in_target
             if (c["beds"] or 0) >= MIN_BEDS
             and (c["totalBaths"] or 0) >= MIN_BATHS
             and (c["price"] or 1e12) <= MAX_PRICE]
    print(f"{len(in_target)} listings in the target cities, "
          f"{len(cands)} clearing beds/baths/price. Reading detail pages:")

    matches, pool_short_land, land_no_pool = [], [], []
    for i, c in enumerate(cands, 1):
        html = fetch(c["url"], f"d_{c['pid']}.html")
        det = parse_detail(html) if html else None
        if not det:
            print(f"  ! could not read {c['url']}", file=sys.stderr)
            continue
        acres, poolyes = acres_of(det), has_pool(det)
        f = det["features"]
        base = {
            "address": c["street"], "city": city_of(c),
            "zip": (re.search(r'(\d{5})', c["cityzip"]) or [None, None])[1]
                   if re.search(r'(\d{5})', c["cityzip"]) else None,
            "mls": c["mls"], "beds": int(c["beds"]), "baths": c["totalBaths"],
            "sqft": int(c["sqft"]) if c["sqft"] else None, "acres": acres,
            "url": c["url"],
        }
        active = "Active" in c["tags"]
        if acres and acres >= MIN_ACRES and poolyes:
            yb = f.get("Year Built", "")
            status = "Pending" if "Pending" in c["tags"] else (
                "Contingent" if "Contingent" in c["tags"] else "Active")
            matches.append(dict(base,
                id=slug_id(c["street"], city_of(c)),
                currentPrice=int(c["price"]),
                pool=True,
                poolDetail=f.get("Pool Description") or "Pool",
                yearBuilt=int(yb) if yb.isdigit() else None,
                photos=det["images"],
                gallery=c["url"],
                status="match" if status == "Active" else "pending",
                mlsStatus=status,
                updated=c["updated"],
                description=det["description"],
                features={k: v for k, v in f.items() if k in KEEP},
                source="Coldwell Banker IDX (MetroList)"))
        elif active and poolyes and NEAR_ACRES <= (acres or 0) < MIN_ACRES:
            pool_short_land.append(dict(base, price=int(c["price"]), pool=True,
                                        poolDetail=f.get("Pool Description") or "Pool",
                                        photo=(det["images"] or [None])[0],
                                        why=f"Pool, but {acres} acres — under the "
                                            f"{MIN_ACRES}-acre floor"))
        elif active and not poolyes and (acres or 0) >= MIN_ACRES:
            land_no_pool.append(dict(base, price=int(c["price"]), pool=False, poolDetail=None,
                                     photo=(det["images"] or [None])[0],
                                     why=f"{acres} acres, no pool"))
        if i % 10 == 0:
            print(f"  {i}/{len(cands)}")

    matches.sort(key=lambda m: (m["status"] != "match", -m["acres"]))
    pool_short_land.sort(key=lambda n: -n["acres"])
    land_no_pool.sort(key=lambda n: -n["acres"])

    old = json.load(open(STORE, encoding="utf-8"))
    prev = {l["id"]: l for l in old.get("listings", [])}
    live_ids = {m["id"] for m in matches}

    for m in matches:
        p = prev.get(m["id"])
        if p:
            m["firstSeen"] = p.get("firstSeen", today)
            hist = list(p.get("priceHistory") or [])
            m["priceChanged"] = bool(hist) and hist[-1]["price"] != m["currentPrice"]
            if m["priceChanged"] or not hist:
                hist.append({"date": today, "price": m["currentPrice"]})
            m["priceHistory"] = hist
            m["isNew"] = False
        else:
            m["firstSeen"] = today
            m["priceHistory"] = [{"date": today, "price": m["currentPrice"]}]
            m["isNew"], m["priceChanged"] = True, False
        m["lastSeen"] = today

    # Anything tracked last run that is no longer a live match drops off the board.
    archive = list(old.get("archive", []))
    for l in old.get("listings", []):
        if l["id"] not in live_ids:
            archive.append({k: l[k] for k in
                            ("id", "address", "city", "mls", "currentPrice", "beds", "baths",
                             "acres", "pool", "url") if k in l}
                           | {"droppedOn": today,
                              "outcome": "No longer an active listing meeting the criteria."})

    out = dict(old)
    out.update({
        "lastRun": today,
        "criteria": {"beds": f"{MIN_BEDS}+", "baths": f"{MIN_BATHS}+", "pool": True,
                     "cities": [f"{c}, CA" for c in
                                ("Shingle Springs", "Rescue", "Placerville")],
                     "minAcres": MIN_ACRES, "preferredAcres": 5, "maxPrice": MAX_PRICE},
        "listings": matches,
        "nearMisses": {"poolShortLand": pool_short_land, "landNoPool": land_no_pool},
        "archive": archive,
    })
    out["source"] = dict(old.get("source", {}), verifiedOn=today,
                         inventoryScanned=len(in_target))
    out["dataQuality"] = dict(old.get("dataQuality", {}),
                              verifiedActiveListings=sum(1 for m in matches
                                                         if m["mlsStatus"] == "Active"))

    new = sum(1 for m in matches if m["isNew"])
    chg = sum(1 for m in matches if m["priceChanged"])
    print(f"\n{len(matches)} matches ({new} new, {chg} repriced), "
          f"{len(pool_short_land) + len(land_no_pool)} near misses, "
          f"{len(archive) - len(old.get('archive', []))} dropped this run.")
    if dry:
        print("--dry-run: listings.json untouched.")
        return
    json.dump(out, open(STORE, "w", encoding="utf-8"), indent=2)
    print("listings.json written. Now run: node build.js")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="crawl and report, write nothing")
    run(dry=ap.parse_args().dry_run)
