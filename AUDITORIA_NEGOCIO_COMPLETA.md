# Auditoría completa de negocio — jb-studio-site

Fecha: 2026-08-15
Alcance: 100% diagnóstico, solo lectura. No se modificó ningún archivo ni se ejecutó ninguna acción destructiva o real de Stripe. Todos los flujos de reserva probados se detuvieron ANTES de tocar el botón "Confirmar" (no se crearon reservas de prueba en producción durante esta auditoría, salvo donde se indica explícitamente lo contrario).

Commit/deploy vigente al momento de la auditoría: `4518f7c18d12da6652c93b30c18a95de45f60b6a` (`dpl_CfXtp3ze7yy2Jv4o31FUJQQmEsfv`, producción, `jbstudio.app`).

Clientes reales encontrados en Redis de producción (los únicos 3 que existen — no se creó ninguno nuevo):
```
client:spa
client:barberia-el-corte-fino   (templateId: barber, active: true)
client:restaurante-e2e-intenso  (templateId: restaurant, active: true)
```

---

## SECCIÓN 1 — Paridad del motor entre verticales (spa/barbería/restaurante)

### Barbería (`barberia-el-corte-fino`) — E2E real en producción

Flujo probado en `https://jbstudio.app/asistente?id=barberia-el-corte-fino`, sesión limpia, español.

| Paso | Resultado | Evidencia |
|---|---|---|
| Saludo bloqueado | `inputDisabled: true`, placeholder "Elige un servicio o sigue conversando", botones ✨/📅/💰 | captura `barber-01-greeting-blocked.png` |
| Aviso temprano (CAMBIO 3) | "Cualquier duda te la resuelvo al final, una vez que tengas todo listo 😊" al arrancar la reserva | snapshot real |
| SERVICE_SELECTION bloqueado | `inputDisabled: true` con 5 servicios reales del cliente (Corte de cabello, Corte + Barba, Afeitado clásico, Diseño de barba, Corte de niño) | snapshot real |
| BARBER_SELECTION | **No se disparó** — el cliente no tiene `staff`/`barberStaff` configurado en Redis (`templateData:{}` vacío), así que el flujo salta directo a fecha. No es un bug: es una particularidad de datos de este cliente en concreto, no del motor. | `client:barberia-el-corte-fino` en Redis, campo `templateData:{}` |
| DATE_SELECTION solo calendario (CAMBIO 2) | `inputDisabled: true`, placeholder "Usa las opciones de arriba", calendario con slots cada 15 min (`reservationIntervalMinutes:15` de este cliente) | snapshot real |
| Confirmación de nombre | "¿Tu nombre es 'Mike AuditBarber'?" con botones ✅/❌, input bloqueado | captura `barber-02-name-confirmation.png` |
| Alergias/peticiones | "¿Tienes alguna alergia, preferencia o petición especial...?" — mismo texto que spa | snapshot real |
| SUMMARY + pregunta a la IA + botones persistentes (FIX 1) | Pregunté "¿el corte incluye lavado?" → la IA respondió correctamente ("El corte de cabello no incluye lavado...") y **medido con JS**: `isWrapAtAllVisible: true`, `scrollTop (1540) === idealScrollTop (1540)` — los 5 botones de editar quedaron visibles, igual que en spa. | captura `barber-03-summary-ai-question-buttons-visible.png` |
| CONFIRMATION | "¿Tienes alguna duda antes de confirmar? Preguntame lo que quieras 😊" + botón "Confirmar" | captura `barber-04-confirmation-step.png` |

No se tocó "Confirmar" — no se creó ninguna reserva de prueba para este cliente.

### Restaurante (`restaurante-e2e-intenso`) — E2E real en producción

Flujo probado en `https://jbstudio.app/asistente?id=restaurante-e2e-intenso`, sesión limpia, español.

