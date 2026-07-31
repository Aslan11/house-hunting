#!/usr/bin/env python3
"""
House-hunt pipeline for Shingle Springs / Rescue / Placerville, CA.

Three stages:

  1. SEARCH  - Redfin search pages for the target ZIPs/cities, filtered only on
               beds + price. Everything else is filtered locally, because the
               portal's own lot-size filter silently drops listings whose MLS
               lot field is unpopulated.
  2. VERIFY  - fetch each candidate's detail page and read ONLY subject-anchored
               fields: <title>, <meta description>, the xdp-meta JSON block, the
               hero key-details panel, and amenity blocks that occur exactly once.
               Anything ambiguous is recorded as a warning, never guessed.
  3. MERGE   - reconcile against the previous listings.json: flag new listings,
               record price changes, and drop anything no longer active.

Run:  python3 hunt.py  &&  node build.js
"""
import html as H
import json
import os
import re
import subprocess
import sys
import time
from datetime import date

D = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(D, '.cache')
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')

TARGET_CITIES = {'Shingle Springs', 'Rescue', 'Placerville'}
CRITERIA = {
    'beds': 4, 'baths': 3, 'pool': True, 'minAcres': 2.5,
    'preferredAcres': 5, 'maxPrice': 1_500_000,
    'cities': ['Shingle Springs, CA', 'Rescue, CA', 'Placerville, CA'],
}

FILTER = 'filter/property-type=house,max-price=1.5M,min-beds=4'
SEARCHES = [
    ('city-shingle-springs', f'https://www.redfin.com/city/25976/CA/Shingle-Springs/{FILTER}'),
    ('city-placerville',     f'https://www.redfin.com/city/14915/CA/Placerville/{FILTER}'),
    ('zip-95672',            f'https://www.redfin.com/zipcode/95672/{FILTER}'),
    ('zip-95682',            f'https://www.redfin.com/zipcode/95682/{FILTER}'),
    ('zip-95667',            f'https://www.redfin.com/zipcode/95667/{FILTER}'),
    ('zip-95619',            f'https://www.redfin.com/zipcode/95619/{FILTER}'),
]


# ---------------------------------------------------------------- fetching

def fetch(url, out, tries=4):
    """Redfin intermittently answers 202 with a bot challenge; retry with backoff."""
    code = ''
    for i in range(tries):
        r = subprocess.run(
            ['curl', '-sSL', '--max-time', '75', '-A', UA,
             '-H', 'Accept-Language: en-US,en;q=0.9',
             '-H', 'Referer: https://www.redfin.com/',
             '-o', out, '-w', '%{http_code}', url],
            capture_output=True, text=True)
        code = r.stdout.strip()
        if code == '200' and os.path.exists(out) and os.path.getsize(out) > 50_000:
            return '200'
        time.sleep(8 * (i + 1))
    return code


def unesc(s):
    return (s.replace('\\u002F', '/').replace('\\/', '/')
             .replace('\\"', '"').replace('\\n', ' ').replace('\\r', ' '))


# ---------------------------------------------------------------- stage 1

def parse_search(path):
    """Listing stubs from the search page's JSON-LD blocks."""
    h = open(path, encoding='utf-8', errors='replace').read()
    homes = {}
    for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', h, re.S):
        try:
            data = json.loads(m.group(1))
        except Exception:
            continue
        if not isinstance(data, list):
            continue
        rec = {}
        for item in data:
            if item.get('@type') in ('SingleFamilyResidence', 'House', 'Residence'):
                a = item.get('address', {})
                rec.update(url=item.get('url'), street=a.get('streetAddress'),
                           city=a.get('addressLocality'), zip=a.get('postalCode'))
            elif item.get('@type') == 'Product':
                rec['price'] = (item.get('offers') or {}).get('price')
                rec.setdefault('url', item.get('url'))
        if rec.get('url'):
            homes[rec['url']] = rec
    return homes


def search():
    os.makedirs(CACHE, exist_ok=True)
    found = {}
    for name, url in SEARCHES:
        out = os.path.join(CACHE, f'search_{name}.html')
        code = fetch(url, out)
        got = parse_search(out) if code == '200' else {}
        hit = {u: r for u, r in got.items() if (r.get('city') or '') in TARGET_CITIES}
        print(f'  search {name}: http={code} total={len(got)} inTarget={len(hit)}', file=sys.stderr)
        found.update(hit)
        time.sleep(3)
    return found


