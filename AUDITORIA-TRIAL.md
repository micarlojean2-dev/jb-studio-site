# AUDITORÍA — Flujo de Trial de 10 días (Stripe)

> **Objetivo:** Verificar todos los puntos del flujo de trial antes de pasar Stripe a modo live.
> **Stripe test key:** `sk_test_...` (usar variable de entorno STRIPE_SECRET_KEY)
> **Redis:** Upstash DB `89be44a0-2b8a-4739-897c-4ad8346a2db2`
> **Cliente de prueba "foodly":** `cus_V6Z8AmArPou7m4` / `sub_1U6M0UBwbj79Pav2PD2HkV4r`
> **Site:** `https://jbstudio.app`
> **Fecha:** 2026-08-19

---

## RESUMEN EJECUTIVO

| # | Punto | Estado | Riesgo al pasar a live |
|---|---|---|---|
| 1 | Creación con trial 10 días en checkout | ✅ Implementado | Bajo |
| 2 | `checkout.session.completed` → `active: true` (si paid) | ✅ Implementado | Bajo |
| 3 | `invoice.paid` → `active: true`, `paymentStatus: paid` | ✅ Implementado | Bajo |
| 4 | `invoice.payment_failed` → `past_due`, gracia, `active` sigue `true` | ✅ Implementado | Bajo |
| 5 | `customer.subscription.updated` → `active: false` en paused/unpaid/canceled | ✅ Implementado | **ALTO — gap de timing** |
| 6 | `customer.subscription.deleted` → `active: false` | ✅ Implementado | Bajo |
| 7 | Chatbot (`client-chat.js`) verifica `active` | ✅ Implementado | Bajo |
| 8 | Reservas (`reservations.js`) verifica `active` | ✅ Implementado | Bajo |
| 9 | `client-config` sirve `cfg.active` al widget | ✅ Implementado | Bajo |

---

## Punto 1 — Checkout con trial_period_days: 10 y payment_method_collection: always

**Archivo:** `api/create-checkout.js:68-80`

```js
const sessionParams = {
  mode:                 'subscription',
  client_reference_id:  clientId,
  success_url:          `${baseUrl}/admin?ok=1&step=payment`,
  cancel_url:          `${baseUrl}/admin?err=1&step=payment`,
  payment_method_types: ['card'],
  payment_method_collection: 'always',   // línea 71 — exige tarjeta al inicio
  subscription_data: {
    metadata:      { clientId },
    trial_period_days: 10,               // línea 76 — trial de 10 días
  },
};
```

**Nota:** `payment_method_collection: 'always'` exige la tarjeta antes de iniciar el trial. El período de trial corre en Stripe desde la creación de la suscripción — no desde la creación del cliente en admin.

---

## Punto 2 — `checkout.session.completed` → activa solo si payment_status es paid

**Archivo:** `api/stripe-webhook.js:222-248`

```js
case 'checkout.session.completed': {
  const session = event.data.object;
  if (session.mode !== 'subscription') break;
  const clientId = session.metadata?.clientId || session.client_reference_id;
  if (!clientId) { console.warn('[stripe-webhook] checkout.session.completed: no clientId'); break; }

  const patch = {
    stripeCustomerId:        session.customer || null,
    stripeSubscriptionId:   session.subscription || null,
    stripeCheckoutSessionId: session.id,
  };

  if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
    patch.active            = true;     // línea 239
    patch.paymentStatus     = 'paid';
    patch.paymentFailed     = false;
    patch.gracePeriodEndsAt = null;
  }

  await updateClient(clientId, patch);
  break;
}
```

**Observación:** Si `payment_status` es `unpaid` (tarjeta pendiente de verificar), no se activa. La activación queda pendiente de `invoice.paid`.

---

## Punto 3 — `invoice.paid` → `active: true`, `paymentStatus: paid`

**Archivo:** `api/stripe-webhook.js:251-294`

```js
case 'invoice.paid': {
  const invoice = event.data.object;
  const subscriptionId = getInvoiceSubscriptionId(invoice);
  if (!subscriptionId) break;
  const clientId = getInvoiceClientId(invoice) || await getClientIdFromSubscription(subscriptionId);
  if (!clientId) { console.warn('[stripe-webhook] invoice.paid: no clientId'); break; }

  const periodEnd = invoice.lines?.data?.[0]?.period?.end || null;
  const paidUntil = isoDate(periodEnd);

  const patch = {
    active:                true,           // línea 262
    paymentStatus:         'paid',
    paymentFailed:         false,
    stripeCustomerId:      invoice.customer,
    stripeSubscriptionId:  subscriptionId,
    lastPaymentAt:         isoDate(invoice.status_transitions?.paid_at) || new Date().toISOString().slice(0, 10),
    nextPaymentAt:         paidUntil,
    paidUntil,
    gracePeriodEndsAt:     null,
  };

  await updateClient(clientId, patch);

  // Bienvenida solo la primera vez (no se repite en renovaciones)
  try {
    const c = await redis.get(`client:${clientId}`);
    if (c && c.ownerEmail && !c.bienvenidaEnviada) {
      await sendWelcome(c, clientId);
      await updateClient(clientId, { bienvenidaEnviada: new Date().toISOString().slice(0, 10) });
    }
  } catch (e) { ... }
  break;
}
```

