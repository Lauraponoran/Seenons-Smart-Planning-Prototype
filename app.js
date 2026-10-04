/* app.js — UI for the SmartPlan prototype (plain JS, no build step) */

const ui = {
  tab: 'planner', loc: '', cid: null, modal: null, month: null,
  fLocs: [], fStreams: [], filterOpen: false,           // planner calendar filters (empty = show all)
  add: { open: false, loc: null, stream: null, amount: 1, date: null, msg: '' },
  scrollAdd: false, noteOpen: false, notifAll: false, notifHidden: false, simOpen: false, from: iso(addDays(Model.today, -(HISTORY_DAYS - 1))), to: iso(Model.today)
};
const $ = s => document.querySelector(s);
const defFrom = () => iso(addDays(Model.today, -(HISTORY_DAYS - 1))), defTo = () => iso(Model.today);
const baseRange = () => Model.scenarioRange(Model.scenario) || { from: defFrom(), to: defTo() };
function setScenario(v) {            // holiday simulator: the Report and the planner jump to the event's dates
  Model.scenario = v;
  const r = baseRange(); ui.from = r.from; ui.to = r.to;
  if (v === 'normal') ui.month = null; else { const d = parseIso(r.from); ui.month = { y: d.getFullYear(), m: d.getMonth() }; }
}
function scenarioBanner(planner) {
  if (Model.scenario === 'normal') return '';
  const sc = SCENARIOS[Model.scenario], r = Model.scenarioRange(Model.scenario);
  const eff = Object.entries(sc.mult).map(([t, m]) => t + ' ' + pctDelta(m)).join(' · ');
  return '<div class="sim-banner"><div><b>Simulated: ' + sc.label + '</b> · ' + dShort(r.from) + ' – ' + dShort(r.to) +
    '<br><span class="small">' + (planner ? 'Highlighted on the calendar. The agent’s forecast uses these assumptions: ' + eff + '.'
      : 'Charts show projected values from our demo assumptions (' + eff + '). The missed-pickup pattern comes from the last 12 weeks.') + '</span></div>' +
    '<button class="btn sec sm" data-act="scenario" data-val="normal">Back to real data</button></div>';
}
const eur = n => (n < 0 ? '−' : n > 0 ? '+' : '') + '€' + Math.abs(Math.round(n));
const kg = n => Math.round(n).toLocaleString('en-GB') + ' kg';
const pct = n => Math.round(n * 100) + '%';
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const COL = { navy: '#1F4E5A', teal: '#4BA58A', pink: '#EA5B7D', alert: '#D2436A', grey: '#8AA0A4', grid: '#E4E8E2' };

function containersInView() { return CONTAINERS.filter(c => !ui.loc || c.loc === ui.loc); }
function allRecs() { return Model.recommendations(''); }
function viewRecs() { return Model.recommendations(ui.loc); }
function resetAdd() { ui.add = { open: false, loc: null, stream: null, amount: 1, date: null, msg: '' }; }

/* ---------------- shared pieces ---------------- */
function impactChips(r) {
  const i = r.impact, out = [];
  if (i.pickups) out.push('<span class="chip ' + (i.pickups < 0 ? 'good' : '') + '">' + (i.pickups > 0 ? '+' : '') + i.pickups + ' pickup</span>');
  if (i.cost) out.push('<span class="chip ' + (i.cost < 0 ? 'good' : 'bad') + '">' + eur(i.cost) + '</span>');
  if (i.co2) out.push('<span class="chip ' + (i.co2 < 0 ? 'good' : '') + '">' + (i.co2 > 0 ? '+' : '−') + Math.abs(i.co2).toFixed(1) + ' kg CO₂</span>');
  if (i.note) out.push('<span class="chip">' + i.note + '</span>');
  return out.join('');
}
const typeLabel = { overflow: 'Overflow risk', risk: 'Missed-pickup risk', underfill: 'Cost saving', composition: 'Composition', missed: 'Missed pickups', trend: 'Volume trend', mix: 'Waste mix' };
const findRec = id => [...allRecs(), ...Model.insights(ui.loc, ui.from, ui.to)].find(x => x.id === id);
/* hover tooltip for chart parts: any element with data-tt (HTML text) shows it next to the cursor */
const tipBox = document.createElement('div'); tipBox.className = 'tt'; document.body.appendChild(tipBox);

/* page heading (the holiday simulator floats bottom-right, see simulator()) */
function pageHead(title, sub) {
  return '<div class="page-head"><div><h2>' + title + '</h2>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div></div>';
}


/* one-line summary of the simulated event: effects on waste volume and the agent's reaction */
function pctDelta(m) {
  const p = Math.round((m - 1) * 100);
  return p === 0 ? 'unchanged' : (p > 0 ? '+' : '−') + Math.abs(p) + '%';
}
function scenarioEffects() {
  const keep = Model.scenario;
  const count = () => { const r = allRecs(); return { overflow: r.filter(x => x.type === 'overflow').length, sched: r.filter(x => x.ops).length }; };
  const now = count();
  Model.scenario = 'normal';
  const base = count();
  Model.scenario = keep;
  return { now, base };
}
function eventLine() {
  if (Model.scenario === 'normal') return '';
  const sc = SCENARIOS[Model.scenario], why = (typeof SCENARIO_WHY !== 'undefined' && SCENARIO_WHY[Model.scenario]) || {};
  const fx = scenarioEffects(), n = fx.now.overflow;
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  // one row per location type; hover / focus / tap the number to see why it is what it is
  const rows = Object.entries(sc.mult).map(([t, m]) => {
    const tip = (why[t] || '') + ' The forecast fill rate for every ' + t.toLowerCase() + ' container is multiplied by ' + m + '.';
    return '<div class="sim-stat tip" tabindex="0" data-tip="' + esc(tip) + '"><span>' + t + '</span><b class="' + (m > 1 ? 'up' : m < 1 ? 'down' : '') + '">' + pctDelta(m) + '</b></div>';
  }).join('');
  const riskTip = 'Containers the agent expects to reach ' + ASSUMPTIONS.alertFill + '% full within 14 days, before their next pickup. ' +
    (n > fx.base.overflow ? 'The higher waste volumes fill them faster, so ' + (n - fx.base.overflow) + ' more than normal now need action.' : 'This event does not add any new overflow risks.');
  const risk = '<div class="sim-stat tip" tabindex="0" data-tip="' + esc(riskTip) + '"><span>Overflow risks (' + fx.base.overflow + ' normally)</span><b class="risk">' + n + '</b></div>';
  return '<div class="sim-fx">' + (sc.note ? '<p class="sim-note">' + sc.note + '</p>' : '') + rows + risk + '</div>';
}

