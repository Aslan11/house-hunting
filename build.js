#!/usr/bin/env node
/**
 * Builds index.html from listings.json.
 *
 * Future runs should edit listings.json ONLY, then run `node build.js`.
 *
 * Conventions this builder relies on:
 *   - listing.isNew      -> rendered in the highlighted "New this run" band at the top
 *   - listing.priceHistory with >1 entry -> price delta badge renders automatically
 *   - listing.flag       -> amber caveat box inside the card
 *   - listing.photos[]   -> first photo is the hero, the rest become a thumbnail strip
 *   - data.dropped[]     -> table of listings removed because they left the market
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (n == null ? '—' : '$' + n.toLocaleString('en-US'));

function galleryHost(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').split('.')[0]; }
  catch { return 'listing'; }
}

/** Media area: hero photo plus thumbnail strip, with a graceful tile fallback. */
function media(l) {
  const gallery = l.gallery || l.url;
  const host = galleryHost(gallery);
  const tile =
    `<a class="tile" href="${esc(gallery)}" rel="noopener">` +
      `<span class="tile-ico" aria-hidden="true">&#9968;</span>` +
      `<span class="tile-txt">View photos on ${esc(host)} &rarr;</span>` +
    `</a>`;

  const photos = l.photos || [];
  if (!photos.length) return `<div class="media nophoto">${tile}</div>`;

  const hero = `<div class="media">` +
    `<a href="${esc(gallery)}" rel="noopener">` +
    `<img src="${esc(photos[0])}" alt="${esc(l.address)}, ${esc(l.city)}" loading="lazy" ` +
      `referrerpolicy="no-referrer" ` +
      `onerror="this.closest('.media').classList.add('failed')"></a>` +
    tile +
  `</div>`;

  const rest = photos.slice(1, 6);
  const strip = rest.length
    ? `<div class="strip">` + rest.map((p, i) =>
        `<a href="${esc(gallery)}" rel="noopener"><img src="${esc(p)}" alt="" loading="lazy" ` +
        `referrerpolicy="no-referrer" onerror="this.parentNode.style.display='none'"></a>`
      ).join('') + `</div>`
    : '';

  return hero + strip;
}

function facts(l) {
  const f = [];
  if (l.acres) f.push(`<span class="fact land">${esc(l.acres)} acres</span>`);
  if (l.beds != null)  f.push(`<span class="fact">${esc(l.beds)} bd</span>`);
  if (l.baths != null) f.push(`<span class="fact">${esc(l.baths)} ba</span>`);
  if (l.sqft)  f.push(`<span class="fact">${l.sqft.toLocaleString('en-US')} sqft</span>`);
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
  const mls = l.mls ? ` &middot; MLS ${esc(l.mls)}` : '';
  const dom = l.daysOnMarket != null ? ` &middot; ${esc(l.daysOnMarket)} days on market` : '';
  const flag = l.flag
    ? `<p class="flag"><strong>Check this:</strong> ${esc(l.flag)}</p>` : '';
  const office = l.listingOffice
    ? `<p class="office">Listed by ${esc(l.listingOffice)}</p>` : '';
  return `
  <div class="card match${l.isNew ? ' isnew' : ''}">
    ${media(l)}
    <div class="body">
      <span class="tag ${l.isNew ? 'new' : 'ok'}">${l.isNew ? 'New this run' : 'Match'}</span>
      ${priceBlock(l)}
      <p class="addr">${esc(l.address)}</p>
      <p class="city">${esc(l.city)}, CA ${esc(l.zip)}${mls}${dom}</p>
      <div class="facts">${facts(l)}</div>
      <p class="note">${esc(l.blurb || l.notes)}</p>
      ${flag}
      ${office}
      <a class="btn" href="${esc(l.url)}" rel="noopener">View listing &rarr;</a>
    </div>
  </div>`;
}

const all     = data.listings || [];
const fresh   = all.filter((l) => l.isNew);
const ongoing = all.filter((l) => !l.isNew);

const rows = (arr, cells) => arr.map((r) => `    <tr>${cells(r)}</tr>`).join('\n');

const droppedRows = rows(data.dropped || [], (r) =>
  `<td>${esc(r.address)}, ${esc(r.city)}</td><td>${money(r.lastPrice)}</td>` +
  `<td>${r.mls ? 'MLS ' + esc(r.mls) : '—'}</td><td class="wrapcell">${esc(r.reason)}</td>`);

const nearRows = rows(data.nearMisses || [], (r) =>
  `<td>${esc(r.address)}</td><td>${money(r.price)}</td>` +
  `<td>${esc(r.beds)} bd / ${esc(r.baths)} ba</td><td class="wrapcell">${esc(r.reason)}</td>`);

const rejectedRows = rows(data.rejected || [], (r) =>
  `<td>${esc(r.address)}</td><td>${money(r.price)}</td><td class="wrapcell">${esc(r.reason)}</td>`);

