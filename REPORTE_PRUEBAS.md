# Reporte de pruebas — chatbot Spa (asistente.html)

Generado automáticamente por `tests/e2e/chatbot-pruebas.spec.js` (Playwright, navegador real, mocks deterministas de `/api/client-config`, `/api/client-chat`, `/api/reservations` — sin llamar al modelo real ni escribir en Redis real).

**Nota:** el Escenario 2 cubre el bug ya conocido ("si el cliente da su nombre en un mensaje casual antes de que el bot detecte intent=`booking`, ese dato se pierde y luego se vuelve a preguntar" — `widget.js:1538-1552` / `asistente.html:1569-1583`), corregido en esta misma ronda junto con los otros dos hallazgos de la corrida anterior.

---

## Resumen final — 3 bugs corregidos, 10/10 escenarios PASÓ

| # | Bug | Archivo(s) | Fix | Resultado |
|---|---|---|---|---|
| 1 | La pregunta de sensibilidad/alergia/embarazo/petición especial se repetía en bucle — ninguna respuesta la completaba, así que ninguna reserva podía cerrarse por conversación normal | `widget.js:914-923`, `asistente.html:948-956` (`tryLocalBookingShortcut`) | Se agregó `yaEsperabaPeticionEspecial`: la pregunta enlatada solo se muestra la PRIMERA vez que se entra a ese campo; en la respuesta del cliente, el turno ya no se corta antes de intentar procesarla (la lógica "BARE_OK" que la captura ahora sí se alcanza) | Escenario 1: FALLÓ → **PASÓ** |
| 2 | Al cancelar a mitad del flujo, `bookingData` nunca se limpiaba en `sessionStorage` (faltaba `save()`) — recargar la página justo después resucitaba la reserva "cancelada" | `widget.js:1384-1408`, `asistente.html:1441-1465` | Se agregó `save()` al final de la rama de cancelar, más `bookingPending = null` (mismo reseteo que ya se hacía tras una reserva exitosa) para evitar un valor obsoleto cruzando a la siguiente reserva | Escenario 7: FALLÓ → **PASÓ** (verificado con una recarga real tras cancelar) |
| 3 | Nombre/servicio/etc. dados en un mensaje casual ANTES de que el intent fuera `booking` se perdían y el bot los volvía a pedir | `widget.js:1546-1571`, `asistente.html:1578-1600` | Nueva variable `preBookingMemory` (mismo patrón que ya usaba `selectedService` solo para el servicio): acumula cualquier entity extraída en chat libre y se aplica a `bookingData` en cuanto arranca la reserva; se limpia al cancelar, al confirmar con éxito, y en el reset del flujo de enlace de correo | Escenario 2: verificado → **PASÓ** |

**Suite completa tras los 3 fixes (`tests/e2e/chatbot-pruebas.spec.js`):** 10/10 escenarios PASÓ, corrida completa sin regresiones en los 7 que ya pasaban antes.

**Batería existente del repo (sin cambios, para confirmar que los fixes no rompieron nada fuera de este spec):**
- `npm test` (32 archivos) → **exit 0**, 0 fallos.
- `npm run test:unit` (cadena completa) → **exit 0**, 0 fallos (incluye `test/bug-830pm-800pm.test.mjs`, `test/booking-corrections.test.mjs`, `test/etapa2-entities.test.mjs` y el resto de tests que ejercitan `tryLocalBookingShortcut`, la rama de cancelar, y el dispatch general que se tocaron).

**Pendientes no tocados en esta ronda** (fuera del alcance pedido):
- `preBookingMemory` no se persiste en `sessionStorage` — si el cliente menciona un dato casual y recarga la página ANTES de decir "quiero reservar", ese dato sí se perdería (no estaba en el reporte original ni se pidió cubrirlo).
- `CORRECCION_RE` sigue siendo solo-español (hallazgo de la auditoría original, no tocado).
- El resto de bugs/pendientes ya documentados en auditorías anteriores.

---

## Escenario 1 — Cliente normal, datos ordenados

