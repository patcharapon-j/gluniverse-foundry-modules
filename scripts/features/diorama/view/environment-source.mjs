/**
 * Diorama — where a scene's environment comes from, and the only reader and
 * writer of its flag. Reads the world; environment.mjs is the pure half.
 *
 *   sceneEnvironment(scene, { dayNight }) → resolved env | null
 *       the scene flag (FLAG_ENV), with the time of day from the source the GM
 *       chose (dio.envSource: scene | darkness | calendar) and the weather from
 *       dio.weatherSource (scene | calendar). dayNight false = this user wants
 *       today's fixed light whatever the scene says (weather still shows).
 *   readEnvironment(scene) → the stored flag, normalised
 *   writeEnvironment(scene, env) → Promise<bool>   GM only, a FORCED replacement
 *   environmentSources() → where time and weather really come from right now
 *   environmentTouched(changes) → bool   an updateScene diff moved FLAG_ENV
 *   ENV_HOOKS: string[]                  hooks after which the env may differ
 *
 * Every write is a forced replacement (as terrain/store.mjs): a plain nested
 * update merges, so a weather the GM cleared would survive the write.
 *
 * Calendar time and weather come from the Clocks & Tracker feature's api, only
 * while that feature (and, for weather, its Weather sub-feature) is on. When it
 * is off, or has nothing to say, the scene's own flag answers.
 */

import { SUITE_ID } from "../../../core/const.mjs";
import { Features } from "../../../core/registry.mjs";
import { HOOKS as CT_HOOKS } from "../../clocks-tracker/const.js";
import { FLAG_ENV } from "../constants.mjs";
import { normalizeEnv, resolveEnv, darknessToHour, weatherFromEffect } from "../environment.mjs";
import { setting } from "./util.mjs";

const ENV_PATH = `flags.${SUITE_ID}.${FLAG_ENV}`;
const [ENV_ROOT, ENV_LEAF] = FLAG_ENV.split(".");

/** Hooks after which the environment may differ (time, the calendar, the weather walk). */
export const ENV_HOOKS = Object.freeze([
  "updateWorldTime",
  CT_HOOKS.timeChanged,
  CT_HOOKS.calendarChanged,
  CT_HOOKS.weatherChanged,
  // the weather walk reaches players as a world-setting update (weatherChanged
  // fires on the GM's client only); an unchanged environment costs nothing
  "updateSetting",
]);

function ctApi() {
  try {
    if (!Features.on("clocks-tracker")) return null;
    return globalThis.game?.modules?.get(SUITE_ID)?.api?.features?.["clocks-tracker"] ?? null;
  } catch {
    return null;
  }
}

/** The calendar's hour on a 24-hour dial, to the minute; null when it has none. */
function calendarHour() {
  const api = ctApi();
  if (!api?.TimeEngine) return null;
  try {
    const c = api.TimeEngine.components;
    const days = api.TimeEngine.calendar?.days ?? {};
    const hpd = Number(days.hoursPerDay) || 24, mph = Number(days.minutesPerHour) || 60, spm = Number(days.secondsPerMinute) || 60;
    if (!c || !Number.isFinite(Number(c.hour))) return null;
    const h = (Number(c.hour) + (Number(c.minute) || 0) / mph + (Number(c.second) || 0) / (mph * spm)) / hpd * 24;
    return Math.round(h * 60) / 60;
  } catch {
    return null;
  }
}

/** The Weather feature's current condition as a diorama weather; null when it has none. */
function calendarWeather() {
  const api = ctApi();
  if (!api?.WeatherEngine) return null;
  try {
    if (!Features.on("clocks-weather")) return null;
    const effect = api.WeatherEngine.getCurrent()?.hex?.effect;
    return effect ? weatherFromEffect(effect) : null;
  } catch {
    return null;
  }
}

function sceneDarkness(scene) {
  const d = scene?.environment?.darknessLevel ?? scene?.darkness ?? 0;
  return Number.isFinite(Number(d)) ? Number(d) : 0;
}

/** The stored flag, normalised (any shape in, a total object out). */
export function readEnvironment(scene) {
  let raw = null;
  try { raw = scene?.getFlag?.(SUITE_ID, FLAG_ENV) ?? null; } catch { raw = null; }
  return normalizeEnv(raw);
}

/**
 * Where time and weather come from right now, for the panel's notes.
 * `time`/`weather` is the GM's choice; `*Live` whether that source is answering
 * (a calendar choice with the feature off falls back on the scene).
 */
export function environmentSources() {
  const time = setting("dio.envSource", "scene");
  const weather = setting("dio.weatherSource", "scene");
  return {
    time,
    timeLive: time === "darkness" || (time === "calendar" && calendarHour() !== null),
    weather,
    weatherLive: weather === "calendar" && calendarWeather() !== null,
  };
}

/**
 * The scene's environment, resolved for this user.
 * @param {Scene|null} scene
 * @param {{dayNight?: boolean}} [o]
 */
export function sceneEnvironment(scene, { dayNight = true } = {}) {
  if (!scene) return null;
  const env = readEnvironment(scene);
  const src = setting("dio.envSource", "scene");
  let hour, foundryDims = false;
  if (src === "darkness") { hour = darknessToHour(sceneDarkness(scene)); foundryDims = true; }
  else if (src === "calendar") { const h = calendarHour(); if (h !== null) hour = h; }
  const weather = setting("dio.weatherSource", "scene") === "calendar" ? calendarWeather() : null;
  return resolveEnv(env, { hour, weather, dayNight, foundryDims });
}

/** Save the scene's environment (GM only): a forced replacement of the whole flag. */
export async function writeEnvironment(scene, env) {
  if (!globalThis.game?.user?.isGM || !scene) return false;
  const value = normalizeEnv(env);
  const O = globalThis.foundry?.data?.operators;
  const upd = {};
  if (O?.ForcedReplacement) upd[ENV_PATH] = O.ForcedReplacement.create(value);
  else upd[`flags.${SUITE_ID}.${ENV_ROOT}.==${ENV_LEAF}`] = value;
  await scene.update(upd);
  return true;
}

/**
 * Whether an updateScene diff touched the environment flag. Foundry does not
 * agree with itself on a dotted key's shape: a setFlag diff carries the literal
 * "dio.env" key, an update through the path carries it nested, and forced
 * replacements and deletions carry `==` / `-=` forms of either.
 */
export function environmentTouched(changes) {
  const f = changes?.flags?.[SUITE_ID];
  if (!f || typeof f !== "object") return false;
  for (const k of [FLAG_ENV, `==${FLAG_ENV}`, `-=${FLAG_ENV}`, `${ENV_ROOT}.==${ENV_LEAF}`, `${ENV_ROOT}.-=${ENV_LEAF}`, `==${ENV_ROOT}`, `-=${ENV_ROOT}`]) {
    if (k in f) return true;
  }
  const d = f[ENV_ROOT];
  return !!d && typeof d === "object" && (ENV_LEAF in d || `==${ENV_LEAF}` in d || `-=${ENV_LEAF}` in d);
}
