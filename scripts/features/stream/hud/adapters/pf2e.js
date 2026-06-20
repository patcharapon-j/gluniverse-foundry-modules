/**
 * Pathfinder 2e data provider for the Party HUD — STUB.
 *
 * The adapter seam (system-adapter.js) is keyed by `game.system.id`, so adding
 * real PF2e support is a drop-in: implement the same surface the dnd5e adapter
 * exposes (getName/getPortrait/getHP/getAC/getClassLevel/getRace/
 * getPrimaryResource/getAbilities/getConditions/isDefeated/supportsActor) and
 * flip `implemented` to true. Until then the HUD self-gates: the director panel
 * shows "system unsupported" and the overlay stays empty on PF2e worlds.
 *
 * PF2e mapping notes for whoever picks this up:
 *   - HP:        actor.system.attributes.hp.{value,max,temp}
 *   - AC:        actor.system.attributes.ac.value
 *   - level:     actor.system.details.level.value ; class via actor.class?.name
 *   - ancestry:  actor.ancestry?.name (the "race" equivalent)
 *   - resource:  actor.system.resources.focus (focus points) as the signature
 *   - abilities: actor.system.abilities[key].mod (PF2e has no raw scores by default)
 *   - conditions: actor.conditions / actor.itemTypes.condition
 */

export const pf2eAdapter = {
  id: "pf2e",
  implemented: false,
  supportsActor() {
    return false;
  }
};
