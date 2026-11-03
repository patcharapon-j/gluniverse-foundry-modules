#!/usr/bin/env node
/**
 * Diorama — renderer preview generator.
 *
 * Writes a page that imports the SHIPPED renderer and terrain model over the
 * preview server and drives them with a fabricated scene: a painted 16×12 map
 * (grass, a flagstone plaza on a 10 ft plateau with stairs, a sunken pond, a
 * pit, a 5 ft earth ledge), walls with a door and a window, four standees
 * (current turn, next turn, a GM-hidden ghost, conditions and bars), a light
 * bake with two warm lights at darkness 0.4, a vision bake with an unexplored
 * corner and an explored-only strip, a beam and a flat effect.
 *
 *   node tools/diorama-preview.mjs [--out=.preview/diorama.html]
 *   node tools/preview-server.mjs [port]
 *   → http://localhost:8931/.preview/diorama.html
 *
 * SERVE IT from the repository root: a file:// page does not run its module
 * script, and a server rooted anywhere else cannot resolve the imports.
 *
 * Query parameters (for headless stills):
 *   yaw=<step>  pitch=<index>  zoom=<n>  view=full|close|fly|wall|knight|goblin|rogue
 *   grid=1      the square grid on tops      knight=wall  knight against a wall
 *   links=1     target lines (knight → goblin, rogue → drake, one dropped)
 *   halo=<n>    effect-halo mode; the knight wears n effect chips (0..12)
 *   target=knight  the knight targeted (red outline, glow, reticle)
 *   tilt=0|1  cutaway=0|1  door=closed|open|locked  ghosts=0|1
 *   still=1     shed water and sway, so the page goes idle (screenshots);
 *               idle=1 also holds the reticle, the fog's drift and areas still
 *   probe=perf  frames and shadow-map renders per second after settle=<ms>
 *               (default 2000), and what kept frames coming; pan=1 pans meanwhile
 *   probe=shaders  every program's compile and link log (run with
 *               --use-angle=d3d11 to see D3D's HLSL warnings)
 *   life=walk|fall|drop|fly|land  token life: a walk, a 5 / 10 ft fall, a hovering flyer,
 *               a flyer landing; seek=<ms> freezes the standees that long into
 *               the move (stills mid-hop, mid-fall, at the dust); tokenLife=0 off
 *   shed=<n>    shed the first n SHED_ORDER entries
 *   novision=1  no vision bake (everything visible)
 *   dark=<0..1> scene darkness (default 0.4)
 *   torches=1   the two lights as bake sources: a torch that flickers and burns, a
 *               brazier prop whose warm light becomes a fire; lightFx=off|on
 *   fow=clouds|flat  the fog of war's style; unseen=wide  sight in the middle only;
 *               unseen=pillar  a wedge of unseen ground behind a pillar;
 *               unseen=cliff  the plateau's top hidden, its faces and stairs seen,
 *               a pine at its lip seen in 3D (seen=0: as the bake alone draws it);
 *               unseen=wall  the walled room's inside never seen (the mist ends on its walls);
 *               unseen=dead  the knight on the plateau: the ground at its foot is dead ground
 *               (dead=rogue: seen from the rogue on the grass)
 *   tower=1     a 50 ft tower in the far corner (hidden under unseen=wide)
 *   reach=1     the rogue's movement range, stepping round the other creatures
 *   props=1     the props gallery (every shape, every material, a stack, cards,
 *               a GM-only ghost) instead of the tokens; view=props|mats frames it
 *   props=2     the newer shapes, slabs, a kit, a path pipe, a JS-built model, a
 *               failed model and a faded roof (fade=<0..1>); view=props2 frames the
 *               shapes (in the house), view=slabs the slabs, view=kits the rest
 *   areas=1     spell areas as volumes (a burst on the plateau's corner, a cone, a
 *               line, an emanation), on PF2e's squares; areaVolumes=0 flat only
 *   los=knight-goblin[,rogue-drake]  lines of sight with their readouts
 *   fall=1      a dragged path off the plateau: the drop line and its damage
 *   levels=1    v14 Levels: the map as an upper floor (base 20 ft) with a hole, a
 *               cellar drawn below it by setLevels; levels=ghost  the cellar as a
 *               GM-only ghost (a still)
 *   buildings=1 Foundry tiles: a roof over the house, a rug, a mirrored banner, a
 *               GM-only ghost; roof=in|out|cut|radial; view=house; probe=tiles
 *
 * The environment (environment.mjs; a preset first, then fields over it):
 *   preset=<key>  clearDay | goldenHour | dusk | night | rain | storm | snow | …
 *   time=<0..24>|table   weather=<kind>  intensity=<0..1>
 *   fog=<0..1>  fogh=<0..1>  wind=<0..1>  winddir=<deg>  clouds=<0..1>
 *   wet=<0..1>  snow=<0..1>  flow=<0..1>  flowdir=<deg>
 * Graphics (options.mjs): q=low|medium|high|ultra, water=simple|full,
 *   detail=low|high, weatherFx=off|reduced|full, atmosphere=off|on,
 *   shadows=off|hard|soft, dayNight=0, grade=0
 *
 * ── A real map (--scene) ──────────────────────────────────────────────────
 * The same renderer on a real battle map, before it is imported into a world:
 *
 *   node tools/diorama-preview.mjs --scene=<foundry-scene.json> [--map=<image>]
 *     [--layout=<layout.json>] [--tokens=<tokens.json>] [--out=.preview/diorama-map.html]
 *   node tools/preview-server.mjs
 *   → http://localhost:8931/.preview/diorama-map.html?pitch=1&yaw=0&still=1&shed=0
 *
 *   --scene   a Foundry Scene export: grid, width/height, padding, walls (door,
 *             ds, light sense, wall-height flags), lights (AmbientLight data),
 *             environment (darkness, global light)
 *   --map     the background (webp/png); default: the scene's background file
 *             name, looked for beside the scene file
 *   --layout  a Diorama layout (docs/DIORAMA_LAYOUT.md), compiled by
 *             terrain/layout.mjs and its props resolved as importLayout does
 *   --tokens  standees: [{ name, cell: [row, col], size?, img?, altitude?,
 *             disposition?, color? }], map squares like a layout; no img draws
 *             a coloured disc
 *
 * The map, token art and data are copied beside the page, so it serves from
 * the repo root. Walls go through view/snapshot.mjs wallState, lights through
 * view/bake.mjs (Baker#drawLight, lightData) at the darkness the view would
 * use (0 while the scene's global light is on; dark=<0..1> overrides). Light
 * polygons are swept here against the walls that block light, with the height
 * rules the sight backend applies once a layout is saved (an eye above a
 * wall's top sees over it, cliffs above the light cut it). Limited, proximity
 * and distance light walls are treated as open, one-way walls as two-way.
 *
 * Query parameters: yaw, pitch, still, idle, shed, dark, grid, cutaway, tilt,
 * the environment and graphics ones above, and the framing:
 *   view=full             the whole map (default; may zoom out past the
 *                         view's own minimum so a big map fits)
 *   focus=<row>,<col>     centre that map square; zoom=<n> (default 2)
 *   zoom=<n>              with view=full, a fixed zoom on the map's centre
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
const SCENE_FILE = arg("scene");
const OUT = resolve(ROOT, arg("out") ?? (SCENE_FILE ? ".preview/diorama-map.html" : ".preview/diorama.html"));
if (relative(ROOT, OUT).startsWith("..")) {
  console.warn("warning: --out is outside the repository; the page's imports only resolve when served from the repo root.");
}

// Shared by both pages: the head, the error capture, the environment and
// graphics from the URL, and the shed ladder for stills.
const HEAD = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Diorama preview</title>
<link rel="stylesheet" href="/styles/gl-fonts.css">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #080b11; color: #eef1f7; font: 13px/1.4 Oxanium, system-ui, sans-serif; }
  #view { position: fixed; inset: 0; width: 100%; height: 100%; display: block; }
  .bar { position: fixed; left: 12px; top: 12px; display: flex; gap: 6px; flex-wrap: wrap; max-width: 70vw; z-index: 2; }
  .bar button { background: rgb(22 29 44 / 0.85); color: inherit; border: 1px solid rgb(238 241 247 / 0.18); padding: 5px 9px; font: inherit; cursor: pointer; }
  .bar button:hover { border-color: rgb(238 241 247 / 0.5); }
  .status { position: fixed; left: 12px; bottom: 12px; background: rgb(8 11 17 / 0.8); padding: 6px 9px; z-index: 2; white-space: pre; }
  .label { position: fixed; z-index: 2; transform: translate(-50%, -130%); background: rgb(8 11 17 / 0.85); border: 1px solid rgb(255 210 74 / 0.6); padding: 2px 7px; pointer-events: none; font-weight: 600; }
  .err { position: fixed; right: 12px; top: 12px; max-width: 46vw; max-height: 60vh; overflow: auto; background: #3a0d12; color: #ffc0c6; padding: 8px; z-index: 3; white-space: pre-wrap; font: 12px/1.35 monospace; }
  .err:empty { display: none; }
</style>
</head>
<body>
<canvas id="view"></canvas>`;

const ERR_JS = String.raw`<script>
  window.__errors = [];
  const errEl = () => document.getElementById("err");
  const report = (m) => { window.__errors.push(m); const el = errEl(); if (el) el.textContent += m + "\n"; };
  window.addEventListener("error", (e) => report("error: " + (e.error?.stack || e.message)));
  window.addEventListener("unhandledrejection", (e) => report("rejection: " + (e.reason?.stack || e.reason)));
  const ce = console.error.bind(console);
  console.error = (...a) => { report("console.error: " + a.map((x) => x?.stack || String(x)).join(" ")); ce(...a); };
  const cw = console.warn.bind(console);
  console.warn = (...a) => { const s = a.map(String).join(" "); if (/THREE|WebGL|shader|GLSL/i.test(s)) report("console.warn: " + s); cw(...a); };
</script>`;

const ENV_JS = String.raw`// The environment (environment.mjs), from the URL: a preset, then any field over it.
const envFlag = (() => {
  const e = Q.has("preset") ? applyPreset(Q.get("preset")) : normalizeEnv(null);
  const n = (k) => Number(Q.get(k));
  if (Q.has("time")) e.hour = Q.get("time") === "table" ? null : n("time");
  if (Q.has("weather")) e.weather = { kind: Q.get("weather"), intensity: Q.has("intensity") ? n("intensity") : 0.7 };
  else if (Q.has("intensity")) e.weather.intensity = n("intensity");
  if (Q.has("fog")) e.fog.density = n("fog");
  if (Q.has("fogh")) e.fog.height = n("fogh");
  if (Q.has("wind")) e.wind.strength = n("wind");
  if (Q.has("winddir")) e.wind.dir = n("winddir");
  if (Q.has("clouds")) e.clouds = n("clouds");
  if (Q.has("wet")) e.wetness = n("wet");
  if (Q.has("snow")) e.snow = n("snow");
  if (Q.has("flow")) e.water.speed = n("flow");
  if (Q.has("flowdir")) e.water.dir = n("flowdir");
  return normalizeEnv(e);
})();
// graphics: q=low|medium|high|ultra, and any option by name (water=simple, weatherFx=reduced, grade=0, …)
// adaptive=0 keeps the budget from shedding weather and air (a software GL sheds everything)
const gRaw = { quality: Q.get("q") || "high", adaptive: Q.get("adaptive") !== "0" };
for (const k of ["shadows", "ao", "water", "detail", "weatherFx", "atmosphere", "lightFx"]) if (Q.has(k)) gRaw[k] = Q.get(k);
// fow=clouds|flat: the fog of war's style (dio.fogStyle; "fog" is the environment's)
if (Q.has("fow")) gRaw.fogStyle = Q.get("fow");
for (const k of ["dayNight", "grade", "tokenLife", "areaVolumes"]) if (Q.has(k)) gRaw[k] = Q.get(k) !== "0";
r.setOptions({ graphics: resolveGraphics(gRaw) });
r.setEnvironment(resolveEnv(envFlag, { dayNight: Q.get("dayNight") !== "0" }));
window.__env = envFlag;`;

const SHED_JS = String.raw`// idle=1: every ambient loop held too (the reticle's breathe, the fog's drift, an
// area's glow), so only living light can keep frames coming (probe=perf)
if (Q.get("still") === "1" || Q.get("idle") === "1" || Q.has("shed")) {
  const n = Q.has("shed") ? Number(Q.get("shed")) : 0;
  const still = Q.get("still") === "1" || Q.get("idle") === "1";
  const idle = Q.get("idle") === "1";
  r.setShed({ allows: (name) => {
    if (still && (name === "water" || name === "standeeSway")) return false;
    if (idle && (name === "markerMotion" || name === "fogDrift" || name === "areaMotion")) return false;
    const i = SHED_ORDER.indexOf(name);
    return i < 0 || i >= n;
  } });
}`;

const page = String.raw`${HEAD}
<div class="bar">
  <button data-act="yaw-">Q yaw −</button><button data-act="yaw+">E yaw +</button>
  <button data-act="pitch">R pitch</button>
  <button data-act="zoom-">zoom −</button><button data-act="zoom+">zoom +</button>
  <button data-act="tilt">tilt-shift</button><button data-act="cut">cutaway</button>
  <button data-act="door">door</button><button data-act="ghost">ghosts</button><button data-act="grid">grid</button><button data-act="links">links</button>
  <button data-act="move">move rogue</button><button data-act="ping">ping</button>
</div>
<div class="status" id="status"></div>
<div class="label" id="label">25 ft</div>
<pre class="err" id="err"></pre>
${ERR_JS}
<script type="module">
import { DioramaRenderer } from "/scripts/features/diorama/render/renderer.mjs";
import { Terrain } from "/scripts/features/diorama/terrain/model.mjs";
import { deadGround } from "/scripts/features/diorama/view/dead-ground.mjs";
import { KIND, DIR, SUB, SHED_ORDER, BAKE_PX_PER_CELL } from "/scripts/features/diorama/constants.mjs";
import { PALETTE } from "/scripts/core/theme.mjs";
import { resolveEnv, applyPreset, normalizeEnv } from "/scripts/features/diorama/environment.mjs";
import { resolveGraphics } from "/scripts/features/diorama/options.mjs";

const Q = new URLSearchParams(location.search);const COLS = 16, ROWS = 12, SIZE = 100;

/* ------------------------------------------------------------ seeded rng */
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const mk = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

