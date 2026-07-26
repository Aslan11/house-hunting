# House Hunting — El Dorado County

Automated house-hunt tracker for **Shingle Springs**, **Rescue**, and **Placerville, CA**.

## Criteria

| Requirement | Value |
|---|---|
| Bedrooms | **4+** (relaxed from 5+ on 2026-07-26) |
| Bathrooms | 3+ |
| Pool | Required |
| Lot size | 2.5 acres minimum, 5+ preferred |
| Max price | $1,500,000 |

## Status: the pipeline works

As of the 2026-07-26 run the environment can reach Redfin directly, so listing status and pool are
read from the **live listing page**. That run produced **8 verified matches**.

Earlier runs had no live source and inferred status from search-engine result text. That failed
badly — four properties were reported as matches and all four were off market — because search
engines index sold listings with "For Sale" in the `<title>` for years after closing. That archive is
kept on the page so a genuine relist gets flagged rather than re-reported as new.

## Verification gate — still binding

A property may be given `status: "match"` only when **both** of these are read off its own live
listing page:

1. `mlsStatus` is `Active`.
2. The `POOL_PRIVATE_YN` amenity in the subject property's own amenity block is `Yes`.

Supporting rules:

- **Never grep the detail page for the word "pool".** Redfin detail pages embed a *nearby homes*
  carousel containing other properties' listing remarks and photo captions. A page-wide text search
  returns pool language belonging to neighbouring homes. This produced false positives during the
  2026-07-26 run — three properties looked like pool homes on a text search and are not — until the
  check was scoped to the subject's own `amenityEntries` array. `build`-time code for this is in
  `pool.js`-style scoped extraction; see `dataQuality.method` in `listings.json`.
- Corroborate with a second, independent, subject-scoped field. `homeInsuranceData.hasPrivatePool`
  works and is keyed to the subject's ZIP and year built. If the two disagree, report the
  disagreement rather than picking one.
- MetroList MLS numbers encode the listing year: `221…` = 2021, `223…` = 2023, `225…` = 2025,
  `226…` = 2026. A prefix older than the current year on a supposedly-active listing is a red flag.
- Confirm the fetched detail page really is the subject before trusting it — the MLS number must
  appear in the page. Redfin property IDs cannot be guessed from the address; take the URL from the
  search payload.
- Prefer *under*-reporting. An empty result is correct and useful; a fabricated match is not.

## How a run works

1. **Fetch** Redfin filtered search pages for each ZIP (and city, as a cross-check):

   ```
   https://www.redfin.com/zipcode/95682/filter/min-beds=4,min-baths=3,max-price=1.6M,min-lot-size=2.5-acre
   https://www.redfin.com/zipcode/95672/filter/...   # Rescue
   https://www.redfin.com/zipcode/95667/filter/...   # Placerville
   https://www.redfin.com/city/25976/CA/Shingle-Springs/filter/...
   https://www.redfin.com/city/14760/CA/Placerville/filter/...
   https://www.redfin.com/city/16218/CA/Rescue/filter/...
   ```

   **Two filter rules, both learned the hard way on 2026-07-26:**

   - **Do not add `property-type=house`.** It silently dropped two qualifying listings, including
     1781 Springvale Rd — a 5BR/6BA pool property on 10.27 acres. Multi-structure and
     mixed-classification properties get excluded. Filter property type yourself, afterwards, if
     you want to.
   - **Query above the price ceiling and filter locally.** Use `max-price=1.6M` for a $1.5M budget.
     A listing priced at exactly the ceiling is in budget and must not be lost to an off-by-one in
     someone else's filter.

   Same principle generally: let Redfin narrow coarsely, and apply every hard criterion yourself
   against the parsed records.

   Use a desktop browser User-Agent. Redfin's `/stingray/api/*` JSON endpoints are CloudFront-blocked
   from datacenter IPs, but the **HTML search pages are not** — and they embed the same
   `stingray/api/gis` payload, so parse it out of the page rather than calling the API.

   Expect intermittent `202` responses with an empty body; that is a soft bot-block. Retry with a
   short backoff and it succeeds. ZIP pages cover far more ground than city pages — Placerville's
   city limits are tiny, and most acreage inventory is in unincorporated 95667.

