import { radecToVec, AU_KM } from './astro.js';
import { makeObject, reparse, setScout, span, hasRows, helioArc } from './model.js';
import { DomeView, describe } from './dome.js';
import { ChartView } from './chart.js';
import { SpaceView } from './space.js';
import { lookup, snapshotIndex, scoutPage } from './scout.js';
import { fmtUTC } from './canvas.js';

const $ = sel => document.querySelector(sel);
const store = {
  get(k, d) { try { const v = localStorage.getItem('ephemeral:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ephemeral:' + k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};

const DEFAULT_YOU = { lat: 14.5995, lon: 120.9842, h: 10, label: 'Manila (default, change me)', code: '' };
const SAMPLE = { file: 'data/samples/horizons-2024YR4-W68.txt', disc: 'W68', discTime: Date.UTC(2024, 11, 27, 4, 0) };

const state = {
  time: Date.now(),
  objects: [],
  active: null,
  stars: [],
  constellations: [],
  obscodes: {},
  you: { ...DEFAULT_YOU, ...store.get('you', {}) },
  proxy: store.get('proxy', ''),
  playing: false,
  speed: 3600,
  range: [Date.now() - 15 * 864e5, Date.now() + 15 * 864e5],
};

let needsDraw = true, tipShown = false;
const app = {
  state,
  dirty() { needsDraw = true; },
  tooltip(canvas, pos, lines) {
    const r = canvas.getBoundingClientRect();
    const tip = $('#tooltip');
    tip.innerHTML = lines.map(l => `<div>${escapeHtml(l)}</div>`).join('');
    tip.hidden = false;
    const x = r.left + pos[0] + 14, y = r.top + pos[1] + 14;
    tip.style.left = Math.min(x, innerWidth - tip.offsetWidth - 8) + 'px';
    tip.style.top = Math.min(y, innerHeight - tip.offsetHeight - 8) + 'px';
    tipShown = true;
  },
  povSites() {
    const out = [];
    const d = discSite(); if (d) out.push({ ...d, dash: [6, 4] });
    const y = youSite(); if (y) out.push({ ...y, dash: [1.5, 3] });
    return out;
  },
};

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function siteFromCode(code) {
  const e = state.obscodes[code];
  if (!e) return null;
  const [name, lon, lat, h] = e;
  return { site: { lat, lon: lon > 180 ? lon - 360 : lon, h }, key: 'code:' + code, label: `${code} · ${name}` };
}
function discSite() {
  const o = state.active;
  if (!o) return null;
  if (o.discCode) return siteFromCode(o.discCode.toUpperCase());
  if (o.parsed && o.parsed.site) { const s = o.parsed.site; return { site: s, key: `eph:${s.lat},${s.lon}`, label: s.name }; }
  return null;
}
function youSite() {
  const y = state.you;
  if (!Number.isFinite(y.lat) || !Number.isFinite(y.lon)) return null;
  return { site: { lat: y.lat, lon: y.lon, h: y.h || 0 }, key: `you:${y.lat},${y.lon},${y.h}`, label: y.label || 'You' };
}

// ---------------- views ----------------
const disc = new DomeView($('#cv-disc'), app, discSite);
disc.emptyText = 'Type the discovery site\'s MPC code in the object card (for example F51, T05, G96, 703, W68).';
const you = new DomeView($('#cv-you'), app, youSite);
you.emptyText = 'Set your location in the sidebar.';
const chart = new ChartView($('#cv-chart'), app);
const space = new SpaceView($('#cv-space'), app);

function lmt(ms, lon) {
  const d = new Date(ms + (lon / 15) * 3600e3);
  return d.toISOString().slice(11, 16);
}

function safe(fn) {
  try { return fn(); } catch (e) { console.error(e); return null; }
}

function drawAll() {
  tipShown = false;
  const ds = discSite(), ys = youSite();
  const di = safe(() => disc.draw());
  $('#disc-sub').textContent = ds ? `${ds.label} · LMT ${lmt(state.time, ds.site.lon)}` : 'no site';
  $('#disc-info').innerHTML = describe(di);
  const yi = safe(() => you.draw());
  $('#you-sub').textContent = ys ? `${ys.label} · LMT ${lmt(state.time, ys.site.lon)}` : 'no site';
  $('#you-info').innerHTML = describe(yi);
  safe(() => chart.draw());
  space.activeInfo = null;
  safe(() => space.draw());
  const a = space.activeInfo;
  $('#space-info').innerHTML = a
    ? `<b>${escapeHtml(state.active.name || 'object')}</b> · r = ${a.r.toFixed(4)} au from Sun · Δ = ${a.delta.toFixed(5)} au (${(a.delta * AU_KM / 384400).toFixed(2)} lunar distances)`
    : 'Drag to turn the view. The dotted line drops to the ecliptic plane.';
  if (!tipShown) $('#tooltip').hidden = true;
}

let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  if (state.playing) {
    let t = state.time + dt * state.speed * 1000;
    if (t > state.range[1]) t = state.range[0];
    setTime(t, false);
  }
  if (needsDraw) { needsDraw = false; drawAll(); }
  requestAnimationFrame(frame);
}

// ---------------- time ----------------
function updateRange() {
  let lo = Infinity, hi = -Infinity;
  for (const o of state.objects) { const s = span(o); if (s) { lo = Math.min(lo, s[0]); hi = Math.max(hi, s[1]); } }
  if (!Number.isFinite(lo)) { const n = Date.now(); lo = n - 15 * 864e5; hi = n + 15 * 864e5; }
  if (hi - lo < 3600e3) { lo -= 12 * 3600e3; hi += 12 * 3600e3; }
  state.range = [lo, hi];
  setTime(Math.min(hi, Math.max(lo, state.time)));
}
function setTime(ms, updateInput = true) {
  state.time = ms;
  const [lo, hi] = state.range;
  $('#slider').value = Math.round(((ms - lo) / (hi - lo)) * 1000);
  if (updateInput || state.playing) $('#when').value = new Date(ms).toISOString().slice(0, 16);
  app.dirty();
}
$('#slider').addEventListener('input', e => {
  const [lo, hi] = state.range;
  setTime(lo + (hi - lo) * (+e.target.value / 1000));
});
$('#when').addEventListener('change', e => {
  const t = Date.parse(e.target.value + ':00Z');
  if (Number.isFinite(t)) {
    if (t < state.range[0] || t > state.range[1]) state.range = [Math.min(t, state.range[0]), Math.max(t, state.range[1])];
    setTime(t);
  }
});
$('#btn-play').addEventListener('click', togglePlay);
function togglePlay() {
  state.playing = !state.playing;
  $('#btn-play').textContent = state.playing ? '❚❚' : '▶';
  lastFrame = performance.now();
}
$('#speed').addEventListener('change', e => { state.speed = +e.target.value; });
$('#btn-now').addEventListener('click', () => {
  const n = Date.now();
  if (n < state.range[0] || n > state.range[1]) state.range = [Math.min(n, state.range[0]), Math.max(n, state.range[1])];
  setTime(n);
});
$('#btn-disc').addEventListener('click', () => {
  const o = state.active;
  if (!o) return;
  const t = o.discTime || (hasRows(o) ? o.parsed.rows[0].t : null);
  if (t) { if (t < state.range[0] || t > state.range[1]) updateRange(); setTime(t); }
  else toast('No discovery time known for this object.');
});
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); togglePlay(); }
});