/* ------------------------------------------------------------ painted map */
function paintMap() {
  const c = mk(COLS * SIZE, ROWS * SIZE), g = c.getContext("2d");
  g.fillStyle = "#6c9447"; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 900; i++) {
    const x = rnd() * c.width, y = rnd() * c.height, r = 14 + rnd() * 46;
    const greens = ["#7aa552", "#5f8a3e", "#86b05c", "#55803a", "#6f9a49"];
    g.fillStyle = greens[(rnd() * greens.length) | 0]; g.globalAlpha = 0.35;
    g.beginPath(); g.ellipse(x, y, r, r * (0.5 + rnd() * 0.5), rnd() * 3, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  // dry earth ledge, NW
  g.fillStyle = "#b39a5c"; g.fillRect(0, 0, 500, 300);
  for (let i = 0; i < 160; i++) { g.fillStyle = rnd() < 0.5 ? "#c4ab6a" : "#a08850"; g.globalAlpha = 0.4; g.beginPath(); g.arc(rnd() * 500, rnd() * 300, 6 + rnd() * 22, 0, 7); g.fill(); }
  g.globalAlpha = 1;
  // dirt path
  g.strokeStyle = "#9c7a4e"; g.lineWidth = 70; g.lineCap = "round";
  g.beginPath(); g.moveTo(-40, 620); g.bezierCurveTo(250, 560, 420, 470, 700, 400); g.stroke();
  g.strokeStyle = "#ae8c5c"; g.lineWidth = 34; g.stroke();
  // plaza flagstones on the plateau
  g.fillStyle = "#5d574f"; g.fillRect(900, 100, 600, 600);
  for (let y = 100; y < 700; y += 50) for (let x = 900; x < 1500; x += 50) {
    const o = (y / 50) % 2 ? 25 : 0;
    const s = 150 + rnd() * 40;
    g.fillStyle = "rgb(" + (s + 20) + "," + (s + 12) + "," + s + ")";
    g.fillRect(x + o - 25 + 3, y + 3, 44 + rnd() * 3, 44);
  }
  // building floor: planks
  for (let x = 1000; x < 1400; x += 25) {
    const s = 120 + rnd() * 30;
    g.fillStyle = "rgb(" + (s + 40) + "," + (s + 10) + "," + (s - 20) + ")";
    g.fillRect(x, 200, 24, 400);
  }
  // stairs
  g.fillStyle = "#8f8a82"; g.fillRect(700, 300, 200, 200);
  for (let x = 700; x < 900; x += 25) { g.fillStyle = "#6e6a64"; g.fillRect(x, 300, 3, 200); }
  // pond
  g.fillStyle = "#c8b07a"; g.beginPath(); g.roundRect(590, 790, 320, 320, 40); g.fill();
  g.fillStyle = "#2f6f9a"; g.beginPath(); g.roundRect(605, 805, 290, 290, 30); g.fill();
  for (let i = 0; i < 30; i++) { g.strokeStyle = "rgba(190,230,255,0.35)"; g.lineWidth = 2; g.beginPath(); g.arc(620 + rnd() * 260, 820 + rnd() * 260, 6 + rnd() * 16, 0, 2); g.stroke(); }
  // pit
  g.fillStyle = "#3b2e22"; g.fillRect(100, 800, 300, 300);
  for (let i = 0; i < 60; i++) { g.fillStyle = rnd() < 0.5 ? "#4a3a2a" : "#2e241b"; g.beginPath(); g.arc(110 + rnd() * 280, 810 + rnd() * 280, 4 + rnd() * 14, 0, 7); g.fill(); }
  // flowers and rocks
  for (let i = 0; i < 140; i++) {
    const x = rnd() * c.width, y = rnd() * c.height;
    if (x > 880 && y < 720 && x < 1520) continue;
    g.fillStyle = ["#f3e37a", "#f2a0b8", "#ffffff", "#8a8a84"][(rnd() * 4) | 0];
    g.beginPath(); g.arc(x, y, 2 + rnd() * 4, 0, 7); g.fill();
  }
  // faint grid
  g.strokeStyle = "rgba(0,0,0,0.13)"; g.lineWidth = 2;
  for (let x = 0; x <= c.width; x += SIZE) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, c.height); g.stroke(); }
  for (let y = 0; y <= c.height; y += SIZE) { g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); }
  return c;
}

/* ------------------------------------------------------------ terrain */
function buildTerrain() {
  const t = Terrain.blank(COLS, ROWS);
  const P = (name) => t.palette.findIndex((p) => p.name === name);
  const fillCells = (i0, i1, j0, j1, layer, h, kind) => {
    for (let si = i0 * SUB; si < (i1 + 1) * SUB; si++) for (let sj = j0 * SUB; sj < (j1 + 1) * SUB; sj++) {
      t.paint(si, sj, layer);
      if (h !== undefined) t.set(si, sj, { h, kind });
    }
  };
  fillCells(1, 6, 9, 14, P("Ledge 10"));                 // plateau, stone sides
  fillCells(0, 2, 0, 4, P("Ledge 5"));                   // earth ledge
  fillCells(8, 10, 1, 3, P("Pit"), -8, KIND.PIT);        // pit
  fillCells(8, 10, 6, 8, P("Water"), -4, KIND.WATER);    // sunken pond
  fillCells(6, 7, 7, 7, P("Water"), -1, KIND.WATER);     // a stream spilling into it: a waterfall
  // stairs: cells (3..4, 7..8), descending west from the plateau (8 → 0)
  const st = P("Stairs");
  for (let si = 3 * SUB; si < 5 * SUB; si++) {
    [[17, 8], [16, 6], [15, 4], [14, 2]].forEach(([sj, h]) => { t.paint(si, sj, st, DIR.W); t.set(si, sj, { h }); });
  }
  // a ramp off the earth ledge, descending south
  const ramp = t.palette.length;
  t.palette.push({ name: "Ramp", h: 4, color: "#b48ad0", kind: KIND.RAMP, material: "wood" });
  for (let sj = 3 * SUB; sj < 4 * SUB; sj++) for (let si = 6; si < 7; si++) { t.set(si, sj, { h: 4, layer: ramp, kind: KIND.RAMP, dir: DIR.S }); }
  // the other side materials: an ice block, a brick planter, an edge plinth
  const extra = (name, h, material) => { t.palette.push({ name, h, color: "#9fb07a", kind: KIND.FLOOR, material }); return t.palette.length - 1; };
  fillCells(5, 5, 3, 4, extra("Ice", 5, "ice"));
  fillCells(10, 10, 11, 13, extra("Planter", 2, "brick"));
  fillCells(11, 11, 6, 7, extra("Plinth", 3, "edge"));
  // void notch in the far corner
  for (let si = ROWS * SUB - 2; si < ROWS * SUB; si++) for (let sj = 0; sj < 4; sj++) t.set(si, sj, { kind: KIND.VOID });
  // unseen=pillar: a stone pillar on the grass the party looks past (cell 5, 5, 20 ft)
  if (Q.get("unseen") === "pillar") fillCells(5, 5, 5, 5, extra("Pillar", 16, "stone"), 16);
  // tower=1: a 50 ft tower in the far corner, where unseen=wide hides it
  if (Q.get("tower") === "1") fillCells(10, 10, 14, 14, extra("Tower", 40, "stone"), 40);
  return t;
}

/* ------------------------------------------------------------ art */
function figure({ body, trim, skin, cape, weapon, hat }) {
  const c = mk(300, 460), g = c.getContext("2d");
  g.lineJoin = "round";
  if (cape) { g.fillStyle = cape; g.beginPath(); g.moveTo(90, 170); g.lineTo(40, 440); g.lineTo(260, 440); g.lineTo(210, 170); g.fill(); }
  g.fillStyle = body; g.beginPath(); g.moveTo(95, 180); g.quadraticCurveTo(150, 140, 205, 180); g.lineTo(225, 330); g.lineTo(75, 330); g.closePath(); g.fill();
  g.fillStyle = trim; g.fillRect(80, 300, 140, 22);
  g.fillStyle = "#3a2c22"; g.fillRect(95, 320, 45, 120); g.fillRect(160, 320, 45, 120);
  g.fillStyle = "#241a14"; g.fillRect(88, 425, 58, 25); g.fillRect(155, 425, 58, 25);
  g.fillStyle = skin; g.beginPath(); g.arc(150, 110, 52, 0, 7); g.fill();
  g.fillStyle = "#1c1c22"; g.beginPath(); g.arc(132, 108, 6, 0, 7); g.arc(168, 108, 6, 0, 7); g.fill();
  if (hat) { g.fillStyle = hat; g.beginPath(); g.moveTo(90, 85); g.quadraticCurveTo(150, 10, 210, 85); g.closePath(); g.fill(); }
  if (weapon === "sword") { g.fillStyle = "#d8dde6"; g.fillRect(232, 90, 14, 200); g.fillStyle = "#8a6a2a"; g.fillRect(218, 280, 42, 12); g.fillRect(234, 292, 10, 40); }
  if (weapon === "dagger") { g.fillStyle = "#d8dde6"; g.beginPath(); g.moveTo(240, 210); g.lineTo(252, 300); g.lineTo(228, 300); g.fill(); }
  if (weapon === "club") { g.fillStyle = "#6b4a2a"; g.save(); g.translate(240, 300); g.rotate(-0.4); g.fillRect(-10, -150, 22, 160); g.restore(); }
  g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = 4;
  g.beginPath(); g.arc(150, 110, 52, 0, 7); g.stroke();
  return c.toDataURL();
}

function icon(draw) {
  const c = mk(64, 64), g = c.getContext("2d");
  g.fillStyle = "#ffffff"; g.strokeStyle = "#ffffff"; g.lineWidth = 6; g.lineCap = "round";
  draw(g);
  return c.toDataURL();
}
const ICONS = {
  frightened: icon((g) => { g.beginPath(); g.arc(32, 28, 18, 0, 7); g.fill(); g.fillStyle = "#000"; g.beginPath(); g.arc(25, 26, 4, 0, 7); g.arc(39, 26, 4, 0, 7); g.fill(); g.fillStyle = "#fff"; g.fillRect(22, 44, 20, 10); }),
  prone: icon((g) => { g.beginPath(); g.moveTo(10, 46); g.lineTo(54, 46); g.stroke(); g.beginPath(); g.arc(18, 34, 7, 0, 7); g.fill(); g.fillRect(26, 32, 26, 8); }),
  hidden: icon((g) => { g.beginPath(); g.ellipse(32, 32, 24, 13, 0, 0, 7); g.stroke(); g.beginPath(); g.arc(32, 32, 7, 0, 7); g.fill(); g.beginPath(); g.moveTo(10, 54); g.lineTo(54, 10); g.stroke(); }),
  clumsy: icon((g) => { g.beginPath(); g.moveTo(14, 50); g.quadraticCurveTo(32, 6, 50, 50); g.stroke(); }),
};
// Painted "effect art" icons for the halo (PF2e effects carry full-colour art).
function effectIcon(bg, fg, draw) {
  const c = mk(64, 64), g = c.getContext("2d");
  const gr = g.createRadialGradient(26, 22, 4, 32, 32, 40);
  gr.addColorStop(0, fg); gr.addColorStop(1, bg);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#fff8e6"; g.strokeStyle = "#fff8e6"; g.lineWidth = 5; g.lineCap = "round"; g.lineJoin = "round";
  draw(g);
  return c.toDataURL();
}
const EFFECTS = [
  ICONS.frightened, ICONS.prone,
  effectIcon("#3a1f5c", "#9b6bff", (g) => { g.beginPath(); g.moveTo(36, 8); g.lineTo(20, 36); g.lineTo(32, 36); g.lineTo(26, 56); g.lineTo(46, 26); g.lineTo(34, 26); g.closePath(); g.fill(); }),
  effectIcon("#123a5c", "#5ab8ff", (g) => { g.beginPath(); g.moveTo(32, 10); g.lineTo(52, 18); g.lineTo(50, 38); g.quadraticCurveTo(44, 50, 32, 56); g.quadraticCurveTo(20, 50, 14, 38); g.lineTo(12, 18); g.closePath(); g.fill(); }),
  effectIcon("#5c1a12", "#ff8a3d", (g) => { g.beginPath(); g.moveTo(32, 8); g.quadraticCurveTo(50, 30, 42, 46); g.quadraticCurveTo(36, 56, 32, 56); g.quadraticCurveTo(18, 54, 20, 40); g.quadraticCurveTo(22, 30, 32, 8); g.fill(); }),
  effectIcon("#174a2c", "#5fdb92", (g) => { g.beginPath(); g.moveTo(32, 54); g.bezierCurveTo(6, 36, 12, 12, 32, 22); g.bezierCurveTo(52, 12, 58, 36, 32, 54); g.fill(); }),
  ICONS.hidden,
  effectIcon("#4a3a10", "#ffd24a", (g) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 10 : 24; g.lineTo(32 + Math.cos(a) * r, 33 + Math.sin(a) * r); } g.closePath(); g.fill(); }),
  ICONS.clumsy,
  effectIcon("#20303a", "#b6f7ff", (g) => { g.beginPath(); g.arc(32, 32, 16, 0, 7); g.stroke(); g.beginPath(); g.moveTo(32, 6); g.lineTo(32, 58); g.moveTo(6, 32); g.lineTo(58, 32); g.stroke(); }),
  effectIcon("#3a1020", "#ff66b3", (g) => { g.beginPath(); g.arc(32, 32, 9, 0, 7); g.fill(); g.beginPath(); g.arc(32, 32, 20, 0, 7); g.stroke(); }),
  effectIcon("#2a2a2a", "#98a2b6", (g) => { g.fillRect(16, 16, 32, 32); }),
];
const VALUES = [2, null, null, 3, null, 1, null, null, 1, null, 2, null];
const haloN = Q.has("halo") ? Math.max(0, Math.min(12, Number(Q.get("halo")) || 0)) : 0;
const haloList = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ icon: EFFECTS[(i + from) % EFFECTS.length], value: VALUES[(i + from) % VALUES.length] }));

/* ------------------------------------------------------------ light & vision */
function lightCanvas() {
  const c = mk(COLS * BAKE_PX_PER_CELL, ROWS * BAKE_PX_PER_CELL), g = c.getContext("2d");
  g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "lighter";
  const light = (cx, cy, r, col) => {
    const k = BAKE_PX_PER_CELL;
    const gr = g.createRadialGradient(cx * k, cy * k, 0, cx * k, cy * k, r * k);
    gr.addColorStop(0, col); gr.addColorStop(0.45, col.replace(/[\d.]+\)$/, "0.45)")); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
  };
  light(12, 4, 3.4, "rgba(255,168,84,0.75)");
  light(5.5, 8.6, 4.2, "rgba(255,190,110,0.7)");
  return c;
}

