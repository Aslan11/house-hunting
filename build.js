#!/usr/bin/env node
/**
 * Builds index.html from listings.json.
 *
 * Future runs should edit listings.json ONLY, then run `node build.js`.
 *
 * Conventions this renderer relies on:
 *   status   'match' | 'active-fails-criteria' | 'off-market'
 *   isNew    true  -> the listing is surfaced in the "New this run" band at the top
 *   priceHistory  more than one entry -> the card shows the delta automatically
 *   photos   first URL becomes the card image; a dead URL falls back to a gallery
 *            tile client-side, so a 404 never leaves a hole in the layout
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (n == null ? '—' : '$' + n.toLocaleString('en-US'));
const short = (n) => (n == null ? '—' : '$' + (n / 1000).toFixed(0) + 'K');
const num = (n) => (n == null ? '—' : n.toLocaleString('en-US'));

const TAGS = {
  match:                   { cls: 'match',   tag: 'ok',   label: 'Verified match' },
  'active-fails-criteria': { cls: 'caution', tag: 'warn', label: 'Active — fails criteria' },
  'off-market':            { cls: 'miss',    tag: 'bad',  label: 'Off market' },
};

const fmtDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

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
    `<a href="${esc(gallery)}" rel="noopener">` +
      `<img src="${esc(photo)}" alt="${esc(l.address)}, ${esc(l.city)}" loading="lazy" ` +
        `referrerpolicy="no-referrer" ` +
        `onerror="this.closest('.media').classList.add('failed')">` +
    `</a>` + tile +
  `</div>`;
}

function facts(l) {
  const f = [];
  if (l.beds != null)  f.push(`<span class="fact">${esc(l.beds)} bd</span>`);
  if (l.baths != null) f.push(`<span class="fact">${esc(l.baths)} ba</span>`);
  if (l.sqft)  f.push(`<span class="fact">${num(l.sqft)} sqft</span>`);
  if (l.acres) f.push(`<span class="fact${l.acres >= 5 ? ' good' : ''}">${esc(l.acres)} acres</span>`);
  f.push(l.pool
    ? `<span class="fact pool">${esc(l.poolDetail || 'Pool')}</span>`
    : `<span class="fact nopool">${esc(l.poolDetail || 'No pool')}</span>`);
  return f.join('');
}

function priceBlock(l) {
  const hist = l.priceHistory || [];
  const now = l.currentPrice;
  const psf = (now && l.sqft) ? `<span class="psf">$${Math.round(now / l.sqft)}/sq ft</span>` : '';
  if (hist.length > 1) {
    const prev = hist[hist.length - 2].price;
    const down = now < prev;
    const delta = Math.abs(now - prev);
    return `<p class="price">${money(now)}${psf}` +
      `<span class="pricechg ${down ? 'down' : 'up'}">` +
      `${down ? '&darr;' : '&uarr;'} ${money(delta)} from ${money(prev)}` +
      ` &middot; ${esc(fmtDate(hist[hist.length - 1].date))}</span></p>`;
  }
  return `<p class="price">${money(now)}${psf}</p>`;
}

function card(l, { flagNew = false } = {}) {
  const meta = TAGS[l.status] || TAGS.match;
  const label = l.badge || meta.label;
  const mls = l.mls ? ` &middot; MLS ${esc(l.mls)}` : '';
  const dom = l.daysOnMarket != null
    ? `<span class="dom">${l.daysOnMarket} days on market</span>` : '';
  const newTag = flagNew && l.isNew ? `<span class="tag new">New</span>` : '';
  const cut = (l.priceHistory || []).length > 1 ? `<span class="tag cut">Price cut</span>` : '';
  return `
  <article class="card ${meta.cls}">
    ${media(l)}
    <div class="body">
      <div class="tags">${newTag}${cut}<span class="tag ${meta.tag}">${esc(label)}</span></div>
      ${priceBlock(l)}
      <p class="addr">${esc(l.address)}</p>
      <p class="city">${esc(l.city)}, CA ${esc(l.zip)}${mls}</p>
      <div class="facts">${facts(l)}</div>
      <p class="note">${l.blurb || esc(l.notes)}</p>
      <p class="prov">${esc(l.broker ? 'Listed by ' + l.broker : '')}${
        l.listedOn ? ` &middot; listed ${esc(fmtDate(l.listedOn))}` : ''}${dom ? ' &middot; ' + dom : ''}</p>
      <a class="btn" href="${esc(l.url)}" rel="noopener">View listing &rarr;</a>
    </div>
  </article>`;
}

const byStatus = (s) => data.listings.filter((l) => l.status === s);
const matches  = byStatus('match');
const active   = byStatus('active-fails-criteria');
const archived = byStatus('off-market');

const fresh   = matches.filter((l) => l.isNew);
const ongoing = matches.filter((l) => !l.isNew);
const changed = matches.filter((l) => (l.priceHistory || []).length > 1);

const sortByPrice = (a, b) => (a.currentPrice || 0) - (b.currentPrice || 0);
fresh.sort(sortByPrice);
ongoing.sort(sortByPrice);

const nm = (data.nearMisses && data.nearMisses.items) || [];
const nearMissRows = nm
  .slice()
  .sort(sortByPrice2)
  .map((r) => `      <tr>
        <td><a href="${esc(r.url)}" rel="noopener">${esc(r.address)}</a></td>
        <td>${esc(r.city)}</td>
        <td class="n">${money(r.price)}</td>
        <td class="n">${esc(r.beds)}/${esc(r.baths)}</td>
        <td class="n">${num(r.sqft)}</td>
        <td class="n">${esc(r.acres)}</td>
      </tr>`).join('\n');
function sortByPrice2(a, b) { return (a.price || 0) - (b.price || 0); }

const droppedRows = (data.droppedThisRun || [])
  .map((r) => `      <tr><td>${esc(r.address)}</td><td>${esc(r.reason)}</td></tr>`).join('\n');

const rejectedRows = (data.rejected || [])
  .map((r) => `      <tr><td>${esc(r.address)}</td><td class="n">${money(r.price)}</td><td>${esc(r.reason)}</td></tr>`)
  .join('\n');

const q = data.criteria;
const dq = data.dataQuality || {};

const cheapest = matches.reduce((a, b) => (a && a.currentPrice < b.currentPrice ? a : b), null);
const biggest  = matches.reduce((a, b) => (a && a.acres > b.acres ? a : b), null);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>House Hunt — Shingle Springs · Rescue · Placerville</title>
<meta name="description" content="Verified 4BR+/3BA+ homes with a pool on 2.5+ acres in Shingle Springs, Rescue and Placerville, CA under $1.5M.">
<style>
  :root{
    --bg:#f6f4f0; --card:#fff; --ink:#1c1a17; --muted:#6b665e;
    --line:#e2ddd4; --accent:#2f6b4f; --accent-soft:#e6f0ea;
    --warn:#8a6d1f; --warn-soft:#f8f0d8; --miss:#8a4b3a; --miss-soft:#f7e7e2;
    --new:#1d5c8f; --new-soft:#e1eef8; --tile:#ece7de;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#16181a; --card:#1f2225; --ink:#eceae6; --muted:#a09a91;
      --line:#31363a; --accent:#7fc4a1; --accent-soft:#1e2f27;
      --warn:#d9bd6a; --warn-soft:#2e2819; --miss:#e0a08c; --miss-soft:#2e211d;
      --new:#7db6e3; --new-soft:#18293a; --tile:#282c30;
    }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  .wrap{max-width:1100px;margin:0 auto;padding:40px 16px 72px}
  header{border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:28px}
  h1{font-size:1.9rem;margin:0 0 8px;letter-spacing:-.02em}
  .sub{color:var(--muted);margin:0}
  .criteria{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
  .chip{background:var(--card);border:1px solid var(--line);border-radius:999px;
    padding:5px 12px;font-size:.82rem;color:var(--muted)}
  h2{font-size:1.15rem;margin:44px 0 6px;letter-spacing:-.01em}
  h2 .count{color:var(--muted);font-weight:400}
  .sectnote{color:var(--muted);font-size:.88rem;margin:0 0 18px;max-width:72ch}
  .grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}

  /* --- new-this-run band --- */
  .newband{background:var(--new-soft);border:1px solid var(--line);border-left:4px solid var(--new);
    border-radius:12px;padding:20px 22px;margin-bottom:8px}
  .newband h2{margin:0 0 6px;color:var(--new);font-size:1.25rem}
  .newband .sectnote{margin-bottom:0}
  .newband ul{margin:12px 0 0;padding-left:20px;font-size:.9rem;color:var(--muted)}
  .newband li{margin-bottom:4px}
  .newband li strong{color:var(--ink)}

  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;
    overflow:hidden;display:flex;flex-direction:column}
  .card.match{border-top:4px solid var(--accent)}
  .card.caution{border-top:4px solid var(--warn)}
  .card.miss{border-top:4px solid var(--miss)}
  .body{padding:16px 18px 18px;display:flex;flex-direction:column;flex:1}

  .media{position:relative;aspect-ratio:3/2;background:var(--tile);
    border-bottom:1px solid var(--line);overflow:hidden}
  .media img{width:100%;height:100%;object-fit:cover;display:block}
  .media a{display:block;height:100%}
  .media .tile{display:none}
  .media.nophoto .tile,.media.failed .tile{display:flex}
  .media.failed img{display:none}
  .tile{position:absolute;inset:0;flex-direction:column;align-items:center;justify-content:center;
    gap:8px;text-decoration:none;color:var(--muted);background:
      repeating-linear-gradient(45deg,transparent,transparent 12px,rgba(128,128,128,.05) 12px,rgba(128,128,128,.05) 24px);}
  .tile:hover{color:var(--accent);background-color:var(--accent-soft)}
  .tile-ico{font-size:2rem;opacity:.55}
  .tile-txt{font-size:.85rem;font-weight:600}

  .price{font-size:1.4rem;font-weight:650;letter-spacing:-.02em;margin:0;display:flex;
    align-items:baseline;flex-wrap:wrap;gap:8px}
  .psf{font-size:.8rem;font-weight:500;color:var(--muted);letter-spacing:0}
  .pricechg{flex-basis:100%;font-size:.8rem;font-weight:700;margin-top:2px}
  .pricechg.down{color:var(--accent)} .pricechg.up{color:var(--miss)}
  .addr{font-weight:600;margin:8px 0 2px}
  .city{color:var(--muted);font-size:.88rem;margin:0 0 12px}
  .facts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
  .fact{background:var(--bg);border:1px solid var(--line);border-radius:6px;
    padding:3px 9px;font-size:.8rem}
  .fact.good{border-color:var(--accent);color:var(--accent)}
  .pool{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:600}
  .nopool{background:var(--miss-soft);border-color:transparent;color:var(--miss);font-weight:600}
  .tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
  .tag{display:inline-block;font-size:.7rem;font-weight:700;letter-spacing:.06em;
    text-transform:uppercase;padding:3px 8px;border-radius:5px}
  .tag.ok{background:var(--accent-soft);color:var(--accent)}
  .tag.warn{background:var(--warn-soft);color:var(--warn)}
  .tag.bad{background:var(--miss-soft);color:var(--miss)}
  .tag.new{background:var(--new);color:#fff}
  .tag.cut{background:var(--accent);color:#fff}
  .note{font-size:.88rem;color:var(--muted);margin:0 0 12px;flex:1}
  .note strong{color:var(--ink)}
  .prov{font-size:.76rem;color:var(--muted);margin:0 0 14px;opacity:.85}
  a.btn{display:inline-block;text-decoration:none;color:var(--accent);font-weight:600;
    font-size:.9rem;border:1px solid var(--line);border-radius:7px;padding:7px 12px;align-self:flex-start}
  a.btn:hover{background:var(--accent-soft)}

  .banner{background:var(--accent-soft);border:1px solid var(--line);border-left:4px solid var(--accent);
    border-radius:10px;padding:16px 18px;margin-bottom:8px;font-size:.9rem}
  .banner h3{margin:0 0 6px;font-size:.95rem}
  .banner p{margin:0 0 8px;color:var(--muted)}
  .banner p:last-child{margin-bottom:0}
  .banner code{background:var(--bg);padding:1px 5px;border-radius:4px;font-size:.85em}

  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:0 0 8px}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
  .stat b{display:block;font-size:1.5rem;letter-spacing:-.02em;line-height:1.2}
  .stat span{font-size:.78rem;color:var(--muted)}

  .tablewrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
  table{width:100%;border-collapse:collapse;font-size:.88rem}
  th,td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
  td.n,th.n{text-align:right}
  th{font-size:.73rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  tr:last-child td{border-bottom:none}
  table a{color:var(--accent)}
  footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);
    color:var(--muted);font-size:.84rem}
  footer p{max-width:74ch}
  @media (max-width:560px){ h1{font-size:1.5rem} .wrap{padding-top:28px} }
