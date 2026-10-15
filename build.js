#!/usr/bin/env node
// Renders index.html from listings.json. No dependencies:  node build.js
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'listings.json'), 'utf8'));

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US'));
const short = (n) => (n == null ? '—' : n >= 1e6 ? '$' + (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 2) + 'M' : '$' + Math.round(n / 1000) + 'K');

function host(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'listing'; }
}

/* ---------- card pieces ---------- */

function media(l) {
  const photos = (l.photos || []).slice(0, 5);
  if (!photos.length) {
    return `<a class="shots empty" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">
      <span>View photos on ${esc(host(l.url))}</span></a>`;
  }
  const [hero, ...rest] = photos;
  return `<a class="shots" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">
      <div class="hero"><img src="${esc(hero)}" alt="${esc(l.address)}" loading="lazy"
           referrerpolicy="no-referrer" onerror="this.closest('.shots').classList.add('broken')"></div>
      <div class="thumbs">${rest.slice(0, 4).map((p, i) => `<div class="thumb"><img src="${esc(p)}"
           alt="${esc(l.address)} photo ${i + 2}" loading="lazy" referrerpolicy="no-referrer"
           onerror="this.closest('.thumb').remove()"></div>`).join('')}</div>
    </a>`;
}

function acreBadge(a) {
  if (a == null) return '';
  const pref = a >= (data.criteria.preferredAcres || 5);
  return `<span class="chip ${pref ? 'chip-good' : ''}">${a} acres${pref ? ' ★' : ''}</span>`;
}

function facts(l) {
  return `<ul class="facts">
      <li><b>${l.beds}</b> bd</li>
      <li><b>${l.baths}</b> ba</li>
      <li><b>${l.sqft ? Number(l.sqft).toLocaleString('en-US') : '—'}</b> sqft</li>
      <li><b>${l.acres ?? '—'}</b> ac</li>
      ${l.yearBuilt ? `<li>built <b>${l.yearBuilt}</b></li>` : ''}
    </ul>`;
}

function priceBlock(l) {
  const hist = l.priceHistory || [];
  let delta = '';
  if (hist.length > 1) {
    const prev = hist[hist.length - 2].price;
    const now = l.currentPrice;
    if (prev != null && now != null && prev !== now) {
      const down = now < prev;
      const pct = Math.abs(((now - prev) / prev) * 100).toFixed(1);
      delta = `<span class="delta ${down ? 'down' : 'up'}">${down ? '▼' : '▲'} ${money(Math.abs(now - prev))} (${pct}%) from ${money(prev)}</span>`;
    }
  }
  const ppsf = l.sqft && l.currentPrice ? ` · $${Math.round(l.currentPrice / l.sqft)}/sqft` : '';
  return `<div class="price">${money(l.currentPrice)}<span class="ppsf">${ppsf}</span>${delta}</div>`;
}

function evidence(l) {
  const e = l.poolEvidence || {};
  const bits = [];
  if (e.mlsAmenity) bits.push('MLS pool field');
  if (e.publicRecord === 'true' || e.publicRecord === true) bits.push('county record');
  if (e.subjectPhotos) bits.push(`${e.subjectPhotos} pool photo${e.subjectPhotos === 1 ? '' : 's'}`);
  return bits.length ? `<span class="ev" title="How the pool was confirmed">✓ ${bits.join(' · ')}</span>` : '';
}

function card(l, opts = {}) {
  const isNew = opts.flagNew && l.newThisRun;
  return `<article class="card${isNew ? ' is-new' : ''}">
    ${media(l)}
    <div class="body">
      <div class="cardtop">
        <h3><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.address)}</a></h3>
        ${isNew ? '<span class="tag tag-new">NEW</span>' : ''}
      </div>
      <p class="where">${esc(l.city)}, CA ${esc(l.zip)} · MLS ${esc(l.mls)}</p>
      ${priceBlock(l)}
      ${facts(l)}
      <div class="chips">
        ${acreBadge(l.acres)}
        ${l.pool ? '<span class="chip chip-pool">Pool</span>' : ''}
        <span class="chip chip-live">${esc(l.verifiedStatus || 'Active')}</span>
        ${l.daysOnMarket != null ? `<span class="chip">${l.daysOnMarket} days on market</span>` : ''}
      </div>
      ${l.poolDetail ? `<p class="pooldetail">🏊 ${esc(l.poolDetail)}</p>` : ''}
      ${evidence(l)}
      ${l.remarks ? `<p class="remarks">${esc(l.remarks)}</p>` : ''}
      <p class="links"><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">Full listing on ${esc(host(l.url))} →</a></p>
    </div>
  </article>`;
}

