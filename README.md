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

## Data source — read this before changing the pipeline

Listing data comes from **MLSListings / REMTRO** (`www.mlslistings.com`), which republishes the
**MetroList** MLS feed for El Dorado County along with CRMLS and Bay East records. It is
cross-checked against **Century 21's** IDX feed (`www.century21.com`), which is also MetroList-sourced.

Both serve complete, server-rendered listing pages to this container. Neither bot-blocks it.

What does **not** work from here, and should not be attempted again:

| Host | Result |
|---|---|
| zillow.com | 403 — bot wall, including under a real headless browser |
| redfin.com | 429 — "Are you a robot", redirects to `ratelimited.redfin.com` |
| realtor.com | 429 |
| homes.com, movoto.com, trulia.com, remax.com, metrolist.com | 403 at the egress proxy |
| `WebFetch` against redfin.com | 405 from the proxy |

The egress block that defeated the 2026-07-26 run is gone — the remaining failures are the sites'
own bot defences, which an allowlist change cannot fix. `NETWORK.md` is kept for history but its
premise (everything blocked at the proxy) no longer holds.

## How a run works

1. **Pull full city inventory** from MLSListings, one city at a time:
   `https://www.mlslistings.com/search/result/city/<City>`.
   The first load redirects to `/Search/Result/<city>/1?criteria=<blob>`; paginate by swapping the
   page number in that URL. Scrape the rendered result text, not an API — there is no key to hold.
2. **Parse cards.** Each record reads as
   `address / $price / Status / N Day(s) on Site / Type / MLS # / Bd / Ba / Sq Ft / Acres Lot`.
   Two gotchas, both of which silently dropped records on the first attempt:
   - Lots under ~1 acre print **`Sq Ft Lot`** instead of `Acres Lot`.
   - Listings posted today print **`1 Day on Site`**, singular.
3. **Filter** on beds, baths, price and acreage. Baths print as `3` or `2/1` (full/half).
4. **Open every survivor's detail page** and read the structured **`Pool`** field, which reads
   `Pool - Yes` or `Pool - No`. Do not infer a pool from the description: `1777 Carl Rd` says
   "room to ... add a pool" and matches a naive `/pool/i` test.
5. Photo URLs come off the detail page from `mediarem.metrolist.net` (MetroList) or
   `images-listings.century21.com` (CRMLS records). They hotlink fine from a viewer's browser.
6. Edit `listings.json`, then `node build.js`, then publish `index.html` to `gh-pages`.

Century 21 is the useful cross-check but a poor primary: its city search is clipped to a map
boundary, so `shingle-springs` returns 22 of the 50 active listings. Clicking "Remove boundary"
widens it to the viewport, which is non-deterministic between runs. MLSListings has no such clipping.

## Verification gate

The 2026-07-26 run reported four properties as matches and all four were off market, because status
was inferred from search-engine result text. Search engines index sold listings with "For Sale" in
the title for years. That failure mode is still live — a `WebSearch` during this run surfaced
`4071 Voyager Way`, `3784 Cattle Dr`, `2601 Roundhill Cir` and `5681 Gold Leaf Ln` as "Active" when
none of them appear anywhere in the current MLS feed.

Rules:

1. `status: "match"` requires Active read off a live MLS-sourced listing page. Search snippets are
   never sufficient, and are not a reason to doubt the MLS feed either.
2. MetroList MLS numbers encode the listing year: `221…` = 2021, `225…` = 2025, `226…` = 2026.
   An old prefix on a supposedly current listing is a red flag.
3. Prefer under-reporting. An empty result is correct and useful; a fabricated match is not.

## Dedupe rules for future runs

Read `listings.json` **before** reporting anything.

1. A property already in `listings` is a duplicate — do not re-surface it as new.
2. Exception: a price differing from `currentPrice` is worth reporting. Append to `priceHistory`,
   update `currentPrice`, and the card renders the delta automatically.
3. Put the ids of genuinely new properties in `newThisRun`. That array drives the highlighted band
   at the top of the page, and nothing else does.
4. When a tracked property leaves the active feed, **remove it from `listings`** and add a row to
   `droppedThisRun` saying why. It then shows in the "Dropped this run" table instead of the grid.
5. Anything in `rejected` stays rejected unless a price change brings it into range.
6. Update `lastRun` every run and `previousRun` to the prior value.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`build.js`** — renders `index.html` from `listings.json`. No dependencies: `node build.js`.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.
- **`ingest.js`** — merges listings pasted from a Zillow/Redfin results page. Kept as a manual
  fallback; the MLSListings path above has superseded it.
- **`NETWORK.md`** — historical record of the egress block. No longer applicable.

## Publishing

Served from the `gh-pages` branch at repo root. Enable under
**Settings → Pages → Source: `gh-pages` / `(root)`**.

Note that MLS photos are the copyright of the listing brokerage. Fine for a private hunting page;
don't republish them more broadly.
