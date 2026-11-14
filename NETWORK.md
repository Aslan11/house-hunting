# Network status

**Resolved as of 2026-11-14 — outbound egress is open. No allowlist change is needed.**

This file previously documented a proxy allowlist that denied every listing site. That is no longer
the case. Verify at any time with:

```bash
curl -sS "$HTTPS_PROXY/__agentproxy/status" | python3 -m json.tool
```

Current state: `"selective": false`, `"recentRelayFailures": []`, and `https://example.com/`
returns `200`. Every `CONNECT` is permitted.

## What still fails, and why it is not a network problem

Zillow, Redfin, Realtor.com, Homes.com and others return `403` / `429`. These are **site-level bot
blocks against this container's datacenter IP**, not gateway denials — they produce an HTML
challenge body ("Press & Hold to confirm you are a human", "Are You a Robot?") and leave
`recentRelayFailures` empty. Allowlisting cannot fix them, and they should not be worked around.

Distinguish the two:

- `403` **with** a new entry in `recentRelayFailures` → egress policy denial.
- `403` **without** one, returning an HTML challenge → the site is bot-blocking.

## The source that works

**<https://www.metrolistpro.com/>** — the official public search site of MetroList MLS, the MLS of
record for El Dorado County. It serves full listing detail (live status, `Lot Size in Acres`,
`Has a Pool`, photos) with no bot gate. See README for the per-city URLs and page structure.

Fetch it with the pre-installed Playwright Chromium:

```js
const { chromium } = require('playwright');
const b = await chromium.launch();
```

`curl` with a default user agent and `WebFetch` both fail against it; the real browser does not.

Also accessible: century21.com, compass.com, carlamovesyou.com, homefinder.com, xome.com — useful
as independent cross-checks on MLS coverage, but all three portals under-report inventory (see
README "Coverage").
