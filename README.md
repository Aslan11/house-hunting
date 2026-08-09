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

## Running it

```bash
node scrape.js      # refresh listings.json from the live MLS feed
node build.js       # render index.html
```

`node scrape.js --dry` scrapes and reports without writing, which is the safe way to
check what a run *would* change.

Takes roughly 5–8 minutes, almost all of it waiting on the ~70 detail-page fetches.

## Where the data comes from

The **Coldwell Banker Homes** site (`coldwellbankerhomes.com`) republishes the MetroList
MLS IDX feed — MetroList is the MLS that actually covers El Dorado County — and serves it
as clean JSON-LD. It does not bot-block this environment, which nearly everything else does.

The pipeline is three stages:

1. **Enumerate.** Walk `/ca/<city>/p_N/` for each of the three cities. Each page carries a
   JSON-LD `CollectionPage` with 24 `RealEstateListing` records: address, price, beds,
   baths, sqft, geo, photo. This is the *complete* active inventory, not a search-engine
   sample — roughly 300 listings across the three towns.
2. **Filter.** Keep the ones clearing beds, baths and price. Typically ~67 of ~307.
3. **Verify.** Fetch each survivor's detail page for the fields the search page lacks:
   `Lot Size (Acres)`, the `Pool` / `Pool Description` fields, and the true listing status.

## ⚠️ Traps that have already burned this tracker

**1. Search-engine snippets are not listing status.** The first run reported four matches;
all four were off market. Search engines index listing pages that keep "For Sale" in the
`<title>` for years after closing, and snippets conflated two properties on the same street
into one listing with the wrong MLS number, bed count and price. Only a live listing page
or an authoritative feed counts.

**2. `IsActive` is true on pending listings.** The IDX feed exposes an `IsActive` boolean
and a schema.org `availability: InStock`. Both stay set on listings that are already in
escrow. Two of the twelve otherwise-qualifying properties found on 2026-07-28 were
**Sale Pending** despite `IsActive: true`. Status is therefore read from the listing's own
visible `Status:` field, which `scrape.js` stores as `mlsStatus` — never from `IsActive`.

**3. A portal search page is not a complete result set.** A cross-check run on 2026-07-30 scraped
the *rendered listing cards* out of Redfin's filtered search HTML and found 7 of the 9 matches. The
two it missed (1234 Rising Hill W Road, 1781 Springvale Road) were not disqualified — Redfin only
renders the first page of cards, roughly 30–40, and Placerville has more inventory than that. The
sweep looked complete and was not.

This is why the primary pipeline enumerates `/p_N/` pages until exhausted rather than reading one
page, and why `redfin.py` parses the embedded `ReactServerAgent.cache.dataCache` payload instead of
the visible cards. A cross-check that agrees with the primary sweep is only meaningful if it was
itself complete; a partial sweep that happens to agree proves nothing. If a future run's cross-check
returns *fewer* matches than the primary, suspect pagination before suspecting the primary.

**4. The feed's bath count rounds half baths up.** The search feed's
`numberOfBathroomsTotal` reports "2 full + 1 half" as **3**. MetroList and every portal call
that **2.5**, and a 2.5-bath home does not clear a 3-bath minimum. On 2026-07-31 this had
1234 Rising Hill W Rd sitting in the match list on a bath count it does not have. The detail
page carries `numberOfFullBathrooms` and `numberOfPartialBathrooms`, so `scrape.js` now computes
`full + 0.5 * partial` and filters on that. Two properties were affected; only one changed
category.

**5. An id scheme is part of the data contract.** The feed switched from spelling street types
in full ("Rising Hill W **Road**") to abbreviating them ("Rising Hill W **Rd**"). Ids were a
plain slug of the address, so every tracked property got a new id: the 2026-07-31 dry run
reported **9 new and 9 dropped** against inventory that had barely moved. `slug()` now
canonicalises street suffixes and directionals, and `merge()` re-slugs prior ids through the
current normaliser before comparing. If a run ever reports that *everything* is new, suspect
the id scheme before believing it.

**6. A detail page's status can be wrong in *both* sources at once.** Trap 2 says to read
status from the listing's own `Status:` field rather than `IsActive`. On 2026-08-02 that was not
enough: **3033 Ridgeline Dr** and **1988 Cold Springs Rd** were carried as Active matches, and the
IDX detail pages backed that up. MetroList had both as **Pending**. The only thing that caught it
was a second feed disagreeing — `crosscheck.js` returned 6 matches where `listings.json` claimed 8,
and the two missing ones were exactly the two in escrow.

The rule that follows: a listing the primary pipeline calls Active, but the cross-check does not
return, is *presumed pending* until a detail page proves otherwise. Do not resolve the disagreement
by re-reading the source that is already wrong.

