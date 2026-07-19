/** Shared constants for GLUniverse — Clocks & Tracker. */

/**
 * Ported into the GLUniverse Suite. The Foundry package id is the single suite
 * id (`gluniverse-foundry-modules`) used as the settings namespace and flag scope. Per-
 * feature isolation is achieved by key-prefixing: every setting key this feature
 * owns is prefixed with `ct.` (already baked into the SETTINGS map below), and
 * every document / chat-message flag sub-key is prefixed with FLAG_NS (`ct`).
 */
export const MODULE_ID = "gluniverse-foundry-modules";
export const FEATURE_ID = "clocks-tracker";
/** Per-feature flag sub-key prefix (flags live under flags[MODULE_ID].ct.*). */
export const FLAG_NS = "ct";

/** Namespaced hooks other modules / macros can listen to. */
export const HOOKS = {
  /** Fired (callAll) after the HUD recomputes state: (state) => void */
  timeChanged: `${MODULE_ID}.timeChanged`,
  /** Fired when the active calendar definition changes: (config) => void */
  calendarChanged: `${MODULE_ID}.calendarChanged`,
  /** Fired when events/holidays are edited: (events) => void */
  eventsChanged: `${MODULE_ID}.eventsChanged`,
  /** Fired when trackers are created/edited/reordered/deleted: (trackers) => void */
  trackersChanged: `${MODULE_ID}.trackersChanged`,
  /** Fired (callAll) after the weather walk advances/rewinds/resets: (payload) => void */
  weatherChanged: `${MODULE_ID}.weatherChanged`,
  /** Fired (callAll) after the support roster / active / pool state changes: (payload) => void */
  supportsChanged: `${MODULE_ID}.supportsChanged`,
  /** Fired (callAll) after the delving config / live turn state changes: (payload) => void */
  delvingChanged: `${MODULE_ID}.delvingChanged`
};

/**
 * World/client-setting keys. Every key is prefixed with `ct.` so this feature's
 * settings stay isolated from the rest of the suite under the shared
 * `gluniverse-foundry-modules` namespace. NOTE: `ct.moduleConfig` is THIS feature's own
 * internal feature-tree blob (see features.js) — distinct from the suite core's
 * own `moduleConfig` setting registered under the same package id.
 */
export const SETTINGS = {
  moduleConfig: "ct.moduleConfig",    // Object (world): enable/disable map for every module + sub-module (see features.js)
  calendarId: "ct.calendarId",        // String: which preset/custom calendar is active
  calendarConfig: "ct.calendarConfig",// Object: the stored CalendarConfig (custom edits)
  events: "ct.events",                // Array: events & holidays
  shiftNames: "ct.shiftNames",        // Array<string>: customizable watch names
  shiftLevelMode: "ct.shiftLevelMode",// Boolean (world): track/display at shift granularity only
  mission: "ct.mission",              // Object (world): {active,target,label} stretch-countdown to a target time
  hudCollapsed: "ct.hudCollapsed",    // Boolean (client)
  hudPosition: "ct.hudPosition",      // Object {top,cx} centre-anchored (client; legacy {top,left} migrated)
  hudGlitch: "ct.hudGlitch",          // Boolean (world): "temporal distortion" — corrupt the HUD readout for an uncertain when/where scene
  hudVisibleToPlayers: "ct.hudVisibleToPlayers", // Boolean (world): GM show/hide the time HUD for players
  sceneTint: "ct.sceneTint",          // Boolean: tint canvas with the active shift
  yearLabel: "ct.yearLabel",          // String: era suffix shown after the year, e.g. "AR"
  trackers: "ct.trackers",            // Array: GM-managed tracker definitions (world)
  trackerHudPosition: "ct.trackerHudPosition", // Object {top,left} (client)
  trackerHudHidden: "ct.trackerHudHidden",     // Boolean (client): dock hidden on this screen
  trackerHudCompact: "ct.trackerHudCompact",   // Boolean (client): dock collapsed to playing-card minis
  sheetTrackersEnabled: "ct.sheetTrackersEnabled", // Boolean (world): PF2e per-PC private trackers tab (default off)

  // ---- Weather (Hex Flower Game Engine) ----
  weatherEnabled: "ct.weatherEnabled",                   // Boolean (world): master opt-in (default false)
  weather: "ct.weather",                                 // Object (world): full config + live walk state (§4.5)
  weatherCadenceMode: "ct.weatherCadenceMode",           // String (world): "auto" | "manual"
  weatherCadencePeriod: "ct.weatherCadencePeriod",       // String (world): "day" | "days:N" | "shift"
  weatherPlayerFlowerVisible: "ct.weatherPlayerFlowerVisible", // Boolean (world): reveal the flower to players
  weatherShowDice: "ct.weatherShowDice",                 // Boolean (world): animate Dice So Nice 3D dice on weather rolls
  weatherCardVisibility: "ct.weatherCardVisibility",     // String (world): "public" | "gm" — who sees the weather-change chat card
  weatherHudPosition: "ct.weatherHudPosition",           // Object (client): Hex Flower window position
  weatherHudHidden: "ct.weatherHudHidden",               // Boolean (client): window hidden on this screen

  // ---- Mission Support (Support NPC roster + Comms-Coin HUD) ----
  supportEnabled: "ct.supportEnabled",                   // Boolean (world): master opt-in (default false)
  supports: "ct.supports",                               // Object (world): { roster:[], activeId, schemaVersion }
  supportHudVisibleToPlayers: "ct.supportHudVisibleToPlayers", // Boolean (world): GM show/hide the coin for players (off-mission)
  supportHudPosition: "ct.supportHudPosition",           // Object (client): Comms-Coin window position
  supportHudHidden: "ct.supportHudHidden",               // Boolean (client): coin hidden on this screen
  supportPassiveTokenIcon: "ct.supportPassiveTokenIcon", // Boolean (world): show the passive effect icon on PC tokens

  // ---- Delving Mode (turn-driven dungeon delve: time still advances, the clock
  //      readout steps aside for a turn counter + degrading delving-resource HUD) ----
  delvingEnabled: "ct.delvingEnabled",                   // Boolean (world): master opt-in (default false)
  delving: "ct.delving"                                  // Object (world): full config + live delve state (§ delving-store)
};

