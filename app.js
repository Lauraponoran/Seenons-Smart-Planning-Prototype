/* app.js — UI for the SmartPlan prototype (plain JS, no build step) */

const ui = {
  tab: 'overview', loc: '', cid: null, modal: null, month: null,
  fLocs: [], fStreams: [], filterOpen: false,           // planner calendar filters (empty = show all)
  add: { open: false, loc: null, stream: null, amount: 1, date: null, msg: '' },
  scrollAdd: false
};
const $ = s => document.querySelector(s);
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
const typeLabel = { overflow: 'Overflow risk', risk: 'Missed-pickup risk', underfill: 'Cost saving', composition: 'Composition' };

function recCard(r) {
  return '<div class="card rec"><div class="body">' +
    '<span class="badge ' + r.severity + '">' + r.severity + '</span> <span class="badge">' + typeLabel[r.type] + '</span>' +
    '<h4>' + r.title + '</h4><p>' + r.reason + '</p><div>' + impactChips(r) + '</div></div>' +
    '<div class="acts"><button class="btn" data-act="apply" data-id="' + r.id + '">' + (r.ops ? 'Apply to schedule' : 'Create task') + '</button>' +
    '<button class="btn sec" data-act="dismiss" data-id="' + r.id + '">Dismiss</button></div></div>';
}

/* page heading, with the demo-controls widget directly underneath.
   Why the widget sits under the heading of every tab (not only Planner): the scenario is global
   state — it changes the forecast, the agent's suggestions and the Overview KPIs — so the control
   has to be reachable wherever its effect shows. To limit it to Planner, make the eventWidget() call
   below conditional on ui.tab === 'planner'. */
function pageHead(title, sub) {
  return '<div class="page-head"><div><h2>' + title + '</h2>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div></div>' + eventWidget();
}

/* widget: a slim dashed strip (so it reads as prototype tooling, not product UI) with the events as a
   segmented control — one click per scenario instead of a dropdown — plus Reset demo.
   Picking an event reveals the info line (effects + overflow count) inside the strip. */
function eventWidget() {
  const tabs = Object.entries(SCENARIOS).map(([k, v]) =>
    '<button class="wi-tab' + (k === Model.scenario ? ' on' : '') + '" data-act="scenario" data-val="' + k + '" aria-pressed="' + (k === Model.scenario) + '">' + (v.short || v.label) + '</button>').join('');
  return '<section class="whatif"><div class="wi-top"><div class="wi-title">Simulate an event <small>Demo</small></div>' +
    '<div class="wi-pills" role="group" aria-label="Simulate an event">' + tabs + '</div>' +
    '<button class="wi-reset" data-act="reset">Reset demo</button></div>' + eventLine() + '</section>';
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
  // one tag per location type; hover / focus / tap to see why the percentage is what it is
  const tiles = Object.entries(sc.mult).map(([t, m]) => {
    const tip = (why[t] || '') + ' The forecast fill rate for every ' + t.toLowerCase() + ' container is multiplied by ' + m + '.';
    return '<div class="fx tip ' + (m > 1 ? 'up' : m < 1 ? 'down' : '') + '" tabindex="0" data-tip="' + esc(tip) + '"><span class="fx-l">' + t + '</span><span class="fx-v">' + pctDelta(m) + '</span></div>';
  }).join('');
  const riskTip = 'Containers the agent expects to reach ' + ASSUMPTIONS.alertFill + '% full within 14 days, before their next pickup. ' +
    (n > fx.base.overflow ? 'The higher waste volumes fill them faster, so ' + (n - fx.base.overflow) + ' more than normal now need action.' : 'This event does not add any new overflow risks.');
  const risk = '<div class="fx risk tip" tabindex="0" data-tip="' + esc(riskTip) + '"><span class="fx-l">Overflow risks · ' + fx.base.overflow + ' normally</span><span class="fx-v">' + n + '</span></div>';
  return '<div class="wi-fx">' + (sc.note ? '<p class="wi-note">' + sc.note + '</p>' : '') + tiles + risk + '</div>';
}

