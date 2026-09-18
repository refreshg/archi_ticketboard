/**
 * Archi ticket board — UI controller.
 *
 * Reference data (users, project enum, portfolio-manager list) is fetched once
 * and reused; only the deal set is refetched when the date window changes.
 */

import { WEBHOOKS, fetchAll } from './bitrix.js';
import {
  STAGE, STAGE_LABEL, CLOSED_STAGES, FIELD, DEAL_SELECT, DETAIL_COLUMNS,
  buildFilter, loadReference, aggregate, dealRow, projectNames,
  isOverdue, isClosed, isOverdueClosed, monthsAgoISO, todayISO, formatDate,
  DATE_FIELDS, DEFAULT_DATE_FIELD, localISO,
} from './model.js';
import { stackedBars, donut, trendLine, renderLegend, hideTip } from './charts.js';

const $ = (id) => document.getElementById(id);

// The palette custom properties live on .viz-root, not :root, so resolve them
// against that element — reading from documentElement returns "" and any SVG
// fill referencing it silently falls back to black.
const css = (name) => {
  const root = document.querySelector('.viz-root') || document.documentElement;
  return getComputedStyle(root).getPropertyValue(name).trim() || '#2a78d6';
};

const state = {
  reference: null,
  deals: [],
  agg: null,
  dateField: DEFAULT_DATE_FIELD,
  sort: { projects: { key: 'total', dir: 'desc' }, managers: { key: 'total', dir: 'desc' } },
  query: { projects: '', managers: '' },
  inflight: null,
};

