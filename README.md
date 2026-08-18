# House Hunting — El Dorado County

Automated house-hunt tracker for **Shingle Springs**, **Rescue**, and **Placerville, CA**.

## Criteria

| Requirement | Value |
|---|---|
| Bedrooms | 4+ |
| Bathrooms | 3+ |
| Pool | Required |
| Lot size | 2.5 acres minimum, 5+ preferred |
| Max price | $1,500,000 |

## Status: pipeline is working (2026-08-18)

As of the 2026-08-18 run the network policy reaches **Redfin** directly (`WebFetch` works too), so
listings are now verified against **live listing pages** rather than search-engine snippets. The run
found **8 verified matches** — each confirmed Active with a pool via the MLS `POOL_PRIVATE_YN` field.
The rest of this README documents the earlier blocked state and the fallbacks; keep it in case Redfin
starts bot-blocking this environment again.

### How a run works now

1. Fetch Redfin's filtered city/zip search for each town with the hard criteria baked into the URL
   (`min-beds=4,min-baths=3,max-price=1.5M,min-lot-size=2.5-acre`). Region IDs: Shingle Springs
   `25976`, Placerville `14915`, Rescue via zip `95672`. The page embeds the live MLS result set as
   JSON.
2. For each candidate, fetch its detail page and read `POOL_PRIVATE_YN` (authoritative) — the free-text
   "pool" mentions include nearby-home boilerplate and can't be trusted alone.
3. Only Active + pool + all hard criteria → `status: "match"`. Everything else is recorded as rejected
   with the reason.

## ⚠️ Verification gate — read before reporting anything

The first run of this tracker reported four properties as matches. **All four were off market.**

Root cause: listing status was inferred from search-engine result text. Search engines index
listing pages that keep "For Sale" in the `<title>` for years after the sale closes, so stale
listings read as active. A second failure compounded it — search snippets conflated two different
properties on the same street, producing a listing with the wrong MLS number, bed count and price.

**Rules that follow from this:**

1. A property may only be given `status: "match"` when its active status is confirmed against a
   live listing page or an authoritative feed. Search-result text is **not** sufficient.
2. MetroList MLS numbers encode the listing year: `221…` = 2021, `223…` = 2023, `225…` = 2025,
   `226…` = 2026. A prefix older than the current year is strong evidence the listing is stale.
   Treat it as off market unless proven otherwise.
3. Cross-check bed/bath/price against at least two independent sources before reporting. If they
   disagree, report the disagreement rather than picking one.
4. Prefer *under*-reporting. An empty result is correct and useful; a fabricated match is not.

## Why the environment can't verify

The network policy allows GitHub, package registries, and a keyed `maps.googleapis.com`. Everything
else is blocked at the proxy — Zillow, Redfin, Realtor.com, Homes.com, Movoto, small brokerage
sites, plus OpenStreetMap, Wikimedia and Esri tile servers. `WebFetch` is blocked outright
(`example.com` returns 403). `WebSearch` is the only channel, and it returns summarised text, never
live status and never image URLs.

## Fixing the pipeline

Ranked cheapest-first. The first option solves listing status **and** photos at once:

1. **Zillow/Redfin saved search with email alerts** to `kvn.p.mrtn@gmail.com`. This repo's runner
   has Gmail access, so alert emails become an authoritative feed: current listings, correct
   status, price cuts, and image URLs. ~5 minutes to set up, one time.
2. **An agent-run MLS/IDX client portal** with email alerts — same benefits, fuller MLS data.
3. **A real-estate data API key** in the environment (SimplyRETS, Bridge Interactive, a RapidAPI
   provider) for direct queries.
4. **Allowlisting a listing domain** in the network policy. Least reliable — the portals bot-block
   independently of the proxy.

## Photos

Photo support is built and waiting on a source.

- Each listing has a `photos` array in `listings.json`. Put any image URL in it and the card
  renders it on the next build.
- Hotlinking works even though this environment can't load images: the **viewer's browser** fetches
  them, and it isn't behind this proxy. Images carry `referrerpolicy="no-referrer"`, which also
  gets past most CDN referrer blocks.
- If a photo URL 404s or is blocked, an `onerror` handler swaps in the fallback tile client-side,
  so a dead URL never leaves a hole in the layout.
- With no photo, the card shows a "View photos on <site>" tile linking to `gallery` (or `url`).

Note that MLS photos are the copyright of the listing brokerage. Fine for a private hunting page;
don't republish them more broadly.

## Fastest path: paste from Zillow

`ingest.js` takes listings copied straight off a Zillow or Redfin results page and merges them in,
applying the dedupe rules below automatically.

```bash
node ingest.js paste.txt     # or:  pbpaste | node ingest.js
node build.js
```

It reports what was new, what changed price, and what was already tracked. Anything outside the
three target cities is skipped; anything failing a hard criterion is added but flagged rather than
presented as a match. Image URLs in the paste become the card photo.

Note the coverage problem this solves: web search returns only a small, stale, non-random slice of
inventory, because it reads *summaries of* portal pages rather than querying the live MLS. A portal's
own filtered search is the real result set. Do not treat a thin search-derived result list as
evidence that inventory is thin.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`ingest.js`** — merge pasted portal listings into `listings.json`.
- **`build.js`** — renders `index.html` from `listings.json`. No dependencies: `node build.js`.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.

## Dedupe rules for future runs

Read `listings.json` **before** reporting anything.

1. A property already in `listings` is a **duplicate** — do not re-surface it.
2. Exception: if the price differs from `currentPrice`, that *is* worth reporting. Append to
   `priceHistory`, update `currentPrice`, and the card will render the delta automatically.
3. Anything in `rejected` stays rejected unless a price change brings it into range.
4. An `off-market` property returning to market is newsworthy — but only once verified per the gate.
5. Update `lastSeen` on confirmed-active properties and `lastRun` on every run.

## Publishing

Served from the `gh-pages` branch at repo root. Enable under
**Settings → Pages → Source: `gh-pages` / `(root)`**.