| Paso | Resultado | Evidencia |
|---|---|---|
| Saludo bloqueado | `inputDisabled: true`, pero **solo 2 botones**: "🍽️ Ver menú" y "💰 Precios" — **falta "📅 Reservar mesa"** | snapshot real |
| Causa raíz de la ausencia del botón "Reservar" | `chat-core.js` construye los botones con `accionesRapidas(cfg, puedeReservar)`; `puedeReservar` viene de `featureOn('reservations')`, que en el objeto de este cliente en Redis da `false` porque el cliente **no tiene el campo `features` en absoluto** (a diferencia de spa/barbería, que sí lo tienen explícito con `reservations:true`). Este cliente de prueba es un objeto mucho más minimalista (le faltan también `notificationEmails`, `panelToken`, `widgetSnippet`, `assistantUrl`, `phoneCountry`, `businessType`) — parece haber sido sembrado directo en Redis por un script de test antiguo, no creado por el wizard real. | `client:restaurante-e2e-intenso` completo en Redis (ver abajo) |
| ¿El motor de reservas sigue funcionando igual? | **Sí** — a pesar de faltar el botón, las tarjetas del menú SÍ tienen "Reservar este servicio" clickeable (con el bloqueo de galería de CAMBIO 1 activo, botón "Seguir conversando" incluido). Tocar una tarjeta arranca `startBookingFlowV2` igual que en cualquier otro vertical. | snapshot real |
| PEOPLE_SELECTION (particularidad de restaurante) | Al tocar "Mesa para 2 personas" → "¿Para cuántas personas?" con botones 1-6 → funciona igual que antes de los cambios de hoy | snapshot real |
| Aviso temprano (CAMBIO 3) | "Cualquier duda te la resuelvo al final..." apareció correctamente tras iniciar el flujo | snapshot real |
| DATE_SELECTION | **Bloqueado, pero sin fechas**: "Por ahora no hay fechas disponibles. Vuelve a revisar pronto." | captura `restaurant-01-no-dates-available.png` |
| Resto del flujo (hora, datos, confirmación de nombre, SUMMARY, CONFIRMATION) | **No se pudo verificar** — sin fechas disponibles no hay forma de avanzar. Esto es un problema de **datos incompletos de este cliente de prueba específico**, no de la lógica del vertical en sí. | — |

Mensaje menor encontrado (no relacionado con los cambios de hoy): al reservar una mesa, el mensaje del cliente dice **"Quiero reservar este plato: Mesa para 2 personas"** — usa la palabra "plato" para una mesa. Es un detalle de copy preexistente en `chat-core.js` (`bookServiceMessage`), no algo que haya cambiado hoy.

```json
// client:restaurante-e2e-intenso completo, tal como está en Redis
{"id":"restaurante-e2e-intenso","businessName":"Restaurante E2E Intenso","templateId":"restaurant","active":true,"plan":"pro","ownerEmail":"mikestandlyjeanbaptiste@gmail.com","language":"es","languages":["es","en"],"timezone":"America/Los_Angeles","capacityPerSlot":4,"reservationIntervalMinutes":30,"businessHours":{...},"menu":[{"id":"svc_rest_1","nombre":"Mesa para 2 personas","precio":"$0","descripcion":"Mesa estándar en salón principal.","duracion":"90 min"},{"id":"svc_rest_2","nombre":"Mesa VIP Terraza","precio":"$25","descripcion":"Reserva exclusiva en la terraza con vista.","duracion":"120 min"}]}
```
Nótese la ausencia de `features`, `notificationEmails`, `panelToken`, `widgetSnippet`, `assistantUrl`, `businessType` — todos presentes en `client:spa` y `client:barberia-el-corte-fino`.

### Resumen SECCIÓN 1

- ✅ confirmado: CAMBIO 1 (bloqueo saludo/galería), CAMBIO 2 (calendario sin texto libre), CAMBIO 3 (aviso temprano + preguntas IA en SUMMARY + botones persistentes tras el fix de timing), confirmación de nombre — **todos funcionan idénticos en barbería** (verificado end-to-end) y en las partes alcanzables de restaurante (saludo, aviso temprano, menú con galería bloqueada, PEOPLE_SELECTION).
- ⚠️ necesita atención: el cliente de prueba `restaurante-e2e-intenso` tiene datos incompletos (sin `features`, sin fechas disponibles) — impide verificar el flujo completo hasta CONFIRMATION en ese vertical. No es un bug de los cambios de hoy; es un cliente de prueba mal sembrado. Recomiendo decidir entre: (a) completar su configuración en Redis/admin, o (b) crear un cliente de restaurante nuevo y bien configurado en una próxima sesión para terminar de verificar ese vertical.
- ⚠️ necesita atención (menor, preexistente): copy "reservar este plato" para una reserva de mesa.
- ❓ no pude verificar: BARBER_SELECTION en vivo (el único cliente de barbería real no tiene barberos cargados); el flujo completo de restaurante después de DATE_SELECTION.

---

## SECCIÓN 2 — Creación de un chatbot nuevo desde el panel admin

### Bloqueo real encontrado

**No pude iniciar sesión en `admin.html`** para hacer clic real por el wizard: el login del panel vive en memoria (`let token = ''`, sin localStorage) y requiere el `ADMIN_TOKEN` o la contraseña de Mike, que no son legibles ni conocidas en este entorno (confirmado ya en sesiones anteriores: los secretos de producción están redactados en todos los `.env*` locales). Por eso esta sección es evidencia de **código**, no de clics reales en el wizard. Si querés capturas reales del wizard funcionando, puedo hacerlo en una sesión donde vos inicies sesión en la pestaña que yo controlo, o me pases un `previewToken`/credencial temporal.

