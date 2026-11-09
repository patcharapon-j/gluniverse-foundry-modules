/**
 * Spellsprite — motifs: the object an effect depicts (constants.mjs
 * MOTIF_VOCAB), from the name's nouns. Pure.
 *
 * `MOTIFS[motif]` may carry any of these hooks; a delivery calls the ones that
 * exist and draws its own default otherwise. A missing motif is never an error.
 *
 *   carrier(s, M, p)                          decorate or replace the travelling particle p
 *   impact(s, M, { x, y, z, pow, rad, at })   the object landing
 *   conjure(s, M, { x, y, z, h, at, life })   the object appearing (forms, summons)
 *   residue(s, M, { x, y, at })               what stays behind
 *
 * What each hook promises a delivery:
 *
 *   carrier  swaps p's look for the object (p.k becomes a `mo*` shape) and
 *            keeps its flight: p's own update (or plain physics) still moves
 *            it, its trail still sheds and its glow still lights. It may be
 *            called before or after `s.add(p)`.
 *   impact   draws the object arriving, its flash and its light. It does not
 *            flinch anyone (`s.hit` is the delivery's) and it draws no family
 *            burst, so a delivery keeps its own release under it.
 *   conjure  the object appears at `at`, stays about `life` seconds and goes.
 *   residue  a ground mark that fades over a few seconds.
 *
 * Every hook schedules itself at `at` (or now, when `at` is past or missing),
 * so it can be called while compiling or from inside a cue.
 *
 * Every object draws in the effect's material ramp `M.R`: the damage colours
 * it, the name shapes it. Sizes are art pixels at 26 per square. Objects are
 * bitmaps (`B`, tones below) or small procedural shapes, always outlined
 * (flag 2) and stepped on the 12 fps sprite clock. A travelling object faces
 * its flight in 16 directions; upright ones stay upright and only turn round.
 *
 * Bitmap tones: "1" lightest … "6" darkest ramp steps, "w" white (hero), "k"
 * ink, "." empty. flavors.mjs draws its props with the same kit.
 */

import { TAU, clamp, lerp, easeOut, hash, fadeOut, rng } from "./core/rand.mjs";
import { S, WHITE, INK } from "./core/palette.mjs";
import { DRAW, GLYPHS, registerShapes, snapH } from "./core/shapes.mjs";
import { physics } from "./core/sim.mjs";
import { still, lobes, sd, splat } from "./core/motifs.mjs";

/* ── the sprite kit ─────────────────────────────────────────────────── */

/** A bitmap: rows top first, padded to one width. */
export const B = (...rows) => {
  const w = Math.max(...rows.map((r) => r.length));
  return Object.freeze(rows.map((r) => r.padEnd(w, ".")));
};
/** A bitmap mirrored left to right (a left wing from a right one). */
export const mirror = (bm) => Object.freeze(bm.map((r) => [...r].reverse().join("")));

/**
 * A bitmap drawn at twice its size the way a pixel artist would redraw it, not
 * blown up: Scale2x (EPX) rounds every diagonal step into a smooth edge, then
 * the edges are re-rimmed one pixel wide (lit on the top and left, shaded on
 * the bottom and right), so the object is twice as big while its outline,
 * rims and highlights stay one art pixel. A white hero pixel stays one pixel.
 * spellsprite-craft §1: the art pixel never grows, the object does.
 */
export function up2(bm) {
  const h = bm.length, w = bm[0].length, at = (i, j) => (i < 0 || j < 0 || i >= w || j >= h ? "." : bm[j][i]);
  const soft = (c) => (c === "w" ? "1" : c);
  const out = Array.from({ length: h * 2 }, () => new Array(w * 2).fill("."));
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const P = at(i, j), A = at(i, j - 1), Bq = at(i + 1, j), C = at(i - 1, j), D = at(i, j + 1);
    let e = [P, P, P, P];
    if (P === "w") e = ["w", "1", "1", "1"];
    else {
      if (C === A && C !== D && A !== Bq) e[0] = soft(A);
      if (A === Bq && A !== C && Bq !== D) e[1] = soft(Bq);
      if (D === C && D !== Bq && C !== A) e[2] = soft(C);
      if (Bq === D && Bq !== A && D !== C) e[3] = soft(D);
    }
    out[j * 2][i * 2] = e[0]; out[j * 2][i * 2 + 1] = e[1]; out[j * 2 + 1][i * 2] = e[2]; out[j * 2 + 1][i * 2 + 1] = e[3];
  }
  const on = (i, j) => i >= 0 && j >= 0 && i < w * 2 && j < h * 2 && out[j][i] !== ".";
  const rim = out.map((row, j) => row.map((c, i) => {
    if (c === "." || c === "w" || c === "k") return c;
    const n = Number(c);
    if (!on(i, j - 1) || !on(i - 1, j)) return String(Math.max(1, n - 1));
    if (!on(i, j + 1) || !on(i + 1, j)) return String(Math.min(6, n + 1));
    return c;
  }).join(""));
  return Object.freeze(rim);
}
/** A bitmap, redrawn at twice its size (see up2). */
export const B2 = (...rows) => up2(B(...rows));

/** How much bigger the procedural objects draw than their authored sizes: spellsprite-craft §1. */
const MO = 1.6;

const CODE = { w: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, k: 7 };
const IDX = [6, 6, 5, 4, 3, 2, 1];
/** A bitmap tone in a ramp, `dim` steps darker. */
const tone = (R, code, dim = 0) => (code === 0 ? (dim > 0 ? R[R.length - 1] : WHITE) : code === 7 ? INK : R[Math.max(0, IDX[code] - dim)]);

/**
 * A bitmap's pixels about its centre pixel, turned `ai` sixteenths of a turn
 * (clockwise on screen) and optionally mirrored first, as [dx, dy, code]
 * triples. Turning samples nearest-neighbour backwards, so it never leaves
 * holes; results are cached per bitmap.
 */
const CELLS = new WeakMap();
function cells(bm, ai, flip) {
  let per = CELLS.get(bm);
  if (!per) { per = new Map(); CELLS.set(bm, per); }
  const key = (ai << 1) | (flip ? 1 : 0);
  const hit = per.get(key);
  if (hit) return hit;
  const h = bm.length, w = bm[0].length, px = Math.floor(w / 2), py = Math.floor(h / 2), list = [];
  const at = (i, j) => (i < 0 || j < 0 || i >= w || j >= h ? -1 : CODE[bm[j][flip ? w - 1 - i : i]] ?? -1);
  if (ai === 0) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const c = at(i, j); if (c >= 0) list.push(i - px, j - py, c); }
  } else {
    const q = (ai * TAU) / 16, co = Math.cos(q), si = Math.sin(q), r = Math.ceil(Math.hypot(w, h) / 2) + 1;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const c = at(Math.floor(co * dx + si * dy + px + 0.5), Math.floor(-si * dx + co * dy + py + 0.5));
      if (c >= 0) list.push(dx, dy, c);
    }
  }
  const out = Int16Array.from(list);
  per.set(key, out);
  return out;
}

const snapAng = (a) => ((Math.round(a / (TAU / 16)) % 16) + 16) % 16;

/**
 * Draw a bitmap with its centre pixel at (x, y). Options: ang (radians,
 * screen), flip, a (alpha), o (outline flag), dim (tone steps), hot (all
 * white: a hero frame), base (the bottom row sits on y), grow (0..1, only the
 * bottom part shows: rising out of the ground), sq (vertical squash: a decal
 * on the ground), mix (translucent: no outline, no dither).
 */
export function blit(P, bm, x, y, R, { ang = 0, flip = false, a = 1, o = 2, dim = 0, hot = false, base = false, grow = 1, sq = 1, mix = false } = {}) {
  if (a <= 0 || grow <= 0) return;
  const C = cells(bm, snapAng(ang), flip), h = bm.length, half = Math.floor(h / 2);
  const oy = base ? h - 1 - half : 0, cut = grow < 1 ? Math.ceil(h * (1 - grow)) - half : -1e9;
  x = Math.round(x); y = Math.round(y);
  for (let i = 0; i < C.length; i += 3) {
    const dy = C[i + 1];
    if (dy < cut) continue;
    const c = hot ? WHITE : tone(R, C[i + 2], dim), Y = y + Math.round((dy - oy) * sq);
    if (mix) P.mix(x + C[i], Y, c, a); else P.dot(x + C[i], Y, c, a, o);
  }
}

/** Fade in over `inT`, out over the end of a finite life. */
const env = (p) => (p.life >= 1e8 ? 1 : Math.min(1, p.inT ? p.age / p.inT : 1) * fadeOut(p.age / p.life, p.from ?? 0.7));

/** Which way a particle is travelling on screen, held while it stands still. */
function headingOf(v, p) {
  const key = "_h" + v.key, [hx, hy] = v.ap(p.x, p.y, p.z);
  let d = null;
  if (p.tail) {
    const [tx, ty] = v.ap(p.tail[0], p.tail[1], p.tail[2]);
    if (Math.abs(hx - tx) + Math.abs(hy - ty) > 0.6) d = Math.atan2(hy - ty, hx - tx);
  }
  if (d == null) {
    const m = p.hd ?? ((p.vx || p.vy || p.vz) ? [p.vx, p.vy, p.vz] : null);
    if (m) {
      const [bx, by] = v.ap(p.x + m[0] * 0.05, p.y + m[1] * 0.05, p.z + m[2] * 0.05);
      if (Math.abs(bx - hx) + Math.abs(by - hy) > 0.05) d = Math.atan2(by - hy, bx - hx);
    }
  }
  if (d == null) d = p[key] ?? p.ang ?? 0;
  p[key] = d;
  return d;
}

/** The frame a sprite particle shows now. */
function frameOf(p) {
  if (!p.frames) return p.bm;
  const n = p.frames.length, f = Math.floor(p.age * (p.fps ?? 12));
  return p.frames[p.loop ? f % n : Math.min(n - 1, f)];
}

/**
 * The sprite particle. Fields: bm or frames (+ fps, loop), face (true: point
 * along the flight; "lr": stay upright, turn round when it flies left), keepUp
 * (a faced object never shows upside down), off (added to the facing), ang,
 * spin (radians per sprite frame), flip, bob (px), hero (white frames first),
 * grow (seconds to rise out of the ground), base, snap, alpha, mix, dim.
 */
function drawSprite(v, P, p, flat) {
  const fr = Math.floor(p.age * 12), bm = frameOf(p);
  if (!bm) return;
  let [x, y] = v.ap(p.x, p.y, p.z);
  if (p.snap) [x, y] = snapH(p, v, x, y);
  if (p.bob) y += Math.round(Math.sin((fr + (p.ph ?? 0)) * 0.8) * p.bob);
  let ang = p.ang ?? 0, flip = !!p.flip;
  if (p.face === "lr") flip = Math.cos(headingOf(v, p)) < 0 !== flip;
  else if (p.face) {
    ang = headingOf(v, p) + (p.off ?? 0);
    if (p.keepUp && Math.cos(ang - (p.off ?? 0)) < 0) { flip = !flip; ang = ang + Math.PI - 2 * (p.off ?? 0); }
  }
  if (p.spin) ang += p.spin * fr;
  blit(P, bm, x, y, p.R, {
    ang, flip, a: (p.alpha ?? 1) * env(p), o: p.o ?? 2, dim: p.dim ?? 0, hot: fr < (p.hero ?? 0), base: !!p.base,
    grow: p.grow ? clamp(p.age / p.grow) : 1, sq: flat ? v.sq : 1, mix: !!p.mix,
  });
}

/* ── travelling: the carrier's flight record ────────────────────────── */

/**
 * Swap a travelling particle's look for an object. Its update (or physics)
 * still moves it; the wrapper records where it has been (`p.hist`, newest
 * last, and `p.o0` where it started) and which way it moves (`p.hd`), and runs
 * `p.shed(p, s, dt)` for whatever the object leaves behind.
 */
export function ride(p, extra = {}) {
  Object.assign(p, { k: "moRide", ...extra });
  if (p._rides) return p;
  p._rides = true;
  const up = p.update;
  p.update = (q, s, dt) => {
    const x = q.x, y = q.y, z = q.z;
    q.o0 ??= [x, y, z];
    if (up) up.call(q, q, s, dt); else physics(q, dt, s);
    const dx = q.x - x, dy = q.y - y, dz = q.z - z;
    if (dt > 0 && dx * dx + dy * dy + dz * dz > 1e-12) q.hd = [dx / dt, dy / dt, dz / dt];
    const H = (q.hist ??= [[x, y, z]]), L = H[H.length - 1];
    if (Math.abs(L[0] - q.x) + Math.abs(L[1] - q.y) + Math.abs(L[2] - q.z) > 0.04) { H.push([q.x, q.y, q.z]); if (H.length > 24) H.shift(); }
    q.shed?.(q, s, dt);
  };
  return p;
}

/** Screen points of a ride's path: its history, newest last, ending at the head. */
function pathOf(v, p) {
  const pts = (p.hist ?? []).map((h) => v.ap(h[0], h[1], h[2]));
  pts.push(v.ap(p.x, p.y, p.z));
  return pts;
}

/**
 * Walk a screen polyline from its LAST point backwards one pixel at a time:
 * `fn(x, y, d, nx, ny)` with d the pixels walked and (nx, ny) the unit normal.
 */
function walkBack(pts, maxD, fn) {
  let d = 0;
  for (let i = pts.length - 1; i > 0; i--) {
    const [ax, ay] = pts[i], [bx, by] = pts[i - 1], L = Math.hypot(bx - ax, by - ay);
    if (L < 1e-6) continue;
    const ux = (bx - ax) / L, uy = (by - ay) / L;
    for (let t = d === 0 ? 0 : 1 - (d % 1); t <= L; t += 1) {
      if (d > maxD) return;
      fn(ax + ux * t, ay + uy * t, d, -uy, ux);
      d += 1;
    }
  }
}

/** The straight path from where a ride started to its head, as two screen points. */
const spanOf = (v, p) => [p.o0 ? v.ap(p.o0[0], p.o0[1], p.o0[2]) : v.ap(p.x, p.y, p.z), v.ap(p.x, p.y, p.z)];

/** Walk a straight screen segment from A to B: `fn(x, y, f, nx, ny, i)`. */
function walkLine(A, B, fn) {
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]), n = Math.max(1, Math.ceil(L)), ux = (B[0] - A[0]) / (L || 1), uy = (B[1] - A[1]) / (L || 1);
  for (let i = 0; i <= n; i++) fn(A[0] + ux * i, A[1] + uy * i, i / n, -uy, ux, i);
}

/** What a ride trails behind it: each draws from the path into P. */
const TRAILS = {
  /** A chain from the hand to the head: face-on rings and edge-on links in turn, sagging. */
  chain(v, P, p) {
    const [A, H] = spanOf(v, p), L = Math.hypot(H[0] - A[0], H[1] - A[1]), sag = Math.min(6, L * 0.08), fr = Math.floor(p.age * 12);
    walkLine(A, H, (x, y, f, nx, ny, i) => {
      const yy = y + Math.sin(Math.PI * f) * sag, m = (i + fr) % 6;
      if (m === 1 || m === 2) { P.dot(x + nx, yy + ny, S(p.R, 0.95), 1, 2); P.dot(x - nx, yy - ny, S(p.R, 0.62), 1, 2); }
      else P.dot(x, yy, S(p.R, m === 0 || m === 3 ? 0.95 : 0.78), 1, 2);
    });
  },
  /** A whip from the hand to the tip, a wave running down it; the cracker at the tip is white. */
  whip(v, P, p) {
    const [A, H] = spanOf(v, p), fr = Math.floor(p.age * 12);
    walkLine(A, H, (x, y, f, nx, ny) => {
      const amp = Math.sin(Math.PI * f) * Math.min(4, 1 + f * 4), w = Math.sin(f * 9 - fr * 1.6) * amp;
      P.dot(x + nx * w, y + ny * w, f > 0.96 ? WHITE : S(p.R, f < 0.2 ? 0.62 : 0.8), 1, 2);
      if (f < 0.3) P.dot(x + nx * w, y + ny * w + 1, S(p.R, 0.5), 1, 2);
    });
  },
  /** A vine from the hand to the head: a stem with leaves on alternate sides. */
  vine(v, P, p) {
    const [A, H] = spanOf(v, p), fr = Math.floor(p.age * 12);
    walkLine(A, H, (x, y, f, nx, ny, i) => {
      const w = Math.sin(i * 0.35 + fr * 0.3) * 2.2, cx = x + nx * w, cy = y + ny * w;
      P.dot(cx, cy, S(p.R, 0.62), 1, 2); P.dot(cx, cy + 1, S(p.R, 0.45), 1, 2);
      if (i % 7 === 3) { const sd2 = (i / 7) % 2 ? 1 : -1; P.dot(cx + nx * 2 * sd2, cy + ny * 2 * sd2, S(p.R, 0.95), 1, 2); P.dot(cx + nx * 3 * sd2, cy + ny * 3 * sd2 - 1, S(p.R, 0.78), 1, 2); }
    });
  },
  /** A jagged bolt from the hand to the head, re-struck 20 times a second. */
  bolt(v, P, p) {
    const [A, H] = spanOf(v, p), r = rng((p.seed ?? 7) * 131 + Math.floor(p.age * 20)), L = Math.hypot(H[0] - A[0], H[1] - A[1]);
    const n = Math.max(2, Math.round(L / 6)), pts = [A];
    for (let i = 1; i < n; i++) { const f = i / n; pts.push([lerp(A[0], H[0], f) + (r() - 0.5) * 7, lerp(A[1], H[1], f) + (r() - 0.5) * 7]); }
    pts.push(H);
    for (let i = 1; i < pts.length; i++) {
      P.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], S(p.R, 1), 2);
      P.line(pts[i - 1][0] + 1, pts[i - 1][1], pts[i][0] + 1, pts[i][1], S(p.R, 0.62), 1);
    }
  },
  /** A long straight beam behind the head: a white core with the material on both sides. */
  ray(v, P, p) {
    const [A, H] = spanOf(v, p);
    walkLine(A, H, (x, y, f, nx, ny) => {
      if (f < 0.35 && Math.floor(f * 40) % 2) return;
      P.dot(x, y, f > 0.5 ? WHITE : S(p.R, 1), 1, 2); P.dot(x + nx, y + ny, S(p.R, 0.78), 1, 2); P.dot(x - nx, y - ny, S(p.R, 0.62), 1, 2);
    });
  },
  /** A sewing thread: a thin broken line along the path. */
  thread(v, P, p) {
    walkBack(pathOf(v, p), 30, (x, y, d) => { if (d > 3 && (d >> 1) % 2 === 0) P.dot(x, y, S(p.R, 0.62), 1, 1); });
  },
  /** A serpent's body: a thick coil swinging behind the head, banded scales. */
  serpent(v, P, p) {
    const fr = Math.floor(p.age * 12), len = p.len ?? 20;
    walkBack(pathOf(v, p), len, (x, y, d, nx, ny) => {
      if (d < 3) return;
      const w = Math.sin(d * 0.45 - fr * 1.2) * Math.min(3, d * 0.25), cx = x + nx * w, cy = y + ny * w, t = (d >> 1) % 2 ? 0.78 : 0.62;
      const th = d > len - 4 ? 0 : 1;
      P.dot(cx, cy, S(p.R, t), 1, 2);
      if (th) P.dot(cx, cy + 1, S(p.R, 0.45), 1, 2);
    });
  },
  /** A comet's tail: a widening plume, white near the head. */
  comet(v, P, p) {
    const len = p.len ?? 22, fr = Math.floor(p.age * 12);
    walkBack(pathOf(v, p), len, (x, y, d, nx, ny) => {
      const w = Math.min(4, 1 + d * 0.18), f = d / len;
      for (let k = -Math.floor(w); k <= Math.floor(w); k++) {
        if (Math.abs(k) > w * (1 - f * 0.4) || hash(d, k, fr) < f * 0.7) continue;
        P.dot(x + nx * k, y + ny * k, f < 0.15 && Math.abs(k) < 1 ? WHITE : S(p.R, 1 - f * 0.6 - Math.abs(k) * 0.06), 1, 1);
      }
    });
  },
  /** Three parallel talon marks trailing the head. */
  rake(v, P, p) {
    const pts = pathOf(v, p);
    for (const off of [-5, 0, 5]) walkBack(pts, 18, (x, y, d, nx, ny) => { P.dot(x + nx * off, y + ny * off, d < 2 ? WHITE : S(p.R, 0.95 - d * 0.03), 1, 2); if (d < 10) P.dot(x + nx * (off + 1), y + ny * (off + 1), S(p.R, 0.7), 1, 2); });
  },
  /** Speed lines behind a punch. */
  speed(v, P, p) {
    const pts = pathOf(v, p);
    for (const off of [-7, -3, 3, 7]) walkBack(pts, 26, (x, y, d, nx, ny) => { if (d > 6 && d < 26 - Math.abs(off) * 1.5) P.dot(x + nx * off, y + ny * off, S(p.R, d < 14 ? 0.9 : 0.7), 1, 1); });
  },
  /** A gust: two lines along the path, each ending in a curl. */
  wind(v, P, p) {
    const pts = pathOf(v, p), fr = Math.floor(p.age * 12);
    for (const off of [-3, 3]) {
      let end = null;
      walkBack(pts, 16, (x, y, d, nx, ny) => { const w = off + Math.sin(d * 0.4 + fr) * 1.2; if (d > 2) P.dot(x + nx * w, y + ny * w, S(p.R, 0.9 - d * 0.02), 1, 1); end = [x + nx * w, y + ny * w]; });
      if (end) for (let k = 0; k < 6; k++) { const q = k * 1.1 + fr * 0.5; P.dot(end[0] + Math.cos(q) * 2, end[1] + Math.sin(q) * 2, S(p.R, 0.78), 1, 1); }
    }
  },
  /** A ghost's wisp of a tail. */
  wisp(v, P, p) {
    const fr = Math.floor(p.age * 12);
    walkBack(pathOf(v, p), 12, (x, y, d, nx, ny) => { if (d > 3) P.mix(x + nx * Math.sin(d * 0.6 - fr) * 2, y + ny * Math.sin(d * 0.6 - fr) * 2, S(p.R, 0.82), 0.75 - d * 0.05); });
  },
  /** Letters streaming behind the head, a cipher glyph every 5 px. */
  letters(v, P, p) {
    const fr = Math.floor(p.age * 12);
    walkBack(pathOf(v, p), 22, (x, y, d) => { if (d > 3 && d % 5 === 0) blit(P, LETTERS[(d / 5 + fr + (p.seed ?? 0)) % LETTERS.length], x, y - Math.sin(d * 0.5 + fr) * 2, p.R, { o: 2 }); });
  },
};

