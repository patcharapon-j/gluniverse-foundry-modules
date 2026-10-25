/**
 * Spellglass — the area as vector geometry.
 *
 * On a square grid the area IS PF2e's covered squares, so its outline is the
 * staircase around them, traced from the rules texture `data.mjs` builds —
 * never the smooth shape the squares were cut from. Two edges that disagree
 * about which squares are in is the one thing a tactical overlay must not
 * draw. Gridless Scenes have no squares, so the outline is the analytic shape.
 *
 * Everything returned is in WORLD pixels. Pure: no PIXI, no Foundry.
 */

import { CELL, SHAPE } from "../constants.mjs";

const COVERED = (CELL.covered + CELL.blocked) / 2;
const BLOCKED = CELL.blocked / 2;
const key = (x, y) => `${x},${y}`;

/** Covered and blocked squares, as integer grid-cell keys. */
export function cellSets(cells) {
  const covered = new Set(), blocked = new Set();
  if (!cells?.data) return { covered, blocked };
  for (let j = 0; j < cells.height; j++) {
    for (let i = 0; i < cells.width; i++) {
      const v = cells.data[(j * cells.width + i) * 4] / 255;
      const k = key(cells.minX + i, cells.minY + j);
      if (v >= COVERED) covered.add(k);
      else if (v >= BLOCKED) blocked.add(k);
    }
  }
  return { covered, blocked };
}

function parse(k) {
  const comma = k.indexOf(",");
  return [Number(k.slice(0, comma)), Number(k.slice(comma + 1))];
}

/**
 * Closed loops around a set of squares, in grid units, with the set on the
 * RIGHT of travel (clockwise on screen for an outer edge, counter-clockwise
 * for a hole). Collinear runs are merged, so a 6-square wall is one segment.
 */
export function latticeLoops(set) {
  const out = new Map();
  const add = (x0, y0, x1, y1) => {
    const k = key(x0, y0);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push([x0, y0, x1, y1]);
  };
  for (const k of set) {
    const [x, y] = parse(k);
    if (!set.has(key(x, y - 1))) add(x, y, x + 1, y);
    if (!set.has(key(x + 1, y))) add(x + 1, y, x + 1, y + 1);
    if (!set.has(key(x, y + 1))) add(x + 1, y + 1, x, y + 1);
    if (!set.has(key(x - 1, y))) add(x, y + 1, x, y);
  }
  const loops = [];
  const take = (k, dx, dy) => {
    const list = out.get(k);
    if (!list?.length) return null;
    let best = 0;
    if (list.length > 1) {
      /* A vertex two squares touch only at a corner: keep each square's loop
         tight by taking the right-hand turn first. */
      let score = -Infinity;
      list.forEach((e, i) => {
        const ex = e[2] - e[0], ey = e[3] - e[1];
        const s = dx * ey - dy * ex + (dx * ex + dy * ey) * 0.5;
        if (s > score) { score = s; best = i; }
      });
    }
    const [edge] = list.splice(best, 1);
    if (!list.length) out.delete(k);
    return edge;
  };
  while (out.size) {
    const [startKey] = out.keys();
    let edge = take(startKey, 0, 0);
    const pts = [[edge[0], edge[1]]];
    let guard = 0;
    while (edge && guard++ < 1e5) {
      pts.push([edge[2], edge[3]]);
      const k = key(edge[2], edge[3]);
      if (k === startKey && !out.has(k)) break;
      edge = take(k, edge[2] - edge[0], edge[3] - edge[1]);
      if (!edge) break;
    }
    if (pts.length > 1) {
      const last = pts.at(-1);
      if (last[0] === pts[0][0] && last[1] === pts[0][1]) pts.pop();
    }
    loops.push(simplify(pts));
  }
  return loops.filter((loop) => loop.length >= 3);
}

function simplify(pts) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) > 1e-9) out.push(b);
  }
  return out;
}

/** The set as rectangles [x, y, w, h] in grid units: row runs, merged down. */
export function cellRects(set) {
  const rows = new Map();
  for (const k of set) {
    const [x, y] = parse(k);
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(x);
  }
  const open = new Map();
  const rects = [];
  for (const y of [...rows.keys()].sort((a, b) => a - b)) {
    const xs = rows.get(y).sort((a, b) => a - b);
    const runs = [];
    for (let i = 0; i < xs.length;) {
      let j = i;
      while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
      runs.push([xs[i], xs[j] - xs[i] + 1]);
      i = j + 1;
    }
    const next = new Map();
    for (const [x, w] of runs) {
      const k = `${x}:${w}`;
      const prev = open.get(k);
      if (prev && prev[1] + prev[3] === y) { prev[3]++; next.set(k, prev); open.delete(k); }
      else { const rect = [x, y, w, 1]; rects.push(rect); next.set(k, rect); }
    }
    open.clear();
    for (const [k, v] of next) open.set(k, v);
  }
  return rects;
}