# ---------------------------------------------------------------- stage 2

def amenity_once(h, name):
    """Values for an amenity that appears exactly once; None if absent/ambiguous."""
    pat = (r'\{\\"amenityName\\":\\"' + re.escape(name) +
           r'\\",\\"referenceName\\":\\".*?\\",\\"accessLevel\\":\d+,'
           r'\\"displayLevel\\":\d+,\\"amenityValues\\":\[(.*?)\]\}')
    ms = re.findall(pat, h)
    if len(ms) != 1:
        return None
    return re.findall(r'\\"(.*?)\\"', ms[0])


def verify(path, url):
    """Subject-anchored facts only. Never trust the first regex hit on the page:
    Redfin detail pages embed nearby-home and comparable payloads too."""
    h = open(path, encoding='utf-8', errors='replace').read()
    r = {'url': url, 'warnings': []}

    t = re.findall(r'<title>(.*?)</title>', h, re.S)
    if not t:
        r['warnings'].append('no title (bot challenge)')
        return r
    r['title'] = H.unescape(t[0])
    m = re.match(r'(.+?),\s*([^,]+),\s*CA\s*(\d{5})\s*\|\s*MLS#\s*([A-Za-z0-9]+)', r['title'])
    if m:
        r['address'], r['city'], r['zip'], r['mls'] = (
            m.group(1).strip(), m.group(2).strip(), m.group(3), m.group(4))
    else:
        r['warnings'].append('title parse failed')

    # Authoritative live status - this is the check the whole page depends on.
    m = re.search(r'<script type="application/json" id="xdp-meta">(.*?)</script>', h, re.S)
    if m:
        try:
            j = json.loads(m.group(1))
            r['listingStatus'] = j.get('listingStatus')
            r['timeSinceActive'] = j.get('timeSinceActive')
        except Exception:
            r['warnings'].append('xdp-meta parse failed')
    else:
        r['warnings'].append('no xdp-meta status block')

    ms = re.findall(r'\\"mlsStatusDisplay\\":\{\\"displayValue\\":\\"(.*?)\\"', h)
    if ms:
        r['mlsStatus'] = ms[0]
        if len(set(ms)) > 1:
            r['warnings'].append(f'multiple mlsStatus values {sorted(set(ms))}')

    m = re.search(r'<meta name="description" content="(.*?)"\s*/>', h, re.S)
    if m:
        d = H.unescape(m.group(1))
        r['saleLabel'] = d.split(':')[0].strip()
        for key, pat, cast in (
                ('beds',  r'([\d.]+)\s*beds?', float),
                ('baths', r'([\d.]+)\s*baths?', float),
                ('sqft',  r'([\d,]+)\s*sq\.\s*ft\.', lambda x: int(x.replace(',', ''))),
                ('price', r'\$([\d,]+)', lambda x: int(x.replace(',', '')))):
            mm = re.search(pat, d)
            if mm:
                r[key] = cast(mm.group(1))
        if r.get('address') and r['address'] not in d:
            r['warnings'].append('description address mismatch')
    else:
        r['warnings'].append('no meta description')

    # Acreage from three independent places on the page; disagreement is reported.
    hero = re.findall(r'<span class="valueText">([\d.,]+)\s*acres?</span>'
                      r'<span class="valueType">Lot Size</span>', h, re.I)
    tbl = re.findall(r'<span class="table-label">Lot size</span>'
                     r'<div class="table-value">([\d.,]+)\s*Acres</div>', h, re.I)
    amen = amenity_once(h, 'Lot Size Acres')
    vals = []
    for v in hero[:1] + tbl[:1] + ((amen or [])[:1]):
        try:
            vals.append(round(float(str(v).replace(',', '')), 2))
        except Exception:
            pass
    if vals:
        r['acres'] = min(vals)          # conservative: never overstate the lot
        r['acresSources'] = {'hero': hero[:1], 'table': tbl[:1], 'amenity': (amen or [])[:1]}
        if len(set(vals)) > 1:
            r['warnings'].append(f'acreage sources disagree {sorted(set(vals))}; using minimum')
    else:
        r['warnings'].append('no acreage found')

    pool = amenity_once(h, 'Has Private Pool')
    r['hasPrivatePool'] = pool[0] if pool else None
    if pool is None:
        r['warnings'].append('private-pool flag missing or ambiguous')
    r['poolFeatures'] = amenity_once(h, 'Pool Features') or []

    # Listing remarks live in the rendered remarks block, not in the JSON payload.
    m = re.search(r'<div class="remarks" id="marketing-remarks-scroll"[^>]*>(.*?)</div>', h, re.S)
    if m:
        txt = re.sub(r'<[^>]+>', ' ', m.group(1))
        txt = re.sub(r'\s+', ' ', H.unescape(txt)).strip()
        if txt:
            r['remarks'] = txt[:1200]

    m = re.search(r'\\"yearBuilt\\":\{\\"value\\":(\d{4})\}', h)
    if m:
        r['yearBuilt'] = int(m.group(1))

    # Photos are matched on this listing's own MLS number so comparables can't leak in.
    if r.get('mls'):
        flat = h.replace('\\u002F', '/').replace('\\/', '/')
        pat = (r'https://ssl\.cdn-redfin\.com/photo/[^"\s\\<>]*?genMid\.'
               + re.escape(r['mls']) + r'_\d+(?:_\d+)?\.jpg')
        seen, out = set(), []
        for p in re.findall(pat, flat):
            if p not in seen:
                seen.add(p)
                out.append(p)
        r['photos'] = out[:6]
    else:
        r['photos'] = []
    return r


