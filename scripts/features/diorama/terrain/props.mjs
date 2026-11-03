/**
 * Diorama — props: primitive objects placed on the board. The model.
 *
 * A prop is a plain object, stored in the scene flag FLAG_PROPS (props-store.mjs
 * is the only reader and writer). Its keys are stored data: never rename one.
 *
 *   id     string   stable, unique per Level ([A-Za-z0-9_-], ≤ 32)
 *   shape  string   PROP_SHAPES
 *   x, y   number   the footprint's CENTRE, in grid cells on the canvas grid
 *                   (px / grid size; 2.5 = the middle of column 2)
 *   w, d   number   footprint width (local x) and depth (local y), in cells
 *   h      number   height, in cells (4 q = 1 cell = one grid distance)
 *   elev   number|null  the base's height in cells; null = stand on whatever
 *                   is under the footprint (the ground, or a solid prop
 *                   placed earlier in the list)
 *   rot    number   degrees, clockwise on the map, [0, 360)
 *   mat    string   PROP_MATERIALS
 *   tint   string|null  "#rrggbb" multiplied over the material, or null
 *   solid  boolean  blocks movement and sight (with the world setting
 *                   dio.propsBlock on), and can be stood on
 *   hidden boolean  GM only: never drawn for a player, never in the rules
 *   label  string   the GM's name for it (editor and tooltip), ≤ 60
 *   roof   boolean  a roof: the view may fade it while a figure is under it
 *                   (default on for the roof shapes, off for everything else)
 *
 * Keys only some shapes keep (and store):
 *
 *   img      card            the image path
 *   points   slab, extrude   the outline, [[x, y], …] in cells from the
 *                            centre before the turn, or null (slab: the
 *                            rectangle w × d). w and d are then its bounds.
 *   cliff    slab            the side material, CLIFF_MATERIALS
 *   bevel    extrude         the edge bevel in cells, 0..0.5
 *   profile  lathe           the outline turned about the axis, [[r, y], …],
 *                            r 0..1 of the half-width, y 0..1 of the height
 *   path     pipe            the centre line, [[x, y, z], …] in cells from the
 *                            centre (z above the base), or null (straight
 *                            along w). w, d and h are then its bounds.
 *   thick    pipe            a path pipe's diameter in cells
 *   kit      kit             the kit's name (a layout's `kits`)
 *   parts    kit             the primitives it is built from (KIT_PART_SHAPES),
 *                            each { shape, x, y, w, d, h, elev, rot, mat, tint,
 *                            solid, … } relative to the kit's centre and base
 *   src      model           a .glb / .gltf path
 *   scale    model           cells per model unit, or null (fit inside w × d × h)
 *   rules    model           the rules footprint: "box" (w × d at h) or "none"
 *   bright   model           its colour × this before the light (BRIGHT_MIN..BRIGHT_MAX,
 *                            default 1); its emission is left alone
 *
 * A slab draws like terrain (the map art on its top, a cliff on its sides);
 * everything else draws like a prop. See docs/DIORAMA_PROPS.md.
 *
 * Units: one cell is one grid square, the same unit the renderer's world space
 * uses, so a prop's numbers read straight across into the 3D view. Heights
 * are cells, not q, so a 1×1×1 box is one cube of grid.
 *
 * Pure: no `game`, `canvas`, `foundry` or DOM. The check tool, the editor and
 * the layout compiler drive it directly.
 */

import { SUB, KIND, DIR_VEC, Q_PER_CELL, CLIFF_MATERIALS } from "../constants.mjs";

export const PROP_FORMAT = 1;
/** Most props a Level keeps (a dense forest board is a few hundred). */
export const PROP_LIMIT = 2000;

/** Shape keys, in palette order. Stored data: never rename. */
export const PROP_SHAPES = Object.freeze([
  "box", "cylinder", "cone", "sphere", "dome", "pyramid", "wedge", "torus", "capsule", "arch",
  "pillar", "crate", "barrel", "rock", "tree", "pine", "bush", "card",
  "slab", "hex", "octagon", "pipe", "stairs", "platform", "fence", "parapet", "beam",
  "sign", "cross", "bowl", "brazier", "lamp", "gable", "hip", "lean", "spire",
  "lathe", "extrude", "kit", "model",
]);

/** Material keys, in palette order. Stored data: never rename. */
export const PROP_MATERIALS = Object.freeze([
  "stone", "marble", "wood", "metal", "foliage", "crystal", "plaster", "cloth", "earth", "ice", "map",
]);

/** Roof shapes: `roof` defaults on, and they are scenery (a solid roof would lift whoever stands under it). */
export const ROOF_SHAPES = Object.freeze(["gable", "hip", "lean", "spire"]);
/** The primitives a kit is built from: every shape but a slab (terrain), a card, a kit and a model. */
export const KIT_PART_SHAPES = Object.freeze(PROP_SHAPES.filter((s) => !["slab", "card", "kit", "model"].includes(s)));
/** Shapes the rules see as a ramp descending to the front (wedgeDir). */
export const RAMP_SHAPES = Object.freeze(["wedge", "stairs"]);
/** A model's rules footprint. */
export const MODEL_RULES = Object.freeze(["box", "none"]);
/** A model's brightness factor range (its colour before the light; 1 = as authored). */
export const BRIGHT_MIN = 0.1, BRIGHT_MAX = 2;
/** Long thin shapes: the rules claim every sub-cell their centre line crosses, however thin. */
const LINEAR = new Set(["fence", "parapet", "beam", "pipe"]);

