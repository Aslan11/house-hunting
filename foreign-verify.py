#!/usr/bin/env python3
"""Confirm the listings MetroListPRO structurally cannot cover, against Redfin's MLS field table.

Step 2 (`verify.py`) re-reads every match from MetroListPRO, the MLS of record. A listing carried
by a *different* MLS — 3538 Wildwood Ln is in BAREIS — will 404 there forever, so it reaches the
board with one confirmation instead of two. `verify.py` puts it in `source.mlsForeignSource` and
writes a card note saying the IDX feed and Redfin agree on every criterion.

That note was, when first written, a sentence rather than a finding: the Redfin `gis-csv` row this
tracker reads has no pool column, so "Redfin agrees on the pool" was asserted by nobody. This script
is what makes it true. It reads the subject-scoped MLS amenity table off the Redfin detail page —
the same `parse_detail.py` path, with the same `propertyId` gate, because a Redfin page also embeds
comparable and nearby-home payloads — and stamps the fields that actually agreed onto the listing as
`secondSource`. `build.js` renders the card note from that stamp; with no stamp the note says the
second confirmation is still owed rather than claiming one.

    python3 foreign-verify.py            # after verify.py, before build.js

Nothing is stamped for a field that disagrees: a disagreement is printed and left for the reader,
per the verification gate. Redfin answers 202 with an empty body under load; `fetch.sh` backs off.
"""
import json, os, re, subprocess, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "scripts"))
import parse_detail  # noqa: E402

TODAY = subprocess.run(["date", "-u", "+%Y-%m-%d"], capture_output=True, text=True).stdout.strip()
WORK = "work"

# Fields checked, and how the board's value and Redfin's are compared. Acreage gets a tolerance
# because the two sides round a square-foot figure differently; everything else is exact.
CHECKS = [
    ("mls", lambda b, r: str(b.get("mls")) == str(r.get("mls"))),
    ("price", lambda b, r: b.get("currentPrice") == r.get("price")),
    ("beds", lambda b, r: b.get("beds") == r.get("beds")),
    ("fullBaths", lambda b, r: float(b.get("fullBaths") or 0) == float(r.get("baths") or 0)),
    ("acres", lambda b, r: r.get("acres") is not None
        and abs(float(r["acres"]) - float(b.get("acres") or 0)) < 0.05),
    ("pool", lambda b, r: r.get("pool") is True and b.get("pool") is True),
]


def redfin_url(listing):
    """The Redfin page for this listing, resolved by MLS number through the ZIP's CSV feed.

    Never guessed from the address: Redfin's slug does not always match the MLS street name
    (6881 Sagittarius Dr lives at `6881-Sagittarius-Rd`), and a wrong URL silently serves a
    different property — the failure mode the propertyId gate downstream exists to catch.
    """
    region = {"95682": 39806, "95672": 39796, "95667": 39791}.get(str(listing.get("zip")))
    if not region:
        return None
    url = ("https://www.redfin.com/stingray/api/gis-csv?al=1&max_price=1500000&min_beds=4"
           f"&num_homes=350&ord=redfin-recommended-asc&page_number=1&region_id={region}"
           "&region_type=2&sf=1,2,3,5,6,7&status=9&uipt=1,2,3,4,5,6,7,8&v=8")
    ua = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
          "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
    csv = subprocess.run(["curl", "-sSL", "-m", "60", "-A", ua,
                          "-H", f"Referer: https://www.redfin.com/zipcode/{listing['zip']}", url],
                         capture_output=True, text=True, errors="replace").stdout
    for line in csv.splitlines():
        if str(listing.get("mls")) in line:
            m = re.search(r"(https://www\.redfin\.com/\S+?/home/\d+)", line)
            if m:
                return m.group(1)
    return None


def main():
    board = json.load(open("listings.json"))
    targets = (board.get("source") or {}).get("mlsForeignSource") or []
    by_mls = {l.get("mls"): l for l in (board.get("listings") or []) + (board.get("pending") or [])}

    if not targets:
        # Clear any stamp left by a previous run: once a listing is verifiable the ordinary way,
        # a note explaining why it could not be verified must not survive its cause.
        changed = False
        for l in by_mls.values():
            if l.pop("secondSource", None) is not None:
                changed = True
        if changed:
            json.dump(board, open("listings.json", "w"), indent=2)
        print("No foreign-MLS listings on the board; nothing to confirm.")
        return

    os.makedirs(os.path.join(WORK, "det"), exist_ok=True)
    stamped = 0
    for t in targets:
        listing = by_mls.get(t["mls"])
        if not listing:
            print(f"! {t['address']}: in mlsForeignSource but not on the board", file=sys.stderr)
            continue
        url = redfin_url(listing)
        if not url:
            print(f"! {t['address']}: no Redfin record for MLS {t['mls']} — cannot confirm; "
                  f"the card will say the second confirmation is outstanding", file=sys.stderr)
            listing.pop("secondSource", None)
            continue
        pid = url.rstrip("/").rsplit("/", 1)[-1]
        dest = os.path.join(WORK, "det", f"{pid}.html")
        subprocess.run(["scripts/fetch.sh", "detail", "/dev/stdin"], input=url + "\n",
                       capture_output=True, text=True)
        if not os.path.exists(dest) or os.path.getsize(dest) == 0:
            print(f"! {t['address']}: Redfin returned no body — cannot confirm", file=sys.stderr)
            listing.pop("secondSource", None)
            continue

        info = parse_detail.parse(dest)
        # A page whose payloads are not the subject property's is no data at all, not weak data.
        if not info.get("scopeOk"):
            print(f"! {t['address']}: Redfin payload scope check failed — discarding", file=sys.stderr)
            listing.pop("secondSource", None)
            continue

        agreed = [name for name, test in CHECKS if test(listing, info)]
        disagreed = [name for name, test in CHECKS if not test(listing, info)]
        active = bool(info.get("isActivish")) and str(info.get("status", "")).lower() != "sold"
        if disagreed:
            print(f"! {t['address']}: Redfin disagrees on {', '.join(disagreed)} "
                  f"(redfin: price={info.get('price')} beds={info.get('beds')} "
                  f"baths={info.get('baths')} acres={info.get('acres')} pool={info.get('pool')})",
                  file=sys.stderr)
        listing["secondSource"] = {
            "name": "Redfin MLS field table",
            "checkedOn": TODAY,
            "url": info.get("url") or url,
            "confirmed": agreed,
            "disagreed": disagreed,
            "status": info.get("status"),
            "activeThere": active,
            "poolFeatures": ", ".join(map(str, info.get("poolFeatures") or [])) or None,
        }
        stamped += 1
        print(f"{t['address'][:24]:24} {t['source']:8} Redfin {info.get('status')} | "
              f"confirmed: {' '.join(agreed) or 'nothing'}"
              + (f" | DISAGREES: {' '.join(disagreed)}" if disagreed else ""))

    json.dump(board, open("listings.json", "w"), indent=2)
    print(f"\nStamped secondSource on {stamped} of {len(targets)} foreign-MLS listing(s).")


if __name__ == "__main__":
    main()
