#!/usr/bin/env python3
"""
Independent second enumeration straight from the MLS of record.

`scrape.js` enumerates the Coldwell Banker IDX feed, which republishes MetroList. This script
enumerates **MetroListPRO** itself — the official MetroList search site — and applies the same
criteria to the same fields, so a listing the IDX feed never carried has a way of being found.

That is the specific failure this guards: every other check in the repo confirms or contradicts a
property the IDX feed already surfaced. None of them can see a property the feed omitted. The
2026-08-26 run established the feed is meaningfully narrower than the MLS (358 active records
against the feed's 296), so the gap is real even though that run found nothing qualifying in it.

MetroListPRO serves server-rendered city indexes with no pagination — the whole city on one page:

    active   https://www.metrolistpro.com/lbc/2/<cityId>/6/193/<City-Name>-Real-Estate-For-Sale
    pending  https://www.metrolistpro.com/lbc/2/<cityId>/6/193/<City-Name>-Real-Estate-Pending-Sale?pending=1

Each links `/homes/2/6/<SLUG>/<MLS>`. Slugs beginning `0-` are vacant land and are skipped — they
carry no beds, baths or pool and would only waste fetches.

Run:  python3 mls-enumerate.py          # writes mls-enumeration.json, never touches listings.json
      python3 mls-enumerate.py --stamp  # also records the result under dataQuality.independentEnumeration

This is a cross-check, not the board. It cannot promote anything on its own: a property it finds
that the board lacks is a finding to investigate and verify, not a row to publish.
"""
import re
import json
import sys
import subprocess
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

COUNTY = "193"
CITIES = {  # MetroListPRO city ids for the target area
    "Placerville": ("720", "Placerville"),
    "Shingle Springs": ("873", "Shingle-Springs"),
    "Rescue": ("765", "Rescue"),
}


def get(url, tries=3):
    for attempt in range(tries):
        r = subprocess.run(["curl", "-sSL", "-m", "45", "-A", UA, url],
                           capture_output=True, text=True, errors="replace")
        # A short body is MetroListPRO shedding load, not an empty city. Back off and retry
        # rather than recording the city as having no inventory.
        if len(r.stdout) > 3000:
            return r.stdout
        subprocess.run(["sleep", str(2 * (attempt + 1))])
    return r.stdout


def text_of(html):
    t = re.sub(r"<script.*?</script>", " ", html, flags=re.S)
    t = re.sub(r"<style.*?</style>", " ", t, flags=re.S)
    title = (re.findall(r"<title>([^<]*)</title>", html) or [""])[0]
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"&nbsp;", " ", t)
    return title, re.sub(r"\s+", " ", t)


def field(t, name, pat=r"([^:]+?)(?=\s+[A-Z][A-Za-z./ ]{2,}:|$)"):
    m = re.search(re.escape(name) + r":\s*" + pat, t)
    return m.group(1).strip() if m else None


def index_records(city, city_id, slug, pending=False):
    """Every MLS record MetroListPRO lists for a city, land excluded."""
    if pending:
        url = (f"https://www.metrolistpro.com/lbc/2/{city_id}/6/{COUNTY}/"
               f"{slug}-Real-Estate-Pending-Sale?pending=1")
    else:
        url = (f"https://www.metrolistpro.com/lbc/2/{city_id}/6/{COUNTY}/"
               f"{slug}-Real-Estate-For-Sale")
    html = get(url)
    out, land = {}, 0
    for path in sorted(set(re.findall(r'/homes/2/6/([^/"\']+/\d+)', html))):
        addr_slug, mls = path.rsplit("/", 1)
        if addr_slug.startswith("0-"):       # vacant land
            land += 1
            continue
        out[mls] = {"mls": mls, "city": city, "slug": addr_slug,
                    "section": "pending" if pending else "active"}
    return out, land


