import React, { useState } from 'react';
import { DEFAULTS, FOODS } from './core/model.js';
import { num } from './format.js';

const COLS = ['zip', 'city', 'lat', 'lng', 'people_in_poverty', 'population', 'sites', 'pounds'];
const hav = (a, b) => {
  const R = 3958.8, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dg = (b[1] - a[1]) * r;
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dg / 2) ** 2));
};

// Returns zips, or throws a message a person can act on.
export function parseCsv(text, hubs) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 3) throw new Error('The file needs a header row and at least two areas.');
  const head = lines[0].split(',').map(s => s.trim().toLowerCase());
  const missing = COLS.filter(c => !head.includes(c));
  if (missing.length) throw new Error('Missing columns: ' + missing.join(', '));
  return lines.slice(1).map((l, n) => {
    const v = l.split(','), g = c => (v[head.indexOf(c)] ?? '').trim();
    const z = { zip: g('zip'), city: g('city'), lat: +g('lat'), lng: +g('lng'), poor: +g('people_in_poverty'), pop: +g('population'), sites: +g('sites'), lbs: +g('pounds') };
    for (const k of ['lat', 'lng', 'poor', 'pop', 'sites', 'lbs']) if (!Number.isFinite(z[k]) || g(k === 'poor' ? 'people_in_poverty' : k === 'pop' ? 'population' : k === 'lbs' ? 'pounds' : k) === '') throw new Error(`Row ${n + 2}: ${k} is not a number.`);
    if (z.poor <= 0 || z.sites <= 0) throw new Error(`Row ${n + 2}: people in poverty and sites must be above zero.`);
    z.dist = hubs.map(h => +(hav([z.lat, z.lng], [h.lat, h.lng]) * 1.3).toFixed(2));
    return z;
  });
}

const SETTINGS = [
  ['supplyRatio', 'Supply as a share of need', 0.5, 1.2, 0.05, v => Math.round(v * 100) + '%'],
  ['truckSlack', 'Fleet hours vs what the current allocation uses', 1, 3, 0.05, v => Math.round(v * 100) + '%'],
  ['siteIntakeMult', 'Site intake vs busy-site pounds', 0.5, 5, 0.25, v => v + '×'],
  ['coldWeeks', 'Cold storage, weeks of inflow', 0.5, 4, 0.25, v => v + ' wk'],
  ['spoilMult', 'Spoilage multiplier', 0.25, 3, 0.25, v => v + '×'],
  ['needBlend', 'Need based on total population instead of poverty', 0, 1, 0.1, v => Math.round(v * 100) + '%'],
];

export default function DataTab({ data, baseData, setData, params, setParams }) {
  const [msg, setMsg] = useState('');
  const [hubs, setHubs] = useState(data.hubs);
  const template = () => {
    const rows = [COLS.join(','), ...baseData.zips.map(z => [z.zip, z.city, z.lat, z.lng, z.poor, z.pop, z.sites, z.lbs].join(','))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    a.download = 'fairload_template.csv'; a.click(); URL.revokeObjectURL(a.href);
  };
  const upload = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const zips = parseCsv(await file.text(), hubs);
      setData({ ...baseData, hubs, zips, unserved: [], unservedN: 0, unservedPoor: 0 });
      setMsg(`Loaded ${zips.length} areas from ${file.name}. Open Planner to see the plan.`);
    } catch (err) { setMsg('Could not load that file. ' + err.message); }
    e.target.value = '';
  };
  return (
    <main className="page">
      <div className="grid2">
        <section className="card">
          <h2>Real data</h2>
          <ul className="plain">
            <li><b>Pantry pounds, locations and site counts:</b> Food Bank of Delaware Mobile Pantries, Q1 and Q2 FY25, from FirstMap Delaware.</li>
            <li><b>People in poverty and population by ZIP:</b> ACS 2020–2024 5-year estimates, tables B17001 and B01003, through Census Reporter.</li>
            <li><b>Cleaning:</b> 5 records removed (one mass event, two implausible values, one missing value, one exact duplicate), plus one ZIP with no measured poverty. {num(baseData.totalLb)} lb across {baseData.zips.length} ZIPs remain.</li>
          </ul>
          <h3>Known limits</h3>
          <p>The records cover mobile pantries only, so fixed pantries are missing. They span two quarters, and most sites appear once. Poverty stands in for food need. A coverage gap is a question to investigate, not proof of unfairness.</p>
          {baseData.unservedN > 0 && <p>{baseData.unservedN} Delaware ZIPs with {num(baseData.unservedPoor)} people in poverty have no mobile pantry record and are outside this model. The largest are {baseData.unserved.slice(0, 5).map(u => `${u.zip} (${num(u.poor)})`).join(', ')}.</p>}
        </section>
        <section className="card">
          <h2>Assumed and adjustable</h2>
          <p className="small muted">None of these are in the public data. Change one and the Planner re-solves.</p>
          {SETTINGS.map(([k, label, min, max, step, fmt]) => {
            const v = params[k] ?? DEFAULTS[k];
            return <label className="slider" key={k}><span>{label}: <b>{fmt(v)}</b></span><input type="range" min={min} max={max} step={step} value={v} onChange={e => setParams({ ...params, [k]: +e.target.value })} /></label>;
          })}
          <button className="secondary" onClick={() => setParams({})}>Reset to defaults</button>
          <h3>Food assumptions</h3>
          <table className="mini"><thead><tr><th>Food</th><th className="r">Share</th><th className="r">Shelf life</th><th className="r">Weekly spoilage</th></tr></thead><tbody>
            {FOODS.map(f => <tr key={f.id}><td>{f.label}</td><td className="r">{f.share * 100}%</td><td className="r">{Number.isFinite(f.shelf) ? f.shelf + ' weeks' : 'Long'}</td><td className="r">{f.spoil * 100}%</td></tr>)}
          </tbody></table>
          <p className="small muted">Also assumed: {num(DEFAULTS.truckLb)} lb per truckload, {DEFAULTS.speed} mph, {DEFAULTS.handling} handling hours per load, 1.3× road circuity, and approximate hub locations. Truckloads can be fractional, and pantry orders are known when trucks are loaded.</p>
        </section>
      </div>
      <section className="card">
        <h2>Use your own data</h2>
        <p>Upload a CSV with these columns: <code>{COLS.join(', ')}</code>. Pounds should cover two quarters. The file is read in this browser and is not sent anywhere.</p>
        <div className="row-hubs">
          {hubs.map((h, i) => <fieldset key={i}><legend>Hub {i + 1}</legend>
            <label>Name <input value={h.name} onChange={e => setHubs(hubs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></label>
            <label>Latitude <input type="number" step="0.01" value={h.lat} onChange={e => setHubs(hubs.map((x, j) => (j === i ? { ...x, lat: +e.target.value } : x)))} /></label>
            <label>Longitude <input type="number" step="0.01" value={h.lng} onChange={e => setHubs(hubs.map((x, j) => (j === i ? { ...x, lng: +e.target.value } : x)))} /></label>
          </fieldset>)}
        </div>
        <div className="actions">
          <label className="file primary">Upload CSV<input type="file" accept=".csv,text/csv" onChange={upload} /></label>
          <button className="secondary" onClick={template}>Download template</button>
          <button className="secondary" onClick={() => { setHubs(baseData.hubs); setData(baseData); setMsg('Back to the Delaware test case.'); }}>Use Delaware data</button>
        </div>
        {msg && <p role="status">{msg}</p>}
      </section>
    </main>
  );
}
