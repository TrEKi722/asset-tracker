async function handler(request, env) {
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  const url = new URL(request.url);
  const path = url.pathname || '';

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Diagnostic endpoint: /api/openrouter/diag
  if (path.endsWith('/diag')) {
    const hasKey = !!env.OPENROUTER_API_KEY;
    const info = {
      ok: true,
      service: 'openrouter-proxy',
      hasKey,
      receivedMethod: request.method,
      now: new Date().toISOString()
    };
    return new Response(JSON.stringify(info), { status: 200, headers: CORS_HEADERS });
  }

  // Health-check
  if (request.method === 'GET') {
    return new Response(JSON.stringify({ ok: true, service: 'openrouter-proxy' }), { status: 200, headers: CORS_HEADERS });
  }

  if (request.method !== 'POST') {
    const headers = { ...CORS_HEADERS, 'Allow': 'GET, POST, OPTIONS' };
    return new Response(JSON.stringify({ error: 'Method Not Allowed', receivedMethod: request.method }), { status: 405, headers });
  }

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OpenRouter API key not configured' }), { status: 500, headers: CORS_HEADERS });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: CORS_HEADERS });
  }

  // Ensure we forward a safe payload to OpenRouter
  const payload = {
    model: body.model || 'openrouter/free',
    messages: body.messages || [{ role: 'user', content: body.prompt || '' }],
    // include any other optional fields if provided (e.g., temperature)
    ...('temperature' in body ? { temperature: body.temperature } : {})
  };

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    // Pass through status and response body
    return new Response(text, { status: res.status, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Request to OpenRouter failed', details: err.message }), { status: 502, headers: CORS_HEADERS });
  }
}

export default handler;

// Also export `onRequest` for any runtime that expects it
export async function onRequest(context) {
  const { request, env } = context;
  return handler(request, env);
}
