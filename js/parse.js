// Ephemeris parsing. Accepts JPL Horizons (text or CSV), MPC Ephemeris Service,
// Find_Orb, MPC 80-column astrometry, and plain "time, RA, Dec[, delta]" tables.
// Output rows: { t: ms since epoch (UTC), ra: deg, dec: deg, delta: au|null, mag: number|null, site: code|null }

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

export function jdToMs(jd) { return (jd - 2440587.5) * 86400000; }
export function msToJd(ms) { return ms / 86400000 + 2440587.5; }

function utc(y, mo, d, h = 0, mi = 0, s = 0) {
  return Date.UTC(y, mo, 1) + (d - 1) * 86400000 + h * 3600000 + mi * 60000 + s * 1000;
}

// Read a date/time at the start of `s`. Returns { t, rest } or null.
export function takeDate(s) {
  let m;
  s = s.replace(/^\s+/, '');
  // Horizons: 2024-Dec-20 00:00[:00[.000]]  (also b2024 for BC; ignored)
  if ((m = s.match(/^(\d{4})-([A-Za-z]{3})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?/))) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo === undefined) return null;
    return { t: utc(+m[1], mo, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)), rest: s.slice(m[0].length) };
  }
  // ISO: 2024-12-20T00:00[:00][Z] or 2024-12-20 00:00
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?Z?/))) {
    return { t: utc(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)), rest: s.slice(m[0].length) };
  }
  // Julian date
  if ((m = s.match(/^(2\d{6}(?:\.\d+)?)(?=[\s,]|$)/))) {
    return { t: jdToMs(parseFloat(m[1])), rest: s.slice(m[0].length) };
  }
  // MPC style: 2024 12 20.12345 | 2024 12 20 000000 | 2024 12 20 00 | 2024 12 20 00:00[:00] | 2024/12/20 ...
  if ((m = s.match(/^(\d{4})[ /](\d{1,2})[ /](\d{1,2}(?:\.\d+)?)/))) {
    const y = +m[1], mo = +m[2] - 1, dStr = m[3];
    let rest = s.slice(m[0].length);
    if (dStr.includes('.')) {
      const d = parseFloat(dStr);
      return { t: utc(y, mo, Math.floor(d)) + (d - Math.floor(d)) * 86400000, rest };
    }
    let h = 0, mi = 0, sec = 0, mm;
    if ((mm = rest.match(/^\s+(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?/))) {
      h = +mm[1]; mi = +mm[2]; sec = +(mm[3] || 0); rest = rest.slice(mm[0].length);
    } else if ((mm = rest.match(/^\s+(\d{2})(\d{2})(\d{2})(?=\s)/))) {
      h = +mm[1]; mi = +mm[2]; sec = +mm[3]; rest = rest.slice(mm[0].length);
    } else if ((mm = rest.match(/^\s+(\d{2})(\d{2})(?=\s)/))) {
      h = +mm[1]; mi = +mm[2]; rest = rest.slice(mm[0].length);
    } else if ((mm = rest.match(/^\s+(\d{2})(?=\s+\d{1,2}[ :]\d{2}[ :])/))) {
      h = +mm[1]; rest = rest.slice(mm[0].length);
    }
    return { t: utc(y, mo, +dStr, h, mi, sec), rest };
  }
  return null;
}

