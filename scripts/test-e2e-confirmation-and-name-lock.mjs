import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chatCoreJs = readFileSync('chat-core.js', 'utf8');
const chatFlowJs = readFileSync('chat-flow.js', 'utf8');
const asistenteHtml = readFileSync('asistente.html', 'utf8');

const asistenteScriptStart = asistenteHtml.indexOf('<script>\n(function () {') + 8;
const asistenteScriptEnd = asistenteHtml.lastIndexOf('</script>');
const asistenteJs = asistenteHtml.slice(asistenteScriptStart, asistenteScriptEnd);

console.log('=== VERIFICACIÓN E2E DE CAMBIO A Y CAMBIO B ===\n');

// 1. Probando CAMBIO A: Bloqueo de teclado en confirmación de nombre
console.log('1. Probando CAMBIO A (Bloqueo de teclado durante confirmación de nombre)...');
{
  const html = `<!DOCTYPE html>
<html>
<head></head>
<body>
  <div id="a-app">
    <div id="a-loading"></div>
    <div id="a-notfound"></div>
    <div id="a-version"></div>
    <div id="a-preview-banner"></div>
    <div id="a-head"></div>
    <div id="a-av"></div>
    <div id="a-name"></div>
    <div id="a-status-text"></div>
    <div id="a-msgs"></div>
    <form id="a-form"><input id="a-inp" /><button id="a-snd">Send</button></form>
  </div>
  <script>${chatCoreJs}</script>
  <script>${chatFlowJs}</script>
</body>
</html>`;

  const dom = new JSDOM(html, {
    url: 'http://localhost/asistente/barber',
    runScripts: 'dangerously',
  });

  const { window } = dom;
  const { document } = window;

  window.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/api/build')) {
      return { ok: true, status: 200, json: async () => ({ version: 'local' }) };
    }
    if (u.includes('/api/reservations')) {
      const body = opts && opts.body ? JSON.parse(opts.body) : {};
      if (body.action === 'dates') {
        return { ok: true, status: 200, json: async () => ({ ok: true, dates: [{ value: '2026-08-15', label: 'Sáb 15 Ago' }] }) };
      }
      if (body.action === 'slots') {
        return { ok: true, status: 200, json: async () => ({ ok: true, slots: [{ value: '10:00 AM', label: '10:00 AM' }] }) };
      }
    }
    if (u.includes('/api/client-chat')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          text: '¡Claro! Te muestro los servicios disponibles.',
          interpretation: { intent: 'booking', entities: {} }
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        found: true,
        id: 'barber',
        businessName: 'Barberia Test',
        vertical: 'barber',
        templateId: 'barber',
        language: 'es',
        features: { reservations: true },
        services: [{ id: 's1', name: 'Corte', durationMinutes: 30, price: 20 }],
        slots: [{ value: '10:00 AM', label: '10:00 AM' }]
      }),
    };
  };

  window.eval(asistenteJs);
  await new Promise(r => setTimeout(r, 2200));

  const inp = document.getElementById('a-inp');
  const snd = document.getElementById('a-snd');

  function submitText(text) {
    inp.value = text;
    snd.click();
  }

  const resBtn = Array.from(document.querySelectorAll('.a-quick-btn')).find(b => b.textContent.includes('Reservar'));
  assert.ok(resBtn, 'Encontró botón inicial Reservar');
  resBtn.click();
  await new Promise(r => setTimeout(r, 500));

  const serviceBtn = Array.from(document.querySelectorAll('.a-quick-btn, button')).find(b => b.textContent.includes('Corte'));
  assert.ok(serviceBtn, 'Encontró botón de servicio Corte');
  serviceBtn.click();
  await new Promise(r => setTimeout(r, 2300)); // Esperar rendering del calendario

  const dateBtn = Array.from(document.querySelectorAll('.a-date-calendar-day')).find(b => !b.disabled);
  assert.ok(dateBtn, 'Encontró día en calendario');
  dateBtn.click();
  await new Promise(r => setTimeout(r, 2300)); // Esperar rendering de horarios

  const slotBtn = Array.from(document.querySelectorAll('.a-quick-btn, button')).find(b => b.textContent.includes('10:00 AM'));
  assert.ok(slotBtn, 'Encontró slot 10:00 AM');
  slotBtn.click();
  await new Promise(r => setTimeout(r, 300));

  submitText('Mike');
  await new Promise(r => setTimeout(r, 300));

  submitText('2067421261');
  await new Promise(r => setTimeout(r, 300));

  submitText('test@example.com');
  await new Promise(r => setTimeout(r, 300));

  console.log('   Visual en pantalla:', document.querySelector('.a-quick')?.textContent);
  console.log('   Estado del teclado mientras está la confirmación: inp.disabled =', inp.disabled);
  assert.equal(inp.disabled, true, 'El teclado queda BLOQUEADO (inp.disabled = true) mientras están los botones de confirmación');

  const yesBtn = Array.from(document.querySelectorAll('.a-quick-btn')).find(b => b.textContent.includes('Sí'));
  assert.ok(yesBtn, 'Existe el botón ✅ Sí, correcto');
  yesBtn.click();

  console.log('   Estado tras tocar "Sí, correcto": inp.disabled =', inp.disabled);
  assert.equal(inp.disabled, false, 'El teclado se REACTIVA (inp.disabled = false) al presionar el botón');
  console.log('  ✓ CAMBIO A verificado correctamente en asistente.html\n');
}

