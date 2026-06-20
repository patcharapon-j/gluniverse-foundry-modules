/**
 * Flatfinder item DC flattening.
 *
 * Under the Proficiency-without-Level (PwL) variant, the pf2e-flatten module removes a
 * creature's level from everything that is *derived from that creature's statistics*
 * (skill checks, attack rolls, class/spell DCs, NPC stat blocks, etc.). What it cannot
 * see are the numbers baked directly into content:
 *
 *   - inline checks written into descriptions, e.g. `@Check[fortitude|dc:25]`, and
 *   - fixed save DCs carried by items/spells that are not computed from an actor.
 *
 * Those static DCs were authored with level folded in, so under PwL they are too high.
 * This module flattens them at roll time by subtracting the originating item's level
 * from the DC, mirroring what pf2e-flatten does for actor-derived values.
 *
 * Safety:
 *   - Only *static* DCs are touched. A DC that resolves from a live actor statistic is
 *     left alone (pf2e-flatten already handled it), so the two modules never stack.
 *   - The adjustment requires a discoverable source item level; with none, the roll is
 *     left untouched.
 *   - Everything is guarded; on any unexpected shape we fall through to native behaviour.
 */

import { MODULE_ID } from "./constants.js";
import { getSetting } from "./settings.js";
import { registerWrapper, WRAPPER } from "./lib/wrapper.js";

/** Roll option set once we have flattened a DC, so we never re-flatten the same roll. */
const FLATTENED_OPTION = "flatfinder:dc-flattened";

/** Resolve the item a check's DC originates from, if present on the context. */
function getSourceItem(context) {
  return context?.item ?? context?.origin?.item ?? context?.origin ?? null;
}

/**
 * The level to strip from a static DC: the originating item's level. For spells this is
 * the (heightened) rank, which is the spell's level in PF2e's data model.
 */
function getSourceLevel(context) {
  const item = getSourceItem(context);
  if (item) {
    if (item.type === "spell") {
      const rank = item.rank ?? item.system?.level?.value ?? item.level;
      if (typeof rank === "number") return rank;
    }
    const level =
      item.level ?? item.system?.level?.value ?? item.system?.details?.level?.value;
    if (typeof level === "number") return level;
  }
  // Fall back to an item/origin level roll option, e.g. "item:level:5" or "origin:level:8".
  const options =
    context?.options instanceof Set
      ? [...context.options]
      : Array.isArray(context?.options)
        ? context.options
        : [];
  const opt = options.find((o) => /^(?:item|origin)(?::item)?:level:-?\d+$/.test(o ?? ""));
  if (opt) return Number(opt.split(":").pop());
  return null;
}

/**
 * True when `dc` is a static/inline DC safe to flatten. A DC derived from a live actor
 * statistic carries a back-reference to that statistic (StatisticDifficultyClass), and
 * pf2e-flatten already removes level from it — so those are deliberately left alone.
 */
function isStaticDc(dc) {
  if (!dc || typeof dc.value !== "number") return false;
  if (dc.statistic) return false; // StatisticDifficultyClass -> actor-derived.
  if (dc.parent) return false;
  return true;
}

/** Core logic: mutate context.dc in place when the Flatfinder DC flattening applies. */
function applyDcFlattening(context) {
  if (!getSetting("flattenDc")) return;

  const dc = context?.dc;
  if (!isStaticDc(dc)) return;

  // Guard against flattening twice (our own re-entry or a pre-flattened DC).
  if (context.options instanceof Set && context.options.has(FLATTENED_OPTION)) return;

  const level = getSourceLevel(context);
  if (typeof level !== "number" || level <= 0) return;

  const original = dc.value;
  const flattened = Math.max(1, original - level);
  if (flattened === original) return;

  dc.value = flattened;
  dc.flatfinder = { original, level };
  if (context.options instanceof Set) context.options.add(FLATTENED_OPTION);

  console.debug(
    `${MODULE_ID} | Flattened item DC ${original} -> ${flattened} (source level ${level}).`
  );
}

/**
 * Install the Check.roll wrapper through the libWrapper integration layer (real
 * lib-wrapper when installed, guarded fallback otherwise).
 */
export function registerFlattenDc() {
  if (!game.pf2e?.Check?.roll) {
    console.warn(`${MODULE_ID} | game.pf2e.Check.roll unavailable; DC flattening disabled.`);
    return;
  }

  try {
    const backend = registerWrapper(
      "game.pf2e.Check.roll",
      function (wrapped, check, context = {}, ...rest) {
        try {
          applyDcFlattening(context);
        } catch (err) {
          console.error(`${MODULE_ID} | DC flattening error`, err);
        }
        return wrapped(check, context, ...rest);
      },
      WRAPPER
    );
    console.log(`${MODULE_ID} | Flatfinder item DC flattening active (${backend}).`);
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to register the DC flattening wrapper`, err);
  }
}
