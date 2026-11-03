/**
 * Spellsprite — the pixel buffers. Pure: no DOM, so the check tool can paint
 * under Node and compare frames byte for byte.
 *
 * `Pix` is one layer of colour at art resolution (one art pixel is a whole
 * number of screen pixels; the host does the scaling with nearest sampling).
 * A pixel carries a flag: 0 decal, 1 shape (outlined on bright maps), 2 hero
 * (always outlined). `Light` is the additive light, accumulated smooth and
 * quantised into three hard bands with ordered dither between them on output.
 *
 * Both track the box they were drawn in since `begin()`, so a host uploads only
 * that box and an idle frame costs nothing.
 */

import { TAU } from "./rand.mjs";
import { INK } from "./palette.mjs";

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const bay = (x, y) => BAYER[((y & 3) << 2) | (x & 3)];
const pack = (c) => ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
const INK_PX = pack(INK);

class Box {
  reset() { this.x0 = Infinity; this.y0 = Infinity; this.x1 = -Infinity; this.y1 = -Infinity; }
  grow(x, y) { if (x < this.x0) this.x0 = x; if (x > this.x1) this.x1 = x; if (y < this.y0) this.y0 = y; if (y > this.y1) this.y1 = y; }
  get empty() { return this.x1 < this.x0; }
}

export class Pix {
  constructor(w, h) {
    this.resize(w, h);
  }

  resize(w, h) {
    this.w = Math.max(1, w | 0); this.h = Math.max(1, h | 0);
    this.col = new Uint32Array(this.w * this.h);
    this.flag = new Uint8Array(this.w * this.h);
    this.box = new Box(); this.box.reset();
    this.prev = new Box(); this.prev.reset();
  }

  /** Clear only what was drawn last time. */
  begin() {
    const b = this.box;
    if (!b.empty) {
      for (let y = Math.max(0, b.y0); y <= Math.min(this.h - 1, b.y1); y++) {
        const r = y * this.w;
        this.col.fill(0, r + Math.max(0, b.x0), r + Math.min(this.w - 1, b.x1) + 1);
        this.flag.fill(0, r + Math.max(0, b.x0), r + Math.min(this.w - 1, b.x1) + 1);
      }
    }
    this.prev.x0 = b.x0; this.prev.y0 = b.y0; this.prev.x1 = b.x1; this.prev.y1 = b.y1;
    b.reset();
  }

  i(x, y) { x = Math.floor(x); y = Math.floor(y); return x < 0 || y < 0 || x >= this.w || y >= this.h ? -1 : y * this.w + x; }

  px(x, y, c, o = 0) {
    const i = this.i(x, y); if (i < 0 || !c) return;
    this.col[i] = pack(c); this.flag[i] = o; this.box.grow(i % this.w, (i / this.w) | 0);
  }

  /** Paint only where nothing is yet: the glow behind a bolt's core. */
  under(x, y, c) {
    const i = this.i(x, y); if (i < 0 || !c || this.col[i]) return;
    this.col[i] = pack(c); this.box.grow(i % this.w, (i / this.w) | 0);
  }

  /** Opaque, with ordered dither below full alpha. Use for dissolves, never for fills. */
  dot(x, y, c, a = 1, o = 0) {
    if (a <= 0 || !c) return;
    x = Math.floor(x); y = Math.floor(y);
    if (a < 1 && a <= bay(x, y)) return;
    this.px(x, y, c, o);
  }

  /** A true translucent pixel, alpha in quarters. Fills use this: no checkerboards. */
  mix(x, y, c, a) {
    const i = this.i(x, y); if (i < 0 || !c || a <= 0.02) return;
    a = Math.max(0.25, Math.round(a * 4) / 4);
    const d = this.col[i], da = (d >>> 24) / 255, oa = a + da * (1 - a), k = a / oa;
    const ch = (s, v) => Math.round(v * k + ((d >>> s) & 255) * (1 - k));
    this.col[i] = ((Math.round(oa * 255) << 24) | (ch(16, c[2]) << 16) | (ch(8, c[1]) << 8) | ch(0, c[0])) >>> 0;
    this.box.grow(i % this.w, (i / this.w) | 0);
  }

