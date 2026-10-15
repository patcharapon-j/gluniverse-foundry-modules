#!/usr/bin/env node
/**
 * Save Resolution — a browser-backed look at the panel and its card.
 *
 * The page IMPORTS the shipped model (model.mjs) and renderer (render.mjs),
 * reads the shipped lang file and links the shipped stylesheets, so what you
 * judge is what ships. Every view goes through `rowView`, the same gate the
 * Foundry glue uses, so the player and stream columns show exactly what those
 * screens would — a hidden creature absent, an unnamed one unnamed, a sealed
 * save rolled but unread.
 *
 * What it shows, for one Fireball over five creatures:
 *   • the GM's panel: toolbar, rows at every state (waiting with odds, each
 *     degree with its apply preview, applied with Revert, a hidden creature),
 *     the Blocked list and the effects-by-degree drawer;
 *   • a player's panel and the stream login's, side by side;
 *   • the session's chat card for the GM and for a player, at a chat log's
 *     14px — the only size at which an unsized button looks wrong;
 *   • a PF2e spell card with the "Resolve saves" button beside its save.
 *
 * Serve it — a file:// page does not run its module script:
 *
 *   node tools/pf2e-saves-preview.mjs && node tools/preview-server.mjs
 *   → http://localhost:8931/.preview/saves.html
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice("--out=".length) : ".preview/saves.html");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Save Resolution — preview</title>
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" href="/styles/pf2e-odds.css">
<link rel="stylesheet" href="/styles/pf2e-saves.css">
<style>
  body { margin: 0; background: var(--gl-ink-0); color: var(--gl-text); font-family: var(--gl-display); }
  .pv { max-width: 1260px; margin: 0 auto; padding: 28px; display: flex; flex-direction: column; gap: 26px; }
  .pv h2 { margin: 0 0 10px; font: 700 11px/1 var(--gl-tech); letter-spacing: .16em; text-transform: uppercase; color: var(--gl-text-dim); }
  .row { display: flex; gap: 22px; flex-wrap: wrap; align-items: flex-start; }
  .cap { font: 500 12px/1.4 var(--gl-display); color: var(--gl-text-dim); margin-top: 6px; max-width: 520px; }
  /* A stand-in for Foundry's window frame: the panel's own content at its real width. */
  .win { width: 520px; border: 1px solid var(--gl-edge); background: var(--gl-ink-1); box-shadow: 0 12px 40px rgb(var(--gl-tint-dark) / .6); }
  .win > header { padding: 6px 10px; font: 600 13px var(--gl-display); background: var(--gl-ink-2); border-bottom: 1px solid var(--gl-hair); }
  .win.glsv-panel .window-content { display: block; }
  /* A stand-in for PF2e's chat log: 14px type, its parchment-free dark card. */
  .chat { width: 300px; font-size: 14px; font-family: var(--gl-display); }
  .chat .msg { padding: 6px 8px; background: var(--gl-ink-2); border: 1px solid var(--gl-hair); margin-bottom: 8px; }
  .chat .msg header { font-weight: 700; margin-bottom: 4px; }
  .pf2e-card .save { display: block; width: 100%; padding: 4px; font: inherit; background: #d9d3c2; color: #222; border: 1px solid #7a6f5a; }
  .glod-inline { font: 600 11px var(--gl-tech); color: var(--gl-cyan); }
</style></head>
<body><div class="pv gl-type">
  <section><h2>The GM's panel</h2><div class="row">
    <div><div class="win glsv-panel"><header>Save Resolution — Fireball</header><div class="window-content" id="gm"></div></div>
      <div class="cap">Waiting rows carry the odds; rolled rows their degree, the multiplier and what applying would do; an applied row its Revert. The hidden creature is drawn dashed, for the GM only.</div></div>
  </div></section>
  <section><h2>A player's panel · the stream login's</h2><div class="row">
    <div><div class="win glsv-panel"><header>Save Resolution — Fireball</header><div class="window-content" id="player"></div></div>
      <div class="cap">Alice's own save reads in full; the goblin's is sealed because the GM rolled it privately; the hidden creature is not there.</div></div>
    <div><div class="win glsv-panel"><header>Save Resolution — Fireball</header><div class="window-content" id="stream"></div></div>
      <div class="cap">The stream login holds GM rights and gets the player's view.</div></div>
  </div></section>
  <section><h2>Chat — the session card (GM · player) and the spell card's button, at 14px</h2><div class="row">
    <div class="chat"><div class="msg"><header>Ezren</header><div id="card-gm"></div></div></div>
    <div class="chat"><div class="msg"><header>Ezren</header><div id="card-player"></div></div></div>
    <div class="chat"><div class="msg pf2e-card"><header>Ezren — Fireball</header><p>A roaring blast of fire…</p>
      <button class="save">Basic Reflex Save DC 22</button><div id="resolve"></div></div></div>
  </div></section>
</div>
<script type="module">
import { normalizeSession, rowView, multiplierFor, normalizeConfig, previewDamage, mayRoll } from "/scripts/features/pf2e-saves/model.mjs";
import { sessionHTML } from "/scripts/features/pf2e-saves/render.mjs";
import { DEGREES } from "/scripts/features/pf2e-saves/constants.mjs";

const EN = await (await fetch("/lang/pf2e-saves.en.json")).json();
const t = (k) => EN[k] ?? k;

const fireEffects = { effects: {} };
const session = normalizeSession({
  id: "s1", castId: "c1", spellUuid: "Actor.ez.Item.fb", casterUuid: "Actor.ez", spellName: "Fireball", spellImg: "",
  save: "reflex", dc: 22, basic: true, rank: 3, damageId: "d1", combatId: "cb", at: Date.now(),
  config: normalizeConfig({ effects: { criticalFailure: [{ uuid: "Compendium.pf2e.conditionitems.Item.p", label: "Prone", value: null }] } }, true),
  rows: [
    { id: "alice", kind: "pc", name: "Alice", img: "", tokenUuid: "a", actorUuid: "A", rollId: "m-alice" },
    { id: "bruno", kind: "pc", name: "Bruno", img: "", tokenUuid: "b", actorUuid: "B" },
    { id: "gob1", kind: "npc", name: "Goblin Pyro", img: "", tokenUuid: "g", actorUuid: "G", rollId: "m-gob1" },
    { id: "ogre", kind: "npc", name: "", img: "", tokenUuid: "o", actorUuid: "O", rollId: "m-ogre", applied: { at: Date.now(), combatId: "cb", takenId: "t", created: [], changed: [] } },
    { id: "lurk", kind: "npc", name: "", img: "", tokenUuid: "l", actorUuid: "L", hidden: true, rollId: "m-lurk" },
  ],
  blocked: [{ id: "behind", kind: "npc", name: "Goblin Commando", img: "", tokenUuid: "x", actorUuid: "X" }],
});

// What each save's own message would let each viewer read (the glue asks landingOf for this).
const truth = { "m-alice": { degree: 2, face: 14, total: 23 }, "m-gob1": { degree: 0, face: 1, total: 6 }, "m-ogre": { degree: 1, face: 9, total: 17 }, "m-lurk": { degree: 3, face: 20, total: 35 } };
const seen = { player: { "m-alice": truth["m-alice"] }, stream: { "m-alice": { ...truth["m-alice"], total: null, face: null } } };
const live = { alice: "Alice", bruno: "Bruno", gob1: "Goblin Pyro", ogre: "Ogre Warrior", lurk: "Shadow Lurker" };
const iwr = { gob1: [{ type: "fire", total: 28, resistance: null, weakness: null }], alice: [{ type: "fire", total: 28, resistance: { label: "fire", value: 5 } }], lurk: [{ type: "fire", total: 28, immune: "fire" }] };

function view(who, compact) {
  const gm = who === "gm";
  const user = { isGM: who !== "player", id: who };
  const rows = session.rows.map((row) => {
    const result = gm ? truth[row.rollId] ?? null : seen[who][row.rollId] ?? null;
    const l = { name: live[row.id], img: "", result };
    if (!compact && !row.rollId) l.odds = '<span class="glod-inline">62%</span>';
    if (gm && !compact && row.rollId && !row.applied && result?.degree != null) {
      l.mult = multiplierFor(result.degree, session.config, true);
      l.preview = previewDamage(iwr[row.id] ?? [{ type: "fire", total: 28 }], l.mult);
      l.effects = session.config.effects[DEGREES[result.degree]];
    }
    const v = rowView(row, { truth: gm, isGM: gm, live: l, undo: true,
      canRoll: (gm || who === "player") && mayRoll(user, row, { owns: () => who === "player" && row.id === "bruno" }) });
    if (v && compact) Object.assign(v, { canApply: false, canRemove: false });
    return v;
  }).filter(Boolean);
  return {
    title: "Fireball", img: "", saveLine: "Basic Reflex · DC 22", isGM: gm, canOpen: gm, compact, rows,
    blocked: session.blocked.map((b) => ({ id: b.id, name: gm ? "Goblin Commando" : b.name, img: "" })),
    config: gm ? session.config : null, configOpen: true,
    damage: gm ? { total: "28", types: "fire", formula: "6d6" } : null,
    npcsToRoll: 0, toApply: rows.filter((r) => r.canApply).length, toRevert: rows.filter((r) => r.canRevert).length, canRollDamage: false,
  };
}

document.getElementById("gm").innerHTML = sessionHTML(view("gm", false), { t });
document.getElementById("player").innerHTML = sessionHTML(view("player", false), { t });
document.getElementById("stream").innerHTML = sessionHTML(view("stream", false), { t });
document.getElementById("card-gm").innerHTML = sessionHTML(view("gm", true), { t });
document.getElementById("card-player").innerHTML = sessionHTML(view("player", true), { t });
document.getElementById("resolve").innerHTML = '<button type="button" class="glsv-open-btn"><i class="fa-solid fa-list-check"></i> ' + t("GLSV.card.resolve") + "</button>";
document.body.dataset.ready = "1";
</script></body></html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT}`);
