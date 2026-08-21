# Plan de Regreso a Plan Hobby (Gratis)

> **Documento interno** — Si algún día se decide dejar de pagar Vercel Pro ($20/mes) y volver al plan gratis (Hobby), este documento explica qué hay que hacer para no romper el despliegue.

---

## 📊 Estado Actual (con Vercel Pro)

| Límite | Plan Pro | Plan Hobby |
|--------|----------|------------|
| **Funciones serverless por deployment** | **Ilimitado** | **Máx. 12** |

> **HOY el proyecto tiene 13 funciones** → **1 por encima del límite Hobby**.

---

## 📁 Inventario de Funciones Serverless (`/api`)

| Archivo | Qué hace | Nivel de riesgo al fusionar |
|---------|----------|----------------------------|
| `api/cancel-reservation.js` | Cancela una reserva existente | Bajo |
| `api/client-chat.js` | Chat del asistente (motor principal) | **Alto** (núcleo del chatbot) |
| `api/client-config.js` | Configuración del widget por cliente | **Alto** (widget usa esto) |
| `api/clients.js` | CRUD de clientes/negocios | **Alto** (panel admin usa esto) |
| `api/create-checkout.js` | **Crea sesión Stripe Checkout** (pagos) | **CRÍTICO** (maneja dinero real) |
| `api/generate-client-config.js` | Genera config del chatbot | **Alto** |
| `api/health.js` | Health check básico | Bajo |
| `api/reservations.js` | Gestión de reservas (crear, listar, etc.) | **Alto** |
| `api/reviews.js` | Testimonios/reseñas | Bajo |
| `api/stripe-webhook.js` | **Recibe eventos de Stripe** (pagos, suscripciones) | **CRÍTICO** (maneja dinero real) |
| `api/track-ventas-funnel.js` | Tracking de embudo de ventas | **Bajo** (analytics) |
| `api/ventas-chat.js` | Métricas de chat/ventas | **Bajo** (analytics) |
| `api/admin/health-check.js` | Health check admin (solo interno) | Bajo |

**Total: 13 funciones** (12 en `/api` + 1 en `/api/admin`)

---

## 🟢 Funciones "Seguras" de Fusionar (Bajo Riesgo)

| Par | Qué se haría | Por qué es seguro |
|-----|--------------|-------------------|
| `track-ventas-funnel.js` + `ventas-chat.js` | Unir en `api/ventas-analytics.js` | Solo registran métricas/analytics, no tocan Stripe ni lógica de reservas. Si fallan, solo pierdes visibilidad de métricas, no rompes pagos ni chatbots. |
| `reviews.js` + `cancel-reservation.js` | Unir en `api/misc.js` | Funciones simples e independientes. |

> **Recomendación**: Empieza fusionando **`track-ventas-funnel.js` + `ventas-chat.js`**. Baja a 12 funciones y te deja margen para 1 más.

---

## 🔴 Funciones "Delicadas" (NO fusionar salvo emergencia)

| Archivo | Por qué es delicado |
|---------|---------------------|
| `create-checkout.js` | Crea sesiones de Stripe Checkout. Maneja **dinero real** de clientes. Cualquier bug = cobros duplicados, pagos fallidos, clientes enojados. |
| `stripe-webhook.js` | Recibe eventos de Stripe (pagos exitosos, fallidos, suscripciones canceladas). Actualiza estado de clientes en BD. Si falla = clientes sin activar, pagos no registrados, caos contable. |
| `client-chat.js` | Motor del chatbot. Cualquier cambio puede romper todos los chatbots a la vez. |
| `client-config.js` | Configuración que lee el widget (`widget.js?id=xxx`). Cambios aquí afectan a **todos** los chatbots en producción. |
| `reservations.js` | Gestión completa de reservas. Lógica compleja de horarios, disponibilidad, confirmaciones. |

