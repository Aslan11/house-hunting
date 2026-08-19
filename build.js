#!/usr/bin/env node
/**
 * Builds index.html from listings.json.
 *
 * Future runs should edit listings.json ONLY, then run `node build.js`.
 *
 * Sections, in the order a returning reader wants them:
 *   1. New this run   — anything with isNew, plus anything whose price moved. Top of page.
 *   2. The board      — every current match, grouped match / caveat / pending.
 *   3. Changes        — what left the board since the previous run, and why.
 *   4. Near misses    — failed exactly one hard criterion; useful for calibrating trade-offs.
 *   5. Ruled out      — the long tail, as a table.
 *
 * Photos live in each listing's `photos` array. The viewer's browser fetches them directly, so
 * they render even though the generating environment can't load images. A dead URL falls back
 * client-side to a "view gallery" tile, so a broken link never leaves a hole in the layout.
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US'));
const short = (n) => (n == null ? '—' : n >= 1e6 ? '$' + (n / 1e6).toFixed(2).replace(/0$/, '') + 'M'
                                                 : '$' + Math.round(n / 1000) + 'K');

const TIERS = {
  match:   { cls: 'match',   tag: 'ok',   label: 'Meets every criterion' },
  caveat:  { cls: 'caution', tag: 'warn', label: 'Meets it on paper — read the caveat' },
  pending: { cls: 'pending', tag: 'pend', label: 'Sale pending' },
};

const listings = data.listings || [];
const rs = data.runSummary || {};
const tier = (t) => listings.filter((l) => l.status === t);
const matches = tier('match');
const caveats = tier('caveat');
const pendings = tier('pending');

const priceMoved = (l) => (l.priceHistory || []).length > 1;
/* "New this run" means: never shown before, price moved, or the listing changed hands
   between active and pending. Everything else is a duplicate and is not re-announced. */
const fresh = listings.filter((l) => l.isNew || priceMoved(l) || l.statusChange);

function host(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').split('.')[0]; }
  catch { return 'listing'; }
}

/** Media strip: first photo large, the rest as a thumbnail rail. */
function media(l) {
  const gallery = l.gallery || l.url;
  const tile =
    `<a class="tile" href="${esc(gallery)}" rel="noopener" target="_blank">` +
      `<span class="tile-ico" aria-hidden="true">&#9968;</span>` +
      `<span class="tile-txt">View gallery on ${esc(host(gallery))} &rarr;</span>` +
    `</a>`;

  const photos = l.photos || [];
  if (!photos.length) return `<div class="media nophoto">${tile}</div>`;

  const thumbs = photos.slice(1, 5).map((p, i) =>
    `<img src="${esc(p)}" alt="${esc(l.address)} photo ${i + 2}" loading="lazy"
       referrerpolicy="no-referrer" onerror="this.remove()">`).join('');

  return `<div class="media">` +
    `<a href="${esc(gallery)}" rel="noopener" target="_blank">` +
      `<img class="hero" src="${esc(photos[0])}" alt="${esc(l.address)}, ${esc(l.city)}" loading="lazy" ` +
        `referrerpolicy="no-referrer" onerror="this.closest('.media').classList.add('failed')">` +
    `</a>${tile}` +
    (thumbs ? `<div class="thumbs">${thumbs}</div>` : '') +
  `</div>`;
}

function bathLabel(l) {
  if (l.fullBaths != null && l.halfBaths) return `${l.fullBaths} full + ${l.halfBaths} half ba`;
  return `${l.baths} ba`;
}

function facts(l) {
  const f = [];
  f.push(`<span class="fact">${esc(l.beds)} bd</span>`);
  f.push(`<span class="fact">${esc(bathLabel(l))}</span>`);
  if (l.sqft) f.push(`<span class="fact">${l.sqft.toLocaleString('en-US')} sqft</span>`);
  f.push(`<span class="fact acres${l.acres >= 5 ? ' pref' : ''}">${esc(l.acres)} acres</span>`);
  f.push(`<span class="fact pool">Pool</span>`);
  if (l.horse) f.push(`<span class="fact">Horse property</span>`);
  if (l.yearBuilt) f.push(`<span class="fact">Built ${esc(l.yearBuilt)}</span>`);
  if (l.garage) f.push(`<span class="fact">${esc(l.garage)}-car garage</span>`);
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
      `${down ? '&darr;' : '&uarr;'} ${money(Math.abs(now - prev))} from ${money(prev)}</span></p>`;
  }
  return `<p class="price">${money(l.currentPrice)}</p>`;
}

