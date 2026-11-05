// Scenario analysis. The weights and default equity target were set before this was run.
// Seeds 1-10 are used only to look at the equity target; reported results use seeds 101-130.
import fs from 'fs';
import { createRequire } from 'module';
import { makeInstance } from '../app/src/core/model.js';
import { makeScenario, runPolicy, POLICIES, SCENARIOS, rng } from '../app/src/core/sim.js';
const require = createRequire(import.meta.url);
const highs = await require('../app/node_modules/highs')();
const solve = lp => highs.solve(lp);
const data = JSON.parse(fs.readFileSync(new URL('../app/src/core/data.json', import.meta.url)));
const OUT = new URL('../data/processed/validation.json', import.meta.url);
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const TEST = range(101, 130), TUNE = range(1, 10), QUICK = range(101, 115);
const KEYS = ['needMet', 'wastePct', 'waste', 'worst', 'lowPeople', 'below60', 'miles', 'unevenLb', 'delivered', 'solveMs'];
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const ci = d => {
  const r = rng(1), B = [];
  for (let b = 0; b < 4000; b++) { let s = 0; for (let i = 0; i < d.length; i++) s += d[Math.floor(r() * d.length)]; B.push(s / d.length); }
  B.sort((x, y) => x - y);
  return [B[100], B[3899]];
};
const summarize = runs => Object.fromEntries(KEYS.map(k => [k, mean(runs.map(r => r[k]))]));
const out = { generated: new Date().toISOString(), seeds: { test: TEST, tune: TUNE, quick: QUICK }, defaults: makeInstance(data).p, scenarios: {}, sensitivity: [], fairness: {}, fairnessTune: {}, whatIf: [] };
const save = () => fs.writeFileSync(OUT, JSON.stringify(out, null, 1));

// 1. Head to head, all policies, held-out seeds
const inst = makeInstance(data);
for (const name of Object.keys(SCENARIOS)) {
  const runs = {};
  for (const p of Object.keys(POLICIES)) runs[p] = [];
  for (const seed of TEST) {
    const sc = makeScenario(inst, name, seed);
    for (const p of Object.keys(POLICIES)) { const m = runPolicy(inst, sc, p, solve); delete m.cov; runs[p].push(m); }
  }
  const s = Object.fromEntries(Object.entries(runs).map(([p, r]) => [p, summarize(r)]));
  const best = ['last', 'share', 'capped'].reduce((a, b) => (s[b].needMet > s[a].needMet ? b : a));
  const pair = (k, ref) => { const d = runs.fairload.map((r, i) => r[k] - runs[ref][i][k]); return { mean: mean(d), ci95: ci(d), wins: d.filter(v => v > 0).length, n: d.length }; };
  const allK = ['needMet', 'wastePct', 'waste', 'worst', 'below60', 'miles', 'unevenLb', 'delivered'];
  out.scenarios[name] = {
    label: SCENARIOS[name].label, policies: s, bestRule: best,
    vsBest: Object.fromEntries(allK.map(k => [k, pair(k, best)])),
    vsCapped: Object.fromEntries(allK.map(k => [k, pair(k, 'capped')])),
    vsShare: Object.fromEntries(allK.map(k => [k, pair(k, 'share')])),
    vsStatic: Object.fromEntries(allK.map(k => [k, pair(k, 'static')])),
    toHindsight: pair('needMet', 'hindsight'),
  };
  console.log(name, 'fairload', s.fairload.needMet.toFixed(3), 'best rule', best, s[best].needMet.toFixed(3), 'hindsight', s.hindsight.needMet.toFixed(3));
  save();
}

