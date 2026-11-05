// Runs the solver off the main thread so the page stays responsive.
import loadHighs from 'highs';
import wasmUrl from 'highs/runtime?url';
import { makeInstance, buildLP, readSolution, baseWeek, openingStock } from './core/model.js';
import { applyEvents, newState, step, metrics, ruleShares, ruleShipments, clone } from './core/sim.js';

let highs = null;
async function solver() { if (!highs) highs = await loadHighs({ locateFile: () => wasmUrl }); return highs; }
async function solveLP(lp) {
  try { return (await solver()).solve(lp); }
  catch (e) { highs = null; return (await solver()).solve(lp); } // the WASM runtime can need a fresh start after an abort
}
const weeksFor = (inst, events, T) => Array.from({ length: T }, (_, t) => applyEvents(inst, baseWeek(inst), events, t));

function runPlan(inst, weeks, plan) {
  const st = newState(inst);
  let after1 = null;
  const log = weeks.map((w, t) => { const d = step(inst, st, w, plan[t]); if (t === 0) after1 = clone(st).stock; return d; });
  return { ...metrics(inst, st), shipments: log, stockAfter1: after1 };
}
function runRule(inst, weeks, kind) {
  const st = newState(inst), shares = ruleShares(inst, kind);
  const log = weeks.map(w => step(inst, st, w, ruleShipments(inst, st, w, shares)));
  return { ...metrics(inst, st), shipments: log };
}
async function optimize(inst, weeks, tau, pins) {
  const lp = buildLP(inst, { weeks, stock: openingStock(inst), tau, pins });
  const t0 = performance.now();
  const sol = await solveLP(lp);
  const ms = performance.now() - t0;
  if (sol.Status !== 'Optimal') return { infeasible: true, status: sol.Status };
  const r = readSolution(inst, weeks, sol);
  return { ...runPlan(inst, weeks, r.plan), shadow: r.shadow, ms, nVars: Object.keys(sol.Columns).length, nRows: sol.Rows.length };
}

const handlers = {
  async plan({ data, params, events, tau, pins, T }) {
    const inst = makeInstance(data, params), weeks = weeksFor(inst, events, T);
    const fair = await optimize(inst, weeks, tau, pins);
    if (fair.infeasible) return { infeasible: true };
    const unpinned = pins.length ? await optimize(inst, weeks, tau, []) : null;
    return { fair, unpinned, rules: { capped: runRule(inst, weeks, 'capped'), share: runRule(inst, weeks, 'share'), last: runRule(inst, weeks, 'last') } };
  },
  async curve({ data, params, events, T }) {
    const inst = makeInstance(data, params), weeks = weeksFor(inst, events, T), out = [];
    for (const tau of [0, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 1]) {
      const m = await optimize(inst, weeks, tau, []);
      out.push({ tau, needMet: m.needMet, worst: m.worst, below60: m.below60, miles: m.miles, waste: m.waste });
    }
    return out;
  },
  async whatif({ data, params, events, tau, T, worstZip }) {
    const base = await optimize(makeInstance(data, params), weeksFor(makeInstance(data, params), events, T), tau, []);
    const n = params.trucks ?? [2, 3];
    const opts = [
      [`One more truck at ${data.hubs[0].name}`, { hoursMult: [(n[0] + 1) / n[0], 1] }],
      [`One more truck at ${data.hubs[1].name}`, { hoursMult: [1, (n[1] + 1) / n[1]] }],
      ['Twice the cold storage', { coldMult: [2, 2] }],
      [`One more site in ${worstZip}`, { extraSites: { [worstZip]: 1 } }],
    ];
    const rows = [];
    for (const [label, o] of opts) {
      const inst = makeInstance(data, { ...params, ...o }), m = await optimize(inst, weeksFor(inst, events, T), tau, []);
      rows.push({ label, delivered: m.delivered - base.delivered, waste: m.waste - base.waste, worst: m.worst - base.worst });
    }
    return rows;
  },
};
self.onmessage = async ({ data: { id, type, payload } }) => {
  try { self.postMessage({ id, type, result: await handlers[type](payload) }); }
  catch (e) { self.postMessage({ id, type, error: String(e.message ?? e) }); }
};
