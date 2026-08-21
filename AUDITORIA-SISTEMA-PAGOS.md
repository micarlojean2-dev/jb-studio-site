# AUDITORÍA COMPLETA DEL SISTEMA DE PAGOS — JB STUDIO

> **Fecha**: 2026-08-19  
> **Proyecto**: jb-studio-site → https://jbstudio.app  
> **Entorno**: Vercel (Serverless Functions), Upstash Redis, Stripe Test Mode

---

## 1. INVENTARIO COMPLETO DE ARCHIVOS RELACIONADOS CON PAGOS/STRIPE

### Backend (API Routes)

| Archivo | Propósito |
|---------|-----------|
| `api/create-checkout.js` | Crea sesión Stripe Checkout (con trial 10 días) **O** abre Billing Portal si el cliente ya tiene `stripeCustomerId` |
| `api/stripe-webhook.js` | Recibe eventos de Stripe (checkout.completed, invoice.paid, invoice.payment_failed, subscription.updated/deleted/paused/resumed, trial_will_end) y actualiza cliente en Redis |
| `api/clients.js` | CRUD de clientes; crea `stripeCustomerId` + Checkout Session al crear cliente; maneja `connect_stripe_trial` (endpoint interno) |
| `api/client-config.js` | Configuración del widget por cliente (lee `paymentStatus`, `stripeCustomerId`, etc.) |
| `api/admin/health-check.js` | Health check interno; prueba conexión a Stripe (usa `sk_test_mock` si no hay secret) |

### Frontend (Admin Panel)

| Archivo | Secciones relevantes |
|---------|---------------------|
| `admin.html` | Modal "Administrar pago" (líneas ~3180-3280), botones "Generar enlace de pago" / "Regenerar enlace de pago" / "Abrir cliente en Stripe" / "Reintentar cobro" (líneas ~3891-3960, ~4803-4830), `paymentStatusInfo()` (líneas ~3291-3340), `generatePaymentLink()` (líneas ~3891-3960), `openManageModal()` (líneas ~4000-4050) |

### Páginas de resultado de pago

| Archivo | Propósito |
|---------|-----------|
| `success.html` | Página de éxito tras Checkout (muestra "Pago exitoso", redirige a panel) |
| `cancel.html` | Página de cancelación (muestra "Pago cancelado", botón "Intentar de nuevo") |

### Scripts de prueba / utilidades (no producción)

| Archivo | Propósito |
|---------|-----------|
| `scripts/setup-stripe.mjs` | Crea Price IDs en Stripe y escribe en `.env` |
| `scripts/verify-checkout-real.mjs` | Prueba manual de Checkout real |
| `scripts/test-portal-session.mjs` | Prueba Billing Portal session |
| `scripts/test-billing-emails.mjs` | Prueba envío de emails de billing |
| `scripts/test-portal-session.mjs` / `test-trial-full-cycle.mjs` / etc. | Tests de integración |

---

## 2. CÓDIGO COMPLETO DE CADA ARCHIVO CORE

---

### `api/create-checkout.js` (COMPLETO)

