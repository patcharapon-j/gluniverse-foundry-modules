/**
 * Diorama — bringing a layout (terrain/layout.mjs) into a scene: the grid it is
 * compiled against, the write, and the token placements it carries.
 *
 * The compile is pure; this is the half that reads the scene and writes it. A
 * layout's coordinates are map cells, so the scene rect's offset on the padded
 * canvas is added here and nowhere else.
 */

import { SUITE_ID } from "../../../core/const.mjs";
import { FLAG_ALTITUDE } from "../constants.mjs";
import { compileLayout } from "../terrain/layout.mjs";
import { qToDist } from "../terrain/model.mjs";
import { TerrainStore, gridOf, supportsScene } from "../terrain/store.mjs";
import { PropStore } from "../terrain/props-store.mjs";
import { resolveProps } from "../terrain/props.mjs";
import { propsBlock } from "../terrain/live.mjs";

/**
 * The grid a layout compiles against on this scene.
 * @param {Scene} scene
 * @param {import("../terrain/model.mjs").Terrain} [keep]  wall materials and rules to carry over
 */
export function layoutGrid(scene, keep = null) {
  const g = gridOf(scene);
  const r = g.sceneRect;
  return {
    cols: g.cols, rows: g.rows,
    offset: { i: Math.round(r.y / g.size), j: Math.round(r.x / g.size) },
    map: { cols: Math.round(r.width / g.size), rows: Math.round(r.height / g.size) },
    distance: g.distance,
    wallHeight: keep?.wallHeight, stepHeight: keep?.stepHeight, walls: keep?.walls,
  };
}

/** A layout from text or an object. Throws a SyntaxError on bad JSON. */
export function parseLayout(input) {
  return typeof input === "string" ? JSON.parse(input) : input;
}

/** Compile a layout for a scene, keeping the scene's wall materials and rules. */
export function compileForScene(scene, layout, keep = TerrainStore.read(scene)) {
  return compileLayout(layout, layoutGrid(scene, keep));
}

/**
 * Move tokens to a layout's placements. Teleports (`displace`), so a placement
 * on a ledge is not refused as a climb, and stands each token on the ground
 * under its footprint unless the layout gave an elevation.
 * @returns {Promise<{moved:number, missing:string[]}>}
 */
export async function placeTokens(scene, terrain, placements) {
  const g = gridOf(scene);
  const used = new Set();
  const missing = [];
  let moved = 0;
  for (const p of placements ?? []) {
    const doc = p.id ? scene.tokens.get(p.id)
      : scene.tokens.find((t) => t.name === p.name && !used.has(t.id));
    if (!doc) { missing.push(p.name ?? p.id); continue; }
    used.add(doc.id);
    const ground = qToDist(terrain.footprintTop(p.i, p.j, doc.width, doc.height), g.distance);
    const elevation = p.elevation ?? ground + (p.altitude || 0);
    const altitude = Number(doc.getFlag(SUITE_ID, FLAG_ALTITUDE)) || 0;
    if ((p.altitude || 0) !== altitude) await doc.update({ [`flags.${SUITE_ID}.${FLAG_ALTITUDE}`]: p.altitude || 0 });
    await doc.move({ x: p.j * g.size, y: p.i * g.size, elevation, action: "displace" }, { animate: false });
    moved++;
  }
  return { moved, missing };
}

/**
 * Compile a layout and write it to a scene, then place its tokens (GM only).
 * @param {object|string} layout
 * @param {{scene?: Scene, tokens?: boolean}} [o]
 * @returns {Promise<{ok:boolean, errors:string[], warnings:string[], moved?:number, missing?:string[]}>}
 */
export async function importLayout(layout, { scene = globalThis.canvas?.scene, tokens = true } = {}) {
  if (!game.user?.isGM) return { ok: false, errors: ["Only a GM can import a layout."], warnings: [] };
  if (!scene || !supportsScene(scene)) return { ok: false, errors: ["Diorama works on square grids only."], warnings: [] };
  let data;
  try { data = parseLayout(layout); } catch (e) { return { ok: false, errors: [`Not valid JSON: ${e.message}`], warnings: [] }; }
  const res = compileForScene(scene, data);
  if (!res.terrain) return { ok: false, errors: res.errors, warnings: res.warnings };
  await TerrainStore.write(scene, res.terrain);
  // A layout with no "props" key leaves the scene's props alone.
  if (Array.isArray(res.props)) await PropStore.write(scene, res.props);
  const props = Array.isArray(res.props) ? res.props : PropStore.read(scene);
  const rules = resolveProps(res.terrain, props, { stamp: propsBlock() }).terrain;
  const placed = tokens ? await placeTokens(scene, rules, res.tokens) : { moved: 0, missing: [] };
  return { ok: true, errors: [], warnings: res.warnings, props: Array.isArray(res.props) ? res.props.length : null, ...placed };
}