  /**
   * Per-pixel shader over a box. `fn(cx, cy, ix, iy)` returns null, a colour,
   * or `{c, a}`. `mode: "mix"` blends `{c, a}` instead of dithering it.
   */
  shade(x0, y0, x1, y1, fn, o = 0, mode) {
    const ya = Math.max(0, Math.floor(y0)), yb = Math.min(this.h - 1, Math.ceil(y1));
    const xa = Math.max(0, Math.floor(x0)), xb = Math.min(this.w - 1, Math.ceil(x1));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const r = fn(x + 0.5, y + 0.5, x, y);
        if (!r) continue;
        if (mode === "mix") this.mix(x, y, r.c ?? r, r.a ?? 1);
        else if (r.c) this.dot(x, y, r.c, r.a, o);
        else this.px(x, y, r, o);
      }
    }
  }

  /** Bresenham. `fn(f, i)` may colour each step (or return null to skip it). */
  line(x0, y0, x1, y1, c, o = 0, a = 1, fn) {
    x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.floor(x1); y1 = Math.floor(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, n = Math.max(dx, -dy) || 1;
    if (n > 4000) return;
    let err = dx + dy, i = 0;
    for (;;) {
      const col = fn ? fn(i / n, i) : c;
      if (col) this.dot(x0, y0, col, a, o);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
      i++;
    }
  }

  ellipse(cx, cy, rx, ry, fn, o = 0) {
    if (rx > 4000) return;
    const n = Math.max(8, Math.ceil(TAU * Math.max(rx, ry) * 1.3));
    let lx = null, ly = null;
    for (let s = 0; s < n; s++) {
      const q = (s / n) * TAU, x = Math.floor(cx + Math.cos(q) * rx), y = Math.floor(cy + Math.sin(q) * ry);
      if (x === lx && y === ly) continue;
      lx = x; ly = y;
      const r = fn(q);
      if (!r) continue;
      if (r.c) this.dot(x, y, r.c, r.a, o); else this.px(x, y, r, o);
    }
  }

  /** A 1px dark outline round every pixel flagged at least `min`, on empty neighbours only. */
  outline(min) {
    const b = this.box; if (b.empty) return;
    const { w, h, col, flag } = this, add = [];
    const on = (j) => col[j] && flag[j] >= min;
    const ya = Math.max(0, b.y0 - 1), yb = Math.min(h - 1, b.y1 + 1), xa = Math.max(0, b.x0 - 1), xb = Math.min(w - 1, b.x1 + 1);
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const i = y * w + x; if (col[i]) continue;
      if ((x > 0 && on(i - 1)) || (x < w - 1 && on(i + 1)) || (y > 0 && on(i - w)) || (y < h - 1 && on(i + w))) add.push(i);
    }
    for (const i of add) { col[i] = INK_PX; b.grow(i % w, (i / w) | 0); }
  }

  /** The box to upload this frame: what is drawn now plus what was drawn last frame (so it clears). */
  dirty() {
    const a = this.box, p = this.prev;
    const x0 = Math.min(a.x0, p.x0), y0 = Math.min(a.y0, p.y0), x1 = Math.max(a.x1, p.x1), y1 = Math.max(a.y1, p.y1);
    if (x1 < x0) return null;
    return { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(this.w - 1, x1), y1: Math.min(this.h - 1, y1) };
  }

  /** Copy a box into an RGBA byte array laid out `stride` pixels wide, at (dx, dy). */
  toRGBA(out, stride, box, dx = 0, dy = 0) {
    const C = this.col;
    for (let y = box.y0; y <= box.y1; y++) {
      let j = ((y - box.y0 + dy) * stride + dx) * 4;
      for (let x = box.x0, i = y * this.w + box.x0; x <= box.x1; x++, i++, j += 4) {
        const v = C[i];
        out[j] = v & 255; out[j + 1] = (v >>> 8) & 255; out[j + 2] = (v >>> 16) & 255; out[j + 3] = v >>> 24;
      }
    }
  }
}

