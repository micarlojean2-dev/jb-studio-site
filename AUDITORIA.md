# Auditoría del chatbot — cliente Spa

Estado actual del sistema, tal como está en el commit `b285a0c1c6a1686c08bdce63bcc6fa624076bf63` (`origin/main`, desplegado en producción). Documento de solo lectura — no propone cambios ni describe intenciones de rediseño.

---

## 1. Flujo del chatbot

### Archivos que manejan la conversación

| Archivo | Rol |
|---|---|
| `widget.js` | Frontend embebible (el que se incrusta en el sitio del spa). Dueño del estado de la conversación en el navegador. |
| `asistente.html` | Frontend standalone (`/asistente/:clientId`), misma lógica que widget.js, con 2 excepciones propias documentadas más abajo (nombre de una palabra, enlace seguro de email). |
| `chat-core.js` | Motor compartido entre ambos frontends (`window.JBChatCore`): validadores, saneamiento de entidades, textos, mensajes de resumen/confirmación. Sin este archivo ninguno de los dos frontends funciona. |
| `api/client-chat.js` | **Único** endpoint que habla con la IA. Arma el prompt, llama al proveedor, interpreta la respuesta. Nunca crea reservas. |
| `lib/message-interpreter.js` | Define el contrato `{intent, text, entities}` que la IA debe devolver y lo sanea por FORMA (nunca de negocio). |
| `lib/assistant-templates.mjs` + `templates/spa/*` | Fuente del prompt base oficial del spa (`templates/spa/prompt-base.txt` / `prompt-base-en.txt`), sus features (`features.json`) y su esquema (`template.json`). |

### Cómo se arma el prompt en cada mensaje

No es un system prompt fijo ni "todo el historial sin filtrar" — es una combinación de piezas fijas + dinámicas, reconstruida en cada request (el servidor no guarda estado entre mensajes):

`buildSystemPrompt()` (`api/client-chat.js:422-517`) concatena, en este orden exacto (línea 517):

```
header + businessInfo + effectiveBasePrompt + restaurantRules + toneRules + catalogRules + mediaRules + langDirective
```

1. **`header`** (`spaHeaderEs`/`spaHeaderEn`, líneas ~272-348): personalidad, formato, tono, reglas de seguridad contra inyección de prompt. Fijo por idioma, igual para todos los spas.
2. **`businessInfo`** (`businessInfoBlock()`, líneas 218-262): datos REALES y validados del negocio — nombre, dirección, teléfono, zona horaria, horario por día, catálogo de servicios con precio/duración. Se arma de nuevo en cada request a partir de `client:{clientId}` en Redis — nunca es un texto guardado.
3. **`effectiveBasePrompt`**: el prompt oficial del spa (`templates/spa/prompt-base.txt`, en español) o su versión oficial en inglés si el idioma activo es inglés (`templates/spa/prompt-base-en.txt`). Este es el "prompt base" que el creador de clientes asigna — no lo escribe la IA en cada turno.
4. **`restaurantRules`/`catalogRules`/`mediaRules`/`toneRules`**: bloques cortos condicionales (plantilla, fotos disponibles, tono por tipo de negocio).
5. **Regla de estado real de reserva** (`reservationTruthBlock()`, línea 720, ver sección 3): se agrega SIEMPRE, fuera del bloque anterior.
6. **Si hay una reserva en curso** (`booking` en el body, línea 723+): se agrega un bloque adicional con los datos ya capturados y los que faltan (`api/client-chat.js:723-800`).

**Historial de mensajes:** el navegador manda el array `messages` completo (guardado en `sessionStorage`, ver sección 2) en cada request; el servidor lo recorta a los últimos 50 (`api/client-chat.js:534` y `:605`, `messages.slice(-50)`) antes de pasarlo al proveedor. También hay un límite duro de 60 mensajes y 2000 caracteres por mensaje aplicado en la validación de entrada (`api/client-chat.js:663` y `:671`) — si se excede, la API rechaza el request con 400 antes de llegar a la IA.

### Modelo de IA usado