### 1) Flujo del wizard (código real)

`admin.html:5016-5029` — apertura del wizard:
```
  5016	    function openWizard() {
  5017	      state = freshState();
  5018	      currentSection = '1';
  5019	      viewMode = 'sections';
  5020	      featuresManuallyEdited = false;
  5021	      finalized = false;
  5022	      formTouched = false;
  5023	      syncFormFromState();
  5024	      renderServices();
  5025	      renderFeatureGroups();
  5026	      applyViewMode();
  5027	      renderStep();
  5028	      overlay.style.display = 'flex';
  5029	    }
```

`admin.html:5212-5229` — lectura de los campos del Paso 1 (Negocio) y Paso 2 (Diseño):
```
  5212	    function readStep1() {
  5213	      state.business.name       = document.getElementById('w-b-name').value;
  5214	      state.business.type       = document.getElementById('w-b-type').value;
  5215	      state.business.plan       = document.getElementById('w-b-plan').value;
  5216	      state.business.address    = document.getElementById('w-b-address').value;
  5217	      state.business.ownerEmail = document.getElementById('w-b-email').value;
  5218	      state.business.phoneCountry = document.getElementById('w-b-phone-country').value;
  5219	      const country = PHONE_COUNTRIES.find(c => c.code === state.business.phoneCountry) || PHONE_COUNTRIES[0];
  5220	      state.business.phoneCountryCode = country.dial;
  5221	      state.business.phoneNumber = document.getElementById('w-b-phone-number').value;
  5222	    }
  5223	
  5224	    function readStep2() {
  5225	      state.design.primaryColor   = document.getElementById('w-d-color1').value.trim() || state.design.primaryColor;
  5226	      state.design.secondaryColor = document.getElementById('w-d-color2').value.trim() || state.design.secondaryColor;
  5227	    }
```

El envío final hace `POST /api/clients` con el token de admin (`admin.html:7552`):
```
  7552	        const response = await fetch('/api/clients', { method:'POST', headers:{'Content-Type':'application/json','x-admin-token':window.__jbAdmin.getToken()}, body:JSON.stringify(payload) });
```

El flujo es el mismo formulario (con la plantilla — `w-b-type` — determinando `barber` o `restaurant`) para ambos verticales; no hay dos wizards distintos, hay uno solo parametrizado por plantilla.

### 2) ¿Un chatbot creado HOY hereda los cambios del motor?

**Sí, por diseño de arquitectura — verificado por código, no por creación real de un cliente nuevo (ver bloqueo arriba).**

`api/clients.js:749-789` — así se construye CUALQUIER cliente nuevo, sin importar la plantilla:
```
   749	      const client = {
   750	        id,
   751	        businessName: String(businessName).slice(0, 120),
   ...
   765	        businessType: templateIdSafe || String(businessType || '').slice(0, 80),
   ...
   784	        // Server-authoritative: every new client starts Stripe's 10-day trial.
   785	        trialEnabled: true,
   786	        trialDays:    10,
   787	        active:                true,
   788	        paymentStatus:         'trialing',
   789	        paidUntil:             null,
```

El motor conversacional (`asistente.html`, `widget.js`, `chat-flow.js`, `chat-core.js` — donde viven TODOS los cambios de hoy: bloqueo de saludo, calendario sin texto libre, confirmación de nombre, preguntas con IA en SUMMARY) es el **mismo archivo estático servido a todos los clientes**; no hay una copia por cliente ni un build por vertical. `asistente.html` lee la configuración del negocio vía `GET /api/client-config?id=<clientId>` en tiempo de ejecución. Un cliente creado hoy usa el `asistente.html` que está en el deploy actual (`4518f7c`) automáticamente — no requiere ninguna acción especial. Esto ya quedó demostrado indirectamente en la SECCIÓN 1: `barberia-el-corte-fino` y `restaurante-e2e-intenso` (creados antes de hoy) mostraron los 3 cambios de hoy sin que nadie los tocara.

### 3) Campos obligatorios / opcionales

`templates/barber/template.json`, `templates/restaurant/template.json`, `templates/spa/template.json` — **idénticos** los tres:
```json
"requiredFields": ["businessName", "address", "phone", "ownerEmail", "timezone", "businessHours", "services", "bookingEnabled", "notificationEmails"]
```

`api/clients.js:566-569` — validación server-side mínima (más laxa que la de la plantilla, es solo el piso absoluto):
```
   566	    const missingBasic = [];
   567	    if (!id) missingBasic.push('id');
   568	    if (!businessName) missingBasic.push('businessName');
   569	    if (missingBasic.length)
```