/** What a freshly placed prop of each shape looks like (cells). */
export const SHAPE_DEFAULTS = Object.freeze({
  box: Object.freeze({ w: 1, d: 1, h: 1, mat: "stone", solid: true }),
  cylinder: Object.freeze({ w: 1, d: 1, h: 1, mat: "stone", solid: true }),
  cone: Object.freeze({ w: 1, d: 1, h: 1.5, mat: "stone", solid: true }),
  sphere: Object.freeze({ w: 1, d: 1, h: 1, mat: "marble", solid: true }),
  dome: Object.freeze({ w: 2, d: 2, h: 1, mat: "stone", solid: true }),
  pyramid: Object.freeze({ w: 1, d: 1, h: 1, mat: "stone", solid: true }),
  wedge: Object.freeze({ w: 1, d: 1, h: 0.5, mat: "stone", solid: true }),
  torus: Object.freeze({ w: 1, d: 1, h: 0.3, mat: "metal", solid: false }),
  capsule: Object.freeze({ w: 0.6, d: 0.6, h: 1.5, mat: "marble", solid: true }),
  arch: Object.freeze({ w: 2, d: 0.5, h: 2, mat: "stone", solid: true }),
  pillar: Object.freeze({ w: 0.7, d: 0.7, h: 3, mat: "marble", solid: true }),
  crate: Object.freeze({ w: 1, d: 1, h: 1, mat: "wood", solid: true }),
  barrel: Object.freeze({ w: 0.7, d: 0.7, h: 1, mat: "wood", solid: true }),
  rock: Object.freeze({ w: 1, d: 0.8, h: 0.6, mat: "stone", solid: true }),
  tree: Object.freeze({ w: 2, d: 2, h: 3.5, mat: "foliage", solid: true }),
  pine: Object.freeze({ w: 1.4, d: 1.4, h: 4, mat: "foliage", solid: true }),
  bush: Object.freeze({ w: 1, d: 1, h: 0.6, mat: "foliage", solid: false }),
  card: Object.freeze({ w: 1, d: 0.1, h: 1.5, mat: "map", solid: false }),
  slab: Object.freeze({ w: 1, d: 1, h: 0.5, mat: "stone", solid: true }),
  hex: Object.freeze({ w: 1, d: 1, h: 1, mat: "stone", solid: true }),
  octagon: Object.freeze({ w: 1, d: 1, h: 1, mat: "stone", solid: true }),
  pipe: Object.freeze({ w: 2, d: 0.3, h: 0.3, mat: "metal", solid: false }),
  stairs: Object.freeze({ w: 1, d: 2, h: 1, mat: "stone", solid: true }),
  platform: Object.freeze({ w: 2, d: 1, h: 0.7, mat: "wood", solid: true }),
  fence: Object.freeze({ w: 2, d: 0.15, h: 0.6, mat: "wood", solid: true }),
  parapet: Object.freeze({ w: 2, d: 0.4, h: 0.6, mat: "stone", solid: true }),
  beam: Object.freeze({ w: 3, d: 0.25, h: 0.25, mat: "wood", solid: false }),
  sign: Object.freeze({ w: 0.8, d: 0.1, h: 1.4, mat: "wood", solid: false }),
  cross: Object.freeze({ w: 0.6, d: 0.12, h: 1.2, mat: "stone", solid: false }),
  bowl: Object.freeze({ w: 1, d: 1, h: 0.4, mat: "stone", solid: true }),
  brazier: Object.freeze({ w: 0.6, d: 0.6, h: 0.6, mat: "metal", solid: true }),
  lamp: Object.freeze({ w: 0.3, d: 0.3, h: 2.4, mat: "metal", solid: false }),
  gable: Object.freeze({ w: 2, d: 2, h: 1, mat: "wood", solid: false }),
  hip: Object.freeze({ w: 3, d: 2, h: 1, mat: "wood", solid: false }),
  lean: Object.freeze({ w: 2, d: 1.5, h: 0.6, mat: "wood", solid: false }),
  spire: Object.freeze({ w: 1.5, d: 1.5, h: 1.5, mat: "wood", solid: false }),
  lathe: Object.freeze({ w: 1, d: 1, h: 1, mat: "marble", solid: true }),
  extrude: Object.freeze({ w: 1, d: 1, h: 0.5, mat: "stone", solid: true }),
  kit: Object.freeze({ w: 1, d: 1, h: 1, mat: "stone", solid: true }),
  model: Object.freeze({ w: 1, d: 1, h: 1, mat: "stone", solid: true }),
});

/** A lathe with no profile of its own: an urn. [r (0..1 of the half-width), y (0..1)]. */
export const DEFAULT_PROFILE = Object.freeze([
  [0, 0], [0.62, 0], [0.7, 0.08], [0.5, 0.2], [0.84, 0.48], [1, 0.7], [0.62, 0.9], [0.7, 1], [0, 1],
]);

