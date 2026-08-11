# Reporte de Batería de 60 Pruebas de Disponibilidad (Restaurante E2E Intenso - ES + EN)

**Fecha de ejecución**: 2026-08-11T16:28:12.242Z  
**Cliente probado**: `restaurante-e2e-intenso`  
**Endpoint**: `https://jbstudio.app/api/client-chat?__bypass=test_bypass_secret_2026`  
**Modelo de IA**: `openai / gpt-4o-mini`  

---

## 📊 Resumen Ejecutivo

- **Total de pruebas**: 60
- **Pruebas Exitosas (PASÓ)**: 58 (97%)
- **Pruebas Fallidas (FALLÓ)**: 2

---

## 📧 Verificación de Correos Reales (Resend)

*No se registraron reservas completadas con envío de correo en esta batería.*

---

## 📋 Detalle de las Conversaciones

| # | Descripción | Prompt Final | Intent | Estado | Latencia | Resultado |
|---|-------------|--------------|--------|--------|----------|-----------|
| 1 | Mañana abierto | "¿qué horas tienen disponible mañana?" | `general_question` | 200 | 2122ms | ✅ PASÓ |
| 2 | Hoy libre | "¿qué horas tienen libres hoy?" | `general_question` | 200 | 2200ms | ✅ PASÓ |
| 3 | Viernes | "¿tienen algo disponible el viernes?" | `booking` | 200 | 3082ms | ✅ PASÓ |
| 4 | Semana | "¿a qué hora puedo ir esta semana?" | `general_question` | 200 | 1861ms | ✅ PASÓ |
| 5 | Con servicio | "quiero Mesa para 2 personas, ¿cuándo hay espacio?" | `booking` | 200 | 1957ms | ✅ PASÓ |
| 6 | Tarde | "¿tienen hueco en la tarde?" | `booking` | 200 | 4415ms | ✅ PASÓ |
| 7 | Mañana am | "¿algo disponible en la mañana?" | `booking` | 200 | 1939ms | ✅ PASÓ |
| 8 | Urgente | "necesito una cita urgente, ¿qué tienen ahorita?" | `booking` | 200 | 2284ms | ✅ PASÓ |
| 9 | Comparación días | "¿qué día tienen más disponibilidad?" | `general_question` | 200 | 2020ms | ✅ PASÓ |
| 10 | Opciones semana | "dame opciones para esta semana" | `show_menu` | 200 | 1470ms | ✅ PASÓ |
| 11 | Cambio de servicio | "Mejor otra opción, ¿qué horas hay?" | `general_question` | 200 | 1697ms | ✅ PASÓ |
| 12 | Día cerrado | "¿Tienen citas libres este domingo?" | `general_question` | 200 | 1845ms | ✅ PASÓ |
| 13 | Fecha lejana | "¿Qué disponibilidad tienen para el 15 de octubre?" | `booking` | 200 | 6550ms | ✅ PASÓ |
| 14 | Reserva real + Envío de correo Resend | "Agendar a las 11:00 AM, mi nombre es Carlos Test, email carlostest.e2e@gmail.com" | `booking` | 200 | 1951ms | ❌ FALLÓ |
| 15 | Ortografía | "q oras tienen libre mañna" | `general_question` | 200 | 2226ms | ✅ PASÓ |
| 16 | Franja especifica | "¿Tienen horarios disponibles mañana por la mañana?" | `general_question` | 200 | 2340ms | ✅ PASÓ |
| 17 | Ambigua | "¿cuándo puedo ir?" | `booking` | 200 | 1854ms | ✅ PASÓ |
| 18 | Servicio especifico | "Quiero Mesa para 2 personas, ¿qué horas hay libres mañana?" | `booking` | 200 | 2165ms | ✅ PASÓ |
| 19 | Repetir disponibilidad | "¿Me repites qué horas eran?" | `general_question` | 200 | 1350ms | ✅ PASÓ |
| 20 | Consulta por más tarde | "¿Y más tarde en la tarde?" | `general_question` | 200 | 2775ms | ✅ PASÓ |
| 21 | Con nombre | "Hola, soy Roberto. ¿Qué horas tienen libres mañana?" | `booking` | 200 | 3284ms | ✅ PASÓ |
| 22 | Servicio + día | "Quiero Mesa para 2 personas. ¿Qué horarios hay libres el viernes?" | `booking` | 200 | 2565ms | ✅ PASÓ |
| 23 | Con email | "Mi correo es roberto@example.com. ¿Qué citas hay mañana?" | `general_question` | 200 | 1762ms | ✅ PASÓ |
| 24 | Pedir lista de horas | "Dime qué horas sí tienen libres mañana" | `booking` | 200 | 1727ms | ✅ PASÓ |
| 25 | Nombre + mañana | "Hola soy Pedro. ¿Qué disponibilidad hay mañana?" | `booking` | 200 | 2252ms | ✅ PASÓ |
| 26 | Con notas | "Tengo preferencia por atención tranquila. ¿Qué horas hay disponibles?" | `general_question` | 200 | 1996ms | ✅ PASÓ |
| 27 | Disponibilidad tras precio | "Excelente, ¿qué horas hay libres mañana para agendar?" | `booking` | 200 | 2162ms | ✅ PASÓ |
| 28 | Sábado | "¿Tienen huecos disponibles este sábado?" | `general_question` | 200 | 2366ms | ✅ PASÓ |
| 29 | Consulta libre | "¿Qué horarios tienen libres mañana para atención?" | `general_question` | 200 | 1855ms | ✅ PASÓ |
| 30 | Último turno | "¿Cuál es el último turno disponible mañana?" | `general_question` | 200 | 1343ms | ✅ PASÓ |
| 31 | Tomorrow open | "What times are open tomorrow?" | `booking` | 200 | 2777ms | ✅ PASÓ |
| 32 | Today free | "What times do you have free today?" | `booking` | 200 | 3292ms | ✅ PASÓ |
| 33 | Friday | "Anything available on Friday?" | `general_question` | 200 | 2060ms | ✅ PASÓ |
| 34 | This week | "What time can I come this week?" | `general_question` | 200 | 1542ms | ✅ PASÓ |
| 35 | With service | "I want Table for 2, when is there space?" | `booking` | 200 | 2373ms | ✅ PASÓ |
| 36 | Afternoon | "Any open slots in the afternoon?" | `booking` | 200 | 1650ms | ✅ PASÓ |
| 37 | Morning | "Anything available in the morning?" | `general_question` | 200 | 1650ms | ✅ PASÓ |
| 38 | Urgent | "I need an urgent appointment, what is free right now?" | `unknown` | 200 | 1546ms | ✅ PASÓ |
| 39 | Day comparison | "Which day has the most availability?" | `general_question` | 200 | 1596ms | ✅ PASÓ |
| 40 | Week options | "Give me options for this week" | `show_menu` | 200 | 1096ms | ✅ PASÓ |
| 41 | Service change | "Better another option, what times are there?" | `general_question` | 200 | 1382ms | ✅ PASÓ |
| 42 | Closed day | "Do you have open slots this Sunday?" | `general_question` | 200 | 1923ms | ✅ PASÓ |
| 43 | Distant date | "What availability do you have for October 15th?" | `booking` | 200 | 1955ms | ✅ PASÓ |
| 44 | Real booking + Resend email dispatch | "Book 11:00 AM, my name is Charles Test, email carlostest.e2e@gmail.com" | `booking` | 200 | 1728ms | ❌ FALLÓ |
| 45 | Typos | "wht times r free tomow" | `general_question` | 200 | 1879ms | ✅ PASÓ |
| 46 | Specific window | "Do you have open time slots tomorrow morning?" | `booking` | 200 | 2284ms | ✅ PASÓ |
| 47 | Ambiguous | "When can I come in?" | `unknown` | 200 | 3069ms | ✅ PASÓ |
| 48 | Specific item | "I want Table for 2, what times are free tomorrow?" | `booking` | 200 | 3114ms | ✅ PASÓ |
| 49 | Repeat availability | "Can you repeat what times those were?" | `general_question` | 200 | 1305ms | ✅ PASÓ |
| 50 | Query for later | "And later in the afternoon?" | `general_question` | 200 | 2062ms | ✅ PASÓ |
| 51 | With name | "Hi, I am Robert. What times are open tomorrow?" | `booking` | 200 | 2671ms | ✅ PASÓ |
| 52 | Service + day | "I want Table for 2. What times are free Friday?" | `booking` | 200 | 2087ms | ✅ PASÓ |
| 53 | With email | "My email is roberto@example.com. What slots tomorrow?" | `booking` | 200 | 2853ms | ✅ PASÓ |
| 54 | Request list of open hours | "Tell me what times you do have open tomorrow" | `general_question` | 200 | 2151ms | ✅ PASÓ |
| 55 | Name + tomorrow | "Hi I am Peter. What availability is there tomorrow?" | `booking` | 200 | 1481ms | ✅ PASÓ |
| 56 | With notes | "I prefer quiet attention. What times are open?" | `general_question` | 200 | 2143ms | ✅ PASÓ |
| 57 | Availability after price | "Great, what times are free tomorrow to book?" | `booking` | 200 | 2571ms | ✅ PASÓ |
| 58 | Saturday | "Do you have open slots this Saturday?" | `general_question` | 200 | 1955ms | ✅ PASÓ |
| 59 | Open query | "What time slots are free tomorrow for service?" | `booking` | 200 | 2162ms | ✅ PASÓ |
| 60 | Last slot | "What is the last available slot tomorrow?" | `general_question` | 200 | 2835ms | ✅ PASÓ |

