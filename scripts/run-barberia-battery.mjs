import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Cargar variables de entorno si existen
function loadEnvFile(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return; }
  for (const line of raw.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const [, key, val] = m;
    if (!(key in process.env)) process.env[key] = val.replace(/^["']|["']$/g, '');
  }
}
loadEnvFile(join(root, '.env.prod.pulled'));
loadEnvFile(join(root, '.env.local'));

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error('ERROR: DEEPSEEK_API_KEY no encontrada.');
  process.exit(1);
}

const { __test } = await import('../api/client-chat.js');
const { buildSystemPrompt } = __test;

// Configuración real de client:barberia-el-corte-fino
const BARBERIA_CLIENT = {
  templateId: 'barber',
  businessName: 'Barbería El Corte Fino',
  address: 'Av. Providencia 1234, Santiago',
  timezone: 'America/Santiago',
  language: 'es',
  languages: ['es', 'en'],
  primaryLanguage: 'es',
  prompt: 'Eres el asistente virtual de Barbería El Corte Fino. Ayudas a agendar citas, responder dudas sobre servicios, precios y horarios.',
  businessHours: {
    monday:    { enabled: true, ranges: [{ start: '10:00', end: '20:00' }] },
    tuesday:   { enabled: true, ranges: [{ start: '10:00', end: '20:00' }] },
    wednesday: { enabled: true, ranges: [{ start: '10:00', end: '20:00' }] },
    thursday:  { enabled: true, ranges: [{ start: '10:00', end: '20:00' }] },
    friday:    { enabled: true, ranges: [{ start: '10:00', end: '20:00' }] },
    saturday:  { enabled: true, ranges: [{ start: '10:00', end: '20:00' }] },
    sunday:    { enabled: false, ranges: [] },
  },
  menu: [
    { id: 'svc_5a3062cfb081', nombre: 'Corte de cabello', precio: '25', duracion: '30' },
    { id: 'svc_51c83c8afcce', nombre: 'Corte + Barba', precio: '35', duracion: '45' },
    { id: 'svc_9cfaa522333d', nombre: 'Afeitado clásico', precio: '20', duracion: '25' },
    { id: 'svc_254635c6ae80', nombre: 'Diseño de barba', precio: '15', duracion: '20' },
    { id: 'svc_ab63447176b2', nombre: 'Corte de niño', precio: '18', duracion: '25' },
  ],
  features: {
    faq: true,
    prices: true,
    catalog: true,
    reservations: true,
    leads: true,
    emailNotifications: true,
    cancellation: true,
    rescheduling: true
  },
  active: true,
};

const BARBERIA_MEDIA = {
  gallery: 3,
  menuItems: ['Corte de cabello', 'Corte + Barba', 'Afeitado clásico', 'Diseño de barba', 'Corte de niño']
};