/** Longest card image (or model) path kept; a longer one is dropped, not cut. */
export const IMG_MAX = 2048;
export const SIZE_MIN = 0.1;
export const SIZE_MAX = 64;
export const H_MIN = 0.05;
export const ELEV_LIMIT = 256;
/** Most corners an outline keeps (slab, extrude). */
export const POINTS_MAX = 256;
/** Most points a lathe profile or a pipe path keeps. */
export const PROFILE_MAX = 48;
export const PATH_MAX = 64;
/** Most primitives one kit is built from. */
export const KIT_PARTS_MAX = 64;
export const KIT_NAME_MAX = 40;
export const BEVEL_MAX = 0.5;

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Two decimals: enough for a sixteenth of a cell, and stable through JSON. */
const r2 = (v) => Math.round(v * 100) / 100;
/** Three decimals for outlines: a painted edge is measured finer than a sixteenth. */
const r3 = (v) => Math.round(v * 1000) / 1000;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** FNV-1a over a string → unsigned 32-bit. */
export function hashString(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A prop's stable 0..1 seed (rock variant, sway phase, grain offset). */
export const propSeed = (id) => (hashString(id) % 100003) / 100003;

/* ---------------------------------------------------------------- normalising */

/** An outline: 3..POINTS_MAX finite [x, y] pairs with some area, or null. */
function normPoints(raw) {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const pts = [];
  for (const q of raw.slice(0, POINTS_MAX)) {
    if (!Array.isArray(q) || !isNum(Number(q[0])) || !isNum(Number(q[1]))) return null;
    pts.push([r3(clamp(Number(q[0]), -SIZE_MAX, SIZE_MAX)), r3(clamp(Number(q[1]), -SIZE_MAX, SIZE_MAX))]);
  }
  return Math.abs(polygonArea(pts)) > 1e-4 ? pts : null;
}

/** A lathe profile: 2..PROFILE_MAX [r, y] pairs in [0, 1], or the default. */
function normProfile(raw) {
  if (!Array.isArray(raw) || raw.length < 2) return DEFAULT_PROFILE.map((q) => [...q]);
  const out = [];
  for (const q of raw.slice(0, PROFILE_MAX)) {
    if (!Array.isArray(q) || !isNum(Number(q[0])) || !isNum(Number(q[1]))) return DEFAULT_PROFILE.map((v) => [...v]);
    out.push([r3(clamp(Number(q[0]), 0, 1)), r3(clamp(Number(q[1]), 0, 1))]);
  }
  return out.some((q) => q[0] > 0.01) ? out : DEFAULT_PROFILE.map((q) => [...q]);
}

/** A pipe's centre line: 2..PATH_MAX finite [x, y, z] (z ≥ 0), or null. */
function normPath(raw) {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const out = [];
  for (const q of raw.slice(0, PATH_MAX)) {
    if (!Array.isArray(q) || !isNum(Number(q[0])) || !isNum(Number(q[1]))) return null;
    out.push([r3(clamp(Number(q[0]), -SIZE_MAX, SIZE_MAX)), r3(clamp(Number(q[1]), -SIZE_MAX, SIZE_MAX)), r3(clamp(num(q[2], 0), 0, SIZE_MAX))]);
  }
  let len = 0;
  for (let i = 1; i < out.length; i++) len += Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1], out[i][2] - out[i - 1][2]);
  return len > 0.05 ? out : null;
}

/** Shoelace area of [[x, y], …] (signed). */
export function polygonArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return a / 2;
}

/** Even-odd point in polygon. */
export function inPolygon(pts, x, y) {
  let inside = false;
  for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
    const [xa, ya] = pts[a], [xb, yb] = pts[b];
    if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
  }
  return inside;
}