---

## 📝 Transcripción Completa de Respuestas

### Test #1: Mañana abierto
- **Prompt**: "¿qué horas tienen disponible mañana?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2122ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Para mañana, 12 de agosto, tenemos varias horas disponibles: 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM y 3:30 PM, entre otros. ¿Te gustaría reservar alguna de estas horas?
> [MOSTRAR_MENU]

---

### Test #2: Hoy libre
- **Prompt**: "¿qué horas tienen libres hoy?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2200ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Hoy tenemos varias horas disponibles para que elijas. Puedes reservar a las 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM o 3:30 PM. ¿Cuál te gustaría?
> [MOSTRAR_MENU]

---

### Test #3: Viernes
- **Prompt**: "¿tienen algo disponible el viernes?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (3082ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Para el viernes 14 de agosto tenemos varias horas disponibles. Puedes elegir entre 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM y 3:30 PM, entre otros. ¿Cuál prefieres?

---

### Test #4: Semana
- **Prompt**: "¿a qué hora puedo ir esta semana?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1861ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Esta semana estamos abiertos de lunes a sábado, de 11:00 a 23:00. El domingo cerramos. ¿Te gustaría hacer una reserva para algún día en particular?

---

### Test #5: Con servicio
- **Prompt**: "quiero Mesa para 2 personas, ¿cuándo hay espacio?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1957ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 La mesa para 2 personas está disponible y no tiene costo. Puedes disfrutarla por 90 minutos. ¿Te gustaría reservar para hoy o prefieres otro día?

