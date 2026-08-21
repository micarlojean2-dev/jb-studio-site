# Ciclo de vida de un pago — jb-studio-site

> Código real citado con rutas y números de línea. No resumido de memoria.

---

## 1. Cliente nuevo sin tarjeta — chatbot inactivo

### Qué existe en Redis

Cuando se crea un cliente nuevo via `POST /api/clients` (admin.html o el wizard), Redis recibe:

```
client:live-test-fallo
  active:             false
  paymentStatus:      "awaiting_checkout"
  stripeCustomerId:   null
  stripeSubscriptionId: null
  trialEnabled:       false
```

El campo `active: false` es la causa raíz de la inactividad del chatbot.

### Por qué el chatbot no funciona

El widget.js consulta `GET /api/client-config?id=...` y recibe `active: false`. El gate de activación en widget.js (`active !== false`) produce `false`, y el widget no se renderiza.

No hay Checkout Session todavía — el cliente necesita pasar por el panel del dueño (`reservas.html`) para llegar al paywall.

---

## 2. Cliente entra al panel y completa checkout — trial de 10 días

### Flujo hasta Stripe Checkout

El panel del dueño (`reservas.html`) llama a `loadPlanStatus()` al cargar, que ejecuta:

```javascript
// reservas.html:1115
fetch('/api/client-config?clientId=' + encodeURIComponent(window.clientId) + '&token=' + encodeURIComponent(window.panelToken))
```

El endpoint `GET /api/client-config` con `__scope=status` (status handler en `client-config.js:493`) no tiene `checkoutUrl` todavía — el cliente aún no fue a checkout. El banner del panel muestra "Sin suscripción activa" (línea 630) y llama `showPaywall(s.checkoutUrl)` en la línea 633 si existe `checkoutUrl`. Como no existe, el paywall no se muestra aún.

El cliente hace click en el botón "Contratar ahora" del panel (que usa `POST /api/create-checkout`), que crea una Stripe Checkout Session con `trial_period_days: 10`:

```javascript
// api/create-checkout.js:68-78
const session = await stripe.checkout.sessions.create({
  mode:                 'subscription',
  payment_method_types: ['card'],
  payment_method_collection: 'always',
  line_items:           [{ price: priceId, quantity: 1 }],
  client_reference_id:  clientId,
  customer_email:       client.ownerEmail || undefined,      // línea 74
  metadata:             { clientId },
  subscription_data:    { metadata: { clientId }, trial_period_days: 10 },  // línea 76
  success_url: `https://jbstudio.app/success?client=${encodeURIComponent(clientId)}`,
  cancel_url:  'https://jbstudio.app/cancel',
});
```

El `customer_email: client.ownerEmail` (línea 74) asegura que Stripe use ese email en el Customer de Stripe.

El Checkout Session URL se devuelve al frontend y el navegador del cliente va a `checkout.stripe.com`.

### Qué cambia en Redis cuando Stripe confirma el pago inicial

Stripe procesa el pago de prueba/tarjeta y dispara `checkout.session.completed`. El webhook `api/stripe-webhook.js:222-248` lo maneja:

```javascript
// api/stripe-webhook.js:222-248
case 'checkout.session.completed': {
  const session = event.data.object;
  if (session.mode !== 'subscription') break;
  const clientId = session.metadata?.clientId || session.client_reference_id;
  if (!clientId) { console.warn('[stripe-webhook] checkout.session.completed: no clientId'); break; }

  const patch = {
    stripeCustomerId:        session.customer || null,
    stripeSubscriptionId:    session.subscription || session.parent?.subscription_details?.subscription || null,
    stripeCheckoutSessionId: session.id,
  };

  if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
    patch.active            = true;
    patch.paymentStatus     = 'paid';
    patch.paymentFailed     = false;
    patch.gracePeriodEndsAt = null;
  }

  await updateClient(clientId, patch);
  console.log(`[stripe-webhook] Client ${clientId} checkout completed (payment_status=${session.payment_status})`);
  break;
}
```

Redis queda con:

```
client:live-test-fallo
  active:             true
  paymentStatus:      "paid"
  stripeCustomerId:    "cus_..."
  stripeSubscriptionId: "sub_..."
  trial_end:          "1788123402"        (Unix timestamp ~10 días)
  trialEnabled:       true
  trialDays:          10
