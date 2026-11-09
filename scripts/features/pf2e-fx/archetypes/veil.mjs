/**
 * Spellsprite archetypes — veil: concealing, draining and summoning. docs/SPELLSPRITE_ARCHETYPES.md §4
 * (rows 16, 19, 20) says what each covers; the spellsprite-craft skill says how good it must be.
 *
 * Each drawer is (s, M, ctx) like a FORMS entry: ctx = { caster, targets, area, hand, t0, release, linger, fire, self }.
 * buildForm has drawn the caster's charge (and an area's footprint); a drawer draws what lands.
 *
 *   conceal  by name: darkness   a dome of dark spreads over the area, light motes drift in and are swallowed,
 *                                the creatures under it dim
 *                     mist       rolling fog banks swell across the area and drift
 *                     blur       the body shivers apart into two offset doubles that jitter and flicker
 *                     mirror     the body splits into ghost doubles that drift out, circle it and flicker
 *                     (else)     figment / illusion: a puff, then a shimmering image builds up out of
 *                                scanlines at the point (over the creature, a disguise), glitching as it holds
 *   drain    feed (drink blood, drain life, siphon): the target is struck, droplets of the material burst out of
 *            it, hang, and whip home to the actor along a twisting double stream; the target pales and shrinks a
 *            hair, the actor flushes and pulses with every gulp, a gulp ring closes. With no target the stream is
 *            drawn up out of the floor. A resisted drain frays half way, snaps and spills.
 *            seep (affliction, poison apply, by name): a thin trickle, then dark veins spread through the body
 *            with sickly pulses; resisted, the veins recede and are spat out.
 *   summon   a circle opens on the floor (at the area, the target, or beside the actor), a column of the
 *            material rises, a silhouette (humanoid, beast, elemental or undead, by name) forms out of
 *            converging particles, solidifies and lands in a ring of dust. Undead claw up out of the ground
 *            through cracks, throwing grave dirt.
 *
 * Every one scales with the subject's size and the rank (s.m), takes the material's ramp (drain falls back to
 * blood or void, summon to arcane, darkness to shadow, mist to air, when the material says nothing), and a
 * crit is bigger with a hero frame.
 */

import { TAU, clamp, lerp, easeOut, hash, fadeOut, pnoise } from "../core/rand.mjs";
import { RAMP, S, WHITE, INK } from "../core/palette.mjs";
import { registerShapes, GLYPHS } from "../core/shapes.mjs";
import { still, lobes } from "../core/motifs.mjs";
import { areaGeom, areaPoints } from "../area.mjs";

/* ── ramps ───────────────────────────────────────────────────────────── */

const cache = new WeakMap();
const derived = (R, key, fn) => {
  let m = cache.get(R);
  if (!m) { m = {}; cache.set(R, m); }
  return (m[key] ??= Object.freeze(fn(R)));
};
/** The material's shadow end, lit at the top: darkness and drain read dark with a rim. */
const deep = (R) => derived(R, "deep", (r) => [r[0], r[0], r[1], r[1], r[2], r[3], r[4]]);
/** Drained of colour and lifted: what a creature pales towards. */
const pale = (R) => derived(R, "pale", (r) => r.map(([a, b, c]) => {
  const l = 0.3 * a + 0.59 * b + 0.11 * c, k = (v) => Math.round(lerp(lerp(v, l, 0.75), 235, 0.35));
  return [k(a), k(b), k(c)];
}));
/** A material that names no colour of its own. */
const plain = (M) => M.material === "kinetic" || M.material === "neutral";

/* ── silhouettes, in squares from the feet (side) or the centre (top) ─ */

const seg = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, f = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(px - ax - dx * f, py - ay - dy * f);
};
/** Side: `dx` across, `up` height; 1 body, 3 an eye. */
const SIL = {
  human(dx, up, s, h) {
    const ax = Math.abs(dx), hy = 0.86 * h;
    if (Math.hypot(dx, up - hy) < 0.15 * s) return up > hy - 0.02 * h && up < hy + 0.04 * h && Math.abs(ax - 0.06 * s) < 0.025 * s ? 3 : 1;
    if (up >= 0.36 * h && up <= 0.74 * h) {
      const w = lerp(0.16, 0.22, (up - 0.36 * h) / (0.38 * h)) * s;
      if (ax < w) return 1;
      if (ax > w + 0.02 * s && ax < w + 0.1 * s && up > 0.4 * h) return 1;
    }
    return up >= 0 && up < 0.38 * h && Math.abs(ax - 0.08 * s) < 0.065 * s ? 1 : 0;
  },
  undead(dx, up, s, h) {
    // hunched, both arms clawing up
    const lean = Math.max(0, up - 0.34 * h) * 0.18, x = dx - lean, ax = Math.abs(x), hy = 0.8 * h;
    if (Math.hypot(x - 0.03 * s, up - hy) < 0.14 * s) return up > hy - 0.03 * h && up < hy + 0.03 * h && Math.abs(Math.abs(x - 0.03 * s) - 0.06 * s) < 0.025 * s ? 3 : 1;
    if (up >= 0.34 * h && up <= 0.7 * h && ax < lerp(0.15, 0.2, (up - 0.34 * h) / (0.36 * h)) * s) return 1;
    for (const k of [-1, 1]) if (seg(x, up, k * 0.17 * s, 0.64 * h, k * 0.3 * s, 1.02 * h) < 0.05 * s) return 1;
    return up >= 0 && up < 0.36 * h && Math.abs(ax - 0.08 * s) < 0.06 * s ? 1 : 0;
  },
  beast(dx, up, s, h) {
    const bx = dx / (0.36 * s), by = (up - 0.44 * h) / (0.17 * h);
    if (bx * bx + by * by < 1) return 1;
    if (Math.hypot(dx - 0.42 * s, up - 0.6 * h) < 0.14 * s) return Math.hypot(dx - 0.47 * s, up - 0.63 * h) < 0.03 * s ? 3 : 1;
    if (seg(dx, up, 0.37 * s, 0.7 * h, 0.4 * s, 0.82 * h) < 0.035 * s) return 1;
    for (const lx of [-0.27, -0.14, 0.14, 0.27]) if (Math.abs(dx - lx * s) < 0.05 * s && up < 0.4 * h) return 1;
    return seg(dx, up, -0.34 * s, 0.5 * h, -0.5 * s, 0.7 * h) < 0.035 * s ? 1 : 0;
  },
  elemental(dx, up, s, h, age) {
    const H = 1.08 * h; if (up < 0 || up > H) return 0;
    const f = up / H, hw = s * (0.09 + 0.21 * Math.sin(Math.PI * Math.min(1, f * 1.1))) + 0.03 * s * Math.sin(up * 14 / h - age * 9);
    if (Math.abs(dx - 0.05 * s * Math.sin(f * 6 + age * 5)) < hw) return f > 0.72 && f < 0.8 && Math.abs(Math.abs(dx) - 0.07 * s) < 0.03 * s ? 3 : 1;
    return Math.hypot(Math.abs(dx) - 0.31 * s, up - 0.7 * h) < 0.09 * s ? 1 : 0;
  },
};
/** Top-down: the body seen from above; 3 the head (or the eye of a swirl). */
const SILT = {
  human: (dx, dy, s) => { const d = Math.hypot(dx, dy); return d < 0.16 * s ? 3 : d < 0.4 * s ? 1 : 0; },
  undead: (dx, dy, s) => { const d = Math.hypot(dx - 0.04 * s, dy); return d < 0.15 * s ? 3 : Math.hypot(dx, dy) < 0.38 * s || seg(Math.abs(dx), dy, 0.2 * s, -0.1 * s, 0.4 * s, -0.36 * s) < 0.06 * s ? 1 : 0; },
  beast: (dx, dy, s) => { const ex = dx / (0.46 * s), ey = dy / (0.27 * s); return Math.hypot(dx - 0.42 * s, dy) < 0.16 * s ? 3 : ex * ex + ey * ey < 1 ? 1 : 0; },
  elemental: (dx, dy, s, _h, age) => {
    const d = Math.hypot(dx, dy) / s; if (d > 0.44) return 0;
    return d < 0.12 ? 3 : Math.floor((Math.atan2(dy, dx) / TAU) * 3 + d * 6 - age * 3) % 2 ? 1 : 0;
  },
};

/** A 3×3 glyph from the suite's alphabet. */
function glyph3(P, G, x, y, c, a) {
  for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) if (G[j * 3 + k] === "1") P.dot(x - 1 + k, y - 1 + j, c, a, 1);
}

/** A point on the drain's twisting stream, in squares: from `A` to `B`, strand phase `ph`, at time `t`. */
function helix(A, B, f, ph, amp, t, turns = 1.6, spin = 7) {
  const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  const env = Math.sin(Math.PI * clamp(f)) ** 0.7, q = f * TAU * turns + ph - t * spin, o = Math.sin(q) * amp * env;
  return [A[0] + dx * f + nx * o, A[1] + dy * f + ny * o, lerp(A[2], B[2], f) + Math.sin(Math.PI * f) * 0.3 + Math.cos(q) * amp * env * 0.8, Math.cos(q)];
}

/* ── shapes ──────────────────────────────────────────────────────────── */