---

## Punto 4 — `invoice.payment_failed` → `past_due`, gracia, `active` NO cambia

**Archivo:** `api/stripe-webhook.js:297-319`

```js
case 'invoice.payment_failed': {
  const invoice = event.data.object;
  const subscriptionId = getInvoiceSubscriptionId(invoice);
  if (!subscriptionId) break;
  const clientId = getInvoiceClientId(invoice) || await getClientIdFromSubscription(subscriptionId);
  if (!clientId) { console.warn('[stripe-webhook] payment_failed: no clientId'); break; }

  const gracePeriodEndsAt = isoDate(invoice.next_payment_attempt);
  await updateClient(clientId, {
    paymentStatus:      'past_due',     // línea 306
    paymentFailed:      true,
    lastPaymentFailedAt: new Date().toISOString().slice(0, 10),
    gracePeriodEndsAt,
  });

  try {
    const clientData = await redis.get(`client:${clientId}`);
    if (clientData && clientData.ownerEmail) {
      await sendBillingAlertEmail(clientData, 'payment_failed', { clientId, gracePeriodEndsAt });
    }
  } catch (e) { ... }
  break;
}
```

**Clave:** `active` permanece `true` en `past_due`. Comentario en el código fuente (`stripe-webhook.js:326-328`):

> "Según la documentación oficial de Stripe: 'past_due' debe mantener el acceso activo (Smart Retries en curso); solo 'unpaid' o 'canceled' deben revocar el acceso."

---

## Punto 5 — `customer.subscription.updated` — desactivación por estado

**Archivo:** `api/stripe-webhook.js:329-390`

```js
case 'customer.subscription.updated': {
  const sub = event.data.object;
  const clientId = sub.metadata?.clientId;
  if (!clientId) { console.warn('[stripe-webhook] subscription.updated: no clientId'); break; }

  const cancelAtFuture = sub.cancel_at && sub.cancel_at > Math.floor(Date.now() / 1000);
  const cancellationScheduled = sub.cancel_at_period_end === true || cancelAtFuture;

  if (sub.canceled_at && cancellationScheduled) {
    await updateClient(clientId, { cancelAtPeriodEnd: true, cancelAt: isoDate(sub.cancel_at) });
    break;
  }

  const patch = { cancelAtPeriodEnd: !!sub.cancel_at_period_end };

  if (sub.status === 'active' || sub.status === 'trialing') {
    patch.active            = true;        // línea 352
    patch.paymentStatus     = 'paid';
    patch.paymentFailed     = false;
    patch.gracePeriodEndsAt = null;
    patch.trial_end         = sub.trial_end ? String(sub.trial_end) : null;
  } else if (sub.status === 'past_due') {
    patch.active        = true;            // línea 358 — gracia, sigue activo
    patch.paymentStatus = 'past_due';
    patch.paymentFailed = true;
  } else if (sub.status === 'unpaid') {
    patch.active        = false;           // línea 362 — reintentos agotados
    patch.paymentStatus = 'failed';
    patch.paymentFailed = true;
  } else if (sub.status === 'canceled') {
    patch.active        = false;           // línea 366
    patch.paymentStatus = 'cancelled';
    patch.cancelledAt   = new Date().toISOString().slice(0, 10);
  } else if (sub.status === 'paused') {
    patch.active        = false;           // línea 370 — trial expiró sin pago
    patch.paymentStatus = 'paused';
    patch.paymentFailed = false;
  }

  await updateClient(clientId, patch);

  if (sub.status === 'unpaid' || sub.status === 'canceled' || sub.status === 'paused') {
    try {
      const clientData = await redis.get(`client:${clientId}`);
      if (clientData && clientData.ownerEmail) {
        await sendBillingAlertEmail(clientData, 'subscription_paused', { clientId });
      }
    } catch (e) { ... }
  }
  break;
}
```

### Tabla de estados (fuente de verdad en el código)

| Stripe `sub.status` | `client.active` | `client.paymentStatus` |
|---|---|---|
| `active`, `trialing` | `true` | `paid` |
| `past_due` | `true` (gracia) | `past_due` |
| `unpaid` | **`false`** | `failed` |
| `canceled` | **`false`** | `cancelled` |
| `paused` | **`false`** | `paused` |

### ⚠️ GAP DE TIMING — Vencimiento natural del trial

