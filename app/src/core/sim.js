// Simulator and comparison policies. Every policy, including FairLoad, runs through the same
// physical rules in step(), so no policy gets credit for something the system could not do.
import { buckets, baseWeek, openingStock, buildLP, readSolution } from './model.js';

export function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function normal(r) { return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); }
function lognormal(r, cv) { if (!cv) return 1; const s2 = Math.log(1 + cv * cv); return Math.exp(Math.sqrt(s2) * normal(r) - s2 / 2); }

// County groups are used only to place demand spikes.
const KENT = new Set(['19901', '19904', '19943', '19946', '19952', '19953', '19962', '19963', '19977']);
export const countyOf = zip => (zip.startsWith('197') || zip.startsWith('198') ? 'New Castle' : KENT.has(zip) ? 'Kent' : 'Sussex');

export const SCENARIOS = {
  base: { label: 'Normal weeks' },
  truck: { label: 'Truck breakdown' },
  surge: { label: 'Produce donation surge' },
  demand: { label: 'Demand spike in one county' },
  cold: { label: 'Cold storage failure' },
  combined: { label: 'Truck breakdown and demand spike' },
};

// Apply an event to a week. Events are data, so the app and the validation share them.
export function applyEvents(inst, week, events, t) {
  const w = { ...week, supply: week.supply.map(a => [...a]), need: week.need.map(a => [...a]), hours: [...week.hours], cold: [...week.cold], dry: [...week.dry], intake: [...week.intake] };
  for (const e of events) {
    if (t < e.start || t >= e.start + e.weeks) continue;
    if (e.type === 'truck') w.hours[e.hub] *= Math.max(0, 1 - (e.count ?? 1) / inst.p.trucks[e.hub]);
    if (e.type === 'surge') w.supply[e.hub][e.food] += inst.baseSupply[e.hub][e.food] * (e.mult - 1);
    if (e.type === 'demand') inst.zips.forEach((z, i) => { if (countyOf(z.zip) === e.county) w.need[i] = w.need[i].map(v => v * e.mult); });
    if (e.type === 'cold') w.cold[e.hub] *= e.factor;
  }
  return w;
}

// One simulated run: real weekly values, plus events that planners only learn about when they start.
export function makeScenario(inst, name, seed, T = 12) {
  const hash = s => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 0); // name length alone collided (truck/surge, base/cold)
  const r = rng(seed * 7919 + hash(name));
  for (let i = 0; i < 5; i++) r();
  const pickHub = () => (r() < 0.5 ? 0 : 1), counties = ['New Castle', 'Kent', 'Sussex'];
  const events = [];
  const add = n => {
    if (n === 'truck') events.push({ type: 'truck', hub: pickHub(), start: 3 + Math.floor(r() * 3), weeks: 4 });
    if (n === 'surge') events.push({ type: 'surge', hub: pickHub(), food: 0, mult: 4, start: 4 + Math.floor(r() * 3), weeks: 2 });
    if (n === 'demand') events.push({ type: 'demand', county: counties[Math.floor(r() * 3)], mult: 1.4, start: 3 + Math.floor(r() * 3), weeks: 6 });
    if (n === 'cold') events.push({ type: 'cold', hub: pickHub(), factor: 0.3, start: 4 + Math.floor(r() * 3), weeks: 3 });
  };
  if (name === 'combined') { add('truck'); add('demand'); } else if (name !== 'base') add(name);
  const base = baseWeek(inst), weeks = [];
  for (let t = 0; t < T; t++) {
    const common = lognormal(r, 0.05);
    const w = { ...base, supply: base.supply.map(a => a.map((v, f) => v * lognormal(r, inst.foods[f].cv))), need: base.need.map(a => { const m = common * lognormal(r, 0.1); return a.map(v => v * m); }) };
    weeks.push(applyEvents(inst, w, events, t));
  }
  // What a planner standing in week t expects for week t+k: averages, plus events already under way.
  const forecast = (t, k) => applyEvents(inst, baseWeek(inst), events.filter(e => e.start <= t), t + k);
  return { name, seed, T, events, weeks, forecast };
}

export function newState(inst) {
  return {
    stock: openingStock(inst),
    served: inst.zips.map(() => 0), need: inst.zips.map(() => 0),
    waste: 0, supplied: inst.hubs.reduce((s, _, h) => s + inst.foods.reduce((q, f, k) => q + openingStock(inst)[h][k].reduce((a, b) => a + b, 0), 0), 0),
    miles: 0, hours: 0, delivered: 0, wasteByFood: inst.foods.map(() => 0),
  };
}
const clone = st => ({ ...st, stock: st.stock.map(a => a.map(b => [...b])), served: [...st.served], need: [...st.need], wasteByFood: [...st.wasteByFood] });