Campos que el servidor **siempre** deriva/decide, sin importar lo que mande el wizard (server-authoritative, no confía en el cliente):
- `monthlyPrice` — se deriva de `plan` vía `PLAN_PRICES`, nunca del body.
- `trialEnabled/trialDays/paymentStatus` — siempre `true/10/'trialing'` para un cliente nuevo.
- `businessType` — si hay plantilla, siempre es el id de la plantilla (nunca un valor suelto que no corresponda).

### Resumen SECCIÓN 2

- ✅ confirmado (por código): el motor es 100% compartido; un cliente nuevo hereda los cambios de hoy sin ninguna acción especial.
- ✅ confirmado: campos requeridos idénticos entre las 3 plantillas.
- ❓ no pude verificar sin acción real: el flujo de clics del wizard en vivo (falta login de admin con credencial de Mike). Recomiendo hacerlo juntos en una próxima sesión, o pasarme un acceso temporal.

---

## SECCIÓN 3 — Extracción de código embebido para el sitio del cliente

### 1-2) Qué se le entrega al dueño del negocio

Es un `<script>` tag, generado y guardado server-side en el momento de la creación (`api/clients.js:815`):
```
   815	        widgetSnippet: `<script src="https://jbstudio.app/widget.js?id=${id}" data-position="${position}"></script>`,
   816	        assistantUrl:  `https://jbstudio.app/asistente/${id}`,
```

Ejemplo real (`client:barberia-el-corte-fino`):
```
<script src="https://jbstudio.app/widget.js?id=barberia-el-corte-fino" data-position="bottom-right"></script>
```

El dueño lo pega antes de `</body>` en su propio sitio. `admin.html` ofrece copiarlo desde varios lugares: el botón "📋 Copiar código para web" del panel de gestión (`admin.html:3068`), el mail de bienvenida automático que arma `api/stripe-webhook.js` (`sendWelcome`, línea 119-121 — el mismo snippet, embebido en el correo), y la pantalla de éxito del wizard (`admin.html:5988`, `client.widgetSnippet`). No hay iframe ni link para "compartir" — es siempre este script tag autocontenido, que cuando carga en el sitio del cliente pinta la burbuja de chat (`widget.js`).

También se entrega, por separado, el **enlace directo** al asistente (`https://jbstudio.app/asistente/<id>`) para compartir por WhatsApp/redes sin necesitar el script — mismo motor, sin burbuja flotante (`admin.html:3999-4000`):
```
  3999	    function assistantUrl(client) {
  4000	      return client.assistantUrl || `${window.location.origin}/asistente/${encodeURIComponent(client.id)}`;
  4001	    }
```

### 3) Modelo de control: Mike sigue teniendo el control total

Confirmado por dos caminos de código independientes:

**(a) El panel del propio dueño (`reservas.html`) nunca puede escribir configuración.** Revisé cada `fetch(...)` en `reservas.html`: solo llama a `GET /api/reservations-list` (ver reservas/actividad) y a la variante `scope=set_password` (para que el dueño defina su propia clave de acceso a SU panel). **Cero** llamadas a `PUT /api/clients` — el dueño no puede tocar el prompt, el menú, los precios, ni pausar el bot desde su panel.

**(b) `PUT /api/clients` (donde sí se puede todo eso) está bloqueado detrás del `ADMIN_TOKEN` de Mike**, no del `panelToken` del cliente:

`api/clients.js:33-37`:
```
    33	  const t = req.headers['x-admin-token'] || req.query?.adminKey;
    34	  ...
    37	  return process.env.ADMIN_TOKEN && t === process.env.ADMIN_TOKEN;
```

`api/clients.js:845-849` — todo lo que se puede cambiar vía PUT (solo con `ADMIN_TOKEN`):
```
   845	  if (req.method === 'PUT') {
   846	    const { id, active, prompt, businessName, ownerName, ownerEmail, plan,
   847	            color, language, whatsapp, menu, services, features,
   848	            timezone, minNoticeHours, businessHours, capacityPerSlot, bufferMinutes, reservationIntervalMinutes, holidays, notificationEmails,
   849	            reservationDuration } = req.body || {};
```

`admin.html:3061-3071` — el panel de gestión de Mike (nunca el del cliente) tiene: ver chatbot, editar información/diseño/servicios, galería y QR, ver reservas, copiar enlace/código, ver pago, **pausar chatbot** y **eliminar cliente**.

El cliente final solo obtiene: su enlace/script para poner en su web, su panel de solo-reservas (`reservas.html`) con su propia clave de acceso, y un botón de "Gestionar suscripción" que abre el **portal de Stripe** (para tarjeta/facturación, no para editar el chatbot).

### Resumen SECCIÓN 3

