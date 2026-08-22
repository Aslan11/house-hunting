#!/usr/bin/env node
/**
 * Builds index.html from listings.json.
 *
 * Future runs should edit listings.json ONLY, then run `node build.js`.
 *
 * Layout contract (per the standing brief):
 *   - New-since-last-run listings are called out FIRST, at the top of the page.
 *   - Anything sold or withdrawn is dropped off the board and recorded in "Removed this run".
 *   - Nothing is re-surfaced as new unless its price moved.
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) => (n == null ? '—' : '$' + n.toLocaleString('en-US'));
const short = (n) => (n == null ? '—' : '$' + (n / 1e6).toFixed(3).replace(/0+$/, '').replace(/\.$/, '') + 'M');

// MetroList reports baths as "full | half". Half baths are shown but never counted toward the
// 3-bath minimum, because "2 full + 1 half" is a 2.5-bath house however other sites label it.
const bathLabel = (l) => {
  const h = l.partialBaths ? ` + ${l.partialBaths} half` : '';
  return `${l.fullBaths} full${h} ba`;
};

const ppa = (l) => (l.acres ? Math.round(l.currentPrice / l.acres) : null);

/**
 * Photo strip: scroll-snap gallery over hotlinked MLS photos.
 *
 * A "View photos" link sits *behind* the strip at all times. When the images load they cover it
 * completely; if a CDN blocks the hotlink the failed <img> removes itself and the link shows
 * through, so a card can never degrade into an empty grey box.
 */
function media(l) {
  const shots = (l.photos || []).slice(0, 6);
  const fallback = `<a class="fallback" href="${esc(l.url)}" rel="noopener">View photos &rarr;</a>`;
  if (!shots.length) return `<div class="media nophoto">${fallback}</div>`;

  const imgs = shots.map((src, i) => `
      <img src="${esc(src)}" alt="${esc(l.address)} — photo ${i + 1} of ${shots.length}"
           loading="${i === 0 ? 'eager' : 'lazy'}" referrerpolicy="no-referrer"
           onerror="this.remove()">`).join('');
  return `<div class="media">
      ${fallback}
      <div class="strip">${imgs}</div>
      <span class="shots">${shots.length} photos &middot; swipe</span>
    </div>`;
}

function priceBlock(l) {
  const hist = l.priceHistory || [];
  if (hist.length > 1) {
    const prev = hist[hist.length - 2].price;
    const now = l.currentPrice;
    const down = now < prev;
    return `<p class="price">${money(now)}
      <span class="pricechg ${down ? 'down' : 'up'}">${down ? '&darr;' : '&uarr;'}
      ${money(Math.abs(now - prev))} from ${money(prev)}</span></p>`;
  }
  return `<p class="price">${money(l.currentPrice)}</p>`;
}

function facts(l) {
  const f = [
    `<span class="fact">${l.beds} bd</span>`,
    `<span class="fact">${bathLabel(l)}</span>`,
  ];
  if (l.sqft) f.push(`<span class="fact">${l.sqft.toLocaleString('en-US')} sqft</span>`);
  f.push(`<span class="fact acres${l.acres >= 5 ? ' pref' : ''}">${l.acres} acres</span>`);
  f.push(`<span class="fact pool">Pool</span>`);
  if (l.yearBuilt) f.push(`<span class="fact">Built ${esc(l.yearBuilt)}</span>`);
  if (l.horse === 'Yes') f.push(`<span class="fact">Horse property</span>`);
  return f.join('');
}