function verifyLine(l) {
  const v = l.verification || {};
  if (v.dualSourced && v.agrees) {
    return `<p class="verify ok"><span class="vdot"></span>Confirmed on two independent MLS feeds — ` +
           `price, beds, baths and acreage agree exactly.</p>`;
  }
  return `<p class="verify one"><span class="vdot"></span>Confirmed active on the primary MetroList IDX ` +
         `feed (MLS ${esc(l.mls)}). Second feed doesn't index this one — worth a call before you drive out.</p>`;
}

/** Compact row for the "new this run" digest — links down to the full card. */
function digestRow(l) {
  const meta = TIERS[l.status] || TIERS.match;
  const flags = [];
  if (l.isNew) flags.push('<span class="dtag new">New listing</span>');
  if (priceMoved(l)) flags.push('<span class="dtag drop">Price cut</span>');
  if (l.changeKind === 'status') flags.push('<span class="dtag pend">Back on market</span>');
  if (l.changeKind === 'reclassified') flags.push('<span class="dtag warn">Reclassified</span>');
  if (l.status === 'pending') flags.push('<span class="dtag pend">Pending</span>');
  if (l.status === 'caveat') flags.push('<span class="dtag warn">Caveat</span>');
  const flag = flags.join(' ');
  const hist = l.priceHistory || [];
  const moved = hist.length > 1
    ? `<span class="dmoved">${hist[hist.length - 1].price < hist[hist.length - 2].price ? '&darr;' : '&uarr;'} from ${money(hist[hist.length - 2].price)}</span>`
    : '';
  return `
    <a class="drow ${meta.cls}" href="#${esc(l.id)}">
      <span class="dprice">${money(l.currentPrice)}${moved}</span>
      <span class="daddr">${esc(l.address)}<span class="dcity">${esc(l.city)}</span></span>
      <span class="dfacts">${esc(l.beds)}bd &middot; ${esc(bathLabel(l))} &middot; ${esc(l.acres)} ac${l.sqft ? ' &middot; ' + l.sqft.toLocaleString('en-US') + ' sqft' : ''}</span>
      <span class="dflags">${flag}</span>
    </a>`;
}

function card(l, opts = {}) {
  const meta = TIERS[l.status] || TIERS.match;
  const perAcre = l.acres ? ` &middot; ${short(Math.round(l.currentPrice / l.acres))}/acre` : '';
  return `
  <article class="card ${meta.cls}" id="${esc(l.id)}">
    ${media(l)}
    <div class="body">
      <div class="tags">
        <span class="tag ${meta.tag}">${esc(meta.label)}</span>
        ${opts.new ? '<span class="tag new">New</span>' : ''}
      </div>
      ${priceBlock(l)}
      <p class="addr">${esc(l.address)}</p>
      <p class="city">${esc(l.city)}, CA ${esc(l.zip)} &middot; MLS ${esc(l.mls)}${perAcre}</p>
      <div class="facts">${facts(l)}</div>
      <p class="note">${esc(l.blurb)}</p>
      ${l.statusChange ? `<p class="changed ${esc(l.changeKind || '')}"><strong>${l.changeKind === 'reclassified' ? 'Correction' : 'Changed since ' + esc(data.previousRun)}:</strong> ${esc(l.statusChange)}</p>` : ''}
      ${l.caveat ? `<p class="caveat"><strong>Caveat:</strong> ${esc(l.caveat)}</p>` : ''}
      <p class="pooldetail"><strong>Pool:</strong> ${esc(l.poolDetail)}</p>
      ${verifyLine(l)}
      <a class="btn" href="${esc(l.url)}" rel="noopener" target="_blank">Full listing &amp; photos &rarr;</a>
    </div>
  </article>`;
}

/* ---------- assembled sections ---------- */

const newSection = fresh.length ? `
<section class="highlight" id="new">
  <div class="hl-head">
    <h2>What changed this run</h2>
    <span class="count">${fresh.length}</span>
  </div>
  <p class="sectnote">What actually changed since ${esc(data.previousRun)}:
  <strong>${(rs.new || []).length} new listing${(rs.new || []).length === 1 ? '' : 's'}</strong>,
  <strong>${(rs.priceChanges || []).length} price change${(rs.priceChanges || []).length === 1 ? '' : 's'}</strong>,
  <strong>${(rs.statusChanges || []).length} status change${(rs.statusChanges || []).length === 1 ? '' : 's'}</strong>.
  The other ${listings.length - fresh.length} properties on the board are unchanged from last run and
  are not repeated here. Tap any row for the full card and photos.</p>
  <div class="digest">${fresh.map(digestRow).join('')}
  </div>
</section>` : `
<section class="highlight quiet" id="new">
  <div class="hl-head"><h2>What changed this run</h2><span class="count">0</span></div>
  <p class="sectnote">No new listings and no price changes since ${esc(data.previousRun)}.
  The board below is unchanged.</p>
</section>`;

