# Network config for this tracker

> **Status as of 2026-08-03: egress works and no config change is needed.** General HTTPS is open
> (`example.com` → 200) and `www.redfin.com` is reachable, which is all the tracker needs — see the
> data-source section in `README.md`. Measured this run:
>
> | Host | Result |
> |---|---|
> | `www.redfin.com/stingray/api/gis-csv` | **200** — the live feed the tracker runs on |
> | `www.redfin.com` listing detail pages | **200**, but throttles to `202` + empty body after ~6 rapid fetches; ~12s spacing works |
> | `ssl.cdn-redfin.com` photos | **200** |
> | `www.redfin.com/stingray/do/location-autocomplete` | 403 (CloudFront) — use map polygons instead of region IDs |
> | `www.zillow.com` | 403 · `www.realtor.com` 429 · `www.homes.com` 403 |
>
> Redfin alone covers the need. The rest of this file is kept for the day it stops working.

The notes below describe the earlier state, when the container denied outbound HTTPS to every
listing site. The denial was at the egress gateway, not the destination — a
`CONNECT www.zillow.com:443` got `403 Forbidden` from the local proxy, so no packet reached Zillow.

Verify at any time with:

```bash
curl -sS "$HTTPS_PROXY/__agentproxy/status" | python3 -m json.tool
```

`recentRelayFailures` records each denial as
`"gateway answered 403 to CONNECT (policy denial or upstream failure)"`.

## Where to change it

**claude.ai → profile icon (bottom left) → Settings → Capabilities →
"Code execution and file creation" → Domain allowlist**

Either set it to **All domains**, or keep it restricted and add the hosts below under
**Additional allowed domains**.

If the environment was created through Claude Code on the web with its own network policy, that
policy governs instead, and it's edited on the environment itself. See
<https://code.claude.com/docs/en/claude-code-on-the-web> and
<https://code.claude.com/docs/en/network-config>.

## Minimal set — test viability first

Start with Redfin alone. It's the most likely to actually work: it serves a structured CSV of
search results, and it bot-blocks less aggressively than Zillow.

```
www.redfin.com
ssl.cdn-redfin.com
```

If that works, a filtered search can be pulled directly as CSV — the cleanest possible input for
`ingest.js`, with no HTML parsing.

## Full set — listing data plus photos

The CDN hosts matter: without them, pages load but every photo is broken.

```
# Zillow (+ Trulia, same company)
www.zillow.com
zillow.com
photos.zillowstatic.com
www.trulia.com

# Redfin
www.redfin.com
ssl.cdn-redfin.com

# Realtor.com
www.realtor.com
api.realtor.com
ap.rdcpix.com

# Others carrying El Dorado County inventory
www.homes.com
images.homes.com
www.movoto.com
www.compass.com

# MetroList — the actual MLS for El Dorado County
www.metrolistpro.com
www.metrolist.com
```

If the field accepts wildcards, this is equivalent and more robust:

```
*.zillow.com  *.zillowstatic.com  *.redfin.com  *.cdn-redfin.com
*.realtor.com  *.rdcpix.com  *.homes.com  *.movoto.com
*.compass.com  *.trulia.com  *.metrolistpro.com  *.metrolist.com
```

## Known issues to expect

1. **The setting may not take effect.** Several open bugs report that "Additional allowed domains"
   is not propagated to container egress — anthropics/claude-code
   [#19087](https://github.com/anthropics/claude-code/issues/19087),
   [#30112](https://github.com/anthropics/claude-code/issues/30112),
   [#52982](https://github.com/anthropics/claude-code/issues/52982). If the hosts are still denied
   after the change, "All domains" is the reliable fallback.
2. **Allowlisting is necessary but may not be sufficient.** Zillow and Redfin block datacenter IP
   ranges, which is what this container runs on. A second 403 may appear — that one genuinely from
   the site. Distinguish them by source: a gateway denial shows up in `recentRelayFailures`, a site
   block does not and returns an HTML body.
3. **`WebFetch` is blocked too**, independently of `curl` (`example.com` returns 403). It's likely
   governed by the same allowlist, so it may start working after the change — worth retesting.

## Verifying after the change

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://www.redfin.com/
```

- `200` → egress open and the site is serving. Working.
- `403` **with** a new entry in `recentRelayFailures` → still an egress policy denial.
- `403` **without** a new relay-failure entry → egress is open; the site is bot-blocking.

## If the sites block anyway

Fall back to the paths that don't fight bot defenses: Zillow/Redfin saved-search **email alerts**
into the connected Gmail (works today, needs no network change, and carries photo URLs), or a
licensed data API key (SimplyRETS, Bridge Interactive, RapidAPI).
