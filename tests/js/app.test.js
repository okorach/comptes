const test = require('node:test');
const assert = require('node:assert/strict');
const {load, plain} = require('./helpers');

const json = body => async () => ({json: async () => body});

test('esc escapes HTML special characters and tolerates null', () => {
  const esc = load().get('esc');
  assert.equal(esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(42), '42');
});

test('jsq escapes quotes and backslashes for inline JS string literals', () => {
  const jsq = load().get('jsq');
  assert.equal(jsq("l'a"), "l\\'a");
  assert.equal(jsq('a\\b'), 'a\\\\b');
  assert.equal(jsq('a"b<c&d'), 'a&quot;b&lt;c&amp;d');
  assert.equal(jsq('a\nb'), 'a\\nb');
});

test('enc url-encodes account ids', () => {
  assert.equal(load().get('enc')('PEE Volvo/1'), 'PEE%20Volvo%2F1');
});

test('sym maps known currencies and falls back to the code', () => {
  const sym = load().get('sym');
  assert.equal(sym('EUR'), '€');
  assert.equal(sym('USD'), '$');
  assert.equal(sym('GBP'), '£');
  assert.equal(sym('JPY'), 'JPY');
});

test('cls flags negative numbers only', () => {
  const cls = load().get('cls');
  assert.equal(cls(-1), 'neg');
  assert.equal(cls(0), '');
  assert.equal(cls(5), '');
});

test('num formats with French separators and 2 decimals', () => {
  const num = load().get('num');
  assert.equal(plain(num(1234.5)), '1 234,50 €');
  assert.equal(plain(num(12, 'CHF')), '12,00 CHF');
  assert.equal(num(null), '');
});

test('pct formats ratios as percentages', () => {
  const pct = load().get('pct');
  assert.equal(plain(pct(0.0512)), '5,1 %');
  assert.equal(pct(null), '–');
});

test('b64 encodes buffers, including larger than one chunk', () => {
  const {ctx} = load();
  assert.equal(ctx.b64(Buffer.from('hello')), Buffer.from('hello').toString('base64'));
  const big = Buffer.alloc(0x8000 * 2 + 17, 7);
  assert.equal(ctx.b64(big), big.toString('base64'));
});

test('api returns the parsed body and sends JSON requests', async () => {
  let call;
  const {ctx} = load(async (url, opts) => { if (url === '/api/thing') call = {url, opts}; return {json: async () => ({ok: 1})}; });  // the page itself loads data when the script starts
  const res = await ctx.api('thing', 'POST', {a: 1});
  assert.equal(res.ok, 1);
  assert.equal(call.url, '/api/thing');
  assert.equal(call.opts.method, 'POST');
  assert.equal(call.opts.body, '{"a":1}');
});

test('api throws when the server reports an error', async () => {
  const {ctx} = load(json({error: 'boom'}));
  await assert.rejects(() => ctx.api('x'), /boom/);
});

test('route renders server errors as text, not HTML', async () => {
  const {ctx, els} = load(json({error: '<img src=x onerror=alert(1)>'}));
  ctx.location.hash = '#/spending';
  await ctx.route();
  const [err] = els['#main'].children;
  assert.equal(err.className, 'err');
  assert.equal(err.textContent, 'Erreur : <img src=x onerror=alert(1)>');
  assert.equal(els['#main'].innerHTML, 'Chargement…');
});

test('account page escapes untrusted values in text and in inline handlers', async () => {
  const evil = '"><img src=x onerror=alert(1)>&quot;+alert(2)+&quot;';
  const tx = {id: 7, date: '<b>2024</b>', amount_main: 1, balance_main: 1, description: evil, subcategory: evil, in_budget: '<i>1</i>'};
  const account = {account: {id: evil, type: 'Courant', bank: evil, currency: 'EUR', status: 'Open', mode: 'flow'}, interests: null, deposits: []};
  const meta = {categories: [{subcategory: evil}], currencies: ['EUR']};
  const body = url => (url.includes('transactions') ? [tx] : url.endsWith('/meta') ? meta : account);
  const {ctx, els} = load(async url => ({json: async () => body(url)}));
  await ctx.account('x', '<u>msg</u>');
  const html = els['#main'].innerHTML;
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /<b>2024|<i>1<|<u>msg/);
  const edit = html.match(/onclick="editTx\(([^"]*)\)"/)[1];
  const decoded = edit.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  assert.equal(JSON.parse(decoded).description, evil);
});

test('monthlySavings is the average monthly growth over the previous 24 months, rounded to 100', () => {
  const {ctx, get} = load();
  const totals = Array.from({length: 27}, (_, i) => 1000000 + i * 1234);
  const s = ctx.monthlySavings(totals);
  assert.equal(s.length, 27);
  assert.ok(s.slice(0, 24).every(v => v === null));
  assert.equal(s[24], 1200);  // (24 * 1234) / 24 = 1234 -> 1200
  assert.equal(get('SAVINGS_MONTHS'), 24);
  assert.equal(ctx.monthlySavings([100, null, 300], 1)[1], null);
  assert.equal(ctx.monthlySavings([100, null, 300], 1)[2], null);
  assert.equal(ctx.monthlySavings([0, 1234, 1234, 4000], 1)[1], 1200);
});

