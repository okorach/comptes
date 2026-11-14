const test = require('node:test');
const assert = require('node:assert/strict');
const {load, plain} = require('./helpers');

const json = body => async () => ({json: async () => body});
const FORMAT = {decimal: '.', thousands: ' '};

test('formatNumber groups the thousands and uses the chosen decimal separator', () => {
  const {get} = load(), format = get('formatNumber');
  const f = (d, t) => ({decimal: d, thousands: t});
  assert.equal(format(1234567.891, 2, 2, f('.', ' ')), '1 234 567.89');
  assert.equal(format(1234567.891, 2, 2, f(',', ' ')), '1 234 567,89');
  assert.equal(format(1234567.891, 2, 2, f('.', ',')), '1,234,567.89');
  assert.equal(format(1234567.891, 2, 2, f(',', '.')), '1.234.567,89');
  assert.equal(format(1234567.891, 2, 2, f('.', "'")), "1'234'567.89");
  assert.equal(format(1234567.891, 2, 2, f('.', '')), '1234567.89');          // no thousands separator
  assert.equal(format(1234567.891, 2, 2, f(',', '_')), '1_234_567,89');
});

test('formatNumber handles signs, small numbers, rounding and the number of decimals', () => {
  const {get} = load(), format = get('formatNumber'), f = {decimal: ',', thousands: ' '};
  assert.equal(format(-1234.5, 2, 2, f), '-1 234,50');
  assert.equal(format(-999.994, 2, 2, f), '-999,99');
  assert.equal(format(-100, 2, 2, f), '-100,00');
  assert.equal(format(0, 2, 2, f), '0,00');
  assert.equal(format(999, 2, 2, f), '999,00');
  assert.equal(format(1000, 0, 0, f), '1 000');
  assert.equal(format(1234.5, 0, 0, f), '1 235');       // rounded like the browser does
  assert.equal(format(0.123456, 0, 6, f), '0,123456');
  assert.equal(format(1.5, 0, 6, f), '1,5');            // between 0 and 6 decimals: no trailing zeros
  assert.equal(format(12, 0, 2, f), '12');
  assert.equal(format(1e9, 2, 2, f), '1 000 000 000,00');
});

test('setNumberFormat only accepts valid separators, else keeps the defaults', () => {
  const {get} = load(), set = get('setNumberFormat'), fmt = get('NUMBER_FORMAT');
  set({decimal: ',', thousands: "'"});
  assert.deepEqual({...fmt}, {decimal: ',', thousands: "'"});
  set({decimal: '.', thousands: ''});
  assert.deepEqual({...fmt}, {decimal: '.', thousands: ''});
  for (const thousands of ['<', '>', '&', '"', '5', '+', '-', 'ab', '\n']) {
    set({decimal: ',', thousands});
    assert.equal(fmt.thousands, ' ', JSON.stringify(thousands));   // refused: the default
  }
  set({decimal: ';', thousands: ' '});
  assert.equal(fmt.decimal, '.');                                   // not . or ,
  set({decimal: ',', thousands: ','});
  assert.deepEqual({...fmt}, {decimal: ',', thousands: ''});       // the same character: no thousands separator
  set(undefined);
  assert.deepEqual({...fmt}, {decimal: '.', thousands: ' '});
  set({decimal: ',', thousands: 'é'});
  assert.equal(fmt.thousands, 'é');
});

test('num and pct follow the chosen separators', () => {
  const {get} = load(), set = get('setNumberFormat'), num = get('num'), pct = get('pct');
  set({decimal: '.', thousands: ','});
  assert.equal(plain(num(1234567.891)), '1,234,567.89 €');
  assert.equal(plain(num(-5, 'CHF')), '-5.00 CHF');
  assert.equal(plain(pct(0.123)), '12.3 %');
  set({decimal: ',', thousands: ''});
  assert.equal(plain(num(1234567.891)), '1234567,89 €');
  assert.equal(plain(pct(-0.0456)), '-4,6 %');
});

