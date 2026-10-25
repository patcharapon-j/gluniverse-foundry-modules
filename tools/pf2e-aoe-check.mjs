#!/usr/bin/env node
/** Static contract checks for the PF2e Spellglass Region renderer. */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ARCHETYPES, SETTINGS } from "../scripts/features/pf2e-aoe/constants.mjs";
import { AoeAnim, SHED_ORDER, TIMING, alertLevel, echoPhase } from "../scripts/features/pf2e-aoe/anim.mjs";
import { aggregateEvidence, classify } from "../scripts/features/pf2e-aoe/classifier.mjs";
import { collectEvidence } from "../scripts/features/pf2e-aoe/evidence.mjs";
import { convertLegacyStyle, migrationPreflight } from "../scripts/features/pf2e-aoe/migration.mjs";
import { measurementSummary } from "../scripts/features/pf2e-aoe/measurement.mjs";
import { materialDescriptor } from "../scripts/features/pf2e-aoe/presentation.mjs";
import {
  BUILTIN_PROFILES, detachProfile, normalizeWorldProfiles, registerProfile,
  resolveProfile, unregisterProfiles,
} from "../scripts/features/pf2e-aoe/profiles.mjs";
import {
  AUDIENCES, BEHAVIORS, FUNCTIONS, GEOMETRIES, MATERIALS, PRESENTATION_SCHEMA, compactPresentation,
  SENSES, SOURCES, normalizePresentation, presentationLabel, validatePresentation,
} from "../scripts/features/pf2e-aoe/schema.mjs";
import {
  BEHAVIOR_MOTION, FUNCTION_LOOK, MATERIAL_COLORS, SIZES, TREATMENT_LOOK, composeLook,
} from "../scripts/features/pf2e-aoe/render/look.mjs";
import { PATTERN_IDS, TILE, paintPattern } from "../scripts/features/pf2e-aoe/render/patterns.mjs";
import {
  cellRects, convexCorners, dashes, interiorSeams, latticeLoops, partialLoops, perimeter, shapeLoop,
} from "../scripts/features/pf2e-aoe/render/outline.mjs";
import { itemFixtures, legacyFixtures, sourceFixtures } from "./fixtures/pf2e-aoe.mjs";

const ROOT = new URL("../", import.meta.url);
const errors = [];
const ok = (condition, message) => { if (!condition) errors.push(message); };
const text = async (path) => readFile(new URL(path, ROOT), "utf8");

/* Schema-v2 is a closed vocabulary. Test each value through the same explicit
   evidence contract integrations use instead of only counting enum entries. */
ok(FUNCTIONS.length === 12, "schema must expose all 12 canonical functions");
ok(MATERIALS.length === 26, "schema must expose all 26 canonical materials");
ok(BEHAVIORS.length === 10, "schema must expose all 10 canonical behaviors");
for (const value of FUNCTIONS) {
  const result = classify({}, { explicitSemantics: { function: value, material: "neutral", behavior: "static" } });
  ok(result.candidate.function === value && result.axisConfidence.function === "high", `function ${value} did not classify`);
}
for (const value of MATERIALS) {
  const result = classify({}, { explicitSemantics: { function: "neutral", material: value, behavior: "static" } });
  ok(result.candidate.material === value && result.axisConfidence.material === "high", `material ${value} did not classify`);
}
for (const value of BEHAVIORS) {
  const result = classify({}, { explicitSemantics: { function: "neutral", material: "neutral", behavior: value } });
  ok(result.candidate.behavior === value && result.axisConfidence.behavior === "high", `behavior ${value} did not classify`);
}
for (const [axis, values, fallback] of [
  ["audience", AUDIENCES, "unknown"], ["source", SOURCES, "unknown"],
  ["geometry", GEOMETRIES, "unknown"], ["sense", SENSES, null],
]) {
  for (const value of values) {
    const records = [
      { axis: "function", value: "neutral", weight: 100, source: "explicit", reason: "test" },
      { axis: "material", value: "neutral", weight: 100, source: "explicit", reason: "test" },
      { axis, value, weight: 100, source: "structure", reason: "modifier test" },
    ];
    const semantics = aggregateEvidence(records).candidate;
    const actual = axis === "sense" ? semantics.senses[0] ?? fallback : semantics[axis];
    ok(actual === value, `${axis} ${value} did not classify`);
  }
}

const badPresentation = {
  schema: PRESENTATION_SCHEMA,
  mode: "custom",
  overrides: { semantics: { function: "explode", material: "remote-texture" } },
  label: { mode: "inherit", value: "" },
};
ok(!validatePresentation(badPresentation).valid, "unknown schema IDs must be rejected");
const normalizedPresentation = normalizePresentation(badPresentation);
ok(!("function" in normalizedPresentation.overrides.semantics),
  "normalization must discard an unknown function override");
const compact = compactPresentation({ schema: 2, mode: "auto", overrides: { semantics: { function: "", material: "fire" } }, label: { mode: "inherit" } });
ok(compact.overrides?.semantics?.material === "fire" && !("function" in compact.overrides.semantics) && !compact.label,
  "persisted presentation must be sparse and discard blank overrides");
