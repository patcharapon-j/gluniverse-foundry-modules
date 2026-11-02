/**
 * The scene environment (environment.mjs, view/environment-source.mjs,
 * view/environment-app.mjs, render/atmosphere.mjs). Everything it pins fails
 * silently: a sun that jumps at an hour boundary, a default scene that no
 * longer looks like it did, a weather kind with no label, a uniform the layer
 * never writes, a flag write that merges, a lightning schedule that strobes.
 */

import { readFileSync } from "node:fs";

/** The fixed light every view drew before the environment existed. */
const TODAY = Object.freeze({
  dir: (() => { const v = [-0.74, 0.62, -0.26]; const l = Math.hypot(...v); return v.map((c) => c / l); })(),
  key: [0.86, 0.80, 0.70],
  fill: [0.46, 0.50, 0.58],
  bounce: [0.10, 0.08, 0.055],
  sky: [0.72, 0.82, 0.92],
});

const near = (a, b, eps = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);
const flat = (o, p = "", out = {}) => {
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out); else out[key] = v;
  }
  return out;
};

export default async function check(ctx) {
  const E = await import(ctx.url("scripts/features/diorama/environment.mjs"));
  const { SUITE_ID } = await import(ctx.url("scripts/core/const.mjs"));
  const read = (rel) => readFileSync(new URL(ctx.url(rel)), "utf8");

  // ── the flag ──
  ctx.ok("the default flag is total and stable", JSON.stringify(E.normalizeEnv(null)) === JSON.stringify(E.normalizeEnv(E.normalizeEnv({}))));
  const junk = E.normalizeEnv({ hour: "x", weather: { kind: "lava", intensity: 9 }, wind: { dir: -90, strength: -1 }, fog: "no", clouds: 3 });
  ctx.ok("junk normalises to something drawable", junk.hour === null && junk.weather.kind === "clear" && junk.weather.intensity === 0
    && junk.wind.dir === 270 && junk.wind.strength === 0 && junk.clouds === 1, JSON.stringify(junk));
  for (const k of E.PRESET_KEYS) {
    const p = E.applyPreset(k);
    const again = E.normalizeEnv(p);
    ctx.ok(`preset ${k} normalises to itself`, JSON.stringify(p) === JSON.stringify(again) && p.preset === k, JSON.stringify(p));
    ctx.ok(`preset ${k} has an icon`, /^fa-(solid|regular) fa-[a-z-]+$/.test(E.PRESETS[k].icon ?? ""));
    const r = E.resolveEnv(p);
    ctx.ok(`preset ${k} resolves to finite numbers`, Object.values(flat(r)).every((v) => v === null || typeof v === "boolean" || typeof v === "string"
      || (Array.isArray(v) ? v.every(Number.isFinite) : Number.isFinite(v))), JSON.stringify(r));
  }

  // ── the sun's path: one continuous curve, never under the board ──
  let worst = 0, lowest = 90, dayLow = 90, prev = null;
  for (let i = 0; i <= 24 * 50; i++) {
    const h = i / 50;
    const r = E.resolveEnv({ hour: h % 24 });
    const d = r.sun.dir;
    if (prev) worst = Math.max(worst, Math.acos(Math.min(1, d[0] * prev[0] + d[1] * prev[1] + d[2] * prev[2])) * 180 / Math.PI);
    prev = d;
    lowest = Math.min(lowest, r.sun.elevation);
    if (h >= 8 && h <= 16) dayLow = Math.min(dayLow, r.sun.elevation);
    if (!Object.values(r.sun.color).every(Number.isFinite) || r.sun.color.some((c) => c < 0 || c > 1.25)) {
      ctx.ok(`the key light stays in range at ${h}`, false, JSON.stringify(r.sun.color));
      break;
    }
  }
  ctx.ok("the key moves continuously through the day (< 5° per 1.2 min)", worst < 5, `${worst.toFixed(2)}°`);
  ctx.ok("the key never drops under the board", lowest >= E.MIN_ELEVATION - 1e-6, `${lowest.toFixed(2)}°`);
  ctx.ok("by day the sun stands well up (8:00 to 16:00 ≥ 20°)", dayLow >= 20, `${dayLow.toFixed(2)}°`);
  const noon = E.resolveEnv({ hour: 12 }), midnight = E.resolveEnv({ hour: 0 });
  ctx.ok("midday is day and midnight is night", noon.sun.day > 0.99 && midnight.sun.day < 0.01 && midnight.darkness > noon.darkness);
  ctx.ok("the darkness source does not darken a second time", E.resolveEnv({ hour: 0 }, { foundryDims: true }).darkness === 0);
  ctx.ok("darkness maps to an hour (0 day, 1 midnight)", E.darknessToHour(0) === 13 && E.darknessToHour(1) === 24);

  // ── day and night off reproduces today's light exactly ──
  for (const env of [null, E.applyPreset("night"), E.applyPreset("storm"), { hour: 6 }]) {
    const r = E.resolveEnv(env, { dayNight: false });
    ctx.ok(`dayNight off is today's light (${env?.preset ?? env?.hour ?? "default"})`,
      r.neutral && near(r.sun.dir, TODAY.dir) && near(r.sun.color, TODAY.key) && near(r.fill, TODAY.fill)
      && near(r.bounce, TODAY.bounce) && near(r.sky, TODAY.sky) && r.darkness === 0, JSON.stringify([r.sun, r.fill]));
  }
  ctx.ok("NEUTRAL_LIGHT is today's light", near(E.NEUTRAL_LIGHT.dir, TODAY.dir) && near(E.NEUTRAL_LIGHT.key, TODAY.key)
    && near(E.NEUTRAL_LIGHT.fill, TODAY.fill) && near(E.NEUTRAL_LIGHT.bounce, TODAY.bounce) && near(E.NEUTRAL_LIGHT.sky, TODAY.sky));
  const d0 = E.resolveEnv(null);
  ctx.ok("a scene the GM never touched draws no air, no weather", d0.neutral && d0.fog.density === 0 && d0.haze === 0 && d0.clouds.cover === 0
    && d0.overcast === 0 && d0.wetness === 0 && d0.snow === 0 && d0.shafts === 0 && d0.mist === 0 && d0.weather.intensity === 0 && !d0.lightning,
    JSON.stringify(d0));
  const weatherNeutral = E.resolveEnv(E.applyPreset("rain"), { dayNight: false });
  ctx.ok("dayNight off still shows the weather", weatherNeutral.weather.kind === "rain" && weatherNeutral.weather.intensity > 0);

  // ── calendar weather ──
  ctx.ok("calendar weather maps by kind, then archetype", E.weatherFromEffect({ kind: "heavy-rain", intensity: 0.8 }).kind === "rain"
    && E.weatherFromEffect({ kind: "custom", archetype: "flakes", intensity: 0.4 }).kind === "snow"
    && E.weatherFromEffect({ kind: "fog", archetype: "volume", intensity: 0.7 }).fog === 0.7
    && E.weatherFromEffect(null).kind === "clear");
  ctx.ok("a calendar fog thickens the scene's", E.resolveEnv({ hour: 12 }, { weather: E.weatherFromEffect({ kind: "fog", archetype: "volume", intensity: 0.7 }) }).fog.density >= 0.7);

  // ── the GLSL aliases and the shared uniforms ──
  const glsl = read("scripts/features/diorama/render/glsl.mjs");
  ctx.ok("the light constants are now the environment's uniforms", /#define SKY_FILL uEnvFill/.test(glsl) && /#define SUN_KEY uEnvKey/.test(glsl)
    && /#define BOUNCE uEnvBounce/.test(glsl) && !/const vec3 SKY_FILL/.test(glsl));
  ctx.ok("dioFinish keeps its signature", /vec3 dioFinish\(vec3 c, float vis, vec3 wp\)/.test(glsl));
  ctx.ok("shade keeps its signature", /vec3 shade\(vec3 albedo, vec3 wp, vec3 n, float ao, vec2 lightXZ\)/.test(glsl), "shade(albedo, wp, n, ao, lightXZ)");
  const { createShared } = await import(ctx.url("scripts/features/diorama/render/materials.mjs"));
  const shared = createShared();
  const arr = (v) => [v.x, v.y, v.z];
  ctx.ok("the shared light starts as today's", near(arr(shared.uKeyDir.value), TODAY.dir) && near(arr(shared.uEnvKey.value), TODAY.key)
    && near(arr(shared.uEnvFill.value), TODAY.fill) && near(arr(shared.uEnvBounce.value), TODAY.bounce) && near(arr(shared.uEnvSky.value), TODAY.sky));
  const atmoSrc = read("scripts/features/diorama/render/atmosphere.mjs");
  const envUniforms = Object.keys(shared).filter((k) => k.startsWith("uEnv"));
  const unwritten = envUniforms.filter((k) => !new RegExp(`\\b${k}\\.value\\b`).test(atmoSrc));
  ctx.ok("the atmosphere layer writes every environment uniform", !unwritten.length, unwritten.join(", "));
  const unread = envUniforms.filter((k) => !new RegExp(`\\b${k}\\b`).test(glsl));
  ctx.ok("every environment uniform is read by a program", !unread.length, unread.join(", "));

  // ── frame(): no per-particle work on the CPU ──
  const m = /\n {2}frame\(t, dt, camera, fx, view\) \{([\s\S]*?)\n {2}\}\n/.exec(atmoSrc);
  ctx.ok("frame() is found", !!m);
  if (m) ctx.ok("frame() never loops (positions come from the vertex shader)", !/\bfor\s*\(|\bwhile\s*\(|\.forEach\(|\.map\(|\.reduce\(|\bnew\s+[A-Z]/.test(m[1]),
    "frame() must not loop over particles or allocate");

  // ── the layer, driven ──
  const { AtmosphereLayer } = await import(ctx.url("scripts/features/diorama/render/atmosphere.mjs"));
  const L = new AtmosphereLayer(createShared());
  const fxFull = { weather: 2, atmosphere: true, water: 1, detail: 1, grade: true };
  const view = { tx: 5, ty: 0, tz: 5, zoom: 1 };
  ctx.ok("neutral and calm asks for no frames", L.animated(fxFull) === false && L.frame(0, 0.016, null, fxFull, view) === false
    && L.pGeo.instanceCount === 0 && L.sGeo.instanceCount === 0);
  const u = L.shared;
  ctx.ok("neutral writes no air", u.uEnvFog.value.w === 0 && u.uEnvAtmo.value.y === 0 && u.uEnvAtmo.value.z === 0 && u.uEnvClouds.value.x === 0
    && u.uEnvSurface.value.x === 0 && u.uEnvSurface.value.y === 0 && u.uEnvOvercast.value === 0 && u.uEnvFlash.value === 0);
  ctx.ok("the same environment twice is no change", L.setEnvironment(null) === false && L.setEnvironment(E.resolveEnv(null, { dayNight: false })) === false);
  const { Terrain } = await import(ctx.url("scripts/features/diorama/terrain/model.mjs"));
  const { KIND } = await import(ctx.url("scripts/features/diorama/constants.mjs"));
  const tf = Terrain.blank(10, 10, () => true);
  L.setTerrain(tf, { minY: 0, maxY: 0 });
  ctx.ok("rain changes the environment", L.setEnvironment(E.resolveEnv(E.applyPreset("rain"))) === true);
  ctx.ok("rain animates and draws", L.frame(0, 0.016, null, fxFull, view) === true && L.pGeo.instanceCount > 0 && L.sGeo.instanceCount > 0);
  const full = L.pGeo.instanceCount;
  L.frame(0, 0.016, null, { ...fxFull, weather: 1 }, view);
  ctx.ok("reduced weather draws about a third", Math.abs(L.pGeo.instanceCount - full / 3) <= 2, `${L.pGeo.instanceCount} of ${full}`);
  L.frame(0, 0.016, null, { ...fxFull, weather: 0 }, view);
  ctx.ok("weather off draws none and adds no rain to the water", L.pGeo.instanceCount === 0 && L.sGeo.instanceCount === 0 && u.uEnvFlow.value.w === 0);
  ctx.ok("the instance pool covers every kind's maximum", L.pGeo.attributes.aSeed.count >= 5200);
  // lightning: rare and never strobing
  L.setEnvironment(E.resolveEnv(E.applyPreset("storm")));
  let starts = [], peak = 0, was = 0;
  for (let i = 0; i < 60 * 180; i++) {
    L.frame(0, 1 / 60, null, fxFull, view);
    const f = u.uEnvFlash.value;
    peak = Math.max(peak, f);
    if (f > 0.02 && was <= 0.02 && (!starts.length || i / 60 - starts[starts.length - 1] > 1)) starts.push(i / 60);
    was = f;
  }
  const gaps = starts.slice(1).map((s, i) => s - starts[i]);
  ctx.ok("a storm strikes lightning", starts.length >= 6, `${starts.length} strikes in 180 s`);
  ctx.ok("lightning never strobes (≥ 5 s apart)", gaps.every((g) => g >= 5), JSON.stringify(gaps.map((g) => g.toFixed(1))));
  ctx.ok("lightning stays soft (flash ≤ 0.55)", peak <= 0.55 + 1e-6 && peak > 0.1, String(peak));
  L.frame(0, 0.016, null, { ...fxFull, weather: 0 }, view);
  ctx.ok("weather off stops the lightning", u.uEnvFlash.value === 0);
  L.setEnvironment(null);
  L.frame(0, 0.016, null, fxFull, view);
  ctx.ok("back to neutral restores today's sun", near(arr(u.uKeyDir.value), TODAY.dir) && near(arr(u.uEnvKey.value), TODAY.key) && L.animated(fxFull) === false);
  L.dispose();

  // ── the water edge in the terrain ──
  const { buildTerrainField, FIELD_PX_PER_CELL: P } = await import(ctx.url("scripts/features/diorama/render/terrain-field.mjs"));
  const { buildTerrainMesh } = await import(ctx.url("scripts/features/diorama/render/terrain-mesh.mjs"));
  const wt = Terrain.blank(8, 6, () => true);
  for (let si = 0; si < 12; si++) for (let sj = 0; sj < 4; sj++) wt.set(si, sj, { h: 4, kind: KIND.WATER });   // an upper pool
  for (let si = 0; si < 12; si++) for (let sj = 4; sj < 8; sj++) wt.set(si, sj, { h: -4, kind: KIND.WATER });  // a lower pool
  for (let si = 0; si < 12; si++) for (let sj = 8; sj < 16; sj++) wt.set(si, sj, { h: 0 });                    // a bank
  const f = buildTerrainField(wt);
  const a = (x, z) => f.data[(Math.floor(z * P) * f.width + Math.floor(x * P)) * 4 + 3];
  ctx.ok("the wet band climbs the bank from the water and fades", a(4.03, 3) > 200 && a(4.2, 3) < a(4.03, 3) && a(6, 3) === 0,
    JSON.stringify([a(4.03, 3), a(4.2, 3), a(6, 3)]));
  ctx.ok("water itself reads fully wet", a(1, 3) === 255);
  const wm = buildTerrainMesh(wt);
  const falls = [];
  for (let i = 0; i < wm.sides.flag.length; i++) if (wm.sides.flag[i] >= 8) falls.push(i);
  ctx.ok("water spilling into lower water is a waterfall (+8)", falls.length > 0);
  const top = falls.length ? Math.max(...falls.map((i) => wm.sides.position[i * 3 + 1])) : -1;
  ctx.ok("a waterfall starts at the upper water's surface, not its bed", Math.abs(top - (4 - 0.3) / 4) < 1e-4, String(top));
  const flat2 = Terrain.blank(6, 6, () => true);
  for (let si = 0; si < 12; si++) for (let sj = 0; sj < 4; sj++) flat2.set(si, sj, { h: -1, kind: KIND.WATER });
  ctx.ok("a pond below its bank has no waterfall", ![...buildTerrainMesh(flat2).sides.flag].some((x) => x >= 8));

  // ── where the environment comes from: the flag, both diff shapes, forced writes ──
  const saved = { game: globalThis.game, foundry: globalThis.foundry };
  try {
    const settings = { "dio.envSource": "scene", "dio.weatherSource": "scene", "dio.dayNight": true };
    globalThis.game = {
      user: { isGM: true },
      settings: { get: (_m, k) => settings[k] },
      modules: { get: () => null },
      i18n: { localize: (k) => k, format: (k) => k },
    };
    const S = await import(ctx.url("scripts/features/diorama/view/environment-source.mjs"));
    const flagged = E.applyPreset("dusk");
    const scene = {
      flags: {}, darkness: 0.5, environment: { darknessLevel: 0.5 },
      getFlag: (scope, key) => (scope === SUITE_ID && key === "dio.env" ? flagged : undefined),
      updates: [], update(u) { this.updates.push(u); return Promise.resolve(this); },
    };
    const r1 = S.sceneEnvironment(scene, { dayNight: true });
    ctx.ok("the scene source reads the flag's hour", r1.hour === flagged.hour && !r1.neutral);
    ctx.ok("dayNight off for this user is today's light", S.sceneEnvironment(scene, { dayNight: false }).neutral);
    settings["dio.envSource"] = "darkness";
    const r2 = S.sceneEnvironment(scene, { dayNight: true });
    ctx.ok("the darkness source takes the hour from Foundry's darkness, and does not dim again", r2.hour === E.darknessToHour(0.5) && r2.darkness === 0);
    settings["dio.envSource"] = "calendar";
    ctx.ok("the calendar source with Clocks & Tracker off falls back on the flag", S.sceneEnvironment(scene, { dayNight: true }).hour === flagged.hour);
    settings["dio.weatherSource"] = "calendar";
    ctx.ok("calendar weather with the feature off falls back on the flag", S.sceneEnvironment(scene).weather.kind === flagged.weather.kind);
    ctx.ok("the panel is told the calendar is not answering", S.environmentSources().timeLive === false && S.environmentSources().weatherLive === false);
    ctx.ok("no scene, no environment", S.sceneEnvironment(null) === null);

    const yes = [
      { flags: { [SUITE_ID]: { "dio.env": { hour: 3 } } } },
      { flags: { [SUITE_ID]: { dio: { env: { hour: 3 } } } } },
      { flags: { [SUITE_ID]: { "dio.==env": { hour: 3 } } } },
      { flags: { [SUITE_ID]: { dio: { "==env": { hour: 3 } } } } },
      { flags: { [SUITE_ID]: { dio: { "-=env": null } } } },
      { flags: { [SUITE_ID]: { "-=dio": null } } },
    ];
    const no = [
      {}, { flags: {} }, { flags: { [SUITE_ID]: { "dio.terrain": {} } } }, { flags: { [SUITE_ID]: { dio: { terrain: {} } } } },
      { flags: { other: { "dio.env": {} } } },
    ];
    ctx.ok("an env change is seen in every diff shape", yes.every((c) => S.environmentTouched(c)), JSON.stringify(yes.map((c) => S.environmentTouched(c))));
    ctx.ok("other flag changes are not an env change", no.every((c) => !S.environmentTouched(c)), JSON.stringify(no.map((c) => S.environmentTouched(c))));
    ctx.ok("ENV_HOOKS hear time, the calendar and the weather", S.ENV_HOOKS.includes("updateWorldTime")
      && S.ENV_HOOKS.some((h) => h.endsWith(".weatherChanged")) && S.ENV_HOOKS.includes("updateSetting"));

    globalThis.foundry = undefined;
    await S.writeEnvironment(scene, { hour: 9, weather: { kind: "rain", intensity: 0.4 } });
    const u13 = scene.updates.at(-1);
    ctx.ok("a v13 write is a forced replacement (==)", u13 && Object.keys(u13).length === 1 && `flags.${SUITE_ID}.dio.==env` in u13
      && u13[`flags.${SUITE_ID}.dio.==env`].hour === 9, JSON.stringify(u13));
    globalThis.foundry = { data: { operators: { ForcedReplacement: { create: (v) => ({ forced: v }) } } } };
    await S.writeEnvironment(scene, { hour: 10 });
    const u14 = scene.updates.at(-1);
    ctx.ok("a v14 write is a ForcedReplacement of the whole flag", u14?.[`flags.${SUITE_ID}.dio.env`]?.forced?.hour === 10
      && u14[`flags.${SUITE_ID}.dio.env`].forced.weather.kind === "clear", JSON.stringify(u14));
    globalThis.game.user.isGM = false;
    const n = scene.updates.length;
    ctx.ok("a player writes nothing", (await S.writeEnvironment(scene, { hour: 1 })) === false && scene.updates.length === n);
  } finally {
    globalThis.game = saved.game;
    globalThis.foundry = saved.foundry;
  }

  // ── every label the panel builds at runtime resolves ──
  const lang = {};
  for (const f of ["lang/diorama-env.en.json", "lang/diorama.en.json"]) Object.assign(lang, flat(JSON.parse(read(f))));
  const App = await import(ctx.url("scripts/features/diorama/view/environment-app.mjs"));
  const keys = [
    ...E.PRESET_KEYS.map((k) => `GLDIO.env.preset.${k}`),
    ...E.WEATHER_KINDS.map((k) => `GLDIO.env.kind.${k}`),
    ...["presets", "time", ...App.SECTIONS.map((s) => s.name)].map((s) => `GLDIO.env.section.${s}`),
    ...["tableLight", "hour", "kind", ...App.SECTIONS.flatMap((s) => s.rows.map((r) => r.name))].map((k) => `GLDIO.env.field.${k}`),
    ...App.SHORTCUTS.map(([k]) => `GLDIO.env.at.${k}`),
  ];
  const appSrc = read("scripts/features/diorama/view/environment-app.mjs");
  for (const [, k] of appSrc.matchAll(/"(GLDIO\.env\.[A-Za-z0-9_.]+)"/g)) keys.push(k);
  const missing = [...new Set(keys)].filter((k) => typeof lang[k] !== "string" || !lang[k]);
  ctx.ok("every GLDIO.env key the panel builds resolves", !missing.length, missing.join(", "));
  ctx.ok("the toolbar's environment button is labelled", typeof lang["GLDIO.view.environment"] === "string");
}
