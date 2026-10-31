#!/usr/bin/env python3
"""Compose the board from the MetroListPRO enumeration alone, for runs that cannot spoof a UA.

`scrape.js` (step 1 of the ordinary refresh) enumerates the Coldwell Banker IDX feed and checks
status against Redfin. Both of those hosts bot-block this environment, and the only way the python
tooling gets past them is a browser `User-Agent` it does not have — which is off limits to a run
that will not claim to be a browser. On such a run step 1 cannot run at all, and the board has
historically been left to a hand-written edit.

This is that run's path, scripted. `mls-enumerate.py` reads MetroListPRO, which answers an ordinary
request, and since 2026-10-27 it emits the two supporting tables as well as the matches. This
script turns that enumeration into the board:

    python3 mls-enumerate.py                      # writes mls-enumeration.json
    python3 mls-compose.py --foreign 41150059=Active:1275000 \
                           --foreign 226107286=Active:829000
    node build.js

What it is and is not
---------------------
MetroListPRO is the MLS of record, so for a MetroList listing this single source satisfies the
verification gate on its own: the enumeration reads `Status`, `Has a Pool` and `Lot Size in Acres`
off each detail page. It is also *complete* for MetroList — every active and pending record in the
three cities, no pagination, no server-side filter to be narrowed by.

It is structurally blind to one thing: a listing carried by a **different MLS**. Two are on the
board (2520 Bedford Ave in bridgeMLS, 3538 Wildwood Ln in BAREIS) and MetroListPRO will 404 them
forever. Those are not guessed and not carried forward silently — each needs a `--foreign` argument
naming the status and price a live record was read at this run, and the run records where. A
foreign-MLS listing with no `--foreign` argument is dropped, not assumed.

The same blindness means a *new* non-MetroList listing cannot be found by this route. That is a
real gap, it is recorded in `dataQuality.coverageGap`, and `build.js` prints it, because the point
of this repo is that the page says what the run actually covered.
"""
import json
import re
import subprocess
import sys

TODAY = subprocess.run(["date", "-u", "+%Y-%m-%d"], capture_output=True, text=True).stdout.strip()


def slug(address, city):
    return re.sub(r"[^a-z0-9]+", "-", f"{address}-{city}".lower()).strip("-")


def parse_foreign(argv):
    """--foreign <mls>=<status>:<price>, repeatable. Explicit so nothing is carried on faith."""
    out = {}
    for i, a in enumerate(argv):
        if a != "--foreign":
            continue
        try:
            mls, rest = argv[i + 1].split("=", 1)
            status, price = rest.split(":", 1)
            out[mls.strip()] = {"status": status.strip(), "price": int(price)}
        except (IndexError, ValueError):
            sys.exit(f"bad --foreign argument: {argv[i + 1] if i + 1 < len(argv) else '(missing)'}")
    return out


# "1315 Arrowbee Dr, Placerville, CA 95667 | MLS #226085035 | IDX Real Estate For Sale | …"
TITLE_RE = re.compile(r"^(.*?),\s*([^,]+),\s*CA\s*(\d{5})")


def address_of(r):
    """Street address, city and ZIP out of the detail page title.

    The enumeration keeps the page title rather than the parts, and the URL slug uppercases and
    hyphenates the street — "1315-ARROWBEE-DR" — which would reach the board as a display string.
    """
    m = TITLE_RE.match(r["title"])
    if not m:
        return r["slug"].replace("-", " ").title(), r["city"], None
    return m.group(1).strip(), m.group(2).strip(), m.group(3)