def detail(rec):
    url = f"https://www.metrolistpro.com/homes/2/6/x/{rec['mls']}"
    title, t = text_of(get(url))
    r = dict(rec, url=url, title=title)
    hdr = re.search(r"\$([\d,]+)\s*\(([^)]*)\)\s*Bedrooms:\s*(\d+)\s*Bathrooms:\s*(\d+)"
                    r"(?:\s*\|\s*(\d+))?\s*Sq\. Ft\.:\s*([\d,]+)", t)
    if hdr:
        r.update(price=int(hdr.group(1).replace(",", "")),
                 saleState=hdr.group(2).strip(),
                 beds=int(hdr.group(3)),
                 fullBaths=int(hdr.group(4)),
                 halfBaths=int(hdr.group(5) or 0),
                 sqft=int(hdr.group(6).replace(",", "")))
    else:
        # No whole-home bed/bath header. That is normal for three property types and does NOT
        # mean the page failed to parse — conflating the two is what made a first pass report
        # 122 "unreadable" records, none of which was a house. Classify instead of discarding:
        # land and commercial can never match, while residential income carries beds only
        # per unit and needs a human read (see README, 1781 Springvale Rd).
        price = re.search(r"\$([\d,]+)\s*\(([^)]*)\)", t)
        if price:
            r.update(price=int(price.group(1).replace(",", "")),
                     saleState=price.group(2).strip())
    # The header's own `Type:` — distinct from the field table's `Property Type:`, which land and
    # commercial records don't carry at all. Land reads "Lots / Land", commercial "Commercial",
    # a house "House".
    ty = re.search(r"(?<!Property )Type:\s*([A-Za-z][A-Za-z/ ]*?)"
                   r"(?=\s+(?:Virtual Tour|Save To)|\s+[A-Z][A-Za-z./ ]{2,}:|$)", t)
    r["headerType"] = ty.group(1).strip() if ty else None
    r["status"] = field(t, "Status")
    r["pool"] = field(t, "Has a Pool")
    r["poolDesc"] = field(t, "Pool Description")
    r["propertyType"] = field(t, "Property Type") or r.get("headerType")
    # The unit table is not guaranteed to start at "Unit 1" — records exist whose first entry is
    # "Unit 2" or "Unit 3" — so match any unit index, and fall back to the type fields, which
    # spell this out as "Multi-Unit Residential" in the header and the code "RI" in the table.
    r["multiUnit"] = bool(re.search(r"Unit \d+ Features:\s*Bedrooms:", t)
                          or re.match(r"^RI$", (r.get("propertyType") or "").strip())
                          or re.search(r"multi-unit", r.get("headerType") or "", re.I))
    acres = field(t, "Lot Size in Acres")
    try:
        r["acres"] = float(acres)
    except (TypeError, ValueError):
        r["acres"] = None
    return r


# Property types that cannot satisfy the criteria no matter what the rest of the record says.
# Both spellings have to be here: the page header carries a readable "Lots / Land" while the
# field table carries the MLS code "LL" for the same record, and the field table wins in
# `propertyType`, so matching only the readable form classifies every one of them as unreadable.
NON_RESIDENTIAL = re.compile(r"^(?:LL|COM)$|lots?\s*/?\s*land|commercial|business", re.I)


def classify(r):
    """'residential' | 'non-residential' | 'multi-unit' | 'unreadable'.

    Only 'unreadable' is a parser failure. The other three are real answers, and keeping them
    apart is the point: a run that calls 91 land parcels unreadable cannot tell whether it
    missed a house.
    """
    if r.get("beds") is not None:
        return "residential"
    if r.get("multiUnit"):
        return "multi-unit"
    for key in ("headerType", "propertyType"):
        if r.get(key) and NON_RESIDENTIAL.search(r[key].strip()):
            return "non-residential"
    return "unreadable"


def qualifies(r, c):
    """The hard criteria, read off MLS fields. Half baths never count — see README."""
    return (r.get("beds") is not None and r["beds"] >= c["beds"]
            and r.get("fullBaths") is not None and r["fullBaths"] >= c["fullBaths"]
            and r.get("acres") is not None and r["acres"] >= c["minAcres"]
            and r.get("price") is not None and r["price"] <= c["maxPrice"]
            and r.get("pool") == "Yes")


