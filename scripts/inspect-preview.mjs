import { chromium } from 'playwright';

const PREVIEW_URL = 'https://jb-studio-site-33llhcat8-micarlojean2-2185s-projects.vercel.app/asistente?id=spa';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto(PREVIEW_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

const buttons = await page.locator('button, .a-quick-btn, .a-svc-card').allTextContents();
console.log('BOTONES VISIBLES EN PÁGINA:', buttons);

await browser.close();
