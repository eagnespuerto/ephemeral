// Optional Cloudflare Worker: a tiny CORS proxy that only talks to JPL Scout.
// Deploy with `npx wrangler deploy worker/scout-proxy.js --name scout-proxy`
// then paste  https://scout-proxy.<you>.workers.dev/?url={url}  into Ephemeral's "Scout proxy" box.
const ALLOWED = 'https://ssd-api.jpl.nasa.gov/scout.api';

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const target = new URL(request.url).searchParams.get('url') || '';
    if (!target.startsWith(ALLOWED)) {
      return new Response(JSON.stringify({ error: 'Only the JPL Scout API is allowed.' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    const upstream = await fetch(target, { headers: { 'User-Agent': 'ephemeral-scout-proxy/1.0' }, cf: { cacheTtl: 300 } });
    return new Response(upstream.body, { status: upstream.status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
  },
};
