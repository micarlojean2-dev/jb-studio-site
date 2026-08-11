import fs from 'fs';

const BASE_URL = 'https://jbstudio.app';
const CHAT_URL = `${BASE_URL}/api/client-chat?__bypass=test_bypass_secret_2026`;
const RESERVATIONS_URL = `${BASE_URL}/api/reservations?__bypass=test_bypass_secret_2026`;

// ── BATERÍA 1: SPA (30 PRUEBAS EN INGLÉS) ──────────────────────────────────
const spaEnglishCases = [
  { id: 1, prompt: 'What times are open tomorrow?', desc: 'Standard open availability query for tomorrow' },
  { id: 2, prompt: 'What times do you have free today?', desc: 'Open availability query for today' },
  { id: 3, prompt: 'Do you have anything available on Friday?', desc: 'Specific weekday availability' },
  { id: 4, prompt: 'What time can I come in this week?', desc: 'Broad week availability query' },
  { id: 5, prompt: 'I want a massage, when is there space?', desc: 'Availability query with service name' },
  { id: 6, prompt: 'Do you have any slots open in the afternoon?', desc: 'Afternoon timeframe filter' },
  { id: 7, prompt: 'Anything available in the morning?', desc: 'Morning timeframe filter' },
  { id: 8, prompt: 'I need an urgent appointment, what do you have right now?', desc: 'Urgent / immediate query' },
  { id: 9, prompt: 'Which day has the most open slots?', desc: 'Day comparison query' },
  { id: 10, prompt: 'Give me options for this week', desc: 'Options request for current week' },
  {
    id: 11,
    desc: 'Availability query + service change mid-conversation',
    messages: [
      { role: 'user', content: 'What times are free tomorrow for a Hydrating Facial?' },
      { role: 'assistant', content: 'Tomorrow we have open slots at 10:00 AM, 11:30 AM, and 2:00 PM.' },
      { role: 'user', content: 'Actually I prefer a Relaxing Massage, what times for that?' }
    ]
  },
  { id: 12, prompt: 'Do you have any open slots this Sunday?', desc: 'Closed day query (Sunday)' },
  { id: 13, prompt: 'What availability do you have for October 15th?', desc: 'Distant date query (2 months)' },
  {
    id: 14,
    desc: 'Availability + immediate slot selection + REAL RESERVATION EMAIL TEST',
    shouldCreateReservation: true,
    reservationData: {
      servicio: 'Masaje relajante',
      fecha: 'mañana',
      hora: '11:30 AM',
      nombre: 'John Doe',
      email: 'johndoe.test.e2e@gmail.com',
      telefono: '+15551234567'
    },
    messages: [
      { role: 'user', content: 'What times are open tomorrow for a Relaxing Massage?' },
      { role: 'assistant', content: 'We have availability at 10:00 AM, 11:30 AM, and 3:00 PM.' },
      { role: 'user', content: 'Great, 11:30 AM works perfect for me, my name is John Doe, email johndoe.test.e2e@gmail.com, phone 5551234567' }
    ]
  },
  { id: 15, prompt: 'wht times r free tomow pls', desc: 'Typo / casual english phrasing' },
  { id: 16, prompt: 'What time slots do you have available tomorrow morning?', desc: 'Detailed english slot query' },
  { id: 17, prompt: 'When can I come?', desc: 'Ambiguous open query without date' },
  { id: 18, prompt: 'I want the Hot Stone Massage, what times are free tomorrow?', desc: 'Long duration service (75 min)' },
  {
    id: 19,
    desc: 'Availability query repeated twice for same day',
    messages: [
      { role: 'user', content: 'What times are open tomorrow?' },
      { role: 'assistant', content: 'Tomorrow we have space at 10:00 AM, 1:00 PM, and 4:00 PM.' },
      { role: 'user', content: 'Can you repeat what times were open tomorrow?' }
    ]
  },
  {
    id: 20,
    desc: 'Availability query + follow-up for "later in the afternoon"',
    messages: [
      { role: 'user', content: 'What times are open tomorrow morning?' },
      { role: 'assistant', content: 'In the morning we have 10:00 AM and 11:30 AM.' },
      { role: 'user', content: 'And what about later in the afternoon?' }
    ]
  },
  // 21 - 30: Context variations
  { id: 21, prompt: 'Hi, I am Sarah. What times are open tomorrow?', desc: 'Name already provided + open query' },
  { id: 22, prompt: 'I want a Body Scrub. What times are open on Friday?', desc: 'Service chosen + weekday query' },
  { id: 23, prompt: 'My email is sarah@example.com. What slots are open tomorrow?', desc: 'Email provided + open query' },
  {
    id: 24,
    desc: 'Active booking flow: changes mind and asks for list of open times',
    messages: [
      { role: 'user', content: 'I want to book for tomorrow at 3pm' },
      { role: 'assistant', content: 'That time is not available. How about 2:00 PM?' },
      { role: 'user', content: 'Just show me all open times tomorrow please' }
    ]
  },
  { id: 25, prompt: 'Hi, I am Michael. What time slots are open tomorrow?', desc: 'English availability query with name' },
  { id: 26, prompt: 'I am sensitive to strong scents. What times are open tomorrow for a facial?', desc: 'Notes/preference included' },
  {
    id: 27,
    desc: 'Availability query after price question',
    messages: [
      { role: 'user', content: 'How much is the Spa Pedicure?' },
      { role: 'assistant', content: 'The Spa Pedicure is $55 and takes 60 minutes.' },
      { role: 'user', content: 'Awesome. What times are available tomorrow to book it?' }
    ]
  },
  { id: 28, prompt: 'Do you have open slots this Saturday?', desc: 'Saturday availability query' },
  { id: 29, prompt: 'I am considering a massage or a facial. What times are open tomorrow?', desc: 'Multiple services query' },
  { id: 30, prompt: 'What is the last available slot tomorrow?', desc: 'Last slot of the day query' }
];

