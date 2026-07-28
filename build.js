#!/usr/bin/env node
/**
 * Builds index.html from listings.json.
 *
 * Future runs should edit listings.json ONLY, then run `node build.js`.
 * Anything flagged `newThisRun` floats into the "New this run" strip at the top;
 * anything whose priceHistory has more than one entry renders a price delta.
 * Photos hotlink to the listing CDN with referrerpolicy="no-referrer"; a dead URL
 * is swapped client-side for the fallback tile so it never leaves a hole.
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US'));
const short = (n) => (n == null ? '—' : n >= 1e6
  ? '$' + (n / 1e6).toFixed(2).replace(/0$/, '') + 'M'
  : '$' + Math.round(n / 1000) + 'K');

/** Lot sizes arrive with junk precision (0.2052); two decimals is plenty. */
const acreStr = (a) => (a == null ? '—' : String(Math.round(a * 100) / 100));

const host = (u) => {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'listing'; }
};

/* ---------- pieces ---------- */

function media(l) {
  const tile =
    `<a class="tile" href="${esc(l.gallery || l.url)}" target="_blank" rel="noopener">` +
      `<span class="tile-ico" aria-hidden="true">&#9968;</span>` +
      `<span class="tile-txt">View on ${esc(host(l.url))} &rarr;</span>` +
    `</a>`;

  const photos = l.photos || [];
  if (!photos.length) return `<div class="media nophoto">${tile}</div>`;

  const imgs = photos.map((p, i) =>
    `<img src="${esc(p)}" alt="${esc(l.address)}, ${esc(l.city)} — photo ${i + 1}"` +
    ` loading="lazy" referrerpolicy="no-referrer"` +
    ` onerror="this.closest('.media').classList.add('failed')">`).join('');

  return `<div class="media">` +
      `<div class="strip">${imgs}</div>` +
      (photos.length > 1 ? `<span class="count">${photos.length} photos &middot; scroll &rarr;</span>` : '') +
      tile +
    `</div>`;
}

function priceBlock(l) {
  const hist = l.priceHistory || [];
  let delta = '';
  if (hist.length > 1) {
    const a = hist[hist.length - 2].price, b = hist[hist.length - 1].price;
    if (a !== b) {
      const down = b < a;
      const pct = Math.abs((b - a) / a * 100).toFixed(1);
      delta = `<span class="delta ${down ? 'down' : 'up'}">` +
        `${down ? '&darr;' : '&uarr;'} ${money(Math.abs(b - a))} (${pct}%) from ${money(a)}</span>`;
    }
  }
  const ppa = l.acres ? `<span class="ppa">${short(Math.round(l.currentPrice / l.acres))}/acre</span>` : '';
  return `<div class="price">${money(l.currentPrice)}${ppa}${delta}</div>`;
}

function facts(l) {
  const f = [];
  if (l.beds != null) f.push(`<b>${esc(l.beds)}</b> bd`);
  if (l.baths != null) f.push(`<b>${esc(l.baths)}</b> ba`);
  if (l.sqft) f.push(`<b>${l.sqft.toLocaleString('en-US')}</b> sqft`);
  if (l.acres) f.push(`<b>${esc(acreStr(l.acres))}</b> acres`);
  if (l.yearBuilt) f.push(`built <b>${esc(l.yearBuilt)}</b>`);
  return `<div class="facts">${f.map((x) => `<span>${x}</span>`).join('')}</div>`;
}

