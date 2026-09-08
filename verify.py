#!/usr/bin/env python3
"""Independently verify each match against MetroListPRO, the official MetroList MLS search site."""
import re, json, subprocess, sys
from datetime import date
from concurrent.futures import ThreadPoolExecutor

TODAY = subprocess.run(["date", "-u", "+%Y-%m-%d"], capture_output=True, text=True).stdout.strip()

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


def text_of(url):
    h = subprocess.run(["curl", "-sSL", "-m", "45", "-A", UA, url],
                       capture_output=True, text=True, errors="replace").stdout
    t = re.sub(r"<script.*?</script>", " ", h, flags=re.S)
    t = re.sub(r"<style.*?</style>", " ", t, flags=re.S)
    title = (re.findall(r"<title>([^<]*)</title>", h) or [""])[0]
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"&nbsp;", " ", t)
    return title, re.sub(r"\s+", " ", t)


def field(t, name, pat=r"([^:]+?)(?=\s+[A-Z][A-Za-z./ ]{2,}:|$)"):
    m = re.search(re.escape(name) + r":\s*" + pat, t)
    return m.group(1).strip() if m else None


def verify(r):
    url = f"https://www.metrolistpro.com/homes/2/6/x/{r['mls']}"
    title, t = text_of(url)
    hdr = re.search(r"\$([\d,]+)\s*\(([^)]*)\)\s*Bedrooms:\s*(\d+)\s*Bathrooms:\s*(\d+)(?:\s*\|\s*(\d+))?"
                    r"\s*Sq\. Ft\.:\s*([\d,]+)", t)
    out = {"mls": r["mls"], "address": r["address"], "mlUrl": url, "mlTitle": title}
    if hdr:
        out.update({
            "mlPrice": int(hdr.group(1).replace(",", "")),
            "mlSaleState": hdr.group(2).strip(),
            "mlBeds": int(hdr.group(3)),
            "mlFullBaths": int(hdr.group(4)),
            "mlHalfBaths": int(hdr.group(5) or 0),
            "mlSqft": int(hdr.group(6).replace(",", "")),
        })
    # A record MetroListPRO has not indexed yet answers 404 with a "Listing #N Not Found" body.
    # That is not the MLS contradicting the listing — it is the MLS not having heard of it, which
    # is the normal state of a listing that went live today. Kept distinct from a disagreement
    # below, because the two call for opposite responses: one is a caveat, the other is a veto.
    out["mlNotIndexed"] = bool(re.search(r"Listing\s*#?\s*\d+\s*Not Found", t))
    out["mlStatus"] = field(t, "Status")
    out["mlAcres"] = field(t, "Lot Size in Acres")
    out["mlPool"] = field(t, "Has a Pool")
    out["mlPoolDesc"] = field(t, "Pool Description")
    out["mlYear"] = field(t, "Year Built")
    out["mlAPN"] = field(t, "APN")
    out["mlCity"] = "Placerville" if "Placerville" in title else (
        "Rescue" if "Rescue" in title else ("Shingle Springs" if "Shingle Springs" in title else "?"))
    return out


rows = json.load(open("matches.json"))
# Read once, before anything writes: this is where a record already awaiting indexing carries
# the date it started waiting.
prior_awaiting = {a["mls"]: a for a in
                  (json.load(open("listings.json")).get("source", {}).get("mlsAwaitingIndex") or [])}
with ThreadPoolExecutor(max_workers=5) as ex:
    res = list(ex.map(verify, rows))
json.dump(res, open("verified.json", "w"), indent=1)

def metrolist_sourced(r):
    """Is this record even MetroList's to carry?

    The IDX site republishes several MLSs. A listing whose `Source` is another one will answer
    404 on MetroListPRO forever, because MetroList never had it — that is not an indexing delay
    and no amount of waiting resolves it. Treated as "awaiting index" it produced a note that
    told the reader a listing had been missing for twelve days and to call the agent about it,
    when the record was exactly where it belonged, in a different MLS. An unknown source stays
    in the awaiting bucket: absence of the field is not evidence of a foreign feed.
    """
    src = (r.get("mlsSource") or "").strip()
    return not src or "metrolist" in src.lower()


