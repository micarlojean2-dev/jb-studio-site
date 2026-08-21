import { chromium } from 'playwright';

const URL = 'http://localhost:4000/asistente?id=spa';

console.log('=== PRUEBA E2E REAL CON FIX EN VERCEL DEV (PORT 4000) ===');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext(); // Contexto limpio garantizado
const page = await context.newPage();

try {
  await page.goto(URL, { waitUntil: 'networkidle' });

  // 1. Idioma
  console.log('1. Seleccionando idioma "🇪🇸 Español"...');
  const langBtn = page.locator('.a-quick-btn', { hasText: /Español/i });
  await langBtn.waitFor({ state: 'visible', timeout: 15000 });
  await langBtn.click();
  await page.waitForTimeout(5000);

  // 2. Reservar cita
  console.log('2. Haciendo click en Reservar cita...');
  const resBtn = page.locator('.a-quick-btn', { hasText: /Reservar|Book/i });
  await resBtn.waitFor({ state: 'visible', timeout: 15000 });
  await resBtn.click();
  await page.waitForTimeout(5000);

  // 3. Servicio
  console.log('3. Seleccionando primer servicio...');
  const serviceBtn = page.locator('#a-quick .a-quick-btn').first();
  await serviceBtn.waitFor({ state: 'visible', timeout: 15000 });
  const svcName = await serviceBtn.textContent();
  console.log('   Servicio elegido:', svcName.trim());
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
  const slotBtn = page.locator('#a-quick .a-quick-btn').first();
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
  const yesBtn = page.locator('.a-quick-btn', { hasText: /Sí, correcto/i });
  await yesBtn.waitFor({ state: 'visible', timeout: 15000 });
  await yesBtn.click();
  await page.waitForTimeout(2000);

  // 8. Alergias
  console.log('8. Respondiendo alergias ("Ninguna")...');
  await inp.fill('Ninguna');
  await snd.click();
  await page.waitForTimeout(3000);

  // 9. Entrar a CONFIRMATION
  console.log('9. Haciendo click en Continuar para entrar a CONFIRMATION...');
  const contBtn = page.locator('.a-quick-btn', { hasText: /Continuar/i });
  await contBtn.waitFor({ state: 'visible', timeout: 15000 });
  await contBtn.click();
  await page.waitForTimeout(5000);

  console.log('\n--- PASO CONFIRMATION ALCANZADO CON ÉXITO ---\n');

  // CASO 1: "mejor cámbiame la hora a las 3pm"
  console.log('=== PRUEBA 1 (CON FIX EN LOCAL VERCEL DEV CON OPENAI REAL) ===');
  console.log('Mensaje enviado: "mejor cámbiame la hora a las 3pm"');
  await inp.fill('mejor cámbiame la hora a las 3pm');
  await snd.click();
  await page.waitForTimeout(8000);

  const msgs1 = await page.locator('.a-r.a-bot .a-b').allTextContents();
  const resp1 = msgs1[msgs1.length - 1];
  console.log('\nRESPUESTA TEXTUAL EXACTA DE LA IA (Caso 1):\n"""\n' + resp1 + '\n"""\n');

  // CASO 2: "puedes cambiar la fecha a mañana"
  console.log('=== PRUEBA 2 (CON FIX EN LOCAL VERCEL DEV CON OPENAI REAL) ===');
  console.log('Mensaje enviado: "puedes cambiar la fecha a mañana"');
  await inp.fill('puedes cambiar la fecha a mañana');
  await snd.click();
  await page.waitForTimeout(8000);

  const msgs2 = await page.locator('.a-r.a-bot .a-b').allTextContents();
  const resp2 = msgs2[msgs2.length - 1];
  console.log('\nRESPUESTA TEXTUAL EXACTA DE LA IA (Caso 2):\n"""\n' + resp2 + '\n"""\n');

} catch (err) {
  console.error('ERROR EN PRUEBA:', err);
} finally {
  await browser.close();
}
