# AUDITORÍA: Restaurante E2E + Badge Prueba Gratuita

Fecha: 2026-08-15
Proyecto: jb-studio-site

---

## TEMA 1 — Cliente `restaurante-e2e-intenso`: Diagnóstico de "No hay fechas disponibles"

### 1. GET Redis completo de `client:restaurante-e2e-intenso`

```json
{
  "id": "restaurante-e2e-intenso",
  "businessName": "Restaurante E2E Intenso",
  "templateId": "restaurant",
  "active": true,
  "plan": "pro",
  "ownerEmail": "mikestandlyjeanbaptiste@gmail.com",
  "language": "es",
  "languages": ["es", "en"],
  "timezone": "America/Los_Angeles",
  "capacityPerSlot": 4,
  "reservationIntervalMinutes": 30,
  "businessHours": {
    "monday":    { "enabled": true,  "unknown": false, "ranges": [{ "start": "11:00", "end": "23:00" }] },
    "tuesday":   { "enabled": true,  "unknown": false, "ranges": [{ "start": "11:00", "end": "23:00" }] },
    "wednesday": { "enabled": true,  "unknown": false, "ranges": [{ "start": "11:00", "end": "23:00" }] },
    "thursday":  { "enabled": true,  "unknown": false, "ranges": [{ "start": "11:00", "end": "23:00" }] },
    "friday":    { "enabled": true,  "unknown": false, "ranges": [{ "start": "11:00", "end": "23:00" }] },
    "saturday":  { "enabled": true,  "unknown": false, "ranges": [{ "start": "11:00", "end": "23:00" }] },
    "sunday":    { "enabled": false, "unknown": false, "ranges": [] }
  },
  "menu": [
    { "id": "svc_rest_1", "nombre": "Mesa para 2 personas",    "precio": "$0",   "descripcion": "Mesa estándar en salón principal.", "duracion": "90 min"  },
    { "id": "svc_rest_2", "nombre": "Mesa VIP Terraza",        "precio": "$25",  "descripcion": "Reserva exclusiva en la terraza con vista.", "duracion": "120 min" }
  ]
}
```

### 2. Comparación campo por campo vs `client:spa`

| Campo | `client:spa` | `client:restaurante-e2e-intenso` | Estado |
|---|---|---|---|
| `businessHours` | ✅ Completo | ✅ Completo | OK |
| `timezone` | ✅ `America/Los_Angeles` | ✅ `America/Los_Angeles` | OK |
| `capacityPerSlot` | ✅ `1` | ✅ `4` | OK |
| `reservationIntervalMinutes` | ✅ `30` | ✅ `30` | OK |
| `menu` | ✅ 6 servicios con `duracion` | ✅ 2 servicios con `duracion` | OK |
| `features` | ✅ objeto completo | ❌ **NO EXISTE** | FALTANTE |
| `services` | ✅ array servicios | ❌ **NO EXISTE** | FALTANTE |
| `reservationDuration` | ✅ `0` | ❌ **NO EXISTE** | FALTANTE |
| `minNoticeHours` | ✅ `0` | ❌ **NO EXISTE** | FALTANTE |
| `trial_end` | ✅ string timestamp | ❌ **NO EXISTE** | FALTANTE |
| `trialDays` | ✅ `7` | ❌ **NO EXISTE** | FALTANTE |
| `trialEnabled` | ✅ `false` | ❌ **NO EXISTE** | FALTANTE |
| `holidays` | ✅ `[]` | ❌ **NO EXISTE** | FALTANTE |
| `notificationEmails` | ✅ array emails | ❌ **NO EXISTE** | FALTANTE |

### 3. Análisis: ¿Qué campo causa "No hay fechas disponibles"?

**`features` NO es la causa directa.** La función `obtenerHuecosDisponibles()` (línea 665) solo necesita `businessHours`, `capacityPerSlot`, `reservationIntervalMinutes` y datos del `menu`/`services` para calcular duraciones.

**El restaurante tiene `menu` pero NO `services`**, lo cual NO debería ser problema porque `durationFor()` usa `client.services || client.menu`:

```javascript
// api/reservations.js líneas 455-465
function durationFor(client, servicio) {
  if (Number.isFinite(client.reservationDuration)) return client.reservationDuration;
  const list = client.services || client.menu || [];
  const found = list.find(s =>
    s.nombre === servicio || s.id === servicio || s.name === servicio);
  return found ? minutosDe(found.duracion) : null;
}
```

**Hipótesis más probable**: El bug está en `rangosDelDia` (líneas 452-465). Si `DIAS_ORDEN[dow]` no matchea con las claves del `businessHours` del restaurante, retorna `null` y `obtenerHuecosDisponibles` retorna `[]`.

