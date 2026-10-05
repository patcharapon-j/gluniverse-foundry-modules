/**
 * Spotlight Roll · Monolith — the stele's geometry.
 *
 * Pure maths, no DOM and no game: the slab, its engraving, its outline and its
 * fracture, all in CSS px. The backdrop fragment re-derives the slab from the
 * die (uDie / uDieR) with the SAME formulas, so a change here is a change
 * there (fragment.mjs).
 *
 * The gauge is laid out from the DC line, never from a result: the success
 * band is the die (the DC line just under it, the critical line just over it),
 * and every register and ruler tick is placed relative to that line, so the
 * slab can be drawn before anyone knows the roll — or the DC.
 */
import { TUMBLE } from "../tumble.mjs";

export const TAU = Math.PI * 2;
export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const outQuart = (t) => 1 - Math.pow(1 - clamp01(t), 4);
export const outExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp01(t)));
export const inOutQuart = (t) => { t = clamp01(t); return t < 0.5 ? 8 * t ** 4 : 1 - Math.pow(-2 * t + 2, 4) / 2; };
export const lin = (c) => c.map((x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
export const f1 = (n) => n.toFixed(1);
export const SPIN_PEAK = TUMBLE.spinPeak;

/* ── path builders (slab-local px, y down) ─────────────────────────────── */

export const seg = (a, b) => `M${f1(a[0])},${f1(a[1])}L${f1(b[0])},${f1(b[1])}`;
export const poly = (pts, close = false) => pts.map((p, i) => `${i ? "L" : "M"}${f1(p[0])},${f1(p[1])}`).join("") + (close ? "Z" : "");
export const circ = (cx, cy, r) => `M${f1(cx - r)},${f1(cy)}a${f1(r)},${f1(r)} 0 1,0 ${f1(2 * r)},0a${f1(r)},${f1(r)} 0 1,0 ${f1(-2 * r)},0`;
export const polar = (cx, cy, r, a) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
export function arc(cx, cy, r, a0, a1) {
  const [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1);
  return `M${f1(x0)},${f1(y0)}A${f1(r)},${f1(r)} 0 ${a1 - a0 > Math.PI ? 1 : 0},1 ${f1(x1)},${f1(y1)}`;
}
/** Deterministic jitter, so a crack is the same crack on every client and every seek. */
export const jit = (i, k = 0) => { const s = Math.sin(i * 127.1 + k * 311.7 + 7.3) * 43758.5453; return s - Math.floor(s); };

/* ── layout: every dimension derives from the viewport, and the shader
      re-derives the slab from uDie/uDieR with the SAME formulas ─────────── */

/** Does this model check against a DC at all? A DC hidden from this viewer still counts. */
export const hasDcOf = (model, o = {}) => o.dc != null || model.dc?.value != null || model.dc?.mode === "hidden";

/**
 * Lay out one stele. `o` overrides the single-stele defaults (the colonnade
 * and the duel pass their own size, centre and widths).
 *
 * `dc` on the result is MUTABLE: at mount it may be unknown (hidden from this
 * viewer, or no DC at all), and the throw sets it. Every position is relative
 * to the DC line, so nothing has to move when it does; `yOf`, `lo` and `hi`
 * read it live.
 */
export function geom(model, o = {}) {
  const W = globalThis.innerWidth ?? 1600, H = globalThis.innerHeight ?? 900, m = Math.min(W, H);
  const size = o.size ?? Math.max(110, Math.min(280, m * 0.235));
  const u = size / 212;
  const gap = 10 * u;
  const ppu = (size + 2 * gap) / 10;          // px per point of total: the success band is exactly the die
  const cx = o.cx ?? W / 2;
  const slabTop = o.slabTop ?? Math.round(H * 0.04);
  const topH = (o.compact ? 86 : 172) * u;     // the shader re-derives both (single: 172, colonnade: 86)
  const dieY = slabTop + topH + 26 * u + size / 2;
  const critY = dieY - size / 2 - gap;          // DC + 9.5
  const dcY = dieY + size / 2 + gap;            // DC − 0.5
  const slabBottom = dcY + 10.5 * ppu;          // DC − 11
  const slabW = o.slabW ?? Math.min(size * 2.3, W - 32);
  const slabH = slabBottom - slabTop;
  const plinthW = o.plinthW ?? Math.min(slabW * 1.36, W - 24);
  const plinthH = o.plinthH ?? Math.max(136 * u, 104);
  const cham = (o.compact ? 22 : 30) * u;
  const headBottom = o.compact ? cham + 52 * u : cham + 4 * u + 128 * u + (model.roll?.fortune ? 22 * u : 0);
  const dcIn = o.dc ?? model.dc?.value ?? null;
  return {
    W, H, m, size, u, gap, ppu, cx, slabTop, topH, dieY, critY, dcY, slabBottom, slabW, slabH,
    slabX: cx - slabW / 2, headBottom, plinthW, plinthH, plinthX: cx - plinthW / 2, cham, compact: !!o.compact,
    hasDc: hasDcOf(model, o),
    dc: dcIn ?? (model.modTotal ?? 0) + 7,       // a placeholder until the throw names the DC (or, with none, the total)
    yOf(v) { return this.dcY - (v - (this.dc - 0.5)) * this.ppu; },
    get lo() { return this.dc - 0.5 - (this.slabBottom - this.dcY) / this.ppu; },
    get hi() { return this.dc - 0.5 + (this.dcY - this.slabTop) / this.ppu; },
    /** Ruler steps relative to the DC line: r points above (DC + r). Independent of the DC's value. */
    rSpan: [Math.ceil(-0.5 - (slabBottom - dcY) / ppu), Math.floor(-0.5 + (dcY - slabTop) / ppu)],
    dx: slabW / 2, dy: dieY - slabTop,          // die centre, slab-local
  };
}

/** The engraving: line groups (drawn in with a dash) and mark groups (faded in). */
export function engraving(g, nMods) {
  const compact = g.compact;
  const { slabW: w, slabH: h, size, u, dx, dy, cham } = g;
  const lines = [], marks = [];
  const L = (cls, d) => lines.push({ cls, d });
  const M = (cls, d) => marks.push({ cls, d });

  // Inner frame, following the chamfer.
  const i = 9 * u, c = cham + 2 * u;
  L("frame", poly([[i + c * 0.62, i], [w - i - c * 0.62, i], [w - i, i + c * 0.62], [w - i, h - i], [i, h - i], [i, i + c * 0.62]], true));

  // The d20 net, face-on: pointy-top hexagon, the up-triangle of the front
  // face, and the nine spokes that make it read as a die and not a hex.
  const R = (compact ? 0.7 : 0.8) * size, ri = (compact ? 0.56 : 0.58) * size;
  const hex = [0, 1, 2, 3, 4, 5].map((k) => polar(dx, dy, R, -Math.PI / 2 + (k * Math.PI) / 3));
  const tri = [0, 1, 2].map((k) => polar(dx, dy, ri, -Math.PI / 2 + (k * TAU) / 3));
  for (let k = 0; k < 6; k++) L("hex", seg(hex[k], hex[(k + 1) % 6]));
  for (let k = 0; k < 3; k++) L("tri", seg(tri[k], tri[(k + 1) % 3]));
  // tri[0] top, tri[1] lower-right, tri[2] lower-left; hex[0] top, then clockwise.
  [[0, 0], [0, 1], [0, 5], [1, 1], [1, 2], [1, 3], [2, 3], [2, 4], [2, 5]].forEach(([t, k]) => L("spoke", seg(tri[t], hex[k])));

  // Twenty ticks on the die's own ring — one per face.
  const rr = (compact ? 0.53 : 0.54) * size;
  L("ring", circ(dx, dy, rr));
  let ticks = "";
  for (let k = 0; k < 20; k++) {
    const a = -Math.PI / 2 + (k * TAU) / 20;
    ticks += seg(polar(dx, dy, rr, a), polar(dx, dy, rr + (k % 5 ? 5 : 10) * u, a));
  }
  M("ticks", ticks);

  // Astrolabe arcs either side, ticked every 6°.
  const ra = 1.0 * size;
  const arcs = compact ? [] : [[Math.PI - 0.62, Math.PI + 0.62], [-0.62, 0.62]];
  arcs.forEach(([a0, a1]) => L("arc", arc(dx, dy, ra, a0, a1)));
  let aticks = "";
  arcs.forEach(([a0, a1]) => { for (let a = a0; a <= a1 + 1e-6; a += 0.1047) aticks += seg(polar(dx, dy, ra, a), polar(dx, dy, ra - 6 * u, a)); });
  if (aticks) M("aticks", aticks);

  // Spine: above the die to the inscription, below it to the plinth.
  if (dy - R - 8 * u > g.headBottom + 10 * u) L("spine", seg([dx, dy - R - 8 * u], [dx, g.headBottom + 10 * u]));
  L("spine", seg([dx, dy + R + 4 * u], [dx, h - i]));

  // Conduits: one per modifier, from its chip on the plinth straight into the die.
  const conduits = [];
  const nC = compact ? 3 : nMods;
  for (let k = 0; k < nC; k++) {
    const cxp = compact ? w * (0.2 + 0.3 * k) : g.plinthX + g.plinthW * (k + 0.5) / nMods - g.slabX;   // chip centre x, slab-local
    const base = [cxp, h + (compact ? 26 : 40) * u];                     // chip row sits below the slab
    const dir = [dx - base[0], dy - base[1]], len = Math.hypot(dir[0], dir[1]);
    const t0 = (base[1] - (h - i)) / (base[1] - dy);                      // enter at the inner frame
    const p0 = [base[0] + dir[0] * t0, base[1] + dir[1] * t0];
    const p1 = [dx - (dir[0] / len) * rr, dy - (dir[1] / len) * rr];
    conduits.push({ d: seg(p0, p1), base, p0, p1 });
    L("conduit", seg(p0, p1));
  }

  // Nodes at the net's vertices; registration crosses at the sigil's corners.
  let nodes = "";
  [...hex, ...tri].forEach(([x, y]) => { nodes += circ(x, y, 2.4 * u); });
  M("nodes", nodes);
  let crosses = "";
  const cr = 6 * u, ox = Math.min(1.02 * size, w / 2 - (compact ? 16 : 22) * u), oy = (compact ? 0.86 : 1.0) * size;
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
    const x = dx + sx * ox, y = dy + sy * oy;
    crosses += seg([x - cr, y], [x + cr, y]) + seg([x, y - cr], [x, y + cr]);
  });
  M("cross", crosses);

  // The ruler down the right edge: a tick per point of total, majors on the
  // DC's own fives so the scale is anchored to the line that matters.
  let ruler = "";
  const rx = w - i - 4 * u;
  for (let r = g.rSpan[0]; r <= g.rSpan[1]; r++) {
    const y = g.dcY - (r + 0.5) * g.ppu - g.slabTop;
    if (y < cham + 12 * u || y > h - i - 2) continue;
    const major = r % 5 === 0;
    ruler += seg([rx, y], [rx - (major ? 14 : 6) * u, y]);
  }
  M("ruler", ruler);

  return { lines, marks, conduits };
}

