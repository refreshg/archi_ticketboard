/** Smoke-drive the board in a real browser and capture screenshots. */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4173';
const OUT = process.env.OUT || '.';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });

// Wait for live Bitrix data to populate the KPI tiles.
await page.waitForFunction(
  () => {
    const v = document.getElementById('kpi-total')?.textContent?.trim();
    return v && v !== '—' && v !== '';
  },
  { timeout: 90000 },
);
await page.waitForTimeout(700); // let charts settle
// Freeze animations so full-page captures aren't caught mid-transition.
await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });

const kpis = await page.evaluate(() => ({
  total: document.getElementById('kpi-total').textContent,
  overdue: document.getElementById('kpi-overdue').textContent,
  closed: document.getElementById('kpi-closed').textContent,
  odclosed: document.getElementById('kpi-odclosed').textContent,
  status: document.getElementById('status').textContent,
  projectRows: document.querySelectorAll('#tbl-projects tbody tr').length,
  managerRows: document.querySelectorAll('#tbl-managers tbody tr').length,
  svgs: document.querySelectorAll('.chart svg').length,
}));
console.log('KPIs:', JSON.stringify(kpis, null, 2));

await page.screenshot({ path: `${OUT}/shot-board.png`, fullPage: true });

// Click a non-zero overdue count to open the slide-over.
const clicked = await page.evaluate(() => {
  const cells = document.querySelectorAll('#tbl-projects tbody tr');
  for (const tr of cells) {
    const span = tr.children[2]?.querySelector('.count:not(.zero)');
    if (span) { span.click(); return tr.children[0].textContent.trim(); }
  }
  return null;
});
console.log('clicked overdue count for:', clicked);

if (clicked) {
  await page.waitForFunction(
    () => !document.getElementById('drawer').hasAttribute('hidden'), { timeout: 10000 });
  await page.waitForTimeout(400);
  const detail = await page.evaluate(() => ({
    title: document.getElementById('drawer-title').textContent,
    sub: document.getElementById('drawer-sub').textContent,
    headers: [...document.querySelectorAll('#tbl-detail thead th')].map((t) => t.textContent),
    rows: document.querySelectorAll('#tbl-detail tbody tr').length,
    first: [...(document.querySelectorAll('#tbl-detail tbody tr')[0]?.children || [])]
      .map((td) => td.textContent),
  }));
  console.log('DRAWER:', JSON.stringify(detail, null, 2));
  await page.screenshot({ path: `${OUT}/shot-drawer.png` });
}

// Dark mode pass.
await page.evaluate(() => document.getElementById('drawer-close').click());
await page.waitForFunction(
  () => document.getElementById('drawer').hasAttribute('hidden'), { timeout: 5000 });
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(500);
const drawerClosed = await page.evaluate(() =>
  document.getElementById('drawer').hasAttribute('hidden'));
console.log('drawer closed before dark shot:', drawerClosed);
await page.screenshot({ path: `${OUT}/shot-dark.png`, fullPage: true });

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
