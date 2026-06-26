/**
 * GLUniverse Suite — Minimap feature constants.
 *
 * A "map" is an abstract, GM-authored schematic (rooms / connectors / labels /
 * icons / entity markers) rendered as SVG in a fixed logical coordinate space.
 * Per the suite contract everything is namespaced onto SUITE_ID; this feature
 * owns the `mm.` setting/flag prefix and the `glmm-` CSS prefix.
 */

import { SUITE_ID } from "../../core/const.mjs";

export const MODULE_ID = SUITE_ID;
export const FEATURE_ID = "minimap";
export const PREFIX = "mm.";

export const SETTINGS = Object.freeze({
  /** World: { schemaVersion, maps: { [id]: MapDoc }, activeMapId, rev }. The
   *  GM's authoritative + draft data. Players never render from this. */
  maps: "mm.maps",
  /** World: the player-visible snapshot of the active map (hidden elements
   *  stripped). Everyone renders this. null when nothing is published. */
  published: "mm.published",
  /** Client: floating viewer geometry/state (compact + expanded). */
  viewer: "mm.viewerState"
});

/** Logical canvas size (abstract units). Element coordinates live in 0..MAP_W /
 *  0..MAP_H; the SVG viewBox maps this onto whatever pixel size the window is. */
export const MAP_W = 1000;
export const MAP_H = 1000;

/** Default compact / expanded window geometry (per-client, overridable). */
export const VIEWER_COMPACT = Object.freeze({ width: 280, height: 230 });
export const VIEWER_EXPANDED = Object.freeze({ width: 720, height: 600 });

/** Ping anti-spam window, per user. */
export const PING_COOLDOWN_MS = 1200;
/** How long a ping ripple / who-pinged label lives. */
export const PING_TTL_MS = 2600;
/** How long the GM "draw attention" beacon holds before fading. */
export const ATTENTION_TTL_MS = 4200;
/** Broadcast sequence timings (ms). */
export const BROADCAST = Object.freeze({ expand: 460, settle: 240, play: 1500, hold: 900, collapse: 520 });

export const VIEW_MODES = Object.freeze(["shared", "freeform", "follow"]);
export const DEFAULT_VIEW_MODE = "shared";

export const ELEMENT_TYPES = Object.freeze(["room", "connector", "label", "icon", "marker"]);
export const ROOM_SHAPES = Object.freeze(["rect", "ellipse", "polygon"]);

/** Socket message kinds (tagged onto the suite's shared `minimap` channel). */
export const MSG = Object.freeze({
  ping: "ping",
  attention: "attention",
  published: "published", // { mode: "silent" | "broadcast", rev }
  viewport: "viewport",   // shared-mode GM viewport push { pan, zoom, rev }
  activate: "activate",   // { open: bool }
  requestSync: "requestSync"
});

/**
 * Curated colour palette for elements. Derived from the Etched Glass semantic
 * accents (see gl-tokens.css) plus a few extra hues for variety. The first
 * entry is the neutral default.
 */
export const PALETTE = Object.freeze([
  "#6b86d6", // accent (neutral default)
  "#5eeaff", // cyan
  "#5fdb92", // good
  "#37d99a", // mission
  "#ffd24a", // signal
  "#f59e0b", // amber
  "#ff4a52", // hazard
  "#ec4899", // pink
  "#b497ff", // violet
  "#38bdf8", // sky
  "#94a3b8", // slate
  "#f3fbff"  // bright
]);

export const DEFAULT_ELEMENT_COLOR = PALETTE[0];
export const DEFAULT_MARKER_COLOR = "#5eeaff";
export const DEFAULT_ROOM_COLOR = "#6b86d6";

/**
 * Curated, map-relevant Font Awesome glyphs for the icon picker. Power users
 * can still paste any `fa-solid fa-*` class via the freeform field. `key` is the
 * i18n suffix under `GLMM.icon.*`.
 */
export const ICON_CATALOG = Object.freeze([
  { cls: "fa-solid fa-location-dot", key: "point" },
  { cls: "fa-solid fa-door-open", key: "door" },
  { cls: "fa-solid fa-dungeon", key: "gate" },
  { cls: "fa-solid fa-stairs", key: "stairs" },
  { cls: "fa-solid fa-box-archive", key: "chest" },
  { cls: "fa-solid fa-key", key: "key" },
  { cls: "fa-solid fa-lock", key: "lock" },
  { cls: "fa-solid fa-skull", key: "danger" },
  { cls: "fa-solid fa-skull-crossbones", key: "death" },
  { cls: "fa-solid fa-triangle-exclamation", key: "hazard" },
  { cls: "fa-solid fa-bomb", key: "trap" },
  { cls: "fa-solid fa-fire", key: "fire" },
  { cls: "fa-solid fa-fire-flame-curved", key: "torch" },
  { cls: "fa-solid fa-campground", key: "camp" },
  { cls: "fa-solid fa-flag", key: "objective" },
  { cls: "fa-solid fa-star", key: "star" },
  { cls: "fa-solid fa-gem", key: "treasure" },
  { cls: "fa-solid fa-coins", key: "loot" },
  { cls: "fa-solid fa-crown", key: "throne" },
  { cls: "fa-solid fa-monument", key: "altar" },
  { cls: "fa-solid fa-scroll", key: "lore" },
  { cls: "fa-solid fa-book", key: "library" },
  { cls: "fa-solid fa-bed", key: "rest" },
  { cls: "fa-solid fa-shop", key: "shop" },
  { cls: "fa-solid fa-house", key: "home" },
  { cls: "fa-solid fa-chess-rook", key: "tower" },
  { cls: "fa-solid fa-tower-observation", key: "watch" },
  { cls: "fa-solid fa-shield-halved", key: "guard" },
  { cls: "fa-solid fa-khanda", key: "battle" },
  { cls: "fa-solid fa-water", key: "water" },
  { cls: "fa-solid fa-tree", key: "forest" },
  { cls: "fa-solid fa-mountain", key: "mountain" },
  { cls: "fa-solid fa-anchor", key: "harbor" },
  { cls: "fa-solid fa-ship", key: "ship" },
  { cls: "fa-solid fa-bell", key: "alarm" },
  { cls: "fa-solid fa-eye", key: "watcher" },
  { cls: "fa-solid fa-circle-question", key: "unknown" }
]);

/** Generate a stable id. Uses Foundry's helper when present. */
export function makeId(prefix = "el") {
  const rid = foundry?.utils?.randomID?.(12) ?? Math.random().toString(36).slice(2, 14);
  return `${prefix}-${rid}`;
}

/** A sanitised `fa-solid fa-*` class string, or a safe fallback. */
export function safeIconClass(cls) {
  const s = String(cls ?? "").trim();
  return /^fa[-a-z0-9 ]+$/i.test(s) && s.includes("fa-") ? s : "fa-solid fa-location-dot";
}
