/**
 * GLUniverse Suite — reading PF2e's dying state.
 *
 * Pure, dependency-free and side-effect-free, so the initiative tracker, the
 * resource bars and the check tools (under plain Node) all read dying the same
 * way. It takes an actor and returns numbers; it never asks which system is
 * running — both callers gate on that themselves — and it never writes anything.
 *
 * ── What PF2e hands over ──
 *
 * `CreaturePF2e#prepareDerivedData` (NPCs inherit it) builds
 * `system.attributes.dying = { value, max, recoveryDC }`, where `max` is 4 plus
 * whatever rule elements add (Diehard makes it 5) **minus doomed, already**, and
 * `value` is the condition's value capped at that max. `attributes.doomed` is
 * `{ value, max }`. Subtracting doomed from `dying.max` a second time puts death
 * one step early — that was the initiative tracker's bug (doomed 1 read "death
 * at 2" where the book says 3).
 *
 * Dying itself is a condition item (type "condition", slug "dying", value at
 * `system.value.value`). The derived attributes are recomputed by the time the
 * item hooks fire, so they are preferred; the item is the fallback for an actor
 * whose derived data is missing, and only there is doomed subtracted — once.
 *
 * PF2e never kills a creature at its maximum; it caps the value. The book says a
 * creature at its dying maximum is dead, so `readPf2eDead` reads it as dead — and
 * that is still a reading, not a verdict: nothing here writes to the creature.
 */

/* The dying maximum before doomed, and with Diehard. Fallback only. */
const DYING_BASE_MAX = 4;
const DYING_DIEHARD_MAX = 5;

const finite = (v) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) ? n : null;
};

/**
 * An actor's embedded items as a plain array, whichever shape the collection
 * arrives in — a Foundry EmbeddedCollection, Map entries or a plain array.
 * The initiative tracker reads items through this too.
 */
