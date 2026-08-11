# Reporte de Batería de 60 Pruebas de Disponibilidad (Barbería El Corte Fino - ES + EN)

**Fecha de ejecución**: 2026-08-11T16:25:22.916Z  
**Cliente probado**: `barberia-el-corte-fino`  
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
| 1 | Mañana abierto | "¿qué horas tienen disponible mañana?" | `booking` | 200 | 2668ms | ✅ PASÓ |
| 2 | Hoy libre | "¿qué horas tienen libres hoy?" | `booking` | 200 | 2367ms | ✅ PASÓ |
| 3 | Viernes | "¿tienen algo disponible el viernes?" | `booking` | 200 | 2264ms | ✅ PASÓ |
| 4 | Semana | "¿a qué hora puedo ir esta semana?" | `general_question` | 200 | 1956ms | ✅ PASÓ |
| 5 | Con servicio | "quiero Corte de cabello, ¿cuándo hay espacio?" | `booking` | 200 | 1656ms | ✅ PASÓ |
| 6 | Tarde | "¿tienen hueco en la tarde?" | `booking` | 200 | 1836ms | ✅ PASÓ |
| 7 | Mañana am | "¿algo disponible en la mañana?" | `booking` | 200 | 2276ms | ✅ PASÓ |
| 8 | Urgente | "necesito una cita urgente, ¿qué tienen ahorita?" | `booking` | 200 | 1792ms | ✅ PASÓ |
| 9 | Comparación días | "¿qué día tienen más disponibilidad?" | `general_question` | 200 | 1815ms | ✅ PASÓ |
| 10 | Opciones semana | "dame opciones para esta semana" | `show_menu` | 200 | 2716ms | ✅ PASÓ |
| 11 | Cambio de servicio | "Mejor otra opción, ¿qué horas hay?" | `general_question` | 200 | 1845ms | ✅ PASÓ |
| 12 | Día cerrado | "¿Tienen citas libres este domingo?" | `general_question` | 200 | 1719ms | ✅ PASÓ |
| 13 | Fecha lejana | "¿Qué disponibilidad tienen para el 15 de octubre?" | `booking` | 200 | 4210ms | ✅ PASÓ |
| 14 | Reserva real + Envío de correo Resend | "Agendar a las 11:00 AM, mi nombre es Carlos Test, email carlostest.e2e@gmail.com" | `booking` | 200 | 1942ms | ❌ FALLÓ |
| 15 | Ortografía | "q oras tienen libre mañna" | `general_question` | 200 | 2838ms | ✅ PASÓ |
| 16 | Franja especifica | "¿Tienen horarios disponibles mañana por la mañana?" | `booking` | 200 | 2732ms | ✅ PASÓ |
| 17 | Ambigua | "¿cuándo puedo ir?" | `booking` | 200 | 2062ms | ✅ PASÓ |
| 18 | Servicio especifico | "Quiero Corte de cabello, ¿qué horas hay libres mañana?" | `booking` | 200 | 2420ms | ✅ PASÓ |
| 19 | Repetir disponibilidad | "¿Me repites qué horas eran?" | `general_question` | 200 | 1599ms | ✅ PASÓ |
| 20 | Consulta por más tarde | "¿Y más tarde en la tarde?" | `general_question` | 200 | 1544ms | ✅ PASÓ |
| 21 | Con nombre | "Hola, soy Roberto. ¿Qué horas tienen libres mañana?" | `booking` | 200 | 2240ms | ✅ PASÓ |
| 22 | Servicio + día | "Quiero Corte de cabello. ¿Qué horarios hay libres el viernes?" | `booking` | 200 | 3111ms | ✅ PASÓ |
| 23 | Con email | "Mi correo es roberto@example.com. ¿Qué citas hay mañana?" | `general_question` | 200 | 2574ms | ✅ PASÓ |
| 24 | Pedir lista de horas | "Dime qué horas sí tienen libres mañana" | `booking` | 200 | 2267ms | ✅ PASÓ |
| 25 | Nombre + mañana | "Hola soy Pedro. ¿Qué disponibilidad hay mañana?" | `booking` | 200 | 2060ms | ✅ PASÓ |
| 26 | Con notas | "Tengo preferencia por atención tranquila. ¿Qué horas hay disponibles?" | `booking` | 200 | 1882ms | ✅ PASÓ |
| 27 | Disponibilidad tras precio | "Excelente, ¿qué horas hay libres mañana para agendar?" | `booking` | 200 | 3260ms | ✅ PASÓ |
| 28 | Sábado | "¿Tienen huecos disponibles este sábado?" | `booking` | 200 | 2265ms | ✅ PASÓ |
| 29 | Consulta libre | "¿Qué horarios tienen libres mañana para atención?" | `booking` | 200 | 2263ms | ✅ PASÓ |
| 30 | Último turno | "¿Cuál es el último turno disponible mañana?" | `general_question` | 200 | 1754ms | ✅ PASÓ |
| 31 | Tomorrow open | "What times are open tomorrow?" | `booking` | 200 | 2272ms | ✅ PASÓ |
| 32 | Today free | "What times do you have free today?" | `booking` | 200 | 2362ms | ✅ PASÓ |
| 33 | Friday | "Anything available on Friday?" | `general_question` | 200 | 2471ms | ✅ PASÓ |
| 34 | This week | "What time can I come this week?" | `general_question` | 200 | 1799ms | ✅ PASÓ |
| 35 | With service | "I want Haircut, when is there space?" | `booking` | 200 | 1704ms | ✅ PASÓ |
| 36 | Afternoon | "Any open slots in the afternoon?" | `booking` | 200 | 1549ms | ✅ PASÓ |
| 37 | Morning | "Anything available in the morning?" | `booking` | 200 | 1523ms | ✅ PASÓ |
| 38 | Urgent | "I need an urgent appointment, what is free right now?" | `booking` | 200 | 1572ms | ✅ PASÓ |
| 39 | Day comparison | "Which day has the most availability?" | `general_question` | 200 | 2027ms | ✅ PASÓ |
| 40 | Week options | "Give me options for this week" | `booking` | 200 | 1348ms | ✅ PASÓ |
| 41 | Service change | "Better another option, what times are there?" | `general_question` | 200 | 2953ms | ✅ PASÓ |
| 42 | Closed day | "Do you have open slots this Sunday?" | `general_question` | 200 | 1852ms | ✅ PASÓ |
| 43 | Distant date | "What availability do you have for October 15th?" | `booking` | 200 | 1650ms | ✅ PASÓ |
| 44 | Real booking + Resend email dispatch | "Book 11:00 AM, my name is Charles Test, email carlostest.e2e@gmail.com" | `booking` | 200 | 1886ms | ❌ FALLÓ |
| 45 | Typos | "wht times r free tomow" | `general_question` | 200 | 3024ms | ✅ PASÓ |
| 46 | Specific window | "Do you have open time slots tomorrow morning?" | `booking` | 200 | 2280ms | ✅ PASÓ |
| 47 | Ambiguous | "When can I come in?" | `unknown` | 200 | 1961ms | ✅ PASÓ |
| 48 | Specific item | "I want Haircut, what times are free tomorrow?" | `booking` | 200 | 2535ms | ✅ PASÓ |
| 49 | Repeat availability | "Can you repeat what times those were?" | `general_question` | 200 | 1994ms | ✅ PASÓ |
| 50 | Query for later | "And later in the afternoon?" | `general_question` | 200 | 1646ms | ✅ PASÓ |
| 51 | With name | "Hi, I am Robert. What times are open tomorrow?" | `booking` | 200 | 3390ms | ✅ PASÓ |
| 52 | Service + day | "I want Haircut. What times are free Friday?" | `booking` | 200 | 3391ms | ✅ PASÓ |
| 53 | With email | "My email is roberto@example.com. What slots tomorrow?" | `booking` | 200 | 2393ms | ✅ PASÓ |
| 54 | Request list of open hours | "Tell me what times you do have open tomorrow" | `booking` | 200 | 2363ms | ✅ PASÓ |
| 55 | Name + tomorrow | "Hi I am Peter. What availability is there tomorrow?" | `booking` | 200 | 1904ms | ✅ PASÓ |
| 56 | With notes | "I prefer quiet attention. What times are open?" | `general_question` | 200 | 2093ms | ✅ PASÓ |
| 57 | Availability after price | "Great, what times are free tomorrow to book?" | `booking` | 200 | 2261ms | ✅ PASÓ |
| 58 | Saturday | "Do you have open slots this Saturday?" | `general_question` | 200 | 2155ms | ✅ PASÓ |
| 59 | Open query | "What time slots are free tomorrow for service?" | `booking` | 200 | 2000ms | ✅ PASÓ |
| 60 | Last slot | "What is the last available slot tomorrow?" | `general_question` | 200 | 2126ms | ✅ PASÓ |