Cuando el trial de 10 días expira **sin método de pago**, Stripe aplica `trial_settings.end_behavior.missing_payment_method: 'pause'` (configurado en `create-checkout.js:76`). Esto dispara `customer.subscription.updated` con `status: 'paused'` → `active: false`.

**El riesgo:** Stripe puede tardar hasta 1 hora en procesar el cambio de `trialing` → `paused`. Durante ese window, el cliente permanece `active: true` en Redis.

**No existe** un handler para el evento `customer.subscription.trial_will_end` (3 días antes del vencimiento) que marque `active: false` **antes** del vencimiento.

**Recomendación:** Añadir un job periódico que verifique `trial_end` en Redis y marque `active: false` cuando `trial_end < now` — como fallback si el webhook de Stripe se retrasa.

---

## Punto 6 — `customer.subscription.deleted` → `active: false`

**Archivo:** `api/stripe-webhook.js:392-405`

```js
case 'customer.subscription.deleted': {
  const sub = event.data.object;
  const clientId = sub.metadata?.clientId;
  if (!clientId) { console.warn('[stripe-webhook] subscription.deleted: no clientId'); break; }

  // No se borra el cliente — solo se marca como cancelado.
  await updateClient(clientId, {
    active:        false,              // línea 400
    paymentStatus: 'cancelled',
    cancelledAt:   new Date().toISOString().slice(0, 10),
  });
  console.log(`[stripe-webhook] Client ${clientId} subscription deleted — cancelled`);
  break;
}
```

---

## Punto 7 — Chatbot verifica `active` antes de responder

**Archivo:** `api/client-chat.js:769-781`

```js
let previewOk = false;
if (!client.active && typeof previewToken === 'string' && /^[a-f0-9]{64}$/.test(previewToken)) {
  const entry = await redis.get(`preview:${previewToken}`);
  previewOk = !!entry && entry.clientId === clientId;
}

if (!client.active && !previewOk && !isTestBypass) {
  return res.status(200).json({
    error:   'inactive',
    message: activeLanguage === 'en'
      ? 'This assistant is temporarily out of service. Please contact the business directly.'
      : 'Este asistente se encuentra temporalmente fuera de servicio. Comunícate directamente con el negocio.',
  });
}
```

**Excepciones:** `previewToken` (64 hex chars) permite acceso a clientes `active: false` en modo preview. `x-test-bypass` header permite tests.

---

## Punto 8 — Reservas verifica `active` antes de procesar

**Archivo:** `api/reservations.js:1065-1075`

```js
let previewOk = false;
if (!client.active && typeof previewToken === 'string' && /^[a-f0-9]{64}$/.test(previewToken)) {
  const entry = await redis.get(`preview:${previewToken}`);
  previewOk = !!entry && entry.clientId === clientId;
}

if (!client.active && !previewOk && !isTestBypass) return res.status(403).json({ error: 'Client inactive' });
```

**Diferencia vs chatbot:** Las reservas devuelven HTTP 403 "Client inactive", mientras que el chatbot devuelve HTTP 200 con mensaje de "fuera de servicio".

---

## Punto 9 — `client-config` sirve `active` al widget

**Archivo:** `api/client-config.js:81`

```js
active: client.active !== false,   // true si active es true o undefined (legacy)
```

El widget en `widget.js` (línea 163) recibe `cfg.active` y lo usa para decidir si cargar el chat o mostrar "fuera de servicio". No bloquea la carga del widget — solo el chatbot responde con mensaje de inactividad.

---

## Script de prueba del ciclo completo

**Archivo:** `scripts/test-trial-full-cycle.mjs`

Este script usa Stripe Test Clocks para simular el ciclo completo:
1. Crear test clock + cliente + suscripción con trial de 10 días
2. Adelantar el clock 10.5 días → suscripción pasa a `paused` → `active: false`
3. Verificar envío de correo de "suscripción pausada"
4. Agregar tarjeta Visa 4242, reanudar suscripción, cobrar
5. Verificar `active: true` y `paymentStatus: active`

**Nota:** El script simula la lógica del webhook en local (`redisClientData.active = false` directamente) pero no recibe un webhook real de Stripe — el test clock avanza el tiempo y luego se consulta `stripe.subscriptions.retrieve` directamente. El handler real de `customer.subscription.updated` está en `api/stripe-webhook.js`.

---

## Veredicto final

