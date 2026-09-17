import {
  CAMERA_MODES,
  CARD_SCALE_RANGE,
  DEFAULT_CAMERA_SETTINGS,
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_DIALOG_SETTINGS,
  DEFAULT_UI_RULES,
  HOOKS,
  MODULE_ID,
  PREFIX
} from "./constants.js";
import { canDelegate, isDirectorUser, requestWrite } from "./director-auth.mjs";

/**
 * GLUniverse Stream — settings.
 *
 * Every key is prefixed `stream.` and registered under the suite id. The prefix
 * is not cosmetic: the catalog routes a setting into the Control Center by
 * matching it against the feature's declared `settingPrefix`, and hides every
 * suite setting from Foundry's native sheet. A key whose prefix does not match
 * is hidden *and* unrouted, i.e. reachable only from the console.
 *
 * Three settings the standalone module registered here now belong elsewhere and
 * are deliberately absent:
 *
 *   `targetingSettings`  → `stream-targets`, as `tgt.settings`
 *   `showTargetLines`    → `stream-targets`, as `tgt.showLines`
 *   `defaultRollArt`     → `stream-cards`, as `stream.card.defaultRollArt`
 *
 * Moving `defaultRollArt` out is also what lets this module stop importing the
 * roll card's focus maths, which is half of the import cycle the three-way
 * split would otherwise create.
 *
 * `config: false` throughout: the structured settings are edited in the control
 * panel, which is registered as a settings menu so the Control Center surfaces
 * it as an "Open editor" button. An Object setting with no menu in front of it
 * is a config a GM can only reach from the console.
 */

const SETTINGS = {
  streamUserId: { type: String, default: "", config: false },
  autoStartStreamUserIds: { type: Array, default: [], config: false },
  trustedDirectorUserIds: { type: Array, default: [], config: false },
  cameraSettings: { type: Object, default: DEFAULT_CAMERA_SETTINGS, config: false },
  chatSettings: { type: Object, default: DEFAULT_CHAT_SETTINGS, config: false },
  dialogSettings: { type: Object, default: DEFAULT_DIALOG_SETTINGS, config: false },
  uiRules: { type: Object, default: DEFAULT_UI_RULES, config: false }
};

/** Full key for a short name, e.g. `cameraSettings` → `stream.cameraSettings`. */
export function settingKey(name) {
  return `${PREFIX}${name}`;
}

export function registerSettings() {
  for (const [name, data] of Object.entries(SETTINGS)) {
    const key = settingKey(name);
    game.settings.register(MODULE_ID, key, {
      name: game.i18n.localize(`GLUNIVERSE_STREAM.settings.${name}.name`),
      hint: game.i18n.localize(`GLUNIVERSE_STREAM.settings.${name}.hint`),
      scope: data.scope ?? "world",
      config: data.config,
      type: data.type,
      default: duplicateDefault(data.default),
      onChange: value => Hooks.callAll(HOOKS.settingsChanged, name, sanitizeSetting(name, value))
    });
  }
}

export function getSetting(name) {
  return sanitizeSetting(name, game.settings.get(MODULE_ID, settingKey(name)));
}

/**
 * Write a setting. A GM writes directly; a trusted director's write travels the
 * attested User-document channel in `director-auth.mjs`. Resolves to the value
 * actually stored — on a refusal that is the *unchanged* stored value, so a
 * caller that re-renders from the result cannot show an optimistic edit that
 * never landed.
 */
export async function setSetting(name, value) {
  const key = settingKey(name);
  const sanitized = sanitizeSetting(name, value);
  const ok = await requestWrite(key, sanitized);
  return ok ? sanitized : getSetting(name);
}

export async function updateObjectSetting(name, patch) {
  const next = foundry.utils.mergeObject(getSetting(name) ?? {}, patch, { inplace: false, insertKeys: true, overwrite: true });
  return setSetting(name, next);
}

export function getCameraSettings() {
  return sanitizeCameraSettings(getSetting("cameraSettings"));
}

export function getChatSettings() {
  return sanitizeChatSettings(getSetting("chatSettings"));
}

export function getDialogSettings() {
  return { ...DEFAULT_DIALOG_SETTINGS, ...(getSetting("dialogSettings") ?? {}) };
}

export function getUiRules() {
  const rules = getSetting("uiRules") ?? {};
  return {
    elementRules: rules.elementRules ?? {},
    elementZIndex: rules.elementZIndex ?? {},
    selectorRules: Array.isArray(rules.selectorRules) ? rules.selectorRules : []
  };
}

export function isConfiguredStreamUser(user = game.user) {
  return Boolean(user?.id && getSetting("streamUserId") === user.id);
}

export function isAutoStartStreamUser(user = game.user) {
  return Boolean(user?.id && (getSetting("autoStartStreamUserIds") ?? []).includes(user.id));
}

export { isDirectorUser, canDelegate };

/**
 * True when this client may *change* what it is looking at. Reading the panel
 * and editing it are different questions: a director whose delegated channel
 * Foundry refused still sees the live shot's settings, read-only.
 */
export function canEditDirectorSettings() {
  return isDirectorUser() && canDelegate();
}

/** These two decide who the feature answers to, so they are never delegated. */
export function canEditStreamAdmin() {
  return Boolean(game.user?.isGM);
}

