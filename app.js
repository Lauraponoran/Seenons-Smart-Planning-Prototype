/* app.js — UI for the SmartPlan prototype (plain JS, no build step) */

const ui = { tab: 'overview', loc: '', cid: null, sel: null };
const $ = s => document.querySelector(s);
const eur = n => (n < 0 ? '−' : n > 0 ? '+' : '') + '€' + Math.abs(Math.round(n));
const kg = n => Math.round(n).toLocaleString('en-GB') + ' kg';
const pct = n => Math.round(n * 100) + '%';
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function containersInView() { return CONTAINERS.filter(c => !ui.loc || c.loc === ui.loc); }
function allRecs() { return Model.recommendations(''); }
function viewRecs() { return Model.recommendations(ui.loc); }

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

function chartSvg(c) {
  const hist = Model.hist.fills[c.id].slice(-15);
  if (Model.fillOverride[c.id] != null) hist[hist.length - 1] = { ...hist[hist.length - 1], fill: Model.fillOverride[c.id] };
  const fc = Model.simulate(c);
  const W = 720, H = 230, L = 36, R = 10, T = 10, B = 26, MAXY = 110;
  const x = i => L + (i + 14) / 28 * (W - L - R);
  const y = v => T + (1 - Math.min(v, MAXY) / MAXY) * (H - T - B);
  let hp = hist.map((p, i) => (i ? 'L' : 'M') + x(i - 14).toFixed(1) + ' ' + y(p.fill).toFixed(1)).join(' ');
  let fp = '';
  fc.forEach((p, i) => {
    fp += (i ? 'L' : 'M') + x(p.d).toFixed(1) + ' ' + y(p.fill).toFixed(1) + ' ';
    if (p.pickup) fp += 'L' + x(p.d).toFixed(1) + ' ' + y(2).toFixed(1) + ' ';
  });
  const grid = [0, 25, 50, 75, 100].map(v => '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#e3ecea"/><text x="4" y="' + (y(v) + 4) + '">' + v + '%</text>').join('');
  const marks = fc.filter(p => p.pickup).map(p => '<circle cx="' + x(p.d) + '" cy="' + y(p.fill) + '" r="5" fill="' + (p.status === 'added' ? '#2a9d57' : '#0f9d8a') + '"/>').join('');
  const overs = fc.filter(p => p.fill >= ASSUMPTIONS.alertFill).map(p => '<circle cx="' + x(p.d) + '" cy="' + y(p.fill) + '" r="6" fill="none" stroke="#d64545" stroke-width="2"/>').join('');
  let xl = '';
  for (let i = -14; i <= 14; i += 7) xl += '<text x="' + (x(i) - 14) + '" y="' + (H - 6) + '">' + (i === 0 ? 'today' : fmtDate(addDays(Model.today, i)).split(' ').slice(1).join(' ')) + '</text>';
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Fill level history and forecast">' + grid +
    '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(ASSUMPTIONS.alertFill) + '" y2="' + y(ASSUMPTIONS.alertFill) + '" stroke="#d64545" stroke-dasharray="5 4"/>' +
    '<text x="' + (W - 130) + '" y="' + (y(ASSUMPTIONS.alertFill) - 4) + '" style="fill:#d64545">overflow risk ' + ASSUMPTIONS.alertFill + '%</text>' +
    '<line x1="' + x(0) + '" x2="' + x(0) + '" y1="' + T + '" y2="' + (H - B) + '" stroke="#9db5b1"/>' +
    '<path d="' + hp + '" fill="none" stroke="#6b7f7b" stroke-width="2"/>' +
    '<path d="' + fp + '" fill="none" stroke="#0f9d8a" stroke-width="2.5" stroke-dasharray="6 4"/>' + marks + overs + xl + '</svg>' +
    '<div class="legend"><span><i style="background:#6b7f7b"></i>Sensor history</span><span><i style="background:#0f9d8a"></i>Forecast</span><span>● pickup (green = added)</span><span style="color:#d64545">○ predicted overflow</span></div>';
}