registerShapes({
  /** Drain: two strands twisting round each other from source to sink, beads of the material flowing along them. */
  veStream(v, P, p) {
    const age = p.age, R = p.R;
    let head = clamp(age / p.ext);
    if (p.brk) head = Math.min(head, p.brk) * (p.snap && age > p.snap ? Math.max(0, 1 - (age - p.snap) / 0.25) : 1);
    const tail = age > p.hold ? clamp((age - p.hold) / p.retract) : 0;
    if (head <= tail) return;
    const [ax, ay] = v.ap(...p.a), [bx, by] = v.ap(...p.b), n = Math.ceil(Math.hypot(bx - ax, by - ay) * 1.6) + 8;
    const nb = p.beads ?? 4, fray = p.brk && age > p.brk * p.ext ? 1 : 0;
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        if (f < tail || f > head) continue;
        const [x, y, z, depth] = helix(p.a, p.b, f, k * Math.PI, p.amp, age, p.turns, p.spin);
        const [sx, sy] = v.ap(x, y, z);
        let hot = false;
        for (let j = 0; j < nb; j++) if (Math.abs(f - ((age * p.flow + j / nb) % 1)) < 0.028) hot = true;
        // the frayed end of a resisted drain breaks into gaps
        if (fray && f > head - 0.18 && hash(i >> 1, Math.floor(age * 12), k) < 0.45) continue;
        const front = depth > 0, nearHead = head - f < 0.03 && head < 1;
        const c = nearHead || hot ? S(R, 1) : front ? S(R, 0.85) : S(R, 0.5);
        P.dot(sx, sy, c, 1, front ? 2 : 1);
        if (front || p.thick) P.dot(sx, sy + 1, S(R, front ? 0.62 : 0.35), 1, front ? 2 : 1);
        if (hot && front && i % 3 === 0) { P.dot(sx - 1, sy, S(R, 0.9), 1, 2); P.dot(sx + 1, sy, S(R, 0.9), 1, 2); P.dot(sx, sy - 1, S(R, 0.95), 1, 2); }
        if (k === 0 && i % 2 === 0) { const [cx, cy] = v.ap(...helix(p.a, p.b, f, 0, 0, age).slice(0, 3)); P.under(cx, cy, S(R, 0.22)); }
      }
    }
  },

  /** Drain, seep: dark veins spreading through the body from where it entered, sickly pulses running out along them. */
  veSeep(v, P, p) {
    const top = v.kind === "top", G = v.aps, age = p.age, R = p.R, s = p.size, h = p.h;
    if (!p._v) {
      // the veins, in body units (u across, w up the body or across the disc), with their distance from the entry
      let seed = p.seed;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, pts = [];
      const walk = (u, w, q, d, n, depthLeft) => {
        for (let i = 0; i < n; i++) {
          q += (rnd() - 0.5) * 1.1; u += Math.cos(q) * 0.075; w += Math.sin(q) * 0.075; d += 0.075;
          if (Math.hypot(u, top ? w : (w - 0.5) * 1.6) > 1) break;
          pts.push([u, w, d]);
          if (depthLeft > 0 && rnd() < 0.18) walk(u, w, q + (rnd() < 0.5 ? -1 : 1) * 0.9, d, Math.floor(n * 0.55), depthLeft - 1);
        }
      };
      const eu = p.eu * (top ? 0.8 : 0.5), ew = top ? p.ew * 0.8 : 0.62;
      for (let k = 0; k < p.n; k++) walk(eu, ew, Math.atan2(-p.ew, -p.eu) + (k / p.n - 0.5) * 2.6, 0, 16, 2);
      p._v = pts;
      p._max = Math.max(0.5, ...pts.map((q) => q[2]));
    }
    const spread = clamp(age / p.spread) * (p.recede && age > p.recede ? Math.max(0, 1 - (age - p.recede) / 0.45) : 1);
    const a = fadeOut(age / p.life, 0.7);
    if (spread <= 0 || a <= 0.02) return;
    const [bx, by] = v.ap(p.x, p.y, 0), r = 0.62 * s * G, W = 0.24 * s * G, H = h * G;
    const at = top ? (u, w) => [bx + u * r, by + w * r] : (u, w) => [bx + u * W, by - w * H];
    // the stain: the body darkening as it spreads
    const k = spread * 0.5 * a;
    if (top) P.shade(bx - r, by - r, bx + r, by + r, (x, y) => (Math.hypot(x - bx, y - by) < r * Math.min(1, 0.35 + spread) ? { c: S(R, 0.15), a: k } : null), 0, "mix");
    else P.shade(bx - W * 1.6, by - H, bx + W * 1.6, by, (x, y) => (SIL.human((x - bx) / G, (by - y) / G, s, h) && (by - y) / H > 0.62 - spread * 0.7 && (by - y) / H < 0.62 + spread * 0.6 ? { c: S(R, 0.15), a: k } : null), 0, "mix");
    for (const [u, w, d] of p._v) {
      const f = d / p._max; if (f > spread) continue;
      let lit = 0;
      for (const tp of p.pulses) { const wv = (age - tp) * 1.8; if (wv > 0 && Math.abs(f - wv) < 0.09) lit = 1; }
      const [x, y] = at(u, w);
      if (!top && !SIL.human((x - bx) / G, (by - y) / G, s, h)) continue;
      const tip = spread - f < 0.06, c = lit ? S(R, 1) : tip ? S(R, 0.75) : S(R, 0.08);
      P.dot(x, y, c, a, 2);
      P.dot(x + 1, y, lit ? S(R, 0.85) : S(R, f < 0.4 ? 0.08 : 0.25), a, 2);
      if (lit) { P.dot(x, y - 1, S(R, 0.85), a, 2); P.dot(x, y + 1, S(R, 0.85), a, 2); }
      P.under(x, y + 1, S(R, 0.55)); P.under(x + 1, y + 1, S(R, 0.45));
    }
  },

  /** A wash over a body: the drained target paling (and shrinking a hair), the feeder flushing, a ghost double. */
  veBody(v, P, p) {
    const age = p.age;
    let a = (p.ka ?? 0.5) * (p.inT ? Math.min(1, age / p.inT) : 1) * fadeOut(age / p.life, p.from ?? 0.7);
    if (p.flick) a *= hash(Math.floor(age * 12), p.seed) < p.flick ? 0.35 : 1;
    if (a < 0.05) return;
    const R = p.R, c = S(R, p.tone ?? 0.6), rim = S(R, p.rim ?? 0.9), sc = p.scale ?? 1, [bx, by] = v.ap(p.x, p.y, 0), G = v.aps;
    if (v.kind === "top") {
      const rr = 0.47 * p.size * G * sc;
      P.shade(bx - rr - 1, by - rr - 1, bx + rr + 1, by + rr + 1, (x, y) => {
        const d = Math.hypot(x - bx, y - by);
        if (d > rr) return null;
        if (d > rr - 1.4) return { c: rim, a: Math.min(1, a * 1.6) };
        // a head, so a double reads as a body and not a coin
        return Math.hypot(x - bx, y - by + rr * 0.08) < rr * 0.36 ? { c: S(R, (p.tone ?? 0.6) + 0.18), a } : { c, a };
      }, 0, "mix");
      return;
    }
    const s = p.size * sc, h = p.h * sc, fn = SIL[p.sil] ?? SIL.human;
    P.shade(bx - 0.4 * s * G, by - h * G - 2, bx + 0.4 * s * G, by, (x, y) => {
      const dx = (x - bx) / G, up = (by - y) / G;
      if (!fn(dx, up, s, h, age)) return null;
      const e = !fn(dx - 1 / G, up, s, h, age) || !fn(dx + 1 / G, up, s, h, age) || !fn(dx, up + 1 / G, s, h, age);
      return e ? { c: rim, a: Math.min(1, a * 1.6) } : { c, a };
    }, 0, "mix");
  },

  /** Summon: the circle burned into the floor round a dark opening; undead tear it open as cracks instead. */
  veCircle(v, P, p) {
    const [cx, cy] = v.ap(p.x, p.y, 0), sq = v.sq, age = p.age, fr = Math.floor(age * 12), R = p.R;
    const open = easeOut(clamp(age / p.open)), r = p.r * v.aps * open, ry = r * sq;
    if (r < 2) return;
    const a = fadeOut(age / p.life, 0.7), flare = age >= p.flare && age < p.flare + 2 / 12, hero = flare && p.hero;
    // the opening: dark, with a lit lip, widest while the column rises
    const hole = r * 0.62 * clamp((age - p.open * 0.4) / 0.35) * (age > p.close ? Math.max(0.15, 1 - (age - p.close) / 0.6) : 1);
    if (hole > 1.5) P.shade(cx - hole - 1, cy - hole * sq - 1, cx + hole + 1, cy + hole * sq + 1, (x, y) => {
      const dx = (x - cx) / hole, dy = (y - cy) / (hole * sq), d = Math.hypot(dx, dy), e = 1 + (pnoise(Math.atan2(dy, dx), 9, p.seed + (fr >> 2)) - 0.5) * (p.crack ? 0.35 : 0.12);
      if (d > e) return null;
      return d > e - 0.14 ? { c: S(R, d > e - 0.07 ? 0.75 : 0.35), a } : { c: S(R, 0), a: a * 0.8 };
    }, 0, "mix");
    if (p.crack) {
      // grave cracks running out from the opening, jagged, their lips lit from below
      for (let i = 0; i < p.n; i++) {
        let q = (i / p.n) * TAU + hash(i, p.seed) * 0.5, x = cx + Math.cos(q) * hole * 0.9, y = cy + Math.sin(q) * hole * 0.9 * sq;
        const L = r * (0.75 + 0.5 * hash(i, p.seed, 1)) * open, steps = Math.ceil(L / 3);
        for (let k = 0; k < steps; k++) {
          q += (hash(i, k, p.seed) - 0.5) * 0.9;
          const nx = x + Math.cos(q) * 3, ny = y + Math.sin(q) * 3 * sq;
          P.line(x, y, nx, ny, INK, 1, a);
          P.line(x, y + 1, nx, ny + 1, S(R, flare ? 1 : 0.7 - k / steps * 0.3), 0, a);
          x = nx; y = ny;
        }
      }
      P.ellipse(cx, cy, r, ry, (q) => (pnoise(q, 14, p.seed) < 0.45 ? null : { c: S(R, 0.62), a: a * 0.75 }), 0);
      return;
    }
    const lit = (t) => (hero ? WHITE : flare ? S(R, 1) : S(R, t));
    P.ellipse(cx, cy, r, ry, () => ({ c: lit(0.95), a }), 1);
    P.ellipse(cx, cy, r - 2, (r - 2) * sq, () => ({ c: S(R, 0.55), a }), 1);
    P.ellipse(cx, cy, r * 0.8, r * 0.8 * sq, (q) => (Math.floor((q / TAU) * r * 0.9 - age * 6) % 4 === 3 ? null : { c: lit(0.85), a }), 1);
    const rot = age * 0.6 * (p.spin ?? 1);
    for (let i = 0; i < p.n; i++) {
      const q = rot + ((i + 0.5) * TAU) / p.n, gx = Math.round(cx + Math.cos(q) * r * 0.9), gy = Math.round(cy + Math.sin(q) * r * 0.9 * sq);
      glyph3(P, GLYPHS[(i + p.seed + (fr >> 3)) % GLYPHS.length], gx, gy, flare || (fr + i) % 7 === 0 ? S(R, 1) : S(R, 0.82), a);
    }
    for (let i = 0; i < 6; i++) {
      const q0 = -rot + (i * TAU) / 6, q1 = -rot + ((i + 2) * TAU) / 6;
      P.line(cx + Math.cos(q0) * r * 0.8, cy + Math.sin(q0) * r * 0.8 * sq, cx + Math.cos(q1) * r * 0.8, cy + Math.sin(q1) * r * 0.8 * sq, null, 0, a, (f) => (f < 0.18 || f > 0.82 ? lit(0.9) : S(R, 0.62)));
    }
  },

  /** Summon: the creature, gathered out of particles, then solid, then cooling as the real one takes its place. */
  veForm(v, P, p) {
    const top = v.kind === "top", G = v.aps, age = p.age, R = p.R, s = p.size, h = p.h;
    const u = clamp(age / p.form) * (p.fail ? Math.min(1, 0.6) : 1), solid = !p.fail && age >= p.form;
    const cool = solid ? clamp((age - p.form - 0.2) / 0.6) : 0, hero = p.hero && solid && age < p.form + 2 / 12;
    const a = fadeOut(age / p.life, 0.72) * (p.fail && age > p.form ? Math.max(0, 1 - (age - p.form) / 0.3) : 1);
    if (a <= 0.02) return;
    const rise = p.rise ? easeOut(clamp(age / (p.form * 1.1))) : 1, [bx, by] = v.ap(p.x, p.y, 0), seed = p.seed;
    const pulse = solid ? Math.exp(-(age - p.form) * 7) : 0;
    const paint = (k, edge, lit, ix, iy) => {
      const hv = hash(ix, iy, seed);
      if (!solid) {
        if (hv > u) return null;
        return { c: hv > u - 0.14 ? S(R, 1) : edge ? S(R, 0.9) : S(R, 0.68), a: a * 0.9 };
      }
      if (hero) return WHITE;
      if (k === 3) return { c: S(R, 1), a };
      const t = edge ? (lit ? 0.95 : 0.55) : lerp(0.72, 0.34, cool) + (lit ? 0.08 : 0) + pulse * 0.25;
      return { c: S(R, edge ? t - cool * 0.2 : t), a };
    };
    if (top) {
      const fn = SILT[p.sil] ?? SILT.human, sc = p.rise ? lerp(0.3, 1, rise) : 1, rr = 0.55 * s * G;
      P.shade(bx - rr, by - rr, bx + rr, by + rr, (x, y, ix, iy) => {
        const dx = (x - bx) / G / sc, dy = (y - by) / G / sc, k = fn(dx, dy, s, h, age);
        if (!k) return null;
        const st = 1 / G / sc, edge = !fn(dx + st, dy, s, h, age) || !fn(dx - st, dy, s, h, age) || !fn(dx, dy + st, s, h, age) || !fn(dx, dy - st, s, h, age);
        return paint(k, edge, !fn(dx - st, dy - st, s, h, age), ix, iy);
      }, 2);
      return;
    }
    const fn = SIL[p.sil] ?? SIL.human, sink = (1 - rise) * 1.12 * h;
    P.shade(bx - 0.6 * s * G, by - (1.1 * h - sink) * G - 2, bx + 0.6 * s * G, by, (x, y, ix, iy) => {
      const dx = (x - bx) / G, up = (by - y) / G + sink, k = fn(dx, up, s, h, age);
      if (!k) return null;
      const st = 1 / G, edge = !fn(dx + st, up, s, h, age) || !fn(dx - st, up, s, h, age) || !fn(dx, up + st, s, h, age) || !fn(dx, up - st, s, h, age);
      return paint(k, edge, !fn(dx - st, up + st, s, h, age), ix, iy);
    }, 2);
  },

  /** Summon: a contracting ring on the floor (and the drain's gulp). */
  veGulp(v, P, p) {
    const u = clamp(p.age / p.life), [cx, cy] = v.ap(p.x, p.y, 0), r = lerp(p.r0, p.r1, easeOut(u)) * v.aps;
    if (r < 1.5) return;
    for (let k = 0; k < 2; k++) P.ellipse(cx, cy, r + k, (r + k) * v.sq, () => ({ c: S(p.R, k ? 0.6 : u < 0.3 ? 1 : 0.9), a: 1 - u * u }), 1);
  },

  /** Darkness: a dome of dark spreading over the floor, its rim ragged and faintly lit, slow swirls inside. */
  veDome(v, P, p) {
    const [cx, cy] = v.ap(p.x, p.y, 0), age = p.age, fr = Math.floor(age * 12), R = p.R, sq = v.sq;
    const r = p.r * v.aps * easeOut(clamp(age / p.spread)), ry = r * sq;
    if (r < 2) return;
    const a = fadeOut(age / p.life, 0.75) * Math.min(1, age / 0.1);
    // the ragged rim, sampled once per frame round the circle rather than per pixel
    const N = 72, rim = p._rim ??= new Float32Array(N), key = fr >> 1;
    if (p._k !== key) { p._k = key; for (let i = 0; i < N; i++) rim[i] = 0.92 + (pnoise((i / N) * TAU + age * 0.4, 13, p.seed + (fr >> 2)) - 0.5) * 0.2; }
    const ink = { c: S(R, 0), a: a * 0.75 }, ripple = { c: S(R, 0.14), a: a * 0.75 }, band = { c: S(R, 0.08), a: a * 0.8 }, lip = { c: S(p.RR ?? R, 0.7), a };
    P.shade(cx - r * 1.03, cy - ry * 1.03, cx + r * 1.03, cy + ry * 1.03, (x, y) => {
      const dx = (x - cx) / r, dy = (y - cy) / Math.max(1, ry), d2 = dx * dx + dy * dy;
      if (d2 > 1.06) return null;
      if (d2 < 0.6) return d2 > 0.06 && Math.floor(Math.sqrt(d2) * 6 + age * 1.5) % 3 === 0 ? ripple : ink;
      const d = Math.sqrt(d2), e = rim[Math.floor(((Math.atan2(dy, dx) / TAU + 1) % 1) * N)];
      if (d > e) return null;
      return d > e - 1.3 / r ? lip : d > e - 0.12 ? band : ink;
    }, 0, "mix");
  },

  /** Darkness, standing: the dome's cap dims everything under it; from the side it is a translucent hemisphere. */
  veDomeCap(v, P, p) {
    const [cx, cy] = v.ap(p.x, p.y, 0), age = p.age, R = p.R, r = p.r * v.aps * easeOut(clamp(age / p.spread));
    if (r < 3) return;
    const a = (p.ka ?? 0.5) * fadeOut(age / p.life, 0.75) * Math.min(1, age / 0.2);
    if (v.kind === "top") {
      P.shade(cx - r, cy - r, cx + r, cy + r, (x, y) => (Math.hypot(x - cx, y - cy) < r * 0.88 ? { c: S(R, 0), a } : null), 0, "mix");
      return;
    }
    const ry = r * v.sq, H = r * 0.92;
    P.shade(cx - r, cy - H - 1, cx + r, cy + ry, (x, y) => {
      const dx = (x - cx) / r, up = (cy - y) / H, d = up > 0 ? Math.hypot(dx, up) : Math.hypot(dx, (y - cy) / ry);
      if (d > 1) return null;
      if (up > 0 && d > 1 - 1.5 / r) return { c: S(p.RR ?? R, 0.7), a: Math.min(1, a * 1.4) };
      if (up > 0.55 && Math.abs(dx + 0.35) < 0.12 && d > 0.7) return { c: S(p.RR ?? R, 0.55), a };
      return { c: S(R, 0), a };
    }, 0, "mix");
  },

  /** Mist: a fog bank, truly translucent, its lobes rolling round each other, lit on top. */
  veFog(v, P, p) {
    const u = clamp(p.age / p.life), [cx, cy] = v.ap(p.x, p.y, p.z), R = p.R;
    const rr = p.r * (0.6 + 0.55 * easeOut(Math.min(1, u * 2))), a = (p.ka ?? 0.5) * Math.min(1, p.age / 0.35) * fadeOut(u, 0.6);
    if (a < 0.05) return;
    const rot = p.age * p.spin, L = p.lobes.map(([ox, oy, sc], i) => {
      const q = Math.atan2(oy, ox) + rot * (i % 2 ? 1 : -0.7), d = Math.hypot(ox, oy);
      return [cx + Math.cos(q) * d * rr, cy + Math.sin(q) * d * rr * 0.6, rr * sc];
    });
    P.shade(cx - rr * 1.9, cy - rr * 1.5, cx + rr * 1.9, cy + rr * 1.5, (x, y) => {
      for (const [lx, ly, lr] of L) {
        const dx = x - lx, dy = y - ly;
        if (dx * dx + dy * dy > lr * lr) continue;
        const t = (-dx * 0.5 - dy * 0.85) / lr > 0.35 ? 0.78 : dy / lr > 0.4 ? 0.42 : 0.6;
        return { c: S(R, t), a };
      }
      return null;
    }, 0, "mix");
  },

  /** Illusion: an image built out of shimmering scanlines, bottom to top, glitching as it holds; it can shatter. */
  veImage(v, P, p) {
    const top = v.kind === "top", G = v.aps, age = p.age, fr = Math.floor(age * 12), R = p.R, R2 = p.R2, s = p.size, h = p.h;
    const scan = clamp(age / p.form), brk = p.brk && age > p.brk ? clamp((age - p.brk) / 0.25) : 0;
    const a = fadeOut(age / p.life, 0.7) * (1 - brk);
    if (a <= 0.02) return;
    const [bx, by] = v.ap(p.x, p.y, 0);
    const fn = top ? SILT[p.sil] ?? SILT.human : SIL[p.sil] ?? SIL.human;
    const x0 = bx - (top ? 0.5 : 0.42) * s * G, x1 = bx + (top ? 0.5 : 0.42) * s * G;
    const y0 = top ? by - 0.5 * s * G : by - 1.05 * h * G, y1 = top ? by + 0.5 * s * G : by;
    const H = y1 - y0;
    for (let y = Math.floor(y0); y <= y1; y++) {
      const f = (y1 - y) / H;
      if (f > scan + 0.02) continue;
      const g = hash(y >> 1, fr, p.seed), sh = g < (scan < 1 ? 0.25 : 0.12) ? Math.round((g - 0.1) * 36) : 0, bar = scan < 1 && Math.abs(f - scan) < 0.035;
      for (let x = Math.floor(x0); x <= x1; x++) {
        const dx = (x - bx) / G, k = top ? fn(dx, (y - by) / G, s, h, age) : fn(dx, (by - y) / G, s, h, age);
        if (!k) continue;
        const X = x + sh + (brk ? Math.round((hash(x, y, p.seed) - 0.5) * brk * 24) : 0);
        if (bar) { P.dot(X, y, S(R, 1), a, 2); continue; }
        const e = top ? !fn((x + 1 - bx) / G, (y - by) / G, s, h, age) || !fn((x - 1 - bx) / G, (y - by) / G, s, h, age) : !fn((x + 1 - bx) / G, (by - y) / G, s, h, age) || !fn((x - 1 - bx) / G, (by - y) / G, s, h, age);
        if (e || k === 3) P.mix(X, y, S(R, sh ? 1 : 0.95), a);
        else P.mix(X, y, (y + fr) % 3 === 0 ? S(R2, 0.82) : S(R, sh ? 0.85 : 0.6), a * (p.ka ?? 0.55));
      }
    }
  },
}, { flat: ["veCircle", "veGulp", "veDome"] });

