# House Hunting — El Dorado County

Automated house-hunt tracker for **Shingle Springs**, **Rescue**, and **Placerville, CA**.
Published from the `gh-pages` branch.

## Criteria

| Requirement | Value |
|---|---|
| Bedrooms | 4+ |
| Bathrooms | 3+ |
| Pool | Required (private pool) |
| Lot size | 2.5 acres minimum, 5+ preferred |
| Max price | $1,500,000 |

## Running it

```bash
python3 hunt.py     # search + verify + merge  -> listings.json
node build.js       # render                   -> index.html
```

`hunt.py` needs outbound HTTPS to `www.redfin.com` and `ssl.cdn-redfin.com`. Both are reachable
from this environment as of 2026-07-31 (see `NETWORK.md` for history and fallbacks).

## How it works

Three stages, in `hunt.py`:

1. **Search** — Redfin search pages for the target ZIPs and cities. Listing stubs come out of the
   `application/ld+json` blocks these pages embed.
2. **Verify** — fetch each candidate's own detail page and read the facts from it.
3. **Merge** — reconcile against the previous `listings.json`: flag new listings, record price
   changes, drop anything no longer active.

`build.js` renders `index.html` from `listings.json`. Edit the JSON and rebuild; don't hand-edit
the HTML.

## The verification gate — why this is built the way it is

An early version of this tracker reported four properties as matches. **All four were off market.**

Root cause: listing status was inferred from search-engine result text. Search engines index
listing pages that keep "For Sale" in the `<title>` for years after a sale closes, so stale
listings read as active. A second failure compounded it — search snippets conflated two different
properties on the same street, producing a listing with the wrong MLS number, bed count and price.

The rules that follow, all enforced in `hunt.py`:

1. **Status comes from the listing page itself.** Specifically the `xdp-meta` JSON block
   (`listingStatus`) and the MLS status display. Search-result text is never a status source.
2. **Only subject-anchored fields are read.** A Redfin detail page also embeds payloads for nearby
   homes and comparables, so a first-match regex will happily return a neighbour's address, lot
   size or photos. Every field is taken from a place that belongs to the subject property: the
   `<title>`, the `<meta name="description">`, the hero key-details panel, or an amenity block
   that occurs *exactly once* on the page. An amenity that appears zero or multiple times is
   recorded as a warning rather than guessed at.
3. **Disagreement is reported, not resolved silently.** Where the page carries lot size in more
   than one place and the figures differ, the **smallest** is used and the disagreement is shown
   on the card.
4. **Photos are matched on the listing's own MLS number**, so a neighbouring property's photos
   can't land on the wrong card.
5. **Prefer under-reporting.** An empty result is correct and useful; a fabricated match is not.

### The filter-completeness trap

The portal's own lot-size filter **silently omits listings whose MLS lot field is unpopulated**.
Filtering on `min-lot-size=2.5-acre` at the portal returned 29 candidates; filtering only on beds
and price returned 56, and the extra 27 included real acreage properties. So `hunt.py` deliberately
filters on **bedrooms and price only** at the portal, and applies acreage, bath and pool rules
locally against verified per-listing data.

The same caution applies to search engines generally: web search returns a small, stale,
non-random slice of inventory, because it reads *summaries of* portal pages rather than the live
result set. A thin search-derived list is not evidence that inventory is thin.

## Dedupe rules

`hunt.py` handles these automatically, keyed on a normalised `address + city` id.

1. A property already in `listings.json` is not re-flagged as new — `isNew` is false.
2. A changed price *is* newsworthy: it appends to `priceHistory`, sets `priceChanged` and
   `previousPrice`, and the card renders the delta.
3. Anything previously tracked that is no longer an active listing meeting the criteria moves to
   `dropped`, with the date and reason. Dropped entries are kept so a later run doesn't
   re-surface them as new finds.
4. `firstSeen` is preserved across runs; `lastSeen` and `verifiedOn` update each run.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`hunt.py`** — search, verify, merge. Writes `listings.json`.
- **`build.js`** — renders `index.html`. No dependencies: `node build.js`.
- **`index.html`** — generated. Don't hand-edit.
- **`ingest.js`** — manual fallback: merge listings pasted from a Zillow/Redfin results page.
  Only needed if the network path to Redfin breaks again.
- **`.cache/`** — fetched HTML, gitignored. Delete to force a clean re-fetch.

## Photos

Photos are hotlinked from Redfin's CDN. The **viewer's** browser fetches them, so they render even
when the generating environment can't load images. Each `<img>` carries
`referrerpolicy="no-referrer"`, which gets past most CDN referrer blocks, and an `onerror` handler
swaps in a link tile so a dead URL never leaves a hole in the layout.

MLS photos are the copyright of the listing brokerage. Fine for a private hunting page; don't
republish them more broadly.

## Publishing

Served from the `gh-pages` branch at repo root. Enable under
**Settings → Pages → Source: `gh-pages` / `(root)`**.
