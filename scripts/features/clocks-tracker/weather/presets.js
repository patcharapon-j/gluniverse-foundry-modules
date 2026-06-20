/**
 * Weather presets — the shipped climate library plus the composable "kind"
 * library that the editor offers (decision #8, #14, §4.6).
 *
 * A "kind" is a named (archetype, default tints, drift, intensity) preset. A hex
 * derives its effect spec from a kind, then the GM may retint freely. Two full
 * climates ship:
 *   • Temperate — a 4-season climate with a per-season flower + Navigation Hex.
 *   • Homage    — a single-flower, no-seasons example (Goblin's Henchman classic).
 *
 * Everything here is plain data so it round-trips through the editor's JSON I/O.
 */

import { HEX_LAYOUT, HEX_COUNT } from "./hex-geometry.js";
import { WEATHER_DIRECTIONS } from "../const.js";

/* ----------------------------------------------------------------------------
 * Kind library — mundane + fantasy. Each entry is an effect archetype with
 * default two-colour tint, drift, intensity, plus a default icon/label/temp.
 * -------------------------------------------------------------------------- */
export const KINDS = {
  clear:        { archetype: "clear",   intensity: 0.30, tintParticle: "#cfe8ff", tintGlow: "#7fb4e6", drift: "still", icon: "fa-solid fa-sun",                   label: "Clear",       temperature: "Mild",     desc: "Open skies; visibility is excellent." },
  clouds:       { archetype: "volume",  intensity: 0.45, tintParticle: "#cfd6e0", tintGlow: "#7d8794", drift: "right", icon: "fa-solid fa-cloud",                 label: "Cloudy",      temperature: "Mild",     desc: "A drifting deck of cloud softens the light." },
  fog:          { archetype: "volume",  intensity: 0.72, tintParticle: "#dde2e9", tintGlow: "#9aa3b0", drift: "left",  icon: "fa-solid fa-smog",                  label: "Fog",         temperature: "Cool",     desc: "Thick fog cuts sight to a stone's throw." },
  rain:         { archetype: "streaks", intensity: 0.55, tintParticle: "#9cc0e6", tintGlow: "#3a5f8a", drift: "fall",  icon: "fa-solid fa-cloud-rain",            label: "Rain",        temperature: "Cool",     desc: "Steady rain slicks every surface." },
  "heavy-rain": { archetype: "streaks", intensity: 0.88, tintParticle: "#7aa0c8", tintGlow: "#24405e", drift: "fall",  icon: "fa-solid fa-cloud-showers-heavy",   label: "Heavy Rain",  temperature: "Cold",     desc: "Sheets of rain reduce visibility to a few yards." },
  storm:        { archetype: "flashes", intensity: 0.82, tintParticle: "#b3c0d8", tintGlow: "#e6edff", drift: "fall",  icon: "fa-solid fa-cloud-bolt",            label: "Thunderstorm", temperature: "Cold",    ominous: true, desc: "Lightning splits the sky; thunder rolls close behind." },
  wind:         { archetype: "gusts",   intensity: 0.62, tintParticle: "#d2dae4", tintGlow: "#88939f", drift: "right", icon: "fa-solid fa-wind",                  label: "High Wind",   temperature: "Cool",     desc: "A driving wind snatches at cloaks and flames." },
  snow:         { archetype: "flakes",  intensity: 0.58, tintParticle: "#ffffff", tintGlow: "#bcd4e6", drift: "fall",  icon: "fa-solid fa-snowflake",             label: "Snow",        temperature: "Freezing", desc: "Snow falls softly, blanketing the ground." },
  blizzard:     { archetype: "flakes",  intensity: 0.96, tintParticle: "#ffffff", tintGlow: "#9fc0d8", drift: "left",  icon: "fa-solid fa-snowflake",             label: "Blizzard",    temperature: "Bitter",   ominous: true, desc: "A howling whiteout — travel is treacherous." },
  hail:         { archetype: "shards",  intensity: 0.80, tintParticle: "#e3f2ff", tintGlow: "#9bb6c8", drift: "fall",  icon: "fa-solid fa-icicles",               label: "Hail",        temperature: "Freezing", ominous: true, desc: "Hailstones hammer down hard enough to bruise." },
  sand:         { archetype: "gusts",   intensity: 0.86, tintParticle: "#e6c98c", tintGlow: "#a07f43", drift: "right", icon: "fa-solid fa-wind",                  label: "Sandstorm",   temperature: "Scorching", ominous: true, desc: "A wall of grit scours skin and chokes the air." },

  // ---- fantasy set ----
  "acid-rain":         { archetype: "streaks", intensity: 0.82, tintParticle: "#a6e22e", tintGlow: "#3a5f00", drift: "fall",  icon: "fa-solid fa-cloud-rain",          label: "Acid Rain",         temperature: "Caustic",  ominous: true, desc: "Green rain hisses and pits exposed metal." },
  "blood-rain":        { archetype: "streaks", intensity: 0.80, tintParticle: "#d4344a", tintGlow: "#4a0008", drift: "fall",  icon: "fa-solid fa-cloud-showers-heavy", label: "Blood Rain",        temperature: "Cold",     ominous: true, desc: "Crimson rain falls — an ill omen by any reckoning." },
  ashfall:             { archetype: "flakes",  intensity: 0.64, tintParticle: "#9aa0a6", tintGlow: "#3b3f44", drift: "rise",  icon: "fa-solid fa-volcano",             label: "Ashfall",           temperature: "Hot",      ominous: true, desc: "Grey ash sifts down and rises on the heat." },
  "ember-storm":       { archetype: "embers",  intensity: 0.86, tintParticle: "#ff7a18", tintGlow: "#ffd25a", drift: "rise",  icon: "fa-solid fa-fire",                label: "Ember Storm",       temperature: "Searing",  ominous: true, desc: "Glowing cinders ride the updraughts; tinder catches." },
  "arcane-mist":       { archetype: "volume",  intensity: 0.60, tintParticle: "#b69bff", tintGlow: "#5b3fa0", drift: "left",  icon: "fa-solid fa-hat-wizard",          label: "Arcane Mist",       temperature: "Uncanny",  desc: "A violet mist hums faintly with stray magic." },
  "spore-bloom":       { archetype: "motes",   intensity: 0.55, tintParticle: "#9be15d", tintGlow: "#2f6b1f", drift: "still", icon: "fa-solid fa-seedling",            label: "Spore Bloom",       temperature: "Humid",    desc: "Glowing spores hang in the still air." },
  aurora:              { archetype: "motes",   intensity: 0.42, tintParticle: "#5ef2c4", tintGlow: "#2f7fd8", drift: "rise",  icon: "fa-solid fa-star",                label: "Aurora",            temperature: "Cold",     desc: "Ribbons of light shimmer across the heavens." },
  miasma:              { archetype: "volume",  intensity: 0.70, tintParticle: "#8fae5d", tintGlow: "#3a4a1f", drift: "left",  icon: "fa-solid fa-skull-crossbones",    label: "Miasma",            temperature: "Foul",     ominous: true, desc: "A sickly haze settles in the low ground." },
  "meteor-shower":     { archetype: "shards",  intensity: 0.72, tintParticle: "#ffd27a", tintGlow: "#ff7a18", drift: "fall",  icon: "fa-solid fa-meteor",              label: "Meteor Shower",     temperature: "Cold",     ominous: true, desc: "Falling stars streak the night sky." },
  "crimson-lightning": { archetype: "flashes", intensity: 0.85, tintParticle: "#ff3b5c", tintGlow: "#ff9bb0", drift: "fall",  icon: "fa-solid fa-bolt",                label: "Crimson Lightning", temperature: "Cold",     ominous: true, desc: "Red lightning forks down in unnatural silence." }
};