/* ── helpers ─────────────────────────────────────────────────────────── */

const outOf = (s, T) => T?.outcome ?? s.spec.outcome ?? "neutral";
/** Extent by outcome: a crit is the skill's ×1.4, a failure still reads at most of its size. */
const GAIN = Object.freeze({ crit: 1.4, hit: 1, neutral: 1, miss: 0.85 });
const slugOf = (s) => String(s.spec.slug ?? "").toLowerCase();
const traitsOf = (s) => new Set(Array.isArray(s.spec.traits) ? s.spec.traits : s.spec.traits instanceof Set ? [...s.spec.traits] : []);
const word = (words) => new RegExp(`(^|-)(${words.join("|")})(-|$)`);
const chest = (X) => [X.x, X.y - 0.06 * (X.size ?? 1), 0.62 * (X.h ?? 1)];

/** Every creature an archetype lands on; with an area and nobody in it, creature-sized stand-ins (forms.mjs `subjects`). */
function subjects(s, ctx) {
  if (ctx.targets.length) return ctx.targets;
  if (ctx.area) {
    const got = areaPoints(areaGeom(ctx.area), 4, () => s.R()).pts;
    return (got.length ? got : [{ x: ctx.area.x, y: ctx.area.y }]).map((p) => ({ x: p.x, y: p.y, size: 1, h: 1, id: null }));
  }
  return ctx.caster ? [ctx.caster] : [{ x: 0, y: 0, size: 1, h: 1, id: null }];
}

