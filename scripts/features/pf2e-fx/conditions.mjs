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
 * Presence (spellsprite-craft §1): a condition has to read on a token from
 * across the table, so every overlay wraps the WHOLE creature, the way the
 * pixelfx status loops do: a wash over the body that pulses on the condition's
 * beat, a ring or a crown round the token's edge, a light on the floor, and a
 * glyph over the head big enough to name the condition at a glance (7–9 px,
 * auto-shaded and always outlined). Persistent damage adds a wrap of its own
 * per family: fire licks the whole rim and smokes, cold encases, poison and
 * acid bubble, electricity crackles, bleeding beads and spurts on the pulse.
 *
 * Every overlay draws in its OWN ramp (a frightened creature sweats the same
 * blue whatever the message's material), and loops: anything that lives for
 * the whole loop is spawned once in `start` (life 1e9, moved by its `update`,
 * every motion a continuous function of the sim clock so there is no seam),
 * anything spawned by `loop` has a finite life, so a loop's particle count is
 * flat however long it runs. Beats are `Math.floor(s.t / beat)` edges.
 *
 * Valued conditions (frightened 2, drained 3) scale with `condition.value`,
 * clamped to 1..4.
 *
 * The slug list is PF2e's own conditions pack (43 entries, PF2e 8.x), plus
 * `malevolence`, which that pack does not ship but which modules apply.
 */

import { TAU, clamp, hash, fadeOut, lerp } from "./core/rand.mjs";
import { RAMP, S, INK } from "./core/palette.mjs";
import { lobes, still, splat, TRADITION_GLYPHS } from "./core/motifs.mjs";
import { registerShapes, snapH } from "./core/shapes.mjs";

/* ── pixel icons ─────────────────────────────────────────────────────── */

/**
 * Bitmaps, top row first. "#" body, auto-shaded (lit on its top and left
 * edges, shaded on the bottom and right, like a hand-shaded icon); "h" a
 * highlight; "1" light, "2" mid, "3" dark; "k" ink; "." empty. Drawn
 * always-outlined (flag 2), so a glyph reads over any token art.
 */
export const ICONS = Object.freeze({
  question: [".###.", "##.##", "...##", "..##.", ".##..", ".##..", ".....", ".##.."],
  heart: [".##.##.", "#h#####", "#######", ".#####.", "..###..", "...#..."],
  heartHuge: ["..###...###..", ".#####.#####.", "#hh##########", "#h###########", "#############", ".###########.", "..#########..", "...#######...", "....#####....", ".....###.....", "......#......"],
  heartBig: [".###.###.", "#h#######", "#h#######", "#########", ".#######.", "..#####..", "...###...", "....#...."],
  z: ["#####", "...#.", "..#..", ".#...", "#####"],
  Z: ["#######", "....##.", "...##..", "..##...", ".##....", "#######"],
  star: ["...#...", "..###..", "#######", ".##h##.", "..###..", ".##.##.", ".#...#."],
  starSmall: ["..#..", ".###.", "#####", ".#.#."],
  skull: ["..#####..", ".#######.", "#########", "##kk#kk##", "##kk#kk##", "####k####", ".#######.", "..#k#k#..", "..#####.."],
  skullLit: ["..#####..", ".#######.", "#########", "##hh#hh##", "##hh#hh##", "####k####", ".#######.", "..#k#k#..", "..#####.."],
  drop: ["..#..", "..#..", ".###.", "#h###", "#####", ".###."],
  bang: ["##", "##", "##", "##", "##", "..", "##"],
  weight: [".222.", ".2.2.", "11111", "12221", ".111."],
  plus: [".1.", "121", ".1."],
  stake: ["#", "#", "#", "#", "3"],
  crack: ["..1..", ".1...", ".11..", "...1.", "..1..", ".1..."],
  shard: ["..#..", ".#h#.", ".###.", "##.##", ".#.#."],
  spike: [".1.", "121", "121", "122", ".2."],
  down: ["..###..", "..###..", "..###..", "#######", ".#####.", "..###..", "...#..."],
  lock: [".###.", "#...#", "#...#", "#####", "##k##", "##k##", "#####"],
});

const TONE = { 1: 0.95, 2: 0.72, 3: 0.45, h: 1 };

/** A soft envelope: in over 0.1 s, out over the last part of a finite life. */
const env = (p, inT = 0.1, from = 0.65) => (p.life >= 1e8 ? Math.min(1, p.age / inT) : Math.min(1, p.age / inT) * fadeOut(p.age / p.life, from));

export function drawIcon(P, bm, x, y, R, a = 1, dim = 0) {
  const h = bm.length, w = bm[0].length, x0 = Math.round(x - w / 2), y0 = Math.round(y - h);
  const on = (i, j) => i >= 0 && j >= 0 && i < w && j < h && bm[j][i] !== ".";
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const ch = bm[j][i];
    if (ch === ".") continue;
    let t;
    if (ch === "#") t = !on(i, j - 1) || !on(i - 1, j) ? 0.85 : !on(i, j + 1) || !on(i + 1, j) ? 0.5 : 0.68;
    else t = TONE[ch];
    P.dot(x0 + i, y0 + j, ch === "k" ? INK : S(R, t - dim), a, 2);
  }
}

/* ── shapes only the overlays draw ───────────────────────────────────── */

const BAND_STYLE = {
  // [top row, bottom row] per position in the period; numbers are ramp steps
  rope: { period: 4, top: [0.9, 0.7, 0.45, 0.7], bot: [0.45, 0.7, 0.9, 0.7] },
  chain: { period: 6, top: [0.95, 0.95, 0.95, null, 0.72, null], bot: [0.72, null, 0.72, null, 0.6, null] },
  rune: { period: 5, top: [0.95, null, 0.72, null, null], bot: [null, 0.95, null, null, null] },
};