test('monthlySavings is floored at 0 when the net worth decreases', () => {
  const s = load().ctx.monthlySavings([5000, 1000, 1000, 3000], 1);
  assert.equal(s[1], 0);
  assert.equal(s[2], 0);
  assert.equal(s[3], 2000);
});

test('the right axis of the home chart starts at 0 when the savings are floored at 0', () => {
  const {ctx} = load();
  const savings = ctx.monthlySavings([5000, 1000, 1000, 3000], 1);
  const html = ctx.drawChart(['a', 'b', 'c', 'd'], [
    {color: '#0a0', type: 'bar', axis: 'right', values: savings},
    {color: '#00f', type: 'line', values: [5000, 1000, 1000, 3000]}]);
  const labels = [...html.matchAll(/text-anchor="start"[^>]*>([^<]*)</g)].map(m => m[1]);
  assert.equal(labels[0], '0');
  assert.ok(labels.every(l => !l.startsWith('-')));
});

test('rateHtml shows the yield in EUR followed by the yield in the account currency', () => {
  const rateHtml = load().get('rateHtml');
  const eur = plain(rateHtml(0.123, 0.041, 'CHF'));
  assert.match(eur, /12,3 %<\/span> <small class="mut " title="[^"]*CHF[^"]*">4,1 % CHF<\/small>/);
  assert.doesNotMatch(plain(rateHtml(0.123, 0.041, 'EUR')), /small/);
  assert.doesNotMatch(plain(rateHtml(0.123, null, 'CHF')), /small/);
  assert.match(plain(rateHtml(0.05, -0.02, 'USD')), /<small class="mut neg"/);
  assert.match(rateHtml(null, 0.1, 'CHF'), /–/);
});

test('rateCells renders one cell per period', () => {
  const rateCells = load().get('rateCells');
  const cells = rateCells({y1: 0.1, n1: 0.05, y3: null, n3: null, y5: 0.2, n5: 0.1, y8: null, n8: null, y_all: 0.3, n_all: 0.2, currency: 'CHF'});
  assert.equal(cells.match(/<td class="n">/g).length, 5);
  assert.equal(cells.match(/<small/g).length, 3);
});

const FX_ACCOUNT = {account: {id: 'Suisse', type: 'Courant', bank: 'B', currency: 'CHF', status: 'Open', mode: 'flow'}, interests: null, deposits: []};
const FX_META = {categories: [], currencies: ['CHF', 'USD', 'EUR', 'USD']};
const fxPage = txs => load(async url => ({json: async () => (url.includes('transactions') ? txs : url.endsWith('/meta') ? FX_META : FX_ACCOUNT)}));
const TX = {id: 1, date: '2024-01-01', amount_main: -80, balance_main: -80, native_amount: -160, native_balance: -160, description: 'US', in_budget: null};

test('account page of a flow account offers an original amount in another currency, without the currency of the account', async () => {
  const {ctx, els} = fxPage([TX]);
  await ctx.account('Suisse');
  const html = els['#main'].innerHTML;
  const options = html.match(/id="f_fxc">(.*?)<\/select>/)[1];
  assert.match(options, /<option>USD<\/option>/);
  assert.match(options, /<option>EUR<\/option>/);
  assert.doesNotMatch(options, /CHF/);
  assert.equal(options.match(/USD/g).length, 1);
  assert.match(html, /id="f_fxa"/);
});

test('balance and snapshot accounts do not take an original amount', async () => {
  const {ctx, els} = load(async url => ({json: async () => (url.includes('transactions') ? [] : url.endsWith('/meta') ? FX_META : {...FX_ACCOUNT, account: {...FX_ACCOUNT.account, mode: 'snapshot'}})}));
  await ctx.account('Suisse');
  assert.doesNotMatch(els['#main'].innerHTML, /f_fxa/);
});

test('transactions table shows the original amount and currency next to the amount in the account currency', async () => {
  const {ctx, els} = fxPage([{...TX, fx_currency: 'USD', fx_amount: -100, fx_auto: 1}, {...TX, id: 2, fx_currency: null, fx_amount: null}]);
  await ctx.account('Suisse');
  const html = els['#main'].innerHTML;
  assert.match(html, /Montant CHF[\s\S]*Solde CHF[\s\S]*Montant d'origine[\s\S]*Devise d'origine[\s\S]*Description/);
  const row = plain(html.match(/<tr id="tx-1"><td>2024-01-01<\/td>.*?<\/tr>/s)[0]);
  assert.match(row, /-160,00[\s\S]*-160,00[\s\S]*-100,00\s*<\/td><td>USD<\/td><td>US/);
});

test('the original amount columns only appear once a transaction has one', async () => {
  const {ctx, els} = fxPage([TX]);
  await ctx.account('Suisse');
  assert.doesNotMatch(els['#main'].innerHTML, /Montant d'origine<\/th>|Montant d'origine <button/);
});

test('editing a converted transaction leaves the amount empty so that it is converted again', async () => {
  const {ctx, els} = fxPage([]);
  await ctx.account('Suisse');
  ctx.editTx({...TX, fx_currency: 'USD', fx_amount: -100, fx_auto: 1});
  assert.equal(els['#f_amt'].value, '');
  assert.equal(els['#f_fxc'].value, 'USD');
  assert.equal(els['#f_fxa'].value, -100);
  ctx.editTx({...TX, fx_currency: 'USD', fx_amount: -100, fx_auto: 0, native_amount: -165});
  assert.equal(els['#f_amt'].value, -165);
});