/* ── the bitmaps ────────────────────────────────────────────────────── */
// Directional objects point RIGHT (they are turned to face their flight);
// standing ones are upright.

const SWORD = B2(
  "..3............",
  "..311111111111.",
  "543222222222222w",
  "..344444444444.",
  "..3............",
);
const AXE = B2(
  ".....1111111",
  "......22222.",
  ".......222..",
  "........3...",
  "44444444333.",
  "........3...",
  ".......222..",
  "......22222.",
  ".....1111111",
);
const MACE = B2(
  ".........1...",
  "........121..",
  ".......12221.",
  "4444444122w21",
  ".......12221.",
  "........323..",
  ".........3...",
);
const HAMMER = B2(
  "........11111",
  "........12222",
  "........12222",
  "4444444432222",
  "........32224",
  "........34444",
  "........34444",
);
const SPEAR = B2(
  "..............11..",
  "44444444444443222w",
  "..............44..",
);
const ARROW = B2(
  "1.1......2.",
  ".444444442w",
  "1.1......2.",
);
const NEEDLE = B2("4.3222111w");
const HAND = B2(
  "...1.1....",
  ".1.1.1.1..",
  ".1.1.1.1..",
  ".1.1.1.1.1",
  ".1111111.1",
  ".12222221.",
  ".1222222..",
  "..122222..",
  "..122222..",
  "...3333...",
);
/** A hand closed into a grab, seen from the front. */
const HAND_SHUT = B2(
  "..........",
  "..........",
  "..........",
  ".11111111.",
  "1232323231",
  "1222222221",
  ".1222222..",
  "..122222..",
  "..122222..",
  "...3333...",
);
const FIST = B2(
  "...11111..",
  "..1222221.",
  "4412323231",
  "4412323231",
  "4412222221",
  "...122221.",
  "....3333..",
);
const EYE = [
  B2(".............", ".............", ".............", "3333333333333", ".............", ".............", "............."),
  B2(".............", ".............", "...3333333...", "3111122211113", "..333333333..", ".............", "............."),
  B2("....33333....", "..331111133..", ".31112221113.", "31112kwk21113", ".31112221113.", "..331111133..", "....33333...."),
];
const HEART = B2(".11.22.", "1w12222", "1122223", ".12223.", "..123..", "...3...");
const HEART_BIG = B2(".111.222.", "1w1112222", "112222223", "122222233", ".1222233.", "..12233..", "...123...", "....3....");
const HEART_MINI = B("1.2", "122", ".2.");
const SKULL = B2("..11111..", ".1111111.", "111111112", "1kk111kk2", "1kk111kk2", "1111k1112", ".1121212.", "..1k1k1..", "..22222..");
const SKULL_LIT = B2("..11111..", ".1111111.", "111111112", "1ww111ww2", "1ww111ww2", "1111k1112", ".1121212.", "..1k1k1..", "..22222..");
const SKULL_GAPE = B2("..11111..", ".1111111.", "111111112", "1kk111kk2", "1kk111kk2", "1111k1112", ".1121212.", "..1k1k1..", ".........", "..1k1k1..", "..22222..");
const BONE = B2("11.....11", "122222221", "33.....33");
/** A bone jutting from the ground, knobbed end up. */
const BONE_UP = B2("1.1", "121", ".2.", ".2.", ".2.", ".3.", ".3.", "343");
const DROP = B2("..1..", "..1..", ".121.", "12222", "1w223", "12233", ".333.");
const WING = [
  B2("........111", "......11221", "....112221.", "..1122221..", ".122222 1..", "1222221.1..", "2222.2.2...", "3.3.3......"),
  B2("...........", "...........", "........11.", "..111122221", ".12222222.1", "12222221.1.", "2222.2.2...", "3.3.3......"),
];
const FEATHER = B2("...11111..", "4432222221", "...33333..");
const SUN_DISC = null; // procedural (moSun)
const MOON = B2("..1111.", ".112...", "112....", "12.....", "12.....", "112....", ".112...", "..1111.");
const STAR = B2("...1...", "..111..", "1111111", ".11w11.", "..111..", ".11.11.", ".1...1.");
const BOULDER = B2("..2222..", ".211112.", "211w1123", "21111223", "32112233", ".333333.");
const MENHIR = B2("..22..", ".2112.", ".2112.", "21112.", "21123.", "21123.", "21123.", "21123.", "2112334", "4444444");
const SHARD = B2("...1...", "..1w2..", ".11223.", "1122333", ".12233.", "..223..", "...3...");
const SPIKE = B2("1.......", "2211....", "322221w.", "4433....", "3.......");
const THORN = B2("..1....", "..21...", "3322221w", "..43...", "..3....");
const WAVE = [
  B2("..............", "..............", "........222...", "......221111..", ".....2111..1..", "...221111.....", ".22111111.....", "33333333333333"),
  B2(".......22221..", ".....2211111w.", "....2111...11.", "...2111.....1.", "..21111.......", ".2111111......", "21111111......", "33333333333333"),
  B2("..............", ".........2222.", "......221111w1", "....2211111.11", "..22111111..1.", ".2111111111...", "21111111111...", "33333333333333"),
];
const VINE_LEAF = B(".11", "122", "33.");
const FLOWER = [
  B2("...", "...", ".2.", ".4.", ".4."),
  B2(".....", "..2..", ".212.", "..4..", "..4..", ".44.."),
  B2("..1.1..", ".11211.", "1121211", ".22w22.", "1121211", ".11211.", "..141..", "...4...", "..44..."),
];
const LEAF = B2("..111..", "4322221", "..333..");
const MUSHROOM = B2("..111..", ".12w21.", "1222222", "3333333", "..343..", "..343..", ".44444.");
const GHOST = [
  B2("..11111..", ".1111111.", "111111111", "11kk1kk11", "11kk1kk11", "111111111", "1111k1111", "111111111", "111111111", "11.111.11", "1...1...1"),
  B2("..11111..", ".1111111.", "111111111", "11kk1kk11", "11kk1kk11", "111111111", "1111k1111", "111111111", "111111111", "111.111.1", ".1...1..."),
];
const RUNES = [
  B2("1.1..", "11..1", "1..1.", "1.1..", "11...", "1....", "1...."),
  B2("1....", "11...", "1.1..", "1..1.", "1.1..", "11...", "1...."),
  B2("1.1.1", ".111.", "..1..", "..1..", "..1..", "..1..", "..1.."),
  B2("...1.", "..1..", ".1...", "..1..", "...1.", "..1..", ".1..."),
  B2("..1..", ".111.", "1.1.1", "..1..", "..1..", "..1..", "..1.."),
];
/** A cipher alphabet for words: 3×5 letters that read as writing, not as any language. */
const LETTERS = [
  B("111", "1.1", "111", "1..", "1.."), B("1.1", "1.1", "111", "..1", "..1"), B("111", "..1", ".1.", "1..", "111"),
  B("11.", "1.1", "11.", "1.1", "11."), B("1..", "1..", "111", "1.1", "111"), B(".1.", "1.1", "111", "1.1", "1.1"),
];
const NOTE = B2("..11.", "..1.1", "..1.1", "..1..", "221..", "2221.", ".22..");
const NOTES2 = B2("..1111", "..1..1", "..1..1", "..1..1", "221221", "222222", ".22.22");
const BELL = B2("....3....", "...222...", "..21112..", "..21112..", "..21112..", ".2111112.", "211111112", "333333333", "....w....");
const MIRROR = B2("..444..", ".42114.", "4211w14", "421w114", "42w1114", "4w11124", "4111224", "4112224", ".41224.", "..444..", "...4...", "..444..");
const DOOR = [
  B2("..44444..", ".4222224.", "422222224", "422232224", "422232224", "422222224", "422222224", "42222221k", "422222224", "422232224", "422232224", "422222224", "444444444"),
  B2("..44444..", ".4w11224.", "4w111224.", "4w111234.", "4w111234.", "4w111224.", "4w111224.", "4w11122k.", "4w111224.", "4w111234.", "4w111234.", "4w111224.", "444444444"),
  B2("..44444..", ".4ww1114.", "4www1112.", "4www1112.", "4www1112.", "4www1112.", "4www1112.", "4www1112.", "4www1112.", "4www1112.", "4www1112.", "4www1112.", "444444444"),
];
const MASK = [
  B2(".1111111.", "111111111", "1kk111kk1", "11k111k11", "111121111", ".1112111.", "..1kkk1..", "...111..."),
  B2(".1111111.", "111111111", "1kk111kk1", "1k11111k1", "111121111", ".1k121k1.", "..1kkk1..", "...111..."),
];
const CROWN = B2("1...1...1", "11.111.11", "1w11w11w1", "111111111", "2121w1212", "333333333");
const COIN = [B2(".111.", "12221", "12w21", "12221", ".333."), B2(".11.", "1221", "1w21", "1221", ".33."), B2("1", "2", "w", "2", "3"), B2(".11.", "1221", "12w1", "1221", ".33.")];
const CARD = [B2("11111", "1...1", "1.2.1", "12w21", "1.2.1", "1...1", "11111"), B2("111", "1.1", "121", "1w1", "121", "1.1", "111"), B2("1", "1", "2", "w", "2", "1", "1"), B2("222", "434", "343", "434", "343", "434", "222")];
const SNAKE_HEAD = B2(".222...", "2112k1.", "21111w1", "22333.w", ".33....");
const DRAGON = [
  B2("..3.........", "..33........", ".222221.....", "21112k22111.", "2111111111w1", "22233333....", ".2333333w3w.", "..333333333."),
  B2("..3.........", "..33........", ".222221.....", "21112k22111w", "2111111..w..", "2223.........", ".2333...w.w..", "..3333333333."),
];
const WOLF = [
  B2(".1.1.......", ".2121......", "21111111...", "2112k11111.", "21111111w1k", ".2223333...", "..23w3w3...", "...3333...."),
  B2(".1.1.......", ".2121......", "21111111111", "2112k111..k", "211111.....", ".2223..w.w.", "..23333333.", "...3333...."),
];
const SHIELD = B2("333333333", "311121113", "311121113", "322222223", "311121113", ".3112113.", ".3111113.", "..31113..", "...313...", "....3....");
const WEB_BALL = B2(".212.", "21312", "13w31", "21312", ".212.");
const FLAME = [
  B2("...1...", "..11...", "..121..", ".1221..", ".12w21.", "122w221", "1233321", ".13331."),
  B2("....1..", "...11..", "..121..", ".11221.", ".12w21.", "12ww221", "1223321", ".13331."),
  B2("..1....", "..11...", ".1221..", ".12211.", ".12w21.", "122w221", "1233221", ".13331."),
];
const CHAIN_HOOK = B(".11.", "1..1", "1..1", ".11.");

/* ── procedural shapes ──────────────────────────────────────────────── */

