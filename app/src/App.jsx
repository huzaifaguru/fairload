import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import baseData from './core/data.json';
import { makeInstance, baseWeek, openingStock, pinLimit, FOODS, DEFAULTS } from './core/model.js';
import { applyEvents } from './core/sim.js';
import MapView from './MapView.jsx';
import Evidence from './Evidence.jsx';
import DataTab from './DataTab.jsx';
import { num, pct, signed } from './format.js';

const T = 8;
const VIEWS = { fair: 'FairLoad', capped: 'Capped poverty share', share: 'Poverty share', last: 'Repeat last period' };
const COUNTIES = ['New Castle', 'Kent', 'Sussex'];

function useSolver() {
  const ref = useRef(null), waiting = useRef(new Map()), next = useRef(1);
  if (!ref.current) {
    ref.current = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    ref.current.onmessage = ({ data }) => {
      const cb = waiting.current.get(data.id);
      waiting.current.delete(data.id);
      cb?.(data);
    };
  }
  return useCallback((type, payload) => new Promise(resolve => {
    const id = next.current++;
    waiting.current.set(id, resolve);
    ref.current.postMessage({ id, type, payload });
  }), []);
}

function Kpi({ label, value, compare, hint, better }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {compare && <div className={'kpi-compare ' + (better === true ? 'good' : better === false ? 'bad' : '')}>{compare}</div>}
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  );
}

function EventCard({ title, detail, on, onToggle, children }) {
  return (
    <div className={'event' + (on ? ' on' : '')}>
      <label className="event-head">
        <input type="checkbox" checked={on} onChange={e => onToggle(e.target.checked)} />
        <span><b>{title}</b><small>{detail}</small></span>
      </label>
      {on && <div className="event-body">{children}</div>}
    </div>
  );
}