function card(l, opts = {}) {
  const badges = [];
  if (l.newThisRun) badges.push('<span class="b new">NEW</span>');
  if (l.flag) badges.push(`<span class="b flag">${esc(l.flag)}</span>`);
  if (l.status === 'pending') badges.push('<span class="b pend">Sale pending</span>');
  if (l.acres >= (data.criteria.preferredAcres || 5)) badges.push('<span class="b acre">5+ acres</span>');
  if (l.propertyType && l.propertyType !== 'Single Family') {
    badges.push(`<span class="b type">${esc(l.propertyType)}</span>`);
  }

  const meta = [];
  if (l.mls) meta.push(`MLS ${esc(l.mls)}`);
  if (l.listedOn) meta.push(`listed ${esc(l.listedOn)}`);
  if (l.garageSpaces) meta.push(`${esc(l.garageSpaces)}-car garage`);
  if (l.water) meta.push(esc(l.water));

  return `<article class="card ${opts.dim ? 'dim' : ''}" id="${esc(l.id)}">
  ${media(l)}
  <div class="body">
    <div class="badges">${badges.join('')}</div>
    <h3><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.address)}</a></h3>
    <div class="place">${esc(l.city)}, CA ${esc(l.zip || '')}</div>
    ${priceBlock(l)}
    ${facts(l)}
    <div class="pool"><span aria-hidden="true">&#127946;</span> ${esc(l.poolDetail || 'Pool')}</div>
    ${l.view ? `<div class="view">Views: ${esc(l.view)}</div>` : ''}
    ${l.summary ? `<p class="sum">${esc(l.summary)}&hellip;</p>` : ''}
    ${l.notes ? `<p class="note"><b>Worth knowing:</b> ${esc(l.notes)}</p>` : ''}
    <div class="meta">${meta.join(' &middot; ')}</div>
  </div>
</article>`;
}

/* ---------- page ---------- */

/* Two refresh implementations exist (scrape.js in Node, refresh.py in Python from an
   earlier run). They agree on the fields that carry history — mls, firstSeen,
   priceHistory — but differ on presentation field names. Normalise so either can
   drive this renderer, and a run that swaps implementations still renders correctly. */
const normalize = (l) => ({
  ...l,
  id: l.id || l.mls,
  newThisRun: l.newThisRun ?? l.isNew ?? false,
  summary: l.summary || l.desc || '',
  notes: l.notes || l.caveat || '',
  garageSpaces: l.garageSpaces ?? l.garage ?? null,
  lng: l.lng ?? l.lon ?? null,
});

const L = (data.listings || []).map(normalize);
const fresh = L.filter((l) => l.newThisRun);
/* Only a price that moved *this* run counts as news. A cut reported last run still shows
   its delta on the card, but must not be re-surfaced in the highlights strip. */
const changed = L.filter((l) => {
  const h = l.priceHistory || [];
  return !l.newThisRun && h.length > 1 &&
    h[h.length - 1].price !== h[h.length - 2].price &&
    h[h.length - 1].date === data.lastRun;
});
const rest = L.filter((l) => !l.newThisRun && !changed.includes(l));
const c = data.criteria;

const prices = L.map((l) => l.currentPrice).filter(Boolean);
const acres = L.map((l) => l.acres).filter(Boolean);

const stat = (v, k) => `<div class="stat"><span class="v">${v}</span><span class="k">${k}</span></div>`;

const lastChange = L
  .map((l) => (l.priceHistory || []).slice(-1)[0])
  .filter((h) => h && h.date).map((h) => h.date).sort().pop();

const highlights = !fresh.length && !changed.length
  ? `<div class="strip-empty"><strong>Nothing new this run.</strong> No listings entered the market,
     none changed price, and none dropped off. All ${L.length} matches below were verified again
     today${lastChange && lastChange !== data.lastRun ? `; the most recent movement was on ${esc(lastChange)}` : ''}.</div>`
  : [
      fresh.length ? `<h2 class="h-new">&#10022; ${fresh.length} new ${fresh.length === 1 ? 'listing' : 'listings'} this run</h2>
       <div class="grid">${fresh.map((l) => card(l)).join('')}</div>` : '',
      changed.length ? `<h2 class="h-chg">&#8645; ${changed.length} price ${changed.length === 1 ? 'change' : 'changes'}</h2>
       <div class="grid">${changed.map((l) => card(l)).join('')}</div>` : '',
    ].join('\n');

/* Flat array (scrape.js) or {acreageOkNoPool, poolOkLotTooSmall} buckets (refresh.py). */
const nearList = Array.isArray(data.nearMisses)
  ? data.nearMisses
  : Object.entries(data.nearMisses || {}).flatMap(([bucket, arr]) =>
      (arr || []).map((n) => ({ ...n,
        missing: n.missing || (bucket === 'acreageOkNoPool' ? 'no pool' : `only ${n.acres} acres`) })));