---

## 📝 Transcripción Completa de Respuestas

### Test #1: Mañana abierto
- **Prompt**: "¿qué horas tienen disponible mañana?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2668ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Para mañana, 12 de agosto, tenemos varias horas disponibles. Puedes elegir entre las siguientes: 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM y 12:15 PM, entre otras. ¿Cuál prefieres?
> [MOSTRAR_MENU]

---

### Test #2: Hoy libre
- **Prompt**: "¿qué horas tienen libres hoy?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2367ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Hoy tenemos varias horas disponibles. Puedes elegir entre las siguientes: 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM y 12:15 PM. ¿Cuál prefieres?
> [MOSTRAR_MENU]

---

### Test #3: Viernes
- **Prompt**: "¿tienen algo disponible el viernes?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2264ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Para el viernes tenemos varias horas disponibles. Puedes elegir entre 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM, 12:15 PM, entre otras. ¿Cuál prefieres?

---

### Test #4: Semana
- **Prompt**: "¿a qué hora puedo ir esta semana?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1956ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Esta semana estamos abiertos de lunes a sábado, de 10:00 a 20:00. Así que puedes venir en cualquier momento dentro de ese horario. ¿Te gustaría agendar una cita para algún servicio en particular?

---

### Test #5: Con servicio
- **Prompt**: "quiero Corte de cabello, ¿cuándo hay espacio?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1656ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 El servicio de Corte de cabello tiene un costo de $25 y dura aproximadamente 30 minutos. Para verificar la disponibilidad, ¿te gustaría que te agende para hoy o prefieres otro día?