- ✅ confirmado: se entrega un `<script>` tag autocontenido + un link directo. Nada de iframe.
- ✅ confirmado, con código en dos capas independientes: Mike retiene control total (editar, pausar, borrar) vía `ADMIN_TOKEN`; el cliente final NUNCA puede escribir configuración, solo ver sus reservas y gestionar su propia facturación de Stripe.

---

## SECCIÓN 4 — Stripe: modo prueba, trial de 10 días, cobro mensual, emails

**Recordatorio: sección 100% de lectura. No se ejecutó ninguna acción real de Stripe ni se tocó el dashboard.**

### 1) Código real

**Trial de 10 días sin tarjeta** — `api/clients.js:819-831` (se ejecuta automáticamente para TODO cliente nuevo creado vía wizard):
```
   819	      const stripeCustomer = await stripe.customers.create({
   820	        name: client.businessName,
   821	        email: client.ownerEmail || undefined,
   822	        metadata: { clientId: id },
   823	        ...((testClock || test_clock) ? { test_clock: String(testClock || test_clock) } : {}),
   824	      });
   825	      const stripeSubscription = await stripe.subscriptions.create({
   826	        customer: stripeCustomer.id,
   827	        items: [{ price: stripePriceId }],
   828	        trial_period_days: 10,
   829	        trial_settings: { end_behavior: { missing_payment_method: 'pause' } },
   830	        metadata: { clientId: id },
   831	      });
```
`trial_settings.end_behavior: 'pause'` es lo que hace que sea **sin tarjeta**: si no hay método de pago cuando termina el trial, Stripe pausa la suscripción en vez de intentar cobrar (o fallar). Confirmado también en `api/clients.js:507-511` (acción administrativa `connect_stripe_trial`, para conectar retroactivamente clientes ya existentes — usada para `spa`, `barberia-el-corte-fino`, `restaurante-e2e-intenso` por defecto).

**Webhook de Stripe** — `api/stripe-webhook.js`, 466 líneas, maneja 8 tipos de evento. Idempotencia real (línea 35-39, `SET NX` atómico en Redis):
```
    35	async function markEventProcessed(eventId) {
    36	  const key = `stripe_event:${eventId}`;
    37	  const result = await redis.set(key, '1', { nx: true, ex: EVENT_TTL_SECONDS });
    38	  return result !== null; // true = primera vez que se ve este evento
    39	}
```
Pago exitoso (`invoice.paid`, líneas 239-282) marca `active:true, paymentStatus:'paid'`, guarda `paidUntil`, y dispara el correo de bienvenida **solo la primera vez** (`!c.bienvenidaEnviada`, línea 273). Pago fallido (`invoice.payment_failed`, líneas 285-311) marca `paymentStatus:'past_due'` y dispara `sendBillingAlertEmail(..., 'payment_failed', ...)`. `customer.subscription.updated` (líneas 317-385) es el más complejo: distingue `active/trialing` (sigue activo), `past_due` (sigue activo, en gracia), `unpaid`/`canceled` (se corta el acceso), `paused` (se corta) — con comentario explícito citando la doc oficial de Stripe sobre por qué `past_due` no debe cortar el acceso.

**Emails de Resend** — `lib/reservation-emails.js:231-307`, función `sendBillingAlertEmail(client, type, extra)`. Dos tipos reales: `payment_failed` (aviso de reintento automático) y `subscription_paused` (chatbot desactivado, botón para reactivar). Ambos arman HTML con Resend y devuelven `{attempted, sent, error, messageIds}` — nunca fingen éxito si Resend falla.

### 2) Configuración del dashboard de Stripe (test mode)

**❓ No pude verificarlo.** No tengo ningún MCP ni herramienta con acceso a la API o al dashboard de Stripe en este entorno (solo tengo Vercel, Sentry, Upstash y Better Stack). Tampoco puedo leer `STRIPE_SECRET_KEY` ni los `STRIPE_PRICE_*` (están redactados en todos los `.env*` locales, por diseño del proyecto).

**Lo que SÍ encontré, y que apunta a un problema real de configuración** (ver Sección de hallazgos abajo): un error real en Sentry (`NODE-A`, hace 8 días) dice textualmente *"a similar object exists in live mode, but a test mode key was used to make this request"* al intentar `POST /api/create-checkout` para el cliente `spa`. Esto es evidencia directa de que **la clave secreta de Stripe en Producción (modo test) y al menos uno de los Price IDs (`STRIPE_PRICE_BASIC`/`STRIPE_PRICE_PRO`) no coinciden de modo** — la clave es de test pero el precio existe solo en modo live, o viceversa.