/** A pulse in [0, 1] every `beat` seconds: a sharp rise, a slower fall. */
const throb = (t, beat, w = 0.12) => Math.exp(-((t % beat) / w));

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
      // a heavy band is three rows: the shadowed underside
      if (p.thick && (t0 != null || t1 != null)) P.dot(x, y + 2, S(p.R, 0.3), a, 2);
    }
  },

  /** Slowed: a clock face on the floor whose hand ticks round in heavy steps. */
  cnClock(v, P, p, s) {
    const [cx, cy] = v.ap(p.x, p.y, 0), rx = p.r * v.aps, ry = rx * v.sq, a = env(p, 0.15);
    const step = Math.floor(s.t / p.beat), since = s.t - step * p.beat, fresh = since < 1 / 12, glow = Math.exp(-since / 0.15);
    // the glass: a translucent face, flushing on each tick
    P.shade(cx - rx, cy - ry, cx + rx, cy + ry, (x, y) => {
      const dx = (x - cx) / rx, dy = (y - cy) / ry, d = dx * dx + dy * dy;
      return d > 1 ? null : { c: S(p.R, 0.5 + glow * 0.2), a: a * (d > 0.8 ? 0.5 : 0.25) };
    }, 0, "mix");
    for (let k = 0; k < 2; k++) P.ellipse(cx, cy, rx - k, Math.max(0.5, ry - k), () => ({ c: S(p.R, k ? 0.6 : 0.95), a }), 1);
    for (let i = 0; i < 12; i++) {
      const q = (i * TAU) / 12, L = i % 3 === 0 ? 0.74 : 0.86;
      P.line(cx + Math.cos(q) * rx * L, cy + Math.sin(q) * ry * L, cx + Math.cos(q) * rx * 0.97, cy + Math.sin(q) * ry * 0.97, S(p.R, i % 3 === 0 ? 1 : 0.78), 1, a);
    }
    // the hand rides the rim (the creature stands on the dial's centre): a pointer
    // that steps one hour per beat and leaves a fading wedge of the hours it lost
    for (let k = 0; k < 4; k++) {
      const q = ((step - k) * TAU) / 12 - Math.PI / 2;
      const x0 = cx + Math.cos(q) * rx * 0.6, y0 = cy + Math.sin(q) * ry * 0.6, x1 = cx + Math.cos(q) * rx * 1.22, y1 = cy + Math.sin(q) * ry * 1.22;
      if (k === 0) {
        for (let o = -1; o <= 1; o++) P.line(x0 + o * Math.sin(q), y0 - o * Math.cos(q), x1 + o * Math.sin(q), y1 - o * Math.cos(q), S(p.R, o ? 0.78 : fresh ? 1 : 0.95), 1, a);
      } else P.line(x0, y0, x1, y1, S(p.R, 0.7 - k * 0.1), 0, a * (k === 1 ? 0.75 : k === 2 ? 0.5 : 0.3));
    }
  },

  /** A spiral that turns: sickened's queasy swirl, fascinated's hypnotic one. */
  cnSpiral(v, P, p, s) {
    const [cx, cy] = v.ap(p.x, p.y, p.z), fr = Math.floor(s.t * 12), rot = fr * 0.35 * (p.spin ?? 1), a = env(p);
    const turns = p.turns ?? 1.6, R = p.r, flat = p.flat ?? 0.8;
    let lx = null, ly = null;
    for (let i = 0; i <= 120; i++) {
      const f = i / 120, q = rot + f * turns * TAU, r = 0.6 + f * R;
      const x = Math.round(cx + Math.cos(q) * r), y = Math.round(cy + Math.sin(q) * r * flat);
      if (x === lx && y === ly) continue;
      lx = x; ly = y;
      P.dot(x, y, S(p.R, f > 0.66 ? 1 : f > 0.33 ? 0.8 : 0.6), a, 2);
      // the outer turn is two pixels thick: the swirl reads as a stroke, not a thread
      if (f > 0.8) P.dot(x, y + 1, S(p.R, 0.62), a, 2);
    }
  },

  /** Frightened: trembling marks at both sides of the head, more of them the more afraid. */
  cnShiver(v, P, p, s) {
    const fr = Math.floor(s.t * 12), [hx, hy] = v.ap(p.x, p.y, p.z), w = Math.round(p.w * v.aps), a = env(p, 0.15);
    const jit = fr % 2;
    for (let side = -1; side <= 1; side += 2) for (let k = 0; k < p.n; k++) {
      const x = hx + side * (w + 3 + k * 3 + (k === 0 ? jit : 0)), y0 = hy - 2 + k * 2;
      for (let j = 0; j < 7 - k; j++) P.dot(x + ((j + fr + k) % 2) * side, y0 + j, S(p.R, j === 0 ? 1 : 0.8), a, 2);
    }
  },

  /** Blinded: a dark band across the eyes, its knot's tails fluttering. */
  cnBlind(v, P, p, s) {
    const fr = Math.floor(s.t * 12), [x, y] = v.ap(p.x, p.y, p.z), hw = Math.max(5, Math.round(p.w * v.aps)), a = env(p, 0.1);
    for (let i = -hw; i <= hw; i++) {
      const e = Math.abs(i) === hw;
      P.dot(x + i, y - 1, S(p.R, e ? 0.45 : 0.72), a, 2); P.dot(x + i, y, S(p.R, 0.5), a, 2); P.dot(x + i, y + 1, S(p.R, 0.3), a, 2);
    }
    // the knot and two tails that flutter in the wind
    for (let t = 0; t < 2; t++) for (let k = 1; k <= 5; k++) {
      const wave = Math.round(Math.sin(fr * 0.9 + k * 0.9 + t * 1.7) * (k / 3));
      P.dot(x + hw + k, y + t + wave + Math.floor(k / 2), S(p.R, k < 3 ? 0.45 : 0.3), a, 2);
    }
  },

  /** Dazzled: a glare star at eye height that swells and shrinks, with a ring of glare round it. */
  cnGlare(v, P, p, s) {
    const fr = Math.floor(s.t * 12), [x, y] = v.ap(p.x, p.y, p.z), L = [4, 5, 7, 6, 5, 4][fr % 6] + (p.big ?? 0), a = env(p, 0.1);
    for (let i = 1; i <= L; i++) {
      const c = i >= L - 1 ? S(p.R, 0.72) : S(p.R, 0.95);
      P.dot(x + i, y, c, a, 2); P.dot(x - i, y, c, a, 2); P.dot(x, y + i, c, a, 2); P.dot(x, y - i, c, a, 2);
      if (i < L * 0.5) { const d = S(p.R, 0.78); P.dot(x + i, y + i, d, a, 2); P.dot(x - i, y - i, d, a, 2); P.dot(x + i, y - i, d, a, 2); P.dot(x - i, y + i, d, a, 2); }
    }
    const rr = 6 + (fr % 6 < 3 ? fr % 3 : 3 - (fr % 3));
    P.ellipse(x, y, rr, rr, (q) => (Math.floor(q * 4 + fr) % 3 === 0 ? null : { c: S(p.R, 0.85), a: a * 0.75 }), 1);
    P.dot(x, y, S(p.R, 1), a, 2);
  },

  /** Deafened: sound arcs at the ears that close inward and never arrive. */
  cnMuffle(v, P, p, s) {
    const [x, y] = v.ap(p.x, p.y, p.z), w = p.w * v.aps, ph = (s.t * 1.6) % 1, a = env(p, 0.15);
    // arcs arrive from outside and fade before they reach the ear: sound that never lands
    for (let k = 0; k < 3; k++) {
      const u = (k / 3 + ph) % 1, r = 13 - u * 9, hh = Math.round(r * 0.5);
      if (u > 0.85) continue;
      for (let side = -1; side <= 1; side += 2) for (let j = -hh; j <= hh; j++) {
        const xx = Math.round(x + side * (w + r - (j * j) / (r * 0.9)));
        P.dot(xx, y + j, S(p.R, u > 0.55 ? 0.55 : 0.9), a, u > 0.55 ? 0 : 2);
      }
    }
    // the stopped ear: a cross-barred plug on each side
    for (let side = -1; side <= 1; side += 2) {
      const ex = Math.round(x + side * (w + 1));
      for (let j = -2; j <= 2; j++) P.dot(ex, y + j, S(p.R, 0.95), a, 2);
      P.dot(ex + side, y - 1, S(p.R, 0.6), a, 2); P.dot(ex + side, y + 1, S(p.R, 0.6), a, 2);
    }
  },

  /** Petrified: stone that creeps over the whole body (top: the whole token; side: up from the feet). */
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
      // it creeps in from the south edge and closes over the head
      const [cx, cy] = v.ap(p.x, p.y, 0), r1 = 0.5 * p.size * v.aps, front = lerp(r1 + 2, -r1 - 2, grow);
      P.shade(cx - r1 - 1, cy - r1 - 1, cx + r1 + 1, cy + r1 + 1, (x, y, ix, iy) => {
        const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
        if (d > r1) return null;
        const edge = dy - front + hash(Math.floor(dx / 2), 7, p.seed) * 2;
        if (edge < 0) return null;
        const c = S(p.R, edge < 1.2 && grow < 1 ? 0.95 : d > r1 - 1.2 ? cob(ix, iy) - 0.12 : cob(ix, iy));
        return a < 1 ? { c, a } : c;
      }, 1);
      return;
    }
    const [bx, by] = v.ap(p.x, p.y, 0), H = Math.max(2, grow * p.hgt * v.aps), W = 0.26 * p.size * v.aps;
    P.shade(bx - W - 2, by - H - 2, bx + W + 2, by + 1, (x, y, ix, iy) => {
      const up = by - y, f = up / H, hw = W * (1 - f * 0.25) + (hash(Math.floor(up / 2), 1, p.seed) - 0.5) * 2;
      const top = H - hash(Math.floor((x - bx) / 2), 2, p.seed) * 3;
      if (up < -1 || up > top || Math.abs(x - bx) > hw) return null;
      const c = S(p.R, up > top - 1.2 && grow < 1 ? 0.95 : cob(ix, iy) - (Math.abs(x - bx) > hw - 1 ? 0.1 : 0));
      return a < 1 ? { c, a } : c;
    }, 1);
  },

  /** Invisible: the shimmer of a body you cannot see, an outline that wavers. */
  cnOutline(v, P, p, s) {
    const fr = Math.floor(s.t * 12), a = env(p, 0.2);
    if (v.kind === "top") {
      const [cx, cy] = v.ap(p.x, p.y, 0), r = 0.46 * p.size * v.aps;
      for (let k = 0; k < 2; k++) P.ellipse(cx, cy, r + k, r + k, (q) => (Math.floor((q / TAU) * r * 6 / 3 + fr + k * 2) % 3 === 2 ? null : { c: S(p.R, Math.floor(q * 3 + fr) % 2 ? 0.95 : 0.7), a: a * (k ? 0.5 : 0.75) }));
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
    const w = Math.round(0.4 * p.size * v.aps);
    for (let i = -w; i <= w; i++) { P.dot(tx + i, ty, S(p.R, 0.95), a, 2); P.dot(tx + i, ty + 1, S(p.R, 0.55), a, 2); }
    for (let j = -4; j <= 4; j++) P.dot(tx, ty + j, S(p.R, j ? 0.85 : 1), a, 2);
    const ends = [[-0.24, 0.62], [0.24, 0.62], [0, 0.95], [-0.12, 0.2], [0.12, 0.2]];
    ends.forEach(([ox, oz], k) => {
      const [ex, ey] = v.ap(p.x + ox * p.size + Math.sin(s.t * 2.3 + k) * 0.02, p.y, oz * p.h), sx = k === 2 ? tx : tx + Math.round((k % 2 ? 1 : -1) * w * (k < 2 ? 1 : 0.5));
      // a pulse of will runs down each string
      const pulse = ((s.t * 1.4 + k * 0.23) % 1);
      P.line(sx, ty + 1, ex, ey, null, 0, a, (f) => (Math.abs(f - pulse) < 0.08 ? S(p.R, 1) : S(p.R, 0.62)));
      P.dot(ex, ey, S(p.R, 1), a, 2);
    });
  },

  /** Concealed: a translucent bank of mist that drifts round the body (true blends, no dither). */
  cnMist(v, P, p, s) {
    const a = env(p, 0.4);
    for (let i = 0; i < p.n; i++) {
      const q = p.ph + i * (TAU / p.n) + s.t * 0.35, bob = Math.sin(s.t * 0.9 + i * 1.7);
      const [x, y] = v.ap(p.x + Math.cos(q) * p.r, p.y + Math.sin(q) * p.r * (v.kind === "top" ? 1 : 0.45), p.h * (0.18 + 0.2 * (i % 3)) + bob * 0.04);
      const far = v.kind !== "top" && Math.sin(q) < 0, r = (3.4 + (i % 2) * 1.2) * (v.kind === "top" ? 1.15 : 1);
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

  /**
   * A translucent wash over the whole body (top: the token's disc; side: the
   * standing body), its strength `p.k(t)`: a poisoned creature's green, a
   * bleeding one's red flush on each heartbeat. True blends, no dither.
   */
  cdWash(v, P, p, s) {
    const k = (typeof p.str === "function" ? p.str(s.t) : p.str ?? 0.25) * env(p, 0.2);
    if (k < 0.13) return;
    const c = S(p.R, p.t ?? 0.7), rim = S(p.R, Math.min(1, (p.t ?? 0.7) + 0.2));
    if (v.kind === "top") {
      const [cx, cy] = v.ap(p.x, p.y, 0), r = 0.45 * p.size * v.aps;
      P.shade(cx - r, cy - r, cx + r, cy + r, (x, y) => {
        const d = Math.hypot(x - cx, y - cy) / r;
        return d > 1 ? null : { c: d > 0.82 ? rim : c, a: d > 0.82 ? Math.min(1, k * 1.6) : k };
      }, 0, "mix");
      return;
    }
    const [bx, by] = v.ap(p.x, p.y, 0), rx = 0.27 * p.size * v.aps, ry = p.h * v.aps * 0.5, cy = by - ry;
    P.shade(bx - rx, cy - ry, bx + rx, by, (x, y) => {
      const dx = (x - bx) / rx, dy = (y - cy) / ry, d = dx * dx + dy * dy;
      return d > 1 ? null : { c: d > 0.7 ? rim : c, a: d > 0.7 ? Math.min(1, k * 1.6) : k };
    }, 0, "mix");
  },

  /**
   * A ring round the token's edge on the floor: two rows, its dashes crawling,
   * its strength `p.k(t)`. The condition's colour, read from across the table.
   */
  cdRim(v, P, p, s) {
    const k = (typeof p.str === "function" ? p.str(s.t) : p.str ?? 1) * env(p, 0.25);
    if (k <= 0.05) return;
    const [cx, cy] = v.ap(p.x, p.y, 0), rx = p.r * v.aps, ry = rx * v.sq, crawl = s.t * (p.crawl ?? 1.5), n = p.dash ?? 10;
    for (let row = 0; row < 2; row++) P.ellipse(cx, cy, rx + row, Math.max(0.5, (rx + row) * v.sq), (q) => {
      const ph = ((q / TAU) * n + crawl) % 1, on = ph < 0.62;
      if (!on && row) return null;
      return { c: S(p.R, row ? 0.55 : on ? 0.95 : 0.7), a: k };
    }, 1);
    if (p.fill) P.shade(cx - rx, cy - ry, cx + rx, cy + ry, (x, y) => {
      const dx = (x - cx) / rx, dy = (y - cy) / Math.max(0.5, ry), d = dx * dx + dy * dy;
      return d > 1 ? null : { c: S(p.R, p.fill), a: (d > 0.6 ? 0.5 : 0.25) * k };
    }, 0, "mix");
  },

  /** A rune circle on the floor that keeps turning: an outer ring, an inner one, glyphs riding between. */
  cdCircle(v, P, p, s) {
    const a = env(p, 0.3), [cx, cy] = v.ap(p.x, p.y, 0), r = p.r * v.aps, sq = v.sq, rot = s.t * (p.spin ?? 0.6);
    P.ellipse(cx, cy, r, r * sq, (q) => ({ c: S(p.R, Math.floor((q - rot) * 5) % 2 ? 0.95 : 0.7), a }), 1);
    P.ellipse(cx, cy, r * 0.74, r * 0.74 * sq, () => ({ c: S(p.R, 0.55), a }), 1);
    const G = p.glyphs, n = p.n ?? 6;
    for (let i = 0; i < n; i++) {
      const q = rot + (i * TAU) / n, gx = Math.round(cx + Math.cos(q) * r * 0.87), gy = Math.round(cy + Math.sin(q) * r * 0.87 * sq), g = G[(i + Math.floor(s.t * 1.5)) % G.length];
      for (let j = 0; j < 3; j++) for (let k2 = 0; k2 < 3; k2++) if (g[j * 3 + k2] === "1") P.dot(gx - 1 + k2, gy - 1 + j, S(p.R, 1), a, 1);
    }
  },

  /** A dark stain on the floor that breathes: doom, malevolence. Its edge glows. */
  cdPool(v, P, p, s) {
    const a = env(p, 0.3), [cx, cy] = v.ap(p.x, p.y, 0), br = 1 + 0.06 * Math.sin(s.t * (p.rate ?? 2)), rx = p.r * v.aps * br, ry = rx * v.sq;
    P.shade(cx - rx - 1, cy - ry - 1, cx + rx + 1, cy + ry + 1, (x, y) => {
      const dx = (x - cx) / rx, dy = (y - cy) / Math.max(0.5, ry), q = Math.atan2(dy, dx), d = Math.hypot(dx, dy), e = 0.9 + 0.08 * Math.sin(q * 7 + s.t * 1.3);
      if (d > e) return null;
      return d > e - 0.12 ? { c: S(p.R, 0.62), a: a * 0.75 } : { c: S(p.R, 0), a: a * (d < 0.5 ? 0.75 : 0.5) };
    }, 0, "mix");
  },

  /** A bubble rising off a body that wobbles and pops in a ring of four droplets. */
  cdBubble(v, P, p) {
    const fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, p.z), u = p.age / p.life, r = p.sz * Math.min(1, 0.4 + u * 2);
    if (u > 0.85) {
      const d = r + 1 + (u - 0.85) * 20;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) P.dot(cx + dx * d, cy + dy * d, S(p.R, 1), 1, 2);
      return;
    }
    const wob = (fr >> 1) % 2;
    if (r >= 2) P.ellipse(cx, cy, r + wob * 0.5, r - wob * 0.5, (q) => ({ c: S(p.R, Math.sin(q) > 0.2 ? 0.6 : 0.95), a: 1 }), 2);
    else P.dot(cx, cy, S(p.R, 0.95), 1, 2);
    P.dot(cx - Math.ceil(r * 0.4), cy - Math.ceil(r * 0.4), S(p.R, 1), 1, 2);
  },

  /** A jagged crack across the body with a lit lip: broken, petrified. */
  cdCrack(v, P, p, s) {
    const [cx, cy] = v.ap(p.x, p.y, p.z), a = env(p, 0.1), L = p.L, g = Math.min(1, (p.age ?? 0) / 0.25);
    let x = cx - L / 2, y = cy - L / 2, k = 0;
    const r = (i) => hash(i, p.seed);
    while (k < L * g) {
      const nx = x + 1 + (r(k) > 0.6 ? 1 : 0), ny = y + 1 + (r(k + 50) > 0.55 ? 1 : r(k + 50) < 0.2 ? -1 : 0);
      P.line(x, y, nx, ny, S(p.R, 0.15), 1, a);
      P.dot(nx, ny - 1, S(p.R, 0.95), a, 1);
      if (k % 5 === 3) P.line(nx, ny, nx + (r(k + 9) > 0.5 ? 3 : -2), ny + 2, S(p.R, 0.2), 1, a);
      x = nx; y = ny; k += 1;
    }
  },
}, { flat: ["cnClock", "cnShadow", "cdRim", "cdCircle", "cdPool"] });

