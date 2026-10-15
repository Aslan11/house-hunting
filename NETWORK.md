# Network config needed for this tracker

The container that runs this tracker denies outbound HTTPS to every listing site. The denial is
at the egress gateway, not at the destination — a `CONNECT www.zillow.com:443` gets `403 Forbidden`
from the local proxy, so no packet ever reaches Zillow.

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