```javascript
import Stripe from 'stripe';
import { Redis } from '@upstash/redis';
import { initSentry, captureApiException } from '../lib/sentry.js';

initSentry();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const PRICE_IDS = {
  basic: process.env.STRIPE_PRICE_BASIC,
  pro:   process.env.STRIPE_PRICE_PRO,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  'https://jbstudio.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers['x-admin-token'];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN)
    return res.status(401).json({ error: 'Unauthorized' });

  const { clientId } = req.body || {};
  if (!clientId || !/^[a-z0-9-]+$/.test(clientId))
    return res.status(400).json({ error: 'Invalid clientId' });

  try {
    const client = await redis.get(`client:${clientId}`);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    // SI YA TIENE stripeCustomerId → abre Billing Portal (NO crea Checkout)
    if (client.stripeCustomerId) {
      const session = await stripe.billingPortal.sessions.create({
        customer: client.stripeCustomerId,
        return_url: `https://jbstudio.app/reservas/${encodeURIComponent(clientId)}`,
      });
      return res.status(200).json({ url: session.url, sessionId: session.id, type: 'portal' });
    }

    // SINO → crea Checkout Session con trial 10 días
    const priceId = PRICE_IDS[client.plan];
    if (!priceId)
      return res.status(400).json({ error: `Client plan "${client.plan}" has no Stripe price configured` });

    const session = await stripe.checkout.sessions.create({
      mode:                 'subscription',
      payment_method_types: ['card'],
      payment_method_collection: 'always',
      line_items:           [{ price: priceId, quantity: 1 }],
      client_reference_id:  clientId,
      customer_email:       client.ownerEmail || undefined,
      metadata:             { clientId },
      subscription_data:    { metadata: { clientId }, trial_period_days: 10 },
      success_url: `https://jbstudio.app/success?client=${encodeURIComponent(clientId)}`,
      cancel_url:  'https://jbstudio.app/cancel',
    });

    await redis.set(`client:${clientId}`, Object.assign({}, client, {
      stripeCheckoutSessionId: session.id,
    }));

    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[api/create-checkout]', err.message);
    captureApiException(err, { clientId, feature: 'billing', route: '/api/create-checkout' });
    return res.status(500).json({ error: err.message });
  }
}
```

---

### `api/stripe-webhook.js` (COMPLETO - ya mostrado arriba, resumido aquí)

**Eventos manejados:**
- `checkout.session.completed` → crea `stripeCustomerId`, `stripeSubscriptionId`; si `payment_status === 'paid'` marca `active=true, paymentStatus='paid'`
- `invoice.paid` → marca `paid`, `paidUntil`, envía email bienvenida (solo primera vez)
- `invoice.payment_failed` → `paymentStatus='past_due'`, `paymentFailed=true`, email alerta
- `customer.subscription.updated` → sincroniza estado (`active`, `paymentStatus`, `trial_end`, `cancelAtPeriodEnd`, `cancelAt`)
- `customer.subscription.deleted` / `paused` / `resumed` → actualiza `active`, `paymentStatus`
- `customer.subscription.trial_will_end` → aviso 3 días antes (email alerta)
- Idempotencia con `stripe_event:{eventId}` en Redis (TTL 30 días)

---

### `api/clients.js` — Secciones de pago (resumen)

**POST** (crear cliente):
- Crea `stripeCustomer` en Stripe
- Crea `checkoutSession` con `trial_period_days: 10`, `trial_settings.end_behavior.missing_payment_method: 'pause'`
- Guarda `stripeCustomerId`, `stripeCheckoutSessionId`, `paymentStatus='awaiting_checkout'`, `active=false`

**PUT** (actualizar):
- Permite actualizar `active`, `plan`, `paymentStatus`, `stripeCustomerId`, `stripeSubscriptionId`, `paidUntil`, `paymentStatus`, `paymentFailed`, `lastPaymentAt`, `nextPaymentAt`, `gracePeriodEndsAt`, `cancelAtPeriodEnd`, `cancelledAt`

**Action `connect_stripe_trial`** (endpoint interno):
- Crea Stripe Customer + Checkout/Subscription con trial para clientes de prueba

---

### `admin.html` — Modal "Administrar pago" (HTML + JS relevante)

**HTML del modal (líneas ~3180-3280):**
```html
<div id="pago-modal-overlay" class="manage-modal-overlay" style="display:none">
  <div class="manage-modal">
    <div class="manage-modal-header">
      <div class="manage-modal-title" id="pago-modal-title">Administrar pago</div>
      <button type="button" id="pago-modal-close" class="wizard-close">✕</button>
    </div>
    <div style="padding:4px 26px 0;">
      <div class="summary-row"><span>Plan</span><span id="pago-info-plan"></span></div>
      <div class="summary-row"><span>Mensualidad</span><span id="pago-info-price"></span></div>
      < <div class="summary-row"><span>Último pago</span><span id="pago-info-last"></span></div>
      <div class="summary-row"><span>Próximo pago</span><span id="pago-info-next"></span></div>
      <div class="summary-row"><span>Días restantes</span><span id="pago-info-days"></span></div>
      <div class="summary-row" id="pago-info-grace-row" style="display:none"><span>Período de gracia hasta</span><span id="pago-info-grace"></span></div>
      <div class="summary-row"><span>Estado</span><span id="pago-info-status"></span></div>
    </div>
    <div style="padding:18px 26px 24px;display:flex;flex-direction:column;gap:10px;">
      <div id="pago-generate-wrap"></div>  <!-- Aquí se inyectan los botones dinámicos -->
      <a id="pago-stripe-link" class="wizard-btn-secondary" style="display:none;text-align:center;text-decoration:none;" target="_blank" rel="noopener noreferrer">Abrir cliente en Stripe</a>
      <button type="button" id="pago-modal-cancel" class="wizard-btn-secondary">Cerrar</button>
    </div>
  </div>
