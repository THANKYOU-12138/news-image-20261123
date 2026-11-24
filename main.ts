// news-image-20261123: "Sum up 23 November's world news in one image."
//
// This program draws a newspaper front page for Monday 23 November 2026 entirely
// from code: a hand-rolled rasteriser, a 5x7 bitmap font and a zlib-based PNG
// encoder, Node 22 standard library only, no network, fully deterministic
// (no clocks, no randomness), so two runs write byte-identical files.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------- canvas ---

const W = 1024;
const H = 1024;

type RGB = [number, number, number];

const PAPER: RGB = [247, 242, 228];
const PANEL: RGB = [255, 254, 248];
const INK: RGB = [20, 18, 14];
const RED: RGB = [179, 35, 26];
const BLUE: RGB = [29, 78, 137];
const GREY: RGB = [107, 103, 92];
const GOLD: RGB = [196, 138, 30];
const GREEN: RGB = [34, 110, 60];

const buf = new Uint8Array(W * H * 3);

function fillAll(c: RGB): void {
  for (let i = 0; i < W * H; i++) {
    buf[i * 3] = c[0];
    buf[i * 3 + 1] = c[1];
    buf[i * 3 + 2] = c[2];
  }
}

function px(x: number, y: number, c: RGB): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
  const i = (yi * W + xi) * 3;
  buf[i] = c[0];
  buf[i + 1] = c[1];
  buf[i + 2] = c[2];
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(W, Math.round(x + w));
  const y1 = Math.min(H, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) {
    let i = (yy * W + x0) * 3;
    for (let xx = x0; xx < x1; xx++) {
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
      i += 3;
    }
  }
}

function rectOutline(x: number, y: number, w: number, h: number, t: number, c: RGB): void {
  fillRect(x, y, w, t, c);
  fillRect(x, y + h - t, w, t, c);
  fillRect(x, y, t, h, c);
  fillRect(x + w - t, y, t, h, c);
}

// Thick line: Bresenham walk, stamping a square of side t at each step.
function line(x0: number, y0: number, x1: number, y1: number, t: number, c: RGB): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  const half = Math.floor(t / 2);
  for (let s = 0; s <= steps; s++) {
    const x = x0 + (dx * s) / steps;
    const y = y0 + (dy * s) / steps;
    fillRect(x - half, y - half, t, t, c);
  }
}

function circleFill(cx: number, cy: number, r: number, c: RGB): void {
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y));
    fillRect(cx - half, cy + y, half * 2 + 1, 1, c);
  }
}

function circleOutline(cx: number, cy: number, r: number, t: number, c: RGB): void {
  const steps = Math.max(64, r * 6);
  for (let s = 0; s < steps; s++) {
    const a = (s / steps) * Math.PI * 2;
    fillRect(cx + Math.cos(a) * r - t / 2, cy + Math.sin(a) * r - t / 2, t, t, c);
  }
}

// Filled triangle by scanline interpolation.
function tri(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB): void {
  const pts: Array<[number, number]> = [
    [x0, y0],
    [x1, y1],
    [x2, y2],
  ];
  pts.sort((a, b) => a[1] - b[1]);
  const [ax, ay] = pts[0];
  const [bx, by] = pts[1];
  const [cx, cy] = pts[2];
  const yStart = Math.max(0, Math.floor(ay));
  const yEnd = Math.min(H - 1, Math.ceil(cy));
  for (let y = yStart; y <= yEnd; y++) {
    let lo = Infinity;
    let hi = -Infinity;
    const edges: Array<[number, number, number, number]> = [
      [ax, ay, bx, by],
      [bx, by, cx, cy],
      [ax, ay, cx, cy],
    ];
    for (const [ex0, ey0, ex1, ey1] of edges) {
      if (ey0 === ey1) continue;
      const ymin = Math.min(ey0, ey1);
      const ymax = Math.max(ey0, ey1);
      if (y < ymin || y > ymax) continue;
      const x = ex0 + ((ex1 - ex0) * (y - ey0)) / (ey1 - ey0);
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    if (hi >= lo) fillRect(lo, y, hi - lo + 1, 1, c);
  }
}

// ------------------------------------------------------------ PNG output ---

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcData = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) crcData[i] = type.charCodeAt(i);
  crcData.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcData));
  return out;
}

