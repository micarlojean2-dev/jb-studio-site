import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const root = join(import.meta.dirname, '..');
const coreCode = readFileSync(join(root, 'chat-core.js'), 'utf8');
const flowCode = readFileSync(join(root, 'chat-flow.js'), 'utf8');
const assistantHtml = readFileSync(join(root, 'asistente.html'), 'utf8');
const widgetJs = readFileSync(join(root, 'widget.js'), 'utf8');

const scriptMatch = assistantHtml.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if (!scriptMatch) {
  throw new Error('No se encontró el script principal de asistente.html');
}
const assistantScript = scriptMatch[1];

let totalTests = 0;
let passedTests = 0;

function logTest(name, passed, detail = '') {
  totalTests++;
  if (passed) {
    passedTests++;
    console.log(`  ✓ ${name}`);
  } else {
    console.error(`  ✗ ${name} ${detail}`);
  }
}

console.log('=== PRUEBAS E2E REALES: FIX 1 Y FIX 2 ===\n');

// ---------------------------------------------------------------------------
// PRUEBA 1: ASISTENTE.HTML - FIX 1 (Confirmación de nombre y corrección)
// ---------------------------------------------------------------------------
console.log('1. asistente.html — FIX 1: Confirmación de nombre');
{
  const dom = new JSDOM(`<!DOCTYPE html>
<html>
<body>
  <div id="a-loading"></div>
  <div id="a-notfound"></div>
  <div id="a-app" style="display:flex;">
    <div id="a-header">
      <div id="a-title"></div>
      <div id="a-status"></div>
    </div>
    <div id="a-msgs"></div>
    <div id="a-input-area">
      <input id="a-inp" />
      <button id="a-snd"></button>
    </div>
  </div>
</body>
</html>`, {
    url: 'https://example.com/asistente.html?id=test-cli',
    runScripts: 'dangerously'
  });

  const { window } = dom;
  const { document } = window;

  window.API = 'https://example.com';

  window.fetch = async (url) => {
    if (url.includes('/api/client-config')) {
      return {
        ok: true,
        json: async () => ({
          name: 'Spa Test',
          language: 'es',
          primaryColor: '#1a4a2e',
          menu: [{ id: 'm1', name: 'Masaje', price: '$50' }],
          businessHours: { monday: { open: '09:00', close: '20:00' } }
        })
      };
    }
    if (url.includes('/api/availability')) {
      return { ok: true, json: async () => ({ availableDates: ['2026-08-20'], slots: [{ value: '16:00', label: '4:00 PM' }] }) };
    }
    return { ok: true, json: async () => ({}) };
  };

  // Cargar scripts
  window.eval(coreCode);
  window.eval(flowCode);

  // Inyectar helper de prueba en la clausura del asistente
  const adaptedAssistantScript = assistantScript
    .replace(/var BOT_MESSAGE_DELAY_MS = \d+;/, 'var BOT_MESSAGE_DELAY_MS = 0;')
    .replace('var bookingFlow = null;', 'var bookingFlow = null; window._setTestBookingFlow = function(f) { bookingFlow = f; }; window._getCustomerDraft = function() { return customerDraft; }; window._getSpecialRequestsAsked = function() { return specialRequestsAsked; };');

  window.eval(adaptedAssistantScript);

  await new Promise(r => setTimeout(r, 50));

  const inp = document.getElementById('a-inp');
  const snd = document.getElementById('a-snd');
  const msgsEl = document.getElementById('a-msgs');

  function userSends(text) {
    inp.value = text;
    snd.click();
  }

  // 1. Iniciar flujo V2 y llevarlo al paso CUSTOMER_DATA
  const flow = window.JBChatFlow.createBookingFlow({
    config: { clientId: 'test-cli', templateId: 'spa', menu: [{ id: 'm1', name: 'Masaje', price: '$50' }] }
  });
  flow.startBooking();
  flow.dispatch({ type: window.JBChatFlow.EVENTS.SELECT_SERVICE, service: 'Masaje' });
  flow.dispatch({ type: window.JBChatFlow.EVENTS.SELECT_DATE, date: '2026-08-20' });
  flow.dispatch({ type: window.JBChatFlow.EVENTS.SELECT_TIME, time: '16:00' });

  window._setTestBookingFlow(flow);

  // 2. Enviar la frase exacta requerida por el usuario
  const exactInput = "mike,mi numero de telefono es 2067421261,mi correo es micarlojean2@gmail.com";
  userSends(exactInput);
  await new Promise(r => setTimeout(r, 50));

  const msgsText = msgsEl.textContent;

  logTest(
    'Muestra confirmación de nombre con el valor capturado en el borrador (e.g. ¿Tu nombre es "mike mi numero de"?)',
    msgsText.includes('¿Tu nombre es "') && msgsText.includes('"?')
  );

  const quickBtns = Array.from(msgsEl.querySelectorAll('.a-quick-btn'));
  logTest(
    'Renderiza exactamente los dos botones de confirmación (✅ Sí, correcto / ❌ No, corregir)',
    quickBtns.length === 2 &&
    quickBtns[0].textContent.includes('Sí, correcto') &&
    quickBtns[1].textContent.includes('No, corregir')
  );

  const noBtn = quickBtns.find(b => b.textContent.includes('No, corregir'));
  if (noBtn) {
    noBtn.click();
    await new Promise(r => setTimeout(r, 50));

    const draftAfterNo = window._getCustomerDraft();
    logTest(
      'Resetea SOLO el campo name a null (phone y email se conservan)',
      draftAfterNo.name === null &&
      draftAfterNo.phone === '2067421261' &&
      draftAfterNo.email === 'micarlojean2@gmail.com'
    );

    logTest(
      'Solicita explícitamente escribir solo el nombre tras presionar ❌ No, corregir',
      msgsEl.textContent.includes('Por favor, escribí solo tu nombre')
    );

    // Enviar corrección de nombre
    userSends("Michael");
    await new Promise(r => setTimeout(r, 50));

    logTest(
      'Vuelve a pedir confirmación para el nuevo nombre ("Michael")',
      msgsEl.textContent.includes('¿Tu nombre es "Michael"?')
    );

    const newBtns = Array.from(msgsEl.querySelectorAll('.a-quick-btn'));
    const yesBtn = newBtns.find(b => b.textContent.includes('Sí, correcto'));
    if (yesBtn) {
      yesBtn.click();
      await new Promise(r => setTimeout(r, 50));

      logTest(
        'Al presionar ✅ Sí, correcto, avanza a la pregunta de alergias y marca specialRequestsAsked = true',
        msgsEl.textContent.includes('¿Tienes alguna alergia, preferencia o petición especial') &&
        window._getSpecialRequestsAsked() === true
      );

      userSends("Ninguna");
      await new Promise(r => setTimeout(r, 50));

      logTest(
        'Mensajes posteriores con el draft completo NO vuelven a disparar la confirmación',
        !msgsEl.textContent.slice(-100).includes('¿Tu nombre es')
      );
    }
  }
}