def slug_for(url):
    return re.sub(r'[^a-z0-9]+', '-', url.split('/home/')[0].split('/')[-1].lower())


def verify_all(stubs):
    rows = []
    items = sorted(stubs.items(), key=lambda kv: kv[1].get('street') or '')
    for i, (u, s) in enumerate(items, 1):
        path = os.path.join(CACHE, f'dp_{slug_for(u)}.html')
        code = fetch(u, path)
        r = verify(path, u) if code == '200' else {'url': u, 'warnings': [f'fetch {code}']}
        if not r.get('title'):
            # one more slow attempt before giving up on this property
            time.sleep(20)
            if fetch(u, path, tries=2) == '200':
                r = verify(path, u)
        r['stub'] = s
        rows.append(r)
        print(f'  [{i}/{len(items)}] {r.get("address") or s.get("street")}: '
              f'{r.get("listingStatus")} {r.get("beds")}bd/{r.get("baths")}ba '
              f'{r.get("acres")}ac pool={r.get("hasPrivatePool")}'
              + (f'  !! {"; ".join(r["warnings"])}' if r.get('warnings') else ''),
              file=sys.stderr)
        time.sleep(2)
    return rows


# ---------------------------------------------------------------- classify

def classify(r):
    """Return list of unmet criteria. Empty list == full match."""
    fails = []
    if (r.get('listingStatus') or '').lower() != 'active':
        fails.append(f"not active (status: {r.get('listingStatus') or 'unknown'})")
    if (r.get('beds') or 0) < CRITERIA['beds']:
        fails.append(f"{r.get('beds') or '?'} bed")
    if (r.get('baths') or 0) < CRITERIA['baths']:
        fails.append(f"{r.get('baths') or '?'} bath")
    if r.get('hasPrivatePool') != 'Yes':
        fails.append('no pool')
    a = r.get('acres')
    if a is None:
        fails.append('lot size unknown')
    elif a < CRITERIA['minAcres']:
        fails.append(f'{a} acres')
    if (r.get('price') or 0) > CRITERIA['maxPrice']:
        fails.append(f"${(r.get('price') or 0):,}")
    return fails


def make_id(r):
    base = f"{r.get('address','')}-{r.get('city','')}".lower()
    return re.sub(r'[^a-z0-9]+', '-', base).strip('-')


# ---------------------------------------------------------------- stage 3

