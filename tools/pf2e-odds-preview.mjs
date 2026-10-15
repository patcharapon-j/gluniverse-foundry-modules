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
  body { margin: 0; background: var(--gl-ink-0); color: var(--gl-text); font-family: var(--gl-display); }
  .pv { max-width: 1180px; margin: 0 auto; padding: 28px; display: flex; flex-direction: column; gap: 22px; }
  .pv h2 { margin: 0 0 10px; font: 700 11px/1 var(--gl-tech); letter-spacing: .16em; text-transform: uppercase; color: var(--gl-text-dim); }
  .board { position: relative; height: 380px; border-radius: 10px; overflow: hidden;
    background: radial-gradient(120% 90% at 30% 20%, #1a2433, #0a0f17 70%); box-shadow: inset 0 0 0 1px rgb(var(--gl-tint-light) / .07); }
  .board::before { content: ""; position: absolute; inset: 0; background-image: linear-gradient(rgb(var(--gl-tint-light) / .035) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--gl-tint-light) / .035) 1px, transparent 1px); background-size: 50px 50px; }
  .tok { position: absolute; width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center; font: 700 14px var(--gl-display);
    background: radial-gradient(circle at 35% 30%, #3b4660, #151b28); box-shadow: 0 0 0 2px var(--c), 0 6px 18px rgb(var(--gl-tint-dark) / .6); }
  .tok.pc { --c: var(--gl-cyan); } .tok.foe { --c: var(--gl-hazard); width: 66px; height: 66px; }
  svg.lines { position: absolute; inset: 0; width: 100%; height: 100%; }
  .slot { position: absolute; }
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
  <section><h2>Targeting lines — known · narrowing · unseen (full plate on turn, compact tag off turn)</h2>
    <div class="board" id="board"></div></section>
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
  "GLOD.word.hit": "Hit", "GLOD.word.success": "Success", "GLOD.word.crit": "Crit", "GLOD.word.theyFail": "They fail", "GLOD.word.critFail": "Crit fail", "GLOD.word.dc": "DC",
  "GLOD.stat.ac": "AC", "GLOD.stat.reflex": "Reflex DC", "GLOD.stat.will": "Will DC", "GLOD.stat.spellDc": "Spell DC",
  "GLOD.gm.true": "GM · True", "GLOD.gm.players": "· Players see", "GLOD.gm.exact": "exact", "GLOD.gm.lie": "Built on a lie", "GLOD.gm.reset": "Reset by a contradiction",
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

// ── board ──
const board = document.getElementById("board");
const lines = [
  { from: [70, 300], to: [420, 70], name: "Ogre", known: { lo: 23, hi: 23 }, full: true },
  { from: [70, 300], to: [700, 250], name: "Ogre Boss", known: { lo: 20, hi: 26 }, full: true },
  { from: [70, 300], to: [1000, 90], name: "Hag", known: null, full: false },
];
board.innerHTML = '<svg class="lines"><defs><marker id="ah" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#5eeaff"/></marker></defs>' +
  lines.map((l) => \`<path d="M\${l.from[0]} \${l.from[1]} Q\${(l.from[0] + l.to[0]) / 2} \${Math.min(l.from[1], l.to[1]) - 90} \${l.to[0] - 34} \${l.to[1]}" fill="none" stroke="#5eeaff" stroke-width="1.6" stroke-dasharray="6 5" marker-end="url(#ah)" opacity=".85"/>\`).join("") + "</svg>" +
  '<div class="tok pc" style="left:42px;top:272px">VL</div>' +
  lines.map((l) => \`<div class="tok foe" style="left:\${l.to[0] - 33}px;top:\${l.to[1] - 33}px">\${l.name.slice(0, 2).toUpperCase()}</div>\`).join("");
lines.forEach((l) => {
  const m = model(l.known);
  const s = document.createElement("div");
  s.className = "slot glod-line " + (l.full ? "is-full" : "is-compact");
  s.style.left = (l.to[0] + 42) + "px"; s.style.top = (l.to[1] - 6) + "px";
  s.innerHTML = badgeHTML(m, { t, target: l.name }) + compactHTML(m);
  board.append(s);
});

// ── live narrowing ──
const STATES = [null, { lo: 19, hi: 26 }, { lo: 21, hi: 24 }, { lo: 23, hi: 23 }];
const CAPS = ["Never seen it: ??? over a violet strip, but your own modifiers are always known.", "A miss on 26 and a hit on 19: the defence narrows to a range.", "Another hit narrows it again; the pips resolve outward from the edge that moved.", "Closed to exact: the strip sweeps and the plate takes an amber rim."];
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
}).join("") + '<span class="cap" style="max-width:none;margin-left:12px">third button: a creature never seen — ??? with a violet hatch</span>';

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
