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
import { activeContext } from "./context.mjs";

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
export function coverBetween(attackerToken, targetToken) {
  const a = docOf(attackerToken), b = docOf(targetToken);
  if (!a || !b) return null;
  const scene = a.parent ?? b.parent;
  if (a.parent && b.parent && a.parent !== b.parent) return null;
  const live = activeContext(scene);
  if (!live) return null;
  const { terrain, grid } = live;
  const ca = centerOf(a, grid.size), cb = centerOf(b, grid.size);
  const heightQ = distToQ(creatureHeightDist(b.actor ?? null, b), grid.distance);
  const r = terrainCover(terrain,
    { x: ca.x, y: ca.y, eyeQ: eyeQ(a, grid) },
    { x: cb.x, y: cb.y, footQ: distToQ(Number(b.elevation) || 0, grid.distance), heightQ,
      radiusPx: (Math.min(b.width ?? 1, b.height ?? 1) * grid.size) / 2 },
    grid.size);
  return { cover: r.cover, lineOfSight: r.lineOfSight, blocked: r.blocked, total: r.total };
}

/** The i18n key for a cover value (GLDIO.cover.none / standard / greater). */
export const coverKey = (cover) => `GLDIO.cover.${cover}`;
