#!/usr/bin/env node
/* MIGRACIÓN 1 (ETAPA 1) — batería de mensajes para verificar la
 * interpretación de intención EN VIVO, llamando a DeepSeek DIRECTAMENTE
 * (sin pasar por /api/client-chat).
 *
 * Por qué directo y no por HTTP: /api/client-chat tiene un rate limit de
 * 30 req/hora por IP en memoria (checkRateLimit). Esta batería sola ya usa
 * más de esa cuota, y la corrección de inestabilidad de intent pide
 * MÍNIMO 5 corridas independientes — con HTTP eso exigiría redeploys
 * artificiales solo para resetear el limiter, algo que el usuario pidió
 * evitar explícitamente ("no necesito redeploys absurdos... investiga
 * primero si el script puede invocar directamente la capa del intérprete").
 * Llamando a la API de DeepSeek directamente (con las MISMAS piezas que usa
 * producción: buildSystemPrompt/__test de api/client-chat.js,
 * buildInterpreterInstructions/deepseekResponseFormat de
 * lib/message-interpreter.js, y las MISMAS constantes INTERPRETER_MAX_TOKENS
 * / INTERPRETER_TEMPERATURE, también reexpuestas vía __test) se prueba el
 * comportamiento real del intérprete sin tocar nuestro servidor, Redis,
 * reservas o el rate limiter — solo se consume la cuota de la API de
 * DeepSeek, exactamente como ya hace cada mensaje real en producción.
 *
 * Credenciales: se leen de .env.prod (DEEPSEEK_API_KEY/BASE_URL/MODEL) — es
 * la única copia funcional disponible en este checkout (.env.preview no
 * trae credenciales de proveedor). Los VALORES nunca se imprimen ni se
 * registran en ningún log de este script. No se toca Redis en ningún
 * momento: el "cliente" de negocio usado para construir el system prompt es
 * un fixture local sanitizado (abajo), no un cliente real leído de la base.
 *
 * Uso:
 *   node scripts/interpreter-battery.mjs [runs]
 *   (runs por defecto: 1; para la validación de estabilidad se pidieron 5)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Cargar credenciales de .env.prod sin imprimir valores ──────────────────
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
loadEnvFile(join(root, '.env.prod'));

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('Falta DEEPSEEK_API_KEY (se esperaba en .env.prod). No se imprime ningún valor de credencial.');
  process.exit(1);
}

const { buildInterpreterInstructions, deepseekResponseFormat, sanitizeInterpretation, emptyInterpretation } =
  await import('../lib/message-interpreter.js');
const { __test } = await import('../api/client-chat.js');
const { buildSystemPrompt, resolveDeepseekModel, INTERPRETER_MAX_TOKENS, INTERPRETER_TEMPERATURE } = __test;

// ── Fixture local de negocio (NO viene de Redis) ────────────────────────────
// Datos inventados, plausibles, suficientes para ejercitar buildSystemPrompt()
// tal cual lo usa producción (mismo header, mismo bloque de datos, mismas
// reglas de catálogo/galería). Sin ownerEmail/panelToken/stripe/etc. — esos
// campos no entran nunca al prompt (ver businessInfoBlock).
const FIXTURE_CLIENT = {
  templateId: 'spa',
  businessName: 'Spa Aurora (fixture de prueba)',
  address: 'Av. Reforma 123, Ciudad de México',
  timezone: 'America/Mexico_City',
  language: 'es',
  languages: ['es'],
  prompt: 'Eres el asistente virtual de Spa Aurora. Ayudas con información de servicios, precios, horarios y reservas.',
  businessHours: {
    lunes:     { enabled: true, ranges: [{ start: '09:00', end: '18:00' }] },
    martes:    { enabled: true, ranges: [{ start: '09:00', end: '18:00' }] },
    miercoles: { enabled: true, ranges: [{ start: '09:00', end: '18:00' }] },
    jueves:    { enabled: true, ranges: [{ start: '09:00', end: '18:00' }] },
    viernes:   { enabled: true, ranges: [{ start: '09:00', end: '20:00' }] },
    sabado:    { enabled: true, ranges: [{ start: '10:00', end: '15:00' }] },
    domingo:   { enabled: false, ranges: [] },
  },
  minNoticeHours: 2,
  capacityPerSlot: 1,
  menu: [
    { nombre: 'Masaje relajante', precio: 700, duracion: 60 },
    { nombre: 'Manicura', precio: 250, duracion: 45 },
    { nombre: 'Pedicura', precio: 300, duracion: 45 },
    { nombre: 'Facial hidratante', precio: 550, duracion: 50 },
  ],
  features: { reservations: true, cancellation: true },
  active: true,
};
const FIXTURE_MEDIA = { gallery: 3, menuItems: ['Masaje relajante', 'Manicura'] };

const systemPromptCache = {};
async function systemPromptFor(lang) {
  if (!systemPromptCache[lang]) {
    systemPromptCache[lang] = await buildSystemPrompt(FIXTURE_CLIENT.prompt, FIXTURE_CLIENT, FIXTURE_MEDIA, lang);
  }
  return systemPromptCache[lang];
}

// ── Llamada directa a DeepSeek (mismo shape que callDeepSeek() en producción,
// incluyendo INTERPRETER_MAX_TOKENS/INTERPRETER_TEMPERATURE reales) ────────
async function classify(history, msg, lang) {
  const systemPrompt = await systemPromptFor(lang);
  const interpreterPrompt = systemPrompt + buildInterpreterInstructions(lang);
  const model = resolveDeepseekModel(process.env.DEEPSEEK_MODEL);
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
  const messages = [...history, { role: 'user', content: msg }];

  const body = {
    model,
    messages: [{ role: 'system', content: interpreterPrompt }, ...messages],
    max_tokens: INTERPRETER_MAX_TOKENS,
    temperature: INTERPRETER_TEMPERATURE,
    response_format: deepseekResponseFormat(),
    // Debe coincidir exactamente con callDeepSeek() en api/client-chat.js:
    // deepseek-v4-flash gasta tokens de razonamiento del mismo max_tokens
    // antes de responder. 'none' es la opción más predecible medida (ver
    // comentario junto a esa línea en producción) — 'minimal'/'low' son
    // MÁS inestables, no un punto medio.
    reasoning_effort: 'none',
  };

  const res = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`DeepSeek ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '';
  const finishReason = data.choices?.[0]?.finish_reason || '';
  let interpretation, textLen = 0, truncated = false;
  try {
    const parsed = JSON.parse(raw);
    interpretation = sanitizeInterpretation(parsed);
    if (!interpretation) throw new Error('esquema inválido');
    textLen = typeof parsed.text === 'string' ? parsed.text.length : 0;
  } catch (err) {
    interpretation = emptyInterpretation();
    truncated = true; // JSON no parseable/validable — señal de truncamiento o formato inesperado
  }
  if (finishReason === 'length') truncated = true;
  const completionTokens = data.usage?.completion_tokens || 0;
  return { intent: interpretation.intent, textLen, truncated, finishReason, completionTokens };
}

// ── Casos: A) standalone (sin historial) ────────────────────────────────────
const STANDALONE = [
  // ES — intents claros, sin dependencia de contexto
  { msg: 'quiero reservar', expect: 'booking' },
  { msg: 'vendré mañana a las 5 pm', expect: 'booking', critico: true },
  { msg: '¿puedo pasar mañana?', expect: 'booking' },
  { msg: 'mañana después del trabajo', expect: 'booking' },
  { msg: 'quiero uñas el viernes', expect: 'booking' },
  { msg: 'cancela eso', expect: 'cancellation', critico: true },
  { msg: 'quiero cambiar mi cita', expect: 'reschedule' },
  { msg: '¿cuánto cuesta el masaje?', expect: 'general_question', critico: true },
  { msg: '¿qué horario tienen mañana?', expect: 'general_question', critico: true },
  { msg: '¿tienen estacionamiento?', expect: 'general_question' },
  { msg: 'muéstrame las fotos', expect: 'show_gallery', critico: true },
  { msg: '¿qué servicios tienen y cuánto cuesta cada uno?', expect: 'show_menu', largo: true },
  { msg: '¿cuál es su horario completo de toda la semana?', expect: 'general_question', largo: true },
  { msg: 'quiero ver el menú', expect: 'show_menu', largo: true },
  // ES — frontera: dependen de contexto para ser "booking" (ver CONTEXTUAL);
  // AISLADOS (sin historial) NO deben caer en booking — es la prueba
  // explícita de "0 falsos positivos" pedida por el usuario.
  { msg: 'el viernes a eso de las 4', expect: 'unknown', critico: true, frontera: true },
  { msg: 'no, manicura', expect: 'unknown', critico: true, frontera: true },
  // EN
  { msg: 'I want to book', expect: 'booking' },
  { msg: "I'll come tomorrow at 5 pm", expect: 'booking' },
  { msg: 'can I come tomorrow?', expect: 'booking' },
  { msg: 'tomorrow after work', expect: 'booking' },
  { msg: 'cancel that', expect: 'cancellation' },
  { msg: 'I want to change my appointment', expect: 'reschedule' },
  { msg: 'how much is the massage?', expect: 'general_question' },
  { msg: 'what time do you close tomorrow?', expect: 'general_question' },
  { msg: 'show me the photos', expect: 'show_gallery' },
  { msg: 'what are all your services and prices?', expect: 'show_menu', largo: true },
  // EN — frontera, mismo criterio que arriba
  { msg: '1pm please', expect: 'unknown', critico: true, frontera: true },
  { msg: 'actually make it saturday', expect: 'unknown', critico: true, frontera: true },
];

// ── Casos: B) contextuales (con historial de una reserva en curso) ─────────
// Los 4 mensajes exactos que el usuario identificó como dependientes de
// contexto, ahora CON el historial que los hace inequívocos.
const CONTEXTUAL = [
  {
    label: 'ES: viernes a las 4 completando una reserva ya iniciada',
    history: [
      { role: 'user', content: 'quiero reservar un masaje' },
      { role: 'assistant', content: '¡Claro! ¿Qué día te gustaría venir?' },
    ],
    msg: 'el viernes a eso de las 4',
    lang: 'es',
    expect: 'booking',
    critico: true,
  },
  {
    label: 'ES: "no, manicura" corrigiendo el servicio dentro de una reserva activa',
    history: [
      { role: 'user', content: 'quiero reservar un masaje el viernes a las 4' },
      { role: 'assistant', content: 'Perfecto, ¿me confirmas tu nombre para la reserva del masaje el viernes a las 4?' },
      { role: 'user', content: 'espera, mejor no quiero masaje' },
      { role: 'assistant', content: 'Sin problema, ¿qué servicio prefieres entonces?' },
    ],
    msg: 'no, manicura',
    lang: 'es',
    expect: 'booking',
    critico: true,
  },
  {
    label: 'EN: "1pm please" completing an in-progress booking',
    history: [
      { role: 'user', content: 'I want to book a massage' },
      { role: 'assistant', content: 'Great! What day works for you?' },
      { role: 'user', content: 'tomorrow' },
      { role: 'assistant', content: 'Got it, tomorrow. What time would you like?' },
    ],
    msg: '1pm please',
    lang: 'en',
    expect: 'booking',
    critico: true,
  },
  {
    label: 'EN: "actually make it saturday" correcting the date of an active booking',
    history: [
      { role: 'user', content: 'I want to book a haircut for tomorrow at 5pm' },
      { role: 'assistant', content: 'Sure, tomorrow at 5pm for a haircut. Could you confirm your name?' },
    ],
    msg: 'actually make it saturday',
    lang: 'en',
    expect: 'booking',
    critico: true,
  },
];

function isEsMsg(msg) { return /[ñáéíóú¿]/i.test(msg); }

async function runOnce(runIndex) {
  const results = [];
  let pass = 0, fail = 0, truncCount = 0, maxLen = 0, maxLenMsg = '', maxTokens = 0, maxTokensMsg = '';

  for (const c of STANDALONE) {
    const lang = isEsMsg(c.msg) ? 'es' : 'en';
    try {
      const r = await classify([], c.msg, lang);
      const ok = r.intent === c.expect;
      ok ? pass++ : fail++;
      if (r.truncated) truncCount++;
      if (r.textLen > maxLen) { maxLen = r.textLen; maxLenMsg = c.msg; }
      if (r.completionTokens > maxTokens) { maxTokens = r.completionTokens; maxTokensMsg = c.msg; }
      results.push({ group: 'standalone', msg: c.msg, expect: c.expect, got: r.intent, ok, critico: !!c.critico, truncated: r.truncated });
      console.log(`${ok ? '✓' : '✗'}${c.critico ? ' [CRÍTICO]' : ''}${c.frontera ? ' [FRONTERA]' : ''} "${c.msg}" -> esperado=${c.expect} obtenido=${r.intent} tokens=${r.completionTokens}${r.truncated ? ' TRUNCADO/INVÁLIDO' : ''}`);
    } catch (err) {
      fail++;
      results.push({ group: 'standalone', msg: c.msg, expect: c.expect, got: '(ERROR)', ok: false, critico: !!c.critico, error: err.message });
      console.log(`✗ ERROR "${c.msg}": ${err.message}`);
    }
  }

  for (const c of CONTEXTUAL) {
    try {
      const r = await classify(c.history, c.msg, c.lang);
      const ok = r.intent === c.expect;
      ok ? pass++ : fail++;
      if (r.truncated) truncCount++;
      if (r.textLen > maxLen) { maxLen = r.textLen; maxLenMsg = c.msg; }
      if (r.completionTokens > maxTokens) { maxTokens = r.completionTokens; maxTokensMsg = c.msg; }
      results.push({ group: 'contextual', msg: c.msg, expect: c.expect, got: r.intent, ok, critico: !!c.critico, truncated: r.truncated });
      console.log(`${ok ? '✓' : '✗'} [CRÍTICO][CONTEXTUAL] "${c.msg}" (${c.label}) -> esperado=${c.expect} obtenido=${r.intent} tokens=${r.completionTokens}${r.truncated ? ' TRUNCADO/INVÁLIDO' : ''}`);
    } catch (err) {
      fail++;
      results.push({ group: 'contextual', msg: c.msg, expect: c.expect, got: '(ERROR)', ok: false, critico: true, error: err.message });
      console.log(`✗ ERROR "${c.msg}": ${err.message}`);
    }
  }

  const total = STANDALONE.length + CONTEXTUAL.length;
  console.log(`\n[CORRIDA ${runIndex}] ${pass}/${total} casos coinciden. Truncamientos: ${truncCount}/${total}. Longitud máxima de "text": ${maxLen} caracteres ("${maxLenMsg}"). Tokens de salida (razonamiento+texto) más altos: ${maxTokens} ("${maxTokensMsg}").`);
  return { pass, fail, total, truncCount, maxLen, maxTokens, results };
}

async function main() {
  const runs = Math.max(1, parseInt(process.argv[2], 10) || 1);
  const allRuns = [];
  for (let i = 1; i <= runs; i++) {
    console.log(`\n=== CORRIDA ${i}/${runs} (llamada directa a DeepSeek, sin HTTP a /api/client-chat, sin rate limiter) ===`);
    allRuns.push(await runOnce(i));
  }

  if (runs > 1) {
    console.log('\n=== MATRIZ mensaje -> intent por corrida ===');
    const allCases = [...STANDALONE.map(c => ({ ...c, group: 'standalone' })), ...CONTEXTUAL.map(c => ({ ...c, group: 'contextual' }))];
    let anyUnstable = false;
    for (let i = 0; i < allCases.length; i++) {
      const c = allCases[i];
      const perRun = allRuns.map(r => r.results[i].got);
      const stable = perRun.every(v => v === perRun[0]);
      if (!stable) anyUnstable = true;
      console.log(`${stable ? ' ' : '⚠'} ${c.critico ? '[CRÍTICO] ' : ''}"${c.msg}" (${c.group}) esperado=${c.expect} -> [${perRun.join(', ')}]${stable ? '' : '  <-- INESTABLE'}`);
    }
    const totalTrunc = allRuns.reduce((s, r) => s + r.truncCount, 0);
    console.log(`\nTruncamientos totales en ${runs} corridas: ${totalTrunc}`);
    console.log(anyUnstable
      ? '\n❌ Hay mensajes con intent inestable entre corridas — ver "<-- INESTABLE" arriba. No maquillado: se reporta tal cual.'
      : '\n✅ Ningún mensaje cambió de intent entre corridas.');
  }

  const failedRuns = allRuns.filter(r => r.fail > 0);
  process.exit(failedRuns.length ? 1 : 0);
}

main();
