// JPL Scout lookup.
// Scout's API sends no CORS headers, so a browser on another origin usually cannot read it.
// Order tried: (1) your own proxy, if set; (2) direct call; (3) the hourly snapshot that the
// GitHub Action publishes with this site under data/scout/.
const API = 'https://ssd-api.jpl.nasa.gov/scout.api';

export const safeName = n => n.replace(/[^A-Za-z0-9_-]/g, '_');
export const scoutPage = n => `https://cneos.jpl.nasa.gov/scout/#/object/${encodeURIComponent(n)}`;

async function getJSON(url, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    return await r.json();
  } finally { clearTimeout(t); }
}

let indexCache = null;
export async function snapshotIndex() {
  if (!indexCache) indexCache = getJSON('data/scout/index.json').catch(e => { indexCache = null; throw e; });
  return indexCache;
}

export async function lookup(name, proxy) {
  name = name.trim();
  const url = `${API}?tdes=${encodeURIComponent(name)}&orbits=1&n-orbits=60`;
  const tries = [];
  if (proxy) tries.push(['your proxy', proxy.includes('{url}') ? proxy.replace('{url}', encodeURIComponent(url)) : proxy + encodeURIComponent(url)]);
  tries.push(['JPL Scout (live)', url]);
  const errors = [];
  for (const [source, u] of tries) {
    try {
      const reply = await getJSON(u, 7000);
      if (reply && reply.orbits) return { status: 'ok', reply, source, fetched: new Date().toISOString() };
      if (reply && (reply.error || reply.message || reply.signature)) {
        return { status: 'missing', source, note: reply.error || reply.message || 'Not on Scout\'s current list.' };
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
