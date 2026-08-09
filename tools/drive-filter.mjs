/** Verify the date filter refetches and changes the numbers. */
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const settled = () => page.waitForFunction(() => {
  const s = document.getElementById('status').textContent;
  return /თიქეთი ·/.test(s);
}, { timeout: 90000 });

await page.goto('http://localhost:4173', { waitUntil: 'domcontentloaded' });
await settled();
const read = () => page.evaluate(() => ({
  total: document.getElementById('kpi-total').textContent,
  overdue: document.getElementById('kpi-overdue').textContent,
  status: document.getElementById('status').textContent.trim(),
}));
console.log('1 month :', JSON.stringify(await read()));

// Switch to the 6-month preset.
await page.click('.preset[data-months="6"]');
await page.waitForTimeout(300);
await settled();
const six = await read();
console.log('6 months:', JSON.stringify(six));

// Manual custom range.
await page.fill('#from', '2026-01-01');
await page.fill('#to', '2026-03-31');
await page.click('#apply');
await page.waitForTimeout(300);
await settled();
console.log('custom  :', JSON.stringify(await read()));

// Sorting + search still work.
await page.fill('#q-project', 'უნივერსი');
await page.waitForTimeout(200);
const filtered = await page.evaluate(() =>
  [...document.querySelectorAll('#tbl-projects tbody tr')].map((r) => r.children[0].textContent.trim()));
console.log('search "უნივერსი":', JSON.stringify(filtered));

await page.screenshot({ path: 'shot-filter.png', fullPage: true });
console.log(errors.length ? `ERRORS: ${errors.join(' | ')}` : 'no console errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