function Curve({ points, tau }) {
  if (!points) return <div className="muted small">Working out the trade-off…</div>;
  const W = 320, H = 150, L = 34, R = 10, Tp = 10, B = 24;
  const x = v => L + (W - L - R) * v, y = v => Tp + (H - Tp - B) * (1 - v);
  const line = k => points.map((p, i) => `${i ? 'L' : 'M'}${x(p.tau).toFixed(1)} ${y(p[k]).toFixed(1)}`).join(' ');
  const cur = points.reduce((a, b) => (Math.abs(b.tau - tau) < Math.abs(a.tau - tau) ? b : a));
  return (
    <figure className="curve">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`At an equity target of ${pct(cur.tau, 0)}, ${pct(cur.needMet)} of need is met and the worst ZIP reaches ${pct(cur.worst)}.`}>
        {[0, 0.5, 1].map(v => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#DDE6E0" /><text x={L - 6} y={y(v) + 4} textAnchor="end" className="tick">{v * 100}%</text></g>)}
        <text x={x(0)} y={H - 6} className="tick">Target 0%</text>
        <text x={x(1)} y={H - 6} textAnchor="end" className="tick">100%</text>
        <line x1={x(tau)} x2={x(tau)} y1={Tp} y2={H - B} stroke="#8A9A90" strokeDasharray="3 3" />
        <path d={line('needMet')} fill="none" stroke="#00875A" strokeWidth="2" />
        <path d={line('worst')} fill="none" stroke="#D9481F" strokeWidth="2" />
        {points.map(p => <g key={p.tau}>
          <circle cx={x(p.tau)} cy={y(p.needMet)} r="3.5" fill="#00875A" stroke="#fff"><title>Target {pct(p.tau, 0)}: {pct(p.needMet)} of need met</title></circle>
          <circle cx={x(p.tau)} cy={y(p.worst)} r="3.5" fill="#D9481F" stroke="#fff"><title>Target {pct(p.tau, 0)}: worst ZIP at {pct(p.worst)}</title></circle>
        </g>)}
      </svg>
      <figcaption><span><i style={{ background: '#00875A' }} />Need met overall</span><span><i style={{ background: '#D9481F' }} />Worst-served ZIP</span></figcaption>
    </figure>
  );
}

export default function App() {
  const solve = useSolver();
  const [tab, setTab] = useState('plan');
  const [data, setData] = useState(baseData);
  const [params, setParams] = useState({});
  const [tau, setTau] = useState(DEFAULTS.tau);
  const [ev, setEv] = useState({ truck: false, truckHub: 1, surge: false, surgeHub: 1, demand: false, county: 'New Castle', cold: false, coldHub: 0 });
  const [pins, setPins] = useState([]);
  const [sel, setSel] = useState(0);
  const [view, setView] = useState('fair');
  const [res, setRes] = useState(null);
  const [curve, setCurve] = useState(null);
  const [whatif, setWhatif] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [pinForm, setPinForm] = useState({ h: 0, f: 0, lb: 0 });
  const seq = useRef(0);

  const events = useMemo(() => {
    const e = [];
    if (ev.truck) e.push({ type: 'truck', hub: ev.truckHub, start: 0, weeks: 4 });
    if (ev.surge) e.push({ type: 'surge', hub: ev.surgeHub, food: 0, mult: 4, start: 0, weeks: 2 });
    if (ev.demand) e.push({ type: 'demand', county: ev.county, mult: 1.4, start: 0, weeks: 6 });
    if (ev.cold) e.push({ type: 'cold', hub: ev.coldHub, factor: 0.3, start: 0, weeks: 3 });
    return e;
  }, [ev]);

  useEffect(() => {
    const id = ++seq.current;
    setBusy(true);
    const timer = setTimeout(async () => {
      const r = await solve('plan', { data, params, events, tau, pins, T });
      if (id !== seq.current) return;
      setBusy(false);
      if (r.error) { setError(r.error); return; }
      if (r.result.infeasible) { setError('Those forced shipments cannot all happen together: they need more food or truck time than the system has. Remove one and try again.'); return; }
      setError(''); setRes(r.result);
      const w = await solve('whatif', { data, params, events, tau, T, worstZip: r.result.fair.worstZip });
      if (id === seq.current && !w.error) setWhatif({ rows: w.result, worstZip: r.result.fair.worstZip });
    }, 180);
    return () => clearTimeout(timer);
  }, [data, params, events, tau, pins, solve]);

  useEffect(() => {
    let live = true;
    setCurve(null);
    const t = setTimeout(async () => { const r = await solve('curve', { data, params, events, T }); if (live && !r.error) setCurve(r.result); }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [data, params, events, solve]);

  const inst = useMemo(() => makeInstance(data, params), [data, params]);
  const week0 = useMemo(() => applyEvents(inst, baseWeek(inst), events, 0), [inst, events]);
  const stock0 = useMemo(() => openingStock(inst), [inst]);
  const zip = data.zips[sel] ?? data.zips[0];
  const limit = pinLimit(inst, week0, stock0, { h: pinForm.h, z: sel, f: pinForm.f });
  const lim = Math.floor(limit.limit);
  const pinLb = Math.min(pinForm.lb || Math.min(500, lim), lim);
  const limitWhy = Object.entries({ 'pantry need': limit.parts.need, 'site intake': limit.parts.intake, 'hub stock': limit.parts.stock, 'truck time': limit.parts.truck }).sort((a, b) => a[1] - b[1])[0][0];

  const f = res?.fair, shown = res ? (view === 'fair' ? f : res.rules[view]) : null, cap = res?.rules.capped;
  const weekShips = shown?.shipments?.[0] ?? [];
  const zipShips = weekShips.filter(s => s.z === sel);
  const routes = useMemo(() => {
    const m = {};
    zipShips.forEach(s => { m[s.h] = (m[s.h] ?? 0) + s.lb; });
    return Object.entries(m).map(([h, lb]) => ({ from: data.hubs[h], to: zip, lb }));
  }, [shown, sel, data]);

  const price = useMemo(() => {
    if (!res?.unpinned || !f) return null;
    const u = res.unpinned, losers = f.cov.map((c, i) => ({ i, d: (c - u.cov[i]) })).filter(x => x.d < -0.002).sort((a, b) => a.d - b.d).slice(0, 3);
    return { delivered: f.delivered - u.delivered, waste: f.waste - u.waste, miles: f.miles - u.miles, worst: f.worst - u.worst, losers };
  }, [res, f]);

  const bottlenecks = useMemo(() => {
    if (!f) return [];
    const agg = {};
    for (const [name, dual] of Object.entries(f.shadow)) {
      const [kind, id] = name.split('_'), key = kind + '_' + id;
      (agg[key] ??= { kind, id: +id, weeks: 0, sum: 0 }); agg[key].weeks++; agg[key].sum += dual;
    }
    return Object.values(agg).map(a => ({
      ...a, avg: a.sum / a.weeks,
      name: a.kind === 'truck' ? `Truck time at ${data.hubs[a.id].name}` : a.kind === 'cold' ? `Cold storage at ${data.hubs[a.id].name}` : a.kind === 'dry' ? `Dry storage at ${data.hubs[a.id].name}` : `Site intake in ${data.zips[a.id].zip} ${data.zips[a.id].city}`,
    })).sort((a, b) => (b.kind === 'truck') - (a.kind === 'truck') || b.weeks - a.weeks || b.avg - a.avg).slice(0, 6);
  }, [f, data]);

  const addPin = () => { if (pinLb > 0) setPins(p => [...p, { h: pinForm.h, z: sel, f: pinForm.f, t: 0, lb: pinLb }]); };
  const exportCsv = () => {
    const rows = [['week', 'hub', 'zip', 'city', 'food', 'pounds', 'forced_by_manager']];
    f.shipments.forEach((wk, t) => wk.forEach(s => {
      const forced = t === 0 && pins.some(p => p.h === s.h && p.z === s.z && p.f === s.f);
      rows.push([t + 1, data.hubs[s.h].name, data.zips[s.z].zip, data.zips[s.z].city, FOODS[s.f].label, Math.round(s.lb), forced ? 'yes' : 'no']);
    }));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }));
    a.download = 'fairload_plan.csv'; a.click(); URL.revokeObjectURL(a.href);
  };

  const isBase = data === baseData;
  return (
    <div className="app">
      <header className="top">
        <div className="brand"><span className="logo" aria-hidden="true" /><div><b>FairLoad</b><small>Food bank allocation planner</small></div></div>
        <nav aria-label="Sections">
          {[['plan', 'Planner'], ['evidence', 'Test results'], ['data', 'Data and assumptions']].map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>{l}</button>)}
        </nav>
        <div className="status" role="status">{busy ? 'Solving…' : f ? `Solved in ${f.ms < 1000 ? Math.round(f.ms) + ' ms' : (f.ms / 1000).toFixed(1) + ' s'} in your browser` : ''}</div>
      </header>
      <div className="banner">{isBase ? 'Public test case: Delaware mobile pantry and Census data. Supply, need, capacity and spoilage are assumed, and results are simulated. Not an allocation recommendation; the Food Bank of Delaware is not a project partner.' : 'Using your uploaded data. It stays in this browser. Capacity, spoilage and need settings are still assumptions.'}</div>
      {error && <div className="error" role="alert">{error}</div>}

      {tab === 'plan' && <main className="planner">
        <aside className="controls">
          <section>
            <h2>What just happened?</h2>
            <p className="small muted">Each event starts this week. The plan re-solves straight away.</p>
            <EventCard title="Truck breakdown" detail="Lose one truck for 4 weeks" on={ev.truck} onToggle={v => setEv({ ...ev, truck: v })}>
              <label>Hub <select value={ev.truckHub} onChange={e => setEv({ ...ev, truckHub: +e.target.value })}>{data.hubs.map((h, i) => <option key={h.id} value={i}>{h.name}</option>)}</select></label>
            </EventCard>
            <EventCard title="Donation surge" detail="4× fresh produce for 2 weeks" on={ev.surge} onToggle={v => setEv({ ...ev, surge: v })}>
              <label>Hub <select value={ev.surgeHub} onChange={e => setEv({ ...ev, surgeHub: +e.target.value })}>{data.hubs.map((h, i) => <option key={h.id} value={i}>{h.name}</option>)}</select></label>
            </EventCard>
            <EventCard title="Demand spike" detail="40% more need for 6 weeks" on={ev.demand} onToggle={v => setEv({ ...ev, demand: v })}>
              <label>County <select value={ev.county} onChange={e => setEv({ ...ev, county: e.target.value })}>{COUNTIES.map(c => <option key={c}>{c}</option>)}</select></label>
            </EventCard>
            <EventCard title="Cold storage failure" detail="30% of capacity for 3 weeks" on={ev.cold} onToggle={v => setEv({ ...ev, cold: v })}>
              <label>Hub <select value={ev.coldHub} onChange={e => setEv({ ...ev, coldHub: +e.target.value })}>{data.hubs.map((h, i) => <option key={h.id} value={i}>{h.name}</option>)}</select></label>
            </EventCard>
          </section>
          <section>
            <h2>How fair should the plan be?</h2>
            <label className="slider">
              <span>Every ZIP should reach <b>{pct(tau, 0)}</b> of its need</span>
              <input type="range" min="0" max="1" step="0.05" value={tau} onChange={e => setTau(+e.target.value)} aria-label="Equity target" />
            </label>
            <Curve points={curve} tau={tau} />
          </section>
        </aside>

        <section className="center">
          <div className="kpis">
            <Kpi label="Need met, 8 weeks" value={f ? pct(f.needMet) : '…'} compare={f && `${signed((f.needMet - cap.needMet) * 100, v => v.toFixed(1))} pts vs capped rule`} better={f && (f.needMet > cap.needMet + 1e-4 ? true : f.needMet < cap.needMet - 1e-4 ? false : undefined)} hint={f && `${num(f.delivered)} of ${num(f.need)} lb`} />
            <Kpi label="Food wasted" value={f ? num(f.waste) + ' lb' : '…'} compare={f && `${signed(f.waste - cap.waste)} lb vs capped rule`} better={f && (f.waste < cap.waste - 1 ? true : f.waste > cap.waste + 1 ? false : undefined)} hint={f && pct(f.wastePct) + ' of supply'} />
            <Kpi label="Worst-served ZIP" value={f ? pct(f.worst) : '…'} compare={f && `${signed((f.worst - cap.worst) * 100, v => v.toFixed(1))} pts vs capped rule`} better={f && (f.worst > cap.worst + 1e-4 ? true : f.worst < cap.worst - 1e-4 ? false : undefined)} hint={f && `ZIP ${f.worstZip}`} />
            <Kpi label="People in ZIPs below 60%" value={f ? num(f.below60) : '…'} compare={f && `${signed(f.below60 - cap.below60)} vs capped rule`} better={f && (f.below60 < cap.below60 ? true : f.below60 > cap.below60 ? false : undefined)} hint="counted by people in poverty" />
            <Kpi label="Truck miles" value={f ? num(f.miles) : '…'} compare={f && `${signed(f.miles - cap.miles)} vs capped rule`} hint="truckload-equivalent" />
          </div>
          <div className="view-switch" role="group" aria-label="Plan shown on the map">
            <span className="small muted">Show on map:</span>
            {Object.entries(VIEWS).map(([k, l]) => <button key={k} className={view === k ? 'active' : ''} aria-pressed={view === k} onClick={() => setView(k)}>{l}{res && <em>{pct((k === 'fair' ? f : res.rules[k]).needMet, 0)}</em>}</button>)}
          </div>
          <MapView data={data} cov={shown?.cov} selected={sel} onSelect={setSel} routes={routes} />
          <p className="small muted fine">The planner uses expected weeks plus the events you switch on, and tells every plan about them. For results with random supply and need, see Test results.</p>
        </section>

        <aside className="detail">
          <section>
            <h2>{zip.zip} {zip.city}</h2>
            <p className="small muted">Click any dot on the map to choose a ZIP.</p>
            <label className="visually-hidden" htmlFor="zipsel">Choose ZIP</label>
            <select id="zipsel" value={sel} onChange={e => setSel(+e.target.value)}>{data.zips.map((z, i) => <option key={z.zip} value={i}>{z.zip} {z.city}</option>)}</select>
            <dl className="facts">
              <div><dt>People in poverty</dt><dd>{num(zip.poor)}</dd></div>
              <div><dt>Pantry sites</dt><dd>{zip.sites}</dd></div>
              <div><dt>Need met: {VIEWS[view]}</dt><dd>{shown ? pct(shown.cov[sel]) : '…'}</dd></div>
              <div><dt>Weekly site intake</dt><dd>{num(week0.intake[sel])} lb</dd></div>
            </dl>
            <h3>Week 1 shipments</h3>
            {zipShips.length === 0 ? <p className="small muted">None this week.</p> : <table className="mini"><thead><tr><th>From</th><th>Food</th><th className="r">Pounds</th></tr></thead><tbody>{zipShips.map((s, i) => <tr key={i}><td>{data.hubs[s.h].name}</td><td>{FOODS[s.f].label}</td><td className="r">{num(s.lb)}</td></tr>)}</tbody></table>}
          </section>

          <section className="pin">
            <h2>Pin and price</h2>
            <p className="small muted">Know something the model does not? Force a week 1 shipment and see what it costs.</p>
            <div className="row2">
              <label>From <select value={pinForm.h} onChange={e => setPinForm({ ...pinForm, h: +e.target.value })}>{data.hubs.map((h, i) => <option key={h.id} value={i}>{h.name}</option>)}</select></label>
              <label>Food <select value={pinForm.f} onChange={e => setPinForm({ ...pinForm, f: +e.target.value })}>{FOODS.map((x, i) => <option key={x.id} value={i}>{x.label}</option>)}</select></label>
            </div>
            <label className="slider"><span>Pounds to {zip.zip}: <b>{num(pinLb)}</b></span>
              <input type="range" min="0" max={lim} step="10" value={pinLb} onChange={e => setPinForm({ ...pinForm, lb: +e.target.value })} aria-label="Pounds to force" /></label>
            <p className="small muted">Limit {num(lim)} lb, set by {limitWhy}.</p>
            <button className="primary" disabled={!pinLb} onClick={addPin}>Pin this shipment</button>
            {pins.length > 0 && <ul className="pins">{pins.map((p, i) => <li key={i}>{num(p.lb)} lb {FOODS[p.f].label.toLowerCase()}, {data.hubs[p.h].name} to {data.zips[p.z].zip}<button aria-label="Remove pin" onClick={() => setPins(pins.filter((_, j) => j !== i))}>×</button></li>)}</ul>}
            {price && <div className="price" aria-live="polite">
              <b>What your pins cost over 8 weeks</b>
              <div><span>Food delivered</span><span>{signed(price.delivered)} lb</span></div>
              <div><span>Food wasted</span><span>{signed(price.waste)} lb</span></div>
              <div><span>Truck miles</span><span>{signed(price.miles)}</span></div>
              <div><span>Worst-served ZIP</span><span>{signed(price.worst * 100, v => v.toFixed(1))} pts</span></div>
              {price.losers.length > 0 && <p className="small">Who gives up the most: {price.losers.map(l => `${data.zips[l.i].zip} (${signed(l.d * 100, v => v.toFixed(1))} pts)`).join(', ')}.</p>}
              {Math.abs(price.delivered) < 1 && Math.abs(price.waste) < 1 && price.losers.length === 0 && <p className="small">This pin costs almost nothing, because the plan can work around it.</p>}
            </div>}
          </section>

          <section>
            <h2>What is holding the plan back?</h2>
            {bottlenecks.length === 0 ? <p className="small muted">Nothing is at its limit.</p> : <ul className="binds">{bottlenecks.map(b => <li key={b.kind + b.id}><span>{b.name}</span><small>at its limit in {b.weeks} of {T} weeks</small></li>)}</ul>}
            <h3>What would more be worth? (8 weeks)</h3>
            {!whatif ? <p className="small muted">Working it out…</p> : <table className="mini"><thead><tr><th>Add</th><th className="r">Food delivered</th><th className="r">Worst ZIP</th></tr></thead><tbody>{whatif.rows.map(r => <tr key={r.label}><td>{r.label}</td><td className="r">{signed(r.delivered)} lb</td><td className="r">{signed(r.worst * 100, v => v.toFixed(1))} pts</td></tr>)}</tbody></table>}
          </section>

          <section>
            <h2>Hub stock after week 1</h2>
            {f && <table className="mini"><thead><tr><th>Hub</th><th>Food</th><th className="r">Pounds by weeks left</th></tr></thead><tbody>
              {data.hubs.flatMap((h, hi) => FOODS.map((x, k) => {
                const b = f.stockAfter1[hi][k], tot = b.reduce((a, v) => a + v, 0);
                const cells = Number.isFinite(x.shelf) ? b.map((v, a) => (v >= 1 ? `${num(v)} (${x.shelf - a})` : null)).filter(Boolean).join(', ') : `${num(tot)} (long)`;
                return <tr key={h.id + x.id}><td>{h.name}</td><td>{x.label}</td><td className="r">{tot < 1 ? '0' : cells}</td></tr>;
              }))}
            </tbody></table>}
            <button className="secondary" disabled={!f} onClick={exportCsv}>Download full plan (CSV)</button>
          </section>
        </aside>
      </main>}

      {tab === 'evidence' && <Evidence />}
      {tab === 'data' && <DataTab data={data} baseData={baseData} setData={d => { setPins([]); setSel(0); setData(d); }} params={params} setParams={setParams} />}
    </div>
  );
}
