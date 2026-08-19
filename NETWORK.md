# Network reachability notes

**Status as of 2026-08-19: no allowlist change is needed.** General outbound HTTPS works. An earlier
version of this file said every listing site was blocked at the egress gateway; that is no longer
true, and the tracker now runs end to end without any configuration change.

What is blocked is **bot protection at the destinations**, not the gateway. That distinction matters:
you can't fix it with an allowlist, and you don't need to.

Verify proxy state at any time with:

```bash
curl -sS "$HTTPS_PROXY/__agentproxy/status" | python3 -m json.tool
```

## Reachability, measured

| Host | Result | Notes |
|---|---|---|
| `coldwellbankerhomes.com` | **200** | Primary source. Server-rendered, full MLS fields. |
| `homefinder.com` | **200** | Cross-check source. `__NEXT_DATA__` JSON. |
| `m.cbhomes.com` (photo CDN) | **200** | Hotlinks fine; no referrer or auth required. |
| `century21.com` | 200 (stub) | Client-rendered; ~4 KB shell, no listing data. |
| `bhhsdrysdale.com` | 200 | No usable search endpoint found. |
| `zillow.com`, `trulia.com`, `har.com`, `metrolist.com`, `landwatch.com`, `point2homes.com`, `movoto.com`, `rocket.com`, `weichert.com` | 403 | Bot-blocked at the destination. |
| `redfin.com` | 302 / 403 | Stingray API returns a CloudFront "Request blocked" page. |
| `realtor.com` | 429 | Rate-limited; `WebFetch` also refuses it. |
| `compass.com`, `sothebysrealty.com` | 202 | Challenge page, no content. |

`WebFetch` is subject to the same destination blocks — it returned 403 on homes.com and 405 on
Redfin. Use `curl` with a desktop User-Agent against the IDX sites instead.

## One genuine environment limitation

Headless Chromium inside this container **cannot load images through the local agent proxy** —
requests die with `net::ERR_CONNECTION_RESET`, while `curl` fetches the identical URLs at 200.
So screenshots taken here show empty photo frames.

This is an artifact of the container, not a problem with the page. The photo URLs are valid and
public; a real viewer's browser loads them normally. Every `<img>` carries an `onerror` fallback, so
even a genuinely dead URL degrades to a "view gallery" tile rather than a hole in the layout.

Don't chase this, and don't strip the photos because they look broken from in here.

## If the primary source breaks

In rough order of effort:

1. Find another broker IDX site that server-renders MetroList results (the pattern that works:
   national brand, non-React, listing data in JSON-LD or `__NEXT_DATA__`).
2. Set up a Zillow/Redfin saved search emailing `kvn.p.mrtn@gmail.com` — this runner has Gmail
   access, so alert mail becomes an authoritative feed with status, price cuts and image URLs.
3. Ask the buyer's agent for an MLS/IDX client portal with email alerts — fullest MLS data.
4. Add a real-estate data API key (SimplyRETS, Bridge Interactive) to the environment.
5. `ingest.js` accepts listings pasted straight off a portal results page as a manual fallback.