2. **Parse** every `{"mlsId":{…}` object out of the (once-unescaped) payload and dedupe by
   `propertyId`. Useful fields: `mlsStatus`, `price`, `beds`, `baths`, `sqFt`, `lotSize` (sq ft —
   divide by 43,560 for acres), `city`, `listingRemarks`, `listingTags`, `listingBroker.name`, `url`.

   Note `include_nearby_homes=true` is in the query, so results spill past the target city — filter
   on `city` yourself. This is also what gives Rescue coverage from the Shingle Springs page.

3. **Verify** each candidate that clears the numeric filters by fetching its own detail page and
   reading the scoped `POOL_PRIVATE_YN`. Do not trust the search payload's `skPoolType` — its
   encoding is undocumented and `0` means "unspecified", not "no pool".

4. **Merge** into `listings.json` under the dedupe rules below, then `node build.js`.

## Photos

Photo URLs are on the detail page and look like:

```
https://ssl.cdn-redfin.com/photo/77/mbpaddedwide/<last-3-of-mls>/genMid.<mls>_<n>[_<v>].jpg
```

Because they are **keyed by MLS number**, filtering on the subject's MLS excludes the nearby-homes
carousel photos automatically. Up to six per listing go into the `photos` array and render as a
swipeable gallery.

Hotlinking works for the reader even when this container can't load the images itself — the
**viewer's browser** fetches them. Images carry `referrerpolicy="no-referrer"`, which also gets past
most CDN referrer blocks. If an image 404s, it is removed client-side; if a card loses all of them,
the "View photos on redfin" tile is swapped in, so a dead URL never leaves a hole in the layout.

MLS photos are the copyright of the listing brokerage. Fine for a private hunting page; don't
republish them more broadly.

## Fastest manual path: paste from Zillow

`ingest.js` takes listings copied straight off a Zillow or Redfin results page and merges them in,
applying the dedupe rules automatically.

```bash
node ingest.js paste.txt     # or:  pbpaste | node ingest.js
node build.js
```

It reports what was new, what changed price, and what was already tracked. Anything outside the
three target cities is skipped; anything failing a hard criterion is added but flagged rather than
presented as a match.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`redfin.py`** — scripted version of the sweep above, from a parallel 2026-07-26 run.
  `python3 redfin.py search` runs the standard sweep and prints candidates;
  `python3 redfin.py detail <url>` returns one property. No dependencies. It already encodes the
  city-filtering and `POOL_PRIVATE_YN` rules, and treats a short response as throttling rather than
  as thin inventory — prefer it over hand-rolling the fetch next time.
- **`ingest.js`** — merge pasted portal listings into `listings.json`.
- **`build.js`** — renders `index.html` from `listings.json`. No dependencies: `node build.js`.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.
- **`NETWORK.md`** — egress notes, kept for the day the policy tightens again.

## Dedupe rules for future runs

Read `listings.json` **before** reporting anything.

1. A property already in `listings` is a **duplicate** — do not re-surface it.
2. Exception: if the price differs from `currentPrice`, that *is* worth reporting. Append to
   `priceHistory`, update `currentPrice`, and the card renders the delta automatically.
3. Anything in `rejected` stays rejected unless a change brings it into range.
4. `noPoolActive` holds listings that meet every criterion except the pool. Don't present them as
   finds; do flag one that gains a pool.
5. An `off-market` property returning to market is newsworthy — but only once verified per the gate.
6. Update `lastSeen` on confirmed-active properties and `lastRun` on every run.
7. A listing that disappears from the live Active results has gone pending or sold — move it to
   `off-market` rather than silently dropping it.

## Publishing

Served from the `gh-pages` branch at repo root. Enable under
**Settings → Pages → Source: `gh-pages` / `(root)`**.

```bash
node build.js
git add -A && git commit -m "Update listings"
git push -u origin <working-branch>
# publish:
git checkout gh-pages && git checkout <working-branch> -- index.html
git commit -am "Publish $(date +%F) run" && git push -u origin gh-pages
```
