#!/usr/bin/env node
/**
 * Destiny Dice — a browser-backed look at everything the feature draws.
 *
 * The page IMPORTS the shipped modules and links the shipped stylesheet and
 * lang file, so what you judge is what ships:
 *   • chat: real PF2e-shaped check cards, each strip attached by the shipped
 *     `renderChatMessageHTML` handler and arriving on the shipped timeline;
 *     a degree shift, a plain complication, a blank, an opportunity, an old
 *     refused fate, and the same shift for a player whose table hides outcomes;
 *   • dialog: PF2e's check dialog with the switch injected by the shipped hook;
 *   • config: the face config window, drawn by the shipped pure view;
 *   • die: the six face maps `buildPreset` hands Dice So Nice, each loaded back
 *     through an <img> the way DSN loads it (so the `#face.png` data-URL trick is
 *     proved in a real browser), and a CSS cube wearing them;
 *   • checks=1: runs the shared Insight/Destiny browser motion checks.
 *
 * Serve it (a file:// page does not run its module script):
 *
 *   node tools/destiny-dice-preview.mjs && node tools/preview-server.mjs 8981
 *   → http://localhost:8981/.preview/destiny.html?view=all&preset=default
 *
 * Params: view=all|chat|dialog|config|die, preset=default|aegis-fallen|tides-of-destiny,
 * tier=reduced|default|cinematic, glow=0..2, checks=1.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice("--out=".length) : ".preview/destiny.html");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Destiny Dice preview</title>
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" href="/styles/destiny-dice.css">
<link rel="stylesheet" href="/styles/insight.css">
<style>
  body { margin: 0; background: #101116; color: #d6d7de; font: 14px "Signika", "Segoe UI", sans-serif; }
  main { display: flex; flex-wrap: wrap; gap: 28px; padding: 24px; align-items: flex-start; }
  h2 { font: 600 11px "Segoe UI", sans-serif; letter-spacing: .1em; text-transform: uppercase; color: #6a6d7c; margin: 0 0 8px; }
  .col { display: grid; gap: 10px; align-content: start; }
  /* A Foundry chat log at its real width and type size. */
  .log { width: 300px; font-size: 14px; list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .message { background: #1c1d24; border: 1px solid #33343e; border-radius: 4px; padding: 6px 8px 8px; }
  .message header { display: flex; justify-content: space-between; font-weight: 600; color: #e6e6ec; margin-bottom: 4px; }
  .message header small { color: #8b8d99; font-weight: 400; }
  .flavor { color: #a9abb7; font-size: 13px; margin-bottom: 6px; }
  .dice-total { text-align: center; font-size: 22px; font-weight: 700; padding: 3px; background: #2a2b33; border: 1px solid #3c3d48; border-radius: 3px; }
  .note { font-size: 11px; color: #6a6d7c; margin: 2px 0 0; }
  .dialog { width: 420px; background: #1c1d24; border: 1px solid #33343e; padding: 10px 12px; font-size: 13px; }
  .dialog .row { display: flex; justify-content: space-between; padding: 3px 0; color: #c9cad3; }
  .dialog hr { border: 0; border-top: 1px solid #33343e; margin: 8px 0; }
  .dialog button { width: 100%; height: 30px; background: #2a2b33; color: #e6e6ec; border: 1px solid #44454f; }
  .window { width: 640px; background: #0c0d12; border: 1px solid #2c2d37; box-shadow: 0 12px 40px #000a; }
  .window > header { height: 30px; display: flex; align-items: center; gap: 8px; padding: 0 10px; background: #15161d; color: #e6e6ec; font-weight: 600; border-bottom: 1px solid #2c2d37; }
  .sheet { display: grid; grid-template-columns: repeat(6, 132px); gap: 10px; }
  .sheet figure { margin: 0; display: grid; gap: 4px; font-size: 11px; color: #8b8d99; }
  .sheet img, .sheet canvas { width: 132px; height: 132px; display: block; background: #05060a; }
  .sheet .lbl { background: repeating-conic-gradient(#1a1b22 0 25%, #121318 0 50%) 0 0 / 16px 16px; }
  .stage { perspective: 700px; width: 220px; height: 220px; display: grid; place-items: center; }
  .cube { width: 120px; height: 120px; position: relative; transform-style: preserve-3d; animation: ddp-spin 9s linear infinite; }
  .cube canvas { position: absolute; inset: 0; width: 120px; height: 120px; border-radius: 10px; }
  @keyframes ddp-spin { from { transform: rotateX(-24deg) rotateY(0deg); } to { transform: rotateX(-24deg) rotateY(360deg); } }
  #status { font: 12px Consolas, monospace; color: #8b8d99; white-space: pre-wrap; }
  #status.bad { color: #ff6b74; }
  [hidden] { display: none !important; }
</style></head>
<body>
<main>
  <section class="col" data-view="chat"><h2>Chat</h2><ol class="log" id="log"></ol></section>
  <section class="col" data-view="dialog"><h2>Check dialog</h2><div id="dialogs" class="col"></div></section>
  <section class="col" data-view="config"><h2>Face config</h2><form class="window glddf-face-config"><header><i class="fa-solid fa-dice-d6"></i> Fate Die Faces</header><div class="window-content" id="cfg"></div></form>
    <form class="window glddf-face-config"><header>Fate Die Faces (edited: face 3 a +1 complication, face 6 a custom image)</header><div class="window-content" id="cfg2"></div></form></section>
  <section class="col" data-view="die"><h2>Die faces handed to Dice So Nice</h2><div class="sheet" id="sheet"></div>
    <div class="stage"><div class="cube" id="cube"></div></div></section>
  <pre id="status">loading…</pre>
</main>
<script type="module">
const q = new URLSearchParams(location.search);
const view = q.get("view") ?? "all";
const preset = q.get("preset") ?? "default";
const tier = q.get("tier") ?? "default";
const glow = Number(q.get("glow") ?? 1);
for (const s of document.querySelectorAll("[data-view]")) s.hidden = view !== "all" && s.dataset.view !== view;

const labels = {};
const manifest = await fetch("/module.json").then((r) => r.json());
for (const lang of manifest.languages) Object.assign(labels, await fetch("/" + lang.path).then((r) => r.json()));
const fmt = (key, data) => (labels[key] ?? key).replace(/\\{(\\w+)\\}/g, (_, k) => data?.[k] ?? "");
const settings = new Map([["dd.preset", preset], ["dd.motionTier", tier], ["dd.emissiveIntensity", glow]]);
const hooks = {};
globalThis.game = {
  user: { id: "u1", isGM: true },
  settings: { get: (_id, key) => settings.get(key) },
  i18n: { localize: (k) => fmt(k), format: fmt },
  pf2e: { settings: { metagame: { results: true } } },
};
globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); }, once() {}, callAll() {} };
globalThis.ui = { notifications: { info() {}, error: console.error, warn: console.warn } };

const status = [];
const say = (line, bad = false) => { status.push(line); const el = document.getElementById("status"); el.textContent = status.join("\\n"); if (bad) el.classList.add("bad"); };

try {
  const { registerFateRendering } = await import("/scripts/features/destiny-dice/fate-result.mjs");
  const { registerPF2eIntegration } = await import("/scripts/features/destiny-dice/pf2e-integration.mjs");
  const view_ = await import("/scripts/features/destiny-dice/view.mjs");
  const { buildPreset, IMAGE_TEST } = await import("/scripts/features/destiny-dice/dsn.mjs");
  const settingsMod = await import("/scripts/features/destiny-dice/settings.mjs");
  registerFateRendering();
  registerPF2eIntegration();

  /* ── chat ── */
  const now = Date.now();
  const cards = [
    { who: "Ezren", what: "Arcana Check", total: 19, fate: { face: 1, kind: "complication", bonus: 4, before: "failure", after: "success" } },
    { who: "Valeros", what: "Athletics Check", total: 24, fate: { face: 2, kind: "complication", bonus: 2, before: "success", after: "success" } },
    { who: "Kyra", what: "Will Save", total: 17, fate: { face: 3, kind: "blank", bonus: 0, before: "success", after: "success" } },
    { who: "Merisiel", what: "Stealth Check", total: 31, fate: { face: 5, kind: "opportunity", bonus: 0, before: "criticalSuccess", after: "criticalSuccess" } },
    { who: "Seoni", what: "Diplomacy Check", total: 12, fate: { face: 6, kind: "opportunity", bonus: 0, accepted: false }, note: "an old refused fate" },
    { who: "Ezren", what: "Arcana Check", total: 19, fate: { face: 1, kind: "complication", bonus: 4, before: "failure", after: "success" }, player: true, note: "a player, table hides outcomes: no shift line" },
  ];
  const log = document.getElementById("log");
  cards.forEach((c, i) => {
    const el = document.createElement("li");
    el.className = "message";
    el.innerHTML = '<header>' + c.who + '<small>now</small></header><div class="message-content"><div class="flavor">' + c.what + '</div><div class="dice-total">' + (c.total + (c.fate.bonus || 0)) + '</div></div>';
    log.append(el);
    if (c.note) log.insertAdjacentHTML("beforeend", '<p class="note">' + c.note + '</p>');
    game.user.isGM = !c.player;
    game.pf2e.settings.metagame.results = !c.player;
    const fate = { ...c.fate, appliedAt: now + i * 10, source: "dialog" };
    const message = { id: "m" + i, isContentVisible: true, getFlag: () => fate };
    for (const fn of hooks.renderChatMessageHTML ?? []) fn(message, el);
  });
  game.user.isGM = true;
  game.pf2e.settings.metagame.results = true;

  /* ── dialog ── */
  for (const checked of [false, true]) {
    const wrap = document.createElement("div");
    wrap.className = "dialog";
    wrap.innerHTML = '<form><div class="row"><span>Athletics</span><span>+12</span></div><div class="row"><span>Status: Heroism</span><span>+1</span></div><hr><div class="roll-twice row"><span>Keep higher · Normal · Keep lower</span></div><hr><div class="row"><span>Roll mode</span><span>Public</span></div><hr><button type="submit">Roll (+13)</button></form>';
    document.getElementById("dialogs").append(wrap);
    const context = { actor: { isOfType: () => true }, type: "skill-check", options: new Set(checked ? ["glddf:fated-roll"] : []) };
    for (const fn of hooks.renderCheckModifiersDialog ?? []) fn({ context, setPosition() {} }, wrap);
    say("dialog " + (checked ? "on" : "off") + ": switch " + (wrap.querySelector(".glddf-fated-roll-toggle input")?.checked === checked ? "matches context" : "WRONG"), wrap.querySelector(".glddf-fated-roll-toggle input")?.checked !== checked);
  }

  /* ── config ── */
  const t = settingsMod.t;
  document.getElementById("cfg").innerHTML = view_.renderFaceConfig(view_.faceConfigModel({ faces: settingsMod.faces(), preset, t }));
  const edited = settingsMod.faces().map((f) => f.face === 3 ? { ...f, kind: "complication", bonus: 1 } : f.face === 6 ? { ...f, image: "worlds/demo/fate-6.png" } : f);
  document.getElementById("cfg2").innerHTML = view_.renderFaceConfig(view_.faceConfigModel({ faces: edited, preset, t }));

  /* ── die ── */
  const encode = (pixels, size) => {
    const c = document.createElement("canvas"); c.width = c.height = size;
    c.getContext("2d").putImageData(new ImageData(pixels, size, size), 0, 0);
    return c.toDataURL("image/png");
  };
  const p = buildPreset({ faces: settingsMod.faces(), preset, intensity: glow, encode });
  const load = (src) => new Promise((ok, no) => { const img = new Image(); img.crossOrigin = "Anonymous"; img.onload = () => ok(img); img.onerror = () => no(new Error("no load")); img.src = src; });
  const sheet = document.getElementById("sheet");
  const cube = document.getElementById("cube");
  const turns = ["rotateY(0deg)", "rotateY(90deg)", "rotateY(180deg)", "rotateY(-90deg)", "rotateX(90deg)", "rotateX(-90deg)"];
  let ok = 0;
  for (let i = 0; i < 6; i++) {
    const urls = [p.labels[i], p.bumpMaps[i], p.emissiveMaps?.[i]].filter(Boolean);
    const passes = urls.every((u) => IMAGE_TEST.test(u));
    const imgs = await Promise.all(urls.map(load));
    if (passes) ok++;
    const fig = document.createElement("figure");
    fig.innerHTML = '<span>face ' + (i + 1) + '</span>';
    const [label, bump, emissive] = imgs;
    label.className = "lbl"; fig.append(label, bump); if (emissive) fig.append(emissive);
    sheet.append(fig);
    // A stand-in for the lit die: black glass, the bump's solid band darkened, the glyph and its glow.
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const g = c.getContext("2d");
    g.fillStyle = "#0a0b11"; g.fillRect(0, 0, 256, 256);
    g.globalAlpha = 0.35; g.drawImage(bump, 0, 0); g.globalAlpha = 1;
    g.drawImage(label, 0, 0);
    if (emissive) { g.globalCompositeOperation = "lighter"; g.filter = "blur(6px)"; g.drawImage(emissive, 0, 0); g.filter = "none"; g.drawImage(emissive, 0, 0); g.globalCompositeOperation = "source-over"; }
    c.style.transform = turns[i] + " translateZ(60px)";
    cube.append(c);
  }
  say("die: " + ok + "/6 faces pass DSN's image test and load as <img>; " + p.unique + " unique bakes; emissive " + (p.emissiveMaps ? "on" : "off (black)"), ok !== 6);

  if (q.get("checks") === "1") {
    const { runInsightDestinyMotionChecks } = await import("/tools/insight-destiny-browser-check.mjs");
    const res = await runInsightDestinyMotionChecks();
    say("browser checks PASS: " + res.passed + "\\n" + res.assertions.join("\\n"));
  }
  say("ready");
} catch (e) {
  say("ERROR " + (e.stack ?? e), true);
}
</script>
</body></html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT}`);