function visionCanvas() {
  const k = BAKE_PX_PER_CELL;
  const c = mk(COLS * k, ROWS * k), g = c.getContext("2d");
  g.fillStyle = "rgb(255,255,0)"; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "rgb(0,255,0)"; g.fillRect(0, 4 * k, 2 * k, 8 * k);          // explored, not visible
  g.fillStyle = "rgb(0,0,0)"; g.fillRect(13 * k, 9 * k, 3 * k, 3 * k);       // never seen
  g.beginPath(); g.arc(13 * k, 9 * k, 1.4 * k, 0, 7); g.fill();
  // unseen=wide: a party's sight in the middle of the map, everything past it never seen
  if (Q.get("unseen") === "wide") {
    g.fillStyle = "rgb(0,0,0)"; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "rgb(0,255,0)"; g.beginPath(); g.ellipse(7 * k, 6.5 * k, 7.2 * k, 5 * k, 0, 0, 7); g.fill();
    g.fillStyle = "rgb(255,255,0)"; g.beginPath(); g.ellipse(7.5 * k, 6.5 * k, 5 * k, 3.6 * k, 0.3, 0, 7); g.fill();
  }
  // unseen=pillar: a party at (2.5, 5.5) seeing past a pillar (cell 5, 5): the hard
  // wedge of sight it casts runs east, never seen, as Foundry's polygon cuts it
  if (Q.get("unseen") === "pillar") {
    const V = [2.5, 5.5], C = [5.5, 5.5], rad = 0.5, far = 30;
    g.fillStyle = "rgb(0,0,0)"; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "rgb(255,255,0)"; g.beginPath(); g.arc(V[0] * k, V[1] * k, 9 * k, 0, 7); g.fill();
    const d = Math.hypot(C[0] - V[0], C[1] - V[1]), base = Math.atan2(C[1] - V[1], C[0] - V[0]), half = Math.asin(rad / d);
    const tan = Math.sqrt(d * d - rad * rad);
    const pt = (a, r) => [(V[0] + Math.cos(a) * r) * k, (V[1] + Math.sin(a) * r) * k];
    g.fillStyle = "rgb(0,0,0)"; g.beginPath();
    g.moveTo(...pt(base - half, tan)); g.lineTo(...pt(base - half, far)); g.lineTo(...pt(base + half, far)); g.lineTo(...pt(base + half, tan));
    g.closePath(); g.fill();
  }
  // unseen=wall: the party outside the walled room, its inside never seen; the
  // mist ends on the walls' own line, not on the floor at their foot
  if (Q.get("unseen") === "wall") {
    g.fillStyle = "rgb(255,255,0)"; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "rgb(0,0,0)"; g.fillRect(10 * k, 2 * k, 4 * k, 4 * k);
    g.fillRect(1.5 * k, 0, 5 * k, 3.6 * k); // north of the fence
  }
  // unseen=dead: the knight on the plateau sees everything the polygon shows,
  // and the ground at the plateau's own foot is dead ground (view/dead-ground.mjs)
  if (Q.get("unseen") === "dead") {
    g.fillStyle = "rgb(255,255,0)"; g.fillRect(0, 0, c.width, c.height);
    const all = { contains: () => true, getBounds: () => ({ x: 0, y: 0, width: COLS * 100, height: ROWS * 100 }) };
    // dead=rogue: from the rogue on the grass instead (the stairs from below, the fence)
    const fromRogue = Q.get("dead") === "rogue";
    const eye = (fromRogue ? 0 : 8) + (0.9 * 6 * 4) / 5;
    const dead = deadGround({ terrain, grid: { size: 100, distance: 5 }, walls: walls(),
      viewers: [{ eye, origin: fromRogue ? rogueAt : knightAt, fov: all }] });
    g.globalCompositeOperation = "multiply"; g.fillStyle = "rgb(0,255,255)";
    for (const [si, sj] of dead) g.fillRect((sj * k) / SUB, (si * k) / SUB, k / SUB, k / SUB);
    g.globalCompositeOperation = "source-over";
  }
  // unseen=cliff: a party on the grass at the plateau's west foot, whose top is
  // past what sight reveals (the outline cuts it out, behind it too). Its faces
  // stand on seen ground and draw; the stairs are open at their foot and draw whole.
  if (Q.get("unseen") === "cliff") {
    g.fillStyle = "rgb(0,0,0)"; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "rgb(255,255,0)"; g.beginPath(); g.arc(5 * k, 6 * k, 9 * k, 0, 7); g.fill();
    g.fillStyle = "rgb(0,0,0)"; g.fillRect(9 * k, 1 * k, 7 * k, 6 * k);
  }
  return c;
}

/* ------------------------------------------------------------ effects */
function beamCanvas() {
  const c = mk(512, 64), g = c.getContext("2d");
  const gr = g.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(0.5, "rgba(130,220,255,1)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 512, 64);
  g.strokeStyle = "rgba(235,250,255,0.95)"; g.lineWidth = 4;
  g.beginPath(); g.moveTo(0, 32);
  for (let x = 0; x <= 512; x += 24) g.lineTo(x, 32 + (rnd() - 0.5) * 26);
  g.stroke();
  return c;
}
function flameCanvas() {
  const c = mk(128, 256), g = c.getContext("2d");
  for (const [w, col] of [[54, "rgba(255,111,26,0.9)"], [36, "rgba(255,177,45,0.95)"], [18, "rgba(255,240,180,1)"]]) {
    g.fillStyle = col; g.beginPath();
    g.moveTo(64, 30); g.quadraticCurveTo(64 + w, 150, 64, 250); g.quadraticCurveTo(64 - w, 150, 64, 30); g.fill();
  }
  return c;
}
function runeCanvas() {
  const c = mk(256, 256), g = c.getContext("2d");
  g.strokeStyle = "rgba(180,151,255,0.95)"; g.lineWidth = 5;
  g.beginPath(); g.arc(128, 128, 112, 0, 7); g.stroke();
  g.lineWidth = 3; g.beginPath(); g.arc(128, 128, 86, 0, 7); g.stroke();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.beginPath(); g.moveTo(128 + Math.cos(a) * 86, 128 + Math.sin(a) * 86); g.lineTo(128 + Math.cos(a + 2.1) * 86, 128 + Math.sin(a + 2.1) * 86); g.stroke(); }
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 120); gr.addColorStop(0, "rgba(180,151,255,0.35)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  return c;
}

/* ------------------------------------------------------------ scene */
const canvas = document.getElementById("view");
const r = new DioramaRenderer({ canvas, pixelRatio: Math.min(2, window.devicePixelRatio || 1) });
window.__renderer = r;
const terrain = buildTerrain();
r.setGrid({ size: SIZE, distance: 5, cols: COLS, rows: ROWS, sceneRect: { x: 0, y: 0, width: COLS * SIZE, height: ROWS * SIZE } });
r.setTerrain(terrain);
r.setBackground(paintMap(), { x: 0, y: 0, width: COLS * SIZE, height: ROWS * SIZE });

let doorState = Q.get("door") || "closed";
const walls = () => {
  const B = 8, T = 18;
  const w = (id, a, b, extra = {}) => ({ id, a, b, type: "wall", door: "none", material: "stone", baseQ: B, topQ: T, ...extra });
  return [
    w("n1", [1000, 200], [1150, 200]),
    w("n2", [1150, 200], [1250, 200], { type: "window" }),
    w("n3", [1250, 200], [1400, 200]),
    w("e", [1400, 200], [1400, 600]),
    w("s1", [1400, 600], [1250, 600]),
    w("door", [1250, 600], [1150, 600], { type: "door", door: doorState }),
    w("s2", [1150, 600], [1000, 600]),
    w("w", [1000, 600], [1000, 200], { material: "plaster" }),
    w("fence", [150, 360], [650, 360], { material: "palisade", baseQ: 0, topQ: 6 }),
    w("hedge", [1000, 1150], [1500, 1150], { material: "hedge", baseQ: 0, topQ: 5 }),
    w("cave", [1500, 760], [1500, 1100], { material: "cave", baseQ: 0, topQ: 10 }),
    w("glass", [450, 700], [450, 1000], { type: "terrain", material: "map", baseQ: 0, topQ: 8 }),
  ];
};
r.setWalls(walls());

const ART = {
  knight: figure({ body: "#3d5fa8", trim: "#e2c25a", skin: "#f0c9a0", cape: "#8a1f2a", weapon: "sword" }),
  rogue: figure({ body: "#2f6b45", trim: "#1d1d1d", skin: "#d9a982", cape: "#23402c", weapon: "dagger", hat: "#1f3a28" }),
  goblin: figure({ body: "#6b4a2e", trim: "#3a2a1c", skin: "#8fb35a", weapon: "club" }),
  wraith: figure({ body: "#4b3f6e", trim: "#2a2340", skin: "#cfc8e8", cape: "#2e2548", hat: "#2e2548" }),
  harpy: figure({ body: "#8a5a3a", trim: "#d9b24a", skin: "#e6b98f", cape: "#5c3a7a", weapon: "dagger", hat: "#3b2a52" }),
  drake: figure({ body: "#9a2f2a", trim: "#f0b13c", skin: "#c9443a", cape: "#5a1a18", weapon: "club" }),
};
let rogueAt = { x: 650, y: 650 };
let ghosts = Q.get("ghosts") !== "0";
// knight=wall: the knight backed against the house's north-west corner, to
// prove a leaning card is never sliced by a wall standing behind it.
const knightAt = Q.get("knight") === "wall" ? { x: 1050, y: 250 } : { x: 1150, y: 450 };
const tokens = () => [
  { id: "harpy", name: "Harpy", x: 350, y: 550, footQ: 12, groundQ: 0, heightQ: 5, widthCells: 1, art: ART.harpy, disposition: -1, visible: true, ghost: false,
    controlled: false, hovered: false, targets: [], turn: null, conditions: [], bars: [{ frac: 0.8, color: PALETTE.hazard }] },
  { id: "drake", name: "Drake", x: 1300, y: 900, footQ: 18, groundQ: 0, heightQ: 9, widthCells: 2, art: ART.drake, disposition: -1, visible: true, ghost: false,
    controlled: true, hovered: false, targets: [], turn: null, conditions: [], bars: [{ frac: 0.55, color: PALETTE.hazard }] },
  { id: "knight", name: "Knight", x: knightAt.x, y: knightAt.y, footQ: 8, groundQ: 8, heightQ: 6, widthCells: 1, art: ART.knight, disposition: 1, visible: true, ghost: false,
    controlled: false, hovered: false, targets: Q.get("target") === "knight" ? [PALETTE.hazard] : [], turn: "current", halo: haloN > 0,
    conditions: haloN > 0 ? haloList(haloN) : [{ icon: ICONS.frightened, value: 2 }, { icon: ICONS.prone }], bars: [{ frac: 0.72, color: PALETTE.good }, { frac: 0.4, color: PALETTE.info }] },
  { id: "rogue", name: "Rogue", x: rogueAt.x, y: rogueAt.y, footQ: 0, heightQ: 5, widthCells: 1, art: ART.rogue, disposition: 1, visible: true, ghost: false,
    controlled: false, hovered: true, targets: [], turn: "next", halo: haloN > 0,
    conditions: haloN > 0 ? haloList(3, 4) : [{ icon: ICONS.hidden }], bars: [{ frac: 1, color: PALETTE.good }] },
  { id: "goblin", name: "Goblin", x: 250, y: 150, footQ: 4, heightQ: 4, widthCells: 1, art: ART.goblin, disposition: -1, visible: true, ghost: false,
    controlled: false, hovered: false, targets: [PALETTE.info, PALETTE.good], turn: null, halo: haloN > 0, conditions: [{ icon: ICONS.clumsy, value: 1 }], bars: [{ frac: 0.3, color: PALETTE.hazard }] },
  { id: "wraith", name: "Wraith", x: 1150, y: 950, footQ: 0, heightQ: 7, widthCells: 1, art: ART.wraith, disposition: -1, visible: false, ghost: true,
    controlled: false, hovered: false, targets: [], turn: null, conditions: [], bars: [] },
  { id: "ogre", name: "Ogre", x: 800, y: 200, footQ: 0, heightQ: 11, widthCells: 2, art: "/does/not/exist.webp", disposition: 0, visible: true, ghost: false,
    controlled: false, hovered: false, targets: [], turn: null, conditions: [], bars: [] },
];
r.setTokens(tokens());
r.setOptions({ ghosts });

// torches=1: the bake's two lights as sources (view/bake.mjs lightData), a torch
// in the house and a brazier on the grass, so they flicker, burn and throw shadows
const TORCHES_ON = Q.get("torches") === "1";
const lightSources = TORCHES_ON ? [
  { id: "AmbientLight.torch", x: 12 * SIZE, y: 4 * SIZE, dim: 3.4 * SIZE, bright: 1.5 * SIZE, elevation: 0, tint: [1, 0.66, 0.33], color: [1, 0.6, 0.25],
    anim: { type: "torch", speed: 5, intensity: 5 }, token: false },
  { id: "AmbientLight.brazier", x: 5.5 * SIZE, y: 8.6 * SIZE, dim: 4.2 * SIZE, bright: 1.8 * SIZE, elevation: 0, tint: [1, 0.75, 0.43], color: [1, 0.62, 0.3],
    anim: { type: null, speed: 5, intensity: 5 }, token: false },
] : null;
r.setLighting({ darkness: Q.has("dark") ? Number(Q.get("dark")) : 0.4, light: lightCanvas(), vision: Q.get("novision") === "1" ? null : visionCanvas(), sources: lightSources });