registerShapes({
  moSprite(v, P, p) { drawSprite(v, P, p, false); },

  /** A carrier: its trail, then the material's orb (headOrb), then its head (a bitmap or a shape). */
  moRide(v, P, p, s) {
    if (p.trail) TRAILS[p.trail](v, P, p, s);
    if (p.headOrb) DRAW.orb(v, P, p, s);
    if (p.head) DRAW[p.head](v, P, p, s);
    if (p.bm || p.frames) drawSprite(v, P, p, false);
  },

  /** Jaws seen from the front: two rows of fangs that open to `gap` px and snap. */
  moJaws(v, P, p) {
    const fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, p.z), w = Math.round((p.w ?? 6) * MO), a = env(p);
    const gap = (typeof p.gap === "function" ? p.gap(p, fr) : p.gap ?? 3) * MO;
    for (let i = -w; i <= w; i++) {
      const e = Math.abs(i) / w, arc = Math.round(e * e * 5), up = cy - gap - arc, dn = cy + gap + arc;
      P.dot(cx + i, up - 1, S(p.R, 0.95), a, 2); P.dot(cx + i, up - 2, S(p.R, 0.72), a, 2); P.dot(cx + i, up - 3, S(p.R, 0.5), a, 2);
      P.dot(cx + i, dn + 1, S(p.R, 0.78), a, 2); P.dot(cx + i, dn + 2, S(p.R, 0.55), a, 2); P.dot(cx + i, dn + 3, S(p.R, 0.4), a, 2);
      if ((i + w) % 4 === 1 && Math.abs(i) < w) {
        const L = e < 0.4 ? 5 : e < 0.75 ? 4 : 3;
        for (let k = 0; k < L; k++) { P.dot(cx + i, up + k, k === L - 1 ? WHITE : S(p.R, 1), a, 2); P.dot(cx + i, dn - k, k === L - 1 ? WHITE : S(p.R, 1), a, 2); }
      }
    }
  },

  /** A sun: a disc and eight rays that turn and pulse. */
  moSun(v, P, p) {
    const fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, p.z), r = (p.sz ?? 4) * MO, a = env(p);
    P.shade(cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, (x, y) => {
      const d = Math.hypot(x - cx, y - cy) / r; if (d > 1) return null;
      return { c: d < 0.45 ? WHITE : d > 0.82 ? S(p.R, 0.78) : S(p.R, 1), a };
    }, 2);
    for (let i = 0; i < 8; i++) {
      const q = (i * TAU) / 8 + fr * 0.12, L = r * (i % 2 ? 0.7 : 1.1) * (1 + 0.15 * (fr % 2));
      for (let k = 2; k <= L + 1; k++) P.dot(cx + Math.cos(q) * (r + k), cy + Math.sin(q) * (r + k), S(p.R, k > L ? 0.78 : 0.95), a, 2);
    }
  },

  /** A puffy cloud of three lobes, lit on top; `dark` for a storm. */
  moCloud(v, P, p) {
    let [cx, cy] = v.ap(p.x, p.y, p.z); [cx, cy] = snapH(p, v, cx, cy);
    const r = (p.sz ?? 5) * MO, a = env(p), base = p.dark ? 0.3 : 0.7, fr = Math.floor(p.age * 12);
    const L = [[0, -0.15, 1], [-1.15, 0.25, 0.7], [1.2, 0.25, 0.72], [-0.55, -0.5, 0.68], [0.6, -0.45, 0.72]];
    P.shade(cx - r * 2.2, cy - r * 1.6, cx + r * 2.2, cy + r * 1.3, (x, y) => {
      if (y > cy + r * 0.62) return null;
      for (const [ox, oy, sc] of L) {
        const lx = x - (cx + ox * r), ly = y - (cy + oy * r + (ox ? Math.sin(fr * 0.4 + ox) * 0.6 : 0)), lr = r * sc;
        if (lx * lx + ly * ly > lr * lr) continue;
        const lit = (-lx * 0.5 - ly) / lr;
        return { c: S(p.R, base + (lit > 0.45 ? 0.22 : lit < -0.4 ? -0.18 : 0)), a };
      }
      return null;
    }, 2);
  },

  /** A funnel of wind: stacked rings widening upward, the dashes on them turning. */
  moFunnel(v, P, p) {
    const fr = Math.floor(p.age * 12), [bx, by] = v.ap(p.x, p.y, p.z), H = (p.sz ?? 16) * 1.4, a = env(p), top = v.kind === "top";
    const grow = Math.min(1, (fr + 1) / 4);
    for (let j = 0; j < H * grow; j += 2) {
      const f = j / H, rx = 1.5 + f * f * H * 0.55, ry = Math.max(1, rx * (top ? 0.9 : 0.3)), sway = Math.sin(f * 4 + fr * 0.7) * 2 * f;
      const cy = top ? by - j * 0.3 : by - j;
      P.ellipse(bx + sway, cy, rx, ry, (q) => (Math.floor(q * 2.2 + fr * 1.3 - j) % 3 === 0 ? null : { c: S(p.R, Math.sin(q) > 0 ? 0.62 : 0.92), a }), 2);
    }
  },

  /** A bubble: a hollow ring with a shine that wobbles; `pop` frames break it into four drops. */
  moBubble(v, P, p) {
    const fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, p.z), a = env(p);
    const r = (p.sz ?? 4) * (p.popAt != null && p.age > p.popAt ? 1.25 : 1), wob = (fr >> 1) % 2;
    if (p.popAt != null && p.age > p.popAt) {
      if (p.age > p.popAt + 2 / 12) return;
      for (let i = 0; i < 8; i++) { const q = (i * TAU) / 8; P.dot(cx + Math.cos(q) * r, cy + Math.sin(q) * r, S(p.R, 1), a, 2); }
      return;
    }
    P.ellipse(cx, cy, r + wob * 0.5, r - wob * 0.5, (q) => ({ c: S(p.R, Math.sin(q) > 0.3 ? 0.62 : 0.95), a }), 2);
    P.dot(cx - r * 0.45, cy - r * 0.5, WHITE, a, 2);
    if (r > 3) P.dot(cx - r * 0.45 + 1, cy - r * 0.5, S(p.R, 1), a, 2);
  },

  /** A swarm: a buzzing knot of dots round a point. */
  moSwarm(v, P, p) {
    const fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, p.z), n = Math.round((p.n ?? 14) * 1.7), r = (p.sz ?? 6) * MO, a = env(p);
    for (let i = 0; i < n; i++) {
      const q = hash(i, p.seed ?? 1) * TAU + fr * (0.5 + hash(i, 3) * 0.9) * (i % 2 ? 1 : -1), d = r * (0.3 + 0.7 * hash(i, fr >> 1, 9));
      const x = cx + Math.cos(q) * d, y = cy + Math.sin(q) * d * 0.7;
      P.dot(x, y, S(p.R, 0.3), a, 2);
      if (fr % 2 === i % 2) P.dot(x, y - 1, S(p.R, 0.95), a, 2);
    }
  },

  /** A tree: a trunk that rises, then a canopy of three lobes that swells. */
  moTree(v, P, p) {
    const [bx, by] = v.ap(p.x, p.y, 0), H = (p.sz ?? 18) * 1.4, a = env(p), top = v.kind === "top", g = clamp(p.age / (p.growT ?? 0.5)), fr = Math.floor(p.age * 12);
    const lift = top ? 0.45 : 1, th = Math.round(H * 0.45 * lift * Math.min(1, g * 2));
    for (let j = 0; j < th; j++) { P.dot(bx, by - j, S(p.R, 0.45), a, 2); P.dot(bx + 1, by - j, S(p.R, 0.3), a, 2); if (j < 2) { P.dot(bx - 1, by - j, S(p.R, 0.45), a, 2); P.dot(bx + 2, by - j, S(p.R, 0.3), a, 2); } }
    const cg = clamp(g * 2 - 0.8); if (cg <= 0) return;
    const r = H * 0.32 * cg, cy = by - th - r * 0.6, sway = (fr >> 2) % 2;
    const L = [[0, -0.35, 1], [-0.62, 0.15, 0.78], [0.62, 0.15, 0.8]];
    P.shade(bx - r * 1.6, cy - r * 1.5, bx + r * 1.7, cy + r * 1.1, (x, y) => {
      for (const [ox, oy, sc] of L) {
        const lx = x - (bx + 0.5 + ox * r + sway * (oy < 0 ? 1 : 0)), ly = y - (cy + oy * r), lr = r * sc;
        if (lx * lx + ly * ly > lr * lr) continue;
        const lit = (-lx * 0.6 - ly * 0.8) / lr, dot = hash(Math.floor(x / 2), Math.floor(y / 2), 5) > 0.82;
        return { c: S(p.R, lit > 0.4 ? 0.95 : lit < -0.35 ? 0.5 : dot ? 0.62 : 0.78), a };
      }
      return null;
    }, 2);
  },

  /** A wall of blocks that rises out of the ground across `w` px, `sz` px tall. */
  moWall(v, P, p) {
    const [bx, by] = v.ap(p.x, p.y, 0), w = (p.w ?? 16) * 1.3, H = (p.sz ?? 12) * 1.3 * (v.kind === "top" ? 0.5 : 1), a = env(p);
    const h = Math.round(H * easeOut(clamp(p.age / (p.growT ?? 0.25))));
    for (let j = 0; j < h; j++) for (let i = -w / 2; i < w / 2; i++) {
      const row = Math.floor(j / 3), seam = j % 3 === 2 || ((i + 100 + (row % 2) * 3) % 6 === 0);
      P.dot(bx + i, by - j, S(p.R, j === h - 1 ? 0.95 : seam ? 0.35 : (i + row) % 5 === 0 ? 0.78 : 0.62), a, 2);
    }
  },

  /** Sound: pairs of arcs opening out from a point, like ( ) ( ). */
  moRings(v, P, p) {
    const u = clamp(p.age / p.life), [cx, cy] = v.ap(p.x, p.y, p.z), n = p.n ?? 3, a = 1 - u, R0 = (p.sz ?? 10) * MO;
    for (let k = 0; k < n; k++) {
      const uk = u * 1.4 - k * 0.22; if (uk <= 0 || uk >= 1) continue;
      const r = 3 + R0 * easeOut(uk), m = Math.max(4, Math.round(r * 0.9));
      for (const side of [-1, 1]) for (let i = -m; i <= m; i++) {
        const q = (i / m) * 0.75, x = cx + side * Math.cos(q) * r, y = cy + Math.sin(q) * r * 0.9;
        P.dot(x, y, S(p.R, k === 0 ? 1 : 0.82), a, 2);
        P.dot(x - side, y, S(p.R, k === 0 ? 0.72 : 0.55), a, 2);
      }
    }
  },

  /** Three claw gouges raked across a point, revealed top to bottom in two frames. */
  moClaw(v, P, p) {
    const [cx, cy] = v.ap(p.x, p.y, p.z), L = (p.sz ?? 12) * MO, a = env(p), sq = p.flat ? v.sq : 1, gap = Math.max(4, Math.round(L * 0.24));
    for (let k = -1; k <= 1; k++) {
      // each mark rakes in 2 frames, a frame after the one before; then it cools, then closes from both ends
      const age = p.flat ? 1 : p.age - (k + 1) / 24, fr = Math.floor(age * 12);
      if (age < 0) continue;
      const show = p.flat ? 1 : Math.min(1, (fr + 1) / 2), shut = p.flat ? 0 : clamp((age - 0.22) / Math.max(0.1, p.life - 0.3)) * 0.5;
      const heat = p.flat ? 0.3 : fr < 2 ? 1 : fr < 4 ? 0.9 : 0.72;
      for (let i = 0; i <= L * show; i++) {
        const f = i / L; if (f < shut || f > 1 - shut) continue;
        const x = cx + k * gap + (f - 0.5) * L * 0.6 * (p.flip ?? 1) + Math.sin(f * Math.PI) * 3, y = cy + (f - 0.5) * L * sq;
        const mid = Math.sin(Math.PI * f), thick = mid > 0.75 ? 2 : mid > 0.3 ? 1 : 0;
        if (p.flat) { if (i % 3 === 2) continue; P.dot(x, y, S(p.R, 0.3), a, 0); if (thick) P.dot(x + 1, y, S(p.R, 0.45), a, 0); continue; }
        const head = f > show - 0.15 && fr < 2;
        P.dot(x, y, head ? WHITE : S(p.R, heat), a, 2);
        for (let t = 1; t <= thick; t++) P.dot(x + t, y, S(p.R, heat - 0.18 * t), a, 2);
      }
    }
  },

  /** A web: spokes and rings; flat on the ground, or standing over a body. */
  moWeb(v, P, p) {
    const [cx, cy] = v.ap(p.x, p.y, p.z), r = (p.r ?? 0.5) * v.aps * easeOut(clamp(p.age / 0.15)), sq = p.layer === "flat" ? v.sq : 1, a = env(p);
    if (r < 2) return;
    const n = 8, spokes = [];
    for (let i = 0; i < n; i++) { const q = (i * TAU) / n + 0.2; spokes.push([Math.cos(q), Math.sin(q)]); }
    for (const [ux, uy] of spokes) P.line(cx, cy, cx + ux * r, cy + uy * r * sq, S(p.R, 0.95), 2, a);
    for (const f of [0.35, 0.62, 0.9]) for (let i = 0; i < n; i++) {
      const [ax, ay] = spokes[i], [bx, by] = spokes[(i + 1) % n], sagf = 0.92;
      P.line(cx + ax * r * f, cy + ay * r * f * sq, cx + (ax + bx) / 2 * r * f * sagf, cy + (ay + by) / 2 * r * f * sagf * sq, S(p.R, 0.78), 2, a);
      P.line(cx + (ax + bx) / 2 * r * f * sagf, cy + (ay + by) / 2 * r * f * sagf * sq, cx + bx * r * f, cy + by * r * f * sq, S(p.R, 0.78), 2, a);
    }
  },

  /** A serpent's whole body from `a` to the head at (x, y, z), swinging; the head bitmap at the end. */
  moSnake(v, P, p) {
    const fr = Math.floor(p.age * 12), A = v.ap(p.a[0], p.a[1], p.a[2]), H = v.ap(p.x, p.y, p.z), al = env(p);
    walkLine(A, H, (x, y, f, nx, ny) => {
      const w = Math.sin(f * 10 - fr * 1.4) * 3 * (1 - f * 0.6), cx = x + nx * w, cy = y + ny * w;
      P.dot(cx, cy, S(p.R, (Math.floor(f * 30) % 2) ? 0.78 : 0.62), al, 2); P.dot(cx, cy + 1, S(p.R, 0.45), al, 2);
    });
    const ang = Math.atan2(H[1] - A[1], H[0] - A[0]), left = Math.cos(ang) < 0;
    blit(P, p.headBm ?? SNAKE_HEAD, H[0], H[1], p.R, { ang: left ? ang + Math.PI : ang, flip: left, a: al });
  },

  /** Roots: crooked lines spreading out over the ground from a point, curling at their tips. */
  moRoot(v, P, p) {
    const [cx, cy] = v.ap(p.x, p.y, 0), g = easeOut(clamp(p.age / (p.growT ?? 0.35))), a = env(p), n = p.n ?? 5, L = (p.r ?? 0.6) * v.aps;
    for (let i = 0; i < n; i++) {
      let q = (i / n) * TAU + hash(i, p.seed ?? 1) * 0.8, x = cx, y = cy;
      const steps = Math.round(L * g * (0.7 + 0.5 * hash(i, 2, p.seed ?? 1)));
      for (let k = 0; k < steps; k++) {
        q += (hash(i, k >> 2, p.seed ?? 1) - 0.5) * 0.5;
        x += Math.cos(q); y += Math.sin(q) * v.sq;
        P.dot(x, y, S(p.R, k < steps * 0.5 ? 0.45 : 0.62), a, 1);
        if (k < steps * 0.35) P.dot(x, y + 1, S(p.R, 0.3), a, 1);
      }
    }
  },

  /** Brambles: a ring of crooked stems with thorns, lying on the ground. */
  moBramble(v, P, p) {
    const [cx, cy] = v.ap(p.x, p.y, 0), r = (p.r ?? 0.45) * v.aps, a = env(p), n = Math.ceil(TAU * r);
    for (let i = 0; i < n; i++) {
      const q = (i / n) * TAU, w = Math.sin(q * 5 + (p.seed ?? 0)) * 2, x = cx + Math.cos(q) * (r + w), y = cy + Math.sin(q) * (r + w) * v.sq;
      P.dot(x, y, S(p.R, 0.45), a, 1);
      if (i % 5 === 0) { P.dot(x, y - 1, S(p.R, 0.78), a, 1); P.dot(x + 1, y - 2, S(p.R, 0.95), a, 1); }
    }
  },

  /** A lash: an S-curve cracked across a point, revealed in two frames, a white snap at its end. */
  moLash(v, P, p) {
    const fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, p.z), L = (p.sz ?? 16) * MO, show = Math.min(1, (fr + 1) / 2), a = env(p);
    let last = null;
    for (let i = 0; i <= L * show; i++) {
      const f = i / L, x = cx + (f - 0.5) * L * (p.flip ?? 1), y = cy - 6 + f * 12 + Math.sin(f * TAU) * 5;
      P.dot(x, y, S(p.R, 0.95), a, 2); if (f < 0.6) P.dot(x, y + 1, S(p.R, 0.62), a, 2); if (f < 0.25) P.dot(x, y + 2, S(p.R, 0.45), a, 2);
      last = [x, y];
    }
    if (last && fr === 1) for (let k = 1; k <= 4; k++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7], [-0.7, -0.7]]) P.dot(last[0] + dx * k, last[1] + dy * k, k < 3 ? WHITE : S(p.R, 1), 1, 2);
  },

  /** Lightning crackling round a body: short arcs between points near it, re-struck. */
  moCrackle(v, P, p) {
    const st = Math.floor(p.age * 16), r = rng((p.seed ?? 3) * 977 + st), [cx, cy] = v.ap(p.x, p.y, p.z), R0 = (p.r ?? 0.45) * v.aps * 1.35, a = env(p);
    for (let k = 0; k < (p.n ?? 2) + 1; k++) {
      if (r() < 0.25) continue;
      const q0 = r() * TAU, q1 = q0 + 0.8 + r() * 1.2;
      let x = cx + Math.cos(q0) * R0, y = cy + Math.sin(q0) * R0 * 0.9;
      const x1 = cx + Math.cos(q1) * R0, y1 = cy + Math.sin(q1) * R0 * 0.9;
      for (let i = 0; i < 6; i++) {
        const nx = lerp(x, x1, 1 / (6 - i)) + (r() - 0.5) * 6, ny = lerp(y, y1, 1 / (6 - i)) + (r() - 0.5) * 6;
        P.line(x, y, nx, ny, S(p.R, 1), 2, a); P.line(x + 1, y, nx + 1, ny, S(p.R, 0.72), 2, a); x = nx; y = ny;
      }
    }
  },

  /** A small circle with a glyph in it, turning: a sigil. */
  moSigil(v, P, p) {
    const fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, p.z), r = (p.sz ?? 5) * 1.7, a = env(p), G = GLYPHS[(fr >> 2) % GLYPHS.length];
    P.ellipse(cx, cy, r, r, (q) => ({ c: S(p.R, Math.floor(q * 3 + fr) % 2 ? 1 : 0.72), a }), 2);
    P.ellipse(cx, cy, r - 2, r - 2, (q) => (Math.floor(q * 4 - fr) % 3 === 0 ? null : { c: S(p.R, 0.62), a }), 2);
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) if (G[j * 3 + k] === "1") for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) P.dot(cx - 3 + k * 2 + ox, cy - 3 + j * 2 + oy, S(p.R, ox || oy ? 0.85 : 1), a, 2);
  },
}, { flat: [] });

/** The same sprite, lying on the ground (squashed by the view). */
registerShapes({
  moDecal(v, P, p) { drawSprite(v, P, p, true); },
  moWebFlat(v, P, p, s) { DRAW.moWeb(v, P, p, s); },
  moClawFlat(v, P, p, s) { DRAW.moClaw(v, P, p, s); },
}, { flat: ["moDecal", "moWebFlat", "moClawFlat", "moRoot", "moBramble"] });

/* ── helpers the hooks share ────────────────────────────────────────── */

/** Run `fn` at `at`, or now when `at` is past or missing. */
export const later = (s, at, fn) => s.at(Math.max(at ?? s.t, s.t), fn);

/** A sprite that stays where it is put. */
export const pop = (s, R, bm, o) => s.add({ k: "moSprite", R, bm, life: 1, update: still, ...o });

/** A flash and a light, sized by power. */
export function flare(s, M, x, y, z, pow = 1, r = 0.5) {
  s.add({ k: "flash", x, y, z, life: (pow > 1.2 ? 2 : 1) / 12, r: (r * 0.5 + 0.2) * (s.spec.aps ?? 26) * 0.95 * Math.min(1.4, pow), R: M.R, update: still });
  s.light(x, y, z, r * 3 + 1.4, S(M.R, 0.85), (M.dark ? 0.5 : 1) * Math.min(1.4, pow), 0.7);
}

/** Points round (x, y) within `rad` squares: one at the centre, the rest on a ring. */
function spread(s, x, y, rad, n) {
  const out = [[x, y]];
  for (let i = 1; i < n; i++) { const q = (i / (n - 1)) * TAU + s.rand(-0.3, 0.3), d = rad * s.rand(0.45, 0.95); out.push([x + Math.cos(q) * d, y + Math.sin(q) * d]); }
  return out;
}
/** How many objects an impact throws down: more for a crit, more over a bigger area. */
const many = (pow, rad, k = 1) => Math.max(1, Math.round(k * (pow > 1.2 ? 1.6 : pow < 0.5 ? 0.6 : 1) * (1 + Math.max(0, rad - 0.45) * 1.4)));
const z0 = (o) => o.z ?? 0.6;

/** A hovering object: a white first frame, a gentle bob, faded out at the end. */
function hover(s, R, bm, { x, y, z, life, ...o }) {
  return pop(s, R, bm, { x, y, z, life, hero: 1, bob: 1, snap: true, from: 0.8, ...o });
}

/** An object dropped from above that lands at z after `fall`; `land(s, p)` runs once. */
function drop(s, R, bm, { x, y, z, from = 1.2, fall = 0.14, life = 0.9, land, ...o }) {
  return s.add({
    k: "moSprite", R, bm, x, y, z: z + from, life, hero: 1, ...o,
    update(p, s2) { const f = clamp(p.age / fall); p.z = z + from * (1 - f * f); if (f >= 1 && !p.landed) { p.landed = true; land?.(s2, p); } },
  });
}

/** Objects thrown out from a point that fall and bounce (coins, bones, feathers). */
function scatter(s, R, bm, x, y, z, n, { sp = 2.2, g = 7, life = 1.4, bounce = 0.35, drag = 0.6, ...o } = {}) {
  for (let i = 0; i < n; i++) {
    const q = s.rand(0, TAU), v0 = s.rand(0.5, 1) * sp;
    s.add({ k: "moSprite", R, bm: Array.isArray(bm) && typeof bm[0] !== "string" ? bm[i % bm.length] : bm, x, y, z, vx: Math.cos(q) * v0, vy: Math.sin(q) * v0 * 0.6, vz: s.rand(1, 2.4), g, drag, bounce, life: life * s.rand(0.8, 1.1), minor: i % 3 === 2, ...o });
  }
}

/** Objects circling a point at height z. */
function orbit(s, R, bm, { x, y, z, n = 3, r = 0.45, w = 3, life = 1.2, rise = 0, ...o }) {
  for (let i = 0; i < n; i++) {
    const q0 = (i / n) * TAU;
    s.add({ k: "moSprite", R, bm: Array.isArray(bm) && typeof bm[0] !== "string" ? bm[i % bm.length] : bm, x, y, z, life, hero: 1, ...o, update(p) {
      const q = q0 + p.age * w; p.x = x + Math.cos(q) * r; p.y = y + Math.sin(q) * r * 0.5; p.z = z + rise * p.age + Math.sin(q) * 0.08;
    } });
  }
}

/** Speed lines along (ux, uy) at a point. */
function lines(s, M, x, y, z, ux, uy, n = 3) {
  for (let k = 0; k < n; k++) { const o = (k - (n - 1) / 2) * 0.12, sp = s.rand(6, 8); s.add({ k: "streak", x: x - ux * 0.5 - uy * o, y: y - uy * 0.5 + ux * o, z: z + o, vx: ux * sp, vy: uy * sp, life: 0.12 + k * 0.02, R: M.R, minor: k > 0, wait: k * 0.015 }); }
}

/** The unit direction an effect comes from: its caster to the point, or from the left. */
function fromCaster(s, x, y) {
  const c = s.spec.caster; if (!c) return [1, 0];
  const dx = x - c.x, dy = y - c.y, l = Math.hypot(dx, dy); return l > 1e-6 ? [dx / l, dy / l] : [1, 0];
}

