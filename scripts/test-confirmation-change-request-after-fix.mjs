import { chromium } from 'playwright';

const targetUrl = 'https://jb-studio-site-381a5hs8f-micarlojean2-2185s-projects.vercel.app/asistente?id=spa';

console.log('=== PRUEBA DE PEDIDO DE CAMBIO EN PASO CONFIRMATION (PREVIEW CON FIX APLICADO) ===');
console.log('URL:', targetUrl);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto(targetUrl, { waitUntil: 'networkidle' });

  // Idioma
  const langBtn = page.locator('.a-quick-btn', { hasText: /Español/i });
  if (await langBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('1. Seleccionando idioma Español...');
    await langBtn.click();
    await page.waitForTimeout(3000);
  }

  // Reservar
  console.log('2. Haciendo click en Reservar cita...');
  const resBtn = page.locator('.a-quick-btn', { hasText: /Reservar|Book/i });
  await resBtn.click();
  await page.waitForTimeout(3500);

  // Servicio
  console.log('3. Seleccionando servicio...');
  const serviceBtn = page.locator('.a-quick-btn').first();
  await serviceBtn.waitFor({ state: 'visible', timeout: 15000 });
  const serviceName = await serviceBtn.textContent();
  console.log('   Servicio elegido:', serviceName.trim());
  await serviceBtn.click();
  await page.waitForTimeout(3500);

  // Fecha
  console.log('4. Seleccionando fecha...');
  const dateBtn = page.locator('.a-date-calendar-day:not([disabled])').first();
  await dateBtn.waitFor({ state: 'visible', timeout: 15000 });
  await dateBtn.click();
  await page.waitForTimeout(3500);

  // Horario
  console.log('5. Seleccionando horario...');
  const slotBtn = page.locator('.a-quick-btn').first();
  await slotBtn.waitFor({ state: 'visible', timeout: 15000 });
  await slotBtn.click();
  await page.waitForTimeout(2000);

  // Datos de contacto
  console.log('6. Ingresando datos de contacto...');
  const inp = page.locator('#a-inp');
  const snd = page.locator('#a-snd');

  await inp.fill('Mike TEST-FIX');
  await snd.click();
  await page.waitForTimeout(1000);

  await inp.fill('2067421261');
  await snd.click();
  await page.waitForTimeout(1000);

  await inp.fill('micarlojean2@gmail.com');
  await snd.click();
  await page.waitForTimeout(2000);

  // Confirmar nombre
  console.log('7. Confirmando nombre ("Sí, correcto")...');
  const yesBtn = page.locator('.a-quick-btn', { hasText: /Sí, correcto|Yes, correct/i });
  await yesBtn.waitFor({ state: 'visible', timeout: 15000 });
  await yesBtn.click();
  await page.waitForTimeout(1500);

  // Alergias
  console.log('8. Respondiendo alergias ("Ninguna")...');
  await inp.fill('Ninguna');
  await snd.click();
  await page.waitForTimeout(2000);

  // Continuar en resumen
  console.log('9. Haciendo click en Continuar para entrar a CONFIRMATION...');
  const contBtn = page.locator('.a-quick-btn', { hasText: /Continuar|Continue/i });
  await contBtn.waitFor({ state: 'visible', timeout: 15000 });
  await contBtn.click();
  await page.waitForTimeout(3500);

  console.log('\n--- ENTRADA A PASO CONFIRMATION EXITOSA ---\n');

  // CASO 1: "mejor cámbiame la hora a las 3pm"
  console.log('=== CASO 1 ===');
  console.log('Mensaje enviado: "mejor cámbiame la hora a las 3pm"');
  await inp.fill('mejor cámbiame la hora a las 3pm');
  await snd.click();
  await page.waitForTimeout(6000);

  const msgs1 = await page.locator('.a-r.a-bot .a-b').allTextContents();
  const resp1 = msgs1[msgs1.length - 1];
  console.log('\nRespuesta exacta de la IA CON FIX (Caso 1):\n"""\n' + resp1 + '\n"""\n');

  // CASO 2: "puedes cambiar la fecha a mañana"
  console.log('=== CASO 2 ===');
  console.log('Mensaje enviado: "puedes cambiar la fecha a mañana"');
  await inp.fill('puedes cambiar la fecha a mañana');
  await snd.click();
  await page.waitForTimeout(6000);

  const msgs2 = await page.locator('.a-r.a-bot .a-b').allTextContents();
  const resp2 = msgs2[msgs2.length - 1];
  console.log('\nRespuesta exacta de la IA CON FIX (Caso 2):\n"""\n' + resp2 + '\n"""\n');

} catch (err) {
  console.error('ERROR EN PRUEBA:', err);
} finally {
  await browser.close();
}
