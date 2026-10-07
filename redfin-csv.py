#!/usr/bin/env python3
"""
Third cross-check: enumerate from Redfin's direct JSON/CSV APIs and compare to the board.

    python3 redfin-csv.py                # sweep, print candidates, diff against listings.json
    python3 redfin-csv.py --json out.json # also write the raw candidate set
    python3 redfin-csv.py --stamp         # also record the result for build.js to render

This is NOT the board. `scrape.js` (IDX feed) enumerates and `verify.py` (MetroListPRO) speaks
for the MLS of record. This is a cheap independent second enumeration, in the spirit of
`scripts/fetch.sh` + `parse_search.py` but without the HTML scraping, because as of 2026-10-07
Redfin's `/stingray/api/*` endpoints answer this environment directly (200, genuine El Dorado
County data). `redfin.py`'s header says they are CloudFront-blocked and that the payloads must be
dug out of the search page HTML; that was true when it was written and is no longer. If these
endpoints start 403ing again, fall back to `redfin.py` / `scripts/fetch.sh`.

Three things this guards against, each of which has burned an earlier run:

  * Redfin spills nearby towns into a ZIP's results. Rows are filtered on the `CITY` column,
    never on which ZIP was queried.
  * The CSV has no pool column, and a Redfin detail page embeds comparable and nearby-home
    payloads, so a loose regex over the HTML returns a neighbour's pool status. Pool here comes
    only from the MLS `POOL_PRIVATE_YN` amenity field of the `belowTheFold` API called with an
    explicit `propertyId`, which cannot be another property's record.
  * Redfin's CSV export omits listings whose MLS forbids download ("In accordance with local MLS
    rules..."), so a property missing from this sweep is not evidence it is off market. Only a
    property present *here* and absent from the board is a finding worth chasing.

Baths: Redfin's `BATHS` column is full + half, and it cannot be decomposed. A home reading 2.5 is
2 full + 1 half, so it cannot clear a 3-full minimum and is excluded. But a home reading 5.0 might
be 5 full or 4 full + 2 half, so an integer is no guarantee either. This sweep therefore filters on
`BATHS >= 3` and *flags* every row it cannot resolve rather than asserting a full-bath count: the
authority on full baths is the IDX/MetroList field the board uses, not this column.
"""

import csv
import io
import json
import re
import subprocess
import sys
import time

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")

CITIES = {"Placerville", "Shingle Springs", "Rescue"}

# region_type 2 = ZIP, 6 = city. Resolve a new one with:
#   curl -sG https://www.redfin.com/stingray/do/location-autocomplete \
#        --data-urlencode location=95672 --data-urlencode v=2
# The reply is prefixed `{}&&`; ids come back as "<type>_<id>" where type 2 = city, 4 = ZIP.
# Pass the numeric half as region_id. Never guess a city id: a wrong one silently serves a
# different city (Redfin's 17151 is San Francisco, not Shingle Springs). ZIPs have no such
# failure mode, so the ZIP sweep is the primary and the two city regions are belt-and-braces.
REGIONS = [
    ("95672 Rescue",            39796, 2),
    ("95667 Placerville",       39791, 2),
    ("95682 Shingle Springs",   39806, 2),
    ("95619 Diamond Springs",   39748, 2),
    ("95623 El Dorado",         39751, 2),
    ("Shingle Springs (city)",  25976, 6),
    ("Placerville (city)",      14915, 6),
]

MIN_BEDS, MIN_BATHS, MIN_ACRES, MAX_PRICE = 4, 3, 2.5, 1_500_000
SQFT_PER_ACRE = 43560


def fetch(url):
    r = subprocess.run(["curl", "-sS", "--max-time", "60", "-A", UA, url],
                       capture_output=True, text=True, errors="replace")
    return r.stdout


def api(url):
    """Redfin prefixes its JSON with `{}&&` to defeat JSON hijacking."""
    s = fetch(url)
    if s.startswith("{}&&"):
        s = s[4:]
    try:
        return json.loads(s).get("payload", {})
    except (ValueError, AttributeError):
        return {}


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


URL_COL = ("URL (SEE https://www.redfin.com/buy-a-home/comparative-market-analysis "
           "FOR INFO ON PRICING)")