El restaurante tiene claves en español (`monday`...`sunday`). Si `DIAS_ORDEN` usa otro formato o idioma, `rangosDelDia` retornaría `null` aunque `businessHours` esté completo.

**Verificación pendiente**: `DIAS_ORDEN` necesita confirmarse que usa las mismas claves (`monday`...`sunday`) que el `businessHours` del restaurante.

### 4. Campos propuestos para dejar funcional

```json
{
  "features": {
    "faq": true, "prices": true, "catalog": true, "reservations": true,
    "leads": true, "emailNotifications": true, "cancellation": true, "rescheduling": true
  },
  "services": [
    { "id": "svc_rest_1", "nombre": "Mesa para 2 personas",  "precio": "$0",   "descripcion": "Mesa estándar en salón principal.", "imagen": "", "duracion": "90 min"  },
    { "id": "svc_rest_2", "nombre": "Mesa VIP Terraza",       "precio": "$25",  "descripcion": "Reserva exclusiva en la terraza con vista.", "imagen": "", "duracion": "120 min" }
  ],
  "reservationDuration": 0,
  "minNoticeHours": 0,
  "holidays": [],
  "notificationEmails": []
}
```

### 5. Comandos Redis propuestos (SIN EJECUTAR — solo auditoría)

```bash
# NO ejecutar — solo propuesta cuando se autorice
# HSET client:restaurante-e2e-intenso features '{"faq":true,"prices":true,"catalog":true,"reservations":true,"leads":true,"emailNotifications":true,"cancellation":true,"rescheduling":true}'
# HSET client:restaurante-e2e-intenso reservationDuration 0
# HSET client:restaurante-e2e-intenso minNoticeHours 0
# HSET client:restaurante-e2e-intenso holidays "[]"
# HSET client:restaurante-e2e-intenso notificationEmails "[]"
```

---

## TEMA 2 — Badge "Prueba gratuita activa" en `reservas.html`

### 1. Estado actual

- **Solo existe en `reservas.html`** — NO está en `admin.html`
- Componente: `plan-banner` (3 variantes: `trial`, `paid`, `inactive`)
- No es un badge flotante sino un banner dentro del formulario de reservas

### 2. CSS completo (reservas.html líneas 135–160)

```css
.plan-banner {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 14px 18px;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.plan-banner.trial    { border-color: #c9a84c; background: #fffdf5; }
.plan-banner.paid     { border-color: #88ae99; background: #f4faf6; }
.plan-banner.inactive { border-color: var(--line); background: var(--card); }
.plan-icon   { font-size: 22px; }
.plan-text   { flex: 1; min-width: 160px; }
.plan-title  { font-size: 14px; font-weight: 700; }
.plan-sub    { font-size: 12.5px; color: var(--muted); margin-top: 2px; }
.plan-btn {
  font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  background: var(--accent); color: #fff; border: none; border-radius: 8px;
  padding: 9px 15px; text-decoration: none; display: inline-block;
}
```

### 3. HTML (reservas.html línea 201)

```html
<div id="plan-banner" class="plan-banner inactive" style="display:none">
  <span class="plan-icon" id="plan-icon">🟡</span>
  <div class="plan-text">
    <div class="plan-title" id="plan-title">—</div>
    <div class="plan-sub"   id="plan-sub">—</div>
  </div>
  <div id="portal-btn-wrap"></div>
</div>
```

### 4. JS que lo maneja (reservas.html líneas 430–452, función `renderPlanBannerFromData`)

```javascript
function renderPlanBannerFromData(d) {
  var icon  = document.getElementById('plan-icon');
  var title = document.getElementById('plan-title');
  var sub   = document.getElementById('plan-sub');
  var btnWrap = document.getElementById('portal-btn-wrap');
  var banner = document.getElementById('plan-banner');
  if (!banner) return;
  banner.style.display = 'flex';
  // ... lógica trial/paid/inactive con portal-btn
}
```

### 5. Propuesta de rediseño — 2 opciones

**Contexto de uso**: Badge en formulario de reservas, mostrándose al cliente que tiene una prueba gratuita activa. Debe comunicar: estado, días restantes, acción a tomar.

#### Opción A — Badge compacto con barra de progreso

