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
  assert.match(els['#main'].innerHTML, /Filtrer Type/);
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

/* ---- filters with a pop-up: range of dates or amounts, check boxes */
const TX = [
  {id: 'a', date: '2024-01-10', amount: -50, sub: 'Courses', desc: 'Super Marché'},
  {id: 'b', date: '2024-02-10', amount: 10, sub: 'Salaire', desc: 'Virement'},
  {id: 'c', date: '2024-03-10', amount: 10.004, sub: '', desc: 'Café'},
  {id: 'd', date: '2024-03-11', amount: 100, sub: 'Courses', desc: 'marche'},
  {id: 'e', date: '2024-04-01', amount: null, sub: 'Loisirs', desc: null},
];
const TXCOLS = [
  {label: 'Date', filter: 'range', input: 'date', value: r => r.date}, {label: 'Montant', num: true, filter: 'range', value: r => r.amount},
  {label: 'Solde', num: true, filter: false, value: () => 0}, {label: 'Description', filter: 'text', value: r => r.desc}, {label: 'Sous-cat.', filter: 'checks', value: r => r.sub},
];
const apply = (env, id, i, op, a, b = '') => {
  env.ctx.tableOpenFilter(id, i, null);
  env.mk('#fp-op').value = op; env.mk('#fp-a').value = a; env.mk('#fp-b').value = b;
  env.ctx.tableApplyRange(id, i);
};