// 2. Probando CAMBIO B: Preguntas con IA en el paso CONFIRMATION
console.log('2. Probando CAMBIO B (Preguntas con IA en paso CONFIRMATION)...');
{
  let chatApiCalled = false;
  let receivedMessage = '';

  const html = `<!DOCTYPE html>
<html>
<head></head>
<body>
  <div id="a-app">
    <div id="a-loading"></div>
    <div id="a-notfound"></div>
    <div id="a-version"></div>
    <div id="a-preview-banner"></div>
    <div id="a-head"></div>
    <div id="a-av"></div>
    <div id="a-name"></div>
    <div id="a-status-text"></div>
    <div id="a-msgs"></div>
    <form id="a-form"><input id="a-inp" /><button id="a-snd">Send</button></form>
  </div>
  <script>${chatCoreJs}</script>
  <script>${chatFlowJs}</script>
</body>
</html>`;

  const dom = new JSDOM(html, {
    url: 'http://localhost/asistente/barber',
    runScripts: 'dangerously',
  });

  const { window } = dom;
  const { document } = window;

  window.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/api/build')) {
      return { ok: true, status: 200, json: async () => ({ version: 'local' }) };
    }
    if (u.includes('/api/reservations')) {
      const body = opts && opts.body ? JSON.parse(opts.body) : {};
      if (body.action === 'dates') {
        return { ok: true, status: 200, json: async () => ({ ok: true, dates: [{ value: '2026-08-15', label: 'Sáb 15 Ago' }] }) };
      }
      if (body.action === 'slots') {
        return { ok: true, status: 200, json: async () => ({ ok: true, slots: [{ value: '10:00 AM', label: '10:00 AM' }] }) };
      }
    }
    if (u.includes('/api/client-chat')) {
      const body = opts && opts.body ? JSON.parse(opts.body) : {};
      const lastMsg = body.messages && body.messages[body.messages.length - 1] ? body.messages[body.messages.length - 1].content : '';
      if (lastMsg === '¿Tienen estacionamiento?') {
        chatApiCalled = true;
        receivedMessage = lastMsg;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            text: 'Sí, contamos con estacionamiento gratuito para todos nuestros clientes.',
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          text: '¡Claro! Te muestro los servicios disponibles.',
          interpretation: { intent: 'booking', entities: {} }
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        found: true,
        id: 'barber',
        businessName: 'Barberia Test',
        vertical: 'barber',
        templateId: 'barber',
        language: 'es',
        features: { reservations: true },
        services: [{ id: 's1', name: 'Corte', durationMinutes: 30, price: 20 }],
        slots: [{ value: '10:00 AM', label: '10:00 AM' }]
      }),
    };
  };

  window.eval(asistenteJs);
  await new Promise(r => setTimeout(r, 2200));

  const inp = document.getElementById('a-inp');
  const snd = document.getElementById('a-snd');

  function submitText(text) {
    inp.value = text;
    snd.click();
  }

  const resBtn = Array.from(document.querySelectorAll('.a-quick-btn')).find(b => b.textContent.includes('Reservar'));
  if (resBtn) resBtn.click();
  await new Promise(r => setTimeout(r, 500));

  const serviceBtn = Array.from(document.querySelectorAll('.a-quick-btn, button')).find(b => b.textContent.includes('Corte'));
  if (serviceBtn) serviceBtn.click();
  await new Promise(r => setTimeout(r, 2300));

  const dateBtn = Array.from(document.querySelectorAll('.a-date-calendar-day')).find(b => !b.disabled);
  if (dateBtn) dateBtn.click();
  await new Promise(r => setTimeout(r, 2300));

  const slotBtn = Array.from(document.querySelectorAll('.a-quick-btn, button')).find(b => b.textContent.includes('10:00 AM'));
  if (slotBtn) slotBtn.click();
  await new Promise(r => setTimeout(r, 300));

  submitText('Mike');
  await new Promise(r => setTimeout(r, 300));

  submitText('2067421261');
  await new Promise(r => setTimeout(r, 300));

  submitText('test@example.com');
  await new Promise(r => setTimeout(r, 300));

  const yesBtn = Array.from(document.querySelectorAll('.a-quick-btn')).find(b => b.textContent.includes('Sí'));
  if (yesBtn) yesBtn.click();
  await new Promise(r => setTimeout(r, 300));

  submitText('Ninguna');
  await new Promise(r => setTimeout(r, 300));

  const contBtn = Array.from(document.querySelectorAll('.a-quick-btn, button')).find(b => b.textContent.includes('Continuar'));
  if (contBtn) contBtn.click();
  await new Promise(r => setTimeout(r, 2300)); // Esperar a que el bot termine de escribir el mensaje de CONFIRMATION

  console.log('   Estado del teclado en CONFIRMATION: inp.disabled =', inp.disabled);
  assert.equal(inp.disabled, false, 'El teclado está HABILITADO en el paso CONFIRMATION');

  const msgsBefore = Array.from(document.querySelectorAll('.a-r.a-bot .a-b')).map(el => el.textContent);
  console.log('   Mensaje del bot al entrar a CONFIRMATION:', msgsBefore.slice(-3));
  assert.ok(msgsBefore.some(m => m.includes('¿Tienes alguna duda antes de confirmar?')), 'Muestra el mensaje previo de invitación a consultar');

  console.log('   Enviando pregunta libre: "¿Tienen estacionamiento?"');
  submitText('¿Tienen estacionamiento?');

  await new Promise(r => setTimeout(r, 2300)); // Esperar respuesta de IA

  assert.ok(chatApiCalled, 'Se realizó la llamada a /api/client-chat');
  assert.equal(receivedMessage, '¿Tienen estacionamiento?');

  const msgs = Array.from(document.querySelectorAll('.a-r.a-bot .a-b')).map(el => el.textContent);
  const lastBotMsg = msgs[msgs.length - 1];

  console.log('   Respuesta de la IA recibida:', lastBotMsg);
  assert.equal(lastBotMsg, 'Sí, contamos con estacionamiento gratuito para todos nuestros clientes.');

  console.log('   Verificando botón de confirmación aún presente...');
  const confBtn = Array.from(document.querySelectorAll('.a-quick-btn, button')).find(b => b.textContent.includes('Confirmar'));
  assert.ok(confBtn, 'El botón de "Confirmar" sigue presente en la pantalla para poder confirmar tras la duda');
  assert.equal(inp.disabled, false, 'El teclado sigue HABILITADO tras responder la duda');

  console.log('  ✓ CAMBIO B verificado correctamente en asistente.html\n');
}

console.log('=== TODAS LAS PRUEBAS PASARON EXITOSAMENTE ===');
