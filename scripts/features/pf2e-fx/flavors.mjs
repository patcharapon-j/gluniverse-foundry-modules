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
 * Everything is drawn in the effect's ramp `M.R`, except where the class's own
 * colour is its identity (a barbarian's red steam, a rogue's shadow).
 */

import { TAU, clamp, lerp, easeOut } from "./core/rand.mjs";
import { S, WHITE, RAMP } from "./core/palette.mjs";
import { registerShapes } from "./core/shapes.mjs";
import { still, lobes, TRADITION_GLYPHS } from "./core/motifs.mjs";
import { B, blit, later, ART, env, fromCaster } from "./motif-art.mjs";

/* ── props ──────────────────────────────────────────────────────────── */

const PISTOL = B(
  "3111111111w",
  "32211......",
  "3221.......",
  ".322.......",
  ".33........",
);
const LANTERN = B("...3...", "..3.3..", ".33333.", "3211123", "321w123", "321w123", "3211123", ".33333.", "...3...");
/** Scales: a sanction stamped over the one judged. */
const SCALES = B(
  "....w....",
  "111121111",
  ".1..2..1.",
  "1.1.2.1.1",
  "111.2.111",
  "....2....",
  "..22222..",
);
const SPARK = B("...w...", "...1...", "..121..", "w12w21w", "..121..", "...1...", "...w...");

registerShapes({
  /** A hunter's reticle on its prey: four corner brackets closing in, a dot, then a white lock. */
  flReticle(v, P, p) {
    const u = clamp(p.age / p.life), fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, p.z);
    const r = Math.round(p.r * lerp(1.7, 1, easeOut(clamp(u / 0.6)))), L = 3, lock = u > 0.6, c = lock && fr % 2 === 0 ? WHITE : S(p.R, 1);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) for (let i = 0; i < L; i++) {
      P.dot(cx + sx * r - sx * i, cy + sy * r, c, 1, 2);
      P.dot(cx + sx * r, cy + sy * r - sy * i, c, 1, 2);
    }
    if (lock) { P.dot(cx, cy, WHITE, 1, 2); for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) P.dot(cx + dx, cy + dy, S(p.R, 0.9), 1, 2); }
  },

  /** A gear turning: a toothed ring with a hollow hub. */
  flGear(v, P, p) {
    const fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, p.z), r = p.sz ?? 4, a = env(p), rot = fr * (p.turn ?? 0.25), n = p.teeth ?? 8;
    P.shade(cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2, (x, y) => {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy), q = Math.atan2(dy, dx) - rot;
      const tooth = ((Math.floor(((q / TAU) * n * 2) % (n * 2) + n * 2)) % 2) === 0;
      if (d < r * 0.38 || d > r + (tooth ? 1.6 : 0)) return null;
      return { c: S(p.R, d > r - 0.6 ? 0.62 : dx + dy < 0 ? 0.95 : 0.78), a };
    }, 2);
  },

  /** A banner on a pole, raised from the ground, its flag rippling. */
  flBanner(v, P, p) {
    const fr = Math.floor(p.age * 12), [bx, by] = v.ap(p.x, p.y, 0), a = env(p), H = Math.round((p.sz ?? 20) * (v.kind === "top" ? 0.5 : 1) * easeOut(clamp(p.age / 0.12)));
    for (let j = 0; j < H; j++) P.dot(bx, by - j, S(p.R, 0.4), a, 2);
    P.dot(bx, by - H, WHITE, a, 2);
    const fw = 8, fh = 5;
    for (let i = 1; i <= fw; i++) {
      const w = Math.round(Math.sin(i * 0.8 - fr * 1.3) * (i / fw) * 1.5) * (p.side ?? 1);
      for (let j = 0; j < fh - (i === fw ? 2 : 0); j++) P.dot(bx + i * (p.side ?? 1), by - H + 1 + j + w + (i === fw ? 1 : 0), S(p.R, j === 0 ? 1 : (i + fr) % 4 === 0 ? 0.7 : 0.85), a, 2);
    }
  },

  /** A psychic aura: wavering rings round a body, rising and thinning. */
  flAura(v, P, p) {
    const u = clamp(p.age / p.life), fr = Math.floor(p.age * 12), rx = (p.r ?? 0.42) * v.aps;
    for (let k = 0; k < 3; k++) {
      const f = (u * 1.5 + k / 3) % 1, [cx, cy] = v.ap(p.x, p.y, f * p.h), a = (1 - f) * (1 - u * 0.5);
      P.ellipse(cx, cy, rx * (1 - f * 0.25), Math.max(1, rx * 0.32), (q) => {
        if (Math.floor(q * 4 + fr * 1.4 + k) % 3 === 0) return null;
        return { c: S(p.R, Math.sin(q) > 0 ? 0.95 : 0.7), a };
      }, 2);
    }
  },

  /** A summoner's link: a dashed tether from `a` to (x, y, z), a pulse running along it. */
  flLink(v, P, p) {
    const fr = Math.floor(p.age * 12), A = v.ap(p.a[0], p.a[1], p.a[2]), Bp = v.ap(p.x, p.y, p.z), a = env(p);
    const L = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]), n = Math.max(1, Math.ceil(L)), pulse = ((fr * 3) % (n + 6)) - 3;
    for (let i = 0; i <= n; i++) {
      const f = i / n, x = lerp(A[0], Bp[0], f), y = lerp(A[1], Bp[1], f) - Math.sin(Math.PI * f) * Math.min(5, L * 0.15);
      const hot = Math.abs(i - pulse) < 2;
      if (!hot && (i + fr) % 4 === 3) continue;
      P.dot(x, y, hot ? WHITE : S(p.R, 0.85), a, 2);
    }
  },

  /** A sword's flourish: an arc swept round a point, revealed in three frames. */
  flArc(v, P, p) {
    const fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, p.z), r = p.sz ?? 9, a = env(p), show = Math.min(1, (fr + 1) / 3);
    const q0 = p.q0 ?? -2.6, span = (p.span ?? 4.2) * show;
    for (let i = 0; i <= span * r; i++) {
      const q = q0 + (i / r) * (p.dir ?? 1), f = i / (span * r || 1);
      const x = cx + Math.cos(q) * r, y = cy + Math.sin(q) * r * 0.55;
      P.dot(x, y, f > 0.85 ? WHITE : S(p.R, 0.6 + f * 0.4), a, 2);
      if (f > 0.4) P.dot(x, y + 1, S(p.R, 0.7), a, 2);
    }
  },
});

