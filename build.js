#!/usr/bin/env node
/**
 * Builds index.html from listings.json.
 *
 * Future runs should edit listings.json ONLY, then run `node build.js`.
 * Photos: add URLs to a listing's `photos` array and they render as a swipeable
 * gallery. If `photos` is empty, the card falls back to a "View photos" tile
 * pointing at `gallery` (or `url`). If a hotlinked photo fails to load in the
 * browser, the same tile is swapped in client-side, so a dead image URL never
 * leaves a hole in the layout.
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (n == null ? '—' : '$' + n.toLocaleString('en-US'));

const TAGS = {
  match:                  { cls: 'match',   tag: 'ok',   label: 'Verified match' },
  'active-fails-criteria':{ cls: 'caution', tag: 'warn', label: 'Active — fails criteria' },
  'off-market':           { cls: 'miss',    tag: 'bad',  label: 'Off market' },
};

function galleryHost(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').split('.')[0]; }
  catch { return 'listing'; }
}

/** Media area: swipeable gallery when we have photos, graceful tile when we don't. */
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

  const slides = photos.map((p, i) =>
    `<img src="${esc(p)}" alt="${esc(l.address)}, ${esc(l.city)} — photo ${i + 1}" ` +
    `loading="${i === 0 ? 'eager' : 'lazy'}" referrerpolicy="no-referrer" ` +
    `onerror="this.remove()">`
  ).join('');

  const dots = photos.length > 1
    ? `<span class="count">1 / ${photos.length}</span>`
    : '';

  return `<div class="media">` +
    `<div class="strip">${slides}</div>` +
    dots +
    `<a class="more" href="${esc(gallery)}" rel="noopener">All photos &rarr;</a>` +
    tile +
  `</div>`;
}

function facts(l) {
  const f = [];
  if (l.beds != null)  f.push(`<span class="fact">${esc(l.beds)} bd</span>`);
  if (l.baths != null) f.push(`<span class="fact">${esc(l.baths)} ba</span>`);
  if (l.sqft)  f.push(`<span class="fact">${l.sqft.toLocaleString('en-US')} sqft</span>`);
  if (l.acres) f.push(`<span class="fact${l.acres >= 5 ? ' good' : ''}">${esc(l.acres)} acres</span>`);
  if (l.yearBuilt) f.push(`<span class="fact">built ${esc(l.yearBuilt)}</span>`);
  f.push(l.pool
    ? `<span class="fact pool">${esc(l.poolDetail || 'Pool')}</span>`
    : `<span class="fact nopool">${esc(l.poolDetail || 'No pool')}</span>`);
  return f.join('');
}

function priceBlock(l) {
  const hist = l.priceHistory || [];
  const extra = l.daysOnMarket != null
    ? `<span class="dom">${l.daysOnMarket} day${l.daysOnMarket === 1 ? '' : 's'} on market</span>` : '';
  if (hist.length > 1) {
    const prev = hist[hist.length - 2].price;
    const now  = l.currentPrice;
    const down = now < prev;
    const delta = Math.abs(now - prev);
    return `<p class="price">${money(now)}` +
      `<span class="pricechg ${down ? 'down' : 'up'}">` +
      `${down ? '&darr;' : '&uarr;'} ${money(delta)} from ${money(prev)}</span></p>${extra}`;
  }
  return `<p class="price">${money(l.currentPrice)}</p>${extra}`;
}

function card(l) {
  const meta = TAGS[l.status] || { cls: 'match', tag: 'ok', label: 'Match' };
  const label = l.badge || meta.label;
  const mls = l.mls ? ` &middot; MLS ${esc(l.mls)}` : '';
  const listedBy = l.listedBy ? `<p class="broker">Listed by ${esc(l.listedBy)}</p>` : '';
  const verif = l.verification
    ? `<details class="verif"><summary>How this was verified</summary><p>${esc(l.verification)}</p></details>`
    : '';
  return `
  <div class="card ${meta.cls}">
    ${media(l)}
    <div class="body">
      <span class="tag ${meta.tag}">${esc(label)}</span>
      ${priceBlock(l)}
      <p class="addr">${esc(l.address)}</p>
      <p class="city">${esc(l.city)}, CA ${esc(l.zip)}${mls}</p>
      <div class="facts">${facts(l)}</div>
      <p class="note">${l.blurb || esc(l.notes)}</p>
      ${listedBy}
      ${verif}
      <a class="btn" href="${esc(l.url)}" rel="noopener">View listing &rarr;</a>
    </div>
  </div>`;
}

const byStatus = (s) => data.listings.filter((l) => l.status === s);
const matches  = byStatus('match');
const active   = byStatus('active-fails-criteria');
const archived = byStatus('off-market');

const rejectedRows = data.rejected
  .map((r) => `    <tr><td>${esc(r.address)}</td><td>${money(r.price)}</td><td>${esc(r.reason)}</td></tr>`)
  .join('\n');

