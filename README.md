# House Hunting — El Dorado County

Automated house-hunt tracker for **Shingle Springs**, **Rescue**, and **Placerville, CA**.

Published from the `gh-pages` branch.

## Criteria

| Requirement | Value |
|---|---|
| Bedrooms | 4+ |
| Bathrooms | 3+ **full** (half baths don't count toward the minimum) |
| Pool | Required |
| Lot size | 2.5 acres minimum, 5+ preferred |
| Max price | $1,500,000 |

The bedroom minimum was 5+ through the 2026-07-26 run and was relaxed to 4+ on 2026-08-15.

## Where the data comes from

Direct portal access is still blocked in practice — Zillow, Movoto, Homes.com and RE/MAX return
`403` to this environment, and Redfin serves a **decoy page for a different state** rather than an
error, which is worse than a refusal because it looks like success. Do not trust Redfin from here.

That warning is about Redfin as an *enumerator*, and it is worth being precise, because Redfin is
still what `mls-status.js` and `crosscheck.js` read for the second-opinion status check. Redfin's
`/zipcode/<zip>/filter/…` search does return genuine El Dorado County listings — a 2026-08-17 spot
check pulled 18 in the three zips and every field agreed with the IDX feed and MetroList. It is
nonetheless **not safe as the source of the board**, because it is silently incomplete: that same
search returned 12 listings for 95667 against the IDX feed's 220, and it missed an active tracked
match (1315 Arrowbee Dr). Use Redfin to contradict a status, never to establish the inventory.

Two hosts do serve real, current El Dorado County data and are what the pipeline runs on:

1. **`www.coldwellbankerhomes.com`** — an IDX site carrying the **MetroList** feed. City pages embed
   every active listing as JSON-LD (`ItemList` → `RealEstateListing`), and detail pages carry the
   full MLS field table as `LocationFeatureSpecification` pairs: `Pool`, `Pool Description`,
   `Lot Size (Acres)`, `Full Bathrooms`, `Half Bathrooms`, `Status`, `Source`.
2. **`www.metrolistpro.com`** — the **official MetroList MLS** search site, used for verification.
   Only the MLS number in the URL matters, so any record resolves directly:
   `https://www.metrolistpro.com/homes/2/6/x/<MLS>`

A third source is available if either of the above breaks: **`www.homefinder.com`** serves MetroList
records through the Move/realtor.com pipeline, embedded as JSON in `<script id="__NEXT_DATA__">`
(`source.name === "MetroList"`, with `list_price`, `description.beds`, `baths_consolidated`,
`lot_sqft` and `status`). It is independent of both the IDX feed and Redfin. Its limitation is the
same as Redfin's: it renders roughly 40 listings per city and ignores path filters and pagination, so
it can confirm or contradict a known listing but must never be used to enumerate inventory.

Both need a normal browser `User-Agent`; the default agent string gets blocked.

```bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
curl -sSL -A "$UA" https://www.coldwellbankerhomes.com/ca/shingle-springs/
```

Pagination is `/p_2/`, `/p_3/`… and repeats the last page once it runs out, so stop when a page
yields no new IDs rather than trusting a page count.

## The verification gate

The 2026-07-26 run reported four properties as matches and **all four were off market**, because
status was inferred from search-engine snippets. Search engines keep sold listings indexed with
"For Sale" in the title for years. The rules that follow still stand:

1. A listing may only be presented as a match once price, beds, full baths, acreage and pool have
   been confirmed against **MetroListPRO**. The IDX feed alone is not sufficient.
2. Where two sources disagree, **the MLS of record wins**, and the disagreement gets printed on the
   card rather than quietly resolved. The 2026-08-15 run hit exactly one: 1988 Cold Springs Rd read
   Active on the IDX and Pending on MetroList. It is shown as Pending.
3. MetroList MLS numbers encode the listing year — `221…` = 2021, `225…` = 2025, `226…` = 2026. A
   prefix older than the current year is strong evidence of a stale listing.
4. Never trust search-result text for bed/bath/acreage either. It routinely conflates neighbouring
   properties: one search this run attributed 1234 Rising Hill's 2.69-acre lot to 6881 Sagittarius,
   which actually sits on 40 acres.
5. Prefer under-reporting. An empty result is useful; a fabricated match is not.

### Half baths

MetroList reports baths as `full | half`. Some sites render `2 | 1` as "3 baths", which will
silently pass a 3-bath filter with a 2.5-bath house. **Filter on `Full Bathrooms` only.** This
dropped 1234 Rising Hill W Rd (2 full + 1 half) from the 2026-08-15 matches; it is listed under
"Near misses" instead.

### A criterion that silently matched nothing

Renaming `criteria.baths` to `criteria.fullBaths` on 2026-08-15 broke `scrape.js`, which still read
`C.baths`. `parseInt(undefined)` is `NaN`, every comparison against `NaN` is false, and so the card
filter rejected **all 297 listings** on 2026-08-16 while printing a perfectly calm
`0 clear beds/baths/price`. The board still looked right, because the Redfin relist rescue re-found
the seven properties already on it — the failure was invisible in the output and would only have
shown up as new inventory never appearing again. Fixed by reading `fullBaths` with `baths` as a
fallback, and by routing every threshold through `threshold()`, which throws on a missing or
unparseable criterion instead of returning `NaN`.

Two habits this argues for, both cheap:

- **Rename a criterion, grep for the old key.** `listings.json` is read by `scrape.js`, `build.js`
  and the Python helpers, and none of them fail loudly on a key that isn't there.
- **Treat a zero-candidate stage as a bug until proven otherwise.** The three towns always carry a
  few hundred active listings; "0 of 297 cleared" is a parser regression, not a quiet market. Any
  count that collapses to zero between stages deserves a look before the run is published.

### A summary that reported the previous run's news

`scrape.js` builds its output as `{...prior, …}` and never set `runSummary`, so the key was carried
forward untouched — while `build.js` renders it as the "What changed this run" banner. The 2026-08-17
run legitimately recorded `{new: [], priceChanges: [], dropped: [], unchanged: 10}`. On 2026-08-19
that stale object would have published "nothing moved" over a run that actually found a $24,900 price
cut on 3720 Four Springs Dr and lost 3784 Cattle Dr from the market.

This is the same shape of bug as the `previousRun` carry-forward already commented in `scrape.js`:
spreading `prior` preserves *everything*, including the fields that describe the previous run rather
than the data. `scrape.js` now recomputes `runSummary` from this run's own listings before writing.

The general rule: **anything in `listings.json` that describes a run rather than a property must be
rewritten every run, not spread forward.** Today that is `lastRun`, `previousRun`, `source`,
`dataQuality` and `runSummary`.

## Photos

Photos are hotlinked from `m.cbhomes.com`, pulled off each detail page in document order:

```
https://m.cbhomes.com/p/371/<MLS>/<hash>/pdl23tp.webp    # large, ~20-45 per listing
```

- The CDN **rejects `HEAD`** — a `404` from `curl -I` means nothing. Verify with a `GET`.
- This container's headless Chromium has no outbound egress (even `example.com` fails), so a local
  browser render will show every image broken. That is a container limitation, not a page bug.
  Check image URLs with `curl` instead.
- Each card keeps a "View photos" link *behind* the photo strip. Loaded images cover it; failed ones
  remove themselves and the link shows through, so a card can never render as an empty box.

MLS photos are the copyright of the listing brokerage. Fine for a private hunting page; don't
republish more broadly.

## Dedupe rules for future runs

**Read the baseline from `origin/gh-pages`, not from your working branch.** Each run is published to
`gh-pages`, and development branches are cut fresh from an older default branch — so the copy of
`listings.json` you start with is very likely stale. The 2026-08-15 run began from a branch stuck at
2026-07-26 and, on that basis, was about to report all ten properties as brand new and drop six that
were never gone. The live lineage was three runs further along and already tracked exactly those ten.

```bash
git fetch origin gh-pages
git show origin/gh-pages:listings.json > baseline.json
```

Then compare against `baseline.json` before reporting anything.

1. A property already in `listings` is a duplicate — don't re-surface it. Set `isNew: false`.
2. Exception: a price different from `currentPrice` *is* worth reporting. Append to `priceHistory`
   and update `currentPrice`; the card renders the delta automatically.
3. Sold or withdrawn properties move to `dropped` and off the board — the page shows them in
   "Removed this run" so a stale copy resurfacing later isn't mistaken for a new find.
4. Anything in `rejected` stays rejected unless a price change or criteria change brings it back.
   When the criteria change, re-read the stored reasons: several were written against the old 5+
   bedroom rule and had to be corrected.
5. Update `lastSeen` on confirmed-active properties and `lastRun` on every run.

## Running a refresh

Three steps, in this order. **`scrape.js` does not perform the MetroListPRO check** — it verifies
against Redfin's feed only. The page's "How this list is built" table states that every match was
re-read from MetroListPRO, so skipping step 2 publishes a verification claim nothing tested.

```bash
node scrape.js                                    # 1. enumerate + filter + Redfin status check
node -e 'const d=require("./listings.json");require("fs").writeFileSync("matches.json",
  JSON.stringify([...d.listings,...(d.pending||[])].map(l=>({address:l.address,city:l.city,
  mls:l.mls,price:l.currentPrice,beds:l.beds,fullBaths:l.fullBaths,acres:l.acres,
  status:l.status}))))' && python3 verify.py     # 2. confirm each one against the MLS of record
node build.js                                     # 3. render index.html
```

Step 2 prints one line per property; every field must read back clean (`price beds baths acres
pool`). Anything else is a disagreement, and per the verification gate the MLS of record wins and
the disagreement belongs on the card.

`verify.py` reads `matches.json` and writes `verified.json`; both are intermediates and gitignored.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`scrape.js`** — refreshes `listings.json` from the IDX feed; handles dedupe, price history, drops.
- **`verify.py`** — independent MetroListPRO confirmation of every match and pending listing.
- **`crosscheck.js`** / **`mls-status.js`** — the Redfin second opinion `scrape.js` calls to catch
  listings the IDX feed still reports Active after they have gone into escrow.
- **`build.js`** — renders `index.html` from `listings.json`. No dependencies: `node build.js`.
- **`ingest.js`** — merges listings pasted from a portal results page, applying the dedupe rules.
  Kept as a manual fallback; the scrape path above supersedes it.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.

## Publishing

`index.html` is committed to the `gh-pages` branch at the repo root. Enable under
**Settings → Pages → Source: `gh-pages` / `(root)`**.