---

### Test #6: Tarde
- **Prompt**: "¿tienen hueco en la tarde?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1836ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Claro, tenemos disponibilidad en la tarde. ¿Te gustaría agendar un servicio en particular? Cuéntame qué necesitas y a qué hora te gustaría venir.

---

### Test #7: Mañana am
- **Prompt**: "¿algo disponible en la mañana?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2276ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Para mañana, tenemos varias horas disponibles en la mañana. Puedes elegir entre las siguientes: 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM y 12:15 PM. 
> ¿Cuál te gustaría reservar?

---

### Test #8: Urgente
- **Prompt**: "necesito una cita urgente, ¿qué tienen ahorita?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1792ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Entiendo que necesitas una cita urgente. Actualmente, tenemos disponibilidad para los siguientes servicios: Corte de cabello, Corte + Barba, Afeitado clásico, Diseño de barba y Corte de niño. ¿Cuál te gustaría reservar?
> [MOSTRAR_MENU]

---

### Test #9: Comparación días
- **Prompt**: "¿qué día tienen más disponibilidad?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1815ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 En general, tenemos buena disponibilidad durante toda la semana, pero los días más tranquilos suelen ser de lunes a miércoles. Si tienes un día específico en mente, puedo ayudarte a ver opciones. ¿Te gustaría saber sobre algún día en particular?
> [MOSTRAR_MENU]

---

### Test #10: Opciones semana
- **Prompt**: "dame opciones para esta semana"
- **Intención Interpretada**: `show_menu`
- **Resultado**: ✅ PASÓ (2716ms)
- **Respuesta de la IA**:
> Aquí tienes nuestros servicios 😊

---

