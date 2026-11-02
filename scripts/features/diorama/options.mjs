/**
 * Diorama — every user-facing option, as one schema.
 *
 * Pure and dependency-free (the check tool and the preview page import it).
 * index.mjs registers a Foundry setting for each entry; the view reads them
 * back through `readGraphics()` and hands the renderer the resolved object
 * from `resolveGraphics()`. Nothing else decides what a graphics option means.
 *
 * Scope follows who the choice belongs to:
 *   • client — how this machine draws the view (quality, effects, frame rate).
 *     A player on a laptop turns weather off without touching anyone else.
 *   • world  — what the table plays by (height rules, walls, where the scene's
 *     time and weather come from, whether props block). GM only.
 * The scene's own environment (time of day, weather, atmosphere) and its props
 * are scene flags, edited by the GM per scene (FLAG_ENV, FLAG_PROPS).
 *
 * Keys are stored data: never rename one.
 */

/** Quality presets, lowest first. */
export const QUALITY = Object.freeze(["low", "medium", "high", "ultra"]);

/**
 * What each preset turns on. `preset` on an individual option means "whatever
 * the quality preset says".
 *   shadows    off | hard | soft
 *   ao         ambient occlusion (the terrain field's soft corners)
 *   water      simple | full  (refraction, caustics, glints, shore waves, falls)
 *   detail     low | high     (cliff relief, prop detail, foliage sway)
 *   weather    off | reduced | full   (rain, snow, leaves, embers, … particles)
 *   atmosphere fog, haze, light shafts, cloud shadows
 *   renderScale fraction of device pixels drawn
 *   fps        frame cap; 0 = the display's own rate
 */
export const PRESETS = Object.freeze({
  low: Object.freeze({ shadows: "off", ao: false, water: "simple", detail: "low", weather: "reduced", atmosphere: false, renderScale: 0.67, fps: 30 }),
  medium: Object.freeze({ shadows: "hard", ao: true, water: "full", detail: "low", weather: "reduced", atmosphere: true, renderScale: 0.85, fps: 60 }),
  high: Object.freeze({ shadows: "soft", ao: true, water: "full", detail: "high", weather: "full", atmosphere: true, renderScale: 1, fps: 60 }),
  ultra: Object.freeze({ shadows: "soft", ao: true, water: "full", detail: "high", weather: "full", atmosphere: true, renderScale: 1, fps: 0 }),
});

const choice = (...keys) => Object.freeze(keys);

/**
 * Every option. `key` is the setting key (all under the dio. prefix so the
 * Control Center routes them); `name` is the lang stem under GLDIO.settings.
 * `choices` are values; their labels are GLDIO.settings.<name>.<value>.
 * `numeric` marks a select whose values are numbers.
 */
export const OPTIONS = Object.freeze([
  // ── graphics: this machine ──
  { key: "dio.quality", name: "quality", scope: "client", type: "string", choices: choice(...QUALITY), default: "high" },
  { key: "dio.adaptive", name: "adaptive", scope: "client", type: "boolean", default: true },
  { key: "dio.shadows", name: "shadows", scope: "client", type: "string", choices: choice("preset", "off", "hard", "soft"), default: "preset" },
  { key: "dio.ao", name: "ao", scope: "client", type: "string", choices: choice("preset", "off", "on"), default: "preset" },
  { key: "dio.water", name: "water", scope: "client", type: "string", choices: choice("preset", "simple", "full"), default: "preset" },
  { key: "dio.detail", name: "detail", scope: "client", type: "string", choices: choice("preset", "low", "high"), default: "preset" },
  { key: "dio.weatherFx", name: "weatherFx", scope: "client", type: "string", choices: choice("preset", "off", "reduced", "full"), default: "preset" },
  { key: "dio.atmosphere", name: "atmosphere", scope: "client", type: "string", choices: choice("preset", "off", "on"), default: "preset" },
  { key: "dio.renderScale", name: "renderScale", scope: "client", type: "number", numeric: true, choices: choice(0, 50, 67, 75, 85, 100), default: 0 },
  { key: "dio.fps", name: "fps", scope: "client", type: "number", numeric: true, choices: choice(-1, 30, 60, 0), default: -1 },
  { key: "dio.dayNight", name: "dayNight", scope: "client", type: "boolean", default: true },
  { key: "dio.grade", name: "grade", scope: "client", type: "boolean", default: true },
  { key: "dio.gridStrength", name: "gridStrength", scope: "client", type: "number", range: Object.freeze({ min: 0.1, max: 0.8, step: 0.05 }), default: 0.3 },
  // ── the table: GM ──
  { key: "dio.envSource", name: "envSource", scope: "world", type: "string", choices: choice("scene", "darkness", "calendar"), default: "scene" },
  { key: "dio.weatherSource", name: "weatherSource", scope: "world", type: "string", choices: choice("scene", "calendar"), default: "scene" },
  { key: "dio.propsBlock", name: "propsBlock", scope: "world", type: "boolean", default: true },
]);

