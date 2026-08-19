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

> The 2026-07-26 run recorded the bedroom minimum as 5. The standing search request says **4+**,
> which is what the 2026-08-19 run applied. If 5 is actually right, change `criteria.beds` in
> `listings.json` and re-filter — three of the current matches would drop out.

## Data pipeline (working as of 2026-08-19)

Portals (Zillow, Redfin, Realtor, Trulia, Homes.com, Movoto) bot-block this environment, and
`WebFetch` gets 403/405 from them. **Broker IDX sites do not.** They serve the same MetroList MLS
feed as server-rendered HTML with structured per-listing fields, which is what this tracker reads.

| Source | Role | What it gives |
|---|---|---|
| `coldwellbankerhomes.com` | Primary | Server-rendered search results + detail pages. JSON-LD `LocationFeatureSpecification` blocks carry every MLS field: status, beds, baths, **lot acreage**, **`Pool` / `Pool Description`**, year built, garage, horse property. Photo CDN URLs included. |
| `homefinder.com` | Cross-check | `__NEXT_DATA__` JSON carrying MetroList records via the Move/realtor.com pipeline. Independent of the primary. Indexes ~40 listings per city, so it can't confirm everything. |

Scripts live in the run scratchpad, not the repo; the durable artifacts are `listings.json` (data)
and `build.js` (renderer). The shape of a run:

1. Scrape all result pages for the three cities → ~300 live listings.
2. Filter on beds / baths / price from card data.
3. Fetch a detail page per candidate → acreage and pool from MLS fields.
4. Filter on acreage ≥ 2.5 and pool present.
5. Cross-check each survivor against Homefinder; record whether it agreed.
6. Merge into `listings.json` under the dedupe rules below, then `node build.js`.

### Useful details

- CB search card classes differ by property type — `beds` vs `total-beds`, `sq.-ft.` vs `sq-ft`.
  Parse both or you silently lose most listings.
- MetroList MLS numbers encode the listing year: `221…` = 2021, `225…` = 2025, `226…` = 2026.
  A prefix older than the current year on a supposedly-active listing is a red flag.
- Photo URLs (`m.cbhomes.com/p/…/m23cc.webp`) hotlink fine — no referrer or auth needed. They fail
  to load *inside this environment* (the local agent proxy resets Chromium's connections), but they
  load normally in a real browser. Don't "fix" that.
- Curl with a desktop User-Agent. Without one, some hosts return stubs.

## Verification gate — read before reporting anything

The first run reported four properties as matches. **All four were off market**, because listing
status was inferred from search-engine snippets, which index sold listings with "For Sale" in the
title for years.

**Rules:**

1. A property may only reach the board when its active status comes from a **live MLS-fed source**.
   Search-result text is never sufficient.
2. Take pool and acreage from **MLS structured fields**, not marketing prose — otherwise "room for a
   pool" reads as a pool.
3. Cross-check against the second feed where it has the listing. Where it doesn't, say so on the
   card rather than implying the same confidence.
4. Run the **negative control** every time: re-check previously-confirmed-off-market addresses
   against the live feed. They must be absent. If a known-dead listing shows up as active, the
   pipeline is broken — stop and fix it before publishing.
5. Prefer under-reporting. An empty board is a useful result; a fabricated match is not.

## Dedupe rules for future runs

Read `listings.json` **before** reporting anything.

1. A property already in `listings` is a **duplicate** — don't re-surface it as new. Clear `isNew`
   on entries carried over from the previous run.
2. Exception: a changed price *is* news. Append to `priceHistory`, update `currentPrice`; the card
   and the top-of-page digest render the delta automatically.
3. Anything in `rejected` stays rejected unless a price change brings it into range.
4. A property that disappears from the live feed has gone off market — move it to `removed` and off
   the board.
5. An `off-market` property returning to market is newsworthy, but only once it passes the gate.
6. Update `lastSeen` on confirmed listings, and `lastRun` / `previousRun` on every run.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`build.js`** — renders `index.html`. No dependencies: `node build.js`.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.
- **`ingest.js`** — merges listings pasted from a Zillow/Redfin results page. A manual fallback,
  kept for when the IDX route breaks.

Note that MLS photos are copyright of the listing brokerage. Fine for a private hunting page; don't
republish them more broadly.

## Publishing

Served from the `gh-pages` branch at repo root:
**Settings → Pages → Source: `gh-pages` / `(root)`**.
