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
 *   img    string   card shape only: the image path
 *
 * Units: one cell is one grid square, the same unit the renderer's world space
 * uses, so a prop's numbers read straight across into the 3D view. Heights
 * are cells, not q, so a 1×1×1 box is one cube of grid.
 *
 * Pure: no `game`, `canvas`, `foundry` or DOM. The check tool, the editor and
 * the layout compiler drive it directly.
 */

import { SUB, KIND, DIR_VEC, Q_PER_CELL } from "../constants.mjs";

export const PROP_FORMAT = 1;
/** Most props a Level keeps (a dense forest board is a few hundred). */
export const PROP_LIMIT = 2000;

/** Shape keys, in palette order. Stored data: never rename. */
export const PROP_SHAPES = Object.freeze([
  "box", "cylinder", "cone", "sphere", "dome", "pyramid", "wedge", "torus", "capsule", "arch",
  "pillar", "crate", "barrel", "rock", "tree", "pine", "bush", "card",
]);

/** Material keys, in palette order. Stored data: never rename. */
export const PROP_MATERIALS = Object.freeze([
  "stone", "marble", "wood", "metal", "foliage", "crystal", "plaster", "cloth", "earth", "ice", "map",
]);

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
});

/** Longest card image path kept; a longer one is dropped, not cut. */
export const IMG_MAX = 2048;
export const SIZE_MIN = 0.1;
export const SIZE_MAX = 64;
export const H_MIN = 0.05;
export const ELEV_LIMIT = 256;

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Two decimals: enough for a sixteenth of a cell, and stable through JSON. */
const r2 = (v) => Math.round(v * 100) / 100;

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

/**
 * One prop, sanitised. Total: anything that cannot be a prop comes back null
 * (not an object, an unknown shape, no position). Everything else defaults.
 * The id is kept only when valid; normalizeProps() mints the missing ones.
 * @returns {object|null}
 */
