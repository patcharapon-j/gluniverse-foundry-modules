/**
 * Spellsprite — the shape vocabulary.
 *
 * A shape draws one particle into a pixel layer through a view `v`:
 *   v.ap(x, y, z)  world squares to art pixels   v.aps  art pixels per square
 *   v.sq           ground squash (1 top-down)    v.kind "top" | "side"
 *   v.key          a stable id for hysteresis    v.lod  true when zoomed out
 *
 * Sizes are ART pixels, never squares: a 3px ember is 3px at every zoom.
 * Drawn shapes step on the 12 fps sprite clock (`Math.floor(age * 12)`);
 * particles move at the full simulation rate.
 *
 * Families add shapes with `registerShapes({...})`. A name may be claimed once.
 */

import { TAU, clamp, lerp, easeOut, q12, fadeOut, hash, pnoise, inPoly, rng } from "./rand.mjs";
import { RAMP, S, WHITE } from "./palette.mjs";

export const DRAW = Object.create(null);
/** Shapes that lie on the ground (drawn into the flat layer). Everything else stands. */
export const FLAT_SHAPES = new Set();

export function registerShapes(shapes, { flat = [] } = {}) {
  for (const [name, fn] of Object.entries(shapes)) {
    if (DRAW[name]) throw new Error(`Spellsprite: shape "${name}" registered twice`);
    DRAW[name] = fn;
  }
  for (const name of flat) FLAT_SHAPES.add(name);
}

/** Slow things keep their pixel until they have really moved: no shimmer. */
export function snapH(p, v, x, y) {
  const key = "_" + v.key, s = p[key];
  if (!s || Math.abs(s[0] - x) > 0.8 || Math.abs(s[1] - y) > 0.8) p[key] = [Math.round(x), Math.round(y)];
  return p[key];
}

export const GLYPHS = ["010111010", "101010101", "111101111", "110011010", "011110011", "100111001"];
const DIRS8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const PLUS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

