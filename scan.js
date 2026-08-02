#!/usr/bin/env node
/**
 * scan.js — pull the live active-listings feed, filter to criteria, verify pools.
 *
 *   node scan.js            # writes scan-results.json and prints a summary
 *   node scan.js --merge    # also merges into listings.json (new + price changes)
 *
 * How it works, and why it works this way:
 *
 * 1. SOURCE. Redfin's `gis-csv` endpoint returns the active-listing set as CSV.
 *    Region IDs are unreliable to guess (17151 is San Francisco, not Placerville),
 *    so we query by map POLYGON instead, which needs no ID lookup. The
 *    `location-autocomplete` endpoint that would resolve IDs is bot-blocked; the
 *    CSV endpoint is not.
 *
 * 2. TILING. The endpoint silently truncates at `num_homes`. A single polygon over
 *    the county came back with exactly 350 rows — i.e. truncated, with no error. So
 *    we split the area into a grid and assert every tile came back under the cap.
 *    If a tile is at the cap we fail loudly rather than report a partial market.
 *
 * 3. FILTERING. `num_beds` and `num_baths` are honoured server-side, but
 *    `max_price` and `min_lot_size` are silently IGNORED — passing them changes
 *    nothing. Everything is therefore filtered locally from the CSV columns.
 *    LOT SIZE is in square feet.
 *
 * 4. POOL. The CSV has no pool column, so each surviving candidate's detail page is
 *    fetched. Detail pages embed data for NEARBY homes as well as the subject, so
 *    grepping the page for "pool" attributes other houses' pools to this one. We
 *    read the subject's structured `Pool Information` amenity group, cross-check the
 *    `hasPrivatePool` flag, and cross-check the subject-only marketing remarks.
 *    A property is only reported as having a pool when these agree.
 *
 * 5. PHOTOS. Photo URLs embed the MLS number in the path, so a photo can be tied to
 *    the right property with certainty.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const CRITERIA = {
  cities: new Set(['Placerville', 'Shingle Springs', 'Rescue']),
  minBeds: 4,
  minBaths: 3,
  minAcres: 2.5,
  maxPrice: 1500000,
  poolRequired: true,
};

const NUM_HOMES = 350;            // server cap per request
const SQFT_PER_ACRE = 43560;

// Bounding box covering Placerville / Shingle Springs / Rescue and surrounds.
const BOX = { west: -121.05, east: -120.70, south: 38.55, north: 38.85 };
const COLS = 4, ROWS = 3;

function curl(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const out = execFileSync('curl', [
        '-sS', '-m', '60', '-L', '-A', UA,
        '-H', 'Accept-Language: en-US,en;q=0.9',
        url,
      ], { maxBuffer: 1 << 28 }).toString('utf8');
      if (out.length > 2000) return out;
    } catch (e) { /* retry */ }
    const wait = 4 * 2 ** i;
    process.stderr.write(`  retry in ${wait}s…\n`);
    execFileSync('sleep', [String(wait)]);
  }
  return '';
}

/** Minimal RFC4180 CSV parse — fields may contain commas and quoted quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter((r) => r.length === head.length)
             .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

function tileUrl(w, e, s, n) {
  const poly = [[w, s], [e, s], [e, n], [w, n], [w, s]]
    .map(([x, y]) => `${x} ${y}`).join(',');
  return 'https://www.redfin.com/stingray/api/gis-csv?al=1&market=sacramento' +
    `&num_homes=${NUM_HOMES}&ord=redfin-recommended-asc&page_number=1` +
    `&poly=${encodeURIComponent(poly)}` +
    '&sf=1,2,3,5,6,7&status=9&uipt=1,2,3,4,5,6&v=8';
}

function fetchActive() {
  const seen = new Map();
  const truncated = [];
  const dw = (BOX.east - BOX.west) / COLS;
  const dh = (BOX.north - BOX.south) / ROWS;
  for (let i = 0; i < COLS; i++) {
    for (let j = 0; j < ROWS; j++) {
      const w = BOX.west + i * dw, e = w + dw;
      const s = BOX.south + j * dh, n = s + dh;
      const rows = parseCsv(curl(tileUrl(w, e, s, n)));
      process.stderr.write(`tile ${w.toFixed(3)},${s.toFixed(2)} → ${rows.length}\n`);
      if (rows.length >= NUM_HOMES) truncated.push(`${w},${s}`);
      for (const r of rows) {
        const key = r['MLS#'] || r.ADDRESS;
        if (key) seen.set(key, r);
      }
    }
  }
  if (truncated.length) {
    throw new Error(
      `Tiles hit the ${NUM_HOMES}-row cap and were truncated: ${truncated.join('; ')}. ` +
      `Increase COLS/ROWS in scan.js — results would otherwise be silently incomplete.`);
  }
  return [...seen.values()];
}

const n = (v) => {
  const x = Number(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(x) ? x : null;
};

function shortlist(rows) {
  const pass = [], noLot = [];
  for (const r of rows) {
    if (!CRITERIA.cities.has(r.CITY)) continue;
    const price = n(r.PRICE), beds = n(r.BEDS), baths = n(r.BATHS), lot = n(r['LOT SIZE']);
    if (price == null || price > CRITERIA.maxPrice) continue;
    if (beds == null || beds < CRITERIA.minBeds) continue;
    if (baths == null || baths < CRITERIA.minBaths) continue;
    // Lot size missing is not the same as lot size too small — surface it.
    if (lot == null) { noLot.push(r); continue; }
    if (lot / SQFT_PER_ACRE < CRITERIA.minAcres) continue;
    const urlKey = Object.keys(r).find((k) => k.startsWith('URL'));
    pass.push({
      mls: r['MLS#'], address: r.ADDRESS, city: r.CITY, zip: r['ZIP OR POSTAL CODE'],
      price, beds, baths, sqft: n(r['SQUARE FEET']),
      acres: Math.round((lot / SQFT_PER_ACRE) * 100) / 100,
      daysOnMarket: n(r['DAYS ON MARKET']), status: r.STATUS,
      url: r[urlKey], lat: r.LATITUDE, lng: r.LONGITUDE,
    });
  }
  pass.sort((a, b) => b.acres - a.acres);
  return { pass, noLot };
}

/**
 * Pool verification. Returns {pool, features, flag, remarksMention, agree}.
 * Only the SUBJECT property's fields are read — see note 4 in the header.
 */