// ── BATERÍA 2 Y 3 (ESPAÑOL E INGLÉS) ───────────────────────────────────────
function generate30Cases(lang, serviceName, closedDay) {
  const isEs = lang === 'es';
  return [
    { id: 1, prompt: isEs ? '¿qué horas tienen disponible mañana?' : 'What times are open tomorrow?', desc: isEs ? 'Mañana abierto' : 'Tomorrow open' },
    { id: 2, prompt: isEs ? '¿qué horas tienen libres hoy?' : 'What times do you have free today?', desc: isEs ? 'Hoy libre' : 'Today free' },
    { id: 3, prompt: isEs ? '¿tienen algo disponible el viernes?' : 'Anything available on Friday?', desc: isEs ? 'Viernes' : 'Friday' },
    { id: 4, prompt: isEs ? '¿a qué hora puedo ir esta semana?' : 'What time can I come this week?', desc: isEs ? 'Semana' : 'This week' },
    { id: 5, prompt: isEs ? `quiero ${serviceName}, ¿cuándo hay espacio?` : `I want ${serviceName}, when is there space?`, desc: isEs ? 'Con servicio' : 'With service' },
    { id: 6, prompt: isEs ? '¿tienen hueco en la tarde?' : 'Any open slots in the afternoon?', desc: isEs ? 'Tarde' : 'Afternoon' },
    { id: 7, prompt: isEs ? '¿algo disponible en la mañana?' : 'Anything available in the morning?', desc: isEs ? 'Mañana am' : 'Morning' },
    { id: 8, prompt: isEs ? 'necesito una cita urgente, ¿qué tienen ahorita?' : 'I need an urgent appointment, what is free right now?', desc: isEs ? 'Urgente' : 'Urgent' },
    { id: 9, prompt: isEs ? '¿qué día tienen más disponibilidad?' : 'Which day has the most availability?', desc: isEs ? 'Comparación días' : 'Day comparison' },
    { id: 10, prompt: isEs ? 'dame opciones para esta semana' : 'Give me options for this week', desc: isEs ? 'Opciones semana' : 'Week options' },
    {
      id: 11,
      desc: isEs ? 'Cambio de servicio' : 'Service change',
      messages: [
        { role: 'user', content: isEs ? `¿Qué horas hay libres mañana para ${serviceName}?` : `What times are free tomorrow for ${serviceName}?` },
        { role: 'assistant', content: isEs ? 'Tenemos espacio a las 11:00 AM y 3:00 PM.' : 'We have space at 11:00 AM and 3:00 PM.' },
        { role: 'user', content: isEs ? 'Mejor otra opción, ¿qué horas hay?' : 'Better another option, what times are there?' }
      ]
    },
    { id: 12, prompt: isEs ? `¿Tienen citas libres este ${closedDay}?` : `Do you have open slots this ${closedDay}?`, desc: isEs ? 'Día cerrado' : 'Closed day' },
    { id: 13, prompt: isEs ? '¿Qué disponibilidad tienen para el 15 de octubre?' : 'What availability do you have for October 15th?', desc: isEs ? 'Fecha lejana' : 'Distant date' },
    {
      id: 14,
      desc: isEs ? 'Reserva real + Envío de correo Resend' : 'Real booking + Resend email dispatch',
      shouldCreateReservation: true,
      reservationData: {
        servicio: serviceName,
        fecha: 'mañana',
        hora: '11:00 AM',
        nombre: isEs ? 'Carlos Test' : 'Charles Test',
        email: 'carlostest.e2e@gmail.com',
        telefono: '+15559876543'
      },
      messages: [
        { role: 'user', content: isEs ? `¿Qué horas tienen libres mañana para ${serviceName}?` : `What times are open tomorrow for ${serviceName}?` },
        { role: 'assistant', content: isEs ? 'Tenemos a las 11:00 AM y 2:00 PM.' : 'We have 11:00 AM and 2:00 PM.' },
        { role: 'user', content: isEs ? `Agendar a las 11:00 AM, mi nombre es Carlos Test, email carlostest.e2e@gmail.com` : `Book 11:00 AM, my name is Charles Test, email carlostest.e2e@gmail.com` }
      ]
    },
    { id: 15, prompt: isEs ? 'q oras tienen libre mañna' : 'wht times r free tomow', desc: isEs ? 'Ortografía' : 'Typos' },
    { id: 16, prompt: isEs ? '¿Tienen horarios disponibles mañana por la mañana?' : 'Do you have open time slots tomorrow morning?', desc: isEs ? 'Franja especifica' : 'Specific window' },
    { id: 17, prompt: isEs ? '¿cuándo puedo ir?' : 'When can I come in?', desc: isEs ? 'Ambigua' : 'Ambiguous' },
    { id: 18, prompt: isEs ? `Quiero ${serviceName}, ¿qué horas hay libres mañana?` : `I want ${serviceName}, what times are free tomorrow?`, desc: isEs ? 'Servicio especifico' : 'Specific item' },
    {
      id: 19,
      desc: isEs ? 'Repetir disponibilidad' : 'Repeat availability',
      messages: [
        { role: 'user', content: isEs ? '¿Qué horas tienen libres mañana?' : 'What times are open tomorrow?' },
        { role: 'assistant', content: isEs ? 'Mañana tenemos espacio a las 11:00 AM y 3:00 PM.' : 'Tomorrow we have space at 11:00 AM and 3:00 PM.' },
        { role: 'user', content: isEs ? '¿Me repites qué horas eran?' : 'Can you repeat what times those were?' }
      ]
    },
    {
      id: 20,
      desc: isEs ? 'Consulta por más tarde' : 'Query for later',
      messages: [
        { role: 'user', content: isEs ? '¿Qué horas hay en la mañana?' : 'What times in the morning?' },
        { role: 'assistant', content: isEs ? 'A las 11:00 AM tenemos espacio.' : 'At 11:00 AM we have space.' },
        { role: 'user', content: isEs ? '¿Y más tarde en la tarde?' : 'And later in the afternoon?' }
      ]
    },
    { id: 21, prompt: isEs ? 'Hola, soy Roberto. ¿Qué horas tienen libres mañana?' : 'Hi, I am Robert. What times are open tomorrow?', desc: isEs ? 'Con nombre' : 'With name' },
    { id: 22, prompt: isEs ? `Quiero ${serviceName}. ¿Qué horarios hay libres el viernes?` : `I want ${serviceName}. What times are free Friday?`, desc: isEs ? 'Servicio + día' : 'Service + day' },
    { id: 23, prompt: isEs ? 'Mi correo es roberto@example.com. ¿Qué citas hay mañana?' : 'My email is roberto@example.com. What slots tomorrow?', desc: isEs ? 'Con email' : 'With email' },
    {
      id: 24,
      desc: isEs ? 'Pedir lista de horas' : 'Request list of open hours',
      messages: [
        { role: 'user', content: isEs ? 'Quiero ir mañana a las 5pm' : 'I want to go tomorrow at 5pm' },
        { role: 'assistant', content: isEs ? 'No tenemos espacio a esa hora.' : 'We do not have space at that time.' },
        { role: 'user', content: isEs ? 'Dime qué horas sí tienen libres mañana' : 'Tell me what times you do have open tomorrow' }
      ]
    },
    { id: 25, prompt: isEs ? 'Hola soy Pedro. ¿Qué disponibilidad hay mañana?' : 'Hi I am Peter. What availability is there tomorrow?', desc: isEs ? 'Nombre + mañana' : 'Name + tomorrow' },
    { id: 26, prompt: isEs ? 'Tengo preferencia por atención tranquila. ¿Qué horas hay disponibles?' : 'I prefer quiet attention. What times are open?', desc: isEs ? 'Con notas' : 'With notes' },
    {
      id: 27,
      desc: isEs ? 'Disponibilidad tras precio' : 'Availability after price',
      messages: [
        { role: 'user', content: isEs ? `¿Cuánto cuesta ${serviceName}?` : `How much is ${serviceName}?` },
        { role: 'assistant', content: isEs ? 'Tiene un costo estándar.' : 'It has a standard price.' },
        { role: 'user', content: isEs ? 'Excelente, ¿qué horas hay libres mañana para agendar?' : 'Great, what times are free tomorrow to book?' }
      ]
    },
    { id: 28, prompt: isEs ? '¿Tienen huecos disponibles este sábado?' : 'Do you have open slots this Saturday?', desc: isEs ? 'Sábado' : 'Saturday' },
    { id: 29, prompt: isEs ? '¿Qué horarios tienen libres mañana para atención?' : 'What time slots are free tomorrow for service?', desc: isEs ? 'Consulta libre' : 'Open query' },
    { id: 30, prompt: isEs ? '¿Cuál es el último turno disponible mañana?' : 'What is the last available slot tomorrow?', desc: isEs ? 'Último turno' : 'Last slot' }
  ];
}

