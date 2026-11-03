/**
 * Spellsprite — condition overlays, keyed by PF2e condition slug.
 *
 * A condition loop is the family aura of its material (persistent fire burns,
 * persistent bleed drips) plus, where the condition has a look of its own, an
 * overlay:
 *
 *   start?(s, M, T)              once, when the loop begins
 *   loop?(s, M, {at, body, T, dt})   every frame
 *   family?: false               skip the family aura (stunned is not "fire")
 *   tickRing?: true              keep the 1.4 s tick ring even without the family
 *   gentle?: true                no flinch on the tick
 *   material?                    the material the condition draws in when the
 *                                message names none (semantics.mjs reads it)
 *   none?: true                  DELIBERATELY nothing: no loop, no aura, no tick.
 *                                Attitudes, detection states and bookkeeping
 *                                values (clumsy 2, wounded 1) have no picture, and
 *                                a coverage tool must be able to tell "drawn as
 *                                nothing on purpose" from "missing". Every `none`
 *                                entry also sets `family: false`, so compile.mjs
 *                                draws no family aura for it either.
 *
 * Every overlay draws in its OWN ramp (a frightened creature sweats the same
 * blue whatever the message's material), sits on the creature without covering
 * its face, and loops: anything that lives for the whole loop is spawned once
 * in `start` (life 1e9, moved by its `update`), anything spawned by `loop` has
 * a finite life, so a loop's particle count is flat however long it runs.
 *
 * Valued conditions (frightened 2, drained 3) scale with `condition.value`,
 * clamped to 1..4.
 *
 * The slug list is PF2e's own conditions pack (43 entries, PF2e 8.x), plus
 * `malevolence`, which that pack does not ship but which modules apply.
 */

import { TAU, clamp, hash, fadeOut } from "./core/rand.mjs";
import { RAMP, S, INK } from "./core/palette.mjs";
import { lobes, still, splat, TRADITION_GLYPHS } from "./core/motifs.mjs";
import { registerShapes, snapH } from "./core/shapes.mjs";

/* ── pixel icons ─────────────────────────────────────────────────────── */

/**
 * Bitmaps, top row first. "1" light, "2" mid, "3" dark, "k" ink, "." empty.
 * Drawn always-outlined (flag 2), so a glyph reads over any token art.
 */
export const ICONS = Object.freeze({
  question: [".11.", "1..1", "...1", "..1.", "....", "..1."],
  heart: ["11.11", "12111", ".111.", "..2.."],
  heartBig: [".11.11.", "1121111", "1111111", ".11111.", "..111..", "...2..."],
  z: ["1111", "..2.", ".2..", "1111"],
  Z: ["11111", "...2.", "..2..", ".2...", "11111"],
  star: ["..1..", "..1..", "11111", ".121.", ".1.1."],
  skull: [".111.", "11111", "1k1k1", "11211", ".1.1."],
  drop: [".1.", "121", "122", ".2."],
  bang: ["1", "1", "2", ".", "1"],
  weight: [".222.", ".2.2.", "11111", "12221", ".111."],
  plus: [".1.", "121", ".1."],
  stake: ["1", "2", "3"],
  crack: ["..1..", ".1...", ".11..", "...1.", "..1..", ".1..."],
  shard: [".1.", "121", "121", ".3."],
  spike: [".1.", "121", "121", "122", ".2."],
  down: ["1...1", ".1.1.", "..1..", "1...1", ".2.2.", "..2.."],
});

const TONE = { 1: 0.95, 2: 0.72, 3: 0.45 };

/** A soft envelope: in over 0.1 s, out over the last part of a finite life. */
const env = (p, inT = 0.1, from = 0.65) => (p.life >= 1e8 ? 1 : Math.min(1, p.age / inT) * fadeOut(p.age / p.life, from));

export function drawIcon(P, bm, x, y, R, a = 1, dim = 0) {
  const h = bm.length, w = bm[0].length, x0 = Math.round(x - w / 2), y0 = Math.round(y - h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const ch = bm[j][i];
    if (ch === ".") continue;
    const c = ch === "k" ? INK : S(R, TONE[ch] - dim);
    P.dot(x0 + i, y0 + j, c, a, 2);
  }
}

/* ── shapes only the overlays draw ───────────────────────────────────── */

const BAND_STYLE = {
  // [top row, bottom row] per position in the period; numbers are ramp steps
  rope: { period: 4, top: [0.9, 0.7, 0.45, 0.7], bot: [0.45, 0.7, 0.9, 0.7] },
  chain: { period: 6, top: [0.95, 0.95, 0.95, null, 0.72, null], bot: [0.72, null, 0.72, null, 0.6, null] },
  rune: { period: 5, top: [0.95, null, 0.72, null, null], bot: [null, 0.95, null, null, null] },
};