---

### Test #6: Tarde
- **Prompt**: "¿tienen hueco en la tarde?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (4415ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Claro, tenemos disponibilidad en la tarde. ¿Para cuántas personas te gustaría reservar y a qué hora te gustaría venir?

---

### Test #7: Mañana am
- **Prompt**: "¿algo disponible en la mañana?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1939ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Para mañana, tenemos varias horas disponibles en la mañana. Puedes elegir entre las siguientes: 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM y 2:30 PM. ¿Cuál prefieres?

---

### Test #8: Urgente
- **Prompt**: "necesito una cita urgente, ¿qué tienen ahorita?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2284ms)
- **Respuesta de la IA**:
> No puedo confirmar citas en este momento, pero puedo ayudarte con información del negocio. 😊 Actualmente tenemos mesas disponibles para 2 personas y una mesa VIP en la terraza. ¿Te gustaría reservar alguna de estas opciones?
> [MOSTRAR_MENU]

---

### Test #9: Comparación días
- **Prompt**: "¿qué día tienen más disponibilidad?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2020ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 En general, tenemos buena disponibilidad de martes a sábado, ya que estamos cerrados los domingos. Si tienes un día específico en mente, puedo ayudarte a verificar la disponibilidad para ese día. ¿Te gustaría saber sobre algún día en particular?
> [MOSTRAR_MENU]

