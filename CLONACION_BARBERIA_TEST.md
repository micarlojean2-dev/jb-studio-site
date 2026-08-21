# Clonación a barbería — prueba real end-to-end

Commit base: `9553e60` (respaldo determinista fecha/hora/servicio) + `a762d77` (fixes cosméticos de esta ronda). No se tocó ningún archivo de código para crear el cliente de prueba — solo datos, vía el wizard oficial del admin panel.

---

## 1) Los 2 hallazgos cosméticos de `SEPARACION_CONFIG.md`, corregidos

**Commit `a762d77`**, desplegado y verificado en producción (`npm run test:unit`: 0 fallos).

1. **`widget.js:721,728` / `asistente.html:737,744`** — el alt-text/caption de una foto de galería sin nombre caía a "Galería del Spa" sin importar el `templateId`. Ahora usa `CORE.galleryHeading(cfg.language)`, la misma función genérica ("Galería del negocio"/"Business gallery") que ya usaba el encabezado de la sección — cero texto nuevo inventado.
2. **`api/client-chat.js`** — el header de personalidad (renombrado `spaHeaderEs`/`spaHeaderEn` → `personalityHeaderEs`/`personalityHeaderEn`, porque se manda a cualquier plantilla) tenía el ejemplo fijo "el masaje relajante... ayuda a soltar el estrés" dentro del prompt de TODO cliente. Ahora es genérico: "ese servicio... una de las opciones más pedidas" — sin nombrar ningún servicio de ninguna vertical.

**Hallazgo adicional NO corregido** (fuera del pedido de esta ronda, anotado para el futuro): el placeholder del textarea "Importar lista" en el wizard del admin panel también dice `Masaje relajante | 35000 | 60` — mismo patrón, un nivel más abajo en la UI.

---

## 2) Cliente de prueba creado: `barberia-el-corte-fino`

**No pude usar `client:barberia123` como id exacto** (bloqueo real, no elegido por mí): el wizard del admin no expone un campo de id manual — el servidor lo deriva del nombre del negocio (slug). Tampoco pude crear el cliente por Redis/API directamente:

- El `ADMIN_TOKEN` en `.env.prod` local es un placeholder vacío (no el secreto real de Vercel) → `POST /api/clients` devolvió 401.
- La conexión Upstash MCP es de solo lectura → `SET client:barberia123` devolvió `NOPERM`.

Con tu autorización, usé el wizard real "Crear chatbot" del admin panel (tú ya habías iniciado sesión) — así el servidor generó el prompt real vía `buildTemplatePrompt()` en vez de que yo lo armara a mano. Resultado: **`client:barberia-el-corte-fino`**, `templateId: 'barber'`, `templateVersion: '1.0'`.

**Datos ficticios cargados:**
- Negocio: Barbería El Corte Fino — Av. Providencia 1234, Santiago — Chile +56 912345678 — America/Santiago
- Horario: lunes a sábado 10:00–20:00, domingo cerrado
- Servicios: Corte de cabello ($25, 30 min) · Corte + Barba ($35, 45 min) · Afeitado clásico ($20, 25 min) · Diseño de barba ($15, 20 min) · Corte de niño ($18, 25 min)
- Capacidad: 2 barberos simultáneos

Confirmado en el propio wizard: la etiqueta de capacidad decía **"Capacidad por horario (barberos simultáneos)"** — no "citas" genérico ni "camillas" de spa — evidencia extra de que el formulario ya es dinámico por plantilla, más allá de lo documentado en `SEPARACION_CONFIG.md`.

---

## 3) Flujo de reserva real — resultado

Probado contra producción real (`https://jbstudio.app/asistente/barberia-el-corte-fino`) usando un token de vista previa (el cliente aún no tiene pago real — ver bloqueo abajo) y el mismo header de bypass de rate limit ya desplegado.

```
cliente: "Hola, quiero reservar un corte de cabello"
  bot: "¡Claro! Un corte de cabello es una excelente elección. 😊 ¿qué día te acomoda venir?"
cliente: "El viernes"
  bot: "¡Perfecto, el viernes! 😊 ¿A qué hora te gustaría venir?"
cliente: "A las 4 pm"
  bot: "¡Genial, el viernes a las 4 pm queda anotado! 😊 ¿Me podrías decir tu nombre para la reserva?"
cliente: "Me llamo QA Barberia Test"
  bot: "Uy, eso no funcionó. Dime otra hora y reviso 😊"          ← ver hallazgo abajo
cliente: "555-020-0200"
  bot: "¡Gracias, QA Barberia Test! 😊 ¿me dejas un teléfono o correo de contacto?"
cliente: "qa-barberia123-noreply@example.com"
  bot: "¡Perfecto, gracias! 😊 ¿Hay alguna preferencia especial...?"
cliente: "No"
  bot: "¡Listo! 😊 Con eso tenemos todo para mostrar el resumen y que confirmes."

bookingData final: {"servicio":"Corte de cabello","fecha":"El viernes"}
```

