/**
 * Diorama — the scene environment: what the GM stores, the named presets, and
 * the one function that turns them into light, sky, weather and wind.
 *
 * Pure and dependency-free (the check tool, the preview page and the renderer
 * import it). view/environment-source.mjs is the half that reads the world;
 * render/atmosphere.mjs is the half that draws what resolveEnv() returns.
 *
 * ── The stored flag (scene flag FLAG_ENV, "dio.env"). Keys are stored data:
 *    never rename one. normalizeEnv() makes any input total.
 *   {
 *     v: 1,
 *     preset: string|null,          the preset last applied (the panel's highlight)
 *     hour: number|null,            0..24; null = "table light", today's neutral sun
 *     weather: { kind, intensity }, kind ∈ WEATHER_KINDS, intensity 0..1
 *     wind: { dir, strength },      dir: degrees the wind blows TOWARD, 0 = up the
 *                                   map (north, -z), 90 = right (east, +x); 0..1
 *     fog: { density, height },     0..1 each (height: how high it pools)
 *     clouds: number,               cover 0..1 (moving cloud shadows)
 *     water: { dir, speed },        river flow, same compass as wind; 0..1
 *     wetness: number,              extra wet ground 0..1 (rain adds its own)
 *     snow: number,                 extra snow cover 0..1 (snow adds its own)
 *   }
 *
 * ── The resolved environment (resolveEnv). Plain numbers and [r,g,b] arrays in
 *    the map art's own values (the renderer does no colour-space conversion).
 *   {
 *     neutral: boolean,             true = today's fixed light (dayNight off, or no hour)
 *     hour: number|null,
 *     sun: { dir:[x,y,z], color:[r,g,b], elevation:deg, day:0..1 }
 *                                   dir points TOWARD the light (unit, y > 0 always);
 *                                   color is the direct key (the moon's at night);
 *                                   day 1 = sun, 0 = moon
 *     moon: { color:[r,g,b], strength:0..1 }   the night key, for reference
 *     fill: [r,g,b],                sky fill (shade() SKY_FILL)
 *     bounce: [r,g,b],              ground bounce (BOUNCE)
 *     sky: [r,g,b],                 the sky's own colour: haze, fog base, reflections
 *     darkness: 0..1,               how dark the hour is; the renderer takes the
 *                                   larger of this and Foundry's darkness
 *     overcast: 0..1,               softens the key, greys the fill
 *     fog: { color:[r,g,b], density:0..1, height:cells },
 *     haze: 0..1,  shafts: 0..1,    distance haze; light shafts through fog at low sun
 *     clouds: { cover:0..1, speed:cells/s },
 *     weather: { kind, intensity:0..1, tint:[r,g,b]|null },
 *     lightning: boolean,
 *     wind: { x, z, speed },        unit direction on the map (x east, z south) and
 *                                   strength 0..1 (props sway with this)
 *     water: { x, z, speed },       river flow, same convention
 *     wetness: 0..1, snow: 0..1,    surface wetness and snow cover actually drawn
 *     mist: 0..1,                   mist over water
 *   }
 */

export const ENV_VERSION = 1;

/** Weather kinds. Keys are stored data; never rename. Lang: GLDIO.env.kind.<key>. */
export const WEATHER_KINDS = Object.freeze(["clear", "rain", "storm", "snow", "blizzard", "leaves", "petals", "embers", "ash", "sand", "fireflies"]);

/**
 * What each kind brings with it at full intensity: the sky it closes, the ground
 * it wets or whitens, haze and fog, and the fog's own colour (null = the sky's).
 */
