# House Hunting — El Dorado County

Automated house-hunt tracker for **Shingle Springs**, **Rescue**, and **Placerville, CA**.
Published from `gh-pages` at repo root.

## Criteria

| Requirement | Value |
|---|---|
| Bedrooms | 4+ |
| Bathrooms | 3+ |
| Pool | Required |
| Lot size | 2.5 acres minimum, 5+ preferred |
| Max price | $1,500,000 |

## Data pipeline

The tracker pulls live MetroList MLS data through Redfin's GIS/CSV export — the same file the
"Download All" button on a Redfin search produces. It is structured MLS data with a real `STATUS`
column, not a search-engine summary, which is what makes listing status trustworthy.

```bash
# 1. Region IDs (stable; re-derive by grepping regionId= out of https://www.redfin.com/zipcode/<zip>)
#      95667 Placerville     -> 39791
#      95672 Rescue          -> 39796
#      95682 Shingle Springs -> 39806
#
# 2. Pull active listings per ZIP
curl -sSL -A "$UA" -H "Referer: https://www.redfin.com/zipcode/95667" \
  "https://www.redfin.com/stingray/api/gis-csv?al=1&market=sacramento&num_homes=350\
&ord=redfin-recommended-asc&page_number=1&region_id=39791&region_type=2\
&sf=1,2,3,5,6,7&status=9&uipt=1,2,3,4,7,8&v=8" -o csv_95667.csv
```

`status=9` is the active filter; `region_type=2` means ZIP. A plain browser User-Agent is required
or the endpoint returns an empty body.

### Verifying the pool

The CSV has no pool column, so every property that clears beds/baths/price/acreage gets its own
listing page fetched. Two independent signals are parsed out of the embedded JSON — note it is
**backslash-escaped** inside the HTML, so normalise `\"` to `"` before matching:

- `"hasPrivatePool":true|false` — the authoritative structured flag.
- The `"groupTitle":"Pool Information"` amenity block — `Has Private Pool`, `Pool Features`, `Has Spa`.

Never infer a pool from marketing copy alone. "Pool table" and "carpool" both appear in remarks, and
plenty of listings mention a neighbourhood pool the property does not have.

### Then merge and build

```bash
node merge.js run.json 2026-08-07   # dedupe + price history -> listings.json
node build.js                       # listings.json -> index.html
```

## Verification gate — read before reporting anything

The 2026-07-26 run reported four properties as matches. **All four were off market.** Status had
been inferred from search-engine result text, which indexes sold listings with "For Sale" still in
the `<title>` for years.

Rules that follow:

1. A property may only be given `status: "match"` when its active status comes from the MLS feed
   (`STATUS,Active` in the CSV) — never from search-result text.
2. MetroList MLS numbers encode the listing year: `221…` = 2021, `225…` = 2025, `226…` = 2026. A
   prefix older than the current year on a supposedly-active listing means something is wrong.
3. Prefer *under*-reporting. An empty result is correct and useful; a fabricated match is not.

## Dedupe rules

`merge.js` enforces these; they are documented here so a manual run behaves the same way.

1. Already tracked, price unchanged → keep, refresh `lastSeen`, **not** flagged new.
2. Already tracked, price changed → append to `priceHistory`, set `priceChange`, render the delta.
3. Not previously tracked → add, flag `isNew`, surface at the top of the page.
4. Previously tracked but absent from the active feed → moved to `dropped` (sold / withdrawn /
   expired) and removed from the board. Kept in the file so a relist is recognised as a relist.
5. Anything in `rejected` stays rejected unless a price change brings it into range.

## Network notes

Egress from this container reaches Redfin (`www.redfin.com`, `ssl.cdn-redfin.com`) and its CSV API.
Zillow, Realtor.com, Homes.com, Trulia and Movoto all refuse requests from this IP range — that is
the sites' own bot defence, not the proxy, so allowlisting will not fix it. `WebFetch` is separately
blocked against Redfin (405). Plain `curl` with a browser User-Agent is the working path.

Consequence: cross-checking a listing against a second portal is not currently possible. The
`caveats` field in `listings.json` says so on the page rather than implying two-source confirmation.

Redfin's export also carries a disclaimer that some MLS listings are withheld from download under
local MLS rules, so treat the result as a strong sample rather than a guaranteed-complete one.

## Photos

Photos are hotlinked from `ssl.cdn-redfin.com` and render in the viewer's browser (which is not
behind this proxy). `referrerpolicy="no-referrer"` gets past the CDN's referrer check. If a URL
dies, an `onerror` handler swaps in a "View photos on redfin" tile, so a dead image never leaves a
hole in the layout. Cards prefer pool photos in the thumbnail strip, since the pool is the hard
requirement. MLS photos are the listing brokerage's copyright — fine for a private hunting page,
don't republish more broadly.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`merge.js`** — merges a run into `listings.json`, applying the dedupe rules.
- **`build.js`** — renders `index.html` from `listings.json`. No dependencies.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.
- **`ingest.js`** — older path: merge listings pasted from a Zillow/Redfin results page.

## Publishing

Served from the `gh-pages` branch at repo root:
**Settings → Pages → Source: `gh-pages` / `(root)`**.