### ✅ Servicio — capturado correctamente
"Corte de cabello" (un servicio real de barbería, no de spa) se guardó bien en `bookingData.servicio`, confirmando que el respaldo determinista `extraerServicioFallback()` del commit `9553e60` generaliza a un cliente nuevo y a servicios que nunca antes había visto el sistema.

### ✅ Fecha — capturada correctamente
"El viernes" se guardó bien en `bookingData.fecha`, mismo resultado.

### ✅ Sin ninguna mención real de spa
Revisión manual de las 12 líneas de transcripción: cero menciones a "spa", "masaje", "facial", "exfoliación", "manicura" o "pedicura". Todo el vocabulario es de barbería ("corte de cabello", "barbero", "✂️"). (El script de prueba marcó un falso positivo de "spa" — resultó ser una coincidencia de substring dentro de la palabra "Español"; verificado a mano, no es una mención real.)

### ❌ Hora — NO quedó guardada, por un hallazgo nuevo (no es un problema de spa/barbería)

**Causa raíz confirmada con logs reales de Vercel:**
```
18:58:18 POST /api/reservations 403
```

`widget.js:881-912` (`validarDisponibilidadTemprana`) hace una llamada temprana a `/api/reservations` (`action:'validate'`) en cuanto servicio+fecha+hora están completos, para chequear disponibilidad real antes de seguir. Esa llamada llegó con **403 Client inactive** — porque `api/reservations.js:915` exige `client.active === true` **sin excepción de vista previa**, a diferencia de `api/client-chat.js`, que sí acepta un `previewToken` para clientes que aún no pagaron (así es como pude probar el chat en general sin pago real). Un cliente recién creado por el wizard queda `active:false` hasta el primer pago — así que **cualquier cliente nuevo de CUALQUIER plantilla (spa/barber/restaurant), mientras está en modo vista previa antes de pagar, chocará con este mismo 403** en cuanto intente completar la reserva.

Al recibir esa respuesta sin un `motivo` reconocido, `widget.js:897-899` hace `delete bookingData['hora']` y muestra el mensaje genérico "Uy, eso no funcionó" — perdiendo la hora que sí se había capturado bien un turno antes. **No es un problema de separación motor/negocio ni de la barbería específicamente** — es un vacío general en el flujo de vista previa, recién descubierto porque esta fue la primera vez que se probó una reserva completa contra un cliente en estado "esperando pago" en vez de `active:true` directo.

También noté que el último mensaje del bot ("Con eso tenemos todo para mostrar el resumen") es engañoso: el código NO mostró el resumen ni el botón de confirmar (correcto, dado que `hora` sigue faltando), pero el texto libre de la IA afirmó lo contrario — mismo patrón de fondo (texto conversacional vs. estado real) ya documentado para el cliente spa.

**No corregí este hallazgo** — está fuera del alcance de "arregla los 2 hallazgos cosméticos" y del pedido de esta ronda. Si quieres, en otra tarea puedo diagnosticarlo a fondo y proponer un fix (por ejemplo, que `/api/reservations?action=validate` también acepte `previewToken` de solo lectura, igual que `client-chat.js`).

---

## Resumen

| Verificación pedida | Resultado |
|---|---|
| Fix 1 (alt-text galería) | ✅ Corregido y desplegado |
| Fix 2 (ejemplo "masaje" en prompt) | ✅ Corregido y desplegado |
| Crear cliente de barbería solo con datos (sin tocar código) | ✅ Creado (`barberia-el-corte-fino`, no `barberia123` — ver bloqueo de id) |
| Reserva guarda servicio | ✅ |
| Reserva guarda fecha | ✅ |
| Reserva guarda hora | ❌ — bloqueado por un 403 en `/api/reservations` para clientes en vista previa (hallazgo nuevo, no relacionado con spa/barbería) |
| No menciona nada de spa | ✅ Confirmado (0 menciones reales) |

No se tocó `mergeBookingEntities()`, el prompt de la IA, ni ningún otro archivo fuera de los 2 fixes pedidos. El cliente de prueba `barberia-el-corte-fino` sigue existiendo en producción (sin pago real, `paymentStatus:'pending'`) — puedo borrarlo si me autorizas, o dejarlo para seguir probando.
