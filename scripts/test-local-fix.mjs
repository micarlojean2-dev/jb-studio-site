import fs from 'node:fs';

process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'fake_token';

if (fs.existsSync('.env.prod.pulled')) {
  const lines = fs.readFileSync('.env.prod.pulled', 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key === 'OPENAI_API_KEY') process.env.OPENAI_API_KEY = val;
    }
  }
}

// Mock de Upstash Redis con soporte para Pipeline
const originalFetch = globalThis.fetch;
globalThis.fetch = async function(url, options) {
  const urlStr = String(url);
  const bodyStr = options?.body ? String(options.body) : '';

  if (urlStr.includes('fake.upstash.io')) {
    let parsed = [];
    try { parsed = JSON.parse(bodyStr); } catch (_) {}

    function handleCommand(cmdArr) {
      const cmd = (Array.isArray(cmdArr) && cmdArr[0]) ? String(cmdArr[0]).toLowerCase() : '';
      const key = (Array.isArray(cmdArr) && cmdArr[1]) ? String(cmdArr[1]) : '';

      if (cmd === 'keys' || cmd === 'mget') {
        return { result: [] };
      }
      if (cmd === 'get') {
        if (key.startsWith('client-images:')) return { result: null };
        return {
          result: JSON.stringify({
            businessName: 'Spa Relax',
            language: 'es',
            active: true,
            services: [
              { nombre: 'Masaje relajante', precio: '$50', duracion: '60 min' },
              { nombre: 'Facial hidratante', precio: '$40', duracion: '45 min' }
            ],
            menu: [
              { nombre: 'Masaje relajante', precio: '$50', duracion: '60 min' },
              { nombre: 'Facial hidratante', precio: '$40', duracion: '45 min' }
            ]
          })
        };
      }
      return { result: [] };
    }

    if (urlStr.includes('/pipeline') || (Array.isArray(parsed) && Array.isArray(parsed[0]))) {
      const results = parsed.map(cmd => handleCommand(cmd));
      return new Response(JSON.stringify(results), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify(handleCommand(parsed)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  return originalFetch(url, options);
};

import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const { default: clientChatHandler } = await import('../api/client-chat.js');
const { default: reservationsHandler } = await import('../api/reservations.js');
const { default: clientConfigHandler } = await import('../api/client-config.js');

const PORT = 3545;
const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = urlObj.pathname;

  res.status = function(code) { this.statusCode = code; return this; };
  res.json = function(data) {
    this.setHeader('Content-Type', 'application/json');
    this.end(JSON.stringify(data));
    return this;
  };

  if (pathname === '/api/client-chat' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', async () => {
      req.body = JSON.parse(bodyStr || '{}');
      try { await clientChatHandler(req, res); } catch (err) { res.status(500).json({ error: err.message }); }
    });
    return;
  }

  if (pathname === '/api/client-config') {
    req.query = Object.fromEntries(urlObj.searchParams);
    try { await clientConfigHandler(req, res); } catch (err) { res.status(500).json({ error: err.message }); }
    return;
  }

  if (pathname === '/api/reservations') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', async () => {
      req.body = JSON.parse(bodyStr || '{}');
      try { await reservationsHandler(req, res); } catch (err) { res.status(500).json({ error: err.message }); }
    });
    return;
  }

  let filePath = path.join(process.cwd(), pathname === '/' ? 'asistente.html' : pathname);
  if (pathname === '/asistente') filePath = path.join(process.cwd(), 'asistente.html');

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const contentType = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : 'text/plain';
    res.setHeader('Content-Type', contentType);
    res.end(fs.readFileSync(filePath));
  } else {
    res.status(404).end('Not found');
  }
});

server.listen(PORT, async () => {
  console.log(`Servidor local corriendo en http://localhost:${PORT}`);

  const targetUrl = `http://localhost:${PORT}/asistente?id=spa`;
  console.log('=== PRUEBA E2E CON FIX Y OPENAI REAL ===');
  console.log('URL:', targetUrl);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(targetUrl, { waitUntil: 'networkidle' });

    // Esperar 4.5 segundos a que la bienvenida y sus botones se rendericen completamente
    await page.waitForTimeout(4500);

    const quickBtns = await page.locator('.a-quick-btn').allTextContents();
    console.log('Botones rápidos encontrados:', quickBtns);

    // Click en la primera opción (Reservar cita)
    console.log('2. Haciendo click en primer botón rápido (Reservar cita)...');
    await page.locator('.a-quick-btn').first().click();
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

    await inp.fill('Mike');
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
    console.log('=== CASO 1 (CON FIX APLICADO) ===');
    console.log('Mensaje enviado: "mejor cámbiame la hora a las 3pm"');
    await inp.fill('mejor cámbiame la hora a las 3pm');
    await snd.click();
    await page.waitForTimeout(6000);

    const msgs1 = await page.locator('.a-r.a-bot .a-b').allTextContents();
    const resp1 = msgs1[msgs1.length - 1];
    console.log('\nRespuesta exacta de la IA CON FIX (Caso 1):\n"""\n' + resp1 + '\n"""\n');

    // CASO 2: "puedes cambiar la fecha a mañana"
    console.log('=== CASO 2 (CON FIX APLICADO) ===');
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
    server.close();
  }
});
