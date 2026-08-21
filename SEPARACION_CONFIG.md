# Separación motor / negocio — estado real (auditoría de solo lectura)

No se modificó ningún archivo para este informe. Todo lo citado es el código tal como existe hoy en el repo (commit `9553e60`).

**Resumen ejecutivo:** el sistema ya está mucho más separado de lo que probablemente se cree. Existe un registro oficial de plantillas (`spa`/`barber`/`restaurant`) con su propio `prompt-base.txt`, `features.json` y `questions.json` cada una, `client:{id}` en Redis ya guarda `templateId`/`menu`/`businessHours`/`staff` de forma genérica, Stripe ya está atado a `clientId` sin ninguna referencia a spa, y hay tests que YA crean y validan clientes de barbería y restaurante (`test/admin-creator-multi-template.test.mjs`, `test/template-registry.test.mjs`). Los pendientes reales son pocos, pequeños y cosméticos — no bloquean crear un cliente de otra vertical hoy mismo.

---

## 1) ¿El motor tiene lógica hardcodeada de spa que rompería barbería/restaurante?

**Casi nada, y lo poco que hay es cosmético, no funcional.**

### Encontrado (2 casos reales)

- **`widget.js:721` y `widget.js:728`** (idéntico en **`asistente.html:737` y `:744`**):
  ```js
  image.alt = entry.item && entry.item.nombre ? entry.item.nombre : (cfg.language === 'en' ? 'Spa gallery' : 'Galería del Spa');
  ```
  Si una foto de la galería no tiene `nombre`, el texto alternativo/caption cae a "Spa gallery"/"Galería del Spa" sin importar el `templateId` real del cliente. Para una barbería o restaurante sin nombre en esa foto, se vería literalmente "Galería del Spa" en el alt-text. Cosmético (accesibilidad/caption), no rompe el chat ni las reservas.

- **`api/client-chat.js:272-308` (`spaHeaderEs`) y `:311-347` (`spaHeaderEn`)**: el header de personalidad/formato/seguridad del system prompt — el que se envía a **TODOS** los clientes, sin importar `templateId` (se ve en la línea 451: `${isEnglish ? spaHeaderEn(...) : spaHeaderEs(...)}`, sin ningún `if (templateId === 'spa')` alrededor) — incluye un ejemplo fijo:
  > "¡Claro! 😊 El masaje relajante tiene un valor de $45 ✨..."  / "The relaxing massage is $45..."

  Es decir: **una barbería o restaurante hoy recibe ese mismo ejemplo de "masaje relajante" dentro de su propio system prompt.** El propio comentario en el código (líneas 264-271) documenta que esto era intencional en un momento ("estas dos variantes solo se activan cuando templateId==='spa'...") pero la generalización posterior (comentario `[auditoría — spaHeaderEn / generalización]`, línea 446) hizo que TODAS las plantillas usen esta misma función — el nombre `spaHeader*` quedó desactualizado. Riesgo bajo: es solo un ejemplo de TONO para el modelo, y el propio texto le exige explícitamente que "precios, horarios, servicios y disponibilidad salen únicamente de la información del negocio" — pero es un ejemplo tempáticamente incorrecto para otra vertical y el nombre de la función es confuso para quien mantenga esto después.

- **`lib/message-interpreter.js:160`**: un ejemplo dentro de las instrucciones de clasificación de intención ("¿cuánto cuesta el masaje?" → `general_question`). Mismo tipo de hallazgo que el anterior: un ejemplo ilustrativo, no una regla que dependa de que el negocio sea un spa. Riesgo mínimo.

### Ya generalizado (para contraste — no son problemas)

- `chat-core.js:161` (`ICON_RULES`) ya mapea íconos por palabra clave para spa, barbería, uñas, restaurante, dental, médico, gym, foto, limpieza y auto — multi-vertical desde el diseño.
- `chat-core.js` (`bookingRequirements()`, `templateId()`, `extractBooking()` con `tablePreference`/`barberPreference`) ya ramifica explícitamente por `templateId(cfg) === 'restaurant' | 'barber'`.
- `api/client-chat.js:110`, `:156-157`, `:269-271`, `:470` documentan (en comentarios) fixes previos que quitaron exactamente este tipo de restricción a `templateId === 'spa'` — el motor tiene un historial activo de generalizarse, no de asumir spa por defecto.

**Conclusión Q1:** no hay lógica de negocio (reservas, validación, extracción de datos) atada a spa. Los 2 hallazgos reales son textos de ejemplo/fallback cosméticos.

---

## 2) ¿Cómo está estructurado `client:{id}` en Redis? ¿Ya soporta tipo de negocio con su propio menú/horario/textos?

