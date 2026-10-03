# SmartPlan — concept prototype for a "smart" waste-collection planner

A static, dependency-free prototype of the idea from our case: **partner data → platform → AI agent → actionable insight → one click in the scheduling interface.**

Everything is synthetic demo data. The styling uses a similar teal palette but no real logos or brand names; this is a student concept, not an official product.

## What it shows

| Tab | What it demonstrates |
|---|---|
| **Overview** | The metrics we assume the platform already shows (orders, weight, separation rate, CO₂, weight by stream) plus new ones: missed-pickup rate by weekday and containers at overflow risk. |
| **Planner** | 14-day pickup calendar. Dashed ✦ chips are suggestions from the agent; click to review and apply. Manual cancel / move / add with the "free ≥ 1 day before" rule. Fill-level forecast chart per container. |
| **AI agent** | Prioritised suggestions with the reasoning and impact (pickups, €, CO₂). Apply, dismiss or apply all; activity log. |
| **Data & assumptions** | Assumptions stated up front, sensor simulator (move a slider and watch the agent react), and a roadmap of new data collection (IoT sensors, weigh-at-pickup, composition scanning, calendar/behaviour, service events) with fallbacks if the data does not exist. |

Use the **Demand scenario** switch (Black Friday, Sinterklaas, Christmas, summer) to see predictive instead of reactive scheduling.

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
