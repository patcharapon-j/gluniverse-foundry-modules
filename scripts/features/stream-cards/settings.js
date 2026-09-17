/**
 * GLUniverse Stream Roll Cards — settings.
 *
 * One setting, moved out of the stream client on the way in:
 *
 *   `defaultRollArt` → `stream.card.defaultRollArt`
 *
 * The prefix nests inside the parent's `stream.` catch-all and is strictly
 * longer, so the catalog — which sorts routing rules longest-first — files it
 * under this feature rather than letting `stream.` swallow it.
 *
 * Moving it is not tidiness. `stream/settings.js` sanitised this value by
 * importing `isFocus` from the roll card's focus maths, which was half of the
 * import cycle the three-way split would otherwise have created. The setting
 * and its sanitiser travel together, and the parent stops reaching into a
 * child.
 *
 * Card *sizing* deliberately stays behind in `stream`'s `chatSettings`: it
 * scales the overlay, which the stream client owns, and applies whether or not
 * anything is drawing roll cards into it.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { CARDS_PREFIX, DEFAULT_ROLL_ART } from "../stream/constants.js";
import { isFocus } from "./framing/focus-math.js";

export const SETTINGS = {
  defaultRollArt: `${CARDS_PREFIX}.defaultRollArt`
};

/**
 * Document flags, scoped to the suite id and prefixed like the settings.
 *
 * Defined here because the standalone module spelled this key in two places — a
 * `FLAG` constant in the framing app and a bare literal in the snapshot reader.
 * Two spellings of one key is how a GM's hand-set framings become invisible to
 * the thing that draws them, with both files looking correct. The migration
 * that carries these forward from the old module reads this same constant.
 */
export const CARD_FLAGS = {
  portraitFocus: `${CARDS_PREFIX}.portraitFocus`
};

export const CARDS_HOOKS = {
  settingsChanged: `${SUITE_ID}.cards.settingsChanged`
};

export function registerSettings() {
  game.settings.register(SUITE_ID, SETTINGS.defaultRollArt, {
    name: game.i18n.localize("GLUNIVERSE_STREAM.settings.defaultRollArt.name"),
    hint: game.i18n.localize("GLUNIVERSE_STREAM.settings.defaultRollArt.hint"),
    scope: "world",
    config: false,
    type: Object,
    default: foundry.utils.deepClone(DEFAULT_ROLL_ART),
    onChange: () => Hooks.callAll(CARDS_HOOKS.settingsChanged)
  });
}

/** The picture and framing a GM roll with no art of its own falls back to. */
export function getDefaultRollArt() {
  return sanitizeDefaultRollArt(game.settings.get(SUITE_ID, SETTINGS.defaultRollArt));
}

/**
 * GM-only. This feature has no delegated write path: the stream client's
 * attested channel carries its own allow-listed keys, and widening it to cover
 * a child's settings would mean the child's rules living in the parent.
 */
export async function setDefaultRollArt(value) {
  if (!game.user?.isGM) return getDefaultRollArt();
  const next = sanitizeDefaultRollArt(value);
  await game.settings.set(SUITE_ID, SETTINGS.defaultRollArt, next);
  return next;
}

/** A framing only means something for the picture it was set on, so it is dropped with the picture. */
export function sanitizeDefaultRollArt(value) {
  const source = (value && typeof value === "object") ? value : {};
  const src = typeof source.src === "string" ? source.src.trim() : "";
  const focus = source.focus;
  return { src, focus: src && isFocus(focus) ? { x: focus.x, y: focus.y, w: focus.w } : null };
}
