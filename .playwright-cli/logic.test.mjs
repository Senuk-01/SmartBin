import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
assert.ok(scriptMatch, 'Inline script block must exist in index.html');

const code = scriptMatch[1];
const pureSlice = code.slice(
  code.indexOf('const SCALE = 60;'),
  code.indexOf('// Smooth count-up animation')
);
const routeSlice = code.slice(
  code.indexOf('function distKm(a, b)'),
  code.indexOf('function drawRoute()')
);
const csvSlice = code.slice(
  code.indexOf('function buildCsv(rows)'),
  code.indexOf('document.getElementById("downloadCsvBtn")')
);

const context = {
  Date,
  Math,
  Object,
  String,
  Number,
  DEPOT: { name: 'Depot', lat: 6.9250, lng: 79.8600 }
};
vm.createContext(context);
vm.runInContext(
  pureSlice + '\n' + routeSlice + '\n' + csvSlice + '\nthis.bins = bins; this.collections = collections;',
  context
);

test('statusOf returns distinct green, yellow/amber, red (never theme orange)', () => {
  const ok = context.statusOf({ fill: 20 });
  const soon = context.statusOf({ fill: 60 });
  const now = context.statusOf({ fill: 85 });

  assert.equal(ok.text, 'OK');
  assert.equal(ok.color, '#22c55e');
  assert.equal(soon.text, 'Soon');
  assert.equal(soon.color, '#eab308');
  assert.equal(now.text, 'Collect now');
  assert.equal(now.color, '#ef4444');
  assert.notEqual(soon.color.toLowerCase(), '#fe5101');
});

test('isHot, isLowBatt, isHazard and formatTime behave accurately', () => {
  assert.equal(context.isHot({ temp: 55 }), true);
  assert.equal(context.isHot({ temp: 32 }), false);
  assert.equal(context.isHot({ temp: null }), false);
  assert.equal(context.isLowBatt({ batt: 15 }), true);
  assert.equal(context.isLowBatt({ batt: 80 }), false);
  assert.equal(context.isHazard({ gas: 2600, temp: 25 }), true);
  assert.equal(context.isHazard({ gas: 100, temp: 55 }), true);
  assert.equal(context.isHazard({ gas: 100, temp: 30 }), false);
  assert.equal(context.formatTime(null), '-');
  assert.equal(context.formatTime(0), 'FULL');
  assert.equal(context.formatTime(75), '1 h 15 min');
});

test('record caps at 6 and recordSeries caps at 30 readings', () => {
  const b = { fill: 10, gas: 100, hist: [], series: [] };
  for (let i = 0; i < 35; i++) {
    b.fill = 10 + i;
    context.record(b);
    context.recordSeries(b, '10:00:' + String(i).padStart(2, '0'));
  }
  assert.equal(b.hist.length, 6);
  assert.equal(b.series.length, 30);
  assert.equal(b.series[0].f, 15);
  assert.equal(b.series[29].f, 44);
});

test('isOffline flags ts older than 60s for both ms and s timestamps', () => {
  const now = 1795004741000;
  assert.equal(context.isOffline({ ts: null }, now), false);
  assert.equal(context.isOffline({ ts: now - 30000 }, now), false);
  assert.equal(context.isOffline({ ts: now - 65000 }, now), true);
  assert.equal(context.isOffline({ ts: Math.floor((now - 65000) / 1000) }, now), true);
  assert.equal(context.isOffline({ ts: Math.floor((now - 20000) / 1000) }, now), false);
});

test('getSortedRows sorts hazards first then soonest to full', () => {
  context.bins.bin1.fill = 90; context.bins.bin1.gas = 200; context.bins.bin1.temp = null; context.bins.bin1.hist = [];
  context.bins.bin2.fill = 20; context.bins.bin2.gas = 2700; context.bins.bin2.temp = null; context.bins.bin2.hist = [];
  context.bins.bin3.fill = 70; context.bins.bin3.gas = 200; context.bins.bin3.temp = null;
  context.bins.bin3.hist = [{ h: 1.0, f: 50 }, { h: 2.0, f: 70 }];
  context.bins.bin4.fill = 50; context.bins.bin4.gas = 200; context.bins.bin4.temp = null; context.bins.bin4.hist = [];
  context.bins.bin5.fill = 10; context.bins.bin5.gas = 200; context.bins.bin5.temp = null; context.bins.bin5.hist = [];

  const order = context.getSortedRows().map(r => r.b.id);
  assert.deepEqual(order, ['bin2', 'bin3', 'bin1', 'bin4', 'bin5']);
});

test('planRoute picks only bins needing pickup or hazard in nearest-neighbour order', () => {
  const route = context.planRoute();
  const ids = route.map(b => b.id);
  assert.equal(ids.includes('bin5'), false);
  assert.equal(ids.length, 4);
  assert.ok(context.routeLength(route) > 0);
  assert.ok(context.routeLength(route) <= context.routeLength(Object.values(context.bins)) + 0.5);
});

test('buildCsv outputs proper CSV rows with escaped quotes and collection info', () => {
  context.collections.bin2 = '04:20';
  const rows = context.getSortedRows();
  const csv = context.buildCsv(rows);
  const lines = csv.split('\n');
  assert.equal(lines.length, 6);
  assert.match(lines[0], /^Priority,Bin,Fill %,Gas,Time to full,Status,Connectivity,Last Collected$/);
  assert.match(lines[1], /"Bin 2 \(HAZARD\)".*"Collected at 04:20"/);
});