const glints = (s, M, x, y, z, n, spread0 = 0.35, wait = 0.05) => {
  for (let i = 0; i < n; i++) s.add({ k: "glint", x: x + s.rand(-spread0, spread0), y: y + s.rand(-0.15, 0.15), z: Math.max(0.05, z + s.rand(-0.2, 0.4)), life: 5 / 12, R: M.R, wait: wait + i * 0.06, minor: i > 1, update: still });
};
const puffs = (s, R, x, y, z, n, { r = 3, tone = 0.5, sp = 1, vz = 0.3, life = 0.8, ...o } = {}) => {
  for (let i = 0; i < n; i++) { const q = s.rand(0, TAU); s.add({ k: "smoke", x: x + Math.cos(q) * 0.12, y: y + Math.sin(q) * 0.08, z, vx: Math.cos(q) * sp * s.rand(0.5, 1), vy: Math.sin(q) * sp * 0.5, vz, drag: 2.5, r: r * s.rand(0.8, 1.2), life: life * s.rand(0.8, 1.2), lobes: lobes(s), R, tone, minor: i > 1, ...o }); }
};

/** Pick one bitmap from a list, by the effect's own randomness. */
const pick = (s, list) => list[Math.floor(s.R() * list.length) % list.length];

/* ── the motifs ─────────────────────────────────────────────────────── */

/** A weapon that hangs in the air, swings once onto the ground in front, and goes. */
function swingOnce(s, M, bm, o) {
  const { x, y, h, at, life } = o, [ux] = fromCaster(s, x, y), side = ux >= 0 ? -1 : 1, z = 0.75 * h, swingAt = Math.min(life * 0.35, 0.45);
  later(s, at, (s2) => {
    s2.add({ k: "moSprite", R: M.R, bm, x: x + side * 0.42, y, z, life, hero: 1, from: 0.8, snap: true, flip: side > 0, ang: -Math.PI / 2, update(p, s3) {
      const t = p.age - swingAt, k = clamp(t / 0.2);
      // raised point-up, then a chop: four steps down past level, then back up
      p.ang = (side > 0 ? -1 : 1) * 0 + (t < 0 ? -Math.PI / 2 : t < 0.2 ? lerp(-Math.PI / 2, Math.PI / 3, easeOut(k)) : lerp(Math.PI / 3, -Math.PI / 2, clamp((t - 0.35) / 0.3)));
      if (side > 0) p.ang = Math.PI - p.ang;
      if (t >= 0.2 && !p.hitDone) {
        p.hitDone = true;
        s3.add({ k: "ring", x: x - side * 0.1, y, r: 0.4, life: 0.4, R: M.R, broken: true, seed: 9, update: still });
        s3.light(x, y, 0.5, 1.2, S(M.R, 0.85), 0.8, 0.5);
        s3.add({ k: "star", x: x - side * 0.05, y, z: 0.45 * h, L: 4, life: 3 / 12, R: M.R, update: still });
      }
    } });
    s2.light(x + side * 0.42, y, z, 1, S(M.R, 0.85), 0.6, life * 0.8);
  });
}

/** A weapon that chops down onto a point from above: raised, then a three-frame fall to the strike. */
function chopDown(s, M, bm, { x, y, z, pow, at }) {
  const [ux] = fromCaster(s, x, y), side = ux >= 0 ? -1 : 1;
  later(s, at, (s2) => {
    s2.add({ k: "moSprite", R: M.R, bm, x: x + side * 0.3, y, z: z + 0.45, life: 0.7, hero: 1, from: 0.6, flip: side > 0, update(p, s3) {
      const k = clamp(p.age / 0.16), a = lerp(-Math.PI / 2 - 0.3, Math.PI / 4, k * k);
      p.ang = side > 0 ? Math.PI - a : a;
      p.z = z + 0.45 - k * 0.3;
      if (k >= 1 && !p.done) { p.done = true; flare(s3, M, x, y, z, pow, 0.35); if (pow > 1.2) s3.add({ k: "star", x, y, z, L: 7, life: 3 / 12, R: M.R, update: still }); }
    } });
  });
}

/** An object plunging point-first into the ground or a body, left standing in it. */
function plunge(s, M, bm, { x, y, z, n = 1, rad = 0, at, lean = 0.35, stay = 1.2, fall = 0.12 }) {
  later(s, at, (s2) => {
    spread(s2, x, y, rad, n).forEach(([px, py], i) => {
      const q = Math.PI / 2 + (i % 2 ? lean : -lean) * (i ? 1 : 0.4);
      drop(s2, M.R, bm, { x: px, y: py, z: i ? 0.15 : z, ang: q, from: 1.1, fall, life: stay, wait: i * 0.05, land: (s3) => { s3.add({ k: "glint", x: px, y: py, z: (i ? 0.15 : z) + 0.25, life: 5 / 12, R: M.R, update: still }); if (i === 0) flare(s3, M, px, py, z, 1, 0.3); } });
    });
  });
}

/** A body with a ring of things erupting out of the ground round it. */
function erupt(s, M, mk, { x, y, n, rad = 0.4, at, wave = 0.03 }) {
  later(s, at, (s2) => {
    for (let i = 0; i < n; i++) {
      const q = (i / n) * TAU + s2.rand(-0.2, 0.2), d = rad * s2.rand(0.6, 1.05);
      mk(s2, x + Math.cos(q) * d, y + Math.sin(q) * d * 0.8, i, i * wave);
    }
    s2.add({ k: "ring", x, y, r: rad + 0.15, life: 0.45, R: M.R, broken: true, seed: 21, update: still });
  });
}

const crystalAt = (M, h = 12, w = 2.5) => (s2, x, y, i, wait) => s2.add({ k: "crystal", x, y, h: h * s2.rand(0.7, 1.15), w: w * s2.rand(0.8, 1.2), lean: s2.rand(-2.5, 2.5), life: s2.rand(1.2, 1.6), R: M.R, wait, minor: i % 3 === 2, update: still });

