/* JB Studio — inicialización y captura de errores para toda la plataforma
 * (funciones serverless de Vercel). Única fuente de verdad para Sentry en el
 * backend: cada función en api/ importa este módulo en vez de llamar
 * Sentry.init() por su cuenta, así el filtrado de privacidad y el muestreo
 * viven en un solo lugar.
 *
 * Vive en lib/ y no en api/: el proyecto está en el límite de 12 funciones
 * del plan Hobby (ver lib/setup.js) y un archivo en api/ contaría como una
 * más.
 *
 * Si SENTRY_DSN no está configurada, todo en este archivo es un no-op seguro:
 * la plataforma sigue funcionando exactamente igual, solo que sin monitoreo.
 */
import * as Sentry from '@sentry/node';

const DSN = process.env.SENTRY_DSN || '';

// production | preview | development — Vercel ya expone esto en runtime.
// Fuera de Vercel (pruebas locales, CI) cae a 'development'.
const ENVIRONMENT = process.env.VERCEL_ENV || 'development';

// Claves que nunca deben llegar a Sentry, sin importar dónde aparezcan
// (headers, query, body, breadcrumbs, contexto extra). Todo en minúsculas:
// la comparación normaliza el nombre de la clave antes de revisar esta lista.
const SENSITIVE_KEYS = new Set([
  'authorization', 'cookie', 'set-cookie', 'token', 'secret', 'password',
  'apikey', 'api_key', 'email', 'phone', 'telefono', 'name', 'nombre',
  'message', 'messages', 'prompt', 'systemprompt', 'conversation',
  'notes', 'notas', 'specialrequests', 'foodpreferences', 'contacto',
  'authtoken', 'admintoken', 'actiontoken', 'idempotencykey',
]);

function isSensitiveKey(key) {
  return SENSITIVE_KEYS.has(String(key || '').toLowerCase());
}

// Contexto técnico que el SDK recolecta solo (os, runtime, browser, etc.):
// nunca trae datos de negocio, así que no pasa por el scrub genérico — eso
// evita que "name" (bloqueada para no filtrar el nombre de un cliente) borre
// también "runtime.name"/"os.name", que son inofensivos. [BUG-SOBRE-REDACCION]
const SAFE_CONTEXT_KEYS = new Set(['os', 'runtime', 'browser', 'device', 'culture', 'app', 'cloud_resource', 'trace']);

// Recorre objetos/arreglos y redacta cualquier clave sensible, sin mutar el
// original. Límite de profundidad para no colgarse con estructuras raras.
function scrub(value, depth) {
  if (depth > 6 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value !== 'object') return value;
  if (value instanceof Error) return value; // Sentry maneja el Error aparte.
  const out = {};
  for (const key of Object.keys(value)) {
    out[key] = isSensitiveKey(key) ? '[Filtered]' : scrub(value[key], depth + 1);
  }
  return out;
}

let initialized = false;

export function initSentry() {
  if (initialized || !DSN) return;
  initialized = true;
  Sentry.init({
    dsn: DSN,
    environment: ENVIRONMENT,
    release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    // Error Monitoring es la prioridad; tracing bajo y nada de PII por
    // defecto. Ver docs/SENTRY.md para el razonamiento completo.
    tracesSampleRate: ENVIRONMENT === 'production' ? 0.05 : 0,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) event.request.headers = scrub(event.request.headers, 0);
        if (event.request.query_string) delete event.request.query_string;
      }
      if (event.extra) event.extra = scrub(event.extra, 0);
      if (event.contexts) {
        const scrubbedContexts = {};
        for (const key of Object.keys(event.contexts)) {
          scrubbedContexts[key] = SAFE_CONTEXT_KEYS.has(key) ? event.contexts[key] : scrub(event.contexts[key], 0);
        }
        event.contexts = scrubbedContexts;
      }
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b) => ({
          ...b,
          data: b.data ? scrub(b.data, 0) : b.data,
          message: undefined, // los breadcrumbs por defecto no deben traer texto libre
        }));
      }
      event.user = undefined;
      return event;
    },
  });
}

// Captura un error real del sistema con el contexto mínimo necesario para
// ubicarlo (negocio, ruta, feature) sin datos personales. `extra` pasa por el
// mismo scrub que el resto del evento, pero igual no debe incluir texto de
// clientes: solo datos técnicos (duración, código HTTP, etc.).
export function captureApiException(err, { clientId, feature, route, extra } = {}) {
  if (!DSN) { return; }
  Sentry.withScope((scope) => {
    scope.setTag('runtime', 'node');
    scope.setTag('environment', ENVIRONMENT);
    if (clientId)  scope.setTag('client_id', clientId);
    if (feature)   scope.setTag('feature', feature);
    if (route)     scope.setTag('route', route);
    if (extra)     scope.setContext('detail', scrub(extra, 0));
    Sentry.captureException(err);
  });
}

export function captureApiMessage(msg, { clientId, feature, route, level = 'warning' } = {}) {
  if (!DSN) return;
  Sentry.withScope((scope) => {
    scope.setTag('runtime', 'node');
    scope.setTag('environment', ENVIRONMENT);
    if (clientId) scope.setTag('client_id', clientId);
    if (feature)  scope.setTag('feature', feature);
    if (route)    scope.setTag('route', route);
    Sentry.captureMessage(msg, level);
  });
}

export { Sentry };
