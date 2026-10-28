#!/usr/bin/env node
/**
 * Builds index.html from listings.json.
 *
 * Future runs should edit listings.json ONLY, then run `node build.js`.
 * Photos: add URLs to a listing's `photos` array and they render automatically.
 * If `photos` is empty, the card falls back to a "View photos" tile pointing at
 * `gallery` (or `url`). If a hotlinked photo fails to load in the browser, the
 * same tile is swapped in client-side, so a dead image URL never leaves a hole.
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (n == null ? '—' : '$' + n.toLocaleString('en-US'));

const TAGS = {
  match:                  { cls: 'match',   tag: 'ok',   label: 'Verified match' },
  'near-miss':            { cls: 'caution', tag: 'warn', label: 'Near miss' },
  'active-fails-criteria':{ cls: 'caution', tag: 'warn', label: 'Active — fails criteria' },
  'off-market':           { cls: 'miss',    tag: 'bad',  label: 'Off market' },
};

/** A listing first seen on this run is "new". */
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
  if (l.acres) f.push(`<span class="fact">${esc(l.acres)} acres</span>`);
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
  const newPill = isNew(l) ? `<span class="tag new">New this run</span>` : '';
  return `
  <div class="card ${meta.cls}${isNew(l) ? ' isnew' : ''}" id="${esc(l.id)}">
    ${media(l)}
    <div class="body">
      <div class="tags">${newPill}<span class="tag ${meta.tag}">${esc(label)}</span></div>
      ${priceBlock(l)}
      <p class="addr">${esc(l.address)}</p>
      <p class="city">${esc(l.city)}, CA ${esc(l.zip)}${mls}</p>
      <div class="facts">${facts(l)}</div>
      <p class="note">${l.blurb || esc(l.notes)}</p>
      <a class="btn" href="${esc(l.url)}" rel="noopener">View listing &rarr;</a>
    </div>
  </div>`;
}

const byStatus = (s) => data.listings.filter((l) => l.status === s);
const matches  = byStatus('match').sort((a, b) => b.currentPrice - a.currentPrice);
const nearMiss = byStatus('near-miss');
const active   = byStatus('active-fails-criteria');
const archived = byStatus('off-market');
const fresh    = data.listings.filter(isNew);
const dropped  = data.droppedThisRun || [];

const acreNote = (l) => (l.acres >= 5 ? '' : ` &middot; under the 5-acre preference`);
const freshRows = fresh.map((l) => `      <li><a href="#${esc(l.id)}"><strong>${esc(l.address)}</strong>, ${esc(l.city)}</a>
        &mdash; ${money(l.currentPrice)} &middot; ${esc(l.beds)}bd/${esc(l.baths)}ba &middot; ${esc(l.acres)} acres
        &middot; ${esc(l.poolDetail || 'pool')}${l.status === 'near-miss' ? ' <em>(near miss)</em>' : acreNote(l)}</li>`).join('\n');

const droppedRows = dropped
  .map((d) => `    <tr><td>${esc(d.address)}</td><td>${esc(d.reason)}</td></tr>`)
  .join('\n');

