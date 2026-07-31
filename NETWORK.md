# Network notes

## Current state (2026-07-31): working

Outbound HTTPS to Redfin now succeeds from the runner. `hunt.py` fetches search and detail pages
directly, and the proxy reports no relay failures.

Reachability as measured on 2026-07-31:

| Host | Result |
|---|---|
| `www.redfin.com` | **200** — search and detail pages both readable |
| `ssl.cdn-redfin.com` | **200** — listing photos load |
| `www.metrolistpro.com` | 200 |
| `www.realtor.com` | 429 (rate limited, not a policy block) |
| `www.zillow.com` | 403 (site-level bot block) |
| `www.homes.com` | 403 |

Only the first two matter — the pipeline runs entirely on Redfin.

Verify at any time:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://www.redfin.com/
curl -sS "$HTTPS_PROXY/__agentproxy/status" | python3 -m json.tool
```

- `200` → working.
- `403` **with** a new entry in `recentRelayFailures` → egress policy denial (see below).
- `403` **without** a relay-failure entry → egress is open; the site is bot-blocking.

## Bot challenges

Redfin intermittently answers **202** with a challenge body instead of the page — roughly 1 request
in 5 during a run. This is not a network failure and not a permanent block. `hunt.py` retries with
escalating backoff, and every challenged page in the 2026-07-31 run succeeded on retry.

Two things keep the challenge rate low: a realistic `User-Agent` and `Referer`, and a 2–3 second
gap between requests. Don't parallelise the fetches.

`WebFetch` still returns 405 through the proxy and isn't used by the pipeline. `curl` is the
working path.

## If egress is blocked again

The allowlist lives at **claude.ai → Settings → Capabilities → "Code execution and file creation"
→ Domain allowlist**, or on the environment itself if it was created through Claude Code on the
web with its own network policy — see <https://code.claude.com/docs/en/network-config>.

Minimum set for this pipeline:

```
www.redfin.com
ssl.cdn-redfin.com
```

Broader set, if other portals are ever wanted:

```
*.redfin.com  *.cdn-redfin.com  *.realtor.com  *.rdcpix.com
*.homes.com   *.movoto.com      *.compass.com  *.metrolistpro.com
```

Zillow is not worth allowlisting — it blocks datacenter IP ranges independently of the proxy.

Known issue: several open bugs report that "Additional allowed domains" isn't always propagated to
container egress — anthropics/claude-code
[#19087](https://github.com/anthropics/claude-code/issues/19087),
[#30112](https://github.com/anthropics/claude-code/issues/30112),
[#52982](https://github.com/anthropics/claude-code/issues/52982). If hosts are still denied after
the change, "All domains" is the reliable fallback.

## Fallbacks that need no network change

1. **`ingest.js`** — paste listings copied off a Zillow/Redfin results page; it merges them into
   `listings.json` applying the same dedupe rules.
2. **Zillow/Redfin saved search with email alerts** to the connected Gmail. The runner has Gmail
   access, so alert emails become an authoritative feed carrying status, price cuts and image URLs.
3. **A licensed data API key** (SimplyRETS, Bridge Interactive, a RapidAPI provider) in the
   environment.
