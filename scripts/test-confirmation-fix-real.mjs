import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

// 1. Parsear .env.prod.real ANTES de cualquier import de la API
if (fs.existsSync('.env.prod.real')) {
  const lines = fs.readFileSync('.env.prod.real', 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const k = trimmed.substring(0, eqIdx).trim();
      let v = trimmed.substring(eqIdx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[k] = v;
    }
  }
}

// 2. Importar dinámicamente handlers una vez que process.env esté listo
const { default: chatHandler } = await import('../api/client-chat.js');
const { default: configHandler } = await import('../api/client-config.js');
const { default: resHandler } = await import('../api/reservations.js');

function wrapRes(res) {
  res.status = function (code) {
    res.statusCode = code;
    return res;
  };
  res.json = function (obj) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

const PORT = 3999;
const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = urlObj.pathname;
  const wrappedRes = wrapRes(res);

  // Servir API local
  if (pathname === '/api/client-config') {
    req.query = Object.fromEntries(urlObj.searchParams);
    return configHandler(req, wrappedRes);
  }
  if (pathname === '/api/client-chat') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', () => {
      try { req.body = JSON.parse(bodyStr); } catch (e) { req.body = {}; }
      return chatHandler(req, wrappedRes);
    });
    return;
  }
  if (pathname === '/api/reservations') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', () => {
      try { req.body = JSON.parse(bodyStr); } catch (e) { req.body = {}; }
      return resHandler(req, wrappedRes);
    });
    return;
  }

  // Servir archivos estáticos locales
  let filePath = path.join(process.cwd(), pathname === '/' ? 'asistente.html' : pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json'
    };
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
    return fs.createReadStream(filePath).pipe(res);
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, async () => {
  console.log(`Servidor de prueba E2E iniciado en http://localhost:${PORT}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(`http://localhost:${PORT}/asistente.html?id=spa`, { waitUntil: 'networkidle' });

    // 1. Idioma
    console.log('1. Seleccionando idioma...');
    const langBtn = page.locator('.a-quick-btn', { hasText: /Español/i });
    await langBtn.waitFor({ state: 'visible', timeout: 10000 });
    await langBtn.click();
    await page.waitForTimeout(4000);

    // 2. Reservar cita
    console.log('2. Iniciando reserva...');
    const resBtn = page.locator('.a-quick-btn', { hasText: /Reservar|Book/i });
    await resBtn.waitFor({ state: 'visible', timeout: 10000 });
    await resBtn.click();
    await page.waitForTimeout(6000);

    // 3. Servicio
    console.log('3. Seleccionando servicio...');
    const serviceBtn = page.locator('#a-quick .a-quick-btn').first();
    await serviceBtn.waitFor({ state: 'visible', timeout: 10000 });
    const svcName = await serviceBtn.textContent();
    console.log('   Servicio:', svcName);
    await serviceBtn.click();
    await page.waitForTimeout(4000);

    // 4. Fecha
    console.log('4. Seleccionando fecha...');
    const dateBtn = page.locator('.a-date-calendar-day:not([disabled])').first();
    await dateBtn.waitFor({ state: 'visible', timeout: 10000 });
    await dateBtn.click();
    await page.waitForTimeout(5000);

    // 5. Horario
    console.log('5. Seleccionando horario...');
    const slotBtn = page.locator('#a-quick .a-quick-btn').first();
    await slotBtn.waitFor({ state: 'visible', timeout: 10000 });
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
    await yesBtn.waitFor({ state: 'visible', timeout: 10000 });
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
    await contBtn.waitFor({ state: 'visible', timeout: 10000 });
    await contBtn.click();
    await page.waitForTimeout(4000);

    console.log('\n--- PASO CONFIRMATION ALCANZADO CON ÉXITO ---\n');

    // TEST 1: "mejor cámbiame la hora a las 3pm"
    console.log('=== PRUEBA 1 CON FIX APLICADO ===');
    console.log('Mensaje enviado: "mejor cámbiame la hora a las 3pm"');
    await inp.fill('mejor cámbiame la hora a las 3pm');
    await snd.click();
    await page.waitForTimeout(8000);

    const msgs1 = await page.locator('.a-r.a-bot .a-b').allTextContents();
    const resp1 = msgs1[msgs1.length - 1];
    console.log('\nRESPUESTA TEXTUAL EXACTA DE LA IA (Caso 1):\n"""\n' + resp1 + '\n"""\n');

    // TEST 2: "puedes cambiar la fecha a mañana"
    console.log('=== PRUEBA 2 CON FIX APLICADO ===');
    console.log('Mensaje enviado: "puedes cambiar la fecha a mañana"');
    await inp.fill('puedes cambiar la fecha a mañana');
    await snd.click();
    await page.waitForTimeout(8000);

    const msgs2 = await page.locator('.a-r.a-bot .a-b').allTextContents();
    const resp2 = msgs2[msgs2.length - 1];
    console.log('\nRESPUESTA TEXTUAL EXACTA DE LA IA (Caso 2):\n"""\n' + resp2 + '\n"""\n');

  } catch (err) {
    console.error('ERROR EN PRUEBA REAL:', err);
  } finally {
    await browser.close();
    server.close();
    process.exit(0);
  }
});