registerShapes({
  icon(v, P, p, s) {
    let [x, y] = v.ap(p.x, p.y, p.z);
    if (p.snap !== false) [x, y] = snapH(p, v, x, y);
    const a = (p.alpha ?? 1) * env(p, p.inT ?? 0.1, p.from ?? 0.65);
    const bm = typeof p.bm === "function" ? p.bm(p, s) : p.bm;
    if (bm) drawIcon(P, bm, x, y, p.R, a, p.dim ?? 0);
  },

  /** A band round a body: rope, chain or a rune strip. The far half is behind the creature, so a side view skips it. */
  cnBand(v, P, p) {
    if (v.kind === "top" && p.topSkip) return;
    // top-down, a band round the waist is a ring round the token's edge, not across its face
    const [cx, cy] = v.ap(p.x, p.y, p.z), rx = p.r * v.aps * (v.kind === "top" && p.z > 0.1 ? 1.45 : 1), ry = v.kind === "top" ? rx : Math.max(1.5, rx * 0.32);
    const st = BAND_STYLE[p.style] ?? BAND_STYLE.rope, a = env(p, 0.08, 0.7), shift = p.crawl ? Math.floor((p.age ?? 0) * 12) : 0;
    const n = Math.max(12, Math.ceil(TAU * Math.max(rx, ry) * 1.3));
    let lx = null, ly = null, k = 0;
    for (let i = 0; i < n; i++) {
      const q = (i / n) * TAU, x = Math.floor(cx + Math.cos(q) * rx), y = Math.floor(cy + Math.sin(q) * ry + (p.sag ?? 0) * Math.sin(q) ** 2);
      if (x === lx && y === ly) continue;
      lx = x; ly = y; k++;
      if (v.kind !== "top" && Math.sin(q) < -0.05) continue;
      const j = (k + shift) % st.period, t0 = st.top[j], t1 = st.bot[j];
      if (t0 != null) P.dot(x, y, S(p.R, t0), a, 2);
      if (t1 != null) P.dot(x, y + 1, S(p.R, t1), a, 2);
    }
  },

  /** Slowed: a clock face on the floor whose hand ticks round. */
  cnClock(v, P, p, s) {
    const [cx, cy] = v.ap(p.x, p.y, 0), rx = p.r * v.aps, ry = rx * v.sq, a = env(p, 0.15);
    P.ellipse(cx, cy, rx, ry, () => ({ c: S(p.R, 0.62), a: a * 0.75 }));
    P.ellipse(cx, cy, rx - 1, Math.max(0.5, ry - 1), () => ({ c: S(p.R, 0.4), a: a * 0.5 }));
    for (let i = 0; i < 12; i++) {
      const q = (i * TAU) / 12, L = i % 3 === 0 ? 0.78 : 0.88;
      P.line(cx + Math.cos(q) * rx * L, cy + Math.sin(q) * ry * L, cx + Math.cos(q) * rx * 0.96, cy + Math.sin(q) * ry * 0.96, S(p.R, i % 3 === 0 ? 0.95 : 0.72), 1, a);
    }
    // the hand rides the rim (the creature stands on the dial's centre): a pointer
    // that steps one hour per beat and leaves a fading wedge of the hours it lost
    const step = Math.floor(s.t / p.beat), fresh = s.t - step * p.beat < 1 / 12;
    for (let k = 0; k < 3; k++) {
      const q = ((step - k) * TAU) / 12 - Math.PI / 2;
      const x0 = cx + Math.cos(q) * rx * 0.72, y0 = cy + Math.sin(q) * ry * 0.72, x1 = cx + Math.cos(q) * rx * 1.18, y1 = cy + Math.sin(q) * ry * 1.18;
      if (k === 0) { P.line(x0, y0, x1, y1, S(p.R, fresh ? 1 : 0.95), 1, a); P.line(x0 + 1, y0, x1 + 1, y1, S(p.R, 0.72), 1, a); }
      else P.line(x0, y0, x1, y1, S(p.R, 0.6 - k * 0.1), 0, a * (k === 1 ? 0.75 : 0.5));
    }
  },

  /** A spiral that turns: sickened's queasy swirl, fascinated's hypnotic one. */
  cnSpiral(v, P, p, s) {
    const [cx, cy] = v.ap(p.x, p.y, p.z), fr = Math.floor(s.t * 12), rot = fr * 0.35 * (p.spin ?? 1), a = env(p);
    const turns = p.turns ?? 1.6, R = p.r, flat = p.flat ?? 0.8;
    let lx = null, ly = null;
    for (let i = 0; i <= 90; i++) {
      const f = i / 90, q = rot + f * turns * TAU, r = 0.6 + f * R;
      const x = Math.round(cx + Math.cos(q) * r), y = Math.round(cy + Math.sin(q) * r * flat);
      if (x === lx && y === ly) continue;
      lx = x; ly = y;
      P.dot(x, y, S(p.R, f > 0.66 ? 0.95 : f > 0.33 ? 0.78 : 0.6), a, 2);
    }
  },

  /** Frightened: trembling marks at both sides of the head, more of them the more afraid. */
  cnShiver(v, P, p, s) {
    const fr = Math.floor(s.t * 12), [hx, hy] = v.ap(p.x, p.y, p.z), w = Math.round(p.w * v.aps), a = env(p, 0.15);
    const jit = fr % 2;
    for (let side = -1; side <= 1; side += 2) for (let k = 0; k < p.n; k++) {
      const x = hx + side * (w + 2 + k * 2 + (k === 0 ? jit : 0)), y0 = hy + k;
      for (let j = 0; j < 4 + (k ? 0 : 1); j++) P.dot(x + ((j + fr + k) % 2) * side, y0 + j, S(p.R, j === 0 ? 1 : 0.8), a, 2);
    }
  },

  /** Blinded: a dark band across the eyes, its knot's tails fluttering. */
  cnBlind(v, P, p, s) {
    const fr = Math.floor(s.t * 12), [x, y] = v.ap(p.x, p.y, p.z), hw = Math.max(3, Math.round(p.w * v.aps)), a = env(p, 0.1);
    for (let i = -hw; i <= hw; i++) { P.dot(x + i, y, S(p.R, 0.62), a, 2); P.dot(x + i, y + 1, S(p.R, 0.3), a, 2); }
    const f = fr % 4;
    P.dot(x + hw + 1, y + 1, S(p.R, 0.45), a, 2); P.dot(x + hw + 2, y + 1 + (f > 1 ? 1 : 0), S(p.R, 0.3), a, 2);
    P.dot(x + hw + 1, y + 2, S(p.R, 0.3), a, 2); P.dot(x + hw + 2 + (f % 2), y + 3, S(p.R, 0.3), a, 2);
  },

  /** Dazzled: a glare star at eye height that swells and shrinks. */
  cnGlare(v, P, p, s) {
    const fr = Math.floor(s.t * 12), [x, y] = v.ap(p.x, p.y, p.z), L = [2, 3, 4, 3, 2, 2][fr % 6] + (p.big ?? 0), a = env(p, 0.1);
    for (let i = 1; i <= L; i++) {
      const c = i === L ? S(p.R, 0.72) : S(p.R, 0.95);
      P.dot(x + i, y, c, a, 2); P.dot(x - i, y, c, a, 2); P.dot(x, y + i, c, a, 2); P.dot(x, y - i, c, a, 2);
    }
    if (L >= 3) { const c = S(p.R, 0.72); P.dot(x + 1, y + 1, c, a, 2); P.dot(x - 1, y - 1, c, a, 2); P.dot(x + 1, y - 1, c, a, 2); P.dot(x - 1, y + 1, c, a, 2); }
    P.dot(x, y, S(p.R, 1), a, 2);
  },

  /** Deafened: sound arcs at the ears that close inward and never arrive. */
  cnMuffle(v, P, p, s) {
    const [x, y] = v.ap(p.x, p.y, p.z), w = p.w * v.aps, ph = (s.t * 2.2) % 1, a = env(p, 0.15);
    // arcs arrive from outside and fade before they reach the ear: sound that never lands
    for (let k = 0; k < 2; k++) {
      const u = (k / 2 + ph) % 1, r = 8 - u * 5, hh = r > 5 ? 3 : 2;
      if (u > 0.85) continue;
      for (let side = -1; side <= 1; side += 2) for (let j = -hh; j <= hh; j++) {
        const xx = Math.round(x + side * (w + r - (j * j) / (r * 0.9)));
        P.dot(xx, y + j, S(p.R, u > 0.55 ? 0.55 : 0.85), a, u > 0.55 ? 0 : 2);
      }
    }
    // the stopped ear: a short bar on each side
    for (let side = -1; side <= 1; side += 2) { const ex = Math.round(x + side * (w + 1)); for (let j = -1; j <= 1; j++) P.dot(ex, y + j, S(p.R, 0.95), a, 2); }
  },

  /** Petrified: stone crust creeping up the body (side) or round its edge (top). */
  cnStone(v, P, p, s) {
    const grow = Math.min(1, s.t / 2.2), a = env(p, 0.05);
    // cobbles 5×3, staggered: a dark seam, a lit top edge, a flat face
    const cob = (x, y) => {
      const row = Math.floor(y / 3), sx = x + (row % 2) * 3, cx = Math.floor(sx / 5), lx = sx - cx * 5, ly = y - row * 3;
      if (lx === 0 || ly === 0) return 0.3;
      const t = 0.5 + hash(cx, row, p.seed) * 0.12;
      return ly === 1 ? t + 0.14 : t;
    };
    if (v.kind === "top") {
      const [cx, cy] = v.ap(p.x, p.y, 0), r0 = 0.32 * p.size * v.aps, r1 = 0.5 * p.size * v.aps, reach = Math.PI * (0.25 + 0.75 * grow);
      P.shade(cx - r1 - 1, cy - r1 - 1, cx + r1 + 1, cy + r1 + 1, (x, y, ix, iy) => {
        const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
        const q = Math.atan2(dx, dy); // 0 at the south, ±π at the north
        if (d < r0 + hash(Math.floor(q * 9), 3, p.seed) * 1.5 || d > r1 || Math.abs(q) > reach) return null;
        const c = S(p.R, cob(ix, iy));
        return a < 1 ? { c, a } : c;
      }, 1);
      return;
    }
    const [bx, by] = v.ap(p.x, p.y, 0), H = Math.max(2, grow * p.hgt * v.aps), W = 0.24 * p.size * v.aps;
    P.shade(bx - W - 2, by - H - 2, bx + W + 2, by + 1, (x, y, ix, iy) => {
      const up = by - y, f = up / H, hw = W * (1 - f * 0.25) + (hash(Math.floor(up / 2), 1, p.seed) - 0.5) * 2;
      const top = H - hash(Math.floor((x - bx) / 2), 2, p.seed) * 3;
      if (up < -1 || up > top || Math.abs(x - bx) > hw) return null;
      const c = S(p.R, cob(ix, iy) - (Math.abs(x - bx) > hw - 1 ? 0.1 : 0));
      return a < 1 ? { c, a } : c;
    }, 1);
  },

  /** Invisible: the shimmer of a body you cannot see, an outline that wavers. */
  cnOutline(v, P, p, s) {
    const fr = Math.floor(s.t * 12), a = env(p, 0.2);
    if (v.kind === "top") {
      const [cx, cy] = v.ap(p.x, p.y, 0), r = 0.46 * p.size * v.aps;
      P.ellipse(cx, cy, r, r, (q) => (Math.floor((q / TAU) * r * 6 / 3 + fr) % 3 === 2 ? null : { c: S(p.R, Math.floor(q * 3 + fr) % 2 ? 0.95 : 0.7), a: a * 0.75 }));
      return;
    }
    const [bx, by] = v.ap(p.x, p.y, 0), rx = 0.24 * p.size * v.aps, hh = p.h * v.aps * 0.98, cy = by - hh * 0.5, ry = hh * 0.5;
    const n = Math.ceil(TAU * ry * 1.4);
    for (let i = 0; i < n; i++) {
      if ((i + fr * 2) % 7 > 4) continue;
      const q = (i / n) * TAU, y = cy + Math.sin(q) * ry, wob = Math.round(Math.sin(y * 0.6 + fr * 1.3));
      P.mix(Math.floor(bx + Math.cos(q) * rx * (y < cy - ry * 0.55 ? 0.6 : 1) + wob), Math.floor(y), S(p.R, (i + fr) % 4 ? 0.85 : 1), a * 0.75);
    }
  },

  /** Controlled: puppet strings from a cross-bar above the head. */
  cnStrings(v, P, p, s) {
    const fr = Math.floor(s.t * 12), a = env(p, 0.2), sway = Math.sin(s.t * 1.7) * 0.06;
    const [tx, ty] = v.ap(p.x + sway, p.y - 0.25 * p.size, p.h * 1.75);
    const w = Math.round(0.3 * p.size * v.aps);
    for (let i = -w; i <= w; i++) P.dot(tx + i, ty, S(p.R, 0.85), a, 2);
    for (let j = -2; j <= 2; j++) P.dot(tx, ty + j, S(p.R, j ? 0.85 : 1), a, 2);
    const ends = [[-0.24, 0.62], [0.24, 0.62], [0, 0.95]];
    ends.forEach(([ox, oz], k) => {
      const [ex, ey] = v.ap(p.x + ox * p.size + Math.sin(s.t * 2.3 + k) * 0.02, p.y, oz * p.h), sx = k < 2 ? tx + (k ? w : -w) : tx;
      P.line(sx, ty + 1, ex, ey, null, 0, a, (f, i) => ((i + fr) % 5 === 0 ? S(p.R, 1) : S(p.R, 0.62)));
      P.dot(ex, ey, S(p.R, 1), a, 2);
    });
  },
  /** Concealed: a translucent bank of mist that drifts round the body (true blends, no dither). */
  cnMist(v, P, p, s) {
    const a = env(p, 0.4);
    for (let i = 0; i < p.n; i++) {
      const q = p.ph + i * (TAU / p.n) + s.t * 0.35, bob = Math.sin(s.t * 0.9 + i * 1.7);
      const [x, y] = v.ap(p.x + Math.cos(q) * p.r, p.y + Math.sin(q) * p.r * 0.45, p.h * (0.18 + 0.2 * (i % 3)) + bob * 0.04);
      const far = Math.sin(q) < 0, r = (2.6 + (i % 2)) * (v.kind === "top" ? 1.1 : 1);
      const cx = Math.round(x), cy = Math.round(y);
      P.shade(cx - r * 1.8, cy - r, cx + r * 1.8, cy + r, (px, py) => {
        const dx = (px - cx) / (r * 1.8), dy = (py - cy) / r, d = dx * dx + dy * dy;
        if (d > 1) return null;
        return { c: S(p.R, dy < -0.3 ? 0.9 : 0.72), a: a * (far ? 0.25 : d < 0.4 ? 0.75 : 0.5) };
      }, 0, "mix");
    }
  },

  /** Prone: the long, soft shadow of a body lying down. */
  cnShadow(v, P, p) {
    const [cx, cy] = v.ap(p.x, p.y, 0), rx = p.r * v.aps, ry = Math.max(1.5, rx * v.sq * 0.42), a = env(p, 0.3);
    P.shade(cx - rx, cy - ry, cx + rx, cy + ry, (x, y) => {
      const dx = (x - cx) / rx, dy = (y - cy) / ry, d = dx * dx + dy * dy;
      return d > 1 ? null : { c: S(p.R, 0), a: a * (d < 0.45 ? 0.5 : 0.25) };
    }, 0, "mix");
  },
}, { flat: ["cnClock", "cnShadow"] });

