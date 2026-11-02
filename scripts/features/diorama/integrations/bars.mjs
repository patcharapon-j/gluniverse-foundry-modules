/**
 * Diorama — resource bars on the standees, by Foundry's own visibility rule.
 *
 * Foundry decides `token.bars.visible` as `!isSecret && actor && _canViewMode(
 * document.displayBars)`, and `_canViewMode` reads the 2D canvas's hover. In
 * 3D the 2D hover never happens, so the same rule is restated here against the
 * view's own hover (`canViewMode`, pure). The same rule decides the name.
 *
 * Bar colours are Foundry's own (Token#_drawBar): data, not theme.
 */

/** CONST.TOKEN_DISPLAY_MODES, with the v14 numbers as the fallback. */
export const DISPLAY = Object.freeze({ NONE: 0, CONTROL: 10, OWNER_HOVER: 20, HOVER: 30, OWNER: 40, ALWAYS: 50 });

const modes = () => globalThis.CONST?.TOKEN_DISPLAY_MODES ?? DISPLAY;

/**
 * Foundry's `Token#_canViewMode`, against the 3D view's hover.
 * @param {number} mode
 * @param {{controlled?:boolean, hovered?:boolean, isOwner?:boolean}} s
 */
export function canViewMode(mode, { controlled = false, hovered = false, isOwner = false } = {}) {
  const M = modes();
  switch (Number(mode)) {
    case M.NONE: return false;
    case M.ALWAYS: return true;
    case M.CONTROL: return !!controlled;
    case M.HOVER: return !!hovered;
    case M.OWNER_HOVER: return !!isOwner && !!hovered;
    case M.OWNER: return !!isOwner;
    default: return false;
  }
}

/**
 * One bar from a `getBarAttribute` result, or null for a value-only attribute.
 * @param {{type:string, value:number, max:number}|null} attr
 * @param {number} index  0 = bar1, 1 = bar2
 * @returns {{frac:number, color:string}|null}
 */
export function barFrom(attr, index) {
  if (!attr || attr.type !== "bar") return null;
  const max = Number(attr.max);
  const value = Number(attr.value);
  if (!(max > 0) || !Number.isFinite(value)) return null;
  const pct = Math.max(0, Math.min(max, value)) / max;
  const rgb = index === 0 ? [1 - pct / 2, pct, 0] : [0.5 * pct, 0.7 * pct, 0.5 + pct / 2];
  const c = rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
  return { frac: pct, color: `rgb(${c[0]}, ${c[1]}, ${c[2]})` };
}

/**
 * Bars a viewer may see on a token, by the token's own display mode.
 * @param {Token} token
 * @param {{hovered:boolean, isSecret:boolean}} s
 */
export function barsFor(token, { hovered = false, isSecret = false } = {}) {
  const doc = token?.document;
  if (!doc || !token.actor || isSecret) return [];
  if (!canViewMode(doc.displayBars, { controlled: !!token.controlled, hovered, isOwner: !!doc.isOwner })) return [];
  const out = [];
  ["bar1", "bar2"].forEach((name, i) => {
    let attr = null;
    try { attr = doc.getBarAttribute?.(name) ?? null; } catch { attr = null; }
    const b = barFrom(attr, i);
    if (b) out.push(b);
  });
  return out;
}