def sweep():
    """Every for-sale row in the target regions, deduped by listing URL."""
    rows = {}
    for label, rid, rtype in REGIONS:
        body = fetch("https://www.redfin.com/stingray/api/gis-csv?al=1&market=sacramento"
                     f"&num_homes=350&ord=redfin-recommended-asc&page_number=1"
                     f"&region_id={rid}&region_type={rtype}"
                     "&sf=1,2,3,5,6,7&status=9&uipt=1,2,3,4,7,8&v=8")
        lines = body.splitlines()
        if not lines:
            print(f"  !! {label}: empty response", file=sys.stderr)
            continue
        # Drop the "In accordance with local MLS rules..." notice line.
        keep = [lines[0]] + [l for l in lines[1:] if not l.startswith('"In accordance')]
        n = 0
        for r in csv.DictReader(io.StringIO("\n".join(keep))):
            u = r.get(URL_COL)
            if u:
                rows[u] = r
                n += 1
        print(f"  {label:<24} {n:>4} rows")
        time.sleep(1)
    return rows


def pool_of(url):
    """MLS POOL_PRIVATE_YN for exactly this property, plus live status and price."""
    pid = url.rstrip("/").split("/")[-1]
    page = fetch(url)
    m = re.search(r'"listingId":(\d+)', page)
    if not m:
        return {"pool": None, "why": "no listingId on the page"}
    lid = m.group(1)
    base = ("https://www.redfin.com/stingray/api/home/details/"
            f"{{}}?propertyId={pid}&listingId={lid}&accessLevel=1")

    amenities = {}
    for sg in (api(base.format("belowTheFold")).get("amenitiesInfo") or {}).get("superGroups") or []:
        for g in sg.get("amenityGroups") or []:
            for e in g.get("amenityEntries") or []:
                amenities.setdefault(e.get("referenceName"), []).extend(e.get("amenityValues") or [])

    yn = amenities.get("POOL_PRIVATE_YN")
    pool = None
    if yn:
        pool = any(v in ("Yes", "Has Private Pool") for v in yn)

    addr = api(base.format("aboveTheFold")).get("addressSectionInfo") or {}
    latest = addr.get("latestPriceInfo") or addr.get("priceInfo") or {}
    return {
        "pool": pool,
        "poolFeatures": amenities.get("POOL_FEATURES") or amenities.get("POOL_DESCRIPTION"),
        "spa": amenities.get("SPA_YN"),
        "status": (addr.get("status") or {}).get("displayValue"),
        "price": latest.get("amount"),
        "why": None if yn else "MLS records no POOL_PRIVATE_YN field for this listing",
    }


