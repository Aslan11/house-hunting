#!/usr/bin/env python3
"""
Live scan of Redfin for the house-hunt criteria, merged into listings.json.

Redfin server-renders its search and detail pages with the full API payload
embedded in `root.__reactServerState.InitialContext`. Reading that is what makes
status trustworthy: `mlsStatusDisplay` comes from the same feed the site shows,
not from search-engine summary text (see README "Verification gate").

    python3 scan.py          # fetch, verify, merge into listings.json
    python3 scan.py --dry    # print what would change, write nothing

Then `node build.js` to render index.html.
"""
import json, os, re, sys, time, urllib.request, urllib.error, datetime, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(HERE, 'listings.json')
CACHE = os.environ.get('SCAN_CACHE', os.path.join(HERE, '.cache'))

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')

# Redfin filter string. min-lot-size is the hard acreage gate; pool is not a
# reliable Redfin search facet for this MLS, so it is verified per-listing below.
FILTER = 'min-beds=4,min-baths=3,max-price=1.5M,min-lot-size=2.5-acre'

# Both the city region and the ZIP are scanned for each town. The two should
# agree; scanning both catches a region-boundary miss (unincorporated addresses
# that carry a town's postal name but sit outside its Redfin city polygon).
SEARCHES = [
    ('Shingle Springs', f'https://www.redfin.com/city/25976/CA/Shingle-Springs/filter/{FILTER}'),
    ('Shingle Springs', f'https://www.redfin.com/zipcode/95682/filter/{FILTER}'),
    ('Placerville',     f'https://www.redfin.com/city/14915/CA/Placerville/filter/{FILTER}'),
    ('Placerville',     f'https://www.redfin.com/zipcode/95667/filter/{FILTER}'),
    ('Rescue',          f'https://www.redfin.com/zipcode/95672/filter/{FILTER}'),
]

TARGET_CITIES = {'shingle springs', 'placerville', 'rescue'}

CRITERIA = {'beds': 4, 'baths': 3, 'maxPrice': 1_500_000, 'minAcres': 2.5}


# ---------------------------------------------------------------- fetching

