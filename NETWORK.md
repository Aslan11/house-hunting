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

## Two ways a request fails that look like bot-blocking but aren't

Both of these cost a run on 2026-08-01 before being identified. Worth checking before
concluding a source has started blocking.

**1. `curl --compressed` trips Redfin's bot filter.** Asking for a compressed response makes
`www.redfin.com` answer `202` with an empty body. The identical request without
`--compressed` returns a full `200`. Verified back-to-back on the same URL:

```bash
U=https://www.redfin.com/CA/Rescue/3033-Ridgeline-Dr-95672/home/167348617
curl -sS -m 45 -A "$UA" -L "$U"              -o /dev/null -w "%{http_code} %{size_download}\n"  # 200 1085765
curl -sS -m 45 -A "$UA" -L --compressed "$U" -o /dev/null -w "%{http_code} %{size_download}\n"  # 202 0
```

An empty `202` is Redfin's generic "slow down" response, so this reads exactly like
throttling. It isn't — it reproduces immediately and indefinitely while `--compressed` is set.

**2. Node's built-in `fetch` cannot reach anything through this proxy.** Egress is a
CONNECT-only proxy on `$HTTPS_PROXY`; undici sends a plain-HTTP request to it and gets back a
**405 "Human Verification"** page *from the proxy itself*. The title makes it look like a
CAPTCHA wall at the destination. `curl` tunnels correctly, which is why every scraper here
shells out to it rather than using `fetch`. Confirm the source with
`curl -sS "$HTTPS_PROXY/__agentproxy/status"` — a genuine policy denial appears in
`recentRelayFailures`, and this one does not.

## Redfin coverage, measured

A full Redfin sweep on 2026-08-01 read 416 active listings across ZIPs 95682/95672/95667 —
316 of them in the three target cities, against the primary feed's 305. Comparable totals, but
**not the same set**: Redfin had no record of 1988 Cold Springs Rd (MLS 226033527) in its ZIP
search at all, despite the listing being active. Requesting `/page-2` and `/page-3` returned
the identical result set, so this is not simple pagination and cannot be paged around.

Redfin and the primary feed agreed on pool status for every property both of them saw, which is
what makes Redfin useful as a verifier. It remains unusable as a source of *what exists*.
