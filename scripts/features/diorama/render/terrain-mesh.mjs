/**
 * Diorama — terrain geometry builder. Pure: no three, no DOM.
 *
 * Turns a Terrain (terrain/model.mjs) into flat typed arrays the renderer wraps
 * in BufferGeometry, and the check tool inspects under plain Node.
 *
 * World space: 1 unit = 1 cell; x = sub-column / SUB, z = sub-row / SUB,
 * y = q / Q_PER_CELL.
 *
 *   tops    the walkable faces. Flat runs of equal height with no occlusion are
 *           merged along a sub-row. Stairs are treads (plus the risers between
 *           them, emitted as sides), ramps a slope. Attributes: position,
 *           normal, ao (0..1, baked corner occlusion), tint (rgb multiplier:
 *           pits dark, water beds blue-grey).
 *   sides   every vertical face where a neighbour is lower, down to that
 *           neighbour, or down to the diorama base at an edge / next to void.
 *           Attributes: position, normal, lip (world xz of the cliff lip, just
 *           inside the higher sub-cell: where the map colour is sampled), depth
 *           (cells below the lip), drop (cells from lip to bottom at this
 *           point), along (world coordinate along the edge), mat (index into
 *           CLIFF_MATERIALS), flag (1 = the bottom meets ground, so it gets
 *           contact AO; +2 = it falls into a pit, so it fades to dark; +4 = it
 *           stands in water, so it draws a waterline; 0 = the board's own
 *           edge, which ends in the plinth).
 *   water   the animated surfaces, slightly below each water sub-cell's top.
 *           Attributes: position, shore (1 at corners that touch a bank).
 *
 * VOID sub-cells emit nothing. A side never faces a higher neighbour.
 */

import { SUB, Q_PER_CELL, KIND, DIR_VEC, CLIFF_MATERIALS } from "../constants.mjs";

/** Water bed sits this far below the sub-cell's top (q). */
export const WATER_BED_Q = 1.6;
/** Water surface sits this far below the sub-cell's top (q). */
export const WATER_SURFACE_Q = 0.3;
/** The diorama base sits this far below the lowest ground (q): one cell. */
export const BASE_DROP_Q = Q_PER_CELL;
/** Lip sample point inset into the higher sub-cell (cells). */
const LIP_INSET = 0.03;
/** Most steps one stairs sub-cell draws. */
const MAX_STEPS = 6;
/** AO by occluder count (voxel-style: 0 = both sides blocked). */
const AO_LEVELS = [0.52, 0.68, 0.84, 1];

const TINT_FLOOR = [1, 1, 1];
const TINT_PIT = [0.4, 0.37, 0.4];
const TINT_BED = [0.6, 0.72, 0.8];

const EPS = 1e-4;
const S = 1 / SUB;
const qy = (q) => q / Q_PER_CELL;

/** Edge index = DIR index: 0 N, 1 E, 2 S, 3 W. Outward normals (x, z). */
const EDGE_N = [[0, -1], [1, 0], [0, 1], [-1, 0]];

class Writer {
  constructor(spec) {
    this.spec = spec;
    this.data = Object.fromEntries(Object.keys(spec).map((k) => [k, []]));
    this.index = [];
    this.verts = 0;
    this.quads = 0;
  }

  vert(attrs) {
    for (const k in this.spec) {
      const v = attrs[k];
      const arr = this.data[k];
      if (this.spec[k] === 1) arr.push(v);
      else for (let i = 0; i < this.spec[k]; i++) arr.push(v[i]);
    }
    return this.verts++;
  }

  /** Two triangles over four already-ordered (counter-clockwise) vertices. */
  quad(a, b, c, d) {
    this.index.push(a, b, c, a, c, d);
    this.quads++;
  }

  finish() {
    const out = { count: this.verts, quads: this.quads };
    for (const k in this.spec) out[k] = new Float32Array(this.data[k]);
    out.index = new Uint32Array(this.index);
    out.itemSize = { ...this.spec };
    return out;
  }
}

/**
 * Read the terrain once into the shape the builder walks.
 * @param {import("../terrain/model.mjs").Terrain} t
 */
