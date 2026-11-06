// Coordinate helpers built on Astronomy Engine (global `Astronomy`).
// Frames: EQJ = J2000 mean equator (ICRF-ish), ECL = J2000 ecliptic, HOR = local horizon.
const A = window.Astronomy;
export const D2R = Math.PI / 180, R2D = 180 / Math.PI;
export const AU_KM = 149597870.7;
const C_AU_DAY = 173.1446326846693;
const K_GAUSS = 0.01720209895;
const EPS = 23.4392911 * D2R;

export function radecToVec(ra, dec, r = 1) {
  const c = Math.cos(dec * D2R);
  return [r * c * Math.cos(ra * D2R), r * c * Math.sin(ra * D2R), r * Math.sin(dec * D2R)];
}
export function vecToRadec(v) {
  const r = Math.hypot(v[0], v[1], v[2]);
  let ra = Math.atan2(v[1], v[0]) * R2D;
  if (ra < 0) ra += 360;
  return { ra, dec: Math.asin(v[2] / r) * R2D, dist: r };
}
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const norm = a => Math.hypot(a[0], a[1], a[2]);

export function eclToEqj(v) {
  const c = Math.cos(EPS), s = Math.sin(EPS);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}
export function eqjToEcl(v) {
  const c = Math.cos(EPS), s = Math.sin(EPS);
  return [v[0], v[1] * c + v[2] * s, -v[1] * s + v[2] * c];
}

const obsCache = new Map();
export function observer(site) {
  const k = `${site.lat},${site.lon},${site.h || 0}`;
  if (!obsCache.has(k)) obsCache.set(k, new A.Observer(site.lat, site.lon, site.h || 0));
  return obsCache.get(k);
}
export const atime = ms => A.MakeTime(new Date(ms));
export const jdTT = ms => atime(ms).tt + 2451545.0;

// Observer position relative to Earth's centre, EQJ, au.
export function siteVec(ms, site) {
  const v = A.ObserverVector(atime(ms), observer(site), false);
  return [v.x, v.y, v.z];
}

// Rotation EQJ -> HOR as a plain 3x3 (row-major in Astronomy's convention: out_j = sum_i rot[i][j] v_i).
export function horRotation(ms, site) {
  return A.Rotation_EQJ_HOR(atime(ms), observer(site)).rot;
}
// Returns { alt, az } in degrees. HOR: x = north, y = west, z = zenith.
export function toAltAz(rot, v) {
  const x = rot[0][0] * v[0] + rot[1][0] * v[1] + rot[2][0] * v[2];
  const y = rot[0][1] * v[0] + rot[1][1] * v[1] + rot[2][1] * v[2];
  const z = rot[0][2] * v[0] + rot[1][2] * v[1] + rot[2][2] * v[2];
  const r = Math.hypot(x, y, z);
  let az = Math.atan2(-y, x) * R2D;
  if (az < 0) az += 360;
  return { alt: Math.asin(z / r) * R2D, az };
}

export function bodyGeo(name, ms) {
  const v = A.GeoVector(name, atime(ms), true);
  return [v.x, v.y, v.z];
}
export function helio(name, ms) {
  const v = A.HelioVector(name, atime(ms));
  return [v.x, v.y, v.z];
}
export function moonPhase(ms) { return A.MoonPhase(atime(ms)); } // 0 new, 180 full

export function airmass(alt) {
  if (alt <= 0) return Infinity;
  return 1 / Math.sin((alt + 244 / (165 + 47 * Math.pow(alt, 1.1))) * D2R);
}

