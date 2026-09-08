/**
 * Boss Creatures — everything that writes to a document.
 *
 * Marking, unmarking, the Hit Point rescale, and turning a catalogue entry into
 * a real PF2e ability item. Kept apart from the sheet so there is exactly one
 * place that changes an actor, and apart from `rules.mjs` so the maths stays
 * testable without a Foundry global.
 */

import { SUITE_ID, warn } from "../../../core/const.mjs";
import { BOSS_FLAGS } from "./constants.mjs";
import { ABILITIES, CORE_ACTIONS, abilityById } from "./data.mjs";
import { bossHp, bossLevel, bossDc, bossModifier, resolveScale, tierOf, MAX_ABILITIES } from "./rules.mjs";
import { storedProfile, setProfile, clearProfile, updateProfile } from "./profile.mjs";

const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/* ── Reading the actor ───────────────────────────────────────────────────── */

/** The actor's own level, from the live document. */
export function actorLevel(actor) {
  const level = actor?.level ?? actor?.system?.details?.level?.value;
  return typeof level === "number" ? level : 0;
}

/** The actor's stored (source) maximum Hit Points, which is what we rescale. */
export function sourceMaxHp(actor) {
  const raw = actor?._source?.system?.attributes?.hp?.max ?? actor?.system?.attributes?.hp?.max;
  return Math.max(0, Math.trunc(Number(raw) || 0));
}

/**
 * The Proficiency-without-Level offset this actor carries, as a non-positive
 * number, or 0 when the world is not running PWoL.
 *
 * Read off the actor's own custom modifiers rather than imported from
 * `pf2e-flatten`, because the Boss rule has to behave the same whether that
 * feature, some other PWoL module, or a hand-added modifier is doing the
 * flattening. The label is the one pf2e-flatten writes; `system.customModifiers`
 * is plain PF2e data, not a private API.
 */
export function flattenOffset(actor) {
  try {
    const all = actor?.system?.customModifiers?.all ?? [];
    for (const modifier of all) {
      if (modifier?.enabled === false || modifier?.ignored) continue;
      const value = Number(modifier?.modifier);
      if (!Number.isFinite(value) || value >= 0) continue;
      const slug = String(modifier?.slug ?? "");
      const label = String(modifier?.label ?? "");
      if (slug.includes("flattened-level") || label.toLowerCase().includes("flattened level")) {
        return Math.trunc(value);
      }
    }
  } catch (error) {
    warn("pf2e-variant-rules | could not read the flattening modifier", error);
  }
  return 0;
}

/** Everything a boss readout or an ability description needs, in one object. */
export function bossStats(actor) {
  const profile = storedProfile(actor);
  const baseLevel = profile?.baseLevel ?? actorLevel(actor);
  const flatten = flattenOffset(actor);
  return {
    profile,
    baseLevel,
    flatten,
    level: bossLevel(baseLevel, profile?.tier),
    dc: bossDc(baseLevel, { flatten }),
    modifier: bossModifier(baseLevel, { flatten }),
    scale: resolveScale({ baseLevel, tier: profile?.tier, flatten }),
  };
}

/* ── Marking ─────────────────────────────────────────────────────────────── */

/**
 * Make an NPC a boss of the given tier.
 *
 * The base level and base Hit Points are captured *before* anything is scaled,
 * so unmarking restores exactly what was there rather than dividing the inflated
 * figure back out — 1.5 and 2 both round, and dividing back gives a different
 * number than the one the GM typed.
 *
 * Re-marking an existing boss at a different tier rescales from the captured
 * base, never from the current inflated max.
 */
export async function markBoss(actor, tier) {
  if (!tierOf(tier)) return null;
  if (actor?.type !== "npc") {
    ui.notifications?.warn(L("GLVR.boss.notify.notNpc"));
    return null;
  }

  const existing = storedProfile(actor);
  const baseHp = existing?.baseHp ?? sourceMaxHp(actor);
  const baseLevel = existing?.baseLevel ?? actorLevel(actor);

  if (baseHp <= 0) {
    ui.notifications?.warn(L("GLVR.boss.notify.noHp"));
  }

  await setProfile(actor, {
    tier,
    baseLevel,
    baseHp,
    abilities: existing?.abilities ?? [],
    downfalls: existing?.downfalls ?? [],
    choices: existing?.choices ?? {},
  });

  await writeHp(actor, bossHp(baseHp, tier));
  await syncCoreActions(actor);
  ui.notifications?.info(L("GLVR.boss.notify.marked", { name: actor.name, tier: L(`GLVR.boss.tier.${tier}`) }));
  return actor;
}

