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
concurrent. It is scripted as **`mls-enumerate.py`** since 2026-08-31 — `--stamp` records the result
under `dataQuality.independentEnumeration` and `build.js` puts a "Cross-enumerate" row on the page.

#### "Unreadable" has to mean the parser failed, and nothing else

The first version of `mls-enumerate.py` reported **122 of 387 records unreadable** — 31% of the MLS
— and still printed its match list as though the sweep had covered the three cities. It had not, and
a completeness check that cannot say what it missed is worth very little: the whole point of this
sweep is to prove no house slipped through, and a third of the records were in a bucket labelled
"don't know".

None of the 122 was a house. Broken down, they were **91 land parcels**, **23 commercial listings**
and **8 multi-unit residential** records. Land and commercial pages carry no bed/bath header at all,
so the single-family header regex found nothing and the record fell through to the error bucket.

Two parsing details caused it, both worth knowing before touching this file:

- **The `0-` slug rule only catches some land.** `0-HAWK-TRAIL/…` is obviously a parcel, but plenty
  of land carries a street number — `10 Big Oak Court` is 9.8 acres of dirt. Type has to be read
  from the page, not guessed from the URL.
- **The header's `Type:` and the field table's `Property Type:` disagree by design.** The header
  says `Lots / Land` and `Commercial`; the field table says the MLS codes `LL` and `COM`. Matching
  only the readable spelling classified every one of them as unreadable, because `field()` finds
  `Property Type:` first and it wins. `classify()` now checks both spellings.
- **The unit table does not always start at "Unit 1".** Two records begin at `Unit 2` / `Unit 3`,
  so an anchored `Unit 1 Features:` regex missed them; it matches any index now, and falls back to
  the `RI` code and the header's "Multi-Unit Residential".

After the fix: 265 houses read field by field, 114 land/commercial and 8 multi-unit excluded **by
type**, **0 unreadable** — and the same 8 records the board already carried, 0 new. That is a real
completeness statement; the first one was not.

Multi-unit records are excluded rather than dropped: they state beds per unit, so the filter cannot
see a whole-home bed count. Any that clear the lot, price and pool tests are printed as
"needs a human read" instead of being silently discarded — the 1781 Springvale Rd case above is
exactly this shape.

The general rule, and it is the same one the verification gate encodes one level up: **an error
bucket that collects normal cases stops being an error signal.** If a category can be recognised,
recognise it — "excluded because it is a parking lot" and "I could not read this page" must never
share a counter.

A third source is available if either of the above breaks: **`www.homefinder.com`** serves MetroList
records through the Move/realtor.com pipeline, embedded as JSON in `<script id="__NEXT_DATA__">`
(`source.name === "MetroList"`, with `list_price`, `description.beds`, `baths_consolidated`,
`lot_sqft` and `status`). It is independent of both the IDX feed and Redfin. Its limitation is the
same as Redfin's: it renders roughly 40 listings per city and ignores path filters and pagination, so
it can confirm or contradict a known listing but must never be used to enumerate inventory.

A fourth, found on 2026-09-02 and the best of the fallbacks: **`www.exprealty.com`**. City pages at
`/<city>-ca-real-estate` (`?page=N`, 26 per page) carry the whole result set in
`<script id="__NEXT_DATA__">` under `props.pageProps.props.listings`, one flat object per listing
with `mls`, `price`, `bedrooms`, `bathrooms`, `standardStatus`, `on_market_date` and — the useful
part — **`pool` as a structured boolean on the search card**, which no other source gives without a
detail fetch. A sweep of the three cities returned 306 records against the IDX feed's 294 that day,
and agreed with the board on every hard field for all seven MLS-verified matches.

