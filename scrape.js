#!/usr/bin/env node
/**
 * Refreshes listings.json from the live MetroList MLS IDX feed, then run `node build.js`.
 *
 *   node scrape.js            # full run
 *   node scrape.js --dry      # scrape and report, write nothing
 *
 * Pipeline: enumerate every active listing in the three target cities from the
 * brokerage's JSON-LD search pages -> keep the ones clearing beds/baths/price ->
 * pull each survivor's detail page for lot size, pool fields and true MLS status.
 *
 * Two traps this deliberately avoids, both of which have burned earlier runs:
 *
 *  1. Search-engine snippets are not evidence of listing status. They index sold
 *     listings with "For Sale" in the title for years. Only a live listing page counts.
 *  2. The feed's own `IsActive` flag stays TRUE on Sale Pending listings. Status must
 *     be read from the listing's `Status:` field, which is what `realStatus` holds.
 *
 * Cross-run bookkeeping (dedupe, price history, drops) is handled by merge() below,
 * so re-running on a schedule is safe and never re-surfaces a property as new.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { statusIndex, normAddr } = require('./mls-status.js');

const BASE = 'https://www.coldwellbankerhomes.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const CITY_SLUGS = { placerville: 'Placerville', 'shingle-springs': 'Shingle Springs', rescue: 'Rescue' };
const FILE = path.join(__dirname, 'listings.json');
const DRY = process.argv.includes('--dry');
const TODAY = new Date().toISOString().slice(0, 10);

const prior = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const C = prior.criteria;
const MIN_BEDS = parseInt(C.beds, 10);
const MIN_BATHS = parseInt(C.baths, 10);

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** curl rather than fetch: it already trusts the environment's proxy CA bundle. */
function get(url, tries = 3, min = 5000) {
  for (let i = 0; i < tries; i++) {
    try {
      const out = execFileSync('curl', ['-sS', '-m', '45', '-A', UA,
        '-H', 'Accept-Language: en-US,en;q=0.9', url],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      if (out && out.length > min) return out;
    } catch { /* retry */ }
    sleep(2000 + 3000 * i);
  }
  return '';
}

function ldJson(html) {
  const out = [];
  const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    try { out.push(JSON.parse(m[1].trim())); } catch { /* ignore malformed */ }
  }
  return out;
}

/* ---------- stage 1: enumerate ---------- */

function searchPageRows(html) {
  const rows = [];
  for (const d of ldJson(html)) {
    for (const node of d['@graph'] || []) {
      if (node['@type'] !== 'CollectionPage') continue;
      for (const it of (node.mainEntity || {}).itemListElement || []) {
        const me = it.mainEntity || {}, addr = me.address || {}, fs_ = me.floorSize || {};
        rows.push({
          cbid: it['@id'], url: it.url, name: it.name,
          price: (it.offers || {}).price,
          beds: me.numberOfBedrooms, baths: me.numberOfBathroomsTotal,
          sqft: fs_.value, street: addr.streetAddress, city: addr.addressLocality,
          zip: addr.postalCode, lat: (me.geo || {}).latitude, lng: (me.geo || {}).longitude,
        });
      }
    }
  }
  return rows;
}

function enumerateCity(slug) {
  const seen = new Set(), rows = [];
  for (let page = 1; page <= 40; page++) {
    const html = get(page === 1 ? `${BASE}/ca/${slug}/` : `${BASE}/ca/${slug}/p_${page}/`);
    if (!html) break;
    const got = searchPageRows(html);
    const fresh = got.filter((r) => !seen.has(r.cbid));
    got.forEach((r) => seen.add(r.cbid));
    rows.push(...fresh);
    process.stderr.write(`  [${slug}] p${page}: +${fresh.length} (${rows.length} total)\n`);
    if (!fresh.length || !html.includes('rel="next"')) break;
    sleep(1200);
  }
  return rows;
}

/* ---------- stage 2: detail ---------- */

