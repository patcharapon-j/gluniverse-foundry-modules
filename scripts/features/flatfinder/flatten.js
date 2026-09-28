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
 *   - A DC that is *already* adjusted is left alone. On an actor-owned item, PF2e renders
 *     an inline `@Check[...|dc:N]` through the owner's "all" modifiers, which include
 *     pf2e-flatten's -level modifier, and `dc:resolve(...)` reads an already-flattened
 *     actor statistic. The number on the button (and on its chat repost) is then the
 *     final DC, so we only flatten when the rolled DC still equals the book value.
 *   - The adjustment requires a discoverable source item level; with none, the roll is
 *     left untouched.
 *   - Everything is guarded; on any unexpected shape we fall through to native behaviour.
 */

import { MODULE_ID } from "./constants.js";
import { getSetting } from "./settings.js";
import { registerWrapper, WRAPPER } from "../../core/wrapper.mjs";
// The -level custom modifier pf2e-flatten puts on an actor; one statement, not a copy.
import { MODIFIER_SLUG as PF2E_FLATTEN_SLUG } from "../pf2e-flatten/constants.js";

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
  return getOriginCreatureLevel(context);
}

/**
 * Last resort: the level of the creature the effect came from.
 *
 * An NPC ability item ("action" / "passive") carries no level of its own, so a
 * static DC written into a stat block description — `@Check[fortitude|dc:21]`
 * on a monster's breath weapon — has nothing for the lookups above to find and
 * would stay un-flattened under PwL. The level that DC was authored against is
 * the creature's own, so use it.
 *
 * Deliberately reads only the *origin* chain, never `context.actor`: on a saving
 * throw `context.actor` is the PC rolling the save, and flattening a monster's
 * DC by the defender's level would be wrong in both directions.
 */
function getOriginCreatureLevel(context) {
  const actor = getSourceItem(context)?.actor ?? context?.origin?.actor ?? null;
  if (actor?.type !== "npc" && actor?.type !== "hazard") return null;
  const level = actor.level ?? actor.system?.details?.level?.value;
  return typeof level === "number" ? level : null;
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

/** Matches an inline check tag, e.g. `@Check[fortitude|dc:25|basic]`. */
const INLINE_CHECK_PATTERN = /@Check\[([^\]]+)\]/gi;

/** True when pf2e-flatten has already removed level from this actor's rolls and DCs. */
function isFlattenedActor(actor) {
  const all = actor?.system?.customModifiers?.all;
  return Array.isArray(all) && all.some((m) => m?.slug === PF2E_FLATTEN_SLUG);
}

/** The statistic being rolled (e.g. "fortitude", "athletics"), from the roll options. */
function getCheckSlug(context) {
  const options =
    context?.options instanceof Set
      ? [...context.options]
      : Array.isArray(context?.options)
        ? context.options
        : [];
  const opt = options.find((o) => /^check:statistic:[^:]+$/.test(o ?? ""));
  return opt ? opt.slice("check:statistic:".length) : null;
}

/**
 * Parse every `@Check[...]` in the item's description into `{ types, dc, adjustments }`.
 * `dc` is the raw parameter string (a literal like "25", or "resolve(...)", "@self.level").
 */
function getInlineChecks(item) {
  const texts = new Set(
    [
      item?._source?.system?.description?.value,
      item?.system?.description?.value,
      item?.system?.description?.gm,
    ].filter((t) => typeof t === "string" && t.length > 0)
  );

  const checks = [];
  for (const text of texts) {
    for (const [, inner] of text.matchAll(INLINE_CHECK_PATTERN)) {
      const params = {};
      inner.split("|").forEach((part, i) => {
        const sep = part.indexOf(":");
        if (sep === -1) {
          if (i === 0) params.type = part;
          else params[part.trim()] = true;
        } else {
          params[part.slice(0, sep).trim()] = part.slice(sep + 1).trim();
        }
      });
      if (typeof params.type !== "string") continue;
      checks.push({
        types: params.type.split(",").map((t) => t.trim().toLowerCase()),
        dc: typeof params.dc === "string" ? params.dc : null,
        adjustments: String(params.adjustment ?? "0")
          .split(",")
          .map((a) => Number(a) || 0),
      });
    }
  }
  return checks;
}

/**
 * Whether a static DC still carries level and needs flattening.
 *
 * When the source item has inline checks for the rolled statistic, the DC is raw only if
 * it equals one of their literal `dc:N` (+ adjustment) book values; anything else was
 * already adjusted when PF2e rendered the link (owner's modifiers, resolve(), etc.).
 * Without a matching inline check, fall back to whether pf2e-flatten flattened the owner.
 */
function needsFlattening(context, dc) {
  const item = getSourceItem(context);
  const slug = getCheckSlug(context);

  const matching = getInlineChecks(item).filter((c) => !slug || c.types.includes(slug));
  if (matching.length > 0) {
    return matching.some((c) => {
      if (!c.dc || !/^-?\d+$/.test(c.dc)) return false; // resolve()/@self.level: actor-derived.
      const base = Number(c.dc);
      const i = slug ? c.types.indexOf(slug) : 0;
      const adjustment = c.adjustments[i] ?? 0;
      return dc.value === base + adjustment;
    });
  }

  return !isFlattenedActor(item?.actor ?? context?.origin?.actor);
}

/** Core logic: mutate context.dc in place when the Flatfinder DC flattening applies. */
function applyDcFlattening(context) {
  if (!getSetting("flattenDc")) return;

  const dc = context?.dc;
  if (!isStaticDc(dc)) return;

  // Guard against flattening twice (our own re-entry or a pre-flattened DC).
  if (context.options instanceof Set && context.options.has(FLATTENED_OPTION)) return;

  // The DC on the link may already be flattened (see needsFlattening); never do it twice.
  if (!needsFlattening(context, dc)) return;

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