/* holiday simulator: floating launcher bottom-right (like a chat widget) that opens a small panel */
function simulator() {
  const sc = SCENARIOS[Model.scenario], active = Model.scenario !== 'normal';
  const opts = Object.entries(SCENARIOS).map(([k, v]) =>
    '<button class="sim-opt' + (k === Model.scenario ? ' on' : '') + '" data-act="scenario" data-val="' + k + '" aria-pressed="' + (k === Model.scenario) + '"><span class="sim-dot"></span>' + v.label + '</button>').join('');
  const panel = !ui.simOpen ? '' :
    '<div class="sim-panel" role="dialog" aria-label="Holiday simulator"><div class="sim-head"><b>Holiday simulator</b><small>Demo</small>' +
    '<button class="sim-x" data-act="simtoggle" aria-label="Close">×</button></div>' +
    '<p class="small sim-intro">Pick an event to see how the forecast and the agent\'s suggestions react.</p><div class="sim-opts">' + opts + '</div>' +
    eventLine() + '<button class="sim-reset" data-act="reset">Reset demo</button></div>';
  const fab = ui.simOpen ? '' : '<button class="sim-fab" data-act="simtoggle" aria-expanded="false">Holiday simulator' +
    (active ? '<span class="sim-badge">' + sc.short + '</span>' : '') + '</button>';
  return '<div class="sim">' + panel + fab + '</div>';
}

/* location select + From/To dates (the range is shown as real dates) */
const dShort = s => parseIso(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
function toolbar(withDate) {
  const sel = '<label>Location<select id="locSel"><option value="">All locations</option>' +
    LOCATIONS.map(l => '<option value="' + l.id + '"' + (l.id === ui.loc ? ' selected' : '') + '>' + l.name + '</option>').join('') + '</select></label>';
  const br = baseRange(), simOn = Model.scenario !== 'normal';
  const lim = simOn ? ' min="' + br.from + '" max="' + br.to + '"' : ' min="' + iso(addDays(Model.today, -HISTORY_DAYS)) + '" max="' + iso(Model.today) + '"';
  const isDef = ui.from === br.from && ui.to === br.to;
  const dates = !withDate ? '' :
    '<label>From<input type="date" id="fromSel"' + lim + ' value="' + ui.from + '"></label><label>To<input type="date" id="toSel"' + lim + ' value="' + ui.to + '"></label>' +
    (isDef ? '' : '<button class="linkbtn" style="align-self:center" data-act="cleardates">' + (simOn ? 'Reset to event dates' : 'Reset to last 12 weeks') + '</button>');
  return '<div class="toolbar">' + sel + dates + '</div>';
}
function pageTop(title, sub, withLoc, withDate) {
  return pageHead(title, sub) + (withLoc ? toolbar(withDate) : '');
}

function chartSvg(c, big) {
  const hist = Model.hist.fills[c.id].slice(-15);
  if (Model.fillOverride[c.id] != null) hist[hist.length - 1] = { ...hist[hist.length - 1], fill: Model.fillOverride[c.id] };
  const fc = Model.simulate(c);
  const W = big ? 960 : 720, H = big ? 420 : 230, L = 40, R = 12, T = 12, B = 28, MAXY = 110;
  const x = i => L + (i + 14) / 28 * (W - L - R);
  const y = v => T + (1 - Math.min(v, MAXY) / MAXY) * (H - T - B);
  let hp = hist.map((p, i) => (i ? 'L' : 'M') + x(i - 14).toFixed(1) + ' ' + y(p.fill).toFixed(1)).join(' ');
  let fp = '';
  fc.forEach((p, i) => {
    fp += (i ? 'L' : 'M') + x(p.d).toFixed(1) + ' ' + y(p.fill).toFixed(1) + ' ';
    if (p.pickup) fp += 'L' + x(p.d).toFixed(1) + ' ' + y(2).toFixed(1) + ' ';
  });
  const grid = [0, 25, 50, 75, 100].map(v => '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="' + COL.grid + '"/><text x="4" y="' + (y(v) + 4) + '">' + v + '%</text>').join('');
  const marks = fc.filter(p => p.pickup).map(p => '<circle cx="' + x(p.d) + '" cy="' + y(p.fill) + '" r="5" fill="' + (p.status === 'added' ? COL.pink : COL.navy) + '"/>').join('');
  const overs = fc.filter(p => p.fill >= ASSUMPTIONS.alertFill).map(p => '<circle cx="' + x(p.d) + '" cy="' + y(p.fill) + '" r="6" fill="none" stroke="' + COL.alert + '" stroke-width="2"/>').join('');
  let xl = '';
  for (let i = -14; i <= 14; i += 7) xl += '<text x="' + (x(i) - 14) + '" y="' + (H - 6) + '">' + (i === 0 ? 'today' : fmtDate(addDays(Model.today, i)).split(' ').slice(1).join(' ')) + '</text>';
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Fill level history and forecast">' + grid +
    '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(ASSUMPTIONS.alertFill) + '" y2="' + y(ASSUMPTIONS.alertFill) + '" stroke="' + COL.alert + '" stroke-dasharray="5 4"/>' +
    '<text x="' + (W - 130) + '" y="' + (y(ASSUMPTIONS.alertFill) - 4) + '" style="fill:' + COL.alert + '">overflow risk ' + ASSUMPTIONS.alertFill + '%</text>' +
    '<line x1="' + x(0) + '" x2="' + x(0) + '" y1="' + T + '" y2="' + (H - B) + '" stroke="#B9C8C5"/>' +
    '<path d="' + hp + '" fill="none" stroke="' + COL.grey + '" stroke-width="2"/>' +
    '<path d="' + fp + '" fill="none" stroke="' + COL.teal + '" stroke-width="2.5" stroke-dasharray="6 4"/>' + marks + overs + xl + '</svg>' +
    '<div class="legend"><span><i style="background:' + COL.grey + '"></i>Sensor history</span><span><i style="background:' + COL.teal + '"></i>Forecast</span><span>● pickups</span></div>';
}

/* ---------------- Report: charts modelled on the Seenons waste-saver dashboard ---------------- */
const LOC_COL = { l1: '#4DA58A', l2: '#5B93CF', l3: '#F2A65A', l4: '#E5566D' };
const niceMax = v => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1)))); return Math.ceil(v / p) * p; };
const num = n => Math.round(n).toLocaleString('en-GB');
const legendOf = items => '<div class="legend">' + items.map(([c, l]) => '<span><i style="background:' + c + '"></i>' + l + '</span>').join('') + '</div>';
const escA = t => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const FULLDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const labelEvery = n => Math.ceil(n / 6);
const caption = bk => '<p class="small cap">' + (bk.daily ? 'Each bar is one day.' : 'Each bar is one 7-day period, labelled with its first day.') + ' Hover for amounts.</p>';

