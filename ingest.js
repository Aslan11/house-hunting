#!/usr/bin/env node
/**
 * Ingest listings pasted straight from a Zillow/Redfin search results page.
 *
 *   node ingest.js paste.txt        # from a file
 *   pbpaste | node ingest.js        # from stdin
 *
 * Applies the dedupe rules from README automatically:
 *   - address already known, same price  -> skipped as duplicate
 *   - address already known, new price   -> priceHistory appended, flagged
 *   - new address                        -> added
 *
 * Then run `node build.js` to regenerate index.html.
 *
 * Handles the shape Zillow cards copy as, in any order within a block:
 *   $1,250,000
 *   5 bds | 4 ba | 3,500 sqft - House for sale
 *   4100 Black Oak Dr, Shingle Springs, CA 95682
 *   https://www.zillow.com/homedetails/...
 *   https://photos.zillowstatic.com/....jpg      <- optional, becomes the card photo
 *
 * Blocks are separated by blank lines, or inferred from each price line.
 */
const fs = require('fs');
const path = require('path');

const STORE = path.join(__dirname, 'listings.json');
const CITIES = ['shingle springs', 'rescue', 'placerville'];

const raw = process.argv[2]
  ? fs.readFileSync(process.argv[2], 'utf8')
  : fs.readFileSync(0, 'utf8');

/* Split into blocks: blank lines, or a new price line starting a new record. */
function blocks(text) {
  const out = [];
  let cur = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) { if (cur.length) { out.push(cur); cur = []; } continue; }
    if (/^\$[\d,]+$/.test(t) && cur.some((l) => /^\$[\d,]+$/.test(l))) {
      out.push(cur); cur = [t]; continue;
    }
    cur.push(t);
  }
  if (cur.length) out.push(cur);
  return out;
}

const num = (s) => (s == null ? null : Number(String(s).replace(/[^\d.]/g, '')));

function parse(lines) {
  const joined = lines.join('\n');
  const r = { photos: [] };

  const price = joined.match(/\$([\d,]{4,})/);
  if (price) r.currentPrice = num(price[1]);

  const beds = joined.match(/(\d+(?:\.\d+)?)\s*(?:bds?|beds?|bedrooms?)\b/i);
  if (beds) r.beds = num(beds[1]);

  const baths = joined.match(/(\d+(?:\.\d+)?)\s*(?:ba\b|baths?|bathrooms?)/i);
  if (baths) r.baths = num(baths[1]);

  const sqft = joined.match(/([\d,]{3,})\s*(?:sqft|sq\.?\s*ft)/i);
  if (sqft) r.sqft = num(sqft[1]);

  const acres = joined.match(/([\d.]+)\s*acres?\b/i);
  if (acres) r.acres = num(acres[1]);
  else {
    const lot = joined.match(/([\d,]{4,})\s*(?:sqft|sq\.?\s*ft)\s*lot/i);
    if (lot) r.acres = Math.round((num(lot[1]) / 43560) * 100) / 100;
  }

  for (const m of joined.matchAll(/https?:\/\/\S+/g)) {
    const u = m[0].replace(/[),.]+$/, '');
    if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(u)) r.photos.push(u);
    else if (!r.url) r.url = u;
  }

  const addr = lines.find((l) =>
    /,\s*(CA|California)\b/i.test(l) && /\d/.test(l) && !/^\$/.test(l));
  if (addr) {
    const m = addr.match(/^(.+?),\s*([^,]+),\s*(?:CA|California)\s*(\d{5})?/i);
    if (m) {
      r.address = m[1].trim();
      r.city = m[2].trim();
      r.zip = m[3] || '';
    }
  }

  r.pool = /\bpool\b/i.test(joined) && !/no pool/i.test(joined);
  return r;
}

const slug = (r) =>
  `${r.address} ${r.city}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ---- merge ---- */
const store = JSON.parse(fs.readFileSync(STORE, 'utf8'));
const today = new Date().toISOString().slice(0, 10);
const byId = new Map(store.listings.map((l) => [l.id, l]));

const added = [], repriced = [], dupes = [], skipped = [];

for (const b of blocks(raw)) {
  const r = parse(b);
  if (!r.address || !r.currentPrice) { skipped.push(b.join(' / ').slice(0, 70)); continue; }
  if (!CITIES.includes((r.city || '').toLowerCase())) {
    skipped.push(`${r.address} — ${r.city} not in target cities`);
    continue;
  }

  const id = slug(r);
  const existing = byId.get(id);

  if (!existing) {
    const rec = {
      id, address: r.address, city: r.city, zip: r.zip, mls: null,
      currentPrice: r.currentPrice,
      priceHistory: [{ date: today, price: r.currentPrice }],
      beds: r.beds ?? null, baths: r.baths ?? null,
      sqft: r.sqft ?? null, acres: r.acres ?? null,
      pool: r.pool, poolDetail: r.pool ? 'Pool' : 'No pool',
      photos: r.photos, gallery: r.url || null,
      status: 'match', firstSeen: today, lastSeen: today,
      notes: 'Ingested from a pasted search result — status taken from the live portal listing.',
      url: r.url || null,
    };
    const fails = [];
    if (rec.beds  != null && rec.beds  < 5)   fails.push(`${rec.beds}BR`);
    if (rec.baths != null && rec.baths < 3)   fails.push(`${rec.baths}BA`);
    if (rec.acres != null && rec.acres < 2.5) fails.push(`${rec.acres}ac`);
    if (rec.currentPrice > store.criteria.maxPrice) fails.push('over budget');
    if (!rec.pool) fails.push('no pool');
    if (fails.length) {
      rec.status = 'active-fails-criteria';
      rec.badge = `Active — ${fails.join(', ')}`;
    }
    store.listings.push(rec);
    byId.set(id, rec);
    added.push(`${rec.address}, ${rec.city} — $${rec.currentPrice.toLocaleString()}` +
               (fails.length ? `  [${fails.join(', ')}]` : '  [matches criteria]'));
  } else if (existing.currentPrice !== r.currentPrice) {
    const from = existing.currentPrice;
    existing.priceHistory.push({ date: today, price: r.currentPrice });
    existing.currentPrice = r.currentPrice;
    existing.lastSeen = today;
    if (r.photos.length && !existing.photos?.length) existing.photos = r.photos;
    repriced.push(`${existing.address} — $${from?.toLocaleString()} → $${r.currentPrice.toLocaleString()}`);
  } else {
    existing.lastSeen = today;
    if (r.photos.length && !existing.photos?.length) existing.photos = r.photos;
    dupes.push(existing.address);
  }
}

store.lastRun = today;
store.dataQuality = {
  verifiedActiveListings: store.listings.filter((l) => l.status === 'match').length,
  note: 'Listings ingested from pasted portal results are treated as verified-active as of lastRun.',
};
fs.writeFileSync(STORE, JSON.stringify(store, null, 2) + '\n');

const say = (label, arr) => { if (arr.length) console.log(`\n${label}\n  ` + arr.join('\n  ')); };
say(`NEW (${added.length})`, added);
say(`PRICE CHANGES (${repriced.length})`, repriced);
say(`ALREADY TRACKED (${dupes.length}) — not re-reported`, dupes);
say(`SKIPPED (${skipped.length})`, skipped);
console.log(`\nWrote listings.json. Now run: node build.js`);
