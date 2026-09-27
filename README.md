# House Hunting — El Dorado County

Automated house-hunt tracker for **Shingle Springs**, **Rescue**, and **Placerville, CA**.
Published from the `gh-pages` branch.

## Criteria

| Requirement | Value |
|---|---|
| Bedrooms | 4+ |
| Bathrooms | 3+ |
| Pool | Required |
| Lot size | 2.5 acres minimum, 5+ preferred |
| Max price | $1,500,000 |

## Running it

```bash
python3 scan.py        # refresh listings.json from the live Redfin feed
node build.js          # render index.html
```

`scan.py --dry` prints what would change without writing. Neither script has dependencies.
Fetches are cached in `.cache/` (gitignored); delete it to force a clean pull.

## Where the data comes from

Redfin server-renders both its search pages and its detail pages with the full API response
embedded in `root.__reactServerState.InitialContext`. `scan.py` reads that JSON directly, which is
what makes status trustworthy — it is the same MetroList MLS feed the site itself displays.

Two passes per run:

1. **Search.** Each town is queried twice, once by Redfin city region and once by ZIP
   (95682 / 95667 / 95672), with `min-beds=4,min-baths=3,max-price=1.5M,min-lot-size=2.5-acre`
   applied server-side. Scanning both catches unincorporated addresses that carry a town's postal
   name but fall outside its Redfin city polygon. Only `originalHomes` is read — the same response
   carries out-of-region "nearby homes" that do not satisfy the location filter.
2. **Detail.** Every candidate's own listing page is opened and the MLS fields are read:
   `mlsStatusDisplay`, price, beds, baths, lot size, `POOL_PRIVATE_YN`, photos, and the agent's
   marketing remarks.

Pool is **not** a reliable Redfin search facet for this MLS, so it is verified per-listing. The
order of authority is `POOL_PRIVATE_YN` (the field the listing agent fills in), then the public
records `hasPrivatePool`. If neither resolves, the pool is `null` and the property is **not**
promoted to a match.

Redfin answers `202` with an empty body when it throttles. `scan.py` treats that as retryable with
exponential backoff; a genuine error status is raised.

## ⚠️ Verification gate — read before reporting anything

The first run of this tracker reported four properties as matches. **All four were off market.**

Root cause: listing status was inferred from search-engine result text, because no listing site was
reachable at the time. Search engines index listing pages that keep "For Sale" in the `<title>` for
years after the sale closes, so stale listings read as active. A second failure compounded it —
search snippets conflated two different properties on the same street, producing a listing with the
wrong MLS number, bed count and price.

Reading the live feed fixes the cause, but the rules still hold:

1. A property may only be given `status: "match"` when its active status is confirmed against a live
   listing page or an authoritative feed. Search-result text is **not** sufficient.
2. A detail page's own JSON is the only source for that property's facts. Redfin detail pages also
   embed *similar* and *nearby* homes, and their descriptions mention pools; a naive grep for
   "pool" over the page will produce false positives. 3900 Loma Dr is the live example — the page
   contains the phrase "an in ground pool", belonging to a different home, while the subject's own
   `POOL_PRIVATE_YN` is `No`.
3. MetroList MLS numbers encode the listing year: `221…` = 2021, `223…` = 2023, `225…` = 2025,
   `226…` = 2026. A prefix older than the current year is strong evidence the listing is stale.
4. Prefer *under*-reporting. An empty result is correct and useful; a fabricated match is not.

## What the page shows

- **New this run** — first appearance on the list, highlighted at the top.
- **Price changed** — already tracked, asking price moved. `priceHistory` drives the delta.
- **Still on the market** — tracked, active, unchanged.
- **Near misses** — active and clearing every bar except one (almost always the pool). Recorded so
  the same properties aren't re-researched next run.
- **Dropped** — gone from active inventory. Kept only so a genuine relist reads as news rather than
  as a new find. A property that returns to market is removed from this table automatically.

## Dedupe rules

`scan.py` enforces these; they're written down so a manual edit doesn't break them.

1. A property already in `listings` is a duplicate and is not re-surfaced as new.
2. A price differing from `currentPrice` **is** news: it appends to `priceHistory` and the card
   renders the delta.
3. Anything no longer in live active inventory is dropped from the page and moved to `removed`.
4. A property in `removed` that reappears is treated as new and leaves the dropped table.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`scan.py`** — refreshes `listings.json` from the live Redfin feed.
- **`build.js`** — renders `index.html` from `listings.json`.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.
- **`ingest.js`** — manual fallback: merge listings pasted off a Zillow/Redfin results page.
- **`NETWORK.md`** — egress notes. Kept for the record; Redfin is reachable as of 2026-09-27.

## Photos

Photo URLs come off the detail page's `mediaBrowserInfo.photos[].photoUrls` and are hotlinked from
`ssl.cdn-redfin.com`. This works even though the build environment can't load images: the
**viewer's** browser fetches them. Images carry `referrerpolicy="no-referrer"`, which clears most
CDN referrer checks, and an `onerror` handler swaps in a "view gallery" tile so a dead URL never
leaves a hole in the layout.

MLS photos are the copyright of the listing brokerage. Fine for a private hunting page; don't
republish them more broadly.

## Publishing

Served from the `gh-pages` branch at repo root:
**Settings → Pages → Source: `gh-pages` / `(root)`**.
