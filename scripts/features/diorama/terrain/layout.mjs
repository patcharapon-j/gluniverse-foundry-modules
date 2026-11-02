/**
 * Diorama — layouts: a terrain written as JSON by someone who has looked at
 * the battle map (a GM, or an AI agent following
 * `.claude/skills/diorama-map-setup`), compiled to a Terrain. Pure: no `game`,
 * `canvas`, `foundry` or DOM, so the check tool and the agent's own Node can
 * compile one exactly as Foundry will.
 *
 * Coordinates are MAP cells, (row, column), counted from the top-left corner of
 * the map image (the scene rect), not of the padded canvas. They may be
 * fractional: 0.5 is half a square, the finest the terrain stores (SUB = 2).
 * A shape covers every sub-cell whose CENTRE falls inside it, and ranges are
 * half-open, so `rows: [2, 4]` covers rows 2 and 3.
 *
 * Ops paint in order, later over earlier:
 *
 *   rect     rows:[r0,r1] cols:[c0,c1]
 *   circle   center:[r,c] radius
 *   ellipse  center:[r,c] radii:[rr,rc] (clip: {rows?, cols?})
 *   polygon  points:[[r,c], ...]
 *   stairs   rows cols down:"N|E|S|W" top bottom   (also `ramp`)
 *   grid     origin:[r,c] res:"cell"|"sub" rows:["..##.."] key:{"#": layer}
 *
 * Every op names a `layer` (a palette entry, by name) and may override its
 * height with `h`. `mirror: true` paints the op again reflected across the
 * layout's `mirror` axis, for the symmetric maps that are most of them.
 * Heights are feet unless `heightUnit` is "q" (quarter squares).
 */

import { SUB, KIND, KIND_KEYS, CLIFF_MATERIALS, Q_PER_CELL } from "../constants.mjs";
import { Terrain, sanitizePaletteEntry, distToQ } from "./model.mjs";
import {
  PROP_SHAPES, PROP_MATERIALS, SHAPE_DEFAULTS, PROP_LIMIT, SIZE_MIN, SIZE_MAX, H_MIN, ELEV_LIMIT, IMG_MAX, normalizeProps,
} from "./props.mjs";

export const LAYOUT_FORMAT = "gluniverse-diorama-layout";
export const LAYOUT_VERSION = 1;
export const LAYOUT_OPS = Object.freeze(["rect", "circle", "ellipse", "polygon", "stairs", "ramp", "grid"]);
/** The ops a mistake in an agent's output can make expensive, capped. */
export const LAYOUT_LIMITS = Object.freeze({ ops: 4000, palette: 32, gridRows: 2000, gridCols: 2000, points: 256, tokens: 200 });

const DIRS = Object.freeze({ N: 0, E: 1, S: 2, W: 3 });
const DIR_NAMES = Object.freeze(["N", "E", "S", "W"]);
/** A reflection across a column axis swaps east and west; across a row axis, north and south. */
const FLIP_COLS = [0, 3, 2, 1];
const FLIP_ROWS = [2, 1, 0, 3];
const VOID_ENTRY = Object.freeze({ name: "Void", h: 0, color: "#20242c", kind: KIND.VOID, material: "edge" });

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isPair = (v) => Array.isArray(v) && v.length === 2 && v.every(isNum);
const isRange = (v) => isPair(v) && v[1] > v[0];

/**
 * Compile a layout onto a grid.
 * @param {object} layout  parsed JSON
 * @param {object} grid
 * @param {number} grid.cols  canvas columns (padding included)
 * @param {number} grid.rows  canvas rows
 * @param {{i:number, j:number}} [grid.offset]  the map's top-left cell on the canvas
 * @param {{cols:number, rows:number}} [grid.map]  the map's own size in cells
 * @param {number} [grid.distance]  feet (scene units) per square
 * @param {number} [grid.wallHeight]  q   @param {number} [grid.stepHeight]  q
 * @param {object} [grid.walls]  wall materials to keep
 * @returns {{ terrain: Terrain|null, tokens: object[], errors: string[], warnings: string[] }}
 */
