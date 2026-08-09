/**
 * Live check of the data layer against server-side counts.
 * Run: node src/verify.mjs
 */
import { api, WEBHOOKS, fetchAll } from './bitrix.js';
import {
  PIPELINE, STAGE, CLOSED_STAGES, FIELD, DEAL_SELECT,
  buildFilter, loadReference, aggregate, dealRow, isOverdue, isClosed, isOverdueClosed,
} from './model.js';

const FROM = '2026-07-09';
let failures = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
}

/** Ask the server for a count, so client aggregation is graded against the source. */
async function serverCount(filter) {
  const res = await fetch(`${WEBHOOKS.deal}/crm.deal.list.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filter, select: ['ID'], start: 0 }),
  });
  return (await res.json()).total;
}

const t0 = Date.now();
const filter = buildFilter({ from: FROM });

const [expTotal, expOverdue, expClosed, expOverdueClosed] = await Promise.all([
  serverCount(filter),
  serverCount({ ...filter, STAGE_ID: STAGE.OVERDUE }),
  serverCount({ ...filter, STAGE_ID: CLOSED_STAGES }),
  serverCount({ ...filter, STAGE_ID: CLOSED_STAGES, [FIELD.OVERDUE_CLOSED]: 1 }),
]);
console.log(`server truth: total=${expTotal} overdue=${expOverdue} closed=${expClosed} overdueClosed=${expOverdueClosed}\n`);

const deals = await fetchAll(WEBHOOKS.deal, 'crm.deal.list', {
  filter, select: DEAL_SELECT, order: { ID: 'ASC' },
});
console.log(`fetched ${deals.length} deals in ${Date.now() - t0}ms\n`);

check('paged deal count', deals.length, expTotal);
check('unique IDs', new Set(deals.map((d) => d.ID)).size, expTotal);
check('overdue', deals.filter(isOverdue).length, expOverdue);
check('closed', deals.filter(isClosed).length, expClosed);
check('overdueClosed', deals.filter(isOverdueClosed).length, expOverdueClosed);

// UF_ fields must survive batch paging, not just the first direct page.
const withProject = deals.filter((d) => d[FIELD.PROJECT] !== undefined).length;
check('deals carrying project field', withProject, deals.length);

const ref = await loadReference();
console.log(`\nreference: ${ref.userById.size} users, ${ref.pmByProjectName.size} projects with a PM, ` +
  `${ref.enums[FIELD.PROJECT]?.size ?? 0} project options`);

const agg = aggregate(deals, ref);
check('aggregate totals.total', agg.totals.total, expTotal);
check('aggregate totals.overdue', agg.totals.overdue, expOverdue);
check('aggregate totals.closed', agg.totals.closed, expClosed);
check('aggregate totals.overdueClosed', agg.totals.overdueClosed, expOverdueClosed);

// Every deal must land in some project bucket exactly once.
const projectSum = agg.projects.reduce((n, p) => n + p.total, 0);
const multi = deals.filter((d) => (Array.isArray(d[FIELD.PROJECT]) ? d[FIELD.PROJECT].length : 0) > 1).length;
check('project bucket sum (deals + extra multi-project rows)', projectSum, expTotal + multi);

console.log(`\ntop projects:`);
for (const p of agg.projects.slice(0, 5)) {
  console.log(`  ${p.name}: total=${p.total} overdue=${p.overdue} closed=${p.closed} odClosed=${p.overdueClosed}`);
}
console.log(`\nportfolio managers (${agg.managers.length}):`);
for (const m of agg.managers.slice(0, 5)) {
  console.log(`  ${m.name}: total=${m.total} overdue=${m.overdue} closed=${m.closed} projects=${m.projects.length}`);
}

const sample = deals.find((d) => d[FIELD.RESOLVER] && d[FIELD.CO_ASSIGNED]) || deals[0];
console.log(`\nsample detail row:`);
console.log(dealRow(sample, ref));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