const removedRows = (data.removed || []).map((r) => `
    <tr class="${esc(r.kind)}">
      <td><strong>${esc(r.address)}</strong><br><span class="dim">${esc(r.city)}, CA</span></td>
      <td>${r.kind === 'off-market' ? 'Off market' : 'No longer qualifies'}</td>
      <td class="wrapcell">${esc(r.reason)}</td>
    </tr>`).join('');

const nm = data.nearMisses || [];
const nmPool = nm.filter((n) => n.pool);
const nmAcres = nm.filter((n) => !n.pool);
const nmRows = (rows) => rows.map((n) => `
    <tr>
      <td><a href="${esc(n.url)}" rel="noopener" target="_blank">${esc(n.address)}</a><br>
          <span class="dim">${esc(n.city)}, CA</span></td>
      <td>${money(n.price)}</td>
      <td>${esc(n.beds)}bd / ${esc(n.baths)}ba</td>
      <td>${esc(n.acres)}</td>
      <td class="wrapcell">${esc(n.why)}</td>
    </tr>`).join('');

const rejectedRows = (data.rejected || []).map((r) => `
    <tr><td>${esc(r.address)}</td><td>${money(r.price)}</td><td class="wrapcell">${esc(r.reason)}</td></tr>`).join('');

const dualCount = listings.filter((l) => l.verification && l.verification.agrees).length;
const cheapest = listings.length ? Math.min(...listings.map((l) => l.currentPrice)) : null;
const biggest = listings.length ? Math.max(...listings.map((l) => l.acres)) : null;

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
    --pend:#4a5a86; --pend-soft:#e7ebf5; --tile:#ece7de; --new:#a8451f; --new-soft:#fbe8df;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#16181a; --card:#1f2225; --ink:#eceae6; --muted:#a09a91;
      --line:#31363a; --accent:#7fc4a1; --accent-soft:#1e2f27;
      --warn:#d9bd6a; --warn-soft:#2e2819; --miss:#e0a08c; --miss-soft:#2e211d;
      --pend:#9fb0dd; --pend-soft:#212739; --tile:#282c30; --new:#f0a07a; --new-soft:#33211a;
    }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  .wrap{max-width:1140px;margin:0 auto;padding:40px 20px 72px}
  header{border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:28px}
  h1{font-size:2rem;margin:0 0 8px;letter-spacing:-.025em}
  .sub{color:var(--muted);margin:0}
  .criteria{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
  .chip{background:var(--card);border:1px solid var(--line);border-radius:999px;
    padding:5px 12px;font-size:.82rem;color:var(--muted)}
  h2{font-size:1.2rem;margin:0;letter-spacing:-.015em}
  section{margin-top:44px}
  .sectnote{color:var(--muted);font-size:.9rem;margin:8px 0 20px;max-width:75ch}
  .hl-head{display:flex;align-items:center;gap:10px}
  .count{background:var(--new);color:#fff;font-size:.78rem;font-weight:700;
    border-radius:999px;padding:2px 10px;letter-spacing:.02em}
  .highlight{border:1px solid var(--new);border-left:5px solid var(--new);border-radius:14px;
    padding:22px 22px 26px;background:var(--new-soft)}
  .highlight.quiet{border-color:var(--line);border-left-color:var(--line);background:var(--card)}
  .highlight.quiet .count{background:var(--muted)}

  .digest{display:flex;flex-direction:column;gap:8px}
  .drow{display:grid;gap:4px 16px;align-items:baseline;text-decoration:none;color:inherit;
    grid-template-columns:minmax(140px,auto) minmax(180px,1.2fr) minmax(200px,1fr) auto;
    background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 15px;
    border-left:4px solid var(--accent)}
  .drow.caution{border-left-color:var(--warn)}
  .drow.pending{border-left-color:var(--pend)}
  .drow:hover{border-color:var(--accent);background:var(--accent-soft)}
  .dprice{font-weight:700;font-size:1.05rem;letter-spacing:-.02em}
  .dmoved{font-weight:700;font-size:.75rem;color:var(--accent);margin-left:7px}
  .daddr{font-weight:600}
  .dcity{display:block;font-weight:400;font-size:.8rem;color:var(--muted)}
  .dfacts{font-size:.84rem;color:var(--muted)}
  .dtag{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
    padding:2px 7px;border-radius:4px}
  .dtag.warn{background:var(--warn-soft);color:var(--warn)}
  .dtag.pend{background:var(--pend-soft);color:var(--pend)}
  .dtag.new{background:var(--new);color:#fff}
  .dtag.drop{background:var(--accent-soft);color:var(--accent)}
  .dflags{display:flex;gap:5px;flex-wrap:wrap}
  @media (max-width:720px){
    .drow{grid-template-columns:1fr 1fr}
    .dflags{grid-column:1/-1}
  }
  .card{scroll-margin-top:16px}

  .summary{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-top:22px}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:11px;padding:14px 16px}
  .stat b{display:block;font-size:1.5rem;letter-spacing:-.02em;line-height:1.2}
  .stat span{font-size:.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}

  .grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(340px,1fr))}
  .card{background:var(--card);border:1px solid var(--line);border-radius:13px;
    overflow:hidden;display:flex;flex-direction:column}
  .card.match{border-top:4px solid var(--accent)}
  .card.caution{border-top:4px solid var(--warn)}
  .card.pending{border-top:4px solid var(--pend)}
  .body{padding:18px 20px 20px;display:flex;flex-direction:column;flex:1}

  .media{position:relative;background:var(--tile);border-bottom:1px solid var(--line)}
  .media .hero{width:100%;aspect-ratio:3/2;object-fit:cover;display:block}
  .media .tile{display:none}
  /* A failed or absent photo must still reserve the same box, or the absolutely
     positioned fallback tile collapses and overlaps the card body. */
  .media.nophoto,.media.failed{aspect-ratio:3/2}
  .media.nophoto .tile,.media.failed .tile{display:flex}
  .media.failed .hero,.media.failed .thumbs{display:none}
  .tile{position:absolute;inset:0;flex-direction:column;align-items:center;justify-content:center;
    gap:8px;text-decoration:none;color:var(--muted);background:
      repeating-linear-gradient(45deg,transparent,transparent 12px,rgba(128,128,128,.05) 12px,rgba(128,128,128,.05) 24px);}
  .tile:hover{color:var(--accent);background-color:var(--accent-soft)}
  .tile-ico{font-size:2rem;opacity:.55}
  .tile-txt{font-size:.85rem;font-weight:600}
  .thumbs{display:flex;gap:2px;background:var(--line)}
  .thumbs img{flex:1;min-width:0;aspect-ratio:4/3;object-fit:cover;display:block}

  .tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
  .tag{display:inline-block;font-size:.7rem;font-weight:700;letter-spacing:.06em;
    text-transform:uppercase;padding:3px 8px;border-radius:5px}
  .tag.ok{background:var(--accent-soft);color:var(--accent)}
  .tag.warn{background:var(--warn-soft);color:var(--warn)}
  .tag.pend{background:var(--pend-soft);color:var(--pend)}
  .tag.new{background:var(--new);color:#fff}
  .price{font-size:1.5rem;font-weight:650;letter-spacing:-.025em;margin:0}
  .pricechg{display:block;font-size:.8rem;font-weight:700;margin-top:3px}
  .pricechg.down{color:var(--accent)} .pricechg.up{color:var(--miss)}
  .addr{font-weight:600;margin:6px 0 2px;font-size:1.02rem}
  .city{color:var(--muted);font-size:.86rem;margin:0 0 14px}
  .facts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
  .fact{background:var(--bg);border:1px solid var(--line);border-radius:6px;
    padding:3px 9px;font-size:.79rem}
  .pool{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:700}
  .acres.pref{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:700}
  .note{font-size:.89rem;color:var(--muted);margin:0 0 14px;flex:1}
  .caveat{font-size:.85rem;background:var(--warn-soft);color:var(--ink);border-radius:8px;
    padding:10px 12px;margin:0 0 12px;line-height:1.5}
  .caveat strong{color:var(--warn)}
  .changed{font-size:.85rem;background:var(--pend-soft);color:var(--ink);border-radius:8px;
    padding:10px 12px;margin:0 0 12px;line-height:1.5}
  .changed strong{color:var(--pend)}
  .changed.reclassified{background:var(--warn-soft)}
  .changed.reclassified strong{color:var(--warn)}
  .pooldetail{font-size:.83rem;color:var(--muted);margin:0 0 12px}
  .pooldetail strong{color:var(--ink)}
  .verify{font-size:.79rem;color:var(--muted);margin:0 0 14px;display:flex;gap:7px;align-items:flex-start;
    line-height:1.45}
  .vdot{width:8px;height:8px;border-radius:50%;flex:none;margin-top:5px}
  .verify.ok .vdot{background:var(--accent)}
  .verify.one .vdot{background:var(--warn)}
  a.btn{display:inline-block;text-decoration:none;color:var(--accent);font-weight:600;
    font-size:.9rem;border:1px solid var(--line);border-radius:8px;padding:8px 13px;align-self:flex-start}
  a.btn:hover{background:var(--accent-soft)}

  .tablewrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
  table{width:100%;border-collapse:collapse;font-size:.87rem}
  th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);white-space:nowrap;
    vertical-align:top}
  td.wrapcell{white-space:normal;min-width:280px;color:var(--muted)}
  th{font-size:.73rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  tr:last-child td{border-bottom:none}
  td a{color:var(--accent)}
  .dim{color:var(--muted);font-size:.82rem}
  tr.off-market td:nth-child(2){color:var(--miss);font-weight:600}
  tr.fails-criteria td:nth-child(2){color:var(--warn);font-weight:600}
  .method{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;
    font-size:.88rem;color:var(--muted)}
  .method h3{margin:0 0 8px;font-size:.95rem;color:var(--ink)}
  .method p{margin:0 0 10px}
  .method p:last-child{margin:0}
  .method code{background:var(--bg);padding:1px 5px;border-radius:4px;font-size:.87em}
  footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);
    color:var(--muted);font-size:.84rem}
