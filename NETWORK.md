# Network reality for this tracker

**Outbound HTTPS is open.** As of 2026-10-30 the agent proxy reports `"selective": false` with an
empty `recentRelayFailures`, so there is no domain allowlist to edit any more. The earlier version
of this file described a restricted policy that no longer applies.

Check the current state at any time with:

```bash
curl -sS "$HTTPS_PROXY/__agentproxy/status" | python3 -m json.tool
```

`"selective": false` means every host is permitted. If a request still fails, the block is coming
from the destination, not from the gateway — a gateway denial always leaves an entry in
`recentRelayFailures`, and a site block does not.

## What the destinations actually do

Measured 2026-10-30 from this container:

| Host | Result | Usable? |
|---|---|---|
| `coldwellbankerhomes.com` | `200`, full MetroList IDX with JSON-LD | **Yes — the primary source** |
| `mlslistings.com/property/ME<mls>` | `200` via `WebFetch` | Yes — second source by MLS number |
| `plumaslakeproperties.realgeeks.com/property/<mls>/` | `200` via `WebFetch` | Yes — second source, partial coverage |
| `redfin.com` | `302` → `ratelimited.redfin.com` | No |
| `zillow.com` | `403` (datacenter IP block) | No |
| `homes.com` | `403` | No |
| `realtor.com` | `429` | No |
| `movoto.com`, `landwatch.com` | `403` | No |
| `rubyhome.com` | `403` to `WebFetch`, indexed by search | Search snippets only |

So the constraint was never the network policy — it is that the big portals block datacenter IP
ranges. Brokerage IDX sites built on the same MLS feed don't, and they carry the same listings.

## Rate limits on the one source that works

The IDX host throttles. The 2026-10-30 run completed 313 list-page reads plus 49 detail-page reads,
then began answering `<html><head><title>Request Rejected</title>` to further `curl` requests. It
recovers on its own. Practical guidance:

- Sleep ~1s between requests and fetch detail pages only for listings that cleared the cheap filters.
- `WebFetch` keeps working when `curl` is being throttled — use it for the handful of verification
  reads at the end of a run.
- **Do not send a spoofed browser user-agent to get around a bot check.** It is both against the
  spirit of the site's terms and unnecessary: the default client reaches the city pages fine, and
  `WebFetch` covers the rest.

## If the IDX source goes away

Fall back paths, cheapest first:

1. **Zillow/Redfin saved search with email alerts** to `kvn.p.mrtn@gmail.com`. The runner has Gmail
   access, so alert emails become an authoritative feed: current listings, correct status, price
   cuts and image URLs. No network dependency at all.
2. **An agent-run MLS/IDX client portal** with email alerts — same benefits, fuller MLS data.
3. **Another brokerage IDX on MetroList.** Several are reachable; `mlslistings.com` resolves
   directly by MLS number, which makes it a good index even when its search is awkward.
4. **A licensed real-estate data API key** in the environment (SimplyRETS, Bridge Interactive, a
   RapidAPI provider).
