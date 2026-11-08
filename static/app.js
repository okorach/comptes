const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let MASTER = 'EUR';  // master currency of the application: totals, balances and yields of all the accounts are in it
const num = (v, cur = sym(MASTER)) => v == null ? '' : v.toLocaleString('fr-FR', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' ' + esc(cur);
const pct = v => v == null ? '–' : (v * 100).toLocaleString('fr-FR', {minimumFractionDigits: 1, maximumFractionDigits: 1}) + ' %';
const cls = v => v < 0 ? 'neg' : '';
const sym = c => ({EUR: '€', CHF: 'CHF', USD: '$', GBP: '£'}[c] || c);
async function api(path, method = 'GET', body){
  const r = await fetch('/api/' + path, {method, headers: {'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
  const j = await r.json();
  if (j && j.error) throw new Error(j.error);
  return j;
}
let META = null;
const meta = async () => {
  META = META || await api('meta');
  MASTER = /^[A-Z]{3}$/.exec(String(META.master_currency))?.[0] ?? 'EUR';  // a currency code, nothing else
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
    else if (name === 'account') await account(decodeURIComponent(rest.join('/')));
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

/* ------------------------------------------------------------------ home */
async function home(){
  const open = $('#openOnly') ? $('#openOnly').checked : true;
  const [acc, nw] = await Promise.all([api('accounts'), api('networth?open=' + (open ? 1 : 0)), meta()]);
  const shown = acc.filter(a => !open || a.status === 'Open');
  const total = shown.reduce((s, a) => s + a.balance_main, 0);
  const sumBy = f => { const o = {}; shown.forEach(a => { const k = f(a) || '–'; o[k] = (o[k] || 0) + a.balance_main; }); return Object.entries(o).sort((a, b) => b[1] - a[1]); };
  const tbl = rows => `<table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n ${cls(v)}">${num(v)}</td></tr>`).join('')}</table>`;
  const byYear = {}; shown.forEach(a => { const k = a.availability || 0; byYear[k] = (byYear[k] || 0) + a.balance_main; });
  $('#main').innerHTML = `<div class="mut">Patrimoine</div><div class="big">${num(total)}</div>
  <label><input type="checkbox" id="openOnly" ${open ? 'checked' : ''} onchange="home()"> comptes ouverts seulement</label>
  ${drawChart(nw.map(p => p.month), [
    {name: `Épargne mensuelle (moy. ${SAVINGS_MONTHS} mois)`, color: 'var(--pos-light)', type: 'bar', axis: 'right', unit: sym(MASTER) + '/mois', values: monthlySavings(nw.map(p => p.total))},
    {name: 'Patrimoine', color: 'var(--acc)', type: 'line', values: nw.map(p => p.total)}], {xticks: 12, unit: sym(MASTER)})}
  <div class="row" style="align-items:start"><div style="flex:1;min-width:260px"><h3>Par banque</h3>${tbl(sumBy(a => a.bank))}</div>
  <div style="flex:1;min-width:260px"><h3>Par année de disponibilité</h3>${tbl(Object.entries(byYear).sort((a, b) => a[0] - b[0]).map(([k, v]) => [k === '0' ? 'Immédiate' : k, v]))}</div>
  <div style="flex:1;min-width:260px"><h3>Par type</h3>${tbl(sumBy(a => a.type))}</div></div>
  <h3>Comptes</h3>${dataTable(homeColumns(), shown.sort((a, b) => b.balance_main - a.balance_main), homeRow, {noun: 'comptes'})}`;
}
const homeColumns = () => [
  {label: 'Compte', value: a => a.id}, {label: 'Type', value: a => a.type}, {label: 'Banque', value: a => a.bank},
  {label: 'Dispo.', value: a => a.availability || null}, {label: 'Dernière date', value: a => a.last_date},
  {label: 'Solde (devise)', num: true, value: a => a.currency === MASTER ? null : a.balance_native}, {label: 'Solde ' + sym(MASTER), num: true, value: a => a.balance_main},
];
const homeRow = a => `<tr class="click" onclick="location.hash='#/account/${enc(a.id)}'"><td>${esc(a.id)}</td><td>${esc(a.type)}</td><td>${esc(a.bank)}</td><td>${a.availability || ''}</td><td>${a.last_date || ''}</td><td class="n mut">${a.currency === MASTER ? '' : num(a.balance_native, sym(a.currency))}</td><td class="n ${cls(a.balance_main)}">${num(a.balance_main)}</td></tr>`;

/* ------------------------------------------------------------------ spending */
let SP = {group: 'month', months: 36, exclude: null};
async function spending(){
  const m = await meta();
  const q = `spending?group=${SP.group}&months=${SP.months}` + (SP.exclude ? `&exclude=${enc(SP.exclude.join(','))}` : '');
  const r = await api(q);
  SP.exclude = r.excluded;
  const s = r.series;
  const periods = s.map(x => x.period);
  const chips = r.all_categories.concat(r.all_categories.includes('(sans catégorie)') ? [] : ['(sans catégorie)']).map(c =>
    `<label><input type="checkbox" ${r.excluded.includes(c) ? '' : 'checked'} onchange="toggleCat('${jsq(c)}',this.checked)"> ${esc(c)}</label>`).join('');
  const cats = Object.keys(r.matrix).sort((a, b) => (r.categories.findIndex(x => x.category === a)) - (r.categories.findIndex(x => x.category === b)));
  $('#main').innerHTML = `<h2>Dépenses</h2>
  <div class="row"><label>Regroupement<select onchange="SP.group=this.value;spending()">${[['month', 'Mois'], ['quarter', 'Trimestre'], ['year', 'Année']].map(([v, l]) => `<option value="${v}" ${SP.group === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
  <label>Période<select onchange="SP.months=+this.value;spending()">${[[12, '12 mois'], [24, '24 mois'], [36, '3 ans'], [60, '5 ans'], [120, '10 ans'], [600, 'Tout']].map(([v, l]) => `<option value="${v}" ${SP.months === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
  <div class="chips"><span class="mut">Catégories incluses :</span> ${chips}</div>
  <div class="mut" style="font-size:12px;margin:4px 0">Dépenses = −montant sur les comptes « en budget ». Les écritures avec un nombre N (&gt;1) dans « In Budget » sont lissées sur N mois.</div>
  ${drawChart(periods, [{name: 'Dépenses lissées', color: 'var(--acc)', type: 'bar', values: s.map(x => x.spread)}].concat(SP.group === 'month' ? [{name: 'Moyenne 12 mois', color: 'var(--neg)', type: 'line', values: s.map(x => x.avg12)}] : []), {xticks: 12, unit: sym(MASTER)})}
  <div class="row" style="align-items:start"><div style="flex:1;min-width:300px"><h3>Par catégorie</h3><table><tr><th>Catégorie</th><th class="n">Total</th><th class="n">%</th></tr>
  ${r.categories.map(c => `<tr><td>${esc(c.category)}</td><td class="n ${cls(-c.total)}">${num(c.total)}</td><td class="n">${pct(c.pct)}</td></tr>`).join('')}</table></div>
  <div style="flex:1;min-width:300px"><h3>Par période</h3><div class="scroll" style="max-height:420px;overflow-y:auto"><table><tr><th>Période</th><th class="n">Lissées</th><th class="n">Brutes</th>${SP.group === 'month' ? '<th class="n">Moy. 12 mois</th>' : ''}</tr>
  ${s.slice().reverse().map(x => `<tr><td>${x.period}</td><td class="n">${num(x.spread)}</td><td class="n">${num(x.raw)}</td>${SP.group === 'month' ? `<td class="n">${num(x.avg12)}</td>` : ''}</tr>`).join('')}</table></div></div></div>
  <h3>Catégorie × période</h3><div class="scroll"><table><tr><th>Catégorie</th>${periods.map(p => `<th class="n">${p}</th>`).join('')}</tr>
  ${cats.map(c => `<tr><td>${esc(c)}</td>${periods.map(p => `<td class="n">${r.matrix[c][p] != null ? Math.round(r.matrix[c][p]).toLocaleString('fr-FR') : ''}</td>`).join('')}</tr>`).join('')}</table></div>`;
}
function toggleCat(c, included){
  const set = new Set(SP.exclude || []); included ? set.delete(c) : set.add(c);
  SP.exclude = [...set]; if (!SP.exclude.length) SP.exclude = ['']; void spending();
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
function txRow(t, foreign, aid, hasFx = false){
  const native = foreign ? `<td class="n mut">${num(t.native_amount, '')}</td><td class="n mut">${num(t.native_balance, '')}</td>` : '';
  const origin = hasFx ? `<td class="n mut">${num(t.fx_amount, '')}</td><td>${esc(t.fx_currency)}</td>` : '';
  const budget = t.in_budget ? ` <span class="mut">(${esc(t.in_budget)})</span>` : '';
  return `<tr><td>${esc(t.date)}</td><td class="n ${cls(t.amount_main)}">${num(t.amount_main)}</td><td class="n">${num(t.balance_main)}</td>${native}${origin}<td>${esc(t.description)}</td><td>${esc(t.subcategory)}${budget}</td>
  <td><button class="link" onclick="editTx(${esc(JSON.stringify(t))})">modifier</button><button class="link" onclick="delTx(${Number(t.id)},'${jsq(aid)}')">suppr.</button></td></tr>`;
}
const NATIVE_KEY = {y1: 'n1', y3: 'n3', y5: 'n5', y8: 'n8', y_all: 'n_all'};
const INTEREST_PERIODS = [['1 an', 'y1'], ['3 ans', 'y3'], ['5 ans', 'y5'], ['8 ans', 'y8'], ['Depuis le début', 'y_all']];
/* Yield in EUR, followed (in small) by the yield in the currency of the account, without the exchange rate effect */
const nativeRateHtml = (native, currency) => {
  if (native == null || !currency || currency === MASTER) return '';
  const neg = native < 0 ? 'neg' : '';
  return ` <small class="mut ${neg}" title="Rendement en ${esc(currency)}, hors effet de change">${pct(native)} ${esc(currency)}</small>`;
};
const rateHtml = (v, native, currency) => {
  if (v == null) return '<span class="mut">–</span>';
  return `<span class="${v < 0 ? 'neg' : ''}">${pct(v)}</span>${nativeRateHtml(native, currency)}`;
};
const calcDate = r => (r.calc_date || '').replace('T', ' ').slice(0, 16);
const interestRow = r => `<tr class="click" onclick="location.hash='#/account/${enc(r.account)}'"><td>${esc(r.account)}</td><td>${esc(r.type)}</td><td>${calcDate(r)}</td>${rateCells(r)}</tr>`;
const rateCells = r => Object.entries(NATIVE_KEY).map(([y, n]) => `<td class="n">${rateHtml(r[y], r[n], r.currency)}</td>`).join('');
const INTEREST_COLUMNS = [
  {label: 'Compte', value: r => r.account}, {label: 'Type', value: r => r.type}, {label: 'Calculé le', value: r => calcDate(r)},
  ...INTEREST_PERIODS.map(([label, key]) => ({label, num: true, filter: false, value: r => r[key]})),
];

function interestsTable(interests, currency){
  if (!interests) return '<div class="mut">Pas encore calculé</div>';
  const rows = INTEREST_PERIODS.map(([l, k]) => `<tr><td>${l}</td><td class="n">${rateHtml(interests[k], interests[NATIVE_KEY[k]], currency)}</td></tr>`).join('');
  return `<table>${rows}</table>`;
}
function depositRow(d, aid){
  return `<tr><td>${esc(d.date)}</td><td class="n">${num(d.amount_main)}</td><td><button class="link" onclick="delDep(${Number(d.id)},'${jsq(aid)}')">suppr.</button></td></tr>`;
}
function depositsPanel(info, a, cur){
  return `<div style="flex:1;min-width:260px"><h3>Rendements nets</h3>${interestsTable(info.interests, a.currency)}
  <button onclick="recalcOne('${jsq(a.id)}')">Recalculer</button>
  <h3>Versements</h3><div class="row"><label>Date<input type="date" id="d_date" value="${new Date().toISOString().slice(0, 10)}"></label><label>Montant (${cur})<input id="d_amt" size="10"></label><button onclick="addDep('${jsq(a.id)}')">Ajouter</button></div>
  <div class="scroll" style="max-height:340px;overflow-y:auto"><table>${info.deposits.map(d => depositRow(d, a.id)).join('')}</table></div></div>`;
}
const txColumns = (foreign, cur, hasFx) => [
  {label: 'Date', value: t => t.date}, {label: 'Montant ' + sym(MASTER), num: true, value: t => t.amount_main}, {label: 'Solde ' + sym(MASTER), num: true, value: t => t.balance_main},
  ...(foreign ? [{label: `Montant ${cur}`, num: true, value: t => t.native_amount}, {label: `Solde ${cur}`, num: true, value: t => t.native_balance}] : []),
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
async function account(id, msg = ''){
  const [info, tr, m] = await Promise.all([api('account/' + enc(id)), api('account/' + enc(id) + '/transactions?limit=500'), meta()]);
  const a = info.account, cur = esc(sym(a.currency)), foreign = a.currency !== MASTER;
  const hasDep = !['Courant', 'Autres', null].includes(a.type);
  const bank = a.bank || '';
  const hasFx = tr.some(t => t.fx_currency);
  const subOpts = '<option value=""></option>' + m.categories.map(c => `<option>${esc(c.subcategory)}</option>`).join('');
  const fields = modeFields(a, m, cur);
  const importBanks = ['BoursoBank', 'ING', 'LCL', 'UBS', 'Revolut', 'Yuh', 'generic'];
  $('#main').innerHTML = `<h2>${esc(a.id)} <span class="mut" style="font-size:13px">${esc(a.type)} · ${esc(bank)} · ${esc(a.currency)} · ${esc(a.status)}${a.availability ? " · dispo " + esc(a.availability) : ""}</span></h2>
  <div class="row"><button onclick="location.hash='#/'">← Retour</button>
  <button onclick="setStatus('${jsq(a.id)}','${a.status === 'Open' ? 'Closed' : 'Open'}')">${a.status === 'Open' ? 'Clôturer' : 'Rouvrir'} le compte</button>
  <a href="/api/account/${enc(a.id)}/export.csv"><button>Exporter CSV</button></a>
  ${a.mode === 'flow' || a.mode === 'static' ? `<label style="flex-direction:row;align-items:center;gap:6px">Importer <select id="imp_bank">${importBanks.map(b => `<option ${b === bank ? 'selected' : ''}>${b}</option>`).join('')}</select><input type="file" id="imp_file" accept=".csv,.xlsx,.txt" onchange="importPreview('${jsq(a.id)}')"></label>` : ''}</div>
  <div id="imp"></div><div class="ok">${esc(msg)}</div>
  <div class="card"><b id="form_title">Nouvelle écriture</b><div class="row"><label>Date<input type="date" id="f_date" value="${new Date().toISOString().slice(0, 10)}"></label>${fields}
  <label>Description<input id="f_desc" size="34"></label><label>Sous-catégorie<select id="f_sub">${subOpts}</select></label>
  ${a.in_budget ? '<label>Lissage (mois)<input id="f_bud" size="4" placeholder="vide"></label>' : ''}
  <button class="primary" onclick="saveTx('${jsq(a.id)}')">Enregistrer</button><button onclick="resetForm()">Annuler</button></div><div id="form_err" class="err"></div></div>
  <div class="row" style="align-items:start"><div style="flex:3;min-width:520px">${dataTable(txColumns(foreign, sym(a.currency), hasFx), tr, t => txRow(t, foreign, a.id, hasFx), {noun: 'écritures (les plus récentes)'})}</div>
  ${hasDep ? depositsPanel(info, a, cur) : ''}</div>`;
  EDIT = null;
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
async function delTx(tid, id){ if (confirm('Supprimer cette écriture ?')) { await api('transaction/' + tid, 'DELETE'); await account(id, 'Écriture supprimée'); } }
async function setStatus(id, status){ await api('account/' + enc(id), 'PUT', {status}); await account(id); }
async function recalcOne(id){ await api('interests/recalc', 'POST', {account: id}); await account(id, 'Rendements recalculés'); }
async function addDep(id){ try { await api('account/' + enc(id) + '/deposits', 'POST', {date: $('#d_date').value, amount: $('#d_amt').value}); await account(id, 'Versement ajouté'); } catch (e) { alert(e.message); } }
async function delDep(did, id){ await api('deposit/' + did, 'DELETE'); await account(id); }

/* import */
let IMPORT = null;
function b64(buf){ let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
async function importPreview(id){
  const f = $('#imp_file').files[0]; if (!f) return;
  IMPORT = {filename: f.name, data: b64(await f.arrayBuffer()), bank: $('#imp_bank').value};
  try {
    const r = await api('account/' + enc(id) + '/import', 'POST', IMPORT);
    $('#imp').innerHTML = `<div class="card"><b>Import de ${esc(f.name)}</b> : ${r.new.length} nouvelle(s) écriture(s), ${r.duplicates} doublon(s) ignoré(s).
    ${r.new.length ? `<div class="scroll" style="max-height:240px;overflow-y:auto"><table>${r.new.slice(0, 200).map(p => `<tr><td>${p.date}</td><td class="n ${cls(p.amount)}">${num(p.amount)}</td><td>${esc(p.description)}</td></tr>`).join('')}</table></div>
    <button class="primary" onclick="importCommit('${jsq(id)}')">Importer ${r.new.length} écritures</button>` : ''}<button onclick="$('#imp').innerHTML=''">Fermer</button></div>`;
  } catch (e) { $('#imp').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}
async function importCommit(id){ const r = await api('account/' + enc(id) + '/import', 'POST', {...IMPORT, commit: true}); await account(id, `${r.new.length} écritures importées`); }

/* ------------------------------------------------------------------ admin */
async function admin(msg = ''){
  const m = await meta();
  const fx = await api('fx?currency=CHF');
  $('#main').innerHTML = `<h2>Administration</h2><div class="ok">${msg}</div>
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
  <div class="card"><b>Taux de change</b> <span class="mut">(unités de devise pour 1 € ; l'euro sert de pivot)</span><div class="row">
  <label>Devise<select id="x_cur" onchange="fxList()">${m.currencies.filter(c => c !== 'EUR').map(c => `<option>${c}</option>`).join('')}</select></label>
  <label>Date<input type="date" id="x_date" value="${new Date().toISOString().slice(0, 10)}"></label><label>Taux<input id="x_rate" size="8"></label><button onclick="addFx()">Ajouter</button></div>
  <div id="fxl"></div></div>`;
  await fxList();
}
async function setMaster(){
  try {
    await api('master_currency', 'POST', {currency: $('#m_cur').value});
    META = null;
    await admin('Devise principale modifiée : tous les montants ont été recalculés');
  } catch (e) { $('#m_err').textContent = e.message; }
}
async function fxList(){
  const cur = $('#x_cur').value, rows = await api('fx?currency=' + cur);
  $('#fxl').innerHTML = `<table>${rows.slice(0, 12).map(r => `<tr><td>${r.date}</td><td class="n">${r.rate}</td></tr>`).join('')}</table>`;
}
async function addFx(){ try { await api('fx', 'POST', {currency: $('#x_cur').value, date: $('#x_date').value, rate: $('#x_rate').value.replace(',', '.')}); await fxList(); } catch (e) { alert(e.message); } }
async function createAcc(){
  const v = i => $('#' + i).value;
  try {
    if (!v('n_id').trim()) throw new Error('Nom requis');
    await api('accounts', 'POST', {id: v('n_id').trim(), number: v('n_nbr'), bank: v('n_bank'), type: v('n_type'), currency: v('n_cur'), availability: v('n_av'), tax: v('n_tax'), in_budget: $('#n_bud').checked});
    location.hash = '#/account/' + enc(v('n_id').trim());
  } catch (e) { $('#n_err').textContent = e.message.includes('UNIQUE') ? 'Ce compte existe déjà' : e.message; }
}
void route();
