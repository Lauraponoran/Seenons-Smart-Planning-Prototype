/* ------------------------------------------------------------------
   assistant.js — in-page AI assistant for the SmartPlan prototype (plain JS, no build step)

   Three things it does:
   1. Quick answers (FAQ) about the planner, forecasts and the report.
   2. Builds new charts on the Report page from a plain-language request: it recombines the pickup data
      (measure × dimension × filters × chart type) to fit the user's use case.
   3. Brings in other data: a CSV the user uploads, or "open data" (simulated in this prototype).

   HOW IT WORKS (honest version): a static site cannot hold an API key, so the language understanding here is a
   small keyword parser, which keeps every answer explainable. To use a real LLM, set
   window.SMARTPLAN_CHAT_API = 'https://your-backend/chat' before this script runs. The backend gets
   { message, history, schema } and answers { reply, chart? } where chart is a spec as built by parse() below.
   Never put an API key in this static site. The "find data on the internet" step needs that backend too;
   until then the outside data sources (weather, rainfall, footfall) are simulated and labelled as such.
------------------------------------------------------------------- */

const Assistant = (() => {
  'use strict';
  const KEY = 'smartplan-assistant-v1';
  const st = { open: false, max: false, msgs: [], charts: [], uploads: [], last: null, seq: 1, busy: false };
  const PAL = ['#4DA58A', '#5B93CF', '#F2A65A', '#E5566D', '#8E6BBF', '#5E8A96', '#A3C94E', '#F27FA0'];

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const pretty = f => cap(String(f).replace(/_/g, ' '));
  const rich = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  const sumBy = (a, f) => a.reduce((x, r) => x + f(r), 0);
  const fmtNum = v => v == null ? '–' : Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-GB') : (Math.round(v * 10) / 10).toLocaleString('en-GB');
  const dShortLocal = s => parseIso(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  /* ================= persistence ================= */
  function save() {
    const base = { charts: st.charts, msgs: st.msgs.slice(-30), last: st.last, seq: st.seq };
    try { localStorage.setItem(KEY, JSON.stringify({ ...base, uploads: st.uploads })); }
    catch (e) { try { localStorage.setItem(KEY, JSON.stringify(base)); } catch (e2) { /* storage may be unavailable */ } }
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s) { st.charts = s.charts || []; st.uploads = s.uploads || []; st.msgs = s.msgs || []; st.last = s.last || null; st.seq = s.seq || 1; }
    } catch (e) { /* ignore */ }
  }

  /* ================= FAQ ================= */
  const A = () => ASSUMPTIONS;
  const FAQ = [
    { q: 'How does the forecast work?', k: ['forecast', 'predict', 'fill level', 'how accurate', 'sensor'],
      a: () => 'Every container has a measured fill rate (% of its capacity per day) from the sensor history. The forecast multiplies that by a weekday pattern (shops are busiest Friday to Sunday, offices Monday to Friday) and by the active holiday scenario, and projects the next 14 days.\nIf a container is expected to reach **' + A().alertFill + '%** before its next pickup, the agent flags an overflow risk.' },
    { q: 'What do the AI suggestions mean?', k: ['suggestion', 'ai ', 'agent', 'recommend', 'apply', 'why?'],
      a: () => 'The agent checks four things: **overflow risk** (move or add a pickup), **missed-pickup risk** (move a pickup off a weekday that is often missed), **cost saving** (skip a pickup when the container is under ' + A().underfillFill + '% full) and **composition** (a follow-up task when 20% or more of residual is recyclable).\nChoose **Why?** to see the reasoning and impact, then Apply, Dismiss or Apply all.' },
    { q: 'How do I add, move or cancel a pickup?', k: ['add pickup', 'add a pickup', 'move', 'cancel', 'reschedule', 'new pickup', 'edit'],
      a: () => 'Press **+** on a day, or **+ Add pickup** above the calendar, and fill in location, type of waste, amount and date.\nTo cancel or move a pickup, tap its chip on the calendar. Past days are read-only.' },
    { q: 'What does the holiday simulator do?', k: ['simulator', 'holiday', 'black friday', 'sinterklaas', 'christmas', 'summer', 'scenario', 'what if'],
      a: () => 'It applies a demand multiplier per location type (for example Black Friday: retail +60%) to the forecast. The planner and the Report jump to the event dates, the agent re-plans, and the numbers show projected values.\nChoose **Back to real data** or **Reset demo** to return.' },
    { q: 'What are the separation and resource saved rates?', k: ['separation', 'resource saved', 'recycl', 'rate mean'],
      a: () => '**Source separation rate** is the share of collected weight that is not residual.\n**Resource saved rate** is the share that was actually recycled or recovered, using demo recovery factors per waste stream (for example glass 90%, paper 70%).' },
    { q: 'Why do pickups get missed?', k: ['missed', 'miss rate', 'why miss', 'heatmap', 'weekday'],
      a: () => 'The service history records a reason for every missed pickup (container blocked, access locked, truck capacity, no driver, wrong container placed). The weekday heatmap on the Report shows where misses cluster.\nWhen a weekday reaches a **' + Math.round(A().riskMissRate * 100) + '%** miss rate, the agent proposes moving the pickup to a safer day.' },
    { q: 'Where does the data come from?', k: ['data come', 'where does', 'real data', 'synthetic', 'demo data', 'source'],
      a: () => 'Everything is synthetic demo data (see data.js and engine.js). It stands in for partner reports and sensor feeds. State is stored in your browser only, and **Reset demo** clears it.' },
    { q: 'How are cost and CO₂ calculated?', k: ['cost', 'price', 'co2', 'co₂', 'carbon', 'euro', '€'],
      a: () => 'Cost uses a flat **€' + A().pickupCost + '** per pickup. Rescheduling or cancellation fees are not modelled.\nCO₂ saved uses a demo factor per kg of each waste stream, and each extra truck stop adds ' + A().co2PerPickup + ' kg CO₂.' }
  ];
  const faqMatch = t => {
    let best = null, score = 0;
    FAQ.forEach(f => { const s = f.k.reduce((a, k) => a + (t.includes(k) ? 1 : 0), 0) + (t === f.q.toLowerCase() ? 5 : 0); if (s > score) { score = s; best = f; } });
    return best;
  };

  /* ================= outside data (simulated) and uploaded files ================= */
  const rnd = (d, salt) => mulberry32(Math.floor(d.getTime() / 864e5) * 131 + salt)();
  const doy = d => Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
  const EXT = {
    temp: { label: 'Average temperature (°C)', short: 'temperature', agg: 'avg', color: '#E58A3C', fmt: v => v.toFixed(1) + ' °C',
      value: d => 9.5 + 8.5 * Math.sin(2 * Math.PI * (doy(d) - 105) / 365) + (rnd(d, 1) - 0.5) * 5 },
    rain: { label: 'Rainfall (mm)', short: 'rainfall', agg: 'sum', color: '#3C6FA8', fmt: v => Math.round(v) + ' mm',
      value: d => { const r = rnd(d, 2); return r > 0.62 ? Math.round((r - 0.62) / 0.38 * 140) / 10 : 0; } },
    foot: { label: 'Footfall index (100 = normal)', short: 'footfall', agg: 'avg', color: '#8E6BBF', fmt: v => Math.round(v) + '',
      value: d => 100 * [0.95, 0.9, 0.92, 0.95, 1.05, 1.2, 1.15][d.getDay()] * (1 + 0.12 * Math.sin(2 * Math.PI * (doy(d) - 110) / 365)) * (0.95 + 0.1 * rnd(d, 3)) + (Model.holiday(d) ? 6 : 0) }
  };

  function parseCSV(text) {
    const first = text.split(/\r?\n/, 1)[0] || '';
    const delim = [';', '\t', ','].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let cur = [], f = '', q = false;
    const endRow = () => { cur.push(f); f = ''; if (cur.some(x => x.trim() !== '')) rows.push(cur); cur = []; };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { cur.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; endRow(); }
      else f += ch;
    }
    if (f !== '' || cur.length) endRow();
    return rows;
  }
  function toNum(s) {
    let x = String(s == null ? '' : s).trim().replace(/[€$%\s]/g, '');
    if (!x || !/^-?[\d.,]+$/.test(x)) return null;
    if (/,\d{1,2}$/.test(x) && x.indexOf('.') >= 0) x = x.replace(/\./g, '').replace(',', '.');
    else if (/,\d{1,2}$/.test(x) && x.split(',').length === 2) x = x.replace(',', '.');
    else x = x.replace(/,/g, '');
    const v = parseFloat(x); return isFinite(v) ? v : null;
  }
  function toDate(s) {
    const x = String(s || '').trim(); let m;
    if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(x))) return iso(new Date(+m[1], +m[2] - 1, +m[3]));
    if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(x))) return iso(new Date(+m[3], +m[2] - 1, +m[1]));   // day first, as in the Netherlands
    if (/[a-z]/i.test(x) && x.length > 5) { const d = new Date(x); if (!isNaN(d)) return iso(d); }
    return null;
  }
  function ingest(name, text) {
    const rows = parseCSV(text);
    if (rows.length < 3) return { err: 'That file has fewer than two data rows, so there is nothing to chart yet.' };
    const head = rows[0].map((h, i) => (h || '').trim() || 'Column ' + (i + 1)), body = rows.slice(1, 5001), cols = head.length;
    const share = (i, f) => body.filter(r => f(r[i])).length / body.length;
    const dateCol = head.findIndex((h, i) => share(i, v => toDate(v) !== null && toNum(v) === null) >= 0.8);
    const numCols = head.map((h, i) => i).filter(i => i !== dateCol && share(i, v => toNum(v) !== null) >= 0.8);
    const catCol = head.findIndex((h, i) => i !== dateCol && !numCols.includes(i) && new Set(body.map(r => (r[i] || '').trim())).size <= 12);
    if (!numCols.length) return { err: 'I could not find a numeric column in **' + name + '**. I need at least one column of numbers to chart.' };
    if (dateCol < 0 && catCol < 0) return { err: 'I could not find a date column or a category column in **' + name + '**, so I do not know how to line it up with your pickups.' };
    const data = body.map(r => ({ d: dateCol >= 0 ? toDate(r[dateCol]) : null, c: catCol >= 0 ? (r[catCol] || '').trim() : '', n: Object.fromEntries(numCols.map(i => [head[i], toNum(r[i])])) }))
      .filter(r => dateCol < 0 || r.d);
    const dates = data.map(r => r.d).filter(Boolean).sort();
    const ds = { id: 'u' + (st.seq++), name, rows: data.slice(0, 3000), fields: numCols.map(i => head[i]), dateName: dateCol >= 0 ? head[dateCol] : '', catName: catCol >= 0 ? head[catCol] : '',
      cats: catCol >= 0 ? [...new Set(data.map(r => r.c).filter(Boolean))] : [], from: dates[0] || '', to: dates[dates.length - 1] || '', total: body.length, cols };
    st.uploads.push(ds); if (st.uploads.length > 4) st.uploads.shift();
    return { ds };
  }
  const aggFor = f => /rate|avg|average|temp|price|index|ratio|percent|%|score|per /i.test(f) ? 'avg' : 'sum';
  function aggRows(rows, field, agg) {
    const v = rows.map(r => r.n[field]).filter(x => x != null);
    if (!v.length) return null;
    return agg === 'avg' ? v.reduce((a, b) => a + b, 0) / v.length : v.reduce((a, b) => a + b, 0);
  }
  function sampleCsv() {
    const rng = mulberry32(777), out = ['date,location,sales_eur,visitors'];
    for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
      const d = addDays(Model.today, -i), f = [1.25, 0.8, 0.85, 0.9, 1.0, 1.3, 1.45][d.getDay()];
      [['AMS', 14000, 900], ['UTR', 9000, 620]].forEach(([c, s, v]) => out.push([iso(d), c, Math.round(s * f * (0.9 + rng() * 0.2)), Math.round(v * f * (0.9 + rng() * 0.2))].join(',')));
    }
    return out.join('\n');
  }

  /* ================= chart model: measures, dimensions, data ================= */
  const METRICS = {
    weight:     { label: 'Weight (kg)', f: rs => sumBy(rs, r => r.weight), fmt: v => num(v) + ' kg', tick: v => num(v) },
    pickups:    { int: true, label: 'Scheduled pickups', f: rs => rs.length, fmt: v => num(v), tick: v => num(v) },
    missed:     { int: true, label: 'Missed pickups', f: rs => sumBy(rs, r => r.missed), fmt: v => (Math.round(v * 10) / 10) + '', tick: v => num(v) },
    missrate:   { label: 'Missed-pickup rate', pct: true, f: rs => rs.length ? sumBy(rs, r => r.missed) / rs.length : null, fmt: v => pct(v), tick: v => pct(v) },
    separation: { label: 'Source separation rate', pct: true, f: rs => { const t = sumBy(rs, r => r.weight); return t ? 1 - sumBy(rs.filter(r => r.stream === 'residual'), r => r.weight) / t : null; }, fmt: v => pct(v), tick: v => pct(v) },
    resource:   { label: 'Resource saved rate', pct: true, f: rs => { const t = sumBy(rs, r => r.weight); return t ? sumBy(rs, r => r.rec) / t : null; }, fmt: v => pct(v), tick: v => pct(v) },
    co2:        { label: 'CO₂ saved (kg)', f: rs => sumBy(rs, r => r.co2), fmt: v => num(v) + ' kg CO₂', tick: v => num(v) },
    cost:       { label: 'Pickup cost (€)', f: rs => rs.length * ASSUMPTIONS.pickupCost, fmt: v => '€' + num(v), tick: v => '€' + num(v) },
    avgweight:  { label: 'Average weight per pickup (kg)', f: rs => { const p = rs.filter(r => r.picked); return p.length ? sumBy(p, r => r.weight) / p.length : null; }, fmt: v => num(v) + ' kg', tick: v => num(v) }
  };
  const DIM_PHRASE = { time: 'over time', location: 'by location', locType: 'by location type', stream: 'by waste stream', weekday: 'by weekday', month: 'by month', reason: 'by reason' };
  const DIM_NOUN = { time: 'time', location: 'location', locType: 'location type', stream: 'waste stream', weekday: 'weekday', month: 'month', reason: 'reason' };

  function periodOf(spec) {
    const r = spec.weeks ? { from: iso(addDays(Model.today, -(spec.weeks * 7 - 1))), to: iso(Model.today) } : baseRange();
    return Model.buckets(r.from, r.to);
  }
  function localBuckets(from, to) {                       // like Model.buckets, but without the 12-week clamp (for uploaded files)
    const e = parseIso(to), s = parseIso(from), n = Math.round((e - s) / 864e5) + 1, list = [];
    const dm = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    if (n <= 14) for (let i = 0; i < n; i++) { const d = addDays(s, i); list.push({ a: iso(d), b: iso(d), label: dm(d), range: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) }); }
    else { const cnt = Math.ceil(n / 7); for (let k = 0; k < cnt; k++) { const b = addDays(e, -7 * (cnt - 1 - k)); let a = addDays(b, -6); if (a < s) a = s; list.push({ a: iso(a), b: iso(b), label: dm(a), range: dm(a) + ' – ' + dm(b) }); } }
    return { list, s: from, e: to, daily: n <= 14 };
  }
  function rowsOf(spec, bk) {
    const sim = Model.scenario !== 'normal';
    return Model.events().filter(e => e.date >= bk.s && e.date <= bk.e).map(e => {
      const c = Model.cont(e.cid), L = Model.loc(e.loc), S = STREAMS[c.stream], w = e.picked ? e.weight : 0;
      return { date: e.date, wd: e.weekday, loc: L.id, locType: L.type, stream: c.stream, picked: e.picked ? 1 : 0, weight: w,
        missed: e.picked ? (sim ? Model.missRate(e.loc, e.weekday).rate : 0) : 1, reason: e.reason || '', co2: w * S.co2PerKg, rec: w * (S.recovery || 0) };
    }).filter(r => (!(spec.locs || []).length || spec.locs.includes(r.loc)) && (!(spec.locTypes || []).length || spec.locTypes.includes(r.locType)) &&
      (!(spec.streams || []).length || spec.streams.includes(r.stream)));
  }
  function catsOf(dim, bk, spec) {
    let out = [];
    if (dim === 'time') out = bk.list.map(b => ({ label: b.label, tip: b.range, a: b.a, b: b.b, test: r => r.date >= b.a && r.date <= b.b }));
    else if (dim === 'month') {
      let d = parseIso(bk.s); d = new Date(d.getFullYear(), d.getMonth(), 1); const e = parseIso(bk.e);
      for (; d <= e; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        const key = iso(d).slice(0, 7), last = iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
        out.push({ label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), tip: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
          a: iso(d) < bk.s ? bk.s : iso(d), b: last > bk.e ? bk.e : last, test: r => r.date.slice(0, 7) === key });
      }
    }
    else if (dim === 'location') out = LOCATIONS.filter(l => !(spec.locs || []).length || spec.locs.includes(l.id)).map(l => ({ label: l.code, tip: l.name, color: LOC_COL[l.id], test: r => r.loc === l.id }));
    else if (dim === 'locType') out = [...new Set(LOCATIONS.map(l => l.type))].filter(t => !(spec.locTypes || []).length || spec.locTypes.includes(t)).map((t, i) => ({ label: t, tip: t, color: PAL[i], test: r => r.locType === t }));
    else if (dim === 'stream') out = Object.keys(STREAMS).filter(k => !(spec.streams || []).length || spec.streams.includes(k)).map(k => ({ label: STREAM_SHORT[k], tip: STREAMS[k].label, color: STREAMS[k].color, test: r => r.stream === k }));
    else if (dim === 'weekday') out = [1, 2, 3, 4, 5, 6, 0].map(d => ({ label: WD[d], tip: FULLDAY[d], test: r => r.wd === d }));
    else if (dim === 'reason') out = MISS_REASONS.map((m, i) => ({ label: m, tip: m, color: PAL[i], test: r => r.reason === m }));
    return out;
  }
  function overlayVals(ov, cats) {                        // outside data or an uploaded column, aggregated into the same buckets as the chart
    if (!ov || !cats[0] || !cats[0].a) return null;
    if (ov.src === 'upload') {
      const ds = st.uploads.find(u => u.id === ov.id); if (!ds) return null;
      return cats.map(c => aggRows(ds.rows.filter(r => r.d && r.d >= c.a && r.d <= c.b), ov.field, ov.agg));
    }
    const X = EXT[ov.src];
    return cats.map(c => {
      const v = []; for (let d = parseIso(c.a); iso(d) <= c.b; d = addDays(d, 1)) v.push(X.value(d));
      return v.length ? (X.agg === 'sum' ? v.reduce((a, b) => a + b, 0) : v.reduce((a, b) => a + b, 0) / v.length) : null;
    });
  }
  function overlayInfo(ov) {
    if (!ov) return null;
    if (ov.src === 'upload') { const ds = st.uploads.find(u => u.id === ov.id); return { name: pretty(ov.field), short: pretty(ov.field).toLowerCase(), color: '#8E6BBF', fmt: fmtNum, from: ds ? ds.name : '' }; }
    const X = EXT[ov.src]; return { name: X.label, short: X.short, color: X.color, fmt: X.fmt };
  }
  function pickType(spec, M, C, S) {
    let t = spec.type;
    if (t === 'donut' && (S || C.length > 8 || spec.dim === 'time' || spec.dim === 'month' || spec.overlay || M.pct)) t = null;
    if (!t) t = spec.dim === 'time' ? (M.pct ? 'line' : 'bar') : 'bar';
    if (t === 'line' && spec.dim !== 'time' && spec.dim !== 'month' && spec.dim !== 'weekday') t = 'bar';
    if (S && t === 'bar') t = M.pct ? 'grouped' : 'stacked';
    if (S && t === 'stacked' && M.pct) t = 'grouped';
    return t;
  }

  /* one result object per chart: everything needed to draw it, caption it and explain it */
  function compute(spec) {
    if (spec.src === 'upload') return computeUpload(spec);
    const bk = periodOf(spec), M = METRICS[spec.metric] || METRICS.weight;
    let rs = rowsOf(spec, bk);
    if (spec.dim === 'reason' || spec.series === 'reason') rs = rs.filter(r => r.reason);
    let C = catsOf(spec.dim, bk, spec);
    const S = spec.series && spec.series !== spec.dim ? catsOf(spec.series, bk, spec) : null;
    const lines = (S || [{ label: M.label, tip: M.label, color: null }]);
    const series = lines.map((s, i) => ({ name: s.tip || s.label, color: s.color || (S ? PAL[i % PAL.length] : COL.teal),
      vals: C.map(c => { const sub = rs.filter(r => c.test(r) && (!S || s.test(r))); return sub.length ? M.f(sub) : (M.pct ? null : 0); }) }));
    if (spec.dim === 'reason') { const keep = C.map((c, i) => series.some(s => s.vals[i])); C = C.filter((c, i) => keep[i]); series.forEach(s => { s.vals = s.vals.filter((v, i) => keep[i]); }); }
    const type = pickType(spec, M, C, S);
    const ov = overlayInfo(spec.overlay), ovv = ov ? overlayVals(spec.overlay, C) : null;
    const res = { spec, bk, M, cats: C, series, type, ov, ovv, single: !S, perCatColor: !S && C.some(c => c.color) };
    res.title = titleOf(spec, M, ov); res.caption = captionOf(spec, bk, ov); res.noOverlap = !!ov && (!ovv || ovv.every(v => v == null));
    return res;
  }
  function computeUpload(spec) {
    const ds = st.uploads.find(u => u.id === spec.up.id);
    if (!ds) return { spec, cats: [], series: [], M: { label: spec.up.field }, title: spec.up.field, caption: 'The uploaded file is no longer available.', type: 'bar', missing: true };
    const f = spec.up.field, agg = spec.up.agg || aggFor(f), M = { label: pretty(f), fmt: fmtNum, tick: fmtNum };
    let cats, series;
    if (spec.up.by === 'cat') {
      cats = ds.cats.map(c => ({ label: c, tip: c, key: c }));
      series = [{ name: pretty(f), color: COL.teal, vals: cats.map(c => aggRows(ds.rows.filter(r => r.c === c.key), f, agg)) }];
    } else {
      const bk = localBuckets(ds.from, ds.to);
      cats = bk.list.map(b => ({ label: b.label, tip: b.range, a: b.a, b: b.b }));
      const groups = spec.up.split && ds.cats.length ? ds.cats.slice(0, 6) : [null];
      series = groups.map((g, i) => ({ name: g || pretty(f), color: g ? PAL[i % PAL.length] : COL.teal,
        vals: cats.map(c => aggRows(ds.rows.filter(r => r.d >= c.a && r.d <= c.b && (!g || r.c === g)), f, agg)) }));
    }
    const type = spec.type === 'donut' && spec.up.by === 'cat' ? 'donut' : spec.type === 'line' || (!spec.type && spec.up.by !== 'cat') ? 'line' : (series.length > 1 ? 'grouped' : 'bar');
    const title = pretty(f) + (spec.up.by === 'cat' ? ' by ' + (ds.catName || 'category').toLowerCase() : ' over time') + (agg === 'avg' ? ' (average)' : ' (total)');
    return { spec, cats, series, M, type, single: series.length === 1, perCatColor: false, title,
      caption: 'From your file ' + ds.name + (ds.from ? ' · ' + dShortLocal(ds.from) + ' – ' + dShortLocal(ds.to) : '') + ' · Your data' };
  }
  function titleOf(spec, M, ov) {
    let t = M.label.replace(/ \((kg|€)\)$/, '') + ' ';
    const sr = spec.series && spec.series !== spec.dim ? spec.series : null;
    if (sr && spec.dim === 'time') t += 'by ' + DIM_NOUN[sr] + ' over time';
    else { t += spec.dim === 'time' && ov ? 'over time' : DIM_PHRASE[spec.dim]; if (sr) t += ' and ' + DIM_NOUN[sr]; }
    if (ov) t += ' vs ' + ov.short;
    return cap(t);
  }
  function captionOf(spec, bk, ov) {
    const bits = [dShortLocal(bk.s) + ' – ' + dShortLocal(bk.e)];
    if ((spec.locs || []).length) bits.push(spec.locs.map(id => Model.loc(id).code).join(', '));
    if ((spec.locTypes || []).length) bits.push(spec.locTypes.join(', '));
    if ((spec.streams || []).length) bits.push(spec.streams.map(k => STREAMS[k].label).join(', '));
    bits.push(Model.scenario !== 'normal' ? 'Simulated: ' + SCENARIOS[Model.scenario].label : 'Seenons demo data');
    if (ov) bits.push(spec.overlay.src === 'upload' ? 'Plus your file ' + ov.from : 'Plus outside data (simulated): ' + cap(ov.short));
    return bits.join(' · ');
  }

  /* ================= drawing (SVG, same look as the Report charts) ================= */
  function wrapLabel(x, y, text) {
    if (text.length <= 12) return '<text x="' + x + '" y="' + y + '" text-anchor="middle">' + esc(text) + '</text>';
    const w = text.split(' '); let best = 1, bd = 99;
    for (let i = 1; i < w.length; i++) { const d = Math.abs(w.slice(0, i).join(' ').length - w.slice(i).join(' ').length); if (d < bd) { bd = d; best = i; } }
    const a = w.slice(0, best).join(' '), b = w.slice(best).join(' ');
    return '<text text-anchor="middle"><tspan x="' + x + '" y="' + y + '">' + esc(a) + '</tspan>' + (b ? '<tspan x="' + x + '" y="' + (y + 12) + '">' + esc(b) + '</tspan>' : '') + '</text>';
  }
  const tt = html => ' data-tt="' + esc(html) + '"';

  function drawDonut(res) {
    const vals = res.series[0].vals.map(v => v || 0), tot = vals.reduce((a, b) => a + b, 0);
    if (!tot) return '<p class="small">No data for this selection.</p>';
    const W = 520, H = 230, cx = 130, cy = 115, R = 95, r = 56;
    let a0 = -Math.PI / 2, s = '';
    const pt = (rad, a) => (cx + rad * Math.cos(a)).toFixed(1) + ' ' + (cy + rad * Math.sin(a)).toFixed(1);
    res.cats.forEach((c, i) => {
      const v = vals[i]; if (!v) return;
      const col = c.color || PAL[i % PAL.length], a1 = a0 + v / tot * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0;
      const tip = '<b>' + c.tip + '</b><br>' + res.M.fmt(v) + ' (' + Math.round(v / tot * 100) + '%)';
      if (v / tot > 0.999) s += '<circle class="seg"' + tt(tip) + ' cx="' + cx + '" cy="' + cy + '" r="' + (R + r) / 2 + '" fill="none" stroke="' + col + '" stroke-width="' + (R - r) + '"/>';
      else s += '<path class="seg"' + tt(tip) + ' d="M' + pt(R, a0) + ' A' + R + ' ' + R + ' 0 ' + big + ' 1 ' + pt(R, a1) + ' L' + pt(r, a1) + ' A' + r + ' ' + r + ' 0 ' + big + ' 0 ' + pt(r, a0) + ' Z" fill="' + col + '" stroke="#fff" stroke-width="1.5"/>';
      a0 = a1;
    });
    s += '<text x="' + cx + '" y="' + (cy + 2) + '" text-anchor="middle" style="font-size:14px;font-weight:600;fill:var(--ink)">' + esc(res.M.fmt(tot)) + '</text><text x="' + cx + '" y="' + (cy + 18) + '" text-anchor="middle">Total</text>';
    res.cats.forEach((c, i) => {
      const y = 30 + i * 24, col = c.color || PAL[i % PAL.length];
      s += '<rect x="290" y="' + (y - 10) + '" width="12" height="12" rx="3" fill="' + col + '"/><text x="310" y="' + y + '" style="fill:var(--ink)">' + esc(c.tip) + '</text><text x="' + (W - 10) + '" y="' + y + '" text-anchor="end">' + Math.round((vals[i] || 0) / tot * 100) + '%</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + Math.max(H, 40 + res.cats.length * 24) + '" width="100%" role="img" aria-label="' + esc(res.title) + '">' + s + '</svg>';
  }

  function drawXY(res) {
    const { cats, series, type, M, ov, ovv } = res, n = cats.length;
    if (!n || series.every(s => s.vals.every(v => v == null))) return '<p class="small">No data for this selection.</p>';
    const long = cats.some(c => c.label.length > 12), W = 520, H = long ? 262 : 244, L = 50, R = ov ? 50 : 10, T = 12, B = long ? 46 : 30, pw = W - L - R, ph = H - T - B;
    const stacked = type === 'stacked', line = type === 'line', k = series.length;
    let max = 0;
    cats.forEach((c, i) => { if (stacked) max = Math.max(max, sumBy(series, s => s.vals[i] || 0)); else series.forEach(s => { max = Math.max(max, s.vals[i] || 0); }); });
    const intMax = v => { const st = [1, 2, 5, 10, 20, 50].find(x => x * 4 >= v); return st ? st * 4 : niceMax(v); };   // whole-number ticks for counts
    const ymax = M.pct ? Math.max(0.1, Math.ceil(max / 0.1 - 1e-9) * 0.1) : (M.int ? intMax(Math.max(max, 1)) : niceMax(Math.max(max, 1))), y = v => T + (1 - v / ymax) * ph;
    const band = pw / n, cx = i => L + band * (i + 0.5);
    let s = '';
    for (let t = 0; t <= 4; t++) { const v = ymax * t / 4; s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="' + COL.grid + '"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + esc(M.tick ? M.tick(v) : num(v)) + '</text>'; }
    const step = n > 8 ? Math.ceil(n / 7) : 1;
    cats.forEach((c, i) => { if ((n - 1 - i) % step === 0) s += wrapLabel(cx(i).toFixed(1), H - (long ? 30 : 10), c.label); });
    const ovLine = (i) => (ov && ovv && ovv[i] != null) ? '<br>' + esc(ov.short.charAt(0).toUpperCase() + ov.short.slice(1)) + ': <b>' + esc(ov.fmt(ovv[i])) + '</b>' : '';
    const bar = (x, w, v0, v1, col, tip) => '<rect class="seg"' + tt(tip) + ' x="' + x.toFixed(1) + '" y="' + y(v1).toFixed(1) + '" width="' + Math.max(1, w).toFixed(1) + '" height="' + Math.max(0, y(v0) - y(v1)).toFixed(1) + '" fill="' + col + '"/>';
    if (!line) {
      cats.forEach((c, i) => {
        if (stacked) {
          const tot = sumBy(series, q => q.vals[i] || 0), bw = band * 0.7; let cum = 0;
          series.forEach(q => { const v = q.vals[i] || 0; if (!v) return; s += bar(cx(i) - bw / 2, bw, cum, cum + v, q.color, '<b>' + c.tip + '</b><br>' + q.name + ': <b>' + M.fmt(v) + '</b><br>Total: ' + M.fmt(tot) + ovLine(i)); cum += v; });
        } else {
          const gw = band * 0.74, bw = gw / k;
          series.forEach((q, j) => { const v = q.vals[i]; if (v == null) return; const col = res.perCatColor && c.color ? c.color : q.color;
            s += bar(cx(i) - gw / 2 + j * bw + (k > 1 ? 1 : 0), bw - (k > 1 ? 2 : 0), 0, v, col, '<b>' + c.tip + '</b><br>' + (k > 1 ? q.name + ': ' : '') + '<b>' + M.fmt(v) + '</b>' + ovLine(i)); });
        }
      });
    } else {
      series.forEach(q => {
        let d = '', pen = false, dots = '';
        q.vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + cx(i).toFixed(1) + ' ' + y(v).toFixed(1) + ' '; pen = true;
          dots += '<circle cx="' + cx(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="3" fill="' + q.color + '" style="pointer-events:none"/>'; });
        s += '<path d="' + d + '" fill="none" stroke="' + q.color + '" stroke-width="2.5" style="pointer-events:none"/>' + dots;
      });
      cats.forEach((c, i) => {
        const rows = series.map(q => (k > 1 ? q.name + ': ' : '') + '<b>' + (q.vals[i] == null ? 'no data' : M.fmt(q.vals[i])) + '</b>').join('<br>');
        s += '<rect class="hit"' + tt('<b>' + c.tip + '</b><br>' + rows + ovLine(i)) + ' x="' + (L + i * band).toFixed(1) + '" y="' + T + '" width="' + band.toFixed(1) + '" height="' + ph + '"/>';
      });
    }
    if (ov && ovv && ovv.some(v => v != null)) {                      // second axis (right): outside data or an uploaded column
      const vs = ovv.filter(v => v != null), lo = Math.min(0, Math.floor(Math.min(...vs))), hi = niceMax(Math.max(Math.max(...vs), 1)), y2 = v => T + (1 - (v - lo) / (hi - lo || 1)) * ph;
      for (let t = 0; t <= 4; t++) { const v = lo + (hi - lo) * t / 4; s += '<text x="' + (W - R + 6) + '" y="' + (y(ymax * t / 4) + 4) + '" style="fill:' + ov.color + '">' + esc(fmtNum(v)) + '</text>'; }
      let d = '', pen = false, dots = '';
      ovv.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + cx(i).toFixed(1) + ' ' + y2(v).toFixed(1) + ' '; pen = true;
        dots += '<circle cx="' + cx(i).toFixed(1) + '" cy="' + y2(v).toFixed(1) + '" r="3.5" fill="#fff" stroke="' + ov.color + '" stroke-width="2"' + tt('<b>' + cats[i].tip + '</b><br>' + esc(cap(ov.short)) + ': <b>' + esc(ov.fmt(v)) + '</b>') + '/>'; });
      s += '<path d="' + d + '" fill="none" stroke="' + ov.color + '" stroke-width="2.5" stroke-dasharray="6 4" style="pointer-events:none"/>' + dots;
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(res.title) + '">' + s + '</svg>';
  }
  function legendFor(res) {
    const items = [];
    if (res.series && (res.series.length > 1)) res.series.forEach(q => items.push([q.color, q.name]));
    else if (res.series && res.series.length === 1 && !res.perCatColor && res.type !== 'donut' && res.ov) items.push([res.series[0].color, res.series[0].name]);
    if (res.ov) items.push([res.ov.color, res.ov.name + ' (right axis)']);
    return items.length ? legendOf(items) : '';
  }
  function chartBody(res) {
    if (res.missing) return '<p class="small">Upload the file again to redraw this chart.</p>';
    return (res.type === 'donut' ? drawDonut(res) : drawXY(res)) + legendFor(res);
  }

  /* what the chart says, in a sentence or two */
  function insightOf(res) {
    if (!res.series || !res.series.length || res.missing) return '';
    const tot = res.series.length === 1 ? res.series[0].vals : res.cats.map((c, i) => sumBy(res.series, q => q.vals[i] || 0));
    const out = [], fmt = res.M.fmt || fmtNum, ok = tot.filter(v => v != null);
    if (res.cats.length && res.cats[0].a === undefined && res.series.length === 1 && ok.length > 1) {
      let bi = 0; tot.forEach((v, i) => { if ((v || 0) > (tot[bi] || 0)) bi = i; });
      const sum = sumBy(ok, v => v);
      out.push('Highest: **' + res.cats[bi].tip + '** (' + fmt(tot[bi]) + (!res.M.pct && sum ? ', ' + Math.round(tot[bi] / sum * 100) + '% of the total' : '') + ').');
    } else if (ok.length >= 8 && !res.M.pct) {
      const n = Math.min(4, Math.floor(tot.length / 2)), a = sumBy(tot.slice(-n), v => v || 0), b = sumBy(tot.slice(-2 * n, -n), v => v || 0);
      if (b) out.push('The last ' + n + ' periods are **' + (a >= b ? '+' : '−') + Math.abs(Math.round((a / b - 1) * 100)) + '%** against the ' + n + ' before.');
    }
    if (res.ov && res.ovv) {
      const pairs = tot.map((v, i) => [v, res.ovv[i]]).filter(p => p[0] != null && p[1] != null);
      if (pairs.length >= 5) {
        const mx = sumBy(pairs, p => p[0]) / pairs.length, my = sumBy(pairs, p => p[1]) / pairs.length;
        const sxy = sumBy(pairs, p => (p[0] - mx) * (p[1] - my)), sxx = sumBy(pairs, p => (p[0] - mx) ** 2), syy = sumBy(pairs, p => (p[1] - my) ** 2);
        if (sxx > 0 && syy > 0) {
          const r = sxy / Math.sqrt(sxx * syy), a = Math.abs(r), word = a < 0.2 ? 'very weak' : a < 0.4 ? 'weak' : a < 0.6 ? 'moderate' : a < 0.8 ? 'strong' : 'very strong';
          out.push('Across these periods the two ' + (a < 0.2 ? 'show **no clear link**' : (r > 0 ? 'tend to **rise together**' : 'tend to **move in opposite directions**')) + ' (correlation ' + r.toFixed(2) + ', ' + word + '). That is a hint, not proof of cause.');
        }
      }
    }
    return out.join(' ');
  }

  /* ================= understanding a request ================= */
  const MET_RX = [
    ['separation', /\bseparat\w*/], ['resource', /\b(resource saved|recycl\w*|recovery|recovered)\b/],
    ['co2', /\bco2\b|co₂|\bcarbon\b|\bemissions?\b/], ['cost', /\b(costs?|spend\w*|euros?|expens\w*|price|budget)\b|€/],
    ['avgweight', /\b(average|avg|mean|typical)\b.*\b(weight|kg|pickup)\b|\bper pickup\b/],
    ['pickups', /\b(pickups?|orders?|collections?|trips?|stops?)\b/], ['weight', /\b(weight|kg|kilos?|tonn?es?|waste|volume|amount|garbage|trash|rubbish)\b/]
  ];
  const DIM_RX = [
    ['locType', /\b(?:by|per|across|between|each)\s+(?:the\s+)?(?:location|site|business|branch)\s+(?:type|sector|category)s?\b|\bby sector\b|\b(?:retail|offices?)\s+(?:vs\.?|versus|against)\s+(?:retail|offices?|hospitality|food)/],
    ['location', /\b(?:by|per|across|between|each|compare|comparing|comparison of)\s+(?:the\s+)?(?:all\s+)?(?:locations?|sites?|stores?|shops?|branches|offices)\b|\bwhich\s+(?:location|site|store)\b/],
    ['stream', /\b(?:by|per|across|between|each|split by|broken down by)\s+(?:the\s+)?(?:waste\s+)?(?:streams?|types?|materials?|fractions?|categories|category)\b|\bwaste (?:stream|type|mix)s?\b|\bwhich (?:stream|waste|material)\b/],
    ['weekday', /\b(?:by|per|across|each|which)\s+(?:the\s+)?(?:weekday|day of (?:the )?week|days? of (?:the )?week)s?\b|\bweekdays?\b|\bwhich days?\b/],
    ['month', /\b(?:by|per|each)\s+month\b|\bmonthly\b/],
    ['reason', /\b(?:by|per)\s+(?:the\s+)?(?:reason|cause)s?\b|\bwhy\b.*\bmiss|\breasons?\b/],
    ['time', /\b(?:over time|trends?|trending|weekly|per week|by week|each week|week by week|daily|per day|each day|timeline|history|evolution|progress|over the (?:last|past)|vs\.? time)\b/]
  ];
  const LOOSE = { location: /\b(locations?|sites?|stores?|branches)\b/, stream: /\b(streams?|materials?|fractions?|waste types?)\b/, locType: /\b(sector|location types?)\b/, weekday: /\bweekdays?\b/ };
  const LOC_WORDS = { l1: ['ams', 'amsterdam', 'centrum'], l2: ['utr', 'utrecht'], l3: ['rtm', 'rotterdam', 'head office'], l4: ['sch', 'schiphol', 'kiosk', 'café', 'cafe'] };
  const TYPE_WORDS = { 'Retail': /\b(retail|shops?)\b/, 'Office': /\boffices?\b/, 'Food & Beverage': /\b(f&b|hospitality|food (?:and|&) beverage)\b/ };
  const STREAM_WORDS = { residual: /\b(residual|general waste|mixed waste)\b/, paper: /\b(paper|cardboard)\b/, glass: /\bglass\b/, organic: /\b(organic|food waste|gft|compost)\b/, pmd: /\b(plastics?|pmd|cans)\b/ };
  const OV_RX = [['temp', /\b(temperature|weather|warm\w*|hot|heat\w*|cold\w*|degrees|sunny)\b/], ['rain', /\b(rain\w*|precipitation|wet|showers?|drizzle)\b/],
    ['foot', /\b(footfall|foot traffic|visitors?|passengers?|tourists?|tourism|crowds?|busy|busyness)\b/]];

  function parse(t) {
    const p = { locs: [], locTypes: [], streams: [] };
    for (const [k, rx] of MET_RX) if (rx.test(t)) { p.metric = k; break; }
    if (/\bmiss/.test(t)) p.metric = /\b(how many|number of|count|total)\b/.test(t) ? 'missed' : 'missrate';
    let hits = DIM_RX.map(([k, rx]) => { const m = rx.exec(t); return m ? { k, i: m.index } : null; }).filter(Boolean).sort((a, b) => a.i - b.i);
    hits = hits.filter((h, i) => !hits.some((o, j) => j !== i && o.i === h.i && o.k === 'locType' && h.k !== 'locType'));
    p.dims = hits.map(h => h.k).filter((k, i, a) => a.indexOf(k) === i);
    if (p.dims.length === 1 && /\b(and|split|stack\w*|break\w*|group\w*|colou?r\w*)\b/.test(t)) {
      const extra = Object.entries(LOOSE).find(([k, rx]) => k !== p.dims[0] && rx.test(t));
      if (extra) p.dims.push(extra[0]);
    }
    for (const [id, words] of Object.entries(LOC_WORDS)) if (words.some(w => new RegExp('\\b' + w + '\\b').test(t))) p.locs.push(id);
    for (const [ty, rx] of Object.entries(TYPE_WORDS)) if (rx.test(t) && !(ty === 'Office' && /head office/.test(t))) p.locTypes.push(ty);
    for (const [k, rx] of Object.entries(STREAM_WORDS)) if (rx.test(t) && !(k === 'residual' && p.metric === 'separation')) p.streams.push(k);
    if (!p.dims.length && p.locTypes.length > 1) p.dims = ['locType'];
    let m;
    if ((m = /\b(?:last|past|previous)\s+(\d+)\s*(day|week|month)s?\b/.exec(t))) p.weeks = Math.max(1, Math.min(12, Math.ceil(+m[1] * ({ day: 1 / 7, week: 1, month: 4.3 })[m[2]])));
    else if (/\blast month\b/.test(t)) p.weeks = 4; else if (/\b(this|last) week\b/.test(t)) p.weeks = 1;
    if (/\b(donut|doughnut|pie|share of|proportion|percentage split|makeup|composition of)\b/.test(t)) p.type = 'donut';
    else if (/\bline\b/.test(t)) p.type = 'line'; else if (/\bstack\w*\b/.test(t)) p.type = 'stacked';
    else if (/\b(grouped|side by side|clustered)\b/.test(t)) p.type = 'grouped'; else if (/\b(bar|column|histogram)s?\b/.test(t)) p.type = 'bar';
    for (const [k, rx] of OV_RX) if (rx.test(t)) { p.ov = k; if (k === 'rain') break; }
    if (/\brain/.test(t)) p.ov = 'rain';
    p.upload = /\b(my|the|this|that|uploaded|attached)\s+(?:own\s+)?(?:file|csv|data|dataset|spreadsheet|upload)\b|\buploaded\b|\.csv\b|\bsample file\b/.test(t);
    p.verb = /\b(chart|graph|plot|visuali[sz]\w*|diagram|show|compare|comparison|breakdown|break down|versus|vs\.?|against|correlat\w*|relationship|affect\w*|impact\w*|influence\w*|insights?|analy[sz]\w*)\b/.test(t);
    p.howmuch = /\bhow (much|many)\b/.test(t);
    return p;
  }
  const FOLLOW_RX = /^(?:and |also |now |then |but |instead|only |just |make (?:it|that|this)|can you make|turn (?:it|that|this)|change (?:it|that|this)|switch (?:it|that|this)|split (?:it|that|this)|break (?:it|that|this)|show (?:it|that|this)? ?as|show it |compare (?:it )?(?:with|to|against)|add (?:the |a )?(?:temperature|weather|rain|footfall|my file)|use a|in a )|\b(that chart|this chart|the chart|same chart|the last chart)\b/;

  function pickUpload(t) {
    if (!st.uploads.length) return null;
    const ds = st.uploads.find(u => t.includes(u.name.toLowerCase().replace(/\.[a-z]+$/, ''))) || st.uploads[st.uploads.length - 1];
    const field = ds.fields.find(f => t.includes(f.toLowerCase().replace(/_/g, ' ')) || t.includes(f.toLowerCase())) || ds.fields[0];
    return { ds, field };
  }
  function buildSpec(p, t, base) {
    const spec = Object.assign({ metric: 'weight', dim: 'time', series: null, type: null, locs: [], locTypes: [], streams: [], weeks: null, overlay: null }, base || {});
    const refine = !!base;
    if (p.metric) spec.metric = p.metric;
    if (p.dims.length) {
      const split = /\b(split|stack\w*|break\w*|group\w*|colou?r\w*)\b/.test(t) && refine;
      if (split) spec.series = p.dims[0] === spec.dim ? null : p.dims[0];
      else { spec.dim = p.dims[0]; spec.series = p.dims[1] && p.dims[1] !== p.dims[0] ? p.dims[1] : (refine && spec.series === spec.dim ? null : spec.series); }
    }
    if (spec.series === spec.dim) spec.series = null;
    if (p.type) spec.type = p.type;
    if (refine && p.type === 'line' && !p.dims.length && !['time', 'month', 'weekday'].includes(spec.dim)) { spec.series = spec.series || spec.dim; spec.dim = 'time'; }
    if (p.locs.length) spec.locs = p.locs; if (p.locTypes.length) spec.locTypes = p.locTypes; if (p.streams.length) spec.streams = p.streams;
    if (p.weeks) spec.weeks = p.weeks;
    if (spec.dim === 'reason' || (p.dims.length && /reason/.test(t))) spec.metric = /\b(how many|number|count|total)\b/.test(t) ? 'missed' : (spec.metric === 'missrate' ? 'missed' : spec.metric);
    if (spec.dim === 'reason' && !['missed'].includes(spec.metric)) spec.metric = 'missed';
    if (p.ov) { spec.overlay = { src: p.ov }; if (!['time', 'month'].includes(spec.dim)) { spec.dim = 'time'; spec.series = null; } if (spec.type === 'donut') spec.type = null; }
    if (p.upload && st.uploads.length && !p.ov) {
      const u = pickUpload(t);
      if (u && (p.metric || refine)) { spec.overlay = { src: 'upload', id: u.ds.id, field: u.field, agg: aggFor(u.field) }; if (!['time', 'month'].includes(spec.dim)) { spec.dim = 'time'; spec.series = null; } }
    }
    if (spec.type === 'line' && spec.series && !METRICS[spec.metric].pct) spec.type = 'line';
    return spec;
  }

  /* ================= replies ================= */
  const bot = (text, more) => Object.assign({ role: 'bot', text }, more || {});
  const qr = (label, say, act) => ({ label, say, act });
  const EXAMPLES = ['Weight by location and waste stream', 'Missed-pickup rate by weekday', 'CO₂ saved per week, last 8 weeks', 'Compare weight with temperature', 'Pickup cost by location'];
  const HELP_QR = () => [qr('Frequently asked questions', 'Show me frequently asked questions'), qr('Build a chart', 'Help me build a chart'), qr('Add outside data', 'I want to add outside data')];

  function followUps(c) {
    const out = [], M = METRICS[c.metric];
    if (c.src === 'upload') return [qr('Compare it with my waste weight', 'Compare my file with waste weight over time')];
    if (c.dim === 'time' && !c.series) out.push(qr('Split by waste stream', 'Split it by waste stream'));
    if (c.dim !== 'time') out.push(qr('Show it over time', 'Show it over time'));
    if (c.dim === 'time' && !c.overlay && !(M && M.pct)) out.push(qr('Compare with temperature', 'Compare it with temperature'));
    if (c.dim !== 'time' && !c.series && M && !M.pct && c.type !== 'donut') out.push(qr('Show as a donut', 'Show it as a donut'));
    if (!(c.locs || []).length) out.push(qr('Only Amsterdam', 'Only Amsterdam'));
    return out.slice(0, 3);
  }
  function chartReply(spec, replaceId, assumed) {
    let id = replaceId;
    const c = Object.assign({ id: id || 'cc' + (st.seq++) }, spec);
    if (id) st.charts = st.charts.map(x => x.id === id ? c : x); else st.charts.push(c);
    st.last = c.id;
    const res = compute(c), tip = insightOf(res);
    let text = (replaceId ? 'Updated — **' : 'Done — I added **') + res.title + '** ' + (replaceId ? 'on' : 'to') + ' your Report page.';
    if (assumed) text += '\n' + assumed;
    if (tip) text += '\n' + tip;
    if (res.noOverlap) text += '\nHeads up: the dates in your file do not overlap with the period shown, so the second line is empty.';
    const acts = [qr('View on Report', '', 'view:' + c.id), ...followUps(c), qr('Remove it', '', 'rm:' + c.id)];
    refresh();
    return bot(text, { chartId: c.id, qr: acts });
  }
  function needMetric() {
    return bot('Happy to build that. Which measure should I look at?', { qr: [qr('Weight', 'Weight by location'), qr('Missed pickups', 'Missed-pickup rate by weekday'), qr('CO₂ saved', 'CO₂ saved over time'), qr('Cost', 'Pickup cost by location')] });
  }
  function uploadPrompt() {
    return bot('Upload a **CSV file** (with a date column and at least one column of numbers) and I will line it up with your pickups. Nothing leaves your browser.',
      { qr: [qr('Choose a file', '', 'upload'), qr('Try a sample file', '', 'sample')] });
  }
  function externalReply(t, p) {
    const found = p.ov ? [p.ov] : ['temp', 'rain', 'foot'];
    const lines = found.map(k => '• **' + EXT[k].label + '**, daily');
    return bot('I searched the open-data sources I know for datasets that could explain your waste volumes:\n' + lines.join('\n') +
      '\n\n**Demo note:** in this prototype these are simulated values. A live version would call a backend that searches the web and public APIs.\nWhich one should I compare with your waste?',
      { qr: found.map(k => qr('Weight vs ' + EXT[k].short, 'Compare weight with ' + EXT[k].short)).concat([qr('Upload my own file', '', 'upload')]) });
  }
  function ingestReply(name, text) {
    const r = ingest(name, text);
    if (r.err) return bot(r.err, { qr: [qr('Try a sample file', '', 'sample')] });
    const ds = r.ds, f = ds.fields[0], q = [];
    q.push(qr('Chart ' + f + (ds.dateName ? ' over time' : ''), ds.dateName ? 'Chart ' + f + ' from my file over time' : 'Chart ' + f + ' from my file by ' + ds.catName.toLowerCase()));
    if (ds.dateName) { q.push(qr('Compare with my waste weight', 'Compare my file ' + f + ' with weight over time')); if (ds.cats.length) q.push(qr('Split by ' + ds.catName.toLowerCase(), 'Chart ' + f + ' from my file split by ' + ds.catName.toLowerCase())); }
    return bot('Got it: **' + ds.name + '** has ' + num(ds.total) + ' rows' + (ds.from ? ' from ' + dShortLocal(ds.from) + ' to ' + dShortLocal(ds.to) : '') + '.\nI found these number columns: ' + ds.fields.join(', ') + (ds.catName ? '. The category column is **' + ds.catName + '**' : '') + '. What would you like to do with it?', { qr: q });
  }
  function uploadChart(p, t) {
    const u = pickUpload(t); if (!u) return uploadPrompt();
    const ds = u.ds, wantsSplit = /\b(split|broken down|each (location|category)|per (location|category))\b/.test(t) && ds.cats.length > 0;
    const by = !ds.dateName ? 'cat' : (wantsSplit ? 'time' : (/\bby\s+(category|location|type|site|store)\b/.test(t) && ds.catName ? 'cat' : 'time'));
    const split = wantsSplit && by === 'time';
    return chartReply({ src: 'upload', up: { id: ds.id, field: u.field, agg: aggFor(u.field), by, split }, type: p.type || null }, null);
  }

  function respond(text) {
    const t = text.toLowerCase().trim();
    if (/^(hi|hello|hey|hoi|hallo|good (morning|afternoon|evening))\b[\s!.,]*$/.test(t)) return bot('Hi! I can answer questions about the planner, build new charts on your Report page, or bring in your own data. What would you like to do?', { qr: HELP_QR() });
    if (/^(thanks|thank you|thx|cheers|great|perfect|nice|cool)\b/.test(t)) return bot('You are welcome! Ask me anything else, or tell me what to change about a chart.', { qr: HELP_QR().slice(1) });
    if (/\b(what can you do|help me|help$|what do you do|capabilities)\b/.test(t) && !/chart/.test(t)) return bot('Here is what I can do:', { qr: HELP_QR() });
    if (/^(show me |can you show me |i want to see )?(the )?(frequently asked questions|faqs?)\b/.test(t)) return bot('Here are the questions I get asked most. Tap one:', { qr: FAQ.map(f => qr(f.q, f.q)) });
    if (/\b(help me build a chart|build a chart|create a chart|make a chart)\s*$/.test(t)) return bot('Tell me what you want to look at in your own words, for example:', { qr: EXAMPLES.map(e => qr(e, e)) });
    if (/\badd outside data|add (other|external|more) data|bring in (other|external|outside)? ?data\s*$/.test(t)) return bot('You have two options:\n• **Upload a file**: a CSV with a date column (and a location or category column if you have one).\n• **Let me find open data**: weather, rainfall or footfall that might explain your waste volumes.', { qr: [qr('Upload a CSV', '', 'upload'), qr('Find open data', 'Find open data that could explain my waste volumes'), qr('Try a sample file', '', 'sample')] });

    const p = parse(t), last = st.charts.find(c => c.id === st.last);
    const changes = p.metric || p.dims.length || p.type || p.locs.length || p.locTypes.length || p.streams.length || p.weeks || p.ov;
    const short = t.split(/\s+/).length <= 7, explicit = /\b(find|search|look ?up|google|internet|open data|upload|attach|import|questions?|faqs?)\b/.test(t);
    if (p.upload && st.uploads.length && !p.metric && !FOLLOW_RX.test(t) && (p.verb || /\bchart|from my|split by/.test(t))) return uploadChart(p, t);
    if (last && last.src !== 'upload' && changes && !explicit && (FOLLOW_RX.test(t) || (short && !p.metric && !p.howmuch && !/^(what|how|why|where)\b/.test(t))))
      return chartReply(buildSpec(p, t, last), last.id);
    if (last && last.src === 'upload' && p.type && FOLLOW_RX.test(t)) return chartReply(Object.assign({}, last, { type: p.type }), last.id);

    if (p.upload && !st.uploads.length && /\bsample\b/.test(t)) return { act: 'sample' };
    if (/\b(upload|attach|import)\b/.test(t) && !p.metric) return uploadPrompt();

    const chartIntent = p.verb && (p.metric || p.dims.length || p.ov || p.locs.length || p.streams.length) || (p.metric && p.dims.length) || (p.howmuch && p.metric) || (p.ov && p.metric) || (p.dims.length && p.verb);
    const askish = /^(what|why|how|where|when|who|can|does|do|is|are)\b/.test(t) && !p.verb && !p.dims.length;
    if (chartIntent && !askish) {
      const assumed = !p.metric ? 'I assumed you meant **weight**; tell me if you want a different measure.' : '';
      if (p.upload && st.uploads.length && !p.metric) return uploadChart(p, t);
      return chartReply(buildSpec(p, t, null), null, assumed);
    }
    if (/\b(chart|graph|plot|visuali[sz]\w*)\b/.test(t)) return needMetric();
    if (/\b(find|search|look ?up|google|internet|web|online|open data|third.?party|external|outside|public data|bring in)\b/.test(t) || (p.ov && !p.metric)) return externalReply(t, p);

    const f = faqMatch(t);
    if (f) return bot(f.a(), { qr: [qr('More questions', 'Show me frequently asked questions'), qr('Build a chart', 'Help me build a chart')] });
    return bot('I am not sure I got that. I can answer questions about the planner and report, build new charts from your data, or bring in a file of your own. Try one of these:', { qr: EXAMPLES.slice(0, 3).map(e => qr(e, e)).concat([qr('Frequently asked questions', 'Show me frequently asked questions')]) });
  }

  async function reply(text) {
    const api = window.SMARTPLAN_CHAT_API;
    if (api) {
      try {
        const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, history: st.msgs.slice(-10).map(m => ({ role: m.role, text: m.text })), schema: { metrics: Object.keys(METRICS), dimensions: Object.keys(DIM_PHRASE), types: ['bar', 'line', 'stacked', 'grouped', 'donut'], overlays: Object.keys(EXT) } }) });
        const j = await r.json();
        if (j && j.chart) return chartReply(Object.assign({ metric: 'weight', dim: 'time', series: null, type: null, locs: [], locTypes: [], streams: [], weeks: null, overlay: null }, j.chart), null, j.reply || '');
        if (j && j.reply) return bot(String(j.reply));
      } catch (e) { /* backend unreachable: fall back to the built-in assistant */ }
    }
    return respond(text);
  }

  /* ================= chat UI ================= */
  const ICON = {
    chat: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.3 9 9 0 0 1-3.6-.8L3 21l1.8-4.9A8.2 8.2 0 0 1 3.5 11.5C3.5 6.8 7.3 3 12 3s9 3.8 9 8.5Z"/><circle cx="8.5" cy="11.5" r=".6" fill="currentColor"/><circle cx="12" cy="11.5" r=".6" fill="currentColor"/><circle cx="15.5" cy="11.5" r=".6" fill="currentColor"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    max: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>',
    min: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/></svg>',
    clip: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 11.5-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"/></svg>',
    reset: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/></svg>',
    faq: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/></svg>',
    bars: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    data: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6M4 11.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>'
  };
  const SUGGEST = [
    { k: 'faq', ic: ICON.faq, t: 'Quick answers', d: 'Frequently asked questions about the planner, the forecast and the report.' },
    { k: 'chart', ic: ICON.bars, t: 'Build a chart', d: 'Recombine your pickup data into new charts on the Report page, adapted to your use case.' },
    { k: 'data', ic: ICON.data, t: 'Bring in other data', d: 'Upload a CSV, or let me find open data such as weather or footfall to compare with your waste.' }
  ];

  function mount() {
    if (document.getElementById('chat')) return;
    const el = document.createElement('div'); el.id = 'chat'; el.className = 'chat';
    el.innerHTML = '<div class="chat-panel" role="dialog" aria-label="SmartPlan assistant" hidden>' +
      '<div class="chat-head"><span class="chat-av">' + ICON.chat + '</span><div class="chat-tt"><b>Assistant</b><small>Demo</small></div>' +
      '<button class="chat-ib" data-chat="reset" aria-label="Start a new chat" title="New chat">' + ICON.reset + '</button>' +
      '<button class="chat-ib chat-maxb" data-chat="max" aria-label="Maximize" title="Maximize">' + ICON.max + '</button>' +
      '<button class="chat-ib" data-chat="close" aria-label="Close" title="Close">' + ICON.close + '</button></div>' +
      '<div class="chat-body" id="chatBody" aria-live="polite"></div>' +
      '<form class="chat-form" id="chatForm" autocomplete="off"><button type="button" class="chat-ib" data-chat="attach" aria-label="Upload a CSV file" title="Upload a CSV file">' + ICON.clip + '</button>' +
      '<input id="chatText" type="text" placeholder="Ask a question or describe a chart…" aria-label="Message"><button type="submit" class="chat-send" aria-label="Send">' + ICON.send + '</button>' +
      '<input id="chatFile" type="file" accept=".csv,.tsv,.txt,text/csv" hidden></form></div>' +
      '<button class="chat-fab" data-chat="toggle" aria-label="Open the assistant" aria-expanded="false" title="Ask the assistant">' + ICON.chat + '</button>';
    document.body.appendChild(el);
    el.addEventListener('click', onClick);
    el.addEventListener('mousemove', moveTip);
    el.addEventListener('mouseleave', hideTip);
    el.querySelector('#chatForm').addEventListener('submit', e => { e.preventDefault(); const i = $('#chatText'); const v = i.value.trim(); if (v) { i.value = ''; send(v); } });
    el.querySelector('#chatFile').addEventListener('change', onFile);
  }

  function bodyHtml() {
    let h = '';
    if (!st.msgs.length) {
      h += '<div class="msg bot"><div class="bub">Hi! I am the SmartPlan assistant. I can answer questions, build new charts on your Report page, and bring in your own or outside data.</div></div>';
      h += '<div class="sugs">' + SUGGEST.map(s => '<button class="sug" data-chat="sug" data-k="' + s.k + '"><span class="sug-ic">' + s.ic + '</span><span class="sug-tx"><b>' + s.t + '</b><small>' + s.d + '</small></span></button>').join('') + '</div>';
      h += '<p class="small chat-hint">Tip: use the expand button at the top to enlarge the chat.</p>';
    }
    st.msgs.forEach((m, mi) => {
      if (m.role === 'user') { h += '<div class="msg user"><div class="bub">' + esc(m.text) + '</div></div>'; return; }
      const c = m.chartId && st.charts.find(x => x.id === m.chartId);
      let chart = '';
      if (c) { try { const res = compute(c); chart = '<div class="chat-chart"><b>' + esc(res.title) + '</b><p class="small">' + esc(res.caption) + '</p>' + chartBody(res) + '</div>'; } catch (e) { chart = ''; } }
      else if (m.chartId) chart = '<p class="small">That chart was removed.</p>';
      const qrs = (m.qr || []).filter(q => !(q.act && /^(rm|view):/.test(q.act) && !c)).map((q, qi) => '<button class="qr" data-chat="qr" data-m="' + mi + '" data-q="' + qi + '">' + esc(q.label) + '</button>').join('');
      h += '<div class="msg bot"><div class="bub">' + rich(m.text) + chart + '</div>' + (qrs && mi === st.msgs.length - 1 ? '<div class="qrs">' + qrs + '</div>' : '') + '</div>';
    });
    if (st.busy) h += '<div class="msg bot"><div class="bub typing"><i></i><i></i><i></i></div></div>';
    return h;
  }
  function draw() {
    const el = $('#chat'); if (!el) return;
    el.classList.toggle('open', st.open); el.classList.toggle('max', st.max);
    const fab = el.querySelector('.chat-fab'); fab.setAttribute('aria-expanded', String(st.open)); fab.setAttribute('aria-label', st.open ? 'Close the assistant' : 'Open the assistant');
    el.querySelector('.chat-panel').hidden = !st.open;
    const mb = el.querySelector('.chat-maxb'); mb.innerHTML = st.max ? ICON.min : ICON.max; mb.setAttribute('aria-label', st.max ? 'Make smaller' : 'Maximize'); mb.title = st.max ? 'Make smaller' : 'Maximize';
    const body = $('#chatBody'); body.innerHTML = bodyHtml(); body.scrollTop = body.scrollHeight;
    save();
  }
  function say(m) { st.msgs.push(m); st.busy = false; draw(); }
  function send(text) {
    if (st.busy) return;
    st.msgs.push({ role: 'user', text }); st.busy = true; draw();
    setTimeout(async () => {
      let r; try { r = await reply(text); } catch (e) { r = bot('Sorry, something went wrong while building that. Try rephrasing it, or ask for one of the examples.', { qr: EXAMPLES.slice(0, 3).map(x => qr(x, x)) }); }
      if (r && r.act === 'sample') { loadSample(); return; }
      say(r);
    }, 450);
  }
  function loadSample() { st.busy = false; ingestAndSay('sample_store_sales.csv', sampleCsv()); }
  function ingestAndSay(name, text) { st.msgs.push({ role: 'user', text: 'Uploaded ' + name }); say(ingestReply(name, text)); }
  function onFile(e) {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) { st.msgs.push({ role: 'user', text: 'Uploaded ' + f.name }); say(bot('I can read **CSV** files for now. In Excel, choose File → Save As → CSV, then upload it again.', { qr: [qr('Choose a file', '', 'upload')] })); return; }
    if (f.size > 2e6) { st.msgs.push({ role: 'user', text: 'Uploaded ' + f.name }); say(bot('That file is larger than 2 MB. Please upload a smaller extract (for example, one row per day).')); return; }
    const rd = new FileReader(); rd.onload = () => { st.open = true; ingestAndSay(f.name, String(rd.result || '')); }; rd.readAsText(f);
  }
  function onClick(e) {
    const b = e.target.closest('[data-chat]'); if (!b) return;
    const a = b.dataset.chat;
    if (a === 'toggle') toggle();
    else if (a === 'close') close();
    else if (a === 'max') { st.max = !st.max; draw(); }
    else if (a === 'reset') { st.msgs = []; st.busy = false; draw(); }
    else if (a === 'attach') $('#chatFile').click();
    else if (a === 'sug') {
      const k = b.dataset.k;
      if (k === 'faq') send('Show me frequently asked questions');
      else if (k === 'chart') send('Help me build a chart');
      else send('I want to add outside data');
    } else if (a === 'qr') {
      const q = st.msgs[+b.dataset.m].qr[+b.dataset.q];
      if (q.act === 'upload') $('#chatFile').click();
      else if (q.act === 'sample') { st.msgs.push({ role: 'user', text: 'Try a sample file' }); loadSample(); }
      else if (q.act && q.act.startsWith('view:')) viewChart(q.act.slice(5));
      else if (q.act && q.act.startsWith('rm:')) removeChart(q.act.slice(3), true);
      else send(q.say || q.label);
    }
  }

  /* ================= hooks used by app.js ================= */
  function refresh() { if (typeof ui !== 'undefined' && ui.tab === 'report') render(); else navBadge(); }
  function navBadge() {
    const b = document.querySelector('#nav button[data-tab="report"]'); if (!b) return;
    b.innerHTML = 'Report' + (st.charts.length ? '<span class="pill">' + st.charts.length + '</span>' : '');
  }
  function viewChart() {
    ui.tab = 'report'; ui.modal = null; ui.filterOpen = false; if (isMobile()) { st.open = false; st.max = false; draw(); }
    render();
    const el = document.getElementById('my-charts'); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function removeChart(id, fromChat) {
    st.charts = st.charts.filter(c => c.id !== id); if (st.last === id) st.last = null;
    if (fromChat) st.msgs.push(bot('Removed. Want to try a different view?', { qr: EXAMPLES.slice(0, 3).map(e => qr(e, e)) }));
    draw(); refresh();
  }
  function toggle() { st.open ? close() : open(); }
  function open() {
    st.open = true; if (typeof ui !== 'undefined' && ui.simOpen) { ui.simOpen = false; render(); }
    draw(); if (!isMobile()) { const i = $('#chatText'); if (i) i.focus(); }
  }
  function close() { st.open = false; st.max = false; draw(); }
  function reportSection() {
    if (!st.charts.length) return '';
    const cards = st.charts.map(c => {
      let res; try { res = compute(c); } catch (e) { return ''; }
      return '<div class="card cchart"><div class="cc-head"><h3>' + esc(res.title) + '</h3><button class="cc-x" data-act="rmchart" data-id="' + esc(c.id) + '" aria-label="Remove this chart" title="Remove this chart">×</button></div>' +
        '<p class="small cap">' + esc(res.caption) + '</p>' + chartBody(res) + '</div>';
    }).join('');
    return '<h3 class="sec-h" id="my-charts">Your charts <span class="tag new">Built with the Assistant</span></h3><div class="grid cols2">' + cards + '</div>';
  }
  function reset() { st.charts = []; st.uploads = []; st.msgs = []; st.last = null; st.busy = false; try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } draw(); navBadge(); }
  function init() { load(); mount(); draw(); navBadge(); }

  return { init, reportSection, removeChart: id => removeChart(id, false), close, reset, navBadge, isOpen: () => st.open, _t: { respond, compute, parse, st, ingest, parseCSV, sampleCsv, insightOf, chartBody, bodyHtml } };
})();