/* ---------- page ---------- */

const matches = data.listings || [];
const fresh = matches.filter((l) => l.newThisRun);
const returning = matches.filter((l) => !l.newThisRun);
const near = data.nearMisses || [];
const dropped = data.dropped || [];
const rejected = data.rejected || [];

const c = data.criteria;
const cheapest = matches.reduce((a, l) => (a == null || l.currentPrice < a ? l.currentPrice : a), null);
const biggest = matches.reduce((a, l) => (a == null || l.acres > a ? l.acres : a), null);

const newBanner = fresh.length
  ? `<section class="band">
      <h2><span class="dot"></span>${fresh.length} new ${fresh.length === 1 ? 'match' : 'matches'} this run</h2>
      <p class="bandsub">Added ${esc(data.lastRun)}. Everything here is confirmed <b>Active</b> on its live listing page today, with a pool confirmed from MLS data.</p>
      <ol class="newlist">
        ${fresh.map((l) => `<li><a href="#${esc(l.id)}">${esc(l.address)}, ${esc(l.city)}</a>
           <span>${short(l.currentPrice)} · ${l.beds}bd/${l.baths}ba · ${l.acres} ac</span></li>`).join('')}
      </ol>
    </section>`
  : `<section class="band band-quiet">
      <h2>No new matches this run</h2>
      <p class="bandsub">Checked ${esc(data.lastRun)}. The list below is unchanged from the previous run.</p>
    </section>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>House Hunt — Shingle Springs · Rescue · Placerville</title>
<meta name="description" content="Tracked 4BR+/3BA+ homes with a pool on 2.5+ acres in Shingle Springs, Rescue and Placerville, CA under $1.5M.">
<style>
  :root{
    --bg:#f6f7f5; --card:#fff; --ink:#1a1f1c; --muted:#5f6b63; --line:#e2e6e1;
    --accent:#1f6f4a; --accent-soft:#e7f3ec; --new:#b4551a; --new-soft:#fdf0e6;
    --good:#1f6f4a; --down:#1f6f4a; --up:#a8321f; --shadow:0 1px 2px rgba(20,30,24,.06),0 8px 24px rgba(20,30,24,.05);
  }
  @media (prefers-color-scheme:dark){
    :root:not([data-theme=light]){
      --bg:#12150f; --card:#1b1f19; --ink:#eef1e9; --muted:#a3ada3; --line:#2b312a;
      --accent:#6fc294; --accent-soft:#1d2a22; --new:#f0a267; --new-soft:#2d2016;
      --good:#6fc294; --down:#6fc294; --up:#e8836e; --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.3);
    }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    -webkit-font-smoothing:antialiased}
  .wrap{max-width:1140px;margin:0 auto;padding:0 16px 72px}
  header.top{padding:40px 0 8px}
  h1{font-size:clamp(26px,4vw,38px);line-height:1.15;margin:0 0 6px;letter-spacing:-.02em}
  .sub{color:var(--muted);margin:0 0 18px}
  .crit{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 6px;padding:0;list-style:none}
  .crit li{background:var(--card);border:1px solid var(--line);border-radius:999px;
    padding:5px 12px;font-size:13px;color:var(--muted)}
  .crit li b{color:var(--ink)}
  .stats{display:flex;flex-wrap:wrap;gap:22px;margin:22px 0 0;padding:18px 0 0;border-top:1px solid var(--line)}
  .stat .n{font-size:24px;font-weight:650;letter-spacing:-.02em}
  .stat .l{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em}

  .band{background:var(--new-soft);border:1px solid color-mix(in srgb,var(--new) 28%,transparent);
    border-radius:14px;padding:18px 20px;margin:28px 0 8px}
  .band h2{margin:0 0 4px;font-size:19px;display:flex;align-items:center;gap:9px;letter-spacing:-.01em}
  .band .dot{width:9px;height:9px;border-radius:50%;background:var(--new);flex:none;
    box-shadow:0 0 0 4px color-mix(in srgb,var(--new) 20%,transparent)}
  .bandsub{margin:0 0 12px;color:var(--muted);font-size:14px}
  .band-quiet{background:var(--card);border-color:var(--line)}
  .newlist{margin:0;padding-left:20px;display:grid;gap:7px}
  .newlist li{font-size:14.5px}
  .newlist a{color:var(--ink);font-weight:600;text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--new) 45%,transparent)}
  .newlist a:hover{color:var(--new)}
  .newlist span{color:var(--muted);font-size:13px;margin-left:6px}

  h2.sec{font-size:15px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);
    margin:42px 0 14px;padding-bottom:9px;border-bottom:1px solid var(--line);font-weight:650}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:20px}

  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;
    box-shadow:var(--shadow);display:flex;flex-direction:column;scroll-margin-top:16px}
  .card.is-new{border-color:color-mix(in srgb,var(--new) 45%,transparent)}
  .shots{display:block;text-decoration:none}
  .shots .hero{aspect-ratio:3/2;background:var(--accent-soft);overflow:hidden}
  .shots .hero img{width:100%;height:100%;object-fit:cover;display:block}
  .shots .thumbs{display:grid;grid-template-columns:repeat(4,1fr);gap:2px;background:var(--line)}
  .shots .thumb{aspect-ratio:1;overflow:hidden;background:var(--accent-soft)}
  .shots .thumb img{width:100%;height:100%;object-fit:cover;display:block}
  .shots.empty,.shots.broken .hero{display:flex;align-items:center;justify-content:center;
    aspect-ratio:3/2;background:var(--accent-soft);color:var(--accent);font-size:14px;font-weight:600;text-align:center;padding:12px}
  .shots.broken img,.shots.broken .thumbs{display:none}

  .body{padding:16px 17px 17px;display:flex;flex-direction:column;gap:9px;flex:1}
  .cardtop{display:flex;align-items:flex-start;gap:10px;justify-content:space-between}
  .card h3{margin:0;font-size:17.5px;letter-spacing:-.01em;line-height:1.3}
  .card h3 a{color:var(--ink);text-decoration:none}
  .card h3 a:hover{color:var(--accent)}
  .tag{font-size:10.5px;font-weight:750;letter-spacing:.09em;padding:3px 8px;border-radius:5px;flex:none;margin-top:2px}
  .tag-new{background:var(--new);color:#fff}
  .where{margin:0;color:var(--muted);font-size:12.5px}
  .price{font-size:22px;font-weight:650;letter-spacing:-.02em;display:flex;flex-wrap:wrap;align-items:baseline;gap:8px}
  .ppsf{font-size:12.5px;font-weight:400;color:var(--muted)}
  .delta{font-size:12.5px;font-weight:600;width:100%}
  .delta.down{color:var(--down)} .delta.up{color:var(--up)}
  .facts{display:flex;flex-wrap:wrap;gap:0;margin:0;padding:0;list-style:none;font-size:13.5px;color:var(--muted)}
  .facts li{padding-right:11px;margin-right:11px;border-right:1px solid var(--line)}
  .facts li:last-child{border:0;margin:0;padding:0}
  .facts b{color:var(--ink);font-weight:650}
  .chips{display:flex;flex-wrap:wrap;gap:6px}
  .chip{font-size:12px;background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:3px 10px;color:var(--muted)}
  .chip-good{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:600}
  .chip-pool{background:var(--accent);border-color:transparent;color:#fff;font-weight:600}
  .chip-live{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:600}
  .pooldetail{margin:0;font-size:13.5px;color:var(--ink)}
  .ev{font-size:11.5px;color:var(--accent);font-weight:600}
  .remarks{margin:0;font-size:13px;color:var(--muted);line-height:1.5}
  .links{margin:auto 0 0;padding-top:4px;font-size:13px}
  .links a{color:var(--accent);text-decoration:none;font-weight:600}
  .links a:hover{text-decoration:underline}

  table{width:100%;border-collapse:collapse;font-size:13.5px;background:var(--card);
    border:1px solid var(--line);border-radius:12px;overflow:hidden}
  th,td{text-align:left;padding:10px 13px;border-bottom:1px solid var(--line);vertical-align:top}
  th{font-size:11.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:650;background:var(--bg)}
  tr:last-child td{border-bottom:0}
  td a{color:var(--accent);text-decoration:none} td a:hover{text-decoration:underline}
  .num{white-space:nowrap}

  .note{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--accent);
    border-radius:10px;padding:15px 17px;margin:20px 0;font-size:13.5px;color:var(--muted)}
  .note b{color:var(--ink)}
  .note ul{margin:8px 0 0;padding-left:20px}
  footer{margin-top:52px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:12.5px}
  @media (max-width:560px){
    .grid{grid-template-columns:1fr}
    .stats{gap:16px}
    table{display:block;overflow-x:auto}
  }
</style>
</head>
<body>
<div class="wrap">
<header class="top">
  <h1>House hunt — Shingle Springs · Rescue · Placerville</h1>
  <p class="sub">Verified active listings matching your criteria. Last checked <b>${esc(data.lastRun)}</b>.</p>
  <ul class="crit">
    <li><b>${esc(c.beds)}</b> beds</li>
    <li><b>${esc(c.baths)}</b> baths</li>
    <li><b>Pool</b> required</li>
    <li><b>${c.minAcres}+</b> acres <span>(${c.preferredAcres}+ preferred)</span></li>
    <li>under <b>${money(c.maxPrice)}</b></li>
  </ul>
  <div class="stats">
    <div class="stat"><div class="n">${matches.length}</div><div class="l">Matches</div></div>
    <div class="stat"><div class="n">${fresh.length}</div><div class="l">New this run</div></div>
    <div class="stat"><div class="n">${short(cheapest)}</div><div class="l">Lowest priced</div></div>
    <div class="stat"><div class="n">${biggest ?? '—'}</div><div class="l">Largest (acres)</div></div>
    <div class="stat"><div class="n">${near.length}</div><div class="l">Near misses</div></div>
  </div>
</header>

${newBanner}

<h2 class="sec">Matches — ${matches.length} active, largest lot first</h2>
<div class="grid">
${matches.map((l) => card(l, { flagNew: true }).replace('<article class="card', `<article id="${esc(l.id)}" class="card`)).join('\n')}
</div>

