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
  const {ctx} = load(async (url, opts) => { call = {url, opts}; return {json: async () => ({ok: 1})}; });
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
