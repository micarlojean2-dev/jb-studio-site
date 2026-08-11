# Reporte de Batería de 30 Pruebas de Disponibilidad (SPA - EN)

**Fecha de ejecución**: 2026-08-11T16:22:33.953Z  
**Cliente probado**: `spa`  
**Endpoint**: `https://jbstudio.app/api/client-chat?__bypass=test_bypass_secret_2026`  
**Modelo de IA**: `openai / gpt-4o-mini`  

---

## 📊 Resumen Ejecutivo

- **Total de pruebas**: 30
- **Pruebas Exitosas (PASÓ)**: 29 (97%)
- **Pruebas Fallidas (FALLÓ)**: 1

---

## 📧 Verificación de Correos Reales (Resend)

*No se registraron reservas completadas con envío de correo en esta batería.*

---

## 📋 Detalle de las Conversaciones

| # | Descripción | Prompt Final | Intent | Estado | Latencia | Resultado |
|---|-------------|--------------|--------|--------|----------|-----------|
| 1 | Standard open availability query for tomorrow | "What times are open tomorrow?" | `booking` | 200 | 2622ms | ✅ PASÓ |
| 2 | Open availability query for today | "What times do you have free today?" | `booking` | 200 | 2950ms | ✅ PASÓ |
| 3 | Specific weekday availability | "Do you have anything available on Friday?" | `booking` | 200 | 2880ms | ✅ PASÓ |
| 4 | Broad week availability query | "What time can I come in this week?" | `general_question` | 200 | 2281ms | ✅ PASÓ |
| 5 | Availability query with service name | "I want a massage, when is there space?" | `booking` | 200 | 1921ms | ✅ PASÓ |
| 6 | Afternoon timeframe filter | "Do you have any slots open in the afternoon?" | `booking` | 200 | 2018ms | ✅ PASÓ |
| 7 | Morning timeframe filter | "Anything available in the morning?" | `booking` | 200 | 1906ms | ✅ PASÓ |
| 8 | Urgent / immediate query | "I need an urgent appointment, what do you have right now?" | `booking` | 200 | 1716ms | ✅ PASÓ |
| 9 | Day comparison query | "Which day has the most open slots?" | `general_question` | 200 | 1778ms | ✅ PASÓ |
| 10 | Options request for current week | "Give me options for this week" | `booking` | 200 | 1982ms | ✅ PASÓ |
| 11 | Availability query + service change mid-conversation | "Actually I prefer a Relaxing Massage, what times for that?" | `booking` | 200 | 2118ms | ✅ PASÓ |
| 12 | Closed day query (Sunday) | "Do you have any open slots this Sunday?" | `general_question` | 200 | 2195ms | ✅ PASÓ |
| 13 | Distant date query (2 months) | "What availability do you have for October 15th?" | `booking` | 200 | 1952ms | ✅ PASÓ |
| 14 | Availability + immediate slot selection + REAL RESERVATION EMAIL TEST | "Great, 11:30 AM works perfect for me, my name is John Doe, email johndoe.test.e2e@gmail.com, phone 5551234567" | `booking` | 200 | 2061ms | ❌ FALLÓ |
| 15 | Typo / casual english phrasing | "wht times r free tomow pls" | `general_question` | 200 | 2821ms | ✅ PASÓ |
| 16 | Detailed english slot query | "What time slots do you have available tomorrow morning?" | `booking` | 200 | 2522ms | ✅ PASÓ |
| 17 | Ambiguous open query without date | "When can I come?" | `booking` | 200 | 1958ms | ✅ PASÓ |
| 18 | Long duration service (75 min) | "I want the Hot Stone Massage, what times are free tomorrow?" | `booking` | 200 | 3465ms | ✅ PASÓ |
| 19 | Availability query repeated twice for same day | "Can you repeat what times were open tomorrow?" | `booking` | 200 | 2803ms | ✅ PASÓ |
| 20 | Availability query + follow-up for "later in the afternoon" | "And what about later in the afternoon?" | `general_question` | 200 | 2060ms | ✅ PASÓ |
| 21 | Name already provided + open query | "Hi, I am Sarah. What times are open tomorrow?" | `booking` | 200 | 2349ms | ✅ PASÓ |
| 22 | Service chosen + weekday query | "I want a Body Scrub. What times are open on Friday?" | `general_question` | 200 | 2386ms | ✅ PASÓ |
| 23 | Email provided + open query | "My email is sarah@example.com. What slots are open tomorrow?" | `booking` | 200 | 2574ms | ✅ PASÓ |
| 24 | Active booking flow: changes mind and asks for list of open times | "Just show me all open times tomorrow please" | `booking` | 200 | 3287ms | ✅ PASÓ |
| 25 | English availability query with name | "Hi, I am Michael. What time slots are open tomorrow?" | `booking` | 200 | 2418ms | ✅ PASÓ |
| 26 | Notes/preference included | "I am sensitive to strong scents. What times are open tomorrow for a facial?" | `booking` | 200 | 2732ms | ✅ PASÓ |
| 27 | Availability query after price question | "Awesome. What times are available tomorrow to book it?" | `booking` | 200 | 2982ms | ✅ PASÓ |
| 28 | Saturday availability query | "Do you have open slots this Saturday?" | `general_question` | 200 | 2062ms | ✅ PASÓ |
| 29 | Multiple services query | "I am considering a massage or a facial. What times are open tomorrow?" | `booking` | 200 | 3286ms | ✅ PASÓ |
| 30 | Last slot of the day query | "What is the last available slot tomorrow?" | `general_question` | 200 | 2060ms | ✅ PASÓ |

