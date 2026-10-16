#!/usr/bin/env python3
"""
Pull live active inventory from Redfin's public data endpoints, filter against the
criteria in listings.json, and confirm a pool per-property from two independent signals.

    python3 scan.py            # write candidates to scan-results.json
    python3 scan.py --print    # also print a summary table

This replaces web-search scraping, which produced four false "active" matches on the
first run of this tracker (see README, "Verification gate"). Listing status here comes
from a live read of each listing's own detail API, never from indexed search text.

Regions are resolved once via Redfin's location-autocomplete and hardcoded below.
Note the autocomplete `type` field is NOT the same as the gis API's `region_type`:
autocomplete 2=city / 4=zip maps to gis 6=city / 2=zip.
"""
import argparse, csv, io, json, os, re, subprocess, sys, time

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')
HERE = os.path.dirname(os.path.abspath(__file__))

# (label, region_id, gis region_type)
REGIONS = [
    ('Shingle Springs', 25976, 6),   # city
    ('Placerville',     14915, 6),   # city
    ('Rescue (95672)',  39796, 2),   # ZIP — Rescue is not a Redfin "city"
]
TARGET_CITIES = {'Shingle Springs', 'Placerville', 'Rescue'}


def curl(url, tries=4):
    for i in range(tries):
        p = subprocess.run(['curl', '-sS', '--max-time', '45', '-H', f'User-Agent: {UA}', url],
                           capture_output=True, text=True)
        if p.returncode == 0 and p.stdout.strip():
            return p.stdout
        time.sleep(2 * (i + 1))
    return None


def curl_json(url, tries=4):
    """Redfin prefixes every JSON response with `{}&&` to defeat JSON hijacking."""
    t = curl(url, tries)
    if not t:
        return None
    try:
        return json.loads(t[t.index('{', 4):])
    except Exception:
        return None


def num(x):
    try:
        return float(str(x).replace(',', '').strip())
    except Exception:
        return None


def search(region_id, region_type):
    url = ('https://www.redfin.com/stingray/api/gis-csv?al=1&num_homes=350'
           f'&ord=redfin-recommended-asc&page_number=1&region_id={region_id}'
           f'&region_type={region_type}&sf=1,2,3,5,6,7&status=9&uipt=1,2,3,4,7,8&v=8')
    body = curl(url)
    return list(csv.DictReader(io.StringIO(body))) if body else []


