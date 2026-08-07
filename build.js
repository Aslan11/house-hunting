#!/usr/bin/env node
/**
 * Builds index.html from listings.json.
 *
 * Edit listings.json (or run merge.js against a fresh pull), then `node build.js`.
 * Never hand-edit index.html.
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US'));
const short = (n) => (n == null ? '—' : '$' + (n / 1000).toFixed(0) + 'K');

function galleryHost(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').split('.')[0]; }
  catch { return 'listing'; }
}

/** Media strip: hero photo plus up to three thumbs, with graceful fallback. */
function media(l) {
  const gallery = l.gallery || l.url;
  const host = galleryHost(gallery);
  const tile =
    `<a class="tile" href="${esc(gallery)}" rel="noopener noreferrer" target="_blank">` +
      `<span class="tile-ico" aria-hidden="true">&#9968;</span>` +
      `<span class="tile-txt">View photos on ${esc(host)} &rarr;</span>` +
    `</a>`;

  const photos = l.photos && l.photos.length ? l.photos : [];
  if (!photos.length) return `<div class="media nophoto">${tile}</div>`;

  const hero =
    `<a class="hero" href="${esc(gallery)}" rel="noopener noreferrer" target="_blank">` +
      `<img src="${esc(photos[0])}" alt="${esc(l.address)}, ${esc(l.city)}" loading="lazy" ` +
      `referrerpolicy="no-referrer" onerror="this.closest('.media').classList.add('failed')">` +
    `</a>`;

  // Prefer pool photos in the thumb strip — the pool is the hard requirement.
  const rest = [...(l.poolPhotos || []), ...photos.slice(1)]
    .filter((p, i, a) => p !== photos[0] && a.indexOf(p) === i)
    .slice(0, 3);

  const thumbs = rest.length
    ? `<div class="thumbs">` + rest.map((p) =>
        `<a href="${esc(gallery)}" rel="noopener noreferrer" target="_blank">` +
        `<img src="${esc(p)}" alt="" loading="lazy" referrerpolicy="no-referrer" ` +
        `onerror="this.parentNode.remove()"></a>`).join('') + `</div>`
    : '';

  return `<div class="media">${hero}${thumbs}${tile}</div>`;
}

function facts(l) {
  const f = [];
  if (l.beds != null)  f.push(`<span class="fact"><b>${esc(l.beds)}</b> bd</span>`);
  if (l.baths != null) f.push(`<span class="fact"><b>${esc(l.baths)}</b> ba</span>`);
  if (l.sqft)  f.push(`<span class="fact"><b>${Number(l.sqft).toLocaleString('en-US')}</b> sqft</span>`);
  if (l.acres) f.push(`<span class="fact acres"><b>${esc(l.acres)}</b> acres</span>`);
  if (l.yearBuilt) f.push(`<span class="fact">built ${esc(l.yearBuilt)}</span>`);
  f.push(l.pool
    ? `<span class="fact pool">&#127946; ${esc(l.poolDetail || 'Pool')}</span>`
    : `<span class="fact nopool">No pool</span>`);
  if (l.hasSpa) f.push(`<span class="fact pool">+ spa</span>`);
  return f.join('');
}

function priceBlock(l) {
  const pc = l.priceChange;
  if (pc) {
    const down = pc.to < pc.from;
    const delta = Math.abs(pc.to - pc.from);
    return `<p class="price">${money(l.currentPrice)}` +
      `<span class="pricechg ${down ? 'down' : 'up'}">` +
      `${down ? '&darr;' : '&uarr;'} ${money(delta)} from ${money(pc.from)}</span></p>`;
  }
  return `<p class="price">${money(l.currentPrice)}</p>`;
}

/** Per-acre context helps compare a 40-acre parcel against a 5-acre one. */
function subline(l) {
  const bits = [];
  if (l.mls) bits.push(`MLS ${esc(l.mls)}`);
  if (l.daysOnMarket != null) {
    bits.push(l.daysOnMarket <= 3
      ? `<b class="fresh">${l.daysOnMarket} day${l.daysOnMarket === 1 ? '' : 's'} on market</b>`
      : `${l.daysOnMarket} days on market`);
  }
  return bits.join(' &middot; ');
}

