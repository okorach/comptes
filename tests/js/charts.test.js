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
  assert.match(tip, /Patrimoine: <b>30 €<\/b>/);
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

test('chart values carry the currency symbol, configurable with opt.unit', () => {
  const {ctx: c, els} = load();
  const mk = opt => {
    const html = c.drawChart(['a', 'b', 'c'], [{name: 'Patrimoine', color: '#000', type: 'line', values: [1000, 123456, 3]}], opt);
    const id = Number(html.match(/id="chart-(\d+)"/)[1]);
    c.chartHover(id, hoverEvent(522));
    return els[`#chart-hover-${id}`].innerHTML;
  };
  assert.match(plain(mk({})), /Patrimoine: <b>123 456 €<\/b>/);
  assert.match(plain(mk({unit: 'CHF'})), /<b>123 456 CHF<\/b>/);
  assert.match(plain(c.drawChart(['a'], [{color: '#000', type: 'bar', values: [2500]}])), /<title>a : 2 500 €<\/title>/);
});

test('a series on the right axis gets its own scale, labels and unit', () => {
  const {ctx: c, els} = load();
  const bars = {name: 'Épargne', color: '#0a0', type: 'bar', axis: 'right', unit: '€/mois', values: [null, 1200, 1500, 900]};
  const line = {name: 'Patrimoine', color: '#00f', type: 'line', values: [1000000, 1100000, 1250000, 1300000]};
  const html = c.drawChart(['a', 'b', 'c', 'd'], [bars, line]);
  assert.match(html, /text-anchor="start"/);
  assert.doesNotMatch(c.drawChart(['a', 'b', 'c', 'd'], [line]), /text-anchor="start"/);
  // right-axis labels use the scale of the bars (hundreds), not the one of the line (millions)
  const startLabels = [...html.matchAll(/text-anchor="start"[^>]*>([^<]*)</g)].map(m => plain(m[1]));
  assert.ok(startLabels.length >= 2 && startLabels.every(l => !l.includes('M')));
  const id = Number(html.match(/id="chart-(\d+)"/)[1]);
  c.chartHover(id, hoverEvent(500));
  const tip = plain(els[`#chart-hover-${id}`].innerHTML);
  assert.match(tip, /Épargne: <b>\d[\d ]* €\/mois<\/b>/);
  assert.match(tip, /Patrimoine: <b>[\d ]+ €<\/b>/);
});

test('with a right axis the sliders and the hover use the wider right margin', () => {
  const {ctx: c} = load();
  const series = [{color: '#0a0', type: 'bar', axis: 'right', values: [1, 2, 3]}, {color: '#00f', type: 'line', values: [1, 2, 3]}];
  assert.match(c.drawChart(['a', 'b', 'c'], series), /margin:0 5\.60% 0 5\.60%/);
  assert.match(lineChart(3), /margin:0 1\.20% 0 5\.60%/);
});

test('chartAlignedTicks gives a round step with the requested number of intervals, starting at 0', () => {
  const t = ctx.chartAlignedTicks(0, 26000, 4);
  assert.deepEqual(Array.from(t.ticks), [0, 10000, 20000, 30000, 40000]);
  assert.equal(t.step, 10000);
  assert.equal(t.lo, 0);
  assert.equal(t.hi, 40000);
});

test('chartAlignedTicks keeps negative values inside the range', () => {
  const t = ctx.chartAlignedTicks(-3000, 9000, 4);
  assert.ok(t.lo <= -3000 && t.hi >= 9000);
  assert.equal(t.ticks.length, 5);
});

test('right axis labels sit on the gridlines of the left axis', () => {
  const {ctx: c} = load();
  const html = c.drawChart(['a', 'b', 'c', 'd'], [
    {color: '#0a0', type: 'bar', axis: 'right', values: [0, 12000, 26000, 9000]},
    {color: '#00f', type: 'line', values: [1000000, 1100000, 1250000, 2000000]}]);
  const ys = re => [...html.matchAll(re)].map(m => Number(m[1]));
  const grid = ys(/<line x1="56"[^>]*y1="([\d.]+)"/g);
  const left = ys(/<text x="50" y="([\d.]+)"/g).map(v => v - 4);
  const right = ys(/<text x="\d+" y="([\d.]+)" font-size="11" text-anchor="start"/g).map(v => v - 4);
  assert.equal(right.length, grid.length);
  right.forEach((y, j) => assert.ok(Math.abs(y - grid[j]) < 1e-6, `right label ${j} at ${y}, gridline at ${grid[j]}`));
  left.forEach((y, j) => assert.ok(Math.abs(y - grid[j]) < 1e-6));
});

test('a chart scrolls sideways on a narrow screen: the plot and its sliders scroll together, the legend stays put', () => {
  const {ctx} = load();
  const html = ctx.drawChart(['a', 'b', 'c', 'd'], [{name: 's', color: '#000', type: 'bar', values: [1, 2, 3, 4]}]);
  const scroll = html.match(/<div class="chart-scroll"><div class="chart-body">(.*?)<\/div><\/div><div class="mut chart-legend">/s);
  assert.ok(scroll);
  assert.match(scroll[1], /chart-plot-\d+[\s\S]*chart-range/);
});

test('niceStep keeps its steps at the edges (1, 2, 2.5, 5 then 10) and niceTicks ends on its last tick', () => {
  assert.equal(ctx.niceStep(5, 5), 1);      // raw step 1
  assert.equal(ctx.niceStep(10, 5), 2);
  assert.equal(ctx.niceStep(12.5, 5), 2.5);
  assert.equal(ctx.niceStep(25, 5), 5);
  assert.equal(ctx.niceStep(26, 5), 10);    // above 5: 10
  const t = ctx.niceTicks(0, 100, 5);
  assert.equal(t.hi, t.ticks[t.ticks.length - 1]);
});
