/**
 * Diorama — terrain cover between two tokens, for display only.
 *
 * Five rays from the attacker's eye to the target (feet, middle, head, both
 * flanks), from terrain/occlusion.mjs. Shown on hover and targeting; never
 * applied, because PF2e's cover is a per-target effect for every attacker and
 * this answer is for one attacker only.
 */

import { coverBetween as terrainCover } from "../terrain/occlusion.mjs";
import { distToQ } from "../terrain/model.mjs";
import { creatureHeightDist, eyeQ } from "../rules/creature.mjs";
import { lineOfSight } from "../rules/los.mjs";
import { pf2eDistance, PF2E_SPACE_FT } from "../rules/distance3d.mjs";
import { activeContext, anyContext } from "./context.mjs";
import { tokenLevelId } from "../terrain/levels.mjs";

const docOf = (t) => t?.document ?? t ?? null;

function centerOf(doc, size) {
  if (typeof doc.getCenterPoint === "function") {
    const c = doc.getCenterPoint();
    if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) return c;
  }
  return { x: (doc.x ?? 0) + ((doc.width ?? 1) * size) / 2, y: (doc.y ?? 0) + ((doc.height ?? 1) * size) / 2 };
}

/**
 * @param {Token|TokenDocument} attackerToken
 * @param {Token|TokenDocument} targetToken
 * @returns {{cover:"none"|"standard"|"greater", lineOfSight:boolean, blocked:number, total:number}|null}
 *   null when the scene has no live height terrain (or the rules are off)
 */
/**
 * The Level two tokens share, or undefined when they stand on different
 * Levels (the ground of one floor says nothing about a line to another).
 * A token with no Level (a fixture, a v13 scene) shares the other's.
 */
export function sharedLevel(a, b) {
  const la = tokenLevelId(a), lb = tokenLevelId(b);
  if (la && lb && la !== lb) return undefined;
  return la ?? lb ?? null;
}

export function coverBetween(attackerToken, targetToken) {
  const a = docOf(attackerToken), b = docOf(targetToken);
  if (!a || !b) return null;
  const scene = a.parent ?? b.parent;
  if (a.parent && b.parent && a.parent !== b.parent) return null;
  const level = sharedLevel(a, b);
  if (level === undefined) return null;
  const live = activeContext(scene, level);
  if (!live) return null;
  const { terrain, grid } = live;
  const baseQ = Number(live.baseQ) || 0;
  const ca = centerOf(a, grid.size), cb = centerOf(b, grid.size);
  const heightQ = distToQ(creatureHeightDist(b.actor ?? null, b), grid.distance);
  const r = terrainCover(terrain,
    { x: ca.x, y: ca.y, eyeQ: eyeQ(a, grid) - baseQ },
    { x: cb.x, y: cb.y, footQ: distToQ(Number(b.elevation) || 0, grid.distance) - baseQ, heightQ,
      radiusPx: (Math.min(b.width ?? 1, b.height ?? 1) * grid.size) / 2 },
    grid.size);
  return { cover: r.cover, lineOfSight: r.lineOfSight, blocked: r.blocked, total: r.total };
}

/** The i18n key for a cover value (GLDIO.cover.none / standard / greater). */
export const coverKey = (cover) => `GLDIO.cover.${cover}`;

/**
 * Walls that stop sight outright, px: Foundry's own edges (canvas.edges) of
 * walls with normal sight. An open door has no edge; limited, proximity and
 * one-way walls are left to Foundry's own vision, which already decided
 * whether the target is visible at all.
 */
export function sightWalls() {
  const NORMAL = globalThis.CONST?.EDGE_SENSE_TYPES?.NORMAL ?? 20;
  const out = [];
  const edges = globalThis.canvas?.edges;
  if (!edges?.values) return out;
  for (const e of edges.values()) {
    if (!e?.a || !e?.b || e.type !== "wall" || e.direction) continue;
    if ((e.sight ?? 0) !== NORMAL) continue;
    out.push({ ax: e.a.x, ay: e.a.y, bx: e.b.x, by: e.b.y });
  }
  return out;
}