**Mensajes enviados y respuestas:**
- **bot:** ✦¡Hola! 😊 Soy el asistente de Spa QA Playwright. ⏎ Puedo ayudarte con: ⏎ ✨ Conocer nuestros servicios ⏎ 📅 Reservar una cita ⏎ 💰 Consultar precios ⏎ ¿Qué necesitas?
- **botones:** ✨ Ver servicios | 📅 Reservar | 💰 Precios
- **cliente:** Quiero reservar una cita
- **bot:** ✦¿Qué servicio te gustaría reservar?
- **cliente:** Masaje relajante
- **bot:** ✦¿Qué día te gustaría venir?
- **cliente:** El viernes
- **bot:** ✦¿A qué hora?
- **cliente:** A las 4 pm
- **bot:** ✦¿Me compartes tu nombre?
- **cliente:** Ana López
- **bot:** ✦¿Tu teléfono?
- **cliente:** 5551234567
- **bot:** ✦¿Tu correo?
- **cliente:** ana@example.com
- **bot:** ✦¿Tienes alguna sensibilidad, alergia, embarazo, lesión o petición especial? Escribe "No" si no tienes ninguna.
- **cliente:** No
- **bot:** ✦Perfecto Ana 😊 revisemos que todo esté correcto antes de confirmar: ⏎ 👤 Nombre: Ana López ⏎ ✂️ Servicio: Masaje relajante ⏎ 📅 Fecha: viernes ⏎ ⏰ Hora: 4:00 PM ⏎ 📞 Teléfono: 5551234567 ⏎ ✉️ Correo: ana@example.com ⏎ ¿Todo correcto? 😄
- **cliente:** ✅ Sí, confirmar cita
- **bot:** ✦Revisando disponibilidad…
- **bot:** ✦✅ Tu cita quedó confirmada. ⏎ Te enviamos los detalles a tu correo. ⏎ Revisa también spam por si acaso. ⏎ Gracias por reservar en Spa QA Playwright 😊

**Verdicto: PASÓ**
- Sin problemas encontrados: cada dato se pidió una sola vez, el resumen refleja todo lo dado, y la confirmación real solo ocurrió tras pulsar el botón.

## Escenario 2 — Nombre y servicio en el primer mensaje, antes de "quiero reservar"

**Mensajes enviados y respuestas:**
- **bot:** ✦¡Hola! 😊 Soy el asistente de Spa QA Playwright. ⏎ Puedo ayudarte con: ⏎ ✨ Conocer nuestros servicios ⏎ 📅 Reservar una cita ⏎ 💰 Consultar precios ⏎ ¿Qué necesitas?
- **botones:** ✨ Ver servicios | 📅 Reservar | 💰 Precios
- **cliente:** Hola, soy Carla y quiero una manicura
- **bot:** ✦Hola Carla 😊 ¿en qué te ayudo?
- **cliente:** Quiero reservar
- **bot:** ✦Perfecto, dame un momento.

**bookingData tras arrancar la reserva:** `{"servicio":"Manicura","nombre":"Carla"}`

**Verdicto: PASÓ** (bug ya conocido — `widget.js:1538-1552` / `asistente.html:1569-1583` — ahora corregido con `preBookingMemory`)
- El nombre ("Carla") y el servicio ("Manicura") dados en el mensaje casual, antes de que el intent fuera `booking`, sobrevivieron y se aplicaron a bookingData al arrancar la reserva — ya no se pierden ni se vuelven a pedir.

## Escenario 3 — Cambia de opinión de servicio a mitad del flujo

**Mensajes enviados y respuestas:**
- **bot:** ✦¡Hola! 😊 Soy el asistente de Spa QA Playwright. ⏎ Puedo ayudarte con: ⏎ ✨ Conocer nuestros servicios ⏎ 📅 Reservar una cita ⏎ 💰 Consultar precios ⏎ ¿Qué necesitas?
- **botones:** ✨ Ver servicios | 📅 Reservar | 💰 Precios
- **cliente:** Quiero un masaje relajante
- **bot:** ✦¿Qué día te gustaría?
- **cliente:** Mejor manicura
- **bot:** ✦Perfecto, manicura. ¿Qué día te gustaría?
- **cliente:** El sábado
- **bot:** ✦¿A qué hora?

**bookingData final en sessionStorage:** `{"servicio":"Manicura","fecha":"sábado"}`