```

### Por qué el chatbot se activa

`active: true` en Redis → `GET /api/client-config?id=live-test-fallo` devuelve `active: true` → widget.js renderiza el chatbot.

---

## 3. Día 11 — Cobro exitoso

Stripe intenta cobrar $65 el día que termina el trial. El evento `invoice.paid` llega al webhook:

```javascript
// api/stripe-webhook.js:251-294
case 'invoice.paid': {
  const invoice = event.data.object;
  const subscriptionId = getInvoiceSubscriptionId(invoice);
  const clientId = getInvoiceClientId(invoice) || await getClientIdFromSubscription(subscriptionId);
  if (!clientId) { console.warn('[stripe-webhook] invoice.paid: no clientId'); break; }

  const periodEnd = invoice.lines?.data?.[0]?.period?.end || null;
  const paidUntil = isoDate(periodEnd);

  const patch = {
    active:                true,
    paymentStatus:         'paid',
    paymentFailed:         false,
    stripeCustomerId:       invoice.customer,
    stripeSubscriptionId:  subscriptionId,
    lastPaymentAt:         isoDate(invoice.status_transitions?.paid_at) || new Date().toISOString().slice(0, 10),
    nextPaymentAt:         paidUntil,
    paidUntil,
    gracePeriodEndsAt:     null,
  };

  // Si la suscripción tiene trial_end, se sincroniza con Redis
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    if (sub.trial_end) patch.trial_end = String(sub.trial_end);
  } catch (_) {}

  await updateClient(clientId, patch);

  // Bienvenida solo la primera vez (no en renovaciones)
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

Redis queda con `paymentStatus: "paid"`, `active: true`, `paidUntil` actualizado.

El gate de seguridad en `client-config.js:90-94` sigue devolviendo `active: true`:

```javascript
// api/client-config.js:90-94
active: (
  subscriptionStatus === 'active' ||
  subscriptionStatus === 'trialing' ||
  client.paymentStatus === 'paid'
),
```

---

## 4. Día 11 — Cobro falla (sin método de pago)

Cuando el trial termina sin payment method, Stripe intenta cobrar y falla. Esto genera dos eventos webhook en cascada (el orden puede variar):

### 4a. `invoice.payment_failed`

```javascript
// api/stripe-webhook.js:296-323
case 'invoice.payment_failed': {
  const invoice = event.data.object;
  const subscriptionId = getInvoiceSubscriptionId(invoice);
  const clientId = getInvoiceClientId(invoice) || await getClientIdFromSubscription(subscriptionId);
  if (!clientId) { console.warn('[stripe-webhook] payment_failed: no clientId'); break; }

  const gracePeriodEndsAt = isoDate(invoice.next_payment_attempt);
  await updateClient(clientId, {
    paymentStatus:      'past_due',
    paymentFailed:      true,
    lastPaymentFailedAt: new Date().toISOString().slice(0, 10),
    gracePeriodEndsAt,
  });
  // Email de alerta al dueño
  if (clientData?.ownerEmail) {
    await sendBillingAlertEmail(clientData, 'payment_failed', { clientId, gracePeriodEndsAt });
  }
  break;
}
```

### 4b. `customer.subscription.updated` (status: `paused`)

Stripe configura `trial_settings.end_behavior.missing_payment_method: "pause"` en cada suscripción, por lo que ante un payment method ausente la suscripción pasa a `paused`:

```javascript
// api/stripe-webhook.js:329-390
case 'customer.subscription.updated': {
  const sub = event.data.object;
  const clientId = sub.metadata?.clientId;
  if (!clientId) break;

  if (sub.status === 'active' || sub.status === 'trialing') {
    patch.active            = true;
    patch.paymentStatus     = 'paid';
    patch.paymentFailed     = false;
    patch.gracePeriodEndsAt = null;
    patch.trial_end         = sub.trial_end ? String(sub.trial_end) : null;
  } else if (sub.status === 'past_due') {
    patch.active        = true;  // ¡período de gracia — sigue activo!
    patch.paymentStatus = 'past_due';
    patch.paymentFailed = true;
  } else if (sub.status === 'unpaid') {
    patch.active        = false;  // reintentos agotados
    patch.paymentStatus = 'failed';
    patch.paymentFailed = true;
  } else if (sub.status === 'canceled') {
    patch.active        = false;
    patch.paymentStatus = 'cancelled';
  } else if (sub.status === 'paused') {
    patch.active        = false;  // ← esto es lo que ocurre con missing_payment_method: pause
    patch.paymentStatus = 'paused';
    patch.paymentFailed = false;
  }

  await updateClient(clientId, patch);

  // Email si se pausó/canceló
  if (sub.status === 'unpaid' || sub.status === 'canceled' || sub.status === 'paused') {
    if (clientData?.ownerEmail) {
      await sendBillingAlertEmail(clientData, 'subscription_paused', { clientId });
    }
  }
  break;
}
```

También existe el handler dedicado:

```javascript
// api/stripe-webhook.js:418-429
case 'customer.subscription.paused': {
  const sub = event.data.object;
  const clientId = sub.metadata?.clientId;
  await updateClient(clientId, {
    active:        false,
    paymentStatus: 'paused',
    paymentFailed: false,
  });
  break;
}
```

Redis queda con:
```
client:live-test-fallo
  active:             false
  paymentStatus:      "paused"
  paymentFailed:      false
  gracePeriodEndsAt:  null    (paused no tiene grace period)
```

### 4c. El gate de seguridad: por qué el chatbot no se escapa

El gate en `client-config.js:90-94` es la segunda línea de defensa cuando Redis tiene `active: true` pero la suscripción real está en mal estado:

