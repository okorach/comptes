const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const {load} = require('./helpers');

const ROWS = [
  {id: 'Livret A', bank: 'Boursorama', amount: 100, note: 'Épargne'},
  {id: 'PEA', bank: 'ING', amount: -50, note: 'Bourse'},
  {id: 'Courant', bank: 'Boursorama', amount: null, note: 'épargne'},
  {id: 'Compte 10', bank: 'ING', amount: 5, note: ''},
  {id: 'Compte 2', bank: 'LCL', amount: 1000, note: 'Autre'},
];
const COLS = [
  {label: 'Compte', value: r => r.id}, {label: 'Banque', value: r => r.bank},
  {label: 'Montant', num: true, value: r => r.amount}, {label: 'Note', value: r => r.note},
];
const rowHtml = r => `<tr><td>${r.id}</td></tr>`;
const tablesOf = ctx => vm.runInContext('tables', ctx);
const ids = els => [...els.matchAll(/<td>([^<]*)<\/td>/g)].map(m => m[1]);

/* Draws a table and returns what the tests need to drive it */
function setup(cols = COLS, rows = ROWS) {
  const env = load();
  const html = env.ctx.dataTable(cols, rows, rowHtml);
  const id = Number(html.match(/id="tb-(\d+)"/)[1]);
  return {...env, html, id, body: () => env.els['#tb-' + id].innerHTML, count: () => env.els['#tc-' + id].textContent};
}

test('dataTable renders a header with a sort button and a filter on each column, and all the rows', () => {
  const {html} = setup();
  assert.equal((html.match(/class="sort"/g) || []).length, 4);
  assert.match(html, /<tr class="filters">/);
  assert.match(html, /<th class="n">Montant/);
  assert.equal(ids(html).length, ROWS.length);
  assert.match(html, />5 lignes</);
});

test('columns with few distinct values get a drop-down list, others a text search', () => {
  const many = Array.from({length: 40}, (_, i) => ({id: 'C' + i, bank: 'ING', amount: i, note: ''}));
  const {html} = setup(COLS, many);
  const filters = html.slice(html.indexOf('<tr class="filters">'));
  assert.match(filters, /<select aria-label="Filtrer Banque"/);
  assert.match(filters, /<input type="search" aria-label="Filtrer Compte"/);
  assert.match(filters, /<option value="0">ING<\/option>/);
  assert.match(filters, /\(tous\)/);
});

test('a column can opt out of the filter or the sort', () => {
  const cols = [{label: 'A', value: r => r.id, filter: false}, {label: 'B', value: r => r.bank, sort: false}];
  const {html} = setup(cols);
  assert.equal((html.match(/class="sort"/g) || []).length, 1);
  assert.match(html.slice(html.indexOf('<tr class="filters">')), /<th><\/th><th><select/);
});

test('picking a value in a drop-down keeps only the rows with exactly that value', () => {
  const {ctx, id, body, count} = setup();
  const bank = tablesOf(ctx).get(id).cols[1];
  ctx.tableFilter(id, 1, String(bank.options.indexOf('ING')));
  assert.deepEqual(ids(body()), ['PEA', 'Compte 10']);
  assert.equal(count(), '2 / 5 lignes');
  ctx.tableFilter(id, 1, '');  // back to "(tous)"
  assert.equal(ids(body()).length, 5);
  assert.equal(count(), '5 lignes');
});

test('the text search ignores case and accents; the filters of several columns combine', () => {
  const many = Array.from({length: 30}, (_, i) => ({id: 'C' + i, bank: i % 2 ? 'ING' : 'LCL', note: i === 3 ? 'Épargne' : 'x' + i}));
  const cols = [{label: 'Compte', value: r => r.id}, {label: 'Banque', value: r => r.bank}, {label: 'Note', value: r => r.note}];
  const {ctx, id, body} = setup(cols, many);
  ctx.tableFilter(id, 2, 'EPARGNE');
  assert.deepEqual(ids(body()), ['C3']);
  ctx.tableFilter(id, 1, String(tablesOf(ctx).get(id).cols[1].options.indexOf('LCL')));
  assert.match(body(), /Aucune ligne/);
  ctx.tableFilter(id, 2, '  ');
  assert.equal(ids(body()).length, 15);
});

