/**
 * GLUniverse Suite — PF2e Damage Dice: routing a rolled die to its damage type.
 *
 * ── Where this hooks, and why there ──
 * `diceSoNiceRollStart` fires on every client that is about to render a roll,
 * immediately before Dice So Nice turns it into dice notation, and it hands
 * over a mutable `context.roll`. That is the only place with all three
 * properties we need:
 *
 *   • It runs locally, so each player's own appearance mode applies to the
 *     same roll — no round-trip, no GM setting imposed on everyone.
 *   • It runs *before* the appearance is resolved, so what we write is what
 *     gets baked.
 *   • It mutates a throwaway copy, so nothing we do is persisted onto the chat
 *     message. Uninstall the suite and old messages roll normal dice again.
 *
 * ── Where the damage type actually lives ──
 * PF2e does not tag dice terms. A `DamageRoll` holds an `InstancePool` whose
 * rolls are `DamageInstance`s, and it is the *instance* that knows its type —
 * from its own `options.flavor`, e.g. `"fire,damage"`. `Roll#dice` flattens
 * straight through the pool, so by the time Dice So Nice sees the dice that
 * association is gone. We walk the instances ourselves and write the appearance
 * onto each instance's own dice, which are the very same objects the flattened
 * list yields.
 *
 * ── Why both `options.colorset` and `options.appearance` ──
 * `DiceFactory.getAppearanceForDice` consults them at different points.
 * `options.colorset` wins first and sets `suppressLibraryDie`, which is what
 * stops a player's saved library die from painting over the damage type.
 * `options.appearance` merges last, over everything, and is where the system
 * swap has to go. Setting only one leaves a way for the override to lose.
 */

import { warn } from "../../core/const.mjs";
import { DAMAGE_TYPES, systemName } from "./damage-types.mjs";
import { GLOWING_TYPES, SUPPORTED_FACES, appearanceFields } from "./dsn.mjs";
import { APPEARANCE, appearanceMode, markPersistent } from "./settings.mjs";

const isDamageType = (id) => typeof id === "string" && Object.hasOwn(DAMAGE_TYPES, id);

const glowing = new Set(GLOWING_TYPES);

/**
 * Read a damage type out of a PF2e flavor string.
 *
 * PF2e writes a comma-separated identifier list — `"persistent,fire,damage"`,
 * `"bludgeoning,silver,damage"` — so a substring match would happily find
 * "fire" inside "firearm". Split on the same separators PF2e uses.
 */
function typeFromFlavor(flavor) {
  if (typeof flavor !== "string") return null;
  for (const token of flavor.split(/[^a-z_-]+/i)) {
    if (isDamageType(token)) return token;
  }
  return null;
}

const isPersistentFlavor = (flavor) =>
  typeof flavor === "string" && /(^|[^a-z])(persistent|bleed)([^a-z]|$)/i.test(flavor);

/**
 * Every typed group of dice in a roll, as `{ dice, type, persistent }`.
 *
 * The `instances` path is the one PF2e always takes. The rest are fallbacks for
 * hand-built rolls and other modules that borrow PF2e's flavor convention —
 * they cost nothing when they do not match.
 */
function collectGroups(roll) {
  const groups = [];
  if (!roll) return groups;

  const push = (source, type, persistent) => {
    const dice = source?.dice;
    if (type && Array.isArray(dice) && dice.length) groups.push({ dice, type, persistent });
  };

  if (Array.isArray(roll.instances) && roll.instances.length) {
    for (const instance of roll.instances) {
      const type = isDamageType(instance?.type) ? instance.type : typeFromFlavor(instance?.options?.flavor);
      push(instance, type, !!instance?.persistent || isPersistentFlavor(instance?.options?.flavor));
    }
    if (groups.length) return groups;
  }

  // A bare instance, or a plain Roll carrying PF2e's flavor convention.
  const own = isDamageType(roll.type) ? roll.type : typeFromFlavor(roll.options?.flavor);
  if (own) {
    push(roll, own, !!roll.persistent || isPersistentFlavor(roll.options?.flavor));
    if (groups.length) return groups;
  }

  // Last resort: dice that carry the flavor on the term itself.
  for (const die of roll.dice ?? []) {
    const type = typeFromFlavor(die?.options?.flavor) ?? (isDamageType(die?.options?.type) ? die.options.type : null);
    if (type) groups.push({ dice: [die], type, persistent: isPersistentFlavor(die?.options?.flavor) });
  }
  return groups;
}

/** The appearance payload for one die of a given type. */
function appearanceFor(type, persistent, faces) {
  const mode = appearanceMode();
  const hot = persistent && markPersistent();
  const appearance = { ...appearanceFields(type, hot) };

  if (mode === APPEARANCE.tint) {
    // Colour only — drop the surface back to bare plastic.
    appearance.texture = "none";
    appearance.material = "plastic";
  } else if (mode === APPEARANCE.full && glowing.has(type) && SUPPORTED_FACES.has(faces)) {
    // The emission map lives on the system's presets, so the swap *is* the glow.
    appearance.system = systemName(type);
  }
  return appearance;
}

function tagDie(die, type, persistent) {
  if (!die) return false;
  const faces = Number(die.faces);
  const appearance = appearanceFor(type, persistent, faces);

  die.options ??= {};
  die.options.colorset = appearance.colorset;
  die.options.appearance = { ...(die.options.appearance ?? {}), ...appearance };
  return true;
}

/**
 * Paint every typed die in `roll`. Returns the number of dice tagged, which is
 * only used by the feature api for a smoke test.
 */
export function applyDamageAppearance(roll) {
  let tagged = 0;
  for (const { dice, type, persistent } of collectGroups(roll)) {
    for (const die of dice) if (tagDie(die, type, persistent)) tagged++;
  }
  return tagged;
}

let hookId = null;

export function activate() {
  if (hookId !== null) return;
  hookId = Hooks.on("diceSoNiceRollStart", (_messageId, context) => {
    try {
      // Another module may already have swapped in a stand-in roll; paint both
      // rather than guess which one Dice So Nice will end up rendering.
      applyDamageAppearance(context?.roll);
      if (context?.dsnRoll && context.dsnRoll !== context.roll) applyDamageAppearance(context.dsnRoll);
    } catch (e) {
      warn("pf2e-damage-dice | could not apply a damage appearance:", e);
    }
  });
}

export function deactivate() {
  if (hookId === null) return;
  Hooks.off("diceSoNiceRollStart", hookId);
  hookId = null;
}