---

### Test #10: Opciones semana
- **Prompt**: "dame opciones para esta semana"
- **Intención Interpretada**: `show_menu`
- **Resultado**: ✅ PASÓ (1470ms)
- **Respuesta de la IA**:
> Aquí tienes nuestros servicios 😊

---

### Test #11: Cambio de servicio
- **Prompt**: "Mejor otra opción, ¿qué horas hay?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1697ms)
- **Respuesta de la IA**:
> Claro, mañana tenemos disponibilidad para la Mesa VIP Terraza a las 11:00 AM y 3:00 PM. 😊 ¿Te gustaría reservar alguna de estas opciones?
> [MOSTRAR_MENU]

---

### Test #12: Día cerrado
- **Prompt**: "¿Tienen citas libres este domingo?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1845ms)
- **Respuesta de la IA**:
> Este domingo estamos cerrados, así que no tenemos citas disponibles. 😊 Si quieres, puedo ayudarte a encontrar un horario para otro día. ¿Te gustaría saber más sobre nuestra disponibilidad para el lunes o martes?

---

### Test #13: Fecha lejana
- **Prompt**: "¿Qué disponibilidad tienen para el 15 de octubre?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (6550ms)
- **Respuesta de la IA**:
> Para el 15 de octubre tenemos varias horas disponibles. 😊 Puedes elegir entre 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM y 3:30 PM, entre otros. ¿Cuál prefieres?
> [MOSTRAR_MENU]

---

### Test #14: Reserva real + Envío de correo Resend
- **Prompt**: "Agendar a las 11:00 AM, mi nombre es Carlos Test, email carlostest.e2e@gmail.com"
- **Intención Interpretada**: `booking`
- **Resultado**: ❌ FALLÓ (1951ms)
- **Respuesta de la IA**:
> No puedo confirmar citas en este momento, pero puedo ayudarte con información del negocio. 😊 Si deseas, puedo anotar tu preferencia para la mesa para 2 personas a las 11:00 AM y puedes contactar directamente al restaurante para confirmar.

---

### Test #15: Ortografía
- **Prompt**: "q oras tienen libre mañna"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2226ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Mañana estamos abiertos de 11:00 a 23:00. Si deseas reservar una mesa, puedo ayudarte con eso. ¿Te gustaría hacerlo?

---

### Test #16: Franja especifica
- **Prompt**: "¿Tienen horarios disponibles mañana por la mañana?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2340ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Para mañana, 12 de agosto, tenemos varios horarios disponibles por la mañana. Puedes elegir entre las 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM y 2:30 PM. ¿Te gustaría reservar en alguno de esos horarios?

---

### Test #17: Ambigua
- **Prompt**: "¿cuándo puedo ir?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1854ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Puedes visitarnos hoy, martes 11 de agosto, ya que estamos abiertos de 11:00 a 23:00. ¿Te gustaría reservar una mesa para ti?

---

### Test #18: Servicio especifico
- **Prompt**: "Quiero Mesa para 2 personas, ¿qué horas hay libres mañana?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2165ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Para mañana, tenemos varias horas disponibles para una mesa para 2 personas. Puedes elegir entre las siguientes opciones: 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM y 3:30 PM. 
> ¿Cuál de estas te gustaría reservar?
> [MOSTRAR_MENU]

---

### Test #19: Repetir disponibilidad
- **Prompt**: "¿Me repites qué horas eran?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1350ms)
- **Respuesta de la IA**:
> Claro, mañana tenemos espacio a las 11:00 AM y 3:00 PM. 😊 ¿Te gustaría reservar una mesa en alguno de esos horarios?

---

### Test #20: Consulta por más tarde
- **Prompt**: "¿Y más tarde en la tarde?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2775ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 En la tarde estamos abiertos hasta las 11:00 PM. ¿Te gustaría hacer una reserva para alguna hora en particular?

---

