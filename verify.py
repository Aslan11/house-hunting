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

for v, r in zip(res, rows):
    ok = []
    ok.append("price" if v.get("mlPrice") == r["price"] else f"PRICE {v.get('mlPrice')} vs {r['price']}")
    ok.append("beds" if v.get("mlBeds") == r["beds"] else f"BEDS {v.get('mlBeds')} vs {r['beds']}")
    ok.append("baths" if v.get("mlFullBaths") == r["fullBaths"] else
              f"BATHS {v.get('mlFullBaths')}F vs {r['fullBaths']}F")
    a1, a2 = v.get("mlAcres"), r["acres"]
    ok.append("acres" if a1 and abs(float(a1) - a2) < 0.05 else f"ACRES {a1} vs {a2}")
    ok.append("pool" if v.get("mlPool") == "Yes" else f"POOL {v.get('mlPool')}")
    print(f'{r["address"][:24]:24} MLS{r["mls"]} ml_status={v.get("mlStatus")} '
          f'cb_status={r["status"]} | {" ".join(ok)}')
