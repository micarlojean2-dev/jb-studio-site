import { chromium } from 'playwright';

const PREVIEW_URL = 'https://jb-studio-site-33llhcat8-micarlojean2-2185s-projects.vercel.app/asistente?id=spa';

console.log('=== PRUEBA E2E EN PREVIEW DEPLOYMENT CON FIX ===');
console.log('URL:', PREVIEW_URL);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(PREVIEW_URL, { waitUntil: 'networkidle' });

  // 1. Idioma
  console.log('1. Seleccionando idioma "🇪🇸 Español"...');
  const langBtn = page.locator('.a-quick-btn', { hasText: /Español/i });
  await langBtn.waitFor({ state: 'visible', timeout: 10000 });
  await langBtn.click();
  await page.waitForTimeout(5000);

  // 2. Reservar
  console.log('2. Haciendo click en Reservar cita...');
  const resBtn = page.locator('.a-quick-btn', { hasText: /Reservar|Book/i });
  await resBtn.waitFor({ state: 'visible', timeout: 15000 });
  await resBtn.click();
  await page.waitForTimeout(5000);

  // 3. Servicio
  console.log('3. Seleccionando servicio...');
  const serviceBtn = page.locator('.a-svc-card, .a-quick-btn').first();
  await serviceBtn.waitFor({ state: 'visible', timeout: 15000 });
  const serviceName = await serviceBtn.textContent();
  console.log('   Servicio elegido:', serviceName.trim().replace(/\s+/g, ' '));
  await serviceBtn.click();
  await page.waitForTimeout(5000);

  // 4. Fecha
  console.log('4. Seleccionando fecha...');
  const dateBtn = page.locator('.a-date-calendar-day:not([disabled])').first();
  await dateBtn.waitFor({ state: 'visible', timeout: 15000 });
  await dateBtn.click();
  await page.waitForTimeout(5000);

  // 5. Horario
  console.log('5. Seleccionando horario...');
  const slotBtn = page.locator('.a-quick-btn, .a-time-slot').first();
  await slotBtn.waitFor({ state: 'visible', timeout: 15000 });
  await slotBtn.click();
  await page.waitForTimeout(3000);

  // 6. Datos de contacto
  console.log('6. Ingresando datos de contacto...');
  const inp = page.locator('#a-inp');
  const snd = page.locator('#a-snd');

  await inp.fill('Mike');
  await snd.click();
  await page.waitForTimeout(1500);

  await inp.fill('2067421261');
  await snd.click();
  await page.waitForTimeout(1500);

  await inp.fill('micarlojean2@gmail.com');
  await snd.click();
  await page.waitForTimeout(3000);

  // 7. Confirmar nombre
  console.log('7. Confirmando nombre ("Sí, correcto")...');
  const yesBtn = page.locator('.a-quick-btn', { hasText: /Sí, correcto|Yes, correct/i });
  await yesBtn.waitFor({ state: 'visible', timeout: 15000 });
  await yesBtn.click();
  await page.waitForTimeout(2000);

  // 8. Alergias
  console.log('8. Respondiendo alergias ("Ninguna")...');
  await inp.fill('Ninguna');
  await snd.click();
  await page.waitForTimeout(3000);

  // 9. Continuar en resumen
  console.log('9. Haciendo click en Continuar para entrar a CONFIRMATION...');
  const contBtn = page.locator('.a-quick-btn', { hasText: /Continuar|Continue/i });
  await contBtn.waitFor({ state: 'visible', timeout: 15000 });
  await contBtn.click();
  await page.waitForTimeout(5000);

  console.log('\n--- ENTRADA A PASO CONFIRMATION EXITOSA ---\n');

  // CASO 1: "mejor cámbiame la hora a las 3pm"
  console.log('=== CASO 1 (CON FIX EN PREVIEW DEPLOYMENT) ===');
  console.log('Mensaje enviado: "mejor cámbiame la hora a las 3pm"');
  await inp.fill('mejor cámbiame la hora a las 3pm');
  await snd.click();
  await page.waitForTimeout(8000);

  const msgs1 = await page.locator('.a-r.a-bot .a-b').allTextContents();
  const resp1 = msgs1[msgs1.length - 1];
  console.log('\nRespuesta exacta de la IA CON FIX (Caso 1):\n"""\n' + resp1 + '\n"""\n');

  // CASO 2: "puedes cambiar la fecha a mañana"
  console.log('=== CASO 2 (CON FIX EN PREVIEW DEPLOYMENT) ===');
  console.log('Mensaje enviado: "puedes cambiar la fecha a mañana"');
  await inp.fill('puedes cambiar la fecha a mañana');
  await snd.click();
  await page.waitForTimeout(8000);

  const msgs2 = await page.locator('.a-r.a-bot .a-b').allTextContents();
  const resp2 = msgs2[msgs2.length - 1];
  console.log('\nRespuesta exacta de la IA CON FIX (Caso 2):\n"""\n' + resp2 + '\n"""\n');

} catch (err) {
  console.error('ERROR EN PRUEBA:', err);
} finally {
  await browser.close();
}
