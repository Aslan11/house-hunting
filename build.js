#!/usr/bin/env node
/**
 * Builds index.html from listings.json.
 *
 * Future runs should edit listings.json ONLY, then run `node build.js`.
 *
 * Conventions this file relies on:
 *   - listings[].isNew      -> card gets a NEW ribbon and is repeated in the top section
 *   - listings[].priceHistory with >1 entry -> price-change delta renders automatically
 *   - listings[].caveats[]  -> rendered as a visible warning block on the card
 *   - listings[].photos[]   -> first photo is the card image; a dead URL falls back to a
 *                              "View photos" tile client-side, so it never leaves a hole.
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (n == null ? '—' : '$' + n.toLocaleString('en-US'));
const num = (n) => (n == null ? '—' : n.toLocaleString('en-US'));

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
    (l.isNew ? `<span class="ribbon">New</span>` : '') +
    tile +
  `</div>`;
}

/** Small strip of extra photos under the hero image. */
function thumbs(l) {
  const rest = (l.photos || []).slice(1, 5);
  if (!rest.length) return '';
  return `<div class="thumbs">` + rest.map((p) =>
    `<a href="${esc(l.gallery || l.url)}" rel="noopener">` +
    `<img src="${esc(p)}" alt="" loading="lazy" referrerpolicy="no-referrer" ` +
    `onerror="this.parentNode.remove()"></a>`).join('') + `</div>`;
}