/* ── helpers ─────────────────────────────────────────────────────────── */

const lvl = (s) => clamp(Math.round(Number(s.spec.condition?.value) || 1), 1, 4);
/** Just above the head: where a status glyph sits clear of the face. */
const HEAD = (T) => ({ x: T.x, y: T.y - 0.3 * T.size, z: 1.2 * T.h });
/** Eye height, on the face. */
const EYES = (T) => ({ x: T.x, y: T.y + 0.02, z: 0.86 * T.h });
const keep = (s, p) => s.add({ life: 1e9, ...p });
/** A point on the token's edge, angle q, at r of its size. */
const rimAt = (T, q, r = 0.44) => ({ x: T.x + Math.cos(q) * r * T.size, y: T.y + Math.sin(q) * r * T.size });

/** A body wash and its floor rim in one ramp: the creature's whole silhouette carries the condition. */
function wrap(s, T, R, { wash = null, washT = 0.7, rim = null, rimR = 0.56, fill = 0, dash = 10, crawl = 1.5 } = {}) {
  if (wash != null) keep(s, { k: "cdWash", x: T.x, y: T.y, size: T.size, h: T.h, R, t: washT, str: wash, update: still });
  if (rim != null) keep(s, { k: "cdRim", x: T.x, y: T.y + 0.02, r: rimR * T.size, R, str: rim, fill, dash, crawl, update: still });
}

/** A light on the floor under the creature for as long as the loop runs. */
const pool = (s, T, R, k = 0.4, r = 1.3, o = {}) => s.light(T.x, T.y, 0.3 * T.h, r * T.size, S(R, 0.85), k, 1e9, o);

/** `n` glyphs circling the head on a tilted ring, the far ones a step darker. */
function orbit(s, T, n, mk, { rx = 0.46, ry = 0.18, speed = 2.2, bob = 0.05, z = 0 } = {}) {
  const c = HEAD(T), out = [];
  for (let i = 0; i < n; i++) out.push(keep(s, {
    ...mk(i), x: c.x, y: c.y, z: c.z, ph: (i * TAU) / n, snap: false,
    update(p, s2) {
      const q = p.ph + s2.t * speed;
      p.x = c.x + Math.cos(q) * rx * T.size; p.y = c.y + Math.sin(q) * ry * T.size; p.z = c.z + z + Math.sin(s2.t * 3 + i * 2) * bob;
      p.dim = Math.sin(q) < 0 ? 0.2 : 0;
      p.near = Math.sin(q) >= 0;
    },
  }));
  return out;
}

/** Glitter shed behind orbiting glyphs: short-lived motes where each one is now. */
function glitter(s, list, R, rate, dt) {
  for (const g of list) for (let i = s.count(rate, dt); i > 0; i--) s.add({ k: "mote", x: g.x + s.rand(-0.03, 0.03), y: g.y, z: g.z - 0.05, vz: -0.15, drag: 2, life: s.rand(0.25, 0.45), R, minor: true });
}

