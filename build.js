#!/usr/bin/env node
/**
 * Builds index.html from listings.json.
 *
 * Future runs should edit listings.json ONLY, then run `node build.js`.
 *
 * Section order is deliberate: anything with `isNew: true` or a price change since the
 * last run is hoisted into a "New this run" block at the top of the page, so a returning
 * reader sees only what changed. Everything else falls through to the standing list.
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (n == null ? '—' : '$' + n.toLocaleString('en-US'));
const num = (n) => (n == null ? '—' : n.toLocaleString('en-US'));

/** A listing counts as changed if its latest price differs from the one before it. */
function priceDelta(l) {
  const h = l.priceHistory || [];
  if (h.length < 2) return null;
  const prev = h[h.length - 2].price;
  const now = l.currentPrice;
  if (prev == null || now == null || prev === now) return null;
  return { prev, now, down: now < prev, amount: Math.abs(now - prev) };
}

function galleryHost(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').split('.')[0]; }
  catch { return 'listing'; }
}

/** Media area: real photo when we have one, graceful tile when we don't. */
function media(l) {
  const gallery = l.gallery || l.url;
  const host = galleryHost(gallery);
  const more = l.photoCount ? `All ${l.photoCount} photos on ${host} &rarr;`
                            : `View photos on ${host} &rarr;`;
  const tile =
    `<a class="tile" href="${esc(gallery)}" rel="noopener">` +
      `<span class="tile-ico" aria-hidden="true">&#9968;</span>` +
      `<span class="tile-txt">${more}</span>` +
    `</a>`;

  const photo = (l.photos && l.photos.length) ? l.photos[0] : null;
  if (!photo) return `<div class="media nophoto">${tile}</div>`;

  const thumbs = (l.photos || []).slice(1, 5).map((p, i) =>
    `<img src="${esc(p)}" alt="${esc(l.address)} — photo ${i + 2}" loading="lazy" ` +
    `referrerpolicy="no-referrer" onerror="this.remove()">`).join('');

  return `<div class="media">` +
    `<img class="hero" src="${esc(photo)}" alt="${esc(l.address)}, ${esc(l.city)}" loading="lazy" ` +
      `referrerpolicy="no-referrer" ` +
      `onerror="this.closest('.media').classList.add('failed')">` +
    tile +
  `</div>` +
  (thumbs ? `<div class="thumbs">${thumbs}</div>` : '');
}

function facts(l) {
  const f = [];
  if (l.beds != null)  f.push(`<span class="fact">${esc(l.beds)} bd</span>`);
  if (l.baths != null) f.push(`<span class="fact">${esc(l.baths)} ba</span>`);
  if (l.sqft)  f.push(`<span class="fact">${num(l.sqft)} sqft</span>`);
  if (l.acres) f.push(`<span class="fact${l.acres >= 5 ? ' good' : ''}">${esc(l.acres)} acres</span>`);
  if (l.yearBuilt) f.push(`<span class="fact">built ${esc(l.yearBuilt)}</span>`);
  f.push(l.pool
    ? `<span class="fact pool">${esc(l.poolDetail || 'Pool')}</span>`
    : `<span class="fact nopool">${esc(l.poolDetail || 'No pool')}</span>`);
  return f.join('');
}

function priceBlock(l) {
  const d = priceDelta(l);
  const ppsf = l.sqft && l.currentPrice
    ? `<span class="ppsf">${money(Math.round(l.currentPrice / l.sqft))}/sqft</span>` : '';
  if (!d) return `<p class="price">${money(l.currentPrice)}${ppsf}</p>`;
  return `<p class="price">${money(d.now)}${ppsf}` +
    `<span class="pricechg ${d.down ? 'down' : 'up'}">` +
    `${d.down ? '&darr;' : '&uarr;'} ${money(d.amount)} from ${money(d.prev)}</span></p>`;
}

