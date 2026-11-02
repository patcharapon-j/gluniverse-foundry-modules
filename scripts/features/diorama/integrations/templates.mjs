/**
 * Diorama — measured templates as highlighted cells.
 *
 * In v14 a measured template IS a Region (`flags.core.MeasuredTemplate`), and
 * PF2e's areas are Regions with `flags.pf2e.areaShape`. A cell is highlighted
 * when its centre lies inside the region (`RegionDocument#testPoint`), the
 * same centre rule PF2e and Foundry's own grid highlight use.
 *
 * Colour: the pf2e-aoe feature's material colour when that feature is on and
 * its presentation resolves, else the region's own colour, else the accent.
 */

import { SUITE_ID } from "../../../core/const.mjs";
import { Suite } from "../../../core/registry.mjs";
import { PALETTE } from "../../../core/theme.mjs";

/** Never highlight more than this many cells for one region. */
export const MAX_CELLS_PER_REGION = 4096;

/** Is this region a template-like area? */
export function isTemplateRegion(doc) {
  if (!doc) return false;
  if (doc.flags?.core?.MeasuredTemplate) return true;
  if (doc.flags?.pf2e?.areaShape) return true;
  try { return !!doc.getFlag?.(SUITE_ID, "aoe.presentation"); } catch { return false; }
}

/**
 * Cells (grid offsets) of a px rectangle whose centres pass `inside`.
 * Pure: the check tool drives it with a circle.
 * @param {{x:number, y:number, width:number, height:number}} rect
 * @param {number} size  grid size px
 * @param {{cols:number, rows:number}} grid
 * @param {(x:number, y:number) => boolean} inside
 */
export function cellsInRect(rect, size, grid, inside, max = MAX_CELLS_PER_REGION) {
  const out = [];
  if (!rect || !(size > 0)) return out;
  const j0 = Math.max(0, Math.floor(rect.x / size)), j1 = Math.min(grid.cols - 1, Math.floor((rect.x + rect.width) / size));
  const i0 = Math.max(0, Math.floor(rect.y / size)), i1 = Math.min(grid.rows - 1, Math.floor((rect.y + rect.height) / size));
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      if (!inside((j + 0.5) * size, (i + 0.5) * size)) continue;
      out.push({ i, j });
      if (out.length >= max) return out;
    }
  }
  return out;
}

let _aoe = null;
let _aoeTried = false;
async function aoePresentation() {
  if (_aoeTried) return _aoe;
  _aoeTried = true;
  try { _aoe = await import("../../pf2e-aoe/presentation.mjs"); } catch { _aoe = null; }
  return _aoe;
}

function aoeOn() {
  try { return Suite.enabled("pf2e-aoe") === true; } catch { return false; }
}

function regionColor(region, aoe) {
  if (aoe) {
    try {
      const c = aoe.presentationStyle(region)?.color;
      if (typeof c === "string" && c) return c;
    } catch { /* fall through */ }
  }
  const own = region?.document?.color;
  const css = own?.css ?? (typeof own === "string" ? own : null);
  return css || PALETTE.accent || PALETTE.cyan;
}

function boundsOf(region) {
  const b = region?.bounds ?? region?.document?.bounds;
  if (b && Number.isFinite(b.width) && b.width > 0) return { x: b.x, y: b.y, width: b.width, height: b.height };
  return null;
}

/** CONST.REGION_VISIBILITY.ALWAYS: shown to everyone, not only on the Regions layer or to the GM. */
const VISIBLE_ALWAYS = 2;

/**
 * May this viewer see a region's area at all? Pure on what it is handed.
 * A player (or the GM viewing as the players) sees an area only when Foundry
 * shows it to players, it is not hidden, and the creature it is attached to
 * (an emanation's source) is on this viewer's board: an aura must not give
 * away a creature the party cannot see.
 * @param {RegionDocument} doc
 * @param {Region|null} region   the placeable (its `visible` is Foundry's answer for this client)
 * @param {{isGM:boolean, asPlayers?:boolean, tokenSeen?:(id:string)=>boolean}} o
 */
export function mayShowArea(doc, region, { isGM, asPlayers = false, tokenSeen = null } = {}) {
  if (!doc) return false;
  if (isGM && !asPlayers) return true;
  if (doc.hidden) return false;
  if (region && region.visible === false) return false;
  if (asPlayers) {
    const v = Number(doc.visibility);
    if (Number.isFinite(v) && v !== VISIBLE_ALWAYS) return false;
  }
  const t = doc.attachment?.token ?? null;
  const id = typeof t === "string" ? t : t?.id ?? null;
  if (id && typeof tokenSeen === "function" && !tokenSeen(id)) return false;
  if (id && t && typeof t === "object" && t.hidden) return false;
  return true;
}

const SHAPE_KINDS = Object.freeze({ 0: "burst", 1: "cone", 2: "emanation", 3: "line" });
const rad = (deg) => (Number(deg) || 0) * Math.PI / 180;

/**
 * The volume parameters of an area (render/areas.mjs), pure.
 * From pf2e-aoe's `regionGeometry` when it ran (`geometry`), else from the
 * region's first shape. Lengths in cells; angles in radians.
 * @param {{geometry?:object|null, shape?:object|null, areaShape?:string|null, size:number, apex?:{x:number,y:number}|null}} o
 */
