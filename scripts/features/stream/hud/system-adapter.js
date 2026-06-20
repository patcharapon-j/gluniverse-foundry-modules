/**
 * Party HUD system-data seam.
 *
 * The HUD is system-agnostic in its rendering/animation; only the *reading* of
 * character data is system-specific. Adapters are registered by `game.system.id`
 * so a new system is a single drop-in file (see adapters/pf2e.js). The `stream`
 * feature itself stays `system: null` (camera/overlays work anywhere) — the HUD
 * capability gates on adapter availability via `hasAdapter()`.
 */

import { dnd5eAdapter } from "./adapters/dnd5e.js";
import { pf2eAdapter } from "./adapters/pf2e.js";

const ADAPTERS = new Map([
  [dnd5eAdapter.id, dnd5eAdapter],
  [pf2eAdapter.id, pf2eAdapter]
]);

/** The adapter for the active system, or null when unsupported / stubbed. */
export function getAdapter() {
  const adapter = ADAPTERS.get(game.system?.id);
  if (!adapter) return null;
  if (adapter.implemented === false) return null;
  return adapter;
}

/** True when the active system has a usable HUD adapter. */
export function hasAdapter() {
  return getAdapter() !== null;
}

/**
 * Build the serializable per-actor snapshot the stream client renders. Returns
 * null for actors the adapter can't represent. Field flags trim optional data
 * (ability scores, conditions, ...) per the director's settings before it ever
 * crosses the socket.
 */
export function buildActorSnapshot(actor, fields = {}) {
  const adapter = getAdapter();
  if (!adapter || !actor || !adapter.supportsActor(actor)) return null;

  const hp = adapter.getHP(actor);
  return {
    id: actor.id,
    name: adapter.getName(actor),
    img: adapter.getPortrait(actor),
    classLevel: adapter.getClassLevel(actor),
    race: adapter.getRace(actor),
    hp,
    ac: adapter.getAC(actor),
    resource: fields.showResource === false ? null : adapter.getPrimaryResource(actor),
    abilities: fields.showAbilities ? adapter.getAbilities(actor) : [],
    conditions: fields.showConditions === false ? [] : adapter.getConditions(actor),
    tempHp: fields.showTempHp === false ? 0 : hp.temp,
    defeated: adapter.isDefeated(actor)
  };
}