- **Selección de proveedor:** `getProvider()` (`api/client-chat.js:40-42`) — `process.env.CLIENT_CHAT_PROVIDER || 'anthropic'`. Es decir, **el código por defecto usa Anthropic** (Claude) si esa variable de entorno no está fijada.
- **Modelo por proveedor:** `getModel()` (`api/client-chat.js:54-59`) — DeepSeek usa `resolveDeepseekModel(process.env.DEEPSEEK_MODEL)` (con `deepseek-v4-flash` como default seguro, línea 48); Anthropic usa `process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001'`.
- **Evidencia de qué corre HOY en producción:** múltiples comentarios en el propio código (`api/client-chat.js:797-834`) documentan mediciones "en vivo contra DeepSeek (deepseek-v4-flash, el proveedor real de este proyecto)" — esto confirma que `CLIENT_CHAT_PROVIDER=deepseek` está fijado como variable de entorno en Vercel (no puedo leer el valor real de esa variable desde aquí, solo su nombre, por política de seguridad — pero el código y los comentarios de auditorías previas son consistentes en que DeepSeek es el proveedor activo).
- **Dónde está la llamada real:** `callDeepSeek()` (`api/client-chat.js:525-594`, hace `fetch` a `https://api.deepseek.com/chat/completions` u otro `DEEPSEEK_BASE_URL`) y `callAnthropic()` (`api/client-chat.js:596-644`, hace `fetch` a `https://api.anthropic.com/v1/messages`). Ambas se invocan desde `callProvider()` (`api/client-chat.js:892-...`), que decide cuál usar según `getProvider()`.
- **Groq no se usa en ningún punto de este flujo** (existe un cliente Groq standalone documentado en memoria de sesiones previas para otro propósito, fuera de este repo/flujo).

---

## 2. Memoria / estado

### Dónde vive cada cosa

| Dato | Dónde vive | Detalle |
|---|---|---|
| Historial de mensajes (`msgs`) | `sessionStorage` del navegador | Key `jbw_{clientId}` (`widget.js:14`) |
| Datos de la reserva en curso (`bookingData`, paso, campo pendiente, resumen mostrado) | `sessionStorage` | Key `jbw_{clientId}_booking` (`widget.js:224`) |
| Reserva activa ya confirmada (`activeReservation`) | `sessionStorage` | Key `jbw_{clientId}_reserva` (`widget.js:200`) |
| Idioma elegido | `sessionStorage` | Key `jbw_{clientId}_language` (`widget.js:141`) |
| Configuración del negocio (`client:{clientId}`) | **Redis** | Ver estructura completa en la sección 4 |
| Reservas creadas | **Redis** | `reservations:{clientId}:{timestamp}` |
| Todo lo demás (ver tabla de keys abajo) | **Redis** | — |

**No existe ninguna memoria de conversación en Redis.** Confirmado por grep exhaustivo en `api/` y `lib/`: no hay ninguna key tipo `chat:*`, `conversation:*`, `session:*` ni `history:*`. El servidor es completamente stateless respecto a la conversación — cada request de `/api/client-chat` reconstruye el prompt desde cero a partir de: (a) `client:{clientId}` en Redis, y (b) el array `messages` que manda el navegador desde su propio `sessionStorage`. Si el cliente borra su `sessionStorage` o cambia de dispositivo, la conversación se pierde por completo — no hay ningún respaldo server-side de "lo que el cliente ya dijo".

### Estructura exacta de keys de Redis usadas por el chatbot

(Confirmado por grep de todos los patrones de template literal `` `algo:${var}` `` en `api/` y `lib/`.)

