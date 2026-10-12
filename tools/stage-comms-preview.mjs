/**
 * tools/stage-comms-preview.mjs — write a live preview page for Stage's comms
 * call-in overlay.
 *
 * The page drives the REAL overlay (scripts/features/stage/comms/comms-overlay.mjs)
 * over the REAL stylesheets, never a lookalike — a preview built on a second
 * copy flatters whichever copy was touched last.
 *
 * Art is not in the repository: it uses whatever `tools/stage-preview.mjs
 * --assets=<dir>` copied into .preview/stage/{cast,bg} (gitignored).
 *
 *   node tools/stage-comms-preview.mjs [--out=.preview/stage-comms.html]
 *   node tools/preview-server.mjs           # then /.preview/stage-comms.html
 *
 * Serve it: a file:// page does not run its module script.
 *
 * URL parameters (all optional):
 *   style=holo|radio|clean   edge=right|left   align=top|center|bottom
 *   n=<calls>                how many characters are calling (1–6, default 3)
 *   cast=a,b,c               who is calling, by art name
 *   speaking=<index>         who is talking (0-based; -1 or absent = nobody)
 *   width= inset= shift=     the layout dials (model.mjs normalizeCommsLayout)
 *   visible=0                start hidden
 *   bg=<name>                backdrop
 *   face=0                   no head estimate: the stylesheet's fallback crop
 *   t=<ms>                   freeze every animation t ms after the state was set
 *                            (entrances run from 0; t=3000 is settled)
 *   act=leave|leave-first|join|hide|speak|silence
 *                            play one change after the entrances settle; t then
 *                            counts from the change
 *   ui=0                     hide the control strip (for screenshots)
 *   perf=light|none          the Performance feature's glass level (data-gl-perf)
 *   zoom=<k>                 magnify the page k× about the stack's edge, to inspect a card
 *
 * The art here has no face-locator result (that needs a Foundry world), so the
 * page gives each character the stage's own alpha-based head estimate as a
 * hand-placed face — the same path a GM's manual face point takes.
 *
 * window.__commsReady is true once the art is loaded and the state drawn.
 */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = resolve(ROOT, arg("out") ?? ".preview/stage-comms.html");
const ASSET_DIR = resolve(ROOT, ".preview/stage");

async function list(dir, exts) {
  try { return (await readdir(dir)).filter((f) => exts.includes(extname(f).toLowerCase())).sort(); } catch { return []; }
}
const cast = (await list(resolve(ASSET_DIR, "cast"), [".png", ".webp"])).map((f) => ({ name: basename(f, extname(f)), src: `/.preview/stage/cast/${f}` }));
const bgs = (await list(resolve(ASSET_DIR, "bg"), [".png", ".webp", ".jpg", ".jpeg"])).map((f) => ({ name: basename(f, extname(f)), src: `/.preview/stage/bg/${f}` }));
if (!cast.length || !bgs.length) console.warn("stage-comms-preview: no art in .preview/stage/{cast,bg} — run tools/stage-preview.mjs --assets=<dir> first");

/* Demo identities. Tints are the GM's per-character colour, i.e. data. */
const PEOPLE = {
  fox: { name: "Rennick", title: "Scout · Ridge Post", tint: "#ff8a3d" },
  noble: { name: "Count Aurel", title: "Envoy of the Court", tint: "#c9a2ff" },
  glasses: { name: "Ismay Vale", title: "Archivist", tint: "#5ec8ff" },
  warrior: { name: "Brannoc", title: "Captain of the Watch", tint: "#ff5a5a" },
  nun: { name: "Sister Cael", title: "", tint: "#f2e3b0" },
  trench: { name: "Halloway", title: "Informant", tint: "#7fd6a8" },
  demon: { name: "Vhessa", title: "The Bargainer", tint: "#ff3d7f" },
  elder: { name: "Elder Moro", title: "Keeper of the Well", tint: "#a7c4ff" },
};
const STRINGS = { "GLSTAGE.comms.live": "Live", "GLSTAGE.comms.transmit": "TX", "GLSTAGE.comms.channel": "CH" };

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Stage comms preview</title>
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" href="/styles/stage-comms.css">
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  #bg { position: fixed; inset: 0; background-size: cover; background-position: center; }
  #bg::after { content: ""; position: absolute; inset: 0;
    background: radial-gradient(120% 90% at 40% 45%, rgb(0 0 0 / 0.05), rgb(0 0 0 / 0.55)), linear-gradient(rgb(0 0 0 / 0.18), rgb(0 0 0 / 0.3)); }
  #ui { position: fixed; left: 8px; top: 8px; z-index: 500; display: flex; flex-wrap: wrap; gap: 4px; max-width: 60vw;
        font: 12px system-ui; color: #ddd; background: rgb(0 0 0 / 0.6); padding: 6px; border-radius: 4px; }
  #ui button { font: inherit; }
  #ui .sep { width: 100%; height: 0; }
  #err { position: fixed; left: 8px; bottom: 8px; z-index: 600; color: #f88; font: 12px monospace; white-space: pre; }