export function compileLayout(layout, grid) {
  const errors = [], warnings = [];
  const fail = () => ({ terrain: null, tokens: [], props: null, errors, warnings });
  const L = layout && typeof layout === "object" && !Array.isArray(layout) ? layout : null;
  if (!L) { errors.push("The layout is not a JSON object."); return fail(); }
  if (L.format !== undefined && L.format !== LAYOUT_FORMAT) errors.push(`"format" must be "${LAYOUT_FORMAT}".`);
  if (L.version !== undefined && L.version !== LAYOUT_VERSION) errors.push(`"version" ${L.version} is not supported (this build reads ${LAYOUT_VERSION}).`);

  const distance = isNum(grid?.distance) && grid.distance > 0 ? grid.distance : 5;
  const unit = L.heightUnit === "q" ? "q" : "ft";
  if (L.heightUnit !== undefined && L.heightUnit !== "q" && L.heightUnit !== "ft") errors.push(`"heightUnit" must be "ft" or "q".`);
  const toQ = (v) => Math.round(unit === "q" ? v : distToQ(v, distance));

  const cols = Math.max(1, grid?.cols | 0), rows = Math.max(1, grid?.rows | 0);
  const off = { i: grid?.offset?.i | 0, j: grid?.offset?.j | 0 };
  const map = {
    cols: grid?.map?.cols ?? (cols - off.j),
    rows: grid?.map?.rows ?? (rows - off.i),
  };
  if (L.map && typeof L.map === "object") {
    if ((isNum(L.map.cols) && L.map.cols !== map.cols) || (isNum(L.map.rows) && L.map.rows !== map.rows)) {
      warnings.push(`The layout was written for a ${L.map.cols}×${L.map.rows} map; this scene's map is ${map.cols}×${map.rows}. Shapes outside it are dropped.`);
    }
  }

  // ── palette ──
  if (!Array.isArray(L.palette) || !L.palette.length) { errors.push(`"palette" must be a non-empty array.`); return fail(); }
  if (L.palette.length > LAYOUT_LIMITS.palette) errors.push(`"palette" has ${L.palette.length} entries; the most is ${LAYOUT_LIMITS.palette}.`);
  const palette = [];
  const byName = new Map();
  L.palette.slice(0, LAYOUT_LIMITS.palette).forEach((p, n) => {
    const where = `palette[${n}]`;
    if (!p || typeof p !== "object") { errors.push(`${where} is not an object.`); return; }
    const name = String(p.name ?? "").trim();
    if (!name) errors.push(`${where} has no "name".`);
    else if (byName.has(name.toLowerCase())) errors.push(`${where}: the name "${name}" is used twice.`);
    const kind = KIND_KEYS.indexOf(String(p.kind ?? "floor"));
    if (kind < 0) errors.push(`${where}: "kind" must be one of ${KIND_KEYS.join(", ")}.`);
    if (p.material !== undefined && !CLIFF_MATERIALS.includes(p.material)) errors.push(`${where}: "material" must be one of ${CLIFF_MATERIALS.join(", ")}.`);
    if (p.h !== undefined && !isNum(p.h)) errors.push(`${where}: "h" must be a number.`);
    const entry = sanitizePaletteEntry({ ...p, name, kind: Math.max(0, kind), h: isNum(p.h) ? toQ(p.h) : 0 }, n);
    byName.set(name.toLowerCase(), palette.length);
    palette.push(entry);
  });
  let voidIndex = palette.findIndex((p) => p.kind === KIND.VOID);
  if (voidIndex < 0) {
    if (palette.length >= LAYOUT_LIMITS.palette) errors.push(`The palette is full and has no void entry for outside the map.`);
    voidIndex = palette.length;
    palette.push({ ...VOID_ENTRY });
  }
  const layerOf = (name, where) => {
    const i = byName.get(String(name ?? "").trim().toLowerCase());
    if (i === undefined) { errors.push(`${where}: no palette entry is called "${name}".`); return -1; }
    return i;
  };

  // ── mirror axes ──
  const mirror = L.mirror && typeof L.mirror === "object" ? L.mirror : {};
  if (mirror.cols !== undefined && !isNum(mirror.cols)) errors.push(`"mirror.cols" must be a number.`);
  if (mirror.rows !== undefined && !isNum(mirror.rows)) errors.push(`"mirror.rows" must be a number.`);

  // ── ops → painters ──
  if (!Array.isArray(L.ops)) errors.push(`"ops" must be an array.`);
  const ops = Array.isArray(L.ops) ? L.ops : [];
  if (ops.length > LAYOUT_LIMITS.ops) errors.push(`"ops" has ${ops.length} entries; the most is ${LAYOUT_LIMITS.ops}.`);
  const painters = [];
  const base = L.base !== undefined ? layerOf(L.base, `"base"`) : palette.findIndex((p) => p.kind !== KIND.VOID);
  ops.slice(0, LAYOUT_LIMITS.ops).forEach((op, n) => {
    const p = painterFor(op, `ops[${n}]`, { errors, layerOf, toQ, palette });
    if (!p) return;
    painters.push(p);
    if (op.mirror) {
      const which = op.mirror === true ? (isNum(mirror.cols) ? "cols" : isNum(mirror.rows) ? "rows" : null) : op.mirror;
      if (!which || !["cols", "rows", "both"].includes(which)) { errors.push(`ops[${n}]: "mirror" needs a "mirror": {"cols": …} or {"rows": …} axis on the layout.`); return; }
      if ((which === "cols" || which === "both") && !isNum(mirror.cols)) { errors.push(`ops[${n}]: there is no "mirror.cols" axis.`); return; }
      if ((which === "rows" || which === "both") && !isNum(mirror.rows)) { errors.push(`ops[${n}]: there is no "mirror.rows" axis.`); return; }
      if (which === "cols" || which === "both") painters.push(reflect(p, "cols", mirror.cols));
      if (which === "rows" || which === "both") painters.push(reflect(p, "rows", mirror.rows));
      if (which === "both") painters.push(reflect(reflect(p, "cols", mirror.cols), "rows", mirror.rows));
    }
  });

  const tokens = tokenPlacements(L.tokens, { errors, toFt: (v) => (unit === "q" ? (v / 4) * distance : v), off });
  const props = propPlacements(L.props, {
    errors, warnings, off, map, mirror,
    toCells: (v) => (unit === "q" ? v / Q_PER_CELL : v / distance),
  });
  if (errors.length) return fail();

  // ── paint ──
  const t = new Terrain({ cols, rows, palette, walls: grid?.walls, wallHeight: grid?.wallHeight, stepHeight: grid?.stepHeight });
  const inMap = (r, c) => r >= 0 && c >= 0 && r < map.rows && c < map.cols;
  let dropped = 0;
  for (let si = 0; si < t.sh; si++) {
    const r = (si + 0.5) / SUB - off.i;
    for (let sj = 0; sj < t.sw; sj++) {
      const c = (sj + 0.5) / SUB - off.j;
      if (inMap(r, c) && base >= 0) t.paint(si, sj, base);
      else t.paint(si, sj, voidIndex);
    }
  }
  for (const p of painters) {
    const [r0, r1, c0, c1] = p.box;
    const si0 = Math.max(0, Math.floor((r0 + off.i) * SUB)), si1 = Math.min(t.sh, Math.ceil((r1 + off.i) * SUB));
    const sj0 = Math.max(0, Math.floor((c0 + off.j) * SUB)), sj1 = Math.min(t.sw, Math.ceil((c1 + off.j) * SUB));
    let hit = 0;
    for (let si = si0; si < si1; si++) {
      const r = (si + 0.5) / SUB - off.i;
      for (let sj = sj0; sj < sj1; sj++) {
        const c = (sj + 0.5) / SUB - off.j;
        const v = p.at(r, c);
        if (!v) continue;
        if (!inMap(r, c)) { dropped++; continue; }
        const e = palette[v.layer];
        t.set(si, sj, { h: v.h ?? e.h, layer: v.layer, kind: e.kind, dir: v.dir ?? 0 });
        hit++;
      }
    }
    if (!hit) warnings.push(`${p.where} covers no square of the map.`);
  }
  if (dropped) warnings.push(`${dropped} sub-squares fell outside the map and were dropped.`);
  return { terrain: t, tokens, props, errors, warnings };
}

