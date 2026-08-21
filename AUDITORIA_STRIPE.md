# AUDITORÍA STRIPE / PAGOS — JB Studio

Fecha: 2026-08-20
Alcance: todo el código relacionado con Stripe, pagos, trials, suscripciones y billing del proyecto jb-studio-site.
Versión deployada: 8de8c99 (2026-08-20, browser language detection)

---

## 1. HALLAZGO CRÍTICO PREVIO A CUALQUIER ANÁLISIS

### Los 2 businesses reales están en TEST MODE — NUNCA cobraron

**FOODLY (cus_V6Z8AmArPou7m4 en Redis):**
- Redis: active=true, paymentStatus=paid, stripeCustomerId=cus_V6Z8AmArPou7m4, stripeSubscriptionId=null
- TEST Stripe: customer existe, name="Foodly Contact", email=contacto@foodly.com
  - 1 suscripción: sub_1U6M0UBwbj79Pav2PD2HkV4r — Status: TRIALING — Trial ends: 2026-08-30T02:47:04
  - Price: price_1TtgGUBwbj79Pav2Vmh1q8iM (PRO plan)
- LIVE Stripe: 2 customers "Foodly" (cus_V6TKHuY5kR1Hh0, cus_V6TGzr5RXmuyER) — NINGUNO tiene suscripción

**SPA (cus_V1hxyXrROJ3AvN en Redis):**
- Redis: active=false, paymentStatus=cancelled, stripeCustomerId=cus_V1hxyXrROJ3AvN, stripeSubscriptionId=null
- TEST Stripe: customer existe, name="juan", email=mikestandlyjeanbaptiste@gmail.com — 0 suscripciones
- LIVE Stripe: NO EXISTE ningún customer de spa

### Conclusión devastadora

1. foodly: chatbot PUBLICO basándose en Redis, pero la suscripción real está en TEST MODE. Nadie pagó nunca.
2. spa: chatbot CANCELADO, sin ningún registro de pago en ningún modo. Nunca tuvo suscripción real.

---

## 2. LISTA COMPLETA DE ARCHIVOS

