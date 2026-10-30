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

The bedroom minimum was **5+** on the first run and is **4+** from 2026-10-30 onward, per the
current request. Loosening it is what surfaced most of the present match list.

## Where the data comes from

`coldwellbankerhomes.com` serves a full **MetroList IDX** feed and is reachable from this
environment. Its city pages carry a `schema.org` `ItemList` in a `<script type="application/ld+json">`
block with price, beds, baths, square footage, a photo URL and an `availability` flag for every
active listing. Detail pages add the two fields that decide this search — **Lot Size (Acres)** and
**Pool** — plus the MLS number, year built, garage count and an `IsActive` flag.

The run procedure:

1. Enumerate every active listing on `/ca/<city>/` and its `p_2/`, `p_3/`… pages for all three
   cities, reading the JSON-LD rather than scraping the rendered cards. Paginate until a page
   returns nothing new. The 2026-10-30 run read **313** active listings this way (Shingle Springs
   46, Placerville 236, Rescue 31).
2. Filter on price, beds and baths from the list data.
3. Fetch the detail page of each survivor for acreage and pool.
4. **Cross-check every match against a second independent source** before it goes on the page.
   `mlslistings.com/property/ME<mls>` and `plumaslakeproperties.realgeeks.com/property/<mls>/` both
   resolve by MLS number and are the quickest second reads. `verification.second` on each listing
   records what was found.

That enumeration is the point: it is the *whole* active inventory, not a sample. Web search returns
a small, stale slice, because it reads summaries of portal pages instead of a live feed.

### Be considerate of the source

The IDX host rate-limits, and it started returning `Request Rejected` after roughly 70 requests in
the 2026-10-30 run. Space requests out, keep the detail-page fetches to listings that actually
cleared the cheap filters, and do not send a spoofed browser user-agent to get around a bot check.
`WebFetch` reaches the same pages when `curl` is being throttled, and it is the right tool for
spot-checking a handful of listings.

## ⚠️ Verification gate

The first run reported four properties as matches. **All four were off market.** Listing status had
been inferred from search-engine result text, and search engines keep indexing sold listings with
"For Sale" in the `<title>` for years. A second failure compounded it: snippets conflated two
properties on the same street, producing a listing with the wrong MLS number, bed count and price.

The rules that follow still hold, even now that a live feed is available:

1. A property may only be given `status: "match"` when its active status is confirmed against a
   **live listing page**. Search-result text is not sufficient.
2. MetroList MLS numbers encode the listing year: `221…` = 2021, `223…` = 2023, `225…` = 2025,
   `226…` = 2026. A prefix older than the current year is strong evidence the listing is stale.
   (Some listings carry a non-MetroList number — `41150059` is a Bay Area MLS — so treat the prefix
   rule as a flag, not a verdict.)
3. Cross-check bed/bath/price against at least two independent sources. If they disagree, report the
   disagreement rather than picking one. On 2026-10-30 the IDX price was consistently *lower* than
   the second source's, which is what a real price cut looks like; the reverse would be a red flag.
4. Prefer under-reporting. An empty result is correct and useful; a fabricated match is not.

## Dedupe rules for every run

Read `listings.json` **before** reporting anything.

1. A property already in `listings` is a **duplicate** — do not re-surface it as new.
2. Exception: if the price differs from `currentPrice`, that *is* worth reporting. Append to
   `priceHistory` and update `currentPrice`; the card renders the delta automatically.
3. A listing no longer in the live active set has sold or been withdrawn. **Drop it** from
   `listings` and add a one-line entry to `dropped`, so a genuine relist is recognised later
   instead of being reported as a new find.
4. Anything in `nearMisses` stays there unless a price change or a corrected field brings it into
   range.
5. `firstSeen` is what drives the "new this run" highlight at the top of the page: set it to the run
   date on first sight and never touch it again. Update `lastSeen` on every confirmed-active
   property and `lastRun` on every run.

## Files

- **`listings.json`** — canonical data. Single source of truth. Holds `listings` (verified matches),
  `nearMisses` (active, clears most criteria, fails one), and `dropped` (gone, kept for dedupe).
- **`build.js`** — renders `index.html` from `listings.json`. No dependencies: `node build.js`.
- **`ingest.js`** — merge listings pasted off a portal results page into `listings.json`, applying
  the dedupe rules above. `node ingest.js paste.txt`, then `node build.js`.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.
- **`NETWORK.md`** — what is and isn't reachable from the runner, and why.

## Photos

Each listing has a `photos` array; the first entry renders as the card image. Images carry
`referrerpolicy="no-referrer"`, which gets past most CDN referrer blocks, and an `onerror` handler
swaps in a "View photos" tile client-side so a dead URL never leaves a hole in the layout. The
container itself often can't load these images — that doesn't matter, the viewer's browser fetches
them and it isn't behind this proxy.

MLS photos and listing copy are the copyright of the listing brokerage. Fine for a private hunting
page; don't republish more broadly.

## Publishing

Served from the `gh-pages` branch at repo root. Enable under
**Settings → Pages → Source: `gh-pages` / `(root)`**.