${returning.length ? '' : ''}

${near.length ? `<h2 class="sec">Near misses — everything but the pool (${near.length})</h2>
<p class="note" style="border-left-color:var(--muted)">These are active, in the right towns, and clear the bedroom, bathroom, acreage and price bars. They have <b>no pool</b>. Listed in case adding one is on the table — several sit on 5+ acres with room for it.</p>
<table>
<thead><tr><th>Address</th><th>City</th><th class="num">Price</th><th class="num">Bd/Ba</th><th class="num">Acres</th><th class="num">Sqft</th><th class="num">DOM</th></tr></thead>
<tbody>
${near.map((n) => `<tr>
  <td><a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.address)}</a></td>
  <td>${esc(n.city)}</td><td class="num">${money(n.price)}</td>
  <td class="num">${n.beds}/${n.baths}</td><td class="num">${n.acres}</td>
  <td class="num">${n.sqft ? Number(n.sqft).toLocaleString('en-US') : '—'}</td>
  <td class="num">${n.daysOnMarket ?? '—'}</td></tr>`).join('')}
</tbody></table>` : ''}

${dropped.length ? `<h2 class="sec">Dropped this run — sold or off market (${dropped.length})</h2>
<table>
<thead><tr><th>Address</th><th>City</th><th>Status</th><th>Why it was dropped</th></tr></thead>
<tbody>
${dropped.map((d) => `<tr><td>${esc(d.address)}</td><td>${esc(d.city)}</td>
  <td>${esc(d.verifiedStatus)}</td><td>${esc(d.reason)}</td></tr>`).join('')}
</tbody></table>` : ''}