export function areaParams({ geometry = null, shape = null, areaShape = null, size = 100, apex = null }) {
  const S = size || 100;
  if (geometry && Number.isFinite(Number(geometry.shapeId))) {
    const kind = SHAPE_KINDS[geometry.shapeId] ?? "flat";
    const out = {
      kind, origin: { ...geometry.origin }, radius: Number(geometry.radius) || 0,
      direction: Number(geometry.direction) || 0, angle: Number(geometry.angle) || Math.PI / 2,
      base: Array.isArray(geometry.base) ? [...geometry.base] : [0, 0], width: Number(geometry.base?.[0]) || 1,
    };
    // the cone's apex as PF2e resolves it (a placed point inside a square moves half a square)
    if (kind === "cone" && apex) out.origin = { x: apex.x, y: apex.y };
    if (kind === "emanation" && !(out.radius > 0)) out.kind = "flat";
    return out;
  }
  const type = areaShape ?? shape?.type ?? null;
  const origin = { x: Number(shape?.x) || 0, y: Number(shape?.y) || 0 };
  if (type === "circle" || type === "burst") return { kind: "burst", origin, radius: (Number(shape?.radius) || 0) / S };
  if (type === "cone") {
    return { kind: "cone", origin: apex ?? origin, radius: (Number(shape?.radius) || 0) / S, direction: rad(shape?.rotation ?? shape?.direction), angle: rad(shape?.angle ?? 90) };
  }
  if (type === "line") return { kind: "line", origin, width: (Number(shape?.width) || S) / S };
  if (type === "emanation") {
    const b = shape?.base ?? {};
    const tok = b.type === "token";
    const w = (Number(b.width) || 1) * (tok ? 1 : 1 / S), h = (Number(b.height) || 1) * (tok ? 1 : 1 / S);
    return { kind: "emanation", origin: { x: (Number(b.x) || 0) + (w * S) / 2, y: (Number(b.y) || 0) + (h * S) / 2 },
      radius: (Number(shape?.radius) || 0) / S, base: [w / 2, h / 2] };
  }
  return { kind: "flat", origin: null };
}

let _data = null;
let _dataTried = false;
async function aoeData() {
  if (_dataTried) return _data;
  _dataTried = true;
  try { _data = await import("../../pf2e-aoe/data.mjs"); } catch { _data = null; }
  return _data;
}

/** The rules squares PF2e covers (walls excluded), as {i, j}; null when PF2e does not resolve this one. */
function rulesCells(data, region, size) {
  let cov = null;
  try { cov = data?.pf2eCoverage?.(region) ?? null; } catch { cov = null; }
  if (!cov || !Array.isArray(cov.covered)) return null;
  const out = [];
  for (const o of cov.covered) {
    let p = null;
    try { p = globalThis.canvas.grid.getTopLeftPoint(o); } catch { p = null; }
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    out.push({ i: Math.round(p.y / size), j: Math.round(p.x / size) });
  }
  return { cells: out, apex: cov.origin ?? null };
}

/**
 * Every template-like area on the canvas this viewer may see: the squares it
 * covers (PF2e's own rules squares where PF2e resolves them, else the squares
 * whose centres the region contains), and its volume.
 * @param {{grid:{size:number, cols:number, rows:number}, isGM:boolean, asPlayers?:boolean, tokenSeen?:(id:string)=>boolean}} o
 * @returns {Promise<{cells:Array<{i:number,j:number,color:string}>, areas:object[]}>}
 */
export async function templateAreas({ grid, isGM, asPlayers = false, tokenSeen = null }) {
  const regions = globalThis.canvas?.regions?.placeables ?? [];
  const aoe = aoeOn() ? await aoePresentation() : null;
  const data = await aoeData();
  const cells = [], areas = [];
  for (const region of regions) {
    const doc = region?.document;
    if (!isTemplateRegion(doc)) continue;
    if (!mayShowArea(doc, region, { isGM, asPlayers, tokenSeen })) continue;
    const rect = boundsOf(region);
    if (!rect) continue;
    const bottom = Number(doc.elevation?.bottom);
    const elevation = Number.isFinite(bottom) ? bottom : 0;
    const color = regionColor(region, aoe);
    let hot = null;
    try { const h = aoe?.presentationStyle(region)?.look?.hot; if (typeof h === "string" && h) hot = h; } catch { hot = null; }
    const rules = rulesCells(data, region, grid.size);
    let own;
    if (rules) own = rules.cells.filter((c) => c.i >= 0 && c.j >= 0 && c.i < grid.rows && c.j < grid.cols).slice(0, MAX_CELLS_PER_REGION);
    else {
      const inside = (x, y) => {
        try { return !!doc.testPoint({ x, y, elevation }); } catch { return false; }
      };
      own = cellsInRect(rect, grid.size, grid, inside);
    }
    for (const c of own) cells.push({ ...c, color });
    if (!own.length) continue;
    let geometry = null;
    try { geometry = data?.regionGeometry?.(region) ?? null; } catch { geometry = null; }
    const shape = doc.shapes?.contents?.[0] ?? doc.shapes?.[0] ?? null;
    const p = areaParams({ geometry, shape, areaShape: doc.flags?.pf2e?.areaShape ?? null, size: grid.size, apex: rules?.apex ?? null });
    const floor = Number.isFinite(bottom) ? bottom : null;
    areas.push({ id: doc.id, ...p, cells: own, color, hot, refQ: floor !== null && grid.distance > 0 ? (floor / grid.distance) * 4 : null });
  }
  return { cells, areas };
}

/**
 * Highlighted cells of every template-like region on the canvas this client
 * may see. `[{i, j, color}]`.
 * @param {{grid:{size:number, cols:number, rows:number}, isGM:boolean}} o
 */
export async function templateCells(o) {
  return (await templateAreas(o)).cells;
}
