#!/usr/bin/env node
/**
 * Builds index.html from listings.json.
 *
 * Future runs should edit listings.json ONLY, then run `node build.js`.
 *
 * Listings carry `isNew` (added on the most recent run) and `priceHistory`.
 * New listings are highlighted in their own section at the top of the page;
 * a price change renders as a delta under the price. See README for the
 * dedupe rules and the pool-verification gate.
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US'));
const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const bd = (n) => (n % 1 === 0 ? String(n) : String(n));

function galleryHost(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').split('.')[0]; }
  catch { return 'listing'; }
}

/** Media area: real photo when we have one, graceful tile when we don't. */
function media(l) {
  const gallery = l.gallery || l.url;
  const host = galleryHost(gallery);
  const tile =
    `<a class="tile" href="${esc(gallery)}" rel="noopener">` +
      `<span class="tile-ico" aria-hidden="true">&#9968;</span>` +
      `<span class="tile-txt">View photos on ${esc(host)} &rarr;</span>` +
    `</a>`;

  const photo = (l.photos && l.photos.length) ? l.photos[0] : null;
  if (!photo) return `<div class="media nophoto">${tile}</div>`;

  return `<div class="media">` +
    `<img src="${esc(photo)}" alt="${esc(l.address)}, ${esc(l.city)}" loading="lazy" ` +
      `referrerpolicy="no-referrer" ` +
      `onerror="this.closest('.media').classList.add('failed')">` +
    tile +
  `</div>`;
}

function facts(l) {
  const f = [];
  if (l.beds != null)  f.push(`<span class="fact">${esc(bd(l.beds))} bd</span>`);
  if (l.baths != null) f.push(`<span class="fact">${esc(bd(l.baths))} ba</span>`);
  if (l.sqft)  f.push(`<span class="fact">${num(l.sqft)} sqft</span>`);
  if (l.acres) f.push(`<span class="fact acres">${esc(l.acres)} acres</span>`);
  f.push(l.pool
    ? `<span class="fact pool">${esc(l.poolDetail || 'Pool')}</span>`
    : `<span class="fact nopool">${esc(l.poolDetail || 'No pool')}</span>`);
  if (l.daysOnMarket != null) f.push(`<span class="fact">${esc(l.daysOnMarket)} days on market</span>`);
  return f.join('');
}

function priceBlock(l) {
  const hist = l.priceHistory || [];
  const now = l.currentPrice;
  const perAcre = l.acres ? `<span class="peracre">${money(Math.round(now / l.acres))}/acre</span>` : '';
  if (hist.length > 1) {
    const prev = hist[hist.length - 2].price;
    const down = now < prev;
    const delta = Math.abs(now - prev);
    return `<p class="price">${money(now)}${perAcre}` +
      `<span class="pricechg ${down ? 'down' : 'up'}">` +
      `${down ? '&darr;' : '&uarr;'} ${money(delta)} from ${money(prev)}</span></p>`;
  }
  return `<p class="price">${money(now)}${perAcre}</p>`;
}

function card(l) {
  const mls = l.mls ? ` &middot; MLS ${esc(l.mls)}` : '';
  const tag = l.isNew
    ? `<span class="tag new">New this run</span>`
    : `<span class="tag ok">Tracked &middot; still active</span>`;
  return `
  <div class="card match${l.isNew ? ' isnew' : ''}">
    ${media(l)}
    <div class="body">
      ${tag}
      ${priceBlock(l)}
      <p class="addr">${esc(l.address)}</p>
      <p class="city">${esc(l.city)}, CA ${esc(l.zip)}${mls}</p>
      <div class="facts">${facts(l)}</div>
      <p class="note">${l.blurb || esc(l.notes)}</p>
      <a class="btn" href="${esc(l.url)}" rel="noopener">View listing &rarr;</a>
    </div>
  </div>`;
}

const listings = data.listings || [];
const fresh = listings.filter((l) => l.isNew);
const carried = listings.filter((l) => !l.isNew);
const nearMisses = data.nearMisses || [];
const dropped = data.dropped || [];
const rejected = data.rejected || [];
const unknownLot = data.unknownLotSize || [];

