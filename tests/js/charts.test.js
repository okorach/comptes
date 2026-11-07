const test = require('node:test');
const assert = require('node:assert/strict');
const {load, plain} = require('./helpers');

const {ctx} = load();

test('niceStep rounds the raw step to 1, 2, 2.5, 5 or 10 times a power of ten', () => {
  assert.equal(ctx.niceStep(100, 5), 20);
  assert.equal(ctx.niceStep(50, 5), 10);
  assert.equal(ctx.niceStep(125, 5), 25);
  assert.equal(ctx.niceStep(400, 5), 100);
  assert.equal(ctx.niceStep(900, 5), 200);
});

test('niceTicks covers the data range with evenly spaced round values', () => {
  const t = ctx.niceTicks(3, 97, 5);
  assert.equal(t.step, 20);
  assert.equal(t.lo, 0);
  assert.equal(t.hi, 100);
  assert.deepEqual(Array.from(t.ticks), [0, 20, 40, 60, 80, 100]);
});

test('niceTicks handles a flat series', () => {
  const t = ctx.niceTicks(5, 5);
  assert.ok(t.lo <= 5 && t.hi >= 5);
  assert.ok(t.ticks.length >= 2);
});

test('niceTicks handles negative values', () => {
  const t = ctx.niceTicks(-50, 50, 4);
  assert.ok(t.lo <= -50 && t.hi >= 50);
  assert.ok(t.ticks.includes(0));
});

test('fmtTick abbreviates thousands and millions', () => {
  assert.equal(plain(ctx.fmtTick(500, 100)), '500');
  assert.equal(plain(ctx.fmtTick(2000, 1000)), '2 k');
  assert.equal(plain(ctx.fmtTick(2500000, 500000)), '2,5 M');
  assert.equal(plain(ctx.fmtTick(-3000, 1000)), '-3 k');
});

test('drawChart returns a placeholder without data', () => {
  assert.match(ctx.drawChart([], []), /Aucune donnée/);
  assert.match(ctx.drawChart(['a'], [{name: 's', color: '#000', type: 'line', values: [null]}]), /Aucune donnée/);
});

