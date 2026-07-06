import { sendMikeTelegram } from './ventas-chat.js';

function clean(value) {
  return String(value || '').trim();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://jbstudio.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const timestamp = clean(body.timestamp) || new Date().toISOString();

    await sendMikeTelegram(
      '💬 Alguien empezó a chatear con Alex',
      'Timestamp: ' + timestamp,
      'No indicado'
    );

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[api/track-chat-start]', err?.message || err);
    return res.status(200).json({ ok: false });
  }
}