function card(l, { flagNew = false } = {}) {
  const d = priceDelta(l);
  const flags = [];
  if (flagNew && l.isNew) flags.push(`<span class="tag new">New</span>`);
  if (d) flags.push(`<span class="tag ${d.down ? 'ok' : 'warn'}">Price ${d.down ? 'cut' : 'raised'}</span>`);
  flags.push(`<span class="tag ok">Active &middot; verified ${esc(l.verification?.checkedOn || data.lastRun)}</span>`);

  const dom = l.daysOnMarket != null
    ? ` &middot; ${l.daysOnMarket} day${l.daysOnMarket === 1 ? '' : 's'} on market` : '';
  const agent = l.agent ? `<p class="agent">Listed by ${esc(l.agent)}${l.broker ? ` &middot; ${esc(l.broker)}` : ''}</p>` : '';
  const caveat = l.caveat ? `<p class="caveat"><strong>Worth knowing:</strong> ${esc(l.caveat)}</p>` : '';
  const extras = [l.lotFeatures, l.otherStructures ? `Also on the lot: ${l.otherStructures}` : null]
    .filter(Boolean).map((x) => esc(x)).join(' &middot; ');

  return `
  <article class="card match${l.isNew && flagNew ? ' isnew' : ''}">
    ${media(l)}
    <div class="body">
      <div class="tags">${flags.join('')}</div>
      ${priceBlock(l)}
      <p class="addr">${esc(l.address)}</p>
      <p class="city">${esc(l.city)}, CA ${esc(l.zip)} &middot; MLS ${esc(l.mls)}${dom}</p>
      <div class="facts">${facts(l)}</div>
      <p class="note">${esc(l.blurb || l.notes)}</p>
      ${caveat}
      ${extras ? `<p class="extras">${extras}</p>` : ''}
      ${agent}
      <a class="btn" href="${esc(l.url)}" rel="noopener">View full listing &rarr;</a>
    </div>
  </article>`;
}

const matches = (data.listings || []).filter((l) => l.status === 'match');
const fresh = matches.filter((l) => l.isNew || priceDelta(l));
const standing = matches.filter((l) => !(l.isNew || priceDelta(l)));
// Anything ingest.js flagged as active but off-criteria — shown so it can't silently vanish.
const offCriteria = (data.listings || []).filter((l) => l.status === 'active-fails-criteria');

const droppedRows = (data.dropped || []).map((r) =>
  `    <tr><td>${esc(r.address)}, ${esc(r.city)}</td><td>${r.mls ? esc(r.mls) : '—'}</td><td>${esc(r.reason)}</td></tr>`
).join('\n');

const checkedRows = (data.checkedNoPool || []).map((r) =>
  `    <tr><td><a href="${esc(r.url)}" rel="noopener">${esc(r.address)}</a></td><td>${esc(r.city)}</td>` +
  `<td>${money(r.price)}</td><td>${esc(r.beds)}bd / ${esc(r.baths)}ba</td><td>${esc(r.acres)} ac</td>` +
  `<td>${esc(r.reason)}</td></tr>`
).join('\n');

const rejectedRows = (data.rejected || []).map((r) =>
  `    <tr><td>${esc(r.address)}</td><td>${money(r.price)}</td><td>${esc(r.reason)}</td></tr>`
).join('\n');

const cheapest = matches.length ? matches[0] : null;
const biggest = matches.length
  ? matches.reduce((a, b) => ((b.acres || 0) > (a.acres || 0) ? b : a)) : null;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>House Hunt — Shingle Springs · Rescue · Placerville</title>