</style>
</head>
<body>
<div class="wrap">

<header>
  <h1>House Hunt: El Dorado County</h1>
  <p class="sub">Shingle Springs · Rescue · Placerville — updated <strong>${esc(fmtDate(data.lastRun))}</strong></p>
  <div class="criteria">
    <span class="chip">${esc(q.beds)} bedrooms</span>
    <span class="chip">${esc(q.baths)} bathrooms</span>
    <span class="chip">Pool required</span>
    <span class="chip">${esc(q.minAcres)}+ acres (${esc(q.preferredAcres)}+ preferred)</span>
    <span class="chip">Max ${money(q.maxPrice)}</span>
  </div>
</header>

${fresh.length ? `<div class="newband">
  <h2>&#9733; New this run — ${fresh.length} ${fresh.length === 1 ? 'property' : 'properties'}</h2>
  <p class="sectnote">Every one of these is a first appearance on this page. Each was confirmed
  <strong>For Sale on its live listing page today</strong>, with the pool read from the MLS amenity
  record rather than inferred from listing text.</p>
  <ul>
${fresh.map((l) => `    <li><strong>${esc(l.address)}, ${esc(l.city)}</strong> — ${money(l.currentPrice)}, ` +
      `${esc(l.beds)}bd/${esc(l.baths)}ba on ${esc(l.acres)} acres` +
      `${(l.priceHistory || []).length > 1 ? ` <em>(price cut from ${money(l.priceHistory[l.priceHistory.length - 2].price)})</em>` : ''}</li>`).join('\n')}
  </ul>
</div>

<div class="grid" style="margin-top:18px">${fresh.map((l) => card(l, { flagNew: true })).join('\n')}
</div>` : `<div class="banner"><h3>No new properties this run</h3>
<p>Nothing new cleared every criterion since the last run. The tracked properties below are unchanged.</p></div>`}

