// Loads the browser scripts (static/charts.js, static/app.js) into a vm context with a minimal DOM stub.
const fs = require('fs'), path = require('path'), vm = require('vm');

const STATIC = path.join(__dirname, '..', '..', 'static');
// Normalise the narrow/no-break spaces produced by Intl so assertions do not depend on the ICU version
const plain = s => String(s).replace(/[  ]/g, ' ');

function makeElement() {
  return {
    innerHTML: '', value: '', checked: true, textContent: '', className: '', classList: {toggle() {}}, dataset: {}, files: [],
    children: [], replaceChildren(...c) { this.children = c; },
  };
}

function load(fetchImpl) {
  const els = {};
  const mk = id => els[id] || (els[id] = makeElement());
  const ctx = {
    console, URL, setTimeout, Uint8Array, Math, Number, Set, Object, JSON, Date, Array, String, RegExp, Error,
    encodeURIComponent, decodeURIComponent,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    fetch: fetchImpl || (async () => ({json: async () => ({})})),
    document: {querySelector: mk, querySelectorAll: () => [], createElement: () => makeElement()},
    location: {hash: ''}, window: {addEventListener() {}, scrollTo() {}}, confirm: () => true, alert: m => { throw new Error('alert: ' + m); },
  };
  vm.createContext(ctx);
  for (const f of ['charts.js', 'app.js']) {
    const file = path.join(STATIC, f);
    vm.runInContext(fs.readFileSync(file, 'utf8') + ';', ctx, {filename: file});
  }
  // `const` declarations are not properties of the context: expose them through a lookup helper
  const get = name => vm.runInContext(name, ctx);
  return {ctx, els, mk, get};
}

module.exports = {load, plain};
