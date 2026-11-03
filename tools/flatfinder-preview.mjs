#!/usr/bin/env node
/**
 * Flatfinder — a browser-backed look at everything the feature draws.
 *
 * The page IMPORTS the shipped rules (rules.mjs), model (encounter-model.mjs),
 * planner store (planner-store.mjs) and markup (view.mjs), reads the shipped
 * lang file and links the shipped stylesheets, so what you judge is what ships.
 * Every number on it is computed by the real rules from plain inputs; nothing
 * is typed into the markup by hand.
 *
 * What it shows:
 *   • competence badges on skill-check cards at a chat log's 14px, on PF2e's
 *     parchment card and on a dark one: every band, with the Lore and natural
 *     20 / natural 1 shifts;
 *   • the threat strip at the top of a combat tracker: each rating, the
 *     breakdown open (Elite, Weak, a Supreme boss, a hazard, a minion), and the
 *     empty state;
 *   • the encounter planner window at its real width: a planned fight, the
 *     drop zone mid-drag, and an empty plan.
 *
 * Serve it — a file:// page does not run its module script:
 *
 *   node tools/flatfinder-preview.mjs && node tools/preview-server.mjs 8982
 *   → http://localhost:8982/.preview/flatfinder.html   (?view=chat|tracker|planner)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice("--out=".length) : ".preview/flatfinder.html");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Flatfinder — preview</title>
<!-- Foundry ships Font Awesome; the preview borrows the free build so the icons show. -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" href="/styles/flatfinder.css">
<style>
  body { margin: 0; background: #16171c; color: #ddd; font-family: Signika, "Segoe UI", sans-serif; }
  .pv { padding: 24px 28px; display: flex; flex-direction: column; gap: 26px; }
  .pv h2 { margin: 0 0 10px; font: 700 11px/1 "Segoe UI", sans-serif; letter-spacing: .16em; text-transform: uppercase; color: #8b8d99; }
  .row { display: flex; gap: 22px; flex-wrap: wrap; align-items: flex-start; }
  .cap { font: 12px/1.4 "Segoe UI", sans-serif; color: #8b8d99; margin-top: 6px; max-width: 320px; }
  /* A stand-in for PF2e's chat log: 14px type, parchment cards. */
  .chat { width: 300px; font-size: 14px; display: flex; flex-direction: column; gap: 8px; }
  .msg { padding: 6px 8px 8px; background: #e9e3d2; color: #191813; border: 1px solid #7a6f5a; }
  .msg.dark { background: #23242b; color: #ddd; border-color: #3a3c46; }
  .msg header { display: flex; justify-content: space-between; font-weight: 700; }
  .msg header small { font-weight: 400; opacity: .6; }
  .msg .flavor { margin: 2px 0 6px; font-size: 13px; }
  .dice-roll { padding: 5px; border: 1px solid #8c8270; text-align: center; font-size: 19px; font-weight: 700; }
  .msg.dark .dice-roll { border-color: #555; }
  /* A stand-in for Foundry's combat tracker sidebar. */
  .tracker { width: 300px; background: #0e0f13; border: 1px solid #2a2b33; padding: 2px 0 6px; font-size: 14px; }
  .tracker .combat-tracker { margin: 0; padding: 0; list-style: none; }
  .tracker .combat-tracker li { display: flex; gap: 8px; align-items: center; padding: 6px 10px; border-top: 1px solid #22232a; color: #ccc; }
  .tracker .combat-tracker li i { width: 26px; height: 26px; background: #2a2b33; }
  .tracker .combat-tracker li b { margin-left: auto; color: #888; font-weight: 400; }
  /* A stand-in for Foundry's window frame around the planner. */
  .win { width: 480px; border: 1px solid #2a2b33; box-shadow: 0 12px 40px rgb(0 0 0 / .6); background: #000; }
  .win > header { padding: 7px 10px; font: 600 13px "Segoe UI", sans-serif; background: #15161c; border-bottom: 1px solid #2a2b33; color: #ddd; }
  .win .window-content { display: block; }
  [data-only] { display: none; }
</style></head>
<body><div class="pv">
  <section data-view="chat"><h2>Competence badges, at a chat log's 14px</h2><div class="row">
    <div class="chat" id="chat-parchment"></div>
    <div class="chat" id="chat-dark"></div>
  </div><div class="cap">The ladder's height says the band without colour. Shifts are chips, so a 19 reading Impressive says why.</div></section>

  <section data-view="tracker"><h2>The threat strip, top of the combat tracker</h2><div class="row" id="trackers"></div></section>

  <section data-view="planner"><h2>The encounter planner</h2><div class="row" id="planners"></div></section>
</div>
<script type="module">
import { competence } from "/scripts/features/flatfinder/rules.mjs";
import { buildEncounter } from "/scripts/features/flatfinder/encounter-model.mjs";
import { normalizePlan, planEntries } from "/scripts/features/flatfinder/planner-store.mjs";
import { competenceHTML, trackerHTML, plannerHTML } from "/scripts/features/flatfinder/view.mjs";

const EN = await (await fetch("/lang/flatfinder.en.json")).json();
const t = (k, d) => {
  let s = EN[k] ?? k;
  if (d) for (const [key, v] of Object.entries(d)) s = s.replaceAll("{" + key + "}", String(v));
  return s;
};
const q = new URLSearchParams(location.search);
const only = q.get("view");
if (only) document.querySelectorAll("[data-view]").forEach((el) => { if (el.dataset.view !== only) el.remove(); });
const fresh = q.get("fresh") === "1";

/* Chat */
const checks = [
  { who: "Seri", what: "Arcana Check", total: 23, natural: 14 },
  { who: "Seri", what: "Occultism Check", total: 4, natural: 1 },
  { who: "Ezren", what: "Warfare Lore Check", total: 19, natural: 11, lore: true },
  { who: "Ezren", what: "Society Check", total: 11, natural: 6 },
  { who: "Kyra", what: "Religion Check", total: 26, natural: 20 },
  { who: "Kyra", what: "Scribing Lore Check", total: 31, natural: 17, lore: true },
  { who: "Valeros", what: "Nature Check", total: 7, natural: 4 },
];
const card = (c, dark) => '<div class="msg' + (dark ? " dark" : "") + '"><header>' + c.who + '<small>now</small></header>' +
  '<div class="message-content"><div class="flavor">' + c.what + '</div><div class="dice-roll">' + c.total + '</div>' +
  competenceHTML(competence({ total: c.total, natural: c.natural, lore: !!c.lore }), { t, fresh }) + '</div></div>';
const chatP = document.getElementById("chat-parchment");
const chatD = document.getElementById("chat-dark");
if (chatP) chatP.innerHTML = checks.slice(0, 4).map((c) => card(c, false)).join("");
if (chatD) chatD.innerHTML = checks.slice(3).map((c) => card(c, true)).join("");

/* Tracker */
const party = { level: 5, size: 4, source: "combat" };
const fights = [
  { cap: "Moderate, closed: 64 XP is past the Low budget of 60, so it rates Moderate, as PF2e itself reads a budget.",
    threats: [{ id: "a", name: "Goblin Warrior", level: 4 }, { id: "b", name: "Goblin Warrior", level: 4 }] },
  { cap: "Severe, open: an Elite counts two levels up, a Weak two down; identical creatures fold into one row.", open: true,
    threats: [{ id: "a", name: "Ogre Warrior", level: 7, adjustment: "elite" },
      { id: "c", name: "Goblin Warrior", level: 2, adjustment: "weak" }, { id: "d", name: "Goblin Warrior", level: 2, adjustment: "weak" }, { id: "e", name: "Poisoned Dart Gallery", level: 6, hazard: "simple" }] },
  { cap: "Extreme, open: a Supreme boss is worth three times its base creature, counted once however many turns it takes.", open: true,
    threats: [{ id: "a", name: "Warlord Krask", level: 7, bossFactor: 3, bossTier: "supreme" }, { id: "b", name: "Summoned Wolf", level: 1, minion: true }, { id: "c", name: "Bonded Guardian", level: 14 }, { id: "d", name: "Lurking Assassin", level: 6, hidden: true }] },
  { cap: "Trivial: one creature well below the party.", threats: [{ id: "a", name: "Giant Rat", level: 1 }] },
];
const trackers = document.getElementById("trackers");
if (trackers) {
  let out = "";
  for (const f of fights) {
    const model = buildEncounter({ party, threats: f.threats, group: true, sort: true });
    out += '<div><div class="tracker">' + trackerHTML(model, { t, open: !!f.open, from: fresh ? 0 : null }) +
      '<ol class="combat-tracker">' + f.threats.slice(0, 3).map((x) => "<li><i></i>" + x.name + "<b>" + (10 + x.level) + "</b></li>").join("") + "</ol></div>" +
      '<div class="cap">' + f.cap + "</div></div>";
  }
  out += '<div><div class="tracker">' + trackerHTML(null, { t }) + '<ol class="combat-tracker"><li><i></i>Seri<b>18</b></li><li><i></i>Ezren<b>15</b></li></ol></div>' +
    '<div class="cap">No threats yet: one quiet line, the planner a click away.</div></div>';
  trackers.innerHTML = out;
  trackers.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ff-action='toggle']");
    if (!b) return;
    const s = b.closest(".ff-enc");
    s.classList.toggle("is-open");
    b.setAttribute("aria-expanded", String(s.classList.contains("is-open")));
  });
}

/* Planner */
const plan = normalizePlan({
  party: null,
  rows: [
    { id: "r1", name: "Warlord Krask", base: 7, count: 1, bossFactor: 2, bossTier: "greater" },
    { id: "r2", name: "Hobgoblin Soldier", base: 5, count: 3, adjustment: "elite" },
    { id: "r3", name: "Goblin Warrior", base: 4, count: 4, adjustment: "weak" },
    { id: "r4", name: "Spiked Pit", base: 6, hazard: "simple", count: 1 },
    { id: "r5", name: "Blade Pillar Gallery", base: 8, hazard: "complex", count: 1 },
  ],
});
const planModel = buildEncounter({ party: { level: 6, size: 5, source: "party" }, threats: planEntries(plan) });
const emptyModel = buildEncounter({ party: { level: 3, size: 4, source: "manual" }, threats: [] });
const planners = document.getElementById("planners");
if (planners) {
  const win = (title, body, cap) => '<div><div class="win flatfinder-planner-app"><header>' + title + '</header><div class="window-content">' + body + "</div></div>" + (cap ? '<div class="cap">' + cap + "</div>" : "") + "</div>";
  planners.innerHTML =
    win(t("PF2E-FLATFINDER.Planner.Title"), plannerHTML(planModel, { t, canCopy: true, from: fresh ? 0 : null }),
      "A planned fight for a level 6 party of five: a Greater boss, three Elite soldiers, four Weak goblins and two hazards.") +
    win(t("PF2E-FLATFINDER.Planner.Title"), plannerHTML(emptyModel, { t, manual: true }).replace('ff-planner gl-type is-empty"', 'ff-planner gl-type is-empty is-dragging"'),
      "An empty plan with a creature being dragged over it; the party set by hand.");
}
document.body.dataset.ready = "1";
</script></body></html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT}`);
