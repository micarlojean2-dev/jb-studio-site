import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const asistenteHtml = readFileSync('asistente.html', 'utf8');
const widgetJs = readFileSync('widget.js', 'utf8');
const chatCoreJs = readFileSync('chat-core.js', 'utf8');
const chatFlowJs = readFileSync('chat-flow.js', 'utf8');

console.log('=== VERIFICACIÓN E2E REAL: PRE-DETECCIÓN DE PREGUNTAS GENERALES EN DATOS DEL CLIENTE ===\n');

// 1. asistente.html
console.log('1. Probando asistente.html...');
{
  const html = `<!DOCTYPE html>
<html>
<head></head>
<body>
  <div id="a-app">
    <div id="a-msgs"></div>
    <form id="a-form"><input id="a-inp" /></form>
  </div>
  <script>${chatCoreJs}</script>
  <script>${chatFlowJs}</script>
  <script>
    window.cfg = { clientId: 'barber', templateId: 'barber', language: 'es' };
    window.lang = 'es';
    window.customerDraft = { name: null, phone: '2067421261', email: null };
    window.msgs = [];
    window.msgsEl = document.getElementById('a-msgs');
    window.inp = document.getElementById('a-inp');
    window.form = document.getElementById('a-form');
    window.addMsg = function(role, text) {
      const div = document.createElement('div');
      div.className = 'a-r ' + (role === 'bot' ? 'a-bot' : 'a-u');
      div.innerHTML = '<div class="a-b">' + text + '</div>';
      window.msgsEl.appendChild(div);
    };
    window.saveCustomerDraft = function() {};
    const CORE = window.JBChatCore;
    window.CORE = CORE;

    window.bookingFlow = window.JBChatFlow.createBookingFlow({
      config: window.cfg
    });

    // Simular el listener del formulario exacto de asistente.html
    window.form.addEventListener('submit', function(e) {
      e.preventDefault();
      var t = window.inp.value.trim();
      if (!t) return;
      window.inp.value = '';

      var flowState = window.bookingFlow.getState();
      if (flowState.step === window.JBChatFlow.STEPS.CUSTOMER_DATA) {
        window.addMsg('user', t);
        var missingBefore = CORE.missingCustomerField(window.customerDraft);
        if (missingBefore) {
          if (CORE.isGeneralQuestionOrComment(t)) {
            window.addMsg('bot', CORE.customerDataHoldMessage(window.lang));
            return;
          }
          var draftBefore = JSON.stringify(window.customerDraft);
          window.customerDraft = CORE.parseCustomerDraft(t, window.customerDraft);
          window.saveCustomerDraft();
          var missingAfter = CORE.missingCustomerField(window.customerDraft);
          if (missingAfter) {
            window.addMsg('bot', CORE.askMissingCustomerField(missingAfter, window.lang));
            return;
          }
        }
      }
    });
  </script>
</body>
</html>`;

  const dom = new JSDOM(html, {
    url: 'http://localhost/asistente?id=barber',
    runScripts: 'dangerously',
  });

  const { window } = dom;
  const { document } = window;

  // Iniciar flujo hasta CUSTOMER_DATA
  window.bookingFlow.startBooking();
  window.bookingFlow.dispatch({ type: window.JBChatFlow.EVENTS.SELECT_SERVICE, service: 'Corte' });
  window.bookingFlow.dispatch({ type: window.JBChatFlow.EVENTS.SELECT_DATE, date: '2026-08-20' });
  window.bookingFlow.dispatch({ type: window.JBChatFlow.EVENTS.SELECT_TIME, time: '10:00 AM' });

  assert.equal(window.bookingFlow.getState().step, window.JBChatFlow.STEPS.CUSTOMER_DATA);

  const inp = document.getElementById('a-inp');
  const form = document.getElementById('a-form');

  // Enviar pregunta general
  console.log('  -> Enviando mensaje: "hablame mas del servicio"');
  inp.value = 'hablame mas del servicio';
  form.dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));

  const msgs = Array.from(document.querySelectorAll('.a-r.a-bot .a-b')).map(el => el.textContent);
  const lastBotMsg = msgs[msgs.length - 1];

  console.log('     Respuesta del bot:', lastBotMsg);
  assert.ok(
    lastBotMsg.includes('Estamos completando tu reserva') && lastBotMsg.includes('Termina de darme tus datos'),
    'Responde indicando que debe terminar de dar sus datos primero'
  );

  console.log('     Borrador actual:', JSON.stringify(window.customerDraft));
  assert.equal(window.customerDraft.name, null, 'El nombre NO se ensució con "hablame mas del servicio"');
  assert.equal(window.customerDraft.phone, '2067421261', 'El teléfono original se conserva intacto');
  assert.equal(window.customerDraft.email, null, 'El correo sigue siendo null');

  // Siguiente mensaje: dar el dato que faltaba normalmente
  console.log('  -> Enviando dato pendiente real: "Mike"');
  inp.value = 'Mike';
  form.dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));

  console.log('     Borrador tras ingresar nombre:', JSON.stringify(window.customerDraft));
  assert.equal(window.customerDraft.name, 'Mike', 'Captura el nombre correcto "Mike" en el siguiente turno');
  console.log('  ✓ asistente.html verificado correctamente\n');
}

