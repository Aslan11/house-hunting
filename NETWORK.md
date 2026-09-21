# Network notes

**Status as of 2026-09-21: outbound HTTPS is open.** Earlier runs were blocked at the egress
gateway for every listing site; that restriction is gone. `curl https://example.com/` returns 200
and `recentRelayFailures` is empty.

## Telling a policy denial from a site bot-block

They both surface as `403`, and the difference decides whether there is anything to fix.

```bash
curl -sS "$HTTPS_PROXY/__agentproxy/status" | python3 -m json.tool
```

- `recentRelayFailures` has a new entry reading
  `"gateway answered 403 to CONNECT (policy denial or upstream failure)"` → **egress policy**.
  Report the blocked host; don't route around it.
- `recentRelayFailures` is empty and the response body is site HTML (a CloudFront or Akamai error
  page) → **the site is refusing this IP**. Nothing in the environment config will fix it.

## What currently works

| Host | Result | Use |
|---|---|---|
| `www.coldwellbankerhomes.com` | 200 | Primary inventory — live MetroList IDX, server-rendered |
| `www.metrolistpro.com` | 200 | Verification — official MetroList site with a live `Status` field |
| `www.windermere.com`, `www.golyon.com`, `www.century21.com` | 200 | Untested as feeds |

## What does not work — site-level bot blocks, not policy

These refuse the datacenter IP regardless of headers or user-agent. Retrying is wasted time.

```
www.zillow.com        403 (Akamai/PerimeterX)
www.redfin.com        403 (CloudFront) — including the stingray CSV/autocomplete APIs
www.trulia.com        403
www.homes.com         403
www.movoto.com        403
www.realtor.com       429
www.kw.com            403
www.landwatch.com     403
```

`WebFetch` returns `405 Method Not Allowed` from the proxy — per `/root/.ccr/README.md` that means
the tool is sending a plain-HTTP request rather than a CONNECT tunnel. It is a tool-side issue, not
a policy denial. Use `curl` via Bash instead; it works.

## If the working hosts start blocking too

Fall back to paths that don't fight bot defenses:

1. A Zillow/Redfin **saved search with email alerts** to the connected Gmail. Alert emails carry
   current status, price cuts and image URLs, and need no network change. `ingest.js` accepts
   pasted results.
2. An agent-run **MLS/IDX client portal** with email alerts — fuller MLS data.
3. A licensed **real-estate data API key** (SimplyRETS, Bridge Interactive, a RapidAPI provider).