async function runSingleTest(clientId, tc) {
  const msgs = tc.messages || [{ role: 'user', content: tc.prompt }];
  const startTime = Date.now();

  const mockIp = `10.0.0.${(tc.id % 250) + 1}`;
  try {
    const res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': mockIp,
        'x-test-bypass': 'test_bypass_secret_2026'
      },
      body: JSON.stringify({ clientId, messages: msgs })
    });

    const latency = Date.now() - startTime;
    const data = await res.json();
    const text = data.text || '';
    const intent = data.interpretation?.intent || 'N/A';

    const statusOk = res.ok && !data.error;
    const coherent = text.length > 15 && !text.includes('undefined') && !text.includes('NaN');
    let pass = statusOk && coherent;
    let emailVerification = null;

    // Si la prueba incluye creación real de reserva, ejecutamos POST /api/reservations
    if (tc.shouldCreateReservation && tc.reservationData) {
      const rRes = await fetch(RESERVATIONS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          action: 'create',
          __bypass: 'test_bypass_secret_2026',
          ...tc.reservationData,
          nombre: `${tc.reservationData.nombre} ${Date.now().toString().slice(-4)}`
        })
      });
      const rData = await rRes.json();
      const emailObj = rData.email || {};
      const customerObj = emailObj.customer || {};
      const ownerObj = emailObj.owners || {};

      if (rData.ok && rData.reservationCreated) {
        emailVerification = {
          clientEmailMessageId: customerObj.messageId || 'N/A',
          ownerEmailMessageId: (ownerObj.messageIds && ownerObj.messageIds[0]) || 'N/A',
          emailSent: customerObj.sent === true
        };
      } else {
        pass = false;
      }
    }

    return {
      id: tc.id,
      desc: tc.desc,
      prompt: msgs[msgs.length - 1].content,
      status: res.status,
      latency,
      pass,
      intent,
      reply: text,
      emailVerification
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
      reply: `Error de API: ${err.message}`,
      emailVerification: null
    };
  }
}