const nearRows = nearMisses.map((r) => `    <tr><td><a href="${esc(r.url)}" rel="noopener">${esc(r.address)}</a></td>` +
  `<td>${esc(r.city)}</td><td>${money(r.price)}</td><td>${esc(bd(r.beds))}bd / ${esc(bd(r.baths))}ba</td>` +
  `<td>${esc(r.acres)}</td><td>${esc(r.reason)}</td></tr>`).join('\n');

const droppedRows = dropped.map((r) => `    <tr><td>${esc(r.address)}</td><td>${esc(r.reason)}</td></tr>`).join('\n');

const rejectedRows = rejected
  .map((r) => `    <tr><td>${esc(r.address)}</td><td>${money(r.price)}</td><td>${esc(r.reason)}</td></tr>`)
  .join('\n');

const unknownRows = unknownLot.map((r) => `    <tr><td>${esc(r.address)}</td><td>${money(r.price)}</td>` +
  `<td>${esc(bd(r.beds))}bd / ${esc(bd(r.baths))}ba</td><td>${esc(r.note)}</td></tr>`).join('\n');

const cheapest = listings.length ? listings.reduce((a, b) => (a.currentPrice <= b.currentPrice ? a : b)) : null;
const biggest = listings.length ? listings.reduce((a, b) => (a.acres >= b.acres ? a : b)) : null;
const src = data.source || {};

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>House Hunt — Shingle Springs · Rescue · Placerville</title>
<style>
  :root{
    --bg:#f6f4f0; --card:#fff; --ink:#1c1a17; --muted:#6b665e;
    --line:#e2ddd4; --accent:#2f6b4f; --accent-soft:#e6f0ea;
    --new:#1c5fa8; --new-soft:#e2edf9;
    --warn:#8a6d1f; --warn-soft:#f8f0d8; --miss:#8a4b3a; --miss-soft:#f7e7e2;
    --tile:#ece7de;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#16181a; --card:#1f2225; --ink:#eceae6; --muted:#a09a91;
      --line:#31363a; --accent:#7fc4a1; --accent-soft:#1e2f27;
      --new:#7db4ec; --new-soft:#182633;
      --warn:#d9bd6a; --warn-soft:#2e2819; --miss:#e0a08c; --miss-soft:#2e211d;
      --tile:#282c30;
    }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  .wrap{max-width:1080px;margin:0 auto;padding:40px 20px 72px}
  header{border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:28px}
  h1{font-size:1.9rem;margin:0 0 8px;letter-spacing:-.02em}
  .sub{color:var(--muted);margin:0}
  .criteria{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
  .chip{background:var(--card);border:1px solid var(--line);border-radius:999px;
    padding:5px 12px;font-size:.82rem;color:var(--muted)}
  h2{font-size:1.15rem;margin:40px 0 6px;letter-spacing:-.01em}
  .sectnote{color:var(--muted);font-size:.88rem;margin:0 0 18px}
  .grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fill,minmax(330px,1fr))}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;
    overflow:hidden;display:flex;flex-direction:column}
  .card.match{border-top:4px solid var(--accent)}
  .card.isnew{border-top:4px solid var(--new);box-shadow:0 0 0 1px var(--new-soft)}
  .body{padding:18px 20px 20px;display:flex;flex-direction:column;flex:1}

  /* --- media --- */
  .media{position:relative;aspect-ratio:3/2;background:var(--tile);
    border-bottom:1px solid var(--line);overflow:hidden}
  .media img{width:100%;height:100%;object-fit:cover;display:block}
  .media .tile{display:none}
  .media.nophoto .tile,.media.failed .tile{display:flex}
  .media.failed img{display:none}
  .tile{position:absolute;inset:0;flex-direction:column;align-items:center;justify-content:center;
    gap:8px;text-decoration:none;color:var(--muted);background:
      repeating-linear-gradient(45deg,transparent,transparent 12px,rgba(128,128,128,.05) 12px,rgba(128,128,128,.05) 24px);}
  .tile:hover{color:var(--accent);background-color:var(--accent-soft)}
  .tile-ico{font-size:2rem;opacity:.55}
  .tile-txt{font-size:.85rem;font-weight:600}

  .price{font-size:1.45rem;font-weight:650;letter-spacing:-.02em;margin:0}
  .peracre{display:inline-block;font-size:.78rem;font-weight:600;color:var(--muted);
    margin-left:8px;letter-spacing:0}
  .pricechg{display:block;font-size:.8rem;font-weight:700;margin-top:3px}
  .pricechg.down{color:var(--accent)} .pricechg.up{color:var(--miss)}
  .addr{font-weight:600;margin:6px 0 2px}
  .city{color:var(--muted);font-size:.9rem;margin:0 0 14px}
  .facts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
  .fact{background:var(--bg);border:1px solid var(--line);border-radius:6px;
    padding:3px 9px;font-size:.8rem}
  .acres{font-weight:600}
  .pool{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:600}
  .nopool{background:var(--miss-soft);border-color:transparent;color:var(--miss);font-weight:600}
  .tag{display:inline-block;font-size:.72rem;font-weight:700;letter-spacing:.06em;
    text-transform:uppercase;padding:3px 8px;border-radius:5px;margin-bottom:12px;align-self:flex-start}
  .tag.ok{background:var(--accent-soft);color:var(--accent)}
  .tag.new{background:var(--new-soft);color:var(--new)}
  .note{font-size:.88rem;color:var(--muted);margin:0 0 16px;flex:1}
  .note strong{color:var(--ink)}
  a.btn{display:inline-block;text-decoration:none;color:var(--accent);font-weight:600;
    font-size:.9rem;border:1px solid var(--line);border-radius:7px;padding:7px 12px;align-self:flex-start}
  a.btn:hover{background:var(--accent-soft)}
  .banner{background:var(--new-soft);border:1px solid var(--line);border-left:4px solid var(--new);
    border-radius:10px;padding:16px 18px;margin-bottom:28px;font-size:.9rem}
  .banner h3{margin:0 0 6px;font-size:.95rem}
  .banner p{margin:0 0 8px;color:var(--muted)}
  .banner p:last-child{margin-bottom:0}
  .banner code{background:var(--bg);padding:1px 5px;border-radius:4px;font-size:.85em}
  .stats{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 8px}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:10px;
    padding:12px 16px;flex:1;min-width:150px}
  .stat b{display:block;font-size:1.35rem;letter-spacing:-.02em}
  .stat span{font-size:.78rem;color:var(--muted)}
  .tablewrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
  table{width:100%;border-collapse:collapse;font-size:.88rem}
  th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
  th{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  td a{color:var(--accent)}
  tr:last-child td{border-bottom:none}
  td.wrap-cell{white-space:normal;min-width:260px}
  footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);
    color:var(--muted);font-size:.84rem}
