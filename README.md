# House Hunting — El Dorado County

Automated house-hunt tracker for **Shingle Springs**, **Rescue**, and **Placerville, CA**.
Published to GitHub Pages from the `gh-pages` branch.

## Criteria

| Requirement | Value |
|---|---|
| Bedrooms | 4+ |
| Bathrooms | 3+ |
| Pool | Required |
| Lot size | 2.5 acres minimum, 5+ preferred |
| Max price | $1,500,000 |

## Status: the pipeline works as of 2026-08-02

Earlier runs of this tracker had no live data source and reported properties that were already
sold. That is fixed. The environment now has open egress, and the tracker reads a live structured
feed of active listings plus each candidate's own MLS record.

```bash
node scan.js            # pull live feed, filter, verify pools -> scan-results.json
node scan.js --merge    # ...and fold into listings.json (new + price changes + drops)
node build.js           # render index.html
```

`scan.js` takes a few minutes — it fetches one detail page per candidate with a delay, because the
host rate-limits.

## How verification works

Everything below is load-bearing. Each item exists because getting it wrong produced a concrete
false result in an earlier run.

**Listing status.** Comes from the live active-listings feed, never from search-engine text. Search
engines index sold listings with "For Sale" in the `<title>` for years, which is exactly how four
sold properties were reported as matches on the first run. As a secondary check, MetroList MLS
numbers encode the listing year — `221…` = 2021, `225…` = 2025, `226…` = 2026 — so a prefix older
than the current year is strong evidence a record is stale.

**Region IDs are not guessable.** Redfin's `region_id` for "Placerville" is not what you would
guess; `17151` returns San Francisco, and county `331` returns Nevada County. The autocomplete
endpoint that resolves IDs properly is bot-blocked. So `scan.js` queries by **map polygon**
instead, which needs no ID at all.

**Silent truncation.** The feed endpoint caps results at `num_homes` and returns a truncated set
with no error — a single county-wide polygon came back with exactly 350 rows. `scan.js` therefore
tiles the area into a grid and **throws** if any tile comes back at the cap, rather than quietly
reporting a partial market as the whole one.

**Half the server-side filters are ignored.** `num_beds` and `num_baths` are honoured.
`max_price` and `min_lot_size` are silently ignored — passing them changes nothing. All price and
acreage filtering therefore happens locally, from the CSV columns. `LOT SIZE` is in square feet.

**Pool detection must read the subject property only.** This is the subtle one. Listing detail
pages embed data for *nearby* homes alongside the subject, so grepping the page for "pool"
attributes a neighbour's pool to the house you are looking at. On the 2026-08-02 run that would
have produced four false matches — including a listing whose page mentions a "150,000-gallon
swimming pool" belonging to a different property entirely. `scan.js` reads the subject's structured
`Pool Information` amenity group, cross-checks the `hasPrivatePool` flag, and cross-checks the
subject-only marketing remarks. A property is reported as having a pool only when all three agree;
anything that disagrees lands in `disputed` for a human to look at.

**Missing data is not the same as failing.** A listing with no published lot size goes to
`unknownLotSize`, not to the discard pile, so the exclusion stays visible.

**Prefer under-reporting.** An empty result is correct and useful. A fabricated match is not.

## Dedupe rules

Handled automatically by `merge.js`; stated here because they are the point of the tracker.

1. A property already in `listings.json` is **not** re-surfaced — it carries over with `isNew: false`.
2. Exception: a changed price *is* worth reporting. `priceHistory` gets a new entry and the card
   renders the delta.
3. A tracked property that disappears from the active feed moves to `dropped` — sold or withdrawn.
   It stays on file only so a genuine relist is recognised rather than reported as a new find.
4. New listings get `isNew: true` and are highlighted in their own section at the top of the page.

## Photos

Photo URLs embed the MLS number in the path
(`…/genMid.<MLS>_0.jpg`), so a photo can be tied to the right property with certainty — worth
keeping, given that mixing up neighbouring properties is this project's characteristic failure.
Images are hotlinked with `referrerpolicy="no-referrer"` and an `onerror` handler that swaps in a
fallback tile, so a dead URL never leaves a hole in the layout.

MLS photos are the copyright of the listing brokerage. Fine for a private hunting page; don't
republish them more broadly.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`scan.js`** — pull the live feed, filter to criteria, verify pools.
- **`merge.js`** — fold a scan into `listings.json` applying the dedupe rules.
- **`build.js`** — render `index.html` from `listings.json`. No dependencies.
- **`ingest.js`** — manual fallback: merge listings pasted from a portal search page.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.
- **`NETWORK.md`** — network notes, kept for reference if egress is ever restricted again.

## Publishing

Served from the `gh-pages` branch at repo root:
**Settings → Pages → Source: `gh-pages` / `(root)`**.
