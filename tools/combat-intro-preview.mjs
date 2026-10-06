/**
 * tools/combat-intro-preview.mjs — write the Combat Intro visual-pass page.
 *
 * Drives the SHIPPED director, overlay, backdrop, skins, stylesheets and lang
 * file. Only the dice are a stand-in (the three.js d20 from
 * tools/spotlight-roll/die.mjs, since Dice So Nice cannot run outside
 * Foundry); their motion is the shipped tumble and their schedule the shipped
 * timeline, so what you judge for feel is what will run.
 *
 *   node tools/combat-intro-preview.mjs [--out=.preview/combat-intro.html]
 *   node tools/preview-server.mjs        # then /.preview/combat-intro.html
 *
 * SERVE it from the repository root: a file:// page does not execute its
 * module script. Seek, don't wait (the Browser pane throttles frames):
 *   ?skin=etched|aegis &phase=intro|rolling|sorting|handoff &seek=<ms>
 *   &view=gm|player|spectator &render=webgl|css &late=1 &threat=<severity|none>
 *   &dock=0
 * or window.__ciSeek(phase, ms) / window.__ciPlay(phase).
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice(6) : ".preview/combat-intro.html");
const THREE = "https://cdn.jsdelivr.net/npm/three@0.169.0";

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Combat Intro preview</title>
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" href="/styles/combat-intro.css">
<link rel="stylesheet" href="/styles/combat-intro-aegis.css">
<script type="importmap">{ "imports": { "three": "${THREE}/build/three.module.js", "three/addons/": "${THREE}/examples/jsm/" } }</script>
<style>
  /* Harness chrome only: none of this ships. */
  html, body { margin: 0; height: 100%; overflow: hidden; background: #05070a; color: var(--gl-text); font-family: var(--gl-display); }
  #board { position: fixed; inset: 0; background:
    radial-gradient(circle at 30% 40%, #2b3a2a, transparent 40%), radial-gradient(circle at 70% 60%, #3a2e22, transparent 45%), #151a14; }
  #board::after { content: ""; position: absolute; inset: 0; background:
    linear-gradient(90deg, rgb(var(--gl-tint-light) / 0.05) 1px, transparent 1px) 0 0 / 100px 100px,
    linear-gradient(rgb(var(--gl-tint-light) / 0.05) 1px, transparent 1px) 0 0 / 100px 100px; }
  #rail { position: fixed; right: 12px; top: 80px; width: 150px; height: 520px; border: 1px dashed rgb(var(--gl-tint-light) / 0.2); }
  #dock { position: fixed; z-index: 9999; left: 12px; top: 10px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
    max-width: calc(100vw - 32px); padding: 6px 8px; background: var(--gl-scrim); border: 1px solid var(--gl-hair); font: 12px var(--gl-tech); }
  #dock.hidden { display: none; }
  #dock button, #dock select { font: inherit; color: var(--gl-text); background: rgb(var(--gl-tint-light) / 0.06); border: 1px solid rgb(var(--gl-tint-light) / 0.14); padding: 3px 7px; cursor: pointer; }
  #perf { position: fixed; z-index: 9999; right: 10px; bottom: 8px; font: 11px var(--gl-tech); color: var(--gl-text-faint); }
  #err { position: fixed; z-index: 10000; left: 10px; top: 50px; max-width: 60vw; max-height: 60vh; overflow: auto; white-space: pre-wrap;
    font: 11px/1.4 var(--gl-tech); color: var(--gl-hazard-hot); background: rgb(0 0 0 / 0.85); padding: 8px; border: 1px solid var(--gl-hazard); }
</style>
</head>
<body>
<div id="board"></div>
<div id="rail"></div>
<div id="dock"></div>
<div id="perf"></div>
<pre id="err" class="err" hidden></pre>
<script type="module">
const showErr = (m) => { const el = document.getElementById("err"); el.hidden = false; el.textContent += m + "\\n"; };
window.addEventListener("error", (e) => showErr(e.message || e));
window.addEventListener("unhandledrejection", (e) => showErr(e.reason?.stack || e.reason));

const { Director } = await import("/scripts/features/combat-intro/director.mjs");
const { Backdrop } = await import("/scripts/features/combat-intro/backdrop.mjs");
const { default: overlay } = await import("/scripts/features/combat-intro/overlay.mjs");
const { skinFor } = await import("/scripts/features/combat-intro/skins/index.mjs");
const { normalizeState, publicSlot, sealResult } = await import("/scripts/features/combat-intro/state-model.mjs");
const TL = await import("/scripts/features/combat-intro/timeline.mjs");
const { PreviewDice } = await import("/tools/spotlight-roll/die.mjs");

