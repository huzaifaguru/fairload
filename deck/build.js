// Builds the DataNova proposal deck. All figures are read from data/processed/pilot.json.
const fs = require('fs'), path = require('path');
const pptxgen = require('pptxgenjs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const sharp = require('sharp');
const fa = require('react-icons/fa');
const { applyTheme } = require(process.env.PPTX_SKILL + '/scripts/apply_theme.js');

const P = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/processed/pilot.json')));
const num = n => Math.round(n).toLocaleString('en-US');
const R = Object.fromEntries(P.results.map(r => [r.delta, r]));
const A = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(__dirname, '../data/processed/audit.json'))).map(r => [r.name, r]));
const aNow = A['current'], aLP = A['LP +/-50%'], aRule = A['RULE population share capped +/-50%'];
const shortCut = Math.round((1 - aLP.wShort / aNow.wShort) * 100);
const base = R[0], best = R[0.5];
const cut = Math.round((1 - best.poorUnder50 / base.poorUnder50) * 100);
const movedPct = Math.round(best.moved / P.lb * 100);
const zipsAsc = P.zips;
const lo = zipsAsc[0], hi = zipsAsc[zipsAsc.length - 1];
const gap = Math.round((hi.lbs / hi.poor) / (lo.lbs / lo.poor));
const unservedPct = Math.round(P.unservedPoor / P.statePoor * 100);
const slowest = Math.max(...P.results.filter(r => r.ms).map(r => r.ms));

const THEME = {
  name: 'FairLoad Harvest', headFontFace: 'Cambria', bodyFontFace: 'Calibri',
  colors: { dk1: '17291F', lt1: 'FFFFFF', dk2: '1F4D3A', lt2: 'EDF4EF', accent1: '2F7D5B', accent2: 'D9481F', accent3: 'F2A541', accent4: '55665C', accent5: '8CBFA3', accent6: '5B3A29', hlink: '2F7D5B', folHlink: '55665C' },
};
const HEX = THEME.colors;

const icon = async (Comp, color = 'FFFFFF') => {
  const svg = renderToStaticMarkup(React.createElement(Comp, { color: '#' + color, size: 256 }));
  return 'image/png;base64,' + (await sharp(Buffer.from(svg)).png().toBuffer()).toString('base64');
};

