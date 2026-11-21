# Network status for this tracker

**Status as of 2026-11-21: outbound HTTPS is open.** The blanket egress denial this file previously
documented is gone. `curl -sS "$HTTPS_PROXY/__agentproxy/status"` reports an empty
`recentRelayFailures`, and listing sites are reachable at the network level.

No network policy change is needed any more. What remains is **bot protection at the sites
themselves**, which is a different problem and is not fixable by allowlisting.

## What actually serves this container

Tested with the pre-installed Chromium via Playwright (a real browser; plain `curl` with a spoofed
user agent is both less effective and not worth doing).

| Serves normally | Bot-blocks (403 / 429 / "confirm you are human") |
|---|---|
| **metrolistpro.com** — the MLS, and the source this tracker uses | zillow.com, trulia.com |
| century21.com | redfin.com (`Are You a Robot?`) |
| compass.com | realtor.com (429) |
| bridgemls.com (homepage only; search 403s) | homes.com, movoto.com, landwatch.com |
| | point2homes.com, remax.com, coldwellbankerhomes.com |

The important consequence: **the MLS itself is reachable**, so the portals that block are no longer
needed. See the README for the MetroListPRO URL patterns and search procedure.

## Tool notes

- **`WebFetch` does not work here.** The proxy answers `405 Method Not Allowed` because WebFetch
  sends a plain-HTTP (non-CONNECT) request. This is independent of the destination — it fails on
  every URL. Use Playwright instead.
- **Playwright + Chromium are pre-installed.** `require('playwright')` works from any directory and
  `chromium.launch()` needs no options. Do not run `playwright install`.
- Spoofing a desktop user agent on `curl` may be refused by the environment's permission classifier,
  and does not get past site bot protection anyway.

## If a site starts blocking that previously worked

Prefer finding another source over trying to defeat the protection. MetroList is the authoritative
feed for El Dorado County; century21.com and compass.com are useful for cross-checking individual
facts. If MetroList itself became unavailable, the fallbacks in order are: an agent-run MLS/IDX
client portal with email alerts into the connected Gmail, a Zillow/Redfin saved search emailing the
same inbox, or a licensed data API key (SimplyRETS, Bridge Interactive).
