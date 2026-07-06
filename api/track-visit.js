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
    const utmSource = clean(body.utm_source) || 'directo';
    const utmCampaign = clean(body.utm_campaign) || 'directo';
    const utmMedium = clean(body.utm_medium) || 'directo';

    const message = [
      'Timestamp: ' + timestamp,
      'utm_source: ' + utmSource,
      'utm_campaign: ' + utmCampaign,
      'utm_medium: ' + utmMedium,
    ].join('\n');

    await sendMikeTelegram('👀 Nueva visita a /ventas', message, 'No indicado');
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[api/track-visit]', err?.message || err);
    return res.status(200).json({ ok: false });
  }
}
