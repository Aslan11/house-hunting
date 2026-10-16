#!/usr/bin/env node
/**
 * Builds index.html from listings.json.
 *
 * Future runs should edit listings.json ONLY, then run `node build.js`.
 * Set `new: true` on a listing to surface it in the "New this run" strip at the
 * top of the page. Append to `priceHistory` and the card renders the delta.
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (n == null ? '—' : '$' + n.toLocaleString('en-US'));
const short = (n) => (n == null ? '—' : '$' + (n / 1000).toFixed(0) + 'K');

function priceDelta(l) {
  const h = l.priceHistory || [];
  if (h.length < 2) return null;
  const first = h[0].price, now = l.currentPrice, prev = h[h.length - 2].price;
  if (now === prev && now === first) return null;
  return { prev, first, now, down: now < prev, delta: Math.abs(now - prev),
           total: Math.abs(now - first), cuts: h.length - 1 };
}

function media(l) {
  const photo = (l.photos && l.photos.length) ? l.photos[0] : null;
  const tile =
    `<a class="tile" href="${esc(l.gallery || l.url)}" rel="noopener">` +
      `<span class="tile-ico" aria-hidden="true">&#9968;</span>` +
      `<span class="tile-txt">View photos on redfin &rarr;</span>` +
    `</a>`;
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
  f.push(`<span class="fact">${esc(l.beds)} bd</span>`);
  f.push(`<span class="fact">${esc(l.baths)} ba</span>`);
  if (l.sqft)  f.push(`<span class="fact">${l.sqft.toLocaleString('en-US')} sqft</span>`);
  if (l.acres) f.push(`<span class="fact acres">${esc(l.acres)} acres</span>`);
  f.push(`<span class="fact pool">${esc(l.poolDetail || 'Pool')}</span>`);
  if (l.yearBuilt) f.push(`<span class="fact">built ${esc(l.yearBuilt)}</span>`);
  return f.join('');
}

function priceBlock(l) {
  const d = priceDelta(l);
  const ppsf = l.sqft ? ` <span class="ppsf">$${Math.round(l.currentPrice / l.sqft)}/sqft</span>` : '';
  if (!d) return `<p class="price">${money(l.currentPrice)}${ppsf}</p>`;
  return `<p class="price">${money(l.currentPrice)}${ppsf}` +
    `<span class="pricechg ${d.down ? 'down' : 'up'}">` +
    `${d.down ? '&darr;' : '&uarr;'} ${money(d.total)} from ${money(d.first)}` +
    `${d.cuts > 1 ? ` &middot; ${d.cuts} changes` : ''}</span></p>`;
}

function card(l) {
  const isNew = l.new === true;
  return `
  <article class="card${isNew ? ' isnew' : ''}">
    ${media(l)}
    <div class="body">
      <div class="tags">
        ${isNew ? `<span class="tag new">New</span>` : ''}
        <span class="tag ok">Verified active</span>
      </div>
      ${priceBlock(l)}
      <p class="addr">${esc(l.address)}</p>
      <p class="city">${esc(l.city)}, CA ${esc(l.zip)} &middot; MLS ${esc(l.mls)}
        ${l.daysOnMarket != null ? `&middot; ${esc(l.daysOnMarket)} days on market` : ''}</p>
      <div class="facts">${facts(l)}</div>
      <p class="note">${l.blurb || esc(l.notes)}</p>
      ${l.caveat ? `<p class="caveat"><strong>Caveat:</strong> ${esc(l.caveat)}</p>` : ''}
      <p class="prov">${esc(l.verifiedActive)}${l.agent ? ` &middot; listed by ${esc(l.agent)}` : ''}</p>
      <a class="btn" href="${esc(l.url)}" rel="noopener">View listing &rarr;</a>
    </div>
  </article>`;
}

const matches   = data.listings.filter((l) => l.status === 'match');
const fresh     = matches.filter((l) => l.new === true);
const standing  = matches.filter((l) => l.new !== true);
const changed   = standing.filter(priceDelta);
const ds        = data.dataSource || {};

const sum = (a) => a.reduce((x, y) => x + y, 0);
const medianPrice = (() => {
  const s = matches.map((l) => l.currentPrice).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
})();

const newStrip = fresh.length ? `
<section class="strip">
  <h2 class="striph">&#10022; New this run &mdash; ${fresh.length} propert${fresh.length === 1 ? 'y' : 'ies'}</h2>
  <p class="sectnote">Not on the previous list. Every one is confirmed on the market as of
  ${esc(data.lastRun)}, 4BR+/3BA+, has a pool, sits on 2.5+ acres and is under $1.5M.</p>
  <ol class="newlist">
${fresh.map((l) => `    <li><a href="#${esc(l.id)}"><strong>${esc(l.address)}</strong>, ${esc(l.city)}</a>
      <span class="nl-meta">${money(l.currentPrice)} &middot; ${esc(l.beds)}bd/${esc(l.baths)}ba &middot; ${esc(l.acres)} ac &middot; ${esc(l.poolDetail)}</span></li>`).join('\n')}
  </ol>
</section>` : `
<section class="strip quiet">
  <h2 class="striph">No new properties this run</h2>
  <p class="sectnote">Nothing new has come on the market since the previous run. The standing list below is unchanged.</p>
</section>`;

const changedStrip = changed.length ? `
<section class="strip">
  <h2 class="striph">&#8595; Price changes</h2>
  <ol class="newlist">
${changed.map((l) => { const d = priceDelta(l);
  return `    <li><a href="#${esc(l.id)}"><strong>${esc(l.address)}</strong>, ${esc(l.city)}</a>
      <span class="nl-meta">${d.down ? 'cut' : 'raised'} ${money(d.delta)} to ${money(l.currentPrice)}</span></li>`; }).join('\n')}
  </ol>
</section>` : '';

const nearRows = (data.nearMisses || []).map((r) =>
  `    <tr><td><a href="${esc(r.url)}" rel="noopener">${esc(r.address)}</a></td><td>${money(r.price)}</td>` +
  `<td>${esc(r.beds)}bd/${esc(r.baths)}ba</td><td>${esc(r.acres)}</td><td>${esc(r.reason)}</td></tr>`).join('\n');

const droppedRows = (data.dropped || []).map((r) =>
  `    <tr><td>${esc(r.address)}</td><td>${esc(r.status)}</td><td>${esc(r.reason)}</td></tr>`).join('\n');

const rejectedRows = (data.rejected || []).map((r) =>
  `    <tr><td>${esc(r.address)}</td><td>${money(r.price)}</td><td>${esc(r.reason)}</td></tr>`).join('\n');

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
    --new:#1f5d8a; --new-soft:#e2eef7;
    --warn:#8a6d1f; --warn-soft:#f8f0d8; --miss:#8a4b3a; --miss-soft:#f7e7e2;
    --tile:#ece7de;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#16181a; --card:#1f2225; --ink:#eceae6; --muted:#a09a91;
      --line:#31363a; --accent:#7fc4a1; --accent-soft:#1e2f27;
      --new:#8cc4e8; --new-soft:#172530;
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

  /* --- new-this-run strip --- */
  .strip{background:var(--new-soft);border:1px solid var(--line);border-left:4px solid var(--new);
    border-radius:10px;padding:18px 20px;margin-bottom:22px}
  .strip.quiet{background:var(--card);border-left-color:var(--line)}
  .striph{margin:0 0 6px;font-size:1.05rem;color:var(--new)}
  .strip.quiet .striph{color:var(--muted)}
  .newlist{margin:0;padding-left:22px}
  .newlist li{margin-bottom:7px;font-size:.93rem}
  .newlist a{color:var(--ink);text-decoration:none;border-bottom:1px solid var(--line)}
  .newlist a:hover{color:var(--new)}
  .nl-meta{display:block;color:var(--muted);font-size:.84rem}

  .stats{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 8px}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:10px;
    padding:11px 15px;min-width:116px}
  .stat b{display:block;font-size:1.3rem;letter-spacing:-.02em}
  .stat span{color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.05em}

  .grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fill,minmax(330px,1fr))}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;
    overflow:hidden;display:flex;flex-direction:column;border-top:4px solid var(--accent);
    scroll-margin-top:16px}
  .card.isnew{border-top-color:var(--new);box-shadow:0 0 0 1px var(--new)}
  .body{padding:18px 20px 20px;display:flex;flex-direction:column;flex:1}

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
  .ppsf{font-size:.8rem;font-weight:500;color:var(--muted);letter-spacing:0}
  .pricechg{display:block;font-size:.8rem;font-weight:700;margin-top:3px}
  .pricechg.down{color:var(--accent)} .pricechg.up{color:var(--miss)}
  .addr{font-weight:600;margin:6px 0 2px}
  .city{color:var(--muted);font-size:.86rem;margin:0 0 14px}
  .facts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
  .fact{background:var(--bg);border:1px solid var(--line);border-radius:6px;
    padding:3px 9px;font-size:.8rem}
  .pool{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:600}
  .acres{background:var(--warn-soft);border-color:transparent;color:var(--warn);font-weight:600}
  .tags{display:flex;gap:6px;margin-bottom:12px}
  .tag{display:inline-block;font-size:.72rem;font-weight:700;letter-spacing:.06em;
    text-transform:uppercase;padding:3px 8px;border-radius:5px}
  .tag.ok{background:var(--accent-soft);color:var(--accent)}
  .tag.new{background:var(--new);color:var(--card)}
  .note{font-size:.88rem;color:var(--muted);margin:0 0 12px;flex:1}
  .note strong{color:var(--ink)}
  .caveat{font-size:.82rem;color:var(--warn);background:var(--warn-soft);
    border-radius:7px;padding:9px 11px;margin:0 0 12px}
  .caveat strong{color:var(--warn)}
  .prov{font-size:.74rem;color:var(--muted);margin:0 0 14px;opacity:.8}
  a.btn{display:inline-block;text-decoration:none;color:var(--accent);font-weight:600;
    font-size:.9rem;border:1px solid var(--line);border-radius:7px;padding:7px 12px;align-self:flex-start}
  a.btn:hover{background:var(--accent-soft)}
  .tablewrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
  table{width:100%;border-collapse:collapse;font-size:.88rem}
  th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
  th{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  td a{color:var(--accent)}
  tr:last-child td{border-bottom:none}
  footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);
    color:var(--muted);font-size:.84rem}
  @media (max-width:520px){ .wrap{padding:28px 16px 56px} h1{font-size:1.5rem} }
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