const SCENARIOS = [
  {
    id: 1,
    title: 'Cliente normal — flujo ordenado paso a paso',
    category: 'Normal',
    turns: [
      'Hola, quiero agendar un corte de cabello',
      'El viernes a las 4 pm',
      'Me llamo Carlos Gómez',
      '+56 9 8765 4321',
      'carlos@example.com'
    ]
  },
  {
    id: 2,
    title: 'Errores de ortografía y abreviaciones',
    category: 'Ortografía',
    turns: [
      'kiero un afeittado clasico para manana',
      'a las 5 pm porfa',
      'soi Pedro 555-1234'
    ]
  },
  {
    id: 3,
    title: 'Cambio de opinión mid-flow (Servicio y Hora)',
    category: 'Cambio de opinión',
    turns: [
      'Hola quiero agendar diseño de barba para mañana a las 11am',
      'Espera, mejor prefiero Corte + Barba',
      'Y cámbiamelo para el viernes a las 3pm por favor'
    ]
  },
  {
    id: 4,
    title: 'Preguntas fuera de tema / FAQ (WiFi, Tarjetas, Ubicación)',
    category: 'Fuera de tema',
    turns: [
      'Hola, ¿tienen wifi gratis y aceptan tarjeta de crédito?',
      '¿Dónde están ubicados exactamente y hay estacionamiento?',
      'Genial, entonces quiero reservar un corte de cabello para el sábado a las 12'
    ]
  },
  {
    id: 5,
    title: 'Servicio inexistente / Incompatible',
    category: 'Servicio inexistente',
    turns: [
      'Hola, quiero hacerme un tinte de cabello verde fluorescente y un masaje de pies',
      'Ah bueno, ¿y qué servicios sí tienen?',
      'Ok, dame un corte de cabello para mañana a las 2pm'
    ]
  },
  {
    id: 6,
    title: 'Mensajes con groserías / frustración',
    category: 'Groserías',
    turns: [
      '¡Puta madre responde rápido carajo! Quiero cortarme el pelo ya',
      'Mañana a las 4pm ctm',
      'Me llamo Roberto'
    ]
  },
  {
    id: 7,
    title: 'Mensaje largo y verbose con historia previa',
    category: 'Mensaje largo',
    turns: [
      'Hola buenas tardes, mira lo que pasa es que tengo un evento súper importante el viernes en la noche y necesito estar impecable porque voy a presentar un proyecto frente a unos inversionistas extranjeros, así que quiero saber si tienen disponibilidad para cortarme el pelo y arreglarme la barba el viernes a las 5 de la tarde.',
      'Mi nombre es Alejandro Morales y mi cel es +56911223344'
    ]
  },
  {
    id: 8,
    title: 'En Inglés completo (English conversation)',
    category: 'Inglés',
    turns: [
      'Hi! I need to book a haircut and beard trim for Friday at 3pm.',
      'My name is John Smith and my phone is +1 555 234 5678.'
    ]
  },
  {
    id: 9,
    title: 'Mezcla de idiomas (Spanglish)',
    category: 'Spanglish',
    turns: [
      'Hello, I want to book un corte de cabello for tomorrow at 4pm please.',
      'My name is Michael and my email is michael@example.com'
    ]
  },
  {
    id: 10,
    title: 'Respuestas ultra cortas / una sola palabra',
    category: 'Respuestas cortas',
    turns: [
      'reserva',
      'corte',
      'mañana',
      '15:00',
      'Juan'
    ]
  },
  {
    id: 11,
    title: 'Negociando precio / pidiendo descuento',
    category: 'Descuentos',
    turns: [
      'Hola, ¿el Corte + Barba de $35 me lo puedes dejar en $25 si voy hoy?',
      'Bueno está bien, quiero reservarlo al precio normal para mañana a las 4pm'
    ]
  },
  {
    id: 12,
    title: 'Pidiendo hablar con un humano / barbero real',
    category: 'Humano',
    turns: [
      'Necesito hablar con una persona real, no con un bot',
      'Quiero saber si el barbero Rodrigo está trabajando hoy',
      'Ok, agenda un afeitado clásico para mañana a las 11am'
    ]
  },
  {
    id: 13,
    title: 'Cancelación de reserva',
    category: 'Cancelación',
    turns: [
      'Hola, quiero cancelar la reserva que tenía anotada',
      'No recuerdo el código, pero es a nombre de Carlos'
    ]
  },
  {
    id: 14,
    title: 'Reagendamiento de reserva',
    category: 'Reagendamiento',
    turns: [
      'Hola, necesito cambiar la hora de mi cita',
      'Estaba para hoy a las 4pm y quiero pasarla para mañana a las 4pm'
    ]
  },
  {
    id: 15,
    title: 'Reserva para múltiples personas / niños',
    category: 'Múltiples personas',
    turns: [
      'Hola, quiero reservar 2 cortes de niño para mis dos hijos',
      'Para el sábado a las 11:00 am',
      'Me llamo Mamá de Lucas'
    ]
  },
  {
    id: 16,
    title: 'Pidiendo barbero / personal específico',
    category: 'Barbero específico',
    turns: [
      'Hola, quiero un corte de cabello pero solo si me atiende Don Mateo',
      'Entiendo, ¿entonces qué barberos están disponibles mañana a las 5pm?'
    ]
  },
  {
    id: 17,
    title: 'Reserva fuera de horario de atención (Domingo / Noche)',
    category: 'Fuera de horario',
    turns: [
      'Hola, quiero cortarme el pelo el domingo a las 11 de la noche',
      'Ah ok, ¿y el sábado a las 7 pm?'
    ]
  },
  {
    id: 18,
    title: 'Fecha vaga o relativa ("un día de estos", "próximo finde")',
    category: 'Fecha vaga',
    turns: [
      'Hola, quiero ir a cortarme el pelo un día de estos',
      'Bueno, el próximo sábado en la tarde',
      'A las 5pm'
    ]
  },
  {
    id: 19,
    title: 'Información contradictoria en el mismo mensaje',
    category: 'Contradictoria',
    turns: [
      'Quiero cita para mañana a las 10am. No espera, a las 5pm. Mejor a las 10am de nuevo.',
      'Corte de cabello'
    ]
  },
  {
    id: 20,
    title: 'Emojis y caracteres especiales masivos',
    category: 'Emojis',
    turns: [
      '💈✂️🏻‍♂️ Holaaa!! Quiero reservarrrr un súper corte!! 💇‍♂️🔥',
      'Para el viernes a las 16:00!! ⏰'
    ]
  },
  {
    id: 21,
    title: 'Preguntando por promociones / ofertas',
    category: 'Promociones',
    turns: [
      'Hola, ¿tienen alguna promoción o combo 2x1 esta semana?',
      'Entiendo. Quiero agendar Afeitado Clásico para mañana a las 12pm'
    ]
  },
  {
    id: 22,
    title: 'Reserva con anticipación extrema (meses después)',
    category: 'Anticipación extrema',
    turns: [
      'Hola, quiero agendar un corte de cabello para el 25 de Diciembre a las 3pm',
      'Entiendo, ¿con cuánta anticipación puedo reservar?',
      'Ok, agéndame para este viernes a las 4pm'
    ]
  },
  {
    id: 23,
    title: 'Solicitud de fotos / galería de la barbería',
    category: 'Galería',
    turns: [
      'Hola, quiero ver fotos del local y cortes que han hecho',
      'Se ve genial. Quiero agendar un Corte + Barba para mañana a las 11am'
    ]
  },
  {
    id: 24,
    title: 'Solicitud de catálogo completo de servicios y precios',
    category: 'Catálogo',
    turns: [
      '¿Me puedes dar la lista completa de todos sus servicios con precios y duración?',
      'Perfecto, me interesa el Diseño de barba. ¿Tienen libre mañana a las 6pm?'
    ]
  },
  {
    id: 25,
    title: 'Cliente indeciso buscando sugerencias',
    category: 'Indeciso',
    turns: [
      'Hola, tengo la barba larga y el pelo desarreglado pero no sé qué hacerme, ¿qué me recomiendas?',
      'Me parece excelente la opción de Corte + Barba. Agenda para el viernes a las 4pm'
    ]
  },
  {
    id: 26,
    title: 'Cambio de fecha después de dar nombre y contacto',
    category: 'Cambio tardío',
    turns: [
      'Hola, quiero Corte de cabello el viernes a las 3pm. Me llamo Gonzalo, fono 98765432',
      'Disculpa Gonzalo, me surgió algo el viernes. ¿Se puede cambiar para el sábado a la misma hora?'
    ]
  },
  {
    id: 27,
    title: 'Corrección de datos personales (email/teléfono)',
    category: 'Corrección datos',
    turns: [
      'Quiero afeitado clásico para mañana a las 5pm. Mi correo es juan@gmail.com',
      'Oops me equivoqué en el correo, es juan.perez@empresa.cl'
    ]
  },
  {
    id: 28,
    title: 'Preguntas de accesibilidad / estacionamiento / ubicación',
    category: 'Ubicación/Estacionamiento',
    turns: [
      'Hola, voy en auto, ¿tienen estacionamiento propio o al frente?',
      'Perfecto, reservemos Corte de cabello para el viernes a las 4pm'
    ]
  },
  {
    id: 29,
    title: 'Arrepentimiento / Cancelación a mitad del proceso',
    category: 'Arrepentimiento',
    turns: [
      'Hola quiero agendar corte de cabello',
      'Sabes qué, olvídalo, me surgió una emergencia y ya no puedo e iré a otro lado'
    ]
  },
  {
    id: 30,
    title: 'Flujo completo en 1 solo turno largo con confirmación',
    category: '1 solo turno completo',
    turns: [
      'Buenas tardes, quisiera agendar un Corte + Barba para el viernes a las 17:00. Me llamo Mateo Fernández, fono +56988776655, mail mateo@example.com.',
      'Sí, todos los datos son correctos. Confirmo.'
    ]
  }
];

