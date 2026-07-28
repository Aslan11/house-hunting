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

function slug(name) {
  return name.replace(/,\s*CA\s*\d{5}$/, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function merge(found) {
  const priorById = new Map((prior.listings || []).map((l) => [l.id, l]));
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
  const dropped = (prior.listings || []).filter((l) => !liveIds.has(l.id)).map((l) => ({
    address: `${l.address}, ${l.city}`,
    priorPrice: l.currentPrice,
    reason: 'No longer an active listing in the MLS feed — sold, expired, or withdrawn.',
    droppedOn: TODAY,
  }));
  return { listings, dropped };
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

const matches = [], pending = [], near = [];
candidates.forEach((r, i) => {
  const d = detail(r.url);
  if (!d) { process.stderr.write(`  ! fetch failed ${r.name}\n`); return; }
  const am = d.amenities;
  const rec = {
    id: slug(r.name), address: r.street, city: r.city, zip: r.zip,
    mls: d.mls, currentPrice: Math.round(+r.price),
    beds: r.beds, baths: r.baths,
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
  if (bigEnough && d.pool && d.realStatus === 'Active') matches.push(rec);
  else if (bigEnough && d.pool && d.realStatus === 'Pending') {
    pending.push({ ...rec, status: 'pending', newThisRun: false,
      priceHistory: [{ date: TODAY, price: rec.currentPrice }],
      notes: 'Meets every criterion but is under contract (Sale Pending). Kept on file in case the deal falls through.' });
  } else if (d.realStatus === 'Active' && bigEnough !== d.pool) {
    near.push({ address: r.street, city: r.city, price: Math.round(+r.price),
      beds: r.beds, baths: r.baths, acres: d.acres, pool: !!d.pool, url: r.url,
      missing: d.pool ? `only ${d.acres} acres` : 'no pool' });
  }
  process.stderr.write(`  ${i + 1}/${candidates.length} ${r.name.slice(0, 42).padEnd(42)} ` +
    `acres=${d.acres} pool=${d.pool} status=${d.realStatus}\n`);
  sleep(800);
});

matches.sort((a, b) => b.currentPrice - a.currentPrice);
pending.sort((a, b) => b.currentPrice - a.currentPrice);
near.sort((a, b) => (a.missing === 'no pool') - (b.missing === 'no pool') || b.price - a.price);

const { listings, dropped } = merge(matches);
const out = {
  ...prior,
  lastRun: TODAY,
  source: { ...prior.source, inventoryScanned: all.length,
    passedBedsBathsPrice: candidates.length, verifiedActiveMatches: listings.length },
  dataQuality: { ...prior.dataQuality, verifiedActiveListings: listings.length },
  listings,
  pending,
  nearMisses: near.slice(0, 14),
  dropped: dropped.length ? dropped : [],
  rejected: prior.rejected || [],
};

const nNew = listings.filter((l) => l.newThisRun).length;
const nChg = listings.filter((l) => (l.priceHistory || []).length > 1 &&
  l.priceHistory.at(-1).price !== l.priceHistory.at(-2).price).length;

if (DRY) {
  process.stderr.write(`\n[dry run] ${listings.length} matches (${nNew} new, ${nChg} price changes), ` +
    `${pending.length} pending, ${dropped.length} dropped. Nothing written.\n`);
} else {
  fs.writeFileSync(FILE, JSON.stringify(out, null, 2) + '\n');
  process.stderr.write(`\nWrote listings.json — ${listings.length} matches ` +
    `(${nNew} new, ${nChg} price changes), ${pending.length} pending, ${dropped.length} dropped.\n` +
    `Now run: node build.js\n`);
}
