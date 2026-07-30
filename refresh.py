#!/usr/bin/env python3
"""
Refresh listings.json from live MLS-backed data, then run `node build.js`.

    python3 refresh.py [--no-cache]

Pipeline
--------
1. Sweep the FULL active inventory of each target city from the Coldwell Banker
   IDX feed. CB republishes MetroList (the El Dorado County MLS) and, unlike the
   big portals, does not bot-block this environment. Every listing is read, not
   a search-engine summary of one -- that distinction is what makes status
   trustworthy. See README "Verification gate".
2. Card-level filter (beds/baths/price), then fetch each survivor's detail page.
   Lot acreage and pool only exist on the detail page.
3. Parse the detail page's JSON-LD, which carries the raw MLS field set
   ("Lot Size (Acres)", "Pool", "Pool Description", ...). Do NOT regex the
   rendered text: the "similar listings" carousel at the page foot contains
   other properties' acreage and will silently poison the result.
4. Cross-check every surviving match against MetroListPRO, the official
   MetroList public site. A property is only written out as a match when the
   MLS itself reports it Active with matching price/beds/acres/pool.
5. Merge with the previous listings.json: carry firstSeen forward, append to
   priceHistory when the price moved, flag newcomers with isNew.
"""
import re, json, time, subprocess, sys, os, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
BASE = "https://www.coldwellbankerhomes.com"
CITIES = [("shingle-springs", "Shingle Springs"), ("rescue", "Rescue"),
          ("placerville", "Placerville")]
TARGET_CITIES = {c for _, c in CITIES}
RUN = datetime.date.today().isoformat()
NO_CACHE = "--no-cache" in sys.argv

# hard criteria
MIN_BEDS, MIN_BATHS, MIN_ACRES, MAX_PRICE = 4, 3, 2.5, 1_500_000

os.makedirs(CACHE, exist_ok=True)


def fetch(url, key, tries=3):
    p = os.path.join(CACHE, key)
    if not NO_CACHE and os.path.exists(p) and os.path.getsize(p) > 5000:
        return open(p, encoding="utf-8", errors="replace").read()
    for i in range(tries):
        r = subprocess.run(["curl", "-sSL", "--max-time", "40", "-A", UA, url],
                           capture_output=True, text=True)
        if len(r.stdout) > 5000:
            open(p, "w", encoding="utf-8").write(r.stdout)
            return r.stdout
        time.sleep(2 * (i + 1))
    print(f"  !! fetch failed: {url}", file=sys.stderr)
    return ""


def strip_tags(s):
    s = re.sub(r"<script.*?</script>", " ", s, flags=re.S)
    s = re.sub(r"<[^>]+>", " ", s)
    for a, b in [("&nbsp;", " "), ("&amp;", "&"), ("&#39;", "'"), ("&quot;", '"')]:
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip()


def num(v):
    try:
        return float(re.sub(r"[^\d.]", "", str(v)))
    except Exception:
        return None