/** A Strike of dust at the feet, once: prone's fall, fleeing's scramble. */
function dust(s, T, n, dir = 0) {
  for (let i = 0; i < n; i++) {
    const q = dir ? dir + s.rand(-0.6, 0.6) : s.rand(0, TAU);
    s.add({ k: "smoke", x: T.x + Math.cos(q) * 0.2 * T.size, y: T.y + 0.1 + Math.sin(q) * 0.12, z: 0.05, vx: Math.cos(q) * s.rand(0.6, 1.4), vy: Math.sin(q) * 0.4, vz: s.rand(0.05, 0.25), drag: 3, r: s.rand(3, 4.6), life: s.rand(0.7, 1.1), lobes: lobes(s), R: RAMP.kinetic, tone: 0.6 });
  }
}

/** True once per beat: the frame the beat lands on. */
function beatEdge(s, key, beat) {
  const k = Math.floor(s.t / beat);
  if (k === s[key]) return false;
  s[key] = k;
  return true;
}

/* ── persistent damage: a wrap per family ────────────────────────────── */

const TICK = 1.4;

/** What persistent damage draws on top of the family aura, by the material's family. */
const WRAPS = {
  /** Burning: tongues lick the whole rim, thin smoke rolls off the head, sparks stream up; every tick it flares. */
  flame: {
    start(s, M, T) {
      keep(s, { k: "cdWash", x: T.x, y: T.y, size: T.size, h: T.h, R: M.R, t: 0.8, str: (t) => 0.55 * throb(t, TICK, 0.1), update: still });
      pool(s, T, M.R, 0.45, 1.5, { flicker: true });
    },
    loop(s, M, { T, dt }) {
      const R = M.R, flare = throb(s.t, TICK, 0.15);
      for (let i = s.count(16 + 30 * flare, dt); i > 0; i--) {
        const q = s.rand(0, TAU), p = rimAt(T, q, s.rand(0.34, 0.48));
        s.add({ k: "tongue", x: p.x, y: p.y, z: s.rand(0, 0.25) * T.h, h: s.rand(7, 13) * (1 + flare * 0.8), w: s.rand(1.8, 3), life: s.rand(0.35, 0.6), seed: Math.floor(s.R() * 1000), glow: true, r: 2, R, minor: i > 2, update: still });
      }
      for (let i = s.count(14, dt); i > 0; i--) {
        const q = s.rand(0, TAU), p = rimAt(T, q, 0.4);
        s.add({ k: "ember", ...p, z: s.rand(0.2, 0.8) * T.h, vx: s.rand(-0.5, 0.2), vy: s.rand(-0.2, 0.2), vz: s.rand(0.9, 1.8), g: -0.3, drag: 1.2, life: s.rand(0.6, 1.1), R, seed: s.R(), minor: i > 1 });
      }
      for (let i = s.count(1.1, dt); i > 0; i--) s.add({ k: "smoke", x: T.x + s.rand(-0.2, 0.2) * T.size, y: T.y - 0.1, z: 1.05 * T.h, vx: s.rand(-0.35, -0.1), vz: s.rand(0.4, 0.7), g: -0.1, drag: 1, r: s.rand(3.2, 5), life: s.rand(1.4, 2), lobes: lobes(s), tone: 0.35, R: RAMP.smoke, minor: i > 0 });
      if (beatEdge(s, "_cdFlare", TICK)) for (let i = 0; i < 12; i++) {
        const q = -Math.PI / 2 + s.rand(-1.4, 1.4), sp = s.rand(1.6, 3.2);
        s.add({ k: "spark", x: T.x + s.rand(-0.3, 0.3) * T.size, y: T.y, z: 0.7 * T.h, vx: Math.cos(q) * sp * 0.6, vy: s.rand(-0.4, 0.4), vz: -Math.sin(q) * sp, g: 6, drag: 1.5, life: s.rand(0.3, 0.5), R, minor: i > 5 });
      }
    },
  },

  /** Chilled: an ice crust round the body, a cold wash, frost breath, snow sifting down; a shiver each second. */
  frost: {
    start(s, M, T) {
      for (let i = 0; i < 11; i++) {
        const q = (i / 11) * TAU + 0.2, p = rimAt(T, q, 0.42 + (i % 2) * 0.06);
        keep(s, { k: "crystal", ...p, h: 9 + (i % 3) * 4, w: 2 + (i % 2), lean: Math.cos(q) * 2.5, R: M.R, wait: i * 0.04, update: still });
      }
      keep(s, { k: "cdWash", x: T.x, y: T.y, size: T.size, h: T.h, R: M.R, t: 0.6, str: (t) => 0.25 * throb(t, 1, 0.35) + 0.12, update: still });
      keep(s, { k: "cdRim", x: T.x, y: T.y + 0.02, r: 0.6 * T.size, R: M.R, str: 0.85, fill: 0.5, dash: 14, crawl: 0.4, update: still });
      pool(s, T, M.R, 0.2, 1.4);
    },
    loop(s, M, { T, dt }) {
      const R = M.R;
      for (let i = s.count(10, dt); i > 0; i--) s.add({ k: "flake", x: T.x + s.rand(-0.6, 0.6) * T.size, y: T.y + s.rand(-0.4, 0.3), z: s.rand(1.1, 1.6) * T.h, vx: s.rand(-0.2, 0.2), g: 0.5, drag: 2.2, life: s.rand(1.2, 1.8), big: s.R() < 0.3, R, minor: i > 1 });
      for (let i = s.count(1.2, dt); i > 0; i--) s.add({ k: "smoke", x: T.x + 0.12 * T.size, y: T.y + 0.05, z: 0.86 * T.h, vx: s.rand(0.3, 0.6), vz: 0.15, drag: 2, r: s.rand(2, 3), life: 0.9, lobes: lobes(s), R, tone: 0.95, minor: true });
      if (beatEdge(s, "_cdShiver", 1)) for (let i = 0; i < 4; i++) s.add({ k: "glint", ...rimAt(T, s.rand(0, TAU), 0.45), z: s.rand(0.1, 0.6) * T.h, life: 5 / 12, R, big: i === 0, wait: i * 0.06, minor: i > 1, update: still });
    },
  },

  /** Poisoned / dissolving: bubbles boil off the body, a sick wash rolls up it, drips hiss; each tick a ring pulses out. */
  corrode: {
    start(s, M, T) {
      keep(s, { k: "cdWash", x: T.x, y: T.y, size: T.size, h: T.h, R: M.R, t: 0.72, str: (t) => 0.3 + 0.3 * throb(t, 0.8, 0.18), update: still });
      keep(s, { k: "cdRim", x: T.x, y: T.y + 0.02, r: 0.58 * T.size, R: M.R, str: (t) => 0.6 + 0.4 * throb(t, 0.8, 0.2), fill: 0.55, dash: 8, crawl: -0.8, update: still });
      pool(s, T, M.R, 0.35, 1.3);
    },
    loop(s, M, { T, dt }) {
      const R = M.R;
      for (let i = s.count(9, dt); i > 0; i--) {
        const q = s.rand(0, TAU), d = s.rand(0.05, 0.42), x0 = T.x + Math.cos(q) * d * T.size, ph = s.rand(0, TAU);
        s.add({ k: "cdBubble", x: x0, y: T.y + Math.sin(q) * d * T.size, z: s.rand(0.1, 0.7) * T.h, vz: s.rand(0.35, 0.7), drag: 0.6, sz: s.rand(1.5, 3.5), life: s.rand(0.6, 1.1), R, minor: i > 2, update(p, _s, dt2) { p.z += p.vz * dt2; p.x = x0 + Math.sin(ph + p.age * 7) * 0.03; } });
      }
      for (let i = s.count(2.5, dt); i > 0; i--) s.add({ k: "drip", ...rimAt(T, s.rand(0.3, Math.PI - 0.3), 0.3), z: s.rand(0.3, 0.6) * T.h, g: 5, life: 3, R, onGround: splat });
      if (beatEdge(s, "_cdPulse", 0.8)) s.add({ k: "ring", x: T.x, y: T.y, r: 0.85 * T.size, life: 0.55, R, update: still });
    },
  },

  /** Electrified: arcs crack between points round the body, sparks spit off, the light stutters. */
  arc: {
    start(s, M, T) {
      keep(s, { k: "cdWash", x: T.x, y: T.y, size: T.size, h: T.h, R: M.R, t: 0.62, str: (t) => (hash(Math.floor(t * 12), 3) > 0.75 ? 0.5 : 0), update: still });
      keep(s, { k: "cdRim", x: T.x, y: T.y + 0.02, r: 0.58 * T.size, R: M.R, str: (t) => (hash(Math.floor(t * 12), 5) > 0.3 ? 1 : 0.4), dash: 12, crawl: 4, update: still });
      pool(s, T, M.R, 0.25, 1.4, { flicker: true });
    },
    loop(s, M, { T, dt }) {
      const R = M.R, pt = () => { const q = s.rand(0, TAU), p = rimAt(T, q, s.rand(0.3, 0.5)); return [p.x, p.y, s.rand(0.1, 1) * T.h]; };
      for (let i = s.count(9, dt); i > 0; i--) s.add({ k: "bolt", a: pt(), b: pt(), life: 0.09, R, seed: s.seedInt(), update: still });
      for (let i = s.count(10, dt); i > 0; i--) {
        const [x, y, z] = pt(), q = s.rand(0, TAU), sp = s.rand(1.5, 3);
        s.add({ k: "spark", x, y, z, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp * 0.5, vz: s.rand(0.5, 2), g: 8, drag: 1, life: s.rand(0.2, 0.35), R, minor: i > 1 });
      }
    },
  },

  /** Bleeding: beads swell at three wounds and run; each heartbeat spurts and flushes the body red. */
  physical: {
    start(s, M, T) {
      keep(s, { k: "cdWash", x: T.x, y: T.y, size: T.size, h: T.h, R: M.R, t: 0.62, str: (t) => 0.55 * throb(t, 0.9, 0.12), update: still });
      s._cdWounds = [0.6, 2.4, 4.1].map((q, i) => ({ ...rimAt(T, q, 0.26 + i * 0.04), z: (0.35 + i * 0.18) * T.h }));
    },
    loop(s, M, { T, dt }) {
      const R = M.R, W = s._cdWounds; if (!W) return;
      for (let i = s.count(5, dt); i > 0; i--) { const w = W[Math.floor(s.R() * W.length)]; s.add({ k: "drip", x: w.x + s.rand(-0.03, 0.03), y: w.y, z: w.z, g: 4.5, life: 3, R, onGround: splat }); }
      if (beatEdge(s, "_cdBeat", 0.9)) {
        const w = W[Math.floor(s.R() * W.length)];
        for (let i = 0; i < 7; i++) { const q = s.rand(0, TAU), sp = s.rand(0.8, 1.8); s.add({ k: "drip", x: w.x, y: w.y, z: w.z, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp * 0.5, vz: s.rand(0.6, 1.6), g: 7, life: 3, R, onGround: splat, minor: i > 3 }); }
        s.light(T.x, T.y, 0.5 * T.h, 1.2 * T.size, S(R, 0.8), 0.45, 0.45);
      }
    },
  },

  /** Every other family: the material's colour rims the token and rises off the body in motes; each tick it flushes. */
  default: {
    start(s, M, T) {
      keep(s, { k: "cdWash", x: T.x, y: T.y, size: T.size, h: T.h, R: M.R, t: 0.8, str: (t) => 0.5 * throb(t, TICK, 0.18), update: still });
      keep(s, { k: "cdRim", x: T.x, y: T.y + 0.02, r: 0.58 * T.size, R: M.R, str: (t) => 0.55 + 0.45 * throb(t, TICK, 0.3), dash: 10, update: still });
    },
    loop(s, M, { T, dt }) {
      for (let i = s.count(10, dt); i > 0; i--) s.add({ k: "mote", ...rimAt(T, s.rand(0, TAU), s.rand(0.3, 0.5)), z: s.rand(0, 0.5) * T.h, vz: s.rand(0.5, 1), drag: 1, life: s.rand(0.7, 1.1), R: M.R, plus: s.R() < 0.3, minor: i > 2 });
    },
  },
};