def merge(rows, today):
    prev_path = os.path.join(D, 'listings.json')
    prev = {}
    prev_doc = {}
    if os.path.exists(prev_path):
        prev_doc = json.load(open(prev_path))
        for l in prev_doc.get('listings', []):
            prev[l['id']] = l

    listings, near = [], []
    for r in rows:
        if not r.get('address'):
            continue
        fails = classify(r)
        lid = make_id(r)
        old = prev.get(lid)
        price = r.get('price')

        entry = {
            'id': lid,
            'address': r['address'],
            'city': r.get('city'),
            'zip': r.get('zip'),
            'mls': r.get('mls'),
            'currentPrice': price,
            'priceHistory': (old or {}).get('priceHistory', []) or [],
            'beds': r.get('beds'),
            'baths': r.get('baths'),
            'sqft': r.get('sqft'),
            'acres': r.get('acres'),
            'pool': r.get('hasPrivatePool') == 'Yes',
            'poolDetail': (', '.join(r.get('poolFeatures') or []) or 'Private pool')
                          if r.get('hasPrivatePool') == 'Yes' else 'No pool',
            'yearBuilt': r.get('yearBuilt'),
            'photos': r.get('photos') or [],
            'url': r['url'],
            'gallery': r['url'],
            'remarks': r.get('remarks'),
            'listingStatus': r.get('listingStatus'),
            'mlsStatus': r.get('mlsStatus'),
            'timeSinceActive': r.get('timeSinceActive'),
            'verifiedOn': today,
            'firstSeen': (old or {}).get('firstSeen', today),
            'lastSeen': today,
            'warnings': r.get('warnings') or [],
            'unmet': fails,
            'status': 'match' if not fails else 'near-miss',
        }

        # price history / change detection
        hist = entry['priceHistory']
        if price is not None:
            if not hist:
                hist.append({'date': today, 'price': price})
            elif hist[-1]['price'] != price:
                hist.append({'date': today, 'price': price})
                entry['priceChanged'] = True
                entry['previousPrice'] = hist[-2]['price']
        entry['isNew'] = old is None

        (listings if not fails else near).append(entry)

    listings.sort(key=lambda l: (not l['isNew'], -(l.get('acres') or 0)))
    near.sort(key=lambda l: (l.get('currentPrice') or 0))

    # anything previously tracked and not seen active now is dropped
    seen_ids = {l['id'] for l in listings}
    dropped = list(prev_doc.get('dropped', []))
    for lid, old in prev.items():
        if lid not in seen_ids:
            dropped.append({
                'address': old.get('address'),
                'city': old.get('city'),
                'lastPrice': old.get('currentPrice'),
                'reason': 'No longer an active listing meeting the criteria',
                'droppedOn': today,
            })

    return {
        '_comment': ('Generated by hunt.py. Status is read from each listing page\'s xdp-meta '
                     'block and MLS status display - never inferred from search-result text. '
                     'Only listings whose live page reports active are ever status "match".'),
        'criteria': CRITERIA,
        'lastRun': today,
        'source': 'Redfin search + per-listing detail pages, verified live',
        'counts': {
            'verifiedActive': len(listings),
            'nearMisses': len(near),
            'newThisRun': sum(1 for l in listings if l['isNew']),
            'priceChanges': sum(1 for l in listings if l.get('priceChanged')),
        },
        'listings': listings,
        'nearMisses': near,
        'dropped': dropped,
    }


def main():
    today = date.today().isoformat()
    print('stage 1: search', file=sys.stderr)
    stubs = search()
    print(f'  {len(stubs)} candidates in target cities', file=sys.stderr)
    print('stage 2: verify', file=sys.stderr)
    rows = verify_all(stubs)
    print('stage 3: merge', file=sys.stderr)
    doc = merge(rows, today)
    json.dump(doc, open(os.path.join(D, 'listings.json'), 'w'), indent=2)
    c = doc['counts']
    print(f"\nwrote listings.json - {c['verifiedActive']} matches "
          f"({c['newThisRun']} new, {c['priceChanges']} price changes), "
          f"{c['nearMisses']} near misses, {len(doc['dropped'])} dropped", file=sys.stderr)
    unresolved = [r for r in rows if not r.get('address')]
    if unresolved:
        print(f"WARNING: {len(unresolved)} listing pages could not be read:", file=sys.stderr)
        for r in unresolved:
            print(f"  {r['url']}", file=sys.stderr)


if __name__ == '__main__':
    main()
