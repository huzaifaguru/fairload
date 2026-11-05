// Integrity tests. These check the model and simulator against facts that must hold, including
// tiny problems whose answers can be worked out by hand.
import fs from 'fs';
import assert from 'assert';
import { createRequire } from 'module';
import { makeInstance, buildLP, readSolution, baseWeek, openingStock } from '../app/src/core/model.js';
import { makeScenario, runPolicy, newState, step, SCENARIOS, ruleShares } from '../app/src/core/sim.js';
const require = createRequire(import.meta.url);
const highs = await require('../app/node_modules/highs')();
const solve = lp => highs.solve(lp);
const data = JSON.parse(fs.readFileSync(new URL('../app/src/core/data.json', import.meta.url)));
const inst = makeInstance(data);
let n = 0;
const ok = (name, f) => { f(); n++; console.log('pass:', name); };
const close = (a, b, tol = 1, msg = '') => assert(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);

ok('capped rule shares sum to 1 and stay within +/-50% of history', () => {
  const c = ruleShares(inst, 'capped'), H = data.zips.reduce((s, z) => s + z.lbs, 0);
  close(c.reduce((a, b) => a + b, 0), 1, 1e-9);
  c.forEach((v, i) => { const h = data.zips[i].lbs / H; assert(v >= h * 0.5 - 1e-9 && v <= h * 1.5 + 1e-9); });
});

ok('food is conserved in every scenario: supplied = delivered + wasted + still in stock', () => {
  for (const name of Object.keys(SCENARIOS)) {
    const sc = makeScenario(inst, name, 3), st = newState(inst);
    for (let t = 0; t < sc.T; t++) step(inst, st, sc.weeks[t], [{ h: 0, z: 0, f: 0, lb: 500 }, { h: 1, z: 30, f: 2, lb: 9e9 }]);
    const left = st.stock.flat(2).reduce((a, b) => a + b, 0);
    close(st.supplied, st.delivered + st.waste + left, 1e-3, 'conservation');
  }
});

ok('the simulator never exceeds need, pantry intake or fleet hours, whatever it is asked to ship', () => {
  const sc = makeScenario(inst, 'combined', 5), st = newState(inst);
  const greedy = [];
  inst.zips.forEach((_, z) => inst.foods.forEach((_, f) => [0, 1].forEach(h => greedy.push({ h, z, f, lb: 1e7 }))));
  for (let t = 0; t < sc.T; t++) {
    const before = { served: [...st.served], hours: st.hours }, wk = sc.weeks[t];
    step(inst, st, wk, greedy);
    st.served.forEach((v, z) => {
      const got = v - before.served[z];
      assert(got <= wk.intake[z] + 1e-6, 'intake');
      assert(got <= wk.need[z].reduce((a, b) => a + b, 0) + 1e-6, 'need');
    });
    assert(st.hours - before.hours <= wk.hours[0] + wk.hours[1] + 1e-6, 'hours');
  }
});

ok('an LP plan on known weeks survives the simulator without being cut back', () => {
  const sc = makeScenario(inst, 'truck', 7);
  const r = readSolution(inst, sc.weeks, solve(buildLP(inst, { weeks: sc.weeks, stock: openingStock(inst) })));
  const st = newState(inst);
  let asked = 0, got = 0;
  sc.weeks.forEach((w, t) => { asked += r.plan[t].reduce((s, q) => s + q.lb, 0); got += step(inst, st, w, r.plan[t]).reduce((s, q) => s + q.lb, 0); });
  close(got / asked, 1, 0.002, 'plan delivered share');
});

