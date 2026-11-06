// Small canvas helper: keeps the backing store sized to the element at device pixel ratio.
export class CanvasView {
  constructor(canvas, onChange) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 1; this.h = 1; this.dpr = 1;
    this.onChange = onChange;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.onChange && this.onChange();
  }
  begin(bg) {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = bg;
    c.fillRect(0, 0, this.w, this.h);
    return c;
  }
  message(text) {
    const c = this.ctx;
    c.fillStyle = 'rgba(200,210,230,0.7)';
    c.font = '13px system-ui, sans-serif';
    c.textAlign = 'center';
    wrapText(c, text, this.w / 2, this.h / 2, this.w - 40, 18);
  }
  pointer(ev) {
    const r = this.canvas.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }
}

export function wrapText(c, text, x, y, maxW, lh) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (c.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  lines.push(line);
  lines.forEach((l, i) => c.fillText(l, x, y + (i - (lines.length - 1) / 2) * lh));
}

export function starColor(bv) {
  // rough B-V -> RGB
  const t = Math.max(-0.4, Math.min(2, bv));
  if (t < 0) return [170, 191, 255];
  if (t < 0.4) return [202 + t * 100, 215 + t * 60, 255];
  if (t < 0.8) return [255, 244 - (t - 0.4) * 60, 234 - (t - 0.4) * 150];
  if (t < 1.4) return [255, 220 - (t - 0.8) * 90, 160 - (t - 0.8) * 120];
  return [255, 170, 90];
}

export function fmtUTC(ms, withSec = false) {
  const d = new Date(ms);
  if (isNaN(d)) return '—';
  const s = d.toISOString();
  return s.slice(0, 10) + ' ' + s.slice(11, withSec ? 19 : 16) + ' UTC';
}