/** Editor dropdown rows: every kind, grouped mundane → fantasy by insertion order. */
export const KIND_LIST = Object.entries(KINDS).map(([key, k]) => ({ key, label: k.label, archetype: k.archetype }));

/** Build a fresh effect-spec (§4.2) from a library kind. */
export function effectFromKind(key) {
  const k = KINDS[key] ?? KINDS.clear;
  return {
    archetype: k.archetype,
    kind: KINDS[key] ? key : "clear",
    intensity: k.intensity,
    tintParticle: k.tintParticle,
    tintGlow: k.tintGlow,
    drift: k.drift,
    ominous: !!k.ominous
  };
}

/** Build a full hex (§4.3) at `index` from a library kind, with optional overrides. */
function hexFromKind(index, key, overrides = {}) {
  const k = KINDS[key] ?? KINDS.clear;
  return {
    index,
    label: overrides.label ?? k.label,
    icon: overrides.icon ?? k.icon,
    description: overrides.description ?? k.desc ?? "",
    temperature: overrides.temperature ?? k.temperature ?? "Temperate",
    effectNote: overrides.effectNote ?? "",
    // Per-hex disallowed faces (the cookbook's red Ø): rolling into one = stay.
    disallow: Array.isArray(overrides.disallow) ? [...overrides.disallow] : [],
    effect: { ...effectFromKind(key), ...(overrides.effect ?? {}) }
  };
}