/** The slab perimeter, for the outline and the racing edge light. */
export function outlinePath(g) {
  const { slabW: w, slabH: h, cham: c } = g;
  const k = 1.5;   // inside the slab's own clip, or the clip eats half the stroke and all of its glow
  return poly([[c + k * 0.4, k], [w - c - k * 0.4, k], [w - k, c + k * 0.4], [w - k, h - k], [k, h - k], [k, c + k * 0.4]], true);
}

/** Wedge shards radiating from the die, sharing jittered crack polylines. */
export function shardGeometry(g, turn = 0.35) {
  const { slabW: w, slabH: h, dx, dy } = g;
  const N = 7;
  const angles = [];
  for (let k = 0; k < N; k++) angles.push(-Math.PI / 2 + turn + (k + (jit(k) - 0.5) * 0.55) * (TAU / N));
  const hit = (a) => {
    const vx = Math.cos(a), vy = Math.sin(a);
    const tx = vx > 0 ? (w - dx) / vx : vx < 0 ? -dx / vx : Infinity;
    const ty = vy > 0 ? (h - dy) / vy : vy < 0 ? -dy / vy : Infinity;
    const t = Math.min(tx, ty);
    return [dx + vx * t, dy + vy * t];
  };
  const rays = angles.map((a, k) => {
    const end = hit(a), len = Math.hypot(end[0] - dx, end[1] - dy);
    const nx = -Math.sin(a), ny = Math.cos(a);
    const pts = [[dx, dy]];
    for (const [f, kk] of [[0.22, 1], [0.48, 2], [0.74, 3]]) {
      const off = (jit(k, kk) - 0.5) * 0.09 * len;
      pts.push([dx + Math.cos(a) * len * f + nx * off, dy + Math.sin(a) * len * f + ny * off]);
    }
    pts.push(end);
    return { a, pts };
  });
  const corners = [[w, 0], [w, h], [0, h], [0, 0]].map((p) => ({ p, a: Math.atan2(p[1] - dy, p[0] - dx) }));
  const norm = (a, base) => { while (a < base) a += TAU; while (a >= base + TAU) a -= TAU; return a; };
  const shards = [];
  for (let k = 0; k < N; k++) {
    const A = rays[k], B = rays[(k + 1) % N];
    const a0 = A.a, a1 = norm(B.a, a0);
    const between = corners.map((c) => ({ ...c, n: norm(c.a, a0) })).filter((c) => c.n > a0 && c.n < a1).sort((x, y) => x.n - y.n);
    const pts = [...A.pts, ...between.map((c) => c.p), ...B.pts.slice().reverse().slice(0, -1)];
    const mid = norm((a0 + a1) / 2, -Math.PI);
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    shards.push({ pts, mid, cy });
  }
  // Secondary branch cracks so the web is not only spokes.
  let branches = "";
  rays.forEach((r, k) => {
    const p = r.pts[2], a = r.a + (jit(k, 9) > 0.5 ? 0.7 : -0.7), l = 0.35 * g.size;
    branches += seg(p, [p[0] + Math.cos(a) * l, p[1] + Math.sin(a) * l]);
  });
  const ring = circ(dx, dy, 0.62 * g.size);
  return { shards, crackLines: rays.map((r) => poly(r.pts)), branches, ring };
}