```html
<style>
.trial-badge-a {
  display: flex;
  align-items: center;
  gap: 12px;
  background: linear-gradient(135deg, #fffdf5 0%, #fff8e7 100%);
  border: 1.5px solid #c9a84c;
  border-radius: 12px;
  padding: 12px 16px;
  margin-bottom: 18px;
  font-family: system-ui, -apple-system, sans-serif;
}
.trial-badge-a .trial-icon {
  width: 36px; height: 36px;
  background: #c9a84c;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; flex-shrink: 0;
}
.trial-badge-a .trial-info { flex: 1; }
.trial-badge-a .trial-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
  text-transform: uppercase; color: #8a6c2a; margin-bottom: 2px;
}
.trial-badge-a .trial-title {
  font-size: 14px; font-weight: 700; color: #2d1f00;
}
.trial-badge-a .trial-meta {
  font-size: 12px; color: #7a6030; margin-top: 3px;
}
.trial-badge-a .trial-progress {
  width: 100%; height: 4px;
  background: #e8d48a; border-radius: 2px; margin-top: 8px;
}
.trial-badge-a .trial-progress-fill {
  height: 100%; background: #c9a84c; border-radius: 2px;
  transition: width 0.4s ease;
}
.trial-badge-a .trial-cta {
  background: #c9a84c; color: #fff; font-size: 12px; font-weight: 700;
  border: none; border-radius: 8px; padding: 8px 14px; cursor: pointer;
  text-decoration: none; white-space: nowrap;
}
</style>

<div class="trial-badge-a">
  <div class="trial-icon">⏱</div>
  <div class="trial-info">
    <div class="trial-label">Prueba gratuita activa</div>
    <div class="trial-title">3 días restantes</div>
    <div class="trial-meta">Renueva antes del 20 ago para no perder acceso</div>
    <div class="trial-progress">
      <div class="trial-progress-fill" style="width: 60%"></div>
    </div>
  </div>
  <a href="#" class="trial-cta">Renovar ahora</a>
</div>
```

#### Opción B — Tarjeta elevada con gradiente

```html
<style>
.trial-badge-b {
  position: relative;
  background: linear-gradient(145deg, #fffef9 0%, #fef6dc 100%);
  border: 1px solid #dbb850;
  border-radius: 16px;
  padding: 16px 20px;
  margin-bottom: 18px;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(180, 140, 40, 0.12);
  font-family: system-ui, -apple-system, sans-serif;
}
.trial-badge-b::before {
  content: '';
  position: absolute; top: 0; right: 0;
  width: 80px; height: 80px;
  background: radial-gradient(circle, rgba(201,168,76,0.15) 0%, transparent 70%);
}
.trial-badge-b .trial-row { display: flex; align-items: center; gap: 14px; }
.trial-badge-b .trial-icon {
  width: 44px; height: 44px;
  background: linear-gradient(135deg, #e8c84a 0%, #c9a84c 100%);
  border-radius: 12px; display: flex; align-items: center; justify-content: center;
  font-size: 22px; flex-shrink: 0; box-shadow: 0 2px 8px rgba(180,140,40,0.3);
}
.trial-badge-b .trial-content { flex: 1; }
.trial-badge-b .trial-header {
  display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
}
.trial-badge-b .trial-pill {
  font-size: 10px; font-weight: 800; letter-spacing: 0.1em;
  text-transform: uppercase; background: #c9a84c; color: #fff;
  padding: 2px 8px; border-radius: 20px;
}
.trial-badge-b .trial-days {
  font-size: 13px; font-weight: 600; color: #6b5520;
}
.trial-badge-b .trial-title {
  font-size: 15px; font-weight: 700; color: #2d1f00; margin-bottom: 2px;
}
.trial-badge-b .trial-sub {
  font-size: 12px; color: #8a7030;
}
.trial-badge-b .trial-action {
  background: #2d1f00; color: #fff; font-size: 12px; font-weight: 700;
  border: none; border-radius: 10px; padding: 10px 18px; cursor: pointer;
  text-decoration: none; display: inline-block;
}
</style>

<div class="trial-badge-b">
  <div class="trial-row">
    <div class="trial-icon">⏱</div>
    <div class="trial-content">
      <div class="trial-header">
        <span class="trial-pill">Trial</span>
        <span class="trial-days">3 días restantes</span>
      </div>
      <div class="trial-title">Tu prueba gratuita está activa</div>
      <div class="trial-sub">Sin compromiso · Cancela cuando quieras</div>
    </div>
    <a href="#" class="trial-action">Contratar plan</a>
  </div>
</div>
```

### 6. Ubicación para implementar en admin.html

El badge NO existe actualmente en `admin.html`. Para agregarlo, se necesita:
1. Insertar el HTML del badge en la sección de estado del plan del cliente
2. Cargar el CSS (variables `--accent`, `--card`, `--line`, `--muted` deben existir en admin.html)
3. Conectar `renderPlanBannerFromData` al cargar datos del cliente en admin.html