/** Strip the boss profile, restore the base Hit Points, remove granted items. */
export async function unmarkBoss(actor) {
  const profile = storedProfile(actor);
  if (!profile) return null;

  await removeGrantedItems(actor);
  await writeHp(actor, profile.baseHp);
  await clearProfile(actor);
  ui.notifications?.info(L("GLVR.boss.notify.unmarked", { name: actor.name }));
  return actor;
}

/**
 * Write a new maximum, carrying the current wound across.
 *
 * Two updates, deliberately. `CreaturePF2e#_preUpdate` clamps an incoming
 * `hp.value` against the maximum the actor has *right now*, so raising both in
 * one call clamps the new value straight back down to the old maximum — the
 * boss would gain its extra Hit Points and immediately be sitting at half of
 * them, which reads as the rescale having half worked.
 */
async function writeHp(actor, nextMax) {
  const max = Math.max(0, Math.trunc(Number(nextMax) || 0));
  if (max <= 0) return;

  const currentMax = Math.max(1, Number(actor.system?.attributes?.hp?.max) || 1);
  const currentValue = Math.max(0, Number(actor.system?.attributes?.hp?.value) || 0);
  // Keep the wound proportional: a boss marked mid-fight at 40% should still be
  // at 40%, not at 40 Hit Points out of a new 200.
  const share = currentValue / currentMax;
  const nextValue = Math.max(0, Math.min(max, Math.round(max * share)));

  await actor.update({ "system.attributes.hp.max": max });
  await actor.update({ "system.attributes.hp.value": nextValue }, { allowHPOverage: false });
}

/* ── Abilities ───────────────────────────────────────────────────────────── */

/** Flag written on every item this feature creates, so it can find them again. */
const OWNED = "vr.bossItem";

/** The items on this actor that we created. */
export function grantedItems(actor) {
  return (actor?.items ?? []).filter((item) => item?.getFlag?.(SUITE_ID, OWNED));
}

/** Remove every ability item this feature put on the actor. */
export async function removeGrantedItems(actor) {
  const ids = grantedItems(actor).map((item) => item.id);
  if (!ids.length) return;
  await actor.deleteEmbeddedDocuments("Item", ids);
}

/** PF2e's action-cost fields for one catalogue entry. */
function costFields(entry) {
  const { type, count } = entry.cost;
  if (type === "passive") return { actionType: { value: "passive" }, actions: { value: null } };
  if (type === "free") return { actionType: { value: "free" }, actions: { value: null } };
  return { actionType: { value: "action" }, actions: { value: count ?? 1 } };
}

/** The human label for an entry's cost, including the book's ranges. */
export function costLabel(entry) {
  const { type, count } = entry.cost;
  if (type === "passive") return L("GLVR.boss.cost.passive");
  if (type === "free") return L("GLVR.boss.cost.free");
  if (entry.costMax) {
    return L("GLVR.boss.cost.range", { min: String(count), max: String(entry.costMax) });
  }
  return L(`GLVR.boss.cost.${count}`);
}

/**
 * The description body for one entry: the book traits and metadata lines this
 * feature has to render itself, then the rule text with its numbers filled in.
 */
export function describeAbility(entry, scale, { core = false } = {}) {
  const root = core ? "GLVR.boss.core" : "GLVR.boss.ability";
  const text = L(`${root}.${entry.id}.text`, scale);

  const chips = (entry.bookTraits ?? [])
    .map((trait) => `<span class="glvr-boss-trait">${L(`GLVR.boss.bookTrait.${trait}`)}</span>`)
    .join("");

  const lines = [];
  if (entry.frequency) {
    lines.push(`<strong>${L("GLVR.boss.field.frequency")}</strong> ${L(`GLVR.boss.frequency.${entry.frequency}`)}`);
  }
  const meta = lines.length ? `<p class="glvr-boss-meta">${lines.join("<br>")}</p>` : "";
  const traitLine = chips ? `<p class="glvr-boss-traits">${chips}</p>` : "";

  return `${traitLine}${meta}${text}`;
}