export function normalizeProp(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const shape = String(raw.shape ?? "");
  if (!PROP_SHAPES.includes(shape)) return null;
  const x = Number(raw.x), y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const def = SHAPE_DEFAULTS[shape];
  const size = (v, d) => r2(clamp(num(v, d), SIZE_MIN, SIZE_MAX));
  const rot = ((num(raw.rot, 0) % 360) + 360) % 360;
  const elevRaw = raw.elev;
  const elev = elevRaw === null || elevRaw === undefined || elevRaw === "" || !Number.isFinite(Number(elevRaw))
    ? null : r2(clamp(Number(elevRaw), -ELEV_LIMIT, ELEV_LIMIT));
  const p = {
    id: ID_RE.test(String(raw.id ?? "")) ? String(raw.id) : "",
    shape,
    x: r2(clamp(x, -1e5, 1e5)),
    y: r2(clamp(y, -1e5, 1e5)),
    w: size(raw.w, def.w),
    d: size(raw.d, def.d),
    h: r2(clamp(num(raw.h, def.h), H_MIN, SIZE_MAX)),
    elev,
    rot: r2(rot) % 360,
    mat: PROP_MATERIALS.includes(raw.mat) ? raw.mat : def.mat,
    tint: HEX_RE.test(String(raw.tint ?? "")) ? String(raw.tint).toLowerCase() : null,
    solid: typeof raw.solid === "boolean" ? raw.solid : def.solid,
    hidden: raw.hidden === true,
    label: typeof raw.label === "string" ? raw.label.slice(0, 60) : "",
    // A path, never cut: a truncated path (or data URL) decodes as a blank card.
    img: shape === "card" && typeof raw.img === "string" && raw.img.length <= IMG_MAX ? raw.img : "",
  };
  return p;
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

/** The stored form: exactly the documented keys, in order. */
export function propToJSON(p) {
  const o = { id: p.id, shape: p.shape, x: p.x, y: p.y, w: p.w, d: p.d, h: p.h, elev: p.elev, rot: p.rot,
    mat: p.mat, tint: p.tint, solid: p.solid, hidden: p.hidden, label: p.label };
  if (p.shape === "card") o.img = p.img;
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
 * harder to read (a tree is its trunk and the core of its crown).
 */
export function profileAt(shape, u, v) {
  const r = Math.hypot(u * 2, v * 2);
  switch (shape) {
    case "box": case "crate":
      return 1;
    case "card":
      return 1;
    case "cylinder": case "barrel": case "pillar": case "capsule":
      return r <= 1 ? 1 : -1;
    case "sphere":
      return r <= 1 ? 0.5 + 0.5 * Math.sqrt(Math.max(0, 1 - r * r)) : -1;
    case "dome": case "bush": case "rock":
      return r <= 1 ? Math.sqrt(Math.max(0, 1 - r * r)) : -1;
    case "cone": case "pine":
      return r <= 1 ? Math.max(0, 1 - r) : -1;
    case "tree":
      return r <= 0.5 ? 1 : -1;
    case "pyramid":
      return Math.max(0, 1 - Math.max(Math.abs(u), Math.abs(v)) * 2);
    case "wedge":
      // high along the back edge (v = -0.5), down to the ground at the front
      return clamp(0.5 - v, 0, 1);
    case "torus": {
      if (r < 0.5 || r > 1) return -1;
      const k = (r - 0.75) / 0.25;
      return Math.sqrt(Math.max(0, 1 - k * k));
    }
    case "arch":
      return Math.abs(u) >= 0.3 ? 1 : -1;
    default:
      return 1;
  }
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
 * Every sub-cell a prop stands on, with its profile there.
 * A prop too small to cover any sub-cell centre still claims the one under its
 * own centre, so a thin post is never walked through.
 * @returns {{si:number, sj:number, f:number}[]}
 */
export function footprintCells(p) {
  const corners = footprintCorners(p);
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  const sj0 = Math.floor(Math.min(...xs) * SUB), sj1 = Math.ceil(Math.max(...xs) * SUB);
  const si0 = Math.floor(Math.min(...ys) * SUB), si1 = Math.ceil(Math.max(...ys) * SUB);
  const out = [];
  for (let si = si0; si <= si1; si++) {
    for (let sj = sj0; sj <= sj1; sj++) {
      const [u, v] = localOf(p, (sj + 0.5) / SUB, (si + 0.5) / SUB);
      if (Math.abs(u) > 0.5 || Math.abs(v) > 0.5) continue;
      const f = profileAt(p.shape, u, v);
      if (f >= 0) out.push({ si, sj, f });
    }
  }
  if (!out.length) {
    const f = profileAt(p.shape, 0, 0);
    if (f >= 0) out.push({ si: Math.floor(p.y * SUB), sj: Math.floor(p.x * SUB), f });
  }
  return out;
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
 *     they become floor (a wedge becomes a ramp descending to its front), keep
 *     their layer, and void stays void (void is "not map").
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
  const anySolid = stamp && list.some((p) => p.solid && !p.hidden);
  const t = anySolid ? ground.clone() : ground;
  const scratch = anySolid ? t : ground.clone();   // bases stack on solid props even when not stamping
  const out = [];
  for (const p of list) {
    const cells = footprintCells(p);
    const baseQ = p.elev !== null && p.elev !== undefined ? Math.round(p.elev * Q_PER_CELL) : groundUnder(scratch, cells, p);
    const hQ = p.h * Q_PER_CELL;
    const counts = p.solid && !p.hidden;
    if (counts) {
      const dir = p.shape === "wedge" ? wedgeDir(p.rot) : 0;
      for (const c of cells) {
        if (!scratch.inBounds(c.si, c.sj) || scratch.isVoid(c.si, c.sj)) continue;
        const top = Math.round(baseQ + c.f * hQ);
        if (top <= scratch.topAt(c.si, c.sj)) continue;
        const ramp = p.shape === "wedge" && c.f < 1;
        scratch.set(c.si, c.sj, { h: top, kind: ramp ? KIND.RAMP : KIND.FLOOR, dir: ramp ? dir : 0 });
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
 *   ghost, label, img, seed }   (cells; base = the base's height in cells)
 */
export function propStates(resolved, { isGM = false } = {}) {
  const out = [];
  for (const p of resolved ?? []) {
    if (p.hidden && !isGM) continue;
    out.push({
      id: p.id, shape: p.shape, x: p.x, y: p.y, w: p.w, d: p.d, h: p.h,
      base: (p.baseQ ?? Math.round((p.elev ?? 0) * Q_PER_CELL)) / Q_PER_CELL,
      rot: p.rot, mat: p.mat, tint: p.tint, solid: p.solid, blocks: !!p.stamped,
      ghost: !!p.hidden, label: p.label, img: p.img, seed: propSeed(p.id),
    });
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
    if (Math.abs(u) <= 0.5 + pu && Math.abs(v) <= 0.5 + pv) return p;
  }
  return null;
}
