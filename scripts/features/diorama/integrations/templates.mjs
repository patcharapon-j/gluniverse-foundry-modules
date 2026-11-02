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

/**
 * Highlighted cells of every template-like region on the canvas this client
 * may see. `[{i, j, color}]`.
 * @param {{grid:{size:number, cols:number, rows:number}, isGM:boolean}} o
 */
export async function templateCells({ grid, isGM }) {
  const regions = globalThis.canvas?.regions?.placeables ?? [];
  const aoe = aoeOn() ? await aoePresentation() : null;
  const out = [];
  for (const region of regions) {
    const doc = region?.document;
    if (!isTemplateRegion(doc)) continue;
    if (doc.hidden && !isGM) continue;
    if (region.visible === false && !isGM) continue;
    const rect = boundsOf(region);
    if (!rect) continue;
    const bottom = Number(doc.elevation?.bottom);
    const elevation = Number.isFinite(bottom) ? bottom : 0;
    const color = regionColor(region, aoe);
    const inside = (x, y) => {
      try { return !!doc.testPoint({ x, y, elevation }); } catch { return false; }
    };
    for (const c of cellsInRect(rect, grid.size, grid, inside)) out.push({ ...c, color });
  }
  return out;
}
