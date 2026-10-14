// Gráficos em SVG puro, com tooltip de hover/foco.
// Rótulos vindos da planilha entram sempre via textContent, nunca innerHTML.

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function text(parent, x, y, content, attrs = {}) {
  const t = el('text', { x, y, ...attrs }, parent);
  t.textContent = content;
  return t;
}

export const pct = (v, digits = 1) => `${(v * 100).toFixed(digits).replace('.', ',')}%`;

// ---------- Tooltip ----------

let tip;
function tooltip() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.setAttribute('role', 'status');
    document.body.appendChild(tip);
  }
  return tip;
}

// rows: [{ value, label, color, kind: 'line'|'box' }]
export function showTip(evt, title, rows) {
  const t = tooltip();
  t.replaceChildren();
  const h = document.createElement('div');
  h.className = 'chart-tip__title';
  h.textContent = title;
  t.appendChild(h);
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'chart-tip__row';
    if (r.color) {
      const key = document.createElement('span');
      key.className = `chart-tip__key chart-tip__key--${r.kind ?? 'line'}`;
      key.style.background = r.color;
      row.appendChild(key);
    }
    const v = document.createElement('strong');
    v.textContent = r.value;
    const l = document.createElement('span');
    l.textContent = r.label;
    row.append(v, l);
    t.appendChild(row);
  }
  t.classList.add('is-visible');

  let x, y;
  if (evt.type === 'focus' || evt.clientX == null) {
    const b = evt.target.getBoundingClientRect();
    x = b.left + b.width / 2;
    y = b.top;
  } else {
    x = evt.clientX;
    y = evt.clientY;
  }
  const tw = t.offsetWidth;
  const th = t.offsetHeight;
  let left = x + 14;
  if (left + tw > window.innerWidth - 8) left = x - tw - 14;
  let top = y - th - 12;
  if (top < 8) top = y + 16;
  t.style.left = `${left}px`;
  t.style.top = `${top}px`;
}

export function hideTip() {
  tip?.classList.remove('is-visible');
}

function bindTip(node, getContent) {
  node.setAttribute('tabindex', '0');
  const on = (e) => {
    const [title, rows] = getContent();
    showTip(e, title, rows);
    node.classList.add('is-hover');
  };
  const off = () => {
    hideTip();
    node.classList.remove('is-hover');
  };
  node.addEventListener('pointermove', on);
  node.addEventListener('focus', on);
  node.addEventListener('pointerleave', off);
  node.addEventListener('blur', off);
}

// Marcas de eixo em múltiplos de um passo "redondo" (1, 2, 2,5 ou 5 × 10^n).
function niceTicks(min, max, target = 5) {
  const raw = (max - min) / Math.max(1, target - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw - 1e-9);
  const ticks = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 1e9) / 1e9);
  return ticks;
}

// Barra com cantos de 4px só na ponta (direita), quadrada na base.
function hBarPath(x0, y, w, h, r = 4) {
  if (w <= 0) return '';
  const rr = Math.min(r, w, h / 2);
  return `M${x0},${y} H${x0 + w - rr} Q${x0 + w},${y} ${x0 + w},${y + rr} V${y + h - rr} Q${x0 + w},${y + h} ${x0 + w - rr},${y + h} H${x0} Z`;
}

