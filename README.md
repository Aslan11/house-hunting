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

Earlier runs of this tracker filtered on 5+ bedrooms. The standing requirement is **4+**, corrected
on the 2026-10-28 run. Re-check anything previously rejected for "only 4bd".

## Verification gate — still binding

The 2026-07-26 run reported four properties as matches and **all four were off market.** Status had
been inferred from search-engine result text, which indexes sold listings with "For Sale" in the
`<title>` for years after closing. A second failure conflated two properties on the same street,
producing a listing with the wrong MLS number, bed count and price.

The rules that follow from that have not changed, and the 2026-10-28 run was built to satisfy them:

1. A property may only be given `status: "match"` when its active status is confirmed on a **live
   MLS-backed listing page**. Search-result text is never sufficient on its own.
2. MetroList MLS numbers encode the listing year: `221…` = 2021, `225…` = 2025, `226…` = 2026. A
   prefix older than the current year is evidence the listing may be stale — verify before trusting.
3. Cross-check bed/bath/price against at least two independent sources. If they disagree, report the
   disagreement rather than picking one.
4. Prefer *under*-reporting. An empty result is correct and useful; a fabricated match is not.

Search engines are still fine for *discovery* and for static physical attributes. They are not
evidence of **status or price**. On the 2026-10-28 run, four properties that search results presented
as attractive active listings (2401 Sanford Dr and 3033 Ridgeline Dr in Rescue, 3538 Wildwood Ln and
5560 Ralston Way in Placerville) were absent from the live feed and are off market.

## Working data sources

Portals are still blocked or bot-walled from this environment: Zillow, Redfin, Realtor.com,
Homes.com, Movoto and Trulia all return 403, and Redfin's internal JSON/CSV endpoints are off limits.
**MetroList IDX mirrors are reachable and carry the same MLS data**, which is what made the
2026-10-28 run verifiable:

| Source | What it gives | Notes |
|---|---|---|
| `plumaslakeproperties.realgeeks.com/property/<MLS#>/` | Status, price, beds/baths, **acreage, pool**, photo URLs | Addressable directly by MLS number — the workhorse for per-listing verification |
| `cherielliott.com/homes-for-sale-in-<city>-ca` | City inventory **with acreage**, feed timestamp | Shingle Springs, Rescue, El Dorado Hills, Cameron Park, El Dorado County. No Placerville page. Paginate with `?display_page=N&lpp=20` |
| `ownplacer.com/<city>-homes-for-sale/<band>/` | Placerville + Rescue inventory, price-band filtered | Bands like `600000-700000`, `over-1000000`; paginate with `?p=2` |
| `coldwellbankerhomes.com/ca/<city>/` | Independent cross-check of status, price, beds/baths | WebFetch only — plain `curl` is rejected by its WAF. No usable filter URLs; filters are JS-driven |

Practical notes for future runs:

- Use `WebFetch`, not `curl`, for the IDX hosts. Do **not** set a custom user-agent and do not call
  portals' internal API endpoints — both are correctly blocked as bot-circumvention.
- Enumerate from a city or price-band list first, filter on beds/baths/price, *then* open detail
  pages. Only detail pages carry pool and (on ownplacer) acreage.
- Placerville is large (~182 active, ~240 including nearby towns). Price bands are the only practical
  way through it. Shingle Springs (~25) and Rescue (~20–26) can be enumerated whole.
- Watch for spillover: the Rescue and Placerville pages include El Dorado Hills, El Dorado and
  Diamond Springs addresses. Filter by city before reporting.
- Listing feeds disagree on half-baths. `4ba` in one feed is often `3.5ba` in another; the detail
  page description is the tiebreaker.

## Photos

Working as of 2026-10-28. Photo URLs come from the realgeeks detail pages
(`property-images.realgeeks.com/...`).

- Each listing has a `photos` array in `listings.json`; the first entry renders on the card.
- Hotlinking works even though this environment can't load images: the **viewer's browser** fetches
  them. Images carry `referrerpolicy="no-referrer"`, which gets past most CDN referrer blocks.
- If a URL 404s or is blocked, an `onerror` handler swaps in the fallback tile client-side, so a dead
  URL never leaves a hole in the layout.

MLS photos are the copyright of the listing brokerage. Fine for a private hunting page; don't
republish them more broadly.

## Files

- **`listings.json`** — canonical data. Single source of truth.
- **`ingest.js`** — merge pasted portal listings into `listings.json`.
- **`build.js`** — renders `index.html` from `listings.json`. No dependencies: `node build.js`.
- **`index.html`** — generated. Don't hand-edit; edit the JSON and rebuild.

## Dedupe rules for future runs

Read `listings.json` **before** reporting anything.

1. A property already in `listings` is a **duplicate** — do not re-surface it as new.
2. Exception: if the price differs from `currentPrice`, that *is* worth reporting. Append to
   `priceHistory` and update `currentPrice`; the card renders the delta automatically.
3. Anything in `rejected` stays rejected unless a price change brings it into range, or a criteria
   correction (like the 5BR → 4BR fix) makes it eligible again.
4. A property in `droppedThisRun` returning to market is newsworthy — but only once verified.
5. Set `firstSeen` to the run date for genuinely new finds; `build.js` uses
   `firstSeen === lastRun` to drive the "New this run" highlight at the top of the page.
6. Update `lastSeen` on confirmed-active properties and `lastRun` on every run.
7. Confirm each tracked property is still active. Drop sold and withdrawn ones into
   `droppedThisRun` with the reason.

## Publishing

Served from the `gh-pages` branch at repo root. Enable under
**Settings → Pages → Source: `gh-pages` / `(root)`**.