| Key | Dónde se usa | Contenido |
|---|---|---|
| `client:{clientId}` | `api/client-chat.js:635`, `api/reservations.js`, `api/client-config.js`, etc. | Objeto completo de configuración del negocio (ver sección 4) |
| `reservations:{clientId}:{timestampMs}` | `api/reservations.js:1143` | Una reserva individual |
| `idempo:{clientId}:{idemRaw}` | `api/reservations.js:1214` | Lock de idempotencia (evita reservas duplicadas por doble clic/reintento), TTL 900s |
| `usage:{clientId}:{YYYY-MM}` | `api/client-chat.js:590` | Contador mensual de uso de IA (mensajes, tokens, costo estimado), TTL 90 días |
| `changes:{clientId}` | `lib/changes.js` | Cola de eventos (reserva creada/cancelada/reprogramada) pendientes de incluir en el resumen diario al dueño |
| `digest:pending` | `lib/changes.js` | Set de `clientId`s con cambios pendientes de notificar |
| `activity:{clientId}` | `lib/activity.js` | Timeline de actividad que se muestra en el panel del dueño |
| `preview:{previewToken}` | `api/client-chat.js:654` | Token temporal que permite probar el chatbot antes de que el negocio esté activo/pagado |

No hay ninguna key de memoria "semántica" o vectorial — toda la "memoria" del chatbot en un momento dado es: el `client:{clientId}` (hechos del negocio) + el array de mensajes que manda el navegador (lo que se dijo). No hay resumen ni compresión de conversaciones largas más allá del corte a los últimos 50 mensajes ya mencionado.

---

## 3. Reservas

### Funciones que crean una reserva

- **Frontend:** `submitBooking()` (`widget.js:1119` / `asistente.html:1122`) — arma el payload desde `bookingData` y hace `POST /api/reservations`. Es la **única** función que hace esa llamada de creación; su único caller real es el handler de click del botón "✅ Sí, confirmar cita" (confirmado en la auditoría/fix del `2026-08-09`, commit `b285a0c`).
- **Backend:** el handler de `api/reservations.js` (`export default async function handler`, línea 899 en adelante para el método POST de creación). El punto exacto donde la reserva pasa a existir es `api/reservations.js:1298` — `await redis.set(key, storedReservation)`, después de pasar `validarReserva()`.

### Cómo verifica disponibilidad real

`validarReserva(client, fechaISO, horaISO, servicio, ahoraMs, reservas)` (`api/reservations.js:495-...`), contra:
- `client.timezone` (zona horaria válida)
- `client.holidays` (feriados sueltos)
- `client.businessHours` (rangos por día de la semana)
- Personal configurado y su propia disponibilidad, si aplica (`configuredStaff`, plantilla barbería — no aplica al spa salvo que tenga staff configurado)
- `durationFor(client, servicio)` — la cita debe caber antes del cierre
- `client.capacityPerSlot` / `client.bufferMinutes` / `client.reservationIntervalMinutes` — capacidad simultánea, colchón entre citas, alineación a intervalos válidos
- Las reservas ya existentes del negocio (leídas de Redis con `redis.keys('reservations:{clientId}:*')` justo antes de validar, líneas 1258-1262) — para detectar duplicados y solapes reales, no solo contra el horario general

Todo esto se ejecuta en el servidor, nunca en el navegador — el frontend solo hace una verificación temprana opcional (`validarDisponibilidadTemprana()`, `asistente.html:908-935`) que llama al mismo endpoint con `action:'validate'` para dar feedback más rápido, pero la autoridad real es siempre `api/reservations.js`.

### ¿Qué pasa si la IA "dice" que reservó algo pero la función nunca se ejecutó?

Este fue exactamente el Bug #2 encontrado y corregido el `2026-08-09` (commit `b285a0c`). Estado actual:
- El prompt tiene una regla explícita y única (`reservationTruthBlock()`, `api/client-chat.js:407-421`) que se agrega a **todo** turno (no solo mientras se está capturando una reserva): nunca afirmar que una reserva fue creada/confirmada/enviada, ni que se envió un correo, salvo que el servidor le pase un estado real (`reservationContext`, proyectado desde `activeReservation` vía `CORE.buildReservationContext()`, `chat-core.js`).
- Si no hay ninguna reserva real, el prompt instruye explícitamente a decir que no se puede confirmar desde ahí y a usar el botón — el modelo no tiene margen para inventar un resultado porque no se le da ningún dato de reserva.
- Sigue siendo un LLM: la validación es de **prompt + datos reales**, no una restricción técnica dura que sea 100% imposible de saltarse en una respuesta libre. Lo que sí es una restricción dura es que **la reserva en sí solo puede existir si `api/reservations.js` escribió en Redis** — lo que la IA diga en el chat nunca crea ni modifica una reserva.

