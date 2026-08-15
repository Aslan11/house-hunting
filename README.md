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

Two hosts do serve real, current El Dorado County data and are what the pipeline runs on:

1. **`www.coldwellbankerhomes.com`** — an IDX site carrying the **MetroList** feed. City pages embed
   every active listing as JSON-LD (`ItemList` → `RealEstateListing`), and detail pages carry the
   full MLS field table as `LocationFeatureSpecification` pairs: `Pool`, `Pool Description`,
   `Lot Size (Acres)`, `Full Bathrooms`, `Half Bathrooms`, `Status`, `Source`.
2. **`www.metrolistpro.com`** — the **official MetroList MLS** search site, used for verification.
   Only the MLS number in the URL matters, so any record resolves directly:
   `https://www.metrolistpro.com/homes/2/6/x/<MLS>`

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

Read `listings.json` **before** reporting anything.

1. A property already in `listings` is a duplicate — don't re-surface it. Set `isNew: false`.
2. Exception: a price different from `currentPrice` *is* worth reporting. Append to `priceHistory`
   and update `currentPrice`; the card renders the delta automatically.
3. Sold or withdrawn properties move to `dropped` and off the board — the page shows them in
   "Removed this run" so a stale copy resurfacing later isn't mistaken for a new find.
4. Anything in `rejected` stays rejected unless a price change or criteria change brings it back.
   When the criteria change, re-read the stored reasons: several were written against the old 5+
   bedroom rule and had to be corrected.
5. Update `lastSeen` on confirmed-active properties and `lastRun` on every run.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`build.js`** — renders `index.html` from `listings.json`. No dependencies: `node build.js`.
- **`ingest.js`** — merges listings pasted from a portal results page, applying the dedupe rules.
  Kept as a manual fallback; the scrape path above supersedes it.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.

## Publishing

`index.html` is committed to the `gh-pages` branch at the repo root. Enable under
**Settings → Pages → Source: `gh-pages` / `(root)`**.