### Test #11: Cambio de servicio
- **Prompt**: "Mejor otra opción, ¿qué horas hay?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1845ms)
- **Respuesta de la IA**:
> Mañana tenemos disponibilidad a las 11:00 AM y 3:00 PM para el Corte de cabello. Si necesitas otra opción, puedo verificar más horarios. 😊
> [MOSTRAR_MENU]

---

### Test #12: Día cerrado
- **Prompt**: "¿Tienen citas libres este domingo?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1719ms)
- **Respuesta de la IA**:
> Lamentablemente, este domingo estamos cerrados. 😔 Pero si quieres, puedo ayudarte a encontrar un horario disponible para otro día. ¿Te gustaría agendar para el lunes o algún otro día?

---

### Test #13: Fecha lejana
- **Prompt**: "¿Qué disponibilidad tienen para el 15 de octubre?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (4210ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Para el 15 de octubre tenemos varias horas disponibles. Puedes elegir entre 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM y 12:15 PM, entre otras. ¿Cuál prefieres?
> [MOSTRAR_MENU]

---

### Test #14: Reserva real + Envío de correo Resend
- **Prompt**: "Agendar a las 11:00 AM, mi nombre es Carlos Test, email carlostest.e2e@gmail.com"
- **Intención Interpretada**: `booking`
- **Resultado**: ❌ FALLÓ (1942ms)
- **Respuesta de la IA**:
> ¡Perfecto, Carlos! 😊 Vamos a agendar tu Corte de cabello para mañana a las 11:00 AM. Solo necesito tu número de teléfono para completar la reserva.

---

### Test #15: Ortografía
- **Prompt**: "q oras tienen libre mañna"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2838ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Mañana estamos abiertos de 10:00 a 20:00. Si quieres, puedo ayudarte a agendar una cita en ese horario. ¿Te gustaría reservar algo?

---

### Test #16: Franja especifica
- **Prompt**: "¿Tienen horarios disponibles mañana por la mañana?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2732ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Para mañana por la mañana tenemos varios horarios disponibles. Puedes elegir entre las siguientes opciones: 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM y 12:15 PM. ¿Cuál prefieres?

---

### Test #17: Ambigua
- **Prompt**: "¿cuándo puedo ir?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2062ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Puedes venir hoy, que estamos abiertos hasta las 20:00. También estamos disponibles de lunes a sábado en el mismo horario. ¿Te gustaría agendar una cita para algún servicio en particular?

---

### Test #18: Servicio especifico
- **Prompt**: "Quiero Corte de cabello, ¿qué horas hay libres mañana?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2420ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Para mañana, tenemos varias horas disponibles para un corte de cabello. Puedes elegir entre las siguientes: 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM, 12:15 PM, entre otras. ¿Cuál prefieres?
> [MOSTRAR_MENU]

---

### Test #19: Repetir disponibilidad
- **Prompt**: "¿Me repites qué horas eran?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1599ms)
- **Respuesta de la IA**:
> Mañana tenemos espacio a las 11:00 AM y 3:00 PM. Si te interesa alguna de esas horas, puedo ayudarte a agendar.

---

### Test #20: Consulta por más tarde
- **Prompt**: "¿Y más tarde en la tarde?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1544ms)
- **Respuesta de la IA**:
> Claro, en la tarde tenemos disponibilidad a partir de las 4:00 PM. ¿Te gustaría agendar una cita? 😊

---

### Test #21: Con nombre
- **Prompt**: "Hola, soy Roberto. ¿Qué horas tienen libres mañana?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2240ms)
- **Respuesta de la IA**:
> ¡Hola Roberto! 😊 Para mañana, tenemos varias horas disponibles. Puedes elegir entre las siguientes: 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM y 12:15 PM. 
> ¿Cuál de estas te gustaría reservar?
> [MOSTRAR_MENU]

---

### Test #22: Servicio + día
- **Prompt**: "Quiero Corte de cabello. ¿Qué horarios hay libres el viernes?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (3111ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Para el viernes tenemos varios horarios disponibles para el Corte de cabello. Puedes elegir entre las siguientes opciones: 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM, 12:15 PM, entre otros. 
> ¿Cuál de estos horarios te gustaría reservar?
> [MOSTRAR_MENU]

