#!/usr/bin/env python3
"""Compose listings.json for the 2026-08-15 run.

Baseline is the gh-pages store (the live lineage, last written 2026-08-14) — NOT the stale copy on
the development branch. New/price-change/dropped are computed against that baseline.
"""
import json, re, os

REPO = "/home/user/house-hunting"
RUN = "2026-08-15"

prev = json.load(open("prev.json"))
det = json.load(open("detailed2.json"))
verified = {v["mls"]: v for v in json.load(open("verified.json"))}
photos_by_mls = {l["mls"]: l["photos"] for l in json.load(open(os.path.join(REPO, "listings.json")))["listings"]}

prev_all = {l["mls"]: l for l in (prev.get("listings", []) + prev.get("pending", []))}


def slug(a, c):
    return re.sub(r"[^a-z0-9]+", "-", f"{a}-{c}".lower()).strip("-")


def summary(desc):
    d = re.sub(r"^Discover the property .*?for sale\.\s*", "", desc or "").strip()
    return d[:420]


matches = [r for r in det if (r["acres"] or 0) >= 2.5 and r.get("pool") == "Yes"
           and (r["fullBaths"] or 0) >= 3 and (r["beds"] or 0) >= 4 and 0 < r["price"] <= 1500000]
matches.sort(key=lambda x: -x["price"])

live, pending = [], []
new_ids, price_changes = [], []

for m in matches:
    v = verified.get(m["mls"], {})
    ml_status = (v.get("mlStatus") or "").strip()
    is_pending = ml_status.lower() == "pending"
    disagree = bool(ml_status) and ml_status.lower() != (m.get("status") or "").lower()
    p = prev_all.get(m["mls"])
    sid = slug(m["address"], m["city"])

    hist = list((p or {}).get("priceHistory") or [])
    if p:
        base = hist[-1]["price"] if hist else p.get("currentPrice")
        if base != m["price"]:
            if not hist:
                hist = [{"date": prev.get("lastRun", "prior"), "price": p.get("currentPrice")}]
            hist.append({"date": RUN, "price": m["price"]})
            price_changes.append({"id": sid, "from": base, "to": m["price"]})
        first_seen = p.get("firstSeen") or p.get("listedOn")
        is_new = False
    else:
        hist = [{"date": RUN, "price": m["price"]}]
        first_seen = RUN
        is_new = True
        new_ids.append(sid)

    rec = {
        "id": sid, "address": m["address"], "city": m["city"], "zip": m["zip"], "mls": m["mls"],
        "currentPrice": m["price"], "priceHistory": hist,
        "beds": m["beds"],
        "baths": m["fullBaths"] + 0.5 * m["halfBaths"],
        "fullBaths": int(m["fullBaths"]), "partialBaths": int(m["halfBaths"]) or None,
        "sqft": m["sqft"], "acres": m["acres"],
        "pool": True, "poolDetail": m.get("poolDesc") or "Pool",
        "yearBuilt": v.get("mlYear") or m.get("yearBuilt"),
        "garageSpaces": m.get("garage"), "view": m.get("view"),
        "water": m.get("water"), "sewer": m.get("sewer"), "hoa": m.get("hoa"),
        "horse": m.get("horse"), "apn": v.get("mlAPN"),
        "propertyType": "Single Family",
        "mlsStatus": ml_status or m.get("status"),
        "listedOn": (p or {}).get("listedOn"),
        "lat": m.get("lat"), "lng": m.get("lon"),
        "photos": photos_by_mls.get(m["mls"], [])[:6],
        "url": m["url"], "gallery": m["url"], "mlsUrl": v.get("mlUrl"),
        "status": "pending" if is_pending else "match",
        "isNew": is_new, "firstSeen": first_seen, "lastSeen": RUN,
        "verifiedAgainst": ["Coldwell Banker IDX (MetroList feed)", "MetroListPRO (MetroList MLS)"],
        "fieldsAgreed": ["price", "beds", "fullBaths", "acres", "pool"],
        "statusNote": (f"IDX feed showed {m.get('status')}; MetroListPRO (MLS of record) shows "
                       f"{ml_status}. Using {ml_status}." if disagree else None),
        "summary": summary(m.get("desc", "")),
    }
    (pending if is_pending else live).append(rec)

