// Name search across JPL Horizons, the MPC Ephemeris Service and JPL Scout.
// Each search returns an ephemeris as text, in a format parse.js already reads.
// Horizons and MPC need the Ephemeral proxy (worker/ephemeral-proxy.js); Scout falls back
// to the hourly snapshot.
import { proxyBase, getJSON, lookup } from './scout.js';
import { scoutElements, keplerGeo, vecToRadec } from './astro.js';

const HORIZONS = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const pad = n => String(n).padStart(2, '0');
const utcParts = ms => { const d = new Date(ms); return [d.getUTCFullYear(), pad(d.getUTCMonth() + 1), pad(d.getUTCDate()), pad(d.getUTCHours()), pad(d.getUTCMinutes())]; };

export const isComet = name => /^(\d+[PDI](-[A-Z]{1,2})?|[PCDXIA]\/\s?\d{4}\s?[A-Z]{1,2}\d*)$/i.test(name.trim());

// Horizons treats "name;" as a small-body search. Comets get the latest apparition.
export function horizonsCommand(name) {
  const n = name.trim().replace(/;+$/, '');
  if (isComet(n)) return `DES=${n.replace(/\s+/g, ' ')};CAP;NOFRAG;`;
  return n + ';';
}

export function horizonsParams(command, opts, format = 'json') {
  const [y0, m0, d0, h0, mi0] = utcParts(opts.start);
  const [y1, m1, d1, h1, mi1] = utcParts(opts.stop);
  return new URLSearchParams({
    format,
    COMMAND: `'${command}'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'OBSERVER',
    CENTER: "'500@399'",
    START_TIME: `'${y0}-${m0}-${d0} ${h0}:${mi0}'`,
    STOP_TIME: `'${y1}-${m1}-${d1} ${h1}:${mi1}'`,
    STEP_SIZE: `'${opts.stepMin} m'`,
    QUANTITIES: "'1,9,20,23,24'",
  }).toString();
}

export const horizonsLink = (name, opts) => `${HORIZONS}?${horizonsParams(horizonsCommand(name), opts, 'text')}`;
export const MPC_FORM = 'https://minorplanetcenter.net/iau/MPEph/MPEph.html';

// Rows of a Horizons "multiple matches" listing -> [{ cmd, label }]
function parseChoices(result) {
  const small = /Matching small-bodies/i.test(result);
  const lines = result.split('\n');
  const dash = lines.findIndex(l => /^\s*-{4,}\s+-{4,}/.test(l));
  if (dash < 0) return [];
  const out = [];
  for (let i = dash + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) break;
    const m = l.match(/^\s*(-?\d+)\s+(.*)$/);
    if (!m) continue;
    const label = m[2].replace(/\s{2,}/g, ' · ').trim();
    out.push({ cmd: small ? `${m[1]};` : m[1], label: `${m[1]} · ${label}` });
  }
  return out;
}

export async function searchHorizons(name, opts, proxy, command) {
  const base = proxyBase(proxy);
  if (!base) return { status: 'noproxy', note: 'Needs your proxy.', link: horizonsLink(name, opts) };
  let cmd = command || horizonsCommand(name);
  for (let attempt = 0; attempt < 2; attempt++) {
    let j;
    try { j = await getJSON(`${base}/horizons?${horizonsParams(cmd, opts)}`, 45000); }
    catch (e) { return { status: 'error', note: `Horizons: ${e.message}` }; }
    if (j.error) return { status: 'error', note: j.error };
    const r = j.result || '';
    if (r.includes('$$SOE')) {
      const tn = r.match(/Target body name:\s*(.+?)(?:\s{2,}|\{|$)/m);
      return { status: 'ok', text: r, label: tn ? tn[1].trim() : name };
    }
    const choices = parseChoices(r);
    if (choices.length) return { status: 'choices', choices: choices.slice(0, 15), note: `${choices.length} matches. Pick one:` };
    if (/No matches found/i.test(r) && !command && attempt === 0 && !isComet(name)) {
      cmd = name.trim().replace(/;+$/, ''); // try major bodies (planets, moons, spacecraft)
      continue;
    }
    if (/No matches found/i.test(r)) return { status: 'missing', note: 'Horizons found no match.' };
    const msg = r.split('\n').map(s => s.trim()).find(s => s && !/^\*+$/.test(s) && !/API (VERSION|SOURCE)/.test(s));
    return { status: 'error', note: msg || 'Horizons gave no ephemeris.' };
  }
  return { status: 'missing', note: 'Horizons found no match.' };
}

export async function searchMPC(name, opts, proxy) {
  const base = proxyBase(proxy);
  if (!base) return { status: 'noproxy', note: 'Needs your proxy.', link: MPC_FORM };
  const stepMs = opts.stepMin * 60000;
  let count = Math.floor((opts.stop - opts.start) / stepMs) + 1;
  const truncated = count > 1441;
  count = Math.min(count, 1441);
  let u = 'm', i = opts.stepMin;
  if (opts.stepMin % 1440 === 0) { u = 'd'; i = opts.stepMin / 1440; } else if (opts.stepMin % 60 === 0) { u = 'h'; i = opts.stepMin / 60; }
  const [y, mo, d, h, mi] = utcParts(opts.start);
  const form = new URLSearchParams({
    ty: 'e', TextArea: name.trim(), d: `${y} ${mo} ${d} ${h}${mi}`, l: String(count), i: String(i), u, uto: '0',
    c: '500', long: '', lat: '', alt: '', raty: 'a', s: 't', m: 'm', igd: 'n', ibh: 'n', adir: 'S', oed: '', e: '-2',
    resoc: '', tit: '', bu: '', ch: 'c', ce: 'f', js: 'f',
  });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 45000);
  try {
    const r = await fetch(`${base}/mpc-eph`, { method: 'POST', body: form.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { msg = (await r.json()).error || msg; } catch { /* not JSON */ }
      return { status: r.status === 404 ? 'missing' : 'error', note: msg };
    }
    const body = await r.text();
    const desig = (body.trim().split('\n')[0] || '').trim().split(/\s+/)[0];
    const text = `# Object: ${name.trim()}\n# Source: MPC Ephemeris Service, geocentric (${desig})\n${body}`;
    return { status: 'ok', text, label: desig || name, note: truncated ? 'MPC caps a request at 1441 rows; the span was cut short.' : '' };
  } catch (e) {
    return { status: 'error', note: `MPC: ${e.name === 'AbortError' ? 'timed out' : e.message}` };
  } finally { clearTimeout(timer); }
}

// Scout: tentative orbit samples -> mean geocentric ephemeris (two-body).
export async function searchScout(name, opts, proxy) {
  const res = await lookup(name, proxy);
  if (res.status !== 'ok') return { status: res.status, note: res.note, scout: res };
  const els = scoutElements(res.reply);
  if (!els.length) return { status: 'missing', note: 'Scout has no orbit samples for it.', scout: res };
  const stepMs = opts.stepMin * 60000;
  const n = Math.min(2000, Math.floor((opts.stop - opts.start) / stepMs) + 1);
  const lines = [
    `# Object: ${name.trim()}`,
    `# Source: JPL Scout, mean of ${els.length} orbit samples (two-body), geocentric`,
    '# time               RA(deg)     Dec(deg)    delta(au)',
  ];
  for (let k = 0; k < n; k++) {
    const t = opts.start + k * stepMs;
    const sum = [0, 0, 0];
    let dist = 0;
    for (const el of els) {
      const v = keplerGeo(el, t);
      const r = Math.hypot(v[0], v[1], v[2]);
      sum[0] += v[0] / r; sum[1] += v[1] / r; sum[2] += v[2] / r; dist += r;
    }
    const rd = vecToRadec(sum);
    lines.push(`${new Date(t).toISOString().slice(0, 16)}Z  ${rd.ra.toFixed(5).padStart(9)}  ${rd.dec.toFixed(5).padStart(9)}  ${(dist / els.length).toFixed(6)}`);
  }
  const days = Math.max(Math.abs(opts.start - Date.now()), Math.abs(opts.stop - Date.now())) / 864e5;
  return {
    status: 'ok', text: lines.join('\n') + '\n', label: `${els.length} orbit samples via ${res.source}`, scout: res,
    note: days > 45 ? 'Scout orbits are short-arc; positions far from today are rough.' : '',
  };
}
