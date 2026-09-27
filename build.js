#!/usr/bin/env node
/**
 * Builds index.html from listings.json.
 *
 * Edit listings.json only — or better, run `python3 scan.py` to refresh it from
 * the live Redfin feed — then `node build.js`.
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US'));

const prettyDate = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

function media(l) {
  const gallery = l.gallery || l.url;
  const tile =
    `<a class="tile" href="${esc(gallery)}" rel="noopener">` +
      `<span class="tile-ico" aria-hidden="true">&#9968;</span>` +
      `<span class="tile-txt">View photos on redfin &rarr;</span>` +
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
  if (l.acres) f.push(`<span class="fact${l.acres >= 5 ? ' big' : ''}">${esc(l.acres)} acres</span>`);
  if (l.yearBuilt) f.push(`<span class="fact">built ${esc(l.yearBuilt)}</span>`);
  f.push(`<span class="fact pool">${esc(l.poolDetail || 'Pool')}</span>`);
  return f.join('');
}

function priceBlock(l) {
  const hist = l.priceHistory || [];
  if (hist.length > 1) {
    const prev = hist[hist.length - 2].price;
    const now = l.currentPrice;
    const down = now < prev;
    return `<p class="price">${money(now)}` +
      `<span class="pricechg ${down ? 'down' : 'up'}">` +
      `${down ? '&darr;' : '&uarr;'} ${money(Math.abs(now - prev))} from ${money(prev)}` +
      ` &middot; ${esc(prettyDate(hist[hist.length - 2].date))}</span></p>`;
  }
  return `<p class="price">${money(l.currentPrice)}</p>`;
}

function card(l) {
  const badge = l.isNew
    ? `<span class="tag new">New this run</span>`
    : (l.priceChanged ? `<span class="tag warn">Price change</span>`
                      : `<span class="tag ok">Tracked since ${esc(prettyDate(l.firstSeen))}</span>`);
  const mls = l.mls ? ` &middot; MLS ${esc(l.mls)}` : '';
  const ppsf = l.sqft ? ` &middot; ${money(Math.round(l.currentPrice / l.sqft))}/sqft` : '';
  const feats = (l.poolFeatures || []).length
    ? `<p class="poolfeat">Pool: ${esc(l.poolFeatures.join(' · '))}</p>` : '';
  const who = l.agent
    ? `<p class="agent">${esc(l.agent)}${l.broker ? ' &middot; ' + esc(l.broker) : ''}</p>` : '';
  return `
  <article class="card ${l.isNew ? 'isnew' : 'match'}">
    ${media(l)}
    <div class="body">
      ${badge}
      ${priceBlock(l)}
      <p class="addr">${esc(l.address)}</p>
      <p class="city">${esc(l.city)}, CA ${esc(l.zip)}${mls}${ppsf}</p>
      <div class="facts">${facts(l)}</div>
      ${feats}
      <p class="note">${esc(l.notes)}${(l.notes || '').length >= 420 ? '…' : ''}</p>
      ${who}
      <a class="btn" href="${esc(l.url)}" rel="noopener">View listing &rarr;</a>
    </div>
  </article>`;
}

const listings = data.listings || [];
const fresh = listings.filter((l) => l.isNew);
const repriced = listings.filter((l) => !l.isNew && l.priceChanged);
const steady = listings.filter((l) => !l.isNew && !l.priceChanged);
const nearMisses = data.nearMisses || [];
const removed = data.removed || [];
const removedThisRun = removed.filter((r) => r.removedOn === data.lastRun);

const headlineBits = [];
if (fresh.length) headlineBits.push(`${fresh.length} new`);
if (repriced.length) headlineBits.push(`${repriced.length} price change${repriced.length > 1 ? 's' : ''}`);
if (removedThisRun.length) headlineBits.push(`${removedThisRun.length} dropped`);
const headline = headlineBits.length ? headlineBits.join(' · ') : 'no changes';

const newBanner = (fresh.length || repriced.length)
  ? `<section class="banner good">
  <h3>&#10024; What changed this run</h3>
  <p>${fresh.length
      ? `<strong>${fresh.length} new ${fresh.length > 1 ? 'properties' : 'property'}</strong> matching every criterion: ${
          fresh.map((l) => `${esc(l.address)} (${money(l.currentPrice)})`).join(', ')}.`
      : 'No new properties this run.'}
  ${repriced.length
      ? `<br><strong>${repriced.length} price change${repriced.length > 1 ? 's' : ''}:</strong> ${
          repriced.map((l) => {
            const h = l.priceHistory;
            return `${esc(l.address)} ${money(h[h.length - 2].price)} &rarr; ${money(l.currentPrice)}`;
          }).join(', ')}.`
      : ''}</p>
  ${removedThisRun.length
      ? `<p class="dim">${removedThisRun.length} previously tracked ${
          removedThisRun.length > 1 ? 'properties are' : 'property is'} no longer on the market and ${
          removedThisRun.length > 1 ? 'have' : 'has'} been dropped &mdash; <a href="#removed">see below</a>.</p>`
      : ''}
</section>`
  : `<section class="banner">
  <h3>No new matches this run</h3>
  <p>Everything below was already on the list at the same price. ${
    removedThisRun.length ? `${removedThisRun.length} property left the market &mdash; <a href="#removed">see below</a>.` : ''}</p>
</section>`;

const nearRows = nearMisses.map((r) => `    <tr>
      <td><a href="${esc(r.url)}" rel="noopener">${esc(r.address)}</a></td>
      <td>${esc(r.city)}</td>
      <td>${money(r.price)}</td>
      <td>${esc(r.beds)}/${esc(r.baths)}</td>
      <td>${esc(r.acres)}</td>
      <td class="why">${esc(r.reason)}</td>
    </tr>`).join('\n');

const removedRows = removed.slice().reverse().map((r) => `    <tr>
      <td>${esc(r.address)}</td>
      <td>${esc(r.city)}</td>
      <td>${money(r.lastPrice)}</td>
      <td>${esc(prettyDate(r.removedOn))}</td>
      <td class="why">${esc(r.reason)}</td>
    </tr>`).join('\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>House Hunt — Shingle Springs · Rescue · Placerville</title>
<meta name="description" content="Tracked 4BR+/3BA+ homes with a pool on 2.5+ acres under $1.5M in El Dorado County, CA.">
<style>
  :root{
    --bg:#f6f4f0; --card:#fff; --ink:#1c1a17; --muted:#6b665e;
    --line:#e2ddd4; --accent:#2f6b4f; --accent-soft:#e6f0ea;
    --new:#1d5fa8; --new-soft:#e4eefa;
    --warn:#8a6d1f; --warn-soft:#f8f0d8; --miss:#8a4b3a; --miss-soft:#f7e7e2;
    --tile:#ece7de;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#16181a; --card:#1f2225; --ink:#eceae6; --muted:#a09a91;
      --line:#31363a; --accent:#7fc4a1; --accent-soft:#1e2f27;
      --new:#8ab9e8; --new-soft:#1b2733;
      --warn:#d9bd6a; --warn-soft:#2e2819; --miss:#e0a08c; --miss-soft:#2e211d;
      --tile:#282c30;
    }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  .wrap{max-width:1080px;margin:0 auto;padding:40px 20px 72px}
  header{border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:28px}
  h1{font-size:1.9rem;margin:0 0 8px;letter-spacing:-.02em}
  .sub{color:var(--muted);margin:0}
  .pill{display:inline-block;background:var(--accent-soft);color:var(--accent);
    font-weight:700;font-size:.78rem;padding:2px 9px;border-radius:999px;margin-left:6px}
  .criteria{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
  .chip{background:var(--card);border:1px solid var(--line);border-radius:999px;
    padding:5px 12px;font-size:.82rem;color:var(--muted)}
  h2{font-size:1.15rem;margin:40px 0 6px;letter-spacing:-.01em}
  .sectnote{color:var(--muted);font-size:.88rem;margin:0 0 18px;max-width:70ch}
  .grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fill,minmax(330px,1fr))}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;
    overflow:hidden;display:flex;flex-direction:column}
  .card.match{border-top:4px solid var(--accent)}
  .card.isnew{border-top:4px solid var(--new);box-shadow:0 0 0 1px var(--new-soft)}
  .body{padding:18px 20px 20px;display:flex;flex-direction:column;flex:1}
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
  .city{color:var(--muted);font-size:.86rem;margin:0 0 14px}
  .facts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
  .fact{background:var(--bg);border:1px solid var(--line);border-radius:6px;
    padding:3px 9px;font-size:.8rem}
  .fact.big{background:var(--warn-soft);border-color:transparent;color:var(--warn);font-weight:600}
  .pool{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:600}
  .poolfeat{font-size:.78rem;color:var(--accent);margin:0 0 10px}
  .agent{font-size:.76rem;color:var(--muted);margin:0 0 12px}
  .tag{display:inline-block;font-size:.72rem;font-weight:700;letter-spacing:.06em;
    text-transform:uppercase;padding:3px 8px;border-radius:5px;margin-bottom:12px;align-self:flex-start}
  .tag.ok{background:var(--accent-soft);color:var(--accent)}
  .tag.new{background:var(--new-soft);color:var(--new)}
  .tag.warn{background:var(--warn-soft);color:var(--warn)}
  .note{font-size:.88rem;color:var(--muted);margin:0 0 14px;flex:1}
  a.btn{display:inline-block;text-decoration:none;color:var(--accent);font-weight:600;
    font-size:.9rem;border:1px solid var(--line);border-radius:7px;padding:7px 12px;align-self:flex-start}
  a.btn:hover{background:var(--accent-soft)}
  .banner{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--muted);
    border-radius:10px;padding:16px 18px;margin-bottom:28px;font-size:.92rem}
  .banner.good{border-left-color:var(--new);background:var(--new-soft)}
  .banner h3{margin:0 0 8px;font-size:1rem}
  .banner p{margin:0 0 6px}
  .banner p:last-child{margin-bottom:0}
  .banner .dim{color:var(--muted);font-size:.86rem}
  .tablewrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
  table{width:100%;border-collapse:collapse;font-size:.88rem}
  th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
  th{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  td a{color:var(--accent)}
  td.why{white-space:normal;color:var(--muted)}
  tr:last-child td{border-bottom:none}
  footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);
    color:var(--muted);font-size:.84rem}
  footer code{background:var(--card);padding:1px 5px;border-radius:4px}
</style>
</head>
<body>
<div class="wrap">

<header>
  <h1>House Hunt: El Dorado County</h1>
  <p class="sub">Shingle Springs · Rescue · Placerville — updated <strong>${esc(prettyDate(data.lastRun))}</strong><span class="pill">${esc(headline)}</span></p>
  <div class="criteria">
    <span class="chip">4+ bedrooms</span>
    <span class="chip">3+ bathrooms</span>
    <span class="chip">Pool required</span>
    <span class="chip">2.5+ acres (5+ preferred)</span>
    <span class="chip">Max $1.5M</span>
  </div>
</header>

${newBanner}

${fresh.length ? `<h2>New this run</h2>
<p class="sectnote">First time on this list. Confirmed active on the MLS feed, and every hard
criterion checked against the listing itself.</p>
<div class="grid">${fresh.map(card).join('\n')}
</div>` : ''}

${repriced.length ? `<h2>Price changed</h2>
<p class="sectnote">Already tracked, but the asking price moved since the last run.</p>
<div class="grid">${repriced.map(card).join('\n')}
</div>` : ''}

${steady.length ? `<h2>Still on the market</h2>
<p class="sectnote">Tracked previously, still active, same price.</p>
<div class="grid">${steady.map(card).join('\n')}
</div>` : ''}

${!listings.length ? `<h2>No matches right now</h2>
<p class="sectnote">Nothing currently on the market in the three towns meets all five criteria.
The near misses below show how close the inventory gets.</p>` : ''}

${nearMisses.length ? `<h2>Near misses</h2>
<p class="sectnote">Active right now and clearing the 4BR / 3BA / 2.5-acre / $1.5M bar on everything
except the column on the right. Almost always the pool. Listed so the same properties don't get
re-researched next run.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>City</th><th>Price</th><th>Bd/Ba</th><th>Acres</th><th>Why not</th></tr></thead>
  <tbody>
${nearRows}
  </tbody>
</table>
</div>` : ''}

${removed.length ? `<h2 id="removed">Dropped — sold or off market</h2>
<p class="sectnote">Gone from active MLS inventory. Kept only so a genuine relist gets flagged as
news rather than re-reported as a new find.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>City</th><th>Last price</th><th>Dropped</th><th>Reason</th></tr></thead>
  <tbody>
${removedRows}
  </tbody>
</table>
</div>` : ''}

<h2>How this page is built</h2>
<p class="sectnote">Each run queries Redfin's live search for all three towns (by city region
<em>and</em> by ZIP, so unincorporated addresses aren't missed), then opens every candidate's own
listing page and reads the MLS fields directly — status, price, beds, baths, lot size, and
<code>POOL_PRIVATE_YN</code>. A property is only shown above when its own listing page confirms it.
A pool that can't be confirmed is treated as a no, and search-engine text is never used for status:
that is what produced the false matches on the very first run of this tracker.</p>
<p class="sectnote"><strong>The pool is still the binding constraint, not the budget.</strong>
${esc(String(data.dataQuality?.activeCandidatesScanned ?? nearMisses.length + listings.length))} active
properties in these towns clear 4BR / 3BA / 2.5 acres / $1.5M — only ${listings.length} of them have a
pool. Large acreage under $1.5M is plentiful here; a pool on top of it is rare, so a genuine match is
worth moving on quickly.</p>

<footer>
  <p>${listings.length} matching ${listings.length === 1 ? 'property' : 'properties'} ·
  ${nearMisses.length} near misses · ${removed.length} dropped.
  Source: ${esc(data.dataQuality?.source || 'Redfin')}, read live on ${esc(prettyDate(data.lastRun))}.</p>
  <p>Generated from <code>listings.json</code> by <code>build.js</code>; refresh with
  <code>python3 scan.py</code>. Listing photos are the copyright of the listing brokerage.</p>
</footer>

</div>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`Built index.html — ${listings.length} matches (${fresh.length} new, ${repriced.length} repriced), ` +
            `${nearMisses.length} near misses, ${removed.length} dropped.`);
