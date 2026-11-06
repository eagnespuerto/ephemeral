// JPL Scout lookup.
// Scout's API sends no CORS headers, so a browser on another origin usually cannot read it.
// Order tried: (1) your Ephemeral proxy, if set; (2) direct call; (3) the hourly snapshot that the
// GitHub Action publishes with this site under data/scout/.
const API = 'https://ssd-api.jpl.nasa.gov/scout.api';

export const safeName = n => n.replace(/[^A-Za-z0-9_-]/g, '_');
export const scoutPage = n => `https://cneos.jpl.nasa.gov/scout/#/object/${encodeURIComponent(n)}`;

// Accepts "https://x.workers.dev", "https://x.workers.dev/", or the older "...?url={url}" form.
export function proxyBase(raw) {
  if (!raw) return '';
  try {
    const u = new URL(raw.trim());
    return (u.origin + u.pathname).replace(/\/+$/, '');
  } catch { return ''; }
}

export async function getJSON(url, ms = 8000, init = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { cache: 'no-store', ...init, signal: ctl.signal });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { const j = await r.json(); msg = j.error || j.message || msg; } catch { /* not JSON */ }
      throw Object.assign(new Error(msg), { status: r.status });
    }
    return await r.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('timed out');
    throw e;
  } finally { clearTimeout(t); }
}

let indexCache = null;
export async function snapshotIndex() {
  if (!indexCache) indexCache = getJSON('data/scout/index.json').catch(e => { indexCache = null; throw e; });
  return indexCache;
}

export async function lookup(name, proxy) {
  name = name.trim();
  const query = `?tdes=${encodeURIComponent(name)}&orbits=1&n-orbits=60`;
  const tries = [];
  const base = proxyBase(proxy);
  if (base) tries.push(['your proxy', base + '/scout' + query]);
  tries.push(['JPL Scout (live)', API + query]);
  const errors = [];
  for (const [source, u] of tries) {
    try {
      const reply = await getJSON(u, 7000);
      if (reply && reply.orbits) return { status: 'ok', reply, source, fetched: new Date().toISOString() };
      if (reply && (reply.error || reply.message || reply.signature)) {
        return { status: 'missing', source, note: 'Not on Scout\'s current list. Scout only covers unconfirmed objects on the MPC NEO Confirmation Page.' };
      }
    } catch (e) { errors.push(`${source}: ${e.message || 'blocked'}`); }
  }
  // snapshot fallback
  try {
    const idx = await snapshotIndex();
    const listed = idx.objects.some(o => o.objectName === name);
    if (!listed) {
      return { status: 'missing', source: 'snapshot', fetched: idx.fetched, note: `Not on Scout's list as of ${idx.fetched.replace('T', ' ').replace('Z', ' UTC')}. Scout only covers unconfirmed objects on the MPC NEO Confirmation Page.` };
    }
    const reply = await getJSON(`data/scout/${safeName(name)}.json`);
    return { status: 'ok', reply, source: 'hourly snapshot', fetched: idx.fetched };
  } catch (e) {
    errors.push(`snapshot: ${e.message}`);
  }
  return { status: 'error', note: 'Could not reach Scout. ' + errors.join('; ') };
}
