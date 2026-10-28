#!/usr/bin/env python3
"""Extract Redfin's GIS search payload from saved ZIP-search pages.

A Redfin ZIP page embeds the full active-listing result set for that region inside
`te.InitialContext` as a JSON-escaped API response. This pulls the `homes` array out of
every such blob and flattens it to one record per property.

    python3 scripts/parse_search.py work/rf_95667.html work/rf_95682.html > work/all.json

Note: Redfin requests these with `include_nearby_homes=true`, so a ZIP page also returns
listings in adjacent towns. Filter on the `city` field, never on the ZIP you fetched.
Each query is capped at 350 rows; `--check-cap` warns if any payload came back at the cap,
which means the result set was truncated and needs paginating.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_detail import load_cache  # noqa: E402

PAGE_CAP = 350


def flat(hm):
    def val(key):
        v = hm.get(key)
        return v.get('value') if isinstance(v, dict) else v

    lot = val('lotSize')
    return {
        'mls': val('mlsId'),
        'mlsStatus': hm.get('mlsStatus'),
        'searchStatus': hm.get('searchStatus'),
        'price': val('price'),
        'beds': hm.get('beds'),
        'baths': hm.get('baths'),
        'sqft': val('sqFt'),
        'lotSqft': lot,
        'acres': round(lot / 43560, 2) if lot else None,
        'street': val('streetLine'),
        'city': hm.get('city'),
        'zip': hm.get('zip'),
        'yearBuilt': val('yearBuilt'),
        'dom': val('dom'),
        'url': 'https://www.redfin.com' + hm['url'] if hm.get('url') else None,
        'propertyId': hm.get('propertyId'),
        'listingId': hm.get('listingId'),
    }


def main(paths, check_cap=True):
    seen = {}
    for path in paths:
        for endpoint, entry in load_cache(path).items():
            payload = entry.get('payload')
            if not isinstance(payload, dict) or not isinstance(payload.get('homes'), list):
                continue
            homes = payload['homes']
            if check_cap and len(homes) >= PAGE_CAP:
                print(f"WARNING: {os.path.basename(path)} returned {len(homes)} rows at the "
                      f"{PAGE_CAP}-row cap — result set is TRUNCATED, paginate it.",
                      file=sys.stderr)
            for hm in homes:
                pid = hm.get('propertyId')
                if pid is not None and pid not in seen:
                    seen[pid] = flat(hm)
    return list(seen.values())


if __name__ == '__main__':
    out = main([a for a in sys.argv[1:] if not a.startswith('-')])
    json.dump(out, sys.stdout, indent=1)
    print(f"\n# {len(out)} unique active listings", file=sys.stderr)