export const MOTIFS = {
  /* arms */
  blade: {
    carrier: (s, M, p) => ride(p, { bm: SWORD, face: true, keepUp: true }),
    impact: (s, M, o) => plunge(s, M, SWORD, { ...o, z: z0(o), n: many(o.pow, o.rad ?? 0, o.pow > 1.2 ? 3 : 1), rad: o.rad ?? 0 }),
    conjure: (s, M, o) => swingOnce(s, M, SWORD, o),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => pop(s2, M.R, SWORD, { x: x + 0.15, y: y + 0.05, z: 0.18, ang: Math.PI / 2 - 0.3, life: 2.4, from: 0.6 })),
  },
  weapon: {
    carrier: (s, M, p) => ride(p, { bm: pick(s, [AXE, MACE, SWORD]), face: true, spin: TAU / 8 }),
    impact: (s, M, o) => chopDown(s, M, pick(s, [AXE, MACE, SWORD]), { ...o, z: z0(o) }),
    conjure: (s, M, o) => swingOnce(s, M, pick(s, [AXE, MACE, SWORD]), o),
  },
  spear: {
    carrier: (s, M, p) => ride(p, { bm: SPEAR, face: true, keepUp: true }),
    impact: (s, M, o) => plunge(s, M, SPEAR, { ...o, z: z0(o), n: many(o.pow, o.rad ?? 0), rad: o.rad ?? 0, lean: 0.5 }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => {
      for (const side of [-1, 1]) hover(s2, M.R, SPEAR, { x: x + side * 0.42, y, z: 0.8 * h, life, ang: -Math.PI / 2, bob: 0, ph: side > 0 ? 3 : 0 });
      glints(s2, M, x, y, 1.4 * h, 2, 0.45, 0.15);
    }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => pop(s2, M.R, SPEAR, { x, y, z: 0.25, ang: Math.PI / 2 + 0.45, life: 2.2, from: 0.6 })),
  },
  arrow: {
    carrier: (s, M, p) => ride(p, { bm: ARROW, face: true, keepUp: true }),
    impact: (s, M, o) => plunge(s, M, ARROW, { ...o, z: z0(o), n: o.pow > 1.2 ? 5 : 3, rad: Math.max(0.3, o.rad ?? 0), lean: 0.25, fall: 0.1 }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => { for (let i = 0; i < 3; i++) pop(s2, M.R, ARROW, { x: x + s2.rand(-0.3, 0.3), y: y + s2.rand(-0.2, 0.2), z: 0.12, ang: Math.PI / 2 + s2.rand(-0.4, 0.4), life: 2.2, from: 0.6 }); }),
  },
  hammer: {
    carrier: (s, M, p) => ride(p, { bm: HAMMER, face: true, spin: TAU / 8 }),
    impact: (s, M, o) => later(s, o.at, (s2) => drop(s2, M.R, HAMMER, { x: o.x, y: o.y, z: z0(o) + 0.1, ang: Math.PI / 2, from: 1.3, fall: 0.16, life: 1, from2: 0, land: (s3) => {
      flare(s3, M, o.x, o.y, z0(o), o.pow, 0.4);
      s3.add({ k: "ring", x: o.x, y: o.y, r: 0.6 + (o.rad ?? 0), life: 0.5, R: M.R, broken: true, seed: 13, update: still });
      s3.shake = Math.max(s3.shake, o.pow > 1.2 ? 2.5 : 1.3);
      scatter(s3, M.R, BOULDER.slice(2, 5), o.x, o.y, 0.1, 0, {});
      for (let i = 0; i < 5; i++) { const q = s3.rand(0, TAU); s3.add({ k: "chunk", x: o.x, y: o.y, z: 0.1, vx: Math.cos(q) * 2.5, vy: Math.sin(q) * 1.4, vz: s3.rand(1.5, 3), g: 9, drag: 0.8, bounce: 0.3, life: 1, R: M.R, s: 2, debris: true, minor: i > 2 }); }
    } })),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => {
      s2.add({ k: "moSprite", R: M.R, bm: HAMMER, x: x + 0.4, y, z: 1.3 * h, life, hero: 1, from: 0.8, ang: -Math.PI / 2, update(p, s3) {
        const t = p.age - Math.min(0.5, life * 0.35), k = clamp(t / 0.14);
        p.z = t < 0 ? 1.3 * h + Math.sin(p.age * 6) * 0.04 : t < 0.14 ? lerp(1.3 * h, 0.35, k * k) : lerp(0.35, 1.3 * h, clamp((t - 0.4) / 0.4));
        p.ang = t > 0 && t < 0.6 ? Math.PI / 2 : -Math.PI / 2;
        if (k >= 1 && !p.done) { p.done = true; s3.add({ k: "ring", x: x + 0.4, y, r: 0.45, life: 0.45, R: M.R, broken: true, seed: 4, update: still }); s3.shake = Math.max(s3.shake, 1); s3.light(x + 0.4, y, 0.3, 1.2, S(M.R, 0.85), 0.8, 0.4); }
      } });
    }),
  },
  chain: {
    carrier: (s, M, p) => ride(p, { trail: "chain", bm: CHAIN_HOOK, face: true }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      for (const [k, zz] of [[0, 0.45], [1, 0.85]]) {
        const r0 = 0.75, r1 = 0.33;
        s2.add({ k: "cnBand", style: "chain", x: o.x, y: o.y, z: zz * z0(o) / 0.6 * 0.6, r: r0, life: 1.2, R: M.R, topSkip: k > 0, wait: k * 0.06, update(p) { p.r = lerp(r0, r1, easeOut(clamp(p.age / 0.2))); } });
      }
      s2.at(s2.t + 0.2, (s3) => { flare(s3, M, o.x, o.y, z0(o), o.pow * 0.8, 0.3); glints(s3, M, o.x, o.y, z0(o), 3, 0.3, 0); });
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => {
      for (let i = 0; i < 3; i++) {
        const zz = (0.25 + i * 0.3) * h, r0 = 0.8, r1 = 0.36;
        s2.add({ k: "cnBand", style: "chain", x, y, z: zz, r: r0, life, R: M.R, topSkip: zz > 0.5, wait: i * 0.1, update(p) { p.r = lerp(r0, r1, easeOut(clamp(p.age / 0.3))); } });
      }
      s2.light(x, y, 0.6, 1.1, S(M.R, 0.85), 0.5, 0.6);
    }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => s2.add({ k: "cnBand", style: "chain", x, y: y + 0.02, z: 0.02, r: 0.3, life: 2.2, R: M.R, update: still })),
  },
  whip: {
    carrier: (s, M, p) => ride(p, { trail: "whip" }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const [ux] = fromCaster(s2, o.x, o.y);
      s2.add({ k: "moLash", x: o.x, y: o.y, z: z0(o), sz: 18, flip: ux >= 0 ? 1 : -1, life: 0.45, R: M.R, update: still });
      s2.at(s2.t + 1 / 12, (s3) => { s3.add({ k: "moRings", x: o.x + (ux >= 0 ? 0.35 : -0.35), y: o.y, z: z0(o), n: 2, sz: 6, life: 0.35, R: M.R, update: still }); flare(s3, M, o.x, o.y, z0(o), o.pow, 0.25); });
    }),
  },
  needle: {
    carrier: (s, M, p) => ride(p, { trail: "thread", bm: NEEDLE, face: true, keepUp: true }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const n = o.pow > 1.2 ? 7 : 5, z = z0(o);
      for (let i = 0; i < n; i++) {
        const q = (i / n) * TAU + 0.3, r0 = 0.7, r1 = 0.14;
        s2.add({ k: "moSprite", R: M.R, bm: NEEDLE, x: o.x, y: o.y, z, ang: 0, life: 0.55, from: 0.6, wait: i * 0.02, update(p) {
          const k = clamp(p.age / 0.1), d = lerp(r0, r1, k); p.x = o.x + Math.cos(q) * d; p.y = o.y + Math.sin(q) * d * 0.6; p.z = z + Math.sin(q) * 0.1; p.ang = q + Math.PI;
        } });
      }
      s2.at(s2.t + 0.12, (s3) => { flare(s3, M, o.x, o.y, z, o.pow * 0.7, 0.25); glints(s3, M, o.x, o.y, z, 2, 0.2, 0); });
    }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => { for (let i = 0; i < 4; i++) pop(s2, M.R, NEEDLE, { x: x + s2.rand(-0.3, 0.3), y: y + s2.rand(-0.2, 0.2), z: 0.1, ang: Math.PI / 2 + s2.rand(-0.3, 0.3), life: 1.8, o: 1 }); }),
  },

  /* body */
  hand: {
    carrier: (s, M, p) => ride(p, { bm: HAND, face: true, off: Math.PI / 2 }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const z = z0(o);
      s2.add({ k: "moSprite", R: M.R, frames: [HAND, HAND, HAND, HAND_SHUT], fps: 14, x: o.x, y: o.y, z: z + 0.6, life: 0.85, hero: 1, from: 0.6, update(p, s3) {
        const k = clamp(p.age / 0.2); p.z = z + 0.6 - 0.45 * easeOut(k);
        if (p.age > 3 / 14 && !p.done) { p.done = true; flare(s3, M, o.x, o.y, z, o.pow * 0.8, 0.3); s3.shake = Math.max(s3.shake, 0.8); }
      } });
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => s2.add({ k: "moSprite", R: M.R, bm: HAND, x: x + 0.42, y, z: 0.9 * h, life, hero: 1, from: 0.8, snap: true, update(p) {
      const fr = Math.floor(p.age * 12); p.ang = [0, 0.4, 0, -0.4][(fr >> 2) % 4]; p.z = 0.9 * h + Math.sin(p.age * 4) * 0.05;
    } })),
  },
  fist: {
    carrier: (s, M, p) => ride(p, { trail: "speed", bm: FIST, face: true, keepUp: true }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const [ux, uy] = fromCaster(s2, o.x, o.y), z = z0(o);
      s2.add({ k: "moSprite", R: M.R, bm: FIST, x: o.x - ux * 0.8, y: o.y - uy * 0.8, z, life: 0.8, hero: 1, from: 0.65, ang: Math.atan2(uy * 0.5, ux), flip: false, update(p, s3) {
        const k = clamp(p.age / 0.09), back = clamp((p.age - 0.2) / 0.2), d = lerp(0.8, 0.15, k) + back * 0.3;
        p.x = o.x - ux * d; p.y = o.y - uy * d;
        if (ux < 0) { p.flip = true; p.ang = Math.atan2(uy * 0.5, ux) + Math.PI; }
        if (k >= 1 && !p.done) { p.done = true; s3.add({ k: "star", x: o.x, y: o.y, z, L: o.pow > 1.2 ? 9 : 6, life: 3 / 12, R: M.R, update: still }); flare(s3, M, o.x, o.y, z, o.pow, 0.3); s3.shake = Math.max(s3.shake, 1.2); }
      } });
      lines(s2, M, o.x - ux * 0.3, o.y - uy * 0.3, z, ux, uy, 3);
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => s2.add({ k: "moSprite", R: M.R, bm: FIST, x: x + 0.4, y, z: 1.1 * h, ang: -Math.PI / 2, life, hero: 1, from: 0.8, update(p) { p.z = 1.1 * h + Math.abs(Math.sin(p.age * 7)) * 0.12; } })),
  },
  claw: {
    carrier: (s, M, p) => ride(p, { trail: "rake" }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const [ux] = fromCaster(s2, o.x, o.y), z = z0(o);
      s2.add({ k: "moClaw", x: o.x, y: o.y, z, sz: o.pow > 1.2 ? 16 : 12, flip: ux >= 0 ? 1 : -1, life: 0.8, from: 0.55, R: M.R, update: still });
      if (o.pow > 1.2) s2.add({ k: "moClaw", x: o.x, y: o.y, z, sz: 14, flip: ux >= 0 ? -1 : 1, life: 0.7, from: 0.55, R: M.R, wait: 0.12, update: still });
      s2.light(o.x, o.y, z, 1.2, S(M.R, 0.85), 0.8, 0.5);
      for (let i = 0; i < (o.pow > 1.2 ? 12 : 7); i++) { const q = s2.rand(0, TAU), sp = s2.rand(1.5, 3.5); s2.add({ k: "spark", x: o.x, y: o.y, z, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp * 0.5, vz: s2.rand(0.5, 2), g: 7, drag: 1.5, life: s2.rand(0.25, 0.45), R: M.R, minor: i > 3 }); }
      s2.at(s2.t + 1 / 12, (s3) => flare(s3, M, o.x, o.y, z, o.pow * 0.8, 0.3));
    }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => s2.add({ k: "moClawFlat", flat: true, x, y, z: 0, sz: 12, life: 2.2, from: 0.5, R: M.R, update: still })),
  },
  jaws: {
    carrier: (s, M, p) => ride(p, { head: "moJaws", w: 4, gap: (q, fr) => [3, 1, 0, 1][fr % 4] }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const z = z0(o), big = o.pow > 1.2;
      s2.add({ k: "moJaws", x: o.x, y: o.y, z, w: big ? 9 : 7, life: 0.6, from: 0.6, R: M.R, gap: (q, fr) => [7, 8, 3, 0, 0, 0][fr] ?? 0, update: still });
      s2.at(s2.t + 3 / 12, (s3) => { flare(s3, M, o.x, o.y, z, o.pow, 0.3); s3.shake = Math.max(s3.shake, big ? 2 : 1); });
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => s2.add({ k: "moJaws", x: x + 0.45, y, z: 0.85 * h, w: 5, life, from: 0.8, R: M.R, gap: (q, fr) => [5, 5, 2, 0, 0, 3, 5, 5][fr % 8], update: still })),
  },
  eye: {
    carrier: (s, M, p) => ride(p, { frames: [EYE[2], EYE[2], EYE[2], EYE[2], EYE[2], EYE[1], EYE[0], EYE[1]], loop: true, face: "lr" }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const z = z0(o) + 0.55;
      pop(s2, M.R, null, { frames: [EYE[0], EYE[1], EYE[2], EYE[2], EYE[2], EYE[2], EYE[2], EYE[2], EYE[2], EYE[1], EYE[0]], x: o.x, y: o.y, z, life: 11 / 12, hero: 0, from: 0.9 });
      s2.light(o.x, o.y, z, 1.4, S(M.R, 0.85), 0.8, 0.9);
      s2.at(s2.t + 2 / 12, (s3) => s3.add({ k: "glint", x: o.x + 0.05, y: o.y, z, life: 5 / 12, R: M.R, update: still }));
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => {
      const n = Math.max(3, Math.round(life * 12)), fr = [EYE[0], EYE[1]];
      for (let i = 0; i < n - 2; i++) fr.push(i === Math.floor(n / 2) ? EYE[0] : EYE[2]);
      pop(s2, M.R, null, { frames: fr, x, y, z: 1.45 * h, life, bob: 1, snap: true, from: 0.85 });
      s2.light(x, y, 1.4 * h, 1, S(M.R, 0.85), 0.45, life);
    }),
  },
  heart: {
    carrier: (s, M, p) => ride(p, { frames: [HEART, HEART, HEART, HEART_BIG], loop: true, face: "lr" }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const z = z0(o) + 0.3;
      pop(s2, M.R, HEART_BIG, { x: o.x, y: o.y, z, life: 0.35, hero: 1, from: 0.5 });
      s2.at(s2.t + 0.3, (s3) => { for (let i = 0; i < 6; i++) { const q = (i / 6) * TAU; s3.add({ k: "moSprite", R: M.R, bm: HEART_MINI, x: o.x, y: o.y, z, vx: Math.cos(q) * 1.6, vy: Math.sin(q) * 0.8, vz: 0.6, drag: 2.5, life: 0.8, minor: i % 2 === 1 }); } flare(s3, M, o.x, o.y, z, o.pow * 0.7, 0.3); });
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => {
      pop(s2, M.R, null, { frames: [HEART_BIG, HEART, HEART, HEART, HEART_BIG, HEART_BIG], loop: true, fps: 10, x, y, z: 1.35 * h, life, hero: 1, snap: true, from: 0.8 });
      for (let i = 0; i < 4; i++) s2.add({ k: "moSprite", R: M.R, bm: HEART_MINI, x: x + s2.rand(-0.35, 0.35), y, z: s2.rand(0.4, 1) * h, vz: 0.5, drag: 0.5, life: 1, wait: 0.2 + i * 0.2, minor: i > 1 });
    }),
  },
  skull: {
    carrier: (s, M, p) => ride(p, { frames: [SKULL, SKULL_GAPE], loop: true, fps: 8, face: "lr" }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const z = z0(o) + 0.35;
      s2.add({ k: "moSprite", R: M.R, frames: [SKULL, SKULL_LIT, SKULL_GAPE, SKULL_LIT, SKULL_GAPE, SKULL_LIT], loop: true, fps: 8, x: o.x, y: o.y, z, vz: 0.35, drag: 1, life: 0.95, hero: 1, from: 0.55 });
      s2.add({ k: "moRings", x: o.x, y: o.y, z, n: 3, sz: 8, life: 0.5, R: M.R, update: still });
      flare(s2, M, o.x, o.y, z, o.pow, 0.3);
      s2.at(s2.t + 0.5, (s3) => puffs(s3, M.R, o.x, o.y, z + 0.15, 3, { r: 3, tone: 0.35, vz: 0.4 }));
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => pop(s2, M.R, null, { frames: [SKULL, SKULL_LIT], loop: true, fps: 3, x, y, z: 1.4 * h, life, hero: 1, bob: 1, snap: true, from: 0.8 })),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => pop(s2, M.R, SKULL, { x: x + 0.2, y: y + 0.1, z: 0, base: true, life: 2.2, dim: 1, from: 0.6 })),
  },
  bones: {
    carrier: (s, M, p) => ride(p, { bm: BONE, face: true, spin: TAU / 8 }),
    impact: (s, M, o) => erupt(s, M, (s2, x, y, i, wait) => s2.add({ k: "moSprite", R: M.R, bm: BONE_UP, x, y, z: 0, base: true, grow: 0.12, life: 1, wait, from: 0.65, lean: 0, ang: s2.rand(-0.4, 0.4), minor: i % 3 === 2, update: still }), { ...o, n: many(o.pow, o.rad ?? 0, 5), rad: Math.max(0.35, (o.rad ?? 0) * 0.8) }),
    conjure: (s, M, { x, y, at, life }) => erupt(s, M, (s2, px, py, i, wait) => s2.add({ k: "moSprite", R: M.R, bm: BONE_UP, x: px, y: py, z: 0, base: true, grow: 0.3, life, wait, from: 0.8, ang: Math.atan2(py - y, px - x) * 0.25, update: still }), { x, y, n: 6, rad: 0.5, at, wave: 0.05 }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => { for (let i = 0; i < 4; i++) pop(s2, M.R, BONE, { k: "moDecal", x: x + s2.rand(-0.35, 0.35), y: y + s2.rand(-0.25, 0.25), z: 0, ang: s2.rand(0, TAU), life: 2.4, o: 1, from: 0.6 }); }),
  },
  blood: {
    carrier: (s, M, p) => ride(p, { bm: DROP, face: "lr", shed(q, s2, dt) { if (s2.count(18, dt)) s2.add({ k: "drip", x: q.x, y: q.y, z: q.z, vz: -0.5, g: 6, life: 0.6, R: M.R, minor: true, onGround: splat }); } }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const z = z0(o), n = o.pow > 1.2 ? 14 : 9;
      for (let i = 0; i < n; i++) { const q = s2.rand(0, TAU), sp = s2.rand(1.2, 2.6); s2.add({ k: "droplet", x: o.x, y: o.y, z, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp * 0.6, vz: s2.rand(0.8, 2.4), g: 8, drag: 0.4, life: 1.2, R: M.R, big: i % 3 === 0, minor: i % 2 === 1, onGround: splat }); }
      flare(s2, M, o.x, o.y, z, o.pow * 0.8, 0.3);
    }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => { s2.add({ k: "puddle", x, y, r: 0.22, life: 2.6, R: M.R, debris: true, update: still }); for (let i = 0; i < 3; i++) s2.add({ k: "puddle", x: x + s2.rand(-0.4, 0.4), y: y + s2.rand(-0.3, 0.3), r: 0.07, life: 2.4, R: M.R, debris: true, update: still }); }),
  },
  wing: {
    carrier: (s, M, p) => ride(p, { headOrb: true, head: "moWings", wingFr: WING }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const [ux] = fromCaster(s2, o.x, o.y), z = z0(o) + 0.2, side = ux >= 0 ? -1 : 1;
      s2.add({ k: "moSprite", R: M.R, frames: [WING[0], WING[0], WING[1], WING[1]], x: o.x + side * 0.6, y: o.y, z, flip: side > 0, life: 0.45, hero: 1, from: 0.6, update(p) { p.x = o.x + side * lerp(0.6, -0.4, easeOut(clamp(p.age / 0.3))); } });
      s2.at(s2.t + 0.15, (s3) => { flare(s3, M, o.x, o.y, z, o.pow * 0.8, 0.3); scatter(s3, M.R, FEATHER, o.x, o.y, z, 4, { sp: 1.6, g: 0.8, drag: 2.4, bounce: 0, life: 1.4, face: false, spin: 0.4 }); });
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => {
      for (const side of [-1, 1]) s2.add({ k: "moSprite", R: M.R, frames: [WING[1], WING[0], WING[0], WING[0], WING[1], WING[1]], loop: true, fps: 6, x: x + side * 0.42, y: y - 0.02, z: 0.85 * h, flip: side < 0, life, hero: 1, grow: 0.2, from: 0.8, update: still });
      s2.light(x, y, 0.8 * h, 1.3, S(M.R, 0.85), 0.5, life);
    }),
    residue: (s, M, o) => MOTIFS.feather.residue(s, M, o),
  },
  feather: {
    carrier: (s, M, p) => ride(p, { bm: FEATHER, face: true, keepUp: true, off: 0 }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      scatter(s2, M.R, FEATHER, o.x, o.y, z0(o) + 0.3, o.pow > 1.2 ? 9 : 6, { sp: 1.8, g: 0.7, drag: 2.6, bounce: 0, life: 1.6, spin: 0.5 });
      flare(s2, M, o.x, o.y, z0(o), o.pow * 0.6, 0.3);
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => {
      for (let i = 0; i < 6; i++) {
        const q0 = (i / 6) * TAU;
        s2.add({ k: "moSprite", R: M.R, bm: FEATHER, x, y, z: 1.6 * h, life: Math.min(life, 2.2), wait: i * 0.08, from: 0.75, update(p) {
          const q = q0 + p.age * 2.4; p.x = x + Math.cos(q) * 0.4; p.y = y + Math.sin(q) * 0.2; p.z = Math.max(0.05, 1.6 * h - p.age * 0.7 * h); p.ang = Math.sin(p.age * 5 + i) * 0.5;
        } });
      }
    }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => { for (let i = 0; i < 4; i++) pop(s2, M.R, FEATHER, { k: "moDecal", x: x + s2.rand(-0.4, 0.4), y: y + s2.rand(-0.3, 0.3), z: 0, ang: s2.rand(-0.6, 0.6), life: 2.4, o: 1, from: 0.6, wait: i * 0.1 }); }),
  },

  /* sky */
  storm: {
    carrier: (s, M, p) => ride(p, { head: "moCloud", sz: 3, dark: true, shed(q, s2, dt) { if (s2.count(10, dt)) s2.add({ k: "bolt", a: [q.x, q.y, q.z - 0.05], b: [q.x + s2.rand(-0.2, 0.2), q.y, Math.max(0, q.z - 0.5)], life: 0.06, R: M.R, seed: s2.seedInt(), update: still }); } }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const z = z0(o), top = z + 1.4;
      s2.add({ k: "moCloud", x: o.x, y: o.y, z: top, sz: 6, dark: true, life: 1.2, inT: 0.1, R: M.R, update: still });
      s2.at(s2.t + 0.14, (s3) => {
        s3.add({ k: "bolt", a: [o.x, o.y, top - 0.1], b: [o.x, o.y, z], life: 0.2, R: M.R, seed: s3.seedInt(), update: still });
        flare(s3, M, o.x, o.y, z, o.pow * 1.1, 0.35); s3.shake = Math.max(s3.shake, 1.2);
      });
      s2.emit(s2.t + 0.1, s2.t + 0.9, (s3, _u, dt) => { for (let i = s3.count(28, dt); i > 0; i--) s3.add({ k: "drip", x: o.x + s3.rand(-0.4, 0.4), y: o.y + s3.rand(-0.1, 0.1), z: top - 0.15, vz: -5, life: 0.4, R: M.R, minor: i > 1, onGround: (p) => { p.life = 0; } }); });
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => {
      const top = 1.9 * h;
      s2.add({ k: "moCloud", x, y, z: top, sz: 6, dark: true, life, inT: 0.15, R: M.R, update: still });
      s2.emit(s2.t + 0.1, s2.t + life * 0.85, (s3, _u, dt) => {
        for (let i = s3.count(20, dt); i > 0; i--) s3.add({ k: "drip", x: x + s3.rand(-0.4, 0.4), y: y + s3.rand(-0.1, 0.1), z: top - 0.15, vz: -4.5, life: 0.5, R: M.R, minor: true, onGround: (p) => { p.life = 0; } });
        if (s3.count(1.6, dt)) { s3.add({ k: "bolt", a: [x + s3.rand(-0.2, 0.2), y, top - 0.1], b: [x + s3.rand(-0.5, 0.5), y, 0], life: 0.12, R: M.R, seed: s3.seedInt(), update: still }); s3.light(x, y, top, 1.6, S(M.R, 0.85), 0.9, 0.15); }
      });
    }),
  },
  cloud: {
    carrier: (s, M, p) => ride(p, { head: "moCloud", sz: 3 }),
    impact: (s, M, o) => later(s, o.at, (s2) => { puffs(s2, M.R, o.x, o.y, z0(o), o.pow > 1.2 ? 6 : 4, { r: 4, tone: 0.75, sp: 1.6, vz: 0.15, life: 1 }); s2.light(o.x, o.y, z0(o), 1, S(M.R, 0.85), 0.4, 0.5); }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => s2.add({ k: "moCloud", x, y, z: 1.75 * h, sz: 5, life, inT: 0.15, R: M.R, update(p) { p.x = x + Math.sin(p.age * 1.4) * 0.08; } })),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => puffs(s2, M.R, x, y, 0.05, 3, { r: 3, tone: 0.65, sp: 0.4, vz: 0.05, life: 1.8 })),
  },
  rain: {
    impact: (s, M, o) => MOTIFS.rain.conjure(s, M, { x: o.x, y: o.y, h: 1, at: o.at, life: 0.9 }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => {
      const top = 1.8 * h;
      s2.add({ k: "moCloud", x, y, z: top, sz: 5, life, inT: 0.1, R: M.R, update: still });
      s2.emit(s2.t + 0.08, s2.t + life * 0.85, (s3, _u, dt) => { for (let i = s3.count(34, dt); i > 0; i--) s3.add({ k: "drip", x: x + s3.rand(-0.45, 0.45), y: y + s3.rand(-0.15, 0.15), z: top - 0.2, vz: -5, life: 0.5, R: M.R, minor: i > 1, onGround(p, s4) { p.life = 0; if (s4.R() < 0.4) s4.add({ k: "splash", x: p.x, y: p.y, z: 0, life: 3 / 12, R: M.R, update: still }); } }); });
    }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => { for (let i = 0; i < 3; i++) s2.add({ k: "puddle", x: x + s2.rand(-0.35, 0.35), y: y + s2.rand(-0.25, 0.25), r: s2.rand(0.08, 0.16), life: 2.4, R: M.R, debris: true, update: still }); }),
  },
  wind: {
    carrier: (s, M, p) => ride(p, { trail: "wind", headOrb: true, r: 2 }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const [ux, uy] = fromCaster(s2, o.x, o.y), z = z0(o);
      for (let k = 0; k < 3; k++) {
        const off = (k - 1) * 0.22, x0 = o.x - ux * 0.7 - uy * off, y0 = o.y - uy * 0.7 + ux * off;
        s2.add({ k: "moRide", trail: "wind", x: x0, y: y0, z: z + off * 0.6, life: 0.4, R: M.R, wait: k * 0.04, ...{ hist: [[x0, y0, z]] }, update(p) { const f = clamp(p.age / 0.4); p.x = x0 + ux * 1.5 * f; p.y = y0 + uy * 1.5 * f; const H = p.hist; H.push([p.x, p.y, p.z]); if (H.length > 10) H.shift(); } });
      }
      for (let i = 0; i < 5; i++) s2.add({ k: "mote", x: o.x - ux * 0.3, y: o.y + s2.rand(-0.2, 0.2), z: s2.rand(0.1, 1), vx: ux * s2.rand(2, 4), vy: uy * 2, drag: 1.5, life: 0.6, R: M.R, minor: i > 1 });
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => {
      for (let k = 0; k < 3; k++) {
        const q0 = (k / 3) * TAU, zk = (0.3 + k * 0.3) * h;
        s2.add({ k: "moRide", trail: "wind", x, y, z: zk, life, R: M.R, hist: [], from: 0.8, update(p) { const q = q0 + p.age * 5; p.x = x + Math.cos(q) * 0.42; p.y = y + Math.sin(q) * 0.2; const H = p.hist; H.push([p.x, p.y, p.z]); if (H.length > 8) H.shift(); } });
      }
    }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => { for (let i = 0; i < 5; i++) s2.add({ k: "mote", x: x + s2.rand(-0.3, 0.3), y: y + s2.rand(-0.2, 0.2), z: 0.05, vx: s2.rand(-1, 1), vy: s2.rand(-0.5, 0.5), vz: s2.rand(0.2, 0.5), drag: 1.5, life: 1.2, R: M.R, minor: true }); }),
  },
  tornado: {
    carrier: (s, M, p) => ride(p, { head: "moFunnel", sz: 8 }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      s2.add({ k: "moFunnel", x: o.x, y: o.y, z: 0, sz: o.pow > 1.2 ? 24 : 18, life: 1.1, from: 0.75, R: M.R, update(p) { p.x = o.x + Math.sin(p.age * 6) * 0.08; } });
      for (let i = 0; i < 6; i++) { const q0 = s2.rand(0, TAU); s2.add({ k: "chunk", x: o.x, y: o.y, z: 0.2, s: 1, life: 1, R: M.R, minor: i > 2, update(p) { const q = q0 + p.age * 9; p.x = o.x + Math.cos(q) * 0.35; p.y = o.y + Math.sin(q) * 0.18; p.z = 0.15 + p.age * 0.8; } }); }
      s2.light(o.x, o.y, 0.6, 1.2, S(M.R, 0.85), 0.5, 0.9);
    }),
    conjure: (s, M, { x, y, at, life }) => later(s, at, (s2) => s2.add({ k: "moFunnel", x: x + 0.45, y, z: 0, sz: 14, life, from: 0.8, R: M.R, update(p) { p.x = x + 0.45 + Math.sin(p.age * 4) * 0.06; } })),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => puffs(s2, M.R, x, y, 0.05, 3, { r: 2.5, tone: 0.5, sp: 1.2, vz: 0.1, life: 1.2 })),
  },
  lightning: {
    carrier: (s, M, p) => ride(p, { trail: "bolt", headOrb: true, seed: s.seedInt() % 997 }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const z = z0(o);
      s2.add({ k: "bolt", a: [o.x + 0.2, o.y, z + 3], b: [o.x, o.y, z], life: 0.22, R: M.R, seed: s2.seedInt(), update: still });
      if (o.pow > 1.2) s2.add({ k: "bolt", a: [o.x - 0.3, o.y, z + 3], b: [o.x, o.y, z], life: 0.16, R: M.R, seed: s2.seedInt(), wait: 0.05, update: still });
      flare(s2, M, o.x, o.y, z, o.pow * 1.2, 0.35);
      s2.add({ k: "moCrackle", x: o.x, y: o.y, z, r: 0.35, n: 2, life: 0.5, seed: s2.seedInt(), R: M.R, update: still });
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => { s2.add({ k: "moCrackle", x, y, z: 0.55 * h, r: 0.45, n: 2, life, seed: s2.seedInt(), R: M.R, update: still }); s2.light(x, y, 0.6, 1.1, S(M.R, 0.85), 0.5, life, { flicker: true }); }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => { s2.add({ k: "scorch", x, y, r: 0.28, life: 2.4, seed: s2.seedInt(), update: still }); s2.add({ k: "moCrackle", x, y, z: 0.05, r: 0.25, n: 1, life: 0.8, seed: s2.seedInt(), R: M.R, update: still }); }),
  },
  sun: {
    carrier: (s, M, p) => ride(p, { head: "moSun", sz: 3 }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const z = z0(o) + 0.8;
      s2.add({ k: "moSun", x: o.x, y: o.y, z, sz: o.pow > 1.2 ? 6 : 4, life: 0.9, inT: 0.08, from: 0.6, R: M.R, update: still });
      s2.add({ k: "beam", x: o.x, y: o.y, h: z, w: 3, life: 0.6, R: M.R, update: still });
      s2.light(o.x, o.y, z0(o), 2, S(M.R, 0.85), 1.1 * Math.min(1.4, o.pow), 0.9);
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => { s2.add({ k: "moSun", x, y, z: 1.6 * h, sz: 3, life, inT: 0.1, from: 0.8, R: M.R, update: still }); s2.light(x, y, 1.4 * h, 1.6, S(M.R, 0.85), 0.6, life); }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => s2.add({ k: "ring", x, y, r: 0.45, life: 1.4, R: M.R, seed: 31, update: still })),
  },
  moon: {
    carrier: (s, M, p) => ride(p, { bm: MOON, face: "lr" }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const z = z0(o) + 0.8;
      pop(s2, M.R, MOON, { x: o.x, y: o.y, z, life: 1, hero: 1, from: 0.6, snap: true, vz: 0.1, update: undefined, drag: 2 });
      s2.add({ k: "beam", x: o.x, y: o.y, h: z, w: 2.5, life: 0.7, R: M.R, wait: 0.1, update: still });
      glints(s2, M, o.x, o.y, z0(o), 3, 0.35, 0.15);
      s2.light(o.x, o.y, z0(o), 1.6, S(M.R, 0.85), 0.8, 0.9);
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => { hover(s2, M.R, MOON, { x, y, z: 1.55 * h, life }); s2.add({ k: "beam", x, y, h: 1.5 * h, w: 2, life: Math.min(life, 1.2), R: M.R, wait: 0.1, update: still }); }),
  },
  star: {
    carrier: (s, M, p) => ride(p, { bm: STAR, spin: TAU / 16, shed(q, s2, dt) { if (s2.count(12, dt)) s2.add({ k: "glint", x: q.x, y: q.y, z: q.z, life: 5 / 12, R: M.R, minor: true, update: still }); } }),
    impact: (s, M, o) => later(s, o.at, (s2) => drop(s2, M.R, STAR, { x: o.x, y: o.y, z: z0(o), from: 1.6, fall: 0.15, life: 0.35, spin: TAU / 16, land: (s3) => {
      s3.add({ k: "star", x: o.x, y: o.y, z: z0(o), L: o.pow > 1.2 ? 10 : 7, life: 3 / 12, R: M.R, update: still });
      flare(s3, M, o.x, o.y, z0(o), o.pow, 0.35);
      glints(s3, M, o.x, o.y, z0(o), o.pow > 1.2 ? 6 : 4, 0.5, 0.04);
    } })),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => orbit(s2, M.R, STAR, { x, y, z: 1.35 * h, n: 3, r: 0.38, w: 2.4, life, from: 0.8 })),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => glints(s2, M, x, y, 0.08, 4, 0.4, 0.1)),
  },
  comet: {
    carrier: (s, M, p) => ride(p, { trail: "comet", headOrb: true, big: true, shed(q, s2, dt) { if (s2.count(30, dt)) s2.add({ k: "ember", x: q.x, y: q.y, z: q.z, vx: s2.rand(-0.4, 0.4), vz: s2.rand(-0.3, 0.3), drag: 2, life: 0.4, R: M.R, seed: s2.R(), minor: true }); } }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const a = [o.x - 1.4, o.y - 0.4, 3], b = [o.x, o.y, 0.1];
      const p = s2.add({ k: "orb", x: a[0], y: a[1], z: a[2], r: 4, big: true, life: 0.2, R: M.R, glow: true, update(q) { const u = clamp(q.age / 0.2); q.x = lerp(a[0], b[0], u); q.y = lerp(a[1], b[1], u); q.z = lerp(a[2], b[2], u); } });
      ride(p, { k: "moRide", headOrb: true, trail: "comet", len: 26 });
      s2.at(s2.t + 0.2, (s3) => {
        flare(s3, M, o.x, o.y, 0.3, o.pow * 1.3, 0.5); s3.shake = Math.max(s3.shake, 2);
        s3.add({ k: "ring", x: o.x, y: o.y, r: 0.7 + (o.rad ?? 0), life: 0.5, R: M.R, broken: true, seed: 2, update: still });
        s3.add({ k: "scorch", x: o.x, y: o.y, r: 0.4 + (o.rad ?? 0) * 0.5, life: 2.4, seed: s3.seedInt(), update: still });
        for (let i = 0; i < 6; i++) { const q = s3.rand(0, TAU); s3.add({ k: "chunk", x: o.x, y: o.y, z: 0.1, vx: Math.cos(q) * 3, vy: Math.sin(q) * 1.6, vz: s3.rand(2, 3.5), g: 9, drag: 0.6, bounce: 0.3, life: 1.1, R: M.R, s: 2, debris: true, minor: i > 2 }); }
      });
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => {
      const p = s2.add({ k: "orb", x, y, z: 1.5 * h, r: 2, life, R: M.R, glow: true, update(q) { const a = q.age * 4; q.x = x + Math.cos(a) * 0.45; q.y = y + Math.sin(a) * 0.22; q.z = 1.5 * h + Math.sin(a) * 0.1; } });
      ride(p, { headOrb: true, trail: "comet", len: 12 });
    }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => { s2.add({ k: "scorch", x, y, r: 0.35, life: 2.4, seed: s2.seedInt(), update: still }); for (let i = 0; i < 4; i++) s2.add({ k: "ember", x: x + s2.rand(-0.3, 0.3), y: y + s2.rand(-0.2, 0.2), z: 0.05, vz: s2.rand(0.2, 0.6), drag: 1, life: 1.2, R: M.R, seed: s2.R(), minor: true }); }),
  },

  /* earth and water */
  stone: {
    carrier: (s, M, p) => ride(p, { bm: BOULDER, spin: TAU / 8 }),
    impact: (s, M, o) => later(s, o.at, (s2) => drop(s2, M.R, BOULDER, { x: o.x, y: o.y, z: z0(o) * 0.7, from: 1.4, fall: 0.18, life: 0.3, land: (s3) => {
      flare(s3, M, o.x, o.y, z0(o) * 0.7, o.pow, 0.35); s3.shake = Math.max(s3.shake, 1.5);
      for (let i = 0; i < (o.pow > 1.2 ? 8 : 6); i++) { const q = s3.rand(0, TAU); s3.add({ k: "chunk", x: o.x, y: o.y, z: 0.4, vx: Math.cos(q) * 2.6, vy: Math.sin(q) * 1.4, vz: s3.rand(1.5, 3), g: 9, drag: 0.6, bounce: 0.35, life: 1.3, R: M.R, s: i % 2 ? 3 : 2, wide: i % 3 === 0, debris: true, minor: i > 4 }); }
      puffs(s3, M.R, o.x, o.y, 0.1, 2, { r: 3, tone: 0.45, sp: 1, vz: 0.2 });
    } })),
    conjure: (s, M, { x, y, at, life }) => later(s, at, (s2) => { pop(s2, M.R, MENHIR, { x: x + 0.45, y: y - 0.05, z: 0, base: true, grow: 0.3, life, from: 0.8 }); puffs(s2, M.R, x + 0.45, y, 0.05, 2, { r: 2.5, tone: 0.45, sp: 0.8, vz: 0.15 }); }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => { for (let i = 0; i < 5; i++) s2.add({ k: "chunk", x: x + s2.rand(-0.35, 0.35), y: y + s2.rand(-0.25, 0.25), z: 0, s: 2, wide: i % 2 === 0, life: 2.4, R: M.R, debris: true, update: still }); }),
  },
  crystal: {
    carrier: (s, M, p) => ride(p, { bm: SHARD, face: true }),
    impact: (s, M, o) => erupt(s, M, crystalAt(M, 13, 2.5), { ...o, n: many(o.pow, o.rad ?? 0, 5), rad: Math.max(0.3, (o.rad ?? 0) * 0.8) }),
    conjure: (s, M, { x, y, at }) => { erupt(s, M, crystalAt(M, 9, 2), { x, y, n: 6, rad: 0.48, at, wave: 0.06 }); later(s, at, (s2) => glints(s2, M, x, y, 0.4, 3, 0.4, 0.3)); },
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => { for (let i = 0; i < 3; i++) s2.add({ k: "crystal", x: x + s2.rand(-0.3, 0.3), y: y + s2.rand(-0.2, 0.2), h: 5, w: 1.5, lean: s2.rand(-1, 1), life: 2.2, R: M.R, update: still }); }),
  },
  spike: {
    carrier: (s, M, p) => ride(p, { bm: SPIKE, face: true, keepUp: true }),
    impact: (s, M, o) => erupt(s, M, crystalAt(M, 15, 1.6), { ...o, n: many(o.pow, o.rad ?? 0, 6), rad: Math.max(0.3, (o.rad ?? 0) * 0.8), wave: 0.02 }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => { for (let i = 0; i < 4; i++) s2.add({ k: "crystal", x: x + s2.rand(-0.35, 0.35), y: y + s2.rand(-0.25, 0.25), h: 6, w: 1.2, lean: s2.rand(-1, 1), life: 2.2, R: M.R, update: still }); }),
  },
  wave: {
    carrier: (s, M, p) => ride(p, { frames: [WAVE[1], WAVE[2]], loop: true, fps: 6, face: "lr", shed(q, s2, dt) { if (s2.count(16, dt)) s2.add({ k: "droplet", x: q.x, y: q.y, z: q.z + 0.15, vx: s2.rand(-0.6, 0.6), vz: s2.rand(0.5, 1.5), g: 7, life: 0.5, R: M.R, minor: true }); } }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const [ux] = fromCaster(s2, o.x, o.y), side = ux >= 0 ? -1 : 1, z = Math.max(0, z0(o) - 0.55);
      s2.add({ k: "moSprite", R: M.R, frames: [WAVE[0], WAVE[1], WAVE[1], WAVE[2], WAVE[2]], fps: 14, x: o.x + side * 0.5, y: o.y + 0.02, z, base: true, flip: side > 0, life: 0.95, from: 0.7, update(p) { p.x = o.x + side * lerp(0.6, -0.1, easeOut(clamp(p.age / 0.35))); } });
      s2.at(s2.t + 0.28, (s3) => {
        for (let i = 0; i < (o.pow > 1.2 ? 12 : 8); i++) { const q = s3.rand(-1, 1) + (side > 0 ? Math.PI : 0); s3.add({ k: "droplet", x: o.x, y: o.y, z: 0.6, vx: Math.cos(q) * s3.rand(1, 2.5), vy: Math.sin(q) * 0.8, vz: s3.rand(1, 2.6), g: 8, life: 1, R: M.R, big: i % 3 === 0, minor: i % 2 === 1, onGround: splat }); }
        flare(s3, M, o.x, o.y, 0.5, o.pow * 0.8, 0.35);
      });
    }),
    conjure: (s, M, { x, y, at, life }) => later(s, at, (s2) => {
      s2.add({ k: "ripple", x, y, r: 0.6, n: 3, life: Math.min(life, 1.6), R: M.R, update: still });
      s2.add({ k: "moSprite", R: M.R, frames: [WAVE[0], WAVE[1], WAVE[2], WAVE[1]], loop: true, fps: 5, x: x - 0.45, y: y + 0.05, z: 0, base: true, life, from: 0.8, update: still });
    }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => { s2.add({ k: "puddle", x, y, r: 0.3, life: 2.4, R: M.R, debris: true, update: still }); for (let i = 0; i < 3; i++) s2.add({ k: "waterbubble", x: x + s2.rand(-0.25, 0.25), y: y + s2.rand(-0.15, 0.15), z: 0.02, r: 1, life: s2.rand(0.6, 1.2), wait: i * 0.3, R: M.R, update: still }); }),
  },
  bubble: {
    carrier: (s, M, p) => ride(p, { head: "moBubble", sz: 3 }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const z = z0(o), popAt = 0.45;
      s2.add({ k: "moBubble", x: o.x, y: o.y, z, sz: 0.5 * s2.spec.aps * (o.pow > 1.2 ? 1.2 : 1), popAt, life: popAt + 0.25, R: M.R, update: still });
      s2.at(s2.t + popAt, (s3) => { for (let i = 0; i < 8; i++) { const q = (i / 8) * TAU; s3.add({ k: "droplet", x: o.x + Math.cos(q) * 0.4, y: o.y + Math.sin(q) * 0.2, z, vx: Math.cos(q) * 1.5, vy: Math.sin(q) * 0.7, vz: s3.rand(0.5, 1.5), g: 7, life: 0.7, R: M.R, minor: i % 2 === 1 }); } flare(s3, M, o.x, o.y, z, o.pow * 0.7, 0.3); });
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => {
      s2.add({ k: "moBubble", x, y, z: 0.55 * h, sz: 0.55 * s2.spec.aps, life, popAt: life - 0.2, R: M.R, update: still });
      for (let i = 0; i < 4; i++) s2.add({ k: "waterbubble", x: x + s2.rand(-0.3, 0.3), y, z: s2.rand(0.1, 0.6) * h, vz: 0.5, r: s2.rand(1, 2), life: 0.9, R: M.R, wait: 0.2 + i * 0.25, minor: i > 1, update(p, _s, dt) { p.z += p.vz * dt; } });
    }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => { for (let i = 0; i < 4; i++) s2.add({ k: "waterbubble", x: x + s2.rand(-0.3, 0.3), y: y + s2.rand(-0.2, 0.2), z: 0.02, r: 1, life: s2.rand(0.5, 1.1), wait: i * 0.25, R: M.R, update: still }); }),
  },
  mist: {
    carrier: (s, M, p) => ride(p, { headOrb: true, shed(q, s2, dt) { if (s2.count(16, dt)) s2.add({ k: "smoke", x: q.x, y: q.y, z: q.z, vz: 0.1, drag: 2, r: s2.rand(2, 3), life: 0.6, lobes: lobes(s2), R: M.R, tone: 0.78, minor: true }); } }),
    impact: (s, M, o) => later(s, o.at, (s2) => puffs(s2, M.R, o.x, o.y, 0.25, o.pow > 1.2 ? 7 : 5, { r: 4.5, tone: 0.8, sp: 1.4, vz: 0.05, life: 1.6 })),
    conjure: (s, M, { x, y, at, life }) => later(s, at, (s2) => {
      s2.emit(s2.t, s2.t + life * 0.8, (s3, _u, dt) => { for (let i = s3.count(6, dt); i > 0; i--) { const q = s3.rand(0, TAU); s3.add({ k: "smoke", x: x + Math.cos(q) * 0.4, y: y + Math.sin(q) * 0.25, z: 0.08, vx: -Math.sin(q) * 0.4, vy: Math.cos(q) * 0.2, vz: 0.05, drag: 1, r: s3.rand(3, 4), life: 1.2, lobes: lobes(s3), R: M.R, tone: 0.78 }); } });
    }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => puffs(s2, M.R, x, y, 0.05, 3, { r: 4, tone: 0.75, sp: 0.3, vz: 0.02, life: 2 })),
  },
  smoke: {
    carrier: (s, M, p) => ride(p, { headOrb: true, shed(q, s2, dt) { if (s2.count(18, dt)) s2.add({ k: "smoke", x: q.x, y: q.y, z: q.z, vz: 0.25, drag: 2, r: s2.rand(2, 3), life: 0.7, lobes: lobes(s2), R: M.R, tone: 0.3, minor: true }); } }),
    impact: (s, M, o) => later(s, o.at, (s2) => puffs(s2, M.R, o.x, o.y, z0(o), o.pow > 1.2 ? 7 : 5, { r: 4.5, tone: 0.3, sp: 1.3, vz: 0.5, life: 1.3 })),
    conjure: (s, M, { x, y, at, life }) => later(s, at, (s2) => s2.emit(s2.t, s2.t + life * 0.75, (s3, _u, dt) => { for (let i = s3.count(7, dt); i > 0; i--) s3.add({ k: "smoke", x: x + s3.rand(-0.15, 0.15), y, z: 0.1, vz: 0.9, drag: 0.6, r: s3.rand(2.5, 3.5), life: 1.2, lobes: lobes(s3), R: M.R, tone: 0.35 }); })),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => { for (let i = 0; i < 3; i++) s2.add({ k: "smoke", x: x + s2.rand(-0.3, 0.3), y: y + s2.rand(-0.2, 0.2), z: 0.05, vz: 0.4, drag: 0.8, r: 2, life: 1.4, wait: i * 0.4, lobes: lobes(s2), R: M.R, tone: 0.3 }); }),
  },

  /* growth */
  vine: {
    carrier: (s, M, p) => ride(p, { trail: "vine", bm: VINE_LEAF, face: true }),
    impact: (s, M, o) => MOTIFS.vine.conjure(s, M, { x: o.x, y: o.y, h: 1, at: o.at, life: 1.3, fast: true }),
    conjure: (s, M, { x, y, h, at, life, fast }) => later(s, at, (s2) => {
      for (let k = 0; k < 3; k++) {
        const q0 = (k / 3) * TAU, growT = fast ? 0.25 : 0.6;
        s2.add({ k: "moHelix", x, y, h: h * 0.95, r: 0.36, q0, growT, life, R: M.R, from: 0.8, update: still });
      }
      if (fast) s2.at(s2.t + 0.25, (s3) => { s3.hit(null); s3.light(x, y, 0.5, 1, S(M.R, 0.85), 0.5, 0.5); });
    }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => s2.add({ k: "moRoot", x, y, r: 0.5, n: 4, growT: 0.3, life: 2.4, seed: s2.seedInt(), R: M.R, update: still })),
  },
  thorn: {
    carrier: (s, M, p) => ride(p, { bm: THORN, face: true, keepUp: true }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const z = z0(o), n = o.pow > 1.2 ? 8 : 6;
      for (let i = 0; i < n; i++) { const q = (i / n) * TAU; s2.add({ k: "moSprite", R: M.R, bm: THORN, x: o.x, y: o.y, z, ang: q, life: 0.6, from: 0.6, update(p) { const d = 0.1 + 0.4 * easeOut(clamp(p.age / 0.15)); p.x = o.x + Math.cos(q) * d; p.y = o.y + Math.sin(q) * d * 0.6; p.z = z - Math.sin(q) * 0.15; } }); }
      flare(s2, M, o.x, o.y, z, o.pow * 0.7, 0.3);
    }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => s2.add({ k: "moBramble", x, y, r: 0.4, seed: s2.R() * 10, life: 2.4, R: M.R, update: still })),
  },
  root: {
    impact: (s, M, o) => later(s, o.at, (s2) => {
      s2.add({ k: "moRoot", x: o.x, y: o.y, r: 0.6 + (o.rad ?? 0), n: 6, growT: 0.15, life: 1.4, seed: s2.seedInt(), R: M.R, update: still });
      for (let k = 0; k < 3; k++) s2.add({ k: "moHelix", x: o.x, y: o.y, h: 0.5, r: 0.38, q0: (k / 3) * TAU, growT: 0.15, life: 1.2, R: M.R, thick: true, update: still });
      puffs(s2, M.R, o.x, o.y, 0.05, 2, { r: 2.5, tone: 0.4, sp: 1, vz: 0.15 });
    }),
    conjure: (s, M, { x, y, at, life }) => later(s, at, (s2) => s2.add({ k: "moRoot", x, y, r: 0.7, n: 7, growT: 0.5, life, seed: s2.seedInt(), R: M.R, update: still })),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => s2.add({ k: "moRoot", x, y, r: 0.5, n: 5, growT: 0.2, life: 2.4, seed: s2.seedInt(), R: M.R, update: still })),
  },
  flower: {
    carrier: (s, M, p) => ride(p, { bm: FLOWER[2], spin: TAU / 16, shed(q, s2, dt) { if (s2.count(10, dt)) s2.add({ k: "petal", x: q.x, y: q.y, z: q.z, vx: s2.rand(-0.5, 0.5), g: 0.4, drag: 2, life: 0.9, seed: s2.R(), R: M.R, minor: true }); } }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const z = z0(o) + 0.2;
      pop(s2, M.R, null, { frames: FLOWER, fps: 8, x: o.x, y: o.y, z, life: 0.6, from: 0.75 });
      s2.at(s2.t + 0.45, (s3) => { for (let i = 0; i < 10; i++) s3.add({ k: "petal", x: o.x, y: o.y, z, vx: s3.rand(-2, 2), vy: s3.rand(-1, 1), vz: s3.rand(0.3, 1.5), g: 0.6, drag: 2, life: 1.3, seed: s3.R(), R: M.R, minor: i % 2 === 1 }); flare(s3, M, o.x, o.y, z, o.pow * 0.6, 0.3); });
    }),
    conjure: (s, M, { x, y, at, life }) => later(s, at, (s2) => {
      for (let i = 0; i < 5; i++) { const q = (i / 5) * TAU + 0.4, d = s2.rand(0.38, 0.5); pop(s2, M.R, null, { frames: FLOWER, fps: 6, x: x + Math.cos(q) * d, y: y + Math.sin(q) * d * 0.7, z: 0, base: true, life, wait: i * 0.06, from: 0.8 }); }
    }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => { for (let i = 0; i < 7; i++) s2.add({ k: "petal", x: x + s2.rand(-0.4, 0.4), y: y + s2.rand(-0.3, 0.3), z: 0.02, life: 2.2, seed: s2.R(), R: M.R, update: still }); }),
  },
  leaf: {
    carrier: (s, M, p) => ride(p, { bm: LEAF, spin: TAU / 8, shed(q, s2, dt) { if (s2.count(8, dt)) s2.add({ k: "moSprite", bm: LEAF, x: q.x, y: q.y, z: q.z, vz: -0.3, drag: 2, life: 0.7, ang: s2.rand(0, TAU), R: M.R, minor: true }); } }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const z = z0(o);
      for (let i = 0; i < (o.pow > 1.2 ? 10 : 7); i++) { const q0 = (i / 7) * TAU; s2.add({ k: "moSprite", R: M.R, bm: LEAF, x: o.x, y: o.y, z, life: 1, minor: i % 3 === 2, from: 0.6, update(p) { const q = q0 + p.age * 6, d = 0.1 + p.age * 0.6; p.x = o.x + Math.cos(q) * d; p.y = o.y + Math.sin(q) * d * 0.5; p.z = z + p.age * 0.4; p.ang = q + Math.PI / 2; } }); }
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => { for (let i = 0; i < 7; i++) { const q0 = (i / 7) * TAU; s2.add({ k: "moSprite", R: M.R, bm: LEAF, x, y, z: 0.1, life, wait: i * 0.05, from: 0.8, update(p) { const q = q0 + p.age * 3.5; p.x = x + Math.cos(q) * 0.42; p.y = y + Math.sin(q) * 0.22; p.z = 0.1 + ((p.age * 0.45 + i / 7) % 1) * 1.2 * h; p.ang = q + Math.PI / 2; } }); } }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => { for (let i = 0; i < 5; i++) pop(s2, M.R, LEAF, { k: "moDecal", x: x + s2.rand(-0.4, 0.4), y: y + s2.rand(-0.3, 0.3), z: 0, ang: s2.rand(0, TAU), life: 2.4, o: 1, wait: i * 0.08, from: 0.6 }); }),
  },
  tree: {
    impact: (s, M, o) => later(s, o.at, (s2) => {
      s2.add({ k: "moTree", x: o.x + 0.05, y: o.y + 0.05, sz: o.pow > 1.2 ? 26 : 22, growT: 0.25, life: 1.4, from: 0.7, R: M.R, update: still });
      s2.shake = Math.max(s2.shake, 1.2);
      puffs(s2, M.R, o.x, o.y, 0.05, 3, { r: 2.5, tone: 0.4, sp: 1.2, vz: 0.2 });
      s2.at(s2.t + 0.25, (s3) => MOTIFS.leaf.residue(s3, M, { x: o.x, y: o.y }));
    }),
    conjure: (s, M, { x, y, at, life }) => later(s, at, (s2) => { s2.add({ k: "moTree", x: x + 0.45, y: y - 0.05, sz: 20, growT: 0.7, life, from: 0.85, R: M.R, update: still }); puffs(s2, M.R, x + 0.45, y, 0.05, 2, { r: 2, tone: 0.4, sp: 0.6, vz: 0.15 }); }),
    residue: (s, M, o) => MOTIFS.leaf.residue(s, M, o),
  },
  spore: {
    carrier: (s, M, p) => ride(p, { headOrb: true, shed(q, s2, dt) { for (let i = s2.count(30, dt); i > 0; i--) s2.add({ k: "mote", x: q.x, y: q.y, z: q.z, vx: s2.rand(-0.4, 0.4), vy: s2.rand(-0.3, 0.3), vz: s2.rand(-0.1, 0.3), drag: 2, life: 0.8, R: M.R, minor: true }); } }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      puffs(s2, M.R, o.x, o.y, z0(o), 4, { r: 3.5, tone: 0.62, sp: 1.2, vz: 0.2, life: 1.2 });
      for (let i = 0; i < 16; i++) { const q = s2.rand(0, TAU), sp = s2.rand(0.4, 1.4); s2.add({ k: "mote", x: o.x, y: o.y, z: z0(o), vx: Math.cos(q) * sp, vy: Math.sin(q) * sp * 0.6, vz: s2.rand(0, 0.6), drag: 1.2, life: s2.rand(1, 1.8), R: M.R, minor: i % 2 === 1 }); }
    }),
    conjure: (s, M, { x, y, at, life }) => later(s, at, (s2) => {
      for (let i = 0; i < 4; i++) { const q = (i / 4) * TAU + 0.6; pop(s2, M.R, MUSHROOM, { x: x + Math.cos(q) * 0.45, y: y + Math.sin(q) * 0.3, z: 0, base: true, grow: 0.25, life, wait: i * 0.08, from: 0.85 }); }
      s2.emit(s2.t + 0.3, s2.t + life * 0.8, (s3, _u, dt) => { for (let i = s3.count(14, dt); i > 0; i--) s3.add({ k: "mote", x: x + s3.rand(-0.45, 0.45), y: y + s3.rand(-0.3, 0.3), z: 0.25, vz: s3.rand(0.3, 0.7), vx: s3.rand(-0.2, 0.2), drag: 1, life: 1, R: M.R, minor: true }); });
    }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => { for (let i = 0; i < 2; i++) pop(s2, M.R, MUSHROOM, { x: x + s2.rand(-0.3, 0.3), y: y + s2.rand(-0.2, 0.2), z: 0, base: true, grow: 0.3, life: 2.4, from: 0.7 }); }),
  },

  /* spirit */
  ghost: {
    carrier: (s, M, p) => ride(p, { trail: "wisp", frames: GHOST, loop: true, fps: 6, face: "lr", mix: false }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const [ux, uy] = fromCaster(s2, o.x, o.y), z = z0(o) + 0.1;
      s2.add({ k: "moSprite", R: M.R, frames: GHOST, loop: true, fps: 8, x: o.x - ux * 0.7, y: o.y - uy * 0.7, z, flip: ux < 0, life: 0.6, hero: 1, from: 0.45, update(p) { const f = p.age / 0.6; p.x = o.x + ux * lerp(-0.7, 0.9, f); p.y = o.y + uy * lerp(-0.7, 0.9, f); p.z = z + Math.sin(f * Math.PI) * 0.2; } });
      s2.add({ k: "moRings", x: o.x, y: o.y, z, n: 3, sz: 9, life: 0.5, R: M.R, wait: 0.15, update: still });
      s2.at(s2.t + 0.25, (s3) => flare(s3, M, o.x, o.y, z, o.pow * 0.8, 0.3));
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => s2.add({ k: "moSprite", R: M.R, frames: GHOST, loop: true, fps: 5, x: x + 0.45, y, z: 0, base: true, grow: 0.3, life, from: 0.8, update(p) { p.z = Math.min(0.5 * h, p.age * 1.2) + Math.sin(p.age * 3) * 0.05; } })),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => { for (let i = 0; i < 4; i++) s2.add({ k: "wisp", x: x + s2.rand(-0.3, 0.3), y: y + s2.rand(-0.2, 0.2), z: 0.05, vz: s2.rand(0.4, 0.8), drag: 0.6, s: 2, life: 1.2, wait: i * 0.25, R: M.R }); }),
  },
  rune: {
    carrier: (s, M, p) => ride(p, { bm: pick(s, RUNES), face: "lr", shed(q, s2, dt) { if (s2.count(10, dt)) s2.add({ k: "glint", x: q.x, y: q.y, z: q.z, life: 5 / 12, R: M.R, minor: true, update: still }); } }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const z = z0(o) + 0.35, rune = pick(s2, RUNES);
      pop(s2, M.R, rune, { x: o.x, y: o.y, z, life: 0.8, hero: 2, from: 0.55 });
      s2.add({ k: "glyph", x: o.x, y: o.y, r: 0.5 + (o.rad ?? 0) * 0.5, life: 1, R: M.R, star: true, update: still });
      flare(s2, M, o.x, o.y, z, o.pow, 0.35);
      for (let i = 0; i < 3; i++) { const q = (i / 3) * TAU - Math.PI / 2; s2.add({ k: "moSprite", R: M.R, bm: RUNES[(i + 1) % RUNES.length], x: o.x, y: o.y, z, vx: Math.cos(q) * 1.4, vy: Math.sin(q) * 0.5, vz: 0.6, drag: 3, life: 0.7, wait: 0.08, minor: i > 0 }); }
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => orbit(s2, M.R, RUNES, { x, y, z: 0.7 * h, n: 3, r: 0.48, w: 2, life, from: 0.85 })),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => pop(s2, M.R, pick(s2, RUNES), { k: "moDecal", x, y, z: 0, life: 2.2, o: 1, from: 0.5 })),
  },
  glyph: {
    carrier: (s, M, p) => ride(p, { head: "moSigil", sz: 4 }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      s2.add({ k: "glyph", x: o.x, y: o.y, r: 0.55 + (o.rad ?? 0) * 0.6, life: 1.1, R: M.R, star: true, spin: 2, update: still });
      s2.add({ k: "beam", x: o.x, y: o.y, h: 2.2, w: 3, life: 0.45, R: M.R, wait: 0.05, update: still });
      flare(s2, M, o.x, o.y, z0(o), o.pow, 0.4);
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => {
      s2.add({ k: "glyph", x, y, r: 0.55, life, R: M.R, star: true, update: still });
      for (let i = 0; i < 4; i++) s2.add({ k: "moSigil", x: x + s2.rand(-0.35, 0.35), y, z: 0.1, sz: 3, vz: 0.6, drag: 0.4, life: 1.1, wait: 0.15 + i * 0.22, R: M.R, minor: i > 1 });
    }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => s2.add({ k: "glyph", x, y, r: 0.45, life: 2, R: M.R, update: still })),
  },
  word: {
    carrier: (s, M, p) => ride(p, { trail: "letters", bm: LETTERS[0], face: "lr", seed: s.seedInt() % 6 }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const z = z0(o) + 0.2, n = 7;
      for (let i = 0; i < n; i++) { const q = (i / n) * TAU; s2.add({ k: "moSprite", R: M.R, bm: LETTERS[i % LETTERS.length], x: o.x, y: o.y, z, vx: Math.cos(q) * 1.8, vy: Math.sin(q) * 0.7, vz: 0.4, drag: 3.5, life: 0.8, hero: 1, minor: i % 3 === 2 }); }
      flare(s2, M, o.x, o.y, z, o.pow, 0.3);
      s2.add({ k: "moRings", x: o.x, y: o.y, z, n: 2, sz: 8, life: 0.4, R: M.R, update: still });
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => orbit(s2, M.R, LETTERS, { x, y, z: 1.3 * h, n: 6, r: 0.36, w: 1.6, life, from: 0.85, o: 2 })),
  },
  note: {
    carrier: (s, M, p) => ride(p, { frames: [NOTE, NOTE, NOTES2, NOTES2], loop: true, fps: 8, face: "lr", bob: 2, shed(q, s2, dt) { if (s2.count(5, dt)) s2.add({ k: "moSprite", bm: NOTE, x: q.x, y: q.y, z: q.z, vz: 0.6, drag: 2, life: 0.6, R: M.R, minor: true }); } }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const z = z0(o);
      for (let i = 0; i < 5; i++) { const q = (i / 5) * Math.PI + Math.PI; s2.add({ k: "moSprite", R: M.R, bm: i % 2 ? NOTES2 : NOTE, x: o.x, y: o.y, z, vx: Math.cos(q) * 1.4, vy: 0, vz: 0.9 + Math.sin(q) * -0.6, drag: 2.5, life: 0.9, hero: 1, minor: i > 2 }); }
      s2.add({ k: "moRings", x: o.x, y: o.y, z, n: 3, sz: 10, life: 0.5, R: M.R, update: still });
      flare(s2, M, o.x, o.y, z, o.pow * 0.7, 0.3);
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => {
      const n = Math.max(3, Math.round(life * 3));
      for (let i = 0; i < n; i++) s2.add({ k: "moSprite", R: M.R, bm: i % 2 ? NOTES2 : NOTE, x: x + (i % 2 ? 0.35 : -0.35), y, z: 0.6 * h, life: 1, wait: i * (life / n) * 0.7, hero: 1, from: 0.7, update(p) { p.z = 0.6 * h + p.age * 0.6; p.x = x + (i % 2 ? 0.35 : -0.35) + Math.sin(p.age * 6) * 0.08; } });
    }),
  },
  bell: {
    carrier: (s, M, p) => ride(p, { bm: BELL, ang: 0, update0: null, spin: 0, face: false, wob: true }),
    impact: (s, M, o) => MOTIFS.bell.conjure(s, M, { x: o.x, y: o.y, h: (z0(o) + 0.2) / 1.25, at: o.at, life: 0.9, tolls: 1, pow: o.pow }),
    conjure: (s, M, { x, y, h, at, life, tolls = 2 }) => later(s, at, (s2) => {
      const z = 1.45 * h;
      s2.add({ k: "moSprite", R: M.R, bm: BELL, x, y, z, life, hero: 1, from: 0.8, snap: true, update(p) { const fr = Math.floor(p.age * 12); p.ang = [0, 0.4, 0, -0.4][(fr >> 1) % 4]; } });
      for (let i = 0; i < tolls; i++) s2.at(s2.t + 0.12 + i * Math.min(0.5, life / (tolls + 0.5)), (s3) => { s3.add({ k: "moRings", x, y, z, n: 3, sz: 11, life: 0.55, R: M.R, update: still }); s3.light(x, y, z, 1.4, S(M.R, 0.85), 0.8, 0.4); });
    }),
  },
  mirror: {
    carrier: (s, M, p) => ride(p, { bm: MIRROR, spin: TAU / 16, shed(q, s2, dt) { if (s2.count(8, dt)) s2.add({ k: "glint", x: q.x, y: q.y, z: q.z, life: 5 / 12, R: M.R, minor: true, update: still }); } }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const z = z0(o) + 0.1;
      pop(s2, M.R, MIRROR, { x: o.x, y: o.y - 0.1, z, life: 0.32, hero: 1, from: 0.9 });
      s2.at(s2.t + 0.3, (s3) => { for (let i = 0; i < 9; i++) { const q = s3.rand(0, TAU); s3.add({ k: "shard", x: o.x, y: o.y, z, vx: Math.cos(q) * 2.4, vy: Math.sin(q) * 1.2, vz: s3.rand(0.5, 2), g: 7, drag: 0.6, bounce: 0.3, life: 0.9, seed: s3.R(), R: M.R, minor: i % 2 === 1 }); } flare(s3, M, o.x, o.y, z, o.pow, 0.3); });
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => {
      for (const side of [-1, 1]) s2.add({ k: "fmGhost", x, y: y + 0.01, size: 1, h, a: 0.65, life, R: M.R, update(p) { p.x = x + side * 0.42 * easeOut(clamp(p.age / 0.25)) + (Math.floor(p.age * 12) % 6 === 0 ? side * 0.03 : 0); } });
      pop(s2, M.R, MIRROR, { x, y: y - 0.05, z: 0.6 * h, life: 0.35, hero: 1, from: 0.5 });
      glints(s2, M, x, y, 0.7 * h, 3, 0.5, 0.25);
    }),
  },
  door: {
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const [ux] = fromCaster(s2, o.x, o.y), dx = o.x + (ux >= 0 ? 0.35 : -0.35);
      pop(s2, M.R, null, { frames: [DOOR[0], DOOR[1], DOOR[2], DOOR[2], DOOR[2], DOOR[2], DOOR[1], DOOR[0]], fps: 12, x: dx, y: o.y - 0.05, z: 0, base: true, life: 0.75, hero: 1, from: 0.75 });
      s2.at(s2.t + 2 / 12, (s3) => { flare(s3, M, dx, o.y, 0.5, o.pow, 0.4); for (let i = 0; i < 6; i++) s3.add({ k: "streak", x: dx, y: o.y, z: s3.rand(0.15, 0.6), vx: (ux >= 0 ? -1 : 1) * s3.rand(3, 5), vy: s3.rand(-1, 1), life: 0.2, R: M.R, minor: i > 2 }); });
    }),
    conjure: (s, M, { x, y, at, life }) => later(s, at, (s2) => {
      const n = Math.max(6, Math.round(life * 12)), fr = [DOOR[0], DOOR[0], DOOR[1]];
      while (fr.length < n - 2) fr.push(DOOR[2]);
      fr.push(DOOR[1], DOOR[0]);
      pop(s2, M.R, null, { frames: fr, x: x + 0.48, y: y - 0.05, z: 0, base: true, grow: 0.2, life, from: 0.85 });
      s2.at(s2.t + 0.25, (s3) => s3.light(x + 0.48, y, 0.5, 1.2, S(M.R, 0.85), 0.8, Math.max(0.3, life - 0.5)));
    }),
  },
  mask: {
    carrier: (s, M, p) => ride(p, { frames: MASK, loop: true, fps: 3, face: "lr", spin: 0 }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const z = z0(o) + 0.25;
      pop(s2, M.R, null, { frames: [MASK[0], MASK[0], MASK[1], MASK[1], MASK[1]], fps: 8, x: o.x, y: o.y - 0.05, z, life: 0.75, hero: 1, from: 0.6 });
      s2.at(s2.t + 0.55, (s3) => { for (let i = 0; i < 6; i++) { const q = s3.rand(0, TAU); s3.add({ k: "shard", x: o.x, y: o.y, z, vx: Math.cos(q) * 1.6, vy: Math.sin(q) * 0.8, vz: s3.rand(0.3, 1.2), g: 6, drag: 1, life: 0.7, seed: s3.R(), R: M.R, minor: i % 2 === 1 }); } });
      flare(s2, M, o.x, o.y, z, o.pow * 0.8, 0.3);
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => hover(s2, M.R, null, { frames: [MASK[0], MASK[0], MASK[0], MASK[1], MASK[1], MASK[1]], loop: true, fps: 2, x, y: y - 0.06, z: 0.9 * h, life })),
  },
  crown: {
    carrier: (s, M, p) => ride(p, { bm: CROWN, face: "lr", shed(q, s2, dt) { if (s2.count(8, dt)) s2.add({ k: "glint", x: q.x, y: q.y, z: q.z, life: 5 / 12, R: M.R, minor: true, update: still }); } }),
    impact: (s, M, o) => later(s, o.at, (s2) => { const z = z0(o) + 0.55; drop(s2, M.R, CROWN, { x: o.x, y: o.y, z, from: 0.6, fall: 0.2, life: 0.9, land: (s3) => { glints(s3, M, o.x, o.y, z + 0.1, 3, 0.25, 0); flare(s3, M, o.x, o.y, z, o.pow * 0.7, 0.3); } }); }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => { hover(s2, M.R, CROWN, { x, y, z: 1.35 * h, life }); s2.emit(s2.t + 0.2, s2.t + life * 0.8, (s3, _u, dt) => { if (s3.count(3, dt)) s3.add({ k: "glint", x: x + s3.rand(-0.2, 0.2), y, z: 1.38 * h, life: 5 / 12, R: M.R, update: still }); }); }),
  },
  coin: {
    carrier: (s, M, p) => ride(p, { frames: COIN, loop: true, fps: 16 }),
    impact: (s, M, o) => later(s, o.at, (s2) => { scatter(s2, M.R, COIN, o.x, o.y, z0(o), o.pow > 1.2 ? 10 : 7, { sp: 2, g: 8, life: 1.3, bounce: 0.45, frames: COIN, loop: true, fps: 16 }); flare(s2, M, o.x, o.y, z0(o), o.pow * 0.7, 0.3); glints(s2, M, o.x, o.y, z0(o), 3, 0.35, 0.1); }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => s2.emit(s2.t, s2.t + Math.min(1, life * 0.6), (s3, _u, dt) => { for (let i = s3.count(9, dt); i > 0; i--) s3.add({ k: "moSprite", R: M.R, frames: COIN, loop: true, fps: 16, x: x + s3.rand(-0.4, 0.4), y: y + s3.rand(-0.2, 0.2), z: 1.8 * h, vz: -1, g: 6, bounce: 0.4, life: 1.2, minor: i > 1 }); })),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => { for (let i = 0; i < 4; i++) pop(s2, M.R, COIN[0], { k: "moDecal", x: x + s2.rand(-0.35, 0.35), y: y + s2.rand(-0.25, 0.25), z: 0, life: 2.4, o: 1, from: 0.6 }); glints(s2, M, x, y, 0.05, 2, 0.3, 0.3); }),
  },
  card: {
    carrier: (s, M, p) => ride(p, { frames: CARD, loop: true, fps: 14, face: "lr" }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const z = z0(o) + 0.15, n = 5;
      for (let i = 0; i < n; i++) { const q = -Math.PI / 2 + (i - 2) * 0.45; s2.add({ k: "moSprite", R: M.R, frames: CARD, loop: true, fps: 14, x: o.x, y: o.y, z, vx: Math.cos(q) * 2, vy: 0, vz: -Math.sin(q) * 1.6, drag: 3, life: 0.7, hero: 1, minor: i % 2 === 1 }); }
      flare(s2, M, o.x, o.y, z, o.pow, 0.3);
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => {
      for (let i = 0; i < 3; i++) hover(s2, M.R, CARD[0], { x: x + (i - 1) * 0.2, y, z: 1.35 * h + (i === 1 ? 0.06 : 0), ang: (i - 1) * 0.4, life, bob: 0 });
    }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => { for (let i = 0; i < 3; i++) pop(s2, M.R, CARD[i % 2 ? 3 : 0], { k: "moDecal", x: x + s2.rand(-0.35, 0.35), y: y + s2.rand(-0.25, 0.25), z: 0, ang: s2.rand(-0.8, 0.8), life: 2.2, o: 1, from: 0.6 }); }),
  },

  /* beasts */
  serpent: {
    carrier: (s, M, p) => ride(p, { trail: "serpent", bm: SNAKE_HEAD, face: true, keepUp: true, len: 22 }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const [ux, uy] = fromCaster(s2, o.x, o.y), z = z0(o), a = [o.x - ux * 1.1 + uy * 0.3, o.y - uy * 1.1, 0.1];
      s2.add({ k: "moSnake", a, x: a[0], y: a[1], z: 0.2, life: 0.75, R: M.R, from: 0.6, update(p, s3) { const k = easeOut(clamp(p.age / 0.15)); p.x = lerp(a[0], o.x - ux * 0.1, k); p.y = lerp(a[1], o.y - uy * 0.1, k); p.z = lerp(0.2, z, k); if (k >= 1 && !p.done) { p.done = true; flare(s3, M, o.x, o.y, z, o.pow, 0.3); } } });
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => {
      s2.add({ k: "moHelix", x, y, h: h * 0.9, r: 0.38, q0: 0, growT: 0.4, life, R: M.R, thick: true, turns: 2, update: still });
      pop(s2, M.R, SNAKE_HEAD, { x: x + 0.2, y, z: 0.95 * h, life, from: 0.85, wait: 0.35, bob: 1 });
    }),
  },
  dragon: {
    carrier: (s, M, p) => ride(p, { trail: "serpent", len: 28, bm: DRAGON[0], face: true, keepUp: true, shed(q, s2, dt) { if (s2.count(14, dt)) s2.add({ k: "ember", x: q.x, y: q.y, z: q.z, vx: s2.rand(-0.4, 0.4), vz: 0.4, drag: 2, life: 0.4, R: M.R, seed: s2.R(), minor: true }); } }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const [ux] = fromCaster(s2, o.x, o.y), side = ux >= 0 ? -1 : 1, z = z0(o) + 0.45;
      pop(s2, M.R, null, { frames: [DRAGON[0], DRAGON[0], DRAGON[1], DRAGON[1], DRAGON[1], DRAGON[0]], fps: 10, x: o.x + side * 0.35, y: o.y - 0.05, z, flip: side > 0, life: 0.75, hero: 1, from: 0.65 });
      s2.add({ k: "moRings", x: o.x, y: o.y, z, n: 3, sz: 11, life: 0.5, R: M.R, wait: 0.15, update: still });
      s2.at(s2.t + 0.2, (s3) => { flare(s3, M, o.x, o.y, z0(o), o.pow * 1.1, 0.4); s3.shake = Math.max(s3.shake, 1.4); });
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => {
      const p = s2.add({ k: "orb", x, y, z: 1.1 * h, r: 1, life, R: M.R, from: 0.85, update(q) { const a = q.age * 3; q.x = x + Math.cos(a) * 0.5; q.y = y + Math.sin(a) * 0.25; q.z = 1.1 * h + Math.sin(a * 2) * 0.12; } });
      ride(p, { trail: "serpent", len: 26, bm: DRAGON[0], face: true, keepUp: true });
    }),
  },
  beast: {
    carrier: (s, M, p) => ride(p, { frames: [WOLF[0], WOLF[0], WOLF[1], WOLF[1]], loop: true, fps: 8, face: "lr" }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const [ux, uy] = fromCaster(s2, o.x, o.y), z = z0(o) + 0.2;
      s2.add({ k: "moSprite", R: M.R, frames: [WOLF[0], WOLF[1], WOLF[1], WOLF[0]], fps: 10, x: o.x - ux * 0.7, y: o.y - uy * 0.7, z: z + 0.2, flip: ux < 0, life: 0.5, hero: 1, from: 0.6, update(p) { const k = easeOut(clamp(p.age / 0.15)); p.x = o.x - ux * lerp(0.7, 0.15, k); p.y = o.y - uy * lerp(0.7, 0.15, k); p.z = z + 0.2 * (1 - k); } });
      s2.at(s2.t + 0.15, (s3) => { s3.add({ k: "moClaw", x: o.x, y: o.y, z: z0(o), sz: 12, flip: ux >= 0 ? 1 : -1, life: 0.45, R: M.R, update: still }); flare(s3, M, o.x, o.y, z0(o), o.pow, 0.3); });
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => {
      hover(s2, M.R, null, { frames: [WOLF[0], WOLF[0], WOLF[0], WOLF[1], WOLF[1], WOLF[1], WOLF[1]], fps: 6, x: x + 0.45, y: y - 0.04, z: 0.75 * h, life });
      s2.add({ k: "moRings", x: x + 0.55, y, z: 0.85 * h, n: 3, sz: 8, life: 0.7, R: M.R, wait: 0.5, update: still });
    }),
  },
  swarm: {
    carrier: (s, M, p) => ride(p, { head: "moSwarm", sz: 5, n: 12, seed: s.seedInt() % 97 }),
    impact: (s, M, o) => later(s, o.at, (s2) => s2.add({ k: "moSwarm", x: o.x, y: o.y, z: z0(o), sz: o.pow > 1.2 ? 15 : 12, n: o.pow > 1.2 ? 30 : 22, life: 1.2, seed: s2.seedInt() % 97, from: 0.7, R: M.R, update: still })),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => s2.add({ k: "moSwarm", x, y, z: 0.7 * h, sz: 13, n: 24, life, seed: s2.seedInt() % 97, from: 0.8, R: M.R, update(p) { p.x = x + Math.sin(p.age * 2.3) * 0.08; } })),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => s2.add({ k: "moSwarm", x, y, z: 0.1, sz: 6, n: 6, life: 1.8, seed: s2.seedInt() % 97, R: M.R, update: still })),
  },
  web: {
    carrier: (s, M, p) => ride(p, { trail: "thread", bm: WEB_BALL }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      s2.add({ k: "moWeb", x: o.x, y: o.y, z: z0(o), r: o.pow > 1.2 ? 0.6 : 0.48, life: 1.4, R: M.R, from: 0.7, update: still });
      s2.add({ k: "moWebFlat", x: o.x, y: o.y + 0.02, z: 0, r: 0.6 + (o.rad ?? 0) * 0.5, life: 1.8, R: M.R, from: 0.7, update: still });
      flare(s2, M, o.x, o.y, z0(o), o.pow * 0.6, 0.3);
    }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => s2.add({ k: "moWebFlat", x, y, z: 0, r: 0.5, life: 2.4, R: M.R, from: 0.6, update: still })),
  },

  /* energy */
  flame: {
    carrier: (s, M, p) => ride(p, { frames: FLAME, loop: true, fps: 10, shed(q, s2, dt) { if (s2.count(24, dt)) s2.add({ k: "ember", x: q.x, y: q.y, z: q.z, vx: s2.rand(-0.4, 0.4), vz: s2.rand(0.2, 0.8), drag: 2, life: 0.45, R: M.R, seed: s2.R(), minor: true }); } }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const n = many(o.pow, o.rad ?? 0, 5);
      spread(s2, o.x, o.y, Math.max(0.35, o.rad ?? 0), n).forEach(([px, py], i) => s2.add({ k: "tongue", x: px, y: py, z: 0, h: s2.rand(10, 15) * (i ? 0.8 : 1.1), w: s2.rand(2.5, 3.5), life: s2.rand(0.55, 0.8), seed: s2.R() * 9, R: M.R, wait: i * 0.03, minor: i > 3, update: still }));
      flare(s2, M, o.x, o.y, z0(o), o.pow, 0.4);
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => { hover(s2, M.R, null, { frames: FLAME, loop: true, fps: 10, x: x + 0.38, y, z: 0.85 * h, life, bob: 0 }); s2.light(x + 0.38, y, 0.85 * h, 1.2, S(M.R, 0.85), 0.7, life, { flicker: true }); s2.emit(s2.t, s2.t + life * 0.8, (s3, _u, dt) => { if (s3.count(8, dt)) s3.add({ k: "ember", x: x + 0.38 + s3.rand(-0.06, 0.06), y, z: 0.95 * h, vz: s3.rand(0.4, 0.9), drag: 1, life: 0.6, R: M.R, seed: s3.R(), minor: true }); }); }),
    residue: (s, M, { x, y, at }) => later(s, at, (s2) => { for (let i = 0; i < 3; i++) s2.add({ k: "tongue", x: x + s2.rand(-0.3, 0.3), y: y + s2.rand(-0.2, 0.2), z: 0, h: 6, w: 2, life: s2.rand(0.8, 1.4), wait: i * 0.25, seed: s2.R() * 9, R: M.R, update: still }); s2.add({ k: "scorch", x, y, r: 0.3, life: 2.2, seed: s2.seedInt(), update: still }); }),
  },
  orb: {
    carrier: (s, M, p) => ride(p, { headOrb: true, big: true, r: Math.max(p.r ?? 3, 4.5), head: "moOrbit" }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const z = z0(o), sz = (o.pow > 1.2 ? 0.75 : 0.6) * s2.spec.aps;
      s2.add({ k: "moBubble", x: o.x, y: o.y, z, sz, life: 0.25, R: M.R, update(p) { p.sz = sz * (1 - easeOut(clamp(p.age / 0.25)) * 0.8); } });
      s2.at(s2.t + 0.22, (s3) => flare(s3, M, o.x, o.y, z, o.pow * 1.1, 0.4));
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => s2.add({ k: "moRide", headOrb: true, head: "moOrbit", big: true, x, y, z: 1.5 * h, r: 4, life, from: 0.85, R: M.R, glow: true, update(p) { p.z = 1.5 * h + Math.sin(p.age * 3) * 0.05; } })),
  },
  ray: {
    carrier: (s, M, p) => ride(p, { trail: "ray", headOrb: true }),
    impact: (s, M, o) => later(s, o.at, (s2) => { s2.add({ k: "beam", x: o.x, y: o.y, h: 3, w: o.pow > 1.2 ? 5 : 3.5, life: 0.45, R: M.R, update: still }); s2.add({ k: "ring", x: o.x, y: o.y, r: 0.45, life: 0.4, R: M.R, seed: 7, update: still }); flare(s2, M, o.x, o.y, z0(o), o.pow, 0.4); }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => { s2.add({ k: "beam", x, y, h: 3 * h, w: 3, life: Math.min(life, 1.4), R: M.R, update: still }); s2.light(x, y, 0.6, 1.4, S(M.R, 0.85), 0.7, Math.min(life, 1.4)); }),
  },
  shield: {
    carrier: (s, M, p) => ride(p, { bm: SHIELD, spin: TAU / 8 }),
    impact: (s, M, o) => later(s, o.at, (s2) => {
      const [ux, uy] = fromCaster(s2, o.x, o.y), z = z0(o);
      s2.add({ k: "moSprite", R: M.R, bm: SHIELD, x: o.x - ux * 0.6, y: o.y - uy * 0.6, z, life: 0.5, hero: 1, from: 0.55, update(p, s3) { const k = clamp(p.age / 0.1), d = lerp(0.6, 0.22, k) + clamp((p.age - 0.2) / 0.2) * 0.2; p.x = o.x - ux * d; p.y = o.y - uy * d; if (k >= 1 && !p.done) { p.done = true; s3.add({ k: "star", x: o.x - ux * 0.15, y: o.y, z, L: 6, life: 3 / 12, R: M.R, update: still }); flare(s3, M, o.x, o.y, z, o.pow, 0.3); s3.shake = Math.max(s3.shake, 1); } } });
    }),
    conjure: (s, M, { x, y, h, at, life }) => later(s, at, (s2) => {
      const [ux, uy] = fromCaster(s2, x, y), front = s2.spec.caster && (Math.abs(s2.spec.caster.x - x) > 0.1 || Math.abs(s2.spec.caster.y - y) > 0.1) ? -1 : 1;
      hover(s2, M.R, SHIELD, { x: x + ux * 0.38 * front, y: y + uy * 0.38 * front + 0.02, z: 0.6 * h, life, bob: 0 });
      glints(s2, M, x + ux * 0.38 * front, y, 0.8 * h, 2, 0.15, 0.2);
      s2.light(x, y, 0.6 * h, 1.1, S(M.R, 0.85), 0.5, life * 0.8);
    }),
  },
  wall: {
    impact: (s, M, o) => later(s, o.at, (s2) => {
      s2.add({ k: "moWall", x: o.x, y: o.y + 0.1, w: 18 + (o.rad ?? 0) * 14, sz: 14, growT: 0.1, life: 0.9, from: 0.7, R: M.R, update: still });
      s2.shake = Math.max(s2.shake, 1.2);
      for (let i = 0; i < 5; i++) { const q = -Math.PI / 2 + s2.rand(-1, 1); s2.add({ k: "chunk", x: o.x + s2.rand(-0.3, 0.3), y: o.y + 0.1, z: 0.3, vx: Math.cos(q) * 2, vy: 0.4, vz: s2.rand(1.5, 2.5), g: 9, bounce: 0.3, life: 1, R: M.R, s: 2, debris: true, minor: i > 2 }); }
    }),
    conjure: (s, M, { x, y, at, life }) => later(s, at, (s2) => s2.add({ k: "moWall", x: x + 0.05, y: y + 0.45, w: 22, sz: 13, growT: 0.3, life, from: 0.85, R: M.R, update: still })),
    residue: (s, M, o) => MOTIFS.stone.residue(s, M, o),
  },
};