function encodePNG(): Uint8Array {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, W);
  hv.setUint32(4, H);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const raw = new Uint8Array(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    const rowStart = y * (1 + W * 3);
    raw[rowStart] = 0; // filter: none
    raw.set(buf.subarray(y * W * 3, (y + 1) * W * 3), rowStart + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  const parts = [
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', new Uint8Array(idat)),
    pngChunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    png.set(p, off);
    off += p.length;
  }
  return png;
}

// ------------------------------------------------------------------ font ---
// 5x7 bitmap font, row-major: 7 rows per glyph, each a 5-bit value,
// bit 4 is the leftmost pixel. Authored by hand for this entry.

const FONT: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  '3': [0x1e, 0x01, 0x01, 0x0e, 0x01, 0x01, 0x1e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x10, 0x1e, 0x01, 0x01, 0x1e],
  '6': [0x0e, 0x10, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x01, 0x0e],
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c],
  ',': [0x00, 0x00, 0x00, 0x00, 0x0c, 0x04, 0x08],
  "'": [0x04, 0x04, 0x08, 0x00, 0x00, 0x00, 0x00],
  '-': [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  '+': [0x00, 0x04, 0x04, 0x1f, 0x04, 0x04, 0x00],
  '%': [0x18, 0x19, 0x02, 0x04, 0x08, 0x13, 0x03],
  '/': [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
  ':': [0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x0c, 0x00],
  '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04],
  '·': [0x00, 0x00, 0x00, 0x0c, 0x0c, 0x00, 0x00],
  '€': [0x0e, 0x11, 0x1e, 0x10, 0x1e, 0x11, 0x0e],
  '&': [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d],
  '(': [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ')': [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
};

// Width in pixels of a string at the given integer scale. Each glyph is
// 5 px wide plus `spacing` px of tracking, both multiplied by scale.
// `boldPx` is a small screen-pixel offset: the text is stamped a second time
// shifted right by that many pixels, which thickens strokes without closing
// the glyphs' counters the way a full extra font pixel would.
function textWidth(s: string, scale: number, boldPx = 0, spacing = 1): number {
  if (s.length === 0) return 0;
  return s.length * (5 + spacing) * scale - spacing * scale + boldPx;
}

// Draw text with its top-left at (x, y). Returns the x just past the text.
function drawText(
  x: number,
  y: number,
  s: string,
  scale: number,
  c: RGB,
  boldPx = 0,
  spacing = 1,
): number {
  let cx = x;
  for (const ch of s) {
    const glyph = FONT[ch] ?? FONT[' '];
    for (let row = 0; row < 7; row++) {
      const bits = glyph[row];
      for (let col = 0; col < 5; col++) {
        if (bits & (1 << (4 - col))) {
          fillRect(cx + col * scale, y + row * scale, scale, scale, c);
          if (boldPx > 0) fillRect(cx + col * scale + boldPx, y + row * scale, scale, scale, c);
        }
      }
    }
    cx += (5 + spacing) * scale;
  }
  return cx;
}

function drawTextCentered(
  cx: number,
  y: number,
  s: string,
  scale: number,
  c: RGB,
  boldPx = 0,
  spacing = 1,
): void {
  drawText(cx - textWidth(s, scale, boldPx, spacing) / 2, y, s, scale, c, boldPx, spacing);
}

// Draw a block of lines, each centred on cx, advancing lineGap per line.
function drawLinesCentered(
  cx: number,
  y: number,
  lines: string[],
  scale: number,
  c: RGB,
  lineGap: number,
  boldPx = 0,
  spacing = 1,
): void {
  let yy = y;
  for (const s of lines) {
    drawTextCentered(cx, yy, s, scale, c, boldPx, spacing);
    yy += lineGap;
  }
}

// ---------------------------------------------------------------- panels ---

interface PanelBox {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number; // centre x of the panel
}

// A bordered newspaper panel with a small red section tag at its top.
function panel(x: number, y: number, w: number, h: number, tag: string): PanelBox {
  fillRect(x, y, w, h, PANEL);
  rectOutline(x, y, w, h, 3, INK);
  drawTextCentered(x + w / 2, y + 12, tag, 3, RED, 1);
  return { x, y, w, h, cx: x + w / 2 };
}

// ----------------------------------------------------------------- icons ---
// Simple bold pictograms drawn from the same primitives as the type, so the
// page holds together at full size and at 300 px.

// Market chart: axes and a line that slides, then rockets up.
function iconChart(x: number, y: number, w: number, h: number): void {
  line(x, y, x, y + h, 4, GREY);
  line(x, y + h, x + w, y + h, 4, GREY);
  const pts: Array<[number, number]> = [
    [x + w * 0.04, y + h * 0.30],
    [x + w * 0.26, y + h * 0.44],
    [x + w * 0.44, y + h * 0.62],
    [x + w * 0.58, y + h * 0.78],
    [x + w * 0.74, y + h * 0.38],
    [x + w * 0.95, y + h * 0.08],
  ];
  for (let i = 0; i + 1 < pts.length; i++) {
    line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 6, GREEN);
  }
  const [ax, ay] = pts[pts.length - 1];
  tri(ax, ay, ax - 26, ay + 6, ax - 8, ay + 26, GREEN);
  circleFill(pts[3][0], pts[3][1], 7, RED);
}

// Warship seen from the side, a quadcopter drone above it, waves below.
function iconShip(x: number, y: number, w: number, h: number): void {
  const hullY = y + h * 0.52;
  tri(x, hullY, x + w * 0.16, hullY + h * 0.26, x + w * 0.16, hullY, INK);
  fillRect(x + w * 0.16, hullY, w * 0.68, h * 0.26, INK);
  tri(x + w * 0.84, hullY, x + w * 0.84, hullY + h * 0.26, x + w, hullY, INK);
  fillRect(x + w * 0.30, hullY - h * 0.16, w * 0.34, h * 0.16, INK);
  fillRect(x + w * 0.44, hullY - h * 0.30, w * 0.07, h * 0.16, INK);
  // drone
  const dx = x + w * 0.72;
  const dy = y + h * 0.14;
  fillRect(dx - 10, dy - 6, 20, 12, RED);
  for (const [ox, oy] of [
    [-30, -16],
    [30, -16],
    [-30, 16],
    [30, 16],
  ]) {
    line(dx, dy, dx + ox, dy + oy, 3, RED);
    circleOutline(dx + ox, dy + oy, 9, 3, RED);
  }
  // waves
  for (let row = 0; row < 2; row++) {
    const wy = hullY + h * 0.36 + row * h * 0.11;
    for (let sx = 0; sx < 8; sx++) {
      const wx = x + (sx * w) / 8;
      line(wx, wy, wx + w / 16, wy - 7, 4, BLUE);
      line(wx + w / 16, wy - 7, wx + w / 8, wy, 4, BLUE);
    }
  }
}

// Globe with equator and two meridians, for the climate talks.
function iconGlobe(cx: number, cy: number, r: number): void {
  circleOutline(cx, cy, r, 5, BLUE);
  line(cx - r, cy, cx + r, cy, 4, BLUE);
  for (let s = 0; s < 96; s++) {
    const a = (s / 96) * Math.PI * 2;
    px(cx + Math.cos(a) * r * 0.45, cy + Math.sin(a) * r, BLUE);
    fillRect(cx + Math.cos(a) * r * 0.45 - 2, cy + Math.sin(a) * r - 2, 4, 4, BLUE);
    px(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r, BLUE);
    fillRect(cx + Math.cos(a) * r * 0.8 - 2, cy + Math.sin(a) * r - 2, 4, 4, BLUE);
  }
}

// Oil drop over waves, for the strait standoff.
function iconDrop(cx: number, y: number, w: number, h: number): void {
  tri(cx, y, cx - w * 0.30, y + h * 0.52, cx + w * 0.30, y + h * 0.52, INK);
  circleFill(cx, y + h * 0.58, w * 0.30, INK);
  circleFill(cx - w * 0.10, y + h * 0.60, w * 0.07, PAPER);
  const wy = y + h * 0.98;
  for (let sx = 0; sx < 6; sx++) {
    const wx = cx - w / 2 + (sx * w) / 6;
    line(wx, wy, wx + w / 12, wy - 7, 4, BLUE);
    line(wx + w / 12, wy - 7, wx + w / 6, wy, 4, BLUE);
  }
}

// A candle with a flame, for the day of mourning.
function iconCandle(cx: number, y: number, w: number, h: number): void {
  tri(cx, y, cx - w * 0.13, y + h * 0.22, cx + w * 0.13, y + h * 0.22, GOLD);
  circleFill(cx, y + h * 0.22, w * 0.10, GOLD);
  fillRect(cx - w * 0.20, y + h * 0.30, w * 0.40, h * 0.62, INK);
  fillRect(cx - w * 0.26, y + h * 0.92, w * 0.52, h * 0.06, INK);
}

// Capitol dome on a base with columns, for the House result.
function iconDome(cx: number, y: number, w: number, h: number): void {
  for (let s = 0; s <= 48; s++) {
    const a = Math.PI + (s / 48) * Math.PI;
    fillRect(cx + Math.cos(a) * w * 0.34 - 3, y + h * 0.38 + Math.sin(a) * h * 0.30 - 3, 6, 6, INK);
  }
  fillRect(cx - 3, y, 6, h * 0.10, INK);
  fillRect(cx - w * 0.40, y + h * 0.38, w * 0.80, h * 0.08, INK);
  for (let i = 0; i < 5; i++) {
    const colX = cx - w * 0.32 + i * w * 0.16;
    fillRect(colX, y + h * 0.50, w * 0.07, h * 0.34, INK);
  }
  fillRect(cx - w * 0.44, y + h * 0.86, w * 0.88, h * 0.08, INK);
}

// Three overlapping rings, for the three-leader summit.
function iconRings(cx: number, cy: number, r: number): void {
  circleOutline(cx - r * 0.55, cy + r * 0.25, r * 0.62, 5, INK);
  circleOutline(cx + r * 0.55, cy + r * 0.25, r * 0.62, 5, RED);
  circleOutline(cx, cy - r * 0.35, r * 0.62, 5, BLUE);
}

// Mountain peaks with a sun, for the Himalaya neighbour visit.
function iconPeaks(x: number, y: number, w: number, h: number): void {
  tri(x, y + h, x + w * 0.30, y + h * 0.18, x + w * 0.58, y + h, INK);
  tri(x + w * 0.38, y + h, x + w * 0.68, y + h * 0.34, x + w, y + h, GREY);
  tri(x + w * 0.245, y + h * 0.335, x + w * 0.30, y + h * 0.18, x + w * 0.355, y + h * 0.335, PAPER);
  circleFill(x + w * 0.82, y + h * 0.16, w * 0.09, GOLD);
}

// ------------------------------------------------------------- the page ---

function compose(): void {
  fillAll(PAPER);
  rectOutline(10, 10, W - 20, H - 20, 3, INK);

  // Masthead: the date is the biggest thing on the page.
  drawTextCentered(W / 2, 30, 'THE DAY IN ONE PICTURE', 3, GREY);
  drawTextCentered(W / 2, 58, 'MONDAY', 6, INK, 2, 2);
  drawTextCentered(W / 2, 108, '23 NOVEMBER 2026', 10, INK, 3);
  fillRect(28, 190, W - 56, 6, INK);
  fillRect(28, 202, W - 56, 2, INK);

  // Lead row: the Nvidia comeback and the market surge.
  const lead = panel(28, 228, 596, 296, 'MARKETS · LEAD STORY');
  drawLinesCentered(lead.cx, 276, ['JENSEN HUANG BACK', 'AS NVIDIA CEO'], 5, INK, 44, 2);
  drawLinesCentered(
    lead.cx,
    372,
    ['BACK 11 DAYS AFTER QUITTING', 'SHARES JUMP +33%', 'S&P 500 +4.8% · NIKKEI -5%'],
    3,
    INK,
    24,
  );
  iconChart(64, 452, 496, 56);

  // Lead row, right: the sinking at Benghazi.
  const ship = panel(640, 228, 356, 296, 'WAR · LIBYA');
  iconShip(668, 278, 300, 78);
  drawLinesCentered(ship.cx, 368, ['UKRAINE SINKS', 'RUSSIAN SHIP'], 4, INK, 32, 2);
  drawLinesCentered(
    ship.cx,
    442,
    ['DRONE STRIKE ON', 'CORVETTE MERKURY', 'AT BENGHAZI, LIBYA'],
    3,
    INK,
    24,
  );

  // Middle row: climate, the strait, the mourning.
  const cop = panel(28, 540, 312, 208, 'CLIMATE · ANTALYA');
  drawLinesCentered(cop.cx, 580, ['COP31 ENDS', 'WITH NO DEAL'], 4, INK, 32, 2);
  drawLinesCentered(
    cop.cx,
    650,
    ['NO FOSSIL-FUEL', 'DEAL IN ANTALYA', "GUTERRES 'DEEPLY", "DISAPPOINTED'"],
    3,
    INK,
    23,
  );

  const hor = panel(356, 540, 312, 208, 'MIDDLE EAST');
  drawLinesCentered(hor.cx, 580, ['IRAN DEFIANT', 'AT HORMUZ'], 4, INK, 32, 2);
  drawLinesCentered(
    hor.cx,
    650,
    ['VOWS TO DEFY US', 'NAVAL BLOCKADE', 'US DRONE DOWNED', 'IN PERSIAN GULF'],
    3,
    INK,
    23,
  );

  const dym = panel(684, 540, 312, 208, 'WAR · UKRAINE');
  drawLinesCentered(dym.cx, 580, ['DYMER MOURNS', '11+ KILLED'], 4, INK, 32, 2);
  drawLinesCentered(
    dym.cx,
    650,
    ['STRIKE ON AN', 'APARTMENT BLOCK', 'NEAR KYIV', 'DAY OF MOURNING'],
    3,
    INK,
    23,
  );

  // Third row: Washington, Shenzhen, Delhi.
  const house = panel(28, 764, 312, 168, 'US POLITICS');
  drawLinesCentered(house.cx, 802, ['DEMOCRATS WIN', 'THE HOUSE'], 4, INK, 32, 2, 0);
  drawTextCentered(house.cx, 868, '258 SEATS', 3, INK);
  drawTextCentered(house.cx, 892, 'LARGEST SINCE 1992', 3, INK, 0, 0);

  const summit = panel(356, 764, 312, 168, 'DIPLOMACY');
  drawLinesCentered(summit.cx, 802, ['SHENZHEN', 'SUMMIT'], 4, INK, 32, 2);
  drawTextCentered(summit.cx, 868, 'TRUMP · XI · PUTIN', 3, INK, 0, 0);
  drawTextCentered(summit.cx, 892, 'NUCLEAR TALKS', 3, INK);

  const nepal = panel(684, 764, 312, 168, 'SOUTH ASIA');
  drawLinesCentered(nepal.cx, 802, ['NEPAL PM IN', 'DELHI TALKS'], 4, INK, 32, 2);
  drawLinesCentered(nepal.cx, 868, ['INDIA PLEDGES', '€1.4BN FLOOD AID'], 3, INK, 24);

  // Footer strip: sport, space and the capture in Sinaloa.
  fillRect(24, 934, W - 48, 74, INK);
  drawTextCentered(W / 2, 939, "WOMEN'S WORLD CUP 2031: USA · MEXICO · COSTA RICA · JAMAICA", 3, PAPER, 0, 0);
  drawTextCentered(W / 2, 962, '2035 TO THE UK · BEPICOLOMBO ENTERS MERCURY ORBIT', 3, PAPER);
  drawTextCentered(W / 2, 985, "'EL CHAPO ISIDRO' CAPTURED IN SINALOA, MEXICO", 3, PAPER);
}

compose();
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
writeFileSync(join(outDir, 'entry.png'), encodePNG());



