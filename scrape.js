#!/usr/bin/env node
/**
 * Pulls candidate listings straight off Redfin and prints a report.
 *
 *   node scrape.js            # full sweep, uses ./.cache
 *   node scrape.js --fresh    # ignore the cache and refetch everything
 *
 * It does NOT write listings.json — it prints what it found so a human (or the
 * next run) can merge deliberately. That is on purpose: the verification gate in
 * README.md exists because an automated "found it, ship it" path is what produced
 * four off-market matches on the 2026-07-26 run.
 *
 * Notes that cost time to rediscover, so they live here:
 *  - Redfin search pages embed *nearby* homes outside the target zip. Filter on
 *    addressLocality, not on the zip you asked for.
 *  - The min-lot-size filter silently hides listings with no acreage on file, so
 *    the sweep runs without it and acreage is read from each detail page.
 *  - Redfin answers HTTP 202 with a near-empty body once you go too fast. That is
 *    rate limiting, not a block; PAUSE_MS clears it.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const CACHE = path.join(__dirname, '.cache');
const FRESH = process.argv.includes('--fresh');
const PAUSE_MS = 12000;        // between detail fetches
const BACKOFF_MS = 45000;      // after a 202
const MIN_BYTES = 100000;      // anything smaller is a rate-limit stub
const SQFT_PER_ACRE = 43560;

const CITIES = ['Shingle Springs', 'Rescue', 'Placerville'];
const ZIPS = ['95682', '95672', '95667'];
const FILTER = 'property-type=house,min-beds=4,min-baths=3,max-price=1.5M';

const CRITERIA = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8')).criteria;

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function fetchPage(url, tag) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, tag.replace(/\W+/g, '_').slice(0, 120) + '.html');
  if (!FRESH && fs.existsSync(file) && fs.statSync(file).size > MIN_BYTES) {
    fetchPage.cached = true;              // caller skips its rate-limit pause
    return fs.readFileSync(file, 'utf8');
  }
  fetchPage.cached = false;
  for (let attempt = 1; attempt <= 4; attempt++) {
    let body = '';
    try {
      body = execFileSync('curl',
        ['-sS', '-L', '--max-time', '50', '-A', UA, '-H', 'Accept: text/html', url],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch { /* curl failed outright; fall through to the backoff */ }
    if (body.length > MIN_BYTES) {
      fs.writeFileSync(file, body);
      return body;
    }
    process.stderr.write(`  rate-limited on ${tag} (${body.length}B), backing off…\n`);
    sleep(BACKOFF_MS * attempt);
  }
  process.stderr.write(`  GAVE UP on ${tag}\n`);
  return '';
}

/** Every listing Redfin embedded as JSON-LD on a search page. */
function parseSearch(html) {
  const out = new Map();
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    let blk;
    try { blk = JSON.parse(m[1]); } catch { continue; }
    if (!Array.isArray(blk)) continue;
    const rec = {};
    for (const item of blk) {
      if (item['@type'] === 'SingleFamilyResidence' || item.address) {
        rec.url = item.url;
        rec.beds = item.numberOfRooms;
        rec.sqft = item.floorSize && item.floorSize.value;
        rec.address = item.address && item.address.streetAddress;
        rec.city = item.address && item.address.addressLocality;
        rec.zip = item.address && item.address.postalCode;
      }
      if (item['@type'] === 'Product' && item.offers && item.offers.price) {
        rec.price = Math.round(Number(item.offers.price));
      }
    }
    if (rec.url) out.set(rec.url, rec);
  }
  // Sanity check: LD blocks should account for every homecard on the page.
  const cards = (html.match(/class="bp-Homecard__Address/g) || []).length;
  return { listings: out, cards };
}

/** Redfin escapes '/' as / inside its embedded JSON, so decode before returning. */
const unesc = (s) => (typeof s === 'string'
  ? s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  : s);
const grab = (re, s) => { const m = s.match(re); return m ? unesc(m[1]) : null; };

function parseDetail(html, url) {
  const t = html.replace(/\\"/g, '"');
  const desc = grab(/<meta name="description" content="([\s\S]*?)"/, html) || '';

  // Scope size fields to latestListingInfo. A bare /"totalSqFt":\d+/ over the whole
  // page matches a comparable-sales record first and silently returns another
  // house's numbers — 5551 Saddlehorn reads 1828 sqft that way instead of 3400.
  const info = grab(/"latestListingInfo":\{([\s\S]{0,600}?)\}/, t) || '';
  const lotSqFt = grab(/"lotSqFt":([0-9.]+)/, info);
  const poolFlag = grab(/"hasPrivatePool":(true|false)/, t);
  // Markup is literally "<b>78 days</b> on Redfin" — the count and the unit share one <b>.
  const days = grab(/<b>(\d+) days?<\/b>\s*on Redfin/, html);

  // Price events: date | event | price, newest first.
  const history = [];
  const hre = /BasicTable__col date">([^<]{5,20})<\/div><div class="BasicTable__col event">([^<]{2,40})<\/div><div class="BasicTable__col price">\$?([\d,]*)/g;
  let h;
  while ((h = hre.exec(t))) history.push({ date: h[1], event: h[2], price: h[3] });

  // The pool amenity group is the authoritative signal, not the listing prose.
  const poolBlock = grab(/"groupTitle":"Pool Information"([\s\S]{0,1200}?)\]\}/, t) || '';
  const poolFeatures = (poolBlock.match(/"amenityValues":\[([^\]]*)\]/g) || [])
    .join(',').replace(/"amenityValues":\[|\]|"/g, '').split(',').filter(Boolean);

  return {
    url,
    address: grab(/∙\s*([^∙]+?),\s*(?:Placerville|Rescue|Shingle Springs)/, desc),
    status: grab(/^(For Sale|Sold|Pending|Contingent|Off Market|Coming Soon)/, desc),
    mls: grab(/MLS#\s*([0-9A-Za-z-]+)/, desc),
    beds: Number(grab(/"beds":([0-9.]+)/, info)) || Number(grab(/([\d.]+)\s*beds?,/, desc)) || null,
    baths: Number(grab(/"baths":([0-9.]+)/, info)) || Number(grab(/,\s*([\d.]+)\s*baths?/, desc)) || null,
    sqft: Number(grab(/"totalSqFt":([0-9.]+)/, info)) ||
          Number((grab(/([\d,]+)\s*sq\. ft\./, desc) || '').replace(/,/g, '')) || null,
    acres: lotSqFt ? Math.round((Number(lotSqFt) / SQFT_PER_ACRE) * 100) / 100 : null,
    pool: poolFlag === 'true',
    poolFeatures: [...new Set(poolFeatures)],
    price: Number((grab(/∙\s*\$([\d,]+)\s*∙/, desc) || '').replace(/,/g, '')) || null,
    yearBuilt: grab(/"yearBuilt":([0-9]{4})/, info) || grab(/"yearBuilt":([0-9]{4})/, t),
    broker: grab(/"brokerName":"([^"]{3,60})"/, t),
    photo: grab(/<meta property="og:image" content="([\s\S]*?)"/, html),
    daysOnMarket: days ? Number(days) : null,
    history: history.slice(0, 6),
  };
}