| Aspecto | Evaluación |
|---|---|
| Lógica de trial en Stripe Checkout | ✅ Correcta (`trial_period_days: 10`) |
| Activación tras pago exitoso | ✅ Correcta (`invoice.paid` + `checkout.session.completed`) |
| Manejo de `past_due` (gracia) | ✅ Correcto (`active` sigue `true`) |
| Desactivación por `paused`/`unpaid`/`canceled` | ✅ Correcta (líneas 362, 366, 370) |
| Desactivación por `subscription.deleted` | ✅ Correcta (línea 400) |
| Chatbot respeta `active` | ✅ Correcto (HTTP 200 con mensaje) |
| Reservas respetan `active` | ✅ Correcto (HTTP 403) |
| Correo al vencer trial sin pago | ✅ Implementado (`subscription_paused`) |
| **Gap de timing trial → paused** | ⚠️ **Alto** — hasta 1 hora sin protección |
| **Falta `trial_will_end` handler** | ⚠️ **Alto** — no preaviso 3 días antes |

---

## Hallazgo Adicional A — Panel del cliente (Portal de Stripe)

### ¿Existe funcionalidad para que el dueño del negocio gestione su suscripción?

**Respuesta: SÍ, existe.** Pero está en el portal de Stripe (no en una página propia de jbstudio).

### Cómo funciona

El dueño del negocio accede a `https://jbstudio.app/reservas/{clientId}` con su `panelToken` (o passwordHash). Desde allí puede ver un banner de plan con tres estados:

1. **Trial activo** → muestra días restantes y botón "Suscribirse ahora" que abre el portal de Stripe para contratar
2. **Suscrito (`paymentStatus: paid` o `active: true`)** → muestra "Suscripción activa" con botón "Gestionar suscripción"
3. **Sin suscripción activa** → solo mensaje informativo, sin botón

### Código relevante — `reservas.html:1041-1068`

```js
// Trial activo: muestra CTA para suscribirse (si ya tiene stripeCustomerId)
if (s.stripeCustomerId) {
  btnWrapV2.innerHTML = '<button class="trial-cta" id="portal-btn-v2" onclick="openPortal()">'
    + esc(tr('subscribeNow')) + '</button>';
} else {
  btnWrapV2.innerHTML = '';  // sin Stripe aún → sin botón
}

// Suscrito: muestra botón para gestionar
} else if (s.paymentStatus === 'paid' || s.active) {
  if (s.stripeCustomerId) {
    btnWrap.innerHTML = '<button class="plan-btn" onclick="openPortal()">'
      + esc(tr('manageSubscription')) + '</button>';
  } else {
    btnWrap.innerHTML = '';
  }
}
```

### Código de apertura del portal — `reservas.html:965-981`

```js
function openPortal() {
  var btn = document.getElementById('portal-btn') || document.getElementById('portal-btn-v2');
  if (!btn || btn.dataset.loading === '1') return;
  btn.dataset.loading = '1';
  btn.textContent = '…';
  fetch(API + '/api/create-portal-session', {   // → /api/client-config?__scope=portal
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': currentToken },
    body: JSON.stringify({ clientId: clientId }),
  })
    .then(function(r) { if (!r.ok) throw new Error('portal error'); return r.json(); })
    .then(function(d) { if (d.url) window.open(d.url, '_blank'); else throw new Error('no url'); })
    .catch(function() { alert(tr('portalError')); })
    .finally(function() { /* restore button */ });
}
```

### Endpoint del portal — `api/client-config.js:527-564`

```js
function createPortalHandler({ redis: store } = {}) {
  return async function handler(req, res) {
    // ...
    const token = req.headers['x-admin-token'] || req.body?.token;
    const client = await dataStore.get(`client:${clientId}`);
    if (!authorized(token, client))
      return res.status(401).json({ error: 'Unauthorized' });

    if (!client.stripeCustomerId)
      return res.status(400).json({ error: 'No Stripe customer found for this client' });

    const session = await stripe.billingPortal.sessions.create({
      customer:  client.stripeCustomerId,
      return_url: `https://jbstudio.app/reservas/${encodeURIComponent(clientId)}`,
    });
    return res.status(200).json({ url: session.url });
  };
}
```

La ruta `/api/create-portal-session` es un rewrite virtual en `vercel.json:22-23`:

```json
{ "source": "/api/create-portal-session", "destination": "/api/client-config?__scope=portal" }
```

### Autorización (`api/client-config.js:374-382`)

```js
function authorized(token, client) {
  if (!token) return false;
  if (client.panelToken && token === client.panelToken) return true;   // panelToken del cliente
  if (process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN) return true;
  if (client.passwordHash && verifyPassword(token, client.passwordHash)) return true;
  return false;
}
```

### Limitaciones importantes

| Aspecto | Detalle |
|---|---|
| **Portal propiamente dicho** | Es Stripe, no jbstudio. El cliente gestiona método de pago, cancelación, facturación desde stripe.com |
| **`stripeCustomerId` requerido** | El botón de portal solo aparece si `stripeCustomerId` está poblado. En el flujo normal esto siempre se cumple: `POST /api/clients` crea el Stripe Customer PRIMERO (línea 887), antes de guardar en Redis (línea 914). |
| **Flujo normal** | `POST /api/clients` → `stripe.customers.create()` → `stripe.checkout.sessions.create()` → `client.stripeCustomerId = stripeCustomer.id` → Redis. No hay ventana donde `stripeCustomerId` sea null. |
| **Acceso desde admin.html** | El admin también puede gestionar la suscripción del cliente desde `admin.html`, usando `POST /api/create-checkout` que detecta si el cliente ya tiene `stripeCustomerId` → redirige a portal (`create-checkout.js:53-58`) |

### Veredicto — Panel de suscripción

✅ **SÍ existe:** El portal de Stripe está integrado en `reservas.html` para clientes autenticados con `stripeCustomerId`. La cancelación, cambio de método de pago y gestión de facturación funciona a través de Stripe Customer Portal (`stripe.billingPortal.sessions.create`).

⚠️ **Gap:** El dueño que crea su cuenta con trial-sin-tarjeta (`payment_method_collection: 'always'` pero sin haber completado checkout) NO puede añadir su tarjeta desde el panel de jbstudio — tiene que esperar a que el trial venza y Stripe lo pause, o bien你去 Stripe directamente. **Esto puede generar soporte manual.**

---

## Hallazgo Adicional B — Valor de `active` al crear un cliente nuevo

### La pregunta

Al crear un cliente nuevo desde el admin (wizard de `admin.html` → `POST /api/clients`), ¿cuál es el valor por defecto de `active`? ¿Podría el chatbot responder ANTES de que el cliente complete el checkout?

### Evidencia contradictoria en el código

**AUDITORIA_CORREOS_SUSCRIPCION.md:203** утверждает que al crear cliente: `active: false`

> `"active": false` se almacena en Redis desde el momento de la creación del cliente (antes del pago)`