/* ── painters ── */

/**
 * One op as `{ where, box: [r0, r1, c0, c1], at(r, c) → {layer, h?, dir?} | null }`,
 * or null after recording why.
 */
function painterFor(op, where, { errors, layerOf, toQ, palette }) {
  if (!op || typeof op !== "object") { errors.push(`${where} is not an object.`); return null; }
  const kind = op.op;
  if (!LAYOUT_OPS.includes(kind)) { errors.push(`${where}: "op" must be one of ${LAYOUT_OPS.join(", ")}.`); return null; }
  if (op.h !== undefined && !isNum(op.h)) { errors.push(`${where}: "h" must be a number.`); return null; }
  const h = op.h !== undefined ? toQ(op.h) : undefined;
  where = `${where} (${kind}${op.layer ? ` ${op.layer}` : ""})`;

  if (kind === "grid") return gridPainter(op, where, { errors, layerOf, toQ });

  let layer = -1;
  if (kind === "stairs" || kind === "ramp") {
    const want = kind === "stairs" ? KIND.STAIRS : KIND.RAMP;
    layer = op.layer !== undefined ? layerOf(op.layer, where) : palette.findIndex((p) => p.kind === want);
    if (layer < 0 && op.layer === undefined) errors.push(`${where}: no palette entry has kind "${kind}"; add one or name a "layer".`);
    else if (layer >= 0 && palette[layer].kind !== want) errors.push(`${where}: "${palette[layer].name}" is not a ${kind} entry.`);
  } else {
    if (op.layer === undefined) { errors.push(`${where}: "layer" is required.`); return null; }
    layer = layerOf(op.layer, where);
  }
  if (layer < 0) return null;
  const hit = { layer, h };

  switch (kind) {
    case "rect": {
      if (!isRange(op.rows) || !isRange(op.cols)) { errors.push(`${where}: "rows" and "cols" must be [start, end] with end > start.`); return null; }
      const [r0, r1] = op.rows, [c0, c1] = op.cols;
      return { where, box: [r0, r1, c0, c1], at: (r, c) => (r >= r0 && r < r1 && c >= c0 && c < c1 ? hit : null) };
    }
    case "circle": {
      if (!isPair(op.center) || !isNum(op.radius) || op.radius <= 0) { errors.push(`${where}: needs "center": [r, c] and a positive "radius".`); return null; }
      const [rc, cc] = op.center, rad = op.radius;
      return { where, box: [rc - rad, rc + rad, cc - rad, cc + rad], at: (r, c) => ((r - rc) ** 2 + (c - cc) ** 2 <= rad * rad ? hit : null) };
    }
    case "ellipse": {
      if (!isPair(op.center) || !isPair(op.radii) || op.radii.some((v) => v <= 0)) { errors.push(`${where}: needs "center": [r, c] and positive "radii": [rows, cols].`); return null; }
      const [rc, cc] = op.center, [rr, rcl] = op.radii;
      const clip = op.clip && typeof op.clip === "object" ? op.clip : {};
      for (const k of ["rows", "cols"]) if (clip[k] !== undefined && !isRange(clip[k])) { errors.push(`${where}: "clip.${k}" must be [start, end].`); return null; }
      const inClip = (r, c) => (!clip.rows || (r >= clip.rows[0] && r < clip.rows[1])) && (!clip.cols || (c >= clip.cols[0] && c < clip.cols[1]));
      return {
        where, box: [rc - rr, rc + rr, cc - rcl, cc + rcl],
        at: (r, c) => (((r - rc) / rr) ** 2 + ((c - cc) / rcl) ** 2 <= 1 && inClip(r, c) ? hit : null),
      };
    }
    case "polygon": {
      const pts = op.points;
      if (!Array.isArray(pts) || pts.length < 3 || pts.length > LAYOUT_LIMITS.points || !pts.every(isPair)) {
        errors.push(`${where}: "points" must be 3 to ${LAYOUT_LIMITS.points} [r, c] pairs.`); return null;
      }
      const rs = pts.map((p) => p[0]), cs = pts.map((p) => p[1]);
      return { where, box: [Math.min(...rs), Math.max(...rs), Math.min(...cs), Math.max(...cs)], at: (r, c) => (inPolygon(pts, r, c) ? hit : null) };
    }
    case "stairs":
    case "ramp": {
      if (!isRange(op.rows) || !isRange(op.cols)) { errors.push(`${where}: "rows" and "cols" must be [start, end] with end > start.`); return null; }
      const dir = DIRS[String(op.down ?? "").toUpperCase()];
      if (dir === undefined) { errors.push(`${where}: "down" must be N, E, S or W (the way the flight descends).`); return null; }
      if (!isNum(op.top) || !isNum(op.bottom) || !(op.top > op.bottom)) { errors.push(`${where}: needs "top" above "bottom" (the heights at its two ends).`); return null; }
      const [r0, r1] = op.rows, [c0, c1] = op.cols;
      const hi = toQ(op.top), lo = toQ(op.bottom);
      const along = dir === DIRS.N || dir === DIRS.S;
      const n = Math.max(1, Math.round((along ? r1 - r0 : c1 - c0) * SUB));
      const kOf = (r, c) => Math.floor(
        dir === DIRS.S ? (r - r0) * SUB : dir === DIRS.N ? (r1 - r) * SUB : dir === DIRS.E ? (c - c0) * SUB : (c1 - c) * SUB);
      return {
        where, box: [r0, r1, c0, c1],
        at: (r, c, flip = (d) => d) => {
          if (!(r >= r0 && r < r1 && c >= c0 && c < c1)) return null;
          const k = Math.max(0, Math.min(n - 1, kOf(r, c)));
          return { layer, h: Math.round(lo + ((hi - lo) * (n - k)) / n), dir: flip(dir) };
        },
      };
    }
  }
  return null;
}

