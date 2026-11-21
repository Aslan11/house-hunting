# House Hunting — El Dorado County

Automated house-hunt tracker for **Shingle Springs**, **Rescue**, and **Placerville, CA**.

Published page: the `gh-pages` branch, served at repo root.

## Criteria

| Requirement | Value |
|---|---|
| Bedrooms | 4+ |
| Bathrooms | 3+ **full** baths |
| Pool | Required |
| Lot size | 2.5 acres minimum, 5+ preferred |
| Max price | $1,500,000 |

Note the bathroom rule: MetroList reports `Bathrooms:` as **full** baths and `1/2 Baths:`
separately, while portal cards add them together. A "3 bath" card can be 2 full + 1 half. Count
full baths.

## The working data source — use this

**MetroList MLS via <https://www.metrolistpro.com>**, the official public search site of the MLS
that covers El Dorado County. This is authoritative and solves status, acreage, pool and photos at
once. Reach it with Playwright + the pre-installed Chromium (`require('playwright')`,
`chromium.launch()` with no options).

### Listing detail pages — direct URL, no UI driving needed

```
https://www.metrolistpro.com/homes/2/6/<ADDRESS>-<CITY>-CA-<ZIP>/<MLS#>
```

e.g. `https://www.metrolistpro.com/homes/2/6/3720-FOUR-SPRINGS-DRIVE-RESCUE-CA-95672/226083791`

The address slug is cosmetic — the MLS number resolves the listing, so **always read the address off
the page** rather than trusting the slug you built. These pages expose structured fields:

- `FOR SALE` / `PENDING` / `SOLD` — the status, from the listing itself
- `Lot Size in Acres:` — do not parse acreage out of marketing prose
- `Has a Pool: Yes|No` and `Pool Description:` — likewise; prose says things like
  "room to add a pool", which reads as a pool to a naive text match
- `Bathrooms:` (full) and `1/2 Baths:`, `Year Built:`, `HOA Fee:`, `Listing Office:`
- Photos on `mediarem.metrolist.net/.../listingpics/...` — filter **out** `agentpics/`,
  which are agent headshots

**An off-market MLS number returns a page reading `Listing #<n> Not Found`.** That is the status
check: 200 + `FOR SALE` means active, `Not Found` means gone. This was validated against the six
properties tracked in July, all of which the user confirmed were off market — all six return
`Not Found`.

### Searching for new inventory

Load `https://www.metrolistpro.com/homesearch/2`, type the town into the
`input[placeholder*="City"]` box, and click the suggestion matching `^<Town> \(\d+\)$`. Then open the
**More** panel and set:

- `Min. Lot Acres` = `2.5` (text input)
- `Pool` checkbox
- `Active Listings Only` checkbox
- **Price** panel → `Max. Price` = `1500000`

Set inputs by assigning `.value` and dispatching `input`/`change`/`keyup` events — the Angular app
listens for those. The beds/baths dropdowns are unreliable to drive; **filter beds and full baths
yourself** from the result cards and detail pages instead.

Result cards carry price, address, beds, baths, sqft and `#MLS`. Collect the MLS numbers, then hit
the detail URLs above for acreage, pool and photos.

Do **not** call the JSON API (`/api/site/2/listings.json`) directly — responses are encrypted and
decrypted client-side.

## Coverage: don't trust a single broker IDX site

Broker IDX sites look complete and are not. On the 2026-11-21 run:

| Source | Placerville active listings |
|---|---|
| MetroList MLS | 145 |
| century21.com city page | 94 (including land) |

Century21 **omitted all six** qualifying Placerville properties that the MLS returned. Always use
the MLS for the result set; broker sites are for cross-checking individual facts.

## Sites that do and don't serve this container

Outbound HTTPS is open (no proxy denials), but several sites bot-block a headless datacenter IP:

| Serves | Blocks |
|---|---|
| metrolistpro.com ✅ | zillow.com, redfin.com, realtor.com |
| century21.com ✅ | homes.com, movoto.com, trulia.com |
| compass.com ✅ | landwatch.com, point2homes.com, remax.com, coldwellbankerhomes.com |

`WebFetch` is unusable here — the proxy answers 405 (it sends a plain-HTTP request). Use Playwright.

## Verification gate — read before reporting anything

The first run of this tracker reported four properties as matches. **All four were off market**,
because status was inferred from search-engine result text. A second failure compounded it: search
snippets conflated two different properties on the same street.

That conflation risk is still live. On 2026-11-21 the Century21 detail page for *2520 Bedford Ave,
Placerville* displayed MLS# `226139705`, which on MetroList is **5366 Horizon Court** — a different
property with a different price, acreage and no pool. The property is recorded under `rejected` as
unverifiable rather than reported.

**Rules:**

1. A property may only be given `status: "match"` when its active status is confirmed against a live
   MLS listing page. Search-result text is **not** sufficient.
2. MetroList MLS numbers encode the listing year: `221…` = 2021, `225…` = 2025, `226…` = 2026. A
   prefix older than the current year is a flag to check carefully.
3. Take acreage, pool, and bath counts from structured MLS fields, never from prose.
4. If two sources disagree, report the disagreement rather than picking one.
5. Prefer *under*-reporting. An empty result is correct and useful; a fabricated match is not.

## Dedupe rules for future runs

Read `listings.json` **before** reporting anything.

1. A property already in `listings` is a **duplicate** — do not re-surface it as new.
2. Exception: if the price differs from `currentPrice`, that *is* worth reporting. Append to
   `priceHistory` and update `currentPrice`; the card renders the delta and the page lifts it into a
   "Price changes" section automatically.
3. Anything in `rejected` stays rejected unless a price change brings it into range.
4. `droppedThisRun` records properties removed because they left the market. Check new finds against
   it so a genuine relist is recognised as a relist, not a new find.
5. Set `firstSeen` to the run date on genuinely new listings — the page derives its
   "New this run" section from `firstSeen === lastRun`. Update `lastSeen` on confirmed-active
   properties and `lastRun` on every run.
6. Re-check every tracked listing's MLS number each run and drop the ones returning `Not Found`.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`build.js`** — renders `index.html` from `listings.json`. No dependencies: `node build.js`.
- **`ingest.js`** — merges listings pasted from a Zillow/Redfin results page, if that is ever easier
  than scraping. Not needed now that the MLS is reachable.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.

## Photos

Each listing has a `photos` array; the first renders as the hero image and the rest as a thumbnail
strip. Images are hotlinked from `mediarem.metrolist.net` with `referrerpolicy="no-referrer"`, and
an `onerror` handler swaps in a fallback tile client-side so a dead URL never leaves a hole.

MLS photos are the copyright of the listing brokerage. Fine for a private hunting page; don't
republish them more broadly.

## Publishing

`index.html` is committed to the `gh-pages` branch at repo root. Enable under
**Settings → Pages → Source: `gh-pages` / `(root)`**.