${ENV_JS}
// ppx=<cells>: pin the weather's device-pixel floor (debugging the particle pass)
if (Q.has("ppx")) Object.defineProperty(r.atmosphere, "pxWorld", { get: () => Number(Q.get("ppx")), set() {} });
// probe=1: the weather layer's state after a few seconds, in #probe (headless --dump-dom)
if (Q.get("probe") === "1") setTimeout(() => {
  const a = r.atmosphere, u = r.shared;
  const v = (x) => (x?.toArray ? x.toArray().map((n) => +n.toFixed(3)) : x);
  const pre = document.createElement("pre");
  pre.id = "probe";
  pre.textContent = JSON.stringify({
    particles: a.pGeo.instanceCount, splashes: a.sGeo.instanceCount, kind: a.pMat.uniforms.uKind.value,
    boxMin: v(a.box.min.value), boxSize: v(a.box.size.value), scale: a.box.scale.value, heightInfo: v(a.heightInfo.value),
    time: u.uEnvTime.value, fx: r.fx, inScene: !!a.particles.parent?.parent, visible: a.particles.visible && a.group.visible,
    seed0: v(a.pGeo.attributes.aSeed.array.slice(0, 4)), opacity: a.pMat.uniforms.uPOpacity.value,
    ndc: (() => { const s = a.pGeo.attributes.aSeed.array; const p = a.box.min.value.clone().add(a.box.size.value.clone().multiply({ x: s[0], y: s[1], z: s[2] })); return v(p.clone().project(r.rig.camera)); })(),
    programs: r.webgl.info.programs?.map((p) => p.name), flash: u.uEnvFlash.value, ambient: u.uAmbient.value, key: v(u.uEnvKey.value), keyDir: v(u.uKeyDir.value),
  });
  document.body.append(pre);
}, 3000);

const path = () => ({ points: [
  { x: rogueAt.x, y: rogueAt.y, zQ: 0 }, { x: 650, y: 450, zQ: 0, color: PALETTE.good }, { x: 750, y: 450, zQ: 2, color: PALETTE.good },
  { x: 850, y: 450, zQ: 6, color: PALETTE.warn }, { x: 950, y: 450, zQ: 8, color: PALETTE.warn },
], color: PALETTE.good });
let pings = [];
// reach=1: the rogue's movement range (rules/reach.mjs), stepping round the
// creatures: the knight (an ally) is passed, never ended on; the goblin's square
// blocks; the ogre (neutral) is passed; the harpy flies clear over it. With unseen=wide its far
// squares run into the mist and must not show there.
const reachOverlay = await (async () => {
  if (Q.get("reach") !== "1") return null;
  const RR = await import("/scripts/features/diorama/rules/reach.mjs");
  const cellOf = (t) => ({ i: Math.round(t.y / SIZE - (t.widthCells || 1) / 2), j: Math.round(t.x / SIZE - (t.widthCells || 1) / 2), w: t.widthCells || 1, h: t.widthCells || 1 });
  const all = tokens();
  const me = all.find((t) => t.id === "rogue");
  const occupied = RR.occupancy?.({
    mover: { w: 1, h: 1, disposition: me.disposition, alt: 0, height: 5 },
    others: all.filter((t) => t !== me && t.visible).map((t) => ({ ...cellOf(t), disposition: t.disposition, alt: (t.footQ - (t.groundQ ?? t.footQ)) * 1.25, height: t.heightQ * 1.25 })),
  });
  const start = cellOf(me);
  const budgets = RR.reachBudgets({ systemId: "pf2e", speed: 25, gridDistance: 5 });
  const solved = RR.solveReach({ start, budget: budgets.at(-1), gridDistance: 5, bounds: { rows: ROWS, cols: COLS }, occupied });
  const cells = solved.cells.filter((c) => c.i !== start.i || c.j !== start.j).map((c) => ({ ...c, band: RR.reachBand(budgets, c.cost) })).filter((c) => c.band);
  return { cells, start: { ...start } };
})();
const overlays = () => ({
  reach: reachOverlay,
  path: Q.get("reach") === "1" ? null : path(),
  cells: { cells: [[8, 9], [8, 10], [9, 9], [9, 10], [10, 9], [10, 10]].map(([i, j]) => ({ i, j })), color: PALETTE.hazard },
  ruler: { a: { x: 1150, y: 450, zQ: 8 }, b: { x: 250, y: 150, zQ: 4 }, color: PALETTE.signal },
  pings,
  hover: { i: 6, j: 6 },
});
r.setOverlays(overlays());

const effects = [
  { id: "bolt", kind: "beam", source: beamCanvas(), x: 1150, y: 450, zQ: 8, x2: 250, y2: 150, z2Q: 4, widthPx: 100, heightPx: 34, rotation: 0, alpha: 0.95, light: { color: PALETTE.cyan, radius: 160 } },
  { id: "flame", kind: "standing", source: flameCanvas(), x: 540, y: 760, zQ: 0, widthPx: 60, heightPx: 110, rotation: 0, alpha: 0.95, light: { color: PALETTE.warn, radius: 200 } },
  { id: "rune", kind: "flat", source: runeCanvas(), x: 1150, y: 950, zQ: 0, widthPx: 260, heightPx: 260, rotation: 15, alpha: 0.9, light: { color: PALETTE.violet, radius: 260 } },
];
r.setEffects(effects);

/* ------------------------------------------------------------ props (props=1) */
// Every shape (south-east grass, three rows of six), every material (west
// grass, as capsules and boxes), a crate stacked on a crate, an image card and
// a GM-only ghost, all built the way the feature builds them: normalised,
// resolved against the terrain, then turned into the GM's states. The tokens,
// effects and overlays step aside so the props read on their own.
// props=1&view=props frames the shapes; props=1&view=mats frames the materials.
const PROPS_ON = Q.get("props") === "1";
if (PROPS_ON) {
  const PM = await import("/scripts/features/diorama/terrain/props.mjs");
  const shapeMat = { box: "stone", cylinder: "metal", cone: "plaster", sphere: "marble", dome: "stone", pyramid: "crystal",
    wedge: "earth", torus: "metal", capsule: "cloth", arch: "stone", pillar: "marble", crate: "wood", barrel: "wood",
    rock: "stone", tree: "foliage", pine: "foliage", bush: "foliage", card: "map" };
  // Card art by a short URL, the way a prop stores a path: a data URL is longer
  // than a stored path may be, and the normaliser drops it.
  const blobUrl = async (dataUrl) => URL.createObjectURL(await (await fetch(dataUrl)).blob());
  const knightUrl = await blobUrl(ART.knight), drakeUrl = await blobUrl(ART.drake);
  const list = [];
  // the first eighteen shapes; props=2 shows the rest
  PM.PROP_SHAPES.slice(0, PM.PROP_SHAPES.indexOf("slab")).forEach((shape, n) => {
    const d = PM.SHAPE_DEFAULTS[shape];
    const k = Math.min(1, 0.9 / Math.max(d.w, d.d));              // fit a 0.9-square slot
    const x = 9.5 + (n % 6), y = 7.4 + Math.floor(n / 6) * 1.25;
    list.push({ id: "s-" + shape, shape, x, y, w: d.w * k, d: d.d * k, h: Math.min(d.h, 2.2) * (shape === "tree" || shape === "pine" ? 0.75 : 1),
      rot: shape === "wedge" ? 90 : shape === "arch" ? 0 : 20, mat: shapeMat[shape], label: shape,
      img: shape === "card" ? knightUrl : undefined });
  });
  list.push({ id: "stack", shape: "crate", x: 14.5, y: 8.65, w: 0.55, d: 0.55, h: 0.5, rot: 35, label: "stacked crate" });
  PM.PROP_MATERIALS.forEach((mat, n) => {
    const x = 0.5 + (n % 6), y = n < 6 ? 4.5 : 6.5;
    list.push({ id: "m-" + mat, shape: n % 2 ? "box" : "capsule", x, y, w: 0.6, d: 0.6, h: n % 2 ? 0.7 : 1.1, rot: 15, mat, label: mat });
  });
  list.push({ id: "tinted", shape: "pillar", x: 8.5, y: 6.5, h: 2, mat: "marble", tint: "#e0a8ff", label: "tinted pillar" });
  list.push({ id: "ghost", shape: "box", x: 15.5, y: 8.5, w: 0.8, d: 0.8, h: 1.2, hidden: true, label: "GM only" });
  list.push({ id: "card2", shape: "card", x: 6.5, y: 4.5, h: 1.4, img: drakeUrl, label: "drake card" });
  const norm = PM.normalizeProps(list);
  const resolved = PM.resolveProps(terrain, norm).props;
  const states = PM.propStates(resolved, { isGM: true });
  r.setTokens([]);
  r.setEffects([]);
  r.setOverlays({});
  r.setProps(states);
  window.__props = { count: states.length, ghosts: states.filter((s) => s.ghost).length, blocks: states.filter((s) => s.blocks).length };
  // probe=props: the layer's state after the art lands, in #probe (headless --dump-dom)
  if (Q.get("probe") === "props") setTimeout(() => {
    const L = r.props, v = (x) => x.toArray().map((n) => +n.toFixed(3));
    const pre = document.createElement("pre");
    pre.id = "probe";
    pre.textContent = JSON.stringify({
      ...window.__props,
      buckets: [...L.buckets].map(([k, b]) => k + ":" + b.mesh.count + "/" + b.caster.count),
      contact: L.contact?.count,
      cards: [...L.cards.values()].map((c) => ({ at: v(c.mesh.position), size: v(c.material.uniforms.uCardSize.value), tex: !!c.texture,
        inScene: !!c.mesh.parent?.parent, casts: !!c.caster.parent,
        art: c.texture ? [...c.texture.image.getContext("2d").getImageData(c.texture.image.width >> 1, c.texture.image.height >> 2, 1, 1).data] : null,
        screen: (({ x, y }) => [Math.round(x), Math.round(y)])(r.project(c.state.x * SIZE, c.state.y * SIZE, (c.state.base + c.state.h / 2) * 4)) })),
      animated: L.animated(r.fx), rules: !!L.rules,
    });
    document.body.append(pre);
  }, 3000);
}

/* ------------------------------------------------------------ props (props=2) */
// The shapes past the first eighteen in the house on the plateau; on the grass
// south of it an outlined slab with metal sides and a turned slab with steps;
// west, a market-stall kit, a path pipe, a model built here in JS (handed to the
// layer through setModelLoader, as a test would) and a model that fails (the
// GM's placeholder). The gable roof is faded to 0.4 (fade=<0..1>).
const PROPS2_ON = Q.get("props") === "2";
if (PROPS2_ON) {
  const PM = await import("/scripts/features/diorama/terrain/props.mjs");
  const MD = await import("/scripts/features/diorama/render/props-models.mjs");
  const T3 = await import("/scripts/features/diorama/render/three.mjs");
  MD.setModelLoader(async (src) => {
    if (src !== "preview/statue.glb") throw new Error("no such file in the preview");
    const scene = new T3.Group();
    const mat = (hex) => new T3.MeshStandardMaterial({ color: hex });
    const add = (g, m, y) => { const o = new T3.Mesh(g, m); o.position.y = y; scene.add(o); };
    add(new T3.CylinderGeometry(1, 1.15, 0.5, 20), mat(0x8a8478), 0.25);
    add(new T3.CylinderGeometry(0.42, 0.55, 2.2, 14), mat(0xb9b2a4), 1.6);
    add(new T3.SphereGeometry(0.62, 16, 12), mat(0xc9a64a), 3.2);
    add(new T3.TorusGeometry(0.75, 0.08, 8, 24).rotateX(Math.PI / 2), mat(0x6d5a3a), 0.62);
    return MD.bakeScene(scene);
  });
  const shapes = PM.PROP_SHAPES.slice(PM.PROP_SHAPES.indexOf("slab")).filter((s) => !["slab", "kit", "model"].includes(s));
  const mats = { pipe: "metal", fence: "wood", parapet: "stone", beam: "wood", sign: "wood", cross: "stone", bowl: "stone", lamp: "metal",
    gable: "wood", hip: "plaster", lean: "wood", spire: "cloth", lathe: "marble", extrude: "earth", platform: "wood", stairs: "stone", hex: "crystal", octagon: "marble" };
  // the house on the plateau (walls x 10..14, y 2..6): four rows of five, each in a 0.7-square slot
  const list = shapes.map((shape, n) => {
    const d = PM.SHAPE_DEFAULTS[shape];
    const k = Math.min(1, 0.68 / Math.max(d.w, d.d));
    return { id: "n-" + shape, shape, x: 10.45 + (n % 5) * 0.78, y: 2.5 + Math.floor(n / 5) * 0.95, w: d.w * k, d: d.d * k, h: Math.min(d.h, 1.3) * (shape === "lamp" ? 0.55 : 1),
      rot: shape === "stairs" || shape === "fence" || shape === "parapet" ? 0 : 20, mat: mats[shape] ?? d.mat, label: shape,
      ...(shape === "extrude" ? { h: 0.3, bevel: 0.06, points: [[-0.3, -0.24], [0.06, -0.33], [0.33, -0.06], [0.22, 0.3], [-0.26, 0.26]] } : {}) };
  });
  // south grass (x 9..15, y 7..10): slabs
  list.push({ id: "slab-out", shape: "slab", x: 0, y: 0, points: [[9.15, 7.2], [11.4, 7.45], [11.1, 8.9], [9.6, 9.3], [9.05, 8.4]], h: 0.5, cliff: "metal", label: "outlined slab" });
  list.push({ id: "slab-rot", shape: "slab", x: 13.2, y: 7.9, w: 1.8, d: 1.1, h: 0.75, rot: 25, cliff: "brick", label: "turned slab" });
  // the steps meet the turned slab's front edge: its centre 0.85 squares down the slab's own axis
  list.push({ id: "slab-steps", shape: "stairs", x: 12.84, y: 8.67, w: 1, d: 0.6, h: 0.75, rot: 25, label: "steps onto the slab" });
  // west grass (x 0..7, y 4..8): a kit, a path pipe, a model and a model that failed
  list.push({ id: "stall", shape: "kit", kit: "stall", x: 1.6, y: 5.4, rot: 0, label: "stall", parts: [
    { shape: "box", x: 0, y: 0, w: 1.6, d: 0.8, h: 0.8, mat: "wood" },
    { shape: "cylinder", x: -0.85, y: 0.45, w: 0.1, d: 0.1, h: 1.4, mat: "wood", solid: false },
    { shape: "cylinder", x: 0.85, y: 0.45, w: 0.1, d: 0.1, h: 1.4, mat: "wood", solid: false },
    { shape: "gable", x: 0, y: 0, w: 2, d: 1.2, h: 0.5, elev: 1.4, mat: "cloth", tint: "#a33a2a" },
  ] });
  list.push({ id: "duct", shape: "pipe", x: 0, y: 0, path: [[0.4, 7.2, 0.15], [2, 7.2, 0.15], [2, 6.6, 0.6], [3, 6.6, 0.6]], thick: 0.22, label: "path pipe" });
  list.push({ id: "statue", shape: "model", x: 6, y: 4.7, w: 1, d: 1, h: 1.6, src: "preview/statue.glb", label: "model" });
  list.push({ id: "lost", shape: "model", x: 6.1, y: 6.2, w: 0.8, d: 0.8, h: 1, src: "preview/missing.glb", label: "model that failed" });
  // a slab's outline is absolute here for readability: make it relative, the way a layout does
  const o = list.find((p) => p.id === "slab-out");
  const cx = (Math.min(...o.points.map((q) => q[0])) + Math.max(...o.points.map((q) => q[0]))) / 2;
  const cy = (Math.min(...o.points.map((q) => q[1])) + Math.max(...o.points.map((q) => q[1]))) / 2;
  Object.assign(o, { x: cx, y: cy, points: o.points.map(([x, y]) => [x - cx, y - cy]) });
  const d0 = list.find((p) => p.id === "duct");
  const px0 = (Math.min(...d0.path.map((q) => q[0])) + Math.max(...d0.path.map((q) => q[0]))) / 2;
  const py0 = (Math.min(...d0.path.map((q) => q[1])) + Math.max(...d0.path.map((q) => q[1]))) / 2;
  Object.assign(d0, { x: px0, y: py0, path: d0.path.map(([x, y, z]) => [x - px0, y - py0, z]) });
  const norm = PM.normalizeProps(list);
  const states = PM.propStates(PM.resolveProps(terrain, norm).props, { isGM: true });
  r.setTokens([]);
  r.setEffects([]);
  r.setOverlays({});
  r.setProps(states);
  const fade = Q.has("fade") ? Number(Q.get("fade")) : 0.4;
  r.props.setRoofFade(new Map([["n-gable", fade]]));
  window.__props = { count: states.length, ghosts: states.filter((s) => s.ghost).length, blocks: states.filter((s) => s.blocks).length };
  if (Q.get("probe") === "props") setTimeout(() => {
    const L = r.props;
    const pre = document.createElement("pre");
    pre.id = "probe";
    pre.textContent = JSON.stringify({
      ...window.__props,
      buckets: [...L.buckets].map(([k, b]) => k + ":" + b.mesh.count),
      slabs: L.slabs.ranges.map((s) => s.id), lod: L.common.uPropLod.value, animated: L.animated(r.fx),
    });
    document.body.append(pre);
  }, 3000);
}