/** Streaks racing in to a point from a ring: power drawn in (the anticipation beat). */
function gather(s, R, x, y, z, rad, n, life = 0.26) {
  for (let i = 0; i < n; i++) {
    const q = s.rand(0, TAU), d = rad * s.rand(0.8, 1.2), px = x + Math.cos(q) * d, py = y + Math.sin(q) * d, pz = Math.max(0.05, z + s.rand(-0.3, 0.5)), L = life * s.rand(0.85, 1.15);
    s.add({ k: "streak", x: px, y: py, z: pz, vx: (x - px) / L, vy: (y - py) / L, vz: (z - pz) / L, life: L, R, wait: s.rand(0, 0.08), minor: i > n / 2, update(p, _s, dt) { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; } });
  }
}

/** Radial sparks off a point. */
function sparks(s, R, x, y, z, n, sp, minorFrom = 0) {
  for (let i = 0; i < n; i++) {
    const q = s.rand(0, TAU), v = s.rand(sp * 0.5, sp);
    s.add({ k: "spark", x, y, z, vx: Math.cos(q) * v, vy: Math.sin(q) * v * 0.7, vz: s.rand(-0.5, 1.6), g: 3, drag: 2.5, life: s.rand(0.22, 0.45), R, minor: i >= minorFrom });
  }
}

/** Ground dust kicked out in a ring (translucent smoke, fading). */
function dust(s, R, x, y, rad, n, sz = 1, tone = 0.5) {
  for (let i = 0; i < n; i++) {
    const q = (i / n) * TAU + s.rand(-0.2, 0.2), sp = s.rand(1.4, 2.6) * Math.sqrt(sz);
    s.add({ k: "smoke", x: x + Math.cos(q) * rad, y: y + Math.sin(q) * rad * 0.8, z: 0.03, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp * 0.8, vz: 0.12, drag: 3.2, r: s.rand(2.2, 3.2) * Math.sqrt(sz), life: s.rand(0.45, 0.7), lobes: lobes(s), R, tone, minor: i % 3 === 2 });
  }
}

/* ── conceal ─────────────────────────────────────────────────────────── */

const DARK_RX = word(["darkness", "darken", "darkened", "shadow", "shadows", "umbral", "night", "nightfall", "eclipse", "blackout", "gloom", "dusk", "shadowy"]);
const MIST_RX = word(["mist", "mists", "fog", "fogs", "foggy", "haze", "smoke", "smokescreen", "steam", "vapor", "vapour", "murk", "obscuring", "cloud", "clouds"]);
const MIRROR_RX = word(["mirror", "mirrors", "duplicate", "duplicates", "double", "doubles", "decoy", "decoys", "multiply", "image", "images", "simulacrum"]);
const BLUR_RX = word(["blur", "blurred", "blurring", "displacement", "displace", "afterimage", "afterimages", "mislead", "shimmer", "flicker"]);

/** Where a concealing area sits: a disc for every shape (a cone or line by its middle). */
function areaDisc(A) {
  const G = areaGeom(A);
  if (G.shape === "cone") return { x: G.x + Math.cos(G.dir) * G.len * 0.55, y: G.y + Math.sin(G.dir) * G.len * 0.55, r: G.len * 0.5 };
  if (G.shape === "line") return { x: G.x + Math.cos(G.dir) * G.len * 0.5, y: G.y + Math.sin(G.dir) * G.len * 0.5, r: G.len * 0.5 };
  return { x: G.x, y: G.y, r: G.r };
}

function darkness(s, M, ctx) {
  const R = M.dark ? M.R : RAMP.shadow, DR = deep(R), LR = M.dark || plain(M) ? RAMP.light : M.R, t0 = ctx.t0, m = 0.85 + 0.15 * s.m;
  const spots = ctx.area ? [{ ...areaDisc(ctx.area), Ts: ctx.targets }]
    : subjects(s, ctx).map((T) => ({ x: T.x, y: T.y, r: (T === ctx.caster && ctx.self ? 1.5 : 1.15) * (T.size ?? 1) * m, Ts: T.id ? [T] : [] }));
  let end = t0;
  spots.forEach((D, i) => {
    const at = t0 + i * 0.08, life = 2.8, spread = 0.75, crit = outOf(s, D.Ts[0]) === "crit", rr = D.r * (crit ? 1.15 : 1);
    s.at(at, (s2) => {
      // the dark gathers in to a point, then floods out
      gather(s2, LR, D.x, D.y, 0.4, rr * 0.9, 14, 0.22);
      s2.add({ k: "veGulp", x: D.x, y: D.y, r0: rr * 0.9, r1: 0.1, life: 0.24, R, update: still });
      s2.light(D.x, D.y, 0.4, 1.2, S(R, 0.85), 0.5, 0.25);
    });
    s.at(at + 0.24, (s2) => {
      s2.add({ k: "veDome", x: D.x, y: D.y, r: rr, spread, life, R: DR, RR: R, seed: s2.seedInt() % 97, update: still });
      s2.add({ k: "veDomeCap", x: D.x, y: D.y, r: rr, spread, life, ka: 0.45, R: DR, RR: R, update: still });
      s2.add({ k: "ring", x: D.x, y: D.y, r: rr * 1.05, life: 0.7, R, broken: true, seed: 4, update: still });
      s2.add({ k: "ring", x: D.x, y: D.y, r: rr * 0.6, life: 0.5, R, seed: 9, update: still });
      for (const T of D.Ts) {
        s2.add({ k: "veBody", x: T.x, y: T.y, size: T.size, h: T.h, R: DR, tone: 0, rim: 0.5, ka: 0.5, inT: 0.4, life: life - 0.2, update: still });
        s2.hit(T.id, 0.3, { x: T.x, y: T.y - 1 }, R);
      }
      if (crit) s2.crit(); else s2.shake = Math.max(s2.shake, 0.5);
      // wisps of dark curl up off the ragged rim as it spreads
      s2.emit(s2.t, s2.t + life - 0.6, (s3, u, dt) => {
        const cur = rr * easeOut(clamp((s3.t - at - 0.24) / spread));
        for (let k = s3.count(26 * Math.sqrt(rr), dt); k > 0; k--) {
          const q = s3.rand(0, TAU), d = cur * s3.rand(0.82, 0.95);
          s3.add({ k: "wisp", s: s3.R() < 0.4 ? 3 : 2, x: D.x + Math.cos(q) * d, y: D.y + Math.sin(q) * d, z: 0.05, vx: Math.cos(q) * 0.25, vy: Math.sin(q) * 0.25, vz: s3.rand(0.3, 0.7), drag: 1.2, life: s3.rand(0.5, 0.9), R: DR, minor: k > 1 });
        }
        // motes of light drift in from outside and are swallowed at the rim
        for (let k = s3.count(24 * Math.sqrt(rr), dt * (1 - u * 0.6)); k > 0; k--) {
          const q = s3.rand(0, TAU), d0 = Math.max(cur, 0.5) * s3.rand(1.15, 1.5), d1 = Math.max(cur, 0.5) * 0.86, sp = s3.rand(0.9, 1.6), life2 = (d0 - d1) / sp;
          s3.add({ k: "mote", plus: true, x: D.x + Math.cos(q) * d0, y: D.y + Math.sin(q) * d0, z: s3.rand(0.15, 0.9), vx: -Math.cos(q) * sp, vy: -Math.sin(q) * sp, life: life2, R: LR, minor: k > 1, update(p, _s, dt2) { p.x += p.vx * dt2; p.y += p.vy * dt2; } });
        }
      });
      s2.light(D.x, D.y, 0.3, rr * 1.3, S(R, 0.85), 0.3, life, { swell: true });
    });
    end = Math.max(end, at + 0.24 + life);
  });
  s.phases.push("conceal: darkness gathers, floods out as a dome, light is swallowed at its rim");
  s.period = end + 0.3;
}

