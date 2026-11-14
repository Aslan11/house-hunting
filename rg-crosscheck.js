#!/usr/bin/env node
/**
 * RealGeeks MetroList IDX cross-check — the first source in this repo that filters on
 * **pool** server-side, so the candidate set arrives already narrowed instead of being
 * recovered from a few hundred detail reads.
 *
 * Why this exists
 * ---------------
 * Every enumeration this repo runs pays the same tax: no search payload carries pool, so the
 * pipeline clears beds/baths/price/city first and then reads one detail page per survivor to
 * find out whether there is water in the ground. `mls-enumerate.py` reads 266 detail pages to
 * find 7 matches; `cb-crosscheck.py` reads 42. Both are correct and both are slow.
 *
 * `www.sellingnortherncalifornia.com` is a RealGeeks site carrying the MetroList IDX feed, and
 * its advanced search GETs to `/search/results/` with the filters in the query string —
 * including `pool=True` and `land_area_acres_min`. One request returns the whole qualifying set
 * for El Dorado County: **14 rows** on 2026-11-08, against 410 (CB) and 375 (MetroListPRO).
 *
 * That makes it a cheap, genuinely separate fourth opinion — separate from the board's own
 * MetroListPRO route and from the Coldwell Banker IDX. It is still a **cross-check**: it is a
 * republisher, not a board of record, and the two limits below mean it cannot promote anything.
 *
 * How it reads
 * ------------
 * The result rows are rendered client-side (the inline payload is deferred behind
 * `window.rgDeferScript`), so this uses the headless Chromium that is already installed here.
 * Note what it does *not* do: the request carries Chromium's own User-Agent. Nothing here
 * claims to be a browser it isn't — it *is* a browser. The site answers curl's default agent
 * with HTTP 200 as well, and the server-rendered "`N` Properties" count is readable that way;
 * only the rows themselves need rendering.
 *
 *   search  https://www.sellingnortherncalifornia.com/search/results/?county=El+Dorado&city=all
 *             &type=res&list_price_max=…&beds_min=…&baths_min=…&land_area_acres_min=…&pool=True
 *             &page=N
 *   detail  https://www.sellingnortherncalifornia.com/property/<MLS>/
 *
 * Detail pages are server-rendered and carry the MLS field table flat: `Status`,
 * `Land Area (Acres)`, `Pool`, `Bedrooms`, `Bathrooms`, `List Price`, `City`, `Zip`, plus
 * `Price Change ▼ $N <n> days ago` and photo URLs on `property-images.realgeeks.com`.
 *
 * Three limits, each one a lesson this repo already learned at another host
 * ------------------------------------------------------------------------
 * 1. **`baths_min` and the detail page's `Bathrooms` are the combined count.** 1234 Rising Hill
 *    W Road comes back under `baths_min=3` and is 2 full + 1 half on the MLS — the same trap
 *    README "Half baths" records for the IDX city payload and `redfin-csv.py` for Redfin's
 *    `BATHS`. This script flags a row it cannot decompose and leaves the full-bath call to the
 *    MLS of record. It never promotes.
 * 2. **MetroList only.** Same blind spot as MetroListPRO and the three mirrors: a listing on
 *    another MLS is invisible here. Both of the board's foreign-MLS cards are correctly absent
 *    from this sweep, which is why it does not close `coverageGap` — `cb-crosscheck.py` does.
 * 3. **`land_area_acres_min` has discrete steps** (…1, 2, 3, 4, 5, 10, 20, 40), so the 2.5-acre
 *    minimum cannot be expressed server-side. It queries at 2 and filters locally, which is the
 *    safe direction: the query is wider than the criterion, never narrower. Do not be tempted to
 *    query at 3 — that silently drops 1234 Rising Hill's 2.66 acres.
 *
 * The pool filter is `pool=True` against the MLS's own structured field, so it is not the
 * remarks-scanning guess `cb-crosscheck.py` has to make. A control run with `pool=all` returned
 * 46 rows; every one of the extra rows in the three cities read with the `Pool` field absent on
 * its detail page, so the filter is a real negative and not merely a missing positive.
 *
 * Usage
 * -----
 *     node rg-crosscheck.js            # sweep, filter, diff against listings.json
 *     node rg-crosscheck.js --stamp    # also write dataQuality.poolFilteredCrossCheck
 *
 * `--stamp` refuses to write if the sweep returned no rows or if the page's own result count
 * disagrees with the number of rows scraped, so a truncated render cannot publish a
 * completeness claim — the same guard `mls-enumerate.py --stamp`, `redfin-csv.py --stamp` and
 * `cb-crosscheck.py --stamp` apply.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = 'https://www.sellingnortherncalifornia.com';
const TARGET = new Set(['shingle springs', 'rescue', 'placerville']);
const HERE = __dirname;
const TODAY = new Date().toISOString().slice(0, 10);

const MIN_BEDS = 4;
const MIN_BATHS_COMBINED = 3;   // combined here; the full-bath minimum is the MLS's call
const MAX_PRICE = 1_500_000;
const MIN_ACRES = 2.5;
const QUERY_ACRES = 2;          // nearest step below MIN_ACRES — see limit 3
const MAX_PAGES = 10;

const searchUrl = (page) => `${BASE}/search/results/?` + new URLSearchParams({
  county: 'El Dorado', city: 'all', type: 'res',
  list_price_min: 'all', list_price_max: String(MAX_PRICE),
  beds_min: String(MIN_BEDS), baths_min: String(MIN_BATHS_COMBINED),
  land_area_acres_min: String(QUERY_ACRES), pool: 'True',
  page: String(page),
}).toString();

const num = (v) => {
  if (v == null) return null;
  const s = String(v).replace(/[^0-9.]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Normalise street types before diffing, per README "Three ways the page can report a change
 *  that did not happen": this feed writes "Saddlehorn Road", others write "Saddlehorn Rd". */
