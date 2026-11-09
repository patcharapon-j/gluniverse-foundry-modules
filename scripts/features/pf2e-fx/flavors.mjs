/**
 * Spellsprite — flavors: the caster's wind-up (constants.mjs FLAVOR_VOCAB),
 * from the tradition or the class feature behind the effect. Pure.
 *
 *   FLAVORS[flavor](s, M, { caster, hand, at, dur })
 *
 * A flavor replaces the generic charge: it draws the whole wind-up, from `at`
 * to `at + dur` (a spell 0.3–0.5 s, a Strike about 0.25 s), and nothing of it
 * outlives that by more than a frame or two, so it never piles onto the release.
 * A spell's flavor ends in the orb swelling at the hand that the release leaves
 * from; a Strike's does not, because the weapon is what leaves.
 *
 * Presence (spellsprite-craft §1): a wind-up is the one moment that says which
 * class is acting, and it is short, so it has to be loud. Each one wraps the
 * whole caster, not a hand: a barbarian's rage is a red surge (a crown of red
 * flame, steam jetting off the head, an anger mark throbbing, the floor cracking
 * hot, the body flushing on each heartbeat); a monk's flurry is a blur of
 * afterimage fists; a kineticist's impulse is the element itself pulled in from
 * a square and more away. Light on all of it.
 *
 * Everything is drawn in the effect's ramp `M.R`, except where the class's own
 * colour is its identity (a barbarian's red, a rogue's shadow).
 */

import { TAU, clamp, lerp, easeOut, hash } from "./core/rand.mjs";
import { S, WHITE, RAMP } from "./core/palette.mjs";
import { registerShapes } from "./core/shapes.mjs";
import { still, lobes, TRADITION_GLYPHS } from "./core/motifs.mjs";
import { B, B2, later, ART, env, fromCaster } from "./motif-art.mjs";

/* ── props ──────────────────────────────────────────────────────────── */

const PISTOL = B2(
  "3111111111w",
  "32211......",
  "3221.......",
  ".322.......",
  ".33........",
);
const LANTERN = B2("...3...", "..3.3..", ".33333.", "3211123", "321w123", "321w123", "3211123", ".33333.", "...3...");
/** Scales: a sanction stamped over the one judged. */
const SCALES = B2(
  "....w....",
  "111121111",
  ".1..2..1.",
  "1.1.2.1.1",
  "111.2.111",
  "....2....",
  "..22222..",
);
const SPARK = B2("...w...", "...1...", "..121..", "w12w21w", "..121..", "...1...", "...w...");
/** The anger mark that throbs at a raging temple: four brackets round a cross-shaped gap, two sizes. */
const ANGER = [
  B("..1.1..", "..1.1..", "11...11", ".......", "11...11", "..1.1..", "..1.1.."),
  B("...1.1...", "...1.1...", "..11.11..", "111...111", ".........", "111...111", "..11.11..", "...1.1...", "...1.1..."),
];