function gridPainter(op, where, { errors, layerOf, toQ }) {
  if (!isPair(op.origin)) { errors.push(`${where}: "origin" must be [r, c].`); return null; }
  const res = op.res === "sub" ? 1 / SUB : 1;
  if (op.res !== undefined && op.res !== "cell" && op.res !== "sub") { errors.push(`${where}: "res" must be "cell" or "sub".`); return null; }
  const lines = op.rows;
  if (!Array.isArray(lines) || !lines.length || lines.length > LAYOUT_LIMITS.gridRows || !lines.every((l) => typeof l === "string" && l.length <= LAYOUT_LIMITS.gridCols)) {
    errors.push(`${where}: "rows" must be 1 to ${LAYOUT_LIMITS.gridRows} strings.`); return null;
  }
  const keyIn = op.key && typeof op.key === "object" ? op.key : null;
  if (!keyIn) { errors.push(`${where}: "key" must map characters to palette entries.`); return null; }
  const key = new Map();
  for (const [ch, v] of Object.entries(keyIn)) {
    if ([...ch].length !== 1) { errors.push(`${where}: key "${ch}" must be one character.`); continue; }
    const name = typeof v === "string" ? v : v?.layer;
    const layer = layerOf(name, `${where} key "${ch}"`);
    if (layer < 0) continue;
    if (v && typeof v === "object" && v.h !== undefined && !isNum(v.h)) { errors.push(`${where} key "${ch}": "h" must be a number.`); continue; }
    key.set(ch, { layer, h: v && typeof v === "object" && v.h !== undefined ? toQ(v.h) : undefined });
  }
  const chars = lines.map((l) => [...l]);
  for (const [n, row] of chars.entries()) {
    for (const ch of row) {
      if (ch === "." || ch === " " || key.has(ch)) continue;
      errors.push(`${where}: row ${n} uses "${ch}", which is not in "key" (use "." to leave a square alone).`);
      return null;
    }
  }
  const [or, oc] = op.origin;
  const width = Math.max(...chars.map((r) => r.length));
  return {
    where, box: [or, or + chars.length * res, oc, oc + width * res],
    at: (r, c) => {
      const y = Math.floor((r - or) / res), x = Math.floor((c - oc) / res);
      const ch = chars[y]?.[x];
      return ch && ch !== "." && ch !== " " ? key.get(ch) : null;
    },
  };
}

