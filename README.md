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
node scrape.js      # refresh listings.json from the live MLS feed
node build.js       # render index.html
```

`node scrape.js --dry` scrapes and reports without writing, which is the safe way to
check what a run *would* change.

Takes roughly 5–8 minutes, almost all of it waiting on the ~70 detail-page fetches.

## Where the data comes from

The **Coldwell Banker Homes** site (`coldwellbankerhomes.com`) republishes the MetroList
MLS IDX feed — MetroList is the MLS that actually covers El Dorado County — and serves it
as clean JSON-LD. It does not bot-block this environment, which nearly everything else does.

The pipeline is three stages:

1. **Enumerate.** Walk `/ca/<city>/p_N/` for each of the three cities. Each page carries a
   JSON-LD `CollectionPage` with 24 `RealEstateListing` records: address, price, beds,
   baths, sqft, geo, photo. This is the *complete* active inventory, not a search-engine
   sample — roughly 300 listings across the three towns.
2. **Filter.** Keep the ones clearing beds, baths and price. Typically ~67 of ~307.
3. **Verify.** Fetch each survivor's detail page for the fields the search page lacks:
   `Lot Size (Acres)`, the `Pool` / `Pool Description` fields, and the true listing status.

## ⚠️ Two traps that have already burned this tracker

**1. Search-engine snippets are not listing status.** The first run reported four matches;
all four were off market. Search engines index listing pages that keep "For Sale" in the
`<title>` for years after closing, and snippets conflated two properties on the same street
into one listing with the wrong MLS number, bed count and price. Only a live listing page
or an authoritative feed counts.

**2. `IsActive` is true on pending listings.** The IDX feed exposes an `IsActive` boolean
and a schema.org `availability: InStock`. Both stay set on listings that are already in
escrow. Two of the twelve otherwise-qualifying properties found on 2026-07-28 were
**Sale Pending** despite `IsActive: true`. Status is therefore read from the listing's own
visible `Status:` field, which `scrape.js` stores as `mlsStatus` — never from `IsActive`.

Corollaries worth keeping:

- MetroList MLS numbers encode the listing year: `221…` = 2021, `225…` = 2025, `226…` = 2026.
  A prefix older than the current year is strong evidence a record is stale.
- Prefer under-reporting. An empty result is correct and useful; a fabricated match is not.

## Cross-run behaviour

`scrape.js` merges rather than overwrites, so the schedule can run unattended:

| Situation | What happens |
|---|---|
| Property already tracked, same price | Kept, `newThisRun: false`, not re-surfaced |
| Property already tracked, price moved | `priceHistory` gains an entry; the card renders the delta and it appears under "Price changes" |
| Property not seen before | `newThisRun: true`, appears in the "New this run" strip at the top |
| Tracked property no longer active | Moved to `dropped` with the date and reason |
| Qualifies but is in escrow | Moved to `pending`, rendered dimmed under "Under contract" |
| Fails exactly one of pool / acreage | Recorded in `nearMisses` and shown as a table |

A second run against unchanged inventory reports `0 new, 0 price changes` — that is the
intended behaviour, and the quickest way to confirm dedupe still works.

## Photos

Each listing carries up to six photo URLs in `photos`, hotlinked from the brokerage CDN and
rendered as a horizontally scrollable strip. They are served with
`referrerpolicy="no-referrer"`, which gets past most CDN referrer checks.

The "View on coldwellbankerhomes.com" tile sits permanently *behind* the photo strip rather
than being swapped in on error. Loaded images cover it; an image that 404s **or one that
simply never resolves** both leave the listing link reachable. (Relying on the `onerror`
handler alone left a blank tile whenever a request hung instead of failing.)

MLS photos are the copyright of the listing brokerage. Fine for a private hunting page;
don't republish them more broadly.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`scrape.js`** — refreshes `listings.json` from the live feed. Handles dedupe and history.
- **`build.js`** — renders `index.html` from `listings.json`. No dependencies.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.
- **`ingest.js`** — manual fallback: merges listings pasted from a Zillow/Redfin results page.
  Only needed if the primary feed ever goes dark.
- **`NETWORK.md`** — what this environment can and cannot reach, and how to re-test.

## Publishing

`index.html` is copied to the `gh-pages` branch at repo root. Enable under
**Settings → Pages → Source: `gh-pages` / `(root)`**.