/** Lines between two covered squares, merged into runs, in grid units. */
export function interiorSeams(set) {
  const seams = [];
  const vertical = new Map(), horizontal = new Map();
  for (const k of set) {
    const [x, y] = parse(k);
    if (set.has(key(x + 1, y))) { const c = x + 1; if (!vertical.has(c)) vertical.set(c, []); vertical.get(c).push(y); }
    if (set.has(key(x, y + 1))) { const r = y + 1; if (!horizontal.has(r)) horizontal.set(r, []); horizontal.get(r).push(x); }
  }
  const runs = (list) => {
    list.sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < list.length;) {
      let j = i;
      while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
      out.push([list[i], list[j] + 1]);
      i = j + 1;
    }
    return out;
  };
  for (const [c, ys] of vertical) for (const [a, b] of runs(ys)) seams.push([c, a, c, b]);
  for (const [r, xs] of horizontal) for (const [a, b] of runs(xs)) seams.push([a, r, b, r]);
  return seams;
}

function arc(out, cx, cy, r, a0, a1, step) {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / step));
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
}

/** The analytic shape for a gridless Scene, clockwise on screen, world px. */
export function shapeLoop(geometry) {
  const { origin: o, grid: g } = geometry;
  const r = Math.max(0, geometry.radius) * g;
  const step = Math.PI / 72;
  const pts = [];
  if (geometry.shapeId === SHAPE.cone) {
    const half = geometry.angle / 2;
    pts.push([o.x, o.y]);
    arc(pts, o.x, o.y, r, geometry.direction - half, geometry.direction + half, step);
  } else if (geometry.shapeId === SHAPE.line) {
    const d = [Math.cos(geometry.direction), Math.sin(geometry.direction)];
    const n = [-d[1], d[0]];
    const hw = Math.max(0.05, geometry.base[0]) * g / 2;
    pts.push([o.x - n[0] * hw, o.y - n[1] * hw], [o.x + d[0] * r - n[0] * hw, o.y + d[1] * r - n[1] * hw],
      [o.x + d[0] * r + n[0] * hw, o.y + d[1] * r + n[1] * hw], [o.x + n[0] * hw, o.y + n[1] * hw]);
  } else if (geometry.shapeId === SHAPE.emanation) {
    const bx = geometry.base[0] * g, by = geometry.base[1] * g;
    if (r <= 0.5) pts.push([o.x - bx, o.y - by], [o.x + bx, o.y - by], [o.x + bx, o.y + by], [o.x - bx, o.y + by]);
    else {
      arc(pts, o.x + bx, o.y - by, r, -Math.PI / 2, 0, step);
      arc(pts, o.x + bx, o.y + by, r, 0, Math.PI / 2, step);
      arc(pts, o.x - bx, o.y + by, r, Math.PI / 2, Math.PI, step);
      arc(pts, o.x - bx, o.y - by, r, Math.PI, Math.PI * 1.5, step);
    }
  } else {
    arc(pts, o.x, o.y, Math.max(r, g * 0.25), 0, Math.PI * 2, step);
    pts.pop();
  }
  return dedupe(pts);
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const q = out.at(-1);
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.01) out.push(p);
  }
  if (out.length > 2 && Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) < 0.01) out.pop();
  return out;
}

/**
 * Everything the renderer draws, from the Region's geometry and rules cells.
 *   loops    the boundary, world px (lattice staircase, or the true shape)
 *   rects    covered squares as rectangles (square grid only)
 *   blocked  { rects, loops } for squares inside the area but out of line
 *   seams    segments between covered squares
 */
export function areaOutline(geometry, cells) {
  const g = geometry.grid;
  const scale = (loop) => loop.map(([x, y]) => [x * g, y * g]);
  if (geometry.gridless) {
    const loop = shapeLoop(geometry);
    return finish({ lattice: false, loops: loop.length >= 3 ? [loop] : [], rects: [], blocked: { rects: [], loops: [] }, seams: [] }, geometry);
  }
  const { covered, blocked } = cellSets(cells);
  return finish({
    lattice: true,
    loops: latticeLoops(covered).map(scale),
    rects: cellRects(covered).map(([x, y, w, h]) => [x * g, y * g, w * g, h * g]),
    blocked: {
      rects: cellRects(blocked).map(([x, y, w, h]) => [x * g, y * g, w * g, h * g]),
      loops: latticeLoops(blocked).map(scale),
    },
    seams: interiorSeams(covered).map(([a, b, c, d]) => [a * g, b * g, c * g, d * g]),
  }, geometry);
}