---

### Test #23: Con email
- **Prompt**: "Mi correo es roberto@example.com. ¿Qué citas hay mañana?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2574ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Mañana es miércoles y estamos abiertos de 10:00 a 20:00. Puedes venir a cualquiera de esos horarios. ¿Te gustaría saber más sobre nuestros servicios o hacer una reserva?
> [MOSTRAR_MENU]

---

### Test #24: Pedir lista de horas
- **Prompt**: "Dime qué horas sí tienen libres mañana"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2267ms)
- **Respuesta de la IA**:
> Claro, mañana tenemos varias horas disponibles. 😊 Puedes elegir entre 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM, 12:15 PM, entre otras. ¿Cuál prefieres?
> [MOSTRAR_MENU]

---

### Test #25: Nombre + mañana
- **Prompt**: "Hola soy Pedro. ¿Qué disponibilidad hay mañana?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2060ms)
- **Respuesta de la IA**:
> ¡Hola Pedro! 😊 Para mañana, tenemos varias horas disponibles. Puedes elegir entre las siguientes: 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM y 12:15 PM. 
> ¿Cuál te gustaría reservar?
> [MOSTRAR_MENU]

---

### Test #26: Con notas
- **Prompt**: "Tengo preferencia por atención tranquila. ¿Qué horas hay disponibles?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1882ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Para asegurarte una atención tranquila, te recomiendo que vengas en horarios menos concurridos. Generalmente, las mañanas son más tranquilas. ¿Te gustaría que te ayude a agendar una cita para algún día específico?
> [MOSTRAR_MENU]

---

### Test #27: Disponibilidad tras precio
- **Prompt**: "Excelente, ¿qué horas hay libres mañana para agendar?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (3260ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Para mañana, tenemos varias horas disponibles. Puedes elegir entre las siguientes: 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM y 12:15 PM. ¿Cuál prefieres?
> [MOSTRAR_MENU]

---

### Test #28: Sábado
- **Prompt**: "¿Tienen huecos disponibles este sábado?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2265ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Este sábado tenemos varios horarios disponibles. Puedes elegir entre las 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM, 12:15 PM, entre otros. ¿Cuál prefieres?

---

### Test #29: Consulta libre
- **Prompt**: "¿Qué horarios tienen libres mañana para atención?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2263ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Para mañana, tenemos varios horarios disponibles. Puedes elegir entre las siguientes opciones: 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM y 12:15 PM. 
> ¿Cuál de estos te gustaría reservar?
> [MOSTRAR_MENU]

---

### Test #30: Último turno
- **Prompt**: "¿Cuál es el último turno disponible mañana?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1754ms)
- **Respuesta de la IA**:
> Mañana, el último turno disponible es a las 19:45. 😊 ¿Te gustaría agendarlo o necesitas más información sobre nuestros servicios?

---

### Test #31: Tomorrow open
- **Prompt**: "What times are open tomorrow?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2272ms)
- **Respuesta de la IA**:
> Sure! 😊 Here are the available time slots for tomorrow:
> 
> 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM, 12:15 PM, and more.
> 
> Which one would you prefer?

---

### Test #32: Today free
- **Prompt**: "What times do you have free today?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2362ms)
- **Respuesta de la IA**:
> Sure! 😊 Here are the available time slots for today: 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM, and 12:15 PM. 
> Which one works best for you?

---

### Test #33: Friday
- **Prompt**: "Anything available on Friday?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2471ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Este viernes tenemos varias horas disponibles. Puedes elegir entre 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM, 12:15 PM, entre otras. ¿Te gustaría reservar alguna de estas horas?

---

### Test #34: This week
- **Prompt**: "What time can I come this week?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1799ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Esta semana estamos abiertos de lunes a sábado, de 10:00 a 20:00. ¿Te gustaría agendar una cita para algún día en particular?

---

### Test #35: With service
- **Prompt**: "I want Haircut, when is there space?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1704ms)
- **Respuesta de la IA**:
> Sure! 😊 Our haircut service is quite popular. We have availability today until 8 PM. Would you like to book a specific time, or do you prefer to come in soon?