/* ── helpers ─────────────────────────────────────────────────────────── */

const lvl = (s) => clamp(Math.round(Number(s.spec.condition?.value) || 1), 1, 4);
/** Just above the head: where a status glyph sits clear of the face. */
const HEAD = (T) => ({ x: T.x, y: T.y - 0.3 * T.size, z: 1.2 * T.h });
/** Eye height, on the face. */
const EYES = (T) => ({ x: T.x, y: T.y + 0.02, z: 0.86 * T.h });
const keep = (s, p) => s.add({ life: 1e9, ...p });

/** `n` glyphs circling the head, the far ones a step darker. */
function orbit(s, T, n, mk, { rx = 0.36, ry = 0.14, speed = 2.2, bob = 0.05 } = {}) {
  const c = HEAD(T);
  for (let i = 0; i < n; i++) keep(s, {
    ...mk(i), x: c.x, y: c.y, z: c.z, ph: (i * TAU) / n, snap: false,
    update(p, s2) {
      const q = p.ph + s2.t * speed;
      p.x = c.x + Math.cos(q) * rx * T.size; p.y = c.y + Math.sin(q) * ry * T.size; p.z = c.z + Math.sin(s2.t * 3 + i * 2) * bob;
      p.dim = Math.sin(q) < 0 ? 0.2 : 0;
    },
  });
}