const KIND_LOOK = Object.freeze({
  clear: { overcast: 0, clouds: 0, wet: 0, snow: 0, haze: 0, fog: 0, fogColor: null },
  rain: { overcast: 0.55, clouds: 0.75, wet: 0.85, snow: 0, haze: 0.25, fog: 0.12, fogColor: null },
  storm: { overcast: 0.85, clouds: 1, wet: 1, snow: 0, haze: 0.35, fog: 0.2, fogColor: null },
  snow: { overcast: 0.5, clouds: 0.6, wet: 0, snow: 0.75, haze: 0.25, fog: 0.12, fogColor: [0.86, 0.89, 0.94] },
  blizzard: { overcast: 0.9, clouds: 1, wet: 0, snow: 1, haze: 0.55, fog: 0.4, fogColor: [0.88, 0.91, 0.95] },
  leaves: { overcast: 0.1, clouds: 0.25, wet: 0, snow: 0, haze: 0.08, fog: 0, fogColor: null },
  petals: { overcast: 0, clouds: 0.15, wet: 0, snow: 0, haze: 0.08, fog: 0, fogColor: null },
  embers: { overcast: 0.35, clouds: 0.3, wet: 0, snow: 0, haze: 0.4, fog: 0.15, fogColor: [0.46, 0.33, 0.28] },
  ash: { overcast: 0.6, clouds: 0.5, wet: 0, snow: 0, haze: 0.45, fog: 0.2, fogColor: [0.52, 0.5, 0.49] },
  sand: { overcast: 0.45, clouds: 0, wet: 0, snow: 0, haze: 0.6, fog: 0.35, fogColor: [0.80, 0.66, 0.44] },
  fireflies: { overcast: 0, clouds: 0, wet: 0, snow: 0, haze: 0.05, fog: 0.05, fogColor: null },
});

/** The kinds with weather particles that fall like water (they ripple water and splash). */
export const RAIN_KINDS = Object.freeze(["rain", "storm"]);

/* ───────────────────────────── today's neutral light ───────────────────────────── */

/**
 * The light every view drew before the environment existed, exactly. A user
 * with dayNight off, and a scene nobody gave an hour, get this and nothing
 * else: the sun about 38° up from the back-left of the default view.
 */
export const NEUTRAL_LIGHT = Object.freeze({
  dir: Object.freeze(normalize3([-0.74, 0.62, -0.26])),
  key: Object.freeze([0.86, 0.80, 0.70]),
  fill: Object.freeze([0.46, 0.50, 0.58]),
  bounce: Object.freeze([0.10, 0.08, 0.055]),
  sky: Object.freeze([0.72, 0.82, 0.92]),
});

/* ───────────────────────────── the flag ───────────────────────────── */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const unit = (v, d) => clamp01(num(v, d));
const deg = (v, d) => { const n = num(v, d); return ((n % 360) + 360) % 360; };

/** The environment a scene has before the GM touches it: today's look. */
export const DEFAULT_ENV = Object.freeze({
  v: ENV_VERSION,
  preset: null,
  hour: null,
  weather: Object.freeze({ kind: "clear", intensity: 0 }),
  wind: Object.freeze({ dir: 300, strength: 0.2 }),
  fog: Object.freeze({ density: 0, height: 0.35 }),
  clouds: 0,
  water: Object.freeze({ dir: 90, speed: 0 }),
  wetness: 0,
  snow: 0,
});

/** Any input → a total, sanitised flag value (a fresh object). */
export function normalizeEnv(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const D = DEFAULT_ENV;
  const w = r.weather && typeof r.weather === "object" ? r.weather : {};
  const kind = WEATHER_KINDS.includes(w.kind) ? w.kind : "clear";
  const hourRaw = r.hour === null || r.hour === undefined || r.hour === "" ? null : num(r.hour, null);
  const hour = hourRaw === null ? null : ((hourRaw % 24) + 24) % 24;
  return {
    v: ENV_VERSION,
    preset: typeof r.preset === "string" && (r.preset in PRESETS || r.preset === "custom") ? r.preset : null,
    hour,
    weather: { kind, intensity: kind === "clear" ? 0 : unit(w.intensity, 0.6) },
    wind: { dir: deg(r.wind?.dir, D.wind.dir), strength: unit(r.wind?.strength, D.wind.strength) },
    fog: { density: unit(r.fog?.density, D.fog.density), height: unit(r.fog?.height, D.fog.height) },
    clouds: unit(r.clouds, D.clouds),
    water: { dir: deg(r.water?.dir, D.water.dir), speed: unit(r.water?.speed, D.water.speed) },
    wetness: unit(r.wetness, D.wetness),
    snow: unit(r.snow, D.snow),
  };
}

