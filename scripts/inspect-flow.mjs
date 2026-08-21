import { chromium } from 'playwright';

const PREVIEW_URL = 'https://jb-studio-site-33llhcat8-micarlojean2-2185s-projects.vercel.app/asistente?id=spa';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(PREVIEW_URL, { waitUntil: 'networkidle' });

  console.log('1. Esperando idioma...');
  const langBtn = page.locator('.a-quick-btn', { hasText: /Español/i });
  await langBtn.waitFor({ state: 'visible' });
  await langBtn.click();
  await page.waitForTimeout(4000);

  const inp = page.locator('#a-inp');
  const snd = page.locator('#a-snd');

  console.log('2. Enviando "Masaje relajante"...');
  await inp.fill('Masaje relajante');
  await snd.click();
  await page.waitForTimeout(6000);

  const msgs = await page.locator('.a-r .a-b').allTextContents();
  console.log('\n--- MENSAJES EN CHAT TRAS "Masaje relajante" ---\n', msgs);

} catch (err) {
  console.error('ERROR:', err);
} finally {
  await browser.close();
}
