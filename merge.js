#!/usr/bin/env node
/**
 * Merges a scraped run into listings.json.
 *
 * Input:  run.json  — array of records produced by the Redfin MetroList pull
 *                     (see README "Data pipeline"). Each record is a live,
 *                     status=Active MLS listing with a structured pool flag.
 * Output: listings.json — canonical store, with dedupe + price history applied.
 *
 * Dedupe contract (see README):
 *   - Already tracked and price unchanged  -> keep, refresh lastSeen, not "new".
 *   - Already tracked and price changed    -> append priceHistory, mark "priceChange".
 *   - Not tracked                          -> add, mark isNew.
 *   - Tracked but absent from this run     -> it left the active feed: move to
 *                                             `dropped` (sold / withdrawn / expired).
 */
const fs = require('fs');
const path = require('path');

const P = (f) => path.join(__dirname, f);
const store = JSON.parse(fs.readFileSync(P('listings.json'), 'utf8'));
const run = JSON.parse(fs.readFileSync(P(process.argv[2] || 'run.json'), 'utf8'));
const today = process.argv[3] || new Date().toISOString().slice(0, 10);

const slug = (a, c) =>
  `${a}-${c}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const prior = new Map((store.listings || []).map((l) => [l.id, l]));
const seenNow = new Set();

const listings = [];
const newIds = [];
const priceChanges = [];

for (const r of run) {
  const id = slug(r.addr, r.city);
  seenNow.add(id);
  const old = prior.get(id);

  const base = {
    id,
    address: r.addr,
    city: r.city,
    zip: r.zip,
    mls: r.mls,
    currentPrice: r.price,
    priceHistory: old ? old.priceHistory.slice() : [{ date: today, price: r.price }],
    beds: r.beds,
    baths: r.baths,
    sqft: r.sqft,
    acres: r.acres,
    yearBuilt: r.yr || null,
    daysOnMarket: r.dom == null ? null : Number(r.dom),
    pool: !!r.hasPrivatePool,
    poolDetail: r.poolDetail || null,
    poolFeatures: r.poolFeatures || null,
    hasSpa: r.hasSpa || false,
    photos: r.photos || [],
    poolPhotos: r.poolPhotos || [],
    remarks: r.remarks || null,
    agent: r.agent || null,
    broker: r.broker || null,
    lat: r.lat ? Number(r.lat) : null,
    lon: r.lon ? Number(r.lon) : null,
    source: 'Redfin / MetroList MLS',
    status: 'match',
    gallery: r.url,
    url: r.url,
    firstSeen: old ? old.firstSeen : today,
    lastSeen: today,
    isNew: !old,
    priceChange: null,
  };

  if (old) {
    if (old.currentPrice !== r.price) {
      base.priceHistory.push({ date: today, price: r.price });
      base.priceChange = { from: old.currentPrice, to: r.price, date: today };
      priceChanges.push(base);
    }
  } else {
    newIds.push(id);
  }
  listings.push(base);
}

// Anything previously tracked as a match that is no longer in the active feed
// has sold or come off market. Drop it from the board, remember it so a relist
// is recognised rather than reported as brand new.
const dropped = (store.dropped || []).slice();
for (const [id, l] of prior) {
  if (seenNow.has(id)) continue;
  dropped.push({
    id,
    address: l.address,
    city: l.city,
    lastPrice: l.currentPrice,
    beds: l.beds,
    baths: l.baths,
    acres: l.acres,
    priorStatus: l.status,
    droppedOn: today,
    reason:
      l.status === 'match'
        ? 'No longer in the active MLS feed — sold, withdrawn or expired'
        : (l.notes || 'No longer active'),
    url: l.url,
  });
}

store.criteria = {
  beds: '4+',
  baths: '3+',
  pool: true,
  cities: ['Shingle Springs, CA', 'Rescue, CA', 'Placerville, CA'],
  minAcres: 2.5,
  preferredAcres: 5,
  maxPrice: 1500000,
};
store.lastRun = today;
store.listings = listings.sort((a, b) => {
  if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
  return (b.acres || 0) - (a.acres || 0);
});
store.dropped = dropped;
store.runSummary = {
  date: today,
  newCount: newIds.length,
  priceChangeCount: priceChanges.length,
  totalMatches: listings.length,
  droppedThisRun: dropped.filter((d) => d.droppedOn === today).length,
};

fs.writeFileSync(P('listings.json'), JSON.stringify(store, null, 2) + '\n');
console.log(
  `matches=${listings.length} new=${newIds.length} priceChanges=${priceChanges.length} ` +
  `dropped=${store.runSummary.droppedThisRun}`
);
if (newIds.length) console.log('NEW: ' + newIds.join(', '));