// unseen=cliff: a pine at the plateau's lip, in plain 3D sight from below though the
// ground under it is hidden (view/props-seen.mjs), and a crate set back that is not.
// seen=0 draws them as the bake alone would.
if (Q.get("unseen") === "cliff" && !TORCHES_ON && !PROPS_ON && !PROPS2_ON) {
  const PM = await import("/scripts/features/diorama/terrain/props.mjs");
  const norm = PM.normalizeProps([
    { id: "lip-pine", shape: "pine", x: 9.6, y: 3.5, w: 0.9, d: 0.9, h: 3, rot: 0, label: "pine at the lip" },
    { id: "back-crate", shape: "crate", x: 13.5, y: 3.5, w: 0.7, d: 0.7, h: 0.6, rot: 20, label: "crate set back" },
  ]);
  r.setProps(PM.propStates(PM.resolveProps(terrain, norm).props, { isGM: false }));
  r.setPropsSeen(new Set(Q.get("seen") === "0" ? [] : ["lip-pine"]));
}

// torches=1: the brazier the second light burns in (a warm light on a prop named for a fire)
if (TORCHES_ON && !PROPS_ON && !PROPS2_ON) {
  const PM = await import("/scripts/features/diorama/terrain/props.mjs");
  const norm = PM.normalizeProps([{ id: "brazier", shape: "brazier", x: 5.5, y: 8.6, w: 0.55, d: 0.55, h: 0.5, rot: 0, label: "Brazier" }]);
  r.setProps(PM.propStates(PM.resolveProps(terrain, norm).props, { isGM: true }));
  // probe=torches: the living-light layer's state after a few seconds, in #probe (headless --dump-dom)
  if (Q.get("probe") === "torches") setTimeout(() => {
    const T = r.torches, u = r.shared;
    const pre = document.createElement("pre");
    pre.id = "probe";
    pre.textContent = JSON.stringify({
      lights: T.lights.map((l) => ({ id: l.id, kind: l.kind, y: +l.y?.toFixed(2) })), fires: T.fires.length,
      flames: T.flameGeo.instanceCount, embers: T.emberGeo.instanceCount, shadows: T.shadowGeo.instanceCount,
      shadow0: [...T.shadowAttr.aFoot.array.slice(0, 4), ...T.shadowAttr.aDir.array.slice(0, 4)].map((v) => +v.toFixed(3)),
      count: u.uTorchCount.value, dir: u.uTorchDir.value, fx: r.fx,
      entries: [...(r.standees.entries?.values() ?? [])].slice(0, 2).map((e) => ({ vis: e.root?.visible, pos: e.root?.position?.toArray?.(), st: e.state && { groundQ: e.state.groundQ, ghost: e.state.ghost }, cardH: e.cardH })),
    });
    document.body.append(pre);
  }, 3000);
}

// links=1: target lines (the 3D form of stream-targets' 2D lines)
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
let links = Q.get("links") === "1" ? [
  { sourceId: "knight", targetId: "goblin", color: rgbOf(PALETTE.info) },
  { sourceId: "rogue", targetId: "drake", color: rgbOf(PALETTE.good) },
  { sourceId: "knight", targetId: "nobody", color: rgbOf(PALETTE.hazard) },   // dropped: not on the board
] : [];
r.setLinks(links);

${SHED_JS}

let cam = { yawStep: Number(Q.get("yaw") ?? 0), pitchIndex: Number(Q.get("pitch") ?? 0), zoom: 1, target: { x: 800, y: 600, zQ: 2 } };
const view = Q.get("view") || "full";
if (view === "close") cam = { ...cam, zoom: 2.1, target: { x: 1050, y: 500, zQ: 6 } };
else if (view === "wall") cam = { ...cam, zoom: 2.6, target: { x: knightAt.x, y: knightAt.y, zQ: 10 } };
else if (view === "fly") cam = { ...cam, zoom: 1.7, target: { x: 900, y: 750, zQ: 4 } };
else if (view === "knight") cam = { ...cam, zoom: 3.2, target: { x: knightAt.x, y: knightAt.y, zQ: 10 } };
else if (view === "goblin") cam = { ...cam, zoom: 3.2, target: { x: 250, y: 150, zQ: 6 } };
else if (view === "rogue") cam = { ...cam, zoom: 3.2, target: { x: rogueAt.x, y: rogueAt.y, zQ: 2 } };
else if (view === "props") cam = { ...cam, zoom: 2.2, target: { x: 1200, y: 880, zQ: 2 } };
else if (view === "mats") cam = { ...cam, zoom: 2.4, target: { x: 380, y: 560, zQ: 2 } };
else if (view === "props2") cam = { ...cam, zoom: 2.4, target: { x: 1200, y: 400, zQ: 8 } };
else if (view === "slabs") cam = { ...cam, zoom: 2.4, target: { x: 1200, y: 830, zQ: 2 } };
else if (view === "kits") cam = { ...cam, zoom: 2.2, target: { x: 380, y: 580, zQ: 2 } };
else cam.zoom = 0.82;
if (Q.has("zoom")) cam.zoom = Number(Q.get("zoom"));
r.setCamera(cam, { animate: false });
// grid=1: the square grid on walkable tops, in the scene's colour and alpha
let grid = { on: Q.get("grid") === "1", color: "#000000", alpha: 0.35 };
r.setOptions({ tiltShift: Q.get("tilt") === "1", cutaway: Q.get("cutaway") !== "0", grid });

// levels=1: a two-Level scene (v14 Levels), through the shipped pure modules.
// The painted map is the upper floor ("hall", base 20 ft) with a hole in its
// south-west corner; a cellar below (base 0) is drawn by setLevels at its own
// base with its own art, dimmed, and a rat stands on it under the hole.
// levels=ghost: the hall does not list the cellar as visible, so only a GM sees
// it, as a dimmer ghost. A still: the actions below re-feed the one-Level scene.
const LEVELS = Q.get("levels");
if (LEVELS) {
  const LV = await import("/scripts/features/diorama/terrain/levels.mjs");
  const VL = await import("/scripts/features/diorama/view/levels.mjs");
  const docs = [
    { id: "cellar", name: "Cellar", elevation: { bottom: null, top: 20 }, visibility: { levels: [] } },
    { id: "hall", name: "Hall", elevation: { bottom: 20, top: null }, visibility: { levels: LEVELS === "ghost" ? [] : ["cellar"] } },
  ];
  const lvScene = { levels: { get: (id) => docs.find((d) => d.id === id), contents: docs }, _view: "hall" };
  const dq = Math.round(LV.levelBaseQ(lvScene, "hall", 5));
  const hole = (i, j) => j < 4 && i >= 7;
  const upper = LV.shiftTerrain(terrain, dq);
  for (let si = 0; si < ROWS * SUB; si++) for (let sj = 0; sj < COLS * SUB; sj++) {
    if (hole(Math.floor(si / SUB), Math.floor(sj / SUB))) upper.set(si, sj, { kind: KIND.VOID });
  }
  const cellar = Terrain.blank(COLS, ROWS);
  for (const [i, j] of [[8, 1], [8, 2], [10, 0]]) for (let a = 0; a < SUB; a++) for (let b = 0; b < SUB; b++) cellar.set(i * SUB + a, j * SUB + b, { h: 4 });
  const cellarArt = (() => {
    const c = mk(COLS * 32, ROWS * 32), g = c.getContext("2d");
    g.fillStyle = "#4a4038"; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = "rgba(20,14,10,0.6)"; g.lineWidth = 2;
    for (let i = 0; i <= ROWS * 2; i++) for (let j = 0; j <= COLS * 2; j++) {
      g.fillStyle = (i + j) % 3 ? "#564a40" : "#5e5246";
      g.fillRect(j * 16 + 1, i * 16 + 1, 14, 14);
    }
    return c;
  })();
  const plan = VL.stackPlan(LV.levelsOf(lvScene), "hall", { gm: true });
  const rect = { x: 0, y: 0, width: COLS * SIZE, height: ROWS * SIZE };
  r.setTerrain(upper);
  r.setLevels(VL.levelInputs(plan, (id) => (id === "cellar" ? cellar : null), () => cellarArt, rect));
  r.setWalls(walls().map((w) => ({ ...w, baseQ: w.baseQ + dq, topQ: w.topQ + dq })));
  const lifted = tokens().map((tk) => ({ ...tk, footQ: (tk.footQ ?? 0) + dq, groundQ: (tk.groundQ ?? 0) + dq }));
  r.setTokens([...lifted, { id: "rat", name: "Rat", x: 250, y: 950, footQ: 0, groundQ: 0, heightQ: 3, widthCells: 1, art: ART.goblin,
    disposition: -1, visible: true, ghost: false, controlled: false, hovered: false, targets: [], turn: null, conditions: [], bars: [] }]);
  cam = { ...cam, target: { ...cam.target, zQ: (cam.target?.zQ ?? 0) + dq } };
  r.setCamera(cam, { animate: false });
  window.__levels = { plan: { below: plan.below.map((l) => ({ id: l.id, dim: l.dim, ghost: l.ghost })), cut: [...plan.cut] }, dq };
}