/** Build the PF2e item data for one catalogue entry. */
export function abilityItemData(entry, scale, { core = false } = {}) {
  const root = core ? "GLVR.boss.core" : "GLVR.boss.ability";
  return {
    name: L(`${root}.${entry.id}.name`),
    type: "action",
    img: core ? "icons/skills/melee/strike-slashes-orange.webp" : "icons/creatures/abstract/construct-horned-stone.webp",
    system: {
      description: { value: describeAbility(entry, scale, { core }) },
      ...costFields(entry),
      category: entry.kind === "passive" || core ? null : "offensive",
      traits: { value: [...(entry.traits ?? [])], rarity: "common" },
      publication: { title: "Adventures+", license: "OGL", remaster: false },
    },
    flags: { [SUITE_ID]: { [OWNED]: { id: entry.id, core } } },
  };
}

/**
 * Put an ability on the actor.
 *
 * Refuses past the book's limit of three, which is the one place this feature
 * enforces rather than reports: a fourth ability is not a half-built boss, it is
 * a boss the book does not describe, and its Downfall count could never balance.
 */
export async function addAbility(actor, id) {
  const profile = storedProfile(actor);
  const entry = abilityById(id);
  if (!profile || !entry) return null;
  if (profile.abilities.includes(id)) return null;
  if (profile.abilities.length >= MAX_ABILITIES) {
    ui.notifications?.warn(L("GLVR.boss.abilities.full", { max: String(MAX_ABILITIES) }));
    return null;
  }

  const { scale } = bossStats(actor);
  await actor.createEmbeddedDocuments("Item", [abilityItemData(entry, scale)]);
  return updateProfile(actor, { abilities: [...profile.abilities, id] });
}

/** Take an ability off, and delete the item that came with it. */
export async function removeAbility(actor, id) {
  const profile = storedProfile(actor);
  if (!profile) return null;

  const doomed = grantedItems(actor)
    .filter((item) => item.getFlag(SUITE_ID, OWNED)?.id === id)
    .map((item) => item.id);
  if (doomed.length) await actor.deleteEmbeddedDocuments("Item", doomed);

  return updateProfile(actor, { abilities: profile.abilities.filter((entry) => entry !== id) });
}

/** Every boss carries Telegraph and Shrug It Off; make sure both are present. */
export async function syncCoreActions(actor) {
  const { scale } = bossStats(actor);
  const present = new Set(
    grantedItems(actor)
      .map((item) => item.getFlag(SUITE_ID, OWNED))
      .filter((flag) => flag?.core)
      .map((flag) => flag.id)
  );
  const missing = CORE_ACTIONS.filter((entry) => !present.has(entry.id));
  if (!missing.length) return;
  await actor.createEmbeddedDocuments(
    "Item",
    missing.map((entry) => abilityItemData(entry, scale, { core: true }))
  );
}

/**
 * Rewrite every granted item's description against the current numbers.
 *
 * Needed because a Boss DC moves when the base creature's level changes and when
 * the world's PWoL setting changes, and a description that keeps the old DC is a
 * number the GM will read out at the table without checking it.
 */
export async function refreshAbilityText(actor) {
  const profile = storedProfile(actor);
  if (!profile) return;
  const { scale } = bossStats(actor);

  const updates = [];
  for (const item of grantedItems(actor)) {
    const flag = item.getFlag(SUITE_ID, OWNED);
    const entry = flag?.core
      ? CORE_ACTIONS.find((candidate) => candidate.id === flag.id)
      : ABILITIES.find((candidate) => candidate.id === flag?.id);
    if (!entry) continue;
    const next = describeAbility(entry, scale, { core: !!flag.core });
    if (next === item.system?.description?.value) continue;
    updates.push({ _id: item.id, "system.description.value": next });
  }
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
}
