#!/usr/bin/env node
/**
 * Builds index.html from listings.json.
 *
 * Future runs edit listings.json ONLY, then run `node build.js`.
 *
 * Listings flagged `isNew` are pulled into a "New this run" band at the top of the
 * page; listings whose `priceHistory` grew get a price-delta chip. Photos come from
 * each listing's `photos` array — hotlinked, so the viewer's browser fetches them.
 * A dead URL swaps in a fallback tile client-side rather than leaving a hole.
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US'));
const compact = (n) => (n == null ? '—' : '$' + (n / 1000).toFixed(0) + 'k');
const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const ba = (n) => (n == null ? '—' : String(n).replace(/\.0$/, ''));

const prettyDate = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US',
    { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

/* ---------------------------------------------------------------- pieces */

function media(l) {
  const photos = (l.photos || []).slice(0, 6);
  const tile =
    `<a class="tile" href="${esc(l.gallery || l.url)}" rel="noopener" target="_blank">` +
      `<span class="tile-ico" aria-hidden="true">&#9968;</span>` +
      `<span class="tile-txt">View the listing &rarr;</span>` +
    `</a>`;
  if (!photos.length) return `<div class="media nophoto">${tile}</div>`;

  const strip = photos.slice(1, 5).map((p, i) =>
    `<img src="${esc(p)}" alt="${esc(l.address)} photo ${i + 2}" loading="lazy" ` +
    `referrerpolicy="no-referrer" onerror="this.remove()">`).join('');

  return `<div class="media">` +
    `<a class="hero" href="${esc(l.url)}" rel="noopener" target="_blank">` +
      `<img src="${esc(photos[0])}" alt="${esc(l.address)}, ${esc(l.city)}" loading="lazy" ` +
      `referrerpolicy="no-referrer" onerror="this.closest('.media').classList.add('failed')">` +
    `</a>` +
    (strip ? `<div class="strip">${strip}</div>` : '') +
    tile +
  `</div>`;
}

function priceBlock(l) {
  const hist = l.priceHistory || [];
  if (hist.length > 1) {
    const prev = hist[hist.length - 2].price;
    const down = l.currentPrice < prev;
    const delta = Math.abs(l.currentPrice - prev);
    return `<div class="price">${money(l.currentPrice)}` +
      `<span class="pricechg ${down ? 'down' : 'up'}">${down ? '&darr;' : '&uarr;'} ` +
      `${money(delta)} from ${money(prev)}</span></div>`;
  }
  return `<div class="price">${money(l.currentPrice)}</div>`;
}

const FEATURE_ROWS = [
  ['Lot', (f, l) => `${l.acres} acres${f['Zoning'] ? ` · zoned ${f['Zoning']}` : ''}`],
  ['Pool', (f, l) => l.poolDetail],
  ['Built', (f, l) => (l.yearBuilt ? `${l.yearBuilt}${f['Stories/Levels'] ? ` · ${f['Stories/Levels']} stor${f['Stories/Levels'] === '1' ? 'y' : 'ies'}` : ''}` : null)],
  ['Views', (f) => f['Property View']],
  ['Water / sewer', (f) => [f['Water'], f['Sewer']].filter(Boolean).join(' · ')],
  ['Garage', (f) => (f['Garage Spaces'] ? `${f['Garage Spaces']} spaces` : null)],
  ['Outbuildings', (f) => f['Other Structures']],
  ['Horse property', (f) => (f['Horse Property'] === 'Yes' ? (f['Horse Facility Desc.'] || 'Yes') : null)],
  ['Schools', (f) => f['School District']],
  ['HOA', (f) => f['Association Fee']],
];

function featureTable(l) {
  const f = l.features || {};
  const rows = FEATURE_ROWS
    .map(([label, get]) => [label, get(f, l)])
    .filter(([, v]) => v)
    .map(([label, v]) => `<tr><th>${esc(label)}</th><td>${esc(v)}</td></tr>`)
    .join('');
  return `<table class="spec">${rows}</table>`;
}

/** The listing blurb, minus the boilerplate first sentence the IDX prepends. */
function blurb(l) {
  const text = String(l.description || '')
    .replace(/^Discover the property [^.]+\.\s*/, '')
    .trim();
  if (!text) return '';
  return `<p class="blurb">${esc(text)}</p>`;
}