/**
 * Distance between two tokens in distance units, the way the system measures
 * it: PF2e's own TokenPF2e#distanceTo (3D, creature boxes), else PF2e's rule
 * restated (rules/distance3d.mjs), else Foundry's measurePath centre to centre
 * with elevation (3D under the scene's diagonal rule).
 */
export function tokenDistance(attackerToken, targetToken, { systemId = globalThis.game?.system?.id ?? "" } = {}) {
  const a = docOf(attackerToken), b = docOf(targetToken);
  if (!a || !b) return null;
  const ta = a.object ?? attackerToken, tb = b.object ?? targetToken;
  const size = globalThis.canvas?.grid?.size ?? 100, distance = globalThis.canvas?.grid?.distance ?? 5;
  if (systemId === "pf2e") {
    try {
      const d = ta?.distanceTo?.(tb);
      if (Number.isFinite(d)) return d;
    } catch { /* fall through */ }
    const boxOf = (doc) => ({
      x: doc.x ?? 0, y: doc.y ?? 0, w: (doc.width ?? 1) * size, h: (doc.height ?? 1) * size,
      elevation: Number(doc.elevation) || 0, actor: !!doc.actor,
      height: Number(doc.actor?.dimensions?.height) || PF2E_SPACE_FT[doc.actor?.system?.traits?.size?.value] || (doc.width ?? 1) * distance,
    });
    return pf2eDistance(boxOf(a), boxOf(b), { size, distance }).distance;
  }
  try {
    const ca = centerOf(a, size), cb = centerOf(b, size);
    return globalThis.canvas.grid.measurePath([
      { x: ca.x, y: ca.y, elevation: Number(a.elevation) || 0 },
      { x: cb.x, y: cb.y, elevation: Number(b.elevation) || 0 },
    ]).distance;
  } catch { return null; }
}

/**
 * Everything the 3D view shows between an attacker and a target: the centre
 * line of sight with where the ground or a wall breaks it, the cover badge,
 * and the distance. Display only.
 * @returns {null|ReturnType<typeof lineOfSight> & {distance:number|null, rise:number}}
 *   rise: the target's feet above the attacker's, distance units
 */
export function tacticsBetween(attackerToken, targetToken) {
  const a = docOf(attackerToken), b = docOf(targetToken);
  if (!a || !b || a === b) return null;
  const scene = a.parent ?? b.parent;
  if (a.parent && b.parent && a.parent !== b.parent) return null;
  // Two Levels: walls only (no one floor's ground decides it), drawn in absolute heights.
  const level = sharedLevel(a, b);
  const live = level === undefined ? null : (activeContext(scene, level) ?? null);
  const any = live ?? anyContext(scene, level ?? null);
  const grid = any?.grid ?? { size: globalThis.canvas?.grid?.size ?? 100, distance: globalThis.canvas?.grid?.distance ?? 5 };
  // Ground is marched in the Level's own frame; the drawn line comes back absolute.
  const baseQ = live ? Number(live.baseQ) || 0 : 0;
  const ca = centerOf(a, grid.size), cb = centerOf(b, grid.size);
  const heightQ = distToQ(creatureHeightDist(b.actor ?? null, b), grid.distance);
  const r = lineOfSight(live?.terrain ?? null,
    { x: ca.x, y: ca.y, eyeQ: eyeQ(a, grid) - baseQ },
    { x: cb.x, y: cb.y, footQ: distToQ(Number(b.elevation) || 0, grid.distance) - baseQ, heightQ,
      radiusPx: (Math.min(b.width ?? 1, b.height ?? 1) * grid.size) / 2 },
    grid.size, { walls: sightWalls() });
  if (baseQ && r.line) r.line = { ...r.line, a: { ...r.line.a, zQ: r.line.a.zQ + baseQ }, b: { ...r.line.b, zQ: r.line.b.zQ + baseQ } };
  return { ...r, distance: tokenDistance(attackerToken, targetToken), rise: (Number(b.elevation) || 0) - (Number(a.elevation) || 0) };
}