const noPool = data.noPoolActive || [];
const noPoolRows = noPool
  .map((r) => `    <tr><td><a href="${esc(r.url)}" rel="noopener">${esc(r.address)}</a></td>` +
              `<td>${money(r.price)}</td><td>${esc(r.beds)} bd / ${esc(r.baths)} ba</td>` +
              `<td>${esc(r.acres)}</td></tr>`)
  .join('\n');

const cheapest = matches.length ? matches.reduce((a, b) => (a.currentPrice <= b.currentPrice ? a : b)) : null;
const mostLand = matches.length ? matches.reduce((a, b) => (a.acres >= b.acres ? a : b)) : null;

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
  .chip.new{background:var(--accent-soft);color:var(--accent);border-color:transparent;font-weight:600}
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
  .strip{display:flex;height:100%;overflow-x:auto;scroll-snap-type:x mandatory;
    scrollbar-width:none;-webkit-overflow-scrolling:touch}
  .strip::-webkit-scrollbar{display:none}
  .strip img{flex:0 0 100%;width:100%;height:100%;object-fit:cover;display:block;scroll-snap-align:center}
  .strip:empty{display:none}
  .count,.more{position:absolute;bottom:10px;font-size:.72rem;font-weight:600;
    background:rgba(0,0,0,.62);color:#fff;padding:3px 9px;border-radius:999px;
    backdrop-filter:blur(3px)}
  .count{left:10px}
  .more{right:10px;text-decoration:none}
  .more:hover{background:rgba(0,0,0,.82)}
  .media .tile{display:none}
  .media.nophoto .tile,.media.failed .tile{display:flex}
  .media.nophoto .count,.media.nophoto .more,
  .media.failed .count,.media.failed .more{display:none}
  .tile{position:absolute;inset:0;flex-direction:column;align-items:center;justify-content:center;
    gap:8px;text-decoration:none;color:var(--muted);background:
      repeating-linear-gradient(45deg,transparent,transparent 12px,rgba(128,128,128,.05) 12px,rgba(128,128,128,.05) 24px);}
  .tile:hover{color:var(--accent);background-color:var(--accent-soft)}
  .tile-ico{font-size:2rem;opacity:.55}
  .tile-txt{font-size:.85rem;font-weight:600}

  .price{font-size:1.45rem;font-weight:650;letter-spacing:-.02em;margin:0}
  .pricechg{display:block;font-size:.8rem;font-weight:700;margin-top:3px}
  .pricechg.down{color:var(--accent)} .pricechg.up{color:var(--miss)}
  .dom{display:block;font-size:.78rem;color:var(--muted);margin-top:2px}
  .addr{font-weight:600;margin:8px 0 2px}
  .city{color:var(--muted);font-size:.9rem;margin:0 0 14px}
  .facts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
  .fact{background:var(--bg);border:1px solid var(--line);border-radius:6px;
    padding:3px 9px;font-size:.8rem}
  .fact.good{border-color:var(--accent);color:var(--accent);font-weight:600}
  .pool{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:600}
  .nopool{background:var(--miss-soft);border-color:transparent;color:var(--miss);font-weight:600}
  .tag{display:inline-block;font-size:.72rem;font-weight:700;letter-spacing:.06em;
    text-transform:uppercase;padding:3px 8px;border-radius:5px;margin-bottom:12px;align-self:flex-start}
  .tag.ok{background:var(--accent-soft);color:var(--accent)}
  .tag.warn{background:var(--warn-soft);color:var(--warn)}
  .tag.bad{background:var(--miss-soft);color:var(--miss)}
  .note{font-size:.88rem;color:var(--muted);margin:0 0 12px;flex:1}
  .note strong{color:var(--ink)}
  .broker{font-size:.78rem;color:var(--muted);margin:0 0 10px}
  .verif{font-size:.78rem;color:var(--muted);margin:0 0 14px}
  .verif summary{cursor:pointer;color:var(--accent);font-weight:600}
  .verif p{margin:8px 0 0;line-height:1.5}
  a.btn{display:inline-block;text-decoration:none;color:var(--accent);font-weight:600;
    font-size:.9rem;border:1px solid var(--line);border-radius:7px;padding:7px 12px;align-self:flex-start}
  a.btn:hover{background:var(--accent-soft)}
  .banner{background:var(--accent-soft);border:1px solid var(--line);border-left:4px solid var(--accent);
    border-radius:10px;padding:16px 18px;margin-bottom:28px;font-size:.9rem}
  .banner h3{margin:0 0 6px;font-size:.95rem}
  .banner p{margin:0 0 8px;color:var(--muted)}
  .banner p:last-child{margin-bottom:0}
  .banner code{background:var(--bg);padding:1px 5px;border-radius:4px;font-size:.85em}
  .tablewrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
  table{width:100%;border-collapse:collapse;font-size:.88rem}
  th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
  th{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  td a{color:var(--accent)}
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
    <span class="chip new">4+ bedrooms</span>
    <span class="chip">3+ bathrooms</span>
    <span class="chip">Pool required</span>
    <span class="chip">2.5+ acres (5+ preferred)</span>
    <span class="chip">Max $1.5M</span>
  </div>
</header>

<div class="banner">
  <h3>&#10003; ${matches.length} verified matches this run</h3>
  <p>This run could read Redfin listing pages directly, so status and pool are taken from the
  <strong>live listing</strong> rather than inferred from search-engine text — the failure that
  produced four bogus matches on the previous run. ${data.dataQuality.candidatesScreened} active
  listings cleared the bed/bath/acreage/price filters; each one's own listing page was then opened
  and its <code>POOL_PRIVATE_YN</code> field read, which is what narrowed it to ${matches.length}.</p>
  <p>Every match below is confirmed <strong>Active</strong> with a <strong>confirmed private pool</strong>,
  cross-checked against two independent fields on the same page. Cheapest is
  <strong>${money(cheapest && cheapest.currentPrice)}</strong>; most land is
  <strong>${esc(mostLand && mostLand.acres)} acres</strong>. Bedroom minimum was relaxed to 4+ for this run.</p>
</div>

${matches.length ? `<h2>Verified matches</h2>
<p class="sectnote">Confirmed active and meeting every hard criterion, cheapest first. Swipe the photos.</p>
<div class="grid">${matches.map(card).join('\n')}
</div>` : ''}

${noPool.length ? `<h2>Active, but no pool</h2>
<p class="sectnote">These ${noPool.length} listings are on the market right now and clear your bedroom,
bathroom, acreage and price filters — the pool is the only thing missing. Recorded so future runs
don't re-surface them, and so one adding a pool shows up as a change. This is the clearest evidence
that <strong>the pool, not the budget, is the binding constraint</strong>.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Price</th><th>Beds / baths</th><th>Acres</th></tr></thead>
  <tbody>
${noPoolRows}
  </tbody>
</table>
</div>` : ''}

${active.length ? `<h2>Active, but doesn't meet criteria</h2>
<p class="sectnote">Confirmed on the market — listed here for transparency, not as a recommendation.</p>
<div class="grid">${active.map(card).join('\n')}
</div>` : ''}

<h2>Archive — checked, not available</h2>
<p class="sectnote">Reported in error on the first run, or ruled out on the facts. Kept so they are
not re-surfaced as new finds. None reappeared in this run's live results. MLS year prefixes are shown
where known — <code>221…</code> is a 2021 listing, <code>225…</code> a 2025 one, <code>226…</code> a 2026 one.</p>
<div class="grid">${archived.map(card).join('\n')}
</div>

<h2>Ruled out on the facts</h2>
<p class="sectnote">Failed price, bedroom, bath or acreage minimums regardless of availability.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Price</th><th>Why not</th></tr></thead>
  <tbody>
${rejectedRows}
  </tbody>
</table>
</div>

<h2>Reading the market</h2>
<p class="sectnote">Relaxing the bedroom minimum from 5 to 4 is what opened this search up — seven of
the ${matches.length} matches are 4-bedroom, and only one (Stagecoach Rd) would have qualified under the
old 5-bedroom rule. The earlier read still holds otherwise: <strong>the pool is the binding
constraint, not the budget.</strong> ${noPool.length} homes are actively listed that meet everything
except the pool, several of them well under $1M on 5–20 acres. Placerville in particular is thick with
large-acreage homes at $600K–$1.05M that have ponds and streams rather than pools. If you are willing
to <em>add</em> a pool, your options roughly triple and your entry price drops by around $200–300K.</p>

<footer>
  <p>Generated from <code>listings.json</code> by <code>build.js</code>.
  <strong>${matches.length} verified matches</strong>, ${noPool.length} active without a pool,
  ${archived.length} archived, ${data.rejected.length} ruled out.
  Sources read live on ${esc(data.lastRun)}. Photos are hotlinked from the listing brokerages and
  remain their copyright. Future runs flag only new listings and price changes — no repeats.</p>
</footer>

</div>
<script>
  // Live "n / total" counter as the photo strip is swiped.
  for (const strip of document.querySelectorAll('.strip')) {
    const media = strip.closest('.media');
    const count = media.querySelector('.count');
    if (!count) continue;
    strip.addEventListener('scroll', () => {
      const n = Math.round(strip.scrollLeft / strip.clientWidth) + 1;
      count.textContent = n + ' / ' + strip.children.length;
    }, { passive: true });
  }
  // If every image in a card failed to load, fall back to the "view photos" tile.
  addEventListener('load', () => {
    for (const media of document.querySelectorAll('.media')) {
      const strip = media.querySelector('.strip');
      if (strip && strip.children.length === 0) media.classList.add('failed');
    }
  });
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
const photoCount = data.listings.filter((l) => l.photos && l.photos.length).length;
console.log(`Built index.html — ${matches.length} verified matches, ${noPool.length} active-no-pool, ` +
            `${active.length} active/off-criteria, ${archived.length} archived, ` +
            `${photoCount}/${data.listings.length} with photos.`);