// buildings=1: Foundry tiles in 3D (docs/DIORAMA_BUILDINGS.md), through the
// shipped pure modules: a FADE roof tile over the house (standing on its walls),
// a rug decal on the plaza inside it, a turned and mirrored banner decal on the
// grass, and a GM-only hidden tile drawn as a ghost.
//   roof=in      the knight is a viewer's figure inside: the roof fades (default)
//   roof=out     nobody inside: the roof is shut
//   roof=cut     the GM's cut-away roofs
//   roof=radial  a RADIAL roof: a hole round the knight
//   view=house   frames the house; probe=tiles dumps the layer into #probe
if (Q.get("buildings") === "1") {
  const TI = await import("/scripts/features/diorama/integrations/tiles.mjs");
  const VR = await import("/scripts/features/diorama/view/roofs.mjs");
  const art = (w, h, paint) => { const c = mk(w, h); paint(c.getContext("2d"), w, h); return c.toDataURL(); };
  const roofArt = art(256, 256, (g, w, h) => {
    g.fillStyle = "#6e3b2a"; g.fillRect(0, 0, w, h);
    for (let row = 0; row < 16; row++) for (let k = -1; k < 17; k++) {
      const x = k * 16 + (row % 2) * 8, y = row * 16;
      g.fillStyle = ["#7e4632", "#8a4e36", "#73402e"][(row * 7 + k * 3 + 9) % 3];
      g.fillRect(x + 1, y + 1, 14, 13);
      g.fillStyle = "rgba(20,10,6,0.35)"; g.fillRect(x + 1, y + 12, 14, 2);
    }
    g.fillStyle = "#4a2a1e"; g.fillRect(0, h / 2 - 5, w, 10);   // the ridge
    g.strokeStyle = "#3a2018"; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  });
  const rugArt = art(200, 120, (g, w, h) => {
    g.fillStyle = "#7a1f2b"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#e2c25a"; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20);
    g.fillStyle = "#2b3f78"; g.beginPath(); g.ellipse(w / 2, h / 2, 46, 26, 0, 0, Math.PI * 2); g.fill();
  });
  // an arrow pointing right, so a mirror shows
  const bannerArt = art(200, 100, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = "rgba(226,194,90,0.92)";
    g.beginPath(); g.moveTo(10, 30); g.lineTo(130, 30); g.lineTo(130, 8); g.lineTo(192, 50); g.lineTo(130, 92); g.lineTo(130, 70); g.lineTo(10, 70); g.closePath(); g.fill();
  });
  const secretArt = art(100, 100, (g, w, h) => { g.fillStyle = "#3a3f4a"; g.fillRect(0, 0, w, h); g.fillStyle = "#c0c6d4"; g.fillRect(30, 30, 40, 40); });
  const roofMode = Q.get("roof") || "in";
  const mode = roofMode === "radial" ? TI.OCC.RADIAL : TI.OCC.FADE;
  const tex = (src, o = {}) => ({ src, anchorX: 0.5, anchorY: 0.5, fit: "fill", scaleX: 1, scaleY: 1, tint: "#ffffff", ...o });
  const tileDocs = [
    { id: "roof", x: 1200, y: 400, width: 420, height: 420, rotation: 0, elevation: 20, alpha: 1, hidden: false, sort: 3, texture: tex(roofArt), occlusion: { modes: new Set([mode]), alpha: 0.15 } },
    { id: "rug", x: 1200, y: 400, width: 200, height: 120, rotation: 0, elevation: 10, alpha: 1, hidden: false, sort: 1, texture: tex(rugArt), occlusion: { modes: new Set(), alpha: 0 } },
    { id: "banner", x: 650, y: 900, width: 200, height: 100, rotation: 30, elevation: 0, alpha: 1, hidden: false, sort: 2, texture: tex(bannerArt, { scaleX: -1 }), occlusion: { modes: new Set(), alpha: 0 } },
    { id: "secret", x: 250, y: 950, width: 100, height: 100, rotation: 0, elevation: 0, alpha: 1, hidden: true, sort: 0, texture: tex(secretArt), occlusion: { modes: new Set(), alpha: 0 } },
  ];
  const groundTopQ = (box) => {
    let top = 0;
    for (const [x, y] of box) top = Math.max(top, terrain.groundAt(Math.min(COLS * SIZE - 1, x), Math.min(ROWS * SIZE - 1, y), SIZE));
    return top;
  };
  const tiles = tileDocs.map((d) => TI.tileStateOf(d, { gmView: true, distance: 5, walls: walls(), groundTopQ })).filter(Boolean);
  r.setTiles(tiles);
  const roof = tiles.find((t) => t.id === "roof");
  const poly = roof.box.map(([x, y]) => [x / SIZE, y / SIZE]);
  const y = roof.roofQ / 4;
  const knight = { x: knightAt.x / SIZE, z: knightAt.y / SIZE, footY: 2, headY: 3.5 };
  const inside = roofMode !== "out" && VR.underRoof(knight, poly, y);
  const tgt = VR.roofTarget({ source: "tile", mask: roof.mask, occludedAlpha: roof.occludedAlpha }, {
    gmView: roofMode === "cut", cutaway: roofMode === "cut", inside, below: inside,
    holes: inside ? [{ x: knight.x, z: knight.z, r: 0.9, footY: knight.footY, headY: knight.headY }] : [], visionMap: false,
  });
  r.setRoofs({ roofs: [{ id: "roof", source: "tile", poly, baseY: y, topY: y, ...tgt, open: roof.occludedAlpha, seen: 1 }], focus: inside ? [knight] : [] });
  window.__buildings = { tiles: tiles.map((t) => ({ id: t.id, kind: t.kind, roofQ: t.roofQ, ghost: t.ghost })), target: tgt };
  if (view === "house") { cam = { ...cam, zoom: 2.2, target: { x: 1200, y: 450, zQ: 10 } }; r.setCamera(cam, { animate: false }); }
  if (Q.get("probe") === "tiles") setTimeout(() => {
    const L = r.tiles;
    const pre = document.createElement("pre");
    pre.id = "probe";
    pre.textContent = JSON.stringify({
      ...window.__buildings,
      entries: [...L.entries.values()].map((e) => ({ id: e.state.id, visible: e.mesh.visible, tex: !!e.material.uniforms.uTileTex.value, casting: e.casting,
        fade: +e.material.uniforms.uRoofFade.value.toFixed(3), holeK: +e.material.uniforms.uRoofHoleK.value.toFixed(3), verts: e.geometry.getAttribute("position")?.count ?? 0 })),
      maxY: L.maxY,
    });
    document.body.append(pre);
  }, 3000);
}

function resize() { r.resize(window.innerWidth, window.innerHeight); }
window.addEventListener("resize", resize);
resize();

/* ------------------------------------------------------------ token life (life=…) */
// life=walk  a squire walks five squares east along the plaza
// life=fall  a squire walks east off the 5 ft earth ledge and drops to the grass
// life=drop  a squire walks south off the 10 ft plateau
// life=fly   the harpy hovers on its stand
// life=land  the harpy glides down to land on the grass
// seek=<ms>  freeze the standees' clock that long after the move starts (stills
//            mid-hop, mid-fall, at the dust). Without it the move repeats.
// tokenLife=0 turns token animation off (the old slide).
const LIFE = Q.get("life");
if (LIFE) {
  const SC = {
    walk: { id: "squire", from: { x: 950, y: 650, footQ: 8 }, to: { x: 1450, y: 650, footQ: 8 }, cam: { x: 1200, y: 650, zQ: 12 }, zoom: 2.2 },
    fall: { id: "squire", from: { x: 350, y: 250, footQ: 4 }, to: { x: 650, y: 250, footQ: 0 }, cam: { x: 520, y: 260, zQ: 2 } },
    drop: { id: "squire", from: { x: 950, y: 650, footQ: 8 }, to: { x: 950, y: 950, footQ: 0 }, cam: { x: 950, y: 800, zQ: 4 } },
    fly: { id: "harpy", cam: { x: 350, y: 550, zQ: 16 } },
    land: { id: "harpy", from: { x: 350, y: 550, footQ: 12, groundQ: 0 }, to: { x: 550, y: 550, footQ: 0 }, cam: { x: 450, y: 550, zQ: 3 } },
  }[LIFE];
  if (SC) {
    const squire = { id: "squire", name: "Squire", heightQ: 6, widthCells: 1, art: ART.knight, disposition: 1, visible: true, ghost: false,
      controlled: false, hovered: false, targets: [], turn: null, conditions: [], bars: [{ frac: 0.9, color: PALETTE.good }] };
    const all = tokens();
    const tmpl = all.find((t) => t.id === SC.id) ?? squire;
    // only the figure in the scene (others=1 keeps the rest of the cast)
    const others = Q.get("others") === "1" ? all.filter((t) => t.id !== SC.id) : [];
    document.getElementById("label").style.display = "none";
    const at = (p) => ({ ...tmpl, x: p.x, y: p.y, footQ: p.footQ, groundQ: p.groundQ ?? p.footQ });
    const S = r.standees, F = S.frame.bind(S);
    const seek = Q.has("seek") ? Number(Q.get("seek")) : null;
    let t0 = null;
    if (seek !== null) S.frame = (now, ...a) => F(t0 === null ? now : t0 + seek, ...a);
    if (SC.from) r.setTokens([...others, at(SC.from)]);
    // the figure reads on its own: no effects, path or pings in the way
    r.setEffects([]);
    r.setOverlays({});
    r.setCamera({ ...cam, zoom: Q.has("zoom") ? Number(Q.get("zoom")) : SC.zoom ?? 3, target: SC.cam }, { animate: false });
    const go = () => {
      t0 = performance.now();
      if (SC.from) { S.set([...others, at(SC.from)], t0 - 1, false); S.set([...others, at(SC.to)], t0, true); }
      r.requestRender();
    };
    // after the first frame, so the board is drawn before anything moves
    setTimeout(() => {
      go();
      if (seek === null && SC.from) setInterval(go, 3200);
    }, 400);
    window.__life = () => ({ t0, seek, plan: S.entries.get(SC.id)?.move?.plan ?? null, dust: S.dust.live });
    // probe=life: the walker, the pool and the frame flags after the scene ran, in #probe (headless --dump-dom)
    if (Q.get("probe") === "life") setTimeout(() => {
      const e = S.entries.get(SC.id), v = (p) => [p.x, p.y, p.z].map((n) => +n.toFixed(3));
      const pre = document.createElement("pre");
      pre.id = "probe";
      pre.textContent = JSON.stringify({ fx: { life: r.fx?.life, dust: r.fx?.dust, hover: r.fx?.hover }, flags: [S._life, S._dust, S._hover],
        root: e && v(e.root.position), squash: e?.body.scale.y, hoverW: e?.hoverW, live: S.dust.live,
        motes: S.dust.motes.filter((m) => m.visible).map((m) => [...v(m.position), +m.scale.x.toFixed(3), +m.material.uniforms.uOpacity.value.toFixed(3)]),
        inScene: (() => { let o = S.dust.motes[0]; while (o.parent) o = o.parent; return o === r.scene; })(),
        groupVisible: S.dust.group.visible && S.group.visible, tex: S.dust.texture?.image?.width ?? null,
        screen: (() => { const m = S.dust.motes.find((x) => x.visible); if (!m) return null; const p = r.project(m.position.x * 100, m.position.z * 100, m.position.y * 4); return [Math.round(p.x), Math.round(p.y)]; })() });
      document.body.append(pre);
    }, 1500);
  }
}

/* ------------------------------------------------------------ tactics (areas=1, los=…, fall=1) */
// areas=1  spell areas as volumes: a burst on the plateau's corner pouring over its
//          edge, a cone, a line and an emanation round the goblin, each on PF2e's squares
// los=a-b[,c-d]  the line of sight from a's eye to b, broken where ground or a wall stops
//          it, with the real readout (distance, height, cover badge) from view/tactics.mjs
// fall=1   a dragged path off the plateau's south edge: the drop line and its damage
const TACTICS = Q.get("areas") === "1" || Q.has("los") || Q.get("fall") === "1";
if (TACTICS && !LIFE && !PROPS_ON) {
  const V = await import("/scripts/features/diorama/view/tactics.mjs");
  const LOS = await import("/scripts/features/diorama/rules/los.mjs");
  const D3 = await import("/scripts/features/diorama/rules/distance3d.mjs");
  const { analyzePath } = await import("/scripts/features/diorama/rules/path.mjs");
  for (const href of ["/styles/gl-tokens.css", "/styles/diorama.css"]) {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.append(l);
  }
  // the shipped strings, formatted as game.i18n.format does
  const strings = Object.assign({}, ...(await Promise.all(["/lang/diorama.en.json", "/lang/diorama-rules.en.json"].map((u) => fetch(u).then((x) => x.json())))));
  const t = (k, d = {}) => (strings[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => (n in d ? d[n] : "{" + n + "}"));
  document.getElementById("label").style.display = "none";
  r.setEffects([]);
  const grid = { size: SIZE, distance: 5, units: "ft" };
  const toks = Object.fromEntries(tokens().map((tk) => [tk.id, tk]));
  const box = document.createElement("div");
  box.className = "gldio-labels gl-type";
  box.style.position = "fixed";
  box.style.zIndex = "2";
  document.body.append(box);
  const placed = [];
  const putLabel = (world, lines, tone) => {
    const n = document.createElement("div");
    n.className = "gldio-label gl-glass";
    n.dataset.tone = tone;
    lines.forEach((s, k) => {
      const row = document.createElement("div");
      if (s && typeof s === "object") {
        row.className = "gldio-label-sub";
        const chip = document.createElement("span");
        chip.className = "gl-chip gl-chip-solid";
        chip.textContent = s.text;
        chip.style.setProperty("--gl-accent", "var(--gl-" + s.chip + ")");
        row.append(chip);
      } else { row.className = k ? "gldio-label-sub" : "gldio-label-main"; row.textContent = s; }
      n.append(row);
    });
    box.append(n);
    placed.push({ n, world });
  };
  const over = { cells: [], los: [], falls: [], marks: [] };

  if (Q.get("areas") === "1") {
    const sq = D3.pf2eSquares;
    const cellsWhere = (f) => { const out = []; for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) if (f((j + 0.5) * SIZE, (i + 0.5) * SIZE, i, j)) out.push({ i, j }); return out; };
    const d5 = (x0, y0, x1, y1) => sq(Math.ceil(Math.abs(x1 - x0) / SIZE - 1e-9), Math.ceil(Math.abs(y1 - y0) / SIZE - 1e-9));
    const deg = Math.PI / 180;
    // PF2e's rules squares, restated from pf2e-aoe/data.mjs for a page with no canvas
    const burst = { id: "burst", kind: "burst", origin: { x: 1500, y: 700 }, radius: 2, color: PALETTE.hazard };
    burst.cells = cellsWhere((x, y) => d5(x, y, 1500, 700) <= 2);
    const cone = { id: "cone", kind: "cone", origin: { x: 300, y: 600 }, radius: 3, direction: 0, angle: 90 * deg, color: PALETTE.info };
    cone.cells = cellsWhere((x, y) => {
      const a = Math.atan2(y - 600, x - 300);
      return Math.abs(a) <= 45 * deg + 1e-9 && d5(x, y, 300, 600) <= 3;
    });
    const line = { id: "line", kind: "line", origin: { x: 600, y: 1100 }, color: PALETTE.violet };
    line.cells = cellsWhere((x, y) => y > 1100 && y < 1200 && x > 600 && x < 1200);
    const gob = toks.goblin;
    const em = { id: "aura", kind: "emanation", origin: { x: gob.x, y: gob.y }, radius: 1, base: [0.5, 0.5], color: PALETTE.good };
    em.cells = cellsWhere((x, y) => d5(x, y, gob.x, gob.y) <= 1);
    const list = [burst, cone, line, em];
    r.setAreas(list);
    for (const a of list) for (const c of a.cells) over.cells.push({ ...c, color: a.color });
    window.__areas = list.map((a) => ({ id: a.id, cells: a.cells.length, meshes: r.areas.count }));
  }

  if (Q.has("los")) {
    const sightWalls = walls().filter((w) => w.type === "wall" && w.baseQ > 0).map((w) => ({ ax: w.a[0], ay: w.a[1], bx: w.b[0], by: w.b[1], topQ: w.topQ }));
    for (const pair of Q.get("los").split(",")) {
      const [an, bn] = pair.split("-"), A = toks[an], B = toks[bn];
      if (!A || !B) continue;
      const eye = A.footQ + A.heightQ * 0.9;
      const res = LOS.lineOfSight(terrain, { x: A.x, y: A.y, eyeQ: eye }, { x: B.x, y: B.y, footQ: B.footQ, heightQ: B.heightQ, radiusPx: (B.widthCells * SIZE) / 2 }, SIZE, { walls: sightWalls });
      const boxOf = (tk) => ({ x: tk.x - (tk.widthCells * SIZE) / 2, y: tk.y - (tk.widthCells * SIZE) / 2, w: tk.widthCells * SIZE, h: tk.widthCells * SIZE,
        elevation: (tk.footQ / 4) * 5, height: tk.widthCells * 5, actor: true });
      const distance = D3.pf2eDistance(boxOf(A), boxOf(B), { size: SIZE, distance: 5 }).distance;
      const read = { ...res, distance, rise: ((B.footQ - A.footQ) / 4) * 5 };
      const tone = V.sightTone(read);
      const tc = { info: PALETTE.info, warn: PALETTE.warn, hazard: PALETTE.hazard, peril: PALETTE.peril }[tone];
      over.los.push({ id: pair, a: res.line.a, b: res.line.b, pieces: LOS.lineStyles(res.line.spans), color: tc, strength: 1 });
      putLabel({ x: B.x, y: B.y, zQ: B.footQ + B.heightQ + 1 }, V.sightLines(read, { systemId: "pf2e", units: "ft", gridDistance: 5, t }), tone);
    }
  }

  if (Q.get("fall") === "1") {
    const cells = [{ i: 4, j: 11 }, { i: 5, j: 11 }, { i: 6, j: 11 }, { i: 7, j: 11 }, { i: 8, j: 11 }];
    const an = analyzePath(terrain, cells, grid);
    const fr = V.fallReadouts({ terrain, cells, falls: an.falls, grid, systemId: "pf2e", t });
    over.falls = fr.lines;
    over.path = { points: cells.map((c) => ({ x: (c.j + 0.5) * SIZE, y: (c.i + 0.5) * SIZE, zQ: terrain.cellTop(c.i, c.j), color: PALETTE.good })), color: PALETTE.good };
    over.marks = an.falls.map((f) => ({ i: f.i, j: f.j, color: PALETTE.hazard, alpha: 0.45 }));
    for (const l of fr.labels) putLabel(l.world, l.lines, l.tone);
  }

  const { marks, cells, ...rest } = over;
  r.setOverlays({ ...rest, cells: [...cells, ...marks] });
  const follow = () => {
    for (const p of placed) {
      const at = r.project(p.world.x, p.world.y, p.world.zQ);
      p.n.style.setProperty("--gldio-x", Math.round(at.x) + "px");
      p.n.style.setProperty("--gldio-y", Math.round(at.y) + "px");
    }
    requestAnimationFrame(follow);
  };
  follow();
  // at=x,y,zQ points the camera (px, q) for close stills
  const at = Q.has("at") ? Q.get("at").split(",").map(Number) : [800, 600, 2];
  if (Q.get("view") === "tactics" || !Q.has("view")) r.setCamera({ ...cam, zoom: Q.has("zoom") ? Number(Q.get("zoom")) : 1.05, target: { x: at[0], y: at[1], zQ: at[2] ?? 2 } }, { animate: false });
  // the page's hover handler would put the old overlays back over these
  window.__tacticsOverlays = { ...rest, cells: [...cells, ...marks] };
}

