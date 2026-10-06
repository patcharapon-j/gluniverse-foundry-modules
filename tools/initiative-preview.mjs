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
 *
 * States: `?states=1` starts with a guard break, a dying creature and a boss.
 *
 * Skins: `?skin=aegis` (or the switcher) stamps `data-gl-skin` on the rail
 * root exactly as the feature does, so styles/initiative-aegis.css applies.
 *
 * Arrival: "Cinematic arrival" lays out stand-in intro cards across the screen,
 * then hands their rects to the REAL `playArrival` — the same call the rail
 * makes when combat-intro's handoff lands. `__initiativeArrival()` runs it
 * headless; `__initiativeSeek(f)` parks it like the turn change.
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
<link rel="stylesheet" href="/styles/initiative-aegis.css">
<style>
  body { margin: 0; min-height: 100vh; background: radial-gradient(ellipse at 30% 20%, #26324a, var(--gl-ink-0) 70%); color: var(--gl-text); font-family: var(--gl-display); }
  .panel { position: fixed; left: 16px; top: 16px; display: grid; gap: 8px; max-width: 360px; }
  .panel button, .panel select { padding: 8px 10px; font: inherit; background: var(--gl-ink-2); color: var(--gl-text); border: 1px solid var(--gl-line); cursor: pointer; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .err { color: #f88; white-space: pre-wrap; font: 12px var(--gl-tech); }
  .intro-stand { position: fixed; z-index: calc(var(--gl-z-hud) + 2); display: grid; align-content: end; padding: 10px; box-sizing: border-box; background: var(--gl-ink-2) center / cover no-repeat; box-shadow: inset 0 0 0 1px var(--gl-line-strong); font: 700 13px var(--gl-tech); letter-spacing: 0.1em; text-transform: uppercase; color: var(--gl-text-bright); transition: opacity var(--gl-d-quick) var(--gl-ease); }
  .intro-stand b { font: 800 34px var(--gl-display); }
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
    <select id="skin"><option value="etched">Etched × Endfield</option><option value="aegis">Aegis Fallen</option></select>
  </div>
  <div class="row">
    <button id="arrival">Cinematic arrival</button>
    <button id="break">Toggle guard break on #3</button>
    <button id="dying">Toggle dying on #4</button>
    <button id="boss">Toggle boss on #2</button>
  </div>
  <div class="err" id="err"></div>
</div>
<script type="module">
const err = document.querySelector("#err");
window.addEventListener("error", e => { err.textContent += (e.error?.stack ?? e.message) + "\\n"; });
const labels = {};
const manifest = await fetch("/module.json").then(r => r.json());
for (const lang of manifest.languages) Object.assign(labels, await fetch("/" + lang.path).then(r => r.ok ? r.json() : {}).catch(() => ({})));
const localize = key => labels[key] ?? key;
const format = (key, data = {}) => localize(key).replace(/{(\\w+)}/g, (_, k) => data[k] ?? "");
const params = new URLSearchParams(location.search);
const skinSelect = document.querySelector("#skin");
skinSelect.value = params.get("skin") === "aegis" ? "aegis" : "etched";
const settingValues = { "init.skin": skinSelect.value };
globalThis.game = { user: { isGM: false, id: "preview" }, system: { id: "none" }, combat: null, modules: { get: () => null }, settings: { get: (_m, key) => settingValues[key] }, i18n: { localize, format } };
globalThis.Hooks = { on() {}, off() {}, callAll() {} };
globalThis.ui = { notifications: { warn: console.warn, error: console.error } };
globalThis.foundry = { applications: { api: {} } };

const { GLUniverseInitiativeOverlay } = await import("/scripts/features/initiative/gluniverse-initiative.mjs");
const COMBATANTS = ${JSON.stringify(COMBATANTS)};
const visible = () => Number(document.querySelector("#window").value);
const overlay = new GLUniverseInitiativeOverlay();
const root = document.createElement("div");
root.id = "gluni-initiative";
document.body.append(root);
overlay.root = root;
const states = { break: new Set(), dying: new Set(), boss: new Set() };
// ?states=1 starts with guard break on #3, dying on #4 and a boss on #2, for
// headless contact sheets of the danger states.
if (params.get("states") === "1") { states.break.add("c"); states.dying.add("d"); states.boss.add("b"); }
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
      disposition: c.disposition, adhoc: null, guardBroken: states.break.has(c.id), breakGauge: null,
      dying: states.dying.has(c.id) ? { kind: "pf2e", value: 2, max: 4, severity: "high", stable: false } : null,
      conditions: null, boss: states.boss.has(c.id) ? { tier: "greater" } : null, bossTurn: null, name: c.mystery ? localize("GLUNI.Unknown") : c.name,
      initiative: c.initiative, portrait: c.mystery ? null : c.portrait,
      portraitScaleCap: 1, portraitFrame: null, canEndTurn: false
    });
  }
  return { list, round };
}