---

## 📝 Transcripción Completa de Respuestas

### Test #1: Standard open availability query for tomorrow
- **Prompt**: "What times are open tomorrow?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2622ms)
- **Respuesta de la IA**:
> We have several time slots available for tomorrow! 😊 Here they are: 10:00 AM, 10:30 AM, 11:00 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:30 PM, 3:00 PM, and 3:30 PM. Which one would you prefer?

---

### Test #2: Open availability query for today
- **Prompt**: "What times do you have free today?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2950ms)
- **Respuesta de la IA**:
> We have several available time slots today! 😊 Here they are: 10:00 AM, 10:30 AM, 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, and 2:30 PM. Which one would you prefer?

---

### Test #3: Specific weekday availability
- **Prompt**: "Do you have anything available on Friday?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2880ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Para el viernes tenemos varias horas disponibles. Puedes elegir entre 10:00 AM, 10:30 AM, 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, 2:30 PM, entre otras. ¿Cuál prefieres?

---

### Test #4: Broad week availability query
- **Prompt**: "What time can I come in this week?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2281ms)
- **Respuesta de la IA**:
> ¡Claro! 😊 Esta semana estamos abiertos de lunes a sábado, de 10:00 a 21:00. ¿Te gustaría saber sobre algún servicio en particular o necesitas ayuda para agendar una cita?

---

### Test #5: Availability query with service name
- **Prompt**: "I want a massage, when is there space?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1921ms)
- **Respuesta de la IA**:
> I'd love to help you with that! 😊 We have availability for massages today. Would you prefer a relaxing massage or a hot stone massage? Let me know what time works for you!

---

### Test #6: Afternoon timeframe filter
- **Prompt**: "Do you have any slots open in the afternoon?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2018ms)
- **Respuesta de la IA**:
> I can check that for you! 😊 Our business hours today are from 10:00 AM to 9:00 PM. Could you please let me know what specific time you're looking for in the afternoon?

---

### Test #7: Morning timeframe filter
- **Prompt**: "Anything available in the morning?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1906ms)
- **Respuesta de la IA**:
> I can check that for you! 😊 Our business hours start at 10:00 AM. Would you like to know about specific services or just general availability?

---

### Test #8: Urgent / immediate query
- **Prompt**: "I need an urgent appointment, what do you have right now?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1716ms)
- **Respuesta de la IA**:
> I understand the urgency! 😊 Let me check our availability for you. Could you please let me know what service you're interested in and if you have a preferred date or time?
> [MOSTRAR_MENU]

---