**Verdicto: PASÓ**
- El cambio de servicio se aplicó correctamente (Masaje → Manicura) sin perder ni repetir nada, y el flujo siguió pidiendo el siguiente dato real (fecha).

## Escenario 4 — Corrige fecha y hora ya dadas

**Mensajes enviados y respuestas:**
- **bot:** ✦¡Hola! 😊 Soy el asistente de Spa QA Playwright. ⏎ Puedo ayudarte con: ⏎ ✨ Conocer nuestros servicios ⏎ 📅 Reservar una cita ⏎ 💰 Consultar precios ⏎ ¿Qué necesitas?
- **botones:** ✨ Ver servicios | 📅 Reservar | 💰 Precios
- **cliente:** Quiero un masaje relajante
- **bot:** ✦¿Qué día?
- **cliente:** El jueves
- **bot:** ✦¿A qué hora?
- **cliente:** A las 5 pm
- **bot:** ✦¿Me compartes tu nombre?
- **cliente:** Mejor el viernes
- **bot:** ✦Listo, cambiado a viernes.
- **cliente:** Mejor a las 6 pm
- **bot:** ✦Cambiado a las 6 pm. ¿Me compartes tu nombre?

**bookingData final:** `{"servicio":"Masaje relajante","fecha":"viernes","hora":"6:00 PM"}`

**Verdicto: PASÓ**
- Ambas correcciones (fecha y hora) se aplicaron sin afectar el servicio ya elegido.

## Escenario 5 — Todos los datos en un solo mensaje largo

**Mensajes enviados y respuestas:**
- **bot:** ✦¡Hola! 😊 Soy el asistente de Spa QA Playwright. ⏎ Puedo ayudarte con: ⏎ ✨ Conocer nuestros servicios ⏎ 📅 Reservar una cita ⏎ 💰 Consultar precios ⏎ ¿Qué necesitas?
- **botones:** ✨ Ver servicios | 📅 Reservar | 💰 Precios
- **cliente:** Hola, quiero reservar un masaje relajante para el viernes a las 4 pm, me llamo Sofía Ruiz y mi teléfono es 5559876543
- **bot:** ✦¿Me compartes tu correo?

**bookingData final:** `{"servicio":"Masaje relajante","fecha":"viernes","hora":"4:00 PM","nombre":"Sofía Ruiz","telefono":"5559876543"}`

**Verdicto: PASÓ**
- Los 5 datos del único mensaje se capturaron todos en el mismo turno; solo se pidió el correo, que era lo único faltante.

## Escenario 6 — Pregunta precio a mitad de la reserva, sin cancelar

**Mensajes enviados y respuestas:**
- **bot:** ✦¡Hola! 😊 Soy el asistente de Spa QA Playwright. ⏎ Puedo ayudarte con: ⏎ ✨ Conocer nuestros servicios ⏎ 📅 Reservar una cita ⏎ 💰 Consultar precios ⏎ ¿Qué necesitas?
- **botones:** ✨ Ver servicios | 📅 Reservar | 💰 Precios
- **cliente:** Quiero un masaje relajante
- **bot:** ✦¿Qué día te gustaría?
- **cliente:** ¿Cuánto cuesta?
- **bot:** ✦El masaje relajante cuesta $700 y dura 60 minutos. ¿Seguimos con tu reserva?
- **cliente:** El sábado
- **bot:** ✦¿A qué hora?

**bookingData final:** `{"servicio":"Masaje relajante","fecha":"sábado"}`

**Verdicto: PASÓ**
- La pregunta de precio se respondió sin interrumpir ni perder el estado de la reserva en curso.

## Escenario 7 — Cancela a mitad del flujo

**Mensajes enviados y respuestas:**
- **bot:** ✦¡Hola! 😊 Soy el asistente de Spa QA Playwright. ⏎ Puedo ayudarte con: ⏎ ✨ Conocer nuestros servicios ⏎ 📅 Reservar una cita ⏎ 💰 Consultar precios ⏎ ¿Qué necesitas?
- **botones:** ✨ Ver servicios | 📅 Reservar | 💰 Precios
- **cliente:** Quiero un masaje relajante
- **bot:** ✦¿Qué día te gustaría?
- **cliente:** El viernes
- **bot:** ✦¿A qué hora?
- **cliente:** cancelar
- **bot:** ✦Reserva cancelada. ¿Hay algo más en lo que pueda ayudarte?