/** Blood only bleeds red: persistent physical damage that is not bleed takes the plain wrap. */
const wrapOf = (M) => (M.family === "physical" ? (M.R === RAMP.bleed ? WRAPS.physical : WRAPS.default) : WRAPS[M.family] ?? WRAPS.default);

/* ── the overlays ────────────────────────────────────────────────────── */

const NONE = Object.freeze({ none: true, family: false });

export const CONDITIONS = Object.freeze({
  "persistent-damage": {
    // the wrap is the loop's body; the family aura under it only tints (compile.mjs buildCondition)
    familyScale: 0.4,
    start(s, M, T) { wrapOf(M).start(s, M, T); },
    loop(s, M, o) { wrapOf(M).loop(s, M, o); },
  },

  blinded: {
    family: false, gentle: true, material: "shadow",
    start(s, M, T) {
      const e = EYES(T);
      keep(s, { k: "cnBlind", ...e, w: 0.26 * T.size, R: RAMP.shadow, update: still });
      keep(s, { k: "cdWash", x: T.x, y: T.y, size: T.size, h: T.h, R: RAMP.shadow, t: 0.2, str: 0.25, update: still });
      keep(s, { k: "cdPool", x: T.x, y: T.y + 0.02, r: 0.55 * T.size, R: RAMP.shadow, rate: 1.4, update: still });
    },
    loop(s, M, { T, dt }) {
      // a murk curling round the head: dark wisps that circle and thin
      for (let i = s.count(5, dt); i > 0; i--) {
        const q0 = s.rand(0, TAU), c = EYES(T);
        s.add({ k: "smoke", x: c.x, y: c.y, z: c.z, life: s.rand(0.8, 1.2), r: s.rand(2.2, 3.2), lobes: lobes(s), R: RAMP.shadow, tone: 0.3, minor: i > 0, update(p, _s, dt2) { const q = q0 + p.age * 2.2; p.x = c.x + Math.cos(q) * 0.36 * T.size; p.y = c.y + Math.sin(q) * 0.14; p.z = c.z + p.age * 0.15; } });
      }
    },
  },

  broken: {
    family: false, gentle: true, material: "kinetic",
    start(s, M, T) {
      keep(s, { k: "cdCrack", x: T.x + 0.04, y: T.y, z: 0.6 * T.h, L: 14, seed: 3, R: RAMP.kinetic, update: still });
      keep(s, { k: "cdCrack", x: T.x - 0.1, y: T.y + 0.06, z: 0.35 * T.h, L: 9, seed: 8, R: RAMP.kinetic, update: still });
      keep(s, { k: "cdRim", x: T.x, y: T.y + 0.02, r: 0.56 * T.size, R: RAMP.kinetic, str: 0.75, dash: 7, crawl: 0, update: still });
    },
    loop(s, M, { T, dt }) {
      for (let i = s.count(2.5, dt); i > 0; i--) s.add({ k: "chunk", x: T.x + s.rand(-0.2, 0.2) * T.size, y: T.y, z: s.rand(0.3, 0.7) * T.h, vx: s.rand(-0.5, 0.5), vz: s.rand(0, 0.6), g: 8, bounce: 0.3, s: s.R() < 0.4 ? 2 : 1, life: 1, R: RAMP.kinetic, debris: true });
    },
  },

  clumsy: NONE,

  concealed: {
    family: false, gentle: true, material: "air",
    start(s, M, T) { keep(s, { k: "cnMist", x: T.x, y: T.y, r: 0.42 * T.size, h: T.h, n: 11, ph: 0.3, R: RAMP.air, update: still }); },
    loop(s, M, { at, T }) { at(2, () => ({ k: "mote", ...rimAt(T, s.rand(0, TAU), 0.5), z: s.rand(0.2, 0.8) * T.h, vx: s.rand(-0.15, 0.15), vz: 0.15, drag: 1, life: 1.2, R: RAMP.air, minor: true })); },
  },

  confused: {
    family: false, gentle: true, material: "mental",
    start(s, M, T) {
      const c = HEAD(T);
      keep(s, { k: "cnSpiral", ...c, z: c.z + 0.1, r: 7, turns: 1.5, R: RAMP.mental, update: still });
      s._cdQ = orbit(s, T, 3, (i) => ({ k: "icon", bm: ICONS.question, R: i === 1 ? RAMP.illusion : RAMP.mental }), { speed: 1.7, bob: 0.08 });
      keep(s, { k: "cdWash", x: T.x, y: T.y, size: T.size, h: T.h, R: RAMP.mental, t: 0.8, str: (t) => 0.25 + 0.25 * (0.5 + 0.5 * Math.sin(t * 3)), update: still });
      s.light(c.x, c.y, c.z, 0.9 * T.size, S(RAMP.mental, 0.85), 0.35, 1e9);
    },
    loop(s, M, { dt }) { if (s._cdQ) glitter(s, s._cdQ, RAMP.mental, 6, dt); },
  },

  controlled: {
    family: false, gentle: true, material: "mental",
    start(s, M, T) {
      keep(s, { k: "cnStrings", x: T.x, y: T.y, z: 0, size: T.size, h: T.h, R: RAMP.mental, update: still });
      wrap(s, T, RAMP.mental, { wash: (t) => 0.25 + 0.25 * throb(t, 1.2, 0.2), rim: 0.75, dash: 12, crawl: 0.8 });
      s.light(T.x, T.y - 0.25 * T.size, 1.75 * T.h, 0.9 * T.size, S(RAMP.mental, 0.85), 0.4, 1e9);
    },
    loop(s, M, { at, T }) { at(4, () => ({ k: "mote", x: T.x + s.rand(-0.25, 0.25), y: T.y - 0.25, z: 1.7 * T.h, vz: -0.6, drag: 1, life: 1.1, R: RAMP.mental, plus: s.R() < 0.4, minor: true })); },
  },

  cursebound: {
    family: false, gentle: true, material: "void",
    start(s, M, T) {
      const G = TRADITION_GLYPHS.occult, n = lvl(s) + 1;
      s._cdG = orbit(s, T, n, (i) => ({ k: "icon", bm: [G[i % G.length].slice(0, 3), G[i % G.length].slice(3, 6), G[i % G.length].slice(6, 9)].map((r) => r.replace(/1/g, "h").replace(/0/g, ".")), R: RAMP.void }), { rx: 0.48, ry: 0.2, speed: -1.1 });
      keep(s, { k: "cdCircle", x: T.x, y: T.y + 0.02, r: 0.62 * T.size, glyphs: G, n: 6, spin: -0.5, R: RAMP.void, update: still });
      keep(s, { k: "cdWash", x: T.x, y: T.y, size: T.size, h: T.h, R: RAMP.void, t: 0.55, str: (t) => 0.25 + 0.25 * throb(t, 2, 0.4), update: still });
      pool(s, T, RAMP.void, 0.35, 1.2);
    },
    loop(s, M, { at, T, dt }) {
      at(5 + lvl(s) * 2, () => ({ k: "wisp", ...rimAt(T, s.rand(0, TAU), 0.45), z: 0.05, vz: s.rand(0.4, 0.8), g: -0.2, drag: 1.2, life: s.rand(0.8, 1.2), s: 2, R: RAMP.void, minor: true }));
      if (s._cdG) glitter(s, s._cdG, RAMP.void, 4, dt);
    },
  },

  dazzled: {
    family: false, gentle: true, material: "light",
    start(s, M, T) {
      const e = EYES(T);
      keep(s, { k: "cnGlare", x: e.x + 0.1 * T.size, y: e.y, z: e.z, R: RAMP.light, update: still });
      keep(s, { k: "cdWash", x: T.x, y: T.y, size: T.size, h: T.h, R: RAMP.light, t: 0.9, str: (t) => 0.25 + 0.25 * (0.5 + 0.5 * Math.sin(t * 5)), update: still });
      s.light(e.x, e.y, e.z, 1.1 * T.size, S(RAMP.light, 0.9), 0.55, 1e9);
    },
    loop(s, M, { at, T }) { at(5, () => ({ k: "glint", x: T.x + s.rand(-0.45, 0.45) * T.size, y: T.y + s.rand(-0.2, 0.2), z: s.rand(0.4, 1.2) * T.h, life: 5 / 12, R: RAMP.light, big: s.R() < 0.3, minor: true, update: still })); },
  },

  deafened: {
    family: false, gentle: true, material: "sonic",
    start(s, M, T) {
      keep(s, { k: "cnMuffle", x: T.x, y: T.y + 0.02, z: 0.86 * T.h, w: 0.14 * T.size, R: RAMP.air, update: still });
      keep(s, { k: "cdRim", x: T.x, y: T.y + 0.02, r: 0.56 * T.size, R: RAMP.air, str: 0.6, dash: 6, crawl: -0.5, update: still });
    },
  },

  doomed: {
    family: false, gentle: true, material: "void",
    start(s, M, T) {
      const c = HEAD(T), n = lvl(s), R = n >= 3 ? RAMP.unholy : RAMP.void;
      keep(s, { k: "icon", bm: (p) => (p.lit ? ICONS.skullLit : ICONS.skull), ...c, z: c.z + 0.12, R, update(p, s2) { p.z = c.z + 0.12 + Math.sin(s2.t * 1.6) * 0.05; const f = Math.floor(s2.t * 12) % 30; p.lit = f < 3; p.dim = f < 3 ? 0 : 0.1; } });
      keep(s, { k: "cdPool", x: T.x, y: T.y + 0.02, r: (0.5 + n * 0.06) * T.size, R, rate: 1.2, update: still });
      keep(s, { k: "cdWash", x: T.x, y: T.y, size: T.size, h: T.h, R, t: 0.35, str: (t) => 0.25 + 0.25 * throb(t, 2.4, 0.5), update: still });
      s.light(c.x, c.y, c.z, 0.9 * T.size, S(R, 0.85), 0.4, 1e9);
    },
    loop(s, M, { at, T }) {
      const c = HEAD(T), R = lvl(s) >= 3 ? RAMP.unholy : RAMP.void;
      at(1.5 + lvl(s), () => ({ k: "mote", x: c.x + s.rand(-0.1, 0.1), y: c.y, z: c.z - 0.05, vz: -s.rand(0.3, 0.5), drag: 0.5, life: s.rand(0.9, 1.3), R }));
      at(2 + lvl(s) * 1.5, () => ({ k: "wisp", ...rimAt(T, s.rand(0, TAU), 0.42), z: 0.02, vz: s.rand(0.2, 0.45), drag: 1.5, life: s.rand(0.8, 1.2), s: 2, R: RAMP.void, minor: true }), false);
    },
  },

  drained: {
    family: false, gentle: true, material: "void",
    start(s, M, T) {
      keep(s, { k: "cdWash", x: T.x, y: T.y, size: T.size, h: T.h, R: RAMP.bleed, t: 0.85, str: (t) => 0.25 + 0.25 * (0.5 + 0.5 * Math.sin(t * 1.8)), update: still });
      keep(s, { k: "cdRim", x: T.x, y: T.y + 0.02, r: 0.56 * T.size, R: RAMP.bleed, str: 0.7, dash: 9, crawl: -1.2, update: still });
    },
    loop(s, M, { T, dt }) {
      // life pulled up out of the body: motes rise and bend in to a thread above the head
      for (let i = s.count(4 + lvl(s) * 3, dt); i > 0; i--) {
        const q = s.rand(0, TAU), d = s.rand(0.15, 0.42) * T.size, x0 = T.x + Math.cos(q) * d, y0 = T.y + Math.sin(q) * d, z0 = s.rand(0.1, 0.7) * T.h, c = HEAD(T);
        s.add({ k: "mote", x: x0, y: y0, z: z0, life: s.rand(0.9, 1.3), R: RAMP.bleed, plus: s.R() < 0.3, minor: i > 2, update(p) { const u = clamp(p.age / p.life), e = u * u; p.x = lerp(x0, c.x, e); p.y = lerp(y0, c.y, e); p.z = lerp(z0, c.z + 0.4, u); } });
      }
    },
  },

  dying: {
    family: false, gentle: true, material: "kinetic",
    start(s, M, T) {
      const c = HEAD(T), beat = 0.9 + lvl(s) * 0.25;
      keep(s, { k: "icon", ...c, z: c.z + 0.08, R: RAMP.bleed, beat, bm: (p, s2) => { const u = (s2.t % p.beat) / p.beat; return u < 2 / 12 || (u > 3 / 12 && u < 5 / 12) ? ICONS.heartHuge : ICONS.heartBig; }, update: still });
      keep(s, { k: "cdWash", x: T.x, y: T.y, size: T.size, h: T.h, R: RAMP.bleed, t: 0.65, str: (t) => 0.55 * throb(t, beat, 0.14), update: still });
      keep(s, { k: "cdRim", x: T.x, y: T.y + 0.02, r: 0.56 * T.size, R: RAMP.bleed, str: (t) => 0.45 + 0.55 * throb(t, beat, 0.2), dash: 10, crawl: 0, update: still });
      s.light(c.x, c.y, c.z, 0.8 * T.size, S(RAMP.bleed, 0.85), 0.3, 1e9);
    },
    loop(s, M, { at, T }) {
      const n = lvl(s), beat = 0.9 + n * 0.25;
      if (beatEdge(s, "_cnBeat", beat)) {
        const k = s._cnBeat;
        for (let i = 0; i < 2; i++) s.add({ k: "ring", x: T.x, y: T.y, r: (0.85 - i * 0.15) * T.size, life: 0.55, R: RAMP.bleed, wait: i * 0.22, seed: k * 2 + i, update: still });
        s.light(T.x, T.y, 0.6 * T.h, 1.4 * T.size, S(RAMP.bleed, 0.8), 0.5 / n + 0.2, 0.5);
      }
      at(1 + n * 0.6, () => ({ k: "drip", x: T.x + s.rand(-0.25, 0.25) * T.size, y: T.y + 0.05, z: s.rand(0.3, 0.6) * T.h, g: 5, life: 3, R: RAMP.bleed, onGround: splat }));
    },
  },

  encumbered: NONE,
  enfeebled: NONE,

  fascinated: {
    family: false, gentle: true, material: "mental",
    start(s, M, T) {
      const c = HEAD(T);
      keep(s, { k: "cnSpiral", ...c, z: c.z + 0.12, r: 8, turns: 1.6, R: RAMP.mental, update: still });
      keep(s, { k: "cdWash", x: T.x, y: T.y, size: T.size, h: T.h, R: RAMP.mental, t: 0.85, str: (t) => 0.25 + 0.25 * (0.5 + 0.5 * Math.sin(t * 2.4)), update: still });
      s.light(c.x, c.y, c.z, 1 * T.size, S(RAMP.mental, 0.85), 0.4, 1e9);
    },
    loop(s, M, { at, T }) {
      at(2.2, () => {
        const x0 = T.x + s.rand(-0.3, 0.3) * T.size, ph = s.rand(0, TAU);
        return { k: "icon", bm: ICONS.heart, x: x0, y: T.y - 0.3 * T.size, z: 1.05 * T.h, life: 1.7, R: RAMP.mental, snap: false, update(p, _s, dt) { p.z += 0.35 * dt; p.x = x0 + Math.sin(ph + p.age * 3) * 0.08; } };
      });
    },
  },

  fatigued: NONE,

  fleeing: {
    family: false, gentle: true, material: "fire",
    start(s, M, T) {
      const c = HEAD(T);
      keep(s, { k: "icon", bm: ICONS.bang, ...c, x: c.x - 0.12, R: RAMP.fire, update(p, s2) { p.z = c.z + (Math.floor(s2.t * 6) % 2) * 0.05; } });
      keep(s, { k: "cdRim", x: T.x, y: T.y + 0.02, r: 0.56 * T.size, R: RAMP.fire, str: (t) => 0.5 + 0.5 * throb(t, 0.35, 0.1), dash: 8, crawl: -3, update: still });
      keep(s, { k: "icon", bm: ICONS.bang, ...c, x: c.x + 0.12, R: RAMP.fire, update(p, s2) { p.z = c.z + (Math.floor(s2.t * 6 + 1) % 2) * 0.05; } });
    },
    loop(s, M, { at, T }) {
      at(5, () => ({ k: "smoke", x: T.x - 0.3 * T.size, y: T.y + 0.15, z: 0.04, vx: -s.rand(0.6, 1.2), vz: 0.15, drag: 3, r: s.rand(2.6, 3.8), life: 0.7, lobes: lobes(s), R: RAMP.kinetic, tone: 0.6 }), false);
      at(9, () => ({ k: "streak", x: T.x - 0.4 * T.size, y: T.y + s.rand(-0.25, 0.25), z: s.rand(0.2, 1) * T.h, vx: -6, life: 0.16, R: RAMP.kinetic, minor: true, update(p, _s, dt) { p.x += p.vx * dt; } }));
      at(1.5, () => { const side = s.R() < 0.5 ? -1 : 1; return { k: "icon", bm: ICONS.drop, x: T.x + side * 0.22 * T.size, y: T.y, z: 0.95 * T.h, life: 0.8, R: RAMP.cold, snap: false, update(p, _s, dt) { p.vz = (p.vz ?? 0.4) - 2.4 * dt; p.z += p.vz * dt; p.x += side * 0.2 * dt; } }; });
    },
  },

  friendly: NONE,

  frightened: {
    family: false, gentle: true, material: "mental",
    start(s, M, T) {
      keep(s, { k: "cnShiver", x: T.x, y: T.y + 0.02, z: 0.98 * T.h, w: 0.14 * T.size, n: Math.min(3, lvl(s)), R: RAMP.cold, update: still });
      keep(s, { k: "cdWash", x: T.x, y: T.y, size: T.size, h: T.h, R: RAMP.shadow, t: 0.45, str: (t) => (Math.floor(t * 12) % 4 === 0 ? 0.5 : 0.25), update: still });
      keep(s, { k: "cdPool", x: T.x, y: T.y + 0.02, r: (0.45 + lvl(s) * 0.05) * T.size, R: RAMP.shadow, rate: 6, update: still });
    },
    loop(s, M, { at, T }) {
      at(lvl(s) * 2.5, () => ({ k: "wisp", ...rimAt(T, s.rand(0, TAU), 0.45), z: 0.02, vz: s.rand(0.3, 0.6), drag: 1.5, life: s.rand(0.6, 1), s: 2, R: RAMP.shadow, minor: true }), false);
      at(1.2 + lvl(s) * 0.9, () => {
        const side = s.R() < 0.5 ? -1 : 1;
        return { k: "icon", bm: ICONS.drop, x: T.x + side * 0.2 * T.size, y: T.y, z: 1 * T.h, life: 0.9, R: RAMP.cold, from: 0.6, snap: false, update(p, _s, dt) { p.vz = (p.vz ?? 0.3) - 2.2 * dt; p.z += p.vz * dt; p.x += side * 0.14 * dt; } };
      });
    },
  },

  grabbed: {
    family: false, gentle: true, material: "wood",
    start(s, M, T) {
      // the rope bites in on a slow squeeze: tightening, easing, tightening
      keep(s, { k: "cnBand", style: "rope", thick: true, x: T.x, y: T.y, z: 0.45 * T.h, r: 0.33 * T.size, R: RAMP.wood, update(p, s2) { p.r = (0.33 + Math.max(0, 0.25 - s2.t) * 1.2 - 0.02 * throb(s2.t, 1.6, 0.2)) * T.size; } });
      keep(s, { k: "cnBand", style: "rope", x: T.x, y: T.y, z: 0.7 * T.h, r: 0.3 * T.size, topSkip: true, R: RAMP.wood, update: still });
      keep(s, { k: "cdRim", x: T.x, y: T.y + 0.02, r: 0.6 * T.size, R: RAMP.wood, str: 0.6, dash: 12, crawl: 0, update: still });
    },
    loop(s, M, { T }) {
      if (beatEdge(s, "_cdSqueeze", 1.6)) for (let i = 0; i < 4; i++) s.add({ k: "mote", ...rimAt(T, s.rand(0, TAU), 0.48), z: 0.45 * T.h, vz: 0.4, drag: 2, life: 0.5, R: RAMP.wood, minor: i > 1 });
    },
  },

  helpful: NONE,
  hidden: NONE,
  hostile: NONE,

  immobilized: {
    family: false, gentle: true, material: "metal",
    start(s, M, T) {
      keep(s, { k: "cnBand", style: "chain", thick: true, x: T.x, y: T.y + 0.02, z: 0.02, r: 0.48 * T.size, R: RAMP.metal, update: still });
      for (let i = 0; i < 4; i++) {
        const q = Math.PI / 4 + (i * TAU) / 4, p = rimAt(T, q, 0.5);
        keep(s, { k: "icon", bm: ICONS.stake, ...p, z: 0.1, R: RAMP.metal, update: still });
      }
      keep(s, { k: "cdRim", x: T.x, y: T.y + 0.02, r: 0.62 * T.size, R: RAMP.metal, str: 0.55, dash: 16, crawl: 0, update: still });
    },
    loop(s, M, { T }) {
      if (beatEdge(s, "_cdClank", 2)) s.add({ k: "glint", ...rimAt(T, s.rand(0, TAU), 0.48), z: 0.1, big: true, life: 5 / 12, R: RAMP.metal, update: still });
    },
  },

  indifferent: NONE,

  invisible: {
    family: false, gentle: true, material: "illusion",
    start(s, M, T) { keep(s, { k: "cnOutline", x: T.x, y: T.y, size: T.size, h: T.h, R: RAMP.illusion, update: still }); },
    loop(s, M, { at, T }) {
      at(4, () => ({ k: "glint", ...rimAt(T, s.rand(0, TAU), s.rand(0.3, 0.5)), z: s.rand(0.2, 1) * T.h, life: 5 / 12, R: RAMP.illusion, minor: true, update: still }));
      at(3, () => ({ k: "mote", ...rimAt(T, s.rand(0, TAU), 0.46), z: s.rand(0.1, 0.8) * T.h, vz: 0.3, drag: 1, life: 0.8, R: RAMP.illusion, minor: true }));
    },
  },

  malevolence: {
    family: false, gentle: true, material: "unholy",
    start(s, M, T) {
      s._cdM = orbit(s, T, 3, () => ({ k: "icon", bm: ICONS.shard, R: RAMP.unholy }), { rx: 0.5, ry: 0.2, speed: -1.4 });
      keep(s, { k: "cdPool", x: T.x, y: T.y + 0.02, r: 0.56 * T.size, R: RAMP.unholy, rate: 1.6, update: still });
      keep(s, { k: "cdWash", x: T.x, y: T.y, size: T.size, h: T.h, R: RAMP.unholy, t: 0.6, str: (t) => 0.25 + 0.25 * throb(t, 1.8, 0.3), update: still });
      pool(s, T, RAMP.unholy, 0.35, 1.2);
    },
    loop(s, M, { at, T, dt }) {
      at(6, () => ({ k: "wisp", ...rimAt(T, s.rand(0, TAU), 0.45), z: 0.05, vz: s.rand(0.4, 0.8), g: -0.3, drag: 1.5, life: s.rand(0.7, 1.1), s: 2, R: RAMP.unholy }));
      if (s._cdM) glitter(s, s._cdM, RAMP.unholy, 4, dt);
    },
  },

  observed: NONE,
  "off-guard": NONE,

  paralyzed: {
    family: false, gentle: true, material: "electricity",
    start(s, M, T) {
      const spots = [];
      for (let i = 0; i < 7; i++) {
        const q = (i / 7) * TAU + 0.4, p = { x: T.x + Math.cos(q) * 0.36 * T.size, y: T.y + Math.sin(q) * 0.16 * T.size, z: (0.2 + ((i * 3) % 7) * 0.12) * T.h };
        spots.push(p);
        keep(s, { k: "icon", bm: ICONS.spike, ...p, R: RAMP.holy, dim: Math.sin(q) < 0 ? 0.15 : 0, update: still });
      }
      s._cnSpots = spots;
      keep(s, { k: "cdWash", x: T.x, y: T.y, size: T.size, h: T.h, R: RAMP.light, t: 0.85, str: (t) => (hash(Math.floor(t * 12), 9) > 0.6 ? 0.5 : 0.25), update: still });
      keep(s, { k: "cdRim", x: T.x, y: T.y + 0.02, r: 0.58 * T.size, R: RAMP.light, str: 0.8, dash: 14, crawl: 3, update: still });
      s.light(T.x, T.y, 0.5 * T.h, 1.2 * T.size, S(RAMP.light, 0.85), 0.45, 1e9, { flicker: true });
    },
    loop(s, M, { dt }) {
      const sp = s._cnSpots; if (!sp) return;
      for (let i = s.count(9, dt); i > 0; i--) {
        const a = sp[Math.floor(s.R() * sp.length)], b = sp[Math.floor(s.R() * sp.length)];
        if (a !== b) s.add({ k: "bolt", a: [a.x, a.y, a.z], b: [b.x, b.y, b.z], life: 0.09, R: RAMP.light, seed: s.seedInt(), update: still });
      }
    },
  },

  petrified: {
    family: false, gentle: true, material: "earth",
    start(s, M, T) {
      keep(s, { k: "cnStone", x: T.x, y: T.y, size: T.size, hgt: 1.0 * T.h, R: RAMP.kinetic, seed: 5, update: still });
      keep(s, { k: "cdCrack", x: T.x + 0.05, y: T.y, z: 0.55 * T.h, L: 12, seed: 4, R: RAMP.kinetic, wait: 2.3, update: still });
      keep(s, { k: "cdRim", x: T.x, y: T.y + 0.02, r: 0.56 * T.size, R: RAMP.earth, str: 0.7, fill: 0.45, dash: 6, crawl: 0, update: still });
    },
    loop(s, M, { at, T }) {
      // grit spat off the creeping edge while it climbs, then the odd chip once it holds
      at(s.t < 2.2 ? 14 : 1.5, () => ({ k: "chunk", x: T.x + s.rand(-0.3, 0.3) * T.size, y: T.y + 0.05, z: s.rand(0.1, 0.6) * T.h, vx: s.rand(-0.6, 0.6), vz: s.rand(0.2, 1), g: 8, bounce: 0.2, s: s.R() < 0.3 ? 2 : 1, life: 1, R: RAMP.kinetic, debris: true }), false);
    },
  },

  prone: {
    family: false, gentle: true, material: "kinetic",
    start(s, M, T) {
      dust(s, T, 8);
      for (let i = 0; i < 6; i++) s.add({ k: "chunk", x: T.x, y: T.y, z: 0.15, vx: s.rand(-1.4, 1.4), vy: s.rand(-0.5, 0.5), vz: s.rand(0.8, 1.8), g: 9, bounce: 0.3, s: 1 + (i % 2), life: 1.2, R: RAMP.kinetic, debris: true });
      keep(s, { k: "cnShadow", x: T.x + 0.14 * T.size, y: T.y + 0.1, r: 0.62 * T.size, R: RAMP.smoke, update: still });
      keep(s, { k: "cdRim", x: T.x, y: T.y + 0.02, r: 0.56 * T.size, R: RAMP.air, str: 0.6, dash: 8, crawl: 0, update: still });
      const c = HEAD(T);
      keep(s, { k: "icon", bm: ICONS.down, ...c, R: RAMP.air, update(p, s2) { p.z = c.z - ((Math.floor(s2.t * 4) % 4) * 0.04); } });
    },
    loop(s, M, { at, T }) { at(1.5, () => ({ k: "smoke", x: T.x + s.rand(-0.4, 0.4) * T.size, y: T.y + 0.15, z: 0.02, vx: s.rand(-0.3, 0.3), vz: 0.05, drag: 3, r: s.rand(2.4, 3.4), life: 0.9, lobes: lobes(s), R: RAMP.kinetic, tone: 0.6, minor: true }), false); },
  },

  quickened: {
    family: false, gentle: true, material: "light",
    start(s, M, T) {
      keep(s, { k: "cnBand", style: "rune", crawl: true, x: T.x, y: T.y + 0.02, z: 0.02, r: 0.56 * T.size, R: RAMP.holy, update: still });
      keep(s, { k: "cdWash", x: T.x, y: T.y, size: T.size, h: T.h, R: RAMP.holy, t: 0.9, str: (t) => 0.25 + 0.25 * throb(t, 0.5, 0.12), update: still });
      pool(s, T, RAMP.holy, 0.35, 1.2);
    },
    loop(s, M, { at, T }) {
      at(18, () => {
        const z = s.rand(0.1, 1) * T.h, y = T.y + s.rand(-0.3, 0.3) * T.size;
        return { k: "streak", x: T.x - 0.7 * T.size, y, z, vx: s.rand(6, 8), life: 0.24, R: s.R() < 0.35 ? RAMP.air : RAMP.light, update(p, _s, dt) { p.x += p.vx * dt; } };
      });
      at(3, () => ({ k: "glint", ...rimAt(T, s.rand(0, TAU), 0.56), z: 0.05, life: 5 / 12, R: RAMP.light, minor: true, update: still }), false);
    },
  },

  restrained: {
    family: false, gentle: true, material: "metal",
    start(s, M, T) {
      for (const [z, r] of [[0.3, 0.32], [0.62, 0.29]]) keep(s, { k: "cnBand", style: "chain", thick: true, x: T.x, y: T.y, z: z * T.h, r: r * T.size, sag: 0.5, topSkip: z > 0.5, R: RAMP.metal, update(p, s2) { p.r = (r + Math.max(0, 0.3 - s2.t) * 1.1) * T.size; } });
      keep(s, { k: "icon", bm: ICONS.lock, x: T.x + 0.3 * T.size, y: T.y + 0.06, z: 0.46 * T.h, R: RAMP.metal, update(p, s2) { p.z = 0.46 * T.h + Math.sin(s2.t * 2) * 0.03; } });
      keep(s, { k: "cdRim", x: T.x, y: T.y + 0.02, r: 0.6 * T.size, R: RAMP.metal, str: 0.6, dash: 16, crawl: 0, update: still });
    },
    loop(s, M, { T }) {
      if (beatEdge(s, "_cdStrain", 1.8)) for (let i = 0; i < 3; i++) s.add({ k: "glint", ...rimAt(T, s.rand(0, TAU), 0.46), z: s.rand(0.3, 0.6) * T.h, life: 5 / 12, R: RAMP.metal, wait: i * 0.07, minor: i > 0, update: still });
    },
  },

  sickened: {
    family: false, gentle: true, material: "poison",
    start(s, M, T) {
      const c = HEAD(T);
      keep(s, { k: "cnSpiral", ...c, z: c.z + 0.08, r: 6 + lvl(s) * 0.7, turns: 1.5, spin: -1, R: RAMP.poison, update: still });
      wrap(s, T, RAMP.poison, { wash: (t) => 0.25 + 0.25 * (0.5 + 0.5 * Math.sin(t * 2.2)), washT: 0.7, rim: 0.7, fill: 0.5, dash: 8, crawl: -0.6 });
    },
    loop(s, M, { T, dt }) {
      for (let i = s.count(2 + lvl(s) * 1.5, dt); i > 0; i--) {
        const q = s.rand(0, TAU), d = s.rand(0.05, 0.38), x0 = T.x + Math.cos(q) * d * T.size;
        s.add({ k: "cdBubble", x: x0, y: T.y + Math.sin(q) * d * T.size, z: s.rand(0.2, 0.7) * T.h, vz: s.rand(0.3, 0.5), sz: s.rand(1.5, 3), life: s.rand(0.7, 1.1), R: RAMP.poison, minor: i > 1, update(p, _s, dt2) { p.z += p.vz * dt2; } });
      }
    },
  },

  slowed: {
    family: false, gentle: true, material: "arcane",
    start(s, M, T) {
      keep(s, { k: "cnClock", x: T.x, y: T.y + 0.02, r: 0.72 * T.size, beat: 0.45 + lvl(s) * 0.2, R: RAMP.arcane, update: still });
      keep(s, { k: "cdWash", x: T.x, y: T.y, size: T.size, h: T.h, R: RAMP.arcane, t: 0.8, str: 0.25, update: still });
    },
    loop(s, M, { T }) {
      const beat = 0.45 + lvl(s) * 0.2;
      if (beatEdge(s, "_cdTick", beat)) {
        s.light(T.x, T.y, 0.2, 1.2 * T.size, S(RAMP.arcane, 0.85), 0.5, beat * 0.8);
        // a drop sinking in slow motion: it hangs, falls, and its ring spreads slow
        s.add({ k: "drip", ...rimAt(T, s.rand(0, TAU), 0.3), z: 0.8 * T.h, g: 0.9, drag: 0.4, life: 2.2, R: RAMP.arcane, onGround: (p, s2) => { p.life = 0; s2.add({ k: "ring", x: p.x, y: p.y, r: 0.35, life: 1.1, R: RAMP.arcane, update: still }); } });
      }
    },
  },

  stunned: {
    family: false, gentle: true, material: "light",
    start(s, M, T) {
      const n = Math.min(5, lvl(s) + 2);
      s._cdStars = orbit(s, T, n, () => ({ k: "icon", R: RAMP.light, bm: (p) => (p.near ? ICONS.star : ICONS.starSmall) }), { speed: 2.8, rx: 0.5, ry: 0.2 });
      const c = HEAD(T);
      s.light(c.x, c.y, c.z, 1.1 * T.size, S(RAMP.light, 0.9), 0.5, 1e9);
      keep(s, { k: "cdWash", x: T.x, y: T.y, size: T.size, h: T.h, R: RAMP.light, t: 0.9, str: (t) => 0.25 + 0.25 * (0.5 + 0.5 * Math.sin(t * 6)), update: still });
    },
    loop(s, M, { T, dt }) {
      if (s._cdStars) glitter(s, s._cdStars, RAMP.light, 14, dt);
      for (let i = s.count(4, dt); i > 0; i--) { const c = HEAD(T), q = s.rand(0, TAU); s.add({ k: "glint", x: c.x + Math.cos(q) * 0.5 * T.size, y: c.y + Math.sin(q) * 0.2, z: c.z + s.rand(-0.1, 0.25), life: 5 / 12, R: RAMP.light, minor: true, update: still }); }
    },
  },

  stupefied: NONE,

  unconscious: {
    family: false, gentle: true, material: "illusion",
    start(s, M, T) {
      keep(s, { k: "cdWash", x: T.x, y: T.y, size: T.size, h: T.h, R: RAMP.illusion, t: 0.55, str: (t) => 0.25 + 0.25 * (0.5 + 0.5 * Math.sin((t * TAU) / 3)), update: still });
      keep(s, { k: "cnShadow", x: T.x, y: T.y + 0.08, r: 0.5 * T.size, R: RAMP.smoke, update: still });
    },
    loop(s, M, { T, dt }) {
      if (beatEdge(s, "_cnZ", 0.8)) {
        const c = HEAD(T), k = s._cnZ, x0 = c.x + 0.05 + (k % 2) * 0.08;
        s.add({ k: "icon", x: x0, y: c.y, z: c.z - 0.1, life: 2.4, R: RAMP.illusion, from: 0.7, snap: false, bm: (p) => (p.age < 0.8 ? ICONS.z : ICONS.Z), update(p, _s, dt2) { p.z += 0.26 * dt2; p.x = x0 + p.age * 0.16 + Math.sin(p.age * 3) * 0.05; } });
      }
      for (let i = s.count(2, dt); i > 0; i--) s.add({ k: "mote", ...rimAt(T, s.rand(0, TAU), s.rand(0.2, 0.5)), z: s.rand(0.6, 1.1) * T.h, vz: 0.2, drag: 1, life: 1.2, R: RAMP.illusion, plus: s.R() < 0.3, minor: true });
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