${rejected.length ? `<h2 class="sec">Checked and ruled out (${rejected.length})</h2>
<table>
<thead><tr><th>Address</th><th class="num">Price</th><th>Reason</th></tr></thead>
<tbody>
${rejected.map((r) => `<tr><td>${esc(r.address)}</td><td class="num">${r.price ? money(r.price) : '—'}</td>
  <td>${esc(r.reason)}</td></tr>`).join('')}
</tbody></table>` : ''}

<h2 class="sec">How these were verified</h2>
<div class="note">
  <b>Every listing above was checked live, not inferred.</b>
  <ul>
    <li><b>Status:</b> read from each property's own listing page (<code>mlsStatusDisplay</code>), and the price on the page matches the price in the feed. All ${matches.length} read <b>Active</b>.</li>
    <li><b>Pool:</b> confirmed from data attributed to that property — its MetroList <i>Pool Information</i> field, the county pool record, and photos keyed to its own MLS number. Page text alone is not trusted: listing pages embed <i>other</i> properties' descriptions, which is what produced a false match in an earlier run.</li>
    <li><b>Cross-check:</b> ${esc(data.dataQuality.method)}</li>
    <li><b>Coverage:</b> ${esc(data.dataQuality.coverage)}</li>
  </ul>
</div>

<footer>
  Built ${esc(data.lastRun)} from <code>listings.json</code>. Sources: ${esc(data.dataSource.primary)}; cross-checked against ${esc(data.dataSource.crossCheck)}.
  Photos are hotlinked from the listing brokerages and remain their copyright — fine for private house hunting, not for republishing.
</footer>
</div>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, 'index.html'), html);
console.log(`index.html written — ${matches.length} matches (${fresh.length} new), ${near.length} near misses, ${dropped.length} dropped, ${rejected.length} ruled out`);