</style>
</head>
<body>
<div class="wrap">

<header>
  <h1>House Hunt: El Dorado County</h1>
  <p class="sub">Shingle Springs · Rescue · Placerville — run <strong>${esc(data.lastRun)}</strong>,
  previous run ${esc(data.previousRun)}</p>
  <div class="criteria">
    <span class="chip">4+ bedrooms</span>
    <span class="chip">3+ bathrooms</span>
    <span class="chip">Pool required</span>
    <span class="chip">2.5+ acres (5+ preferred)</span>
    <span class="chip">Max $1.5M</span>
  </div>
  <div class="summary">
    <div class="stat"><b>${listings.length}</b><span>On the board</span></div>
    <div class="stat"><b>${fresh.length}</b><span>Changed this run</span></div>
    <div class="stat"><b>${short(cheapest)}</b><span>Entry price</span></div>
    <div class="stat"><b>${biggest ? biggest + ' ac' : '—'}</b><span>Largest parcel</span></div>
    <div class="stat"><b>${data.sources.scanned}</b><span>Listings scanned</span></div>
  </div>
</header>

${newSection}

<section id="board">
  <h2>The board</h2>
  <p class="sectnote">Everything currently for sale in the three towns that clears 4bd / 3ba / pool /
  2.5+ acres / $1.5M. Cards are ordered largest parcel first, since acreage was the preference you
  weighted hardest.</p>

  ${matches.length ? `<h3 style="margin:26px 0 0;font-size:1rem">Clean matches — ${matches.length}</h3>
  <p class="sectnote">Active, and every hard criterion checks out against MLS field data.</p>
  <div class="grid">${matches.map((l) => card(l, { new: l.isNew })).join('\n')}
  </div>` : ''}

  ${caveats.length ? `<h3 style="margin:34px 0 0;font-size:1rem">Qualifies on paper — ${caveats.length}</h3>
  <p class="sectnote">These pass a numeric filter but something about how the numbers are counted
  matters. Read the caveat before you get attached.</p>
  <div class="grid">${caveats.map((l) => card(l, { new: l.isNew })).join('\n')}
  </div>` : ''}

  ${pendings.length ? `<h3 style="margin:34px 0 0;font-size:1rem">Sale pending — ${pendings.length}</h3>
  <p class="sectnote">Under contract, not yet closed. Kept on the board because pending sales do fall
  through, and both of these fit you well enough to be worth a backup offer.</p>
  <div class="grid">${pendings.map((l) => card(l, { new: l.isNew })).join('\n')}
  </div>` : ''}
