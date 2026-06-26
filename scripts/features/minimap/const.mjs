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

/** Nominal canvas size (abstract units). The canvas is *endless*: element
 *  coordinates are unbounded (a map can be square, wide or tall, growing to fit
 *  whatever the GM draws). MAP_W/MAP_H are only the starting frame for an empty
 *  map and the fallback extent when nothing has been placed yet. */
export const MAP_W = 1000;
export const MAP_H = 1000;

/** Camera scale (pixels per logical unit) clamp. zoom is now a true scale, not a
 *  fit-multiplier, so the same model serves square / long / tall maps. */
export const SCALE_MIN = 0.02;
export const SCALE_MAX = 7;

/** Default compact / expanded window geometry (per-client, overridable). Tuned
 *  tight so the player dock keeps a small, unobtrusive footprint. */
export const VIEWER_COMPACT = Object.freeze({ width: 248, height: 206 });
export const VIEWER_EXPANDED = Object.freeze({ width: 680, height: 560 });

/** Ping anti-spam window, per user. */
export const PING_COOLDOWN_MS = 1200;
/** How long a ping ripple / who-pinged label lives. */
export const PING_TTL_MS = 2800;
/** How long the GM "draw attention" beacon holds before fading. */
export const ATTENTION_TTL_MS = 4600;
/** Broadcast sequence timings (ms). Lengthened + eased for a smoother, less
 *  snappy reveal (see styles/minimap.css for the matching CSS durations). */
export const BROADCAST = Object.freeze({ expand: 640, settle: 460, play: 1600, hold: 1200, collapse: 720 });

/** Broadcast presentation styles. `prominent` expands the player window to the
 *  centre of the screen, frames the change, holds, then collapses. `normal`
 *  plays the same diff tweening *in place* without moving or expanding the
 *  window — a quieter nudge. */
export const BROADCAST_STYLES = Object.freeze(["prominent", "normal"]);
export const DEFAULT_BROADCAST_STYLE = "prominent";

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
/** A party marker (the whole group) reads in the warm signal hue so it stands
 *  apart from the cool, per-user member dots. */
export const DEFAULT_PARTY_COLOR = "#ffd24a";

/** Marker kinds. `member` is the per-user/PC dot (optionally user-bound);
 *  `party` is a single badge standing in for the entire party. */
export const MARKER_KINDS = Object.freeze(["member", "party"]);
/** Glyph used for the party badge. */
export const PARTY_GLYPH = "fa-solid fa-people-group";

/** Glyph alphabet for the per-character "decoder" text reveal. */
export const SCRAMBLE_GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&/\\<>*+=≡∴⟡◊";

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