function mist(s, M, ctx) {
  const R = plain(M) || M.material === "illusion" ? RAMP.air : pale(M.R), t0 = ctx.t0, m = 0.85 + 0.15 * s.m;
  const D = ctx.area ? areaDisc(ctx.area) : null;
  let pts;
  if (ctx.area) {
    const got = areaPoints(areaGeom(ctx.area), 12, () => s.R()).pts;
    pts = (got.length ? got : [{ x: D.x, y: D.y }]).map((p) => ({ x: p.x, y: p.y, sz: 1.2 }));
  } else pts = subjects(s, ctx).flatMap((T) => [0, 1, 2, 3, 4].map((k) => ({ x: T.x + Math.cos(k * 1.26) * 0.45 * T.size, y: T.y + Math.sin(k * 1.26) * 0.35 * T.size, sz: T.size })));
  const cx = D?.x ?? pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = D?.y ?? pts.reduce((a, p) => a + p.y, 0) / pts.length;
  s.at(t0, (s2) => {
    s2.light(cx, cy, 0.4, (D?.r ?? 1) * 1.6, S(R, 0.85), 0.35, 2.6, { swell: true });
    s2.add({ k: "ring", x: cx, y: cy, r: (D?.r ?? 1) * 0.9, life: 0.8, R, broken: true, seed: 3, update: still });
  });
  pts.forEach((p, i) => {
    const at = t0 + 0.05 + (Math.hypot(p.x - cx, p.y - cy) / Math.max(1, D?.r ?? 1)) * 0.35 + (i % 3) * 0.06;
    s.at(at, (s2) => {
      for (let k = 0; k < 2; k++) {
        const q = s2.rand(0, TAU), sp = s2.rand(0.12, 0.3), ox = p.x - cx, oy = p.y - cy, ol = Math.hypot(ox, oy) || 1;
        s2.add({ k: "veFog", x: p.x + Math.cos(q) * 0.2, y: p.y + Math.sin(q) * 0.15, z: s2.rand(0.1, 0.45), vx: (ox / ol) * sp + s2.rand(-0.1, 0.1), vy: (oy / ol) * sp * 0.8, r: s2.rand(13, 17) * Math.sqrt(p.sz) * m * (k ? 0.7 : 1), life: s2.rand(2.3, 2.9), spin: s2.rand(0.4, 0.9) * (k ? 1 : -1), ka: k ? 0.3 : 0.4, lobes: lobes(s2), R, wait: k * 0.15, minor: k === 1 && i % 2 === 1, update(q2, _s, dt) { q2.x += q2.vx * dt; q2.y += q2.vy * dt; } });
      }
      // beads of moisture glinting in the bank
      for (let k = 0; k < 3; k++) s2.add({ k: "mote", x: p.x + s2.rand(-0.4, 0.4), y: p.y + s2.rand(-0.3, 0.3), z: s2.rand(0.2, 0.7), vx: s2.rand(-0.2, 0.2), vz: s2.rand(-0.1, 0.1), life: s2.rand(1, 1.8), R, wait: s2.rand(0.2, 1.2), minor: true });
    });
  });
  s.phases.push("conceal: fog banks roll out across the area");
  s.period = t0 + 3.4;
}

function doubles(s, M, ctx, mirror) {
  const R = plain(M) ? RAMP.illusion : M.R, DR = deep(R), t0 = ctx.t0;
  let end = t0;
  subjects(s, ctx).forEach((T, i) => {
    const at = t0 + i * 0.06, o = outOf(s, T), g = GAIN[o], crit = o === "crit", sz = T.size ?? 1, life = crit ? 2.6 : 2.2;
    s.at(at, (s2) => {
      s2.add({ k: "flash", x: T.x, y: T.y, z: 0.55 * T.h, life: (crit ? 2 : 1) / 12, r: 0.4 * sz * s2.spec.aps * g, R, update: still });
      s2.add({ k: "ring", x: T.x, y: T.y, r: 0.85 * sz * g, life: 0.5, R, seed: 5, update: still });
      s2.light(T.x, T.y, 0.6, 1.6 * sz * g, S(R, 0.85), 0.75, 0.5);
      s2.hit(T.id, 0.45, { x: T.x - 1, y: T.y }, R);
      if (crit) s2.crit();
      if (mirror) {
        const n = crit ? 4 : 3, q0 = s2.rand(0, TAU);
        for (let k = 0; k < n; k++) {
          const qk = q0 + (k * TAU) / n;
          s2.add({ k: "veBody", x: T.x, y: T.y, size: sz, h: T.h, R: k % 2 ? DR : R, tone: 0.62, rim: 0.95, ka: 0.6, flick: 0.22, seed: k + 3, life, from: 0.75, update(p) {
            const d = 0.7 * sz * g * easeOut(clamp(p.age / 0.35)), q = qk + p.age * 0.8;
            p.x = T.x + Math.cos(q) * d; p.y = T.y + Math.sin(q) * d * 0.75;
            if (p.age > life - 0.6) p.flick = 0.6;
          } });
          // a streak out along the split
          s2.add({ k: "streak", x: T.x, y: T.y, z: 0.5 * T.h, vx: Math.cos(qk) * 3.4 * sz, vy: Math.sin(qk) * 2.6 * sz, life: 0.2, R, update(p, _s, dt) { p.x += p.vx * dt; p.y += p.vy * dt; } });
        }
      } else {
        for (const side of [-1, 1]) s2.add({ k: "veBody", x: T.x, y: T.y, size: sz, h: T.h, R: side < 0 ? R : DR, tone: 0.6, rim: 0.95, ka: 0.6, flick: 0.35, seed: side + 7, life, from: 0.75, update(p) {
          const d = (0.16 + 0.07 * Math.sin(p.age * 23 + side)) * sz * g * Math.min(1, p.age / 0.15);
          p.x = T.x + side * d; p.y = T.y + 0.04 * Math.sin(p.age * 17) * side;
        } });
      }
      // the shiver: streaks off both flanks while it holds
      s2.emit(s2.t, s2.t + life - 0.5, (s3, _u, dt) => {
        for (let k = s3.count((mirror ? 10 : 22) * sz, dt); k > 0; k--) {
          const side = s3.R() < 0.5 ? -1 : 1;
          s3.add({ k: s3.R() < 0.3 ? "glint" : "streak", x: T.x + side * s3.rand(0.3, 0.6) * sz, y: T.y + s3.rand(-0.25, 0.25) * sz, z: s3.rand(0.1, 1) * T.h, vx: side * s3.rand(2, 4), life: s3.rand(0.12, 0.25), R, minor: true, update(p, _s, dt2) { if (p.k === "streak") p.x += p.vx * dt2; } });
        }
      });
    });
    end = Math.max(end, at + life);
  });
  s.phases.push(mirror ? "conceal: the body splits into circling ghost doubles" : "conceal: the body shivers into jittering doubles");
  s.period = end + 0.4;
}

function image(s, M, ctx) {
  const R = plain(M) ? RAMP.illusion : M.R, R2 = R === RAMP.illusion ? RAMP.mental : RAMP.illusion, t0 = ctx.t0;
  let end = t0;
  // an area conjures one image at its point; otherwise each creature takes one (a disguise)
  const D = ctx.area ? areaDisc(ctx.area) : null;
  const list = D ? [{ x: D.x, y: D.y, size: clamp(D.r * 0.7, 1, 1.6), h: clamp(D.r * 0.7, 1, 1.6), id: null, outcome: ctx.targets[0]?.outcome }] : subjects(s, ctx);
  list.forEach((T, i) => {
    const at = t0 + i * 0.07, o = outOf(s, T), g = GAIN[o], miss = o === "miss", crit = o === "crit", sz = (T.size ?? 1) * (T.id ? 1 : 1.1), life = crit ? 2.4 : 2;
    s.at(at, (s2) => {
      for (let k = 0; k < 4; k++) { const q = (k / 4) * TAU + 0.4; s2.add({ k: "smoke", x: T.x + Math.cos(q) * 0.2 * sz, y: T.y + Math.sin(q) * 0.15 * sz, z: s2.rand(0.1, 0.5) * T.h, vx: Math.cos(q) * 1.6, vy: Math.sin(q) * 1, vz: 0.25, drag: 3, r: s2.rand(2.5, 3.5) * Math.sqrt(sz), life: s2.rand(0.3, 0.42), lobes: lobes(s2), R, tone: 0.5, minor: k > 1 }); }
      if (!T.id) s2.add({ k: "glyph", x: T.x, y: T.y, r: 0.7 * sz, life: life, R, spin: 0.6, update: still });
      s2.add({ k: "veImage", x: T.x, y: T.y, size: sz * g, h: T.h * g, sil: "human", form: 0.5, life, brk: miss ? 0.85 : 0, ka: T.id ? 0.5 : 0.65, R, R2, seed: s2.seedInt() % 97, wait: 0.12, update: still });
      s2.light(T.x, T.y, 0.6, 1.5 * sz * g, S(R, 0.85), 0.6, 0.8, { swell: true });
      s2.add({ k: "ring", x: T.x, y: T.y, r: 0.75 * sz * g, life: 0.6, R, seed: 2, wait: 0.12, update: still });
      // sparkles climb with the scan
      for (let k = 0; k < 12; k++) s2.add({ k: "glint", x: T.x + s2.rand(-0.4, 0.4) * sz, y: T.y + s2.rand(-0.15, 0.15), z: (k / 12) * 1.05 * T.h, life: 5 / 12, R, wait: 0.12 + (k / 12) * 0.5, minor: k % 2 === 1, update: still });
    });
    s.at(at + 0.62, (s2) => {
      s2.add({ k: "star", x: T.x, y: T.y, z: 1.05 * T.h, L: Math.round(5 * Math.sqrt(sz) * g), life: 3 / 12, R, update: still });
      s2.light(T.x, T.y, 0.8, 1.2 * sz, S(R, 0.85), 0.7, 0.3);
      if (crit) s2.crit();
      s2.hit(T.id, 0.3, { x: T.x, y: T.y - 1 }, R);
      // the image holds, glitter drifting off it
      s2.emit(s2.t, s2.t + life - 1, (s3, _u, dt) => { for (let k = s3.count(8 * sz, dt); k > 0; k--) s3.add({ k: "mote", plus: s3.R() < 0.3, x: T.x + s3.rand(-0.4, 0.4) * sz, y: T.y + s3.rand(-0.2, 0.2), z: s3.rand(0.2, 1) * T.h, vz: 0.3, life: s3.rand(0.6, 1), R: s3.R() < 0.5 ? R : R2, minor: true }); });
    });
    if (miss) s.at(at + 0.12 + 0.85, (s2) => {
      sparks(s2, R, T.x, T.y, 0.6 * T.h, 14, 3, 5);
      for (let k = 0; k < 10; k++) s2.add({ k: "shard", x: T.x + s2.rand(-0.3, 0.3) * sz, y: T.y, z: s2.rand(0.2, 1) * T.h, vx: s2.rand(-1.5, 1.5), vz: s2.rand(0, 1), g: 4, drag: 1, bounce: 0.3, life: s2.rand(0.4, 0.7), seed: s2.R(), R, minor: k % 2 === 1 });
    });
    end = Math.max(end, at + 0.12 + life);
  });
  s.phases.push("conceal: a puff, then a shimmering image builds up out of scanlines");
  s.period = end + 0.4;
}