/* ── shared pieces ──────────────────────────────────────────────────── */

/** The wind-up's frame: where, when, and whether a spell leaves the hand. */
function frame(s, { caster: c, hand, at = 0, dur = 0.4 }) {
  const size = c.size ?? 1, h = c.h ?? 1;
  const H = hand ?? [c.x + 0.3 * size, c.y, 0.85 * h];
  return { c, H, at, dur, end: at + dur, size, h, spell: s.spec.kind !== "strike" };
}

/** The orb a spell swells to at the hand, and its light: the charge without its circle or its lines. */
function handOrb(s, M, f, top = 2.6) {
  if (!f.spell) return;
  const { H, at, dur } = f, t = top * Math.min(1.5, s.m);
  later(s, at + dur * 0.35, (s2) => {
    const life = Math.max(0.05, f.end - s2.t);
    s2.light(H[0], H[1], H[2], 1.4, S(M.R, 0.85), 0.9, life + 0.06, { swell: true });
    s2.add({ k: "orb", x: H[0], y: H[1], z: H[2], life, R: M.R, dark: M.dark, r: 1, update(p) { const u = clamp(p.age / p.life); p.r = 1 + t * u * u * (3 - 2 * u); } });
  });
}

/** A sprite held for the wind-up. */
const prop = (s, M, f, o) => later(s, f.at, (s2) => s2.add({ k: "moSprite", R: M.R, life: Math.max(0.05, f.end - s2.t), from: 0.8, ...o }));

/** Things converging from a ring onto the hand. */
function gather(s, M, f, n, mk, { r = 0.6, swirl = 1.2, from = 0 } = {}) {
  const { H } = f;
  later(s, f.at + from, (s2) => {
    const life = Math.max(0.05, f.end - s2.t);
    for (let i = 0; i < n; i++) {
      const q0 = (i / n) * TAU + s2.rand(-0.3, 0.3), z0 = s2.rand(-0.3, 0.3), w = (i % 3) * 0.04;
      s2.add({ ...mk(s2, i), x: H[0], y: H[1], z: H[2], life: life - w, wait: w, R: mk.R ?? M.R, update(p) {
        const u = clamp(p.age / p.life), d = r * (1 - u * u), q = q0 + u * swirl;
        p.x = H[0] + Math.cos(q) * d; p.y = H[1] + Math.sin(q) * d * 0.55; p.z = H[2] + z0 * (1 - u);
      } });
    }
  });
}