// Advance one week. Shipments are cut back to what stock, trucks, pantry intake and need allow.
export function step(inst, st, week, ship) {
  const { foods, hubs, zips } = inst;
  hubs.forEach((_, h) => foods.forEach((f, k) => { st.stock[h][k][0] += week.supply[h][k]; st.supplied += week.supply[h][k]; }));
  const needLeft = week.need.map(a => [...a]), intakeLeft = [...week.intake], hoursLeft = [...week.hours];
  const delivered = [];
  // Perishable food moves first, oldest stock first.
  const ordered = [...ship].sort((a, b) => a.f - b.f);
  for (const s of ordered) {
    let q = Math.min(s.lb, needLeft[s.z][s.f], intakeLeft[s.z], hoursLeft[s.h] / inst.hoursPerLb[s.z][s.h]);
    const b = st.stock[s.h][s.f], onHand = b.reduce((a, v) => a + v, 0);
    q = Math.max(0, Math.min(q, onHand));
    if (q <= 0) continue;
    let rem = q;
    for (let a = b.length - 1; a >= 0 && rem > 0; a--) { const take = Math.min(b[a], rem); b[a] -= take; rem -= take; }
    needLeft[s.z][s.f] -= q; intakeLeft[s.z] -= q; hoursLeft[s.h] -= q * inst.hoursPerLb[s.z][s.h];
    st.served[s.z] += q; st.delivered += q; st.miles += q * inst.milesPerLb[s.z][s.h]; st.hours += q * inst.hoursPerLb[s.z][s.h];
    delivered.push({ ...s, lb: q });
  }
  zips.forEach((_, z) => foods.forEach((f, k) => { st.need[z] += week.need[z][k]; }));
  const lose = (k, q) => { st.waste += q; st.wasteByFood[k] += q; };
  hubs.forEach((_, h) => {
    foods.forEach((f, k) => { // food at the end of its shelf life is lost
      const b = st.stock[h][k];
      if (Number.isFinite(f.shelf)) { lose(k, b[b.length - 1]); b[b.length - 1] = 0; }
    });
    for (const [isCold, cap] of [[true, week.cold[h]], [false, week.dry[h]]]) { // storage overflow, oldest first
      let held = foods.reduce((s, f, k) => s + (f.cold === isCold ? st.stock[h][k].reduce((a, v) => a + v, 0) : 0), 0);
      for (let k = 0; k < foods.length && held > cap; k++) {
        if (foods[k].cold !== isCold) continue;
        const b = st.stock[h][k];
        for (let a = b.length - 1; a >= 0 && held > cap; a--) { const c = Math.min(b[a], held - cap); b[a] -= c; lose(k, c); held -= c; }
      }
    }
    foods.forEach((f, k) => { // spoilage on what is carried, then everything ages one week
      const b = st.stock[h][k];
      for (let a = 0; a < b.length; a++) { const l = b[a] * f.spoil; lose(k, l); b[a] -= l; }
      if (Number.isFinite(f.shelf)) { for (let a = b.length - 1; a > 0; a--) b[a] = b[a - 1]; b[0] = 0; }
    });
  });
  return delivered;
}

// ---- simple rules ------------------------------------------------------------------------
export const ruleShares = (inst, kind) => {
  const { zips, baseNeed } = inst;
  const needW = baseNeed.map(a => a.reduce((s, v) => s + v, 0)), N = needW.reduce((s, v) => s + v, 0);
  const hist = zips.map(z => z.lbs), H = hist.reduce((s, v) => s + v, 0);
  if (kind === 'last') return hist.map(v => v / H);
  const prop = needW.map(v => v / N);
  if (kind === 'share') return prop;
  // Capped: share of need, with each ZIP limited to +/-50% of its current pounds, rescaled to total.
  const h = hist.map(v => v / H);
  let c = prop.map((v, i) => Math.min(h[i] * 1.5, Math.max(h[i] * 0.5, v)));
  const tot = c.reduce((s, v) => s + v, 0);
  c = c.map((v, i) => (tot > 1 ? v - (v - h[i] * 0.5) * (tot - 1) / c.reduce((s, w, j) => s + w - h[j] * 0.5, 0) : v + (h[i] * 1.5 - v) * (1 - tot) / c.reduce((s, w, j) => s + h[j] * 1.5 - w, 0)));
  return c;
};

// A rule ships everything it can each week, re-offering leftovers to ZIPs that can still take food.
export function ruleShipments(inst, st, week, shares) {
  const { foods, hubs, zips } = inst;
  const avail = hubs.map((_, h) => foods.map((f, k) => st.stock[h][k].reduce((a, v) => a + v, 0) + week.supply[h][k]));
  const needLeft = week.need.map(a => [...a]), intakeLeft = [...week.intake], hoursLeft = [...week.hours];
  const out = [];
  for (let k = 0; k < foods.length; k++) {
    for (let pass = 0; pass < 4; pass++) {
      const total = hubs.reduce((s, _, h) => s + avail[h][k], 0);
      if (total < 1) break;
      const open = zips.map((_, z) => (needLeft[z][k] > 0.5 && intakeLeft[z] > 0.5 ? shares[z] : 0));
      const W = open.reduce((s, v) => s + v, 0);
      if (W <= 0) break;
      for (let z = 0; z < zips.length; z++) {
        if (!open[z]) continue;
        let q = Math.min((total * open[z]) / W, needLeft[z][k], intakeLeft[z]);
        const order = hubs.map((_, h) => h).sort((a, b) => zips[z].dist[a] - zips[z].dist[b]);
        for (const h of order) {
          if (q <= 0) break;
          const send = Math.min(q, avail[h][k], hoursLeft[h] / inst.hoursPerLb[z][h]);
          if (send <= 0.5) continue;
          out.push({ h, z, f: k, lb: send });
          avail[h][k] -= send; needLeft[z][k] -= send; intakeLeft[z] -= send; hoursLeft[h] -= send * inst.hoursPerLb[z][h]; q -= send;
        }
      }
    }
  }
  return out;
}