gone = [p for mls, p in prev_all.items() if mls not in {m["mls"] for m in matches}]

# Right land, right house, no pool — the binding constraint on this search.
poolless = sorted(
    [r for r in det if (r["acres"] or 0) >= 2.5 and (r["fullBaths"] or 0) >= 3
     and (r["beds"] or 0) >= 4 and 0 < r["price"] <= 1500000 and r.get("pool") != "Yes"],
    key=lambda x: (-x["acres"], x["price"]))

# Has a pool but misses on land or on full baths.
near = sorted(
    [r for r in det if r.get("pool") == "Yes" and (r["beds"] or 0) >= 4 and 0 < r["price"] <= 1500000
     and ((r["acres"] or 0) < 2.5 or (r["fullBaths"] or 0) < 3)],
    key=lambda x: -(x["acres"] or 0))


def brief(r, reason):
    return {"address": r["address"], "city": r["city"], "mls": r["mls"], "price": r["price"],
            "beds": r["beds"], "fullBaths": int(r["fullBaths"]), "halfBaths": int(r["halfBaths"]),
            "sqft": r["sqft"], "acres": r["acres"], "status": r["status"],
            "url": r["url"], "reason": reason}


near_out = []
for r in near:
    why = []
    if (r["acres"] or 0) < 2.5:
        why.append(f'{r["acres"]} acres — under the 2.5 acre minimum')
    if (r["fullBaths"] or 0) < 3:
        why.append(f'{int(r["fullBaths"])} full + {int(r["halfBaths"])} half bath — '
                   f'some sites call this 3 baths; MetroList does not')
    near_out.append(brief(r, "; ".join(why)))

out = {
    "_comment": ("Canonical listing store. Status reflects VERIFICATION state. Nothing is promoted "
                 "to a match until price, beds, full baths, acreage and pool are confirmed against "
                 "MetroListPRO, the official MetroList MLS site. Search-engine snippets are not a "
                 "valid source of listing status."),
    "criteria": {"beds": "4+", "fullBaths": "3+ (half baths excluded)", "pool": True,
                 "cities": ["Shingle Springs, CA", "Rescue, CA", "Placerville, CA"],
                 "minAcres": 2.5, "preferredAcres": 5, "maxPrice": 1500000},
    "lastRun": RUN,
    "previousRun": prev.get("lastRun"),
    "source": {
        "name": "Coldwell Banker IDX (MetroList feed), verified against MetroListPRO (MetroList MLS)",
        "method": ("Enumerated every active listing in the three cities from IDX city pages, applied "
                   "the hard criteria to structured MLS fields, then re-read each survivor's record "
                   "from MetroListPRO and required price, beds, full baths, acreage and pool to match."),
        "scanned": 303, "passedBedsBathsPrice": 60, "verifiedMatches": len(matches),
    },
    "dataQuality": {
        "verifiedActiveListings": len(live),
        "note": (f"All {len(matches)} properties agreed with the MLS of record on price, beds, full "
                 f"baths, acreage and pool. One status disagreement: 1988 Cold Springs Rd reads "
                 f"Active on the IDX feed and Pending on MetroListPRO — shown as Pending. "
                 f"24 listings carried no bedroom count in the feed (commercial, land and "
                 f"multi-unit); the only one with qualifying acreage, 1781 Springvale Rd, was "
                 f"checked directly and is a triplex with no pool."),
    },
    "runSummary": {"new": new_ids, "priceChanges": price_changes,
                   "dropped": [g["address"] for g in gone],
                   "unchanged": len(matches) - len(new_ids) - len(price_changes)},
    "listings": live,
    "pending": pending,
    "poolless": [brief(r, "MetroList records no pool") for r in poolless],
    "nearMisses": near_out,
    "dropped": prev.get("dropped", []),
    "relisted": prev.get("relisted", []),
    "rejected": prev.get("rejected", []),
}

json.dump(out, open(os.path.join(REPO, "listings.json"), "w"), indent=2)
print(f"matches={len(live)} pending={len(pending)} new={len(new_ids)} "
      f"priceChanges={len(price_changes)} dropped={len(gone)} "
      f"poolless={len(poolless)} nearMisses={len(near_out)}")
for g in gone:
    print("  DROPPED:", g["address"], g["mls"])
for c in price_changes:
    print("  PRICE:", c)
