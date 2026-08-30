/**
 * GLUniverse Suite — token conditions: reading a token's state.
 *
 * Two sources, one shape. PF2e models a *condition* as an embedded
 * `ConditionPF2e` and everything a feat, item, spell or affliction applies as an
 * `EffectPF2e`, and they are genuinely different things — a condition is a rules
 * state with a name the whole table knows, an effect is an arbitrary document
 * with a duration and somebody else's artwork on it. This module is where that
 * difference is resolved into one list the renderer can draw without caring.
 *
 * Everything here is defensive on purpose. A token rail that throws takes the
 * whole canvas layer with it, and the data it reads comes from a system that
 * ships new item types between minor versions.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { conditionTone, COVERED_SLUGS, effectTone, DEFAULT_TONE, toneRank } from "./tone.mjs";

/** Seconds in a PF2e round — the unit every duration in this file is read in. */
export const ROUND_SECONDS = 6;

/**
 * Item types that carry a duration and an icon, in the order PF2e declares them.
 *
 * `affliction` is the one worth naming: diseases and poisons are neither
 * conditions nor effects, they stage over time, and they are exactly the thing a
 * GM most needs to see on a token. Guarded rather than assumed, because a world
 * on an older system build has no such item type and `itemTypes.affliction` is
 * then undefined rather than empty.
 */
const EFFECT_TYPES = Object.freeze(["effect", "affliction"]);

const isGM = () => !!game.user?.isGM;

/**
 * Whether an image is a flat silhouette (PF2e's own condition art) or a piece of
 * full-colour artwork (everything a spell or an item brings with it).
 *
 * The shader lights these two completely differently — a silhouette is etched
 * into the plate and tinted to its tone, artwork is reduced to a monochrome
 * sigil first — and getting it wrong is loud in both directions: artwork run
 * through the silhouette path is a solid tone-coloured square, and a silhouette
 * run through the artwork path is nearly invisible.
 *
 * The test is the path rather than the pixels because the pixels are not
 * available until the texture has loaded, and a plate that changes its lighting
 * model one frame after it appears reads as a bug.
 */
export function isSilhouette(img) {
  return /\/(conditions|conditionitems)\//i.test(String(img ?? ""));
}

/** PF2e bakes a valued condition's number into its name; our badge prints it. */
function stripValue(name) {
  return String(name ?? "").trim().replace(/\s+\d+$/, "");
}

/**
 * The number (or formula) a plate prints in its corner tab.
 *
 * Three badge types and all three matter: `counter` is the twelve valued
 * conditions and the effects that stack, `value` is a computed number, and
 * `formula` is persistent damage — which prints "2d6" rather than a count, and
 * is the reason this returns a string rather than a number.
 */
function badgeOf(item) {
  const badge = item?.badge ?? item?.system?.badge ?? null;
  if (!badge) return { value: null, text: null };
  if (badge.type === "formula") {
    const text = String(badge.value ?? "").trim();
    return { value: null, text: text || null };
  }
  const n = Number(badge.value);
  if (!Number.isFinite(n)) return { value: null, text: null };
  return { value: n, text: String(Math.round(n)) };
}

/**
 * How much of an effect's duration is left, 0..1, or null when it has none.
 *
 * `null` and `0` are different answers and the shader treats them differently:
 * null draws the tone rail as a constant hairline (a condition, or an effect
 * that lasts until somebody removes it), 0 draws an empty gauge. Collapsing them
 * would put a full-width bar under every unlimited effect and make the gauge
 * meaningless on exactly the plates that have one.
 */
function lifeOf(item) {
  let total = Number(item?.totalDuration);
  if (!Number.isFinite(total) || total <= 0) return { life: null, remaining: Infinity };

  let remaining = Infinity;
  try {
    const r = item?.remainingDuration;
    remaining = Number(r?.remaining);
  } catch {
    return { life: null, remaining: Infinity };
  }
  if (!Number.isFinite(remaining)) return { life: null, remaining: Infinity };

  return { life: Math.max(0, Math.min(1, remaining / total)), remaining: Math.max(0, remaining) };
}

/** The disposition of whichever token an effect came from, or null. */
function originDispositionOf(item) {
  try {
    const origin = item?.origin;
    if (!origin) return null;
    const token = origin.getActiveTokens?.(false, true)?.[0] ?? origin.prototypeToken;
    const d = token?.disposition;
    return Number.isFinite(d) ? d : null;
  } catch {
    /* `origin` resolves a UUID, which can reach a half-constructed synthetic
       actor during scene load. A tone is not worth a thrown canvas. */
    return null;
  }
}

/**
 * Every active condition on an actor, in the shared plate shape.
 *
 * `conditions.active` is PF2e's own resolution of the override rules — a
 * condition suppressed by a higher-value one of the same slug, or explicitly
 * listed in another's `overrides`, is already excluded. Reimplementing that here
 * would mean drawing "paralyzed" under "unconscious" on a token whose sheet
 * correctly shows only one of them.
 */
function readConditions(actor) {
  const out = [];
  const list = actor?.conditions?.active
    ?? actor?.itemTypes?.condition?.filter?.((c) => c?.active)
    ?? [];
  for (const item of list) {
    const slug = String(item?.slug ?? "");
    if (!slug || COVERED_SLUGS.has(slug)) continue;
    const badge = badgeOf(item);
    const tone = conditionTone(slug);
    out.push({
      /* The document id, not the slug: persistent damage can be on a creature
         several times at once (fire and bleed), and two plates that share a key
         animate as one. */
      key: String(item.id ?? "cond:" + slug),
      kind: "condition",
      slug,
      name: stripValue(item.name),
      tone,
      rank: toneRank(tone),
      value: badge.value,
      badgeText: badge.text,
      img: item.img ?? null,
      art: isSilhouette(item.img) ? 0 : 1,
      life: null,
      remaining: Infinity,
      sustained: false,
      expiring: false,
      redacted: false,
    });
  }
  return out;
}