> **Regla de oro**: Si toca Stripe, dinero real, o lógica del chat/reservas → **NO fusionar** salvo que tengas tests automatizados cubriendo 100% y tiempo para QA exhaustivo.

---

## 🛠 Paso a Paso para Fusionar `track-ventas-funnel.js` + `ventas-chat.js`

> Haz esto **un par de días antes** de bajar a Hobby, con tiempo para probar.

### 1. Crear archivo unificado
```bash
cp api/track-ventas-funnel.js api/ventas-analytics.js
# Editar ventas-analytics.js: pegar contenido de ventas-chat.js al final
# Exportar ambos handlers (ej: export default { track, chat })
```

### 2. Actualizar `vercel.json`
```json
"rewrites": [
  { "source": "/api/track-ventas-funnel", "destination": "/api/ventas-analytics" },
  { "source": "/api/ventas-chat", "destination": "/api/ventas-analytics" }
]
```

### 3. Borrar archivos originales
```bash
rm api/track-ventas-funnel.js api/ventas-chat.js
```

### 4. Probar localmente
```bash
npm run test        # tests unitarios
vercel dev          # probar endpoints /api/track-ventas-funnel y /api/ventas-chat
```

### 5. Verificar en staging
```bash
vercel --prod       # deploy a preview
# Probar en navegador: que track-ventas-funnel y ventas-chat respondan 200
```

### 5. Deploy a producción
```bash
vercel --prod
```

### 6. Verificar en producción
- Revisar logs de Vercel: 0 errores en `ventas-analytics`
- Confirmar que dashboards de analytics siguen recibiendo datos

---

## ✅ Checklist Pre-Deploy (antes de cada merge)

- [ ] Tests unitarios pasan: `npm test`
- [ ] `npm run check-functions` reporta ≤ 12
- [ ] `vercel dev` funciona sin errores
- [ ] Si tocas Stripe: prueba pago real con tarjeta de prueba `4242 4242 4242 4242`
- [ ] Si tocas chat/reservas: prueba flujo completo en `vercel dev`

---

## 📦 Script `npm run check-functions`

Añadido al `package.json`:

```json
"check-functions": "node -e \"const fs=require('fs'); const files=fs.readdirSync('api').filter(f=>f.endsWith('.js')).length + fs.readdirSync('api/admin').filter(f=>f.endsWith('.js')).length; console.log('Funciones serverless:', files); if(files>12){console.error('⚠️  EXCEDE LÍMITE HOBBY (12)'); process.exit(1);} else {console.log('✅ Dentro del límite');}\""
```

**Uso:**
```bash
npm run check-functions
# Salida esperada: "Funciones serverless: 13" + "⚠️  EXCEDE LÍMITE HOBBY (12)"
```

---

## 📝 Regla para Nuevos Archivos en `/api`

> **Añade este comentario al inicio de TODO archivo nuevo en `/api`:**

```javascript
// ⚠️ LIMIT HOBBY: Cada función nueva acerca al proyecto al límite de 12
// si algún día se vuelve al plan gratis (Hobby). Ver PLAN-REGRESO-HOBBY.md
```

---

## 📅 Cuándo Ejecutar Este Plan

| Señal | Acción |
|-------|--------|
| Decides bajar a Hobby | Tienes **~1 semana** antes de cancelar Pro para fusionar y probar |
| `npm run check-functions` da error | Ya estás en 13+ → planifica fusión ya |
| Vercel avisa "Function limit reached" en deploy | Urgente: fusiona YA antes de siguiente deploy |

---

## 📞 Contacto / Dudas

- **Stripe / Pagos**: Revisar logs en Sentry + dashboard Stripe
- **Chat/Reservas**: Tests en `test/e2e` + `vercel dev`
- **Analytics**: `track-ventas-funnel` y `ventas-chat` son prescindibles si hay prisa

---

*Documento creado: 2026-08-19*  
*Última actualización: 2026-08-19*  
*Proyecto: jb-studio-site → https://jbstudio.app*