ok('hand-checked case: one ZIP, one hub, supply is half of need', () => {
  const d = { hubs: [data.hubs[0]], siteWeeklyP75: 1e6, zips: [{ zip: '19801', city: 'T', lat: 0, lng: 0, poor: 100, pop: 200, sites: 1, lbs: 2600, dist: [10] }] };
  const i = makeInstance(d, { supplyRatio: 0.5, trucks: [1], truckSlack: 5 }); // 100 lb per week supplied, 200 needed
  const st = openingStock(i).map(a => a.map(b => b.map(() => 0)));
  const w = baseWeek(i), r = solve(buildLP(i, { weeks: [w], stock: st, tau: 0 }));
  close(readSolution(i, [w], r).plan[0].reduce((s, q) => s + q.lb, 0), 100, 1e-3, 'delivers all supply');
  close(r.ObjectiveValue, 100, 0.2, 'objective equals 100 lb unmet');
});

ok('hand-checked case: raising the equity target moves food to the far ZIP', () => {
  const d = { hubs: [data.hubs[0]], siteWeeklyP75: 1e6, zips: [
    { zip: 'A', city: 'A', lat: 0, lng: 0, poor: 100, pop: 100, sites: 1, lbs: 1300, dist: [1] },
    { zip: 'B', city: 'B', lat: 0, lng: 0, poor: 100, pop: 100, sites: 1, lbs: 1300, dist: [60] }] };
  const i = makeInstance(d, { supplyRatio: 0.5, trucks: [1], truckSlack: 5 });
  const st = openingStock(i).map(a => a.map(b => b.map(() => 0))), w = baseWeek(i);
  const run = tau => {
    const q = readSolution(i, [w], solve(buildLP(i, { weeks: [w], stock: st, tau }))).plan[0];
    return [0, 1].map(z => q.filter(s => s.z === z).reduce((a, s) => a + s.lb, 0));
  };
  const [a0, b0] = run(0), [a1, b1] = run(0.5);
  assert(a0 > b0, 'without a target the near ZIP is favored');
  close(a1, b1, 1, 'with a 50% target both reach 50%');
});

ok('a higher equity target never starves the worst-served ZIP (found in testing: a flat penalty did)', () => {
  const sc = makeScenario(inst, 'base', 2), st = () => openingStock(inst);
  const run = tau => {
    const r = readSolution(inst, sc.weeks, solve(buildLP(inst, { weeks: sc.weeks, stock: st(), tau })));
    const s = newState(inst);
    sc.weeks.forEach((w, t) => step(inst, s, w, r.plan[t]));
    return Math.min(...s.served.map((v, i) => v / s.need[i]));
  };
  const worst = [0.5, 0.7, 0.9, 1].map(run);
  for (let i = 1; i < worst.length; i++) assert(worst[i] >= worst[i - 1] - 0.005, `worst fell: ${worst}`);
});

ok('hindsight is at least as good as FairLoad on unmet need plus waste', () => {
  for (const seed of [11, 12, 13]) {
    const sc = makeScenario(inst, 'base', seed), a = runPolicy(inst, sc, 'hindsight', solve), b = runPolicy(inst, sc, 'fairload', solve);
    const cost = m => (m.need - m.delivered) + inst.p.W * m.waste;
    assert(cost(a) <= cost(b) * 1.03, `seed ${seed}: ${cost(a)} ${cost(b)}`);
  }
});

ok('same seed gives the same scenario; different seeds do not', () => {
  const a = makeScenario(inst, 'surge', 9), b = makeScenario(inst, 'surge', 9), c = makeScenario(inst, 'surge', 10);
  assert.deepStrictEqual(a.weeks[3].supply, b.weeks[3].supply);
  assert.notDeepStrictEqual(a.weeks[3].supply, c.weeks[3].supply);
});

ok('a forced shipment can never lower the objective, so a pin never looks free when it is not', () => {
  const sc = makeScenario(inst, 'base', 4), w = sc.weeks.slice(0, 4), st = newState(inst);
  const a = solve(buildLP(inst, { weeks: w, stock: st.stock }));
  const b = solve(buildLP(inst, { weeks: w, stock: st.stock, pins: [{ h: 1, z: 0, f: 0, t: 0, lb: 800 }] }));
  assert(b.ObjectiveValue >= a.ObjectiveValue - 1e-6);
});

console.log(`\n${n} tests passed`);
