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

> The bedroom minimum was 5+ through the 2026-07-26 run and was relaxed to 4+ for 2026-09-19.
> `listings.json` → `criteria` is the source of truth; the page renders its chips from it.

## Current state — 2026-09-19

**5 verified matches, all new.** Live listing pages are reachable from this environment now, so the
verification gate below is satisfied for the first time.

## Data pipeline

Redfin serves server-rendered HTML that this environment can read. Everything comes from two kinds
of page, both fetched with a normal browser User-Agent:

1. **Filtered search** — `https://www.redfin.com/zipcode/<zip>/filter/property-type=house,min-beds=4,min-baths=3,max-price=1.5M[,min-lot-size=2.5-acre]`

   Each result is embedded as a `<script type="application/ld+json">` block carrying address, city,
   zip, beds, sq ft and price. The LD block count matches the on-page homecard count exactly, so
   parsing the LD is complete — nothing is silently dropped.

   **Two traps.** The page also embeds *nearby* homes outside the target zip, so filter on
   `addressLocality` ∈ {Shingle Springs, Rescue, Placerville}. And the lot-size filter hides any
   listing whose acreage Redfin doesn't have, so run the sweep **without** it and check acreage from
   the detail pages instead.

2. **Detail page** — `https://www.redfin.com/CA/<City>/<Address>-<zip>/home/<id>`

   - `<meta name="description">` opens with the literal status: `For Sale:`, `Sold`, `Pending`.
     **This is the status signal.** Anything else is a guess.
   - `latestListingInfo` carries `beds`, `baths`, `totalSqFt`, `lotSqFt` (÷ 43560 for acres).
   - Pool: the `Pool Information` amenity group. `"Has Private Pool": "Yes"` plus a populated
     `Pool Features` list means a real pool. The two independent signals — the amenity group title
     (`Pool Features` vs `Has Private Pool`) and the `hasPrivatePool` boolean — agreed on all 19
     properties checked, so either can be used to cross-check the other.
   - Price history is in the `BasicTable__col` event rows: date, event, price. This is where a
     price cut is detected, and it beats any remembered figure.
   - Photos: `<meta property="og:image">` gives a working `ssl.cdn-redfin.com` URL.

**Cross-check source:** `coldwellbankerhomes.com/ca/<city>/` serves MetroList IDX data including
`"MLSNumber"`, `"IsActive"`, and a `SocialDescription` string with beds/baths/price. Three of the
five matches were re-confirmed there at identical price and bed/bath counts. Its city pages don't
paginate via an obvious URL, so coverage is page-one only — treat it as corroboration, not a sweep.

**Rate limiting is real.** Redfin returns HTTP 202 with a short or empty body after roughly 20–30
rapid requests. It is not a block: sleep 25–40s between detail fetches and it clears. Cache every
fetched page to disk so a retry never re-fetches what already succeeded.

### Reachability, as of 2026-09-19

| Host | Status |
|---|---|
| `www.redfin.com` | ✅ 200 — full HTML, JSON-LD, detail pages |
| `ssl.cdn-redfin.com` | ✅ 200 — listing photos |
| `www.coldwellbankerhomes.com` | ✅ 200 — MetroList IDX |
| `www.century21.com`, `www.compass.com` | ✅ 200 |
| `www.redfin.com/stingray/...` (JSON APIs) | ❌ 403 CloudFront — HTML pages only |
| `www.zillow.com`, `www.trulia.com`, `www.homes.com`, `www.movoto.com` | ❌ 403 |
| `www.realtor.com` | ❌ 429 |

Images 404 or blocked at the CDN don't matter to the page: the viewer's browser fetches them, an
`onerror` handler swaps in a gallery tile, and `referrerpolicy="no-referrer"` gets past most CDN
referrer checks. Note that rendering this page *inside this container* shows
`ERR_CERT_AUTHORITY_INVALID` for those images — that is the local egress proxy's CA, not a broken
URL. Verify photo URLs with `curl` instead, or copy them locally before screenshotting.

## ⚠️ Verification gate — still binding

The 2026-07-26 run reported four properties as matches. **All four were off market**, because
listing status was inferred from search-engine result text, and search engines index sold listings
with "For Sale" in the `<title>` for years after the sale closes.

**The rules that follow:**

1. A property may only be given `status: "match"` when its active status is confirmed against a
   live listing page or an authoritative feed. Search-result text is **not** sufficient.
   A web-search snippet gave a stale $949,000 for 3538 Wildwood Ln on this very run; the live page
   showed $889,000 after a 16 Sep price cut. The live page wins, every time.
2. MetroList MLS numbers encode the listing year: `221…` = 2021, `223…` = 2023, `225…` = 2025,
   `226…` = 2026. A prefix older than the current year is strong evidence the listing is stale.
   All five current matches carry `226…` prefixes.
3. Cross-check bed/bath/price against a second source where one is reachable. If they disagree,
   report the disagreement rather than picking one.
4. Prefer *under*-reporting. An empty result is correct and useful; a fabricated match is not.

## Dedupe rules for future runs

Read `listings.json` **before** reporting anything.

1. A property already in `listings` is a **duplicate** — do not re-surface it. Clear its `isNew`
   flag so it moves out of the "New this run" band into "Still on the list".
2. Exception: if the price differs from `currentPrice`, that *is* worth reporting. Append to
   `priceHistory`, update `currentPrice`, and the card and the price-change table render the delta
   automatically.
3. Anything in `rejected` or `droppedThisRun` stays out unless a price change or a genuine relist
   brings it back into range.
4. A dropped property returning to market is newsworthy — but only once verified per the gate.
5. Update `lastSeen` on confirmed-active properties, `lastRun` on every run, and append to `runLog`.
6. Drop anything no longer in active inventory: move it to `droppedThisRun` with the reason. The
   decisive test is absence from the full enumerated active set, not a single failed URL fetch —
   Redfin property IDs in old records go stale and a 404 proves nothing.

## Files

- **`listings.json`** — canonical data. Single source of truth.
  - `listings[]` — tracked properties. `status`, `isNew`, `priceHistory` drive the page layout.
  - `nearMisses` — active, right size and land, no pool. Context, not candidates.
  - `droppedThisRun` / `rejected` — memory, so nothing is re-reported as a new find.
  - `dataQuality` — how this run verified what it verified. Rendered at the foot of the page.
- **`ingest.js`** — merge listings pasted from a Zillow/Redfin results page into `listings.json`.
  Still useful as a manual fast path; no longer the primary input.
- **`build.js`** — renders `index.html` from `listings.json`. No dependencies: `node build.js`.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.
- **`NETWORK.md`** — egress notes and what to do if the reachability table above regresses.

## Publishing

Served from the `gh-pages` branch at repo root. Enable under
**Settings → Pages → Source: `gh-pages` / `(root)`**.

```bash
node build.js
git add -A && git commit -m "Update listings"
git push -u origin claude/awesome-shannon-o9x448
# publish
git push origin HEAD:gh-pages
```

## Photos and copyright

MLS photos are the copyright of the listing brokerage. Hotlinking them on a private hunting page is
fine; don't republish them more broadly.
