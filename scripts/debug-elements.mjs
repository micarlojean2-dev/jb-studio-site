import { chromium } from 'playwright';

const targetUrl = 'https://jb-studio-site-qt268swah-micarlojean2-2185s-projects.vercel.app/asistente?id=spa';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto(targetUrl, { waitUntil: 'networkidle' });

const langBtn = page.locator('.a-quick-btn', { hasText: /Español/i });
if (await langBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
  await langBtn.click();
  await page.waitForFunction(() => {
    const inp = document.querySelector('#a-inp');
    return inp && !inp.disabled;
  }, { timeout: 10000 });
}

const resBtn = page.locator('.a-quick-btn', { hasText: /Reservar|Book/i });
await resBtn.click();

// Wait 4 seconds for services step typing to finish
await page.waitForTimeout(4000);

const htmlSnippet = await page.evaluate(() => {
  const msgs = document.querySelector('#a-msgs');
  return msgs ? msgs.innerHTML : '';
});
console.log('HTML SNIPPET DE MSGS:\n', htmlSnippet);

await browser.close();