function finish(outline, geometry) {
  const o = geometry.origin;
  let extent = geometry.grid * 0.5;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const loop of [...outline.loops, ...outline.blocked.loops]) {
    for (const [x, y] of loop) {
      extent = Math.max(extent, Math.hypot(x - o.x, y - o.y));
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  outline.extent = extent;
  outline.box = Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
  outline.perimeter = outline.loops.reduce((sum, loop) => sum + perimeter(loop), 0);
  return outline;
}

export function perimeter(loop) {
  let p = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    p += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return p;
}

/**
 * Convex corners (the set's inside turns right) whose turn is at least
 * `minTurn` radians, with unit vectors back along each arm.
 */
export function convexCorners(loop, minTurn = Math.PI * 0.22) {
  const out = [];
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[(i - 1 + n) % n], b = loop[i], c = loop[(i + 1) % n];
    const ix = b[0] - a[0], iy = b[1] - a[1], ox = c[0] - b[0], oy = c[1] - b[1];
    const li = Math.hypot(ix, iy), lo = Math.hypot(ox, oy);
    if (li < 1e-6 || lo < 1e-6) continue;
    const cross = (ix * oy - iy * ox) / (li * lo);
    const turn = Math.acos(Math.max(-1, Math.min(1, (ix * ox + iy * oy) / (li * lo))));
    if (cross <= 0 || turn < minTurn) continue;
    out.push({ x: b[0], y: b[1], back: [-ix / li, -iy / li], fwd: [ox / lo, oy / lo], armIn: li, armOut: lo });
  }
  return out;
}

function cumulative(loop) {
  const cum = [0];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return cum;
}

function pointAt(loop, cum, s) {
  const total = cum.at(-1);
  s = ((s % total) + total) % total;
  let i = 0;
  while (i < loop.length - 1 && cum[i + 1] < s) i++;
  const a = loop[i], b = loop[(i + 1) % loop.length];
  const span = cum[i + 1] - cum[i] || 1;
  const t = (s - cum[i]) / span;
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, i };
}

/** Open polyline [x0, y0, x1, y1, …] along `loop` from arc length a to b
 *  (b ≥ a, at most one lap apart; both may run past the end of the lap). */
function subPath(loop, cum, a, b) {
  const n = loop.length, total = cum.at(-1);
  const lap = Math.floor(a / total) * total;
  const p0 = pointAt(loop, cum, a), p1 = pointAt(loop, cum, b);
  const out = [p0.x, p0.y];
  for (let k = 1; k <= n * 2; k++) {
    const at = lap + cum[k % n] + Math.floor(k / n) * total;
    if (at <= a) continue;
    if (at >= b) break;
    const v = loop[k % n];
    out.push(v[0], v[1]);
  }
  out.push(p1.x, p1.y);
  return out;
}

/**
 * Dashes along a closed loop: `count` evenly spaced dashes, each `duty` of
 * its period, starting at `phase` periods. The period is fitted to the loop
 * so the last dash closes onto the first without a stub.
 */
export function dashes(loop, period, duty = 0.5, phase = 0) {
  if (loop.length < 2) return [];
  const cum = cumulative(loop);
  const total = cum.at(-1);
  if (total <= 0) return [];
  const count = Math.max(4, Math.round(total / Math.max(1, period)));
  const p = total / count;
  const out = [];
  for (let k = 0; k < count; k++) {
    const a = (k + phase) * p;
    out.push(subPath(loop, cum, a, a + p * duty));
  }
  return out;
}

/** Evenly spaced points around a closed loop. */
export function dotsAlong(loop, spacing) {
  if (loop.length < 2) return [];
  const cum = cumulative(loop);
  const total = cum.at(-1);
  const count = Math.max(6, Math.round(total / Math.max(1, spacing)));
  return Array.from({ length: count }, (_, k) => pointAt(loop, cum, k * total / count));
}

/** The first `fraction` of each loop, as open polylines: a pen drawing it on. */
export function partialLoops(loops, fraction) {
  const f = Math.max(0, Math.min(1, fraction));
  if (f >= 1) return loops.map((loop) => [...loop.flat(), loop[0][0], loop[0][1]]);
  return loops.filter((loop) => loop.length >= 2).map((loop) => {
    const cum = cumulative(loop);
    return f <= 0 ? [] : subPath(loop, cum, 0, cum.at(-1) * f);
  }).filter((path) => path.length >= 4);
}

/**
 * Direction chevrons for cones and lines: one per square along the axis,
 * as open V polylines in world px.
 */
export function chevronMarks(geometry) {
  if (geometry.shapeId !== SHAPE.cone && geometry.shapeId !== SHAPE.line) return [];
  const g = geometry.grid, o = geometry.origin;
  const d = [Math.cos(geometry.direction), Math.sin(geometry.direction)];
  const n = [-d[1], d[0]];
  const count = Math.min(40, Math.floor(geometry.radius));
  const half = geometry.shapeId === SHAPE.line
    ? Math.min(0.3, Math.max(0.12, geometry.base[0] * 0.3)) * g
    : 0.28 * g;
  const depth = 0.16 * g;
  const out = [];
  for (let i = 1; i <= count; i++) {
    const s = (i - 0.5) * g;
    const tip = [o.x + d[0] * (s + depth), o.y + d[1] * (s + depth)];
    const back = [o.x + d[0] * (s - depth), o.y + d[1] * (s - depth)];
    out.push([back[0] - n[0] * half, back[1] - n[1] * half, tip[0], tip[1], back[0] + n[0] * half, back[1] + n[1] * half]);
  }
  return out;
}