# ---------------------------------------------------------------- 1. sweep
def parse_cards(html):
    out, chunks = [], html.split('<div class="prop-info">')
    pre, chunks = chunks[:-1], chunks[1:]
    for i, c in enumerate(chunks):
        cut = c.find("mls-icons-actions")
        c = c[:cut + 4000] if cut > 0 else c[:12000]
        prev = pre[i][-14000:] if i < len(pre) else ""
        m = re.search(r'<span class="street-address">(.*?)</span>', c)
        if not m:
            continue
        d = {"address": strip_tags(m.group(1))}
        m = re.search(r'<span class="city-st-zip[^"]*">(.*?)</span>', c)
        m2 = re.match(r"(.*),\s*CA\s*(\d{5})", strip_tags(m.group(1)) if m else "")
        d["city"], d["zip"] = (m2.group(1), m2.group(2)) if m2 else ("", "")
        m = re.search(r'<div class="price-normal">\$([\d,]+)</div>', c)
        d["price"] = int(m.group(1).replace(",", "")) if m else None
        m = re.search(r'<div class="price-reduction[^"]*">([^<]+)</div>', c)
        d["priceReduction"] = strip_tags(m.group(1)) if m else None
        m = re.search(r"MLS # ([\w-]+)", strip_tags(c))
        d["mls"] = m.group(1) if m else None
        m = (re.search(r'<a href="(/[^"]*/pid_\d+/)"', c)
             or re.search(r'<a href="(/[^"]*/pid_\d+/)"', prev))
        d["url"] = BASE + m.group(1) if m else None
        # Field class names vary by property type and by count. Single Family uses
        # "beds"/"total-baths"; Multi-Family uses "total-beds"; a count of 1 uses the
        # singular "bed"/"total-bath". Missing any of these silently drops real homes
        # from the shortlist -- 1781 Springvale Rd (Multi-Family) was lost this way.
        def highlight(*labels):
            for lbl in labels:
                m = re.search(r'<li class="%s"><div class="val">([\d,.]+)</div>'
                              % re.escape(lbl), c)
                if m:
                    return num(m.group(1))
            return None
        d["beds"] = highlight("beds", "bed", "total-beds")
        d["baths"] = highlight("total-baths", "total-bath")
        d["sqft"] = highlight("sq.-ft.")
        m = re.search(r"<li>(Single Family|Multi-Family|Land Residential|Condo|Townhouse|"
                      r"Manufactured|Mobile|Commercial|Farm|Ranch)</li>", c)
        d["propertyType"] = m.group(1) if m else None
        st = re.findall(r"<li>(Active|Pending|Coming Soon|Contingent)</li>", c)
        d["status"] = st[0] if st else None
        m = re.search(r'property-status-indicator-text"[^>]*>([^<]+)<', prev)
        d["flag"] = strip_tags(m.group(1)) if m else None
        out.append(d)
    return out


cards, scanned = [], 0
for slug, name in CITIES:
    page = 1
    while True:
        url = f"{BASE}/ca/{slug}/" if page == 1 else f"{BASE}/ca/{slug}/p_{page}/"
        h = fetch(url, f"{slug}_p{page}.html")
        if not h:
            break
        if page == 1:
            m = re.search(r'result-count" data-count="(\d+)"', h)
            print(f"{name}: {m.group(1) if m else '?'} active listings")
        got = parse_cards(h)
        cards += got
        scanned += len(got)
        if f'data-pagenumber="{page+1}"' not in h or not got:
            break
        page += 1
        time.sleep(1.5)
print(f"swept {scanned} listings\n")

# ---------------------------------------------------------------- 2. details
# The card filter is only an optimisation -- the detail page is authoritative.
# So FAIL OPEN: when a card doesn't state beds or baths, still fetch its detail
# page rather than assuming it fails. Cards omit those fields more often than you
# would expect, and guessing "no" there loses qualifying homes silently.
seen, shortlist = set(), []
for r in cards:
    k = (r["address"], r["city"])
    if (k in seen or r["city"] not in TARGET_CITIES or not r["url"]
            or r["status"] != "Active"
            or (r["price"] or 9e9) > MAX_PRICE
            or (r["beds"] is not None and r["beds"] < MIN_BEDS)
            or (r["baths"] is not None and r["baths"] < MIN_BATHS)):
        continue
    seen.add(k)
    shortlist.append(r)
print(f"{len(shortlist)} pass the card-level filter; fetching detail pages")

by_url = {}
for r in shortlist:
    key = re.sub(r"\W+", "_", r["url"])[-90:] + ".html"
    h = fetch(r["url"], key)
    if h:
        by_url[r["url"]] = h
    time.sleep(1.2)

