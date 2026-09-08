/**
 * PF2e Variant Rules — the seam against the PF2e system.
 *
 * Everything in here reads PF2e documents and chat messages. It is deliberately
 * the only place that knows PF2e's field paths, so when the system reshapes
 * something there is one file to fix rather than four. Every reader is
 * defensive and returns a null-ish value rather than throwing: a variant rule
 * that cannot read a card must decline to offer a button, never break the card.
 *
 * Field paths verified against PF2e v8.4.0.
 */

import { warn } from "../../core/const.mjs";

/** The four shapes Foundry hands a render hook its HTML in. */
export function normalizeHtml(value) {
  if (value instanceof HTMLElement) return value;
  if (value?.[0] instanceof HTMLElement) return value[0];
  if (value?.element instanceof HTMLElement) return value.element;
  if (value?.element?.[0] instanceof HTMLElement) return value.element[0];
  return null;
}

/** `flags.pf2e.context` — the roll's own account of what it was. */
export function messageContext(message) {
  return message?.flags?.pf2e?.context ?? null;
}

/** Degree of success as PF2e spells it, or null. */
export function outcomeOf(message) {
  return messageContext(message)?.outcome ?? null;
}

/** "attack-roll" | "saving-throw" | "skill-check" | … */
export function contextType(message) {
  return messageContext(message)?.type ?? null;
}

/**
 * The item a message originated from.
 *
 * PF2e's own `message.item` getter already resolves strikes, embedded spells and
 * origin uuids, so prefer it; the manual fallback exists for the cards it
 * declines to resolve. Compendium uuids are skipped deliberately — a synchronous
 * `fromUuidSync` cannot load one and returns a stub.
 */
export function originItem(message) {
  try {
    if (message?.item) return message.item;
    const uuid = message?.flags?.pf2e?.origin?.uuid;
    if (typeof uuid !== "string" || uuid.startsWith("Compendium.")) return null;
    return fromUuidSync(uuid) ?? null;
  } catch {
    return null;
  }
}

/** Cast rank for a spell card, else null. */
export function spellRankOf(message) {
  const rank = message?.flags?.pf2e?.origin?.castRank;
  if (Number.isInteger(rank) && rank > 0) return rank;
  const item = originItem(message);
  if (item?.type === "spell" && Number.isInteger(item?.rank)) return item.rank;
  return null;
}

/** The actor who rolled, resolved through the speaker. */
export function rollingActor(message) {
  try {
    return message?.actor ?? null;
  } catch {
    return null;
  }
}

/**
 * The creature on the receiving end of a roll.
 *
 * `context.target` holds *uuids* (unlike `context.actor`, which holds a bare
 * id), so a token uuid resolves to a TokenDocument whose `.actor` is the
 * unlinked copy actually taking the damage — which is the one to write to.
 */
export function targetActor(message) {
  try {
    const target = messageContext(message)?.target;
    if (!target) return null;
    if (target.token) {
      const token = fromUuidSync(target.token);
      if (token?.actor) return token.actor;
    }
    if (target.actor) return fromUuidSync(target.actor) ?? null;
    return null;
  } catch {
    return null;
  }
}

/**
 * The damage types an item can deal.
 *
 * Weapons and NPC attacks carry one type; spells carry a `damage` record whose
 * entries each name their own. Returns a de-duplicated list, empty when nothing
 * can be read — the caller treats that as "untyped".
 */
export function damageTypesOf(item) {
  const out = new Set();
  try {
    const direct = item?.system?.damage?.damageType ?? item?.system?.damage?.type;
    if (typeof direct === "string") out.add(direct);

    const rows = item?.system?.damage;
    if (rows && typeof rows === "object" && !Array.isArray(rows)) {
      for (const row of Object.values(rows)) {
        const type = row?.type ?? row?.damageType;
        if (typeof type === "string") out.add(type);
      }
    }

    for (const row of item?.system?.damageRolls ? Object.values(item.system.damageRolls) : []) {
      if (typeof row?.damageType === "string") out.add(row.damageType);
    }
  } catch {
    /* an item shaped unexpectedly yields no types, which the caller handles */
  }
  out.delete(undefined);
  out.delete(null);
  return [...out].filter((t) => typeof t === "string" && t.length > 0);
}

