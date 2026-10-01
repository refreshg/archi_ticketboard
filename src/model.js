/**
 * Domain constants and aggregation for the Archi ticket board.
 * Field IDs below were confirmed against live pipeline-23 data.
 */

import { api, WEBHOOKS, fetchAll } from './bitrix.js';

export const PIPELINE = 23;

export const STAGE = {
  NEW: 'C23:NEW',
  IN_PROGRESS: 'C23:PREPARATION',
  OVERDUE: 'C23:UC_RGEFQ9',            // ვადაგადაცილებული
  DONE: 'C23:PREPAYMENT_INVOIC',       // დასრულებული
  CONFIRMED: 'C23:WON',                // დასრულებული (დადასტურებული)
  UNRESOLVED: 'C23:LOSE',              // მოუგვარებელი
  JUNK: 'C23:1',
};

export const STAGE_LABEL = {
  [STAGE.NEW]: 'დაინიცირებულია',
  [STAGE.IN_PROGRESS]: 'პროცესში',
  [STAGE.OVERDUE]: 'ვადაგადაცილებული',
  [STAGE.DONE]: 'დასრულებული',
  [STAGE.CONFIRMED]: 'დასრულებული (დადასტურებული)',
  [STAGE.UNRESOLVED]: 'მოუგვარებელი',
  [STAGE.JUNK]: 'Junk',
};

/** "Close Deal" = both terminal done stages. */
export const CLOSED_STAGES = [STAGE.CONFIRMED, STAGE.DONE];

export const FIELD = {
  PROJECT: 'UF_CRM_5E1EECDB0571C',        // enumeration, multiple -> array of enum IDs
  OVERDUE_CLOSED: 'UF_CRM_1731998758508', // boolean, "1" when closed past deadline
  DIRECTION: 'UF_CRM_1677604396941',      // მიმართულება: სამშენებლო / MEP
  PROBLEM_GROUP: 'UF_CRM_1682005626208',  // პრობლემის ჯგუფი
  CO_ASSIGNED: 'UF_CRM_1610362285',       // თანაპასუხისმგებლები (multi employee)
  RESOLVER: 'UF_CRM_1688037739',          // მოგვარები (employee)
};

/** Fields requested from crm.deal.list — UF_ fields are omitted unless selected. */
export const DEAL_SELECT = [
  'ID', 'TITLE', 'STAGE_ID', 'ASSIGNED_BY_ID', 'DATE_CREATE', 'BEGINDATE', 'CLOSEDATE',
  FIELD.PROJECT, FIELD.OVERDUE_CLOSED, FIELD.DIRECTION,
  FIELD.PROBLEM_GROUP, FIELD.CO_ASSIGNED, FIELD.RESOLVER,
];

/** Portfolio-manager list (iblock 111). */
export const PM_LIST = { IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: 111, PM_PROPERTY: 'PROPERTY_1299' };

export const isTrue = (v) => v === '1' || v === 1 || v === true;

/** A multi-value UF field arrives as an array, a scalar, or absent. */
export const toArray = (v) =>
  v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : [v];

export const isOverdue = (d) => d.STAGE_ID === STAGE.OVERDUE;
export const isClosed = (d) => CLOSED_STAGES.includes(d.STAGE_ID);
export const isOverdueClosed = (d) => isClosed(d) && isTrue(d[FIELD.OVERDUE_CLOSED]);

/**
 * dd.mm.yyyy, formatted explicitly rather than via toLocaleDateString —
 * the ka-GE locale is missing in some runtimes and silently falls back to
 * US month/day/year ordering.
 */
export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

// Local calendar date, not toISOString — that is UTC, so between 00:00 and
// 04:00 Tbilisi time it returned yesterday and shifted the whole window.
export const localISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function monthsAgoISO(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return localISO(d);
}

export function todayISO() {
  return localISO(new Date());
}

/**
 * Deal fields the date window can run on. BEGINDATE is what the CRM list
 * filter labels "თარიღიდან" — the field the ticket team filters by, so it is
 * the default; it sits 11–30 days after DATE_CREATE on nearly every ticket, so
 * the two windows select very different deal sets.
 */
export const DATE_FIELDS = {
  BEGINDATE: 'დედლაინი',
  DATE_CREATE: 'შექმნის თარიღი',
};
export const DEFAULT_DATE_FIELD = 'BEGINDATE';

/** Build the crm.deal.list filter for a date window on the chosen date field. */
export function buildFilter({ from, to, field = DEFAULT_DATE_FIELD }) {
  const filter = { CATEGORY_ID: PIPELINE };
  if (from) filter[`>=${field}`] = from;
  // The field is a datetime; extend the upper bound to the end of that day.
  if (to) filter[`<=${field}`] = `${to}T23:59:59`;
  return filter;
}

/** Load reference data: enum options, users, and the project -> PM mapping. */
export async function loadReference({ signal } = {}) {
  const [fieldPages, users, listRows] = await Promise.all([
    loadUserfields({ signal }),
    api.users({ FILTER: {} }, { signal }),
    api.listElements(
      { IBLOCK_TYPE_ID: PM_LIST.IBLOCK_TYPE_ID, IBLOCK_ID: PM_LIST.IBLOCK_ID },
      { signal },
    ),
  ]);

  const enums = {};
  for (const f of fieldPages) {
    if (!f.LIST) continue;
    const map = new Map();
    for (const opt of f.LIST) map.set(String(opt.ID), opt.VALUE);
    enums[f.FIELD_NAME] = map;
  }

  const userById = new Map();
  for (const u of users) {
    const name = [u.NAME, u.LAST_NAME].filter(Boolean).join(' ').trim();
    userById.set(String(u.ID), name || u.EMAIL || `#${u.ID}`);
  }

  // Project enum VALUE strings match list-111 element NAMEs exactly, which is
  // how a deal's project is linked to its portfolio manager.
  const pmByProjectName = new Map();
  for (const row of listRows) {
    const prop = row[PM_LIST.PM_PROPERTY];
    if (!prop) continue;
    const ids = Object.values(prop).flat().map(String).filter(Boolean);
    if (ids.length) pmByProjectName.set(row.NAME, ids);
  }

  return { enums, userById, pmByProjectName };
}