### Test #21: Con nombre
- **Prompt**: "Hola, soy Roberto. ¿Qué horas tienen libres mañana?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (3284ms)
- **Respuesta de la IA**:
> ¡Hola, Roberto! 😊 Para mañana, tenemos varias horas disponibles. Puedes elegir entre las siguientes: 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM y 3:30 PM. 
> ¿Cuál de estas te gustaría reservar?
> [MOSTRAR_MENU]

---

### Test #22: Servicio + día
- **Prompt**: "Quiero Mesa para 2 personas. ¿Qué horarios hay libres el viernes?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2565ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Para el viernes tenemos varios horarios disponibles para una mesa para 2 personas. Puedes elegir entre las siguientes opciones: 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM y 3:30 PM. 
> ¿Cuál prefieres?
> [MOSTRAR_MENU]

---

### Test #23: Con email
- **Prompt**: "Mi correo es roberto@example.com. ¿Qué citas hay mañana?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1762ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Mañana es miércoles y estamos abiertos de 11:00 a 23:00. Si deseas, puedo ayudarte con información sobre nuestras mesas y servicios. ¿Te gustaría saber más sobre eso?
> [MOSTRAR_MENU]

---

### Test #24: Pedir lista de horas
- **Prompt**: "Dime qué horas sí tienen libres mañana"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1727ms)
- **Respuesta de la IA**:
> Claro, mañana tenemos varias horas disponibles. 😊 Puedes elegir entre las siguientes: 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM y 3:30 PM. ¿Cuál prefieres?
> [MOSTRAR_MENU]

---

### Test #25: Nombre + mañana
- **Prompt**: "Hola soy Pedro. ¿Qué disponibilidad hay mañana?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2252ms)
- **Respuesta de la IA**:
> ¡Hola Pedro! 😊 Para mañana, 12 de agosto, tenemos varias horas disponibles. Puedes elegir entre las siguientes: 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM y 3:30 PM. 
> ¿Cuál de estas horas te gustaría reservar?
> [MOSTRAR_MENU]

---

### Test #26: Con notas
- **Prompt**: "Tengo preferencia por atención tranquila. ¿Qué horas hay disponibles?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1996ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 En nuestro restaurante, estamos abiertos hoy hasta las 23:00. Puedes venir en cualquier momento entre las 11:00 y las 23:00. Si prefieres una atención más tranquila, te recomendaría venir un poco antes de la hora pico, que suele ser entre las 19:00 y las 21:00. ¿Te gustaría reservar una mesa?
> [MOSTRAR_MENU]

---

### Test #27: Disponibilidad tras precio
- **Prompt**: "Excelente, ¿qué horas hay libres mañana para agendar?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2162ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Para mañana, tenemos varias horas disponibles: 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM y 3:30 PM, entre otras. ¿Cuál prefieres?
> [MOSTRAR_MENU]

---

### Test #28: Sábado
- **Prompt**: "¿Tienen huecos disponibles este sábado?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2366ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Este sábado tenemos varias horas disponibles. Puedes elegir entre 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM y 3:30 PM. ¿Te gustaría reservar alguna de estas horas?

---

### Test #29: Consulta libre
- **Prompt**: "¿Qué horarios tienen libres mañana para atención?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1855ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Para mañana, 12 de agosto, tenemos los siguientes horarios disponibles: 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM y 3:30 PM. ¿Te gustaría reservar en alguno de estos horarios?
> [MOSTRAR_MENU]

---

### Test #30: Último turno
- **Prompt**: "¿Cuál es el último turno disponible mañana?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1343ms)
- **Respuesta de la IA**:
> Mañana tenemos varios horarios disponibles hasta las 3:30 PM. 😊 ¿Te gustaría reservar en alguno de esos horarios?

---

### Test #31: Tomorrow open
- **Prompt**: "What times are open tomorrow?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2777ms)
- **Respuesta de la IA**:
> Sure! 😊 Here are the available time slots for tomorrow: 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM, and 3:30 PM. Which one do you prefer?

---

### Test #32: Today free
- **Prompt**: "What times do you have free today?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (3292ms)
- **Respuesta de la IA**:
> We have several time slots available today! 😊 Here are the options: 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM, and 3:30 PM. 
> 
> Which one would you prefer?

---

