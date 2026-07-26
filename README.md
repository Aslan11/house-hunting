# House Hunting — El Dorado County

Automated house-hunt tracker for **Shingle Springs**, **Rescue**, and **Placerville, CA**.

## Criteria

| Requirement | Value |
|---|---|
| Bedrooms | 5+ |
| Bathrooms | 3+ |
| Pool | Required |
| Lot size | 2.5 acres minimum, 5+ preferred |
| Max price | $1,500,000 |

## Files

- **`index.html`** — the published listing page (GitHub Pages).
- **`listings.json`** — canonical data store. Every tracked property, its price history,
  and the rejected list.

## Dedupe rules for future runs

Read `listings.json` **before** reporting anything.

1. A property already in `listings` is a **duplicate** — do not re-surface it.
2. Exception: if the newly found price differs from `currentPrice`, it *is* worth
   reporting. Append the new price to `priceHistory`, update `currentPrice`, and
   call the change out on the page.
3. Anything in `rejected` stays rejected unless a price change brings it into range.
4. Update `lastSeen` on every property confirmed still active; update `lastRun`.

## Publishing

The page is served from the `gh-pages` branch at the repository root. Enable it under
**Settings → Pages → Source: `gh-pages` / `(root)`** if it isn't already on.

## Data caveat

Listing portals (Zillow, Redfin, Realtor.com, Homes.com) block automated access from the
environment this runs in, so listing details are reconstructed from search-result data
rather than read off live listing pages. Figures are directionally accurate but should be
confirmed with an agent before acting. Conflicts between sources are flagged per-property
in both `index.html` and the `notes` field of `listings.json`.