/** Turn a local offset by `deg` (clockwise on the map). */
function turn(dx, dy, deg) {
  const a = (deg || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [dx * c - dy * s, dx * s + dy * c];
}

/**
 * Shift a prop so its own centre is the middle of what it holds (points,
 * path, parts), and set w, d (and for paths and kits h) to those bounds. A
 * shift under a thousandth is not made, so a normalised prop is a fixed point.
 */
function recentre(p, lx0, lx1, ly0, ly1, apply) {
  const cx = (lx0 + lx1) / 2, cy = (ly0 + ly1) / 2;
  if (Math.abs(cx) > 1e-3 || Math.abs(cy) > 1e-3) {
    apply(cx, cy);
    const [dx, dy] = turn(cx, cy, p.rot);
    p.x = r3(p.x + dx);
    p.y = r3(p.y + dy);
  }
  p.w = r3(clamp(lx1 - lx0, SIZE_MIN, SIZE_MAX));
  p.d = r3(clamp(ly1 - ly0, SIZE_MIN, SIZE_MAX));
}

/** The four corners (local cells, before the turn) of a part's footprint. */
function partCorners(q) {
  return [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([u, v]) => {
    const [dx, dy] = turn(u * q.w, v * q.d, q.rot);
    return [q.x + dx, q.y + dy];
  });
}

/**
 * The core keys and the shape's own, from raw. `part` = a kit's part: no id,
 * hidden, label or roof, elev is an offset from the kit's base (never null),
 * and x / y are offsets from the kit's centre.
 */
function build(raw, { part = false } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const shape = String(raw.shape ?? "");
  if (!(part ? KIT_PART_SHAPES : PROP_SHAPES).includes(shape)) return null;
  const x = part ? num(raw.x, 0) : Number(raw.x), y = part ? num(raw.y, 0) : Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const def = SHAPE_DEFAULTS[shape];
  const size = (v, d) => r2(clamp(num(v, d), SIZE_MIN, SIZE_MAX));
  const rot = ((num(raw.rot, 0) % 360) + 360) % 360;
  const elevRaw = raw.elev;
  const elev = part
    ? r2(clamp(num(elevRaw, 0), -ELEV_LIMIT, ELEV_LIMIT))
    : elevRaw === null || elevRaw === undefined || elevRaw === "" || !Number.isFinite(Number(elevRaw))
      ? null : r2(clamp(Number(elevRaw), -ELEV_LIMIT, ELEV_LIMIT));
  const p = part ? { shape } : { id: ID_RE.test(String(raw.id ?? "")) ? String(raw.id) : "", shape };
  Object.assign(p, {
    // three decimals: an outline's recentred middle lands between hundredths
    x: r3(clamp(x, -1e5, 1e5)),
    y: r3(clamp(y, -1e5, 1e5)),
    w: size(raw.w, def.w),
    d: size(raw.d, def.d),
    h: r2(clamp(num(raw.h, def.h), H_MIN, SIZE_MAX)),
    elev,
    rot: r2(rot) % 360,
    mat: PROP_MATERIALS.includes(raw.mat) ? raw.mat : def.mat,
    tint: HEX_RE.test(String(raw.tint ?? "")) ? String(raw.tint).toLowerCase() : null,
    solid: typeof raw.solid === "boolean" ? raw.solid : def.solid,
  });
  if (!part) {
    p.hidden = raw.hidden === true;
    p.label = typeof raw.label === "string" ? raw.label.slice(0, 60) : "";
    p.roof = typeof raw.roof === "boolean" ? raw.roof : ROOF_SHAPES.includes(shape);
    // A path, never cut: a truncated path (or data URL) decodes as a blank card.
    p.img = shape === "card" && typeof raw.img === "string" && raw.img.length <= IMG_MAX ? raw.img : "";
  }

  switch (shape) {
    case "slab": case "extrude": {
      const pts = normPoints(raw.points);
      p.points = pts;
      if (pts) {
        const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
        recentre(p, Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), (cx, cy) => {
          for (const q of pts) { q[0] = r3(q[0] - cx); q[1] = r3(q[1] - cy); }
        });
      }
      if (shape === "slab") p.cliff = CLIFF_MATERIALS.includes(raw.cliff) ? raw.cliff : "stone";
      else p.bevel = r3(clamp(num(raw.bevel, 0.04), 0, BEVEL_MAX));
      break;
    }
    case "lathe":
      p.profile = normProfile(raw.profile);
      break;
    case "pipe": {
      const path = normPath(raw.path);
      p.path = path;
      p.thick = r3(clamp(num(raw.thick, Math.min(p.d, p.h)), 0.02, 8));
      if (path) {
        const rr = p.thick / 2;
        const xs = path.map((q) => q[0]), ys = path.map((q) => q[1]);
        recentre(p, Math.min(...xs) - rr, Math.max(...xs) + rr, Math.min(...ys) - rr, Math.max(...ys) + rr, (cx, cy) => {
          for (const q of path) { q[0] = r3(q[0] - cx); q[1] = r3(q[1] - cy); }
        });
        p.h = r3(clamp(Math.max(...path.map((q) => q[2])) + rr, H_MIN, SIZE_MAX));
      }
      break;
    }
    case "kit": {
      if (part) return null;
      const parts = [];
      for (const q of Array.isArray(raw.parts) ? raw.parts.slice(0, KIT_PARTS_MAX) : []) {
        const n = build(q, { part: true });
        if (n) parts.push(n);
      }
      if (!parts.length) return null;
      p.kit = typeof raw.kit === "string" ? raw.kit.slice(0, KIT_NAME_MAX) : "";
      p.parts = parts;
      const cs = parts.flatMap(partCorners);
      const xs = cs.map((q) => q[0]), ys = cs.map((q) => q[1]);
      recentre(p, Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), (cx, cy) => {
        for (const q of parts) { q.x = r3(q.x - cx); q.y = r3(q.y - cy); }
      });
      // a kit's height is its tallest part's top; parts below the base are allowed
      p.h = r2(clamp(Math.max(...parts.map((q) => q.elev + q.h)), H_MIN, SIZE_MAX));
      break;
    }
    case "model":
      if (part) return null;
      p.src = typeof raw.src === "string" && raw.src.length <= IMG_MAX ? raw.src : "";
      p.scale = raw.scale === null || raw.scale === undefined || raw.scale === "" || !(Number(raw.scale) > 0)
        ? null : r3(clamp(Number(raw.scale), 0.001, 1000));
      p.rules = MODEL_RULES.includes(raw.rules) ? raw.rules : "box";
      p.bright = raw.bright === null || raw.bright === undefined || raw.bright === "" || !Number.isFinite(Number(raw.bright))
        ? 1 : r2(clamp(Number(raw.bright), BRIGHT_MIN, BRIGHT_MAX));
      break;
  }
  return p;
}

/**
 * One prop, sanitised. Total: anything that cannot be a prop comes back null
 * (not an object, an unknown shape, no position, a kit with no usable part).
 * Everything else defaults. The id is kept only when valid; normalizeProps()
 * mints the missing ones.
 * @returns {object|null}
 */
