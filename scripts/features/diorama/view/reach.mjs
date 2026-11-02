/**
 * Diorama view — a token's reach this turn, read off the world.
 *
 *   reachOf({ tok, scene, grid, terrain }) → Reach | null
 *     Reach = { budgets, cells:[{i,j,band,cost}], start:{i,j}, pathTo(i,j), at(i,j), occupied(i,j), action }
 *
 * The solver is rules/reach.mjs (pure); this file only builds its closures:
 *   walls       canvas.edges that block movement (an open door has no edge;
 *               a one-way wall is skipped from the side Foundry skips it)
 *   difficulty  every visible Region's "modify movement cost" behaviours, at
 *               the square's centre and the token's elevation (null = impassable)
 *   cliffs      the Diorama terrain: a ground-bound creature cannot step up a
 *               rise above the step height without stairs (foundry/movement.mjs)
 *   creatures   every other token THIS viewer can see (`token.isVisible`; a hidden
 *               one must not show by the hole it would leave): an ally's squares
 *               are crossed but never ended on, an enemy's are not entered
 *               (rules/reach.mjs occupancy). Display only: the drop still decides.
 *
 * It is a picture of Foundry's rules, not a second set of them: the move itself
 * still goes through TokenDocument#move, which decides.
 */

import { DIAGONALS, occupancy, reachBand, reachBudgets, solveReach, wallIndex } from "../rules/reach.mjs";
import { DAGGERHEART, PF2E } from "../rules/systems.mjs";
import { altitude, heightDist, seams, speed as speedOf } from "./seams.mjs";

const MOVEMENT_COST = "modifyMovementCost";

const isDead = (token) => {
  try { return !!(token.actor?.statuses?.has?.("dead") || token.document?.hasStatusEffect?.("dead")); } catch { return false; }
};
const isTiny = (actor, systemId) => systemId === PF2E && String(actor?.size ?? actor?.system?.traits?.size?.value ?? "") === "tiny";

/**
 * The other creatures on the board as the solver's occupants: only tokens this
 * viewer sees (`token.isVisible`, and `seen(id)` for a GM viewing as the players),
 * never the mover, never the dead (a body is no creature's space).
 * @returns {object[]}
 */
export function occupantsOf(tok, size, systemId, seen = null) {
  const out = [];
  const self = tok?.document?.id;
  for (const t of globalThis.canvas?.tokens?.placeables ?? []) {
    const d = t?.document;
    if (!d || d.id === self || d.parent !== tok.document.parent) continue;
    if (!t.isVisible || (seen && !seen(d.id)) || isDead(t)) continue;
    const s = d._source ?? d;
    let height = 0;
    try { height = Number(heightDist(t.actor ?? null, d)) || 0; } catch { height = 0; }
    out.push({
      i: Math.round(Number(s.y) / size), j: Math.round(Number(s.x) / size),
      w: Math.max(1, Math.round(Number(s.width) || 1)), h: Math.max(1, Math.round(Number(s.height) || 1)),
      disposition: d.disposition, tiny: isTiny(t.actor, systemId), alt: altitude(d), height,
    });
  }
  return out;
}

function blockingWalls() {
  const out = [];
  const NONE = globalThis.CONST?.EDGE_SENSE_TYPES?.NONE ?? 0;
  const edges = globalThis.canvas?.edges;
  const list = edges?.values ? [...edges.values()] : null;
  if (list) {
    for (const e of list) {
      if (!e?.a || !e?.b || (e.move ?? NONE) === NONE) continue;
      if (e.type === "outerBounds") continue;
      const dir = e.direction ?? 0;
      out.push({
        ax: e.a.x, ay: e.a.y, bx: e.b.x, by: e.b.y,
        ignoresFrom: dir && typeof e.orientPoint === "function" ? (x, y) => e.orientPoint({ x, y }) === dir : null,
      });
    }
    return out;
  }
  // No edges collection: the walls, with doors that stand open left out.
  const OPEN = globalThis.CONST?.WALL_DOOR_STATES?.OPEN ?? 1;
  for (const w of globalThis.canvas?.walls?.placeables ?? []) {
    const d = w.document;
    if (!d || !d.move || (d.door && d.ds === OPEN)) continue;
    const [ax, ay, bx, by] = d.c;
    out.push({ ax, ay, bx, by, ignoresFrom: null });
  }
  return out;
}

