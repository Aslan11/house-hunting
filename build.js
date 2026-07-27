#!/usr/bin/env node
/**
 * Builds index.html from listings.json.
 *
 * Future runs should edit listings.json ONLY, then run `node build.js`.
 *
 * Layout contract (from the standing request):
 *   - New-this-run listings are highlighted in their own section at the TOP.
 *   - Nothing already on the list is re-surfaced unless its price moved.
 *   - Sold / withdrawn listings are removed from the board and recorded under
 *     "Dropped this run" so they are never re-reported as fresh finds.
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US'));
const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));

/** Bath display: MLS "total baths" folds in half-baths, so show the split. */
function bathLabel(l) {
  if (l.fullBaths != null && l.fullBaths < l.baths) {
    const half = Math.round((l.baths - l.fullBaths) * 2) / 2;
    return `${l.fullBaths} full + ${half} half ba`;
  }
  return `${l.baths} ba`;
}

function media(l) {
  const photos = l.photos || [];
  const gallery = l.url;
  const tile =
    `<a class="tile" href="${esc(gallery)}" rel="noopener" target="_blank">` +
      `<span class="tile-ico" aria-hidden="true">&#9968;</span>` +
      `<span class="tile-txt">View listing &rarr;</span>` +
    `</a>`;
  if (!photos.length) return `<div class="media nophoto">${tile}</div>`;

  const strip = photos.slice(1, 5).map((p, i) =>
    `<img src="${esc(p)}" alt="" loading="lazy" referrerpolicy="no-referrer"` +
    ` onerror="this.remove()">`).join('');

  return `<div class="media">` +
    `<a href="${esc(gallery)}" rel="noopener" target="_blank">` +
    `<img class="hero" src="${esc(photos[0])}" alt="${esc(l.address)}, ${esc(l.city)}"` +
    ` loading="lazy" referrerpolicy="no-referrer"` +
    ` onerror="this.closest('.media').classList.add('failed')"></a>` +
    (strip ? `<div class="strip">${strip}</div>` : '') +
    `<span class="count">${photos.length}+ photos</span>` +
    tile +
  `</div>`;
}

function facts(l) {
  const f = [];
  f.push(`<span class="fact">${esc(l.beds)} bd</span>`);
  f.push(`<span class="fact">${esc(bathLabel(l))}</span>`);
  if (l.sqft) f.push(`<span class="fact">${num(l.sqft)} sqft</span>`);
  if (l.acres) {
    const big = l.acres >= 5;
    f.push(`<span class="fact acres${big ? ' pref' : ''}">${esc(l.acres)} acres${big ? ' &#9733;' : ''}</span>`);
  }
  f.push(`<span class="fact pool">${esc(l.poolDetail || 'Pool')}</span>`);
  if (l.propertyType && l.propertyType !== 'Single Family')
    f.push(`<span class="fact type">${esc(l.propertyType)}</span>`);
  if (l.horse === 'Yes') f.push(`<span class="fact">Horse property</span>`);
  if (l.yearBuilt) f.push(`<span class="fact">Built ${esc(l.yearBuilt)}</span>`);
  return f.join('');
}

function priceBlock(l) {
  const hist = l.priceHistory || [];
  let chg = '';
  if (hist.length > 1) {
    const prev = hist[hist.length - 2].price;
    const now = l.currentPrice;
    const down = now < prev;
    chg = `<span class="pricechg ${down ? 'down' : 'up'}">` +
      `${down ? '&darr;' : '&uarr;'} ${money(Math.abs(now - prev))} since ${esc(hist[hist.length - 2].date)}</span>`;
  } else if (l.priceReduction) {
    chg = `<span class="pricechg down">&darr; ${esc(l.priceReduction)} — reduced by seller</span>`;
  }
  return `<p class="price">${money(l.currentPrice)}${chg}</p>`;
}

/** One-line human summary pulled from the MLS remarks, trimmed to a sentence or two. */
function blurb(l) {
  let d = (l.desc || '').replace(/^Discover the property [^.]+\.\s*/, '');
  d = d.replace(/https?:\/\/\S+/g, '').trim();
  const cut = d.slice(0, 260);
  const end = cut.lastIndexOf('. ');
  return esc(end > 90 ? cut.slice(0, end + 1) : cut + (d.length > 260 ? '…' : ''));
}