**Pasos que tendrías que hacer VOS manualmente para confirmarlo:**
1. Abrí el dashboard de Stripe en https://dashboard.stripe.com, anotá si el toggle arriba a la derecha está en "Test mode" o no.
2. Andá a Developers → API keys, y compará el prefijo de tu `STRIPE_SECRET_KEY` de Vercel (Production) — si empieza con `sk_test_`, tu cuenta debe estar mirando precios de **Test mode** en el dashboard para comparar.
3. Andá a Product catalog → tu producto → mirá el Price ID de cada plan (Básico/Pro) **en el modo que coincida con tu clave** — compará contra `STRIPE_PRICE_BASIC`/`STRIPE_PRICE_PRO` en Vercel (`vercel env ls` te muestra que existen, pero no el valor).
4. Si los Price IDs de Vercel fueron copiados desde el modo equivocado (p. ej. copiaste el ID de un precio en Live mode mientras tu clave es de Test mode), ahí está el bug — hay que regenerar/copiar los IDs correctos del mismo modo que la clave.
5. Developers → Webhooks: confirmá que existe un endpoint apuntando a `https://jbstudio.app/api/stripe-webhook`, en el mismo modo (test/live) que tu clave, y que está escuchando al menos: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `customer.subscription.trial_will_end` (son los 8 que el código maneja — cualquier otro evento suscrito ahí no hace nada, no hace daño, pero no aporta).
6. Confirmá el monto configurado en cada Price (Básico/Pro) contra lo que `PLAN_PRICES` espera en el código — no pude leer ese objeto sin más presupuesto de esta auditoría, pero es un buen próximo paso.

### 3) Evidencia real de intentos de cobro (Sentry + Redis)

**Encontré evidencia real y concreta de un ciclo completo exitoso**, en el propio registro del cliente `spa` en Redis (no es un log que pueda desaparecer — es el estado actual):
```
"stripeCustomerId":"cus_V1hxyXrROJ3AvN"
"stripeSubscriptionId":"sub_1U1eXPBwbj79Pav2qRa0R0vh"
"stripeCheckoutSessionId":"cs_test_a1RqgMBEBlnkWMqdEtzjRLDvWFxWx6ZffKqbIncyD1kZpaFGNHLgU1cukj"
"lastPaymentAt":"2026-08-07T03:33:37.000Z"
"nextPaymentAt":"2026-08-17T03:33:37.000Z"
"paymentStatus":"trialing"
"bienvenidaEnviada":"2026-08-07T03:33:42.857Z"
"canceledAt":"2026-08-07T06:58:19.000Z"
```
El prefijo `cs_test_` confirma que fue un checkout en **modo test**. `bienvenidaEnviada` con timestamp 5 segundos después de `lastPaymentAt` confirma que `invoice.paid` disparó el webhook y el correo de bienvenida salió realmente por Resend. Hay un `canceledAt` unas horas después (mismo día) — parece un ciclo de prueba completo (crear → pagar trial → cancelar), no un cliente real actualmente en producción cobrando.

**Dos issues reales en Sentry, proyecto `jb-studio` (org `jb-studio`):**

| Issue | Descripción | Cuándo | Estado real |
|---|---|---|---|
| `NODE-A` | `No such price... test mode key was used` en `POST /api/create-checkout`, cliente `spa` | 2026-08-07 (hace 8 días), 2 ocurrencias | **Sin commit de fix encontrado en el repo** — probablemente sigue roto. Ver pasos manuales arriba. |
| `NODE-J` | `ReferenceError: authorized is not defined` en `POST /api/client-config:673`, cliente `spa` | 2026-08-11, 14 ocurrencias en 44 minutos | **Ya arreglado** — el bug se introdujo en el commit `db4185a` (10:35:52) y se corrigió 3 minutos después en `43bcaa9` (10:38:38 — "fix: scope authorized() function to top-level of client-config for portal handler"), el mismo día. `43bcaa9` ya está en el historial de HEAD/producción actual. Confirmé con `git merge-base --is-ancestor`. El código actual (`api/client-config.js:374-382`) define `authorized()` correctamente y sus 3 usos (líneas 401, 500, 547) son consistentes. Sentry sigue mostrándolo como "unresolved/escalating" porque nadie lo marcó resuelto ahí — es housekeeping, no un bug activo. |

Vercel runtime logs: el plan Hobby solo retiene 1 hora de logs, así que no pude ver actividad histórica del webhook ahí (limitación de plan, no del código). Los últimos 7 días de errores de runtime en `/api/create-checkout`, `/api/stripe-webhook` y `/api/clients` no muestran nada nuevo relacionado a Stripe (solo un warning de deprecación de Node y un 401 de Geoapify, ninguno de billing).

### 4) Lo que no pude verificar sin acción real — y qué hacer vos

