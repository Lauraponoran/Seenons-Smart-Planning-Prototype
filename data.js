/* ------------------------------------------------------------------
   data.js — synthetic demo data (all numbers are ASSUMPTIONS for the prototype)
   Replace with real feeds: disposal-partner reports, sensor MQTT/API, etc.
------------------------------------------------------------------- */

const STREAMS = {
  residual: { label: 'Residual',          color: '#1F4E5A', text: '#FFFFFF', kgPerL: 0.12, co2PerKg: 0 },
  paper:    { label: 'Paper & cardboard', color: '#3C78B4', text: '#FFFFFF', kgPerL: 0.08, co2PerKg: 0.9 },
  glass:    { label: 'Glass',             color: '#8FD3BD', text: '#12343B', kgPerL: 0.35, co2PerKg: 0.3 },
  organic:  { label: 'Organic',           color: '#7DB84F', text: '#10260A', kgPerL: 0.45, co2PerKg: 0.2 },
  pmd:      { label: 'Plastic & cans',    color: '#F4A3B8', text: '#4A1B2B', kgPerL: 0.04, co2PerKg: 1.5 }
};

// type drives the weekday demand pattern (index 0 = Sunday)
const LOCATIONS = [
  { id: 'l1', code: 'AMS', name: 'Amsterdam – Centrum Store',  type: 'Retail',           employees: 24, hours: '09:00–21:00 (7 days)' },
  { id: 'l2', code: 'UTR', name: 'Utrecht – Station Store',    type: 'Retail',           employees: 18, hours: '08:00–20:00 (7 days)' },
  { id: 'l3', code: 'RTM', name: 'Rotterdam – Head Office',    type: 'Office',           employees: 140, hours: '08:00–18:00 (Mon–Fri)' },
  { id: 'l4', code: 'SCH', name: 'Schiphol – Café Kiosk',      type: 'Food & Beverage',  employees: 12, hours: '05:00–22:00 (7 days)' }
];

const WEEKDAY_FACTORS = {
  'Retail':          [1.3, 0.8, 0.8, 0.9, 1.0, 1.3, 1.5],
  'Office':          [0.05, 1.2, 1.2, 1.2, 1.2, 1.0, 0.05],
  'Food & Beverage': [1.3, 0.9, 0.9, 1.0, 1.1, 1.4, 1.5]
};

// rate = average fill gain in % of capacity per day; days = scheduled pickup weekdays (0=Sun)
// audit = % of the residual content that was recyclable at the last (simulated) composition scan
const CONTAINERS = [
  { id: 'c1',  loc: 'l1', stream: 'residual', cap: 660, rate: 22, days: [2, 5],    audit: 26 },
  { id: 'c2',  loc: 'l1', stream: 'paper',    cap: 660, rate: 10, days: [3] },
  { id: 'c3',  loc: 'l1', stream: 'glass',    cap: 240, rate: 4.5, days: [4] },
  { id: 'c4',  loc: 'l2', stream: 'residual', cap: 660, rate: 25, days: [1, 4],    audit: 18 },
  { id: 'c5',  loc: 'l2', stream: 'pmd',      cap: 770, rate: 11, days: [3] },
  { id: 'c6',  loc: 'l3', stream: 'residual', cap: 240, rate: 15, days: [2, 4],    audit: 22 },
  { id: 'c7',  loc: 'l3', stream: 'paper',    cap: 660, rate: 6,  days: [3] },
  { id: 'c8',  loc: 'l3', stream: 'organic',  cap: 140, rate: 14, days: [1, 4] },
  { id: 'c9',  loc: 'l4', stream: 'residual', cap: 660, rate: 28, days: [1, 3, 5], audit: 12 },
  { id: 'c10', loc: 'l4', stream: 'organic',  cap: 240, rate: 26, days: [2, 4, 6] },
  { id: 'c11', loc: 'l4', stream: 'glass',    cap: 240, rate: 5,  days: [5] }
];

// Hidden "truth" used only to generate history: pickups missed more often on some days
function missProbability(locId, weekday) {
  if (locId === 'l1' && weekday === 2) return 0.22; // Amsterdam, Tuesdays
  if (locId === 'l3' && weekday === 4) return 0.18; // Rotterdam, Thursdays
  return 0.04;
}

const MISS_REASONS = ['Container blocked', 'Truck capacity', 'Access locked', 'No driver available', 'Wrong container placed'];

// Demand scenarios = multipliers applied to the forecast fill rate, per location type
const SCENARIOS = {
  normal:    { label: 'No event (normal week)', note: '',                                                        mult: { 'Retail': 1.0,  'Office': 1.0,  'Food & Beverage': 1.0 } },
  blackfri:  { label: 'Black Friday week',      note: 'Retail volumes of packaging and paper spike.',            mult: { 'Retail': 1.6,  'Office': 1.0,  'Food & Beverage': 1.15 } },
  sinter:    { label: 'Sinterklaas season',     note: 'Gift wrapping drives paper and residual in retail.',      mult: { 'Retail': 1.45, 'Office': 0.95, 'Food & Beverage': 1.2 } },
  xmas:      { label: 'Christmas peak',         note: 'Retail and hospitality peak, offices are quiet.',         mult: { 'Retail': 1.5,  'Office': 0.6,  'Food & Beverage': 1.35 } },
  summer:    { label: 'Summer holiday dip',     note: 'Offices run at reduced capacity, hospitality is busy.',   mult: { 'Retail': 0.9,  'Office': 0.55, 'Food & Beverage': 1.3 } }
};

// Business assumptions used for impact estimates (editable)
const ASSUMPTIONS = {
  pickupCost: 38,        // € per collection
  sameDayFee: 25,        // € extra when rescheduled less than 1 day before
  co2PerPickup: 4.2,     // kg CO2 per truck stop
  freeRescheduleDays: 1, // free rescheduling at least 1 day before
  targetFill: 88,        // % — aim to collect below this
  alertFill: 95,         // % — overflow risk threshold
  underfillFill: 32,     // % — pickup considered wasteful below this
  riskMissRate: 0.15,    // weekday miss rate that triggers a "move pickup" suggestion
  safeMissRate: 0.08     // acceptable miss rate for an alternative weekday
};