/**
 * Damage types this actor resists.
 *
 * Chip damage is *negated outright* by an applicable resistance rather than
 * reduced, so only the presence of a resistance matters, never its value.
 */
export function resistedTypesOf(actor) {
  try {
    const list = actor?.system?.attributes?.resistances ?? actor?.attributes?.resistances ?? [];
    return list.map((r) => r?.type).filter((t) => typeof t === "string");
  } catch {
    return [];
  }
}

/**
 * Does this roll deal only persistent damage?
 *
 * Persistence is encoded in the damage instance's flavor, and PF2e treats
 * `bleed` as persistent whether or not the `persistent` tag is present — a check
 * that looked only for the tag would let every bleed effect chip.
 */
export function persistentOnly(message) {
  try {
    const rolls = message?.rolls ?? [];
    const instances = rolls.flatMap((r) => r?.instances ?? []);
    if (!instances.length) return false;
    return instances.every((i) => i?.persistent === true || i?.type === "bleed");
  } catch {
    return false;
  }
}

/**
 * The level of the effect behind a Strike.
 *
 * The book's example — "a Strike from a 5th level fighter" chips for 5 — makes
 * this the attacking creature's level rather than anything on the weapon.
 */
export function effectLevel(actor) {
  const level = Number(actor?.system?.details?.level?.value ?? actor?.level);
  return Number.isFinite(level) ? level : 0;
}

/**
 * How much `pf2e-flatten` is shaving off this actor's rolls, as a positive
 * number, or 0 when the feature is not applied to it.
 *
 * That feature never rewrites `system.details.level.value` — it adds an
 * "all"-selector custom modifier — so an actor's level is already the true,
 * un-flattened one and this is only needed by the opt-in setting for tables
 * that want chip damage to shrink alongside everything else. It also exports no
 * public api, so reading the modifier is the supported way to detect it.
 */
export function flattenReduction(actor) {
  try {
    const mods = actor?.system?.customModifiers?.all ?? [];
    const found = mods.find(
      (m) => m?.slug === "flattened-level-proficiency" || m?.label === "Flattened Level Proficiency"
    );
    return found ? Math.abs(Number(found.modifier) || 0) : 0;
  } catch {
    return 0;
  }
}

/* ── Items ──────────────────────────────────────────────────────────────── */

/** Hardness, current HP and max HP for a physical item. */
export function itemDurability(item) {
  const hardness = Number(item?.system?.hardness ?? 0) || 0;
  const value = Number(item?.system?.hp?.value ?? 0) || 0;
  const max = Number(item?.system?.hp?.max ?? 0) || 0;
  return { hardness, value, max };
}

/**
 * A sturdy shield doubles its dent thresholds.
 *
 * The trait is what the book keys on, and it is also how PF2e models the runes
 * that make a shield sturdy in the first place.
 */
export function isSturdyShield(item) {
  try {
    if (item?.type !== "shield") return false;
    const traits = item?.system?.traits?.value ?? [];
    const slug = item?.slug ?? "";
    return traits.includes("sturdy") || /sturdy/i.test(slug) || /sturdy/i.test(item?.name ?? "");
  } catch {
    return false;
  }
}

/**
 * Constructs do not use dents — "the construct armor ability works as it
 * presently does" — so their items stay on PF2e's own broken threshold.
 */
export function isConstruct(actor) {
  try {
    const traits = actor?.system?.traits?.value ?? [];
    return traits.includes("construct");
  } catch {
    return false;
  }
}

/** Current wounded value, 0 when not wounded. */
export function woundedValue(actor) {
  const n = Number(actor?.system?.attributes?.wounded?.value ?? 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/** True when PF2e's API surface this feature needs is actually present. */
export function pf2eReady() {
  const ok = !!game?.pf2e;
  if (!ok) warn("pf2e-variant-rules | game.pf2e is unavailable; the feature stands down.");
  return ok;
}