// Coluna com cantos de 4px só no topo.
function vBarPath(x, y0, w, h, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y0} V${y0 - h + rr} Q${x},${y0 - h} ${x + rr},${y0 - h} H${x + w - rr} Q${x + w},${y0 - h} ${x + w},${y0 - h + rr} V${y0} Z`;
}

// ---------- Linha (evolução mensal) ----------
// opts: { labels, series: [{ name, color, values, muted }], domain: [min,max], refs: [{ value, label }], height }
export function lineChart(container, opts) {
  const width = container.clientWidth || 600;
  const height = opts.height ?? 260;
  const m = { top: 16, right: 116, bottom: 28, left: 44 };
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;
  const [dmin, dmax] = opts.domain;
  const x = (i) => m.left + (opts.labels.length === 1 ? iw / 2 : (iw * i) / (opts.labels.length - 1));
  const y = (v) => m.top + ih - ((v - dmin) / (dmax - dmin)) * ih;

  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'chart', role: 'img', 'aria-label': opts.ariaLabel });

  // grade + eixo y
  const g = el('g', { class: 'chart-grid' }, svg);
  for (const t of niceTicks(dmin, dmax, 6)) {
    el('line', { x1: m.left, x2: m.left + iw, y1: y(t), y2: y(t) }, g);
    text(g, m.left - 8, y(t) + 4, pct(t, 0), { class: 'chart-tick', 'text-anchor': 'end' });
  }
  opts.labels.forEach((l, i) => text(g, x(i), height - 8, l, { class: 'chart-tick', 'text-anchor': 'middle' }));

  // linhas de referência (limiares)
  for (const ref of opts.refs ?? []) {
    if (ref.value < dmin || ref.value > dmax) continue;
    el('line', { x1: m.left, x2: m.left + iw, y1: y(ref.value), y2: y(ref.value), class: 'chart-ref' }, svg);
    // rótulo dentro da área do gráfico, à esquerda, para não disputar espaço com os rótulos de fim de linha
    text(svg, m.left + 6, y(ref.value) - 5, ref.label, { class: 'chart-ref-label' });
  }

  // séries
  for (const s of opts.series) {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
    if (s.area) {
      el('path', { d: `${d} L${x(s.values.length - 1)},${m.top + ih} L${x(0)},${m.top + ih} Z`, fill: s.color, opacity: 0.1 }, svg);
    }
    el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.dashed ? '4 4' : null }, svg);
    const last = s.values.length - 1;
    el('circle', { cx: x(last), cy: y(s.values[last]), r: 4.5, fill: s.color, class: 'chart-dot' }, svg);
  }

  // rótulos diretos no fim da linha (afastados se colidirem)
  const ends = opts.series
    .map((s) => ({ s, y: y(s.values[s.values.length - 1]) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 30) ends[i].y = ends[i - 1].y + 30;
  for (const { s, y: ly } of ends) {
    if (opts.endLabels === false) break;
    const last = s.values[s.values.length - 1];
    text(svg, x(s.values.length - 1) + 10, ly + 1, pct(last), { class: 'chart-end-value' });
    text(svg, x(s.values.length - 1) + 10, ly + 14, s.name, { class: 'chart-end-label' });
  }

  // camada de hover: crosshair que encaixa no mês mais próximo
  const cross = el('line', { y1: m.top, y2: m.top + ih, class: 'chart-cross' }, svg);
  const hit = el('rect', { x: m.left - 12, y: m.top, width: iw + 24, height: ih, fill: 'transparent', class: 'chart-hit' }, svg);
  hit.setAttribute('tabindex', '0');
  let focusIdx = opts.labels.length - 1;
  const showAt = (evt, i) => {
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    cross.classList.add('is-visible');
    showTip(evt, opts.tipTitles?.[i] ?? opts.labels[i], opts.series.map((s) => ({ value: pct(s.values[i]), label: s.name, color: s.color })));
  };
  hit.addEventListener('pointermove', (e) => {
    const pt = svg.getBoundingClientRect();
    const px = ((e.clientX - pt.left) / pt.width) * width;
    const i = Math.round(((px - m.left) / iw) * (opts.labels.length - 1));
    showAt(e, Math.max(0, Math.min(opts.labels.length - 1, i)));
  });
  hit.addEventListener('focus', (e) => showAt(e, focusIdx));
  hit.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    focusIdx = Math.max(0, Math.min(opts.labels.length - 1, focusIdx + (e.key === 'ArrowRight' ? 1 : -1)));
    showAt({ type: 'focus', target: hit }, focusIdx);
    e.preventDefault();
  });
  const off = () => {
    cross.classList.remove('is-visible');
    hideTip();
  };
  hit.addEventListener('pointerleave', off);
  hit.addEventListener('blur', off);

  container.replaceChildren(svg);
}

// ---------- Colunas empilhadas (distribuição por classificação) ----------
// opts: { labels, stacks: [{ key, label, color, values }], height }
export function stackedColumns(container, opts) {
  const width = container.clientWidth || 600;
  const height = opts.height ?? 240;
  const m = { top: 12, right: 8, bottom: 28, left: 28 };
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;
  const totals = opts.labels.map((_, i) => opts.stacks.reduce((s, st) => s + st.values[i], 0));
  const max = Math.max(...totals, 1);
  const band = iw / opts.labels.length;
  const bw = Math.min(24, band * 0.5);
  const y0 = m.top + ih;
  const scale = (v) => (v / max) * ih;

  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'chart', role: 'img', 'aria-label': opts.ariaLabel });
  const g = el('g', { class: 'chart-grid' }, svg);
  for (const t of niceTicks(0, max, 5).filter((v) => Number.isInteger(v))) {
    const ty = y0 - scale(t);
    el('line', { x1: m.left, x2: m.left + iw, y1: ty, y2: ty }, g);
    text(g, m.left - 8, ty + 4, Math.round(t), { class: 'chart-tick', 'text-anchor': 'end' });
  }

  opts.labels.forEach((label, i) => {
    const cx = m.left + band * i + band / 2;
    text(svg, cx, height - 8, label, { class: 'chart-tick', 'text-anchor': 'middle' });
    let acc = 0;
    const visible = opts.stacks.filter((st) => st.values[i] > 0);
    visible.forEach((st, si) => {
      const v = st.values[i];
      const h = scale(v);
      const top = si === visible.length - 1;
      const yBase = y0 - scale(acc);
      // 2px de respiro entre segmentos
      const gap = si > 0 ? 2 : 0;
      const d = top
        ? vBarPath(cx - bw / 2, yBase - gap, bw, h - gap)
        : `M${cx - bw / 2},${yBase - gap} V${yBase - h} H${cx + bw / 2} V${yBase - gap} Z`;
      const seg = el('path', { d, fill: st.color, class: 'chart-mark' }, svg);
      bindTip(seg, () => [opts.tipTitles?.[i] ?? label, [{ value: `${v} ${v === 1 ? 'pessoa' : 'pessoas'}`, label: st.label, color: st.color, kind: 'box' }]]);
      acc += v;
    });
  });

  container.replaceChildren(svg);
}

// ---------- Barras horizontais ----------
// opts: { items: [{ label, sub, value, color, marker, markerLabel }], domain, refs, valueFormat, barColor }
export function hBars(container, opts) {
  const width = container.clientWidth || 500;
  const rowH = opts.rowHeight ?? 36;
  const labelW = Math.min(opts.labelWidth ?? 150, width * 0.38);
  const m = { top: 8, right: 56, bottom: 24, left: labelW };
  const iw = Math.max(40, width - m.left - m.right);
  const height = m.top + m.bottom + rowH * opts.items.length;
  const [dmin, dmax] = opts.domain ?? [0, 1];
  const x = (v) => m.left + ((Math.max(dmin, Math.min(dmax, v)) - dmin) / (dmax - dmin)) * iw;
  const fmt = opts.valueFormat ?? ((v) => pct(v));
  const bh = Math.min(16, rowH - 14);

  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'chart', role: 'img', 'aria-label': opts.ariaLabel });
  const g = el('g', { class: 'chart-grid' }, svg);
  for (const t of niceTicks(dmin, dmax, 5)) {
    el('line', { x1: x(t), x2: x(t), y1: m.top, y2: height - m.bottom }, g);
    text(g, x(t), height - 6, fmt(t).replace(/,0%$/, '%'), { class: 'chart-tick', 'text-anchor': 'middle' });
  }
  for (const ref of opts.refs ?? []) {
    el('line', { x1: x(ref.value), x2: x(ref.value), y1: m.top - 4, y2: height - m.bottom, class: 'chart-ref' }, svg);
  }

  opts.items.forEach((it, i) => {
    const cy = m.top + rowH * i + rowH / 2;
    const row = el('g', { class: 'chart-row' }, svg);
    el('rect', { x: 0, y: cy - rowH / 2, width, height: rowH, fill: 'transparent' }, row);
    text(row, m.left - 12, it.sub ? cy - 2 : cy + 4, it.label, { class: 'chart-label', 'text-anchor': 'end' });
    if (it.sub) text(row, m.left - 12, cy + 12, it.sub, { class: 'chart-sublabel', 'text-anchor': 'end' });
    el('path', { d: hBarPath(m.left, cy - bh / 2, x(it.value) - m.left, bh), fill: it.color ?? opts.barColor, class: 'chart-mark' }, row);
    if (it.marker != null) {
      el('line', { x1: x(it.marker), x2: x(it.marker), y1: cy - bh / 2 - 4, y2: cy + bh / 2 + 4, class: 'chart-marker' }, row);
    }
    // valor depois da barra ou do traço da média, o que estiver mais à direita
    const labelX = Math.max(x(it.value), it.marker != null ? x(it.marker) + 1 : 0) + 8;
    text(row, labelX, cy + 4, fmt(it.value), { class: 'chart-value' });
    bindTip(row, () => [
      it.label,
      [
        { value: fmt(it.value), label: opts.valueLabel ?? 'Score', color: it.color ?? opts.barColor, kind: 'box' },
        ...(it.marker != null ? [{ value: fmt(it.marker), label: opts.markerLabel ?? 'Média', color: 'var(--ink-secondary)' }] : []),
        ...(it.extra ?? []),
      ],
    ]);
  });

  container.replaceChildren(svg);
}

// Sparkline mínima para tabelas (sem interação; o valor está na própria linha da tabela).
export function sparkline(values, { width = 72, height = 22, color = 'currentColor', domain } = {}) {
  const [lo, hi] = domain ?? [Math.min(...values), Math.max(...values)];
  const span = hi - lo || 1;
  const x = (i) => 3 + ((width - 6) * i) / (values.length - 1);
  const y = (v) => height - 3 - ((v - lo) / span) * (height - 6);
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'spark', 'aria-hidden': 'true' });
  el('path', { d: values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' '), fill: 'none', stroke: color, 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
  el('circle', { cx: x(values.length - 1), cy: y(values[values.length - 1]), r: 2.5, fill: color }, svg);
  return svg;
}
