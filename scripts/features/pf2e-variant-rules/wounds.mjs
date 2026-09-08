/**
 * Lasting Wounds — *Adventures+* p. 47.
 *
 * "With this rule, the wounded condition cannot be reduced except by resting for
 * a full night. The wounded condition also imposes a circumstance penalty equal
 * to its value on Medicine checks that target the wounded creature and apply a
 * status penalty equal to twice its value to Hit Points restored from healing
 * effects."
 *
 * Three clauses, three mechanisms, each chosen because PF2e actually supports it:
 *
 *   healing penalty   a custom modifier on the `healing-received` selector.
 *                     `CreaturePF2e#prepareSynthetics` pushes every key of
 *                     `system.customModifiers` straight into
 *                     `synthetics.modifiers` with no allow-list, and
 *                     `applyDamage` extracts exactly that selector when the
 *                     final damage is negative. No effect item, no rule element.
 *
 *   Medicine penalty  a wrapper on `game.pf2e.Check.roll`, following the
 *                     precedent flatfinder already sets on the same target. The
 *                     modifier is pushed onto the *check*, since that is what
 *                     `Check.roll` sums; the context's own `modifiers` array is
 *                     metadata about the roller and is never added to anything.
 *
 *   rest              a wrapper on `game.pf2e.actions.restForTheNight`.
 *
 * ── Two limits worth knowing ────────────────────────────────────────────────
 *
 * `applyDamage` skips every modifier when called with `final: true`, and that is
 * what a direct token HP-bar drag does. Healing applied by dragging a bar
 * therefore ignores the penalty; healing applied from a chat card honours it.
 * That is PF2e's seam, not something this feature can close.
 *
 * Treat Wounds rolls against a plain numeric DC, so `StatisticCheck#roll` takes
 * its un-targeted branch and the message carries **no** `context.target` and no
 * `target:*` roll options — the one Medicine check this rule cares about most is
 * the one that does not record its patient. We resolve the patient from the
 * user's own target/selection instead, which is what PF2e itself reads before
 * discarding it.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { registerWrapper, WRAPPER } from "../../core/wrapper.mjs";
import { SETTINGS } from "./constants.mjs";
import { woundPenalties } from "./rules.mjs";
import { woundsOn, get } from "./settings.mjs";
import { woundedValue } from "./pf2e.mjs";

/** Label is also the identity: PF2e slugs it to find the modifier for removal. */
const MODIFIER_LABEL = "Lasting Wound";
const MODIFIER_SLUG = "lasting-wound";
const HEALING_SELECTOR = "healing-received";

/* ══════════════════════════════════════════════════════════════════════════
   HEALING PENALTY — a custom modifier kept in step with the wounded value
   ══════════════════════════════════════════════════════════════════════════ */

/** The modifier currently on the actor, or null. */
function existing(actor) {
  try {
    const list = actor?.system?.customModifiers?.[HEALING_SELECTOR] ?? [];
    return list.find((m) => m?.slug === MODIFIER_SLUG || m?.label === MODIFIER_LABEL) ?? null;
  } catch {
    return null;
  }
}

/**
 * Bring one actor's healing modifier in line with its wounded value.
 *
 * `addCustomModifier` refuses to add a second modifier with the same label, so
 * a *changed* value has to be removed and re-added — the same remove-then-add
 * that `pf2e-flatten`'s `refreshActor` performs for the same reason.
 */
export async function syncActor(actor) {
  if (!actor?.isOfType?.("character", "npc")) return false;

  const wanted = woundsOn() && get(SETTINGS.woundsHealing, true) ? woundPenalties(woundedValue(actor)).healing : 0;
  const current = existing(actor);
  const currentValue = current ? Number(current.modifier) || 0 : null;

  if (wanted === 0) {
    if (!current) return false;
    await actor.removeCustomModifier(HEALING_SELECTOR, MODIFIER_SLUG);
    return true;
  }

  if (currentValue === wanted) return false;
  if (current) await actor.removeCustomModifier(HEALING_SELECTOR, MODIFIER_SLUG);
  await actor.addCustomModifier(HEALING_SELECTOR, MODIFIER_LABEL, wanted, "status");
  return true;
}