function card(l) {
  const flags = [];
  if (l.isNew) flags.push(`<span class="tag new">New this run</span>`);
  if (l.priceChange) {
    flags.push(`<span class="tag chg">${l.priceChange.to < l.priceChange.from ? 'Price cut' : 'Price up'}</span>`);
  }
  if (!flags.length) flags.push(`<span class="tag ok">Tracked</span>`);
  if (l.acres >= 5) flags.push(`<span class="tag land">${l.acres}+ acres</span>`);

  const remarks = l.remarks
    ? `<p class="note">${esc(l.remarks)}</p>`
    : '';
  const who = [l.agent, l.broker].filter(Boolean).map(esc).join(' &middot; ');

  return `
  <article class="card${l.isNew ? ' isnew' : ''}">
    ${media(l)}
    <div class="body">
      <div class="tags">${flags.join('')}</div>
      ${priceBlock(l)}
      <h3 class="addr">${esc(l.address)}</h3>
      <p class="city">${esc(l.city)}, CA ${esc(l.zip)}</p>
      <div class="facts">${facts(l)}</div>
      ${remarks}
      <p class="sub">${subline(l)}</p>
      ${who ? `<p class="sub agent">${who}</p>` : ''}
      <a class="btn" href="${esc(l.url)}" rel="noopener noreferrer" target="_blank">View listing &rarr;</a>
    </div>
  </article>`;
}

const listings = data.listings || [];
const fresh = listings.filter((l) => l.isNew);
const changed = listings.filter((l) => !l.isNew && l.priceChange);
const steady = listings.filter((l) => !l.isNew && !l.priceChange);

const droppedThisRun = (data.dropped || []).filter((d) => d.droppedOn === data.lastRun);

const c = data.criteria;
const summary = data.runSummary || {};

const section = (id, title, blurb, items) => items.length ? `
  <section id="${id}">
    <h2>${title} <span class="count">${items.length}</span></h2>
    ${blurb ? `<p class="lede">${blurb}</p>` : ''}
    <div class="grid">${items.map(card).join('')}</div>
  </section>` : '';

const droppedRows = droppedThisRun.map((d) => `
      <tr>
        <td>${esc(d.address)}, ${esc(d.city)}</td>
        <td>${d.lastPrice ? money(d.lastPrice) : '—'}</td>
        <td>${esc(d.reason)}</td>
      </tr>`).join('');

const nearRows = (data.nearMisses || []).map((n) => `
      <tr>
        <td><a href="${esc(n.url)}" rel="noopener noreferrer" target="_blank">${esc(n.address)}, ${esc(n.city)}</a></td>
        <td>${money(n.price)}</td>
        <td>${esc(n.beds)}bd / ${esc(n.baths)}ba</td>
        <td>${esc(n.acres)} ac</td>
        <td>${esc(n.reason)}</td>
      </tr>`).join('');

const rejectedRows = (data.rejected || []).map((r) => `
      <tr><td>${esc(r.address)}</td><td>${r.price ? money(r.price) : '—'}</td><td>${esc(r.reason)}</td></tr>`).join('');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>House Hunt — Shingle Springs · Rescue · Placerville</title>
