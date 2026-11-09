/**
 * PF2e HUD — every press handle the host answers. Pure, so the check tool
 * holds it to what the view draws (view.mjs HANDLES and the markup of every
 * state) without loading the host, which needs Foundry.
 *
 * `attrs` by attribute; `acts` the values of data-act; `drawers` the values
 * of data-drawer (and the drawers the host opens itself). data-row prefixes
 * and data-pa values are peeks.mjs ROW_KEYS and PEEK_PRESSES.
 */
export const PRESSES = Object.freeze({
  attrs: ["data-act", "data-hero", "data-pip", "data-check", "data-strike", "data-variant", "data-dmg", "data-crit", "data-toggle", "data-stance",
    "data-action", "data-spell", "data-rank-step", "data-tab", "data-item", "data-skill-action", "data-find", "data-explore", "data-drawer", "data-row",
    "data-seat", "data-foe", "data-pa", "data-reload"],
  acts: ["fold", "close", "frame", "raise", "expand", "finder", "ranks", "peek-strike", "expand-col", "explore", "sheet"],
  drawers: ["rest", "macros", "sheet", "effects", "inventory", "strikes", "foes", "ranks", "explore"],
});