### Test #9: Day comparison query
- **Prompt**: "Which day has the most open slots?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (1778ms)
- **Respuesta de la IA**:
> I can't check the availability directly, but our business hours are from 10:00 AM to 9:00 PM, Tuesday through Saturday. If you're looking for a specific day, I recommend calling us at +15035550100 for the most accurate information. 😊

---

### Test #10: Options request for current week
- **Prompt**: "Give me options for this week"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1982ms)
- **Respuesta de la IA**:
> I can help with that! 😊 Our spa is open from 10:00 AM to 9:00 PM, so we have plenty of availability this week. Would you like to know about specific services or just general availability?

---

### Test #11: Availability query + service change mid-conversation
- **Prompt**: "Actually I prefer a Relaxing Massage, what times for that?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2118ms)
- **Respuesta de la IA**:
> For a Relaxing Massage tomorrow, we have availability at 10:00 AM, 11:30 AM, and 2:00 PM. Which time works best for you? 😊

---

### Test #12: Closed day query (Sunday)
- **Prompt**: "Do you have any open slots this Sunday?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2195ms)
- **Respuesta de la IA**:
> Lo siento, pero este domingo estamos cerrados. 😊 Si quieres, puedo ayudarte a encontrar otra fecha disponible.

---

### Test #13: Distant date query (2 months)
- **Prompt**: "What availability do you have for October 15th?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1952ms)
- **Respuesta de la IA**:
> I can't check availability directly from here, but I recommend giving us a call at +15035550100 for the most accurate information on October 15th. 😊 Is there a specific service you're interested in?

---

### Test #14: Availability + immediate slot selection + REAL RESERVATION EMAIL TEST
- **Prompt**: "Great, 11:30 AM works perfect for me, my name is John Doe, email johndoe.test.e2e@gmail.com, phone 5551234567"
- **Intención Interpretada**: `booking`
- **Resultado**: ❌ FALLÓ (2061ms)
- **Respuesta de la IA**:
> Perfect, John! 😊 I have you down for a Relaxing Massage at 11:30 AM tomorrow. Just to confirm, that's for you, right?

---

### Test #15: Typo / casual english phrasing
- **Prompt**: "wht times r free tomow pls"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2821ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Mañana estamos abiertos de 10:00 a 21:00. Si deseas saber sobre la disponibilidad de un servicio específico, puedo ayudarte con eso. ¿Te gustaría reservar algo en particular?

---

### Test #16: Detailed english slot query
- **Prompt**: "What time slots do you have available tomorrow morning?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2522ms)
- **Respuesta de la IA**:
> We have several time slots available tomorrow morning! 😊 Here they are: 10:00 AM, 10:30 AM, 11:00 AM, 12:00 PM, and 12:30 PM. Which one would you prefer?

---

### Test #17: Ambiguous open query without date
- **Prompt**: "When can I come?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (1958ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Estamos abiertos hoy hasta las 21:00. ¿Te gustaría reservar un servicio para hoy o prefieres otro día?

---

### Test #18: Long duration service (75 min)
- **Prompt**: "I want the Hot Stone Massage, what times are free tomorrow?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (3465ms)
- **Respuesta de la IA**:
> Great choice with the Hot Stone Massage! 😊 Tomorrow, we have several time slots available: 10:00 AM, 10:30 AM, 11:00 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:30 PM, 3:00 PM, and 3:30 PM. Which one works best for you?

---

### Test #19: Availability query repeated twice for same day
- **Prompt**: "Can you repeat what times were open tomorrow?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2803ms)
- **Respuesta de la IA**:
> Tomorrow we have available times at 10:00 AM, 10:30 AM, 11:00 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:30 PM, 3:00 PM, and 3:30 PM. Which one do you prefer?

---

### Test #20: Availability query + follow-up for "later in the afternoon"
- **Prompt**: "And what about later in the afternoon?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2060ms)
- **Respuesta de la IA**:
> In the afternoon, we have availability at 1:00 PM, 2:30 PM, 4:00 PM, and 5:30 PM. Would you like to book a time? 😊

---

### Test #21: Name already provided + open query
- **Prompt**: "Hi, I am Sarah. What times are open tomorrow?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2349ms)
- **Respuesta de la IA**:
> Hi Sarah! 😊 Here are the available time slots for tomorrow:
> 
> 10:00 AM, 10:30 AM, 11:00 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:30 PM, 3:00 PM, 3:30 PM, and more.
> 
> Which one would you prefer?

