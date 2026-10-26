# Network reality for this tracker

Superseded as of **2026-08-15**. Outbound HTTPS now works — the egress gateway is open and
`recentRelayFailures` is empty:

```bash
curl -sS "$HTTPS_PROXY/__agentproxy/status" | python3 -m json.tool
```

What blocks listing data now is **site-side bot defence**, not the proxy. Distinguish the two: a
gateway denial shows up in `recentRelayFailures`; a site block does not.

## Host status, measured 2026-08-15

| Host | Result | Usable |
|---|---|---|
| `www.coldwellbankerhomes.com` | 200, correct city, full MetroList IDX data | **Yes — primary** |
| `www.metrolistpro.com` | 200, official MetroList MLS records by MLS number | **Yes — verification** |
| `m.cbhomes.com` | 200 on `GET` (rejects `HEAD`) | **Yes — photos** |
| `www.redfin.com` | 200, full GIS payload on `/zipcode/<zip>` | **Yes — cross-check only** |
| `www.mlslistings.com` | 200, server-rendered MLS sheet by `/property/<PREFIX><MLS#>` | **Yes — foreign-MLS second source** (added 2026-10-23) |
| `www.zillow.com`, `www.homes.com`, `www.movoto.com`, `www.remax.com`, `www.har.com` | 403 | No |
| `www.realtor.com` | 429 | No |
| `www.redfin.com/stingray/api/gis-csv` | 200, CSV export of a region's listings | **Yes — cross-check** |
| `www.redfin.com/stingray/do/location-autocomplete` | 403 (CloudFront) | No |
| `www.century21.com` | 200 but client-rendered shell, no data in HTML | No |

Both usable hosts require a browser `User-Agent`. The default agent string is blocked.

### `www.mlslistings.com` — the one host that answers when Redfin's detail pages will not

Added **2026-10-23**, after `foreign-verify.py` stamped 0 of 2 on three consecutive runs. The
distinction that matters: Redfin throttles **per endpoint class**, so `gis-csv` at 200 says nothing
about detail pages, and it is detail pages that step 2b needs. On this run `gis-csv` answered fine
and detail pages answered **202 with an empty body from the session's very first request**, before
this run had fetched anything in volume — so for the foreign-MLS step that class is better read as
blocked than as throttled by use.

MLSListings serves what that step actually needs, as plain server-rendered HTML:

```bash
curl -sS -A "$UA" https://www.mlslistings.com/property/ME226107286   # MetroList
curl -sS -A "$UA" https://www.mlslistings.com/property/BE41150059    # MAXEBRDI
```

The `<title>` carries address, beds, baths and **status** (`(Active)`); the body carries the
structured `Pool` field, price in `<meta name="description">`, and the photo gallery with per-photo
categories on `data-category`. Prefix is the originating board: `ME` MetroList, `BE` MAXEBRDI,
`ML` MLSListings' own.

Two traps, both already familiar from other hosts here:

- An **unknown id returns 200** with the site's generic search page, not a 404 — the same
  wrong-property-at-200 failure as Redfin's `/city/<id>` URLs. Gate on the `<title>` containing
  both the expected street and the MLS number before reading a single field.
- Agent remarks in `<meta name="description">` are **truncated to ~160 characters**; the full text
  is in the longest `<p>` in the body. Don't mistake the truncation for the whole remarks.

`www.redfin.com/stingray/api/gis-csv` was 200 throughout this run, and listing **detail** pages
(`/CA/<city>/<slug>/home/<id>`) were 202-with-empty-body throughout — both measured 2026-10-23.

The Redfin row was corrected on **2026-08-23**. The "decoy page for another state" was real but
self-inflicted: `/city/<id>/…` resolves by numeric id, and a guessed id serves a complete,
valid-looking page for a different city (17151 is San Francisco, not Shingle Springs). HTTP 200 on a
wrong id looks exactly like success. `/zipcode/<zip>` has no such failure mode and returns the full
GIS search payload — good enough to enumerate as a cross-check, though the board still comes from
the IDX feed. Either way, **assert the expected city appears in the returned HTML** before trusting
a page.

Redfin also answers **202 with a stub body** under load rather than 429. A short body is retryable;
back off and try again, and never read a 202 as a missing listing.

