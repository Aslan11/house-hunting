#!/usr/bin/env node
/**
 * Builds index.html from listings.json.
 *
 * Future runs should edit listings.json ONLY, then run `node build.js`.
 *
 * Photos: add URLs to a listing's `photos` array and they render automatically.
 * If `photos` is empty, the card falls back to a "View photos" tile pointing at
 * `gallery` (or `url`). If a hotlinked photo fails to load in the browser, the
 * same tile is swapped in client-side, so a dead image URL never leaves a hole.
 *
 * "New this run" is derived, not hand-maintained: any listing whose `firstSeen`
 * equals `lastRun` is surfaced in its own section at the top of the page, and
 * any listing whose price moved since the previous entry in `priceHistory` is
 * surfaced there too.
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (n == null ? '—' : '$' + n.toLocaleString('en-US'));

const TAGS = {
  match:                   { cls: 'match',   tag: 'ok',   label: 'Verified active' },
  'active-fails-criteria': { cls: 'caution', tag: 'warn', label: 'Active — fails criteria' },
  'off-market':            { cls: 'miss',    tag: 'bad',  label: 'Off market' },
};

function galleryHost(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').split('.')[0]; }
  catch { return 'listing'; }
}

const isNew = (l) => l.firstSeen === data.lastRun;

function priceDelta(l) {
  const h = l.priceHistory || [];
  if (h.length < 2) return null;
  const prev = h[h.length - 2].price;
  const now = l.currentPrice;
  if (prev == null || now == null || prev === now) return null;
  return { prev, now, down: now < prev, delta: Math.abs(now - prev) };
}

/** Media area: hero photo plus a thumbnail strip, graceful tile when we have none. */
function media(l) {
  const gallery = l.gallery || l.url;
  const host = galleryHost(gallery);
  const tile =
    `<a class="tile" href="${esc(gallery)}" rel="noopener">` +
      `<span class="tile-ico" aria-hidden="true">&#9968;</span>` +
      `<span class="tile-txt">View photos on ${esc(host)} &rarr;</span>` +
    `</a>`;

  const photos = l.photos || [];
  if (!photos.length) return `<div class="media nophoto">${tile}</div>`;

  const hero = `<div class="media">` +
    `<img src="${esc(photos[0])}" alt="${esc(l.address)}, ${esc(l.city)}" loading="lazy" ` +
      `referrerpolicy="no-referrer" ` +
      `onerror="this.closest('.media').classList.add('failed')">` +
    tile +
  `</div>`;

  const rest = photos.slice(1, 4);
  if (!rest.length) return hero;

  const strip = `<div class="strip">` + rest.map((p) =>
    `<a class="thumb" href="${esc(gallery)}" rel="noopener">` +
      `<img src="${esc(p)}" alt="" loading="lazy" referrerpolicy="no-referrer" ` +
      `onerror="this.closest('.thumb').style.display='none'">` +
    `</a>`).join('') + `</div>`;

  return hero + strip;
}

function facts(l) {
  const f = [];
  if (l.beds != null) f.push(`<span class="fact">${esc(l.beds)} bd</span>`);
  if (l.baths != null) {
    const b = l.halfBaths
      ? `${esc(l.fullBaths)} full + ${esc(l.halfBaths)} half ba`
      : `${esc(l.baths)} ba`;
    f.push(`<span class="fact">${b}</span>`);
  }
  if (l.sqft) f.push(`<span class="fact">${l.sqft.toLocaleString('en-US')} sqft</span>`);
  if (l.acres) {
    const pref = l.acres >= (data.criteria.preferredAcres || 5);
    f.push(`<span class="fact${pref ? ' acres-pref' : ''}">${esc(l.acres)} acres</span>`);
  }
  f.push(l.pool
    ? `<span class="fact pool">${esc(l.poolDetail || 'Pool')}</span>`
    : `<span class="fact nopool">${esc(l.poolDetail || 'No pool')}</span>`);
  if (l.yearBuilt) f.push(`<span class="fact">built ${esc(l.yearBuilt)}</span>`);
  if (l.hoa) f.push(`<span class="fact">HOA ${esc(l.hoa)}</span>`);
  return f.join('');
}

function priceBlock(l) {
  const d = priceDelta(l);
  if (!d) return `<p class="price">${money(l.currentPrice)}</p>`;
  return `<p class="price">${money(d.now)}` +
    `<span class="pricechg ${d.down ? 'down' : 'up'}">` +
    `${d.down ? '&darr;' : '&uarr;'} ${money(d.delta)} from ${money(d.prev)}</span></p>`;
}

