import fs from 'fs';

const API_URL = 'https://jbstudio.app/api/client-chat';
const CLIENT_ID = 'spa';

const testCases = [
  { id: 1, prompt: '¿qué horas tienen disponible mañana?', desc: 'Pregunta abierta estándar para mañana' },
  { id: 2, prompt: '¿qué horas tienen libres hoy?', desc: 'Pregunta abierta para hoy' },
  { id: 3, prompt: '¿tienen algo disponible el viernes?', desc: 'Pregunta para un día de la semana específico' },
  { id: 4, prompt: '¿a qué hora puedo ir esta semana?', desc: 'Pregunta amplia por la semana' },
  { id: 5, prompt: 'quiero un masaje, ¿cuándo hay espacio?', desc: 'Pregunta de disponibilidad mencionando servicio' },
  { id: 6, prompt: '¿tienen hueco en la tarde?', desc: 'Filtro por franja horaria (tarde)' },
  { id: 7, prompt: '¿algo disponible en la mañana?', desc: 'Filtro por franja horaria (mañana)' },
  { id: 8, prompt: 'necesito una cita urgente, ¿qué tienen ahorita?', desc: 'Urgencia / inmediatez' },
  { id: 9, prompt: '¿qué día tienen más disponibilidad?', desc: 'Consulta comparativa de días' },
  { id: 10, prompt: 'dame opciones para esta semana', desc: 'Solicitud de opciones semanales' },
  {
    id: 11,
    desc: 'Disponibilidad + cambio de servicio a mitad de conversación',
    messages: [
      { role: 'user', content: '¿Qué horas hay libres mañana para un Facial?' },
      { role: 'assistant', content: 'Para mañana tenemos disponibles a las 10:00 AM, 11:30 AM y 2:00 PM.' },
      { role: 'user', content: 'Mejor para un Masaje relajante, ¿a qué hora?' }
    ]
  },
  { id: 12, prompt: '¿Tienen citas libres este domingo?', desc: 'Día cerrado (Domingo)' },
  { id: 13, prompt: '¿Qué disponibilidad tienen para el 15 de octubre?', desc: 'Fecha lejana (2 meses)' },
  {
    id: 14,
    desc: 'Disponibilidad + selección inmediata de una hora ofrecida',
    messages: [
      { role: 'user', content: '¿Qué horas tienen disponibles mañana?' },
      { role: 'assistant', content: 'Tenemos disponibilidad a las 10:00 AM, 11:30 AM y 3:00 PM.' },
      { role: 'user', content: 'Perfecto, me queda bien a las 11:30 AM' }
    ]
  },
  { id: 15, prompt: 'q oras tienen libre mañna porfa', desc: 'Errores de ortografía / coloquial' },
  { id: 16, prompt: 'What time slots do you have available tomorrow?', desc: 'Consulta en inglés' },
  { id: 17, prompt: '¿cuándo puedo ir?', desc: 'Pregunta muy ambigua sin fecha' },
  { id: 18, prompt: 'Quiero el Masaje de piedras calientes, ¿qué horas hay libres mañana?', desc: 'Servicio específico largo (75 min)' },
  {
    id: 19,
    desc: 'Pregunta disponibilidad dos veces seguidas para el mismo día',
    messages: [
      { role: 'user', content: '¿Qué horas tienen libres mañana?' },
      { role: 'assistant', content: 'Mañana tenemos espacio a las 10:00 AM, 1:00 PM y 4:00 PM.' },
      { role: 'user', content: '¿Me puedes repetir qué horas eran para mañana?' }
    ]
  },
  {
    id: 20,
    desc: 'Pregunta disponibilidad y luego consulta por "más tarde"',
    messages: [
      { role: 'user', content: '¿Qué horas tienen disponibles mañana en la mañana?' },
      { role: 'assistant', content: 'En la mañana tenemos disponible a las 10:00 AM y 11:30 AM.' },
      { role: 'user', content: '¿Y más tarde en la tarde qué tienen?' }
    ]
  },
  // 21 - 30: Variaciones con datos en curso
  {
    id: 21,
    desc: 'Con nombre ya capturado + consulta disponibilidad',
    messages: [
      { role: 'user', content: 'Hola, soy Carlos. ¿Qué horas tienen disponibles mañana?' }
    ]
  },
  {
    id: 22,
    desc: 'Con servicio elegido + consulta disponibilidad para el viernes',
    messages: [
      { role: 'user', content: 'Quiero una Exfoliación corporal. ¿Qué horarios tienen libres el viernes?' }
    ]
  },
  {
    id: 23,
    desc: 'Con correo ya proporcionado + consulta disponibilidad',
    messages: [
      { role: 'user', content: 'Mi correo es carlos@example.com. ¿Qué citas hay para mañana?' }
    ]
  },
  {
    id: 24,
    desc: 'Flujo de reserva activo: cambia de opinión y pide lista de horas',
    messages: [
      { role: 'user', content: 'Quiero agendar para mañana a las 3pm' },
      { role: 'assistant', content: 'A esa hora no tenemos espacio. ¿Te sirve a las 2:00 PM?' },
      { role: 'user', content: 'Mejor dime qué otras horas tienes libres mañana' }
    ]
  },
  {
    id: 25,
    desc: 'Consulta disponibilidad en inglés con nombre dado',
    messages: [
      { role: 'user', content: 'Hi, I am Sarah. What times are open tomorrow?' }
    ]
  },
  {
    id: 26,
    desc: 'Consulta disponibilidad indicando preferencia de notas (sin perfume)',
    messages: [
      { role: 'user', content: 'Soy sensible a los olores fuertes. ¿Qué horas tienen disponibles mañana para un facial?' }
    ]
  },
  {
    id: 27,
    desc: 'Consulta disponibilidad tras preguntar por el precio',
    messages: [
      { role: 'user', content: '¿Cuánto cuesta la pedicura spa?' },
      { role: 'assistant', content: 'La pedicura spa tiene un costo de $55 y dura 60 minutos.' },
      { role: 'user', content: 'Excelente. ¿Qué horas tienen disponibles mañana para agendarla?' }
    ]
  },
  {
    id: 28,
    desc: 'Consulta disponibilidad para mañana sábado',
    messages: [
      { role: 'user', content: '¿Tienen huecos disponibles este sábado?' }
    ]
  },
  {
    id: 29,
    desc: 'Consulta de disponibilidad con múltiples servicios contemplados',
    messages: [
      { role: 'user', content: 'Estoy entre un masaje relajante y un facial. ¿Qué horarios tienen libres mañana?' }
    ]
  },
  {
    id: 30,
    desc: 'Consulta disponibilidad solicitando el último turno del día',
    messages: [
      { role: 'user', content: '¿Cuál es el último turno disponible que tienen mañana?' }
    ]
  }
];