ok(presentationLabel({ label: { mode: "inherit" } }, "Fireball") === "Fireball", "inherited label failed");
ok(presentationLabel({ label: { mode: "custom", value: "  Silence  " } }, "Fireball") === "Silence", "custom label failed");
ok(presentationLabel({ label: { mode: "hidden", value: "Fireball" } }, "Fireball") === "", "hidden label must not fall back");

const fireball = classify(sourceFixtures.fireball, { item: itemFixtures.fireball });
ok(fireball.semantics.function === "harm" && fireball.semantics.material === "fire",
  "Fireball must resolve as fire harm");
ok(fireball.semantics.source === "spell" && fireball.semantics.geometry === "burst",
  "Fireball source and geometry modifiers were lost");
const renewal = classify(sourceFixtures.healingField, { item: itemFixtures.healingField });
ok(renewal.semantics.function === "restore" && renewal.semantics.material === "vitality",
  "healing vitality must resolve as restore rather than vitality harm");
const terrain = classify(sourceFixtures.difficultTerrain);
ok(terrain.semantics.function === "terrain" && terrain.semantics.behavior === "linger",
  "recognized movement behavior must resolve conservatively as terrain");
const unknown = classify(sourceFixtures.unknown);
ok(unknown.needsClassification && unknown.semantics.function === "neutral" && unknown.semantics.material === "neutral",
  "unknown structured data must use the neutral fallback");

const tieRecords = [
  { axis: "function", value: "harm", weight: 60, source: "trait", reason: "z" },
  { axis: "function", value: "restore", weight: 60, source: "trait", reason: "a" },
  { axis: "material", value: "fire", weight: 60, source: "trait", reason: "material" },
];
const tieA = aggregateEvidence(tieRecords);
const tieB = aggregateEvidence([...tieRecords].reverse());
ok(JSON.stringify(tieA.scores) === JSON.stringify(tieB.scores), "evidence results must not depend on input order");
ok(tieA.candidate.function === "harm" && tieA.needsClassification,
  "canonical tie must be deterministic and remain uncertain");
ok(collectEvidence(sourceFixtures.fireball, { item: itemFixtures.fireball })
  .every((entry) => !/description/i.test(entry.source)), "description prose must never become evidence");

ok(BUILTIN_PROFILES.length === 24, `expected 24 built-in profiles, found ${BUILTIN_PROFILES.length}`);
ok(new Set(BUILTIN_PROFILES.map((entry) => entry.id)).size === BUILTIN_PROFILES.length,
  "built-in profile ids must be unique");
for (const value of FUNCTIONS) ok(BUILTIN_PROFILES.some((entry) => entry.semantics.function === value), `no built-in profile covers ${value}`);
for (const value of MATERIALS) ok(materialDescriptor(value).id === value, `material ${value} has no colour pair`);
const worldProfiles = normalizeWorldProfiles({ schema: 1, profiles: [{
  id: "world:silence-field", name: "Silence Field",
  semantics: { function: "conceal", material: "sonic", behavior: "contain" },
}] });
const profiled = resolveProfile(sourceFixtures.unknown, {
  presentation: { schema: 2, mode: "profile", profileId: "world:silence-field", overrides: {}, label: { mode: "inherit" } },
  worldProfiles,
  inheritedLabel: "Silence",
});
ok(profiled.origin === "profile" && profiled.semantics.function === "conceal" && profiled.label === "Silence",
  "world profile and inherited label resolution failed");
const overridden = resolveProfile(sourceFixtures.unknown, {
  presentation: { schema: 2, mode: "profile", profileId: "world:silence-field", overrides: { semantics: { function: "protect" } } },
  worldProfiles,
});
ok(overridden.semantics.function === "protect" && overridden.semantics.material === "sonic",
  "sparse Region override must win without erasing the profile");
const native = resolveProfile(sourceFixtures.fireball, { presentation: { schema: 2, mode: "native" } });
ok(native.native && native.reason === "region-opt-out", "Region native mode must have highest precedence");
const detached = detachProfile(sourceFixtures.unknown, {
  presentation: { schema: 2, mode: "profile", profileId: "world:silence-field" }, worldProfiles,
});
ok(detached.mode === "custom" && detached.profileId === null && detached.overrides.semantics.function === "conceal",
  "detaching must materialize a profile into Region overrides");
registerProfile("test-suite", {
  id: "test-suite:moon-field", name: "Moon Field",
  semantics: { function: "support", material: "light", behavior: "pulse" },
});
ok(resolveProfile({}, { presentation: { schema: 2, mode: "profile", profileId: "test-suite:moon-field" } }).profileId === "test-suite:moon-field",
  "namespaced extension profile did not resolve");
ok(unregisterProfiles("test-suite") === 1, "extension profile cleanup failed");