export function normalizeProp(raw) {
  return build(raw);
}

/** One kit part, sanitised (null when it cannot be one). */
export function normalizePart(raw) {
  return build(raw, { part: true });
}

/**
 * A list of props, sanitised: unusable entries dropped, ids made unique.
 * A missing or repeated id is minted from the prop's position in the list and
 * its own content, so the same stored list always mints the same ids (a client
 * that never wrote the repair back still resolves a click to the right row).
 */
export function normalizeProps(list) {
  const out = [];
  const seen = new Set();
  const src = Array.isArray(list) ? list : [];
  for (let i = 0; i < src.length && out.length < PROP_LIMIT; i++) {
    const p = normalizeProp(src[i]);
    if (!p) continue;
    if (!p.id || seen.has(p.id)) {
      const base = `p${(hashString(`${i}|${p.shape}|${p.x}|${p.y}|${p.w}|${p.d}|${p.h}`) % 0xffffff).toString(36)}`;
      let id = base, n = 1;
      while (seen.has(id)) id = `${base}-${n++}`;
      p.id = id;
    }
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/** A new id not in `taken` (editor placement). */
export function mintPropId(taken, salt = "") {
  const has = taken instanceof Set ? taken : new Set(taken ?? []);
  let n = has.size;
  for (;;) {
    const id = `p${(hashString(`${salt}|${n}`) % 0xffffff).toString(36)}`;
    if (!has.has(id)) return id;
    n++;
  }
}

const cloneList = (l) => (l ? l.map((q) => [...q]) : null);

/** The shape's own keys, stored after the common ones. */
function ownToJSON(p, o) {
  switch (p.shape) {
    case "card": o.img = p.img; break;
    case "slab": o.points = cloneList(p.points); o.cliff = p.cliff; break;
    case "extrude": o.points = cloneList(p.points); o.bevel = p.bevel; break;
    case "lathe": o.profile = cloneList(p.profile); break;
    case "pipe": o.path = cloneList(p.path); o.thick = p.thick; break;
    case "kit": o.kit = p.kit; o.parts = p.parts.map(partToJSON); break;
    case "model": o.src = p.src; o.scale = p.scale; o.rules = p.rules; if (p.bright !== 1) o.bright = p.bright; break;
  }
  return o;
}

/** A kit part's stored form. */
export function partToJSON(q) {
  return ownToJSON(q, { shape: q.shape, x: q.x, y: q.y, w: q.w, d: q.d, h: q.h, elev: q.elev, rot: q.rot, mat: q.mat, tint: q.tint, solid: q.solid });
}

/** The stored form: exactly the documented keys, in order. */
export function propToJSON(p) {
  return ownToJSON(p, { id: p.id, shape: p.shape, x: p.x, y: p.y, w: p.w, d: p.d, h: p.h, elev: p.elev, rot: p.rot,
    mat: p.mat, tint: p.tint, solid: p.solid, hidden: p.hidden, label: p.label, roof: !!p.roof });
}

/**
 * A prop scaled by (sx, sy, sz) about its centre and base: what typing a new
 * width into the editor does to a shape whose w and d are the bounds of what
 * it holds (an outline, a path, a kit). Plain shapes just take the new size.
 */
export function scaleProp(p, sx = 1, sy = 1, sz = 1) {
  const o = { ...p, w: p.w * sx, d: p.d * sy, h: p.h * sz };
  if (p.points) o.points = p.points.map(([x, y]) => [x * sx, y * sy]);
  if (p.path) { o.path = p.path.map(([x, y, z]) => [x * sx, y * sy, z * sz]); o.thick = p.thick * Math.min(sx, sy, sz); }
  if (p.parts) {
    // a kit scales as a whole: a turned part keeps its turn, so the factor is uniform
    const k = (sx + sy) / 2;
    o.parts = p.parts.map((q) => ({
      ...q, x: q.x * k, y: q.y * k, w: q.w * k, d: q.d * k, h: q.h * sz, elev: q.elev * sz,
      points: q.points ? q.points.map(([x, y]) => [x * k, y * k]) : q.points,
      path: q.path ? q.path.map(([x, y, z]) => [x * k, y * k, z * sz]) : q.path,
    }));
  }
  return o;
}

/* ---------------------------------------------------------------- footprint */

/**
 * The top of a shape over its footprint, as a fraction of its height, at
 * local coordinates (u, v) in [-0.5, 0.5] (u across the width, v along the
 * depth, before rotation). -1 where the footprint does not reach the ground
 * (outside an ellipse, the opening of an arch).
 *
 * This is the shape the RULES see: what a token stands on, bumps into and
 * hides behind. It follows the mesh where that matters (a dome is low at its
 * rim, a cone is a point) and simplifies where it would only make the board
 * harder to read (a tree is its trunk and the core of its crown). Shapes
 * whose top depends on more than the shape (an outline, a profile, a path)
 * are read through coverAt.
 */
export function profileAt(shape, u, v) {
  const r = Math.hypot(u * 2, v * 2);
  switch (shape) {
    case "box": case "crate": case "card": case "slab": case "extrude": case "pipe": case "platform":
    case "fence": case "parapet": case "beam": case "sign": case "cross": case "kit": case "model":
      return 1;
    case "cylinder": case "barrel": case "pillar": case "capsule": case "bowl": case "brazier": case "lamp": case "lathe":
      return r <= 1 ? 1 : -1;
    case "sphere":
      return r <= 1 ? 0.5 + 0.5 * Math.sqrt(Math.max(0, 1 - r * r)) : -1;
    case "dome": case "bush": case "rock":
      return r <= 1 ? Math.sqrt(Math.max(0, 1 - r * r)) : -1;
    case "cone": case "pine": case "spire":
      return r <= 1 ? Math.max(0, 1 - r) : -1;
    case "tree":
      return r <= 0.5 ? 1 : -1;
    case "pyramid": case "hip":
      return Math.max(0, 1 - Math.max(Math.abs(u), Math.abs(v)) * 2);
    case "gable":
      return Math.max(0, 1 - Math.abs(v) * 2);
    case "wedge": case "stairs": case "lean":
      // high along the back edge (v = -0.5), down to the ground at the front
      return clamp(0.5 - v, 0, 1);
    case "torus": {
      if (r < 0.5 || r > 1) return -1;
      const k = (r - 0.75) / 0.25;
      return Math.sqrt(Math.max(0, 1 - k * k));
    }
    case "arch":
      return Math.abs(u) >= 0.3 ? 1 : -1;
    case "hex":
      return Math.abs(v) <= 0.5 && 2 * Math.abs(u) + Math.abs(v) <= 1 ? 1 : -1;
    case "octagon":
      return Math.abs(u) + Math.abs(v) <= 0.7072 ? 1 : -1;
    default:
      return 1;
  }
}

/** Distance from (x, y) to segment a-b in the plane, and the segment parameter. */
function segDist(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  const t = L > 0 ? clamp(((x - a[0]) * dx + (y - a[1]) * dy) / L, 0, 1) : 0;
  return [Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t)), t];
}