/* ----------------------------------------------------------------------------
 * Navigation Hex presets. The trend lives entirely in the direction map: which
 * roll totals point "up" (toward the severe top of the flower) vs "down".
 * -------------------------------------------------------------------------- */
const DEFAULT_EDGES = {
  up: "wrap", upperRight: "wrap", lowerRight: "wrap",
  down: "wrap", lowerLeft: "stay", upperLeft: "stay"
};

const nav = (directionMap, edgeRules = DEFAULT_EDGES, dice = "2d6") => ({
  dice, directionMap: { ...directionMap }, edgeRules: { ...edgeRules }
});

/** Calm-trending 2d6 NH — "down" (toward clear skies) is common, "up" rare. */
const NAV_CALM = nav({
  "2": "down", "3": "down",
  "4": "lowerLeft", "5": "lowerLeft",
  "6": "lowerRight", "7": "lowerRight",
  "8": "upperLeft", "9": "upperLeft",
  "10": "upperRight", "11": "upperRight",
  "12": "up"
});

/** Balanced 2d6 NH — an even spread across the six faces. */
const NAV_BALANCED = nav({
  "2": "up", "3": "up",
  "4": "upperRight", "5": "upperRight",
  "6": "lowerRight", "7": "down",
  "8": "lowerLeft", "9": "lowerLeft",
  "10": "upperLeft", "11": "upperLeft",
  "12": "down"
});

/** Severe-trending 2d6 NH — "up" (toward the extreme) is common. */
const NAV_STORMY = nav({
  "2": "up", "3": "up",
  "4": "upperRight", "5": "upperRight",
  "6": "upperLeft", "7": "upperLeft",
  "8": "lowerRight", "9": "lowerRight",
  "10": "lowerLeft", "11": "lowerLeft",
  "12": "down"
});

/* ----------------------------------------------------------------------------
 * Season flower builder. Each hex's severity tier is read from its vertical
 * position v (top of the flower = severe, bottom = calm); the centre hex (9) is
 * a per-season "wildcard". A season supplies one kind per tier.
 * -------------------------------------------------------------------------- */
function tierOf(v) {
  if (v <= -4) return "extreme";
  if (v <= -2) return "strong";
  if (v <= 0) return "moderate";
  if (v <= 2) return "mild";
  return "calm";
}

/**
 * Default disallowed faces (cookbook red Ø) for the weather flower, keyed by the
 * canonical hex index. Caps the walk at the two extremes so it can't escalate
 * past the worst hex or calm below the gentlest:
 *   • 7  = north-most / extreme hazard → can't go up, upper-right, or upper-left.
 *   • 11 = bottom-most / start hex     → can't go down (off the calm bottom).
 * GMs can retune these per hex in the editor.
 */
const DEFAULT_DISALLOW = {
  7: ["up", "upperRight", "upperLeft"],
  11: ["down"]
};

function buildSeasonHexes(bands) {
  return HEX_LAYOUT.map(h => {
    const key = h.index === 9 ? bands.wildcard : bands[tierOf(h.v)];
    return hexFromKind(h.index, key, { disallow: DEFAULT_DISALLOW[h.index] });
  });
}