(async () => {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = 'FairLoad: DataNova 2026 proposal (DN-SI-01)';
  pres.subject = 'Food Bank Resource Allocation Optimization';
  pres.author = '404 Error Found';
  pres.company = '404 Error Found';
  pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
  const C = pres.SchemeColor;

  pres.defineSlideMaster({
    title: 'DARK', background: { color: C.text2 },
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: 0.8, y: 2.0, w: 8.2, h: 1.5, fontSize: 60, bold: true, color: C.background1, align: 'left', valign: 'bottom', margin: 0 }, text: 'Title' } },
      { placeholder: { options: { name: 'body', type: 'body', x: 0.8, y: 3.65, w: 8.2, h: 1.1, fontSize: 24, color: C.background2, align: 'left', valign: 'top', margin: 0 }, text: 'Subtitle' } },
    ],
  });
  pres.defineSlideMaster({
    title: 'CONTENT', background: { color: C.background1 },
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 0.4, w: 12.13, h: 1.0, fontSize: 30, bold: true, color: C.text2, align: 'left', valign: 'top', margin: 0 }, text: 'Title' } },
      { text: { text: 'FairLoad  |  DataNova 2026  |  DN-SI-01', options: { x: 0.6, y: 7.0, w: 6, h: 0.3, fontSize: 10, color: C.accent4, margin: 0 } } },
    ],
    slideNumber: { x: 12.13, y: 7.0, w: 0.6, h: 0.3, fontSize: 10, color: C.accent4, align: 'right' },
  });

  const txt = (s, t, o) => s.addText(t, { isTextBox: true, margin: 0, color: C.text1, fontSize: 15, valign: 'top', ...o });
  const card = (s, x, y, w, h, fill = C.background2, name = 'Card') => s.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.08, fill: { color: fill }, line: { color: fill, width: 0 }, objectName: name });
  const badge = async (s, Comp, x, y, d = 0.6, fill = C.accent1) => {
    s.addShape(pres.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill, width: 0 }, objectName: 'Icon circle' });
    s.addImage({ data: await icon(Comp), x: x + d * 0.24, y: y + d * 0.24, w: d * 0.52, h: d * 0.52, altText: 'icon' });
  };
  const stat = (s, big, label, x, y, w, color = C.text2) => {
    txt(s, big, { x, y, w, h: 0.8, fontSize: 42, bold: true, color, fontFace: 'Cambria' });
    txt(s, label, { x, y: y + 0.82, w, h: 0.75, fontSize: 14, color: C.text1 });
  };
  const note = (s, t, y = 6.42, h = 0.45) => txt(s, t, { x: 0.6, y, w: 12.13, h, fontSize: 11, color: C.accent4 });

  // Reusable Delaware dot map from real ZIP coordinates
  const drawMap = (s, X, Y, H) => {
    const latMax = 39.85, latMin = 38.44, lngMin = -75.82, lngMax = -75.04;
    const sy = H / (latMax - latMin), sx = sy * Math.cos(39.1 * Math.PI / 180);
    const px = lng => X + (lng - lngMin) * sx, py = lat => Y + (latMax - lat) * sy;
    for (const z of P.zips) {
      const d = 0.09 + Math.sqrt(z.poor) * 0.0028;
      const low = z.cov < 0.5 * P.avg;
      s.addShape(pres.ShapeType.ellipse, { x: px(z.lng) - d / 2, y: py(z.lat) - d / 2, w: d, h: d, fill: { color: low ? C.accent2 : C.accent1, transparency: 15 }, line: { color: C.background1, width: 0.5 }, objectName: `ZIP ${z.zip}` });
    }
    for (const [n, c] of Object.entries(P.assumptions.HUBS)) {
      s.addShape(pres.ShapeType.diamond, { x: px(c[1]) - 0.11, y: py(c[0]) - 0.11, w: 0.22, h: 0.22, fill: { color: C.accent3 }, line: { color: C.text1, width: 0.75 }, objectName: `Hub ${n}` });
    }
    return (Math.abs(lngMax - lngMin)) * sx;
  };

  // 1 ---------------------------------------------------------------- title
  pres.addSection({ title: 'Proposal' });
  let s = pres.addSlide({ masterName: 'DARK', sectionTitle: 'Proposal' });
  s.addText('FairLoad', { placeholder: 'title' });
  s.addText('A live decision tool for sharing donated food fairly', { placeholder: 'body' });
  txt(s, 'Problem statement DN-SI-01: Food Bank Resource Allocation Optimization\nTrack: Healthcare & Social Impact  |  DataNova 2026 Global Data-thon', { x: 0.8, y: 5.0, w: 8.2, h: 0.8, fontSize: 15, color: C.background2 });
  txt(s, 'Team: 404 Error Found', { x: 0.8, y: 5.95, w: 8.2, h: 0.4, fontSize: 15, bold: true, color: C.accent3 });
  drawMap(s, 10.0, 0.75, 6.0);
  s.addNotes('FairLoad helps a food bank decide where limited food should go each week, and shows the trade-offs behind each decision. The dots are real Delaware ZIP codes from the public data we used. Yellow diamonds mark the two Food Bank of Delaware facility areas.');

  // 2 ---------------------------------------------------------------- problem
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Proposal' });
  s.addText('Every shipment trades off speed, reach and fairness', { placeholder: 'title' });
  txt(s, 'Food banks receive donations they cannot fully predict, then must place them across many communities with limited trucks, storage and time.', { x: 0.6, y: 1.45, w: 12.13, h: 0.7, fontSize: 18 });
  const tensions = [
    [fa.FaAppleAlt, 'Food has a clock', 'Fresh produce can spoil while it waits, so holding stock for a better plan has a real cost.'],
    [fa.FaTruck, 'Capacity is limited', 'Trucks, cold storage and pantry intake restrict what can move, even when food is available.'],
    [fa.FaBalanceScale, 'Fair is not simple', 'Delivering the most pounds can favor easy-to-reach sites over the communities with the greatest need.'],
  ];
  for (let i = 0; i < 3; i++) {
    const x = 0.6 + i * 4.14;
    card(s, x, 2.4, 3.85, 2.55);
    await badge(s, tensions[i][0], x + 0.25, 2.62);
    txt(s, tensions[i][1], { x: x + 0.25, y: 3.32, w: 3.35, h: 0.4, fontSize: 19, bold: true, color: C.text2 });
    txt(s, tensions[i][2], { x: x + 0.25, y: 3.75, w: 3.35, h: 1.1, fontSize: 14 });
  }
  txt(s, [{ text: 'Who it is for: ', options: { bold: true, color: C.text2 } }, { text: 'food bank operations managers and allocation planners who must make and defend these decisions every week.' }], { x: 0.6, y: 5.25, w: 12.13, h: 0.4, fontSize: 16 });
  txt(s, [{ text: 'Why it matters: ', options: { bold: true, color: C.text2 } }, { text: 'a poor allocation can mean wasted food and unmet need at the same time.' }], { x: 0.6, y: 5.72, w: 12.13, h: 0.4, fontSize: 16 });
  s.addNotes('Research on food bank distribution, including Orgut et al. in IIE Transactions 2016, treats equity and effectiveness as competing goals under capacity limits. That is the decision we are supporting.');

  // 3 ---------------------------------------------------------------- real data
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Proposal' });
  s.addText('Real data shows pounds and local need can diverge sharply', { placeholder: 'title' });
  const show = [...zipsAsc.slice(0, 5), ...zipsAsc.slice(-5)];
  const lab = show.map(z => `${z.zip} ${z.city}`).reverse();
  const vals = show.map(z => z.cov).reverse();
  s.addChart(pres.charts.BAR, [{ name: 'Pounds per person in poverty', labels: lab, values: vals }], {
    x: 0.6, y: 1.4, w: 8.0, h: 4.95, barDir: 'bar', barGapWidthPct: 35,
    chartColors: show.map((z, i) => (i < 5 ? HEX.accent2 : HEX.accent1)).reverse(),
    invertedColors: [HEX.accent1],
    showTitle: true, title: 'Mobile pantry pounds per person in poverty, five highest and five lowest ZIPs', titleFontSize: 13, titleColor: HEX.dk1, titleFontFace: '+mn-lt',
    showValue: true, dataLabelPosition: 'outEnd', dataLabelFontSize: 12, dataLabelColor: HEX.dk1, dataLabelFontFace: '+mn-lt', dataLabelFormatCode: '0.0',
    catAxisLabelFontSize: 12, catAxisLabelColor: HEX.dk1, catAxisLabelFontFace: '+mn-lt', valAxisHidden: true, valGridLine: { style: 'none' }, catGridLine: { style: 'none' }, showLegend: false,
    altText: 'Bar chart of pounds per person in poverty by ZIP code',
  });
  stat(s, `${gap}×`, `gap between the highest and lowest ZIP (${hi.cov} vs ${lo.cov} lb)`, 9.0, 1.5, 3.73, C.accent2);
  stat(s, `${unservedPct}%`, `of Delaware's people in poverty live in ZIPs with no mobile pantry record`, 9.0, 3.1, 3.73);
  card(s, 9.0, 4.72, 3.73, 1.6);
  txt(s, [{ text: 'Read with care: ', options: { bold: true, color: C.text2 } }, { text: 'this covers mobile pantries only. Urban ZIPs may rely on fixed pantries, so a gap is a question to investigate, not proof of unfairness.' }], { x: 9.18, y: 4.8, w: 3.37, h: 1.44, fontSize: 14, valign: 'middle' });
  note(s, `Sources: Food Bank of Delaware Mobile Pantries, Q1–Q2 FY25 (FirstMap Delaware); ACS 2020–2024 5-year, table B17001 (via Census Reporter). ${num(P.lb)} lb across ${P.nZipModel} ZIPs after cleaning; ZIP codes matched to ZCTAs.`);
  s.addNotes(`We joined public pantry records to Census poverty counts. We removed ${P.excluded.length} records: a one-off mass event, two implausible values, one missing value and one exact duplicate. We excluded one ZIP with no measured poverty. The field name suggests pounds and boxes may be mixed, which we will test in the sensitivity analysis.`);

  // 4 ---------------------------------------------------------------- solution
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Proposal' });
  s.addText('FairLoad turns a weekly allocation into a decision you can test', { placeholder: 'title' });
  const feats = [
    [fa.FaRoute, 'Recommend', 'Generates a shipping plan across hubs and pantries for each food type.'],
    [fa.FaBolt, 'Stress-test', 'Re-solves live for a truck failure, donation surge or demand spike.'],
    [fa.FaSlidersH, 'Balance', 'A fairness slider shows pounds delivered against the worst-served area.'],
    [fa.FaThumbtack, 'Pin and price', 'A manager forces a shipment and sees exactly what that choice costs.'],
  ];
  for (let i = 0; i < 4; i++) {
    const y = 1.5 + i * 1.22;
    await badge(s, feats[i][0], 0.6, y + 0.05, 0.7, i === 3 ? C.accent2 : C.accent1);
    txt(s, feats[i][1], { x: 1.55, y, w: 5.6, h: 0.4, fontSize: 20, bold: true, color: i === 3 ? C.accent2 : C.text2 });
    txt(s, feats[i][2], { x: 1.55, y: y + 0.42, w: 5.6, h: 0.65, fontSize: 15 });
  }
  // concept screen
  card(s, 7.55, 1.45, 5.18, 4.85, C.text2, 'Concept screen');
  drawMap(s, 7.8, 1.65, 4.4);
  txt(s, 'Concept screen', { x: 10.2, y: 1.65, w: 2.3, h: 0.3, fontSize: 11, color: C.accent5 });
  card(s, 10.2, 2.0, 2.3, 1.05, C.background1, 'KPI panel');
  txt(s, 'Need met\nFood wasted\nWorst-served area', { x: 10.32, y: 2.08, w: 2.1, h: 0.9, fontSize: 13 });
  txt(s, 'Fairness', { x: 10.2, y: 3.25, w: 2.3, h: 0.3, fontSize: 13, color: C.background1, bold: true });
  s.addShape(pres.ShapeType.roundRect, { x: 10.2, y: 3.62, w: 2.3, h: 0.09, rectRadius: 0.04, fill: { color: C.accent5 }, line: { color: C.accent5, width: 0 }, objectName: 'Slider track' });
  s.addShape(pres.ShapeType.ellipse, { x: 11.35, y: 3.54, w: 0.25, h: 0.25, fill: { color: C.accent3 }, line: { color: C.background1, width: 1 }, objectName: 'Slider knob' });
  for (const [i, l] of ['Truck breaks down', 'Donation surge', 'Demand spike'].entries()) {
    s.addShape(pres.ShapeType.roundRect, { x: 10.2, y: 4.02 + i * 0.5, w: 2.3, h: 0.4, rectRadius: 0.06, fill: { color: C.background2 }, line: { color: C.background2, width: 0 }, objectName: 'Scenario button' });
    txt(s, l, { x: 10.32, y: 4.1 + i * 0.5, w: 2.1, h: 0.28, fontSize: 13 });
  }
  note(s, 'Concept only; the interface is in development. Map dots are real ZIP locations, sized by people in poverty. Red marks ZIPs below half the average pounds per person in poverty. Yellow diamonds are approximate hub locations.');
  s.addNotes('The pin and price feature is the core of the idea. Real managers know things a model does not. FairLoad lets them overrule the model and shows the cost in pounds of waste and unmet need. The model advises and the human decides.');

  // 5 ---------------------------------------------------------------- method
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Proposal' });
  s.addText('We add an optimizer where simple rules may fall short', { placeholder: 'title' });
  const steps = [['Public data', 'Pantry records, poverty and food-insecurity estimates'], ['Need estimate', 'People in need and pounds required, by ZIP'], ['Optimizer', 'Multi-week linear program solved with HiGHS'], ['Scenario tests', 'Plans tested on simulated supply and demand'], ['Human decision', 'Review, pin, re-solve and export']];
  const w5 = 2.2, gap5 = 0.2825;
  for (let i = 0; i < 5; i++) {
    const x = 0.6 + i * (w5 + gap5);
    card(s, x, 1.45, w5, 1.6, i === 2 ? C.text2 : C.background2);
    txt(s, steps[i][0], { x: x + 0.15, y: 1.56, w: w5 - 0.3, h: 0.36, fontSize: 16, bold: true, color: i === 2 ? C.background1 : C.text2 });
    txt(s, steps[i][1], { x: x + 0.15, y: 1.94, w: w5 - 0.3, h: 1.05, fontSize: 14, color: i === 2 ? C.background1 : C.text1 });
    if (i < 4) s.addShape(pres.ShapeType.rightArrow, { x: x + w5 + 0.04, y: 2.13, w: 0.2, h: 0.24, fill: { color: C.accent1 }, line: { color: C.accent1, width: 0 }, objectName: 'Arrow' });
  }
  const cols = [
    ['It decides', ['Pounds per route, week and food type', 'Stock to hold, by shelf-life bucket']],
    ['It minimizes', ['Food wasted', 'Need left unmet', 'Falling short of an equity target']],
    ['It respects', ['Truck miles and hub stock', 'Pantry intake and cold storage', 'Spoilage over time']],
  ];
  for (let i = 0; i < 3; i++) {
    const x = 0.6 + i * 4.14;
    txt(s, cols[i][0], { x, y: 3.35, w: 3.85, h: 0.4, fontSize: 19, bold: true, color: C.text2 });
    txt(s, cols[i][1].map((t, j, a) => ({ text: t, options: { bullet: { indent: 16 }, breakLine: j < a.length - 1, paraSpaceAfter: 4 } })), { x, y: 3.8, w: 3.85, h: 1.3, fontSize: 15 });
  }
  card(s, 0.6, 5.25, 12.13, 1.05);
  await badge(s, fa.FaServer, 0.8, 5.47, 0.6, C.accent2);
  txt(s, [{ text: 'No server required. ', options: { bold: true, color: C.text2 } }, { text: 'React, Leaflet and HiGHS compiled to WebAssembly run on free static hosting, so the demo stays available and food data can stay on the user\'s device.' }], { x: 1.6, y: 5.4, w: 10.9, h: 0.8, fontSize: 15, valign: 'middle' });
  s.addNotes('This is the planned model. A linear program gives an exact optimum and full traceability, which suits a decision people must be able to explain. Where a constraint binds, its shadow price can estimate the value of one more unit of that resource. Our pilot found that a simple rule was enough without these constraints, so the full model must show it adds value.');

  // 6 ---------------------------------------------------------------- pilot
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Proposal' });
  s.addText('Reallocation helps, but a simple rule matches our first model', { placeholder: 'title' });
  const pct = v => Math.round(v * 100) + '%';
  const head6 = (t, fill) => ({ text: t, options: { bold: true, color: C.background1, fill: { color: fill }, align: t === 'Measure' ? 'left' : 'right' } });
  const row6 = (label, a, b, c) => [
    { text: label, options: { bold: true, color: C.text2, fill: { color: C.background1 } } },
    { text: a, options: { align: 'right', color: C.text1, fill: { color: C.background1 } } },
    { text: b, options: { align: 'right', color: C.text1, fill: { color: C.background2 } } },
    { text: c, options: { align: 'right', color: C.text1, fill: { color: C.background2 } } },
  ];
  s.addTable([
    [head6('Measure', C.accent4), head6('Current', C.accent4), head6('Simple rule ±50%', C.accent1), head6('Optimizer ±50%', C.text2)],
    row6('Average shortfall (lb per person)', aNow.wShort.toFixed(2), aRule.wShort.toFixed(2), aLP.wShort.toFixed(2)),
    row6('People in low-coverage ZIPs', num(aNow.u50), num(aRule.u50), num(aLP.u50)),
    row6('Worst-served ZIP (lb per person)', aNow.worst.toFixed(2), aRule.worst.toFixed(2), aLP.worst.toFixed(2)),
    row6('Pounds moved', '0', num(aRule.moved), num(aLP.moved)),
    row6('Estimated truck miles vs current', '100%', pct(aRule.milesRatio), pct(aLP.milesRatio)),
  ], { x: 0.6, y: 1.5, w: 8.1, colW: [3.45, 1.15, 1.75, 1.75], rowH: 0.72, fontSize: 15, valign: 'middle', border: { type: 'solid', pt: 0.75, color: 'D5E2DA' }, margin: [0.04, 0.1, 0.04, 0.1] });
  stat(s, `−${shortCut}%`, 'average shortfall for both plans, using the same total pounds', 9.1, 1.5, 3.63, C.accent2);
  card(s, 9.1, 3.2, 3.63, 2.62);
  txt(s, [{ text: 'What this tells us', options: { bold: true, color: C.text2, breakLine: true, fontSize: 16 } }, { text: 'Truck miles did not limit this simple case, so the optimizer added no benefit. The real test comes with spoilage, capacity limits and disruptions.' }], { x: 9.28, y: 3.32, w: 3.27, h: 2.4, fontSize: 15, valign: 'middle' });
  note(s, 'Pilot on historical mobile pantry data; a feasibility test, not an allocation recommendation. Simple rule: split by share of people in poverty, with each ZIP limited to ±50% of its current pounds. Low coverage: below half the average pounds per person in poverty. Assumes 1.3× road circuity, 20,000 lb per truckload and approximate hub locations; demand and spoilage are not yet modeled.', 6.0, 0.8);
  s.addNotes(`Average shortfall is how far each ZIP falls below the average pounds per person in poverty, weighted by people in poverty. Both plans cut it by ${shortCut} percent. The number of people in low-coverage ZIPs also falls by ${cut} percent, but that measure is sensitive to ZIPs crossing the threshold, and the worst-served ZIP barely moves. In this simple case truck miles do not limit the plan, so a simple rule matches the optimizer while moving less food. We show this because the full model must beat this rule once spoilage, capacity and disruptions apply. If it does not, we will report that. We do not recommend moving food away from rural sites on this evidence, because fixed pantries are missing from the data.`);

  // 7 ---------------------------------------------------------------- what's new
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Proposal' });
  s.addText('Research provides the models; FairLoad makes them usable', { placeholder: 'title' });
  const rows7 = [
    [{ text: '', options: { fill: { color: C.background1 } } }, { text: 'Published food bank models', options: { bold: true, color: C.background1, fill: { color: C.accent4 } } }, { text: 'FairLoad (in development)', options: { bold: true, color: C.background1, fill: { color: C.text2 } } }],
    ['Form', 'Mathematical models and numerical studies', 'Interactive tool that runs in any browser'],
    ['Overrides', 'Not the focus of the work we reviewed', 'Pin any shipment and see its cost'],
    ['Disruption', 'Studied as uncertainty within a model', 'Trigger an event and re-solve on the spot'],
    ['Fairness', 'A set bound or parameter', 'A slider that shows the trade-off'],
    ['Evidence', 'Studies based on specific food bank data', 'Public data, open assumptions, repeatable tests'],
  ].map((r, i) => r.map((c, j) => {
    const cell = typeof c === 'string' ? { text: c, options: {} } : c;
    if (i > 0) { cell.options = { ...cell.options, fill: { color: j === 2 ? C.background2 : C.background1 }, bold: j === 0, color: j === 0 ? C.text2 : C.text1 }; }
    return cell;
  }));
  s.addTable(rows7, { x: 0.6, y: 1.5, w: 12.13, colW: [1.93, 5.1, 5.1], rowH: 0.62, fontSize: 16, valign: 'middle', border: { type: 'solid', pt: 0.75, color: 'D5E2DA' }, margin: [0.04, 0.12, 0.04, 0.12] });
  txt(s, 'We credit this research directly: our contribution is the decision experience around it, not new optimization theory.', { x: 0.6, y: 5.45, w: 12.13, h: 0.45, fontSize: 16, italic: true, color: C.text2 });
  note(s, 'Research reviewed at abstract level: Orgut, Ivy, Uzsoy & Wilson, IIE Transactions (2016); Orgut, Ivy, Uzsoy & Hale, European Journal of Operational Research (2018).', 6.1);
  s.addNotes('We are honest about where the originality lies. The research community has already established strong equity models, including stochastic and robust versions. The new part is putting those ideas in the hands of a manager, with overrides priced by the model.');

  // 8 ---------------------------------------------------------------- validation
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Proposal' });
  s.addText('We will test FairLoad against simple rules and a best case', { placeholder: 'title' });
  txt(s, 'Compare against', { x: 0.6, y: 1.45, w: 6, h: 0.4, fontSize: 20, bold: true, color: C.text2 });
  const bases = [['Population share', 'Split by share of people in poverty, with and without a ±50% limit'], ['Last period', 'Repeat the previous allocation'], ['Deterministic model', 'Optimize for one forecast only'], ['Perfect hindsight', 'Best possible result, used as an upper bound']];
  for (let i = 0; i < 4; i++) {
    const y = 1.95 + i * 0.84;
    card(s, 0.6, y, 5.9, 0.72);
    txt(s, [{ text: bases[i][0], options: { bold: true, color: C.text2, breakLine: true } }, { text: bases[i][1], options: { fontSize: 14 } }], { x: 0.78, y: y + 0.06, w: 5.55, h: 0.62, fontSize: 15 });
  }
  txt(s, 'Measure', { x: 6.95, y: 1.45, w: 5.7, h: 0.4, fontSize: 20, bold: true, color: C.text2 });
  txt(s, ['% of estimated need met', 'Pounds of food wasted', 'Worst-served ZIP and people in low-coverage ZIPs', 'Truck miles', 'Solve time in the browser'].map((t, j, a) => ({ text: t, options: { bullet: { indent: 16 }, breakLine: j < a.length - 1, paraSpaceAfter: 6 } })), { x: 6.95, y: 1.95, w: 5.78, h: 1.85, fontSize: 16 });
  txt(s, 'How we keep it honest', { x: 6.95, y: 3.82, w: 5.7, h: 0.4, fontSize: 20, bold: true, color: C.text2 });
  txt(s, ['Report results on scenarios not used for tuning', 'Vary spoilage, truck capacity and need assumptions', 'Test whether the source field mixes pounds and boxes'].map((t, j, a) => ({ text: t, options: { bullet: { indent: 16 }, breakLine: j < a.length - 1, paraSpaceAfter: 6 } })), { x: 6.95, y: 4.3, w: 5.78, h: 1.3, fontSize: 16 });
  txt(s, 'All results will be labeled as simulated. We will not present them as real-world savings.', { x: 0.6, y: 5.72, w: 12.13, h: 0.4, fontSize: 16, italic: true, color: C.accent2, bold: true });
  s.addNotes('Our pilot already showed a capped population-share rule matching the optimizer in a simple case, so this comparison is central. If the optimizer cannot beat that rule in a scenario, we will report that. The perfect-hindsight bound tells us how much value is left on the table.');

  // 9 ---------------------------------------------------------------- data & responsibility
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Proposal' });
  s.addText('We state what is real, what is assumed and who stays in charge', { placeholder: 'title' });
  card(s, 0.6, 1.5, 3.85, 4.3, C.background2);
  card(s, 4.74, 1.5, 3.85, 4.3, C.background2);
  card(s, 8.88, 1.5, 3.85, 4.3, C.text2);
  const col9 = (x, Ic, head, items, dark, fill) => [x, Ic, head, items, dark, fill];
  for (const [x, Ic, head, items, dark, fill] of [
    col9(0.6, fa.FaDatabase, 'Real data', ['Pantry pounds and locations', 'Poverty counts by ZIP', 'County food-insecurity estimates (planned)'], false, C.accent1),
    col9(4.74, fa.FaFlask, 'Assumed and disclosed', ['Donation flows', 'Spoilage rates', 'Truck and storage capacity', 'Road distances'], false, C.accent2),
    col9(8.88, fa.FaUserShield, 'Responsible use', ['Aggregate data only; no personal records', 'People make the final decision', 'Every override is visible', 'Attribution to data owners'], true, C.accent3),
  ]) {
    await badge(s, Ic, x + 0.25, 1.72, 0.6, fill);
    txt(s, head, { x: x + 0.25, y: 2.45, w: 3.35, h: 0.45, fontSize: 19, bold: true, color: dark ? C.background1 : C.text2 });
    txt(s, items.map((t, j, a) => ({ text: t, options: { bullet: { indent: 16 }, breakLine: j < a.length - 1, paraSpaceAfter: 8 } })), { x: x + 0.25, y: 2.95, w: 3.35, h: 2.7, fontSize: 16, color: dark ? C.background1 : C.text1 });
  }
  note(s, 'Known limits: mobile pantry records only, two quarters of data, poverty used as a proxy for need, and most sites observed only once. Delaware is a public test case; the Food Bank of Delaware is not a project partner.', 6.05);
  s.addNotes('A fairness tool that hides its assumptions would be a contradiction. Poverty is an imperfect proxy for food insecurity, and we will say so. We have not worked with the Food Bank of Delaware, and we do not claim they endorse this work.');

  // 10 --------------------------------------------------------------- impact & plan
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Proposal' });
  s.addText('Cheap to run, easy to adapt, three days from a working demo', { placeholder: 'title' });
  txt(s, 'Impact and feasibility', { x: 0.6, y: 1.5, w: 5.6, h: 0.4, fontSize: 20, bold: true, color: C.text2 });
  const imp = [[fa.FaCoins, 'Low cost', 'Free static hosting, with no license or server fees'], [fa.FaExchangeAlt, 'Adaptable', 'Designed so another food bank can load its own data'], [fa.FaGlobe, 'Beyond food', 'The approach could extend to medical and disaster supply allocation'], [fa.FaHandsHelping, 'Actionable', 'Aims to estimate the value of extra trucks or storage where they limit delivery']];
  for (let i = 0; i < 4; i++) {
    const y = 2.05 + i * 1.03;
    await badge(s, imp[i][0], 0.6, y, 0.6, C.accent1);
    txt(s, [{ text: imp[i][1], options: { bold: true, color: C.text2, breakLine: true, fontSize: 16 } }, { text: imp[i][2], options: { fontSize: 14 } }], { x: 1.4, y: y - 0.03, w: 4.95, h: 0.9 });
  }
  txt(s, 'Build plan', { x: 6.95, y: 1.5, w: 5.7, h: 0.4, fontSize: 20, bold: true, color: C.text2 });
  const plan = [['Done', 'Data join, cleaning and pilot optimizer', C.accent1], ['Day 1', 'Full model with spoilage and capacity, tested against simple rules', C.text2], ['Day 2', 'Browser app: map, disruptions, fairness slider, pin and price', C.text2], ['Day 3', 'Validation report, documentation, deployment and video', C.text2]];
  for (let i = 0; i < 4; i++) {
    const y = 2.05 + i * 1.03;
    s.addShape(pres.ShapeType.roundRect, { x: 6.95, y, w: 1.1, h: 0.82, rectRadius: 0.08, fill: { color: plan[i][2] }, line: { color: plan[i][2], width: 0 }, objectName: 'Plan label' });
    txt(s, plan[i][0], { x: 6.95, y, w: 1.1, h: 0.82, fontSize: 15, bold: true, color: C.background1, align: 'center', valign: 'middle' });
    card(s, 8.15, y, 4.58, 0.82);
    txt(s, plan[i][1], { x: 8.3, y: y + 0.08, w: 4.3, h: 0.66, fontSize: 15, valign: 'middle' });
  }
  s.addNotes('The pilot pipeline exists now. Over three days we will add the full model, build the app, and run the validation. We will also deliver the code, documentation and scenario analysis the problem statement asks for.');

  // 11 --------------------------------------------------------------- team & close
  s = pres.addSlide({ masterName: 'DARK', sectionTitle: 'Proposal' });
  s.addText('404 Error Found', { placeholder: 'title' });
  s.addText('Better decisions about who gets food, with the reasoning in plain sight.', { placeholder: 'body' });
  card(s, 0.8, 5.0, 8.2, 1.4, C.background2, 'Team card');
  txt(s, [{ text: 'Team contributions: ', options: { bold: true, color: C.text2 } }, { text: 'individual members and their roles will be listed in the final project submission.' }], { x: 1.0, y: 5.08, w: 7.8, h: 1.24, fontSize: 16, valign: 'middle' });
  drawMap(s, 10.0, 0.75, 6.0);
  s.addNotes('Thank you. We would welcome your questions about the model, the data or the assumptions.');

  const out = path.join(__dirname, 'FairLoad_DataNova_Proposal.pptx');
  await pres.writeFile({ fileName: out });
  await applyTheme(out, THEME);
  console.log('wrote', out, { gap, unservedPct, cut, movedPct, slowest });
})();
