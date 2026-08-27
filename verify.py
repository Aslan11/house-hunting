#!/usr/bin/env python3
"""Independently verify each match against MetroListPRO, the official MetroList MLS search site."""
import re, json, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

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
with ThreadPoolExecutor(max_workers=5) as ex:
    res = list(ex.map(verify, rows))
json.dump(res, open("verified.json", "w"), indent=1)

clean = 0
awaiting = []   # in the feed, not yet in the MLS index — a caveat on the card
disagreed = []  # the MLS says something different — the gate's veto
for v, r in zip(res, rows):
    if v.get("mlNotIndexed"):
        awaiting.append({"mls": r["mls"], "address": r["address"], "city": r["city"]})
        print(f'{r["address"][:24]:24} MLS{r["mls"]} not yet indexed by MetroListPRO '
              f'(listing is new) — carried as unverified, not as a disagreement')
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

    # The caveat belongs on the card, so write it where build.js reads it — and clear it from any
    # listing that has since been indexed, so a note can never outlive the condition it describes.
    pend = {a["mls"] for a in awaiting}
    note = ("Not yet indexed by MetroListPRO — this listing went live too recently for the MLS "
            "site to carry it. Every criterion below was instead confirmed against a second "
            "independent source; treat it as one confirmation short of the others.")
    for lst in (d.get("listings") or []) + (d.get("pending") or []):
        if lst.get("mls") in pend:
            lst["statusNote"] = note
        elif lst.get("statusNote") == note:
            lst.pop("statusNote", None)

    json.dump(d, open("listings.json", "w"), indent=2)
    print(f"\n{clean} of {len(rows)} records agreed with the MLS of record"
          + (f"; {len(awaiting)} not yet indexed and flagged on the card" if awaiting else "")
          + f". Stamped source.mlsVerifiedOn = {today}.")
else:
    print(f"\n{len(disagreed)} of {len(rows)} records disagreed with the MLS of record — "
          f"NOT stamping a verification date. Per the verification gate the MLS wins; put the "
          f"disagreement on the card.", file=sys.stderr)
