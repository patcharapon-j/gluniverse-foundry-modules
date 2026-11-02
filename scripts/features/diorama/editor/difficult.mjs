/**
 * Diorama editor — difficult terrain as native v14 Regions.
 *
 * Difficult terrain is not ours: the editor writes ordinary Region documents
 * carrying Foundry's own `modifyMovementCost` behaviour, so Foundry's ruler,
 * its pathfinding, PF2e and the 3D view all read one answer.
 *
 * Behaviour (client/data/region-behaviors/increase-movement-cost.mjs): the
 * system data is `{ difficulties: { [action]: number } }`, one NumberField per
 * movement action that has neither `terrainAction` nor
 * `deriveTerrainDifficulty` (core: walk, fly, swim, burrow), 0..5 in steps of
 * 0.25, initial 1. Crawl and climb take walk's value (`terrainAction: "walk"`),
 * jump derives max(walk, fly). We write `walk` only: difficult ground slows
 * walking (and so crawling, climbing, jumping), not flying or swimming.
 *
 * Overlapping cost modifications stack MULTIPLICATIVELY, so a cell must only
 * ever belong to one Diorama region: painting ×3 over ×2 moves the cells out of
 * the ×2 region rather than stacking a ×6. Regions we did not create are never
 * touched.
 *
 * Written on SAVE, with the terrain flag, never per stroke: Discard has to
 * discard it, and players only ever see saved work. Strokes are pending in the
 * editor session until then, and undoable there.
 *
 * The planner and the rectangle merge are pure; `writeDifficult` is the only
 * part that touches documents.
 */

import { SUITE_ID } from "../../../core/const.mjs";

/** Flag path on a Region we created: `{ cells: ["i.j", ...], difficulty }`. */
export const FLAG_DIFFICULT = "dio.difficult";
/** Region behaviour type id (CONFIG.RegionBehavior.dataModels key). */
export const BEHAVIOR_TYPE = "modifyMovementCost";
/** Difficulties the editor offers. 0 in a stroke means "erase". */
export const DIFFICULTIES = Object.freeze([2, 3]);

export const cellKey = (i, j) => `${i}.${j}`;
export const parseKey = (k) => k.split(".").map(Number);

/**
 * Merge grid cells into few axis-aligned rectangles: row runs first, then runs
 * with the same column span in consecutive rows stack into one rectangle.
 * @param {Iterable<string>|Array<[number,number]>} cells
 * @returns {Array<{i:number, j:number, w:number, h:number}>} in cells
 */
export function cellsToRects(cells) {
  const set = new Set();
  for (const c of cells) set.add(Array.isArray(c) ? cellKey(c[0], c[1]) : c);
  const byRow = new Map();
  for (const k of set) {
    const [i, j] = parseKey(k);
    if (!byRow.has(i)) byRow.set(i, []);
    byRow.get(i).push(j);
  }
  const rows = [...byRow.keys()].sort((a, b) => a - b);
  const open = new Map();       // "j0:j1" → rect being grown downwards
  const out = [];
  let prevRow = null;
  for (const i of rows) {
    const js = byRow.get(i).sort((a, b) => a - b);
    const runs = [];
    let s = js[0], e = js[0];
    for (let n = 1; n < js.length; n++) {
      if (js[n] === e + 1) { e = js[n]; continue; }
      runs.push([s, e]); s = e = js[n];
    }
    runs.push([s, e]);
    const next = new Map();
    for (const [a, b] of runs) {
      const key = `${a}:${b}`;
      const r = prevRow === i - 1 ? open.get(key) : null;
      if (r) { r.h++; next.set(key, r); open.delete(key); }
      else { const nr = { i, j: a, w: b - a + 1, h: 1 }; out.push(nr); next.set(key, nr); }
    }
    open.clear();
    for (const [k, v] of next) open.set(k, v);
    prevRow = i;
  }
  return out;
}

/**
 * Plan the Region writes for a save.
 * @param {Array<{id:string, cells:string[], difficulty:number}>} existing  our regions on the scene
 * @param {Array<{cells:string[], difficulty:number}>} strokes  pending, in paint order (difficulty 0 = erase)
 * @returns {{ final: Map<string, number>, update: Array<{id, cells:string[], difficulty}>,
 *   remove: string[], create: Array<{cells:string[], difficulty}> }}
 */