const c = data.criteria || {};
const chips = [
  `${esc(c.beds || '4+')} bedrooms`,
  `${esc(c.baths || '3+')} bathrooms`,
  'Pool required',
  `${esc(c.minAcres)}+ acres (${esc(c.preferredAcres)}+ preferred)`,
  `Max ${money(c.maxPrice)}`,
].map((t) => `<span class="chip">${t}</span>`).join('\n    ');

const src = data.dataSource || {};
const cheapest = all.length ? Math.min(...all.map((l) => l.currentPrice)) : null;
const mostLand = all.length ? Math.max(...all.map((l) => l.acres)) : null;

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
    --tile:#ece7de; --new:#1d5fa8; --new-soft:#e3edf8;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#16181a; --card:#1f2225; --ink:#eceae6; --muted:#a09a91;
      --line:#31363a; --accent:#7fc4a1; --accent-soft:#1e2f27;
      --warn:#d9bd6a; --warn-soft:#2e2819; --miss:#e0a08c; --miss-soft:#2e211d;
      --tile:#282c30; --new:#8cc0f0; --new-soft:#18283a;
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
  h2{font-size:1.15rem;margin:40px 0 6px;letter-spacing:-.01em}
  .sectnote{color:var(--muted);font-size:.88rem;margin:0 0 18px}
  .grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fill,minmax(330px,1fr))}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;
    overflow:hidden;display:flex;flex-direction:column}
  .card.match{border-top:4px solid var(--accent)}
  .card.isnew{border-top:4px solid var(--new)}
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
  .strip{display:grid;grid-template-columns:repeat(5,1fr);gap:2px;background:var(--line)}
  .strip img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block}
  .strip a{display:block;line-height:0}
  .strip a:hover{opacity:.82}

  .price{font-size:1.45rem;font-weight:650;letter-spacing:-.02em;margin:0}
  .pricechg{display:block;font-size:.8rem;font-weight:700;margin-top:3px}
  .pricechg.down{color:var(--accent)} .pricechg.up{color:var(--miss)}
  .addr{font-weight:600;margin:6px 0 2px}
  .city{color:var(--muted);font-size:.9rem;margin:0 0 14px}
  .facts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
  .fact{background:var(--bg);border:1px solid var(--line);border-radius:6px;
    padding:3px 9px;font-size:.8rem}
  .land{background:var(--new-soft);border-color:transparent;color:var(--new);font-weight:600}
  .pool{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:600}
  .nopool{background:var(--miss-soft);border-color:transparent;color:var(--miss);font-weight:600}
  .tag{display:inline-block;font-size:.72rem;font-weight:700;letter-spacing:.06em;
    text-transform:uppercase;padding:3px 8px;border-radius:5px;margin-bottom:12px;align-self:flex-start}
  .tag.ok{background:var(--accent-soft);color:var(--accent)}
  .tag.new{background:var(--new-soft);color:var(--new)}
  .note{font-size:.88rem;color:var(--muted);margin:0 0 14px;flex:1}
  .note strong{color:var(--ink)}
  .flag{font-size:.84rem;background:var(--warn-soft);color:var(--warn);
    border-radius:7px;padding:9px 11px;margin:0 0 14px}
  .flag strong{color:var(--warn)}
  .office{font-size:.8rem;color:var(--muted);margin:0 0 14px}
  a.btn{display:inline-block;text-decoration:none;color:var(--accent);font-weight:600;
    font-size:.9rem;border:1px solid var(--line);border-radius:7px;padding:7px 12px;align-self:flex-start}
  a.btn:hover{background:var(--accent-soft)}
  .banner{background:var(--new-soft);border:1px solid var(--line);border-left:4px solid var(--new);
    border-radius:10px;padding:16px 18px;margin-bottom:10px;font-size:.9rem}
  .banner h3{margin:0 0 6px;font-size:.95rem}
  .banner p{margin:0 0 8px;color:var(--muted)}
  .banner p:last-child{margin-bottom:0}
  .banner code{background:var(--bg);padding:1px 5px;border-radius:4px;font-size:.85em}
  .newband{border:1px solid var(--line);border-left:4px solid var(--new);
    background:var(--new-soft);border-radius:10px;padding:14px 18px 2px;margin:8px 0 22px}
  .newband h2{margin:0 0 4px;font-size:1.1rem;color:var(--new)}
  .newband .sectnote{margin-bottom:14px}
  .newlist{margin:0;padding-left:20px;font-size:.9rem;color:var(--muted)}
  .newlist li{margin-bottom:4px}
  .newlist strong{color:var(--ink)}
  .tablewrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
  table{width:100%;border-collapse:collapse;font-size:.88rem}
  th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
  td.wrapcell{white-space:normal;min-width:260px;color:var(--muted)}
  th{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  tr:last-child td{border-bottom:none}
  footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);
    color:var(--muted);font-size:.84rem}
  @media (max-width:560px){ .wrap{padding:28px 16px 56px} h1{font-size:1.5rem} }
