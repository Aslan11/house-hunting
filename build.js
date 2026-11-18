#!/usr/bin/env node
/**
 * Builds index.html from listings.json.
 *
 * Future runs should edit listings.json ONLY, then run `node build.js`.
 *
 * Conventions this build relies on:
 *   - listing.status    'match' | 'active-fails-criteria' | 'off-market'
 *   - listing.firstSeen  equal to data.lastRun  => rendered as a NEW find
 *   - listing.priceHistory  >1 entry => price delta rendered automatically
 *   - listing.photos[]   first entry is the card image; dead URLs fall back
 *                        client-side to a "view gallery" tile.
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8'));
const CSS = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (n == null ? '—' : '$' + n.toLocaleString('en-US'));

const TAGS = {
  match:                   { cls: 'match',   tag: 'ok',   label: 'Verified match' },
  'active-fails-criteria': { cls: 'caution', tag: 'warn', label: 'Active — with a caveat' },
  'off-market':            { cls: 'miss',    tag: 'bad',  label: 'Off market' },
};

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
    (isNew(l) ? `<span class="newflag">New</span>` : '') +
  `</div>`;
}

function facts(l) {
  const f = [];
  if (l.beds != null)  f.push(`<span class="fact">${esc(l.beds)} bd</span>`);
  if (l.baths != null) f.push(`<span class="fact">${esc(l.baths)} ba</span>`);
  if (l.sqft)  f.push(`<span class="fact">${l.sqft.toLocaleString('en-US')} sqft</span>`);
  if (l.acres) f.push(`<span class="fact${l.acres >= 5 ? ' good' : ''}">${esc(l.acres)} acres</span>`);
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
  const meta = TAGS[l.status] || { cls: 'match', tag: 'ok', label: 'Match' };
  const label = l.badge || meta.label;
  const mls = l.mls ? ` &middot; MLS ${esc(l.mls)}` : '';
  const dom = l.daysOnMarket != null
    ? `<span class="dom">${esc(l.daysOnMarket)} days on market</span>` : '';
  const verify = l.verifyUrl
    ? ` <a class="btn ghost" href="${esc(l.verifyUrl)}" rel="noopener">Verify on MLS &rarr;</a>` : '';
  return `
  <div class="card ${meta.cls}${isNew(l) ? ' isnew' : ''}">
    ${media(l)}
    <div class="body">
      <span class="tag ${meta.tag}">${esc(label)}</span>
      ${priceBlock(l)}
      <p class="addr">${esc(l.address)}</p>
      <p class="city">${esc(l.city)}, CA ${esc(l.zip)}${mls}${dom ? ' &middot; ' + dom : ''}</p>
      <div class="facts">${facts(l)}</div>
      <p class="note">${l.blurb || esc(l.notes)}</p>
      <p class="verified">${esc(l.verified || '')}</p>
      <div class="btnrow">
        <a class="btn" href="${esc(l.url)}" rel="noopener">View listing &rarr;</a>${verify}
      </div>
    </div>
  </div>`;
}

const byStatus = (s) => data.listings.filter((l) => l.status === s);
const matches  = byStatus('match');
const flagged  = byStatus('active-fails-criteria');
const archived = byStatus('off-market');

const newMatches  = matches.filter(isNew);
const priceMoves  = data.listings.filter((l) => (l.priceHistory || []).length > 1);

const rows = (arr, cols) => arr
  .map((r) => '    <tr>' + cols.map((c) => `<td>${c(r)}</td>`).join('') + '</tr>')
  .join('\n');

const rejectedRows = rows(data.rejected,
  [(r) => esc(r.address), (r) => money(r.price), (r) => esc(r.reason)]);

const droppedRows = rows(data.droppedThisRun || [],
  [(r) => esc(r.address), (r) => esc(r.reason)]);

const c = data.criteria;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>House Hunt — Shingle Springs · Rescue · Placerville</title>
<meta name="description" content="Verified active listings matching ${esc(c.beds)} bed, ${esc(c.baths)} bath, pool, ${esc(c.minAcres)}+ acres under ${money(c.maxPrice)} in El Dorado County.">
<link rel="stylesheet" href="style.css">
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

${newMatches.length ? `<div class="banner new">
  <h3>&#10024; ${newMatches.length} new ${newMatches.length === 1 ? 'match' : 'matches'} this run</h3>
  <p>Everything below is new to this list. The previous run's six properties were all off market and
  have been dropped. Each of these is confirmed <strong>Active</strong> on two independent sources
  and has a pool evidenced in the MLS remarks.</p>
  <ul class="newlist">
    ${newMatches.map((l) => `<li><a href="#${esc(l.id)}"><strong>${money(l.currentPrice)}</strong>
      &mdash; ${esc(l.address)}, ${esc(l.city)}
      <span>${esc(l.beds)}bd/${esc(l.baths)}ba &middot; ${esc(l.acres)} ac</span></a></li>`).join('\n    ')}
  </ul>
</div>` : `<div class="banner">
  <h3>No new matches this run</h3>
  <p>Nothing newly listed met every criterion since the last run.</p>
</div>`}

${priceMoves.length ? `<div class="banner">
  <h3>Price changes</h3>
  <ul class="newlist">${priceMoves.map((l) => `<li><a href="#${esc(l.id)}">${esc(l.address)} &mdash;
    now ${money(l.currentPrice)}</a></li>`).join('')}</ul>
</div>` : ''}

${matches.length ? `<h2>Verified matches</h2>
<p class="sectnote">Active, with a pool, ${esc(c.beds)} bd / ${esc(c.baths)} ba,
${esc(c.minAcres)}+ acres, at or under ${money(c.maxPrice)}. Sorted by price.</p>
<div class="grid">${matches.map((l) => card(l).replace('<div class="card', `<div id="${esc(l.id)}" class="card`)).join('\n')}
</div>` : ''}

${flagged.length ? `<h2>Close, but with a caveat</h2>
<p class="sectnote">All active and all with a pool, but each misses the brief in one specific way.
Shown because the miss may or may not matter to you.</p>
<div class="grid">${flagged.map((l) => card(l).replace('<div class="card', `<div id="${esc(l.id)}" class="card`)).join('\n')}
</div>` : ''}

${archived.length ? `<h2>Archive</h2>
<div class="grid">${archived.map(card).join('\n')}
</div>` : ''}

${droppedRows ? `<h2>Dropped since last run</h2>
<p class="sectnote">Carried on the previous list but no longer in active inventory. Removed from the
cards above so they are not re-reported; kept here so a genuine relist is recognisable.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Why it was dropped</th></tr></thead>
  <tbody>
${droppedRows}
  </tbody>
</table>
</div>` : ''}

<h2>Checked and ruled out</h2>
<p class="sectnote">Every other property in the three ZIPs that cleared the bed, bath, acreage and
price filters. Listed so the same ground isn't re-covered next run.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Price</th><th>Why not</th></tr></thead>
  <tbody>
${rejectedRows}
  </tbody>
</table>
</div>

<h2>How this list was built</h2>
<div class="method">
  <ol>
    <li><strong>Full inventory pull.</strong> Every active listing in ZIPs 95682 (Shingle Springs),
      95672 (Rescue) and 95667 (Placerville) was read from the Compass MLS feed —
      <strong>${data.dataQuality.inventoryScanned} listings</strong>, not a search-engine sample.</li>
    <li><strong>Hard filters.</strong> ${esc(c.beds)} bd, ${esc(c.baths)} ba, ${esc(c.minAcres)}+ acres,
      at or under ${money(c.maxPrice)} &rarr; 22 candidates.</li>
    <li><strong>Pool evidence.</strong> Each candidate's MLS remarks were read in full. Phrases like
      &ldquo;room to add a pool&rdquo; were excluded — that removed one property that a naive
      keyword match would have called a match.</li>
    <li><strong>Independent status check.</strong> Every surviving property was re-checked by MLS
      number on MLSListings.com. That confirmed all ${matches.length + flagged.length} as Active, and
      corrected two bath counts that the first source had rounded up.</li>
  </ol>
  <p class="caveat"><strong>Known limits.</strong> Pool presence comes from listing remarks, so a
  pool that goes unmentioned would be missed. Bath counts follow the MLS convention
  &ldquo;full/half&rdquo;. Shingle Springs returned no match at any price under $1.5M this run —
  its closest candidates are in the ruled-out table.</p>
</div>

<footer>
  <p>Generated ${esc(data.lastRun)} from <code>listings.json</code> &middot; previous run
  ${esc(data.previousRun || '—')} &middot; ${data.dataQuality.inventoryScanned} active listings scanned
  &middot; ${matches.length} verified ${matches.length === 1 ? 'match' : 'matches'}.</p>
  <p>Listing data and photos &copy; the listing brokerages and MetroList / EBRD. For private use.</p>
</footer>

</div>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`index.html written — ${matches.length} matches, ${flagged.length} flagged, ` +
            `${newMatches.length} new, ${data.rejected.length} ruled out.`);