**This is now enforced in the pipeline, because leaving it to the operator failed twice.** On
2026-08-03 the IDX feed reported **1988 Cold Springs Rd** as Active *again* — the same property as
the day before — and because it had been dropped on 08-02, it came back through `merge()` as a
**new** match. A run that trusted the primary feed would have announced a new listing that was
actually in escrow.

`mls-status.js` closes this. It pulls Redfin's pending/contingent set (`status=130`) over the same
tiled box `crosscheck.js` uses and indexes it by normalised address; `scrape.js` demotes any
IDX-Active match that appears there, and prints every demotion. Two details matter:

- It keys on a **positive** assertion of Pending from a live feed, not on absence from the active
  feed. Redfin detail fetches fail often enough under throttling that treating "missing" as proof
  of escrow would demote healthy listings on a network hiccup.
- Address normalisation is shared with the id scheme (trap 5). The feeds disagree on street-suffix
  spelling — "Cold Springs **Road**" vs "Cold Springs **Rd**" — so a naive string compare silently
  matches nothing and the guard passes everything through.

If the pending sweep can't complete, `scrape.js` says so and falls back to IDX status rather than
silently behaving as though nothing is pending.

**The "presumed pending" rule needs one qualifier**, found on 2026-08-04. `crosscheck.js` returned 5
matches against the primary's 6, and the missing one was **3784 Cattle Dr** — which looks exactly
like an escrow case and was not one. Read the cross-check log, not just its final count: Cattle Dr
appeared in Redfin's *active* CSV and reached the pool-verification stage, where its detail fetch
failed under throttling (`! could not load 3784 Cattle Dr`). Absent-from-the-active-feed and
fetch-failed-during-verification are different facts that produce the same shortfall in the total.
Only the first is evidence of escrow. Confirmed by re-reading the IDX detail page: Active,
$1,050,000, updated 8/1/2026.

**7. Listing pages embed neighbouring properties.** Detail pages carry data for nearby and
comparable homes alongside the subject. Matching "pool" against the page as a whole therefore finds
pools that belong to a different house down the road. On 2026-08-02 a naive page-text match would
have produced four false matches — including one whose page describes a "150,000-gallon swimming
pool" that belongs to a property a few miles away. `crosscheck.js` reads the subject's own
`Pool Information` amenity group, its `hasPrivatePool` flag and its own marketing remarks, and
reports a pool only when all three agree.

**8. "Looks too small" is not the same as "failed".** `mls-status.js` judged a gis-csv response
by byte length — anything under 2000 bytes was treated as a failed fetch and retried. The active
set is dense, so its tiles always cleared that bar and the heuristic looked fine. The **pending**
set is roughly a tenth the size, so a perfectly good tile carrying three or four listings comes
back at ~1.3KB and was read as a failure. After four retries `curl()` returned `''`, `parseCsv('')`
produced zero rows, and the tile contributed nothing to the index — with no error raised and
`pendingIdxOk` still true.

That is the worst shape this failure can take. A sweep that silently loses whole tiles still
reports itself complete, and absence from the pending index reads downstream as "not in escrow" —
so the guard from trap 6 passes the listing straight through. On 2026-08-07 the sweep stalled
outright and, had it fallen through to IDX status, **1988 Cold Springs Rd** would have been
reported as a new match for the third time; the IDX feed was again calling it Active while
MetroList had it Pending.

Two changes: responses are validated by *shape* (does the CSV header row start the body?) rather
than size, so a valid tile with few rows is accepted and a block page or empty stub is not; and a
tile that genuinely cannot be fetched now throws, which degrades the run to the documented
`pendingIdxOk: false` fallback instead of a confident wrong answer. The general rule — an empty
result and a failed request must never be represented the same way.

**9. A relist looks exactly like a sale.** Traps 2, 6 and 8 are all about a listing that is *less*
available than the primary feed says. On 2026-08-08 the failure ran the other way. **1781 Springvale
Rd** vanished from the IDX sweep entirely and was reported as dropped — "sold, expired, or
withdrawn". It had done none of those things. It was **relisted under a new MLS number**
(226093241 → 226100125) at **$1,250,000, down from $1,500,000**, and the IDX feed had not yet
republished it under the new record. A $250,000 cut on a tracked property was about to be reported
as the property going away.

Absence from the primary feed is not evidence of a sale, for the same reason absence from the
active feed is not evidence of escrow (trap 6). `scrape.js` now pulls Redfin's **active** set
(`statusIndex('9')`) and checks every would-be drop against it. Three properties of the guard matter:

