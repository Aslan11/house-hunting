#!/usr/bin/env python3
"""Extract subject-scoped MLS detail from a saved Redfin listing page.

    python3 scripts/parse_detail.py work/det work/details.json

VERIFICATION GATE. A Redfin detail page embeds payloads for comparable and nearby homes
alongside the subject property's own. Reading the page with a loose regex will happily
return a neighbour's beds, price or pool status — that is exactly what corrupted the
2026-07-26 run. So every blob is keyed by its API path, and `scopeOk` records whether the
`propertyId` in each blob's query params matched the property the page was fetched for.
Treat a record with `scopeOk: false` as no data at all.

Pool truth comes from the MLS `Pool Information` amenity group (`Has Private Pool`,
`Pool Features`) — not from marketing copy. Multi-unit listings omit that group entirely;
when `pool` comes back None, read `remarks` before concluding there is no pool.
"""
import json, sys, os, glob

def load_cache(path):
    """Parse Redfin's InitialContext data cache, keyed by API urlPath."""
    h = open(path, encoding='utf-8', errors='replace').read()
    i = h.find('InitialContext = ')
    if i < 0: return {}
    j = h.index('{', i)
    depth, k, instr, esc = 0, j, False, False
    while k < len(h):
        c = h[k]
        if instr:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': instr = False
        else:
            if c == '"': instr = True
            elif c == '{': depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0: break
        k += 1
    ctx = json.loads(h[j:k+1])
    cache = ctx.get('ReactServerAgent.cache', {}).get('dataCache', {})
    out = {}
    for key, entry in cache.items():
        txt = (entry.get('res') or {}).get('text')
        if not isinstance(txt, str): continue
        body = txt.split('&&', 1)[1] if '&&' in txt else txt
        try: payload = json.loads(body)
        except Exception: continue
        rd = entry.get('requestData') or {}
        out[rd.get('urlPath', key)] = {'payload': payload.get('payload'),
                                       'query': rd.get('queryParams')}
    return out

def pid_of(entry):
    for d in (entry.get('query') or []):
        if isinstance(d, dict) and 'propertyId' in d: return d['propertyId']
    return None

def parse(path):
    cache = load_cache(path)
    subject_pid = int(os.path.basename(path).replace('.html', ''))
    btf = cache.get('/stingray/api/v1/home/details/belowTheFold') or {}
    atf = cache.get('/stingray/api/home/details/aboveTheFold') or {}
    mhi = cache.get('/stingray/api/home/details/mainHouseInfoPanelInfo') or {}

    # Verification gate: every blob we read must belong to the subject property.
    scope_ok = pid_of(btf) == subject_pid and pid_of(atf) == subject_pid and pid_of(mhi) == subject_pid

    info = {'subjectPid': subject_pid, 'scopeOk': scope_ok}

    # --- amenities (below the fold) ---
    groups = {}
    for sg in ((btf.get('payload') or {}).get('amenitiesInfo') or {}).get('superGroups') or []:
        for g in sg.get('amenityGroups') or []:
            for e in g.get('amenityEntries') or []:
                groups.setdefault(g.get('groupTitle'), []).append(
                    (e.get('amenityName'), e.get('amenityValues') or []))
    info['amenityGroups'] = {k: [f"{n}: {', '.join(map(str, v))}" for n, v in vs] for k, vs in groups.items()}

    pool, spa, pool_features = None, None, []
    for name, vals in groups.get('Pool Information', []):
        joined = ', '.join(map(str, vals)).strip()
        if name in ('Has Private Pool', 'Has Pool'): pool = joined.lower() in ('true', 'yes')
        elif name == 'Has Spa': spa = joined.lower() in ('true', 'yes')
        elif name == 'Pool Features' and joined: pool_features = vals
    if pool is None and pool_features: pool = True
    info['pool'], info['spa'], info['poolFeatures'] = pool, spa, pool_features

    def flat(*titles):
        r = []
        for t in titles: r += [f"{n}: {', '.join(map(str, v))}" for n, v in groups.get(t, [])]
        return r
    info['lotInfo'] = flat('Lot Information', 'Land Information')
    info['garage'] = flat('Garage/Parking', 'Parking Information')
    info['utilities'] = flat('Utilities', 'Utility Information')

    # --- above the fold ---
    asi = (atf.get('payload') or {}).get('addressSectionInfo') or {}
    info['status'] = (asi.get('status') or {}).get('displayValue')
    info['beds'] = asi.get('beds'); info['baths'] = asi.get('baths')
    info['sqft'] = (asi.get('sqFt') or {}).get('value')
    info['lotSqft'] = asi.get('lotSize')
    info['acres'] = round(asi['lotSize'] / 43560, 2) if asi.get('lotSize') else None
    info['yearBuilt'] = asi.get('yearBuilt')
    info['price'] = (asi.get('priceInfo') or {}).get('amount')
    info['dom'] = asi.get('cumulativeDaysOnMarket')
    info['address'] = (asi.get('streetAddress') or {}).get('assembledAddress')
    info['city'] = asi.get('city'); info['zip'] = asi.get('zip')
    info['url'] = 'https://www.redfin.com' + asi['url'] if asi.get('url') else None

    mb = (atf.get('payload') or {}).get('mediaBrowserInfo') or {}
    info['photos'] = [(p.get('photoUrls') or {}).get('nonFullScreenPhotoUrl')
                      for p in (mb.get('photos') or [])][:12]
    info['photos'] = [p for p in info['photos'] if p]
    info['photoCount'] = len(mb.get('photos') or [])

    # --- main house info ---
    mh = (mhi.get('payload') or {}).get('mainHouseInfo') or {}
    rem = mh.get('marketingRemarks') or []
    info['remarks'] = rem[0].get('marketingRemark') if rem else None
    info['mls'] = mh.get('mlsId')
    info['mlsStatusDisplay'] = mh.get('mlsStatusDisplay')
    info['isActivish'] = mh.get('propertyIsActivish')
    info['lastChecked'] = mh.get('lastCheckedDate')
    ag = mh.get('listingAgents') or []
    info['agent'] = (ag[0].get('agentInfo') or {}).get('agentName') if ag else None
    info['broker'] = ag[0].get('brokerName') if ag else None
    return info

if __name__ == '__main__':
    out = {}
    for p in sorted(glob.glob(os.path.join(sys.argv[1], '*.html'))):
        key = os.path.basename(p).replace('.html', '')
        try: out[key] = parse(p)
        except Exception as e: out[key] = {'error': repr(e)}
    json.dump(out, open(sys.argv[2], 'w'), indent=1)
    for k, v in out.items():
        if 'error' in v: print(k, 'ERROR', v['error']); continue
        print(f"{v['address']:22s} {v['city']:16s} {str(v['status']):10s} activish={v['isActivish']} "
              f"pool={str(v['pool']):5s} spa={str(v['spa']):5s} {v['beds']}bd/{v['baths']}ba "
              f"${v['price']:,} {v['acres']}ac MLS{v['mls']} scope={v['scopeOk']} pics={v['photoCount']}")
