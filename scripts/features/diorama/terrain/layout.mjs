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
  normalizeProp, scaleProp, KIT_PART_SHAPES, KIT_PARTS_MAX, KIT_NAME_MAX, MODEL_RULES, POINTS_MAX, PATH_MAX, PROFILE_MAX, BEVEL_MAX,
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
  const toCells = (v) => (unit === "q" ? v / Q_PER_CELL : v / distance);
  const kits = kitDefinitions(L, { errors, warnings, toCells });
  const props = propPlacements(L.props, { errors, warnings, off, map, mirror, toCells, kits });
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

const PROP_KEYS = new Set(["id", "shape", "at", "w", "d", "h", "elev", "rot", "mat", "tint", "solid", "hidden", "label", "img", "mirror",
  "points", "path", "thick", "profile", "bevel", "cliff", "roof", "src", "scale", "rules", "kit"]);
/** What a kit's part may carry (its `at` and outlines are relative to the kit's origin). */
const PART_KEYS = new Set(["shape", "at", "w", "d", "h", "elev", "rot", "mat", "tint", "solid", "points", "path", "thick", "profile", "bevel"]);
/** Shapes that keep an outline, a path or a profile. */
const OUTLINED = new Set(["slab", "extrude"]);

/**
 * Check the fields every placement and every kit part shares. `part`: a kit
 * part, whose outlines are relative [dRow, dCol] and whose elev is an offset.
 * @returns {boolean} true when something failed
 */
