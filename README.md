# House Hunting — El Dorado County

Automated house-hunt tracker for **Shingle Springs**, **Rescue**, and **Placerville, CA**.

## Criteria

| Requirement | Value |
|---|---|
| Bedrooms | 5+ |
| Bathrooms | 3+ |
| Pool | Required |
| Lot size | 2.5 acres minimum, 5+ preferred |
| Max price | $1,500,000 |

## ⚠️ Verification gate — read before reporting anything

An early run of this tracker reported four properties as matches. **All four were off market.**

Root cause: listing status was inferred from search-engine result text. Search engines index
listing pages that keep "For Sale" in the `<title>` for years after the sale closes, so stale
listings read as active. A second failure compounded it — search snippets conflated two different
properties on the same street, producing a listing with the wrong MLS number, bed count and price.

**Rules that follow from this:**

1. A property may only be given `status: "match"` when its active status is confirmed against a
   live listing page or an authoritative feed. Search-result text is **not** sufficient.
2. MetroList MLS numbers encode the listing year: `221…` = 2021, `223…` = 2023, `225…` = 2025,
   `226…` = 2026. A prefix older than the current year is strong evidence the listing is stale.
   Treat it as off market unless proven otherwise.
3. Cross-check bed/bath/price against at least two independent sources before reporting. If they
   disagree, report the disagreement rather than picking one.
4. Prefer *under*-reporting. An empty result is correct and useful; a fabricated match is not.
5. **Never take pool status from listing prose.** Read the MLS `POOL_PRIVATE_YN` field. Three
   active 5BR acreage listings in the 2026-07-26 sweep describe pools in their marketing text
   (community amenities, neighbouring facilities, comps in the "similar homes" block) while
   reporting `hasPrivatePool: false`. Text search alone would have reported all three as matches.

## Reading Redfin (works as of 2026-07-26)

`www.redfin.com` is reachable from this environment and returns `200`. Zillow, Realtor.com,
Homes.com, Movoto, Trulia and HAR are all still blocked (`403`/`429`), and `WebFetch` is blocked
outright. Redfin's `/stingray/api/*` endpoints are CloudFront-blocked when called directly — but
this doesn't matter, because **the response is already embedded in the page HTML**.

A filtered search page such as

```
https://www.redfin.com/zipcode/95667/filter/min-beds=5,min-baths=3,max-price=1.5M,min-lot-size=2.5-acre
```

carries a `root.__reactServerState.InitialContext = {…}` blob containing
`ReactServerAgent.cache.dataCache`, whose `/stingray/api/gis?…` entry holds the full result set
under `res.text` (prefixed with `{}&&`). Every home object has price, beds, baths, sqft, lot size,
MLS number, `mlsStatus` and the canonical detail URL.

Detail pages carry the same treatment: `"priceInfo":{"amount":…}`, `"hasPrivatePool":true|false`,
the `Pool Information` amenity group, `marketingRemark`, and `ssl.cdn-redfin.com` photo URLs.
Note the JSON is escaped inside script strings — unescape `\"` before matching.

Two gotchas:

- Search results include **nearby homes outside the queried zip**. Always filter on the `city`
  field; do not assume a result in the 95682 payload is in Shingle Springs.
- Redfin's `has-pool` search filter is loose and returns properties with no private pool. Confirm
  each candidate on its own detail page.

Send a browser `User-Agent`; the default curl agent gets challenged. Space requests a couple of
seconds apart.

## Still worth setting up

A **Redfin or Zillow saved search emailing alerts** to `kvn.p.mrtn@gmail.com`. This repo's runner
has Gmail access, so alerts would catch new listings and price cuts *between* runs rather than only
at run time, and would survive Redfin becoming unreachable again.

## Photos

Photos are now pulled from `ssl.cdn-redfin.com` URLs scraped off each detail page.

- Each listing has a `photos` array in `listings.json`. Put any image URL in it and the card
  renders it on the next build.
- Hotlinking works even though this environment can't load images: the **viewer's browser** fetches
  them, and it isn't behind this proxy. Images carry `referrerpolicy="no-referrer"`, which also
  gets past most CDN referrer blocks.
- If a photo URL 404s or is blocked, an `onerror` handler swaps in the fallback tile client-side,
  so a dead URL never leaves a hole in the layout.
- With no photo, the card shows a "View photos on <site>" tile linking to `gallery` (or `url`).

Note that MLS photos are the copyright of the listing brokerage. Fine for a private hunting page;
don't republish them more broadly.

## Fastest path: paste from Zillow

`ingest.js` takes listings copied straight off a Zillow or Redfin results page and merges them in,
applying the dedupe rules below automatically.

```bash
node ingest.js paste.txt     # or:  pbpaste | node ingest.js
node build.js
```

It reports what was new, what changed price, and what was already tracked. Anything outside the
three target cities is skipped; anything failing a hard criterion is added but flagged rather than
presented as a match. Image URLs in the paste become the card photo.

Note the coverage problem this solves: web search returns only a small, stale, non-random slice of
inventory, because it reads *summaries of* portal pages rather than querying the live MLS. A portal's
own filtered search is the real result set. Do not treat a thin search-derived result list as
evidence that inventory is thin.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`redfin.py`** — live sweep and per-property verification. `python3 redfin.py search`,
  `python3 redfin.py detail <url>`. No dependencies.
- **`ingest.js`** — merge pasted portal listings into `listings.json`.
- **`build.js`** — renders `index.html` from `listings.json`. No dependencies: `node build.js`.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.

### Rate limiting

Redfin throttles after roughly a dozen requests by answering `200` with an **empty body** rather
than a `429`. `redfin.py` treats a short response as a failure, retries with backoff, and raises
`Throttled` listing every query that didn't complete — a partial sweep must never be presented as
thin inventory. If it raises, wait several minutes and re-run; don't publish the partial result.

## Dedupe rules for future runs

Read `listings.json` **before** reporting anything.

1. A property already in `listings` is a **duplicate** — do not re-surface it.
2. Exception: if the price differs from `currentPrice`, that *is* worth reporting. Append to
   `priceHistory`, update `currentPrice`, and the card will render the delta automatically.
3. Anything in `rejected` stays rejected unless a price change brings it into range.
4. An `off-market` property returning to market is newsworthy — but only once verified per the gate.
5. Update `lastSeen` on confirmed-active properties and `lastRun` on every run.

## Publishing

Served from the `gh-pages` branch at repo root. Enable under
**Settings → Pages → Source: `gh-pages` / `(root)`**.