| Archivo | Líneas | En producción? |
|---------|--------|---------------|
| api/stripe-webhook.js | 488 | SÍ |
| api/client-config.js | 738 | SÍ |
| api/clients.js | 1056 | SÍ |
| api/trial-expiry-fallback.js | ~120 | SÍ |
| api/create-checkout.js | 91 | SÍ |
| lib/reservation-emails.js | ~400 | SÍ |
| scripts/setup-stripe.mjs | ~300 | HERRAMIENTA |
| scripts/test-*.mjs | varias | TEST/DEBUG |
| test/stripe-webhook-*.test.mjs | varias | TEST |
| test/*billing*.test.mjs | varias | TEST |

---

## 3. ANÁLISIS POR ARCHIVO (PRODUCCIÓN)

### api/stripe-webhook.js — PRIMARIO, PRODUCCIÓN

8 eventos que procesa:
1. checkout.session.completed (l222-248) — guarda stripeCustomerId, stripeSubscriptionId; si payment_status=paid -> active=true
2. invoice.paid (l251-304) — active=true, paymentStatus=paid, paymentFailed=false + timestamps
3. invoice.payment_failed (l307-326) — paymentStatus=past_due, paymentFailed=true, gracePeriodEndsAt
4. customer.subscription.updated (l329-415) — state machine completa
5. customer.subscription.deleted (l418-425) — active=false, paymentStatus=cancelled
6. customer.subscription.paused (l419-429) — active=false, paymentStatus=paused
7. customer.subscription.resumed (l431-443) — CÓDIGO MUERTO
8. customer.subscription.trial_will_end (l448-488) — actualiza trial_end

Código muerto exacto:
- l431-443: handler customer.subscription.resumed — sin flujo de resumption en el producto
- l238-243: rama if (session.payment_status === 'paid') dentro de checkout.session.completed — checkout siempre usa trial; esta rama nunca se ejecuta

Bug corregido: KV_REST_API_URL/TOKEN -> UPSTASH_REDIS_REST_URL/TOKEN.

Idempotencia: SET stripe_event:{id} NX con TTL 30 días. Correcto.

---

### api/client-config.js — PRIMARIO, PRODUCCIÓN

738 líneas.

1. GET /api/client-config (público) — l50-58
   active = subscriptionStatus (live) || paymentStatus==='paid'
   PROBLEMA: rate limit — 1 llamada a Stripe por request público.

2. GET ?__scope=status (admin) — l489-606
   Devuelve estado completo + checkoutUrl si no hay suscripción activa.

3. POST ?__scope=portal (admin) — l608-646
   stripe.billingPortal.sessions.create(customer: stripeCustomerId)
   El 500 para foodly NO es por stripeSubscriptionId=null — es porque el customer en live no tiene suscripción.

4. GET/PUT ?__scope=reservations (admin) — l648-665
   Billing fields readonly.

DEBUG SCOPES a ELIMINAR (l675-735):
- l675-684: test-billing-email — envía email a cualquier email con token hardcodeado
- l686-722: init-test-client — crea cliente restaurante-e2e-intenso en Redis
- l724-735: set-owner-email — modifica ownerEmail y active de spa

---

### api/clients.js — PRIMARIO, PRODUCCIÓN

POST (l629-915): Crea stripeCustomer -> checkoutSession (trial 10 días) -> paymentStatus=awaiting_checkout

connect_stripe_trial (l540-621): Para spa, barberia-el-corte-fino, restaurante-e2e-intenso. Crea customer + checkout trial.

BUG (l855 vs l912): client se construye con active:true (l855) pero se sobreescribe a false (l912). Confuso pero funcional.

---

### api/trial-expiry-fallback.js — PRIMARIO, PRODUCCIÓN

Cron cada 15 min. Si trialEnabled=true, active=true, paymentStatus!=paid, trial_end < ahora -> pausa.

---

### api/create-checkout.js — PRIMARIO, PRODUCCIÓN

Si ya tiene suscripción activa -> redirect al portal. Si no -> crear checkout con trial 10 días.

---

### lib/reservation-emails.js — PRODUCCIÓN

sendBillingAlertEmail(client, type, extra) para payment_failed, subscription_paused, trial_ending_soon.

---

## 4. DUPLICACIÓN DE LÓGICA

### 4.1 Múltiples lugares que deciden active

stripe-webhook.js invoice.paid -> true (fuente)
stripe-webhook.js subscription.updated -> sub.status===active/trialing
stripe-webhook.js subscription.deleted/paused -> false (fuente)
trial-expiry-fallback.js -> active=true && trial_expired && !paid -> false
client-config.js público (l90-94) -> subscriptionStatus (live) || paymentStatus==paid
client-status -> client.active || false

### 4.2 paymentStatus escrito en 3 lugares

stripe-webhook.js (8 eventos)
clients.js (POST: awaiting_checkout/trialing; connect_stripe_trial: trialing)
trial-expiry-fallback.js (paused)

### 4.3 subscriptionStatus vs paymentStatus

subscriptionStatus viene de Stripe API live y NUNCA se persiste en Redis. Si Stripe down -> subscriptionStatus=null -> cae a paymentStatus de Redis.

### 4.4 trial_end escrito en 3 lugares

stripe-webhook.js: invoice.paid (l275), subscription.updated (l356), trial_will_end (l453)
trial-expiry-fallback.js: solo LEE

---

## 5. INCONSISTENCIAS DE DATOS

### 5.1 Campos en Redis

active, paymentStatus, paymentFailed, gracePeriodEndsAt, trial_end, trialEnabled, trialDays, paidUntil, lastPaymentAt, nextPaymentAt, cancelAtPeriodEnd, cancelledAt, bienvenidaEnviada

### 5.2 Redundancias detectadas

- paymentFailed vs paymentStatus=past_due: REDUNDANTE — eliminar y derivar
- gracePeriodEndsAt vs nextPaymentAt: REDUNDANTE en la práctica — unificar
- lastPaymentAt vs paidUntil: podrían unificarse

### 5.3 paymentStatus valores

El código soporta 8 valores pero el negocio solo necesita 3: trialing, paid, paused

---

## 6. PLAN DE SIMPLIFICACIÓN

### PRIORIDAD 0 — RESOLVER FOODLY PRIMERO (antes que cualquier cosa)

foodly tiene suscripción TRIAL en TEST MODE — NUNCA cobró dinero real.
El chatbot está activo por Redis, no por una suscripción real.

Acciones necesarias:
1. Crear customer y suscripción REAL en LIVE Stripe para foodly
2. Actualizar Redis: stripeCustomerId=LIVE_ID, stripeSubscriptionId=LIVE_SUB_ID
3. Verificar que STRIPE_SECRET_KEY en Vercel es la live key correcta

### PRIORIDAD 1 — Eliminar código muerto (sin riesgo, sin cambio de comportamiento)

1. stripe-webhook.js l431-443: case customer.subscription.resumed — eliminar handler completo (6 líneas)
2. stripe-webhook.js l238-243: rama if (session.payment_status === 'paid') — eliminar (nunca se ejecuta)
3. client-config.js l675-735: Los 3 debug scopes — eliminar los 3 handlers completos

### PRIORIDAD 2 — Reducir duplicación (riesgo bajo, benefit medio)

4. Eliminar paymentFailed — es redundante con paymentStatus=past_due. Derivar: const paymentFailed = paymentStatus === 'past_due'
5. Unificar gracePeriodEndsAt / nextPaymentAt — pick gracePeriodEndsAt (más preciso para retry)
6. Unificar lastPaymentAt / paidUntil — pick paidUntil (más útil para el cliente)

### PRIORIDAD 3 — Reducir calls a Stripe en cada request

7. Cachear subscriptionStatus en Redis (TTL 5 min) en lugar de llamar Stripe en cada GET /api/client-config

### PRIORIDAD 4 — Fix portal foodly

8. Una vez foodly tenga suscripción real en live Stripe, el portal debería funcionar automáticamente

---

## 7. NO TOCAR (sin investigación adicional)

- El flujo trial 10 días -> invoice.paid -> active: funcional, no cambiar
- La idempotencia del webhook: correcta
- El cron de trial-expiry-fallback: necesario como backup
- trialDays: SÍ se usa (reservas.html:559-590) — no eliminar
- Los scripts de test: no afectan producción
