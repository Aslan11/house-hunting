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

## Where the data comes from

Egress is open now, but the big portals still bot-block this container independently of the
network policy:

| Host | Result |
|---|---|
| `zillow.com`, `trulia.com`, `homes.com`, `movoto.com` | 403 |
| `redfin.com` | 200 at the root, 403 (CloudFront) on every search or API path |
| `realtor.com` | 429 |
| **`coldwellbankerhomes.com`** | **200 — works** |
| `metrolistpro.com`, `compass.com`, `century21.com` | 200 (unused; CB covers it) |

Coldwell Banker's public site is an **IDX mirror of MetroList**, the actual MLS for El Dorado
County. It carries the same inventory the portals do, and every detail page embeds JSON-LD with
the full MLS amenity table — lot acreage, pool type, year built, well/septic, horse facilities —
plus full-resolution photo URLs. It does not bot-block. It is the source of record for this
tracker.

## The run

1. Crawl every result page for `/ca/shingle-springs/`, `/ca/rescue/`, `/ca/placerville/` **and**
   the three ZIP pages `/ca/95682/`, `/ca/95672/`, `/ca/95667/`. The ZIP pass is a coverage
   check — it pulls in neighbouring towns, so anything it finds in a target city that the city
   page missed is a gap. On the 2026-08-29 run it found none, confirming the city pages are
   complete.
2. Filter the union on the card data: 4+ bd, 3+ ba, at or under $1.5M.
3. Fetch each survivor's detail page and read `mainEntity.amenityFeature` for
   `Lot Size (Acres)` and `Pool` / `Pool Description`. **This is the only acceptable source for
   acreage and pool** — neither appears reliably on the result cards.
4. Anything clearing all five criteria goes in `listings`. Anything failing exactly one of
   {pool, acreage} goes in `nearMisses`.

## ⚠️ Verification gate — still binding

The 2026-07-26 run reported four properties as matches. **All four were off market.** Listing
status had been inferred from search-engine result text, which indexes sold listings with
"For Sale" in the `<title>` for years. A second failure compounded it — search snippets conflated
two properties on the same street, producing a listing with the wrong MLS number, bed count and
price.

Rules that follow:

1. A property may only be given `status: "match"` when its active status is read from a **live
   listing page or an authoritative feed**. Search-result text is not sufficient.
2. MetroList MLS numbers encode the listing year: `221…` = 2021, `223…` = 2023, `225…` = 2025,
   `226…` = 2026. A prefix older than the current year is strong evidence of a stale listing.
3. Prefer *under*-reporting. An empty result is correct and useful; a fabricated match is not.

The current pipeline satisfies the gate: every field on the page was read from that property's own
live IDX detail page, and the status pill (`Active` / `Pending` / `Contingent`) comes off the same
page.

## Dedupe rules for future runs

Read `listings.json` **before** reporting anything.

1. A property already in `listings` is a **duplicate** — it stays on the board but is not flagged
   as new. Carry its original `firstSeen` forward and set `isNew: false`.
2. If the price differs from the last entry in `priceHistory`, append a new entry and set
   `priceChanged: true`. The card renders the delta and the property re-enters the "New this run"
   band automatically.
3. A listing that is no longer active — absent from the crawl, or showing Sold — is **dropped**
   from `listings` and moved to `archive` with a `droppedOn` date and an `outcome` note. Archived
   entries are not re-reported as fresh finds if they relist; they get flagged as a relist.
4. Anything in `rejected` stays rejected unless a price change or a relist brings it into range
   (4661 Holm Rd is the worked example: relisted 2026 at $899,900 as 4bd/5ba on 5.12 acres, so it
   now clears everything but the pool, and moved into the near-miss table).
5. Update `lastSeen` on confirmed-active properties and `lastRun` on every run.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`build.js`** — renders `index.html` from `listings.json`. No dependencies: `node build.js`.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.
- **`NETWORK.md`** — egress notes and the host-by-host block/allow picture.

`ingest.js` (paste listings off a Zillow/Redfin results page) was removed. It existed because
nothing could reach a live listing source; `scrape.py` now can, and `ingest.js` wrote the old
flat schema, which would have quietly corrupted `listings.json`. It's in the git history if the
paste path is ever needed again.

## Photos

Photos are hotlinked from `m.cbhomes.com` / `m1.cbhomes.com` at `full.webp` resolution. They carry
`referrerpolicy="no-referrer"`, and a dead URL swaps in a fallback tile client-side so it never
leaves a hole in the layout. This container cannot load them (the proxy drops the image tunnels)
but the viewer's browser is not behind that proxy, and the URLs verify 200.

MLS photos are the copyright of the listing brokerage. Fine for a private hunting page; don't
republish them more broadly.

## Publishing

Served from the `gh-pages` branch at repo root. Enable under
**Settings → Pages → Source: `gh-pages` / `(root)`**.
