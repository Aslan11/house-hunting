#!/usr/bin/env node
/**
 * Builds index.html from listings.json.
 *
 * Future runs should edit listings.json ONLY, then run `node build.js`.
 * Anything whose `firstSeen` equals `lastRun` is rendered as new and called out at
 * the top of the page. A listing with more than one `priceHistory` entry renders its
 * price delta automatically.
 * Photos: add URLs to a listing's `photos` array and they render automatically. If
 * `photos` is empty, the card falls back to a "View photos" tile pointing at
 * `gallery` (or `url`). If a hotlinked photo fails to load in the browser, the same
 * tile is swapped in client-side, so a dead image URL never leaves a hole.
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (n == null ? '—' : '$' + n.toLocaleString('en-US'));

const isNew = (l) => l.firstSeen === data.lastRun;

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
  if (l.beds != null)  f.push(`<span class="fact">${esc(l.beds)} bd</span>`);
  if (l.baths != null) f.push(`<span class="fact">${esc(l.baths)} ba</span>`);
  if (l.sqft)  f.push(`<span class="fact">${l.sqft.toLocaleString('en-US')} sqft</span>`);
  if (l.acres) f.push(`<span class="fact ${l.acres >= 5 ? 'land' : ''}">${esc(l.acres)} acres</span>`);
  if (l.yearBuilt) f.push(`<span class="fact">built ${esc(l.yearBuilt)}</span>`);
  if (l.garage) f.push(`<span class="fact">${esc(l.garage)}-car garage</span>`);
  f.push(l.pool
    ? `<span class="fact pool">${esc(l.poolDetail || 'Pool')}</span>`
    : `<span class="fact nopool">${esc(l.poolDetail || 'No pool')}</span>`);
  return f.join('');
}

function priceBlock(l) {
  const hist = l.priceHistory || [];
  if (hist.length > 1) {
    const prev = hist[hist.length - 2].price;
    const now  = l.currentPrice;
    const down = now < prev;
    const delta = Math.abs(now - prev);
    return `<p class="price">${money(now)}` +
      `<span class="pricechg ${down ? 'down' : 'up'}">` +
      `${down ? '&darr;' : '&uarr;'} ${money(delta)} from ${money(prev)}</span></p>`;
  }
  return `<p class="price">${money(l.currentPrice)}</p>`;
}

function card(l) {
  const mls = l.mls ? ` &middot; MLS ${esc(l.mls)}` : '';
  const flags = (l.flags || []).length
    ? `<ul class="flags">${l.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`
    : '';
  const ppa = l.acres ? ` &middot; ${money(Math.round(l.currentPrice / l.acres))}/acre` : '';
  const v = l.verification || {};
  return `
  <div class="card match${isNew(l) ? ' isnew' : ''}">
    ${media(l)}
    <div class="body">
      <span class="tag ${isNew(l) ? 'new' : 'ok'}">${isNew(l) ? 'New this run' : 'Tracked'}</span>
      ${priceBlock(l)}
      <p class="addr">${esc(l.address)}</p>
      <p class="city">${esc(l.city)}, CA ${esc(l.zip)}${mls}${ppa}</p>
      <div class="facts">${facts(l)}</div>
      <p class="note">${esc(l.blurb)}</p>
      ${flags}
      <details class="verify">
        <summary>Verification</summary>
        <p><strong>Live listing page:</strong> ${esc(v.primary)}</p>
        <p><strong>Second source:</strong> ${esc(v.second)}</p>
        <p class="checked">Checked ${esc(v.checked)}</p>
      </details>
      <a class="btn" href="${esc(l.url)}" rel="noopener">View listing &rarr;</a>
    </div>
  </div>`;
}

const all        = data.listings.filter((l) => l.status === 'match');
const newOnes    = all.filter(isNew);
const continuing = all.filter((l) => !isNew(l));
const cuts       = all.filter((l) => (l.priceHistory || []).length > 1 &&
                                     l.currentPrice < l.priceHistory[l.priceHistory.length - 2].price);

const sortByPrice = (a, b) => a.currentPrice - b.currentPrice;
all.sort(sortByPrice); newOnes.sort(sortByPrice); continuing.sort(sortByPrice);

const nm = data.nearMisses || { poolButSmallLot: [], acreageButNoPool: [] };

const nmRows = (rows) => rows.map((r) => `    <tr>` +
  `<td><a href="${esc(r.url)}" rel="noopener">${esc(r.address)}</a></td>` +
  `<td>${money(r.price)}</td>` +
  `<td>${esc(r.beds)}/${esc(r.baths)}</td>` +
  `<td>${esc(r.acres)}</td>` +
  `<td>${r.pool ? 'Yes' : 'No'}</td>` +
  `<td>${esc(r.mls)}</td></tr>`).join('\n');

const droppedRows = (data.dropped || []).map((r) => `    <tr>` +
  `<td>${esc(r.address)}</td><td>${esc(r.mls || '—')}</td><td>${esc(r.reason)}</td></tr>`).join('\n');

const photoCount = all.filter((l) => l.photos && l.photos.length).length;

const newBanner = newOnes.length ? `
<div class="banner new">
  <h3>&#10022; ${newOnes.length} new ${newOnes.length === 1 ? 'listing' : 'listings'} this run</h3>
  <p>${newOnes.map((l) =>
      `<a href="#${esc(l.id)}">${esc(l.address)}, ${esc(l.city)}</a> &mdash; ${money(l.currentPrice)}, ` +
      `${esc(l.beds)}bd/${esc(l.baths)}ba, ${esc(l.acres)} ac`).join('<br>')}</p>
  ${cuts.length ? `<p class="cuts"><strong>Price cuts:</strong> ${cuts.map((l) =>
      `${esc(l.address)} ${money(l.priceHistory[l.priceHistory.length - 2].price)} &rarr; ` +
      `<strong>${money(l.currentPrice)}</strong>`).join(' &middot; ')}</p>` : ''}
</div>` : `
<div class="banner">
  <h3>No new listings this run</h3>
  <p>The ${all.length} ${all.length === 1 ? 'property' : 'properties'} below were already on the list
  and are still active. Nothing new cleared the criteria since ${esc(data.previousRun || 'the last run')}.</p>
</div>`;

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
    --new:#2f5b8a; --new-soft:#e4edf6; --tile:#ece7de;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#16181a; --card:#1f2225; --ink:#eceae6; --muted:#a09a91;
      --line:#31363a; --accent:#7fc4a1; --accent-soft:#1e2f27;
      --warn:#d9bd6a; --warn-soft:#2e2819; --miss:#e0a08c; --miss-soft:#2e211d;
      --new:#8fbce4; --new-soft:#1b2733; --tile:#282c30;
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
    overflow:hidden;display:flex;flex-direction:column;scroll-margin-top:16px}
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
  .pricechg{display:block;font-size:.8rem;font-weight:700;margin-top:3px}
  .pricechg.down{color:var(--accent)} .pricechg.up{color:var(--miss)}
  .addr{font-weight:600;margin:6px 0 2px}
  .city{color:var(--muted);font-size:.9rem;margin:0 0 14px}
  .facts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
  .fact{background:var(--bg);border:1px solid var(--line);border-radius:6px;
    padding:3px 9px;font-size:.8rem}
  .pool{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:600}
  .nopool{background:var(--miss-soft);border-color:transparent;color:var(--miss);font-weight:600}
  .land{font-weight:600}
  .tag{display:inline-block;font-size:.72rem;font-weight:700;letter-spacing:.06em;
    text-transform:uppercase;padding:3px 8px;border-radius:5px;margin-bottom:12px;align-self:flex-start}
  .tag.ok{background:var(--accent-soft);color:var(--accent)}
  .tag.new{background:var(--new-soft);color:var(--new)}
  .note{font-size:.88rem;color:var(--muted);margin:0 0 12px}
  .flags{margin:0 0 12px;padding-left:18px;font-size:.84rem;color:var(--warn)}
  .flags li{margin-bottom:3px}
  details.verify{font-size:.82rem;color:var(--muted);margin:0 0 14px;flex:1}
  details.verify summary{cursor:pointer;font-weight:600;color:var(--accent)}
  details.verify p{margin:8px 0 0}
  details.verify .checked{opacity:.75}
  a.btn{display:inline-block;text-decoration:none;color:var(--accent);font-weight:600;
    font-size:.9rem;border:1px solid var(--line);border-radius:7px;padding:7px 12px;align-self:flex-start}
  a.btn:hover{background:var(--accent-soft)}
  .banner{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--muted);
    border-radius:10px;padding:16px 18px;margin-bottom:28px;font-size:.92rem}
  .banner.new{background:var(--new-soft);border-left-color:var(--new)}
  .banner h3{margin:0 0 8px;font-size:1rem}
  .banner p{margin:0 0 8px}
  .banner p:last-child{margin-bottom:0}
  .banner a{color:var(--new);font-weight:600}
  .banner .cuts{border-top:1px solid var(--line);padding-top:8px;font-size:.88rem}
  .tablewrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
  table{width:100%;border-collapse:collapse;font-size:.88rem}
  th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
  th{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  td a{color:var(--accent)}
  tr:last-child td{border-bottom:none}
  footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);
    color:var(--muted);font-size:.84rem}
  footer code{background:var(--card);padding:1px 5px;border-radius:4px}
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
${newBanner}

<h2>Matches &mdash; ${all.length} active</h2>
<p class="sectnote">Every property here clears all five criteria and was confirmed active on
${esc(data.lastRun)} against a live listing page <em>and</em> a second independent source. Cheapest
first. Open &ldquo;Verification&rdquo; on any card to see both sources.</p>
<div class="grid">${all.map((l) => card(l).replace('<div class="card', `<div id="${esc(l.id)}" class="card`)).join('\n')}
</div>

<h2>So close: pool, but the lot is too small</h2>
<p class="sectnote">Active, clears beds, baths and budget, has a pool &mdash; but under 2.5 acres.
Listed in case the acreage floor is negotiable for the right house.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Price</th><th>Bd/Ba</th><th>Acres</th><th>Pool</th><th>MLS</th></tr></thead>
  <tbody>
${nmRows(nm.poolButSmallLot)}
  </tbody>
</table>
</div>

<h2>So close: the land, but no pool</h2>
<p class="sectnote">Active, clears beds, baths, budget <em>and</em> acreage &mdash; just no pool.
${nm.acreageButNoPool.length} of them, several well under budget with room to build one. This is the
market telling you something: in these three towns the pool is the binding constraint, not the money.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Price</th><th>Bd/Ba</th><th>Acres</th><th>Pool</th><th>MLS</th></tr></thead>
  <tbody>
${nmRows(nm.acreageButNoPool)}
  </tbody>
</table>
</div>

<h2>Dropped from the list</h2>
<p class="sectnote">Carried over from the ${esc(data.previousRun || 'previous')} run and no longer
available. Kept here only so a genuine relist is recognised rather than reported as a new find.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>MLS</th><th>Why it's gone</th></tr></thead>
  <tbody>
${droppedRows}
  </tbody>
</table>
</div>

<h2>How this run read the market</h2>
<p class="sectnote">${esc(data.source.method)} That is the whole active inventory for the three
towns, not a search-engine sample of it &mdash; which is what went wrong on
${esc(data.previousRun || 'the previous run')}, when four off-market properties were reported as
matches because their status came from indexed page titles. Of the 313 active listings,
${all.length + nm.poolButSmallLot.length + nm.acreageButNoPool.length} clear 4BR/3BA under $1.5M,
and ${all.length} of those have both the pool and the acreage.</p>

<footer>
  <p>${all.length} verified matches &middot; ${newOnes.length} new this run &middot;
  ${cuts.length} price ${cuts.length === 1 ? 'cut' : 'cuts'} &middot;
  ${photoCount}/${all.length} with photos.
  Generated from <code>listings.json</code> by <code>build.js</code>.
  Future runs flag only new listings and price changes &mdash; no repeats.</p>
  <p>Listing photos and copy are the copyright of the listing brokerages, shown here for private
  reference. Verify price and status with the listing agent before acting.</p>
</footer>

</div>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`Built index.html — ${all.length} matches (${newOnes.length} new, ${cuts.length} price cuts), ` +
            `${nm.poolButSmallLot.length} pool/small-lot, ${nm.acreageButNoPool.length} land/no-pool, ` +
            `${photoCount}/${all.length} with photos.`);