function conceal(s, M, ctx) {
  const slug = slugOf(s), tr = traitsOf(s);
  if (DARK_RX.test(slug) || (tr.has("darkness") && !tr.has("light"))) return darkness(s, M, ctx);
  if (MIST_RX.test(slug)) return mist(s, M, ctx);
  if (MIRROR_RX.test(slug)) return doubles(s, M, ctx, true);
  if (BLUR_RX.test(slug)) return doubles(s, M, ctx, false);
  return image(s, M, ctx);
}

/* ── drain ───────────────────────────────────────────────────────────── */

const SOUL_RX = word(["soul", "souls", "spirit", "essence", "life", "vital", "vitality", "siphon", "wither", "withering", "energy", "enervate", "enervation", "vampiric", "leech"]);
const SEEP_RX = word(["poison", "poisoned", "poisonous", "venom", "venomous", "toxin", "toxic", "fever", "plague", "disease", "diseased", "sickness", "rot", "rotting", "pox", "blight", "affliction", "filth", "infect", "infection", "infectious", "contagion", "contagious", "sting", "envenom", "apply", "wasting", "ague", "lethargy", "taint", "corruption"]);

/** The droplets: orbs that burst out of the source, hang, then whip home along the stream. */
function droplets(s, R, src, sink, n, { dark, miss, amp, gulp, sz, wait = 0 }) {
  for (let i = 0; i < n; i++) {
    const q = s.rand(0, TAU), d = s.rand(0.25, 0.5) * sz, hover = 0.22 + i * 0.06 + s.rand(0, 0.04), dur = 0.32 + Math.hypot(sink[0] - src[0], sink[1] - src[1]) * 0.025;
    const off = [Math.cos(q) * d, Math.sin(q) * d * 0.6, s.rand(-0.1, 0.35) * sz], ph = (i % 2) * Math.PI, bob = s.rand(0, TAU);
    s.add({
      k: "orb", x: src[0], y: src[1], z: src[2], r: s.rand(3, 4.4) * Math.sqrt(sz), life: hover + dur + 0.02, R, dark, glow: true, wait: wait + i * 0.015,
      update(p, s2, dt) {
        const age = p.age;
        if (age < hover) {
          const f = easeOut(clamp(age / 0.18));
          p.x = src[0] + off[0] * f; p.y = src[1] + off[1] * f; p.z = src[2] + off[2] * f + Math.sin(age * 18 + bob) * 0.03; p.tail = null;
          return;
        }
        const u = clamp((age - hover) / dur) ** 1.6, from = [src[0] + off[0], src[1] + off[1], src[2] + off[2]];
        if (miss && u > 0.45) {
          // a resisted drain loses its grip half way: the droplet spills to the floor
          p.update = undefined; p.vx = (sink[0] - src[0]) * 0.4; p.vy = (sink[1] - src[1]) * 0.4; p.vz = 0.5; p.g = 7; p.bounce = 0.2; p.drag = 1.5; p.tail = null; p.life = age + 0.55;
          return;
        }
        const pos = helix(from, sink, u, ph, amp, s2.t), back = helix(from, sink, Math.max(0, u - 0.12), ph, amp, s2.t);
        p.x = pos[0]; p.y = pos[1]; p.z = pos[2]; p.tail = back.slice(0, 3);
        if (u >= 1 && !p.home) { p.home = true; p.life = age; gulp?.(s2, i); }
        if (s2.R() < dt * 30) s2.add({ k: "mote", x: p.x, y: p.y, z: p.z, vz: -0.2, drag: 2, life: 0.3, R, minor: true });
      },
    });
  }
}

/** A gulp at the sink: a small ring, a flush pulse, sparks; the last is the big swallow. */
function swallow(s, M, R, X, k, last, crit) {
  const sz = X.size ?? 1, [cx, cy, cz] = chest(X);
  s.add({ k: "ring", x: X.x, y: X.y, r: 0.55 * sz, life: 0.32, R, seed: 3 + k, update: still });
  sparks(s, R, cx, cy, cz, last ? 12 : 4, 2.4, 3);
  s.light(X.x, X.y, cz, 1.2 * sz, S(R, 0.85), M.dark ? 0.45 : 0.7, 0.25);
  if (!last) return;
  s.add({ k: "veGulp", x: X.x, y: X.y, r0: 1.15 * sz, r1: 0.35 * sz, life: 0.22, R, update: still });
  s.at(s.t + 0.22, (s2) => {
    s2.add({ k: "ring", x: X.x, y: X.y, r: 1.25 * sz, life: 0.5, R, seed: 11, update: still });
    s2.add({ k: "flash", x: cx, y: cy, z: cz, life: (crit ? 2 : 1) / 12, r: 0.42 * sz * s2.spec.aps, R, update: still });
    s2.light(X.x, X.y, cz, 2 * sz, S(R, 0.85), M.dark ? 0.6 : 0.95, 0.55);
    s2.hit(X.id, 0.35, { x: X.x, y: X.y + 1 }, R);
    for (let i = 0; i < 6; i++) s2.add({ k: "mote", plus: i % 2 === 0, x: cx + s2.rand(-0.3, 0.3) * sz, y: cy, z: cz + s2.rand(-0.2, 0.3), vz: s2.rand(0.5, 1), drag: 1.5, life: s2.rand(0.6, 0.9), R, minor: i > 2 });
  });
}

/** The feeder: its body flushes the material's colour and pulses with every gulp. */
function flush(s, R, X, at, life, beats) {
  s.at(at, (s2) => s2.add({ k: "veBody", x: X.x, y: X.y, size: X.size ?? 1, h: X.h ?? 1, R, tone: 0.78, rim: 1, ka: 0.3, life, from: 0.6, update(p) {
    let th = 0;
    for (const b of beats) if (p.age >= b - at) th = Math.max(th, Math.exp(-(p.age - (b - at)) * 6));
    p.ka = 0.25 + 0.45 * th;
  } }));
}

