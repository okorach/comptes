const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const {load} = require('./helpers');

const STATIC = path.join(__dirname, '..', '..', 'static');
const read = f => fs.readFileSync(path.join(STATIC, f), 'utf8');

test('the page loads Roboto and Roboto Condensed from the application itself, not from the internet', () => {
  assert.match(read('index.html'), /<link rel="stylesheet" href="\/fonts\.css">/);
  assert.doesNotMatch(read('index.html'), /googleapis|gstatic/);
  const css = read('fonts.css');
  for (const family of ['Roboto', 'Roboto Condensed']) assert.match(css, new RegExp(`font-family: '${family}'`));
  const files = [...css.matchAll(/url\(\/fonts\/([^)]+)\)/g)].map(m => m[1]);
  assert.equal(files.length, 4);
  for (const f of files) assert.ok(fs.statSync(path.join(STATIC, 'fonts', f)).size > 10000, f);
});

test('static text is in Roboto, data (cells, numbers, chart labels, dynamic names) in Roboto Condensed', () => {
  const css = read('style.css');
  assert.match(css, /--font:Roboto,/);
  assert.match(css, /--font-data:"Roboto Condensed",/);
  assert.match(css, /body\{[^}]*font:14px var\(--font\)/);
  assert.match(css, /input,select,button\{[^}]*font-family:var\(--font\)/);   // filters and buttons are labels, not data
  const data = css.match(/(^|\n)([^\n{]+)\{font-family:var\(--font-data\)\}/)[2].split(',');
  for (const sel of ['td', '.d', '.big', 'svg text']) assert.ok(data.includes(sel), sel);
  assert.match(css, /td\.s,td a,td button\{font-family:var\(--font\)\}/);
});

test('names that come from the data are marked as dynamic, fixed labels of tables are not', async () => {
  const {ctx, els} = load(async url => ({json: async () => (url.includes('transactions') ? [] : url.endsWith('/meta') ? {categories: [], currencies: ['EUR'], master_currency: 'EUR'}
    : {account: {id: 'Courant', type: 'Livret', bank: 'B', currency: 'EUR', status: 'Open', mode: 'flow'}, interests: {y1: 0.1}, deposits: []})}));
  await ctx.account('Courant');
  assert.match(els['#main'].innerHTML, /<h2><span class="d">Courant<\/span> <span class="mut d"/);
  assert.match(els['#main'].innerHTML, /<td class="s">1 an<\/td>/);
});
