/* ------------------------------------------------------------------
   engine.js — forecasting + recommendation engine ("the AI agent")
   Deliberately transparent and rule-based so every suggestion can be explained.
   To plug in an LLM or ML model, replace Model.recommendations() or add an
   explanation layer on top (see README).
------------------------------------------------------------------- */

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function iso(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function parseIso(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function fmtDate(d) {
  const x = typeof d === 'string' ? parseIso(d) : d;
  return x.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------
   Holiday calendar (Netherlands). Computed per year instead of hard-coded, so the
   planner shows the right dates whichever month/year you navigate to. The movable
   feasts all hang off Easter, which is why easterSunday() exists.
   kind 'public' = national public holiday (collection partners are normally closed)
   kind 'event'  = notable date worth seeing when planning (retail peaks, partial days off)
   NOTE: display-only for now. The agent does not yet treat public holidays as closed days
   (see README, "Holidays").
------------------------------------------------------------------- */
function easterSunday(y) {            // Meeus/Jones/Butcher algorithm (Gregorian calendar)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}

const HOLIDAY_CACHE = {};
function holidaysFor(y) {              // -> { 'YYYY-MM-DD': { name, kind } }
  if (HOLIDAY_CACHE[y]) return HOLIDAY_CACHE[y];
  const h = {};
  const put = (d, name, kind) => { h[iso(d)] = { name, kind }; };
  const easter = easterSunday(y);
  put(new Date(y, 0, 1), "New Year's Day", 'public');
  put(addDays(easter, -2), 'Good Friday', 'event');          // not an official public holiday in NL
  put(easter, 'Easter Sunday', 'public');
  put(addDays(easter, 1), 'Easter Monday', 'public');
  const king = new Date(y, 3, 27);                           // 27 April, or the 26th when the 27th is a Sunday
  put(king.getDay() === 0 ? new Date(y, 3, 26) : king, "King's Day", 'public');
  put(new Date(y, 4, 5), 'Liberation Day', 'event');         // only a day off in some years / sectors
  put(addDays(easter, 39), 'Ascension Day', 'public');
  put(addDays(easter, 49), 'Whit Sunday', 'public');
  put(addDays(easter, 50), 'Whit Monday', 'public');
  const thu4 = 1 + ((4 - new Date(y, 10, 1).getDay() + 7) % 7) + 21;   // 4th Thursday of November
  put(new Date(y, 10, thu4 + 1), 'Black Friday', 'event');   // matches the "Black Friday week" scenario
  put(new Date(y, 11, 5), 'Sinterklaas', 'event');           // matches the "Sinterklaas season" scenario
  put(new Date(y, 11, 25), 'Christmas Day', 'public');
  put(new Date(y, 11, 26), 'Boxing Day', 'public');
  return (HOLIDAY_CACHE[y] = h);
}

const HISTORY_DAYS = 84;

function buildHistory(today) {
  const rng = mulberry32(20261003);
  const fills = {};
  const events = [];
  for (const c of CONTAINERS) {
    const loc = LOCATIONS.find(l => l.id === c.loc);
    const factors = WEEKDAY_FACTORS[loc.type];
    const avg = factors.reduce((a, b) => a + b, 0) / 7;
    let fill = 20 + rng() * 25;
    const series = [];
    for (let i = -HISTORY_DAYS; i <= 0; i++) {
      const date = addDays(today, i);
      const wd = date.getDay();
      fill += c.rate * (factors[wd] / avg) * (0.8 + rng() * 0.4);
      if (fill > 100) fill = 100;
      if (i < 0 && c.days.includes(wd)) {
        const picked = rng() > missProbability(c.loc, wd);
        const ev = { date: iso(date), cid: c.id, loc: c.loc, weekday: wd, picked, fillAtPickup: fill };
        if (picked) {
          ev.weight = Math.round(fill / 100 * c.cap * STREAMS[c.stream].kgPerL);
          fill = 2;
        } else {
          ev.reason = MISS_REASONS[Math.floor(rng() * MISS_REASONS.length)];
        }
        events.push(ev);
      }
      series.push({ date: iso(date), fill: Math.round(fill * 10) / 10 });
    }
    fills[c.id] = series;
  }
  return { fills, events };
}

const Model = {
  today: startOfDay(new Date()),
  hist: null,
  overrides: {},     // "cid|YYYY-MM-DD" -> 'added' | 'cancelled'
  amounts: {},       // "cid|YYYY-MM-DD" -> number of containers (manual pickups, default 1)
  dismissed: {},     // recId -> true
  tasks: {},         // recId -> true (composition audit tasks created)
  fillOverride: {},  // cid -> % (sensor simulator)
  scenario: 'normal',
  log: [],

  init() { this.hist = buildHistory(this.today); },
  loc(id) { return LOCATIONS.find(l => l.id === id); },
  cont(id) { return CONTAINERS.find(c => c.id === id); },
  holiday(date) { return holidaysFor(date.getFullYear())[iso(date)] || null; },
  streamLabel(c) { return STREAMS[c.stream].label; },
  contLabel(c) { return STREAMS[c.stream].label + ' (' + c.cap + ' L) – ' + this.loc(c.loc).name; },

  /* ---------- state helpers ---------- */
  status(c, date, ov) {
    const o = (ov || this.overrides)[c.id + '|' + iso(date)];
    const base = c.days.includes(date.getDay());
    if (o === 'cancelled') return base ? 'cancelled' : null;
    if (o === 'added') return 'added';
    return base ? 'scheduled' : null;
  },
  applyOps(ov, ops) {
    const out = { ...ov };
    for (const op of ops) {
      const c = this.cont(op.cid);
      const d = parseIso(op.date);
      const key = op.cid + '|' + op.date;
      const base = c.days.includes(d.getDay());
      if (op.op === 'add') { if (base) delete out[key]; else out[key] = 'added'; }
      else { if (base) out[key] = 'cancelled'; else delete out[key]; }
    }
    return out;
  },
  pickups(from, days, cid) {
    const out = [];
    for (let d = 0; d < days; d++) {
      const date = addDays(from, d);
      for (const c of CONTAINERS) {
        if (cid && c.id !== cid) continue;
        const st = this.status(c, date);
        if (st) out.push({ cid: c.id, date: iso(date), d, status: st, amount: this.amounts[c.id + '|' + iso(date)] || 1 });
      }
    }
    return out;
  },
  reset() { this.overrides = {}; this.amounts = {}; this.dismissed = {}; this.tasks = {}; this.fillOverride = {}; this.log = []; },

  /* ---------- sensor + forecast ---------- */
  currentFill(c) {
    if (this.fillOverride[c.id] != null) return this.fillOverride[c.id];
    const s = this.hist.fills[c.id];
    return s[s.length - 1].fill;
  },
  measuredRate(c) {
    const s = this.hist.fills[c.id].slice(-15);
    const deltas = [];
    for (let i = 1; i < s.length; i++) {
      const dlt = s[i].fill - s[i - 1].fill;
      if (dlt > 0 && s[i].fill < 100) deltas.push(dlt);
    }
    if (!deltas.length) return c.rate;
    return deltas.reduce((a, b) => a + b, 0) / deltas.length;
  },
  scenarioMult(c) { return SCENARIOS[this.scenario].mult[this.loc(c.loc).type] || 1; },
  dailyRate(c, date) {
    const f = WEEKDAY_FACTORS[this.loc(c.loc).type];
    const avg = f.reduce((a, b) => a + b, 0) / 7;
    return this.measuredRate(c) * (f[date.getDay()] / avg) * this.scenarioMult(c);
  },
  simulate(c, ov) {
    ov = ov || this.overrides;
    let fill = this.currentFill(c);
    const out = [];
    for (let d = 0; d <= 14; d++) {
      const date = addDays(this.today, d);
      if (d > 0) fill = Math.min(130, fill + this.dailyRate(c, date));
      const st = this.status(c, date, ov);
      const pickup = st === 'scheduled' || st === 'added';
      out.push({ date: iso(date), d, fill, pickup, status: st });
      if (pickup) fill = 2;
    }
    return out;
  },
  missRate(locId, weekday) {
    const ev = this.hist.events.filter(e => e.loc === locId && e.weekday === weekday);
    if (ev.length < 5) return { rate: 0, n: ev.length };
    return { rate: ev.filter(e => !e.picked).length / ev.length, n: ev.length };
  },

  /* ---------- KPIs from history ---------- */
  kpis(locId) {
    const ev = this.hist.events.filter(e => !locId || e.loc === locId);
    const picked = ev.filter(e => e.picked);
    const byStream = {};
    for (const k of Object.keys(STREAMS)) byStream[k] = 0;
    let co2 = 0;
    for (const e of picked) {
      const c = this.cont(e.cid);
      byStream[c.stream] += e.weight;
      co2 += e.weight * STREAMS[c.stream].co2PerKg;
    }
    const total = Object.values(byStream).reduce((a, b) => a + b, 0);
    const sep = total ? 1 - byStream.residual / total : 0;
    const weekly = Array.from({ length: 12 }, () => 0);
    for (const e of picked) {
      const idx = 11 - Math.floor((parseIso(iso(this.today)) - parseIso(e.date)) / 864e5 / 7);
      if (idx >= 0 && idx < 12) weekly[idx] += e.weight;
    }
    return {
      orders: picked.length, missed: ev.length - picked.length,
      missRate: ev.length ? (ev.length - picked.length) / ev.length : 0,
      weight: total, byStream, separation: sep, co2, weekly
    };
  },

  /* ---------- the agent ---------- */
  recommendations(locId) {
    const A = ASSUMPTIONS;
    const out = [];
    const sc = SCENARIOS[this.scenario];
    const seenRisk = {};
    for (const c of CONTAINERS) {
      if (locId && c.loc !== locId) continue;
      const L = this.loc(c.loc);
      const cur = Math.round(this.currentFill(c));
      const rate = this.measuredRate(c) * this.scenarioMult(c);
      const base = this.simulate(c);
      const scNote = this.scenario === 'normal' ? '' : ' Simulated event "' + sc.label + '" is applied.';
      let rec = null;

      /* 1) overflow risk */
      // a pickup scheduled today already empties today's (full) reading, so it is not an overflow risk any more
      const over = base.find(p => p.fill >= A.alertFill && !(p.d === 0 && p.pickup));
      if (over) {
        let lastReset = 0;
        for (const p of base) if (p.pickup && p.d < over.d) lastReset = p.d;
        const overIsPickup = over.pickup;
        const P = base.find(p => p.pickup && p.d >= over.d);
        let E = null;
        for (const p of base) {
          if (p.d >= Math.max(1, lastReset + (lastReset ? 1 : 0)) && p.d <= over.d && !p.pickup &&
              p.fill <= A.targetFill + 4 && !(overIsPickup && p.d === over.d)) E = p;
        }
        const eDate = E ? E.date : iso(this.today);
        const doMove = P && P.date !== eDate && parseIso(P.date) > parseIso(eDate);
        const ops = doMove
          ? [{ op: 'cancel', cid: c.id, date: P.date }, { op: 'add', cid: c.id, date: eDate }]
          : [{ op: 'add', cid: c.id, date: eDate }];
        const pd = doMove ? 0 : 1;
        rec = {
          id: 'overflow|' + c.id + '|' + eDate, type: 'overflow', severity: over.d <= 2 ? 'high' : 'medium',
          cid: c.id, loc: c.loc, ops,
          title: doMove
            ? 'Move pickup ' + fmtDate(P.date) + ' → ' + fmtDate(eDate) + ' · ' + this.streamLabel(c) + ', ' + L.name
            : 'Add extra pickup on ' + fmtDate(eDate) + ' · ' + this.streamLabel(c) + ', ' + L.name,
          reason: 'Sensor reads ' + cur + '% full and fills about ' + rate.toFixed(0) + '% per day.' + scNote +
            ' Forecast reaches ' + Math.round(Math.min(over.fill, 100)) + '% on ' + fmtDate(over.date) +
            (over.pickup ? ', right when the pickup is scheduled — too late.' : (P ? ' — before the next scheduled pickup on ' + fmtDate(P.date) + '.' : ' with no pickup planned.')),
          impact: { pickups: pd, cost: pd * A.pickupCost, co2: pd * A.co2PerPickup, note: 'Avoids an overflowing container and a customer call.' }
        };
      }

      /* 2) missed-pickup risk */
      if (!rec) {
        for (const p of base) {
          if (!p.pickup || p.d < 1) continue;
          const wd = parseIso(p.date).getDay();
          const mr = this.missRate(c.loc, wd);
          if (mr.rate < A.riskMissRate) continue;
          for (const delta of [1, -1]) {
            const nd = addDays(parseIso(p.date), delta);
            const nd0 = Math.round((nd - this.today) / 864e5);
            if (nd0 < 1 || nd0 > 14) continue;
            if (this.status(c, nd)) continue;
            const alt = this.missRate(c.loc, nd.getDay());
            if (alt.n < 5 || alt.rate >= A.safeMissRate) continue;
            const fac = WEEKDAY_FACTORS[L.type];
            if (fac[nd.getDay()] < 0.3) continue; // site is closed that day
            const ops = [{ op: 'cancel', cid: c.id, date: p.date }, { op: 'add', cid: c.id, date: iso(nd) }];
            const sim = this.simulate(c, this.applyOps(this.overrides, ops));
            if (Math.max(...sim.map(x => x.fill)) >= A.alertFill) continue;
            rec = {
              id: 'risk|' + c.id + '|' + p.date, type: 'risk', severity: 'medium', cid: c.id, loc: c.loc, ops,
              title: 'Move pickup ' + fmtDate(p.date) + ' → ' + fmtDate(nd) + ' · ' + this.streamLabel(c) + ', ' + L.name,
              reason: L.name + ' has a ' + Math.round(mr.rate * 100) + '% missed-pickup rate on ' +
                parseIso(p.date).toLocaleDateString('en-GB', { weekday: 'long' }) + 's (last 12 weeks, ' + mr.n + ' pickups) versus ' +
                Math.round(alt.rate * 100) + '% on ' + nd.toLocaleDateString('en-GB', { weekday: 'long' }) + 's. Forecast stays below ' + A.alertFill + '% after the move.',
              impact: { pickups: 0, cost: 0, co2: 0, note: 'Expected missed pickups avoided: ~' + ((mr.rate - alt.rate) * 100).toFixed(0) + ' per 100 pickups.' }
            };
            break;
          }
          if (rec) break;
        }
      }

      /* 3) under-filled pickup */
      if (!rec) {
        for (const p of base) {
          if (!p.pickup || p.d < 1 || p.fill >= A.underfillFill) continue;
          const ops = [{ op: 'cancel', cid: c.id, date: p.date }];
          const sim = this.simulate(c, this.applyOps(this.overrides, ops));
          const peak = Math.max(...sim.map(x => x.fill));
          if (peak >= A.alertFill - 5) continue;
          rec = {
            id: 'underfill|' + c.id + '|' + p.date, type: 'underfill', severity: 'low', cid: c.id, loc: c.loc, ops,
            title: 'Skip pickup ' + fmtDate(p.date) + ' · ' + this.streamLabel(c) + ', ' + L.name,
            reason: 'Forecast is only ' + Math.round(p.fill) + '% full on ' + fmtDate(p.date) + '. Without this pickup the container peaks at ' + Math.round(peak) + '% before the next collection.' + scNote,
            impact: { pickups: -1, cost: -A.pickupCost, co2: -A.co2PerPickup, note: 'Frees a truck stop without raising overflow risk.' }
          };
          break;
        }
      }
      if (rec && rec.type === 'risk') {
        const wdKey = 'risk|' + c.loc + '|' + parseIso(rec.id.split('|')[2]).getDay();
        if (seenRisk[wdKey]) rec = null; else seenRisk[wdKey] = true;
      }
      if (rec) out.push(rec);

      /* 4) composition / contamination (independent of scheduling) */
      if (c.audit && c.audit >= 20) {
        out.push({
          id: 'composition|' + c.id, type: 'composition', severity: 'low', cid: c.id, loc: c.loc, ops: null,
          title: 'Composition scan: ~' + c.audit + '% recyclable material in residual · ' + L.name,
          reason: 'The last (simulated) scan of this residual container found about ' + c.audit + '% paper, cardboard and packaging. Residual is the most expensive stream — a paper bin or a short staff briefing could shift this weight.',
          impact: { pickups: 0, cost: 0, co2: 0, note: 'Creates an audit / follow-up task for the site.' }
        });
      }
    }
    const rank = { high: 0, medium: 1, low: 2 };
    return out
      .filter(r => !this.dismissed[r.id] && !this.tasks[r.id])
      .sort((a, b) => rank[a.severity] - rank[b.severity]);
  },

  apply(rec) {
    if (rec.ops) {
      this.overrides = this.applyOps(this.overrides, rec.ops);
      rec.ops.forEach(o => { if (o.op === 'cancel') delete this.amounts[o.cid + '|' + o.date]; });
    }
    else this.tasks[rec.id] = true;
    this.log.unshift({ t: new Date().toISOString(), text: (rec.ops ? 'Applied: ' : 'Task created: ') + rec.title });
  },
  dismiss(rec) { this.dismissed[rec.id] = true; this.log.unshift({ t: new Date().toISOString(), text: 'Dismissed: ' + rec.title }); },

  manual(op, cid, date, amount) {
    this.overrides = this.applyOps(this.overrides, [{ op, cid, date }]);
    const key = cid + '|' + date;
    if (op === 'add' && amount > 1) this.amounts[key] = amount; else delete this.amounts[key];
    const c = this.cont(cid);
    const qty = op === 'add' && amount > 1 ? amount + ' × ' : '';
    this.log.unshift({ t: new Date().toISOString(), text: (op === 'add' ? 'Added' : 'Cancelled') + ' pickup manually: ' + qty + this.streamLabel(c) + ', ' + this.loc(c.loc).name + ' on ' + fmtDate(date) });
  },

  /* ---------- persistence ---------- */
  save() {
    try {
      localStorage.setItem('smartplan-v1', JSON.stringify({
        overrides: this.overrides, amounts: this.amounts, dismissed: this.dismissed, tasks: this.tasks,
        fillOverride: this.fillOverride, scenario: this.scenario, log: this.log.slice(0, 40)
      }));
    } catch (e) { /* storage may be unavailable */ }
  },
  load() {
    try {
      const s = JSON.parse(localStorage.getItem('smartplan-v1') || 'null');
      if (s) Object.assign(this, s);
    } catch (e) { /* ignore */ }
  }
};

if (typeof module !== 'undefined') module.exports = { Model };
