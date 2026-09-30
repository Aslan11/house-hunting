# Network reality for this tracker

Superseded as of **2026-08-15**. Outbound HTTPS now works — the egress gateway is open and
`recentRelayFailures` is empty:

```bash
curl -sS "$HTTPS_PROXY/__agentproxy/status" | python3 -m json.tool
```

What blocks listing data now is **site-side bot defence**, not the proxy. Distinguish the two: a
gateway denial shows up in `recentRelayFailures`; a site block does not.

## Host status, measured 2026-08-15

| Host | Result | Usable |
|---|---|---|
| `www.coldwellbankerhomes.com` | 200, correct city, full MetroList IDX data | **Yes — primary** |
| `www.metrolistpro.com` | 200, official MetroList MLS records by MLS number | **Yes — verification** |
| `m.cbhomes.com` | 200 on `GET` (rejects `HEAD`) | **Yes — photos** |
| `www.redfin.com` | 200, full GIS payload on `/zipcode/<zip>` | **Yes — cross-check only** |
| `www.zillow.com`, `www.homes.com`, `www.movoto.com`, `www.remax.com`, `www.har.com` | 403 | No |
| `www.realtor.com` | 429 | No |
| `www.redfin.com/stingray/api/gis-csv` | 200, CSV export of a region's listings | **Yes — cross-check** |
| `www.redfin.com/stingray/do/location-autocomplete` | 403 (CloudFront) | No |
| `www.century21.com` | 200 but client-rendered shell, no data in HTML | No |

Both usable hosts require a browser `User-Agent`. The default agent string is blocked.

The Redfin row was corrected on **2026-08-23**. The "decoy page for another state" was real but
self-inflicted: `/city/<id>/…` resolves by numeric id, and a guessed id serves a complete,
valid-looking page for a different city (17151 is San Francisco, not Shingle Springs). HTTP 200 on a
wrong id looks exactly like success. `/zipcode/<zip>` has no such failure mode and returns the full
GIS search payload — good enough to enumerate as a cross-check, though the board still comes from
the IDX feed. Either way, **assert the expected city appears in the returned HTML** before trusting
a page.

Redfin also answers **202 with a stub body** under load rather than 429. A short body is retryable;
back off and try again, and never read a 202 as a missing listing.

## `stingray/*` is not blocked as a whole — corrected 2026-09-06

The row above used to read `www.redfin.com/stingray/* | 403 (CloudFront) | No`, generalising from a
single blocked path. It is per-endpoint: `do/location-autocomplete` is CloudFront-blocked,
`api/gis-csv` is not, and the latter returns a clean CSV of a region's listings — no HTML parsing.

```bash
curl -sS -A "$UA" -H "Referer: https://www.redfin.com/zipcode/95682" \
  "https://www.redfin.com/stingray/api/gis-csv?al=1&num_homes=350&ord=redfin-recommended-asc\
&page_number=1&region_id=39806&region_type=2&sf=1,2,3,5,6,7&status=9&uipt=1,2,3,4,7,8&v=8"
```

`region_id` is Redfin's **internal** region id, not the ZIP. Passing the ZIP returns HTTP 200 with a
full, valid-looking CSV of listings **in another state** — the same silent-wrong-region failure the
`/city/<id>/` path has. Scrape the id, and assert the city column before trusting a row:

```bash
curl -sSL -A "$UA" https://www.redfin.com/zipcode/95682 | grep -oE 'region_id=[0-9]+'
```

Current ids: **95682 → 39806**, **95672 → 39796**, **95667 → 39791**. The CSV footer states that
some MLS listings are excluded from the download, so this stays a cross-check and never the board.
A 2026-09-06 sweep this way returned 291 active listings in the three cities and found the same six
pool matches — the same corroboration `scripts/parse_search.py` gives, with less parsing.

One thing it did add: **3538 Wildwood Ln, which MetroListPRO still has not indexed** (10 days), read
`For sale` on its live Redfin page, MLS 226107286, 10 days on market, at the board's $949,000. When
`verify.py` carries a match as unverified-because-unindexed, this is a cheap second opinion.

The listing page also carries a status banner that discriminates correctly — `For sale` vs
`Off Market`, validated on 2026-09-06 against two known-sold properties — and structured pool
fields (`"hasPrivatePool"`, plus the MLS `Pool Information` amenity group). Unescape the embedded
JSON (`\"` → `"`) before matching. Beware **spa-only** records: 5025 Eco Ridge Rd carries
`Spa/Hot Tub Personal` with no pool, and prose is no guide either — listing descriptions mention
neighbours' pools, nearby pool contractors and "room for a future pool".

## Headless browser

**Corrected 2026-09-03.** This section previously said Chromium had no outbound network at all,
because even `https://example.com` failed with `ERR_CONNECTION_RESET` with or without
`--proxy-server`. That diagnosis was wrong. Chromium reaches the network fine; its **TLS handshake**
was being dropped.

The proxy logs the failure as:

```
ws_closed_mid_exchange: tunnel closed (code 1006) after 6s; 1820 B sent, 39 B received
```

1,820 bytes of ClientHello out, 39 bytes back, tunnel dead. Chromium's post-quantum key agreement
(`X25519MLKEM768`) produces an oversized ClientHello spanning multiple TLS records and the proxy
drops it. Disable that and everything loads:

```js
chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [
    '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--disable-quic', '--ignore-certificate-errors',
    '--disable-features=EncryptedClientHello,PostQuantumKyber,TLS13KyberSupport,' +
      'X25519Kyber768,X25519MLKEM768,UseDnsHttpsSvcb,AsyncDns,OptimizationHints',
    '--ssl-version-max=tls1.2',
  ],
  proxy: { server: process.env.HTTPS_PROXY },
});
```

Playwright is at `/opt/node22/lib/node_modules/playwright`; don't run `playwright install`.

Nothing in the pipeline needs this today — `curl` reaches both source hosts and is simpler. It
matters for two cases. First, if the IDX or MetroListPRO ever starts bot-blocking `curl` the way
the consumer portals do, a real browser is the fallback, and it works: a 2026-09-03 check pulled
Redfin search CSVs and 22 detail pages this way (Zillow still refuses a real browser too, so don't
bother). Second, and more important, **a bare `ERR_CONNECTION_RESET` is not evidence that a host is
blocked by policy.** A genuine policy denial shows up in `recentRelayFailures` as a CONNECT 403;
confirm that before recording a host as unreachable. Reading resets as denials is what produced the
incorrect claim this section used to make.

## If the usable hosts start blocking

Fall back to paths that don't fight bot defences:

1. A Zillow/Redfin **saved search with email alerts** into the connected Gmail — carries current
   status, price cuts and image URLs, needs no network change.
2. An agent-run **MLS/IDX client portal** with email alerts.
3. A licensed **data API key** (SimplyRETS, Bridge Interactive, RapidAPI).