function facts(l) {
  const f = [];
  if (l.beds != null)  f.push(`<span class="fact">${esc(l.beds)} bd</span>`);
  if (l.bathsLabel || l.baths != null) f.push(`<span class="fact">${esc(l.bathsLabel || l.baths + ' ba')}</span>`);
  if (l.sqft)  f.push(`<span class="fact">${num(l.sqft)} sqft</span>`);
  if (l.acres) f.push(`<span class="fact acres">${esc(l.acres)} acres</span>`);
  if (l.yearBuilt) f.push(`<span class="fact">built ${esc(l.yearBuilt)}</span>`);
  if (l.horse) f.push(`<span class="fact">horse property</span>`);
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

function verifyLine(l) {
  if (l.verified) {
    return `<p class="verify ok">&#10003; <strong>${esc(l.mlsStatus || 'Active')}</strong> on MetroList` +
      (l.mlsUrl ? ` &middot; <a href="${esc(l.mlsUrl)}" rel="noopener">MLS record</a>` : '') + `</p>`;
  }
  return `<p class="verify warn">&#9888; Status not confirmed on MetroListPRO &mdash; see note</p>`;
}

function caveatBlock(l) {
  if (!l.caveats || !l.caveats.length) return '';
  return `<div class="caveat">` +
    l.caveats.map((c) => `<p>${esc(c)}</p>`).join('') + `</div>`;
}

function card(l) {
  const mls = l.mls ? ` &middot; MLS ${esc(l.mls)}` : '';
  return `
  <div class="card match${l.isNew ? ' isnew' : ''}">
    ${media(l)}
    <div class="body">
      ${priceBlock(l)}
      <p class="addr">${esc(l.address)}</p>
      <p class="city">${esc(l.city)}, CA ${esc(l.zip)}${mls}</p>
      ${verifyLine(l)}
      <div class="facts">${facts(l)}</div>
      ${thumbs(l)}
      <p class="note">${esc(l.blurb)}</p>
      ${caveatBlock(l)}
      ${l.office ? `<p class="office">Listed by ${esc(l.office)}</p>` : ''}
      <a class="btn" href="${esc(l.url)}" rel="noopener">View listing &rarr;</a>
    </div>
  </div>`;
}

const listings = data.listings || [];
const fresh = listings.filter((l) => l.isNew);
const priceChanged = listings.filter((l) => (l.priceHistory || []).length > 1);
const near = data.nearMisses || [];
const dropped = data.dropped || [];

const nearRows = near.map((n) =>
  `    <tr><td><a href="${esc(n.url)}" rel="noopener">${esc(n.address)}</a></td>` +
  `<td>${esc(n.city)}</td><td>${money(n.price)}</td>` +
  `<td>${esc(n.beds)} bd / ${esc(n.baths)}</td>` +
  `<td>${esc(n.acres)}</td><td class="${n.pool ? 'yes' : 'no'}">${esc(n.why)}</td></tr>`).join('\n');

const droppedRows = dropped.map((d) =>
  `    <tr><td>${esc(d.address)}</td><td>${esc(d.city)}</td><td>${money(d.lastPrice)}</td>` +
  `<td>${esc(d.reason)}</td></tr>`).join('\n');

const rejectedRows = (data.rejected || []).map((r) =>
  `    <tr><td>${esc(r.address)}</td><td>${money(r.price)}</td><td>${esc(r.reason)}</td></tr>`).join('\n');

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
    --warn:#8a6d1f; --warn-soft:#f8f0d8; --miss:#8a4b3a; --miss-soft:#f7e7e2;
    --tile:#ece7de; --new:#b8462c;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#16181a; --card:#1f2225; --ink:#eceae6; --muted:#a09a91;
      --line:#31363a; --accent:#7fc4a1; --accent-soft:#1e2f27;
      --warn:#d9bd6a; --warn-soft:#2e2819; --miss:#e0a08c; --miss-soft:#2e211d;
      --tile:#282c30; --new:#e8825f;
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
  .chip.changed{border-color:var(--new);color:var(--new);font-weight:600}
  h2{font-size:1.15rem;margin:44px 0 6px;letter-spacing:-.01em}
  h2:first-of-type{margin-top:8px}
  .sectnote{color:var(--muted);font-size:.88rem;margin:0 0 18px}
  .grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fill,minmax(330px,1fr))}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;
    overflow:hidden;display:flex;flex-direction:column}
  .card.match{border-top:4px solid var(--accent)}
  .card.isnew{border-top-color:var(--new);box-shadow:0 0 0 2px rgba(184,70,44,.14)}
  .body{padding:18px 20px 20px;display:flex;flex-direction:column;flex:1}

  /* --- media --- */
  .media{position:relative;aspect-ratio:3/2;background:var(--tile);
    border-bottom:1px solid var(--line);overflow:hidden}
  .media img{width:100%;height:100%;object-fit:cover;display:block}
  .media .tile{display:none}
  .media.nophoto .tile,.media.failed .tile{display:flex}
  .media.failed img{display:none}
  .media.failed .ribbon{display:none}
  .tile{position:absolute;inset:0;flex-direction:column;align-items:center;justify-content:center;
    gap:8px;text-decoration:none;color:var(--muted);background:
      repeating-linear-gradient(45deg,transparent,transparent 12px,rgba(128,128,128,.05) 12px,rgba(128,128,128,.05) 24px);}
  .tile:hover{color:var(--accent);background-color:var(--accent-soft)}
  .tile-ico{font-size:2rem;opacity:.55}
  .tile-txt{font-size:.85rem;font-weight:600}
  .ribbon{position:absolute;top:12px;left:12px;background:var(--new);color:#fff;
    font-size:.68rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;
    padding:4px 10px;border-radius:5px;box-shadow:0 1px 4px rgba(0,0,0,.25)}
  .thumbs{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:0 0 14px}
  .thumbs img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:5px;display:block}

  .price{font-size:1.45rem;font-weight:650;letter-spacing:-.02em;margin:0}
  .pricechg{display:block;font-size:.8rem;font-weight:700;margin-top:3px}
  .pricechg.down{color:var(--accent)} .pricechg.up{color:var(--miss)}
  .addr{font-weight:600;margin:6px 0 2px}
  .city{color:var(--muted);font-size:.9rem;margin:0 0 8px}
  .verify{font-size:.8rem;margin:0 0 12px}
  .verify.ok{color:var(--accent)}
  .verify.warn{color:var(--warn);font-weight:600}
  .verify a{color:inherit}
  .facts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
  .fact{background:var(--bg);border:1px solid var(--line);border-radius:6px;
    padding:3px 9px;font-size:.8rem}
  .acres{font-weight:600}
  .pool{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:600}
  .nopool{background:var(--miss-soft);border-color:transparent;color:var(--miss);font-weight:600}
  .note{font-size:.88rem;color:var(--muted);margin:0 0 14px;flex:1}
  .caveat{background:var(--warn-soft);border-left:3px solid var(--warn);border-radius:6px;
    padding:10px 12px;margin:0 0 14px;font-size:.82rem}
  .caveat p{margin:0 0 6px}
  .caveat p:last-child{margin-bottom:0}
  .office{font-size:.78rem;color:var(--muted);margin:0 0 14px}
  a.btn{display:inline-block;text-decoration:none;color:var(--accent);font-weight:600;
    font-size:.9rem;border:1px solid var(--line);border-radius:7px;padding:7px 12px;align-self:flex-start}
  a.btn:hover{background:var(--accent-soft)}
  .banner{background:var(--accent-soft);border:1px solid var(--line);border-left:4px solid var(--accent);
    border-radius:10px;padding:16px 18px;margin-bottom:8px;font-size:.9rem}
  .banner.new{background:transparent;border-left-color:var(--new)}
  .banner h3{margin:0 0 6px;font-size:.95rem}
  .banner p{margin:0 0 8px;color:var(--muted)}
  .banner p:last-child{margin-bottom:0}
  .banner code{background:var(--bg);padding:1px 5px;border-radius:4px;font-size:.85em}
  .newlist{margin:10px 0 0;padding:0;list-style:none;display:grid;gap:7px}
  .newlist li{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;
    padding-bottom:7px;border-bottom:1px dashed var(--line)}
  .newlist li:last-child{border-bottom:none;padding-bottom:0}
  .newlist a{color:var(--ink);font-weight:600;text-decoration:none}
  .newlist a:hover{color:var(--accent)}
  .newlist .np{color:var(--new);font-weight:700}
  .newlist .nm{color:var(--muted);font-size:.85rem}
  .tablewrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
  table{width:100%;border-collapse:collapse;font-size:.88rem}
  th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
  td:last-child{white-space:normal;min-width:220px}
  th{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  tr:last-child td{border-bottom:none}
  td a{color:var(--accent)}
  .yes{color:var(--accent);font-weight:600}
  .no{color:var(--muted)}
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
    <span class="chip changed">4+ bedrooms</span>
    <span class="chip">3+ bathrooms</span>
    <span class="chip">Pool required</span>
    <span class="chip">2.5+ acres (5+ preferred)</span>
    <span class="chip">Max $1.5M</span>
  </div>
</header>

${fresh.length ? `<div class="banner new">
  <h3>&#10023; ${fresh.length} new since ${esc(data.previousRun)}</h3>
  <p>Everything on this page is new. The previous run had no verified listings at all — it could not
  reach any listing site, so it published an archive of unverified properties instead. Network access
  is working again, so this run read the live MLS directly and the page has been rebuilt from scratch.</p>
  <ul class="newlist">
${fresh.map((l) => `    <li><span class="np">${money(l.currentPrice)}</span>` +
  `<a href="#${esc(l.id)}">${esc(l.address)}, ${esc(l.city)}</a>` +
  `<span class="nm">${esc(l.acres)} ac &middot; ${esc(l.beds)} bd &middot; ${esc(l.bathsLabel)}` +
  `${l.caveats && l.caveats.length ? ' &middot; <strong>has a caveat</strong>' : ''}</span></li>`).join('\n')}
  </ul>
</div>` : `<div class="banner">
  <h3>No new listings since ${esc(data.previousRun)}</h3>
  <p>Nothing new cleared the criteria this run.</p>
</div>`}

${priceChanged.length ? `<div class="banner">
  <h3>Price changes</h3>
  <ul class="newlist">
${priceChanged.map((l) => {
  const h = l.priceHistory; const prev = h[h.length - 2].price;
  const down = l.currentPrice < prev;
  return `    <li><span class="np">${money(l.currentPrice)}</span>` +
    `<a href="#${esc(l.id)}">${esc(l.address)}, ${esc(l.city)}</a>` +
    `<span class="nm">${down ? '&darr; down' : '&uarr; up'} ${money(Math.abs(l.currentPrice - prev))} ` +
    `from ${money(prev)}</span></li>`;
}).join('\n')}
  </ul>
</div>` : ''}

<h2>Matches — ${listings.length}</h2>
<p class="sectnote">4+ bed, 3+ bath, pool, 2.5+ acres, at or under $1.5M, and confirmed on the market.
Sorted by lot size.</p>
<div class="grid">${listings.map((l) => card(l).replace('<div class="card', `<div id="${esc(l.id)}" class="card`)).join('\n')}
</div>

<h2>How these were verified</h2>
<div class="banner">
  <p>The full active inventory of all three towns &mdash; <strong>${num(src.inventoryScanned)} listings</strong>
  &mdash; was read from <strong>${esc(src.primary)}</strong>, then every candidate that cleared the
  bed, bath and price filters was re-checked against
  <strong><a href="https://www.metrolistpro.com/" rel="noopener">MetroListPRO</a></strong>, the official
  search site of MetroList, which is the MLS for El Dorado County. MetroListPRO exposes a live
  <code>Status</code> field, so a sold or pending listing cannot read as active.</p>
  <p><strong>${src.verifiedOnMetroList} of ${src.candidatesChecked}</strong> candidates verified
  <code>Status: Active</code>. The one that did not is still shown, with the disagreement spelled out
  on its card rather than resolved silently.</p>
  <p>This is what the previous run was missing: it had no network access to any listing site and was
  inferring status from search-engine snippets, which index sold listings as &ldquo;For Sale&rdquo; for
  years. Acreage and pool data here come from the MLS feature fields, not from listing prose, and every
  pool was additionally cross-checked against the listing description.</p>
</div>

<h2>Near misses</h2>
<p class="sectnote">Cleared 4+ bed, 3+ bath and the budget, and failed on exactly one thing. Worth a
look if you would trade the pool for land, or the land for a pool &mdash; adding a pool to an
acreage property is the easier of the two fixes.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>City</th><th>Price</th><th>Beds / baths</th><th>Acres</th><th>Why not</th></tr></thead>
  <tbody>
${nearRows}
  </tbody>
</table>
</div>

<h2>Dropped this run</h2>
<p class="sectnote">Everything carried over from ${esc(data.previousRun)} is gone from the market.
Listed once here so it is clear what was removed and why, then not surfaced again.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>City</th><th>Last price</th><th>Why dropped</th></tr></thead>
  <tbody>
${droppedRows}
  </tbody>
</table>
</div>

<h2>Ruled out earlier</h2>
<p class="sectnote">Failed price, bedroom, bath or acreage minimums on a previous run. Kept so they
are not re-surfaced. Note the bedroom minimum is now 4+, so anything rejected purely for having
4 bedrooms has been re-checked this run.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Price</th><th>Why not</th></tr></thead>
  <tbody>
${rejectedRows}
  </tbody>
</table>
</div>

<h2>What the market looks like</h2>
<p class="sectnote">Now measurable rather than guessed, from ${num(src.inventoryScanned)} active
listings. <strong>The pool is the binding constraint, not the budget.</strong> Of the
${src.candidatesChecked} homes that met 4+ bed, 3+ bath and the $1.5M budget, ${near.filter((n) => !n.pool).length}
sit on 2.5+ acres with no pool, while only ${listings.length} have both the land and the pool. Acreage
under budget is abundant &mdash; there is a 21-acre property at $1.25M and a 10-acre one at $595,000
&mdash; but pools cluster on small suburban lots in the Rescue and El Dorado Hills corridor. Dropping
the bedroom minimum from 5 to 4 is what made this run productive: it opened up ${listings.length}
matches where the 5-bed search had found none.</p>

<footer>
  <p>Generated from <code>listings.json</code> by <code>build.js</code>.
  ${listings.length} matches, ${near.length} near misses, ${dropped.length} dropped this run.
  Sources: ${esc(src.primary)}, verified against ${esc(src.verifier)}.
  Future runs flag only new listings and price changes — no repeats.</p>
</footer>

</div>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`Built index.html — ${listings.length} matches (${fresh.length} new), ` +
            `${near.length} near misses, ${dropped.length} dropped, ` +
            `${listings.filter((l) => l.photos && l.photos.length).length}/${listings.length} with photos.`);