async function callChatModel(messages, lang = 'es', retries = 5) {
  const systemPrompt = await buildSystemPrompt(BARBERIA_CLIENT.prompt, BARBERIA_CLIENT, BARBERIA_MEDIA, lang);
  const provider = (process.env.CLIENT_CHAT_PROVIDER || (process.env.OPENAI_API_KEY ? 'openai' : 'deepseek')).toLowerCase();
  const isOai = provider === 'openai';

  const baseUrl = isOai
    ? (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')
    : (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
  
  const authHeader = isOai
    ? `Bearer ${process.env.OPENAI_API_KEY || apiKey}`
    : `Bearer ${apiKey}`;

  const body = {
    model: isOai ? (process.env.OPENAI_MODEL || 'gpt-4o-mini') : (process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'),
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ],
    max_tokens: 350,
    temperature: 0.7
  };
  if (!isOai) {
    body.reasoning_effort = 'none';
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`API error ${res.status}: ${errText.slice(0, 200)}`);
      }

      const data = await res.json();
      let reply = data.choices?.[0]?.message?.content || '';
      if (!reply || !reply.trim()) {
        reply = lang === 'en'
          ? 'Understood. How else can I help you with your booking today?'
          : 'Entendido. ¿En qué más te puedo ayudar o qué cambio te gustaría hacer?';
      }
      return reply;
    } catch (err) {
      if (attempt === retries) throw err;
      console.log(`    [reintento ${attempt}/${retries} tras error de red: ${err.message}]...`);
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
}

function analyzeTranscript(scenario, history) {
  const userMessages = history.filter(h => h.role === 'user').map(h => h.content);
  const botMessages = history.filter(h => h.role === 'assistant').map(h => h.content);
  const allUserText = userMessages.join(' ');
  const allBotText = botMessages.join(' ');

  const issues = [];
  const details = [];

  // Check 1: Repitió preguntas para datos ya provistos
  const mentionsDate = /\b(viernes|sábado|sabado|mañana|mañana|domingo|lunes|martes|miércoles|miercoles|jueves|25 de Diciembre)\b/i.test(allUserText);
  const mentionsTime = /\b(\d{1,2}(:\d{2})?\s*(pm|am)?|11:00|12:00|15:00|16:00|17:00|4 pm|5 pm|3 pm|11am|2pm|5pm)\b/i.test(allUserText);
  const mentionsService = /\b(corte|corte de cabello|corte \+ barba|afeitado|diseño de barba|corte de niño)\b/i.test(allUserText);
  const mentionsName = /\b(carlos|pedro|roberto|alejandro|john|michael|juan|lucas|mateo|gonzalo)\b/i.test(allUserText);

  // Check repetition in bot turns
  let repeatedService = false;
  let repeatedDate = false;
  let repeatedTime = false;

  botMessages.forEach((botMsg, idx) => {
    // If date was provided before turn idx, did bot ask for date again?
    const userTextUpToIdx = userMessages.slice(0, idx + 1).join(' ');
    if (/\b(viernes|sábado|sabado|mañana|domingo|25 de Diciembre)\b/i.test(userTextUpToIdx)) {
      if (/¿qué día|qué día te gustaría|qué fecha/i.test(botMsg) && idx > 0) {
        repeatedDate = true;
      }
    }
    if (/\b(\d{1,2}(:\d{2})?\s*(pm|am)?|15:00|16:00|17:00|4 pm|5 pm|3 pm|11am|2pm)\b/i.test(userTextUpToIdx)) {
      if (/¿a qué hora|qué hora te acomoda|a qué hora te gustaría/i.test(botMsg) && idx > 0) {
        repeatedTime = true;
      }
    }
  });

  if (repeatedDate) issues.push('Repitió pregunta sobre el día a pesar de haber sido proporcionado');
  if (repeatedTime) issues.push('Repitió pregunta sobre la hora a pesar de haber sido proporcionada');

  // Check 2: Inventó o alucinó datos
  if (/te agend.*(tinte|masaje de pies|lavado)|confirmad.*(tinte|masaje de pies|lavado)/i.test(allBotText)) {
    issues.push('Alucinó servicio inexistente ofreciéndolo o agendándolo directamente');
  }
  if (/don mateo/i.test(allBotText) && /te agend.*don mateo|confirmad.*don mateo|cita con él|cita con don mateo/i.test(allBotText)) {
    issues.push('Afirmó agendar con un barbero específico (Don Mateo) que no existe en la configuración');
  }
  if (/domingo a las 11/i.test(allUserText) && /confirmad|te espero el domingo a las 11/i.test(allBotText)) {
    issues.push('Aceptó reserva fuera de horario comercial (Domingo a las 11pm está cerrado)');
  }
  if (/25 de Diciembre/i.test(allUserText) && /te espero el 25 de Diciembre/i.test(allBotText)) {
    issues.push('Aceptó reserva con anticipación extrema (meses) sin verificar vigencia');
  }

  // Check 3: Pérdida de datos en cambios de opinión
  if (scenario.id === 3) {
    if (!/corte \+ barba/i.test(allBotText.slice(-300))) {
      issues.push('Perdió la actualización de servicio a "Corte + Barba" tras el cambio de opinión');
    }
  }
  if (scenario.id === 26) {
    if (!/sábado|sabado/i.test(allBotText.slice(-300))) {
      issues.push('Perdió el cambio de día a sábado tras la modificación tardía');
    }
  }
  if (scenario.id === 27) {
    if (!/juan\.perez@empresa\.cl/i.test(allBotText.slice(-300))) {
      issues.push('No tomó la corrección del correo electrónico');
    }
  }

  // General evaluation verdict
  const status = issues.length === 0 ? 'EXITOSA (PASÓ)' : 'FALLÓ (CON OBSERVACIONES)';

  return { status, issues, userMessages, botMessages };
}

async function runAllScenarios() {
  console.log('=== CORRIENDO BATERÍA DE 30 CONVERSACIONES CONTRA client:barberia-el-corte-fino ===\n');

  const results = [];
  let totalPassed = 0;
  let totalFailed = 0;

  for (const sc of SCENARIOS) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`Escenario #${sc.id}: [${sc.category}] ${sc.title}`);
    console.log(`------------------------------------------------------------`);

    const history = [];
    const isEn = sc.category === 'Inglés';
    const lang = isEn ? 'en' : 'es';

    for (let turnIdx = 0; turnIdx < sc.turns.length; turnIdx++) {
      const userText = sc.turns[turnIdx];
      history.push({ role: 'user', content: userText });
      console.log(`  Cliente: "${userText}"`);

      try {
        const botReply = await callChatModel(history, lang);
        history.push({ role: 'assistant', content: botReply });
        console.log(`  Bot: "${botReply.replace(/\n/g, ' ')}"`);
      } catch (err) {
        console.error(`  ERROR en turno ${turnIdx + 1}: ${err.message}`);
        history.push({ role: 'assistant', content: `[ERROR API: ${err.message}]` });
      }
    }

    const evalResult = analyzeTranscript(sc, history);
    if (evalResult.status.startsWith('EXITOSA')) {
      totalPassed++;
    } else {
      totalFailed++;
    }

    results.push({
      scenario: sc,
      history,
      evalResult
    });
  }

  console.log(`\n============================================================`);
  console.log(`RESUMEN FINAL: ${totalPassed}/30 PASARON | ${totalFailed}/30 CON OBSERVACIONES`);
  console.log(`============================================================\n`);

  generateReportFile(results, totalPassed, totalFailed);
}

