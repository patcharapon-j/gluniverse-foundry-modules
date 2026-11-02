/**
 * Diorama — condition icons over the standees.
 *
 * PF2e: the primary condition items (the initiative tracker's own reading:
 * linked children and overridden duplicates are skipped, dying / doomed are
 * the tracker's), with their badge value. Every other system: the actor's
 * temporary effects (status conditions included), icon only.
 *
 * Returns `[{icon, value}]`, de-duplicated by icon, capped so a creature under
 * twenty effects does not grow a tower. In the halo layout (the icons ring the
 * front of the base, as PF2e Effects Halo rings a 2D token) PF2e's own effects
 * that show on the token join the conditions, as they do in 2D.
 */

import { getActorItems, getItemSlug } from "../../../core/pf2e-dying.mjs";
import { isPrimaryCondition, getConditionBadgeValue, COVERED_CONDITION_SLUGS } from "../../initiative/conditions.mjs";

export const MAX_ICONS = 8;
/** The halo has two arcs of room around the base. */
export const MAX_HALO = 12;

/** @param {Array<{icon:string, value:number|null}>} list */
export function dedupeIcons(list, max = MAX_ICONS) {
  const seen = new Set();
  const out = [];
  for (const c of list) {
    if (!c?.icon || seen.has(c.icon)) continue;
    seen.add(c.icon);
    out.push({ icon: String(c.icon), value: Number.isFinite(c.value) ? c.value : null });
    if (out.length >= max) break;
  }
  return out;
}

function pf2eConditions(actor) {
  const out = [];
  for (const item of getActorItems(actor)) {
    if (item?.type !== "condition" || !isPrimaryCondition(item)) continue;
    const slug = getItemSlug(item);
    if (!slug || COVERED_CONDITION_SLUGS.has(slug)) continue;
    out.push({ icon: item.img, value: getConditionBadgeValue(item) });
  }
  return out;
}

function effectIcons(actor) {
  const out = [];
  let effects = [];
  try { effects = Array.from(actor?.temporaryEffects ?? []); } catch { effects = []; }
  for (const e of effects) {
    if (!e || e.disabled) continue;
    out.push({ icon: e.img ?? e.icon, value: null });
  }
  return out;
}

/**
 * PF2e effects that show on the token (`system.tokenIcon.show`), with their
 * badge value. These are what PF2e Effects Halo rings around a token beside the
 * conditions, so the halo layout carries them too.
 */
function pf2eEffects(actor) {
  const out = [];
  for (const item of getActorItems(actor)) {
    if (item?.type !== "effect") continue;
    if (item.system?.tokenIcon?.show === false || item.isExpired) continue;
    const v = Number(item.badge?.value ?? item.system?.badge?.value);
    out.push({ icon: item.img, value: Number.isFinite(v) ? v : null });
  }
  return out;
}

/**
 * @param {Token} token
 * @param {string} systemId
 * @param {{halo?: boolean}} [o]  halo: the ring layout, which has room for effects too
 */
export function conditionsFor(token, systemId, { halo = false } = {}) {
  const actor = token?.actor;
  if (!actor) return [];
  if (systemId !== "pf2e") return dedupeIcons(effectIcons(actor), halo ? MAX_HALO : MAX_ICONS);
  const list = pf2eConditions(actor);
  if (halo) list.push(...pf2eEffects(actor));
  return dedupeIcons(list, halo ? MAX_HALO : MAX_ICONS);
}