const P = new URLSearchParams(location.search);
const opt = {
  skin: P.get("skin") || "etched", phase: P.get("phase") || "intro", seek: P.has("seek") ? Number(P.get("seek")) : null,
  view: P.get("view") || "gm", render: P.get("render") || "webgl", late: P.get("late") === "1", threat: P.get("threat") || "severe",
};
if (P.get("dock") === "0") document.getElementById("dock").classList.add("hidden");

/* i18n from the shipped lang file; a missing key shows itself */
const LANG = await fetch("/lang/combat-intro.en.json").then((r) => r.json()).catch(() => ({}));
const flat = {};
(function walk(o, p) { for (const [k, v] of Object.entries(o)) typeof v === "object" ? walk(v, p + k + ".") : (flat[p + k] = v); })(LANG, "");
const missing = new Set();
const t = (k) => (k in flat ? flat[k] : (missing.add(k), "\\u27E6" + k + "\\u27E7"));
const f = (k, d) => t(k).replace(/\\{(\\w+)\\}/g, (_, n) => d?.[n] ?? "{" + n + "}");
window.__ciMissing = missing;

/* portraits: drawn, so the page needs nothing from the network but three.
   Kept short: normalizeState clamps an image path to 400 characters. */
const portrait = (label, hue) => "data:image/svg+xml," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'><rect width='20' height='20' fill='hsl(" + hue + ",35%,22%)'/>"
  + "<circle cx='10' cy='8' r='4.2' fill='hsl(" + hue + ",45%,58%)'/><path d='M2 20Q10 10 18 20Z' fill='hsl(" + hue + ",40%,40%)'/></svg>");

const STATS = (o) => [["perception", "Perception", 7 + o], ["stealth", "Stealth", 5 + o], ["deception", "Deception", 3], ["diplomacy", "Diplomacy", 4], ["athletics", "Athletics", 6 + o],
  ["survival", "Survival", 2], ["arcana", "Arcana", 8], ["medicine", "Medicine", 5], ["lore-warfare", "Warfare Lore", 4]].map(([slug, label, mod]) => ({ slug, label, mod }));
const PCS = [["Seri Valecrest", 210, "u1"], ["Brannock", 30, "u2"], ["Ilya of the Ninth Gate", 280, "u3"], ["Tamsin Holloway", 140, "u4"]];
const NPCS = [["Goblin Warrior", 95, 3], ["Dire Wolf", 20, 2], ["Hobgoblin Warlord", 0, 1]];

function slots() {
  const out = [];
  PCS.forEach(([name, hue, owner], i) => out.push(publicSlot({ combatantId: "pc" + i, isPC: true, ownerId: owner, appearanceUserId: owner, name, img: portrait(name.split(" ")[0], hue),
    statistic: i === 1 ? "stealth" : "perception", locked: i === 2, stats: STATS(i), mods: i === 0 ? [{ slug: "scout", label: "Scout", value: 1, enabled: true }, { slug: "frightened", label: "Frightened", value: -1, enabled: false }] : [] })));
  let n = 0;
  for (const [name, hue, count] of NPCS) for (let k = 0; k < count; k++) out.push(publicSlot({ combatantId: "npc" + n++, isPC: false, name, img: portrait(name.split(" ").at(-1), hue), kind: { name, level: 2 }, statistic: "perception" }));
  return out;
}

const BASE = 1_700_000_000_000;
const TOTALS = new Map();
const NATS = new Map();
function buildState(phase) {
  const sl = slots().map((s, i) => {
    const nat = 1 + ((i * 7 + 11) % 20);
    NATS.set(s.id, nat);
    TOTALS.set(s.id, nat + (s.kind === "pc" ? 7 : 5));
    return s;
  });
  const late = opt.late ? sl[0].id : null;
  const rollAt = BASE;
  const at = phase === "intro" ? BASE : phase === "rolling" ? rollAt : phase === "sorting" ? BASE + 9000 : BASE + 12000;
  const shownSlots = late ? sl.filter((s) => s.id === late) : sl;
  const throwsUntil = phase === "rolling" ? Infinity : -Infinity;
  for (const [i, s] of shownSlots.entries()) {
    s.throw = { at: rollAt + 1300 + (s.kind === "pc" ? i * 380 : 1700 + i * 60), seed: 1000 + i * 17, seq: i + 1 };
  }
  const order = [...sl].sort((a, b) => TOTALS.get(b.id) - TOTALS.get(a.id) || (a.kind === "pc" ? -1 : 1)).map((s) => s.id);
  return normalizeState({
    id: "seq1", combatId: "c1", phase, at, skin: opt.skin, late,
    intro: late ? { title: "", party: [], hostiles: [] } : {
      title: "Ambush at the Gravel Ford",
      threat: opt.threat === "none" ? null : { severity: opt.threat, xp: 120, budget: 120 },
      party: PCS.map(([name, hue]) => ({ name, img: portrait(name.split(" ")[0], hue) })),
      hostiles: NPCS.map(([name, hue, count]) => ({ name, img: portrait(name.split(" ").at(-1), hue), count })),
    },
    slots: sl,
    order: phase === "sorting" || phase === "handoff" ? order : null,
  });
}