def main():
    print("Redfin direct-API sweep")
    rows = sweep()
    print(f"\n{len(rows)} unique for-sale rows; filtering to the three cities\n")

    candidates, halfbath = [], []
    for url, r in rows.items():
        if r["CITY"] not in CITIES:
            continue
        beds, baths = num(r["BEDS"]), num(r["BATHS"])
        price, lot = num(r["PRICE"]), num(r["LOT SIZE"])
        if not (beds and beds >= MIN_BEDS):
            continue
        if not (price and price <= MAX_PRICE):
            continue
        if not (lot and lot >= MIN_ACRES * SQFT_PER_ACRE):
            continue
        rec = {
            "address": r["ADDRESS"], "city": r["CITY"], "zip": r["ZIP OR POSTAL CODE"],
            "price": int(price), "beds": int(beds), "baths": baths,
            "sqft": r["SQUARE FEET"], "acres": round(lot / SQFT_PER_ACRE, 2),
            "mls": r["MLS#"], "mlsSource": r["SOURCE"], "url": url,
        }
        # A fractional count is certainly short of `MIN_BATHS` full baths; an integer count
        # might still hide two half baths. Exclude the first, flag the second.
        if not baths or baths < MIN_BATHS:
            continue
        (halfbath if baths % 1 else candidates).append(rec)

    print(f"{len(candidates)} cleared beds/baths/price/acres; reading each MLS pool field\n")
    for c in candidates + halfbath:
        c.update(pool_of(c["url"]))
        flag = {True: "POOL", False: "no pool", None: "pool UNKNOWN"}[c["pool"]]
        print(f"  {c['price']:>9,}  {c['address'][:28]:<28} {c['city'][:15]:<15} "
              f"{c['beds']}bd/{c['baths']}ba {c['acres']:>6}ac  {c['status'] or '?':<10} {flag}")
        if c["why"]:
            print(f"             ^ {c['why']}")
        time.sleep(1.5)

    matches = [c for c in candidates if c["pool"] and c["status"] == "Active"]
    print(f"\n{len(matches)} active with a pool confirmed in the MLS amenity record.")
    if halfbath:
        print("\nHeld back — Redfin's BATHS is full+half and these are fractional, so the full "
              "count is short of 3 unless the MLS record says otherwise:")
        for c in halfbath:
            print(f"  {c['address']}, {c['city']}: Redfin reads {c['baths']} baths"
                  f"{'  [POOL]' if c.get('pool') else ''}. The board's IDX/MLS full-bath field "
                  "is the authority.")

    # Diff against the board. Only "Redfin has it, the board does not" is actionable; the CSV
    # export is incomplete by design, so the reverse direction proves nothing.
    try:
        board = json.load(open("listings.json"))
    except OSError:
        board = None
    if board:
        on_board = {l["mls"] for l in board["listings"]} | {
            p.get("mls") for p in board.get("pending", [])}
        extra = [c for c in matches if c["mls"] not in on_board]
        print(f"\nvs listings.json ({len(board['listings'])} matches, lastRun {board['lastRun']}):")
        if extra:
            print("  NOT ON THE BOARD — read each from MetroListPRO before publishing:")
            for c in extra:
                print(f"    {c['address']}, {c['city']} — {c['price']:,} MLS {c['mls']}")
        else:
            print("  no match here that the board is missing.")
        for l in board["listings"]:
            here = next((c for c in matches if c["mls"] == l["mls"]), None)
            if here and here["price"] != l["currentPrice"]:
                print(f"  PRICE DISAGREEMENT {l['address']}: board {l['currentPrice']:,} "
                      f"vs Redfin {here['price']:,}")

    if "--stamp" in sys.argv and board is not None:
        # build.js renders this as the "Third source" row. scrape.js rebuilds dataQuality
        # wholesale, so a stamp only survives when this ran after it — which is what keeps the
        # row honest. Nothing is stamped if a region came back empty, because a short sweep
        # cannot support a completeness claim.
        if len(rows) < 200:
            print(f"\nNOT stamping: only {len(rows)} rows came back, too few to be a full sweep.")
        else:
            # build.js renders this as "the one match MetroListPRO has not indexed", so only
            # claim it when this sweep really is the sole second source for exactly one listing.
            # A listing carried by another MLS already gets its own second source from
            # foreign-verify.py, and two of them make the singular sentence false either way.
            sole = [l for l in board["listings"]
                    if not l.get("secondSource")
                    and any(c["mls"] == l["mls"] for c in matches)
                    and l.get("mlsSource")
                    and "METROLIST" not in l["mlsSource"].upper()]
            unindexed = sole[0]["address"] if len(sole) == 1 else None
            board.setdefault("dataQuality", {})["redfinCrossCheck"] = {
                "ranOn": time.strftime("%Y-%m-%d"),
                "route": "Redfin gis-csv active export via the direct stingray API, one call per "
                         "region (" + ", ".join(f"{lbl}={rid}" for lbl, rid, _ in REGIONS) + ")",
                "scope": "active for-sale listings in ZIPs 95672, 95667, 95682, 95619 and 95623 "
                         "plus the Shingle Springs and Placerville city regions",
                "rowsScanned": len(rows),
                "candidatesAfterFilters": len(candidates),
                "poolConfirmed": len(matches),
                "additionalMatchesFound": len(extra),
                "confirmedUnindexedListing": unindexed,
                "note": "Third independent source, run separately from the IDX feed and "
                        "MetroListPRO. Pool taken only from the structured MLS field "
                        "POOL_PRIVATE_YN of the belowTheFold API called with an explicit "
                        "propertyId, never from page text, because a Redfin listing page embeds "
                        "copy for nearby homes and it bleeds across properties. Redfin's CSV "
                        "export omits listings whose MLS forbids download, so this sweep can "
                        "corroborate the board and surface something it is missing, but its "
                        "silence is not evidence a listing is gone.",
            }
            json.dump(board, open("listings.json", "w"), indent=2)
            print("\nRecorded under dataQuality.redfinCrossCheck.")

    if "--json" in sys.argv:
        path = sys.argv[sys.argv.index("--json") + 1]
        json.dump({"matches": matches, "candidates": candidates, "halfBath": halfbath},
                  open(path, "w"), indent=1)
        print(f"\nWrote {path}")


if __name__ == "__main__":
    main()