### ¿Function calling / tool use, o texto libre?

**No hay function calling ni tool use configurado.** Confirmado por grep: no existe ningún parámetro `tools`, `tool_choice` ni `function_call` en las llamadas a DeepSeek o Anthropic (`api/client-chat.js`). Lo que sí existe es **salida estructurada por prompting**: se le pide al modelo un único bloque de texto que sea un JSON con la forma `{intent, text, entities}` (`response_format:{type:'json_object'}` para DeepSeek, `output_config.format` para Anthropic — ver `lib/message-interpreter.js:40-77`), y el servidor hace `JSON.parse()` sobre ese texto (`api/client-chat.js`, dentro de `callProvider()`) y lo valida con `sanitizeInterpretation()` — nunca confía en que el JSON esté bien formado o sea correcto. Si el `JSON.parse()` falla, se degrada a una llamada de respaldo en texto plano (fail-closed, nunca dejando al cliente sin respuesta). La IA nunca ejecuta ninguna acción por sí misma: todo lo que "decide" es interpretado por código, que es quien decide si actuar.

---

## 4. Infraestructura

### Vercel Functions actuales

El límite del plan (Hobby) es 12 funciones. Hoy hay **11 archivos en `api/`**, es decir, **11 de 12 en uso** (1 de margen):

| # | Archivo | Qué hace |
|---|---|---|
| 1 | `api/client-chat.js` | Conversación del chatbot con la IA (este flujo) |
| 2 | `api/reservations.js` | Crear/leer/reagendar/cancelar reservas, cron de auditoría/digest/backfill |
| 3 | `api/cancel-reservation.js` | Cancelación vía enlace seguro de correo |
| 4 | `api/client-config.js` | Multiplexa varias rutas lógicas (ver abajo) vía `vercel.json` |
| 5 | `api/clients.js` | Backend del panel de administración interno (gestión de clientes, preview tokens, plantillas) — no interviene en la conversación del chatbot |
| 6 | `api/generate-client-config.js` | Creador de clientes con IA (arma `client:{id}` al dar de alta un negocio) |
| 7 | `api/create-checkout.js` | Sesión de checkout de Stripe |
| 8 | `api/stripe-webhook.js` | Webhook de eventos de Stripe (suscripciones) |
| 9 | `api/reviews.js` | Reseñas del negocio (Google/similar) |
| 10 | `api/track-ventas-funnel.js` | Analítica del embudo de ventas del sitio de marketing |
| 11 | `api/ventas-chat.js` | **Chatbot DISTINTO** — el asistente de ventas del propio sitio de JB Studio (`ventas.html`), no el chatbot de ningún cliente/spa |

`vercel.json` multiplexa 6 rutas lógicas adicionales sobre `api/client-config.js` (vía `rewrites`, sin consumir funciones extra): `/api/client-images`, `/api/health`, `/api/build`, `/api/client-status`, `/api/create-portal-session`, `/api/reservations-list` — todas resueltas con un parámetro `__scope`/`scope` dentro del mismo archivo físico.

**Del flujo del chatbot del spa específicamente** solo participan: `client-chat.js`, `reservations.js` (vía `submitBooking()` y `validarDisponibilidadTemprana()`), `cancel-reservation.js`, y `client-config.js` (para cargar la configuración pública del negocio y para el panel del dueño). El resto (`clients.js`, `generate-client-config.js`, `create-checkout.js`, `stripe-webhook.js`, `reviews.js`, `track-ventas-funnel.js`, `ventas-chat.js`) son de administración, facturación o marketing — no se ejecutan durante una conversación real con un cliente del spa.

### Estructura de `client:{clientId}` en Redis

Ejemplo con datos ficticios, combinando todos los campos confirmados por grep en `api/client-chat.js`, `api/reservations.js` y `lib/creator-schema.js`:

```json
{
  "id": "spa-luna-wellness",
  "businessName": "Luna Wellness Spa",
  "templateId": "spa",
  "active": true,
  "plan": "pro",
  "paymentStatus": "active",
  "trial_end": null,
  "language": "es",
  "languages": ["es", "en"],
  "address": "Av. Reforma 123, Ciudad de México",
  "phoneCountryCode": "+52",
  "phoneNumber": "5512345678",
  "whatsapp": "+525512345678",
  "ownerEmail": "dueña@lunawellness.example",
  "notificationEmails": ["dueña@lunawellness.example", "recepcion@lunawellness.example"],
  "timezone": "America/Mexico_City",
  "panelToken": "a1b2c3d4e5f6...",
  "color": "#1a4a2e",
  "style": "Moderno",
  "prompt": "IDENTIDAD\nEres el asistente virtual de un spa...",
  "businessHours": {
    "monday":    { "enabled": true,  "ranges": [{ "start": "10:00", "end": "19:00" }] },
    "tuesday":   { "enabled": true,  "ranges": [{ "start": "10:00", "end": "19:00" }] },
    "wednesday": { "enabled": true,  "ranges": [{ "start": "10:00", "end": "19:00" }] },
    "thursday":  { "enabled": true,  "ranges": [{ "start": "10:00", "end": "19:00" }] },
    "friday":    { "enabled": true,  "ranges": [{ "start": "10:00", "end": "19:00" }] },
    "saturday":  { "enabled": true,  "ranges": [{ "start": "10:00", "end": "16:00" }] },
    "sunday":    { "enabled": false, "ranges": [] }
  },
  "menu": [
    { "nombre": "Masaje relajante", "precio": "700", "duracion": "60" },
    { "nombre": "Manicura", "precio": "250", "duracion": "45" }
  ],
  "services": [
    { "nombre": "Masaje relajante", "precio": "700", "duracion": "60" },
    { "nombre": "Manicura", "precio": "250", "duracion": "45" }
  ],
  "features": {
    "booking": true,
    "faq": true,
    "emailNotifications": true,
    "catalog": true,
    "menu": false,
    "cancellation": true,
    "rescheduling": true
  },
  "capacityPerSlot": 2,
  "bufferMinutes": 15,
  "reservationIntervalMinutes": 15,
  "minNoticeHours": 2,
  "holidays": ["2026-12-25", "2026-01-01"]
}
```

`services` y `menu` suelen ser espejo uno del otro (`services` es la fuente con precio+duración; `menu` es el derivado que usan otras partes del sistema) — ver comentario en `api/client-chat.js` sobre `businessInfoBlock()`, que prefiere `services` y cae a `menu` solo si falta.

---

## 5. Manejo de errores

| Falla | Qué hace el sistema hoy |
|---|---|
| La IA (DeepSeek/Anthropic) responde con JSON inválido | `sanitizeInterpretation()` lo rechaza; el servidor hace **una** llamada de respaldo en texto plano sin `response_format` (`api/client-chat.js`, dentro de `callProvider()`) — el cliente nunca se queda sin respuesta, solo pierde la interpretación estructurada de ese turno |
| La llamada al proveedor de IA falla (red, 4xx/5xx) | `callDeepSeek()`/`callAnthropic()` lanzan un `Error`; sube hasta el `try/catch` del handler (`api/client-chat.js:638` y `:805-808`) → `res.status(500).json({error:'Service error'})` |
| El frontend recibe ese 500 (o cualquier fallo de red) | El `.catch()` de `send()`/`askBookingTurn()` en `widget.js`/`asistente.html` muestra un mensaje de reintento ("Uy, no me llegó tu mensaje 😅 ¿Lo intentas otra vez?" / equivalente en inglés) — la conversación NO se rompe, sigue esperando el siguiente mensaje del cliente |
| Redis no responde durante la creación de una reserva | `api/reservations.js` devuelve `503 {error:'storage_unavailable', retryable:true}` en cada punto de lectura/escritura crítico (ej. líneas 1223, 1267, 1302) — nunca se responde éxito si la escritura no se pudo confirmar |
| Redis no responde durante la carga de `client:{clientId}` en el chat | Sube al mismo `try/catch` general → 500 `Service error`, mismo comportamiento de reintento del frontend descrito arriba |
| Falla el envío de email (Resend caído, `RESEND_API_KEY` ausente) | La reserva **ya se guardó** en Redis antes de intentar el email (`api/reservations.js:1298` antes de `:1329`) — un fallo de email nunca revierte ni bloquea la reserva; la respuesta reporta honestamente `email.customer.sent`/`email.owners.sent` reales, y el frontend solo dice "te enviamos los detalles" si `d.email.customer.sent === true` |
| Mensaje del cliente demasiado largo / historial demasiado largo | Rechazo explícito con `400` antes de llegar a la IA (`api/client-chat.js:663`, `:671`) |