// ---------------- objects ----------------
function addObject(opts, { activate = true, autoScout = true } = {}) {
  const o = makeObject(opts);
  if (Object.keys(state.obscodes).length) reparse(o, state.obscodes);
  state.objects.push(o);
  if (activate || !state.active) state.active = o;
  renderObjects();
  updateRange();
  if (autoScout && o.name) pingScout(o, true);
  return o;
}

function removeObject(o) {
  state.objects = state.objects.filter(x => x !== o);
  if (state.active === o) state.active = state.objects[0] || null;
  renderObjects(); updateRange();
}

const timers = new WeakMap();
function debounce(o, key, fn, ms) {
  const m = timers.get(o) || {};
  clearTimeout(m[key]);
  m[key] = setTimeout(fn, ms);
  timers.set(o, m);
}

function renderObjects() {
  const host = $('#objects');
  host.innerHTML = '';
  if (!state.objects.length) {
    host.innerHTML = '<p class="hint">No objects yet. Click <b>+ Add</b> and paste an ephemeris, try the <b>Sample</b>, or pick a live Scout object below.</p>';
  }
  for (const o of state.objects) {
    const el = $('#tpl-object').content.firstElementChild.cloneNode(true);
    el.style.setProperty('--c', o.color);
    el.classList.toggle('active', o === state.active);
    el.classList.toggle('hidden-obj', !o.visible);
    const q = s => el.querySelector(s);
    q('.o-color').value = o.color;
    q('.o-name').value = o.name;
    q('.o-text').value = o.text;
    q('.o-disc').value = o.discCode;
    q('.o-vis').textContent = o.visible ? '●' : '○';
    el.addEventListener('pointerdown', () => {
      if (state.active !== o) { state.active = o; document.querySelectorAll('.obj').forEach(n => n.classList.remove('active')); el.classList.add('active'); app.dirty(); }
    });
    q('.o-color').addEventListener('input', e => { o.color = e.target.value; el.style.setProperty('--c', o.color); app.dirty(); });
    q('.o-vis').addEventListener('click', () => { o.visible = !o.visible; renderObjects(); app.dirty(); });
    q('.o-del').addEventListener('click', () => removeObject(o));
    q('.o-name').addEventListener('input', e => {
      o.name = e.target.value.trim(); o.nameEdited = true; app.dirty();
      debounce(o, 'scout', () => o.name && pingScout(o, true), 900);
    });
    q('.o-disc').addEventListener('input', e => {
      o.discCode = e.target.value.trim().toUpperCase();
      for (const k of [...o._topo.keys()]) if (k.startsWith('code:') || k.startsWith('eph:')) o._topo.delete(k);
      app.dirty();
    });
    q('.o-text').addEventListener('input', e => {
      o.text = e.target.value;
      debounce(o, 'parse', () => {
        const hadRows = hasRows(o);
        const oldName = o.name;
        reparse(o, state.obscodes);
        q('.o-name').value = o.name;
        q('.o-disc').value = o.discCode;
        statusLine(o, q('.o-status'));
        updateRange();
        if (!hadRows && hasRows(o)) { setTime(o.parsed.rows[0].t); chart.fit(state.objects); }
        if (o.name && o.name !== oldName) pingScout(o, true);
      }, 250);
    });
    q('.o-scout').addEventListener('click', () => pingScout(o, false));
    statusLine(o, q('.o-status'));
    scoutLine(o, q('.o-scout-status'));
    o._el = el;
    host.appendChild(el);
  }
  app.dirty();
}