/* heading + widget (+ location select on pages that filter by one location) */
function pageTop(title, sub, withLoc) {
  const loc = withLoc
    ? '<div class="toolbar"><label>Location<select id="locSel"><option value="">All locations</option>' +
      LOCATIONS.map(l => '<option value="' + l.id + '"' + (l.id === ui.loc ? ' selected' : '') + '>' + l.name + '</option>').join('') + '</select></label></div>'
    : '';
  return pageHead(title, sub) + loc;
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

/* ---------------- views ---------------- */
function viewOverview() {
  const k = Model.kpis(ui.loc);
  const recs = viewRecs();
  const over = recs.filter(r => r.type === 'overflow').length;
  const maxStream = Math.max(1, ...Object.values(k.byStream));
  const streams = Object.keys(STREAMS).map(s => '<div class="bar-row"><span>' + STREAMS[s].label + '</span><div class="bar"><i style="width:' + (k.byStream[s] / maxStream * 100) + '%;background:' + STREAMS[s].color + '"></i></div><span>' + kg(k.byStream[s]) + '</span></div>').join('');
  const mw = Math.max(1, ...k.weekly);
  const weekly = '<svg viewBox="0 0 360 120" width="100%">' + k.weekly.map((v, i) => '<rect x="' + (i * 30 + 4) + '" y="' + (100 - v / mw * 90) + '" width="22" height="' + (v / mw * 90) + '" rx="3" fill="' + COL.teal + '"/><text x="' + (i * 30 + 8) + '" y="114">w' + (i + 1) + '</text>').join('') + '</svg>';
  const locs = LOCATIONS.filter(l => !ui.loc || l.id === ui.loc);
  const heat = '<table><tr><th>Location</th>' + [1, 2, 3, 4, 5, 6, 0].map(d => '<th>' + WD[d] + '</th>').join('') + '</tr>' + locs.map(l => {
    const ldays = new Set(CONTAINERS.filter(c => c.loc === l.id).flatMap(c => c.days));
    return '<tr><td>' + l.name + '</td>' + [1, 2, 3, 4, 5, 6, 0].map(d => {
      if (!ldays.has(d)) return '<td class="heat" style="color:#b6c7c4">–</td>';
      const m = Model.missRate(l.id, d), a = Math.min(1, m.rate / 0.3);
      return '<td class="heat" style="background:rgba(234,91,125,' + (0.08 + a * 0.6).toFixed(2) + ')">' + pct(m.rate) + '</td>';
    }).join('') + '</tr>';
  }).join('') + '</table>';
  const top = recs.filter(r => r.ops).slice(0, 3).map(recCard).join('') || '<p class="sub">No open schedule suggestions — the plan looks healthy.</p>';
  return pageTop('Overview', 'What we expect the customer already sees today (orders, weight, separation, CO₂) plus the new layer: what to do next.', true) +
    '<div class="grid kpis">' +
    '<div class="card kpi"><div class="v">' + k.orders + '</div><div class="l">Total orders (12 weeks)</div></div>' +
    '<div class="card kpi"><div class="v">' + kg(k.weight) + '</div><div class="l">Total weight</div></div>' +
    '<div class="card kpi"><div class="v">' + pct(k.separation) + '</div><div class="l">Source separation rate</div></div>' +
    '<div class="card kpi"><div class="v">' + kg(k.co2) + '</div><div class="l">CO₂ saved (demo factors)</div></div>' +
    '<div class="card kpi ' + (k.missRate > 0.06 ? 'warn' : '') + '"><div class="v">' + pct(k.missRate) + '</div><div class="l">Missed pickups (' + k.missed + ')</div></div>' +
    '<div class="card kpi ' + (over ? 'warn' : '') + '"><div class="v">' + over + '</div><div class="l">Containers at risk of overflow (14 d)</div></div></div>' +
    '<div class="grid cols2"><div class="card"><h3>Waste (kg) by stream</h3>' + streams + '</div>' +
    '<div class="card"><h3>Weight per week (kg)</h3>' + weekly + '</div></div>' +
    '<div class="card" style="margin-bottom:14px"><h3>Missed-pickup rate by weekday <span class="small">— service-event data the agent learns from</span></h3>' + heat + '</div>' +
    '<h3>Top suggestions from the agent</h3>' + top;
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
  const todayKey = iso(Model.today);
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
    cells += '<div class="day ' + (key === todayKey ? 'today ' : '') + (past ? 'past ' : '') + (other ? 'other ' : '') + (hol && hol.kind === 'public' ? 'hol-public' : '') + '"><div class="dh"><b>' + date.getDate() + '</b>' +
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
    addForm() + activeRow +
    '<div class="cal">' + head + cells + '</div>' +
    '</div>' + plannerModal();
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
      '<h3 style="margin-top:8px">' + r.title + '</h3><p>' + r.reason + '</p><div>' + impactChips(r) + '</div>' +
      '<div class="acts" style="margin-top:12px"><button class="btn" data-act="apply" data-id="' + r.id + '">' + (r.ops ? 'Apply to schedule' : 'Create task') + '</button>' +
      '<button class="btn sec" data-act="dismiss" data-id="' + r.id + '">Dismiss</button></div>';
  } else if (m.kind === 'pk') {
    const c = Model.cont(m.cid), st = Model.status(c, parseIso(m.date)), sim = Model.simulate(c).find(x => x.date === m.date);
    const mr = Model.missRate(c.loc, parseIso(m.date).getDay());
    const amount = Model.amounts[m.cid + '|' + m.date] || 1;
    body = close + '<h3>' + Model.contLabel(c) + '</h3><p>' + fmtDate(m.date) + ' · status <b>' + st + '</b>' + (amount > 1 ? ' · <b>' + amount + ' containers</b>' : '') +
      (sim ? ' · forecast fill ~<b>' + Math.round(Math.min(sim.fill, 100)) + '%</b>' : '') +
      '<br>Missed on this weekday historically: <b>' + pct(mr.rate) + '</b> (' + mr.n + ' pickups)</p>' +
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

function viewForecast() {
  const cs = containersInView();
  if (!ui.cid || !cs.find(c => c.id === ui.cid)) ui.cid = cs[0].id;
  const c = Model.cont(ui.cid);
  const opts = cs.map(x => '<option value="' + x.id + '"' + (x.id === ui.cid ? ' selected' : '') + '>' + Model.contLabel(x) + '</option>').join('');
  return pageTop('Forecast', '', true) + '<div class="fc-head"><select id="chartSel">' + opts + '</select>' +
    '<span class="small">Sensor now <b>' + Math.round(Model.currentFill(c)) + '%</b></span></div>' +
    '<div class="card">' + chartSvg(c, true) + '</div>';
}

function viewAgent() {
  const recs = viewRecs();
  const sched = recs.filter(r => r.ops);
  const net = sched.reduce((a, r) => ({ p: a.p + r.impact.pickups, c: a.c + r.impact.cost, co: a.co + r.impact.co2 }), { p: 0, c: 0, co: 0 });
  const log = Model.log.map(l => '<li><span class="small">' + new Date(l.t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + '</span> ' + l.text + '</li>').join('') || '<li class="small">Nothing yet — apply a suggestion to see it here.</li>';
  return pageTop('AI agent', 'Closes the loop: partner data → platform → agent → insight → <b>one click in the schedule</b>. Every suggestion shows the data behind it.', true) +
    '<div class="card" style="margin-bottom:14px"><b>' + recs.length + ' open suggestions.</b> If all schedule changes are applied: ' + net.p + ' pickups, ' + eur(net.c) + ', ' + net.co.toFixed(1) + ' kg CO₂ (demo assumptions). ' +
    (sched.length ? '<button class="btn sm" style="margin-left:8px" data-act="applyall">Apply all schedule changes</button>' : '') + '</div>' +
    (recs.map(recCard).join('') || '<div class="card">All clear — no suggestions right now.</div>') +
    '<div class="card"><h3>Activity log</h3><ul class="log">' + log + '</ul></div>';
}

function viewData() {
  const A = ASSUMPTIONS;
  const rows = containersInView().map(c => {
    const cur = Math.round(Model.currentFill(c)), sim = Model.simulate(c), over = sim.find(p => p.fill >= A.alertFill);
    return '<tr><td>' + Model.contLabel(c) + '</td><td><input type="range" min="0" max="100" value="' + cur + '" data-fill="' + c.id + '"> <b id="fv-' + c.id + '">' + cur + '%</b></td><td>' +
      Model.measuredRate(c).toFixed(1) + '%/day</td><td>' + c.days.map(d => WD[d]).join(', ') + '</td><td>' + (over ? '<span class="chip bad">full ' + fmtDate(over.date) + '</span>' : '<span class="chip good">ok 14 d</span>') + '</td></tr>';
  }).join('');
  const roadmap = [
    ['Container fill level', 'Not available — relies on disposal partner', 'Ultrasonic / weight sensors in containers (LoRaWAN / NB-IoT → MQTT)', 'Forecast when a container is full; pickup only when needed', 'Customer taps “container full?” in the app; estimate from past weights'],
    ['Actual weight at pickup', 'Arrives late via partner receipt / invoice', 'Truck-scale or bin-lift weighing posted via partner API', 'Cost per kg, fill-rate calibration', 'Parse invoices (OCR) and back-fill weights'],
    ['Waste composition', 'Not available', 'Camera + computer vision, automated scanner, periodic audits', 'Contamination alerts, bin-mix advice', 'Quarterly manual audit, photo upload by site staff'],
    ['Time, season & company behaviour', 'Order dates only', 'Holiday calendar, company type, site size, opening hours', 'Predictive instead of reactive scheduling', 'Ask for opening hours and peak periods during onboarding'],
    ['Collection / service events', 'Customer calls (9 in 10 = “not picked up”)', 'Driver app: scheduled vs actual time, reason for failed pickup, route data', 'Missed-pickup risk by location and weekday', 'Log customer complaints as structured tickets']
  ].map(r => '<tr>' + r.map((x, i) => '<td' + (i === 0 ? ' style="font-weight:600"' : '') + '>' + x + '</td>').join('') + '</tr>').join('');
  return pageTop('Data &amp; assumptions', 'Everything the prototype takes for granted, and what we would add.', true) +
    '<div class="card" style="margin-bottom:14px"><h3>Assumptions made in this prototype</h3><ul>' +
    '<li>Disposal partners deliver pickup status and weights; the platform already has orders, weight, separation rate and CO₂ per stream.</li>' +
    '<li>New: fill-level sensors report daily (here simulated; use the sliders below to change a reading and watch the agent react).</li>' +
    '<li>Costs: €' + A.pickupCost + ' per pickup, ' + A.co2PerPickup + ' kg CO₂ per truck stop, overflow threshold ' + A.alertFill + '% (all demo values).</li>' +
    '<li>Simulated events (Black Friday, Sinterklaas, Christmas, summer) are simple multipliers per company type; the real model would learn them from history.</li>' +
    '<li>All locations, containers and history in this demo are synthetic.</li></ul></div>' +
    '<div class="card" style="margin-bottom:14px"><h3>Sensor simulator</h3><table><tr><th>Container</th><th>Fill level now</th><th>Measured rate</th><th>Scheduled</th><th>Forecast</th></tr>' + rows + '</table></div>' +
    '<div class="card"><h3>Data collection roadmap</h3><table><tr><th>Data point</th><th>Today (assumed)</th><th>Proposed collection</th><th>Used by agent for</th><th>If data is missing</th></tr>' + roadmap + '</table></div>';
}

/* ---------------- render + events ---------------- */
function render() {
  $('#nav').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  const n = viewRecs().length;
  $('#agentCount').textContent = n || '';
  $('#view').innerHTML = { overview: viewOverview, planner: viewPlanner, forecast: viewForecast, agent: viewAgent, data: viewData }[ui.tab]();
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
      ui.modal = null; ui.loc = ''; ui.fLocs = []; ui.fStreams = []; ui.filterOpen = false; ui.month = null; resetAdd();
    } else if (act === 'apply' || act === 'dismiss') {
      const r = allRecs().find(x => x.id === d.id);
      if (r) { act === 'apply' ? Model.apply(r) : Model.dismiss(r); }
      ui.modal = null;
    } else if (act === 'applyall') {
      viewRecs().filter(r => r.ops).forEach(() => {
        const r = viewRecs().find(x => x.ops); if (r) Model.apply(r);
      });
    } else if (act === 'selpk') ui.modal = { kind: 'pk', cid: d.cid, date: d.date };
    else if (act === 'selghost') ui.modal = { kind: 'ghost', id: d.id };
    else if (act === 'selday') ui.modal = { kind: 'day', date: d.date };
    else if (act === 'toggleadd') { ui.add.open = !ui.add.open; ui.add.msg = ''; ui.filterOpen = false; ui.scrollAdd = ui.add.open; }
    else if (act === 'setadd') { ui.add.open = true; ui.add.date = d.date; ui.add.msg = ''; ui.modal = null; ui.scrollAdd = true; }
    else if (act === 'scenario') Model.scenario = d.val;
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

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (ui.modal) ui.modal = null; else if (ui.filterOpen) ui.filterOpen = false; else return;
    render();
  });

  $('#view').addEventListener('change', e => {
    const t = e.target, id = t.id;
    if (id === 'locSel') { ui.loc = t.value; ui.modal = null; render(); }
    else if (id === 'chartSel') { ui.cid = t.value; render(); }
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