const migratedFire = convertLegacyStyle(legacyFixtures[0].style);
ok(migratedFire.snapshot.semantics.function === "harm" && migratedFire.snapshot.semantics.material === "fire",
  "legacy Ember conversion failed");
ok(migratedFire.label.mode === "custom" && migratedFire.overrides.appearance.palette.body === "#ff5500",
  "legacy label/color intent was not preserved");
ok(convertLegacyStyle(legacyFixtures[1].style).label.mode === "hidden", "legacy explicit blank label must remain hidden");
ok(JSON.stringify(convertLegacyStyle(migratedFire)) === JSON.stringify(migratedFire),
  "schema-v2 migration conversion must be idempotent");
const preflight = migrationPreflight(legacyFixtures, {
  moduleVersion: "test", systemVersion: "test", generatedAt: "2026-01-01T00:00:00.000Z",
  legacySettings: { ember: "#ff5500" },
});
ok(preflight.counts.affected === 4 && preflight.counts.warnings === 3,
  "migration preflight counts or validation warnings changed");
ok(preflight.entries[0].uuid === "Scene.A.Region.1" && preflight.entries.at(-1).presentation.mode === "native",
  "migration preflight must be stable and preserve native opt-outs");
ok(measurementSummary({ shapes: [{ type: "line", length: 1200, width: 100 }], flags: { pf2e: { areaShape: "line" } } },
  { gridSize: 100, gridDistance: 5, units: "ft" }) === "60 × 5 ft • LINE", "line measurement summary is inaccurate");
ok(measurementSummary({ shapes: [{ type: "cone", radius: 400, angle: 90 }], flags: { pf2e: { areaShape: "cone" } } },
  { gridSize: 100, gridDistance: 5, units: "ft" }) === "20 ft • CONE • 90°", "cone measurement summary is inaccurate");

ok(ARCHETYPES.length === 14, `expected 14 legacy archetypes, found ${ARCHETYPES.length}`);
ok(new Set(ARCHETYPES).size === ARCHETYPES.length, "archetype ids must be unique");

