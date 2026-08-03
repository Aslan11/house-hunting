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

> The bedroom minimum was **5+** on earlier runs and was lowered to **4+** on 2026-08-03.

## Data source — this is the important part

As of 2026-08-03 the environment can reach Redfin, so listing status now comes from a **live
active-listings feed** rather than from search-engine text. This is what the whole tracker hangs on.

```bash
curl -sS -A "$UA" --get \
  --data-urlencode "al=1" \
  --data-urlencode "market=sacramento" \
  --data-urlencode "num_homes=350" \
  --data-urlencode "poly=<lng lat,lng lat,...>" \
  --data-urlencode "sf=1,2,3,5,6,7" \
  --data-urlencode "status=9" \
  --data-urlencode "uipt=1,2,3,4,7,8" \
  --data-urlencode "v=8" \
  https://www.redfin.com/stingray/api/gis-csv
```

`status=9` means active. The response is CSV: address, city, zip, price, beds, baths, sqft, lot
size, year built, days on market, MLS #, URL, lat/lng.

### Two traps, both of which have already burned this repo

**1. The 350-row cap is silent.** `num_homes` maxes out at 350 and the API gives no indication that
it truncated. A query returning exactly 350 rows is almost certainly incomplete. Fix it by shrinking
the polygon or adding server-side filters (`num_beds`, `num_baths`, `max_price`, `min_lot_size`)
until the row count is comfortably under the cap — then verify the count.

The current run uses three overlapping polygons over 95682 / 95672 / 95667, returning 218 / 38 / 33
rows. All under the cap, so coverage is complete.

**2. Never read pool status out of the page prose.** Detail pages embed a *"similar homes"* carousel
containing other properties' `listingRemarks`. On the 4810 Robledo Dr page, a nearby listing's
"Exterior amenities include RV parking, a sparkling pool..." sits in the HTML — for a different
house. Grepping the page for `pool` marks a no-pool property as having one.

Read the MLS amenity block instead:

```json
{"groupTitle":"Pool Information","amenityEntries":[
  {"amenityName":"Pool Features","amenityValues":["Built-In","Gunite Construction"]},
  {"amenityName":"Has Private Pool","amenityValues":["Yes"]}]}
```

There is exactly one such group per page and it always describes the subject property. Parse it
**entry by entry** — collecting all `amenityName`s and all `amenityValues` into two lists and zipping
them misaligns, because entries with no values are skipped in the second list. That misalignment
produced nonsense like `"Lot Size Acres": "217,800"` before it was fixed.

Cross-check `Has Private Pool` against the page's `"hasPrivatePool":true|false` boolean. On the
current run all 15 candidates agreed.

## Verification gate

A property may be `status: "match"` only when **both** hold:

1. It appears in the live Redfin active feed (`status=9`) for its area, and
2. Its MLS `Pool Information` block reports `Has Private Pool: Yes`.

Search-result text is never sufficient. The first run of this tracker reported four properties as
matches and all four were off market, because status was inferred from search snippets — portals keep
"For Sale" in the `<title>` for years after closing.

MetroList MLS numbers encode the listing year: `221…` = 2021, `225…` = 2025, `226…` = 2026. A prefix
older than the current year is strong evidence of a stale listing.

Prefer under-reporting. An empty result is correct and useful; a fabricated match is not.

## Photos

Photos come straight off Redfin's CDN, keyed by MLS number:

```
https://ssl.cdn-redfin.com/photo/77/bigphoto/<last 3 digits of MLS>/<MLS>_0.jpg
```

`_0` is the primary photo and exists for every listing checked so far; `_1` and `_2` are often 404,
so verify before adding them. Images carry `referrerpolicy="no-referrer"` and an `onerror` handler
that swaps in a fallback tile, so a dead URL never leaves a hole.

**Verifying photos from this container doesn't work and that's expected.** `curl` honours
`HTTPS_PROXY`; the bundled Chromium doesn't, so images silently never load in a headless screenshot
even when the URLs are fine. Verify with `curl` + `file` instead — a real photo comes back as several
hundred KB of `JPEG image data`. The viewer's browser is not behind this proxy and loads them fine.

MLS photos are the copyright of the listing brokerage. Fine for a private hunting page; don't
republish more broadly.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`build.js`** — renders `index.html` from `listings.json`. No dependencies: `node build.js`.
- **`ingest.js`** — merge listings pasted off a portal page (manual fallback).
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.
- **`NETWORK.md`** — egress notes and what to do if the feed starts getting blocked again.

## Dedupe and lifecycle rules

Read `listings.json` **before** reporting anything.

1. A property already in `listings` is a duplicate — do not re-surface it as new.
2. Exception: if the price differs from `currentPrice`, that *is* worth reporting. Append to
   `priceHistory`, update `currentPrice`, set `priceChanged: true`, and the card renders the delta.
3. `isNew: true` drives the highlighted "New this run" band at the top of the page. Set it only when
   the listing has no prior entry, and clear it on the following run.
4. Anything in `rejected` stays rejected unless a price change brings it into range.
5. A listing that disappears from the active feed is **dropped from the page** — set
   `status: "off-market"`. It stays in `listings.json` so a later run recognises it rather than
   reporting it as a fresh find, but `build.js` does not render it.
6. An `off-market` property returning to the active feed is newsworthy.
7. Update `lastSeen` on confirmed-active properties and `lastRun` on every run.

## Publishing

Served from the `gh-pages` branch at repo root. Enable under
**Settings → Pages → Source: `gh-pages` / `(root)`**.

```bash
node build.js
git add -A && git commit -m "Update listings"
git push -u origin <working-branch>
# then publish index.html to gh-pages
```