function checkShared(p, { bad, warnings, where, toCells, part = false }) {
  let failed = false;
  for (const k of ["w", "d"]) {
    if (p[k] !== undefined && (!isNum(p[k]) || p[k] < SIZE_MIN || p[k] > SIZE_MAX)) failed = bad(`"${k}" must be ${SIZE_MIN} to ${SIZE_MAX} squares.`);
  }
  if (p.h !== undefined && (!isNum(p.h) || toCells(p.h) < H_MIN || toCells(p.h) > SIZE_MAX)) failed = bad(`"h" must be a positive height in the layout's height unit.`);
  if (p.elev !== undefined && p.elev !== null && (!isNum(p.elev) || Math.abs(toCells(p.elev)) > ELEV_LIMIT)) {
    failed = bad(part ? `"elev" must be a height above the kit's base.` : `"elev" must be a height (or null to stand on the ground).`);
  }
  if (p.rot !== undefined && !isNum(p.rot)) failed = bad(`"rot" must be degrees clockwise.`);
  if (p.mat !== undefined && !PROP_MATERIALS.includes(p.mat)) failed = bad(`"mat" must be one of ${PROP_MATERIALS.join(", ")}.`);
  if (p.tint !== undefined && p.tint !== null && !(typeof p.tint === "string" && /^#[0-9a-f]{6}$/i.test(p.tint))) failed = bad(`"tint" must be "#rrggbb" or null.`);
  if (p.solid !== undefined && typeof p.solid !== "boolean") failed = bad(`"solid" must be true or false.`);
  const pairs = (v, n0, max) => Array.isArray(v) && v.length >= n0 && v.length <= max && v.every((q) => Array.isArray(q) && (q.length === 2 || q.length === 3) && q.every(isNum));
  if (p.points !== undefined) {
    if (!OUTLINED.has(p.shape)) warnings.push(`${where}: only a slab or an extrude keeps "points"; they were ignored.`);
    else if (!pairs(p.points, 3, POINTS_MAX) || p.points.some((q) => q.length !== 2)) failed = bad(`"points" must be 3 to ${POINTS_MAX} [row, col] corners${part ? ", relative to the kit's origin" : " on the map"}.`);
  }
  if (p.path !== undefined) {
    if (p.shape !== "pipe") warnings.push(`${where}: only a pipe keeps "path"; it was ignored.`);
    else if (!pairs(p.path, 2, PATH_MAX)) failed = bad(`"path" must be 2 to ${PATH_MAX} [row, col] or [row, col, height] points${part ? ", relative to the kit's origin" : " on the map"}.`);
  }
  if (p.thick !== undefined && (!isNum(p.thick) || p.thick <= 0 || p.thick > 8)) failed = bad(`"thick" must be a pipe's width in squares, above 0 and up to 8.`);
  if (p.profile !== undefined) {
    if (p.shape !== "lathe") warnings.push(`${where}: only a lathe keeps "profile"; it was ignored.`);
    else if (!pairs(p.profile, 2, PROFILE_MAX) || p.profile.some((q) => q.length !== 2 || q[0] < 0 || q[0] > 1 || q[1] < 0 || q[1] > 1)) {
      failed = bad(`"profile" must be 2 to ${PROFILE_MAX} [radius, height] pairs, each 0 to 1 of the prop's half-width and height.`);
    }
  }
  if (p.bevel !== undefined && (!isNum(p.bevel) || p.bevel < 0 || p.bevel > BEVEL_MAX)) failed = bad(`"bevel" must be 0 to ${BEVEL_MAX} squares.`);
  if (p.bevel !== undefined && p.shape !== "extrude") warnings.push(`${where}: only an extrude keeps "bevel"; it was ignored.`);
  if (!part && !p.points && OUTLINED.has(p.shape) && !isPair(p.at)) failed = bad(`a ${p.shape} needs "at" (a w × d rectangle) or "points" (its outline).`);
  if (!part && p.shape === "pipe" && !p.path && !isPair(p.at)) failed = bad(`a pipe needs "at" (straight along w) or "path" (its centre line).`);
  if (!part && !OUTLINED.has(p.shape) && p.shape !== "pipe" && !isPair(p.at)) failed = bad(`"at" must be [row, col], the middle of its footprint in map squares.`);
  if (part && !isPair(p.at) && !p.points && !p.path) failed = bad(`"at" must be [dRow, dCol] from the kit's origin.`);
  return failed;
}

/** Reflect a list of [row, col(, z)] points on the map across an axis. */
function reflectPoints(points, axis, mirror) {
  return points.map((q) => (axis === "cols" ? [q[0], mirror.cols - q[1], ...q.slice(2)] : [mirror.rows - q[0], q[1], ...q.slice(2)]));
}

/**
 * Reflect a kit's raw parts in the kit's own frame: "x" across its local
 * columns, "y" across its rows. A part with an outline mirrors the outline
 * itself; a part without one is symmetric across its width, so a row
 * reflection is a half turn (rot → 180 − rot), like a placed prop's.
 */
function reflectParts(parts, axis) {
  return parts.map((q) => {
    const o = { ...q };
    const outlined = !!(q.points || q.path);
    if (axis === "x") {
      o.x = -q.x;
      o.rot = -q.rot;
      if (q.points) o.points = q.points.map(([x, y]) => [-x, y]);
      if (q.path) o.path = q.path.map(([x, y, z]) => [-x, y, z]);
    } else {
      o.y = -q.y;
      o.rot = outlined ? -q.rot : 180 - q.rot;
      if (q.points) o.points = q.points.map(([x, y]) => [x, -y]);
      if (q.path) o.path = q.path.map(([x, y, z]) => [x, -y, z]);
    }
    return o;
  });
}

/**
 * A layout's kits: name → raw parts (relative to the kit's origin, in cells),
 * or an empty map. A kit is a prop built from primitives, defined once and
 * placed many times (`{"shape": "kit", "kit": "name", "at": …}`).
 */
function kitDefinitions(L, { errors, warnings, toCells }) {
  const kits = new Map();
  let src = L.kits;
  if (src === undefined && L.models !== undefined) {
    warnings.push(`"models" is read as "kits" (the layout's name for crafted props); rename it to stop this warning.`);
    src = L.models;
  }
  if (src === undefined) return kits;
  if (!src || typeof src !== "object" || Array.isArray(src)) { errors.push(`"kits" must be an object: { "name": { "parts": [ … ] } }.`); return kits; }
  for (const [name, def] of Object.entries(src)) {
    const at = `kits["${name}"]`;
    if (!name.trim() || name.length > KIT_NAME_MAX) { errors.push(`${at}: a kit's name must be 1 to ${KIT_NAME_MAX} characters.`); continue; }
    const parts = Array.isArray(def) ? def : def?.parts;
    if (!Array.isArray(parts) || !parts.length) { errors.push(`${at} needs "parts": a non-empty array of primitives.`); continue; }
    if (parts.length > KIT_PARTS_MAX) errors.push(`${at} has ${parts.length} parts; the most is ${KIT_PARTS_MAX}.`);
    const out = [];
    parts.slice(0, KIT_PARTS_MAX).forEach((q, n) => {
      const where = `${at}.parts[${n}] (${typeof q?.shape === "string" ? q.shape : "?"})`;
      const bad = (msg) => { errors.push(`${where}: ${msg}`); return true; };
      if (!q || typeof q !== "object" || Array.isArray(q)) { bad("is not an object."); return; }
      for (const k of Object.keys(q)) if (!PART_KEYS.has(k)) warnings.push(`${where}: "${k}" is not a kit part field and was ignored.`);
      if (!KIT_PART_SHAPES.includes(q.shape)) { bad(`"shape" must be one of ${KIT_PART_SHAPES.join(", ")} (a kit cannot hold a slab, a card, a model or another kit).`); return; }
      if (checkShared(q, { bad, warnings, where, toCells, part: true })) return;
      const def0 = SHAPE_DEFAULTS[q.shape];
      const [dr, dc] = isPair(q.at) ? q.at : [0, 0];
      out.push({
        shape: q.shape, x: dc, y: dr,
        w: q.w ?? def0.w, d: q.d ?? def0.d,
        h: q.h !== undefined ? toCells(q.h) : def0.h,
        elev: q.elev !== undefined && q.elev !== null ? toCells(q.elev) : 0,
        rot: isNum(q.rot) ? q.rot : 0,
        mat: q.mat ?? def0.mat, tint: q.tint ?? null, solid: q.solid ?? def0.solid,
        points: OUTLINED.has(q.shape) && q.points ? q.points.map(([r, c]) => [c, r]) : undefined,
        path: q.shape === "pipe" && q.path ? q.path.map(([r, c, z]) => [c, r, z !== undefined ? toCells(z) : (q.thick ?? def0.d) / 2]) : undefined,
        thick: q.thick, profile: q.profile, bevel: q.bevel,
      });
    });
    if (out.length) kits.set(name, out);
  }
  return kits;
}

/**
 * A layout's props as stored props (canvas cells), or null when the layout has
 * no `props` key, which leaves the scene's own props alone. `at` is the
 * footprint's centre in map squares, [row, col]; `w`/`d` are squares; `h` and
 * `elev` are heights in the layout's height unit. A slab or an extrude may
 * give `points` instead (its outline, [row, col] corners on the map, at any
 * precision); a pipe may give `path` ([row, col] or [row, col, height] points
 * on the map, the height its centre line's). A kit names one of the layout's
 * `kits` and stands its origin at `at`, turned by `rot`, sized by `scale`.
 *
 * A mirrored prop is reflected with its turn: across a column axis
 * rot → −rot, across a row axis rot → 180 − rot, so a wedge still climbs
 * toward the reflected side. An outline or a path reflects point by point; a
 * kit reflects its parts in its own frame.
 */
function propPlacements(list, { errors, warnings, off, map, mirror, toCells, kits }) {
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
    let failed = checkShared(p, { bad, warnings, where, toCells });
    if (p.hidden !== undefined && typeof p.hidden !== "boolean") failed = bad(`"hidden" must be true or false.`);
    if (p.roof !== undefined && typeof p.roof !== "boolean") failed = bad(`"roof" must be true or false.`);
    for (const k of ["label", "img", "id", "src"]) if (p[k] !== undefined && typeof p[k] !== "string") failed = bad(`"${k}" must be a string.`);
    if (p.id !== undefined && typeof p.id === "string") {
      if (!/^[A-Za-z0-9_-]{1,28}$/.test(p.id)) failed = bad(`"id" must be 1 to 28 letters, digits, "_" or "-".`);
      else if (ids.has(p.id)) failed = bad(`the id "${p.id}" is used twice.`);
      else ids.add(p.id);
    }
    if (typeof p.img === "string" && p.img.length > IMG_MAX) failed = bad(`"img" is longer than ${IMG_MAX} characters; use a file path, not a data URL.`);
    if (p.img !== undefined && p.shape !== "card") warnings.push(`${where}: only a card shows "img"; it was ignored.`);
    if (p.shape === "card" && !p.img) warnings.push(`${where}: a card with no "img" draws as a blank panel.`);
    if (p.cliff !== undefined && !CLIFF_MATERIALS.includes(p.cliff)) failed = bad(`"cliff" must be one of ${CLIFF_MATERIALS.join(", ")}.`);
    if (p.cliff !== undefined && p.shape !== "slab") warnings.push(`${where}: only a slab has a "cliff" side; it was ignored.`);
    if (p.shape === "model") {
      if (typeof p.src !== "string" || !/\.(glb|gltf)(\?|#|$)/i.test(p.src)) failed = bad(`a model needs "src": a .glb or .gltf file path.`);
      else if (p.src.length > IMG_MAX) failed = bad(`"src" is longer than ${IMG_MAX} characters.`);
      if (p.rules !== undefined && !MODEL_RULES.includes(p.rules)) failed = bad(`"rules" must be one of ${MODEL_RULES.join(", ")}.`);
    } else {
      for (const k of ["src", "rules"]) if (p[k] !== undefined) warnings.push(`${where}: only a model keeps "${k}"; it was ignored.`);
    }
    if (p.scale !== undefined && (!isNum(p.scale) || p.scale <= 0 || p.scale > 1000)) failed = bad(`"scale" must be a number above 0.`);
    if (p.scale !== undefined && p.shape !== "model" && p.shape !== "kit") warnings.push(`${where}: only a model or a kit takes "scale"; it was ignored.`);
    let kitParts = null;
    if (p.shape === "kit") {
      if (typeof p.kit !== "string" || !p.kit) failed = bad(`a kit placement needs "kit": the name of one of the layout's "kits".`);
      else if (!kits.has(p.kit)) failed = bad(`there is no kit called "${p.kit}" in "kits"${kits.size ? ` (there is ${[...kits.keys()].map((k) => `"${k}"`).join(", ")})` : ""}.`);
      else kitParts = kits.get(p.kit);
      for (const k of ["w", "d", "h"]) if (p[k] !== undefined) warnings.push(`${where}: a kit's "${k}" comes from its parts; use "scale" to size it.`);
    } else if (p.kit !== undefined) warnings.push(`${where}: only a kit placement keeps "kit"; it was ignored.`);
    const outline = OUTLINED.has(p.shape) && Array.isArray(p.points) ? p.points : null;
    const path = p.shape === "pipe" && Array.isArray(p.path) ? p.path : null;
    if ((outline || path) && p.at !== undefined) warnings.push(`${where}: "${outline ? "points" : "path"}" places it; "at" was ignored.`);
    if ((outline || path) && p.rot) warnings.push(`${where}: "${outline ? "points" : "path"}" are on the map already; "rot" was ignored.`);
    let axes = [];
    if (p.mirror) {
      const which = p.mirror === true ? (isNum(mirror.cols) ? "cols" : isNum(mirror.rows) ? "rows" : null) : p.mirror;
      if (!which || !["cols", "rows", "both"].includes(which)) failed = bad(`"mirror" needs a "mirror": {"cols": …} or {"rows": …} axis on the layout.`);
      else if ((which === "cols" || which === "both") && !isNum(mirror.cols)) failed = bad(`there is no "mirror.cols" axis.`);
      else if ((which === "rows" || which === "both") && !isNum(mirror.rows)) failed = bad(`there is no "mirror.rows" axis.`);
      else axes = which === "both" ? ["cols", "rows", "both"] : [which];
    }
    if (failed) return;

    const rot = isNum(p.rot) && !outline && !path ? p.rot : 0;
    const thick = p.thick ?? def.d;
    /** The prop's own keys, before its place: shared by every mirrored copy. */
    const base = {
      shape: p.shape,
      w: p.w ?? def.w, d: p.d ?? def.d,
      h: p.h !== undefined ? toCells(p.h) : def.h,
      elev: p.elev === undefined || p.elev === null ? null : toCells(p.elev),
      mat: p.mat ?? def.mat,
      tint: p.tint ?? null,
      solid: p.solid ?? def.solid,
      hidden: p.hidden ?? false,
      label: p.label ?? "",
      roof: p.roof,
      img: p.shape === "card" ? p.img ?? "" : undefined,
      cliff: p.shape === "slab" ? p.cliff : undefined,
      bevel: p.shape === "extrude" ? p.bevel : undefined,
      profile: p.shape === "lathe" ? p.profile : undefined,
      thick: p.shape === "pipe" ? thick : undefined,
      src: p.shape === "model" ? p.src : undefined,
      scale: p.shape === "model" ? p.scale ?? null : undefined,
      rules: p.shape === "model" ? p.rules : undefined,
      kit: p.shape === "kit" ? p.kit : undefined,
    };
    /** The middle of a list of map points: what "sits on its own axis" is measured by. */
    const middle = (pts) => {
      const rs = pts.map((q) => q[0]), cs = pts.map((q) => q[1]);
      return [(Math.min(...rs) + Math.max(...rs)) / 2, (Math.min(...cs) + Math.max(...cs)) / 2];
    };
    const [r, c] = outline ? middle(outline) : path ? middle(path) : p.at;
    const one = (axis, suffix) => {
      let rr = r, cc = c, turn = rot, pts = outline, line = path, parts = kitParts;
      if (axis === "cols") { cc = mirror.cols - c; turn = -rot; }
      else if (axis === "rows") { rr = mirror.rows - r; turn = parts ? -rot : 180 - rot; }
      else if (axis === "both") { rr = mirror.rows - r; cc = mirror.cols - c; turn = 180 + rot; }
      if (axis && axis !== "both") {
        if (pts) pts = reflectPoints(pts, axis, mirror);
        if (line) line = reflectPoints(line, axis, mirror);
        if (parts) parts = reflectParts(parts, axis === "cols" ? "x" : "y");
      } else if (axis === "both") {
        if (pts) pts = reflectPoints(reflectPoints(pts, "cols", mirror), "rows", mirror);
        if (line) line = reflectPoints(reflectPoints(line, "cols", mirror), "rows", mirror);
      }
      // an outline or a path is reflected point by point, so it is never turned
      if (pts || line) turn = 0;
      if (suffix && Math.abs(rr - r) < 1e-6 && Math.abs(cc - c) < 1e-6) {
        warnings.push(`${where} sits on its own mirror axis, so its mirrored copy was not added.`);
        return;
      }
      if (!(rr >= 0 && cc >= 0 && rr < map.rows && cc < map.cols)) {
        warnings.push(`${where}${suffix ? " (mirrored)" : ""} stands outside the map at [${rr}, ${cc}] and was dropped.`);
        return;
      }
      const o = { ...base, id: p.id !== undefined ? p.id + suffix : undefined, x: cc + off.j, y: rr + off.i, rot: turn };
      if (pts) o.points = pts.map(([pr, pc]) => [pc - cc, pr - rr]);
      if (line) o.path = line.map(([pr, pc, z]) => [pc - cc, pr - rr, z !== undefined ? toCells(z) : thick / 2]);
      if (parts) {
        o.parts = parts;
        let k = normalizeProp(o);
        if (k && isNum(p.scale) && p.scale !== 1) k = normalizeProp({ ...scaleProp(k, p.scale, p.scale, p.scale), id: k.id });
        if (k) { k.id = o.id ?? ""; out.push(k); }
        return;
      }
      out.push(o);
    };
    one(null, "");
    for (const a of axes) one(a, a === "cols" ? "m" : a === "rows" ? "r" : "b");
  });
  return normalizeProps(out);
}

/** The direction names a layout's `down` accepts, for docs and the check. */
export const LAYOUT_DIRS = DIR_NAMES;
