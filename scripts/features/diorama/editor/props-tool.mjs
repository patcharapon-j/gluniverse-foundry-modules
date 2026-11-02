/**
 * Diorama editor — the props tool: place, pick, move, edit, duplicate and
 * delete props on the session's draft list.
 *
 * Pure, and IMMUTABLE: every function returns a new list (props are plain
 * objects, normalised through terrain/props.mjs), so the session's undo
 * history compares and restores them as JSON without aliasing a live object.
 * Coordinates are map cells (px / grid size), the unit props are stored in.
 */

import { normalizeProp, normalizeProps, mintPropId, propAt, scaleProp, SHAPE_DEFAULTS, PROP_SHAPES, PROP_MATERIALS } from "../terrain/props.mjs";

/** Shapes the palette can place: a kit comes only from a layout (it has no parts until one gives them). */
export const PLACEABLE_SHAPES = Object.freeze(PROP_SHAPES.filter((s) => s !== "kit"));

/** A footprint centre snapped so the footprint's edges sit on grid lines. */
export function snapCentre(c, size) {
  const half = size / 2;
  return Math.round(c - half) + half;
}

/** A new prop of the tool's shape and material, centred at (x, y) cells. */
export function makeProp(props, { shape = "box", mat = null, x, y, snap = true, rot = 0 } = {}) {
  const sh = PLACEABLE_SHAPES.includes(shape) ? shape : "box";
  const def = SHAPE_DEFAULTS[sh];
  const material = PROP_MATERIALS.includes(mat) ? mat : def.mat;
  const turned = Math.round(((Number(rot) || 0) % 180 + 180) % 180) === 90;
  const sx = turned ? def.d : def.w, sy = turned ? def.w : def.d;
  return normalizeProp({
    id: mintPropId(new Set((props ?? []).map((p) => p.id)), `${sh}|${x}|${y}`),
    shape: sh,
    x: snap ? snapCentre(x, sx) : x,
    y: snap ? snapCentre(y, sy) : y,
    w: def.w, d: def.d, h: def.h, rot, mat: material, solid: def.solid,
  });
}

export function addProp(props, prop) {
  return prop ? [...(props ?? []), prop] : [...(props ?? [])];
}

/** Topmost prop at a map point, with a little slack for thin ones. */
export function hitProp(props, x, y, padCells = 0.08) {
  return propAt(props ?? [], x, y, { pad: padCells });
}

/**
 * Patch one prop; the result is normalised (a bad value falls back). A shape
 * whose size is the bounds of what it holds (an outline, a path, a kit's
 * parts) is SCALED to a new w, d or h, since a size written alone would be
 * recomputed from the old outline and lost.
 */
export function updateProp(props, id, patch) {
  return (props ?? []).map((p) => {
    if (p.id !== id) return p;
    let base = p;
    const sized = ["w", "d", "h"].some((k) => k in (patch ?? {}) && Number(patch[k]) > 0);
    if (sized && (p.points || p.path || p.parts)) {
      const sx = Number(patch.w) > 0 ? patch.w / p.w : 1;
      const sy = Number(patch.d) > 0 ? patch.d / p.d : 1;
      const sz = Number(patch.h) > 0 ? patch.h / p.h : 1;
      // a kit scales as a whole across the map: whichever side was typed sets both
      const k = Number(patch.w) > 0 ? sx : sy;
      base = p.parts ? scaleProp(p, k, k, sz) : scaleProp(p, sx, sy, sz);
      patch = { ...patch };
      delete patch.w; delete patch.d; delete patch.h;
    }
    const next = normalizeProp({ ...base, ...patch, id: p.id });
    return next ?? p;
  });
}

/** Move a prop so its centre is at (x, y), snapped to the grid when asked. */
export function moveProp(props, id, x, y, { snap = true } = {}) {
  const p = (props ?? []).find((q) => q.id === id);
  if (!p) return props;
  const turned = Math.round(((p.rot % 180) + 180) % 180) === 90;
  const sx = turned ? p.d : p.w, sy = turned ? p.w : p.d;
  const nx = snap ? snapCentre(x, sx) : x, ny = snap ? snapCentre(y, sy) : y;
  if (nx === p.x && ny === p.y) return props;
  return updateProp(props, id, { x: nx, y: ny });
}

export function removeProp(props, id) {
  return (props ?? []).filter((p) => p.id !== id);
}

/** A copy one cell to the right (east), with a fresh id; null if not found. */
export function duplicateProp(props, id) {
  const p = (props ?? []).find((q) => q.id === id);
  if (!p) return { props, id: null };
  const copy = normalizeProp({ ...p, id: mintPropId(new Set(props.map((q) => q.id)), `dup|${p.id}`), x: p.x + 1 });
  return { props: [...props, copy], id: copy.id };
}

/** Bring a prop to the end of the list: drawn last, stacked on what is before it. */
export function raiseProp(props, id) {
  const p = (props ?? []).find((q) => q.id === id);
  return p ? [...props.filter((q) => q.id !== id), p] : props;
}

/** The list as it will be stored (normalised, unique ids). */
export const cleanProps = (props) => normalizeProps(props);
