#!/usr/bin/env node
/**
 * build.js — renders index.html from listings.json
 *
 * No dependencies.  Run:  node build.js
 * Never hand-edit index.html; edit listings.json and rebuild.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'listings.json'), 'utf8'));

/* ---------- helpers ---------- */

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const money = n => n == null ? '—' : '$' + Number(n).toLocaleString('en-US');
const moneyShort = n => {
  if (n == null) return '—';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(n % 1e6 === 0 ? 1 : 3).replace(/0+$/, '').replace(/\.$/, '') + 'M';
  return '$' + Math.round(n / 1000) + 'K';
};
const num = n => n == null ? '—' : Number(n).toLocaleString('en-US');
const acresTxt = a => a == null ? '—' : (Number.isInteger(a) ? a : a) + ' ac';
const bathsTxt = b => b == null ? '—' : String(b).replace(/\.0$/, '');

const prettyDate = iso => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}, ${y}`;
};

/* ---------- card ---------- */

function statusBadge(l) {
  if (l.status === 'under-contract') {
    return `<span class="badge badge-warn" title="Accepted offer; backup offers may still be considered">Under contract</span>`;
  }
  return `<span class="badge badge-ok">Active</span>`;
}

function priceDelta(l) {
  if (l.priceChange == null || l.priceChange === 0) return '';
  const down = l.priceChange < 0;
  const abs = money(Math.abs(l.priceChange));
  return `<span class="delta ${down ? 'delta-down' : 'delta-up'}">${down ? '▼' : '▲'} ${abs} since last run</span>`;
}

function photoTile(l) {
  const alt = esc(l.address + ', ' + l.city);
  if (l.photos && l.photos.length) {
    const src = esc(l.photos[0]);
    return `<a class="shot" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">
        <img src="${src}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer"
             onerror="this.closest('.shot').classList.add('shot-fallback');this.remove();">
        <span class="shot-fb">View listing photos →</span>
      </a>`;
  }
  return `<a class="shot shot-fallback" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">
      <span class="shot-fb">View listing photos →</span></a>`;
}

function card(l) {
  const specs = [
    [l.beds, 'bd'], [bathsTxt(l.baths), 'ba'],
    [num(l.sqft), 'sq ft'], [l.acres, 'acres'],
  ].map(([v, k]) => `<div class="spec"><b>${esc(v)}</b><span>${k}</span></div>`).join('');

  const extras = [];
  if (l.poolDetail) extras.push(['Pool', l.poolDetail]);
  if (l.yearBuilt) extras.push(['Built', l.yearBuilt]);
  if (l.view) extras.push(['View', l.view]);
  if (l.horseProperty) extras.push(['Horse property', 'Yes']);
  if (l.schoolDistrict) extras.push(['Schools', l.schoolDistrict]);

  const hist = (l.priceHistory || []).length > 1
    ? `<div class="hist">${l.priceHistory.map(h => `${prettyDate(h.date)}: ${money(h.price)}`).join(' → ')}</div>`
    : '';

  return `<article class="card${l.isNew ? ' card-new' : ''}${l.status === 'under-contract' ? ' card-uc' : ''}">
  ${l.isNew ? '<div class="newflag">New this run</div>' : ''}
  ${photoTile(l)}
  <div class="body">
    <div class="pricerow">
      <div class="price">${money(l.currentPrice)}</div>
      ${statusBadge(l)}
    </div>
    ${priceDelta(l)}
    <h3><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.address)}</a></h3>
    <div class="loc">${esc(l.city)}, CA ${esc(l.zip)} · MLS #${esc(l.mls)}</div>
    <div class="specs">${specs}</div>
    <dl class="extras">
      ${extras.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
    </dl>
    ${l.desc ? `<p class="desc">${esc(l.desc.slice(0, 340))}${l.desc.length > 340 ? '…' : ''}</p>` : ''}
    ${hist}
    <div class="foot">
      <span class="agent">${esc(l.agent || '')}</span>
      <a class="link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">MLS listing →</a>
    </div>
  </div>
</article>`;
}

/* ---------- sections ---------- */

const C = data.criteria;
const listings = data.listings || [];
const newOnes = listings.filter(l => l.isNew);
const active = listings.filter(l => l.status === 'match');
const uc = listings.filter(l => l.status === 'under-contract');

const criteriaChips = [
  `${C.beds} beds`, `${C.baths} baths`, 'Pool required',
  `${C.minAcres}+ acres (${C.preferredAcres}+ preferred)`,
  `≤ ${moneyShort(C.maxPrice)}`,
].map(c => `<span class="chip">${esc(c)}</span>`).join('');

const newBanner = newOnes.length ? `
<section class="spotlight">
  <div class="spotlight-head">
    <h2>★ New this run <span class="count">${newOnes.length}</span></h2>
    <p>Added on ${prettyDate(data.lastRun)} — not on the previous list.</p>
  </div>
  <ol class="newlist">
    ${newOnes.map(l => `<li>
      <a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.address)}</a>
      <span class="nl-city">${esc(l.city)}</span>
      <span class="nl-price">${money(l.currentPrice)}</span>
      <span class="nl-spec">${esc(l.beds)}bd · ${esc(bathsTxt(l.baths))}ba · ${esc(l.acres)} ac · pool</span>
      ${l.status === 'under-contract' ? '<span class="badge badge-warn">Under contract</span>' : ''}
    </li>`).join('')}
  </ol>
</section>` : `
<section class="spotlight spotlight-empty">
  <h2>No new listings this run</h2>
  <p>Everything below was already on the list as of ${prettyDate(data.lastRun)}.</p>
</section>`;

const nm = data.nearMisses || [];
const nearMissSection = nm.length ? `
<section>
  <h2>Near misses <span class="count">${nm.length}</span></h2>
  <p class="sub">Active MLS listings that clear 4bd / 3ba / ${moneyShort(C.maxPrice)} but fail acreage or pool. Listed so a later price cut or correction is easy to spot.</p>
  <div class="tablewrap">
  <table>
    <thead><tr><th>Address</th><th>Price</th><th>Bd/Ba</th><th>Sq ft</th><th>Acres</th><th>Pool</th><th>Falls short on</th></tr></thead>
    <tbody>
      ${nm.map(x => `<tr>
        <td><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.address.replace(/,\s*CA\s*9\d{4}$/, ''))}</a></td>
        <td class="n">${money(x.price)}</td>
        <td class="n">${esc(x.beds)}/${esc(bathsTxt(x.baths))}</td>
        <td class="n">${num(x.sqft)}</td>
        <td class="n">${esc(x.acres)}</td>
        <td>${x.pool ? '<span class="yes">Yes</span>' : '<span class="no">No</span>'}</td>
        <td class="short">${esc(x.missing)}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  </div>
</section>` : '';

const dropped = data.droppedThisRun || [];
const droppedSection = dropped.length ? `
<section>
  <h2>Dropped this run <span class="count">${dropped.length}</span></h2>
  <p class="sub">Previously tracked, no longer in MetroList active inventory — sold or withdrawn. Kept here only so they are not re-surfaced.</p>
  <ul class="dropped">
    ${dropped.map(x => `<li><span class="da">${esc(x.address)}</span>${x.lastPrice ? `<span class="dp">last seen at ${money(x.lastPrice)}</span>` : ''}</li>`).join('')}
  </ul>
</section>` : '';

/* ---------- page ---------- */

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>House Hunt — Shingle Springs · Rescue · Placerville</title>
<meta name="description" content="Verified MLS listings matching 4BR+, 3BA+, pool, 2.5+ acres, under $1.5M in Shingle Springs, Rescue and Placerville, CA.">
<style>
  :root{
    --bg:#f6f7f4; --panel:#fff; --ink:#1b2019; --muted:#5f6b60; --line:#e2e6de;
    --accent:#2f6b45; --accent-soft:#e8f2ea; --gold:#b07d2a; --gold-soft:#fdf5e6;
    --warn:#8a5a12; --warnbg:#fdf3e0; --okbg:#e8f2ea; --ok:#2f6b45;
    --shadow:0 1px 2px rgba(20,30,20,.05),0 8px 24px -12px rgba(20,30,20,.18);
    --radius:14px;
  }
  @media (prefers-color-scheme:dark){
    :root:not([data-theme="light"]){
      --bg:#141714; --panel:#1c211d; --ink:#e8ece6; --muted:#9aa89c; --line:#2b332c;
      --accent:#7fc49a; --accent-soft:#1e2a22; --gold:#e0b367; --gold-soft:#2a2316;
      --warn:#e0b367; --warnbg:#2a2316; --okbg:#1e2a22; --ok:#7fc49a;
      --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 28px -14px rgba(0,0,0,.7);
    }
  }
  :root[data-theme="dark"]{
    --bg:#141714; --panel:#1c211d; --ink:#e8ece6; --muted:#9aa89c; --line:#2b332c;
    --accent:#7fc49a; --accent-soft:#1e2a22; --gold:#e0b367; --gold-soft:#2a2316;
    --warn:#e0b367; --warnbg:#2a2316; --okbg:#1e2a22; --ok:#7fc49a;
  }
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{
    margin:0; background:var(--bg); color:var(--ink);
    font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  }
  .wrap{max-width:1120px;margin:0 auto;padding:0 16px 72px}
  a{color:var(--accent)}
  h1,h2,h3{line-height:1.2;margin:0}

  header.top{padding:40px 0 22px;border-bottom:1px solid var(--line);margin-bottom:28px}
  header.top h1{font-size:clamp(25px,4.6vw,38px);letter-spacing:-.02em}
  header.top .where{color:var(--muted);margin-top:7px;font-size:15px}
  .chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:16px}
  .chip{background:var(--accent-soft);color:var(--accent);border:1px solid color-mix(in srgb,var(--accent) 26%,transparent);
        padding:4px 11px;border-radius:999px;font-size:12.5px;font-weight:600;white-space:nowrap}
  .meta{margin-top:16px;color:var(--muted);font-size:13px}
  .meta b{color:var(--ink)}

  section{margin:40px 0 0}
  section>h2{font-size:21px;letter-spacing:-.01em;display:flex;align-items:center;gap:9px;flex-wrap:wrap}
  .count{background:var(--accent);color:#fff;border-radius:999px;font-size:12px;padding:2px 9px;font-weight:700}
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .count{color:#10150f}}
  p.sub{color:var(--muted);font-size:14px;margin:8px 0 18px;max-width:72ch}

  /* spotlight */
  .spotlight{background:var(--gold-soft);border:1px solid color-mix(in srgb,var(--gold) 38%,transparent);
    border-radius:var(--radius);padding:20px 22px;margin:0 0 8px}
  .spotlight h2{font-size:19px;color:var(--gold);display:flex;align-items:center;gap:9px;flex-wrap:wrap}
  .spotlight h2 .count{background:var(--gold);color:#fff}
  .spotlight p{color:var(--muted);font-size:13.5px;margin:6px 0 0}
  .spotlight-empty h2{color:var(--muted)}
  .newlist{list-style:none;margin:16px 0 0;padding:0;display:grid;gap:8px}
  .newlist li{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 11px;
    background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 13px}
  .newlist a{font-weight:650;text-decoration:none}
  .newlist a:hover{text-decoration:underline}
  .nl-city{color:var(--muted);font-size:13px}
  .nl-price{font-variant-numeric:tabular-nums;font-weight:700;margin-left:auto}
  .nl-spec{color:var(--muted);font-size:12.5px;width:100%}
  @media(min-width:620px){.nl-spec{width:auto;margin-left:0}}

  /* cards */
  .grid{display:grid;gap:20px;margin-top:20px;grid-template-columns:1fr}
  @media(min-width:760px){.grid{grid-template-columns:repeat(2,1fr)}}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);
        overflow:hidden;box-shadow:var(--shadow);display:flex;flex-direction:column;position:relative}
  .card-new{border-color:color-mix(in srgb,var(--gold) 55%,transparent)}
  .newflag{position:absolute;top:12px;left:12px;z-index:2;background:var(--gold);color:#fff;
    font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;padding:4px 9px;border-radius:6px}
  .shot{display:block;position:relative;aspect-ratio:16/10;background:var(--accent-soft);overflow:hidden;text-decoration:none}
  .shot img{width:100%;height:100%;object-fit:cover;display:block}
  .shot-fb{display:none;position:absolute;inset:0;align-items:center;justify-content:center;
    color:var(--accent);font-weight:600;font-size:14px}
  .shot-fallback .shot-fb{display:flex}
  .body{padding:16px 17px 17px;display:flex;flex-direction:column;flex:1}
  .pricerow{display:flex;align-items:center;gap:10px;justify-content:space-between}
  .price{font-size:24px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
  .badge{font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap}
  .badge-ok{background:var(--okbg);color:var(--ok)}
  .badge-warn{background:var(--warnbg);color:var(--warn)}
  .delta{display:inline-block;margin-top:5px;font-size:12.5px;font-weight:600}
  .delta-down{color:var(--ok)} .delta-up{color:#b3261e}
  .card h3{margin-top:9px;font-size:17px}
  .card h3 a{text-decoration:none;color:var(--ink)}
  .card h3 a:hover{text-decoration:underline}
  .loc{color:var(--muted);font-size:12.5px;margin-top:3px}
  .specs{display:flex;gap:7px;margin:14px 0 0;flex-wrap:wrap}
  .spec{background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:7px 10px;
        text-align:center;min-width:62px;flex:1}
  .spec b{display:block;font-size:15px;font-variant-numeric:tabular-nums}
  .spec span{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
  .extras{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin:14px 0 0;font-size:13px}
  .extras dt{color:var(--muted)} .extras dd{margin:0}
  .desc{color:var(--muted);font-size:13.5px;margin:13px 0 0}
  .hist{margin-top:10px;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
  .foot{margin-top:auto;padding-top:14px;display:flex;gap:10px;align-items:baseline;
        justify-content:space-between;border-top:1px solid var(--line);margin-top:15px}
  .agent{color:var(--muted);font-size:11.5px}
  .link{font-size:13px;font-weight:650;text-decoration:none;white-space:nowrap}
  .link:hover{text-decoration:underline}

  /* table */
  .tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel)}
  table{border-collapse:collapse;width:100%;font-size:13.5px;min-width:660px}
  th,td{padding:10px 13px;text-align:left;border-bottom:1px solid var(--line)}
  th{background:var(--bg);font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700}
  tr:last-child td{border-bottom:0}
  td.n{font-variant-numeric:tabular-nums;white-space:nowrap}
  td a{text-decoration:none;font-weight:600}
  td a:hover{text-decoration:underline}
  .yes{color:var(--ok);font-weight:700} .no{color:var(--muted)}
  .short{color:var(--muted)}

  .dropped{list-style:none;padding:0;margin:0;display:grid;gap:7px}
  .dropped li{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;background:var(--panel);
    border:1px solid var(--line);border-radius:9px;padding:9px 13px;font-size:13.5px}
  .da{font-weight:600} .dp{color:var(--muted);font-size:12.5px}

  .note{margin-top:44px;background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--accent);
        border-radius:10px;padding:16px 18px;font-size:13.5px;color:var(--muted)}
  .note h3{font-size:14px;color:var(--ink);margin-bottom:7px}
  .note ul{margin:7px 0 0;padding-left:19px} .note li{margin:4px 0}
  footer{margin-top:40px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:12.5px}
</style>
</head>
<body>
<div class="wrap">

<header class="top">
  <h1>House Hunt</h1>
  <div class="where">Shingle Springs · Rescue · Placerville, California</div>
  <div class="chips">${criteriaChips}</div>
  <div class="meta">
    Last run <b>${prettyDate(data.lastRun)}</b> ·
    <b>${active.length}</b> active match${active.length === 1 ? '' : 'es'}${uc.length ? ` · <b>${uc.length}</b> under contract` : ''} ·
    ${data.dataQuality && data.dataQuality.inventoryScanned ? `<b>${num(data.dataQuality.inventoryScanned)}</b> active listings scanned · ` : ''}
    verified against <b>MetroList MLS</b>
  </div>
</header>

${newBanner}

<section>
  <h2>Matches <span class="count">${listings.length}</span></h2>
  <p class="sub">Every property below clears all five criteria. Acreage and pool come from the MLS <em>Lot Size in Acres</em> and <em>Has a Pool</em> fields; status comes from the MLS status badge on the listing detail page.</p>
  <div class="grid">
    ${listings.map(card).join('\n')}
  </div>
</section>

${nearMissSection}

${droppedSection}

<div class="note">
  <h3>How this list is built</h3>
  <ul>
    <li>Source of record: <a href="https://www.metrolistpro.com/" target="_blank" rel="noopener noreferrer">MetroListPRO</a>, the official public search site of MetroList MLS — the MLS for El Dorado County.</li>
    <li>Status, lot acreage and pool are read from each listing's MLS detail page. Search-engine summaries are never used for status: they index sold listings as "For Sale" for years.</li>
    ${data.dataQuality && data.dataQuality.coverageCrossCheck ? `<li>${esc(data.dataQuality.coverageCrossCheck)}</li>` : ''}
    <li>Listings that leave active inventory are dropped, not carried forward. Price changes on tracked properties are shown on the card.</li>
    <li>Photos are hotlinked from MetroList and are the copyright of the listing brokerage — fine for private use, don't republish.</li>
  </ul>
</div>

<footer>
  Generated ${prettyDate(data.lastRun)} by <code>build.js</code> from <code>listings.json</code>.
  Listing data © MetroList Services, Inc. Information deemed reliable but not guaranteed — verify with the listing agent.
</footer>

</div>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, 'index.html'), html);
console.log(`index.html written — ${listings.length} matches (${active.length} active, ${uc.length} under contract), ${nm.length} near misses, ${dropped.length} dropped.`);
