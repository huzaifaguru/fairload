// FairLoad core model. No browser or Node dependencies, so the app and the validation
// scripts run exactly the same code. The solver (HiGHS) is passed in by the caller.
//
// Decision: how many pounds of each food type go from each hub to each ZIP, each week.
// Everything marked ASSUMPTION is not in the public data and is tested in the sensitivity analysis.

export const FOODS = [
  // ASSUMPTION: mix, shelf life, weekly spoilage and supply variability by food type.
  { id: 'produce', label: 'Fresh produce', share: 0.3, shelf: 2, spoil: 0.15, cold: true, cv: 0.5 },
  { id: 'chilled', label: 'Dairy and protein', share: 0.2, shelf: 4, spoil: 0.05, cold: true, cv: 0.3 },
  { id: 'dry', label: 'Shelf-stable', share: 0.5, shelf: Infinity, spoil: 0.005, cold: false, cv: 0.25 },
];

export const DEFAULTS = {
  weeksInData: 26,      // Q1 and Q2 FY25
  supplyRatio: 0.85,    // ASSUMPTION: base supply covers 85% of estimated need
  truckLb: 20000,       // ASSUMPTION: pounds per truckload (loads may be fractional)
  speed: 35,            // ASSUMPTION: average road speed, mph
  handling: 2,          // ASSUMPTION: load and unload hours per truckload
  truckSlack: 1.2,      // ASSUMPTION: fleet hours are 120% of what the current allocation needs
  trucks: [2, 3],       // ASSUMPTION: trucks at Newark and Milford, used to size a breakdown
  siteIntakeMult: 2,    // ASSUMPTION: a site can take twice the 75th percentile of observed weekly pounds
  coldWeeks: 1.5,       // ASSUMPTION: cold storage holds 1.5 weeks of a hub's cold inflow
  dryWeeks: 6,          // ASSUMPTION: dry storage holds 6 weeks of a hub's dry inflow
  spoilMult: 1,         // sensitivity multiplier on spoilage
  needBlend: 0,         // 0 = need follows people in poverty; 1 = need follows total population
  horizon: 4,           // weeks planned ahead when re-solving
  tau: 0.7,             // equity target: every ZIP should reach this share of its need
  U: 1,                 // objective weight, per pound of unmet need
  W: 0.5,               // objective weight, per pound of food wasted
  E: 2,                 // objective weight, per pound below the equity target
  eps: 5,               // small cost per truck hour, so the solver avoids pointless miles
};

// Shortfall bands, as a share of the ZIP's need: the first 10 points cost 1×, the next 20 cost 2×, the rest 4×.
export const BANDS = [{ width: 0.1, weight: 1 }, { width: 0.2, weight: 2 }, { width: Infinity, weight: 4 }];

export const buckets = f => (Number.isFinite(f.shelf) ? f.shelf : 1);

// Build the fixed part of the problem from data + assumptions.
export function makeInstance(data, overrides = {}) {
  const p = { ...DEFAULTS, ...overrides };
  const zips = data.zips, hubs = data.hubs;
  const foods = FOODS.map(f => ({ ...f, spoil: Math.min(0.9, f.spoil * p.spoilMult) }));
  const totalHist = zips.reduce((s, z) => s + z.lbs, 0);
  const weeklySupply = totalHist / p.weeksInData;
  const totalPoor = zips.reduce((s, z) => s + z.poor, 0), totalPop = zips.reduce((s, z) => s + z.pop, 0);
  const totalNeed = weeklySupply / p.supplyRatio;

  const nearest = zips.map(z => z.dist.indexOf(Math.min(...z.dist)));
  const hoursPerLb = zips.map(z => z.dist.map(d => (2 * d * 1 / p.speed + p.handling) / p.truckLb));
  const milesPerLb = zips.map(z => z.dist.map(d => (2 * d) / p.truckLb));
  // Fleet hours are sized from what the current allocation needs, not from a claimed fleet.
  const baseHours = hubs.map((_, h) => zips.reduce((s, z, i) => s + (nearest[i] === h ? (z.lbs / p.weeksInData) * hoursPerLb[i][h] : 0), 0) * p.truckSlack);
  // Hub supply follows the pounds historically closest to each hub (ASSUMPTION).
  const hubShare = hubs.map((_, h) => zips.reduce((s, z, i) => s + (nearest[i] === h ? z.lbs : 0), 0) / totalHist);
  const baseSupply = hubs.map((_, h) => foods.map(f => weeklySupply * hubShare[h] * f.share));
  const needShare = zips.map(z => (1 - p.needBlend) * z.poor / totalPoor + p.needBlend * z.pop / totalPop);
  const baseNeed = zips.map((_, i) => foods.map(f => totalNeed * needShare[i] * f.share));
  if (p.hoursMult) p.hoursMult.forEach((m, h) => { baseHours[h] *= m; });
  const intake = zips.map(z => (z.sites + (p.extraSites?.[z.zip] ?? 0)) * data.siteWeeklyP75 * p.siteIntakeMult);
  const coldCap = hubs.map((_, h) => foods.reduce((s, f, k) => s + (f.cold ? baseSupply[h][k] : 0), 0) * p.coldWeeks * (p.coldMult?.[h] ?? 1));
  const dryCap = hubs.map((_, h) => foods.reduce((s, f, k) => s + (!f.cold ? baseSupply[h][k] : 0), 0) * p.dryWeeks);
  return { p, zips, hubs, foods, nearest, hoursPerLb, milesPerLb, baseHours, baseSupply, baseNeed, intake, coldCap, dryCap, weeklySupply, totalNeed, hubShare };
}

