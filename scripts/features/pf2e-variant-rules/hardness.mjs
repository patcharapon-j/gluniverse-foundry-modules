/**
 * Dents — finding an item's Hardness.
 *
 * Hardness is the whole input to the dent rule: damage at or below it does
 * nothing, damage above it deals one dent, damage above twice it deals two. So
 * an item whose Hardness is 0 takes **two dents from every hit that lands at
 * all** and is destroyed in two blows.
 *
 * That is not a hypothetical. PF2e's `physical` template ships every item at
 * `hardness: 0`, and `ShieldPF2e#prepareBaseData` is the only place in the
 * system that ever writes a real number there — a scan of the equipment
 * compendium finds 1773 items at zero and none above it. So a rule that reads
 * `system.hardness` and believes it is a rule where a solid adamantine greatsword
 * shatters as fast as a wooden spoon, and nothing anywhere reports that.
 *
 * This module is the ladder down from "what the system knows" to "what the
 * table decided", in that order, so the honest answer always wins:
 *
 *   1. the GM's per-item override, which is the whole point of having one
 *   2. `system.hardness`, when PF2e or another module actually set it — which is
 *      every shield, with its reinforcing runes and grade improvements already
 *      applied, and anything carrying a rule element
 *   3. this material's own Hardness at this grade, from PF2e's own table
 *   4. the table's per-type default, which ships at 0
 *
 * Pure and Foundry-free: property reads only, so the check tool can exercise
 * the whole ladder under plain Node.
 */

import { DEFAULT_DENT_CONFIG, MATERIAL_HARDNESS } from "./constants.mjs";

const int = (value, fallback = 0) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : fallback;
};

/**
 * A precious material's Hardness at a grade.
 *
 * Falls *down* the grades rather than returning nothing: several materials have
 * no low-grade row at all (adamantine begins at standard, orichalcum only
 * exists at high), and a null there would drop a solid adamantine item back to
 * the type default and read as the material meaning nothing.
 */
export function materialHardness(material, grade) {
  const row = MATERIAL_HARDNESS[material] ?? null;
  if (!row) return null;
  const order = ["high", "standard", "low"];
  const at = order.indexOf(grade);
  // Prefer the exact grade; otherwise take the best row at or below it, and if
  // the material only exists above the asked-for grade, take its lowest.
  const tried = at >= 0 ? order.slice(at) : order.slice();
  for (const key of tried) {
    if (Number.isFinite(row[key])) return row[key];
  }
  for (const key of order.slice().reverse()) {
    if (Number.isFinite(row[key])) return row[key];
  }
  return null;
}

/** Where a resolved Hardness came from, so the sheet can say so. */
export const HARDNESS_SOURCE = Object.freeze({
  override: "override",
  system: "system",
  material: "material",
  config: "config",
});

/**
 * This item's Hardness, and where it came from.
 *
 * The source matters as much as the number. A GM looking at a dent track needs
 * to know whether the 10 in front of them is adamantine, a shield PF2e already
 * computed, or a default they set themselves three months ago — otherwise the
 * only way to find out is to change it and see what moves.
 */
export function hardnessOf(item, config = null) {
  const cfg = config ?? DEFAULT_DENT_CONFIG;
  const override = item?.flags?.["gluniverse-foundry-modules"]?.["vr.dent.override"] ?? null;
  if (Number.isFinite(Number(override?.hardness))) {
    return { value: Math.max(0, int(override.hardness)), source: HARDNESS_SOURCE.override };
  }

  // PF2e's own value, wherever it actually set one. Shields always land here.
  const own = int(item?.system?.hardness, 0);
  if (own > 0) return { value: own, source: HARDNESS_SOURCE.system };

  const material = materialHardness(item?.system?.material?.type ?? null, item?.system?.material?.grade ?? null);
  if (Number.isFinite(material)) return { value: Math.max(0, material), source: HARDNESS_SOURCE.material };

  return { value: Math.max(0, int(cfg.hardness?.[item?.type], 0)), source: HARDNESS_SOURCE.config };
}