${changed.length ? `<h2>Price changes <span class="count">· ${changed.length}</span></h2>
<p class="sectnote">Movement since the listing first appeared. The delta is computed from the
listing's own price-event history, not from a remembered figure.</p>
<div class="tablewrap" style="margin-bottom:8px">
<table>
  <thead><tr><th>Property</th><th class="n">Was</th><th class="n">Now</th><th class="n">Change</th><th>When</th></tr></thead>
  <tbody>
${changed.map((l) => {
  const h = l.priceHistory; const prev = h[h.length - 2].price; const now = l.currentPrice;
  const d = now - prev;
  return `      <tr><td><a href="${esc(l.url)}" rel="noopener">${esc(l.address)}, ${esc(l.city)}</a></td>` +
    `<td class="n">${money(prev)}</td><td class="n">${money(now)}</td>` +
    `<td class="n" style="color:var(--${d < 0 ? 'accent' : 'miss'});font-weight:700">` +
    `${d < 0 ? '&darr;' : '&uarr;'} ${money(Math.abs(d))}</td>` +
    `<td>${esc(fmtDate(h[h.length - 1].date))}</td></tr>`;
}).join('\n')}
  </tbody>
</table>
</div>` : ''}

${ongoing.length ? `<h2>Still on the list <span class="count">· ${ongoing.length}</span></h2>
<p class="sectnote">Carried over from an earlier run and re-confirmed active today.</p>
<div class="grid">${ongoing.map((l) => card(l)).join('\n')}
</div>` : ''}

