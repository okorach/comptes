// Small SVG chart helpers. Vertical axis always uses "nice" round tick values (e.g. 0, 200k, 400k).
function niceStep(range, target){
  const raw = range / Math.max(1, target), mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  const m = [1, 2, 2.5, 5].find(x => f <= x) ?? 10;   // first of 1, 2, 2.5, 5 not below the raw step, else 10
  return m * mag;
}
function niceTicks(min, max, target = 5){
  if (min === max){ max = min + 1; }
  const step = niceStep(max - min, target);
  const lo = Math.floor(min / step + 1e-9) * step, hi = Math.ceil(max / step - 1e-9) * step, t = [];
  for (let v = lo; v <= hi + step * 1e-9; v += step) t.push(Math.round(v / step) * step);
  return {ticks: t, lo: t[0], hi: t.at(-1), step};
}
function fmtTick(v, step){
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toLocaleString('fr-FR', {maximumFractionDigits: 2}) + ' M';
  if (a >= 1e3) return (v / 1e3).toLocaleString('fr-FR', {maximumFractionDigits: step >= 1e3 ? 0 : 1}) + ' k';
  return v.toLocaleString('fr-FR', {maximumFractionDigits: 0});
}
const CHART_W = 1000, CHART_L = 56, CHART_R = 12, CHART_R2 = 56, CHART_T = 10, CHART_B = 28;
const charts = new Map();  // id -> {labels, series, from, to, height, R, opt}: state of each chart, used by the time window sliders and the hover
let chartSeq = 0;

const chartRightSide = s => s.axis === 'right';

/* Ticks of a secondary axis with exactly `count` intervals, so that its labels sit on the gridlines of the main axis:
   the smallest round step for which [mn, mx] fits in `count` steps */
function chartAlignedTicks(mn, mx, count){
  const lo0 = Math.min(mn, 0), hi0 = Math.max(mx, 0), mag = Math.pow(10, Math.floor(Math.log10(Math.max(hi0 - lo0, 1e-9) / count)) - 1);
  for (let step = mag; ; step *= 10){
    for (const m of [1, 2, 2.5, 5]){
      const st = m * step, below = Math.ceil(-lo0 / st - 1e-9), above = Math.ceil(hi0 / st - 1e-9);
      if (below + above > count) continue;
      const lo = -below * st;
      return {ticks: Array.from({length: count + 1}, (_, j) => lo + j * st), lo, hi: lo + count * st, step: st};
    }
  }
}

/* Scale of one vertical axis, fitted to the values of its series inside the time window.
   With `align` (the ticks of the main axis) the ticks are aligned on the ones of the main axis */
function chartAxisScale(c, list, align){
  const vals = list.flatMap(s => s.values.slice(c.from, c.to + 1).filter(v => v != null));
  if (!vals.length) return null;
  let mn = Math.min(...vals), mx = Math.max(...vals);
  if (list.some(s => s.type === 'bar')) { mn = Math.min(mn, 0); mx = Math.max(mx, 0); }
  const nt = align ? chartAlignedTicks(mn, mx, align.ticks.length - 1) : niceTicks(mn, mx, c.opt.ticks || 5);
  return {nt, y: v => CHART_T + (nt.hi - v) * (c.height - CHART_T - CHART_B) / (nt.hi - nt.lo)};
}

/* Left axis, optional right axis (series with axis:'right') and the common x scale */
function chartScale(c){
  const {series, from, to} = c, n = to - from + 1, plotW = CHART_W - CHART_L - c.R;
  const left = chartAxisScale(c, c.R === CHART_R ? series : series.filter(s => !chartRightSide(s)));
  if (!left) return null;
  const right = c.R === CHART_R ? null : chartAxisScale(c, series.filter(chartRightSide), left.nt);
  return {
    left, right,
    of: s => (chartRightSide(s) && right) || left,
    x: i => CHART_L + (n === 1 ? plotW / 2 : (i - from) * plotW / (n - 1)),
    bw: Math.max(1, plotW / n * 0.7),
  };
}

