# House Hunting — El Dorado County

Automated house-hunt tracker for **Shingle Springs**, **Rescue**, and **Placerville, CA**.
Published from the `gh-pages` branch.

## Criteria

| Requirement | Value |
|---|---|
| Bedrooms | 4+ |
| Bathrooms | 3+ (full baths; MLS half-baths do not count) |
| Pool | Required, and evidenced in MLS remarks |
| Lot size | 2.5 acres minimum, 5+ preferred |
| Max price | $1,500,000 |

## How a run works

Network egress now reaches listing sites, so runs no longer depend on search-engine text.

1. **Pull full inventory.** Compass serves a JSON search API backed by an MLS/IDX feed. Load
   `https://www.compass.com/homes-for-sale/<zip-slug>/` in Playwright and capture the
   `POST /homes-for-sale/search/<slug>/` response the page makes. Each record carries price, beds,
   baths, sqft, lot size, property type, status and photo URLs.
   - Slugs: `shingle-springs-ca-95682`, `rescue-ca-95672`, `placerville-ca-95667`.
   - **Use the ZIP slug, not the city slug.** The city polygon misses outlying inventory;
     95682 alone returns ~137 listings versus 47 for the city.
   - Paginate with `/start=60/`, `/start=120/`, … until a page returns fewer than 60.
2. **Filter** on beds / baths / acres / price.
3. **Read the remarks** on each survivor's `/homedetails/` page for pool evidence.
4. **Verify independently** on MLSListings.com by MLS number before anything is called a match.
5. `node build.js` regenerates `index.html` from `listings.json`.

## Verification gate — still binding

An early run reported four properties as matches and **all four were off market**, because status
was inferred from search-engine snippets. Search engines index sold listings with "For Sale" in the
title for years. The rules that follow:

1. `status: "match"` requires confirmation on **two independent live sources**. The current pair is
   the Compass MLS feed and `https://www.mlslistings.com/property/ME<mls>` (`BE<mls>` for East Bay
   listings, `be<mls>` lowercase in the URL path).
2. Cross-check bed/bath/price between the two. They do disagree:
   - 1234 Rising Hill Rd W reads "3 ba" on Compass but **2 full + 1 half** on MetroList — a fail.
   - 4800 Abbey Rd reads "6 ba"; MetroList says **4 full + 2 half**.
3. MetroList MLS numbers encode the listing year: `225…` = 2025, `226…` = 2026. A prefix older than
   the current year is a strong hint the listing is stale.
4. Prefer under-reporting. An empty result is correct and useful; a fabricated match is not.

## Pool detection

Pool presence comes from the listing remarks, and the naive check is wrong:

- `\bpool\b` **misses "pools"** — that bug hid 4800 Abbey Road ("dual luxury pools"), a real match.
  Match `pools?\b`.
- "room to … add a pool" is a **negative**. 1777 Carl Rd, Rescue reads *"plenty of room to relax,
  entertain, build an ADU, or add a pool or barn"* — no pool. Exclude a sentence when
  `(add|build|room for|space for|potential|install|no)` appears within ~60 characters before `pool`.
- MLSListings.com exposes an explicit `Pool - Yes` field on many listings; prefer it when present.

## Site access notes

Checked 2026-11-18 from this container:

| Site | Result |
|---|---|
| **compass.com** | **Works.** Primary source. Rate-limits to 403 after ~13 rapid detail pages — pace at ~10–15 s and back off. |
| **mlslistings.com** | **Works.** Verification source; carries MetroList (`ME`) and East Bay (`BE`) records. |
| century21.com | Works. Unused spare. |
| zillow.com, movoto.com | 403 "Press & Hold" bot wall, including in a real browser. |
| redfin.com | 429 "Are You a Robot?" — blocks this datacenter IP. |
| realtor.com | 429, hard rate-limit. |
| homes.com, landwatch.com, coldwellbankerhomes.com | 403 at the edge. |

`WebFetch` is blocked for realtor.com by robots; Playwright with stock Chromium is the reliable path.
Do **not** spoof a browser User-Agent and do **not** replay the Compass POST API directly — both are
refused by the sandbox classifier. Load the public page and capture the response it makes.

## Dedupe rules

Read `listings.json` **before** reporting anything.

1. A property already in `listings` is a duplicate — do not re-surface it.
2. Exception: a price differing from `currentPrice` **is** worth reporting. Append to
   `priceHistory`, update `currentPrice`, and the card renders the delta automatically.
3. Anything in `rejected` stays rejected unless a price change brings it into range.
4. Drop sold / off-market properties from `listings` into `droppedThisRun` — a property missing
   from the current active pull is off market.
5. `firstSeen === lastRun` is what marks a card **New** and lists it in the top banner. Set
   `firstSeen` once and never bump it.
6. Update `lastSeen` on confirmed-active properties and `lastRun` on every run.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`build.js`** — renders `index.html`. No dependencies: `node build.js`.
- **`style.css`** — page styles, light and dark.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.
- **`ingest.js`** — merges listings pasted from a portal results page (manual fallback).