/** The tracker types the dock can render. */
export const TRACKER_TYPES = ["point", "clock", "pool", "task", "hazard", "separator"];

/**
 * The four daily watches (YZE shifts), chronological from midnight.
 * Names are defaults; the GM may override them via the shiftNames setting.
 * Colours drive the per-shift HUD theming (CSS custom properties).
 */
export const WATCHES = [
  { key: "night", tint: "#6b86d6", tint2: "#1a2233", glow: "rgba(120,150,225,.5)", soft: "rgba(120,150,225,.18)" },
  { key: "dawn",  tint: "#e0a368", tint2: "#2f2316", glow: "rgba(230,170,100,.5)", soft: "rgba(230,170,100,.18)" },
  { key: "day",   tint: "#6fb8d8", tint2: "#162a36", glow: "rgba(110,184,216,.5)", soft: "rgba(110,184,216,.18)" },
  { key: "dusk",  tint: "#b884d0", tint2: "#241430", glow: "rgba(184,132,208,.5)", soft: "rgba(184,132,208,.18)" }
];

/** Default watch display names (overridable per world). */
export const DEFAULT_SHIFT_NAMES = ["Night Watch", "Dawn Watch", "Day Watch", "Dusk Watch"];

/** Step names usable by GM controls / keybindings. */
export const STEPS = ["stretch", "hour", "shift", "day"];

/* ============================================================
   Weather — Hex Flower Game Engine constants.
   The flower is a fixed 19-hex topology (see weather/hex-geometry.js).
   Weather outcomes are a composable "motion archetype × style (tints)";
   shipped "kinds" are named archetype+tint presets (see weather/presets.js).
   ============================================================ */

/** The 6 hex-face directions, clockwise from the top (matches HEX_LAYOUT). */
export const WEATHER_DIRECTIONS = ["up", "upperRight", "lowerRight", "down", "lowerLeft", "upperLeft"];

/**
 * Pixi motion archetypes the effects engine implements. Originally weather-only
 * (decision #8, §4.6); now a SHARED effect registry consumed by weather AND the
 * delving-resource HUD (and any future feature), so the library spans far more
 * than weather. The first nine are the original weather set; the rest are the
 * curated "delving + atmosphere" batch (shadow closing in, creeping rot, spores,
 * miasma, signal static, swarms, drips, depth bubbles, runes, void, dust, rising
 * ripples). Each is still just "motion archetype × two tints × drift" — the new
 * looks are texture/blend/motion remaps, no per-effect bespoke code.
 */