/** Thousands separator, applied explicitly so it does not vary by runtime locale. */
const num = (n) => String(n ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const METRIC = {
  total: { label: 'სულ თიქეთები', test: () => true },
  overdue: { label: 'ვადაგადაცილებული', test: isOverdue },
  closed: { label: 'ჩახურული', test: isClosed },
  overdueClosed: { label: 'ვადაგ. ჩახურული', test: isOverdueClosed },
};

/* ------------------------------- status ------------------------------- */

function setStatus(text, { error = false, progress = null } = {}) {
  const node = $('status');
  node.className = error ? 'status error' : 'status';
  node.textContent = text;
  if (progress !== null) {
    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = `${Math.round(progress * 100)}%`;
    track.appendChild(fill);
    node.appendChild(track);
  }
}

/* ------------------------------- loading ------------------------------ */

async function load({ from, to, field }) {
  state.inflight?.abort();
  const controller = new AbortController();
  state.inflight = controller;
  const { signal } = controller;
  const started = performance.now();

  try {
    if (!state.reference) {
      setStatus('იტვირთება საცნობარო მონაცემები…');
      state.reference = await loadReference({ signal });
    }

    setStatus('იტვირთება თიქეთები…', { progress: 0 });
    let loaded = 0;
    let total = 0;
    const deals = await fetchAll(
      WEBHOOKS.deal,
      'crm.deal.list',
      { filter: buildFilter({ from, to, field }), select: DEAL_SELECT, order: { ID: 'ASC' } },
      {
        signal,
        onProgress: (n, t) => {
          loaded += n;
          total = t;
          setStatus(`იტვირთება თიქეთები… ${Math.min(loaded, t)} / ${t}`,
            { progress: t ? Math.min(loaded / t, 1) : 0 });
        },
      },
    );

    if (signal.aborted) return;
    state.deals = deals;
    state.dateField = field;
    state.agg = aggregate(deals, state.reference);
    render({ from, to });

    const ms = Math.round(performance.now() - started);
    setStatus(`${deals.length} თიქეთი · ${DATE_FIELDS[field]}: ${formatDate(from)} – ${formatDate(to)} · ${ms}ms`);
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error(err);
    setStatus(`შეცდომა: ${err.message}`, { error: true });
  }
}

/* ------------------------------ rendering ----------------------------- */

function render({ from, to }) {
  $('main').hidden = false;
  const { totals } = state.agg;

  $('kpi-total').textContent = num(totals.total);
  $('kpi-overdue').textContent = num(totals.overdue);
  $('kpi-closed').textContent = num(totals.closed);
  $('kpi-odclosed').textContent = num(totals.overdueClosed);

  const pct = (n) => (totals.total ? `${((n / totals.total) * 100).toFixed(1).replace('.0', '')}%` : '—');
  $('kpi-total-foot').textContent = `${DATE_FIELDS[state.dateField]}: ${formatDate(from)} – ${formatDate(to)}`;
  $('kpi-overdue-foot').textContent = `${pct(totals.overdue)} სულიდან`;
  $('kpi-closed-foot').textContent = `${pct(totals.closed)} სულიდან`;
  $('kpi-odclosed-foot').textContent = totals.closed
    ? `${((totals.overdueClosed / totals.closed) * 100).toFixed(1).replace('.0', '')}% ჩახურულიდან`
    : '—';

  renderCharts();
  renderTable('projects');
  renderTable('managers');
}

function stageSeries() {
  return [
    { key: 'overdue', label: 'ვადაგადაცილებული', color: css('--overdue'), metric: 'overdue' },
    { key: 'closed', label: 'ჩახურული', color: css('--series-3'), metric: 'closed' },
    { key: 'other', label: 'სხვა ეტაპები', color: css('--series-1'), metric: 'other' },
  ];
}

function renderCharts() {
  const series = stageSeries();

  const rows = state.agg.projects.slice(0, 10).map((p) => ({
    name: p.name,
    overdue: p.overdue,
    closed: p.closed,
    other: Math.max(0, p.total - p.overdue - p.closed),
  }));
  stackedBars($('chart-projects'), rows, series, {
    onSegment: (row, s) => {
      const project = state.agg.projects.find((p) => p.name === row.name);
      if (!project) return;
      const test = s.key === 'other'
        ? (d) => !isOverdue(d) && !isClosed(d)
        : METRIC[s.key].test;
      openDrawer(project.deals.filter(test), `${row.name} — ${s.label}`);
    },
  });
  renderLegend($('legend-projects'), series);

  const counts = new Map();
  for (const d of state.deals) counts.set(d.STAGE_ID, (counts.get(d.STAGE_ID) || 0) + 1);
  const palette = {
    [STAGE.NEW]: css('--series-1'),
    [STAGE.IN_PROGRESS]: css('--series-4'),
    [STAGE.OVERDUE]: css('--overdue'),
    [STAGE.DONE]: css('--series-3'),
    [STAGE.CONFIRMED]: css('--closed'),
    [STAGE.UNRESOLVED]: css('--series-2'),
    [STAGE.JUNK]: css('--muted'),
  };
  const slices = Object.keys(STAGE_LABEL)
    .map((id) => ({
      id, label: STAGE_LABEL[id], value: counts.get(id) || 0, color: palette[id] || css('--muted'),
    }))
    .filter((s) => s.value > 0);
  donut($('chart-stages'), slices, {
    onSlice: (s) => openDrawer(
      state.deals.filter((d) => d.STAGE_ID === s.id), `ეტაპი — ${s.label}`,
    ),
  });

  $('trend-sub').textContent = `თიქეთები კვირების მიხედვით · ${DATE_FIELDS[state.dateField]}`;
  trendLine($('chart-trend'), weeklySeries(state.deals, state.dateField));
}

/** Bucket deals into ISO weeks by the date field the window runs on. */
function weeklySeries(deals, field) {
  const buckets = new Map();
  for (const d of deals) {
    if (!d[field]) continue;
    const date = new Date(d[field]);
    if (Number.isNaN(date.getTime())) continue;
    // Snap to the Monday of that week.
    const monday = new Date(date);
    const dow = (monday.getDay() + 6) % 7;
    monday.setDate(monday.getDate() - dow);
    monday.setHours(0, 0, 0, 0);
    const key = localISO(monday);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => {
      const d = new Date(key);
      return {
        label: `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`,
        full: `კვირა ${formatDate(key)}`,
        value,
      };
    });
}

function renderTable(kind) {
  const isProjects = kind === 'projects';
  const table = $(isProjects ? 'tbl-projects' : 'tbl-managers');
  const source = isProjects ? state.agg.projects : state.agg.managers;
  const { key, dir } = state.sort[kind];
  const q = state.query[kind].trim().toLowerCase();

  const rows = source
    .filter((r) => !q || r.name.toLowerCase().includes(q))
    .slice()
    .sort((a, b) => {
      const delta = key === 'name'
        ? a.name.localeCompare(b.name, 'ka')
        : (a[key] || 0) - (b[key] || 0);
      return dir === 'asc' ? delta : -delta;
    });

  const tbody = table.querySelector('tbody');
  tbody.innerHTML = '';

  for (const row of rows) {
    const tr = document.createElement('tr');

    const name = document.createElement('td');
    name.className = 'name';
    name.textContent = row.name;
    if (!isProjects && row.projects?.length) {
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = `${row.projects.length} პროექტი`;
      sub.title = row.projects.join(', ');
      name.appendChild(sub);
    }
    tr.appendChild(name);

    for (const metric of ['total', 'overdue', 'closed', 'overdueClosed']) {
      const td = document.createElement('td');
      td.className = 'num';
      const value = row[metric] || 0;
      const span = document.createElement('span');
      span.className = `count ${value ? metricClass(metric) : 'zero'}`;
      span.textContent = num(value);
      if (value) {
        span.tabIndex = 0;
        span.setAttribute('role', 'button');
        const open = () => openDrawer(
          row.deals.filter(METRIC[metric].test),
          `${row.name} — ${METRIC[metric].label}`,
        );
        span.addEventListener('click', open);
        span.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });
      }
      td.appendChild(span);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  const tfoot = table.querySelector('tfoot');
  tfoot.innerHTML = '';
  const sum = (k) => rows.reduce((n, r) => n + (r[k] || 0), 0);
  const ftr = document.createElement('tr');
  ftr.innerHTML =
    `<td>ჯამი (${rows.length})</td>` +
    ['total', 'overdue', 'closed', 'overdueClosed']
      .map((k) => `<td class="num">${num(sum(k))}</td>`).join('');
  tfoot.appendChild(ftr);

  table.querySelectorAll('th.sortable').forEach((th) => {
    th.classList.toggle('asc', th.dataset.sort === key && dir === 'asc');
    th.classList.toggle('desc', th.dataset.sort === key && dir === 'desc');
  });
}

const metricClass = (metric) => ({
  overdue: 'c-overdue', closed: 'c-closed', overdueClosed: 'c-odclosed',
}[metric] || '');

/* ------------------------------- drawer ------------------------------- */

let lastFocus = null;

function openDrawer(deals, title) {
  const table = $('tbl-detail');
  const rows = deals
    .map((d) => dealRow(d, state.reference))
    .sort((a, b) => a.project.localeCompare(b.project, 'ka'));

  table.querySelector('thead').innerHTML =
    `<tr>${DETAIL_COLUMNS.map(([, label]) => `<th>${label}</th>`).join('')}</tr>`;

  const tbody = table.querySelector('tbody');
  tbody.innerHTML = rows.length
    ? rows.map((r) => {
        const cells = DETAIL_COLUMNS.map(([key]) => {
          if (key === 'id') {
            // The ID is the explicit affordance; the row click is the shortcut.
            return `<td class="id-cell"><a class="deal-link" href="${escapeAttr(r.url)}"` +
              ` target="_blank" rel="noopener noreferrer"` +
              ` title="${escapeAttr(r.title)}">${escapeHtml(r.id)} ↗</a></td>`;
          }
          return `<td class="${key === 'project' ? 'wrap' : ''}"` +
            ` title="${escapeAttr(r[key])}">${escapeHtml(r[key])}</td>`;
        }).join('');
        return `<tr class="deal-row" data-url="${escapeAttr(r.url)}"` +
          ` tabindex="0" role="link" title="${escapeAttr(r.title)}">${cells}</tr>`;
      }).join('')
    : `<tr><td colspan="${DETAIL_COLUMNS.length}" style="color:var(--muted)">ჩანაწერი არ მოიძებნა</td></tr>`;

  $('drawer-title').textContent = title;
  $('drawer-sub').textContent = rows.length
    ? `${rows.length} თიქეთი · დაკლიკე სტრიქონზე ბიტრიქსში გასახსნელად`
    : '0 თიქეთი';
  $('drawer').dataset.rows = JSON.stringify(rows);

  lastFocus = document.activeElement;
  $('scrim').hidden = false;
  $('drawer').hidden = false;
  $('drawer-close').focus();
}

function closeDrawer() {
  $('scrim').hidden = true;
  $('drawer').hidden = true;
  hideTip();
  lastFocus?.focus?.();
}

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s) => escapeHtml(s).replace(/"/g, '&quot;');

function exportCsv() {
  const rows = JSON.parse($('drawer').dataset.rows || '[]');
  if (!rows.length) return;
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [
    DETAIL_COLUMNS.map(([, label]) => esc(label)).join(','),
    ...rows.map((r) => DETAIL_COLUMNS.map(([key]) => esc(r[key])).join(',')),
  ].join('\r\n');
  // BOM keeps Georgian readable when Excel opens the file.
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `archi-tickets-${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* -------------------------------- events ------------------------------ */

function currentRange() {
  return { from: $('from').value, to: $('to').value, field: $('datefield').value };
}

function setPreset(months) {
  $('from').value = monthsAgoISO(months);
  $('to').value = todayISO();
  document.querySelectorAll('.preset').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.months) === months));
  });
}

function wire() {
  for (const [value, label] of Object.entries(DATE_FIELDS)) {
    $('datefield').add(new Option(label, value, false, value === DEFAULT_DATE_FIELD));
  }
  $('datefield').addEventListener('change', () => load(currentRange()));

  document.querySelectorAll('.preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      setPreset(Number(btn.dataset.months));
      load(currentRange());
    });
  });

  $('apply').addEventListener('click', () => {
    document.querySelectorAll('.preset').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    load(currentRange());
  });
  $('refresh').addEventListener('click', () => load(currentRange()));

  for (const [kind, id] of [['projects', 'q-project'], ['managers', 'q-manager']]) {
    $(id).addEventListener('input', (e) => {
      state.query[kind] = e.target.value;
      if (state.agg) renderTable(kind);
    });
  }

  for (const [kind, id] of [['projects', 'tbl-projects'], ['managers', 'tbl-managers']]) {
    $(id).querySelectorAll('th.sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        const cur = state.sort[kind];
        state.sort[kind] = { key, dir: cur.key === key && cur.dir === 'desc' ? 'asc' : 'desc' };
        renderTable(kind);
      });
    });
  }

  document.querySelectorAll('.kpi').forEach((card) => {
    const open = () => {
      const metric = card.dataset.metric;
      openDrawer(state.deals.filter(METRIC[metric].test), METRIC[metric].label);
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });

  // Open a deal in Bitrix from anywhere on its row. Delegated, so it keeps
  // working after the drawer re-renders. Clicks on the ID anchor fall through
  // to the anchor's own navigation.
  const openDeal = (url, viaMiddle) => {
    if (!url) return;
    window.open(url, viaMiddle ? '_blank' : '_blank', 'noopener,noreferrer');
  };
  const detail = $('tbl-detail');
  detail.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const row = e.target.closest('.deal-row');
    if (row) openDeal(row.dataset.url);
  });
  detail.addEventListener('auxclick', (e) => {
    if (e.button !== 1 || e.target.closest('a')) return;
    const row = e.target.closest('.deal-row');
    if (row) { e.preventDefault(); openDeal(row.dataset.url, true); }
  });
  detail.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest?.('.deal-row');
    if (row && e.target === row) { e.preventDefault(); openDeal(row.dataset.url); }
  });

  $('drawer-close').addEventListener('click', closeDrawer);
  $('scrim').addEventListener('click', closeDrawer);
  $('drawer-csv').addEventListener('click', exportCsv);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('drawer').hidden) closeDrawer();
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.agg) renderCharts(); }, 160);
  });
}

wire();
setPreset(1);          // default window: last month
load(currentRange());