// ---------------------------------------------------------------------------
// PRUEBA 2: WIDGET.JS - FIX 1 (Verificación en widget.js)
// ---------------------------------------------------------------------------
console.log('\n2. widget.js — FIX 1: Confirmación de nombre en el widget');
{
  logTest(
    'widget.js implementa confirmación de nombre (¿Tu nombre es "[nombre]"?)',
    widgetJs.includes('¿Tu nombre es "\' + customerDraft.name + \'"?') &&
    widgetJs.includes('nameConfirmationWrap = document.createElement(\'div\')')
  );

  logTest(
    'widget.js resetea SOLO el campo name a null y solicita explícitamente escribir solo el nombre',
    widgetJs.includes('customerDraft.name = null;') &&
    widgetJs.includes('saveCustomerDraft();') &&
    widgetJs.includes('Por favor, escribí solo tu nombre')
  );
}

// ---------------------------------------------------------------------------
// PRUEBA 3: FIX 2 - SINCRONIZACIÓN DE SALUDO Y EMAIL ACTION
// ---------------------------------------------------------------------------
console.log('\n3. FIX 2: Sincronización de saludo y emailAction');
{
  logTest(
    'showGreetingNow en asistente.html retrasa renderQuickActions hasta terminar BOT_MESSAGE_DELAY_MS',
    assistantHtml.includes('function showGreetingNow()') &&
    assistantHtml.includes('setTimeout(function () {\n        renderQuickActions();\n      }, Math.max(0, BOT_MESSAGE_DELAY_MS - (Date.now() - greetingPromptStartedAt)));')
  );

  logTest(
    'showGreetingNow en widget.js retrasa renderQuickActions hasta terminar BOT_MESSAGE_DELAY_MS',
    widgetJs.includes('function showGreetingNow()') &&
    widgetJs.includes('setTimeout(function () {\n      renderQuickActions();\n    }, Math.max(0, BOT_MESSAGE_DELAY_MS - (Date.now() - greetingPromptStartedAt)));')
  );

  logTest(
    'emailAction en asistente.html sincroniza con Math.max(0, BOT_MESSAGE_DELAY_MS - (Date.now() - emailActionPromptStartedAt))',
    assistantHtml.includes('var emailActionPromptStartedAt = Date.now();') &&
    assistantHtml.includes('Math.max(0, BOT_MESSAGE_DELAY_MS - (Date.now() - emailActionPromptStartedAt))')
  );
}

console.log(`\nRESUMEN DE PRUEBAS E2E: ${passedTests}/${totalTests} PASADAS`);
if (passedTests !== totalTests) {
  process.exit(1);
}
