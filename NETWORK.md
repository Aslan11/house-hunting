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
| `www.zillow.com`, `www.homes.com`, `www.movoto.com`, `www.remax.com`, `www.har.com` | 403 | No |
| `www.realtor.com` | 429 | No |
| `www.redfin.com/stingray/*` | 403 (CloudFront) | No |
| `www.century21.com` | 200 but client-rendered shell, no data in HTML | No |

Both usable hosts require a browser `User-Agent`. The default agent string is blocked.

The Redfin row was corrected on **2026-08-23**. The "decoy page for another state" was real but
self-inflicted: `/city/<id>/…` resolves by numeric id, and a guessed id serves a complete,
valid-looking page for a different city (17151 is San Francisco, not Shingle Springs). HTTP 200 on a
wrong id looks exactly like success. `/zipcode/<zip>` has no such failure mode and returns the full
GIS search payload — good enough to enumerate as a cross-check, though the board still comes from
the IDX feed. Either way, **assert the expected city appears in the returned HTML** before trusting
a page.

Redfin also answers **202 with a stub body** under load rather than 429. A short body is retryable;
back off and try again, and never read a 202 as a missing listing.

## Headless browser

Chromium in this container has **no outbound network at all** — even `https://example.com` fails
with `ERR_CONNECTION_RESET`, with or without `--proxy-server`. Use it for layout checks only; verify
remote URLs with `curl`, which honours `HTTPS_PROXY`.

## If the usable hosts start blocking

Fall back to paths that don't fight bot defences:

1. A Zillow/Redfin **saved search with email alerts** into the connected Gmail — carries current
   status, price cuts and image URLs, needs no network change.
2. An agent-run **MLS/IDX client portal** with email alerts.
3. A licensed **data API key** (SimplyRETS, Bridge Interactive, RapidAPI).