/* ------------------------------------------------------------ UI */
const status = document.getElementById("status"), label = document.getElementById("label");
let opts = { tiltShift: Q.get("tilt") === "1", cutaway: Q.get("cutaway") !== "0" };
function showState(extra = "") {
  const c = r.getCamera();
  status.textContent = "yaw " + c.yawStep + "  pitch " + c.pitchIndex + "  zoom " + c.zoom.toFixed(2)
    + "  tilt " + (opts.tiltShift ? "on" : "off") + "  cutaway " + (opts.cutaway ? "on" : "off") + "  door " + doorState + (extra ? "\n" + extra : "");
}
function placeLabel() {
  const p = r.project(950, 450, 8);
  label.style.left = p.x + "px"; label.style.top = p.y + "px";
  requestAnimationFrame(placeLabel);
}
placeLabel();
const act = {
  "yaw-": () => r.setCamera({ yawStep: r.getCamera().yawStep - 1 }),
  "yaw+": () => r.setCamera({ yawStep: r.getCamera().yawStep + 1 }),
  pitch: () => r.setCamera({ pitchIndex: (r.getCamera().pitchIndex + 1) % 3 }),
  "zoom-": () => r.setCamera({ zoom: r.getCamera().zoom / 1.25 }),
  "zoom+": () => r.setCamera({ zoom: r.getCamera().zoom * 1.25 }),
  tilt: () => { opts.tiltShift = !opts.tiltShift; r.setOptions(opts); },
  cut: () => { opts.cutaway = !opts.cutaway; r.setOptions(opts); },
  door: () => { doorState = { closed: "open", open: "locked", locked: "closed" }[doorState]; r.setWalls(walls()); },
  ghost: () => { ghosts = !ghosts; r.setOptions({ ghosts }); },
  grid: () => { grid = { ...grid, on: !grid.on }; r.setOptions({ grid }); },
  links: () => { links = links.length ? [] : [{ sourceId: "knight", targetId: "goblin", color: rgbOf(PALETTE.info) }, { sourceId: "rogue", targetId: "drake", color: rgbOf(PALETTE.good) }]; r.setLinks(links); },
  move: () => { rogueAt = rogueAt.x === 650 ? { x: 450, y: 450 } : { x: 650, y: 650 }; r.setTokens(tokens()); r.setOverlays(overlays()); },
  ping: () => { pings = [{ id: "p" + Date.now(), x: 750, y: 950, zQ: -4, color: PALETTE.signal }]; r.setOverlays(overlays()); },
};
document.querySelector(".bar").addEventListener("click", (e) => { const a = e.target.dataset?.act; if (a) { act[a](); setTimeout(showState, 30); } });
window.addEventListener("keydown", (e) => { const k = { q: "yaw-", e: "yaw+", r: "pitch" }[e.key.toLowerCase()]; if (k) { act[k](); setTimeout(showState, 30); } });
canvas.addEventListener("wheel", (e) => { e.preventDefault(); act[e.deltaY > 0 ? "zoom-" : "zoom+"](); }, { passive: false });
canvas.addEventListener("click", (e) => {
  const hit = r.pick(e.clientX, e.clientY);
  if (hit?.type === "door") act.door();
  showState("pick: " + JSON.stringify(hit));
});
canvas.addEventListener("mousemove", (e) => {
  const hit = r.pick(e.clientX, e.clientY);
  const o = window.__tacticsOverlays ? { ...window.__tacticsOverlays } : overlays();
  if (hit?.type === "ground") o.hover = { i: hit.i, j: hit.j };
  r.setOverlays(o);
});
showState();
window.__ready = true;

// probe=perf: frames drawn and shadow-map renders per second, counted over 3 s
// after 2 s to settle, in #probe. pan=1 pans the camera every frame. It counts
// the renders themselves (the main camera's, the shadow camera's over the
// scene), so it reads the same before and after a change to the loop.
if (Q.get("probe") === "perf") {
  // A headless D3D page with nothing changing on screen stops servicing
  // requestAnimationFrame; a tiny animated element keeps frames coming, so the
  // count is the renderer's choice and not the browser's.
  const tick = document.createElement("div");
  tick.style.cssText = "position:fixed;left:0;bottom:0;width:2px;height:2px;background:#fff;z-index:9";
  document.body.append(tick);
  tick.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 500, iterations: Infinity, direction: "alternate" });
  const W = r.webgl, base = W.render.bind(W);
  let frames = 0, shadows = 0, counting = false;
  W.render = (scene, camera) => {
    if (counting && camera === r.rig.camera) frames++;
    else if (counting && camera === r.shadow.camera && scene === r.scene) shadows++;
    return base(scene, camera);
  };
  // which layers kept frames coming (each frame() that answered true), while counting
  const busy = {};
  for (const name of ["standees", "links", "overlays", "areas", "props", "atmosphere", "torches", "fog", "tiles", "roofs"]) {
    const L = r[name], fn = L?.frame;
    if (typeof fn !== "function") continue;
    L.frame = (...a) => { const v = fn.apply(L, a); if (counting && v) busy[name] = (busy[name] ?? 0) + 1; return v; };
  }
  const target = { ...r.getCamera().target };
  const pan = () => { if (!counting) return; target.x += 3; r.setCamera({ target: { ...target } }, { animate: false }); requestAnimationFrame(pan); };
  const settle = Q.has("settle") ? Number(Q.get("settle")) : 2000;
  setTimeout(() => { counting = true; if (Q.get("pan") === "1") pan(); }, settle);
  setTimeout(() => {
    counting = false;
    const pre = document.createElement("pre");
    pre.id = "probe";
    pre.textContent = JSON.stringify({ framesPerSec: +(frames / 3).toFixed(1), shadowsPerSec: +(shadows / 3).toFixed(1), motion: !!r._motion,
      busy, flags: { sway: !!r.fx?.sway && r.standees.count > 0, targeted: !!r.standees.targeted, effects: !!r.effects.animated, water: !!r.terrain.hasWater && !!r.fx?.waterMotion },
      stats: r.stats, fx: { flicker: r.fx?.flicker, shadows: r.fx?.shadows } });
    document.body.append(pre);
  }, settle + 3000);
}

