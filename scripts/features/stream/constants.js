import { SUITE_ID } from "../../core/const.mjs";

/** This feature's id within the suite (used for socket tagging, paths, prefixes). */
export const FEATURE_ID = "stream";

/**
 * Settings, flags and keybindings can only be registered under the installed
 * package id, so the old standalone id collapses onto SUITE_ID. Per-feature
 * isolation on that shared namespace is achieved by key-prefixing (see KEY).
 */
export const MODULE_ID = SUITE_ID;

/**
 * Prefix for this feature's keys on the shared SUITE_ID namespace (settings,
 * flags, keybinding action names) so they never collide with sibling features.
 */
export const KEY = key => `stream.${key}`;

/**
 * Namespace for this feature's *internal* `Hooks.callAll`/`Hooks.on` event bus.
 * These are plain string identifiers (not Foundry-registered namespaces), kept
 * distinct so a generic name like `settingsChanged` can't collide with another
 * feature emitting the same on the shared package id.
 */
export const HOOK_NS = "gluniverse-stream";

export const CLASSES = {
  active: "gluniverse-stream-active",
  restore: "gluniverse-stream-restore",
  overlayRoot: "gluniverse-stream-overlay-root",
  chatRoot: "gluniverse-stream-chat-root",
  dialogRoot: "gluniverse-stream-dialog-root",
  blockedUi: "gluniverse-stream-ui-blocked",
  allowedUi: "gluniverse-stream-ui-allowed",
  centeredDialog: "gluniverse-stream-centered-dialog",
  imagePresentation: "gluniverse-stream-image-presentation",
  journalPresentation: "gluniverse-stream-journal-presentation",
  manualCloseDialog: "gluniverse-stream-manual-close-dialog",
  dialogRootInteractive: "gluniverse-stream-dialog-root-interactive"
};

export const FLAGS = {
  trackedTokenIds: "stream.trackedTokenIds",
  sceneCameraOverride: "stream.sceneCameraOverride"
};

export const CAMERA_MODES = {
  manual: "manual",
  scene: "scene",
  trackedToken: "trackedToken",
  party: "party",
  combatants: "combatants",
  activeTurn: "activeTurn"
};

export const SCENE_VIEW_MODES = {
  fitBackground: "fitBackground",
  fillBackground: "fillBackground"
};

export const SCENE_INITIAL_VIEWS = {
  global: "global",
  fillBackground: "fillBackground",
  fitBackground: "fitBackground",
  manual: "manual"
};

export const CHAT_POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right"];

export const DEFAULT_CAMERA_SETTINGS = {
  outOfCombatMode: CAMERA_MODES.scene,
  combatMode: CAMERA_MODES.combatants,
  sceneViewMode: SCENE_VIEW_MODES.fitBackground,
  sceneInitialView: SCENE_INITIAL_VIEWS.fillBackground,
  paddingPercent: 10,
  paddingPercentTop: 10,
  paddingPercentRight: 10,
  paddingPercentBottom: 10,
  paddingPercentLeft: 10,
  paddingGridSpaces: 0,
  paddingGridSpacesTop: 0,
  paddingGridSpacesRight: 0,
  paddingGridSpacesBottom: 0,
  paddingGridSpacesLeft: 0,
  minZoom: 0.5,
  maxZoom: 1.5,
  animationDurationMs: 750,
  excludeDefeated: true
};

export const DEFAULT_CHAT_SETTINGS = {
  position: "top-left",
  offsetX: 0,
  offsetY: 0,
  lifetimeMs: 10000,
  maxVisible: 5
};

export const DEFAULT_DIALOG_SETTINGS = {
  lifetimeMs: 10000
};

export const DEFAULT_UI_RULES = {
  elementRules: {},
  elementZIndex: {},
  selectorRules: []
};

/** Party HUD config. Director-owned, world-scoped, broadcast to the stream client. */
export const DEFAULT_HUD_SETTINGS = {
  enabled: false,
  anchor: "bottom",       // top | bottom | left | right
  align: "center",        // start | center | end
  offsetX: 0,
  offsetY: 0,
  scale: 100,             // percent
  roster: [],             // ordered actor ids
  showResource: true,
  showConditions: true,
  showTempHp: true,
  showAbilities: false
};

export const HUD_ANCHORS = ["top", "bottom", "left", "right"];
export const HUD_ALIGNS = ["start", "center", "end"];

export const SOCKET_TYPES = {
  clientStatus: "clientStatus",
  requestClientStatus: "requestClientStatus",
  command: "command",
  requestSettingSet: "requestSettingSet",
  requestSceneFlagSet: "requestSceneFlagSet",
  requestAutoStartSet: "requestAutoStartSet",
  hudState: "hudState",
  requestHudState: "requestHudState"
};

export const STREAM_COMMANDS = {
  start: "start",
  stop: "stop",
  toggleRestore: "toggleRestore",
  reframe: "reframe"
};

export const CORE_UI_SELECTORS = [
  "#sidebar",
  "#sidebar-tabs",
  "#chat",
  "#chat-log",
  "#chat-form",
  "#chat-message",
  "#chat-controls",
  "#chat-notifications",
  "#controls",
  "#scene-controls",
  "#navigation",
  "#scene-navigation",
  "#nav-toggle",
  "#scene-list",
  "#hotbar",
  "#players",
  "#pause",
  "#menu",
  "#logo",
  "#notifications",
  ".chat-sidebar",
  ".chat-form",
  ".chat-input",
  ".chat-message-input",
  ".scene-control",
  ".scene-controls",
  ".scene-navigation",
  ".scene-nav",
  ".scene-list",
  ".control-tool",
  ".token-hud",
  "#token-hud",
  "#measurement-hud",
  "#tooltip"
];
