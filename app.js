(() => {
'use strict';

const JORNADA = 8 * 60 + 24;      // 8h24 líquidas (21:00 -> 06:24 com 1h de intervalo)
const INTERVALO_PADRAO = 60;
const SAIDA_INT_APOS = 180;       // intervalo sugerido 3h após a entrada
const KEY = 'ponto:v1';
const TIPOS = { folga: 'Folga', feriado: 'Feriado', compensacao: 'Compensação', falta: 'Falta' };
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const FIELDS = ['entrada', 'saidaInt', 'volta', 'saida'];

// ---------- estado ----------
let state = { theme: null, days: {} };
try {
  const raw = localStorage.getItem(KEY);
  if (raw) state = Object.assign(state, JSON.parse(raw));
} catch (e) {}
function persist() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

// ---------- helpers ----------
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const fmtHM = m => { m = ((m % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
const fmtDur = m => { const a = Math.abs(m); return `${pad(Math.floor(a / 60))}:${pad(a % 60)}`; };
const fmtSaldo = (m, ascii) => (m === 0 ? '' : m > 0 ? '+' : (ascii ? '-' : '−')) + fmtDur(m);
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtBR = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

// ---------- cálculo ----------
// Retorna minutos absolutos (desenrolando a virada de dia) de cada campo preenchido.
function unwrap(rec) {
  const out = {}; let prev = null;
  for (const f of FIELDS) {
    if (!rec[f]) continue;
    let m = toMin(rec[f]);
    if (prev !== null) while (m < prev) m += 1440;
    out[f] = m; prev = m;
  }
  return out;
}

function calc(rec) {
  const r = { worked: null, saldo: null, expected: null };
  if (!rec) return r;
  if (rec.tipo === 'falta') { r.saldo = -JORNADA; return r; }
  if (rec.tipo && rec.tipo !== 'trabalho') { r.saldo = 0; return r; }
  const t = unwrap(rec);
  if (t.entrada !== undefined) {
    const interval = (t.saidaInt !== undefined && t.volta !== undefined) ? t.volta - t.saidaInt : INTERVALO_PADRAO;
    r.expected = fmtHM(t.entrada + JORNADA + interval);
  }
  if (t.entrada !== undefined && t.saida !== undefined) {
    const interval = (t.saidaInt !== undefined && t.volta !== undefined) ? t.volta - t.saidaInt : 0;
    r.worked = t.saida - t.entrada - interval;
    r.saldo = r.worked - JORNADA;
  }
  return r;
}

// Sugestões (placeholders) a partir do que já foi preenchido
function suggestions(rec) {
  const s = {};
  if (!rec.entrada) return s;
  const e = toMin(rec.entrada);
  const sInt = rec.saidaInt ? unwrap(rec).saidaInt : e + SAIDA_INT_APOS;
  if (!rec.saidaInt) s.saidaInt = fmtHM(sInt);
  const tt = unwrap(rec);
  const volta = rec.volta ? tt.volta : sInt + INTERVALO_PADRAO;
  if (!rec.volta) s.volta = fmtHM(volta);
  if (!rec.saida) s.saida = fmtHM(e + JORNADA + (volta - sInt));
  return s;
}

// ---------- períodos (21 -> 20) ----------
function periodEndingIn(year, month) { // month 0-based: período que termina dia 20 desse mês
  return { start: new Date(year, month - 1, 21), end: new Date(year, month, 20) };
}
function periodFor(d) {
  return d.getDate() >= 21 ? periodEndingIn(d.getFullYear(), d.getMonth() + 1) : periodEndingIn(d.getFullYear(), d.getMonth());
}
function eachDay(p) {
  const list = [];
  for (let d = new Date(p.start); d <= p.end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) list.push(new Date(d));
  return list;
}
function totals(p) {
  let worked = 0, saldo = 0, folgas = 0, faltas = 0, extra = 0, deve = 0;
  for (const d of eachDay(p)) {
    const rec = state.days[keyOf(d)];
    if (!rec) continue;
    const c = calc(rec);
    if (c.worked != null) worked += c.worked;
    if (c.saldo != null) { saldo += c.saldo; if (c.saldo > 0) extra += c.saldo; else deve -= c.saldo; }
    if (rec.tipo === 'falta') faltas++;
    else if (rec.tipo && rec.tipo !== 'trabalho') folgas++;
  }
  return { worked, saldo, folgas, faltas, extra, deve };
}

// ---------- tema ----------
function applyTheme() {
  const t = state.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = t;
  $('btnTheme').textContent = t === 'dark' ? '☀️' : '🌙';
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.content = t === 'dark' ? '#0f1115' : '#f2f3f7';
}
$('btnTheme').onclick = () => {
  state.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  persist(); applyTheme();
};

// ---------- calendário ----------
let view = new Date(); view.setDate(1);

function render() {
  $('monthLabel').textContent = view.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const grid = $('grid'); grid.innerHTML = '';
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  for (let i = 0; i < first.getDay(); i++) grid.insertAdjacentHTML('beforeend', '<div class="day empty"></div>');
  const todayKey = keyOf(new Date());
  for (let n = 1; n <= days; n++) {
    const d = new Date(view.getFullYear(), view.getMonth(), n);
    const k = keyOf(d), rec = state.days[k];
    let cls = 'day', sub = '';
    if (k === todayKey) cls += ' today';
    if (rec) {
      const c = calc(rec);
      if (rec.tipo && rec.tipo !== 'trabalho') { cls += ' ' + rec.tipo; sub = rec.tipo === 'falta' ? fmtSaldo(c.saldo) : TIPOS[rec.tipo].slice(0, 5); }
      else if (c.saldo != null) { cls += c.saldo >= 0 ? ' ok' : ' neg'; sub = c.saldo === 0 ? '0' : fmtSaldo(c.saldo); }
      else { cls += ' partial'; sub = c.expected ? '→' + c.expected : '…'; }
    }
    grid.insertAdjacentHTML('beforeend', `<button class="${cls}" data-k="${k}"><span class="n">${n}</span><span class="s">${sub}</span></button>`);
  }
  renderSummary();
}
$('grid').onclick = e => { const b = e.target.closest('.day[data-k]'); if (b) openDay(b.dataset.k); };
$('prev').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); render(); };
$('next').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); render(); };

function renderSummary() {
  const p = periodFor(new Date()), t = totals(p);
  const cls = t.saldo > 0 ? 'pos' : t.saldo < 0 ? 'negc' : '';
  $('summary').innerHTML = `
    <div class="range">Período atual: ${fmtBR(p.start)} a ${fmtBR(p.end)}</div>
    <div class="stats">
      <div class="stat"><small>Trabalhado</small><b>${fmtDur(t.worked)}</b></div>
      <div class="stat"><small>Saldo</small><b class="${cls}">${t.saldo === 0 ? '00:00' : fmtSaldo(t.saldo)}</b></div>
      <div class="stat"><small>Folgas / Faltas</small><b>${t.folgas} / ${t.faltas}</b></div>
    </div>`;
}

// ---------- sheet do dia ----------
let curKey = null, curTipo = 'trabalho';
const inputs = Object.fromEntries(FIELDS.map(f => [f, $('f_' + f)]));

function show(sheet, bd) { $(sheet).hidden = false; $(bd).hidden = false; }
function hide(sheet, bd) { $(sheet).hidden = true; $(bd).hidden = true; }

function openDay(k) {
  curKey = k;
  const [y, m, d] = k.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  $('dayTitle').textContent = `${DIAS[date.getDay()]}, ${pad(d)}/${pad(m)}/${y}`;
  const rec = state.days[k] || {};
  curTipo = rec.tipo || 'trabalho';
  FIELDS.forEach(f => inputs[f].value = rec[f] || '');
  $('f_obs').value = rec.obs || '';
  show('daySheet', 'dayBackdrop');
  refresh();
}
const closeDay = () => hide('daySheet', 'dayBackdrop');
$('dayClose').onclick = closeDay; $('dayBackdrop').onclick = closeDay;

function formRec() {
  const rec = { tipo: curTipo, obs: $('f_obs').value.trim() };
  FIELDS.forEach(f => rec[f] = inputs[f].value);
  return rec;
}

function refresh() {
  document.querySelectorAll('#chips button').forEach(b => b.classList.toggle('on', b.dataset.tipo === curTipo));
  $('timeFields').hidden = curTipo !== 'trabalho';
  const rec = formRec();
  const sug = curTipo === 'trabalho' ? suggestions(rec) : {};
  FIELDS.forEach(f => {
    const h = document.querySelector(`.field[data-f=${f}] .hint`);
    if (sug[f]) { h.hidden = false; h.textContent = `sugerido ${sug[f]} · toque p/ usar`; h.dataset.v = sug[f]; }
    else h.hidden = true;
  });
  const c = calc(rec), live = $('live'), lines = [];
  if (curTipo === 'falta') lines.push(`Falta: <b class="negc">${fmtSaldo(c.saldo)}</b> no saldo`);
  else if (curTipo !== 'trabalho') lines.push(`${TIPOS[curTipo]}: sem impacto no saldo`);
  else {
    if (c.expected) lines.push(`Saída prevista: <b>${c.expected}</b>`);
    if (c.worked != null) {
      lines.push(`Trabalhado: <b>${fmtDur(c.worked)}</b>`);
      lines.push(`Saldo do dia: <b class="${c.saldo > 0 ? 'pos' : c.saldo < 0 ? 'negc' : ''}">${c.saldo === 0 ? '00:00' : fmtSaldo(c.saldo)}</b>`);
    } else if (!c.expected) lines.push('Toque nos campos para registrar a hora atual.');
  }
  live.innerHTML = lines.join('<br>');
}

FIELDS.forEach(f => {
  inputs[f].addEventListener('click', () => { if (!inputs[f].value) { inputs[f].value = nowHM(); refresh(); } });
  inputs[f].addEventListener('input', refresh);
  document.querySelector(`.field[data-f=${f}] .hint`).addEventListener('click', e => { inputs[f].value = e.currentTarget.dataset.v; refresh(); });
});
$('f_obs').addEventListener('input', refresh);
$('chips').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  curTipo = curTipo === b.dataset.tipo ? 'trabalho' : b.dataset.tipo;
  refresh();
};

