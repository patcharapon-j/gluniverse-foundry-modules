/**
 * Diorama — line of sight and cover between two creatures, pure. Shown,
 * never applied.
 *
 * PF2e (Player Core p. 424, "Cover"): "draw a line from the center of your
 * space to the center of the target's space. If that line passes through any
 * terrain or object that would block the effect, the target has standard
 * cover." Standard cover is +2 circumstance to AC, greater cover +4 (the GM's
 * call, or Take Cover), lesser cover +1 (a creature in the way, which this
 * does not read).
 *
 * The drawn line is that centre line in 3D: the attacker's eye to the middle
 * of the target. The badge is the five rays of terrain/occlusion.mjs (feet,
 * middle, head, both flanks): some blocked is standard, most is greater. This
 * file answers the same question as `coverBetween` there, ray for ray (the
 * check holds the two together), and also says WHERE each ray is blocked, so
 * the view can draw the line broken inside the ground that stops it.
 *
 * Coordinates: px on the map, q for heights; rays march in sub-cell units.
 */

import { rayPoint } from "../terrain/occlusion.mjs";

const EPS = 0.01;
/** A wall is drawn as a blocked stretch this long (cells) either side of where the line crosses it. */
export const WALL_SPAN_CELLS = 0.12;
/** Share of the five rays blocked from which the badge says greater cover. */
export const GREATER_FRACTION = 0.6;

/**
 * Where a 3D segment runs inside the ground: merged [t0, t1] intervals along
 * it (0 = a, 1 = b). The walk is terrain/occlusion.mjs `rayBlocked`'s, so a
 * segment has a span exactly when that says it is blocked, and the first and
 * last sub-cells (the two creatures' own ground) never block.
 * @param {import("../terrain/model.mjs").Terrain|null} t
 * @param {{u:number,v:number,z:number}} a  sub-cell units + q
 * @param {{u:number,v:number,z:number}} b
 * @returns {Array<{t0:number, t1:number}>}
 */
export function blockedSpans(t, a, b) {
  const out = [];
  if (!t) return out;
  const du = b.u - a.u, dv = b.v - a.v, dz = b.z - a.z;
  let cu = Math.floor(a.u), cv = Math.floor(a.v);
  const eu = Math.floor(b.u), ev = Math.floor(b.v);
  const stepU = du > 0 ? 1 : du < 0 ? -1 : 0;
  const stepV = dv > 0 ? 1 : dv < 0 ? -1 : 0;
  const tDeltaU = stepU ? Math.abs(1 / du) : Infinity;
  const tDeltaV = stepV ? Math.abs(1 / dv) : Infinity;
  let tMaxU = stepU ? ((stepU > 0 ? cu + 1 - a.u : a.u - cu) * tDeltaU) : Infinity;
  let tMaxV = stepV ? ((stepV > 0 ? cv + 1 - a.v : a.v - cv) * tDeltaV) : Infinity;
  let t0 = 0;
  const guard = Math.abs(eu - cu) + Math.abs(ev - cv) + 4;
  const push = (s0, s1) => {
    const last = out[out.length - 1];
    if (last && s0 <= last.t1 + 1e-9) last.t1 = Math.max(last.t1, s1);
    else out.push({ t0: s0, t1: s1 });
  };
  for (let n = 0; n < guard; n++) {
    const t1 = Math.min(1, tMaxU, tMaxV);
    const atEnd = cu === eu && cv === ev;
    if (n !== 0 && !atEnd && !t.isVoid(cv, cu)) {
      const top = t.topAt(cv, cu) - EPS;
      const z0 = a.z + dz * t0, z1 = a.z + dz * t1;
      let s0 = -1, s1 = -1;
      if (Math.abs(dz) < 1e-12) {
        if (z0 < top) { s0 = t0; s1 = t1; }
      } else {
        const tc = (top - a.z) / dz;
        if (dz > 0) { if (z0 < top) { s0 = t0; s1 = Math.min(t1, tc); } }
        else if (z1 < top) { s0 = Math.max(t0, tc); s1 = t1; }
      }
      if (s0 >= 0 && s1 > s0) push(Math.max(0, s0), Math.min(1, s1));
    }
    if (atEnd || t1 >= 1) break;
    if (tMaxU < tMaxV) { cu += stepU; t0 = tMaxU; tMaxU += tDeltaU; }
    else { cv += stepV; t0 = tMaxV; tMaxV += tDeltaV; }
  }
  return out;
}

/**
 * Where a map segment crosses walls: sorted t (0..1) along a → b.
 * @param {Array<{ax:number,ay:number,bx:number,by:number}>} walls  px
 */
export function wallCrossings(walls, ax, ay, bx, by) {
  const out = [];
  const rx = bx - ax, ry = by - ay;
  for (const w of walls ?? []) {
    const sx = w.bx - w.ax, sy = w.by - w.ay;
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-9) continue;
    const qx = w.ax - ax, qy = w.ay - ay;
    const t = (qx * sy - qy * sx) / den;
    const u = (qx * ry - qy * rx) / den;
    // the two ends are the creatures' own centres: a wall exactly there does not count
    if (t > 1e-6 && t < 1 - 1e-6 && u >= 0 && u <= 1) out.push(t);
  }
  return out.sort((p, q) => p - q);
}