The throttle is **per-endpoint-class, and it clears unevenly**, measured 2026-10-22 while recovering
from a self-inflicted overload (see the README section "Exploratory fetches spend the same quota the
pipeline needs"). Within a minute of the offending process dying, `api/gis-csv` was back to 200 with
a full CSV while listing **detail pages were still 202 with an empty body**. So a successful
`gis-csv` pull is *not* evidence that the detail reads will work, and the step that needs detail
pages — `foreign-verify.py`, via `parse_detail.py` — can still be blocked when the sweep is fine.
Probe the endpoint class a step actually depends on before concluding Redfin has recovered.

## `stingray/*` is not blocked as a whole — corrected 2026-09-06

The row above used to read `www.redfin.com/stingray/* | 403 (CloudFront) | No`, generalising from a
single blocked path. It is per-endpoint: `do/location-autocomplete` is CloudFront-blocked,
`api/gis-csv` is not, and the latter returns a clean CSV of a region's listings — no HTML parsing.

```bash
curl -sS -A "$UA" -H "Referer: https://www.redfin.com/zipcode/95682" \
  "https://www.redfin.com/stingray/api/gis-csv?al=1&num_homes=350&ord=redfin-recommended-asc\
&page_number=1&region_id=39806&region_type=2&sf=1,2,3,5,6,7&status=9&uipt=1,2,3,4,7,8&v=8"
```

`region_id` is Redfin's **internal** region id, not the ZIP. Passing the ZIP returns HTTP 200 with a
full, valid-looking CSV of listings **in another state** — the same silent-wrong-region failure the
`/city/<id>/` path has. Scrape the id, and assert the city column before trusting a row:

```bash
curl -sSL -A "$UA" https://www.redfin.com/zipcode/95682 | grep -oE 'region_id=[0-9]+'
```

Current ids: **95682 → 39806**, **95672 → 39796**, **95667 → 39791**. The CSV footer states that
some MLS listings are excluded from the download, so this stays a cross-check and never the board.
A 2026-09-06 sweep this way returned 291 active listings in the three cities and found the same six
pool matches — the same corroboration `scripts/parse_search.py` gives, with less parsing.

One thing it did add: **3538 Wildwood Ln, which MetroListPRO still has not indexed** (10 days), read
`For sale` on its live Redfin page, MLS 226107286, 10 days on market, at the board's $949,000. When
`verify.py` carries a match as unverified-because-unindexed, this is a cheap second opinion.

The listing page also carries a status banner that discriminates correctly — `For sale` vs
`Off Market`, validated on 2026-09-06 against two known-sold properties — and structured pool
fields (`"hasPrivatePool"`, plus the MLS `Pool Information` amenity group). Unescape the embedded
JSON (`\"` → `"`) before matching. Beware **spa-only** records: 5025 Eco Ridge Rd carries
`Spa/Hot Tub Personal` with no pool, and prose is no guide either — listing descriptions mention
neighbours' pools, nearby pool contractors and "room for a future pool".

## Host status re-measured 2026-10-04 — two rows have changed

Zillow and Redfin's autocomplete both answer now. The table above records them as blocked; that was
true when measured and is not any more.

| Host | Was | Now |
|---|---|---|
| `www.zillow.com` | 403 | **200** — full listing JSON, descriptions, photo URLs |
| `www.zillowstatic.com/autocomplete/v3/suggestions` | — | **200** — returns `zpid` and an `addressType` |
| `www.redfin.com/stingray/do/location-autocomplete` | 403 (CloudFront) | **200** |
| `www.homes.com`, `www.movoto.com` | 403 | 403 (unchanged) |
| `www.realtor.com` | 429 | 429 (unchanged) |

The Zillow autocomplete row is the useful one: `addressType` discriminates `forsale_address` from
`sold_address`, which is a cheap status second-opinion that needs no page fetch.

### It does not promote Redfin or Zillow to a source of pool data

The 2026-10-04 run tested exactly that and it failed in both directions on the eight-match board.
Redfin's MLS `Pool Information` amenity group, read per listing:

- **3720 Four Springs Dr, Rescue** — Redfin exposes no pool amenity group at all. MetroList
  (MLS 226083791) records `Built-In, On Lot, Pool Sweep, Gunite Construction`. A **false negative**
  that would have dropped a verified match off the board.
- **1781 Springvale Rd, Placerville** — Redfin reports `Has Pool`. MetroList records no pool, and the
  listing is a **triplex**, not single-family. A **false positive** that would have put a
  retired-from-tracking property back on the board as a match.

Both errors were caught only because the baseline came from `origin/gh-pages` and the board was
re-read from MetroListPRO. Neither listing's Redfin record is *wrong* in a way that is detectable
without the MLS — which is the whole argument for the verification gate.

So the standing rule extends unchanged to amenity fields: **use Redfin and Zillow to contradict a
status, never to establish the inventory, the criteria fields, or the pool.** What the new access
buys is a second opinion and full listing descriptions, not a second board.

#### The Four Springs false negative was a missing `listingId`, not a Redfin data gap — 2026-10-10

The bullet above is a correct record of what was measured and the wrong explanation of why.
`belowTheFold` answers with whichever view the parameters select, and it does not say which one it
gave you:

```bash
# public-records view: 8 amenity groups, no Pool Information group at all
.../belowTheFold?propertyId=167348607&accessLevel=1
# MLS view: 19 groups, including Has Private Pool = Yes
.../belowTheFold?propertyId=167348607&listingId=220405491&accessLevel=1
```

Re-measured on 2026-10-10 against 3720 Four Springs Dr: with `listingId` the group is present and
reads `Pool Features = Built-In, On Lot, Pool Sweep, Gunite Construction`, `Has Private Pool = Yes`
— exactly what MetroList records. Redfin had the MLS pool field the whole time; the call asked for
the public-records view and got an honest answer to a different question.

`redfin-csv.py` already passes `listingId` (it scrapes it off the listing page first), so the
cross-check in the repo is not affected. The trap is for the next person who calls the endpoint by
hand with the `propertyId` sitting in the URL and reads an empty amenity set as "no pool".
**A missing amenity group means the MLS view was not requested. It never means no pool.**

This changes the *support* for the standing rule without changing the rule. Of the two errors cited
above, one was self-inflicted; the false positive on 1781 Springvale Rd is real, is not a parameter
mistake, and is on its own sufficient — structured-field agreement on a triplex still put a retired
property back on the board. Use the MLS of record for the pool. But do not carry the claim that
Redfin's pool field is unreliable *in both directions*; the evidence for that half has dissolved.

#### The Springvale false positive was the *same* missing `listingId` — 2026-10-12

The paragraph above calls that one real and "not a parameter mistake". It is a parameter mistake,
in the other direction, and the same `listingId` fixes it. Measured on 2026-10-12 against
1781 Springvale Rd (`propertyId=167348318`, `listingId=222128780`):

| Call | Amenity groups | `Pool Information` |
|---|---|---|
| `?propertyId=167348318&accessLevel=1` | 11 | **present** — `Has Pool` |
| `?propertyId=167348318&listingId=222128780&accessLevel=1` | 16 | absent |
| `?propertyId=167348318&listingId=222128780&accessLevel=3` | 16 | absent |

So the public-records view does not merely *omit* MLS fields, as the Four Springs case suggested —
for this property it **supplies a pool field the MLS view does not carry**, and MetroList records
no `POOL_PRIVATE_YN` for the listing at all. `redfin-csv.py` reads it correctly as
`pool UNKNOWN` and holds the listing back. The `Has Pool` that the 2026-10-04 run attributed to
Redfin's MLS data came from the assessor-style view, which the call had asked for without meaning
to.

Both 2026-10-04 errors therefore have one cause, and the symmetry is the useful part:
**the public-records view is not a subset of the MLS view.** It can be missing a pool that exists
and can assert a pool that the MLS does not record, so neither an empty amenity set nor a populated
one means anything until `listingId` is on the URL. Checking the group count is the cheap tell —
roughly 8–11 groups is the public-records view, 16–19 the MLS view.

What does *not* change: the verification gate, or the standing rule. The board still comes from the
IDX feed and MetroListPRO, and a property whose MLS record carries no pool field stays off it
whatever Redfin answers. The accurate statement of the residual risk is narrower than "unreliable
in both directions" and narrower than "the evidence has dissolved": called correctly, with
`listingId`, Redfin's pool field agreed with MetroList on every one of the 20 candidates swept on
2026-10-12 — 8 pools confirmed, 11 clean negatives, and Springvale the single unknown, which it
reported as unknown rather than guessing.

An independent sweep that same day, run from a cold start without reading this repo first
(Redfin `gis` per ZIP -> MLS amenity fields -> Zillow JSON-LD cross-check), reproduced the board
exactly: the same 8 pool matches, no additions. Its one extra candidate was 1781 Springvale Rd,
reached through the tags/remarks fallback this file warns against — the predicted failure, arriving
on schedule.

## Headless browser

**Corrected 2026-09-03.** This section previously said Chromium had no outbound network at all,
because even `https://example.com` failed with `ERR_CONNECTION_RESET` with or without
`--proxy-server`. That diagnosis was wrong. Chromium reaches the network fine; its **TLS handshake**
was being dropped.

The proxy logs the failure as:

```
ws_closed_mid_exchange: tunnel closed (code 1006) after 6s; 1820 B sent, 39 B received
```

1,820 bytes of ClientHello out, 39 bytes back, tunnel dead. Chromium's post-quantum key agreement
(`X25519MLKEM768`) produces an oversized ClientHello spanning multiple TLS records and the proxy
drops it. Disable that and everything loads:

```js
chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [
    '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--disable-quic', '--ignore-certificate-errors',
    '--disable-features=EncryptedClientHello,PostQuantumKyber,TLS13KyberSupport,' +
      'X25519Kyber768,X25519MLKEM768,UseDnsHttpsSvcb,AsyncDns,OptimizationHints',
    '--ssl-version-max=tls1.2',
  ],
  proxy: { server: process.env.HTTPS_PROXY },
});
```

Playwright is at `/opt/node22/lib/node_modules/playwright`; don't run `playwright install`.

Nothing in the pipeline needs this today — `curl` reaches both source hosts and is simpler. It
matters for two cases. First, if the IDX or MetroListPRO ever starts bot-blocking `curl` the way
the consumer portals do, a real browser is the fallback, and it works: a 2026-09-03 check pulled
Redfin search CSVs and 22 detail pages this way (Zillow still refuses a real browser too, so don't
bother). Second, and more important, **a bare `ERR_CONNECTION_RESET` is not evidence that a host is
blocked by policy.** A genuine policy denial shows up in `recentRelayFailures` as a CONNECT 403;
confirm that before recording a host as unreachable. Reading resets as denials is what produced the
incorrect claim this section used to make.

## Redfin detail pages have a budget, and spending it breaks two pipeline steps

**Measured 2026-10-21.** The 202-stub behaviour noted above is not only a load condition — it is
also rate limiting, and it is **per-endpoint**. On this run an exploratory sweep opened roughly
twenty Redfin *detail* pages in quick succession. After about seven, every subsequent detail page
came back as a stub, and stayed that way for **over forty minutes** despite 15-second spacing.
Throughout that window the CSV endpoint kept answering perfectly: `api/gis-csv` returned all seven
regions, 363 rows, while `/CA/<city>/<slug>/home/<id>` returned nothing at all.

Two pipeline steps read detail pages and both silently lost their evidence as a result:

- `foreign-verify.py` reported `Redfin returned no body — cannot confirm` for both foreign-MLS
  listings, so neither card could claim its second source.
- `redfin-csv.py` enumerated fine and then could not read a single pool field — 16 of 16.

So: **do the exploratory browsing after the pipeline, not before.** A detail page spent on a
curiosity is one `foreign-verify.py` cannot spend on evidence. If a run needs both, run
`scrape.js`, `verify.py` and `foreign-verify.py` first, and treat Redfin detail reads as a scarce
budget for the rest of the session. Enumeration — `gis-csv`, the bare `/zipcode/<zip>` pages — is
not affected and can be run freely.

Spacing does not buy much back. The useful signal is the stub itself: once detail pages start
returning no body, stop issuing them and come back later, because continued polling appears to
hold the window open rather than drain it.

## If the usable hosts start blocking

Fall back to paths that don't fight bot defences:

1. A Zillow/Redfin **saved search with email alerts** into the connected Gmail — carries current
   status, price cuts and image URLs, needs no network change.
2. An agent-run **MLS/IDX client portal** with email alerts.
3. A licensed **data API key** (SimplyRETS, Bridge Interactive, RapidAPI).

## A second MetroList enumeration that needs no `User-Agent` spoofing — added 2026-10-24

Every host in the table above wants a browser `User-Agent`. `www.cherielliott.com` — an **iHouse
IDX over MetroList** — does not. It answers plain `curl` with the default agent string, which makes
it the cheapest way to re-enumerate the board independently of the Coldwell Banker feed.

```bash
curl -sS "https://www.cherielliott.com/homes-for-sale-in-el-dorado-county?display_page=N&lpp=20"
```

- Server-rendered, **20 listings per page, ~36 pages** for the county. `lpp` is accepted but
  ignored — it is pinned at 20.
- Each listing block carries structured attributes: `data-mlsno`, `data-status`, `data-price`,
  plus `listing-beds` / `listing-baths` / `listing-sqft` / `listing-lot-size` /
  `listing-address-*`, the photo count in `listing-photos-qty`, and a photo URL.
- Per-city pages exist for two of the three towns and make a good completeness check — the county
  sweep returned the same totals on 2026-10-24: `/homes-for-sale-in-shingle-springs-ca` (27),
  `/homes-for-sale-in-rescue-ca` (22). **Placerville has no city page** (153 via the county sweep).
- The saved search behind it is **single-family only** (711/711 on 2026-10-24), so it will never
  show land. That is usually what you want here, but it is not a general inventory.

Two cautions, both already familiar:

- **`listing-baths` is the rounded IDX bath count**, so it has the same "2 full + 1 half reads as
  3" trap the `_comment` in `listings.json` warns about. Use it to shortlist, never to qualify.
- **Listing detail pages on this host are behind a human-verification challenge**
  (`/-/ChallengeRequest/im_not_a_bot/`). Don't try to get past it. Everything needed for a
  shortlist is on the result pages, and the pool comes from photos instead (below).

### Pool from photos, when a feed has no remarks field

The iHouse result pages carry no remarks, so pool status came from the listing photos:

```
https://idx-photos-ihouseprd.b-cdn.net/CA-SACMLS/<mls>/org/<NNN>.jpg?width=500
```

`NNN` is zero-padded from `000`; the count is in the `listing-photos-qty` title attribute (36–96
per listing here). Downloading ~20 photos spread across the full range and tiling them into one
contact sheet per candidate makes a pool unmistakable at a glance, and is far cheaper than opening
20 images. This caught the **spa-only** case the README warns about — 6310 Butterfield Way has a
hot tub under a pergola and community tennis courts, and no pool.

Note the system Pillow is broken on this host (`cannot import name '_imaging'`). Install to a
local target instead of fighting it:

```bash
python3 -m pip install --quiet --target ./pylib --upgrade Pillow
PYTHONPATH=./pylib python3 sheet.py
```

### Hosts re-measured 2026-10-24

| Host | Result |
|---|---|
| `www.cherielliott.com` | **200 on plain `curl`** — result pages; detail pages challenged |
| `idx-photos-ihouseprd.b-cdn.net` | **200** — listing photos, no UA needed |
| `www.metrolistpro.com` | **200** (unchanged) |
| `www.mlslistings.com` | **200** via `WebFetch` — settles disputed records |
| `www.compass.com` | **202 empty to `curl`**, but **`WebFetch` renders it** — address, price, beds, baths, sqft, **lot acres**. URL path filters are ignored, only ~30 results render, and the Shingle Springs page returns an empty shell. Rescue and Placerville work. |
| `www.coldwellbankerhomes.com` | **200** (unchanged) — still the primary |
| `www.zillow.com`, `www.homes.com`, `www.movoto.com`, `www.landwatch.com`, `www.metrolist.com` | 403 |
| `www.trulia.com` | 403 via `WebFetch` |
| `www.realtor.com` | `WebFetch` refuses the domain outright |
| `www.redfin.com` | 405 from the proxy via `WebFetch`; use `curl` paths above |
| `www.landsearch.com` | 200 but **ignores filters** — returns a nationwide list. Useless here. |

`www.cherielliott.com` returns `curl: (35) Recv failure` / `ws_closed_mid_exchange` on roughly 1 in
30 long fetches. Transient — retry with backoff; both occurrences on 2026-10-24 succeeded on retry.