### Test #33: Friday
- **Prompt**: "Anything available on Friday?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2060ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 El viernes tenemos varias horas disponibles. Puedes elegir entre 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM y 3:30 PM. ¿Te gustaría reservar alguna de estas horas?

---

### Test #34: This week
- **Prompt**: "What time can I come this week?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1542ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Esta semana estamos abiertos de lunes a sábado, de 11:00 a 23:00. ¿Te gustaría reservar una mesa para algún día en particular?

---

### Test #35: With service
- **Prompt**: "I want Table for 2, when is there space?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2373ms)
- **Respuesta de la IA**:
> I can help you with that! 😊 A table for 2 is available for 90 minutes. 
> 
> Since today is Tuesday, August 11, 2026, we open at 11:00 AM. Would you like to book a table for lunch or dinner? Let me know your preferred time!

---

### Test #36: Afternoon
- **Prompt**: "Any open slots in the afternoon?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1650ms)
- **Respuesta de la IA**:
> I can't confirm appointments at the moment, but I can help you with information about our business. 😊 Our restaurant is open today from 11:00 AM to 11:00 PM. Would you like to know more about our services or make a reservation?

---

### Test #37: Morning
- **Prompt**: "Anything available in the morning?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1650ms)
- **Respuesta de la IA**:
> I appreciate your interest! 😊 However, we open at 11:00 AM, so we don't have morning availability. Would you like to make a reservation for later in the day?

---

### Test #38: Urgent
- **Prompt**: "I need an urgent appointment, what is free right now?"
- **Intención Interpretada**: `unknown`
- **Resultado**: ✅ PASÓ (1546ms)
- **Respuesta de la IA**:
> I can't confirm appointments at this moment, but I can help you with information about our services and availability. 😊 Would you like to know more about our options?

---

### Test #39: Day comparison
- **Prompt**: "Which day has the most availability?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1596ms)
- **Respuesta de la IA**:
> I can't provide specific availability details, but we're open from 11:00 AM to 11:00 PM every day except Sunday. 😊 If you're looking to book a table, I can help with that! What day are you considering?

---

### Test #40: Week options
- **Prompt**: "Give me options for this week"
- **Intención Interpretada**: `show_menu`
- **Resultado**: ✅ PASÓ (1096ms)
- **Respuesta de la IA**:
> Here are our services 😊

---

### Test #41: Service change
- **Prompt**: "Better another option, what times are there?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1382ms)
- **Respuesta de la IA**:
> I can help with that! 😊 We have availability for Table for 2 tomorrow at 11:00 AM and 3:00 PM. Would you like to book one of those times?

---

### Test #42: Closed day
- **Prompt**: "Do you have open slots this Sunday?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1923ms)
- **Respuesta de la IA**:
> Este domingo estamos cerrados, así que no tenemos horarios disponibles. Si quieres, puedo ayudarte a consultar otra fecha. 😊

---

### Test #43: Distant date
- **Prompt**: "What availability do you have for October 15th?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1955ms)
- **Respuesta de la IA**:
> I can't confirm appointments at this moment, but I can help you with information about the business. 😊 Would you like to know about our services or menu?

---

### Test #44: Real booking + Resend email dispatch
- **Prompt**: "Book 11:00 AM, my name is Charles Test, email carlostest.e2e@gmail.com"
- **Intención Interpretada**: `booking`
- **Resultado**: ❌ FALLÓ (1728ms)
- **Respuesta de la IA**:
> I can't confirm bookings at this moment, but I can help you with business information. 😊 Would you like to proceed with the reservation for Table for 2 at 11:00 AM?

---

### Test #45: Typos
- **Prompt**: "wht times r free tomow"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1879ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Mañana, miércoles, estamos abiertos de 11:00 a 23:00. Si deseas reservar una mesa, puedo ayudarte con eso. ¿Te gustaría saber más sobre nuestras opciones?

---

### Test #46: Specific window
- **Prompt**: "Do you have open time slots tomorrow morning?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2284ms)
- **Respuesta de la IA**:
> Absolutely! 😊 Here are the available time slots for tomorrow morning:
> 
> 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM, 3:30 PM and more.
> 
> Which one would you prefer?

---