/* ───────────────────────────── presets ───────────────────────────── */

/**
 * Named starting points. Each is a partial flag laid over DEFAULT_ENV. Keys are
 * stored data (env.preset); lang: GLDIO.env.preset.<key>. `icon` is the chip's
 * Font Awesome glyph.
 */
export const PRESETS = Object.freeze({
  neutral: { icon: "fa-solid fa-chess-board", env: {} },
  clearDay: { icon: "fa-solid fa-sun", env: { hour: 11, clouds: 0.15, wind: { dir: 300, strength: 0.25 } } },
  goldenHour: { icon: "fa-solid fa-mountain-sun", env: { hour: 16.9, clouds: 0.2, fog: { density: 0.12, height: 0.3 }, wind: { dir: 280, strength: 0.2 } } },
  dusk: { icon: "fa-solid fa-cloud-sun", env: { hour: 17.6, clouds: 0.25, fog: { density: 0.15, height: 0.35 } } },
  night: { icon: "fa-solid fa-moon", env: { hour: 23, clouds: 0.1, fog: { density: 0.1, height: 0.3 }, wind: { dir: 300, strength: 0.15 } } },
  foggyMorning: { icon: "fa-solid fa-smog", env: { hour: 7.3, fog: { density: 0.7, height: 0.55 }, wetness: 0.3, wind: { dir: 80, strength: 0.1 } } },
  rain: { icon: "fa-solid fa-cloud-rain", env: { hour: 13, clouds: 0.85, weather: { kind: "rain", intensity: 0.6 }, wind: { dir: 120, strength: 0.35 } } },
  storm: { icon: "fa-solid fa-cloud-bolt", env: { hour: 15, clouds: 1, weather: { kind: "storm", intensity: 0.9 }, wind: { dir: 110, strength: 0.7 }, fog: { density: 0.2, height: 0.4 } } },
  snow: { icon: "fa-solid fa-snowflake", env: { hour: 12, clouds: 0.6, weather: { kind: "snow", intensity: 0.55 }, wind: { dir: 200, strength: 0.15 }, snow: 0.6 } },
  blizzard: { icon: "fa-solid fa-icicles", env: { hour: 14, clouds: 1, weather: { kind: "blizzard", intensity: 0.95 }, wind: { dir: 250, strength: 0.9 }, fog: { density: 0.45, height: 0.6 }, snow: 0.9 } },
  autumn: { icon: "fa-solid fa-leaf", env: { hour: 15.5, clouds: 0.3, weather: { kind: "leaves", intensity: 0.6 }, wind: { dir: 70, strength: 0.4 } } },
  spring: { icon: "fa-solid fa-spa", env: { hour: 10, clouds: 0.1, weather: { kind: "petals", intensity: 0.5 }, wind: { dir: 60, strength: 0.25 } } },
  volcanic: { icon: "fa-solid fa-volcano", env: { hour: 16.5, clouds: 0.4, weather: { kind: "embers", intensity: 0.75 }, wind: { dir: 20, strength: 0.3 }, fog: { density: 0.25, height: 0.5 } } },
  ashfall: { icon: "fa-solid fa-fire-flame-simple", env: { hour: 13.5, clouds: 0.6, weather: { kind: "ash", intensity: 0.7 }, wind: { dir: 160, strength: 0.25 }, fog: { density: 0.2, height: 0.5 } } },
  sandstorm: { icon: "fa-solid fa-wind", env: { hour: 14, weather: { kind: "sand", intensity: 0.85 }, wind: { dir: 90, strength: 0.9 }, fog: { density: 0.4, height: 0.6 } } },
  fireflies: { icon: "fa-solid fa-star", env: { hour: 21.5, clouds: 0.05, weather: { kind: "fireflies", intensity: 0.6 }, fog: { density: 0.15, height: 0.3 }, wind: { dir: 300, strength: 0.08 } } },
});