def record_to_listing(r, prev):
    """An enumeration row in the board's shape, preserving everything only the board knows."""
    address, city, zipcode = address_of(r)
    sid = slug(address, city)
    p = prev or {}
    history = list(p.get("priceHistory") or [])
    if not history or history[-1]["price"] != r["price"]:
        history.append({"date": TODAY, "price": r["price"]})
    return {
        "id": sid,
        "address": address,
        "city": city,
        "zip": zipcode or p.get("zip"),
        "mls": r["mls"],
        "mlsSource": "MetroList",
        "currentPrice": r["price"],
        "priceHistory": history,
        "beds": r["beds"],
        "baths": r["fullBaths"] + 0.5 * (r.get("halfBaths") or 0),
        "fullBaths": r["fullBaths"],
        "partialBaths": r.get("halfBaths") or None,
        "sqft": r.get("sqft"),
        "acres": r["acres"],
        "pool": True,
        "poolDetail": p.get("poolDetail") or r.get("poolDesc"),
        "yearBuilt": r.get("yearBuilt") or p.get("yearBuilt"),
        "propertyType": r.get("propertyType") or p.get("propertyType"),
        "view": r.get("view") or p.get("view"),
        "water": r.get("water") or p.get("water"),
        "sewer": r.get("sewer") or p.get("sewer"),
        "garageSpaces": p.get("garageSpaces"),
        "lat": p.get("lat"),
        "lng": p.get("lng"),
        "listedOn": p.get("listedOn"),
        "summary": r.get("summary") or p.get("summary"),
        "notes": p.get("notes"),
        # MetroListPRO photo URLs hotlink cleanly; keep the board's set if this run read none.
        "photos": r.get("photos") or p.get("photos") or [],
        "url": f'https://www.metrolistpro.com/homes/2/6/{r["slug"]}/{r["mls"]}',
        "gallery": p.get("gallery") or r.get("url"),
        "status": "match",
        "mlsStatus": r["status"],
        "firstSeen": p.get("firstSeen") or TODAY,
        "lastSeen": TODAY,
    }


def table_row(r, kind):
    address, city, _ = address_of(r)
    row = {
        "address": address, "city": city, "price": r["price"],
        "beds": r["beds"], "baths": r["fullBaths"], "fullBaths": r["fullBaths"],
        "halfBaths": r.get("halfBaths"), "acres": r["acres"], "sqft": r.get("sqft"),
        "mls": r["mls"], "status": r["status"],
        "url": f'https://www.metrolistpro.com/homes/2/6/{r["slug"]}/{r["mls"]}',
    }
    if kind == "poolless":
        row["reason"] = "MetroList records no pool"
        row["mlsPool"] = r.get("pool") or "No"
    else:
        row["pool"] = True
        row["missing"] = r["missing"]
    return row


# The IDX feed abbreviates street types ("3291 Texas Hill Rd") where MetroList writes them out
# ("3291 Texas Hill Road"). Diffing on the raw string reported every row as both gone and added
# the first time the board switched source, which reads as market movement and is not.
STREET_TYPES = {
    "road": "rd", "drive": "dr", "lane": "ln", "court": "ct", "circle": "cir",
    "street": "st", "avenue": "ave", "boulevard": "blvd", "place": "pl", "terrace": "ter",
    "way": "way", "trail": "trl", "parkway": "pkwy", "west": "w", "east": "e",
    "north": "n", "south": "s", "highway": "hwy", "mount": "mt", "saint": "st",
}


def addr_key(row):
    words = re.sub(r"[^a-z0-9 ]", " ", f'{row["address"]} {row["city"]}'.lower()).split()
    return tuple(STREET_TYPES.get(w, w) for w in words)


# The IDX feed and MetroList also name the same state differently: the feed's "For Sale" is
# MetroList's "Active", and "Contingent" is "Contingent - Show". Comparing the raw strings
# reported nine status changes on a run where nothing moved.
STATUS_ALIASES = {"for sale": "active", "active - show": "active"}


def status_key(value):
    v = re.sub(r"\s+", " ", (value or "")).strip().lower().rstrip("-").strip()
    v = STATUS_ALIASES.get(v, v)
    return v.split(" - ")[0]


def diff_tables(prev_rows, now_rows, key=addr_key, moved=frozenset()):
    """Diff two supporting tables. `moved` holds keys that changed table rather than status;
    counting those as departures would report a bookkeeping change as market movement."""
    before = {key(r): r for r in prev_rows}
    after = {key(r): r for r in now_rows}
    # build.js renders these as records, not sentences — it reads address, city, price, acres,
    # beds, fullBaths/baths, status, missing, and from/to. Emitting formatted strings printed
    # "—, —, acres, undefined full ba" on the page, so the whole row travels.
    added = [after[k] for k in after if k not in before and k not in moved]
    gone = [before[k] for k in before if k not in after and k not in moved]
    priced = [{"address": after[k]["address"], "city": after[k]["city"],
               "from": before[k]["price"], "to": after[k]["price"]}
              for k in after if k in before and before[k].get("price") != after[k].get("price")]
    status = [{"address": after[k]["address"], "city": after[k]["city"],
               "mls": after[k].get("mls"), "price": after[k].get("price"),
               "from": before[k].get("status"), "to": after[k].get("status")}
              for k in after if k in before
              and status_key(before[k].get("status")) != status_key(after[k].get("status"))]
    return added, priced, gone, status


