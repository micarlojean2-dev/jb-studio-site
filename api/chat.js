module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, systemPrompt } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages must be a non-empty array' });
  }

  if (messages.length > 30) {
    return res.status(400).json({ error: 'Too many messages (max 30)' });
  }

  for (const msg of messages) {
    if (!msg || typeof msg.content !== 'string' || !['user', 'assistant'].includes(msg.role)) {
      return res.status(400).json({ error: 'Invalid message format' });
    }
    if (msg.content.length > 2000) {
      return res.status(400).json({ error: 'Message exceeds 2000 character limit' });
    }
  }

  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (totalChars > 8000) {
    return res.status(400).json({ error: 'Total content exceeds limit' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[api/chat] ANTHROPIC_API_KEY is not set');
    return res.status(500).json({ error: 'Service temporarily unavailable' });
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: typeof systemPrompt === 'string' ? systemPrompt.slice(0, 12000) : '',
        messages,
      }),
    });

    if (!upstream.ok) {
      console.error('[api/chat] Anthropic returned', upstream.status);
      return res.status(502).json({ error: 'Assistant temporarily unavailable' });
    }

    const data = await upstream.json();
    const text = data.content?.[0]?.text || '';
    return res.status(200).json({ text });

  } catch (err) {
    console.error('[api/chat] Fetch error:', err.message);
    return res.status(500).json({ error: 'Service error' });
  }
};
