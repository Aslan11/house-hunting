#!/usr/bin/env node
/**
 * Builds index.html from listings.json.
 *
 * Future runs should edit listings.json ONLY, then run `node build.js`.
 *
 * Conventions this build honours:
 *  - `newThisRun` (array of listing ids) drives the highlighted "New this run" band at the top.
 *  - A listing with more than one `priceHistory` entry renders its delta automatically.
 *  - `photos[0]` renders as the card image; if it fails to load in the viewer's browser an
 *    `onerror` handler swaps in a tile linking to the listing instead, so no holes appear.
 *  - Listings that have sold or gone off market should be REMOVED from `listings` and recorded
 *    in `droppedThisRun` so the page can say what disappeared without re-surfacing it.
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (n == null ? '—' : '$' + n.toLocaleString('en-US'));

const TAGS = {
  match:      { cls: 'match',  tag: 'ok',   label: 'Verified match' },
  borderline: { cls: 'caution', tag: 'warn', label: 'Borderline' },
  'off-market': { cls: 'miss', tag: 'bad',  label: 'Off market' },
};

const NEW = new Set(data.newThisRun || []);

function galleryHost(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').split('.')[0]; }
  catch { return 'listing'; }
}

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
  if (l.baths != null) f.push(`<span class="fact">${esc(l.bathDetail || l.baths + ' ba')}</span>`);
  if (l.sqft)  f.push(`<span class="fact">${l.sqft.toLocaleString('en-US')} sqft</span>`);
  if (l.acres) f.push(`<span class="fact${l.acres >= 5 ? ' acres-pref' : ''}">${esc(l.acres)} acres</span>`);
  f.push(l.pool
    ? `<span class="fact pool">${esc(l.poolDetail || 'Pool')}</span>`
    : `<span class="fact nopool">${esc(l.poolDetail || 'No pool')}</span>`);
  if (l.currentPrice && l.sqft) f.push(`<span class="fact">$${Math.round(l.currentPrice / l.sqft)}/sqft</span>`);
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
  const meta = TAGS[l.status] || { cls: 'match', tag: 'ok', label: 'Match' };
  const label = l.badge || meta.label;
  const mls = l.mls ? ` &middot; MLS ${esc(l.mls)}` : '';
  const dom = l.listedDays != null ? ` &middot; ${esc(l.listedDays)} days on market` : '';
  const newBadge = NEW.has(l.id) ? `<span class="tag new">New</span>` : '';
  return `
  <div class="card ${meta.cls}${NEW.has(l.id) ? ' isnew' : ''}">
    ${media(l)}
    <div class="body">
      <div class="tags">${newBadge}<span class="tag ${meta.tag}">${esc(label)}</span></div>
      ${priceBlock(l)}
      <p class="addr">${esc(l.address)}</p>
      <p class="city">${esc(l.city)}, CA ${esc(l.zip)}${mls}${dom}</p>
      <div class="facts">${facts(l)}</div>
      <p class="note">${l.blurb || esc(l.notes)}</p>
      <a class="btn" href="${esc(l.url)}" rel="noopener">View listing &rarr;</a>
    </div>
  </div>`;
}

const byPrice = (a, b) => a.currentPrice - b.currentPrice;
const matches    = data.listings.filter((l) => l.status === 'match').sort(byPrice);
const borderline = data.listings.filter((l) => l.status === 'borderline').sort(byPrice);
const newOnes    = data.listings.filter((l) => NEW.has(l.id)).sort(byPrice);

const rejectedRows = (data.rejected || [])
  .map((r) => `    <tr><td>${esc(r.address)}</td><td>${money(r.price)}</td><td>${esc(r.reason)}</td></tr>`)
  .join('\n');

const nearMissRows = (data.nearMisses || [])
  .map((r) => `    <tr><td><a href="${esc(r.url)}" rel="noopener">${esc(r.address)}</a></td><td>${money(r.price)}</td><td>${esc(r.detail)}</td></tr>`)
  .join('\n');

const droppedRows = (data.droppedThisRun || [])
  .map((r) => `    <tr><td>${esc(r.address)}</td><td>${esc(r.reason)}</td></tr>`)
  .join('\n');

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
    --new:#1f5f8a; --new-soft:#e1eef7; --tile:#ece7de;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#16181a; --card:#1f2225; --ink:#eceae6; --muted:#a09a91;
      --line:#31363a; --accent:#7fc4a1; --accent-soft:#1e2f27;
      --warn:#d9bd6a; --warn-soft:#2e2819; --miss:#e0a08c; --miss-soft:#2e211d;
      --new:#8ec5e8; --new-soft:#172833; --tile:#282c30;
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
  .sectnote{color:var(--muted);font-size:.88rem;margin:0 0 18px}
  .grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;
    overflow:hidden;display:flex;flex-direction:column}
  .card.match{border-top:4px solid var(--accent)}
  .card.caution{border-top:4px solid var(--warn)}
  .card.miss{border-top:4px solid var(--miss)}
  .body{padding:16px 18px 18px;display:flex;flex-direction:column;flex:1}
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
  .city{color:var(--muted);font-size:.86rem;margin:0 0 14px}
  .facts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
  .fact{background:var(--bg);border:1px solid var(--line);border-radius:6px;
    padding:3px 9px;font-size:.8rem}
  .acres-pref{border-color:var(--accent);color:var(--accent);font-weight:600}
  .pool{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:600}
  .nopool{background:var(--miss-soft);border-color:transparent;color:var(--miss);font-weight:600}
  .tags{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}
  .tag{display:inline-block;font-size:.72rem;font-weight:700;letter-spacing:.06em;
    text-transform:uppercase;padding:3px 8px;border-radius:5px;align-self:flex-start}
  .tag.ok{background:var(--accent-soft);color:var(--accent)}
  .tag.warn{background:var(--warn-soft);color:var(--warn)}
  .tag.bad{background:var(--miss-soft);color:var(--miss)}
  .tag.new{background:var(--new);color:#fff}
  .note{font-size:.88rem;color:var(--muted);margin:0 0 16px;flex:1}
  .note strong{color:var(--ink)}
  a.btn{display:inline-block;text-decoration:none;color:var(--accent);font-weight:600;
    font-size:.9rem;border:1px solid var(--line);border-radius:7px;padding:7px 12px;align-self:flex-start}
  a.btn:hover{background:var(--accent-soft)}
  .newband{background:var(--new-soft);border:1px solid var(--line);border-left:4px solid var(--new);
    border-radius:10px;padding:18px 18px 4px;margin-bottom:12px}
  .newband h2{margin:0 0 4px;color:var(--new)}
  .banner{background:var(--accent-soft);border:1px solid var(--line);border-left:4px solid var(--accent);
    border-radius:10px;padding:16px 18px;margin-bottom:28px;font-size:.9rem}
  .banner h3{margin:0 0 6px;font-size:.95rem}
  .banner p{margin:0 0 8px;color:var(--muted)}
  .banner p:last-child{margin-bottom:0}
  .banner code{background:var(--bg);padding:1px 5px;border-radius:4px;font-size:.85em}
  .tablewrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
  table{width:100%;border-collapse:collapse;font-size:.88rem}
  th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
  td a{color:var(--accent)}
  th{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  tr:last-child td{border-bottom:none}
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

${newOnes.length ? `<div class="newband">
  <h2>&#10022; New this run &mdash; ${newOnes.length} ${newOnes.length === 1 ? 'property' : 'properties'}</h2>
  <p class="sectnote">Everything below is new to this page. The previous run (${esc(data.previousRun || 'earlier')})
  could not reach any live listing source and published no verified matches, so this is the first
  real result set.</p>
</div>
<div class="grid">${newOnes.map(card).join('\n')}
</div>` : `<div class="newband"><h2>No new properties this run</h2>
  <p class="sectnote">Nothing new cleared the criteria since the last run.</p></div>`}

<div class="banner" style="margin-top:34px">
  <h3>&#10003; Where this data comes from</h3>
  <p>${esc(data.dataQuality.source)}</p>
  <p>${esc(data.dataQuality.coverage)}</p>
  <p>${esc(data.dataQuality.note)}</p>
</div>

${matches.length ? `<h2>All verified matches</h2>
<p class="sectnote">Confirmed Active on the MLS feed and meeting every hard criterion. Sorted by price.
Acreage chips are outlined where the lot clears the 5-acre preference.</p>
<div class="grid">${matches.map(card).join('\n')}
</div>` : ''}

${borderline.length ? `<h2>Borderline &mdash; your call</h2>
<p class="sectnote">Clears most of the criteria but something is arguable. Shown so the decision is
yours rather than a filter's.</p>
<div class="grid">${borderline.map(card).join('\n')}
</div>` : ''}

${nearMissRows ? `<h2>Near misses</h2>
<p class="sectnote">Active and attractive, but one criterion fails. Worth knowing about in case a
requirement flexes.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Price</th><th>Why it misses</th></tr></thead>
  <tbody>
${nearMissRows}
  </tbody>
</table>
</div>` : ''}

${droppedRows ? `<h2>Dropped this run</h2>
<p class="sectnote">Carried over from the previous run and no longer in the active MLS feed. Removed
from the list so they are not re-surfaced.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Why it was dropped</th></tr></thead>
  <tbody>
${droppedRows}
  </tbody>
</table>
</div>` : ''}

<h2>Checked and ruled out</h2>
<p class="sectnote">Active listings in the three towns that were examined this run and failed on
price, acreage or the pool requirement.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Price</th><th>Why not</th></tr></thead>
  <tbody>
${rejectedRows}
  </tbody>
</table>
</div>

<h2>What the market looks like right now</h2>
<p class="sectnote"><strong>The pool is still the binding constraint, and Placerville is where the
inventory is.</strong> Across all three towns there are 20 active listings with 4+ bedrooms, 3+
bathrooms, 2.5+ acres and a price at or under $1.5M — and only 8 of them have a pool. Seven of those
eight are in Placerville. <strong>Rescue has exactly one</strong> (3720 Four Springs Dr) and
<strong>Shingle Springs has none at all</strong>: its entire active inventory is 44 listings, and
every pool property on acreage there starts at $1.63M. The budget is not the problem — at $789K,
4770 Feldspar Ln clears every requirement with $700K to spare. Long days-on-market on several of
these (103, 138, 148, 154 days) suggests room to negotiate.</p>

<footer>
  <p>Generated from <code>listings.json</code> by <code>build.js</code>.
  ${data.listings.length} properties on file, ${matches.length} verified matches,
  ${borderline.length} borderline, ${(data.rejected || []).length} ruled out,
  ${photoCount}/${data.listings.length} with photos.
  Future runs flag only new listings and price changes — no repeats.</p>
</footer>

</div>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`Built index.html — ${matches.length} verified matches, ${borderline.length} borderline, ` +
            `${newOnes.length} new this run, ${photoCount}/${data.listings.length} with photos.`);