- **Email de pago rechazado real**: no se puede generar sin provocar un rechazo real (tarjeta de prueba `4000000000000341` de Stripe, que simula fallo). Si querés verificarlo con confianza: en Stripe test mode, creá un cliente de prueba con esa tarjeta, dejá que falle el primer cobro, y revisá que llegue el correo de `payment_failed` (código ya revisado arriba, `lib/reservation-emails.js:251-267`).
- **Configuración exacta del dashboard** (ver punto 2 arriba) — necesito que la revises vos con los 6 pasos que dejé, o me des acceso de lectura a la API de Stripe para hacerlo yo mismo la próxima vez.
- **Si el precio mensual configurado en Stripe coincide con `PLAN_PRICES` del código** — no llegué a leer ese objeto por presupuesto de esta auditoría; queda pendiente.

### Resumen SECCIÓN 4

- ✅ confirmado: trial de 10 días sin tarjeta, webhook con 8 eventos manejados e idempotencia real, emails de Resend para pago fallido/suscripción pausada — todo con código real citado arriba, y un ciclo de prueba end-to-end exitoso documentado en Redis (checkout test-mode → trial → bienvenida enviada).
- ⚠️ necesita atención: `NODE-A` en Sentry (test/live key mismatch en `/api/create-checkout`) — sin evidencia de que esté arreglado; si un cliente real intenta pagar hoy con el plan afectado, probablemente falle. Verificar con los 6 pasos de arriba.
- ⚠️ necesita atención (housekeeping): marcar `NODE-J` como resuelto en Sentry — el código ya está arreglado desde el 2026-08-11.
- ❓ no pude verificar: configuración del dashboard de Stripe (sin acceso), email de pago rechazado real (requiere generar un rechazo real), coincidencia exacta de montos.

---

## SECCIÓN 5 — Diseño del badge de "Prueba gratuita activa"

### 1) Código actual completo (`reservas.html`)

CSS (`reservas.html:134-160`):
```
   134	    /* ── Plan status banner ── */
   135	    .plan-banner {
   136	      background: var(--card);
   137	      border: 1px solid var(--line);
   138	      border-radius: 14px;
   139	      padding: 14px 18px;
   140	      margin-bottom: 20px;
   141	      display: flex;
   142	      align-items: center;
   143	      gap: 14px;
   144	      flex-wrap: wrap;
   145	    }
   146	    .plan-banner.trial    { border-color: #c9a84c; background: #fffdf5; }
   147	    .plan-banner.paid      { border-color: #88ae99; background: #f4faf6; }
   148	    .plan-banner.inactive  { border-color: var(--line); background: var(--card); }
   149	    .plan-icon   { font-size: 22px; }
   150	    .plan-text   { flex: 1; min-width: 160px; }
   151	    .plan-title  { font-size: 14px; font-weight: 700; }
   152	    .plan-sub    { font-size: 12.5px; color: var(--muted); margin-top: 2px; }
   153	    .plan-btn {
   154	      font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
   155	      background: var(--accent); color: #fff; border: none; border-radius: 8px;
   156	      padding: 9px 15px; text-decoration: none; display: inline-block;
   157	    }
   158	    .plan-btn:hover { background: var(--accent-dark); }
   159	    .plan-btn.ghost { background: transparent; color: var(--muted); border: 1px solid var(--line); }
   160	    .plan-btn.ghost:hover { border-color: #cfc9bb; color: var(--ink); }
```

HTML (`reservas.html:201-208`):
```
   201	    <div id="plan-banner" class="plan-banner inactive" style="display:none">
   202	      <span class="plan-icon" id="plan-icon">🟡</span>
   203	      <div class="plan-text">
   204	        <div class="plan-title" id="plan-title">—</div>
   205	        <div class="plan-sub"   id="plan-sub">—</div>
   206	      </div>
   207	      <span id="portal-btn-wrap"></span>
   208	    </div>
   209	    <div class="wrap">
```

Lógica JS (`reservas.html:430-459`, hay una copia casi idéntica en 845-888):
```
   439	    var s = d;
   440	    var isTrialing = s.trial_end && s.paymentStatus !== 'paid' && s.paymentStatus !== 'failed' && s.paymentStatus !== 'cancelled';
   441	    var trialDaysLeft = 0;
   442	    if (s.trial_end) {
   443	      trialDaysLeft = Math.ceil((new Date(s.trial_end) - Date.now()) / 86400000);
   444	    }
   445	
   446	    if (isTrialing && trialDaysLeft > 0) {
   447	      banner.className = 'plan-banner trial';
   448	      icon.textContent = '⏳';
   449	      title.textContent = tr('planTrialActive');
   450	      var daysLeftText = trialDaysLeft === 1
   451	        ? (panelLanguage === 'en' ? '1 day of free trial remaining' : 'Queda 1 día de prueba gratuita')
   452	        : (panelLanguage === 'en' ? trialDaysLeft + ' days of free trial remaining' : 'Quedan ' + trialDaysLeft + ' días de prueba gratuita');
   453	      sub.textContent = daysLeftText;
```