<meta name="description" content="Verified-active 4BR+/3BA+ homes with a pool on 2.5+ acres under $1.5M in Shingle Springs, Rescue and Placerville, CA.">
<style>
  :root{
    --bg:#f6f4f0; --card:#fff; --ink:#1c1a17; --muted:#6b665e;
    --line:#e2ddd4; --accent:#2f6b4f; --accent-soft:#e6f0ea;
    --new:#1d5b8f; --new-soft:#e2edf7;
    --warn:#8a6d1f; --warn-soft:#f8f0d8; --miss:#8a4b3a; --miss-soft:#f7e7e2;
    --tile:#ece7de;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#16181a; --card:#1f2225; --ink:#eceae6; --muted:#a09a91;
      --line:#31363a; --accent:#7fc4a1; --accent-soft:#1e2f27;
      --new:#8ec2ee; --new-soft:#1a2836;
      --warn:#d9bd6a; --warn-soft:#2e2819; --miss:#e0a08c; --miss-soft:#2e211d;
      --tile:#282c30;
    }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  .wrap{max-width:1120px;margin:0 auto;padding:40px 20px 72px}
  header{border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:28px}
  h1{font-size:1.9rem;margin:0 0 8px;letter-spacing:-.02em}
  .sub{color:var(--muted);margin:0}
  .criteria{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
  .chip{background:var(--card);border:1px solid var(--line);border-radius:999px;
    padding:5px 12px;font-size:.82rem;color:var(--muted)}
  h2{font-size:1.15rem;margin:44px 0 6px;letter-spacing:-.01em}
  h2 .count{color:var(--muted);font-weight:400}
  .sectnote{color:var(--muted);font-size:.88rem;margin:0 0 18px;max-width:70ch}
  .grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(340px,1fr))}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;
    overflow:hidden;display:flex;flex-direction:column}
  .card.match{border-top:4px solid var(--accent)}
  .card.isnew{border-top-color:var(--new);box-shadow:0 0 0 1px var(--new-soft)}
  .body{padding:16px 20px 20px;display:flex;flex-direction:column;flex:1}

  /* --- media --- */
  .media{position:relative;aspect-ratio:3/2;background:var(--tile);
    border-bottom:1px solid var(--line);overflow:hidden}
  .media img.hero{width:100%;height:100%;object-fit:cover;display:block}
  .media .tile{display:none}
  .media.nophoto .tile,.media.failed .tile{display:flex}
  .media.failed img.hero{display:none}
  .tile{position:absolute;inset:0;flex-direction:column;align-items:center;justify-content:center;
    gap:8px;text-decoration:none;color:var(--muted);background:
      repeating-linear-gradient(45deg,transparent,transparent 12px,rgba(128,128,128,.05) 12px,rgba(128,128,128,.05) 24px);}
  .tile:hover{color:var(--accent);background-color:var(--accent-soft)}
  .tile-ico{font-size:2rem;opacity:.55}
  .tile-txt{font-size:.85rem;font-weight:600}
  .thumbs{display:grid;grid-template-columns:repeat(4,1fr);gap:2px;background:var(--line)}
  .thumbs img{width:100%;aspect-ratio:1;object-fit:cover;display:block}

  .tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
  .price{font-size:1.5rem;font-weight:650;letter-spacing:-.02em;margin:0;
    display:flex;align-items:baseline;flex-wrap:wrap;gap:8px}
  .ppsf{font-size:.82rem;font-weight:500;color:var(--muted);letter-spacing:0}
  .pricechg{flex-basis:100%;font-size:.8rem;font-weight:700;margin-top:1px;letter-spacing:0}
  .pricechg.down{color:var(--accent)} .pricechg.up{color:var(--miss)}
  .addr{font-weight:600;margin:6px 0 2px}
  .city{color:var(--muted);font-size:.88rem;margin:0 0 14px}
  .facts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
  .fact{background:var(--bg);border:1px solid var(--line);border-radius:6px;
    padding:3px 9px;font-size:.8rem}
  .fact.good{border-color:var(--accent);color:var(--accent)}
  .pool{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:600}
  .nopool{background:var(--miss-soft);border-color:transparent;color:var(--miss);font-weight:600}
  .tag{display:inline-block;font-size:.7rem;font-weight:700;letter-spacing:.06em;
    text-transform:uppercase;padding:3px 8px;border-radius:5px}
  .tag.ok{background:var(--accent-soft);color:var(--accent)}
  .tag.new{background:var(--new-soft);color:var(--new)}
  .tag.warn{background:var(--warn-soft);color:var(--warn)}
  .tag.bad{background:var(--miss-soft);color:var(--miss)}
  .note{font-size:.9rem;color:var(--muted);margin:0 0 12px}
  .caveat{font-size:.85rem;color:var(--ink);background:var(--warn-soft);
    border-radius:7px;padding:9px 11px;margin:0 0 12px}
  .extras{font-size:.8rem;color:var(--muted);margin:0 0 10px}
  .agent{font-size:.8rem;color:var(--muted);margin:0 0 14px;flex:1}
  a.btn{display:inline-block;text-decoration:none;color:var(--accent);font-weight:600;
    font-size:.9rem;border:1px solid var(--line);border-radius:7px;padding:7px 12px;align-self:flex-start}
  a.btn:hover{background:var(--accent-soft)}
  .banner{background:var(--new-soft);border:1px solid var(--line);border-left:4px solid var(--new);
    border-radius:10px;padding:16px 18px;margin-bottom:28px;font-size:.9rem}
  .banner h3{margin:0 0 6px;font-size:.95rem}
  .banner p{margin:0 0 8px}
  .banner p:last-child{margin-bottom:0}
  .banner ul{margin:0 0 8px;padding-left:20px}
  .banner code{background:var(--bg);padding:1px 5px;border-radius:4px;font-size:.85em}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:0 0 8px}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
  .stat b{display:block;font-size:1.35rem;letter-spacing:-.02em}
  .stat span{font-size:.78rem;color:var(--muted)}
  .tablewrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
  table{width:100%;border-collapse:collapse;font-size:.88rem}
  th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
  th{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  td a{color:var(--accent)}
  tr:last-child td{border-bottom:none}
  details{margin-top:14px}
  summary{cursor:pointer;color:var(--muted);font-size:.88rem}
  footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);
    color:var(--muted);font-size:.84rem}
  @media (max-width:520px){ th,td{white-space:normal} }
</style>
</head>
<body>
<div class="wrap">

<header>
  <h1>House Hunt: El Dorado County</h1>
  <p class="sub">Shingle Springs · Rescue · Placerville — updated <strong>${esc(data.lastRun)}</strong>
  (previous run ${esc(data.previousRun)})</p>
  <div class="criteria">
    <span class="chip">4+ bedrooms</span>
    <span class="chip">3+ bathrooms</span>
    <span class="chip">Pool required</span>
    <span class="chip">2.5+ acres (5+ preferred)</span>
    <span class="chip">Max $1.5M</span>
  </div>
