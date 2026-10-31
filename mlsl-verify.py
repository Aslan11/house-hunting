#!/usr/bin/env python3
"""Second source for foreign-MLS listings, from MLSListings.com — the fallback when Redfin won't answer.

A listing carried by an MLS other than MetroList 404s on MetroListPRO forever, so `verify.py` can
never confirm it and `foreign-verify.py` goes to Redfin instead. That route has a standing weakness:
it needs a Redfin *detail* page, and Redfin throttles those independently of `gis-csv`, answering
202 with an empty body. It stamped 0 of 2 on 2026-10-21, again on 2026-10-22, and again on
2026-10-23 — three runs where both foreign cards carried only the IDX feed's word.

MLSListings.com syndicates listings from several boards, MetroList and MAXEBRDI among them, and
serves a plain server-rendered MLS sheet per listing: status in the <title>, the structured Pool
field, price, beds, baths and lot size. It is not behind the defences Redfin's detail pages are.

    python3 foreign-verify.py        # try Redfin first — it reads the richer amenity table
    python3 mlsl-verify.py           # then this, for whatever Redfin could not confirm
    node build.js

This only ever *fills* gaps: a listing foreign-verify.py already stamped is left alone, so the
better-scoped source wins when it is available. Run it before build.js, for the same reason
foreign-verify.py runs before build.js — the card note is composed from the stamp at render time.

Scope discipline, which is the whole reason a cross-check is worth anything: the sheet is accepted
only when its <title> carries both the expected street line and the MLS number asked for. A sheet
that fails either test is discarded rather than read, because MLSListings resolves an unknown
id by serving its generic search page with HTTP 200 — the same "valid-looking page for the wrong
property" failure NETWORK.md records for Redfin's /city/<id> URLs.

Nothing is stamped for a field that disagrees; disagreements are printed and left for the reader,
per the verification gate.
"""
import json
import os
import re
import subprocess
import sys

TODAY = subprocess.run(["date", "-u", "+%Y-%m-%d"], capture_output=True, text=True).stdout.strip()
# MLSListings.com serves these property sheets to an ordinary request — measured 2026-10-27,
# `/property/ME226107286` and `/property/BE41150059` both answered 200 with the full record to
# curl's own default User-Agent. Nothing here needs a browser claim, so it does not make one.
UA = "house-hunting-tracker (+https://github.com/Aslan11/house-hunting)"
WORK = os.path.join("work", "mlsl")

# The stamp this script signs its reads with; --refresh only ever re-reads its own.
NAME = "the MLSListings.com MLS sheet"

# Board prefixes MLSListings namespaces listings under. ME is MetroList, BE is MAXEBRDI (the East
# Bay board that carries 2520 Bedford Ave), ML is MLSListings' own. Tried in order; the scope gate
# below decides which one actually answered for the property we asked about.
PREFIXES = ["ME", "BE", "ML"]

# Pool construction tokens. MetroList sheets state "Pool - Yes" / "Pool - No" outright; MAXEBRDI
# sheets give a feature list with no yes/no token and render an absent field as an en dash, so a
# construction token is what distinguishes a real pool there. "Spa/Hot Tub" alone is NOT one of
# these — a spa is not a pool, and a sheet carrying only that is left unresolved rather than
# counted either way.
POOL_TOKENS = ("in ground", "inground", "gunite", "above ground", "fiberglass",
               "vinyl", "lap pool", "infinity", "built-in")

NAMED = {"amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'", "nbsp": " ",
         "rsquo": "’", "ndash": "–", "mdash": "—"}


def unent(s):
    s = re.sub(r"&#x([0-9a-fA-F]+);", lambda m: chr(int(m.group(1), 16)), s)
    s = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), s)
    s = re.sub(r"&([a-zA-Z]+);", lambda m: NAMED.get(m.group(1).lower(), m.group(0)), s)
    return s.replace(" ", " ")


def text(s):
    return re.sub(r"\s+", " ", unent(re.sub(r"<[^>]*>", " ", s))).strip()


def fact(html, label):
    """Value of a labelled fact card. An en dash is MLSListings' empty, so it reads as absent."""
    m = re.search(r"card-title[^>]*>\s*%s\s*</p>\s*<p class=\"card-text[^>]*>([\s\S]*?)</p>"
                  % re.escape(label), html)
    v = text(m.group(1)) if m else None
    return v if v and v not in ("–", "-", "--") else None


def norm_street(s):
    """Loose enough to survive 'Rising Hill W Rd' vs 'Rising Hill Rd W', strict enough to be a gate."""
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def fetch(mls, street):
    """The MLSListings sheet for this MLS number, or None if no prefix produced the right property."""
    os.makedirs(WORK, exist_ok=True)
    want = norm_street(street)
    for pre in PREFIXES:
        url = f"https://www.mlslistings.com/property/{pre}{mls}"
        dest = os.path.join(WORK, f"{pre}{mls}.html")
        r = subprocess.run(["curl", "-sSL", "-m", "60", "-A", UA,
                            "-H", "Accept-Language: en-US,en;q=0.9", url, "-o", dest,
                            "-w", "%{http_code}"], capture_output=True, text=True)
        if r.stdout.strip() != "200" or not os.path.exists(dest) or os.path.getsize(dest) == 0:
            continue
        html = open(dest, encoding="utf-8", errors="replace").read()
        title = unent((re.search(r"<title>([^<]*)</title>", html) or [None, ""])[1])
        # Scope gate: the sheet must name this street AND this MLS number.
        if want and want not in norm_street(title):
            continue
        if str(mls) not in title:
            continue
        return {"prefix": pre, "url": url, "title": title, "html": html}
    return None