</section>

${(data.removed || []).length ? `
<section id="changes">
  <h2>Dropped since last run</h2>
  <p class="sectnote">Every property carried over from ${esc(data.previousRun)} was re-checked against
  both live feeds. These no longer appear in either. They stay on file, so if one comes back on the
  market it gets flagged as news rather than re-reported as a new find.</p>
  <div class="tablewrap">
  <table>
    <thead><tr><th>Property</th><th>Status</th><th>Why it left the board</th></tr></thead>
    <tbody>${removedRows}
    </tbody>
  </table>
  </div>
</section>` : ''}

${nm.length ? `
<section id="near">
  <h2>Near misses</h2>
  <p class="sectnote">Currently for sale, 4bd/3ba, in your towns and budget — and failing exactly one
  hard criterion. This is the clearest read on the trade you're being asked to make:
  <strong>${nmAcres.length} homes on 5+ acres have no pool, while only ${nmPool.length} pool homes sit
  just under your acreage floor.</strong> Acreage is abundant here; the pool is what's scarce. If you
  ever soften a criterion, softening &ldquo;existing pool&rdquo; to &ldquo;room and permit for one&rdquo;
  opens far more inventory than shaving an acre off would.</p>

  <h3 style="margin:26px 0 0;font-size:1rem">Pool, but short on acreage — ${nmPool.length}</h3>
  <p class="sectnote">Closest to qualifying; all are within about an acre and a half of the floor.</p>
  <div class="tablewrap">
  <table>
    <thead><tr><th>Address</th><th>Price</th><th>Beds/Baths</th><th>Acres</th><th>Why it misses</th></tr></thead>
    <tbody>${nmRows(nmPool)}
    </tbody>
  </table>
  </div>

  <h3 style="margin:32px 0 0;font-size:1rem">Acreage, but no pool — ${nmAcres.length}</h3>
  <p class="sectnote">All on 5+ acres, several well under budget — the group to look at if adding a
  pool is on the table.</p>
  <div class="tablewrap">
  <table>
    <thead><tr><th>Address</th><th>Price</th><th>Beds/Baths</th><th>Acres</th><th>Why it misses</th></tr></thead>
    <tbody>${nmRows(nmAcres)}
    </tbody>
  </table>
  </div>
</section>` : ''}