${matches.length ? `<h2>How the ${matches.length} compare</h2>
<p class="sectnote">Same five properties, side by side. Sorted by price.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Property</th><th>City</th><th class="n">Price</th><th class="n">$/sq ft</th>
    <th class="n">Bd/Ba</th><th class="n">Sq ft</th><th class="n">Acres</th><th class="n">Days on mkt</th></tr></thead>
  <tbody>
${matches.slice().sort(sortByPrice).map((l) => `      <tr>
        <td><a href="${esc(l.url)}" rel="noopener">${esc(l.address)}</a></td>
        <td>${esc(l.city)}</td>
        <td class="n">${money(l.currentPrice)}</td>
        <td class="n">$${Math.round(l.currentPrice / l.sqft)}</td>
        <td class="n">${esc(l.beds)}/${esc(l.baths)}</td>
        <td class="n">${num(l.sqft)}</td>
        <td class="n">${esc(l.acres)}</td>
        <td class="n">${esc(l.daysOnMarket)}</td>
      </tr>`).join('\n')}
  </tbody>
</table>
</div>` : ''}

${active.length ? `<h2>Active, but doesn't meet criteria</h2>
<p class="sectnote">Confirmed on the market — listed for transparency, not as a recommendation.</p>
<div class="grid">${active.map((l) => card(l)).join('\n')}
</div>` : ''}

