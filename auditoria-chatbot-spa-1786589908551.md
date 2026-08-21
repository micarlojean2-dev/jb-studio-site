# Reporte de Auditoría Completa de Chatbot — Spa (spa)
**Fecha:** 2026-08-13T02:58:28.551Z

## 1. Resumen de la Suite
- Escenarios ejecutados: 8
- Errores críticos: 1
- Errores altos: 0
- Advertencias: 1

## 2. Matriz de Resultados
| Escenario | Resultado | Observaciones |
|---|---|---|
| A — Preguntas informativas sin reservar | **ÉXITO** | Completado limpiamente |
| B — Reserva con cliente fastidioso y correcciones | **FALLO** | Completado limpiamente |
| F — Persistencia backend | **FALLO** | Reserva no hallada en Redis |
| C — Horario ocupado y propuesta alternativa | **FALLO** | No pude determinar qué está pidiendo el bot. Respuesta exacta del bot: "¿Me compartes tu hora?" |
| D — Auditoría real de slots de disponibilidad | **FALLO** | No pude determinar qué está pidiendo el bot. Respuesta exacta del bot: "Perdona, no te entendí bien 😅 ¿Me lo repites?" |
| E — Auditoría de memoria y actualización de datos | **FALLO** | No pude determinar qué está pidiendo el bot. Respuesta exacta del bot: "Perdona, no te entendí bien 😅 ¿Me lo repites?" |
| I — Idempotencia | **OBSERVACIÓN** | Respuesta diferida |
| J — Prueba de día cerrado u horario inválido | **FALLO** | No pude determinar qué está pidiendo el bot. Respuesta exacta del bot: "Perdona, no te entendí bien 😅 ¿Me lo repites?" |

## 3. Errores y Hallazgos
### Error #1 [CRÍTICO] — F
- **Tipo:** Fallo persistencia
- **Turno:** 0
- **Esperado:** Reserva en Redis
- **Real:** Redis vacío
- **Evidencia:** No se halló la reserva creada

## 4. Transcripciones Completas de los Escenarios
### Escenario A — Preguntas informativas sin reservar
**Resultado:** ÉXITO (4 turnos)
```text
1. [Bot]: Selecciona tu idioma / Choose your language
2. [Bot]: ¡Hola! 😊 Soy el asistente de Spa.

Puedo ayudarte con:

✨ Conocer nuestros servicios
📅 Reservar una cita
💰 Consultar precios

¿Qué necesitas?
3. [Cliente]: ¿cuál es el precio y la duración del masaje relajante?
4. [Bot]: ¡Claro! 😊 El masaje relajante tiene un precio de $70 y una duración de 60 minutos. Es una excelente opción para relajarte. ¿Te gustaría saber más sobre otros servicios o quizás reservar una cita?
5. [Cliente]: ¿cuáles son sus horarios de atención y su dirección?
6. [Bot]: Estamos abiertos de lunes a sábado de 10:00 a 21:00 y cerramos los domingos. 😊 Puedes encontrarnos en 123 Main Street, Portland, Oregon. ¿Te gustaría saber más sobre nuestros servicios o hacer una reserva?
7. [Cliente]: ¿tienen fotos o imágenes del local?
8. [Bot]: Aquí tienes algunas fotos 😊
```