$('daySave').onclick = () => {
  const rec = formRec();
  const empty = rec.tipo === 'trabalho' && FIELDS.every(f => !rec[f]) && !rec.obs;
  if (empty) delete state.days[curKey];
  else {
    if (rec.tipo !== 'trabalho') FIELDS.forEach(f => rec[f] = '');
    state.days[curKey] = rec;
  }
  persist(); closeDay(); render(); toast('Salvo');
};
$('dayClear').onclick = () => {
  delete state.days[curKey]; persist(); closeDay(); render(); toast('Dia limpo');
};

// ---------- relatórios ----------
function openReports() {
  const cur = periodFor(new Date());
  const list = [0, 1, 2].map(i => periodEndingIn(cur.end.getFullYear(), cur.end.getMonth() - i));
  $('repList').innerHTML = list.map((p, i) => {
    const t = totals(p);
    return `<div class="rep"><div><b>${i === 0 ? 'Atual' : i === 1 ? 'Anterior' : 'Retrasado'}</b>
      <small>${fmtBR(p.start)} a ${fmtBR(p.end)}</small>
      <small>Saldo: ${t.saldo === 0 ? '00:00' : fmtSaldo(t.saldo)} · Trabalhado ${fmtDur(t.worked)}</small></div>
      <button class="btn primary" data-i="${i}">${i === 0 ? 'Ver' : 'PDF'}</button></div>`;
  }).join('');
  $('repList').onclick = e => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    const i = +b.dataset.i;
    if (i === 0) openPreview(list[0]); else makePdf(list[i]);
  };
  show('repSheet', 'repBackdrop');
}
$('btnReports').onclick = openReports;
$('repClose').onclick = () => hide('repSheet', 'repBackdrop');
$('repBackdrop').onclick = () => hide('repSheet', 'repBackdrop');

