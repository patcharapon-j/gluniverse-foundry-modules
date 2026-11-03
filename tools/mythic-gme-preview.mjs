#!/usr/bin/env node
/**
 * Mythic GME: a browser-backed look at the panel and its chat card.
 *
 * Nothing here is a copy of the module. Every roll goes through the real
 * rules and catalog (`oracle.mjs`), with fixed dice; the log goes through the
 * real normalizer; the page is drawn by the real view model (`model.mjs`) and
 * markup (`render.mjs`), localised from the real language file, under the
 * shipped stylesheet. So what you judge is what the GM gets.
 *
 * Usage: node tools/mythic-gme-preview.mjs [--out=.preview/mythic.html]
 *        node tools/preview-server.mjs 8983
 *        /.preview/mythic.html             every frame
 *        /.preview/mythic.html?only=ask    one frame (ask, event, scene, meaning,
 *                                          linked, lists, empty, wild, chat)
 *        ...&seek=200                      pause every animation at 200 ms
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice("--out=".length) : ".preview/mythic.html");

const mod = (p) => import(pathToFileURL(join(ROOT, p)).href);
const O = await mod("scripts/features/mythic-gme/oracle.mjs");
const { panelModel, entryView } = await mod("scripts/features/mythic-gme/model.mjs");
const { panelHTML, chatHTML } = await mod("scripts/features/mythic-gme/render.mjs");
const { normalizeLists, addRow, stepWeight } = await mod("scripts/features/mythic-gme/lists.mjs");
const { ACTIONS_2 } = await mod("scripts/features/mythic-gme/catalog.mjs");

const LANG = JSON.parse(readFileSync(join(ROOT, "lang/mythic-gme.en.json"), "utf8"));
const t = (key, data) => {
  const s = key.split(".").reduce((o, p) => (o && typeof o === "object" ? o[p] : undefined), LANG);
  const str = typeof s === "string" ? s : key;
  return data ? str.replace(/\{(\w+)\}/g, (m, k) => (k in data ? String(data[k]) : m)) : str;
};

/* ── dice: a seeded rng, and a scripted one where a frame needs a given face ─ */

const seeded = (seed) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
/** Faces in order: each value is the die result wanted from a dN roll. */
const scripted = (faces, sizes) => {
  let i = 0;
  return () => {
    const n = sizes[i] ?? 100;
    const f = faces[i++] ?? 1;
    return (f - 0.5) / n;
  };
};

let clock = Date.UTC(2026, 10, 3, 20, 0);
const stamp = (e) => O.stamp(e, { now: (clock += 60_000), rng: seeded(clock % 9973) });

let lists = normalizeLists({});
lists = addRow(lists, "threads", "Find who burned the ferry", 1);
lists = addRow(lists, "threads", "Get the ledger back from the toll-keeper", 2);
lists = addRow(lists, "characters", "Vell, the ferryman's daughter", 3);
lists = addRow(lists, "characters", "The toll-keeper", 4);
lists = addRow(lists, "characters", "Captain Oras", 5);
lists = stepWeight(lists, "characters", lists.characters[1].id, 1);

/* A fake Actions Table 1, standing in for one a GM would link. Placeholder words. */
const LINKED = ACTIONS_2.map((_, i) => `Verb ${i + 1}`);

// Newest first, as the store keeps it. Rolled oldest first.
const rolled = [
  stamp({ label: "Fate · Likely", result: "Yes", meta: "d100 = 33 · CF 6", tone: "yes", subs: [] }),
  stamp(O.elementEntry("smells", seeded(4))),
  stamp(O.chaosEntry(5, false)),
  stamp(O.listEntry("threads", lists.threads, seeded(8))),
  stamp(O.meaningEntry("descriptions", { rng: seeded(12) })),
  stamp(O.askFate({ oddsId: "unlikely", cf: 6, question: "Is the bridge still standing?", rng: seeded(3) })),
  // d100 22 under a Likely at Chaos 6: a Yes, doubles, and a Random Event about a character.
  stamp(
    O.askFate({
      oddsId: "likely",
      cf: 6,
      question: "Does Vell recognise the stranger?",
      lists,
      rng: scripted([22, 30, 40, 3], [100, 100, 100, 4]),
    })
  ),
];
// The legacy entry is stored the way the pre-remake panel stored it: no v, no kind.
delete rolled[0].v;
delete rolled[0].kind;
const LOG = O.normalizeLog(rolled.reverse());

const excYes = O.normalizeLog([stamp(O.askFate({ oddsId: "very-likely", cf: 6, question: "Is the ledger in the strongbox?", rng: scripted([7], [100]) })), ...LOG]);
const interrupted = O.normalizeLog([stamp(O.sceneEntry({ cf: 7, lists, rng: scripted([4, 52, 9, 1], [10, 100, 100, 2]) })), ...LOG]);
const eventLog = O.normalizeLog([stamp(O.eventEntry({ lists, rng: scripted([60, 18, 1], [100, 100, 2]) })), ...LOG]);
const altered = O.normalizeLog([stamp(O.sceneEntry({ cf: 5, rng: scripted([3, 8, 2, 5], [10, 10, 10, 10]) })), ...LOG]);
const linkedMeaning = O.normalizeLog([stamp(O.meaningEntry("actions", { rng: seeded(21), actions1: LINKED })), ...LOG]);
const missingMeaning = O.normalizeLog([stamp(O.meaningEntry("actions", { rng: seeded(21) })), ...LOG]);

