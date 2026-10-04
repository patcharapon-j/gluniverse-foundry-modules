/**
 * GLUniverse Stream Roll Cards — settings.
 *
 * Which content types reach the stream, per author, is not here: that is `stream.chatFilter`, owned by
 * the stream client because it gates the cloned-card path too. This feature's former `basicCards` and
 * the per-kind / per-audience rows of `statusUpdates` were folded into it, once, by
 * `migrateLegacyChatFilter`.
 *
 * Two live settings. One was moved out of the stream client on the way in:
 *
 *   `defaultRollArt` → `stream.card.defaultRollArt`
 *
 * The other, `statusUpdates`, is this feature's own: which condition and effect
 * changes become status cards on the stream.
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

import { SUITE_ID, warn } from "../../core/const.mjs";
import { CARDS_PREFIX, DEFAULT_ROLL_ART } from "../stream/constants.js";
import { DEFAULT_CHAT_FILTER, sanitizeChatFilter } from "../stream/chat-filter.mjs";
import { setSetting, settingKey } from "../stream/settings.js";
import { isFocus } from "./framing/focus-math.js";

export const SETTINGS = {
  defaultRollArt: `${CARDS_PREFIX}.defaultRollArt`,
  statusUpdates: `${CARDS_PREFIX}.statusUpdates`,
  /** Legacy: read once by `migrateLegacyChatFilter`, never written, never drawn. */
  basicCards: `${CARDS_PREFIX}.basicCards`
};

/**
 * How status changes reach the stream.
 *
 * Every row is a switch a GM can find, because every row is something a table might not want narrated:
 * a table running a fight full of frightened skeletons does not want every tick of it. The reader
 * consults these before it builds a model, so a row that is off costs nothing at all.
 *
 * *Which* statuses (conditions, effects) for *whose* creatures (player characters, the GM's) is the chat
 * filter's `condition` and `effect` rows. An NPC additionally has to be somewhere a player could see it
 * (see `pf2e/read-status.js`), and no setting can switch that off.
 */
export const DEFAULT_STATUS_UPDATES = Object.freeze({
  enabled: true,
  /** A condition's value moving, e.g. frightened 1 rising to 2 or ticking back down. */
  valueChanges: true,
  /** A condition ending. */
  removals: true,
  /** Of the chat overlay's lifetime. A status is a glance, not a read. */
  lifetimeFactor: 0.6
});