function chartAxes(c, sc){
  let g = '';
  for (const v of sc.left.nt.ticks){
    g += `<line x1="${CHART_L}" x2="${CHART_W - c.R}" y1="${sc.left.y(v)}" y2="${sc.left.y(v)}" stroke="currentColor" opacity="${v === 0 ? .35 : .12}"/>`;
    g += `<text x="${CHART_L - 6}" y="${sc.left.y(v) + 4}" font-size="11" text-anchor="end" opacity=".7">${fmtTick(v, sc.left.nt.step)}</text>`;
  }
  for (const v of sc.right ? sc.right.nt.ticks : []){
    g += `<text x="${CHART_W - c.R + 6}" y="${sc.right.y(v) + 4}" font-size="11" text-anchor="start" opacity=".7">${fmtTick(v, sc.right.nt.step)}</text>`;
  }
  const every = Math.ceil((c.to - c.from + 1) / (c.opt.xticks || 10));
  for (let i = c.from; i <= c.to; i++){
    if (i === c.to || ((i - c.from) % every === 0 && c.to - i >= every / 2))  // the last label is always shown: skip a regular one too close to it
      g += `<text x="${sc.x(i)}" y="${c.height - 8}" font-size="11" text-anchor="middle" opacity=".7">${c.labels[i]}</text>`;
  }
  return g;
}

function chartBars(c, sc, s){
  const ax = sc.of(s);
  let g = '';
  for (let i = c.from; i <= c.to; i++){
    const v = s.values[i];
    if (v == null) continue;
    const y0 = ax.y(0), y1 = ax.y(v), tip = `${c.labels[i]} : ${chartValue(c, v, s)}`;
    g += `<rect x="${sc.x(i) - sc.bw / 2}" y="${Math.min(y0, y1)}" width="${sc.bw}" height="${Math.abs(y1 - y0)}" fill="${s.color}" opacity=".75"><title>${tip}</title></rect>`;
  }
  return g;
}

