import React, { useState } from 'react';
import V from './core/validation.json';
import { num, pct, signed } from './format.js';

const POL = { last: 'Repeat last period', share: 'Share of people in poverty', capped: 'Poverty share, capped ±50%', static: 'One-forecast plan, no re-solve', fairload: 'FairLoad, weekly re-solve', hindsight: 'Perfect hindsight (upper bound)' };
const pts = v => signed(v * 100, x => x.toFixed(1));
const ciPts = c => `${(c[0] * 100).toFixed(1)} to ${(c[1] * 100).toFixed(1)}`;

// One difference per row, with its 95% interval, around a zero line.
function DiffChart({ rows, label }) {
  const H = 26, W = 760, L = 280, R = 60, top = 8, bottom = 26;
  const all = rows.flatMap(r => [...r.ci, r.v, 0]);
  const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.08 || 0.01;
  const x = v => L + (W - L - R) * (v - lo + pad) / (hi - lo + 2 * pad);
  const h = top + rows.length * H + bottom;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${h}`} role="img" aria-label={label}>
        <line x1={x(0)} x2={x(0)} y1={top} y2={h - bottom} stroke="#55665C" />
        <text x={x(0)} y={h - 8} textAnchor="middle" className="tick">No difference</text>
        {rows.map((r, i) => {
          const y = top + i * H + H / 2;
          return <g key={r.label}>
            <text x={L - 10} y={y + 4} textAnchor="end">{r.label}</text>
            <line x1={x(r.ci[0])} x2={x(r.ci[1])} y1={y} y2={y} stroke="#00875A" strokeWidth="2" />
            <circle cx={x(r.v)} cy={y} r="5" fill="#00875A" stroke="#fff" strokeWidth="1.5"><title>{r.label}: {pts(r.v)} points (95% interval {ciPts(r.ci)})</title></circle>
            <text x={x(r.ci[1]) + 8} y={y + 4} className="tick">{pts(r.v)}</text>
          </g>;
        })}
      </svg>
    </div>
  );
}

function Tradeoff({ rows }) {
  const W = 560, H = 230, L = 40, R = 16, T = 12, B = 34;
  const x = v => L + (W - L - R) * v, y = v => T + (H - T - B) * (1 - v);
  const path = k => rows.map((r, i) => `${i ? 'L' : 'M'}${x(r.tau).toFixed(1)} ${y(r[k]).toFixed(1)}`).join(' ');
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Need met and worst-served ZIP at each equity target">
        {[0, 0.25, 0.5, 0.75, 1].map(v => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#DDE6E0" /><text x={L - 6} y={y(v) + 4} textAnchor="end" className="tick">{v * 100}%</text></g>)}
        {rows.map(r => <text key={r.tau} x={x(r.tau)} y={H - 16} textAnchor="middle" className="tick">{Math.round(r.tau * 100)}</text>)}
        <text x={(L + W - R) / 2} y={H - 2} textAnchor="middle" className="tick">Equity target (%)</text>
        <path d={path('needMet')} fill="none" stroke="#00875A" strokeWidth="2" />
        <path d={path('worst')} fill="none" stroke="#D9481F" strokeWidth="2" />
        {rows.map(r => <g key={r.tau}>
          <circle cx={x(r.tau)} cy={y(r.needMet)} r="4" fill="#00875A" stroke="#fff"><title>Target {Math.round(r.tau * 100)}%: need met {pct(r.needMet)}</title></circle>
          <circle cx={x(r.tau)} cy={y(r.worst)} r="4" fill="#D9481F" stroke="#fff"><title>Target {Math.round(r.tau * 100)}%: worst ZIP {pct(r.worst)}</title></circle>
        </g>)}
      </svg>
      <div className="keys"><span><i style={{ background: '#00875A' }} />Need met overall</span><span><i style={{ background: '#D9481F' }} />Worst-served ZIP</span></div>
    </div>
  );
}

export default function Evidence() {
  const [name, setName] = useState('base');
  const names = Object.keys(V.scenarios), S = V.scenarios[name];
  // The strongest rule in each scenario, including the truck-aware rule.
  const strongest = n => {
    const c = V.scenarios[n], t = V.strongRule[n], manual = c.policies[c.bestRule];
    return t.needMet >= manual.needMet
      ? { name: 'Shortest routes with a 70% floor', gain: t.diff.needMet, waste: t.diff.waste, rule: t }
      : { name: POL[c.bestRule], gain: c.vsBest.needMet, waste: c.vsBest.waste, rule: manual };
  };
  const cases = names.map(n => ({ n, ...V.scenarios[n], top: strongest(n) }));
  const diffs = cases.map(c => c.top.gain.mean);
  const wasteMoves = cases.map(c => c.top.waste.mean);
  const fair = V.fairness.combined, f0 = fair.find(r => r.tau === 0), f70 = fair.find(r => r.tau === 0.7);
  const wi = l => V.whatIf.find(w => w.label.includes(l)), now = wi('Current');
  const base = V.scenarios.base, baseTop = cases[0].top, combTop = cases.find(c => c.n === 'combined').top, truckless = V.sensitivity.find(s => s.label.includes('300%'));
  const ruleWins = V.sensitivity.filter(s => s.base.ci95[0] <= 0 || s.combined.ci95[0] <= 0);
  return (
    <main className="page">
      <p className="lead">FairLoad met more need than the strongest rule we tested in all {names.length} simulated scenarios, by {(Math.min(...diffs) * 100).toFixed(1)} to {(Math.max(...diffs) * 100).toFixed(1)} percentage points. Most of that comes from limited truck time. When trucks never limit delivery, the gain over the hand rules falls to {pts(truckless.base.diff)} points.</p>
      <p className="bad-note"><b>These results are simulated.</b> They test the method under stated assumptions and are not real-world savings. Each scenario runs {V.seeds.test.length} random 12-week cases that were not used to set the model. Every policy goes through the same simulator and the same limits.</p>
      <div className="stats">
        <div className="stat"><b>{pts(baseTop.gain.mean)} pts</b><span>need met vs strongest rule, normal weeks (95% interval {ciPts(baseTop.gain.ci95)})</span></div>
        <div className="stat"><b>{pts(combTop.gain.mean)} pts</b><span>the same, with a truck breakdown and a demand spike together</span></div>
        <div className="stat"><b>{pts(base.vsStatic.needMet.mean)} pts</b><span>weekly re-solving vs one fixed forecast plan, normal weeks</span></div>
        <div className="stat"><b>{pts(base.toHindsight.mean)} pts</b><span>distance from the perfect-hindsight upper bound, normal weeks</span></div>
      </div>

      <section className="card">
        <h2>Need met compared with the strongest rule</h2>
        <p className="small muted">Points show the average gain across paired runs; lines show the 95% bootstrap interval. The strongest rule is picked after the fact for each scenario, which favors the rules.</p>
        <DiffChart rows={cases.map(c => ({ label: c.label, v: c.top.gain.mean, ci: c.top.gain.ci95 }))} label="FairLoad gain in need met over the strongest rule by scenario" />
      </section>

      <section className="card">
        <h2>What we found</h2>
        <ul className="plain">
          <li><b>Truck time drives the gain.</b> With fleet hours at 105% of current use the gain is {pts(V.sensitivity.find(x => x.label.includes('105%')).base.diff)} points; at 150% it is {pts(V.sensitivity.find(x => x.label.includes('150%')).base.diff)}. We have no real fleet data, so a food bank should check this first.</li>
          <li><b>FairLoad did not consistently cut waste.</b> Against the strongest rule, waste moved between {signed(Math.min(...wasteMoves))} and {signed(Math.max(...wasteMoves))} lb per 12 weeks, and it rose most after a truck breakdown. A produce surge wastes about {num(V.scenarios.surge.policies.fairload.waste)} lb under every policy because no plan can absorb it.</li>
          <li><b>Re-solving each week matters.</b> On normal weeks a one-forecast plan wasted {num(base.policies.static.waste)} lb, against {num(base.policies.fairload.waste)} lb for FairLoad, and met {(base.vsStatic.needMet.mean * 100).toFixed(1)} points less need.</li>
          <li><b>Allocation cannot fix a site shortage.</b> ZIP 19805 has {num(8020)} people in poverty and one recorded mobile pantry site. Its share of need met stays below 30% under every plan. In the model, one more site lifts it to {pct(wi('One more site').worst, 0)}. Fixed pantries may already serve this ZIP, so check that first.</li>
          <li><b>A fairness target cost little here.</b> With a truck breakdown and demand spike, moving the target from 0% to 70% cut people in ZIPs below 60% from {num(f0.below60)} to {num(f70.below60)}, for {(f0.needMet * 100 - f70.needMet * 100).toFixed(1)} points of need met.</li>
        </ul>
      </section>

      <section className="card">
        <h2>Every policy, one scenario at a time</h2>
        <div className="view-switch" role="group" aria-label="Scenario">
          {names.map(n => <button key={n} className={n === name ? 'active' : ''} aria-pressed={n === name} onClick={() => setName(n)}>{V.scenarios[n].label}</button>)}
        </div>
        <div className="tablewrap"><table className="full">
          <thead><tr><th>Policy</th><th className="r">Need met</th><th className="r">Food wasted (lb)</th><th className="r">Worst-served ZIP</th><th className="r">People in ZIPs below 60%</th><th className="r">Truck miles</th><th className="r">Solve time</th></tr></thead>
          <tbody>{Object.keys(POL).map(p => {
            const r = S.policies[p];
            return <tr key={p} className={p === 'fairload' ? 'me' : ''}><td>{POL[p]}</td><td className="r">{pct(r.needMet)}</td><td className="r">{num(r.waste)}</td><td className="r">{pct(r.worst)}</td><td className="r">{num(r.below60)}</td><td className="r">{num(r.miles)}</td><td className="r">{r.solveMs ? Math.round(r.solveMs) + ' ms' : 'none'}</td></tr>;
          })}
          <tr><td>Shortest routes with a 70% floor</td><td className="r">{pct(V.strongRule[name].needMet)}</td><td className="r">{num(V.strongRule[name].waste)}</td><td className="r">{pct(V.strongRule[name].worst)}</td><td className="r">{num(V.strongRule[name].below60)}</td><td className="r">{num(V.strongRule[name].miles)}</td><td className="r">none</td></tr>
          </tbody>
        </table></div>
        <p className="small muted fine">Averages over {V.seeds.test.length} runs of 12 weeks. Solve time is per solve in Node.js; FairLoad re-solves each week.</p>
      </section>

      <div className="grid2">
        <section className="card">
          <h2>Does more fairness cost food?</h2>
          <Tradeoff rows={V.fairness.combined} />
          <p className="small muted fine">Truck breakdown plus demand spike, {V.seeds.quick.length} runs per target. The worst-served ZIP stays flat because its one pantry site limits it. The gain shows up in ZIPs just below 60%, reported above. Targets above 70% lower need met without helping further here.</p>
        </section>
        <section className="card">
          <h2>What would extra resources be worth?</h2>
          <div className="tablewrap"><table className="full">
            <thead><tr><th>Change</th><th className="r">Need met</th><th className="r">Worst ZIP</th><th className="r">Below 60%</th></tr></thead>
            <tbody>{V.whatIf.map(w => <tr key={w.label}><td>{w.label}</td><td className="r">{pct(w.needMet)}</td><td className="r">{pct(w.worst)}</td><td className="r">{num(w.below60)}</td></tr>)}</tbody>
          </table></div>
          <p className="small muted fine">FairLoad re-run with each change on normal weeks, {V.seeds.quick.length} runs each. Comparing whole runs is more reliable than reading one shadow price.</p>
        </section>
      </div>

      <section className="card">
        <h2>If our assumptions are wrong</h2>
        <p>Gain in need met over the best hand rule, recalculated with each assumption changed. {ruleWins.length === 0 ? 'The interval stays above zero in every row, but it is close to zero when trucks never limit delivery.' : `The interval reaches zero or below in ${ruleWins.length} of ${V.sensitivity.length} settings, where FairLoad has no clear advantage.`}</p>
        <div className="tablewrap"><table className="full">
          <thead><tr><th>Assumption changed</th><th className="r">Normal weeks: gain (pts)</th><th className="r">95% interval</th><th className="r">Disruptions: gain (pts)</th><th className="r">95% interval</th></tr></thead>
          <tbody>{V.sensitivity.map(s => <tr key={s.label}><td>{s.label}</td><td className="r">{pts(s.base.diff)}</td><td className="r">{ciPts(s.base.ci95)}</td><td className="r">{pts(s.combined.diff)}</td><td className="r">{ciPts(s.combined.ci95)}</td></tr>)}</tbody>
        </table></div>
        <p className="small muted fine">{V.seeds.quick.length} runs per setting. Disruptions means a truck breakdown and a demand spike together.</p>
      </section>
    </main>
  );
}
