/**
 * Spellsprite — custom looks. Pure.
 *
 * A look restyles an effect: which material it draws as (a full reskin, motion
 * included), the hue its ramp is rotated to, a flourish, a pinned take, or off.
 * Layers, least to most specific; each field falls through when unset:
 *
 *   world defaults → GM rule for the spell's slug → the actor's look → the item's look
 *
 * Stored as `flags[SUITE_ID]["fx.look"]` on Items and Actors, and as
 * `fx.rules` (slug → look) in a world setting.
 */

import { FLOURISHES, MATERIALS } from "./constants.mjs";

const FIELDS = ["material", "hue", "flourish", "layout", "off"];

/** A stored look, cleaned. Unknown or blank fields become null (they fall through). */
export function normalizeLook(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const hue = o.hue === "" || o.hue == null ? null : Number(o.hue);
  const layout = o.layout === "" || o.layout == null ? null : Number(o.layout);
  return {
    material: MATERIALS.includes(o.material) ? o.material : null,
    hue: Number.isFinite(hue) ? ((Math.round(hue) % 360) + 360) % 360 : null,
    flourish: FLOURISHES.includes(o.flourish) ? o.flourish : null,
    layout: Number.isInteger(layout) && layout >= 0 && layout <= 2 ? layout : null,
    off: o.off === true ? true : null,
  };
}

export const isEmptyLook = (look) => FIELDS.every((f) => look?.[f] == null);

/** Merge layers, later wins per field. */
export function mergeLooks(...layers) {
  const out = { material: null, hue: null, flourish: null, layout: null, off: null };
  for (const raw of layers) {
    if (!raw) continue;
    const l = normalizeLook(raw);
    for (const f of FIELDS) if (l[f] != null) out[f] = l[f];
  }
  return out;
}

/**
 * Apply a resolved look to a spec. Returns a new spec, or null when the look
 * turns the effect off.
 */
export function applyLook(spec, look) {
  if (!look) return spec;
  if (look.off) return null;
  const next = { ...spec };
  if (look.material) { next.material = look.material; next.accent = null; }
  next.look = { hue: look.hue, flourish: look.flourish, layout: look.layout };
  return next;
}
