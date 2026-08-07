/**
 * Second-opinion listing status, from Redfin's gis-csv feed.
 *
 * WHY THIS EXISTS
 * ---------------
 * The primary IDX feed (coldwellbankerhomes.com) goes stale on listings that have
 * gone into escrow, and it goes stale in the direction that costs the most: it keeps
 * reporting them as Active. Both the `IsActive` boolean *and* the visible `Status:`
 * field can say Active on a property MetroList already has as Pending.
 *
 * This has now cost two consecutive runs, both on the same property:
 *   2026-08-02  3033 Ridgeline Dr and 1988 Cold Springs Rd carried as Active matches.
 *   2026-08-03  1988 Cold Springs Rd carried as Active again — and, because it had been
 *               dropped the previous run, it came back reported as a NEW match.
 *
 * On both runs the only thing that caught it was a second feed disagreeing. Encoding
 * that check here makes it part of the pipeline instead of something a run has to
 * remember to do by hand.
 *
 * WHAT IT DOES
 * ------------
 * Pulls Redfin's pending/contingent set (`status=130`) over the same tiled bounding box
 * `crosscheck.js` uses, and indexes it by normalised street address. `scrape.js` demotes
 * any match the IDX feed calls Active that turns up in this index.
 *
 * This is a positive signal, not an absence-of-evidence one: the property is asserted
 * Pending by a live feed. That distinction matters, because Redfin fetches fail often
 * enough (throttling) that treating "missing from the active feed" as proof of escrow
 * would demote healthy listings whenever the network hiccuped.
 */
const { execFileSync } = require('child_process');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const NUM_HOMES = 350;                                              // server cap per request
const BOX = { west: -121.05, east: -120.70, south: 38.55, north: 38.85 };
const COLS = 4, ROWS = 3;

/**
 * A gis-csv response is judged by its *shape*, not its size.
 *
 * This used to accept a body only when it exceeded 2000 bytes, which silently broke the
 * pending sweep. The active set is dense, so its tiles always cleared that bar; the
 * pending set is perhaps a tenth the size, so a legitimate tile carrying three or four
 * listings comes back at ~1.3KB and was read as a failed fetch. After four retries
 * `curl()` returned '' and the tile contributed nothing — no error, no warning, and
 * `pendingIdxOk` still true. A sweep that reports itself complete while missing whole
 * tiles is the worst available outcome here: it is exactly the guard from trap 6, and it
 * would pass a property that is actually in escrow straight through to the match list.
 *
 * The header row is the real signal of a good response. An empty body, an HTML block
 * page or a 202 stub has no header; a valid tile with zero listings does.
 */
const CSV_HEADER = 'SALE TYPE,SOLD DATE,PROPERTY TYPE,ADDRESS';

function curl(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      // No --compressed: it makes www.redfin.com answer 202 with an empty body.
      const out = execFileSync('curl', [
        '-sS', '-m', '60', '-L', '-A', UA,
        '-H', 'Accept-Language: en-US,en;q=0.9',
        url,
      ], { maxBuffer: 1 << 28 }).toString('utf8');
      if (out.startsWith(CSV_HEADER)) return out;
    } catch (e) { /* retry */ }
    const wait = 4 * 2 ** i;
    process.stderr.write(`  retry in ${wait}s…\n`);
    execFileSync('sleep', [String(wait)]);
  }
  return '';
}

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

function tileUrl(w, e, s, n, status) {
  const poly = [[w, s], [e, s], [e, n], [w, n], [w, s]]
    .map(([x, y]) => `${x} ${y}`).join(',');
  return 'https://www.redfin.com/stingray/api/gis-csv?al=1&market=sacramento' +
    `&num_homes=${NUM_HOMES}&ord=redfin-recommended-asc&page_number=1` +
    `&poly=${encodeURIComponent(poly)}` +
    `&sf=1,2,3,5,6,7&status=${status}&uipt=1,2,3,4,5,6&v=8`;
}

/**
 * Normalise a street address for cross-feed comparison. The two feeds disagree on
 * street-suffix spelling ("Road" vs "Rd", "Trail" vs "Trl"), which is the same drift
 * that made a previous run report 9 new and 9 dropped against unchanged inventory.
 */
const SUFFIX = {
  road: 'rd', street: 'st', drive: 'dr', lane: 'ln', court: 'ct', circle: 'cir',
  trail: 'trl', avenue: 'ave', place: 'pl', boulevard: 'blvd', way: 'way',
  terrace: 'ter', parkway: 'pkwy', highway: 'hwy',
};

function normAddr(street, city) {
  const s = String(street || '')
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => SUFFIX[w] || w)
    .join(' ');
  return `${s}|${String(city || '').toLowerCase().trim()}`;
}

/**
 * Returns a Map of normalised address -> { status, mls, price, address, city }
 * for every listing Redfin reports in the given status set.
 *
 * Throws if any tile came back at the row cap, because a silently truncated sweep
 * would produce false "not pending" answers — the exact failure this guards against.
 */
function statusIndex(status = '130') {
  const seen = new Map();
  const truncated = [];
  const unfetched = [];
  const dw = (BOX.east - BOX.west) / COLS;
  const dh = (BOX.north - BOX.south) / ROWS;
  for (let i = 0; i < COLS; i++) {
    for (let j = 0; j < ROWS; j++) {
      const w = BOX.west + i * dw, e = w + dw;
      const s = BOX.south + j * dh, n = s + dh;
      const body = curl(tileUrl(w, e, s, n, status));
      // A tile that never came back is not the same fact as a tile with no listings,
      // and must not be allowed to look like one. Absence here reads downstream as
      // "not pending", so an unfetched tile has to fail the whole sweep.
      if (!body) { unfetched.push(`${w.toFixed(3)},${s.toFixed(2)}`); continue; }
      const rows = parseCsv(body);
      if (rows.length >= NUM_HOMES) truncated.push(`${w.toFixed(3)},${s.toFixed(2)}`);
      for (const r of rows) {
        if (!r.ADDRESS) continue;
        seen.set(normAddr(r.ADDRESS, r.CITY), {
          status: r.STATUS, mls: r['MLS#'], price: r.PRICE,
          address: r.ADDRESS, city: r.CITY,
        });
      }
    }
  }
  if (truncated.length) {
    throw new Error(
      `Redfin status=${status} tiles hit the ${NUM_HOMES}-row cap: ${truncated.join('; ')}. ` +
      `Raise COLS/ROWS in mls-status.js — the sweep would otherwise be silently incomplete.`);
  }
  if (unfetched.length) {
    throw new Error(
      `Redfin status=${status} tiles could not be fetched: ${unfetched.join('; ')}. ` +
      `Treating the sweep as unavailable rather than as evidence nothing is pending.`);
  }
  return seen;
}

module.exports = { statusIndex, normAddr, curl, parseCsv };
