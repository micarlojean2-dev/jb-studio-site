# Sentry — monitoreo de errores de JB Studio

Arquitectura real del proyecto (confirmada antes de integrar nada): **no es
Next.js**. Es Node.js + Vercel Serverless Functions (`api/*.js`, ESM) sin Edge
Runtime, más un frontend estático sin bundler (`admin.html`, `asistente.html`,
`chat-core.js`, `widget.js`, etc., servidos tal cual). Por eso se usan dos
SDKs distintos:

- **Backend** (`api/*.js`): `@sentry/node`, inicializado desde `lib/sentry.js`
  (no vive en `api/` para no sumar una 13ª función — el plan Hobby tiene un
  límite de 12 y el proyecto ya usa las 12).
- **Páginas propias** (`admin.html`, `asistente.html`, `chatbot.html`,
  `reservas.html`, `index.html`, `ventas.html`, `preview.html`,
  `vista-previa.html`, `cancel.html`, `success.html`): `sentry-init.js` carga
  el mismo bundle CDN que `widget.js` (sin bundler propio en el proyecto) y
  llama `Sentry.init()` normal con el DSN — estas páginas son 100% mías, así
  que el comportamiento estándar (capturar todo error/rechazo de promesa de
  esa página) es correcto aquí. Un único bundle CDN cubre ambos casos de uso
  (páginas propias e instrumentación aislada del widget), sin depender de una
  segunda credencial (el Loader Script hubiera necesitado su propia URL).
- **`widget.js`** (el script embebible que corre en los sitios de los
  negocios clientes, no en jbstudio.app): **NO** usa el Loader Script ni
  `Sentry.init()` normal — ambos instalarían `window.onerror` /
  `window.onunhandledrejection` e instrumentarían fetch/XHR/console de TODA
  la página anfitriona, reportando errores del sitio del cliente (ajenos a
  esta plataforma) y arriesgando chocar con un Sentry que el negocio ya tenga
  instalado. En su lugar usa el patrón oficial de Sentry **"Multiple Sentry
  Instances" / cliente propio**: construye a mano un `BrowserClient` + `Scope`
  con `integrations: []` (cero integraciones automáticas → cero manejadores
  globales) desde el bundle CDN `browser.sentry-cdn.com/10.68.0/bundle.min.js`
  (confirmado por inspección directa del archivo: expone `BrowserClient`,
  `Scope`, `makeFetchTransport` y `defaultStackParser` en `window.Sentry`).
  Ese cliente nunca se registra como "el cliente actual" global — solo
  reporta lo que `widget.js` captura explícitamente en sus propios `catch`
  (carga de configuración, envío de mensaje, crear/reprogramar/cancelar
  reserva). Ver el bloque "Monitoreo aislado" al inicio de `widget.js`.

## 1. Variables de entorno

| Variable | Dónde se usa | Pública/Secreta | Dónde encontrarla en Sentry |
|---|---|---|---|
| `SENTRY_DSN` | Servidor (`lib/sentry.js`, todas las funciones de `api/`) | No es secreta, pero se guarda como env var de servidor de todas formas | Sentry → Settings → Projects → [proyecto] → Client Keys (DSN) |
| `SENTRY_ORG` | Solo si conectas la integración de Sentry↔Vercel (source maps/releases) | No secreta | Sentry → Settings → General Settings → "Organization Slug" |
| `SENTRY_PROJECT` | Igual que arriba | No secreta | Sentry → Settings → Projects → [proyecto] → nombre/slug del proyecto |
| `SENTRY_AUTH_TOKEN` | Solo lo usa la integración Sentry↔Vercel para subir source maps y crear releases — **nunca** debe llegar al navegador | **Secreta** | Sentry → Settings → Auth Tokens → Create New Token (scopes: `project:releases`, `org:read`) |

**No hace falta crear `NEXT_PUBLIC_SENTRY_DSN`** — no es Next.js. No hay
ningún paso de build que pueda inyectar una env var en un archivo HTML/JS
estático, así que el mismo DSN (no es secreto — está diseñado para vivir en
código de navegador) está escrito directamente en dos archivos:

- `sentry-init.js` (variable `SENTRY_DSN`) — páginas propias.
- `widget.js` (variable `WIDGET_SENTRY_DSN`, dentro del bloque "Monitoreo
  aislado") — cliente aislado del widget embebido.

### En qué entornos de Vercel

- `SENTRY_DSN` → **Production, Preview y Development** (las tres — así el
  backend reporta en los tres ambientes; `lib/sentry.js` ya separa el
  `environment` usando `VERCEL_ENV`).
- `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` → los crea
  automáticamente la integración Sentry↔Vercel al conectarla (ver abajo). No
  hace falta pegarlos a mano.

Si `SENTRY_DSN` no existe, `lib/sentry.js` no llama a `Sentry.init()` — la
plataforma sigue funcionando exactamente igual, sin monitoreo, sin lanzar
ningún error por la variable faltante.

## 2. Estado (completado 2026-07-26)

DSN recibido y configurado en:
- Vercel → `SENTRY_DSN` (Production, Preview, Development) — verificado con
  `vercel env ls`, valor encriptado, nunca mostrado en texto plano.
- `/widget.js` → `WIDGET_SENTRY_DSN`.
- `/sentry-init.js` → `SENTRY_DSN` (mismo valor).

`SENTRY_ORG`, `SENTRY_PROJECT` y `SENTRY_AUTH_TOKEN` — **NO configurados
todavía**, a propósito: quedan pendientes de confirmar el método oficial de
source maps para esta arquitectura (no-Next.js) antes de tocarlos.

Pendiente, opcional (recomendado para source maps y releases automáticos):
instalar la integración oficial **Sentry** desde Vercel → tu proyecto →
Settings → Integrations → busca "Sentry" → Add Integration → conecta con tu
cuenta de Sentry y selecciona el proyecto. Esto crearía `SENTRY_ORG`,
`SENTRY_PROJECT` y `SENTRY_AUTH_TOKEN` en Vercel automáticamente — pero no se
activa hasta confirmar que sigue siendo el método correcto para subir source
maps en un proyecto sin Next.js.

Fuente de verdad de las decisiones sobre source maps: pendiente. Cuando se
confirme el método, esta sección se actualiza antes de tocar ninguna de esas
tres variables.

## 3. Privacidad

`lib/sentry.js` y `sentry-init.js` tienen `sendDefaultPii: false` y un
`beforeSend` que:
- Elimina `request.data`, `request.cookies`, `request.query_string`.
- Redacta (`[Filtered]`) cualquier clave que coincida con: `authorization`,
  `cookie`, `set-cookie`, `token`, `secret`, `password`, `apikey`, `email`,
  `phone`/`telefono`, `name`/`nombre`, `message(s)`, `prompt`,
  `conversation`, `notes`/`notas`, `specialRequests`, `foodPreferences`,
  `contacto`, y variantes de tokens internos (`actionToken`,
  `idempotencyKey`, `adminToken`).
- Quita `event.user` siempre (nunca se asocia un evento a una persona).
- Los breadcrumbs nunca llevan el campo `message` libre.

Ningún `captureException`/`captureMessage` en el código recibe objetos
completos de reserva, cliente o conversación — solo `clientId`, `feature`,
`route` y, cuando aplica, datos técnicos (código HTTP, tipo de operación).

`widget.js` sigue la misma disciplina: `captureWidgetError(err, feature)` solo
recibe el objeto `Error` de un `fetch().catch()` y una etiqueta de texto fija
— nunca el cuerpo de la petición, el mensaje del cliente, ni datos de la
reserva. Además, al no tener `integrations` automáticas, nunca genera
breadcrumbs de consola/fetch/DOM que pudieran filtrar texto de la página del
negocio.

## 4. Tags por evento

- `client_id` — el identificador del negocio/chatbot (no hay `businessId`
  separado en este proyecto: un `clientId` es ambos).
- `feature` — `chat`, `reservation_create`, `reservation_update`,
  `reservation_cancel`, `email_customer`, `email_owner`, `redis`,
  `client_panel`, `chatbot_loader`, `billing`, `reviews`, `ventas_funnel`.
- `route` — el endpoint o página.
- `runtime` — `node` (backend) o `browser` (frontend).
- `environment` — `production` / `preview` / `development`.

### Tags exclusivos de `widget.js`

- `client_id` / `chatbot_id` — mismo valor (un `clientId` cubre negocio y
  chatbot en este proyecto; no existe un identificador de chatbot separado).
- `business_type` — `cfg.templateId` (restaurant/barber/spa/etc.), si ya
  cargó la configuración cuando ocurre el error.
- `widget_version` — constante `WIDGET_VERSION` en `widget.js` (bump manual
  en cambios futuros del propio archivo).
- `domain` — `window.location.hostname` del sitio del negocio donde está
  embebido (identifica QUÉ instalación falla, sin ser dato personal).
- `feature` — `chatbot_loader`, `chat`, `reservation_create`,
  `reservation_update`, `reservation_cancel`.

## 5. Rendimiento / plan gratuito

- `tracesSampleRate`: `0.05` en producción (páginas propias), `0` en
  preview/desarrollo, `0` siempre en `widget.js` (solo error monitoring, cero
  tracing en sitios de terceros).
- Session Replay: **desactivado** (no se configuró, ni en páginas propias ni
  en el widget).
- Profiling: **desactivado** (no se configuró).
- `widget.js` además: tope de 5 eventos por carga de página y deduplicación
  por firma de error (mensaje + feature) dentro de la misma sesión, para que
  un fallo en bucle en un sitio de tercero no consuma la cuota del plan
  gratuito.
- Prioridad: Error Monitoring.

## 6. Alertas recomendadas (crear manualmente en Sentry → Alerts)

Crear reglas de tipo "Issue Alert" con **agrupación** (no una por cada
repetición):
1. **Nuevo error en producción** — condición "A new issue is created",
   filtro `environment:production`, acción: notificar por email/Slack.
2. **Aumento repentino de errores** — condición "An issue is seen more than
   {X} times in {Y} minutes" (p. ej. 20 veces en 5 min).
3. **Errores de reservas** — filtro `feature:reservation_create OR
   feature:reservation_update OR feature:reservation_cancel`.
4. **Errores del chat** — filtro `feature:chat`.
5. **Errores de Redis** — filtro `feature:redis`.
6. **Errores de Resend** — filtro `feature:email_customer OR
   feature:email_owner`.
7. **Widget roto en la instalación de un cliente** — filtro
   `runtime:browser AND feature:chatbot_loader`, agrupado por `domain` en el
   Issue (Sentry ya agrupa por stack trace + tags relevantes) — permite ver
   de un vistazo en qué sitio de qué negocio está fallando la carga.

Configura cada regla con una ventana de "un aviso agrupado, no uno por
evento" (Sentry ya agrupa por fingerprint del error; la condición de
"seen more than X times" evita spam de un error que se repite en ráfaga).