/** A lathe's top at radius rr (0..1 of the half-width), as a fraction of its height, or -1. */
function latheTop(profile, rr) {
  let top = -1;
  for (let i = 1; i < profile.length; i++) {
    const [ra, ya] = profile[i - 1], [rb, yb] = profile[i];
    const lo = Math.min(ra, rb), hi = Math.max(ra, rb);
    if (rr < lo - 1e-6 || rr > hi + 1e-6) continue;
    const t = hi - lo < 1e-6 ? 1 : (rr - ra) / (rb - ra);
    top = Math.max(top, hi - lo < 1e-6 ? Math.max(ya, yb) : ya + (yb - ya) * t);
  }
  return top;
}

/**
 * The fraction of its height a prop covers at local (u, v), or -1: profileAt,
 * with the shapes that carry their own outline (points, profile, path) and
 * the hip, whose ridge follows its proportions. `linear` widens a thin line to
 * half a sub-cell either side of its centre, so a fence is never stepped over.
 */
export function coverAt(p, u, v) {
  const lx = u * p.w, ly = v * p.d;
  if (p.points) return inPolygon(p.points, lx, ly) ? 1 : -1;
  if (p.shape === "pipe" && p.path) {
    const reach = Math.max(p.thick / 2, 0.5 / SUB);
    let best = -1;
    for (let i = 1; i < p.path.length; i++) {
      const a = p.path[i - 1], b = p.path[i];
      const [dist, t] = segDist(lx, ly, a, b);
      if (dist <= reach) best = Math.max(best, (a[2] + (b[2] - a[2]) * t + p.thick / 2) / Math.max(p.h, 1e-3));
    }
    return best < 0 ? -1 : Math.min(1, best);
  }
  if (p.shape === "lathe") return latheTop(p.profile ?? DEFAULT_PROFILE, Math.hypot(u * 2, v * 2));
  if (p.shape === "model") return p.rules === "none" ? -1 : 1;
  if (p.shape === "hip") {
    const run = Math.min(p.w, p.d) / 2;
    const du = p.w / 2 - Math.abs(lx), dv = p.d / 2 - Math.abs(ly);
    return du < 0 || dv < 0 ? -1 : clamp(Math.min(du, dv) / Math.max(run, 1e-3), 0, 1);
  }
  return profileAt(p.shape, u, v);
}

/** The DIR a wedge descends toward (DIR_VEC order), from its rotation. */
export function wedgeDir(rotDeg) {
  const a = (Number(rotDeg) || 0) * Math.PI / 180;
  // local +v (the low front) in map coordinates, y down
  const vx = -Math.sin(a), vy = Math.cos(a);
  let best = 0, bd = -Infinity;
  for (let k = 0; k < 4; k++) {
    const [dx, dz] = DIR_VEC[k];
    const dot = dx * vx + dz * vy;
    if (dot > bd) { bd = dot; best = k; }
  }
  return best;
}

/** Local (u, v) of a map point (cells) in a prop's footprint. */
export function localOf(p, x, y) {
  const a = (p.rot || 0) * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const dx = x - p.x, dy = y - p.y;
  return [(dx * c + dy * s) / p.w, (-dx * s + dy * c) / p.d];
}

/** Map point (cells) of local (u, v). */
export function worldOf(p, u, v) {
  const a = (p.rot || 0) * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const lx = u * p.w, ly = v * p.d;
  return [p.x + lx * c - ly * s, p.y + lx * s + ly * c];
}

/** The four corners of the footprint, map cells, clockwise from the back left. */
export function footprintCorners(p) {
  return [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([u, v]) => worldOf(p, u, v));
}

