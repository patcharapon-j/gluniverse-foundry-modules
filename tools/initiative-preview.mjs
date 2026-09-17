#!/usr/bin/env node
/**
 * Initiative tracker — turn-change magic move preview.
 *
 * Writes a page that renders the rail with the REAL card markup
 * (`renderCombatantCard`) against the REAL stylesheets and advances turns
 * through the REAL `captureItemRects` / `animateTurnChange`. The move is the
 * feature, so a still cannot judge it: use the slow-motion tier and watch the
 * frame resize, the art rise out of it on its own path, and the type re-flow.
 *
 *   node tools/initiative-preview.mjs --out=.preview/initiative.html
 *   node tools/preview-server.mjs 8955
 *
 * SERVE IT. A file:// page does not execute its module script.
 *
 * The page exposes `__initiativeStep(delta)` and `__initiativeInterrupt()` for
 * headless drivers; the latter re-renders mid-move, which must continue from
 * where every layer is rather than snapping.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const out = new URL(flag("out") ?? ".preview/initiative.html", ROOT);

const figure = (bg, fg) =>
  "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160"><rect width="120" height="160" fill="${bg}"/>` +
    `<circle cx="62" cy="46" r="20" fill="${fg}"/><path d="M22 160c0-40 18-72 40-72s40 32 40 72z" fill="${fg}"/>` +
    `<rect x="50" y="40" width="7" height="4" fill="${bg}"/><rect x="67" y="40" width="7" height="4" fill="${bg}"/></svg>`
  );

const COMBATANTS = [
  { id: "a", name: "Seri Valen", initiative: 24, disposition: "friendly", portrait: figure("#1d3246", "#6fa8d6") },
  { id: "b", name: "Hollow Knight", initiative: 21, disposition: "hostile", portrait: figure("#3a1d24", "#d66f86") },
  { id: "c", name: "Brakka", initiative: 17, disposition: "friendly", portrait: figure("#1f3a2a", "#78d69a") },
  { id: "d", name: "Goblin Warrior", initiative: 12, disposition: "hostile", portrait: figure("#3a311d", "#d6b46f") },
  { id: "e", name: "Unnamed Shade", initiative: 9, disposition: "neutral", mystery: true },
  { id: "f", name: "Ilsa", initiative: 5, disposition: "friendly", portrait: figure("#2b1d3a", "#a98ad6") }
];

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Initiative magic move</title>
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" href="/styles/initiative.css">
<style>
  body { margin: 0; min-height: 100vh; background: radial-gradient(ellipse at 30% 20%, #26324a, var(--gl-ink-0) 70%); color: var(--gl-text); font-family: var(--gl-display); }
  .panel { position: fixed; left: 16px; top: 16px; display: grid; gap: 8px; max-width: 360px; }
  .panel button, .panel select { padding: 8px 10px; font: inherit; background: var(--gl-ink-2); color: var(--gl-text); border: 1px solid var(--gl-line); cursor: pointer; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .err { color: #f88; white-space: pre-wrap; font: 12px var(--gl-tech); }
</style>
</head>
<body>
<div class="panel">
  <strong>INITIATIVE / MAGIC MOVE</strong>
  <div class="row">
    <button id="prev">Prev turn</button><button id="next">Next turn</button><button id="interrupt">Next + interrupt</button>
  </div>
  <div class="row">
    <select id="tier">
      <option value="1">Default speed</option>
      <option value="4">Slow motion (4x)</option>
      <option value="10">Very slow (10x)</option>
      <option value="0">Motion: none</option>
    </select>
    <select id="edge"><option value="right">Right rail</option><option value="left">Left rail</option></select>
    <select id="window"><option value="6">Whole order (card wraps to next round)</option><option value="4">Window of 4 (cards leave)</option></select>
  </div>
  <div class="err" id="err"></div>
</div>
<script type="module">
const err = document.querySelector("#err");
window.addEventListener("error", e => { err.textContent += (e.error?.stack ?? e.message) + "\\n"; });
const labels = {};
const manifest = await fetch("/module.json").then(r => r.json());
for (const lang of manifest.languages) Object.assign(labels, await fetch("/" + lang.path).then(r => r.json()));
const localize = key => labels[key] ?? key;
const format = (key, data = {}) => localize(key).replace(/{(\\w+)}/g, (_, k) => data[k] ?? "");
globalThis.game = { user: { isGM: false, id: "preview" }, system: { id: "none" }, combat: null, settings: { get: () => undefined }, i18n: { localize, format } };
globalThis.Hooks = { on() {}, off() {}, callAll() {} };
globalThis.ui = { notifications: { warn: console.warn, error: console.error } };
globalThis.foundry = { applications: { api: {} } };

const { GLUniverseInitiativeOverlay } = await import("/scripts/features/initiative/gluniverse-initiative.mjs");
const COMBATANTS = ${JSON.stringify(COMBATANTS)};
const visible = () => Number(document.querySelector("#window").value);
const overlay = new GLUniverseInitiativeOverlay();
const root = document.createElement("div");
document.body.append(root);
overlay.root = root;
// turn counts every turn taken, so the round falls out of it. Keys follow the
// tracker's own scheme (combatant:<id>:round:<offset>, separator:<round>:offset:<n>).
let turn = 0;
let tick = 0;
let lastRound = 0;
const N = COMBATANTS.length;

function railFor(total) {
  const current = total % N;
  const round = Math.floor(total / N) + 1;
  const list = [];
  const separators = new Set();
  for (let i = 0; i < visible(); i++) {
    const abs = current + i;
    const offset = Math.floor(abs / N);
    const c = COMBATANTS[abs % N];
    if (offset > 0 && !separators.has(offset)) {
      separators.add(offset);
      list.push({ type: "separator", key: "separator:" + (round + offset) + ":offset:" + offset, round: round + offset });
    }
    list.push({
      type: "combatant", id: c.id, key: "combatant:" + c.id + ":round:" + offset, active: i === 0, delayed: false,
      roundOffset: offset, mystery: Boolean(c.mystery), gmVisibilityMode: "auto", defeated: false,
      disposition: c.disposition, adhoc: null, guardBroken: false, breakGauge: null, dying: null,
      conditions: null, boss: null, bossTurn: null, name: c.mystery ? localize("GLUNI.Unknown") : c.name,
      initiative: c.initiative, portrait: c.mystery ? null : c.portrait,
      portraitScaleCap: 1, portraitFrame: null, canEndTurn: false
    });
  }
  return { list, round };
}

function render(animate, turnAdvanced = true) {
  const edge = document.querySelector("#edge").value;
  root.className = "gluni-initiative gluni-initiative--" + edge + " gluni-initiative--player";
  root.style.top = "80px";
  root.style.setProperty("--gl-motion-scale", document.querySelector("#tier").value);
  const { list, round } = railFor(turn);
  const markup = '<div class="gluni-shell"><div class="gluni-rail">' + list.map(item => overlay.renderRailItem(item)).join("") + "</div></div>";
  const snapshots = animate ? overlay.captureItemRects() : new Map();
  overlay._railMotion.clear();
  root.innerHTML = markup;
  if (animate) overlay.animateTurnChange(snapshots, { edge, roundDelta: Math.max(0, round - lastRound), cardMode: false, turnAdvanced });
  overlay.lastActiveKey = list.find(item => item.active)?.key ?? null;
  lastRound = round;
}

window.__initiativeStep = delta => { turn = Math.max(0, turn + delta); render(true, delta > 0); };
window.__initiativeInterrupt = () => { tick++; render(true); };
// Pause the live move and park it at a fraction of its length (0..1). The
// screen-edge exits run on their own timeline, so they are parked at the same
// moment in milliseconds.
window.__initiativeSeek = fraction => {
  const timeline = overlay._magicTimeline;
  if (!timeline) return false;
  const ms = timeline.duration * fraction;
  const exits = overlay._leaveTimeline;
  if (exits && !exits.completed) {
    exits.pause();
    exits.seek(Math.min(ms, exits.duration));
  }
  timeline.pause();
  timeline.seek(ms);
  return true;
};
document.querySelector("#next").onclick = () => window.__initiativeStep(1);
document.querySelector("#prev").onclick = () => window.__initiativeStep(-1);
document.querySelector("#interrupt").onclick = () => {
  window.__initiativeStep(1);
  const scale = Number(document.querySelector("#tier").value) || 1;
  setTimeout(() => window.__initiativeInterrupt(), 260 * scale);
};
document.querySelector("#tier").onchange = () => root.style.setProperty("--gl-motion-scale", document.querySelector("#tier").value);
document.querySelector("#edge").onchange = () => render(false);
document.querySelector("#window").onchange = () => render(false);
render(false);
window.__initiativeReady = true;
</script>
</body>
</html>
`;

await mkdir(dirname(fileURLToPath(out)), { recursive: true });
await writeFile(out, html);
console.log(`wrote ${fileURLToPath(out)}`);