const POOL_NEG = /\b(no pool|without a pool|pool table|carpool|room for a pool|space for a (?:future )?pool|add a pool|pool[- ]?sized|potential for a pool)\b/i;
const POOL_POS = /\b(swimming pool|pool\/spa|pool and spa|in-?ground pool|gunite|pebble ?tec|saltwater pool|sport pool|lap pool|infinity pool|resort-?style pool)\b/i;

function detail(url) {
  const html = get(url, 3, 20000);
  if (!html) return null;
  const out = { amenities: {}, images: [], description: '' };
  for (const d of ldJson(html)) {
    for (const node of d['@graph'] || []) {
      if (!(Array.isArray(node['@type']) && node['@type'].includes('RealEstateListing'))) continue;
      out.description = node.description || '';
      out.datePosted = node.datePosted;
      out.images = Array.isArray(node.image) ? node.image : (node.image ? [node.image] : []);
      out.price = (node.offers || {}).price;
      for (const a of (node.mainEntity || {}).amenityFeature || []) {
        if (a.name != null) out.amenities[a.name] = a.value;
      }
    }
  }
  // The visible Status field — NOT IsActive, which stays true while Sale Pending.
  const st = html.match(/<li><strong>Status:\s*<\/strong>\s*([^<]+)<\/li>/);
  out.realStatus = st ? st[1].trim() : null;
  const ty = html.match(/<li><strong>Type:\s*<\/strong>\s*([^<]+)<\/li>/);
  out.propertyType = ty ? ty[1].trim() : null;
  const bd = html.match(/property-status-indicator-text">([^<]+)</);
  out.badge = bd ? bd[1].replace(/&nbsp;/g, ' ').trim() : null;
  const mls = html.match(/&quot;MLSNumber&quot;:&quot;([^&]+)&quot;/) || html.match(/"MLSNumber"\s*:\s*"([^"]+)"/);
  out.mls = mls ? mls[1] : null;

  // Bath precision. The search feed reports numberOfBathroomsTotal, which rounds
  // "2 full + 1 half" up to 3. MetroList and every portal call that 2.5, and a
  // 2.5-bath home does not clear a 3-bath minimum. The detail page carries the
  // full/partial split, so compute the real figure from it.
  const fb = html.match(/"numberOfFullBathrooms"\s*:\s*(\d+)/);
  const pb = html.match(/"numberOfPartialBathrooms"\s*:\s*(\d+)/);
  out.fullBaths = fb ? +fb[1] : null;
  out.partialBaths = pb ? +pb[1] : null;
  out.baths = out.fullBaths != null
    ? out.fullBaths + 0.5 * (out.partialBaths || 0)
    : null;

  const am = out.amenities;
  out.acres = (() => {
    for (const k of ['Lot Size (Acres)', 'Lot Size Acres', 'Acres']) {
      const v = parseFloat(String(am[k] ?? '').replace(/,/g, ''));
      if (!isNaN(v) && v > 0) return v;
    }
    for (const k of ['Lot Size (Sq. Ft.)', 'Lot Size']) {
      const v = parseFloat(String(am[k] ?? '').replace(/[^\d.]/g, ''));
      if (!isNaN(v) && v > 1000) return Math.round(v / 435.6) / 100;
    }
    const m = out.description.match(/([\d.]+)\s*(?:\+\/-\s*)?acres?/i);
    return m ? parseFloat(m[1]) : null;
  })();

  out.pool = (() => {
    for (const [k, v] of Object.entries(am)) {
      const kl = k.toLowerCase();
      if (!kl.includes('pool') || kl.includes('carpool')) continue;
      const vs = String(v ?? '').trim(), vl = vs.toLowerCase();
      if (['yes', 'true', 'y'].includes(vl)) return true;
      if (['no', 'false', 'n', 'none', ''].includes(vl)) return false;
      return true; // a populated "Pool Description" implies one
    }
    const d = out.description;
    if (POOL_NEG.test(d)) return false;
    if (POOL_POS.test(d)) return true;
    return false;
  })();
  return out;
}

