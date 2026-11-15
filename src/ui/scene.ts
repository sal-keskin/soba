/**
 * The house in cross-section. Nothing here is pre-animated: every shape,
 * particle speed, tint and number is read from the live model state.
 */
import { FAMILY, K, PEOPLE, percent, stageOf, type Controls, type Night } from '../model';
import { num, t } from './i18n';

export type HandleId = 'chimney' | 'wind' | 'temp' | 'damper' | 'inlet' | 'window' | 'door';

interface Handle {
  id: HandleId;
  /** track end points in world metres (value 0 → a, value 1 → b) */
  ax: number; ay: number; bx: number; by: number;
  get(c: Controls): number;
  set(v: number, c: Controls): Partial<Controls>;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// World geometry, metres. Interior spans x 0…9, floor at y 0.
const W = {
  x0: -2.1, x1: 10.9, yGround: -0.5, yTop: 7.3,
  ceil: 2.6, eave: 2.8, ridgeX: 4.5, ridgeY: 5.0, wall: 9, part: 5,
  stoveX0: 0.6, stoveX1: 1.3, stoveTop: 0.8, pipeX: 0.95, pipeY: 2.1, chimX: -0.42, chimW: 0.46,
  windMax: 20,
};

const HANDLES: Handle[] = [
  {
    id: 'chimney', ax: W.chimX, ay: W.ridgeY + K.chimRelMin, bx: W.chimX, by: W.ridgeY + K.chimRelMax,
    get: (c) => (c.chimneyRel - K.chimRelMin) / (K.chimRelMax - K.chimRelMin),
    set: (v) => ({ chimneyRel: Math.round((K.chimRelMin + v * (K.chimRelMax - K.chimRelMin)) * 10) / 10 }),
  },
  {
    id: 'wind', ax: W.ridgeX - 2.2, ay: 6.75, bx: W.ridgeX + 2.2, by: 6.75,
    get: (c) => 0.5 + (c.windDir * c.wind) / (2 * W.windMax),
    set: (v, c) => {
      const signed = (v - 0.5) * 2 * W.windMax;
      const wind = Math.round(Math.abs(signed) * 2) / 2;
      const ratio = c.wind > 0.5 ? c.gust / c.wind : 1.7;
      return { wind, gust: Math.round(wind * ratio * 2) / 2, windDir: signed >= 0 ? 1 : -1 };
    },
  },
  {
    id: 'temp', ax: -1.6, ay: 0.7, bx: -1.6, by: 3.1,
    get: (c) => (c.tOut + 20) / 45,
    set: (v) => ({ tOut: Math.round(-20 + v * 45) }),
  },
  {
    id: 'damper', ax: 1.2, ay: 1.95, bx: 2.1, by: 1.95,
    get: (c) => c.damper,
    set: (v) => ({ damper: Math.round(v * 20) / 20 }),
  },
  {
    id: 'inlet', ax: 1.45, ay: 0.32, bx: 2.25, by: 0.32,
    get: (c) => c.inlet,
    set: (v) => ({ inlet: Math.round(v * 20) / 20 }),
  },
  {
    id: 'window', ax: 9.35, ay: 1.5, bx: 10.15, by: 1.5,
    get: (c) => c.window,
    set: (v) => ({ window: Math.round(v * 20) / 20 }),
  },
  {
    id: 'door', ax: 5.2, ay: 2.12, bx: 5.8, by: 2.12,
    get: (c) => c.door,
    set: (v) => ({ door: Math.round(v * 10) / 10 }),
  },
];

interface Puff { x: number; y: number; vx: number; vy: number; age: number; life: number; room: boolean }

/** Small deterministic hash for fixed decoration positions (stars, stipple). */
function hash(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export class Scene {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private flue: number[] = Array.from({ length: 22 }, (_, i) => (i + hash(i) * 0.6) / 22);
  private puffs: Puff[] = [];
  private streaks: number[] = Array.from({ length: 16 }, (_, i) => hash(i + 50));
  private emitRoom = 0;
  private emitTop = 0;
  active: HandleId | null = null;
  private dragStart = { v: 0, px: 0, py: 0 };

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scale = Math.min(this.w / (W.x1 - W.x0), this.h / (W.yTop - W.yGround));
    this.ox = (this.w - (W.x1 - W.x0) * this.scale) / 2 - W.x0 * this.scale;
    this.oy = this.h + W.yGround * this.scale;
  }

  private X(x: number): number { return this.ox + x * this.scale; }
  private Y(y: number): number { return this.oy - y * this.scale; }

  // ───────────── interaction ─────────────

  private knob(hd: Handle, c: Controls): [number, number] {
    const v = clamp01(hd.get(c));
    return [this.X(hd.ax + (hd.bx - hd.ax) * v), this.Y(hd.ay + (hd.by - hd.ay) * v)];
  }

  /** The handle under a point in CSS pixels, if any. */
  handleAt(px: number, py: number, c: Controls): HandleId | null {
    let best: HandleId | null = null;
    let bestD = 30;
    for (const hd of HANDLES) {
      const [kx, ky] = this.knob(hd, c);
      const d = Math.hypot(px - kx, py - ky);
      if (d < bestD) { bestD = d; best = hd.id; }
    }
    return best;
  }

  beginDrag(id: HandleId, px: number, py: number, c: Controls): void {
    const hd = HANDLES.find((x) => x.id === id)!;
    this.active = id;
    this.dragStart = { v: clamp01(hd.get(c)), px, py };
  }

  /** New control values for a drag to (px, py); relative, with a minimum travel of 110 px. */
  dragTo(px: number, py: number, c: Controls): Partial<Controls> | null {
    const hd = HANDLES.find((x) => x.id === this.active);
    if (!hd) return null;
    const tx = (hd.bx - hd.ax) * this.scale;
    const ty = -(hd.by - hd.ay) * this.scale;
    const len = Math.hypot(tx, ty);
    const travel = Math.max(len, 110);
    const along = ((px - this.dragStart.px) * tx + (py - this.dragStart.py) * ty) / len;
    return hd.set(clamp01(this.dragStart.v + along / travel), c);
  }

  /** A tap on the door toggles it. */
  tap(id: HandleId, c: Controls): Partial<Controls> | null {
    return id === 'door' ? { door: c.door > 0.5 ? 0 : 1 } : null;
  }

  endDrag(): void { this.active = null; }

  // ───────────── drawing ─────────────

  draw(night: Night, dtReal: number, moving: boolean, reduced: boolean): void {
    const g = this.ctx;
    const c = night.controls;
    const s = night.state;
    const d = s.diag;
    const X = (x: number) => this.X(x);
    const Y = (y: number) => this.Y(y);
    const S = this.scale;
    const small = Math.max(10, Math.min(13, S * 0.42));
    const top = W.ridgeY + c.chimneyRel;
    const from = c.windDir; // +1: wind blows left → right

    // sky
    const sky = g.createLinearGradient(0, 0, 0, this.h);
    sky.addColorStop(0, '#070b14');
    sky.addColorStop(1, '#162238');
    g.fillStyle = sky;
    g.fillRect(0, 0, this.w, this.h);
    g.fillStyle = '#c9d6ea';
    for (let i = 0; i < 40; i++) {
      g.globalAlpha = 0.25 + 0.5 * hash(i + 9);
      g.fillRect(hash(i) * this.w, hash(i + 100) * Y(3.2), 1.2, 1.2);
    }
    g.globalAlpha = 1;

    // wind streaks: speed and length follow the gusting roof-level wind
    const v = d.vRoof;
    g.strokeStyle = '#8fa6c8';
    g.lineWidth = 1.2;
    for (let i = 0; i < this.streaks.length; i++) {
      if (moving && !reduced) this.streaks[i] = (this.streaks[i] + (from * v * dtReal * 0.035 + 1)) % 1;
      const y = 3.3 + (i / this.streaks.length) * 3.9;
      const x = W.x0 + this.streaks[i] * (W.x1 - W.x0);
      const len = 0.15 + v * 0.11;
      if (v < 0.3) continue;
      g.globalAlpha = Math.min(0.75, 0.15 + v * 0.06);
      g.beginPath();
      g.moveTo(X(x), Y(y));
      g.lineTo(X(x + from * len), Y(y));
      // arrow head, so direction does not depend on motion
      g.lineTo(X(x + from * (len - 0.12)), Y(y) - 3);
      g.moveTo(X(x + from * len), Y(y));
      g.lineTo(X(x + from * (len - 0.12)), Y(y) + 3);
      g.stroke();
    }
    g.globalAlpha = 1;

    // ground
    g.fillStyle = '#1a2130';
    g.fillRect(0, Y(0), this.w, this.h - Y(0));
    g.fillStyle = '#e8eef8';
    g.globalAlpha = c.tOut <= 0 ? 0.55 : 0;
    g.fillRect(0, Y(0) - 2, this.w, 3); // frost on the ground when freezing
    g.globalAlpha = 1;

    // rooms: fire glow, then CO haze and stipple
    const glow = Math.min(1, d.heat / 7500);
    const rooms: [number, number, number, string][] = [
      [0, W.part - 0.1, d.ppm[0], t('stoveRoom')],
      [W.part + 0.1, W.wall, d.ppm[1], t('bedroom')],
    ];
    rooms.forEach(([xa, xb, ppm, name], zi) => {
      g.fillStyle = zi === 0 ? `rgb(${38 + 40 * glow}, ${34 + 20 * glow}, ${40})` : '#232838';
      g.fillRect(X(xa), Y(W.ceil), (xb - xa) * S, W.ceil * S);
      const level = Math.min(1, Math.log10(1 + ppm) / 3.3);
      if (level > 0.01) {
        g.fillStyle = `rgba(196, 178, 96, ${0.5 * level})`;
        g.fillRect(X(xa), Y(W.ceil), (xb - xa) * S, W.ceil * S);
        g.fillStyle = 'rgba(245, 236, 190, 0.8)';
        const dots = Math.round(level * 150);
        for (let i = 0; i < dots; i++) {
          const px = X(xa + hash(i + zi * 1000) * (xb - xa));
          const py = Y(hash(i + 300 + zi * 1000) * W.ceil);
          g.fillRect(px, py, 1.6, 1.6);
        }
      }
      g.fillStyle = '#e9eef7';
      g.font = `600 ${small}px system-ui, sans-serif`;
      g.textAlign = 'right';
      g.textBaseline = 'top';
      const label = S < 40 ? `CO ${num(ppm)} ppm` : `${name} · CO ${num(ppm)} ppm`;
      g.fillText(label, X(xb) - 6, Y(W.ceil) + 4);
    });

    // house shell
    g.fillStyle = '#4a556b';
    g.fillRect(X(-0.2), Y(W.eave), 0.2 * S, W.eave * S + 0.2 * S); // left wall
    g.fillRect(X(-0.2), Y(0), (W.wall + 0.4) * S, 0.2 * S); // floor slab
    g.fillRect(X(-0.2), Y(W.eave), (W.wall + 0.4) * S, (W.eave - W.ceil) * S); // ceiling
    // right wall with window opening (y 1.0…2.0)
    g.fillRect(X(W.wall), Y(1.0), 0.2 * S, 1.0 * S);
    g.fillRect(X(W.wall), Y(W.eave), 0.2 * S, (W.eave - 2.0) * S);
    // partition with doorway (y 0…2.0)
    g.fillRect(X(W.part - 0.1), Y(W.ceil), 0.2 * S, 0.6 * S);
    // roof
    g.beginPath();
    g.moveTo(X(-0.6), Y(W.eave));
    g.lineTo(X(W.ridgeX), Y(W.ridgeY));
    g.lineTo(X(W.wall + 0.6), Y(W.eave));
    g.closePath();
    g.fillStyle = '#5d3f38';
    g.fill();
    g.strokeStyle = '#2b1d1a';
    g.lineWidth = 1;
    g.stroke();

    // ridge reference
    g.setLineDash([4, 4]);
    g.strokeStyle = '#c9d6ea';
    g.beginPath();
    g.moveTo(X(-1.2), Y(W.ridgeY));
    g.lineTo(X(W.ridgeX), Y(W.ridgeY));
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#c9d6ea';
    g.font = `${small}px system-ui, sans-serif`;
    g.textAlign = 'left';
    g.textBaseline = 'bottom';
    g.fillText(t('ridge'), X(-1.2), Y(W.ridgeY) - 3);

    // door leaf and window sash, angle from the control value
    g.strokeStyle = '#c8a878';
    g.lineWidth = Math.max(2, 0.07 * S);
    const da = c.door * 1.35;
    g.beginPath();
    g.moveTo(X(W.part), Y(2.0));
    g.lineTo(X(W.part + Math.sin(da) * 0.75), Y(2.0 - Math.cos(da) * 2.0 + (1 - Math.cos(da)) * 1.2));
    g.stroke();
    g.strokeStyle = '#a9c4e6';
    const wa = c.window * 1.2;
    g.beginPath();
    g.moveTo(X(W.wall + 0.1), Y(2.0));
    g.lineTo(X(W.wall + 0.1 + Math.sin(wa) * 1.0), Y(2.0 - Math.cos(wa) * 1.0));
    g.stroke();

    // chimney and pipe; the soot lining narrows the bore
    const bore = 1 - K.sootAreaLoss * c.soot * 0.8;
    g.fillStyle = '#6b6f7a';
    g.fillRect(X(W.chimX - W.chimW / 2), Y(top), W.chimW * S, (top - 1.9) * S);
    g.fillStyle = '#15171c';
    g.fillRect(X(W.chimX - 0.13), Y(top), 0.26 * S, (top - 1.97) * S);
    g.fillStyle = '#3a3f4a';
    const pw = 0.16;
    g.fillRect(X(W.pipeX - pw / 2), Y(W.pipeY + pw / 2), pw * S, (W.pipeY + pw / 2 - W.stoveTop) * S);
    g.fillRect(X(W.chimX), Y(W.pipeY + pw / 2), (W.pipeX - W.chimX + pw / 2) * S, pw * S);
    if (c.soot > 0.02) {
      g.fillStyle = '#050506';
      const lin = (0.26 * (1 - bore)) / 2;
      g.fillRect(X(W.chimX - 0.13), Y(top), lin * S, (top - 1.97) * S);
      g.fillRect(X(W.chimX + 0.13 - lin), Y(top), lin * S, (top - 1.97) * S);
      const pl = (pw * (1 - bore)) / 2;
      g.fillRect(X(W.pipeX - pw / 2), Y(W.pipeY), pl * S, (W.pipeY - W.stoveTop) * S);
      g.fillRect(X(W.pipeX + pw / 2 - pl), Y(W.pipeY), pl * S, (W.pipeY - W.stoveTop) * S);
    }
    // cap
    g.strokeStyle = '#9aa7ba';
    g.lineWidth = Math.max(2, 0.06 * S);
    g.beginPath();
    if (c.cap === 'rain') {
      g.moveTo(X(W.chimX - 0.4), Y(top + 0.28));
      g.lineTo(X(W.chimX + 0.4), Y(top + 0.28));
      g.moveTo(X(W.chimX - 0.2), Y(top));
      g.lineTo(X(W.chimX - 0.2), Y(top + 0.28));
      g.moveTo(X(W.chimX + 0.2), Y(top));
      g.lineTo(X(W.chimX + 0.2), Y(top + 0.28));
    } else if (c.cap === 'h') {
      g.moveTo(X(W.chimX - 0.42), Y(top + 0.45));
      g.lineTo(X(W.chimX - 0.42), Y(top - 0.1));
      g.moveTo(X(W.chimX + 0.42), Y(top + 0.45));
      g.lineTo(X(W.chimX + 0.42), Y(top - 0.1));
      g.moveTo(X(W.chimX - 0.42), Y(top + 0.17));
      g.lineTo(X(W.chimX + 0.42), Y(top + 0.17));
    }
    g.stroke();
    // damper plate inside the pipe: across the pipe when shut, edge-on when open
    const ang = (1 - c.damper) * (Math.PI / 2) * 0.92;
    g.strokeStyle = '#d9dee8';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(X(W.pipeX) - Math.sin(ang) * pw * 0.5 * S, Y(1.95) - Math.cos(ang) * pw * 0.5 * S);
    g.lineTo(X(W.pipeX) + Math.sin(ang) * pw * 0.5 * S, Y(1.95) + Math.cos(ang) * pw * 0.5 * S);
    g.stroke();

    // stove: glow follows the heat release, shutter follows the inlet
    g.fillStyle = '#23262e';
    g.fillRect(X(W.stoveX0), Y(W.stoveTop), (W.stoveX1 - W.stoveX0) * S, (W.stoveTop - 0.12) * S);
    g.fillRect(X(W.stoveX0 + 0.05), Y(0.12), 0.06 * S, 0.12 * S);
    g.fillRect(X(W.stoveX1 - 0.11), Y(0.12), 0.06 * S, 0.12 * S);
    g.fillStyle = `rgb(${90 + 165 * glow}, ${40 + 110 * glow}, ${20 + 20 * glow})`;
    g.fillRect(X(W.stoveX0 + 0.14), Y(0.66), 0.42 * S, 0.22 * S);
    g.fillStyle = '#0b0c0f';
    g.fillRect(X(W.stoveX0 + 0.14), Y(0.36), 0.42 * S, 0.1 * S);
    g.fillStyle = `rgb(${120 + 135 * glow}, ${60 + 80 * glow}, 30)`;
    g.fillRect(X(W.stoveX0 + 0.14), Y(0.36), 0.42 * c.inlet * S, 0.1 * S);

    // CO alarm on the ceiling of the stove room
    if (c.alarm) {
      const ax = X(2.7);
      const ay = Y(W.ceil) + 0.09 * S;
      g.fillStyle = '#e9eef7';
      g.fillRect(ax - 0.16 * S, Y(W.ceil), 0.32 * S, 0.12 * S);
      if (s.alarm.sounded) {
        g.strokeStyle = '#ffffff';
        g.lineWidth = 1.5;
        for (let r = 1; r <= 3; r++) {
          g.beginPath();
          g.arc(ax, ay, r * 0.2 * S, 0.15 * Math.PI, 0.85 * Math.PI);
          g.stroke();
        }
        g.fillStyle = '#ffffff';
        g.font = `700 ${small}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'top';
        g.fillText(t('alarmBeep'), ax, ay + 0.75 * S);
      }
    }

    // flue flow: chevrons travel along the flue in the direction of the flow
    const path: [number, number][] = [[W.pipeX, W.stoveTop], [W.pipeX, W.pipeY], [W.chimX, W.pipeY], [W.chimX, top]];
    const segs = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1]));
    const total = segs.reduce((a, b) => a + b, 0);
    const dir = d.flueFlow >= 0 ? 1 : -1;
    const speed = Math.min(0.9, 0.04 + Math.abs(d.flueFlow) * 1000 * 0.07);
    g.strokeStyle = dir > 0 ? '#e9eef7' : '#ffb089';
    g.lineWidth = 1.6;
    for (let i = 0; i < this.flue.length; i++) {
      if (moving && !reduced) this.flue[i] = (this.flue[i] + dir * speed * dtReal + 1) % 1;
      if (reduced && i % 3 !== 0) continue;
      let dist = this.flue[i] * total;
      let k = 0;
      while (k < segs.length - 1 && dist > segs[k]) { dist -= segs[k]; k++; }
      const f = dist / segs[k];
      const px = X(path[k][0] + (path[k + 1][0] - path[k][0]) * f);
      const py = Y(path[k][1] + (path[k + 1][1] - path[k][1]) * f);
      const ux = ((path[k + 1][0] - path[k][0]) / segs[k]) * dir;
      const uy = (-(path[k + 1][1] - path[k][1]) / segs[k]) * dir;
      const a = Math.max(3, 0.09 * S);
      g.beginPath();
      g.moveTo(px - ux * a - uy * a, py - uy * a + ux * a);
      g.lineTo(px, py);
      g.lineTo(px - ux * a + uy * a, py - uy * a - ux * a);
      g.stroke();
    }

    // smoke: out of the terminal when drawing, out of the stove when spilling
    if (moving && !reduced) {
      this.emitTop += dtReal * Math.max(0, d.flueFlow) * 1000 * 1.2;
      while (this.emitTop >= 1) {
        this.emitTop--;
        this.puffs.push({ x: W.chimX, y: top + 0.1, vx: from * v * 0.25, vy: 0.5, age: 0, life: 2.2, room: false });
      }
      this.emitRoom += dtReal * Math.min(14, (d.spill * d.coRate) / 1.2e-6);
      while (this.emitRoom >= 1) {
        this.emitRoom--;
        this.puffs.push({
          x: W.stoveX0 + Math.random() * 0.7, y: 0.5 + Math.random() * 0.4,
          vx: (Math.random() - 0.3) * 0.5, vy: 0.25 + Math.random() * 0.25, age: 0, life: 4, room: true,
        });
      }
      for (const p of this.puffs) {
        p.age += dtReal;
        p.x += p.vx * dtReal;
        p.y += p.vy * dtReal;
        if (p.room) {
          if (p.y > W.ceil - 0.15) { p.y = W.ceil - 0.15; p.vy = 0; p.vx += 0.2 * dtReal; }
          if (p.x > W.part - 0.3 && c.door < 0.3) p.vx = -Math.abs(p.vx);
          if (p.x < 0.1) p.vx = Math.abs(p.vx);
        }
      }
      this.puffs = this.puffs.filter((p) => p.age < p.life && this.puffs.length < 400);
    } else if (reduced) {
      this.puffs.length = 0;
    }
    for (const p of this.puffs) {
      const a = 1 - p.age / p.life;
      g.fillStyle = p.room ? `rgba(226, 208, 150, ${0.5 * a})` : `rgba(190, 198, 212, ${0.35 * a})`;
      g.beginPath();
      g.arc(X(p.x), Y(p.y), (0.08 + 0.12 * (p.age / p.life)) * S, 0, Math.PI * 2);
      g.fill();
    }
    if (reduced && d.spill > 0) {
      // static mark instead of moving smoke
      g.fillStyle = '#ffd9a8';
      g.font = `700 ${small + 2}px system-ui, sans-serif`;
      g.textAlign = 'left';
      g.textBaseline = 'bottom';
      g.fillText('CO →', X(W.stoveX1 + 0.1), Y(0.95));
    }

    // people
    const spots: [number, number, number][] = [[3.6, 4.85, 0], [2.45, 3.4, 0], [6.1, 7.6, 1], [7.9, 8.75, 1]];
    const names = ['who_older', 'who_child', 'who_adult', 'who_infant'];
    let outIdx = 0;
    FAMILY.forEach((f, i) => {
      const who = s.people[i];
      const [xa, xb] = spots[i];
      const pct = percent(who.cohb, PEOPLE[f.kind]);
      const stage = stageOf(pct);
      // bed
      g.fillStyle = '#5a4a3c';
      g.fillRect(X(xa), Y(0.42), (xb - xa) * S, 0.14 * S);
      g.fillRect(X(xa), Y(0.28), 0.06 * S, 0.28 * S);
      g.fillRect(X(xb - 0.06), Y(0.28), 0.06 * S, 0.28 * S);
      if (f.kind === 'infant') {
        g.strokeStyle = '#8a745c';
        g.lineWidth = 1;
        for (let r = 0; r <= 5; r++) {
          g.beginPath();
          g.moveTo(X(xa + ((xb - xa) * r) / 5), Y(0.42));
          g.lineTo(X(xa + ((xb - xa) * r) / 5), Y(0.85));
          g.stroke();
        }
      }
      const size = f.kind === 'infant' ? 0.5 : f.kind === 'child' ? 0.75 : 1;
      let lx = (xa + xb) / 2;
      let ly = 0.56;
      if (who.evacuated) {
        // standing outside, to the right of the house
        const bx = 10.25 + (outIdx % 2) * 0.42 - (outIdx > 1 ? 0.2 : 0);
        outIdx++;
        const ht = 1.65 * (f.kind === 'infant' ? 0.45 : f.kind === 'child' ? 0.7 : 1);
        g.fillStyle = '#cfd8e6';
        g.beginPath();
        g.arc(X(bx), Y(ht - 0.12), 0.12 * size * S + 1, 0, Math.PI * 2);
        g.fill();
        g.fillRect(X(bx - 0.13 * size), Y(ht - 0.26), 0.26 * size * S, (ht - 0.26) * S);
        lx = bx;
        ly = ht + 0.1;
      } else {
        g.fillStyle = '#cfd8e6';
        const len = (xb - xa - 0.3) * (f.kind === 'infant' ? 0.75 : 1);
        g.beginPath();
        g.arc(X(xa + 0.24), Y(0.56), 0.13 * size * S + 1, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#7c8aa3';
        g.beginPath();
        g.roundRect(X(xa + 0.38), Y(0.42 + 0.26 * size), (len - 0.25) * S, 0.26 * size * S, 0.1 * S);
        g.fill();
      }
      // COHb bar: length is the value, hatching and the number repeat it
      const bw = Math.max(26, (xb - xa - 0.12) * S);
      const bx0 = X(lx) - bw / 2;
      const by0 = Y(ly + 0.72);
      const bh = Math.max(6, 0.16 * S);
      g.fillStyle = '#0b101b';
      g.fillRect(bx0, by0, bw, bh);
      const fill = Math.min(1, pct / 60) * bw;
      g.fillStyle = stage === 0 ? '#8fd3b0' : stage < 3 ? '#f0c060' : '#ff8f6b';
      g.fillRect(bx0, by0, fill, bh);
      if (stage > 0) {
        g.strokeStyle = 'rgba(0,0,0,0.55)';
        g.lineWidth = 1;
        g.beginPath();
        const stepPx = stage < 3 ? 6 : 3;
        for (let hx = stepPx; hx < fill; hx += stepPx) {
          g.moveTo(bx0 + hx, by0);
          g.lineTo(bx0 + hx - (stage < 3 ? bh : 0), by0 + bh);
        }
        g.stroke();
      }
      g.strokeStyle = '#a9b6cc';
      g.lineWidth = 1;
      g.strokeRect(bx0 + 0.5, by0 + 0.5, bw - 1, bh - 1);
      g.fillStyle = '#e9eef7';
      g.font = `600 ${small}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      g.fillText(S < 40 ? `%${num(pct)}` : `${t(names[i])} %${num(pct)}`, X(lx), by0 - 2);
    });
    if (outIdx > 0) {
      g.fillStyle = '#e9eef7';
      g.font = `${small}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.fillText(t('outside'), X(10.4), Y(0) + 3);
    }

    // thermometer
    const th = HANDLES[2];
    g.strokeStyle = '#c9d6ea';
    g.lineWidth = Math.max(5, 0.16 * S);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(X(th.ax), Y(th.ay));
    g.lineTo(X(th.bx), Y(th.by));
    g.stroke();
    g.strokeStyle = c.tOut <= 0 ? '#7fb4ff' : '#ff8f6b';
    g.lineWidth = Math.max(2.5, 0.08 * S);
    g.beginPath();
    g.moveTo(X(th.ax), Y(th.ay));
    g.lineTo(X(th.ax), Y(th.ay + (th.by - th.ay) * clamp01(th.get(c))));
    g.stroke();
    g.lineCap = 'butt';
    g.fillStyle = '#e9eef7';
    g.font = `600 ${small + 1}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillText(`${num(c.tOut)} °C`, X(th.ax), Y(th.ay) + 6);

    // windsock: droop and length follow the gusting wind
    const poleTop = 6.35;
    g.strokeStyle = '#c9d6ea';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(X(W.ridgeX), Y(W.ridgeY));
    g.lineTo(X(W.ridgeX), Y(poleTop));
    g.stroke();
    const v10 = v / K.roofWindFactor;
    const lift = Math.min(1, v10 / 9);
    const sx = from * Math.sin((lift * Math.PI) / 2) * 1.1;
    const sy = -Math.cos((lift * Math.PI) / 2) * 1.1;
    g.beginPath();
    g.moveTo(X(W.ridgeX), Y(poleTop));
    g.lineTo(X(W.ridgeX + sx), Y(poleTop + sy) - 0.07 * S);
    g.lineTo(X(W.ridgeX + sx), Y(poleTop + sy) + 0.07 * S);
    g.lineTo(X(W.ridgeX), Y(poleTop - 0.3));
    g.closePath();
    g.fillStyle = '#e8a04a';
    g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(X(W.ridgeX + sx * 0.45), Y(poleTop + sy * 0.45 - 0.02));
    g.lineTo(X(W.ridgeX + sx * 0.45), Y(poleTop + sy * 0.45 - 0.22));
    g.stroke();
    g.fillStyle = '#e9eef7';
    g.font = `600 ${small + 1}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    const arrow = c.wind < 0.5 ? '' : from > 0 ? ' →' : ' ←';
    g.fillText(`${num(c.wind, 1)} m/s${arrow}`, X(W.ridgeX), Y(7.0));

    // draught gauge (top left)
    const gx = Math.max(52, X(W.x0) + 52);
    const gy = 58;
    const gr = 38;
    const paToA = (pa: number) => Math.PI * (1 + clamp01((pa + 10) / 35));
    g.lineWidth = 7;
    g.strokeStyle = '#33415c';
    g.beginPath();
    g.arc(gx, gy, gr, Math.PI, 2 * Math.PI);
    g.stroke();
    g.setLineDash([3, 3]);
    g.strokeStyle = '#ff8f6b';
    g.beginPath();
    g.arc(gx, gy, gr, Math.PI, paToA(0));
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2;
    const za = paToA(0);
    g.beginPath();
    g.moveTo(gx + Math.cos(za) * (gr - 7), gy + Math.sin(za) * (gr - 7));
    g.lineTo(gx + Math.cos(za) * (gr + 7), gy + Math.sin(za) * (gr + 7));
    g.stroke();
    const na = paToA(d.collar);
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(gx, gy);
    g.lineTo(gx + Math.cos(na) * (gr - 4), gy + Math.sin(na) * (gr - 4));
    g.stroke();
    g.fillStyle = '#e9eef7';
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.font = `700 ${small + 3}px system-ui, sans-serif`;
    g.fillText(`${d.collar >= 0 ? '+' : '−'}${num(Math.abs(d.collar), 1)} Pa`, gx, gy + 5);
    g.font = `600 ${small}px system-ui, sans-serif`;
    const st = flowState(night);
    g.fillStyle = st === 'flowUp' ? '#e9eef7' : '#ffd9a8';
    g.fillText(`${t('gauge')}: ${st === 'flowDown' ? '↓' : st === 'flowLeak' ? '↯' : '↑'} ${t(st)}`, Math.max(gx, 74), gy + 9 + small + 3);

    // handles
    for (const hd of HANDLES) {
      const [kx, ky] = this.knob(hd, c);
      if (hd.id === 'damper' || hd.id === 'inlet' || hd.id === 'window' || hd.id === 'door' || hd.id === 'wind') {
        g.strokeStyle = 'rgba(233, 238, 247, 0.4)';
        g.lineWidth = 2;
        g.setLineDash([2, 4]);
        g.beginPath();
        g.moveTo(X(hd.ax), Y(hd.ay));
        g.lineTo(X(hd.bx), Y(hd.by));
        g.stroke();
        g.setLineDash([]);
      }
      const on = this.active === hd.id;
      g.beginPath();
      g.arc(kx, ky, on ? 12 : 9.5, 0, Math.PI * 2);
      g.fillStyle = on ? '#f0a850' : '#0e1420';
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = '#f0a850';
      g.stroke();
      // double arrow along the axis of travel
      const vert = hd.ax === hd.bx;
      g.strokeStyle = on ? '#1a1206' : '#f0a850';
      g.lineWidth = 1.6;
      g.beginPath();
      const q = 5;
      if (vert) {
        g.moveTo(kx - 3, ky - q + 3); g.lineTo(kx, ky - q); g.lineTo(kx + 3, ky - q + 3);
        g.moveTo(kx - 3, ky + q - 3); g.lineTo(kx, ky + q); g.lineTo(kx + 3, ky + q - 3);
      } else {
        g.moveTo(kx - q + 3, ky - 3); g.lineTo(kx - q, ky); g.lineTo(kx - q + 3, ky + 3);
        g.moveTo(kx + q - 3, ky - 3); g.lineTo(kx + q, ky); g.lineTo(kx + q - 3, ky + 3);
      }
      g.stroke();
    }
  }
}

/** One of four words for what the flue is doing right now. */
export function flowState(night: Night): 'flowUp' | 'flowDown' | 'flowLeak' | 'flowWeak' {
  const d = night.state.diag;
  if (d.flueFlow < 0) return 'flowDown';
  if (d.spill > 0) return 'flowLeak';
  if (d.collar < K.weakDraughtPa) return 'flowWeak';
  return 'flowUp';
}