function snapshot(t) {
  const sw = t.sw, sh = t.sh, n = sw * sh;
  const kind = new Uint8Array(n), dir = new Uint8Array(n), h = new Float32Array(n);
  let minQ = Infinity, maxQ = -Infinity;
  for (let k = 0; k < n; k++) {
    kind[k] = t.kind[k] & 0x0f;
    dir[k] = (t.kind[k] >> 4) & 0x03;
    h[k] = t.h[k];
    if (kind[k] === KIND.VOID) continue;
    const lo = kind[k] === KIND.WATER ? h[k] - WATER_BED_Q : h[k];
    if (lo < minQ) minQ = lo;
    if (h[k] > maxQ) maxQ = h[k];
  }
  if (!Number.isFinite(minQ)) { minQ = 0; maxQ = 0; }
  const baseQ = Math.floor(minQ) - BASE_DROP_Q;
  const mat = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const m = CLIFF_MATERIALS.indexOf(t.palette[t.layer[k]]?.material);
    mat[k] = m < 0 ? 0 : m;
  }
  const at = (si, sj) => (si >= 0 && sj >= 0 && si < sh && sj < sw ? si * sw + sj : -1);
  const live = (k) => k >= 0 && kind[k] !== KIND.VOID;
  // Stairs / ramps: high end at the sub-cell's own top, low end at the front
  // neighbour's top when that is lower, else flat.
  const slope = new Array(n);
  for (let si = 0; si < sh; si++) for (let sj = 0; sj < sw; sj++) {
    const k = si * sw + sj;
    if (kind[k] !== KIND.STAIRS && kind[k] !== KIND.RAMP) continue;
    const [dx, dz] = DIR_VEC[dir[k]];
    const f = at(si + dz, sj + dx);
    let d = 0;
    if (live(f)) {
      const fh = kind[f] === KIND.WATER ? h[f] - WATER_SURFACE_Q : h[f];
      if (fh < h[k] - EPS) d = h[k] - fh;
    }
    const steps = kind[k] === KIND.STAIRS ? Math.max(1, Math.min(MAX_STEPS, Math.round(d))) : 1;
    slope[k] = { hi: h[k], d, steps, stairs: kind[k] === KIND.STAIRS, dir: dir[k] };
  }
  return { sw, sh, kind, dir, h, mat, slope, baseQ, minQ, maxQ, at, live };
}

/** Descent coordinate w (0 back, 1 front) at local (u, v) for a direction. */
const wAt = (dir, u, v) => (dir === 0 ? 1 - v : dir === 2 ? v : dir === 1 ? u : 1 - u);

/** Surface height (q) of a slope at descent coordinate w. */
function slopeH(sl, w) {
  if (sl.d <= 0) return sl.hi;
  if (!sl.stairs) return sl.hi - sl.d * w;
  const k = Math.min(sl.steps - 1, Math.floor(w * sl.steps + EPS));
  return sl.hi - (sl.d * k) / sl.steps;
}

/** Local (u, v) of canonical parameter t along edge e. */
const edgeUV = (e, t) => (e === 0 ? [t, 0] : e === 2 ? [t, 1] : e === 3 ? [0, t] : [1, t]);

/**
 * Height profile (q) of sub-cell k along its edge e, as linear segments over
 * the canonical parameter t ∈ [0, 1] (along +x for N/S, +z for E/W).
 * @param {"high"|"low"} role  a water cell shows its bank to the waterline
 *   when it is the higher side, and its bed when it is the lower one
 */
