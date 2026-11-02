/**
 * Diorama view — the rules and Foundry seams the view reads, loaded once when
 * the view opens.
 *
 * They are imported dynamically and feature-tested, so a seam that fails to
 * load costs the view that one readout (a hover with no cover line, a path
 * with no action count) instead of the whole view. Each accessor below has a
 * neutral fallback.
 */

import { warn } from "../../../core/const.mjs";
import { distToQ } from "../terrain/model.mjs";

export const seams = { cover: null, movement: null, creature: null, path: null, systems: null };
let _loading = null;

async function tryImport(spec) {
  try { return await import(spec); } catch (e) { warn(`diorama: ${spec} unavailable`, e); return null; }
}

export function loadSeams() {
  _loading ??= Promise.all([
    tryImport("../foundry/cover.mjs"),
    tryImport("../foundry/movement.mjs"),
    tryImport("../rules/creature.mjs"),
    tryImport("../rules/path.mjs"),
    tryImport("../rules/systems.mjs"),
  ]).then(([cover, movement, creature, path, systems]) => {
    Object.assign(seams, { cover, movement, creature, path, systems });
    return seams;
  });
  return _loading;
}

/** Creature height, distance units. */
export function heightDist(actor, doc) {
  const f = seams.creature?.creatureHeightDist;
  try { return typeof f === "function" ? f(actor, doc) : 6; } catch { return 6; }
}

/** Ground under a footprint (top-left px), absolute distance units; `level` defaults to the viewed one. */
export function groundDist(scene, x, y, w = 1, h = 1, level = null) {
  const f = seams.movement?.groundDistAt;
  try { return typeof f === "function" ? f(scene, x, y, w, h, level) : 0; } catch { return 0; }
}

export function altitude(doc) {
  const f = seams.movement?.altitudeOf;
  try { return typeof f === "function" ? f(doc) : 0; } catch { return 0; }
}

export function speed(actor, systemId, action) {
  const f = seams.movement?.speedOf;
  try { return typeof f === "function" ? f(actor, systemId, action) : null; } catch { return null; }
}

/** {cover, lineOfSight} | null */
export function cover(a, b) {
  const f = seams.cover?.coverBetween;
  try { return typeof f === "function" ? f(a, b) : null; } catch { return null; }
}

export function analyze(terrain, cells, grid) {
  const f = seams.path?.analyzePath;
  try { return typeof f === "function" ? f(terrain, cells, grid) : { steps: [], climbs: [], falls: [] }; }
  catch { return { steps: [], climbs: [], falls: [] }; }
}

export function movementText(o) {
  const f = seams.systems?.movementReadout;
  try { if (typeof f === "function") return f(o); } catch { /* fall through */ }
  return { text: `${Math.round((Number(o.distance) || 0) * 10) / 10} ${o.units ?? ""}`.trim(), tone: "info", actions: null };
}

export function distanceText(o) {
  const f = seams.systems?.distanceReadout;
  try { if (typeof f === "function") return f(o); } catch { /* fall through */ }
  return { text: `${Math.round((Number(o.distance) || 0) * 10) / 10} ${o.units ?? ""}`.trim(), band: null };
}

export function fallText(o) {
  const f = seams.systems?.fallHint;
  try { return typeof f === "function" ? f(o) : null; } catch { return null; }
}

/** Height of a token's standee, in q. */
export function heightQ(token, distance) {
  return distToQ(heightDist(token?.actor ?? null, token?.document ?? null), distance);
}