/**
 * The footprint's outline in map cells: a slab's or an extrusion's own
 * outline, the four corners of everything else. What the editor and the
 * layout check draw over the art.
 */
export function footprintOutline(p) {
  if (!p.points) return footprintCorners(p);
  return p.points.map(([lx, ly]) => worldOf(p, lx / p.w, ly / p.d));
}

/**
 * A kit's parts as props in their own right: placed on the map (centre and
 * turn composed with the kit's), with `elev` still an offset from the kit's
 * base. Each keeps the kit's id, so the view can treat the kit as one thing.
 */
export function kitParts(kit) {
  if (!Array.isArray(kit?.parts)) return [];
  return kit.parts.map((q) => {
    const [dx, dy] = turn(q.x, q.y, kit.rot);
    return { ...q, id: kit.id, x: kit.x + dx, y: kit.y + dy, rot: ((q.rot + (kit.rot || 0)) % 360 + 360) % 360,
      tint: kit.tint ?? q.tint, hidden: !!kit.hidden };
  });
}

/**
 * Every sub-cell a prop stands on, with its profile there: { si, sj, f, ramp }
 * (ramp = the DIR a ramp descends there, or -1). A sub-cell counts when its
 * centre is inside. A prop too small to cover any sub-cell centre still claims
 * the one under its own centre, so a thin post is never walked through; a slab
 * claims exactly what its outline covers, like terrain.
 *
 * A kit is the union of its parts (only the solid ones with `solidOnly`),
 * each part's top taken as a fraction of the kit's own height.
 * @returns {{si:number, sj:number, f:number, ramp:number}[]}
 */
export function footprintCells(p, { solidOnly = false } = {}) {
  if (p.shape === "kit") {
    const best = new Map();
    const H = Math.max(p.h, 1e-3);
    for (const q of kitParts(p)) {
      if (solidOnly && !q.solid) continue;
      for (const c of footprintCells(q)) {
        const f = (q.elev + c.f * q.h) / H;
        const k = `${c.si},${c.sj}`;
        const o = best.get(k);
        if (!o || f > o.f) best.set(k, { ...c, f });
      }
    }
    return [...best.values()];
  }
  const corners = footprintCorners(p);
  const pad = LINEAR.has(p.shape) ? 0.5 / SUB : 0;
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  const sj0 = Math.floor((Math.min(...xs) - pad) * SUB), sj1 = Math.ceil((Math.max(...xs) + pad) * SUB);
  const si0 = Math.floor((Math.min(...ys) - pad) * SUB), si1 = Math.ceil((Math.max(...ys) + pad) * SUB);
  const ramp = RAMP_SHAPES.includes(p.shape) ? wedgeDir(p.rot) : -1;
  const thin = LINEAR.has(p.shape) && !p.path;
  const out = [];
  for (let si = si0; si <= si1; si++) {
    for (let sj = sj0; sj <= sj1; sj++) {
      const [u, v] = localOf(p, (sj + 0.5) / SUB, (si + 0.5) / SUB);
      const pathPipe = p.shape === "pipe" && p.path;
      if (!pathPipe) {
        if (Math.abs(u) > 0.5) continue;
        // a thin line: half a sub-cell either side of its centre line
        if (Math.abs(v) > 0.5 && !(thin && Math.abs(v * p.d) <= 0.5 / SUB)) continue;
      }
      const f = coverAt(p, u, pathPipe ? v : clamp(v, -0.5, 0.5));
      if (f >= 0) out.push({ si, sj, f, ramp });
    }
  }
  if (!out.length && p.shape !== "slab") {
    const f = coverAt(p, 0, 0);
    if (f >= 0) out.push({ si: Math.floor(p.y * SUB), sj: Math.floor(p.x * SUB), f, ramp });
  }
  return out;
}

/** True when a prop can be in the rules at all (a model with no footprint, a kit of scenery, cannot). */
function hasRules(p) {
  if (p.shape === "model") return p.rules !== "none";
  if (p.shape === "kit") return p.parts.some((q) => q.solid);
  return true;
}

/* ---------------------------------------------------------------- resolution */

/** Height in q of the ground (and earlier solid props) under a footprint. */
function groundUnder(t, cells, p) {
  let top = -Infinity;
  for (const c of cells) if (t.inBounds(c.si, c.sj) && !t.isVoid(c.si, c.sj)) top = Math.max(top, t.topAt(c.si, c.sj));
  if (Number.isFinite(top)) return top;
  // nothing under it but void: the ground under its centre (0 off the map)
  return t.topAt(Math.floor(p.y * SUB), Math.floor(p.x * SUB));
}

/**
 * Stand every prop on the board, in list order, and stamp the solid ones into
 * a copy of the terrain: the RULES terrain (movement, sight, cover, where a
 * token stands). The ground passed in is never changed.
 *
 *   • A prop's base is its `elev` when set, else the top of whatever is under
 *     its footprint at that point in the list, so a crate placed after a table
 *     stands on the table.
 *   • A solid prop only RAISES the sub-cells it covers, to base + profile × h;
 *     they become floor (a wedge or a flight of stairs becomes a ramp
 *     descending to its front), keep their layer, and void stays void (void is
 *     "not map"). A kit stamps the union of its solid parts; a model with
 *     rules "none" stamps nothing.
 *   • A hidden prop is resolved (the GM still sees it) but never stamped and
 *     never stood on: the rules may not betray what a player cannot see.
 *   • `stamp: false` resolves bases without stamping (the setting is off); the
 *     returned terrain is then the ground itself.
 *
 * @param {import("./model.mjs").Terrain} ground
 * @param {object[]} props  normalised
 * @param {{stamp?: boolean}} [o]
 * @returns {{terrain: import("./model.mjs").Terrain, props: object[]}}
 *   props: each prop plus `baseQ` / `topQ` (q) and `stamped`
 */