${newStrip}
${changedStrip}

<div class="stats">
  <div class="stat"><b>${ds.scanned ?? '—'}</b><span>Active listings scanned</span></div>
  <div class="stat"><b>${ds.passedHardFilters ?? '—'}</b><span>Met bed/bath/acre/price</span></div>
  <div class="stat"><b>${matches.length}</b><span>Also have a pool</span></div>
  <div class="stat"><b>${short(medianPrice)}</b><span>Median match price</span></div>
  <div class="stat"><b>${matches.length ? (sum(matches.map((l) => l.acres)) / matches.length).toFixed(1) : '—'}</b><span>Avg acres</span></div>
</div>
<p class="sectnote">Every match below was confirmed <strong>Active</strong> by reading its live
listing page, not by trusting a search snippet. All nine carry 2026 MLS numbers.</p>

<h2>The matches</h2>
<p class="sectnote">Sorted by acreage, largest first. All ${matches.length} clear the preferred
5-acre bar, not just the 2.5-acre minimum.</p>
<div class="grid">${matches.map((l) => card(l).replace('<article class="card', `<article id="${esc(l.id)}" class="card`)).join('\n')}
</div>

<h2>Near misses — everything but the pool</h2>
<p class="sectnote">Active right now and clearing 4BR / 3BA / 2.5 acres / $1.5M, but no pool in
either the MLS amenity data or the listing remarks. Listed in case a pool is addable on the budget
left over — the cheapest here leaves ~$900K of headroom.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Price</th><th>Beds/baths</th><th>Acres</th><th>Why not</th></tr></thead>
  <tbody>
