const $ = s => document.querySelector(s);
/* HTML escaping of a text (for the content of an element or of a double-quoted attribute). A text with nothing to escape is returned
   as it is (checked by the anchored pattern); otherwise the browser escapes it: set as the text of a node, read back as HTML. */
const ESC_NODE = document.createElement('span');
const esc = s => {
  const text = String(s ?? '');
  const plain = text.match(/^[^&<>"]*$/g);
  if (plain) return plain[0];
  ESC_NODE.textContent = text;
  return ESC_NODE.innerHTML.replaceAll('"', '&quot;');
};
let MASTER = 'EUR';  // master currency of the application: totals, balances and yields of all the accounts are in it
/* An amount that rounds to 0 is shown as 0, never as -0 (and not as negative: see cls) */
const cents = v => Math.round(v * 100) / 100 === 0 ? 0 : v;
const num = (v, cur = sym(MASTER)) => v == null ? '' : formatNumber(cents(v), 2) + ' ' + esc(cur);
const pct = v => v == null ? '–' : formatNumber(v * 100, 1) + ' %';
const cls = v => cents(v) < 0 ? 'neg' : '';
const sym = c => ({EUR: '€', CHF: 'CHF', USD: '$', GBP: '£'}[c] || c);
async function api(path, method, body){
  const r = await fetch('/api/' + path, {method: method ?? 'GET', headers: {'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
  const j = await r.json();
  if (j?.error) throw new Error(j.error);
  return j;
}
let META = null;
const meta = async () => {
  META = META || await api('meta');
  if (META.number_format) setNumberFormat(META.number_format);   // the separators chosen in the administration page
  MASTER = String(META.master_currency).match(/^[A-Z]{3}$/g)?.[0] ?? 'EUR';  // a currency code, nothing else
  return META;
};
const enc = encodeURIComponent;
// Escapes a value for use as a single-quoted JS string inside a double-quoted HTML attribute (onclick="f('...')")
const jsq = s => esc(String(s).replaceAll('\\', String.raw`\\`).replaceAll("'", String.raw`\'`).replaceAll('\n', String.raw`\n`).replaceAll('\r', String.raw`\r`));

/* ------------------------------------------------------------------ router */
async function route(){
  const h = location.hash.replace(/^#\/?/, ''), [name, ...rest] = h.split('/');
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === (name === 'account' ? '' : name)));
  $('#main').innerHTML = 'Chargement…';
  try {
    await meta();
    if (name === 'spending') await spending();
    else if (name === 'interests') await interests();
    else if (name === 'admin') await admin();
    else if (name === 'search') await searchPage();
    else if (name === 'account') await account(decodeURIComponent(rest[0] ?? ''), '', rest[1] === 'tx' ? Number(rest[2]) || null : null);  // #/account/<id>/tx/<n> shows transaction n
    else await home();
  } catch (e) { const err = document.createElement('div'); err.className = 'err'; err.textContent = 'Erreur : ' + e.message; $('#main').replaceChildren(err); }
}
window.addEventListener('hashchange', route);

/* Average monthly growth of the net worth over the previous `months` months, rounded to the hundred and floored at 0 (column "Epargne Mensuelle" of the "Solde" tab of Comptes.xlsm) */
const SAVINGS_MONTHS = 24;
function monthlySavings(totals, months = SAVINGS_MONTHS){
  return totals.map((v, i) => {
    const before = totals[i - months];
    return v == null || before == null ? null : Math.max(0, Math.round((v - before) / months / 100) * 100);
  });
}

/* Collapsible blocks (<details>), collapsed by default; the ones the user opened stay open when the page is redrawn */
const OPEN_PANES = new Set();
const paneStart = (id, title) => `<details class="pane" ${OPEN_PANES.has(id) ? 'open' : ''} ontoggle="paneToggle('${id}', this.open)"><summary><h3>${title}</h3></summary>`;
function paneToggle(id, open){ if (open) OPEN_PANES.add(id); else OPEN_PANES.delete(id); }

/* ------------------------------------------------------------------ home */
async function home(){
  const open = !$('#showClosed')?.checked;  // closed accounts are hidden unless « Montrer les comptes fermés » is ticked
  const [acc, nw] = await Promise.all([api('accounts'), api('networth?open=' + (open ? 1 : 0)), meta()]);
  const shown = acc.filter(a => !open || a.status === 'Open');
  const total = shown.reduce((s, a) => s + a.balance_main, 0);
  const sumBy = f => { const o = {}; shown.forEach(a => { const k = f(a) || '–'; o[k] = (o[k] || 0) + a.balance_main; }); return Object.entries(o).sort((a, b) => b[1] - a[1]); };
  const kvRow = ([k, v]) => `<tr><td>${esc(k)}</td><td class="n ${cls(v)}">${num(v)}</td></tr>`;
  const tbl = rows => '<table>' + rows.map(kvRow).join('') + '</table>';
  const byYear = {}; shown.forEach(a => { const k = a.availability || 0; byYear[k] = (byYear[k] || 0) + a.balance_main; });
  $('#main').innerHTML = `<div class="mut">Patrimoine</div><div class="big">${num(total)}</div>
  ${drawChart(nw.map(p => p.month), [
    {name: `Épargne mensuelle (moy. ${SAVINGS_MONTHS} mois)`, color: 'var(--pos-light)', type: 'bar', axis: 'right', unit: sym(MASTER) + '/mois', values: monthlySavings(nw.map(p => p.total))},
    {name: 'Patrimoine', color: 'var(--acc)', type: 'line', values: nw.map(p => p.total)}], {xticks: 12, unit: sym(MASTER)})}
  <div class="title-row"><h3>Comptes</h3><label><input type="checkbox" id="showClosed" ${open ? '' : 'checked'} onchange="home()"> Montrer les comptes fermés</label></div>${dataTable(homeColumns(), shown.sort((a, b) => b.balance_main - a.balance_main), homeRow, {noun: 'comptes', footer: homeTotal})}
  <div class="row" style="align-items:start">${paneStart('bank', 'Par banque')}${tbl(sumBy(a => a.bank))}</details>
  ${paneStart('year', 'Par année de disponibilité')}${tbl(Object.entries(byYear).sort((a, b) => a[0] - b[0]).map(([k, v]) => [k === '0' ? 'Immédiate' : k, v]))}</details>
  ${paneStart('type', 'Par type')}${tbl(sumBy(a => a.type))}</details></div>`;
}
const homeColumns = () => [
  {label: 'Compte', filter: false, value: a => a.id}, {label: 'Solde ' + sym(MASTER), num: true, filter: false, value: a => a.balance_main},
  {label: 'Solde (devise)', num: true, filter: false, value: a => a.currency === MASTER ? null : a.balance_native}, {label: 'Type', value: a => a.type}, {label: 'Banque', value: a => a.bank},
];
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/* Bubbles right of the name of an account, flagging what needs attention; red is the worse, orange the lesser. The tooltip gives the last update. */
const bubble = (warn, text) => `<span class="stale-dot${warn ? ' warn' : ''}" role="img" title="${esc(text)}" aria-label="${esc(text)}"></span>`;
const daysAgo = (today, shift) => { const d = new Date(today); shift(d); return isoDay(d); };
/* Open account with no transaction (no balance) for more than 3 months (orange) or more than 1 year (red) */
function staleBubble(a, today = new Date()){
  if (a.status !== 'Open') return '';
  const last = a.last_date ? a.last_date.slice(0, 10) : null;   // no last date: never any transaction, the worst case
  if (last && last >= daysAgo(today, d => d.setMonth(d.getMonth() - 3))) return '';
  return bubble(last !== null && last >= daysAgo(today, d => d.setFullYear(d.getFullYear() - 1)), 'Dernière mise à jour du solde: ' + (last ?? '–'));
}
/* Open account whose yields were not recalculated for more than 1 month (red) or more than 15 days (orange) */
function calcBubble(r, today = new Date()){
  if (r.status !== 'Open' || !r.calc_date) return '';
  const last = r.calc_date.slice(0, 10);
  if (last >= daysAgo(today, d => d.setDate(d.getDate() - 15))) return '';
  return bubble(last >= daysAgo(today, d => d.setMonth(d.getMonth() - 1)), 'Dernière mise à jour des rendements: ' + last);
}
/* Shown when hovering on the name of the account (replaces the old column) */
const availabilityText = a => 'Disponibilité: ' + (a.availability || 'Immédiate');
/* Last line: total of the balances in the master currency of the accounts shown (so, of the filtered ones) */
function homeTotal(rows){
  const total = rows.reduce((t, a) => t + a.balance_main, 0);
  return `<tr class="total"><td class="s">Total</td><td class="n ${cls(total)}">${num(total)}</td><td></td><td></td><td></td></tr>`;
}
const homeRow = a => `<tr class="click${a.status === 'Closed' ? ' closed' : ''}" onclick="location.hash='#/account/${enc(a.id)}'"><td title="${esc(availabilityText(a))}">${esc(a.id)}${staleBubble(a)}</td><td class="n ${a.status === 'Closed' ? '' : cls(a.balance_main)}">${num(a.balance_main)}</td><td class="n mut">${a.currency === MASTER ? '' : num(a.balance_native, sym(a.currency))}</td><td>${esc(a.type)}</td><td>${esc(a.bank)}</td></tr>`;

/* ------------------------------------------------------------------ spending */
let SP = {group: 'month', months: 36, exclude: null};
async function spending(){
  await meta();
  const q = `spending?group=${SP.group}&months=${SP.months}` + (SP.exclude ? `&exclude=${enc(SP.exclude.join(','))}` : '');
  const r = await api(q);
  SP.exclude = r.excluded;
  const s = r.series;
  const periods = s.map(x => x.period);
  const chips = r.all_categories.concat(r.all_categories.includes('(sans catégorie)') ? [] : ['(sans catégorie)']).map(c =>
    `<label><input type="checkbox" ${r.excluded.includes(c) ? '' : 'checked'} onchange="toggleCat('${jsq(c)}',this.checked)"> <span class="d">${esc(c)}</span></label>`).join('');
  const avgCell = x => SP.group === 'month' ? `<td class="n">${num(x.avg12)}</td>` : '';  // 12-month average: monthly view only
  const matrixCell = v => '<td class="n">' + (v == null ? '' : formatNumber(cents(v), 2)) + '</td>';
  const matrixRow = c => '<tr><td>' + esc(c) + '</td>' + periods.map(p => matrixCell(r.matrix[c][p])).join('') + '</tr>';
  const cats = Object.keys(r.matrix).sort((a, b) => (r.categories.findIndex(x => x.category === a)) - (r.categories.findIndex(x => x.category === b)));
  $('#main').innerHTML = `<h2>Dépenses</h2>
  <div class="row"><label>Regroupement<select onchange="SP.group=this.value;spending()">${[['month', 'Mois'], ['quarter', 'Trimestre'], ['year', 'Année']].map(([v, l]) => `<option value="${v}" ${SP.group === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
  <label>Période<select onchange="SP.months=+this.value;spending()">${[[12, '12 mois'], [24, '24 mois'], [36, '3 ans'], [60, '5 ans'], [120, '10 ans'], [600, 'Tout']].map(([v, l]) => `<option value="${v}" ${SP.months === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
  <div class="chips"><span class="mut">Catégories incluses :</span> ${chips}</div>
  <div class="mut" style="font-size:12px;margin:4px 0">Dépenses = −montant sur les comptes « en budget ». Les écritures avec un nombre N (&gt;1) dans « In Budget » sont lissées sur N mois.</div>
  ${drawChart(periods, [{name: 'Dépenses lissées', color: 'var(--acc)', type: 'bar', values: s.map(x => x.spread)}].concat(SP.group === 'month' ? [{name: 'Moyenne 12 mois', color: 'var(--neg)', type: 'line', values: s.map(x => x.avg12)}] : []), {xticks: 12, unit: sym(MASTER)})}
  <div class="row" style="align-items:start">${paneStart('category', 'Par catégorie')}<table><tr><th>Catégorie</th><th class="n">Total</th><th class="n">%</th></tr>
  ${r.categories.map(c => `<tr><td>${esc(c.category)}</td><td class="n ${cls(-c.total)}">${num(c.total)}</td><td class="n">${pct(c.pct)}</td></tr>`).join('')}</table></details>
  ${paneStart('period', 'Par période')}<div class="scroll" style="max-height:420px;overflow-y:auto"><table><tr><th>Période</th><th class="n">Lissées</th><th class="n">Brutes</th>${SP.group === 'month' ? '<th class="n">Moy. 12 mois</th>' : ''}</tr>
  ${s.slice().reverse().map(x => `<tr><td>${x.period}</td><td class="n">${num(x.spread)}</td><td class="n">${num(x.raw)}</td>${avgCell(x)}</tr>`).join('')}</table></div></details></div>
  <h3>Catégorie × période</h3><div class="scroll"><table><tr><th>Catégorie</th>${periods.map(p => `<th class="n d">${p}</th>`).join('')}</tr>
  ${cats.map(matrixRow).join('')}</table></div>`;
}
function toggleCat(c, included){
  const set = new Set(SP.exclude || []); included ? set.delete(c) : set.add(c);
  SP.exclude = [...set];
  if (!SP.exclude.length) SP.exclude = [''];
  void spending();
}

/* ------------------------------------------------------------------ interests */
async function interests(msg = ''){
  const rows = await api('interests');
  $('#main').innerHTML = `<h2>Rendements annualisés (nets d'impôt)</h2>
  <div class="row"><button class="primary" onclick="recalc()">Recalculer</button><span class="ok">${msg}</span></div>
  <div class="mut" style="font-size:12px">Taux actuariel équivalent à l'ancien « Valeur cible » d'Excel : solde initial + versements capitalisés = solde final. Net = brut × (1 − fiscalité du compte).</div>
  ${dataTable(INTEREST_COLUMNS, rows, interestRow, {noun: 'comptes'})}`;
}
async function recalc(){
  const r = await api('interests/recalc', 'POST', {force: true});
  await interests(`${r.n} comptes recalculés`);
}

/* ------------------------------------------------------------------ account */
/* Small line icons (24x24, drawn with the colour of the text) for the buttons of the rows */
const ICONS = {
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
};
const iconButton = (icon, label, onclick) => `<button class="icon" title="${label}" aria-label="${label}" onclick="${onclick}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg></button>`;
let FOCUS = null;  // transaction to show (highlighted) in the account page: the one found by the search
/* Accounts whose transactions are shown without the « Montant » columns (the balance is what matters, the amounts are the movements of the market) */
const NO_AMOUNT_TYPES = new Set(['Assurance Vie', 'PER', 'PERCO', 'PEA', 'Actions', 'PEE', 'Investment']);
const showsAmount = a => !NO_AMOUNT_TYPES.has(a.type);
function txRow(t, foreign, aid, hasFx = false, amounts = true){
  const nativeAmount = foreign && amounts ? `<td class="n mut">${num(t.native_amount, '')}</td>` : '';
  const native = foreign ? nativeAmount + `<td class="n mut">${num(t.native_balance, '')}</td>` : '';
  const amount = amounts ? `<td class="n ${cls(t.amount_main)}">${num(t.amount_main)}</td>` : '';
  const origin = hasFx ? `<td class="n mut">${num(t.fx_amount, '')}</td><td>${esc(t.fx_currency)}</td>` : '';
  const edit = `editTx(${esc(JSON.stringify(t))})`, del = `delTx(${Number(t.id)},'${jsq(aid)}')`;
  const budget = t.in_budget ? ` <span class="mut">(${esc(t.in_budget)})</span>` : '';
  return `<tr id="tx-${Number(t.id)}"${t.id === FOCUS ? ' class="hl"' : ''}><td>${esc(t.date)}</td>${amount}<td class="n">${num(t.balance_main)}</td>${native}${origin}<td>${esc(t.description)}</td><td>${esc(t.subcategory)}${budget}</td>
  <td class="s actions">${iconButton('pen', 'Modifier', edit)}${iconButton('trash', 'Supprimer', del)}</td></tr>`;
}
const NATIVE_KEY = {y1: 'n1', y3: 'n3', y5: 'n5', y8: 'n8', y_all: 'n_all'};
const INTEREST_PERIODS = [['1 an', 'y1'], ['3 ans', 'y3'], ['5 ans', 'y5'], ['8 ans', 'y8'], ['Depuis le début', 'y_all']];
/* Yield in the master currency, with below it (in small) the yield in the currency of the account, without the exchange rate effect */
const nativeRateHtml = (native, currency) => {
  if (native == null || !currency || currency === MASTER) return '';
  const neg = native < 0 ? ' neg' : '';
  return `<small class="native-rate mut${neg}" title="Rendement en ${esc(currency)}, hors effet de change">${pct(native)} ${esc(currency)}</small>`;
};
const rateHtml = (v, native, currency) => {
  if (v == null) return '<span class="mut">–</span>';
  return `<span class="${v < 0 ? 'neg' : ''}">${pct(v)}</span>${nativeRateHtml(native, currency)}`;
};
const interestRow = r => `<tr class="click" onclick="location.hash='#/account/${enc(r.account)}'"><td>${esc(r.account)}${staleBubble(r)}${calcBubble(r)}</td><td>${esc(r.type)}</td>${rateCells(r)}</tr>`;
const rateCells = r => Object.entries(NATIVE_KEY).map(([y, n]) => `<td class="n">${rateHtml(r[y], r[n], r.currency)}</td>`).join('');
const INTEREST_COLUMNS = [
  {label: 'Compte', value: r => r.account}, {label: 'Type', value: r => r.type},
  ...INTEREST_PERIODS.map(([label, key]) => ({label, num: true, filter: false, value: r => r[key]})),
];

function interestsTable(interests, currency){
  if (!interests) return '<div class="mut">Pas encore calculé</div>';
  const rows = INTEREST_PERIODS.map(([l, k]) => `<tr><td class="s">${l}</td><td class="n">${rateHtml(interests[k], interests[NATIVE_KEY[k]], currency)}</td></tr>`).join('');
  return `<table>${rows}</table>`;
}
function depositRow(d, aid){
  const del = `delDep(${Number(d.id)},'${jsq(aid)}')`;
  return `<tr><td>${esc(d.date)}</td><td class="n">${num(d.amount_main)}</td><td class="s actions">${iconButton('trash', 'Supprimer', del)}</td></tr>`;
}
/* Layout of an account page (CSS grid): wide screen = transactions on the left, yields then deposits on the right;
   stacked = yields, transactions, then deposits at the bottom of the page */
function yieldsPanel(info, a){
  return `<div class="g-yields"><h3>Rendements nets</h3>${interestsTable(info.interests, a.currency)}
  <button onclick="recalcOne('${jsq(a.id)}')">Recalculer</button></div>`;
}
function depositsPanel(info, a, cur){
  return `<div class="g-deposits"><h3>Versements</h3><div class="row"><label>Date<input type="date" id="d_date" value="${new Date().toISOString().slice(0, 10)}"></label><label>Montant (${cur})<input id="d_amt" size="10"></label><button onclick="addDep('${jsq(a.id)}')">Ajouter</button></div>
  <div class="scroll" style="max-height:340px;max-width:460px;overflow-y:auto"><table>${info.deposits.map(d => depositRow(d, a.id)).join('')}</table></div></div>`;
}
const txColumns = (foreign, cur, hasFx, amounts = true) => [
  {label: 'Date', value: t => t.date}, ...(amounts ? [{label: 'Montant ' + sym(MASTER), num: true, value: t => t.amount_main}] : []), {label: 'Solde ' + sym(MASTER), num: true, value: t => t.balance_main},
  ...(foreign && amounts ? [{label: `Montant ${cur}`, num: true, value: t => t.native_amount}] : []), ...(foreign ? [{label: `Solde ${cur}`, num: true, value: t => t.native_balance}] : []),
  ...(hasFx ? [{label: "Montant d'origine", num: true, value: t => t.fx_amount}, {label: "Devise d'origine", value: t => t.fx_currency}] : []),
  {label: 'Description', value: t => t.description}, {label: 'Sous-cat.', value: t => t.subcategory}, {label: '', sort: false, filter: false, value: () => null},
];
/* Input fields of an entry, depending on the way the balance of the account is kept */
function modeFields(a, m, cur){
  if (a.mode === 'snapshot') return `<label>Solde (${cur})<input id="f_bal" size="12"></label>`;
  if (a.mode === 'shares') return '<label>Nb de titres<input id="f_qty" size="10"></label><label>Prix unitaire<input id="f_px" size="10"></label>';
  const title = "Vide : converti depuis le montant d'origine";  // flow and static accounts take transactions in other currencies too
  return `<label>Montant (${cur})<input id="f_amt" size="12" placeholder="auto" title="${title}"></label>${fxFields(a, m)}`;
}
/* Optional original amount, for a transaction in a currency other than the one of the account */
const fxFields = (a, m) => {
  const opts = [...new Set(m.currencies)].filter(c => c !== a.currency).map(c => `<option>${esc(c)}</option>`).join('');
  return `<label>Devise d'origine<select id="f_fxc"><option value=""></option>${opts}</select></label><label>Montant d'origine<input id="f_fxa" size="10"></label>`;
};
let EDIT = null;
async function account(id, msg = '', focus = null){
  FOCUS = focus;
  const [info, tr, m] = await Promise.all([api('account/' + enc(id)), api('account/' + enc(id) + '/transactions'), meta()]);
  if (focus && !tr.some(t => t.id === focus)) msg = 'Écriture introuvable (supprimée ?)';
  const a = info.account, cur = esc(sym(a.currency)), foreign = a.currency !== MASTER;
  const hasDep = !['Courant', 'Autres', null].includes(a.type);
  const bank = a.bank || '';
  const hasFx = tr.some(t => t.fx_currency);
  const subOpts = '<option value=""></option>' + m.categories.map(c => `<option>${esc(c.subcategory)}</option>`).join('');
  const fields = modeFields(a, m, cur);
  const importBanks = ['BoursoBank', 'ING', 'LCL', 'UBS', 'Revolut', 'Yuh', 'generic'];
  const bankOptions = importBanks.map(b => `<option ${b === bank ? 'selected' : ''}>${b}</option>`).join('');
  const importer = a.mode === 'flow' || a.mode === 'static'  // only the accounts that take amounts can import them
    ? `<label class="inline">Importer <select id="imp_bank">${bankOptions}</select><input type="file" id="imp_file" accept=".csv,.xlsx,.txt" onchange="importPreview('${jsq(a.id)}')"></label>` : '';
  $('#main').innerHTML = `<h2><span class="d">${esc(a.id)}</span> <span class="mut d" style="font-size:13px">${esc(a.type)} · ${esc(bank)} · ${esc(a.currency)} · ${esc(a.status)}${a.availability ? " · dispo " + esc(a.availability) : ""}</span></h2>
  <div class="row">${focus ? '<button onclick="location.hash=\'#/search\'">← Retour à la recherche</button>' : '<button onclick="location.hash=\'#/\'">← Retour</button>'}
  <button onclick="${a.status === 'Open' ? 'askCloseAccount' : 'reopenAccount'}('${jsq(a.id)}')">${a.status === 'Open' ? 'Clôturer' : 'Rouvrir'} le compte</button>
  <a href="/api/account/${enc(a.id)}/export.csv"><button>Exporter CSV</button></a>
  ${importer}</div>
  <div id="imp"></div><div class="ok">${esc(msg)}</div>
  <div class="card"><b id="form_title">Nouvelle écriture</b><div class="row"><label>Date<input type="date" id="f_date" value="${new Date().toISOString().slice(0, 10)}"></label>${fields}
  <label>Description<input id="f_desc" size="34"></label><label>Sous-catégorie<select id="f_sub">${subOpts}</select></label>
  ${a.in_budget ? '<label>Lissage (mois)<input id="f_bud" size="4" placeholder="vide"></label>' : ''}
  <button class="primary" onclick="saveTx('${jsq(a.id)}')">Enregistrer</button><button onclick="resetForm()">Annuler</button></div><div id="form_err" class="err"></div></div>
  <div class="account-grid ${hasDep ? '' : 'solo'}"><div class="g-tx">${dataTable(txColumns(foreign, sym(a.currency), hasFx, showsAmount(a)), tr, t => txRow(t, foreign, a.id, hasFx, showsAmount(a)), {noun: 'écritures'})}</div>
  ${hasDep ? yieldsPanel(info, a) + depositsPanel(info, a, cur) : ''}</div>`;
  EDIT = null;
  $('#tx-' + focus)?.scrollIntoView?.({block: 'center'});
}
function resetForm(){ EDIT = null; $('#form_title').textContent = 'Nouvelle écriture'; ['f_amt', 'f_bal', 'f_qty', 'f_px', 'f_desc', 'f_bud', 'f_fxc', 'f_fxa'].forEach(i => { if ($('#' + i)) $('#' + i).value = ''; }); }
function editTx(t){
  EDIT = t.id; $('#form_title').textContent = 'Modifier l\'écriture #' + t.id;
  $('#f_date').value = t.date; $('#f_desc').value = t.description || ''; $('#f_sub').value = t.subcategory || '';
  if ($('#f_amt')) $('#f_amt').value = t.fx_auto ? '' : t.native_amount ?? '';  // a converted amount is recomputed, not entered
  if ($('#f_fxa')) { $('#f_fxc').value = t.fx_currency ?? ''; $('#f_fxa').value = t.fx_amount ?? ''; }
  if ($('#f_bal')) $('#f_bal').value = t.native_balance ?? '';
  if ($('#f_qty')) { $('#f_qty').value = t.qty ?? ''; $('#f_px').value = t.price ?? ''; }
  if ($('#f_bud')) $('#f_bud').value = t.in_budget ?? '';
  window.scrollTo({top: 0, behavior: 'smooth'});
}
async function saveTx(id){
  const g = i => $('#' + i) ? $('#' + i).value : null;
  const body = {date: g('f_date'), description: g('f_desc'), subcategory: g('f_sub'), native_amount: g('f_amt'), native_balance: g('f_bal'), qty: g('f_qty'), price: g('f_px'), in_budget: g('f_bud'), fx_currency: g('f_fxc'), fx_amount: g('f_fxa')};
  try {
    if (!body.date) throw new Error('Date requise');
    if (EDIT) await api('transaction/' + EDIT, 'PUT', body); else await api('account/' + enc(id) + '/transactions', 'POST', body);
    await account(id, 'Écriture enregistrée');
  } catch (e) { $('#form_err').textContent = e.message; }
}
async function delTx(tid, id){
  const ok = await confirmDialog({title: "Supprimer l'écriture ?", message: 'Cette écriture sera définitivement supprimée et les soldes du compte seront recalculés.', confirmLabel: 'Supprimer'});
  if (ok) { await api('transaction/' + tid, 'DELETE'); await account(id, 'Écriture supprimée'); }
}
async function setStatus(id, status){ await api('account/' + enc(id), 'PUT', {status}); await account(id); }
const reopenAccount = id => setStatus(id, 'Open');
/* Closing an account: only when its balance is zero, and after typing its name */
const CLOSE_REFUSED = 'Clôture impossible';
const CLOSE_MESSAGE = "Le compte ne sera plus affiché dans la vue d'ensemble (sauf si « Montrer les comptes fermés » est coché). Pour confirmer, saisissez son nom :";
async function askCloseAccount(id){
  const a = (await api('accounts')).find(x => x.id === id);   // fresh balance
  if (a && (cents(a.balance_main) !== 0 || cents(a.balance_native) !== 0)) {
    const balance = num(a.currency === MASTER ? a.balance_main : a.balance_native, sym(a.currency));
    return errorDialog("Ce compte ne peut pas être clôturé : son solde n'est pas nul (" + balance + ').', CLOSE_REFUSED);
  }
  const ok = await confirmDialog({title: 'Clôturer le compte ?', message: CLOSE_MESSAGE, strong: id, require: id, inputLabel: 'Nom du compte', confirmLabel: 'Clôturer le compte'});
  if (!ok) return;
  try { await setStatus(id, 'Closed'); } catch (e) { await errorDialog(e.message, CLOSE_REFUSED); }   // the server checks the balance too
}
async function recalcOne(id){ await api('interests/recalc', 'POST', {account: id}); await account(id, 'Rendements recalculés'); }
async function addDep(id){ try { await api('account/' + enc(id) + '/deposits', 'POST', {date: $('#d_date').value, amount: $('#d_amt').value}); await account(id, 'Versement ajouté'); } catch (e) { await errorDialog(e.message); } }
async function delDep(did, id){
  const ok = await confirmDialog({title: 'Supprimer le versement ?', message: 'Ce versement sera définitivement supprimé.', confirmLabel: 'Supprimer'});
  if (ok) { await api('deposit/' + did, 'DELETE'); await account(id); }
}

/* ------------------------------------------------------------------ search */
const SEARCH_CRITERIA = ['text', 'account', 'category', 'subcategory', 'date_from', 'date_to', 'amount_min', 'amount_max'];
let SEARCH = {};  // criteria of the last search: kept to find them again when coming back from an account
const searchColumns = (foreign, hasFx) => [
  {label: 'Date', value: t => t.date}, {label: 'Compte', value: t => t.account}, {label: 'Montant ' + sym(MASTER), num: true, value: t => t.amount_main},
  ...(foreign ? [{label: 'Montant du compte', num: true, value: t => t.currency === MASTER ? null : t.native_amount}] : []),
  ...(hasFx ? [{label: "Montant d'origine", num: true, value: t => t.fx_amount}, {label: "Devise d'origine", value: t => t.fx_currency}] : []),
  {label: 'Description', value: t => t.description}, {label: 'Catégorie', value: t => t.category}, {label: 'Sous-cat.', value: t => t.subcategory},
  {label: '', sort: false, filter: false, value: () => null},
];
const searchLink = t => `#/account/${enc(t.account)}/tx/${Number(t.id)}`;  // the transaction in the list of its account
function searchRow(foreign, hasFx){
  return t => {
    const inAccount = t.currency === MASTER ? '' : num(t.native_amount, sym(t.currency));
    const own = foreign ? `<td class="n mut">${inAccount}</td>` : '';
    const origin = hasFx ? `<td class="n mut">${num(t.fx_amount, '')}</td><td>${esc(t.fx_currency)}</td>` : '';
    return `<tr class="click" onclick="location.hash='${searchLink(t)}'"><td>${esc(t.date)}</td><td>${esc(t.account)}</td><td class="n ${cls(t.amount_main)}">${num(t.amount_main)}</td>${own}${origin}`
      + `<td>${esc(t.description)}</td><td>${esc(t.category)}</td><td>${esc(t.subcategory)}</td><td><a href="${searchLink(t)}">voir</a></td></tr>`;
  };
}
const searchOptions = (values, current) => '<option value="">(tous)</option>' + values.map(v => `<option${v === current ? ' selected' : ''}>${esc(v)}</option>`).join('');
async function searchPage(){
  const [m, accounts] = await Promise.all([meta(), api('accounts')]);
  const categories = [...new Set(m.categories.map(c => c.category).filter(Boolean))].toSorted(tableCompare), c = SEARCH;
  const field = (id, label, extra = '') => `<label>${label}<input id="s_${id}" value="${esc(c[id] ?? '')}" ${extra}></label>`;
  const select = (id, label, values) => `<label>${label}<select id="s_${id}">${searchOptions(values, c[id])}</select></label>`;
  $('#main').innerHTML = `<h2>Recherche d'écritures</h2>
  <form class="card" onsubmit="searchRun(); return false"><div class="row">${field('text', 'Texte', 'size="26" placeholder="description ou sous-catégorie"')}
  ${select('account', 'Compte', accounts.map(a => a.id))}${select('category', 'Catégorie', categories)}${select('subcategory', 'Sous-catégorie', m.categories.map(x => x.subcategory).toSorted(tableCompare))}</div>
  <div class="row">${field('date_from', 'Date du', 'type="date"')}${field('date_to', 'au', 'type="date"')}${field('amount_min', 'Montant de', 'size="9" inputmode="decimal"')}${field('amount_max', 'à', 'size="9" inputmode="decimal"')}
  <button class="primary" type="submit">Rechercher</button><button type="button" onclick="searchClear()">Effacer</button></div>
  <div class="mut" style="font-size:12px">Tous les critères renseignés doivent être satisfaits. Le texte cherche chaque mot (sans tenir compte des accents ni des majuscules). Le montant est en valeur absolue : en ${esc(MASTER)}, dans la devise du compte ou dans la devise d'origine.</div>
  <div id="s_err" class="err"></div></form><div id="s_res"></div>`;
  if (SEARCH_CRITERIA.some(k => c[k])) await searchRun();
}
function searchClear(){ SEARCH = {}; void searchPage(); }
async function searchRun(){
  SEARCH = Object.fromEntries(SEARCH_CRITERIA.map(k => [k, $('#s_' + k).value.trim()]));
  $('#s_err').textContent = '';
  try {
    const query = SEARCH_CRITERIA.filter(k => SEARCH[k]).map(k => k + '=' + enc(SEARCH[k])).join('&');
    const r = await api('search?' + query);
    const foreign = r.rows.some(t => t.currency !== MASTER), hasFx = r.rows.some(t => t.fx_currency);
    const more = r.truncated ? `<div class="mut">${Number(r.total)} écritures correspondent : les ${Number(r.rows.length)} plus récentes sont affichées, affinez la recherche.</div>` : '';
    $('#s_res').innerHTML = r.rows.length ? more + dataTable(searchColumns(foreign, hasFx), r.rows, searchRow(foreign, hasFx), {noun: 'écritures'}) : '<div class="mut">Aucune écriture trouvée</div>';
  } catch (e) { $('#s_err').textContent = e.message; }
}

/* import */
let IMPORT = null;
function b64(buf){
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) {
    s += String.fromCodePoint.apply(null, b.subarray(i, i + 0x8000));   // by chunks: too many arguments otherwise
  }
  return btoa(s);
}
async function importPreview(id){
  const f = $('#imp_file').files[0]; if (!f) return;
  IMPORT = {filename: f.name, data: b64(await f.arrayBuffer()), bank: $('#imp_bank').value};
  try {
    const r = await api('account/' + enc(id) + '/import', 'POST', IMPORT);
    const previewRow = p => `<tr><td>${p.date}</td><td class="n ${cls(p.amount)}">${num(p.amount)}</td><td>${esc(p.description)}</td></tr>`;
    const preview = r.new.slice(0, 200).map(previewRow).join('');
    const list = r.new.length ? `<div class="scroll" style="max-height:240px;overflow-y:auto"><table>${preview}</table></div>
    <button class="primary" onclick="importCommit('${jsq(id)}')">Importer ${r.new.length} écritures</button>` : '';
    $('#imp').innerHTML = `<div class="card"><b>Import de ${esc(f.name)}</b> : ${r.new.length} nouvelle(s) écriture(s), ${r.duplicates} doublon(s) ignoré(s).
    ${list}<button onclick="$('#imp').innerHTML=''">Fermer</button></div>`;
  } catch (e) { $('#imp').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}
async function importCommit(id){ const r = await api('account/' + enc(id) + '/import', 'POST', {...IMPORT, commit: true}); await account(id, `${r.new.length} écritures importées`); }

/* ------------------------------------------------------------------ admin */
async function admin(msg = ''){
  const m = await meta(), f = m.number_format ?? NUMBER_FORMAT;
  $('#main').innerHTML = `<h2>Administration</h2><div class="ok">${esc(msg)}</div>
  <div class="card"><b>Nouveau compte</b><div class="row">
  <label>Nom<input id="n_id" size="22"></label><label>N° de compte<input id="n_nbr" size="16"></label>
  <label>Banque<input id="n_bank" list="banks" size="14"><datalist id="banks">${m.banks.map(b => `<option>${esc(b)}</option>`).join('')}</datalist></label>
  <label>Type<select id="n_type">${m.types.map(t => `<option>${esc(t.name)}</option>`).join('')}</select></label>
  <label>Devise<select id="n_cur">${m.currencies.map(c => `<option>${c}</option>`).join('')}</select></label>
  <label>Dispo (année)<input id="n_av" size="5" value="0"></label><label>Fiscalité<input id="n_tax" size="5" value="0"></label>
  <label style="flex-direction:row;align-items:center"><input type="checkbox" id="n_bud"> en budget</label>
  <button class="primary" onclick="createAcc()">Créer</button></div><div id="n_err" class="err"></div>
  <div class="mut" style="font-size:12px">Compte de type « Courant » : saisie des montants (solde cumulé). Autres types : saisie du solde (le montant est la différence). Pour des titres cotés, créez le compte puis choisissez le mode « shares » dans la base si besoin.</div></div>
  <div class="card"><b>Devise principale</b> <span class="mut">(totaux, soldes et rendements de tous les comptes)</span><div class="row">
  <label>Devise<select id="m_cur">${[...new Set(m.currencies)].map(c => `<option ${c === m.master_currency ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
  <button onclick="setMaster()">Appliquer</button></div><div id="m_err" class="err"></div>
  <div class="mut" style="font-size:12px">Tous les montants, soldes et rendements sont recalculés ; la devise doit avoir des taux de change (l'euro n'en a pas besoin).</div></div>
  <div class="card"><b>Format des nombres</b> <span class="mut">(tous les montants et pourcentages de l'application)</span><div class="row">
  <label>Séparateur décimal<select id="nf_dec" onchange="numberFormatPreview()"><option value="."${f.decimal === '.' ? ' selected' : ''}>point ( . )</option><option value=","${f.decimal === ',' ? ' selected' : ''}>virgule ( , )</option></select></label>
  <label>Séparateur des milliers<input id="nf_th" size="3" value="${esc(f.thousands)}" placeholder="aucun" autocomplete="off" oninput="numberFormatPreview()"></label>
  <span class="mut">Aperçu : <b class="d" id="nf_preview"></b></span><button onclick="setNumberFormatting()">Appliquer</button></div><div id="nf_err" class="err"></div>
  <div class="mut" style="font-size:12px">Séparateur des milliers : laisser vide pour aucun, ou saisir un seul caractère (espace, apostrophe, point, virgule…), différent du séparateur décimal.</div></div>
  <div class="card"><b>Taux de change</b> <span class="mut">(unités de devise pour 1 € ; l'euro sert de pivot)</span><div class="row">
  <label>Devise<select id="x_cur" onchange="fxList()">${m.currencies.filter(c => c !== 'EUR').map(c => `<option>${c}</option>`).join('')}</select></label>
  <label>Date<input type="date" id="x_date" value="${new Date().toISOString().slice(0, 10)}"></label><label>Taux<input id="x_rate" size="8"></label><button onclick="addFx()">Ajouter</button></div>
  <div class="row"><button onclick="refreshRates()">Mettre à jour depuis Internet</button><span id="fx_status" class="mut"></span></div>
  <div class="mut" style="font-size:12px">Un taux par semaine (taux de référence de la BCE, via frankfurter.dev), depuis la plus ancienne donnée de chaque devise. Les semaines qui ont déjà un taux ne sont pas modifiées. Mise à jour automatique au démarrage de l'application si Internet est disponible ; les soldes sont alors recalculés.</div>
  <div id="fxl"></div></div>`;
  numberFormatPreview();
  await fxList();
}
async function setMaster(){
  try {
    await api('master_currency', 'POST', {currency: $('#m_cur').value});
    META = null;
    await admin('Devise principale modifiée : tous les montants ont été recalculés');
  } catch (e) { $('#m_err').textContent = e.message; }
}
const NUMBER_SAMPLE = -1234567.891;   // shown with the chosen separators, to see the result before applying them
function numberFormatPreview(){
  const format = {decimal: $('#nf_dec').value, thousands: $('#nf_th').value};
  $('#nf_preview').textContent = formatNumber(NUMBER_SAMPLE, 2, 2, format) + ' ' + sym(MASTER);
}
async function setNumberFormatting(){
  try {
    await api('number_format', 'POST', {decimal: $('#nf_dec').value, thousands: $('#nf_th').value});
    META = null;
    await admin('Format des nombres modifié');
  } catch (e) { $('#nf_err').textContent = e.message; }
}
async function refreshRates(){
  $('#fx_status').textContent = 'Mise à jour en cours…';
  try {
    const r = await api('fx/refresh', 'POST', {});
    META = null;
    await admin(r.message);
  } catch (e) { $('#fx_status').textContent = e.message; }
}
async function fxList(){
  const cur = $('#x_cur').value, rows = await api('fx?currency=' + cur);
  const fxRow = r => `<tr><td>${r.date}</td><td class="n">${formatNumber(r.rate, 0, 6)}</td></tr>`;
  $('#fxl').innerHTML = '<table>' + rows.slice(0, 12).map(fxRow).join('') + '</table>';
}
async function addFx(){ try { await api('fx', 'POST', {currency: $('#x_cur').value, date: $('#x_date').value, rate: $('#x_rate').value.replace(',', '.')}); await fxList(); } catch (e) { await errorDialog(e.message); } }
async function createAcc(){
  const v = i => $('#' + i).value;
  try {
    if (!v('n_id').trim()) throw new Error('Nom requis');
    await api('accounts', 'POST', {id: v('n_id').trim(), number: v('n_nbr'), bank: v('n_bank'), type: v('n_type'), currency: v('n_cur'), availability: v('n_av'), tax: v('n_tax'), in_budget: $('#n_bud').checked});
    location.hash = '#/account/' + enc(v('n_id').trim());
  } catch (e) { $('#n_err').textContent = e.message.includes('UNIQUE') ? 'Ce compte existe déjà' : e.message; }
}
window.addEventListener('DOMContentLoaded', route);   // first page, once the document is there
