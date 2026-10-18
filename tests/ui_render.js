// Renders every view against a running server with a minimal DOM stub; fails on any exception.
const fs = require('fs'), path = require('path'), vm = require('vm');
const BASE = process.argv[2] || 'http://127.0.0.1:8767';
const els = {};
const mk = id => els[id] || (els[id] = {innerHTML: '', value: '', checked: true, textContent: '', classList: {toggle() {}}, dataset: {}, files: []});
const ctx = {
  console, fetch: (u, o) => fetch(BASE + u, o), URL, setTimeout, btoa: s => Buffer.from(s, 'binary').toString('base64'),
  document: {querySelector: s => mk(s), querySelectorAll: () => []},
  location: {hash: ''}, window: {addEventListener() {}, scrollTo() {}}, confirm: () => true, alert: m => { throw new Error('alert: ' + m); },
  encodeURIComponent, decodeURIComponent, Uint8Array, Math, Number, Set, Object, JSON, Date, Array, String, RegExp,
};
vm.createContext(ctx);
for (const f of ['charts.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'static', f), 'utf8') + ';', ctx);
(async () => {
  const views = ['', 'spending', 'interests', 'admin', 'account/BoursoBank%20Olivier', 'account/PEE%20Volvo', 'account/Revolut%20CHF', 'account/HPE%20Shares'];
  for (const v of views) {
    ctx.location.hash = '#/' + v; els['#main'] = mk('#main'); els['#main'].innerHTML = '';
    await vm.runInContext('route()', ctx);
    const h = els['#main'].innerHTML;
    console.log((v || 'home').padEnd(32), h.length, /class="err">Erreur/.test(h) ? 'ERROR: ' + h.slice(0, 200) : 'ok', (h.match(/<svg/g) || []).length ? 'svg' : '');
  }
})().catch(e => { console.error('FAIL', e); process.exit(1); });
