#!/usr/bin/env python3
"""
Refresh the candidate set from live MLS data.

    python3 tools/refresh.py            # scrape, verify, write tools/candidates.json
    python3 tools/refresh.py --cache .  # reuse previously downloaded HTML

Writes `tools/candidates.json`: every active listing in the three target towns that meets the
bed/bath/price criteria, annotated with acreage, pool and a MetroListPRO-verified status.
Merging that into `listings.json` is a judgement call and stays manual — see README's dedupe rules.

Two parsing hazards are handled here; both produced wrong output before they were fixed:
  * Listing cards embed a photo carousel of up to ~70 images, so the bed/bath text sits tens of KB
    into the card. Never truncate the card chunk before parsing.
  * Detail pages embed "similar listing" carousels, so photo URLs must be constrained to the
    listing's own MLS number or you get another property's pictures.
"""
import argparse, hashlib, html as htmlmod, json, os, re, subprocess, sys, time

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")
CB = "https://www.coldwellbankerhomes.com"
ML = "https://www.metrolistpro.com/homes/2/6/a"
CITIES = ["shingle-springs", "rescue", "placerville"]

CRITERIA = {"beds": 4, "baths": 3, "maxPrice": 1_500_000, "minAcres": 2.5}

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")


def get(url, min_bytes=10_000, tries=3):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, hashlib.md5(url.encode()).hexdigest()[:16] + ".html")
    if os.path.exists(path):
        return open(path, encoding="utf-8", errors="replace").read()
    for i in range(tries):
        p = subprocess.run(["curl", "-sS", "-m", "45", "-L", "-A", UA, url],
                           capture_output=True, text=True, errors="replace")
        if p.returncode == 0 and len(p.stdout) >= min_bytes:
            open(path, "w", encoding="utf-8").write(p.stdout)
            return p.stdout
        time.sleep(2 * (i + 1))
    return ""