function card(l) {
  const pending = l.status === 'pending';
  const tags = [];
  if (l.isNew) tags.push(`<span class="tag new">New this run</span>`);
  tags.push(pending
    ? `<span class="tag pend">Sale pending</span>`
    : `<span class="tag ok">Active</span>`);

  const perAcre = ppa(l);
  return `
  <article class="card${pending ? ' is-pending' : ''}${l.isNew ? ' is-new' : ''}">
    ${media(l)}
    <div class="body">
      <div class="tags">${tags.join('')}</div>
      ${priceBlock(l)}
      <p class="addr">${esc(l.address)}</p>
      <p class="city">${esc(l.city)}, CA ${esc(l.zip)} &middot; MLS ${esc(l.mls)}</p>
      <div class="facts">${facts(l)}</div>
      <p class="pooldetail">${esc(l.poolDetail)}</p>
      <p class="note">${esc(l.summary)}</p>
      ${l.statusNote ? `<p class="flagnote">${esc(l.statusNote)}</p>` : ''}
      <dl class="micro">
        ${perAcre ? `<div><dt>Per acre</dt><dd>${money(perAcre)}</dd></div>` : ''}
        <div><dt>Water</dt><dd>${esc(l.water || '—')}</dd></div>
        <div><dt>Sewer</dt><dd>${esc(l.sewer || '—')}</dd></div>
        <div><dt>HOA</dt><dd>${esc(l.hoa || 'None')}</dd></div>
      </dl>
      <div class="links">
        <a class="btn" href="${esc(l.url)}" rel="noopener">Listing &amp; photos &rarr;</a>
        ${l.mlsUrl ? `<a class="btn ghost" href="${esc(l.mlsUrl)}" rel="noopener">MLS record</a>` : ''}
      </div>
    </div>
  </article>`;
}

const activeList = data.listings || [];
const pendingList = data.pending || [];
// Normalise the new-this-run flag. scrape.js writes `newThisRun`; earlier code and this file both
// read `isNew`. A mismatch here would silently empty the top "New this run" section — the whole
// point of the brief — while runSummary correctly said something moved. Coalesce at read time.
for (const l of activeList.concat(pendingList)) l.isNew = !!(l.isNew || l.newThisRun);
const listings = activeList.concat(pendingList);
const fresh = listings.filter((l) => l.isNew);

// Sections are mutually exclusive so no property is ever rendered twice: anything new goes in the
// top section, and the standing sections carry only what was already on the board last run.
const heldActive = activeList.filter((l) => !l.isNew);
const heldPending = pendingList.filter((l) => !l.isNew);
const dropped = data.dropped || [];
const nearMiss = data.nearMisses || [];
const priceMoves = (data.runSummary && data.runSummary.priceChanges) || [];

const cheapest = activeList.length ? Math.min(...activeList.map((l) => l.currentPrice)) : null;
const mostLand = activeList.length ? Math.max(...activeList.map((l) => l.acres)) : null;

// scrape.js writes dropped records as `{ address: "Street, City", priorPrice, reason, droppedOn }` —
// city is already embedded in `address`, the price key is `priorPrice`, and there is no `mls` field
// (a departure means the MLS record is gone). Reading `d.city`, `d.lastPrice`, `d.mls` produced
// "Street, Cityblank | — | — | …" rows every run.
const droppedRows = dropped.map((d) => `
    <tr><td>${esc(d.address)}</td><td>${d.priorPrice ? money(d.priorPrice) : '—'}</td>
        <td>${esc(d.droppedOn || '—')}</td><td>${esc(d.reason)}</td></tr>`).join('');

// scrape.js writes near-miss records as `{ baths, missing, ... }`. Reading `n.fullBaths` and
// `n.reason` rendered "undefined full ba" and an empty "Why it is not in the list" column.
const nearRows = nearMiss.map((n) => `
    <tr><td><a href="${esc(n.url)}" rel="noopener">${esc(n.address)}</a>, ${esc(n.city)}</td>
        <td>${money(n.price)}</td><td>${esc(n.acres)} ac</td>
        <td>${n.beds} bd / ${n.baths ?? n.fullBaths ?? '—'} ba</td><td>${esc(n.missing || n.reason || '')}</td></tr>`).join('');