def read_sheet(sheet):
    """The fields the board checks, as MLSListings states them."""
    html, title = sheet["html"], sheet["title"]
    desc = (re.search(r'<meta name="description" content="([^"]*)"', html) or [None, ""])[1]
    desc = unent(desc)

    status = (re.search(r"\((Active|Pending|Contingent|Sold|Expired|Withdrawn|Cancelled|Canceled)\)",
                        title, re.I) or [None, None])[1]
    # \b matters: without it "Beds?" matches the "Bed" inside an address like "2520 Bedford Ave".
    beds = (re.search(r"(\d+(?:\.\d+)?)\s*Beds?\b", title, re.I) or [None, None])[1]
    baths = (re.search(r"(\d+(?:\.\d+)?)\s*Baths?\b", title, re.I) or [None, None])[1]
    price = (re.search(r"listed at \$([\d,]+)", desc) or [None, None])[1]

    lot = fact(html, "Lot Size") or ""
    acres = (re.search(r"([\d.,]+)\s*Acre", lot, re.I)
             or re.search(r"([\d.,]+)\s*Acre", html, re.I) or [None, None])[1]

    pool_field = fact(html, "Pool")
    low = (pool_field or "").lower()
    if not pool_field or "pool - no" in low:
        pool = False
    elif "pool - yes" in low or any(t in low for t in POOL_TOKENS):
        pool = True
    else:
        pool = None                      # e.g. a spa-only field: unresolved, not a denial

    def num(v):
        try:
            return float(str(v).replace(",", ""))
        except (TypeError, ValueError):
            return None

    return {"status": status, "beds": num(beds), "baths": num(baths), "price": num(price),
            "acres": num(acres), "pool": pool, "poolField": pool_field,
            "board": sheet["prefix"], "url": sheet["url"]}


# Same comparisons foreign-verify.py makes, so the two sources are held to one standard.
CHECKS = [
    ("price", lambda b, r: r.get("price") is not None and b.get("currentPrice") == r["price"]),
    ("beds", lambda b, r: r.get("beds") is not None and float(b.get("beds") or 0) == r["beds"]),
    ("fullBaths", lambda b, r: r.get("baths") is not None
        and float(b.get("fullBaths") or 0) == r["baths"]),
    ("acres", lambda b, r: r.get("acres") is not None
        and abs(r["acres"] - float(b.get("acres") or 0)) < 0.05),
    ("pool", lambda b, r: r.get("pool") is True and b.get("pool") is True),
]


def main():
    board = json.load(open("listings.json"))
    targets = (board.get("source") or {}).get("mlsForeignSource") or []
    by_mls = {l.get("mls"): l for l in (board.get("listings") or []) + (board.get("pending") or [])}

    if not targets:
        print("No foreign-MLS listings on the board; nothing to confirm.")
        return

    stamped = skipped = 0
    for t in targets:
        listing = by_mls.get(t["mls"])
        if not listing:
            print(f"! {t['address']}: in mlsForeignSource but not on the board", file=sys.stderr)
            continue
        # foreign-verify.py's Redfin read is better scoped; never overwrite one that landed.
        #
        # But "left alone" must not mean "left stale". The stamp carries the date the card
        # prints, so a stamp that is never refreshed makes the card say "read independently on
        # <two weeks ago>" on a run that did read it again — and a reader cannot tell a check
        # that was skipped from one that was made. --refresh re-reads a stamp this script wrote
        # itself; a better-scoped stamp from foreign-verify.py still wins and is never touched.
        prior = listing.get("secondSource")
        mine = (prior or {}).get("name") == NAME
        if prior and not ("--refresh" in sys.argv and mine):
            src = prior.get("name", "another source")
            stale = prior.get("checkedOn")
            note = f" (read {stale}; --refresh re-reads it)" if mine and stale != TODAY else ""
            print(f"{t['address'][:24]:24} already confirmed by {src} — left alone{note}")
            skipped += 1
            continue

        sheet = fetch(t["mls"], t["address"])
        if not sheet:
            print(f"! {t['address']}: no MLSListings sheet matched MLS {t['mls']} — cannot confirm; "
                  f"the card will say the second confirmation is outstanding", file=sys.stderr)
            continue

        r = read_sheet(sheet)
        agreed = [n for n, test in CHECKS if test(listing, r)]
        disagreed = [n for n, test in CHECKS if not test(listing, r)]
        active = str(r.get("status") or "").lower() == "active"

        if disagreed:
            print(f"! {t['address']}: MLSListings disagrees on {', '.join(disagreed)} "
                  f"(price={r.get('price')} beds={r.get('beds')} baths={r.get('baths')} "
                  f"acres={r.get('acres')} pool={r.get('pool')})", file=sys.stderr)

        listing["secondSource"] = {
            "name": NAME,
            "checkedOn": TODAY,
            "url": r["url"],
            "confirmed": agreed,
            "disagreed": disagreed,
            "status": r.get("status"),
            "activeThere": active,
            "poolFeatures": r.get("poolField"),
            "board": r.get("board"),
        }
        stamped += 1
        print(f"{t['address'][:24]:24} {t['source']:8} MLSListings {r.get('status')} "
              f"({r.get('board')}) | confirmed: {' '.join(agreed) or 'nothing'}"
              + (f" | DISAGREES: {' '.join(disagreed)}" if disagreed else ""))

    json.dump(board, open("listings.json", "w"), indent=2)
    print(f"\nStamped secondSource on {stamped} of {len(targets)} foreign-MLS listing(s)"
          + (f"; {skipped} already had one." if skipped else "."))


if __name__ == "__main__":
    main()