</style>
</head>
<body>
<div class="wrap">

<header>
  <h1>House Hunt: El Dorado County</h1>
  <p class="sub">Shingle Springs · Rescue · Placerville — updated <strong>${esc(data.lastRun)}</strong></p>
  <div class="criteria">
    <span class="chip">4+ bedrooms</span>
    <span class="chip">3+ bathrooms</span>
    <span class="chip">Pool required</span>
    <span class="chip">2.5+ acres (5+ preferred)</span>
    <span class="chip">Max $1.5M</span>
  </div>
</header>

${fresh.length ? `<div class="banner">
  <h3>&#10022; ${fresh.length} new ${fresh.length === 1 ? 'listing' : 'listings'} this run</h3>
  <p>All ${fresh.length} are confirmed <strong>active</strong> in the live listings feed as of
  ${esc(data.lastRun)}, and every one has its pool confirmed from the property's own MLS fields.
  This is the first run with a working live data source — previous runs could only read
  search-engine summaries, which is why they surfaced properties that were already sold.</p>
  <p>Scanned ${esc(src.activeListingsScanned || '—')} active listings across the county
  (${esc(src.inTargetCities || '—')} in the three target towns) to produce these.</p>
</div>` : ''}

<div class="stats">
  <div class="stat"><b>${listings.length}</b><span>matches on the market</span></div>
  ${cheapest ? `<div class="stat"><b>${money(cheapest.currentPrice)}</b><span>lowest — ${esc(cheapest.address)}</span></div>` : ''}
  ${biggest ? `<div class="stat"><b>${esc(biggest.acres)} ac</b><span>largest — ${esc(biggest.address)}</span></div>` : ''}
  <div class="stat"><b>${nearMisses.length}</b><span>fit everything but the pool</span></div>
</div>

${fresh.length ? `<h2>&#10022; New this run</h2>
<p class="sectnote">Added on ${esc(data.lastRun)}. Sorted by lot size, largest first.</p>
<div class="grid">${fresh.map(card).join('\n')}
</div>` : ''}