test('the chart labels and values follow the chosen separators', () => {
  const {ctx, get} = load();
  get('setNumberFormat')({decimal: ',', thousands: ' '});
  assert.equal(ctx.fmtTick(1500000, 500000), '1,5 M');
  assert.equal(ctx.fmtTick(2500, 500), '2,5 k');
  assert.equal(ctx.fmtTick(120, 20), '120');
  get('setNumberFormat')({decimal: '.', thousands: ','});
  assert.equal(ctx.fmtTick(1500000, 500000), '1.5 M');
  assert.equal(ctx.fmtTick(2500, 500), '2.5 k');
  assert.equal(plain(get('chartValue')({opt: {}}, 1234567.4, {unit: '€'})), '1,234,567 €');
});

test('the page applies the format sent by the server, and the spending matrix and the exchange rates use it', async () => {
  const report = {categories: [], series: [{period: '2024-01', spread: 1, raw: 1, avg12: 1}], matrix: {A: {'2024-01': 1234567.4}}, excluded: [], all_categories: ['A']};
  const {ctx, els, mk, get} = load(async url => ({json: async () => (url.includes('spending') ? report : url.includes('fx?') ? [{date: '2024-01-01', rate: 0.934567}]
    : url.includes('meta') ? {categories: [], currencies: ['EUR'], master_currency: 'EUR', number_format: {decimal: '.', thousands: "'"}} : [])}));
  await new Promise(r => setTimeout(r, 10));
  await ctx.spending();
  assert.match(els['#main'].innerHTML, /<td class="n">1'234'567<\/td>/);
  mk('#x_cur').value = 'CHF';
  await ctx.fxList();
  assert.match(els['#fxl'].innerHTML, /<td class="n">0\.934567<\/td>/);
  assert.equal(plain(get('num')(1234.5)), "1'234.50 €");
});

test('the administration page shows the format, a preview, and saves the chosen separators', async () => {
  const calls = [];
  const {ctx, els, mk} = load(async (url, init) => {
    calls.push({url, body: init?.body && JSON.parse(init.body)});
    return {json: async () => (url.endsWith('/meta') ? {categories: [], types: [], banks: [], currencies: ['EUR'], master_currency: 'EUR', number_format: {decimal: ',', thousands: '.'}} : [])};
  });
  await new Promise(r => setTimeout(r, 10));
  await ctx.admin();
  const html = els['#main'].innerHTML;
  assert.match(html, /<b>Format des nombres<\/b>/);
  assert.match(html, /<option value=","  ?selected>virgule/);            // the current decimal separator is selected
  assert.match(html, /<option value="\.">point/);
  assert.match(html, /id="nf_th" size="3" value="\."/);                // the current thousands separator
  mk('#nf_dec').value = ',';
  mk('#nf_th').value = '.';
  ctx.numberFormatPreview();
  assert.equal(plain(els['#nf_preview'].textContent), '-1.234.567,89 €');
  mk('#nf_dec').value = '.';
  mk('#nf_th').value = '';
  ctx.numberFormatPreview();
  assert.equal(plain(els['#nf_preview'].textContent), '-1234567.89 €');
  mk('#nf_th').value = ' ';
  await ctx.setNumberFormatting();
  const post = calls.find(c => c.url.endsWith('/number_format'));
  assert.deepEqual(post.body, {decimal: '.', thousands: ' '});          // a space is kept, not trimmed
  assert.match(els['#main'].innerHTML, /Format des nombres modifié/);
});

test('a refusal of the server is shown in the format card', async () => {
  const {ctx, els, mk} = load(async (url, init) => ({json: async () => (init?.method === 'POST' ? {error: 'Les séparateurs décimal et des milliers doivent être différents'} : url.endsWith('/meta') ? {categories: [], types: [], banks: [], currencies: ['EUR'], master_currency: 'EUR'} : [])}));
  await new Promise(r => setTimeout(r, 10));
  await ctx.admin();
  mk('#nf_dec').value = '.';
  mk('#nf_th').value = '.';
  await ctx.setNumberFormatting();
  assert.match(els['#nf_err'].textContent, /doivent être différents/);
});