export const PRESET_KEYS = Object.freeze(Object.keys(PRESETS));

/** The flag a preset writes (a fresh normalised object). */
export function applyPreset(key) {
  const p = PRESETS[key] ?? PRESETS.neutral;
  const e = p.env;
  return normalizeEnv({
    ...DEFAULT_ENV, ...e,
    preset: PRESETS[key] ? key : "neutral",
    weather: { ...DEFAULT_ENV.weather, ...(e.weather ?? {}) },
    wind: { ...DEFAULT_ENV.wind, ...(e.wind ?? {}) },
    fog: { ...DEFAULT_ENV.fog, ...(e.fog ?? {}) },
    water: { ...DEFAULT_ENV.water, ...(e.water ?? {}) },
  });
}

/* ───────────────────────────── time of day ───────────────────────────── */

/** Lowest the key light ever sits, degrees: long shadows, never under the board. */
export const MIN_ELEVATION = 7;
/** The key light's hottest channel never exceeds this. */
const KEY_CAP = 1.1;
const SUN_MAX = 70;
const MOON_MAX = 45;
const RAD = Math.PI / 180;
const LUMA = [0.299, 0.587, 0.114];
const luma = (c) => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
/** The moon's key, as a hue (unit luminance). */
const MOON_HUE = [0.56, 0.66, 0.92].map((c, _, a) => c / luma(a));

function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * The key light's path over 24 hours: ONE continuous curve, so time can be
 * dragged without the shadows ever jumping. The azimuth turns a full circle a
 * day (east at 6:00, north at noon, west at 18:00, south at midnight) and the
 * elevation rises to SUN_MAX by day and to MOON_MAX for the moon at night, both
 * meeting at MIN_ELEVATION at dawn and dusk. Painted maps are mostly lit from
 * the top of the sheet, so midday light comes from the north.
 * @returns {{ dir:number[], elevation:number, sunUp:number }}  sunUp = sin of the sun's own (unclamped) elevation
 */
export function keyPath(hour) {
  const h = ((Number(hour) % 24) + 24) % 24;
  const s = (h - 6) / 12;                       // 0 sunrise … 1 sunset, beyond = night
  const az = Math.PI * s;
  const sunUp = Math.sin(Math.PI * s);          // > 0 while the sun is up
  const day = s >= 0 && s <= 1;
  const nightS = ((h - 18 + 24) % 24) / 12;     // 0 dusk … 1 dawn
  const el = day ? Math.max(MIN_ELEVATION, SUN_MAX * sunUp) : MIN_ELEVATION + (MOON_MAX - MIN_ELEVATION) * Math.sin(Math.PI * nightS);
  const hx = Math.cos(az), hz = -(0.30 + 0.45 * Math.sin(az));
  const hl = Math.hypot(hx, hz) || 1;
  const ce = Math.cos(el * RAD), se = Math.sin(el * RAD);
  return { dir: [(hx / hl) * ce, se, (hz / hl) * ce], elevation: el, sunUp };
}

/**
 * Colour keyframes by hour. fill and sky are absolute; key is a hue (scaled to
 * keep open ground at `bright`); dark is how dark the hour is; haze its air.
 */