const qualifies = (d) =>
  d.status === 'For Sale' && d.pool &&
  d.acres != null && d.acres >= CRITERIA.minAcres &&
  d.price != null && d.price <= CRITERIA.maxPrice &&
  d.beds >= parseFloat(CRITERIA.beds) && d.baths >= parseFloat(CRITERIA.baths);

function main() {
  console.log(`Criteria: ${CRITERIA.beds}bd / ${CRITERIA.baths}ba / pool / ` +
              `${CRITERIA.minAcres}+ acres / <= $${CRITERIA.maxPrice.toLocaleString('en-US')}\n`);

  const candidates = new Map();
  for (const zip of ZIPS) {
    const { listings, cards } = parseSearch(
      fetchPage(`https://www.redfin.com/zipcode/${zip}/filter/${FILTER}`, `search_${zip}`));
    const inCity = [...listings.values()].filter((r) => CITIES.includes(r.city));
    console.log(`${zip}: ${cards} cards on page, ${listings.size} parsed, ${inCity.length} in target cities`);
    if (cards && listings.size < cards) {
      console.warn(`  ! ${cards - listings.size} homecards had no JSON-LD — parsing may be incomplete`);
    }
    for (const r of inCity) candidates.set(r.url, r);
  }

  console.log(`\n${candidates.size} in-city candidates; opening each for acreage + pool…\n`);
  const details = [];
  for (const url of candidates.keys()) {
    const html = fetchPage(url, 'd_' + url.split('/home/').pop());
    const fromCache = fetchPage.cached;
    if (!html) continue;
    const d = parseDetail(html, url);
    d.city = candidates.get(url).city;
    d.address = d.address || candidates.get(url).address;
    details.push(d);
    if (!fromCache) sleep(PAUSE_MS);
  }

  const matches = details.filter(qualifies);
  const nearMiss = details.filter((d) =>
    !d.pool && d.status === 'For Sale' && d.acres >= CRITERIA.minAcres);

  console.log(`\n=== ${matches.length} MATCH(ES) — pool + land + budget, active today ===`);
  for (const d of matches) {
    console.log(`\n  ${d.address}, ${d.city}  —  $${(d.price || 0).toLocaleString('en-US')}`);
    console.log(`    ${d.beds}bd/${d.baths}ba · ${d.sqft} sqft · ${d.acres} acres · MLS ${d.mls}` +
                `${d.yearBuilt ? ' · built ' + d.yearBuilt : ''}`);
    console.log(`    pool: ${d.poolFeatures.join(', ') || 'yes'}`);
    if (d.daysOnMarket) console.log(`    ${d.daysOnMarket} days on market`);
    if (d.history.length) {
      console.log(`    history: ${d.history.map((h) => `${h.date} ${h.event} $${h.price}`).join(' | ')}`);
    }
    console.log(`    ${d.url}`);
    if (d.photo) console.log(`    photo: ${d.photo}`);
  }

  console.log(`\n=== ${nearMiss.length} right land, no pool ===`);
  for (const d of nearMiss.sort((a, b) => (a.price || 0) - (b.price || 0))) {
    console.log(`  ${String(d.address).padEnd(24)} ${String(d.city).padEnd(16)} ` +
                `$${String((d.price || 0).toLocaleString('en-US')).padStart(10)}  ` +
                `${d.beds}/${d.baths}  ${d.acres} ac`);
  }

  const out = path.join(CACHE, 'run.json');
  fs.writeFileSync(out, JSON.stringify({ matches, nearMiss, all: details }, null, 1));
  console.log(`\nFull results: ${out}`);
  console.log('Merge into listings.json by hand, per the dedupe rules in README.md, then: node build.js');
}

main();
