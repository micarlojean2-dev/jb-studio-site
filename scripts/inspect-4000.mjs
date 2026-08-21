import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto('http://localhost:4000/asistente?id=spa');
await page.evaluate(() => sessionStorage.clear());
await page.reload();

await page.waitForTimeout(4000);

const btns = await page.locator('button, .a-quick-btn').allTextContents();
console.log('BOTONES VISIBLES DESPUÉS DE LIMPIAR SESSIONSTORAGE:', btns);

await browser.close();
