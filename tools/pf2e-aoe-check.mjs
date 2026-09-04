#!/usr/bin/env node
/** Static contract checks for the PF2e Spellglass Region renderer. */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  ARCHETYPES,
  ARCHETYPE_PALETTE,
  DAMAGE_ARCHETYPE,
  SETTINGS,
} from "../scripts/features/pf2e-aoe/constants.mjs";
import { SHED_ORDER, TIMING } from "../scripts/features/pf2e-aoe/anim.mjs";
import { FRAGMENT_SHADER, UNIFORMS, VERTEX_SHADER } from "../scripts/features/pf2e-aoe/shader.mjs";

const ROOT = new URL("../", import.meta.url);
const errors = [];
const ok = (condition, message) => { if (!condition) errors.push(message); };
const text = async (path) => readFile(new URL(path, ROOT), "utf8");

ok(ARCHETYPES.length === 14, `expected 14 archetypes, found ${ARCHETYPES.length}`);
ok(new Set(ARCHETYPES).size === ARCHETYPES.length, "archetype ids must be unique");
ok(ARCHETYPES.at(-2) === "generic" && ARCHETYPES.at(-1) === "warning",
  "Generic and Warning must remain append-only indices 12 and 13");
for (const id of ARCHETYPES) ok(Boolean(ARCHETYPE_PALETTE[id]), `missing palette for ${id}`);
ok(Object.keys(DAMAGE_ARCHETYPE).length === 16, "PF2e damage map must cover 16 canonical ids");
for (const id of Object.values(DAMAGE_ARCHETYPE)) ok(ARCHETYPES.includes(id), `damage map references unknown ${id}`);

for (const [name, type] of Object.entries(UNIFORMS)) {
  const declaration = new RegExp(`uniform\\s+${type}[^;]*\\b${name}\\b`);
  ok(declaration.test(FRAGMENT_SHADER), `${name} is not declared as ${type}`);
}
ok(/varying\s+vec2\s+vGrid/.test(VERTEX_SHADER), "shipped vertex must write vGrid");
ok(/varying\s+vec2\s+vScreen/.test(VERTEX_SHADER), "shipped vertex must write vScreen");
ok(/uGridOffset/.test(FRAGMENT_SHADER), "half-grid phase uniform is missing");
ok(/uGridless/.test(FRAGMENT_SHADER), "gridless continuous-geometry uniform is missing");
ok(/warningFill/.test(FRAGMENT_SHADER) && /warningBeat/.test(FRAGMENT_SHADER), "Warning Zone branch is missing");

ok(!SHED_ORDER.includes("lattice") && !SHED_ORDER.includes("boundary"),
  "rules lattice and boundary may never be shed");
ok(SHED_ORDER[0] === "tokenEdgeLight", "token edge light must shed first");
ok(/uFx\.x[^;]*chMotes/.test(FRAGMENT_SHADER), "motes must use their adaptive shed gate");
ok(/uFx\.y[^;]*chScorch/.test(FRAGMENT_SHADER), "scorch must use its adaptive shed gate");
ok(/uFx\.z[^;]*uMix\.z/.test(FRAGMENT_SHADER), "skirt must use its adaptive shed gate");
ok(/uFx\.w/.test(FRAGMENT_SHADER), "turbulence must use its adaptive shed gate");
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
for (const name of Object.keys(UNIFORMS)) ok(host.includes(name), `host never writes ${name}`);
ok(host.includes("sprite.glAoeTokenId = token.id"),
  "token edge sprites must retain their Token id for animation tracking");