Two limits. It lists **active records only**, so absence there means "active or gone", never
"pending" — 2565 Stagecoach Rd was missing from the city sweep and its detail page carried
`standardStatus: 10`, matching the board's Pending. And its index has holes: 1988 Cold Springs Rd
(MLS 226033527) was absent from both the sweep and its own address URL, which answered
`missingAddress`, while the IDX feed, MetroListPRO and Zillow all carried it. So it corroborates
well and enumerates *nearly* — treat a gap there as an indexing gap, not a status change, and
confirm against MetroListPRO before acting on it.

All of these need a normal browser `User-Agent`; the default agent string gets blocked.

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

#### An excuse with no expiry date

"Too new for the MLS to have indexed it" is a fair reading on day one. 3538 Wildwood Ln was still
unindexed on 2026-08-31, five days after listing, and the card was still saying the listing had
"gone live too recently" — a claim that gets weaker every day it repeats while looking exactly as
confident as it did on day one.

`verify.py` now records `since` (the date a record was first seen unindexed) alongside each entry in
`source.mlsAwaitingIndex` and carries it across runs. Under a week the note reads as before. Past a
week it stops asserting a cause it can no longer support and says what is actually observed —
missing since date X, longer than indexing normally takes, worth a call to the listing agent. A
record absent for that long is likelier withdrawn or mis-keyed than newly published, and that is a
different thing for a reader to act on.

Generalising: **a caveat that explains away a gap needs a clock on it.** Any note of the form "this
will resolve itself shortly" should be written so it expires on its own, because the case where it
stops being true is precisely the case worth surfacing.

#### …and the clock has to be wound by something that outlives the run

The clock above was fitted on 2026-08-31 and could never have struck. `verify.py` reads the previous
`since` out of `listings.json` — but it runs as step 2, *after* `scrape.js` has already rewritten
that file, and `scrape.js` builds `source` literally with no spread precisely because of the
carry-forward rule three sections up. `mlsAwaitingIndex` was not in the rebuilt object, so
`prior_awaiting` was empty on every run, `since` fell back to `TODAY`, and 3538 Wildwood Ln reported
**0 days unindexed** on 2026-09-01 — its sixth consecutive day missing from the MLS. The `days < 7`
branch was unreachable code: the note could repeat forever while the counter under it stayed at
zero.

`scrape.js` now carries `mlsAwaitingIndex` forward alongside `mlsVerifiedOn`, and the same run then
reported the true **5 days**. Restoring the baseline value by hand and re-running step 2 was enough
to confirm the whole path, because `verify.py` recomputes `days` from `since` every time.

Note what makes this the exception to the rebuild-every-run rule rather than a violation of it.
`since` looks like run metadata — it lives in `source`, it is written by the pipeline, it is a date.
It is not: it is a clock on **one property**, the same kind of fact as `firstSeen` on a listing, and
those have always been carried. The rule's real subject is *values that describe the run that just
happened*, and `inventoryScanned` is one while `since` is not.

Two things generalise, and the second is the sharper one:

- **A carried value read after the thing that rebuilds it is not carried at all.** Two rules that
  are each correct in isolation — "rebuild what describes a run", "carry the clock across runs" —
  cancelled out because of step order. When state has to survive a run, check *which* artefact the
  reader sees, at the point in the sequence it reads it.
- **A counter that resets is worse than no counter**, because the expiry it feeds looks like it is
  working. Nothing failed loudly here: the note rendered, the pipeline reported success, the page
  read as confident on day six as on day one. Any threshold on an accumulating value deserves one
  check that it can actually be crossed — if no run can reach the branch, the branch is decoration.

### Half baths

MetroList reports baths as `full | half`. Some sites render `2 | 1` as "3 baths", which will
silently pass a 3-bath filter with a 2.5-bath house. **Filter on `Full Bathrooms` only.** This
dropped 1234 Rising Hill W Rd (2 full + 1 half) from the 2026-08-15 matches; it is listed under
"Near misses" instead.

#### …except it wasn't, for two and a half weeks

