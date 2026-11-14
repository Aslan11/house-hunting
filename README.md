# House Hunting — El Dorado County

Automated house-hunt tracker for **Shingle Springs**, **Rescue**, and **Placerville, CA**.

Published list: <https://aslan11.github.io/house-hunting/>

## Criteria

| Requirement | Value |
|---|---|
| Bedrooms | 4+ |
| Bathrooms | 3+ |
| Pool | Required |
| Lot size | 2.5 acres minimum, 5+ preferred |
| Max price | $1,500,000 |

> Note: the bedroom minimum was 5+ through the 2026-07-26 run and was lowered to 4+ on 2026-11-14.

## Data source — MetroListPRO

**Source of record: <https://www.metrolistpro.com/> — the official public search site of MetroList
MLS, the MLS for El Dorado County.** It is served by iHomefinder, renders without JavaScript gates,
and does not bot-block this environment.

Per-city active-inventory entry points:

| City | URL |
|---|---|
| Shingle Springs | `/lbc/2/873/6/193/Shingle-Springs-Real-Estate-For-Sale` |
| Rescue | `/lbc/2/765/6/193/Rescue-Real-Estate-For-Sale` |
| Placerville | `/lbc/2/720/6/193/Placerville-Real-Estate-For-Sale` |

County index (all El Dorado cities, with active counts):
`/cbc/2/6/193/El-Dorado-County-Real-Estate-For-Sale`

Each listing detail page is at `/homes/2/6/<ADDRESS-SLUG>/<MLS#>` and exposes exactly the fields
this tracker needs, as labelled `Key: Value` lines:

- `$1,275,000 (CONTINGENT)` — **price and live MLS status** in the page heading
- `Has a Pool: Yes` / `Pool Description: Built-In, Salt Water`
- `Lot Size in Acres: 5.03`
- `Year Built`, `View Description`, `Is a Horse Property`, `School District`, agent and brokerage
- Full-size photos on `mediarem.metrolist.net` (filter out `/agentpics/`)

Fetch with the pre-installed Playwright Chromium (`require('playwright')`, `chromium.launch()`).
Plain `curl` and `WebFetch` are not reliable against it.

## ⚠️ Verification gate — read before reporting anything

The 2026-07-26 run reported four properties as matches. **All four were off market.**

Root cause: listing status was inferred from search-engine result text. Search engines index
listing pages that keep "For Sale" in the `<title>` for years after the sale closes, so stale
listings read as active. A second failure compounded it — search snippets conflated two different
properties on the same street, producing a listing with the wrong MLS number, bed count and price.

**Rules that follow from this:**

1. A property may only be given `status: "match"` when its active status is confirmed on its
   **MetroListPRO detail page**. Search-result text is **not** sufficient.
2. MetroList MLS numbers encode the listing year: `221…` = 2021, `223…` = 2023, `225…` = 2025,
   `226…` = 2026. A prefix older than the current year is strong evidence the listing is stale.
3. Read acreage from `Lot Size in Acres` and pool from `Has a Pool`, never from the marketing
   description — descriptions say things like "room to **add a pool**" that keyword matching reads
   as a pool. (1777 Carl Rd was exactly this trap.)
4. Prefer *under*-reporting. An empty result is correct and useful; a fabricated match is not.

## Coverage — do not trust a single portal

Portals under-report badly. On the 2026-11-14 run, for the same three cities:

| Source | Shingle Springs | Rescue | Placerville |
|---|---|---|---|
| Century21.com city pages | 22 | 49¹ | 104¹ |
| **MetroListPRO (MLS)** | **50** | **25** | **266** |
| Second IDX cross-check | 49 | 26 | 263 |

¹ Century21's city pages bleed in neighbouring cities (El Dorado Hills appeared under Rescue) while
still missing in-city listings — 4071 Voyager Way, a full match, was absent from its Shingle Springs
page entirely.

**Always cross-check the MLS count against a second IDX** before concluding inventory is thin.
Paginate to the end: confirm the captured price range spans the full list top to bottom.

## Blocked sources (do not retry)

Egress is open (`selective: false`, no proxy relay failures), so these are **site-level** bot
blocks on this datacenter IP, not network policy. Do not attempt to defeat them:

| Blocked | Response |
|---|---|
| Zillow, Trulia, Movoto | 403 "Press & Hold to confirm you are a human" |
| Redfin | 429 "Are You a Robot?" |
| Homes.com, LandWatch, LandAndFarm | 403 Akamai "Access Denied" |
| Realtor.com | 429 |
| Coldwell Banker, BHHS, KW, Point2, eXp | 403 / Cloudflare challenge |
| LandSearch | 403 "network restricted" |
| RE/MAX | 202 human-verification interstitial |

Accessible and useful: **metrolistpro.com** (primary), century21.com, compass.com,
carlamovesyou.com, homefinder.com, xome.com.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`build.js`** — renders `index.html` from `listings.json`. No dependencies: `node build.js`.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.
- **`ingest.js`** — merges listings pasted from a portal results page (manual fallback).

### `listings.json` shape

- `listings[]` — verified matches. `status` is `match` (active) or `under-contract`
  (contingent/pending). `isNew` drives the "New this run" spotlight at the top of the page.
- `nearMisses[]` — active listings clearing beds/baths/price but failing acreage or pool. Kept so a
  later price cut or data correction is easy to spot.
- `droppedThisRun[]` — previously tracked, now gone from active inventory.
- `rejected[]` — long-term memory; do not re-surface unless a price change brings one into range.

## Dedupe rules for future runs

Read `listings.json` **before** reporting anything.

1. A property already in `listings` is a **duplicate** — do not re-surface it as new.
2. Exception: if the price differs from `currentPrice`, that *is* worth reporting. Append to
   `priceHistory` and update `currentPrice`; the card renders the delta automatically.
3. Set `isNew: false` on anything carried over, so the spotlight only shows genuine additions.
4. Anything in `rejected` stays rejected unless a price change brings it into range.
5. Drop listings absent from MLS active inventory into `droppedThisRun`.
6. Update `lastSeen` on confirmed-active properties and `lastRun` on every run.

## Photos

Hotlinked from `mediarem.metrolist.net`; the **viewer's** browser fetches them. Each has an
`onerror` handler that swaps in a "View listing photos" tile, so a dead URL never leaves a hole.
MLS photos are the copyright of the listing brokerage — fine for a private hunting page, don't
republish more broadly.

## Publishing

Served from the `gh-pages` branch at repo root:

```bash
node build.js
git add -A && git commit -m "Update listings"
git push origin HEAD
# then publish index.html to gh-pages
```
