# House Hunting — El Dorado County

Automated house-hunt tracker for **Shingle Springs**, **Rescue**, and **Placerville, CA**.
Published from the `gh-pages` branch.

## Criteria

| Requirement | Value |
|---|---|
| Bedrooms | **4+** (relaxed from 5+ on 2026-07-26) |
| Bathrooms | 3+ |
| Pool | Required |
| Lot size | 2.5 acres minimum, 5+ preferred |
| Max price | $1,500,000 |

## Running a refresh

```bash
python3 refresh.py      # rebuild listings.json from live MLS data
node build.js           # render index.html
```

`refresh.py --no-cache` bypasses the on-disk HTTP cache in `.cache/` (gitignored).
It prints the change list — new listings, price moves, drops — which is what a run
should report. A run with nothing new is a normal, useful outcome.

## Sources

Two independent sources, one for discovery and one for verification. Both are read
directly; **search engines are never used for listing status.**

1. **Coldwell Banker IDX** (`coldwellbankerhomes.com`) — republishes MetroList, the
   El Dorado County MLS, and does not bot-block this environment. `refresh.py`
   sweeps the **full active inventory** of each city (~320 listings) rather than a
   filtered subset, so nothing is lost to a filter-URL quirk. Cards carry price,
   beds, baths, status and photos; acreage and pool are only on the detail page.
2. **MetroListPRO** (`metrolistpro.com`) — the official MetroList public search.
   Every candidate is re-confirmed here before publication.

**Redfin also works** and is implemented in `redfin.py` from a parallel run — its
`/stingray/api/*` endpoints are CloudFront-blocked, but the HTML search pages embed
the same payload under `root.__reactServerState`. Keep it as a cross-check or a
fallback if Coldwell Banker ever blocks.

## ⚠️ Verification gate — read before reporting anything

An early run reported four properties as matches. **All four were off market.**
Status had been inferred from search-engine result text, and search engines index
sold listings with "For Sale" in the `<title>` for years. Snippets also conflated two
properties on the same street, producing a listing with the wrong MLS number, bed
count and price.

Rules in force:

1. `status: "match"` requires active status confirmed against a **live listing page
   or authoritative feed**. `refresh.py` enforces this — a candidate the MLS does not
   report Active is dropped, not published.
2. MetroList MLS numbers encode the listing year: `221…` = 2021, `225…` = 2025,
   `226…` = 2026. A prefix older than the current year on a supposedly-active listing
   is a red flag.
3. Cross-check bed/bath/price against two independent sources; report disagreement
   rather than picking one. *(2026-07-27: Redfin showed 5551 Saddlehorn as 3bd/2.5ba —
   a stale 2022 record. The live 2026 listing is 4bd/3ba.)*
4. Watch half-baths. MLS "total baths" folds them in, so a "3 bath" home may be
   2 full + 1 half. `refresh.py` sets a `caveat` and the card displays it.
5. Prefer *under*-reporting. An empty result is correct and useful; a fabricated
   match is not.

## Parsing traps — each of these has cost a run

- **Never regex the rendered detail page for acreage or the word "pool".** Both
  Coldwell Banker and Redfin detail pages end with a *nearby/similar homes* carousel
  containing **other properties'** acreage, remarks and photo captions. A page-wide
  match returns a neighbour's data. On CB, parse the **JSON-LD** block, which carries
  the subject's own MLS field set (`Lot Size (Acres)`, `Pool`, `Pool Description`,
  `Total Bedrooms`). On Redfin, scope to the subject's own `amenityEntries` and read
  `POOL_PRIVATE_YN`. A naive `([\d.]+) Acres` match once reported six different homes
  as 1.67 acres.
- **Card field names vary by property type and by count.** Single Family uses
  `class="beds"` / `"total-baths"`; **Multi-Family uses `"total-beds"`**; a count of 1
  uses the singular `"bed"` / `"total-bath"`. Handling only `"beds"` silently dropped
  1781 Springvale Rd — a 5BR/6BA pool property on 10.27 acres. Redfin has the same
  hazard from the other direction: **do not add `property-type=house`** to a filter
  URL, which excluded the same property.
- **Fail open on the cheap filter.** The card-level filter is only an optimisation;
  when a card omits beds or baths, fetch the detail page anyway rather than assuming
  failure. The detail page is authoritative.
- **Query above the ceiling, filter locally.** A listing at exactly $1,500,000 is in
  budget and must not be lost to someone else's off-by-one.
- **Dedupe on the MLS number, never the address slug.** Sources abbreviate street
  suffixes inconsistently (`3784-cattle-dr` one run, `3784-cattle-drive` the next),
  which would republish the entire list as new.
- A short response body is **throttling, not thin inventory**. Retry with backoff;
  never conclude the market is empty from a truncated fetch.

## Dedupe rules

Handled by `refresh.py`, but worth knowing:

1. A property already tracked is **not** re-surfaced — `isNew` is set only when its
   MLS number is absent from the previous store.
2. A changed price **is** newsworthy: it appends to `priceHistory` and the card
   renders the delta.
3. `firstSeen` carries forward across runs; `lastSeen` is stamped every run.
4. Anything previously tracked that is no longer confirmed active moves to `dropped`,
   with a reason distinguishing "gone from the MLS" from "still listed but now fails
   a criterion".

## Files

- **`listings.json`** — canonical data. Generated; single source of truth for the page.
- **`refresh.py`** — sweeps live inventory, verifies against the MLS, merges. Primary path.
- **`redfin.py`** — independent Redfin sweep from a parallel run. `python3 redfin.py search`
  prints candidates; `python3 redfin.py detail <url>` returns one property. Cross-check/fallback.
- **`build.js`** — renders `index.html`. No dependencies.
- **`index.html`** — generated. Don't hand-edit.
- **`ingest.js`** — manual fallback: merge listings pasted off a Zillow/Redfin results page.
- **`NETWORK.md`** — what is and isn't reachable from this environment.

## Photos

Hotlinked from the listing brokerage CDN and rendered in the viewer's browser, which
is not behind this environment's proxy. Cards carry `referrerpolicy="no-referrer"` to
get past CDN referrer checks, and an `onerror` handler swaps in a fallback tile so a
dead URL never leaves a hole in the layout.

MLS photos are the copyright of the listing brokerage. Fine for a private hunting
page; don't republish more broadly.

## Publishing

Served from the `gh-pages` branch at repo root. Enable under
**Settings → Pages → Source: `gh-pages` / `(root)`**.