function statusLine(o, node) {
  const p = o.parsed;
  if (!o.text.trim()) { node.textContent = o.els.length ? 'No ephemeris pasted. Track comes from Scout orbit samples.' : ''; return; }
  if (!p.rows.length) { node.innerHTML = `<span class="err">${escapeHtml(p.notes[0] || 'Could not read this.')}</span>`; return; }
  const r = p.rows;
  const bits = [`${p.format}`, `${r.length} positions`, `${fmtUTC(r[0].t).slice(0, 16)} → ${fmtUTC(r[r.length - 1].t).slice(0, 16)}`];
  if (p.site) bits.push(`topocentric (${escapeHtml(p.site.name)})`);
  node.innerHTML = bits.join(' · ') + p.notes.map(n => `<br>${escapeHtml(n)}`).join('');
}

function scoutLine(o, node) {
  const s = o.scout;
  if (!s) { node.textContent = ''; return; }
  if (s.status === 'loading') node.textContent = 'Asking JPL Scout…';
  else if (s.status === 'ok') {
    const n = o.els.length;
    node.innerHTML = `<span class="ok">Scout: ${n} orbit samples</span> via ${escapeHtml(s.source)}${s.fetched ? ' (' + escapeHtml(s.fetched.replace('T', ' ').replace(/\..*|Z/, '')) + ' UTC)' : ''} · <a href="${scoutPage(o.name)}" target="_blank" rel="noopener">open in Scout</a>`;
  } else if (s.status === 'missing') node.textContent = s.note || 'Not on Scout.';
  else node.innerHTML = `<span class="err">${escapeHtml(s.note || 'Scout error')}</span>`;
}

