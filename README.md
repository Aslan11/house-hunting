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

## Status: working

As of the 2026-10-26 run the pipeline verifies against live MLS data and reports **6 matches**.
Outbound HTTPS opened up on that run, which changed what's possible — see *Sources that work* below.

Earlier history is worth keeping in mind: the first run (2026-07-26) reported four properties as
matches and **all four were off market**. The cause was inferring listing status from search-engine
result text. Search engines index listing pages that keep "For Sale" in the `<title>` for years
after the sale closes, so stale listings read as active. A second failure compounded it — search
snippets conflated two different properties on the same street, producing a listing with the wrong
MLS number, bed count and price.

## Verification gate — still binding

1. A property may only be given `status: "match"` when its bed count, bath count, lot acreage,
   Pool-or-Spa field **and** Active status have each been read off a live listing page or MLS
   record. Search-result text is **not** sufficient for any of them.
2. Search is for **discovery only** — finding candidate addresses. Every candidate is then
   confirmed against a live record before it can appear as a match.
3. MetroList MLS numbers encode the listing year: `221…` = 2021, `223…` = 2023, `225…` = 2025,
   `226…` = 2026. A prefix older than the current year is strong evidence the listing is stale.
4. Where two sources disagree, report the disagreement rather than picking one. Two live examples
   from the 2026-10-26 run are recorded in `listings.json`:
   - 3538 Wildwood Ln — a Trulia snapshot said $949,000, the live MLS record said $829,000.
   - 2520 Bedford Ave — cached pages quoted $1,469,000 and $1,499,888 from *prior* listings; the
     current listing is $1,275,000.
5. Prefer *under*-reporting. An empty result is correct and useful; a fabricated match is not.

## Sources that work

Checked 2026-10-26. The portals still bot-block — Zillow 403s, Redfin serves
"Are You a Robot?", Realtor.com, Homes.com, Movoto, LandWatch and Estately all 403 `WebFetch`.
What works is IDX sites built on the MLS feed, which don't bot-block:

| Source | Role |
|---|---|
| `cherielliott.com` | **Primary.** MetroList IDX (Sierra Interactive). Carries the full Pool-or-Spa field, lot acreage and status. Feed timestamp is printed on the page — it read `2026-10-26 06:30:04` on this run. City-exact result sets: Shingle Springs 26 active, Rescue 21 active. Does **not** cover Placerville. |
| `mlslistings.com` | Secondary MetroList verification. Detail URLs are constructible: `/property/ME{mls}`. |
| `coldwellbankerhomes.com` | Placerville inventory sweep. 239 results, 10 pages, `/ca/placerville/p_N/`. Gives MLS numbers and Active/Pending/Contingent status, but **not** acreage or pool. |
| `compass.com` | City lists that include acreage. Sole source carrying 2520 Bedford Ave, which is listed on Bay East AOR rather than MetroList. |

Useful URL patterns:

```
# Sierra Interactive IDX — city search and listing detail
https://www.cherielliott.com/homes-for-sale-in-{city}-ca?display_page=N&lpp=20
https://www.cherielliott.com/-/listing/CA-SACMLS/{mls}/{Address-Slug-City-CA-ZIP}

# MLSListings MetroList record
https://www.mlslistings.com/property/ME{mls}

# Coldwell Banker city pages (pagination only; query-string filters are ignored)
https://www.coldwellbankerhomes.com/ca/{city}/p_{N}/

# MLS photos (CA-SACMLS listings only)
https://idx-photos-ihouseprd.b-cdn.net/CA-SACMLS/{mls}/org/{000..NNN}.jpg?width=1500
```

### Gotchas worth not rediscovering

- `lpp=100` does not raise the page size on the Sierra site; it stays at 20. Use `display_page`.
- Coldwell Banker ignores query-string filters (`?beds=4`) and 404s on path filters
  (`/beds-4/`, `/homes-with-pool/`). Only `p_N` pagination works, so its pages must be swept.
- CB pages run ~200k characters, past the 100k `WebFetch` read window. Each needs two reads —
  one at offset 0, one at offset 100000 — or listings in the back half are silently missed.
- Do **not** spoof a browser User-Agent to get past a bot check. Plain `curl` gets 403/429 from
  these hosts; `WebFetch` is the sanctioned path and works on the IDX sites.
- A listing on a non-MetroList MLS (Bay East AOR, numbers like `41150059`) will not appear in any
  El Dorado IDX feed. 2520 Bedford Ave — 16.74 acres, the only 5-bedroom match — is invisible to
  the primary source and would have been missed without Compass.
- Photos only exist on the CDN for listings carried in the CA-SACMLS feed. 3538 Wildwood Ln
  resolves on MLSListings but 404s on the photo CDN, so its card falls back to the gallery tile.

## What the market looks like

**Pool is the binding constraint, not the budget.** 4-bedroom homes on 5+ acres under $1.5M are
common in all three towns; almost none have a pool. Of 56 properties checked and rejected this run,
the overwhelming majority failed on pool alone while clearing acreage, beds, baths and price. The
near-miss list in `listings.json` is deliberately kept so the judgement calls stay visible — e.g.
1234 Rising Hill W Rd has the pool and the acreage and misses by half a bathroom.

## Photos

- Each listing has a `photos` array in `listings.json`. Put any image URL in it and the card
  renders it on the next build.
- Hotlinking works: the **viewer's browser** fetches the images. They carry
  `referrerpolicy="no-referrer"`, which gets past most CDN referrer blocks.
- If a photo URL 404s or is blocked, an `onerror` handler swaps in the fallback tile client-side,
  so a dead URL never leaves a hole in the layout.
- With no photo, the card shows a "View photos on <site>" tile linking to `gallery` (or `url`).

MLS photos are the copyright of the listing brokerage. Fine for a private hunting page; don't
republish them more broadly.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`build.js`** — renders `index.html` from `listings.json`. No dependencies: `node build.js`.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.
- **`ingest.js`** — merges listings pasted from a Zillow/Redfin results page, applying the dedupe
  rules below. Still useful as a manual fast path.
- **`NETWORK.md`** — egress notes and how to widen the allowlist.

## Dedupe rules for future runs

Read `listings.json` **before** reporting anything.

1. A property already in `listings` is a **duplicate** — do not re-surface it as a find.
2. Exception: if the price differs from `currentPrice`, that *is* worth reporting. Append to
   `priceHistory`, update `currentPrice`, and the card renders the delta automatically.
3. Anything in `rejected` stays rejected unless a price change brings it into range.
4. A property in `dropped` returning to market is newsworthy — but only once verified per the gate.
5. Clear the previous run's `isNew` flags **before** adding the current run's finds. `isNew` drives
   the "New this run" band at the top of the page and the NEW ribbons on cards.
6. Re-check every tracked match against the live feed each run; move anything sold or withdrawn
   into `dropped` so the list doesn't accumulate stale entries.
7. Update `lastRun`, and `dataQuality.mlsFeedTimestamp` from the IDX feed's own timestamp.

## Publishing

Served from the `gh-pages` branch at repo root. Enable under
**Settings → Pages → Source: `gh-pages` / `(root)`**.

```bash
node build.js
git add -A && git commit -m "..."            # work branch
git push -u origin <work-branch>
git checkout gh-pages && git checkout <work-branch> -- index.html listings.json
git commit -m "Publish …" && git push -u origin gh-pages
```
