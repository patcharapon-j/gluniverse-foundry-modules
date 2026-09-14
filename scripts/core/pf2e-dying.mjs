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
 * PF2e never kills a creature at its maximum; it caps the value. Neither does
 * this: `flatline` is a reading, not a verdict.
 */

/** The dying maximum before doomed, and with Diehard. Fallback only. */
export const DYING_BASE_MAX = 4;
export const DYING_DIEHARD_MAX = 5;

const finite = (v) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) ? n : null;
};

function itemsOf(actor) {
  const items = actor?.items?.contents ?? actor?.items ?? [];
  try {
    return Array.from(items).map((entry) => (Array.isArray(entry) ? entry[1] : entry)).filter(Boolean);
  } catch {
    return [];
  }
}

function slugOf(item) {
  return String(item?.slug ?? item?.system?.slug ?? "").trim().toLowerCase();
}

/**
 * A valued condition's value, or null when the actor does not carry it. PF2e
 * keeps its conditions in `itemTypes.condition`, which is a handful of items
 * rather than the whole inventory; this runs on every read of every token.
 */
function conditionValue(actor, slug) {
  const pool = Array.isArray(actor?.itemTypes?.condition) ? actor.itemTypes.condition : itemsOf(actor);
  const item = pool.find((i) => i?.type === "condition" && slugOf(i) === slug);
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
 *   value        the dying value, capped at `max`
 *   max          PF2e's dying maximum, doomed already taken off
 *   doomed       the doomed value
 *   slots        `max + doomed` — the gauge's full length
 *   doomedSlots  how many of those, at the right end, doomed has taken
 *   flatline     `value >= max`
 *
 * Any actor type: characters and NPCs share CreaturePF2e's derived data, and a
 * GM who puts dying on an NPC means it.
 */
export function readPf2eDying(actor) {
  if (!actor) return null;
  const derived = actor.system?.attributes?.dying;
  const derivedValue = finite(derived && typeof derived === "object" ? derived.value : null);
  const itemValue = conditionValue(actor, "dying");
  const raw = Math.max(derivedValue ?? 0, itemValue ?? 0);
  if (!(raw > 0)) return null;

  const doomed = doomedOf(actor);
  const derivedMax = finite(derived && typeof derived === "object" ? derived.max : null);
  const fallbackMax = () =>
    (itemsOf(actor).some((i) => slugOf(i) === "diehard") ? DYING_DIEHARD_MAX : DYING_BASE_MAX) - doomed;
  const max = Math.max(0, Math.round(derivedMax ?? fallbackMax()));
  const value = Math.min(Math.round(raw), max);

  return { value, max, doomed, slots: max + doomed, doomedSlots: doomed, flatline: value >= max };
}
