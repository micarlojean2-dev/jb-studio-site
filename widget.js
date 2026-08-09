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
  var CORE, RESUMEN_ICONOS, CORRECCION_RE, CAMPO_MENCIONADO;
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

  // El motor compartido vive en jbstudio.app, el mismo origen del que este
  // widget ya depende para /api/client-config y /api/client-chat: no añade
  // un punto de fallo nuevo. Si no carga, no pintamos nada — mejor ausente
  // que a medias.
  if (window.JBChatCore) { arrancar(); }
  else {
    var _core = document.createElement('script');
    _core.src = API + '/chat-core.js';
    _core.onload = arrancar;
    _core.onerror = function () { /* sin motor no hay widget */ };
    document.head.appendChild(_core);
  }

  function arrancar() {
    CORE = window.JBChatCore;
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

  // ── Booking flow state ───────────────────────────────────────────────────
  var bookingStep = 0;   // 0 = idle, >0 = en modo reserva (DeepSeek conduce)
  var bookingPending = null;   // campo que DeepSeek está pidiendo ahora
  var bookingReview = false;   // el resumen final está a la vista, esperando confirmación
  var resumenBotones = null;   // botones del resumen activo, para no dejar un par duplicado
  var submitting = false;      // evita envíos duplicados de la reserva
  var bookingData = {};
  var earlyValidationKey = '';
  // Servicio recordado aunque el cliente aún no esté en modo reserva: se fija
  // al mencionarlo en chat libre, al pulsar una tarjeta o al elegirlo del
  // catálogo. Al iniciar una reserva sirve de respaldo si el mensaje que la
  // dispara no vuelve a nombrar el servicio. [Objetivo 4]
  var selectedService = '';

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
  // MODIFY_TRIGGERS/CANCEL_TRIGGERS/BOOKING_TRIGGERS (locales de este
  // archivo) se eliminaron en la MIGRACIÓN 1, ETAPA 1: sin callers tras
  // mover la detección de booking/reschedule/cancellation a
  // interpretation.intent (ver send()). En la ETAPA 2, asistente.html
  // recibió la misma migración y CORE.pareceReserva()/CORE.MODIFY_TRIGGERS
  // (chat-core.js) también se eliminaron por quedar sin ningún caller real
  // en ninguna de las dos superficies (ver informe de la ETAPA 2).
  // CORE.BOOKING_TRIGGERS SÍ se conserva: la usa extractNotasUsuario() para
  // un propósito distinto, no relacionado con la intención inicial.

  try { msgs = JSON.parse(sessionStorage.getItem(SESS) || '[]'); } catch (e) { msgs = []; }
  var BOOKING_SESS = SESS + '_booking';
  try {
    var restoredBooking = JSON.parse(sessionStorage.getItem(BOOKING_SESS) || 'null');
    if (restoredBooking && typeof restoredBooking === 'object') {
      bookingStep = restoredBooking.bookingStep || 0;
      bookingData = restoredBooking.bookingData || {};
      bookingPending = restoredBooking.bookingPending || null;
      bookingReview = !!(restoredBooking.awaitingConfirmation || restoredBooking.bookingReview);
      horaPendiente = restoredBooking.horaPendiente || null;
      selectedService = restoredBooking.selectedService || '';
    }
  } catch (e) {}
  if (msgs.length) greeted = true;

  function save() {
    try {
      sessionStorage.setItem(SESS, JSON.stringify(msgs.slice(-60)));
      if (bookingStep || selectedService) sessionStorage.setItem(BOOKING_SESS, JSON.stringify({ bookingStep: bookingStep, bookingData: bookingData, bookingPending: bookingPending, bookingReview: bookingReview, awaitingConfirmation: bookingReview, horaPendiente: horaPendiente, language: cfg.language, selectedService: selectedService }));
      else sessionStorage.removeItem(BOOKING_SESS);
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
    'flex-direction:column;gap:14px;background:#fafafa;}',
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

  ].join('');
  document.head.appendChild(css);

  // ── Inject HTML ──────────────────────────────────────────────────────────
  var fab = document.createElement('button');
  fab.id = 'jbw-fab';
  fab.setAttribute('aria-label', 'Abrir chat');
  fab.className = 'jbw-pulsing ' + (SIDE_CSS === 'left' ? 'jbw-left' : 'jbw-right');
  fab.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="white" aria-hidden="true">' +
    '<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>' +
    '<span id="jbw-fab-label">Hola 👋</span>';

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
        if (inp.disabled) return;
        wrap.remove();
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
      paint();
      // Snippet antiguo sin data-position: respetamos lo guardado del cliente.
      if (!position && d.widgetPosition) {
        applyPosition(d.widgetPosition === 'bottom-left' ? 'left' : 'right');
      }
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
    row.className = 'jbw-r ' + (role === 'user' ? 'jbw-u' : 'jbw-bot');

    var bub = document.createElement('div');
    bub.className   = 'jbw-b';
    bub.textContent = text;

    if (role === 'bot') {
      var av = document.createElement('div');
      av.className   = 'jbw-ba';
      av.style.background = cfg.color;
      av.textContent = '✦';
      row.appendChild(av);
    } else {
      bub.style.background = cfg.color;
    }
    row.appendChild(bub);
    msgsEl.appendChild(row);
    CORE.irAlFondo(msgsEl, role === 'user');   // tu propio mensaje siempre te lleva abajo
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
  function renderMenu() {
    var items = Array.isArray(cfg.menu) ? cfg.menu : [];
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
        price.textContent = [item.precio, item.duracion].filter(Boolean).join(' · ');
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
        if (inp.disabled) return;
        if (wrap.parentNode) wrap.remove();
        send(CORE.bookServiceMessage(item.nombre, cfg.language, cfg.templateId === 'restaurant'));
      });

      row.appendChild(card);
    });

    wrap.appendChild(row);
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
  function renderServicesWithPhotos() {
    renderMenu();
  }

  function renderGallery() {
    var generalImages = cfg.media && Array.isArray(cfg.media.gallery) ? cfg.media.gallery : [];
    var serviceImages = (Array.isArray(cfg.menu) ? cfg.menu : []).filter(function (item) {
      return item && item.imagen && generalImages.indexOf(item.imagen) === -1;
    }).map(function (item) { return { url: item.imagen, item: item }; });
    var images = generalImages.map(function (url) { return { url: url, item: null }; }).concat(serviceImages);
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
        image.alt = entry.item && entry.item.nombre ? entry.item.nombre : (cfg.language === 'en' ? 'Spa gallery' : 'Galería del Spa');
        image.loading = 'lazy';
        card.appendChild(image);
        var copy = document.createElement('div');
        copy.className = 'jbw-gallery-copy';
        var name = document.createElement('div');
        name.className = 'jbw-gallery-name';
        name.textContent = entry.item && entry.item.nombre ? entry.item.nombre : (cfg.language === 'en' ? 'Spa gallery' : 'Galería del Spa');
        copy.appendChild(name);
        var meta = [entry.item && entry.item.precio, entry.item && entry.item.duracion].filter(Boolean).join(' · ');
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

  // ETAPA 2 — limpieza: este bloque (FECHA_RE/HORA_RE/HORA_CTX/PERSONAS_RE/
  // NUM_PAL/EMAIL_RE2/TEL_RE/horasAbiertas()/resolverHora() locales de este
  // archivo) quedaba huérfano desde ANTES de esta migración — la detección
  // real siempre pasó por CORE.extractBooking() (chat-core.js), y ninguno de
  // estos identificadores tenía un solo caller real (confirmado por grep en
  // la auditoría ETAPA 2). La versión buena de resolverHora() (la que sí
  // consultaba businessHours) se fusionó en chat-core.js, que es la que de
  // verdad se usa — ver su definición allí.

  // El modelo emite marcadores internos ([MOSTRAR_MENU], [RESERVA_CONFIRMADA],
  // [LEAD_MINIMO]…). Antes solo se quitaba [MOSTRAR_MENU] y el resto se
  // pintaba tal cual: al confirmar una reserva el visitante veía
  // "[RESERVA_CONFIRMADA]" en pantalla. Se limpian todos por patrón, así que
  // un marcador nuevo tampoco se escapará.

  // El prompt pide texto plano, pero el modelo se escapa y manda **negritas**
  // o ### títulos de vez en cuando. Aquí se limpian: en una burbuja de chat
  // los asteriscos se ven como un error, no como énfasis.
  // Solo bajamos solos si ya estabas abajo. Si subiste a releer algo, un
  // mensaje nuevo ya no te arrastra: era imposible leer el historial mientras
  // el bot escribía.
    var horaPendiente = horaPendiente || null;

  function preguntarHoraAmbigua(amb, lang) {
    horaPendiente = amb;
    addMsg('bot', lang === 'en'
      ? 'Quick one 😊 do you mean ' + amb.n + ' in the afternoon or ' + amb.n + ' in the morning?'
      : 'Una cosita 😊 ¿te refieres a las ' + amb.n + ' de la tarde o a las ' + amb.n + ' de la mañana?');
  }

  function resolverHoraPendiente(t, lang) {
    if (!horaPendiente) return false;
    var esPM = /tarde|noche|pm|p\.m|afternoon|evening/i.test(t);
    var esAM = /ma(ñ|n)ana|madrugada|am|a\.m|morning/i.test(t);
    if (!esPM && !esAM) {
      addMsg('bot', lang === 'en' ? 'Sorry, morning or afternoon? 😊' : 'Perdona, ¿de la mañana o de la tarde? 😊');
      return true;
    }
    var hora = horaPendiente.n + horaPendiente.mm + (esPM ? ' PM' : ' AM');
    var amb = horaPendiente; horaPendiente = null;
    if (CORE.horaDentroDeHorario(hora, cfg.businessHours) === false) {
      rechazarHoraFueraDeHorario(lang);
      return true;
    }
    bookingData.hora = hora;
    addMsg('bot', (lang === 'en' ? 'Got it 😊 ' : 'Perfecto 😊 ') + '⏰ ' + bookingData.hora);
    seguirDesdeLoQueFalta(lang);
    return true;
  }

  // Ambigüedad de hora, pero para MODIFICAR una reserva activa (submitModify),
  // nunca para bookingData. Separado a propósito de horaPendiente/
  // resolverHoraPendiente: mezclarlos haría que responder "de la tarde"
  // durante un cambio de reserva pudiera escribir por error en una reserva
  // nueva sin terminar (o viceversa). [auditoría FASE 1 — reagendar]
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

   var BARE_OK = { nombre: 1, telefono: 1, email: 1, contacto: 1, specialRequests: 1 };
  var BOOKING_FIELD_LABEL_EN = {
    nombre: 'name', telefono: 'phone number', email: 'email', contacto: 'contact info',
    fecha: 'date', hora: 'time', servicio: 'service', personas: 'number of people', specialRequests: 'special requests'
  };
  function bookingFaltan() {
    return CORE.bookingRequirements(cfg, bookingData);
  }
  function bookingCaptured() {
    var out = {};
    CORE.summaryFields(cfg).concat(['contacto']).forEach(function (k) {
      if (bookingData[k]) out[k] = bookingData[k];
    });
    return out;
  }

  function rechazarHoraFueraDeHorario(lang) {
    delete bookingData.hora;
    bookingPending = 'hora';
    bookingReview = false;
    addMsg('bot', CORE.motivoDisponibilidadMensaje('fuera_de_horario', cfg, lang));
    save();
  }

  function recordFoodRequest(text, lang) {
    var food = CORE.applyFoodPreferences(bookingData.foodPreferences, text, cfg);
    if (food) {
      bookingData.foodPreferences = food;
      bookingData.specialRequests = CORE.foodPreferencesToSpecialRequests(food, lang);
    }
    if (CORE.isFoodMedical(text, cfg)) {
      addMsg('bot', lang === 'en'
        ? 'Thanks for telling us. I will note this dietary restriction for the restaurant. However, I cannot guarantee the absence of allergens or cross-contamination; the restaurant must confirm it directly.'
        : 'Gracias por avisarnos. Anotaré tu restricción alimentaria para que el restaurante la vea. Sin embargo, no puedo garantizar la ausencia de alérgenos o contaminación cruzada; el restaurante deberá confirmarlo directamente.');
    }
  }

  function validarDisponibilidadTemprana(lang) {
    if ((!bookingData.servicio && CORE.templateId(cfg) !== 'restaurant') || !bookingData.fecha || !bookingData.hora) return false;
    var key = [bookingData.servicio || '', bookingData.fecha, bookingData.hora].join('\u0000');
    if (earlyValidationKey === key) return false;
    busy = true; inp.disabled = true; snd.disabled = true;
    fetch(API + '/api/reservations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: clientId, action: 'validate', servicio: bookingData.servicio || '', fecha: bookingData.fecha, hora: bookingData.hora }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) {
          earlyValidationKey = key;
          askBookingTurn(lang);
          return;
        }
        var motivo = d && d.motivo;
        var campo = motivo === 'dia_cerrado' || motivo === 'feriado' ? 'fecha' : 'hora';
        delete bookingData[campo];
        earlyValidationKey = '';
        bookingPending = campo;
        bookingReview = false;
        addMsg('bot', CORE.motivoDisponibilidadMensaje(motivo, cfg, lang, d && d.alternativa));
        save();
      })
      .catch(function () {
        // The final creation validation remains authoritative if this UX check cannot run.
        earlyValidationKey = key;
        askBookingTurn(lang);
      })
      .finally(function () { busy = false; inp.disabled = false; snd.disabled = false; inp.focus(); });
    return true;
  }

  // Si con el bookingData ACTUAL ya se puede responder sin red (resumen
  // completo, pregunta de petición especial, confirmación de nombre corto),
  // lo hace y devuelve true. Si no, devuelve false y el llamador debe seguir
  // con la llamada a la IA. Se usa DOS veces dentro de askBookingTurn(): antes
  // de llamar a la red (evita una llamada innecesaria cuando ya se sabe la
  // respuesta local, igual que antes de la ETAPA 2) y después de aplicar las
  // entities de este turno (para el caso en que la IA acaba de completar el
  // último dato que faltaba).
  function tryLocalBookingShortcut(lang, faltan) {
    var completo = faltan.length === 0;
    bookingPending = completo ? null : faltan[0];
    // The model never speaks for a complete booking; only the POST decides it.
    if (completo) { showBookingSummary(); return true; }
    if (bookingPending === 'specialRequests') {
      addMsg('bot', CORE.specialRequestsQuestion(cfg.templateId, lang));
      save();
      return true;
    }
    // Nombre de una sola palabra ya capturado: se pregunta de forma natural
    // en vez de dejar que el modelo vuelva a pedir "tu nombre" desde cero.
    // [Objetivo 5]
    if (bookingPending === 'nombre' && bookingData.nombre && CORE.esNombreUnaPalabra(bookingData.nombre)) {
      addMsg('bot', CORE.nombreConfirmacionMensaje(bookingData.nombre, lang));
      save();
      return true;
    }
    return false;
  }

  // Cada turno de la reserva lo redacta DeepSeek con el estado estructurado.
  // El frontend sigue siendo dueño del estado y la validación; el modelo nunca
  // confirma ni inventa disponibilidad.
  //
  // ETAPA 2: esta MISMA llamada, que ya existía solo para redactar la
  // siguiente pregunta, ahora TAMBIÉN devuelve interpretation.entities — la
  // IA interpreta servicio/fecha/hora/nombre/email/teléfono/personas/notas
  // de la conversación (incluido el mensaje que se acaba de enviar, ya en
  // `msgs`), y CORE.sanitizeBookingEntities()/mergeBookingEntities() son
  // quienes deciden qué se acepta — la IA nunca escribe bookingData
  // directamente. `correctionSourceText` (opcional) es el texto crudo del
  // mensaje que disparó este turno, usado SOLO para el mecanismo de
  // corrección/respuesta-desnuda ya existente (CORE.campoCorreccion,
  // BARE_OK) — no se usa para decidir si se llama a la red.
  function askBookingTurn(lang, correctionSourceText) {
    if (validarDisponibilidadTemprana(lang)) return;
    var faltanAntes = bookingFaltan();
    if (tryLocalBookingShortcut(lang, faltanAntes)) return;
    var pendienteAntes = faltanAntes[0] || null;

    busy = true; inp.disabled = true; snd.disabled = true;
    showTyping();
    var body = { clientId: clientId, messages: msgs, language: cfg.language, booking: { captured: bookingCaptured(), faltan: faltanAntes } };
    if (previewToken) body.previewToken = previewToken;
    fetch(API + '/api/client-chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        hideTyping();
        var interp = (d && d.interpretation) || null;
        var entities = interp ? interp.entities : null;
        var t = correctionSourceText || '';

        if (entities) {
          var sanitized = CORE.sanitizeBookingEntities(entities, cfg, cfg.businessHours, cfg.language);
          var mergeResult = CORE.mergeBookingEntities(bookingData, sanitized, cfg.businessHours);
          // Cambio explícito de servicio dentro del flujo: se recuerda para
          // la próxima reserva también. [Objetivo 4]
          if (sanitized.servicio) selectedService = sanitized.servicio;

          // Preferencias que el cliente dice en su propio mensaje ("prefiero
          // una habitación silenciosa"): DOS fuentes ahora, sin duplicar —
          // el respaldo regex de siempre (extractNotasUsuario, sin tocar)
          // MÁS lo que la IA extrajo como "notes"; fusionarNotas() ya
          // deduplica si ambas capturan lo mismo.
          var notasU = CORE.extractNotasUsuario(t, cfg);
          if (notasU.length) bookingData.notes = CORE.fusionarNotas(bookingData.notes, notasU);
          if (sanitized.notes) bookingData.notes = CORE.fusionarNotas(bookingData.notes, [sanitized.notes]);
          recordFoodRequest(t, lang);

          // Antes se exigía "nada se extrajo en este mensaje" para aceptar el
          // texto libre como respuesta al dato pendiente. Si el cliente
          // repetía un dato YA capturado en la misma frase donde contestaba
          // lo que se le pedía, esa repetición SÍ se detectaba, así que la
          // respuesta real quedaba descartada. Ahora solo importa si el dato
          // pendiente EN SÍ sigue sin capturarse. [BUG-MEMORIA-REPETIDA]
          var pendienteSinCapturar = pendienteAntes && mergeResult.traidos.indexOf(pendienteAntes) === -1;
          var campoCorreccionDetectado = CORE.campoCorreccion(t);
          if (campoCorreccionDetectado && mergeResult.traidos.indexOf(campoCorreccionDetectado) === -1) {
            pedirCorreccion(campoCorreccionDetectado, lang);
            return;
          } else if (pendienteSinCapturar && CORRECCION_RE.test(t)) {
            // Sin campo mencionado, "prefiero"/"mejor" es la respuesta al campo pendiente, no una corrección vacía. [BUG-CORRECCION-PENDIENTE]
            if (BARE_OK[pendienteAntes] && !bookingData[pendienteAntes] && CORE.valorValido(pendienteAntes, t)) {
              bookingData[pendienteAntes] = pendienteAntes === 'specialRequests' && CORE.esSinPeticionEspecial(t) ? '' : t;
            }
          } else if (pendienteSinCapturar && BARE_OK[pendienteAntes] &&
                     !bookingData[pendienteAntes] && CORE.valorValido(pendienteAntes, t)) {
            bookingData[pendienteAntes] = pendienteAntes === 'specialRequests' && CORE.esSinPeticionEspecial(t) ? '' : t;
          }

          if (mergeResult.fueraDeHorario) { rechazarHoraFueraDeHorario(lang); return; }
          if (mergeResult.ambigua) { preguntarHoraAmbigua(mergeResult.ambigua, lang); return; }
        }

        save();

        // Con bookingData ya actualizado por las entities de este turno, se
        // recalcula qué falta AHORA (determinista, igual que siempre). Si
        // este mensaje acaba de completar la reserva o llevó al siguiente
        // campo a un atajo local, no hace falta usar el texto de la IA.
        var faltanAhora = bookingFaltan();
        if (tryLocalBookingShortcut(lang, faltanAhora)) return;

        // Caso normal: se usa el texto conversacional de ESTA MISMA llamada
        // — no se pide una segunda respuesta al modelo. [PASO 5 — una sola
        // llamada, ETAPA 1, extendido a este turno en la ETAPA 2]
        var raw = (d && d.text) || '';
        // Notas: el modelo también puede marcar algo con [NOTA: ...] en el
        // texto libre (respaldo anterior a "entities.notes" — se conserva
        // por si la IA lo usa en vez del campo estructurado).
        var nx = CORE.extractNotas(raw);
        if (nx.notas.length) bookingData.notes = CORE.fusionarNotas(bookingData.notes, nx.notas);
        var txt = raw ? CORE.limpiarMarcadores(nx.limpio) : '';
        if (!txt) txt = (lang === 'en' ? 'Could you share your ' : '¿Me compartes tu ') + (lang === 'en' ? (BOOKING_FIELD_LABEL_EN[faltanAhora[0]] || faltanAhora[0]) : faltanAhora[0]) + '?';
        addMsg('bot', txt);
        // Se persiste el texto ya saneado (lo mismo que se mostró): así ni el
        // cliente ni DeepSeek vuelven a ver marcadores al recargar el historial.
        msgs.push({ role: 'assistant', content: txt });
        save();
      })
      .catch(function (err) {
        captureWidgetError(err, 'chat');
        hideTyping();
        addMsg('bot', lang === 'en' ? "Sorry, that didn't go through 😅 Mind trying again?" : 'Uy, no me llegó tu mensaje 😅 ¿Lo intentas otra vez?');
      })
      .finally(function () { busy = false; inp.disabled = false; snd.disabled = false; inp.focus(); });
  }

  function seguirDesdeLoQueFalta(lang) { askBookingTurn(lang); }


  function pedirCorreccion(campo, lang) {
    if (resumenBotones && resumenBotones.parentNode) resumenBotones.remove();
    resumenBotones = null;
    delete bookingData[campo];
    bookingStep = 1;
    bookingPending = campo;
    bookingReview = false;
    var etiqueta = CORE.summaryLabel(cfg, campo, lang).toLowerCase();
    addMsg('bot', lang === 'en'
      ? 'Sure 😊 What is the correct ' + etiqueta + '?'
      : 'Claro 😊 ¿cuál es el dato correcto de ' + etiqueta + '?');
    save();
  }

  // Revisar antes de guardar: un dedazo en el teléfono o la fecha se corrige
  // aquí, no cuando el dueño intenta llamar y el número no existe.
  function showBookingSummary() {
    var lang = cfg.language === 'en' ? 'en' : 'es';
    // Si el mensaje del cliente no fue ni una confirmación clara ni una
    // corrección reconocida (ej. "todo está correcto" antes de ampliar
    // CONFIRMACIONES), el flujo caía aquí de nuevo con el resumen ya visible
    // y su par de botones aún en pantalla: se agregaba un SEGUNDO resumen con
    // un SEGUNDO par de botones, sin quitar el primero. Se quita el anterior
    // antes de mostrar uno nuevo para que solo exista un botón real a la vez.
    // [BUG-RESUMEN-DUPLICADO]
    if (resumenBotones && resumenBotones.parentNode) resumenBotones.remove();

    var lineas = CORE.summaryFields(cfg).concat(['contacto'])
      .filter(function (k) { return bookingData[k]; })
      .map(function (k) { return RESUMEN_ICONOS[k] + ' ' + CORE.summaryLabel(cfg, k, lang) + ': ' + bookingData[k]; });

    var quien = bookingData.nombre ? ' ' + String(bookingData.nombre).split(/\s+/)[0] : '';
    addMsg('bot', (lang === 'en'
        ? 'Perfect' + quien + ' 😊 let\'s check everything before confirming:\n\n'
        : 'Perfecto' + quien + ' 😊 revisemos que todo esté correcto antes de confirmar:\n\n') +
      lineas.join('\n') + (lang === 'en' ? '\n\nAll good? 😄' : '\n\n¿Todo correcto? 😄'));

    var wrap = document.createElement('div');
    wrap.className = 'jbw-quick';
    resumenBotones = wrap;
    [{ label: lang === 'en' ? '✅ Yes, confirm it' : '✅ Sí, confirmar cita', ok: true },
     { label: lang === 'en' ? '✏️ I want to change something' : '✏️ Quiero cambiar algo', ok: false }
    ].forEach(function (a, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'jbw-quick-btn';
      b.textContent = a.label;
      b.style.animationDelay = (i * 60) + 'ms';
      b.addEventListener('click', function () {
        wrap.remove();
        if (resumenBotones === wrap) resumenBotones = null;
        addMsg('user', a.label);
        if (a.ok) { submitBooking(); return; }
        bookingStep = 1;
        bookingPending = null;
        bookingReview = false;
        addMsg('bot', lang === 'en' ? 'What would you like to change? Your other reservation details will stay the same.' : '¿Qué quieres cambiar? Tus demás datos de reserva se conservarán.');
      });
      wrap.appendChild(b);
    });
    msgsEl.appendChild(wrap);
    // Mismo bug que la galería: el resumen (potencialmente varias líneas) ya
    // hizo crecer el contenedor antes de que estos botones se agreguen, así
    // que el scroll "inteligente" podía negarse a bajar y dejar el botón
    // real de confirmación fuera de vista. Reacción directa al mensaje del
    // cliente: siempre debe forzar. [BUG-SCROLL-GALERIA]
    CORE.irAlFondo(msgsEl, true);
    bookingReview = true;   // solo el botón "✅ Sí, confirmar cita" crea la reserva
    save();
  }

  function submitBooking() {
    if (submitting) return;        // evita envíos duplicados
    submitting = true;
    bookingReview = false;
    var lang = cfg.language === 'en' ? 'en' : 'es';
    if (!bookingData.idempotencyKey) bookingData.idempotencyKey = CORE.genIdempotencyKey();
    busy = true; inp.disabled = true; snd.disabled = true;
    addMsg('bot', lang === 'en' ? 'Checking availability…' : 'Revisando disponibilidad…');
    fetch(API + '/api/reservations', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(Object.assign({ clientId: clientId }, bookingData, { language: lang })),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok === false && d.motivo) {
          // Redacción centralizada por idioma y plantilla — el backend sigue
          // siendo la única autoridad sobre motivo/alternativa, esto solo
          // decide cómo se dice. [auditoría — tono frío / mensajes centralizados]
          var msg = CORE.motivoDisponibilidadMensaje(d.motivo, cfg, lang, d.alternativa);
          addMsg('bot', msg);
          msgs = msgs.filter(function (m) { return m.role !== 'assistant' || !/pendiente|confirmad[ao]|equipo.*revis/i.test(m.content); });
          save();
          delete bookingData.hora;
          bookingStep = 1;
          return;
        }
        if (d && d.ok) {   // éxito: creada nueva o reconocida idempotente (duplicate)
          activeReservation = {
            reservationId: d.reservationId || (activeReservation && activeReservation.reservationId) || null,
            actionToken: d.actionToken || (activeReservation && activeReservation.actionToken) || null,
            fecha: bookingData.fecha, hora: bookingData.hora,
            personas: bookingData.partySize || bookingData.personas || '',
            servicio: bookingData.servicio || '', specialRequests: bookingData.specialRequests || '',
            estado: d.status || 'confirmada', confirmedAt: Date.now(), language: lang,
          };
          saveReserva();
          addMsg('bot', d.duplicate ? CORE.reservaTextos(lang).duplicateActive : CORE.mensajeReservaGuardada(cfg, d, lang));
          if (d.duplicate) offerReservationActions(lang);
          // Reserva terminada con éxito: se olvida el servicio recordado, la
          // próxima reserva empieza limpia. [Objetivo 4]
          bookingStep = 0; bookingData = {}; bookingPending = null; dupAttempts = 0; selectedService = '';
          save();   // limpia BOOKING_SESS: sin esto una recarga reanudaría una reserva fantasma
          return;
        }
        addMsg('bot', lang === 'en'
          ? "We couldn't save your request 😕 Your details are still here — want to try again?"
          : 'No pudimos guardar tu solicitud 😕 Tus datos siguen aquí, ¿lo intentamos de nuevo?');
        showBookingSummary();
      })
      .catch(function (err) {
        captureWidgetError(err, 'reservation_create');
        addMsg('bot', lang === 'en'
          ? "Sorry, that didn't go through 😅 Your details are still here — try again?"
          : 'Uy, no se envió 😅 Tus datos siguen aquí, ¿lo intentamos otra vez?');
        showBookingSummary();
      })
      .finally(function () {
        submitting = false;
        busy = false; inp.disabled = false; snd.disabled = false; inp.focus();
      });
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

  // ── Send message ─────────────────────────────────────────────────────────
  function send(text) {
    if (busy || !text.trim()) return;

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

    // ── Active booking flow: collect next field ──────────────────────────
    if (bookingStep > 0) {
      if (/^(cancelar|cancel|salir|exit)$/i.test(t)) {
        bookingStep = 0;
        bookingData = {};
        bookingReview = false;
        selectedService = '';   // cancelar el flujo olvida el servicio recordado [Objetivo 4]
        if (resumenBotones && resumenBotones.parentNode) resumenBotones.remove();
        resumenBotones = null;
        addMsg('user', t);
        addMsg('bot', lang === 'en'
          ? 'Reservation cancelled. Is there anything else I can help with?'
          : 'Reserva cancelada. ¿Hay algo más en lo que pueda ayudarte?');
        return;
      }
      // La reserva SOLO se crea con el botón "✅ Sí, confirmar cita": un "sí"
      // escrito nunca debe confirmarla por su cuenta (puede ser una respuesta
      // apresurada sin haber revisado bien el resumen). Se pide que use el
      // botón en vez de dar la reserva por hecha. [BUG-CONFIRMACION-TEXTO]
      if (bookingReview || (function () { try { return JSON.parse(sessionStorage.getItem(BOOKING_SESS) || '{}').awaitingConfirmation === true; } catch (e) { return false; } })()) {
        addMsg('user', t);
        if (CORE.esConfirmacion(t, lang)) submitBooking();
        else if (CORE.campoCorreccion(t)) pedirCorreccion(CORE.campoCorreccion(t), lang);
        else showBookingSummary();
        return;
      }
      bookingReview = false;
      addMsg('user', t);
      msgs.push({ role: 'user', content: t });

      // Nombre de una sola palabra en espera de confirmación: caso local,
      // deterministo y acotado — se mantiene con CORE.extractBooking() a
      // propósito (excepción explícita de la ETAPA 2, ver informe) en vez de
      // esperar una llamada a la IA solo para decidir si el siguiente
      // mensaje es un apellido o un dato distinto ya reconocible por marcador
      // literal. CORE.confirmarNombreUnaPalabra() (compartida con
      // asistente.html) evita anexar como apellido un correo/teléfono/fecha/
      // hora/servicio/negación ya reconocido en este mismo mensaje.
      // [auditoría — nombre corrupto]
      if (bookingPending === 'nombre' && bookingData.nombre && !bookingData.__nombreConfirmado) {
        var extraCampos = CORE.extractBooking(t, cfg.menu, cfg.businessHours, cfg.language, cfg);
        bookingData = CORE.confirmarNombreUnaPalabra(bookingData, t, extraCampos, lang);
        save();
        askBookingTurn(lang);
        return;
      }

      if (resolverHoraPendiente(t, lang)) return;

      // ETAPA 2: la extracción de servicio/fecha/hora/nombre/email/teléfono/
      // personas/notas de ESTE mensaje ya NO la hace CORE.extractBooking()
      // (regex) — la hace la IA en la misma llamada que askBookingTurn() ya
      // hacía para redactar la siguiente pregunta (ver askBookingTurn más
      // abajo, que ahora también sanea y aplica interpretation.entities).
      // Aquí solo queda lo 100% local/determinista: cancelar, resumen,
      // confirmación de nombre corto y la respuesta a una hora ambigua.
      save();
      askBookingTurn(lang, t);
      return;
    }

    // ── [MIGRACIÓN 1 — intención por IA] Detección de intención inicial ──
    // Único punto que decide, para un mensaje nuevo (bookingStep === 0, sin
    // reserva ya en curso), si es booking/reschedule/cancellation/otro. La
    // decisión ya no la toman BOOKING_TRIGGERS/MODIFY_TRIGGERS/
    // CANCEL_TRIGGERS/CORE.pareceReserva() evaluados aquí en el navegador:
    // viaja en interpretation.intent, calculado por el modelo en
    // /api/client-chat con salida estructurada (lib/message-interpreter.js)
    // en la MISMA llamada que ya se hacía para el chat libre — no se agrega
    // una segunda petición al modelo para el caso de pregunta general.
    //
    // ETAPA 2: interpretation.entities (misma llamada) reemplaza a
    // CORE.extractBooking() como fuente de servicio/fecha/hora/nombre/email/
    // teléfono/personas/notas — CORE.sanitizeBookingEntities() es quien
    // decide qué se acepta antes de tocar bookingData (ver más abajo).
    // CORE.extractBooking() sigue existiendo solo para 2 casos locales
    // acotados (nombre de una sola palabra, modo "Modificar" explícito) —
    // ver informe de la ETAPA 2 para la justificación de cada uno.
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
        ? { clientId: clientId, messages: requestMsgs, language: cfg.language, previewToken: previewToken }
        : { clientId: clientId, messages: requestMsgs, language: cfg.language }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        hideTyping();
        if (d.error === 'inactive') {
          addMsg('bot', d.message || (cfg.language === 'en'
            ? 'This assistant is temporarily out of service. Please contact the business directly.'
            : 'Este asistente se encuentra temporalmente fuera de servicio. Comunícate directamente con el negocio.'));
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
            ? 'To cancel securely, open the reservation link from your confirmation email.'
            : 'Para cancelar de forma segura, abre el enlace de reserva de tu correo de confirmación.');
          return;
        }

        // Se recuerda el servicio aunque este mensaje NO inicie una reserva
        // (chat libre, tarjeta, catálogo): así "quiero reservar" más
        // adelante no vuelve a preguntar un servicio ya mencionado.
        // [Objetivo 4]
        //
        // ETAPA 2: preExtraido ya no viene de CORE.extractBooking() (regex)
        // — viene de interpretation.entities, la MISMA interpretación de la
        // IA que ya se pidió en esta llamada para decidir `intent` (una sola
        // llamada, sin red adicional). CORE.sanitizeBookingEntities() es
        // quien decide qué se acepta.
        var preExtraido = featureOn('reservations') && interp
          ? CORE.sanitizeBookingEntities(interp.entities, cfg, cfg.businessHours, cfg.language)
          : {};
        if (preExtraido.servicio) selectedService = preExtraido.servicio;

        if (!activeReservation && featureOn('reservations') && intent === 'booking') {
          msgs.push({ role: 'user', content: t });
          save();
          bookingStep = 1;          // en modo reserva; el modelo conduce
          bookingData = {};

          var mergeInicial = CORE.mergeBookingEntities(bookingData, preExtraido, cfg.businessHours);
          // bookingData.servicio || selectedService: si este mensaje no vuelve a
          // nombrar el servicio, se usa el que ya se había elegido antes. [Objetivo 4]
          bookingData.servicio = CORE.resolveServicio(bookingData, selectedService);

          var notasIni = CORE.extractNotasUsuario(t, cfg);
          if (notasIni.length) bookingData.notes = CORE.fusionarNotas(bookingData.notes, notasIni);
          if (preExtraido.notes) bookingData.notes = CORE.fusionarNotas(bookingData.notes, [preExtraido.notes]);
          recordFoodRequest(t, lang);

          if (mergeInicial.fueraDeHorario) { rechazarHoraFueraDeHorario(lang); return; }
          if (mergeInicial.ambigua) { preguntarHoraAmbigua(mergeInicial.ambigua, lang); return; }
          save();
          askBookingTurn(lang);
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
          var cleanText  = CORE.limpiarMarcadores(d.text);
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
          if (showServicePhotos) renderServicesWithPhotos();
          else { if (showMenu) renderMenu(); if (showGallery) renderGallery(); }
          // La acción interna (mostrar menú/galería) ya se extrajo de d.text; al
          // historial va solo lo que realmente se mostró, nunca el marcador crudo.
          msgs.push({ role: 'assistant', content: shownTexts.join('\n\n') });
          save();
        } else {
          addMsg('bot', cfg.language === 'en'
            ? "Sorry, I didn't catch that 😅 Could you say it again?"
            : 'Perdona, no te entendí bien 😅 ¿Me lo repites?');
        }
      })
      .catch(function (err) {
        captureWidgetError(err, 'chat');
        hideTyping();
        addMsg('bot', cfg.language === 'en'
          ? "Sorry, that didn't go through 😅 Mind trying again?"
          : 'Uy, no me llegó tu mensaje 😅 ¿Lo intentas otra vez?');
      })
      .finally(function () {
        busy = false;
        inp.disabled = false;
        snd.disabled = false;
        inp.focus();
      });
  }

  // ── Toggle open / close ──────────────────────────────────────────────────
  function setOpen(next) {
    open = next;
    panel.classList.toggle('jbw-open', open);
    fab.setAttribute('aria-expanded', String(open));
    // Sin pulso mientras el chat está abierto: ya no hay nada que anunciar.
    fab.classList.toggle('jbw-pulsing', !open);
  }

  document.getElementById('jbw-close').addEventListener('click', function () { setOpen(false); });

  // Muestra el saludo normal (ya con cfg.language resuelto). Separado de la
  // apertura del panel para poder mostrar antes el selector de idioma
  // cuando corresponda. [Objetivo 1]
  function showGreetingNow() {
    var g = greeting();
    addMsg('bot', g);
    msgs.push({ role: 'assistant', content: g });
    save();
    renderQuickActions();
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