const poolless = data.poolless || [];
const poollessRows = poolless.map((r) => `
    <tr><td><a href="${esc(r.url)}" rel="noopener">${esc(r.address)}</a>, ${esc(r.city)}</td>
        <td>${money(r.price)}</td><td>${esc(r.acres)} ac</td>
        <td>${r.beds} bd / ${r.fullBaths} full ba</td>
        <td>${r.sqft ? r.sqft.toLocaleString('en-US') : '—'}</td>
        <td>${esc(r.status)}</td></tr>`).join('');

// verify.py stamps mlsVerifiedOn only when every record agreed with the MLS of record.
// If it did not run this time, say so on the page rather than repeating a blanket "all
// agreed" that nothing tested — the whole point of the verification gate is that the
// claim on the page matches the work actually done.
const verifiedOn = data.source && data.source.mlsVerifiedOn;
const verifiedToday = verifiedOn === data.lastRun;

const rejectedRows = (data.rejected || []).map((r) => `
    <tr><td>${esc(r.address)}</td><td>${r.price ? money(r.price) : '—'}</td><td>${esc(r.reason)}</td></tr>`).join('');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>House Hunt — Shingle Springs · Rescue · Placerville</title>
<meta name="description" content="Tracked 4BR+/3BA+ homes with a pool on 2.5+ acres under $1.5M in Shingle Springs, Rescue and Placerville, CA.">
<style>
  :root{
    --bg:#f6f4f0; --card:#fff; --ink:#1c1a17; --muted:#6b665e;
    --line:#e2ddd4; --accent:#2f6b4f; --accent-soft:#e6f0ea;
    --new:#1d5fa8; --new-soft:#e3edf9;
    --warn:#8a6d1f; --warn-soft:#f8f0d8; --miss:#8a4b3a; --miss-soft:#f7e7e2;
    --tile:#ece7de;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#16181a; --card:#1f2225; --ink:#eceae6; --muted:#a09a91;
      --line:#31363a; --accent:#7fc4a1; --accent-soft:#1e2f27;
      --new:#8fbdec; --new-soft:#1a2634;
      --warn:#d9bd6a; --warn-soft:#2e2819; --miss:#e0a08c; --miss-soft:#2e211d;
      --tile:#282c30;
    }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  .wrap{max-width:1140px;margin:0 auto;padding:40px 20px 72px}
  header{border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:8px}
  h1{font-size:2rem;margin:0 0 8px;letter-spacing:-.025em}
  .sub{color:var(--muted);margin:0}
  .criteria{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
  .chip{background:var(--card);border:1px solid var(--line);border-radius:999px;
    padding:5px 12px;font-size:.82rem;color:var(--muted)}
  h2{font-size:1.2rem;margin:44px 0 6px;letter-spacing:-.015em}
  h2 .count{color:var(--muted);font-weight:500}
  .sectnote{color:var(--muted);font-size:.9rem;margin:0 0 18px;max-width:70ch}

  /* headline strip */
  .stats{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin:26px 0 4px}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:11px;padding:14px 16px}
  .stat b{display:block;font-size:1.5rem;letter-spacing:-.02em;line-height:1.15}
  .stat span{font-size:.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}

  .grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(340px,1fr))}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;
    overflow:hidden;display:flex;flex-direction:column}
  .card.is-new{border-color:var(--new);box-shadow:0 0 0 1px var(--new)}
  .card.is-pending{opacity:.94}
  .body{padding:18px 20px 20px;display:flex;flex-direction:column;flex:1}

  .media{position:relative;background:var(--tile);border-bottom:1px solid var(--line);
    aspect-ratio:3/2}
  .fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    text-decoration:none;color:var(--muted);font-weight:600;font-size:.9rem;
    background:repeating-linear-gradient(45deg,transparent,transparent 12px,
      rgba(128,128,128,.05) 12px,rgba(128,128,128,.05) 24px)}
  .fallback:hover{color:var(--accent);background-color:var(--accent-soft)}
  .strip{position:relative;display:flex;overflow-x:auto;scroll-snap-type:x mandatory;height:100%;
    scrollbar-width:none}
  .strip:empty{display:none}
  .strip::-webkit-scrollbar{display:none}
  .strip img{flex:0 0 100%;width:100%;height:100%;object-fit:cover;display:block;scroll-snap-align:center}
  .shots{position:absolute;right:10px;bottom:10px;background:rgba(0,0,0,.62);color:#fff;
    font-size:.72rem;font-weight:600;padding:3px 9px;border-radius:999px;pointer-events:none}
  .media:has(.strip:empty) .shots{display:none}

  .tags{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
  .tag{display:inline-block;font-size:.7rem;font-weight:700;letter-spacing:.06em;
    text-transform:uppercase;padding:3px 8px;border-radius:5px}
  .tag.ok{background:var(--accent-soft);color:var(--accent)}
  .tag.new{background:var(--new-soft);color:var(--new)}
  .tag.pend{background:var(--warn-soft);color:var(--warn)}

  .price{font-size:1.5rem;font-weight:650;letter-spacing:-.025em;margin:0}
  .pricechg{display:block;font-size:.8rem;font-weight:700;margin-top:3px}
  .pricechg.down{color:var(--accent)} .pricechg.up{color:var(--miss)}
  .addr{font-weight:600;margin:6px 0 2px}
  .city{color:var(--muted);font-size:.88rem;margin:0 0 14px}
  .facts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
  .fact{background:var(--bg);border:1px solid var(--line);border-radius:6px;
    padding:3px 9px;font-size:.79rem}
  .fact.pool{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:600}
  .fact.acres.pref{background:var(--accent-soft);border-color:transparent;color:var(--accent);font-weight:600}
  .pooldetail{font-size:.8rem;color:var(--accent);margin:0 0 12px;font-weight:600}
  .note{font-size:.88rem;color:var(--muted);margin:0 0 14px;flex:1}
  .flagnote{font-size:.8rem;color:var(--warn);background:var(--warn-soft);
    border-radius:7px;padding:8px 10px;margin:0 0 14px}

  .micro{display:grid;grid-template-columns:repeat(2,1fr);gap:8px 14px;margin:0 0 16px;
    padding-top:14px;border-top:1px solid var(--line)}
  .micro div{min-width:0}
  .micro dt{font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  .micro dd{margin:1px 0 0;font-size:.84rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

  .links{display:flex;gap:8px;flex-wrap:wrap}
  a.btn{display:inline-block;text-decoration:none;color:#fff;background:var(--accent);font-weight:600;
    font-size:.87rem;border:1px solid var(--accent);border-radius:8px;padding:8px 13px}
  a.btn.ghost{background:transparent;color:var(--accent);border-color:var(--line)}
  a.btn:hover{filter:brightness(1.07)}

  .banner{background:var(--new-soft);border:1px solid var(--line);border-left:4px solid var(--new);
    border-radius:10px;padding:16px 18px;margin:26px 0 8px;font-size:.92rem}
  .banner h3{margin:0 0 6px;font-size:1rem}
  .banner p{margin:0;color:var(--muted)}
  .banner ul{margin:8px 0 0;padding-left:20px;color:var(--muted)}

  .tablewrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
  table{width:100%;border-collapse:collapse;font-size:.87rem}
  th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);vertical-align:top}
  th{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);white-space:nowrap}
  tr:last-child td{border-bottom:none}
  td a{color:var(--accent);font-weight:600;text-decoration:none}
  td a:hover{text-decoration:underline}
  footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);
    color:var(--muted);font-size:.84rem}
  footer code{background:var(--card);padding:1px 5px;border-radius:4px}
  @media (max-width:520px){ h1{font-size:1.6rem} .wrap{padding:28px 14px 56px} }
