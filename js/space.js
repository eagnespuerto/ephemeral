// Space View: heliocentric ecliptic scene. Drag to orbit the camera, wheel to zoom.
import { CanvasView } from './canvas.js';
import { helio, eqjToEcl, orbitPath, D2R, sub, norm } from './astro.js';
import { helioArc, at, scoutHelioAt, hasRows } from './model.js';

const PLANETS = [
  ['Mercury', 87.97, '#b0a89c'], ['Venus', 224.7, '#e8cf9a'], ['Earth', 365.256, '#5ec8ff'],
  ['Mars', 686.98, '#ff7b54'], ['Jupiter', 4332.6, '#d9b38c'], ['Saturn', 10759, '#e6d29a'],
  ['Uranus', 30687, '#9fe3e8'], ['Neptune', 60190, '#7d9dff'],
];

export class SpaceView {
  constructor(canvas, app) {
    this.view = new CanvasView(canvas, () => app.dirty());
    this.app = app;
    this.yaw = -90 * D2R; this.pitch = 62 * D2R; this.scale = 150; this.center = 'sun';
    this.paths = null;
    this.drag = null;
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      this.drag = { p: this.view.pointer(e), yaw: this.yaw, pitch: this.pitch };
    });
    canvas.addEventListener('pointermove', e => {
      if (!this.drag) return;
      const p = this.view.pointer(e);
      this.yaw = this.drag.yaw + (p[0] - this.drag.p[0]) * 0.008;
      this.pitch = Math.max(-90 * D2R, Math.min(90 * D2R, this.drag.pitch + (p[1] - this.drag.p[1]) * 0.008));
      app.dirty();
    });
    canvas.addEventListener('pointerup', () => { this.drag = null; });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.scale = Math.max(2, Math.min(5e5, this.scale * Math.exp(-e.deltaY * 0.0015)));
      app.dirty();
    }, { passive: false });
  }

  planetPaths() {
    if (this.paths) return this.paths;
    const now = Date.now();
    this.paths = PLANETS.map(([name, period]) => {
      const pts = [];
      const n = 160;
      for (let k = 0; k <= n; k++) pts.push(eqjToEcl(helio(name, now + (k / n) * period * 864e5)));
      return pts;
    });
    return this.paths;
  }

  proj(v, origin) {
    const x = v[0] - origin[0], y = v[1] - origin[1], z = v[2] - origin[2];
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const x1 = x * cy - y * sy, y1 = x * sy + y * cy;
    const sp = Math.sin(this.pitch), cp = Math.cos(this.pitch);
    return [this.view.w / 2 + x1 * this.scale, this.view.h / 2 - (y1 * sp + z * cp) * this.scale, y1 * cp - z * sp];
  }

  poly(c, pts, origin) {
    c.beginPath();
    pts.forEach((p, i) => { const q = this.proj(p, origin); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); });
    c.stroke();
  }

  draw() {
    const s = this.app.state;
    const ms = s.time;
    const c = this.view.begin('#04060c');
    const earth = eqjToEcl(helio('Earth', ms));
    const origin = this.center === 'earth' ? earth : [0, 0, 0];

    // ecliptic rings
    c.strokeStyle = 'rgba(120,150,210,0.12)'; c.lineWidth = 1;
    c.fillStyle = 'rgba(140,160,200,0.45)'; c.font = '10px system-ui'; c.textAlign = 'left';
    const viewR = Math.max(this.view.w, this.view.h) / this.scale;
    const ringStep = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20].find(r => r >= viewR / 8) || 20;
    for (let r = ringStep; r <= viewR * 1.2; r += ringStep) {
      const pts = [];
      for (let k = 0; k <= 96; k++) { const a = (k / 96) * 2 * Math.PI; pts.push([origin[0] + r * Math.cos(a), origin[1] + r * Math.sin(a), origin[2] * 0]); }
      this.poly(c, pts, origin);
    }
    // vernal equinox direction
    const vq0 = this.proj(origin, origin), vq = this.proj([origin[0] + ringStep * 2, origin[1], origin[2]], origin);
    c.strokeStyle = 'rgba(160,180,220,0.3)'; c.setLineDash([3, 4]);
    c.beginPath(); c.moveTo(vq0[0], vq0[1]); c.lineTo(vq[0], vq[1]); c.stroke(); c.setLineDash([]);
    c.fillText('γ  vernal equinox', vq[0] + 4, vq[1] - 4);

    // planets
    const paths = this.planetPaths();
    PLANETS.forEach(([name, , col], i) => {
      c.strokeStyle = col; c.globalAlpha = 0.35; c.lineWidth = 1;
      this.poly(c, paths[i], origin);
      c.globalAlpha = 1;
      const p = name === 'Earth' ? earth : eqjToEcl(helio(name, ms));
      const q = this.proj(p, origin);
      c.fillStyle = col;
      c.beginPath(); c.arc(q[0], q[1], name === 'Earth' ? 4.5 : 3.5, 0, 2 * Math.PI); c.fill();
      c.fillStyle = 'rgba(220,225,240,0.8)';
      c.fillText(name, q[0] + 6, q[1] - 5);
    });
    // Moon around Earth when zoomed in
    if (this.scale > 3000) {
      const m = eqjToEcl(helio('Moon', ms));
      const q = this.proj(m, origin);
      c.fillStyle = '#ddd'; c.beginPath(); c.arc(q[0], q[1], 2.5, 0, 2 * Math.PI); c.fill();
      c.fillText('Moon', q[0] + 5, q[1] - 4);
    }
    // Sun
    const sq = this.proj([0, 0, 0], origin);
    const g = c.createRadialGradient(sq[0], sq[1], 0, sq[0], sq[1], 14);
    g.addColorStop(0, '#fff6c0'); g.addColorStop(0.4, '#ffd34d'); g.addColorStop(1, 'rgba(255,180,40,0)');
    c.fillStyle = g; c.beginPath(); c.arc(sq[0], sq[1], 14, 0, 2 * Math.PI); c.fill();

    // objects
    for (const o of s.objects) {
      if (!o.visible) continue;
      // Scout sample orbits + positions
      if (o.els.length) {
        if (!o._paths) o._paths = o.els.slice(0, 30).map(el => orbitPath(el, 200, 40));
        c.strokeStyle = o.color; c.globalAlpha = 0.12; c.lineWidth = 1;
        for (const p of o._paths) this.poly(c, p, origin);
        c.globalAlpha = 0.7; c.fillStyle = o.color;
        for (const p of scoutHelioAt(o, ms)) { const q = this.proj(p, origin); c.fillRect(q[0] - 1, q[1] - 1, 2, 2); }
        c.globalAlpha = 1;
      }
      const arc = hasRows(o) ? helioArc(o) : [];
      if (arc.length) {
        c.strokeStyle = o.color; c.lineWidth = 2;
        this.poly(c, arc.map(p => p.v), origin);
      }
      let cur = arc.length ? at(arc.map(p => ({ ...p, dist: true })), ms) : null;
      if (!cur && !arc.length && o.els.length) cur = { v: scoutHelioAt(o, ms)[0] };
      if (cur) {
        const q = this.proj(cur.v, origin);
        // drop line to the ecliptic plane
        const foot = this.proj([cur.v[0], cur.v[1], 0], origin);
        c.strokeStyle = o.color; c.globalAlpha = 0.5; c.setLineDash([2, 3]);
        c.beginPath(); c.moveTo(q[0], q[1]); c.lineTo(foot[0], foot[1]); c.stroke();
        // line of sight from Earth
        const eq = this.proj(earth, origin);
        c.strokeStyle = 'rgba(94,200,255,0.5)';
        c.beginPath(); c.moveTo(eq[0], eq[1]); c.lineTo(q[0], q[1]); c.stroke();
        c.setLineDash([]); c.globalAlpha = 1;
        c.fillStyle = o.color; c.strokeStyle = '#fff'; c.lineWidth = 1.5;
        c.beginPath(); c.arc(q[0], q[1], o === s.active ? 6 : 4.5, 0, 2 * Math.PI); c.fill(); c.stroke();
        c.fillStyle = '#fff'; c.font = '600 11px system-ui';
        c.fillText(o.name || 'object', q[0] + 9, q[1] - 7);
        c.font = '10px system-ui';
        if (o === s.active) this.activeInfo = { r: norm(cur.v), delta: norm(sub(cur.v, earth)) };
      }
    }

    // scale bar
    const barAu = ringStep;
    c.strokeStyle = 'rgba(200,210,230,0.7)'; c.lineWidth = 2;
    const bx = 12, by = this.view.h - 14, bw = barAu * this.scale;
    c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + bw, by); c.stroke();
    c.fillStyle = 'rgba(200,210,230,0.8)'; c.textAlign = 'left';
    c.fillText(barAu >= 0.01 ? `${barAu} au` : `${Math.round(barAu * 149597870.7).toLocaleString()} km`, bx, by - 5);
    if (!s.objects.some(o => o.visible && (helioArc(o).length || o.els.length))) {
      c.textAlign = 'center'; c.fillStyle = 'rgba(200,210,230,0.6)'; c.font = '12px system-ui';
      c.fillText('Paste an ephemeris with a distance (Δ) column, or ping Scout, to see an orbit arc.', this.view.w / 2, 22);
    }
  }
}