async function runBattery(clientId, cases, reportTitle, fileName) {
  console.log(`\n🚀 Ejecutando Batería para ${clientId} (${cases.length} pruebas)...`);
  const results = [];

  for (const tc of cases) {
    console.log(`[${clientId}] Test #${tc.id}: ${tc.desc}...`);
    const r = await runSingleTest(clientId, tc);
    results.push(r);
    await new Promise(res => setTimeout(res, 600));
  }

  const passCount = results.filter(r => r.pass).length;
  const failCount = results.length - passCount;

  let reportMd = `# ${reportTitle}

**Fecha de ejecución**: ${new Date().toISOString()}  
**Cliente probado**: \`${clientId}\`  
**Endpoint**: \`${CHAT_URL}\`  
**Modelo de IA**: \`openai / gpt-4o-mini\`  

---

## 📊 Resumen Ejecutivo

- **Total de pruebas**: ${results.length}
- **Pruebas Exitosas (PASÓ)**: ${passCount} (${Math.round((passCount / results.length) * 100)}%)
- **Pruebas Fallidas (FALLÓ)**: ${failCount}

---

## 📧 Verificación de Correos Reales (Resend)

`;

  const emailTests = results.filter(r => r.emailVerification);
  if (emailTests.length > 0) {
    reportMd += `| # | Caso de Reserva | Resend Client Message ID | Resend Owner Message ID | Estado Envío |
|---|-----------------|--------------------------|-------------------------|--------------|
`;
    emailTests.forEach(e => {
      reportMd += `| ${e.id} | ${e.desc} | \`${e.emailVerification.clientEmailMessageId}\` | \`${e.emailVerification.ownerEmailMessageId}\` | ${e.emailVerification.emailSent ? '✅ ENVIADO' : '❌ ERROR'} |\n`;
    });
  } else {
    reportMd += `*No se registraron reservas completadas con envío de correo en esta batería.*\n`;
  }

  reportMd += `\n---

## 📋 Detalle de las Conversaciones

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
`;
    if (r.emailVerification) {
      reportMd += `- **Resend Client Message ID**: \`${r.emailVerification.clientEmailMessageId}\`\n`;
      reportMd += `- **Resend Owner Message ID**: \`${r.emailVerification.ownerEmailMessageId}\`\n`;
    }
    reportMd += `- **Respuesta de la IA**:
> ${r.reply.replace(/\n/g, '\n> ')}

---

`;
  });

  fs.writeFileSync(fileName, reportMd);
  console.log(`✅ Batería completada para ${clientId}. Guardado en ${fileName}`);
}

