/* Tables with, on each column, a filter ("only the rows where this column has this value") and a sort button (ascending / descending) */
const TABLE_SELECT_MAX = 25;  // up to this number of distinct values, the filter of a column is a drop-down list; beyond, a free text search
const tables = new Map();     // id -> {cols, rows, row, noun, filters, sort}: state of each table
let tableSeq = 0;

const tableText = (col, r) => String(col.value(r) ?? '');
const tableFold = s => s.normalize('NFD').replaceAll(/[̀-ͯ]/g, '').toLowerCase();  // case and accent insensitive search

/* Rows matching the filters of all the columns: an exact value for a drop-down list, a substring for a text search */
function tableMatches(t, r){
  return t.cols.every((col, i) => {
    const f = t.filters[i];
    if (f == null) return true;
    const txt = tableText(col, r);
    return col.options ? txt === f : tableFold(txt).includes(tableFold(f));
  });
}

function tableCompare(a, b){
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'fr', {numeric: true, sensitivity: 'base'});
}

/* Filtered then sorted rows. Empty values always come last, whatever the direction */
function tableRows(t){
  const rows = t.rows.filter(r => tableMatches(t, r));
  if (!t.sort) return rows;
  const col = t.cols[t.sort.col], dir = t.sort.dir === 'desc' ? -1 : 1;
  return rows.sort((x, y) => {
    const a = col.value(x), b = col.value(y);
    if (a == null || b == null) return (a == null) - (b == null);
    return dir * tableCompare(a, b);
  });
}

const SORT_MARK = {asc: '▲', desc: '▼'};
const SORT_LABEL = {asc: 'Tri croissant', desc: 'Tri décroissant'};

function tableCount(t, shown){
  const total = t.rows.length;
  return shown === total ? `${total} ${t.noun}` : `${shown} / ${total} ${t.noun}`;
}

/* Redraws the body, the counter and the sort marks (the header and its filters stay untouched, so a text being typed is not lost) */
function tableRefresh(id){
  const t = tables.get(id);
  if (!t) return;
  const rows = tableRows(t);
  $('#tb-' + id).innerHTML = rows.length ? rows.map(t.row).join('') : `<tr><td colspan="${t.cols.length}" class="mut s">Aucune ligne</td></tr>`;
  $('#tc-' + id).textContent = tableCount(t, rows.length);
  t.cols.forEach((col, i) => {
    const dir = t.sort?.col === i ? t.sort.dir : null, btn = $(`#ts-${id}-${i}`);
    if (!btn) return;
    btn.textContent = SORT_MARK[dir] || '⇅';
    btn.title = SORT_LABEL[dir] || 'Trier';
    btn.classList.toggle('on', dir != null);
  });
}

function tableFilter(id, i, raw){
  const t = tables.get(id);
  if (!t) return;
  const col = t.cols[i], text = String(raw).trim();
  if (col.options) t.filters[i] = raw === '' ? null : col.options[Number(raw)];
  else t.filters[i] = text === '' ? null : text;
  tableRefresh(id);
}

/* Successive clicks on the same column: ascending, descending, back to the original order */
function tableSort(id, i){
  const t = tables.get(id);
  if (!t) return;
  if (t.sort?.col !== i) t.sort = {col: i, dir: 'asc'};
  else t.sort = t.sort.dir === 'asc' ? {col: i, dir: 'desc'} : null;
  tableRefresh(id);
}

function tableHeadCell(id, col, i){
  const btn = col.sort === false ? '' : ` <button class="sort" id="ts-${id}-${i}" title="Trier" aria-label="Trier par ${esc(col.label)}" onclick="tableSort(${id},${i})">⇅</button>`;
  return `<th class="${col.num ? 'n' : ''}">${esc(col.label)}${btn}</th>`;
}

function tableFilterCell(id, col, i){
  if (col.filter === false) return '<th></th>';
  const cell = col.num ? '<th class="n">' : '<th>';  // the filter of a numeric column sits under its right-aligned header
  const label = `aria-label="Filtrer ${esc(col.label)}"`;
  if (!col.options) return `${cell}<input type="search" ${label} placeholder="filtrer" size="8" oninput="tableFilter(${id},${i},this.value)"></th>`;
  const opts = col.options.map((o, k) => `<option value="${k}">${esc(o) || '(vide)'}</option>`).join('');
  return `${cell}<select ${label} onchange="tableFilter(${id},${i},this.value)"><option value="">(tous)</option>${opts}</select></th>`;
}

/* Drop-down list of the distinct values when there are few of them */
function tableWithOptions(col, rows){
  if (col.filter === false || col.filter === 'text') return col;
  const distinct = [...new Set(rows.map(r => tableText(col, r)))];
  return distinct.length <= TABLE_SELECT_MAX ? {...col, options: distinct.toSorted(tableCompare)} : col;
}

/* cols: [{label, value: row => sortable/filterable value, num?: right-aligned, sort?: false, filter?: false | 'text'}], row: row => '<tr>…</tr>'.
   opt: {noun: what the rows are called in the counter, style: style of the scrolling container} */
function dataTable(cols, rows, row, opt = {}){
  const id = ++tableSeq, c = cols.map(col => tableWithOptions(col, rows));
  const t = {cols: c, rows, row, noun: opt.noun || 'lignes', filters: c.map(() => null), sort: null};
  tables.set(id, t);
  tables.delete(id - 50);  // the page only shows a few tables at a time: keep the registry bounded
  const head = c.map((col, i) => tableHeadCell(id, col, i)).join(''), filters = c.map((col, i) => tableFilterCell(id, col, i)).join('');
  return `<div class="scroll" style="${opt.style || ''}"><table class="data"><thead><tr>${head}</tr><tr class="filters">${filters}</tr></thead>` +
    `<tbody id="tb-${id}">${rows.map(row).join('')}</tbody></table></div><div class="mut" id="tc-${id}">${tableCount(t, rows.length)}</div>`;
}
