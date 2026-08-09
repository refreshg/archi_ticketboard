/**
 * Minimal dependency-free SVG charts.
 *
 * Follows the house mark specs: 2px surface gap between adjacent fills,
 * 4px rounded data-ends anchored to the baseline, recessive grid, direct
 * labels on every mark (which is also the relief for the two light-mode
 * series slots that sit below 3:1 on the surface), and a hover tooltip.
 */

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

const tooltip = () => document.getElementById('tooltip');

export function showTip(evt, html) {
  const tip = tooltip();
  tip.innerHTML = html;
  tip.hidden = false;
  const pad = 14;
  const rect = tip.getBoundingClientRect();
  let x = evt.clientX + pad;
  let y = evt.clientY + pad;
  if (x + rect.width > window.innerWidth - 8) x = evt.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - 8) y = evt.clientY - rect.height - pad;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}

export function hideTip() {
  tooltip().hidden = true;
}

/** Truncate a label to fit the gutter, keeping it readable. */
function clip(text, max = 22) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Horizontal stacked bars — one row per project, segments per stage group.
 * Horizontal because project names are long, per the form guidance.
 */
export function stackedBars(container, rows, series, { onSegment } = {}) {
  container.innerHTML = '';
  if (!rows.length) {
    container.innerHTML = '<p class="note">მონაცემები არ მოიძებნა</p>';
    return;
  }

  const rowH = 26;
  const gap = 8;
  const gutter = 168;
  const padRight = 54;
  const padTop = 6;
  const width = Math.max(container.clientWidth || 520, 460);
  const height = padTop + rows.length * (rowH + gap);
  const plotW = width - gutter - padRight;
  const max = Math.max(1, ...rows.map((r) => series.reduce((n, s) => n + (r[s.key] || 0), 0)));

  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`, width, height,
    role: 'img', 'aria-label': 'თიქეთები პროექტების მიხედვით',
  });

  rows.forEach((row, i) => {
    const y = padTop + i * (rowH + gap);

    const label = el('text', {
      x: gutter - 10, y: y + rowH / 2 + 4, 'text-anchor': 'end', class: 'axis-label',
    });
    label.textContent = clip(row.name);
    label.appendChild(el('title')).textContent = row.name;
    svg.appendChild(label);

    let x = gutter;
    const total = series.reduce((n, s) => n + (row[s.key] || 0), 0);

    series.forEach((s) => {
      const value = row[s.key] || 0;
      if (value <= 0) return;
      const w = (value / max) * plotW;
      // 2px surface gap keeps adjacent segments from fusing.
      const drawW = Math.max(1, w - 2);

      const rect = el('rect', {
        x, y, width: drawW, height: rowH, rx: 4, fill: s.color, class: 'mark',
      });
      rect.style.cursor = onSegment ? 'pointer' : 'default';
      const tip = () => `<b>${row.name}</b><div class="tt-row"><span>${s.label}</span>` +
        `<span class="tt-num">${value}</span></div>`;
      rect.addEventListener('mousemove', (e) => showTip(e, tip()));
      rect.addEventListener('mouseleave', hideTip);
      if (onSegment) {
        rect.addEventListener('click', () => { hideTip(); onSegment(row, s); });
      }
      svg.appendChild(rect);

      // Direct label inside the segment when it fits.
      if (drawW > 26) {
        const t = el('text', {
          x: x + drawW / 2, y: y + rowH / 2 + 4,
          'text-anchor': 'middle', class: 'bar-label',
          fill: '#fff', 'pointer-events': 'none',
        });
        t.textContent = value;
        svg.appendChild(t);
      }
      x += w;
    });

    const totalLabel = el('text', {
      x: gutter + (total / max) * plotW + 8, y: y + rowH / 2 + 4, class: 'bar-label',
    });
    totalLabel.textContent = total;
    svg.appendChild(totalLabel);
  });

  container.appendChild(svg);
}

/** Donut for stage distribution, with a hero total in the middle. */
export function donut(container, slices, { onSlice } = {}) {
  container.innerHTML = '';
  const total = slices.reduce((n, s) => n + s.value, 0);
  if (!total) {
    container.innerHTML = '<p class="note">მონაცემები არ მოიძებნა</p>';
    return;
  }

  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const r = 78;
  const stroke = 26;
  const svg = el('svg', {
    viewBox: `0 0 ${size} ${size}`, width: size, height: size,
    role: 'img', 'aria-label': 'ეტაპების განაწილება',
  });

  const C = 2 * Math.PI * r;
  let offset = 0;

  slices.filter((s) => s.value > 0).forEach((s) => {
    const frac = s.value / total;
    // 2px gap expressed along the arc keeps neighbouring slices separate.
    const len = Math.max(0, frac * C - 2);
    const arc = el('circle', {
      cx, cy, r, fill: 'none',
      stroke: s.color, 'stroke-width': stroke,
      'stroke-dasharray': `${len} ${C - len}`,
      'stroke-dashoffset': -offset,
      transform: `rotate(-90 ${cx} ${cy})`,
      class: 'mark',
    });
    arc.style.cursor = onSlice ? 'pointer' : 'default';
    const pct = ((frac * 100).toFixed(1)).replace('.0', '');
    arc.addEventListener('mousemove', (e) => showTip(e,
      `<b>${s.label}</b><div class="tt-row"><span>თიქეთი</span>` +
      `<span class="tt-num">${s.value} · ${pct}%</span></div>`));
    arc.addEventListener('mouseleave', hideTip);
    if (onSlice) arc.addEventListener('click', () => { hideTip(); onSlice(s); });
    svg.appendChild(arc);
    offset += frac * C;
  });

  const big = el('text', {
    x: cx, y: cy - 2, 'text-anchor': 'middle',
    'font-size': '30', 'font-weight': '680', fill: 'var(--text-primary)',
  });
  big.textContent = total;
  svg.appendChild(big);
  const sub = el('text', {
    x: cx, y: cy + 17, 'text-anchor': 'middle', 'font-size': '11', fill: 'var(--muted)',
  });
  sub.textContent = 'თიქეთი';
  svg.appendChild(sub);

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:18px;align-items:center;flex-wrap:wrap';
  wrap.appendChild(svg);

  const legend = document.createElement('div');
  legend.className = 'legend';
  legend.style.flexDirection = 'column';
  legend.style.gap = '7px';
  for (const s of slices.filter((x) => x.value > 0)) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    item.innerHTML =
      `<span class="legend-swatch" style="background:${s.color}"></span>` +
      `<span>${s.label}</span>` +
      `<b style="margin-left:4px;font-variant-numeric:tabular-nums">${s.value}</b>`;
    legend.appendChild(item);
  }
  wrap.appendChild(legend);
  container.appendChild(wrap);
}

/** Weekly line + area for created tickets, with a crosshair tooltip. */
export function trendLine(container, points) {
  container.innerHTML = '';
  if (points.length < 2) {
    container.innerHTML = '<p class="note">დინამიკის საჩვენებლად მონაცემები არასაკმარისია</p>';
    return;
  }

  const width = Math.max(container.clientWidth || 800, 520);
  const height = 190;
  const padL = 38;
  const padR = 16;
  const padT = 12;
  const padB = 30;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const max = Math.max(1, ...points.map((p) => p.value));
  // Round the axis top to a friendly number.
  const step = Math.max(1, Math.ceil(max / 4));
  const top = step * 4;

  const x = (i) => padL + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v) => padT + plotH - (v / top) * plotH;

  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`, width, height,
    role: 'img', 'aria-label': 'შექმნილი თიქეთების დინამიკა',
  });

  for (let i = 0; i <= 4; i++) {
    const gy = padT + plotH - (i / 4) * plotH;
    svg.appendChild(el('line', { x1: padL, x2: width - padR, y1: gy, y2: gy, class: 'grid-line' }));
    const t = el('text', { x: padL - 8, y: gy + 4, 'text-anchor': 'end', class: 'axis-label' });
    t.textContent = step * i;
    svg.appendChild(t);
  }

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');
  const area = `${line} L${x(points.length - 1)},${padT + plotH} L${padL},${padT + plotH} Z`;

  const grad = el('linearGradient', { id: 'trendFill', x1: '0', y1: '0', x2: '0', y2: '1' });
  grad.appendChild(el('stop', { offset: '0%', 'stop-color': 'var(--series-1)', 'stop-opacity': '.26' }));
  grad.appendChild(el('stop', { offset: '100%', 'stop-color': 'var(--series-1)', 'stop-opacity': '0' }));
  const defs = el('defs');
  defs.appendChild(grad);
  svg.appendChild(defs);

  svg.appendChild(el('path', { d: area, fill: 'url(#trendFill)' }));
  svg.appendChild(el('path', {
    d: line, fill: 'none', stroke: 'var(--series-1)', 'stroke-width': '2',
    'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }));

  // X labels thinned so they never collide.
  const every = Math.ceil(points.length / 8);
  points.forEach((p, i) => {
    if (i % every && i !== points.length - 1) return;
    const t = el('text', {
      x: x(i), y: height - 9, 'text-anchor': 'middle', class: 'axis-label',
    });
    t.textContent = p.label;
    svg.appendChild(t);
  });

  const crosshair = el('line', {
    y1: padT, y2: padT + plotH, class: 'axis-line', opacity: '0', 'pointer-events': 'none',
  });
  svg.appendChild(crosshair);
  const dot = el('circle', {
    r: 4.5, fill: 'var(--series-1)', stroke: 'var(--surface-1)', 'stroke-width': '2',
    opacity: '0', 'pointer-events': 'none',
  });
  svg.appendChild(dot);

  points.forEach((p, i) => {
    // Generous hit slab per point, wider than the mark itself.
    const w = plotW / points.length;
    const hit = el('rect', {
      x: x(i) - w / 2, y: padT, width: w, height: plotH, class: 'hit',
    });
    hit.addEventListener('mousemove', (e) => {
      crosshair.setAttribute('x1', x(i));
      crosshair.setAttribute('x2', x(i));
      crosshair.setAttribute('opacity', '1');
      dot.setAttribute('cx', x(i));
      dot.setAttribute('cy', y(p.value));
      dot.setAttribute('opacity', '1');
      showTip(e, `<b>${p.full || p.label}</b><div class="tt-row"><span>შექმნილი</span>` +
        `<span class="tt-num">${p.value}</span></div>`);
    });
    hit.addEventListener('mouseleave', () => {
      crosshair.setAttribute('opacity', '0');
      dot.setAttribute('opacity', '0');
      hideTip();
    });
    svg.appendChild(hit);
  });

  container.appendChild(svg);
}

export function renderLegend(container, series) {
  container.innerHTML = '';
  for (const s of series) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    item.innerHTML =
      `<span class="legend-swatch" style="background:${s.color}"></span><span>${s.label}</span>`;
    container.appendChild(item);
  }
}
