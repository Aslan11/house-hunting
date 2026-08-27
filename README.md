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

A 2026-08-22 sweep run as an independent check pulled 19 listings across the three cities at 4bd /
3ba / 2.5ac / $1.5M and found the same six pool matches the IDX board carried — useful corroboration,
and still not enumeration: 19 against the feed's 299. Two Redfin quirks worth knowing if you run one
of these again: `/city/<id>/…` URLs redirect by id, and a wrong id silently serves a **different
city** (17151 is San Francisco, not Shingle Springs) — `/zipcode/<zip>/…` has no such failure mode.
And under load Redfin answers **202 with a stub body** rather than 429, so treat a short body as
retryable and back off; the sweep took several minutes for this reason.

### Why the earlier Redfin sweeps came back thin

The 2026-08-23 run traced the "silently incomplete" problem to the URL, not to Redfin. The
`/filter/…` path is the culprit: those pages render a nearly empty result set, which is why a sweep
returned 12 listings for 95667 and missed a tracked match. **A bare `/zipcode/<zip>` page does
not.** It embeds the full GIS search payload — every active listing in the region with beds, baths,
price, lot size, MLS number and status — inside `te.InitialContext`. That path returned 238 rows for
95667, 152 for 95682 and 37 for 95672 (321 in the three target cities after filtering on the `city`
field, against the IDX feed's 298), and found the same six pool matches and the same twelve
pool-less near-misses the board carried.

So Redfin *can* enumerate, via `scripts/parse_search.py`. It still is not the board: the IDX feed
plus MetroListPRO remains the source of record, and the gate is unchanged. But a full second
enumeration is cheap and it earns its keep — this one caught a stale price the IDX feed was
carrying (below).

Each query is capped at **350 rows**, and a payload that comes back at the cap is silently truncated;
`parse_search.py` warns when that happens. Treat a result set at the cap as incomplete.

### Pool-less rows carry unverified prices

`verify.py` only reads matches and pendings, so everything in `poolless` and `nearMisses` carries
whatever the IDX feed said, with no MLS confirmation. On 2026-08-23 the Redfin sweep flagged 6287
Oak Hill Rd at $574,900 where the board said $599,000; MetroList confirmed $574,900, so the board
had been carrying a stale price. It only mattered a little — the property has no pool and was never
a candidate — but a pool-less listing is exactly what a price cut could turn into a near-miss worth
a second look, so the number should be right. Either widen the verify step or keep running the
Redfin sweep as the cross-check.

Two hosts do serve real, current El Dorado County data and are what the pipeline runs on:

1. **`www.coldwellbankerhomes.com`** — an IDX site carrying the **MetroList** feed. City pages embed
   every active listing as JSON-LD (`ItemList` → `RealEstateListing`), and detail pages carry the
   full MLS field table as `LocationFeatureSpecification` pairs: `Pool`, `Pool Description`,
   `Lot Size (Acres)`, `Full Bathrooms`, `Half Bathrooms`, `Status`, `Source`.
2. **`www.metrolistpro.com`** — the **official MetroList MLS** search site, used for verification.
   Only the MLS number in the URL matters, so any record resolves directly:
   `https://www.metrolistpro.com/homes/2/6/x/<MLS>`

### MetroListPRO can also enumerate

The 2026-08-26 run found that MetroListPRO is not only a per-MLS lookup. It serves **server-rendered
city indexes** listing every record in a city, which makes it the one source that can both enumerate
*and* speak for the MLS of record. Redfin and homefinder.com cannot do the first; the IDX feed is a
republisher, not the source, for the second.

```
# every ACTIVE record in a city
https://www.metrolistpro.com/lbc/2/<cityId>/6/193/<City-Name>-Real-Estate-For-Sale
# every PENDING record in a city
https://www.metrolistpro.com/lbc/2/<cityId>/6/193/<City-Name>-Real-Estate-Pending-Sale?pending=1
```

City IDs for the target area: **Shingle Springs 873, Rescue 765, Placerville 720** (El Dorado County
is `193`; the county-level index at `/cbc/2/6/193/...` links every city). Each page is a flat list of
`/homes/2/6/<SLUG>/<MLS>` links with no pagination — the whole city is on one page. Slugs beginning
`0-` are vacant land and can be skipped.

On 2026-08-26 this returned **358 active + 63 pending** records across the three cities against the
IDX feed's **296 active**, so the feed is meaningfully narrower than the MLS. Pulling all 284 records
the IDX sweep hadn't covered turned up **zero** additional matches, which is the strongest
completeness check this tracker has run — stronger than the Redfin cross-sweep, because it is the
MLS of record rather than another republisher. Detail pages carry the same field table used for
verification (`Status`, `Lot Size in Acres`, `Has a Pool`, `Bathrooms: <full> | <half>`) plus MLS
photo URLs on `mediarem.metrolist.net`, which hotlink cleanly.

Worth doing when a run reports thin inventory or no movement, at ~350 fetches and a few minutes at 8
concurrent. Record the result under `dataQuality.independentEnumeration` and `build.js` will put a
"Cross-enumerate" row on the page.

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

### When a listing contradicts itself

Rule 2 covers two sources disagreeing. 2026-08-23 turned up the harder case: a single listing
disagreeing with *itself*. 1781 Springvale Rd (MLS 226100125, Placerville, $1.25M, 10.27 acres) is
recorded `Has a Pool: No` by both MetroList and the IDX feed, while its own MLS remarks describe
"an extraordinary 150,000-gallon swimming pool, one of the largest residential pools in the county"
with an adjacent pool bathroom and a studio pool house.

The structured field wins, so it is not on the board. But the resolution is not to silently drop it:
it sits in **Near misses** with the contradiction spelled out, because a human can settle it with one
phone call and the script cannot. Two things make the field plausibly wrong rather than the copy:
it is a `RI` (residential income) listing, a property type where amenity fields are often left
unset, and its bed count — 4 across three separate structures, the main house being 3bd/2ba — means
it would need a judgement call from the reader anyway.

Generalising: **a structured field that contradicts the listing's own remarks is a flag, not a
verdict.** Filter on the field, then surface the conflict rather than resolving it quietly.

### "Not found" is not "does not match"

`verify.py` was all-or-nothing: any record that didn't read back clean suppressed the verification
stamp for every other record. On 2026-08-27 that fired on a listing published the same day —
3538 Wildwood Ln, MLS 226107286, one day on market. MetroListPRO answers `404 Listing #226107286
Not Found`, and its Placerville active index (259 records) doesn't carry it either, so the absence is
consistent across both of that site's surfaces. The MLS simply hasn't ingested it yet.

The old code counted that as a disagreement, which had two consequences, both wrong. The page would
have said *"Last confirmed 2026-08-26, not on this run"* — discarding the eight records that had just
been re-read clean. And it would have given a brand-new listing the same signal as a genuine
contradiction, which is the signal reserved for a listing the MLS actively refutes.

The two now have separate paths. A "Not Found" body is recorded as `source.mlsAwaitingIndex` and a
per-card `statusNote`; a field mismatch still vetoes the stamp as before. So the stamp reflects the
records that were checked, and the caveat lands on the one card it applies to instead of on the whole
board. `verify.py` clears the note once the record does get indexed, so it can't outlive its cause.

An unverifiable listing is not dropped, but it does not get to look as solid as the rest. This one
was carried because a second independent source agreed on every hard criterion: Redfin returns the
same MLS number, price, bed and full-bath count and a 5.00-acre lot, plus the MLS amenity table
(`POOL_PRIVATE_YN: Yes`, Gunite) and captioned pool photos. That is two sources agreeing with the
third pending, and the card says exactly that.

The general rule: **absence of a record and contradiction by a record are different findings, and a
gate that collapses them will either hide new inventory or discredit good data.** When a check can't
run, say which check and on which item — don't downgrade everything it would have covered.

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

### A run summary with no category for the thing that happened

`runSummary` tracked four kinds of movement — `new`, `priceChanges`, `dropped`, `relisted` — and a
property going into escrow is none of them. On 2026-08-25 2565 Stagecoach Rd moved from the active
board to the pending list: all four arrays were legitimately empty, so `build.js` published
**"Nothing moved"** on a run where the active count fell from 6 to 5 and the headline stat above the
banner already said `5`. The page contradicted itself.

Note the difference from the two bugs above: nothing was stale and nothing was carried forward. The
summary was correctly recomputed and correctly empty. The gap was in the *vocabulary* — there was no
category for a property crossing between sections, so a real event had nowhere to be recorded.

`scrape.js` now diffs each property's section against the prior run and writes `statusChanges`
(`{address, city, mls, from, to}`), which `build.js` renders in the banner in both directions —
under contract, and back on the market after a deal falls through. Going pending is the most
actionable thing that can happen to a property someone is watching, so it must never be silent.

The general rule: **when a summary reports "nothing happened", check that it has a category for
everything that can happen.** An empty array is only good news if something would have filled it.

### The same carry-forward, two keys over

The rule above was written but only `runSummary` was fixed. `source` and `dataQuality` were still
built as `{ ...prior.source, … }` and `{ ...prior.dataQuality, … }`, so every key the spread didn't
happen to overwrite stayed frozen. By 2026-08-22 `source` carried `scanned: 301` and
`verifiedMatches: 10` from a sweep that had since been superseded by `inventoryScanned: 299` and
`verifiedActiveMatches: 6` — two pairs of keys for the same two facts, disagreeing — and
`dataQuality.note` still described a status disagreement on 1988 Cold Springs Rd that MetroList had
long since resolved.

Both are now constructed literally in `scrape.js` from that run's own counters, with no spread. The
duplicate `scanned`/`verifiedMatches` keys are gone. If you add a field that describes the run, add
it there and give it a value every time.

### A verification claim nothing had tested

`build.js` rendered a flat "All N agreed" in the *Verify* row of "How this list is built", with no
date and no input from the step that does the verifying. `scrape.js` never contacts MetroListPRO, so
on any run where step 2 was skipped the page still asserted a check that had not happened — and
`source.mlsVerifiedOn` sat at 2026-08-17 while the page implied today.

The date is now written by the code that earns it: `verify.py` stamps `source.mlsVerifiedOn` and
`mlsVerifiedCount` into `listings.json`, and **only when every record read back clean**. `build.js`
compares that date against `lastRun` and, when they differ, says the board was re-enumerated but not
re-verified, naming the date it last was. A skipped step 2 is now visible on the page instead of
being papered over.

The general form of this one: **a page that makes a claim about process should render it from the
artefact that process leaves behind, never from a hardcoded sentence.** A hardcoded sentence cannot
tell the difference between a check that passed and a check that never ran.

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

Optional but cheap, and it caught a stale price on 2026-08-23 — an independent enumeration to
cross-check the board:

```bash
scripts/fetch.sh search                                  # ZIP pages -> work/
python3 scripts/parse_search.py work/rf_9566*.html work/rf_956*.html > work/all.json
```

Filter `all.json` on `city` (never on the ZIP fetched — Redfin spills nearby towns into the result),
then compare the surviving set against `listings.json`. A property Redfin has that the board does
not, or a price that disagrees, is worth a MetroListPRO read before publishing.

Step 2 prints one line per property; every field must read back clean (`price beds baths acres
pool`). Anything else is a disagreement, and per the verification gate the MLS of record wins and
the disagreement belongs on the card.

`verify.py` reads `matches.json` and writes `verified.json` — both intermediates, both gitignored —
and, when **every** record reads back clean, stamps `source.mlsVerifiedOn` / `mlsVerifiedCount` into
`listings.json`. That stamp is what `build.js` renders, so the order matters: run step 2 before step
3, or the page will correctly report that the board was re-enumerated but not re-verified.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`scrape.js`** — refreshes `listings.json` from the IDX feed; handles dedupe, price history, drops.
- **`verify.py`** — independent MetroListPRO confirmation of every match and pending listing.
- **`crosscheck.js`** / **`mls-status.js`** — the Redfin second opinion `scrape.js` calls to catch
  listings the IDX feed still reports Active after they have gone into escrow.
- **`build.js`** — renders `index.html` from `listings.json`. No dependencies: `node build.js`.
- **`scripts/fetch.sh`** / **`scripts/parse_search.py`** / **`scripts/parse_detail.py`** — the
  independent Redfin enumeration described above, run as a cross-check rather than as the board.
  `fetch.sh search` pulls the ZIP pages, `parse_search.py` flattens the GIS payload, and
  `parse_detail.py` reads the MLS amenity table off a listing page — asserting the `propertyId` in
  each API blob matches the page requested, because a Redfin detail page also embeds comparable and
  nearby-home payloads and a loose regex will happily return a neighbour's pool status.
- **`ingest.js`** — merges listings pasted from a portal results page, applying the dedupe rules.
  Kept as a manual fallback; the scrape path above supersedes it.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.

## Publishing

`index.html` is committed to the `gh-pages` branch at the repo root. Enable under
**Settings → Pages → Source: `gh-pages` / `(root)`**.
