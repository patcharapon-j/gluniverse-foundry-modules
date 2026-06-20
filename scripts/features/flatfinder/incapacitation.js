/**
 * Flatfinder Incapacitation adjustment.
 *
 * Flatfinder replaces the core Incapacitation rule (which improves the target's save
 * by one degree of success) with:
 *   "A creature of higher level than the source of an incapacitation effect gains an
 *    untyped bonus to its save equal to twice the level difference, up to a maximum of
 *    +10. A spell is treated as level equal to twice its rank."
 *
 * To do this we wrap game.pf2e.Check.roll (the single entry point every PF2e check
 * passes through). For a saving throw against an incapacitation effect we:
 *   1. Suppress the system's native incapacitation degree-of-success adjustment by
 *      removing it from context.dosAdjustments (and the "incapacitation" roll option).
 *   2. Add a real untyped modifier of +2x(level difference) (max +10) to the check
 *      when the target outlevels the source, so it shows in the breakdown and total.
 *
 * Everything is guarded: if anything is missing or unexpected we leave the roll
 * completely untouched and the native behaviour stands.
 */

import { MODULE_ID } from "./constants.js";
import { getSetting } from "./settings.js";
import { flatfinderEffectiveLevel } from "./adjustments.js";
import { registerWrapper, WRAPPER } from "./lib/wrapper.js";

/** Does this save context carry the incapacitation trait? */
function isIncapacitation(context) {
  const options = context?.options;
  if (options) {
    const has = options instanceof Set ? options.has.bind(options) : null;
    if (has && has("incapacitation")) return true;
    const arr = options instanceof Set ? [...options] : Array.isArray(options) ? options : [];
    if (arr.some((o) => typeof o === "string" && o.includes("incapacitation"))) return true;
  }
  const traits = context?.traits ?? [];
  return traits.some((t) => (t?.value ?? t?.name ?? t) === "incapacitation");
}

/** Resolve the originating item for the effect, if present on the context. */
function getOriginItem(context) {
  return context?.item ?? context?.origin?.item ?? context?.origin ?? null;
}

/** Effective Flatfinder level of the incapacitation source (spell = 2x rank). */
function getSourceLevel(context) {
  const item = getOriginItem(context);
  if (item) {
    if (item.type === "spell") {
      const rank = item.rank ?? item.system?.level?.value ?? item.level;
      if (typeof rank === "number") return rank * 2;
    }
    const level = item.level ?? item.system?.details?.level?.value ?? item.system?.level?.value;
    if (typeof level === "number") return level;
  }
  // Fall back to an origin level roll option, e.g. "origin:level:6".
  const options = context?.options instanceof Set ? [...context.options] : context?.options ?? [];
  const opt = options.find((o) => /^origin:(?:item:)?level:-?\d+$/.test(o ?? ""));
  if (opt) return Number(opt.split(":").pop());
  return null;
}

/** Remove the system's incapacitation degree-of-success adjustment from the context. */
function suppressNativeIncapacitation(context) {
  if (Array.isArray(context.dosAdjustments)) {
    context.dosAdjustments = context.dosAdjustments.filter((adjustment) => {
      try {
        return !JSON.stringify(adjustment).toLowerCase().includes("incapacitation");
      } catch (err) {
        return true;
      }
    });
  }
  if (context.options instanceof Set) context.options.delete("incapacitation");
}

/** Add the Flatfinder untyped bonus to a CheckModifier, recalculating its total. */
function addFlatfinderModifier(check, bonus) {
  const ModifierCls = game.pf2e?.Modifier;
  if (!ModifierCls) return false;
  const modifier = new ModifierCls({
    slug: "flatfinder-incapacitation",
    label: game.i18n.localize("PF2E-FLATFINDER.Incapacitation.Caption"),
    modifier: bonus,
    type: "untyped",
  });
  if (typeof check.push === "function") {
    check.push(modifier);
  } else if (Array.isArray(check.modifiers)) {
    check.modifiers.push(modifier);
    check.calculateTotal?.(check.options ?? new Set());
  } else {
    return false;
  }
  return true;
}

/** Core logic, mutating check/context in place when the Flatfinder rule applies. */
function applyFlatfinderIncapacitation(check, context) {
  if (!getSetting("incapacitation")) return;
  if (context?.type !== "saving-throw") return;
  if (!isIncapacitation(context)) return;

  const targetActor = context.actor ?? context.self?.actor;
  const targetLevel = flatfinderEffectiveLevel(targetActor);
  const sourceLevel = getSourceLevel(context);
  if (typeof targetLevel !== "number" || typeof sourceLevel !== "number") return;

  const diff = targetLevel - sourceLevel;
  if (diff <= 0) return; // Only a higher-level target benefits.

  const bonus = Math.min(diff * 2, 10);
  if (bonus <= 0) return;

  // Build the modifier first (most likely point of failure) before mutating anything.
  if (!addFlatfinderModifier(check, bonus)) return;
  suppressNativeIncapacitation(context);
}

/**
 * Install the Check.roll wrapper through the libWrapper integration layer (real
 * lib-wrapper when installed, guarded fallback otherwise).
 */
export function registerIncapacitation() {
  if (!game.pf2e?.Check?.roll) {
    console.warn(`${MODULE_ID} | game.pf2e.Check.roll unavailable; Incapacitation adjustment disabled.`);
    return;
  }

  try {
    const backend = registerWrapper(
      "game.pf2e.Check.roll",
      function (wrapped, check, context = {}, ...rest) {
        try {
          applyFlatfinderIncapacitation(check, context);
        } catch (err) {
          console.error(`${MODULE_ID} | Incapacitation adjustment error`, err);
        }
        return wrapped(check, context, ...rest);
      },
      WRAPPER
    );
    console.log(`${MODULE_ID} | Flatfinder Incapacitation adjustment active (${backend}).`);

    if (backend === "fallback" && game.user?.isGM) {
      console.warn(
        `${MODULE_ID} | lib-wrapper is not installed; using a built-in fallback for the Check.roll wrap. Installing lib-wrapper is recommended for best compatibility.`
      );
    }
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to register the Incapacitation wrapper`, err);
  }
}