### Escenario B — Reserva con cliente fastidioso y correcciones
**Resultado:** FALLO (14 turnos)
```text
1. [Bot]: Selecciona tu idioma / Choose your language
2. [Bot]: ¡Hola! 😊 Soy el asistente de Spa.

Puedo ayudarte con:

✨ Conocer nuestros servicios
📅 Reservar una cita
💰 Consultar precios

¿Qué necesitas?
3. [Cliente]: quiero información sobre masajes
4. [Bot]: Aquí tienes nuestros servicios 😊
5. [Cliente]: quiero el masaje descontracturante
6. [Bot]: Lamentablemente, no ofrecemos un masaje descontracturante en nuestro menú. Sin embargo, tenemos un masaje relajante y un masaje de piedras calientes que podrían interesarte. ¿Te gustaría saber más sobre alguno de ellos?
7. [Cliente]: ah perdón, quería decir el masaje relajante
8. [Bot]: ¡Perfecto! 😊 El masaje relajante tiene una duración de 60 minutos y cuesta $70. Ahora, solo necesito saber la fecha en la que te gustaría programarlo.
9. [Cliente]: ¿qué horarios tienen disponibles?
10. [Bot]: Estamos disponibles de lunes a sábado, de 10:00 a 21:00. 😊 ¿Te gustaría agendar el masaje relajante en alguna de estas fechas y horas?
11. [Cliente]: este sábado
12. [Bot]: ¡Genial! 😊 Este sábado estamos disponibles de 10:00 a 21:00. ¿A qué hora te gustaría reservar tu masaje relajante?
13. [Cliente]: a las 4 de la tarde
14. [Bot]: Una cosita 😊 ¿te refieres a las 4 de la tarde o a las 4 de la mañana?
15. [Cliente]: de la tarde
16. [Bot]: Ese horario ya está reservado, pero tengo disponibilidad a las 5:00 PM. ¿Te funciona? 😊
17. [Cliente]: sí, me parece bien ese horario
18. [Bot]: ¡Perfecto! 😊 Reservaremos tu masaje relajante este sábado a las 4 de la tarde. Solo necesito algunos datos más para completar la reserva. ¿Cuál es tu nombre?
19. [Cliente]: Carlos Jean
20. [Bot]: ¡Gracias, Carlos! 😊 Reservaremos tu masaje relajante este sábado a las 4 de la tarde. Solo necesito tu número de teléfono para completar la reserva.
21. [Cliente]: 5551234567
22. [Bot]: ¡Gracias, Carlos! 😊 Reservaremos tu masaje relajante este sábado a las 4 de la tarde. Solo necesito tu correo electrónico para completar la reserva.
23. [Cliente]: micarlojean2@gmail.com
24. [Bot]: Ese horario ya está reservado, pero tengo disponibilidad a las 5:00 PM. ¿Te funciona? 😊
25. [Cliente]: sí, me parece bien ese horario
26. [Bot]: ¡Perfecto, Carlos! 😊 Reservaremos tu masaje relajante este sábado a las 4 de la tarde. Para confirmar, aquí tienes un resumen de tu reserva: 
• Servicio: Masaje relajante 
• Fecha: Sábado 
• Hora: 4:00 PM 
• Teléfono: 5551234567 
• Correo: micarlojean2@gmail.com 

Si todo está correcto, haz clic en "Sí, confirmar" para finalizar tu reserva. ¡Esperamos verte pronto!
27. [Cliente]: espera, confirmemos mejor para este sábado a las 4 de la tarde
28. [Bot]: ¡Perfecto, Carlos! 😊 Reservaremos tu masaje relajante este sábado a las 4 de la tarde. Solo necesito algunos datos más para completar la reserva. ¿Tienes alguna petición especial que te gustaría que anotemos?
29. [Cliente]: ninguna, todo perfecto
30. [Bot]: ¡Perfecto, Carlos! 😊 Reservaremos tu masaje relajante este sábado a las 4 de la tarde. Para confirmar, aquí tienes un resumen de tu reserva: • Servicio: Masaje relajante • Fecha: Sábado • Hora: 4:00 PM • Teléfono: 5551234567 • Correo: micarlojean2@gmail.com Si todo está correcto, haz clic en "Sí, confirmar" para finalizar tu reserva. ¡Esperamos verte pronto!
```