const SEASON_BANDS = {
  spring: { calm: "clear", mild: "clouds", moderate: "rain", strong: "heavy-rain", extreme: "storm", wildcard: "fog" },
  summer: { calm: "clear", mild: "clear", moderate: "clouds", strong: "storm", extreme: "storm", wildcard: "wind" },
  autumn: { calm: "clouds", mild: "fog", moderate: "rain", strong: "wind", extreme: "storm", wildcard: "heavy-rain" },
  winter: { calm: "clear", mild: "clouds", moderate: "snow", strong: "snow", extreme: "blizzard", wildcard: "hail" }
};

/**
 * Temperate climate — 4 seasons keyed by the Gregorian season index order
 * (0:Winter, 1:Spring, 2:Summer, 3:Autumn). Per-season flower + Navigation Hex.
 * Start hex is the calmest bottom-centre cell (index 11).
 */
export function buildTemperate() {
  return {
    id: "temperate",
    name: "Temperate",
    seasonal: true,        // follows the calendar's seasons (per-season flower + NH)
    startHexIndex: 11,
    defaultNav: NAV_BALANCED,
    seasons: {
      "0": { name: "Winter", hexes: buildSeasonHexes(SEASON_BANDS.winter), nav: NAV_STORMY },
      "1": { name: "Spring", hexes: buildSeasonHexes(SEASON_BANDS.spring), nav: NAV_BALANCED },
      "2": { name: "Summer", hexes: buildSeasonHexes(SEASON_BANDS.summer), nav: NAV_CALM },
      "3": { name: "Autumn", hexes: buildSeasonHexes(SEASON_BANDS.autumn), nav: NAV_BALANCED }
    }
  };
}

/**
 * Homage climate — a single-flower, no-seasons example after Goblin's Henchman's
 * classic English-weather Hex Flower. One season entry; the engine's fallback
 * uses it whatever the calendar season is.
 */
export function buildHomage() {
  const bands = { calm: "clear", mild: "clouds", moderate: "rain", strong: "wind", extreme: "storm", wildcard: "fog" };
  return {
    id: "homage",
    name: "Goblin's Henchman Classic",
    seasonal: false,       // single flower for all time (ignores the calendar season)
    startHexIndex: 11,
    defaultNav: NAV_CALM,
    seasons: {
      "0": { name: "All Year", hexes: buildSeasonHexes(bands), nav: NAV_CALM }
    }
  };
}

/** Whether a climate follows the calendar (defaults to true unless flagged off). */
export function isClimateSeasonal(climate) {
  if (typeof climate?.seasonal === "boolean") return climate.seasonal;
  return Object.keys(climate?.seasons ?? {}).length > 1;
}

/** Climate presets offered in the editor + the menu. */
export const WEATHER_PRESETS = {
  temperate: buildTemperate,
  homage: buildHomage
};

export const DEFAULT_WEATHER_PRESET = "temperate";

/** A fresh live-walk state seated at the climate's start hex. */
export function freshState(climate) {
  const start = Number.isInteger(climate?.startHexIndex) ? climate.startHexIndex : 11;
  return {
    currentIndex: (start >= 0 && start < HEX_COUNT) ? start : 11,
    lastSeasonKey: null,
    lastDayIndex: null,
    history: []
  };
}

/** The full default weather config (§4.5) — one "default" region, Temperate, parked at start. */
export function makeDefaultWeather() {
  const climate = buildTemperate();
  return {
    schemaVersion: 2,
    activeRegion: "default",            // which region drives the HUD + chat cards
    regions: {
      default: {
        name: "Default",                // GM-facing locale label (shown in the region switcher)
        activePresetId: "temperate",
        climate,
        state: freshState(climate)
      }
    }
  };
}

/** A fresh region wrapper around a climate (used when the GM adds a region). */
export function makeRegion(name, climate) {
  return {
    name: String(name || "Region"),
    activePresetId: climate?.id ?? "custom",
    climate: foundry.utils.deepClone(climate),
    state: freshState(climate)
  };
}

/** Direction keys in canonical order (re-exported for editors). */
export { WEATHER_DIRECTIONS };
