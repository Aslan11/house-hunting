# House Hunting — El Dorado County

Automated house-hunt tracker for **Shingle Springs**, **Rescue**, and **Placerville, CA**.

Published page: `gh-pages` branch at repo root.

## Criteria

| Requirement | Value |
|---|---|
| Bedrooms | 4+ |
| Bathrooms | 3+ |
| Pool | Required |
| Lot size | 2.5 acres minimum, 5+ preferred |
| Max price | $1,500,000 |

## Status: the pipeline works

As of the 2026-10-15 run, outbound HTTPS to Redfin and Zillow is **open** from this container.
That changed everything — listing status is now read from live listing pages instead of guessed
from search snippets, and photos come straight from the MLS CDN.

The 2026-07-26 run reported four matches and **all four were off market**. That failure is what the
verification rules below exist to prevent. They are still in force.

## Verification gate — read before reporting anything

1. **Status** may only be taken from the property's own live listing page — the
   `mlsStatusDisplay.displayValue` field, which backs the green "For sale" banner. Confirm the price
   on the page matches the price in the feed. Search-result text is never sufficient. Neither is
   `aboveTheFold`'s `addressSectionInfo.status`: unauthenticated it returns **"Sold" for everything**,
   including listings that are plainly active.
2. **Pool** may only be taken from data attributed to *that* property:
   - its MetroList **Pool Information** amenity group (`belowTheFold` API), or
   - the county **public record** pool flag (`hasPrivatePool`), or
   - photo captions keyed to its **own MLS number** (`genMid.<MLS>_N.jpg`).

   Do **not** grep the page for "pool". Redfin listing pages embed comparable listings' full
   descriptions, so a page for a house with no pool contains several other houses' pool prose. That
   is a real trap — it produced false matches on the first attempt at this run.
3. **Cross-check** every match against a second source (Zillow's search API with `hasPool`). Where
   the two disagree, report the disagreement rather than picking one.
4. Bath counts differ by source: Zillow rounds 2 full + 1 half up to "3.0". **MetroList is
   authoritative** — read it from the listing's `og:description`.
5. MetroList MLS numbers encode the listing year: `221…` = 2021, `225…` = 2025, `226…` = 2026.
   A prefix older than the current year is strong evidence the listing is stale.
6. Prefer *under*-reporting. An empty result is correct and useful; a fabricated match is not.

## How a run works

```bash
node build.js      # regenerates index.html from listings.json
```

The data gathering is three steps:

1. **Sweep the county.** One CSV pull gets every active listing in El Dorado County at 4BR+ under
   the price ceiling — far better coverage than per-city queries, and it catches target-city
   addresses that sit in unexpected ZIPs.

   ```
   https://www.redfin.com/stingray/api/gis-csv?al=1&market=sacramento&max_price=1600000
     &num_beds=4&num_homes=350&ord=redfin-recommended-asc&page_number=1
     &region_id=311&region_type=5&sf=1,2,3,5,6,7&status=9&uipt=1,2,3,4,5,6,7,8&v=8
   ```

   Region 311 / type 5 is El Dorado County. `status=9` is active-only. Send a browser `User-Agent`.
   The CSV's `min_lot_size` parameter is **ignored** — filter lot size locally from the `LOT SIZE`
   column (sqft; 2.5 acres = 108,900). Filter city locally too, from the `CITY` column.

2. **Verify each candidate** against its own listing page and the `belowTheFold` amenity API, per
   the gate above. Property IDs come from the `/home/<id>` segment of the CSV's URL column.

3. **Cross-check** against Zillow:

   ```
   PUT https://www.zillow.com/async-create-search-page-state
   {"searchQueryState":{"mapBounds":{...},"filterState":{"beds":{"min":4},"baths":{"min":3},
    "price":{"max":1600000},"lotSize":{"min":108900},"hasPool":{"value":true}}},
    "wants":{"cat1":["listResults"]}}
   ```

   Note Redfin's CSV carries the disclaimer that some MLS listings are excluded from download, so
   this second source is not optional.

`ingest.js` remains available for merging listings pasted from a portal by hand; it is a fallback
for when the APIs are unreachable, not the main path.

## Dedupe rules for future runs

Read `listings.json` **before** reporting anything.

1. A property already in `listings` is a **duplicate** — do not re-surface it as new.
2. Exception: a changed price *is* news. Append to `priceHistory`, update `currentPrice`, and the
   card renders the delta automatically.
3. Clear `newThisRun` on everything carried over, and set it only on genuinely new entries. The
   banner at the top of the page is driven by that flag.
4. Anything in `rejected` stays rejected unless a price change brings it into range.
5. Anything in `dropped` stays dropped unless it genuinely returns to market — verified per the gate.
6. **Drop** any tracked listing whose live status is no longer Active (Sold, Closed, Pending,
   Off market), recording why in `dropped`.
7. Update `lastSeen` on confirmed-active properties and `lastRun` on every run.

## Photos

Photo URLs are MLS-keyed Redfin CDN links (`genMid.<MLS>_<n>.jpg`), collected per property so a
card can never show a neighbour's house. Pool shots are sorted to the front. Images carry
`referrerpolicy="no-referrer"` and an `onerror` handler that removes a dead thumbnail rather than
leaving a hole.

MLS photos are the copyright of the listing brokerage. Fine for a private hunting page; don't
republish them more broadly.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`build.js`** — renders `index.html` from `listings.json`. No dependencies.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.
- **`ingest.js`** — fallback: merge listings pasted from a portal.
- **`NETWORK.md`** — what to do if outbound access to the listing sites closes again.

## Publishing

Served from the `gh-pages` branch at repo root. Enable under
**Settings → Pages → Source: `gh-pages` / `(root)`**.
