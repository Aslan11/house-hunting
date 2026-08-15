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
| `www.redfin.com` | 200 but **serves a decoy page for an unrelated state** | No — actively misleading |
| `www.zillow.com`, `www.homes.com`, `www.movoto.com`, `www.remax.com`, `www.har.com` | 403 | No |
| `www.realtor.com` | 429 | No |
| `www.redfin.com/stingray/*` | 403 (CloudFront) | No |
| `www.century21.com` | 200 but client-rendered shell, no data in HTML | No |

Both usable hosts require a browser `User-Agent`. The default agent string is blocked.

The Redfin result is the one to watch out for: it returns HTTP 200 with a **complete, valid-looking
page for a different city and state**. Any scraper that trusts the status code will silently ingest
listings from the wrong place. Always assert the city appears in the returned HTML.

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