export function resolveProps(ground, props, { stamp = true } = {}) {
  const list = Array.isArray(props) ? props : [];
  if (!ground) return { terrain: ground, props: list.map((p) => ({ ...p, baseQ: Math.round((p.elev ?? 0) * Q_PER_CELL), topQ: Math.round(((p.elev ?? 0) + p.h) * Q_PER_CELL), stamped: false })) };
  const anySolid = stamp && list.some((p) => p.solid && !p.hidden && hasRules(p));
  const t = anySolid ? ground.clone() : ground;
  const scratch = anySolid ? t : ground.clone();   // bases stack on solid props even when not stamping
  const out = [];
  for (const p of list) {
    const cells = footprintCells(p);
    const baseQ = p.elev !== null && p.elev !== undefined ? Math.round(p.elev * Q_PER_CELL) : groundUnder(scratch, cells, p);
    const hQ = p.h * Q_PER_CELL;
    const counts = p.solid && !p.hidden && hasRules(p);
    if (counts) {
      for (const c of p.shape === "kit" ? footprintCells(p, { solidOnly: true }) : cells) {
        if (!scratch.inBounds(c.si, c.sj) || scratch.isVoid(c.si, c.sj)) continue;
        const top = Math.round(baseQ + c.f * hQ);
        if (top <= scratch.topAt(c.si, c.sj)) continue;
        const ramp = c.ramp >= 0 && c.f < 1;
        scratch.set(c.si, c.sj, { h: top, kind: ramp ? KIND.RAMP : KIND.FLOOR, dir: ramp ? c.ramp : 0 });
      }
    }
    out.push({ ...p, baseQ, topQ: Math.round(baseQ + hQ), stamped: counts && stamp });
  }
  return { terrain: anySolid ? t : ground, props: out };
}

/**
 * What the renderer draws, for one viewer. A player never receives a hidden
 * prop at all (not as a ghost, not as a flag on a state): the GM sees it as a
 * ghost. `blocks` says whether the prop is in the rules terrain, so the view
 * can draw overlays on its top.
 *
 * PropState: { id, shape, x, y, w, d, h, base, rot, mat, tint, solid, blocks,
 *   ghost, label, img, seed, roof, floats, gm, …the shape's own keys }
 *   (cells; base = the base's height in cells; floats = its base was set, not
 *   found; gm = this viewer is the GM, so a model that fails to load may draw
 *   a placeholder)
 */
export function propStates(resolved, { isGM = false } = {}) {
  const out = [];
  for (const p of resolved ?? []) {
    if (p.hidden && !isGM) continue;
    const s = {
      id: p.id, shape: p.shape, x: p.x, y: p.y, w: p.w, d: p.d, h: p.h,
      base: (p.baseQ ?? Math.round((p.elev ?? 0) * Q_PER_CELL)) / Q_PER_CELL,
      rot: p.rot, mat: p.mat, tint: p.tint, solid: p.solid, blocks: !!p.stamped,
      ghost: !!p.hidden, label: p.label, img: p.img, seed: propSeed(p.id),
      roof: !!p.roof, floats: p.elev !== null && p.elev !== undefined, gm: !!isGM,
    };
    for (const k of ["points", "cliff", "bevel", "profile", "path", "thick", "kit", "parts", "src", "scale", "rules", "bright"]) {
      if (p[k] !== undefined) s[k] = p[k];
    }
    out.push(s);
  }
  return out;
}

/**
 * The rules terrain a renderer can rebuild from states alone (the 3D view's
 * overlays and picks stand on prop tops): stamp the `blocks` states at their
 * resolved base.
 */
export function stampStates(ground, states) {
  const solid = (states ?? []).filter((s) => s.blocks && !s.ghost);
  if (!ground || !solid.length) return ground;
  return resolveProps(ground, solid.map((s) => ({ ...s, elev: s.base, hidden: false, solid: true }))).terrain;
}

/* ---------------------------------------------------------------- editing */

/** Topmost prop under a map point (cells), last placed first. */
export function propAt(props, x, y, { pad = 0 } = {}) {
  for (let i = (props?.length ?? 0) - 1; i >= 0; i--) {
    const p = props[i];
    const [u, v] = localOf(p, x, y);
    const pu = pad / Math.max(p.w, 1e-3), pv = pad / Math.max(p.d, 1e-3);
    if (!(Math.abs(u) <= 0.5 + pu && Math.abs(v) <= 0.5 + pv)) continue;
    // an outline is picked by its outline, a little slack kept for its edge
    if (p.points && !inPolygon(p.points, u * p.w, v * p.d)
      && !footprintOutline(p).some((q, k, a) => segDist(x, y, q, a[(k + 1) % a.length])[0] <= pad)) continue;
    return p;
  }
  return null;
}