```javascript
// api/client-config.js:49-56 — llamada real a Stripe
let subscriptionStatus = null;
if (client.stripeSubscriptionId) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sub = await stripe.subscriptions.retrieve(client.stripeSubscriptionId);
  subscriptionStatus = sub.status;
}

// api/client-config.js:90-94 — el gate
active: (
  subscriptionStatus === 'active' ||
  subscriptionStatus === 'trialing' ||
  client.paymentStatus === 'paid'
),
```

**Escenario protegido**: es posible que `invoice.payment_failed` no haya llegado por webhook al endpoint `stripe-webhook.js` — el campo `webhook: null` en el objeto Event de Stripe no es una señal confiable del estado real de entrega. Para verificar de forma fiable, se debe revisar el log real en **Dashboard → Developers → Webhooks → [endpoint] → Eventos**, buscando el evento `evt_1U6elCBwbj79Pav2fcfnZu2W`. Si el webhook no llegó, Redis puede haber quedado con `active: true` y `paymentStatus: 'past_due'`. En ese caso, el gate de seguridad en `client-config.js` consulta a Stripe directamente y bloquea el chatbot correctamente:

- `subscriptionStatus === 'active'` → `false` (es `past_due`)
- `subscriptionStatus === 'trialing'` → `false`
- `client.paymentStatus === 'paid'` → `false` (es `past_due`)

Resultado: `active = false` en la respuesta pública aunque Redis diga lo contrario. **No fue una falla de seguridad** — el gate funcionó como corresponde. Lo que sí pudo haber fallado es la sincronización de Redis (el banner del panel, por ejemplo, podría no haberse actualizado), pero el chatbot quedó bloqueado en todo momento.

---

## 5. Panel del dueño — cómo decide mostrar el paywall

`renderPlanBannerFromData(s)` en `reservas.html:547` es la función que decide qué banner mostrar. Analiza el objeto `s` que viene del endpoint de status:

```javascript
// reservas.html:558
var isTrialing = s.trial_end && s.paymentStatus !== 'paid' && s.paymentStatus !== 'failed' && s.paymentStatus !== 'cancelled';
```

**Trial activo** (línea 564): si `isTrialing && trialDaysLeft > 0` → banner verde "Tu prueba gratuita está activa".

**Suscripción pagada** (línea 612):
```javascript
} else if (s.paymentStatus === 'paid' || (s.active && s.subscriptionStatus === 'active')) {
```
→ banner con "Suscripción activa" + botón "Gestionar suscripción".

**Sin suscripción** (línea 626 — el `else`):
```javascript
} else {
  banner.className = 'plan-banner inactive';
  icon.textContent = 'ℹ️';
  title.textContent = tr('planInactive');           // "Sin suscripción activa"
  sub.textContent = panelLanguage === 'en'
    ? 'No active subscription'
    : 'Sin suscripción activa';
  btnWrap.innerHTML = '';
  if (s.checkoutUrl) showPaywall(s.checkoutUrl);   // línea 633 — abre el modal
}
```

El `checkoutUrl` viene del status handler en `client-config.js:540-576`: primero intenta reutilizar la Checkout Session existente si está `open`, y si no la crea nueva con `customer_email: client.ownerEmail`.

---

## 6. Correos nativos de Stripe

### Qué dispara Stripe automáticamente (sin código nuestro)

| Evento | Correo que Stripe envía |
|---|---|
| Checkout completado (pago exitoso) | **Receipt** — enviado al `customer_email` del Customer en Stripe |
| Trial terminando (7 días antes) | **`trial_will_end`** — email automático de Stripe al customer (configurado en Stripe Dashboard → Configuración → Facturación → Emails → "Enviar un recordatorio 7 días antes de la finalización de la prueba") |
| Pago exitoso (renovación mensual) | **Invoice/Receipt** — al customer_email |
| Pago fallido | **Payment failed** — Stripe reintenta varios días y envía recordatorios |
| Soscription pausada | **Subscription paused** — al customer_email |

### Configuración en el Dashboard de Stripe

Estos correos son **nativos de Stripe** — se configuran en:

**Dashboard → Customers → [customer] → Emails** — o globalmente en:
**Dashboard → Settings → Billing → Customer communications**

Allí se activa/desactiva:
- Receipts
- Payment failed notifications
- Subscription updates (paused/canceled)

El email exacto que reciben depende de la configuración del Dashboard, no del código.

### Qué controla nuestro código

Nuestro código solo controla el email de bienvenida (`sendWelcome`) y los emails de alerta de billing (`sendBillingAlertEmail`) disparados desde el webhook — estos van por Resend, no por Stripe.

---

## Resumen del flujo completo

```
Cliente creado → active: false, paymentStatus: "awaiting_checkout"
    ↓
Checkout en Stripe (trial 10 días, missing_payment_method: pause)
    ↓
checkout.session.completed → active: true, paymentStatus: "paid" (Redis)
    ↓
Día 11 — Stripe cobra $65
    ├── ÉXITO → invoice.paid → active: true, paymentStatus: "paid"
    └── FALLO → invoice.payment_failed + subscription.paused
                  → active: false, paymentStatus: "paused"
                  → Gate de security: subscriptionStatus consultada en Stripe
                    → past_due/paused/canceled → active: false (público)
```
