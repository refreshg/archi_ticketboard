/** Verify the drawer rows link to the right Bitrix deal cards. */
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://localhost:4173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const v = document.getElementById('kpi-total')?.textContent?.trim();
  return v && v !== '—';
}, { timeout: 90000 });

// Open a project's overdue list.
await page.evaluate(() => {
  for (const tr of document.querySelectorAll('#tbl-projects tbody tr')) {
    const span = tr.children[2]?.querySelector('.count:not(.zero)');
    if (span) { span.click(); return; }
  }
});
await page.waitForFunction(
  () => !document.getElementById('drawer').hasAttribute('hidden'), { timeout: 10000 });
await page.waitForTimeout(300);

const info = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#tbl-detail tbody tr.deal-row')];
  const stored = JSON.parse(document.getElementById('drawer').dataset.rows || '[]');
  return {
    headers: [...document.querySelectorAll('#tbl-detail thead th')].map((t) => t.textContent),
    rowCount: rows.length,
    sub: document.getElementById('drawer-sub').textContent,
    first: {
      id: rows[0]?.children[0]?.textContent.trim(),
      rowUrl: rows[0]?.dataset.url,
      anchorHref: rows[0]?.querySelector('a.deal-link')?.href,
      target: rows[0]?.querySelector('a.deal-link')?.target,
      rel: rows[0]?.querySelector('a.deal-link')?.rel,
    },
    // Every row's URL must embed its own ID.
    allMatch: stored.every((r) => r.url === `https://crm.archi.ge/crm/deal/details/${r.id}/`),
  };
});
console.log(JSON.stringify(info, null, 2));

// Clicking a row must open the deal in a new tab.
const [popup] = await Promise.all([
  ctx.waitForEvent('page', { timeout: 10000 }),
  page.evaluate(() => document.querySelector('#tbl-detail tbody tr.deal-row').click()),
]);
console.log('row click opened:', popup.url());

// Clicking the ID anchor must not double-open.
const before = ctx.pages().length;
const [popup2] = await Promise.all([
  ctx.waitForEvent('page', { timeout: 10000 }),
  page.evaluate(() => document.querySelector('#tbl-detail a.deal-link').click()),
]);
await page.waitForTimeout(500);
console.log('anchor click opened:', popup2.url());
console.log('tabs opened by anchor click:', ctx.pages().length - before, '(expect 1)');

await page.screenshot({ path: 'shot-links.png' });
console.log(errors.length ? `ERRORS: ${errors.join(' | ')}` : 'no console errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