clean = 0
awaiting = []   # in the feed, not yet in the MLS index — a caveat on the card
foreign = []    # in a different MLS entirely — MetroListPRO can never confirm it
disagreed = []  # the MLS says something different — the gate's veto
for v, r in zip(res, rows):
    if v.get("mlNotIndexed") and not metrolist_sourced(r):
        foreign.append({"mls": r["mls"], "address": r["address"], "city": r["city"],
                        "source": r["mlsSource"].strip()})
        print(f'{r["address"][:24]:24} MLS{r["mls"]} listed in {r["mlsSource"].strip()}, not '
              f'MetroList — MetroListPRO cannot confirm it; verified against other sources')
        continue
    if v.get("mlNotIndexed"):
        # Carry the date this record was FIRST seen unindexed, so the card can say how long it
        # has been waiting. "Too new for the MLS to carry" is a fair description on day one and a
        # progressively worse one after that — a record still missing after a week is more likely
        # withdrawn or mis-keyed than newly published, and the page should not keep asserting
        # newness on its behalf. Tracking the date is what lets the claim expire on its own.
        since = prior_awaiting.get(r["mls"], {}).get("since") or TODAY
        days = (date.fromisoformat(TODAY) - date.fromisoformat(since)).days
        awaiting.append({"mls": r["mls"], "address": r["address"], "city": r["city"],
                         "since": since, "days": days})
        print(f'{r["address"][:24]:24} MLS{r["mls"]} not yet indexed by MetroListPRO '
              f'({days}d since first seen unindexed) — carried as unverified, not as a disagreement')
        continue
    ok = []
    ok.append("price" if v.get("mlPrice") == r["price"] else f"PRICE {v.get('mlPrice')} vs {r['price']}")
    ok.append("beds" if v.get("mlBeds") == r["beds"] else f"BEDS {v.get('mlBeds')} vs {r['beds']}")
    ok.append("baths" if v.get("mlFullBaths") == r["fullBaths"] else
              f"BATHS {v.get('mlFullBaths')}F vs {r['fullBaths']}F")
    a1, a2 = v.get("mlAcres"), r["acres"]
    ok.append("acres" if a1 and abs(float(a1) - a2) < 0.05 else f"ACRES {a1} vs {a2}")
    ok.append("pool" if v.get("mlPool") == "Yes" else f"POOL {v.get('mlPool')}")
    if all(x in ("price", "beds", "baths", "acres", "pool") for x in ok):
        clean += 1
    else:
        disagreed.append({"mls": r["mls"], "address": r["address"]})
    print(f'{r["address"][:24]:24} MLS{r["mls"]} ml_status={v.get("mlStatus")} '
          f'cb_status={r["status"]} | {" ".join(ok)}')

# Stamp the verification date into listings.json. The page states that every match was
# re-read from MetroListPRO, and scrape.js cannot make that claim because it never talks
# to MetroListPRO — so the date is written here, by the step that actually did the work.
# Skip step 2 and the page now shows an older date instead of an unearned one.
#
# A record awaiting indexing does not block the stamp, because blocking it would throw away the
# fact that the other records *were* re-read today — and would signal a contradiction where there
# is none. It is recorded instead, per-record, so the page can caveat exactly the cards it applies
# to instead of discrediting the whole board. A genuine disagreement still vetoes the stamp.
if not disagreed and rows:
    today = subprocess.run(["date", "-u", "+%Y-%m-%d"], capture_output=True,
                           text=True).stdout.strip()
    d = json.load(open("listings.json"))
    d.setdefault("source", {})["mlsVerifiedOn"] = today
    d["source"]["mlsVerifiedCount"] = clean
    if awaiting:
        d["source"]["mlsAwaitingIndex"] = awaiting
    else:
        d["source"].pop("mlsAwaitingIndex", None)
    if foreign:
        d["source"]["mlsForeignSource"] = foreign
    else:
        d["source"].pop("mlsForeignSource", None)

    # The caveat belongs on the card, so write it where build.js reads it — and clear it from any
    # listing that has since been indexed, so a note can never outlive the condition it describes.
    pend = {a["mls"]: a for a in awaiting}
    alien = {a["mls"]: a for a in foreign}

    def note_for(a):
        # Below a week, "too new to be indexed" is the ordinary explanation. Past that it stops
        # being a good one, so the note says what is observed rather than continuing to assert a
        # cause it can no longer support.
        if a["days"] < 7:
            why = ("this listing went live too recently for the MLS site to carry it")
        else:
            why = (f"it has been missing from the MLS site since {a['since']} "
                   f"({a['days']} days), which is longer than indexing normally takes — worth "
                   f"a call to the listing agent to confirm it is still on the market")
        return ("Not yet indexed by MetroListPRO — " + why + ". Every criterion below was "
                "instead confirmed against a second independent source; treat it as one "
                "confirmation short of the others.")

    # The foreign-MLS note is NOT written here. It has to state what the second source actually
    # confirmed, and that stamp is written by `foreign-verify.py`, which runs after this script —
    # a note composed now would describe the previous run's evidence, the exact one-step staleness
    # this file's own history is a catalogue of. `build.js` composes it at render time, when both
    # `mlsForeignSource` and each listing's `secondSource` are on disk.
    for lst in (d.get("listings") or []) + (d.get("pending") or []):
        if lst.get("mls") in pend:
            lst["statusNote"] = note_for(pend[lst["mls"]])
        elif str(lst.get("statusNote", "")).startswith(("Not yet indexed by MetroListPRO",
                                                        "Listed in ")):
            lst.pop("statusNote", None)
        if lst.get("mls") not in alien:
            lst.pop("secondSource", None)

    json.dump(d, open("listings.json", "w"), indent=2)
    print(f"\n{clean} of {len(rows)} records agreed with the MLS of record"
          + (f"; {len(awaiting)} not yet indexed and flagged on the card" if awaiting else "")
          + (f"; {len(foreign)} in another MLS and unverifiable here" if foreign else "")
          + f". Stamped source.mlsVerifiedOn = {today}.")
else:
    print(f"\n{len(disagreed)} of {len(rows)} records disagreed with the MLS of record — "
          f"NOT stamping a verification date. Per the verification gate the MLS wins; put the "
          f"disagreement on the card.", file=sys.stderr)