def detail(property_id, path):
    """Returns (pool_amenity_lines, remarks, mls_status, agent)."""
    btf = curl_json('https://www.redfin.com/stingray/api/home/details/belowTheFold'
                    f'?propertyId={property_id}&accessLevel=1')
    pool = []
    for sg in (((btf or {}).get('payload') or {}).get('amenitiesInfo') or {}).get('superGroups') or []:
        for g in sg.get('amenityGroups') or []:
            gt = g.get('groupTitle') or ''
            for e in g.get('amenityEntries') or []:
                blob = gt + (e.get('amenityName') or '') + ' '.join(e.get('amenityValues') or [])
                if 'pool' in blob.lower():
                    pool.append(f"{gt}: {', '.join(e.get('amenityValues') or [])}".strip())

    ii = curl_json(f'https://www.redfin.com/stingray/api/home/details/initialInfo?path={path}')
    lid = ((ii or {}).get('payload') or {}).get('listingId')
    mh = curl_json('https://www.redfin.com/stingray/api/home/details/mainHouseInfoPanelInfo'
                   f'?propertyId={property_id}&accessLevel=1&listingId={lid}')
    mi = ((mh or {}).get('payload') or {}).get('mainHouseInfo') or {}
    remarks = ((mi.get('marketingRemarks') or [{}])[0].get('marketingRemark') or '').strip()
    status = (mi.get('mlsStatusDisplay') or {}).get('displayValue')
    agent = '; '.join(filter(None, [(a.get('agentInfo') or {}).get('agentName')
                                    for a in (mi.get('listingAgents') or [])]))

    atf = curl_json('https://www.redfin.com/stingray/api/home/details/aboveTheFold'
                    f'?propertyId={property_id}&accessLevel=1')
    photos = []
    for ph in ((((atf or {}).get('payload') or {}).get('mediaBrowserInfo') or {}).get('photos') or [])[:6]:
        urls = ph.get('photoUrls') or {}
        u = urls.get('fullScreenPhotoUrl') or urls.get('nonFullScreenPhotoUrl') or urls.get('largePhotoUrl')
        if u:
            photos.append(u)
    return pool, remarks, status, agent, photos


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--print', dest='show', action='store_true')
    args = ap.parse_args()

    crit = json.load(open(os.path.join(HERE, 'listings.json')))['criteria']
    min_beds = float(re.sub(r'\D', '', crit['beds']))
    min_baths = float(re.sub(r'\D', '', crit['baths']))
    min_acres, max_price = crit['minAcres'], crit['maxPrice']

    seen, candidates, scanned = set(), [], 0
    for label, rid, rtype in REGIONS:
        rows = search(rid, rtype)
        for r in rows:
            addr = r.get('ADDRESS')
            city = (r.get('CITY') or '').strip()
            if not addr or city not in TARGET_CITIES:
                continue
            key = (addr, city)
            if key in seen:
                continue
            seen.add(key)
            scanned += 1
            price, beds, baths = num(r['PRICE']), num(r['BEDS']), num(r['BATHS'])
            lot = num(r['LOT SIZE'])
            acres = round(lot / 43560, 2) if lot else None
            if not (price and price <= max_price):
                continue
            if not (beds and beds >= min_beds and baths and baths >= min_baths):
                continue
            if not (acres and acres >= min_acres):
                continue
            url = r[[k for k in r if k.startswith('URL')][0]]
            candidates.append(dict(address=addr, city=city, zip=r['ZIP OR POSTAL CODE'],
                                   price=int(price), beds=int(beds), baths=baths,
                                   sqft=int(num(r['SQUARE FEET']) or 0) or None, acres=acres,
                                   yearBuilt=r['YEAR BUILT'], daysOnMarket=r['DAYS ON MARKET'],
                                   mls=r['MLS#'], propertyType=r['PROPERTY TYPE'],
                                   csvStatus=r['STATUS'], url=url))
        print(f'  {label}: {len(rows)} rows', file=sys.stderr)

    print(f'{scanned} active in target cities; {len(candidates)} pass hard filters',
          file=sys.stderr)

    for c in candidates:
        pid = re.search(r'/home/(\d+)', c['url']).group(1)
        path = c['url'].split('redfin.com')[1]
        pool, remarks, status, agent, photos = detail(pid, path)
        low = remarks.lower()
        c.update(propertyId=pid, poolAmenity=pool, remarks=remarks, mlsStatus=status,
                 agent=agent, photos=photos,
                 poolInRemarks=bool(re.search(r'\bpool\b', low)),
                 noPoolPhrase=bool(re.search(
                     r'(no pool|room for a pool|add a pool|build a pool|space for a pool)', low)))
        c['hasPool'] = bool(pool) or (c['poolInRemarks'] and not c['noPoolPhrase'])
        # Two independent signals disagreeing is worth a human look, not a silent pick.
        c['poolConflict'] = bool(pool) != c['poolInRemarks']

    out = os.path.join(HERE, 'scan-results.json')
    json.dump({'scanned': scanned, 'candidates': candidates}, open(out, 'w'), indent=1)
    print(f'wrote {out}', file=sys.stderr)

    if args.show:
        for c in sorted(candidates, key=lambda x: -x['acres']):
            flag = 'POOL' if c['hasPool'] else '    '
            warn = ' !conflict' if c['poolConflict'] else ''
            print(f"{flag} {c['address']:<24} {c['city']:<16} ${c['price']:>9,} "
                  f"{c['beds']}bd/{c['baths']}ba {c['acres']:>6}ac {c['mlsStatus']}{warn}")


if __name__ == '__main__':
    main()
