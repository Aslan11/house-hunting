#!/usr/bin/env python3
"""Re-fetch candidate detail pages, storing the full MLS feature table."""
import re, json, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


def fetch(url):
    return subprocess.run(["curl", "-sSL", "-m", "45", "-A", UA, url],
                          capture_output=True, text=True, errors="replace").stdout


def num(s):
    if s is None:
        return None
    s = str(s).replace(",", "").replace(" ", "")
    try:
        return float(s)
    except ValueError:
        return None


def scrape(row):
    h = fetch(row["url"])
    feats = dict(re.findall(
        r'"@type":\s*"LocationFeatureSpecification",\s*"name":\s*"([^"]*)",\s*"value":\s*"([^"]*)"', h))
    title = (re.findall(r"<title>([^<]*)</title>", h) or [""])[0]
    mls = (re.findall(r"MLS\s+([A-Z0-9]+)", title) or [None])[0]

    status = (re.findall(r"<strong>Status:\s*</strong>\s*([^<]+)</li>", h) or [None])[0]
    if status:
        status = status.strip()

    desc = (re.findall(r'"description":\s*"((?:[^"\\]|\\.){40,})"', h) or [""])[0]
    try:
        desc = desc.encode().decode("unicode_escape", "replace")
    except Exception:
        pass
    desc = re.sub(r"\s+", " ", desc).strip()

    photos = []
    for u in re.findall(r"https://m\.cbhomes\.com/p/[^\"'\s]+?\.webp", h):
        if u not in photos:
            photos.append(u)

    acres = num(feats.get("Lot Size (Acres)"))
    if acres is None and num(feats.get("Lot Size (Sq. Ft.)")):
        acres = round(num(feats["Lot Size (Sq. Ft.)"]) / 43560, 2)

    full = num(feats.get("Full Bathrooms")) or 0
    half = num(feats.get("Half Bathrooms")) or 0

    out = dict(row)
    out.update({
        "mls": mls, "status": status, "acres": acres,
        "fullBaths": full, "halfBaths": half,
        "bathsEffective": full + 0.5 * half,
        "bathsTotalReported": num(feats.get("Total Bathrooms")),
        "pool": feats.get("Pool"), "poolDesc": feats.get("Pool Description"),
        "yearBuilt": feats.get("Year Built"), "garage": feats.get("Garage Spaces"),
        "stories": feats.get("Stories/Levels"), "style": feats.get("Architectural Style"),
        "view": feats.get("Property View"), "water": feats.get("Water"),
        "sewer": feats.get("Sewer"), "hoa": feats.get("Association Fee"),
        "horse": feats.get("Horse Property"), "schools": feats.get("School District"),
        "county": feats.get("County"), "solar": feats.get("Utility Description"),
        "photos": photos[:8], "desc": desc[:1400], "feats": feats,
    })
    sys.stderr.write(f'{row["address"][:26]:26} {status} acres={acres} '
                     f'{full}F/{half:.0f}H pool={feats.get("Pool")}\n')
    return out


cands = json.load(open("candidates.json"))
with ThreadPoolExecutor(max_workers=6) as ex:
    rows = list(ex.map(scrape, cands))
json.dump(rows, open("detailed2.json", "w"), indent=1)
print("wrote", len(rows))