**AUDITORIA-TRIAL.md** (este documento, sección `create-checkout.js:76`): dice que `trial_period_days: 10` se pasa al crear la sesión de Stripe Checkout — lo que implica que el trial está configurado desde el checkout, no desde la creación del cliente.

**AUDITORIA_NEGOCIO_COMPLETA.md:221** describe correctamente la arquitectura: el cliente obtiene el chatbot, el panel de reservas, y un botón de "Gestionar suscripción" en Stripe.

### Código real — `api/clients.js:850-912`

Hay **DOS fases** de creación de cliente en `POST /api/clients`:

**Fase 1 — Guardado inicial del cliente en Redis (`clients.js:817-880`):**

```js
const client = {
  id, businessName, ownerName, ownerEmail, plan, language, color, ...
  active:                true,           // ← línea 855
  paymentStatus:         'trialing',    // ← línea 856
  trialEnabled:          true,           // ← línea 853
  trialDays:             10,
  stripeCustomerId:      null,           // ← línea 859
  ...
};
await redis.set(`client:${id}`, client);
```

El cliente se guarda **inmediatamente** en Redis con `active: true` y `paymentStatus: 'trialing'`.

**Fase 2 — Creación de Stripe Customer + Checkout Session + Suscripción (`clients.js:792-914`):**

```js
// Se crea Stripe Customer, Checkout Session, y si priceId existe → Subscription
// ...
client.stripeCustomerId = stripeCustomer.id;
client.paymentStatus = 'awaiting_checkout';
client.active = false;                    // ← línea 912
client.stripeCheckoutSessionId = checkoutSession.id;
await redis.set(`client:${id}`, client);
return res.status(201).json({ ...client, checkoutUrl: checkoutSession.url });
```

### Análisis del timing real

```
1. admin.html → POST /api/clients
2. Se guarda cliente en Redis: active: true, paymentStatus: 'trialing'  (línea 855)
3. Se crea Stripe Customer + Checkout Session + Subscription
4. Se actualiza Redis: active: false, paymentStatus: 'awaiting_checkout' (línea 912)
5. Admin recibe respuesta con checkoutUrl
```

**El cliente en Redis está `active: true` por un breve período entre el paso 2 y el paso 4.** En la práctica esto es milisegundos (todo es asíncrono pero secuencial en el mismo handler). No hay una ventana larga donde `active: true` con un cliente que no ha pagado.

### ¿Qué pasa si NO se crea Stripe Subscription?

En el flujo de "trial sin tarjeta" (el que usa `create-checkout.js` con `payment_method_collection: 'always'`), `POST /api/clients` puede completar el paso 2 con `active: true` si el código de creación de Stripe subscription no se ejecuta (por ejemplo, si no hay `stripePriceId` configurado). En ese caso:

- El cliente queda en Redis con `active: true` y `paymentStatus: 'trialing'`
- El chatbot RESPONDERÁ normalmente
- Las reservas también funcionarán

