import { Resend } from 'resend';
import { Redis } from '@upstash/redis';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const redis = UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN 
  ? new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN }) 
  : null;

const SYSTEM_PROMPT = `Eres Alex — Demo Pro de JB Studio. Estás dentro de una demo interactiva de un asistente para negocios.

Tu objetivo es demostrar de forma natural que el asistente puede responder preguntas, tomar reservas, guardar datos en un panel del dueño, enviar una notificación de prueba por correo y permitir cancelar o reagendar.

No suenes como formulario. No preguntes datos que el usuario ya dio en el contexto actual. Extrae información de mensajes completos.

Si el usuario escribe:
'quiero reservar mañana a las 4 para corte de pelo, soy Carlos, mi correo es test@test.com'
debes extraer:
fecha = mañana
hora = 4:00 PM
servicio = corte de pelo
nombre = Carlos
correo = test@test.com

Si ya tienes todos los datos (date, time, customerName, service, customerContact), responde confirmando y marca shouldCreateReservation = true.

Siempre devuelve JSON válido con:
{
  "reply": "string",
  "intent": "answer_question | start_reservation | collect_reservation_data | create_reservation | cancel_reservation | reschedule_reservation | send_demo_email | show_owner_panel | unknown",
  "reservationDraft": {
    "date": "string",
    "time": "string",
    "customerName": "string",
    "service": "string",
    "customerContact": "string",
    "notes": "string"
  },
  "missingFields": ["date", "time", ...],
  "shouldCreateReservation": boolean
}

No agregues texto fuera del JSON.

Reglas:
1. Si falta solo un dato, preguntar solo ese dato en el reply.
2. Si no falta nada, shouldCreateReservation = true.
3. Si el usuario pregunta precios/horarios/servicios, responde como demo del negocio seleccionado.
4. No inventar que es una reserva real. Siempre aclarar que es demo/simulación cuando corresponda.
5. El correo demo es una notificación de prueba.
6. Explicar que en una versión real las reservas quedan en un panel/lista actualizada con Redis/Upstash.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://jbstudio.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { message, sessionId, business, reservationDraft, messages } = req.body;

    console.log('[DEMO_CHAT] message:', message);
    console.log('[DEMO_CHAT] draft:', JSON.stringify(reservationDraft));

    if (!ANTHROPIC_API_KEY) {
      return res.status(200).json({ 
        reply: 'La demo de IA no está disponible en este momento.',
        intent: 'unknown',
        reservationDraft: reservationDraft || {},
        missingFields: [],
        shouldCreateReservation: false
      });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages: [
          ...(messages || []).slice(-10),
          { role: 'user', content: message }
        ]
      }),
    });

    if (!response.ok) {
      console.error('[DEMO_CHAT] Anthropic error:', response.status);
      return res.status(502).json({ error: 'AI service error' });
    }

    const data = await response.json();
    let rawText = data.content?.[0]?.text || '';

    // Extract JSON from response
    let parsedResponse;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found');
      }
    } catch (e) {
      console.error('[DEMO_CHAT] JSON parse error:', e);
      parsedResponse = {
        reply: rawText,
        intent: 'unknown',
        reservationDraft: reservationDraft || {},
        missingFields: [],
        shouldCreateReservation: false
      };
    }

    console.log('[DEMO_CHAT] intent:', parsedResponse.intent);
    console.log('[DEMO_CHAT] extracted draft:', JSON.stringify(parsedResponse.reservationDraft));
    console.log('[DEMO_CHAT] missing fields:', parsedResponse.missingFields);
    console.log('[DEMO_CHAT] shouldCreateReservation:', parsedResponse.shouldCreateReservation);

    return res.status(200).json(parsedResponse);

  } catch (err) {
    console.error('[DEMO_CHAT] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