const addrKey = (s) => String(s || '').toLowerCase()
  .replace(/,.*$/, '')
  .replace(/\b(road|rd)\b/g, 'rd').replace(/\b(drive|dr)\b/g, 'dr')
  .replace(/\b(lane|ln)\b/g, 'ln').replace(/\b(court|ct)\b/g, 'ct')
  .replace(/\b(street|st)\b/g, 'st').replace(/\b(avenue|ave)\b/g, 'ave')
  .replace(/\b(way|wy)\b/g, 'way').replace(/\b(trail|trl)\b/g, 'trl')
  .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Read one label out of the flat MLS field table. The table is a single run of
 * "Label value Label value …", so a value ends where the next known label begins — the same
 * shape `mls-enumerate.py`'s field() handles. Labels not in this list would swallow the value
 * after them, so the list is the parser.
 */
const LABELS = [
  'List Price', 'Price Change', 'MLS#', 'Status', 'Bedrooms', 'Bathrooms', 'Living Sq. Ft',
  'Square Footage', 'Type', 'Zip', 'City', 'Building / Subdivision', 'Land Area (Acres)',
  'Year Built', 'Subtype Description', 'Subtype', 'Style', 'Construction', 'Foundation',
  'Stories', 'Carport Spaces', 'Garage Spaces', 'Garage', 'House FAces', 'Baths Other',
  'Master Bath', 'Floor Coverings', 'Laundry Description', 'Dining Description',
  'Kitchen Description', 'Kitchen Appliances', 'Number of Fireplaces', 'Fireplace Description',
  'Road Description', 'Rec Parking', 'Pool', 'Horses', 'Horse Amenities', 'Misc', 'Equipment',
  'Cooling', 'Heat', 'Water', 'Utilities', 'Sewer', 'Contact Us', 'Add to Favorites',
  'Property Description', 'New Search',
];

function field(flat, label) {
  const at = flat.indexOf(label);
  if (at < 0) return null;
  const rest = flat.slice(at + label.length);
  let cut = rest.length;
  for (const other of LABELS) {
    if (other === label) continue;
    const j = rest.indexOf(other);
    if (j >= 0 && j < cut) cut = j;
  }
  return rest.slice(0, cut).trim() || null;
}

async function sweep(browser) {
  const page = await browser.newPage();
  const rows = new Map();
  let reported = null;

  for (let n = 1; n <= MAX_PAGES; n++) {
    const resp = await page.goto(searchUrl(n), { waitUntil: 'networkidle', timeout: 120000 });
    if (!resp || resp.status() !== 200) throw new Error(`search page ${n}: HTTP ${resp && resp.status()}`);
    await page.waitForTimeout(2500);
    const got = await page.evaluate(() => {
      const m = document.body.innerText.match(/(\d+)\s+Propert/);
      const out = [];
      for (const el of document.querySelectorAll('.property')) {
        const addr = el.querySelector('.address');
        if (!addr) continue;
        const d = {};
        el.querySelectorAll('.detail').forEach((x) => {
          const t = (x.querySelector('.detail-title') || {}).innerText || '';
          const v = (x.querySelector('.number') || {}).innerText || '';
          if (t.trim()) d[t.trim().toUpperCase().replace(/[^A-Z]/g, '')] = v.trim();
        });
        out.push({
          address: addr.innerText.trim().replace(/\s+/g, ' '),
          price: (el.querySelector('.price') || {}).innerText || '',
          beds: d.BEDS, bathsCombined: d.BATHS, sqft: d.SQFT, mls: d.MLS,
        });
      }
      return { reported: m ? Number(m[1]) : null, rows: out };
    });
    if (reported == null) reported = got.reported;
    const before = rows.size;
    for (const r of got.rows) if (r.mls) rows.set(r.mls, r);
    // Pages repeat once the result set runs out, the same way the CB IDX does.
    if (rows.size === before) break;
    if (reported != null && rows.size >= reported) break;
  }
  await page.close();
  return { reported, rows: [...rows.values()] };
}

