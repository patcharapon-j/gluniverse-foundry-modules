/**
 * Diorama view — the world-reading half of the Level stack (view/levels.mjs
 * is the pure half). The overlay asks here, once per flush, for:
 *
 *   readStack(scene, { gm })       the plan: viewed Level, floors below, cut-away ids
 *   stackProps(scene, plan, o)     PropState[] for the viewed Level (in the absolute
 *                                  frame) and every floor drawn below it (tagged,
 *                                  never blocking)
 *   loadFloors(plan, scene, rect)  the renderer's setLevels() input, art loaded
 *   tokenLevelOf(id)               a token's Level, for cutTokens
 *
 * In a one-Level scene the plan has nothing below and nothing cut, and
 * stackProps returns PropStore.states unchanged, so the view draws exactly
 * what it always did.
 */

import { liveTerrain } from "../terrain/live.mjs";
import { PropStore } from "../terrain/props-store.mjs";
import { levelsOf, resolveLevelId, levelBackgroundSrc, shiftPropStates, tokenLevelId } from "../terrain/levels.mjs";
import { Q_PER_CELL } from "../constants.mjs";
import { stackPlan, levelInputs, planKey } from "./levels.mjs";
import { loadArt } from "./snapshot.mjs";

/** The Level stack this viewer sees. */
export function readStack(scene, { gm = false } = {}) {
  const viewedId = resolveLevelId(scene);
  const plan = stackPlan(levelsOf(scene), viewedId, { gm });
  plan.viewedId = viewedId;
  plan.key = planKey(plan);
  return plan;
}

/**
 * Props for the renderer: the viewed Level's, lifted to its base; then each
 * floor below's, lifted to its own base, ids tagged with the Level and never
 * blocking (they must not stamp into the viewed floor's ground).
 * @param {Scene} scene
 * @param {ReturnType<typeof readStack>} plan
 * @param {{isGM?: boolean, viewed?: boolean}} [o]  viewed: false leaves the viewed Level's own
 *   out (the editor's preview draws its draft there instead)
 */
export function stackProps(scene, plan, { isGM = false, viewed = true } = {}) {
  const viewedId = plan?.viewedId ?? plan?.viewed?.id ?? resolveLevelId(scene);
  const live = liveTerrain(scene, viewedId);
  const own = viewed ? PropStore.states(scene, { isGM, level: viewedId }) : [];
  const out = shiftPropStates(own, { dCells: Math.round(live?.baseQ ?? 0) / Q_PER_CELL }).slice();
  for (const l of plan?.below ?? []) {
    const lv = liveTerrain(scene, l.id);
    if (!lv) continue;
    const states = PropStore.states(scene, { isGM, level: l.id });
    out.push(...shiftPropStates(states, { dCells: Math.round(lv.baseQ) / Q_PER_CELL, tag: l.id, blocks: false }));
  }
  return out;
}

const _art = new Map(); // src → Promise<image|null>

function art(src) {
  if (!src) return Promise.resolve(null);
  if (!_art.has(src)) _art.set(src, loadArt(src).catch(() => null));
  return _art.get(src);
}

/** Forget loaded floor art (the view closed). */
export function releaseFloorArt() { _art.clear(); }

/**
 * Every floor below, with its absolute ground and its own art loaded.
 * @returns {Promise<ReturnType<typeof levelInputs>>}
 */
export async function loadFloors(plan, scene, rect) {
  const below = plan?.below ?? [];
  const images = new Map();
  await Promise.all(below.map(async (l) => { images.set(l.id, await art(levelBackgroundSrc(scene, l.id))); }));
  return levelInputs(plan, (id) => liveTerrain(scene, id)?.absolute().ground ?? null, (id) => images.get(id) ?? null, rect);
}

/**
 * WallStates of the walls in a Level (v14 CanvasDocument#includedInLevel: a
 * wall with no Levels stands in all of them). The view draws the viewed
 * Level's walls only; the floors below are bare ground and props.
 * @param {object[]} states  WallState[] (their `id` is the wall's)
 * @param {(id:string) => object|null} docOf  the wall document
 */
export function wallsOnLevel(states, docOf, levelId) {
  if (!levelId) return states;
  return (states ?? []).filter((s) => {
    const doc = docOf(s.id);
    return !doc || typeof doc.includedInLevel !== "function" || doc.includedInLevel(levelId);
  });
}

/** A token id's Level on the viewed canvas. */
export function tokenLevelOf(id) {
  return tokenLevelId(globalThis.canvas?.tokens?.get?.(id)?.document ?? null);
}