const KEYS = Object.freeze([
  { h: 0, fill: [0.20, 0.25, 0.40], key: [0.56, 0.66, 0.92], sky: [0.10, 0.14, 0.28], dark: 0.6, bright: 0.66, haze: 0.08 },
  { h: 4.6, fill: [0.22, 0.26, 0.42], key: [0.58, 0.66, 0.90], sky: [0.14, 0.17, 0.32], dark: 0.56, bright: 0.68, haze: 0.1 },
  { h: 5.6, fill: [0.40, 0.38, 0.54], key: [0.92, 0.58, 0.52], sky: [0.56, 0.42, 0.56], dark: 0.3, bright: 0.76, haze: 0.22 },
  { h: 6.5, fill: [0.57, 0.51, 0.57], key: [1.00, 0.64, 0.40], sky: [0.96, 0.68, 0.52], dark: 0.08, bright: 0.86, haze: 0.28 },
  { h: 7.8, fill: [0.46, 0.48, 0.56], key: [1.00, 0.84, 0.66], sky: [0.82, 0.80, 0.84], dark: 0, bright: 0.96, haze: 0.16 },
  { h: 12, fill: [0.44, 0.49, 0.58], key: [1.00, 0.98, 0.93], sky: [0.70, 0.82, 0.94], dark: 0, bright: 1.0, haze: 0.08 },
  { h: 15.5, fill: [0.46, 0.50, 0.58], key: [1.00, 0.92, 0.80], sky: [0.72, 0.80, 0.90], dark: 0, bright: 1.0, haze: 0.1 },
  { h: 16.9, fill: [0.60, 0.53, 0.54], key: [1.00, 0.70, 0.42], sky: [0.98, 0.72, 0.50], dark: 0.02, bright: 0.95, haze: 0.3 },
  { h: 17.6, fill: [0.50, 0.40, 0.50], key: [1.00, 0.50, 0.30], sky: [0.92, 0.48, 0.40], dark: 0.1, bright: 0.84, haze: 0.32 },
  { h: 18.6, fill: [0.30, 0.31, 0.52], key: [0.66, 0.56, 0.78], sky: [0.38, 0.33, 0.56], dark: 0.32, bright: 0.72, haze: 0.2 },
  { h: 19.8, fill: [0.21, 0.26, 0.42], key: [0.56, 0.66, 0.92], sky: [0.13, 0.17, 0.32], dark: 0.56, bright: 0.66, haze: 0.1 },
  { h: 24, fill: [0.20, 0.25, 0.40], key: [0.56, 0.66, 0.92], sky: [0.10, 0.14, 0.28], dark: 0.6, bright: 0.66, haze: 0.08 },
]);

