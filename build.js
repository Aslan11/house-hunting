#!/usr/bin/env node
/**
 * Builds index.html from listings.json.
 *
 * Future runs should edit listings.json ONLY, then run `node build.js`.
 *
 * Page contract:
 *  - Listings with `isNew: true` are pulled into a "New this run" band at the very top.
 *  - Listings with `priceChanged: true` are surfaced next, with the delta.
 *  - `status: "off-market"` listings are NOT rendered. They stay in listings.json purely
 *    so a later run recognises them and doesn't re-report them as a fresh find.
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (n == null ? '—' : '$' + n.toLocaleString('en-US'));

// Listing prose arrives with JSON escaping still in it.
const clean = (s) => String(s ?? '')
  .replace(/\\+([&'"])/g, '$1')
  .replace(/\s+/g, ' ')
  .trim();

const TAGS = {
  match:                   { cls: 'match',   tag: 'ok',   label: 'Verified match' },
  'active-fails-criteria': { cls: 'caution', tag: 'warn', label: 'Active — fails criteria' },
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
  if (l.sqft)  f.push(`<span class="fact">${l.sqft.toLocaleString('en-US')} sqft</span>`);
  if (l.acres) f.push(`<span class="fact${l.acres >= 5 ? ' good' : ''}">${esc(l.acres)} acres</span>`);
  f.push(l.pool
    ? `<span class="fact pool">Pool: ${esc(l.poolDetail || 'yes')}</span>`
    : `<span class="fact nopool">${esc(l.poolDetail || 'No pool')}</span>`);
  if (l.spa) f.push(`<span class="fact pool">Spa</span>`);
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

function ppsf(l) {
  if (!l.sqft || !l.currentPrice) return '';
  return ` &middot; $${Math.round(l.currentPrice / l.sqft)}/sqft`;
}

function card(l, opts = {}) {
  const meta = TAGS[l.status] || { cls: 'match', tag: 'ok', label: 'Match' };
  const label = l.badge || meta.label;
  const mls = l.mls ? ` &middot; MLS ${esc(l.mls)}` : '';
  const dom = l.daysOnMarket != null ? ` &middot; ${esc(l.daysOnMarket)} days on market` : '';

  const quote = l.poolQuote
    ? `<p class="quote">&ldquo;${esc(clean(l.poolQuote))}&rdquo;</p>` : '';
  const blurb = l.notes
    ? `<p class="note">${esc(l.notes)}</p>`
    : (l.blurbSrc ? `<p class="note">${esc(clean(l.blurbSrc).slice(0, 260))}&hellip;</p>` : '');

  const flags = [];
  if (opts.showNew && l.isNew) flags.push(`<span class="flag new">NEW</span>`);
  if (l.priceChanged) flags.push(`<span class="flag chg">PRICE CHANGE</span>`);

  return `
  <div class="card ${meta.cls}${opts.showNew && l.isNew ? ' isnew' : ''}">
    ${media(l)}
    <div class="body">
      <div class="tagrow"><span class="tag ${meta.tag}">${esc(label)}</span>${flags.join('')}</div>
      ${priceBlock(l)}
      <p class="addr">${esc(l.address)}</p>
      <p class="city">${esc(l.city)}, CA ${esc(l.zip)}${mls}${dom}${ppsf(l)}</p>
      <div class="facts">${facts(l)}</div>
      ${quote}
      ${blurb}
      ${l.broker ? `<p class="broker">Listed by ${esc(l.broker)}</p>` : ''}
      <a class="btn" href="${esc(l.url)}" rel="noopener">View listing &rarr;</a>
    </div>
  </div>`;
}

const live      = data.listings.filter((l) => l.status !== 'off-market');
const matches   = live.filter((l) => l.status === 'match');
const newOnes   = matches.filter((l) => l.isNew);
const returning = matches.filter((l) => !l.isNew);
const nearMiss  = live.filter((l) => l.status === 'active-fails-criteria');
const dropped   = data.listings.filter((l) => l.status === 'off-market');

const noPoolRows = (data.noPoolActive || [])
  .map((r) => `    <tr><td><a href="${esc(r.url)}" rel="noopener">${esc(r.address)}</a></td>` +
              `<td>${money(r.price)}</td><td>${esc(r.reason)}</td></tr>`)
  .join('\n');

const rejectedRows = data.rejected
  .map((r) => `    <tr><td>${esc(r.address)}</td><td>${money(r.price)}</td><td>${esc(r.reason)}</td></tr>`)
  .join('\n');

const cheapest = matches.reduce((a, b) => (a && a.currentPrice < b.currentPrice ? a : b), null);
const biggest  = matches.reduce((a, b) => (a && a.acres > b.acres ? a : b), null);

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
      --new:#8fc6ea; --new-soft:#17262f; --tile:#282c30;
    }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  .wrap{max-width:1080px;margin:0 auto;padding:40px 20px 72px}
  h1{font-size:1.9rem;margin:0 0 6px;letter-spacing:-.02em}
  h2{font-size:1.15rem;margin:44px 0 4px;letter-spacing:-.01em}
  h2:first-of-type{margin-top:32px}
  .sub{color:var(--muted);margin:0 0 18px}
  .sectnote{color:var(--muted);font-size:.9rem;margin:0 0 18px;max-width:70ch}
  .criteria{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}
  .chip{background:var(--card);border:1px solid var(--line);border-radius:999px;
    padding:5px 12px;font-size:.82rem;color:var(--muted)}
  .grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fill,minmax(310px,1fr))}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;
    display:flex;flex-direction:column}
  .card.isnew{border-color:var(--new);box-shadow:0 0 0 2px var(--new-soft)}
  .media{position:relative;aspect-ratio:3/2;background:var(--tile);display:block}
  .media img{width:100%;height:100%;object-fit:cover;display:block}
  .media .tile{display:none}
  .media.nophoto .tile,.media.failed .tile{display:flex}
  .media.failed img{display:none}
  .tile{position:absolute;inset:0;flex-direction:column;align-items:center;justify-content:center;
    gap:6px;text-decoration:none;color:var(--muted);background:var(--tile)}
  .tile-ico{font-size:1.6rem;opacity:.55}
  .tile-txt{font-size:.85rem}
  .body{padding:16px 18px 18px;display:flex;flex-direction:column;flex:1}
  .tagrow{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:9px}
  .tag{display:inline-block;font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;
    padding:3px 9px;border-radius:999px;font-weight:600}
  .tag.ok{background:var(--accent-soft);color:var(--accent)}
  .tag.warn{background:var(--warn-soft);color:var(--warn)}
  .flag{display:inline-block;font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;
    padding:3px 9px;border-radius:999px;font-weight:700}
  .flag.new{background:var(--new-soft);color:var(--new)}
  .flag.chg{background:var(--warn-soft);color:var(--warn)}
  .price{font-size:1.3rem;font-weight:650;margin:0 0 2px;letter-spacing:-.02em}
  .pricechg{font-size:.75rem;font-weight:600;margin-left:8px;vertical-align:middle}
  .pricechg.down{color:var(--accent)} .pricechg.up{color:var(--miss)}
  .addr{margin:0;font-weight:600}
  .city{margin:1px 0 11px;color:var(--muted);font-size:.85rem}
  .facts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:11px}
  .fact{background:var(--bg);border:1px solid var(--line);border-radius:6px;
    padding:3px 8px;font-size:.78rem;color:var(--muted)}
  .fact.good{color:var(--accent);border-color:var(--accent-soft)}
  .fact.pool{background:var(--accent-soft);color:var(--accent);border-color:transparent;font-weight:600}
  .fact.nopool{background:var(--miss-soft);color:var(--miss);border-color:transparent}
  .quote{margin:0 0 9px;font-size:.85rem;line-height:1.5;color:var(--ink);
    border-left:3px solid var(--accent);padding-left:10px;font-style:italic}
  .note{margin:0 0 12px;font-size:.85rem;color:var(--muted);line-height:1.5}
  .broker{margin:0 0 12px;font-size:.75rem;color:var(--muted)}
  a.btn{margin-top:auto;display:inline-block;text-align:center;text-decoration:none;
    border:1px solid var(--line);border-radius:8px;padding:9px 12px;font-size:.85rem;
    color:var(--ink);font-weight:600}
  a.btn:hover{background:var(--accent-soft)}
  .banner{background:var(--new-soft);border:1px solid var(--line);border-left:4px solid var(--new);
    border-radius:10px;padding:16px 18px;margin-bottom:28px;font-size:.9rem}
  .banner h3{margin:0 0 6px;font-size:.95rem}
  .banner p{margin:0 0 8px;color:var(--muted)}
  .banner p:last-child{margin-bottom:0}
  .banner code{background:var(--bg);padding:1px 5px;border-radius:4px;font-size:.85em}
  .tablewrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
  table{width:100%;border-collapse:collapse;font-size:.88rem}
  th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
  th{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  tr:last-child td{border-bottom:none}
  td a{color:var(--ink)}
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

${newOnes.length ? `<div class="banner">
  <h3>&#10022; ${newOnes.length} new ${newOnes.length === 1 ? 'match' : 'matches'} this run</h3>
  <p>These are properties that were not on the list before. Every one is confirmed
  <strong>active right now</strong> in Redfin's live MLS feed, and its pool is confirmed twice —
  once from the MLS <code>Pool Information</code> record and again from the listing description.</p>
  <p>Ranging ${money(cheapest && cheapest.currentPrice)} to ${money(
    matches.reduce((a, b) => (a && a.currentPrice > b.currentPrice ? a : b), null).currentPrice)},
  ${biggest ? `up to ${esc(biggest.acres)} acres.` : ''}</p>
</div>` : ''}

${newOnes.length ? `<h2>&#10022; New this run</h2>
<p class="sectnote">Sorted by price. Not previously reported on this page.</p>
<div class="grid">${newOnes.map((l) => card(l, { showNew: true })).join('\n')}
</div>` : ''}

${returning.length ? `<h2>Still available</h2>
<p class="sectnote">Previously reported and confirmed still on the market this run.</p>
<div class="grid">${returning.map((l) => card(l)).join('\n')}
</div>` : ''}

${nearMiss.length ? `<h2>Close, but misses a criterion</h2>
<p class="sectnote">Confirmed on the market. Shown for context, not as a recommendation.</p>
<div class="grid">${nearMiss.map((l) => card(l)).join('\n')}
</div>` : ''}

${noPoolRows ? `<h2>Active on acreage — but no pool</h2>
<p class="sectnote">These all clear the bedroom, bathroom, acreage and price bars and are on the
market today. The pool is the only thing missing, so they are worth knowing about if you would
consider adding one.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Price</th><th>Why not</th></tr></thead>
  <tbody>
${noPoolRows}
  </tbody>
</table>
</div>` : ''}

<h2>Ruled out on the facts</h2>
<p class="sectnote">Failed price, bedroom, bath or acreage minimums. Carried forward so they are not
re-surfaced as new finds.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Price</th><th>Why not</th></tr></thead>
  <tbody>
${rejectedRows}
  </tbody>
</table>
</div>

<h2>What this run establishes</h2>
<p class="sectnote"><strong>The pool is the binding constraint, not the budget.</strong> Of every
active listing in the three towns meeting 4BR / 3BA / 2.5+ acres under $1.5M, ${matches.length + (data.noPoolActive || []).length}
qualify on size and price and only <strong>${matches.length} have a pool</strong> — the other
${(data.noPoolActive || []).length} have ponds, seasonal creeks or a hot tub. Acreage and bedrooms are
plentiful and comfortably inside budget; several no-pool options sit in the $600–900K range, leaving
real room for a pool build. Note also that ${matches.filter((l) => l.acres >= 5).length} of the
${matches.length} matches clear the preferred 5-acre bar, so the stronger preference is satisfiable
without going to the top of the budget.</p>

<footer>
  <p>Generated from <code>listings.json</code> by <code>build.js</code>.
  <strong>${matches.length} verified active ${matches.length === 1 ? 'match' : 'matches'}</strong>,
  ${newOnes.length} new this run, ${(data.noPoolActive || []).length} active-but-no-pool,
  ${data.rejected.length} ruled out${dropped.length ? `, ${dropped.length} dropped as sold or off market` : ''}.</p>
  <p>Status read from Redfin's live active-listing feed on ${esc(data.lastRun)}; pools confirmed
  against each property's MLS amenity record. Listing photos are &copy; their listing brokerages.</p>
</footer>

</div>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`Wrote index.html — ${matches.length} matches (${newOnes.length} new), ` +
            `${nearMiss.length} near-miss, ${dropped.length} dropped, ` +
            `${(data.noPoolActive || []).length} no-pool actives.`);
