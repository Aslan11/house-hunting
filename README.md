# House Hunting — El Dorado County

Automated house-hunt tracker for **Shingle Springs**, **Rescue**, and **Placerville, CA**.

Published from the `gh-pages` branch.

## Criteria

| Requirement | Value |
|---|---|
| Bedrooms | **4+** (was 5+ before the 2026-09-21 run) |
| Bathrooms | 3+ |
| Pool | Required |
| Lot size | 2.5 acres minimum, 5+ preferred |
| Max price | $1,500,000 |

## How the pipeline works

Network egress was blocked for earlier runs and is open again as of 2026-09-21, so the tracker now
reads live MLS data instead of guessing from search snippets.

1. **Inventory** — `coldwellbankerhomes.com` serves a live MetroList IDX feed as server-rendered
   HTML, and it does not bot-block this environment. Paginate a city with `?offset=N`:

   ```
   https://www.coldwellbankerhomes.com/ca/shingle-springs/
   https://www.coldwellbankerhomes.com/ca/placerville/?offset=24
   ```

   The result count is in `data-count`; each card is a `property-snapshot-psr-panel` div carrying
   address, price, beds, baths, sqft, MLS number and status. Acreage and pool are **not** on the
   card — they need the detail page.

2. **Detail** — each card's `data-detailurl` leads to a page with a JSON-LD
   `LocationFeatureSpecification` list. The fields that matter: `Lot Size (Acres)`, `Pool`,
   `Pool Description`, `Year Built`.

3. **Verification** — every candidate is re-checked against **MetroListPRO**
   (`https://www.metrolistpro.com/homes/2/6/a/<MLS>`), the official search site of MetroList, the
   MLS for El Dorado County. The slug segment is ignored, so only the MLS number matters. It exposes
   a live `Status` field (`Active`, `Contingent - Show`, …) plus price, beds, baths (`2 | 1` means
   two full and one half), `Lot Size in Acres`, `Pool`, agent and office. A 404 means the listing is
   not in the IDX feed.

On the 2026-09-21 run this read 309 active listings across the three towns, narrowed to 48 on
beds/baths/price, and verified 47 of those 48 on MetroListPRO.

### Sites that do *not* work from here

Zillow, Redfin, Trulia, Homes.com, Movoto, Realtor.com, LandWatch and KW all return 403/429 — these
are **site-level bot blocks on the datacenter IP**, not proxy denials. Confirm the difference with
`curl -sS "$HTTPS_PROXY/__agentproxy/status"`: an empty `recentRelayFailures` means egress is open
and the site itself refused. Do not waste a run retrying them.

## ⚠️ Verification gate — read before reporting anything

The 2026-07-26 run reported four properties as matches. **All four were off market.** Status had
been inferred from search-engine result text, which indexes sold listings with "For Sale" in the
title for years. A second failure compounded it: search snippets conflated two properties on the
same street, producing a listing with the wrong MLS number, bed count and price.

**Rules that follow:**

1. A property may only be given `status: "match"` when its status is confirmed against a live
   listing page or an authoritative feed. Search-result text is **not** sufficient. MetroListPRO is
   the authority; Coldwell Banker's IDX is acceptable corroboration.
2. MetroList MLS numbers encode the listing year: `221…` = 2021, `225…` = 2025, `226…` = 2026.
   A prefix older than the current year is strong evidence of a stale listing.
3. Cross-check bed/bath/price against at least two independent sources. **If they disagree, report
   the disagreement** on the card rather than picking one. See 3538 Wildwood Ln for a live example.
4. Prefer *under*-reporting. An empty result is correct and useful; a fabricated match is not.
5. Watch the bath count. MetroList's "Total Baths: 3" can mean two full and one half — which is
   2.5 baths by the usual reckoning and **fails** a 3-bath minimum. The `bathsLabel` field carries
   the honest breakdown.

### Photo hazard

Detail pages embed "similar listings" carousels, so a naive scrape of `m.cbhomes.com` image URLs
pulls in **other properties' photos**. Always constrain the photo URL to the listing's own MLS
number:

```
https://m.cbhomes.com/p/<prefix>/<THIS LISTING'S MLS>/<photoid>/m23cc.webp
```

Also size-check each URL: anything under ~9 KB is a placeholder asset, not a photograph. This bug
was caught and fixed on the 2026-09-21 run; do not reintroduce it.

Hotlinking works even though images can't be previewed here: the **viewer's** browser fetches them.
Images carry `referrerpolicy="no-referrer"`, and a dead URL swaps in a fallback tile client-side.
MLS photos are the copyright of the listing brokerage — fine for a private page, don't republish.

## Files

- **`listings.json`** — canonical data. Single source of truth.
  - `listings[]` — verified matches. `isNew` drives the highlight section at the top of the page.
  - `nearMisses[]` — cleared beds/baths/budget, failed exactly one test (usually the pool).
  - `dropped[]` — removed this run, with the reason. Prevents re-surfacing.
  - `rejected[]` — ruled out on earlier runs.
- **`build.js`** — renders `index.html` from `listings.json`. No dependencies: `node build.js`.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.
- **`ingest.js`** — merges listings pasted from a Zillow/Redfin results page, for when the scrape
  path breaks again.

## Dedupe rules for future runs

Read `listings.json` **before** reporting anything.

1. A property already in `listings` is a **duplicate** — do not re-surface it. Clear its `isNew`
   flag on the next run so the highlight section only shows genuinely new finds.
2. Exception: if the price differs from `currentPrice`, that *is* worth reporting. Append to
   `priceHistory` and update `currentPrice`; the card renders the delta automatically.
3. Anything in `rejected` stays rejected unless a price change — or a criteria change — brings it
   back into range. The bedroom minimum moved 5+ → 4+ on 2026-09-21, which required re-checking.
4. A listing that goes `Contingent`, `Pending` or 404s on MetroListPRO is off market: move it to
   `dropped[]` with the reason and drop it from the page.
5. Update `lastSeen` on confirmed-active properties and `lastRun` on every run.