// Opening stock: half a week of chilled and one week of shelf-stable food at each hub.
export function openingStock(inst) {
  return inst.hubs.map((_, h) => inst.foods.map((f, k) => {
    const b = new Array(buckets(f)).fill(0);
    if (f.id === 'chilled') b[0] = inst.baseSupply[h][k] * 0.5;
    if (f.id === 'dry') b[0] = inst.baseSupply[h][k];
    return b;
  }));
}

// A week with no surprises, used for forecasts and for the live planner.
export function baseWeek(inst) {
  return {
    supply: inst.baseSupply.map(a => [...a]),
    need: inst.baseNeed.map(a => [...a]),
    hours: [...inst.baseHours],
    cold: [...inst.coldCap],
    dry: [...inst.dryCap],
    intake: [...inst.intake],
  };
}

// ctx = { weeks: [week...], stock, past: {served:[], need:[]}, pins: [{h,z,f,t,lb}], tau }
// Stock is what each hub holds before week 0's arrivals.
export function buildLP(inst, ctx) {
  const { foods, hubs, zips, p } = inst;
  const T = ctx.weeks.length, tau = ctx.tau ?? p.tau;
  const past = ctx.past ?? { served: zips.map(() => 0), need: zips.map(() => 0) };
  const H = hubs.length, Z = zips.length, F = foods.length;
  const x = (h, z, f, t) => `x${h}_${z}_${f}_${t}`, y = (h, f, a, t) => `y${h}_${f}_${a}_${t}`;
  const d = (h, f, a, t) => `d${h}_${f}_${a}_${t}`, I = (h, f, a, t) => `i${h}_${f}_${a}_${t}`;
  const u = (z, f, t) => `u${z}_${f}_${t}`, s = (z, b) => `s${z}_${b}`;
  const num = v => (Math.abs(v) < 1e-10 ? '0' : v.toFixed(9));
  const hasI = (f, a) => !Number.isFinite(foods[f].shelf) || a < foods[f].shelf - 1; // food in its last week cannot be carried

  const obj = [], rows = [], bounds = [];
  for (let t = 0; t < T; t++) {
    for (let z = 0; z < Z; z++) for (let f = 0; f < F; f++) {
      obj.push(`${p.U} ${u(z, f, t)}`);
      for (let h = 0; h < H; h++) obj.push(`${num(p.eps * inst.hoursPerLb[z][h])} ${x(h, z, f, t)}`);
    }
    for (let h = 0; h < H; h++) for (let f = 0; f < F; f++) for (let a = 0; a < buckets(foods[f]); a++) {
      obj.push(`${p.W} ${d(h, f, a, t)}`);
      if (hasI(f, a) && foods[f].spoil > 0) obj.push(`${num(p.W * foods[f].spoil)} ${I(h, f, a, t)}`);
    }
  }
  // Equity penalty rises the further a ZIP is below target. A flat penalty values every pound the
  // same wherever it lands, so at high targets it can starve a distant ZIP to serve cheap routes.
  for (let z = 0; z < Z; z++) BANDS.forEach((b, i) => obj.push(`${p.E * b.weight} ${s(z, i)}`));

  for (let t = 0; t < T; t++) {
    const w = ctx.weeks[t];
    for (let h = 0; h < H; h++) {
      for (let f = 0; f < F; f++) {
        const fd = foods[f], L = buckets(fd), keep = 1 - fd.spoil;
        for (let a = 0; a < L; a++) {
          // shipped + discarded + carried = fresh arrivals + what was carried in
          let lhs = `${y(h, f, a, t)} + ${d(h, f, a, t)}`;
          if (hasI(f, a)) lhs += ` + ${I(h, f, a, t)}`;
          let rhs = a === 0 ? w.supply[h][f] : 0;
          // ctx.stock is the state at the start of week 0, so it has already aged and spoiled.
          if (t === 0) rhs += ctx.stock[h][f][a];
          else {
            const prev = Number.isFinite(fd.shelf) ? a - 1 : 0; // shelf-stable food stays in one bucket
            if (prev >= 0) lhs += ` - ${num(keep)} ${I(h, f, prev, t - 1)}`;
          }
          rows.push(`bal_${h}_${f}_${a}_${t}: ${lhs} = ${num(rhs)}`);
        }
        const out = [], ys = [];
        for (let z = 0; z < Z; z++) out.push(x(h, z, f, t));
        for (let a = 0; a < L; a++) ys.push(`- ${y(h, f, a, t)}`);
        rows.push(`flow_${h}_${f}_${t}: ${out.join(' + ')} ${ys.join(' ')} = 0`);
      }
      const tr = [];
      for (let z = 0; z < Z; z++) for (let f = 0; f < F; f++) tr.push(`${num(inst.hoursPerLb[z][h])} ${x(h, z, f, t)}`);
      rows.push(`truck_${h}_${t}: ${tr.join(' + ')} <= ${num(w.hours[h])}`);
      const cold = [], dry = [];
      for (let f = 0; f < F; f++) for (let a = 0; a < buckets(foods[f]); a++) if (hasI(f, a)) (foods[f].cold ? cold : dry).push(I(h, f, a, t));
      if (cold.length) rows.push(`cold_${h}_${t}: ${cold.join(' + ')} <= ${num(w.cold[h])}`);
      if (dry.length) rows.push(`dry_${h}_${t}: ${dry.join(' + ')} <= ${num(w.dry[h])}`);
    }
    for (let z = 0; z < Z; z++) {
      const all = [];
      for (let f = 0; f < F; f++) {
        const sh = [];
        for (let h = 0; h < H; h++) { sh.push(x(h, z, f, t)); all.push(x(h, z, f, t)); }
        rows.push(`need_${z}_${f}_${t}: ${sh.join(' + ')} + ${u(z, f, t)} = ${num(w.need[z][f])}`);
      }
      rows.push(`intake_${z}_${t}: ${all.join(' + ')} <= ${num(w.intake[z])}`);
    }
  }
  // Equity: pounds below the target share of need, counting what has already been delivered.
  for (let z = 0; z < Z; z++) {
    const terms = []; let need = past.need[z];
    for (let t = 0; t < T; t++) for (let f = 0; f < F; f++) {
      need += ctx.weeks[t].need[z][f];
      for (let h = 0; h < H; h++) terms.push(x(h, z, f, t));
    }
    rows.push(`eq_${z}: ${BANDS.map((_, i) => s(z, i)).join(' + ')} + ${terms.join(' + ')} >= ${num(tau * need - past.served[z])}`);
    BANDS.forEach((b, i) => { if (Number.isFinite(b.width)) bounds.push(`${s(z, i)} <= ${num(b.width * need)}`); });
  }
  for (const pin of ctx.pins ?? []) bounds.push(`${x(pin.h, pin.z, pin.f, pin.t ?? 0)} >= ${num(pin.lb)}`);
  const wrap = (arr, lead = '') => { // keep lines short for the LP reader
    const out = []; let line = lead;
    for (const a of arr) { if (line.length > 200) { out.push(line); line = ' '; } line += (line === lead || line === ' ' ? '' : ' + ') + a; }
    out.push(line); return out.join('\n');
  };
  return ['Minimize', wrap(obj, ' obj: '), 'Subject To', ...rows.map(splitLong), ...(bounds.length ? ['Bounds', ...bounds] : []), 'End'].join('\n');
}
function splitLong(r) {
  if (r.length < 400) return r;
  const parts = r.split(' '); const out = []; let line = '';
  for (const q of parts) { if (line.length > 200) { out.push(line); line = ''; } line += (line ? ' ' : '') + q; }
  out.push(line); return out.join('\n ');
}

