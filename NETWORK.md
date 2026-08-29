# Network notes

**Status as of 2026-08-29: outbound HTTPS is open.** The egress gateway no longer denies listing
sites — `example.com` returns 200, `recentRelayFailures` stays empty, and requests reach their
destinations. The earlier blanket 403 from the local proxy is gone.

Verify at any time:

```bash
curl -sS "$HTTPS_PROXY/__agentproxy/status" | python3 -m json.tool   # recentRelayFailures
curl -sS -o /dev/null -w "%{http_code}\n" https://example.com/       # 200 = egress open
```

## What still blocks, and what doesn't

Egress being open is not the same as the sites serving us. The portals block datacenter IP ranges
on their own, which is what this container runs on. Measured directly:

| Host | Code | Notes |
|---|---|---|
| `www.zillow.com` | 403 | Bot block |
| `www.trulia.com` | 403 | Same company, same block |
| `www.homes.com` | 403 | |
| `www.movoto.com` | 403 | |
| `www.point2homes.com`, `www.land.com`, `www.landwatch.com` | 403 | |
| `www.redfin.com` | 302 root / **403** | CloudFront blocks every search and `stingray` API path, so the CSV export is unreachable |
| `www.realtor.com` | 429 | Rate-limited before any content |
| `www.remax.com` | 405 | |
| **`www.coldwellbankerhomes.com`** | **200** | **Serves. This is the tracker's source.** |
| `www.metrolistpro.com` | 200 | The MLS itself; public search needs a session, unused |
| `www.compass.com` | 200 | Unused — CB already covers the inventory |
| `www.century21.com` | 301 | Redirects; unused |
| `m.cbhomes.com`, `m1.cbhomes.com` | 200 | Photo CDN, `full.webp` verified 128 KB |

Distinguishing a gateway denial from a site block: a gateway denial adds an entry to
`recentRelayFailures` in the proxy status; a site block does not, and returns an HTML body (the
CloudFront "Request blocked." page, in Redfin's case).

## Why Coldwell Banker is the right source anyway

It is an IDX mirror of **MetroList**, the actual MLS for El Dorado County, so it carries the same
inventory as the portals. Better, each detail page embeds JSON-LD at
`@graph[0].mainEntity.amenityFeature` with the complete MLS amenity table — `Lot Size (Acres)`,
`Pool`, `Pool Description`, `Horse Property`, `Water`, `Sewer`, `Year Built` — which is exactly
what the criteria need and what portal result cards omit. Full-resolution photo URLs come from
the same block. Nothing needs to be parsed out of rendered HTML beyond the result cards.

`scrape.py` implements this. It is stdlib + curl, caches every page under `.cache/` (gitignored),
and retries with backoff.

## Known limitation

The container cannot load images from `cbhomes.com` — the proxy drops those tunnels
(`ws_closed_mid_exchange`), so a headless render here shows empty photo frames. The URLs
themselves are fine (verified 200 via curl), and the **viewer's** browser is not behind this
proxy, so photos display normally on the published page.