</div>
```

**JS que inyecta botones (líneas ~4803-4830):**
```javascript
const needsRegenerateLink = c.stripeCustomerId &&
  c.paymentStatus &&
  c.paymentStatus !== 'paid' &&
  c.paymentStatus !== 'trialing';

const genWrap = document.getElementById('pago-generate-wrap');
genWrap.innerHTML = '';
if (failed) {
  genWrap.innerHTML = `<button ...>Reintentar cobro</button>`;
} else if (needsRegenerateLink) {
  genWrap.innerHTML = `<button ...>Regenerar enlace de pago</button>`;
} else if (!c.stripeCustomerId) {
  genWrap.innerHTML = `<button ...>Generar enlace de pago</button>`;
}
genWrap.querySelectorAll('.ct-pay-action').forEach(btn => {
  btn.addEventListener('click', () => generatePaymentLink(btn.dataset.cid, btn.dataset.plan, btn));
});

// Link "Abrir cliente en Stripe"
const stripeLink = document.getElementById('pago-stripe-link');
if (c.stripeCustomerId) {
  stripeLink.href = `https://dashboard.stripe.com/test/customers/${encodeURIComponent(c.stripeCustomerId)}`;
  stripeLink.style.display = '';
} else {
  stripeLink.style.display = 'none';
}
```

**`generatePaymentLink()` (líneas ~3891-3960):**
```javascript
async function generatePaymentLink(clientId, plan, btn) {
  const res = await fetch('/api/create-checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
    body: JSON.stringify({ clientId, plan }),
  });
  const d = await res.json();
  // Muestra box con: label, URL en caja copiable, botones "Copiar enlace" / "Abrir enlace"
}
```

**`paymentStatusInfo()` (líneas ~3291-3340):**
```javascript
function paymentStatusInfo(c) {
  if (c.paymentStatus) {
    switch (c.paymentStatus) {
      case 'cancelled': return { label: 'Cancelado', cls: 'st-red' };
      case 'failed':    return { label: 'Pago fallido', cls: 'st-red' };
      case 'past_due':  return (grace >= today) ? {label:'En período de gracia',cls:'st-yellow'} : {label:'Pago fallido',cls:'st-red'};
      case 'paid':      return { label: 'Pagado', cls: 'st-green' };
      case 'trialing':  return { label: 'En prueba', cls: 'st-yellow' };
      case 'pending':   return { label: 'Esperando pago', cls: 'st-yellow' };
      default:          return { label: 'No pagado', cls: 'st-red' };
    }
  }
  // Fallback legacy: paidUntil, paymentFailed, subscriptionEnded
}
```

---

### `success.html` (COMPLETO)

Página de éxito post-Checkout. Muestra "¡Pago exitoso!", redirige a `/reservas/{clientId}` tras 24h. Incluye Meta Pixel `fbq('track', 'Purchase', {value: 45.00, currency: 'USD'})`.

### `cancel.html` (COMPLETO)

Página de cancelación. "Pago cancelado" + botón "Intentar de nuevo" → `https://jbstudio.app`.

---

### Variables de entorno (`.env` - NO en repo)

```env
STRIPE_SECRET_KEY=sk_test_xxx           # SOLO TEST MODE
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_BASIC=price_xxx
STRIPE_PRICE_PRO=price_xxx
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxx
ADMIN_TOKEN=xxx
RESEND_API_KEY=xxx
GEOAPIFY_API_KEY=xxx
STRIPE_WEBHOOK_HEARTBEAT_URL=xxx
```

---

## 3. FLUJO EXPLICADO EN PALABRAS SIMPLES

### Botón "Generar enlace de pago" (cliente SIN `stripeCustomerId`)
1. Admin clicka → llama `POST /api/create-checkout` con `{clientId, plan}`
2. Backend: crea **Stripe Checkout Session** con `mode=subscription`, `trial_period_days=10`, `success_url=/success`, `cancel_url=/cancel`
3. Devuelve `url` → Admin ve box con URL + botones "Copiar" / "Abrir"
4. Admin copia/envía link al cliente
5. Cliente clicka → ve página Stripe Checkout → pone tarjeta → completa
6. Stripe dispara `checkout.session.completed` → webhook crea `stripeCustomerId`, `stripeSubscriptionId`, `paymentStatus='paid'`, `active=true`

### Botón "Regenerar enlace de pago" (cliente CON `stripeCustomerId` PERO `paymentStatus !== 'paid' && !== 'trialing'`)
- **Mismo flujo que arriba** — llama al MISMO endpoint `/api/create-checkout`
- **PERO** backend detecta `client.stripeCustomerId` y **en vez de Checkout, abre Billing Portal** (ver bug abajo)
- Devuelve `{type: 'portal', url: ...}` → Admin ve URL del Billing Portal (NO Checkout con trial)