That last sentence was false from the day it was written until 2026-09-02. The near-miss branch in
`scrape.js` has always had a `only N baths` case, but it lives in the loop over **candidates**, and
the card-level filter above it cut anything under the full-bath minimum. A listing failing on baths
was dropped one stage before the stage that would have recorded it as a near miss. The line was
unreachable, so 1234 Rising Hill W Rd — pool, 2.66 acres, $685,000, the **cheapest pool-on-acreage
listing in the three towns** — appeared nowhere on the page at all.

The card filter now admits `full >= MIN_BATHS - 1` when the rounded total still clears the bar, so a
one-half-bath-short listing reaches the detail stage and lands in Near misses. The match test is
untouched: `bathsOk` still requires full baths, so a half bath cannot reach the board or the
pool-less section. Cost is about 25 extra detail fetches a run (34 candidates → 59).

The near-miss text names full baths now too. "only 3 baths" on a 2-full-plus-1-half house describes
a house that meets the minimum, which is the exact confusion the half-bath rule exists to prevent;
it reads `only 2 full baths (+ 1 half)`.

Two things generalise:

- **A filter that excludes is also a filter that hides.** Every stage that drops a record decides
  what the later stages are allowed to say about it. When an early cut is the enforcement of a
  criterion, ask what still needs to *report* on the thing being cut — the exclusion rule and the
  explanation rule need different, wider, gates.
- **A README sentence is not a test.** This one asserted a page state confidently for eighteen runs
  while the page never had it. Where the docs claim a property is on the page, the cheapest possible
  check is to look for it there.

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

### The last section still riding the carry-forward

The rule above was applied to `runSummary`, then to `source` and `dataQuality`. `poolless` was
missed, and it was the one that mattered most, because it is the only section whose rows carry
MLS-confirmed fields. `scrape.js` never wrote the key at all, so `{...prior}` had been serving the
same thirteen rows since whichever run last built them by hand.

On 2026-08-28 it showed **4661 Holm Rd at $935,000**, with an `mlsPrice` of $935,000 beside it
implying the MLS had confirmed that number. The IDX feed said $899,900 and a MetroListPRO read
agreed — a $35,100 cut the board had been carrying stale, on exactly the section the "pool-less rows
carry unverified prices" note above is about. The same frozen list still carried **2730 Golden Fawn
Trail**, which had since **closed**: its IDX detail page reads `Status: Closed` and MetroListPRO
answers 404 for MLS 226091151.

`scrape.js` now rebuilds `poolless` in the candidate loop from that run's own detail reads, for
Active *and* Pending listings, so a poolless property going into escrow shows in its status column
instead of dropping out silently. The MLS-confirmed fields (`mlsPrice`, `mlsPool`, `reason`) are
carried forward **only while the price they were read against still holds**; once the price moves
they are dropped rather than left to vouch for a number that no longer exists.

Two things generalise. First: the carry-forward rule needs a list, not a memory — the fields that
describe a run are `lastRun`, `previousRun`, `source`, `dataQuality`, `runSummary`, and every
derived section (`nearMisses`, `poolless`). Second, and sharper: **a stale value is worse when it
travels with a provenance stamp.** A stale price is a wrong number; a stale price next to `mlsPrice`
is a wrong number wearing a badge that says it was checked. When a fact goes stale, its confirmation
has to go with it.

While fixing it, the same shape turned up in prose: `build.js` ended the section's note with a
hardcoded "check the status column, one is already pending" — true when written, and silently wrong
the moment the count changed. It is rendered from the data now.

## Photos

Photos are hotlinked from `m.cbhomes.com`, pulled off each detail page in document order:

```
https://m.cbhomes.com/p/371/<MLS>/<hash>/<rendition>.webp    # ~20-45 photos per listing
```

The JSON-LD hands over `full.webp`. Renditions worth knowing, because the choice is worth ~7 MB:

