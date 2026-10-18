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