registerShapes({
  /** A hunter's reticle on its prey: four corner brackets closing in, a dot, then a white lock. */
  flReticle(v, P, p) {
    const u = clamp(p.age / p.life), fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, p.z);
    const r = Math.round(p.r * lerp(1.8, 1, easeOut(clamp(u / 0.6)))), L = 6, lock = u > 0.6, c = lock && fr % 2 === 0 ? WHITE : S(p.R, 1);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) for (let i = 0; i < L; i++) {
      P.dot(cx + sx * r - sx * i, cy + sy * r, c, 1, 2); P.dot(cx + sx * r - sx * i, cy + sy * (r - 1), S(p.R, 0.62), 1, 2);
      P.dot(cx + sx * r, cy + sy * r - sy * i, c, 1, 2); P.dot(cx + sx * (r - 1), cy + sy * r - sy * i, S(p.R, 0.62), 1, 2);
    }
    if (lock) {
      P.dot(cx, cy, WHITE, 1, 2);
      for (let k = 2; k <= 5; k++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) P.dot(cx + dx * k, cy + dy * k, S(p.R, k < 4 ? 0.95 : 0.7), 1, 2);
    }
  },

  /** A gear turning: a toothed ring with a hollow hub. */
  flGear(v, P, p) {
    const fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, p.z), r = (p.sz ?? 4) * 1.6, a = env(p), rot = fr * (p.turn ?? 0.25), n = p.teeth ?? 8;
    P.shade(cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3, (x, y) => {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy), q = Math.atan2(dy, dx) - rot;
      const tooth = ((Math.floor(((q / TAU) * n * 2) % (n * 2) + n * 2)) % 2) === 0;
      if (d < r * 0.38 || d > r + (tooth ? 2.4 : 0)) return null;
      return { c: S(p.R, d > r - 0.6 || d < r * 0.38 + 1 ? 0.55 : dx + dy < 0 ? 0.95 : 0.78), a };
    }, 2);
  },

  /** A banner on a pole, raised from the ground, its flag rippling. */
  flBanner(v, P, p) {
    const fr = Math.floor(p.age * 12), [bx, by] = v.ap(p.x, p.y, 0), a = env(p), H = Math.round((p.sz ?? 20) * (v.kind === "top" ? 0.6 : 1) * easeOut(clamp(p.age / 0.12)));
    for (let j = 0; j < H; j++) { P.dot(bx, by - j, S(p.R, 0.45), a, 2); P.dot(bx + 1, by - j, S(p.R, 0.3), a, 2); }
    P.dot(bx, by - H, WHITE, a, 2);
    const fw = 14, fh = 9, sd = p.side ?? 1;
    for (let i = 1; i <= fw; i++) {
      const w = Math.round(Math.sin(i * 0.6 - fr * 1.3) * (i / fw) * 2.5) * sd;
      for (let j = 0; j < fh - (i >= fw - 1 ? 3 : 0); j++) P.dot(bx + i * sd, by - H + 1 + j + w + (i >= fw - 1 ? 1 : 0), S(p.R, j === 0 ? 1 : j === fh - 1 ? 0.55 : (i + fr) % 5 === 0 ? 0.7 : 0.85), a, 2);
    }
  },

  /** A psychic aura: wavering rings round a body, rising and thinning. */
  flAura(v, P, p) {
    const u = clamp(p.age / p.life), fr = Math.floor(p.age * 12), rx = (p.r ?? 0.42) * v.aps;
    for (let k = 0; k < 4; k++) {
      const f = (u * 1.5 + k / 4) % 1, [cx, cy] = v.ap(p.x, p.y, f * p.h), a = (1 - f) * (1 - u * 0.4);
      for (let t = 0; t < 2; t++) P.ellipse(cx, cy + t, rx * (1 - f * 0.25), Math.max(1, (v.kind === "top" ? rx : rx * 0.32) * (1 - f * 0.25)), (q) => {
        if (Math.floor(q * 4 + fr * 1.4 + k) % 3 === 0) return null;
        return { c: S(p.R, t ? 0.6 : Math.sin(q) > 0 ? 1 : 0.75), a };
      }, 2);
    }
  },

  /** A summoner's link: a dashed tether from `a` to (x, y, z), a pulse running along it. */
  flLink(v, P, p) {
    const fr = Math.floor(p.age * 12), A = v.ap(p.a[0], p.a[1], p.a[2]), Bp = v.ap(p.x, p.y, p.z), a = env(p);
    const L = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]), n = Math.max(1, Math.ceil(L)), pulse = ((fr * 3) % (n + 6)) - 3;
    for (let i = 0; i <= n; i++) {
      const f = i / n, x = lerp(A[0], Bp[0], f), y = lerp(A[1], Bp[1], f) - Math.sin(Math.PI * f) * Math.min(7, L * 0.2);
      const hot = Math.abs(i - pulse) < 3;
      if (!hot && (i + fr) % 4 === 3) continue;
      P.dot(x, y, hot ? WHITE : S(p.R, 0.9), a, 2); P.dot(x, y + 1, S(p.R, 0.6), a, 2);
    }
  },

  /** A sword's flourish: an arc swept round a point, revealed in three frames, thick at the head. */
  flArc(v, P, p) {
    const fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, p.z), r = p.sz ?? 9, a = env(p), show = Math.min(1, (fr + 1) / 3);
    const q0 = p.q0 ?? -2.6, span = (p.span ?? 4.2) * show;
    for (let i = 0; i <= span * r; i++) {
      const q = q0 + (i / r) * (p.dir ?? 1), f = i / (span * r || 1), th = p.dim ? 1 : Math.round(1 + f * 3);
      for (let t = 0; t < th; t++) {
        const rr = r - t, x = cx + Math.cos(q) * rr, y = cy + Math.sin(q) * rr * 0.55;
        P.dot(x, y, p.dim ? S(p.R, 0.55) : t === 0 && f > 0.8 ? WHITE : S(p.R, 1 - t * 0.14 - (1 - f) * 0.25), a, 2);
      }
    }
  },

  /** A translucent flush over a standing body: rage's red heartbeat. True blends. */
  fvWash(v, P, p) {
    const k = typeof p.str === "function" ? p.str(p.age) : p.str ?? 0.5;
    if (k < 0.13) return;
    const c = S(p.R, p.t ?? 0.75), rim = S(p.R, Math.min(1, (p.t ?? 0.75) + 0.2));
    if (v.kind === "top") {
      const [cx, cy] = v.ap(p.x, p.y, 0), r = 0.47 * p.size * v.aps;
      P.shade(cx - r, cy - r, cx + r, cy + r, (x, y) => { const d = Math.hypot(x - cx, y - cy) / r; return d > 1 ? null : { c: d > 0.8 ? rim : c, a: d > 0.8 ? Math.min(1, k * 1.6) : k }; }, 0, "mix");
      return;
    }
    const [bx, by] = v.ap(p.x, p.y, 0), rx = 0.28 * p.size * v.aps, ry = p.h * v.aps * 0.5, cy = by - ry;
    P.shade(bx - rx, cy - ry, bx + rx, by, (x, y) => { const dx = (x - bx) / rx, dy = (y - cy) / ry, d = dx * dx + dy * dy; return d > 1 ? null : { c: d > 0.7 ? rim : c, a: d > 0.7 ? Math.min(1, k * 1.6) : k }; }, 0, "mix");
  },

  /** Cracks splitting the floor out from under the feet, glowing hot on the stamp and cooling. */
  fvCracks(v, P, p) {
    const [cx, cy] = v.ap(p.x, p.y, 0), u = clamp(p.age / p.life), grow = easeOut(clamp(p.age / 0.12)), heat = u < 0.35 ? 1 : 1 - (u - 0.35) / 0.65;
    for (let k = 0; k < p.n; k++) {
      let x = cx, y = cy, q = (k / p.n) * TAU + hash(k, p.seed) * 0.8;
      const steps = Math.round(p.r * v.aps * grow * (0.65 + 0.5 * hash(k, 3, p.seed)));
      for (let i = 0; i < steps; i++) {
        q += (hash(k, i >> 1, p.seed) - 0.5) * 0.9;
        x += Math.cos(q); y += Math.sin(q) * v.sq;
        const far = i / Math.max(1, steps), t = heat * (1 - far * 0.6);
        P.dot(x, y, S(p.R, t > 0.7 ? 1 : t > 0.45 ? 0.8 : t > 0.2 ? 0.55 : 0.2), 1, 1);
        if (i < steps * 0.4) P.dot(x, y + 1, S(p.R, 0.15), 1, 1);
      }
    }
  },
}, { flat: ["fvCracks"] });

/* ── shared pieces ──────────────────────────────────────────────────── */

/** The wind-up's frame: where, when, and whether a spell leaves the hand. */
function frame(s, { caster: c, hand, at = 0, dur = 0.4 }) {
  const size = c.size ?? 1, h = c.h ?? 1;
  const H = hand ?? [c.x + 0.3 * size, c.y, 0.85 * h];
  return { c, H, at, dur, end: at + dur, size, h, spell: s.spec.kind !== "strike" };
}

/** Life that ends with the wind-up (a frame or two past it, never more). */
const until = (f, s2, pad = 0.05) => Math.max(0.05, f.end - s2.t + pad);

/** The orb a spell swells to at the hand, and its light: the charge without its circle or its lines. */
function handOrb(s, M, f, top = 2.6) {
  if (!f.spell) return;
  const { H, at, dur } = f, t = top * 1.3 * Math.min(1.5, s.m);
  later(s, at + dur * 0.3, (s2) => {
    const life = Math.max(0.05, f.end - s2.t);
    s2.light(H[0], H[1], H[2], 1.8, S(M.R, 0.85), 1, life + 0.06, { swell: true });
    s2.add({ k: "orb", x: H[0], y: H[1], z: H[2], life, R: M.R, dark: M.dark, r: 1, big: true, update(p) { const u = clamp(p.age / p.life); p.r = 1 + t * u * u * (3 - 2 * u); } });
  });
}

/** A sprite held for the wind-up. */
const prop = (s, M, f, o) => later(s, f.at, (s2) => s2.add({ k: "moSprite", R: M.R, life: Math.max(0.05, f.end - s2.t), from: 0.8, ...o }));

/** Things converging from a ring onto the hand. */
function gather(s, M, f, n, mk, { r = 0.6, swirl = 1.2, from = 0, R = null } = {}) {
  const { H } = f;
  later(s, f.at + from, (s2) => {
    const life = Math.max(0.05, f.end - s2.t);
    for (let i = 0; i < n; i++) {
      const q0 = (i / n) * TAU + s2.rand(-0.3, 0.3), z0 = s2.rand(-0.5, 0.5), w = (i % 4) * 0.035, d0 = r * s2.rand(0.7, 1.1);
      s2.add({ ...mk(s2, i), x: H[0], y: H[1], z: H[2], life: Math.max(0.04, life - w), wait: w, R: R ?? M.R, minor: i % 3 === 2, update(p) {
        const u = clamp(p.age / p.life), d = d0 * (1 - u * u), q = q0 + u * swirl;
        p.x = H[0] + Math.cos(q) * d; p.y = H[1] + Math.sin(q) * d * 0.7; p.z = Math.max(0.03, H[2] + z0 * (1 - u));
      } });
    }
  });
}