function chartStreamLoc(bd, locs) {
  const keys = Object.keys(STREAMS), W = 520, rowH = 34, L = 112, R = 14, H = keys.length * rowH + 26;
  const max = niceMax(Math.max(1, ...keys.map(k => Object.values(bd.sl[k]).reduce((a, b) => a + b, 0))));
  const x = v => L + v / max * (W - L - R);
  let s = '';
  for (let t = 0; t <= 4; t++) { const v = max * t / 4; s += '<line x1="' + x(v) + '" x2="' + x(v) + '" y1="0" y2="' + (H - 22) + '" stroke="' + COL.grid + '"/><text x="' + x(v) + '" y="' + (H - 6) + '" text-anchor="middle">' + num(v) + '</text>'; }
  keys.forEach((k, i) => {
    const y = i * rowH + 6; let x0 = 0;
    const total = Object.values(bd.sl[k]).reduce((a, b) => a + b, 0);
    s += '<text x="' + (L - 8) + '" y="' + (y + 15) + '" text-anchor="end">' + STREAMS[k].label + '</text>';
    locs.forEach(l => {
      const v = bd.sl[k][l.id] || 0; if (!v) return;
      const tt = '<b>' + STREAMS[k].label + '</b><br>' + l.name + ': <b>' + kg(v) + '</b><br>All locations: ' + kg(total);
      s += '<rect class="seg" data-tt="' + escA(tt) + '" x="' + x(x0) + '" y="' + y + '" width="' + Math.max(1, x(x0 + v) - x(x0)) + '" height="22" fill="' + LOC_COL[l.id] + '"/>';
      x0 += v;
    });
  });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Weight by stream and location">' + s + '</svg>' + legendOf(locs.map(l => [LOC_COL[l.id], l.name]));
}