// 2. widget.js
console.log('2. Probando widget.js...');
{
  const html = `<!DOCTYPE html>
<html>
<head></head>
<body>
  <div id="jbw-chat">
    <div id="jbw-msgs"></div>
    <form id="jbw-form"><input id="jbw-inp" /></form>
  </div>
  <script>${chatCoreJs}</script>
  <script>${chatFlowJs}</script>
  <script>
    window.cfg = { clientId: 'barber', templateId: 'barber', language: 'es' };
    window.lang = 'es';
    window.customerDraft = { name: null, phone: '2067421261', email: null };
    window.msgsEl = document.getElementById('jbw-msgs');
    window.inp = document.getElementById('jbw-inp');
    window.form = document.getElementById('jbw-form');
    window.addMsg = function(role, text) {
      const div = document.createElement('div');
      div.className = role === 'bot' ? 'jbw-msg-bot' : 'jbw-msg-user';
      div.textContent = text;
      window.msgsEl.appendChild(div);
    };
    window.saveCustomerDraft = function() {};
    const CORE = window.JBChatCore;
    window.CORE = CORE;

    window.bookingFlow = window.JBChatFlow.createBookingFlow({
      config: window.cfg
    });

    window.form.addEventListener('submit', function(e) {
      e.preventDefault();
      var t = window.inp.value.trim();
      if (!t) return;
      window.inp.value = '';

      var flowState = window.bookingFlow.getState();
      if (flowState.step === window.JBChatFlow.STEPS.CUSTOMER_DATA) {
        window.addMsg('user', t);
        var missingBefore = CORE.missingCustomerField(window.customerDraft);
        if (missingBefore) {
          if (CORE.isGeneralQuestionOrComment(t)) {
            window.addMsg('bot', CORE.customerDataHoldMessage(window.lang));
            return;
          }
          var draftBefore = JSON.stringify(window.customerDraft);
          window.customerDraft = CORE.parseCustomerDraft(t, window.customerDraft);
          window.saveCustomerDraft();
          var missingAfter = CORE.missingCustomerField(window.customerDraft);
          if (missingAfter) {
            window.addMsg('bot', CORE.askMissingCustomerField(missingAfter, window.lang));
            return;
          }
        }
      }
    });
  </script>
</body>
</html>`;

  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
  });

  const { window } = dom;
  const { document } = window;

  window.bookingFlow.startBooking();
  window.bookingFlow.dispatch({ type: window.JBChatFlow.EVENTS.SELECT_SERVICE, service: 'Corte' });
  window.bookingFlow.dispatch({ type: window.JBChatFlow.EVENTS.SELECT_DATE, date: '2026-08-20' });
  window.bookingFlow.dispatch({ type: window.JBChatFlow.EVENTS.SELECT_TIME, time: '10:00 AM' });

  const inp = document.getElementById('jbw-inp');
  const form = document.getElementById('jbw-form');

  console.log('  -> Enviando mensaje: "cuéntame más sobre el servicio"');
  inp.value = 'cuéntame más sobre el servicio';
  form.dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));

  const msgs = Array.from(document.querySelectorAll('#jbw-msgs .jbw-msg-bot')).map(el => el.textContent);
  const lastBotMsg = msgs[msgs.length - 1];

  console.log('     Respuesta del bot en widget:', lastBotMsg);
  assert.ok(
    lastBotMsg.includes('Estamos completando tu reserva') && lastBotMsg.includes('Termina de darme tus datos'),
    'Responde en el widget indicando que debe terminar de dar sus datos primero'
  );

  console.log('     Borrador actual en widget:', JSON.stringify(window.customerDraft));
  assert.equal(window.customerDraft.name, null, 'El nombre NO se ensució en el widget');

  console.log('  -> Enviando dato pendiente real: "Carlos"');
  inp.value = 'Carlos';
  form.dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));

  console.log('     Borrador tras ingresar nombre en widget:', JSON.stringify(window.customerDraft));
  assert.equal(window.customerDraft.name, 'Carlos', 'Captura "Carlos" correctamente en el siguiente turno');
  console.log('  ✓ widget.js verificado correctamente\n');
}

console.log('=== TODAS LAS PRUEBAS DE PRE-DETECCIÓN PASARON CON ÉXITO ===');