export class Light {
  constructor(w, h) { this.resize(w, h); }

  resize(w, h) {
    this.w = Math.max(1, w | 0); this.h = Math.max(1, h | 0);
    this.lit = new Float32Array(this.w * this.h * 3);
    this.box = new Box(); this.box.reset();
    this.prev = new Box(); this.prev.reset();
  }

  begin() {
    const b = this.box;
    if (!b.empty) for (let y = Math.max(0, b.y0); y <= Math.min(this.h - 1, b.y1); y++)
      this.lit.fill(0, (y * this.w + Math.max(0, b.x0)) * 3, (y * this.w + Math.min(this.w - 1, b.x1) + 1) * 3);
    this.prev.x0 = b.x0; this.prev.y0 = b.y0; this.prev.x1 = b.x1; this.prev.y1 = b.y1;
    b.reset();
  }

  /** A soft elliptical pool, `c` an [r, g, b] colour, `k` its strength. */
  add(cx, cy, rx, ry, c, k) {
    if (!(k > 0.01) || !(rx >= 1)) return;
    ry = Math.max(1, ry);
    const ya = Math.max(0, Math.floor(cy - ry)), yb = Math.min(this.h - 1, Math.ceil(cy + ry));
    const xa = Math.max(0, Math.floor(cx - rx)), xb = Math.min(this.w - 1, Math.ceil(cx + rx));
    if (xa > xb || ya > yb) return;
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, d = dx * dx + dy * dy;
      if (d >= 1) continue;
      const f = 1 - Math.sqrt(d), wgt = f * f * k, i = (y * this.w + x) * 3;
      this.lit[i] += c[0] * wgt; this.lit[i + 1] += c[1] * wgt; this.lit[i + 2] += c[2] * wgt;
    }
    this.box.grow(xa, ya); this.box.grow(xb, yb);
  }

  dirty() { return Pix.prototype.dirty.call(this); }

  /**
   * Three hard bands, dithered only between bands (the outer edge is hard, or
   * the pool's rim is a cloud of dots). Dark floors: additive colour. Bright
   * floors: a tint with alpha, because additive light over parchment clips.
   */
  toRGBA(out, stride, box, bright, dx = 0, dy = 0) {
    const L = this.lit, w = this.w;
    for (let y = box.y0; y <= box.y1; y++) {
      let j = ((y - box.y0 + dy) * stride + dx) * 4;
      for (let x = box.x0; x <= box.x1; x++, j += 4) {
        const i = (y * w + x) * 3, r = L[i], g = L[i + 1], b = L[i + 2], m = Math.max(r, g, b);
        if (m < 6) { out[j] = out[j + 1] = out[j + 2] = out[j + 3] = 0; continue; }
        const q = Math.min(3.2, (m / 255) * 3);
        let band = Math.floor(q);
        if (band >= 1 && q - band > bay(x, y)) band++;
        band = Math.min(3, band);
        if (!band) { out[j] = out[j + 1] = out[j + 2] = out[j + 3] = 0; continue; }
        const s = 255 / m;
        if (bright) { out[j] = r * s; out[j + 1] = g * s; out[j + 2] = b * s; out[j + 3] = band * 30; }
        else { const k = (band / 3) * 0.62 * s; out[j] = r * k; out[j + 1] = g * k; out[j + 2] = b * k; out[j + 3] = 255; }
      }
    }
  }
}

/** The three layers one view paints into. */
export class Layers {
  constructor(w, h) { this.flat = new Pix(w, h); this.stand = new Pix(w, h); this.light = new Light(w, h); }
  resize(w, h) { this.flat.resize(w, h); this.stand.resize(w, h); this.light.resize(w, h); }
  get w() { return this.flat.w; }
  get h() { return this.flat.h; }
}