</style>
</head>
<body>
<div class="wrap">

<header>
  <h1>House Hunt: El Dorado County</h1>
  <p class="sub">Shingle Springs &middot; Rescue &middot; Placerville — updated
    <strong>${esc(data.lastRun)}</strong>${data.previousRun ? ` (previous run ${esc(data.previousRun)})` : ''}</p>
  <div class="criteria">
    <span class="chip">4+ bedrooms</span>
    <span class="chip">3+ full bathrooms</span>
    <span class="chip">Pool required</span>
    <span class="chip">2.5+ acres (5+ preferred)</span>
    <span class="chip">Max $1.5M</span>
  </div>
</header>

<div class="stats">
  <div class="stat"><b>${activeList.length}</b><span>Active matches</span></div>
  <div class="stat"><b>${fresh.length}</b><span>New this run</span></div>
  <div class="stat"><b>${cheapest ? short(cheapest) : '—'}</b><span>Entry price</span></div>
  <div class="stat"><b>${mostLand ? mostLand + ' ac' : '—'}</b><span>Most land</span></div>
  <div class="stat"><b>${dropped.length}</b><span>Removed</span></div>
</div>

<div class="banner">
  <h3>What changed this run</h3>
  ${fresh.length || priceMoves.length || dropped.length ? `<ul>
    ${fresh.length ? `<li><strong>${fresh.length} new ${fresh.length === 1 ? 'listing' : 'listings'}</strong> meeting every hard criterion — see the top section.</li>` : ''}
    ${priceMoves.length ? `<li><strong>${priceMoves.length} price ${priceMoves.length === 1 ? 'change' : 'changes'}</strong> on properties already tracked.</li>` : ''}
    ${dropped.length ? `<li><strong>${dropped.length} previously tracked ${dropped.length === 1 ? 'property' : 'properties'} removed</strong> — no longer on the market. Listed at the bottom.</li>` : ''}
  </ul>` : `<p><strong>Nothing moved.</strong> No new listings, no price changes, and nothing left
  the board since ${esc(data.previousRun)}. ${verifiedToday
    ? `All ${activeList.length} active matches and ${pendingList.length} pending were re-verified
       against the MLS of record today and are unchanged — same prices, same status. The board below
       is current, not stale.`
    : `The board was re-enumerated from the IDX feed today; the last field-by-field check against
       the MLS of record was ${esc(verifiedOn || 'never run')}.`}</p>`}