export function sanitizeSetting(name, value) {
  switch (name) {
    case "trustedDirectorUserIds":
    case "autoStartStreamUserIds":
      return Array.isArray(value) ? value.filter(Boolean) : [];
    case "cameraSettings":
      return sanitizeCameraSettings(value);
    case "chatSettings":
      return sanitizeChatSettings(value);
    case "dialogSettings":
      return sanitizeObject(value, DEFAULT_DIALOG_SETTINGS);
    case "uiRules":
      return sanitizeUiRules(value);
    case "streamUserId":
      return typeof value === "string" ? value : "";
    default:
      return value ?? SETTINGS[name]?.default;
  }
}

/**
 * The relay hands us prefixed keys, since that is what it writes. Sanitize by
 * the short name so both routes share one implementation.
 */
export function sanitizeByKey(key, value) {
  return sanitizeSetting(key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key, value);
}

/**
 * Camera settings are rebuilt from the current defaults' keys, so settings the camera no longer reads
 * drop out the next time a Director saves. Older worlds are migrated on the way:
 * - `nonCombatMode`, `mode` and `sceneModeView` became the current mode keys.
 * - Uniform `paddingPercent` / `paddingGridSpaces` became per-side padding.
 * - `spotlightPullback` + `spotlightPullbackFactor` became `travelZoomOut` (1 means off). The old
 *   "Follow ms" and "Zoom-out ms" durations have no speed equivalent, so pan speed starts at default.
 */
function sanitizeCameraSettings(value) {
  const source = (value && typeof value === "object") ? value : {};
  const migrated = { ...source };
  if (!migrated.outOfCombatMode && source.nonCombatMode) migrated.outOfCombatMode = migrateCameraMode(source.nonCombatMode);
  if (!migrated.combatMode && source.mode) migrated.combatMode = source.mode === "combat" ? CAMERA_MODES.combatants : migrateCameraMode(source.mode);
  if (!migrated.sceneViewMode && source.sceneModeView) migrated.sceneViewMode = source.sceneModeView;
  migrateSidePadding(migrated, source, "paddingPercent", 10, ["paddingPercentTop", "paddingPercentRight", "paddingPercentBottom", "paddingPercentLeft"]);
  migrateSidePadding(migrated, source, "paddingGridSpaces", 0, ["paddingGridSpacesTop", "paddingGridSpacesRight", "paddingGridSpacesBottom", "paddingGridSpacesLeft"]);
  if (!Number.isFinite(Number(source.travelZoomOut)) && ("spotlightPullback" in source || "spotlightPullbackFactor" in source)) {
    migrated.travelZoomOut = source.spotlightPullback === false ? 1 : numberOrDefault(source.spotlightPullbackFactor, DEFAULT_CAMERA_SETTINGS.travelZoomOut);
  }
  migrated.travelZoomOut = Math.max(1, numberOrDefault(migrated.travelZoomOut, DEFAULT_CAMERA_SETTINGS.travelZoomOut));
  const panSpeed = Number(migrated.panSpeed);
  migrated.panSpeed = Number.isFinite(panSpeed) && panSpeed > 0 ? panSpeed : DEFAULT_CAMERA_SETTINGS.panSpeed;
  return pickDefaults(migrated, DEFAULT_CAMERA_SETTINGS);
}

/** Roll card scale is clamped to the range the panel offers, so a stray value can't blank the overlay. */
function sanitizeChatSettings(value) {
  const settings = sanitizeObject(value, DEFAULT_CHAT_SETTINGS);
  const scale = Number(settings.cardScale);
  // A blank, missing or zero scale means "unset", not "invisible", so it falls back to the default.
  const wanted = Number.isFinite(scale) && scale > 0 ? scale : DEFAULT_CHAT_SETTINGS.cardScale;
  settings.cardScale = Math.min(CARD_SCALE_RANGE.max, Math.max(CARD_SCALE_RANGE.min, wanted));
  return settings;
}

function migrateSidePadding(migrated, source, uniformKey, uniformDefault, sideKeys) {
  const uniform = numberOrDefault(source[uniformKey], uniformDefault);
  for (const key of sideKeys) migrated[key] = numberOrDefault(source[key], uniform);
}

function pickDefaults(value, defaults) {
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, key in value ? value[key] : fallback]));
}

function numberOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function migrateCameraMode(mode) {
  switch (mode) {
    case "players":
      return CAMERA_MODES.party;
    case "manualTokens":
      return CAMERA_MODES.trackedToken;
    case "combat":
      return CAMERA_MODES.combatants;
    default:
      return Object.values(CAMERA_MODES).includes(mode) ? mode : CAMERA_MODES.scene;
  }
}

function sanitizeObject(value, defaults) {
  return { ...defaults, ...((value && typeof value === "object") ? value : {}) };
}

function sanitizeUiRules(value) {
  const rules = (value && typeof value === "object") ? value : {};
  const elementRules = {};
  for (const [id, action] of Object.entries(rules.elementRules ?? {})) {
    if (["allow", "block", "default"].includes(action)) elementRules[id] = action;
  }
  const elementZIndex = {};
  for (const [id, zIndex] of Object.entries(rules.elementZIndex ?? {})) {
    const number = Number(zIndex);
    if (Number.isFinite(number)) elementZIndex[id] = number;
  }
  const selectorRules = Array.isArray(rules.selectorRules)
    ? rules.selectorRules
      .filter(rule => rule?.selector && ["allow", "block"].includes(rule.action))
      .map(rule => {
        const zIndex = Number(rule.zIndex);
        const { zIndex: _ignored, ...rest } = rule;
        return Number.isFinite(zIndex) ? { ...rest, zIndex } : rest;
      })
    : [];
  return { elementRules, elementZIndex, selectorRules };
}

function duplicateDefault(value) {
  if (foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return JSON.parse(JSON.stringify(value));
}