registerShapes({
  blob(v, P, p) {
    const u = clamp(q12(p.age) / p.life), fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, p.z);
    const rr = p.r * (u < 0.15 ? lerp(0.55, 1.15, u / 0.15) : lerp(1.15, 0.75, (u - 0.15) / 0.85));
    const hero = p.hero && fr === 0, fade = fadeOut(u, 0.7), smoke = p.smokeR ?? RAMP.smoke;
    P.shade(cx - rr - 2, cy - rr - 2, cx + rr + 2, cy + rr + 2, (x, y) => {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) / rr;
      if (d > 1 + (pnoise(Math.atan2(dy, dx), 9, p.seed + fr) - 0.5) * 0.4) return null;
      if (hero) return WHITE;
      const lit = (-dx - dy) / (rr * 1.4), t = 1.0 - d * 0.5 - u * 0.95 + lit * 0.18;
      const c = t < p.cool ? S(smoke, 0.45 + lit * 0.3) : S(p.R, t);
      return fade < 1 ? { c, a: fade } : c;
    }, 1);
  },
  smoke(v, P, p) {
    const u = clamp(p.age / p.life);
    let [cx, cy] = v.ap(p.x, p.y, p.z); [cx, cy] = snapH(p, v, cx, cy);
    const rr = p.r * (0.7 + 0.6 * easeOut(u)), fade = fadeOut(u, 0.5), R = p.R || RAMP.smoke, base = p.tone ?? 0.4;
    P.shade(cx - rr * 1.8, cy - rr * 1.6, cx + rr * 1.8, cy + rr * 1.4, (x, y) => {
      for (const [ox, oy, sc] of p.lobes) {
        const lx = x - (cx + ox * rr), ly = y - (cy + oy * rr), lr = rr * sc;
        if (lx * lx + ly * ly > lr * lr) continue;
        let t = base;
        if ((-lx * 0.6 - ly * 0.8) / lr > 0.35) t += 0.17; else if (ly / lr > 0.42) t -= 0.17;
        return fade < 1 ? { c: S(R, t), a: fade } : S(R, t);
      }
      return null;
    // a fading puff is truly translucent (quarter alpha), never a dithered checkerboard
    }, 1, fade < 1 ? "mix" : undefined);
  },
  tongue(v, P, p) {
    const u = clamp(q12(p.age) / p.life), fr = Math.floor(p.age * 12), grow = Math.sin(Math.PI * Math.min(1, u * 1.15));
    const h = Math.max(2, p.h * grow * (v.kind === "top" ? 0.6 : 1)), w = p.w * (0.55 + 0.45 * grow), [bx, by] = v.ap(p.x, p.y, p.z);
    for (let j = 0; j < h; j++) {
      const f = j / h, hw = w * (1 - f ** 1.3) * (0.75 + 0.5 * hash(j >> 1, fr, p.seed)), sway = Math.sin(f * 3 + fr * 1.7 + p.seed) * f * 2;
      for (let i = Math.floor(-hw); i <= Math.ceil(hw); i++) {
        const e = Math.abs(i) / Math.max(hw, 0.6); if (e > 1) continue;
        P.px(bx + i + sway, by - j, S(p.R, 0.98 - f * 0.7 - e * 0.35), 1);
      }
    }
  },
  spark(v, P, p) {
    // stretched by its speed (a fast spark is a streak), white at the head while it is young
    const u = p.age / p.life, [hx, hy] = v.ap(p.x, p.y, p.z), [tx, ty] = v.ap(p.x - p.vx * 0.055, p.y - p.vy * 0.055, p.z - p.vz * 0.055);
    P.line(tx, ty, hx, hy, null, 0, 1, (f) => (f > 0.82 && u < 0.3 ? WHITE : f > 0.6 ? S(p.R, 1 - u * 0.3) : S(p.R, 0.62 - u * 0.2)));
  },
  streak(v, P, p) {
    const [hx, hy] = v.ap(p.x, p.y, p.z), [tx, ty] = v.ap(p.x - p.vx * 0.05, p.y - p.vy * 0.05, p.z - p.vz * 0.05);
    P.line(tx, ty, hx, hy, null, 0, 1, (f) => S(p.R, f > 0.6 ? 0.95 : 0.6));
  },
  ember(v, P, p) {
    if (hash(Math.floor(p.age * 12), p.seed) < 0.18) return;
    let [x, y] = v.ap(p.x, p.y, p.z); [x, y] = snapH(p, v, x, y);
    P.px(x, y, S(p.R, 0.85 - (p.age / p.life) * 0.45));
  },
  mote(v, P, p) {
    let [x, y] = v.ap(p.x, p.y, p.z); [x, y] = snapH(p, v, x, y);
    const a = fadeOut(p.age / p.life, 0.7);
    if (p.plus && Math.floor(p.age * 12) % 4 !== 3) {
      P.dot(x, y, S(p.R, 1), a);
      for (const [dx, dy] of PLUS) P.dot(x + dx, y + dy, S(p.R, 0.68), a);
    } else P.dot(x, y, S(p.R, 0.85), a);
  },
  flake(v, P, p) {
    let [x, y] = v.ap(p.x, p.y, p.z); [x, y] = snapH(p, v, x, y);
    const a = fadeOut(p.age / p.life, 0.7);
    P.dot(x, y, S(p.R, p.big ? 1 : 0.88), a);
    if (p.big) for (const [dx, dy] of PLUS) P.dot(x + dx, y + dy, S(p.R, 0.7), a);
  },
  chunk(v, P, p) {
    const [x, y] = v.ap(p.x, p.y, p.z), a = fadeOut(p.age / p.life, 0.7), w = p.s + (p.wide ? 1 : 0);
    for (let j = 0; j < p.s; j++) for (let i = 0; i < w; i++) P.dot(x + i, y + j - p.s + 1, S(p.R, j === 0 ? 0.6 : 0.3), a, 1);
  },
  shard(v, P, p) {
    const [x, y] = v.ap(p.x, p.y, p.z), a = fadeOut(p.age / p.life, 0.75), turn = Math.floor(p.age * 12 + p.seed * 4) % 2;
    P.dot(x, y, S(p.R, 0.95), a, 1);
    if (turn) { P.dot(x - 1, y, S(p.R, 0.6), a, 1); P.dot(x + 1, y, S(p.R, 0.6), a, 1); P.dot(x, y - 1, S(p.R, 0.78), a, 1); P.dot(x, y + 1, S(p.R, 0.45), a, 1); }
    else { P.dot(x - 1, y - 1, S(p.R, 0.78), a, 1); P.dot(x + 1, y + 1, S(p.R, 0.45), a, 1); }
  },
  crystal(v, P, p) {
    const fr = Math.floor(p.age * 12), u = p.age / p.life, grow = Math.min(1, (fr + 1) / 3), melt = u > 0.65 ? (u - 0.65) / 0.35 : 0;
    const hh = p.h * grow * (1 - melt * 0.6) * (v.kind === "top" ? 0.55 : 1);
    if (hh < 1) return;
    const [bx, by] = v.ap(p.x, p.y, 0), a = 1 - melt;
    for (let j = 0; j < hh; j++) {
      const f = j / hh, hw = p.w * (1 - f), cx = bx + p.lean * f;
      for (let i = Math.floor(-hw); i <= Math.ceil(hw); i++) {
        if (Math.abs(i) > hw + 0.3) continue;
        let t = i < 0 ? 0.68 : 0.36;
        if (Math.abs(i) <= 0.5) t = 0.95;
        if (j >= hh - 2) t = 1;
        P.dot(cx + i, by - j, S(p.R, t), a, 1);
      }
    }
  },
  orb(v, P, p) {
    const [hx, hy] = v.ap(p.x, p.y, p.z), r = p.r, fr = Math.floor(p.age * 12);
    let ux = 1, uy = 0, L = 0;
    if (p.tail) {
      const [tx, ty] = v.ap(...p.tail), dx = hx - tx, dy = hy - ty, sp = Math.hypot(dx, dy);
      if (sp > 0.5) { ux = dx / sp; uy = dy / sp; L = Math.min(r * 4, sp); }
    }
    const dark = !!p.dark;
    P.shade(hx - r - L - 1, hy - r - L - 1, hx + r + L + 1, hy + r + L + 1, (x, y) => {
      const rx = x - hx, ry = y - hy, along = -(rx * ux + ry * uy), perp = Math.abs(rx * uy - ry * ux);
      let t;
      if (along <= 0 || L === 0) {
        const d = Math.hypot(rx, ry) / r; if (d > 1) return null;
        t = 1 - d * 0.5;
        if (dark) return d < 0.7 ? S(p.R, 0) : S(p.R, 0.85);
        if (p.big && r >= 4) {
          // a big orb is a ball, not a dot: a dark rim, a churning surface, a white-hot core
          if (d > 1 - 1.2 / r) return S(p.R, 0.42);
          if (d < 0.32) return WHITE;
          const churn = hash(Math.floor((rx + fr * 1.7) / 2), Math.floor((ry - fr * 1.3) / 2), 7);
          t = 0.95 - d * 0.35 - (churn > 0.6 ? 0.14 : 0);
        }
      } else {
        if (along > L || perp > r * (1 - along / L) * (0.85 + 0.3 * hash(Math.floor(along), fr, 3))) return null;
        t = 0.8 - (along / L) * 0.55 - (perp / r) * 0.2;
        if (dark) t -= 0.3;
      }
      return S(p.R, t);
    }, 1);
    P.px(hx, hy, dark ? S(p.R, 0.3) : WHITE, 1);
  },
  crescent(v, P, p) {
    const fr = Math.floor(p.age * 12), [tx, ty] = v.ap(p.x, p.y, p.z), [fx, fy] = v.ap(p.from[0], p.from[1], p.from[2]);
    const ang = Math.round(Math.atan2(ty - fy, tx - fx) / (TAU / 16)) * (TAU / 16);
    const R = p.R2, T = p.T, span = p.span ?? 2.3, sweep = Math.min(1, (fr + 1) / 2), gone = fr >= 3 ? (fr - 2) / 3 : 0;
    if (gone >= 1) return;
    const cx = tx - Math.cos(ang) * R * 0.55, cy = ty - Math.sin(ang) * R * 0.55;
    P.shade(cx - R - 2, cy - R - 2, cx + R + 2, cy + R + 2, (x, y) => {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
      let phi = Math.atan2(dy, dx) - ang; phi = ((phi + Math.PI) % TAU + TAU) % TAU - Math.PI;
      const s = (phi * p.flip + span / 2) / span;
      if (s < gone || s > sweep) return null;
      const thick = T * s ** 0.8 * (1 - Math.max(0, (s - 0.85) / 0.15) ** 2);
      if (d > R || d < R - thick - 0.5) return null;
      const e = R - d;
      // dim: a smear's echo, no bright rim; edge: a heavy blade's white cutting rim
      if (p.dim) return e < 1.2 ? S(p.R, 0.62) : (x + y) % 2 ? S(p.R, 0.45) : null;
      if (p.edge && e < 1.2 && s > 0.25) return WHITE;
      return S(p.R, e < 1.2 ? 1 : e < 2.4 ? 0.82 : 0.62 - (1 - s) * 0.2);
    }, 1);
  },
  star(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 2) return;
    const [x, y] = v.ap(p.x, p.y, p.z), L = p.L * (fr === 0 ? 1 : fr === 1 ? 1.4 : 0.9), c = fr === 0 ? WHITE : S(p.R, 0.95), c2 = S(p.R, 0.8);
    for (let i = 1; i <= L; i++) {
      P.px(x + i, y, c, 2); P.px(x - i, y, c, 2); P.px(x, y + i, c, 2); P.px(x, y - i, c, 2);
      if (i < L * 0.55) { P.px(x + i, y + i, c2, 2); P.px(x - i, y - i, c2, 2); P.px(x + i, y - i, c2, 2); P.px(x - i, y + i, c2, 2); }
    }
    P.px(x, y, WHITE, 2);
  },
  flash(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 1) return;
    const [x, y] = v.ap(p.x, p.y, p.z), r = p.r * (fr ? 1.3 : 1);
    P.shade(x - r, y - r, x + r, y + r, (px, py) => {
      const d = Math.hypot(px - x, py - y) / r; if (d > 1) return null;
      return fr ? (d > 0.72 ? S(p.R, 1) : null) : WHITE;
    }, 2);
  },
  core(v, P, p) {
    const fr = Math.floor(p.age * 12), u = q12(p.age) / p.life, [x, y] = v.ap(p.x, p.y, p.z), r = p.r * Math.sin(Math.PI * clamp(u * 1.15));
    if (r < 1) return;
    P.shade(x - r - 2, y - r - 2, x + r + 2, y + r + 2, (px, py) => {
      const dx = px - x, dy = py - y, d = Math.hypot(dx, dy), e = r * (1 + (pnoise(Math.atan2(dy, dx), 10, p.seed + fr) - 0.5) * 0.3);
      if (d > e + 1) return null;
      return d > e ? S(p.R, 0.88) : d > e - 1.2 ? S(p.R, 0.55) : S(p.R, 0);
    }, 2);
  },
  wisp(v, P, p) {
    let [x, y] = v.ap(p.x, p.y, p.z); [x, y] = snapH(p, v, x, y);
    const a = fadeOut(p.age / p.life, 0.6);
    for (let j = 0; j < p.s; j++) for (let i = 0; i < p.s; i++) P.dot(x + i, y + j, S(p.R, 0.05), a);
    for (let i = 0; i < p.s; i++) P.dot(x + i, y - 1, S(p.R, 0.72), a);
  },
  beam(v, P, p) {
    const u = clamp(q12(p.age) / p.life), fr = Math.floor(p.age * 12), [bx, by] = v.ap(p.x, p.y, 0), [, ty] = v.ap(p.x, p.y, p.h);
    const w = p.w * Math.sin(Math.PI * u) * (1 + 0.15 * (fr % 2)); if (w < 0.5) return;
    for (let y = Math.floor(ty); y <= by; y++) {
      const f = (by - y) / Math.max(1, by - ty), a = f > 0.75 ? (1 - f) / 0.25 : 1;
      for (let i = Math.floor(-w); i <= Math.ceil(w); i++) {
        const e = Math.abs(i) / w; if (e > 1) continue;
        P.dot(bx + i, y, S(p.R, e < 0.3 ? 1 : e < 0.65 ? 0.8 : 0.6), a * (e > 0.65 ? 0.6 : 1));
      }
    }
  },
  octa(v, P, p) {
    const u = clamp(q12(p.age) / p.life), [x, y] = v.ap(p.x, p.y, p.z), r = p.r * (0.5 + 0.8 * easeOut(u)), pts = [];
    for (let i = 0; i < 8; i++) { const q = (i * TAU) / 8 + TAU / 16; pts.push([x + Math.cos(q) * r, y + Math.sin(q) * r * (p.squash ? v.sq : 1)]); }
    for (let i = 0; i < 8; i++) {
      const a = pts[i], b = pts[(i + 1) % 8];
      P.line(a[0], a[1], b[0], b[1], S(p.R, 0.95), 1, 1 - u);
      P.line(lerp(x, a[0], 0.88), lerp(y, a[1], 0.88), lerp(x, b[0], 0.88), lerp(y, b[1], 0.88), S(p.R, 0.6), 0, 1 - u);
    }
  },
  glint(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 4) return;
    const n = [1, 2, 3, 2, 1][fr] * (p.big ? 2 : 1), [x, y] = v.ap(p.x, p.y, p.z);
    P.px(x, y, WHITE, 2);
    for (let i = 1; i <= n; i++) {
      const c = i === n ? S(p.R, 0.75) : S(p.R, 1);
      P.px(x + i, y, c); P.px(x - i, y, c); P.px(x, y + i, c); P.px(x, y - i, c);
    }
  },
  petal(v, P, p) {
    if (v.lod) return;
    const [x, y] = v.ap(p.x, p.y, p.z), f = Math.floor(p.age * 12 + p.seed * 3) % 4, a = fadeOut(p.age / p.life, 0.7), c1 = S(p.R, 0.82), c2 = S(p.R, 0.58);
    P.dot(x, y, c1, a);
    if (f === 0) P.dot(x + 1, y, c2, a); else if (f === 1) P.dot(x + 1, y + 1, c2, a); else if (f === 2) P.dot(x, y + 1, c2, a);
  },
  drip(v, P, p) { const [x, y] = v.ap(p.x, p.y, p.z); P.px(x, y, S(p.R, 0.85), 1); P.px(x, y + 1, S(p.R, 0.55), 1); },
  splash(v, P, p) {
    const fr = Math.floor(p.age * 12), [x, y] = v.ap(p.x, p.y, 0), c = S(p.R, 0.75);
    if (fr === 0) { P.px(x - 1, y - 1, c); P.px(x + 1, y - 1, c); P.px(x, y - 2, c); }
    else if (fr === 1) { P.px(x - 2, y - 1, c); P.px(x + 2, y - 1, c); P.px(x - 1, y - 3, c); P.px(x + 1, y - 3, c); }
  },
  bubble(v, P, p) {
    const fr = Math.floor(p.age * 12), [x, y] = v.ap(p.x, p.y, 0), c = S(p.R, 0.9);
    if (fr < 2) P.px(x, y, c);
    else if (fr < 4) for (const [dx, dy] of PLUS) P.px(x + dx, y + dy, c);
  },
  bolt(v, P, p) {
    const fr = Math.floor(p.age * 20), r = rng(p.seed * 31 + fr);
    let [x, y] = v.ap(...p.a); const [tx, ty] = v.ap(...p.b);
    x = Math.round(x); y = Math.round(y);
    const X = Math.round(tx), Y = Math.round(ty), path = [[x, y]];
    for (let g = 0; g < 800 && (Math.abs(X - x) > 1 || Math.abs(Y - y) > 1); g++) {
      let di = Math.round(Math.atan2(Y - y, X - x) / (TAU / 8));
      const rv = r(); if (rv < 0.22) di--; else if (rv > 0.78) di++;
      const d = DIRS8[((di % 8) + 8) % 8], run = 1 + Math.floor(r() * 3);
      for (let s = 0; s < run; s++) { x += d[0]; y += d[1]; path.push([x, y]); }
    }
    const a = fadeOut(p.age / p.life, 0.6);
    for (const [px, py] of path) P.dot(px, py, S(p.R, 1), a);
    for (const [px, py] of path) { P.under(px + 1, py, S(p.R, 0.62)); P.under(px - 1, py, S(p.R, 0.62)); }
    for (let b = 0; b < 2 && path.length > 6; b++) {
      let [bx, by] = path[2 + Math.floor(r() * (path.length - 4))];
      const d = DIRS8[Math.floor(r() * 8)], L = 3 + Math.floor(r() * 6);
      for (let s = 0; s < L; s++) { const d2 = r() < 0.3 ? DIRS8[Math.floor(r() * 8)] : d; bx += d2[0]; by += d2[1]; P.dot(bx, by, S(p.R, 0.82), a); }
    }
  },
  halo(v, P, p) {
    const u = clamp(p.age / p.life), [cx, cy] = v.ap(p.x, p.y, p.z), rx = p.r * v.aps * (1 + u * 0.4);
    P.ellipse(cx, cy, rx, Math.max(0.5, rx * v.sq), (q) => ({ c: S(p.R, Math.floor((q * 6) / TAU + p.age * 6) % 2 ? 0.95 : 0.7), a: 1 - u }));
  },
});

