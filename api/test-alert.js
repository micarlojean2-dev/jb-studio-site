import { initSentry, captureApiException, Sentry } from '../lib/sentry.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  initSentry();
  captureApiException(new Error('Prueba de alerta - ignorar'), {
    feature: 'sentry_alert_test',
    route: '/api/test-alert',
    extra: { test: true },
  });
  await Sentry.flush(2000);

  return res.status(202).json({ ok: true });
}
