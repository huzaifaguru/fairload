// Writes the data file the app and validation use. Everything here comes from public records
// except hub coordinates and road circuity, which are approximate and disclosed.
const fs = require('fs'), path = require('path');
const { rows, acs } = require('./01_prepare.js');
const P = require('../data/processed/pilot.json');
const hav = (a, b) => { const R = 3958.8, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dg = (b[1] - a[1]) * r;
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dg / 2) ** 2)); };
const CIRC = 1.3;
const hubs = [{ id: 'newark', name: 'Newark', lat: 39.62, lng: -75.70 }, { id: 'milford', name: 'Milford', lat: 38.91, lng: -75.43 }];
const lb = rows.map(r => r.POUNDS_BOXES_DISTRIBUTED).filter(v => v != null && v >= 100 && v < 90000).sort((a, b) => a - b);
const p75 = lb[Math.floor(lb.length * 0.75)];
const zips = P.zips.map(z => {
  const pop = acs.data['86000US' + z.zip].B01003.estimate.B01003001;
  return { zip: z.zip, city: z.city, lat: z.lat, lng: z.lng, poor: z.poor, pop, sites: z.sites, lbs: z.lbs, dist: hubs.map(h => +(hav([z.lat, z.lng], [h.lat, h.lng]) * CIRC).toFixed(2)) };
});
const out = { totalLb: P.lb, hubs, zips, siteWeeklyP75: +(p75 / 13).toFixed(1), recordP75: p75, smallestKeptRecord: lb[0], unserved: P.unservedTop, unservedN: P.unservedN, unservedPoor: P.unservedPoor, statePoor: P.statePoor,
  source: 'Food Bank of Delaware Mobile Pantries Q1-Q2 FY25 (FirstMap Delaware); ACS 2020-2024 5-year B17001, B01003 via Census Reporter' };
fs.writeFileSync(path.join(__dirname, '../app/src/core/data.json'), JSON.stringify(out));
console.log('zips', zips.length, 'p75', p75, 'site weekly', out.siteWeeklyP75, 'smallest', lb[0]);