const pinged = new WeakMap();
async function pingScout(o, auto) {
  const name = o.name.trim();
  if (!name) { toast('Give the object a name first.'); return; }
  if (auto && pinged.get(o) === name) return;
  pinged.set(o, name);
  o.scout = { status: 'loading' };
  if (o._el) scoutLine(o, o._el.querySelector('.o-scout-status'));
  const res = await lookup(name, state.proxy);
  if (o.name.trim() !== name) return; // renamed meanwhile
  setScout(o, res);
  if (o._el) { scoutLine(o, o._el.querySelector('.o-scout-status')); statusLine(o, o._el.querySelector('.o-status')); }
  updateRange();
  if (res.status === 'ok' && !hasRows(o)) { chart.fit(state.objects); }
  app.dirty();
}

$('#btn-add').addEventListener('click', () => { addObject({}); const ta = $('#objects .obj:last-child .o-text'); ta && ta.focus(); });
$('#btn-sample').addEventListener('click', loadSample);
async function loadSample() {
  const text = await (await fetch(SAMPLE.file)).text();
  const o = addObject({ text, discCode: SAMPLE.disc, discTime: SAMPLE.discTime });
  setTime(SAMPLE.discTime);
  chart.fit(state.objects);
  return o;
}

async function loadScoutList() {
  const sel = $('#scout-list');
  try {
    const idx = await snapshotIndex();
    const rows = [...idx.objects].sort((a, b) => (b.neoScore || 0) - (a.neoScore || 0));
    sel.innerHTML = `<option value="">choose one (${rows.length} on the list)…</option>` + rows.map(r =>
      `<option value="${escapeHtml(r.objectName)}">${escapeHtml(r.objectName)} · NEO ${r.neoScore}% · V ${r.Vmag ?? '?'} · ${r.nObs} obs</option>`).join('');
    $('#scout-stamp').textContent = `Scout snapshot from ${idx.fetched.replace('T', ' ').replace('Z', ' UTC')}. Refreshed hourly.`;
  } catch {
    sel.innerHTML = '<option value="">Scout snapshot not available</option>';
  }
}
$('#scout-list').addEventListener('change', e => {
  const name = e.target.value;
  if (!name) return;
  addObject({ name });
  e.target.value = '';
  setTime(Date.now());
});

// ---------------- your location ----------------
function renderYou() {
  $('#you-lat').value = state.you.lat;
  $('#you-lon').value = state.you.lon;
  $('#you-h').value = state.you.h;
  $('#you-code').value = state.you.code || '';
  $('#you-label').textContent = state.you.label || '';
}
function saveYou(label) {
  if (label !== undefined) state.you.label = label;
  store.set('you', state.you);
  $('#you-label').textContent = state.you.label;
  app.dirty();
}
for (const id of ['you-lat', 'you-lon', 'you-h']) {
  $('#' + id).addEventListener('change', () => {
    state.you.lat = parseFloat($('#you-lat').value);
    state.you.lon = parseFloat($('#you-lon').value);
    state.you.h = parseFloat($('#you-h').value) || 0;
    state.you.code = '';
    $('#you-code').value = '';
    saveYou('Custom location');
  });
}
$('#you-code').addEventListener('change', e => {
  const code = e.target.value.trim().toUpperCase();
  const s = siteFromCode(code);
  if (!s) { toast(`Unknown or non-fixed MPC code "${code}".`); return; }
  Object.assign(state.you, { lat: s.site.lat, lon: s.site.lon, h: s.site.h, code });
  renderYou(); saveYou(s.label);
});
$('#btn-geo').addEventListener('click', () => {
  if (!navigator.geolocation) { toast('Your browser does not share location.'); return; }
  navigator.geolocation.getCurrentPosition(p => {
    Object.assign(state.you, { lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4), h: Math.round(p.coords.altitude || 0), code: '' });
    renderYou(); saveYou('Your location (browser)');
  }, err => toast('Location not available: ' + err.message), { timeout: 10000 });
});
$('#proxy').value = state.proxy;
$('#proxy').addEventListener('change', e => { state.proxy = e.target.value.trim(); store.set('proxy', state.proxy); });

