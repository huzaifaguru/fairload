// Joins Food Bank of Delaware mobile-pantry records to ACS poverty counts by ZIP/ZCTA.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const raw = JSON.parse(fs.readFileSync(path.join(root, 'data/raw/fbd_mobile_pantries.json')));
const acs = JSON.parse(fs.readFileSync(path.join(root, 'data/raw/acs_de_zcta.json')));
const rows = raw.features.map(f => ({ ...f.attributes, lat: f.geometry?.y, lng: f.geometry?.x }));
const flag = process.argv.includes('--inspect');
if (flag) {
  const lb = rows.map(r => r.POUNDS_BOXES_DISTRIBUTED).filter(x => x != null).sort((a, b) => a - b);
  console.log('n', lb.length, 'p0-10', lb.slice(0, 16).map(x => +x.toFixed(1)).join(' '));
  console.log('top', lb.slice(-10).map(x => Math.round(x)).join(' '));
  const q = p => lb[Math.floor(p * (lb.length - 1))];
  console.log('quartiles', q(.25), q(.5), q(.75));
  console.log('low rows', rows.filter(r => (r.POUNDS_BOXES_DISTRIBUTED ?? 0) < 500).map(r => [r.PARTNER_NAME, r.ZIP_CODE, r.FAMILIES_SERVED, r.POUNDS_BOXES_DISTRIBUTED, r.QUARTER].join(' | ')));
  console.log('top rows', rows.sort((a, b) => b.POUNDS_BOXES_DISTRIBUTED - a.POUNDS_BOXES_DISTRIBUTED).slice(0, 6).map(r => [r.PARTNER_NAME, r.ZIP_CODE, r.FAMILIES_SERVED, Math.round(r.POUNDS_BOXES_DISTRIBUTED), r.QUARTER].join(' | ')));
  const lpf = rows.filter(r => +r.FAMILIES_SERVED > 0 && r.POUNDS_BOXES_DISTRIBUTED).map(r => r.POUNDS_BOXES_DISTRIBUTED / +r.FAMILIES_SERVED).sort((a, b) => a - b);
  console.log('lb/family n', lpf.length, 'min', lpf[0], 'med', lpf[lpf.length >> 1], 'max', lpf[lpf.length - 1]);
  console.log('dupes', rows.length - new Set(rows.map(r => r.PARTNER_NAME.trim() + r.QUARTER)).size, 'missing geom', rows.filter(r => r.lat == null).length, 'states', [...new Set(rows.map(r => r.STATE))]);
  console.log('zips outside ACS', [...new Set(rows.map(r => r.ZIP_CODE))].filter(z => !acs.data['86000US' + z]));
  const de = Object.entries(acs.data).map(([k, v]) => ({ z: k.slice(7), pop: v.B01003.estimate.B01003001, pov: v.B17001.estimate.B17001002, u: v.B17001.estimate.B17001001 }));
  console.log('ACS zctas', de.length, 'pop', de.reduce((s, d) => s + d.pop, 0), 'pov', de.reduce((s, d) => s + d.pov, 0));
}
module.exports = { rows, acs };