/** The bitmaps and helpers flavors.mjs draws its props with. */
export const ART = Object.freeze({ SWORD, FIST, HAND, EYE, GHOST, BONE_UP, SKULL, SKULL_LIT, RUNES, LETTERS, NOTE, NOTES2, SHIELD, LEAF, STAR, FLAME });
export { env, glints, puffs, orbit, fromCaster };

/* ── shapes the motif table needs that read better as code than bitmaps ── */

registerShapes({
  /** A pair of wings beating on either side of a carrier's head. */
  moWings(v, P, p) {
    const fr = Math.floor(p.age * 12), [x, y] = v.ap(p.x, p.y, p.z), bm = p.wingFr[(fr >> 1) % 2], a = env(p);
    blit(P, bm, x + 6, y - 2, p.R, { a });
    blit(P, bm, x - 6, y - 2, p.R, { a, flip: true });
  },
  /** Sparks circling an orb. */
  moOrbit(v, P, p) {
    const fr = Math.floor(p.age * 12), [x, y] = v.ap(p.x, p.y, p.z), r = (p.r ?? 4) + 3, a = env(p);
    for (let i = 0; i < 3; i++) { const q = fr * 0.6 + (i * TAU) / 3; P.dot(x + Math.cos(q) * r, y + Math.sin(q) * r * 0.5, i ? S(p.R, 0.95) : WHITE, a, 2); }
  },
  /**
   * A vine or a coil winding up round a body from the ground: a helix revealed
   * from the feet up over `growT`, its far side hidden by the body in a side
   * view; leaves on the vine, scales on a coil (`thick`).
   */
  moHelix(v, P, p) {
    const top = v.kind === "top", g = clamp(p.age / (p.growT ?? 0.5)), a = env(p), fr = Math.floor(p.age * 12), turns = p.turns ?? 1.5;
    const n = 60, R0 = p.r * v.aps * (top ? 1.2 : 1);
    let last = null;
    for (let i = 0; i <= n * g; i++) {
      const f = i / n, q = p.q0 + f * turns * TAU + Math.sin(fr * 0.3) * 0.05, rr = R0 * (1 - f * 0.25);
      const [bx, by] = v.ap(p.x, p.y, f * p.h), x = bx + Math.cos(q) * rr, y = by + Math.sin(q) * rr * (top ? 1 : 0.32);
      if (!top && Math.sin(q) < -0.1) { last = null; continue; }
      P.dot(x, y, S(p.R, p.thick ? ((i >> 1) % 2 ? 0.78 : 0.6) : 0.62), a, 2);
      P.dot(x, y + 1, S(p.R, 0.4), a, 2);
      if (p.thick) P.dot(x + 1, y, S(p.R, 0.5), a, 2);
      if (!p.thick && i % 9 === 4) { P.dot(x + 1, y - 1, S(p.R, 0.95), a, 2); P.dot(x + 2, y - 1, S(p.R, 0.78), a, 2); }
      last = [x, y];
    }
    if (last && !p.thick && g < 1) P.dot(last[0], last[1] - 1, S(p.R, 1), a, 2);
  },
});