// 2. Sensitivity: does the advantage survive when the assumptions change?
const movedHubs = { ...data, zips: data.zips.map(z => ({ ...z, dist: z.dist.map((d, i) => Math.max(1, d + (i === 0 ? 5 : -5) * (z.lat > 39.2 ? 1 : -1))) })) };
const SENS = [
  ['Base case', {}], ['Supply covers 70% of need', { supplyRatio: 0.7 }], ['Supply covers 100% of need', { supplyRatio: 1 }],
  ['Fleet hours 105% of current use', { truckSlack: 1.05 }], ['Fleet hours 150% of current use', { truckSlack: 1.5 }], ['Fleet hours 300% (trucks never limit)', { truckSlack: 3 }],
  ['Spoilage halved', { spoilMult: 0.5 }], ['Spoilage doubled', { spoilMult: 2 }], ['Site intake halved', { siteIntakeMult: 1 }], ['Site intake doubled', { siteIntakeMult: 4 }],
  ['Need half poverty, half population', { needBlend: 0.5 }], ['Cold storage 0.75 weeks', { coldWeeks: 0.75 }], ['Handling 1 hour per load', { handling: 1 }], ['Handling 4 hours per load', { handling: 4 }],
  ['Plan 2 weeks ahead', { horizon: 2 }], ['Plan 8 weeks ahead', { horizon: 8 }], ['Hub locations off by about 5 road miles', {}, movedHubs],
];
for (const [label, o, d] of SENS) {
  const I = makeInstance(d ?? data, o), row = { label };
  for (const name of ['base', 'combined']) {
    const res = { last: [], capped: [], share: [], fairload: [] };
    for (const seed of QUICK) { const sc = makeScenario(I, name, seed); for (const p of Object.keys(res)) res[p].push(runPolicy(I, sc, p, solve)); }
    const m = (p, k) => mean(res[p].map(r => r[k]));
    const best = ['last', 'share', 'capped'].reduce((a, b) => (m(b, 'needMet') > m(a, 'needMet') ? b : a));
    const dd = res.fairload.map((r, i) => r.needMet - res[best][i].needMet);
    row[name] = { fairload: m('fairload', 'needMet'), rule: m(best, 'needMet'), bestRule: best, diff: mean(dd), ci95: ci(dd), wasteDiff: m('fairload', 'waste') - m(best, 'waste'), fairloadWorst: m('fairload', 'worst'), ruleWorst: m(best, 'worst'), fairloadBelow60: m('fairload', 'below60'), ruleBelow60: m(best, 'below60') };
  }
  out.sensitivity.push(row);
  console.log('sens', label, row.base.diff.toFixed(4), row.combined.diff.toFixed(4));
  save();
}

// 3. Fairness trade-off
const TAUS = [0, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
for (const [store, seeds] of [['fairnessTune', TUNE], ['fairness', QUICK]]) for (const name of ['base', 'combined']) {
  out[store][name] = TAUS.map(tau => ({ tau, ...summarize(seeds.map(seed => runPolicy(inst, makeScenario(inst, name, seed), 'fairload', solve, { tau }))) }));
  console.log(store, name, out[store][name].map(r => `${r.tau}:${(r.needMet * 100).toFixed(1)}/${(r.worst * 100).toFixed(1)}/${r.below60 | 0}`).join(' '));
  save();
}

// 4. What is an extra resource worth? Re-solved with the resource added, on normal weeks.
const W = [['Current resources', {}], ['One more truck at Newark', { hoursMult: [1.5, 1] }], ['One more truck at Milford', { hoursMult: [1, 4 / 3] }], ['Double cold storage at both hubs', { coldMult: [2, 2] }], ['One more site in 19805 Wilmington', { extraSites: { 19805: 1 } }], ['Three more sites in 19805 Wilmington', { extraSites: { 19805: 3 } }], ['Two more sites in 19711 Newark', { extraSites: { 19711: 2 } }]];
for (const [label, o] of W) {
  const I = makeInstance(data, o);
  const r = summarize(QUICK.map(seed => runPolicy(I, makeScenario(I, 'base', seed), 'fairload', solve)));
  out.whatIf.push({ label, ...r });
  console.log(label, (r.needMet * 100).toFixed(2), (r.worst * 100).toFixed(1), r.below60 | 0);
  save();
}
out.done = new Date().toISOString();
save();
console.log('done');