/** Multiplier for entering a square: the product of every movement-cost region over its centre. */
function difficultyFn(scene, action, elevation, size, wCells, hCells) {
  const regions = [];
  for (const region of scene?.regions ?? []) {
    if (region.hidden) continue;
    const mods = [];
    for (const b of region.behaviors ?? []) {
      if (b.disabled || b.type !== MOVEMENT_COST) continue;
      const d = b.system?.difficulties ?? {};
      const v = action in d ? d[action] : d.walk;
      if (v === undefined) continue;
      mods.push(v === null ? Infinity : Number(v));
    }
    if (mods.length) regions.push({ region, k: mods.reduce((a, b) => a * b, 1) });
  }
  if (!regions.length) return () => 1;
  return (i, j) => {
    let k = 1;
    // A big creature pays for the worst square it would stand in.
    for (let di = 0; di < hCells; di++) for (let dj = 0; dj < wCells; dj++) {
      const p = { x: (j + dj + 0.5) * size, y: (i + di + 0.5) * size, elevation };
      let cell = 1;
      for (const r of regions) {
        let inside = false;
        try { inside = r.region.testPoint(p); } catch { inside = false; }
        if (inside) cell *= r.k;
      }
      if (cell > k) k = cell;
    }
    return k;
  };
}

/**
 * @param {object} o
 * @param {Token} o.tok
 * @param {Scene} o.scene
 * @param {{size:number, distance:number, rows?:number, cols?:number}} o.grid
 * @param {object|null} o.terrain   the rules terrain (cliffs), or null
 * @param {string} [o.action]
 * @param {((id:string) => boolean)|null} [o.seen]  a GM viewing as the players: the tokens on that board
 */
export function reachOf({ tok, scene, grid, terrain, action, seen = null }) {
  const doc = tok?.document;
  if (!doc || !grid?.size) return null;
  const systemId = globalThis.game?.system?.id ?? "";
  const act = action ?? doc.movementAction ?? "walk";
  if (act === "displace" || act === "blink") return null;
  const spd = speedOf(tok.actor, systemId, act === "walk" ? "walk" : act);
  const budgets = reachBudgets({ systemId, speed: spd, gridDistance: grid.distance, daggerheart: DAGGERHEART });
  if (!budgets.length) return null;
  const size = grid.size;
  const src = doc._source ?? doc;
  const start = { i: Math.round(src.y / size), j: Math.round(src.x / size) };
  const w = Math.max(1, Math.round(Number(src.width) || 1)), h = Math.max(1, Math.round(Number(src.height) || 1));
  const walls = wallIndex(blockingWalls(), size);
  const groundBound = seams.movement?.groundBound ?? ((a) => a === "walk" || a === "crawl");
  const cliffs = terrain && groundBound(act) && typeof terrain.step === "function";
  const centre = (i, j) => ({ x: (j + w / 2) * size, y: (i + h / 2) * size });
  const blocked = (fi, fj, ti, tj) => {
    const a = centre(fi, fj), b = centre(ti, tj);
    if (walls.crosses(a.x, a.y, b.x, b.y)) return true;
    if (cliffs) {
      for (let di = 0; di < h; di++) for (let dj = 0; dj < w; dj++) {
        try { if (terrain.step(fi + di, fj + dj, ti + di, tj + dj).climb) return true; } catch { /* off the map */ }
      }
    }
    return false;
  };
  const diagonals = globalThis.canvas?.grid?.diagonals ?? DIAGONALS.ALTERNATING_1;
  const rows = Number(grid.rows) || Math.ceil((globalThis.canvas?.dimensions?.height ?? Infinity) / size);
  const cols = Number(grid.cols) || Math.ceil((globalThis.canvas?.dimensions?.width ?? Infinity) / size);
  const bounds = Number.isFinite(rows) && Number.isFinite(cols) ? { rows: rows - h + 1, cols: cols - w + 1 } : null;
  let height = 0;
  try { height = Number(heightDist(tok.actor ?? null, doc)) || 0; } catch { height = 0; }
  const occupied = occupancy({
    mover: { w, h, disposition: doc.disposition, tiny: isTiny(tok.actor, systemId), alt: altitude(doc), height },
    others: occupantsOf(tok, size, systemId, seen),
  });
  const solved = solveReach({
    start, budget: budgets.at(-1), gridDistance: grid.distance, diagonals, bounds,
    enter: difficultyFn(scene, act, Number(src.elevation) || 0, size, w, h), blocked, occupied,
  });
  const cells = [];
  for (const c of solved.cells) {
    if (c.i === start.i && c.j === start.j) continue;
    const band = reachBand(budgets, c.cost);
    if (band) cells.push({ i: c.i, j: c.j, band, cost: c.cost });
  }
  return { budgets, cells, start, w, h, action: act, at: solved.at, pathTo: solved.pathTo, occupied: solved.occupied, tokenId: doc.id };
}