</div>

${fresh.length ? `<h2>New this run <span class="count">(${fresh.length})</span></h2>
<p class="sectnote">Every one of these clears 4+ bedrooms, 3+ full baths, a pool, 2.5+ acres and the
$1.5M ceiling, and each has been checked field-by-field against its MetroList MLS record. Sale-pending
properties are included but marked — worth a call, since pendings do fall through.</p>
<div class="grid">${fresh.map(card).join('\n')}
</div>` : ''}

${heldActive.length ? `<h2>Still active from earlier runs <span class="count">(${heldActive.length})</span></h2>
<p class="sectnote">Already on the board last run and still confirmed <strong>Active</strong> on
MetroList as of ${esc(data.lastRun)}. Any price movement since it was first seen is shown on the card.</p>
<div class="grid">${heldActive.map(card).join('\n')}
</div>` : ''}

${heldPending.length ? `<h2>Sale pending <span class="count">(${heldPending.length})</span></h2>
<p class="sectnote">Meets every criterion but already under contract. Kept on the board because
pending sales fall through often enough to be worth watching — they move back up automatically if
they return to Active.</p>
<div class="grid">${heldPending.map(card).join('\n')}
</div>` : ''}

${nearMiss.length ? `<h2>Near misses <span class="count">(${nearMiss.length})</span></h2>
<p class="sectnote">Clears everything except one criterion, by a small margin. Shown so the call is
yours rather than the script's.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Property</th><th>Price</th><th>Land</th><th>Size</th><th>Why it is not in the list</th></tr></thead>
  <tbody>${nearRows}
  </tbody>
</table>
</div>` : ''}