/** Ground puffs at the feet, pushed outward. */
function dust(s, R, f, n, { tone = 0.45, r = 2.5, sp = 1.2, at = f.at } = {}) {
  later(s, at, (s2) => {
    const life = Math.max(0.1, f.end - s2.t + 0.1);
    for (let i = 0; i < n; i++) { const q = (i / n) * TAU + s2.rand(-0.3, 0.3); s2.add({ k: "smoke", x: f.c.x + Math.cos(q) * 0.25, y: f.c.y + Math.sin(q) * 0.15, z: 0.05, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp * 0.5, vz: 0.15, drag: 4, r, life, lobes: lobes(s2), R, tone, minor: i > 2 }); }
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
  frost: (s) => ({ k: "flake", seed: s.R() }),
  arc: () => ({ k: "spark" }),
  tide: () => ({ k: "droplet" }),
  earthwork: () => ({ k: "chunk", s: 2 }),
  growth: (s) => ({ k: "petal", seed: s.R() }),
  shock: () => ({ k: "mote" }),
};

/* ── the flavors ────────────────────────────────────────────────────── */

export const FLAVORS = {
  /* traditions */

  /** Arcane: a geometric circle under the caster, three sigils closing into the hand. */
  arcane(s, M, o) {
    const f = frame(s, o);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.add({ k: "glyph", x: f.c.x, y: f.c.y, r: 0.62 * Math.max(1, f.size), life, R: M.R, glyphs: TRADITION_GLYPHS.arcane, spin: 1.5, update: still });
      for (let i = 0; i < 3; i++) {
        const q0 = (i / 3) * TAU;
        s2.add({ k: "moSigil", x: f.H[0], y: f.H[1], z: f.H[2], sz: 3, life, R: M.R, update(p) {
          const u = clamp(p.age / p.life), q = q0 + u * TAU * 0.6, d = lerp(0.6, 0.05, u * u);
          p.x = f.H[0] + Math.cos(q) * d; p.y = f.H[1] + Math.sin(q) * d * 0.5; p.z = f.H[2] + Math.sin(q) * 0.12;
        } });
      }
    });
    handOrb(s, M, f);
  },

  /** Divine: a halo over the head, shafts of light falling onto the caster. */
  divine(s, M, o) {
    const f = frame(s, o);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.add({ k: "halo", x: f.c.x, y: f.c.y, z: f.h * 1.3, r: 0.22 * f.size, life, R: M.R, update: still });
      [-0.22, 0.2, 0].forEach((dx, i) => s2.add({ k: "beam", x: f.c.x + dx, y: f.c.y + 0.02, h: 3, w: i === 2 ? 2.5 : 1.2, life: life * 0.8, wait: i * life * 0.08, R: M.R, update: still }));
      for (let i = 0; i < 3; i++) s2.add({ k: "glint", x: f.c.x + s2.rand(-0.35, 0.35), y: f.c.y, z: f.h * s2.rand(0.6, 1.4), life: 5 / 12, R: M.R, wait: i * life * 0.25, minor: i > 0, update: still });
      s2.light(f.c.x, f.c.y, f.h, 1.4, S(M.R, 0.85), 0.6, life, { swell: true });
    });
    handOrb(s, M, f);
  },

  /** Occult: an eye opening over the caster, esoteric glyphs turning the wrong way under them. */
  occult(s, M, o) {
    const f = frame(s, o);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t), n = Math.max(3, Math.round(life * 12)), E = ART.EYE;
      const frames = [E[0], E[1]]; while (frames.length < n) frames.push(E[2]);
      s2.add({ k: "moSprite", R: M.R, frames, x: f.c.x, y: f.c.y, z: f.h * 1.45, life, hero: 0, from: 0.85, update: still });
      s2.add({ k: "glyph", x: f.c.x, y: f.c.y, r: 0.6 * Math.max(1, f.size), life, R: M.R, glyphs: TRADITION_GLYPHS.occult, spin: -1.5, update: still });
      for (let i = 0; i < 3; i++) s2.add({ k: "moSprite", R: M.R, bm: ART.LETTERS[(i * 2) % ART.LETTERS.length], x: f.c.x + (i - 1) * 0.3, y: f.c.y, z: f.h * 0.4, vz: 1.1, drag: 1.5, life: life * 0.9, wait: i * 0.05, from: 0.6, minor: i === 2 });
    });
    handOrb(s, M, f);
  },

  /** Primal: roots spreading under the feet, leaves whirled up round the caster. */
  primal(s, M, o) {
    const f = frame(s, o);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.add({ k: "moRoot", x: f.c.x, y: f.c.y, r: 0.55 * f.size, n: 5, growT: life * 0.6, life, seed: s2.seedInt(), R: M.R, update: still });
      for (let i = 0; i < 6; i++) {
        const q0 = (i / 6) * TAU;
        s2.add({ k: "moSprite", R: M.R, bm: ART.LEAF, x: f.c.x, y: f.c.y, z: 0.1, life: life - (i % 2) * 0.04, wait: (i % 2) * 0.04, from: 0.8, update(p) {
          const u = clamp(p.age / p.life), q = q0 + u * 5; p.x = f.c.x + Math.cos(q) * 0.45 * (1 - u * 0.3); p.y = f.c.y + Math.sin(q) * 0.22; p.z = 0.1 + u * f.h; p.ang = q + Math.PI / 2;
        } });
      }
    });
    handOrb(s, M, f);
  },

  /* classes */

  /** Rage: red steam off the shoulders, a roar, the ground shaking. */
  rage(s, M, o) {
    const f = frame(s, o), R = RAMP.bleed;
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      for (let i = 0; i < 8; i++) { const sd = i % 2 ? 1 : -1, w = (i >> 1) * life * 0.18; s2.add({ k: "smoke", x: f.c.x + sd * s2.rand(0.15, 0.3) * f.size, y: f.c.y, z: f.h * 0.75, vx: sd * s2.rand(0.3, 0.7), vz: s2.rand(1.8, 2.6), drag: 2, r: s2.rand(1.6, 2.4), life: Math.max(0.05, life - w + 0.05), wait: w, lobes: lobes(s2), R, tone: 0.95, minor: i > 3 }); }
      s2.add({ k: "moRings", x: f.c.x + 0.15, y: f.c.y, z: f.h * 0.95, n: 3, sz: 10, life, R, update: still });
      s2.shake = Math.max(s2.shake, 1.4);
      s2.light(f.c.x, f.c.y, f.h * 0.8, 1.2, S(R, 0.85), 0.7, life);
    });
    handOrb(s, M, f, 2);
  },

  /** Flurry: fists jabbing out ahead in quick turns, afterimages fading behind them. */
  flurry(s, M, o) {
    const f = frame(s, o), [ux, uy] = fromCaster(s, prey(s, f).x, prey(s, f).y), n = 4;
    for (let i = 0; i < n; i++) later(s, f.at + (i * f.dur) / n, (s2) => {
      const side = i % 2 ? 1 : -1, life = Math.max(0.05, Math.min(f.dur * 0.5, f.end - s2.t)), z = f.h * (0.62 + (i % 2) * 0.2);
      const x0 = f.c.x + ux * 0.3 - uy * side * 0.1, y0 = f.c.y + uy * 0.3 + ux * side * 0.06, reach = 0.5;
      const jab = (k0, alpha, mix) => s2.add({ k: "moSprite", R: M.R, bm: ART.FIST, x: x0, y: y0, z, life, hero: mix ? 0 : 1, alpha, mix, flip: ux < 0, from: 0.3, update(p) { const k = k0 * easeOut(clamp(p.age / (p.life * 0.4))); p.x = x0 + ux * reach * k; p.y = y0 + uy * reach * k; } });
      jab(0.45, 0.5, true); jab(1, 1, false);
      s2.add({ k: "streak", x: x0, y: y0, z, vx: ux * 5, vy: uy * 5, life: 0.1, R: M.R, minor: true });
    });
    handOrb(s, M, f, 1.6);
  },

  /** Impulse: the element itself gathering into the kineticist's hand. */
  impulse(s, M, o) {
    const f = frame(s, o), mk = ELEMENT[M.family] ?? (() => ({ k: "mote" }));
    gather(s, M, f, 14, (s2) => mk(s2), { r: 0.75, swirl: 2.4 });
    later(s, f.at, (s2) => s2.add({ k: "ring", x: f.c.x, y: f.c.y, r: 0.55 * f.size, life: Math.max(0.05, f.end - s2.t), R: M.R, seed: 5, broken: true, update: still }));
    handOrb(s, M, f, 2.2);
  },

  /** Gun: a quick draw, the pistol spun once in the hand, a glint off the muzzle. */
  gun(s, M, o) {
    const f = frame(s, o), P = prey(s, f), [ux] = fromCaster(s, P.x, P.y), spin = f.dur * 0.55;
    prop(s, M, f, { bm: PISTOL, x: f.H[0], y: f.H[1], z: f.H[2], flip: ux < 0, hero: 0, update(p) {
      p.ang = (ux < 0 ? 1 : -1) * TAU * easeOut(clamp(p.age / spin));
    } });
    later(s, f.at + spin, (s2) => {
      s2.add({ k: "glint", x: f.H[0] + (ux < 0 ? -0.3 : 0.3), y: f.H[1], z: f.H[2] + 0.05, big: true, life: 5 / 12, R: M.R, update: still });
      s2.light(f.H[0], f.H[1], f.H[2], 0.8, S(M.R, 0.85), 0.5, Math.max(0.05, f.end - s2.t));
    });
  },

  /** Finisher: a swashbuckler's flourish, the blade swept round in a bright arc, a twirl and a glint. */
  finisher(s, M, o) {
    const f = frame(s, o), [ux] = fromCaster(s, prey(s, f).x, prey(s, f).y);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.add({ k: "flArc", x: f.c.x, y: f.c.y, z: f.h * 0.6, sz: 11 * f.size, dir: ux < 0 ? -1 : 1, q0: ux < 0 ? -0.5 : -2.6, span: 4, life, R: M.R, from: 0.5, update: still });
      s2.add({ k: "moSprite", R: M.R, bm: ART.SWORD, x: f.H[0], y: f.H[1], z: f.H[2] + 0.1, life, hero: 1, flip: ux < 0, from: 0.7, update(p) { p.ang = (ux < 0 ? 1 : -1) * Math.PI / 2 + (ux < 0 ? -1 : 1) * easeOut(clamp(p.age / p.life)) * TAU; } });
      s2.add({ k: "glint", x: f.H[0], y: f.H[1], z: f.H[2] + 0.35, life: 5 / 12, R: M.R, wait: life * 0.6, update: still });
    });
  },

  /** Spellstrike: the weapon raised and charged with the spell, crackling, a sigil under the grip. */
  spellstrike(s, M, o) {
    const f = frame(s, o), [ux] = fromCaster(s, prey(s, f).x, prey(s, f).y);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.add({ k: "moSprite", R: M.R, bm: ART.SWORD, x: f.H[0], y: f.H[1], z: f.H[2] + 0.2, ang: -Math.PI / 2, flip: ux < 0, life, from: 0.8, update(p) { p.hero = Math.floor(p.age * 12) % 4 === 3 ? 1e9 : 0; } });
      s2.add({ k: "moCrackle", x: f.H[0], y: f.H[1], z: f.H[2] + 0.45, r: 0.22, n: 2, life, seed: s2.seedInt(), R: M.R, update: still });
      s2.add({ k: "moSigil", x: f.H[0], y: f.H[1], z: f.H[2] - 0.1, sz: 4, life, R: M.R, update: still });
      s2.light(f.H[0], f.H[1], f.H[2] + 0.3, 1.2, S(M.R, 0.85), 0.9, life + 0.05, { swell: true, flicker: M.flicker });
    });
  },

  /** Overdrive: gears whirring up at the inventor's back, sparks thrown off them. */
  overdrive(s, M, o) {
    const f = frame(s, o), [ux] = fromCaster(s, prey(s, f).x, prey(s, f).y), bx = f.c.x - ux * 0.3;
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.add({ k: "flGear", x: bx, y: f.c.y - 0.02, z: f.h * 0.95, sz: 5, teeth: 8, turn: 0.45, life, R: M.R, from: 0.8, update: still });
      s2.add({ k: "flGear", x: bx + ux * 0.22, y: f.c.y - 0.02, z: f.h * 0.6, sz: 3, teeth: 6, turn: -0.6, life, R: M.R, from: 0.8, update: still });
      s2.emit(s2.t, f.end, (s3, _u, dt) => { for (let i = s3.count(30, dt); i > 0; i--) s3.add({ k: "spark", x: bx, y: f.c.y, z: f.h * 0.85, vx: s3.rand(-2, 2), vy: s3.rand(-0.5, 0.5), vz: s3.rand(0.5, 2.5), g: 8, life: 0.25, R: M.R, minor: i > 1 }); });
      s2.light(bx, f.c.y, f.h * 0.8, 1, S(M.R, 0.85), 0.6, life, { flicker: true });
    });
    handOrb(s, M, f, 1.6);
  },

  /** Composition: notes lifting off the bard, a song ringing out. */
  composition(s, M, o) {
    const f = frame(s, o), n = 4;
    for (let i = 0; i < n; i++) later(s, f.at + (i * f.dur) / (n + 1), (s2) => {
      const life = Math.max(0.05, f.end - s2.t), side = i % 2 ? 1 : -1;
      s2.add({ k: "moSprite", R: M.R, bm: i % 2 ? ART.NOTES2 : ART.NOTE, x: f.c.x + side * 0.3, y: f.c.y, z: f.h * 0.7, life, hero: 1, from: 0.6, update(p) { p.z = f.h * 0.7 + p.age * 1.4; p.x = f.c.x + side * (0.3 + Math.sin(p.age * 14) * 0.05); } });
    });
    later(s, f.at + f.dur * 0.3, (s2) => s2.add({ k: "moRings", x: f.c.x, y: f.c.y, z: f.h * 0.8, n: 2, sz: 9, life: Math.max(0.05, f.end - s2.t), R: M.R, update: still }));
    handOrb(s, M, f);
  },

  /** Stance: the fighter planted, dust kicked out from the feet, a ring of force under them. */
  stance(s, M, o) {
    const f = frame(s, o);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.add({ k: "ring", x: f.c.x, y: f.c.y, r: 0.65 * f.size, life: life + 0.05, R: M.R, seed: 3, update: still });
      s2.add({ k: "halo", x: f.c.x, y: f.c.y, z: 0.12, r: 0.32 * f.size, life, R: M.R, update: still });
      s2.shake = Math.max(s2.shake, 0.8);
    });
    dust(s, RAMP.smoke, f, 5, { tone: 0.55, sp: 1.8 });
    handOrb(s, M, f, 1.6);
  },

  /** Hunt: a reticle closing on the prey and locking. */
  hunt(s, M, o) {
    const f = frame(s, o), P = prey(s, f);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.add({ k: "flReticle", x: P.x, y: P.y, z: P.h * 0.6, r: 8, life, R: M.R, update: still });
      s2.add({ k: "glint", x: f.c.x + 0.05, y: f.c.y, z: f.h * 0.9, life: 5 / 12, R: M.R, update: still });
    });
    handOrb(s, M, f, 1.6);
  },

  /** Sneak: a shadow step, the rogue's afterimage left in smoke as they slip aside. */
  sneak(s, M, o) {
    const f = frame(s, o), R = RAMP.shadow, [ux, uy] = fromCaster(s, prey(s, f).x, prey(s, f).y);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.add({ k: "fmGhost", x: f.c.x - ux * 0.25 + uy * 0.2, y: f.c.y - uy * 0.25 - ux * 0.1, size: f.size, h: f.h, a: 0.55, life, R, update(p) { const u = clamp(p.age / p.life); p.a = 0.55 * (1 - u); } });
      for (let i = 0; i < 4; i++) s2.add({ k: "smoke", x: f.c.x - ux * 0.2 + s2.rand(-0.2, 0.2), y: f.c.y, z: 0.1 + i * 0.15, vx: -ux * 0.6, vz: 0.3, drag: 3, r: 3, life: life + 0.05, lobes: lobes(s2), R, tone: 0.2, minor: i > 1 });
      s2.add({ k: "darkpool", x: f.c.x, y: f.c.y, r: 0.4 * f.size, life, R, update: still });
    });
    handOrb(s, M, f, 1.6);
  },

  /** Judgment: scales stamped over the one judged, the sentence marked on the ground under them. */
  judgment(s, M, o) {
    const f = frame(s, o), P = prey(s, f);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t), z = P.h * 1.35;
      s2.add({ k: "moSprite", R: M.R, bm: SCALES, x: P.x, y: P.y, z: z + 0.5, life, hero: 1, from: 0.8, update(p) { p.z = z + 0.5 * (1 - easeOut(clamp(p.age / (p.life * 0.4)))); } });
      s2.add({ k: "ring", x: P.x, y: P.y, r: 0.45, life, R: M.R, seed: 11, wait: life * 0.4, update: still });
      s2.add({ k: "halo", x: f.c.x, y: f.c.y, z: f.h * 1.25, r: 0.18, life, R: M.R, update: still });
    });
    handOrb(s, M, f);
  },

  /** Esoterica: the thaumaturge's implement held up and swung, glinting. */
  esoterica(s, M, o) {
    const f = frame(s, o);
    prop(s, M, f, { bm: LANTERN, x: f.H[0], y: f.H[1], z: f.H[2] + 0.25, hero: 1, update(p) { const fr = Math.floor(p.age * 12); p.ang = [0, 0.4, 0, -0.4][fr % 4]; } });
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.light(f.H[0], f.H[1], f.H[2] + 0.25, 1.1, S(M.R, 0.85), 0.8, life, { flicker: true });
      for (let i = 0; i < 3; i++) s2.add({ k: "mote", x: f.H[0] + s2.rand(-0.15, 0.15), y: f.H[1], z: f.H[2] + 0.2, vz: 0.8, vx: s2.rand(-0.4, 0.4), drag: 2, life: life * 0.9, wait: i * life * 0.2, R: M.R, minor: i > 0 });
    });
    handOrb(s, M, f, 2);
  },

  /** Psyche: the psychic's aura rising round them in wavering rings. */
  psyche(s, M, o) {
    const f = frame(s, o);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.add({ k: "flAura", x: f.c.x, y: f.c.y, h: f.h * 1.2, r: 0.42 * f.size, life, R: M.R, update: still });
      s2.light(f.c.x, f.c.y, f.h, 1.3, S(M.R, 0.85), 0.6, life, { swell: true });
    });
    handOrb(s, M, f);
  },

  /** Apparition: the animist's spirit rising beside them. */
  apparition(s, M, o) {
    const f = frame(s, o), [ux] = fromCaster(s, prey(s, f).x, prey(s, f).y), side = ux >= 0 ? -1 : 1;
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t), x = f.c.x + side * 0.45 * f.size;
      s2.add({ k: "moSprite", R: M.R, frames: ART.GHOST, loop: true, fps: 6, x, y: f.c.y - 0.04, z: 0, base: true, flip: side > 0, grow: life * 0.5, life, from: 0.75, update(p) { p.z = Math.min(0.45 * f.h, p.age * 2); } });
      for (let i = 0; i < 3; i++) s2.add({ k: "wisp", x: x + s2.rand(-0.15, 0.15), y: f.c.y, z: 0.1, vz: 1.2, drag: 1, s: 2, life: life * 0.8, wait: i * 0.05, R: M.R, minor: i > 0 });
    });
    handOrb(s, M, f);
  },

  /** Necromancy: bones breaking the ground at the caster's feet, grave mist creeping out. */
  necromancy(s, M, o) {
    const f = frame(s, o);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      for (let i = 0; i < 4; i++) { const q = (i / 4) * TAU + 0.4; s2.add({ k: "moSprite", R: M.R, bm: ART.BONE_UP, x: f.c.x + Math.cos(q) * 0.42 * f.size, y: f.c.y + Math.sin(q) * 0.3 * f.size, z: 0, base: true, grow: life * 0.4, ang: Math.cos(q) * 0.3, life: life - i * 0.02, wait: i * 0.02, from: 0.75, update: still }); }
    });
    dust(s, RAMP.smoke, f, 4, { tone: 0.7, r: 2.5, sp: 1.4 });
    handOrb(s, M, f);
  },

  /** Rune: the runesmith carving runes in the air before them, one stroke at a time. */
  rune(s, M, o) {
    const f = frame(s, o), P = prey(s, f), [ux, uy] = fromCaster(s, P.x, P.y), n = 2;
    for (let i = 0; i < n; i++) later(s, f.at + (i * f.dur) / (n + 0.5), (s2) => {
      const life = Math.max(0.05, f.end - s2.t), off = (i - (n - 1) / 2) * 0.28;
      s2.add({ k: "moSprite", R: M.R, bm: ART.RUNES[(s2.seedInt() + i) % ART.RUNES.length], x: f.c.x + ux * 0.45 - uy * off, y: f.c.y + uy * 0.45 + ux * off * 0.3, z: f.h * 0.85, life, hero: 1, grow: life * 0.45, from: 0.8, update: still });
      s2.add({ k: "glint", x: f.c.x + ux * 0.45 - uy * off, y: f.c.y + uy * 0.45, z: f.h * 0.85 + 0.15, life: 5 / 12, R: M.R, minor: true, update: still });
    });
    handOrb(s, M, f, 2);
  },

  /** Command: a banner raised, the signal rung out to the line. */
  command(s, M, o) {
    const f = frame(s, o), [ux] = fromCaster(s, prey(s, f).x, prey(s, f).y), side = ux >= 0 ? -1 : 1;
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t);
      s2.add({ k: "flBanner", x: f.c.x + side * 0.32, y: f.c.y - 0.03, sz: 34 * f.h, side: -side, life, R: M.R, from: 0.8, update: still });
      s2.add({ k: "moRings", x: f.c.x + side * 0.32, y: f.c.y, z: f.h * 1.3, n: 2, sz: 9, life, R: M.R, wait: life * 0.3, update: still });
    });
    handOrb(s, M, f, 1.6);
  },

  /** Guard: the shield raised in front, a glint across its face. */
  guard(s, M, o) {
    const f = frame(s, o), [ux, uy] = fromCaster(s, prey(s, f).x, prey(s, f).y);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t), x = f.c.x + ux * 0.32, y = f.c.y + uy * 0.32 + 0.02;
      s2.add({ k: "moSprite", R: M.R, bm: ART.SHIELD, x, y, z: f.h * 0.3, life, hero: 1, from: 0.85, update(p) { p.z = lerp(f.h * 0.3, f.h * 0.6, easeOut(clamp(p.age / (p.life * 0.5)))); } });
      s2.add({ k: "glint", x: x - 0.08, y, z: f.h * 0.8, life: 5 / 12, R: M.R, wait: life * 0.5, update: still });
    });
    handOrb(s, M, f, 1.6);
  },

  /** Exemplar: a divine spark kindled in the chest, flaring out in a star. */
  exemplar(s, M, o) {
    const f = frame(s, o);
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t), z = f.h * 0.7;
      s2.add({ k: "moSprite", R: M.R, bm: SPARK, x: f.c.x, y: f.c.y + 0.02, z, life, hero: 0, from: 0.7, spin: TAU / 16, update: still });
      s2.add({ k: "halo", x: f.c.x, y: f.c.y, z, r: 0.3 * f.size, life, R: M.R, update: still });
      s2.add({ k: "star", x: f.c.x, y: f.c.y + 0.02, z, L: 8, life: 3 / 12, R: M.R, wait: Math.max(0, life - 3 / 12), update: still });
      s2.light(f.c.x, f.c.y, z, 1.4, S(M.R, 0.85), 1, life + 0.05, { swell: true });
    });
    handOrb(s, M, f, 2);
  },

  /** Eidolon: the summoner's link drawn taut to their eidolon's spirit beside them. */
  eidolon(s, M, o) {
    const f = frame(s, o), [ux] = fromCaster(s, prey(s, f).x, prey(s, f).y), side = ux >= 0 ? -1 : 1;
    later(s, f.at, (s2) => {
      const life = Math.max(0.05, f.end - s2.t), ex = f.c.x + side * 0.7 * f.size, ey = f.c.y - 0.15;
      s2.add({ k: "fmGhost", x: ex, y: ey, size: f.size * 0.9, h: f.h * 1.1, a: 0.6, life, R: M.R, update(p) { p.a = 0.6 * Math.min(1, p.age / (p.life * 0.3)); } });
      s2.add({ k: "flLink", a: [f.c.x, f.c.y, f.h * 0.75], x: ex, y: ey, z: f.h * 0.8, life, R: M.R, from: 0.8, update: still });
      s2.add({ k: "moSigil", x: f.c.x, y: f.c.y, z: f.h * 0.75, sz: 3, life, R: M.R, update: still });
      s2.add({ k: "moSigil", x: ex, y: ey, z: f.h * 0.8, sz: 3, life, R: M.R, update: still });
    });
    handOrb(s, M, f);
  },
};