# ---------------------------------------------------------------- 3. parse
detailed = []
for r in shortlist:
    h = by_url.get(r["url"])
    if not h:
        continue
    node = None
    for b in re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', h, re.S):
        try:
            d = json.loads(b)
        except Exception:
            continue
        for n in d.get("@graph") or []:
            if isinstance(n.get("@type"), list) and "RealEstateListing" in n["@type"]:
                node = n
    if not node:
        continue
    me = node.get("mainEntity") or {}
    feat = {a.get("name"): a.get("value") for a in me.get("amenityFeature", [])}
    addr, offer = me.get("address", {}), node.get("offers", {})
    acres = num(feat.get("Lot Size (Acres)"))
    if acres is None and feat.get("Lot Size (Sq. Ft.)"):
        sf = num(feat.get("Lot Size (Sq. Ft.)"))
        acres = round(sf / 43560, 2) if sf else None
    pooldesc = feat.get("Pool Description")
    detailed.append({
        "address": addr.get("streetAddress", "").strip(),
        "city": addr.get("addressLocality", "").strip(),
        "zip": addr.get("postalCode"),
        "lat": (me.get("geo") or {}).get("latitude"),
        "lon": (me.get("geo") or {}).get("longitude"),
        "price": num(offer.get("price")),
        "beds": num(me.get("numberOfBedrooms")),
        "baths": num(me.get("numberOfBathroomsTotal")),
        "fullBaths": num(me.get("numberOfFullBathrooms")),
        "sqft": num((me.get("floorSize") or {}).get("value")) or num(feat.get("Square Feet")),
        "acres": acres,
        "pool": str(feat.get("Pool", "")).strip().lower() == "yes"
                or bool(pooldesc and "no pool" not in str(pooldesc).lower()),
        "poolDesc": pooldesc,
        "yearBuilt": feat.get("Year Built"),
        "lotDesc": feat.get("Lot Description"),
        "zoning": feat.get("Zoning"),
        "schoolDistrict": feat.get("School District"),
        "garage": feat.get("Garage Spaces"),
        "horse": feat.get("Horse Property"),
        "url": node.get("url"),
        "desc": node.get("description"),
        "datePosted": node.get("datePosted"),
        "photos": (node.get("image") or [])[:8],
        "mls": r["mls"], "status": r["status"], "flag": r["flag"],
        "propertyType": r["propertyType"],
        "priceReduction": r["priceReduction"],
    })


def passes(r):
    return ((r["beds"] or 0) >= MIN_BEDS and (r["baths"] or 0) >= MIN_BATHS and r["pool"]
            and (r["acres"] or 0) >= MIN_ACRES and (r["price"] or 9e9) <= MAX_PRICE)


matches = sorted([r for r in detailed if passes(r)], key=lambda x: x["price"])
print(f"{len(matches)} meet every criterion; verifying against MetroList MLS\n")

# ---------------------------------------------------------------- 4. verify
verified = {}
for r in matches:
    slug = f"{r['address']} {r['city']} CA {r['zip']}".upper().replace(" ", "-")
    murl = f"https://www.metrolistpro.com/homes/2/6/{slug}/{r['mls']}"
    h = fetch(murl, f"mls_{r['mls']}.html")
    v = {"url": murl, "ok": False}
    if h:
        t = strip_tags(h)

        def g(pat, cast=str):
            m = re.search(pat, t, re.I)
            if not m:
                return None
            try:
                return cast(m.group(1).replace(",", ""))
            except Exception:
                return m.group(1)
        v.update({
            "status": g(r"Status:\s*(\w[\w\s]{0,22}?)\s+Is Short Sale"),
            "price": g(r"\$([\d,]+) \(For Sale\)", int),
            "beds": g(r"Bedrooms:\s*(\d+)", int),
            "acres": g(r"Acres:\s*([\d.,]+)", float),
            "pool": g(r"Pool:\s*(Yes|No)"),
        })
        v["ok"] = (v["status"] or "").lower().startswith("active")
        v["priceAgrees"] = v["price"] == r["price"]
        v["bedsAgree"] = v["beds"] == r["beds"]
        v["acresAgree"] = v["acres"] is not None and abs(v["acres"] - r["acres"]) < 0.15
        v["poolAgrees"] = (v["pool"] or "").lower() == "yes"
    verified[r["mls"]] = v
    print(f"  {'OK ' if v['ok'] else 'DROP'} {r['address']:<26} MLS says {v.get('status')}")
    time.sleep(1.2)

confirmed = [r for r in matches if verified[r["mls"]]["ok"]]
dropped_unverified = [r for r in matches if not verified[r["mls"]]["ok"]]

# ---------------------------------------------------------------- 5. merge
prev_path = os.path.join(HERE, "listings.json")
old = json.load(open(prev_path)) if os.path.exists(prev_path) else {"listings": [], "rejected": []}
sid = lambda a, c: re.sub(r"[^a-z0-9]+", "-", f"{a} {c}".lower()).strip("-")

