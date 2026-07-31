# Network reality for this tracker

**Status as of 2026-07-28: the tracker works. No network configuration change is needed.**

Earlier revisions of this file described every listing site as blocked at the egress proxy.
That is no longer true — general outbound HTTPS is open, and
`curl -sS "$HTTPS_PROXY/__agentproxy/status"` reports an empty `recentRelayFailures`.
What remains is *site-side* bot blocking, which varies by host.

## What actually happens per host

Measured with a normal browser user-agent from this container:

| Host | Result | Usable? |
|---|---|---|
| `coldwellbankerhomes.com` | 200, full JSON-LD listing data | **Yes — this is the data source** |
| `m.cbhomes.com` / `m1.cbhomes.com` | 200 `image/webp` | **Yes — listing photos** |
| `metrolistpro.com` | 200, but a JS shell with no listings in the HTML | No |
| `compass.com` | 202 (challenge interstitial) | No |
| `estately.com` | 200, but listings are client-rendered | No |
| `redfin.com` homepage | 200 | — |
| `redfin.com/stingray/*` API | 403 from CloudFront | No |
| `zillow.com`, `homes.com`, `movoto.com`, `trulia.com` | 403 | No |
| `realtor.com` | 429 | No |
| `point2homes.com`, `landwatch.com`, `rocket.com` | 403 | No |

The 403s are returned by the sites' own CDNs, not by the proxy: they carry an HTML body and
leave no entry in `recentRelayFailures`. That distinction is how to tell a policy denial from
a bot block, and it matters because allowlisting a domain cannot fix a bot block.

## `WebFetch` does not work here

`WebFetch` returns **405 Method Not Allowed** from the proxy for every URL. Per
`/root/.ccr/README.md`, a 405 means the client sent a plain-HTTP request instead of a
`CONNECT` tunnel — the proxy only supports `HTTPS_PROXY`-style tunnelling. This is a
limitation of the tool, not a policy denial, and it is not something this repo can fix.

**Use `curl` instead.** It is already configured to trust the proxy CA bundle at
`/root/.ccr/ca-bundle.crt`, and it is what `scrape.js` shells out to.

## Re-testing

```bash
# Is the egress policy denying anything?
curl -sS "$HTTPS_PROXY/__agentproxy/status" | python3 -m json.tool

# Is the data source still serving?
curl -sS -o /dev/null -w "%{http_code}\n" \
  -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" \
  https://www.coldwellbankerhomes.com/ca/placerville/
```

- `200` → working; `node scrape.js` should run clean.
- `403` **without** a new `recentRelayFailures` entry → the site started bot-blocking.
- `403` **with** a new entry → an egress policy denial; report the host rather than routing around it.

A browser user-agent header is required. Without one the site's CDN responds differently.

## If the data source ever goes dark

In rough order of effort:

1. **Try another IDX brokerage site.** Coldwell Banker is not special — any brokerage
   republishing the MetroList feed with server-rendered JSON-LD would work, and `scrape.js`
   only needs its city-page URL pattern changed. Century 21, Windermere and BHHS all
   responded to a request from here and are worth probing first.
2. **Zillow/Redfin saved search with email alerts** to the account's Gmail. This runner has
   Gmail access, so alert emails become an authoritative feed carrying status, price cuts and
   image URLs. No network change required, and immune to bot blocking.
3. **A real-estate data API key** (SimplyRETS, Bridge Interactive, a RapidAPI provider).
4. **`ingest.js`** — paste a Zillow/Redfin results page in by hand. The manual fallback.

Note the coverage trap behind all of this: web search returns a small, stale, non-random
slice of inventory, because it reads *summaries of* portal pages rather than querying the
live MLS. A thin search-derived result list is never evidence that inventory is thin.