/**
 * The five points on a target the rays aim at (terrain/occlusion.mjs coverBetween).
 * @param {{x:number,y:number}} from  px
 * @param {{x:number,y:number,footQ:number,heightQ:number,radiusPx:number}} to
 * @returns {Array<{x:number,y:number,zQ:number,key:string}>}
 */
export function coverTargets(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * to.radiusPx * 0.7, py = (dx / len) * to.radiusPx * 0.7;
  const mid = to.footQ + to.heightQ * 0.5;
  return [
    { key: "feet", x: to.x, y: to.y, zQ: to.footQ + to.heightQ * 0.1 },
    { key: "middle", x: to.x, y: to.y, zQ: mid },
    { key: "head", x: to.x, y: to.y, zQ: to.footQ + to.heightQ * 0.95 },
    { key: "left", x: to.x + px, y: to.y + py, zQ: mid },
    { key: "right", x: to.x - px, y: to.y - py, zQ: mid },
  ];
}

/** Cover from the share of rays blocked (the same rule as terrain/occlusion.mjs). */
export function classifyCover(blocked, total) {
  const lineOfSight = blocked < total;
  const frac = total ? blocked / total : 0;
  const cover = !lineOfSight ? "greater" : frac >= GREATER_FRACTION ? "greater" : frac > 0 ? "standard" : "none";
  return { cover, lineOfSight };
}

/** The circumstance bonus to AC a cover value grants in PF2e. */
export const COVER_AC = Object.freeze({ none: 0, standard: 2, greater: 4 });

/**
 * Line of sight and cover from an attacker's eye to a target.
 * @param {import("../terrain/model.mjs").Terrain|null} t  the rules terrain (null: no ground blocks)
 * @param {{x:number,y:number,eyeQ:number}} from  px + q
 * @param {{x:number,y:number,footQ:number,heightQ:number,radiusPx:number}} to
 * @param {number} gridSize
 * @param {{walls?:Array<{ax:number,ay:number,bx:number,by:number}>}} [o]  sight-blocking walls, px
 * @returns {{
 *   cover:"none"|"standard"|"greater", lineOfSight:boolean, blocked:number, total:number,
 *   rays:Array<{key:string, blocked:boolean}>,
 *   line:{a:{x:number,y:number,zQ:number}, b:{x:number,y:number,zQ:number}, spans:Array<{t0:number,t1:number}>, clear:boolean}
 * }}  line: the centre line, with the stretches that run inside ground or through a wall
 */
export function lineOfSight(t, from, to, gridSize, { walls = null } = {}) {
  const A = rayPoint(from.x, from.y, from.eyeQ, gridSize);
  const targets = coverTargets(from, to);
  let blocked = 0;
  const rays = [];
  let centre = null;
  for (const p of targets) {
    const spans = blockedSpans(t, A, rayPoint(p.x, p.y, p.zQ, gridSize));
    const hits = walls ? wallCrossings(walls, from.x, from.y, p.x, p.y) : [];
    const isBlocked = spans.length > 0 || hits.length > 0;
    if (isBlocked) blocked++;
    rays.push({ key: p.key, blocked: isBlocked });
    if (p.key === "middle") centre = { p, spans, hits };
  }
  const total = targets.length;
  const { cover, lineOfSight: los } = classifyCover(blocked, total);
  // The centre line: ground spans, plus a short stretch at each wall it crosses.
  const lenCells = Math.max(1e-6, Math.hypot(centre.p.x - from.x, centre.p.y - from.y) / gridSize);
  const half = Math.min(0.5, WALL_SPAN_CELLS / lenCells);
  const spans = [...centre.spans, ...centre.hits.map((h) => ({ t0: Math.max(0, h - half), t1: Math.min(1, h + half) }))]
    .sort((p, q) => p.t0 - q.t0);
  const merged = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.t0 <= last.t1) last.t1 = Math.max(last.t1, s.t1);
    else merged.push({ ...s });
  }
  return {
    cover, lineOfSight: los, blocked, total, rays,
    line: {
      a: { x: from.x, y: from.y, zQ: from.eyeQ },
      b: { x: centre.p.x, y: centre.p.y, zQ: centre.p.zQ },
      spans: merged,
      clear: merged.length === 0,
    },
  };
}

/**
 * A line's spans as drawable pieces, start to end, each one `clear`,
 * `blocked` (inside ground or a wall) or `beyond` (clear again, but past the
 * first block: the sight does not get there). Pure.
 * @param {Array<{t0:number,t1:number}>} spans
 * @returns {Array<{t0:number, t1:number, style:"clear"|"blocked"|"beyond"}>}
 */
export function lineStyles(spans) {
  const out = [];
  let at = 0, seen = false;
  for (const s of spans ?? []) {
    if (s.t0 > at + 1e-6) out.push({ t0: at, t1: s.t0, style: seen ? "beyond" : "clear" });
    out.push({ t0: Math.max(at, s.t0), t1: s.t1, style: "blocked" });
    at = Math.max(at, s.t1);
    seen = true;
  }
  if (at < 1 - 1e-6) out.push({ t0: at, t1: 1, style: seen ? "beyond" : "clear" });
  return out;
}