<meta name="description" content="Tracked 4BR+/3BA+ homes with a pool on 2.5+ acres in Shingle Springs, Rescue and Placerville, CA under $1.5M.">
<style>
  :root{
    --bg:#f6f4f0; --card:#fff; --ink:#1c1a17; --muted:#6b665e;
    --line:#e2ddd4; --accent:#2f6b4f; --accent-soft:#e6f0ea;
    --new:#1f5f8b; --new-soft:#e2eef7;
    --warn:#8a6d1f; --warn-soft:#f8f0d8; --miss:#8a4b3a; --miss-soft:#f7e7e2;
    --tile:#ece7de; --shadow:0 1px 2px rgba(0,0,0,.05),0 8px 24px rgba(0,0,0,.05);
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#16181a; --card:#1f2225; --ink:#eceae6; --muted:#a09a91;
      --line:#31363a; --accent:#7fc4a1; --accent-soft:#1e2f27;
      --new:#8fc4e8; --new-soft:#1b2a35;
      --warn:#d9bd6a; --warn-soft:#2e2819; --miss:#e0a08c; --miss-soft:#2e211d;
      --tile:#282c30; --shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.25);
    }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    -webkit-text-size-adjust:100%;}
  .wrap{max-width:1180px;margin:0 auto;padding:32px 20px 80px}
  header{border-bottom:1px solid var(--line);padding-bottom:22px;margin-bottom:8px}
  h1{font-size:clamp(24px,4vw,34px);margin:0 0 6px;letter-spacing:-.02em}
  .sub-h{color:var(--muted);margin:0}
  .crit{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 0;padding:0;list-style:none}
  .crit li{background:var(--card);border:1px solid var(--line);border-radius:999px;
    padding:5px 13px;font-size:13.5px;color:var(--muted)}
  .crit li b{color:var(--ink)}

  .banner{margin:26px 0 8px;padding:18px 20px;border-radius:14px;
    background:var(--new-soft);border:1px solid color-mix(in srgb,var(--new) 30%,transparent)}
  .banner h2{margin:0 0 6px;font-size:18px;color:var(--new)}
  .banner p{margin:0;color:var(--ink);font-size:15px}
  .banner ul{margin:10px 0 0;padding-left:20px}
  .banner li{font-size:15px;margin:3px 0}

  section{margin:44px 0 0}
  h2{font-size:20px;margin:0 0 4px;letter-spacing:-.01em}
  h2 .count{display:inline-block;background:var(--accent-soft);color:var(--accent);
    border-radius:999px;font-size:13px;padding:2px 10px;vertical-align:middle;margin-left:6px}
  .lede{color:var(--muted);margin:0 0 18px;max-width:70ch}

  .grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(330px,1fr))}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;
    overflow:hidden;display:flex;flex-direction:column;box-shadow:var(--shadow)}
  .card.isnew{border-color:color-mix(in srgb,var(--new) 45%,var(--line))}

  .media{position:relative;background:var(--tile)}
  .media .hero{display:block;aspect-ratio:16/10;overflow:hidden}
  .media .hero img{width:100%;height:100%;object-fit:cover;display:block}
  .thumbs{display:grid;grid-template-columns:repeat(3,1fr);gap:2px;background:var(--tile)}
  .thumbs img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block}
  .tile{display:none;align-items:center;justify-content:center;gap:8px;
    aspect-ratio:16/10;color:var(--muted);text-decoration:none;font-size:14.5px;text-align:center;padding:12px}
  .tile-ico{font-size:24px}
  .media.nophoto .tile,.media.failed .tile{display:flex}
  .media.failed .hero,.media.failed .thumbs{display:none}

  .body{padding:16px 18px 18px;display:flex;flex-direction:column;flex:1}
  .tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
  .tag{font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
    padding:3px 9px;border-radius:999px}
  .tag.new{background:var(--new);color:var(--card)}
  .tag.ok{background:var(--accent-soft);color:var(--accent)}
  .tag.chg{background:var(--warn-soft);color:var(--warn)}
  .tag.land{background:var(--accent-soft);color:var(--accent)}
  .price{font-size:24px;font-weight:700;margin:0 0 2px;letter-spacing:-.02em}
  .pricechg{font-size:13px;font-weight:600;margin-left:8px;vertical-align:middle}
  .pricechg.down{color:var(--accent)} .pricechg.up{color:var(--miss)}
  .addr{font-size:17px;margin:2px 0 1px;font-weight:600}
  .city{color:var(--muted);margin:0 0 12px;font-size:14.5px}
  .facts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
  .fact{background:var(--bg);border:1px solid var(--line);border-radius:7px;
    padding:3px 9px;font-size:13px;color:var(--muted)}
  .fact b{color:var(--ink)}
  .fact.acres{background:var(--accent-soft);border-color:transparent;color:var(--accent)}
  .fact.pool{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:600}
  .fact.nopool{background:var(--miss-soft);border-color:transparent;color:var(--miss)}
  .note{font-size:14px;color:var(--muted);margin:0 0 12px;
    display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
  .sub{font-size:12.5px;color:var(--muted);margin:0 0 4px}
  .sub .fresh{color:var(--new)}
  .sub.agent{margin-bottom:12px}
  .btn{margin-top:auto;display:inline-block;text-align:center;background:var(--accent);
    color:#fff;text-decoration:none;padding:10px 14px;border-radius:9px;font-weight:600;font-size:14.5px}
  @media (prefers-color-scheme: dark){ .btn{color:#10221a} }

  .tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:var(--card)}
  table{border-collapse:collapse;width:100%;font-size:14px;min-width:520px}
  th,td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--line)}
  th{color:var(--muted);font-weight:600;font-size:12.5px;text-transform:uppercase;letter-spacing:.04em}
  tr:last-child td{border-bottom:none}
  td a{color:var(--accent)}

  .empty{background:var(--card);border:1px dashed var(--line);border-radius:12px;
    padding:24px;color:var(--muted);text-align:center}
  footer{margin-top:56px;padding-top:22px;border-top:1px solid var(--line);
    color:var(--muted);font-size:13.5px}
  footer h3{font-size:14px;color:var(--ink);margin:0 0 6px}
  footer p{margin:0 0 12px;max-width:80ch}
  code{background:var(--tile);padding:1px 5px;border-radius:4px;font-size:12.5px}
</style>
</head>
<body>
<div class="wrap">

<header>
  <h1>House Hunt &mdash; El Dorado County</h1>
  <p class="sub-h">Shingle Springs &middot; Rescue &middot; Placerville &nbsp;|&nbsp; last run ${esc(data.lastRun)}</p>
  <ul class="crit">
    <li><b>${esc(c.beds)}</b> beds</li>
    <li><b>${esc(c.baths)}</b> baths</li>
    <li><b>Pool</b> required</li>
    <li><b>${esc(c.minAcres)}+</b> acres (${esc(c.preferredAcres)}+ preferred)</li>
    <li>under <b>${money(c.maxPrice)}</b></li>
  </ul>
</header>

<div class="banner">
  <h2>${summary.newCount ? `${summary.newCount} new listing${summary.newCount === 1 ? '' : 's'} this run` : 'No new listings this run'}</h2>
  ${summary.newCount ? `<p>Everything below meets all five criteria and is <b>Active</b> in the live MetroList MLS feed as of ${esc(data.lastRun)}.</p>
  <ul>${fresh.map((l) => `<li><b>${esc(l.address)}</b>, ${esc(l.city)} &mdash; ${money(l.currentPrice)} &middot; ${esc(l.beds)}bd/${esc(l.baths)}ba &middot; ${esc(l.acres)} ac</li>`).join('')}</ul>`
  : `<p>Nothing new since the previous run. ${summary.priceChangeCount || 0} price change${summary.priceChangeCount === 1 ? '' : 's'}, ${summary.droppedThisRun || 0} dropped.</p>`}
</div>

${section('new', 'New this run', 'First time these have appeared on the board.', fresh)}
${section('changed', 'Price changes', 'Already tracked, but the asking price moved since the last run.', changed)}
${section('tracked', 'Still on the market', 'Tracked previously, still active and unchanged in price.', steady)}

${!listings.length ? `<section><h2>Matches</h2><div class="empty">No listing currently meets all five criteria.</div></section>` : ''}

${droppedThisRun.length ? `
<section id="dropped">
  <h2>Dropped this run <span class="count">${droppedThisRun.length}</span></h2>
  <p class="lede">Gone from the active MLS feed &mdash; sold, withdrawn or expired. Kept here only so a
  relist is recognised rather than reported as a brand-new find.</p>
  <div class="tablewrap"><table>
    <thead><tr><th>Property</th><th>Last price</th><th>Why it left</th></tr></thead>
    <tbody>${droppedRows}
    </tbody>
  </table></div>
</section>` : ''}

${nearRows ? `
<section id="near">
  <h2>Near misses <span class="count">${(data.nearMisses || []).length}</span></h2>
  <p class="lede">Active listings that clear price, bedrooms and acreage but fail one requirement &mdash;
  almost always the pool. Listed in case a criterion is negotiable.</p>
  <div class="tablewrap"><table>
    <thead><tr><th>Property</th><th>Price</th><th>Beds/baths</th><th>Lot</th><th>Fails on</th></tr></thead>
    <tbody>${nearRows}
    </tbody>
  </table></div>
</section>` : ''}

${rejectedRows ? `
<section id="rejected">
  <h2>Ruled out</h2>
  <p class="lede">Seen in a previous run and set aside. Re-checked each run &mdash; a price cut can bring
  one of these back into range.</p>
  <div class="tablewrap"><table>
    <thead><tr><th>Property</th><th>Price</th><th>Reason</th></tr></thead>
    <tbody>${rejectedRows}
    </tbody>
  </table></div>
</section>` : ''}

<footer>
  <h3>How this list is built</h3>
  <p>${esc(data.provenance || '')}</p>
  <h3>Caveats</h3>
  <p>${esc(data.caveats || '')}</p>
  <p>Generated from <code>listings.json</code> by <code>build.js</code> on ${esc(data.lastRun)}.
  Listing photos are &copy; the listing brokerage and are hotlinked, not republished.</p>
</footer>

</div>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(
  `built index.html — ${listings.length} matches (${fresh.length} new, ${changed.length} price changes), ` +
  `${droppedThisRun.length} dropped, ${(data.nearMisses || []).length} near misses`
);