async function detail(browser, mls) {
  const page = await browser.newPage();
  try {
    const url = `${BASE}/property/${mls}/`;
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
    if (!resp || resp.status() !== 200) return { url, http: resp && resp.status() };
    await page.waitForTimeout(1200);
    const got = await page.evaluate(() => ({
      text: document.body.innerText.replace(/[ \t]+/g, ' '),
      photos: [...new Set([...document.querySelectorAll('img')]
        .map((i) => i.getAttribute('data-src') || i.getAttribute('src') || '')
        .filter((u) => u.includes('property-images'))
        .map((u) => u.split('?')[0]))],
    }));
    const flat = got.text.replace(/\n/g, ' ');
    // Scope gate, same discipline as mlsl-verify.py: an unknown id must not be read as data.
    const head = (got.text.match(/\n([^\n]+,\s*CA\s*\d{5})\n/) || [])[1] || null;
    const seen = field(flat, 'MLS#');
    if (!head || !seen || !seen.includes(String(mls))) return { url, scopeFail: true, head, seen };
    return {
      url, head, photos: got.photos,
      status: (field(flat, 'Status') || '').split(/\s{2,}|Building/)[0].trim(),
      price: num(field(flat, 'List Price')),
      beds: num(field(flat, 'Bedrooms')),
      bathsCombined: num(field(flat, 'Bathrooms')),
      sqft: num(field(flat, 'Living Sq. Ft')),
      acres: num(field(flat, 'Land Area (Acres)')),
      city: (field(flat, 'City') || '').trim(),
      zip: (field(flat, 'Zip') || '').trim(),
      pool: /\byes\b/i.test(field(flat, 'Pool') || ''),
      priceChange: (flat.match(/Price Change ▼ (\$[\d,]+) (\d+ days? ago)/) || []).slice(1).join(' ') || null,
    };
  } finally {
    await page.close();
  }
}