def main():
    board = json.load(open("listings.json"))
    bc = board["criteria"]
    crit = {
        "beds": int(re.match(r"\d+", str(bc["beds"])).group()),
        "fullBaths": int(re.match(r"\d+", str(bc.get("fullBaths", bc.get("baths")))).group()),
        "minAcres": bc["minAcres"],
        "maxPrice": bc["maxPrice"],
    }

    records, land_skipped = {}, 0
    for city, (city_id, slug) in CITIES.items():
        for pending in (False, True):
            got, land = index_records(city, city_id, slug, pending)
            land_skipped += land
            # An active record also appearing on the pending index is pending; the pending
            # pass runs second so it wins.
            records.update(got)
            print(f"  {city:16} {'pending' if pending else 'active ':7} "
                  f"{len(got):4} records ({land} land skipped)", file=sys.stderr)

    n_active = sum(1 for r in records.values() if r["section"] == "active")
    n_pending = sum(1 for r in records.values() if r["section"] == "pending")
    print(f"\n{len(records)} residential MLS records across the three cities "
          f"({n_active} active, {n_pending} pending); {land_skipped} land listings skipped.\n",
          file=sys.stderr)

    with ThreadPoolExecutor(max_workers=8) as ex:
        rows = list(ex.map(detail, records.values()))

    for r in rows:
        r["kind"] = classify(r)
    kinds = Counter(r["kind"] for r in rows)
    unread = [r["mls"] for r in rows if r["kind"] == "unreadable"]

    matches = [r for r in rows if qualifies(r, crit)]

    # Multi-unit records state beds per unit, so the filter above can't see them. Surface any
    # that clear the lot and pool tests — a person can read the unit table; the script can't.
    multi = [r for r in rows if r["kind"] == "multi-unit"
             and r.get("pool") == "Yes"
             and r.get("acres") is not None and r["acres"] >= crit["minAcres"]
             and r.get("price") is not None and r["price"] <= crit["maxPrice"]]

    tracked = {l.get("mls") for l in (board.get("listings") or [])
               + (board.get("pending") or []) + (board.get("dropped") or [])}
    new = [r for r in matches if r["mls"] not in tracked]

    print(f'\n{kinds["residential"]} single-family records read; '
          f'{kinds["non-residential"]} land/commercial and {kinds["multi-unit"]} multi-unit '
          f'excluded by type; {kinds["unreadable"]} unreadable.\n', file=sys.stderr)

    for r in sorted(matches, key=lambda r: -r["price"]):
        mark = "NEW " if r["mls"] not in tracked else "on board "
        print(f'{mark:10} MLS{r["mls"]} {r["title"][:44]:44} ${r["price"]:>9,} '
              f'{r["beds"]}bd {r["fullBaths"]}fba {r["acres"]}ac pool={r["pool"]} '
              f'status={r["status"]}')

    print(f"\n{len(matches)} records met every criterion; {len(new)} not already tracked.")
    for r in multi:
        print(f'  multi-unit, needs a human read: MLS{r["mls"]} {r["title"][:40]} '
              f'${r["price"]:,} {r["acres"]}ac pool={r["pool"]}')
    if unread:
        print(f"WARNING: {len(unread)} detail pages did not parse: {', '.join(unread[:10])}",
              file=sys.stderr)

    json.dump({"ranOn": subprocess.run(["date", "-u", "+%Y-%m-%d"], capture_output=True,
                                       text=True).stdout.strip(),
               "activeRecords": n_active, "pendingRecords": n_pending,
               "landSkipped": land_skipped, "kinds": dict(kinds), "unreadable": unread,
               "matches": matches, "newBeyondBoard": new, "multiUnitToReview": multi},
              open("mls-enumeration.json", "w"), indent=1)

    if "--stamp" in sys.argv:
        # Only a run that read every record it enumerated may claim to have covered the city.
        if unread:
            print("Not stamping: some detail pages did not parse, so this enumeration is "
                  "incomplete.", file=sys.stderr)
            return
        board.setdefault("dataQuality", {})["independentEnumeration"] = {
            "ranOn": subprocess.run(["date", "-u", "+%Y-%m-%d"], capture_output=True,
                                    text=True).stdout.strip(),
            "source": "MetroListPRO city indexes (the MLS of record)",
            "activeRecords": n_active,
            "pendingRecords": n_pending,
            "recordsPulledBeyondIdxSweep": len(rows),
            "singleFamilyRead": kinds["residential"],
            "excludedByType": kinds["non-residential"] + kinds["multi-unit"],
            "additionalMatchesFound": len(new),
        }
        json.dump(board, open("listings.json", "w"), indent=2)
        print("Recorded under dataQuality.independentEnumeration.")


if __name__ == "__main__":
    main()