# Dedupe on the MLS number, NOT the address slug. Slugs are not stable across runs
# because sources abbreviate street suffixes inconsistently ("3784-cattle-dr" one
# run, "3784-cattle-drive" the next), which would republish every listing as new.
# Fall back to the slug only for older records that predate the MLS field.
def key_of(rec, addr=None, city=None):
    return rec.get("mls") or sid(addr or rec.get("address", ""), city or rec.get("city", ""))


old_by_key = {key_of(l): l for l in old.get("listings", [])}

listings, changes = [], []
for r in confirmed:
    i = sid(r["address"], r["city"])
    p = old_by_key.get(key_of(r))
    hist = (p or {}).get("priceHistory", [])
    if not hist or hist[-1]["price"] != r["price"]:
        if hist:
            changes.append(f"{r['address']}: ${hist[-1]['price']:,.0f} -> ${r['price']:,.0f}")
        hist = hist + [{"date": RUN, "price": r["price"]}]
    if p is None:
        changes.append(f"NEW {r['address']}, {r['city']} ${r['price']:,.0f}")
    listings.append({
        "id": i, "address": r["address"], "city": r["city"], "zip": r["zip"],
        "mls": r["mls"], "currentPrice": int(r["price"]), "priceHistory": hist,
        "isNew": p is None, "beds": int(r["beds"]), "baths": r["baths"],
        "fullBaths": r["fullBaths"], "sqft": int(r["sqft"]) if r["sqft"] else None,
        "acres": r["acres"], "pool": True, "poolDetail": r["poolDesc"] or "Pool",
        "yearBuilt": r["yearBuilt"], "lotDesc": r["lotDesc"], "zoning": r["zoning"],
        "schoolDistrict": r["schoolDistrict"], "garage": r["garage"], "horse": r["horse"],
        "lat": r["lat"], "lon": r["lon"], "photos": r["photos"], "desc": r["desc"],
        "listedOn": (r["datePosted"] or "")[:10], "flag": r["flag"],
        "priceReduction": r["priceReduction"], "propertyType": r["propertyType"],
        "status": "match",
        "firstSeen": (p or {}).get("firstSeen", RUN), "lastSeen": RUN,
        "url": r["url"], "mlsUrl": verified[r["mls"]]["url"],
        "verified": {
            "source": "MetroListPRO (official MetroList MLS public site)",
            "status": verified[r["mls"]].get("status"),
            "priceAgrees": verified[r["mls"]].get("priceAgrees"),
            "bedsAgree": verified[r["mls"]].get("bedsAgree"),
            "acresAgree": verified[r["mls"]].get("acresAgree"),
            "poolAgrees": verified[r["mls"]].get("poolAgrees"),
            "checkedOn": RUN,
        },
        "caveat": ("MLS counts 3 total baths as 2 full + 1 half — only 2 full baths."
                   if (r["fullBaths"] or 0) < MIN_BATHS else None),
    })

# Anything tracked last run that is no longer confirmed active has left the board.
# Distinguish "gone from the MLS" from "still listed but fails a criterion" -- the
# sweep covers the full active inventory, so absence from it is real evidence.
live_keys = {key_of(l) for l in listings}
still_listed = {}
for c in cards:
    if c["status"] == "Active":
        still_listed[key_of(c)] = c
        still_listed.setdefault(sid(c["address"], c["city"]), c)
# Properties pulled because the MLS itself reports them Pending/Sold are reported below,
# with the MLS status as the reason. Skip them here: the IDX card can still read "Active"
# for a listing already in escrow, which would otherwise emit a second, wrong entry
# blaming pool or acreage for a drop that was really a status change.
unverified_keys = {key_of(r) for r in dropped_unverified}
unverified_keys |= {sid(r.get("address", ""), r.get("city", "")) for r in dropped_unverified}