const rejectedRows = data.rejected
  .map((r) => `    <tr><td>${esc(r.address)}</td><td>${money(r.price)}</td><td>${esc(r.reason)}</td></tr>`)
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
    --tile:#ece7de;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#16181a; --card:#1f2225; --ink:#eceae6; --muted:#a09a91;
      --line:#31363a; --accent:#7fc4a1; --accent-soft:#1e2f27;
      --warn:#d9bd6a; --warn-soft:#2e2819; --miss:#e0a08c; --miss-soft:#2e211d;
      --tile:#282c30;
    }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  .wrap{max-width:1080px;margin:0 auto;padding:40px 20px 72px}
  header{border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:32px}
  h1{font-size:1.9rem;margin:0 0 8px;letter-spacing:-.02em}
  .sub{color:var(--muted);margin:0}
  .criteria{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
  .chip{background:var(--card);border:1px solid var(--line);border-radius:999px;
    padding:5px 12px;font-size:.82rem;color:var(--muted)}
  h2{font-size:1.15rem;margin:40px 0 6px;letter-spacing:-.01em}
  .sectnote{color:var(--muted);font-size:.88rem;margin:0 0 18px}
  .grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fill,minmax(330px,1fr))}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;
    overflow:hidden;display:flex;flex-direction:column}
  .card.match{border-top:4px solid var(--accent)}
  .card.caution{border-top:4px solid var(--warn)}
  .card.miss{border-top:4px solid var(--miss)}
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
  .tag{display:inline-block;font-size:.72rem;font-weight:700;letter-spacing:.06em;
    text-transform:uppercase;padding:3px 8px;border-radius:5px;margin-bottom:12px;align-self:flex-start}
  .tag.ok{background:var(--accent-soft);color:var(--accent)}
  .tag.warn{background:var(--warn-soft);color:var(--warn)}
  .tag.bad{background:var(--miss-soft);color:var(--miss)}
  .tag.new{background:var(--accent);color:var(--card)}
  .tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
  .tags .tag{margin-bottom:0}
  .card.isnew{box-shadow:0 0 0 2px var(--accent-soft)}
  .fresh{background:var(--accent-soft);border:1px solid var(--line);border-left:4px solid var(--accent);
    border-radius:10px;padding:18px 20px;margin-bottom:12px}
  .fresh h3{margin:0 0 10px;font-size:1rem}
  .fresh ul{margin:0;padding-left:20px}
  .fresh li{margin-bottom:7px;font-size:.9rem}
  .fresh li:last-child{margin-bottom:0}
  .fresh a{color:var(--accent);text-decoration:none;font-weight:600}
  .fresh a:hover{text-decoration:underline}
  .note{font-size:.88rem;color:var(--muted);margin:0 0 16px;flex:1}
  .note strong{color:var(--ink)}
  a.btn{display:inline-block;text-decoration:none;color:var(--accent);font-weight:600;
    font-size:.9rem;border:1px solid var(--line);border-radius:7px;padding:7px 12px;align-self:flex-start}
  a.btn:hover{background:var(--accent-soft)}
  .banner{background:var(--warn-soft);border:1px solid var(--line);border-left:4px solid var(--warn);
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

<div class="fresh">
  <h3>&#10024; New this run &mdash; ${fresh.length} propert${fresh.length === 1 ? 'y' : 'ies'} added ${esc(data.lastRun)}</h3>
  ${fresh.length ? `<ul>
${freshRows}
  </ul>` : '<p style="margin:0;color:var(--muted)">No new properties since the last run.</p>'}
</div>
<p class="sectnote">${esc(data.dataQuality.note)}</p>

${matches.length ? `<h2>Verified matches</h2>
<p class="sectnote">Confirmed active and meeting every hard criterion.</p>
<div class="grid">${matches.map(card).join('\n')}
</div>` : ''}

${nearMiss.length ? `<h2>Near misses</h2>
<p class="sectnote">Verified active and short on exactly one criterion — shown in case that one has
any give.</p>
<div class="grid">${nearMiss.map(card).join('\n')}
</div>` : ''}

${active.length ? `<h2>Active, but doesn't meet criteria</h2>
<p class="sectnote">Confirmed on the market — listed here for transparency, not as a recommendation.</p>
<div class="grid">${active.map(card).join('\n')}
</div>` : ''}

${archived.length ? `<h2>Archive</h2>
<div class="grid">${archived.map(card).join('\n')}
</div>` : ''}

${dropped.length ? `<h2>Dropped this run</h2>
<p class="sectnote">Previously tracked, now confirmed sold or off market. Removed from the list above
and recorded here so a genuine relist registers as new rather than silently reappearing.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Why it was dropped</th></tr></thead>
  <tbody>
${droppedRows}
  </tbody>
</table>
</div>` : ''}

<h2>Ruled out on the facts</h2>
<p class="sectnote">Every other property checked this run, with the reason it didn't qualify. The
acreage homes marked &ldquo;no pool&rdquo; are the near-candidates worth knowing about if adding a
pool is ever on the table.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Price</th><th>Why not</th></tr></thead>
  <tbody>
${rejectedRows}
  </tbody>
</table>
</div>

<h2>What the market looks like</h2>
<p class="sectnote"><strong>The pool is the binding constraint, not the budget.</strong> Across all
three towns there is plenty of 4BR/3BA acreage under $1.5M &mdash; what's scarce is a pool attached to
it. Of every qualifying-size home checked this run, the large majority had no pool, and several of
the biggest parcels offered a koi pond, a seasonal stream or a decorative waterfall instead. Three
properties on 5&ndash;24 acres were ruled out for exactly that reason.</p>
<p class="sectnote">Placerville carries the deepest inventory and the widest price range, and produced
half the matches. Rescue is tight &mdash; one qualifying property out of the entire active list, with
most of its acreage inventory sitting on half-acre to 1.5-acre lots despite the rural address.
Shingle Springs clusters its pool properties right at the top of the range, which is why both matches
there land between $1.2M and $1.3M.</p>
<p class="sectnote">Timing note: <strong>1988 Cold Springs Rd sold on 4 September 2026 for
$840,000</strong> &mdash; 4bd/3ba, 2.73 acres, pool. It would have matched every criterion. Properties
in this niche clear quickly, and five of the six matches below already carry price reductions, so
there is room to negotiate on the ones still standing.</p>

<h2>How this was verified</h2>
<p class="sectnote">${esc(data.sources.coverage)} Each property was then opened individually on an
MLS-backed detail page to confirm status, price, bed/bath count, acreage and pool before being listed
as a match. Feeds used were stamped with today's date:</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Source</th></tr></thead>
  <tbody>
${data.sources.feeds.map((f) => `    <tr><td>${esc(f)}</td></tr>`).join('\n')}
  </tbody>
</table>
</div>
<p class="sectnote" style="margin-top:14px">${esc(data.sources.note)}</p>

<footer>
  <p>Generated from <code>listings.json</code> by <code>build.js</code>.
  <strong>${matches.length} verified matches</strong>, ${nearMiss.length} near miss,
  ${data.rejected.length} ruled out, ${dropped.length} dropped as sold or off market.
  ${photoCount}/${data.listings.length} listings have photos embedded.</p>
  <p>Each run re-checks every tracked property against the live MLS feed: sold and withdrawn
  listings are dropped, price changes are shown on the card, and anything genuinely new is
  highlighted at the top. Listing photos are &copy; their listing brokerages.</p>
</footer>

</div>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`Built index.html — ${matches.length} verified matches, ${active.length} active/off-criteria, ` +
            `${archived.length} archived, ${photoCount}/${data.listings.length} with photos.`);
