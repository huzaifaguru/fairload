// Stress test of the pilot headline: threshold choice, hub location, cleaning choices, and a no-optimizer baseline.
const { rows, acs } = require('./01_prepare.js');
const highsLoader = require('../app/node_modules/highs');
const hav = (a, b) => { const R = 3958.8, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dg = (b[1] - a[1]) * r;
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dg / 2) ** 2)); };
const sum = (a, f) => a.reduce((s, x, i) => s + f(x, i), 0);

function setup({ hubs = { n: [39.62, -75.70], m: [38.91, -75.43] }, keepMass = false, minPoor = 100, circ = 1.3, truck = 20000 }) {
  const seen = new Set(), Z = {};
  for (const r of rows) {
    const lb = r.POUNDS_BOXES_DISTRIBUTED, id = r.PARTNER_NAME.trim(), k = [id, r.QUARTER, lb].join('|');
    if (lb == null || lb < 100 || (!keepMass && /Mass Dist/i.test(id)) || seen.has(k)) continue;
    seen.add(k);
    const o = (Z[r.ZIP_CODE] ??= { zip: String(r.ZIP_CODE), lbs: 0, a: 0, b: 0, n: 0 });
    o.lbs += lb; o.a += r.lat; o.b += r.lng; o.n++;
  }
  const zs = Object.values(Z).map(o => ({ ...o, poor: acs.data['86000US' + o.zip].B17001.estimate.B17001002 })).filter(o => o.poor >= minPoor);
  zs.forEach(o => { const p = [o.a / o.n, o.b / o.n]; o.dn = hav(p, hubs.n) * circ; o.dm = hav(p, hubs.m) * circ; o.near = o.dn < o.dm ? 'n' : 'm'; o.d = Math.min(o.dn, o.dm); });
  const LB = sum(zs, o => o.lbs), POOR = sum(zs, o => o.poor);
  return { zs, LB, POOR, AVG: LB / POOR, truck, hubN: sum(zs.filter(o => o.near === 'n'), o => o.lbs), hubM: sum(zs.filter(o => o.near === 'm'), o => o.lbs), MILES: sum(zs, o => o.lbs / truck * o.d * 2) };
}
function lp(S, delta, t) {
  const { zs, truck } = S, L = [t == null ? 'Maximize' : 'Minimize', t == null ? 'obj: t' : 'obj: ' + zs.map((o, i) => `${(o.poor / S.POOR).toFixed(8)} s${i}`).join(' + '), 'Subject To'];
  L.push('hn: ' + zs.map((o, i) => `xn${i}`).join(' + ') + ` <= ${S.hubN.toFixed(3)}`, 'hm: ' + zs.map((o, i) => `xm${i}`).join(' + ') + ` <= ${S.hubM.toFixed(3)}`);
  L.push('tot: ' + zs.map((o, i) => `xn${i} + xm${i}`).join(' + ') + ` = ${S.LB.toFixed(3)}`);
  L.push('mi: ' + zs.map((o, i) => `${(2 * o.dn / truck).toFixed(8)} xn${i} + ${(2 * o.dm / truck).toFixed(8)} xm${i}`).join(' + ') + ` <= ${(S.MILES * 1.000001).toFixed(3)}`);
  zs.forEach((o, i) => {
    L.push(`lo${i}: xn${i} + xm${i} >= ${(o.lbs * (1 - delta)).toFixed(3)}`, `hi${i}: xn${i} + xm${i} <= ${(o.lbs * (1 + delta)).toFixed(3)}`);
    if (t == null) L.push(`w${i}: xn${i} + xm${i} - ${o.poor} t >= 0`);
    else L.push(`f${i}: xn${i} + xm${i} >= ${(t * o.poor * 0.999999).toFixed(3)}`, `sh${i}: ${(1 / o.poor).toFixed(10)} xn${i} + ${(1 / o.poor).toFixed(10)} xm${i} + s${i} >= ${S.AVG.toFixed(6)}`);
  });
  L.push('End'); return L.join('\n');
}
const metrics = (S, x) => {
  const { zs, AVG, POOR } = S, c = x.map((v, i) => v / zs[i].poor), under = f => sum(zs.filter((o, i) => c[i] < f * AVG), o => o.poor);
  const sorted = [...c].sort((a, b) => a - b);
  return { u40: under(0.4), u50: under(0.5), u60: under(0.6), u75: under(0.75), zipsU50: zs.filter((o, i) => c[i] < 0.5 * AVG).length, worst: +sorted[0].toFixed(2), wShort: +(sum(zs, (o, i) => o.poor * Math.max(0, AVG - c[i])) / POOR).toFixed(2), moved: Math.round(sum(zs, (o, i) => Math.max(0, x[i] - o.lbs))) };
};
(async () => {
  const highs = await highsLoader();
  const solve = (S, d) => { const a = highs.solve(lp(S, d)); if (a.Status !== 'Optimal') return null; const b = highs.solve(lp(S, d, a.Columns.t.Primal)); if (b.Status !== 'Optimal') return null;
    return { x: S.zs.map((o, i) => b.Columns[`xn${i}`].Primal + b.Columns[`xm${i}`].Primal), mi: sum(S.zs, (o, i) => 2 * (b.Columns[`xn${i}`].Primal * o.dn + b.Columns[`xm${i}`].Primal * o.dm) / S.truck) }; };
  const S = setup({});
  const out = [];
  const add = (name, Sx, x, mi) => out.push({ name, ...metrics(Sx, x), milesRatio: +(mi / Sx.MILES).toFixed(2) });
  add('current', S, S.zs.map(o => o.lbs), S.MILES);
  for (const d of [0.25, 0.5, 1]) { const r = solve(S, d); add(`LP +/-${d * 100}%`, S, r.x, r.mi); }
  // no-optimizer rules
  const prop = S.zs.map(o => S.LB * o.poor / S.POOR);
  add('RULE population share (uncapped)', S, prop, sum(S.zs, (o, i) => 2 * prop[i] * o.d / S.truck));
  const blend = S.zs.map((o, i) => { const lo = o.lbs * 0.5, hi = o.lbs * 1.5; return Math.min(hi, Math.max(lo, prop[i])); });
  const bt = sum(blend, v => v); // rescale headroom so total pounds stay equal
  const adj = blend.map((v, i) => { const o = S.zs[i]; return bt > S.LB ? v - (v - o.lbs * 0.5) * (bt - S.LB) / sum(blend, (w, j) => w - S.zs[j].lbs * 0.5) : v + (o.lbs * 1.5 - v) * (S.LB - bt) / sum(blend, (w, j) => S.zs[j].lbs * 1.5 - w); });
  add('RULE population share capped +/-50%', S, adj, sum(S.zs, (o, i) => 2 * adj[i] * o.d / S.truck));
  require('fs').writeFileSync(require('path').join(__dirname, '../data/processed/audit.json'), JSON.stringify(out, null, 1));
  console.table(out);
  // sensitivity of the +/-50% result
  const sens = [];
  for (const [name, cfg] of [['base', {}], ['truck 10k lb', { truck: 10000 }], ['circuity 1.1', { circ: 1.1 }], ['hubs moved ~5 mi', { hubs: { n: [39.68, -75.72], m: [38.97, -75.47] } }], ['keep mass event', { keepMass: true }], ['min poor 300', { minPoor: 300 }], ['min poor 0', { minPoor: 1 }]]) {
    const Sx = setup(cfg), r = solve(Sx, 0.5), b = metrics(Sx, Sx.zs.map(o => o.lbs)), m = metrics(Sx, r.x);
    sens.push({ name, zips: Sx.zs.length, baseU50: b.u50, u50: m.u50, cutPct: Math.round((1 - m.u50 / b.u50) * 100), baseShort: b.wShort, short: m.wShort, shortCut: Math.round((1 - m.wShort / b.wShort) * 100) });
  }
  console.table(sens);
  const r = solve(S, 0.5), c = S.zs.map((o, i) => ({ zip: o.zip, poor: o.poor, before: +(o.lbs / o.poor).toFixed(1), after: +(r.x[i] / o.poor).toFixed(1), near: o.near }));
  console.log('avg', S.AVG.toFixed(1), 'half', (S.AVG / 2).toFixed(1));
  console.table(c.sort((a, b) => a.before - b.before).slice(0, 7));
})();