/** A painter reflected across `axis` at `at` (c → at − c, or r → at − r). */
function reflect(p, axis, at) {
  const [r0, r1, c0, c1] = p.box;
  const flip = axis === "cols" ? FLIP_COLS : FLIP_ROWS;
  return {
    where: `${p.where} (mirrored)`,
    box: axis === "cols" ? [r0, r1, at - c1, at - c0] : [at - r1, at - r0, c0, c1],
    // A flight's direction is flipped here, then by any reflection outside this one.
    at: (r, c, f = (d) => d) => (axis === "cols"
      ? p.at(r, at - c, (d) => f(flip[d]))
      : p.at(at - r, c, (d) => f(flip[d]))),
  };
}

function inPolygon(pts, r, c) {
  let inside = false;
  for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
    const [ra, ca] = pts[a], [rb, cb] = pts[b];
    if ((ra > r) !== (rb > r) && c < ((cb - ca) * (r - ra)) / (rb - ra) + ca) inside = !inside;
  }
  return inside;
}

/* ── tokens ── */

/**
 * Where the layout puts tokens, in canvas grid offsets. `cell` is the token's
 * top-left square on the map. `elevation` is the creature's feet in scene units
 * (feet); left out, the importer stands it on the ground under its footprint.
 * `altitude` is how far above that ground it flies or hovers.
 */