**bookingData tras cancelar (en memoria, mensaje mostrado correctamente):** `null`


**Verdicto: PASÓ**
- La cancelación fue inmediata, local (sin llamar a la IA), con mensaje claro y bookingData limpio incluso tras recargar.

## Escenario 8 — Errores de ortografía y mensajes abreviados

**Mensajes enviados y respuestas:**
- **bot:** ✦¡Hola! 😊 Soy el asistente de Spa QA Playwright. ⏎ Puedo ayudarte con: ⏎ ✨ Conocer nuestros servicios ⏎ 📅 Reservar una cita ⏎ 💰 Consultar precios ⏎ ¿Qué necesitas?
- **botones:** ✨ Ver servicios | 📅 Reservar | 💰 Precios
- **cliente:** q dia tenes libre
- **bot:** ✦Disculpa, no entendí bien 😅 ¿me lo puedes repetir?
- **cliente:** que horario tienen
- **bot:** ✦Abrimos de 10am a 7pm entre semana, y sábados de 10am a 4pm.
- **cliente:** kiero un masaj
- **bot:** ✦¡Claro! ¿qué día te gustaría?

**bookingData final:** `{"servicio":"Masaje relajante"}`

**Verdicto: PASÓ**
- El código manejó correctamente tanto el caso de "no entendí" (intent unknown) como el caso de comprensión exitosa, sin trabarse ni perder estado.

**Aclaración importante:** este escenario usa una interpretación SIMULADA para cada mensaje — la tolerancia REAL a errores de ortografía depende del modelo de IA en vivo (DeepSeek), no de este código, y no puede verificarse con mocks. Esta prueba solo confirma que el CÓDIGO se comporta bien sea cual sea el resultado que la IA devuelva (entendido o no entendido), no mide qué tan bien la IA real entiende texto con errores. Esa verificación queda pendiente como "conversaciones con el modelo real" (ver `docs/QA-STATUS.md`).

## Escenario 9 — Hora fuera del horario del negocio

**Mensajes enviados y respuestas:**
- **bot:** ✦¡Hola! 😊 Soy el asistente de Spa QA Playwright. ⏎ Puedo ayudarte con: ⏎ ✨ Conocer nuestros servicios ⏎ 📅 Reservar una cita ⏎ 💰 Consultar precios ⏎ ¿Qué necesitas?
- **botones:** ✨ Ver servicios | 📅 Reservar | 💰 Precios
- **cliente:** Quiero un masaje relajante
- **bot:** ✦¿Qué día te gustaría?
- **cliente:** El lunes
- **bot:** ✦¿A qué hora?
- **cliente:** A las 9 pm
- **bot:** ✦En ese horario ya estamos cerrados. Dime otra hora y reviso.
- **cliente:** Mejor a las 6 pm
- **bot:** ✦¿Me compartes tu nombre?

**bookingData final:** `{"servicio":"Masaje relajante","fecha":"lunes","hora":"6:00 PM"}`

**Verdicto: PASÓ**
- La hora fuera de horario (9 PM) se rechazó correctamente sin guardarse, y la corrección a una hora válida (6 PM) sí se aceptó.

## Escenario 10 — Recarga de página a mitad del flujo

**Estado en sessionStorage antes de recargar:** `{"servicio":"Manicura","fecha":"sábado"}`
**Estado en sessionStorage justo después de recargar:** `{"servicio":"Manicura","fecha":"sábado"}`

**Mensajes enviados y respuestas (incluye lo posterior a la recarga):**
- **bot:** ✦¡Hola! 😊 Soy el asistente de Spa QA Playwright. ⏎ Puedo ayudarte con: ⏎ ✨ Conocer nuestros servicios ⏎ 📅 Reservar una cita ⏎ 💰 Consultar precios ⏎ ¿Qué necesitas?
- **cliente:** Quiero una manicura el sábado
- **bot:** ✦¿A qué hora?
- **cliente:** A las 11 am
- **bot:** ✦¿Me compartes tu nombre?

**Verdicto: PASÓ**
- sessionStorage restauró bookingData/bookingStep exactamente como quedaron antes de recargar, y la conversación continuó sin repetir preguntas ni perder datos.

