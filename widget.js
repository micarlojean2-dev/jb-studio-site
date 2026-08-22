/* JB Studio Chat Widget — jbstudio.app/widget.js */
(function () {
  'use strict';

  // ── Read clientId from this script tag ──────────────────────────────────
  var me = document.currentScript;
  if (!me) return;
  var clientId;
  try { clientId = new URL(me.src).searchParams.get('id'); } catch (e) { return; }
  if (!clientId || !/^[a-z0-9-]+$/.test(clientId)) return;

  var API  = 'https://jbstudio.app';
  var CORE, FLOW, RESUMEN_ICONOS, CORRECCION_RE, CAMPO_MENCIONADO;
  var SESS = 'jbw_' + clientId;

  // Monitoreo aislado (Sentry): corre embebido en el sitio de un negocio
  // cliente, así que nunca usa Sentry.init()/Loader normal (instalarían
  // window.onerror y instrumentarían fetch/XHR de TODA la página anfitriona).
  // En su lugar arma un BrowserClient+Scope propio con integrations:[] (patrón
  // oficial "Multiple Sentry Instances"), que nunca se registra como cliente
  // global de window.Sentry — aislado de cualquier Sentry que el sitio ya
  // tenga. Best-effort siempre: si el DSN falta, el bundle no carga (CSP,
  // adblocker) o algo falla, el widget sigue funcionando igual.
  var WIDGET_VERSION = '1.0.0';
  var WIDGET_SENTRY_DSN = 'https://01798dd3dcf929fe3a2800b6b3c4e47e@o4511805847633920.ingest.us.sentry.io/4511805885186048';
  var WIDGET_ERROR_CAP = 5;   // por carga de página: no inundar el plan gratuito por un fallo en bucle
  var widgetScope = null;
  var widgetErrorCount = 0;
  var widgetErrorSeen = {};

  (function initWidgetSentry() {
    if (!WIDGET_SENTRY_DSN || WIDGET_SENTRY_DSN.indexOf('__WIDGET_SENTRY_DSN__') !== -1) return;
    try {
      var s = document.createElement('script');
      s.src = 'https://browser.sentry-cdn.com/10.68.0/bundle.min.js'; // build bundle, no Loader
      s.crossOrigin = 'anonymous';
      s.async = true;
      s.onload = function () {
        try {
          if (!window.Sentry || !window.Sentry.BrowserClient) return;
          var client = new window.Sentry.BrowserClient({
            dsn: WIDGET_SENTRY_DSN,
            transport: window.Sentry.makeFetchTransport,
            stackParser: window.Sentry.defaultStackParser,
            integrations: [],
            sendDefaultPii: false,
            tracesSampleRate: 0,
            environment: 'production',
            beforeSend: function (event) {
              if (event.request) { delete event.request.cookies; delete event.request.data; }
              event.user = undefined;
              return event;
            },
          });
          widgetScope = new window.Sentry.Scope();
          widgetScope.setClient(client);
          client.init();
          widgetScope.setTag('runtime', 'browser');
          widgetScope.setTag('widget_version', WIDGET_VERSION);
          widgetScope.setTag('domain', window.location.hostname);
          widgetScope.setTag('client_id', clientId);
          widgetScope.setTag('chatbot_id', clientId); // mismo id: no hay chatbot_id separado en este proyecto
        } catch (e) { widgetScope = null; }
      };
      s.onerror = function () { widgetScope = null; };
      var inject = function () { document.head.appendChild(s); };
      if ('requestIdleCallback' in window) window.requestIdleCallback(inject, { timeout: 3000 });
      else setTimeout(inject, 0);
    } catch (e) { /* el monitoreo nunca debe romper el widget */ }
  })();

  function captureWidgetError(err, feature) {
    if (!widgetScope || widgetErrorCount >= WIDGET_ERROR_CAP) return;
    try {
      var sig = feature + ':' + String((err && err.message) || err).slice(0, 120);
      if (widgetErrorSeen[sig]) return;   // no dupliques la misma falla repetida en esta sesión
      widgetErrorSeen[sig] = true;
      widgetErrorCount++;
      widgetScope.setTag('feature', feature);
      if (typeof cfg !== 'undefined' && cfg && cfg.templateId) widgetScope.setTag('business_type', cfg.templateId);
      widgetScope.captureException(err instanceof Error ? err : new Error(String(err)));
    } catch (e) { /* el monitoreo nunca debe romper el widget */ }
  }

  function captureWidgetBookingV2Event(event, state, reason) {
    if (!widgetScope || typeof widgetScope.captureMessage !== 'function') return;
    try {
      widgetScope.setTag('flow_version', 'v2'); widgetScope.setTag('surface', 'widget');
      widgetScope.setTag('template', CORE && CORE.templateId(cfg) || 'spa');
      widgetScope.setTag('step', state && state.step || 'unknown');
      if (reason) widgetScope.setTag('reason', reason);
      widgetScope.captureMessage('booking_' + event, event === 'confirmation_failed' ? 'warning' : 'info');
    } catch (e) {}
  }

  // El motor compartido vive en jbstudio.app, el mismo origen del que este
  // widget ya depende para /api/client-config y /api/client-chat: no añade
  // un punto de fallo nuevo. Si no carga, no pintamos nada — mejor ausente
  // que a medias.
  if (window.JBChatCore) { cargarFlow(); }
  else {
    var _core = document.createElement('script');
    _core.src = API + '/chat-core.js';
    _core.onload = cargarFlow;
    _core.onerror = function () { /* sin motor no hay widget */ };
    document.head.appendChild(_core);
  }

  function cargarFlow() {
    CORE = window.JBChatCore;
    if (!CORE) return;
    if (window.JBChatFlow) { arrancar(); return; }
    var flow = document.createElement('script');
    flow.src = API + '/chat-flow.js';
    flow.onload = arrancar;
    flow.onerror = function () { arrancar(); };
    document.head.appendChild(flow);
  }

  function arrancar() {
    CORE = window.JBChatCore;
    FLOW = window.JBChatFlow || null;
    if (!CORE) return;
    RESUMEN_ICONOS = CORE.RESUMEN_ICONOS;
    CORRECCION_RE  = CORE.CORRECCION_RE;
    CAMPO_MENCIONADO = CORE.CAMPO_MENCIONADO;
    iniciar();
  }

  function iniciar() {

  // Posición del botón flotante. Prioridad: data-position del <script> y, si
  // no viene, lo que tenga guardado el cliente. Los clientes antiguos no
  // tienen ninguno de los dos y siguen abajo a la derecha, como siempre.
  var position = me.getAttribute('data-position');
  if (position !== 'bottom-left' && position !== 'bottom-right') position = '';

  // El CSS se inyecta antes de que llegue la config, así que el lado inicial
  // sale del data-position del snippet. Si el snippet es antiguo y no lo trae,
  // applyPosition() lo corrige cuando la config del cliente ya está cargada.
  var SIDE_CSS = position === 'bottom-left' ? 'left' : 'right';

  // Token de vista previa del admin, si la página anfitriona lo trae. Solo lo
  // usa la página de demostración del panel; en el sitio real del cliente no
  // existe y el widget se comporta igual que siempre.
  var previewToken = (function () {
    try {
      var t = new URLSearchParams(window.location.search).get('preview') || '';
      return /^[a-f0-9]{64}$/.test(t) ? t : '';
    } catch (e) { return ''; }
  })();

  function applyPosition(side) {
    var els = [document.getElementById('jbw-fab'), document.getElementById('jbw-panel')];
    els.forEach(function (el) {
      if (!el) return;
      el.classList.toggle('jbw-left', side === 'left');
      el.classList.toggle('jbw-right', side !== 'left');
    });
  }

  // ── State ────────────────────────────────────────────────────────────────
  var cfg     = { businessName: 'Chat', color: '#1a4a2e', language: 'es', active: true };
  var LANGUAGE_SESS = SESS + '_language';

  // Selector explícito de idioma (Objetivo 1): la única condición real es que
  // el negocio declare ambos idiomas — nunca depende de templateId==='spa'
  // (antes sí, y por eso barbería/restaurante bilingües nunca lo ofrecían).
  // Una vez elegido, NUNCA se vuelve a detectar automáticamente: no hay
  // ninguna otra ruta en este archivo que reescriba cfg.language a partir de
  // texto libre. [Objetivo 1, reglas 2 y 7]
  function hasLanguageChoice() { return CORE.hasLanguageChoice(cfg); }
  function storedLanguage() {
    try { var v = sessionStorage.getItem(LANGUAGE_SESS); return (v === 'en' || v === 'es') ? v : ''; } catch (e) { return ''; }
  }
  function setLanguage(lang) {
    cfg.language = lang === 'en' ? 'en' : 'es';
    try { sessionStorage.setItem(LANGUAGE_SESS, cfg.language); } catch (e) {}
  }
  // isCancellationRequest() se eliminó en la MIGRACIÓN 1 (intención por IA):
  // sin callers tras mover la detección de cancelación a interpretation.intent
  // (ver send()). asistente.html conserva su propia copia — no comparte esta
  // función con widget.js, así que no se ve afectado.

  // Feature gating — legacy clients (no cfg.features at all) keep every
  // behavior enabled, exactly like before this was added. Only a client
  // created by the automatic wizard, with an explicit "false", turns a
  // behavior off. Keep this regex/gating pattern in sync with asistente.html
  // (no shared module in this vanilla codebase to dedupe against).
  function featureOn(key) { return CORE.featureOn(cfg, key); }
  var msgs    = [];
  var open    = false;
  var busy    = false;
  var greeted = false;
  var bookingFlow = null;
  var bookingFlowIdempotencyKey = '';
  var widgetFlowActions = null;
  var widgetTimeQuestionMessage = null;
  var widgetDateConfirmation = null;
  var nameConfirmationWrap = null;
  var widgetDateOptions = [];
  var widgetDateMonth = '';
  var widgetDateOptionsLoaded = false;
  var widgetDatePendingText = '';
  var autoSelectingService = false;
  var bookingQuestionActive = false;
  var galleryInputLocked = false;
  var renderingServicePhotoGallery = false;
  var BOT_MESSAGE_DELAY_MS = 2000;
  var DRAFT_SESS = SESS + '_customer_draft_v2';
  var customerDraft = { name: null, phone: null, email: null };
  var specialRequestsAsked = false;
  var customerIntroGiven = false;

  function updateWidgetBookingInputState(step) {
    var lang = cfg.language === 'en' ? 'en' : 'es';
    // DATE_SELECTION ya no habilita texto libre: solo el calendario decide
    // la fecha. [CAMBIO 2] SUMMARY se suma a CONFIRMATION como paso donde
    // se puede preguntar con IA sin perder los botones de editar. [CAMBIO 3]
    if (!galleryInputLocked && (!step || step === FLOW.STEPS.CHAT || step === FLOW.STEPS.CUSTOMER_DATA || step === FLOW.STEPS.SUMMARY || step === FLOW.STEPS.CONFIRMATION)) {
      inp.disabled = false;
      snd.disabled = false;
      inp.placeholder = lang === 'en' ? 'Type a message…' : 'Escribe un mensaje…';
    } else {
      inp.disabled = true;
      snd.disabled = true;
      inp.placeholder = lang === 'en' ? 'Please use the options above' : 'Usa las opciones de arriba';
    }
  }

  function setWidgetGalleryInputLocked(locked) {
    galleryInputLocked = locked;
    if (locked) {
      inp.disabled = true;
      snd.disabled = true;
      inp.placeholder = cfg.language === 'en' ? 'Choose a service or continue chatting' : 'Elige un servicio o sigue conversando';
    } else if (!busy && !bookingFlow) {
      inp.disabled = false;
      snd.disabled = false;
      inp.placeholder = cfg.language === 'en' ? 'Type a message…' : 'Escribe un mensaje…';
      inp.focus();
    }
  }

  function resetCustomerDraft() {
    customerDraft = { name: null, phone: null, email: null, pendingSpecialMention: null };
    specialRequestsAsked = false;
    customerIntroGiven = false;
    if (nameConfirmationWrap && nameConfirmationWrap.parentNode) nameConfirmationWrap.remove();
    nameConfirmationWrap = null;
    try { sessionStorage.removeItem(DRAFT_SESS); } catch (e) {}
    if (typeof FLOW !== 'undefined' && FLOW) updateWidgetBookingInputState(FLOW.STEPS.CHAT);
  }

  function saveCustomerDraft() {
    try { sessionStorage.setItem(DRAFT_SESS, JSON.stringify(customerDraft)); } catch (e) {}
  }

  function syncCustomerDraftFromState(state) {
    try {
      var savedDraft = sessionStorage.getItem(DRAFT_SESS);
      if (savedDraft) {
        var parsed = JSON.parse(savedDraft);
        if (parsed && typeof parsed === 'object') {
          customerDraft = { name: parsed.name || null, phone: parsed.phone || null, email: parsed.email || null, pendingSpecialMention: parsed.pendingSpecialMention || null };
          return;
        }
      }
    } catch (e) {}
    if (state && state.customer && (state.customer.name || state.customer.phone || state.customer.email)) {
      customerDraft = {
        name: state.customer.name || null,
        phone: state.customer.phone || null,
        email: state.customer.email || null,
        pendingSpecialMention: null,
      };
    } else {
      resetCustomerDraft();
    }
  }

  // ── Sincronización apertura ↔ config (condición de carrera) ─────────────
  // Antes, el clic decidía selector-vs-saludo con cfg.languages tal cual
  // estuviera EN ESE INSTANTE: si el usuario abría antes de que resolviera
  // GET /api/client-config, cfg.languages todavía no existía,
  // hasLanguageChoice() daba false, se mostraba el saludo en español y
  // greeted quedaba en true para siempre — cuando la config bilingüe
  // llegaba después, ya era tarde y el selector nunca aparecía. [Objetivo 1]
  var configReady = false;            // /api/client-config ya resolvió (con datos o sin ellos)
  var configFailed = false;           // resolvió sin datos, o la petición falló
  var openRequested = false;          // el usuario ya pidió abrir el chat
  var initialExperienceShown = false; // selector o saludo YA se mostró (una sola vez)

  // ── Active reservation state (misma lógica que asistente.html) ───────────
  var RESERVA_SESS = SESS + '_reserva';
  var activeReservation = null;
  var selectedReservationId = null;
  var dupAttempts = 0;
  var spamUntil = 0;
  var modifyMode = false;
  var dupPending = false;   // se ofrecieron los botones Modificar/Cancelar/Mantener; nada de chat libre hasta que se use uno
  var accionesBotones = null;  // botones de la reserva activa, para no dejar un par duplicado
  try { activeReservation = JSON.parse(sessionStorage.getItem(RESERVA_SESS) || 'null'); } catch (e) {}
  function saveReserva() { try {
    if (activeReservation) sessionStorage.setItem(RESERVA_SESS, JSON.stringify(activeReservation));
    else sessionStorage.removeItem(RESERVA_SESS);
  } catch (e) {} }
  try { msgs = JSON.parse(sessionStorage.getItem(SESS) || '[]'); } catch (e) { msgs = []; }
  if (msgs.length) greeted = true;

  function save() {
    try {
      sessionStorage.setItem(SESS, JSON.stringify(msgs.slice(-60)));
    } catch (e) {}
  }

  // Halo del pulso: mismo color del negocio, translúcido. Si el color no es
  // un hex reconocible, caemos a un negro suave en vez de romper el CSS.
  // ── Inject CSS ───────────────────────────────────────────────────────────
  var css = document.createElement('style');
  css.textContent = [
    // --jbw-edge: separación al borde. Una sola variable para el botón y el
    // panel, para que ambos se muevan juntos y el móvil solo la redefina.
    '#jbw-fab,#jbw-panel{--jbw-edge:20px;',
      "font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;}",
    '#jbw-fab{position:fixed;bottom:var(--jbw-edge);height:46px;',
    'border-radius:23px;border:none;cursor:pointer;display:flex;',
    'align-items:center;justify-content:center;gap:8px;padding:0 16px;',
    'box-shadow:0 4px 16px rgba(0,0,0,.18),0 1px 4px rgba(0,0,0,.12);z-index:2147483646;',
    'font-size:14.5px;font-weight:600;color:#fff;line-height:1;white-space:nowrap;',
    'letter-spacing:-0.01em;',
    'transition:transform .22s cubic-bezier(.22,1,.36,1),box-shadow .22s;}',
    '#jbw-fab.jbw-right{right:var(--jbw-edge);left:auto;}',
    '#jbw-fab.jbw-left{left:var(--jbw-edge);right:auto;}',
    '#jbw-fab:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.24),0 2px 6px rgba(0,0,0,.14);}',
    '#jbw-fab:active{transform:translateY(0);}',
    '#jbw-fab svg{flex-shrink:0;width:18px;height:18px;}',

    // Animated text inside the FAB
    '.jbw-fab-text{display:inline-block;opacity:1;',
    'transition:opacity .35s cubic-bezier(.22,1,.36,1),transform .35s cubic-bezier(.22,1,.36,1);}',
    '.jbw-fab-text.fade-out{opacity:0;transform:translateY(6px);}',
    '.jbw-fab-text.fade-in{opacity:1;transform:translateY(0);}',

    // Pulso suave cada 4s. Se detiene con el panel abierto y respeta a quien
    // pidio menos movimiento en el sistema.
    // Respiración muy leve cada 5s: se nota por el rabillo del ojo sin
    // reclamar atención. Un anillo expansivo resultaba agresivo.
    '@keyframes jbw-breathe{0%,90%,100%{box-shadow:0 4px 16px rgba(0,0,0,.18),0 1px 4px rgba(0,0,0,.12),0 0 0 0 var(--jbw-pulse);}',
    '95%{box-shadow:0 4px 16px rgba(0,0,0,.18),0 1px 4px rgba(0,0,0,.12),0 0 0 7px transparent;}}',
    '#jbw-fab.jbw-pulsing{animation:jbw-breathe 5s ease-out infinite;}',
    '@media(prefers-reduced-motion:reduce){#jbw-fab.jbw-pulsing{animation:none;}}',

    '#jbw-panel{position:fixed;bottom:78px;width:400px;height:600px;',
    'max-height:calc(100vh - 100px);',
    'border-radius:24px;background:#fff;z-index:2147483645;display:flex;',
    'flex-direction:column;overflow:hidden;',
    'box-shadow:0 24px 70px rgba(0,0,0,.20),0 8px 24px rgba(0,0,0,.10),0 0 0 1px rgba(0,0,0,.05);',
    'transform:scale(.96) translateY(12px);transform-origin:bottom right;',
    'opacity:0;pointer-events:none;',
    'transition:transform .26s cubic-bezier(.22,1,.36,1),opacity .2s ease;',
    'letter-spacing:-0.01em;}',
    '#jbw-panel.jbw-left{transform-origin:bottom left;}',
    '#jbw-panel.jbw-open{transform:scale(1) translateY(0);opacity:1;pointer-events:all;}',
    '#jbw-panel.jbw-right{right:var(--jbw-edge);left:auto;}',
    '#jbw-panel.jbw-left{left:var(--jbw-edge);right:auto;}',

    '#jbw-head{padding:18px 18px;display:flex;align-items:center;gap:12px;flex-shrink:0;}',
    '.jbw-hi{flex:1;min-width:0;}',
    '#jbw-close{width:32px;height:32px;border-radius:50%;border:none;cursor:pointer;',
    'background:rgba(255,255,255,.20);color:#fff;display:flex;align-items:center;',
    'justify-content:center;flex-shrink:0;padding:0;transition:background .15s;}',
    '#jbw-close:hover{background:rgba(255,255,255,.34);}',
    '#jbw-av{width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.20);',
    'display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;',
    'box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);}',
    '.jbw-hi h4{margin:0;font-size:15.5px;font-weight:650;color:#fff;line-height:1.25;}',
    '.jbw-hi p{margin:3px 0 0;font-size:11.5px;color:rgba(255,255,255,.75);',
    'display:flex;align-items:center;gap:5px;font-weight:500;}',
    '#jbw-version{margin-top:3px;font:10px ui-monospace,SFMono-Regular,Menlo,monospace;color:rgba(255,255,255,.62);}',
    '.jbw-dot{width:6px;height:6px;border-radius:50%;background:#4ade80;display:inline-block;}',

    '#jbw-msgs{flex:1;overflow-y:auto;padding:18px 16px;display:flex;',
    'flex-direction:column;gap:14px;background:#fafafa;overscroll-behavior:contain;}',
    '#jbw-msgs::-webkit-scrollbar{width:4px;}',
    '#jbw-msgs::-webkit-scrollbar-thumb{background:rgba(0,0,0,.14);border-radius:2px;}',

    '.jbw-r{display:flex;align-items:flex-end;gap:6px;}',
    '.jbw-r.jbw-u{justify-content:flex-end;}',
    '.jbw-b{max-width:80%;padding:11px 14px;border-radius:18px;font-size:14px;',
    'line-height:1.55;word-break:break-word;white-space:pre-wrap;',
    'animation:jbw-in .26s cubic-bezier(.22,1,.36,1);}',
    '@keyframes jbw-in{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}',
    '@media(prefers-reduced-motion:reduce){.jbw-b{animation:none;}}',
    '.jbw-r.jbw-bot .jbw-b{background:#fff;color:#16181d;',
    'border-radius:18px 18px 18px 5px;',
    'box-shadow:0 1px 2px rgba(0,0,0,.05),0 4px 14px rgba(0,0,0,.05);}',
    '.jbw-r.jbw-system{justify-content:center;}',
    '.jbw-r.jbw-system .jbw-b{background:#fff3e0;color:#934800;border:1px solid #f4b56b;',
    'border-radius:12px;box-shadow:none;font-size:13px;text-align:center;}',
    '.jbw-r.jbw-u .jbw-b{color:#fff;border-radius:18px 18px 5px 18px;',
    'box-shadow:0 2px 10px rgba(0,0,0,.10);}',
    '.jbw-ba{width:24px;height:24px;border-radius:50%;display:flex;',
    'align-items:center;justify-content:center;font-size:10px;flex-shrink:0;color:#fff;}',
    '.jbw-ty{background:#fff;color:#aaa;padding:9px 12px;',
    'border-radius:14px 14px 14px 3px;font-size:20px;letter-spacing:4px;',
    'box-shadow:0 1px 4px rgba(0,0,0,.09);}',

    '#jbw-foot{padding:12px 14px 16px;background:#fff;',
    'border-top:1px solid rgba(0,0,0,.06);display:flex;gap:9px;align-items:center;}',
    '#jbw-inp{flex:1;border:1.5px solid transparent;border-radius:22px;',
    'padding:11px 16px;font-size:14px;outline:none;background:#f2f3f5;',
    'color:#16181d;font-family:inherit;letter-spacing:-0.01em;',
    'transition:border-color .18s,background .18s,box-shadow .18s;}',
    '#jbw-inp:focus{border-color:rgba(0,0,0,.10);background:#fff;',
    'box-shadow:0 2px 10px rgba(0,0,0,.06);}',
    '#jbw-inp::placeholder{color:#a8acb3;}',
    '#jbw-inp:disabled{opacity:.5;cursor:not-allowed;}',
    '#jbw-snd{width:38px;height:38px;border-radius:50%;border:none;cursor:pointer;',
    'display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff;',
    'transition:transform .15s,opacity .15s;}',
    '#jbw-snd:hover:not(:disabled){transform:scale(1.08);}',
    '#jbw-snd:disabled{opacity:.4;cursor:not-allowed;}',
    '#jbw-snd svg{width:15px;height:15px;}',
    // Cerrado, el botón sigue discreto. Abierto, el panel ocupa casi toda la
    // pantalla: en un móvil una tarjeta pequeña se lee mal.
    '@media(max-width:600px){',
      '#jbw-fab,#jbw-panel{--jbw-edge:16px;}',
      '#jbw-fab{height:46px;border-radius:23px;font-size:14.5px;padding:0 16px;}',
      '#jbw-fab svg{width:18px;height:18px;}',
      '#jbw-panel{width:94vw;max-width:94vw;height:86vh;max-height:86vh;bottom:74px;',
      'border-radius:22px;}',
    '}',

    '.jbw-cards-wrap{width:100%;padding:2px 0 0;}',
    '.jbw-cards{display:grid;grid-template-columns:1fr 1fr;gap:9px;padding:0 0 4px;}',
    '.jbw-card{display:flex;flex-direction:column;align-items:center;text-align:center;',
    'gap:2px;width:100%;font-family:inherit;cursor:pointer;background:#fff;',
    'border:1.5px solid rgba(0,0,0,.06);border-radius:18px;padding:16px 12px 14px;',
    'min-height:172px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 4px 14px rgba(0,0,0,.05);',
    'transition:transform .18s cubic-bezier(.22,1,.36,1),box-shadow .18s,border-color .18s;',
    'opacity:0;animation:jbw-card-in .34s cubic-bezier(.22,1,.36,1) forwards;}',
    '@keyframes jbw-card-in{from{opacity:0;transform:translateY(10px) scale(.97);}to{opacity:1;transform:none;}}',
    '.jbw-card:hover{transform:translateY(-3px);border-color:rgba(0,0,0,.10);',
    'box-shadow:0 2px 4px rgba(0,0,0,.05),0 12px 28px rgba(0,0,0,.10);}',
    '.jbw-card:active{transform:translateY(-1px) scale(.97);}',
    '.jbw-card-ico{width:52px;height:52px;border-radius:15px;margin-bottom:8px;',
    'display:flex;align-items:center;justify-content:center;font-size:25px;}',
    '.jbw-card-img{width:100px;height:100px;border-radius:15px;object-fit:cover;',
    'margin-bottom:10px;display:block;background:#f2f2f4;}',
    '.jbw-card-no-image{justify-content:center;min-height:100px;padding:18px 12px;}',
    '.jbw-gallery-heading{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#8a8f98;margin:2px 0 8px;}',
    '.jbw-gallery{width:100%;display:grid;grid-template-columns:repeat(2,1fr);gap:8px;padding:4px 0;}',
    '.jbw-gallery-card{overflow:hidden;border:1px solid rgba(0,0,0,.07);border-radius:12px;background:#fff;}',
    '.jbw-gallery-card img{width:100%;aspect-ratio:1.35;object-fit:cover;display:block;background:#f2f2f4;}',
    '.jbw-gallery-copy{padding:8px 9px 9px;}.jbw-gallery-name{font-size:12px;font-weight:700;line-height:1.3;color:#16181d;}',
    '.jbw-gallery-meta{margin-top:3px;color:#6b6f76;font-size:11px;line-height:1.3;}',
    '.jbw-gallery-more{border:0;background:none;color:var(--jbw-color,#1a4a2e);font:inherit;font-size:13px;font-weight:700;cursor:pointer;padding:6px 0;}',
    '.jbw-card-name{font-size:13px;font-weight:650;line-height:1.3;color:#16181d;}',
    '.jbw-card-price{font-size:14.5px;font-weight:700;margin-top:4px;}',
    '.jbw-card-badge{font-size:10px;font-weight:600;margin-top:5px;padding:3px 8px;',
    'border-radius:20px;background:#fff5e0;color:#8a5a00;}',
    '.jbw-card-desc{font-size:11px;color:#6b6f76;line-height:1.4;margin-top:6px;}',
    '.jbw-card-cta{font-size:11px;font-weight:700;margin-top:8px;}',
    '.jbw-quick{display:flex;flex-wrap:wrap;gap:7px;padding:2px 0 2px 34px;}',
    '.jbw-quick-btn{font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer;',
    'background:#fff;border:1.5px solid rgba(0,0,0,.08);border-radius:20px;padding:8px 13px;',
    'color:#16181d;min-height:36px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 3px 10px rgba(0,0,0,.04);',
    'transition:transform .16s cubic-bezier(.22,1,.36,1),box-shadow .16s,border-color .16s;',
    'opacity:0;animation:jbw-card-in .3s cubic-bezier(.22,1,.36,1) forwards;}',
    '.jbw-quick-btn:hover{transform:translateY(-2px);border-color:rgba(0,0,0,.14);',
    'box-shadow:0 2px 4px rgba(0,0,0,.05),0 8px 20px rgba(0,0,0,.08);}',
    '.jbw-quick-btn:active{transform:translateY(0) scale(.98);}',
    '@media(prefers-reduced-motion:reduce){.jbw-quick-btn{animation:none;opacity:1;}}',
    '@media(prefers-reduced-motion:reduce){.jbw-card{animation:none;opacity:1;}}',
    '.jbw-date-calendar{width:100%;max-width:304px;margin-left:34px;padding:12px;border:1px solid rgba(0,0,0,.08);border-radius:15px;background:#fff;box-shadow:0 3px 14px rgba(0,0,0,.05);}',
    '.jbw-date-calendar-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}.jbw-date-calendar-title{font-size:12.5px;font-weight:750;text-transform:capitalize;color:#16181d;}',
    '.jbw-date-calendar-nav{width:27px;height:27px;border:0;border-radius:8px;background:#f2f3f5;color:#16181d;cursor:pointer;font:inherit;}.jbw-date-calendar-nav:disabled{opacity:.35;cursor:default;}',
    '.jbw-date-calendar-weekdays,.jbw-date-calendar-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center;}.jbw-date-calendar-weekdays{margin-bottom:4px;color:#8a8f98;font-size:9.5px;font-weight:700;}',
    '.jbw-date-calendar-day{min-height:32px;border:0;border-radius:8px;background:transparent;color:#a8acb3;font:inherit;font-size:11.5px;}.jbw-date-calendar-day[data-available="true"]{background:color-mix(in srgb,var(--jbw-color,#1a4a2e) 11%,white);color:var(--jbw-color,#1a4a2e);cursor:pointer;font-weight:750;}.jbw-date-calendar-day[data-available="true"]:hover{background:var(--jbw-color,#1a4a2e);color:#fff;}.jbw-date-calendar-day:disabled{cursor:default;}',

  ].join('');
  document.head.appendChild(css);

  // ── Inject HTML ──────────────────────────────────────────────────────────
  var fab = document.createElement('button');
  fab.id = 'jbw-fab';
  fab.setAttribute('aria-label', 'Abrir chat');
  fab.className = 'jbw-pulsing ' + (SIDE_CSS === 'left' ? 'jbw-left' : 'jbw-right');
  fab.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="white" aria-hidden="true">' +
    '<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>' +
    '<span id="jbw-fab-label" class="jbw-fab-text">Asistente</span>';

  var panel = document.createElement('div');
  panel.id = 'jbw-panel';
  panel.className = SIDE_CSS === 'left' ? 'jbw-left' : 'jbw-right';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Chat assistant');
  panel.innerHTML =
    '<div id="jbw-head">' +
      '<div id="jbw-av">✦</div>' +
      '<div class="jbw-hi">' +
        '<h4 id="jbw-name">Assistant</h4>' +
        '<p><span class="jbw-dot"></span> <span id="jbw-status">Online now</span></p>' +
        '<div id="jbw-version" hidden></div>' +
      '</div>' +
      '<button id="jbw-close" aria-label="Cerrar chat">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
        ' stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/>' +
        '<line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>' +
    '</div>' +
    '<div id="jbw-msgs"></div>' +
    '<div id="jbw-foot">' +
      '<input id="jbw-inp" type="text" placeholder="Type a message…" />' +
      '<button id="jbw-snd" disabled aria-label="Send">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"' +
        ' stroke-linecap="round" stroke-linejoin="round">' +
        '<line x1="22" y1="2" x2="11" y2="13"/>' +
        '<polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
      '</button>' +
    '</div>';

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  // Start FAB text cycling
  startFabTextCycle();

  var msgsEl  = document.getElementById('jbw-msgs');
  var inp     = document.getElementById('jbw-inp');
  var snd     = document.getElementById('jbw-snd');
  var nameEl  = document.getElementById('jbw-name');
  var headEl  = document.getElementById('jbw-head');
  var statusEl = document.getElementById('jbw-status');
  var versionEl = document.getElementById('jbw-version');

  fetch(API + '/api/build', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !/^(?:dpl_[a-z0-9]+|[a-f0-9]{7,64}|local)$/i.test(d.version)) return;
      versionEl.textContent = 'Versión: ' + d.version.slice(0, 11);
      versionEl.hidden = false;
    })
    .catch(function () {});

  // ── Apply color theme ────────────────────────────────────────────────────
  function greeting() {
    return CORE.greeting(cfg, featureOn('reservations'));
  }

  function renderQuickActions() {
    var acciones = CORE.accionesRapidas(cfg, featureOn('reservations'));

    var wrap = document.createElement('div');
    wrap.className = 'jbw-quick';
    acciones.forEach(function (a, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'jbw-quick-btn';
      b.textContent = a.label;
      b.style.animationDelay = (i * 60) + 'ms';
      b.addEventListener('click', function () {
        if (inp.disabled && !galleryInputLocked) return;
        wrap.remove();
        setWidgetGalleryInputLocked(false);
        send(a.msg);
      });
      wrap.appendChild(b);
    });
    msgsEl.appendChild(wrap);
    CORE.irAlFondo(msgsEl, );
  }

  function paint() {
    var c = cfg.color;
    fab.style.background    = c;
    // El halo del pulso usa el color del negocio, translúcido.
    fab.style.setProperty('--jbw-pulse', CORE.hexToRgba(c, 0.45));
    headEl.style.background = c;
    snd.style.background    = c;
    nameEl.textContent      = cfg.businessName || 'Assistant';
    inp.placeholder = cfg.language === 'en' ? 'Type a message…' : 'Escribe un mensaje…';
    snd.setAttribute('aria-label', cfg.language === 'en' ? 'Send' : 'Enviar');
    statusEl.textContent = cfg.language === 'en' ? 'Online now' : 'En línea';
    // Update already-rendered user bubbles and bot avatars
    var ubs = msgsEl.querySelectorAll('.jbw-r.jbw-u .jbw-b');
    for (var i = 0; i < ubs.length; i++) ubs[i].style.background = c;
    var avs = msgsEl.querySelectorAll('.jbw-ba');
    for (var j = 0; j < avs.length; j++) avs[j].style.background = c;
  }

  // Apply defaults immediately, then fetch real config
  paint();
  fetch(API + '/api/client-config?id=' + encodeURIComponent(clientId))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      configReady = true;
      if (!d) { configFailed = true; maybeShowInitialExperience(); return; }
      Object.assign(cfg, d);
      // Si ya eligió idioma (botón del selector, en esta sesión), se respeta
      // sin volver a detectar nada del texto del cliente. [Objetivo 1, regla 7]
      if (hasLanguageChoice()) {
        var saved = storedLanguage();
        if (saved) cfg.language = saved;
      }
      // Detección automática del idioma del navegador (Objetivo 1, regla 5):
      // solo se ejecuta cuando el negocio ofrece ambos idiomas y no hay
      // preferencia guardada en esta sesión. navigator.languages[0] es el
      // idioma más preferido del navegador; se normaliza a 'en'/'es' y se
      // usa solo si el negocio lo soporta.
      if (hasLanguageChoice() && !storedLanguage()) {
        var navLang = (navigator.languages && navigator.languages[0]) || navigator.language || '';
        var detected = /^en/i.test(navLang) ? 'en' : /^es/i.test(navLang) ? 'es' : '';
        if (detected && cfg.languages && cfg.languages.indexOf(detected) !== -1) {
          setLanguage(detected);
        }
      }
      paint();
      // Snippet antiguo sin data-position: respetamos lo guardado del cliente.
      if (!position && d.widgetPosition) {
        applyPosition(d.widgetPosition === 'bottom-left' ? 'left' : 'right');
      }
      restoreWidgetBookingFlowV2();
      // Recién ahora se sabe si corresponde selector de idioma o saludo
      // directo: si el usuario ya había pedido abrir mientras esto cargaba,
      // se decide aquí (nunca antes). [Objetivo 1 — condición de carrera]
      maybeShowInitialExperience();
    })
    .catch(function (err) {
      captureWidgetError(err, 'chatbot_loader');
      // Config caída: fallback seguro (cfg por defecto, español) — nunca deja
      // el widget bloqueado esperando algo que no va a llegar.
      configReady = true;
      configFailed = true;
      maybeShowInitialExperience();
    });

  // ── Render helpers ───────────────────────────────────────────────────────
  function addMsg(role, text) {
    var row = document.createElement('div');
    row.className = 'jbw-r ' + (role === 'user' ? 'jbw-u' : role === 'system' ? 'jbw-system' : 'jbw-bot');

    var bub = document.createElement('div');
    bub.className   = 'jbw-b';
    if (role === 'bot') {
      var av = document.createElement('div');
      av.className   = 'jbw-ba';
      av.style.background = cfg.color;
      av.textContent = '✦';
      row.appendChild(av);
      bub.classList.add('jbw-ty');
      bub.innerHTML = '<i></i><i></i><i></i>';
      setTimeout(function () {
        if (!bub.isConnected) return;
        bub.classList.remove('jbw-ty');
        bub.textContent = text;
        CORE.revelarElemento(msgsEl, row);
      }, BOT_MESSAGE_DELAY_MS);
    } else {
      bub.textContent = text;
      if (role === 'user') bub.style.background = cfg.color;
    }
    row.appendChild(bub);
    msgsEl.appendChild(row);
    CORE.revelarElemento(msgsEl, row);
    return row;
  }

  function selectWidgetBookingTime(time, label, lang) {
    if (widgetTimeQuestionMessage && widgetTimeQuestionMessage.parentNode) widgetTimeQuestionMessage.remove();
    widgetTimeQuestionMessage = null;
    // El texto visible muestra el label formateado ("2:47 AM"), no el valor
    // crudo en 24h que necesita el dispatch de abajo. [auditoría — formato hora]
    var mostrar = label || time;
    addMsg('bot', (lang === 'en' ? 'Perfect, ' : '¡Perfecto, ') + mostrar + ' ✅');
    bookingFlow.dispatch({ type: FLOW.EVENTS.SELECT_TIME, time: time });
  }

  function widgetBookingSummaryText(state, lang) {
    var en = lang === 'en';
    var text = (en ? '📋 Your reservation summary' : '📋 Resumen de tu reserva') + '\n' +
      '💆 ' + state.service + '\n📅 ' + state.date + '\n🕐 ' + (CORE.formatTime12h ? CORE.formatTime12h(state.time) : state.time) + '\n👤 ' + state.customer.name + '\n📞 ' + state.customer.phone + '\n✉️ ' + state.customer.email;
    if (state.specialRequests && state.specialRequests !== 'No') {
      text += '\n📝 ' + (en ? 'Special requests' : 'Peticiones especiales') + ': ' + state.specialRequests;
    }
    return text;
  }

  function widgetFlowServices() {
    var services = Array.isArray(cfg.services) && cfg.services.length ? cfg.services : cfg.menu;
    return Array.isArray(services) ? services : [];
  }

  function widgetFlowServiceName(service) {
    return typeof service === 'string' ? service : (service && (service.name || service.nombre || service.servicio)) || '';
  }

  function widgetFlowStaff() { return CORE.configuredStaff(cfg); }
  function widgetFlowIsRestaurant() { return CORE.templateId(cfg) === 'restaurant'; }

  function widgetFlowRequestDates(state) {
    var body = { action: 'dates', clientId: clientId, service: state.service };
    if (state.people !== null) body.people = state.people;
    if (state.barberPreference !== null) body.barberPreference = state.barberPreference;
    if (previewToken) body.previewToken = previewToken;
    return fetch(API + '/api/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (response) {
        if (!response.ok) {
          var error = new Error(response.status === 429 ? 'availability_rate_limited' : 'dates request failed');
          error.code = response.status === 429 ? 'availability_rate_limited' : 'availability_dates_failed';
          throw error;
        }
        return response.json();
      })
      .then(function (data) { if (!data || !data.ok || !Array.isArray(data.dates)) throw new Error('dates contract invalid'); return data.dates; });
  }

  function widgetFlowRequestSlots(state) {
    var body = { action: 'slots', clientId: clientId, service: state.service, date: state.date };
    if (state.people !== null) body.people = state.people;
    if (state.barberPreference !== null) body.barberPreference = state.barberPreference;
    if (previewToken) body.previewToken = previewToken;
    return fetch(API + '/api/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (response) {
        if (!response.ok) {
          var error = new Error(response.status === 429 ? 'availability_rate_limited' : 'slots request failed');
          error.code = response.status === 429 ? 'availability_rate_limited' : 'availability_slots_failed';
          throw error;
        }
        return response.json();
      })
      .then(function (data) { if (!data || !data.ok || !Array.isArray(data.slots)) throw new Error('slots contract invalid'); return data.slots; });
  }

  function widgetDateLabel(value, lang) {
    return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-ES', {
      timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long',
    }).format(new Date(value + 'T12:00:00Z'));
  }

  function selectWidgetBookingDate(value) {
    if (widgetDateConfirmation) widgetDateConfirmation.remove();
    widgetDateConfirmation = null;
    if (widgetFlowActions) widgetFlowActions.remove();
    bookingFlow.dispatch({ type: FLOW.EVENTS.SELECT_DATE, date: value });
  }

  function renderWidgetDateCalendar(wrap, lang) {
    var available = {};
    widgetDateOptions.forEach(function (date) { available[date.value] = true; });
    var months = widgetDateOptions.map(function (date) { return date.value.slice(0, 7); }).filter(function (value, index, values) { return values.indexOf(value) === index; }).sort();
    if (!months.length) return;
    if (months.indexOf(widgetDateMonth) === -1) widgetDateMonth = months[0];

    var monthIndex = months.indexOf(widgetDateMonth);
    var parts = widgetDateMonth.split('-').map(Number);
    var year = parts[0], month = parts[1] - 1;
    var calendar = document.createElement('div'); calendar.className = 'jbw-date-calendar';
    var head = document.createElement('div'); head.className = 'jbw-date-calendar-head';
    function nav(label, direction) {
      var element = document.createElement('button'); element.type = 'button'; element.className = 'jbw-date-calendar-nav'; element.textContent = label;
      element.disabled = monthIndex + direction < 0 || monthIndex + direction >= months.length;
      element.addEventListener('click', function () { widgetDateMonth = months[monthIndex + direction]; renderWidgetDateCalendar(wrap, lang); });
      return element;
    }
    head.appendChild(nav('◀', -1));
    var title = document.createElement('div'); title.className = 'jbw-date-calendar-title'; title.textContent = new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-ES', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(year, month, 1))); head.appendChild(title);
    head.appendChild(nav('▶', 1)); calendar.appendChild(head);
    var weekdays = document.createElement('div'); weekdays.className = 'jbw-date-calendar-weekdays';
    (lang === 'en' ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['L', 'M', 'X', 'J', 'V', 'S', 'D']).forEach(function (label) { var day = document.createElement('span'); day.textContent = label; weekdays.appendChild(day); });
    calendar.appendChild(weekdays);
    var grid = document.createElement('div'); grid.className = 'jbw-date-calendar-grid';
    var firstDay = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
    var days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    for (var blank = 0; blank < firstDay; blank++) grid.appendChild(document.createElement('span'));
    for (var dayNumber = 1; dayNumber <= days; dayNumber++) {
      var value = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(dayNumber).padStart(2, '0');
      var dayButton = document.createElement('button'); dayButton.type = 'button'; dayButton.className = 'jbw-date-calendar-day'; dayButton.textContent = dayNumber;
      dayButton.disabled = !available[value]; dayButton.dataset.available = available[value] ? 'true' : 'false';
      if (available[value]) dayButton.addEventListener('click', (function (dateValue) { return function () { selectWidgetBookingDate(dateValue); }; })(value));
      grid.appendChild(dayButton);
    }
    calendar.appendChild(grid); wrap.replaceChildren(calendar);
    appendWidgetBookingQuestionButton(wrap, bookingFlow.getState(), lang);
    msgsEl.appendChild(wrap); CORE.irAlFondo(msgsEl, true);
  }

  function handleWidgetBookingDateText(text, alreadyShown) {
    var lang = cfg.language === 'en' ? 'en' : 'es';
    if (!alreadyShown) addMsg('user', text);
    if (!widgetDateOptionsLoaded) {
      widgetDatePendingText = text;
      addMsg('bot', lang === 'en' ? 'Just a moment, I am checking availability for you.' : 'Un momentito, estoy revisando la disponibilidad para ti.');
      return;
    }
    var parsed = CORE.resolveBookingDate(text, lang, cfg.timezone);
    if (parsed.status !== 'unique') {
      addMsg('bot', lang === 'en' ? 'I could not quite understand the date 😅 Please choose it from the calendar.' : 'No pude entender bien la fecha 😅 Elígela en el calendario.');
      return;
    }
    var option = widgetDateOptions.find(function (date) { return date.value === parsed.date; });
    if (!option) {
      addMsg('bot', lang === 'en' ? 'That date is not available 😅 Please choose another one from the calendar.' : 'Esa fecha no está disponible 😅 Elige otra en el calendario.');
      return;
    }
    if (widgetDateConfirmation) widgetDateConfirmation.remove();
    widgetDateConfirmation = document.createElement('div'); widgetDateConfirmation.className = 'jbw-quick';
    addMsg('bot', (lang === 'en' ? 'Would you like to come on ' : '¿Te gustaría venir el ') + widgetDateLabel(option.value, lang) + '?');
    function confirmButton(label, handler) { var button = document.createElement('button'); button.type = 'button'; button.className = 'jbw-quick-btn'; button.textContent = label; button.addEventListener('click', handler); widgetDateConfirmation.appendChild(button); }
    confirmButton(lang === 'en' ? 'Yes, that date' : 'Sí, esa', function () { selectWidgetBookingDate(option.value); });
    confirmButton(lang === 'en' ? 'No, choose another' : 'No, elegir otra', function () { widgetDateConfirmation.remove(); widgetDateConfirmation = null; addMsg('bot', lang === 'en' ? 'Of course, please choose another date from the calendar.' : 'Claro, elige otra fecha en el calendario.'); });
    msgsEl.appendChild(widgetDateConfirmation); CORE.irAlFondo(msgsEl, true);
  }

  function widgetFlowConfirmBooking(state) {
    var body = { clientId: clientId, nombre: state.customer.name, telefono: state.customer.phone, email: state.customer.email,
      servicio: state.service, fecha: state.date, hora: state.time, specialRequests: state.specialRequests,
      foodPreferences: state.foodPreferences, tablePreference: state.tablePreference, barberPreference: state.barberPreference,
      language: cfg.language === 'en' ? 'en' : 'es', idempotencyKey: bookingFlowIdempotencyKey };
    if (state.people !== null) { body.personas = state.people; body.partySize = state.people; }
    if (previewToken) body.previewToken = previewToken;
    return fetch(API + '/api/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (response) { return response.json(); });
  }

  function widgetFlowRecover(result, lang) {
    var motivo = result && result.motivo;
    // Mensaje explicativo del backend si lo trae (los motivos de validarReserva
    // usan `mensaje`; el rate limit 429 usa `message`). Si no hay motivo
    // reconocido, se muestra un genérico — NUNCA se redirige el flujo a otro
    // paso en silencio. [auditoría — confirmación sin explicación]
    function explicar() {
      var raw = (result && (result.mensaje || result.message)) || '';
      if (raw) { addMsg('bot', raw); return; }
      addMsg('bot', lang === 'en'
        ? 'That time is no longer available. Please choose another one.'
        : 'Ese horario ya no está disponible. Por favor elige otro.');
    }
    if (motivo === 'duplicada') { addMsg('bot', lang === 'en' ? 'It looks like you already have a reservation with these details.' : 'Veo que ya tienes una reserva con estos datos.'); return; }
    if (motivo === 'needs_setup' || motivo === 'reservas_desactivadas') { addMsg('bot', (result && result.mensaje) || (lang === 'en' ? 'Reservations are not available right now. Please try again a little later.' : 'Las reservas no están disponibles ahora. Inténtalo de nuevo un poco más tarde.')); return; }
    if (motivo === 'servicio_invalido') { explicar(); bookingFlow.dispatch({ type: FLOW.EVENTS.EDIT_SERVICE }); return; }
    if (motivo === 'fecha_invalida' || motivo === 'dia_cerrado' || motivo === 'feriado') { explicar(); bookingFlow.dispatch({ type: FLOW.EVENTS.EDIT_DATE }); return; }
    // Fallback: sin_disponibilidad, barbero_no_disponible, poca_anticipacion,
    // fuera_de_horario, no_cabe_antes_del_cierre, max_active_reservations,
    // reagendado_limite, reagendado_desactivado, rate limit 429, etc.
    explicar();
    bookingFlow.dispatch({ type: FLOW.EVENTS.EDIT_TIME });
  }

  function renderWidgetBookingFlow(state) {
    updateWidgetBookingInputState(state.step);
    bookingQuestionActive = false;
    if (widgetFlowActions && widgetFlowActions.parentNode) widgetFlowActions.remove();
    if (widgetDateConfirmation && widgetDateConfirmation.parentNode) widgetDateConfirmation.remove();
    widgetFlowActions = null;
    widgetDateConfirmation = null;
    var lang = cfg.language === 'en' ? 'en' : 'es';
    var wrap = document.createElement('div'); wrap.className = 'jbw-quick';
    widgetFlowActions = wrap;
    function button(label, handler) {
      var element = document.createElement('button');
      element.type = 'button'; element.className = 'jbw-quick-btn'; element.textContent = label;
      element.addEventListener('click', handler); wrap.appendChild(element); return element;
    }
    if (state.step === FLOW.STEPS.SERVICE_SELECTION) {
      if (autoSelectingService) return;
      addMsg('bot', lang === 'en' ? 'Choose a service to continue with your booking:' : 'Elige un servicio para continuar con tu reserva:');
      renderWidgetServicesWithPhotos();
      return;
    } else if (state.step === FLOW.STEPS.BARBER_SELECTION) {
      addMsg('bot', lang === 'en' ? 'Choose a barber, or any available barber.' : 'Elige un barbero o cualquiera disponible.');
      button(lang === 'en' ? 'Any available barber' : 'Cualquiera', function () { wrap.remove(); bookingFlow.dispatch({ type: FLOW.EVENTS.SELECT_BARBER, barberPreference: null }); });
      widgetFlowStaff().forEach(function (staff) { var name = staff && (staff.name || staff.nombre || staff.id); if (name) button(name, function () { wrap.remove(); bookingFlow.dispatch({ type: FLOW.EVENTS.SELECT_BARBER, barberPreference: name }); }); });
      appendWidgetBookingQuestionButton(wrap, state, lang);
    } else if (state.step === FLOW.STEPS.PEOPLE_SELECTION) {
      addMsg('bot', lang === 'en' ? 'For how many people?' : '¿Para cuántas personas?');
      [1, 2, 3, 4, 5, 6].forEach(function (people) { button(String(people), function () { wrap.remove(); bookingFlow.dispatch({ type: FLOW.EVENTS.SELECT_PEOPLE, people: people }); }); });
      appendWidgetBookingQuestionButton(wrap, state, lang);
    } else if (state.step === FLOW.STEPS.DATE_SELECTION) {
      var datePromptStartedAt = Date.now();
      addMsg('bot', lang === 'en' ? 'What day would you like to come by?' : '¿Qué día te gustaría venir?');
      widgetDateOptions = [];
      widgetDateOptionsLoaded = false;
      widgetDatePendingText = '';
      bookingFlow.requestAvailableDates().then(function (dates) {
        if (!dates.length) { addMsg('bot', lang === 'en' ? 'There are no available dates right now. Please check back soon.' : 'Por ahora no hay fechas disponibles. Vuelve a revisar pronto.'); return; }
        widgetDateOptions = dates;
        widgetDateOptionsLoaded = true;
        widgetDateMonth = dates[0].value.slice(0, 7);
        setTimeout(function () {
          renderWidgetDateCalendar(wrap, lang);
          if (widgetDatePendingText) {
            var pendingText = widgetDatePendingText;
            widgetDatePendingText = '';
            handleWidgetBookingDateText(pendingText, true);
          }
        }, Math.max(0, BOT_MESSAGE_DELAY_MS - (Date.now() - datePromptStartedAt)));
      }).catch(function (error) {
        captureWidgetError(error, 'booking_v2_dates');
        addMsg('bot', error && error.code === 'availability_rate_limited'
          ? (lang === 'en' ? 'There have been too many availability checks. Please wait a moment and try again.' : 'Se hicieron demasiadas consultas de disponibilidad. Espera un momento y vuelve a intentarlo.')
          : (lang === 'en' ? 'Sorry, we could not load the dates. Please try again.' : 'Perdón, no pudimos cargar las fechas. Inténtalo de nuevo.'));
      });
      return;
    } else if (state.step === FLOW.STEPS.TIME_SELECTION) {
      var timePromptStartedAt = Date.now();
      widgetTimeQuestionMessage = addMsg('bot', lang === 'en' ? 'What time would work best for you?' : '¿Qué horario te acomodaría mejor?');
      bookingFlow.requestSlots().then(function (slots) {
        setTimeout(function () {
          var slotWrap = document.createElement('div'); slotWrap.className = 'jbw-quick';
          if (!slots.length) { addMsg('bot', lang === 'en' ? 'There are no available times for that date. Please choose another day.' : 'No hay horarios disponibles para esa fecha. Elige otro día, por favor.'); return; }
          slots.forEach(function (slot) { var element = document.createElement('button'); element.type = 'button'; element.className = 'jbw-quick-btn'; element.textContent = slot.label; element.addEventListener('click', function () { slotWrap.remove(); selectWidgetBookingTime(slot.value, slot.label, lang); }); slotWrap.appendChild(element); });
          widgetFlowActions = slotWrap;
          appendWidgetBookingQuestionButton(slotWrap, state, lang);
          msgsEl.appendChild(slotWrap); CORE.irAlFondo(msgsEl, true);
        }, Math.max(0, BOT_MESSAGE_DELAY_MS - (Date.now() - timePromptStartedAt)));
      }).catch(function (error) {
        captureWidgetError(error, 'booking_v2_slots');
        addMsg('bot', error && error.code === 'availability_rate_limited'
          ? (lang === 'en' ? 'There have been too many availability checks. Please wait a moment and try again.' : 'Se hicieron demasiadas consultas de disponibilidad. Espera un momento y vuelve a intentarlo.')
          : (lang === 'en' ? 'Sorry, we could not load the times. Please try again.' : 'Perdón, no pudimos cargar los horarios. Inténtalo de nuevo.'));
      });
      return;
    } else if (state.step === FLOW.STEPS.CUSTOMER_DATA) {
      if (widgetFlowActions && widgetFlowActions.parentNode) widgetFlowActions.remove();
      var missingField = CORE.missingCustomerField(customerDraft);
      if (missingField) {
        if (!customerIntroGiven && !customerDraft.name && !customerDraft.phone && !customerDraft.email) {
          customerIntroGiven = true;
          addMsg('bot', lang === 'en'
            ? 'Now I will ask for a few details for your booking 😊 Don\'t worry if you make a mistake, you\'ll be able to review and change them before confirming.'
            : 'Ahora te voy a pedir algunos datos para tu reserva 😊 No te preocupes si cometes un error, vas a poder corregirlos al final antes de confirmar.');
        }
        addMsg('bot', CORE.askMissingCustomerField(missingField, lang));
      } else if (!specialRequestsAsked) {
        if (customerDraft.pendingSpecialMention) {
          var pendingText = customerDraft.pendingSpecialMention;
          addMsg('bot', lang === 'en'
            ? 'Earlier you mentioned: "' + pendingText + '". Should I note that as a special request? (Reply "Yes" to save it, or anything else to skip it).'
            : 'Antes mencionaste: "' + pendingText + '". ¿Querés que lo anote como petición especial? (Decí "Sí" para guardarlo, o cualquier otra cosa para omitirlo).');
        } else {
          addMsg('bot', lang === 'en'
            ? 'Do you have any allergies, preferences, or special requests to share? (Type "None" or "No" if you have none).'
            : '¿Tienes alguna alergia, preferencia o petición especial que quieras contarme? (Escribe "Ninguna" o "No" si no tienes ninguna).');
        }
        specialRequestsAsked = true;
      }
      if (widgetFlowIsRestaurant()) {
        addMsg('bot', lang === 'en' ? 'Optional table preference:' : 'Preferencia de mesa opcional:');
        [['Terrace', 'Terraza'], ['Window', 'Ventana'], ['Inside', 'Interior'], ['No preference', 'Sin preferencia']].forEach(function (choice) {
          button(lang === 'en' ? choice[0] : choice[1], function () { wrap.remove(); bookingFlow.dispatch({ type: FLOW.EVENTS.SET_RESTAURANT_PREFERENCES, tablePreference: choice[1] === 'Sin preferencia' ? null : choice[1] }); });
        });
        msgsEl.appendChild(wrap); CORE.irAlFondo(msgsEl, true);
      }
      return;
    } else if (state.step === FLOW.STEPS.SUMMARY) {
      addMsg('bot', widgetBookingSummaryText(state, lang));
      button(lang === 'en' ? 'Continue' : 'Continuar', function () { wrap.remove(); bookingFlow.dispatch({ type: FLOW.EVENTS.REQUEST_CONFIRMATION }); });
      button(lang === 'en' ? 'Change service' : 'Cambiar servicio', function () { wrap.remove(); bookingFlow.dispatch({ type: FLOW.EVENTS.EDIT_SERVICE }); });
      button(lang === 'en' ? 'Change date' : 'Cambiar fecha', function () { wrap.remove(); bookingFlow.dispatch({ type: FLOW.EVENTS.EDIT_DATE }); });
      button(lang === 'en' ? 'Change time' : 'Cambiar hora', function () { wrap.remove(); bookingFlow.dispatch({ type: FLOW.EVENTS.EDIT_TIME }); });
      button(lang === 'en' ? 'Change details' : 'Cambiar datos', function () { wrap.remove(); bookingFlow.dispatch({ type: FLOW.EVENTS.EDIT_CUSTOMER }); });
      // Invitación a preguntar: el canal de IA de este paso vive en send()
      // (handleWidgetBookingQuestion) y nunca toca este wrap, así que los 5
      // botones de arriba siguen funcionando durante todo el intercambio.
      // [CAMBIO 3]
      addMsg('bot', lang === 'en'
        ? 'Now, do you have any questions? Ask me anything. And if you want to change anything, just tell me or use the buttons above 😊'
        : 'Ahora sí, ¿tienes alguna duda? Preguntame lo que quieras. Y si quieres cambiar algo, dímelo o usa los botones de arriba 😊');
    } else if (state.step === FLOW.STEPS.CONFIRMATION) {
      addMsg('bot', lang === 'en' ? 'Any questions before confirming? Ask me anything 😊' : '¿Tienes alguna duda antes de confirmar? Preguntame lo que quieras 😊');
      addMsg('bot', lang === 'en' ? 'Everything looks good. Ready to confirm your reservation?' : 'Todo se ve bien. ¿Listo para confirmar tu reserva?');
      var confirmButton = button(lang === 'en' ? 'Confirm' : 'Confirmar', function () {
        confirmButton.disabled = true;
        bookingFlow.confirmBooking().then(function (result) {
          if (!result || result.ok !== true) { if (result && !['duplicada', 'needs_setup', 'reservas_desactivadas'].includes(result.motivo)) wrap.remove(); widgetFlowRecover(result, lang); confirmButton.disabled = false; return; }
          var confirmed = bookingFlow.getState();
          activeReservation = { reservationId: result.reservationId || null, actionToken: result.actionToken || null, fecha: confirmed.date, hora: confirmed.time, personas: confirmed.people || '', servicio: confirmed.service, specialRequests: confirmed.specialRequests || '', estado: result.status || 'confirmada', confirmedAt: Date.now(), language: lang, emailSent: !!(result.email && result.email.customer && result.email.customer.sent === true) };
          saveReserva(); captureWidgetBookingV2Event('confirmation_success', confirmed); wrap.remove();
        }).catch(function (error) { captureWidgetError(error, 'booking_v2_confirm'); captureWidgetBookingV2Event('confirmation_failed', bookingFlow.getState(), 'network'); addMsg('bot', lang === 'en' ? 'We could not confirm your reservation. Please try again.' : 'No pudimos confirmar tu reserva. Inténtalo de nuevo.'); confirmButton.disabled = false; });
      });
    } else if (state.step === FLOW.STEPS.CONFIRMED) {
      captureWidgetBookingV2Event('completed', state);
      addMsg('bot', lang === 'en' ? 'Your reservation is confirmed! ✅' : '¡Tu reserva quedó confirmada! ✅');
      addMsg('system', lang === 'en' ? 'For last-minute changes (cancel or reschedule), use the link in your confirmation email 📧' : 'Para cambios de último momento (cancelar o reagendar), usa el enlace de tu correo de confirmación 📧');
      // BUG 1 fix: CONFIRMED es un paso terminal — sin este reset el input queda
      // deshabilitado para siempre (updateWidgetBookingInputState no incluye
      // CONFIRMED en su lista de pasos habilitados, y ninguna otra rama de este
      // switch se ejecuta después). Se difiere el reset para que el usuario
      // primero vea los dos mensajes de arriba, y para evitar reentrancia dentro
      // del dispatch() que disparó este render.
      setTimeout(function () {
        if (bookingFlow && bookingFlow.getState().step === FLOW.STEPS.CONFIRMED) {
          bookingFlow.reset();
          bookingFlow = null;
        }
      }, BOT_MESSAGE_DELAY_MS * 2 + 200);
      return;
    }
    msgsEl.appendChild(wrap); CORE.irAlFondo(msgsEl, true);
  }

  function appendWidgetBookingQuestionButton(wrap, state, lang) {
    if (![FLOW.STEPS.SERVICE_SELECTION, FLOW.STEPS.BARBER_SELECTION, FLOW.STEPS.DATE_SELECTION,
      FLOW.STEPS.PEOPLE_SELECTION, FLOW.STEPS.TIME_SELECTION].includes(state.step)) return;
    var button = document.createElement('button');
    button.type = 'button'; button.className = 'jbw-quick-btn';
    button.textContent = lang === 'en' ? 'Ask a question' : 'Hacer una pregunta';
    button.addEventListener('click', function () {
      if (busy) return;
      bookingQuestionActive = true;
      inp.disabled = false; snd.disabled = false;
      inp.placeholder = lang === 'en' ? 'Type your question…' : 'Escribe tu pregunta…';
      inp.focus();
    });
    wrap.appendChild(button);
  }

  function createWidgetBookingFlow() {
    return FLOW.createBookingFlow({
      config: { clientId: clientId, templateId: cfg.templateId || cfg.vertical, staff: widgetFlowStaff(), storageNamespace: 'jbw' }, storage: sessionStorage,
      render: { render: renderWidgetBookingFlow },
      request: { availableDates: widgetFlowRequestDates, slots: widgetFlowRequestSlots, confirmBooking: widgetFlowConfirmBooking },
      onMessage: function (state, event) {
        console.debug('[widget-booking-v2] transition', event.type, state.step);
        if (event.type === FLOW.EVENTS.START_BOOKING) captureWidgetBookingV2Event('start', state);
        if (event.type === FLOW.EVENTS.RESET_FLOW || event.type === FLOW.EVENTS.CONFIRM_BOOKING) resetCustomerDraft();
        if (event.type === FLOW.EVENTS.EDIT_CUSTOMER) { resetCustomerDraft(); renderWidgetBookingFlow(state); }
        if (event.type === FLOW.EVENTS.SELECT_TIME && !CORE.missingCustomerField(customerDraft) && specialRequestsAsked) {
          bookingFlow.dispatch({ type: FLOW.EVENTS.SHOW_SUMMARY });
        }
      },
    });
  }

  function startWidgetBookingFlowV2(lang, initialEntities) {
    if (!FLOW || typeof FLOW.createBookingFlow !== 'function' || !widgetFlowServices().length) return false;
    try {
      resetCustomerDraft();
      bookingFlowIdempotencyKey = CORE.genIdempotencyKey();
      var reqService = initialEntities && (initialEntities.service || initialEntities.servicio);
      var matched = null;
      if (reqService) {
        var reqLow = String(reqService).toLowerCase().trim();
        widgetFlowServices().forEach(function (s) {
          var name = widgetFlowServiceName(s);
          if (name && (name.toLowerCase() === reqLow || reqLow.indexOf(name.toLowerCase()) !== -1 || name.toLowerCase().indexOf(reqLow) !== -1)) matched = name;
        });
      }
      bookingFlow = createWidgetBookingFlow();
      addMsg('system', lang === 'en'
        ? 'You are now in booking mode. If you have another question unrelated to booking, use the button below and I will help you.'
        : 'Ahora estás en modo reserva. Si tienes otra duda que no tenga que ver con reservar, pulsa el botón de abajo para que te ayude.');
      if (matched) {
        autoSelectingService = true;
        bookingFlow.startBooking();
        bookingFlow.dispatch({ type: FLOW.EVENTS.SELECT_SERVICE, service: matched });
        autoSelectingService = false;
      } else {
        bookingFlow.startBooking();
      }
      return true;
    }
    catch (error) { autoSelectingService = false; captureWidgetError(error, 'booking_v2_start'); captureWidgetBookingV2Event('fallback', null, 'start_failed'); bookingFlow = null; return false; }
  }

  function restoreWidgetBookingFlowV2() {
    if (!FLOW) return false;
    try {
      bookingFlow = createWidgetBookingFlow();
      var restored = bookingFlow.init();
      if (restored.step === FLOW.STEPS.CHAT) { resetCustomerDraft(); bookingFlow = null; return false; }
      // BUG 1 fix: una reserva que ya quedó CONFIRMED en una sesión anterior no
      // debe revivirse como flujo activo al recargar — eso es lo que causaba
      // el chat congelado tras F5 y los mensajes de "reserva confirmada"
      // duplicados en el historial. bookingFlow.reset() ya limpia el borrador
      // del cliente vía el listener de RESET_FLOW en createWidgetBookingFlow,
      // pero se llama resetCustomerDraft() explícitamente también por
      // consistencia con la rama de CHAT de arriba.
      if (restored.step === FLOW.STEPS.CONFIRMED) { bookingFlow.reset(); resetCustomerDraft(); bookingFlow = null; return false; }
      syncCustomerDraftFromState(restored);
      bookingFlowIdempotencyKey = CORE.genIdempotencyKey();
      greeted = true;
      captureWidgetBookingV2Event('restore', restored);
      return true;
    }
    catch (error) { captureWidgetError(error, 'booking_v2_restore'); captureWidgetBookingV2Event('fallback', null, 'restore_failed'); bookingFlow = null; return false; }
  }

  function showTyping() {
    var row = document.createElement('div');
    row.className = 'jbw-r jbw-bot';
    row.id = 'jbw-ty';
    var av = document.createElement('div');
    av.className = 'jbw-ba';
    av.style.background = cfg.color;
    av.textContent = '✦';
    var b = document.createElement('div');
    b.className = 'jbw-ty';
    b.textContent = '···';
    row.appendChild(av);
    row.appendChild(b);
    msgsEl.appendChild(row);
    CORE.irAlFondo(msgsEl, );
  }

  function hideTyping() {
    var el = document.getElementById('jbw-ty');
    if (el) el.remove();
  }

  // Render any saved messages from this session. Historial viejo puede tener
  // marcadores crudos guardados antes de este fix: se sanea al restaurar.
  msgs.forEach(function (m) {
    var esBot = m.role !== 'user';
    addMsg(esBot ? 'bot' : 'user', esBot ? CORE.limpiarMarcadores(m.content) : m.content);
  });

  // El icono lo elige el motor; aquí solo se pinta con las clases del widget.
  function buildIcon(nombre) {
    var el = document.createElement('div');
    el.className = 'jbw-card-ico';
    el.textContent = CORE.iconFor(nombre);
    el.style.background = CORE.hexToRgba(cfg.color, 0.12);
    return el;
  }

  // ── Render menu card carousel ─────────────────────────────────────────────
  function renderMenu(serviceCardName) {
    var galleryMode = renderingServicePhotoGallery;
    var items = Array.isArray(cfg.menu) ? cfg.menu : [];
    if (serviceCardName) {
      var wantedService = String(serviceCardName).trim().toLowerCase();
      items = items.filter(function (item) {
        return String(item && item.nombre || '').trim().toLowerCase() === wantedService;
      });
    }
    if (!items.length) return;

    var wrap = document.createElement('div');
    wrap.className = 'jbw-cards-wrap';
    var row = document.createElement('div');
    row.className = 'jbw-cards';

    items.forEach(function (item, idx) {
      var card = document.createElement('button');
      card.className = 'jbw-card';
      card.type = 'button';
      card.style.animationDelay = (idx * 55) + 'ms';

      if (item.imagen) {
        var img = document.createElement('img');
        img.className = 'jbw-card-img';
        img.src = item.imagen;
        img.alt = '';
        img.loading = 'lazy';
        img.onerror = function () {
          if (img.parentNode) img.parentNode.replaceChild(buildIcon(item.nombre), img);
        };
        card.appendChild(img);
      } else {
        card.classList.add('jbw-card-no-image');
      }

      var name = document.createElement('div');
      name.className = 'jbw-card-name';
      name.textContent = item.nombre || 'Servicio';
      card.appendChild(name);

      if (item.precio || item.duracion) {
        var price = document.createElement('div');
        price.className = 'jbw-card-price';
        price.style.color = cfg.color;
        price.textContent = CORE.formatServicePriceAndDuration(item.precio, item.duracion, cfg.language);
        card.appendChild(price);
      }

      if (CORE.isPopular(item)) {
        var badge = document.createElement('div');
        badge.className = 'jbw-card-badge';
        badge.textContent = '⭐ Popular';
        card.appendChild(badge);
      }

      if (item.descripcion) {
        var desc = document.createElement('div');
        desc.className = 'jbw-card-desc';
        desc.textContent = item.descripcion;
        card.appendChild(desc);
      }

      var cta = document.createElement('div');
      cta.className = 'jbw-card-cta';
      cta.style.color = cfg.color;
      cta.textContent = CORE.bookServiceLabel(cfg.language);
      card.appendChild(cta);

      card.addEventListener('click', function () {
        if (inp.disabled && !galleryMode) return;
        if (wrap.parentNode) wrap.remove();
        if (galleryMode) setWidgetGalleryInputLocked(false);
        var userMsg = CORE.bookServiceMessage(item.nombre, cfg.language, cfg.templateId === 'restaurant');
        if (activeReservation && featureOn('reservations')) {
          addMsg('user', userMsg);
          handleWidgetDuplicateAttempt(cfg.language);
          return;
        }
        addMsg('user', userMsg);
        if (bookingFlow && bookingFlow.getState().step === FLOW.STEPS.SERVICE_SELECTION) {
          bookingFlow.dispatch({ type: FLOW.EVENTS.SELECT_SERVICE, service: item.nombre });
          return;
        }
        if (!startWidgetBookingFlowV2(cfg.language, { service: item.nombre })) {
          var lang = cfg.language === 'en' ? 'en' : 'es';
          addMsg('bot', lang === 'en'
            ? 'I cannot confirm appointments right now, but I can help with information about the business.'
            : 'No puedo confirmar citas en este momento, pero puedo ayudarte con información del negocio.');
        }
      });

      row.appendChild(card);
    });

    wrap.appendChild(row);
    if (galleryMode && (!bookingFlow || bookingFlow.getState().step !== FLOW.STEPS.SERVICE_SELECTION)) {
      var continueChat = document.createElement('button');
      continueChat.type = 'button';
      continueChat.className = 'jbw-gallery-more';
      continueChat.textContent = cfg.language === 'en' ? 'Continue chatting' : 'Seguir conversando';
      continueChat.addEventListener('click', function () { wrap.remove(); setWidgetGalleryInputLocked(false); });
      wrap.appendChild(continueChat);
    } else if (bookingFlow && bookingFlow.getState().step === FLOW.STEPS.SERVICE_SELECTION) {
      appendWidgetBookingQuestionButton(wrap, bookingFlow.getState(), cfg.language);
    }
    msgsEl.appendChild(wrap);
    // "estaAlFondo" mide contra el scrollHeight actual: justo tras crecer con
    // este bloque, el usuario que ya estaba al fondo del mensaje de texto
    // anterior deja de estarlo respecto al nuevo alto, así que el scroll
    // "inteligente" (pensado para no interrumpir a quien lee arriba) se
    // negaba a bajar — el bloque quedaba renderizado pero fuera de vista.
    // Esto es una reacción directa al propio mensaje del cliente, igual que
    // el "role === 'user'" de addMsg: siempre debe forzar. [BUG-SCROLL-GALERIA]
    CORE.irAlFondo(msgsEl, true);
  }

  // "Fotos de servicios" ya NO filtra por imagen: mostraba solo una parte del
  // catálogo (los que sí tenían foto) y ocultaba el resto, justo lo que el
  // Objetivo 2 prohíbe. Ahora es el mismo catálogo completo de renderMenu()
  // — una sola fuente, sin dos listas que puedan divergir. [Objetivo 2]
  // También es el punto de entrada para MOSTRAR_MENU (no solo para el
  // marcador "con fotos"): ambos renderizan las mismas tarjetas clickeables,
  // así que ambos deben bloquear el teclado igual. [BUG-GALERIA-MENU]
  function renderServicesWithPhotos() {
    setWidgetGalleryInputLocked(true);
    renderingServicePhotoGallery = true;
    renderMenu();
    renderingServicePhotoGallery = false;
  }

  function fullGalleryRequested(text) {
    return /(?:todos?|toda|completa).{0,30}(?:fotos?|im[aá]genes?|galer[ií]a|servicios?)|(?:fotos?|im[aá]genes?|galer[ií]a|servicios?).{0,30}(?:todos?|toda|completa)/i.test(text);
  }

  function galleryServiceFor(interpretation, text) {
    if (fullGalleryRequested(text)) return null;
    var items = Array.isArray(cfg.menu) ? cfg.menu : [];
    function match(name) {
      var wanted = String(name || '').trim().toLowerCase();
      return items.find(function (item) { return String(item && item.nombre || '').trim().toLowerCase() === wanted; }) || null;
    }
    var explicit = match(interpretation && interpretation.entities && interpretation.entities.service);
    if (explicit) return explicit;
    for (var i = msgs.length - 1; i >= 0; i--) {
      var content = String(msgs[i] && msgs[i].content || '').toLowerCase();
      var matches = items.filter(function (item) {
        return item && item.nombre && content.includes(String(item.nombre).toLowerCase());
      });
      if (matches.length === 1) return matches[0];
      if (matches.length >= 2) {
        window.__galleryAmbiguousServices = matches;
        return null;
      }
    }
    return null;
  }

  function renderGallery(service) {
    var generalImages = cfg.media && Array.isArray(cfg.media.gallery) ? cfg.media.gallery : [];
    var serviceImages = service
      ? (service.imagen ? [{ url: service.imagen, item: service }] : [])
      : (Array.isArray(cfg.menu) ? cfg.menu : []).filter(function (item) {
      return item && item.imagen && generalImages.indexOf(item.imagen) === -1;
    }).map(function (item) { return { url: item.imagen, item: item }; });
    var images = service ? serviceImages : generalImages.map(function (url) { return { url: url, item: null }; }).concat(serviceImages);
    if (!images.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'jbw-cards-wrap';
    var heading = document.createElement('div');
    heading.className = 'jbw-gallery-heading';
    heading.textContent = CORE.galleryHeading(cfg.language);
    wrap.appendChild(heading);
    var grid = document.createElement('div');
    grid.className = 'jbw-gallery';
    var shown = 4;
    function appendImages(limit) {
      images.slice(grid.children.length, limit).forEach(function (entry) {
        var card = document.createElement('div');
        card.className = 'jbw-gallery-card';
        var image = document.createElement('img');
        image.src = entry.url;
        image.alt = entry.item && entry.item.nombre ? entry.item.nombre : CORE.galleryHeading(cfg.language);
        image.loading = 'lazy';
        card.appendChild(image);
        var copy = document.createElement('div');
        copy.className = 'jbw-gallery-copy';
        var name = document.createElement('div');
        name.className = 'jbw-gallery-name';
        name.textContent = entry.item && entry.item.nombre ? entry.item.nombre : CORE.galleryHeading(cfg.language);
        copy.appendChild(name);
        var meta = entry.item ? CORE.formatServicePriceAndDuration(entry.item.precio, entry.item.duracion, cfg.language) : '';
        if (meta) { var details = document.createElement('div'); details.className = 'jbw-gallery-meta'; details.textContent = meta; copy.appendChild(details); }
        card.appendChild(copy);
        grid.appendChild(card);
      });
    }
    appendImages(shown);
    wrap.appendChild(grid);
    if (images.length > shown) {
      var more = document.createElement('button');
      more.type = 'button';
      more.className = 'jbw-gallery-more';
      more.textContent = cfg.language === 'en' ? 'See more photos' : 'Ver más fotos';
      more.addEventListener('click', function () {
        appendImages(images.length);
        more.remove();
        CORE.irAlFondo(msgsEl, true);
      });
      wrap.appendChild(more);
    }
    msgsEl.appendChild(wrap);
    // Mismo motivo que en renderMenu(): reacción directa al mensaje del
    // cliente, la galería recién agregada es la que debe quedar visible.
    // [BUG-SCROLL-GALERIA]
    CORE.irAlFondo(msgsEl, true);
  }

  // Ambigüedad de hora para MODIFICAR una reserva activa. Se mantiene aislada
  // para que la respuesta no pueda afectar un flujo de reserva nuevo.
  var modifyHoraPendiente = null;
  var modifyPendingUpdate = null;

  function preguntarModifyHoraAmbigua(amb, update, lang) {
    // modifyMode=true asegura que la respuesta ("de la tarde"/"de la
    // mañana") entre por el bloque que revisa modifyHoraPendiente primero
    // -- si esto se dispara desde el mensaje directo (MODIFY_TRIGGERS, sin
    // haber pasado por handleReservationAction), modifyMode todavía estaba
    // en false y la respuesta se perdía sin ser interpretada como AM/PM.
    modifyMode = true;
    modifyHoraPendiente = amb;
    modifyPendingUpdate = update || {};
    addMsg('bot', lang === 'en'
      ? 'Quick one 😊 do you mean ' + amb.n + ' in the afternoon or ' + amb.n + ' in the morning?'
      : 'Una cosita 😊 ¿te refieres a las ' + amb.n + ' de la tarde o a las ' + amb.n + ' de la mañana?');
  }

  function resolverModifyHoraPendiente(t, lang) {
    if (!modifyHoraPendiente) return false;
    var esPM = /tarde|noche|pm|p\.m|afternoon|evening/i.test(t);
    var esAM = /ma(ñ|n)ana|madrugada|am|a\.m|morning/i.test(t);
    if (!esPM && !esAM) {
      addMsg('bot', lang === 'en' ? 'Sorry, morning or afternoon? 😊' : 'Perdona, ¿de la mañana o de la tarde? 😊');
      return true;
    }
    var update = modifyPendingUpdate || {};
    update.hora = modifyHoraPendiente.n + modifyHoraPendiente.mm + (esPM ? ' PM' : ' AM');
    modifyHoraPendiente = null; modifyPendingUpdate = null;
    submitModify(update, lang);
    return true;
  }

  function renderAvailabilitySlots(slots, lang) {
    if (!Array.isArray(slots) || !slots.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'jbw-quick';
    slots.forEach(function (slot, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'jbw-quick-btn'; b.textContent = '⏰ ' + slot;
      b.style.animationDelay = (i * 40) + 'ms';
      b.addEventListener('click', function () { wrap.remove(); send(lang === 'en' ? 'at ' + slot : 'a las ' + slot); });
      wrap.appendChild(b);
    });
    msgsEl.appendChild(wrap); CORE.irAlFondo(msgsEl, true);
  }

  // ── Reserva activa: acciones (idénticas a asistente.html vía chat-core) ──
  function offerReservationActions(lang) {
    var T = CORE.reservaTextos(lang);
    // Mismo bug que el resumen de reserva: si esto se llama de nuevo (más
    // intentos de doble reserva) con el par anterior aún en pantalla, se
    // apilaba un segundo Modificar/Cancelar/Mantener. [BUG-RESUMEN-DUPLICADO]
    if (accionesBotones && accionesBotones.parentNode) accionesBotones.remove();
    var wrap = document.createElement('div');
    wrap.className = 'jbw-quick';
    accionesBotones = wrap;
    [{ label: T.modify, act: 'modify' }, { label: T.cancel, act: 'cancel' }, { label: T.keep, act: 'keep' }
    ].forEach(function (o, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'jbw-quick-btn'; b.textContent = o.label; b.style.animationDelay = (i * 60) + 'ms';
      b.addEventListener('click', function () {
        wrap.remove();
        if (accionesBotones === wrap) accionesBotones = null;
        addMsg('user', o.label);
        handleReservationAction(o.act, lang);
      });
      wrap.appendChild(b);
    });
    msgsEl.appendChild(wrap);
    // Reacción directa al mensaje del cliente: forzar, igual que la galería y
    // el resumen de reserva. [BUG-SCROLL-GALERIA]
    CORE.irAlFondo(msgsEl, true);
  }

  function handleReservationAction(act, lang) {
    dupPending = false;
    if (!activeReservation) return;
    var T = CORE.reservaTextos(lang);
    if (act === 'keep') { addMsg('bot', T.keepMsg); return; }
    selectChatReservation(act, lang);
  }

  function selectChatReservation(act, lang, update) {
    var T = CORE.reservaTextos(lang);
    if (!activeReservation || !activeReservation.actionToken) { addMsg('bot', T.notFound); return; }
    var continuing = false;
    busy = true; inp.disabled = true; snd.disabled = true;
    fetch(API + '/api/reservations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: clientId, action: 'list', actionToken: activeReservation.actionToken }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      var reservations = d && d.found && Array.isArray(d.reservations) ? d.reservations : [];
      if (reservations.length <= 1) {
        selectedReservationId = null;
        if (act === 'cancel') { continuing = true; submitActiveCancel(lang); }
        else if (update) { continuing = true; submitModify(update, lang); }
        else { modifyMode = true; addMsg('bot', T.askChange); }
        return;
      }
      addMsg('bot', lang === 'en' ? 'Which reservation would you like to manage?' : '¿Qué reserva quieres gestionar?');
      var wrap = document.createElement('div'); wrap.className = 'jbw-quick';
      reservations.forEach(function (reservation) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'jbw-quick-btn';
        b.textContent = [reservation.servicio, reservation.fecha, reservation.hora].filter(Boolean).join(' · ');
        b.addEventListener('click', function () {
          wrap.remove(); selectedReservationId = reservation.reservationId;
          activeReservation.reservationId = reservation.reservationId;
          activeReservation.servicio = reservation.servicio; activeReservation.fecha = reservation.fecha; activeReservation.hora = reservation.hora;
          if (act === 'cancel') { continuing = true; submitActiveCancel(lang); }
          else if (update) { continuing = true; submitModify(update, lang); }
          else { modifyMode = true; addMsg('bot', T.askChange); }
        });
        wrap.appendChild(b);
      });
      msgsEl.appendChild(wrap); CORE.irAlFondo(msgsEl, true);
    }).catch(function (err) { captureWidgetError(err, 'reservation_list'); addMsg('bot', T.netFail); })
    .finally(function () { if (!continuing) { busy = false; inp.disabled = false; snd.disabled = false; inp.focus(); } });
  }

  function submitActiveCancel(lang) {
    var T = CORE.reservaTextos(lang);
    if (!activeReservation || !activeReservation.actionToken) { addMsg('bot', T.notFound); return; }
    busy = true; inp.disabled = true; snd.disabled = true; showTyping();
    fetch(API + '/api/cancel-reservation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ clientId: clientId, actionToken: activeReservation.actionToken }, selectedReservationId ? { selectedReservationId: selectedReservationId } : {})),
    }).then(function (r) { return r.json(); }).then(function (d) {
      hideTyping();
      if (d.found || d.ok) {
        addMsg('bot', T.cancelled);
        activeReservation = null; selectedReservationId = null; dupAttempts = 0; spamUntil = 0; modifyMode = false; saveReserva();
      } else addMsg('bot', T.cancelFail);
    }).catch(function (err) { captureWidgetError(err, 'reservation_cancel'); hideTyping(); addMsg('bot', T.netFail); })
    .finally(function () { busy = false; inp.disabled = false; snd.disabled = false; inp.focus(); });
  }

  function submitModify(update, lang) {
    var T = CORE.reservaTextos(lang);
    if (!activeReservation || !activeReservation.actionToken) { addMsg('bot', T.notFound); modifyMode = false; return; }
    var body = {
      clientId: clientId, action: 'reschedule', actionToken: activeReservation.actionToken,
      fecha: update.fecha || activeReservation.fecha, hora: update.hora || activeReservation.hora,
    };
    if (selectedReservationId) body.selectedReservationId = selectedReservationId;
    if (update.partySize || update.personas) body.partySize = update.partySize || update.personas;
    if (update.specialRequests) body.specialRequests = update.specialRequests;
    if (update.foodPreferences) body.foodPreferences = update.foodPreferences;
    if (update.servicio) body.servicio = update.servicio;
    busy = true; inp.disabled = true; snd.disabled = true; showTyping();
    fetch(API + '/api/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); }).then(function (d) {
        hideTyping();
        if (d.ok && d.reservation) {
          activeReservation.fecha = d.reservation.fecha; activeReservation.hora = d.reservation.hora;
          activeReservation.personas = d.reservation.partySize || d.reservation.personas || activeReservation.personas;
          activeReservation.servicio = d.reservation.servicio || activeReservation.servicio;
          activeReservation.specialRequests = d.reservation.specialRequests || activeReservation.specialRequests;
          activeReservation.estado = d.reservation.estado || activeReservation.estado;
          activeReservation.actionToken = d.reservation.actionToken || activeReservation.actionToken;
          selectedReservationId = null;
          saveReserva();
          addMsg('bot', T.modifyDone + CORE.reservaResumen(activeReservation, lang));
        } else if (d.ok === false && d.motivo) {
          // Redacción centralizada por idioma y plantilla, igual que en la
          // reserva nueva. [auditoría — tono frío / mensajes centralizados]
          addMsg('bot', CORE.motivoDisponibilidadMensaje(d.motivo, cfg, lang, d.alternativa));
        } else addMsg('bot', T.modifyFail);
      }).catch(function (err) { captureWidgetError(err, 'reservation_update'); hideTyping(); addMsg('bot', T.netFail); })
      .finally(function () { modifyMode = false; busy = false; inp.disabled = false; snd.disabled = false; inp.focus(); });
  }

  function handleDuplicateAttempt(lang) {
    var s = CORE.duplicateAttemptState(activeReservation, dupAttempts, spamUntil, Date.now(), lang);
    dupAttempts = s.attempts; spamUntil = s.spamUntil;
    dupPending = true;
    addMsg('bot', s.text);
    offerReservationActions(lang);
  }

  // Preguntas con IA durante SUMMARY/CONFIRMATION: canal aparte que nunca
  // llama a bookingFlow.dispatch() ni a renderWidgetBookingFlow(), así que
  // nunca recrea widgetFlowActions — los botones de ese paso (editar,
  // Continuar, Confirmar) quedan intactos durante todo el intercambio.
  // [CAMBIO 3]
  function handleWidgetBookingQuestion(flowState, text, lang, fallbackMsg, finalReview, relockAfterAnswer) {
    addMsg('user', text);
    busy = true; inp.disabled = true; snd.disabled = true;
    showWidgetTyping();
    var requestMsgs = msgs.concat([{ role: 'user', content: text }]);
    var preConfirmationContext = finalReview ? {
      preConfirmationStep: true,
      summary: {
        service: flowState.service,
        date: flowState.date,
        time: flowState.time,
        people: flowState.people || 1,
        name: customerDraft.name || (flowState.customer ? flowState.customer.name : null),
        phone: customerDraft.phone || (flowState.customer ? flowState.customer.phone : null),
        email: customerDraft.email || (flowState.customer ? flowState.customer.email : null),
        specialRequests: flowState.specialRequests || ''
      }
    } : null;
    var body = {
      clientId: clientId,
      messages: requestMsgs,
      language: cfg.language,
    };
    if (previewToken) body.previewToken = previewToken;
    if (preConfirmationContext) body.preConfirmationContext = preConfirmationContext;
    fetch(API + '/api/client-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        hideWidgetTyping();
        if (d && d.text) addMsg('bot', d.text);
        if (bookingFlow) {
          // Detección de intención de editar un campo del resumen: muestra el
          // botón correspondiente (igual que EDIT_SERVICE ya hacía). Solo uno
          // a la vez — el que mejor matchee. [auditoría — cambiar por chat]
          var changeEdit = null;
          if (CORE.isChangeDateRequest(text)) changeEdit = { label: cfg.language === 'en' ? '✏️ Change date' : '✏️ Cambiar fecha', evt: FLOW.EVENTS.EDIT_DATE };
          else if (CORE.isChangeTimeRequest(text)) changeEdit = { label: cfg.language === 'en' ? '✏️ Change time' : '✏️ Cambiar hora', evt: FLOW.EVENTS.EDIT_TIME };
          else if (CORE.isChangeCustomerRequest(text)) changeEdit = { label: cfg.language === 'en' ? '✏️ Change details' : '✏️ Cambiar datos', evt: FLOW.EVENTS.EDIT_CUSTOMER };
          else if (CORE.isChangeServiceRequest(text)) changeEdit = { label: cfg.language === 'en' ? '✏️ Change service' : '✏️ Cambiar servicio', evt: FLOW.EVENTS.EDIT_SERVICE };
          if (changeEdit) {
            var changeBtnWrap = document.createElement('div');
            changeBtnWrap.className = 'jbw-quick';
            var changeBtn = document.createElement('button');
            changeBtn.type = 'button';
            changeBtn.className = 'jbw-quick-btn';
            changeBtn.textContent = changeEdit.label;
            changeBtn.addEventListener('click', function () {
              changeBtnWrap.remove();
              bookingFlow.dispatch({ type: changeEdit.evt });
            });
            changeBtnWrap.appendChild(changeBtn);
            msgsEl.appendChild(changeBtnWrap);
          }
        }
        // La respuesta se agregó después del wrap de botones (SUMMARY/
        // CONFIRMATION), que ya estaba en el DOM desde antes: se reubica al
        // final para que siga la conversación en vez de quedar arriba,
        // fuera de vista, tras cada pregunta. Se reinserta el mismo nodo
        // (no uno nuevo) para no perder los event listeners de los botones.
        // [FIX 1 — botones siguen la conversación]
        if (finalReview && widgetFlowActions) { msgsEl.appendChild(widgetFlowActions); CORE.irAlFondo(msgsEl, true); }
        // addMsg('bot', ...) solo agrega la burbuja con los puntos de
        // "escribiendo…" — el texto real (que la agranda) se escribe recién
        // BOT_MESSAGE_DELAY_MS después, dentro de su propio setTimeout. El
        // reposicionamiento de arriba corre antes de ese crecimiento, así
        // que queda corto; se repite acá, ya con la burbuja en su alto
        // final. [FIX 1 — corrección de timing]
        setTimeout(function () {
          if (finalReview && widgetFlowActions) { msgsEl.appendChild(widgetFlowActions); CORE.irAlFondo(msgsEl, true); }
        }, BOT_MESSAGE_DELAY_MS);
      })
      .catch(function () {
        hideWidgetTyping();
        addMsg('bot', fallbackMsg);
      })
      .finally(function () {
        busy = false;
        if (relockAfterAnswer) {
          bookingQuestionActive = false;
          updateWidgetBookingInputState(bookingFlow ? bookingFlow.getState().step : null);
        } else if (!galleryInputLocked) { inp.disabled = false; snd.disabled = false; inp.focus(); }
      });
  }

  // ── Send message ─────────────────────────────────────────────────────────
  function send(text) {
    if (busy || inp.disabled || !text.trim()) return;

    var t    = text.trim();
    // El idioma ya quedó fijado por el selector inicial (o por client.language
    // como fallback): nunca se vuelve a detectar del texto libre aquí. [Objetivo 1, regla 7]
    var lang = cfg.language === 'en' ? 'en' : 'es';

    // Modo modificar: el siguiente mensaje trae el cambio para la reserva activa.
    if (modifyMode) {
      addMsg('user', t);
      // Se responde primero por si el mensaje es la respuesta AM/PM a una
      // ambigüedad pendiente de un cambio anterior (no una nueva instrucción).
      if (resolverModifyHoraPendiente(t, lang)) return;
      if (/^(cancelar|cancel|salir|exit)$/i.test(t)) { modifyMode = false; modifyHoraPendiente = null; modifyPendingUpdate = null; addMsg('bot', CORE.reservaTextos(lang).noChange); return; }
      var updW = CORE.buildModifyUpdate(t, cfg, activeReservation);
      if (updW.__horaAmbigua) {
        var ambUW = updW.__horaAmbigua; delete updW.__horaAmbigua;
        preguntarModifyHoraAmbigua(ambUW, updW, lang);
        return;
      }
      if (!Object.keys(updW).length) { addMsg('bot', CORE.reservaTextos(lang).needChange); return; }
      submitModify(updW, lang);
      return;
    }

    // [MIGRACIÓN 1 — intención por IA] La detección de intención con una
    // reserva activa (cancelar/reagendar/nuevo intento de reservar) se
    // movió más abajo: ahora depende de interpretation.intent, que llega de
    // /api/client-chat, no de BOOKING_TRIGGERS/MODIFY_TRIGGERS/
    // CANCEL_TRIGGERS/pareceReserva() evaluados aquí de forma síncrona. Ver
    // el bloque único de despacho al final de esta función. [BUG-4/5 se
    // preserva: seguir sin crear una segunda reserva vive en esa misma rama]

    // Se ofrecieron los botones Modificar/Cancelar/Mantener y el cliente
    // escribió otra cosa en vez de tocar uno: antes esto caía directo al chat
    // libre, y el modelo -sin saber que hay una reserva activa esperando una
    // decisión- improvisaba su propio "resumen" y pedía un "sí" que nunca
    // crea nada real (el flujo real ya terminó, solo faltan los botones de
    // arriba). Se recuerda usar los botones en vez de dejarlo hablar solo.
    // [BUG-DUPLICADO-CHAT-LIBRE]
    if (dupPending) {
      addMsg('user', t);
      addMsg('bot', lang === 'en'
        ? 'You already have an active reservation — please choose one of the options above (✏️ Modify / ❌ Cancel / ✅ Keep) 😊'
        : 'Ya tienes una reserva activa — elige una de las opciones de arriba (✏️ Modificar / ❌ Cancelar / ✅ Mantener) 😊');
      return;
    }

    if (bookingFlow) {
      var flowState = bookingFlow.getState();
      if (bookingQuestionActive) {
        bookingQuestionActive = false;
        handleWidgetBookingQuestion(flowState, t, lang, lang === 'en'
          ? 'I could not process your question. Please use the options to continue.'
          : 'No pude procesar tu pregunta. Usa las opciones para continuar.', false, true);
        return;
      }
      // DATE_SELECTION ya no acepta texto libre (el input queda bloqueado
      // por updateWidgetBookingInputState): solo el calendario avanza este
      // paso. [CAMBIO 2]
      if (flowState.step === FLOW.STEPS.SUMMARY) {
        handleWidgetBookingQuestion(flowState, t, lang, lang === 'en'
          ? 'I could not process your question. Please try again or use the buttons above to continue.'
          : 'No pude procesar tu pregunta. Inténtalo de nuevo o usa los botones de arriba para continuar.', true, false);
        return;
      }
      if (flowState.step === FLOW.STEPS.CONFIRMATION) {
        handleWidgetBookingQuestion(flowState, t, lang, lang === 'en'
          ? 'I could not process your question. Please try again or click Confirm to complete your booking.'
          : 'No pude procesar tu pregunta. Inténtalo de nuevo o toca Confirmar para completar tu reserva.', true, false);
        return;
      }
      if (flowState.step !== FLOW.STEPS.CUSTOMER_DATA) {
        return;
      }
      addMsg('user', t);
      var missingBefore = CORE.missingCustomerField(customerDraft);
      if (!customerDraft.pendingSpecialMention && CORE.looksLikeSpecialMention(t)) {
        customerDraft.pendingSpecialMention = t.trim();
      }
      if (missingBefore) {
        if (CORE.isGeneralQuestionOrComment(t)) {
          addMsg('bot', CORE.customerDataHoldMessage(lang));
          return;
        }
        var draftBefore = JSON.stringify(customerDraft);
        var pendingMention = customerDraft.pendingSpecialMention;
        customerDraft = CORE.parseCustomerDraft(t, customerDraft);
        if (pendingMention) customerDraft.pendingSpecialMention = pendingMention;
        saveCustomerDraft();
        var missingAfter = CORE.missingCustomerField(customerDraft);
        if (missingAfter) {
          if (draftBefore !== JSON.stringify(customerDraft) || !Object.values(customerDraft).some(Boolean)) {
            addMsg('bot', CORE.askMissingCustomerField(missingAfter, lang));
            return;
          }
          classifyWidgetCustomerCorrection(t).then(function (correction) {
            if (correction) {
              customerDraft[correction.campo] = null;
              saveCustomerDraft();
              addMsg('bot', CORE.askMissingCustomerField(correction.campo, lang));
              return;
            }
            addMsg('bot', CORE.askMissingCustomerField(missingAfter, lang));
          }).catch(function () { addMsg('bot', CORE.askMissingCustomerField(missingAfter, lang)); });
          return;
        }
        // Este turno completó los 3 campos. Antes de avanzar a alergias,
        // confirmamos el nombre con el cliente: parseCustomerDraft no distingue
        // entre un nombre real y ruido pegado al mensaje, así que un "sí,
        // adelante" final no impide que el nombre que llegó en el último turno
        // sea otra cosa. [FIX 1 — confirmación de nombre]
        if (nameConfirmationWrap) nameConfirmationWrap.remove();
        nameConfirmationWrap = document.createElement('div');
        nameConfirmationWrap.className = 'jbw-quick';
        inp.disabled = true; snd.disabled = true;
        addMsg('bot', lang === 'en'
          ? 'Is your name "' + customerDraft.name + '"?'
          : '¿Tu nombre es "' + customerDraft.name + '"?');
        function confirmNameButton(label, handler) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'jbw-quick-btn';
          b.textContent = label;
          b.addEventListener('click', handler);
          nameConfirmationWrap.appendChild(b);
        }
        confirmNameButton(lang === 'en' ? '✅ Yes, correct' : '✅ Sí, correcto', function () {
          nameConfirmationWrap.remove();
          nameConfirmationWrap = null;
          if (!galleryInputLocked) { inp.disabled = false; snd.disabled = false; inp.focus(); }
          if (customerDraft.pendingSpecialMention) {
            var pendingText = customerDraft.pendingSpecialMention;
            addMsg('bot', lang === 'en'
              ? 'Earlier you mentioned: "' + pendingText + '". Should I note that as a special request? (Reply "Yes" to save it, or anything else to skip it).'
              : 'Antes mencionaste: "' + pendingText + '". ¿Querés que lo anote como petición especial? (Decí "Sí" para guardarlo, o cualquier otra cosa para omitirlo).');
          } else {
            addMsg('bot', lang === 'en'
              ? 'Do you have any allergies, preferences, or special requests to share? (Type "None" or "No" if you have none).'
              : '¿Tienes alguna alergia, preferencia o petición especial que quieras contarme? (Escribe "Ninguna" o "No" si no tienes ninguna).');
          }
          specialRequestsAsked = true;
        });
        confirmNameButton(lang === 'en' ? '❌ No, correct name' : '❌ No, corregir', function () {
          nameConfirmationWrap.remove();
          nameConfirmationWrap = null;
          customerDraft.name = null;
          saveCustomerDraft();
          if (!galleryInputLocked) { inp.disabled = false; snd.disabled = false; inp.focus(); }
          addMsg('bot', lang === 'en'
            ? 'Got it. Please type ONLY your full name in this message (nothing else, no phone, no email).'
            : 'Entendido. Por favor, escribí solo tu nombre (nada más, sin teléfono ni correo).');
        });
        msgsEl.appendChild(nameConfirmationWrap);
        CORE.irAlFondo(msgsEl, true);
        return;
      }
      if (looksLikeWidgetContactCorrectionRequest(t)) {
        classifyWidgetCustomerCorrection(t).then(function (correction) {
          if (correction) {
            customerDraft[correction.campo] = null;
            saveCustomerDraft();
            specialRequestsAsked = false;
            addMsg('bot', CORE.askMissingCustomerField(correction.campo, lang));
            return;
          }
          submitWidgetCustomerSpecialRequests(t, flowState, lang);
        }).catch(function () { submitWidgetCustomerSpecialRequests(t, flowState, lang); });
        return;
      }
      submitWidgetCustomerSpecialRequests(t, flowState, lang);
      return;
    }

    // ── [MIGRACIÓN 1 — intención por IA] Detección de intención inicial ──
    // Único punto que decide si es booking/reschedule/cancellation/otro. La
    // decisión ya no la toman BOOKING_TRIGGERS/MODIFY_TRIGGERS/
    // CANCEL_TRIGGERS/CORE.pareceReserva() evaluados aquí en el navegador:
    // viaja en interpretation.intent, calculado por el modelo en
    // /api/client-chat con salida estructurada (lib/message-interpreter.js)
    // en la MISMA llamada que ya se hacía para el chat libre — no se agrega
    // una segunda petición al modelo para el caso de pregunta general.
    //
    // Nueva reserva: el frontend inicia chat-flow.js, que solicita opciones
    // controladas y crea la reserva mediante reservations API. Las entities no
    // precargan la nueva reserva. Para una reserva activa, las entities pasan
    // por CORE.buildModifyUpdateFromEntities(); el modo "Modificar" explícito
    // conserva CORE.extractBooking() como parser local.
    //
    // Fail-closed (PASO 3): si el backend no devuelve una interpretación
    // válida, se trata como intent "unknown" — nunca se asume booking/
    // reschedule/cancellation sin confirmación estructurada del modelo.
    addMsg('user', t);
    busy = true;
    inp.disabled = true;
    snd.disabled = true;
    showTyping();

    var requestMsgs = msgs.concat([{ role: 'user', content: t }]);
    fetch(API + '/api/client-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(previewToken
        ? { clientId: clientId, messages: requestMsgs, language: cfg.language, previewToken: previewToken, reservationContext: CORE.buildReservationContext(activeReservation) }
        : { clientId: clientId, messages: requestMsgs, language: cfg.language, reservationContext: CORE.buildReservationContext(activeReservation) }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        hideTyping();
        if (d.error === 'inactive') {
          addMsg('bot', d.message || (cfg.language === 'en'
            ? 'This assistant is temporarily out of service. Please contact the business directly for help.'
            : 'Este asistente se encuentra temporalmente fuera de servicio. Comunícate directamente con el negocio para recibir ayuda.'));
          return;
        }

        var interp = (d && d.interpretation) || null;
        var intent = interp ? interp.intent : 'unknown';

        // Con una reserva ya activa: cancelar, reagendar, o un nuevo intento
        // de reservar (que no debe crear una segunda reserva). [BUG-4/5]
        if (activeReservation && featureOn('reservations')) {
          if (intent === 'cancellation') {
            dupPending = false;
            if (accionesBotones && accionesBotones.parentNode) accionesBotones.remove();
            accionesBotones = null;
            selectChatReservation('cancel', lang);
            return;
          }
          if (intent === 'reschedule') {
            // El mismo mensaje que trae la intención de reagendar ya puede
            // traer la fecha/hora nueva: no se descarta ni se vuelve a
            // preguntar lo que ya se dijo. [auditoría FASE 1]
            //
            // ETAPA 2: entities de esta MISMA interpretación (no
            // CORE.extractBooking() sobre texto libre) — ya se pidió la
            // interpretación estructurada para decidir `intent`, así que
            // reutilizarla aquí no cuesta una llamada de red adicional.
            var directUpdateW = CORE.buildModifyUpdateFromEntities(interp.entities, cfg, activeReservation, t);
            if (directUpdateW.__horaAmbigua) {
              var ambDirectW = directUpdateW.__horaAmbigua; delete directUpdateW.__horaAmbigua;
              preguntarModifyHoraAmbigua(ambDirectW, directUpdateW, lang);
              return;
            }
            if (Object.keys(directUpdateW).length) { selectChatReservation('modify', lang, directUpdateW); return; }
            handleReservationAction('modify', lang);
            return;
          }
          if (intent === 'booking') { handleDuplicateAttempt(lang); return; }
        }

        // Sin reserva activa: cancelar solo por el enlace seguro del correo
        // o el token de una reserva ya en sesión — contacto/fecha nunca
        // autorizan una cancelación.
        if (!activeReservation && featureOn('cancellation') && intent === 'cancellation') {
          addMsg('bot', lang === 'en'
            ? 'To cancel securely, please open the reservation link from your confirmation email.'
            : 'Para cancelar de forma segura, abre el enlace de reserva que está en tu correo de confirmación.');
          return;
        }

        if (!activeReservation && featureOn('reservations') && intent === 'booking') {
          // client-config comparte este estado con el backend. No iniciamos una
          // captura que /api/reservations necesariamente rechazará al final.
          if (cfg.needsSetup) {
            var unavailable = lang === 'en'
              ? 'I cannot confirm appointments right now, but I can help with information about the business.'
              : 'No puedo confirmar citas en este momento, pero puedo ayudarte con información del negocio.';
            addMsg('bot', unavailable);
            msgs.push({ role: 'user', content: t }, { role: 'assistant', content: unavailable });
            save();
            return;
          }
          var requestedService = interp && interp.entities && (interp.entities.service || interp.entities.servicio);
          if (requestedService) {
            if (startWidgetBookingFlowV2(lang, interp.entities)) return;
          } else {
            if (startWidgetBookingFlowV2(lang, null)) return;
          }
          addMsg('bot', lang === 'en'
            ? 'We could not start the booking flow. Please try again in a moment.'
            : 'No pudimos iniciar la reserva. Inténtalo de nuevo en un momento.');
          return;
        }

        // Pregunta general / show_menu / show_gallery / unknown: se usa el
        // texto de ESTA MISMA llamada — no se pide una segunda respuesta al
        // modelo solo porque no era una reserva. [PASO 5 — una sola llamada]
        msgs.push({ role: 'user', content: t });
        if (d.text) {
          var showMenu    = /\[MOSTRAR_MENU\]/.test(d.text);
          var showGallery = /\[MOSTRAR_GALERIA\]/.test(d.text);
          var showServicePhotos = /\[MOSTRAR_SERVICIOS_CON_FOTOS\]/.test(d.text);
          var serviceCardName = typeof d.serviceCardName === 'string' ? d.serviceCardName : '';
          var cleanText  = CORE.limpiarMarcadores(d.text);
          if (d.serviceFacts) {
            var facts = [];
            if (d.serviceFacts.precio) facts.push((cfg.language === 'en' ? 'Price: ' : 'Precio: ') + d.serviceFacts.precio);
            if (d.serviceFacts.duracion) facts.push((cfg.language === 'en' ? 'Duration: ' : 'Duración: ') + d.serviceFacts.duracion);
            if (facts.length) {
              var label = d.serviceFacts.nombre || (cfg.language === 'en' ? 'Service details' : 'Detalles del servicio');
              cleanText = [cleanText, label + ': ' + facts.join(' · ')].filter(Boolean).join('\n');
            }
          }
          var shownTexts = [];
          if (showMenu && !showServicePhotos) {
            // Determinista: nunca se confía en que el modelo haya sido
            // breve. Se muestra SIEMPRE esta frase, construida por código,
            // antes de las tarjetas — y se descarta la parte del texto del
            // modelo que solo repite el catálogo (2+ servicios nombrados);
            // si trae algo más útil, se conserva. [Objetivo 2]
            var intro = CORE.catalogIntro(cfg, lang);
            addMsg('bot', intro);
            shownTexts.push(intro);
            // Si el modelo devolvió la misma intro (aunque con distinta
            // puntuación/mayúsculas) no se repite una segunda vez.
            // [auditoría — intro duplicada]
            if (cleanText && !CORE.isCatalogIntroEcho(cleanText, cfg, lang) && !CORE.looksLikeCatalogRestatement(cleanText, cfg.menu)) {
              addMsg('bot', cleanText);
              shownTexts.push(cleanText);
            }
          } else if (cleanText) {
            addMsg('bot', cleanText);
            shownTexts.push(cleanText);
          }
          // Pedir fotos ya no fuerza el catálogo completo: cada marcador
          // controla solo su propio bloque. [BUG-FOTOS-GALERIA]
          // MOSTRAR_MENU y MOSTRAR_SERVICIOS_CON_FOTOS renderizan las mismas
          // tarjetas clickeables (ambos vía renderServicesWithPhotos), así
          // que ambos bloquean el teclado igual mientras se muestran.
          // [BUG-GALERIA-MENU]
          if (showServicePhotos) renderServicesWithPhotos();
          else {
            if (showMenu) renderServicesWithPhotos();
            else if (serviceCardName) renderMenu(serviceCardName);
            if (showGallery) {
              var galleryService = galleryServiceFor(interp, t);
              if (window.__galleryAmbiguousServices && window.__galleryAmbiguousServices.length >= 2) {
                var ambiguous = window.__galleryAmbiguousServices;
                window.__galleryAmbiguousServices = null;
                var names = ambiguous.map(function(s) { return '"' + s.nombre + '"'; }).join(', ');
                addMsg('bot', lang === 'en'
                  ? 'Which one would you like to see the photo of: ' + names + '?'
                  : '¿De cuál de los dos te gustaría ver la foto: ' + names + '?');
              } else {
                renderGallery(galleryService);
              }
            }
          }
          // La acción interna (mostrar menú/galería) ya se extrajo de d.text; al
          // historial va solo lo que realmente se mostró, nunca el marcador crudo.
          msgs.push({ role: 'assistant', content: shownTexts.join('\n\n') });
          if (d && Array.isArray(d.slots) && d.slots.length > 0) {
            renderAvailabilitySlots(d.slots, lang);
          }
          save();
        } else {
          addMsg('bot', cfg.language === 'en'
            ? "I did not quite catch that 😅 Could you say it again?"
            : 'No te entendí del todo 😅 ¿Me lo repites?');
        }
      })
      .catch(function (err) {
        captureWidgetError(err, 'chat');
        hideTyping();
        addMsg('bot', cfg.language === 'en'
          ? "That did not come through 😅 Would you mind trying again?"
          : 'Uy, no me llegó tu mensaje 😅 ¿Lo intentas otra vez?');
      })
      .finally(function () {
        busy = false;
        if (!galleryInputLocked && (!bookingFlow || bookingFlow.getState().step === FLOW.STEPS.CUSTOMER_DATA)) {
          inp.disabled = false;
          snd.disabled = false;
          inp.focus();
        }
      });
  }

  function classifyWidgetCustomerCorrection(text) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timeout = controller ? setTimeout(function () { controller.abort(); }, 3000) : null;
    return fetch(API + '/api/client-chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: clientId, action: 'classify_customer_correction', correctionText: text, language: cfg.language }),
      signal: controller ? controller.signal : undefined,
    }).then(function (response) {
      if (!response.ok) throw new Error('correction classification failed');
      return response.json();
    }).then(function (data) {
      var result = data && data.correction;
      return result && result.esCorreccion === true && ['name', 'phone', 'email'].includes(result.campo) ? result : null;
    }).finally(function () { if (timeout) clearTimeout(timeout); });
  }

  function looksLikeWidgetContactCorrectionRequest(text) {
    return /\b(?:perd[oó]n|corregir|correcci[oó]n|cambiar|equivoqu[eé]|dato|nombre|correo|email|tel[eé]fono|celular)\b/i.test(text);
  }

  function submitWidgetCustomerSpecialRequests(text, state, language) {
    try {
      var resolvedSpecialRequests = (function() {
        if (CORE.esSinPeticionEspecial(text)) return 'No';
        if (customerDraft.pendingSpecialMention && /^(?:sí|si|yes|yep)$/i.test(text.trim())) {
          return customerDraft.pendingSpecialMention;
        }
        return text.trim();
      })();
      bookingFlow.dispatch({
        type: FLOW.EVENTS.SET_CUSTOMER_DATA,
        customer: customerDraft,
        specialRequests: resolvedSpecialRequests,
        foodPreferences: widgetFlowIsRestaurant() ? CORE.applyFoodPreferences(state.foodPreferences, text, cfg) : null,
      });
      bookingFlow.dispatch({ type: FLOW.EVENTS.SHOW_SUMMARY });
      customerDraft.pendingSpecialMention = null;
      saveCustomerDraft();
    } catch (error) {
      addMsg('bot', error.message || (language === 'en' ? 'Please take a moment to check your details.' : 'Por favor, revisa tus datos un momento.'));
    }
  }

  // ── Toggle open / close ──────────────────────────────────────────────────
  // FAB text cycling variables
  var fabTexts = ['Asistente', '¿Te ayudo?'];
  var fabTextIndex = 0;
  var fabTextTimer = null;

  function startFabTextCycle() {
    if (fabTextTimer) clearInterval(fabTextTimer);
    var label = document.getElementById('jbw-fab-label');
    if (!label) return;
    fabTextTimer = setInterval(function () {
      if (panel.classList.contains('jbw-open')) return;
      label.classList.add('fade-out');
      setTimeout(function () {
        fabTextIndex = (fabTextIndex + 1) % fabTexts.length;
        label.textContent = fabTexts[fabTextIndex];
        label.classList.remove('fade-out');
      }, 350);
    }, 2000);
  }

  function stopFabTextCycle() {
    if (fabTextTimer) {
      clearInterval(fabTextTimer);
      fabTextTimer = null;
    }
    var label = document.getElementById('jbw-fab-label');
    if (label) {
      label.classList.remove('fade-out');
    }
  }

  // ── Toggle open / close ──────────────────────────────────────────────────
  function setOpen(next) {
    open = next;
    panel.classList.toggle('jbw-open', open);
    fab.setAttribute('aria-expanded', String(open));
    // Sin pulso mientras el chat está abierto: ya no hay nada que anunciar.
    fab.classList.toggle('jbw-pulsing', !open);
    // Start/stop text cycling based on panel state
    if (open) {
      stopFabTextCycle();
    } else {
      startFabTextCycle();
    }
  }

  document.getElementById('jbw-close').addEventListener('click', function () { setOpen(false); });

  // Muestra el saludo normal (ya con cfg.language resuelto). Separado de la
  // apertura del panel para poder mostrar antes el selector de idioma
  // cuando corresponda. [Objetivo 1]
  // [FIX 2 — sincronizar saludo y botones] renderQuickActions() se retrasa
  // hasta que termine el typing del saludo (BOT_MESSAGE_DELAY_MS): mismo
  // patrón que datePromptStartedAt/timePromptStartedAt para fechas y horarios.
  // Antes los botones aparecían al instante mientras la burbuja del saludo
  // seguía con "···", y un clic durante esos 2 s ejecutaba el flujo del
  // botón con el saludo todavía sin texto visible.
  function showGreetingNow() {
    var g = greeting();
    var greetingPromptStartedAt = Date.now();
    addMsg('bot', g);
    msgs.push({ role: 'assistant', content: g });
    save();
    setTimeout(function () {
      renderQuickActions();
    }, Math.max(0, BOT_MESSAGE_DELAY_MS - (Date.now() - greetingPromptStartedAt)));
  }

  // Selector inicial de idioma: antes del saludo, cuando el negocio declara
  // ambos idiomas y todavía no hay uno elegido en esta sesión. Elegido uno,
  // se guarda (namespace por clientId vía LANGUAGE_SESS) y nunca se vuelve a
  // preguntar ni a detectar automáticamente. [Objetivo 1]
  function showLanguageChoice() {
    var copy = CORE.languageChoiceCopy();
    addMsg('bot', copy.prompt);
    var wrap = document.createElement('div');
    wrap.className = 'jbw-quick';
    copy.options.forEach(function (o, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'jbw-quick-btn';
      b.textContent = o.label;
      b.style.animationDelay = (i * 60) + 'ms';
      b.addEventListener('click', function () {
        wrap.remove();
        addMsg('user', o.label);
        setLanguage(o.lang);
        paint();
        showGreetingNow();
      });
      wrap.appendChild(b);
    });
    msgsEl.appendChild(wrap);
    CORE.irAlFondo(msgsEl, true);
  }

  // Única puerta de entrada a "qué se muestra primero": se llama tanto al
  // abrir el widget como al terminar de cargar la config, y decide UNA sola
  // vez, en cuanto AMBAS condiciones se cumplen (el usuario pidió abrir Y ya
  // se sabe si hay selector de idioma o no). Mientras la config sigue
  // cargando, muestra el mismo indicador de "escribiendo" que ya existe
  // (nunca deja el widget congelado ni marca greeted antes de decidir), y si
  // hay historial restaurado (msgs.length) no repite saludo ni selector.
  // [Objetivo 1 — condición de carrera]
  function maybeShowInitialExperience() {
    if (greeted || initialExperienceShown) { hideTyping(); return; }
    if (!openRequested) return;
    if (!configReady) { showTyping(); return; }
    hideTyping();
    initialExperienceShown = true;
    greeted = true;
    if (hasLanguageChoice() && !storedLanguage()) showLanguageChoice();
    else {
      var saved = storedLanguage();
      if (saved) cfg.language = saved;
      showGreetingNow();
    }
  }

  fab.addEventListener('click', function () {
    setOpen(!open);

    if (open) {
      openRequested = true;
      maybeShowInitialExperience();
      snd.disabled = false;
      setTimeout(function () { inp.focus(); }, 200);
    }
  });

  // ── Input events ─────────────────────────────────────────────────────────
  snd.addEventListener('click', function () {
    var t = inp.value.trim();
    inp.value = '';
    send(t);
  });

  inp.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      var t = inp.value.trim();
      inp.value = '';
      send(t);
    }
  });

  }   // fin de iniciar()
})();
