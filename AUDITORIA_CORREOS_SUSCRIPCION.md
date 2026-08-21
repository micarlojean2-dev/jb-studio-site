# Auditoría Técnica: Correos de Reserva, Reagendado, Cancelación y Suscripción Stripe

**Fecha de ejecución:** 2026-08-10  
**Proyecto:** JB Studio Site (`jb-studio-site`)  
**Estado:** Reporte de diagnóstico — Ningún código ha sido modificado.

---

## 1. CORREOS DE RESERVA

### A. Envío al CLIENTE
**Archivo y líneas:** [`lib/reservation-emails.js:164-176`](file:///Users/mike/jb-studio-site/lib/reservation-emails.js#L164-L176)

```javascript
164:   if (reservation.email) {
165:     result.customer.attempted = true;
166:     try {
167:       const r = await resend.emails.send({ from: FROM, to: reservation.email, subject: customerSubject, html: details });
168:       if (r && r.error) { result.customer.error = r.error.message || 'send failed'; }
169:       else { result.customer.sent = true; result.customer.messageId = resendMessageId(r); }
170:     } catch (e) { result.customer.error = e.message || 'send threw'; }
171:     if (result.customer.error) {
172:       console.error(`[reservation-emails] customer email failed for ${reservation.clientId}:`, result.customer.error);
173:       captureApiMessage(`Resend customer email failed: ${result.customer.error}`,
174:         { clientId: reservation.clientId, feature: 'email_customer', route: '/api/reservations' });
175:     }
176:   }
```

### B. Envío al DUEÑO del negocio
**Archivo y líneas:** [`lib/reservation-emails.js:178-193`](file:///Users/mike/jb-studio-site/lib/reservation-emails.js#L178-L193)

```javascript
178:   if (recipients.length) {
179:     result.owners.attempted = true;
180:     result.owners.recipients = recipients;
181:     for (const to of recipients) {
182:       try {
183:         const r = await resend.emails.send({ from: FROM, to, subject: ownerSubject, html: ownerHtml });
184:         if (r && r.error) { result.owners.error = r.error.message || 'send failed'; }
185:         else { result.owners.sent = true; const id = resendMessageId(r); if (id) result.owners.messageIds.push(id); }
186:       } catch (e) { result.owners.error = e.message || 'send threw'; }
187:     }
188:     if (result.owners.error) {
189:       console.error(`[reservation-emails] owner email failed for ${reservation.clientId}:`, result.owners.error);
190:       captureApiMessage(`Resend owner email failed: ${result.owners.error}`,
191:         { clientId: reservation.clientId, feature: 'email_owner', route: '/api/reservations' });
192:     }
193:   }
```

### C. Origen del correo del DUEÑO (`destinatariosAviso`)
**Archivo y líneas:** [`lib/reservation-emails.js:76-88`](file:///Users/mike/jb-studio-site/lib/reservation-emails.js#L76-L88)

```javascript
76: export function destinatariosAviso(client) {
77:   const raw = [
78:     client && client.ownerEmail,
79:     ...(Array.isArray(client && client.notificationEmails) ? client.notificationEmails : []),
80:   ];
81:   const vistos = {};
82:   const out = [];
83:   raw.forEach((e) => {
84:     const v = String(e || '').trim().toLowerCase();
85:     if (v && !vistos[v]) { vistos[v] = 1; out.push(v); }
86:   });
87:   return out.slice(0, 10);
88: }
```
- **Origen exacto:** El correo del dueño se obtiene de `client.ownerEmail` (el correo ingresado al crear/editar el negocio en el admin) y se combina sin duplicados con los correos de la lista `client.notificationEmails`.

### D. Confirmación de disparo dual
Ambos envíos ocurren de forma secuencial dentro de `sendReservationEmails()` en [`lib/reservation-emails.js:123-195`](file:///Users/mike/jb-studio-site/lib/reservation-emails.js#L123-L195). La función retorna el objeto `result` reportando explícitamente `customer` y `owners`.

---

## 2. REAGENDAR CITA

### A. Manejo del Reagendado
**Archivo y líneas:** [`api/reservations.js:1019-1128`](file:///Users/mike/jb-studio-site/api/reservations.js#L1019-L1128)

```javascript
1019:     if (action === 'reschedule') {
1020:       if (!actionToken || !fecha || !hora) return res.status(400).json({ error: 'actionToken, fecha and hora are required' });
...
1096:       candidate.estado = 'reprogramada';
1097:       candidate.fechaAnterior = existing.fecha;
1098:       candidate.horaAnterior = existing.hora;
1099:       candidate.fechaReprogramacion = new Date().toISOString();
...
1127:       const emailResult = await sendReservationEmails(client, candidate, 'rescheduled');
1128:       return res.status(200).json({ ok: true, reservation: candidate, aviso: { encolado: aviso.ok }, email: emailResult });
```

### B. Mecanismo y Token
- **Mecanismo:** El reagendado no se hace a ciegas. El servidor requiere un `actionToken` criptográfico firmado con SHA-256 (`actionTokenHash`).
- **Generación del Link:** [`lib/reservation-emails.js:90-96`](file:///Users/mike/jb-studio-site/lib/reservation-emails.js#L90-L96)
```javascript
90: export function reservationActionUrl(reservation, action) {
91:   const params = new URLSearchParams({
92:     reservation: reservation.actionToken,
93:     action,
94:   });
95:   return `${APP_URL}/asistente/${encodeURIComponent(reservation.clientId)}#${params}`;
96: }
```

### C. Notificación por Correo al Reagendar
- **SÍ se envía correo.** Línea 1127 de [`api/reservations.js`](file:///Users/mike/jb-studio-site/api/reservations.js#L1127):
  ```javascript
  const emailResult = await sendReservationEmails(client, candidate, 'rescheduled');
  ```
  Envía el aviso con la plantilla `'rescheduled'` (mostrando fecha anterior y fecha nueva) tanto al cliente como al dueño.

---

## 3. CANCELAR CITA

### A. Manejo de Cancelación
**Archivo y líneas:** [`api/cancel-reservation.js:95-230`](file:///Users/mike/jb-studio-site/api/cancel-reservation.js#L95-L230)

```javascript
191:     const fechaCancelacion = new Date().toISOString();
192:     match.estado           = 'cancelada';
193:     match.fechaCancelacion = fechaCancelacion;
...
225:     const email = await sendReservationEmails(client, match, 'cancelled');
227:     return res.status(200).json({ found: true, aviso: { encolado: aviso.ok }, email, emailWarning: email.warning || null });
```

### B. Mecanismo de Disparo
El cliente lo dispara desde el link de su correo (`reservationActionUrl` con `action=cancel`) o seleccionándolo en el chat, enviando `actionToken` a `POST /api/cancel-reservation`.

### C. Notificación al Dueño al Cancelar
- **SÍ se notifica al dueño por correo.** La línea 225 de [`api/cancel-reservation.js`](file:///Users/mike/jb-studio-site/api/cancel-reservation.js#L225) ejecuta `sendReservationEmails(client, match, 'cancelled')`, enviando un correo al cliente y a `client.ownerEmail`.

---

## 4. "GESTIONAR SUSCRIPCIÓN" ROTO (Diagnóstico de Urgencia)

### A. Código del Botón en `reservas.html`
**Archivo y líneas:** [`reservas.html:752-768`](file:///Users/mike/jb-studio-site/reservas.html#L752-L768)

```javascript
752:   function openPortal() {
753:     var btn = document.getElementById('portal-btn');
754:     if (!btn || btn.dataset.loading === '1') return;
755:     btn.dataset.loading = '1';
756:     btn.textContent = '…';
757:     fetch(API + '/api/create-portal-session', {
758:       method: 'POST',
759:       headers: { 'Content-Type': 'application/json', 'x-admin-token': currentToken },
760:       body: JSON.stringify({ clientId: clientId }),
761:     })
762:       .then(function(r) { if (!r.ok) throw new Error('portal error'); return r.json(); })
763:       .then(function(d) { if (d.url) window.open(d.url, '_blank'); else throw new Error('no url'); })
764:       .catch(function() { alert(tr('portalError')); })
765:       .finally(function() {
766:         if (btn) { btn.dataset.loading = '0'; btn.textContent = tr('manageSubscription'); }
767:       });
768:   }
```

### B. Causa Raíz Exacta
1. **El endpoint Backend NO EXISTE:** El archivo `api/create-portal-session.js` no se encuentra en el directorio `api/`.
2. **Respuesta del servidor:** Al hacer clic en "Gestionar suscripción", la llamada `POST /api/create-portal-session` devuelve **HTTP 404 Not Found**.
3. **Mensaje de Consola / UI:** `!r.ok` desencadena el bloque `.catch()`, mostrando la alerta `alert("No se pudo abrir el portal. Contacta a soporte.")`.

### C. Solución Requerida para Stripe Customer Portal
Para que el dueño pueda cambiar método de pago, cancelar suscripción o ver su fecha de cobro en el portal nativo de Stripe, se debe crear el endpoint Serverless `api/create-portal-session.js` con el siguiente flujo:
```javascript
import Stripe from 'stripe';
import { Redis } from '@upstash/redis';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { clientId } = req.body || {};
  const client = await redis.get(`client:${clientId}`);
  if (!client || !client.stripeCustomerId) {
    return res.status(400).json({ error: 'No active Stripe customer found for this client' });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: client.stripeCustomerId,
    return_url: `https://jbstudio.app/reservas/${encodeURIComponent(clientId)}`,
  });

  return res.status(200).json({ url: session.url });
}
```

---

## 5. CONFIRMACIÓN DEL FLUJO DE TRIAL

Verificación punto por punto contra la implementación actual:

| Punto Solicitado | Estado Actual en Código | Evidencia en Archivo:Línea |
|---|---|---|
| **Punto 1:** Cliente nuevo se crea desde el admin → activa trial de 10 días automáticamente | ⚠️ **DIFERENCIA:** La creación en `POST /api/clients` guarda `active: false` y `stripeCustomerId: null`. No crea suscripción en Stripe automáticamente al guardar. El dueño debe hacer clic en "Pagar" para invocar `api/create-checkout.js` que pasa `trial_period_days: 10`. | [`api/clients.js:703`](file:///Users/mike/jb-studio-site/api/clients.js#L703)<br>[`api/create-checkout.js:59`](file:///Users/mike/jb-studio-site/api/create-checkout.js#L59) |
| **Punto 2:** Se entrega al dueño el snippet del widget y el link a su panel de citas | ✅ **IMPLEMENTADO:** Se envía por correo y se muestra en el panel admin. | [`api/stripe-webhook.js:118-125`](file:///Users/mike/jb-studio-site/api/stripe-webhook.js#L118-L125) |
| **Punto 3:** En el panel del dueño se ve cuántos días le quedan de trial | ⚠️ **ROTO:** La UI en `reservas.html:366` tiene el cálculo `trialDaysLeft`, pero en la línea 746 llama a `fetch('/api/client-status')`, un endpoint **inexistente** (404), por lo que el banner falla y no muestra los días restantes. | [`reservas.html:746`](file:///Users/mike/jb-studio-site/reservas.html#L746) |
| **Punto 4:** Si no ingresa tarjeta al vencer el trial, el chatbot se PAUSA automáticamente | ✅ **IMPLEMENTADO:** Si `client.active === false`, `client-chat.js:751` responde "fuera de servicio" y `reservations.js:925` rechaza reservas. Webhook de Stripe desactiva `client.active = false` al vencer el trial. | [`api/client-chat.js:751`](file:///Users/mike/jb-studio-site/api/client-chat.js#L751)<br>[`api/reservations.js:925`](file:///Users/mike/jb-studio-site/api/reservations.js#L925) |