function card(l) {
  const flags = [];
  if (l.isNew) flags.push('<span class="flag new">New this run</span>');
  if (l.priceChanged) flags.push('<span class="flag chg">Price change</span>');
  if (l.mlsStatus !== 'Active') flags.push(`<span class="flag pend">${esc(l.mlsStatus)}</span>`);
  const acresClass = l.acres >= 5 ? 'good' : '';

  return `
<article class="card${l.mlsStatus === 'Active' ? '' : ' inactive'}" id="${esc(l.id)}">
  ${media(l)}
  <div class="body">
    <header>
      <div class="flags">${flags.join('')}</div>
      <h3><a href="${esc(l.url)}" rel="noopener" target="_blank">${esc(l.address)}</a></h3>
      <p class="where">${esc(l.city)}, CA ${esc(l.zip)} · MLS ${esc(l.mls)}${l.updated ? ` · ${esc(l.updated)}` : ''}</p>
      ${priceBlock(l)}
    </header>
    <ul class="facts">
      <li><b>${esc(l.beds)}</b> bd</li>
      <li><b>${esc(ba(l.baths))}</b> ba</li>
      <li><b>${num(l.sqft)}</b> sqft</li>
      <li class="${acresClass}"><b>${esc(l.acres)}</b> acres</li>
      <li class="pool"><b>Pool</b></li>
    </ul>
    ${featureTable(l)}
    ${blurb(l)}
    <p class="cta"><a href="${esc(l.url)}" rel="noopener" target="_blank">Full listing &amp; all photos &rarr;</a></p>
  </div>
</article>`;
}

/** Compact highlight row for the "new this run" band — the full card lives below. */
function freshRow(l) {
  const why = l.isNew ? 'New listing' : 'Price change';
  const hist = l.priceHistory || [];
  const detail = (!l.isNew && hist.length > 1)
    ? `${money(hist[hist.length - 2].price)} &rarr; ${money(l.currentPrice)}`
    : `${money(l.currentPrice)}`;
  return `<li>
    <a href="#${esc(l.id)}">${esc(l.address)}</a>
    <span class="sub">${esc(l.city)} · ${esc(l.beds)} bd / ${esc(ba(l.baths))} ba ·
      ${esc(l.acres)} acres${l.mlsStatus === 'Active' ? '' : ` · ${esc(l.mlsStatus)}`}</span>
    <span class="amt">${detail}</span>
    <span class="why">${why}</span>
  </li>`;
}

function nearRow(n) {
  return `<tr>
    <td><a href="${esc(n.url)}" rel="noopener" target="_blank">${esc(n.address)}</a>
        <span class="sub">${esc(n.city)}</span></td>
    <td class="r">${money(n.price)}</td>
    <td class="r">${esc(n.beds)}/${esc(ba(n.baths))}</td>
    <td class="r">${num(n.sqft)}</td>
    <td class="r">${esc(n.acres)}</td>
    <td>${n.pool ? esc(n.poolDetail || 'Pool') : '<span class="no">—</span>'}</td>
  </tr>`;
}

function nearTable(rows) {
  return `<div class="tablewrap"><table class="list">
    <thead><tr><th>Address</th><th class="r">Price</th><th class="r">Bd/Ba</th>
      <th class="r">Sqft</th><th class="r">Acres</th><th>Pool</th></tr></thead>
    <tbody>${rows.map(nearRow).join('')}</tbody>
  </table></div>`;
}

/* ------------------------------------------------------------- assembly */

const listings = data.listings || [];
const active = listings.filter((l) => l.mlsStatus === 'Active');
const pending = listings.filter((l) => l.mlsStatus !== 'Active');
const fresh = listings.filter((l) => l.isNew || l.priceChanged);
const nm = data.nearMisses || { poolShortLand: [], landNoPool: [] };
const archive = data.archive || [];
const c = data.criteria;