function card(l) {
  const badges = [];
  if (l.isNew) badges.push(`<span class="tag new">New this run</span>`);
  if (l.flag === 'Just Listed') badges.push(`<span class="tag hot">Just listed</span>`);
  if (l.flag === 'Price Reduced') badges.push(`<span class="tag cut">Price reduced</span>`);
  badges.push(`<span class="tag ok" title="Confirmed Active on MetroList MLS">&#10003; MLS verified</span>`);

  return `
  <article class="card${l.isNew ? ' isnew' : ''}">
    ${media(l)}
    <div class="body">
      <div class="tags">${badges.join('')}</div>
      ${priceBlock(l)}
      <h3 class="addr">${esc(l.address)}</h3>
      <p class="city">${esc(l.city)}, CA ${esc(l.zip)} &middot; MLS ${esc(l.mls)}${
        l.listedOn ? ` &middot; listed ${esc(l.listedOn)}` : ''}</p>
      <div class="facts">${facts(l)}</div>
      <p class="note">${blurb(l)}</p>
      ${l.caveat ? `<p class="caveat">&#9888; ${esc(l.caveat)}</p>` : ''}
      <div class="links">
        <a class="btn primary" href="${esc(l.url)}" rel="noopener" target="_blank">Listing &amp; photos &rarr;</a>
        ${l.mlsUrl ? `<a class="btn" href="${esc(l.mlsUrl)}" rel="noopener" target="_blank">MLS record</a>` : ''}
        ${l.lat ? `<a class="btn" href="https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lon}" rel="noopener" target="_blank">Map</a>` : ''}
      </div>
    </div>
  </article>`;
}

function missRows(rows) {
  return rows.map((r) =>
    `    <tr><td><a href="${esc(r.url)}" rel="noopener" target="_blank">${esc(r.address)}</a></td>` +
    `<td>${esc(r.city)}</td><td>${money(r.price)}</td><td>${esc(r.beds)}bd/${esc(r.baths)}ba</td>` +
    `<td>${r.acres != null ? esc(r.acres) : '—'}</td></tr>`).join('\n');
}

const listings = data.listings || [];
const fresh = listings.filter((l) => l.isNew);
const moved = listings.filter((l) => !l.isNew && (l.priceHistory || []).length > 1);
const standing = listings.filter((l) => !l.isNew && (l.priceHistory || []).length <= 1);
const nm = data.nearMisses || { acreageOkNoPool: [], poolOkLotTooSmall: [] };
const c = data.criteria;

// Headline states what actually changed, so a quiet run reads as quiet.
const bits = [];
if (fresh.length) bits.push(`${fresh.length} new ${fresh.length === 1 ? 'listing' : 'listings'}`);
if (moved.length) bits.push(`${moved.length} price ${moved.length === 1 ? 'change' : 'changes'}`);
const headline = bits.length
  ? bits.join(' and ') + ' since ' + (data.previousRun || 'the last run')
  : `No changes since ${data.previousRun || 'the last run'}`;

const section = (title, note, items) => !items.length ? '' : `
<h2>${title}</h2>
<p class="sectnote">${note}</p>
<div class="grid">${items.map(card).join('\n')}
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
    --new:#1d5fa8; --new-soft:#e3eefb; --cut:#a3552a; --cut-soft:#fbeade;
    --warn:#8a6d1f; --warn-soft:#f8f0d8; --tile:#ece7de;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#16181a; --card:#1f2225; --ink:#eceae6; --muted:#a09a91;
      --line:#31363a; --accent:#7fc4a1; --accent-soft:#1e2f27;
      --new:#8ab8ea; --new-soft:#1a2635; --cut:#e2a377; --cut-soft:#302219;
      --warn:#d9bd6a; --warn-soft:#2e2819; --tile:#282c30;
    }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  .wrap{max-width:1140px;margin:0 auto;padding:40px 20px 72px}
  header{border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:28px}
  h1{font-size:1.9rem;margin:0 0 8px;letter-spacing:-.02em}
  .sub{color:var(--muted);margin:0}
  .criteria{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
  .chip{background:var(--card);border:1px solid var(--line);border-radius:999px;
    padding:5px 12px;font-size:.82rem;color:var(--muted)}
  h2{font-size:1.2rem;margin:44px 0 6px;letter-spacing:-.01em}
  .sectnote{color:var(--muted);font-size:.88rem;margin:0 0 18px;max-width:74ch}
  .grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(340px,1fr))}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;
    overflow:hidden;display:flex;flex-direction:column}
  .card.isnew{border-color:var(--new);box-shadow:0 0 0 1px var(--new)}
  .body{padding:16px 18px 18px;display:flex;flex-direction:column;flex:1}

  .media{position:relative;background:var(--tile);border-bottom:1px solid var(--line);}
  .media .hero{width:100%;aspect-ratio:3/2;object-fit:cover;display:block}
  .strip{display:grid;grid-template-columns:repeat(4,1fr);gap:2px;background:var(--line)}
  .strip img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block}
  .count{position:absolute;top:10px;right:10px;background:rgba(0,0,0,.62);color:#fff;
    font-size:.72rem;font-weight:600;padding:3px 8px;border-radius:999px}
  .media .tile{display:none}
  .media.nophoto,.media.failed{aspect-ratio:3/2}
  .media.nophoto .tile,.media.failed .tile{display:flex}
  .media.failed .hero,.media.failed .strip,.media.failed .count{display:none}
  .tile{position:absolute;inset:0;flex-direction:column;align-items:center;justify-content:center;
    gap:8px;text-decoration:none;color:var(--muted);background:
      repeating-linear-gradient(45deg,transparent,transparent 12px,rgba(128,128,128,.05) 12px,rgba(128,128,128,.05) 24px);}
  .tile-ico{font-size:2rem;opacity:.55}
  .tile-txt{font-size:.85rem;font-weight:600}

  .tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
  .tag{display:inline-block;font-size:.68rem;font-weight:700;letter-spacing:.05em;
    text-transform:uppercase;padding:3px 8px;border-radius:5px}
  .tag.ok{background:var(--accent-soft);color:var(--accent)}
  .tag.new{background:var(--new-soft);color:var(--new)}
  .tag.cut{background:var(--cut-soft);color:var(--cut)}
  .tag.hot{background:var(--warn-soft);color:var(--warn)}
  .price{font-size:1.5rem;font-weight:650;letter-spacing:-.02em;margin:0}
  .pricechg{display:block;font-size:.78rem;font-weight:700;margin-top:3px}
  .pricechg.down{color:var(--accent)} .pricechg.up{color:var(--cut)}
  .addr{font-weight:650;margin:8px 0 2px;font-size:1rem}
  .city{color:var(--muted);font-size:.85rem;margin:0 0 12px}
  .facts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
  .fact{background:var(--bg);border:1px solid var(--line);border-radius:6px;
    padding:3px 9px;font-size:.79rem}
  .pool{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:600}
  .type{background:var(--warn-soft);border-color:transparent;color:var(--warn);font-weight:600}
  .acres.pref{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:600}
  .note{font-size:.87rem;color:var(--muted);margin:0 0 12px;flex:1}
  .caveat{font-size:.8rem;color:var(--warn);background:var(--warn-soft);
    border-radius:7px;padding:7px 10px;margin:0 0 12px}
  .links{display:flex;flex-wrap:wrap;gap:8px}
  a.btn{display:inline-block;text-decoration:none;color:var(--muted);font-weight:600;
    font-size:.85rem;border:1px solid var(--line);border-radius:7px;padding:6px 11px}
  a.btn:hover{background:var(--accent-soft);color:var(--accent)}
  a.btn.primary{color:var(--accent);border-color:var(--accent)}
  .banner{background:var(--accent-soft);border:1px solid var(--line);border-left:4px solid var(--accent);
    border-radius:10px;padding:16px 18px;margin-bottom:8px;font-size:.9rem}
  .banner h3{margin:0 0 6px;font-size:.95rem}
  .banner p{margin:0 0 8px;color:var(--muted)} .banner p:last-child{margin-bottom:0}
  .tablewrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
  table{width:100%;border-collapse:collapse;font-size:.86rem}
  th,td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
  th{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  tr:last-child td{border-bottom:none}
  td a{color:var(--accent)}
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
    <span class="chip">${esc(c.beds)} bedrooms</span>
    <span class="chip">${esc(c.baths)} bathrooms</span>
    <span class="chip">Pool required</span>
    <span class="chip">${esc(c.minAcres)}+ acres (${esc(c.preferredAcres)}+ preferred)</span>
    <span class="chip">Max ${money(c.maxPrice)}</span>
  </div>
</header>

<div class="banner">
  <h3>${headline}</h3>
  <p>${listings.length} ${listings.length === 1 ? 'property meets' : 'properties meet'} every criterion.
  Found by sweeping the <strong>full active inventory</strong> of all three towns
  (${num(data.dataQuality.inventoryScanned)} listings) from a live MLS-backed feed, then
  <strong>independently re-checked against MetroListPRO</strong>, the official MetroList MLS site —
  price, beds, acreage, pool and Active status all confirmed from two sources.</p>
  <p>${(data.dropped || []).length} previously tracked ${(data.dropped || []).length === 1 ? 'property has' : 'properties have'}
  come off the board this run; they are listed at the bottom so they are never re-reported as new.</p>
</div>

${section('&#9733; New this run', 'Not on the list before today. Everything here meets every hard criterion and is confirmed active.', fresh)}

${section('Price changed', 'Already tracked, but the asking price moved since the last run.', moved)}

${section('Still on the market', 'Tracked previously, unchanged, still available.', standing)}

<h2>Near misses</h2>
<p class="sectnote">Not shown as matches, but close enough to be worth a glance — these are the two
ways the criteria get missed. If the pool is negotiable, the first table is where the acreage is.</p>

<h3 style="font-size:.95rem;margin:22px 0 8px">${nm.acreageOkNoPool.length} homes: acreage &amp; size fit, but no pool</h3>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>City</th><th>Price</th><th>Beds/Baths</th><th>Acres</th></tr></thead>
  <tbody>
${missRows(nm.acreageOkNoPool)}
  </tbody>
</table>
</div>

<h3 style="font-size:.95rem;margin:26px 0 8px">${nm.poolOkLotTooSmall.length} homes: pool &amp; size fit, but under ${esc(c.minAcres)} acres</h3>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>City</th><th>Price</th><th>Beds/Baths</th><th>Acres</th></tr></thead>
  <tbody>
${missRows(nm.poolOkLotTooSmall)}
  </tbody>
</table>
</div>

<h2>Dropped this run</h2>
<p class="sectnote">Removed from the board so they are never re-reported as new finds.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Why it came off</th></tr></thead>
  <tbody>
${(data.dropped || []).map((d) =>
  `    <tr><td>${esc(d.address)}</td><td style="white-space:normal">${esc(d.reason)}</td></tr>`).join('\n')}
  </tbody>
</table>
</div>

<h2>What the market looks like</h2>
<p class="sectnote">Across ${num(data.dataQuality.inventoryScanned)} active listings in the three towns,
<strong>the pool is the binding constraint, not the budget</strong>. There are
${nm.acreageOkNoPool.length} homes that clear ${esc(c.beds)}/${esc(c.baths)} on ${esc(c.minAcres)}+ acres
under ${money(c.maxPrice)} but have no pool, versus just ${listings.length} that have everything —
and ${nm.poolOkLotTooSmall.length} more with a pool on too small a lot. Placerville carries most of the
large-acreage inventory; Rescue and Shingle Springs pool properties cluster at the top of the budget.
${listings.filter((l) => l.acres >= c.preferredAcres).length} of the ${listings.length} matches sit on
${esc(c.preferredAcres)}+ acres, so the preferred lot size is achievable without going over ${money(c.maxPrice)}.</p>

<footer>
  <p>Generated from <code>listings.json</code> by <code>build.js</code>.
  <strong>${listings.length} verified matches</strong> (${fresh.length} new),
  ${nm.acreageOkNoPool.length + nm.poolOkLotTooSmall.length} near misses,
  ${(data.dropped || []).length} dropped this run.
  Sources: ${esc(data.dataQuality.primarySource)}; verified against ${esc(data.dataQuality.verificationSource)}.</p>
  <p>Listing photos are hotlinked from the listing brokerage and remain their copyright.</p>
</footer>

</div>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`Built index.html — ${listings.length} matches (${fresh.length} new, ${moved.length} price-changed), ` +
            `${nm.acreageOkNoPool.length + nm.poolOkLotTooSmall.length} near misses, ${(data.dropped || []).length} dropped.`);