test('saving sends the original amount and currency', async () => {
  const calls = [];
  const {ctx, mk} = load(async (url, init) => {
    calls.push({url, body: init?.body && JSON.parse(init.body)});
    return {json: async () => (url.includes('transactions') ? [] : url.endsWith('/meta') ? FX_META : FX_ACCOUNT)};
  });
  await ctx.account('Suisse');
  mk('#f_date').value = '2024-03-01';
  mk('#f_fxc').value = 'USD';
  mk('#f_fxa').value = '-100';
  await ctx.saveTx('Suisse');
  const post = calls.find(c => c.body && c.body.date === '2024-03-01');
  assert.equal(post.body.fx_currency, 'USD');
  assert.equal(post.body.fx_amount, '-100');
});

/* ---------------------------------------------------------------- master currency of the application */
// the page loads its own data when the script starts: let it finish before driving another page
const settle = () => new Promise(r => setTimeout(r, 10));
const masterPage = (master, extra = {}) => load(async url => {
  const body = {
    accounts: [{id: 'Courant', status: 'Open', type: 'Courant', bank: 'B', availability: 0, last_date: '2024-01-01', currency: 'EUR', balance_main: 200, balance_native: 100},
               {id: 'Suisse', status: 'Open', type: 'Courant', bank: 'B', availability: 0, last_date: '2024-01-01', currency: 'CHF', balance_main: 200, balance_native: 200}],
    meta: {categories: [], currencies: ['CHF', 'USD', 'EUR', 'USD'], master_currency: master, types: [], banks: []},
    networth: [], interests: [],
  };
  const key = Object.keys(body).find(k => url.includes(k));
  return {json: async () => (extra[key] ?? body[key] ?? {})};
});

test('amounts are shown in the master currency of the application', async () => {
  const {ctx, els} = masterPage('CHF');
  await ctx.home();
  const html = plain(els['#main'].innerHTML);
  assert.match(html, /Solde CHF/);
  assert.doesNotMatch(html, /Solde €/);
  assert.match(html, /200,00 CHF/);
});

test('only the accounts that are not in the master currency show their balance in their own currency', async () => {
  const {ctx, els} = masterPage('CHF');
  await ctx.home();
  const rows = plain(els['#main'].innerHTML).match(/<tr class="click".*?<\/tr>/gs);
  assert.match(rows.find(r => r.includes('Courant')), /200,00 CHF<\/td><td class="n mut">100,00 €<\/td>/);   // EUR account: native balance shown, after the balance in the master currency
  const heads = [...els['#main'].innerHTML.match(/<table class="data"><thead><tr>(.*?)<\/tr>/s)[1].matchAll(/<th[^>]*>([^<]*?)(?: <button|<\/th>)/g)].map(m => m[1]);
  assert.deepEqual(heads, ['Compte', 'Solde CHF', 'Solde (devise)', 'Type', 'Banque']);
  assert.doesNotMatch(rows.find(r => r.includes('Suisse')), /<td class="n mut">[^<\s]/);                // CHF account: it is the master currency
});

test('the home chart is in the master currency', async () => {
  const {ctx, els} = masterPage('USD', {networth: [{month: '2024-01', total: 5}, {month: '2024-02', total: 6}]});
  await ctx.home();
  assert.equal(plain(els['#main'].innerHTML).match(/\$/g).length > 0, true);
  assert.doesNotMatch(els['#main'].innerHTML, /Patrimoine: [\d  ]+ €/);
});

test('account page: the amount columns follow the master currency', async () => {
  const {ctx, els} = load(async url => ({json: async () => (url.includes('transactions') ? [] : url.endsWith('/meta') ? {categories: [], currencies: ['EUR'], master_currency: 'CHF'} : {...FX_ACCOUNT, account: {...FX_ACCOUNT.account, currency: 'EUR'}})}));
  await ctx.account('Courant');
  const html = els['#main'].innerHTML;
  assert.match(html, /Montant CHF[\s\S]*Solde CHF[\s\S]*Montant €[\s\S]*Solde €/);  // master currency columns, then the ones of the EUR account
  const same = load(async url => ({json: async () => (url.includes('transactions') ? [] : url.endsWith('/meta') ? {categories: [], currencies: ['CHF'], master_currency: 'CHF'} : FX_ACCOUNT)}));
  await same.ctx.account('Suisse');
  assert.equal((same.els['#main'].innerHTML.match(/>Montant CHF </g) || []).length, 1);  // no duplicated native columns
});

test('administration page lets the master currency be changed, and reloads everything', async () => {
  const calls = [];
  const {ctx, els, mk} = load(async (url, init) => {
    calls.push({url, body: init?.body && JSON.parse(init.body)});
    return {json: async () => (url.endsWith('/meta') ? {categories: [], types: [], banks: [], currencies: ['CHF', 'USD', 'EUR'], master_currency: 'CHF'} : [])};
  });
  await settle();
  await ctx.admin();
  assert.match(els['#main'].innerHTML, /<option selected>CHF<\/option>/);
  mk('#m_cur').value = 'USD';
  await ctx.setMaster();
  assert.deepEqual(calls.find(c => c.url === '/api/master_currency').body, {currency: 'USD'});
  assert.match(els['#main'].innerHTML, /Devise principale modifiée/);
});