function tokenPlacements(list, { errors, toFt, off }) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) { errors.push(`"tokens" must be an array.`); return []; }
  if (list.length > LAYOUT_LIMITS.tokens) errors.push(`"tokens" has ${list.length} entries; the most is ${LAYOUT_LIMITS.tokens}.`);
  const out = [];
  list.slice(0, LAYOUT_LIMITS.tokens).forEach((t, n) => {
    const where = `tokens[${n}]`;
    if (!t || typeof t !== "object") { errors.push(`${where} is not an object.`); return; }
    const name = t.name !== undefined ? String(t.name) : null;
    const id = t.id !== undefined ? String(t.id) : null;
    if (!name && !id) { errors.push(`${where} needs a "name" or an "id".`); return; }
    if (!isPair(t.cell)) { errors.push(`${where}: "cell" must be [row, col].`); return; }
    for (const k of ["elevation", "altitude"]) if (t[k] !== undefined && !isNum(t[k])) { errors.push(`${where}: "${k}" must be a number.`); return; }
    out.push({
      name, id,
      i: Math.floor(t.cell[0]) + off.i, j: Math.floor(t.cell[1]) + off.j,
      elevation: t.elevation !== undefined ? toFt(t.elevation) : null,
      altitude: t.altitude !== undefined ? toFt(t.altitude) : 0,
    });
  });
  return out;
}

/* ── props ── */

const PROP_KEYS = new Set(["id", "shape", "at", "w", "d", "h", "elev", "rot", "mat", "tint", "solid", "hidden", "label", "img", "mirror"]);

/**
 * A layout's props as stored props (canvas cells), or null when the layout has
 * no `props` key, which leaves the scene's own props alone. `at` is the
 * footprint's centre in map squares, [row, col]; `w`/`d` are squares; `h` and
 * `elev` are heights in the layout's height unit. A mirrored prop is reflected
 * with its turn: across a column axis rot → −rot, across a row axis
 * rot → 180 − rot, so a wedge still climbs toward the reflected side.
 */
