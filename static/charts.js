// Small SVG chart helpers. Vertical axis always uses "nice" round tick values (e.g. 0, 200k, 400k).
function niceStep(range, target){
  const raw = range / Math.max(1, target), mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return m * mag;
}
function niceTicks(min, max, target = 5){
  if (min === max){ max = min + 1; }
  const step = niceStep(max - min, target);
  const lo = Math.floor(min / step + 1e-9) * step, hi = Math.ceil(max / step - 1e-9) * step, t = [];
  for (let v = lo; v <= hi + step * 1e-9; v += step) t.push(Math.round(v / step) * step);
  return {ticks: t, lo: t[0], hi: t[t.length - 1], step};
}
function fmtTick(v, step){
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toLocaleString('fr-FR', {maximumFractionDigits: 2}) + ' M';
  if (a >= 1e3) return (v / 1e3).toLocaleString('fr-FR', {maximumFractionDigits: step >= 1e3 ? 0 : 1}) + ' k';
  return v.toLocaleString('fr-FR', {maximumFractionDigits: 0});
}
/* series: [{name, color, type:'line'|'bar', values:[...]}], labels: x labels */
let chartSeq = 0;
function drawChart(labels, series, opt = {}){
  const W = 1000, H = opt.height || 280, L = 56, R = 12, T = 10, B = 28, n = labels.length;
  const all = series.flatMap(s => s.values.filter(v => v != null));
  if (!n || !all.length) return '<div class="mut">Aucune donnée</div>';
  let mn = Math.min(...all), mx = Math.max(...all);
  if (series.some(s => s.type === 'bar')) { mn = Math.min(mn, 0); mx = Math.max(mx, 0); }
  const nt = niceTicks(mn, mx, opt.ticks || 5);
  const y = v => T + (nt.hi - v) * (H - T - B) / (nt.hi - nt.lo);
  const x = i => L + (n === 1 ? (W - L - R) / 2 : i * (W - L - R) / (n - 1));
  const bw = Math.max(1, (W - L - R) / n * 0.7);
  let g = '', defs = '';
  for (const v of nt.ticks){
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="currentColor" opacity="${v === 0 ? .35 : .12}"/>`;
    g += `<text x="${L - 6}" y="${y(v) + 4}" font-size="11" text-anchor="end" opacity=".7">${fmtTick(v, nt.step)}</text>`;
  }
  const every = Math.ceil(n / (opt.xticks || 10));
  labels.forEach((l, i) => { if (i % every === 0 || i === n - 1)
    g += `<text x="${x(i)}" y="${H - 8}" font-size="11" text-anchor="middle" opacity=".7">${l}</text>`; });
  for (const s of series){
    if (s.type === 'bar'){
      s.values.forEach((v, i) => { if (v == null) return;
        const y0 = y(0), y1 = y(v);
        g += `<rect x="${x(i) - bw / 2}" y="${Math.min(y0, y1)}" width="${bw}" height="${Math.abs(y1 - y0)}" fill="${s.color}" opacity=".75"><title>${labels[i]} : ${Math.round(v).toLocaleString('fr-FR')}</title></rect>`; });
    } else {
      // Contiguous runs of points: each one gets a gradient area under the line (the "shadow") and a soft drop shadow on the line
      const runs = [];
      s.values.forEach((v, i) => { if (v == null) { runs.push([]); } else { if (!runs.length) runs.push([]); runs[runs.length - 1].push([x(i), y(v)]); } });
      const gid = `cg${++chartSeq}`, base = y(nt.lo);
      defs += `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".35"/>` +
        `<stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>` +
        `<filter id="${gid}s" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="${s.color}" flood-opacity=".45"/></filter>`;
      for (const r of runs.filter(r => r.length)){
        const d = r.map(([px, py], k) => (k ? 'L' : 'M') + px.toFixed(1) + ',' + py.toFixed(1)).join('');
        if (r.length > 1) g += `<path d="${d}L${r[r.length - 1][0].toFixed(1)},${base.toFixed(1)}L${r[0][0].toFixed(1)},${base.toFixed(1)}Z" fill="url(#${gid})" stroke="none"/>`;
        g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" filter="url(#${gid}s)"/>`;
      }
    }
  }
  const leg = series.filter(s => s.name).map(s => `<span style="margin-right:12px"><span style="color:${s.color}">■</span> ${s.name}</span>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"><defs>${defs}</defs>${g}</svg><div class="mut" style="font-size:12px">${leg}</div>`;
}
if (typeof module !== 'undefined') module.exports = {niceTicks, niceStep, fmtTick};