function feed(s, M, ctx, R) {
  const C = ctx.caster, dark = R === RAMP.void || M.dark, m = 0.85 + 0.15 * s.m;
  const srcs = ctx.targets.filter((T) => T !== C);
  const sink = C ? chest(C) : null;
  if (!srcs.length && C) {
    // no target: the drain is drawn up out of the floor round the feeder
    const sz = C.size ?? 1, n = 5, t0 = ctx.t0, beats = [];
    s.at(t0, (s2) => {
      s2.add({ k: "darkpool", x: C.x, y: C.y, r: 1.25 * sz * m, life: 2.2, R, update: still });
      s2.add({ k: "veGulp", x: C.x, y: C.y, r0: 1.6 * sz * m, r1: 0.5 * sz, life: 0.6, R, update: still });
      s2.light(C.x, C.y, 0.3, 1.8 * sz * m, S(R, 0.85), dark ? 0.45 : 0.6, 1.6, { swell: true });
    });
    for (let k = 0; k < n; k++) {
      const q = (k / n) * TAU + 0.4, d = 1.05 * sz * m, src = [C.x + Math.cos(q) * d, C.y + Math.sin(q) * d * 0.8, 0.02], at = t0 + 0.08 + k * 0.07;
      s.at(at, (s2) => {
        s2.add({ k: "veStream", a: src, b: sink, amp: 0.12, turns: 1.2, spin: 6, flow: 1.6, beads: 2, ext: 0.22, hold: 1.0, retract: 0.25, life: 1.3, R, update: still });
        s2.add({ k: "ring", x: src[0], y: src[1], r: 0.3, life: 0.4, R, seed: k, update: still });
        for (let i = 0; i < 4; i++) s2.add({ k: "chunk", x: src[0], y: src[1], z: 0.02, vx: s2.rand(-0.6, 0.6), vy: s2.rand(-0.6, 0.6), vz: s2.rand(0.8, 1.6), g: 5, drag: 1, bounce: 0.2, s: 1, life: 0.6, R: deep(R), minor: i > 1 });
      });
      droplets(s, R, src, sink, 2, { dark, amp: 0.14, sz: 0.8, wait: at, gulp: (s3, i) => { swallow(s3, M, R, C, k * 2 + i, false); } });
      beats.push(at + 0.5);
    }
    flush(s, R, C, t0 + 0.4, 1.8, beats);
    s.at(t0 + 1.25, (s2) => swallow(s2, M, R, C, 99, true, false));
    s.phases.push("drain: drawn up out of the floor into the feeder, a gulp");
    s.period = t0 + 2.9;
    return;
  }
  let end = ctx.t0;
  const k0 = 1 / Math.sqrt(Math.max(1, srcs.length));
  srcs.forEach((T, ti) => {
    const o = outOf(s, T), g = GAIN[o], miss = o === "miss", crit = o === "crit", sz = T.size ?? 1, at = ctx.t0 + ti * 0.08;
    const src = chest(T), to = sink ?? [T.x, T.y - 0.2, 1.8 * (T.h ?? 1)], L = Math.hypot(to[0] - src[0], to[1] - src[1]);
    const [ux, uy] = L > 0.01 ? [(to[0] - src[0]) / L, (to[1] - src[1]) / L] : [-1, 0];
    const n = Math.max(3, Math.round((6 + 2 * s.m + (crit ? 3 : 0)) * k0)), amp = 0.3 * Math.sqrt(sz) * g * m;
    const hold = 1.25 + (crit ? 0.3 : 0), dur = 0.32 + L * 0.025, beats = [];
    s.at(at, (s2) => {
      // the bite: struck and pulled toward the feeder
      s2.hit(T.id, (miss ? 0.6 : 0.9) * g, { x: T.x - ux, y: T.y - uy }, R);
      s2.add({ k: "flash", x: src[0], y: src[1], z: src[2], life: (crit ? 2 : 1) / 12, r: 0.38 * sz * s2.spec.aps * g, R, update: still });
      s2.add({ k: "ring", x: T.x, y: T.y, r: 0.8 * sz * g, life: 0.35, R, seed: 2, update: still });
      sparks(s2, R, src[0], src[1], src[2], crit ? 18 : 10, 3.6, 5);
      s2.light(T.x, T.y, src[2], 2.2 * sz * g, S(R, 0.85), dark ? 0.55 : 0.85, 0.35);
      for (let i = 0; i < 8; i++) s2.add({ k: "drip", x: src[0] + s2.rand(-0.1, 0.1), y: src[1], z: src[2], vx: s2.rand(-1.4, 1.4), vy: s2.rand(-0.6, 0.6), vz: s2.rand(0.4, 1.6), g: 7, drag: 0.8, life: s2.rand(0.4, 0.7), R, minor: i > 3 });
      if (crit) s2.crit(); else s2.shake = Math.max(s2.shake, 0.6);
      s2.add({ k: "darkpool", x: T.x, y: T.y, r: 0.6 * sz * g, life: hold + 0.5, R, update: still });
      // the target pales and shrinks a hair
      if (!miss) s2.add({ k: "veBody", x: T.x, y: T.y, size: sz, h: T.h, R: pale(R), tone: 0.95, rim: 0.35, ka: 0.5, inT: 0.4, life: hold + 0.7, update(p) { p.scale = 1 - 0.12 * easeOut(clamp(p.age / hold)); } });
      // the stream lights the floor along its length
      for (const f of [0.3, 0.65]) { const q = helix(src, to, f, 0, 0, 0); s2.light(q[0], q[1], q[2], 1.1 * Math.sqrt(sz), S(R, 0.85), dark ? 0.35 : 0.55, hold + 0.3, { swell: true }); }
    });
    s.at(at + 0.12, (s2) => s2.add({ k: "veStream", a: src, b: to, amp, turns: 1.6, spin: 7, flow: 1.4, beads: crit ? 5 : 4, ext: 0.22, hold: miss ? 9 : hold, retract: 0.3, brk: miss ? 0.5 : 0, snap: miss ? 0.75 : 0, thick: crit, life: miss ? 1.05 : hold + 0.32, R, update: still }));
    // small motes ride the stream between the droplets
    s.emit(at + 0.2, at + (miss ? 0.75 : hold), (s2, _u, dt) => {
      for (let i = s2.count(40 * Math.sqrt(sz) * g * k0, dt); i > 0; i--) {
        const ph = s2.R() < 0.5 ? 0 : Math.PI, life = s2.rand(0.45, 0.7) * (miss ? 0.5 : 1);
        s2.add({ k: i % 3 ? "mote" : "drip", x: src[0], y: src[1], z: src[2], life, R, minor: i > 1, update(p, s3) { const pos = helix(src, to, p.age / life * (miss ? 0.5 : 1), ph, amp, s3.t); p.x = pos[0]; p.y = pos[1]; p.z = pos[2]; } });
      }
    });
    if (miss) {
      // it breaks off: the stream snaps, the spill drips, the target shakes it off
      s.at(at + 0.87, (s2) => {
        const mid = helix(src, to, 0.5, 0, amp, s2.t);
        sparks(s2, R, mid[0], mid[1], mid[2], 12, 2.5, 4);
        for (let i = 0; i < 10; i++) s2.add({ k: "drip", x: mid[0] + s2.rand(-0.2, 0.2), y: mid[1], z: mid[2], vx: s2.rand(-0.6, 0.6), vy: s2.rand(-0.3, 0.3), vz: s2.rand(-0.2, 0.6), g: 7, drag: 1, life: 0.6, R, minor: i > 4 });
        s2.add({ k: "ring", x: T.x, y: T.y, r: 1.1 * sz, life: 0.45, R, broken: true, seed: 8, update: still });
        s2.hit(T.id, 0.5, { x: T.x + ux, y: T.y + uy }, R);
        s2.light(mid[0], mid[1], mid[2], 1.2, S(R, 0.85), 0.5, 0.3);
      });
      droplets(s, R, src, to, n, { dark, miss: true, amp, sz, wait: at });
      end = Math.max(end, at + 1.2);
      return;
    }
    const arrive = (i) => at + 0.22 + i * 0.06 + 0.02 + dur;
    for (let i = 0; i < n; i++) beats.push(arrive(i));
    droplets(s, R, src, to, n, { dark, amp, sz, wait: at, gulp: C ? (s3, i) => swallow(s3, M, R, C, i, false) : null });
    if (C) {
      flush(s, R, C, at + 0.3, hold + 1.2, beats);
      s.at(at + hold + 0.25, (s2) => swallow(s2, M, R, C, 99, true, crit));
      s.at(at + 0.3, (s2) => s2.light(C.x, C.y, 0.6 * (C.h ?? 1), 1.6 * (C.size ?? 1), S(R, 0.85), dark ? 0.35 : 0.55, hold + 0.6, { swell: true }));
    }
    end = Math.max(end, at + hold + 0.5);
  });
  s.phases.push(srcs.every((T) => outOf(s, T) === "miss") ? "drain: struck, the stream frays half way and spills" : "drain: struck, droplets hang then whip home along a twisting stream, the feeder flushes and gulps");
  s.period = end + 1.3;
}

function seep(s, M, ctx, R) {
  const C = ctx.caster, m = 0.85 + 0.15 * s.m;
  const subs = ctx.targets.filter((T) => T !== C);
  const list = subs.length ? subs : subjects(s, ctx);
  let end = ctx.t0;
  list.forEach((T, ti) => {
    const o = outOf(s, T), g = GAIN[o], miss = o === "miss", crit = o === "crit", sz = T.size ?? 1;
    let at = ctx.t0 + ti * 0.08;
    const [ex, ey] = C && C !== T ? [C.x - T.x, C.y - T.y] : [-1, 0.4], el = Math.hypot(ex, ey) || 1;
    if (C && C !== T && ctx.hand) {
      // the apply: a thin dark trickle from the hand into the body
      const a = ctx.hand.slice(), b = chest(T), dur = Math.min(0.4, 0.18 + Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.02);
      s.at(at, (s2) => s2.add({ k: "veStream", a, b, amp: 0.05, turns: 2.5, spin: 9, flow: 2, beads: 2, ext: dur, hold: dur + 0.15, retract: 0.15, life: dur + 0.32, R, update: still }));
      at += dur;
    }
    const life = miss ? 1.3 : crit ? 2.5 : 2.1, pulses = miss ? [0.2] : crit ? [0.25, 0.7, 1.15, 1.6] : [0.25, 0.75, 1.25];
    s.at(at, (s2) => {
      s2.add({ k: "veSeep", x: T.x, y: T.y, size: sz * g * m, h: T.h, eu: ex / el, ew: ey / el, n: crit ? 9 : 7, spread: miss ? 0.5 : 0.9, recede: miss ? 0.55 : 0, life, pulses, R, seed: 1 + (s2.seedInt() % 9973), update: still });
      s2.hit(T.id, 0.4 * g, { x: T.x + ex / el, y: T.y + ey / el }, R);
      s2.add({ k: "ring", x: T.x, y: T.y, r: 0.6 * sz, life: 0.35, R, seed: 3, update: still });
      s2.light(T.x, T.y, 0.5 * T.h, 1.3 * sz, S(R, 0.85), M.dark ? 0.35 : 0.5, life, { swell: true });
      if (crit) s2.crit();
    });
    for (const tp of pulses) s.at(at + tp, (s2) => {
      s2.add({ k: "ring", x: T.x, y: T.y, r: 1.0 * sz * g, life: 0.45, R, broken: true, seed: 5 + Math.round(tp * 10), update: still });
      s2.add({ k: "halo", x: T.x, y: T.y, z: 0.1, vz: 0.8, drag: 1.2, life: 0.55, r: 0.4 * sz, R, minor: true });
      s2.light(T.x, T.y, 0.5 * T.h, 1.4 * sz, S(R, 0.85), M.dark ? 0.45 : 0.7, 0.28);
      if (!miss) s2.hit(T.id, 0.25 * g, { x: T.x, y: T.y - 1 }, R);
      for (let k = 0; k < 4; k++) s2.add({ k: "bubble", x: T.x + s2.rand(-0.35, 0.35) * sz, y: T.y + s2.rand(-0.25, 0.25) * sz, life: 0.35, R, wait: k * 0.05, minor: k > 1, update: still });
    });
    // the sickness steams off the body
    s.emit(at + 0.2, at + life - 0.4, (s2, _u, dt) => {
      for (let k = s2.count((miss ? 8 : 18) * sz * g, dt); k > 0; k--) s2.add({ k: k % 2 ? "wisp" : "mote", s: 2, x: T.x + s2.rand(-0.35, 0.35) * sz, y: T.y + s2.rand(-0.25, 0.25) * sz, z: s2.rand(0.2, 0.9) * T.h, vz: s2.rand(0.3, 0.6), drag: 1.2, life: s2.rand(0.5, 0.8), R: k % 2 ? deep(R) : R, minor: k > 1 });
    });
    if (miss) s.at(at + 0.6, (s2) => {
      // resisted: the body spits it back out
      for (let k = 0; k < 12; k++) { const q = (k / 12) * TAU; s2.add({ k: "drip", x: T.x + Math.cos(q) * 0.3 * sz, y: T.y + Math.sin(q) * 0.2 * sz, z: 0.6 * T.h, vx: Math.cos(q) * 1.6, vy: Math.sin(q) * 1, vz: s2.rand(0.4, 1.2), g: 6, drag: 1, life: 0.55, R, minor: k % 2 === 1 }); }
      s2.add({ k: "ring", x: T.x, y: T.y, r: 1.05 * sz, life: 0.45, R, seed: 9, update: still });
      s2.hit(T.id, 0.5, { x: T.x, y: T.y + 1 }, R);
    });
    end = Math.max(end, at + life);
  });
  s.phases.push("drain: a dark seep spreads through the body with sickly pulses");
  s.period = end + 0.4;
}

function drain(s, M, ctx) {
  const slug = slugOf(s), tr = traitsOf(s);
  const seepy = SEEP_RX.test(slug) || tr.has("poison") || tr.has("disease");
  if (seepy) return seep(s, M, ctx, plain(M) ? RAMP.poison : M.R);
  return feed(s, M, ctx, plain(M) ? (SOUL_RX.test(slug) ? RAMP.void : RAMP.bleed) : M.R);
}

