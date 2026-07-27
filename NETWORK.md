# Network reachability from this environment

**Status as of 2026-07-27: outbound egress is open and no policy change is needed.**
`recentRelayFailures` is empty and `selective` is `false`, so the gateway is not
filtering by host. The historical gateway-level block described in earlier versions
of this file is gone.

Verify at any time:

```bash
curl -sS "$HTTPS_PROXY/__agentproxy/status" | python3 -m json.tool
```

A gateway denial appears in `recentRelayFailures`; a *site* blocking datacenter IPs
does not, and returns an HTML body. That distinction is how to tell the two apart.

## What actually serves

| Host | Result | Use |
|---|---|---|
| `coldwellbankerhomes.com` | **200** | Primary source — full MLS-backed inventory + photos |
| `metrolistpro.com` | **200** | Verification — official MetroList MLS public search |
| `m.cbhomes.com`, `m1.cbhomes.com` | **200** | Listing photo CDN, hotlinks fine |
| `redfin.com` (HTML search pages) | **200** | Works — see `redfin.py` |
| `redfin.com/stingray/api/*` | 403 | CloudFront-blocked; payload is embedded in the HTML page instead |
| `century21.com`, `compass.com` | 200 root, empty search | Not usable |
| `zillow.com` | 403 | Site bot-blocks datacenter IPs |
| `realtor.com` | 429 | Rate-limited |
| `homes.com`, `movoto.com` | 403 | Site bot-blocks |

## Known quirks

- **Requests need a desktop browser `User-Agent`.** Without one, Coldwell Banker
  returns a short error body rather than listing HTML — hence the `> 5000 bytes`
  sanity check in `refresh.py`'s fetch helper. Treat a short body as throttling and
  retry with backoff, never as thin inventory.
- **`WebFetch` is refused for the blocked portals**, and returns `405` in some
  configurations because of how it issues the request. Use `curl`.
- **Headless Chromium cannot egress at all**, even with `proxy:` set and
  `--ignore-certificate-errors` — every request returns `ERR_CONNECTION_RESET` while
  `curl` to the same URL succeeds. This only affects local screenshot checks of
  `index.html`; photos are fine in a real browser. Verify a photo URL with
  `curl -o /dev/null -w '%{http_code} %{content_type}'` instead, and read a
  screenshot full of fallback tiles as a sandbox artifact, not a broken page.
- Expect intermittent `202` responses with an empty body from Redfin; that is a soft
  bot-block that clears on retry.

## If the sources go dark

1. Retest the portals — bot-blocking is not permanent.
2. Another MetroList IDX republisher: most local brokerage sites carry the same feed
   and the smaller ones rarely bot-block. Look for a `pid_`-style detail URL with a
   JSON-LD block; `refresh.py`'s parser will port over with small changes.
3. Zillow/Redfin saved-search **email alerts** into the connected Gmail — needs no
   network access at all and carries status, price cuts and photo URLs. `ingest.js`
   accepts pasted results.
4. A licensed data API key (SimplyRETS, Bridge Interactive, RapidAPI).