const moduleJson = JSON.parse(moduleJsonText);
ok(Number(moduleJson.compatibility?.minimum) <= 13, "PF2e AoE must not drop suite-level Foundry 13 compatibility");
ok(moduleJson.styles.includes("styles/pf2e-aoe.css"), "module.json does not load pf2e-aoe.css");
ok(moduleJson.languages.some((entry) => entry.path === "lang/pf2e-aoe.en.json"), "module.json does not load AoE language file");
ok(featureIndex.includes('import "./pf2e-aoe/index.mjs"'), "feature roster does not import pf2e-aoe");
const featureAdapter = await text("scripts/features/pf2e-aoe/index.mjs");
ok(/minimumGeneration:\s*14\b/.test(featureAdapter), "PF2e AoE must be individually gated to Foundry 14+");
const lang = JSON.parse(langText);
for (const id of ARCHETYPES) ok(Boolean(lang[`GLAOE.Archetype.${id}`]), `missing archetype localization ${id}`);
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
ok(regionConfig.includes("colorOverride") && regionConfig.includes('color.disabled = !colorOverride.checked'),
  "Region configuration must persist and visibly gate its color override");

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
const { authoredStyle, cellStateAt, pf2eCoverage, regionCells, regionGeometry } = await import("../scripts/features/pf2e-aoe/data.mjs");
const { canRenderEffectRegion, host: aoeHost } = await import("../scripts/features/pf2e-aoe/host.mjs");
const { auraRegionFor } = await import("../scripts/features/pf2e-aoe/aura.mjs");
const gridlessRegion = {
  visible: true,
  document: { flags: { pf2e: { areaShape: "burst" } } },
};
canvas.grid.isSquare = false;
canvas.grid.isGridless = true;
ok(canRenderEffectRegion(gridlessRegion), "gridless Scenes must not discard Spellglass Regions before mesh creation");
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
ok(auraRegion?.document?.getFlag("gluniverse-foundry-modules", "aoe.style")?.color === "#7a45cc",
  "PF2e aura adapter must preserve the Aura rule's resolved highlight color");
ok(authoredStyle(auraRegion.document).archetype === "resonance",
  "PF2e aura traits must resolve through the shared Spellglass archetype map");

/* A moving token-attached effect reuses its mask during animation. The mask's
   local grid phase must move rigidly with the mesh, and the source token's
   cloned edge light must follow the live Token rather than remain behind. */
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
const movingMesh = () => ({
  position: position(restingGeometry.quad.x, restingGeometry.quad.y),
  shader: { uniforms: { uGridOffset: new Float32Array(restingGeometry.gridOffset) } },
});
const edgeSprite = {
  glAoeTokenId: "MOVING",
  position: position(550, 550),
  width: 100,
  height: 100,
  angle: 0,
  alpha: 1,
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
  meshes: [movingMesh(), movingMesh(), movingMesh(), movingMesh()],
  edges: { children: [edgeSprite] },
  label: { position: position(restingGeometry.labelAt.x, restingGeometry.labelAt.y) },
};
aoeHost.entries.set(restingRegion.id, movingEntry);
ok(pf2eCoverage(animatedRegion)?.origin.x === 600,
  "attached Region fallback coverage must use the transient animated shape");
ok(aoeHost.reposition(animatedRegion), "compatible attached geometry must use lightweight repositioning");
ok(movingEntry.meshes[0].position.x === restingGeometry.quad.x + 50,
  "attached effect mesh must follow fractional Token movement");
ok(movingEntry.meshes[0].shader.uniforms.uGridOffset[0] === restingGeometry.gridOffset[0],
  "reused coverage mask must retain its local grid phase during Token movement");
ok(edgeSprite.position.x === movingToken.center.x && edgeSprite.position.y === movingToken.center.y,
  "attached Token edge light must follow the live Token position");
aoeHost.entries.delete(restingRegion.id);

const automaticColor = authoredStyle({
  flags: { pf2e: {} },
  getFlag: () => ({ archetype: "arcane", colorOverride: false, color: "#ff0000" }),
});
ok(automaticColor.color !== "#ff0000" && !automaticColor.colorOverride,
  "disabled per-Region color override must resolve the archetype's world default");

if (errors.length) {
  for (const error of errors) console.error(`FAIL ${error}`);
  process.exit(1);
}

console.log(`PF2e AoE checks passed: ${ARCHETYPES.length} archetypes, ${Object.keys(UNIFORMS).length} uniforms, ${Object.keys(DAMAGE_ARCHETYPE).length} damage types.`);