export const OPTION_KEYS = Object.freeze(Object.fromEntries(OPTIONS.map((o) => [o.name, o.key])));

const byName = new Map(OPTIONS.map((o) => [o.name, o]));

/** The option's value, sanitised: an unknown value reads as the default. */
export function sanitizeOption(name, value) {
  const o = byName.get(name);
  if (!o) return undefined;
  if (o.type === "boolean") return typeof value === "boolean" ? value : o.default;
  if (o.choices) {
    const v = o.numeric ? Number(value) : value;
    return o.choices.includes(v) ? v : o.default;
  }
  if (o.type === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) return o.default;
    return o.range ? Math.min(o.range.max, Math.max(o.range.min, n)) : n;
  }
  return typeof value === "string" ? value : o.default;
}

/**
 * Raw option values (by name) → what the renderer draws with.
 * @param {Record<string, any>} raw  name → stored value; missing reads as default
 * @returns {{quality:string, adaptive:boolean, shadows:0|1|2, ao:boolean, water:0|1, detail:0|1,
 *   weather:0|1|2, atmosphere:boolean, dayNight:boolean, grade:boolean, renderScale:number,
 *   fps:number, gridStrength:number}}
 *   shadows 0 off / 1 hard / 2 soft; water 0 simple / 1 full; detail 0 low / 1 high;
 *   weather 0 off / 1 reduced / 2 full; renderScale 0..1; fps 0 = uncapped
 */
export function resolveGraphics(raw = {}) {
  const get = (n) => sanitizeOption(n, raw?.[n]);
  const quality = get("quality");
  const p = PRESETS[quality] ?? PRESETS.high;
  const pick = (n, presetValue) => { const v = get(n); return v === "preset" ? presetValue : v; };
  const shadows = pick("shadows", p.shadows);
  const scale = get("renderScale");
  const fps = get("fps");
  return {
    quality,
    adaptive: get("adaptive"),
    shadows: shadows === "soft" ? 2 : shadows === "hard" ? 1 : 0,
    ao: (pick("ao", p.ao ? "on" : "off")) === "on",
    water: pick("water", p.water) === "full" ? 1 : 0,
    detail: pick("detail", p.detail) === "high" ? 1 : 0,
    weather: ({ off: 0, reduced: 1, full: 2 })[pick("weatherFx", p.weather)] ?? 2,
    atmosphere: (pick("atmosphere", p.atmosphere ? "on" : "off")) === "on",
    dayNight: get("dayNight"),
    grade: get("grade"),
    renderScale: scale > 0 ? scale / 100 : p.renderScale,
    fps: fps < 0 ? p.fps : fps,
    gridStrength: get("gridStrength"),
  };
}

/** The renderer's default: what a fresh client with no stored settings gets. */
export const DEFAULT_GRAPHICS = Object.freeze(resolveGraphics({}));
