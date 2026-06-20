/**
 * Pathfinder 2e data provider for the Party HUD — STUB.
 *
 * The adapter seam (system-adapter.js) is keyed by `game.system.id`, so adding
 * real PF2e support is a drop-in: implement the same surface the dnd5e adapter
 * exposes (getName/getHP/getAC/getClassLevel/getRace/getResources/
 * getSpellSlots/getInspiration/isBloodied/getAbilities/getConditions/
 * isDefeated/supportsActor) and flip `implemented` to true. Optional methods are
 * read with `?.` in system-adapter.js, so a partial adapter still works. Until
 * then the HUD self-gates: the director panel shows "system unsupported" and the
 * overlay stays empty on PF2e worlds.
 *
 * PF2e mapping notes for whoever picks this up:
 *   - HP:        actor.system.attributes.hp.{value,max,temp}
 *   - AC:        actor.system.attributes.ac.value
 *   - level:     actor.system.details.level.value ; class via actor.class?.name
 *   - ancestry:  actor.ancestry?.name (the "race" equivalent)
 *   - resources: actor.system.resources.focus (focus points) as the signature;
 *                return as [{ key, label, value, max, kind:"pips" }]
 *   - slots:     PF2e spellcasting entries (actor.spellcasting) expose per-rank
 *                slots — map to [{ level, value, max }] if a slot strip is wanted
 *   - inspiration / bloodied: no inspiration analogue; bloodied via the
 *                "dying"/"wounded" conditions or hp ≤ half, per table preference
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