/** Streaks pulled in from a ring onto a point for the whole wind-up: the charge's lines, at class scale. */
function inrush(s, M, f, P, { rate = 50, r = 1.1, R = null } = {}) {
  later(s, f.at, (s2) => s2.emit(s2.t, f.end, (s3, _u, dt) => {
    for (let i = s3.count(rate, dt); i > 0; i--) {
      const a = s3.rand(0, TAU), d = s3.rand(0.6, 1) * r, life = s3.rand(0.12, 0.2);
      const px = P[0] + Math.cos(a) * d, py = P[1] + Math.sin(a) * d * 0.7, pz = Math.max(0.05, P[2] + s3.rand(-0.6, 0.6) * d);
      s3.add({ k: "streak", x: px, y: py, z: pz, vx: (P[0] - px) / life, vy: (P[1] - py) / life, vz: (P[2] - pz) / life, life, R: R ?? M.R, minor: i > 2, update(p, _s, dt2) { p.x += p.vx * dt2; p.y += p.vy * dt2; p.z += p.vz * dt2; } });
    }
  }));
}

/** Ground puffs at the feet, pushed outward. */
function dust(s, R, f, n, { tone = 0.45, r = 3.2, sp = 1.6, at = f.at } = {}) {
  later(s, at, (s2) => {
    const life = Math.max(0.1, f.end - s2.t + 0.1);
    for (let i = 0; i < n; i++) { const q = (i / n) * TAU + s2.rand(-0.3, 0.3); s2.add({ k: "smoke", x: f.c.x + Math.cos(q) * 0.3, y: f.c.y + Math.sin(q) * 0.2, z: 0.05, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp * 0.6, vz: 0.15, drag: 4, r: r * s2.rand(0.85, 1.2), life, lobes: lobes(s2), R, tone, minor: i > 3 }); }
  });
}

/** The first target, or the area's centre, or a square ahead of the caster. */
function prey(s, f) {
  const T = s.spec.targets?.[0];
  if (T) return { x: T.x, y: T.y, h: T.h ?? 1 };
  const A = s.spec.area;
  if (A && Number.isFinite(A.x)) return { x: A.x, y: A.y, h: 1 };
  return { x: f.c.x + 1.5, y: f.c.y, h: 1 };
}

/** What gathers for an impulse, by the element's family. */
const ELEMENT = {
  flame: (s) => ({ k: "ember", seed: s.R() }),
  frost: (s) => ({ k: "flake", seed: s.R(), big: s.R() < 0.4 }),
  arc: () => ({ k: "spark" }),
  tide: () => ({ k: "droplet" }),
  earthwork: () => ({ k: "chunk", s: 2 }),
  growth: (s) => ({ k: "petal", seed: s.R() }),
  shock: () => ({ k: "mote", plus: true }),
};

/** The element's own beat at the kineticist's feet while it gathers. */
const ELEMENT_FEET = {
  flame(s2, M, f, life) {
    s2.emit(s2.t, f.end, (s3, _u, dt) => { for (let i = s3.count(30, dt); i > 0; i--) { const q = s3.rand(0, TAU); s3.add({ k: "tongue", x: f.c.x + Math.cos(q) * 0.45 * f.size, y: f.c.y + Math.sin(q) * 0.45 * f.size, z: 0, h: s3.rand(7, 13), w: s3.rand(1.8, 2.8), life: Math.min(0.4, until(f, s3)), seed: Math.floor(s3.R() * 1000), glow: true, r: 2, R: M.R, minor: i > 2, update: still }); } });
  },
  frost(s2, M, f, life) {
    for (let i = 0; i < 8; i++) { const q = (i / 8) * TAU + 0.3; s2.add({ k: "crystal", x: f.c.x + Math.cos(q) * 0.5 * f.size, y: f.c.y + Math.sin(q) * 0.5 * f.size, h: s2.rand(9, 15), w: 2.5, lean: Math.cos(q) * 2.5, life: life + 0.05, wait: i * 0.02, R: M.R, update: still }); }
    s2.add({ k: "frost", x: f.c.x, y: f.c.y, r: 0.8 * f.size, life: life + 0.05, R: M.R, seed: 5, update: still });
  },
  arc(s2, M, f) {
    s2.emit(s2.t, f.end, (s3, _u, dt) => { for (let i = s3.count(14, dt); i > 0; i--) { const q = s3.rand(0, TAU); s3.add({ k: "bolt", a: [f.c.x + Math.cos(q) * 0.7, f.c.y + Math.sin(q) * 0.5, 0.05], b: f.H, life: 0.08, R: M.R, seed: s3.seedInt(), update: still }); } });
  },
  tide(s2, M, f, life) {
    s2.add({ k: "ring", x: f.c.x, y: f.c.y, r: 0.85 * f.size, life: life + 0.05, R: M.R, seed: 9, update: still });
    s2.emit(s2.t, f.end, (s3, _u, dt) => { for (let i = s3.count(24, dt); i > 0; i--) { const q = s3.rand(0, TAU); s3.add({ k: "droplet", x: f.c.x + Math.cos(q) * 0.5, y: f.c.y + Math.sin(q) * 0.35, z: 0.05, vx: -Math.cos(q) * 0.4, vy: -Math.sin(q) * 0.3, vz: s3.rand(1.5, 2.6), g: 6, life: Math.min(0.45, until(f, s3)), R: M.R, minor: i > 2 }); } });
  },
  earthwork(s2, M, f) {
    s2.emit(s2.t, f.end, (s3, _u, dt) => { for (let i = s3.count(18, dt); i > 0; i--) { const q = s3.rand(0, TAU); s3.add({ k: "chunk", x: f.c.x + Math.cos(q) * 0.55, y: f.c.y + Math.sin(q) * 0.4, z: 0.02, vz: s3.rand(1, 2.2), g: 1.5, drag: 1.5, s: 1 + (i % 2), life: Math.min(0.45, until(f, s3)), R: M.R, minor: i > 2 }); } });
    s2.shake = Math.max(s2.shake, 1.2);
  },
  growth(s2, M, f, life) {
    s2.add({ k: "moRoot", x: f.c.x, y: f.c.y, r: 0.8 * f.size, n: 7, growT: life * 0.6, life: life + 0.05, seed: s2.seedInt(), R: M.R, update: still });
  },
  shock(s2, M, f, life) {
    s2.add({ k: "moRings", x: f.H[0], y: f.H[1], z: f.H[2], n: 3, sz: 9, life: life + 0.05, R: M.R, update: still });
  },
};

/* ── the flavors ────────────────────────────────────────────────────── */