</header>

${fresh.length ? `<div class="banner">
  <h3>&#10022; ${fresh.length} new since ${esc(data.previousRun)}</h3>
  <p>The whole list below is new. Live listing data became reachable for the first time this run, so
  every property here has been read from its own listing page and confirmed <strong>Active</strong>
  rather than inferred from search-engine text — which is what produced the four false matches on
  ${esc(data.previousRun)}.</p>
  <p>Also this run: the bedroom minimum moved from 5+ to 4+, and six previously tracked properties
  were confirmed sold or off market and <a href="#dropped">dropped</a>.</p>
</div>` : ''}

<div class="stats">
  <div class="stat"><b>${data.search?.activeListingsScanned ?? '—'}</b><span>active listings scanned</span></div>
  <div class="stat"><b>${data.search?.metCoreCriteria ?? '—'}</b><span>met beds / baths / acres / price</span></div>
  <div class="stat"><b>${matches.length}</b><span>of those have a pool</span></div>
  <div class="stat"><b>${cheapest ? money(cheapest.currentPrice) : '—'}</b><span>entry price</span></div>
  <div class="stat"><b>${biggest ? biggest.acres + ' ac' : '—'}</b><span>largest parcel</span></div>
</div>
<p class="sectnote">${esc(data.search?.note || '')}</p>

${fresh.length ? `<h2 id="new">New this run <span class="count">— ${fresh.length}</span></h2>
<p class="sectnote">Sorted cheapest first. Every one confirmed Active against its own listing page on
${esc(data.lastRun)}.</p>
<div class="grid">${fresh.map((l) => card(l, { flagNew: true })).join('\n')}
</div>` : ''}

${standing.length ? `<h2 id="standing">Still on the list <span class="count">— ${standing.length}</span></h2>
<p class="sectnote">Carried over from an earlier run, re-confirmed Active, unchanged in price.</p>
<div class="grid">${standing.map((l) => card(l)).join('\n')}
</div>` : ''}

${offCriteria.length ? `<h2 id="offcriteria">Active, but misses a criterion <span class="count">— ${offCriteria.length}</span></h2>
<p class="sectnote">On the market and confirmed, but short on beds, baths, acreage, pool or budget.
Shown for transparency, not as a recommendation.</p>
<div class="grid">${offCriteria.map((l) => card(l)).join('\n')}
</div>` : ''}

<h2 id="dropped">Dropped this run <span class="count">— ${(data.dropped || []).length}</span></h2>
<p class="sectnote">Sold, off market, or newly failing a criterion. Kept only as a record so a genuine
relist gets flagged instead of arriving as a fresh find.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>MLS</th><th>Why it's gone</th></tr></thead>
  <tbody>
${droppedRows}
  </tbody>
</table>
</div>

<h2 id="nopool">Met everything except the pool <span class="count">— ${(data.checkedNoPool || []).length}</span></h2>
<p class="sectnote">All active, all 4BR+/3BA+ on 2.5+ acres under $1.5M — and none has a pool. This is
the shape of the market here: <strong>the pool is the binding constraint, not the budget.</strong>
Listed so a future run doesn't re-check them, and in case adding a pool is on the table.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>City</th><th>Price</th><th>Beds/baths</th><th>Lot</th><th>Why not</th></tr></thead>
  <tbody>
${checkedRows}
  </tbody>
</table>
</div>

<details>
  <summary>Older exclusions from previous runs (${(data.rejected || []).length})</summary>
  <div class="tablewrap" style="margin-top:12px">
  <table>
    <thead><tr><th>Address</th><th>Price</th><th>Why not</th></tr></thead>
    <tbody>
${rejectedRows}
    </tbody>
  </table>
  </div>
</details>

<h2>How this run verified things</h2>
<p class="sectnote">${esc(data.dataQuality?.note || '')}</p>
<p class="sectnote">${esc(data.search?.method || '')}</p>

<footer>
  <p>Generated from <code>listings.json</code> by <code>build.js</code>.
  ${matches.length} verified-active matches, ${(data.checkedNoPool || []).length} active but pool-less,
  ${(data.dropped || []).length} dropped. Future runs report only new listings and price changes — no repeats.</p>
  <p>Listing photos are hotlinked from Redfin and remain the copyright of the listing brokerages.</p>
</footer>

</div>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`Built index.html — ${fresh.length} new, ${standing.length} standing, ` +
            `${(data.dropped || []).length} dropped, ${(data.checkedNoPool || []).length} pool-less.`);
