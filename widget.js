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
      .then(function (response) { if (!response.ok) throw new Error('dates request failed'); return response.json(); })
      .then(function (data) { if (!data || !data.ok || !Array.isArray(data.dates)) throw new Error('dates contract invalid'); return data.dates; });
  }

  function widgetFlowRequestSlots(state) {
    var body = { action: 'slots', clientId: clientId, service: state.service, date: state.date };
    if (state.people !== null) body.people = state.people;
    if (state.barberPreference !== null) body.barberPreference = state.barberPreference;
    if (previewToken) body.previewToken = previewToken;
    return fetch(API + '/api/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (response) { if (!response.ok) throw new Error('slots request failed'); return response.json(); })
      .then(function (data) { if (!data || !data.ok || !Array.isArray(data.slots)) throw new Error('slots contract invalid'); return data.slots; });
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
    if (motivo === 'duplicada') { addMsg('bot', lang === 'en' ? 'You already have a reservation with these details.' : 'Ya existe una reserva con estos datos.'); return; }
    if (motivo === 'needs_setup' || motivo === 'reservas_desactivadas') { addMsg('bot', (result && result.mensaje) || (lang === 'en' ? 'Reservations are unavailable right now.' : 'Las reservas no están disponibles ahora.')); return; }
    if (motivo === 'servicio_invalido') { bookingFlow.dispatch({ type: FLOW.EVENTS.EDIT_SERVICE }); return; }
    if (motivo === 'fecha_invalida' || motivo === 'dia_cerrado' || motivo === 'feriado') { bookingFlow.dispatch({ type: FLOW.EVENTS.EDIT_DATE }); return; }
    bookingFlow.dispatch({ type: FLOW.EVENTS.EDIT_TIME });
  }

  function renderWidgetBookingFlow(state) {
    var lang = cfg.language === 'en' ? 'en' : 'es';
    var wrap = document.createElement('div'); wrap.className = 'jbw-quick';
    function button(label, handler) {
      var element = document.createElement('button');
      element.type = 'button'; element.className = 'jbw-quick-btn'; element.textContent = label;
      element.addEventListener('click', handler); wrap.appendChild(element); return element;
    }
    if (state.step === FLOW.STEPS.SERVICE_SELECTION) {
      addMsg('bot', lang === 'en' ? 'Choose a service.' : 'Elige un servicio.');
      widgetFlowServices().forEach(function (service) { var name = widgetFlowServiceName(service); if (name) button(name, function () { wrap.remove(); bookingFlow.dispatch({ type: FLOW.EVENTS.SELECT_SERVICE, service: name }); }); });
    } else if (state.step === FLOW.STEPS.BARBER_SELECTION) {
      addMsg('bot', lang === 'en' ? 'Choose a barber, or any available barber.' : 'Elige un barbero o cualquiera disponible.');
      button(lang === 'en' ? 'Any available barber' : 'Cualquiera', function () { wrap.remove(); bookingFlow.dispatch({ type: FLOW.EVENTS.SELECT_BARBER, barberPreference: null }); });
      widgetFlowStaff().forEach(function (staff) { var name = staff && (staff.name || staff.nombre || staff.id); if (name) button(name, function () { wrap.remove(); bookingFlow.dispatch({ type: FLOW.EVENTS.SELECT_BARBER, barberPreference: name }); }); });
    } else if (state.step === FLOW.STEPS.PEOPLE_SELECTION) {
      addMsg('bot', lang === 'en' ? 'For how many people?' : '¿Para cuántas personas?');
      [1, 2, 3, 4, 5, 6].forEach(function (people) { button(String(people), function () { wrap.remove(); bookingFlow.dispatch({ type: FLOW.EVENTS.SELECT_PEOPLE, people: people }); }); });
    } else if (state.step === FLOW.STEPS.DATE_SELECTION) {
      addMsg('bot', lang === 'en' ? 'Loading available dates...' : 'Buscando fechas disponibles...');
      bookingFlow.requestAvailableDates().then(function (dates) {
        if (!dates.length) { addMsg('bot', lang === 'en' ? 'There are no available dates right now.' : 'No hay fechas disponibles en este momento.'); return; }
        dates.forEach(function (date) { button(date.label, function () { wrap.remove(); bookingFlow.dispatch({ type: FLOW.EVENTS.SELECT_DATE, date: date.value }); }); });
        msgsEl.appendChild(wrap); CORE.irAlFondo(msgsEl, true);
      }).catch(function (error) { captureWidgetError(error, 'booking_v2_dates'); addMsg('bot', lang === 'en' ? 'We could not load dates. Please try again.' : 'No pudimos cargar fechas. Inténtalo de nuevo.'); });
      return;
    } else if (state.step === FLOW.STEPS.TIME_SELECTION) {
      addMsg('bot', lang === 'en' ? 'Loading available times...' : 'Buscando horarios disponibles...');
      bookingFlow.requestSlots().then(function (slots) {
        var slotWrap = document.createElement('div'); slotWrap.className = 'jbw-quick';
        if (!slots.length) { addMsg('bot', lang === 'en' ? 'There are no available times for that date.' : 'No hay horarios disponibles para esa fecha.'); return; }
        slots.forEach(function (slot) { var element = document.createElement('button'); element.type = 'button'; element.className = 'jbw-quick-btn'; element.textContent = slot.label; element.addEventListener('click', function () { slotWrap.remove(); bookingFlow.dispatch({ type: FLOW.EVENTS.SELECT_TIME, time: slot.value }); }); slotWrap.appendChild(element); });
        msgsEl.appendChild(slotWrap); CORE.irAlFondo(msgsEl, true);
      }).catch(function (error) { captureWidgetError(error, 'booking_v2_slots'); addMsg('bot', lang === 'en' ? 'We could not load times. Please try again.' : 'No pudimos cargar horarios. Inténtalo de nuevo.'); });
      return;
    } else if (state.step === FLOW.STEPS.CUSTOMER_DATA) {
      addMsg('bot', lang === 'en' ? 'Enter your name, phone, email, and any special requests separated by commas.' : 'Escribe tu nombre, teléfono, correo y peticiones especiales separados por comas.');
      if (widgetFlowIsRestaurant()) {
        addMsg('bot', lang === 'en' ? 'Optional table preference:' : 'Preferencia de mesa opcional:');
        [['Terrace', 'Terraza'], ['Window', 'Ventana'], ['Inside', 'Interior'], ['No preference', 'Sin preferencia']].forEach(function (choice) {
          button(lang === 'en' ? choice[0] : choice[1], function () { wrap.remove(); bookingFlow.dispatch({ type: FLOW.EVENTS.SET_RESTAURANT_PREFERENCES, tablePreference: choice[1] === 'Sin preferencia' ? null : choice[1] }); });
        });
        msgsEl.appendChild(wrap); CORE.irAlFondo(msgsEl, true);
      }
      return;
    } else if (state.step === FLOW.STEPS.SUMMARY) {
      addMsg('bot', (lang === 'en' ? 'Review: ' : 'Resumen: ') + [state.service, state.date, state.time, state.customer.name, state.customer.phone, state.customer.email].join(' · ') + '.');
      button(lang === 'en' ? 'Continue' : 'Continuar', function () { wrap.remove(); bookingFlow.dispatch({ type: FLOW.EVENTS.REQUEST_CONFIRMATION }); });
      button(lang === 'en' ? 'Change service' : 'Cambiar servicio', function () { wrap.remove(); bookingFlow.dispatch({ type: FLOW.EVENTS.EDIT_SERVICE }); });
      button(lang === 'en' ? 'Change date' : 'Cambiar fecha', function () { wrap.remove(); bookingFlow.dispatch({ type: FLOW.EVENTS.EDIT_DATE }); });
      button(lang === 'en' ? 'Change time' : 'Cambiar hora', function () { wrap.remove(); bookingFlow.dispatch({ type: FLOW.EVENTS.EDIT_TIME }); });
      button(lang === 'en' ? 'Change details' : 'Cambiar datos', function () { wrap.remove(); bookingFlow.dispatch({ type: FLOW.EVENTS.EDIT_CUSTOMER }); });
    } else if (state.step === FLOW.STEPS.CONFIRMATION) {
      addMsg('bot', lang === 'en' ? 'Ready to confirm your reservation?' : '¿Listo para confirmar tu reserva?');
      var confirmButton = button(lang === 'en' ? 'Confirm' : 'Confirmar', function () {
        confirmButton.disabled = true;
        bookingFlow.confirmBooking().then(function (result) {
          if (!result || result.ok !== true) { if (result && !['duplicada', 'needs_setup', 'reservas_desactivadas'].includes(result.motivo)) wrap.remove(); widgetFlowRecover(result, lang); confirmButton.disabled = false; return; }
          var confirmed = bookingFlow.getState();
          activeReservation = { reservationId: result.reservationId || null, actionToken: result.actionToken || null, fecha: confirmed.date, hora: confirmed.time, personas: confirmed.people || '', servicio: confirmed.service, specialRequests: confirmed.specialRequests || '', estado: result.status || 'confirmada', confirmedAt: Date.now(), language: lang, emailSent: !!(result.email && result.email.customer && result.email.customer.sent === true) };
          saveReserva(); captureWidgetBookingV2Event('confirmation_success', confirmed); wrap.remove();
        }).catch(function (error) { captureWidgetError(error, 'booking_v2_confirm'); captureWidgetBookingV2Event('confirmation_failed', bookingFlow.getState(), 'network'); addMsg('bot', lang === 'en' ? 'We could not confirm your reservation. Please try again.' : 'No pudimos confirmar tu reserva. Inténtalo de nuevo.'); confirmButton.disabled = false; });
      });
    } else if (state.step === FLOW.STEPS.CONFIRMED) { captureWidgetBookingV2Event('completed', state); addMsg('bot', lang === 'en' ? 'Your reservation is confirmed.' : 'Tu reserva está confirmada.'); return; }
    msgsEl.appendChild(wrap); CORE.irAlFondo(msgsEl, true);
  }

  function createWidgetBookingFlow() {
    return FLOW.createBookingFlow({
      config: { clientId: clientId, templateId: cfg.templateId || cfg.vertical, staff: widgetFlowStaff(), storageNamespace: 'jbw' }, storage: sessionStorage,
      render: { render: renderWidgetBookingFlow },
      request: { availableDates: widgetFlowRequestDates, slots: widgetFlowRequestSlots, confirmBooking: widgetFlowConfirmBooking },
      onMessage: function (state, event) { console.debug('[widget-booking-v2] transition', event.type, state.step); if (event.type === FLOW.EVENTS.START_BOOKING) captureWidgetBookingV2Event('start', state); },
    });
  }

  function startWidgetBookingFlowV2(lang, initialEntities) {
    if (!FLOW || typeof FLOW.createBookingFlow !== 'function' || !widgetFlowServices().length) return false;
    try {
      bookingFlowIdempotencyKey = CORE.genIdempotencyKey();
      bookingFlow = createWidgetBookingFlow();
      bookingFlow.startBooking();
      var reqService = initialEntities && (initialEntities.service || initialEntities.servicio);
      if (reqService) {
        var matched = null;
        var reqLow = String(reqService).toLowerCase().trim();
        widgetFlowServices().forEach(function (s) {
          var name = typeof s === 'string' ? s : (s && s.nombre ? s.nombre : '');
          if (name && (name.toLowerCase() === reqLow || reqLow.indexOf(name.toLowerCase()) !== -1 || name.toLowerCase().indexOf(reqLow) !== -1)) matched = name;
        });
        if (matched) {
          bookingFlow.dispatch({ type: FLOW.EVENTS.SELECT_SERVICE, service: matched });
        }
      }
      return true;
    }
    catch (error) { captureWidgetError(error, 'booking_v2_start'); captureWidgetBookingV2Event('fallback', null, 'start_failed'); bookingFlow = null; return false; }
  }

  function restoreWidgetBookingFlowV2() {
    if (!FLOW) return false;
    try { bookingFlow = createWidgetBookingFlow(); var restored = bookingFlow.init(); if (restored.step === FLOW.STEPS.CHAT) { bookingFlow = null; return false; } bookingFlowIdempotencyKey = CORE.genIdempotencyKey(); greeted = true; captureWidgetBookingV2Event('restore', restored); return true; }
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
        image.alt = entry.item && entry.item.nombre ? entry.item.nombre : CORE.galleryHeading(cfg.language);
        image.loading = 'lazy';
        card.appendChild(image);
        var copy = document.createElement('div');
        copy.className = 'jbw-gallery-copy';
        var name = document.createElement('div');
        name.className = 'jbw-gallery-name';
        name.textContent = entry.item && entry.item.nombre ? entry.item.nombre : CORE.galleryHeading(cfg.language);
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

    if (bookingFlow) {
      addMsg('user', t);
      var flowState = bookingFlow.getState();
      if (flowState.step !== FLOW.STEPS.CUSTOMER_DATA) {
        addMsg('bot', lang === 'en' ? 'Please use the booking options shown above.' : 'Usa las opciones de reserva mostradas arriba.');
        return;
      }
      var customerParts = t.split(',').map(function (part) { return part.trim(); });
      if (customerParts.length < 4 || !customerParts[0] || !customerParts[1] || !customerParts[2]) {
        addMsg('bot', lang === 'en' ? 'Use: name, phone, email, special requests.' : 'Usa: nombre, teléfono, correo, peticiones especiales.');
        return;
      }
      try {
        bookingFlow.dispatch({ type: FLOW.EVENTS.SET_CUSTOMER_DATA,
          customer: { name: customerParts[0], phone: customerParts[1], email: customerParts[2] }, specialRequests: customerParts.slice(3).join(','),
          foodPreferences: widgetFlowIsRestaurant() ? CORE.applyFoodPreferences(bookingFlow.getState().foodPreferences, customerParts.slice(3).join(','), cfg) : null });
        bookingFlow.dispatch({ type: FLOW.EVENTS.SHOW_SUMMARY });
      } catch (error) {
        addMsg('bot', error.message || (lang === 'en' ? 'Please check your details.' : 'Revisa tus datos.'));
      }
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
          if (startWidgetBookingFlowV2(lang, interp ? interp.entities : null)) return;
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
          if (d && Array.isArray(d.slots) && d.slots.length > 0) {
            renderAvailabilitySlots(d.slots, lang);
          }
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
