/**
 * GLUniverse Targeting Lines — settings.
 *
 * This feature is a **sibling** of `stream`, not a child. The arcs draw on every
 * client that can see both tokens, so a table with no capture login still wants
 * them — which means the feature has to be configurable with `stream` disabled,
 * and therefore owns its settings under its own prefix rather than living in
 * the stream client's control panel.
 *
 * Two settings, renamed on the way in so each reads correctly under `tgt.`:
 *
 *   `targetingSettings` → `tgt.settings`   (world; the arcs' whole config)
 *   `showTargetLines`   → `tgt.showLines`  (client; a player hiding them)
 *
 * `tgt.showLines` is the one setting here a player is meant to reach. The
 * catalog hides every suite setting from Foundry's native sheet, but the
 * Control Center is registered unrestricted and shows a non-GM their
 * client-scoped settings, so that is where a player finds it.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { Suite } from "../../core/registry.mjs";
import {
  DEFAULT_TARGETING_SETTINGS,
  TARGET_LINE_VISIBILITY,
  TARGETS_PREFIX as PREFIX,
  FEATURE_ID as STREAM_FEATURE_ID
} from "../stream/constants.js";

export const SETTINGS = {
  settings: `${PREFIX}settings`,
  showLines: `${PREFIX}showLines`
};

/**
 * This feature's own hooks, built in one place for the same reason `stream`'s
 * are: an emitter and a listener drifting apart stops the arcs refreshing while
 * every frame still draws correctly.
 */
export const TARGETS_HOOKS = {
  settingsChanged: `${SUITE_ID}.targets.settingsChanged`
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const COLOR_KEYS = ["colorFriendlyToHostile", "colorHostileToFriendly", "colorSameSide", "colorOther"];

export function registerSettings() {
  game.settings.register(SUITE_ID, SETTINGS.settings, {
    name: game.i18n.localize("GLUNIVERSE_STREAM.settings.targetingSettings.name"),
    hint: game.i18n.localize("GLUNIVERSE_STREAM.settings.targetingSettings.hint"),
    scope: "world",
    config: false,
    type: Object,
    default: foundry.utils.deepClone(DEFAULT_TARGETING_SETTINGS),
    onChange: () => Hooks.callAll(TARGETS_HOOKS.settingsChanged)
  });

  game.settings.register(SUITE_ID, SETTINGS.showLines, {
    name: game.i18n.localize("GLUNIVERSE_STREAM.settings.showTargetLines.name"),
    hint: game.i18n.localize("GLUNIVERSE_STREAM.settings.showTargetLines.hint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => Hooks.callAll(TARGETS_HOOKS.settingsChanged)
  });
}

/** True when the stream client exists to be a visibility audience at all. */
export function streamFeatureActive() {
  try {
    return Suite.enabled(STREAM_FEATURE_ID);
  } catch {
    return false;
  }
}

/**
 * The visibility choices this world can actually offer.
 *
 * Two of the three name a stream client. With `stream` disabled there is no
 * such client, so those options are **absent** rather than present-and-inert —
 * an option that silently means "nobody" is worse than one that is not there.
 * A world that already stored one falls back to `everyone` on read, so turning
 * `stream` off does not blank the arcs.
 */
export function visibilityChoices() {
  return streamFeatureActive()
    ? [TARGET_LINE_VISIBILITY.everyone, TARGET_LINE_VISIBILITY.gmAndStream, TARGET_LINE_VISIBILITY.streamOnly]
    : [TARGET_LINE_VISIBILITY.everyone];
}

export function getTargetingSettings() {
  return sanitize(game.settings.get(SUITE_ID, SETTINGS.settings));
}

export function getShowLines() {
  return game.settings.get(SUITE_ID, SETTINGS.showLines) !== false;
}

/** GM-only: this feature has no delegated write path of its own. */
export async function setTargetingSettings(patch) {
  if (!game.user?.isGM) return getTargetingSettings();
  const next = sanitize({ ...getTargetingSettings(), ...patch });
  await game.settings.set(SUITE_ID, SETTINGS.settings, next);
  return next;
}

export function sanitize(value) {
  const source = (value && typeof value === "object") ? value : {};
  const settings = Object.fromEntries(
    Object.entries(DEFAULT_TARGETING_SETTINGS).map(([k, fallback]) => [k, k in source ? source[k] : fallback])
  );
  settings.enabled = settings.enabled !== false;

  // A stored stream-only visibility is kept as data but falls back on read when
  // `stream` is off, so toggling that feature never blanks the arcs.
  if (!Object.values(TARGET_LINE_VISIBILITY).includes(settings.visibility)) {
    settings.visibility = DEFAULT_TARGETING_SETTINGS.visibility;
  }
  if (!visibilityChoices().includes(settings.visibility)) {
    settings.visibility = TARGET_LINE_VISIBILITY.everyone;
  }

  for (const key of COLOR_KEYS) {
    if (!HEX_COLOR.test(String(settings[key]))) settings[key] = DEFAULT_TARGETING_SETTINGS[key];
  }
  const intensity = Number(settings.intensity);
  settings.intensity = Math.min(2, Math.max(0.25, Number.isFinite(intensity) ? intensity : DEFAULT_TARGETING_SETTINGS.intensity));
  return settings;
}