---

### Test #36: Afternoon
- **Prompt**: "Any open slots in the afternoon?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1549ms)
- **Respuesta de la IA**:
> Sure! 😊 We have availability in the afternoon. What specific day are you looking to come in, and which service are you interested in?

---

### Test #37: Morning
- **Prompt**: "Anything available in the morning?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1523ms)
- **Respuesta de la IA**:
> I can't confirm specific availability right now, but we do have morning slots! 😊 Would you like to let me know which service you're interested in, and I can check for you?

---

### Test #38: Urgent
- **Prompt**: "I need an urgent appointment, what is free right now?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1572ms)
- **Respuesta de la IA**:
> I understand you're looking for an urgent appointment! 😊 Let me check the availability for you right now. Could you please let me know what service you're interested in?

---

### Test #39: Day comparison
- **Prompt**: "Which day has the most availability?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2027ms)
- **Respuesta de la IA**:
> I can't check specific availability for each day, but we're open from 10:00 AM to 8:00 PM, Monday through Saturday. 😊 If you have a specific day in mind, I can help you with booking an appointment!

---

### Test #40: Week options
- **Prompt**: "Give me options for this week"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1348ms)
- **Respuesta de la IA**:
> I can help with that! 😊 Just to clarify, are you looking for a specific day or time this week?

---

### Test #41: Service change
- **Prompt**: "Better another option, what times are there?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2953ms)
- **Respuesta de la IA**:
> I can only confirm the available times for tomorrow, which are 11:00 AM and 3:00 PM. If those don't work for you, let me know, and I can help you find another time! 😊

---

### Test #42: Closed day
- **Prompt**: "Do you have open slots this Sunday?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1852ms)
- **Respuesta de la IA**:
> Lo siento, pero este domingo estamos cerrados. 😔 Si quieres, puedo ayudarte a encontrar un horario disponible para otro día. ¿Te gustaría ver opciones para el lunes o algún otro día?

---

### Test #43: Distant date
- **Prompt**: "What availability do you have for October 15th?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1650ms)
- **Respuesta de la IA**:
> I can't check availability for October 15th from here, but I recommend giving us a call at +56912345678 for the most accurate information. 😊 Is there a specific service you're interested in?

---

### Test #44: Real booking + Resend email dispatch
- **Prompt**: "Book 11:00 AM, my name is Charles Test, email carlostest.e2e@gmail.com"
- **Intención Interpretada**: `booking`
- **Resultado**: ❌ FALLÓ (1886ms)
- **Respuesta de la IA**:
> Great choice, Charles! 😊 I'll get that 11:00 AM haircut booked for you. Just to confirm, could you please provide your phone number?

---

