/* JB Studio — Sentry para las páginas propias de la plataforma.
 *
 * Estas páginas (admin.html, asistente.html, chatbot.html, reservas.html,
 * index.html, ventas.html, preview.html, vista-previa.html, cancel.html,
 * success.html) son 100% mías, así que el comportamiento normal de
 * Sentry.init() (capturar todo error/rechazo de promesa de la página) es
 * correcto aquí — a diferencia de widget.js, que corre embebido en sitios de
 * terceros y por eso usa su propia instrumentación aislada (ver el bloque
 * "Monitoreo aislado" al inicio de widget.js).
 *
 * Sin bundler ni build de JS en este proyecto, se carga el mismo bundle CDN
 * de Sentry que usa widget.js (versión fija, ya verificada) y se llama
 * Sentry.init() directamente con el DSN — más simple que el Loader Script y
 * sin depender de una segunda credencial.
 *
 * Si algo falla al cargar o inicializar, la página sigue funcionando igual:
 * todo esto es best-effort y nunca debe romper nada.
 */
(function () {
  var SENTRY_DSN = 'https://01798dd3dcf929fe3a2800b6b3c4e47e@o4511805847633920.ingest.us.sentry.io/4511805885186048';

  try {
    var host = window.location.hostname;
    var environment = /(^|\.)jbstudio\.app$/.test(host) ? 'production'
      : /\.vercel\.app$/.test(host) ? 'preview'
      : 'development';

    var script = document.createElement('script');
    script.src = 'https://browser.sentry-cdn.com/10.68.0/bundle.min.js';
    script.crossOrigin = 'anonymous';
    script.onload = function () {
      try {
        if (!window.Sentry || typeof window.Sentry.init !== 'function') return;
        window.Sentry.init({
          dsn: SENTRY_DSN,
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
      } catch (e) { /* el monitoreo nunca debe romper la página */ }
    };
    script.onerror = function () { /* CDN bloqueado o sin red: sin monitoreo, página normal */ };
    document.head.appendChild(script);
  } catch (e) { /* el monitoreo nunca debe romper la página */ }
})();
