#!/usr/bin/env node
/**
 * Builds index.html from listings.json.
 *
 * Edit listings.json only (or re-run `python3 hunt.py`), then `node build.js`.
 * Photos come from the listing's own MLS-numbered CDN files; if one fails to
 * load in the viewer's browser an onerror handler swaps in a link tile, so a
 * dead URL never leaves a hole in the layout.
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US'));
const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));

const listings = data.listings || [];
const near = (data.nearMisses || []).filter((l) => (l.unmet || []).length === 1);
const dropped = data.dropped || [];

const fresh = listings.filter((l) => l.isNew);
const changed = listings.filter((l) => l.priceChanged);
const steady = listings.filter((l) => !l.isNew && !l.priceChanged);

function host(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').split('.')[0]; }
  catch { return 'listing'; }
}

function media(l) {
  const tile =
    `<a class="tile" href="${esc(l.gallery || l.url)}" rel="noopener" target="_blank">` +
      `<span class="tile-ico" aria-hidden="true">&#9968;</span>` +
      `<span class="tile-txt">View photos on ${esc(host(l.gallery || l.url))} &rarr;</span>` +
    `</a>`;
  const photos = l.photos || [];
  if (!photos.length) return `<div class="media nophoto">${tile}</div>`;

  const thumbs = photos.slice(1, 5).map((p, i) =>
    `<img class="thumb" src="${esc(p)}" alt="" loading="lazy" referrerpolicy="no-referrer"
       onerror="this.remove()" data-i="${i + 1}">`).join('');

  return `<div class="media">` +
    `<img class="hero" src="${esc(photos[0])}" alt="${esc(l.address)}, ${esc(l.city)}"
       loading="lazy" referrerpolicy="no-referrer"
       onerror="this.closest('.media').classList.add('failed')">` +
    (thumbs ? `<div class="strip">${thumbs}</div>` : '') +
    tile +
  `</div>`;
}

function facts(l) {
  const f = [];
  if (l.beds != null)  f.push(`<span class="fact"><b>${esc(l.beds)}</b> bd</span>`);
  if (l.baths != null) f.push(`<span class="fact"><b>${esc(l.baths)}</b> ba</span>`);
  if (l.sqft)  f.push(`<span class="fact"><b>${num(l.sqft)}</b> sqft</span>`);
  if (l.acres) {
    const big = l.acres >= (data.criteria?.preferredAcres ?? 5);
    f.push(`<span class="fact ${big ? 'acres-plus' : ''}"><b>${esc(l.acres)}</b> acres${big ? ' &#9733;' : ''}</span>`);
  }
  if (l.yearBuilt) f.push(`<span class="fact">built <b>${esc(l.yearBuilt)}</b></span>`);
  f.push(l.pool ? `<span class="fact pool">Pool</span>`
                : `<span class="fact nopool">No pool</span>`);
  return f.join('');
}

function priceBlock(l) {
  if (l.priceChanged && l.previousPrice != null) {
    const down = l.currentPrice < l.previousPrice;
    const delta = Math.abs(l.currentPrice - l.previousPrice);
    return `<p class="price">${money(l.currentPrice)}` +
      `<span class="pricechg ${down ? 'down' : 'up'}">` +
      `${down ? '&darr;' : '&uarr;'} ${money(delta)} from ${money(l.previousPrice)}</span></p>`;
  }
  return `<p class="price">${money(l.currentPrice)}</p>`;
}

function ppa(l) {
  if (!l.currentPrice || !l.acres) return '';
  return `<span class="sub-fact">${money(Math.round(l.currentPrice / l.acres))}/acre</span>`;
}

function blurb(l) {
  const t = (l.remarks || '').trim();
  if (!t) return '';
  const cut = t.length > 230 ? t.slice(0, 230).replace(/\s+\S*$/, '') + '…' : t;
  return `<p class="note">${esc(cut)}</p>`;
}

function card(l) {
  const tags = [];
  if (l.isNew) tags.push(`<span class="tag new">New this run</span>`);
  if (l.priceChanged) tags.push(`<span class="tag chg">Price change</span>`);
  if (!tags.length) tags.push(`<span class="tag ok">Tracked</span>`);

  const poolDetail = l.pool && l.poolDetail && l.poolDetail !== 'Private pool'
    ? `<p class="pooldetail">Pool: ${esc(l.poolDetail)}</p>` : '';

  const warn = (l.warnings || []).length
    ? `<p class="warn">&#9888; ${esc(l.warnings.join('; '))}</p>` : '';

  return `
  <article class="card${l.isNew ? ' isnew' : ''}">
    ${media(l)}
    <div class="body">
      <div class="tags">${tags.join('')}</div>
      ${priceBlock(l)}
      <p class="addr">${esc(l.address)}</p>
      <p class="city">${esc(l.city)}, CA ${esc(l.zip)}${l.mls ? ` &middot; MLS ${esc(l.mls)}` : ''} ${ppa(l)}</p>
      <div class="facts">${facts(l)}</div>
      ${poolDetail}
      ${blurb(l)}
      ${warn}
      <p class="verified">Confirmed active on ${esc(l.verifiedOn)}${l.timeSinceActive ? ` &middot; on market ${esc(l.timeSinceActive)}` : ''}</p>
      <a class="btn" href="${esc(l.url)}" rel="noopener" target="_blank">View listing &rarr;</a>
    </div>
  </article>`;
}

const nearRows = near.map((l) =>
  `    <tr><td>${esc(l.address)}</td><td>${esc(l.city)}</td><td>${money(l.currentPrice)}</td>` +
  `<td>${esc(l.beds)}bd / ${esc(l.baths)}ba</td><td>${l.acres != null ? esc(l.acres) + ' ac' : '—'}</td>` +
  `<td class="miss-cell">${esc((l.unmet || []).join(', '))}</td>` +
  `<td><a href="${esc(l.url)}" rel="noopener" target="_blank">view</a></td></tr>`).join('\n');

const droppedRows = dropped.map((d) =>
  `    <tr><td>${esc(d.address)}</td><td>${esc(d.city || '—')}</td><td>${money(d.lastPrice)}</td>` +
  `<td>${esc(d.reason)}</td><td>${esc(d.droppedOn)}</td></tr>`).join('\n');

const c = data.criteria || {};
const counts = data.counts || {};

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
    --new:#1d5fa8; --new-soft:#e2edf9;
    --warn:#8a6d1f; --warn-soft:#f8f0d8; --miss:#8a4b3a; --miss-soft:#f7e7e2;
    --tile:#ece7de;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#16181a; --card:#1f2225; --ink:#eceae6; --muted:#a09a91;
      --line:#31363a; --accent:#7fc4a1; --accent-soft:#1e2f27;
      --new:#7db2ea; --new-soft:#17253440;
      --warn:#d9bd6a; --warn-soft:#2e2819; --miss:#e0a08c; --miss-soft:#2e211d;
      --tile:#282c30;
    }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  .wrap{max-width:1140px;margin:0 auto;padding:40px 20px 72px}
  header{border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:28px}
  h1{font-size:2rem;margin:0 0 8px;letter-spacing:-.02em}
  .sub{color:var(--muted);margin:0}
  .criteria{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
  .chip{background:var(--card);border:1px solid var(--line);border-radius:999px;
    padding:5px 12px;font-size:.82rem;color:var(--muted)}
  h2{font-size:1.2rem;margin:44px 0 6px;letter-spacing:-.01em}
  h2:first-of-type{margin-top:8px}
  .sectnote{color:var(--muted);font-size:.88rem;margin:0 0 18px;max-width:76ch}

  .summary{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 8px}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:10px;
    padding:12px 16px;min-width:112px}
  .stat b{display:block;font-size:1.5rem;letter-spacing:-.02em;line-height:1.15}
  .stat span{font-size:.76rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
  .stat.hi b{color:var(--new)}

  .grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(330px,1fr))}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;
    overflow:hidden;display:flex;flex-direction:column}
  .card.isnew{border-color:var(--new);box-shadow:0 0 0 2px var(--new-soft)}
  .body{padding:16px 18px 18px;display:flex;flex-direction:column;flex:1}

  .media{position:relative;background:var(--tile);border-bottom:1px solid var(--line)}
  .media .hero{width:100%;aspect-ratio:3/2;object-fit:cover;display:block}
  .strip{display:grid;grid-template-columns:repeat(4,1fr);gap:2px;background:var(--line)}
  .strip .thumb{width:100%;aspect-ratio:4/3;object-fit:cover;display:block}
  .media .tile{display:none}
  .media.nophoto{aspect-ratio:3/2}
  .media.nophoto .tile,.media.failed .tile{display:flex}
  .media.failed .hero,.media.failed .strip{display:none}
  .media.failed{aspect-ratio:3/2}
  .tile{position:absolute;inset:0;flex-direction:column;align-items:center;justify-content:center;
    gap:8px;text-decoration:none;color:var(--muted);background:
      repeating-linear-gradient(45deg,transparent,transparent 12px,rgba(128,128,128,.05) 12px,rgba(128,128,128,.05) 24px);}
  .tile:hover{color:var(--accent);background-color:var(--accent-soft)}
  .tile-ico{font-size:2rem;opacity:.55}
  .tile-txt{font-size:.85rem;font-weight:600}

  .tags{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
  .tag{display:inline-block;font-size:.7rem;font-weight:700;letter-spacing:.06em;
    text-transform:uppercase;padding:3px 8px;border-radius:5px}
  .tag.ok{background:var(--accent-soft);color:var(--accent)}
  .tag.new{background:var(--new-soft);color:var(--new)}
  .tag.chg{background:var(--warn-soft);color:var(--warn)}

  .price{font-size:1.5rem;font-weight:650;letter-spacing:-.02em;margin:0}
  .pricechg{display:block;font-size:.8rem;font-weight:700;margin-top:3px}
  .pricechg.down{color:var(--accent)} .pricechg.up{color:var(--miss)}
  .addr{font-weight:600;margin:6px 0 2px;font-size:1.02rem}
  .city{color:var(--muted);font-size:.86rem;margin:0 0 12px}
  .sub-fact{display:inline-block;margin-left:4px;opacity:.85}
  .facts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
  .fact{background:var(--bg);border:1px solid var(--line);border-radius:6px;
    padding:3px 9px;font-size:.8rem;color:var(--muted)}
  .fact b{color:var(--ink);font-weight:650}
  .fact.acres-plus{background:var(--accent-soft);border-color:transparent;color:var(--accent)}
  .fact.acres-plus b{color:var(--accent)}
  .pool{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:650}
  .nopool{background:var(--miss-soft);border-color:transparent;color:var(--miss);font-weight:650}
  .pooldetail{font-size:.8rem;color:var(--accent);margin:0 0 8px}
  .note{font-size:.87rem;color:var(--muted);margin:0 0 10px;flex:1}
  .warn{font-size:.78rem;color:var(--warn);margin:0 0 8px}
  .verified{font-size:.75rem;color:var(--muted);margin:0 0 12px;opacity:.85}
  a.btn{display:inline-block;text-decoration:none;color:var(--accent);font-weight:600;
    font-size:.9rem;border:1px solid var(--line);border-radius:7px;padding:7px 12px;align-self:flex-start}
  a.btn:hover{background:var(--accent-soft)}

  .tablewrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
  table{width:100%;border-collapse:collapse;font-size:.87rem}
  th,td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
  th{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  tr:last-child td{border-bottom:none}
  td a{color:var(--accent)}
  .miss-cell{color:var(--miss)}
  .method{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--accent);
    border-radius:10px;padding:16px 18px;font-size:.88rem;color:var(--muted)}
  .method b{color:var(--ink)}
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
    <span class="chip">${esc(c.beds)}+ bedrooms</span>
    <span class="chip">${esc(c.baths)}+ bathrooms</span>
    <span class="chip">Pool required</span>
    <span class="chip">${esc(c.minAcres)}+ acres (${esc(c.preferredAcres)}+ preferred)</span>
    <span class="chip">Max ${money(c.maxPrice)}</span>
  </div>
</header>

<div class="summary">
  <div class="stat hi"><b>${fresh.length}</b><span>New this run</span></div>
  <div class="stat"><b>${changed.length}</b><span>Price changes</span></div>
  <div class="stat"><b>${listings.length}</b><span>Active matches</span></div>
  <div class="stat"><b>${near.length}</b><span>Near misses</span></div>
  <div class="stat"><b>${dropped.length}</b><span>Dropped</span></div>
</div>

${fresh.length ? `<h2 id="new">&#9733; New this run</h2>
<p class="sectnote">Not on the list before today. Every one was confirmed active by reading its own
listing page — bed, bath, acreage and pool figures come from the listing's MLS fields, not from
search-result text.</p>
<div class="grid">${fresh.map(card).join('\n')}
</div>` : `<h2>New this run</h2>
<p class="sectnote">Nothing new since the last run.</p>`}

${changed.length ? `<h2>Price changes</h2>
<p class="sectnote">Already on the list, but the asking price moved since the last run.</p>
<div class="grid">${changed.map(card).join('\n')}
</div>` : ''}

${steady.length ? `<h2>Still on the market</h2>
<p class="sectnote">Previously reported, re-confirmed active today at the same price.</p>
<div class="grid">${steady.map(card).join('\n')}
</div>` : ''}

${near.length ? `<h2>Near misses — one criterion short</h2>
<p class="sectnote">Active listings that meet everything but a single requirement. Most are homes on
acreage with no pool, which is the pattern across this market: land and bedrooms are easy to find
here, pools are the binding constraint.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>City</th><th>Price</th><th>Beds/baths</th><th>Lot</th><th>Missing</th><th></th></tr></thead>
  <tbody>
${nearRows}
  </tbody>
</table>
</div>` : ''}

${dropped.length ? `<h2>Dropped</h2>
<p class="sectnote">Removed from the list — sold, withdrawn, or no longer meeting the criteria.
Kept here only so they are not re-reported as new finds on a later run.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>City</th><th>Last price</th><th>Reason</th><th>Dropped</th></tr></thead>
  <tbody>
${droppedRows}
  </tbody>
</table>
</div>` : ''}

<h2>How these were checked</h2>
<div class="method">
<p>Every property here was verified by fetching <b>its own listing page</b> and reading the
machine-readable status block, not by trusting search-engine summaries. An earlier version of this
page reported four properties that had all sold months earlier, because search engines keep indexing
sold listings with &ldquo;For Sale&rdquo; in the title long after closing. That failure mode is now
designed out:</p>
<p>&bull; <b>Status</b> comes from the listing page's own status field and MLS status display.<br>
&bull; <b>Beds, baths, acreage and pool</b> come from the listing's MLS amenity fields. Where the
page carries the lot size in more than one place and they disagree, the <b>smallest</b> figure is
used and the disagreement is shown on the card.<br>
&bull; <b>Photos</b> are matched to each listing's own MLS number, so a neighbouring property's
photos can't leak onto the wrong card.<br>
&bull; The search deliberately filters only on bedrooms and price, then applies acreage, bath and
pool rules locally — the portal's own lot-size filter silently omits listings whose lot field is
blank, which would have hidden real matches.</p>
</div>

<footer>
  <p>Generated from <code>listings.json</code> by <code>build.js</code>; data collected by
  <code>hunt.py</code>. ${listings.length} active matches, ${near.length} near misses,
  ${dropped.length} dropped. Source: Redfin listing pages, read ${esc(data.lastRun)}.</p>
  <p>Listing photos are the copyright of the listing brokerages and are hotlinked for private
  reference.</p>
</footer>

</div>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`Built index.html — ${listings.length} matches (${fresh.length} new, ` +
            `${changed.length} price changes), ${near.length} near misses, ${dropped.length} dropped.`);