**Sí, ya lo soporta — es un objeto JSON plano (`redis.set('client:{id}', client)`, ver `api/clients.js:735`) con campos genéricos por diseño:**

Campos relevantes (citados de `api/clients.js:662-733`):
- `templateId` / `templateVersion` / `templateData` — solo presentes si se creó con una plantilla oficial (línea 679-681).
- `businessType` — **siempre igual al `templateId`** cuando hay plantilla oficial, para que nunca queden desincronizados (comentario línea 675-678: "nunca un valor suelto del body que podría no corresponder").
- `staff` — **solo** para `templateId === 'barber'` (línea 684).
- `reservationDuration` — **solo** para `templateId === 'restaurant'` (línea 730).
- `menu` / `services` / `businessHours` / `features` / `prompt` — genéricos, iguales para cualquier plantilla.

El **prompt** de cada cliente no vive hardcodeado en el motor: `lib/assistant-templates.mjs:8-21` define 3 plantillas oficiales (`spa`, `restaurant`, `barber`), cada una con su propio archivo de texto:
```
templates/spa/prompt-base.txt        templates/spa/prompt-base-en.txt
templates/barber/prompt-base.txt     templates/barber/prompt-base-en.txt
templates/restaurant/prompt-base.txt templates/restaurant/prompt-base-en.txt
```
cada una además con su propio `features.json` y `questions.json` (confirmado con `ls`, los 3 directorios existen y tienen la misma estructura de 4 archivos). `buildTemplatePrompt()` (`lib/assistant-templates.mjs:78-91`) arma el prompt final a partir del `promptBase` de LA plantilla del cliente + sus datos reales — nunca mezcla plantillas.

Confirmado con test ya existente y en verde (`test/template-registry.test.mjs:61-68`): el prompt de barbería y el de restaurante son explícitamente distintos entre sí y del de spa.

**Conclusión Q2:** no falta nada estructural. `client:{id}` ya es genérico; lo único "spa" que queda es el nombre histórico de la función de header (punto 1) y el hecho de que fue el primer vertical, no una limitación real del esquema.

---

## 3) ¿`widget.js` y `admin.html` ya son genéricos para cualquier `client_id`?

**`widget.js` / `asistente.html`: sí, genéricos**, con la única excepción cosmética ya citada en el punto 1 (fallback "Galería del Spa"). No hay ningún `clientId` ni `templateId` hardcodeado como default — se confirmó que no existe ningún `|| 'spa'` en el código de runtime (solo aparece como valor por defecto en specs de prueba, nunca en producción). El comportamiento por reserva ya se ramifica genéricamente vía `CORE.templateId(cfg)`.

**`admin.html`: funcionalmente sí, pero con una deuda de nombres importante que vale la pena conocer.**

El formulario "Crear chatbot" (el creador manual) ya es genérico en su lógica:
- `admin.html:7285`: `$('spa-type').innerHTML = TEMPLATES.map(t => ...)` — el selector de tipo de negocio se llena dinámicamente con TODAS las plantillas oficiales disponibles (spa, barbería, restaurante), no solo spa.
- `admin.html:7273-7276` (comentario del propio código): *"isSpa/isRestaurant reflejan reglas que YA existen... buffer por horario solo aplican a Spa; la duración de servicio es obligatoria para Spa/Barbería pero opcional para Restaurante"* — es decir, la ramificación por tipo de negocio ya está implementada y es correcta.
- Confirmado con test ya existente y en verde (`test/admin-creator-multi-template.test.mjs:90-138`): el mismo formulario crea correctamente clientes `spa`, `restaurant` y `barber` en un loop.

Pero **el 100% de los `id`/`class` del HTML de ese formulario siguen literalmente nombrados "spa-\*"** aunque hoy sirvan para cualquier plantilla: `spa-creator-modal`, `spa-type`, `spa-services`, `spa-hours`, `spa-capacity`, `spa-creator-summary`, etc. (ver bloque completo en `admin.html:7245-7261`). Es deuda de nombres heredada de cuando la función era literalmente "crear un Spa" — no restringe qué plantilla se puede crear, pero es confuso para cualquiera que edite ese código después pensando que es spa-específico.

**Conclusión Q3:** ambos ya son funcionalmente genéricos. Lo único que falta es cosmético: 2 strings de fallback ("Galería del Spa") y el renombrado de IDs/clases del formulario del admin (`spa-*` → algo neutral como `creator-*`).

---

## 4) ¿Stripe ya está conectado a `client:{id}` por separado?

**Sí, completamente, y de forma 100% genérica (no hay ninguna mención a spa en ningún archivo de Stripe).**