/**
 * Every effect, affliction and other timed thing a feat, item or spell applied.
 *
 * Three gates, and each of them is somebody's explicit decision rather than ours:
 *
 *   - `isExpired` — PF2e leaves an expired effect on the sheet until its owner
 *     clears it, greyed out. Drawing it on the token says the creature still has
 *     it, which is the opposite of true.
 *   - `system.tokenIcon.show` — the system's own per-effect "show this on the
 *     token" switch. Every PF2e user already knows where it is, and a module
 *     that ignores it has taken a control away from them.
 *   - `isIdentified` — an unidentified effect is one the GM has deliberately
 *     hidden. A GM sees it; everybody else gets a redacted plate carrying no
 *     name, no artwork and no counter.
 */
function readEffects(actor, token, opts) {
  const out = [];
  if (!opts.showEffects) return out;

  const selfUuid = actor?.uuid ?? null;
  const disposition = Number.isFinite(token?.document?.disposition) ? token.document.disposition : null;
  const gm = isGM();
  const warnSeconds = Math.max(0, opts.expiryWarn) * ROUND_SECONDS;

  for (const type of EFFECT_TYPES) {
    const list = actor?.itemTypes?.[type];
    if (!Array.isArray(list)) continue;

    for (const item of list) {
      if (item?.isExpired) continue;
      if (item?.system?.tokenIcon?.show === false) continue;

      const identified = item?.isIdentified !== false;
      const redacted = !identified && !gm;

      const { life, remaining } = lifeOf(item);
      const badge = badgeOf(item);
      const tone = redacted
        ? DEFAULT_TONE
        : effectTone(item, { selfUuid, disposition, originDisposition: originDispositionOf(item) });

      out.push({
        key: String(item.id ?? item.uuid ?? item.name),
        kind: "effect",
        slug: String(item?.slug ?? ""),
        /* PF2e prefixes most of these "Effect: Bless". The prefix is the item
           type restated, it is the same on every plate, and it is the first
           eleven characters of a name field that has room for about twelve. */
        name: redacted ? "" : stripValue(item.name).replace(/^Effect:\s*/i, ""),
        tone,
        rank: toneRank(tone),
        value: redacted ? null : badge.value,
        badgeText: redacted ? null : badge.text,
        img: redacted ? null : (item.img ?? null),
        art: redacted ? 0 : (isSilhouette(item.img) ? 0 : 1),
        life,
        remaining,
        sustained: !!item?.system?.duration?.sustained,
        /* Only a *finite* duration can be about to run out. An unlimited effect
           has `remaining === Infinity`, and `Infinity <= warnSeconds` is false,
           so this needs no separate guard — but it is the kind of thing a later
           refactor breaks silently, so the check tool pins it. */
        expiring: remaining <= warnSeconds,
        redacted,
      });
    }
  }
  return out;
}

/**
 * Order within a group: worst first, then whatever is about to change, then
 * alphabetically so Set iteration drift can never reshuffle a rail between
 * frames. A rail whose order is not stable is a rail nobody learns.
 */
function order(a, b) {
  return (a.rank - b.rank)
    || (a.remaining - b.remaining)
    || a.name.localeCompare(b.name)
    || a.key.localeCompare(b.key);
}

/**
 * The whole reading for one token: two ordered groups, conditions above effects.
 *
 * The split is positional rather than chromatic, and that is the load-bearing
 * decision in this file. Tone already carries *how bad*; asking it to carry
 * *what kind of thing* as well would need twelve colours, and twelve colours at
 * 16px is no colours. Position is free, it is exact, and it survives a
 * colour-blind viewer — which is the same argument the resource bar's plates
 * make for reading health by position as well as by hue.
 */
export function readToken(token, opts) {
  const actor = token?.actor;
  if (!actor) return null;

  const conditions = readConditions(actor).sort(order);
  const effects = readEffects(actor, token, opts).sort(order);
  if (!conditions.length && !effects.length) return null;

  return { conditions, effects, total: conditions.length + effects.length };
}

/**
 * Flatten a reading to the plates that will actually be drawn, plus the count
 * the tail has to stand in for.
 *
 * The cap is applied to the *whole* rail rather than per group, because the cap
 * exists to stop the rail reaching off the bottom of the screen and the screen
 * does not care which group a plate was in. Conditions are taken first, which is
 * the one place this feature is opinionated about which of the two matters more:
 * a condition is a rules state that changes what a creature can do this turn,
 * and an effect is usually a modifier already baked into a number somebody else
 * is rolling.
 */
export function flatten(reading, max) {
  const cap = Math.max(1, max | 0);
  const all = [...reading.conditions, ...reading.effects];
  if (all.length <= cap) {
    return { plates: all, hidden: 0, split: reading.conditions.length };
  }
  /* One slot is spent on the tail itself, so a cap of six with seven plates
     shows five and "+2" rather than six and "+1" — the alternative silently
     drops one more than the number says. */
  const shown = all.slice(0, cap - 1);
  return {
    plates: shown,
    hidden: all.length - shown.length,
    split: Math.min(reading.conditions.length, shown.length),
  };
}

/** The per-token placement override, in grid squares, or null when unset. */
export function offsetFor(token, key, worldDefault) {
  const raw = token?.document?.getFlag?.(SUITE_ID, key);
  const n = Number(raw);
  /* Finiteness, not truthiness: 0 is a legitimate override meaning "hold still
     while the world default moves", and Foundry turns an empty Number field into
     null rather than into 0. */
  return Number.isFinite(n) ? n : worldDefault;
}
