#!/usr/bin/env python3
"""
Coldwell Banker IDX cross-check — a second enumeration that needs no User-Agent spoof
and, unlike every other plain-request source this repo has found, is NOT MetroList-only.

Why this exists
---------------
`dataQuality.coverageGap` has recorded the same hole since the no-spoof route came in on
2026-10-27: MetroListPRO is the MLS of record *and* it enumerates, but it is structurally blind
to a listing on another MLS, so a **new** foreign-MLS listing could not be found at all. The
three mirrors in README "Three more hosts answer a plain request" all republish MetroList only,
so none of them closed it.

`www.coldwellbanker.com` does. Measured 2026-10-31: it answers curl's default User-Agent with
HTTP 200, serves complete city inventory, and carries records from other boards — both known
foreign listings appear in it (2520 Bedford Ave under a `CRMLS` photo bucket, 3538 Wildwood Ln
under `CABAREIS`), the latter being a listing MetroListPRO has still never indexed.

So this is the missing step 1 without the spoof. It is a CROSS-CHECK, not the board: the gate is
unchanged and MetroListPRO still speaks for the MLS of record. See the stale-record caveat below.

How it reads
------------
Each city page embeds `<script id="__NEXT_DATA__">` with
`props.pageProps.propertiesData.properties[]`, carrying per listing: `markerPrice`, `beds`,
`baths`, `squareFeet`, `mlsId`, `standardStatus`, `daysOnMarket`, `officeName`,
`photos[].mediaUrl` and `propertyDetailsRoutePath`. Page with `?page=N`, 32 per page, until no
new records. Each detail page carries
`rawPropertyDetails.property.characteristics.lotSizeAcres` (structured) and
`propertyDetails.about.description` (the agent's public remarks).

Four traps, all of them this repo's own lessons arriving at a new host
---------------------------------------------------------------------
1. **`price` is a formatted string** (`"$1,275,000"`); the number is `markerPrice`. A numeric
   filter on `price` throws and silently drops every row — it returned 0 candidates out of 406
   the first time this was run.

2. **`baths` is full + half combined and cannot be decomposed**, exactly as README "Half baths"
   and `redfin-csv.py`'s `BATHS` note record. 1234 Rising Hill W Road reads `3` here and is
   2 full + 1 half on the MLS — it is on the board's `nearMisses` for precisely that reason.
   So this script does NOT decide the 3-full-bath minimum: it flags rows it cannot resolve and
   leaves the full-bath count to the MetroList/MLSListings field the board uses.

3. **There is no structured pool field.** Pool presence is only in the agent's free text, so a
   hit here is a CANDIDATE to confirm, never a determination. Unlike a Redfin listing page there
   is no comparable-homes payload, so the text is correctly scoped to the subject property —
   but the prose still lies in both directions:
     - false positive: 1777 Carl Rd reads "…build an ADU, or *add a pool* or barn" — no pool.
     - false negative: a pool can go unmentioned, so rows WITHOUT "pool" are re-scanned for
       `spa|hot tub|swim|water feature|waterfall|resort` and reported for review. 4810 Robledo Dr
       is the one that hits, and its "waterfall" is decorative ponds and its "spa bath" a
       bathroom — correctly not a pool.

4. **This feed carries stale records.** 3784 Cattle Drive (MLS 226092223) reads ACTIVE at
   $1,050,000 here with 101 days on market and is absent from both MetroListPRO's Shingle Springs
   index and the MLS-keyed realgeeks mirror, while a control (4071 Voyager Way) resolves at both.
   That is a departure, not mirror silence, per README "A 404 from a listing's own board is a
   departure" — the number is a MetroList number and MetroListPRO is its own board. The MLS of
   record wins and the row is stale. Recorded in `rejected`.

   The direction that proves something is therefore the usual one: a candidate this feed has that
   the board lacks is worth an MLS read. The reverse proves nothing.

Usage
-----
    python3 cb-crosscheck.py              # sweep, filter, diff against listings.json
    python3 cb-crosscheck.py --stamp      # also write dataQuality.idxCrossCheck for build.js

`--stamp` refuses to write if the sweep came back under 250 rows or any city failed to parse, so
a truncated sweep cannot publish a completeness claim — same guard as `mls-enumerate.py --stamp`
and `redfin-csv.py --stamp`.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time

BASE = "https://www.coldwellbanker.com"
CITIES = ["shingle-springs", "rescue", "placerville"]
TARGET = {"shingle springs", "rescue", "placerville"}
HERE = os.path.dirname(os.path.abspath(__file__))

MIN_BEDS = 4
MIN_BATHS = 3          # combined here; the full-bath minimum is left to the MLS
MAX_PRICE = 1_500_000
MIN_ACRES = 2.5
MIN_ROWS_TO_STAMP = 250

POOL_RE = re.compile(r"\bpool\b", re.I)
# "room to add a pool", "could add a pool", "add a pool or barn" -> not a pool
NEGATED_RE = re.compile(r"\b(?:add|adding|install|build|room for|space for)\b[^.]{0,40}\bpool\b", re.I)
WATER_CUE_RE = re.compile(r"\b(?:spa|hot tub|swim|water feature|waterfall|resort)\b", re.I)
NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json"[^>]*>(.*?)</script>', re.S)


def get(url, dest, tries=3):
    """Plain request — no User-Agent spoof. That is the point of this route."""
    for attempt in range(tries):
        r = subprocess.run(["curl", "-sS", "-m", "90", "-o", dest, "-w", "%{http_code}", url],
                           capture_output=True, text=True)
        if r.stdout.strip() == "200" and os.path.getsize(dest) > 40_000:
            return True
        time.sleep(2 * (attempt + 1))
    return False


def next_data(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        m = NEXT_DATA_RE.search(fh.read())
    return json.loads(m.group(1)) if m else None


def num(v):
    if v is None:
        return None
    s = re.sub(r"[^0-9.]", "", str(v))
    try:
        return float(s) if s else None
    except ValueError:
        return None


def city_of(rec):
    m = re.search(r",\s*([^,]+),\s*CA", rec.get("propertyAddress") or "")
    return m.group(1).strip().lower() if m else ""


def enumerate_cities(workdir):
    """Every record the three city indexes list, paged to exhaustion."""
    records, failures = {}, []
    for city in CITIES:
        page, reported = 1, None
        while page <= 15:
            url = f"{BASE}/city/ca/{city}" + (f"?page={page}" if page > 1 else "")
            dest = os.path.join(workdir, f"cb_{city}_{page}.html")
            if not get(url, dest):
                failures.append(f"{city} page {page}: fetch failed")
                break
            data = next_data(dest)
            if data is None:
                failures.append(f"{city} page {page}: no __NEXT_DATA__")
                break
            pdata = data["props"]["pageProps"].get("propertiesData", {}) or {}
            props = pdata.get("properties", []) or []
            if reported is None:
                reported = pdata.get("totalProperties") or pdata.get("total")
            added = 0
            for p in props:
                key = p.get("mlsId") or p.get("propertyAddress")
                if key and key not in records:
                    records[key] = p
                    added += 1
            if not props or added == 0:
                break
            page += 1
        print(f"  {city:<16} {reported} reported", flush=True)
    return records, failures


def detail(rec, workdir):
    """Structured acreage plus the agent's remarks for one listing."""
    path = rec.get("propertyDetailsRoutePath")
    if not path:
        return None, None
    dest = os.path.join(workdir, "d_" + re.sub(r"[^A-Za-z0-9]+", "_", path)[-70:] + ".html")
    if not (os.path.exists(dest) and os.path.getsize(dest) > 40_000):
        if not get(BASE + path, dest):
            return None, None
    data = next_data(dest)
    if data is None:
        return None, None
    pp = data["props"]["pageProps"]
    raw = (pp.get("rawPropertyDetails", {}) or {}).get("property", {}) or {}
    pd = pp.get("propertyDetails", {}) or {}
    acres = num((raw.get("characteristics", {}) or {}).get("lotSizeAcres")
                or (pd.get("lot", {}) or {}).get("lotSizeAcres"))
    desc = (pd.get("about", {}) or {}).get("description") or ""
    return acres, desc


