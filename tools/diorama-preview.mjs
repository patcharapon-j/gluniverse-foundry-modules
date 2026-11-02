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
 *   still=1     shed water and sway, so the page goes idle (screenshots)
 *   shed=<n>    shed the first n SHED_ORDER entries
 *   novision=1  no vision bake (everything visible)
 *   dark=<0..1> scene darkness (default 0.4)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice("--out=".length) : ".preview/diorama.html");
if (relative(ROOT, OUT).startsWith("..")) {
  console.warn("warning: --out is outside the repository; the page's imports only resolve when served from the repo root.");
}

const page = String.raw`<!doctype html>
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
<canvas id="view"></canvas>
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
<script>
  window.__errors = [];
  const errEl = () => document.getElementById("err");
  const report = (m) => { window.__errors.push(m); const el = errEl(); if (el) el.textContent += m + "\n"; };
  window.addEventListener("error", (e) => report("error: " + (e.error?.stack || e.message)));
  window.addEventListener("unhandledrejection", (e) => report("rejection: " + (e.reason?.stack || e.reason)));
  const ce = console.error.bind(console);
  console.error = (...a) => { report("console.error: " + a.map((x) => x?.stack || String(x)).join(" ")); ce(...a); };
  const cw = console.warn.bind(console);
  console.warn = (...a) => { const s = a.map(String).join(" "); if (/THREE|WebGL|shader|GLSL/i.test(s)) report("console.warn: " + s); cw(...a); };
</script>
<script type="module">
import { DioramaRenderer } from "/scripts/features/diorama/render/renderer.mjs";
import { Terrain } from "/scripts/features/diorama/terrain/model.mjs";
import { KIND, DIR, SUB, SHED_ORDER, BAKE_PX_PER_CELL } from "/scripts/features/diorama/constants.mjs";
import { PALETTE } from "/scripts/core/theme.mjs";

const Q = new URLSearchParams(location.search);
const COLS = 16, ROWS = 12, SIZE = 100;

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

r.setLighting({ darkness: Q.has("dark") ? Number(Q.get("dark")) : 0.4, light: lightCanvas(), vision: Q.get("novision") === "1" ? null : visionCanvas() });

const path = () => ({ points: [
  { x: rogueAt.x, y: rogueAt.y, zQ: 0 }, { x: 650, y: 450, zQ: 0, color: PALETTE.good }, { x: 750, y: 450, zQ: 2, color: PALETTE.good },
  { x: 850, y: 450, zQ: 6, color: PALETTE.warn }, { x: 950, y: 450, zQ: 8, color: PALETTE.warn },
], color: PALETTE.good });
let pings = [];
const overlays = () => ({
  path: path(),
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

// links=1: target lines (the 3D form of stream-targets' 2D lines)
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
let links = Q.get("links") === "1" ? [
  { sourceId: "knight", targetId: "goblin", color: rgbOf(PALETTE.info) },
  { sourceId: "rogue", targetId: "drake", color: rgbOf(PALETTE.good) },
  { sourceId: "knight", targetId: "nobody", color: rgbOf(PALETTE.hazard) },   // dropped: not on the board
] : [];
r.setLinks(links);

if (Q.get("still") === "1" || Q.has("shed")) {
  const n = Q.has("shed") ? Number(Q.get("shed")) : 0;
  const still = Q.get("still") === "1";
  r.setShed({ allows: (name) => {
    if (still && (name === "water" || name === "standeeSway")) return false;
    const i = SHED_ORDER.indexOf(name);
    return i < 0 || i >= n;
  } });
}

let cam = { yawStep: Number(Q.get("yaw") ?? 0), pitchIndex: Number(Q.get("pitch") ?? 0), zoom: 1, target: { x: 800, y: 600, zQ: 2 } };
const view = Q.get("view") || "full";
if (view === "close") cam = { ...cam, zoom: 2.1, target: { x: 1050, y: 500, zQ: 6 } };
else if (view === "wall") cam = { ...cam, zoom: 2.6, target: { x: knightAt.x, y: knightAt.y, zQ: 10 } };
else if (view === "fly") cam = { ...cam, zoom: 1.7, target: { x: 900, y: 750, zQ: 4 } };
else if (view === "knight") cam = { ...cam, zoom: 3.2, target: { x: knightAt.x, y: knightAt.y, zQ: 10 } };
else if (view === "goblin") cam = { ...cam, zoom: 3.2, target: { x: 250, y: 150, zQ: 6 } };
else if (view === "rogue") cam = { ...cam, zoom: 3.2, target: { x: rogueAt.x, y: rogueAt.y, zQ: 2 } };
else cam.zoom = 0.82;
if (Q.has("zoom")) cam.zoom = Number(Q.get("zoom"));
r.setCamera(cam, { animate: false });
// grid=1: the square grid on walkable tops, in the scene's colour and alpha
let grid = { on: Q.get("grid") === "1", color: "#000000", alpha: 0.35 };
r.setOptions({ tiltShift: Q.get("tilt") === "1", cutaway: Q.get("cutaway") !== "0", grid });

function resize() { r.resize(window.innerWidth, window.innerHeight); }
window.addEventListener("resize", resize);
resize();

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
  const o = overlays();
  if (hit?.type === "ground") o.hover = { i: hit.i, j: hit.j };
  r.setOverlays(o);
});
showState();
window.__ready = true;

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

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, page);
console.log("wrote " + relative(ROOT, OUT) + " — serve with: node tools/preview-server.mjs, then /" + relative(ROOT, OUT).replaceAll("\\", "/"));