test('sorting cycles ascending, descending, original order, with natural order for text', () => {
  const {ctx, id, body, els} = setup();
  ctx.tableSort(id, 0);
  assert.deepEqual(ids(body()), ['Compte 2', 'Compte 10', 'Courant', 'Livret A', 'PEA']);
  assert.equal(els[`#ts-${id}-0`].textContent, '▲');
  ctx.tableSort(id, 0);
  assert.deepEqual(ids(body()), ['PEA', 'Livret A', 'Courant', 'Compte 10', 'Compte 2']);
  assert.equal(els[`#ts-${id}-0`].textContent, '▼');
  ctx.tableSort(id, 0);
  assert.deepEqual(ids(body()), ROWS.map(r => r.id));
  assert.equal(els[`#ts-${id}-0`].textContent, '⇅');
});

test('numbers sort numerically and empty values stay last in both directions', () => {
  const {ctx, id, body} = setup();
  ctx.tableSort(id, 2);
  assert.deepEqual(ids(body()), ['PEA', 'Compte 10', 'Livret A', 'Compte 2', 'Courant']);
  ctx.tableSort(id, 2);
  assert.deepEqual(ids(body()), ['Compte 2', 'Livret A', 'Compte 10', 'PEA', 'Courant']);
});

test('sorting applies to the filtered rows, and sorting another column restarts at ascending', () => {
  const {ctx, id, body} = setup();
  ctx.tableFilter(id, 1, String(tablesOf(ctx).get(id).cols[1].options.indexOf('Boursorama')));
  ctx.tableSort(id, 0);
  ctx.tableSort(id, 0);
  assert.deepEqual(ids(body()), ['Livret A', 'Courant']);
  ctx.tableSort(id, 2);
  assert.deepEqual(ids(body()), ['Livret A', 'Courant']);
  assert.equal(tablesOf(ctx).get(id).sort.dir, 'asc');
});

test('the home, interests and account pages use filterable tables', async () => {
  const acc = {id: 'A', status: 'Open', type: 'Livret', bank: 'ING', availability: 0, last_date: '2024-01-01', currency: 'EUR', balance_main: 10, balance_native: 10};
  const {ctx, els} = load(async url => ({json: async () => (url.includes('networth') ? [] : url.endsWith('interests') ? [{account: 'A', type: 'Livret', currency: 'EUR', calc_date: '2024-01-01T10:00:00', y1: 0.02}] : [acc])}));
  await ctx.home();
  assert.match(els['#main'].innerHTML, /<table class="data">[\s\S]*Filtrer Banque[\s\S]*>1 comptes</);
  await ctx.interests();
  assert.match(els['#main'].innerHTML, /Filtrer Calculé le/);
  assert.doesNotMatch(els['#main'].innerHTML, /Filtrer 1 an/);
});

test('the filter of a numeric column is right-aligned like its header and values, the others are not', () => {
  const {ctx} = load();
  const html = ctx.dataTable([{label: 'Nom', value: r => r.n}, {label: 'Montant', num: true, value: r => r.v}, {label: 'Solde', num: true, value: r => r.w, filter: 'text'}],
    [{n: 'a', v: 1, w: 3}, {n: 'b', v: 2, w: 4}], () => '');
  const filters = html.match(/<tr class="filters">(.*?)<\/tr>/s)[1];
  assert.match(filters, /^<th><select[^>]*aria-label="Filtrer Nom"/);
  assert.match(filters, /<th class="n"><select[^>]*aria-label="Filtrer Montant"/);
  assert.match(filters, /<th class="n"><input[^>]*aria-label="Filtrer Solde"/);
});