### Test #47: Ambiguous
- **Prompt**: "When can I come in?"
- **Intención Interpretada**: `unknown`
- **Resultado**: ✅ PASÓ (3069ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 No puedo confirmar citas en este momento, pero puedo ayudarte con información del negocio. Estamos abiertos hoy hasta las 11:00 PM. ¿Te gustaría saber más sobre nuestros servicios o hacer una reserva?

---

### Test #48: Specific item
- **Prompt**: "I want Table for 2, what times are free tomorrow?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (3114ms)
- **Respuesta de la IA**:
> Sure! 😊 For tomorrow, we have several time slots available for a table for 2. Here they are: 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM, and 3:30 PM. 
> 
> Which time would you prefer?

---

### Test #49: Repeat availability
- **Prompt**: "Can you repeat what times those were?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1305ms)
- **Respuesta de la IA**:
> Of course! Tomorrow, we have openings at 11:00 AM and 3:00 PM. 😊

---

### Test #50: Query for later
- **Prompt**: "And later in the afternoon?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2062ms)
- **Respuesta de la IA**:
> In the afternoon, we have availability starting from 11:00 AM until 11:00 PM. 😊 Is there a specific time you have in mind?

---

### Test #51: With name
- **Prompt**: "Hi, I am Robert. What times are open tomorrow?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2671ms)
- **Respuesta de la IA**:
> Hi Robert! 😊 Here are the available time slots for tomorrow: 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM, and 3:30 PM. Which one works best for you?

---

### Test #52: Service + day
- **Prompt**: "I want Table for 2. What times are free Friday?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2087ms)
- **Respuesta de la IA**:
> Of course! 😊 For Friday, we have several time slots available: 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM, and 3:30 PM. 
> 
> Which time would you prefer?

---

### Test #53: With email
- **Prompt**: "My email is roberto@example.com. What slots tomorrow?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2853ms)
- **Respuesta de la IA**:
> Sure! 😊 Here are the available time slots for tomorrow:
> 
> 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM, 3:30 PM and more.
> 
> Which one do you prefer?

---

### Test #54: Request list of open hours
- **Prompt**: "Tell me what times you do have open tomorrow"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2151ms)
- **Respuesta de la IA**:
> Sure! 😊 Here are the available time slots for tomorrow: 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM, and 3:30 PM. Which one works best for you?

---

### Test #55: Name + tomorrow
- **Prompt**: "Hi I am Peter. What availability is there tomorrow?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1481ms)
- **Respuesta de la IA**:
> Hi Peter! 😊 Tomorrow, we have availability for our services. Would you like to book a table for two or perhaps the VIP terrace? Let me know what you prefer!

---

### Test #56: With notes
- **Prompt**: "I prefer quiet attention. What times are open?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2143ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Nuestro horario es de lunes a sábado, de 11:00 a 23:00. El domingo estamos cerrados. Si prefieres un ambiente más tranquilo, te recomendaría venir a primera hora o durante la semana. ¿Te gustaría saber algo más sobre nuestros servicios o hacer una reserva?

---

### Test #57: Availability after price
- **Prompt**: "Great, what times are free tomorrow to book?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2571ms)
- **Respuesta de la IA**:
> Sure! 😊 Here are the available time slots for tomorrow: 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM, and 3:30 PM. Which one do you prefer?

---

### Test #58: Saturday
- **Prompt**: "Do you have open slots this Saturday?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1955ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Este sábado estamos cerrados, así que no tenemos disponibilidad. Pero si quieres, puedo ayudarte a planear una visita para otro día. ¿Te gustaría saber sobre la disponibilidad para el viernes o algún otro día?

---

### Test #59: Open query
- **Prompt**: "What time slots are free tomorrow for service?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2162ms)
- **Respuesta de la IA**:
> Sure! 😊 Here are the available time slots for tomorrow: 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, 3:00 PM, and 3:30 PM. 
> Which one would you prefer?

---

### Test #60: Last slot
- **Prompt**: "What is the last available slot tomorrow?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2835ms)
- **Respuesta de la IA**:
> I can't confirm the exact last available slot for tomorrow, but I can tell you that we have several options throughout the day! 😊 Would you like to know the available time slots?

---