const base = { chaos: 6, ui: { tab: "ask", odds: "likely" }, lists, autoEvent: true, actions1: { linked: false }, writable: true };

const frame = (id, label, body) =>
  `<figure class="preview-frame" data-frame="${id}"><figcaption class="preview-label">${label}</figcaption>${body}</figure>`;

function windowFrame(id, label, state, { width = 344, height = 660 } = {}) {
  const model = panelModel({ ...base, ...state });
  return frame(
    id,
    label,
    `<div class="application gmyth gmyth-panel preview-window" style="width:${width}px;height:${height}px">` +
      `<header class="window-header"><i class="window-icon fa-solid fa-hat-wizard"></i><h1 class="window-title">${t("GLMYTHIC.title")}</h1></header>` +
      `<section class="window-content">${panelHTML(model, t)}</section></div>`
  );
}

const frames = [
  windowFrame("ask", "Ask · an Exceptional Yes, freshly landed (seek=200 freezes it)", { log: excYes, fresh: excYes[0].id }),
  windowFrame("event", "Ask · a Yes on doubles: the Random Event picks a character", { log: LOG, fresh: LOG[0].id }),
  windowFrame("scene", "Scene · an interrupted scene and its Random Event", { log: interrupted, ui: { tab: "scene" }, chaos: 7 }),
  windowFrame("meaning", "Meaning · Actions Table 1 not linked, searching", { log: missingMeaning, ui: { tab: "meaning" }, query: "char" }),
  windowFrame("linked", "Meaning · Table 1 linked, an Actions pair", { log: linkedMeaning, ui: { tab: "meaning" }, actions1: { linked: true, name: "Mythic · Actions 1" } }),
  windowFrame("lists", "Lists · threads and characters, one weighted twice", { log: altered, ui: { tab: "lists" } }),
  windowFrame("empty", "First open · nothing rolled, lists empty", { log: [], lists: normalizeLists({}), chaos: 5 }, { height: 520 }),
  windowFrame("wild", "Chaos 9 · an Exceptional No at the ceiling", {
    chaos: 9,
    log: O.normalizeLog([stamp(O.askFate({ oddsId: "fifty-fifty", cf: 9, rng: scripted([100], [100]) })), ...eventLog]),
  }),
];

const card = (e, audience) => chatHTML(entryView(e), t, { audience });
frames.push(
  frame(
    "chat",
    "Chat cards · at a real chat log's 14px",
    `<div class="preview-chat">` +
      `<div class="preview-msg"><span class="preview-whisper">To: GM</span>${card(LOG[0], "whisper")}</div>` +
      `<div class="preview-msg">${card(interrupted[0], "table")}</div>` +
      `<div class="preview-msg">${card(altered[0], "table")}</div>` +
      `<div class="preview-msg">${card(LOG.at(-1), "whisper")}</div>` +
      `</div>`
  )
);

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Mythic GME preview</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<link rel="stylesheet" href="../styles/gl-fonts.css">
<link rel="stylesheet" href="../styles/gl-tokens.css">
<link rel="stylesheet" href="../styles/gl-motion.css">
<link rel="stylesheet" href="../styles/mythic-gme.css">
<style>
  /* Stand-ins for Foundry's own frame and chat log. Nothing here styles a gmyth- class. */
  body { margin:0; padding:24px; background:#1b1d22 radial-gradient(1200px 700px at 30% 20%, #2a2f2a, #121315); color:#ddd;
         font-family:system-ui, sans-serif; display:flex; flex-wrap:wrap; gap:28px; align-items:flex-start; }
  body.only { padding:28px; display:block; }
  body.only .preview-frame:not(.is-only) { display:none; }
  .preview-frame { margin:0; display:flex; flex-direction:column; gap:8px; }
  .preview-label { font:600 10px/1 system-ui, sans-serif; letter-spacing:.1em; text-transform:uppercase; color:#8a8d98; max-width:344px; }
  .preview-window { position:relative; display:flex; flex-direction:column; overflow:hidden; }
  .preview-window .window-header { display:flex; align-items:center; gap:8px; height:34px; padding:0 12px; flex:none; }
  .preview-window .window-title { margin:0; border:0; flex:1; }
  .preview-window .window-content { flex:1; min-height:0; display:flex; flex-direction:column; }
  .preview-chat { width:300px; padding:8px; background:#0e0f13; font-size:14px; display:flex; flex-direction:column; gap:8px; }
  .preview-msg { padding:6px; background:#17181d; border:1px solid #26272e; display:flex; flex-direction:column; gap:6px; }
  .preview-whisper { font:12px system-ui; color:#8a8d98; }
</style></head><body>
${frames.join("\n")}
<script>
  const q = new URLSearchParams(location.search);
  const only = q.get("only");
  if (only) {
    document.body.classList.add("only");
    document.querySelector('[data-frame="' + only + '"]')?.classList.add("is-only");
  }
  // The pages switch in place, as the app does.
  document.addEventListener("click", (ev) => {
    const tab = ev.target.closest('[data-action="setTab"]');
    if (!tab) return;
    const root = tab.closest(".gmyth-root");
    root.dataset.tab = tab.dataset.tab;
    root.querySelectorAll(".gmyth-tab").forEach((b) => b.classList.toggle("is-active", b === tab));
  });
  const seek = q.get("seek");
  if (seek != null) {
    const at = Number(seek) || 0;
    requestAnimationFrame(() => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = at; }));
  }
</script>
</body></html>`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT}`);
