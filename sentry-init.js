/* JB Studio — Sentry para las páginas propias de la plataforma.
 *
 * Este archivo usa el Loader Script global de Sentry, que instala
 * window.onerror/onunhandledrejection para TODA la página — correcto aquí
 * porque cada página que lo carga (admin.html, asistente.html, chatbot.html,
 * reservas.html, index.html, ventas.html, preview.html, etc.) es 100% mía.
 *
 * widget.js NO usa este archivo ni el Loader Script: tiene su propia
 * instrumentación aislada (ver el bloque "Monitoreo aislado" al principio de
 * widget.js) porque ese script corre embebido en sitios de terceros, donde
 * un Loader global capturaría errores ajenos al sitio del cliente y podría
 * chocar con un Sentry que el negocio ya tenga instalado.
 *
 * Un solo archivo compartido por las páginas propias — no hay bundler ni
 * build de JS en este proyecto, así que se usa el Loader Script oficial de
 * Sentry (recomendado para sitios sin bundler) en vez del SDK npm.
 *
 * Sin SENTRY_LOADER_URL configurada, este archivo no hace nada: la página
 * sigue funcionando exactamente igual, solo que sin monitoreo.
 */
(function () {
  // Reemplazar por la URL real del "Loader Script" del proyecto de Sentry
  // (Sentry → Settings → Projects → [proyecto] → Client Keys (DSN) → Loader
  // Script). No es un secreto: está diseñada para vivir en código de
  // navegador, igual que un DSN público.
  var SENTRY_LOADER_URL = '__SENTRY_LOADER_URL__';

  if (!SENTRY_LOADER_URL || SENTRY_LOADER_URL.indexOf('__SENTRY_LOADER_URL__') !== -1) return;

  // environment: la página está servida por Vercel (o corre local sin
  // ninguno de estos hosts). No hay variable de entorno inyectable en HTML
  // estático, así que se infiere del propio hostname.
  var host = window.location.hostname;
  var environment = /(^|\.)jbstudio\.app$/.test(host) ? 'production'
    : /\.vercel\.app$/.test(host) ? 'preview'
    : 'development';

  var script = document.createElement('script');
  script.src = SENTRY_LOADER_URL;
  script.crossOrigin = 'anonymous';
  script.onload = function () {
    if (!window.Sentry || typeof window.Sentry.onLoad !== 'function') return;
    window.Sentry.onLoad(function () {
      window.Sentry.init({
        environment: environment,
        sendDefaultPii: false,
        tracesSampleRate: environment === 'production' ? 0.05 : 0,
        beforeSend: function (event) {
          // No conversaciones, prompts, ni datos de clientes: solo errores
          // técnicos del propio código de la página.
          if (event.request) {
            delete event.request.cookies;
            delete event.request.data;
          }
          event.user = undefined;
          return event;
        },
      });
      window.Sentry.setTag('runtime', 'browser');
      var page = document.body && document.body.getAttribute('data-sentry-page');
      if (page) window.Sentry.setTag('feature', page);
      var clientId = window.__JB_CLIENT_ID__;
      if (clientId) window.Sentry.setTag('client_id', clientId);
    });
  };
  document.head.appendChild(script);
})();