export function planDifficult(existing = [], strokes = []) {
  const owner = new Map();          // cell → { group, difficulty }
  const groups = [];
  for (const r of existing) {
    const g = { id: r.id, difficulty: r.difficulty, cells: new Set(), original: new Set(r.cells) };
    groups.push(g);
    for (const k of r.cells) {
      const prev = owner.get(k);
      if (prev) prev.group.cells.delete(k);   // a cell in two of ours: the later one wins
      g.cells.add(k);
      owner.set(k, { group: g, difficulty: g.difficulty });
    }
  }
  for (const s of strokes) {
    const d = Number(s.difficulty) || 0;
    const g = d > 0 ? { id: null, difficulty: d, cells: new Set(), original: new Set() } : null;
    if (g) groups.push(g);
    for (const k of s.cells ?? []) {
      const prev = owner.get(k);
      if (prev && g && prev.difficulty === d) continue;     // already that difficulty: leave it where it is
      if (prev) { prev.group.cells.delete(k); owner.delete(k); }
      if (g) { g.cells.add(k); owner.set(k, { group: g, difficulty: d }); }
    }
  }
  const final = new Map();
  for (const [k, o] of owner) final.set(k, o.difficulty);
  const update = [], remove = [], create = [];
  for (const g of groups) {
    const cells = [...g.cells].sort();
    if (g.id) {
      if (!cells.length) remove.push(g.id);
      else if (cells.length !== g.original.size || cells.some((k) => !g.original.has(k))) update.push({ id: g.id, cells, difficulty: g.difficulty });
    } else if (cells.length) {
      create.push({ cells, difficulty: g.difficulty });
    }
  }
  return { final, update, remove, create };
}

/** Region shapes for a set of cells, px. */
export function shapesFor(cells, gridSize) {
  return cellsToRects(cells).map((r) => ({
    type: "rectangle", hole: false, gridBased: false,
    x: r.j * gridSize, y: r.i * gridSize, width: r.w * gridSize, height: r.h * gridSize,
    anchorX: 0, anchorY: 0, rotation: 0,
  }));
}

/**
 * Our difficult-terrain regions on a scene, in planner form. With a Level,
 * only the regions included in it (v14 CanvasDocument#includedInLevel: a
 * region with no Levels is in every one), so editing one floor never touches
 * another floor's regions.
 */
export function readDifficult(scene, levelId = null) {
  const out = [];
  for (const r of scene?.regions ?? []) {
    const f = r.getFlag?.(SUITE_ID, FLAG_DIFFICULT);
    if (!f || !Array.isArray(f.cells)) continue;
    if (levelId && typeof r.includedInLevel === "function" && !r.includedInLevel(levelId)) continue;
    out.push({ id: r.id, cells: f.cells.filter((k) => typeof k === "string"), difficulty: Number(f.difficulty) || 2 });
  }
  return out;
}

/**
 * Write a plan to the scene (GM only): one Region per pending stroke, shapes
 * rebuilt on regions that lost cells, emptied regions deleted.
 * @param {Scene} scene
 * @param {ReturnType<typeof planDifficult>} plan
 * @param {{name:(d:number)=>string, color:string, levelId?:string|null}} o
 */
export async function writeDifficult(scene, plan, { name, color, levelId = null }) {
  const size = scene.dimensions?.size ?? scene.grid?.size ?? 100;
  const levels = levelId && (scene.levels?.size ?? 0) > 1 ? [levelId] : [];
  const flagOf = (p) => ({ [SUITE_ID]: { dio: { difficult: { cells: p.cells, difficulty: p.difficulty } } } });
  if (plan.remove.length) await scene.deleteEmbeddedDocuments("Region", plan.remove);
  if (plan.update.length) {
    await scene.updateEmbeddedDocuments("Region", plan.update.map((p) => ({
      _id: p.id,
      shapes: shapesFor(p.cells, size),
      [`flags.${SUITE_ID}.${FLAG_DIFFICULT}`]: { cells: p.cells, difficulty: p.difficulty },
    })));
  }
  if (plan.create.length) {
    await scene.createEmbeddedDocuments("Region", plan.create.map((p) => ({
      name: name(p.difficulty),
      color,
      shapes: shapesFor(p.cells, size),
      elevation: { bottom: null, top: null },
      levels,
      behaviors: [{ type: BEHAVIOR_TYPE, name: name(p.difficulty), system: { difficulties: { walk: p.difficulty } } }],
      flags: flagOf(p),
    })));
  }
}