async function loadUserfields({ signal }) {
  const all = [];
  let start = 0;
  // This endpoint reports `next` rather than supporting batch paging.
  for (let guard = 0; guard < 40; guard++) {
    const page = await api.userfieldPage(start, { signal });
    all.push(...(page.result || []));
    if (page.next === undefined || page.next === null) break;
    start = page.next;
  }
  return all;
}

/** Resolve a deal's project names via the project enum. */
export function projectNames(deal, enums) {
  const map = enums[FIELD.PROJECT];
  return toArray(deal[FIELD.PROJECT])
    .map((id) => map?.get(String(id)))
    .filter(Boolean);
}

const emptyStats = () => ({ total: 0, overdue: 0, closed: 0, overdueClosed: 0 });

function tally(bucket, deal) {
  bucket.total += 1;
  if (isOverdue(deal)) bucket.overdue += 1;
  if (isClosed(deal)) bucket.closed += 1;
  if (isOverdueClosed(deal)) bucket.overdueClosed += 1;
}

/**
 * Aggregate deals by project and by portfolio manager.
 *
 * A deal may carry several projects; it is counted once under each. Manager
 * totals are therefore derived from project membership and can exceed the
 * deal count when projects share a manager.
 */
export function aggregate(deals, { enums, userById, pmByProjectName }) {
  const byProject = new Map();
  const byManager = new Map();

  for (const deal of deals) {
    const names = projectNames(deal, enums);
    const keys = names.length ? names : ['(პროექტის გარეშე)'];

    for (const name of keys) {
      if (!byProject.has(name)) byProject.set(name, { name, ...emptyStats(), deals: [] });
      const bucket = byProject.get(name);
      tally(bucket, deal);
      bucket.deals.push(deal);

      for (const pmId of pmByProjectName.get(name) || []) {
        if (!byManager.has(pmId)) {
          byManager.set(pmId, {
            id: pmId,
            name: userById.get(pmId) || `#${pmId}`,
            ...emptyStats(),
            deals: [],
            projects: new Set(),
          });
        }
        const mb = byManager.get(pmId);
        tally(mb, deal);
        mb.deals.push(deal);
        mb.projects.add(name);
      }
    }
  }

  const bySize = (a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ka');
  return {
    projects: Array.from(byProject.values()).sort(bySize),
    managers: Array.from(byManager.values())
      .map((m) => ({ ...m, projects: Array.from(m.projects) }))
      .sort(bySize),
    totals: deals.reduce((acc, d) => (tally(acc, d), acc), emptyStats()),
  };
}

/** Portal origin, derived from the webhook so both stay in step. */
export const PORTAL_ORIGIN = new URL(WEBHOOKS.deal).origin;

/** Link to a deal's card in Bitrix. */
export const dealUrl = (id) => `${PORTAL_ORIGIN}/crm/deal/details/${id}/`;

/** Flatten a deal into the columns shown in the slide-over detail table. */
export function dealRow(deal, { enums, userById, pmByProjectName }) {
  const projects = projectNames(deal, enums);
  const pmIds = new Set();
  for (const p of projects) {
    for (const id of pmByProjectName.get(p) || []) pmIds.add(id);
  }
  const nameOf = (id) => userById.get(String(id)) || `#${id}`;

  return {
    id: deal.ID,
    url: dealUrl(deal.ID),
    title: deal.TITLE || `#${deal.ID}`,
    project: projects.join(', ') || '—',
    direction: enums[FIELD.DIRECTION]?.get(String(deal[FIELD.DIRECTION])) || '—',
    problemGroup: enums[FIELD.PROBLEM_GROUP]?.get(String(deal[FIELD.PROBLEM_GROUP])) || '—',
    stage: STAGE_LABEL[deal.STAGE_ID] || deal.STAGE_ID || '—',
    portfolioManager: Array.from(pmIds).map(nameOf).join(', ') || '—',
    assigned: deal.ASSIGNED_BY_ID ? nameOf(deal.ASSIGNED_BY_ID) : '—',
    coAssigned: toArray(deal[FIELD.CO_ASSIGNED]).map(nameOf).join(', ') || '—',
    resolver: deal[FIELD.RESOLVER] ? nameOf(deal[FIELD.RESOLVER]) : '—',
    deadline: formatDate(deal.CLOSEDATE),
  };
}

export const DETAIL_COLUMNS = [
  ['id', 'ID'],
  ['project', 'პროექტი'],
  ['direction', 'მიმართულება'],
  ['problemGroup', 'პრობლემის ჯგუფი'],
  ['stage', 'Stage'],
  ['portfolioManager', 'პორტფოლიო მენეჯერი'],
  ['assigned', 'პასუხისმგებელი'],
  ['coAssigned', 'თანაპასუხისმგებლები'],
  ['resolver', 'მოგვარები'],
  ['deadline', 'მიმდინარე დედლაინი'],
];

export { api, WEBHOOKS, fetchAll };