</style></head>
<body>
<div id="bg"></div>
<div id="host"></div>
<div id="ui"></div>
<pre id="err"></pre>
<script type="module">
const CAST = ${JSON.stringify(cast)};
const BGS = ${JSON.stringify(bgs)};
const PEOPLE = ${JSON.stringify(PEOPLE)};
const STRINGS = ${JSON.stringify(STRINGS)};
const q = new URLSearchParams(location.search);
const err = (m) => { document.getElementById("err").textContent += m + "\\n"; };
window.onerror = (m) => err(String(m));
window.onunhandledrejection = (e) => err(String(e.reason));

// Freeze: t ms after the state is set, every animation is paused where it is.
// The overlay's own class timers run as they would at the table.
const frozen = q.has("t") ? Math.max(0, Number(q.get("t")) || 0) : null;
// Timers still pending at the freeze are cancelled, so a class the overlay
// would have removed later (an entrance's) keeps its paused animation.
const pending = new Set();
if (frozen !== null) {
  const set = window.setTimeout.bind(window);
  window.setTimeout = (fn, ms, ...args) => {
    const id = set(() => { pending.delete(id); fn(...args); }, ms);
    pending.add(id);
    return id;
  };
}

const { CommsOverlay } = await import("/scripts/features/stage/comms/comms-overlay.mjs");
const { normalizeComms, normalizeCommsLayout, normalizeCast } = await import("/scripts/features/stage/model.mjs");
const { prepareArt } = await import("/scripts/features/stage/render/assets.mjs");

const bg = BGS.find((b) => b.name === q.get("bg")) ?? BGS.find((b) => b.name === "gate") ?? BGS[0];
if (bg) document.getElementById("bg").style.backgroundImage = "url(" + bg.src + ")";
if (q.get("ui") === "0") document.getElementById("ui").style.display = "none";
if (q.has("perf")) document.documentElement.dataset.glPerf = q.get("perf");
if (Number(q.get("zoom")) > 1) {
  const z = Number(q.get("zoom"));
  const ax = q.get("edge") === "left" ? "0%" : "100%";
  const ay = { top: "0%", bottom: "100%" }[q.get("align")] ?? "50%";
  document.body.style.cssText += ";transform:scale(" + z + ");transform-origin:" + ax + " " + ay;
}

const load = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
const order = ["fox", "noble", "glasses", "warrior", "nun", "trench", "demon", "elder"];
const names = (q.get("cast") ?? "").split(",").filter(Boolean);
const pool = [...names, ...order.filter((n) => !names.includes(n)), ...CAST.map((c) => c.name)].filter((n, i, a) => a.indexOf(n) === i && CAST.some((c) => c.name === n));

const useFace = q.get("face") !== "0";
const members = [];
for (const n of pool) {
  const art = CAST.find((c) => c.name === n);
  const who = PEOPLE[n] ?? { name: n.replace(/^./, (s) => s.toUpperCase()), title: "", tint: "#6b86d6" };
  let face = null;
  if (useFace) {
    try {
      // The stage's alpha estimate marks the top of the silhouette — on this
      // art, hair and ears. Nudged down and grown to the whole head, which is
      // roughly where the face locator lands at the table.
      const h = prepareArt(await load(art.src)).info.head;
      face = { x: h.x, y: h.y + h.h * 0.85, h: h.h * 1.6 };
    } catch (e) { err("art " + n + ": " + e); }
  }
  members.push({ id: n, name: who.name, title: who.title, tint: who.tint, image: art.src, face });
}
const cast = normalizeCast(members);
await Promise.all(cast.map((m) => load(m.image).catch(() => null)));

const state = {
  calls: pool.slice(0, Math.max(0, Math.min(6, Number(q.get("n") ?? 3)))),
  speaking: Number(q.get("speaking") ?? -1),
  visible: q.get("visible") !== "0",
  layout: normalizeCommsLayout({
    style: q.get("style") ?? undefined, edge: q.get("edge") ?? undefined, align: q.get("align") ?? undefined,
    width: q.has("width") ? Number(q.get("width")) : undefined,
    inset: q.has("inset") ? Number(q.get("inset")) : undefined,
    shift: q.has("shift") ? Number(q.get("shift")) : undefined,
  }),
};

const t = (key) => STRINGS[key] ?? key.split(".").pop();
const overlay = new CommsOverlay(document.getElementById("host"), { t });
window.__comms = { overlay, state, render };