// Read an angle. RA in sexagesimal is hours; decimal RA is degrees.
export function takeAngle(s, isRA) {
  let m;
  s = s.replace(/^[\s,]+/, '');
  if ((m = s.match(/^([+-]?)(\d{1,3})[ :hd°](\s?\d{1,2})[ :m'](\s?\d{1,2}(?:\.\d*)?)[s"]?/))) {
    const sign = m[1] === '-' ? -1 : 1;
    let v = +m[2] + +m[3] / 60 + parseFloat(m[4]) / 3600;
    if (isRA) v *= 15;
    return { deg: sign * v, rest: s.slice(m[0].length) };
  }
  if ((m = s.match(/^([+-]?)(\d{1,3})[ :](\d{1,2}(?:\.\d+)?)(?=[\s,])/))) { // dd mm.m
    const sign = m[1] === '-' ? -1 : 1;
    let v = +m[2] + parseFloat(m[3]) / 60;
    if (isRA) v *= 15;
    return { deg: sign * v, rest: s.slice(m[0].length) };
  }
  if ((m = s.match(/^([+-]?\d+(?:\.\d+)?)(?=[\s,]|$)/))) {
    return { deg: parseFloat(m[1]), rest: s.slice(m[0].length) };
  }
  return null;
}

function numbers(s) {
  return (s.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) || []).map(Number);
}

function cleanName(n) {
  if (!n) return '';
  n = n.trim().replace(/\s+/g, ' ');
  const m = n.match(/^\((.+)\)$/);
  return m ? m[1] : n;
}

// ---------------- Horizons ----------------
function parseHorizons(text, out) {
  const lines = text.split(/\r?\n/);
  const soe = lines.findIndex(l => l.startsWith('$$SOE'));
  const eoe = lines.findIndex(l => l.startsWith('$$EOE'));
  if (soe < 0) return false;
  out.format = 'JPL Horizons';
  let m;
  if ((m = text.match(/Target body name:\s*(.+?)(?:\s{2,}|\{|$)/m))) out.name = cleanName(m[1]);
  if ((m = text.match(/Center geodetic\s*:\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)/))) {
    const lon = +m[1], lat = +m[2], hkm = +m[3];
    if (hkm > -6000) {
      const sn = text.match(/Center-site name:\s*(.+)/);
      out.site = { lon: lon > 180 ? lon - 360 : lon, lat, h: hkm * 1000, name: sn ? sn[1].trim() : 'Ephemeris site' };
    }
  }
  if (/Apparent|apparent RA/i.test(text.slice(0, text.indexOf('$$SOE'))) && !/ICRF/.test(text)) out.notes.push('Horizons apparent RA/Dec treated as J2000 (small error).');
  let header = '';
  for (let i = soe - 1; i >= 0; i--) {
    if (/Date/.test(lines[i])) { header = lines[i]; break; }
  }
  const body = lines.slice(soe + 1, eoe < 0 ? undefined : eoe).filter(l => l.trim());
  const isCSV = body.length && body[0].split(',').length > 3;
  if (isCSV) {
    const cols = header.split(',').map(c => c.trim());
    const find = re => cols.findIndex(c => re.test(c));
    const iRA = find(/^R\.A\./), iDec = find(/^DEC/), iDelta = find(/^delta$/), iMag = find(/^(APmag|T-mag|N-mag)/);
    for (const l of body) {
      const c = l.split(',').map(x => x.trim());
      const d = takeDate(c[0]);
      if (!d) continue;
      const ra = takeAngle(c[iRA], true), dec = takeAngle(c[iDec], false);
      if (!ra || !dec) continue;
      out.rows.push({ t: d.t, ra: ra.deg, dec: dec.deg, delta: iDelta >= 0 ? num(c[iDelta]) : null, mag: iMag >= 0 ? num(c[iMag]) : null });
    }
    return true;
  }
  const endOf = label => { const i = header.indexOf(label); return i < 0 ? -1 : i + label.length; };
  const deltaEnd = endOf(' delta ') > 0 ? endOf(' delta') : -1;
  const magEnd = Math.max(endOf('APmag'), endOf('T-mag'));
  for (const l of body) {
    const d = takeDate(l);
    if (!d) continue;
    // skip solar/lunar presence flags, then read RA/Dec
    const offset = l.length - d.rest.length;
    let rest = d.rest.replace(/^\s*[*CNAm ]{0,3}\s/, ' ');
    const ra = takeAngle(rest, true);
    if (!ra) continue;
    const dec = takeAngle(ra.rest, false);
    if (!dec) continue;
    out.rows.push({ t: d.t, ra: ra.deg, dec: dec.deg, delta: tokenEndingNear(l, deltaEnd), mag: tokenEndingNear(l, magEnd), _off: offset });
  }
  out.rows.forEach(r => delete r._off);
  return true;
}

function num(x) { const v = parseFloat(x); return Number.isFinite(v) ? v : null; }

// Horizons right-aligns values under their labels; pick the number whose end is nearest.
function tokenEndingNear(line, end) {
  if (end < 0) return null;
  let best = null, bestD = 1e9;
  for (const m of line.matchAll(/\S+/g)) {
    const e = m.index + m[0].length;
    const d = Math.abs(e - end);
    if (d < bestD) { bestD = d; best = m[0]; }
  }
  return bestD <= 6 ? num(best) : null;
}

// ---------------- MPC 80-column observations ----------------
function parseObs80(text, out) {
  const lines = text.split(/\r?\n/).filter(l => l.length >= 80 && /^.{14}.\d{4} \d\d \d\d\.\d+/.test(l.slice(0, 32)));
  if (lines.length < 1) return false;
  out.format = 'MPC 80-column astrometry';
  for (const l of lines) {
    const note2 = l[14];
    if ('sSvVrR'.includes(note2)) continue; // second lines of satellite / roving records
    const d = takeDate(l.slice(15, 32));
    const ra = takeAngle(l.slice(32, 44), true);
    const dec = takeAngle(l.slice(44, 56), false);
    if (!d || !ra || !dec) continue;
    const site = l.slice(77, 80).trim();
    const row = { t: d.t, ra: ra.deg, dec: dec.deg, delta: null, mag: num(l.slice(65, 70)), site };
    if (l[12] === '*' && !out.discoverySite) { out.discoverySite = site; out.discoveryTime = d.t; }
    out.rows.push(row);
  }
  const desig = lines[0].slice(0, 12).trim();
  if (desig) out.name = desig;
  return out.rows.length > 0;
}

// ---------------- generic / MPC ephemeris / Find_Orb ----------------
function parseGeneric(text, out) {
  const lines = text.split(/\r?\n/);
  let header = null;
  let m;
  if ((m = text.match(/^\s*(?:#\s*)?(?:Object|Target|Name)\s*[:=]\s*(.+)$/im))) out.name = cleanName(m[1]);
  for (const raw of lines) {
    const l = raw.replace(/^\s*#.*$/, '');
    if (!l.trim()) continue;
    const isCSV = l.includes(',');
    if (!header && /[A-Za-z]/.test(l) && /\b(ra|r\.a\.)\b/i.test(l) && /\bdec/i.test(l)) {
      header = l.split(isCSV ? ',' : /\s{2,}|\t/).map(c => c.trim().toLowerCase());
      continue;
    }
    if (isCSV && header) {
      const c = l.split(',').map(x => x.trim());
      const idx = re => header.findIndex(h => re.test(h));
      const iT = Math.max(idx(/^(time|date|utc|jd|epoch|datetime)/), 0);
      const iRA = idx(/^(ra|r\.a\.)/), iDec = idx(/^dec/), iDelta = idx(/^(delta|dist|range|geo)/), iMag = idx(/^(mag|v$|vmag)/);
      const d = takeDate(c[iT]);
      const ra = iRA >= 0 && takeAngle(c[iRA], !/deg/.test(header[iRA])), dec = iDec >= 0 && takeAngle(c[iDec], false);
      if (!d || !ra || !dec) continue;
      out.rows.push({ t: d.t, ra: ra.deg, dec: dec.deg, delta: iDelta >= 0 ? num(c[iDelta]) : null, mag: iMag >= 0 ? num(c[iMag]) : null });
      continue;
    }
    const d = takeDate(l);
    if (!d) continue;
    const ra = takeAngle(d.rest, true);
    if (!ra) continue;
    const dec = takeAngle(ra.rest, false);
    if (!dec) continue;
    const ns = numbers(dec.rest);
    // MPC Ephemeris Service and Find_Orb both put Delta first after Dec.
    const delta = ns.length && ns[0] > 0 && ns[0] < 200 ? ns[0] : null;
    out.rows.push({ t: d.t, ra: ra.deg, dec: dec.deg, delta, mag: null });
  }
  if (out.rows.length) out.format = header ? 'Table with header' : 'MPC / Find_Orb style table';
  return out.rows.length > 0;
}

export function parseEphemeris(text) {
  const out = { name: '', format: '', site: null, rows: [], notes: [], discoverySite: null, discoveryTime: null };
  if (!text || !text.trim()) return out;
  if (!parseHorizons(text, out) && !parseObs80(text, out)) parseGeneric(text, out);
  out.rows = out.rows.filter(r => Number.isFinite(r.t) && Number.isFinite(r.ra) && Number.isFinite(r.dec) && r.dec >= -90 && r.dec <= 90);
  out.rows.forEach(r => { r.ra = ((r.ra % 360) + 360) % 360; });
  out.rows.sort((a, b) => a.t - b.t);
  if (!out.rows.length) out.notes.push('No positions found. Paste a Horizons observer table, an MPC/Find_Orb ephemeris, 80-column astrometry, or "time, RA, Dec, delta" lines.');
  else if (!out.rows.some(r => r.delta)) out.notes.push('No distance (delta) column: Space View arc and parallax need it.');
  return out;
}