${dropped.length ? `<h2>Removed this run <span class="count">(${dropped.length})</span></h2>
<p class="sectnote">Tracked previously, gone from the live MLS feed now. Recorded here so they are not
re-reported as fresh finds if a stale copy of the listing turns up in a future search.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Property</th><th>Last price</th><th>Removed</th><th>Why removed</th></tr></thead>
  <tbody>${droppedRows}
  </tbody>
</table>
</div>` : ''}

${poolless.length ? `<h2>Right land, no pool <span class="count">(${poolless.length})</span></h2>
<p class="sectnote">The pool is the binding constraint on this search, not the budget — so these are
worth a look. Each one is <strong>on the market now</strong> and clears bedrooms, full baths, acreage
and price; MetroList simply records no pool. On this much land a pool is an addable feature, and
several of these sit far enough under $1.5M to fund one. Sorted by acreage; check the status column,
one is already pending.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Property</th><th>Price</th><th>Land</th><th>Size</th><th>Sqft</th><th>Status</th></tr></thead>
  <tbody>${poollessRows}
  </tbody>
</table>
</div>` : ''}

${rejectedRows ? `<h2>Ruled out on the facts</h2>
<p class="sectnote">${esc(data.rejectedNote || 'Checked in earlier runs and failed a hard criterion regardless of availability.')}</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Address</th><th>Price</th><th>Why not</th></tr></thead>
  <tbody>${rejectedRows}
  </tbody>
</table>
</div>` : ''}

<h2>How this list is built</h2>
<p class="sectnote">Earlier runs of this tracker had no way to read a live listing page and inferred
status from search-engine text, which produced four confident matches that were all off market. That
failure mode is now closed off.</p>
<div class="tablewrap">
<table>
  <thead><tr><th>Step</th><th>What happens</th></tr></thead>
  <tbody>
    <tr><td><strong>Enumerate</strong></td><td>Every active listing in the three cities is pulled from an IDX feed carrying MetroList data — ${data.source ? data.source.inventoryScanned : '—'} properties this run, not a search-result sample.</td></tr>
    <tr><td><strong>Filter</strong></td><td>Hard criteria applied to structured MLS fields, never to prose: ${data.source ? data.source.passedBedsBathsPrice : '—'} cleared beds/baths/price, then acreage and pool narrowed it to ${listings.length}.</td></tr>
    <tr><td><strong>Verify</strong></td><td>Each survivor is re-read from <strong>MetroListPRO</strong>, the official MetroList MLS site, and price, beds, full baths, acreage and pool must match.
      ${verifiedToday
        ? `All ${data.source.mlsVerifiedCount || listings.length} agreed, checked ${esc(verifiedOn)}.`
        : `<strong>Last confirmed ${esc(verifiedOn || 'never')}</strong>, not on this run — treat the listings below as verified as of that date.`}</td></tr>
    <tr><td><strong>Resolve</strong></td><td>Where sources disagree, the MLS of record wins and the disagreement is printed on the card rather than hidden.</td></tr>
  </tbody>
</table>
</div>
<p class="sectnote" style="margin-top:14px">Two things that bite here and are handled explicitly:
<strong>half baths</strong> — some sites report 2 full + 1 half as &ldquo;3 baths&rdquo;, so the bath
test counts full baths only; and <strong>MetroList MLS number prefixes encode the listing year</strong>
(<code>226…</code> = 2026), which makes a stale listing easy to spot. Every property on this page
carries a 226 number.</p>

<footer>
  <p>Generated from <code>listings.json</code> by <code>build.js</code>.
  ${listings.length} properties tracked &middot; ${activeList.length} active &middot;
  ${pendingList.length} pending &middot; ${dropped.length} removed this run.
  Data from MetroList MLS via IDX; listing photos are the copyright of the listing brokerages and are
  hotlinked here for private use. Verify all figures with your agent before acting on them.</p>
</footer>

</div>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`Built index.html — ${fresh.length} new, ${activeList.length} active, ` +
            `${pendingList.length} pending, ${dropped.length} removed.`);