### Test #45: Typos
- **Prompt**: "wht times r free tomow"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (3024ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Mañana estamos abiertos de 10:00 a 20:00. Si quieres, puedo ayudarte a ver la disponibilidad de horarios. ¿Te gustaría reservar un servicio?

---

### Test #46: Specific window
- **Prompt**: "Do you have open time slots tomorrow morning?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2280ms)
- **Respuesta de la IA**:
> Absolutely! 😊 Tomorrow morning, we have several available time slots: 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM, and 12:15 PM. 
> 
> Which one works best for you?

---

### Test #47: Ambiguous
- **Prompt**: "When can I come in?"
- **Intención Interpretada**: `unknown`
- **Resultado**: ✅ PASÓ (1961ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Estoy aquí para ayudarte, pero necesito un poco más de información. ¿Tienes en mente un día o una hora específica para venir a la barbería?

---

### Test #48: Specific item
- **Prompt**: "I want Haircut, what times are free tomorrow?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2535ms)
- **Respuesta de la IA**:
> Sure! 😊 Here are the available time slots for a haircut tomorrow:
> 
> 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM, 12:15 PM, and more.
> 
> Which one works best for you?

---

### Test #49: Repeat availability
- **Prompt**: "Can you repeat what times those were?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1994ms)
- **Respuesta de la IA**:
> I mentioned that we have openings tomorrow at 11:00 AM and 3:00 PM. 😊

---

### Test #50: Query for later
- **Prompt**: "And later in the afternoon?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1646ms)
- **Respuesta de la IA**:
> We have availability later in the afternoon as well. The next open slot is at 4:00 PM. Would you like to book a time? 😊

---

### Test #51: With name
- **Prompt**: "Hi, I am Robert. What times are open tomorrow?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (3390ms)
- **Respuesta de la IA**:
> Hi Robert! 😊 Tomorrow, we have several time slots available for you. Here they are:
> 
> 10:00 AM
> 10:15 AM
> 10:30 AM
> 10:45 AM
> 11:00 AM
> 11:15 AM
> 11:30 AM
> 11:45 AM
> 12:00 PM
> 12:15 PM and more.
> 
> Which one would you prefer?

---

### Test #52: Service + day
- **Prompt**: "I want Haircut. What times are free Friday?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (3391ms)
- **Respuesta de la IA**:
> I can help with that! 😊 For Friday, August 14, we have several available time slots for a haircut. Here they are:
> 
> 10:00 AM
> 10:15 AM
> 10:30 AM
> 10:45 AM
> 11:00 AM
> 11:15 AM
> 11:30 AM
> 11:45 AM
> 12:00 PM
> 12:15 PM
> 
> Which time works best for you?

---

### Test #53: With email
- **Prompt**: "My email is roberto@example.com. What slots tomorrow?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2393ms)
- **Respuesta de la IA**:
> Sure! 😊 Here are the available time slots for tomorrow:
> 
> 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM, 12:15 PM, and more.
> 
> Which one would you prefer?

---

### Test #54: Request list of open hours
- **Prompt**: "Tell me what times you do have open tomorrow"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2363ms)
- **Respuesta de la IA**:
> Sure! Here are the available time slots for tomorrow:
> 
> 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM, 12:15 PM, and more.
> 
> Which one would you prefer? 😊

---

### Test #55: Name + tomorrow
- **Prompt**: "Hi I am Peter. What availability is there tomorrow?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1904ms)
- **Respuesta de la IA**:
> Hi Peter! 😊 Tomorrow, we have availability during our business hours from 10:00 AM to 8:00 PM. What service are you interested in?

---

### Test #56: With notes
- **Prompt**: "I prefer quiet attention. What times are open?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2093ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Estamos abiertos de lunes a sábado, de 10:00 a 20:00. Si prefieres un ambiente más tranquilo, te recomendaría venir a primera hora o un poco antes de cerrar. ¿Te gustaría agendar una cita para algún día en particular?

---

### Test #57: Availability after price
- **Prompt**: "Great, what times are free tomorrow to book?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2261ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Para mañana, tenemos varias horas disponibles. Puedes elegir entre las siguientes: 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM y 12:15 PM. ¿Cuál prefieres?

---

### Test #58: Saturday
- **Prompt**: "Do you have open slots this Saturday?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2155ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Este sábado tenemos varios horarios disponibles. Puedes elegir entre las 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM, 12:15 PM, entre otros. ¿Te gustaría reservar alguno de estos horarios?

---

### Test #59: Open query
- **Prompt**: "What time slots are free tomorrow for service?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2000ms)
- **Respuesta de la IA**:
> Sure! 😊 Here are the available time slots for tomorrow:
> 
> 10:00 AM
> 10:15 AM
> 10:30 AM
> 10:45 AM
> 11:00 AM
> 11:15 AM
> 11:30 AM
> 11:45 AM
> 12:00 PM
> 12:15 PM and more.
> 
> Which one would you prefer?

---

### Test #60: Last slot
- **Prompt**: "What is the last available slot tomorrow?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2126ms)
- **Respuesta de la IA**:
> I can't confirm the last available slot for tomorrow, but I can tell you that we have several options! 😊 The available time slots for tomorrow are 10:00 AM, 10:15 AM, 10:30 AM, 10:45 AM, 11:00 AM, 11:15 AM, 11:30 AM, 11:45 AM, 12:00 PM, and 12:15 PM. Would you like to book one of these?

---