| Rendition | Size | Notes |
|---|---|---|
| `original` | 1500x1125 | 4:3, 170-450 KB |
| `full` | ~1486x1111 | 4:3, 74-375 KB — what the feed gives |
| `m23cc` | 600x400 | 3:2, **centre-cropped** — what the cards use, ~50 KB |
| `s23cc` | 308x205 | 3:2 centre-cropped thumbnail |
| `pdl23tp` / `pdm23tp` / `pds23tp` | 3:2 | **Padded**, not cropped — white bars under `object-fit:cover` |

The card's photo box is 3:2 and ~340 CSS px wide, so `full` was shipping roughly four times the
pixels it could show: six per card across nine cards came to **9.4 MB**, against **2.0 MB** for
`m23cc`, which needs no cropping at render time because it is already the right shape. `scrape.js`
rewrites `full.webp` to `m23cc.webp` and leaves any URL that doesn't match that shape alone. All 54
photos on the 2026-08-28 board had the rendition; if one ever doesn't, the card's `onerror` handler
uncovers the "View photos" link behind it rather than leaving a hole.

### Pin the CDN host, or every diff is noise

The feed serves the same photo from `m.cbhomes.com` and `m1.cbhomes.com` at random — byte-identical,
verified by checksum on 2026-08-30. Taking whichever host the feed happened to hand over meant a
dozen photo URLs were rewritten on *every* run, so a "nothing moved" run still produced a 30-line
diff and the CDN churn sat in the same commit as any real change. `scrape.js` now normalises
`m<n>.cbhomes.com` to `m.cbhomes.com`, and the 2026-08-30 run's diff went to zero lines outside the
date stamps.

Worth generalising, because this repo's whole review model is reading the run diff: **a value that
changes on its own is noise, and noise in a diff is not free — it is cover for a real change nobody
looks at twice.** Normalise anything that varies without meaning.

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

Then, on any run reporting no movement, the completeness check — every MLS record in the three
cities, straight from the MLS of record, filtered independently of the IDX feed:

```bash
python3 mls-enumerate.py --stamp                  # 4. cross-enumerate; run before step 3
```

It stamps nothing if any page failed to parse, so a partial sweep cannot publish a completeness
claim. Run it before `build.js` if you want the "Cross-enumerate" row on the page.

Also available, and it caught a stale price on 2026-08-23 — a Redfin enumeration as a second
cross-check:

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

### Do not refresh with `refresh.py`

`refresh.py` is an older, parallel composer that reads plausibly and is wrong in four silent ways.
The 2026-08-29 run tried it before checking the documented order, and it produced a board that
rendered perfectly while stating the wrong thing:

1. It treats a MetroListPRO "Not Found" as "the MLS says not active" and drops the listing. That
   run it would have dropped **3538 Wildwood Ln** — an active, verified match — for the sole reason
   that the MLS site has not indexed a listing this new. The section above exists precisely because
   absence and contradiction are different findings; `verify.py` gets this right and `refresh.py`
   does not.
2. It never writes `pending`, so the previous run's escrow list is republished as if re-checked.
3. It never writes `runSummary` or `poolless`, so the "What changed this run" banner and the
   pool-less table keep the previous run's numbers.
4. It writes `nearMisses` as a dict where `build.js` reads an array, silently emptying that table.

It now refuses to run without `--i-know-this-is-superseded`. The general lesson is the same one the
verification gate encodes: **a pipeline that fails silently is worse than one that fails loudly**,
and a second composer that has to be kept in step with the first will drift.

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
- **`mls-enumerate.py`** — independent second enumeration from MetroListPRO's own city indexes, the
  only source that both enumerates and speaks for the MLS of record. Writes `mls-enumeration.json`;
  `--stamp` records the result under `dataQuality.independentEnumeration`. Never touches the board.
- **`refresh.py`** — superseded composer, guarded so it can't be run by accident. See above.
- **`ingest.js`** — merges listings pasted from a portal results page, applying the dedupe rules.
  Kept as a manual fallback; the scrape path above supersedes it.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.

## Publishing

`index.html` is committed to the `gh-pages` branch at the repo root. Enable under
**Settings → Pages → Source: `gh-pages` / `(root)`**.