### Escenario C — Horario ocupado y propuesta alternativa
**Resultado:** FALLO (10 turnos)
*Motivo:* No pude determinar qué está pidiendo el bot. Respuesta exacta del bot: "¿Me compartes tu hora?"
```text
1. [Bot]: Selecciona tu idioma / Choose your language
2. [Bot]: ¡Hola! 😊 Soy el asistente de Spa.

Puedo ayudarte con:

✨ Conocer nuestros servicios
📅 Reservar una cita
💰 Consultar precios

¿Qué necesitas?
3. [Cliente]: quiero información sobre masajes
4. [Bot]: Aquí tienes nuestros servicios 😊
5. [Cliente]: quiero el masaje relajante
6. [Bot]: ¡Excelente elección! 😊 El masaje relajante es muy popular entre nuestros clientes. Solo necesito saber la fecha en la que te gustaría agendarlo.
7. [Cliente]: ¿qué horarios tienen disponibles?
8. [Bot]: Nuestro spa está abierto de lunes a sábado, de 10:00 a 21:00. 😊 Si deseas, puedo ayudarte a agendar tu masaje relajante en un horario que te convenga. ¿Qué día te gustaría venir?
9. [Cliente]: este sábado
10. [Bot]: Perfecto, este sábado está disponible para tu masaje relajante. Solo necesito saber la hora que prefieres para agendarlo. 😊
11. [Cliente]: a las 4:00 PM
12. [Bot]: ¡Genial! Entonces tenemos tu masaje relajante agendado para este sábado a las 4:00 PM. 😊 Solo necesito algunos datos más: tu nombre, número de teléfono y correo electrónico, por favor.
13. [Cliente]: Miguel Carlo, mi teléfono es 5551234567 y mi correo es micarlojean2@gmail.com
14. [Bot]: Ese horario ya está reservado, pero tengo disponibilidad a las 5:00 PM. ¿Te funciona? 😊
15. [Cliente]: ¿tienes algo un poco más tarde?
16. [Bot]: ¿Tienes alguna sensibilidad, alergia, embarazo, lesión o petición especial? Escribe "No" si no tienes ninguna.
17. [Cliente]: ninguna, todo perfecto
18. [Bot]: Ese horario ya está reservado, pero tengo disponibilidad a las 5:00 PM. ¿Te funciona? 😊
19. [Cliente]: sí, a las 5 de la tarde está bien
20. [Bot]: ¿Me compartes tu hora?
```

### Escenario D — Auditoría real de slots de disponibilidad
**Resultado:** FALLO (2 turnos)
*Motivo:* No pude determinar qué está pidiendo el bot. Respuesta exacta del bot: "Perdona, no te entendí bien 😅 ¿Me lo repites?"
```text
1. [Bot]: Selecciona tu idioma / Choose your language
2. [Bot]: ¡Hola! 😊 Soy el asistente de Spa.

Puedo ayudarte con:

✨ Conocer nuestros servicios
📅 Reservar una cita
💰 Consultar precios

¿Qué necesitas?
3. [Cliente]: quiero información sobre masajes
4. [Bot]: Perdona, no te entendí bien 😅 ¿Me lo repites?
```

### Escenario E — Auditoría de memoria y actualización de datos
**Resultado:** FALLO (2 turnos)
*Motivo:* No pude determinar qué está pidiendo el bot. Respuesta exacta del bot: "Perdona, no te entendí bien 😅 ¿Me lo repites?"
```text
1. [Bot]: Selecciona tu idioma / Choose your language
2. [Bot]: ¡Hola! 😊 Soy el asistente de Spa.

Puedo ayudarte con:

✨ Conocer nuestros servicios
📅 Reservar una cita
💰 Consultar precios

¿Qué necesitas?
3. [Cliente]: quiero información sobre masajes
4. [Bot]: Perdona, no te entendí bien 😅 ¿Me lo repites?
```

### Escenario J — Prueba de día cerrado u horario inválido
**Resultado:** FALLO (2 turnos)
*Motivo:* No pude determinar qué está pidiendo el bot. Respuesta exacta del bot: "Perdona, no te entendí bien 😅 ¿Me lo repites?"
```text
1. [Bot]: Selecciona tu idioma / Choose your language
2. [Bot]: ¡Hola! 😊 Soy el asistente de Spa.

Puedo ayudarte con:

✨ Conocer nuestros servicios
📅 Reservar una cita
💰 Consultar precios

¿Qué necesitas?
3. [Cliente]: quiero información sobre masajes
4. [Bot]: Perdona, no te entendí bien 😅 ¿Me lo repites?
```