function buildRows(p) {
  return eachDay(p).map(d => {
    const rec = state.days[keyOf(d)], c = calc(rec);
    const tipo = rec && rec.tipo && rec.tipo !== 'trabalho' ? TIPOS[rec.tipo] : '';
    const obs = [tipo, rec && rec.obs].filter(Boolean).join(' - ');
    return [
      `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`, DIAS[d.getDay()],
      rec ? rec.entrada || '' : '', rec ? rec.saidaInt || '' : '', rec ? rec.volta || '' : '', rec ? rec.saida || '' : '',
      c.worked != null ? fmtDur(c.worked) : '',
      c.saldo > 0 ? fmtDur(c.saldo) : '',
      c.saldo < 0 ? fmtDur(c.saldo) : '',
      obs
    ];
  });
}

// ---------- pré-visualização (período atual) ----------
let prevPeriod = null;
function openPreview(p) {
  prevPeriod = p;
  const t = totals(p);
  const rows = buildRows(p).map(r => `<tr>${r.map((c, i) => `<td${i === 9 ? ' class="l"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('');
  $('prevInfo').textContent = `${fmtBR(p.start)} a ${fmtBR(p.end)}`;
  $('prevTable').innerHTML = `<table><thead><tr><th>Data</th><th>Dia</th><th>Ent.</th><th>S.int</th><th>Volta</th><th>Saída</th><th>Trab.</th><th>Extra</th><th>Deve</th><th>Obs.</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="6">Total</td><td>${fmtDur(t.worked)}</td><td class="pos">${fmtDur(t.extra)}</td><td class="negc">${fmtDur(t.deve)}</td><td class="l">Saldo ${t.saldo === 0 ? '00:00' : fmtSaldo(t.saldo)}<br>Folgas ${t.folgas} / Faltas ${t.faltas}</td></tr></tfoot></table>`;
  hide('repSheet', 'repBackdrop');
  show('prevSheet', 'prevBackdrop');
}
const closePreview = () => hide('prevSheet', 'prevBackdrop');
$('prevClose').onclick = closePreview; $('prevBackdrop').onclick = closePreview;
$('prevBack').onclick = () => { closePreview(); openReports(); };
$('prevDownload').onclick = () => makePdf(prevPeriod);

function makePdf(p) {
  if (!window.jspdf) { toast('Biblioteca de PDF não carregou (sem internet?)'); return; }
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  doc.setFontSize(16); doc.text('Folha de Ponto', 14, 16);
  doc.setFontSize(10); doc.text(`Período: ${fmtBR(p.start)} a ${fmtBR(p.end)}`, 14, 23);
  const rows = buildRows(p);
  const t = totals(p);
  doc.autoTable({
    startY: 28,
    head: [['Data', 'Dia', 'Entrada', 'Saída int.', 'Volta', 'Saída', 'Trabalhado', 'H. Extra', 'H. Devendo', 'Obs.']],
    body: rows,
    foot: [['', '', '', '', '', 'Total', fmtDur(t.worked), fmtDur(t.extra), fmtDur(t.deve), `Saldo ${t.saldo === 0 ? '00:00' : fmtSaldo(t.saldo, true)}\nFolgas ${t.folgas} / Faltas ${t.faltas}`]],
    styles: { fontSize: 8.5, cellPadding: 1.8, halign: 'center' },
    columnStyles: { 9: { halign: 'left' } },
    headStyles: { fillColor: [79, 109, 245] },
    footStyles: { fillColor: [235, 237, 245], textColor: 20, fontStyle: 'bold' }
  });
  const y = doc.lastAutoTable.finalY + 22;
  doc.line(14, y, 90, y); doc.line(110, y, 196, y);
  doc.setFontSize(9); doc.text('Assinatura do funcionário', 14, y + 5); doc.text('Assinatura do responsável', 110, y + 5);
  doc.save(`folha-ponto-${p.end.getFullYear()}-${pad(p.end.getMonth() + 1)}-20.pdf`);
}

// ---------- toast ----------
let tt;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 1800);
}

applyTheme();
render();
})();
