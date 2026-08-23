# Network state

**As of 2026-08-23, outbound HTTPS is open** and this tracker reads live listing data directly. The
proxy reports `"selective": false` with an empty `recentRelayFailures`, and `https://example.com/`
returns 200. The workarounds this file used to describe (Gmail listing alerts, a paid data API,
per-domain allowlisting) are no longer needed.

Confirm at the start of a run:

```bash
curl -sS "$HTTPS_PROXY/__agentproxy/status" | python3 -m json.tool
curl -sS -o /dev/null -w "%{http_code}\n" https://www.redfin.com/
```

## What each site does

| Host | Behaviour |
|---|---|
| `www.redfin.com` | **Works.** Serves full search and detail payloads. The source this tracker uses. |
| `ssl.cdn-redfin.com` | **Works.** Listing photos hotlink fine. |
| `www.realtor.com` | Reachable, but answers `429` — rate-limited at the site. |
| `www.zillow.com` | Reachable, but answers `403` — bot-blocked at the site, not at the proxy. |

Distinguish a proxy denial from a site block by source: a gateway denial adds an entry to
`recentRelayFailures` in the proxy status; a site block does not, and returns a body.

## Redfin throttling

Redfin does not hard-block, it throttles: after a burst it answers **HTTP 202 with a zero-length
body**. That is the single most important failure mode to get right, because a 202 on a detail page
looks like a missing listing.

- A 202/empty response is **never** evidence that a listing is gone. Retry it.
- `scripts/fetch.sh` backs off 6s → 12s → 24s → 48s and reports any URL it could not get.
- Roughly 4s between requests keeps a run clean; batches of ~20 detail pages go through fine.

## If Redfin ever closes

Fallbacks in order of reliability:

1. Zillow/Redfin **saved-search email alerts** to the connected Gmail — authoritative, carries
   status, price cuts and photo URLs, and needs no network access at all. `ingest.js` accepts
   pasted portal results.
2. An agent-run **MLS/IDX client portal** with email alerts — same, plus fuller MLS data.
3. A licensed **data API key** (SimplyRETS, Bridge Interactive, a RapidAPI provider).
