/**
 * Diorama — the terrain field. Pure: typed arrays only, no three, no DOM.
 *
 * One small RGBA8 image baked from the height field whenever the terrain
 * changes, FIELD_PX_PER_CELL texels per cell, row 0 at z = 0. The terrain
 * shaders sample it with linear filtering:
 *
 *   R  ambient occlusion on tops: 1 under open sky, lower at the foot of a
 *      cliff or beside anything taller (horizon-based, 8 directions)
 *   G  signed distance to the nearest cliff lip, cells, mapped from
 *      [-LIP_RANGE, LIP_RANGE] to [0, 1]. Positive on the high side. A signed
 *      field interpolates linearly across the edge, so a hairline drawn at 0 is
 *      exact at any zoom, even at 8 texels per cell.
 *   B  distance from a water texel to the bank, cells, over [0, SHORE_RANGE];
 *      0 on dry ground. The map's outer edge is not a bank: a sea runs on.
 *   A  on dry ground, nearness to the water: 1 at the waterline, 0 from
 *      WET_RANGE cells up the bank (the wet band). 1 on water, 0 on void and
 *      on a map with no water.
 */

import { SUB, Q_PER_CELL, KIND } from "../constants.mjs";

export const FIELD_PX_PER_CELL = 8;
/** Lip distances are stored over ±this many cells. */
export const LIP_RANGE = 0.5;
/** Shore distances are stored over this many cells. */
export const SHORE_RANGE = 1.5;
/** The wet band climbs this many cells up a dry bank. */
export const WET_RANGE = 0.35;
/** A drop of at least this many q makes a lip. */
const LIP_MIN_Q = 1;
/** Horizon samples, cells from the texel. */
const AO_RADII = [0.18, 0.42, 0.85];
const AO_DIRS = 8;
/** How dark a texel hemmed in on every side gets. */
const AO_STRENGTH = 0.62;
/** Water surfaces sit this far below their sub-cell top (mirrors terrain-mesh). */
const WATER_SURFACE_Q = 0.3;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * @param {import("../terrain/model.mjs").Terrain} t
 * @returns {{ width:number, height:number, data:Uint8Array, pxPerCell:number }}
 */