test('administration page shows the refusal of an unknown master currency', async () => {
  const {ctx, els, mk} = load(async url => ({json: async () => (url.endsWith('/meta') ? {categories: [], types: [], banks: [], currencies: ['EUR'], master_currency: 'EUR'} : url.endsWith('master_currency') ? {error: 'no FX rates for JPY'} : [])}));
  await settle();
  await ctx.admin();
  mk('#m_cur').value = 'JPY';
  await ctx.setMaster();
  assert.match(els['#m_err'].textContent, /no FX rates for JPY/);
});

test('a master currency that is not a currency code is ignored', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const {ctx, els} = masterPage(evil, {networth: [{month: '2024-01', total: 5}, {month: '2024-02', total: 6}]});
  await ctx.home();
  assert.doesNotMatch(els['#main'].innerHTML, /<img/);
  assert.match(els['#main'].innerHTML, /Solde €/);
});

test('administration page retrieves the exchange rates from the internet on demand and shows the outcome', async () => {
  const calls = [];
  const {ctx, els} = load(async (url, init) => {
    calls.push({url, method: init?.method});
    if (url.endsWith('/meta')) return {json: async () => ({categories: [], types: [], banks: [], currencies: ['CHF', 'EUR'], master_currency: 'EUR'})};
    return {json: async () => (url.endsWith('fx/refresh') ? {added: 3, currencies: {CHF: 3}, errors: [], offline: false, message: '3 taux de change ajoutés <b>(CHF : 3)</b>'} : [])};
  });
  await settle();
  await ctx.admin();
  assert.match(els['#main'].innerHTML, /onclick="refreshRates\(\)"/);
  await ctx.refreshRates();
  assert.ok(calls.some(c => c.url === '/api/fx/refresh' && c.method === 'POST'));
  assert.match(els['#main'].innerHTML, /3 taux de change ajoutés &lt;b&gt;/);   // the message is text, not HTML
});

test('a failed update of the exchange rates is shown', async () => {
  const {ctx, els} = load(async url => ({json: async () => (url.endsWith('/meta') ? {categories: [], types: [], banks: [], currencies: ['EUR'], master_currency: 'EUR'} : url.endsWith('fx/refresh') ? {error: 'boom'} : [])}));
  await settle();
  await ctx.admin();
  await ctx.refreshRates();
  assert.match(els['#fx_status'].textContent, /boom/);
});

/* ---------------------------------------------------------------- search of transactions */
const FOUND = [
  {id: 7, account: 'Suisse', currency: 'CHF', date: '2024-02-20', amount_main: 100, native_amount: 200, fx_currency: null, fx_amount: null, description: 'Virement <b>', subcategory: 'Paie', category: 'Salaire'},
  {id: 8, account: 'Courant', currency: 'EUR', date: '2024-01-10', amount_main: -50, native_amount: -50, fx_currency: 'USD', fx_amount: -55, description: 'Hotel', subcategory: null, category: null},
];
const searchApp = (rows = FOUND, calls = []) => load(async url => {
  calls.push(url);
  const body = url.includes('/search') ? {rows, total: rows.length, truncated: false} : url.includes('/meta') ? {categories: [{category: 'Salaire', subcategory: 'Paie'}, {category: 'Divers', subcategory: 'Loisirs'}], currencies: ['EUR'], master_currency: 'EUR'}
    : url.includes('accounts') ? [{id: 'Courant'}, {id: 'Suisse'}] : {};
  return {json: async () => body};
});

test('the search page offers every criterion: text, account, category, dates and amounts', async () => {
  const {ctx, els} = searchApp();
  await ctx.searchPage();
  const html = els['#main'].innerHTML;
  for (const id of ['s_text', 's_account', 's_category', 's_subcategory', 's_date_from', 's_date_to', 's_amount_min', 's_amount_max']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /<option>Courant<\/option><option>Suisse<\/option>/);
  assert.match(html, /id="s_category"><option value="">\(tous\)<\/option><option>Divers<\/option><option>Salaire<\/option>/);
});