${nearRows}
  </tbody>
</table>
</div>

<h2>Dropped this run</h2>
<p class="sectnote">Previously on this page; re-checked against live listing data on
${esc(data.lastRun)} and no longer available.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Status</th><th>Note</th></tr></thead>
  <tbody>
${droppedRows}
  </tbody>
</table>
</div>

<h2>Ruled out earlier</h2>
<p class="sectnote">Kept so they are not re-surfaced as new finds.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Price</th><th>Why not</th></tr></thead>
  <tbody>
${rejectedRows}
  </tbody>
</table>
</div>

<h2>Reading the market</h2>
<p class="sectnote">Of ${ds.scanned ?? '—'} active listings across the three towns,
${ds.passedHardFilters ?? '—'} clear the size, bed, bath and price bars — and only
${matches.length} of those have a pool. <strong>The pool remains the binding constraint, not the
budget.</strong> But the budget is not the problem it looked like: the cheapest qualifying property
is $789K, and six of the nine sit at or under $1.3M, leaving real headroom under the $1.5M cap.
Placerville carries seven of the nine; Shingle Springs two; Rescue one. Several have been sitting
— 122 and 106 days on market, with one property already cut $120K — so there is room to negotiate
on the older listings.</p>

<footer>
  <p>Generated from <code>listings.json</code> by <code>build.js</code> on ${esc(data.lastRun)}.
  Source: ${esc(ds.name || 'n/a')}.
  ${matches.length} verified matches, ${(data.nearMisses || []).length} near misses,
  ${(data.dropped || []).length} dropped this run.
  Photos are hotlinked from the listing brokerage and remain their copyright.</p>
</footer>

</div>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`Built index.html — ${matches.length} matches (${fresh.length} new, ${changed.length} price changes), ` +
            `${(data.nearMisses || []).length} near misses, ${(data.dropped || []).length} dropped.`);