const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** The keyframes blended at an hour (smoothstep between neighbours: continuous). */
export function hourLook(hour) {
  const h = ((Number(hour) % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = smooth(Math.max(0, Math.min(1, (h - a.h) / (b.h - a.h))));
  return {
    fill: lerp3(a.fill, b.fill, t), key: lerp3(a.key, b.key, t), sky: lerp3(a.sky, b.sky, t),
    dark: lerp(a.dark, b.dark, t), bright: lerp(a.bright, b.bright, t), haze: lerp(a.haze, b.haze, t),
  };
}

/** Foundry darkness 0..1 → an hour: 0 = early afternoon, 0.5 ≈ sunset, 1 = midnight. */
export function darknessToHour(darkness) {
  const d = clamp01(num(darkness, 0));
  return 13 + 11 * d;
}

/** A compass direction (degrees the thing moves toward) → unit [x, z] on the map. */
export function compass(dirDeg) {
  const a = num(dirDeg, 0) * RAD;
  return [Math.sin(a), -Math.cos(a)];
}

/* ───────────────────────────── resolve ───────────────────────────── */

/**
 * The flag (plus where time and weather really come from) → what the renderer draws.
 * @param {object|null} env  the stored flag (any shape; normalised here)
 * @param {{ hour?: number|null, weather?: {kind:string, intensity:number, tint?:number[]|null}|null,
 *   dayNight?: boolean, foundryDims?: boolean }} [o]
 *   hour       overrides the flag's hour when a source supplies one (undefined = the flag's)
 *   weather    overrides the flag's weather (the calendar's), null = the flag's
 *   dayNight   false: this user wants today's fixed light (weather still shows)
 *   foundryDims true: Foundry's own darkness already dims the view (darkness source),
 *              so the hour must not darken it a second time
 */
export function resolveEnv(env, { hour, weather = null, dayNight = true, foundryDims = false } = {}) {
  const e = normalizeEnv(env);
  const h = hour === undefined ? e.hour : (hour === null ? null : ((num(hour, 12) % 24) + 24) % 24);
  const neutral = !dayNight || h === null;
  const wIn = weather && WEATHER_KINDS.includes(weather.kind) ? weather : e.weather;
  const kind = wIn.kind;
  const intensity = kind === "clear" ? 0 : unit(wIn.intensity, 0.6);
  const look = KIND_LOOK[kind] ?? KIND_LOOK.clear;
  const tint = Array.isArray(weather?.tint) && weather.tint.length === 3 ? weather.tint.map((c) => clamp01(num(c, 1))) : null;

  const [wx, wz] = compass(e.wind.dir);
  const [fx, fz] = compass(e.water.dir);
  const cover = clamp01(Math.max(e.clouds, look.clouds * intensity));
  const overcast = clamp01(Math.max(look.overcast * intensity, cover * 0.5));

  let sun, moon, fill, bounce, sky, darkness, haze, shafts;
  if (neutral) {
    const N = NEUTRAL_LIGHT;
    sun = { dir: [...N.dir], color: [...N.key], elevation: Math.asin(N.dir[1]) / RAD, day: 1 };
    moon = { color: [0.56, 0.66, 0.92], strength: 0 };
    fill = [...N.fill];
    bounce = [...N.bounce];
    sky = [...N.sky];
    darkness = 0;
    // no air of its own: a default scene draws exactly as it always has
    haze = 0;
    shafts = 0;
  } else {
    const path = keyPath(h);
    const L = hourLook(h);
    const day = smoothstepJS(-0.05, 0.12, path.sunUp);
    const se = Math.max(Math.sin(path.elevation * RAD), 0.15);
    // the direct key keeps open ground at the hour's brightness, capped so a
    // face turned to a low sun glows warm rather than burning out
    const kI = Math.max(0, Math.min(lerp(0.55, 1.05, day), (L.bright - luma(L.fill)) / se));
    // once the sun is down the key is the moon: its hue takes over with it
    const sunHue = L.key.map((c) => c / Math.max(luma(L.key), 1e-3));
    const hue = mix3(MOON_HUE, sunHue, day);
    // a warm hue at unit luminance carries red above 1: hold its hottest
    // channel down so a face square to a low sun glows rather than clips
    const hot = Math.max(...hue) * kI;
    const keyC = hue.map((c) => c * kI * (hot > KEY_CAP ? KEY_CAP / hot : 1));
    sun = { dir: path.dir, color: keyC, elevation: path.elevation, day };
    moon = { color: [0.56, 0.66, 0.92], strength: 1 - day };
    fill = L.fill;
    bounce = [keyC[0] * 0.116, keyC[1] * 0.1, keyC[2] * 0.079];
    sky = L.sky;
    darkness = foundryDims ? 0 : clamp01(L.dark + overcast * 0.1 + (kind === "storm" ? 0.08 * intensity : 0));
    haze = L.haze;
    // shafts: a low sun through air with something in it
    shafts = clamp01((1 - Math.sin(path.elevation * RAD) * 2.6) * day * (1 - overcast));
  }

  const fogDensity = clamp01(Math.max(e.fog.density, look.fog * intensity, wIn === weather ? unit(weather?.fog, 0) : 0));
  const fogBase = look.fogColor ?? mix3(sky, [0.80, 0.82, 0.86], 0.55);
  // fog is lit like the sky it hangs under: dimmer, cooler at night
  const fogColor = neutral ? fogBase : mix3(fogBase, mix3(fogBase, sky, 0.5).map((c) => c * 0.7), clamp01(darkness * 1.4));
  const wetness = clamp01(Math.max(e.wetness, look.wet * intensity));
  const snow = clamp01(Math.max(e.snow, look.snow * intensity));

  return {
    neutral,
    hour: h,
    sun,
    moon,
    fill,
    bounce,
    sky,
    darkness,
    overcast,
    fog: { color: fogColor, density: fogDensity, height: 0.3 + e.fog.height * 2.7 },
    haze: clamp01(haze + look.haze * intensity + fogDensity * 0.15),
    shafts: clamp01(shafts * Math.min(1, fogDensity * 2.5 + haze * 1.5)),
    clouds: { cover, speed: 0.12 + e.wind.strength * 0.7 },
    weather: { kind, intensity, tint },
    lightning: kind === "storm" && intensity >= 0.3,
    wind: { x: wx, z: wz, speed: kind === "sand" || kind === "blizzard" ? Math.max(e.wind.strength, 0.5 * intensity) : e.wind.strength },
    water: { x: fx, z: fz, speed: e.water.speed },
    wetness,
    snow,
    mist: clamp01(fogDensity * 0.8 + (neutral ? 0 : (1 - (sun.day ?? 1)) * 0.25 + (h !== null && h > 4.5 && h < 8.5 ? 0.3 : 0))),
  };
}

function smoothstepJS(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
function mix3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/* ───────────────────────────── calendar weather ───────────────────────────── */

/**
 * The Weather feature's effect (clocks-tracker weather presets: an effect spec
 * with `kind`, `archetype`, `intensity`, `tintParticle`) → a diorama weather.
 * The named kinds win; an unknown or custom kind falls back on its archetype.
 * @returns {{kind:string, intensity:number, tint:number[]|null, fog:number}}
 */
export function weatherFromEffect(effect) {
  if (!effect || typeof effect !== "object") return { kind: "clear", intensity: 0, tint: null, fog: 0 };
  const BY_KIND = {
    clear: "clear", clouds: "clear", fog: "clear", rain: "rain", "heavy-rain": "rain", storm: "storm", wind: "leaves",
    snow: "snow", blizzard: "blizzard", hail: "rain", sand: "sand", "acid-rain": "rain", "blood-rain": "rain",
    ashfall: "ash", "ember-storm": "embers", "arcane-mist": "clear", "spore-bloom": "fireflies", aurora: "fireflies",
    miasma: "clear", "meteor-shower": "embers", "crimson-lightning": "storm",
  };
  const BY_ARCH = {
    clear: "clear", streaks: "rain", flakes: "snow", volume: "clear", flashes: "storm", motes: "fireflies", embers: "embers",
    gusts: "sand", shards: "rain", spores: "fireflies", drips: "rain", dust: "sand", swarm: "fireflies",
  };
  const kind = BY_KIND[effect.kind] ?? BY_ARCH[effect.archetype] ?? "clear";
  const intensity = unit(effect.intensity, 0.6);
  // a fog-like effect brings fog instead of particles
  const foggy = effect.archetype === "volume" || effect.kind === "fog" || effect.kind === "miasma";
  const fog = foggy ? intensity : 0;
  // a tint only where the effect's colour is the point (blood rain, acid rain, aurora)
  const tinted = ["acid-rain", "blood-rain", "spore-bloom", "aurora", "meteor-shower", "crimson-lightning"].includes(effect.kind);
  const tint = tinted ? hexRgb(effect.tintParticle) : null;
  return { kind, intensity: kind === "clear" ? 0 : intensity, tint, fog };
}

function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** "14:30" for an hour (the panel's readout). */
export function formatHour(hour) {
  if (hour === null || hour === undefined) return "";
  const m = Math.round((((Number(hour) % 24) + 24) % 24) * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