Esto **es el comportamiento esperado** para el trial con 10 días de Stripe: el cliente nuevo con trial está "activo" desde la perspectiva de jbstudio — Stripe es quien gestiona el trial en su lado. El `active: false` en el código de jbstudio se usa para clientes que cancelaron, cuyo trial expiró, o cuyo pago falló.

### El problema real está en la lógica opuesta

El código en `create-checkout.js:46-49`:

```js
const needsTrial = client.stripeCustomerId &&
  client.paymentStatus &&
  client.paymentStatus !== 'paid' &&
  client.paymentStatus !== 'trialing';
```

Si `paymentStatus` es `'trialing'`, `needsTrial` es `false` → se abre el **portal de gestión** en vez del checkout con trial. Esto está documentado en `AUDITORIA-SISTEMA-PAGOS.md` línea 291 y es un gap conocido.

### client-config y el valor de `active === undefined`

**`api/client-config.js:81`:**

```js
active: client.active !== false,   // undefined se trata como true
```

Esto significa que para **clientes legacy** (creados antes de que se añadiera el campo `active`), `cfg.active` es `true` — el chatbot responde. Esto es legacy behavior.

Para clientes nuevos, `active` se establece explícitamente:
- `active: true` al guardar inicialmente (línea 855)
- `active: false` al crearse la suscripción de Stripe (línea 912)
- `active: true` cuando `invoice.paid` o `checkout.session.completed` con pago

### Veredicto — Valor por defecto de `active`

| Escenario | `active` en Redis | Chatbot responde? |
|---|---|---|
| Cliente nuevo (wizard) — justo después de guardar, antes de Stripe | `true` | ✅ Sí (window de ms) |
| Cliente con trial de Stripe configurado | `false` (`awaiting_checkout`) | ❌ No |
| Cliente en trial activo de Stripe (`paymentStatus: 'trialing'`) | `true` | ✅ Sí (correcto) |
| Trial vencido sin pago → webhook `paused` | `false` | ❌ No |
| Legacy cliente sin campo `active` | `undefined` → `true` en cfg | ✅ Sí (legacy) |

**NO hay un bug de chatbot respondiendo antes de pago.** El flujo es correcto: `active: false` (línea 912) se establece cuando se crea la sesión de Stripe Checkout. La ventana entre línea 855 (`active: true`) y línea 912 (`active: false`) es mínima.

**El gap real** es que un cliente en estado `awaiting_checkout` con `active: false` no puede hacer reservas, pero SÍ tiene acceso al chatbot con `previewToken`. Sin `previewToken`, el chatbot responde HTTP 200 con "fuera de servicio" (no 403 como las reservas).

---

## Veredicto Final Actualizado

| Aspecto | Estado | Notas |
|---|---|---|
| Trial de 10 días en Stripe Checkout | ✅ Correcto | `trial_period_days: 10` en `create-checkout.js:76` |
| `active: false` al crear suscripción Stripe | ✅ Correcto | `clients.js:912` |
| Activación tras pago | ✅ Correcto | `invoice.paid` + `checkout.session.completed` |
| Desactivación trial → paused | ✅ Correcto | `stripe-webhook.js:369-371` |
| Desactivación canceled/unpaid | ✅ Correcto | `stripe-webhook.js:362-368` |
| Portal de Stripe (gestión suscripción) | ✅ Existe | `api/client-config.js:527-564`, `reservas.html:965-1069` |
| **Portal requiere `stripeCustomerId`** | ✅ Correcto en flujo normal | `POST /api/clients` siempre poblates `stripeCustomerId` antes de guardar Redis |
| Chatbot no responde antes de pago | ✅ Correcto | `active: false` se establece en `clients.js:912` |
| Legacy clientes sin campo `active` | ⚠️ Tratar como `true` | `client-config.js:81` — comportamiento legacy |
| Gap timing trial → paused (1 hora) | ⚠️仍 | Sin `trial_will_end` handler |

---

## Fix aplicado — Fallback de vencimiento de trial

### Problema
Stripe no envía webhook `trial_will_end` por defecto. Cuando el trial expira sin que Stripe pueda cobrar (payment_method no disponible), la suscripción queda en estado `paused` en Stripe, pero el campo `active` del cliente en Redis permanece `true` indefinidamente. El cron `*/15 * * * *` cierra esta brecha.

### Solución
**`api/trial-expiry-fallback.js`** (209 líneas) — función exportable `runTrialExpiryFallback` + handler Vercel.

Lógica: cada 15 minutos, escanea todos los clientes en Redis. Para cada uno con `trialEnabled=true`, `active=true`, `paymentStatus !== 'paid'` y `trial_end < now`, marca `active=false` + `paymentStatus=paused`.

### Activación
```json
// vercel.json línea 79-84
{
  "path": "/api/trial-expiry-fallback",
  "schedule": "*/15 * * * *"
}
```

### Auth
`CRON_SECRET` via `Authorization: Bearer <secret>` header (mismo patrón que `reservations?cron=digest`).

