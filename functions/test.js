export default async function (request, env) {
  return new Response(JSON.stringify({ ok: true, test: 'hello', now: new Date().toISOString() }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}
