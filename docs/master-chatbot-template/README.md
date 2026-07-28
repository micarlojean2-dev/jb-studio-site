# Plantilla maestra de chatbot — JB Studio

Generada el 2026-07-28 a partir del cliente que ganó una comparativa de 25 escenarios entre los 4 chatbots de producción existentes (ver `scoring-results.md`). El ganador se eligió por resultados verificados contra la API real, no por apariencia — dominó en la mecánica de reservas/reprogramación/cancelación/anti-duplicado.

## Qué hay en esta carpeta

- **`prompt-example-sanitized.txt`** — el prompt real del chatbot ganador, con nombre/dirección/teléfono/correo reemplazados por marcadores `{{ASI}}`. Es un ejemplo de la calidad de redacción a copiar, no una plantilla de código.
- **`template-config.json`** — la forma estructural de los campos del cliente (menu, businessHours, features, diseño, etc.), sanitizada, con notas inline sobre qué campos importan de verdad en runtime y cuáles son datos muertos.
- **`scoring-results.md`** — la matriz comparativa completa de los 4 chatbots y por qué ganó este.
- **`manifest.json`** — versión, fecha, checksums de los archivos de esta plantilla, chatbot de origen, pruebas que ganó, campos obligatorios/opcionales.

## Qué SÍ necesita capturar una plantilla de chatbot (y qué no)

La "inteligencia" de un chatbot en este SaaS vive en dos lugares muy distintos:

1. **Código compartido, ya existe, no hay que copiarlo**: memoria de conversación, flujo de reserva (recolectar → confirmar → crear), reprogramación, cancelación, anti-spam, anti-duplicado, reglas de no-alucinación, resistencia a jailbreak, formato de respuesta. Esto vive en `api/client-chat.js`, `chat-core.js`, `widget.js`, `api/reservations.js` — es idéntico para **todos** los clientes, sin importar cuál se use como "plantilla". Elegir un ganador no cambia ni mejora este código.
2. **Datos por cliente, esto SÍ hay que capturar**: el texto libre de `prompt` (hechos del negocio: servicios, precios, horario en texto, tono), `menu`/`services` (estructura), `businessHours` (estructura), `features` (topado por `plan`), diseño (`color`/`displayMode`/`widgetPosition`), y opcionalmente `templateId`/`templateVersion`/`templateData` si el negocio nuevo encaja en el catálogo oficial (`spa`/`restaurant`/`barber` — ver `lib/assistant-templates.mjs`).

El chatbot ganador **no usa** el catálogo oficial de plantillas — se creó con el formulario genérico (prompt + menú libres). Si el negocio nuevo es claramente un spa, restaurante o barbería, es mejor partir del catálogo oficial (`templates/{spa,restaurant,barber}/`) y usar este documento solo como referencia de tono/redacción, no como plantilla de código.

## Cómo crear un chatbot nuevo a partir de esta plantilla

1. Copia `prompt-example-sanitized.txt`, rellena todos los marcadores `{{...}}` con los datos reales del negocio nuevo, y ajusta el bloque "PERSONALIDAD Y TONO" (los únicos 3-5 adjetivos que deberían cambiar de negocio a negocio — el resto de las reglas son iguales para cualquiera).
2. Copia `template-config.json`, rellena los marcadores, y decide si el negocio encaja en un `templateId` oficial (spa/restaurant/barber) — si sí, usa ese catálogo en vez de esta plantilla genérica para los campos `templateData`.
3. Crea el cliente vía `POST /api/clients` (protegido por `ADMIN_TOKEN`) con esos campos.
4. Antes de publicarlo: revisa la nota sobre el bug de idioma compartido en `prompt-example-sanitized.txt` — los 4 chatbots probados (incluido el ganador) fallaron o fueron inconsistentes al pedírseles cambiar de español a inglés. Si el negocio nuevo necesita soporte bilingüe confiable, esto debería arreglarse en `api/client-chat.js` (función `langDirectiveFor`) antes de lanzar, no asumir que "vino de la plantilla ganadora" lo resuelve.
5. Prueba el nuevo cliente con al menos un subconjunto del guion de 25 escenarios (ver `scoring-results.md` para la lista completa) antes de considerarlo listo para un cliente real.

## Dónde está el backup completo (no en este repo)

El backup crudo y completo de los 4 clientes (incluyendo datos personales, IDs de Stripe reales de test-mode, tokens de panel) se guardó fuera de este repositorio, en una ubicación privada del equipo — nunca en Git. Ver el reporte final de la operación para la ruta exacta y el checksum de verificación.
