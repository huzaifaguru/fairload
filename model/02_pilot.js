// Pilot: re-allocate the same pounds, within the same estimated truck-mile budget,
// to lift the worst-served ZIP. Scope: Food Bank of Delaware MOBILE PANTRY records only.
const fs = require('fs'), path = require('path');
const { rows, acs } = require('./01_prepare.js');
const highsLoader = require('../app/node_modules/highs');

const HUBS = { newark: [39.62, -75.70], milford: [38.91, -75.43] }; // approximate facility coordinates
const CIRCUITY = 1.3;   // ASSUMPTION: road miles / straight-line miles
const TRUCK_LB = 20000; // ASSUMPTION: pounds per truckload
const MIN_POOR = 100;   // ZIPs with fewer people in poverty have unstable ratios
const hav = (a, b) => {
  const R = 3958.8, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dg = (b[1] - a[1]) * r;
  const s = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dg / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

// --- cleaning: every exclusion is recorded
const excl = [];
const seen = new Set();
const clean = rows.filter(r => {
  const lb = r.POUNDS_BOXES_DISTRIBUTED, id = r.PARTNER_NAME.trim();
  if (lb == null) { excl.push([id, 'missing value']); return false; }
  if (lb < 100) { excl.push([id, `implausible value ${lb}`]); return false; }
  if (/Mass Dist/i.test(id)) { excl.push([id, `one-off mass event ${Math.round(lb)} lb`]); return false; }
  const k = [id, r.QUARTER, lb].join('|');
  if (seen.has(k)) { excl.push([id, 'exact duplicate']); return false; }
  seen.add(k);
  return true;
});

// --- aggregate to ZIP
const Z = {};
for (const r of clean) {
  const z = String(r.ZIP_CODE);
  const o = (Z[z] ??= { zip: z, city: r.CITY, lbs: 0, sites: new Set(), latS: 0, lngS: 0, n: 0 });
  o.lbs += r.POUNDS_BOXES_DISTRIBUTED; o.sites.add(r.PARTNER_NAME.trim()); o.latS += r.lat; o.lngS += r.lng; o.n++;
}
const acsOf = z => {
  const v = acs.data['86000US' + z];
  return v && { pop: v.B01003.estimate.B01003001, poor: v.B17001.estimate.B17001002 };
};
const all = Object.values(Z).map(o => ({ ...o, sites: o.sites.size, lat: o.latS / o.n, lng: o.lngS / o.n, ...acsOf(o.zip) }));
const zs = all.filter(o => o.poor >= MIN_POOR);
const dropped = all.filter(o => o.poor < MIN_POOR);
zs.forEach(o => {
  o.cov = o.lbs / o.poor;
  const dn = hav([o.lat, o.lng], HUBS.newark), dm = hav([o.lat, o.lng], HUBS.milford);
  o.hub = dn < dm ? 'newark' : 'milford';
  o.dist = Math.min(dn, dm) * CIRCUITY; o.dN = dn * CIRCUITY; o.dM = dm * CIRCUITY;
});
const sum = (a, f) => a.reduce((s, x, i) => s + f(x, i), 0);
const LB = sum(zs, o => o.lbs), POOR = sum(zs, o => o.poor), AVG = LB / POOR;
const hubLb = {
  newark: sum(zs.filter(o => o.hub === 'newark'), o => o.lbs),
  milford: sum(zs.filter(o => o.hub === 'milford'), o => o.lbs),
};
const MILES = sum(zs, o => o.lbs / TRUCK_LB * o.dist * 2);

const stats = c => {
  const s = [...c].sort((a, b) => a - b);
  const low = zs.filter((o, i) => c[i] < 0.5 * AVG);
  return { worst: s[0], p10: s[Math.floor(0.1 * s.length)], med: s[s.length >> 1], best: s[s.length - 1], under50: low.length, poorUnder50: sum(low, o => o.poor) };
};

function buildLP(delta, floorT) {
  // x_h_i = pounds hub h -> zip i ; t = worst coverage ; s_i = shortfall below the average
  const H = ['newark', 'milford'], L = [];
  const xs = i => H.map(h => `x_${h}_${i}`);
  L.push(floorT == null ? 'Maximize' : 'Minimize');
  L.push(floorT == null ? 'obj: t' : 'obj: ' + zs.map((o, i) => `${(o.poor / POOR).toFixed(8)} s_${i}`).join(' + '));
  L.push('Subject To');
  H.forEach(h => L.push(`hub_${h}: ` + zs.map((o, i) => `x_${h}_${i}`).join(' + ') + ` <= ${hubLb[h].toFixed(3)}`));
  L.push('total: ' + zs.flatMap((o, i) => xs(i)).join(' + ') + ` = ${LB.toFixed(3)}`);
  L.push('miles: ' + zs.flatMap((o, i) => H.map(h => `${(2 * (h === 'newark' ? o.dN : o.dM) / TRUCK_LB).toFixed(8)} x_${h}_${i}`)).join(' + ') + ` <= ${(MILES * 1.000001).toFixed(3)}`);
  zs.forEach((o, i) => {
    const lhs = xs(i).join(' + ');
    L.push(`lo_${i}: ${lhs} >= ${(o.lbs * (1 - delta)).toFixed(3)}`);
    L.push(`hi_${i}: ${lhs} <= ${(o.lbs * (1 + delta)).toFixed(3)}`);
    if (floorT == null) L.push(`worst_${i}: ${lhs} - ${o.poor} t >= 0`);
    else {
      L.push(`fl_${i}: ${lhs} >= ${(floorT * o.poor * 0.999999).toFixed(3)}`);
      L.push(`sh_${i}: ${(1 / o.poor).toFixed(10)} ${xs(i)[0]} + ${(1 / o.poor).toFixed(10)} ${xs(i)[1]} + s_${i} >= ${AVG.toFixed(6)}`);
    }
  });
  L.push('End');
  return L.join('\n');
}

(async () => {
  const highs = await highsLoader();
  const results = [{ delta: 0, ...stats(zs.map(o => o.cov)), miles: MILES, moved: 0 }];
  let keep;
  for (const delta of [0.1, 0.25, 0.5, 1]) {
    const t0 = performance.now();
    const a = highs.solve(buildLP(delta));
    if (a.Status !== 'Optimal') throw new Error(a.Status + ' stage1 ' + delta);
    const b = highs.solve(buildLP(delta, a.Columns.t.Primal));
    if (b.Status !== 'Optimal') throw new Error(b.Status + ' stage2 ' + delta);
    const ms = performance.now() - t0;
    const xn = i => b.Columns[`x_newark_${i}`].Primal, xm = i => b.Columns[`x_milford_${i}`].Primal;
    const x = zs.map((o, i) => xn(i) + xm(i));
    const mi = sum(zs, (o, i) => 2 * (xn(i) * o.dN + xm(i) * o.dM) / TRUCK_LB);
    const moved = sum(zs, (o, i) => Math.max(0, x[i] - o.lbs));
    results.push({ delta, ...stats(x.map((v, i) => v / zs[i].poor)), miles: mi, moved, ms: Math.round(ms), total: sum(x, v => v) });
    if (delta === 0.25) keep = x;
  }
  const served = new Set(rows.map(r => String(r.ZIP_CODE)));
  const unserved = Object.entries(acs.data)
    .map(([k, v]) => ({ zip: k.slice(7), poor: v.B17001.estimate.B17001002 }))
    .filter(o => !served.has(o.zip)).sort((a, b) => b.poor - a.poor);
  const out = {
    excluded: excl, nZipModel: zs.length, droppedSmall: dropped.map(o => o.zip), lb: LB, poor: POOR, avg: AVG,
    milesBase: MILES, hubLb, results, assumptions: { CIRCUITY, TRUCK_LB, MIN_POOR, HUBS },
    zips: zs.map((o, i) => ({ zip: o.zip, city: o.city, lbs: Math.round(o.lbs), poor: o.poor, cov: +o.cov.toFixed(1), hub: o.hub, sites: o.sites, lat: +o.lat.toFixed(4), lng: +o.lng.toFixed(4), x25: Math.round(keep[i]) })).sort((a, b) => a.cov - b.cov),
    unservedTop: unserved.slice(0, 12), unservedPoor: sum(unserved, o => o.poor), unservedN: unserved.length,
    statePoor: sum(Object.values(acs.data), v => v.B17001.estimate.B17001002),
  };
  fs.mkdirSync(path.join(__dirname, '../data/processed'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '../data/processed/pilot.json'), JSON.stringify(out, null, 1));
  console.log('excluded', excl);
  console.log('zips', zs.length, 'dropped', dropped.map(o => `${o.zip}(${o.poor})`).join(','), 'lb', Math.round(LB), 'poor', POOR, 'avg lb/poor', AVG.toFixed(1), 'miles', Math.round(MILES), hubLb);
  console.table(results.map(r => ({ delta: r.delta, worst: +r.worst.toFixed(1), p10: +r.p10.toFixed(1), med: +r.med.toFixed(1), best: +r.best.toFixed(1), under50: r.under50, poorUnder50: r.poorUnder50, miles: Math.round(r.miles), moved: Math.round(r.moved), total: r.total && Math.round(r.total), ms: r.ms })));
  console.log('lowest', out.zips.slice(0, 8).map(o => `${o.zip} ${o.city} ${o.cov} lb/poor (${o.poor} poor, ${o.lbs} lb)`));
  console.log('highest', out.zips.slice(-6).map(o => `${o.zip} ${o.city} ${o.cov} (${o.poor}, ${o.lbs})`));
  console.log('unserved', out.unservedN, 'poor', out.unservedPoor, 'of', out.statePoor, out.unservedTop.slice(0, 8));
})();