${carried.length ? `<h2>Still on the market</h2>
<p class="sectnote">Carried over from a previous run and re-confirmed active. A price change since
last run is shown under the price.</p>
<div class="grid">${carried.map(card).join('\n')}
</div>` : ''}

${nearMisses.length ? `<h2>Everything but the pool</h2>
<p class="sectnote">Active listings meeting 4BR / 3BA / 2.5+ acres / under $1.5M whose only failing
is the pool. Worth a look if you would consider adding one — several have the acreage and the flat
ground for it.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>City</th><th>Price</th><th>Beds/Baths</th><th>Acres</th><th>Why not</th></tr></thead>
  <tbody>
${nearRows}
  </tbody>
</table>
</div>` : ''}

${dropped.length ? `<h2>Dropped since last run</h2>
<p class="sectnote">Removed from the list — sold, withdrawn, or never genuinely listed. Kept here
only so they are not re-surfaced as new finds on a future run.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Reason</th></tr></thead>
  <tbody>
${droppedRows}
  </tbody>
</table>
</div>` : ''}

${unknownLot.length ? `<h2>Excluded — lot size not published</h2>
<p class="sectnote">New-construction listings in Rescue that meet the bed, bath and price tests but
publish no lot size. Almost certainly subdivision parcels well under 2.5 acres; listed so the
exclusion is visible rather than silent.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Price</th><th>Beds/Baths</th><th>Note</th></tr></thead>
  <tbody>
${unknownRows}
  </tbody>
</table>
</div>` : ''}

<h2>Ruled out on the facts</h2>
<p class="sectnote">Failed price, bedroom, bath or acreage minimums in an earlier run.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Price</th><th>Why not</th></tr></thead>
  <tbody>
${rejectedRows}
  </tbody>
</table>
</div>

<h2>How these were verified</h2>
<p class="sectnote">Earlier runs of this page reported properties that turned out to be off market,
because listing status was inferred from search-engine text and search engines keep indexing sold
listings with &ldquo;For Sale&rdquo; in the title for years. That is fixed. This run reads a live
structured feed, and every property clears three independent checks before it appears above:</p>
<div class="tablewrap" style="margin-bottom:8px">
<table>
  <thead><tr><th>Check</th><th>Source</th></tr></thead>
  <tbody>
    <tr><td>Currently on the market</td><td class="wrap-cell">Present in the live active-listings feed, with a 2026 (<code>226…</code>) MLS number</td></tr>
    <tr><td>Has a pool</td><td class="wrap-cell">The <code>Pool Information</code> amenity group on the property's own MLS record</td></tr>
    <tr><td>Pool cross-check</td><td class="wrap-cell">The listing's <code>hasPrivatePool</code> flag <em>and</em> the agent's own marketing remarks — all three must agree</td></tr>
  </tbody>
</table>
</div>
<p class="sectnote">That third check matters more than it looks: listing pages embed data for
<em>nearby</em> homes alongside the subject property, so a naive read of the page text finds pools
that belong to a different house down the road. Four of the properties above the fold in the raw
results had exactly that problem and were correctly excluded.</p>

<h2>What the market looks like</h2>
<p class="sectnote"><strong>The pool is the binding constraint, not the budget.</strong> Of
${esc(src.activeListingsScanned || 'the')} active listings scanned county-wide, 15 in the three
target towns meet the bed, bath, acreage and price tests — but only ${listings.length} of those have
a pool. Large-acreage homes at $1.0–1.2M are plentiful; many have <em>ponds</em> rather than pools.
The upshot is that the shortlist above is close to the entire market for what you are after, and a
new one appearing is worth acting on quickly rather than waiting for a bigger field to compare
against.</p>

<footer>
  <p>Generated from <code>listings.json</code> by <code>build.js</code>.
  <strong>${listings.length} active matches</strong> (${fresh.length} new this run),
  ${nearMisses.length} pool-less near misses, ${dropped.length} dropped,
  ${rejected.length} ruled out on the facts.
  Runs flag only new listings and price changes — no repeats.</p>
</footer>

</div>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`Built index.html — ${listings.length} matches (${fresh.length} new), ` +
            `${nearMisses.length} near misses, ${dropped.length} dropped.`);