### Botón "Abrir cliente en Stripe"
- Abre `https://dashboard.stripe.com/test/customers/{cus_xxx}` en nueva pestaña
- Solo sirve para que ADMIN vea al cliente en dashboard de Stripe
- **NO genera link de pago para el cliente**

### Botón "Reintentar cobro"
- Aparece si `paymentStatus === 'past_due' || 'failed'`
- Llama a `generatePaymentLink` → mismo endpoint → abre Billing Portal (si ya tiene customer)

### Webhook Stripe — flujo real de activación:
1. `checkout.session.completed` → crea customer/subscription, `paymentStatus='paid'` si `payment_status='paid'`
2. `invoice.paid` → confirma `paymentStatus='paid'`, `active=true`, `paidUntil=period_end`, envía email bienvenida (solo primera vez)
3. `invoice.payment_failed` → `paymentStatus='past_due'`, `paymentFailed=true`, email alerta
4. `customer.subscription.updated` → sincroniza estado según `sub.status` (active/trialing/past_due/unpaid/canceled/paused)
5. `customer.subscription.deleted` → `paymentStatus='cancelled'`, `active=false`

---

## 4. INCONSISTENCIAS Y PROBLEMAS DETECTADOS

### 🔴 CRÍTICO: "Regenerar enlace" usa Billing Portal en vez de Checkout con trial

**En `api/create-checkout.js` líneas 43-50:**
```javascript
if (client.stripeCustomerId) {
  const session = await stripe.billingPortal.sessions.create({...});
  return res.status(200).json({ url: session.url, sessionId: session.id, type: 'portal' });
}
```

**Problema**: Si cliente tiene `stripeCustomerId` PERO nunca pagó (`paymentStatus='pending'`), el botón "Regenerar enlace" abre **Billing Portal** (para agregar método de pago a customer existente) **EN VEZ DE** crear nueva **Checkout Session con trial 10 días**.

**Resultado**: Cliente ve portal de Stripe para "gestionar facturación" en vez de página de pago con trial gratis. No puede activar trial.

### 🔴 CRÍTICO: Asumpción incorrecta "si tiene stripeCustomerId → ya pagó"

**En `admin.html` líneas ~4803-4817:**
```javascript
const needsRegenerateLink = c.stripeCustomerId &&
  c.paymentStatus &&
  c.paymentStatus !== 'paid' &&
  c.paymentStatus !== 'trialing';
// Pero el botón llama a /api/create-checkout que hace Billing Portal si existe customerId
```

**En `admin.html` líneas ~4824-4827:**
```javascript
if (c.stripeCustomerId) {
  stripeLink.href = `https://dashboard.stripe.com/test/customers/${c.stripeCustomerId}`;
  stripeLink.style.display = '';
} else {
  stripeLink.style.display = 'none';
}
```

**En `api/create-checkout.js`:**
```javascript
if (client.stripeCustomerId) {
  // Billing Portal
} else {
  // Checkout con trial
}
```

**Problema**: El sistema asume que `stripeCustomerId` = ya tiene suscripción activa. Pero `stripeCustomerId` se crea en **Checkout** (al iniciar), no al pagar. Un cliente puede tener `stripeCustomerId` y `paymentStatus='pending'` (nunca pagó).

### 🟡 Bug: `invoice.paid` marca `paid` aunque subscription status ≠ active

En `stripe-webhook.js` línea ~240:
```javascript
case 'invoice.paid': {
  // Marca paid=true, active=true SIEMPRE
  // Pero no verifica sub.status === 'active'
}
```
Si `invoice.paid` llega para subscription en `past_due` (pago de deuda atrasada), marca `paid` aunque la suscripción siga en `past_due` hasta próximo cobro exitoso.

### 🟡 Inconsistencia: `checkout.session.completed` marca `paid` si `payment_status='paid'`

Pero Stripe puede completar checkout con `payment_status='no_payment_required'` (trial) o `payment_status='unpaid'` (falló). El código maneja ambos, pero `invoice.paid` es la fuente de verdad real.

### 🟡 Doble fuente de verdad: `paymentStatus` vs `paidUntil` + `paymentFailed`

`paymentStatusInfo()` tiene lógica dual:
- Si `c.paymentStatus` existe → usa switch
- Si NO existe → fallback legacy (`paidUntil`, `paymentFailed`, `subscriptionEnded`)

Esto crea inconsistencias en clientes creados antes de Fase 4 vs nuevos.

### 🟢 OK: Modo Test vs Live

**Todas las claves Stripe usan variables de entorno:**
- `STRIPE_SECRET_KEY` → `sk_test_...` (modo TEST)
- `STRIPE_WEBHOOK_SECRET` → `whsec_test_...`
- `STRIPE_PRICE_BASIC/PRO` → `price_test_xxx`

**NO hay claves live hardcodeadas.** Todo usa `process.env`. ✅

**Modo actual: TEST** (claves `sk_test_...`, `whsec_test_...`, `price_test_...`)

---

## 5. RECOMENDACIÓN — ORDEN DE ARREGLO SEGURO

### PRIORIDAD 1 — CRÍTICO: Fix "Regenerar enlace" → Checkout con trial (no Billing Portal)

**Archivo**: `api/create-checkout.js`

**Cambio propuesto:**
```javascript
// ANTES (líneas 43-50):
if (client.stripeCustomerId) {
  const session = await stripe.billingPortal.sessions.create({...});
  return res.status(200).json({ url: session.url, type: 'portal' });
}