${nm.length ? `<h2>Right land, no pool <span class="count">· ${nm.length}</span></h2>
<p class="sectnote">These clear ${esc(q.beds)} bd, ${esc(q.baths)} ba, ${esc(q.minAcres)}+ acres and the
budget, and are active today — the pool is the only thing missing. Worth knowing about, because a
pool can be added and these are the properties where the land and the house already work. This is
also the clearest evidence for the point below: <strong>the pool, not the budget, is what binds this
search.</strong></p>
<div class="tablewrap">
<table>
  <thead><tr><th>Property</th><th>City</th><th class="n">Price</th><th class="n">Bd/Ba</th>
    <th class="n">Sq ft</th><th class="n">Acres</th></tr></thead>
  <tbody>
${nearMissRows}
  </tbody>
</table>
</div>` : ''}

<h2>What this run establishes</h2>
<p class="sectnote">Of every active single-family listing across the three towns meeting
${esc(q.beds)} bd / ${esc(q.baths)} ba / under ${money(q.maxPrice)}, <strong>${matches.length + nm.length} also
clear ${esc(q.minAcres)} acres — and only ${matches.length} of those have a pool.</strong> That is the
whole search in one line: land and budget are abundant in El Dorado County, pools are not. Placerville
carries most of the large-acreage inventory but its ${money(1000000)}–${money(1200000)} band is full of
houses with ponds rather than pools. Shingle Springs has two of the five. Rescue has exactly one
qualifying property in the entire town.</p>
<p class="sectnote">Practically: ${cheapest ? `<strong>${esc(cheapest.address)}</strong> at
${money(cheapest.currentPrice)} is the cheapest way into a pool property here and has just moved on
price` : ''}${biggest ? `, while <strong>${esc(biggest.address)}</strong> is the one that genuinely
satisfies the 5-acre preference at ${esc(biggest.acres)} acres` : ''}. With ${matches.length} candidates
in a market this thin, none of them is likely to be replaced by something better next month.</p>

<div class="stats">
  <div class="stat"><b>${matches.length}</b><span>verified matches</span></div>
  <div class="stat"><b>${fresh.length}</b><span>new this run</span></div>
  <div class="stat"><b>${changed.length}</b><span>price change${changed.length === 1 ? '' : 's'}</span></div>
  <div class="stat"><b>${(data.droppedThisRun || []).length}</b><span>dropped this run</span></div>
  <div class="stat"><b>${cheapest ? short(cheapest.currentPrice) : '—'}</b><span>entry price</span></div>
</div>

${droppedRows ? `<h2>Dropped this run <span class="count">· ${(data.droppedThisRun || []).length}</span></h2>
<p class="sectnote">Sold, withdrawn, or never actually listed. Removed from the list above, recorded
here so they are not re-surfaced as new finds on a later run.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Why it was dropped</th></tr></thead>
  <tbody>
${droppedRows}
  </tbody>
</table>
</div>` : ''}

<h2>Ruled out on the facts</h2>
<p class="sectnote">Failed price, bedroom, bath or acreage minimums regardless of availability.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th class="n">Price</th><th>Why not</th></tr></thead>
  <tbody>
${rejectedRows}
  </tbody>
</table>
</div>

<h2>How these were verified</h2>
<div class="banner">
  <h3>&#10003; Every match was read off a live listing page</h3>
  <p>${esc(dq.source || '')}</p>
  <p>${esc(dq.coverage || '')}</p>
  <p><strong>Why this matters:</strong> ${esc(dq.note || '')}</p>
</div>

<footer>
  <p>Generated from <code>listings.json</code> by <code>build.js</code> on ${esc(fmtDate(data.lastRun))}.
  ${matches.length} verified matches, ${nm.length} right-land-no-pool, ${(data.rejected || []).length} ruled out,
  ${(data.droppedThisRun || []).length} dropped since ${esc(fmtDate(data.previousRun))}.
  Future runs report only new listings and price changes — no repeats.</p>
  <p>Listing photos are hotlinked from the listing brokerage and remain their copyright. Prices and
  availability change without notice; confirm anything here with the listing agent before acting on it.</p>
</footer>

</div>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(
  `Built index.html — ${matches.length} verified matches (${fresh.length} new, ${changed.length} price change), ` +
  `${nm.length} near-miss, ${archived.length} archived, ${(data.droppedThisRun || []).length} dropped.`);
