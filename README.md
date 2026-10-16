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

## How a run works

```bash
python3 scan.py --print   # live pull + filter + pool verification -> scan-results.json
# review, then update listings.json
node build.js             # regenerate index.html
```

`scan.py` pulls the **full active inventory** for all three towns from Redfin's public data
endpoints, filters locally on beds/baths/acreage/price, then reads each surviving property's own
listing-detail API for status, remarks, agent and photos.

Regions are resolved once and hardcoded. One gotcha worth remembering: Redfin's
location-autocomplete `type` field is *not* the gis API's `region_type` — autocomplete `2` (city)
and `4` (ZIP) map to gis `6` and `2`. Rescue has no Redfin "city" record, so it is pulled by ZIP
95672. Every Redfin JSON response is prefixed with `{}&&` to defeat JSON hijacking; strip it before
parsing.

## ⚠️ Verification gate — still in force

The 2026-07-26 run reported four properties as matches. **All four were off market.** Listing status
had been inferred from search-engine result text, and search engines index sold listings with
"For Sale" in the `<title>` for years after close. A second failure compounded it: snippets
conflated two properties on the same street, producing a listing with the wrong MLS number, bed
count and price.

Rules that follow, and that `scan.py` now enforces mechanically:

1. A property may only be given `status: "match"` when its active status is confirmed against a
   **live listing page or authoritative feed**. Search-result text is not sufficient.
2. MetroList MLS numbers encode the listing year: `221…` = 2021, `225…` = 2025, `226…` = 2026. A
   prefix older than the current year is strong evidence the listing is stale.
3. Pool is confirmed from **two independent signals** — the MLS amenity block and the listing
   remarks. Where they disagree, `scan.py` sets `poolConflict` and a human decides. (On 2026-10-16
   one property, 3720 Four Springs Dr, had no MLS amenity block at all — only assessor data — but
   remarks describe "a stunning built-in pool". Judged a match.)
4. Prefer *under*-reporting. An empty result is correct and useful; a fabricated match is not.

## Network

Outbound access to `www.redfin.com` and `ssl.cdn-redfin.com` **was open as of 2026-10-16**, which is
what makes the live pipeline above possible. Previous runs were fully blocked; see `NETWORK.md` for
the history, the full allowlist, and how to tell an egress denial from a site-level bot block.

Status at the time of the last run: redfin `200`, zillow `200`, realtor.com `429`, homes.com `403`.
If Redfin starts returning `403`, check `curl -sS "$HTTPS_PROXY/__agentproxy/status"` to see whether
it is the gateway or the site, and fall back to Zillow/Redfin saved-search email alerts into the
connected Gmail — that path needs no network change and carries both status and photo URLs.

## Photos

Photos are hotlinked from `ssl.cdn-redfin.com`. The **viewer's browser** fetches them, so they
render even when the generating environment cannot load images. `referrerpolicy="no-referrer"` gets
past most CDN referrer blocks, and an `onerror` handler swaps in a fallback tile client-side so a
dead URL never leaves a hole in the layout.

MLS photos are the copyright of the listing brokerage. Fine for a private hunting page; don't
republish more broadly.

## Dedupe rules for future runs

Read `listings.json` **before** reporting anything.

1. A property already in `listings` is a **duplicate** — do not re-surface it as new. Clear its
   `new: true` flag on the next run.
2. Exception: if the price differs from `currentPrice`, that *is* worth reporting. Append to
   `priceHistory` and update `currentPrice`; the card renders the delta and the property appears in
   the "Price changes" strip automatically.
3. Anything in `rejected` stays rejected unless a price change brings it into range.
4. Drop anything no longer Active — move it to `dropped` with the status you observed, so a genuine
   relist is recognisable rather than re-reported as a new find.
5. Update `lastSeen` on confirmed-active properties and `lastRun` on every run.

## Files

- **`listings.json`** — canonical data. Single source of truth. `new: true` drives the highlight
  strip at the top of the page.
- **`scan.py`** — live Redfin pull, filter, and pool verification. Writes `scan-results.json`
  (gitignored).
- **`build.js`** — renders `index.html` from `listings.json`. No dependencies: `node build.js`.
- **`ingest.js`** — merges listings pasted from a Zillow/Redfin results page. Kept as a manual
  fallback for when the live pull is blocked.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.