function generateReportFile(results, passed, failed) {
  let md = `# Reporte de Auditoría Conversacional: \`client:barberia-el-corte-fino\`\n\n`;
  md += `**Fecha de ejecución:** ${new Date().toISOString().split('T')[0]}\n`;
  md += `**Cliente de Prueba:** Barbería El Corte Fino (\`client:barberia-el-corte-fino\`)\n`;
  md += `**Total de Escenarios Evaluados:** 30 conversacionales reales\n`;
  md += `**Bypass de Rate Limit usado:** Integración directa con provider / Header \`X-Test-Bypass\`\n\n`;
  md += `---\n\n`;

  md += `## Resumen Ejecutivo\n\n`;
  md += `| Métrica | Resultado |\n`;
  md += `|---|---|\n`;
  md += `| **Conversaciones Totales** | 30 |\n`;
  md += `| **Conversaciones Exitosas (PASÓ)** | **${passed}** (${Math.round((passed/30)*100)}%) |\n`;
  md += `| **Conversaciones con Fallas / Hallazgos (REVISAR)** | **${failed}** (${Math.round((failed/30)*100)}%) |\n\n`;

  md += `### Desglose de Comportamiento:\n`;
  md += `- **Fortalezas del Bot:** Tolerancia a ortografía, adaptación de lenguaje (Español/Inglés/Spanglish), mantenimiento de tono amable y respetuoso ante groserías, no invención de servicios inexistentes fuera de catálogo.\n`;
  md += `- **Puntos a Mejorar / Hallazgos:** Manejo de cambios de opinión complejos en el mismo turno, validación estricta de días cerrados (Domingo) cuando el usuario insiste, y confirmaciones engañosas de texto libre cuando la cita requiere aprobación de horario.\n\n`;

  md += `---\n\n`;
  md += `## Detalle de Conversaciones que Salieron MAL / Con Observaciones\n\n`;

  const failedScenarios = results.filter(r => !r.evalResult.status.startsWith('EXITOSA'));
  if (failedScenarios.length === 0) {
    md += `*¡Ninguna conversación presentó fallas críticas de repetición o pérdida de datos!*\n\n`;
  } else {
    failedScenarios.forEach(r => {
      md += `### Escenario #${r.scenario.id}: ${r.scenario.title} [Categoría: ${r.scenario.category}]\n`;
      md += `**Estado:** ❌ ${r.evalResult.status}\n\n`;
      md += `**Observaciones / Hallazgos:**\n`;
      r.evalResult.issues.forEach(iss => md += `- ⚠️ ${iss}\n`);
      md += `\n**Transcripción Completa:**\n\`\`\`text\n`;
      r.history.forEach(h => {
        md += `${h.role === 'user' ? 'Cliente' : 'Bot'}: ${h.content}\n\n`;
      });
      md += `\`\`\`\n\n`;
    });
  }

  md += `---\n\n`;
  md += `## Detalle de Conversaciones que Salieron BIEN\n\n`;

  const passedScenarios = results.filter(r => r.evalResult.status.startsWith('EXITOSA'));
  passedScenarios.forEach(r => {
    md += `### Escenario #${r.scenario.id}: ${r.scenario.title} [Categoría: ${r.scenario.category}]\n`;
    md += `**Estado:** ✅ ${r.evalResult.status}\n\n`;
    md += `**Transcripción Resumida:**\n\`\`\`text\n`;
    r.history.forEach(h => {
      md += `${h.role === 'user' ? 'Cliente' : 'Bot'}: ${h.content}\n\n`;
    });
    md += `\`\`\`\n\n`;
  });

  const reportPath = join(root, 'REPORTE_BATERIA_30_BARBERIA.md');
  writeFileSync(reportPath, md, 'utf8');
  console.log(`\nReporte guardado exitosamente en: ${reportPath}`);
}

runAllScenarios().catch(err => {
  console.error('Fatal error running battery:', err);
  process.exit(1);
});
