/**
 * The one place this feature writes damage to an actor.
 *
 * `ActorPF2e#applyDamage` (`pf2e.mjs:31411`) is the right call, with three
 * details that matter:
 *
 *   • Passing `damage` as a bare **number** skips `applyIWR` entirely — no
 *     immunities, no weaknesses, no persistent-damage conditions — so the actor
 *     loses exactly what the card promised. A Roll would re-run all of it.
 *
 *   • `final: true` additionally zeroes object hardness and disables the shield
 *     block prompt. Without it a creature with hardness takes less than the
 *     number on the button, and chip damage is a flat figure the rule already
 *     resolved. This is the same form PF2e's own `modifyTokenAttribute` uses.
 *
 *   • `token` is consumed **unguarded** inside the function (`t.name`,
 *     `t.combatant`, `t.actor`), so passing `undefined` throws rather than
 *     degrading. An actor with no token on the active scene therefore has to be
 *     refused up front — that is the guard below, and it is the whole reason
 *     this lives in its own module rather than inline at two call sites.
 *
 * Temp HP, stamina, clamping and the chat card's undo record are all PF2e's
 * job and it does them correctly. The card itself cannot be suppressed.
 */

import { warn } from "../../core/const.mjs";

/**
 * Apply exactly `amount` points of damage, bypassing IWR and hardness.
 *
 * @param {Actor|null} actor
 * @param {number} amount  positive damages, negative heals
 * @returns {Promise<boolean>} whether the damage actually landed
 */
export async function applyFlatDamage(actor, amount) {
  const n = Math.trunc(Number(amount) || 0);
  if (!actor || n === 0) return false;

  const token = resolveToken(actor);
  if (!token) {
    warn(`pf2e-variant-rules | ${actor.name ?? "an actor"} has no token on the active scene; damage not applied.`);
    ui.notifications?.warn(game.i18n.format("GLVR.error.noToken", { name: actor.name ?? "" }));
    return false;
  }

  try {
    await actor.applyDamage({ damage: n, token, final: true });
    return true;
  } catch (error) {
    warn("pf2e-variant-rules | applyDamage failed", error);
    return false;
  }
}

/**
 * The TokenDocument `applyDamage` needs.
 *
 * An unlinked token's actor already *is* the one taking the damage, so its own
 * active token is the right one; `getActiveTokens(true, true)` asks for linked
 * documents on the current scene, which is what PF2e passes itself.
 */
function resolveToken(actor) {
  try {
    const active = actor.getActiveTokens?.(true, true) ?? [];
    if (active.length) return active[0];
    // An unlinked token actor knows its own document directly.
    return actor.token ?? null;
  } catch {
    return null;
  }
}
