#!/usr/bin/env node
/**
 * PF2e Odds — a browser-backed look at the badge.
 *
 * The page IMPORTS the shipped engine (core/pf2e-odds.mjs), model
 * (view-model.mjs) and renderer (render.mjs) and links the shipped
 * stylesheets, so what you judge is what ships. A preview built on a second
 * copy flatters whichever copy was touched last.
 *
 * What it shows:
 *   • a board with three lines — known, narrowing, unseen — each with its
 *     compact off-turn tag beside it;
 *   • the narrowing beat, live: ??? → AC 17–24 → AC 19–22 → exact, through the
 *     real `updateBadge`, then the landing beat through `playLanding`;
 *   • the GM's view of the same line ("players see");
 *   • a save priced from the caster's side, Evasion on a rogue's Reflex, a
 *     fortune roll, and a concealed target;
 *   • the inline readout as it sits on the sheet's three MAP buttons.
 *
 * Serve it — a file:// page does not run its module script:
 *
 *   node tools/pf2e-odds-preview.mjs && node tools/preview-server.mjs
 *   → http://localhost:8931/.preview/odds.html   (?freeze=1 stops the loop)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice("--out=".length) : ".preview/odds.html");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>PF2e Odds — preview</title>
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" href="/styles/pf2e-odds.css">
<link rel="stylesheet" href="/styles/pf2e-odds-dice.css">
<style>
  body { margin: 0; background: #05060a; color: #ecedf2; font-family: "Google Sans Flex", system-ui, sans-serif; }
  .pv { max-width: 1440px; margin: 0 auto; padding: 28px; display: flex; flex-direction: column; gap: 22px; box-sizing: border-box; }
  .pv h2 { margin: 0 0 10px; font: 650 13px/1.2 "Google Sans Flex", system-ui, sans-serif; color: #b3b5c2; }
  .board { display: block; width: 100%; height: 720px; border: 0; }
  .row { display: flex; gap: 22px; flex-wrap: wrap; align-items: flex-start; }
  .cell { display: flex; flex-direction: column; gap: 8px; }
  .cap { font: 500 12px/1.4 var(--gl-display); color: var(--gl-text-dim); max-width: 240px; }
  .sheet { display: flex; gap: 8px; align-items: center; padding: 16px; background: var(--gl-ink-2); border-radius: 10px; box-shadow: inset 0 0 0 1px rgb(var(--gl-tint-light) / .07); font-size: 14px; }
  .dsn { position: relative; height: 260px; border-radius: 10px; background: radial-gradient(90% 120% at 50% 30%, #2a2f3a, #10141c 75%); box-shadow: inset 0 0 0 1px rgb(var(--gl-tint-light) / .07); overflow: hidden; }
  .dsn .die { position: absolute; width: 64px; height: 64px; margin: -32px 0 0 -32px; display: grid; place-items: center; font: 800 22px var(--gl-display); color: #f2f4f8;
    clip-path: polygon(50% 0, 95% 25%, 95% 75%, 50% 100%, 5% 75%, 5% 25%); background: linear-gradient(160deg, #6a7488, #2a3040); }
  .dsn .glod-dice-layer { position: absolute; }
  .mapbtn { display: inline-flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 10px; background: var(--gl-ink-3); border: 1px solid rgb(var(--gl-tint-light) / .12); border-radius: 3px; font: 600 13px var(--gl-display); color: var(--gl-text); }
</style></head>
<body><div class="pv gl-type">
  <section><h2>On the line: Seri's turn opens her plates; the other lines carry only their tag</h2>
    <iframe class="board" src="/.preview/target-lines.html?odds=1&amp;freeze=1&amp;phase=hold" title="Odds on the targeting line"></iframe></section>
  <section><h2>The narrowing beat, live — then a roll lands</h2>
    <div class="row"><div class="cell"><div id="live"></div><div class="cap" id="live-cap"></div></div>
    <div class="cell"><div id="gm"></div><div class="cap">The GM's view of the same line: the truth, and what the table currently sees.</div></div></div></section>
  <section><h2>Other shapes</h2><div class="row" id="shapes"></div></section>
  <section><h2>Sheet — the three MAP buttons with one target</h2><div class="sheet" id="sheet"></div></section>
  <section><h2>Dice So Nice — the degree on the landed die (crit · hit · miss · fumble · crit fail on a check)</h2>
    <div class="dsn" id="dsn"></div></section>
</div>
<script type="module">
import { oddsOf } from "/scripts/core/pf2e-odds.mjs";
import { buildModel } from "/scripts/features/pf2e-odds/view-model.mjs";
import { badgeHTML, compactHTML, inlineHTML, updateBadge, playLanding, diceHTML } from "/scripts/features/pf2e-odds/render.mjs";

const EN = {
  "GLOD.attack.first": "1st", "GLOD.attack.second": "2nd", "GLOD.attack.third": "3rd",
  "GLOD.chip.map": "MAP", "GLOD.chip.fortune": "Fortune", "GLOD.chip.misfortune": "Misfortune", "GLOD.chip.hidden": "Hidden", "GLOD.chip.concealed": "Concealed",
  "GLOD.unseen.attack": "Attack unseen", "GLOD.unseen.defence": "Defence unseen",
  "GLOD.word.hit": "Hit", "GLOD.word.success": "Success", "GLOD.word.crit": "Crit", "GLOD.word.theyFail": "They fail", "GLOD.word.critFail": "Crit fail", "GLOD.word.dc": "DC", "GLOD.word.vs": "vs",
  "GLOD.stat.ac": "AC", "GLOD.stat.reflex": "Reflex DC", "GLOD.stat.will": "Will DC", "GLOD.stat.spellDc": "Spell DC",
  "GLOD.gm.true": "True", "GLOD.gm.players": "Players see", "GLOD.gm.exact": "exact", "GLOD.gm.lie": "Built on a lie", "GLOD.gm.reset": "Reset by a contradiction",
  "GLOD.stamp.fumble": "Fumble", "GLOD.stamp.miss": "Miss", "GLOD.stamp.hit": "Hit", "GLOD.stamp.crit": "Crit",
  "GLOD.stamp.critFail": "Crit fail", "GLOD.stamp.fail": "Fail", "GLOD.stamp.success": "Success", "GLOD.stamp.critSuccess": "Crit success",
  "GLOD.save.reflex": "Reflex", "GLOD.save.will": "Will", "GLOD.action.demoralize": "Demoralize", "GLOD.outOfRange": "Out of range",
};
const t = (k) => EN[k] ?? k;
const freeze = new URLSearchParams(location.search).has("freeze");

const MODS = [
  { slug: "multiple-attack-penalty", label: "MAP", value: -5, kind: "untyped", enabled: true },
  { slug: "frightened", label: "Frightened", value: -1, kind: "status", enabled: true },
];
const DCMODS = [{ slug: "off-guard", label: "Off-guard", value: -2, kind: "circumstance", enabled: true }];
const probe = (over = {}) => ({ mod: 12, mods: MODS, dc: { value: 21, slug: "armor" }, options: [], rollTwice: false, ...over });
const pc = { rollerIsCreature: false, defenderIsCreature: true, isGM: false };
const model = (known, over = {}) => buildModel({ probe: probe(over.probe), dcMods: DCMODS, bareDc: 23, who: over.who ?? pc, known, label: over.label ?? "Longsword", sub: over.sub ?? "GLOD.attack.second", dcLabel: "GLOD.stat.ac", ...over.spec });

// ── live narrowing ──
const STATES = [null, { lo: 19, hi: 26 }, { lo: 21, hi: 24 }, { lo: 23, hi: 23 }];
const CAPS = ["Never seen it: a question mark over a faint hatched skyline, but your own modifiers are always known.", "A miss on 26 and a hit on 19: the defence narrows to a range.", "Another hit narrows it again; the bars resolve outward from the edge that moved.", "Closed to exact: an amber rule draws across the plate once."];
const live = document.getElementById("live");
let i = 0;
let prev = model(STATES[0]);
live.innerHTML = badgeHTML(prev, { t, target: "Ogre" });
document.getElementById("live-cap").textContent = CAPS[0];
document.getElementById("gm").innerHTML = badgeHTML(model(null, { who: { ...pc, isGM: true }, spec: { playersKnown: { lo: 21, hi: 24 } } }), { t, target: "Ogre" });
const step = () => {
  i = (i + 1) % (STATES.length + 1);
  const plate = live.querySelector(".glod-badge");
  if (i === STATES.length) { playLanding(plate, { face: 14, degree: 2, t }); return; }
  const next = model(STATES[i]);
  if (i === 0) { live.innerHTML = badgeHTML(next, { t, target: "Ogre" }); }
  else updateBadge(plate, prev, next, { t, target: "Ogre" });
  document.getElementById("live-cap").textContent = CAPS[i];
  prev = next;
};
if (!freeze) setInterval(step, 2200);

// ── other shapes ──
const shapes = document.getElementById("shapes");
const add = (m, target, cap) => { shapes.insertAdjacentHTML("beforeend", \`<div class="cell">\${badgeHTML(m, { t, target })}<div class="cap">\${cap}</div></div>\`); };
const EV = [{ adjustments: { success: { label: "Evasion", amount: "one-degree-better" } } }];
add(buildModel({ probe: { mod: 9, mods: [], dc: { value: 25 }, options: [] }, who: { rollerIsCreature: true, defenderIsCreature: false, isGM: false }, known: { lo: 15, hi: 15 }, invert: true, label: "Fireball", sub: "GLOD.save.reflex", stamps: "check" }), "Ogre", "A save spell priced from the caster: the chance the ogre does worse than a success.");
add(buildModel({ probe: { mod: 11, mods: [], dc: { value: 24, slug: "spell-dc" }, dos: EV, options: [] }, who: { rollerIsCreature: false, defenderIsCreature: true, isGM: false }, known: { lo: 24, hi: 24 }, label: "GLOD.save.reflex", stamps: "check", dcLabel: "GLOD.stat.spellDc" }), "Hag's Fireball", "Evasion: every success becomes a critical success — the strip shows it face by face.");
add(buildModel({ probe: { mod: 10, mods: [], dc: { value: 22, slug: "will" }, rollTwice: "keep-higher", options: [] }, who: pc, known: { lo: 22, hi: 22 }, label: "GLOD.action.demoralize", stamps: "check", dcLabel: "GLOD.stat.will" }), "Ogre", "Fortune: same faces, uneven weights — keep-higher.");
add(buildModel({ probe: probe(), who: pc, known: { lo: 23, hi: 23 }, bareDc: 23, flatDc: 5, label: "Shortbow", sub: "GLOD.attack.first", dcLabel: "GLOD.stat.ac" }), "Ogre", "Concealed: the flat check folds into the headline; the faces stay the pure d20.");

// ── sheet ──
const sheet = document.getElementById("sheet");
sheet.innerHTML = '<b style="min-width:110px">Longsword</b>' + [0, -5, -10].map((map, k) => {
  const m = buildModel({ probe: { mod: 17 + map, mods: [], dc: { value: 21, slug: "armor" }, options: [] }, who: pc, known: k === 2 ? null : { lo: 21, hi: 21 }, label: "Longsword", dcLabel: "GLOD.stat.ac" });
  return \`<span class="mapbtn">\${map ? (17 + map >= 0 ? "+" : "") + (17 + map) : "+17"} \${inlineHTML(m)}</span>\`;
}).join("") + '<span class="cap" style="max-width:none;margin-left:12px">third button: a creature never seen, a question mark over a faint hatch</span>';

// ── Dice So Nice ring ──
const dsn = document.getElementById("dsn");
const DICE = [[20, 3, "attack"], [14, 2, "attack"], [6, 1, "attack"], [1, 0, "attack"], [3, 0, "check"]];
const layer = document.createElement("div");
layer.className = "glod-dice-layer gl-type";
const replay = () => {
  dsn.innerHTML = "";
  layer.innerHTML = "";
  DICE.forEach(([face, degree, stamps], i) => {
    const x = 110 + i * 225, y = 105;
    dsn.insertAdjacentHTML("beforeend", \`<div class="die" style="left:\${x}px;top:\${y}px">\${face}</div>\`);
    const el = document.createElement("div");
    el.className = "glod-dice";
    el.style.setProperty("--glod-die-x", x + "px");
    el.style.setProperty("--glod-die-y", y + "px");
    el.style.setProperty("--glod-die-r", "34px");
    el.innerHTML = diceHTML({ degree, stamps }, { t });
    layer.append(el);
  });
  dsn.append(layer);
};
replay();
if (!freeze) setInterval(replay, 4000);
</script></body></html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT}`);