export function buildTerrainField(t) {
  const sw = t.sw, sh = t.sh;
  const P = FIELD_PX_PER_CELL;
  const W = t.cols * P, H = t.rows * P;
  const data = new Uint8Array(W * H * 4);

  // surface height per sub-cell (q); NaN = void
  const top = new Float32Array(sw * sh);
  const water = new Uint8Array(sw * sh);
  for (let k = 0; k < sw * sh; k++) {
    const kind = t.kind[k] & 0x0f;
    if (kind === KIND.VOID) { top[k] = NaN; continue; }
    water[k] = kind === KIND.WATER ? 1 : 0;
    top[k] = kind === KIND.WATER ? t.h[k] - WATER_SURFACE_Q : t.h[k];
  }
  const hAt = (si, sj) => (si < 0 || sj < 0 || si >= sh || sj >= sw ? NaN : top[si * sw + sj]);

  // Lip edges, as axis-aligned segments in cells. An edge is a lip when the
  // sub-cell on one side stands LIP_MIN_Q or more above the other (or above
  // void / the map's outer edge). `hi` is the high side's height.
  // hEdge[si][sj]: the edge along z = si/SUB from x = sj/SUB to (sj+1)/SUB,
  // between sub-rows si-1 (north) and si (south). Stored as the high side's
  // sign: +1 = south is high, -1 = north is high, 0 = no lip.
  const hEdge = new Int8Array((sh + 1) * sw);
  const vEdge = new Int8Array(sh * (sw + 1));
  const lipSign = (a, b) => {
    // a = north/west height, b = south/east height
    const na = Number.isNaN(a), nb = Number.isNaN(b);
    if (na && nb) return 0;
    if (na) return 1;
    if (nb) return -1;
    if (b - a >= LIP_MIN_Q) return 1;
    if (a - b >= LIP_MIN_Q) return -1;
    return 0;
  };
  for (let si = 0; si <= sh; si++) for (let sj = 0; sj < sw; sj++) {
    hEdge[si * sw + sj] = lipSign(hAt(si - 1, sj), hAt(si, sj));
  }
  for (let si = 0; si < sh; si++) for (let sj = 0; sj <= sw; sj++) {
    vEdge[si * (sw + 1) + sj] = lipSign(hAt(si, sj - 1), hAt(si, sj));
  }

  const dirs = [];
  for (let d = 0; d < AO_DIRS; d++) {
    const a = (d / AO_DIRS) * Math.PI * 2;
    dirs.push([Math.cos(a), Math.sin(a)]);
  }

  const invS = 1 / SUB;
  for (let py = 0; py < H; py++) {
    const z = (py + 0.5) / P;
    const si = Math.floor(z * SUB);
    for (let px = 0; px < W; px++) {
      const x = (px + 0.5) / P;
      const sj = Math.floor(x * SUB);
      const o = (py * W + px) * 4;
      data[o + 3] = 255;
      const h0 = hAt(si, sj);
      if (Number.isNaN(h0)) { data[o] = 255; data[o + 1] = 128; data[o + 2] = 0; continue; }

      // R: horizon occlusion
      let occ = 0;
      for (const [dx, dz] of dirs) {
        let m = 0;
        for (const r of AO_RADII) {
          const h = hAt(Math.floor((z + dz * r) * SUB), Math.floor((x + dx * r) * SUB));
          if (Number.isNaN(h)) continue;
          const rise = (h - h0) / Q_PER_CELL;          // cells
          if (rise > 0) m = Math.max(m, clamp01(rise / (r * 2.2)));
        }
        occ += m;
      }
      data[o] = Math.round(255 * (1 - AO_STRENGTH * (occ / AO_DIRS)));

      // G: signed distance to the nearest lip within one sub-cell ring
      let best = LIP_RANGE, sign = 1;
      for (let a = si - 1; a <= si + 2; a++) {
        if (a < 0 || a > sh) continue;
        const ez = a * invS;
        for (let b = sj - 1; b <= sj + 1; b++) {
          if (b < 0 || b >= sw) continue;
          const s = hEdge[a * sw + b];
          if (!s) continue;
          const x0 = b * invS, x1 = x0 + invS;
          const cx = x < x0 ? x0 : x > x1 ? x1 : x;
          const d = Math.hypot(x - cx, z - ez);
          if (d < best) { best = d; sign = (z >= ez ? 1 : -1) === s ? 1 : -1; }
        }
      }
      for (let a = si - 1; a <= si + 1; a++) {
        if (a < 0 || a >= sh) continue;
        for (let b = sj - 1; b <= sj + 2; b++) {
          if (b < 0 || b > sw) continue;
          const s = vEdge[a * (sw + 1) + b];
          if (!s) continue;
          const ex = b * invS;
          const z0 = a * invS, z1 = z0 + invS;
          const cz = z < z0 ? z0 : z > z1 ? z1 : z;
          const d = Math.hypot(x - ex, z - cz);
          if (d < best) { best = d; sign = (x >= ex ? 1 : -1) === s ? 1 : -1; }
        }
      }
      data[o + 1] = Math.round(255 * clamp01(0.5 + (sign * best) / (2 * LIP_RANGE)));
      data[o + 2] = 0;
    }
  }

  // B: distance to the bank, an exact Euclidean transform on the texel grid
  const src = new Float64Array(W * H);
  let anyWater = false;
  for (let py = 0; py < H; py++) {
    const si = Math.floor(((py + 0.5) / P) * SUB);
    for (let px = 0; px < W; px++) {
      const sj = Math.floor(((px + 0.5) / P) * SUB);
      const k = si * sw + sj;
      const isWater = water[k] === 1;
      anyWater ||= isWater;
      src[py * W + px] = isWater ? Infinity : 0;
    }
  }
  if (anyWater) {
    const d2 = edt2d(src, W, H);
    for (let i = 0; i < W * H; i++) {
      if (src[i] === 0) continue;
      const cells = Math.max(0, Math.sqrt(d2[i]) - 0.5) / P;
      data[i * 4 + 2] = Math.round(255 * clamp01(cells / SHORE_RANGE));
    }
  }

  // A: how near dry ground is to the water (the wet band up a bank), the same
  // transform the other way round: water texels are the sources.
  for (let i = 0; i < W * H; i++) data[i * 4 + 3] = 0;
  if (anyWater) {
    const wsrc = new Float64Array(W * H);
    for (let i = 0; i < W * H; i++) wsrc[i] = src[i] === 0 ? Infinity : 0;
    const d2 = edt2d(wsrc, W, H);
    for (let py = 0; py < H; py++) {
      const si = Math.floor(((py + 0.5) / P) * SUB);
      for (let px = 0; px < W; px++) {
        const i = py * W + px;
        if (src[i] !== 0) { data[i * 4 + 3] = 255; continue; }
        const sj = Math.floor(((px + 0.5) / P) * SUB);
        if (Number.isNaN(top[si * sw + sj])) continue;
        const cells = Math.max(0, Math.sqrt(d2[i]) - 0.5) / P;
        data[i * 4 + 3] = Math.round(255 * (1 - clamp01(cells / WET_RANGE)));
      }
    }
  }

  return { width: W, height: H, data, pxPerCell: P };
}

/* ---- squared Euclidean distance transform (Felzenszwalb & Huttenlocher) ---- */

/** "No source" in the transform: finite, so the parabola maths stays exact. */
const FAR = 1e10;

function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  const cross = (q, p) => ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
  for (let q = 1; q < n; q++) {
    let s = cross(q, v[k]);
    while (s <= z[k]) { k--; s = cross(q, v[k]); }
    k++;
    v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/**
 * Squared distance from every texel to the nearest source texel.
 * @param {Float64Array} src 0 at sources, Infinity elsewhere
 */
export function edt2d(src, W, H) {
  const n = Math.max(W, H);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const out = new Float64Array(W * H);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = src[y * W + x] === 0 ? 0 : FAR;
    edt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) out[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = out[y * W + x];
    edt1d(f, W, d, v, z);
    for (let x = 0; x < W; x++) out[y * W + x] = d[x];
  }
  return out;
}