/** A Strike of dust at the feet, once: prone's fall, fleeing's scramble. */
function dust(s, T, n, dir = 0) {
  for (let i = 0; i < n; i++) {
    const q = dir ? dir + s.rand(-0.6, 0.6) : s.rand(0, TAU);
    s.add({ k: "smoke", x: T.x + Math.cos(q) * 0.2 * T.size, y: T.y + 0.1 + Math.sin(q) * 0.12, z: 0.05, vx: Math.cos(q) * s.rand(0.4, 1.1), vy: Math.sin(q) * 0.3, vz: s.rand(0.05, 0.25), drag: 3, r: s.rand(2.2, 3.6), life: s.rand(0.6, 1), lobes: lobes(s), R: RAMP.kinetic, tone: 0.6 });
  }
}

/* ── the overlays ────────────────────────────────────────────────────── */

const NONE = Object.freeze({ none: true, family: false });

export const CONDITIONS = Object.freeze({
  "persistent-damage": {},

  blinded: {
    family: false, gentle: true, material: "shadow",
    start(s, M, T) { const e = EYES(T); keep(s, { k: "cnBlind", ...e, w: 0.2 * T.size, R: RAMP.shadow, update: still }); },
    loop(s, M, { at, T }) { at(1.2, () => ({ k: "wisp", x: T.x + s.rand(-0.2, 0.2), y: T.y, z: 0.86 * T.h, vx: s.rand(0.3, 0.6), vz: 0.15, drag: 2, life: 0.8, s: 2, R: RAMP.shadow, minor: true })); },
  },

  broken: {
    family: false, gentle: true, material: "kinetic",
    start(s, M, T) { keep(s, { k: "icon", bm: ICONS.crack, x: T.x + 0.08, y: T.y, z: 0.62 * T.h, R: RAMP.kinetic, update: still }); },
    loop(s, M, { at, T }) { at(0.8, () => ({ k: "chunk", x: T.x + s.rand(-0.15, 0.15), y: T.y, z: 0.5 * T.h, vx: s.rand(-0.4, 0.4), g: 8, bounce: 0.3, s: 1, life: 0.9, R: RAMP.kinetic, debris: true })); },
  },

  clumsy: NONE,

  concealed: {
    family: false, gentle: true, material: "air",
    start(s, M, T) { keep(s, { k: "cnMist", x: T.x, y: T.y, r: 0.4 * T.size, h: T.h, n: 7, ph: 0.3, R: RAMP.air, update: still }); },
  },

  confused: {
    family: false, gentle: true, material: "mental",
    start(s, M, T) { orbit(s, T, 3, (i) => ({ k: "icon", bm: ICONS.question, R: i === 1 ? RAMP.illusion : RAMP.mental }), { speed: 1.9 }); },
  },

  controlled: {
    family: false, gentle: true, material: "mental",
    start(s, M, T) { keep(s, { k: "cnStrings", x: T.x, y: T.y, z: 0, size: T.size, h: T.h, R: RAMP.mental, update: still }); },
    loop(s, M, { at, T }) { at(2, () => ({ k: "mote", x: T.x + s.rand(-0.15, 0.15), y: T.y - 0.25, z: 1.7 * T.h, vz: -0.5, drag: 1, life: 1, R: RAMP.mental, minor: true })); },
  },

  cursebound: {
    family: false, gentle: true, material: "void",
    start(s, M, T) {
      const G = TRADITION_GLYPHS.occult, n = lvl(s) + 1;
      orbit(s, T, n, (i) => ({ k: "icon", bm: [G[i % G.length].slice(0, 3), G[i % G.length].slice(3, 6), G[i % G.length].slice(6, 9)], R: RAMP.void }), { rx: 0.42, ry: 0.18, speed: -1.1 });
    },
    loop(s, M, { at }) { at(3, () => ({ k: "wisp", vz: s.rand(0.2, 0.5), g: -0.2, drag: 1.5, life: s.rand(0.6, 1), s: 2, R: RAMP.void, minor: true })); },
  },

  dazzled: {
    family: false, gentle: true, material: "light",
    start(s, M, T) {
      const e = EYES(T);
      keep(s, { k: "cnGlare", x: e.x + 0.1 * T.size, y: e.y, z: e.z, R: RAMP.light, update: still });
      s.light(e.x, e.y, e.z, 0.7 * T.size, S(RAMP.light, 0.9), 0.35, 1e9);
    },
    loop(s, M, { at, T }) { at(1.5, () => ({ k: "glint", x: T.x + s.rand(-0.3, 0.3), y: T.y, z: s.rand(0.6, 1) * T.h, life: 5 / 12, R: RAMP.light, minor: true, update: still })); },
  },

  deafened: {
    family: false, gentle: true, material: "sonic",
    start(s, M, T) { keep(s, { k: "cnMuffle", x: T.x, y: T.y + 0.02, z: 0.86 * T.h, w: 0.13 * T.size, R: RAMP.air, update: still }); },
  },

  doomed: {
    family: false, gentle: true, material: "void",
    start(s, M, T) {
      const c = HEAD(T), n = lvl(s);
      keep(s, { k: "icon", bm: ICONS.skull, ...c, z: c.z + 0.05, R: n >= 3 ? RAMP.unholy : RAMP.void, update(p, s2) { p.z = c.z + 0.05 + Math.sin(s2.t * 1.6) * 0.04; p.dim = Math.floor(s2.t * 12) % 24 < 2 ? 0 : 0.12; } });
    },
    loop(s, M, { at, T }) {
      const c = HEAD(T);
      at(1 + lvl(s), () => ({ k: "mote", x: c.x + s.rand(-0.08, 0.08), y: c.y, z: c.z - 0.05, vz: -s.rand(0.3, 0.5), drag: 0.5, life: s.rand(0.9, 1.3), R: lvl(s) >= 3 ? RAMP.unholy : RAMP.void }));
      at(lvl(s) * 0.8, () => ({ k: "wisp", x: T.x + s.rand(-0.35, 0.35) * T.size, y: T.y + 0.1, z: 0.02, vz: s.rand(0.1, 0.3), drag: 1.5, life: s.rand(0.7, 1.1), s: 2, R: RAMP.void, minor: true }), false);
    },
  },

  drained: {
    family: false, gentle: true, material: "void",
    loop(s, M, { at, T }) {
      at(3 + lvl(s) * 3, () => {
        const q = s.rand(0, TAU), d = s.rand(0.1, 0.3) * T.size, side = Math.cos(q) < 0 ? -1 : 1;
        return { k: "mote", x: T.x + Math.cos(q) * d, y: T.y + Math.sin(q) * d * 0.5, z: s.rand(0.2, 0.8) * T.h, life: s.rand(0.9, 1.4), R: RAMP.bleed, plus: s.R() < 0.25, side, update(p, _s, dt) { p.vz = 0.7; p.vx = side * 0.35 * (p.age / p.life); p.x += p.vx * dt; p.z += p.vz * dt; } };
      });
    },
  },

  dying: {
    family: false, gentle: true, material: "kinetic",
    start(s, M, T) {
      const c = HEAD(T), beat = 0.9 + lvl(s) * 0.25;
      keep(s, { k: "icon", ...c, R: RAMP.bleed, beat, bm: (p, s2) => { const u = (s2.t % p.beat) / p.beat; return u < 2 / 12 || (u > 3 / 12 && u < 5 / 12) ? ICONS.heartBig : ICONS.heart; }, update: still });
    },
    loop(s, M, { at, T }) {
      const n = lvl(s), beat = 0.9 + n * 0.25, k = Math.floor(s.t / beat);
      if (k !== s._cnBeat) {
        s._cnBeat = k;
        for (let i = 0; i < 2; i++) s.add({ k: "ring", x: T.x, y: T.y, r: (0.55 - i * 0.08) * T.size, life: 0.55, R: RAMP.bleed, wait: i * 0.22, seed: k * 2 + i, update: still });
        s.light(T.x, T.y, 0.4, 1.1 * T.size, S(RAMP.bleed, 0.8), 0.35 / n + 0.15, 0.5);
      }
      at(0.8 + n * 0.5, () => ({ k: "drip", x: T.x + s.rand(-0.2, 0.2) * T.size, y: T.y + 0.05, z: s.rand(0.3, 0.6) * T.h, g: 5, life: 3, R: RAMP.bleed, onGround: splat }));
    },
  },

  encumbered: NONE,
  enfeebled: NONE,

  fascinated: {
    family: false, gentle: true, material: "mental",
    start(s, M, T) { const c = HEAD(T); keep(s, { k: "cnSpiral", ...c, z: c.z + 0.1, r: 4.5, turns: 2, R: RAMP.mental, update: still }); },
    loop(s, M, { at, T }) {
      at(1.6, () => {
        const x0 = T.x + s.rand(-0.25, 0.25) * T.size, ph = s.rand(0, TAU);
        return { k: "icon", bm: ICONS.heart, x: x0, y: T.y - 0.3 * T.size, z: 1.1 * T.h, life: 1.6, R: RAMP.mental, snap: false, update(p, _s, dt) { p.z += 0.3 * dt; p.x = x0 + Math.sin(ph + p.age * 3) * 0.06; } };
      });
    },
  },

  fatigued: NONE,

  fleeing: {
    family: false, gentle: true, material: "fire",
    start(s, M, T) { const c = HEAD(T); keep(s, { k: "icon", bm: ICONS.bang, ...c, R: RAMP.fire, update(p, s2) { p.z = c.z + (Math.floor(s2.t * 6) % 2) * 0.04; } }); },
    loop(s, M, { at, T }) {
      at(4, () => ({ k: "smoke", x: T.x - 0.25 * T.size, y: T.y + 0.15, z: 0.04, vx: -s.rand(0.5, 1), vz: 0.15, drag: 3, r: s.rand(1.6, 2.6), life: 0.6, lobes: lobes(s), R: RAMP.kinetic, tone: 0.6 }), false);
      at(5, () => ({ k: "streak", x: T.x - 0.35 * T.size, y: T.y, z: s.rand(0.2, 0.9) * T.h, vx: -5, life: 0.12, R: RAMP.kinetic, minor: true, update(p, _s, dt) { p.x += p.vx * dt; } }));
    },
  },

  friendly: NONE,

  frightened: {
    family: false, gentle: true, material: "mental",
    start(s, M, T) { keep(s, { k: "cnShiver", x: T.x, y: T.y + 0.02, z: 0.98 * T.h, w: 0.13 * T.size, n: Math.min(3, lvl(s)), R: RAMP.cold, update: still }); },
    loop(s, M, { at, T }) {
      at(lvl(s) * 1.5, () => ({ k: "wisp", x: T.x + s.rand(-0.3, 0.3) * T.size, y: T.y + s.rand(0, 0.15), z: 0.02, vz: s.rand(0.25, 0.5), drag: 1.5, life: s.rand(0.6, 1), s: 2, R: RAMP.shadow, minor: true }), false);
      at(1 + lvl(s) * 0.9, () => {
        const side = s.R() < 0.5 ? -1 : 1;
        return { k: "icon", bm: ICONS.drop, x: T.x + side * 0.17 * T.size, y: T.y, z: 0.95 * T.h, life: 0.9, R: RAMP.cold, from: 0.6, snap: false, update(p, _s, dt) { p.vz = (p.vz ?? 0.3) - 2.2 * dt; p.z += p.vz * dt; p.x += side * 0.12 * dt; } };
      });
    },
  },

  grabbed: {
    family: false, gentle: true, material: "wood",
    start(s, M, T) { keep(s, { k: "cnBand", style: "rope", x: T.x, y: T.y, z: 0.45 * T.h, r: 0.3 * T.size, R: RAMP.wood, update(p, s2) { p.r = (0.3 + Math.max(0, 0.25 - s2.t) * 1.2) * T.size; } }); },
  },

  helpful: NONE,
  hidden: NONE,
  hostile: NONE,

  immobilized: {
    family: false, gentle: true, material: "metal",
    start(s, M, T) {
      keep(s, { k: "cnBand", style: "chain", x: T.x, y: T.y + 0.02, z: 0.02, r: 0.4 * T.size, R: RAMP.metal, update: still });
      for (const q of [Math.PI / 2, Math.PI / 2 + 2.2, Math.PI / 2 - 2.2]) keep(s, { k: "icon", bm: ICONS.stake, x: T.x + Math.cos(q) * 0.4 * T.size, y: T.y + 0.02 + Math.sin(q) * 0.4 * T.size, z: 0.08, R: RAMP.metal, update: still });
    },
  },

  indifferent: NONE,

  invisible: {
    family: false, gentle: true, material: "illusion",
    start(s, M, T) { keep(s, { k: "cnOutline", x: T.x, y: T.y, size: T.size, h: T.h, R: RAMP.illusion, update: still }); },
    loop(s, M, { at, T }) { at(1.2, () => ({ k: "glint", x: T.x + s.rand(-0.3, 0.3) * T.size, y: T.y, z: s.rand(0.2, 1) * T.h, life: 5 / 12, R: RAMP.illusion, minor: true, update: still })); },
  },

  malevolence: {
    family: false, gentle: true, material: "unholy",
    start(s, M, T) { orbit(s, T, 3, () => ({ k: "icon", bm: ICONS.shard, R: RAMP.unholy }), { rx: 0.44, ry: 0.2, speed: -1.4 }); },
    loop(s, M, { at }) { at(4, () => ({ k: "wisp", vz: s.rand(0.3, 0.6), g: -0.3, drag: 1.5, life: s.rand(0.6, 1), s: 2, R: RAMP.unholy })); },
  },

  observed: NONE,
  "off-guard": NONE,

  paralyzed: {
    family: false, gentle: true, material: "electricity",
    start(s, M, T) {
      const spots = [];
      for (let i = 0; i < 6; i++) {
        const q = (i / 6) * TAU + 0.4, p = { x: T.x + Math.cos(q) * 0.3 * T.size, y: T.y + Math.sin(q) * 0.1, z: (0.2 + ((i * 3) % 6) * 0.13) * T.h };
        spots.push(p);
        keep(s, { k: "icon", bm: ICONS.spike, ...p, R: RAMP.holy, dim: Math.sin(q) < 0 ? 0.15 : 0, update: still });
      }
      s._cnSpots = spots;
      s.light(T.x, T.y, 0.5 * T.h, 0.9 * T.size, S(RAMP.light, 0.85), 0.3, 1e9);
    },
    loop(s, M, { dt }) {
      const sp = s._cnSpots; if (!sp) return;
      for (let i = s.count(5, dt); i > 0; i--) {
        const a = sp[Math.floor(s.R() * sp.length)], b = sp[Math.floor(s.R() * sp.length)];
        if (a !== b) s.add({ k: "bolt", a: [a.x, a.y, a.z], b: [b.x, b.y, b.z], life: 0.08, R: RAMP.light, seed: s.seedInt(), update: still });
      }
    },
  },

  petrified: {
    family: false, gentle: true, material: "earth",
    start(s, M, T) { keep(s, { k: "cnStone", x: T.x, y: T.y, size: T.size, hgt: 0.55 * T.h, R: RAMP.kinetic, seed: 5, update: still }); },
    loop(s, M, { at, T }) { at(1.5, () => ({ k: "chunk", x: T.x + s.rand(-0.25, 0.25) * T.size, y: T.y + 0.05, z: s.rand(0.1, 0.4) * T.h, vx: s.rand(-0.3, 0.3), g: 8, bounce: 0.2, s: 1, life: 1.2, R: RAMP.kinetic, debris: true }), false); },
  },

  prone: {
    family: false, gentle: true, material: "kinetic",
    start(s, M, T) {
      dust(s, T, 6);
      for (let i = 0; i < 4; i++) s.add({ k: "chunk", x: T.x, y: T.y, z: 0.15, vx: s.rand(-1.2, 1.2), vy: s.rand(-0.4, 0.4), vz: s.rand(0.8, 1.6), g: 9, bounce: 0.3, s: 1, life: 1.2, R: RAMP.kinetic, debris: true });
      keep(s, { k: "cnShadow", x: T.x + 0.14 * T.size, y: T.y + 0.1, r: 0.52 * T.size, R: RAMP.smoke, update: still });
      const c = HEAD(T);
      keep(s, { k: "icon", bm: ICONS.down, ...c, R: RAMP.air, update(p, s2) { p.z = c.z - ((Math.floor(s2.t * 4) % 4) * 0.03); } });
    },
    loop(s, M, { at, T }) { at(1.2, () => ({ k: "smoke", x: T.x + s.rand(-0.35, 0.35) * T.size, y: T.y + 0.15, z: 0.02, vx: s.rand(-0.3, 0.3), vz: 0.05, drag: 3, r: s.rand(1.5, 2.2), life: 0.8, lobes: lobes(s), R: RAMP.kinetic, tone: 0.6, minor: true }), false); },
  },

  quickened: {
    family: false, gentle: true, material: "light",
    start(s, M, T) { keep(s, { k: "cnBand", style: "rune", crawl: true, x: T.x, y: T.y + 0.02, z: 0.02, r: 0.5 * T.size, R: RAMP.holy, update: still }); },
    loop(s, M, { at, T }) {
      at(12, () => {
        const z = s.rand(0.1, 0.95) * T.h, y = T.y + s.rand(-0.12, 0.12);
        return { k: "streak", x: T.x - 0.6 * T.size, y, z, vx: s.rand(5, 7), life: 0.22, R: s.R() < 0.35 ? RAMP.air : RAMP.light, update(p, _s, dt) { p.x += p.vx * dt; } };
      });
      at(1.5, () => ({ k: "glint", x: T.x + s.rand(-0.3, 0.3), y: T.y + 0.2, z: 0.05, life: 5 / 12, R: RAMP.light, minor: true, update: still }), false);
    },
  },

  restrained: {
    family: false, gentle: true, material: "metal",
    start(s, M, T) {
      for (const [z, r] of [[0.3, 0.3], [0.62, 0.27]]) keep(s, { k: "cnBand", style: "chain", x: T.x, y: T.y, z: z * T.h, r: r * T.size, sag: 0.5, topSkip: z > 0.5, R: RAMP.metal, update(p, s2) { p.r = (r + Math.max(0, 0.3 - s2.t) * 1.1) * T.size; } });
      keep(s, { k: "icon", bm: ICONS.stake, x: T.x + 0.32 * T.size, y: T.y + 0.04, z: 0.42 * T.h, R: RAMP.metal, update: still });
    },
  },

  sickened: {
    family: false, gentle: true, material: "poison",
    start(s, M, T) { const c = HEAD(T); keep(s, { k: "cnSpiral", ...c, r: 4 + lvl(s) * 0.6, turns: 1.75, spin: -1, R: RAMP.poison, update: still }); },
    loop(s, M, { at, T }) {
      at(1.5 + lvl(s), () => ({ k: "mote", x: T.x + s.rand(-0.3, 0.3) * T.size, y: T.y, z: s.rand(0.3, 0.8) * T.h, vz: s.rand(0.2, 0.45), vx: s.rand(-0.1, 0.1), drag: 1, life: s.rand(0.8, 1.3), R: RAMP.poison, plus: s.R() < 0.3 }));
    },
  },

  slowed: {
    family: false, gentle: true, material: "arcane",
    start(s, M, T) { keep(s, { k: "cnClock", x: T.x, y: T.y + 0.02, r: 0.6 * T.size, beat: 0.45 + lvl(s) * 0.2, R: RAMP.arcane, update: still }); },
  },

  stunned: {
    family: false, gentle: true, material: "light",
    start(s, M, T) { orbit(s, T, Math.min(4, lvl(s) + 1), () => ({ k: "icon", bm: ICONS.star, R: RAMP.light }), { speed: 3 }); },
  },

  stupefied: NONE,

  unconscious: {
    family: false, gentle: true, material: "illusion",
    loop(s, M, { T }) {
      const k = Math.floor(s.t / 0.75);
      if (k === s._cnZ) return;
      s._cnZ = k;
      const c = HEAD(T);
      s.add({ k: "icon", x: c.x + 0.05, y: c.y, z: c.z - 0.05, life: 2.2, R: RAMP.illusion, from: 0.7, snap: false, bm: (p) => (p.age < 0.9 ? ICONS.z : ICONS.Z), update(p, _s, dt) { p.x += 0.14 * dt; p.z += 0.22 * dt; p.x += Math.sin(p.age * 4) * 0.02 * dt * 10; } });
    },
  },

  undetected: NONE,
  unfriendly: NONE,
  unnoticed: NONE,
  wounded: NONE,
});

/** Condition slugs the overlay table handles, for the coverage tool. */
export const CONDITION_SLUGS = Object.freeze(Object.keys(CONDITIONS));
/** Slugs deliberately drawn as nothing (attitudes, detection states, bookkeeping values). */
export const CONDITIONS_NONE = Object.freeze(CONDITION_SLUGS.filter((k) => CONDITIONS[k].none));
