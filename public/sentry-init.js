// Sentry browser initialization — jb-studio-site
// Única fuente de verdad para el frontend (chatbot, panel, etc.).
// No hay build step: se carga via <script src="/sentry-init.js"></script> en
// cada página. Si el CDN falla, es un no-op seguro.
//
// CSPorigen: 'self' + https://js.sentry-cdn.com (ya permitido en vercel.json)

(function () {
  'use strict';

  var DSN = 'https://01798dd3dcf929fe3a2800b6b3c4e47e@o4511805847633920.ingest.us.sentry.io/4511805885186048';

  if (!DSN || DSN.indexOf('@') === -1) {
    console.warn('[sentry-init] SENTRY_DSN no disponible, Sentry omitido');
    return;
  }

  var ENV = (function () {
    var v = window.location.hostname;
    if (v === 'jbstudio.app') return 'production';
    if (v.match(/\.vercel\.app$/)) return 'preview';
    return 'development';
  }());

  // Claves que nunca deben enviarse a Sentry — mismo listado que lib/sentry.js
  // NOTA: clientId / client_id NO están aquí — se envían como Sentry tag
  // (setTag) para poder identificar el origen del error sin filtrar.
  var SENSITIVE = [
    'token', 'authorization', 'cookie', 'set-cookie', 'apikey', 'api_key',
    'email', 'phone', 'telefono', 'name', 'nombre', 'message', 'messages',
    'prompt', 'systemprompt', 'conversation', 'notes', 'notas',
    'specialrequests', 'foodpreferences', 'contacto', 'authtoken',
    'admintoken', 'actiontoken', 'idempotencykey', 'x-admin-token',
    'panel_token', 'ownerEmail',
  ];

  function isSensitive(key) {
    return SENSITIVE.indexOf(String(key || '').toLowerCase()) !== -1;
  }

  function scrub(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(scrub);
    var out = {};
    for (var k in obj) {
      out[k] = isSensitive(k) ? '[Filtered]' : scrub(obj[k]);
    }
    return out;
  }

  // Scrubber para URLs: quita query string completa (contiene tokens)
  function stripQuery(url) {
    if (!url) return url;
    return url.split('?')[0];
  }

  // Headers seguros que sí pueden viajar a Sentry
  var SAFE_HEADERS = {
    'user-agent': true,
    'accept': true,
    'content-type': true,
    'referer': true,
    'origin': true,
  };

  // Config que queremos siempre — más restrictiva que los defaults del CDN loader
  var OUR_CONFIG = {
    dsn: DSN,
    environment: ENV,
    tracesSampleRate: ENV === 'production' ? 0.05 : 0,
    replaysSessionSampleRate: 0,        // nunca graba sesiones
    replaysOnErrorSampleRate: 0,        // nunca graba replays
    sendDefaultPii: false,
    trackAnchors: false,
    beforeSend: function (event) {
      // URL sin query params
      if (event.request && event.request.url) {
        event.request.url = stripQuery(event.request.url);
      }
      // Headers seguros nomás
      if (event.request && event.request.headers) {
        var h = {};
        for (var k in event.request.headers) {
          if (SAFE_HEADERS[k.toLowerCase()]) h[k] = event.request.headers[k];
        }
        event.request.headers = h;
      }
      // Extra scrubbed
      if (event.extra) event.extra = scrub(event.extra);
      // Breadcrumbs: solo data, sin messages
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map(function (b) {
          return {
            category: b.category,
            type: b.type,
            timestamp: b.timestamp,
            level: b.level,
            data: b.data ? scrub(b.data) : undefined,
          };
        });
      }
      event.user = undefined;
      return event;
    },
  };

  // --- Paso 1: forzar carga del CDN loader de forma asíncrona ---
  var script = document.createElement('script');
  script.src = 'https://js.sentry-cdn.com/01798dd3dcf929fe3a2800b6b3c4e47e.min.js';
  script.crossOrigin = 'anonymous';
  script.defer = true;

  // --- Paso 2: cuando el SDK está listo, aplicar nuestra config ---
  // Sentry.onLoad() es el hook oficial para código que necesita el SDK cargado.
  // Si el CDN loader ya llamó Sentry.init(), nuestra llamada lo sobrescribe
  // (en Sentry v10+ es safe / idempotent). Si todavía no initió, lo hace.
  script.onload = function () {
    if (typeof window.Sentry !== 'undefined') {
      window.Sentry.onLoad(function () {
        window.Sentry.init(OUR_CONFIG);
        // clientId NO va en scrub ni en extra — es un tag para identificar el origen
        var clientId = window.__JB_CLIENT_ID__;
        if (clientId) window.Sentry.setTag('clientId', clientId);
        var page = document.body && document.body.getAttribute('data-sentry-page');
        if (page) window.Sentry.setTag('feature', page);
      });
    }
  };

  script.onerror = function () {
    console.warn('[sentry-init] No se pudo cargar Sentry desde CDN');
  };

  document.head.appendChild(script);
}());
