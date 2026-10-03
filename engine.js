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
  dismissed: {},     // recId -> true
  tasks: {},         // recId -> true (composition audit tasks created)
  fillOverride: {},  // cid -> % (sensor simulator)
  scenario: 'normal',
  log: [],

  init() { this.hist = buildHistory(this.today); },
  loc(id) { return LOCATIONS.find(l => l.id === id); },
  cont(id) { return CONTAINERS.find(c => c.id === id); },
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
        if (st) out.push({ cid: c.id, date: iso(date), d, status: st });
      }
    }
    return out;
  },
  reset() { this.overrides = {}; this.dismissed = {}; this.tasks = {}; this.fillOverride = {}; this.log = []; },

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
      const scNote = this.scenario === 'normal' ? '' : ' Demand scenario "' + sc.label + '" is applied.';
      let rec = null;

      /* 1) overflow risk */
      const over = base.find(p => p.fill >= A.alertFill);
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
        const urgent = !E;
        const eDate = E ? E.date : iso(this.today);
        const doMove = P && P.date !== eDate && parseIso(P.date) > parseIso(eDate);
        const ops = doMove
          ? [{ op: 'cancel', cid: c.id, date: P.date }, { op: 'add', cid: c.id, date: eDate }]
          : [{ op: 'add', cid: c.id, date: eDate }];
        const fee = urgent && parseIso(eDate).getTime() === this.today.getTime() ? A.sameDayFee : 0;
        const pd = doMove ? 0 : 1;
        rec = {
          id: 'overflow|' + c.id + '|' + eDate, type: 'overflow', severity: over.d <= 2 ? 'high' : 'medium',
          cid: c.id, loc: c.loc, ops,
          title: doMove
            ? 'Move pickup ' + fmtDate(P.date) + ' → ' + fmtDate(eDate) + ' · ' + this.streamLabel(c) + ', ' + L.name
            : 'Add extra pickup on ' + fmtDate(eDate) + ' · ' + this.streamLabel(c) + ', ' + L.name,
          reason: 'Sensor reads ' + cur + '% full and fills about ' + rate.toFixed(0) + '% per day.' + scNote +
            ' Forecast reaches ' + Math.round(Math.min(over.fill, 100)) + '% on ' + fmtDate(over.date) +
            (over.pickup ? ', right when the pickup is scheduled — too late.' : (P ? ' — before the next scheduled pickup on ' + fmtDate(P.date) + '.' : ' with no pickup planned.')) +
            (fee ? ' Rescheduling today is inside the free window, so a same-day fee applies.' : ' Changing it now is free (more than 1 day ahead).'),
          impact: { pickups: pd, cost: pd * A.pickupCost + fee, co2: pd * A.co2PerPickup, note: 'Avoids an overflowing container and a customer call.' }
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
            impact: { pickups: -1, cost: -A.pickupCost, co2: -A.co2PerPickup, note: 'Cancelling is free until 1 day before.' }
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
    if (rec.ops) this.overrides = this.applyOps(this.overrides, rec.ops);
    else this.tasks[rec.id] = true;
    this.log.unshift({ t: new Date().toISOString(), text: (rec.ops ? 'Applied: ' : 'Task created: ') + rec.title });
  },
  dismiss(rec) { this.dismissed[rec.id] = true; this.log.unshift({ t: new Date().toISOString(), text: 'Dismissed: ' + rec.title }); },

  manual(op, cid, date) {
    this.overrides = this.applyOps(this.overrides, [{ op, cid, date }]);
    const c = this.cont(cid);
    this.log.unshift({ t: new Date().toISOString(), text: (op === 'add' ? 'Added' : 'Cancelled') + ' pickup manually: ' + this.streamLabel(c) + ', ' + this.loc(c.loc).name + ' on ' + fmtDate(date) });
  },
  isFree(date) { return Math.round((parseIso(date) - this.today) / 864e5) >= ASSUMPTIONS.freeRescheduleDays; },

  /* ---------- persistence ---------- */
  save() {
    try {
      localStorage.setItem('smartplan-v1', JSON.stringify({
        overrides: this.overrides, dismissed: this.dismissed, tasks: this.tasks,
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