const nearRows = nearList.slice(0, 24).map((n) => `<tr>
  <td><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.address)}</a></td>
  <td>${esc(n.city)}</td><td class="num">${money(n.price)}</td>
  <td class="num">${esc(n.beds)}/${esc(n.baths)}</td>
  <td class="num">${n.acres == null ? '—' : esc(acreStr(n.acres))}</td>
  <td class="miss">${esc(n.missing.replace(/only ([\d.]+) acres/, (_, a) => `only ${acreStr(+a)} acres`))}</td></tr>`).join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>House Hunt — Shingle Springs / Rescue / Placerville</title>
<meta name="description" content="Verified active listings: ${c.beds} bed, ${c.baths} bath, pool, ${c.minAcres}+ acres, under ${short(c.maxPrice)}.">
<style>
*{box-sizing:border-box}
:root{
  --bg:#faf8f5; --panel:#fff; --ink:#1c1a17; --dim:#6b6560; --line:#e6e0d8;
  --accent:#8a5a2b; --new:#0f7b52; --newbg:#e6f4ee; --warn:#9a6b00; --warnbg:#fdf3dd;
  --pend:#8a4a4a; --pendbg:#fbeaea; --shadow:0 1px 2px rgba(0,0,0,.05),0 8px 24px -12px rgba(0,0,0,.14);
}
@media (prefers-color-scheme:dark){:root{
  --bg:#15130f; --panel:#1e1b17; --ink:#f0ece6; --dim:#a39c93; --line:#332e28;
  --accent:#d4a373; --new:#5ad3a0; --newbg:#0f2b21; --warn:#e0b555; --warnbg:#2e2513;
  --pend:#e59a9a; --pendbg:#2e1b1b; --shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px -12px rgba(0,0,0,.6);
}}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);
  font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:0 20px 72px}
a{color:inherit}

header{padding:44px 0 26px;border-bottom:1px solid var(--line);margin-bottom:30px}
h1{font-size:clamp(26px,4.4vw,40px);line-height:1.15;margin:0 0 8px;letter-spacing:-.02em}
h1 span{color:var(--accent)}
.sub{color:var(--dim);margin:0 0 22px;font-size:15px}
.crit{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:22px}
.crit span{background:var(--panel);border:1px solid var(--line);border-radius:999px;
  padding:5px 13px;font-size:13.5px;box-shadow:var(--shadow)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:10px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:13px 15px;box-shadow:var(--shadow)}
.stat .v{display:block;font-size:22px;font-weight:650;letter-spacing:-.02em}
.stat .k{display:block;font-size:11.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--dim);margin-top:2px}

h2{font-size:19px;margin:40px 0 16px;letter-spacing:-.01em;display:flex;align-items:center;gap:10px}
h2.h-new{color:var(--new)}
h2.h-chg{color:var(--warn)}
.lede{color:var(--dim);font-size:14.5px;margin:-8px 0 18px;max-width:74ch}
.strip-empty{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--new);
  border-radius:12px;padding:16px 18px;color:var(--dim);font-size:14.5px}

.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:22px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;
  box-shadow:var(--shadow);display:flex;flex-direction:column}
.card.dim{opacity:.72}

