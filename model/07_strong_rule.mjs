// A harder baseline than the rules a food bank might use by hand: it knows about truck time.
// It fills every ZIP to a floor using the shortest routes first, then fills the rest the same way.
import fs from 'fs';
import { createRequire } from 'module';
import { makeInstance } from '../app/src/core/model.js';
import { makeScenario, runPolicy, SCENARIOS, rng } from '../app/src/core/sim.js';
const require = createRequire(import.meta.url);
const highs = await require('../app/node_modules/highs')();
const solve = lp => highs.solve(lp);
const data = JSON.parse(fs.readFileSync(new URL('../app/src/core/data.json', import.meta.url)));
const FILE = new URL('../data/processed/validation.json', import.meta.url);
const V = JSON.parse(fs.readFileSync(FILE));
const inst = makeInstance(data);
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const ci = d => {
  const r = rng(1), B = [];
  for (let b = 0; b < 4000; b++) { let s = 0; for (let i = 0; i < d.length; i++) s += d[Math.floor(r() * d.length)]; B.push(s / d.length); }
  B.sort((x, y) => x - y);
  return [B[100], B[3899]];
};
V.strongRule = {};
for (const name of Object.keys(SCENARIOS)) {
  const a = [], b = [];
  for (const seed of V.seeds.test) {
    const sc = makeScenario(inst, name, seed);
    a.push(runPolicy(inst, sc, 'fairload', solve));
    b.push(runPolicy(inst, sc, 'routeFloor', solve));
  }
  const pair = k => { const d = a.map((r, i) => r[k] - b[i][k]); return { mean: mean(d), ci95: ci(d), wins: d.filter(v => v > 0).length, n: d.length }; };
  V.strongRule[name] = { label: SCENARIOS[name].label, needMet: mean(b.map(r => r.needMet)), waste: mean(b.map(r => r.waste)), worst: mean(b.map(r => r.worst)), below60: mean(b.map(r => r.below60)), miles: mean(b.map(r => r.miles)), diff: { needMet: pair('needMet'), waste: pair('waste'), worst: pair('worst'), below60: pair('below60'), miles: pair('miles') } };
  const s = V.strongRule[name];
  console.log(name, 'rule', (s.needMet * 100).toFixed(1), 'gain', (s.diff.needMet.mean * 100).toFixed(2), s.diff.needMet.ci95.map(x => (x * 100).toFixed(2)).join('..'), 'wins', s.diff.needMet.wins, 'wasteDiff', Math.round(s.diff.waste.mean), 'b60diff', Math.round(s.diff.below60.mean), 'worstDiff', (s.diff.worst.mean * 100).toFixed(1));
}
fs.writeFileSync(FILE, JSON.stringify(V, null, 1));
