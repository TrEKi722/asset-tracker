async function handler(request, env) {
  return new Response(JSON.stringify({ ok: true, test: 'hello', now: new Date().toISOString() }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}

export default handler;
export async function onRequest(ctx) { return handler(ctx.request, ctx.env); }