.media{position:relative;background:#d9d2c8;aspect-ratio:16/10}
@media (prefers-color-scheme:dark){.media{background:#26221d}}
.strip{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;height:100%;
  scrollbar-width:thin;-webkit-overflow-scrolling:touch;position:relative;z-index:1}
.strip img{flex:0 0 100%;width:100%;height:100%;object-fit:cover;scroll-snap-align:start;display:block;
  color:transparent;font-size:0}
.media .count{position:absolute;right:9px;bottom:9px;background:rgba(0,0,0,.66);color:#fff;
  font-size:11.5px;padding:3px 9px;border-radius:999px;pointer-events:none;z-index:2}
/* The tile sits permanently behind the photos: loaded images hide it, while an image
   that 404s OR one that simply never resolves both leave the listing link reachable. */
.media .tile{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  gap:9px;text-decoration:none;color:var(--dim);font-size:14px;flex-direction:column;z-index:0}
.media .tile-ico{font-size:26px;opacity:.5}
.media.failed .strip,.media.failed .count{display:none}

.body{padding:17px 18px 18px;display:flex;flex-direction:column;flex:1}
.badges{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:9px}
.badges:empty{display:none}
.b{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
  padding:3px 8px;border-radius:5px;border:1px solid transparent}
.b.new{background:var(--newbg);color:var(--new);border-color:currentColor}
.b.flag{background:var(--warnbg);color:var(--warn);border-color:currentColor}
.b.pend{background:var(--pendbg);color:var(--pend);border-color:currentColor}
.b.acre,.b.type{background:transparent;color:var(--dim);border-color:var(--line)}
h3{margin:0;font-size:18px;letter-spacing:-.01em;line-height:1.3}
h3 a{text-decoration:none}
h3 a:hover{color:var(--accent)}
.place{color:var(--dim);font-size:13.5px;margin-top:1px}
.price{font-size:23px;font-weight:660;margin:11px 0 3px;letter-spacing:-.02em;
  display:flex;align-items:baseline;flex-wrap:wrap;gap:9px}
.ppa{font-size:12.5px;font-weight:500;color:var(--dim);letter-spacing:0}
.delta{font-size:12.5px;font-weight:600;letter-spacing:0}
.delta.down{color:var(--new)} .delta.up{color:var(--pend)}
.facts{display:flex;flex-wrap:wrap;gap:5px 14px;font-size:13.5px;color:var(--dim);margin:8px 0 10px}
.facts b{color:var(--ink);font-weight:620}
.pool{font-size:13px;background:var(--newbg);border-radius:7px;
  padding:6px 10px;margin-bottom:8px;line-height:1.45}
@media (prefers-color-scheme:dark){.pool{color:var(--new)}}
.view{font-size:12.5px;color:var(--dim);margin-bottom:8px}
.sum{font-size:13.5px;color:var(--dim);margin:2px 0 10px;line-height:1.55}
.note{font-size:13px;line-height:1.55;background:var(--warnbg);border-radius:8px;
  padding:9px 11px;margin:0 0 10px}
.note b{color:var(--warn)}
.meta{margin-top:auto;padding-top:11px;border-top:1px solid var(--line);
  font-size:11.5px;color:var(--dim);letter-spacing:.02em}

.tblwrap{overflow-x:auto;background:var(--panel);border:1px solid var(--line);
  border-radius:12px;box-shadow:var(--shadow)}
table{border-collapse:collapse;width:100%;font-size:13.5px;min-width:560px}
th,td{padding:10px 14px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--dim);font-weight:600}
tr:last-child td{border-bottom:0}
td.num{text-align:right;font-variant-numeric:tabular-nums}
td.miss{color:var(--warn);font-size:12.5px}

.list{list-style:none;padding:0;margin:0;display:grid;gap:9px}
.list li{background:var(--panel);border:1px solid var(--line);border-radius:10px;
  padding:12px 15px;font-size:13.5px;box-shadow:var(--shadow)}
.list b{display:block;margin-bottom:2px}
.list span{color:var(--dim)}

details{margin-top:12px}
summary{cursor:pointer;font-size:14px;color:var(--accent);padding:6px 0}
footer{margin-top:56px;padding-top:22px;border-top:1px solid var(--line);
  color:var(--dim);font-size:12.5px;line-height:1.7}
footer code{background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:1px 5px;font-size:12px}
</style>
</head>
<body>
<div class="wrap">

<header>
  <h1>Homes with a pool on acreage<br><span>Shingle Springs &middot; Rescue &middot; Placerville</span></h1>
  <p class="sub">Last checked <strong>${esc(data.lastRun)}</strong> against the live MetroList MLS feed.</p>
  <div class="crit">
    <span>${esc(c.beds)} beds</span><span>${esc(c.baths)} baths</span><span>Pool required</span>
    <span>${esc(c.minAcres)}+ acres (${esc(c.preferredAcres)}+ preferred)</span>
    <span>Under ${short(c.maxPrice)}</span>
  </div>
  <div class="stats">
    ${stat(L.length, 'active matches')}
    ${stat(fresh.length, 'new this run')}
    ${stat(prices.length ? short(Math.min(...prices)) + '–' + short(Math.max(...prices)) : '—', 'price range')}
    ${stat(acres.length ? acreStr(Math.min(...acres)) + '–' + acreStr(Math.max(...acres)) : '—', 'acres')}
    ${stat((data.source && data.source.inventoryScanned) || '—', 'listings scanned')}
  </div>
</header>

${highlights}

${rest.length ? `<h2>${fresh.length || changed.length ? 'Also still on the market' : `All ${rest.length} matches`}</h2>
<div class="grid">${rest.map((l) => card(l)).join('')}</div>` : ''}

${(data.pending || []).length ? `<h2>Under contract</h2>
<p class="lede">These tick every box but are already in escrow. Kept visible only because pending deals do fall through.</p>
<div class="grid">${data.pending.map((l) => card(normalize(l), { dim: true })).join('')}</div>` : ''}

${nearRows ? `<h2>Near misses</h2>
<p class="lede">Active, in the right towns, and clearing ${esc(c.beds)} bed / ${esc(c.baths)} bath / ${short(c.maxPrice)} — but each fails exactly one of the two hard filters. Listed in case one of them is negotiable.</p>
<div class="tblwrap"><table>
<thead><tr><th>Address</th><th>City</th><th>Price</th><th>Bd/Ba</th><th>Acres</th><th>Fails on</th></tr></thead>
<tbody>${nearRows}</tbody></table></div>` : ''}

${(() => {
  const dr = data.dropped || [];
  if (!dr.length) return '';
  const today = dr.filter((d) => d.droppedOn === data.lastRun);
  const head = today.length ? `Dropped this run (${today.length})` : 'Dropped previously';
  const lede = today.length
    ? 'Confirmed gone from live MLS inventory since the last check.'
    : 'Tracked at some point, then confirmed gone from live MLS inventory. Nothing dropped off this run.';
  return `<h2>${head}</h2>
<p class="lede">${lede}</p>
<ul class="list">${dr.map((d) => `<li><b>${esc(d.address)}</b><span>${esc(d.reason)}` +
    `${d.droppedOn ? ` <em>(dropped ${esc(d.droppedOn)})</em>` : ''}</span></li>`).join('')}</ul>`;
})()}

${(data.rejected || []).length ? `<details><summary>Checked and ruled out (${data.rejected.length})</summary>
<ul class="list" style="margin-top:12px">${data.rejected.map((r) => `<li><b>${esc(r.address)}${r.price ? ' — ' + money(r.price) : ''}</b><span>${esc(r.reason)}</span></li>`).join('')}</ul></details>` : ''}

<footer>
  <p><strong>How this list is built.</strong> ${esc((data.source && data.source.method) || '')}
  Source: ${esc((data.source && data.source.name) || 'MLS IDX feed')}.
  ${esc((data.source && data.source.inventoryScanned) || 0)} active listings across the three towns were scanned;
  ${esc((data.source && data.source.passedBedsBathsPrice) || 0)} cleared beds, baths and price;
  ${L.length} of those have both a pool and ${esc(c.minAcres)}+ acres and are still Active.</p>
  <p>A property is only shown as a match when its detail page carries an explicit MLS
  <code>Pool</code> field, a numeric <code>Lot Size (Acres)</code> field, and a status of <code>Active</code>.
  Note that the feed's <code>IsActive</code> flag stays true on Sale Pending listings, so status is read
  from the listing's own status field instead.</p>
  <p>Photos are hotlinked from the listing brokerage and remain their copyright.
  Generated from <code>listings.json</code> by <code>build.js</code> &middot; ${esc(data.lastRun)}.</p>
</footer>

</div>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`Built index.html — ${L.length} matches (${fresh.length} new, ${changed.length} price changes), ` +
  `${(data.pending || []).length} pending, ${nearList.length} near misses, ` +
  `${(data.dropped || []).length} dropped.`);