function card(l, opts = {}) {
  const meta = TAGS[l.status] || { cls: 'match', tag: 'ok', label: 'Match' };
  const label = l.badge || meta.label;
  const mls = l.mls ? ` &middot; MLS ${esc(l.mls)}` : '';
  const flag = opts.flagNew && isNew(l) ? `<span class="tag new">New</span>` : '';
  const ppa = l.currentPrice && l.acres
    ? `<p class="sub2">${money(Math.round(l.currentPrice / l.acres))} per acre</p>` : '';
  const v = l.verified
    ? `<p class="verif" title="${esc(l.verified.method || '')}">&#10003; ${esc(l.verified.statusOnSource)} on ${esc(l.verified.source)} &middot; checked ${esc(l.verified.checkedOn)}</p>`
    : '';
  return `
  <div class="card ${meta.cls}${opts.flagNew && isNew(l) ? ' isnew' : ''}">
    ${media(l)}
    <div class="body">
      <div class="tags">${flag}<span class="tag ${meta.tag}">${esc(label)}</span></div>
      ${priceBlock(l)}
      <p class="addr">${esc(l.address)}</p>
      <p class="city">${esc(l.city)}, CA ${esc(l.zip)}${mls}</p>
      ${ppa}
      <div class="facts">${facts(l)}</div>
      <p class="note">${l.blurb || esc(l.notes)}</p>
      ${v}
      ${l.listingOffice ? `<p class="office">Listed by ${esc(l.listingOffice)}</p>` : ''}
      <a class="btn" href="${esc(l.url)}" rel="noopener">View MLS listing &rarr;</a>
    </div>
  </div>`;
}

const byStatus = (s) => data.listings.filter((l) => l.status === s);
const matches = byStatus('match');
const active = byStatus('active-fails-criteria');
const archived = byStatus('off-market');

const newOnes = data.listings.filter(isNew);
const priceMoves = data.listings.filter((l) => !isNew(l) && priceDelta(l));
const returning = matches.filter((l) => !isNew(l));

const rejectedRows = (data.rejected || [])
  .map((r) => `    <tr><td>${esc(r.address)}</td><td>${money(r.price)}</td>` +
              `<td>${esc(r.mls || '—')}</td><td class="wrapcell">${esc(r.reason)}</td></tr>`)
  .join('\n');

const droppedRows = (data.droppedThisRun || [])
  .map((r) => `    <tr><td>${esc(r.address)}</td><td>${esc(r.city)}</td>` +
              `<td>${esc(r.mls || '—')}</td><td class="wrapcell">${esc(r.reason)}</td></tr>`)
  .join('\n');

const coverageRows = (data.searchesRun || [])
  .map((s) => `    <tr><td>${esc(s.city)}</td><td>${esc(s.activeTotal)}</td>` +
              `<td>${esc(s.withPoolAndAcreage)}</td><td><strong>${esc(s.matches)}</strong></td></tr>`)
  .join('\n');

const crit = data.criteria;
const chips = [
  `${esc(crit.beds)} bedrooms`,
  `${esc(crit.baths)} bathrooms`,
  crit.pool ? 'Pool required' : null,
  `${esc(crit.minAcres)}+ acres (${esc(crit.preferredAcres)}+ preferred)`,
  `Max ${money(crit.maxPrice)}`,
].filter(Boolean).map((c) => `<span class="chip">${c}</span>`).join('\n    ');