const cheapest = active.length ? Math.min(...active.map((l) => l.currentPrice)) : null;
const mostLand = active.length ? Math.max(...active.map((l) => l.acres)) : null;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>House Hunt — Shingle Springs · Rescue · Placerville</title>
<meta name="description" content="Tracked 4BR+/3BA+ homes with a pool on 2.5+ acres under $1.5M in Shingle Springs, Rescue and Placerville, CA.">
<style>
:root{
  --bg:#f6f5f2; --panel:#fff; --ink:#1c1b19; --muted:#6b6862; --line:#e2ded6;
  --accent:#1f6f4f; --accent-soft:#e6f1eb; --new:#b4531a; --new-soft:#fdf0e6;
  --warn:#8a6d1f; --warn-soft:#faf3df; --shadow:0 1px 2px rgba(0,0,0,.05),0 8px 24px -16px rgba(0,0,0,.25);
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#141513; --panel:#1d1f1d; --ink:#eceae5; --muted:#9d9a93; --line:#2e312e;
    --accent:#6fbf95; --accent-soft:#1b2b23; --new:#e08a4d; --new-soft:#2c2016;
    --warn:#d3b45f; --warn-soft:#2a2413; --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px -16px rgba(0,0,0,.8);
  }
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-text-size-adjust:100%}
a{color:inherit}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px 72px}

header.top{padding:48px 0 28px;border-bottom:1px solid var(--line);margin-bottom:32px}
h1{font-size:clamp(28px,4.5vw,40px);line-height:1.15;margin:0 0 10px;letter-spacing:-.02em}
.lede{margin:0;color:var(--muted);max-width:62ch}
.crit{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0 0;padding:0;list-style:none}
.crit li{background:var(--panel);border:1px solid var(--line);border-radius:999px;
  padding:5px 12px;font-size:13px;color:var(--muted)}
.crit b{color:var(--ink);font-weight:600}

.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1px;
  background:var(--line);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin:28px 0 0}
.stat{background:var(--panel);padding:14px 16px}
.stat .n{font-size:24px;font-weight:650;letter-spacing:-.02em;display:block}
.stat .l{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}