def pool_verdict(desc):
    """'yes' / 'negated' / 'cue' / 'no' — a candidate signal, never a determination."""
    if not desc:
        return "no"
    sentences = [s for s in re.split(r"(?<=\.)\s+", desc) if POOL_RE.search(s)]
    if sentences:
        if all(NEGATED_RE.search(s) for s in sentences):
            return "negated"
        return "yes"
    return "cue" if WATER_CUE_RE.search(desc) else "no"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stamp", action="store_true",
                    help="record dataQuality.idxCrossCheck in listings.json")
    ap.add_argument("--workdir", default=os.path.join(HERE, "work", "cb"))
    args = ap.parse_args()
    os.makedirs(args.workdir, exist_ok=True)

    print("Enumerating Coldwell Banker IDX (plain request, no UA spoof):")
    records, failures = enumerate_cities(args.workdir)
    print(f"\n{len(records)} unique records across the three city indexes.")
    if failures:
        print("  parse/fetch failures:")
        for f in failures:
            print("   ", f)

    board = json.load(open(os.path.join(HERE, "listings.json")))
    tracked = {str(l.get("mls")) for l in board.get("listings", [])}
    for key in ("pending", "poolless", "nearMisses", "rejected", "relisted", "dropped"):
        for row in board.get(key, []) or []:
            if isinstance(row, dict) and row.get("mls"):
                tracked.add(str(row["mls"]))
    rejected_addrs = {(r.get("address") or "").lower()
                      for r in board.get("rejected", []) or []}

    # beds / price / status / city / type gate. Baths uses the combined count deliberately:
    # a row at or above 3 combined is a candidate, and the full-bath call is the MLS's.
    candidates = []
    for rec in records.values():
        if city_of(rec) not in TARGET:
            continue
        if rec.get("propertyTypeValue") != "Single Family":
            continue
        if rec.get("standardStatus") != "ACTIVE":
            continue
        beds, baths = num(rec.get("beds")), num(rec.get("baths"))
        price = num(rec.get("markerPrice"))     # NOT `price` — see docstring trap 1
        if None in (beds, baths, price):
            continue
        if beds >= MIN_BEDS and baths >= MIN_BATHS and 0 < price <= MAX_PRICE:
            candidates.append(rec)

    print(f"{len(candidates)} active single-family rows clear beds/baths/price in the three cities."
          f"\nReading each detail page for structured acreage and remarks:\n")

    pool_hits, review, unresolved_baths = [], [], []
    for rec in sorted(candidates, key=lambda r: -(num(r.get("markerPrice")) or 0)):
        acres, desc = detail(rec, args.workdir)
        if acres is None:
            review.append((rec, None, "acreage unreadable — read by hand"))
            continue
        if acres < MIN_ACRES:
            continue
        verdict = pool_verdict(desc)
        addr = rec.get("propertyAddress")
        mls = str(rec.get("mlsId"))
        price = num(rec.get("markerPrice"))
        baths = num(rec.get("baths"))
        if baths != int(baths):
            unresolved_baths.append(addr)
        if verdict == "yes":
            pool_hits.append({"mls": mls, "address": addr, "price": price,
                              "beds": rec.get("beds"), "bathsCombined": rec.get("baths"),
                              "acres": acres, "daysOnMarket": rec.get("daysOnMarket"),
                              "office": rec.get("officeName"),
                              "onBoard": mls in tracked,
                              "url": BASE + (rec.get("propertyDetailsRoutePath") or "")})
        elif verdict in ("negated", "cue"):
            review.append((rec, acres,
                           "remarks mention adding a pool, not having one" if verdict == "negated"
                           else "no 'pool' in remarks but water/resort wording present"))

    print(f"{len(pool_hits)} rows clear acreage AND read as having a pool:\n")
    missing = []
    for h in pool_hits:
        mark = "on board  " if h["onBoard"] else "NOT ON BOARD"
        print(f'  {mark} MLS {h["mls"]:<10} ${h["price"]:>9,.0f} {h["beds"]}bd '
              f'{h["bathsCombined"]}ba(comb) {h["acres"]:>6}ac dom={h["daysOnMarket"]:<4} '
              f'{h["address"]}')
        if not h["onBoard"]:
            already = any(h["address"].split(",")[0].lower() in a for a in rejected_addrs)
            missing.append(dict(h, previouslyRejected=already))

    if review:
        print("\nFlagged for human review (pool wording, not a determination):")
        for rec, acres, why in review:
            print(f'  MLS {rec.get("mlsId"):<10} {str(acres):>7}ac  {rec.get("propertyAddress")}'
                  f'\n      {why}')

    if unresolved_baths:
        print("\nCombined bath count is fractional — full-bath minimum left to the MLS:")
        for a in unresolved_baths:
            print("  ", a)

    print()
    if missing:
        print(f"** {len(missing)} candidate(s) this feed has that the board does not: **")
        for m in missing:
            tail = " (already in `rejected`)" if m["previouslyRejected"] else \
                   "  <-- needs a MetroListPRO / MLSListings read before it can join the board"
            print(f'   MLS {m["mls"]} {m["address"]} ${m["price"]:,.0f}{tail}')
        print("\n   Per the verification gate, none of these joins the board on this feed's word.")
    else:
        print("Nothing this feed carries is missing from the board.")

    if args.stamp:
        if failures:
            print("\nRefusing to stamp: a city index failed to fetch or parse.")
            return 1
        if len(records) < MIN_ROWS_TO_STAMP:
            print(f"\nRefusing to stamp: sweep returned {len(records)} rows, "
                  f"under the {MIN_ROWS_TO_STAMP} floor.")
            return 1
        board.setdefault("dataQuality", {})["idxCrossCheck"] = {
            "ranOn": time.strftime("%Y-%m-%d"),
            "source": "Coldwell Banker IDX (coldwellbanker.com), plain request, no UA spoof",
            "rowsScanned": len(records),
            "clearedBedsBathsPrice": len(candidates),
            "poolAndAcreageHits": len(pool_hits),
            "missingFromBoard": [{"mls": m["mls"], "address": m["address"],
                                  "price": m["price"]} for m in missing],
            "note": ("Carries non-MetroList boards, so unlike the MetroList mirrors it can see a "
                     "new foreign-MLS listing. Pool is read from agent remarks and reviewed by "
                     "hand; combined baths cannot resolve the 3-full-bath minimum; and this feed "
                     "carries stale ACTIVE rows, so the MLS of record still decides."),
        }
        # The script that closes the gap is the one that gets to say it is closed. mls-compose.py
        # runs first and cannot know whether this ever ran, so it writes the open form and names
        # this route; overwrite it here, with the numbers that justify the claim.
        if board["dataQuality"].get("coverageGap"):
            board["dataQuality"]["coverageGap"] = (
                f"Closed for this run. MetroListPRO enumerates MetroList only, so it is blind to a "
                f"new listing on another MLS. The Coldwell Banker IDX cross-check "
                f"(cb-crosscheck.py, plain request, no User-Agent spoof) carries other boards — it "
                f"sees both known foreign listings, including 3538 Wildwood Ln, which "
                f"MetroListPRO has never indexed — and it swept {len(records)} records across the "
                f"three cities this run, finding "
                + (f"{len(missing)} candidate(s) the board did not already track."
                   if missing else "no qualifying candidate the board did not already track.")
                + " It is a cross-check, not the board: it has no structured pool field, its bath "
                  "count cannot resolve the 3-full-bath minimum, and it carries stale ACTIVE "
                  "rows, so the MLS of record still decides every promotion.")
        with open(os.path.join(HERE, "listings.json"), "w") as fh:
            json.dump(board, fh, indent=2)
            fh.write("\n")
        print(f"\nStamped dataQuality.idxCrossCheck ({len(records)} rows).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