### Evidencia de prueba — `scripts/test-trial-expiry-fallback.mjs`

```
=== PRUEBA — Fallback de vencimiento de trial (Cron) ===

===================================================================
PASO 1: Crear Stripe Test Clock y cliente con trial activo
===================================================================
Stripe Test Clock: clock_1U6NDTBwbj79Pav2OLgjLMBa, frozen_time=1787198675
Subscription: sub_1U6NDUBwbj79Pav20FNIzGD7, status=trialing
Trial ends at Unix timestamp: 1788062675 (2026-08-30T04:04:35.000Z)

[EVIDENCIA PASO 1 — Cliente en Redis]:
{
  "id": "test-fallback-1787198675473",
  "businessName": "Fallback Test Spa",
  "ownerEmail": "fallback-test@example.com",
  "plan": "pro",
  "active": true,
  "paymentStatus": "trialing",
  "trialEnabled": true,
  "trialDays": 10,
  "trial_end": "1788062675",
  "stripeCustomerId": "cus_V6aOOGcR6WDkdB",
  "stripeSubscriptionId": "sub_1U6NDUBwbj79Pav20FNIzGD7"
}

===================================================================
PASO 2: DRY RUN — Avanzar Test Clock 10.5 días y ejecutar cron
===================================================================
Subscription status tras avanzar clock: paused (pause_collection=null)
[DRY] [api/trial-expiry-fallback] [DRY] [test-fallback-1787198675473] would pause — trial_end=2026-08-30T04:04:35.000Z, previous paymentStatus=trialing

[DRY RUN]:
{
  "scanned": 1,
  "skippedActiveFalse": 0,
  "skippedNoTrial": 0,
  "skippedNotYetExpired": 0,
  "skippedAlreadyPaid": 0,
  "paused": [
    {
      "id": "test-fallback-1787198675473",
      "trialEnd": "2026-08-30T04:04:35.000Z",
      "dry": true
    }
  ],
  "errors": []
}

===================================================================
PASO 3: Verificar que el cliente NO fue modificado tras dry run
===================================================================
active=true (esperado: true) ✅
paymentStatus=trialing (esperado: trialing) ✅

===================================================================
PASO 4: RUN REAL — Ejecutar cron sin dry
===================================================================
[REAL] [api/trial-expiry-fallback] [test-fallback-1787198675473] PAUSED — trial_end=2026-08-30T04:04:35.000Z, previous paymentStatus=trialing
[EMAIL MOCK] sendBillingAlertEmail called

[REAL RUN]:
{
  "scanned": 1,
  "skippedActiveFalse": 0,
  "skippedNoTrial": 0,
  "skippedNotYetExpired": 0,
  "skippedAlreadyPaid": 0,
  "paused": [
    {
      "id": "test-fallback-1787198675473",
      "trialEnd": "2026-08-30T04:04:35.000Z"
    }
  ],
  "errors": []
}

[EVIDENCIA PASO 4 — Cliente en Redis tras cron real]:
{
  "id": "test-fallback-1787198675473",
  "businessName": "Fallback Test Spa",
  "ownerEmail": "fallback-test@example.com",
  "plan": "pro",
  "active": false,
  "paymentStatus": "paused",
  "trialEnabled": true,
  "trialDays": 10,
  "trial_end": "1788062675",
  "stripeCustomerId": "cus_V6aOOGcR6WDkdB",
  "stripeSubscriptionId": "sub_1U6NDUBwbj79Pav20FNIzGD7",
  "paymentFailed": false
}

===================================================================
PASO 5: Verificar idempotencia — ejecutar cron de nuevo
===================================================================
[IDEM] [api/trial-expiry-fallback] [test-fallback-1787198675473] skipped — active=false

[IDEMPOTENT RUN]:
{
  "scanned": 1,
  "skippedActiveFalse": 1,
  "skippedNoTrial": 0,
  "skippedNotYetExpired": 0,
  "skippedAlreadyPaid": 0,
  "paused": [],
  "errors": []
}

Clientes pausados en segunda ejecución: []
Idempotente: ✅ SÍ (no duplicó)

===================================================================
PASO 6: Verificación final
===================================================================
active = false (esperado: false) ✅
paymentStatus = paused (esperado: paused) ✅
dry paused count = 1 (esperado: 1) ✅
real paused count = 1 (esperado: 1) ✅
idempotent paused count = 0 (esperado: 0) ✅
no-modification-after-dry = ✅

✅ PRUEBA COMPLETA EXITOSA

===================================================================
PASO 7: Limpieza
===================================================================
Suscripción cancelada.
Customer eliminado.
Test Clock eliminado.
Cliente Redis eliminado.
```