// Read the shipping plan and the constraint shadow prices out of a HiGHS solution.
export function readSolution(inst, weeks, sol) {
  if (sol.Status !== 'Optimal') throw new Error('Solver status: ' + sol.Status);
  const { hubs, zips, foods } = inst, c = sol.Columns;
  const plan = weeks.map((_, t) => {
    const ship = [];
    for (let h = 0; h < hubs.length; h++) for (let z = 0; z < zips.length; z++) for (let f = 0; f < foods.length; f++) {
      const lb = c[`x${h}_${z}_${f}_${t}`]?.Primal ?? 0;
      if (lb > 0.5) ship.push({ h, z, f, lb });
    }
    return ship;
  });
  const shadow = {};
  for (const r of sol.Rows ?? []) if (/^(truck|cold|dry|intake)_/.test(r.Name) && Math.abs(r.Dual) > 1e-7) shadow[r.Name] = Math.abs(r.Dual);
  return { plan, shadow, objective: sol.ObjectiveValue };
}

// Upper limit for a manager's pin, so that a forced shipment is always something the system could do.
export function pinLimit(inst, week, stock, { h, z, f }) {
  const fd = inst.foods[f];
  const inStock = stock[h][f].reduce((s, v) => s + v, 0) * (1 - 0) + week.supply[h][f];
  return {
    limit: Math.max(0, Math.min(week.need[z][f], week.intake[z], inStock, week.hours[h] / inst.hoursPerLb[z][h])),
    parts: { need: week.need[z][f], intake: week.intake[z], stock: inStock, truck: week.hours[h] / inst.hoursPerLb[z][h] },
    food: fd.label,
  };
}