function render(animate, turnAdvanced = true) {
  const edge = document.querySelector("#edge").value;
  settingValues["init.skin"] = skinSelect.value;
  root.className = "gluni-initiative gluni-initiative--" + edge + " gluni-initiative--player";
  root.style.top = "80px";
  root.style.setProperty("--gl-motion-scale", document.querySelector("#tier").value);
  overlay.applySkin();
  const { list, round } = railFor(turn);
  // The real renderMarkup: header (round plate) + rail, as the feature draws it.
  const markup = overlay.renderMarkup({ round, started: true }, { normal: list, delayed: [] }, {});
  const snapshots = animate ? overlay.captureItemRects() : new Map();
  overlay._railMotion.clear();
  root.innerHTML = markup;
  if (animate) overlay.animateTurnChange(snapshots, { edge, roundDelta: Math.max(0, round - lastRound), turnAdvanced });
  overlay.lastActiveKey = list.find(item => item.active)?.key ?? null;
  lastRound = round;
}

window.__initiativeStep = delta => { turn = Math.max(0, turn + delta); render(true, delta > 0); };
window.__initiativeInterrupt = () => { tick++; render(true); };
// Pause the live move and park it at a fraction of its length (0..1). The
// screen-edge exits run on their own timeline, so they are parked at the same
// moment in milliseconds.
window.__initiativeSeek = fraction => {
  const timeline = overlay._arrivalTimeline ?? overlay._magicTimeline;
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
// Stand-in intro cards: a row across the middle of the screen, sorted the way
// the intro leaves them, then handed to the real playArrival. The last one has
// no rect, so it shows the edge entry a card without one takes.
window.__initiativeArrival = ({ hold = false } = {}) => {
  document.querySelectorAll(".intro-stand").forEach(node => node.remove());
  turn = 0;
  lastRound = 1;
  const listed = COMBATANTS.slice(0, visible());
  const width = Math.min(150, (innerWidth - 120) / listed.length - 14);
  const height = width * 1.45;
  const left0 = (innerWidth - listed.length * (width + 14)) / 2;
  const cards = listed.map((c, i) => {
    const rect = { left: left0 + i * (width + 14), top: innerHeight / 2 - height / 2, width, height };
    const stand = document.createElement("div");
    stand.className = "intro-stand";
    Object.assign(stand.style, { left: rect.left + "px", top: rect.top + "px", width: width + "px", height: height + "px" });
    if (c.portrait) stand.style.backgroundImage = 'url("' + c.portrait + '")';
    stand.innerHTML = "<b>" + c.initiative + "</b>" + (c.mystery ? localize("GLUNI.Unknown") : c.name);
    document.body.append(stand);
    return { combatantId: c.id, rect: i === listed.length - 1 ? null : rect, stand };
  });
  const go = () => {
    cards.forEach(card => card.stand.remove());
    render(false);
    return overlay.playArrival(cards.map(({ combatantId, rect }) => ({ combatantId, rect })));
  };
  if (hold) return cards.length;
  return new Promise(resolve => setTimeout(() => resolve(go()), 700));
};
document.querySelector("#arrival").onclick = () => window.__initiativeArrival();
const toggle = (set, id) => { set.has(id) ? set.delete(id) : set.add(id); render(false); };
document.querySelector("#break").onclick = () => toggle(states.break, "c");
document.querySelector("#dying").onclick = () => toggle(states.dying, "d");
document.querySelector("#boss").onclick = () => toggle(states.boss, "b");
skinSelect.onchange = () => {
  const url = new URL(location.href);
  url.searchParams.set("skin", skinSelect.value);
  history.replaceState(null, "", url);
  render(false);
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