/**
 * Wounded lives on a *condition item*, and `system.attributes.wounded.value` is
 * derived from it during data prep — so the signal that it changed is an
 * embedded item appearing, changing or leaving, not an actor update. All three
 * hooks funnel here, and each is gated to the acting client so a five-player
 * table does not perform the same write five times.
 */
function watchedActor(item) {
  return item?.parent?.documentName === "Actor" ? item.parent : null;
}

async function onConditionChanged(item, _b, _c, userId) {
  if (game.user.id !== (typeof _c === "string" ? _c : userId)) return;
  if (item?.type !== "condition") return;
  if (item?.slug !== "wounded" && item?.system?.slug !== "wounded") return;
  const actor = watchedActor(item);
  if (!actor?.isOwner) return;
  try {
    await syncActor(actor);
  } catch (error) {
    warn("pf2e-variant-rules | could not sync a Lasting Wound modifier", error);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   MEDICINE PENALTY — a circumstance penalty on checks aimed at the wounded
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Who is this Medicine check being performed on?
 *
 * `context.target` is the right answer when PF2e supplies it, but Treat Wounds
 * does not, so fall back the way PF2e's own `StatisticCheck#roll` finds a target
 * before deciding not to record it: the user's target, then a single selected
 * token that is not the roller.
 */
export function resolvePatient(context) {
  const direct = context?.target?.actor;
  if (direct instanceof Actor) return direct;

  const targeted = [...(game.user?.targets ?? [])][0]?.actor ?? null;
  if (targeted) return targeted;

  const rollerId = context?.self?.actor?.id ?? context?.actor?.id ?? null;
  const selected = (canvas?.tokens?.controlled ?? []).map((t) => t.actor).filter(Boolean);
  const others = selected.filter((a) => a.id !== rollerId);
  return others.length === 1 ? others[0] : null;
}

/** Is this check one the rule reaches — a Medicine skill check? */
export function isMedicineCheck(context) {
  const domains = context?.domains ?? [];
  if (domains.includes("medicine")) return true;
  const slug = context?.identifier ?? "";
  return typeof slug === "string" && slug.includes("medicine");
}

/**
 * Push the circumstance penalty onto a Medicine check aimed at a wounded
 * creature.
 *
 * The modifier has to go on the **check**, not on the context. `Check.roll`
 * reads `check.modifiers` — the context's own `modifiers` array is only copied
 * into `context.origin` as metadata about the roller and is never summed — so a
 * penalty written there is recorded, displayed nowhere, and changes no result.
 * That is the shape this first shipped in, and it is invisible from the outside:
 * the card renders perfectly, with the wrong total.
 *
 * `StatisticModifier#push` dedupes by slug and recalculates, so a reroll cannot
 * stack a second copy.
 */
export function applyMedicinePenalty(check, context) {
  if (!woundsOn() || !get(SETTINGS.woundsMedicine, true)) return;
  if (typeof check?.push !== "function") return;
  if (!isMedicineCheck(context)) return;

  const patient = resolvePatient(context);
  if (!patient) return;

  const { medicine } = woundPenalties(woundedValue(patient));
  if (medicine === 0) return;

  const Modifier = game.pf2e?.Modifier;
  if (!Modifier) return;

  check.push(
    new Modifier({
      label: game.i18n.localize("GLVR.wounds.medicineModifier"),
      slug: MODIFIER_SLUG,
      modifier: medicine,
      type: "circumstance",
    })
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   REST — the wounded condition survives the night
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * PF2e removes wounded outright during rest (`forceRemove: true`, and only when
 * HP finished at max). There is no seam inside that function and its
 * `pf2e.restForTheNight` hook fires after every update has committed and is not
 * cancellable, so the honest options are to prevent it or to undo it.
 *
 * We undo it: snapshot each affected actor's wounded value, let rest run
 * untouched, then put the condition back. Preventing it would mean wrapping
 * `decreaseCondition` and reaching for a class whose path through PF2e's proxy
 * classes is not stable, and PF2e's own rest summary would still claim the
 * condition was removed either way — so we post a short card saying otherwise.
 */
async function setWounded(actor, value) {
  const target = Math.max(0, Math.trunc(Number(value) || 0));
  if (target <= 0) return;

  const condition = actor.getCondition?.("wounded") ?? null;
  if (!condition) {
    // On the create path `value` is an absolute starting value, not an increment.
    await actor.increaseCondition("wounded", { value: target });
    return;
  }
  // `value` would be an *increment* on an existing condition, so set it outright.
  // ConditionManager clamps to the wounded maximum itself.
  await game.pf2e.ConditionManager.updateConditionValue(condition.id, actor, target);
}

async function onRest(wrapped, options = {}, ...rest) {
  if (!woundsOn() || !get(SETTINGS.woundsBlockRest, true)) return wrapped(options, ...rest);

  const actors = [options?.actors ?? []].flat().filter((a) => a?.isOfType?.("character"));
  const before = new Map();
  for (const actor of actors) {
    const value = woundedValue(actor);
    if (value > 0) before.set(actor, value);
  }

  const result = await wrapped(options, ...rest);
  if (!before.size) return result;

  const persisted = [];
  for (const [actor, value] of before) {
    try {
      if (woundedValue(actor) < value) {
        await setWounded(actor, value);
        persisted.push({ name: actor.name, value });
      }
    } catch (error) {
      warn("pf2e-variant-rules | could not restore a lasting wound after rest", error);
    }
  }

  if (persisted.length) await announcePersisted(persisted);
  return result;
}

/**
 * PF2e's own rest summary reports the wounded condition as removed, because it
 * records that before we put it back. Saying so plainly is cheaper and more
 * honest than trying to rewrite that message.
 */
async function announcePersisted(rows) {
  const items = rows
    .map((r) => `<li>${escapeHtml(r.name)} — ${escapeHtml(game.i18n.localize("PF2E.ConditionTypeWounded"))} ${r.value}</li>`)
    .join("");
  try {
    await ChatMessage.create({
      whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
      content: `<section class="glvr-rest">
        <header class="glvr-rest-head">${escapeHtml(game.i18n.localize("GLVR.wounds.restTitle"))}</header>
        <p class="glvr-rest-line">${escapeHtml(game.i18n.localize("GLVR.wounds.restBody"))}</p>
        <ul class="glvr-rest-list">${items}</ul>
      </section>`,
    });
  } catch (error) {
    warn("pf2e-variant-rules | could not post the lasting-wound rest notice", error);
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/* ══════════════════════════════════════════════════════════════════════════
   WIRING
   ══════════════════════════════════════════════════════════════════════════ */

export function registerWounds() {
  Hooks.on("createItem", onConditionChanged);
  Hooks.on("deleteItem", onConditionChanged);
  Hooks.on("updateItem", onConditionChanged);
}

export function readyWounds() {
  // Medicine penalty. flatfinder already wraps this target twice; the suite's
  // registerWrapper chains handlers rather than fighting over it.
  if (game.pf2e?.Check?.roll) {
    registerWrapper(
      "game.pf2e.Check.roll",
      function (wrapped, check, context = {}, ...args) {
        try {
          applyMedicinePenalty(check, context);
        } catch (error) {
          warn("pf2e-variant-rules | Medicine penalty error", error);
        }
        return wrapped(check, context, ...args);
      },
      WRAPPER
    );
  } else {
    warn("pf2e-variant-rules | game.pf2e.Check.roll is unavailable; the Medicine penalty stands down.");
  }

  // Rest. This one is a plain property on a Collection rather than a prototype
  // method, so libWrapper may decline it; a direct patch is a correct fallback
  // because nothing else in the system shares the reference.
  const actions = game.pf2e?.actions;
  if (typeof actions?.restForTheNight === "function") {
    try {
      registerWrapper("game.pf2e.actions.restForTheNight", onRest, WRAPPER);
    } catch {
      const original = actions.restForTheNight;
      actions.restForTheNight = function (...args) {
        return onRest.call(this, original.bind(this), ...args);
      };
    }
  } else {
    warn("pf2e-variant-rules | restForTheNight is unavailable; rest blocking stands down.");
  }
}

/** Strip every Lasting Wound modifier the feature ever wrote. */
export async function clearAll() {
  for (const actor of game.actors ?? []) {
    try {
      if (existing(actor)) await actor.removeCustomModifier(HEALING_SELECTOR, MODIFIER_SLUG);
    } catch {
      /* a locked compendium actor keeps its modifier; nothing else is affected */
    }
  }
}

export const _internals = { MODIFIER_LABEL, MODIFIER_SLUG, HEALING_SELECTOR };
