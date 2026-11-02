#!/usr/bin/env node
/**
 * Roleplay Chat — a browser-backed look at every surface.
 *
 * The page IMPORTS the shipped renderers (`render.mjs`) and model (`model.mjs`), the shared text reader
 * and the stream's roll card, and links the shipped stylesheets, so what you judge is what ships. Only
 * Foundry itself is mocked: its sidebar, its chat-message element and its chat box are drawn here in
 * the shape Foundry v14 renders them, because the feature's markup sits inside them.
 *
 * What it shows:
 *   1. a player's screen: Say and Think balloons, a Do caption, the caption lane with a line from an
 *      off-scene speaker and the Narrator, the restyled chat log, and the composer in Think;
 *   2. the switch, state by state, including the locked switch and the GM's speaker picker;
 *   3. the stream cards a line becomes, built through the real `readText`.
 *
 * Serve it — a file:// page does not run its module script:
 *
 *   node tools/roleplay-chat-preview.mjs && node tools/preview-server.mjs
 *   → http://localhost:8931/.preview/roleplay-chat.html   (?only=1|2|3 shows one section)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice("--out=".length) : ".preview/roleplay-chat.html");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Roleplay Chat — preview</title>
<!-- Foundry ships Font Awesome; the preview borrows it from a CDN for the switch's icons. -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" href="/styles/stream.css">
<link rel="stylesheet" href="/styles/stream-cards.css">
<link rel="stylesheet" href="/styles/roleplay-chat.css">
<style>
  /* page chrome and a stand-in for Foundry's own sheet; none of this ships */
  html, body { margin: 0; background: var(--gl-ink-0); color: var(--gl-text); }
  body { width: 1640px; padding: 24px 20px 60px; box-sizing: border-box; font-family: "Google Sans Flex", sans-serif; }
  .sec { margin: 0 0 40px; }
  .sec > h2 { font: 600 13px/1 "Google Sans Flex", sans-serif; letter-spacing: .12em; text-transform: uppercase; color: var(--gl-text-dim); margin: 0 0 12px; }
  .fvtt { position: relative; width: 1600px; height: 900px; display: grid; grid-template-columns: 1fr 300px; overflow: hidden; outline: 1px solid rgb(var(--gl-tint-light) / .08); }
  .map { position: relative; overflow: hidden; background: radial-gradient(70% 60% at 70% 30%, #3b4d33, transparent 75%), radial-gradient(90% 80% at 50% 50%, #2c3a28, #141b13); }
  .map::after { content: ""; position: absolute; inset: 0; pointer-events: none; background-image: linear-gradient(rgb(var(--gl-tint-dark) / .28) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--gl-tint-dark) / .28) 1px, transparent 1px); background-size: 80px 80px; }
  .token { position: absolute; width: 80px; height: 80px; }
  .token img { width: 100%; height: 100%; border-radius: 50%; box-sizing: border-box; border: 3px solid var(--gl-info); object-fit: cover; }
  .token[data-disp="hostile"] img { border-color: var(--gl-danger, #e2333f); }
  .hotbar { position: absolute; left: 50%; bottom: 10px; translate: -50% 0; display: flex; gap: 4px; }
  .hotbar i { width: 48px; height: 48px; background: rgb(var(--gl-tint-dark) / .6); border: 1px solid rgb(var(--gl-tint-light) / .12); border-radius: 4px; }
  .sidebar { display: flex; flex-direction: column; background: rgb(var(--gl-tint-dark) / .9); border-left: 1px solid rgb(var(--gl-tint-light) / .08); }
  .chat-log { flex: 1; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end; gap: 8px; padding: 10px 8px; margin: 0; list-style: none; }
  .chat-message { background: #1a1b23; border: 1px solid #2c2f3b; border-radius: 5px; padding: 6px 8px 8px; color: #d6d8e0; font: 13px/1.4 "Segoe UI", sans-serif; }
  .message-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
  .message-sender { margin: 0; font-size: 13px; color: #fff; }
  .message-metadata { margin-left: auto; font-size: 11px; color: #7d8292; }
  .chat-form { display: flex; flex-direction: column; gap: 8px; padding: 8px; border-top: 1px solid rgb(var(--gl-tint-light) / .08); }
  /* Foundry v14's <prose-mirror id="chat-message">, as foundry2.css lays it out */
  #chat-message { position: relative; display: flex; flex-direction: column; height: 118px; overflow: hidden; }
  /* the ProseMirror menu Foundry draws at the top of the sidebar's box */
  #chat-message > .mock-menu { flex: none; display: flex; gap: 2px; margin: 0 0 4px; padding: 0; list-style: none; }
  #chat-message > .mock-menu i { width: 24px; height: 22px; background: #24262f; border-radius: 3px; }
  #chat-message > .editor-container { flex: 1; position: relative; overflow: hidden; display: flex; flex-direction: column; margin: 0; padding: 0; border: 2px solid #3a3d4a; background: #24262f; border-radius: 6px; }
  #chat-message > .editor-container .editor-content { position: absolute; inset: 0; overflow: hidden auto; padding: 4px 8px 4px 8px; color: #e6e7ec; font-size: 14px; outline: 0; }
  #chat-message > .editor-container .editor-content p { margin: 0; }
  #chat-message > .editor-container:not(:focus-within):has(.editor-content > p:only-child > br:only-child)::after { content: var(--chat-message-placeholder, ""); position: absolute; inset: 0; pointer-events: none; display: grid; place-content: center; font-size: 16px; font-style: italic; color: #8a8e9c; }
  .states { display: grid; grid-template-columns: repeat(3, 300px); gap: 26px 40px; }
  .state h3 { margin: 0 0 6px; font: 600 11px/1.3 "Google Sans Flex", sans-serif; letter-spacing: .08em; color: var(--gl-text-dim); text-transform: uppercase; }
  .state .frame { position: relative; background: rgb(var(--gl-tint-dark) / .9); outline: 1px solid rgb(var(--gl-tint-light) / .08); }
  .state .frame.tall { padding-top: 260px; }
  .cards { display: grid; grid-template-columns: 560px; gap: 10px; }
  .cards .gluniverse-stream-chat-root { position: relative; width: auto; top: auto; left: auto; }
  /* the preview places the overlay layer inside the mock screen rather than over the window */
  .fvtt .glrp-layer, .fvtt .glrp-lane { position: absolute; }
</style></head><body>

<section class="sec"><h2>1 · A player's screen</h2>
  <div class="fvtt">
    <div class="map" id="scene"><div class="hotbar">${"<i></i>".repeat(10)}</div></div>
    <aside class="sidebar"><ol class="chat-log" id="log"></ol><form class="chat-form" id="main-form"></form></aside>
  </div>
</section>

<section class="sec"><h2>2 · The switch, state by state</h2><div class="states" id="states"></div></section>

<section class="sec"><h2>3 · On the stream</h2><div class="cards"><div class="gluniverse-stream-chat-root position-top-left" id="cards" style="--glus-rc-scale:.8"></div></div></section>

<script type="module">
import * as R from "/scripts/features/roleplay-chat/render.mjs";
import * as M from "/scripts/features/roleplay-chat/model.mjs";
import { readText } from "/scripts/features/stream-cards/text/read-text.js";
import { rpModeFlags } from "/scripts/core/rp-mode.mjs";
import { RollCard } from "/scripts/features/stream-cards/cards/roll-card.js";

const qs = new URLSearchParams(location.search);
const only = Number(qs.get("only"));
if (only) document.querySelectorAll("section.sec").forEach((s, i) => { if (i + 1 !== only) s.style.display = "none"; });
const $ = (s, r = document) => r.querySelector(s);
const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

const portrait = (a, b, skin, hair) => "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><path d="M40 200c4-46 30-70 60-70s56 24 60 70z" fill="' + skin + '" opacity=".9"/><ellipse cx="100" cy="84" rx="34" ry="40" fill="' + skin + '"/><path d="M64 80c0-30 18-46 38-46s36 16 36 44c-8-14-22-20-36-20s-28 8-38 22z" fill="' + hair + '"/></svg>');
const A = {
  seri: portrait("#3b5b8c", "#141c2c", "#e2b48f", "#2a1a12"), bram: portrait("#7a3d2a", "#1f120d", "#c08a65", "#5a3a1c"),
  ogre: portrait("#4a5a2a", "#151a0c", "#8f9a5a", "#2a2e18"), gob: portrait("#5a4a2a", "#18140c", "#9fb067", "#1f1f14"),
  ardo: portrait("#555a68", "#16181d", "#d1a383", "#7f7f86")
};
const L = {
  switchLabel: "Out of character or in character", ooc: "OOC", narrate: "Narrate", as: "As",
  sub: { say: "Say", do: "Do", think: "Think" }, source: { auto: "AUTO", pinned: "PINNED" }, chipTitle: "Choose who you are speaking as",
  pickerLabel: "Speakers", toggleHint: "OOC / IC", cycleHint: "Say, Do, Think",
  noSpeaker: "No character assigned. Ask your GM to assign one to speak in character."
};
const KEYS = { toggle: "Alt+Q", cycle: "Alt+W" };
const LABEL = { say: "Says", do: "Does", think: "Thinks", narrator: "Narrator" };
const PLACEHOLDER = { say: "Speak as {name}…", do: "What does {name} do?", think: "{name} thinks…", narrator: "Narrate the scene…", ooc: "Out of character…" };

/* ── the composer, as composer.mjs mounts it ── */
function composer(form, { state, speaker, gm = false, pickerOpen = false, picker = null, typed = "", slideFrom = null }) {
  const mode = M.composerMode(state, speaker ? (speaker.narrator ? "narrator" : "actor") : null);
  const bar = h('<div class="glrp-bar gl-type"></div>');
  bar.innerHTML = R.barHTML({ mode, canIc: Boolean(speaker), sub: state.sub, speaker: speaker && { ...speaker, source: gm ? speaker.source : null }, pickerOpen, picker, keys: KEYS }, L);
  bar.dataset.glrpMode = mode;
  // composer.mjs's slide, frozen part way so a still can show it (?slide=0..1, default 0.12).
  if (slideFrom) {
    const ink = $(".glrp-ink", bar);
    const at = Number($(".glrp-modes", bar).dataset.at);
    const from = ["ooc", "say", "do", "think"].indexOf(slideFrom);
    ink.style.setProperty("--glrp-from", String(from - at));
    ink.style.setProperty("--glrp-from-tone", "var(--glrp-" + slideFrom + ")");
    ink.classList.add("glrp-ink-slide");
    const pressed = $('.glrp-mode[aria-pressed="true"]', bar);
    for (const el of [ink, pressed]) {
      el.style.animationPlayState = "paused";
      el.style.animationDelay = "calc(var(--gl-d-brisk) * -" + (Number(qs.get("slide")) || 0.12) + ")";
    }
  }
  const input = h('<div id="chat-message" class="chat-input"><menu class="mock-menu">' + "<i></i>".repeat(6) + '</menu><div class="editor-container"><div class="editor-content"><p><br></p></div></div></div>');
  input.dataset.glrpMode = mode;
  input.style.setProperty("--chat-message-placeholder", M.cssString(PLACEHOLDER[mode].replace("{name}", speaker?.name ?? "")));
  input.style.setProperty("--glrp-head", M.cssString(M.composerHead({ mode, name: speaker?.name, label: LABEL[mode] })));
  input.style.setProperty("--glrp-speaker", M.cssString(speaker?.name ?? ""));
  if (typed) $(".editor-content > p", input).textContent = typed;
  form.append(bar, input);
}

/* ── the log, as log.mjs restyles Foundry's element ── */
function logEntry({ mode, name, img, body, time = "now" }) {
  const li = h('<li class="chat-message message flexcol"><header class="message-header flexrow"><h4 class="message-sender"></h4><span class="message-metadata"><time class="message-timestamp"></time></span></header><div class="message-content"></div></li>');
  $(".message-sender", li).textContent = name;
  $("time", li).textContent = time;
  $(".message-content", li).innerHTML = body;
  if (mode === "ooc") {
    li.classList.add("glrp-ooc");
    $(".message-sender", li).insertAdjacentHTML("afterend", R.oocTagHTML("OOC"));
    return li;
  }
  li.classList.add("glrp-msg");
  li.dataset.glrpMode = mode;
  const head = h('<div class="glrp-head-wrap"></div>');
  head.innerHTML = R.logHeadHTML({ mode, name, img, label: LABEL[mode] });
  $(".message-header", li).prepend(head);
  const content = $(".message-content", li);
  content.classList.add("glrp-body");
  if (mode === "do") content.innerHTML = R.leadHTML(name, content.innerHTML);
  // log.mjs rewrites the body's text nodes through the same lineHTML; a plain-text body is one node.
  if (mode === "say" && M.hasAsides(body)) {
    content.innerHTML = R.lineHTML("say", body);
    const edges = M.quoteEdges(M.asideRuns(body));
    if (!edges.opens) content.dataset.glrpOpen = "aside";
    if (!edges.closes) content.dataset.glrpClose = "aside";
  }
  return li;
}

/* ── the overlay, as overlay.mjs builds it ── */
function bubble(layer, x, y, mode, lines) {
  const place = mode === "do" ? "below" : "above";
  const el = h('<div class="glrp-bub glrp-bub--' + place + '"><div class="glrp-bub-stack"></div></div>');
  el.dataset.glrpMode = mode;
  const tail = R.bubbleTailHTML(mode);
  if (tail) el.append(h(tail));
  lines.forEach((line, i) => {
    const node = h(R.bubbleLineHTML({ mode, ...line }));
    if (i < lines.length - 1) node.classList.add("glrp-old");
    $(".glrp-bub-stack", el).append(node);
  });
  el.style.translate = x + "px " + y + "px";
  layer.append(el);
}

const scene = $("#scene");
const tok = (x, y, img, disp = "friendly") => scene.append(h('<div class="token" data-disp="' + disp + '" style="left:' + x + 'px;top:' + y + 'px"><img src="' + img + '"></div>'));
tok(400, 400, A.bram); tok(560, 480, A.seri); tok(800, 320, A.ogre, "hostile"); tok(960, 400, A.gob, "hostile");
const layer = h('<div class="glrp-layer gl-type"></div>');
scene.append(layer);
bubble(layer, 440, 400, "say", [{ name: "Bram Holt", text: "รอสัญญาณข้า On my mark." }, { name: "Bram Holt", text: "Hold the line! ถ้าโอเกอร์ตัวนั้นผ่านข้าไปได้ ให้วิ่งไปที่สะพาน" }]);
bubble(layer, 840, 320, "think", [{ name: "Ogre Warrior", text: "ตัวเล็ก ๆ กรอบดี Little ones. Crunchy." }]);
bubble(layer, 1000, 400, "say", [{ name: "Goblin Sneak", text: "Shiny! *snatches the coin* ของข้าแล้ว!" }]);
// The "…" over a token whose player is writing, as overlay.mjs places it: the token's top-right corner.
{
  const pill = h(R.typingHTML());
  pill.style.translate = "640px 480px";
  layer.append(pill);
}
bubble(layer, 600, 560, "do", [{ name: "Seri Valen", text: "draws her blade แล้วก้าวเข้าไปขวางระหว่าง Bram กับโอเกอร์" }]);
bubble(layer, 360, 160, "say", [{ name: "น้ำฝน", text: "ทุกคนระวัง! มีอะไรบางอย่างอยู่ใต้น้ำ" }]);
const lane = h('<div class="glrp-lane gl-type" style="bottom:74px"></div>');
[
  { mode: "say", name: "Captain Ardo", img: A.ardo, text: "กำลังเสริมจะมาถึงก่อนค่ำ *glances at the sky* if the bridge holds.", old: true },
  { mode: "narrator", name: "Narrator", img: null, text: "คบเพลิงริบหรี่ลง as something vast shifts beneath the water." }
].forEach((line) => {
  const el = h(R.laneLineHTML(line));
  el.dataset.glrpMode = line.mode;
  if (line.old) el.classList.add("glrp-old");
  lane.append(el);
});
scene.append(lane);

$("#log").append(
  logEntry({ mode: "ooc", name: "Tee", body: "แป๊บนะ ไปเอาน้ำก่อน brb, keep going", time: "2m ago" }),
  logEntry({ mode: "narrator", name: "Narrator", body: "คบเพลิงริบหรี่ลง as something vast shifts beneath the water." }),
  logEntry({ mode: "say", name: "Bram Holt", img: A.bram, body: "Hold the line! *raises his shield* ถ้าโอเกอร์ตัวนั้นผ่านข้าไปได้ ให้วิ่งไปที่สะพาน" }),
  logEntry({ mode: "say", name: "Seri Valen", img: A.seri, body: "*sighs* ก็ได้ Fine." }),
  logEntry({ mode: "do", name: "Seri Valen", img: A.seri, body: M.stripLeadName("Seri Valen", "Seri draws her blade แล้วก้าวเข้าไปขวางระหว่าง Bram กับโอเกอร์").body }),
  logEntry({ mode: "do", name: "น้ำฝน", img: A.ardo, body: M.stripLeadName("น้ำฝน", "น้ำฝน หยิบแผนที่ขึ้นมาดู and frowns.").body }),
  logEntry({ mode: "think", name: "Seri Valen", img: A.seri, body: "แผนนี้แย่มาก This is a terrible plan." }),
  logEntry({ mode: "say", name: "Unknown", img: A.ogre, body: "เจ้าไม่ควรมาที่นี่ You should not have come here." })
);
const SERI = { name: "Seri Valen", img: A.seri };
composer($("#main-form"), { state: { ic: true, sub: "think" }, speaker: SERI, typed: "เดี๋ยวนะ Is that a second ogre?" });

/* ── states ── */
const states = $("#states");
const state = (title, opts, tall = false) => {
  const wrap = h('<div class="state"><h3></h3><div class="frame' + (tall ? " tall" : "") + '"><form class="chat-form"></form></div></div>');
  $("h3", wrap).textContent = title;
  composer($("form", wrap), opts);
  states.append(wrap);
};
state("Player · OOC", { state: { ic: false, sub: "say" }, speaker: SERI, typed: "แป๊บนะ brb" });
state("Player · IC Say, typing", { state: { ic: true, sub: "say" }, speaker: SERI, typed: "Hold the line! *draws her blade* ถอยไปที่สะพาน" });
state("Player · IC Do, typing", { state: { ic: true, sub: "do" }, speaker: SERI, typed: "draws her blade แล้วก้าวออกไป" });
state("Player · IC Think, typing", { state: { ic: true, sub: "think" }, speaker: SERI, typed: "แผนนี้แย่มาก This is a terrible plan." });
state("Player · IC Say, empty", { state: { ic: true, sub: "say" }, speaker: SERI });
state("Player · IC Do, empty", { state: { ic: true, sub: "do" }, speaker: SERI });
state("Player · no character assigned", { state: { ic: true, sub: "say" }, speaker: null });
state("GM · Narrator, pinned", { state: { ic: true, sub: "say" }, speaker: { name: "Narrator", img: null, narrator: true, source: "pinned" }, gm: true });
state("Say to Think, the slab mid-slide", { state: { ic: true, sub: "think" }, speaker: SERI, slideFrom: "say" });
state("GM · Narrator, out of character", { state: { ic: false, sub: "say" }, speaker: { name: "Narrator", img: null, narrator: true, source: "auto" }, gm: true, typed: "Five minute break" });
state("GM · speaker picker open", {
  state: { ic: true, sub: "say" }, gm: true, pickerOpen: true,
  speaker: { name: "Ogre Warrior", img: A.ogre, source: "auto" },
  picker: { groups: [
    { heading: "Follow selection", rows: [{ key: "auto", name: "Ogre Warrior", img: A.ogre, selected: true, tag: "SELECTED" }] },
    { heading: "Pin a speaker", rows: [
      { key: "narrator", name: "Narrator", img: null },
      { key: "t1", name: "Goblin Sneak", img: A.gob },
      { key: "t3", name: "น้ำฝน", img: A.ardo },
      { key: "t2", name: "Captain Ardo", img: A.ardo, tag: "OFF SCENE" }
    ] }
  ] }
}, true);

/* ── the stream: through the real reader ── */
const LABELS = { Says: "Says", Does: "Does", Thinks: "Thinks", Narration: "Narration", Unknown: "Unknown", OutOfCharacter: "Out of character" };
const who = (name, img) => ({ name, isNpc: false, img, imgKind: "portrait", focus: null });
const lines = [
  ["say", 2, "Seri Valen", "On my mark.", who("Seri Valen", A.seri)],
  ["say", 2, "Bram Holt", "รอสัญญาณข้า!", who("Bram Holt", A.bram)],
  ["say", 2, "Bram Holt", "Hold the line! *raises his shield* Run!", who("Bram Holt", A.bram)],
  ["say", 2, "Seri Valen", "*sighs* ก็ได้ Fine.", who("Seri Valen", A.seri)],
  ["think", 2, "Bram Holt", "Not again…", who("Bram Holt", A.bram)],
  ["do", 3, "น้ำฝน", "พยักหน้า and smiles.", who("น้ำฝน", A.ardo)],
  ["say", 2, "Bram Holt", "Hold the line! ถ้าโอเกอร์ตัวนั้นผ่านข้าไปได้ ให้วิ่งไปที่สะพาน", who("Bram Holt", A.bram)],
  ["do", 3, "Seri Valen", "draws her blade แล้วก้าวเข้าไปขวางระหว่าง Bram กับโอเกอร์", who("Seri Valen", A.seri)],
  ["do", 3, "น้ำฝน", "หยิบแผนที่ขึ้นมาดู and frowns.", who("น้ำฝน", A.ardo)],
  ["think", 2, "Seri Valen", "แผนนี้แย่มาก This is a terrible plan.", who("Seri Valen", A.seri)],
  ["narrator", 2, "Narrator", "คบเพลิงริบหรี่ลง as something vast shifts beneath the water.", null],
  ["say", 2, "Ogre Warlord", "เจ้าไม่ควรมาที่นี่ You should not have come here.", { ...who(null, A.ogre), isNpc: true }]
];
for (const [mode, style, alias, content, actor] of lines) {
  const model = readText({ style, content, speaker: { alias }, flags: rpModeFlags(mode), whisper: [], blind: false }, { actor });
  const card = new RollCard({ ...model, kind: "text", visibility: "public", player: { name: mode === "narrator" ? "GM" : "Mint" } }, { label: (k) => LABELS[k] ?? k });
  $("#cards").append(card.element);
  card.setPending?.(false);
  card.element.dataset.tone = model.tone ?? "none";
}
window.__ready = true;
</script></body></html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`roleplay-chat-preview: wrote ${OUT}`);