export const WEATHER_ARCHETYPES = [
  "clear", "streaks", "flakes", "volume", "flashes", "motes", "embers", "gusts", "shards",
  // ---- expanded shared batch ----
  "shadow", "creep", "spores", "miasma", "static", "swarm", "drips", "bubbles", "runes", "void", "dust", "ripples"
];

/** Alias: the archetype list is no longer weather-specific. Prefer this name in new code. */
export const EFFECT_ARCHETYPES = WEATHER_ARCHETYPES;

/** Drift directions an archetype may honour. */
export const WEATHER_DRIFTS = ["fall", "rise", "left", "right", "still"];

/** Supported Navigation-Hex dice systems (extensible). */
export const WEATHER_DICE = ["2d6", "d6+d8"];

/** Number of history steps retained on the walk (decision #4). */
export const WEATHER_HISTORY_CAP = 60;

/** Maximum auto-steps executed for one big time skip (decision #3). */
export const WEATHER_STEP_CAP = 60;

/* ============================================================
   Mission Support System — Support NPC roster + Comms-Coin HUD.
   A support is a party asset (not bound to one PC). One is "active"
   per mission. Abilities are PF2e-aware cards whose numbers are
   computed from the GM-entered level via creature-building benchmarks.
   ============================================================ */

/** The four ability slots every support shares (see the design doc's template). */
export const SUPPORT_ABILITY_KINDS = ["passive", "radio", "fieldCombat", "fieldExplore"];

/** Which ability kinds spend the availability pool when invoked (Field Calls). */
export const SUPPORT_BURN_KINDS = ["fieldCombat", "fieldExplore"];

/** Kinds sharing ONE 1/round action lock (the support's combat action economy):
 *  firing either the Free radio or the 1-action field call consumes the round for
 *  both. Only enforced while in combat; Exploration + Passive are exempt. */
export const SUPPORT_ROUND_LIMITED_KINDS = ["radio", "fieldCombat"];

/** Faction track (0–5) → availability-pool dice modifier (design doc table). */
export const SUPPORT_FACTION_MOD = { 0: -1, 1: -1, 2: 0, 3: 0, 4: 1, 5: 2 };

/** PF2e creature-building proficiency tiers, strongest → weakest. */
export const SUPPORT_TIERS = ["extreme", "high", "moderate", "low", "terrible"];

/**
 * The stat kinds an ability's numbers can be derived from, mapped to which
 * benchmark table column resolves them (see support/benchmarks.js).
 */
export const SUPPORT_STAT_TYPES = {
  attack: "strikeAttack",   // strike attack bonus
  damage: "strikeDamage",   // strike damage expression (dice)
  spellAttack: "spellAttack",
  dc: "spellDC",            // spell / class / effect DC
  ac: "ac",
  save: "save",             // Fort/Ref/Will
  skill: "skill",
  perception: "perception"
};

/** Caps for the roster (defensive — a table is never going to need more). */
export const SUPPORT_LEVEL_RANGE = { min: -1, max: 25 };
export const SUPPORT_POOL_RANGE = { min: 1, max: 20 };

/* ============================================================
   Delving Mode — a turn-driven mode of play. Tracking exact time is still
   needed (game.time keeps advancing, so effects expire and weather walks), but
   the wall-clock reading is irrelevant: only the PASSAGE of time matters. The
   GM presses a button to pass a "turn" (a configurable span of time); each turn
   rolls every delving RESOURCE (a staged dice pool — torches, corruption…) and,
   optionally, the weather. As a resource's pool empties it shifts to a worse
   STAGE, and the featured resource's current stage drives the HUD's atmosphere.
   ============================================================ */

/** Base time units a "turn" can be built from (× a multiplier count). */
export const DELVING_UNITS = ["stretch", "hour", "shift", "day", "week", "month"];

/** Caps for the delving config (defensive — well beyond any real table need). */
export const DELVING_TURN_COUNT_RANGE = { min: 1, max: 99 };
export const DELVING_WEATHER_TURNS_RANGE = { min: 0, max: 99 };   // 0 = never auto-roll weather on a turn
export const DELVING_STAGE_RANGE = { min: 1, max: 12 };           // stages per resource
export const DELVING_DICE_SIZE_RANGE = { min: 2, max: 100 };
export const DELVING_DICE_COUNT_RANGE = { min: 0, max: 50 };
export const DELVING_HISTORY_CAP = 40;                            // turn snapshots kept for rewind