function profile(G, k, e, role, otherWater) {
  const kind = G.kind[k];
  if (kind === KIND.WATER) {
    const q = role === "high" && !otherWater ? G.h[k] - WATER_SURFACE_Q : G.h[k] - WATER_BED_Q;
    return [[0, 1, q, q]];
  }
  const sl = G.slope[k];
  if (!sl || sl.d <= 0) return [[0, 1, G.h[k], G.h[k]]];
  const [u0, v0] = edgeUV(e, 0), [u1, v1] = edgeUV(e, 1);
  const w0 = wAt(sl.dir, u0, v0), w1 = wAt(sl.dir, u1, v1);
  if (Math.abs(w0 - w1) < EPS) {
    const q = slopeH(sl, w0 >= 1 - EPS ? 1 : w0);
    return [[0, 1, q, q]];
  }
  if (!sl.stairs) return [[0, 1, slopeH(sl, w0), slopeH(sl, w1)]];
  const out = [];
  for (let s = 0; s < sl.steps; s++) {
    const a = s / sl.steps, b = (s + 1) / sl.steps;
    const q = sl.hi - (sl.d * s) / sl.steps;
    const [t0, t1] = w1 > w0 ? [a, b] : [1 - b, 1 - a];
    out.push([t0, t1, q, q]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

function evalProfile(p, t) {
  for (const [t0, t1, h0, h1] of p) {
    if (t >= t0 - EPS && t <= t1 + EPS) return t1 - t0 < EPS ? h0 : h0 + ((h1 - h0) * (t - t0)) / (t1 - t0);
  }
  return p[p.length - 1][3];
}

/** Value just inside an interval (stairs profiles are discontinuous). */
const evalIn = (p, ta, tb, side) => {
  const m = (ta + tb) / 2;
  for (const [t0, t1, h0, h1] of p) {
    if (m >= t0 - EPS && m <= t1 + EPS) {
      const t = side === 0 ? ta : tb;
      return t1 - t0 < EPS ? h0 : h0 + ((h1 - h0) * (t - t0)) / (t1 - t0);
    }
  }
  return evalProfile(p, side === 0 ? ta : tb);
};

/**
 * Build all terrain geometry.
 * @param {import("../terrain/model.mjs").Terrain} t
 * @param {{ merge?: boolean, meta?: boolean }} [opts]
 *   merge  merge flat runs of tops (default true)
 *   meta   also return, per side quad, [si, sj, nsi, nsj] (the check uses it)
 */
export function buildTerrainMesh(t, { merge = true, meta = false } = {}) {
  const G = snapshot(t);
  const tops = new Writer({ position: 3, normal: 3, ao: 1, tint: 3 });
  const sides = new Writer({ position: 3, normal: 3, lip: 2, depth: 1, drop: 1, along: 1, mat: 1, flag: 1 });
  const water = new Writer({ position: 3, shore: 1 });
  const sideMeta = [];

  /**
   * One vertical quad between (xA, zA) and (xB, zB), facing (nx, nz).
   * top / bottom heights in cells at each end.
   */
  const vertical = (xA, zA, xB, zB, topA, topB, botA, botB, nx, nz, mat, flag, along) => {
    if (topA - botA < EPS && topB - botB < EPS) return false;
    botA = Math.min(botA, topA);
    botB = Math.min(botB, topB);
    const lx = -nx * LIP_INSET, lz = -nz * LIP_INSET;
    const alongA = along === "x" ? xA : zA, alongB = along === "x" ? xB : zB;
    const v = (x, z, y, top, bot, al) => sides.vert({
      position: [x, y, z], normal: [nx, 0, nz], lip: [x + lx, z + lz],
      depth: top - y, drop: top - bot, along: al, mat, flag,
    });
    const p0 = v(xA, zA, topA, topA, botA, alongA);
    const p1 = v(xB, zB, topB, topB, botB, alongB);
    const p2 = v(xB, zB, botB, topB, botB, alongB);
    const p3 = v(xA, zA, botA, topA, botA, alongA);
    // Front face when -(D × up) points along the normal; D = B − A.
    const dx = xB - xA, dz = zB - zA;
    const gx = dz, gz = -dx; // -(D × up) = (dz, 0, -dx)
    if (gx * nx + gz * nz > 0) sides.quad(p0, p1, p2, p3);
    else sides.quad(p0, p3, p2, p1);
    return true;
  };

  /** Flat or tilted top quad over local rect; heights (cells) per corner. */
  const top = (x0, z0, x1, z1, y00, y10, y11, y01, ao, tint) => {
    // corners: (x0,z0) y00, (x1,z0) y10, (x1,z1) y11, (x0,z1) y01
    const ux = x1 - x0, uz = z1 - z0;
    // normal from the two diagonals
    const ax = ux, ay = y11 - y00, az = uz;
    const bx = -ux, by = y01 - y10, bz = uz;
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const L = Math.hypot(nx, ny, nz) || 1;
    const n = [nx / L, ny / L, nz / L];
    const a = tops.vert({ position: [x0, y00, z0], normal: n, ao: ao[0], tint });
    const b = tops.vert({ position: [x0, y01, z1], normal: n, ao: ao[3], tint });
    const c = tops.vert({ position: [x1, y11, z1], normal: n, ao: ao[2], tint });
    const d = tops.vert({ position: [x1, y10, z0], normal: n, ao: ao[1], tint });
    tops.quad(a, b, c, d);
  };

  const higherThan = (si, sj, q) => {
    const k = G.at(si, sj);
    return G.live(k) && G.h[k] > q + 0.5;
  };
  /** Baked AO for the 4 corners of a flat sub-cell: [x0z0, x1z0, x1z1, x0z1]. */
  const cornerAO = (si, sj, q) => {
    const out = [1, 1, 1, 1];
    const corners = [[-1, -1], [-1, 1], [1, 1], [1, -1]]; // [di, dj]
    for (let c = 0; c < 4; c++) {
      const [di, dj] = corners[c];
      const s1 = higherThan(si + di, sj, q) ? 1 : 0;
      const s2 = higherThan(si, sj + dj, q) ? 1 : 0;
      const cc = higherThan(si + di, sj + dj, q) ? 1 : 0;
      out[c] = AO_LEVELS[s1 && s2 ? 0 : 3 - (s1 + s2 + cc)];
    }
    return out;
  };

  const { sw, sh } = G;
  // ---- tops ----
  for (let si = 0; si < sh; si++) {
    let run = null; // { sj0, sj1, q, tint }
    const flush = () => {
      if (!run) return;
      const y = qy(run.q);
      top(run.sj0 * S, si * S, (run.sj1 + 1) * S, (si + 1) * S, y, y, y, y, [1, 1, 1, 1], run.tint);
      run = null;
    };
    for (let sj = 0; sj < sw; sj++) {
      const k = si * sw + sj;
      const kind = G.kind[k];
      if (kind === KIND.VOID) { flush(); continue; }
      const x0 = sj * S, z0 = si * S, x1 = x0 + S, z1 = z0 + S;
      if (kind === KIND.FLOOR || kind === KIND.PIT || ((kind === KIND.STAIRS || kind === KIND.RAMP) && !(G.slope[k]?.d > 0))) {
        const q = G.h[k];
        const tint = kind === KIND.PIT ? TINT_PIT : TINT_FLOOR;
        const ao = cornerAO(si, sj, q);
        const clean = ao.every((a) => a === 1);
        if (merge && clean) {
          if (run && run.q === q && run.tint === tint && run.sj1 === sj - 1) { run.sj1 = sj; continue; }
          flush();
          run = { sj0: sj, sj1: sj, q, tint };
          continue;
        }
        flush();
        const y = qy(q);
        top(x0, z0, x1, z1, y, y, y, y, ao, tint);
        continue;
      }
      flush();
      if (kind === KIND.WATER) {
        const yb = qy(G.h[k] - WATER_BED_Q);
        top(x0, z0, x1, z1, yb, yb, yb, yb, [1, 1, 1, 1], TINT_BED);
        const ys = qy(G.h[k] - WATER_SURFACE_Q);
        const bank = (di, dj) => {
          for (const [a, b] of [[0, 0], [di, 0], [0, dj], [di, dj]]) {
            const kk = G.at(si + a, sj + b);
            if (kk < 0 || G.kind[kk] !== KIND.WATER) return 1;
          }
          return 0;
        };
        const s00 = bank(-1, -1), s10 = bank(-1, 1), s11 = bank(1, 1), s01 = bank(1, -1);
        const a = water.vert({ position: [x0, ys, z0], shore: s00 });
        const b = water.vert({ position: [x0, ys, z1], shore: s01 });
        const c = water.vert({ position: [x1, ys, z1], shore: s11 });
        const d = water.vert({ position: [x1, ys, z0], shore: s10 });
        water.quad(a, b, c, d);
        continue;
      }
      // Stairs / ramp with a real drop.
      const sl = G.slope[k];
      const dir = sl.dir;
      if (!sl.stairs) {
        const hq = (u, v) => qy(slopeH(sl, wAt(dir, u, v)));
        top(x0, z0, x1, z1, hq(0, 0), hq(1, 0), hq(1, 1), hq(0, 1), [1, 1, 1, 1], TINT_FLOOR);
        continue;
      }
      const n = sl.steps;
      for (let s = 0; s < n; s++) {
        const a = s / n, b = (s + 1) / n;
        const y = qy(sl.hi - (sl.d * s) / n);
        // local rect of this tread
        let u0 = 0, u1 = 1, v0 = 0, v1 = 1;
        if (dir === 2) { v0 = a; v1 = b; } else if (dir === 0) { v0 = 1 - b; v1 = 1 - a; }
        else if (dir === 1) { u0 = a; u1 = b; } else { u0 = 1 - b; u1 = 1 - a; }
        top(x0 + u0 * S, z0 + v0 * S, x0 + u1 * S, z0 + v1 * S, y, y, y, y, [1, 1, 1, 1], TINT_FLOOR);
        if (s < n - 1) {
          // riser at the tread's front, facing down the stairs
          const yLow = qy(sl.hi - (sl.d * (s + 1)) / n);
          const [nx, nz] = EDGE_N[dir];
          let xa, za, xb, zb;
          if (dir === 2 || dir === 0) {
            const zz = z0 + (dir === 2 ? b : 1 - b) * S;
            xa = x0; xb = x1; za = zb = zz;
          } else {
            const xx = x0 + (dir === 1 ? b : 1 - b) * S;
            za = z0; zb = z1; xa = xb = xx;
          }
          vertical(xa, za, xb, zb, y, y, yLow, yLow, nx, nz, G.mat[k], 1, dir === 0 || dir === 2 ? "x" : "z");
          if (meta) sideMeta.push([si, sj, si, sj]);
        }
      }
    }
    flush();
  }

  // ---- sides ----
  const baseY = qy(G.baseQ);
  for (let si = 0; si < sh; si++) for (let sj = 0; sj < sw; sj++) {
    const k = si * sw + sj;
    if (G.kind[k] === KIND.VOID) continue;
    for (let e = 0; e < 4; e++) {
      const [nx, nz] = EDGE_N[e];
      const nsi = si + nz, nsj = sj + nx;
      const nk = G.at(nsi, nsj);
      const otherLive = G.live(nk);
      const otherWater = otherLive && G.kind[nk] === KIND.WATER;
      const selfWater = G.kind[k] === KIND.WATER;
      const A = profile(G, k, e, "high", otherWater);
      const B = otherLive ? profile(G, nk, (e + 2) % 4, "low", selfWater) : [[0, 1, G.baseQ, G.baseQ]];
      const flag = (otherLive ? 1 : 0) + (otherLive && G.kind[nk] === KIND.PIT ? 2 : 0) + (otherWater ? 4 : 0);
      const ts = new Set([0, 1]);
      for (const s of A) { ts.add(s[0]); ts.add(s[1]); }
      for (const s of B) { ts.add(s[0]); ts.add(s[1]); }
      const brk = [...ts].sort((a, b) => a - b);
      for (let i = 0; i + 1 < brk.length; i++) {
        const ta = brk[i], tb = brk[i + 1];
        if (tb - ta < EPS) continue;
        const aA = evalIn(A, ta, tb, 0), aB = evalIn(A, ta, tb, 1);
        const bA = evalIn(B, ta, tb, 0), bB = evalIn(B, ta, tb, 1);
        if (aA <= bA + EPS && aB <= bB + EPS) continue;
        // edge points
        let xA, zA, xB, zB, along;
        if (e === 0 || e === 2) {
          const zz = (si + (e === 2 ? 1 : 0)) * S;
          xA = (sj + ta) * S; xB = (sj + tb) * S; zA = zB = zz; along = "x";
        } else {
          const xx = (sj + (e === 1 ? 1 : 0)) * S;
          zA = (si + ta) * S; zB = (si + tb) * S; xA = xB = xx; along = "z";
        }
        if (vertical(xA, zA, xB, zB, qy(aA), qy(aB), qy(bA), qy(bB), nx, nz, G.mat[k], flag, along) && meta) {
          sideMeta.push([si, sj, nsi, nsj]);
        }
      }
    }
  }

  const T = tops.finish(), Sd = sides.finish(), W = water.finish();
  return {
    tops: T,
    sides: Sd,
    water: W,
    baseY,
    minY: qy(G.minQ),
    maxY: qy(G.maxQ),
    bounds: { x0: 0, z0: 0, x1: t.cols, z1: t.rows },
    stats: { topQuads: T.quads, sideQuads: Sd.quads, waterQuads: W.quads },
    sideMeta: meta ? sideMeta : null,
  };
}
