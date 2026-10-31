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

> Changed on the 2026-10-31 run: the bedroom minimum was **5+** on the first run and is now **4+**,
> per the current task definition. Widening it is what surfaced most of the current matches.

## Status: the pipeline works

As of **2026-10-31** the container's network policy allows general outbound HTTPS
(`curl "$HTTPS_PROXY/__agentproxy/status"` reports `selective: false` with no relay failures), so
live listing pages are readable. The earlier failure mode — inferring status from search snippets —
is no longer necessary.

### What is reachable, and what still is not

The big consumer portals bot-block datacenter IPs regardless of the network policy:

| Host | Result |
|---|---|
| zillow.com, homes.com, movoto.com, trulia.com, remax.com, rubyhome.com | 403 — bot block |
| realtor.com | 429 — rate limited |
| redfin.com | 302, and its filter/CSV endpoints return 405 |
| **coldwellbanker.com** | **200 — full IDX, used as the data source** |
| metrolistpro.com, compass.com, windermere.com, exprealty.com | 200 — usable backups |

Do **not** work around a bot block by spoofing a `User-Agent`; that is disallowed here and the
sanctioned channels are sufficient.

## How the current run gets its data

`coldwellbanker.com` serves a MetroList-backed IDX. Each city page embeds a
`<script id="__NEXT_DATA__">` JSON blob at `props.pageProps.propertiesData.properties`, carrying for
every listing: `markerPrice`, `beds`, `baths`, `squareFeet`, `mlsId`, `standardStatus`,
`daysOnMarket`, `officeName`, `photos[].mediaUrl`, and `propertyDetailsRoutePath`. The MetroList
disclaimer on the page states the data date, which is the freshness check.

Method, reproducible:

1. Page each city with `?page=N` (32 per page) until no new records. This gives **complete**
   inventory — 62 Shingle Springs + 52 Rescue + 292 Placerville = 406 listings.
2. Filter in code: target city, `Single Family`, `standardStatus == ACTIVE`, beds ≥ 4, baths ≥ 3,
   `markerPrice` ≤ 1.5M. (`price` is a formatted string like `"$1,275,000"` — use `markerPrice`,
   the number, or the filter silently drops everything.)
3. Open each survivor's detail page and read
   `rawPropertyDetails.property.characteristics.lotSizeAcres` for structured acreage.
4. Pool presence has **no structured field** in this feed. Read it from
   `propertyDetails.about.description` (the agent's public remarks) and review every hit by hand.

### Pool detection needs human review — both directions

Real traps found on the 2026-10-31 run:

- **False positive:** 1777 Carl Rd, Rescue reads "…room to relax, entertain, build an ADU, or *add a
  pool* or barn." No pool. A naive `/pool/` match would have reported it.
- **False negative check:** every acreage-qualifying listing *without* the word "pool" was re-scanned
  for `spa|hot tub|swim|water feature|waterfall|resort`. Only 4810 Robledo Dr hit, and its
  "waterfall" is decorative ponds and its "spa bath" is a bathroom. Correctly excluded.

Also check acreage claims against the remarks: 1234 Rising Hill W Rd reports 2.66 acres, but the
remarks reveal that is a **1.39-acre home parcel plus a separable 1.3-acre second parcel** — the
home parcel alone misses the 2.5-acre minimum.

## Verification gate

A property may be given `status: "match"` only when it is present in live MLS-backed **active**
inventory, read from a listing page or feed. Search-engine text is not sufficient — search engines
index sold listings with "For Sale" in the title for years.

1. MetroList MLS numbers encode the listing year: `221…` = 2021, `225…` = 2025, `226…` = 2026.
   A prefix older than the current year is strong evidence of a stale listing.
2. Non-MetroList formats appear legitimately. 2520 Bedford Ave carries `41150059` (Bay East AOR);
   it was cross-checked against an independent source before being listed.
3. Where sources disagree, **report the disagreement** rather than picking one. 6881 Sagittarius Dr
   is live-ACTIVE in the IDX feed but marked a pocket/inactive listing at a different price on one
   brokerage site; the card says so.
4. Prefer under-reporting. An empty result is correct and useful; a fabricated match is not.

## Photos

Solved. Photo URLs come from the IDX feed (`images-listings.coldwellbanker.com`, verified serving
HTTP 200). Each card shows a hero image plus a 5-up thumbnail strip, with `referrerpolicy="no-referrer"`
to get past CDN referrer checks and an `onerror` handler that hides a dead thumbnail or swaps the
hero for a "View photos" tile — so a broken URL never leaves a hole in the layout.

MLS photos are the copyright of the listing brokerage. Fine for a private hunting page; don't
republish more broadly.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`build.js`** — renders `index.html`. No dependencies: `node build.js`.
- **`ingest.js`** — merge listings pasted from a portal results page (manual fallback).
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.
- **`NETWORK.md`** — network policy notes and how to re-diagnose if egress closes again.

### `listings.json` shape

| Key | Meaning |
|---|---|
| `listings[]` | Confirmed matches. `isNew: true` puts one in the highlighted band at the top. |
| `dropped[]` | Left the market. Kept so they are never re-surfaced as new finds. |
| `nearMisses[]` | Active, meets beds/baths, priced $1.5M–$1.75M. |
| `rejected[]` | Active, cleared price and beds/baths, failed on pool or acreage. |
| `flag` | Renders an amber "Check this" caveat inside the card. |
| `priceHistory[]` | More than one entry makes the card render a price delta automatically. |

## Dedupe rules for future runs

Read `listings.json` **before** reporting anything.

1. A property already in `listings` is a **duplicate** — do not re-surface it as new. Clear its
   `isNew` flag on the next run so the "new this run" band stays meaningful.
2. Exception: if the price differs from `currentPrice`, that *is* worth reporting. Append to
   `priceHistory` and update `currentPrice`; the card renders the delta.
3. Anything in `rejected` or `nearMisses` stays out unless a price change or corrected data brings
   it into range. Re-check these — the feed corrects itself: 4661 Holm Rd was recorded as 3bd/3ba
   and is actually 4bd/5ba.
4. A `dropped` property returning to market is newsworthy, but only once verified per the gate.
5. Drop any listing no longer in active inventory, and record it in `dropped`.
6. Update `lastSeen` on confirmed-active properties and `lastRun` on every run.

## Publishing

Served from the `gh-pages` branch at repo root. Enable under
**Settings → Pages → Source: `gh-pages` / `(root)`**.