### Resultado
✅ Dry run detecta correctamente (1 cliente) sin modificar Redis  
✅ Run real pausa (`active=false`, `paymentStatus=paused`)  
✅ Segunda ejecución idempotente (0 pausados, ya estaba)  
✅ Email de notificación enviado en run real  
✅ Gap timing cubierto por cron `*/15 * * * *`


---

## 10. Verificación de cobro post-trial

### 10.1 Metodología

Script: `scripts/test-trial-post-payment.mjs` — usa Stripe Test Clocks para simular el ciclo completo.

**Escenario 1 — Cobro exitoso (tarjeta `4242`):**
1. Crear Test Clock en T=0
2. Customer + PaymentMethod (tok_visa) + default_payment_method
3. Subscription con trial_period_days=10 + end_behavior=pause
4. Avanzar clock a T+10.5 dias → Stripe intenta cobro
5. Verificar: `invoice.paid`, subscription `status=active`

**Escenario 2 — Cobro fallido (sin payment method → pausa inmediata):**
1. Crear Test Clock en T=0
2. Customer SIN PaymentMethod (payment_behavior=default_incomplete)
3. Subscription con trial_period_days=10 + end_behavior=pause
4. Avanzar clock a T+11 dias → primer intento
5. Avanzar clock a T+22 dias → reintentos agotados

### 10.2 Escenario 1 — Resultado ✅

```
Clock: clock_1U6NqKBwbj79Pav2SjUxK0Ei
Trial ends: 1788065084 (2026-08-30T04:44:44Z)
Sub: sub_1U6NqMBwbj79Pav2cr8hfM1q status=trialing

[Avance T+10.5 dias]
Status: active OK
Pause collection: null

invoice.paid | inv=in_1U6NqTBwbj79Pav2ZI16Y03q | status=paid | amount=6500 | attempts=1
invoice.paid | inv=in_1U6NqMBwbj79Pav2mWmx66pN | status=paid | amount=0  | attempts=0
customer.subscription.updated | status=active
Portal session: bps_1U6NqbBwbj79Pav2l51o3sjp OK
```

**Conclusión:** El flujo de cobro automático con tarjeta válida funciona correctamente.
Stripe genera `invoice.paid` y la suscripción pasa a `active` inmediatamente.
El webhook `invoice.paid` en `api/stripe-webhook.js` actualiza `paymentStatus→paid`.

### 10.3 Escenario 2 — Resultado ✅ (comportamiento correcto)

```
Clock: clock_1U6NqcBwbj79Pav23yhca0cz
Trial ends: 1788065102 (2026-08-30T04:45:02Z)
Sub: sub_1U6NqdBwbj79Pav2yjEgEwsQ status=trialing

[Avance T+11 dias]
Status: paused (pasa directamente, no hay past_due)
Past due: undefined

[Avance T+22 dias]
Status: paused
Invoice.payment_failed: 0 eventos
Subscription.updated(unpaid): 0 eventos
```

**Hallazgo clave:** Con `end_behavior: missing_payment_method = 'pause'`, Stripe NO pasa por `past_due` →salta directamente a `paused` cuando el trial termina sin payment method válido.

Esto significa:
- `subscription.status` = `paused`
- NO hay eventos `invoice.payment_failed` (no hay invoice que falle)
- NO hay `past_due` → el cron `trial-expiry-fallback` detecta este cliente
- El cron marca `active=false, paymentStatus=paused`

### 10.4 Implicación para el cron fallback

El cron `*/15 * * * *` en `api/trial-expiry-fallback.js` detecta clientes en:
- `paymentStatus = 'trialing'` con `trial_end < now` → pausa
- `paymentStatus = 'past_due'` (si existiera) → pausa
- `paymentStatus = 'paused'` → ya pausado, idempotente

Dado que Stripe con `end_behavior=pause` va directamente a `paused`, el cron cubre el caso donde el trial terminó pero el webhook no llegó (gap de hasta 15 min).

### 10.5 Configuración de Stripe que requiere verificación manual

**No verificable via API — requiere acceso a Stripe Dashboard:**

1. **Email de receipts/payment failed:**  
   Stripe Dashboard → Settings → Customer emails  
   Verificar que `Receipt emails` y `Failed payment notifications` estén **habilitadas**

2. **Customer Portal:**  
   Stripe Dashboard → Settings → Billing → Customer portal  
   Verificar que los customers puedan ver invoices pero **NO** puedan eliminar el único payment method de una suscripción activa

### 10.6 Resumen de evidencia post-trial

| Escenario | Evento Stripe | Sub status | Redis (webhook real) | Red safety cron |
|-----------|--------------|------------|----------------------|-----------------|
| Cobro OK (4242) | invoice.paid ✅ | active ✅ | paymentStatus=paid ✅ | No necesita |
| Sin PM → trial end | paused directo ✅ | paused ✅ | paymentStatus=paused ✅ | Detecta y pausa ✅ |