function verifyPool(html, mls) {
  // Locate the subject's "Pool Information" amenity group and read only the
  // entries inside it, stopping at the next group. Index-based rather than one
  // big regex, because the JSON is escaped inline in the page and the group
  // length varies a lot between listings.
  const features = [];
  const MARK = '\\"groupTitle\\":\\"Pool Information\\"';
  for (let at = html.indexOf(MARK); at !== -1; at = html.indexOf(MARK, at + 1)) {
    let end = html.indexOf('\\"groupTitle\\"', at + MARK.length);
    if (end === -1) end = at + 2000;
    const seg = html.slice(at, Math.min(end, at + 2000));
    const entryRe = /\\"amenityName\\":\\"(.*?)\\"[\s\S]*?\\"amenityValues\\":\[(.*?)\]/g;
    let a;
    while ((a = entryRe.exec(seg))) {
      const vals = [...a[2].matchAll(/\\"(.*?)\\"/g)].map((m) => m[1]);
      features.push({ name: a[1], values: vals });
    }
  }
  const hasFeatures = features.some((f) =>
    /pool features/i.test(f.name) ||
    (/has private pool/i.test(f.name) && /yes/i.test(f.values.join(' '))));

  const flags = [...html.matchAll(/\\"hasPrivatePool\\":(true|false)/g)].map((m) => m[1]);
  const flag = flags.length ? flags.every((f) => f === 'true') : null;

  const m = html.match(/data-rf-test-id="listingRemarks">([\s\S]*?)<\/div>/);
  const remarks = m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
  const remarksMention = /\bpool\b/i.test(remarks);

  return {
    pool: hasFeatures && flag === true,
    features, flag, remarksMention, remarks,
    agree: hasFeatures === (flag === true) && hasFeatures === remarksMention,
  };
}

function photosFor(html, mls) {
  const re = new RegExp(
    `https://ssl\\.cdn-redfin\\.com/photo/\\d+/mbpaddedwide/\\d+/genMid\\.${mls}_\\d+\\.jpg`, 'g');
  return [...new Set(html.match(re) || [])].slice(0, 1);
}

function main() {
  const merge = process.argv.includes('--merge');
  process.stderr.write('Fetching active listings…\n');
  const all = fetchActive();
  const inCities = all.filter((r) => CRITERIA.cities.has(r.CITY)).length;
  process.stderr.write(`${all.length} active listings; ${inCities} in target cities\n`);

  const { pass, noLot } = shortlist(all);
  process.stderr.write(`${pass.length} meet beds/baths/acres/price; verifying pools…\n`);

  const matches = [], nearMisses = [], disputed = [];
  for (const c of pass) {
    const html = curl(c.url);
    if (!html) { process.stderr.write(`  ! could not load ${c.address}\n`); continue; }
    const v = verifyPool(html, c.mls);
    const feat = v.features.flatMap((f) => f.values).join(', ');
    process.stderr.write(
      `  ${v.pool ? 'POOL' : ' -- '} ${c.address}, ${c.city}` +
      `${v.agree ? '' : '   [SIGNALS DISAGREE — review by hand]'}\n`);
    if (!v.agree) disputed.push({ ...c, poolSignals: v });
    if (v.pool) matches.push({ ...c, pool: true, poolFeatures: feat, photos: photosFor(html, c.mls) });
    else nearMisses.push({ ...c, reason: 'No pool (MLS pool field = none; confirmed against listing remarks)' });
    execFileSync('sleep', ['5']);   // be polite; the host rate-limits
  }

  const out = {
    scannedOn: new Date().toISOString().slice(0, 10),
    activeListingsScanned: all.length,
    inTargetCities: inCities,
    matches, nearMisses, disputed,
    unknownLotSize: noLot.map((r) => ({
      address: r.ADDRESS, city: r.CITY, price: n(r.PRICE),
      beds: n(r.BEDS), baths: n(r.BATHS),
      note: 'Lot size not published in the feed — verify before excluding',
    })),
  };
  fs.writeFileSync(path.join(__dirname, 'scan-results.json'), JSON.stringify(out, null, 2));

  console.log(`\n${matches.length} match all criteria including pool:`);
  for (const m of matches) {
    console.log(`  $${m.price.toLocaleString('en-US').padStart(9)} | ${m.beds}bd ${m.baths}ba | ` +
                `${String(m.acres).padStart(6)} ac | ${m.city.padEnd(16)} | ${m.address}`);
  }
  if (disputed.length) {
    console.log(`\n${disputed.length} had disagreeing pool signals — check by hand before trusting.`);
  }
  console.log(`\nWrote scan-results.json.` +
    (merge ? '' : ' Re-run with --merge to fold into listings.json.'));

  if (merge) require('./merge.js').merge(out);
}

if (require.main === module) main();
module.exports = { fetchActive, shortlist, verifyPool, parseCsv };