test('drawChart renders an svg for line and bar series', () => {
  const labels = ['2024-01', '2024-02', '2024-03'];
  const line = ctx.drawChart(labels, [{name: 'a', color: '#123456', type: 'line', values: [1, 2, 3]}]);
  const bar = ctx.drawChart(labels, [{name: 'b', color: '#654321', type: 'bar', values: [-1, 2, 3]}]);
  for (const out of [line, bar]) {
    assert.match(out, /<svg/);
    assert.match(out, /2024-01/);
  }
  assert.match(line, /#123456/);
  assert.match(bar, /<rect/);
});

test('drawChart adds a gradient shadow and a drop shadow under each line, with unique ids per chart', () => {
  const series = [{name: 'a', color: '#123456', type: 'line', values: [1, 2, 3]}];
  const a = ctx.drawChart(['x', 'y', 'z'], series), b = ctx.drawChart(['x', 'y', 'z'], series);
  assert.match(a, /<linearGradient/);
  assert.match(a, /<feDropShadow/);
  assert.match(a, /fill="url\(#cg\d+_\d+\)"/);
  assert.notEqual(a.match(/id="(cg\d+_\d+)"/)[1], b.match(/id="(cg\d+_\d+)"/)[1]);
});

test('drawChart leaves a gap in the shadow where values are missing', () => {
  const out = ctx.drawChart(['a', 'b', 'c', 'd', 'e'], [{name: 's', color: '#000', type: 'line', values: [1, 2, null, 3, 4]}]);
  assert.equal(out.match(/fill="url\(#cg\d+_\d+\)"/g).length, 2);
});

const lineChart = n => ctx.drawChart(Array.from({length: n}, (_, i) => `L${i}`), [{name: 's', color: '#123456', type: 'line', values: Array.from({length: n}, (_, i) => i * 10)}]);

test('drawChart adds two time window sliders under the axis when there are enough points', () => {
  const html = lineChart(10);
  assert.equal(html.match(/type="range"/g).length, 2);
  assert.match(html, /aria-label="Début"/);
  assert.match(html, /aria-label="Fin"/);
  assert.match(html, /L0 → L9/);
  assert.doesNotMatch(ctx.drawChart(['a', 'b'], [{name: 's', color: '#000', type: 'line', values: [1, 2]}]), /type="range"/);
});

test('chartRange narrows the chart to the selected window and rescales the axis', () => {
  const {ctx: c, els} = load();
  const html = c.drawChart(['a', 'b', 'c', 'd', 'e', 'f'], [{name: 's', color: '#123456', type: 'line', values: [0, 10, 20, 30, 40, 1000]}]);
  const id = Number(html.match(/id="chart-(\d+)"/)[1]);
  c.chartRange(id, 'from', 1);
  c.chartRange(id, 'to', 3);
  const svg = els[`#chart-plot-${id}`].innerHTML;
  assert.match(svg, /<svg/);
  assert.doesNotMatch(svg, />f</);
  assert.doesNotMatch(svg, /1 k/);
  assert.equal(els[`#chart-win-${id}`].textContent, 'b → d');
  assert.equal(els[`#chart-from-${id}`].value, 1);
  assert.equal(els[`#chart-to-${id}`].value, 3);
});

test('chartRange keeps at least two points in the window', () => {
  const {ctx: c, els} = load();
  const id = Number(c.drawChart(['a', 'b', 'c', 'd'], [{name: 's', color: '#000', type: 'bar', values: [1, 2, 3, 4]}]).match(/id="chart-(\d+)"/)[1]);
  c.chartRange(id, 'from', 3);
  assert.equal(els[`#chart-from-${id}`].value, 2);
  c.chartRange(id, 'to', 0);
  assert.equal(els[`#chart-to-${id}`].value, 3);
  assert.equal(els[`#chart-win-${id}`].textContent, 'c → d');
});

function hoverEvent(clientX){
  return {clientX, currentTarget: {getBoundingClientRect: () => ({left: 0, width: 1000})}};
}

test('chartHover shows the value of the data point below the mouse', () => {
  const {ctx: c, els} = load();
  const html = c.drawChart(['a', 'b', 'c', 'd', 'e'], [{name: 'Patrimoine', color: '#123456', type: 'line', values: [10, 20, 30, 40, 50]}]);
  const id = Number(html.match(/id="chart-(\d+)"/)[1]);
  assert.match(html, /onmousemove="chartHover\(\d+,event\)"/);
  // x = 56 + 932 / 2 = 522 is the middle point (index 2)
  c.chartHover(id, hoverEvent(522));
  const tip = els[`#chart-hover-${id}`].innerHTML;
  assert.match(tip, /class="chart-tip"/);
  assert.match(tip, /<div class="mut">c<\/div>/);
  assert.match(tip, /Patrimoine : <b>30<\/b>/);
  assert.match(tip, /class="chart-dot"/);
  c.chartHover(id, hoverEvent(5000));
  assert.equal(els[`#chart-hover-${id}`].innerHTML, '');
  c.chartHover(id, hoverEvent(522));
  c.chartLeave(id);
  assert.equal(els[`#chart-hover-${id}`].innerHTML, '');
});

test('chartHover follows the time window and escapes labels', () => {
  const {ctx: c, els} = load();
  const html = c.drawChart(['<i>a</i>', 'b', 'c', 'd'], [{name: 's', color: '#000', type: 'bar', values: [1, 2, 3, 4]}]);
  const id = Number(html.match(/id="chart-(\d+)"/)[1]);
  c.chartHover(id, hoverEvent(56));
  assert.match(els[`#chart-hover-${id}`].innerHTML, /&lt;i&gt;a&lt;\/i&gt;/);
  assert.doesNotMatch(els[`#chart-hover-${id}`].innerHTML, /chart-dot/);
  c.chartRange(id, 'from', 2);
  c.chartHover(id, hoverEvent(56));
  assert.match(els[`#chart-hover-${id}`].innerHTML, /<div class="mut">c<\/div>/);
});