// A stronger rule that knows about truck time: shortest routes first, every ZIP up to a floor, then the rest.
export function routeFloorShipments(inst, st, week, floor = 0.7) {
  const { foods, hubs, zips } = inst;
  const avail = hubs.map((_, h) => foods.map((f, k) => st.stock[h][k].reduce((a, v) => a + v, 0) + week.supply[h][k]));
  const needLeft = week.need.map(a => [...a]), intakeLeft = [...week.intake], hoursLeft = [...week.hours];
  const routes = [];
  zips.forEach((_, z) => hubs.forEach((_, h) => routes.push({ z, h, cost: inst.hoursPerLb[z][h] })));
  routes.sort((a, b) => a.cost - b.cost);
  const out = [];
  const given = zips.map(() => 0), weekNeed = week.need.map(a => a.reduce((x, y) => x + y, 0));
  for (const useFloor of [true, false]) for (let k = 0; k < foods.length; k++) for (const { z, h, cost } of routes) {
    let q = Math.min(needLeft[z][k], intakeLeft[z], avail[h][k], hoursLeft[h] / cost);
    if (useFloor) q = Math.min(q, Math.max(0, floor * weekNeed[z] - given[z]));
    if (q <= 0.5) continue;
    out.push({ h, z, f: k, lb: q });
    needLeft[z][k] -= q; intakeLeft[z] -= q; avail[h][k] -= q; hoursLeft[h] -= q * cost; given[z] += q;
  }
  return out;
}

export function metrics(inst, st) {
  const cov = st.served.map((v, i) => v / Math.max(1, st.need[i]));
  const totalNeed = st.need.reduce((a, b) => a + b, 0), met = st.delivered / totalNeed;
  const low = inst.zips.reduce((s, z, i) => s + (cov[i] < 0.5 * met ? z.poor : 0), 0);
  let worst = 0; cov.forEach((c, i) => { if (c < cov[worst]) worst = i; });
  const below60 = inst.zips.reduce((s, z, i) => s + (cov[i] < 0.6 ? z.poor : 0), 0);
  const unmetGapLb = st.need.reduce((s, n, i) => s + Math.max(0, met * n - st.served[i]), 0);
  return {
    needMet: met, delivered: st.delivered, need: totalNeed, waste: st.waste, wastePct: st.waste / st.supplied, miles: st.miles, hours: st.hours,
    worst: cov[worst], worstZip: inst.zips[worst].zip, lowPeople: low, below60, unevenLb: unmetGapLb, cov,
  };
}

// ---- run a policy through a scenario -----------------------------------------------------
export const POLICIES = {
  last: 'Repeat last period',
  share: 'Share of people in poverty',
  capped: 'Poverty share, capped ±50%',
  static: 'One-forecast plan (no re-solve)',
  fairload: 'FairLoad (weekly re-solve)',
  hindsight: 'Perfect hindsight (upper bound)',
};

export function runPolicy(inst, sc, policy, solve, opts = {}) {
  const st = newState(inst);
  let solves = 0, ms = 0;
  const lp = ctx => { const t0 = performance.now(); const r = readSolution(inst, ctx.weeks, solve(buildLP(inst, ctx))); ms += performance.now() - t0; solves++; return r; };
  let fixed = null;
  if (policy === 'hindsight') fixed = lp({ weeks: sc.weeks, stock: st.stock, tau: opts.tau }).plan;
  if (policy === 'static') fixed = lp({ weeks: Array.from({ length: sc.T }, (_, k) => sc.forecast(-1, k + 1)), stock: st.stock, tau: opts.tau }).plan;
  const shares = ['last', 'share', 'capped'].includes(policy) ? ruleShares(inst, policy) : null;
  for (let t = 0; t < sc.T; t++) {
    const week = sc.weeks[t];
    let ship;
    if (fixed) ship = fixed[t];
    else if (policy === 'routeFloor') ship = routeFloorShipments(inst, st, week);
    else if (shares) ship = ruleShipments(inst, st, week, shares);
    else {
      const H = Math.min(inst.p.horizon, sc.T - t);
      const weeks = [week]; for (let k = 1; k < H; k++) weeks.push(sc.forecast(t, k));
      ship = lp({ weeks, stock: st.stock, past: { served: st.served, need: st.need }, tau: opts.tau }).plan[0];
    }
    step(inst, st, week, ship);
  }
  return { ...metrics(inst, st), solves, solveMs: solves ? ms / solves : 0 };
}

export { clone };