function propPlacements(list, { errors, warnings, off, map, mirror, toCells }) {
  if (list === undefined) return null;
  if (!Array.isArray(list)) { errors.push(`"props" must be an array.`); return null; }
  if (list.length > PROP_LIMIT) errors.push(`"props" has ${list.length} entries; the most is ${PROP_LIMIT}.`);
  const out = [];
  const ids = new Set();
  list.slice(0, PROP_LIMIT).forEach((p, n) => {
    if (!p || typeof p !== "object" || Array.isArray(p)) { errors.push(`props[${n}] is not an object.`); return; }
    const named = typeof p.label === "string" && p.label.trim() ? ` "${p.label.trim()}"` : "";
    const where = `props[${n}] (${typeof p.shape === "string" ? p.shape : "?"}${named})`;
    const bad = (msg) => { errors.push(`${where}: ${msg}`); return true; };
    for (const k of Object.keys(p)) if (!PROP_KEYS.has(k)) warnings.push(`${where}: "${k}" is not a prop field and was ignored.`);
    if (!PROP_SHAPES.includes(p.shape)) { bad(`"shape" must be one of ${PROP_SHAPES.join(", ")}.`); return; }
    const def = SHAPE_DEFAULTS[p.shape];
    let failed = false;
    if (!isPair(p.at)) failed = bad(`"at" must be [row, col], the middle of its footprint in map squares.`);
    for (const k of ["w", "d"]) {
      if (p[k] !== undefined && (!isNum(p[k]) || p[k] < SIZE_MIN || p[k] > SIZE_MAX)) failed = bad(`"${k}" must be ${SIZE_MIN} to ${SIZE_MAX} squares.`);
    }
    if (p.h !== undefined && (!isNum(p.h) || toCells(p.h) < H_MIN || toCells(p.h) > SIZE_MAX)) failed = bad(`"h" must be a positive height in the layout's height unit.`);
    if (p.elev !== undefined && p.elev !== null && (!isNum(p.elev) || Math.abs(toCells(p.elev)) > ELEV_LIMIT)) failed = bad(`"elev" must be a height (or null to stand on the ground).`);
    if (p.rot !== undefined && !isNum(p.rot)) failed = bad(`"rot" must be degrees clockwise.`);
    if (p.mat !== undefined && !PROP_MATERIALS.includes(p.mat)) failed = bad(`"mat" must be one of ${PROP_MATERIALS.join(", ")}.`);
    if (p.tint !== undefined && p.tint !== null && !(typeof p.tint === "string" && /^#[0-9a-f]{6}$/i.test(p.tint))) failed = bad(`"tint" must be "#rrggbb" or null.`);
    for (const k of ["solid", "hidden"]) if (p[k] !== undefined && typeof p[k] !== "boolean") failed = bad(`"${k}" must be true or false.`);
    for (const k of ["label", "img", "id"]) if (p[k] !== undefined && typeof p[k] !== "string") failed = bad(`"${k}" must be a string.`);
    if (p.id !== undefined && typeof p.id === "string") {
      if (!/^[A-Za-z0-9_-]{1,28}$/.test(p.id)) failed = bad(`"id" must be 1 to 28 letters, digits, "_" or "-".`);
      else if (ids.has(p.id)) failed = bad(`the id "${p.id}" is used twice.`);
      else ids.add(p.id);
    }
    if (typeof p.img === "string" && p.img.length > IMG_MAX) failed = bad(`"img" is longer than ${IMG_MAX} characters; use a file path, not a data URL.`);
    if (p.img !== undefined && p.shape !== "card") warnings.push(`${where}: only a card shows "img"; it was ignored.`);
    if (p.shape === "card" && !p.img) warnings.push(`${where}: a card with no "img" draws as a blank panel.`);
    let axes = [];
    if (p.mirror) {
      const which = p.mirror === true ? (isNum(mirror.cols) ? "cols" : isNum(mirror.rows) ? "rows" : null) : p.mirror;
      if (!which || !["cols", "rows", "both"].includes(which)) failed = bad(`"mirror" needs a "mirror": {"cols": …} or {"rows": …} axis on the layout.`);
      else if ((which === "cols" || which === "both") && !isNum(mirror.cols)) failed = bad(`there is no "mirror.cols" axis.`);
      else if ((which === "rows" || which === "both") && !isNum(mirror.rows)) failed = bad(`there is no "mirror.rows" axis.`);
      else axes = which === "both" ? ["cols", "rows", "both"] : [which];
    }
    if (failed) return;

    const [r, c] = p.at;
    const rot = isNum(p.rot) ? p.rot : 0;
    const one = (rr, cc, turn, suffix) => {
      if (suffix && Math.abs(rr - r) < 1e-6 && Math.abs(cc - c) < 1e-6) {
        warnings.push(`${where} sits on its own mirror axis, so its mirrored copy was not added.`);
        return;
      }
      if (!(rr >= 0 && cc >= 0 && rr < map.rows && cc < map.cols)) {
        warnings.push(`${where}${suffix ? " (mirrored)" : ""} stands outside the map at [${rr}, ${cc}] and was dropped.`);
        return;
      }
      out.push({
        id: p.id !== undefined ? p.id + suffix : undefined,
        shape: p.shape,
        x: cc + off.j, y: rr + off.i,
        w: p.w ?? def.w, d: p.d ?? def.d,
        h: p.h !== undefined ? toCells(p.h) : def.h,
        elev: p.elev === undefined || p.elev === null ? null : toCells(p.elev),
        rot: turn,
        mat: p.mat ?? def.mat,
        tint: p.tint ?? null,
        solid: p.solid ?? def.solid,
        hidden: p.hidden ?? false,
        label: p.label ?? "",
        img: p.shape === "card" ? p.img ?? "" : undefined,
      });
    };
    one(r, c, rot, "");
    for (const a of axes) {
      if (a === "cols") one(r, mirror.cols - c, -rot, "m");
      else if (a === "rows") one(mirror.rows - r, c, 180 - rot, "r");
      else one(mirror.rows - r, mirror.cols - c, 180 + rot, "b");
    }
  });
  return normalizeProps(out);
}

/** The direction names a layout's `down` accepts, for docs and the check. */
export const LAYOUT_DIRS = DIR_NAMES;
