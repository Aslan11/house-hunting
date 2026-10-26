#!/usr/bin/env node
/**
 * Builds index.html from listings.json.
 *
 * Future runs should edit listings.json ONLY, then run `node build.js`.
 *
 * Conventions this script relies on:
 *   status    'match' | 'near-miss'       - which section a listing renders in
 *   isNew     true on listings added by the most recent run; drives the
 *             "New this run" band at the top of the page and the NEW ribbons.
 *             Clear it on the next run before adding that run's finds.
 *   photos    array of image URLs; photos[0] becomes the card image. Empty
 *             falls back to a "View photos" tile pointing at `gallery`.
 *             Hotlinked images carry referrerpolicy="no-referrer" and an
 *             onerror handler, so a dead URL never leaves a hole in the grid.
 *   priceHistory  append {date, price} on a change; the card then renders the
 *             delta against the previous entry automatically.
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (n == null ? '—' : '$' + n.toLocaleString('en-US'));

const TAGS = {
  match:       { cls: 'match',   tag: 'ok',   label: 'Meets every criterion' },
  'near-miss': { cls: 'caution', tag: 'warn', label: 'Near miss' },
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
  if (l.acres) f.push(`<span class="fact acres">${esc(l.acres)} acres</span>`);
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
  const meta = TAGS[l.status] || TAGS.match;
  const label = l.badge || meta.label;
  const mls = l.mls ? ` &middot; MLS ${esc(l.mls)}` : '';
  const ribbon = l.isNew ? `<span class="ribbon">New</span>` : '';
  return `
  <article class="card ${meta.cls}" id="${esc(l.id)}">
    ${ribbon}
    ${media(l)}
    <div class="body">
      <span class="tag ${meta.tag}">${esc(label)}</span>
      ${priceBlock(l)}
      <h3 class="addr">${esc(l.address)}</h3>
      <p class="city">${esc(l.city)}, CA ${esc(l.zip)}${mls}</p>
      <div class="facts">${facts(l)}</div>
      <p class="note">${l.blurb ? esc(l.blurb) : esc(l.notes)}</p>
      <a class="btn" href="${esc(l.url)}" rel="noopener">View listing &rarr;</a>
    </div>
  </article>`;
}

const byStatus = (s) => data.listings.filter((l) => l.status === s);
const byPrice  = (a, b) => (a.currentPrice ?? 0) - (b.currentPrice ?? 0);

const matches   = byStatus('match').sort(byPrice);
const nearMiss  = byStatus('near-miss').sort(byPrice);
const newOnes   = data.listings.filter((l) => l.isNew && l.status === 'match').sort(byPrice);
const priceMoves = data.listings.filter((l) => (l.priceHistory || []).length > 1);

const c = data.criteria;
const chips = [
  `${c.beds} bedrooms`,
  `${c.baths} bathrooms`,
  'Pool required',
  `${c.minAcres}+ acres (${c.preferredAcres}+ preferred)`,
  `Under ${money(c.maxPrice)}`,
  c.cities.map((x) => x.replace(', CA', '')).join(' · '),
].map((t) => `<span class="chip">${esc(t)}</span>`).join('');

const newBand = newOnes.length
  ? `<section class="band">
    <h2 class="bandhead"><span class="dot"></span>${newOnes.length} new ${newOnes.length === 1 ? 'listing' : 'listings'} this run</h2>
    <ul class="newlist">
${newOnes.map((l) => `      <li><a href="#${esc(l.id)}"><strong>${esc(l.address)}</strong>, ${esc(l.city)}</a>
        <span class="nl-meta">${money(l.currentPrice)} &middot; ${esc(l.beds)}bd/${esc(l.baths)}ba &middot; ${esc(l.acres)} acres &middot; ${esc(l.poolDetail)}</span></li>`).join('\n')}
    </ul>
    ${priceMoves.length
      ? `<p class="bandnote">${priceMoves.length} price change${priceMoves.length === 1 ? '' : 's'} since the last run — shown on the affected cards.</p>`
      : `<p class="bandnote">No price changes on previously tracked listings.</p>`}
  </section>`
  : `<section class="band quiet">
    <h2 class="bandhead">No new listings this run</h2>
    <p class="bandnote">Nothing new cleared the criteria since the last run. The matches below are
    still active${priceMoves.length ? `, and ${priceMoves.length} had a price change` : ''}.</p>
  </section>`;

const droppedRows = (data.dropped || [])
  .map((d) => `    <tr><td>${esc(d.address)}</td><td>${esc(d.reason)}</td></tr>`)
  .join('\n');

const rejectedRows = data.rejected
  .map((r) => `    <tr><td>${esc(r.address)}</td><td>${money(r.price)}</td><td>${esc(r.reason)}</td></tr>`)
  .join('\n');

const sourceRows = (data.sources || [])
  .map((s) => `    <tr><td>${esc(s.name)}</td><td>${esc(s.role)}</td></tr>`)
  .join('\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>El Dorado County House Hunt</title>
<meta name="description" content="Verified 4BR+/3BA+ homes with a pool on 2.5+ acres in Shingle Springs, Rescue and Placerville, CA under $1.5M.">
<style>
  :root{
    --bg:#0f1115; --panel:#171a21; --panel2:#1d212a; --line:#272c37;
    --ink:#e8ebf0; --ink2:#a7b0c0; --ink3:#727c8e;
    --ok:#3ddc97; --warn:#f5b949; --bad:#ef6461; --accent:#6aa6ff;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  a{color:var(--accent)}
  .wrap{max-width:1180px;margin:0 auto;padding:40px 20px 80px}
  header h1{margin:0 0 6px;font-size:30px;letter-spacing:-.4px}
  .sub{color:var(--ink2);margin:0}
  .stamp{color:var(--ink3);font-size:13px;margin-top:10px}
  .stamp b{color:var(--ink2);font-weight:600}
  .criteria{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0 4px}
  .chip{background:var(--panel2);border:1px solid var(--line);color:var(--ink2);
    border-radius:999px;padding:4px 12px;font-size:13px}

  .band{background:linear-gradient(180deg,#152a22,#141821);border:1px solid #2a4a3c;
    border-left:3px solid var(--ok);border-radius:12px;padding:18px 20px;margin:26px 0 10px}
  .band.quiet{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--ink3)}
  .bandhead{margin:0 0 10px;font-size:18px;display:flex;align-items:center;gap:9px}
  .dot{width:9px;height:9px;border-radius:50%;background:var(--ok);
    box-shadow:0 0 0 4px rgba(61,220,151,.16)}
  .newlist{list-style:none;margin:0;padding:0}
  .newlist li{padding:7px 0;border-top:1px solid rgba(255,255,255,.06)}
  .newlist li:first-child{border-top:0}
  .newlist a{text-decoration:none}
  .newlist a:hover strong{text-decoration:underline}
  .nl-meta{display:block;color:var(--ink2);font-size:13.5px}
  .bandnote{margin:12px 0 0;color:var(--ink2);font-size:14px}

  h2.sect{font-size:21px;margin:38px 0 4px}
  .sectnote{color:var(--ink2);margin:0 0 18px;max-width:72ch}

  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:18px}
  .card{position:relative;background:var(--panel);border:1px solid var(--line);
    border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
  .card.match{border-color:#2d5a46}
  .card.caution{border-color:#5a4a2a}
  .ribbon{position:absolute;top:12px;left:12px;z-index:3;background:var(--ok);color:#06231a;
    font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;
    padding:4px 9px;border-radius:5px}

  .media{position:relative;aspect-ratio:3/2;background:var(--panel2);overflow:hidden}
  .media img{width:100%;height:100%;object-fit:cover;display:block}
  .media .tile{position:absolute;inset:0;display:none;flex-direction:column;gap:8px;
    align-items:center;justify-content:center;text-decoration:none;color:var(--ink2);
    background:var(--panel2);text-align:center;padding:16px}
  .media.nophoto .tile,.media.failed .tile{display:flex}
  .media.failed img{display:none}
  .tile-ico{font-size:30px;opacity:.5}
  .tile-txt{font-size:13.5px}

  .body{padding:16px 17px 18px;display:flex;flex-direction:column;flex:1}
  .tag{display:inline-block;align-self:flex-start;font-size:11px;font-weight:700;
    letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;border-radius:5px;margin-bottom:10px}
  .tag.ok{background:rgba(61,220,151,.14);color:var(--ok)}
  .tag.warn{background:rgba(245,185,73,.14);color:var(--warn)}
  .price{margin:0;font-size:23px;font-weight:700;letter-spacing:-.3px}
  .pricechg{display:block;font-size:12.5px;font-weight:600;margin-top:2px}
  .pricechg.down{color:var(--ok)} .pricechg.up{color:var(--bad)}
  .addr{margin:8px 0 1px;font-size:16.5px;font-weight:600}
  .city{margin:0;color:var(--ink3);font-size:13px}
  .facts{display:flex;flex-wrap:wrap;gap:6px;margin:13px 0 0}
  .fact{background:var(--panel2);border:1px solid var(--line);border-radius:6px;
    padding:3px 8px;font-size:12.5px;color:var(--ink2)}
  .fact.acres{color:var(--ink);border-color:#36506b}
  .fact.pool{background:rgba(61,220,151,.1);border-color:#2d5a46;color:var(--ok)}
  .fact.nopool{background:rgba(239,100,97,.08);border-color:#5a2f2e;color:var(--bad)}
  .note{color:var(--ink2);font-size:14px;margin:13px 0 16px;flex:1}
  .btn{margin-top:auto;align-self:flex-start;text-decoration:none;font-size:13.5px;font-weight:600;
    border:1px solid var(--line);background:var(--panel2);padding:8px 14px;border-radius:7px}
  .btn:hover{border-color:var(--accent)}

  table{width:100%;border-collapse:collapse;margin-top:8px;font-size:14px}
  th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
  th{color:var(--ink3);font-size:12px;letter-spacing:.06em;text-transform:uppercase;font-weight:600}
  td{color:var(--ink2)}
  details{background:var(--panel);border:1px solid var(--line);border-radius:10px;
    padding:14px 18px;margin-top:14px}
  summary{cursor:pointer;font-weight:600;color:var(--ink)}
  details[open] summary{margin-bottom:6px}

  .how{background:var(--panel);border:1px solid var(--line);border-radius:12px;
    padding:20px 22px;margin-top:34px}
  .how h2{margin:0 0 10px;font-size:18px}
  .how p{color:var(--ink2);font-size:14.5px;max-width:78ch}
  .how code{background:var(--panel2);border:1px solid var(--line);border-radius:4px;
    padding:1px 5px;font-size:13px}
  footer{color:var(--ink3);font-size:13px;margin-top:40px;border-top:1px solid var(--line);padding-top:18px}
  @media (max-width:560px){.wrap{padding:26px 15px 60px}header h1{font-size:25px}}
</style>
</head>
<body>
<div class="wrap">

<header>
  <h1>El Dorado County House Hunt</h1>
  <p class="sub">Homes with a pool on real acreage in Shingle Springs, Rescue and Placerville.</p>
  <p class="stamp">Updated <b>${esc(data.lastRun)}</b> &middot;
    MLS feed timestamp <b>${esc(data.dataQuality.mlsFeedTimestamp || 'n/a')}</b> &middot;
    <b>${matches.length}</b> verified ${matches.length === 1 ? 'match' : 'matches'}</p>
  <div class="criteria">${chips}</div>
</header>

${newBand}

<h2 class="sect">Matches &mdash; all criteria met</h2>
<p class="sectnote">Every property here had its bed count, bath count, lot acreage, Pool-or-Spa
field and Active status read individually off a live MLS record. Sorted cheapest first.</p>
<div class="grid">
${matches.map(card).join('\n')}
</div>

${nearMiss.length ? `<h2 class="sect">Near misses &mdash; one criterion short</h2>
<p class="sectnote">Active listings that miss on exactly one thing. Kept visible because each
failure is the kind worth a judgement call rather than a silent drop.</p>
<div class="grid">
${nearMiss.map(card).join('\n')}
</div>` : ''}

${droppedRows ? `<h2 class="sect">Dropped this run</h2>
<p class="sectnote">Everything carried over from the previous run was checked against the live
feed. None of it survived &mdash; these were the four false positives plus two off-market
holdovers, and all six are now gone from the list rather than lingering.</p>
<table>
  <thead><tr><th>Property</th><th>Why it was dropped</th></tr></thead>
  <tbody>
${droppedRows}
  </tbody>
</table>` : ''}

<details>
  <summary>Checked and rejected this run (${data.rejected.length} properties)</summary>
  <p class="sectnote" style="margin-top:10px">The full audit trail, so the same properties don't get
  re-surfaced as finds on the next run. Pool is far and away the binding constraint: plenty of
  4-bedroom homes on 5+ acres under $1.5M exist in all three towns &mdash; almost none of them have
  a pool.</p>
  <table>
    <thead><tr><th>Property</th><th>Price</th><th>Reason</th></tr></thead>
    <tbody>
${rejectedRows}
    </tbody>
  </table>
</details>

<div class="how">
  <h2>How this list is built</h2>
  <p>${esc(data.dataQuality.note)}</p>
  <p>The rule this tracker runs on: a property is only shown as a match once its status is
  confirmed against a live listing page or MLS record. Search-engine results are used to
  <em>discover</em> candidates and never to confirm them &mdash; search engines index sold listings
  with &ldquo;For Sale&rdquo; in the title for years, which is exactly how the 2026-07-26 run
  produced four properties that were all off market.</p>
  ${sourceRows ? `<table>
    <thead><tr><th>Source</th><th>Role</th></tr></thead>
    <tbody>
${sourceRows}
    </tbody>
  </table>` : ''}
  <p style="margin-top:14px">Rebuild with <code>node build.js</code> after editing
  <code>listings.json</code>. Nothing already tracked is reported again unless its price moves,
  in which case the card shows the delta.</p>
</div>

<footer>
  Generated ${esc(data.lastRun)} from <code>listings.json</code>. Listing data &copy; MetroList
  Services and the respective listing brokerages; shown here for private use. Verify price,
  status and features with the listing agent before acting on anything.
</footer>

</div>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(
  `Built index.html — ${matches.length} matches (${newOnes.length} new), ` +
  `${nearMiss.length} near misses, ${(data.dropped || []).length} dropped, ` +
  `${data.rejected.length} rejected.`
);