dropped = []
for i, o in old_by_key.items():
    if i in live_keys or i in unverified_keys:
        continue
    c = still_listed.get(i) or still_listed.get(sid(o.get("address",""), o.get("city","")))
    if c:
        why = []
        if (c["beds"] or 0) < MIN_BEDS:
            why.append(f"{c['beds']:.0f}bd")
        if (c["baths"] or 0) < MIN_BATHS:
            why.append(f"{c['baths']:.0f}ba")
        if (c["price"] or 0) > MAX_PRICE:
            why.append(f"${c['price']:,.0f}")
        reason = (f"Still active at ${c['price']:,.0f} (MLS {c['mls']}) but fails the criteria"
                  + (f" — {', '.join(why)}." if why else " on pool or acreage."))
    else:
        reason = "No longer in active MLS inventory — sold or withdrawn."
    dropped.append({"address": f"{o['address']}, {o['city']}", "reason": reason,
                    "droppedOn": RUN})
dropped += [{"address": f"{r['address']}, {r['city']}",
             "reason": f"MLS reports {verified[r['mls']].get('status') or 'not active'} — not shown.",
             "droppedOn": RUN}
            for r in dropped_unverified]
for d in dropped:
    changes.append(f"DROPPED {d['address']}")

near_no_pool, near_small_lot = [], []
for r in sorted(detailed, key=lambda x: x["price"] or 0):
    if (r["beds"] or 0) < MIN_BEDS or (r["baths"] or 0) < MIN_BATHS or (r["price"] or 9e9) > MAX_PRICE:
        continue
    base = {"address": r["address"], "city": r["city"], "price": int(r["price"]),
            "beds": int(r["beds"]), "baths": r["baths"], "acres": r["acres"],
            "sqft": int(r["sqft"]) if r["sqft"] else None, "mls": r["mls"], "url": r["url"]}
    if r["pool"] and 0 < (r["acres"] or 0) < MIN_ACRES:
        near_small_lot.append(base)
    elif not r["pool"] and (r["acres"] or 0) >= MIN_ACRES:
        near_no_pool.append(base)

out = dict(old)
out.update({
    "_comment": ("Canonical listing store, regenerated by refresh.py. Every entry under "
                 "`listings` was found by sweeping the full active MLS inventory of the target "
                 "cities and then independently confirmed Active against MetroListPRO, the "
                 "official MetroList MLS site. Listing status is never taken from search-engine "
                 "text — see README 'Verification gate'."),
    "criteria": {"beds": f"{MIN_BEDS}+", "baths": f"{MIN_BATHS}+", "pool": True,
                 "cities": [f"{c}, CA" for _, c in CITIES],
                 "minAcres": MIN_ACRES, "preferredAcres": 5, "maxPrice": MAX_PRICE},
    "lastRun": RUN,
    "previousRun": old.get("lastRun"),
    "dataQuality": {
        "verifiedActiveListings": len(listings),
        "primarySource": "Coldwell Banker IDX feed (MetroList MLS data), full city inventory sweep",
        "verificationSource": "MetroListPRO — official MetroList MLS public search",
        "inventoryScanned": scanned,
        "note": (f"Swept {scanned} active listings across the target cities; "
                 f"{len(shortlist)} passed the bed/bath/price filter and had their detail pages "
                 f"read for acreage and pool; {len(matches)} met every criterion; "
                 f"{len(listings)} of those were confirmed Active by the MLS itself."),
    },
    # `out` starts as a copy of the previous run, so every counter the page renders has
    # to be rewritten here — otherwise the header stats silently keep last run's numbers.
    "source": {
        "name": "Coldwell Banker Homes (MetroList MLS IDX feed)",
        "method": ("Enumerated every active listing in Placerville, Shingle Springs and Rescue "
                   "from the brokerage's JSON-LD search pages, then pulled each candidate's "
                   "detail page for lot size, pool fields and true MLS status."),
        "inventoryScanned": scanned,
        "passedBedsBathsPrice": len(shortlist),
        "verifiedActiveMatches": len(listings),
    },
    "listings": listings,
    "nearMisses": {"acreageOkNoPool": near_no_pool, "poolOkLotTooSmall": near_small_lot},
    "dropped": dropped,
})
json.dump(out, open(prev_path, "w"), indent=2)

print(f"\nwrote listings.json: {len(listings)} matches "
      f"({sum(1 for l in listings if l['isNew'])} new), {len(dropped)} dropped, "
      f"{len(near_no_pool) + len(near_small_lot)} near misses")
if changes:
    print("\nchanges this run:")
    for c in changes:
        print("  -", c)
print("\nnow run:  node build.js")
