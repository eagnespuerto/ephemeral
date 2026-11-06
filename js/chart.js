// Zoomable RA/Dec chart (gnomonic projection). Drag to pan, wheel to zoom.
import { CanvasView, starColor } from './canvas.js';
import { vecToRadec, radecToVec, fmtRA, fmtDec, D2R, R2D } from './astro.js';
import { geoTrack, topoTrack, at, scoutCloud } from './model.js';

const NICE = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 45];

export class ChartView {
  constructor(canvas, app) {
    this.app = app;
    this.fitObjs = null; this.userMoved = false;
    this.view = new CanvasView(canvas, () => { if (this.fitObjs && !this.userMoved) this.fit(this.fitObjs); app.dirty(); });
    this.ra0 = 0; this.dec0 = 0; this.scale = 300; // px per radian
    this.hover = null;
    this.drag = null;
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      this.drag = { p: this.view.pointer(e), ra0: this.ra0, dec0: this.dec0 };
      this.userMoved = true;
    });
    canvas.addEventListener('pointermove', e => {
      const p = this.view.pointer(e);
      this.hover = p;
      if (this.drag) {
        const { w, h } = this.view;
        const q = this.unproject(w / 2 - (p[0] - this.drag.p[0]), h / 2 - (p[1] - this.drag.p[1]), this.drag.ra0, this.drag.dec0);
        if (q) { this.ra0 = q.ra; this.dec0 = Math.max(-89.9, Math.min(89.9, q.dec)); }
      }
      app.dirty();
    });
    canvas.addEventListener('pointerup', () => { this.drag = null; });
    canvas.addEventListener('pointerleave', () => { this.hover = null; app.dirty(); });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const m = this.view.pointer(e);
      this.zoomAt(m, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
  }

  zoomAt(m, f) {
    this.userMoved = true;
    const before = this.unproject(m[0], m[1]);
    this.scale = Math.max(40, Math.min(5e7, this.scale * f));
    if (before) {
      const after = this.project(radecToVec(before.ra, before.dec));
      if (after) {
        const { w, h } = this.view;
        const q = this.unproject(w / 2 + (after[0] - m[0]), h / 2 + (after[1] - m[1]));
        if (q) { this.ra0 = q.ra; this.dec0 = Math.max(-89.9, Math.min(89.9, q.dec)); }
      }
    }
    this.app.dirty();
  }

  // unit-ish vector -> screen
  project(v, ra0 = this.ra0, dec0 = this.dec0) {
    const { ra, dec } = vecToRadec(v);
    const a = (ra - ra0) * D2R, d = dec * D2R, d0 = dec0 * D2R;
    const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a);
    if (cosc < 0.15) return null;
    const x = Math.cos(d) * Math.sin(a) / cosc;
    const y = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a)) / cosc;
    return [this.view.w / 2 - x * this.scale, this.view.h / 2 - y * this.scale];
  }

  unproject(X, Y, ra0 = this.ra0, dec0 = this.dec0) {
    const x = (this.view.w / 2 - X) / this.scale, y = (this.view.h / 2 - Y) / this.scale;
    const rho = Math.hypot(x, y);
    if (rho === 0) return { ra: ra0, dec: dec0 };
    const c = Math.atan(rho), d0 = dec0 * D2R;
    const dec = Math.asin(Math.cos(c) * Math.sin(d0) + (y * Math.sin(c) * Math.cos(d0)) / rho) * R2D;
    let ra = ra0 + Math.atan2(x * Math.sin(c), rho * Math.cos(d0) * Math.cos(c) - y * Math.sin(d0) * Math.sin(c)) * R2D;
    ra = ((ra % 360) + 360) % 360;
    return { ra, dec };
  }

  fit(objects) {
    this.fitObjs = objects; this.userMoved = false;
    if (this.view.w < 60 || this.view.h < 60) return;
    const vs = [];
    for (const o of objects) if (o.visible) for (const p of geoTrack(o)) vs.push(p.v);
    if (!vs.length) return;
    const m = [0, 0, 0];
    for (const v of vs) { const n = Math.hypot(...v); m[0] += v[0] / n; m[1] += v[1] / n; m[2] += v[2] / n; }
    const c = vecToRadec(m);
    this.ra0 = c.ra; this.dec0 = c.dec;
    let maxAng = 0.5 * D2R;
    const cu = radecToVec(c.ra, c.dec);
    for (const v of vs) {
      const n = Math.hypot(...v);
      const dot = (v[0] * cu[0] + v[1] * cu[1] + v[2] * cu[2]) / n;
      maxAng = Math.max(maxAng, Math.acos(Math.min(1, dot)));
    }
    maxAng = Math.min(maxAng * 1.08, 65 * D2R);
    this.scale = Math.max(40, (Math.min(this.view.w, this.view.h) / 2 - 24) / Math.tan(maxAng));
    this.app.dirty();
  }

  fovDeg() { return 2 * Math.atan(Math.min(this.view.w, this.view.h) / 2 / this.scale) * R2D; }

  draw() {
    const s = this.app.state;
    const v = this.view;
    const c = v.begin('#060912');
    const { w, h } = v;
    const fov = this.fovDeg();

    // grid
    const decStep = NICE.find(n => n >= fov / 6) || 45;
    const raStep = Math.min(45, NICE.find(n => n >= fov / 6 / Math.max(0.15, Math.cos(this.dec0 * D2R))) || 45);
    c.strokeStyle = 'rgba(120,150,210,0.16)'; c.lineWidth = 1;
    c.fillStyle = 'rgba(160,180,220,0.6)'; c.font = '10px ui-monospace, monospace';
    const span = Math.min(90, fov * 1.6);
    const dLo = Math.max(-90, this.dec0 - span), dHi = Math.min(90, this.dec0 + span);
    const raSpan = Math.min(180, span / Math.max(0.05, Math.cos(Math.min(85, Math.abs(this.dec0) + span) * D2R)));
    const sampleN = 80;
    for (let d = Math.ceil(dLo / decStep) * decStep; d <= dHi; d += decStep) {
      c.beginPath(); let pen = false;
      for (let k = 0; k <= sampleN; k++) {
        const ra = this.ra0 - raSpan + (2 * raSpan * k) / sampleN;
        const p = this.project(radecToVec(ra, d));
        if (p) { pen ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); pen = true; } else pen = false;
      }
      c.stroke();
      const lp = this.project(radecToVec(this.ra0, d));
      if (lp && lp[1] > 12 && lp[1] < h - 4) { c.textAlign = 'left'; c.fillText(fmtDecShort(d, decStep), 4, lp[1] - 2); }
    }
    for (let ra = Math.ceil((this.ra0 - raSpan) / raStep) * raStep; ra <= this.ra0 + raSpan; ra += raStep) {
      c.beginPath(); let pen = false;
      for (let k = 0; k <= sampleN; k++) {
        const d = dLo + ((dHi - dLo) * k) / sampleN;
        const p = this.project(radecToVec(ra, d));
        if (p) { pen ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); pen = true; } else pen = false;
      }
      c.stroke();
      const lp = this.project(radecToVec(ra, this.dec0));
      if (lp && lp[0] > 20 && lp[0] < w - 20) { c.textAlign = 'center'; c.fillText(fmtRAShort(ra, raStep), lp[0], h - 5); }
    }

    // constellations + stars
    c.strokeStyle = 'rgba(120,150,210,0.22)';
    c.beginPath();
    for (const line of s.constellations) {
      let prev = null;
      for (const u of line) {
        const p = this.project(u);
        if (p && prev) { c.moveTo(prev[0], prev[1]); c.lineTo(p[0], p[1]); }
        prev = p;
      }
    }
    c.stroke();
    const magBoost = Math.max(0, Math.log10(60 / Math.max(fov, 0.01)));
    const magLimit = fov > 90 ? 4.5 : fov > 40 ? 5.3 : 6.5;
    for (const st of s.stars) {
      if (st.mag > magLimit) break;
      const p = this.project(st.u);
      if (!p || p[0] < -5 || p[0] > w + 5 || p[1] < -5 || p[1] > h + 5) continue;
      const rr = Math.max(0.6, (6.5 - st.mag) * 0.45 + magBoost * 0.6);
      const [cr, cg, cb] = starColor(st.bv);
      c.fillStyle = `rgb(${cr | 0},${cg | 0},${cb | 0})`;
      c.beginPath(); c.arc(p[0], p[1], rr, 0, 2 * Math.PI); c.fill();
    }

    // objects
    const hits = [];
    const pov = this.app.povSites();
    for (const o of s.objects) {
      if (!o.visible) continue;
      const tr = geoTrack(o);
      this.drawTrack(c, tr, o.color, [], 1.8, hits, o, 'geocentre');
      if (tr.some(p => p.dist)) {
        for (const ps of pov) {
          const tt = topoTrack(o, ps.site, ps.key);
          this.drawTrack(c, tt, o.color, ps.dash, 1, hits, o, ps.label, 0.6);
        }
      }
      // ticks + labels
      this.drawTicks(c, tr, o.color);
      for (const u of scoutCloud(o, s.time, null)) {
        const p = this.project(u);
        if (!p) continue;
        c.fillStyle = o.color; c.globalAlpha = 0.5;
        c.beginPath(); c.arc(p[0], p[1], 1.6, 0, 2 * Math.PI); c.fill();
      }
      c.globalAlpha = 1;
      const cur = at(tr, s.time);
      if (cur) {
        const p = this.project(cur.v);
        if (p) {
          c.fillStyle = o.color; c.strokeStyle = '#fff'; c.lineWidth = 1.5;
          c.beginPath(); c.arc(p[0], p[1], o === s.active ? 6 : 4.5, 0, 2 * Math.PI); c.fill(); c.stroke();
          c.fillStyle = '#fff'; c.font = '600 11px system-ui'; c.textAlign = 'left';
          c.fillText(o.name || 'object', p[0] + 9, p[1] - 7);
        }
      }
    }

    // FOV scale label
    c.fillStyle = 'rgba(160,180,220,0.7)'; c.font = '10px system-ui'; c.textAlign = 'right';
    c.fillText(`field ≈ ${fov >= 1 ? fov.toFixed(1) + '°' : (fov * 60).toFixed(1) + '′'} · N up, E left`, w - 6, 13);

    if (this.hover && hits.length && !this.drag) {
      let best = null, bd = 10;
      for (const hh of hits) {
        const d = Math.hypot(hh.q[0] - this.hover[0], hh.q[1] - this.hover[1]);
        if (d < bd) { bd = d; best = hh; }
      }
      if (best) {
        const rd = vecToRadec(best.p.v);
        this.app.tooltip(v.canvas, this.hover, [
          `${best.o.name || 'object'} · ${best.label}`,
          new Date(best.p.t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
          `${fmtRA(rd.ra)}  ${fmtDec(rd.dec)}`,
          best.p.dist ? `Δ = ${rd.dist.toFixed(5)} au` : '',
          best.p.mag != null ? `mag ${best.p.mag}` : '',
        ].filter(Boolean));
      }
    }
  }

  drawTrack(c, tr, color, dash, width, hits, o, label, alpha = 1) {
    c.strokeStyle = color; c.lineWidth = width; c.setLineDash(dash); c.globalAlpha = alpha;
    c.beginPath(); let pen = false;
    for (const p of tr) {
      const q = this.project(p.v);
      if (q) { pen ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); pen = true; hits.push({ q, p, o, label }); } else pen = false;
    }
    c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
  }

  drawTicks(c, tr, color) {
    if (tr.length < 2) return;
    let lastLabel = null;
    c.font = '10px system-ui'; c.textAlign = 'left';
    for (let i = 0; i < tr.length; i++) {
      const p = tr[i];
      const d = new Date(p.t);
      const isDay = d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
      const q = this.project(p.v);
      if (!q) continue;
      c.fillStyle = color;
      c.beginPath(); c.arc(q[0], q[1], isDay ? 2.4 : 1.3, 0, 2 * Math.PI); c.fill();
      if (isDay && (!lastLabel || Math.hypot(q[0] - lastLabel[0], q[1] - lastLabel[1]) > 46)) {
        c.fillStyle = 'rgba(220,225,240,0.75)';
        c.fillText(d.toISOString().slice(5, 10), q[0] + 5, q[1] + 12);
        lastLabel = q;
      }
    }
  }
}

function fmtDecShort(d, step) {
  if (step >= 1) return `${d > 0 ? '+' : ''}${Math.round(d)}°`;
  if (step >= 1 / 60) return `${d < 0 ? '−' : '+'}${Math.floor(Math.abs(d) + 1e-9)}°${String(Math.round((Math.abs(d) % 1) * 60)).padStart(2, '0')}′`;
  return `${d.toFixed(3)}°`;
}
function fmtRAShort(ra, step) {
  ra = ((ra % 360) + 360) % 360;
  const hrs = ra / 15;
  if (step >= 15) return `${Math.round(hrs)}h`;
  const hh = Math.floor(hrs + 1e-9), mm = (hrs - hh) * 60;
  if (step >= 0.25) return `${hh}h${String(Math.round(mm)).padStart(2, '0')}m`;
  return `${hh}h${mm.toFixed(1)}m`;
}