async function main() {
  const stamp = process.argv.includes('--stamp');
  // The only external dependency in this repo — every other script is Node/Python stdlib, and
  // there is no package.json. The cloud runner this tracker runs on ships Playwright and a
  // matching Chromium preinstalled and resolvable from any directory, which is why this route is
  // available at all. Fail with that said out loud rather than with a bare MODULE_NOT_FOUND, so a
  // run on a host without it knows this is a missing *host* capability and not a broken script —
  // and knows the rest of the pipeline is unaffected, because nothing else imports it.
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    console.error('playwright is not available on this host, so the search rows cannot be '
      + 'rendered. This cross-check is optional: skip it and the page simply omits the '
      + '"Ask for the pool directly" row. Nothing else in the pipeline needs it.');
    process.exit(2);
  }
  const boardPath = path.join(HERE, 'listings.json');
  const board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
  const tracked = new Set();
  for (const key of ['listings', 'pending', 'relisted', 'poolless', 'nearMisses']) {
    for (const l of board[key] || []) {
      if (l.mls) tracked.add(String(l.mls));
      if (l.address) tracked.add(addrKey(l.address));
    }
  }
  const rejectedKeys = new Set((board.rejected || []).map((r) => addrKey(r.address)));

  const browser = await chromium.launch();
  let result;
  try {
    console.log('RealGeeks MetroList IDX sweep (server-side pool + acreage filter, no UA spoof):');
    const { reported, rows } = await sweep(browser);
    console.log(`  county-wide rows matching ${MIN_BEDS}bd / ${MIN_BATHS_COMBINED}ba(comb) / `
      + `$${MAX_PRICE.toLocaleString('en-US')} / ${QUERY_ACRES}+ac / pool: `
      + `${rows.length} scraped, page reported ${reported}`);

    const inArea = rows.filter((r) => TARGET.has(String(r.address).split(',').pop().trim().toLowerCase()));
    console.log(`  ${inArea.length} of them are in the three target cities\n`);

    const hits = [];
    const flagged = [];
    const shortOnLand = [];
    for (const r of inArea.sort((a, b) => (num(b.price) || 0) - (num(a.price) || 0))) {
      const d = await detail(browser, r.mls);
      if (d.scopeFail || d.http) {
        flagged.push({ mls: r.mls, address: r.address, why: d.scopeFail
          ? 'detail page did not identify itself as this MLS number — discarded unread'
          : `detail page HTTP ${d.http}` });
        continue;
      }
      if (!d.pool) {
        flagged.push({ mls: r.mls, address: r.address,
          why: 'search filter said pool, detail page does not — read by hand' });
        continue;
      }
      if (d.acres == null) {
        flagged.push({ mls: r.mls, address: r.address, why: 'acreage unreadable — read by hand' });
        continue;
      }
      if (d.acres < MIN_ACRES) { shortOnLand.push({ ...r, acres: d.acres }); continue; }
      const isTracked = tracked.has(String(r.mls)) || tracked.has(addrKey(r.address));
      hits.push({
        mls: String(r.mls), address: d.head, status: d.status, price: d.price,
        beds: d.beds, bathsCombined: d.bathsCombined, acres: d.acres, sqft: d.sqft,
        priceChange: d.priceChange, photos: (d.photos || []).length, isTracked,
        bathsUndecomposable: d.bathsCombined != null && d.bathsCombined >= MIN_BATHS_COMBINED,
        url: d.url,
      });
    }

    console.log(`${hits.length} rows clear ${MIN_ACRES} acres with the MLS pool field set:\n`);
    const missing = [];
    for (const h of hits) {
      // "tracked", not "on board": the set below includes `poolless` and `nearMisses`, so a row
      // can be known to the page without being a match. 1234 Rising Hill W Road is exactly that
      // — a near miss on the half-bath rule — and calling it "on board" would read as agreement
      // with a board position it does not hold.
      console.log(`  ${h.isTracked ? 'tracked     ' : 'NOT TRACKED '} MLS ${h.mls.padEnd(10)} `
        + `$${String(h.price == null ? '?' : h.price.toLocaleString('en-US')).padStart(9)} `
        + `${h.beds}bd ${h.bathsCombined}ba(comb) ${String(h.acres).padStart(6)}ac `
        + `${h.status.padEnd(7)} ${h.address}`
        + (h.priceChange ? `  [${h.priceChange}]` : ''));
      if (!h.isTracked) missing.push({ ...h, previouslyRejected: rejectedKeys.has(addrKey(h.address)) });
    }

    if (shortOnLand.length) {
      console.log('\nPool, beds, baths and price clear but under the land minimum:');
      for (const s of shortOnLand) console.log(`   MLS ${s.mls} ${s.address} ${s.acres}ac`);
    }
    if (flagged.length) {
      console.log('\nFlagged, not decided:');
      for (const f of flagged) console.log(`   MLS ${f.mls} ${f.address}\n       ${f.why}`);
    }

    console.log('\nBath counts here are full + half combined and cannot clear the 3-full-bath '
      + 'minimum on their own — the MLS of record decides, per README "Half baths".');

    console.log();
    if (missing.length) {
      console.log(`** ${missing.length} candidate(s) this feed has that the board does not: **`);
      for (const m of missing) {
        console.log(`   MLS ${m.mls} ${m.address} $${(m.price || 0).toLocaleString('en-US')}`
          + (m.previouslyRejected ? '  (already in `rejected`)'
            : '  <-- needs a MetroListPRO read before it can join the board'));
      }
      console.log('\n   Per the verification gate, none of these joins the board on this feed\'s word.');
    } else {
      console.log('Nothing this feed carries is missing from the board.');
    }

    result = { reported, scraped: rows.length, inArea: inArea.length, hits, missing, flagged };
  } finally {
    await browser.close();
  }

  if (!stamp) return;
  // Same guard as the other three sweeps: a sweep that came back empty, or one whose scraped row
  // count disagrees with the page's own total, has not established anything and must not stamp.
  if (!result.scraped || (result.reported != null && result.scraped !== result.reported)) {
    console.log(`\nNot stamping: scraped ${result.scraped} rows against a reported `
      + `${result.reported}. A partial render cannot publish a completeness claim.`);
    process.exitCode = 1;
    return;
  }
  board.dataQuality = board.dataQuality || {};
  board.dataQuality.poolFilteredCrossCheck = {
    ranOn: TODAY,
    source: 'RealGeeks MetroList IDX (sellingnortherncalifornia.com), server-side pool filter, no UA spoof',
    countyRowsWithPool: result.scraped,
    inTargetCities: result.inArea,
    clearedLandAndPool: result.hits.length,
    missingFromBoard: result.missing.map((m) => ({ mls: m.mls, address: m.address, price: m.price })),
    note: 'The only source this repo has found that filters on the MLS pool field server-side, so '
      + 'the candidate set arrives narrowed instead of being recovered from hundreds of detail '
      + 'reads. MetroList only, so it is blind to a foreign-MLS listing and does not close '
      + 'coverageGap; and its bath count is full + half combined, so it cannot resolve the '
      + '3-full-bath minimum. A cross-check, never the board.',
  };
  fs.writeFileSync(boardPath, JSON.stringify(board, null, 2));
  console.log(`\nStamped dataQuality.poolFilteredCrossCheck (${result.scraped} rows).`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