### 2) Documentación del diseño actual

- **Un solo color** para TODO el rango del trial: `border-color: #c9a84c` (dorado/mostaza) + fondo `#fffdf5` (crema), sin importar si faltan 10 días o 1. Ícono fijo `⏳`.
- Jerarquía: ícono (22px) + título en negrita (14px) + subtítulo gris (12.5px) + botón opcional a la derecha. Todo en una fila flexible que envuelve en pantallas chicas (`flex-wrap: wrap`).
- El botón "Gestionar suscripción" (`.plan-btn`) solo aparece si el cliente ya tiene `stripeCustomerId` — si el trial es sin tarjeta y todavía no se conectó, no hay CTA visible en el banner.
- Nada de animación ni transición — es estático.

### 3) Propuesta de rediseño (texto/mockup — NADA implementado)

**Opción A — Semáforo de urgencia por color de borde/fondo (mínimo cambio, mismo layout)**

```
┌──────────────────────────────────────────────────────────┐
│ ⏳  Prueba gratuita activa                                 │
│     Quedan 8 días de prueba gratuita        [Gestionar →]  │
└──────────────────────────────────────────────────────────┘
  borde/fondo VERDE (#4a9d6f / #f0faf4) — más de 5 días

┌──────────────────────────────────────────────────────────┐
│ ⚠️  Prueba gratuita activa                                 │
│     Quedan 3 días de prueba gratuita        [Gestionar →]  │
└──────────────────────────────────────────────────────────┘
  borde/fondo ÁMBAR (#d9a441 / #fffaf0) — 5 a 2 días, ícono cambia a ⚠️

┌──────────────────────────────────────────────────────────┐
│ 🔴  Prueba gratuita activa                                 │
│     ¡Queda 1 día! Agrega tu tarjeta hoy     [Gestionar →]  │
└──────────────────────────────────────────────────────────┘
  borde/fondo ROJO (#d64545 / #fff2f0) — 1 día o menos, copy más urgente, ícono 🔴, título en rojo
```
Sencillo de implementar sobre el código actual: agregar 2 clases nuevas (`.plan-banner.trial-warning`, `.plan-banner.trial-urgent`) y una condición extra sobre `trialDaysLeft` en el JS que ya existe.

**Opción B — Barra de progreso visual + color (más informativo)**

```
┌──────────────────────────────────────────────────────────┐
│ ⏳ Prueba gratuita — 8 de 10 días                          │
│ ████████████████████░░░░  quedan 8 días      [Gestionar →]│
└──────────────────────────────────────────────────────────┘
```
Agrega una barrita de progreso (ancho = días transcurridos / 10) debajo del título, coloreada con el mismo semáforo de la Opción A. Comunica "cuánto llevás" además de "cuánto falta" — más contexto, pero más trabajo de layout (necesita conocer `trialStartedAt`, que ya está guardado en el cliente).

**Opción C — Tipografía + jerarquía reforzada, sin tocar el layout de 1 fila**

```
┌──────────────────────────────────────────────────────────┐
│  ⏳                                                        │
│  PRUEBA GRATUITA · 8 DÍAS RESTANTES         [Gestionar →]  │
│  (eyebrow uppercase 11px, letter-spacing, color según      │
│   urgencia — el número de días es lo primero que se lee,   │
│   no lo último)                                             │
└──────────────────────────────────────────────────────────┘
```
En vez de "Prueba gratuita activa" / "Quedan 8 días..." como título+subtítulo, invierte la jerarquía: el número de días pasa a ser lo más grande/visible (ej. "8" en 20px bold + "días restantes" en 11px al lado), porque es el dato que el dueño realmente necesita ver de un vistazo. Mismo semáforo de color que la Opción A aplicado al número.

**Recomendación**: Opción A es la que más directamente responde a lo que pediste (colores que cambien según urgencia) con el menor cambio de código — reutiliza el layout y la lógica existente, solo agrega el cálculo de umbral y 2 clases CSS nuevas. B y C son mejoras de comunicación más ambiciosas para una iteración posterior.

### Resumen SECCIÓN 5

- ✅ confirmado: código actual documentado completo (CSS + HTML + JS con `cat -n`), un solo color estático sin importar la urgencia.
- ✅ confirmado: 3 propuestas de rediseño entregadas en texto, ninguna implementada, como se pidió.