export function getActorItems(actor) {
  const items = actor?.items?.contents ?? actor?.items ?? [];
  try {
    return Array.from(items).map((entry) => (Array.isArray(entry) ? entry[1] : entry)).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * An item's slug, normalised: PF2e's own slug where there is one, else the tail
 * of its compendium source id, else its name — lower-case and hyphenated. The
 * initiative tracker matches conditions and guard-break effects by it.
 */
export function getItemSlug(item) {
  return String(item?.slug ?? item?.system?.slug ?? item?.flags?.core?.sourceId ?? item?.name ?? "")
    .trim()
    .toLowerCase()
    .replace(/^.*\./, "")
    .replace(/\s+/g, "-");
}

/**
 * A valued condition's value, or null when the actor does not carry it. PF2e
 * keeps its conditions in `itemTypes.condition`, which is a handful of items
 * rather than the whole inventory; this runs on every read of every token.
 */
function conditionValue(actor, slug) {
  const pool = Array.isArray(actor?.itemTypes?.condition) ? actor.itemTypes.condition : getActorItems(actor);
  const item = pool.find((i) => i?.type === "condition" && getItemSlug(i) === slug);
  if (!item) return null;
  for (const candidate of [item.system?.value?.value, item.system?.badge?.value, item.value]) {
    const n = finite(candidate);
    if (n !== null) return n;
  }
  return 1;
}

/** Doomed as a number, whichever shape the attribute arrives in. */
function doomedOf(actor) {
  const attr = actor?.system?.attributes?.doomed;
  const n = finite(attr && typeof attr === "object" ? attr.value : attr) ?? conditionValue(actor, "doomed") ?? 0;
  return Math.max(0, Math.round(n));
}

/**
 * The dying state of one actor, or null when it is not dying.
 *
 *   value     the dying value, capped at `max`, at least 1
 *   max       PF2e's dying maximum, doomed already taken off, at least 1
 *   doomed    the doomed value — the last `doomed` of the track is doomed's share
 *   slots     `max + doomed` — the gauge's full length
 *   flatline  `value >= max`
 *
 * Null too when doomed has taken the whole maximum. PF2e clamps dying to its
 * max, so dying cannot be above 0 there, and a reading of max 0 is not a gauge:
 * the initiative tracker draws nothing, and the bar reads the creature as dead
 * instead (readPf2eDead).
 *
 * Any actor type: characters and NPCs share CreaturePF2e's derived data, and a
 * GM who puts dying on an NPC means it.
 */
export function readPf2eDying(actor) {
  const parts = dyingParts(actor);
  if (!parts) return null;
  const { raw, max, doomed } = parts;
  const value = Math.min(Math.round(raw), max);
  if (!(max > 0) || !(value > 0)) return null;

  return { value, max, doomed, slots: max + doomed, flatline: value >= max };
}

/* The raw dying value, doomed, and PF2e's maximum — or null without the condition. */
function dyingParts(actor) {
  if (!actor) return null;
  const derived = actor.system?.attributes?.dying;
  const derivedValue = finite(derived && typeof derived === "object" ? derived.value : null);
  const itemValue = conditionValue(actor, "dying");
  const raw = Math.max(derivedValue ?? 0, itemValue ?? 0);
  if (!(raw > 0)) return null;

  const doomed = doomedOf(actor);
  const derivedMax = finite(derived && typeof derived === "object" ? derived.max : null);
  const fallbackMax = () =>
    (getActorItems(actor).some((i) => getItemSlug(i) === "diehard") ? DYING_DIEHARD_MAX : DYING_BASE_MAX) - doomed;
  return { raw, doomed, max: Math.round(derivedMax ?? fallbackMax()) };
}

/* Whether a Foundry status is on the actor, whichever shape `statuses` arrives in. */
function hasStatus(actor, id) {
  const s = actor?.statuses;
  if (typeof s?.has === "function") return s.has(id);
  return Array.isArray(s) && s.includes(id);
}

/**
 * The creature types PF2e lets die at 0 hit points (`CreaturePF2e#isDead`), less
 * player characters — see readPf2eDead.
 */
const HP_DEATH_TYPES = new Set(["npc", "familiar"]);

/**
 * Whether the creature is dead, for the bar's DEAD. Three ways, any one of which
 * is enough:
 *
 *   - the **dead status** — Foundry's defeated status, which PF2e's own "actors
 *     dead at 0 HP" automation, the combat tracker's defeated toggle and the token
 *     HUD all set;
 *   - **dying at its maximum** (or doomed having taken the whole maximum while
 *     dying): the book's death, which PF2e caps and leaves for the table to mark;
 *   - **0 hit points without dying or unconscious** — PF2e's `CreaturePF2e#isDead`
 *     — for NPCs and familiars only.
 *
 * Not for a player character, and on purpose. PF2e applies damage and *then*
 * adds dying, as two separate document operations, so every PC dropped to 0
 * spends a round trip at 0 HP with no dying yet; read here, every knock-out
 * would start the flatline and take it back. A PC at 0 HP without dying is either
 * that, or stabilised, and neither is dead.
 *
 * `dying` is readPf2eDying's reading, passed in when the caller already has it.
 * `deadStatus` is Foundry's defeated status id, `CONFIG.specialStatusEffects.DEFEATED`
 * — handed in by the caller, because this reader reads no globals.
 */
export function readPf2eDead(actor, dying = readPf2eDying(actor), { deadStatus = "dead" } = {}) {
  if (!actor) return false;
  if (hasStatus(actor, deadStatus)) return true;
  if (dying?.flatline) return true;
  const parts = dying ? null : dyingParts(actor);
  if (parts && !(parts.max > 0)) return true;
  if (!HP_DEATH_TYPES.has(actor.type)) return false;
  const hp = actor.system?.attributes?.hp;
  const max = finite(hp?.max), value = finite(hp?.value);
  if (!(max > 0) || value !== 0) return false;
  return conditionValue(actor, "dying") === null && conditionValue(actor, "unconscious") === null;
}