/* Contiguous runs of points: each one gets a gradient area under the line (the "shadow") and a soft drop shadow on the line */
function chartLine(c, sc, s, gid){
  const ax = sc.of(s), runs = [[]];
  for (let i = c.from; i <= c.to; i++){
    if (s.values[i] == null) runs.push([]);
    else runs.at(-1).push([sc.x(i), ax.y(s.values[i])]);
  }
  const base = ax.y(ax.nt.lo), pt = (px, py) => `${px.toFixed(1)},${py.toFixed(1)}`;
  const defs = `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".35"/>` +
    `<stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>` +
    `<filter id="${gid}s" filterUnits="userSpaceOnUse" x="0" y="0" width="${CHART_W}" height="${c.height}">` +
    `<feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="${s.color}" flood-opacity=".45"/></filter>`;
  let g = '';
  for (const r of runs.filter(r => r.length)){
    const d = r.map(([px, py], k) => (k ? 'L' : 'M') + pt(px, py)).join('');
    if (r.length > 1) g += `<path d="${d}L${pt(r.at(-1)[0], base)}L${pt(r[0][0], base)}Z" fill="url(#${gid})" stroke="none"/>`;
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" filter="url(#${gid}s)"/>`;
  }
  return {defs, g};
}

function chartSvg(id){
  const c = charts.get(id), sc = chartScale(c);
  if (!sc) return '<div class="mut">Aucune donnée</div>';
  let g = chartAxes(c, sc), defs = '';
  c.series.forEach((s, k) => {
    if (s.type === 'bar') { g += chartBars(c, sc, s); return; }
    const line = chartLine(c, sc, s, `cg${id}_${k}`);
    defs += line.defs;
    g += line.g;
  });
  return `<svg viewBox="0 0 ${CHART_W} ${c.height}" width="100%" role="img"><defs>${defs}</defs>${g}</svg>`;
}

const chartWindowText = c => `${c.labels[c.from]} → ${c.labels[c.to]}`;

/* Two sliders under the horizontal axis (left = start, right = end) narrowing the chart to a time window */
function chartControls(c, id){
  const n = c.labels.length;
  if (n < 3) return '';
  const slider = (which, label, value) =>
    `<input type="range" id="chart-${which}-${id}" min="0" max="${n - 1}" step="1" value="${value}" aria-label="${label}" oninput="chartRange(${id},'${which}',this.value)">`;
  const pct = v => (v / CHART_W * 100).toFixed(2);
  return `<div class="chart-range" style="margin:0 ${pct(c.R)}% 0 ${pct(CHART_L)}%">${slider('from', 'Début', 0)}${slider('to', 'Fin', n - 1)}</div>`;
}

function chartRange(id, which, value){
  const c = charts.get(id);
  if (!c) return;
  const v = Number(value);
  if (which === 'from') c.from = Math.max(0, Math.min(v, c.to - 1));
  else c.to = Math.min(c.labels.length - 1, Math.max(v, c.from + 1));
  document.querySelector(`#chart-from-${id}`).value = c.from;
  document.querySelector(`#chart-to-${id}`).value = c.to;
  document.querySelector(`#chart-plot-${id}`).innerHTML = chartSvg(id);
  chartLeave(id);
  document.querySelector(`#chart-win-${id}`).textContent = chartWindowText(c);
}

/* Value with its unit: the one of the series (s.unit), else of the chart (opt.unit), € by default */
const chartValue = (c, v, s) => esc(`${Math.round(v).toLocaleString('fr-FR')} ${s?.unit ?? c.opt.unit ?? '€'}`);

/* Hover: a guide line, a dot on each line and a tooltip with the values of the data point below the mouse */
function chartPointAt(c, svgX){
  const n = c.to - c.from + 1, plotW = CHART_W - CHART_L - c.R;
  if (n === 1) return c.from;
  return Math.max(c.from, Math.min(c.to, c.from + Math.round((svgX - CHART_L) / plotW * (n - 1))));
}

function chartTip(c, sc, i, k, width){
  const x = sc.x(i) * k;
  const pts = c.series.filter(s => s.values[i] != null);
  const dots = pts.filter(s => s.type !== 'bar')
    .map(s => `<div class="chart-dot" style="left:${x}px;top:${sc.of(s).y(s.values[i]) * k}px;background:${s.color}"></div>`).join('');
  const rows = pts.map(s => `<div><span style="color:${s.color}">■</span> ${s.name ? esc(s.name) + ': ' : ''}<b>${chartValue(c, s.values[i], s)}</b></div>`).join('');
  const side = x > width / 2 ? `right:${width - x + 10}px` : `left:${x + 10}px`;
  const guide = `<div class="chart-guide" style="left:${x}px;top:${CHART_T * k}px;height:${(c.height - CHART_T - CHART_B) * k}px"></div>`;
  return `${guide}${dots}<div class="chart-tip" style="${side}"><div class="mut">${esc(c.labels[i])}</div>${rows}</div>`;
}

function chartHover(id, ev){
  const c = charts.get(id), sc = c && chartScale(c);
  if (!sc) return;
  const box = ev.currentTarget.getBoundingClientRect(), k = box.width / CHART_W;
  const svgX = (ev.clientX - box.left) / k;
  const inside = svgX >= CHART_L - 10 && svgX <= CHART_W - c.R + 10;
  document.querySelector(`#chart-hover-${id}`).innerHTML = inside ? chartTip(c, sc, chartPointAt(c, svgX), k, box.width) : '';
}

function chartLeave(id){
  document.querySelector(`#chart-hover-${id}`).innerHTML = '';
}

/* series: [{name, color, type:'line'|'bar', values:[...], axis?:'right' (secondary vertical axis), unit?}], labels: x labels */
function drawChart(labels, series, opt = {}){
  const n = labels.length;
  if (!n || !series.some(s => s.values.some(v => v != null))) return '<div class="mut">Aucune donnée</div>';
  const twoAxes = series.some(chartRightSide) && series.some(s => !chartRightSide(s));
  const id = ++chartSeq, c = {labels, series, from: 0, to: n - 1, height: opt.height || 280, R: twoAxes ? CHART_R2 : CHART_R, opt};
  charts.set(id, c);
  charts.delete(id - 50);  // the page only shows a few charts at a time: keep the registry bounded
  const leg = series.filter(s => s.name).map(s => `<span style="margin-right:12px"><span style="color:${s.color}">■</span> ${s.name}</span>`).join('');
  const win = n < 3 ? '' : `<span class="chart-window" id="chart-win-${id}">${chartWindowText(c)}</span>`;
  const wrap = `<div class="chart-wrap" onmousemove="chartHover(${id},event)" onmouseleave="chartLeave(${id})">` +
    `<div id="chart-plot-${id}">${chartSvg(id)}</div><div class="chart-hover" id="chart-hover-${id}"></div></div>`;
  return `<div id="chart-${id}"><div class="chart-scroll"><div class="chart-body">${wrap}${chartControls(c, id)}</div></div>` +
    `<div class="mut chart-legend"><span>${leg}</span>${win}</div></div>`;
}
if (typeof module !== 'undefined') module.exports = {niceTicks, niceStep, fmtTick};
