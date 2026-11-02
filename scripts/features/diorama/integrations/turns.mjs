/**
 * Diorama — the initiative turn on the standees.
 *
 * Gold ring = the current combatant, green = the next one. "Combat" is the
 * scene's RUNNING encounter (the stream camera's definition, shared through
 * `getRunningSceneCombat`): a prepared encounter that has not started rings
 * nobody.
 *
 * `nextCombatant` is pure; `turnState` reads the world.
 */

import { getRunningSceneCombat, getCombatantToken } from "../../stream/combat-utils.js";

const defeatedOf = (c) => !!(c?.isDefeated ?? c?.defeated);

/**
 * The combatant after `index` in `turns`, wrapping, skipping defeated ones and
 * anything `skip` refuses. Never the combatant at `index` itself.
 * @param {Array<object>} turns
 * @param {number} index
 * @param {(c: object) => boolean} [skip]
 * @returns {object|null}
 */
export function nextCombatant(turns, index, skip = null) {
  const list = Array.isArray(turns) ? turns : [];
  const n = list.length;
  if (n < 2 || !Number.isInteger(index) || index < 0 || index >= n) return null;
  for (let k = 1; k < n; k++) {
    const c = list[(index + k) % n];
    if (!c || defeatedOf(c)) continue;
    if (skip && skip(c)) continue;
    return c;
  }
  return null;
}

/**
 * Token ids of the current and next combatants on the viewed scene.
 * Players never see a hidden combatant named as "next".
 * @param {{isGM:boolean}} o
 * @returns {{current:string|null, next:string|null, combat:object|null}}
 */
export function turnState({ isGM }) {
  const combat = getRunningSceneCombat();
  if (!combat) return { current: null, next: null, combat: null };
  const turns = combat.turns ?? [];
  const index = Number.isInteger(combat.turn) ? combat.turn : -1;
  const cur = combat.combatant ?? turns[index] ?? null;
  const skip = isGM ? null : (c) => !!c.hidden;
  const nxt = nextCombatant(turns, index, skip);
  const idOf = (c) => c?.tokenId ?? c?.token?.id ?? null;
  return {
    current: cur && (isGM || !cur.hidden) ? idOf(cur) : null,
    next: idOf(nxt),
    combat,
  };
}

/** The current combatant's canvas token, when this client can see it. */
export function currentCombatantToken() {
  const combat = getRunningSceneCombat();
  const tok = combat ? getCombatantToken(combat.combatant) : null;
  return tok?.isVisible ? tok : null;
}

export { getRunningSceneCombat };
