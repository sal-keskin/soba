import { K, NIGHT_SECONDS, type Night } from '../model';
import { t } from './i18n';

/** Clock text for a time in seconds since the start of the night. */
export function clock(tSec: number): string {
  const m = Math.floor(tSec / 60) + K.startHour * 60;
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Overnight record: collar draught on top (with reversal shown as a hatched
 * band, not only as colour), room CO and the highest COHb below.
 */
export function drawTimeline(canvas: HTMLCanvasElement, night: Night): void {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) {
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
  }
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = r.width;
  const h = r.height;
  g.clearRect(0, 0, w, h);
  const axis = 14;
  const mid = Math.round((h - axis) * 0.5);
  const xOf = (tt: number) => (tt / NIGHT_SECONDS) * w;
  const S = night.samples;
  const font = '11px system-ui, sans-serif';

  // hours
  g.font = font;
  g.textBaseline = 'bottom';
  for (let hr = 0; hr <= 8; hr++) {
    const x = xOf(hr * 3600);
    g.strokeStyle = '#2a3650';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x + 0.5, 0);
    g.lineTo(x + 0.5, h - axis);
    g.stroke();
    g.fillStyle = '#a9b6cc';
    g.textAlign = hr === 0 ? 'left' : hr === 8 ? 'right' : 'center';
    g.fillText(w < 480 ? clock(hr * 3600).slice(0, 2) : clock(hr * 3600), hr === 0 ? 2 : hr === 8 ? w - 2 : x, h);
  }

  // reversal and leak bands
  for (let i = 0; i < S.length; i++) {
    const s = S[i];
    if (s.spill <= 0) continue;
    const x = xOf(s.t);
    const bw = Math.max(1, w / (NIGHT_SECONDS / 30));
    if (s.flow < 0) {
      g.fillStyle = 'rgba(255, 143, 107, 0.30)';
      g.fillRect(x, 0, bw, mid);
      if (i % 4 === 0) {
        g.strokeStyle = 'rgba(255, 190, 160, 0.8)';
        g.beginPath();
        g.moveTo(x, mid);
        g.lineTo(x + 6, mid - 12);
        g.stroke();
      }
    } else {
      g.fillStyle = 'rgba(240, 192, 96, 0.22)';
      g.fillRect(x, mid - 6, bw, 6);
    }
  }

  // draught, −10…+25 Pa
  const yPa = (pa: number) => 3 + (1 - (Math.max(-10, Math.min(25, pa)) + 10) / 35) * (mid - 6);
  g.strokeStyle = '#ffffff';
  g.setLineDash([2, 3]);
  g.beginPath();
  g.moveTo(0, yPa(0));
  g.lineTo(w, yPa(0));
  g.stroke();
  g.setLineDash([]);
  g.strokeStyle = '#e9eef7';
  g.lineWidth = 1.5;
  g.beginPath();
  S.forEach((s, i) => (i ? g.lineTo(xOf(s.t), yPa(s.collar)) : g.moveTo(xOf(s.t), yPa(s.collar))));
  g.stroke();

  // CO (square-root scale) and highest COHb
  let maxPpm = 100;
  for (const s of S) maxPpm = Math.max(maxPpm, s.ppm0, s.ppm1);
  const y0 = h - axis - 2;
  const span = y0 - mid - 4;
  const yPpm = (p: number) => y0 - Math.sqrt(p / maxPpm) * span;
  const yCohb = (p: number) => y0 - Math.min(1, p / 60) * span;
  g.strokeStyle = '#33415c';
  g.beginPath();
  g.moveTo(0, mid + 0.5);
  g.lineTo(w, mid + 0.5);
  g.stroke();
  g.strokeStyle = '#e2d096';
  g.lineWidth = 1.5;
  g.beginPath();
  S.forEach((s, i) => (i ? g.lineTo(xOf(s.t), yPpm(s.ppm0)) : g.moveTo(xOf(s.t), yPpm(s.ppm0))));
  g.stroke();
  g.strokeStyle = '#ff8f6b';
  g.setLineDash([5, 3]);
  g.beginPath();
  S.forEach((s, i) => {
    const y = yCohb(Math.max(...s.cohb));
    if (i) g.lineTo(xOf(s.t), y);
    else g.moveTo(xOf(s.t), y);
  });
  g.stroke();
  g.setLineDash([]);

  // legends, with the line style spelled out
  g.textBaseline = 'top';
  g.textAlign = 'left';
  g.fillStyle = '#e9eef7';
  g.fillText(`— ${t('tlDraught')}   ▨ ${t('tlReversed')}`, 4, 2);
  g.fillStyle = '#e2d096';
  g.fillText(`— ${t('tlCo')}, max ${Math.round(maxPpm)}`, 4, mid + 3);
  g.fillStyle = '#ffb59c';
  g.textAlign = 'right';
  g.fillText(`- - ${t('tlCohb')}`, w - 4, mid + 3);

  // part of the night not yet simulated
  const done = xOf(night.simulatedTo);
  g.fillStyle = 'rgba(14, 20, 32, 0.6)';
  g.fillRect(done, 0, w - done, h - axis);

  // playhead
  const px = xOf(night.t);
  g.strokeStyle = '#f0a850';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(px, 0);
  g.lineTo(px, h - axis);
  g.stroke();
  g.fillStyle = '#f0a850';
  g.beginPath();
  g.moveTo(px - 6, 0);
  g.lineTo(px + 6, 0);
  g.lineTo(px, 8);
  g.closePath();
  g.fill();
}