async function main() {
  // 1. SPA EN
  await runBattery(
    'spa',
    spaEnglishCases,
    'Reporte de Batería de 30 Pruebas de Disponibilidad (SPA - EN)',
    'REPORTE_DISPONIBILIDAD_30_SPA_EN.md'
  );

  // 2. BARBERIA ES (30) + EN (30)
  const barberiaEsCases = generate30Cases('es', 'Corte de cabello', 'domingo');
  const barberiaEnCases = generate30Cases('en', 'Haircut', 'Sunday').map(c => ({ ...c, id: c.id + 30 }));
  await runBattery(
    'barberia-el-corte-fino',
    [...barberiaEsCases, ...barberiaEnCases],
    'Reporte de Batería de 60 Pruebas de Disponibilidad (Barbería El Corte Fino - ES + EN)',
    'REPORTE_DISPONIBILIDAD_BARBERIA_ES_EN.md'
  );

  // 3. RESTAURANTE ES (30) + EN (30)
  const restauranteEsCases = generate30Cases('es', 'Mesa para 2 personas', 'domingo');
  const restauranteEnCases = generate30Cases('en', 'Table for 2', 'Sunday').map(c => ({ ...c, id: c.id + 30 }));
  await runBattery(
    'restaurante-e2e-intenso',
    [...restauranteEsCases, ...restauranteEnCases],
    'Reporte de Batería de 60 Pruebas de Disponibilidad (Restaurante E2E Intenso - ES + EN)',
    'REPORTE_DISPONIBILIDAD_RESTAURANTE_ES_EN.md'
  );

  console.log('\n🎉 ¡TODAS LAS BATERÍAS COMPLETADAS CON ÉXITO!');
}

main();