<section id="ruledout">
  <h2>Ruled out, still tracked</h2>
  <p class="sectnote">Carried from previous runs. Watched only for a price change big enough to bring
  one back into range.</p>
  <div class="tablewrap">
  <table>
    <thead><tr><th>Address</th><th>Price</th><th>Why not</th></tr></thead>
    <tbody>${rejectedRows}
    </tbody>
  </table>
  </div>
</section>

<section id="method">
  <h2>How this run verified things</h2>
  <div class="method">
    <h3>Two independent MLS-fed sources, not search results</h3>
    <p>The earlier version of this page reported four properties that turned out to be off market,
    because listing status was inferred from search-engine text. That channel is no longer used.
    This run reads <strong>${data.sources.scanned} live listings</strong> straight from a MetroList
    IDX feed with per-listing structured MLS fields — status, bed and bath counts, lot acreage and
    pool construction details — and reads
    <strong>${data.sources.detailPagesRead} full detail pages</strong> for the shortlist.</p>
    <p>Each board listing is then cross-checked against a second, independently operated feed.
    <strong>${dualCount} of ${listings.length}</strong> matched exactly on price, beds, baths and
    acreage. The remainder aren't indexed by the second source; their cards say so, and those are the
    ones to confirm by phone first.</p>
    <p><strong>Negative control:</strong> ${esc(data.sources.negativeControl)}</p>
    <p>Pool status comes from the MLS <code>Pool</code> and <code>Pool Description</code> fields, not
    from listing prose — so &ldquo;room for a pool&rdquo; can't be misread as a pool. Acreage comes
    from the MLS lot-size field rather than the marketing copy.</p>
  </div>
</section>

<footer>
  <p>Generated from <code>listings.json</code> by <code>build.js</code>.
  ${listings.length} on the board (${matches.length} clean, ${caveats.length} with caveats,
  ${pendings.length} pending) · ${nm.length} near misses · ${(data.removed || []).length} dropped this run.
  Repeat listings are suppressed automatically; a property only reappears here if its price moves.</p>
  <p>${esc(data.criteriaNote)}</p>
</footer>

</div>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`Built index.html — ${listings.length} on board (${matches.length} clean, ${caveats.length} caveat, ` +
            `${pendings.length} pending), ${fresh.length} new, ${nm.length} near misses, ${dualCount} dual-sourced.`);
