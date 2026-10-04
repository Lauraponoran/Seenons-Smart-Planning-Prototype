# SmartPlan — concept prototype for a "smart" waste-collection planner

A static, dependency-free prototype of the idea from our case: **partner data → platform → AI agent → actionable insight → one click in the scheduling interface.**

Everything is synthetic demo data. The styling uses a navy / teal / pink palette inspired by Seenons, with no real logos or brand assets; this is a student concept, not an official product.

## What it shows

| Tab | What it demonstrates |
|---|---|
| **Overview** | The metrics we assume the platform already shows (orders, weight, separation rate, CO₂, weight by stream) plus new ones: missed-pickup rate by weekday and containers at overflow risk. |
| **Planner** | Month view with square day cells. Directly under the heading sits a slim dashed **Demo controls** strip: the events (No event, Black Friday, Sinterklaas, Christmas, Summer dip) as a segmented control plus **↺ Reset demo**; picking an event reveals a row of chips with the predicted effects per location type and the overflow-risk count. The calendar has one control panel: month navigation on the left, then **Today** (blue, navigation), **Filter** (by location and/or waste type) and **+ Add pickup** (pink, the primary action; location, type of waste, amount, date) on the right. Every pickup is a bar in its waste-type colour with a location tag (AMS, UTR, RTM, SCH); hatched chips marked **AI** are agent suggestions you can review and apply. Dutch holidays are shown on the days themselves (see *Holidays* below). |
| **Forecast** | Large fill-level chart per container: sensor history, forecast and pickups. |
| **AI agent** | Prioritised suggestions with the reasoning and impact (pickups, €, CO₂). Apply, dismiss or apply all; activity log. |
| **Data & assumptions** | Assumptions stated up front, sensor simulator (move a slider and watch the agent react), and a roadmap of new data collection (IoT sensors, weigh-at-pickup, composition scanning, calendar/behaviour, service events) with fallbacks if the data does not exist. |

Use **Simulate an event** (Black Friday, Sinterklaas, Christmas, summer) to see predictive instead of reactive scheduling. The strip appears under the heading of every tab because the scenario is global: it changes the forecast, the suggestions and the Overview numbers, so the control should be reachable wherever its effect is visible. (To show it on Planner only, make the `eventWidget()` call in `pageHead()` in `app.js` conditional on `ui.tab === 'planner'`.)

## Holidays

The planner marks Dutch holidays, computed per year in `engine.js` (`holidaysFor()`, with the movable feasts derived from Easter) so any month or year you navigate to is right. Two kinds:

- **Public holiday** (pink-tinted day, pink label): New Year's Day, Easter Sunday/Monday, King's Day, Ascension Day, Whit Sunday/Monday, Christmas Day, Boxing Day.
- **Notable date** (blue label only): Good Friday and Liberation Day (not days off for everyone), plus Black Friday and Sinterklaas, which line up with the simulated scenarios.

**Display-only for now:** the agent does not yet treat public holidays as closed days, so a scheduled pickup can still sit on one. Making `Model.status()` / the recommendation rules holiday-aware is the natural next step; it fits the "holiday calendar" row of the data-collection roadmap.

## Pricing

The prototype deliberately does not model rescheduling or cancellation fees. Cost figures use a flat price per pickup (`ASSUMPTIONS.pickupCost`) and nothing else.

## How the "agent" works (`engine.js`)

Transparent rules, so each suggestion is explainable:

1. **Overflow risk** — measured fill rate × weekday pattern × scenario multiplier → forecast; if a container reaches 95% before it is collected, move or add a pickup on the latest day it is still under ~92%.
2. **Missed-pickup risk** — weekday miss rate per location from service-event history; if ≥ 15%, move the pickup to a safer day that does not cause an overflow.
3. **Cost saving** — pickup forecast under ~32% full and skipping it keeps the container safe → cancel.
4. **Composition** — recyclable share in residual ≥ 20% → create an audit/follow-up task.

Tuning values live in `data.js` (`ASSUMPTIONS`). To use a real model or an LLM, replace `Model.recommendations()` or add an explanation layer on top of its output (call your own backend; never put an API key in this static site).

## Run locally

Open `index.html` in a browser, or:

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Host on GitHub Pages

1. Create a repo and push these files to the root of the `main` branch:
   `index.html, styles.css, data.js, engine.js, app.js, README.md, .nojekyll`
2. In GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save**.
3. After a minute the site is live at `https://<your-username>.github.io/<repo-name>/`.

## Replacing demo data with real data

- `data.js` — containers, locations, weekday patterns, assumptions.
- `buildHistory()` in `engine.js` — generates sensor history and pickup events; swap for `fetch()` calls to your sensor/partner API (same shapes: `fills[cid] = [{date, fill}]`, `events = [{date, cid, loc, weekday, picked, weight, reason}]`).
- State (applied changes, scenario) is saved in `localStorage`; **Reset demo** clears it.