/* ---------- stage 3: merge across runs ---------- */

/**
 * Street-type abbreviations, so a listing keeps the same id when the feed
 * switches between "Road" and "Rd". The 2026-07-30 run stored full words and
 * this feed now returns abbreviations; without this every tracked property
 * would look new and every prior one would look dropped.
 */
const SUFFIX = {
  road: 'rd', drive: 'dr', court: 'ct', trail: 'trl', lane: 'ln', street: 'st',
  avenue: 'ave', circle: 'cir', place: 'pl', boulevard: 'blvd', terrace: 'ter',
  parkway: 'pkwy', highway: 'hwy', way: 'way', loop: 'loop', creek: 'crk',
  ranch: 'ranch', north: 'n', south: 's', east: 'e', west: 'w',
};

function slug(name) {
  return name.replace(/,\s*CA\s*\d{5}$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .map((w) => SUFFIX[w] || w)
    .join('-');
}

/* Pending listings were rebuilt from scratch every run, which stamped `priceHistory`
   with today's date and today's price each time. A price cut on a property in escrow
   was therefore invisible — and so was the date it went under contract, which is the
   one fact that makes "nothing moved" runs interpretable. Carry both forward. */
function carryPending(rec) {
  const was = (prior.pending || []).find((p) => {
    const canon = p.address && p.city ? slug(`${p.address}, ${p.city}`) : p.id;
    return canon === rec.id;
  });
  const hist = was && was.priceHistory ? was.priceHistory.slice() : [];
  const last = hist.length ? hist[hist.length - 1].price : null;
  if (last !== rec.currentPrice) hist.push({ date: TODAY, price: rec.currentPrice });
  return {
    firstSeen: (was && was.firstSeen) || TODAY,
    pendingSince: (was && was.pendingSince) || TODAY,
    priceHistory: hist,
  };
}

function merge(found, stillListed = new Map(), activeIdx = new Map()) {
  // Re-slug prior ids through the current normaliser so an id-scheme change
  // doesn't read as "everything is new, everything old was dropped".
  const priorById = new Map((prior.listings || []).map((l) => {
    const canon = l.address && l.city ? slug(`${l.address}, ${l.city}`) : l.id;
    return [canon, { ...l, id: canon }];
  }));
  const listings = [];

  for (const f of found) {
    const was = priorById.get(f.id);
    if (!was) {
      listings.push({ ...f, firstSeen: TODAY, lastSeen: TODAY, newThisRun: true,
        priceHistory: [{ date: TODAY, price: f.currentPrice }] });
      continue;
    }
    // Known property: keep its history, append only on an actual price change.
    const hist = was.priceHistory ? was.priceHistory.slice() : [];
    const last = hist.length ? hist[hist.length - 1].price : null;
    if (last !== f.currentPrice) hist.push({ date: TODAY, price: f.currentPrice });
    listings.push({ ...f, firstSeen: was.firstSeen || TODAY, lastSeen: TODAY,
      newThisRun: false, priceHistory: hist,
      notes: f.notes || was.notes || '' });
  }

  // Anything tracked last run and absent from live active inventory has gone away.
  const liveIds = new Set(found.map((f) => f.id));
  const dropped = [], relisted = [];
  for (const l of priorById.values()) {
    if (liveIds.has(l.id)) continue;
    // A property can leave the match list two different ways, and saying "sold"
    // about one that is still on the market would be plainly wrong.
    const why = stillListed.get(l.id);
    if (why) {
      dropped.push({
        address: `${l.address}, ${l.city}`,
        priorPrice: l.currentPrice,
        reason: `Still listed, but no longer meets the criteria: ${why}.`,
        droppedOn: TODAY,
      });
      continue;
    }

    /* Absent from the IDX sweep entirely. Before calling that sold-or-withdrawn,
       ask the second feed — see trap 9. A property relisted under a new MLS number
       disappears from the IDX feed for a day or two while the republish catches up,
       and reads exactly like a sale. Redfin positively asserting it is still Active
       is enough to stop the drop; it is NOT enough to keep it in the match list,
       because a relist can change the facts the match was verified on. */
    const live = activeIdx.get(normAddr(l.address, l.city));
    if (!live) {
      dropped.push({
        address: `${l.address}, ${l.city}`,
        priorPrice: l.currentPrice,
        reason: 'No longer an active listing in the MLS feed — sold, expired, or withdrawn.',
        droppedOn: TODAY,
      });
      continue;
    }
    const newPrice = /^\d+$/.test(String(live.price)) ? +live.price : null;
    const hist = l.priceHistory ? l.priceHistory.slice() : [];
    if (newPrice != null && (!hist.length || hist[hist.length - 1].price !== newPrice)) {
      hist.push({ date: TODAY, price: newPrice });
    }
    relisted.push({
      id: l.id,
      address: l.address, city: l.city, zip: l.zip,
      priorMls: l.mls, mls: live.mls || null,
      priorPrice: l.currentPrice, currentPrice: newPrice ?? l.currentPrice,
      priceHistory: hist,
      beds: /^[\d.]+$/.test(String(live.beds)) ? +live.beds : null,
      baths: /^[\d.]+$/.test(String(live.baths)) ? +live.baths : null,
      sqft: /^\d+$/.test(String(live.sqft)) ? +live.sqft : null,
      acres: l.acres,
      daysOnMarket: /^\d+$/.test(String(live.daysOnMarket)) ? +live.daysOnMarket : null,
      photos: l.photos || [],
      // The gis-csv URL column is absolute in some exports and root-relative in others.
      url: live.url
        ? (/^https?:\/\//.test(live.url) ? live.url : `https://www.redfin.com${live.url}`)
        : l.url,
      firstSeen: l.firstSeen, lastSeen: TODAY,
      relistedOn: TODAY,
      status: 'relisted',
    });
  }
  return { listings, dropped, relisted };
}

/* ---------- run ---------- */

const raw = [];
for (const slugName of Object.keys(CITY_SLUGS)) {
  process.stderr.write(`== ${slugName} ==\n`);
  raw.push(...enumerateCity(slugName));
  sleep(1500);
}
const byId = new Map(raw.map((r) => [r.cbid, r]));
const all = [...byId.values()].filter((r) => Object.values(CITY_SLUGS).includes(r.city));

const candidates = all.filter((r) => {
  const b = +r.beds, ba = +r.baths, p = +r.price;
  return b >= MIN_BEDS && ba >= MIN_BATHS && p <= C.maxPrice;
});
process.stderr.write(`\n${all.length} active in target cities, ${candidates.length} clear beds/baths/price\n`);

/* Second-opinion status. The IDX feed keeps reporting escrowed listings as Active —
   see mls-status.js for the two runs that cost. A match this feed calls Active is
   demoted to pending when Redfin's live pending set asserts otherwise.

   A failure here must not silently pass every listing: if the sweep can't be trusted,
   say so and fall back to IDX status rather than pretending nothing is pending. */
let pendingIdx = new Map(), pendingIdxOk = false;
try {
  process.stderr.write('\ncross-checking status against Redfin pending set…\n');
  pendingIdx = statusIndex('130');
  pendingIdxOk = true;
  process.stderr.write(`  ${pendingIdx.size} pending/contingent listings indexed\n\n`);
} catch (e) {
  process.stderr.write(`  ! pending cross-check unavailable: ${e.message}\n` +
                       '  ! falling back to IDX status alone — escrowed listings may show as Active\n\n');
}

/* Relist guard (trap 9). A tracked property that vanishes from the IDX sweep looks
   identical to one that sold, and on 2026-08-08 that cost a $250,000 price cut:
   1781 Springvale Rd was relisted under a new MLS number, dropped out of the IDX feed
   while the republish caught up, and was reported as gone.

   Same shape as the pending guard above and for the same reason — a POSITIVE assertion
   from a live feed, never an absence. Absence still drops, because Redfin fetches fail
   often enough that treating "missing" as "still listed" would resurrect sold homes. */
let activeIdx = new Map(), activeIdxOk = false;
try {
  process.stderr.write('cross-checking departures against Redfin active set…\n');
  activeIdx = statusIndex('9');
  activeIdxOk = true;
  process.stderr.write(`  ${activeIdx.size} active listings indexed\n\n`);
} catch (e) {
  process.stderr.write(`  ! active cross-check unavailable: ${e.message}\n` +
                       '  ! a relisted property may therefore be reported as sold\n\n');
}

const demoted = [];

const matches = [], pending = [], near = [];
/** id -> why it fell out of the match list, for properties still on the market. */
const stillListed = new Map();
candidates.forEach((r, i) => {
  const d = detail(r.url);
  if (!d) { process.stderr.write(`  ! fetch failed ${r.name}\n`); return; }
  const am = d.amenities;
  const rec = {
    id: slug(r.name), address: r.street, city: r.city, zip: r.zip,
    mls: d.mls, currentPrice: Math.round(+r.price),
    beds: r.beds, baths: d.baths != null ? d.baths : r.baths,
    fullBaths: d.fullBaths, partialBaths: d.partialBaths,
    sqft: /^\d+$/.test(String(r.sqft)) ? +r.sqft : null,
    acres: d.acres, pool: true, poolDetail: am['Pool Description'] || 'Pool',
    yearBuilt: am['Year Built'] || null, garageSpaces: am['Garage Spaces'] || null,
    view: am['Property View'] || null, water: am.Water || null, sewer: am.Sewer || null,
    propertyType: d.propertyType, mlsStatus: d.realStatus,
    flag: d.badge && d.badge !== 'Sale Pending' ? d.badge : null,
    listedOn: (d.datePosted || '').slice(0, 10) || null,
    lat: r.lat, lng: r.lng, photos: d.images.slice(0, 6),
    url: r.url, gallery: r.url, status: 'match',
    summary: (d.description || '').replace(/^Discover the property .*? for sale\.\s*/, '').slice(0, 400),
    notes: '',
  };
  const bigEnough = d.acres != null && d.acres >= C.minAcres;
  const bathsOk = rec.baths == null || rec.baths >= MIN_BATHS;
  const ok = bigEnough && d.pool && bathsOk;

  /* Reconcile status across feeds before classifying. */
  let realStatus = d.realStatus;
  if (realStatus === 'Active') {
    const hit = pendingIdx.get(normAddr(rec.address, rec.city));
    if (hit) {
      realStatus = 'Pending';
      rec.mlsStatus = 'Pending';
      demoted.push(`${rec.address}, ${rec.city} (Redfin: ${hit.status}, MLS ${hit.mls})`);
    }
  }

  if (ok && realStatus === 'Active') matches.push(rec);
  else if (ok && realStatus === 'Pending') {
    pending.push({ ...rec, status: 'pending', newThisRun: false,
      ...carryPending(rec), lastSeen: TODAY,
      notes: 'Meets every criterion but is under contract (Sale Pending). Kept on file in case the deal falls through.' });
  } else if (d.realStatus === 'Active') {
    const missing = [];
    if (!d.pool) missing.push('no pool');
    if (!bigEnough) missing.push(d.acres != null ? `only ${d.acres} acres` : 'lot size unknown');
    if (!bathsOk) missing.push(`only ${rec.baths} baths`);
    stillListed.set(rec.id, missing.join(', '));
    if (missing.length === 1) {
      near.push({ address: r.street, city: r.city, price: Math.round(+r.price),
        beds: r.beds, baths: rec.baths, acres: d.acres, pool: !!d.pool, url: r.url,
        missing: missing[0] });
    }
  }
  process.stderr.write(`  ${i + 1}/${candidates.length} ${r.name.slice(0, 42).padEnd(42)} ` +
    `acres=${d.acres} pool=${d.pool} status=${d.realStatus}\n`);
  sleep(800);
});

matches.sort((a, b) => b.currentPrice - a.currentPrice);
pending.sort((a, b) => b.currentPrice - a.currentPrice);
near.sort((a, b) => (a.missing === 'no pool') - (b.missing === 'no pool') || b.price - a.price);

const { listings, dropped, relisted } = merge(matches, stillListed, activeIdx);
const out = {
  ...prior,
  lastRun: TODAY,
  // Spreading `prior` carries this forward unchanged, so it silently went stale —
  // it claimed 2026-08-01 through the 08-02 and 08-03 runs. refresh.py maintained it;
  // scrape.js never did. Only advance it when this is genuinely a later run, so
  // re-running on the same day doesn't overwrite it with today's date.
  previousRun: prior.lastRun && prior.lastRun !== TODAY ? prior.lastRun : prior.previousRun,
  source: { ...prior.source, inventoryScanned: all.length,
    passedBedsBathsPrice: candidates.length, verifiedActiveMatches: listings.length },
  dataQuality: { ...prior.dataQuality, verifiedActiveListings: listings.length },
  listings,
  pending,
  nearMisses: near.slice(0, 14),
  dropped: dropped.length ? dropped : [],
  relisted: relisted.length ? relisted : [],
  rejected: prior.rejected || [],
};

const nNew = listings.filter((l) => l.newThisRun).length;
// Only a price that moved *this* run is news; an older cut still renders its
// delta on the card but must not be counted again here.
const nChg = listings.filter((l) => (l.priceHistory || []).length > 1 &&
  l.priceHistory.at(-1).price !== l.priceHistory.at(-2).price &&
  l.priceHistory.at(-1).date === TODAY).length;

/* Never let a demotion be silent — it is the difference between reporting 7 matches
   and 6, and on 2026-08-03 it was the difference between reporting a new match and
   correctly reporting that nothing moved. */
if (demoted.length) {
  process.stderr.write(`\n${demoted.length} listing(s) the IDX feed called Active are Pending ` +
    `on Redfin — demoted:\n${demoted.map((d) => `  - ${d}\n`).join('')}`);
} else if (pendingIdxOk) {
  process.stderr.write('\nStatus cross-check: no disagreement between feeds.\n');
}

/* A rescued drop is the loudest thing a run can find — it is a property the primary
   feed said was gone, that is in fact still for sale, usually at a new price. */
if (relisted.length) {
  process.stderr.write(`\n${relisted.length} listing(s) missing from the IDX feed are still ` +
    `Active on Redfin — rescued from the drop list:\n${relisted.map((r) =>
      `  - ${r.address}, ${r.city}: MLS ${r.priorMls} -> ${r.mls}, ` +
      `${r.priorPrice} -> ${r.currentPrice}\n`).join('')}`);
} else if (activeIdxOk && dropped.length) {
  process.stderr.write('\nDeparture cross-check: every dropped listing is gone from both feeds.\n');
}

if (DRY) {
  process.stderr.write(`\n[dry run] ${listings.length} matches (${nNew} new, ${nChg} price changes), ` +
    `${pending.length} pending, ${dropped.length} dropped, ${relisted.length} relisted. Nothing written.\n`);
} else {
  fs.writeFileSync(FILE, JSON.stringify(out, null, 2) + '\n');
  process.stderr.write(`\nWrote listings.json — ${listings.length} matches ` +
    `(${nNew} new, ${nChg} price changes), ${pending.length} pending, ${dropped.length} dropped, ${relisted.length} relisted.\n` +
    `Now run: node build.js\n`);
}