/** The range the panel offers for `lifetimeFactor`. */
export const STATUS_LIFETIME_RANGE = { min: 0.2, max: 1.5, step: 0.05 };

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

  game.settings.register(SUITE_ID, SETTINGS.basicCards, {
    name: game.i18n.localize("GLUNIVERSE_STREAM.settings.basicCards.name"),
    hint: game.i18n.localize("GLUNIVERSE_STREAM.settings.basicCards.hint"),
    scope: "world",
    config: false,
    type: Object,
    // Legacy, registered only so the one-time migration can read what a world stored. The default is
    // empty so an unset world migrates nothing.
    default: {}
  });

  game.settings.register(SUITE_ID, SETTINGS.statusUpdates, {
    name: game.i18n.localize("GLUNIVERSE_STREAM.settings.statusUpdates.name"),
    hint: game.i18n.localize("GLUNIVERSE_STREAM.settings.statusUpdates.hint"),
    scope: "world",
    config: false,
    type: Object,
    default: foundry.utils.deepClone(DEFAULT_STATUS_UPDATES),
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

/** Which status changes the stream draws. */
export function getStatusSettings() {
  return sanitizeStatusUpdates(game.settings.get(SUITE_ID, SETTINGS.statusUpdates));
}

/** GM-only, for the same reason `setDefaultRollArt` is: this feature has no delegated write path. */
export async function setStatusSettings(patch) {
  if (!game.user?.isGM) return getStatusSettings();
  const next = sanitizeStatusUpdates({ ...getStatusSettings(), ...patch });
  await game.settings.set(SUITE_ID, SETTINGS.statusUpdates, next);
  return next;
}

/**
 * Rebuilt from the defaults' keys, so a world that stored a row this feature no longer reads loses it on
 * the next save, and a row it has not stored yet arrives at its default rather than as `undefined` —
 * which every gate in the reader would read as "off", silencing a feature nobody switched off.
 */
export function sanitizeStatusUpdates(value) {
  const source = (value && typeof value === "object") ? value : {};
  const out = {};
  for (const [key, fallback] of Object.entries(DEFAULT_STATUS_UPDATES)) {
    if (typeof fallback === "boolean") out[key] = key in source ? Boolean(source[key]) : fallback;
    else {
      const number = Number(source[key]);
      out[key] = Number.isFinite(number) && number > 0 ? number : fallback;
    }
  }
  out.lifetimeFactor = Math.min(STATUS_LIFETIME_RANGE.max, Math.max(STATUS_LIFETIME_RANGE.min, out.lifetimeFactor));
  return out;
}

/** A framing only means something for the picture it was set on, so it is dropped with the picture. */
export function sanitizeDefaultRollArt(value) {
  const source = (value && typeof value === "object") ? value : {};
  const src = typeof source.src === "string" ? source.src.trim() : "";
  const focus = source.focus;
  return { src, focus: src && isFocus(focus) ? { x: focus.x, y: focus.y, w: focus.w } : null };
}

/**
 * Folds the two retired shapes into `stream.chatFilter`, once.
 *
 * Runs on the active GM only, and only while the world has never stored a chat filter: after that the
 * filter is the GM's own and nothing here may overwrite it. `statusUpdates` is read raw, before its
 * sanitizer drops the four keys that moved, and is left in place — the next save rebuilds it.
 *
 * The old shapes were AND-ed switches (`conditions` and `players`, say); the filter is a matrix, so each
 * cell is the AND of the two switches that used to decide it. A table that changed nothing migrates to
 * exactly the defaults.
 */
export async function migrateLegacyChatFilter() {
  if (!game.user?.isGM || game.users?.activeGM?.id !== game.user.id) return;
  const storage = game.settings.storage?.get?.("world");
  const stored = (key) => storage?.getSetting?.(`${SUITE_ID}.${key}`) ?? null;
  if (stored(settingKey("chatFilter"))) return;
  const basicDoc = stored(SETTINGS.basicCards);
  const statusDoc = stored(SETTINGS.statusUpdates);
  if (!basicDoc && !statusDoc) return;

  const raw = (key) => {
    const value = game.settings.get(SUITE_ID, key);
    return value && typeof value === "object" ? value : {};
  };
  const on = (source, key, fallback = true) => (key in source ? Boolean(source[key]) : fallback);
  const filter = foundry.utils.deepClone(sanitizeChatFilter(DEFAULT_CHAT_FILTER));

  if (basicDoc) {
    const basic = raw(SETTINGS.basicCards);
    const enabled = on(basic, "enabled");
    const rolls = enabled && on(basic, "rolls");
    filter.rows.roll = { player: rolls, gm: rolls };
    for (const [row, key] of [["speech", "speech"], ["emote", "emotes"], ["ooc", "ooc"]]) {
      const shown = enabled && on(basic, key);
      filter.rows[row] = { player: shown, gm: shown && on(basic, "gm") };
    }
  }
  if (statusDoc) {
    const status = raw(SETTINGS.statusUpdates);
    const players = on(status, "players");
    const npcs = on(status, "npcs");
    const conditions = on(status, "conditions");
    const effects = on(status, "effects", false);
    filter.rows.condition = { player: conditions && players, gm: conditions && npcs };
    filter.rows.effect = { player: effects && players, gm: effects && npcs };
  }
  try {
    await setSetting("chatFilter", filter);
  } catch (error) {
    warn("Stream cards: could not migrate the old chat switches into the chat filter", error);
  }
}