export const FLAVORS = {
  /* traditions */

  /** Arcane: a geometric circle under the caster, three sigils closing into the hand, lines pulled in. */
  arcane(s, M, o) {
    const f = frame(s, o);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.add({ k: "glyph", x: f.c.x, y: f.c.y, r: 0.8 * Math.max(1, f.size), life, R: M.R, glyphs: TRADITION_GLYPHS.arcane, star: true, spin: 1.5, update: still });
      for (let i = 0; i < 3; i++) {
        const q0 = (i / 3) * TAU;
        s2.add({ k: "moSigil", x: f.H[0], y: f.H[1], z: f.H[2], sz: 3, life, R: M.R, update(p) {
          const u = clamp(p.age / p.life), q = q0 + u * TAU * 0.6, d = lerp(0.8, 0.05, u * u);
          p.x = f.H[0] + Math.cos(q) * d; p.y = f.H[1] + Math.sin(q) * d * 0.5; p.z = f.H[2] + Math.sin(q) * 0.16;
        } });
      }
    });
    inrush(s, M, f, f.H, { rate: 30, r: 0.9 });
    handOrb(s, M, f);
  },

  /** Divine: a halo over the head, shafts of light falling onto the caster. */
  divine(s, M, o) {
    const f = frame(s, o);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.add({ k: "halo", x: f.c.x, y: f.c.y, z: f.h * 1.3, r: 0.3 * f.size, life, R: M.R, update: still });
      [-0.3, 0.28, 0, -0.12, 0.14].forEach((dx, i) => s2.add({ k: "beam", x: f.c.x + dx, y: f.c.y + 0.02, h: 3.5, w: i === 2 ? 4 : 1.6, life: life * 0.85, wait: i * life * 0.06, R: M.R, update: still }));
      for (let i = 0; i < 5; i++) s2.add({ k: "glint", x: f.c.x + s2.rand(-0.45, 0.45), y: f.c.y, z: f.h * s2.rand(0.4, 1.5), life: 5 / 12, R: M.R, wait: i * life * 0.15, big: i === 0, minor: i > 1, update: still });
      s2.add({ k: "ring", x: f.c.x, y: f.c.y, r: 0.8 * f.size, life: life + 0.05, R: M.R, seed: 2, update: still });
      s2.light(f.c.x, f.c.y, f.h, 1.8, S(M.R, 0.85), 0.8, life, { swell: true });
    });
    handOrb(s, M, f);
  },

  /** Occult: an eye opening over the caster, esoteric glyphs turning the wrong way under them. */
  occult(s, M, o) {
    const f = frame(s, o);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t), n = Math.max(3, Math.round(life * 12)), E = ART.EYE;
      const frames = [E[0], E[1]]; while (frames.length < n) frames.push(E[2]);
      s2.add({ k: "moSprite", R: M.R, frames, x: f.c.x, y: f.c.y, z: f.h * 1.55, life, hero: 0, from: 0.85, update: still });
      s2.add({ k: "glyph", x: f.c.x, y: f.c.y, r: 0.8 * Math.max(1, f.size), life, R: M.R, glyphs: TRADITION_GLYPHS.occult, spin: -1.5, update: still });
      for (let i = 0; i < 4; i++) s2.add({ k: "moSprite", R: M.R, bm: ART.LETTERS[(i * 2) % ART.LETTERS.length], x: f.c.x + (i - 1.5) * 0.28, y: f.c.y, z: f.h * 0.4, vz: 1.3, drag: 1.5, life: life * 0.9, wait: i * 0.04, from: 0.6, minor: i > 1 });
      s2.light(f.c.x, f.c.y, f.h * 1.4, 1.4, S(M.R, 0.85), 0.6, life, { swell: true });
    });
    handOrb(s, M, f);
  },

  /** Primal: roots spreading under the feet, leaves whirled up round the caster. */
  primal(s, M, o) {
    const f = frame(s, o);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.add({ k: "moRoot", x: f.c.x, y: f.c.y, r: 0.85 * f.size, n: 7, growT: life * 0.6, life, seed: s2.seedInt(), R: M.R, update: still });
      for (let i = 0; i < 8; i++) {
        const q0 = (i / 8) * TAU;
        s2.add({ k: "moSprite", R: M.R, bm: ART.LEAF, x: f.c.x, y: f.c.y, z: 0.1, life: life - (i % 2) * 0.04, wait: (i % 2) * 0.04, from: 0.8, minor: i > 5, update(p) {
          const u = clamp(p.age / p.life), q = q0 + u * 5; p.x = f.c.x + Math.cos(q) * 0.6 * (1 - u * 0.3); p.y = f.c.y + Math.sin(q) * 0.3; p.z = 0.1 + u * f.h * 1.2; p.ang = q + Math.PI / 2;
        } });
      }
    });
    handOrb(s, M, f);
  },

  /* classes */

  /**
   * Rage: a red surge. A crown of red flame licks up round the whole body, the
   * body flushes red on two heartbeats, steam jets off the head after each
   * one, an anger mark throbs at the temple, stress lines flash out, the floor
   * cracks hot under a stamp and a shockwave rolls out. The screen shakes.
   */
  rage(s, M, o) {
    const f = frame(s, o), R = RAMP.bleed, RED = RAMP.unholy, HOT = RAMP.fire, beat = f.dur / 2;
    later(s, f.at, (s2) => {
      const life = until(f, s2), c = f.c;
      // the heartbeat flush, twice
      s2.add({ k: "fvWash", x: c.x, y: c.y, size: f.size, h: f.h, R, t: 0.7, life, str: (a) => 0.6 * Math.exp(-((a % beat) / 0.07)), update: still });
      // the red crown, all round the rim
      s2.emit(s2.t, f.end, (s3, u, dt) => {
        for (let i = s3.count(60, dt); i > 0; i--) {
          const q = s3.rand(0, TAU), d = s3.rand(0.36, 0.6) * f.size;
          s3.add({ k: "tongue", x: c.x + Math.cos(q) * d, y: c.y + Math.sin(q) * d, z: s3.rand(0, 0.3) * f.h, h: s3.rand(10, 18) * (0.7 + u * 0.6), w: s3.rand(2.2, 3.4), life: Math.min(0.3, until(f, s3, 0.02)), seed: Math.floor(s3.R() * 1000), glow: true, r: 2, R: RED, minor: i > 4, update: still });
        }
        // heat shimmer rising off the shoulders
        for (let i = s3.count(16, dt); i > 0; i--) s3.add({ k: "ember", x: c.x + s3.rand(-0.4, 0.4) * f.size, y: c.y, z: s3.rand(0.4, 1) * f.h, vz: s3.rand(1.5, 2.6), vx: s3.rand(-0.3, 0.3), drag: 1, life: Math.min(0.35, until(f, s3, 0.02)), R: HOT, seed: s3.R(), minor: true });
      });
      // the anger mark, throbbing big on the beat and small between
      s2.add({ k: "moSprite", R: RED, frames: ANGER, x: c.x + 0.42 * f.size, y: c.y - 0.12, z: f.h * 1.15, life, o: 2, update(p) { p.bm = null; p.frames = (p.age % beat) < 0.08 ? [ANGER[1]] : [ANGER[0]]; } });
      // the floor: cracks splitting out hot, and a shockwave from the stamp
      s2.add({ k: "fvCracks", x: c.x, y: c.y + 0.05, r: 1.15 * f.size, n: 8, seed: s2.seedInt() % 991, life, R: HOT, update: still });
      s2.add({ k: "ring", x: c.x, y: c.y, r: 1.1 * f.size, life: Math.min(0.4, life), R, seed: 4, update: still });
      s2.light(c.x, c.y, f.h * 0.6, 2, S(R, 0.85), 1, life);
      s2.shake = Math.max(s2.shake, 2.2);
    });
    // steam jetting off the head and stress lines flashing out, after each beat
    for (let b = 0; b < 2; b++) later(s, f.at + b * beat + 0.02, (s2) => {
      const c = f.c, life = until(f, s2);
      for (const sd of [-1, 1]) for (let i = 0; i < 4; i++) s2.add({ k: "smoke", x: c.x + sd * 0.12 * f.size, y: c.y - 0.15, z: f.h * 1.05, vx: sd * s2.rand(1, 1.8), vz: s2.rand(2.2, 3.4), drag: 3, r: s2.rand(2.6, 3.6) * (b ? 0.8 : 1), life: Math.min(0.32, life), lobes: lobes(s2), R, tone: 0.68, wait: i * 0.02, minor: i > 1 });
      for (let i = 0; i < 8; i++) { const q = (i / 8) * TAU + b * 0.4, sp = s2.rand(4, 6); s2.add({ k: "streak", x: c.x + Math.cos(q) * 0.35, y: c.y + Math.sin(q) * 0.25, z: f.h * s2.rand(0.4, 1.1), vx: Math.cos(q) * sp, vy: Math.sin(q) * sp * 0.6, life: 0.1, R, minor: i % 2 === 1, update(p, _s, dt) { p.x += p.vx * dt; p.y += p.vy * dt; } }); }
      s2.light(c.x, c.y, f.h, 1.6, S(R, 0.8), 0.8, 0.15);
    });
    handOrb(s, M, f, 2);
  },

  /** Flurry: six jabs in quick turns, each a blur of afterimage fists, a star where it lands. */
  flurry(s, M, o) {
    const f = frame(s, o), P = prey(s, f), [ux, uy] = fromCaster(s, P.x, P.y), n = 6;
    for (let i = 0; i < n; i++) later(s, f.at + (i * f.dur) / n, (s2) => {
      const side = i % 2 ? 1 : -1, life = Math.max(0.05, Math.min(f.dur * 0.42, f.end - s2.t + 0.03)), z = f.h * (0.55 + (i % 3) * 0.14);
      const x0 = f.c.x + ux * 0.2 - uy * side * 0.22, y0 = f.c.y + uy * 0.2 + ux * side * 0.16, reach = 1.05;
      const jab = (k0, alpha, mix) => s2.add({ k: "moSprite", R: M.R, bm: ART.FIST, x: x0, y: y0, z, life, hero: mix || i ? 0 : 1, dim: mix ? 1 : 0, alpha, mix, flip: ux < 0, ang: Math.atan2(uy * 0.6, Math.abs(ux)) * (ux < 0 ? -1 : 1), from: 0.3, update(p) { const k = k0 * easeOut(clamp(p.age / (p.life * 0.35))); p.x = x0 + ux * reach * k; p.y = y0 + uy * reach * k; } });
      // afterimages trailing the real fist
      jab(0.25, 0.5, true); jab(0.5, 0.5, true); jab(0.75, 0.75, true); jab(1, 1, false);
      for (let k = 0; k < 3; k++) s2.add({ k: "streak", x: x0 - uy * (k - 1) * 0.08, y: y0 + ux * (k - 1) * 0.06, z: z + (k - 1) * 0.05, vx: ux * 7, vy: uy * 7, life: 0.1, R: M.R, minor: k !== 1 });
      s2.at(s2.t + life * 0.35, (s3) => {
        s3.add({ k: "star", x: x0 + ux * reach, y: y0 + uy * reach, z, L: 5 + (i % 2) * 2, life: 3 / 12, R: M.R, update: still });
        s3.light(x0 + ux * reach, y0 + uy * reach, z, 0.9, S(M.R, 0.85), 0.7, 0.12);
      });
    });
    later(s, f.at, (s2) => s2.add({ k: "flArc", x: f.c.x + ux * 0.2, y: f.c.y + uy * 0.2, z: f.h * 0.65, sz: 16 * f.size, dir: ux < 0 ? -1 : 1, q0: ux < 0 ? Math.PI - 1.2 : -1.2, span: 2.4, dim: true, life: until(f, s2), R: M.R, from: 0.5, update: still }));
    handOrb(s, M, f, 1.6);
  },

  /** Impulse: the element itself pulled in from more than a square away into the kineticist's hand. */
  impulse(s, M, o) {
    const f = frame(s, o), mk = ELEMENT[M.family] ?? (() => ({ k: "mote", plus: true }));
    gather(s, M, f, 36, (s2) => mk(s2), { r: 1.25, swirl: 3 });
    inrush(s, M, f, f.H, { rate: 60, r: 1.3 });
    later(s, f.at, (s2) => {
      const life = until(f, s2);
      s2.add({ k: "ring", x: f.c.x, y: f.c.y, r: 0.9 * f.size, life, R: M.R, seed: 5, broken: true, update: still });
      s2.add({ k: "glyph", x: f.c.x, y: f.c.y, r: 0.75 * f.size, life, R: M.R, glyphs: TRADITION_GLYPHS.primal, spin: 2, update: still });
      (ELEMENT_FEET[M.family] ?? ELEMENT_FEET.shock)(s2, M, f, life);
      s2.light(f.c.x, f.c.y, f.h * 0.5, 1.8, S(M.R, 0.85), 0.8, life, { swell: true, flicker: M.flicker });
    });
    handOrb(s, M, f, 2.4);
  },

  /** Gun: a quick draw, the pistol spun once in the hand, a glint off the muzzle. */
  gun(s, M, o) {
    const f = frame(s, o), P = prey(s, f), [ux] = fromCaster(s, P.x, P.y), spin = f.dur * 0.55;
    prop(s, M, f, { bm: PISTOL, x: f.H[0], y: f.H[1], z: f.H[2], flip: ux < 0, hero: 0, update(p) {
      p.ang = (ux < 0 ? 1 : -1) * TAU * easeOut(clamp(p.age / spin));
    } });
    later(s, f.at, (s2) => s2.add({ k: "flArc", x: f.H[0], y: f.H[1], z: f.H[2], sz: 9, dir: ux < 0 ? -1 : 1, q0: -1.6, span: 5, dim: true, life: Math.min(spin + 0.05, until(f, s2)), R: M.R, update: still }));
    later(s, f.at + spin, (s2) => {
      s2.add({ k: "glint", x: f.H[0] + (ux < 0 ? -0.45 : 0.45), y: f.H[1], z: f.H[2] + 0.05, big: true, life: 5 / 12, R: M.R, update: still });
      s2.add({ k: "star", x: f.H[0] + (ux < 0 ? -0.45 : 0.45), y: f.H[1], z: f.H[2] + 0.05, L: 6, life: 3 / 12, R: M.R, update: still });
      s2.light(f.H[0], f.H[1], f.H[2], 1.1, S(M.R, 0.85), 0.7, Math.max(0.05, f.end - s2.t));
    });
  },

  /** Finisher: a swashbuckler's flourish, the blade swept round in a big bright arc, a twirl and a star. */
  finisher(s, M, o) {
    const f = frame(s, o), [ux] = fromCaster(s, prey(s, f).x, prey(s, f).y);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.add({ k: "flArc", x: f.c.x, y: f.c.y, z: f.h * 0.6, sz: 21 * f.size, dir: ux < 0 ? -1 : 1, q0: ux < 0 ? -0.5 : -2.6, span: 4.4, life, R: M.R, from: 0.5, update: still });
      s2.add({ k: "flArc", x: f.c.x, y: f.c.y, z: f.h * 0.6, sz: 16 * f.size, dir: ux < 0 ? -1 : 1, q0: ux < 0 ? -0.8 : -2.3, span: 3.6, dim: true, life, wait: 0.04, R: M.R, from: 0.5, update: still });
      s2.add({ k: "moSprite", R: M.R, bm: ART.SWORD, x: f.H[0], y: f.H[1], z: f.H[2] + 0.1, life, hero: 1, flip: ux < 0, from: 0.7, update(p) { p.ang = (ux < 0 ? 1 : -1) * Math.PI / 2 + (ux < 0 ? -1 : 1) * easeOut(clamp(p.age / p.life)) * TAU; } });
      for (let i = 0; i < 4; i++) { const q = -2.4 + i * 1.1; s2.add({ k: "glint", x: f.c.x + Math.cos(q) * 0.75 * (ux < 0 ? -1 : 1), y: f.c.y + Math.sin(q) * 0.3, z: f.h * 0.6, life: 5 / 12, R: M.R, wait: life * (0.15 + i * 0.15), minor: i > 1, update: still }); }
      s2.add({ k: "star", x: f.H[0], y: f.H[1], z: f.H[2] + 0.4, L: 8, life: 3 / 12, R: M.R, wait: Math.max(0, life - 3 / 12), update: still });
      s2.light(f.c.x, f.c.y, f.h * 0.6, 1.6, S(M.R, 0.85), 0.7, life);
    });
  },

  /** Spellstrike: the weapon raised and charged with the spell, crackling, the spell pulled into the blade. */
  spellstrike(s, M, o) {
    const f = frame(s, o), [ux] = fromCaster(s, prey(s, f).x, prey(s, f).y), tip = [f.H[0], f.H[1], f.H[2] + 0.5];
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.add({ k: "moSprite", R: M.R, bm: ART.SWORD, x: f.H[0], y: f.H[1], z: f.H[2] + 0.3, ang: -Math.PI / 2, flip: ux < 0, life, from: 0.8, update(p) { p.hero = Math.floor(p.age * 12) % 4 === 3 ? 1e9 : 0; } });
      s2.add({ k: "moCrackle", x: f.H[0], y: f.H[1], z: f.H[2] + 0.5, r: 0.3, n: 3, life, seed: s2.seedInt(), R: M.R, update: still });
      s2.add({ k: "moSigil", x: f.H[0], y: f.H[1], z: f.H[2] - 0.1, sz: 4, life, R: M.R, update: still });
      s2.add({ k: "glyph", x: f.c.x, y: f.c.y, r: 0.7 * f.size, life, R: M.R, glyphs: TRADITION_GLYPHS.arcane, spin: 2, update: still });
      s2.light(tip[0], tip[1], tip[2], 1.6, S(M.R, 0.85), 1, life + 0.05, { swell: true, flicker: M.flicker });
    });
    inrush(s, M, f, tip, { rate: 45, r: 1 });
  },

  /** Overdrive: gears whirring up at the inventor's back, sparks sprayed off them. */
  overdrive(s, M, o) {
    const f = frame(s, o), [ux] = fromCaster(s, prey(s, f).x, prey(s, f).y), bx = f.c.x - ux * 0.35;
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.add({ k: "flGear", x: bx, y: f.c.y - 0.02, z: f.h * 0.95, sz: 5, teeth: 8, turn: 0.5, life, R: M.R, from: 0.8, update: still });
      s2.add({ k: "flGear", x: bx + ux * 0.3, y: f.c.y - 0.02, z: f.h * 0.55, sz: 3.4, teeth: 6, turn: -0.7, life, R: M.R, from: 0.8, update: still });
      s2.add({ k: "flGear", x: bx - ux * 0.18, y: f.c.y - 0.02, z: f.h * 1.35, sz: 2.6, teeth: 6, turn: -0.8, life, R: M.R, from: 0.8, update: still });
      s2.emit(s2.t, f.end, (s3, _u, dt) => { for (let i = s3.count(55, dt); i > 0; i--) s3.add({ k: "spark", x: bx, y: f.c.y, z: f.h * 0.85, vx: s3.rand(-2.5, 2.5), vy: s3.rand(-0.6, 0.6), vz: s3.rand(0.6, 3), g: 8, life: 0.25, R: M.R, minor: i > 2 }); });
      s2.light(bx, f.c.y, f.h * 0.8, 1.4, S(M.R, 0.85), 0.8, life, { flicker: true });
    });
    handOrb(s, M, f, 1.6);
  },

  /** Composition: notes lifting off the bard in a stream, the song ringing out in rings. */
  composition(s, M, o) {
    const f = frame(s, o), n = 6;
    for (let i = 0; i < n; i++) later(s, f.at + (i * f.dur) / (n + 1), (s2) => {
      const life = Math.max(0.05, f.end - s2.t + 0.03), side = i % 2 ? 1 : -1;
      s2.add({ k: "moSprite", R: M.R, bm: i % 2 ? ART.NOTES2 : ART.NOTE, x: f.c.x + side * 0.4, y: f.c.y, z: f.h * 0.7, life, hero: 1, from: 0.6, minor: i > 3, update(p) { p.z = f.h * 0.7 + p.age * 2; p.x = f.c.x + side * (0.4 + p.age * 0.6 + Math.sin(p.age * 14) * 0.05); } });
    });
    later(s, f.at, (s2) => {
      const life = until(f, s2);
      s2.add({ k: "moRings", x: f.c.x, y: f.c.y, z: f.h * 0.8, n: 3, sz: 10, life, R: M.R, update: still });
      s2.add({ k: "ring", x: f.c.x, y: f.c.y, r: 0.85 * f.size, life, R: M.R, seed: 6, update: still });
      s2.light(f.c.x, f.c.y, f.h * 0.8, 1.6, S(M.R, 0.85), 0.6, life, { swell: true });
    });
    handOrb(s, M, f);
  },

  /** Stance: the fighter plants their feet: a ring of force slams out, dust blasts away, the ground cracks. */
  stance(s, M, o) {
    const f = frame(s, o);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.add({ k: "ring", x: f.c.x, y: f.c.y, r: 1.0 * f.size, life: life + 0.05, R: M.R, seed: 3, update: still });
      s2.add({ k: "ring", x: f.c.x, y: f.c.y, r: 0.7 * f.size, life: life + 0.05, R: M.R, seed: 7, wait: 0.06, update: still });
      s2.add({ k: "halo", x: f.c.x, y: f.c.y, z: 0.12, r: 0.42 * f.size, life, R: M.R, update: still });
      s2.add({ k: "fvCracks", x: f.c.x, y: f.c.y + 0.05, r: 0.7 * f.size, n: 5, seed: s2.seedInt() % 991, life, R: M.R, update: still });
      for (let i = 0; i < 10; i++) { const q = (i / 10) * TAU; s2.add({ k: "streak", x: f.c.x + Math.cos(q) * 0.45, y: f.c.y + Math.sin(q) * 0.3, z: 0.05, vz: s2.rand(4, 6), life: Math.min(0.16, life), R: M.R, minor: i % 2 === 1, update(p, _s, dt) { p.z += p.vz * dt; } }); }
      s2.light(f.c.x, f.c.y, 0.3, 1.6, S(M.R, 0.85), 0.8, life);
      s2.shake = Math.max(s2.shake, 1.4);
    });
    dust(s, RAMP.smoke, f, 9, { tone: 0.55, sp: 2.4 });
    handOrb(s, M, f, 1.6);
  },

  /** Hunt: a big reticle closing on the prey and locking, a sight line drawn to it. */
  hunt(s, M, o) {
    const f = frame(s, o), P = prey(s, f);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.add({ k: "flReticle", x: P.x, y: P.y, z: P.h * 0.6, r: 13, life, R: M.R, update: still });
      s2.add({ k: "flLink", a: [f.c.x, f.c.y, f.h * 0.9], x: P.x, y: P.y, z: P.h * 0.6, life, R: M.R, from: 0.8, update: still });
      s2.add({ k: "glint", x: f.c.x + 0.05, y: f.c.y, z: f.h * 0.9, big: true, life: 5 / 12, R: M.R, update: still });
      s2.light(P.x, P.y, P.h * 0.6, 1, S(M.R, 0.85), 0.5, life);
    });
    handOrb(s, M, f, 1.6);
  },

  /** Sneak: a shadow step, the rogue's afterimage left in smoke as they slip aside. */
  sneak(s, M, o) {
    const f = frame(s, o), R = RAMP.shadow, [ux, uy] = fromCaster(s, prey(s, f).x, prey(s, f).y);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.add({ k: "fmGhost", x: f.c.x - ux * 0.3 + uy * 0.25, y: f.c.y - uy * 0.3 - ux * 0.12, size: f.size, h: f.h, a: 0.6, life, R, update(p) { const u = clamp(p.age / p.life); p.a = 0.6 * (1 - u); } });
      s2.add({ k: "fmGhost", x: f.c.x - ux * 0.6 + uy * 0.45, y: f.c.y - uy * 0.6 - ux * 0.22, size: f.size, h: f.h, a: 0.35, life, R, update(p) { const u = clamp(p.age / p.life); p.a = 0.35 * (1 - u); } });
      for (let i = 0; i < 7; i++) s2.add({ k: "smoke", x: f.c.x - ux * 0.25 + s2.rand(-0.3, 0.3), y: f.c.y + s2.rand(-0.15, 0.15), z: 0.1 + i * 0.12, vx: -ux * 0.8, vz: 0.3, drag: 3, r: 4, life: life + 0.05, lobes: lobes(s2), R, tone: 0.2, minor: i > 3 });
      s2.add({ k: "darkpool", x: f.c.x, y: f.c.y, r: 0.6 * f.size, life, R, update: still });
    });
    handOrb(s, M, f, 1.6);
  },

  /** Judgment: scales stamped over the one judged, the sentence marked on the ground under them. */
  judgment(s, M, o) {
    const f = frame(s, o), P = prey(s, f);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t), z = P.h * 1.45;
      s2.add({ k: "moSprite", R: M.R, bm: SCALES, x: P.x, y: P.y, z: z + 0.6, life, hero: 1, from: 0.8, update(p) { p.z = z + 0.6 * (1 - easeOut(clamp(p.age / (p.life * 0.4)))); } });
      s2.add({ k: "glyph", x: P.x, y: P.y, r: 0.6, life, R: M.R, star: true, update: still });
      s2.add({ k: "halo", x: f.c.x, y: f.c.y, z: f.h * 1.25, r: 0.25, life, R: M.R, update: still });
      s2.light(P.x, P.y, z, 1.2, S(M.R, 0.85), 0.6, life);
    });
    handOrb(s, M, f);
  },

  /** Esoterica: the thaumaturge's implement held up and swung, glinting. */
  esoterica(s, M, o) {
    const f = frame(s, o);
    prop(s, M, f, { bm: LANTERN, x: f.H[0], y: f.H[1], z: f.H[2] + 0.35, hero: 1, update(p) { const fr = Math.floor(p.age * 12); p.ang = [0, 0.4, 0, -0.4][fr % 4]; } });
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.light(f.H[0], f.H[1], f.H[2] + 0.35, 1.5, S(M.R, 0.85), 0.9, life, { flicker: true });
      for (let i = 0; i < 6; i++) s2.add({ k: "mote", x: f.H[0] + s2.rand(-0.2, 0.2), y: f.H[1], z: f.H[2] + 0.3, vz: 1, vx: s2.rand(-0.6, 0.6), drag: 2, life: life * 0.9, wait: i * life * 0.12, plus: i % 2 === 0, R: M.R, minor: i > 2 });
    });
    handOrb(s, M, f, 2);
  },

  /** Psyche: the psychic's aura rising round them in wavering rings. */
  psyche(s, M, o) {
    const f = frame(s, o);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.add({ k: "flAura", x: f.c.x, y: f.c.y, h: f.h * 1.4, r: 0.55 * f.size, life, R: M.R, update: still });
      s2.add({ k: "fvWash", x: f.c.x, y: f.c.y, size: f.size, h: f.h, R: M.R, t: 0.8, str: 0.4, life, update: still });
      s2.light(f.c.x, f.c.y, f.h, 1.7, S(M.R, 0.85), 0.8, life, { swell: true });
    });
    handOrb(s, M, f);
  },

  /** Apparition: the animist's spirit rising beside them. */
  apparition(s, M, o) {
    const f = frame(s, o), [ux] = fromCaster(s, prey(s, f).x, prey(s, f).y), side = ux >= 0 ? -1 : 1;
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t), x = f.c.x + side * 0.55 * f.size;
      s2.add({ k: "moSprite", R: M.R, frames: ART.GHOST, loop: true, fps: 6, x, y: f.c.y - 0.04, z: 0, base: true, flip: side > 0, grow: life * 0.5, life, from: 0.75, update(p) { p.z = Math.min(0.45 * f.h, p.age * 2); } });
      for (let i = 0; i < 5; i++) s2.add({ k: "wisp", x: x + s2.rand(-0.2, 0.2), y: f.c.y, z: 0.1, vz: 1.4, drag: 1, s: 2, life: life * 0.8, wait: i * 0.04, R: M.R, minor: i > 1 });
      s2.light(x, f.c.y, f.h * 0.6, 1.2, S(M.R, 0.85), 0.6, life, { swell: true });
    });
    handOrb(s, M, f);
  },

  /** Necromancy: bones breaking the ground at the caster's feet, grave mist creeping out. */
  necromancy(s, M, o) {
    const f = frame(s, o);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      for (let i = 0; i < 6; i++) { const q = (i / 6) * TAU + 0.4; s2.add({ k: "moSprite", R: M.R, bm: ART.BONE_UP, x: f.c.x + Math.cos(q) * 0.55 * f.size, y: f.c.y + Math.sin(q) * 0.4 * f.size, z: 0, base: true, grow: life * 0.4, ang: Math.cos(q) * 0.3, life: life - i * 0.02, wait: i * 0.02, from: 0.75, minor: i > 3, update: still }); }
      s2.add({ k: "darkpool", x: f.c.x, y: f.c.y, r: 0.7 * f.size, life, R: M.R, update: still });
      s2.light(f.c.x, f.c.y, 0.3, 1.3, S(M.R, 0.85), 0.5, life);
    });
    dust(s, RAMP.smoke, f, 6, { tone: 0.7, r: 3.4, sp: 1.6 });
    handOrb(s, M, f);
  },

  /** Rune: the runesmith carving runes in the air before them, one stroke at a time. */
  rune(s, M, o) {
    const f = frame(s, o), P = prey(s, f), [ux, uy] = fromCaster(s, P.x, P.y), n = 3;
    for (let i = 0; i < n; i++) later(s, f.at + (i * f.dur) / (n + 0.5), (s2) => {
      const life = Math.max(0.05, f.end - s2.t), off = (i - (n - 1) / 2) * 0.4;
      s2.add({ k: "moSprite", R: M.R, bm: ART.RUNES[(s2.seedInt() + i) % ART.RUNES.length], x: f.c.x + ux * 0.55 - uy * off, y: f.c.y + uy * 0.55 + ux * off * 0.3, z: f.h * 0.9, life, hero: 1, grow: life * 0.45, from: 0.8, update: still });
      s2.add({ k: "glint", x: f.c.x + ux * 0.55 - uy * off, y: f.c.y + uy * 0.55, z: f.h * 0.9 + 0.25, life: 5 / 12, R: M.R, minor: true, update: still });
      s2.light(f.c.x + ux * 0.55 - uy * off, f.c.y + uy * 0.55, f.h * 0.9, 0.9, S(M.R, 0.85), 0.5, life);
    });
    handOrb(s, M, f, 2);
  },

  /** Command: a banner raised, the signal rung out to the line. */
  command(s, M, o) {
    const f = frame(s, o), [ux] = fromCaster(s, prey(s, f).x, prey(s, f).y), side = ux >= 0 ? -1 : 1;
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.add({ k: "flBanner", x: f.c.x + side * 0.38, y: f.c.y - 0.03, sz: 42 * f.h, side: -side, life, R: M.R, from: 0.8, update: still });
      s2.add({ k: "moRings", x: f.c.x + side * 0.38, y: f.c.y, z: f.h * 1.4, n: 3, sz: 9, life, R: M.R, wait: life * 0.3, update: still });
      s2.light(f.c.x + side * 0.38, f.c.y, f.h * 1.2, 1.2, S(M.R, 0.85), 0.5, life);
    });
    handOrb(s, M, f, 1.6);
  },

  /** Guard: the shield raised in front, a glint across its face. */
  guard(s, M, o) {
    const f = frame(s, o), [ux, uy] = fromCaster(s, prey(s, f).x, prey(s, f).y);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t), x = f.c.x + ux * 0.4, y = f.c.y + uy * 0.4 + 0.02;
      s2.add({ k: "moSprite", R: M.R, bm: ART.SHIELD, x, y, z: f.h * 0.3, life, hero: 1, from: 0.85, update(p) { p.z = lerp(f.h * 0.3, f.h * 0.6, easeOut(clamp(p.age / (p.life * 0.5)))); } });
      s2.add({ k: "glint", x: x - 0.1, y, z: f.h * 0.85, big: true, life: 5 / 12, R: M.R, wait: life * 0.5, update: still });
      s2.add({ k: "ring", x, y, r: 0.55, life, R: M.R, seed: 12, update: still });
      s2.light(x, y, f.h * 0.6, 1.1, S(M.R, 0.85), 0.6, life);
    });
    handOrb(s, M, f, 1.6);
  },

  /** Exemplar: a divine spark kindled in the chest, flaring out in a star. */
  exemplar(s, M, o) {
    const f = frame(s, o);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t), z = f.h * 0.7;
      s2.add({ k: "moSprite", R: M.R, bm: SPARK, x: f.c.x, y: f.c.y + 0.02, z, life, hero: 0, from: 0.7, spin: TAU / 16, update: still });
      s2.add({ k: "halo", x: f.c.x, y: f.c.y, z, r: 0.4 * f.size, life, R: M.R, update: still });
      s2.add({ k: "star", x: f.c.x, y: f.c.y + 0.02, z, L: 12, life: 3 / 12, R: M.R, wait: Math.max(0, life - 3 / 12), update: still });
      s2.light(f.c.x, f.c.y, z, 1.8, S(M.R, 0.85), 1, life + 0.05, { swell: true });
    });
    inrush(s, M, f, [f.c.x, f.c.y + 0.02, f.h * 0.7], { rate: 30, r: 0.9 });
    handOrb(s, M, f, 2);
  },

  /** Eidolon: the summoner's link drawn taut to their eidolon's spirit beside them. */
  eidolon(s, M, o) {
    const f = frame(s, o), [ux] = fromCaster(s, prey(s, f).x, prey(s, f).y), side = ux >= 0 ? -1 : 1;
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t), ex = f.c.x + side * 0.8 * f.size, ey = f.c.y - 0.15;
      s2.add({ k: "fmGhost", x: ex, y: ey, size: f.size * 1.1, h: f.h * 1.3, a: 0.65, life, R: M.R, update(p) { p.a = 0.65 * Math.min(1, p.age / (p.life * 0.3)); } });
      s2.add({ k: "flLink", a: [f.c.x, f.c.y, f.h * 0.75], x: ex, y: ey, z: f.h * 0.8, life, R: M.R, from: 0.8, update: still });
      s2.add({ k: "moSigil", x: f.c.x, y: f.c.y, z: f.h * 0.75, sz: 3, life, R: M.R, update: still });
      s2.add({ k: "moSigil", x: ex, y: ey, z: f.h * 0.8, sz: 3, life, R: M.R, update: still });
      s2.light(ex, ey, f.h * 0.8, 1.2, S(M.R, 0.85), 0.6, life, { swell: true });
    });
    handOrb(s, M, f);
  },
};