// ---- Keplerian propagation of heliocentric ecliptic elements (Scout style) ----
// el: { e, q, tp (JD TDB), om, w, i (deg) } -> ECL position, au.
export function keplerPos(el, jd) {
  const { e, q } = el;
  const dt = jd - el.tp;
  let x, y;
  if (Math.abs(e - 1) < 1e-6) {
    const W = 3 * K_GAUSS * dt / Math.sqrt(2 * q * q * q);
    const Y = Math.cbrt(W / 2 + Math.sqrt(W * W / 4 + 1));
    const s = Y - 1 / Y;
    x = q * (1 - s * s); y = 2 * q * s;
  } else if (e < 1) {
    const a = q / (1 - e);
    let M = K_GAUSS / Math.pow(a, 1.5) * dt;
    M = Math.atan2(Math.sin(M), Math.cos(M));
    let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1);
    for (let k = 0; k < 50; k++) {
      const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= dE;
      if (Math.abs(dE) < 1e-12) break;
    }
    x = a * (Math.cos(E) - e); y = a * Math.sqrt(1 - e * e) * Math.sin(E);
  } else {
    const a = q / (1 - e); // negative
    const M = K_GAUSS / Math.pow(-a, 1.5) * dt;
    let H = Math.asinh(M / e);
    for (let k = 0; k < 60; k++) {
      const dH = (e * Math.sinh(H) - H - M) / (e * Math.cosh(H) - 1);
      H -= dH;
      if (Math.abs(dH) < 1e-12) break;
    }
    x = a * (Math.cosh(H) - e); y = -a * Math.sqrt(e * e - 1) * Math.sinh(H);
  }
  return orbitToEcl(el, x, y);
}

function orbitToEcl(el, x, y) {
  const O = el.om * D2R, w = el.w * D2R, i = el.i * D2R;
  const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(i), si = Math.sin(i);
  return [
    (cO * cw - sO * sw * ci) * x + (-cO * sw - sO * cw * ci) * y,
    (sO * cw + cO * sw * ci) * x + (-sO * sw + cO * cw * ci) * y,
    (sw * si) * x + (cw * si) * y,
  ];
}

// Points along the whole orbit (ellipse) or the near-Sun part (r < rMax) of an open orbit.
export function orbitPath(el, n = 180, rMax = 60) {
  const { e, q } = el;
  const pts = [];
  const p = q * (1 + e);
  let nuMax = Math.PI;
  if (e >= 1) {
    // true anomaly where r = rMax, kept inside the asymptote
    const c = (p / rMax - 1) / e;
    nuMax = Math.min(Math.acos(Math.max(-1, Math.min(1, c))), Math.acos(-1 / e) - 1e-3);
  }
  for (let k = 0; k <= n; k++) {
    const nu = -nuMax + (2 * nuMax * k) / n;
    const r = p / (1 + e * Math.cos(nu));
    if (!(r > 0) || r > rMax * 1.01) continue;
    pts.push(orbitToEcl(el, r * Math.cos(nu), r * Math.sin(nu)));
  }
  return pts;
}

// Geocentric EQJ vector of a body on Keplerian elements, with one light-time step.
export function keplerGeo(el, ms) {
  const jd = jdTT(ms);
  const earth = helio('Earth', ms);
  let obj = eclToEqj(keplerPos(el, jd));
  const lt = norm(sub(obj, earth)) / C_AU_DAY;
  obj = eclToEqj(keplerPos(el, jd - lt));
  return sub(obj, earth);
}

// Scout reply -> list of element sets
export function scoutElements(reply) {
  const o = reply && reply.orbits;
  if (!o || !o.data) return [];
  const f = o.fields;
  const ix = name => f.indexOf(name);
  const iE = ix('ec'), iQ = ix('qr'), iT = ix('tp'), iO = ix('om'), iW = ix('w'), iI = ix('inc');
  return o.data.map(r => ({ e: +r[iE], q: +r[iQ], tp: +r[iT], om: +r[iO], w: +r[iW], i: +r[iI] }))
    .filter(el => [el.e, el.q, el.tp, el.om, el.w, el.i].every(Number.isFinite));
}

export function fmtRA(deg) {
  let h = ((deg % 360) + 360) % 360 / 15;
  const hh = Math.floor(h); h = (h - hh) * 60;
  const mm = Math.floor(h); const ss = (h - mm) * 60;
  return `${String(hh).padStart(2, '0')}h${String(mm).padStart(2, '0')}m${ss.toFixed(1).padStart(4, '0')}s`;
}
export function fmtDec(deg) {
  const s = deg < 0 ? '−' : '+';
  let d = Math.abs(deg);
  const dd = Math.floor(d); d = (d - dd) * 60;
  const mm = Math.floor(d); const ss = (d - mm) * 60;
  return `${s}${String(dd).padStart(2, '0')}°${String(mm).padStart(2, '0')}′${ss.toFixed(0).padStart(2, '0')}″`;
}