async function runSingleTest(tc) {
  const msgs = tc.messages || [{ role: 'user', content: tc.prompt }];
  const startTime = Date.now();

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: CLIENT_ID, messages: msgs })
    });

    const latency = Date.now() - startTime;
    const data = await res.json();
    const text = data.text || '';
    const intent = data.interpretation?.intent || 'N/A';

    // Criterios de Evaluación
    const statusOk = res.ok && !data.error;
    const mentionsHours = /\b(10|11|12|1|2|3|4|5|6|7|8|9):[0-5][0-9]\b|\b(10|11|12|1|2|3|4|5|6|7|8|9)\s*(am|pm)\b|cerrad[oa]/i.test(text);
    const coherent = text.length > 15 && !text.includes('undefined') && !text.includes('NaN');
    const pass = statusOk && coherent;

    return {
      id: tc.id,
      desc: tc.desc,
      prompt: msgs[msgs.length - 1].content,
      status: res.status,
      latency,
      pass,
      intent,
      reply: text
    };
  } catch (err) {
    return {
      id: tc.id,
      desc: tc.desc,
      prompt: msgs[msgs.length - 1].content,
      status: 500,
      latency: Date.now() - startTime,
      pass: false,
      intent: 'error',
      reply: `Error de red/API: ${err.message}`
    };
  }
}

async function main() {
  console.log('🚀 Iniciando Batería de 30 Pruebas de Disponibilidad Abierta para client:spa...');
  const results = [];

  for (const tc of testCases) {
    console.log(`Ejecutando Test #${tc.id}: ${tc.desc}...`);
    const r = await runSingleTest(tc);
    results.push(r);
    // Pequeña pausa entre requests para no saturar rate limit
    await new Promise(res => setTimeout(res, 800));
  }

  const passCount = results.filter(r => r.pass).length;
  const failCount = results.length - passCount;

  let reportMd = `# Reporte de Batería de 30 Pruebas de Disponibilidad Abierta (client:spa)

**Fecha de ejecución**: ${new Date().toISOString()}  
**Cliente probado**: \`client:spa\` (Spa)  
**Endpoint**: \`POST https://jbstudio.app/api/client-chat\`  
**Modelo de IA**: \`openai / gpt-4o-mini\`  

---

## 📊 Resumen Ejecutivo

- **Total de pruebas**: ${results.length}
- **Pruebas Exitosas (PASÓ)**: ${passCount} (${Math.round((passCount / results.length) * 100)}%)
- **Pruebas Fallidas (FALLÓ)**: ${failCount}

---

## 📋 Detalle de las 30 Conversaciones

| # | Descripción | Prompt Final | Intent | Estado | Latencia | Resultado |
|---|-------------|--------------|--------|--------|----------|-----------|
`;

  results.forEach(r => {
    const badge = r.pass ? '✅ PASÓ' : '❌ FALLÓ';
    const cleanPrompt = r.prompt.replace(/\n/g, ' ');
    reportMd += `| ${r.id} | ${r.desc} | "${cleanPrompt}" | \`${r.intent}\` | ${r.status} | ${r.latency}ms | ${badge} |\n`;
  });

  reportMd += `\n---

## 📝 Transcripción Completa de Respuestas

`;

  results.forEach(r => {
    reportMd += `### Test #${r.id}: ${r.desc}
- **Prompt**: "${r.prompt}"
- **Intención Interpretada**: \`${r.intent}\`
- **Resultado**: ${r.pass ? '✅ PASÓ' : '❌ FALLÓ'} (${r.latency}ms)
- **Respuesta de la IA**:
> ${r.reply.replace(/\n/g, '\n> ')}

---

`;
  });

  fs.writeFileSync('REPORTE_DISPONIBILIDAD_30_SPA.md', reportMd);
  console.log('✅ Batería completada. Reporte guardado en REPORTE_DISPONIBILIDAD_30_SPA.md');
}

main();
