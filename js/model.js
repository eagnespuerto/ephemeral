// Object model: turns a parsed ephemeris (and/or Scout orbit samples) into vectors.
import { parseEphemeris } from './parse.js';
import { radecToVec, add, sub, norm, siteVec, keplerGeo, scoutElements, helio, eqjToEcl, keplerPos, jdTT, eclToEqj } from './astro.js';

export const PALETTE = ['#ffb347', '#5ec8ff', '#ff6b9a', '#9be15d', '#c39bff', '#ffe66d', '#4fe0c0', '#ff8c5a'];
let nextId = 1;

export function makeObject(opts = {}) {
  const o = {
    id: nextId++,
    color: opts.color || PALETTE[(nextId - 2) % PALETTE.length],
    visible: true,
    text: opts.text || '',
    name: opts.name || '',
    nameEdited: !!opts.name,
    discCode: opts.discCode || '',
    discTime: opts.discTime || null,
    parsed: null,
    scout: null, // { status: 'loading'|'ok'|'missing'|'error', reply, source, note }
    els: [],
    _geo: null,
    _topo: new Map(),
  };
  reparse(o);
  return o;
}

export function reparse(o, obscodes) {
  o.parsed = parseEphemeris(o.text);
  if (o.parsed.name && !o.nameEdited) o.name = o.parsed.name;
  if (o.parsed.discoverySite && !o.discCode) o.discCode = o.parsed.discoverySite;
  if (o.parsed.discoveryTime && !o.discTime) o.discTime = o.parsed.discoveryTime;
  if (o.parsed.site && !o.discCode && obscodes) o.discCode = matchSite(o.parsed.site, obscodes) || '';
  invalidate(o);
}

export function invalidate(o) { o._geo = null; o._helio = null; o._topo = new Map(); o._paths = null; }

export function setScout(o, scout) {
  o.scout = scout;
  o.els = scout && scout.reply ? scoutElements(scout.reply) : [];
  invalidate(o);
}

function matchSite(site, obscodes) {
  let best = null, bestD = 0.02;
  for (const [code, [, lon, lat]] of Object.entries(obscodes)) {
    const l = lon > 180 ? lon - 360 : lon;
    const d = Math.abs(l - site.lon) + Math.abs(lat - site.lat);
    if (d < bestD) { bestD = d; best = code; }
  }
  return best;
}

export const hasRows = o => o.parsed && o.parsed.rows.length > 0;

// Time span covered by this object (ms), or null.
export function span(o) {
  if (hasRows(o)) { const r = o.parsed.rows; return [r[0].t, r[r.length - 1].t]; }
  if (o.els.length) { const now = Date.now(); return [now - 15 * 864e5, now + 15 * 864e5]; }
  return null;
}

// Geocentric EQJ track: [{ t, v, dist }] where dist=false means v is only a direction.
export function geoTrack(o) {
  if (o._geo) return o._geo;
  let track = [];
  if (hasRows(o)) {
    const site = o.parsed.site;
    track = o.parsed.rows.map(r => {
      if (r.delta) {
        let v = radecToVec(r.ra, r.dec, r.delta);
        if (site) v = add(v, siteVec(r.t, site)); // topocentric -> geocentric
        return { t: r.t, v, dist: true, mag: r.mag };
      }
      return { t: r.t, v: radecToVec(r.ra, r.dec), dist: false, mag: r.mag };
    });
  } else if (o.els.length) {
    const [a, b] = span(o);
    const step = 6 * 3600e3;
    for (let t = a; t <= b; t += step) track.push({ t, v: keplerGeo(o.els[0], t), dist: true, mag: null });
  }
  o._geo = track;
  return track;
}

// Track as seen from a site: unit-length or distance vectors in EQJ.
export function topoTrack(o, site, key) {
  if (!site) return geoTrack(o);
  if (o._topo.has(key)) return o._topo.get(key);
  const out = geoTrack(o).map(p => p.dist ? { ...p, v: sub(p.v, siteVec(p.t, site)) } : p);
  o._topo.set(key, out);
  return out;
}

// Interpolated vector at time ms (null when outside the track).
export function at(track, ms) {
  if (!track.length) return null;
  if (ms < track[0].t || ms > track[track.length - 1].t) return null;
  let lo = 0, hi = track.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (track[m].t <= ms) lo = m; else hi = m; }
  const a = track[lo], b = track[hi];
  if (a === b || b.t === a.t) return { ...a };
  const f = (ms - a.t) / (b.t - a.t);
  const v = [0, 1, 2].map(i => a.v[i] + (b.v[i] - a.v[i]) * f);
  return { t: ms, v, dist: a.dist && b.dist, mag: a.mag };
}

// Scout orbit-sample cloud at time ms, geocentric EQJ (optionally topocentric).
export function scoutCloud(o, ms, site) {
  if (!o.els.length) return [];
  const sv = site ? siteVec(ms, site) : null;
  return o.els.map(el => { const g = keplerGeo(el, ms); return sv ? sub(g, sv) : g; });
}

// Heliocentric ecliptic arc derived from the ephemeris (needs delta).
export function helioArc(o) {
  if (o._helio) return o._helio;
  const pts = geoTrack(o).filter(p => p.dist).map(p => ({ t: p.t, v: eqjToEcl(add(helio('Earth', p.t), p.v)) }));
  o._helio = pts;
  return pts;
}

export function scoutHelioAt(o, ms) {
  const jd = jdTT(ms);
  return o.els.map(el => keplerPos(el, jd));
}

export { norm, eclToEqj };