const photoCount = data.listings.filter((l) => l.photos && l.photos.length).length;

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
    --warn:#8a6d1f; --warn-soft:#f8f0d8; --miss:#8a4b3a; --miss-soft:#f7e7e2;
    --new:#1d5f8a; --new-soft:#e2eef6; --tile:#ece7de;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#16181a; --card:#1f2225; --ink:#eceae6; --muted:#a09a91;
      --line:#31363a; --accent:#7fc4a1; --accent-soft:#1e2f27;
      --warn:#d9bd6a; --warn-soft:#2e2819; --miss:#e0a08c; --miss-soft:#2e211d;
      --new:#7fb8e0; --new-soft:#1a2833; --tile:#282c30;
    }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  .wrap{max-width:1080px;margin:0 auto;padding:40px 16px 72px}
  header{border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:28px}
  h1{font-size:1.9rem;margin:0 0 8px;letter-spacing:-.02em}
  .sub{color:var(--muted);margin:0}
  .criteria{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
  .chip{background:var(--card);border:1px solid var(--line);border-radius:999px;
    padding:5px 12px;font-size:.82rem;color:var(--muted)}
  h2{font-size:1.15rem;margin:40px 0 6px;letter-spacing:-.01em}
  h2 .count{color:var(--muted);font-weight:500}
  .sectnote{color:var(--muted);font-size:.88rem;margin:0 0 18px}
  .grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;
    overflow:hidden;display:flex;flex-direction:column}
  .card.match{border-top:4px solid var(--accent)}
  .card.caution{border-top:4px solid var(--warn)}
  .card.miss{border-top:4px solid var(--miss)}
  .card.isnew{border-top-color:var(--new);box-shadow:0 0 0 1px var(--new-soft)}
  .body{padding:16px 18px 18px;display:flex;flex-direction:column;flex:1}

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
  .strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));gap:2px;background:var(--line)}
  .strip .thumb{display:block;aspect-ratio:4/3;overflow:hidden}
  .strip .thumb img{width:100%;height:100%;object-fit:cover;display:block}

  .price{font-size:1.45rem;font-weight:650;letter-spacing:-.02em;margin:0}
  .pricechg{display:block;font-size:.8rem;font-weight:700;margin-top:3px}
  .pricechg.down{color:var(--accent)} .pricechg.up{color:var(--miss)}
  .addr{font-weight:600;margin:6px 0 2px}
  .city{color:var(--muted);font-size:.9rem;margin:0}
  .sub2{color:var(--muted);font-size:.8rem;margin:2px 0 0}
  .facts{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0}
  .fact{background:var(--bg);border:1px solid var(--line);border-radius:6px;
    padding:3px 9px;font-size:.8rem}
  .acres-pref{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:600}
  .pool{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:600}
  .nopool{background:var(--miss-soft);border-color:transparent;color:var(--miss);font-weight:600}
  .tags{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
  .tag{display:inline-block;font-size:.72rem;font-weight:700;letter-spacing:.06em;
    text-transform:uppercase;padding:3px 8px;border-radius:5px}
  .tag.ok{background:var(--accent-soft);color:var(--accent)}
  .tag.warn{background:var(--warn-soft);color:var(--warn)}
  .tag.bad{background:var(--miss-soft);color:var(--miss)}
  .tag.new{background:var(--new);color:#fff}
  .note{font-size:.88rem;color:var(--muted);margin:0 0 12px;flex:1}
  .note strong{color:var(--ink)}
  .verif{font-size:.76rem;color:var(--accent);margin:0 0 6px;line-height:1.4}
  .office{font-size:.76rem;color:var(--muted);margin:0 0 12px}
  a.btn{display:inline-block;text-decoration:none;color:var(--accent);font-weight:600;
    font-size:.9rem;border:1px solid var(--line);border-radius:7px;padding:7px 12px;align-self:flex-start}
  a.btn:hover{background:var(--accent-soft)}
  .banner{background:var(--accent-soft);border:1px solid var(--line);border-left:4px solid var(--accent);
    border-radius:10px;padding:16px 18px;margin-bottom:28px;font-size:.9rem}
  .banner h3{margin:0 0 6px;font-size:.95rem}
  .banner p{margin:0 0 8px;color:var(--muted)}
  .banner p:last-child{margin-bottom:0}
  .banner code{background:var(--bg);padding:1px 5px;border-radius:4px;font-size:.85em}
  .tablewrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
  table{width:100%;border-collapse:collapse;font-size:.88rem}
  th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
  td.wrapcell{white-space:normal;min-width:260px;color:var(--muted)}
  th{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  tr:last-child td{border-bottom:none}
  footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);
    color:var(--muted);font-size:.84rem}
  @media (max-width:420px){ .grid{grid-template-columns:1fr} h1{font-size:1.55rem} }
</style>
</head>
<body>
<div class="wrap">

<header>
  <h1>House Hunt: El Dorado County</h1>
  <p class="sub">Shingle Springs · Rescue · Placerville — updated <strong>${esc(data.lastRun)}</strong></p>
  <div class="criteria">
    ${chips}
  </div>
</header>

${newOnes.length ? `<h2 style="margin-top:0">&#9733; New this run <span class="count">(${newOnes.length})</span></h2>
<p class="sectnote">Not on this page before ${esc(data.lastRun)}. Every one was confirmed
<strong>FOR SALE</strong> by reading its MLS listing page, and its acreage and pool come from
structured MLS fields rather than listing prose.</p>
<div class="grid">${newOnes.map((l) => card(l, { flagNew: true })).join('\n')}
</div>` : `<h2 style="margin-top:0">New this run</h2>
<p class="sectnote">Nothing new since the last run.</p>`}

${priceMoves.length ? `<h2>Price changes <span class="count">(${priceMoves.length})</span></h2>
<p class="sectnote">Already tracked, but the price moved since the previous run.</p>
<div class="grid">${priceMoves.map((l) => card(l)).join('\n')}
</div>` : ''}

${returning.length ? `<h2>Still available <span class="count">(${returning.length})</span></h2>
<p class="sectnote">Carried over from an earlier run and re-confirmed active, with no price change.</p>
<div class="grid">${returning.map((l) => card(l)).join('\n')}
</div>` : ''}

<div class="banner">
  <h3>How this run was verified</h3>
  <p>This run reached <strong>MetroList MLS</strong> directly — the MLS that actually covers El
  Dorado County — through its official public search site. That matters because the MLS reports
  <strong>acreage and pool as structured fields</strong> (<code>Lot Size in Acres</code>,
  <code>Has a Pool</code>), so neither is inferred from marketing text, and a listing's status is
  read off its own live page rather than a search-engine summary.</p>
  <p>The method was checked against known answers before being trusted: the MLS numbers for all six
  properties this page tracked in July return <em>&ldquo;Listing Not Found&rdquo;</em>, which matches
  the report that every one of them was off market. Active listings return a page reading
  <em>FOR SALE</em>.</p>
  <p>A broker IDX site (century21.com) was cross-checked for coverage and <strong>omitted all six
  qualifying Placerville properties</strong> — so broker sites are not reliable on their own for this
  search. ${photoCount} of ${data.listings.length} cards carry MLS photos, hotlinked from the MLS
  media server and loaded by your browser.</p>
</div>

<h2>What was searched <span class="count">(${(data.searchesRun || []).reduce((a, s) => a + s.activeTotal, 0)} active listings screened)</span></h2>
<p class="sectnote">Every active single-family listing in each town was screened on price, pool and
acreage at the MLS, then each survivor was opened individually to check beds and full baths.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Town</th><th>Active listings</th><th>Pool + ${esc(crit.minAcres)} acres, in budget</th><th>Full matches</th></tr></thead>
  <tbody>
${coverageRows}
  </tbody>
</table>
</div>

<h2>So close <span class="count">(${(data.rejected || []).length})</span></h2>
<p class="sectnote">Properties that cleared most of the bar. Worth a look if you would flex one
criterion — the bath count on the first one and the acreage on the third are the narrowest misses.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Price</th><th>MLS</th><th>Why not</th></tr></thead>
  <tbody>
${rejectedRows}
  </tbody>
</table>
</div>

${droppedRows ? `<h2>Dropped this run <span class="count">(${(data.droppedThisRun || []).length})</span></h2>
<p class="sectnote">Everything this page tracked in July is gone from the market. Each MLS number now
returns &ldquo;Listing Not Found&rdquo;. Recorded here so a genuine relist is recognised rather than
re-reported as a new find.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Town</th><th>MLS</th><th>Why dropped</th></tr></thead>
  <tbody>
${droppedRows}
  </tbody>
</table>
</div>` : ''}

${active.length ? `<h2>Active, but doesn't meet criteria</h2>
<div class="grid">${active.map((l) => card(l)).join('\n')}
</div>` : ''}

${archived.length ? `<h2>Archive — checked, not available</h2>
<div class="grid">${archived.map((l) => card(l)).join('\n')}
</div>` : ''}

<h2>Reading the market</h2>
<p class="sectnote">The earlier read still holds, and this run finally has the data to state it
precisely: <strong>the pool is the binding constraint, not the budget.</strong> Of
${(data.searchesRun || []).reduce((a, s) => a + s.activeTotal, 0)} active listings across the three
towns, only ${(data.searchesRun || []).reduce((a, s) => a + s.withPoolAndAcreage, 0)} pair a pool
with ${esc(crit.minAcres)}+ acres inside budget, and ${matches.length} of those clear
${esc(crit.beds)}&nbsp;beds and ${esc(crit.baths)} baths. Placerville carries the inventory almost
single-handedly. <strong>Shingle Springs has nothing</strong> — its one pool-and-acreage property in
budget, 7060 Steeple Chase Dr, is a 3-bedroom. Rescue has exactly one qualifying home. If location
inside the three towns is flexible, Placerville is where to look; if Shingle Springs matters, expect
to wait for new inventory or to raise the ceiling.</p>

<footer>
  <p>Generated from <code>listings.json</code> by <code>build.js</code>.
  <strong>${matches.length} verified active matches</strong>, ${newOnes.length} new this run,
  ${(data.rejected || []).length} near misses, ${(data.droppedThisRun || []).length} dropped as off market.
  Source: ${esc((data.dataQuality || {}).source || 'MLS')}.</p>
  <p>MLS photos are the copyright of the listing brokerages and are hotlinked for private use.</p>
</footer>

</div>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`index.html written — ${matches.length} matches (${newOnes.length} new), ` +
  `${priceMoves.length} price changes, ${(data.rejected || []).length} near misses, ` +
  `${(data.droppedThisRun || []).length} dropped.`);