/* ── summon ──────────────────────────────────────────────────────────── */

const UNDEAD_RX = word(["undead", "zombie", "zombies", "skeleton", "skeletons", "skeletal", "ghoul", "ghouls", "ghost", "wraith", "animate-dead", "dead", "necromancy", "necromantic", "bone", "bones", "corpse", "grave", "mummy", "lich", "revenant", "shambler", "risen", "raise"]);
const BEAST_RX = word(["animal", "animals", "beast", "beasts", "wolf", "wolves", "bear", "hound", "hounds", "steed", "mount", "familiar", "companion", "swarm", "vermin", "insect", "dragon", "monster", "monsters", "creature", "dinosaur", "cat", "horse", "boar"]);
const ELEMENT_RX = word(["elemental", "elementals", "element", "genie", "efreeti", "djinni", "golem", "construct", "storm", "flame", "wisp", "ooze"]);

function summon(s, M, ctx) {
  const slug = slugOf(s), tr = traitsOf(s);
  const undead = UNDEAD_RX.test(slug) || tr.has("undead") || tr.has("necromancy") || tr.has("death");
  const sil = undead ? "undead" : ELEMENT_RX.test(slug) || tr.has("elemental") ? "elemental" : BEAST_RX.test(slug) || tr.has("animal") ? "beast" : "human";
  const C = ctx.caster, tgt = ctx.targets.find((T) => T !== C) ?? null;
  const at0 = ctx.area ? { x: ctx.area.x, y: ctx.area.y, size: 1, h: 1, outcome: tgt?.outcome } : tgt ?? (C ? { x: C.x + 1.05 * (C.size ?? 1), y: C.y + 0.2, size: 1, h: 1 } : { x: 0, y: 0, size: 1, h: 1 });
  const o = outOf(s, at0), crit = o === "crit", fail = o === "miss" && !!ctx.targets.length && !ctx.self, g = crit ? 1.25 : 1;
  const R = undead ? (plain(M) ? RAMP.void : M.R) : plain(M) ? RAMP.arcane : M.R, DR = deep(R), DIRT = RAMP.earth, Mx = R === M.R ? M : { ...M, R };
  const m = 0.85 + 0.15 * s.m, sz = (ctx.area ? clamp(Math.sqrt(areaGeom(ctx.area).r ?? 1), 1, 1.6) : Math.min(2, at0.size ?? 1)) * m * g;
  const h = (sil === "beast" ? 0.85 : 1.05) * Math.sqrt(sz) * (at0.h ?? 1), X = at0.x, Y = at0.y, rc = 0.85 * sz;
  const t0 = ctx.t0, tRise = t0 + 0.38, tForm = t0 + 0.6, form = 0.85, tLand = tForm + form;
  const life = tLand - t0 + 1.5;
  // the circle opens
  s.at(t0, (s2) => {
    s2.add({ k: "veCircle", x: X, y: Y, r: rc, open: 0.32, flare: tLand - t0, close: tLand - t0 + 0.2, life, n: undead ? 7 : 8, crack: undead, hero: crit, R, seed: s2.seedInt() % 97, update: still });
    gather(s2, R, X, Y, 0.3, rc * 1.6, 18);
    s2.light(X, Y, 0.2, rc * 2.2, S(R, 0.85), M.dark || undead ? 0.4 : 0.6, life - 0.4, { swell: true });
    if (undead) s2.shake = Math.max(s2.shake, 0.8);
  });
  // the column rises (for undead, the ground heaves and throws grave dirt instead)
  s.at(tRise, (s2) => {
    s2.add({ k: "beam", x: X, y: Y, h: (undead ? 1.6 : 2.6) * h, w: (undead ? 3 : 5) * Math.sqrt(sz), life: 0.62, R: undead ? DR : R, update: still });
    s2.add({ k: "ring", x: X, y: Y, r: rc * 1.15, life: 0.5, R, seed: 6, update: still });
    s2.light(X, Y, 0.8, rc * 1.8, S(R, 0.9), M.dark || undead ? 0.5 : 0.85, 0.4);
  });
  s.emit(tRise, tLand, (s2, u, dt) => {
    if (!undead) Mx.mod.trail?.(s2, Mx, { x: X + s2.rand(-0.18, 0.18) * Math.sqrt(sz), y: Y + s2.rand(-0.1, 0.1), z: 0.1 + u * 1.8 * h, dt });
    for (let i = s2.count(46 * Math.sqrt(sz), dt); i > 0; i--) s2.add({ k: i % 4 ? "mote" : "spark", x: X + s2.rand(-0.35, 0.35) * rc, y: Y + s2.rand(-0.25, 0.25) * rc, z: 0.05, vx: 0, vy: 0, vz: s2.rand(1.6, 2.8), g: i % 4 ? 0 : 1, drag: 0.6, life: s2.rand(0.5, 0.75), R, minor: i > 1 });
    if (undead) for (let i = s2.count(22 * Math.sqrt(sz), dt * (1 - u)); i > 0; i--) {
      const q = s2.rand(0, TAU), d = s2.rand(0.1, 0.55) * rc;
      s2.add({ k: "chunk", x: X + Math.cos(q) * d, y: Y + Math.sin(q) * d * 0.8, z: 0.05, vx: Math.cos(q) * s2.rand(0.6, 1.8), vy: Math.sin(q) * s2.rand(0.5, 1.4), vz: s2.rand(1.5, 3), g: 9, drag: 0.6, bounce: 0.25, s: s2.R() < 0.3 ? 2 : 1, wide: s2.R() < 0.4, life: s2.rand(0.7, 1.1), R: DIRT, debris: true, minor: i > 1 });
    }
  });
  // the creature forms out of converging particles
  s.at(tForm, (s2) => {
    s2.add({ k: "veForm", x: X, y: Y, size: sz, h, sil, form, life: form + 1.3, rise: undead, hero: crit, fail, R, seed: s2.seedInt() % 997, update: still });
  });
  s.emit(tForm - 0.1, tLand - 0.1, (s2, _u, dt) => {
    for (let i = s2.count(80 * sz, dt); i > 0; i--) {
      const q = s2.rand(0, TAU), d0 = s2.rand(0.7, 1.2) * rc, z0 = s2.rand(0.1, 1.3) * h, tx = X + s2.rand(-0.25, 0.25) * sz, tz = s2.rand(0.05, 0.95) * h, life = s2.rand(0.28, 0.42), spin = s2.R() < 0.5 ? -1 : 1;
      s2.add({ k: "mote", plus: i % 5 === 0, x: X + Math.cos(q) * d0, y: Y + Math.sin(q) * d0 * 0.7, z: z0, life, R, minor: i > 2, update(p) {
        const f = easeOut(clamp(p.age / life)), qq = q + spin * f * 1.8, d = d0 * (1 - f);
        p.x = lerp(X + Math.cos(qq) * d, tx, f * f); p.y = Y + Math.sin(qq) * d * 0.7; p.z = lerp(z0, tz, f);
      } });
    }
  });
  if (fail) {
    // it never takes: the shape scatters back into motes and the circle gutters
    s.at(tLand, (s2) => {
      for (let i = 0; i < 30; i++) { const q = s2.rand(0, TAU), sp = s2.rand(1, 2.6); s2.add({ k: "mote", x: X, y: Y, z: s2.rand(0.1, 1) * h, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp * 0.7, vz: s2.rand(-0.2, 0.8), drag: 2.2, life: s2.rand(0.5, 0.8), R, minor: i % 2 === 1 }); }
      s2.add({ k: "ring", x: X, y: Y, r: rc * 1.2, life: 0.5, R, broken: true, seed: 12, update: still });
      s2.light(X, Y, 0.5, rc * 1.5, S(R, 0.85), 0.5, 0.3);
    });
    s.phases.push("summon: a circle, a column, a shape that never takes");
    s.period = tLand + 1.2;
    return;
  }
  // it lands: a ring, dust, a thump
  s.at(tLand, (s2) => {
    s2.add({ k: "ring", x: X, y: Y, r: rc * 1.1, life: 0.5, R, seed: 8, update: still });
    s2.add({ k: "ring", x: X, y: Y, r: rc * 1.8, life: 0.75, R, broken: true, seed: 13, update: still });
    s2.add({ k: "flash", x: X, y: Y, z: 0.15, life: (crit ? 2 : 1) / 12, r: 0.55 * sz * s2.spec.aps, R, update: still });
    dust(s2, undead ? DIRT : RAMP.smoke, X, Y, rc * 0.85, 14, undead ? sz * 0.8 : sz, undead ? 0.35 : 0.55);
    for (let i = 0; i < 14; i++) { const q = (i / 14) * TAU; s2.add({ k: i % 2 ? "chunk" : "spark", x: X + Math.cos(q) * 0.3 * sz, y: Y + Math.sin(q) * 0.25 * sz, z: 0.05, vx: Math.cos(q) * s2.rand(1.2, 2.6), vy: Math.sin(q) * s2.rand(1, 2), vz: s2.rand(0.6, 1.8), g: 7, drag: 1.2, bounce: 0.3, s: 1, life: s2.rand(0.45, 0.8), R: i % 2 ? DIRT : R, debris: i % 2 === 1, minor: i % 3 === 2 }); }
    s2.light(X, Y, 0.4, rc * 2.6, S(R, 0.9), M.dark || undead ? 0.7 : 1, 0.6);
    if (crit) s2.crit(); else s2.shake = Math.max(s2.shake, 1.2);
  });
  // it holds: embers drift up off the cooling circle
  s.emit(tLand, tLand + 1.2, (s2, u, dt) => {
    for (let i = s2.count(18 * sz * (1 - u), dt); i > 0; i--) { const q = s2.rand(0, TAU), d = rc * s2.rand(0.7, 1); s2.add({ k: undead ? "wisp" : "ember", s: 2, x: X + Math.cos(q) * d, y: Y + Math.sin(q) * d * 0.8, z: 0.05, vz: s2.rand(0.3, 0.7), drag: 1, life: s2.rand(0.6, 1), seed: s2.R(), R: undead ? DR : R, minor: true }); }
  });
  s.phases.push(undead ? "summon: the ground cracks, grave dirt flies, the dead claw up" : `summon: a circle, a column, a ${sil} forms and lands`);
  s.period = tLand + 1.6;
}

export default { conceal, drain, summon };