/* the stage */
const { root, layers } = overlay.createRoot(document);
document.body.insertBefore(root, document.getElementById("dock"));
const diceCanvas = document.createElement("canvas");
layers.dice.append(diceCanvas);
const dice = new PreviewDice(diceCanvas);
dice.warm();
const backdrop = new Backdrop(layers.bg);
const skin = skinFor(opt.skin);
const t0 = performance.now();
const ok = opt.render === "webgl" ? await backdrop.compile(skin) : false;
if (opt.render === "webgl" && !ok) showErr("backdrop failed: " + (backdrop.error ?? backdrop.report));
document.getElementById("perf").textContent = backdrop.report + " \\u00b7 " + Math.round(performance.now() - t0) + "ms";

function palette() {
  const probe = (name) => {
    const el = document.createElement("i"); el.style.color = "var(" + name + ")"; root.append(el);
    const m = getComputedStyle(el).color.match(/[\\d.]+/g)?.map(Number) ?? [255, 255, 255]; el.remove();
    return [m[0] / 255, m[1] / 255, m[2] / 255];
  };
  return { accent: probe("--glci-accent"), hot: probe("--glci-hot"), ink: probe("--glci-ink"), warn: probe("--glci-warn") };
}

const viewer = { userId: opt.view === "player" ? "u1" : "gm", isGM: opt.view === "gm", role: opt.view };
let clock = BASE, playing = false, last = performance.now();
const director = new Director({
  root, layers, overlay, dice, backdrop: opt.render === "webgl" ? backdrop : null, skin, ladder: null, i18n: { t, f }, palette, motion: 1,
  sound: null, now: () => performance.now(), serverNow: () => clock, viewer,
  mayAct: (s) => viewer.isGM || (s.kind === "pc" && s.ownerId === viewer.userId),
  onIntent: (i) => console.log("intent", i), onGm: (a, d) => console.log("gm", a, d),
  railRect: () => document.getElementById("rail").getBoundingClientRect(),
});

let state = null;
async function load(phase) {
  state = buildState(phase);
  await director.mount(state);
  director.setState(state, { totals: phase === "sorting" || phase === "handoff" ? TOTALS : null });
  for (const s of state.slots) {
    const full = { seqId: state.id, slotId: s.id, seq: s.throw?.seq ?? 0, at: s.throw?.at ?? 0, seed: s.throw?.seed ?? 1, sealed: false, natural: NATS.get(s.id), total: TOTALS.get(s.id), statistic: s.statistic, statLabel: "", mods: [] };
    if (!s.throw) continue;
    director.applyResult(viewer.isGM || s.kind === "pc" ? full : sealResult(full));
  }
}

window.__ciSeek = async (phase, ms) => {
  if (!state || state.phase !== phase) await load(phase);
  playing = false;
  clock = state.at + ms;
  director.seek(ms);
};
window.__ciPlay = async (phase) => {
  if (phase && (!state || state.phase !== phase)) await load(phase);
  director.play();
  clock = state.at; playing = true; last = performance.now();
};
window.__ciDirector = director;

function loop(now) {
  if (playing) clock += now - last;
  last = now;
  director.frame({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1 });
  requestAnimationFrame(loop);
}

/* dock */
const dockEl = document.getElementById("dock");
for (const ph of ["intro", "rolling", "sorting", "handoff"]) {
  const b = document.createElement("button"); b.textContent = "\\u25B6 " + ph; b.onclick = () => window.__ciPlay(ph); dockEl.append(b);
}
const sel = document.createElement("select");
for (const s of ["etched", "aegis"]) sel.add(new Option(s, s, false, s === opt.skin));
sel.onchange = () => { P.set("skin", sel.value); location.search = P.toString(); };
dockEl.append(sel);

if (opt.seek != null) await window.__ciSeek(opt.phase, opt.seek); else await window.__ciPlay(opt.phase);
requestAnimationFrame(loop);
document.documentElement.dataset.ready = "1";
</script>
</body>
</html>
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html);
console.log("wrote " + OUT);