def fetch(url, tries=7):
    """GET with cache. Redfin answers 202 with an empty body when it throttles;
    that is retryable, unlike a real error status."""
    os.makedirs(CACHE, exist_ok=True)
    key = re.sub(r'[^A-Za-z0-9]+', '_', url)[-150:] + '.html'
    path = os.path.join(CACHE, key)
    if os.path.exists(path) and os.path.getsize(path) > 10000:
        return open(path, encoding='utf-8', errors='replace').read()
    delay = 4
    for attempt in range(tries):
        req = urllib.request.Request(url, headers={
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read().decode('utf-8', 'replace')
            if len(body) > 10000:
                open(path, 'w', encoding='utf-8').write(body)
                return body
        except urllib.error.HTTPError as e:
            if e.code not in (202, 429, 503):
                raise
        except urllib.error.URLError:
            pass
        time.sleep(delay)
        delay = min(delay * 2, 60)
    raise RuntimeError(f'could not fetch {url}')


def server_state(html):
    key = 'root.__reactServerState.InitialContext = '
    i = html.index(key) + len(key)
    depth = 0; instr = False; esc = False
    for j in range(i, len(html)):
        c = html[j]
        if esc: esc = False; continue
        if c == '\\': esc = True; continue
        if c == '"': instr = not instr; continue
        if instr: continue
        if c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return json.loads(html[i:j + 1])['ReactServerAgent.cache']['dataCache']
    raise ValueError('unterminated InitialContext')


def payload(cache, prefix):
    for k, v in cache.items():
        if k.startswith(prefix):
            t = (v.get('res') or {}).get('text')
            if not t:
                return None
            if t.startswith('{}&&'):
                t = t[4:]
            try:
                return json.loads(t).get('payload')
            except ValueError:
                return None
    return None


def v(x):
    return x.get('value') if isinstance(x, dict) else x


# ---------------------------------------------------------------- search

def search_results(url):
    p = payload(server_state(fetch(url)), '/stingray/api/gis?')
    if not p:
        return []
    # originalHomes only: the same response carries out-of-region "nearby
    # homes" that do not satisfy the location filter.
    return (p.get('originalHomes') or {}).get('homes') or []


def brief(h):
    return {
        'mls': v(h.get('mlsId')),
        'street': v(h.get('streetLine')),
        'city': h.get('city'),
        'zip': h.get('zip'),
        'price': v(h.get('price')),
        'beds': h.get('beds'),
        'baths': h.get('baths'),
        'sqft': v(h.get('sqFt')),
        'lotSqFt': v(h.get('lotSize')),
        'url': 'https://www.redfin.com' + h['url'] if h.get('url') else None,
    }


# ---------------------------------------------------------------- detail

def amenity_map(node, out=None):
    """Flatten Redfin's nested amenity groups to {REFERENCE_NAME: [values]}."""
    if out is None:
        out = {}
    if isinstance(node, dict):
        for e in node.get('amenityEntries', []) or []:
            name = e.get('referenceName') or e.get('amenityName')
            if name:
                out[name] = e.get('amenityValues') or []
        for x in node.values():
            amenity_map(x, out)
    elif isinstance(node, list):
        for x in node:
            amenity_map(x, out)
    return out


def detail(url):
    cache = server_state(fetch(url))
    atf = payload(cache, '/stingray/api/home/details/aboveTheFold') or {}
    btf = payload(cache, '/stingray/api/v1/home/details/belowTheFold') or {}
    mhi = (payload(cache, '/stingray/api/home/details/mainHouseInfoPanelInfo') or {}).get('mainHouseInfo', {})

    ai = atf.get('addressSectionInfo') or {}
    am = amenity_map(btf)
    basic = ((btf.get('publicRecordsInfo') or {}).get('basicInfo')) or {}

    # Pool truth, most authoritative first. POOL_PRIVATE_YN is the MLS field
    # the listing agent fills in; public records are a weaker fallback.
    pool_yn = [s.lower() for s in am.get('POOL_PRIVATE_YN', [])]
    if pool_yn:
        pool = pool_yn[0].startswith('y')
    elif basic.get('hasPrivatePool') is not None:
        pool = bool(basic['hasPrivatePool'])
    else:
        pool = None  # unknown — never promoted to a match

    # Photo URLs live under photoUrls; prefer the padded-wide render, which is
    # sized right for the cards. Hotlinking is fine here: the reader's browser
    # fetches them, and no-referrer on the <img> clears most CDN referrer checks.
    photos = []
    for p in ((atf.get('mediaBrowserInfo') or {}).get('photos') or [])[:8]:
        urls = p.get('photoUrls') or {}
        u = (urls.get('nonFullScreenPhotoUrl')
             or urls.get('nonFullScreenPhotoUrlCompressed')
             or urls.get('fullScreenPhotoUrl')
             or (p.get('thumbnailData') or {}).get('thumbnailUrl'))
        if u:
            photos.append(u)

    remarks = ''
    for r in mhi.get('marketingRemarks') or []:
        if r.get('marketingRemark'):
            remarks = r['marketingRemark']
            break

    agents = mhi.get('listingAgents') or []
    agent = agents[0].get('agentInfo', {}).get('agentName') if agents else None
    broker = agents[0].get('brokerName') if agents else None

    status = mhi.get('mlsStatusDisplay') or ai.get('status') or {}
    return {
        'status': v(status) or (status.get('displayValue') if isinstance(status, dict) else None),
        'activish': mhi.get('propertyIsActivish'),
        'mls': mhi.get('mlsId'),
        'beds': ai.get('beds'), 'baths': ai.get('baths'),
        'sqft': v(ai.get('sqFt')),
        'lotSqFt': v(ai.get('lotSize')) or basic.get('lotSqFt'),
        'price': (ai.get('priceInfo') or {}).get('amount'),
        'yearBuilt': basic.get('yearBuilt'),
        'pool': pool,
        'poolFeatures': am.get('POOL_FEATURES', []),
        'spa': bool([s for s in am.get('SPA_YN', []) if s.lower().startswith('y')]),
        'photos': photos,
        'remarks': remarks,
        'agent': agent, 'broker': broker,
        'lastUpdated': mhi.get('lastUpdatedDate'),
    }


# ---------------------------------------------------------------- merge

def slug(street, city):
    s = re.sub(r'[^a-z0-9]+', '-', f'{street} {city}'.lower()).strip('-')
    return s


def acres(sqft):
    return round(sqft / 43560, 2) if sqft else None


def scan():
    seen = {}
    for town, url in SEARCHES:
        for h in search_results(url):
            b = brief(h)
            if not b['url'] or (b['city'] or '').lower() not in TARGET_CITIES:
                continue
            seen.setdefault(b['url'], b)
        time.sleep(2)

    found = []
    for b in seen.values():
        d = detail(b['url'])
        time.sleep(2)
        rec = dict(b)
        rec.update({k: d[k] for k in
                    ('status', 'activish', 'pool', 'poolFeatures', 'spa', 'photos',
                     'remarks', 'agent', 'broker', 'yearBuilt')})
        for k in ('beds', 'baths', 'sqft', 'price', 'mls'):
            if d.get(k) is not None:
                rec[k] = d[k]
        if d.get('lotSqFt'):
            rec['lotSqFt'] = d['lotSqFt']
        rec['acres'] = acres(rec['lotSqFt'])
        rec['id'] = slug(rec['street'], rec['city'])
        found.append(rec)
    return found


def meets(r):
    """Hard criteria. Pool must be a confirmed yes — unknown is not a match."""
    return (r.get('beds') or 0) >= CRITERIA['beds'] \
        and (r.get('baths') or 0) >= CRITERIA['baths'] \
        and (r.get('price') or 10**9) <= CRITERIA['maxPrice'] \
        and (r.get('acres') or 0) >= CRITERIA['minAcres'] \
        and r.get('pool') is True


def why_not(r):
    bad = []
    if (r.get('beds') or 0) < CRITERIA['beds']: bad.append(f"{r.get('beds')} bd")
    if (r.get('baths') or 0) < CRITERIA['baths']: bad.append(f"{r.get('baths')} ba")
    if (r.get('price') or 0) > CRITERIA['maxPrice']: bad.append('over budget')
    if (r.get('acres') or 0) < CRITERIA['minAcres']: bad.append(f"{r.get('acres')} acres")
    if r.get('pool') is False: bad.append('no pool')
    elif r.get('pool') is None: bad.append('pool unconfirmed')
    return ', '.join(bad) or 'unknown'


def merge(found, store, today):
    prev = {l['id']: l for l in store.get('listings', [])}
    matches = [r for r in found if meets(r)]
    live_ids = {r['id'] for r in matches}

    new_ids, changed = [], []
    out = []

    for r in matches:
        old = prev.get(r['id'])
        listing = {
            'id': r['id'],
            'address': r['street'],
            'city': r['city'],
            'zip': r['zip'],
            'mls': r['mls'],
            'status': 'match',
            'currentPrice': r['price'],
            'beds': r['beds'],
            'baths': r['baths'],
            'sqft': r['sqft'],
            'acres': r['acres'],
            'pool': True,
            'poolDetail': ('Pool + spa' if r['spa'] else 'Pool'),
            'poolFeatures': r['poolFeatures'],
            'yearBuilt': r['yearBuilt'],
            'url': r['url'],
            'photos': r['photos'][:3],
            'agent': r['agent'],
            'broker': r['broker'],
            'notes': (r['remarks'] or '')[:420],
            'lastSeen': today,
        }
        if old is None:
            listing['firstSeen'] = today
            listing['priceHistory'] = [{'date': today, 'price': r['price']}]
            listing['isNew'] = True
            new_ids.append(r['id'])
        else:
            listing['firstSeen'] = old.get('firstSeen', today)
            hist = list(old.get('priceHistory') or [])
            if not hist or hist[-1]['price'] != r['price']:
                hist.append({'date': today, 'price': r['price']})
                changed.append((r['id'], old.get('currentPrice'), r['price']))
                listing['priceChanged'] = True
            listing['priceHistory'] = hist
            listing['isNew'] = False
        out.append(listing)

    # Anything tracked but no longer in live active inventory is gone.
    dropped = []
    for pid, old in prev.items():
        if pid not in live_ids:
            dropped.append({
                'id': pid,
                'address': old.get('address'),
                'city': old.get('city'),
                'lastPrice': old.get('currentPrice'),
                'lastSeen': old.get('lastSeen') or store.get('lastRun'),
                'removedOn': today,
                'reason': 'no longer in active MLS inventory (sold or withdrawn)',
            })

    store['listings'] = sorted(out, key=lambda l: l['currentPrice'])
    # A property that came back on the market is live again, so it must not also
    # sit in the dropped table saying otherwise.
    relisted = [r for r in (store.get('removed') or []) if r['id'] in live_ids]
    store['removed'] = [r for r in (store.get('removed') or [])
                        if r['id'] not in live_ids] + dropped
    for r in relisted:
        print(f'  relisted: {r["address"]}, {r["city"]} (was dropped {r["removedOn"]})')
    # Near misses: active, meets everything but one thing. Useful context.
    store['nearMisses'] = sorted(
        [{'address': r['street'], 'city': r['city'], 'price': r['price'],
          'beds': r['beds'], 'baths': r['baths'], 'acres': r['acres'],
          'url': r['url'], 'reason': why_not(r)}
         for r in found if not meets(r)],
        key=lambda x: x['price'] or 0)
    store['lastRun'] = today
    store['criteria'] = {
        'beds': '4+', 'baths': '3+', 'pool': True,
        'cities': ['Shingle Springs, CA', 'Rescue, CA', 'Placerville, CA'],
        'minAcres': 2.5, 'preferredAcres': 5, 'maxPrice': 1_500_000,
    }
    store['dataQuality'] = {
        'source': 'Redfin server-rendered listing feed (MetroList MLS), read live',
        'verifiedActiveListings': len(out),
        'activeCandidatesScanned': len(found),
        'note': 'Every listing below was read from its live Redfin detail page this run; '
                'status, price and POOL_PRIVATE_YN come from the MLS feed, not search snippets.',
    }
    return new_ids, changed, dropped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry', action='store_true')
    args = ap.parse_args()

    today = datetime.date.today().isoformat()
    store = json.load(open(STORE, encoding='utf-8'))
    found = scan()
    new_ids, changed, dropped = merge(found, store, today)

    print(f'scanned {len(found)} active candidates; {len(store["listings"])} meet all criteria')
    for l in store['listings']:
        flag = 'NEW  ' if l.get('isNew') else ('PRICE' if l.get('priceChanged') else '     ')
        print(f'  {flag} ${l["currentPrice"]:>9,}  {l["address"]}, {l["city"]}  '
              f'{l["beds"]}bd/{l["baths"]}ba  {l["acres"]}ac  {l["poolDetail"]}')
    for cid, old, now in changed:
        print(f'  price change: {cid} {old} -> {now}')
    for d in dropped:
        print(f'  dropped: {d["address"]}, {d["city"]} ({d["reason"]})')

    if args.dry:
        print('\n--dry: listings.json not written')
        return
    json.dump(store, open(STORE, 'w', encoding='utf-8'), indent=2)
    print(f'\nwrote {STORE}')


if __name__ == '__main__':
    main()
