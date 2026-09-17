/**
 * GLUniverse Stream — constants, shared by the three features ported out of the
 * standalone `gluniverse-stream` module.
 *
 *   `stream`          this feature — the stream client.
 *   `stream-cards`    PF2e roll cards; nests under `stream.card`.
 *   `stream-targets`  combat targeting arcs; a sibling under `tgt.`.
 *
 * The children import from here rather than keeping copies. That is a
 * feature→feature import, which the contract allows because this module has no
 * import-time side effects — `requiresFeature` governs whether a feature *runs*,
 * not whether its modules resolve. `stream` never imports the other two: the
 * chat overlay reaches roll cards through a renderer slot they fill, so there is
 * no cycle.
 */

import { SUITE_ID } from "../../core/const.mjs";

/**
 * Foundry only lets a package register settings, flags and sockets under its own
 * id, so all three features namespace onto the suite and isolate by key prefix.
 * Kept under the old name so the ported call sites read unchanged.
 */
export const MODULE_ID = SUITE_ID;

export const FEATURE_ID = "stream";
export const PREFIX = "stream.";

/** Strictly longer than PREFIX: the catalog sorts longest-first, so the child
 *  claims its own keys before the parent's catch-all can swallow them. */
export const CARDS_FEATURE_ID = "stream-cards";
export const CARDS_PREFIX = "stream.card";

/** Not nested — targeting lines are configurable with `stream` disabled. */
export const TARGETS_FEATURE_ID = "stream-targets";
export const TARGETS_PREFIX = "tgt.";

/**
 * The feature's own Foundry hooks.
 *
 * Every hook name has to carry the feature in it. The standalone module could
 * call a hook HOOKS.settingsChanged because `MODULE_ID` was its own id;
 * here `MODULE_ID` is the whole suite, so an unnamespaced name is a hook any of
 * the other twenty-odd features could raise or answer by accident.
 *
 * They are built in one place because the emitter and the listener drifting
 * apart is silent: the camera simply stops reframing, the overlays stop
 * noticing stream mode, and every frame still renders perfectly.
 */
const hook = (name) => `${MODULE_ID}.stream.${name}`;
export const HOOKS = {
  streamModeChanged: hook("streamModeChanged"),
  restoreToggled: hook("restoreToggled"),
  settingsChanged: hook("settingsChanged"),
  trackedTokensChanged: hook("trackedTokensChanged"),
  clientStatus: hook("clientStatus"),
  uiDetectedChanged: hook("uiDetectedChanged")
};

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

/**
 * Document flags are scoped to the suite id, so every key carries the feature's
 * prefix the same way settings do. `stream-cards` owns `stream.card.*` flags.
 */
export const FLAGS = {
  trackedTokenIds: "stream.trackedTokenIds"
};

export const CAMERA_MODES = {
  manual: "manual",
  scene: "scene",
  trackedToken: "trackedToken",
  party: "party",
  combatants: "combatants",
  activeTurn: "activeTurn",
  spotlight: "spotlight"
};

export const SCENE_VIEW_MODES = {
  fitBackground: "fitBackground",
  fillBackground: "fillBackground"
};

export const CHAT_POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right"];

export const DEFAULT_CAMERA_SETTINGS = {
  outOfCombatMode: CAMERA_MODES.scene,
  combatMode: CAMERA_MODES.combatants,
  sceneViewMode: SCENE_VIEW_MODES.fitBackground,
  paddingPercentTop: 10,
  paddingPercentRight: 10,
  paddingPercentBottom: 10,
  paddingPercentLeft: 10,
  paddingGridSpacesTop: 0,
  paddingGridSpacesRight: 0,
  paddingGridSpacesBottom: 0,
  paddingGridSpacesLeft: 0,
  minZoom: 0.5,
  maxZoom: 1.5,
  /** Grid squares per second. */
  panSpeed: 12,
  excludeDefeated: true,
  includeTargets: true,
  spotlightZoom: 1,
  /** Spotlight only: how far a flight zooms out at most. 1 turns flights off. */
  travelZoomOut: 2,
  spotlightPlayersOnly: false
};

export const DEFAULT_CHAT_SETTINGS = {
  position: "top-left",
  offsetX: 0,
  offsetY: 0,
  lifetimeMs: 10000,
  maxVisible: 5,
  /** PF2e roll cards: critical success and critical failure cards stay up this many times longer. */
  critLifetimeMultiplier: 1.5,
  /**
   * PF2e roll cards: how big the card is, on top of the scale that matches the stream's width to the
   * 1920px design frame. 1 is the size the mockup was drawn at, which overpowers most stream layouts.
   */
  cardScale: 0.5
};

/**
 * The picture a GM's own roll cards fall back to. A GM roll with no art of its own — a plain roll with
 * no token, or a creature still on a default icon — shows this instead of the monogram. `focus` is the
 * GM's framing for that picture (`{x, y, w}` in image widths); null frames it automatically.
 */
export const DEFAULT_ROLL_ART = {
  src: "",
  focus: null
};

/** The range the Director can drag `chatSettings.cardScale` across. */
export const CARD_SCALE_RANGE = { min: 0.15, max: 3, step: 0.05 };

export const DEFAULT_DIALOG_SETTINGS = {
  lifetimeMs: 10000
};

export const TARGET_LINE_VISIBILITY = {
  everyone: "everyone",
  gmAndStream: "gmAndStream",
  streamOnly: "streamOnly"
};

export const DEFAULT_TARGETING_SETTINGS = {
  enabled: true,
  visibility: TARGET_LINE_VISIBILITY.everyone,
  colorFriendlyToHostile: "#4db8ff",
  colorHostileToFriendly: "#ff4a5c",
  colorSameSide: "#52f5a0",
  colorOther: "#ffd35c",
  /** Line width and glow multiplier, 0.25 to 2. */
  intensity: 1
};

/**
 * Every targeting line duration, in milliseconds. `TargetLine` animates with these and the controller
 * schedules turn hand-offs from them, so the two cannot drift apart.
 */
export const TARGET_LINE_MOTION = {
  /** Launch: the body reaching out from the source at full length; the head lands over its last stretch. */
  launchMs: 600,
  /** Launch: the reticle pops in from wide once the launch is this far along... */
  reticlePopDelayMs: 180,
  /** ...and settles over this long, landing with the line. */
  reticlePopMs: 420,
  /** A reticle whose target is gone collapses outwards over this long. */
  reticleCollapseMs: 220,
  /** Retract: the body drawing back into the source from full length. */
  retractMs: 360,
  /** Retract: the head fades out within the first 15% of it, so it never trails a withdrawing body. */
  headFadeOutMs: 54,
  /** Hand-off: the pause, body absent and reticle dimmed, between the retract and the relaunch. */
  handoffBeatMs: 140,
  /** Hand-off: a hairline ring sinks into the old source over the end of the retract... */
  originSinkMs: 200,
  /** ...and rises out of the new one at the start of the relaunch. */
  originRiseMs: 240,
  /** Calm motion replaces launch and retract with plain fades. */
  calmFadeInMs: 420,
  calmFadeOutMs: 320,
  calmHandoffBeatMs: 180,
  /** Hold loops (never in calm motion): the light sweep, the glow's breathing and the reticle's turn. */
  sweepPeriodMs: 1600,
  pulsePeriodMs: 1400,
  spinPeriodMs: 6000
};

export const DEFAULT_UI_RULES = {
  elementRules: {},
  elementZIndex: {},
  selectorRules: []
};

export const SOCKET_TYPES = {
  clientStatus: "clientStatus",
  requestClientStatus: "requestClientStatus",
  command: "command"
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
