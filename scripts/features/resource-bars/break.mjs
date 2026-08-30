/**
 * GLUniverse Suite — resource bars: reading the initiative tracker's guard break.
 *
 * The initiative feature marks a combatant's guard as broken and puts a golden
 * glass fracture on its token and on its card. This is the third place that
 * state has to land, and the bar is arguably the one it matters most on: the
 * token overlay is behind the creature and the card is off at the edge of the
 * screen, while the bar is the thing everyone is already looking at.
 *
 * ── The contract ──
 *
 * Foundry only lets a package write flags under its own id, so every feature in
 * the suite shares one flag scope and keeps apart by prefixing its keys. Reading
 * across that line is a real dependency and is treated as one:
 *
 *   - The key is named once, here, and `tools/resource-bar-check.mjs` pins it
 *     against `features/initiative/constants.mjs`'s own FLAGS table. A rename
 *     there would otherwise leave this reading a flag nobody writes any more,
 *     and a fracture that simply never appears is not a bug anyone reports.
 *   - Nothing is ever *written*. The initiative tracker owns this state and the
 *     GM-only paths that set it; the bars are a reader.
 *   - The whole thing self-gates on the initiative feature being enabled, so a
 *     world running the bars alone pays nothing for it and cannot show a
 *     fracture driven by a stale flag left behind by a feature that is off.
 *
 * ── Permission ──
 *
 * There is deliberately no visibility test in here, and that is not an
 * oversight. The fracture is drawn *on the bar*, and `visibility.mjs` has
 * already decided whether this client may see that bar at all — a token whose
 * Display Bars hides it from a player has no bar for a crack to appear on.
 * Adding a second, differently-shaped rule here would be a second thing to keep
 * in step with core, which is the one mistake this feature's permission story is
 * built to avoid.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { Suite } from "../../core/registry.mjs";

/**
 * The initiative feature's own flag key, mirrored.
 *
 * `init.` is that feature's prefix and `guardBroken` its key; the dot nests the
 * value, exactly as this feature's own `rb.offsetX` does. Pinned by the check
 * tool against the table it is copied from.
 */
export const GUARD_BROKEN_FLAG = "init.guardBroken";

/** The feature whose state this is. Nothing here runs while it is off. */
export const BREAK_SOURCE_FEATURE = "initiative";

/** True when the tracker that owns the guard-break state is actually running. */
export function breakSourceActive() {
  try {
    return Suite.enabled(BREAK_SOURCE_FEATURE);
  } catch {
    return false;                     // settings not ready yet; nothing is broken
  }
}

/**
 * Whether the creature on this token has had its guard broken.
 *
 * The flag lives on the *Combatant*, not on the token or the actor, so a token
 * that is not in the running combat can never be broken — which is correct, and
 * is also what makes this cheap for the ninety percent of tokens on a battlemap
 * that are scenery.
 *
 * Every combatant bound to the token is checked rather than only the first.
 * PF2e-Flatfinder's solo bosses hold several combatants for one token (the prime
 * turn plus its reprises) and the tracker flags the one that was struck, so
 * asking `getCombatantByToken` would answer "intact" for a broken boss whenever
 * the reprise happened to sort first.
 */
export function isBroken(token) {
  const id = token?.id;
  if (!id) return false;
  /* The combat test first, because it is the cheap one and it is the one that
     answers "no" for the scenery, which is most of a battlemap. */
  const combat = game.combat;
  if (!combat?.started || !breakSourceActive()) return false;
  for (const combatant of combat.combatants ?? []) {
    if (combatant?.tokenId !== id) continue;
    if (combatant.getFlag?.(SUITE_ID, GUARD_BROKEN_FLAG)) return true;
  }
  return false;
}

/** Every token object in the current scene that a combatant is standing on. */
export function tokensForCombatant(combatant) {
  const object = combatant?.token?.object;
  return object ? [object] : [];
}