section{margin:44px 0 0;scroll-margin-top:16px}
h2{font-size:20px;margin:0 0 6px;letter-spacing:-.01em;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
h2 .count{font-size:13px;font-weight:500;color:var(--muted);background:var(--panel);
  border:1px solid var(--line);border-radius:999px;padding:2px 10px}
.note{margin:0 0 20px;color:var(--muted);font-size:14px;max-width:70ch}

.band{background:var(--new-soft);border:1px solid var(--new);border-radius:14px;padding:20px 20px 6px;margin:0 0 8px}
.band h2{color:var(--new)}
.band .note{color:var(--muted)}

.fresh{list-style:none;margin:0 0 20px;padding:0;display:grid;gap:1px;
  background:var(--line);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.fresh li{background:var(--panel);padding:11px 14px;display:grid;gap:2px 14px;align-items:baseline;
  grid-template-columns:1fr auto auto}
.fresh li a{grid-column:1;font-weight:650;color:var(--new);text-decoration:none}
.fresh li a:hover{text-decoration:underline}
.fresh .sub{grid-column:1;grid-row:2;font-size:13px}
.fresh .amt{grid-column:2;grid-row:1/3;font-weight:650;font-size:16px;align-self:center}
.fresh .why{grid-column:3;grid-row:1/3;align-self:center;font-size:11px;font-weight:700;
  letter-spacing:.05em;text-transform:uppercase;color:var(--new);
  border:1px solid var(--new);border-radius:999px;padding:2px 8px;white-space:nowrap}
@media(max-width:560px){
  .fresh li{grid-template-columns:1fr auto}
  .fresh .why{grid-column:1/3;grid-row:3;justify-self:start;margin-top:4px}
  .fresh .amt{grid-row:1}
}
.cards{display:grid;gap:20px}
@media(min-width:840px){.cards{grid-template-columns:1fr 1fr}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;
  box-shadow:var(--shadow);display:flex;flex-direction:column}
.card.inactive{opacity:.72}

.media{position:relative;background:var(--accent-soft);aspect-ratio:3/2;overflow:hidden}
.media .hero,.media .hero img{display:block;width:100%;height:100%;object-fit:cover}
.media .strip{position:absolute;left:0;right:0;bottom:0;display:flex;gap:2px;padding:2px;
  background:linear-gradient(transparent,rgba(0,0,0,.45))}
.media .strip img{width:25%;height:54px;object-fit:cover;border-radius:3px}
@media(max-width:520px){.media .strip{display:none}}
.media .tile{display:none}
.media.nophoto,.media.failed{aspect-ratio:auto;background:var(--accent-soft)}
.media.nophoto .hero,.media.failed .hero,.media.failed .strip{display:none}
.media.nophoto .tile,.media.failed .tile{display:flex;align-items:center;justify-content:center;
  gap:10px;padding:26px 16px;text-decoration:none;color:var(--accent);font-weight:600;font-size:14px}
.tile-ico{font-size:20px}

.body{padding:18px 20px 20px;display:flex;flex-direction:column;flex:1}
.flags{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px;min-height:0}
.flag{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
  border-radius:999px;padding:3px 9px}
.flag.new{background:var(--new);color:#fff}
.flag.chg{background:var(--warn-soft);color:var(--warn);border:1px solid var(--warn)}
.flag.pend{background:var(--warn-soft);color:var(--warn);border:1px solid var(--warn)}
.card h3{margin:0;font-size:19px;letter-spacing:-.01em}
.card h3 a{text-decoration:none}
.card h3 a:hover{text-decoration:underline}
.where{margin:3px 0 10px;font-size:13px;color:var(--muted)}
.price{font-size:26px;font-weight:650;letter-spacing:-.02em;display:flex;align-items:baseline;
  gap:10px;flex-wrap:wrap}
.pricechg{font-size:13px;font-weight:600}
.pricechg.down{color:var(--accent)} .pricechg.up{color:var(--new)}

.facts{display:flex;flex-wrap:wrap;gap:6px;list-style:none;margin:14px 0 0;padding:0}
.facts li{background:var(--bg);border:1px solid var(--line);border-radius:8px;
  padding:5px 10px;font-size:13px;color:var(--muted)}
.facts li b{color:var(--ink);font-weight:650}
.facts li.good{background:var(--accent-soft);border-color:var(--accent)}
.facts li.good b{color:var(--accent)}
.facts li.pool{background:var(--accent-soft);border-color:var(--accent);color:var(--accent)}
.facts li.pool b{color:var(--accent)}

.spec{width:100%;border-collapse:collapse;margin:16px 0 0;font-size:13.5px}
.spec th{text-align:left;font-weight:600;color:var(--muted);padding:5px 12px 5px 0;
  vertical-align:top;white-space:nowrap;width:1%}
.spec td{padding:5px 0;vertical-align:top}
.spec tr+tr th,.spec tr+tr td{border-top:1px solid var(--line)}

.blurb{font-size:14px;color:var(--muted);margin:14px 0 0;
  display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}
.cta{margin:auto 0 0;padding-top:14px;font-size:14px;font-weight:600}
.cta a{color:var(--accent);text-decoration:none}
.cta a:hover{text-decoration:underline}

.tablewrap{overflow-x:auto;background:var(--panel);border:1px solid var(--line);border-radius:12px}
table.list{width:100%;border-collapse:collapse;font-size:14px;min-width:560px}
table.list th,table.list td{padding:9px 14px;text-align:left;border-bottom:1px solid var(--line)}
table.list thead th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);
  font-weight:600;white-space:nowrap}
table.list tbody tr:last-child td{border-bottom:0}
table.list .r{text-align:right}
table.list a{color:var(--accent);text-decoration:none;font-weight:600}
table.list a:hover{text-decoration:underline}
.sub{display:block;font-size:12px;color:var(--muted);font-weight:400}
.no{color:var(--muted)}

.dropped{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:4px 20px}
.dropped dl{margin:0;font-size:14px}
.dropped dt{font-weight:650;margin:16px 0 2px}
.dropped dd{margin:0 0 16px;color:var(--muted)}

footer{margin:56px 0 0;padding:24px 0 0;border-top:1px solid var(--line);
  font-size:13px;color:var(--muted)}
footer p{margin:0 0 10px;max-width:74ch}
footer code{font-size:12px;background:var(--bg);border:1px solid var(--line);
  border-radius:4px;padding:1px 5px}
</style>
</head>
<body>
<div class="wrap">

<header class="top">
  <h1>House hunt — Shingle&nbsp;Springs, Rescue &amp; Placerville</h1>
  <p class="lede">Every active listing in the three target towns, checked against the criteria on
    each run. Data read from live MetroList IDX listing pages on ${prettyDate(data.lastRun)}.</p>
  <ul class="crit">
    <li><b>${esc(c.beds)}</b> beds</li>
    <li><b>${esc(c.baths)}</b> baths</li>
    <li><b>Pool</b> required</li>
    <li><b>${esc(c.minAcres)}+</b> acres <span>(${esc(c.preferredAcres)}+ preferred)</span></li>
    <li>under <b>${money(c.maxPrice)}</b></li>
    <li>${c.cities.map(esc).join(' · ')}</li>
  </ul>
  <div class="stats">
    <div class="stat"><span class="n">${active.length}</span><span class="l">Active matches</span></div>
    <div class="stat"><span class="n">${pending.length}</span><span class="l">Match, pending sale</span></div>
    <div class="stat"><span class="n">${compact(cheapest)}</span><span class="l">Lowest priced</span></div>
    <div class="stat"><span class="n">${mostLand ?? '—'}</span><span class="l">Most acres</span></div>
    <div class="stat"><span class="n">${data.source.inventoryScanned}</span><span class="l">Listings scanned</span></div>
  </div>
</header>

${fresh.length ? `
<section class="band">
  <h2>New this run <span class="count">${fresh.length} propert${fresh.length === 1 ? 'y' : 'ies'}</span></h2>
  <p class="note">Added to the board or repriced since the last run. Follow a link for the full
    card further down the page.</p>
  <ul class="fresh">${fresh.map(freshRow).join('')}</ul>
</section>` : `
<section>
  <h2>New this run</h2>
  <p class="note">Nothing new since the last run — no additions and no price changes.</p>
</section>`}

<section id="matches">
  <h2>Meets every criterion <span class="count">${active.length} active</span></h2>
  <p class="note">4+ beds, 3+ baths, a pool, at least ${c.minAcres} acres, at or under
    ${money(c.maxPrice)}, and confirmed active on the MLS feed this run.</p>
  <div class="cards">${active.map(card).join('')}</div>
</section>

${pending.length ? `
<section id="pending">
  <h2>Matches, but under contract <span class="count">${pending.length}</span></h2>
  <p class="note">These clear every criterion but are showing Pending. Worth watching — pending
    deals fall through often enough to be worth a backup offer.</p>
  <div class="cards">${pending.map(card).join('')}</div>
</section>` : ''}

${nm.poolShortLand.length ? `
<section id="near-land">
  <h2>Has the pool, short on land <span class="count">${nm.poolShortLand.length}</span></h2>
  <p class="note">Everything else clears, but the lot is between 1.5 and ${c.minAcres} acres.</p>
  ${nearTable(nm.poolShortLand)}
</section>` : ''}

${nm.landNoPool.length ? `
<section id="near-pool">
  <h2>Has the land, no pool <span class="count">${nm.landNoPool.length}</span></h2>
  <p class="note">Active, 4+ bd / 3+ ba, ${c.minAcres}+ acres and in budget — but no pool on the
    property. Listed because a pool is the one criterion you can add to a place that already has
    the land.</p>
  ${nearTable(nm.landNoPool)}
</section>` : ''}

${archive.length ? `
<section id="dropped">
  <h2>Dropped from the board <span class="count">${archive.length}</span></h2>
  <p class="note">Previously tracked, now gone. Kept on file so a genuine relist gets flagged
    rather than reported as a fresh find.</p>
  <div class="dropped"><dl>
    ${archive.map((a) => `<dt>${esc(a.address)}, ${esc(a.city)}</dt>
      <dd>${esc(a.outcome)}</dd>`).join('')}
  </dl></div>
</section>` : ''}

<footer>
  <p><b>How this was checked.</b> ${esc(data.source.method)}</p>
  <p>Source: ${esc(data.source.name)}. ${esc(data.source.note)}</p>
  <p>Status, price, bed/bath count, lot acreage and pool for every property above were read from
    that property&rsquo;s own live listing page — not from search-engine text, which indexes sold
    listings as &ldquo;for sale&rdquo; for years and caused a bad report on an earlier run.</p>
  <p>Last run ${prettyDate(data.lastRun)}. Generated from <code>listings.json</code> by
    <code>build.js</code>. Photos are hotlinked from the listing brokerage and remain their
    copyright.</p>
</footer>

</div>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`index.html written — ${active.length} active, ${pending.length} pending, ` +
  `${fresh.length} new/changed, ${nm.poolShortLand.length + nm.landNoPool.length} near misses.`);