def main():
    board = json.load(open("listings.json"))
    enum = json.load(open("mls-enumeration.json"))
    foreign_ok = parse_foreign(sys.argv)

    prev_by_mls = {l["mls"]: l for l in (board.get("listings") or []) + (board.get("pending") or [])}
    prev_matches = {l["mls"]: l for l in (board.get("listings") or [])}

    listings, pending = [], []
    for r in enum["matches"]:
        rec = record_to_listing(r, prev_by_mls.get(r["mls"]))
        (pending if not r["status"].lower().startswith("active") else listings).append(rec)

    # Foreign-MLS listings: carried only with an explicit verification from this run.
    foreign_src = (board.get("source") or {}).get("mlsForeignSource") or []
    carried_foreign, dropped_foreign = [], []
    for f in foreign_src:
        prev = prev_by_mls.get(f["mls"])
        ok = foreign_ok.get(str(f["mls"]))
        if not prev:
            continue
        if not ok:
            dropped_foreign.append(prev)
            continue
        rec = dict(prev)
        rec["mlsStatus"] = ok["status"]
        rec["lastSeen"] = TODAY
        if rec.get("currentPrice") != ok["price"]:
            rec["priceHistory"] = list(rec.get("priceHistory") or []) + \
                [{"date": TODAY, "price": ok["price"]}]
            rec["currentPrice"] = ok["price"]
        (listings if ok["status"].lower().startswith("active") else pending).append(rec)
        carried_foreign.append(rec)

    listings.sort(key=lambda l: -l["currentPrice"])
    pending.sort(key=lambda l: -l["currentPrice"])

    now_by_mls = {l["mls"]: l for l in listings + pending}
    summary = {"new": [], "priceChanges": [], "statusChanges": [], "relisted": [], "dropped": []}
    for mls, l in now_by_mls.items():
        prev = prev_by_mls.get(mls)
        if not prev:
            l["isNew"] = True
            l["newThisRun"] = True
            l["flag"] = "new"
            summary["new"].append(f'{l["address"]}, {l["city"]}')
            continue
        l.pop("isNew", None)
        l.pop("newThisRun", None)
        l["flag"] = None
        if prev.get("currentPrice") != l["currentPrice"]:
            l["flag"] = "price-change"
            summary["priceChanges"].append({
                "address": l["address"], "city": l["city"],
                "from": prev["currentPrice"], "to": l["currentPrice"]})
        if status_key(prev.get("mlsStatus")) != status_key(l.get("mlsStatus")):
            summary["statusChanges"].append({
                "address": l["address"], "city": l["city"], "mls": l.get("mls"),
                "from": prev.get("mlsStatus"), "to": l.get("mlsStatus")})

    dropped = list(board.get("dropped") or [])
    for mls, prev in prev_by_mls.items():
        if mls in now_by_mls:
            continue
        why = ("no live record read this run for a listing MetroListPRO cannot cover"
               if any(str(f["mls"]) == str(mls) for f in foreign_src)
               else "no longer in the MetroList active or pending index")
        dropped.append({"address": prev["address"], "city": prev["city"], "mls": mls,
                        "lastPrice": prev.get("currentPrice"), "firstSeen": prev.get("firstSeen"),
                        "droppedOn": TODAY, "reason": why})
        summary["dropped"].append(prev["address"])

    poolless = [table_row(r, "poolless") for r in enum.get("poolless", [])]
    near = [table_row(r, "near") for r in enum.get("nearMisses", [])]
    # Until this run the near-miss table also repeated every pool-less row, so the two tables
    # overlapped. They no longer do. A row that simply moved between them is not news.
    prev_pl, prev_nm = board.get("poolless") or [], board.get("nearMisses") or []
    crossed = ({addr_key(r) for r in prev_nm} & {addr_key(r) for r in poolless}) | \
              ({addr_key(r) for r in prev_pl} & {addr_key(r) for r in near})
    pl_add, pl_price, pl_gone, pl_status = diff_tables(prev_pl, poolless, moved=crossed)
    nm_add, nm_price, nm_gone, _ = diff_tables(prev_nm, near, moved=crossed)
    summary["poollessChanges"] = {"added": pl_add, "priceChanges": pl_price,
                                  "statusChanges": pl_status, "gone": pl_gone}
    summary["nearMissChanges"] = {"added": nm_add, "priceChanges": nm_price, "gone": nm_gone}
    summary["unchanged"] = len([l for l in listings if not l.get("flag")])

    # Only advance previousRun when the stored run is genuinely an earlier day. Re-running the
    # composer twice in one day (to correct a --foreign argument, say) used to set previousRun to
    # today as well, so the page claimed its own run as its predecessor and the "since <date>"
    # line in the banner became vacuous. Same family as the carry-forward bugs above: a field
    # that is only correct the first time it is written is a field that will go wrong.
    if board.get("lastRun") != TODAY:
        board["previousRun"] = board.get("lastRun")
    board["lastRun"] = TODAY
    board["listings"] = listings
    board["pending"] = pending
    board["poolless"] = poolless
    board["nearMisses"] = near
    board["dropped"] = dropped
    board["runSummary"] = summary

    src = board.setdefault("source", {})
    src["name"] = "MetroListPRO (MetroList MLS of record), complete city enumeration"
    src["method"] = (
        "Enumerated every active and pending residential record in the three cities from the "
        "MetroListPRO city indexes and read each detail page's Status, Has a Pool, Lot Size in "
        "Acres and full-bath fields. No User-Agent spoofing: MetroListPRO answers an ordinary "
        "request, which is why this route is available to every run. Listings on another MLS "
        "were each confirmed against a live record named in foreignVerifiedBy.")
    src["inventoryScanned"] = enum["activeRecords"] + enum["pendingRecords"]
    # Same carry-forward as passedBedsBathsPrice, two keys over: these were written by whatever
    # ran before and were republished beside this run's inventoryScanned, so the three numbers
    # described two different runs and did not add up.
    src["activeScanned"] = enum["activeRecords"]
    src["pendingScanned"] = enum["pendingRecords"]
    # Prose describing one specific run must not survive into the next one. Each of these says
    # what a named run did; carried forward silently it becomes this run's claim about itself.
    # Dropping them forces a run to restate what it actually did or leave the field empty.
    src.pop("thisRunMethod", None)
    board.get("dataQuality", {}).pop("note", None)
    board.get("dataQuality", {}).pop("independentRerun", None)
    # The page prints this as "N cleared beds/baths/price". Carried over unchanged it reported
    # the previous run's funnel against this run's totals.
    src["passedBedsBathsPrice"] = enum.get("passedBedsBathsPrice")
    src["mlsVerifiedOn"] = TODAY
    # Only the records MetroListPRO actually answered for. Counting the foreign-MLS pair here
    # printed "7 agreed, checked today" one sentence before the page explained that two of the
    # seven are ones MetroListPRO has no record of and never will.
    foreign_mls_numbers = {str(f["mls"]) for f in foreign_src}
    src["mlsVerifiedCount"] = len([l for l in listings + pending
                                   if str(l.get("mls")) not in foreign_mls_numbers])
    src["foreignVerifiedBy"] = foreign_ok

    board.setdefault("dataQuality", {})["verifiedActiveListings"] = len(listings)
    board["dataQuality"]["coverageGap"] = (
        "This step enumerated MetroList only, so a listing carried by another MLS that is not "
        "already tracked could not have been found here. Both known foreign-MLS listings were "
        "re-read individually. Since 2026-10-31 this gap is closable without a spoofed "
        "User-Agent: run `python3 cb-crosscheck.py --stamp` after this composer — the Coldwell "
        "Banker IDX answers a plain request and, unlike the MetroList mirrors, carries other "
        "boards. If it ran, it overwrites this note with what it found."
        if foreign_src else "")

    json.dump(board, open("listings.json", "w"), indent=2)
    print(f'{len(listings)} active matches, {len(pending)} pending, '
          f'{len(summary["new"])} new, {len(summary["priceChanges"])} price changes, '
          f'{len(summary["dropped"])} dropped, {len(poolless)} pool-less, {len(near)} near misses.')
    for k in ("new", "priceChanges", "statusChanges", "dropped"):
        for item in summary[k]:
            print(f"  {k}: {item if isinstance(item, str) else json.dumps(item)}")


if __name__ == "__main__":
    main()
