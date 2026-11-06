// All-sky dome as seen from one site: zenith in the centre, north up, east left.
import { CanvasView, starColor } from './canvas.js';
import { horRotation, toAltAz, bodyGeo, siteVec, sub, airmass, moonPhase, D2R } from './astro.js';
import { topoTrack, at, scoutCloud } from './model.js';

const Z_MAX = 102; // draw a little below the horizon

export function skyState(sunAlt) {
  if (sunAlt > -0.833) return 'day';
  if (sunAlt > -6) return 'civil twilight';
  if (sunAlt > -12) return 'nautical twilight';
  if (sunAlt > -18) return 'astronomical twilight';
  return 'night';
}

function skyColour(sunAlt) {
  const stops = [[-18, [6, 9, 20]], [-12, [12, 20, 45]], [-6, [28, 45, 90]], [0, [70, 110, 170]], [10, [95, 150, 215]]];
  if (sunAlt <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (sunAlt <= stops[i][0]) {
      const [a0, c0] = stops[i - 1], [a1, c1] = stops[i];
      const f = (sunAlt - a0) / (a1 - a0);
      return c0.map((v, k) => Math.round(v + (c1[k] - v) * f));
    }
  }
  return stops[stops.length - 1][1];
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = az => COMPASS[Math.round(az / 45) % 8];

export class DomeView {
  constructor(canvas, app, getSite) {
    this.view = new CanvasView(canvas, () => app.dirty());
    this.app = app;
    this.getSite = getSite; // () => { site, key, label } | null
    this.hover = null;
    canvas.addEventListener('mousemove', e => { this.hover = this.view.pointer(e); app.dirty(); });
    canvas.addEventListener('mouseleave', () => { this.hover = null; app.dirty(); });
  }

  geom() {
    const { w, h } = this.view;
    const rMax = Math.min(w, h) / 2 - 6;
    const R = rMax / Math.tan((Z_MAX / 2) * D2R);
    return { cx: w / 2, cy: h / 2, R, rMax };
  }

  proj(g, alt, az) {
    const z = 90 - alt;
    if (z > Z_MAX) return null;
    const r = g.R * Math.tan((z / 2) * D2R);
    return [g.cx - r * Math.sin(az * D2R), g.cy - r * Math.cos(az * D2R)];
  }

  draw() {
    const s = this.app.state;
    const sel = this.getSite();
    const v = this.view;
    if (v.w < 40 || v.h < 40) return null; // hidden panel
    if (!sel) {
      v.begin('#070a14');
      v.message(this.emptyText || 'Set a site to see this view.');
      return null;
    }
    const { site, key } = sel;
    const ms = s.time;
    const rot = horRotation(ms, site);
    const sv = siteVec(ms, site);
    const sunH = toAltAz(rot, sub(bodyGeo('Sun', ms), sv));
    const moonH = toAltAz(rot, sub(bodyGeo('Moon', ms), sv));
    const g = this.geom();
    const c = v.begin('#05070d');
    const daylight = Math.max(0, Math.min(1, (sunH.alt + 12) / 12));

    // sky disc + ground ring
    const [r0, g0, b0] = skyColour(sunH.alt);
    const grad = c.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, g.R);
    grad.addColorStop(0, `rgb(${r0 * 0.75 | 0},${g0 * 0.75 | 0},${b0 * 0.8 | 0})`);
    grad.addColorStop(1, `rgb(${r0},${g0},${b0})`);
    c.fillStyle = '#16120e';
    c.beginPath(); c.arc(g.cx, g.cy, g.rMax, 0, 2 * Math.PI); c.fill();
    c.fillStyle = grad;
    c.beginPath(); c.arc(g.cx, g.cy, g.R, 0, 2 * Math.PI); c.fill();

    c.save();
    c.beginPath(); c.arc(g.cx, g.cy, g.rMax, 0, 2 * Math.PI); c.clip();

    // alt/az grid
    c.strokeStyle = 'rgba(160,180,220,0.13)';
    c.lineWidth = 1;
    for (const alt of [30, 60]) {
      const r = g.R * Math.tan(((90 - alt) / 2) * D2R);
      c.beginPath(); c.arc(g.cx, g.cy, r, 0, 2 * Math.PI); c.stroke();
    }
    for (let az = 0; az < 360; az += 45) {
      const p = this.proj(g, 0, az);
      c.beginPath(); c.moveTo(g.cx, g.cy); c.lineTo(p[0], p[1]); c.stroke();
    }

    // constellations
    c.strokeStyle = `rgba(120,150,210,${0.28 * (1 - daylight)})`;
    if (daylight < 1) {
      c.beginPath();
      for (const line of s.constellations) {
        let prev = null;
        for (const u of line) {
          const h = toAltAz(rot, u);
          const p = h.alt > -12 ? this.proj(g, h.alt, h.az) : null;
          if (p && prev) { c.moveTo(prev[0], prev[1]); c.lineTo(p[0], p[1]); }
          prev = p;
        }
      }
      c.stroke();
    }

    // stars
    const limit = 6 - daylight * 5.5;
    for (const st of s.stars) {
      if (st.mag > limit) break;
      const h = toAltAz(rot, st.u);
      if (h.alt < -12) continue;
      const p = this.proj(g, h.alt, h.az);
      if (!p) continue;
      const rr = Math.max(0.5, (6.3 - st.mag) * 0.42) * (g.R / 260 + 0.45);
      const [cr, cg, cb] = starColor(st.bv);
      c.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${(h.alt < 0 ? 0.35 : 0.95) * (1 - daylight * 0.6)})`;
      c.beginPath(); c.arc(p[0], p[1], rr, 0, 2 * Math.PI); c.fill();
    }

    // horizon line
    c.strokeStyle = 'rgba(230,200,150,0.55)';
    c.lineWidth = 1.5;
    c.beginPath(); c.arc(g.cx, g.cy, g.R, 0, 2 * Math.PI); c.stroke();

    // Sun & Moon
    const sp = this.proj(g, sunH.alt, sunH.az);
    if (sp) { c.fillStyle = '#ffd34d'; c.beginPath(); c.arc(sp[0], sp[1], 7, 0, 2 * Math.PI); c.fill(); }
    const mp = this.proj(g, moonH.alt, moonH.az);
    if (mp) {
      const ph = moonPhase(ms);
      const lit = (1 - Math.cos(ph * D2R)) / 2;
      c.fillStyle = `rgba(230,230,215,${0.35 + 0.65 * lit})`;
      c.beginPath(); c.arc(mp[0], mp[1], 5.5, 0, 2 * Math.PI); c.fill();
      c.fillStyle = 'rgba(230,230,215,0.8)'; c.font = '10px system-ui'; c.textAlign = 'left';
      c.fillText(`Moon ${Math.round(lit * 100)}%`, mp[0] + 8, mp[1] + 3);
    }

    // objects
    let activeInfo = null;
    const hoverHits = [];
    for (const o of s.objects) {
      if (!o.visible) continue;
      const tr = topoTrack(o, site, key);
      if (tr.length) {
        c.strokeStyle = o.color; c.lineWidth = 1.6;
        c.setLineDash([]);
        let prev = null;
        for (const p of tr) {
          const h = toAltAz(rot, p.v);
          const q = h.alt > -12 ? this.proj(g, h.alt, h.az) : null;
          if (q && prev) {
            c.globalAlpha = h.alt < 0 ? 0.3 : 0.75;
            c.beginPath(); c.moveTo(prev[0], prev[1]); c.lineTo(q[0], q[1]); c.stroke();
          }
          if (q) hoverHits.push({ q, o, p, h });
          prev = q;
        }
        c.globalAlpha = 1;
      }
      // Scout cloud
      for (const u of scoutCloud(o, ms, site)) {
        const h = toAltAz(rot, u);
        const q = h.alt > -12 && this.proj(g, h.alt, h.az);
        if (!q) continue;
        c.fillStyle = o.color; c.globalAlpha = 0.45;
        c.fillRect(q[0] - 1, q[1] - 1, 2, 2);
      }
      c.globalAlpha = 1;
      const cur = at(tr, ms);
      if (cur) {
        const h = toAltAz(rot, cur.v);
        const q = this.proj(g, h.alt, h.az);
        if (q) {
          c.fillStyle = o.color; c.strokeStyle = '#fff'; c.lineWidth = 1.5;
          c.beginPath(); c.arc(q[0], q[1], o === s.active ? 6 : 4.5, 0, 2 * Math.PI); c.fill(); c.stroke();
          c.fillStyle = '#fff'; c.font = '600 11px system-ui'; c.textAlign = 'left';
          c.fillText(o.name || 'object', q[0] + 9, q[1] - 7);
        }
        if (o === s.active) activeInfo = { ...h, dist: cur.dist ? Math.hypot(...cur.v) : null };
      }
    }
    c.restore();

    // compass labels
    c.fillStyle = 'rgba(240,220,180,0.9)'; c.font = '600 12px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const [lab, az] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
      const r = (g.R + g.rMax) / 2;
      c.fillText(lab, g.cx - r * Math.sin(az * D2R), g.cy - r * Math.cos(az * D2R));
    }
    c.textBaseline = 'alphabetic';

    // hover tooltip
    if (this.hover && hoverHits.length) {
      let best = null, bd = 12;
      for (const hh of hoverHits) {
        const d = Math.hypot(hh.q[0] - this.hover[0], hh.q[1] - this.hover[1]);
        if (d < bd) { bd = d; best = hh; }
      }
      if (best) this.app.tooltip(this.view.canvas, this.hover, [
        best.o.name || 'object',
        new Date(best.p.t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
        `alt ${best.h.alt.toFixed(1)}°  az ${best.h.az.toFixed(1)}°`,
        '(track drawn against tonight\'s sky)',
      ]);
    }
    return { sun: sunH, moon: moonH, active: activeInfo };
  }
}

export function describe(info) {
  if (!info) return '';
  const parts = [];
  parts.push(`Sun ${info.sun.alt.toFixed(0)}° · ${skyState(info.sun.alt)}`);
  if (info.active) {
    const a = info.active;
    if (a.alt > 0) parts.unshift(`<b>alt ${a.alt.toFixed(1)}°</b> az ${a.az.toFixed(0)}° ${compass(a.az)} · airmass ${airmass(a.alt).toFixed(2)}`);
    else parts.unshift(`<b>below horizon</b> (alt ${a.alt.toFixed(1)}°)`);
  }
  return parts.join(' · ');
}