// probe=shaders: every program's link and compile logs (D3D's HLSL warnings land
// in the program log), in #probe. Run it on Windows with --use-angle=d3d11.
if (Q.get("probe") === "shaders") setTimeout(() => {
  const gl = r.webgl.getContext();
  const log = (f) => { try { return (f() || "").trim(); } catch { return ""; } };
  const programs = (r.webgl.info.programs ?? []).map((p) => ({ name: p.name,
    program: log(() => gl.getProgramInfoLog(p.program)), vertex: log(() => gl.getShaderInfoLog(p.vertexShader)), fragment: log(() => gl.getShaderInfoLog(p.fragmentShader)) }));
  const pre = document.createElement("pre");
  pre.id = "probe";
  pre.textContent = JSON.stringify({ count: programs.length, renderer: log(() => gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info")?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)),
    logs: programs.filter((p) => p.program || p.vertex || p.fragment) }, null, 1);
  document.body.append(pre);
}, 3000);

// selftest=1: pick what project() says is there, then dispose; results in #selftest.
if (Q.get("selftest") === "1") {
  setTimeout(() => {
    const out = {};
    const at = (x, y, zQ) => { const p = r.project(x, y, zQ); return r.pick(p.x, p.y); };
    out.knight = at(1150, 450, 8 + 3);
    out.plaza = at(1450, 150, 8);
    out.pond = at(750, 950, -4);
    out.door = (() => { r.setCamera({ yawStep: 2 }, { animate: false }); return at(1200, 600, 8 + 3); })();
    out.camera = r.getCamera();
    out.disposeOk = (() => { try { r.dispose(); r.requestRender(); return true; } catch (e) { return String(e); } })();
    const pre = document.createElement("pre");
    pre.id = "selftest";
    pre.textContent = JSON.stringify(out);
    document.body.append(pre);
  }, 1500);
}
</script>
</body>
</html>
`;

/* ═══════════════════════════ a real map (--scene) ═══════════════════════════ */

const mapPage = (data) => String.raw`${HEAD}
<div class="status" id="status"></div>
<pre class="err" id="err"></pre>
${ERR_JS}
<script type="module">
import { DioramaRenderer } from "/scripts/features/diorama/render/renderer.mjs";
import { VIEW_CELLS, yawOf, pitchOf } from "/scripts/features/diorama/render/camera.mjs";
import { Terrain, distToQ } from "/scripts/features/diorama/terrain/model.mjs";
import { compileLayout } from "/scripts/features/diorama/terrain/layout.mjs";
import { normalizeProps, propToJSON, resolveProps, propStates } from "/scripts/features/diorama/terrain/props.mjs";
import { cliffEdges } from "/scripts/features/diorama/terrain/occlusion.mjs";
import { wallState, loadArt } from "/scripts/features/diorama/view/snapshot.mjs";
import { Baker, lightData } from "/scripts/features/diorama/view/bake.mjs";
import { polygonEyeQ, outlineFloorQ, dropWallsSeenOver } from "/scripts/features/diorama/foundry/sight-backend.mjs";
import { SHED_ORDER, SIZE_HEIGHT } from "/scripts/features/diorama/constants.mjs";
import { PALETTE } from "/scripts/core/theme.mjs";
import { resolveEnv, applyPreset, normalizeEnv } from "/scripts/features/diorama/environment.mjs";
import { resolveGraphics } from "/scripts/features/diorama/options.mjs";

const Q = new URLSearchParams(location.search);
const DATA = ${JSON.stringify(data).replace(/</g, "\\u003c")};
const S = DATA.scene;
const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

/* ------------------------------------------------------------ the grid (Foundry's SceneDimensions) */
const SIZE = Number(S.grid?.size) || 100, DIST = Number(S.grid?.distance) || 5;
const W = Number(S.width) || 0, H = Number(S.height) || 0, pad = Number(S.padding) || 0;
const padX = Math.ceil((pad * W) / SIZE) * SIZE, padY = Math.ceil((pad * H) / SIZE) * SIZE;
const COLS = Math.ceil((W + 2 * padX) / SIZE), ROWS = Math.ceil((H + 2 * padY) / SIZE);
const rect = { x: padX, y: padY, width: W, height: H };
const off = { i: Math.round(rect.y / SIZE), j: Math.round(rect.x / SIZE) };
const mapCells = { cols: Math.round(W / SIZE), rows: Math.round(H / SIZE) };

/* ------------------------------------------------------------ terrain and props, as importLayout writes them */
// store.mjs blankFor with the world settings' defaults (wall 10, step 2.5)
const wallHeight = Math.round(distToQ(10, DIST)), stepHeight = Math.round(distToQ(2.5, DIST));
const inside = (i, j) => { const cx = (j + 0.5) * SIZE, cy = (i + 0.5) * SIZE; return cx >= rect.x && cx < rect.x + rect.width && cy >= rect.y && cy < rect.y + rect.height; };
let ground = Terrain.blank(COLS, ROWS, inside, { wallHeight, stepHeight });
let props = [];
const notes = [];
if (DATA.layout) {
  const res = compileLayout(DATA.layout, { cols: COLS, rows: ROWS, offset: off, map: mapCells, distance: DIST, wallHeight, stepHeight });
  for (const e of res.errors) report("layout: " + e);
  for (const w of res.warnings) console.warn("layout: " + w);
  if (res.terrain) ground = res.terrain;
  // written by PropStore (propToJSON), read back normalised
  if (Array.isArray(res.props)) props = normalizeProps(normalizeProps(res.props).map(propToJSON));
  notes.push("layout " + (res.terrain ? "ok" : "REFUSED") + ", " + res.errors.length + " errors, " + res.warnings.length + " warnings, " + props.length + " props");
}
// saved terrain puts the sight backend's height rules on (foundry/context.mjs wallContext)
const saved = !!DATA.layout;
const resolved = resolveProps(ground, props, { stamp: true });
const rules = resolved.terrain;
const live = { terrain: rules, grid: { size: SIZE, distance: DIST }, baseQ: 0 };

/* ------------------------------------------------------------ renderer */
const canvas = document.getElementById("view");
const r = new DioramaRenderer({ canvas, pixelRatio: Math.min(2, window.devicePixelRatio || 1) });
window.__renderer = r;
r.setGrid({ size: SIZE, distance: DIST, cols: COLS, rows: ROWS, sceneRect: rect });
r.setTerrain(ground);
// the view's own loader, so the art lands as the view hands it over
const bg = await loadArt(DATA.map);
if (!bg) report("map image: " + DATA.map + " did not load");
r.setBackground(bg, rect);

// walls: the view's own WallState (GM view: a secret door shows as one)
const wallDocs = (S.walls ?? []).map((w, k) => ({ ...w, id: w._id ?? "wall" + k }));
const walls = wallDocs.map((doc) => wallState(doc, { isGM: true, terrain: ground, size: SIZE, distance: DIST, defaultMaterial: "stone" })).filter(Boolean);
r.setWalls(walls);
r.setProps(propStates(resolved.props, { isGM: true }));
r.setOptions({ ghosts: true, cutaway: Q.get("cutaway") !== "0", tiltShift: Q.get("tilt") === "1",
  grid: { on: Q.get("grid") === "1", color: S.grid?.color ?? "#000000", alpha: S.grid?.alpha ?? 0.35 } });

/* ------------------------------------------------------------ light */
// Foundry: the global light is on while the darkness is inside its range, and
// the view then bakes at darkness 0 (view/bake.mjs); a light shines only inside its own range.
const env = S.environment ?? {};
const sceneDark = clamp01(env.darknessLevel ?? S.darkness ?? 0);
const gl = env.globalLight ?? {};
const globalLit = !!gl.enabled && sceneDark >= (gl.darkness?.min ?? 0) && sceneDark <= (gl.darkness?.max ?? 1);
const darkness = Q.has("dark") ? clamp01(Q.get("dark")) : globalLit ? 0 : sceneDark;
const pxPerDist = SIZE / DIST;

// Walls that stop light here: sense NORMAL, not an open door. (Limited,
// proximity and distance light walls are treated as open, one-way walls as two-way.)
const blockers = wallDocs.filter((w) => Number(w.light ?? 20) === 20 && !(Number(w.door) > 0 && Number(w.ds) === 1))
  .map((doc) => ({ a: { x: doc.c[0], y: doc.c[1] }, b: { x: doc.c[2], y: doc.c[3] }, object: { documentName: "Wall", ...doc } }));
const cliffCache = new Map();
const cliffsAbove = (floorQ) => {
  if (!cliffCache.has(floorQ)) cliffCache.set(floorQ, cliffEdges(rules, floorQ, SIZE));
  return cliffCache.get(floorQ);
};

/** A stand-in for Foundry's light polygon: rays to every segment end and round the rim, clipped at the nearest segment. */
function sweep(ox, oy, radius, segs) {
  const near = segs.filter(([x0, y0, x1, y1]) => Math.max(x0, x1) >= ox - radius && Math.min(x0, x1) <= ox + radius && Math.max(y0, y1) >= oy - radius && Math.min(y0, y1) <= oy + radius);
  const angles = [];
  for (let k = 0; k < 96; k++) angles.push(-Math.PI + (k / 96) * 2 * Math.PI);
  for (const [x0, y0, x1, y1] of near) for (const [px, py] of [[x0, y0], [x1, y1]]) {
    const a = Math.atan2(py - oy, px - ox);
    angles.push(a - 1e-4, a, a + 1e-4);
  }
  angles.sort((a, b) => a - b);
  const points = [];
  for (const a of angles) {
    const dx = Math.cos(a), dy = Math.sin(a);
    let best = radius;
    for (const [x0, y0, x1, y1] of near) {
      const sx = x1 - x0, sy = y1 - y0, den = dx * sy - dy * sx;
      if (Math.abs(den) < 1e-12) continue;
      const qx = x0 - ox, qy = y0 - oy;
      const t = (qx * sy - qy * sx) / den, u = (qx * dy - qy * dx) / den;
      if (t > 1e-6 && u >= 0 && u <= 1 && t < best) best = t;
    }
    points.push(ox + dx * best, oy + dy * best);
  }
  return { points };
}

const rgbOf = (hex) => { const n = parseInt(String(hex).replace("#", ""), 16); return Number.isFinite(n) ? [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] : null; };
const lightDocs = (S.lights ?? []).filter((l) => !l.hidden && sceneDark >= (l.config?.darkness?.min ?? 0) && sceneDark <= (l.config?.darkness?.max ?? 1));
const lights = [];
lightDocs.forEach((l, k) => {
  const c = l.config ?? {};
  const x = Number(l.x), y = Number(l.y);
  const dim = Math.max(Number(c.dim) || 0, Number(c.bright) || 0) * pxPerDist;
  if (!Number.isFinite(x) || !Number.isFinite(y) || dim <= 0) return;
  const origin = { x, y, elevation: Number(l.elevation) || 0 };
  let edges = blockers;
  let segs = [];
  if (saved) {
    // the sight backend's _identifyEdges: walls the light sees over drop, ground above it cuts it
    const poly = { origin, config: { type: "light" } };
    const set = new Set(blockers);
    dropWallsSeenOver(set, live, polygonEyeQ(poly, live));
    edges = [...set];
    segs = cliffsAbove(outlineFloorQ(poly, live));
  }
  segs = [...edges.map((e) => [e.a.x, e.a.y, e.b.x, e.b.y]), ...segs];
  const rgb = c.color ? rgbOf(c.color) : null;
  lights.push({
    sourceId: "AmbientLight." + (l._id ?? k),
    colorRGB: rgb,
    data: { x, y, elevation: origin.elevation, dim, bright: (Number(c.bright) || 0) * pxPerDist, color: rgb ? parseInt(String(c.color).replace("#", ""), 16) : null,
      alpha: c.alpha, luminosity: c.luminosity, animation: c.animation },
    shape: sweep(x, y, dim, segs),
  });
});
const baker = new Baker({ grid: { cols: COLS, rows: ROWS, size: SIZE }, mode: () => null, onBaked: () => {} });
baker.drawLight(lights);
r.setLighting({ darkness, light: baker.light, vision: null, sources: lights.map(lightData).filter(Boolean) });

${ENV_JS}

/* ------------------------------------------------------------ tokens (optional) */
const heightFt = (size) => (size >= 4 ? SIZE_HEIGHT.grg : size >= 3 ? SIZE_HEIGHT.huge : size >= 2 ? SIZE_HEIGHT.lg : size < 1 ? SIZE_HEIGHT.sm : SIZE_HEIGHT.med);
const DISC = [PALETTE.info, PALETTE.hazard, PALETTE.good, PALETTE.warn, PALETTE.violet, PALETTE.cyan];
function disc(color, name) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = color; g.beginPath(); g.arc(128, 128, 120, 0, Math.PI * 2); g.fill();
  g.lineWidth = 10; g.strokeStyle = "rgba(0,0,0,0.45)"; g.stroke();
  g.fillStyle = "#ffffff"; g.font = "bold 120px Oxanium, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(String(name || "?").slice(0, 1).toUpperCase(), 128, 136);
  return c.toDataURL();
}
const tokens = (DATA.tokens ?? []).map((t, k) => {
  const size = Math.max(0.5, Number(t.size) || 1), w = Math.max(1, Math.round(size));
  const i = Number(t.cell?.[0]) + off.i, j = Number(t.cell?.[1]) + off.j;
  const groundQ = rules.footprintTop(i, j, w, w);
  return { id: "t" + k, name: t.name ?? "Token " + (k + 1), x: (j + size / 2) * SIZE, y: (i + size / 2) * SIZE,
    footQ: groundQ + Math.round(distToQ(Number(t.altitude) || 0, DIST)), groundQ, heightQ: Math.round(distToQ(heightFt(size), DIST)), widthCells: size,
    art: t.img || disc(t.color || DISC[k % DISC.length], t.name), disposition: Number.isFinite(t.disposition) ? t.disposition : 0,
    visible: true, ghost: false, controlled: false, hovered: false, targets: [], turn: null, conditions: [], bars: [] };
});
r.setTokens(tokens);

${SHED_JS}

/* ------------------------------------------------------------ camera */
const fitZoom = (yawStep, pitchIndex) => {
  const yaw = yawOf(yawStep), pitch = pitchOf(pitchIndex);
  const w = rect.width / SIZE, h = rect.height / SIZE;
  const across = Math.abs(w * Math.cos(yaw)) + Math.abs(h * Math.sin(yaw));
  const deep = (Math.abs(w * Math.sin(yaw)) + Math.abs(h * Math.cos(yaw))) * Math.sin(pitch);
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  return VIEW_CELLS / (Math.max(deep, across / aspect) * 1.06);
};
function frame() {
  const yawStep = Number(Q.get("yaw") ?? 0), pitchIndex = Number(Q.get("pitch") ?? 0);
  if (Q.has("focus")) {
    const [fr, fc] = Q.get("focus").split(",").map(Number);
    const x = rect.x + (fc + 0.5) * SIZE, y = rect.y + (fr + 0.5) * SIZE;
    r.setCamera({ yawStep, pitchIndex, zoom: Q.has("zoom") ? Number(Q.get("zoom")) : 2, target: { x, y, zQ: rules.groundAt(x, y, SIZE) } }, { animate: false });
    return;
  }
  const zoom = Q.has("zoom") ? Number(Q.get("zoom")) : fitZoom(yawStep, pitchIndex);
  r.setCamera({ yawStep, pitchIndex, zoom, target: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, zQ: 0 } }, { animate: false });
  // a whole big map is further out than the view's own minimum zoom: the rig, not the clamp
  if (r.getCamera().zoom > zoom) { r.rig.state.zoom = zoom; r.rig.view.zoom = zoom; r.rig.apply(); r.requestRender(); }
}
function resize() { r.resize(window.innerWidth, window.innerHeight); frame(); }
window.addEventListener("resize", resize);
resize();
window.addEventListener("keydown", (e) => {
  const c = r.getCamera(), k = e.key.toLowerCase();
  if (k === "q" || k === "e") r.setCamera({ yawStep: c.yawStep + (k === "e" ? 1 : -1) });
  else if (k === "r") r.setCamera({ pitchIndex: (c.pitchIndex + 1) % 3 });
});
canvas.addEventListener("wheel", (e) => { e.preventDefault(); r.setCamera({ zoom: r.getCamera().zoom * (e.deltaY > 0 ? 0.8 : 1.25) }); }, { passive: false });

const doors = walls.filter((w) => w.type === "door" || w.type === "secret").length;
document.getElementById("status").textContent = [
  (S.name ?? "scene") + "  " + mapCells.cols + "×" + mapCells.rows + " squares, " + SIZE + " px, " + DIST + " " + (S.grid?.units ?? "ft"),
  walls.length + " walls (" + doors + " doors), " + lights.length + "/" + (S.lights?.length ?? 0) + " lights, " + tokens.length + " tokens",
  "darkness " + darkness.toFixed(2) + (Q.has("dark") ? " (dark=)" : globalLit ? " (global light on at " + sceneDark + ")" : " (scene)"),
  ...notes,
].join("\n");
window.__map = { cols: COLS, rows: ROWS, rect, walls: walls.length, doors, lights: lights.length, darkness, globalLit, props: props.length, tokens: tokens.length };
window.__ready = true;
</script>
</body>
</html>
`;

/** Copy a file beside the page; returns its URL from the repo root. */
function stage(src, dir, name) {
  mkdirSync(dir, { recursive: true });
  const to = join(dir, name + extname(src).toLowerCase());
  copyFileSync(src, to);
  return "/" + relative(ROOT, to).replaceAll("\\", "/");
}
const readJson = (file, what) => {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.error(`${what}: ${e.message}`); process.exit(1); }
};

let html = page;
if (SCENE_FILE) {
  const sceneFile = resolve(SCENE_FILE);
  const scene = readJson(sceneFile, "--scene");
  // the initial Level's art (view/snapshot.mjs backgroundSrc), else the first Level's, else the scene's
  const levels = Array.isArray(scene.levels) ? scene.levels : [];
  const level = levels.find((l) => l?._id === scene.initialLevel) ?? levels[0];
  const bgSrc = level?.background?.src ?? scene.background?.src ?? scene.img ?? null;
  const mapFile = arg("map") ? resolve(arg("map")) : bgSrc ? join(dirname(sceneFile), basename(bgSrc)) : null;
  if (!mapFile || !existsSync(mapFile)) { console.error("--map: no map image" + (mapFile ? " at " + mapFile : "") + "; pass --map=<image>"); process.exit(1); }
  const assets = OUT.replace(/\.html?$/i, "");
  const layoutFile = arg("layout"), tokensFile = arg("tokens");
  const layout = layoutFile ? readJson(resolve(layoutFile), "--layout") : null;
  const tokens = tokensFile ? readJson(resolve(tokensFile), "--tokens") : [];
  if (!Array.isArray(tokens)) { console.error("--tokens: expected an array"); process.exit(1); }
  tokens.forEach((t, k) => {
    if (!t.img || /^(https?:|data:|\/)/.test(t.img)) return;
    const file = isAbsolute(t.img) ? t.img : resolve(dirname(resolve(tokensFile)), t.img);
    if (existsSync(file)) t.img = stage(file, assets, "token-" + k);
    else { console.warn(`--tokens: ${t.name ?? k}: no image at ${file}; drawing a disc`); delete t.img; }
  });
  // The page compiles the layout itself; this says up front whether the import would take it.
  if (layout) {
    const { compileLayout } = await import(pathToFileURL(join(ROOT, "scripts/features/diorama/terrain/layout.mjs")).href);
    const size = Number(scene.grid?.size) || 100;
    const res = compileLayout(layout, { cols: Math.ceil(scene.width / size), rows: Math.ceil(scene.height / size), distance: scene.grid?.distance });
    for (const e of res.errors) console.log("layout error: " + e);
    for (const w of res.warnings) console.log("layout warning: " + w);
    console.log(`layout: ${res.terrain ? "compiles" : "REFUSED"}, ${res.props?.length ?? 0} props`);
  }
  html = mapPage({ scene, layout, tokens, map: stage(mapFile, assets, "map") });
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log("wrote " + relative(ROOT, OUT) + " — serve with: node tools/preview-server.mjs, then /" + relative(ROOT, OUT).replaceAll("\\", "/"));
