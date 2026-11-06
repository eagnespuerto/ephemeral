// Ephemeral proxy: a small Cloudflare Worker that lets the Ephemeral page reach
// JPL Scout, JPL Horizons, JPL SBDB and the MPC Ephemeris Service, which do not
// allow browser calls from other sites (no CORS headers).
//
// Deploy:   cd worker && npx wrangler deploy
// Then paste the Worker URL (e.g. https://ephemeral-proxy.<you>.workers.dev)
// into Ephemeral's "Proxy" box.
//
// Routes
//   GET  /                health check, lists routes
//   GET  /scout?...       -> https://ssd-api.jpl.nasa.gov/scout.api?...
//   GET  /horizons?...    -> https://ssd.jpl.nasa.gov/api/horizons.api?...
//   GET  /sbdb?...        -> https://ssd-api.jpl.nasa.gov/sbdb.api?...
//   POST /mpc-eph         form body -> MPC Ephemeris Service; returns the <pre> table as text
//   GET  /?url=<scout url>  older form, Scout only
//
// Set ALLOWED_ORIGINS in wrangler.toml to limit which sites may use it.

const UPSTREAM = {
  '/scout': 'https://ssd-api.jpl.nasa.gov/scout.api',
  '/horizons': 'https://ssd.jpl.nasa.gov/api/horizons.api',
  '/sbdb': 'https://ssd-api.jpl.nasa.gov/sbdb.api',
};
const MPC_EPH = 'https://www.minorplanetcenter.net/cgi-bin/mpeph2.cgi';
const UA = { 'User-Agent': 'ephemeral-proxy/2.0 (+https://github.com/eagnespuerto/ephemeral)' };

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
  const ok = allowed.includes('*') || allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? (allowed.includes('*') ? '*' : origin) : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

async function relay(target, cors, ttl) {
  const up = await fetch(target, { headers: UA, cf: { cacheTtl: ttl, cacheEverything: true } });
  return new Response(up.body, {
    status: up.status,
    headers: { ...cors, 'Content-Type': up.headers.get('Content-Type') || 'application/json', 'Cache-Control': `public, max-age=${ttl}` },
  });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (path === '/' && url.searchParams.has('url')) {
        const target = url.searchParams.get('url');
        if (!target.startsWith(UPSTREAM['/scout'])) return json({ error: 'Only Scout URLs are allowed here.' }, 400, cors);
        return relay(target, cors, 300);
      }
      if (path === '/') return json({ ok: true, service: 'ephemeral-proxy', routes: ['/scout', '/horizons', '/sbdb', '/mpc-eph'] }, 200, cors);

      if (UPSTREAM[path] && request.method === 'GET') {
        return relay(UPSTREAM[path] + url.search, cors, path === '/scout' ? 300 : 900);
      }

      if (path === '/mpc-eph' && request.method === 'POST') {
        const body = await request.text();
        if (body.length > 4000) return json({ error: 'Request too large.' }, 413, cors);
        const up = await fetch(MPC_EPH, { method: 'POST', body, headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' } });
        const html = await up.text();
        const pre = html.match(/<pre>([\s\S]*?)<\/pre>/i);
        let text;
        if (pre) text = pre[1].replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        else {
          const msg = html.replace(/<[^>]*>/g, ' ').match(/No object found[^.]*\./);
          return json({ error: msg ? msg[0] : 'MPC returned no ephemeris.' }, 404, cors);
        }
        return new Response(text, { status: 200, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
      }

      return json({ error: 'Unknown route.' }, 404, cors);
    } catch (e) {
      return json({ error: 'Upstream error: ' + (e && e.message) }, 502, cors);
    }
  },
};