test('a date or amount filter opens a pop-up form; there is no filter on the balance; the description is a text search; the sub-category has check boxes', () => {
  const env = setup(TXCOLS, TX);
  assert.equal((env.html.match(/class="fbtn"/g) || []).length, 3);                       // date, amount, sub-category
  assert.match(env.html, /id="tfb-\d+-0"[^>]*onclick="tableOpenFilter\(\d+,0,this\)">filtrer/);
  assert.doesNotMatch(env.html, /tfb-\d+-2/);                                              // the balance has none
  assert.match(env.html, /<input type="search"[^>]*aria-label="Filtrer Description"/);   // contains, not a drop-down list
  env.ctx.tableOpenFilter(env.id, 0, null);
  const pop = env.els['#filter-pop'];
  assert.equal(pop.hidden, false);
  assert.match(pop.innerHTML, /À partir du \(inclus\)/);
  assert.match(pop.innerHTML, /Jusqu&#39;au|Jusqu'au \(inclus\)/);
  assert.match(pop.innerHTML, /Entre deux dates \(incluses\)/);
  assert.match(pop.innerHTML, /type="date"/);
  env.ctx.tableOpenFilter(env.id, 1, null);
  assert.match(pop.innerHTML, /Supérieur ou égal à/);
  assert.match(pop.innerHTML, /Entre deux valeurs \(incluses\)/);
  env.ctx.tableOpenFilter(env.id, 1, null);                                                // the same button again closes it
  assert.equal(pop.hidden, true);
});

test('the date filter: from, up to, or between two dates, the limits included', () => {
  const env = setup(TXCOLS, TX);
  apply(env, env.id, 0, 'ge', '2024-03-10');
  assert.deepEqual(ids(env.body()), ['c', 'd', 'e']);
  assert.equal(env.els['#tfb-' + env.id + '-0'].textContent, '≥ 2024-03-10');
  apply(env, env.id, 0, 'le', '2024-02-10');
  assert.deepEqual(ids(env.body()), ['a', 'b']);
  apply(env, env.id, 0, 'between', '2024-02-10', '2024-03-10');
  assert.deepEqual(ids(env.body()), ['b', 'c']);
  apply(env, env.id, 0, 'between', '2024-03-10', '2024-02-10');                          // limits in the wrong order
  assert.deepEqual(ids(env.body()), ['b', 'c']);
  apply(env, env.id, 0, 'ge', 'not a date');
  assert.match(env.els['#fp-err'].textContent, /Date invalide/);
  assert.deepEqual(ids(env.body()), ['b', 'c']);                                           // unchanged
  env.ctx.tableClearFilter(env.id, 0);
  assert.equal(ids(env.body()).length, 5);
  assert.equal(env.els['#tfb-' + env.id + '-0'].textContent, 'filtrer');
});

test('the amount filter: at least, at most, or between two values, the limits included, to the cent, with a comma or a point', () => {
  const env = setup(TXCOLS, TX);
  apply(env, env.id, 1, 'ge', '10');
  assert.deepEqual(ids(env.body()), ['b', 'c', 'd']);                                      // 10.004 counts as 10.00; no amount: never
  apply(env, env.id, 1, 'le', '10,00');
  assert.deepEqual(ids(env.body()), ['a', 'b', 'c']);
  apply(env, env.id, 1, 'between', '-50', '10');
  assert.deepEqual(ids(env.body()), ['a', 'b', 'c']);
  apply(env, env.id, 1, 'between', '11', '1 000');
  assert.deepEqual(ids(env.body()), ['d']);
  apply(env, env.id, 1, 'ge', 'abc');
  assert.match(env.els['#fp-err'].textContent, /Valeur invalide/);
  apply(env, env.id, 1, 'between', '5', '');                                               // the second value is missing
  assert.match(env.els['#fp-err'].textContent, /Valeur invalide/);
});

test('the description filter keeps the transactions that contain the text, whatever the case and the accents', () => {
  const env = setup(TXCOLS, TX);
  env.ctx.tableFilter(env.id, 3, 'MARCH');
  assert.deepEqual(ids(env.body()), ['a', 'd']);
  env.ctx.tableFilter(env.id, 3, 'cafe');
  assert.deepEqual(ids(env.body()), ['c']);
});

test('the sub-category filter has a check box per value; unchecking removes them, all checked is no filter', () => {
  const env = setup(TXCOLS, TX);
  env.ctx.tableOpenFilter(env.id, 4, null);
  const pop = env.els['#filter-pop'].innerHTML;
  assert.equal((pop.match(/type="checkbox" checked/g) || []).length, 4);                   // (vide), Courses, Loisirs, Salaire
  assert.match(pop, /\(vide\)/);
  const values = tablesOf(env.ctx).get(env.id).cols[4].values;
  const k = name => values.indexOf(name);
  env.ctx.tableToggleValue(env.id, 4, k('Courses'), false);
  assert.deepEqual(ids(env.body()), ['b', 'c', 'e']);
  assert.equal(env.els['#tfb-' + env.id + '-4'].textContent, '3 / 4');
  env.ctx.tableToggleValue(env.id, 4, k('Salaire'), false);
  assert.deepEqual(ids(env.body()), ['c', 'e']);
  env.ctx.tableToggleValue(env.id, 4, k('Courses'), true);
  assert.deepEqual(ids(env.body()), ['a', 'c', 'd', 'e']);
  env.ctx.tableToggleValue(env.id, 4, k('Salaire'), true);                                 // all checked again
  assert.equal(ids(env.body()).length, 5);
  assert.equal(env.els['#tfb-' + env.id + '-4'].textContent, 'filtrer');
  env.ctx.tableSetChecks(env.id, 4, []);                                                   // "Aucun"
  assert.match(env.body(), /Aucune ligne/);
  env.ctx.tableOpenFilter(env.id, 4, null);
  env.ctx.tableClearFilter(env.id, 4);                                                     // "Tout"
  assert.equal(ids(env.body()).length, 5);
  assert.equal(env.els['#filter-pop'].hidden, true);
});

test('the filters combine, and Escape or a change of page closes the pop-up', () => {
  const env = setup(TXCOLS, TX);
  apply(env, env.id, 1, 'ge', '10');
  env.ctx.tableToggleValue(env.id, 4, tablesOf(env.ctx).get(env.id).cols[4].values.indexOf('Salaire'), false);
  assert.deepEqual(ids(env.body()), ['c', 'd']);
  env.ctx.tableOpenFilter(env.id, 0, null);
  env.listeners.keydown.forEach(fn => fn({key: 'Escape'}));
  assert.equal(env.els['#filter-pop'].hidden, true);
  env.ctx.tableOpenFilter(env.id, 0, null);
  env.listeners.hashchange.forEach(fn => fn());
  assert.equal(env.els['#filter-pop'].hidden, true);
});

test('the transactions of an account have these filters: no balance filter, a range on the date and the amount', async () => {
  const tx = {id: 1, date: '2024-01-01', amount_main: -5, native_amount: -5, balance_main: 1, description: 'x', in_budget: null};
  const account = {account: {id: 'X', type: 'Courant', bank: 'B', currency: 'EUR', status: 'Open', mode: 'flow'}, interests: null, deposits: []};
  const {ctx, els} = load(async url => ({json: async () => (url.includes('transactions') ? [tx] : url.endsWith('/meta') ? {categories: [], currencies: ['EUR']} : account)}));
  await new Promise(r => setTimeout(r, 10));
  await ctx.account('X');
  const html = els['#main'].innerHTML;
  assert.equal((html.match(/class="fbtn"/g) || []).length, 3);   // date, amount, sub-category
});