/* ---- the look: every meaning must look different ----------------------
   Function owns the pattern, rim, alert and accent; material owns the colour
   pair; behaviour owns the motion. Two values on one axis that draw the same
   thing are two meanings a player cannot tell apart, and nothing errors. */
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const oklab = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => lin(Number.parseInt(hex.slice(i, i + 2), 16)));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
};
const dist = (a, b) => { const [p, q] = [oklab(a), oklab(b)]; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
const HEX6 = /^#[0-9a-f]{6}$/;
for (const fn of FUNCTIONS) {
  const look = FUNCTION_LOOK[fn];
  ok(Boolean(look), `function ${fn} has no look`);
  if (!look) continue;
  ok(PATTERN_IDS.includes(look.pattern), `function ${fn} names an unknown pattern ${look.pattern}`);
  ok(HEX6.test(look.accent), `function ${fn} accent is not #rrggbb`);
  ok(["solid", "double", "dashed", "dotted", "chain", "tape"].includes(look.rim), `function ${fn} has an unknown rim`);
  ok(["heartbeat", "breathe", "throb", "strobe", "none"].includes(look.alert), `function ${fn} has an unknown alert`);
  ok((look.alert === "none") === !(look.period > 0), `function ${fn}: an alert needs a period and only an alert has one`);
  ok(look.fill >= 0.12 && look.patternAlpha >= 0.45 && look.rimPx >= 2,
    `function ${fn} is drawn too faintly to read (fill, pattern or rim)`);
}
ok(Object.keys(FUNCTION_LOOK).length === FUNCTIONS.length, "FUNCTION_LOOK must cover exactly the schema functions");
ok(new Set(FUNCTIONS.map((fn) => FUNCTION_LOOK[fn]?.pattern)).size === FUNCTIONS.length,
  "every function must draw its own pattern");
for (let i = 0; i < FUNCTIONS.length; i++) {
  for (let j = i + 1; j < FUNCTIONS.length; j++) {
    const [a, b] = [FUNCTIONS[i], FUNCTIONS[j]];
    ok(dist(FUNCTION_LOOK[a].accent, FUNCTION_LOOK[b].accent) >= 0.09, `function accents ${a} and ${b} are too close to tell apart`);
  }
}
ok(Object.keys(MATERIAL_COLORS).length === MATERIALS.length, "MATERIAL_COLORS must cover exactly the schema materials");
for (const m of MATERIALS) ok((MATERIAL_COLORS[m] ?? []).every((hex) => HEX6.test(hex)), `material ${m} colours are not #rrggbb`);
for (let i = 0; i < MATERIALS.length; i++) {
  for (let j = i + 1; j < MATERIALS.length; j++) {
    const [a, b] = [MATERIAL_COLORS[MATERIALS[i]], MATERIAL_COLORS[MATERIALS[j]]];
    const d = Math.hypot(dist(a[0], b[0]), 0.5 * dist(a[1], b[1]));
    ok(d >= 0.09, `materials ${MATERIALS[i]} and ${MATERIALS[j]} are too close to tell apart (${d.toFixed(3)})`);
  }
}
for (const b of BEHAVIORS) ok(Boolean(BEHAVIOR_MOTION[b]), `behaviour ${b} has no motion`);
ok(BEHAVIOR_MOTION.static.pace === 0 && BEHAVIOR_MOTION.static.drift === 0 && BEHAVIOR_MOTION.static.spin === 0,
  "static must not move");
for (const id of ["grounded", "volumetric", "airborne"]) ok(Boolean(TREATMENT_LOOK[id]), `treatment ${id} has no look`);
const staticHazard = composeLook({ fn: "hazard", material: "metal", behavior: "static" });
ok(staticHazard.alert === "none" && staticHazard.period === 0 && !staticHazard.echo, "a static area must carry no alert");
const looks = BUILTIN_PROFILES.map((p) => composeLook({ fn: p.semantics.function, material: p.semantics.material,
  behavior: p.semantics.behavior, treatment: p.appearance?.treatment }));
ok(new Set(looks.map((l) => `${l.pattern}|${l.body}`)).size === BUILTIN_PROFILES.length,
  "two built-in profiles draw the same pattern in the same colour");
const overrideLook = composeLook({ fn: "harm", material: "fire", palette: { body: "#123456" }, hotFrom: () => "#abcdef" });
ok(overrideLook.body === "#123456" && overrideLook.hot === "#abcdef", "a GM palette override must reach the look");

/* Alerts: every kind must actually beat, inside 0..1, and the strobe must be
   an alarm (about half on), not a flicker. */
for (const kind of ["heartbeat", "breathe", "throb", "strobe"]) {
  const samples = Array.from({ length: 200 }, (_, i) => alertLevel(kind, i / 200, 1));
  ok(samples.every((v) => v >= 0 && v <= 1), `alert ${kind} leaves 0..1`);
  ok(Math.max(...samples) > 0.9 && Math.min(...samples) < 0.1, `alert ${kind} never beats`);
}
{
  const on = Array.from({ length: 400 }, (_, i) => alertLevel("strobe", i / 400, 1)).filter((v) => v > 0.5).length / 400;
  ok(on > 0.4 && on < 0.6, "strobe duty must stay near 50%");
}
ok(alertLevel("none", 0.3, 1) === 0 && alertLevel("breathe", 0.3, 0) === 0, "no alert or no period must be silent");
ok(echoPhase("heartbeat", 0.3, 1, 0.5) >= 0 && echoPhase("heartbeat", 0.9, 1, 0.5) < 0, "heartbeat echo must ride the beat");

/* Patterns: every recipe paints something, on a power-of-two tile. */
{
  const recorder = () => {
    let ops = 0;
    const count = () => { ops++; };
    const gradient = { addColorStop: () => {} };
    return {
      get ops() { return ops; },
      save() {}, restore() {}, clearRect() {}, rect() {}, clip() {}, beginPath() {}, closePath() {},
      moveTo() {}, lineTo() {}, arc() {}, quadraticCurveTo() {},
      fill: count, stroke: count, fillRect: count,
      createRadialGradient: () => gradient,
      set fillStyle(v) {}, set strokeStyle(v) {}, set globalAlpha(v) {}, set lineWidth(v) {},
      set lineCap(v) {}, set lineJoin(v) {},
    };
  };
  for (const id of PATTERN_IDS) {
    const ctx = recorder();
    paintPattern(ctx, id, TILE);
    ok(ctx.ops >= 3, `pattern ${id} paints nothing`);
  }
  ok(TILE > 0 && (TILE & (TILE - 1)) === 0, "pattern tiles must be a power of two so they repeat in hardware");
}

/* Outline: the boundary is PF2e's staircase, holes included. */
{
  const set = new Set(["0,0", "1,0", "2,0", "0,1", "2,1", "0,2", "1,2", "2,2"]);
  const loops = latticeLoops(set);
  ok(loops.length === 2, "a ring of squares must trace an outer edge and a hole");
  ok(Math.abs(loops.reduce((sum, loop) => sum + perimeter(loop), 0) - 16) < 1e-9, "lattice perimeter is wrong");
  ok(convexCorners(loops[0]).length === 4, "outer square corners must all be convex");
  ok(cellRects(set).reduce((sum, [, , w, h]) => sum + w * h, 0) === 8, "cell rectangles must cover every square once");
  ok(interiorSeams(set).length > 0, "seams between covered squares are missing");
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const dash = dashes(square, 10, 0.5, 0);
  ok(dash.length === 4 && dash.every((path) => path.length >= 4), "dashes must close evenly around a loop");
  const half = partialLoops([square], 0.5)[0];
  ok(half.at(-2) === 10 && half.at(-1) === 10, "the pen must reach halfway round at 0.5");
  const cone = shapeLoop({ origin: { x: 0, y: 0 }, grid: 100, radius: 3, shapeId: 1, direction: 0, angle: Math.PI / 2, base: [0, 0] });
  ok(cone[0][0] === 0 && cone[0][1] === 0 && cone.length > 10, "gridless cone must start at its apex");
}

/* Renderer purity: no program of ours on the GPU, and nothing that reads the
   world, so the preview drives the shipped file. */
for (const file of ["render/area.mjs", "render/outline.mjs", "render/look.mjs", "render/patterns.mjs", "host.mjs"]) {
  const src = await text(`scripts/features/pf2e-aoe/${file}`);
  ok(!/gl_FragColor|PIXI\.Filter|PIXI\.Shader|Shader\.from|createBloomFilter|precision\s+(?:high|medium)p/.test(src),
    `${file} reintroduces a shader or filter — Spellglass draws with PIXI primitives only`);
}
for (const file of ["render/area.mjs", "render/outline.mjs", "render/look.mjs", "render/patterns.mjs"]) {
  const src = (await text(`scripts/features/pf2e-aoe/${file}`)).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  ok(!/\b(?:game|canvas|Hooks|foundry|ui)\./.test(src), `${file} reads the world — the preview would have to reimplement it`);
}
for (const [key, value] of Object.entries(SIZES)) {
  ok(Array.isArray(value) ? value.every((v) => v > 0) : value > 0, `SIZES.${key} must be positive`);
}

ok(!SHED_ORDER.some((name) => ["fill", "pattern", "seams", "rim", "boundary", "lattice"].includes(name)),
  "the fill, pattern, seams and rim may never be shed");
ok(SHED_ORDER[0] === "tokenMarks", "token marks must shed first");
{
  const areaSrc = await text("scripts/features/pf2e-aoe/render/area.mjs");
  SHED_ORDER.forEach((name, i) => ok(areaSrc.includes(`shed < ${i + 1}`), `renderer never gates ${name} (shed < ${i + 1})`));
  const anim = new AoeAnim({ motionScale: 1 });
  ok(anim.hot, "an entering area must want frames");
  anim.step(TIMING.castIn + 1);
  ok(!anim.hot, "a landed area with no beat must not want frames of its own");
  anim.pulse();
  ok(anim.hot && anim.pulseProgress >= 0, "a trigger beat must want frames");
}
for (const [name, duration] of Object.entries(TIMING)) {
  ok(Number.isFinite(duration) && duration >= 0, `invalid animation duration ${name}`);
}

const [host, controls, moduleJsonText, featureIndex, langText, mainSource] = await Promise.all([
  text("scripts/features/pf2e-aoe/host.mjs"),
  text("scripts/features/pf2e-aoe/controls.mjs"),
  text("module.json"),
  text("scripts/features/index.mjs"),
  text("lang/pf2e-aoe.en.json"),
  text("scripts/features/pf2e-aoe/main.mjs"),
]);
ok(/Budget\.ladder\("pf2e-aoe", SHED_ORDER/.test(host), "host must bind SHED_ORDER to the shared frame budget");
ok(/Budget\.claimMotion\("pf2e-aoe"/.test(host), "host must claim motion while it ticks");
ok(/view\?\.animated/.test(host) && /anim\?\.hot/.test(host),
  "host must stop ticking once a still look has landed");
const moduleJson = JSON.parse(moduleJsonText);
ok(Number(moduleJson.compatibility?.minimum) <= 13, "PF2e AoE must not drop suite-level Foundry 13 compatibility");
ok(moduleJson.styles.includes("styles/pf2e-aoe.css"), "module.json does not load pf2e-aoe.css");
ok(moduleJson.languages.some((entry) => entry.path === "lang/pf2e-aoe.en.json"), "module.json does not load AoE language file");
ok(featureIndex.includes('import "./pf2e-aoe/index.mjs"'), "feature roster does not import pf2e-aoe");
const featureAdapter = await text("scripts/features/pf2e-aoe/index.mjs");
ok(/minimumGeneration:\s*14\b/.test(featureAdapter), "PF2e AoE must be individually gated to Foundry 14+");
const lang = JSON.parse(langText);
for (const id of ARCHETYPES) ok(Boolean(lang[`GLAOE.Archetype.${id}`]), `missing archetype localization ${id}`);
for (const entry of BUILTIN_PROFILES) ok(Boolean(lang[entry.nameKey]), `missing profile localization ${entry.id}`);
for (const [namespace, values] of [
  ["Function", FUNCTIONS], ["Material", MATERIALS], ["Behavior", BEHAVIORS],
  ["Audience", AUDIENCES], ["Source", SOURCES], ["Geometry", GEOMETRIES], ["Sense", SENSES],
]) {
  for (const value of values) ok(Boolean(lang[`GLAOE.${namespace}.${value}`]), `missing ${namespace} localization ${value}`);
}
for (const key of Object.values(SETTINGS)) ok(key.startsWith("aoe."), `setting is not aoe-prefixed: ${key}`);
ok(controls.includes("ensureSuiteGroup") && controls.includes("bindSuiteToolClicks"),
  "Spellglass creator must use the shared suite scene-control group");
ok(/canvas\.regions\.placeRegion\(regionData\(config\)\)/.test(controls),
  "Spellglass creator must place a flagged Region through RegionLayer");
for (const shape of ["burst", "cone", "line", "square", "emanation"]) {
  ok(Boolean(lang[`GLAOE.Creator.Shape.${shape}`]), `missing creator shape localization ${shape}`);
  ok(controls.includes(`\"${shape}\"`), `creator does not offer ${shape}`);
}
ok(controls.includes("createTokenEmanation") && controls.includes("gridBased: Boolean(canvas.grid?.isSquare)"),
  "creator emanations must use Foundry's token-attached Region API");
ok(controls.includes("colorOverride"), "creator must expose the per-Region color override toggle");
ok(/if\s*\(\s*!host\.reposition\(region\)\s*\)\s*host\.refresh\(region\)/.test(mainSource),
  "attached Region refresh must fall back when lightweight repositioning is unsafe");
const regionConfig = await text("scripts/features/pf2e-aoe/region-config.mjs");
ok(regionConfig.includes("FLAGS.presentation") && regionConfig.includes("PRESENTATION_MODES")
  && regionConfig.includes("compactPresentation"),
  "Region configuration must persist normalized schema-v2 presentation data");

/* Foundry merges dotted flag updates. Verify that clearing one sparse control
   emits nested deletion markers instead of leaving an old palette or modifier
   invisibly attached to the Region. */
const getProperty = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
const setProperty = (object, path, value) => {
  const keys = path.split("."); let target = object;
  for (const key of keys.slice(0, -1)) target = target[key] ??= {};
  target[keys.at(-1)] = value; return object;
};
const mergeObject = (target, source) => {
  for (const [key, value] of Object.entries(source ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] = mergeObject(target[key] && typeof target[key] === "object" ? target[key] : {}, value);
    } else target[key] = value;
  }
  return target;
};
globalThis.foundry = { utils: {
  getProperty, setProperty, deepClone: (value) => structuredClone(value),
  mergeObject: (target, source) => mergeObject(target, source),
} };
const { normalizeRegionPresentationUpdate } = await import("../scripts/features/pf2e-aoe/region-config.mjs");
const storedPresentation = {
  schema: 2, mode: "custom",
  overrides: {
    semantics: { function: "harm", material: "fire" },
    appearance: { palette: { body: "#ff5522" }, intensity: "cinematic" },
  },
};
const presentationChanges = {};
setProperty(presentationChanges, "flags.gluniverse-foundry-modules.aoe.presentation", {
  schema: 2, mode: "custom", _paletteEnabled: "false",
  overrides: {
    semantics: { function: "harm", material: "" },
    appearance: { intensity: "", treatment: "" },
  },
});
normalizeRegionPresentationUpdate({ getFlag: () => storedPresentation }, presentationChanges);
const normalizedChanges = getProperty(presentationChanges, "flags.gluniverse-foundry-modules.aoe.presentation");
ok(normalizedChanges.overrides?.semantics?.function === "harm"
  && normalizedChanges.overrides?.semantics?.["-=material"] === null,
"clearing one semantic override must preserve siblings and delete the stale value");
ok(normalizedChanges.overrides?.appearance?.["-=palette"] === null
  && normalizedChanges.overrides?.appearance?.["-=intensity"] === null,
"disabling appearance overrides must emit nested deletion markers");

/* Half-grid cone/line origins are where a visually plausible lattice used to
   shift. Exercise the pure Region adapter with a midpoint origin and assert the
   covered cell survives the round trip into the uploaded texture. */
globalThis.canvas = {
  ready: true,
  dimensions: { size: 100, distance: 5 },
  grid: {
    isSquare: true,
    getCenterPoint: ({ x, y }) => ({ x: Math.floor(x / 100) * 100 + 50, y: Math.floor(y / 100) * 100 + 50 }),
    getOffset: ({ x, y }) => ({ i: Math.floor(y / 100), j: Math.floor(x / 100) }),
    getTopLeftPoint: ({ i, j }) => ({ x: j * 100, y: i * 100 }),
  },
};
globalThis.CONFIG = {
  Canvas: {
    polygonBackends: {
      move: { testCollision: (_origin, destination) => destination.x === 250 && destination.y === 150 },
    },
  },
};
const { cellStateAt, inferredLabel, pf2eCoverage, regionCells, regionGeometry } = await import("../scripts/features/pf2e-aoe/data.mjs");
const { canRenderEffectRegion, host: aoeHost } = await import("../scripts/features/pf2e-aoe/host.mjs");
const { auraRegionFor } = await import("../scripts/features/pf2e-aoe/aura.mjs");
const gridlessRegion = {
  visible: true,
  document: { flags: { pf2e: { areaShape: "burst" } } },
};
canvas.grid.isSquare = false;
canvas.grid.isGridless = true;
ok(!canRenderEffectRegion(gridlessRegion), "unsupported gridless geometry must remain native");
const gridlessDocument = {
  shapes: [{ type: "circle", x: 150, y: 150, radius: 100 }],
  bounds: { x: 50, y: 50, width: 200, height: 200 },
  flags: { pf2e: { areaShape: "burst" } },
  elevation: { bottom: 0 },
  testPoint: ({ x, y }) => Math.hypot(x - 150, y - 150) <= 100,
};
const gridlessGeometry = regionGeometry(gridlessDocument);
const gridlessCells = regionCells({ document: gridlessDocument }, gridlessGeometry);
ok(gridlessGeometry.gridless, "gridless Region geometry must select the continuous shader path");
ok(cellStateAt(gridlessCells, 150, 150, 100) >= 0.75,
  "gridless Region geometry must produce a covered shader-mask sample");
canvas.grid.isSquare = true;
canvas.grid.isGridless = false;
const mockDocument = {
  shapes: [{ type: "cone", x: 50, y: 50, radius: 400, angle: 90, rotation: 45 }],
  bounds: { x: 0, y: 0, width: 500, height: 500 },
  flags: { pf2e: { areaShape: "cone" } },
  elevation: { bottom: 0 },
  testPoint: ({ x, y }) => x >= 0 && y >= 0 && x <= 500 && y <= 500,
};
const mockRegion = {
  document: mockDocument,
  _getCoveredGridSpaceOffsets: () => { throw new Error("PF2e coverage must not delegate to Foundry"); },
};
const mockGeometry = regionGeometry(mockRegion);
const mockCoverage = pf2eCoverage(mockRegion);
const mockCells = regionCells(mockRegion, mockGeometry);
ok(mockGeometry.gridOffset[0] === 0.5 && mockGeometry.gridOffset[1] === 0.5,
  "half-grid origin phase was not preserved");
ok(mockCoverage?.origin.x === 100 && mockCoverage?.origin.y === 100,
  "PF2e cone apex was not moved to its border-aligned origin");
ok(cellStateAt(mockCells, 150, 150, 100) >= 0.75, "PF2e cone covered cell was lost");
ok(Math.abs(cellStateAt(mockCells, 250, 150, 100) - 128 / 255) < 0.01,
  "wall-blocked PF2e cell was not encoded separately");

/* A two-square diagonal is 15 feet under PF2e's 5/10/5 rule and must remain
   outside a 10-foot burst even though Euclidean coverage can include it. */
CONFIG.Canvas.polygonBackends.move.testCollision = () => false;
const burstDocument = {
  shapes: [{ type: "circle", x: 50, y: 50, radius: 200 }],
  bounds: { x: 0, y: 0, width: 300, height: 300 },
  flags: { pf2e: { areaShape: "burst" } },
  elevation: { bottom: 0 },
};
const burstRegion = { document: burstDocument };
const burstCells = regionCells(burstRegion, regionGeometry(burstRegion));
ok(cellStateAt(burstCells, 250, 250, 100) === 0,
  "PF2e 5/10/5 burst incorrectly covered a 15-foot diagonal cell");

const emanationRegion = {
  document: {
    shapes: [{
      type: "emanation",
      radius: 200,
      base: { type: "token", x: 300, y: 400, width: 2, height: 3 },
    }],
    bounds: { x: 100, y: 200, width: 600, height: 700 },
    flags: { pf2e: { areaShape: "emanation" } },
  },
};
const emanationGeometry = regionGeometry(emanationRegion);
ok(emanationGeometry.origin.x === 400 && emanationGeometry.origin.y === 550,
  "token emanation origin must be the base center for non-Medium creatures");
ok(emanationGeometry.base[0] === 1 && emanationGeometry.base[1] === 1.5,
  "token emanation footprint must retain its grid-space dimensions");
const wideLine = regionGeometry({
  shapes: [{ type: "line", x: 100, y: 100, length: 600, width: 200 }],
  flags: { pf2e: { areaShape: "line" } }, bounds: { x: 100, y: 0, width: 700, height: 300 },
});
ok(wideLine.base[0] === 2, "actual line width must reach the analytic shader backend");

/* Emanations measure outward from every edge of the creature's space. The
   first diagonal is 5 feet and the second is 10, so the outer corners disappear
   at 10 feet exactly as in the supplied Rules354.png reference. */
const emanationCount = (width, height, feet) => pf2eCoverage({
  shapes: [{
    type: "emanation",
    base: { type: "token", x: 500, y: 500, width, height },
    radius: feet / 5 * 100,
  }],
  flags: { pf2e: { areaShape: "emanation" } },
})?.covered.length;
ok(emanationCount(1, 1, 5) === 9, "5-foot Medium emanation must cover its 3x3 space");
ok(emanationCount(0.5, 0.5, 5) === 9, "5-foot Small-or-smaller emanation must use the Medium 3x3 space");
ok(emanationCount(1, 1, 10) === 21, "10-foot Medium emanation must omit the four 15-foot corners");
ok(emanationCount(2, 2, 5) === 16, "5-foot Large emanation must cover its 4x4 space");
ok(emanationCount(2, 2, 10) === 32, "10-foot Large emanation must omit the four 15-foot corners");

const auraRenderer = {
  slug: "frightful-presence",
  radius: 10,
  traits: ["emotion", "mental"],
  appearance: { highlight: { color: 0x7a45cc } },
  token: {
    id: "TOKEN1",
    visible: true,
    mechanicalBounds: { x: 500, y: 500, width: 200, height: 200 },
    document: { hidden: false, elevation: 0 },
  },
  squares: [
    { x: 500, y: 500, active: true },
    { x: 700, y: 700, active: false },
  ],
};
const auraRegion = auraRegionFor(auraRenderer);
ok(auraRegion?.id === "aura:TOKEN1:frightful-presence", "PF2e aura adapter id must be stable per token and slug");
ok(auraRegion?.document?.shapes?.[0]?.base?.width === 2,
  "PF2e aura adapter must preserve a Large token's two-square base");
ok(auraRegion?._getCoveredGridSpaceOffsets().length === 1,
  "PF2e aura adapter must use only the system's active aura squares");
ok(auraRegion?.document?.getFlag("gluniverse-foundry-modules", "aoe.presentation")?.overrides?.appearance?.palette?.body === "#7a45cc",
  "PF2e aura adapter must preserve the Aura rule's resolved highlight color");
ok(classify(auraRegion, { aura: auraRenderer }).candidate.material === "mental",
  "PF2e aura traits must resolve through the schema-v2 evidence classifier");

/* A moving token-attached effect reuses its outline during animation: the
   whole area translates rigidly with the Token (never re-tracing mid-move),
   and the brackets around the source Token follow the live Token. */
const movingShape = (x) => ({
  type: "emanation",
  radius: 100,
  base: { type: "token", x, y: 500, width: 1, height: 1 },
});
const movingDocument = {
  attachment: { token: "MOVING" },
  shapes: [movingShape(500)],
  flags: { pf2e: { areaShape: "emanation" } },
};
ok(inferredLabel({ name: "Silence Field", flags: {} }) === "Silence Field",
  "inherited labels must fall back to a Region name when no source exists");
const restingRegion = {
  id: "MOVING-REGION",
  document: movingDocument,
  bounds: { x: 400, y: 400, width: 300, height: 300 },
};
const animatedRegion = {
  id: restingRegion.id,
  document: movingDocument,
  animationState: { shapes: [movingShape(550)] },
  bounds: { x: 450, y: 400, width: 300, height: 300 },
};
const restingGeometry = regionGeometry(restingRegion);
const position = (x, y) => ({ x, y, set(nx, ny) { this.x = nx; this.y = ny; } });
const movingView = {
  moved: null, marks: null,
  translate(dx, dy) { this.moved = [dx, dy]; },
  setTokenMarks(rects) { this.marks = rects; },
};
const movingToken = {
  id: "MOVING",
  visible: true,
  center: { x: 600, y: 550 },
  x: 550,
  y: 500,
  w: 100,
  h: 100,
  mesh: { texture: { width: 100, height: 100 }, alpha: 1 },
  document: { rotation: 0 },
};
canvas.tokens = {
  placeables: [movingToken],
  get: (id) => id === movingToken.id ? movingToken : null,
};
const movingEntry = {
  region: restingRegion,
  geometry: restingGeometry,
  cells: regionCells(restingRegion, restingGeometry),
  view: movingView,
  label: { position: position(restingGeometry.labelAt.x, restingGeometry.labelAt.y) },
};
aoeHost.entries.set(restingRegion.id, movingEntry);
ok(pf2eCoverage(animatedRegion)?.origin.x === 600,
  "attached Region fallback coverage must use the transient animated shape");
ok(aoeHost.reposition(animatedRegion), "compatible attached geometry must use lightweight repositioning");
ok(movingView.moved?.[0] === 50 && movingView.moved?.[1] === 0,
  "attached effect must translate rigidly by the Token's fractional movement");
ok(movingEntry.builtGeometry === restingGeometry,
  "a translation must keep the outline it was built from until the move settles");
ok(aoeHost.reposition({ ...animatedRegion, animationState: { shapes: [movingShape(560)] }, bounds: { x: 460, y: 400, width: 300, height: 300 } })
  && movingView.moved?.[0] === 60, "successive frames must translate from the built geometry, not accumulate");
const mark = movingView.marks?.[0];
ok(mark && mark[0] + mark[2] / 2 === movingToken.center.x && mark[1] + mark[3] / 2 === movingToken.center.y,
  "attached Token brackets must follow the live Token position");
aoeHost.entries.delete(restingRegion.id);

ok(inferredLabel({ name: "Fireball", flags: { pf2e: { origin: { name: "Fireball", traits: ["fire"] } } } }) === "Fireball",
  "an item-created template must inherit its PF2e origin name as the label");

if (errors.length) {
  for (const error of errors) console.error(`FAIL ${error}`);
  process.exit(1);
}

console.log(`PF2e AoE checks passed: ${BUILTIN_PROFILES.length} profiles, ${FUNCTIONS.length} functions, ${MATERIALS.length} materials, ${PATTERN_IDS.length} patterns.`);