No hay reintentos automáticos del lado del servidor hacia el proveedor de IA (si `callDeepSeek()`/`callAnthropic()` falla, no se reintenta esa misma llamada — solo existe el respaldo de texto plano cuando el JSON es inválido, que sí implica una segunda llamada). Los reintentos ante fallos de red son manuales: el cliente tiene que volver a escribir.

---

## 6. Archivos clave del flujo del chatbot del spa

| Archivo | Qué hace |
|---|---|
| `widget.js` | Frontend embebible: UI del chat, estado de la conversación, lógica de reserva/cancelación/reagendado en el navegador |
| `asistente.html` | Frontend standalone equivalente a widget.js, con el flujo adicional de enlace seguro de email |
| `chat-core.js` | Motor compartido: validadores de campos, saneamiento de entidades de la IA, textos de resumen/confirmación, utilidades de fecha/hora |
| `api/client-chat.js` | Arma el prompt, llama a la IA (DeepSeek/Anthropic), interpreta y sanea la respuesta — nunca crea reservas |
| `lib/message-interpreter.js` | Define y sanea por forma el contrato `{intent, text, entities}` que debe devolver la IA |
| `lib/assistant-templates.mjs` | Carga las plantillas oficiales (spa/barbería/restaurante): prompt base, features, schema |
| `templates/spa/prompt-base.txt` / `prompt-base-en.txt` | Prompt base oficial del spa, en español e inglés |
| `templates/spa/features.json` / `template.json` | Qué capacidades tiene la plantilla spa y qué campos requiere |
| `api/reservations.js` | Única autoridad de creación/lectura/reagendado/cancelación de reservas; valida disponibilidad real contra Redis |
| `api/cancel-reservation.js` | Cancelación vía enlace seguro enviado por correo |
| `api/client-config.js` | Config pública del negocio para el widget/asistente, estado de cliente, y (multiplexado) la lista de reservas para el panel del dueño |
| `lib/reservation-emails.js` | Envío real de emails de confirmación/cancelación/reagendado (cliente y dueño) vía Resend |
| `lib/changes.js` / `lib/activity.js` | Cola de avisos para el resumen diario al dueño y timeline de actividad del panel |
| `lib/services.js` | Resolución de servicios por id/nombre, compartida entre el prompt y la validación de reservas |
| `lib/duration.js` | Cálculo de duración/ocupación de un servicio |
| `lib/setup.js` | Determina si al negocio le falta configuración obligatoria (`necesitaSetup`/`faltaConfig`) |
| `lib/media.js` | Carga de imágenes confirmadas del negocio para el prompt (galería/menú con foto) |
| `lib/sentry.js` | Captura de excepciones/mensajes hacia Sentry, usado por todos los archivos anteriores |
| `reservas.html` | Panel del dueño — lee reservas vía `/api/reservations-list` (rewrite a `api/client-config.js`) |
| `vercel.json` | Define los rewrites que multiplexan varias rutas lógicas sobre `api/client-config.js` para no exceder el límite de 12 funciones |

---

*Documento generado por auditoría de código en `2026-08-09`, sin ejecutar cambios. Repo: `micarlojean2-dev/jb-studio-site`, commit auditado: `b285a0c1c6a1686c08bdce63bcc6fa624076bf63`.*