function chartWeekStack(bd) {
  const keys = Object.keys(STREAMS), bk = bd.buckets.list, n = bk.length, W = 520, H = 220, L = 50, R = 8, T = 10, B = 24, bw = (W - L - R) / n, pad = Math.min(4, bw * 0.15), step = labelEvery(n);
  const totals = bd.weeks.map(w => keys.reduce((a, k) => a + (w[k] || 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const y = v => T + (1 - v / max) * (H - T - B);
  let s = '';
  for (let t = 0; t <= 4; t++) { const v = max * t / 4; s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="' + COL.grid + '"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + num(v) + '</text>'; }
  bd.weeks.forEach((w, i) => {
    let cum = 0;
    keys.forEach(k => {
      const v = w[k] || 0; if (!v) return;
      const tt = '<b>' + bk[i].range + '</b><br>' + STREAMS[k].label + ': <b>' + kg(v) + '</b><br>All streams: ' + kg(totals[i]);
      s += '<rect class="seg" data-tt="' + escA(tt) + '" x="' + (L + i * bw + pad) + '" y="' + y(cum + v) + '" width="' + (bw - 2 * pad) + '" height="' + (y(cum) - y(cum + v)) + '" fill="' + STREAMS[k].color + '"/>';
      cum += v;
    });
    if ((n - 1 - i) % step === 0) s += '<text x="' + (L + i * bw + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + bk[i].label + '</text>';
  });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Weight over time">' + s + '</svg>' + legendOf(keys.map(k => [STREAMS[k].color, STREAMS[k].label]));
}

function chartFill(cs) {
  const A = ASSUMPTIONS, W = 520, rowH = 30, L = 116, R = 14, H = cs.length * rowH + 26, MAX = 120;
  const x = v => L + Math.min(v, MAX) / MAX * (W - L - R);
  let s = '';
  [0, 25, 50, 75, 100].forEach(v => { s += '<line x1="' + x(v) + '" x2="' + x(v) + '" y1="0" y2="' + (H - 22) + '" stroke="' + COL.grid + '"/><text x="' + x(v) + '" y="' + (H - 6) + '" text-anchor="middle">' + v + '%</text>'; });
  s += '<line x1="' + x(A.alertFill) + '" x2="' + x(A.alertFill) + '" y1="0" y2="' + (H - 22) + '" stroke="' + COL.alert + '" stroke-dasharray="5 4"/>';
  let hits = '';
  cs.forEach((c, i) => {
    const y = i * rowH + 3, cur = Model.currentFill(c), sim = Model.simulate(c), pk = sim.reduce((a, p) => p.fill > a.fill ? p : a, sim[0]), over = pk.fill >= A.alertFill;
    const tt = '<b>' + Model.contLabel(c) + '</b><br>Now: <b>' + Math.round(cur) + '%</b><br>14-day peak: <b>' + Math.round(Math.min(pk.fill, 130)) + '%</b> on ' + fmtDate(pk.date) + (over ? '<br>Over the overflow threshold' : '');
    s += '<text x="' + (L - 8) + '" y="' + (y + 17) + '" text-anchor="end">' + STREAM_SHORT[c.stream] + ' · ' + locOf(c).code + '</text>' +
      '<rect x="' + L + '" y="' + (y + 3) + '" width="' + Math.max(1, x(cur) - L) + '" height="9" fill="' + STREAMS[c.stream].color + '" style="pointer-events:none"/>' +
      '<rect x="' + L + '" y="' + (y + 14) + '" width="' + Math.max(1, x(pk.fill) - L) + '" height="9" fill="' + (over ? COL.alert : STREAMS[c.stream].color) + '" fill-opacity="' + (over ? '.75' : '.4') + '" style="pointer-events:none"/>';
    hits += '<rect class="hit" data-tt="' + escA(tt) + '" x="0" y="' + y + '" width="' + W + '" height="' + (rowH - 4) + '"/>';
  });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Container fill level now and forecast peak">' + s + hits + '</svg>';
}

function chartComposition(cs) {
  const rs = cs.filter(c => c.stream === 'residual' && c.audit != null);
  if (!rs.length) return '<p class="small">No scanned residual containers in this selection.</p>';
  const W = 520, rowH = 36, L = 150, R = 14, H = rs.length * rowH + 26, x = v => L + v / 100 * (W - L - R);
  let s = '';
  [0, 25, 50, 75, 100].forEach(v => { s += '<line x1="' + x(v) + '" x2="' + x(v) + '" y1="0" y2="' + (H - 22) + '" stroke="' + COL.grid + '"/><text x="' + x(v) + '" y="' + (H - 6) + '" text-anchor="middle">' + v + '%</text>'; });
  rs.forEach((c, i) => {
    const y = i * rowH + 6, name = locOf(c).name;
    const tt = '<b>' + name + '</b><br>Recyclable material in residual: <b>' + c.audit + '%</b><br>Paper, cardboard and packaging that could be separated<br>Everything else: ' + (100 - c.audit) + '%';
    s += '<text x="' + (L - 8) + '" y="' + (y + 16) + '" text-anchor="end">' + name + '</text>' +
      '<rect class="seg" data-tt="' + escA(tt) + '" x="' + x(0) + '" y="' + y + '" width="' + (x(c.audit) - x(0)) + '" height="22" fill="' + COL.teal + '"/>' +
      '<rect class="seg" data-tt="' + escA(tt) + '" x="' + x(c.audit) + '" y="' + y + '" width="' + (x(100) - x(c.audit)) + '" height="22" fill="#C9D6D9"/>';
  });
  s += '<line x1="' + x(20) + '" x2="' + x(20) + '" y1="0" y2="' + (H - 22) + '" stroke="' + COL.alert + '" stroke-dasharray="5 4"/>';
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Recyclables found in residual">' + s + '</svg>' +
    legendOf([[COL.teal, 'Recyclable (could be separated)'], ['#C9D6D9', 'True residual']]) + '<p class="small" style="margin:-6px 0 0">Dashed line: 20% triggers an audit task.</p>';
}

function chartRates(bd) {
  const bk = bd.buckets.list, n = bk.length, W = 520, H = 220, L = 42, R = 10, T = 10, B = 24, step = labelEvery(n);
  const x = i => L + (i + 0.5) / n * (W - L - R), y = v => T + (1 - v) * (H - T - B), bw = (W - L - R) / n;
  const pts = bd.weeks.map(w => {
    const t = Object.values(w).reduce((a, b) => a + b, 0); if (!t) return null;
    return { sep: 1 - (w.residual || 0) / t, res: Object.entries(w).reduce((a, [k, v]) => a + v * (STREAMS[k].recovery || 0), 0) / t };
  });
  let s = '';
  [0, 0.25, 0.5, 0.75, 1].forEach(v => { s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="' + COL.grid + '"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + Math.round(v * 100) + '%</text>'; });
  const line = (key, col) => {
    let d = '', pen = false, dots = '';
    pts.forEach((p, i) => {
      if (!p) { pen = false; return; }
      d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[key]).toFixed(1) + ' '; pen = true;
      dots += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(p[key]).toFixed(1) + '" r="3" fill="' + col + '" style="pointer-events:none"/>';
    });
    return '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2.5" style="pointer-events:none"/>' + dots;
  };
  // one invisible hover column per period: shows both rates at once
  let hits = '';
  pts.forEach((p, i) => {
    const tt = '<b>' + bk[i].range + '</b><br>' + (p ? 'Source separation rate: <b>' + pct(p.sep) + '</b><br>Resource saved rate: <b>' + pct(p.res) + '</b>' : 'No pickups in this period');
    hits += '<rect class="hit" data-tt="' + escA(tt) + '" x="' + (L + i * bw) + '" y="' + T + '" width="' + bw + '" height="' + (H - T - B) + '"/>';
  });
  for (let i = 0; i < n; i++) if ((n - 1 - i) % step === 0) s += '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + bk[i].label + '</text>';
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Source separation rate vs resource saved rate">' + s + hits + line('sep', COL.teal) + line('res', '#3C6FA8') + '</svg>' +
    legendOf([[COL.teal, 'Source separation rate'], ['#3C6FA8', 'Resource saved rate']]);
}

/* recommended action (composition tasks) and the list of tasks created from them */
function taskCard(r) {
  return '<div class="card rec"><div class="body"><span class="badge ' + r.severity + '">' + r.severity + '</span> <span class="badge">' + typeLabel[r.type] + '</span>' +
    '<h4>' + r.title + '</h4><p>' + r.reason + '</p><div>' + impactChips(r) + '</div></div>' +
    '<div class="acts"><button class="btn" data-act="apply" data-id="' + r.id + '">Create task</button><button class="btn sec" data-act="dismiss" data-id="' + r.id + '">Dismiss</button></div></div>';
}
/* task list: button top-right (Report page) that opens a small panel, styled like the other panels */
function notebook() {
  const items = Object.entries(Model.tasks).filter(([, t]) => t && typeof t === 'object');
  const open = items.filter(([, t]) => !t.done).length;
  const row = ([id, t]) => {
    const tip = t.todo && t.why ? '<b>What to do</b><br>' + t.todo + '<br><br><b>Why</b><br>' + t.why : (t.reason || 'Created from a recommended action.');
    return '<div class="nb-task' + (t.done ? ' done' : '') + '"><label><input type="checkbox" data-task="' + id + '"' + (t.done ? ' checked' : '') + '><span>' + t.title + '</span></label>' +
      '<span class="info" tabindex="0" role="note" aria-label="Why this task" data-tt="' + escA(tip) + '">i</span></div>';
  };
  const panel = !ui.noteOpen ? '' :
    '<div class="nb-panel" role="dialog" aria-label="Tasks"><div class="nb-head"><b>Tasks</b><small>' + (items.length ? (open ? open + ' open' : 'All done') : 'None yet') + '</small>' +
    '<button class="nb-x" data-act="notetoggle" aria-label="Close">×</button></div>' +
    '<div class="nb-list">' + (items.length ? items.map(row).join('') : '<p class="nb-empty">No tasks yet. Choose <b>Create task</b> on a recommended action and it will appear here.</p>') + '</div></div>';
  return '<div class="nb">' + panel + '<button class="nb-btn" data-act="notetoggle" aria-expanded="' + !!ui.noteOpen + '">Tasks' + (open ? '<span class="nb-n">' + open + '</span>' : '') + '</button></div>';
}

/* ---------------- views ---------------- */
function viewOverview() {
  const f = ui.from, t = ui.to;
  const k = Model.kpis(ui.loc, f, t), bd = Model.breakdown(ui.loc, f, t);
  const locs = LOCATIONS.filter(l => !ui.loc || l.id === ui.loc);
  const heat = '<table><tr><th>Location</th>' + [1, 2, 3, 4, 5, 6, 0].map(d => '<th>' + WD[d] + '</th>').join('') + '</tr>' + locs.map(l => {
    const ldays = new Set(CONTAINERS.filter(c => c.loc === l.id).flatMap(c => c.days));
    return '<tr><td>' + l.name + '</td>' + [1, 2, 3, 4, 5, 6, 0].map(d => {
      if (!ldays.has(d)) return '<td class="heat" style="color:#b6c7c4">–</td>';
      const m = Model.missRate(l.id, d, f, t), a = Math.min(1, m.rate / 0.3);
      const tt = '<b>' + l.name + '</b><br>' + FULLDAY[d] + 's: ' + (m.n < 5 ? 'not enough pickups yet (' + m.n + ')' : Math.round(m.rate * m.n) + ' of ' + m.n + ' pickups missed (' + pct(m.rate) + ')');
      return '<td class="heat" data-tt="' + escA(tt) + '" style="background:rgba(229,86,109,' + (0.08 + a * 0.6).toFixed(2) + ')">' + pct(m.rate) + '</td>';
    }).join('') + '</tr>';
  }).join('') + '</table>';
  const rank = { high: 0, medium: 1, low: 2 };
  const acts = [...viewRecs().filter(r => !r.ops), ...Model.insights(ui.loc, f, t)].sort((a, b) => rank[a.severity] - rank[b.severity]);
  const kpi = (v, l, warn, tt) => '<div class="card kpi ' + (warn ? 'warn' : '') + '"' + (tt ? ' data-tt="' + escA(tt) + '"' : '') + '><div class="v">' + v + '</div><div class="l">' + l + '</div></div>';
  return pageHead('Report', 'What Seenons clients see today, plus recommended next steps.') +
    '<div class="report-panel">' + toolbar(true) +
    scenarioBanner() + '<h3 class="sec-h">Summary Statistics</h3>' +
    '<div class="grid kpis">' + kpi(k.orders, 'Orders', false, 'Total orders picked up in this period.') + kpi(kg(k.weight), 'Weight', false, 'Total weight collected in this period.') +
    kpi(pct(k.separation), 'Separation rate', false, 'Source separation rate: share of the weight that was not residual.') +
    kpi(pct(k.resource), 'Resource saved', false, 'Resource saved rate: share of the weight that was recycled or recovered (demo factors).') +
    kpi(kg(k.co2), 'CO₂ saved', false, 'CO₂ saved by recycling, using demo factors per stream.') +
    kpi(pct(k.missRate), 'Missed pickups', k.missRate > 0.06, k.missed + ' of ' + k.pickups + ' scheduled pickups were missed in this period.') +
    kpi(k.full, 'Full at pickup', k.full > 0, 'Pickups where the container was already at least ' + ASSUMPTIONS.alertFill + '% full, so it was at risk of overflowing.') + '</div>' +
    '<h3 class="sec-h">Waste details <span class="tag">Seenons today</span></h3>' +
    '<div class="grid cols2"><div class="card"><h3>Weight (kg) by stream and location</h3><p class="small cap">Hover a bar for amounts.</p>' + chartStreamLoc(bd, locs) + '</div>' +
    '<div class="card"><h3>Weight (kg) over time</h3>' + caption(bd.buckets) + chartWeekStack(bd) + '</div></div>' +
    '<div class="grid cols2"><div class="card"><h3>Source separation rate vs resource saved rate</h3>' + caption(bd.buckets) + chartRates(bd) + '</div>' +
    '<div class="card"><h3>Missed-pickup rate by weekday <span class="tag new">New · service events</span></h3><p class="small cap">Hover a cell for the number of missed pickups.</p>' + heat + '</div></div>' +
    '<h3 class="sec-h">Smart data <span class="tag new">New · what we recommend collecting</span></h3>' +
    '<div class="grid cols2"><div class="card"><h3>Container fill level: now and 14-day forecast <span class="tag new">New · IoT sensors</span></h3><p class="small cap">Live sensor readings (simulated). The faded bar is the forecast peak before the next pickup; red means over ' + ASSUMPTIONS.alertFill + '%.</p>' + chartFill(containersInView()) + '</div>' +
    '<div class="card"><h3>Recyclables found in residual <span class="tag new">New · composition scan</span></h3><p class="small cap">Share of each residual container that could have been separated, from the last (simulated) scan.</p>' + chartComposition(containersInView()) + '</div></div>' +
    '<h3 class="sec-h">Recommended actions <span class="small">(' + acts.length + ')</span></h3>' +
    (acts.map(taskCard).join('') || '<p class="sub">No open recommendations for this selection.</p>') + '</div>';
}

/* ----- planner ----- */
function mondayOf(d) { return addDays(d, -((d.getDay() + 6) % 7)); }
const STREAM_SHORT = { residual: 'Residual', paper: 'Paper', glass: 'Glass', organic: 'Organic', pmd: 'Plastic' };
const locOf = c => Model.loc(c.loc);

function plannerContainers() {
  return CONTAINERS.filter(c => (!ui.fLocs.length || ui.fLocs.includes(c.loc)) && (!ui.fStreams.length || ui.fStreams.includes(c.stream)));
}
function plannerGhosts(cs) {
  const ids = new Set(cs.map(c => c.id)), out = [];
  allRecs().filter(r => r.ops && ids.has(r.cid)).forEach(r => r.ops.filter(o => o.op === 'add').forEach(o => out.push({ rec: r, cid: o.cid, date: o.date })));
  return out;
}

/* chip = [location tag] + waste type; the whole bar carries the waste-type colour */
function pkChip(p, long) {
  const c = Model.cont(p.cid), S = STREAMS[c.stream];
  const sim = Model.simulate(c).find(x => x.date === p.date);
  const fill = sim ? ' · ~' + Math.round(Math.min(sim.fill, 100)) + '% full' : '';
  const qty = p.amount > 1 ? ' ×' + p.amount : '';
  const extra = !long ? '' : p.status === 'cancelled' ? ' · cancelled' : p.status === 'added' ? ' · added' + fill : fill;
  return '<button class="pk ' + p.status + '" style="--c:' + S.color + '" title="' + Model.contLabel(c) + qty + fill + '" data-act="selpk" data-cid="' + p.cid + '" data-date="' + p.date + '">' +
    '<span class="loc">' + locOf(c).code + '</span><span class="ty">' + (long ? S.label : STREAM_SHORT[c.stream]) + qty + extra + '</span></button>';
}
function ghostChip(g, long) {
  const c = Model.cont(g.cid), S = STREAMS[c.stream];
  return '<button class="pk ghost" style="--c:' + S.color + '" title="AI suggestion: ' + g.rec.title.replace(/"/g, '') + '" data-act="selghost" data-id="' + g.rec.id + '">' +
    '<span class="ai">AI</span><span class="loc">' + locOf(c).code + '</span><span class="ty">' + (long ? S.label + ' · suggested' : STREAM_SHORT[c.stream]) + '</span></button>';
}
function dayItems(date, cs, ghosts) {
  const key = iso(date);
  const items = key < iso(Model.today) ? [] : Model.pickups(date, 1).filter(p => cs.find(c => c.id === p.cid));
  return { ghosts: ghosts.filter(g => g.date === key), pickups: items };
}

/* add-pickup form: location, type of waste, amount, date */
function addState() {
  const a = ui.add;
  if (!a.loc || !LOCATIONS.find(l => l.id === a.loc)) a.loc = ui.fLocs.length === 1 ? ui.fLocs[0] : LOCATIONS[0].id;
  const avail = CONTAINERS.filter(c => c.loc === a.loc);
  if (!avail.find(c => c.stream === a.stream)) a.stream = avail[0].stream;
  if (!a.date) a.date = iso(addDays(Model.today, 2));
  a.amount = Math.max(1, Math.min(10, Math.round(+a.amount) || 1));
  return { a, avail, cont: avail.find(c => c.stream === a.stream) };
}
function addEstimate() {
  const { a, cont } = addState();
  const cost = a.amount * ASSUMPTIONS.pickupCost;   // plain amount × price per pickup; no late-change fee is modelled
  return a.amount + ' × ' + cont.cap + ' L ' + STREAMS[cont.stream].label.toLowerCase() + ' at ' + locOf(cont).name + ', ' + fmtDate(a.date) + ' · est. €' + cost;
}
function addForm() {
  if (!ui.add.open) return '';
  const { a, avail } = addState();
  const locOpts = LOCATIONS.map(l => '<option value="' + l.id + '"' + (l.id === a.loc ? ' selected' : '') + '>' + l.name + '</option>').join('');
  const stOpts = avail.map(c => '<option value="' + c.stream + '"' + (c.stream === a.stream ? ' selected' : '') + '>' + STREAMS[c.stream].label + ' (' + c.cap + ' L)</option>').join('');
  return '<div class="addform"><div class="af-fields">' +
    '<label class="wide"><span>Location</span><select id="addLoc">' + locOpts + '</select></label>' +
    '<label><span>Type of waste</span><select id="addStream">' + stOpts + '</select></label>' +
    '<label class="narrow"><span>Amount <small>(containers)</small></span><input type="number" id="addAmount" min="1" max="10" value="' + a.amount + '"></label>' +
    '<label><span>Date</span><input type="date" id="addDate" min="' + iso(Model.today) + '" value="' + a.date + '"></label>' +
    '<div class="af-actions"><button class="btn" data-act="addpk">Add</button><button class="btn sec" data-act="toggleadd">Cancel</button></div></div>' +
    '<p class="small af-est" id="addEst">' + addEstimate() + '</p>' + (a.msg ? '<p class="af-msg">' + a.msg + '</p>' : '') + '</div>';
}

/* filter menu: location and waste type (multi-select) */
function filterPanel() {
  if (!ui.filterOpen) return '';
  const boxes = (kind, items, sel) => items.map(([id, label, swatch]) =>
    '<label class="opt"><input type="checkbox" data-filter="' + kind + '" value="' + id + '"' + (sel.includes(id) ? ' checked' : '') + '>' + swatch + label + '</label>').join('');
  const locs = LOCATIONS.map(l => [l.id, l.name, '<span class="loc">' + l.code + '</span>']);
  const streams = Object.entries(STREAMS).map(([k, s]) => [k, s.label, '<i class="sw" style="background:' + s.color + '"></i>']);
  return '<div class="popover"><div class="pop-col"><h5>Location</h5>' + boxes('loc', locs, ui.fLocs) + '</div>' +
    '<div class="pop-col"><h5>Type of waste</h5>' + boxes('stream', streams, ui.fStreams) + '</div>' +
    '<div class="pop-foot"><button class="linkbtn" data-act="clearfilter">Clear all</button><button class="btn sm" data-act="togglefilter">Done</button></div></div>';
}

function viewPlanner() {
  const cs = plannerContainers();
  const ghosts = plannerGhosts(cs);
  if (!ui.month) ui.month = { y: Model.today.getFullYear(), m: Model.today.getMonth() };
  const first = new Date(ui.month.y, ui.month.m, 1);
  const last = new Date(ui.month.y, ui.month.m + 1, 0);
  const start = mondayOf(first);
  const weeks = Math.ceil(((last - start) / 864e5 + 1) / 7);
  const todayKey = iso(Model.today), scen = Model.scenarioRange(Model.scenario);
  const head = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => '<div class="wk">' + d + '</div>').join('');
  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(start, i), key = iso(date), past = key < todayKey, other = date.getMonth() !== ui.month.m;
    const di = dayItems(date, cs, ghosts);
    const all = [...di.ghosts.map(g => ghostChip(g)), ...di.pickups.map(p => pkChip(p))];
    const hol = Model.holiday(date);
    const holLabel = hol ? '<span class="hol ' + hol.kind + '" title="' + hol.name + (hol.kind === 'public' ? ' (public holiday)' : '') + '">' + hol.name + '</span>' : '';
    const maxChips = hol ? 2 : 3;            // the holiday label takes one line of the square cell
    const more = all.length > maxChips ? '<button class="more" data-act="selday" data-date="' + key + '">+' + (all.length - maxChips) + ' more</button>' : '';
    cells += '<div class="day ' + (key === todayKey ? 'today ' : '') + (past ? 'past ' : '') + (other ? 'other ' : '') + (scen && key >= scen.from && key <= scen.to ? 'sim-period ' : '') + (hol && hol.kind === 'public' ? 'hol-public' : '') + '"><div class="dh"><b>' + date.getDate() + '</b>' +
      (past ? '' : '<button class="plus" title="Add pickup on this day" data-act="setadd" data-date="' + key + '">+</button>') + '</div>' + holLabel + all.slice(0, maxChips).join('') + more + '</div>';
  }
  const monthName = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const nFilters = ui.fLocs.length + ui.fStreams.length;
  const active = [...ui.fLocs.map(id => ['loc', id, LOCATIONS.find(l => l.id === id).name]), ...ui.fStreams.map(k => ['stream', k, STREAMS[k].label])];
  const activeRow = active.length
    ? '<div class="active-filters">Showing only:' + active.map(a => '<button class="fchip" data-act="rmfilter" data-kind="' + a[0] + '" data-val="' + a[1] + '" title="Remove filter">' + a[2] + ' ×</button>').join('') + '</div>'
    : '';
  return pageHead('Planner', 'Your upcoming pickups') +
    '<div class="card cal-card">' +
    '<div class="cal-toolbar"><div class="month-nav"><button class="nav" data-act="monthprev" aria-label="Previous month">‹</button><button class="nav" data-act="monthnext" aria-label="Next month">›</button>' +
    '<b class="month-name">' + monthName + '</b></div>' +
    // one control panel: navigate (blue Today) · narrow down (outlined Filter) · create (pink Add pickup, the primary action, last)
    '<div class="cal-actions"><button class="btn blue" data-act="monthtoday">Today</button>' +
    '<div class="filter-wrap"><button class="btn sec" data-act="togglefilter">Filter' + (nFilters ? '<span class="count">' + nFilters + '</span>' : '') + ' ▾</button>' + filterPanel() + '</div>' +
    '<span class="cal-sep"></span><button class="btn" data-act="toggleadd">+ Add pickup</button></div></div>' +
    addForm() + activeRow + scenarioBanner(true) +
    '<div class="cal">' + head + cells + '</div>' +
    '</div>' + notifications() + plannerModal();
}

/* agent suggestions as small corner notifications on the planner (top 3; the rest behind "+N more") */
function notifications() {
  const recs = allRecs().filter(r => r.ops);
  if (!recs.length) return '';
  const shown = ui.notifAll ? recs : recs.slice(0, 3), rest = recs.length - 3;
  const sched = recs.filter(r => r.ops).length;
  const toasts = shown.map(r =>
    '<div class="toast ' + r.severity + '"><div class="toast-head"><span class="ai-demo">AI</span><span class="small">' + typeLabel[r.type] + '</span>' +
    '<button class="toast-x" data-act="dismiss" data-id="' + r.id + '" aria-label="Dismiss suggestion" title="Dismiss">×</button></div>' +
    '<button class="toast-title" data-act="selghost" data-id="' + r.id + '" title="See why">' + r.title + '</button>' +
    '<div class="toast-acts"><button class="btn sm" data-act="apply" data-id="' + r.id + '">' + (r.ops ? 'Apply' : 'Create task') + '</button>' +
    '<button class="btn sec sm" data-act="selghost" data-id="' + r.id + '">Why?</button></div></div>').join('');
  const foot = (rest > 0 ? '<button class="btn sec sm" data-act="notifmore">' + (ui.notifAll ? 'Show less' : '+' + rest + ' more') + '</button>' : '') +
    (sched > 1 ? '<button class="btn sm" data-act="applyall">Apply all schedule changes</button>' : '');
  // pull-out tab: the stack slides off to the right edge, the tab (with the count) stays visible
  return '<div class="notifs' + (ui.notifHidden ? ' hidden' : '') + '" aria-live="polite">' +
    '<button class="notif-tab" data-act="notiftoggle" aria-expanded="' + !ui.notifHidden + '" aria-label="' + (ui.notifHidden ? 'Show' : 'Hide') + ' AI suggestions" title="' + (ui.notifHidden ? 'Show' : 'Hide') + ' AI suggestions">' +
    '<span class="nt-ch">' + (ui.notifHidden ? '‹' : '›') + '</span><span class="notif-n">' + recs.length + '</span></button>' +
    '<div class="notif-stack">' + toasts + (foot ? '<div class="notif-foot">' + foot + '</div>' : '') + '</div></div>';
}

function plannerModal() {
  const m = ui.modal;
  if (!m) return '';
  const close = '<button class="x" data-act="closemodal" data-x="1" aria-label="Close">×</button>';
  let body = '';
  if (m.kind === 'ghost') {
    const r = allRecs().find(x => x.id === m.id);
    if (!r) return '';
    body = close + '<span class="ai-demo">AI</span> <span class="badge ' + r.severity + '">' + r.severity + '</span> <span class="badge">' + typeLabel[r.type] + '</span>' +
      '<h3 style="margin-top:8px">' + r.title + '</h3><p>' + r.reason + '</p><div>' + impactChips(r) + '</div><div style="margin-top:10px">' + chartSvg(Model.cont(r.cid), false) + '</div>' +
      '<div class="acts" style="margin-top:12px"><button class="btn" data-act="apply" data-id="' + r.id + '">' + (r.ops ? 'Apply to schedule' : 'Create task') + '</button>' +
      '<button class="btn sec" data-act="dismiss" data-id="' + r.id + '">Dismiss</button></div>';
  } else if (m.kind === 'pk') {
    const c = Model.cont(m.cid), st = Model.status(c, parseIso(m.date)), sim = Model.simulate(c).find(x => x.date === m.date);
    const mr = Model.missRate(c.loc, parseIso(m.date).getDay());
    const amount = Model.amounts[m.cid + '|' + m.date] || 1;
    body = close + '<h3>' + Model.contLabel(c) + '</h3><p>' + fmtDate(m.date) + ' · status <b>' + st + '</b>' + (amount > 1 ? ' · <b>' + amount + ' containers</b>' : '') +
      (sim ? ' · forecast fill ~<b>' + Math.round(Math.min(sim.fill, 100)) + '%</b>' : '') +
      '<br>Missed on this weekday historically: <b>' + pct(mr.rate) + '</b> (' + mr.n + ' pickups)</p>' + chartSvg(c, false) +
      (st === 'cancelled'
        ? '<button class="btn" data-act="restore" data-cid="' + m.cid + '" data-date="' + m.date + '">Restore pickup</button>'
        : '<div class="row"><button class="btn danger" data-act="cancelpk" data-cid="' + m.cid + '" data-date="' + m.date + '">Cancel pickup</button>' +
          '<span class="small">or move to</span><input type="date" id="moveDate" min="' + iso(Model.today) + '" value="' + iso(addDays(parseIso(m.date), 1)) + '">' +
          '<button class="btn sec" data-act="movepk" data-cid="' + m.cid + '" data-date="' + m.date + '">Move</button></div>');
  } else if (m.kind === 'day') {
    const cs = plannerContainers();
    const di = dayItems(parseIso(m.date), cs, plannerGhosts(cs));
    const hol = Model.holiday(parseIso(m.date));
    body = close + '<h3>' + fmtDate(m.date) + '</h3>' +
      (hol ? '<p class="small"><b>' + hol.name + '</b>' + (hol.kind === 'public' ? ' · public holiday' : '') + '</p>' : '') + '<div class="daylist">' +
      (di.ghosts.map(g => ghostChip(g, true)).join('') + di.pickups.map(p => pkChip(p, true)).join('') || '<p class="small">No pickups planned.</p>') +
      '</div><button class="btn sec" data-act="setadd" data-date="' + m.date + '">+ Add a pickup on this day</button>';
  }
  return '<div class="modal-bg" data-act="closemodal"><div class="modal" role="dialog">' + body + '</div></div>';
}

/* ---------------- render + events ---------------- */
function render() {
  tipBox.style.display = 'none'; tipBox._el = null;
  $('#nav').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  $('#view').innerHTML = { report: viewOverview, planner: viewPlanner }[ui.tab]() + simulator() + (ui.tab === 'planner' ? '' : notebook());
  if (ui.scrollAdd) {
    ui.scrollAdd = false;
    const el = document.querySelector('.addform');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  Model.save();
}

function toggleIn(arr, v, on) {
  const i = arr.indexOf(v);
  if (on && i < 0) arr.push(v);
  if (!on && i >= 0) arr.splice(i, 1);
}

function init() {
  Model.load();
  Model.init();
  if (Model.scenario !== 'normal') { const r = baseRange(); ui.from = r.from; ui.to = r.to; }
  $('#nav').onclick = e => { const b = e.target.closest('button'); if (b) { ui.tab = b.dataset.tab; ui.filterOpen = false; ui.modal = null; render(); } };

  $('#view').addEventListener('click', e => {
    if (ui.filterOpen && !e.target.closest('.filter-wrap')) {      // click outside the filter menu closes it
      ui.filterOpen = false;
      if (!e.target.closest('[data-act]')) { render(); return; }
    }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const d = b.dataset, act = d.act;
    if (act === 'closemodal') { if (e.target !== b && !d.x) return; ui.modal = null; }
    else if (act === 'reset') {
      Model.reset(); Model.scenario = 'normal';
      ui.modal = null; ui.loc = ''; ui.fLocs = []; ui.fStreams = []; ui.filterOpen = false; ui.month = null; ui.simOpen = false; ui.noteOpen = false; ui.from = defFrom(); ui.to = defTo(); resetAdd();
    } else if (act === 'apply' || act === 'dismiss') {
      const r = findRec(d.id);
      if (r) { act === 'apply' ? Model.apply(r) : Model.dismiss(r); if (act === 'apply' && !r.ops) ui.noteOpen = true; }
      ui.modal = null;
    } else if (act === 'applyall') {
      for (let i = 0; i < 100; i++) { const r = allRecs().find(x => x.ops); if (!r) break; Model.apply(r); }
    } else if (act === 'selpk') ui.modal = { kind: 'pk', cid: d.cid, date: d.date };
    else if (act === 'selghost') ui.modal = { kind: 'ghost', id: d.id };
    else if (act === 'selday') ui.modal = { kind: 'day', date: d.date };
    else if (act === 'toggleadd') { ui.add.open = !ui.add.open; ui.add.msg = ''; ui.filterOpen = false; ui.scrollAdd = ui.add.open; }
    else if (act === 'setadd') { ui.add.open = true; ui.add.date = d.date; ui.add.msg = ''; ui.modal = null; ui.scrollAdd = true; }
    else if (act === 'notiftoggle') ui.notifHidden = !ui.notifHidden;
    else if (act === 'cleardates') { const r = baseRange(); ui.from = r.from; ui.to = r.to; }
    else if (act === 'simtoggle') ui.simOpen = !ui.simOpen;
    else if (act === 'notetoggle') ui.noteOpen = !ui.noteOpen;
    else if (act === 'notifmore') ui.notifAll = !ui.notifAll;
    else if (act === 'scenario') setScenario(d.val);
    else if (act === 'togglefilter') ui.filterOpen = !ui.filterOpen;
    else if (act === 'clearfilter') { ui.fLocs = []; ui.fStreams = []; }
    else if (act === 'rmfilter') toggleIn(d.kind === 'loc' ? ui.fLocs : ui.fStreams, d.val, false);
    else if (act === 'monthprev' || act === 'monthnext') {
      const dt = new Date(ui.month.y, ui.month.m + (act === 'monthnext' ? 1 : -1), 1);
      ui.month = { y: dt.getFullYear(), m: dt.getMonth() };
    } else if (act === 'monthtoday') ui.month = null;
    else if (act === 'cancelpk') { Model.manual('cancel', d.cid, d.date); ui.modal = null; }
    else if (act === 'restore') { Model.manual('add', d.cid, d.date, Model.amounts[d.cid + '|' + d.date]); ui.modal = null; }
    else if (act === 'movepk') {
      const nd = $('#moveDate').value, amount = Model.amounts[d.cid + '|' + d.date] || 1;
      if (nd && nd !== d.date) { Model.manual('cancel', d.cid, d.date); Model.manual('add', d.cid, nd, amount); }
      ui.modal = null;
    } else if (act === 'addpk') {
      const a = ui.add;
      a.loc = $('#addLoc').value; a.stream = $('#addStream').value; a.amount = +$('#addAmount').value; a.date = $('#addDate').value;
      const { cont } = addState();
      const st = Model.status(cont, parseIso(a.date));
      if (a.date < iso(Model.today)) a.msg = 'Pick today or a later date.';
      else if (st === 'scheduled' || st === 'added') a.msg = locOf(cont).name + ' already has a pickup for ' + STREAMS[cont.stream].label.toLowerCase() + ' on ' + fmtDate(a.date) + '.';
      else {
        Model.manual('add', cont.id, a.date, a.amount);
        const dd = parseIso(a.date); ui.month = { y: dd.getFullYear(), m: dd.getMonth() };
        resetAdd();
      }
    }
    render();
  });

  $('#view').addEventListener('mousemove', e => {
    const el = e.target.closest ? e.target.closest('[data-tt]') : null;
    if (!el) { tipBox.style.display = 'none'; tipBox._el = null; return; }
    if (tipBox._el !== el) { tipBox.innerHTML = el.dataset.tt; tipBox._el = el; }
    tipBox.style.display = 'block';
    const w = tipBox.offsetWidth, h = tipBox.offsetHeight;
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + w > innerWidth - 8) x = e.clientX - w - 14;
    if (y + h > innerHeight - 8) y = e.clientY - h - 14;
    tipBox.style.left = Math.max(8, x) + 'px'; tipBox.style.top = Math.max(8, y) + 'px';
  });
  $('#view').addEventListener('mouseleave', () => { tipBox.style.display = 'none'; tipBox._el = null; });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (ui.modal) ui.modal = null; else if (ui.filterOpen) ui.filterOpen = false; else if (ui.simOpen) ui.simOpen = false; else if (ui.noteOpen) ui.noteOpen = false; else return;
    render();
  });

  $('#view').addEventListener('change', e => {
    const t = e.target, id = t.id;
    if (id === 'locSel') { ui.loc = t.value; ui.modal = null; render(); }
    else if (id === 'fromSel' || id === 'toSel') { ui[id === 'fromSel' ? 'from' : 'to'] = t.value; render(); }
    else if (t.dataset.task) { Model.toggleTask(t.dataset.task); render(); }
    else if (t.dataset.fill) { Model.fillOverride[t.dataset.fill] = +t.value; render(); }
    else if (t.dataset.filter) { toggleIn(t.dataset.filter === 'loc' ? ui.fLocs : ui.fStreams, t.value, t.checked); render(); }
    else if (id === 'addLoc') { ui.add.loc = t.value; ui.add.stream = null; ui.add.msg = ''; render(); }
    else if (id === 'addStream' || id === 'addAmount' || id === 'addDate') {
      // update the estimate in place (no re-render, so a click on "Add" right after is never lost)
      if (id === 'addStream') ui.add.stream = t.value;
      if (id === 'addAmount') ui.add.amount = +t.value;
      if (id === 'addDate' && t.value) ui.add.date = t.value;
      ui.add.msg = '';
      const est = $('#addEst'); if (est) est.textContent = addEstimate();
    }
  });
  $('#view').addEventListener('input', e => {
    if (e.target.dataset.fill) $('#fv-' + e.target.dataset.fill).textContent = e.target.value + '%';
  });
  render();
}
init();
