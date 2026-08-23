# House Hunting — El Dorado County

Automated house-hunt tracker for **Shingle Springs**, **Rescue**, and **Placerville, CA**.

## Criteria

| Requirement | Value |
|---|---|
| Bedrooms | 4+ *(was 5+ before the 2026-08-23 run)* |
| Bathrooms | 3+ |
| Pool | Required |
| Lot size | 2.5 acres minimum, 5+ preferred |
| Max price | $1,500,000 |

## How a run works

Network egress to listing sites opened up as of **2026-08-23**, so the tracker no longer depends on
search-engine text. A run is now three steps:

1. **Search.** Fetch `https://www.redfin.com/zipcode/<zip>` for **95667** (Placerville), **95682**
   (Shingle Springs) and **95672** (Rescue). Each page embeds the full GIS search payload — every
   active listing in the ZIP with beds, baths, price, lot size, MLS number and status — inside
   `te.InitialContext` as JSON-escaped API responses. `scripts/parse_search.py` pulls it out.
   Redfin's `include_nearby_homes=true` spills results into neighbouring areas, so filter on the
   `city` field, not the ZIP.
2. **Filter.** Beds ≥ 4, baths ≥ 3, price ≤ $1.5M, acres ≥ 2.5, city in the three targets.
3. **Verify each survivor.** Fetch the property's own detail page and read
   `/stingray/api/v1/home/details/belowTheFold` (the MLS amenity groups, including
   **Pool Information**) and `/stingray/api/home/details/aboveTheFold` (status, price, lot, photos).
   `scripts/parse_detail.py` does this.

```bash
python3 scripts/parse_search.py  work/rf_*.html   > work/all.json
python3 scripts/parse_detail.py  work/det        work/details.json
node build.js
```

Redfin rate-limits: a burst of requests starts returning **HTTP 202 with a zero-length body**. That
is throttling, not a dead listing — sleep 8–15s and retry, and never read a 202 as "off market".

## ⚠️ Verification gate — read before reporting anything

The 2026-07-26 run reported four properties as matches. **All four were off market.** Two distinct
bugs caused it, and both have specific defences now:

1. *Status was inferred from search-result text.* Search engines index sold listings with "For Sale"
   in the `<title>` for years. **Rule:** a property may only be given `status: "match"` when
   `mlsStatus` / `status.displayValue` reads `Active` on its own live listing page. Search-result
   text is never sufficient.
2. *Two properties on the same street were conflated*, producing a listing with the wrong MLS
   number, bed count and price. The cause is that a Redfin detail page embeds **comparable and
   nearby-home payloads alongside the subject property's own**, and a naive regex over the page
   happily reads a neighbour's amenities. **Rule:** `parse_detail.py` asserts that the
   `propertyId` in each API blob's query params equals the `propertyId` in the requested URL before
   trusting a single field, and records the result as `scopeOk`. Do not relax this.

Still standing:

3. MetroList MLS numbers encode the listing year: `221…` = 2021, `225…` = 2025, `226…` = 2026. A
   prefix older than the current year is strong evidence of a stale listing.
4. Prefer *under*-reporting. An empty result is correct and useful; a fabricated match is not.

### Pool detection

The `Pool Information` amenity group carries `Has Private Pool: Yes|No` plus `Pool Features`.
Trust that over the marketing copy. Two edge cases:

- **`Has Spa: Yes` is not a pool.** A hot tub is not what's being asked for; it belongs in
  `checkedNoPool` with the reason noted.
- **Multi-unit / residential-income listings carry no `Pool Information` group at all.** 1781
  Springvale Rd is the live example — its 150,000-gallon pool appears only in the marketing remarks.
  When the group is absent, read the remarks before concluding there's no pool, and flag what the
  bed count actually means (that one spreads 4 beds across three separate structures).

## Coverage

Each ZIP query returns fewer rows than Redfin's 350-row page cap, so no result set is truncated —
worth re-checking each run, because a truncated page looks exactly like a thin market. Adjacent ZIPs
(95619, 95623, 95664, 95726) are swept as a completeness check for target-city addresses that fall
outside the three primary ZIPs; as of the 2026-08-23 run this surfaced nothing new.

## Dedupe rules for future runs

Read `listings.json` **before** reporting anything.

1. A property already in `listings` is a **duplicate** — do not re-surface it. Clear its `isNew`
   flag on the run after it first appears, and update `lastSeen`.
2. Exception: if the price differs from `currentPrice`, that *is* worth reporting. Append to
   `priceHistory` and update `currentPrice`; the card renders the delta and the listing is hoisted
   back into "New this run" automatically.
3. Anything in `checkedNoPool`, `dropped` or `rejected` stays there unless something material
   changes (a pool added, a relist, a price cut into range).
4. A listing that disappears from the active feed, or whose detail page reads `Closed` / `Sold` /
   `Off market`, moves to `dropped` and comes off the page.
5. Update `lastRun` every run.

## Photos

Each listing carries up to five hotlinked Redfin CDN URLs in `photos` — first as the card hero, the
rest as a thumbnail strip. They're pulled from `mediaBrowserInfo.photos[].photoUrls`, scoped to the
subject listing. Images carry `referrerpolicy="no-referrer"`, and an `onerror` handler swaps in the
"all N photos" tile if a URL dies, so a stale image never leaves a hole in the layout.

MLS photos are the copyright of the listing brokerage. Fine for a private hunting page; don't
republish them more broadly.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`scripts/parse_search.py`** — extracts the GIS search payload from a Redfin ZIP page.
- **`scripts/parse_detail.py`** — extracts subject-scoped MLS detail from a Redfin listing page.
- **`ingest.js`** — merge listings pasted from a portal into `listings.json` (manual fallback).
- **`build.js`** — renders `index.html` from `listings.json`. No dependencies: `node build.js`.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.

## Publishing

Served from the `gh-pages` branch at repo root. Enable under
**Settings → Pages → Source: `gh-pages` / `(root)`**.
