import { chromium } from 'playwright';

const targetUrl = 'http://localhost:3530/asistente?id=spa';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto(targetUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const btns = await page.locator('.a-quick-btn, button').allTextContents();
console.log('BOTONES ENCONTRADOS:', btns);

await browser.close();
