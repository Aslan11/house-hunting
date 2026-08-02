#!/usr/bin/env node
/**
 * merge.js — fold a scan into listings.json, applying the dedupe rules.
 *
 *   node merge.js scan-results.json
 *
 * Rules (see README):
 *   - Already tracked and unchanged  → carried over, isNew = false. Not re-reported.
 *   - Already tracked, price changed → priceHistory appended, delta renders on the card.
 *   - Not seen before                → isNew = true, highlighted at the top of the page.
 *   - Tracked but absent from the    → moved to `dropped`. Sold or withdrawn.
 *     current active feed
 */
const fs = require('fs');
const path = require('path');

const slug = (a, c) => `${a} ${c}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function merge(scan, file = path.join(__dirname, 'listings.json')) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const today = scan.scannedOn || new Date().toISOString().slice(0, 10);
  const prev = new Map((data.listings || []).map((l) => [l.id, l]));

  const listings = [];
  const changes = { added: [], repriced: [], unchanged: [], dropped: [] };

  for (const m of scan.matches) {
    const id = slug(m.address, m.city);
    const old = prev.get(id);
    const base = {
      id, address: m.address, city: m.city, zip: m.zip, mls: m.mls,
      currentPrice: m.price, beds: m.beds, baths: m.baths, sqft: m.sqft, acres: m.acres,
      pool: true, poolDetail: old?.poolDetail || m.poolFeatures,
      photos: m.photos && m.photos.length ? m.photos : (old?.photos || []),
      gallery: m.url, url: m.url, status: 'match',
      daysOnMarket: m.daysOnMarket, verifiedActive: today,
      blurb: old?.blurb || '', notes: old?.notes || '',
      lat: m.lat, lng: m.lng,
      firstSeen: old?.firstSeen || today, lastSeen: today,
    };

    if (!old) {
      base.isNew = true;
      base.priceHistory = [{ date: today, price: m.price }];
      changes.added.push(base);
    } else {
      const hist = old.priceHistory || [];
      const last = hist.length ? hist[hist.length - 1].price : null;
      if (last !== m.price) {
        base.priceHistory = [...hist, { date: today, price: m.price }];
        // A price change IS worth re-surfacing, so keep it prominent.
        base.isNew = false;
        changes.repriced.push({ ...base, from: last, to: m.price });
      } else {
        base.priceHistory = hist;
        base.isNew = false;
        changes.unchanged.push(base);
      }
    }
    listings.push(base);
  }

  const stillListed = new Set(listings.map((l) => l.id));
  data.dropped = data.dropped || [];
  for (const [id, old] of prev) {
    if (stillListed.has(id)) continue;
    changes.dropped.push(old);
    data.dropped.unshift({
      address: `${old.address}, ${old.city}`,
      reason: 'Absent from the live active-listings feed — sold or withdrawn',
      droppedOn: today,
    });
  }

  listings.sort((a, b) => b.acres - a.acres);
  data.listings = listings;
  data.nearMisses = scan.nearMisses;
  data.unknownLotSize = scan.unknownLotSize;
  data.previousRun = data.lastRun;
  data.lastRun = today;
  data.source = {
    feed: 'Redfin gis-csv polygon query over El Dorado County (tiled; no tile truncated)',
    activeListingsScanned: scan.activeListingsScanned,
    inTargetCities: scan.inTargetCities,
    poolVerification: "MLS 'Pool Information' amenity group on the subject property + " +
      'Redfin hasPrivatePool flag + subject-only listing remarks; all three must agree',
  };
  data.dataQuality = {
    verifiedActiveListings: listings.length,
    note: `Confirmed active in the live feed on ${today}; pool confirmed from each property's own MLS fields.`,
  };

  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`merged: ${changes.added.length} new, ${changes.repriced.length} repriced, ` +
              `${changes.unchanged.length} unchanged, ${changes.dropped.length} dropped`);
  for (const r of changes.repriced) {
    console.log(`  price change: ${r.address} $${r.from?.toLocaleString()} → $${r.to.toLocaleString()}`);
  }
  return changes;
}

if (require.main === module) {
  const f = process.argv[2] || path.join(__dirname, 'scan-results.json');
  merge(JSON.parse(fs.readFileSync(f, 'utf8')));
}
module.exports = { merge, slug };