/* ── Ground shapes: decals and footprints ─────────────────────────────── */

registerShapes({
  ring(v, P, p) {
    const u = clamp(q12(p.age) / p.life), fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, 0), rx = p.r * v.aps * easeOut(u);
    if (rx < 1) return;
    for (let k = 0; k < (u < 0.5 ? 2 : 1); k++)
      P.ellipse(cx, cy, rx - k, Math.max(0.5, (rx - k) * v.sq), (q) => (p.broken && pnoise(q + fr * 0.15, 12, p.seed) < 0.3 ? null : { c: S(p.R, k ? 0.62 : 0.95), a: 1 - u }));
  },
  scorch(v, P, p) {
    const u = p.age / p.life, a = 0.85 * fadeOut(u, 0.5), [cx, cy] = v.ap(p.x, p.y, 0), rx = p.r * v.aps, ry = rx * v.sq, R = p.R ?? RAMP.smoke;
    P.shade(cx - rx - 2, cy - ry - 2, cx + rx + 2, cy + ry + 2, (x, y) => {
      const dx = (x - cx) / rx, dy = (y - cy) / ry, d = Math.hypot(dx, dy);
      const e = 0.85 + pnoise(Math.atan2(dy, dx), 9, p.seed) * 0.3;
      if (d > e) return null;
      return { c: S(R, d < e * 0.55 ? 0 : 0.17), a: a * (d < e * 0.55 ? 0.9 : 0.55) };
    }, 0, "mix");
  },
  frost(v, P, p) {
    const u = p.age / p.life, a = fadeOut(u, 0.6), g = Math.min(1, (Math.floor(p.age * 12) + 1) / 4), [cx, cy] = v.ap(p.x, p.y, 0), rx = p.r * v.aps * g, ry = rx * v.sq;
    const rim = (q) => 0.8 + pnoise(q, 11, p.seed) * 0.35;
    P.shade(cx - rx - 2, cy - ry - 2, cx + rx + 2, cy + ry + 2, (x, y) => {
      const dx = (x - cx) / Math.max(1, rx), dy = (y - cy) / Math.max(1, ry), d = Math.hypot(dx, dy), e = rim(Math.atan2(dy, dx));
      if (d > e) return null;
      return d > e - 0.1 ? { c: S(p.R, 0.85), a } : { c: S(p.R, 0.5), a: a * 0.4 };
    }, 0, "mix");
    for (let i = 0; i < 7; i++) {
      const q = (i / 7) * TAU + hash(i, p.seed) * 0.6, L = rim(q) * (0.65 + 0.3 * hash(i, p.seed, 1));
      const x0 = cx + Math.cos(q) * rx * 0.15, y0 = cy + Math.sin(q) * ry * 0.15, x1 = cx + Math.cos(q) * rx * L, y1 = cy + Math.sin(q) * ry * L;
      P.line(x0, y0, x1, y1, S(p.R, 0.95), 0, a);
      const mx = lerp(x0, x1, 0.55), my = lerp(y0, y1, 0.55), qb = q + (hash(i, p.seed, 2) < 0.5 ? -0.6 : 0.6);
      P.line(mx, my, mx + Math.cos(qb) * rx * 0.22, my + Math.sin(qb) * ry * 0.22, S(p.R, 0.78), 0, a);
    }
  },
  puddle(v, P, p) {
    const a = fadeOut(p.age / p.life, 0.6), g = Math.min(1, (Math.floor(p.age * 12) + 1) / 3), [cx, cy] = v.ap(p.x, p.y, 0);
    const rx = Math.max(1, p.r * v.aps * g), ry = Math.max(1, rx * v.sq * 0.9);
    P.shade(cx - rx - 1, cy - ry - 1, cx + rx + 1, cy + ry + 1, (x, y) => {
      const dx = (x - cx) / rx, dy = (y - cy) / ry, d = dx * dx + dy * dy;
      if (d > 1) return null;
      let t = 0.45;
      if (dy < -0.55 && d > 0.45) t = 0.85; else if (dy > 0.6 && d > 0.5) t = 0.2; else if (dx < -0.2 && dy < -0.1 && d < 0.25) t = 0.7;
      return a < 1 ? { c: S(p.R, t), a } : S(p.R, t);
    }, 0, "mix");
  },
  darkpool(v, P, p) {
    const u = p.age / p.life, a = (u < 0.2 ? u / 0.2 : 1 - (u - 0.2) / 0.8) * 0.75, [cx, cy] = v.ap(p.x, p.y, 0), rx = p.r * v.aps, ry = rx * v.sq;
    P.shade(cx - rx, cy - ry, cx + rx, cy + ry, (x, y) => {
      const dx = (x - cx) / rx, dy = (y - cy) / ry, d = dx * dx + dy * dy;
      return d > 1 ? null : { c: S(p.R, 0), a: a * (d < 0.5 ? 1 : 0.6) };
    }, 0, "mix");
  },
  glyph(v, P, p) {
    const u = p.age / p.life, a = u < 0.15 ? u / 0.15 : fadeOut(u, 0.75), fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, 0), r = p.r * v.aps, sq = v.sq;
    const glyphs = p.glyphs ?? GLYPHS;
    P.ellipse(cx, cy, r, r * sq, () => ({ c: S(p.R, 0.85), a }));
    P.ellipse(cx, cy, r * 0.72, r * 0.72 * sq, () => ({ c: S(p.R, 0.6), a }));
    const rot = fr * 0.12 * (p.spin ?? 1);
    for (let i = 0; i < 6; i++) {
      const q = rot + (i * TAU) / 6, gx = Math.round(cx + Math.cos(q) * r * 0.86), gy = Math.round(cy + Math.sin(q) * r * 0.86 * sq), G = glyphs[((i + fr) >> 2) % glyphs.length];
      for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) if (G[j * 3 + k] === "1") P.dot(gx - 1 + k, gy - 1 + j, S(p.R, 0.95), a);
    }
    if (p.star) for (let i = 0; i < 5; i++) {
      const q0 = -rot + (i * TAU) / 5, q1 = -rot + ((i + 2) * TAU) / 5;
      P.line(cx + Math.cos(q0) * r * 0.66, cy + Math.sin(q0) * r * 0.66 * sq, cx + Math.cos(q1) * r * 0.66, cy + Math.sin(q1) * r * 0.66 * sq, S(p.R, 0.9), 0, a);
    }
  },
  mark(v, P, p) {
    const fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, 0), rx = p.r * v.aps, ry = rx * v.sq, n = Math.round(rx * 1.4);
    P.shade(cx - rx, cy - ry, cx + rx, cy + ry, (x, y) => { const dx = (x - cx) / rx, dy = (y - cy) / ry; return dx * dx + dy * dy < 1 ? { c: S(p.R, 0.5), a: 0.25 } : null; }, 0, "mix");
    P.ellipse(cx, cy, rx, ry, (q) => (Math.floor((q / TAU) * n + fr) % 3 === 2 ? null : S(p.R, 0.82)));
  },
  cone(v, P, p) {
    const u = p.age / p.life, a = 1 - u, fr = Math.floor(p.age * 12), o = v.ap(p.x, p.y, 0), pts = [o];
    for (let i = 0; i <= 12; i++) { const q = p.dir - p.half + (2 * p.half * i) / 12; pts.push(v.ap(p.x + Math.cos(q) * p.len, p.y + Math.sin(q) * p.len, 0)); }
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    P.shade(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (x, y) => (inPoly(pts, x, y) ? { c: S(p.R, 0.5), a: 0.25 * a } : null), 0, "mix");
    const dash = (A, B) => P.line(A[0], A[1], B[0], B[1], null, 0, a, (_f, i) => ((i + fr) % 4 < 2 ? S(p.R, 0.85) : null));
    dash(o, pts[1]); dash(o, pts[13]);
  },
  lane(v, P, p) {
    // a line area's footprint: a translucent band with dashed edges
    const u = p.age / p.life, a = 1 - u, fr = Math.floor(p.age * 12), hw = p.width / 2, c = Math.cos(p.dir), s = Math.sin(p.dir);
    const corner = (f, side) => v.ap(p.x + c * p.len * f - s * hw * side, p.y + s * p.len * f + c * hw * side, 0);
    const pts = [corner(0, -1), corner(1, -1), corner(1, 1), corner(0, 1)];
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    P.shade(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (x, y) => (inPoly(pts, x, y) ? { c: S(p.R, 0.5), a: 0.25 * a } : null), 0, "mix");
    const dash = (A, B) => P.line(A[0], A[1], B[0], B[1], null, 0, a, (_f, i) => ((i + fr) % 4 < 2 ? S(p.R, 0.85) : null));
    dash(pts[0], pts[1]); dash(pts[3], pts[2]);
  },
}, { flat: ["ring", "scorch", "frost", "puddle", "darkpool", "glyph", "mark", "cone", "lane"] });