def flatten(s):
    """Strip tags twice: data attributes hold escaped markup that unescaping resurrects."""
    s = re.sub(r"<script.*?</script>", " ", s, flags=re.S)
    s = re.sub(r"<img[^>]*>", " ", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = htmlmod.unescape(s).replace("\xa0", " ")
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"\{[^{}]*\}", " ", s)
    s = re.sub(r"<[^>]*$", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def parse_cards(page):
    rows = []
    for chunk in page.split('class="property-snapshot-psr-panel"')[1:]:
        m = re.search(r'data-detailurl="([^"]+)"', chunk)
        if not m:
            continue
        t = flatten(chunk)  # NB: never truncate chunk first, see module docstring
        alt = re.search(r'alt="([^"]+?) - Photo \d+"', chunk)
        adr = re.match(r"(.+?),\s*([^,]+?),\s*CA\s*(\d{5})", alt.group(1) if alt else "")
        price = re.search(r"\$([\d,]+)", t)
        beds = re.search(r"(\d+) Beds?\b", t)
        tb = re.search(r"([\d.]+) Total Baths", t)
        fb = re.search(r"([\d.]+) Full Baths", t)
        sq = re.search(r"([\d,]+) Sq\. Ft\.", t)
        mls = re.search(r"MLS # (\S+)", t)
        rows.append({
            "url": CB + m.group(1),
            "address": adr.group(1).strip() if adr else None,
            "city": adr.group(2).strip() if adr else None,
            "zip": adr.group(3) if adr else None,
            "mls": mls.group(1) if mls else None,
            "price": int(price.group(1).replace(",", "")) if price else None,
            "beds": int(beds.group(1)) if beds else None,
            "baths": float(tb.group(1)) if tb else (float(fb.group(1)) if fb else None),
            "sqft": int(sq.group(1).replace(",", "")) if sq else None,
            "cardStatus": "Coming Soon" if "Coming Soon" in t else ("Active" if "Active" in t else None),
        })
    return rows


def scrape_city(slug):
    out, offset, seen = [], 0, set()
    while True:
        page = get(f"{CB}/ca/{slug}/" + (f"?offset={offset}" if offset else ""))
        if not page:
            break
        total = re.search(r'data-count="(\d+)"', page)
        total = int(total.group(1)) if total else 0
        rows = parse_cards(page)
        new = [r for r in rows if r["url"] not in seen]
        seen.update(r["url"] for r in new)
        out += new
        print(f"  {slug} offset={offset}: {len(rows)} cards of {total} (running {len(out)})",
              file=sys.stderr)
        if not new or len(out) >= total or offset > 600:
            break
        offset += len(rows)
    return out


def feature(page, name):
    m = re.search(r'"name":\s*"%s",\s*"value":\s*"([^"]*)"' % re.escape(name), page)
    return m.group(1).strip() if m else None


def enrich(r):
    """Acreage, pool and photos from the Coldwell Banker detail page."""
    page = get(r["url"], min_bytes=20_000)
    if not page:
        return r
    acres = feature(page, "Lot Size (Acres)")
    try:
        r["acres"] = float(acres.replace(",", "")) if acres else None
    except ValueError:
        r["acres"] = None
    r["pool"] = feature(page, "Pool") == "Yes"
    r["poolDetail"] = feature(page, "Pool Description")
    r["yearBuilt"] = feature(page, "Year Built")
    b = re.search(r'video-text-wrapper">(.*?)</', page, re.S)
    r["blurb"] = flatten(b.group(1))[:600] if b else None
    # photos MUST be constrained to this listing's own MLS number
    ids = []
    for m in re.finditer(r"https://m\d*\.cbhomes\.com/p/(\d+)/" + re.escape(r["mls"] or "x")
                         + r"/([0-9A-Za-z]+)/s23cc\.webp", page):
        if m.group(2) not in [i[1] for i in ids]:
            ids.append((m.group(1), m.group(2)))
    r["photos"] = [f"https://{'m' if i % 2 == 0 else 'm1'}.cbhomes.com/p/{p}/{r['mls']}/{pid}/m23cc.webp"
                   for i, (p, pid) in enumerate(ids[:6])]
    # a pool claimed only in prose, with no MLS field, is not a pool
    if not r["pool"] and r.get("blurb") and re.search(r"\bpool\b", r["blurb"], re.I):
        r["poolMentionedInProse"] = True
    return r


def verify(r):
    """Authoritative status check against MetroListPRO."""
    r["verified"] = False
    if not r.get("mls"):
        return r
    page = get(f"{ML}/{r['mls']}", min_bytes=10_000)
    title = re.search(r"<title>(.*?)</title>", page or "", re.S)
    title = re.sub(r"\s+", " ", htmlmod.unescape(title.group(1))) if title else ""
    if r["mls"] not in title:
        r["mlsNote"] = "not found on MetroListPRO"
        return r
    page = re.sub(r"<script.*?</script>", " ", page, flags=re.S)
    t = re.sub(r"(\s*\|\s*)+", " | ",
               re.sub(r"\s+", " ", htmlmod.unescape(re.sub(r"<[^>]+>", " | ", page))))

    def f(name):
        m = re.search(re.escape(name) + r":\s*\|?\s*([^|]+?)\s*\|", t)
        return m.group(1).strip() if m else None

    r["verified"] = True
    r["mlStatus"] = f("Status")
    sale = re.search(r"\$([\d,]+)\s*\|\s*\(([^)]+)\)", t)
    if sale:
        r["mlPrice"] = int(sale.group(1).replace(",", ""))
        r["mlSaleState"] = sale.group(2)
    bm = re.search(r"Bedrooms:\s*(\d+)\s*\|\s*Bathrooms:\s*(\d+)(?:\s*\|\s*(\d+))?", t)
    if bm:
        r["mlBeds"] = int(bm.group(1))
        r["mlBathsFull"] = int(bm.group(2))
        r["mlBathsHalf"] = int(bm.group(3)) if bm.group(3) else 0
        # "Total Baths: 3" may be 2 full + 1 half, i.e. 2.5 — the honest count
        r["bathsLabel"] = (f"{r['mlBathsFull']} full"
                           + (f" + {r['mlBathsHalf']} half" if r["mlBathsHalf"] else ""))
        r["bathsTrue"] = r["mlBathsFull"] + 0.5 * r["mlBathsHalf"]
    ac = f("Lot Size in Acres")
    try:
        r["mlAcres"] = float(ac.replace(",", "")) if ac else None
    except (ValueError, AttributeError):
        r["mlAcres"] = None
    r["mlPool"] = f("Pool")
    r["mlPoolDesc"] = f("Pool Description")
    r["mlYearBuilt"] = f("Year Built")
    r["mlHorse"] = f("Is a Horse Property") == "Yes"
    ag = re.search(r"Presented By\s*\|\s*([^|]+)\|\s*([^|]+)\|", t)
    if ag:
        r["mlAgent"], r["mlOffice"] = ag.group(1).strip(), ag.group(2).strip()
    r["mlsUrl"] = f"{ML}/{r['mls']}"
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-cache", action="store_true", help="delete cached HTML first")
    args = ap.parse_args()
    if args.no_cache and os.path.isdir(CACHE):
        for f in os.listdir(CACHE):
            os.remove(os.path.join(CACHE, f))

    inventory = []
    for slug in CITIES:
        inventory += scrape_city(slug)
    print(f"scanned {len(inventory)} active listings", file=sys.stderr)

    cands = [r for r in inventory
             if (r["beds"] or 0) >= CRITERIA["beds"]
             and (r["baths"] or 0) >= CRITERIA["baths"]
             and r["price"] and r["price"] <= CRITERIA["maxPrice"]
             and r["cardStatus"]]
    print(f"{len(cands)} meet beds/baths/price", file=sys.stderr)

    for i, r in enumerate(cands, 1):
        enrich(r)
        verify(r)
        print(f"  {i}/{len(cands)} {r['address']}: acres={r.get('mlAcres') or r.get('acres')} "
              f"pool={r.get('mlPool') or r.get('pool')} status={r.get('mlStatus')}", file=sys.stderr)

    def acres(r):
        return r.get("mlAcres") or r.get("acres") or 0

    def pool(r):
        return (r.get("mlPool") == "Yes") or r.get("pool")

    matches = [r for r in cands if acres(r) >= CRITERIA["minAcres"] and pool(r)]
    near = [r for r in cands if r not in matches
            and (acres(r) >= CRITERIA["minAcres"] or (pool(r) and acres(r) >= 1.0))]

    out = {"scanned": len(inventory), "criteria": CRITERIA,
           "matches": matches, "nearMisses": near, "allCandidates": cands}
    dest = os.path.join(HERE, "candidates.json")
    json.dump(out, open(dest, "w"), indent=1)
    print(f"\n{len(matches)} matches, {len(near)} near misses -> {dest}")
    for r in sorted(matches, key=lambda x: -acres(x)):
        print(f"  ${(r.get('mlPrice') or r['price']):>9,} {acres(r):>6} ac  "
              f"{r.get('mlBeds') or r['beds']}bd/{r.get('bathsLabel') or r['baths']}  "
              f"{r['address']}, {r['city']}  [{r.get('mlStatus') or 'UNVERIFIED'}]")


if __name__ == "__main__":
    main()