// ---------------- panels ----------------
document.querySelectorAll('.panel .max').forEach(b => b.addEventListener('click', () => {
  const p = b.closest('.panel'), host = $('#panels');
  const big = !p.classList.contains('big');
  document.querySelectorAll('.panel').forEach(x => x.classList.remove('big'));
  p.classList.toggle('big', big);
  host.classList.toggle('one', big);
  b.textContent = big ? '⤡' : '⤢';
}));
$('#btn-fit').addEventListener('click', () => chart.fit(state.objects));
$('#btn-top').addEventListener('click', () => { space.pitch = Math.PI / 2; space.yaw = -Math.PI / 2; app.dirty(); });
$('#btn-side').addEventListener('click', () => { space.pitch = 0.02; app.dirty(); });
$('#btn-centre').addEventListener('click', e => {
  space.center = space.center === 'sun' ? 'earth' : 'sun';
  e.target.textContent = 'Centre: ' + (space.center === 'sun' ? 'Sun' : 'Earth');
  if (space.center === 'earth') space.scale = Math.max(space.scale, 1500);
  app.dirty();
});
$('#btn-help').addEventListener('click', () => $('#help').showModal());

// ---------------- share links ----------------
async function pack(obj) {
  const stream = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function unpack(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(stream).text());
}
$('#btn-share').addEventListener('click', async () => {
  // Your own location is left out on purpose.
  const data = { v: 1, t: Math.round(state.time), o: state.objects.map(o => ({ n: o.name, c: o.color, x: o.text, d: o.discCode, dt: o.discTime, h: o.visible ? 0 : 1 })) };
  const url = location.origin + location.pathname + '#s=' + await pack(data);
  history.replaceState(null, '', url);
  try { await navigator.clipboard.writeText(url); toast(url.length > 8000 ? 'Link copied (it is long: big ephemerides make long links).' : 'Share link copied.'); }
  catch { toast('Link is in the address bar.'); }
});

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

// ---------------- boot ----------------
async function boot() {
  renderYou();
  const [stars, lines, codes] = await Promise.all([
    fetch('data/stars.json').then(r => r.json()),
    fetch('data/constellations.json').then(r => r.json()),
    fetch('data/obscodes.json').then(r => r.json()),
  ]);
  state.stars = stars.map(([ra, dec, mag, bv]) => ({ u: radecToVec(ra, dec), mag, bv }));
  state.constellations = lines.map(l => l.map(([ra, dec]) => radecToVec(ra, dec)));
  state.obscodes = codes;
  $('#obscode-list').innerHTML = Object.entries(codes).map(([k, v]) => `<option value="${k}">${escapeHtml(v[0])}</option>`).join('');
  loadScoutList();

  const m = location.hash.match(/#s=([A-Za-z0-9_-]+)/);
  if (m) {
    try {
      const data = await unpack(m[1]);
      for (const x of data.o) {
        const o = addObject({ name: x.n, color: x.c, text: x.x, discCode: x.d, discTime: x.dt }, { activate: false });
        o.visible = !x.h;
      }
      state.active = state.objects[0] || null;
      renderObjects();
      updateRange();
      setTime(data.t);
      chart.fit(state.objects);
    } catch (e) {
      toast('Could not read the shared link.');
      console.error(e);
    }
  } else {
    await loadSample();
  }
  requestAnimationFrame(frame);
}
renderObjects();
boot();

// handy for debugging in the console
window.ephemeral = { state, chart, space, helioArc };