function render() {
  const comms = normalizeComms({
    visible: state.visible,
    calls: state.calls.map((castId) => ({ castId, callId: "call-" + castId })),
    speaking: state.speaking >= 0 && state.calls[state.speaking] ? "call-" + state.calls[state.speaking] : null,
  }, cast.map((m) => m.id));
  overlay.update({ comms, layout: state.layout, cast });
}
render();
if (q.get("debug") === "1") err("rendered at " + document.timeline.currentTime + " root=" + overlay.root.className);

// act=: one change played once the entrances have settled, so an exit, a hide
// or a change of speaker can be frozen too (t then counts from the change).
const ACTS = {
  leave: () => { state.calls.pop(); },
  "leave-first": () => { state.calls.shift(); state.speaking = Math.max(-1, state.speaking - 1); },
  join: () => { const next = pool.find((n) => !state.calls.includes(n)); if (next) state.calls.push(next); },
  hide: () => { state.visible = false; },
  speak: () => { state.speaking = state.calls.length ? (state.speaking + 1) % state.calls.length : -1; },
  silence: () => { state.speaking = -1; },
};
let floor = -Infinity;
if (ACTS[q.get("act")]) {
  await new Promise((r) => setTimeout(r, 2400));
  await new Promise((r) => requestAnimationFrame(r));
  floor = document.timeline.currentTime;
  ACTS[q.get("act")]();
  render();
  if (q.get("debug") === "1") err("acted at " + floor + " root=" + overlay.root.className + " slots=" + [...overlay.stack.children].map((c) => c.className).join(","));
}

// Each animation is SEEKED to where it would be t ms after the entrances (or
// the act) began, rather than paused when a timer says so: under headless
// virtual time the animation clock lags the timers, and a pause catches an
// entrance unstarted.
if (frozen !== null) {
  await new Promise((r) => setTimeout(r, frozen));
  for (const id of pending) clearTimeout(id);
  pending.clear();
  const anims = document.getAnimations();
  const starts = anims.map((a) => a.startTime).filter((v) => Number.isFinite(v) && v >= floor);
  const ref = starts.length ? Math.min(...starts) : document.timeline.currentTime;
  if (q.get("debug") === "1") err("ref=" + ref + " now=" + document.timeline.currentTime + " | " + anims.slice(0, 8).map((a) => (a.animationName ?? a.transitionProperty) + "@" + a.startTime).join(" | "));
  for (const a of anims) {
    const start = Number.isFinite(a.startTime) ? a.startTime : ref;
    a.pause();
    a.currentTime = Math.max(0, ref + frozen - start);
  }
}
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
window.__commsReady = true;

// Controls.
const ui = document.getElementById("ui");
const button = (label, fn) => { const b = document.createElement("button"); b.textContent = label; b.onclick = () => { fn(); render(); }; ui.append(b); };
const relink = (patch) => { const u = new URLSearchParams(location.search); for (const [k, v] of Object.entries(patch)) v === null ? u.delete(k) : u.set(k, v); location.search = u; };
button("+ call", () => { const next = pool.find((n) => !state.calls.includes(n)); if (next && state.calls.length < 6) state.calls.push(next); });
button("− last", () => { state.calls.pop(); });
button("− first", () => { state.calls.shift(); state.speaking = Math.min(state.speaking, state.calls.length - 1); });
button("− middle", () => { state.calls.splice(Math.floor(state.calls.length / 2), 1); });
button("next speaker", () => { state.speaking = state.calls.length ? (state.speaking + 1) % state.calls.length : -1; });
button("silence", () => { state.speaking = -1; });
button("show / hide", () => { state.visible = !state.visible; });
ui.append(Object.assign(document.createElement("span"), { className: "sep" }));
for (const s of ["holo", "radio", "clean"]) button("style:" + s, () => { state.layout = { ...state.layout, style: s }; });
for (const e of ["right", "left"]) button("edge:" + e, () => { state.layout = { ...state.layout, edge: e }; });
for (const a of ["top", "center", "bottom"]) button("align:" + a, () => { state.layout = { ...state.layout, align: a }; });
for (const w of [140, 188, 260]) button("width:" + w, () => { state.layout = { ...state.layout, width: w }; });
ui.append(Object.assign(document.createElement("span"), { className: "sep" }));
for (const b of BGS) { const el = document.createElement("button"); el.textContent = "bg:" + b.name; el.onclick = () => relink({ bg: b.name }); ui.append(el); }
</script>
</body></html>
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html);
console.log(`wrote ${OUT} — ${cast.length} cast, ${bgs.length} backdrops. Serve: node tools/preview-server.mjs, then /${OUT.slice(ROOT.length).replace(/\\/g, "/")}`);