- `api/create-checkout.js:37-64`: recibe `clientId` en el body, lee `client:{clientId}` de Redis, crea la sesión de Stripe Checkout con `client_reference_id: clientId` y `metadata: { clientId }` en la sesión Y en la suscripción (`subscription_data.metadata`).
- `api/stripe-webhook.js:155-360`: cada handler de evento (`checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated/deleted`) recupera el `clientId` de `session.metadata`/`subscription.metadata`/`invoice...metadata` y llama a `updateClient(clientId, patch)` (línea 155), que hace `redis.get('client:{clientId}')` + `redis.set(...)` — siempre sobre el cliente específico, nunca un estado global.
- Campos de facturación ya están en el objeto `client` desde su creación (`api/clients.js:703-714`): `active`, `paymentStatus`, `stripeCustomerId`, `stripeSubscriptionId`, `stripeCheckoutSessionId`, `paidUntil`, `gracePeriodEndsAt`, `cancelAtPeriodEnd`, etc. — todos por cliente, ninguno compartido.

**Conclusión Q4:** confirmado, sin necesidad de verificación adicional — cada cliente (sin importar su plantilla) se factura de forma completamente independiente.

---

## 5) ¿Un `client:barberia123` de prueba funcionaría HOY, solo con JSON, sin tocar código?

**Sí — funcionalmente, todo el camino ya existe y ya está probado.** Con evidencia concreta:

1. **Creación**: `POST /api/clients` con `templateId: 'barber'` + `templateVersion` ya es un flujo oficial soportado (`api/clients.js`, ramas `templateIdSafe === 'barber'` en líneas 684, 792, 825). El creador por IA (`api/generate-client-config.js:249,465,506-554`) también dispara instrucciones específicas para `barber` (extraer `barberStaff`/`barberPolicies`). Ambos caminos están cubiertos por tests que pasan hoy (`test/admin-creator-multi-template.test.mjs`, `test/template-creation.test.mjs`).
2. **Prompt**: usaría automáticamente `templates/barber/prompt-base.txt` (o su versión en inglés), ya escrito y ya probado como distinto del de spa (`test/template-registry.test.mjs:65,67`).
3. **Reservas/validación**: `lib/setup.js:49-66` y `api/clients.js:286-306` ya ramifican por `templateId` (duración por servicio obligatoria para barbería, opcional-a-nivel-de-negocio para restaurante).
4. **Widget/asistente**: genéricos por `clientId` de la URL, sin ningún hardcode de spa que bloquee el flujo (punto 3).
5. **Cobro**: Stripe ya atado por `clientId`, sin ninguna dependencia de plantilla (punto 4).

**Lo único que NO seria "perfecto" sin tocar código** (ninguno bloquea que funcione, solo que se vería/leería un poco raro):
- El fallback de alt-text de galería diría "Galería del Spa" en fotos sin nombre (`widget.js:721,728` / `asistente.html:737,744`).
- El system prompt de esa barbería incluiría el ejemplo fijo "el masaje relajante..." como ilustración de tono (`api/client-chat.js:272-347`) — no inventaría servicios reales (el propio prompt se lo prohíbe explícitamente), pero es temáticamente incorrecto para el vertical.

**Conclusión Q5: SÍ funcionaría de punta a punta (chat + reservas + widget embebible) solo con el JSON de configuración correcto y `templateId: 'barber'`.** No encontré ningún archivo/línea que lo impida funcionalmente. Los 2 puntos de arriba son pulido cosmético, no bloqueos — recomendaría corregirlos antes de vender esto formalmente a un cliente de otra vertical (por imagen/profesionalismo), pero no antes de poder probarlo internamente hoy mismo.

---

## Resumen de hallazgos citables (para decidir qué priorizar)

| # | Archivo:línea | Qué es | Bloquea funcionalmente? |
|---|---|---|---|
| 1 | `widget.js:721,728` / `asistente.html:737,744` | Fallback de alt-text "Galería del Spa" | No — solo cosmético |
| 2 | `api/client-chat.js:272-347` (`spaHeaderEs`/`spaHeaderEn`) | Ejemplo fijo "masaje relajante" en el prompt de TODOS los clientes + nombre de función desactualizado | No — solo estilo/nombre |
| 3 | `lib/message-interpreter.js:160` | Ejemplo "el masaje" en instrucciones de clasificación | No — ejemplo ilustrativo |
| 4 | `admin.html:7245-7261` y alrededores | IDs/clases del formulario creador todos nombrados `spa-*` aunque ya crean cualquier plantilla | No — deuda de nombres |

No se encontró ningún hallazgo que bloquee crear/operar un cliente de barbería o restaurante hoy.