test('searching sends only the filled criteria and links each result to its transaction in its account', async () => {
  const calls = [];
  const {ctx, els, mk} = searchApp(FOUND, calls);
  await ctx.searchPage();
  mk('#s_text').value = ' café ';
  mk('#s_amount_min').value = '12,5';
  await ctx.searchRun();
  assert.ok(calls.includes('/api/search?text=caf%C3%A9&amount_min=12%2C5'));
  const html = plain(els['#s_res'].innerHTML);
  assert.match(html, /href="#\/account\/Suisse\/tx\/7">voir<\/a>/);
  assert.match(html, /location\.hash='#\/account\/Courant\/tx\/8'/);
  assert.match(html, /Montant du compte[\s\S]*Montant d'origine/);   // a CHF account, and an original amount
  assert.match(html, /200,00 CHF/);
});

test('the search results escape the texts and encode the account in the link', async () => {
  const {ctx, els} = searchApp([{...FOUND[0], account: 'A b/c', description: '<img src=x onerror=alert(1)>'}]);
  await ctx.searchPage();
  await ctx.searchRun();
  const html = els['#s_res'].innerHTML;
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /#\/account\/A%20b%2Fc\/tx\/7/);
});

test('no result, a truncated result and an error are said', async () => {
  const empty = searchApp([]);
  await empty.ctx.searchPage();
  await empty.ctx.searchRun();
  assert.match(empty.els['#s_res'].innerHTML, /Aucune écriture trouvée/);
  const {ctx, els} = load(async url => ({json: async () => (url.includes('/search') ? {rows: FOUND, total: 900, truncated: true} : url.includes('/meta') ? {categories: [], master_currency: 'EUR'} : [])}));
  await ctx.searchPage();
  await ctx.searchRun();
  assert.match(els['#s_res'].innerHTML, /900 écritures correspondent : les 2 plus récentes/);
  const failing = load(async url => ({json: async () => (url.includes('/search') ? {error: 'Date de début invalide : hier'} : url.includes('/meta') ? {categories: [], master_currency: 'EUR'} : [])}));
  await failing.ctx.searchPage();
  await failing.ctx.searchRun();
  assert.equal(failing.els['#s_err'].textContent, 'Date de début invalide : hier');
});

test('coming back to the search page runs the previous search again, and clearing forgets it', async () => {
  const calls = [];
  const {ctx, els, mk} = searchApp(FOUND, calls);
  await ctx.searchPage();
  mk('#s_text').value = 'hotel';
  await ctx.searchRun();
  calls.length = 0;
  await ctx.searchPage();
  assert.ok(calls.includes('/api/search?text=hotel'));
  assert.match(els['#main'].innerHTML, /id="s_text" value="hotel"/);
  mk('#s_text').value = '';
  await ctx.searchPage();   // the fields are re-created empty by the page
  await ctx.searchClear();
  calls.length = 0;
  await ctx.searchPage();
  assert.deepEqual(calls.filter(u => u.includes('/search')), []);
});

test('the route #/account/<id>/tx/<n> shows the account with transaction n highlighted and a way back to the search', async () => {
  const calls = [];
  const {ctx, els} = load(async url => {
    calls.push(url);
    return {json: async () => (url.includes('transactions') ? [{...TX, id: 1}, {...TX, id: 3, description: 'cherchée'}] : url.endsWith('/meta') ? FX_META : FX_ACCOUNT)};
  });
  await ctx.account('Suisse', '', 3);
  assert.ok(calls.includes('/api/account/Suisse/transactions?limit=500&include=3'));
  const html = els['#main'].innerHTML;
  assert.match(html, /<tr id="tx-3" class="hl">/);
  assert.match(html, /<tr id="tx-1"><td>/);
  assert.match(html, /Retour à la recherche/);
  assert.doesNotMatch(html, /Écriture introuvable/);
});

test('a transaction that no longer exists is reported, and the usual account page has no highlighted row', async () => {
  const {ctx, els} = fxPage([TX]);
  await ctx.account('Suisse', '', 99);
  assert.match(els['#main'].innerHTML, /Écriture introuvable/);
  await ctx.account('Suisse');
  assert.doesNotMatch(els['#main'].innerHTML, /class="hl"|Retour à la recherche|include=/);
});

test('route sends #/search to the search page and #/account/<id>/tx/<n> to the account', async () => {
  const calls = [];
  const {ctx} = load(async url => {
    calls.push(url);
    return {json: async () => (url.includes('transactions') ? [] : url.endsWith('/meta') ? FX_META : url.includes('accounts') ? [] : FX_ACCOUNT)};
  });
  await settle();
  calls.length = 0;
  ctx.location.hash = '#/search';
  await ctx.route();
  assert.ok(calls.some(u => u.endsWith('/accounts')) && !calls.some(u => u.includes('transactions')));
  calls.length = 0;
  ctx.location.hash = '#/account/Suisse/tx/12';
  await ctx.route();
  assert.ok(calls.includes('/api/account/Suisse/transactions?limit=500&include=12'));
});

/* ---------------------------------------------------------------- responsive layout */
test('the panes of the pages stack on a narrow screen: classes instead of fixed widths', async () => {
  const {ctx, els} = fxPage([TX]);
  await ctx.account('Suisse');
  assert.match(els['#main'].innerHTML, /<div class="pane pane-wide">/);
  assert.doesNotMatch(els['#main'].innerHTML, /min-width:\d+px/);
  const home = masterPage('EUR');
  await home.ctx.home();
  assert.equal((home.els['#main'].innerHTML.match(/<details class="pane"/g) || []).length, 3);
  assert.doesNotMatch(home.els['#main'].innerHTML, /min-width:\d+px/);
});

test('the blocks by bank, year and type are collapsed by default, and stay as the user left them when the page is redrawn', async () => {
  const {ctx, els} = masterPage('EUR');
  await ctx.home();
  const panes = html => html.match(/<details class="pane"[^>]*>/g);
  assert.equal(panes(els['#main'].innerHTML).length, 3);
  assert.ok(panes(els['#main'].innerHTML).every(p => !p.includes(' open')));
  for (const title of ['Par banque', 'Par année de disponibilité', 'Par type']) assert.match(els['#main'].innerHTML, new RegExp(`<summary><h3>${title}</h3></summary>`));
  ctx.paneToggle('bank', true);   // the user opens « Par banque »
  await ctx.home();
  const [bank, year, type] = panes(els['#main'].innerHTML);
  assert.match(bank, / open /);
  assert.ok(!year.includes(' open') && !type.includes(' open'));
  ctx.paneToggle('bank', false);
  await ctx.home();
  assert.ok(panes(els['#main'].innerHTML).every(p => !p.includes(' open')));
});

test('the blocks by category and by period of the spending page are collapsible, collapsed by default', async () => {
  const report = {categories: [{category: 'Courses', total: 10, pct: 1}], series: [{period: '2024-01', spread: 1, raw: 1, avg12: 1}], matrix: {Courses: {'2024-01': 1}}, excluded: [], all_categories: ['Courses']};
  const {ctx, els} = load(async url => ({json: async () => (url.includes('spending') ? report : url.includes('meta') ? {categories: [], master_currency: 'EUR'} : [])}));
  await settle();
  await ctx.spending();
  const html = els['#main'].innerHTML;
  assert.match(html, /<details class="pane"[^>]*><summary><h3>Par catégorie<\/h3><\/summary><table>[\s\S]*<\/table><\/details>/);
  assert.match(html, /<details class="pane"[^>]*><summary><h3>Par période<\/h3><\/summary><div class="scroll"[\s\S]*<\/table><\/div><\/details>/);
  assert.doesNotMatch(html, /<details[^>]* open/);
});

const todayIso = (monthsAgo = 0) => { const d = new Date(); d.setMonth(d.getMonth() - monthsAgo); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('availability and last date are no longer columns: they show when hovering on the name of the account', async () => {
  const {ctx, els} = masterPage('EUR', {accounts: [
    {id: 'PER', status: 'Open', type: 'Livret', bank: 'B', availability: 2035, last_date: todayIso(), currency: 'EUR', balance_main: 10, balance_native: 10},
    {id: 'Courant', status: 'Open', type: 'Courant', bank: 'B', availability: 0, last_date: todayIso(), currency: 'EUR', balance_main: 5, balance_native: 5}]});
  await ctx.home();
  const html = els['#main'].innerHTML;
  assert.doesNotMatch(html, /Dispo\.|Dernière date/);
  assert.match(html, /<td class="" title="Disponibilité: 2035">PER<\/td>/);
  assert.match(html, /<td class="" title="Disponibilité: Immédiate">Courant<\/td>/);
  const row = html.match(/<tr class="click"[^>]*><td class="" title="Disponibilité: 2035">.*?<\/tr>/s)[0];
  assert.equal((row.match(/<td/g) || []).length, 5);   // name, type, bank, native balance, balance
});

test('an open account not updated for more than 3 months is red, more than 1 month orange, else normal', () => {
  const {ctx} = load();
  const today = new Date(2024, 5, 15);   // 2024-06-15
  const level = (last_date, status = 'Open') => ctx.lateness({status, last_date}, today);
  assert.equal(level('2024-03-14'), 'late-3');
  assert.equal(level('2024-03-15'), 'late-1');    // exactly 3 months: not more
  assert.equal(level('2024-05-14'), 'late-1');
  assert.equal(level('2024-05-15'), '');          // exactly 1 month: not more
  assert.equal(level('2024-06-10'), '');
  assert.equal(level('2023-01-01', 'Closed'), '');   // a closed account is not late
  assert.equal(level(null), '');
});

test('a late account name is coloured and its tooltip adds the last update', async () => {
  const old = todayIso(5), mid = todayIso(2), fresh = todayIso(0);
  const acc = (id, last_date) => ({id, status: 'Open', type: 'Courant', bank: 'B', availability: 0, last_date, currency: 'EUR', balance_main: 5, balance_native: 5});
  const {ctx, els} = masterPage('EUR', {accounts: [acc('Rouge', old), acc('Orange', mid), acc('Frais', fresh)]});
  await ctx.home();
  const html = els['#main'].innerHTML;
  assert.match(html, new RegExp(`<td class="late-3" title="Disponibilité: Immédiate\nDernière mise à jour: ${old}">Rouge</td>`));
  assert.match(html, new RegExp(`<td class="late-1" title="Disponibilité: Immédiate\nDernière mise à jour: ${mid}">Orange</td>`));
  assert.match(html, /<td class="" title="Disponibilité: Immédiate">Frais<\/td>/);
});

test('the accounts table is filterable by type and bank only, and sortable on every column', async () => {
  const {ctx, els} = masterPage('EUR');
  await ctx.home();
  const html = els['#main'].innerHTML;
  const filters = html.match(/<tr class="filters">(.*?)<\/tr>/s)[1];
  assert.deepEqual([...filters.matchAll(/aria-label="Filtrer ([^"]+)"/g)].map(m => m[1]), ['Type', 'Banque']);
  assert.equal((html.match(/class="sort"/g) || []).length, 5);
});

test('the accounts table ends with the total of the balance in the master currency, of the filtered accounts only', async () => {
  const acc = (id, bank, type, balance_main) => ({id, status: 'Open', type, bank, availability: 0, last_date: todayIso(), currency: 'EUR', balance_main, balance_native: balance_main});
  const {ctx, els, get} = masterPage('EUR', {accounts: [acc('A', 'X', 'Livret', 100), acc('B', 'Y', 'PEA', 250.5), acc('C', 'X', 'PEA', -50)]});
  await ctx.home();
  const total = () => plain(els['#main'].innerHTML.match(/<tfoot[^>]*>(.*?)<\/tfoot>/s)[1]);
  assert.match(total(), /<tr class="total"><td class="s">Total<\/td><td class="n ">300,50 €<\/td><td><\/td><td><\/td><td><\/td><\/tr>/);
  const id = Number(els['#main'].innerHTML.match(/id="tb-(\d+)"/)[1]);
  const bank = get('tables').get(id).cols.findIndex(c => c.label === 'Banque');
  ctx.tableFilter(id, bank, String(get('tables').get(id).cols[bank].options.indexOf('X')));   // only the accounts of bank X
  assert.match(plain(els[`#tf-${id}`].innerHTML), /<td class="n ">50,00 €<\/td>/);
  ctx.tableFilter(id, bank, '');
  assert.match(plain(els[`#tf-${id}`].innerHTML), /300,50 €/);
});

test('the blocks by bank, year and type are below the accounts table', async () => {
  const {ctx, els} = masterPage('EUR');
  await ctx.home();
  const html = els['#main'].innerHTML, at = text => html.indexOf(text);
  assert.ok(at('<h3>Comptes</h3>') > 0 && at('<h3>Comptes</h3>') < at('Par banque') && at('Par banque') < at('Par année de disponibilité') && at('Par année de disponibilité') < at('Par type'));
  assert.ok(at('</table>') < at('Par banque') || at('</tfoot>') < at('Par banque'));
});

test('an amount that rounds to zero is shown as 0, never -0, and is not negative', () => {
  const {get} = load(), num = get('num'), cls = get('cls');
  assert.equal(plain(num(-0.004)), '0,00 €');
  assert.equal(plain(num(-1e-12)), '0,00 €');
  assert.equal(plain(num(-0)), '0,00 €');
  assert.equal(plain(num(-0.006)), '-0,01 €');
  assert.equal(cls(-0.004), '');
  assert.equal(cls(-0.006), 'neg');
});

test('closed accounts have a grey row, and a balance that is never red nor -0', async () => {
  const acc = (id, status, balance_main) => ({id, status, type: 'Courant', bank: 'B', availability: 0, last_date: todayIso(), currency: 'EUR', balance_main, balance_native: balance_main});
  const {ctx, els, mk} = masterPage('EUR', {accounts: [acc('Ouvert', 'Open', -5), acc('Ferme0', 'Closed', -1e-10), acc('FermeNeg', 'Closed', -3)]});
  mk('#showClosed').checked = true;   // « Montrer les comptes fermés » ticked
  await ctx.home();
  const rows = plain(els['#main'].innerHTML).match(/<tr class="click[^"]*".*?<\/tr>/gs);
  const row = id => rows.find(r => r.includes(`>${id}</td>`));
  assert.match(row('Ouvert'), /^<tr class="click"/);
  assert.match(row('Ouvert'), /<td class="n neg">-5,00 €<\/td>/);
  assert.match(row('Ferme0'), /^<tr class="click closed"/);
  assert.match(row('Ferme0'), /<td class="n ">0,00 €<\/td>/);
  assert.doesNotMatch(row('Ferme0'), /-0/);
  assert.doesNotMatch(row('FermeNeg'), /neg/);   // never red on a closed account
});

test('the « Montrer les comptes fermés » checkbox is next to the title of the accounts table, not at the top of the page', async () => {
  const {ctx, els} = masterPage('EUR');
  await ctx.home();
  const html = els['#main'].innerHTML;
  assert.match(html, /<div class="title-row"><h3>Comptes<\/h3><label><input type="checkbox" id="showClosed"  onchange="home\(\)"> Montrer les comptes fermés<\/label><\/div>/);
  assert.equal((html.match(/id="showClosed"/g) || []).length, 1);
  assert.ok(html.indexOf('id="showClosed"') > html.indexOf('chart-'));   // below the chart
});

test('closed accounts are hidden by default, shown when « Montrer les comptes fermés » is ticked, and the checkbox keeps its state', async () => {
  const acc = (id, status) => ({id, status, type: 'Courant', bank: 'B', availability: 0, last_date: todayIso(), currency: 'EUR', balance_main: 1, balance_native: 1});
  const {ctx, els, mk} = masterPage('EUR', {accounts: [acc('Ouvert', 'Open'), acc('Ferme', 'Closed')]});
  await ctx.home();
  assert.doesNotMatch(els['#main'].innerHTML, />Ferme<\/td>/);
  assert.match(els['#main'].innerHTML, />Ouvert<\/td>/);
  assert.doesNotMatch(els['#main'].innerHTML, /id="showClosed" checked/);
  mk('#showClosed').checked = true;
  await ctx.home();
  assert.match(els['#main'].innerHTML, />Ferme<\/td>/);
  assert.match(els['#main'].innerHTML, /id="showClosed" checked/);
  mk('#showClosed').checked = false;
  await ctx.home();
  assert.doesNotMatch(els['#main'].innerHTML, />Ferme<\/td>/);
});

/* ---------------------------------------------------------------- accounts shown without the amounts */
const typedPage = (type, currency = 'EUR') => load(async url => ({json: async () => (url.includes('transactions') ? [TX] : url.endsWith('/meta') ? {categories: [], currencies: ['EUR', 'CHF'], master_currency: 'EUR'}
  : {...FX_ACCOUNT, account: {...FX_ACCOUNT.account, type, currency}})}));
const heads = html => [...html.match(/<table class="data"><thead><tr>(.*?)<\/tr>/s)[1].matchAll(/<th[^>]*>([^<]*?)(?: <button|<\/th>)/g)].map(m => m[1]).filter(Boolean);

test('the transactions of Assurance Vie, PER, PERCO, PEA, Actions, PEE and Investment accounts have no Montant column', async () => {
  for (const type of ['Assurance Vie', 'PER', 'PERCO', 'PEA', 'Actions', 'PEE', 'Investment']) {
    const {ctx, els} = typedPage(type);
    await ctx.account('X');
    const html = els['#main'].innerHTML;
    assert.deepEqual(heads(html), ['Date', 'Solde €', 'Description', 'Sous-cat.'], type);
    const row = html.match(/<tr id="tx-1">.*?<\/tr>/s)[0];
    assert.equal((row.match(/<td/g) || []).length, 5, type);   // date, balance, description, sub-category, buttons
  }
});

test('the other accounts keep their Montant columns', async () => {
  for (const type of ['Courant', 'Livret A', 'PEL']) {
    const {ctx, els} = typedPage(type);
    await ctx.account('X');
    assert.deepEqual(heads(els['#main'].innerHTML), ['Date', 'Montant €', 'Solde €', 'Description', 'Sous-cat.'], type);
  }
});

test('in a foreign currency, both the Montant columns are hidden and the balances stay', async () => {
  const {ctx, els} = typedPage('Actions', 'CHF');
  await ctx.account('X');
  const html = els['#main'].innerHTML;
  assert.deepEqual(heads(html), ['Date', 'Solde €', 'Solde CHF', 'Description', 'Sous-cat.']);
  assert.equal((html.match(/<tr id="tx-1">.*?<\/tr>/s)[0].match(/<td/g) || []).length, 6);
  const other = typedPage('Courant', 'CHF');
  await other.ctx.account('X');
  assert.deepEqual(heads(other.els['#main'].innerHTML), ['Date', 'Montant €', 'Solde €', 'Montant CHF', 'Solde CHF', 'Description', 'Sous-cat.']);
});

test('the transaction rows have a pen and a trash icon instead of the words modifier and suppr.', async () => {
  const {ctx, els} = typedPage('Courant');
  await ctx.account('X');
  const row = els['#main'].innerHTML.match(/<tr id="tx-1">.*?<\/tr>/s)[0];
  assert.doesNotMatch(row, />modifier<|>suppr\.</);
  const buttons = [...row.matchAll(/<button class="icon" title="([^"]+)" aria-label="([^"]+)" onclick="([^"]+)"><svg.*?<\/svg><\/button>/gs)];
  assert.deepEqual(buttons.map(b => [b[1], b[2]]), [['Modifier', 'Modifier'], ['Supprimer', 'Supprimer']]);
  assert.match(buttons[0][3], /^editTx\(/);
  assert.equal(buttons[1][3], "delTx(1,'Suisse')");
});

test('the deposits have a trash icon instead of suppr.', async () => {
  const {ctx, els} = load(async url => ({json: async () => (url.includes('transactions') ? [] : url.endsWith('/meta') ? {categories: [], currencies: ['EUR'], master_currency: 'EUR'}
    : {account: {id: 'Livret', type: 'Livret A', bank: 'B', currency: 'EUR', status: 'Open', mode: 'flow'}, interests: null, deposits: [{id: 5, date: '2024-01-01', amount_main: 100}]})}));
  await ctx.account('Livret');
  const row = els['#main'].innerHTML.match(/<tr><td>2024-01-01<\/td><td class="n">100,00[^<]*<\/td>.*?<\/tr>/s)[0];
  assert.doesNotMatch(row, /suppr\./);
  assert.match(row, /<button class="icon" title="Supprimer" aria-label="Supprimer" onclick="delDep\(5,'Livret'\)"><svg/);
});

test('on a narrow screen the yields of an account come before its transactions', async () => {
  const {ctx, els} = load(async url => ({json: async () => (url.includes('transactions') ? [] : url.endsWith('/meta') ? {categories: [], currencies: ['EUR'], master_currency: 'EUR'}
    : {account: {id: 'Livret', type: 'Livret A', bank: 'B', currency: 'EUR', status: 'Open', mode: 'flow'}, interests: {y1: 0.02}, deposits: []})}));
  await ctx.account('Livret');
  const html = els['#main'].innerHTML;
  assert.match(html, /<div class="pane pane-side"><h3>Rendements nets/);
  assert.ok(html.indexOf('pane pane-wide') < html.indexOf('pane-side'));   // side by side on a wide screen: transactions first
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'static', 'style.css'), 'utf8');
  assert.match(css, /@media\(max-width:840px\)\{\.pane-side\{order:-1\}\}/);
});