- **It keys on a positive assertion of Active**, never on absence. A property missing from both
  feeds still drops; only one Redfin positively reports as for sale is rescued.
- **A rescued listing does not go back in the match list.** It lands in a separate `relisted`
  bucket, rendered in its own strip with the price delta and a re-verify warning. A relist can
  change the facts the match was verified on — this one went from 5 bd / 6 ba to 4 bd / 4 ba, and
  the new record does not carry a pool flag where the old one did. Carrying it forward as a
  verified match would assert something no detail page has confirmed.
- **The figures on a relisted card come from the cross-check CSV, not a detail page**, and the card
  says so. They are enough to tell you something moved and worth a look; they are not verification.

**10. A bucket that isn't carried forward is a bucket that deletes.** The relist rescue from trap 9
worked exactly once. On 2026-08-09 **1781 Springvale Rd** — the property that rescue was built to
save, still Active on Redfin at $1,250,000, MLS 226100125 — vanished from `listings.json` entirely:
not in `listings`, not in `pending`, not in `relisted`, not even in `dropped`. No record that it had
ever been tracked.

`merge()` built its "what did we know last run" map from `prior.listings` alone. `relisted` was
written fresh each run from that sweep and never read back, so a property that stayed relisted for a
second run simply fell out of the file. Trap 9's lesson — absence from the primary feed is not
evidence of a sale — had been encoded for *matches* and not for the bucket the rescue writes into.
The rescue caught the property and then dropped it on the floor one run later.

The same shape appeared a third time in `build.js`, which filtered the strip to
`relistedOn === data.lastRun`. That was invisible while `scrape.js` re-stamped `relistedOn` every
run, and became a second silent hole the moment the date was carried honestly: an entry present in
the JSON, correct in every field, rendering nowhere. **A property the reader cannot see is not
tracked**, whatever the data file says.

Three rules follow:

- **Every bucket that holds a property must be read back on the next run.** `merge()` now seeds its
  prior map from `listings` *and* `relisted`, and a relist re-checks against both feeds each run:
  back in the IDX sweep → returns to the match list flagged as news; still Active on Redfin → stays
  relisted with its original `relistedOn`; gone from both → drops with a reason.
- **Carried state must not be re-derived from the current record.** `priorMls`/`priorPrice` describe
  the *pre-relist* listing. Recomputing them each run set `priorMls === mls` and reset `priorPrice`
  to the cut price, erasing the $250,000 delta that is the entire point of the strip.
- **A leaving property gets exactly one classification.** See trap 11.

**11. "Left the match list" and "left the market" are different events.** The same run put **3565
Farview Ct** in `pending` *and* in `dropped` with the reason "sold, expired, or withdrawn". It was
neither — Redfin had it Pending at $1,289,000, MLS 226087456. The page would have shown one property
twice, under "Under contract" and "left the list", asserting two contradictory things.

`merge()` computed departures as "tracked last run, absent from this run's *match* list". A property
reclassified into escrow is absent from that list by construction, so every match→pending transition
generated a spurious sale notice. The 2026-08-02 run has the same double entry for 3033 Ridgeline Dr
and 1988 Cold Springs Rd; it only looked survivable because that run hand-wrote a truthful reason
over the generated one.

`merge()` now takes the set of ids classified pending this run and skips them in the drop sweep. And
when a property is absent from the IDX sweep *and* from Redfin's active set, the pending index is
consulted before the word "sold" is used — gone-from-active and sold are not the same fact, and the
feed can tell them apart.

Corollaries worth keeping:

- MetroList MLS numbers encode the listing year: `221…` = 2021, `225…` = 2025, `226…` = 2026.
  A prefix older than the current year is strong evidence a record is stale.
- Prefer under-reporting. An empty result is correct and useful; a fabricated match is not.
- **Never run `scrape.js` twice in one day.** The second run merges against the file the first one
  wrote, so `newThisRun` and `dropped` both come back empty and the run's actual news disappears.
  Use `--dry` to look before writing. (Piping the run into `head` has the same effect by a different
  route: `head` closing the pipe kills the scrape midway, after it has written.)

## Redfin cross-check

Two independent verifiers exist, and the difference between them matters.

`crosscheck.js` (**use this one**) reads Redfin's `gis-csv` endpoint — the same data that backs the
map view, returned as CSV. It is what caught the two escrow listings in trap 6. Run it with:

```bash
node crosscheck.js              # active listings
STATUS=130 node crosscheck.js   # pending / contingent set instead
```

Three things make it a *complete* sweep rather than a sample, which is what `hunt.py` was not:

- **It queries by map polygon, not region id.** Redfin's region ids are not guessable —
  `region_id=17151` returns San Francisco, and county `331` returns Nevada County. The
  autocomplete endpoint that resolves ids properly is bot-blocked; the CSV endpoint is not.
- **It tiles the area and asserts no tile was truncated.** The endpoint silently caps results at
  `num_homes` and returns a short set with no error — a single county-wide polygon came back with
  exactly 350 rows, which looked like an answer and was a truncation. The script throws if any
  tile comes back at the cap, rather than reporting a partial market as the whole one.
- **It ignores the server-side filters that don't work.** `num_beds` and `num_baths` are honoured;
  `max_price` and `min_lot_size` are silently ignored — passing them changes nothing. Price and
  acreage are filtered locally from the CSV columns. `LOT SIZE` is in square feet.

`hunt.py` is the older verifier, built on Redfin's rendered *search cards*. Those render only the
first ~40 per area, so a sweep built on them is silently incomplete — on 2026-07-31 it found 6 of 8
matches and missed two entirely. It is still useful for confirming facts about a property already
found, but do not use it to decide what exists.

## Cross-run behaviour

`scrape.js` merges rather than overwrites, so the schedule can run unattended:

| Situation | What happens |
|---|---|
| Property already tracked, same price | Kept, `newThisRun: false`, not re-surfaced |
| Property already tracked, price moved | `priceHistory` gains an entry; the card renders the delta and it appears under "Price changes" |
| Property not seen before | `newThisRun: true`, appears in the "New this run" strip at the top |
| Tracked property gone from the primary feed, but Redfin still has it Active | Moved to `relisted` with the old and new MLS numbers and the price delta, shown in its own strip and flagged for re-verification (trap 9) |
| Tracked property gone from both feeds | Moved to `dropped` with the date and reason |
| Qualifies but is in escrow | Moved to `pending`, rendered dimmed under "Under contract", with `pendingSince` and its price history carried across runs |
| Fails exactly one of pool / acreage | Recorded in `nearMisses` and shown as a table |

A second run against unchanged inventory reports `0 new, 0 price changes` — that is the
intended behaviour, and the quickest way to confirm dedupe still works.

## Photos

Each listing carries up to six photo URLs in `photos`, hotlinked from the brokerage CDN and
rendered as a horizontally scrollable strip. They are served with
`referrerpolicy="no-referrer"`, which gets past most CDN referrer checks.

The "View on coldwellbankerhomes.com" tile sits permanently *behind* the photo strip rather
than being swapped in on error. Loaded images cover it; an image that 404s **or one that
simply never resolves** both leave the listing link reachable. (Relying on the `onerror`
handler alone left a blank tile whenever a request hung instead of failing.)

MLS photos are the copyright of the listing brokerage. Fine for a private hunting page;
don't republish them more broadly.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`scrape.js`** — refreshes `listings.json` from the live feed. Handles dedupe and history.
- **`mls-status.js`** — second-opinion listing status from Redfin's live feed. `scrape.js` uses the
  `status=130` (pending) index to demote escrowed listings the IDX feed still calls Active (trap 6),
  and the `status=9` (active) index to rescue relisted properties the IDX feed has lost (trap 9).
- **`build.js`** — renders `index.html` from `listings.json`. No dependencies.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.
- **`ingest.js`** — manual fallback: merges listings pasted from a Zillow/Redfin results page.
  Only needed if the primary feed ever goes dark.
- **`NETWORK.md`** — what this environment can and cannot reach, and how to re-test.
- **`crosscheck.js`** — independent Redfin verifier over the `gis-csv` feed. Tiled and
  truncation-checked, so it is a complete sweep. Run it every time; a match the primary
  pipeline reports and this does not is presumed to be in escrow.
- **`hunt.py`** — older Redfin verifier built on rendered search cards. Not a complete sweep.
- **`refresh.py` / `redfin.py`** — an earlier run's Python implementation of the same
  refresh. It converged independently on the same feed and the same three-stage approach,
  and it adds a per-listing MetroListPRO cross-check that `scrape.js` does not have.
  Either can drive the page.

### Two refresh implementations

`scrape.js` and `refresh.py` do the same job and agree on the fields that carry history —
`mls`, `firstSeen`, `priceHistory` — which is what makes them interchangeable across runs.
They differ on presentation field names (`newThisRun` vs `isNew`, `summary` vs `desc`) and
on whether `nearMisses` is a flat array or two buckets. `build.js` normalises both, so a
run may use either without breaking the page. **Pick one per run — don't run both**, or the
second will overwrite the first's `lastRun` bookkeeping.

## Publishing

`index.html` is copied to the `gh-pages` branch at repo root. Enable under
**Settings → Pages → Source: `gh-pages` / `(root)`**.