---

### Test #22: Service chosen + weekday query
- **Prompt**: "I want a Body Scrub. What times are open on Friday?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2386ms)
- **Respuesta de la IA**:
> I can help with that! 😊 The Body Scrub is actually called Exfoliación corporal here. On Friday, we have several time slots available: 10:00 AM, 10:30 AM, 11:00 AM, 11:30 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:00 PM, and 2:30 PM. Which one works best for you?

---

### Test #23: Email provided + open query
- **Prompt**: "My email is sarah@example.com. What slots are open tomorrow?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2574ms)
- **Respuesta de la IA**:
> Sure! 😊 Here are the available time slots for tomorrow:
> 
> 10:00 AM, 10:30 AM, 11:00 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:30 PM, 3:00 PM, 3:30 PM, and more.
> 
> Which one would you prefer?

---

### Test #24: Active booking flow: changes mind and asks for list of open times
- **Prompt**: "Just show me all open times tomorrow please"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (3287ms)
- **Respuesta de la IA**:
> Sure! Here are the available time slots for tomorrow:
> 
> 10:00 AM
> 10:30 AM
> 11:00 AM
> 12:00 PM
> 12:30 PM
> 1:00 PM
> 1:30 PM
> 2:30 PM
> 3:00 PM
> 3:30 PM and more.
> 
> Which one would you prefer? 😊

---

### Test #25: English availability query with name
- **Prompt**: "Hi, I am Michael. What time slots are open tomorrow?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2418ms)
- **Respuesta de la IA**:
> Hi Michael! 😊 Here are the available time slots for tomorrow:
> 
> 10:00 AM, 10:30 AM, 11:00 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:30 PM, 3:00 PM, 3:30 PM, and more.
> 
> Which one would you prefer?

---

### Test #26: Notes/preference included
- **Prompt**: "I am sensitive to strong scents. What times are open tomorrow for a facial?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2732ms)
- **Respuesta de la IA**:
> I completely understand your concern about scents! 😊 For tomorrow, we have several time slots available for a facial. Here they are:
> 
> 10:00 AM
> 10:30 AM
> 11:00 AM
> 12:00 PM
> 12:30 PM
> 1:00 PM
> 1:30 PM
> 2:30 PM
> 3:00 PM
> 3:30 PM
> 
> Which time works best for you?

---

### Test #27: Availability query after price question
- **Prompt**: "Awesome. What times are available tomorrow to book it?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (2982ms)
- **Respuesta de la IA**:
> We have several time slots available for tomorrow! 😊 Here are the options: 10:00 AM, 10:30 AM, 11:00 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:30 PM, 3:00 PM, and 3:30 PM. Which one would you prefer?

---

### Test #28: Saturday availability query
- **Prompt**: "Do you have open slots this Saturday?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2062ms)
- **Respuesta de la IA**:
> ¡Hola! 😊 Este sábado estamos abiertos de 10:00 a 21:00. Si quieres, puedo decirte los horarios disponibles. ¿Te gustaría saber cuáles son?

---

### Test #29: Multiple services query
- **Prompt**: "I am considering a massage or a facial. What times are open tomorrow?"
- **Intención Interpretada**: `booking`
- **Resultado**: ✅ PASÓ (3286ms)
- **Respuesta de la IA**:
> I can help with that! 😊 Here are the available time slots for tomorrow:
> 
> 10:00 AM, 10:30 AM, 11:00 AM, 12:00 PM, 12:30 PM, 1:00 PM, 1:30 PM, 2:30 PM, 3:00 PM, 3:30 PM, and more.
> 
> Which time works best for you?

---

### Test #30: Last slot of the day query
- **Prompt**: "What is the last available slot tomorrow?"
- **Intención Interpretada**: `general_question`
- **Resultado**: ✅ PASÓ (2060ms)
- **Respuesta de la IA**:
> The last available time slot tomorrow is 3:30 PM. If you'd like to book it or need more options, just let me know! 😊

---

