/**
 * Performance — identifiers shared by every module of the feature.
 *
 * Pure: imported by `tools/perf-check.mjs` under plain Node.
 */

export const FEATURE_ID = "perf";
export const PREFIX = "perf.";

export const SETTINGS = Object.freeze({
  /** client — the tier this machine asks for (a TIER id or "auto"). */
  tier: "perf.tier",
  /** client — frame-rate target: "display" | "30" | "45" | "60". */
  targetFps: "perf.targetFps",
  /** client — show the measurement overlay. */
  overlay: "perf.overlay",
  /** world — the GM's floor: { max, users: { [id]: { max, capture } } }. */
  floor: "perf.floor",
  /** world — broadcast a preload of the navigation bar's scenes. */
  preload: "perf.preload",
});

export const MENUS = Object.freeze({
  floor: "perf.floorMenu",
  audit: "perf.auditMenu",
});

/** Frame-rate targets offered to a client. "display" is the refresh rate,
 *  capped at 60: a 144 Hz laptop should not strip effects chasing 144. */
export const TARGETS = Object.freeze(["display", "30", "45", "60"]);
export const DISPLAY_CAP = 60;

/**
 * Every switchable intervention. `core: true` marks a wrap of a Foundry method:
 * those are version-gated and integrity-checked (see patches.mjs) and each has a
 * world kill switch plus a per-client one. The rest are runtime values or
 * public-API calls and cannot conflict with anything, but still get switches,
 * because "turn that one off and see" is how a GM isolates a problem.
 *
 * The id is also the i18n key: GLPERF.patch.<id>.name / .hint.
 */
export const PATCHES = Object.freeze([
  { id: "perfMode", core: true },
  { id: "visionThrottle", core: true },
  { id: "appRender", core: true },
  { id: "directoryDebounce", core: true },
  { id: "idleFps", core: false },
  { id: "textureLoad", core: false },
  { id: "chatPrune", core: false },
]);

export const patchWorldKey = (id) => `perf.patch.${id}`;
export const patchClientKey = (id) => `perf.patchLocal.${id}`;

/** The Foundry generations the core patches were read against. Anything else
 *  switches every core patch off with a reason, rather than guessing. */
export const VERIFIED_GENERATIONS = Object.freeze([14]);

/** How many chat messages stay rendered while the log is at the bottom. */
export const CHAT_KEEP = 200;
/** Prune only once this many past the keep, so every message is not a prune. */
export const CHAT_SLACK = 50;

/** Concurrent texture loads during a scene draw. */
export const TEXTURE_CONCURRENCY = 4;

/** How long input has to be absent before the canvas drops to its idle rate. */
export const IDLE_AFTER_MS = 3000;

/** Stillness hold after the last pan/zoom event. */
export const PAN_HOLD_MS = 150;

/** Socket message types. */
export const MSG = Object.freeze({
  request: "request",
  report: "report",
});