// DESPUÉS:
const needsTrial = client.paymentStatus !== 'paid' && client.paymentStatus !== 'trialing';
if (client.stripeCustomerId && !needsTrial) {
  // Ya pagó/trial → Billing Portal para gestionar facturación
  const session = await stripe.billingPortal.sessions.create({...});
  return res.status(200).json({ url: session.url, type: 'portal' });
}
// Si necesita trial (pending, past_due, failed, cancelled) → Checkout con trial
const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  customer: client.stripeCustomerId,  // Reusa customer existente
  ...
  subscription_data: { metadata: { clientId }, trial_period_days: 10 },
  ...
});
return res.status(200).json({ url: session.url, type: 'checkout' });
```

**Por qué**: Permite reactivar trial / reactivar suscripción pagada usando el MISMO customer de Stripe, con trial fresco de 10 días.

---

### PRIORIDAD 2 — ALTO: Unificar fuente de verdad `paymentStatus`

**Archivos**: `api/stripe-webhook.js`, `admin.html` (`paymentStatusInfo`)

**Acción**: Eliminar fallback legacy en `paymentStatusInfo()` → usar SIEMPRE `c.paymentStatus` (webhook lo setea en todos los casos). Eliminar campos legacy `paidUntil`, `paymentFailed`, `subscriptionEnded` de la lógica de decisión (mantener solo para compatibilidad de lectura).

---

### PRIORIDAD 3 — MEDIO: Fix `invoice.paid` → verificar `subscription.status === 'active'`

**Archivo**: `api/stripe-webhook.js` caso `invoice.paid`

```javascript
const sub = await stripe.subscriptions.retrieve(subscriptionId);
if (sub.status !== 'active' && sub.status !== 'trialing') {
  // Pago de deuda atrasada: no activar todavía
  break;
}
```

---

### PRIORIDAD 4 — BAJO: Documentar flujos en README interno

Crear `docs/pagos-flujos.md` con diagramas de secuencia para:
- Cliente nuevo → Checkout → Trial → Pago → Activo
- Cliente con customer_id sin pagar → Regenerar enlace → Checkout con trial
- Cliente pagado → Billing Portal
- Renovación mensual → invoice.paid → renovar paidUntil
- Pago fallido → past_due → gracia → failed → cancelado

---

## RESUMEN DE ESTADO ACTUAL

| Componente | Estado |
|------------|--------|
| Stripe Test Mode | ✅ Configurado (claves test) |
| Checkout con trial (cliente nuevo) | ✅ Funciona |
| Webhook Stripe → Redis | ✅ Funciona (idempotente, 30d TTL) |
| Botón "Generar enlace" (sin customer) | ✅ Funciona |
| Botón "Regenerar enlace" (con customer, sin pagar) | ❌ **ROTO** → abre Billing Portal |
| Botón "Abrir en Stripe" | ✅ Funciona (solo admin) |
| Botón "Reintentar cobro" | ✅ Funciona (abre Billing Portal) |
| Webhook idempotencia | ✅ 30d TTL |
| Emails (bienvenida, fallido, trial ending) | ✅ Via Resend |
| Modo Stripe | **TEST** (`sk_test_...`, `price_test_...`) |

---

**Próximo paso recomendado**: Aplicar **PRIORIDAD 1** (fix `create-checkout.js`) y probar con Foodly (`paymentStatus='pending'`) → debe aparecer "Regenerar enlace" y generar Checkout con trial 10 días, no Billing Portal.