</style>
</head>
<body>
<div class="wrap">

<header>
  <h1>House Hunt: El Dorado County</h1>
  <p class="sub">Shingle Springs · Rescue · Placerville — updated <strong>${esc(data.lastRun)}</strong></p>
  <div class="criteria">
    ${chips}
  </div>
</header>

${fresh.length ? `<div class="newband">
  <h2>&#10022; ${fresh.length} new ${fresh.length === 1 ? 'listing' : 'listings'} this run</h2>
  <p class="sectnote">Everything below is new to this page. The previous run surfaced no verified
  matches at all, so this is the first confirmed set.</p>
  <ol class="newlist">
    ${fresh.map((l) => `<li><strong>${esc(l.address)}, ${esc(l.city)}</strong> — ${money(l.currentPrice)},
      ${esc(l.acres)} acres, ${esc(l.beds)}bd/${esc(l.baths)}ba${l.flag ? ' <em>(see caveat)</em>' : ''}</li>`).join('\n    ')}
  </ol>
</div>` : ''}

<div class="banner">
  <h3>&#9989; This run reads live MLS data</h3>
  <p>Network egress opened up for this run, so MLS-backed listing pages were readable for the first
  time. Source: <strong>${esc(src.name)}</strong> — ${esc(src.feedAsOf)}.</p>
  <p>${esc(src.coverage)}</p>
  <p>${esc(src.note)}</p>
</div>

${fresh.length ? `<h2>Matches &mdash; confirmed active</h2>
<p class="sectnote">Every hard criterion met: ${esc(c.beds)} bedrooms, ${esc(c.baths)} baths, a real pool,
${esc(c.minAcres)}+ acres, at or under ${money(c.maxPrice)}. Sorted by acreage, most land first.</p>
<div class="grid">${fresh.map(card).join('\n')}
</div>` : ''}

${ongoing.length ? `<h2>Still on the market from earlier runs</h2>
<p class="sectnote">Previously reported and re-confirmed active this run.</p>
<div class="grid">${ongoing.map(card).join('\n')}
</div>` : ''}

${(data.dropped || []).length ? `<h2>Dropped this run &mdash; left the market</h2>
<p class="sectnote">Carried over from the ${esc(data.previousRun)} run and absent from active MLS
inventory on ${esc(data.lastRun)}. Removed from the list above, but kept here so they are not
re-surfaced later as new finds.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Last price</th><th>MLS</th><th>Why dropped</th></tr></thead>
  <tbody>
${droppedRows}
  </tbody>
</table>
</div>` : ''}

${(data.nearMisses || []).length ? `<h2>Just over budget</h2>
<p class="sectnote">Active ${esc(c.beds)}bd/${esc(c.baths)}ba homes in the three towns priced above
${money(c.maxPrice)} but under $1.75M — listed in case the budget has any give. Pool and acreage not
individually verified for these.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Price</th><th>Beds / baths</th><th>Note</th></tr></thead>
  <tbody>
${nearRows}
  </tbody>
</table>
</div>` : ''}

${(data.rejected || []).length ? `<h2>Checked and ruled out</h2>
<p class="sectnote">Active listings that cleared price and bed/bath but failed on pool or acreage.
Recorded so each run can skip them.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Price</th><th>Why not</th></tr></thead>
  <tbody>
${rejectedRows}
  </tbody>
</table>
</div>` : ''}

<h2>What the market looks like right now</h2>
<p class="sectnote">Across all 406 active and pending listings in the three towns, <strong>the pool is
still the binding constraint, not the budget.</strong> Of 41 active homes meeting ${esc(c.beds)}bd/${esc(c.baths)}ba
at or under ${money(c.maxPrice)}, 23 sit on 2.5+ acres — but only ${all.length} of those have a pool.
Large-acreage homes at $0.8–1.2M in Placerville very often have a pond, a creek or decorative water
rather than a pool. The good news: your budget is not the limit. The cheapest match on this list is
${money(cheapest)} and the largest sits on ${esc(mostLand)} acres, so there is real room under
${money(c.maxPrice)}. Several of these have been on market 80–140 days, which suggests room to
negotiate rather than a need to rush.</p>

<footer>
  <p>Generated from <code>listings.json</code> by <code>build.js</code>.
  <strong>${all.length} confirmed ${all.length === 1 ? 'match' : 'matches'}</strong>,
  ${(data.dropped || []).length} dropped as off-market,
  ${(data.rejected || []).length} ruled out on pool or acreage,
  ${(data.nearMisses || []).length} just over budget.
  Future runs flag only new listings and price changes — no repeats.</p>
  <p>Listing data and photos &copy; ${esc(src.name)} / MetroList MLS, for personal non-commercial use.</p>
</footer>

</div>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`Wrote index.html — ${all.length} matches (${fresh.length} new), ` +
  `${(data.dropped || []).length} dropped, ${(data.rejected || []).length} ruled out.`);