/* ---------------- views ---------------- */
function viewOverview() {
  const k = Model.kpis(ui.loc);
  const recs = viewRecs();
  const over = recs.filter(r => r.type === 'overflow').length;
  const maxStream = Math.max(1, ...Object.values(k.byStream));
  const streams = Object.keys(STREAMS).map(s => '<div class="bar-row"><span>' + STREAMS[s].label + '</span><div class="bar"><i style="width:' + (k.byStream[s] / maxStream * 100) + '%;background:' + STREAMS[s].color + '"></i></div><span>' + kg(k.byStream[s]) + '</span></div>').join('');
  const mw = Math.max(1, ...k.weekly);
  const weekly = '<svg viewBox="0 0 360 120" width="100%">' + k.weekly.map((v, i) => '<rect x="' + (i * 30 + 4) + '" y="' + (100 - v / mw * 90) + '" width="22" height="' + (v / mw * 90) + '" rx="3" fill="#0f9d8a"/><text x="' + (i * 30 + 8) + '" y="114">w' + (i + 1) + '</text>').join('') + '</svg>';
  const locs = LOCATIONS.filter(l => !ui.loc || l.id === ui.loc);
  const heat = '<table><tr><th>Location</th>' + [1, 2, 3, 4, 5, 6, 0].map(d => '<th>' + WD[d] + '</th>').join('') + '</tr>' + locs.map(l => {
    const ldays = new Set(CONTAINERS.filter(c => c.loc === l.id).flatMap(c => c.days));
    return '<tr><td>' + l.name + '</td>' + [1, 2, 3, 4, 5, 6, 0].map(d => {
      if (!ldays.has(d)) return '<td class="heat" style="color:#b6c7c4">–</td>';
      const m = Model.missRate(l.id, d), a = Math.min(1, m.rate / 0.3);
      return '<td class="heat" style="background:rgba(214,69,69,' + (0.08 + a * 0.6).toFixed(2) + ')">' + pct(m.rate) + '</td>';
    }).join('') + '</tr>';
  }).join('') + '</table>';
  const top = recs.filter(r => r.ops).slice(0, 3).map(recCard).join('') || '<p class="sub">No open schedule suggestions — the plan looks healthy.</p>';
  return '<h2>Overview</h2><p class="sub">What we expect the customer already sees today (orders, weight, separation, CO₂) plus the new layer: what to do next.</p>' +
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

function viewPlanner() {
  const cs = containersInView();
  if (!ui.cid || !cs.find(c => c.id === ui.cid)) ui.cid = cs[0].id;
  const recs = viewRecs();
  const ghosts = [];
  recs.filter(r => r.ops).forEach(r => r.ops.filter(o => o.op === 'add').forEach(o => ghosts.push({ rec: r, cid: o.cid, date: o.date })));
  let cells = '';
  for (let d = 0; d < 14; d++) {
    const date = addDays(Model.today, d), key = iso(date);
    const items = Model.pickups(date, 1).filter(p => cs.find(c => c.id === p.cid));
    const chips = items.map(p => {
      const c = Model.cont(p.cid), sim = Model.simulate(c).find(x => x.date === key);
      const sel = ui.sel && ui.sel.kind === 'pk' && ui.sel.cid === p.cid && ui.sel.date === key;
      return '<button class="pk ' + p.status + (sel ? ' sel' : '') + '" style="--c:' + STREAMS[c.stream].color + '" data-act="selpk" data-cid="' + p.cid + '" data-date="' + key + '">' +
        STREAMS[c.stream].label + '<small>' + Model.loc(c.loc).name.split(' – ')[0] + (p.status === 'cancelled' ? ' · cancelled' : sim ? ' · ~' + Math.round(Math.min(sim.fill, 100)) + '% full' : '') + '</small></button>';
    }).join('');
    const gh = ghosts.filter(g => g.date === key).map(g => {
      const c = Model.cont(g.cid);
      return '<button class="pk ghost" style="--c:' + STREAMS[c.stream].color + '" data-act="selghost" data-id="' + g.rec.id + '">✦ ' + STREAMS[c.stream].label + '<small>Agent suggests · ' + Model.loc(c.loc).name.split(' – ')[0] + '</small></button>';
    }).join('');
    cells += '<div class="day ' + (d === 0 ? 'today' : '') + '"><div class="dh"><b>' + fmtDate(date) + '</b>' + (d === 0 ? '<span>today</span>' : '') + '</div>' + chips + gh + '</div>';
  }
  let panel = '<p class="small">Select a pickup or an agent suggestion in the calendar to see details and change it.</p>';
  const s = ui.sel;
  if (s && s.kind === 'ghost') {
    const r = allRecs().find(x => x.id === s.id);
    if (r) panel = recCard(r);
  } else if (s && s.kind === 'pk') {
    const c = Model.cont(s.cid), st = Model.status(c, parseIso(s.date)), sim = Model.simulate(c).find(x => x.date === s.date);
    const free = Model.isFree(s.date), mr = Model.missRate(c.loc, parseIso(s.date).getDay());
    const feeNote = free ? '<span class="chip good">Free to change (≥ 1 day ahead)</span>' : '<span class="chip bad">Less than 1 day ahead — €' + ASSUMPTIONS.sameDayFee + ' fee</span>';
    panel = '<h3>' + Model.contLabel(c) + ' · ' + fmtDate(s.date) + '</h3>' +
      '<p>Status: <b>' + st + '</b>' + (sim ? ' · forecast fill at pickup ~<b>' + Math.round(Math.min(sim.fill, 100)) + '%</b>' : '') +
      ' · historic miss rate on this weekday: <b>' + pct(mr.rate) + '</b> (' + mr.n + ' pickups)</p><p>' + feeNote + '</p>' +
      (st === 'cancelled'
        ? '<button class="btn" data-act="restore" data-cid="' + s.cid + '" data-date="' + s.date + '">Restore pickup</button>'
        : '<button class="btn danger" data-act="cancelpk" data-cid="' + s.cid + '" data-date="' + s.date + '">Cancel this pickup</button> ' +
          '<span class="small">or move to</span> <input type="date" id="moveDate" min="' + iso(Model.today) + '" value="' + iso(addDays(parseIso(s.date), 1)) + '"> ' +
          '<button class="btn sec" data-act="movepk" data-cid="' + s.cid + '" data-date="' + s.date + '">Move</button>');
  }
  const opts = cs.map(c => '<option value="' + c.id + '"' + (c.id === ui.cid ? ' selected' : '') + '>' + Model.contLabel(c) + '</option>').join('');
  const addForm = '<div class="card" style="margin-top:14px"><h3>Add an extra pickup manually</h3>' +
    '<select id="addCid">' + opts + '</select> <input type="date" id="addDate" min="' + iso(Model.today) + '" value="' + iso(addDays(Model.today, 2)) + '"> ' +
    '<button class="btn sec" data-act="addpk">Add pickup</button></div>';
  const c = Model.cont(ui.cid), cur = Math.round(Model.currentFill(c));
  return '<h2>Planner</h2><p class="sub">Next 14 days. Solid = scheduled, dashed ✦ = suggested by the agent (click to review and apply).</p>' +
    '<div class="legend">' + Object.values(STREAMS).map(s => '<span><i style="background:' + s.color + '"></i>' + s.label + '</span>').join('') + '</div>' +
    '<div class="cal">' + cells + '</div>' +
    '<div class="card" style="margin-top:14px">' + panel + '</div>' + addForm +
    '<div class="card" style="margin-top:14px"><h3>Fill-level forecast</h3><select id="chartSel">' + opts + '</select> <span class="small">Sensor now: <b>' + cur + '%</b> · measured fill rate ≈ ' + Model.measuredRate(c).toFixed(1) + '%/day × demand factor ' + Model.scenarioMult(c).toFixed(2) + '</span>' + chartSvg(c) + '</div>';
}

function viewAgent() {
  const recs = viewRecs();
  const sched = recs.filter(r => r.ops);
  const net = sched.reduce((a, r) => ({ p: a.p + r.impact.pickups, c: a.c + r.impact.cost, co: a.co + r.impact.co2 }), { p: 0, c: 0, co: 0 });
  const log = Model.log.map(l => '<li><span class="small">' + new Date(l.t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + '</span> ' + l.text + '</li>').join('') || '<li class="small">Nothing yet — apply a suggestion to see it here.</li>';
  return '<h2>AI agent</h2><p class="sub">Closes the loop: partner data → platform → agent → insight → <b>one click in the schedule</b>. Every suggestion shows the data behind it.</p>' +
    '<div class="card" style="margin-bottom:14px"><b>' + recs.length + ' open suggestions.</b> If all schedule changes are applied: ' + net.p + ' pickups, ' + eur(net.c) + ', ' + net.co.toFixed(1) + ' kg CO₂ (demo assumptions). ' +
    (sched.length ? '<button class="btn" style="margin-left:8px" data-act="applyall">Apply all schedule changes</button>' : '') + '</div>' +
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
  return '<h2>Data &amp; assumptions</h2><p class="sub">Everything the prototype takes for granted, and what we would add.</p>' +
    '<div class="card" style="margin-bottom:14px"><h3>Assumptions made in this prototype</h3><ul>' +
    '<li>Disposal partners deliver pickup status and weights; the platform already has orders, weight, separation rate and CO₂ per stream.</li>' +
    '<li>New: fill-level sensors report daily (here simulated; use the sliders below to change a reading and watch the agent react).</li>' +
    '<li>Rescheduling is free at least ' + A.freeRescheduleDays + ' day ahead; closer than that costs €' + A.sameDayFee + ' (demo value).</li>' +
    '<li>Costs: €' + A.pickupCost + ' per pickup, ' + A.co2PerPickup + ' kg CO₂ per truck stop, overflow threshold ' + A.alertFill + '% (all demo values).</li>' +
    '<li>Demand scenarios (Black Friday, Sinterklaas, Christmas, summer) are simple multipliers per company type; the real model would learn them from history.</li>' +
    '<li>All locations, containers and history in this demo are synthetic.</li></ul></div>' +
    '<div class="card" style="margin-bottom:14px"><h3>Sensor simulator</h3><table><tr><th>Container</th><th>Fill level now</th><th>Measured rate</th><th>Scheduled</th><th>Forecast</th></tr>' + rows + '</table></div>' +
    '<div class="card"><h3>Data collection roadmap</h3><table><tr><th>Data point</th><th>Today (assumed)</th><th>Proposed collection</th><th>Used by agent for</th><th>If data is missing</th></tr>' + roadmap + '</table></div>';
}

/* ---------------- render + events ---------------- */
function render() {
  $('#nav').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  const n = viewRecs().length;
  $('#agentCount').textContent = n || '';
  const sc = SCENARIOS[Model.scenario];
  $('#banner').innerHTML = sc.note ? '<b>Scenario: ' + sc.label + '.</b> ' + sc.note + ' Forecasts use higher or lower fill rates.' : '';
  $('#view').innerHTML = { overview: viewOverview, planner: viewPlanner, agent: viewAgent, data: viewData }[ui.tab]();
  Model.save();
}

function init() {
  Model.load();
  Model.init();
  $('#locSel').innerHTML = '<option value="">All locations</option>' + LOCATIONS.map(l => '<option value="' + l.id + '">' + l.name + '</option>').join('');
  $('#scSel').innerHTML = Object.entries(SCENARIOS).map(([k, v]) => '<option value="' + k + '">' + v.label + '</option>').join('');
  $('#scSel').value = Model.scenario;
  $('#locSel').onchange = e => { ui.loc = e.target.value; ui.sel = null; render(); };
  $('#scSel').onchange = e => { Model.scenario = e.target.value; render(); };
  $('#resetBtn').onclick = () => { Model.reset(); Model.scenario = 'normal'; $('#scSel').value = 'normal'; ui.sel = null; render(); };
  $('#nav').onclick = e => { const b = e.target.closest('button'); if (b) { ui.tab = b.dataset.tab; render(); } };

  $('#view').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const d = b.dataset, act = d.act;
    if (act === 'apply' || act === 'dismiss') {
      const r = allRecs().find(x => x.id === d.id);
      if (r) { act === 'apply' ? Model.apply(r) : Model.dismiss(r); ui.sel = null; }
    } else if (act === 'applyall') {
      viewRecs().filter(r => r.ops).forEach(() => {
        const r = viewRecs().find(x => x.ops); if (r) Model.apply(r);
      });
    } else if (act === 'selpk') ui.sel = { kind: 'pk', cid: d.cid, date: d.date };
    else if (act === 'selghost') ui.sel = { kind: 'ghost', id: d.id };
    else if (act === 'cancelpk') { Model.manual('cancel', d.cid, d.date); }
    else if (act === 'restore') { Model.manual('add', d.cid, d.date); }
    else if (act === 'movepk') {
      const nd = $('#moveDate').value;
      if (nd && nd !== d.date) { Model.manual('cancel', d.cid, d.date); Model.manual('add', d.cid, nd); ui.sel = { kind: 'pk', cid: d.cid, date: nd }; }
    } else if (act === 'addpk') {
      const cid = $('#addCid').value, date = $('#addDate').value;
      if (cid && date) { Model.manual('add', cid, date); ui.sel = { kind: 'pk', cid, date }; }
    }
    render();
  });
  $('#view').addEventListener('change', e => {
    if (e.target.id === 'chartSel') { ui.cid = e.target.value; render(); }
    if (e.target.dataset.fill) { Model.fillOverride[e.target.dataset.fill] = +e.target.value; render(); }
  });
  $('#view').addEventListener('input', e => {
    if (e.target.dataset.fill) $('#fv-' + e.target.dataset.fill).textContent = e.target.value + '%';
  });
  render();
}
init();
