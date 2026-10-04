/**
 * tools/theatre-preview.mjs — write a live preview page for Theatre transitions.
 *
 * A Theatre cut is three renderers agreeing on one clock: the PIXI shot layer,
 * the DOM title overlay and (in a live world) Stage. None of it is visible in a
 * diff, so the page drives the REAL modules — never a lookalike, which would
 * flatter whichever copy was touched last:
 *
 *   scripts/features/theatre/overlay/title-overlay.mjs   (the DOM half)
 *   scripts/features/theatre/render/shot-renderer.mjs    (the image half, PIXI v7)
 *   scripts/features/theatre/timeline.mjs / constants.mjs / model.mjs
 *   styles/gl-fonts.css, gl-tokens.css, gl-motion.css, theatre.css
 *
 * Shots come from .preview/theatre/*.webp|png (gitignored sample art).
 *
 *   node tools/theatre-preview.mjs [--out=.preview/theatre.html]
 *   node tools/preview-server.mjs        # then /.preview/theatre.html
 *
 * SERVE it from the repository root: a file:// page does not execute its module
 * script, and a server rooted anywhere else cannot resolve the imports.
 *
 * If the shot renderer is missing or fails to construct (no WebGL, PIXI not
 * reachable), the page falls back to a plain <img> crossfade and says so on
 * screen — the overlay is still the real one.
 *
 * Inspection hooks (the Browser pane throttles frames — seek, don't wait):
 *   window.__theatreSeek(ms)   replay the current cue and freeze every beat at ms
 *   window.__theatrePlay()     run on from the frozen point
 *   window.__theatreCue({ style, face, letterbox, tag, kind, shot })  fire a cue
 */
import { readdir, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice(6) : ".preview/theatre.html");

const ART_DIR = resolve(ROOT, ".preview/theatre");
let art = [];
try { art = (await readdir(ART_DIR)).filter((f) => /\.(webp|png|jpe?g)$/i.test(f)).sort(); } catch { /* none */ }

// Sample copy for the bundled art; any other file gets its de-slugged name.
const COPY = {
  "fane-of-the-wilds": { eyebrow: "Act I", title: "Fane of the Wilds", subtitle: "Dusk · The old shrine road" },
  "bolt-beacon": { eyebrow: "Three days later", title: "Night Ridge", subtitle: "The beacon at Varrow Keep" },
  "eclipse": { eyebrow: "Act II", title: "The Eclipse", subtitle: "When the sun went out" },
  "art-sample": { eyebrow: "Interlude", title: "Hollow Market", subtitle: "Midday · Lower Ward" },
};
const ORDER = ["fane-of-the-wilds", "bolt-beacon", "eclipse", "art-sample"];
art.sort((a, b) => {
  const ia = ORDER.indexOf(a.replace(/\.[^.]+$/, "")), ib = ORDER.indexOf(b.replace(/\.[^.]+$/, ""));
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
});
const SHOTS = art.map((f, i) => {
  const stem = f.replace(/\.[^.]+$/, "");
  const copy = COPY[stem] ?? { eyebrow: "", title: stem.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), subtitle: "" };
  return { id: `p${i}`, src: `/.preview/theatre/${f}`, ...copy };
});

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Theatre preview</title>
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" href="/styles/theatre.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/pixi.js/7.4.2/pixi.min.js"></script>
<style>
  /* Harness chrome only — none of this ships. */
  html, body { margin: 0; height: 100%; overflow: hidden; background: rgb(var(--gl-tint-dark)); color: var(--gl-text); font-family: var(--gl-display); }
  #frame { position: fixed; inset: 0; z-index: 0; overflow: hidden; }
  #frame canvas { display: block; width: 100%; height: 100%; }
  #frame .fb { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; }
  /* Stand-in for Stage's overlay, at its real z-index, so the stacking is visible. */
  #stage-standin { position: fixed; left: 50%; bottom: 0; translate: -50% 0; width: 46vw; height: 9vh; z-index: 1; pointer-events: none;
    border-top: 1px dashed rgb(var(--gl-tint-light) / 0.25); display: none; }
  body.show-stage #stage-standin { display: block; }
  #dock { position: fixed; z-index: 50; left: 50%; top: 10px; translate: -50% 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
    max-width: calc(100vw - 32px); box-sizing: border-box; padding: 8px 10px; background: var(--gl-scrim); border: 1px solid var(--gl-hair);
    font-size: var(--gl-fs-sm); }
  #dock.hidden { display: none; }
  #dock button, #dock select { font: inherit; font-size: var(--gl-fs-sm); color: var(--gl-text); background: rgb(var(--gl-tint-light) / 0.06);
    border: 1px solid rgb(var(--gl-tint-light) / 0.14); padding: 4px 8px; cursor: pointer; }
  #dock button.on { border-color: var(--gl-accent); background: color-mix(in srgb, var(--gl-accent) 28%, transparent); }
  #dock label { color: var(--gl-text-dim); display: flex; gap: 5px; align-items: center; }
  #dock .sep { width: 1px; height: 20px; background: rgb(var(--gl-tint-light) / 0.14); }
  #thumbs { display: flex; gap: 4px; }
  #thumbs img { width: 60px; height: 34px; object-fit: cover; border: 1px solid transparent; cursor: pointer; opacity: 0.7; }
  #thumbs img.on { border-color: var(--gl-accent); opacity: 1; }
  #note { position: fixed; z-index: 50; left: 12px; bottom: 10px; font-family: var(--gl-tech); font-size: var(--gl-fs-xs); color: var(--gl-text-dim); }
  #note.warn { color: var(--gl-amber, var(--gl-text)); }
</style>
</head>
<body>
<div id="frame"></div>
<div id="stage-standin"></div>
<div id="dock">
  <div id="thumbs"></div><span class="sep"></span>
  <span id="styles"></span><span class="sep"></span>
  <label>Face <select id="face"></select></label>
  <label>Letterbox <select id="lb"><option value="0">0</option><option value="0.06">0.06</option><option value="0.09">0.09</option><option value="0.12">0.12</option></select></label>
  <label>Motion <select id="ms"><option value="0.6">reduced</option><option value="1" selected>default</option><option value="1.4">cinematic</option></select></label>
  <label><input type="checkbox" id="tg"> Tag</label>
  <label><input type="checkbox" id="st"> Settle</label>
  <label><input type="checkbox" id="sg"> Stage z</label>
  <span class="sep"></span>
  <button id="replay">Replay</button><button id="again">Re-announce</button><button id="card">Card</button><button id="black">Black</button><button id="clear">Clear</button>
</div>
<div id="note"></div>

<script type="module">
import { TitleOverlay } from "/scripts/features/theatre/overlay/title-overlay.mjs";
import { timelineFor, scaleTimeline } from "/scripts/features/theatre/timeline.mjs";
import { FACES, FACE_KEYS, STYLES, FRAME, TIMING } from "/scripts/features/theatre/constants.mjs";
import { normalizeShot, titleOf, hasTitle } from "/scripts/features/theatre/model.mjs";

const SHOTS = ${JSON.stringify(SHOTS)}.map((s, i) => normalizeShot(s, i));
const CARD_TEXT = "Three days later\\u2026";
const $ = (s) => document.querySelector(s);
const note = (msg, warn = false) => { $("#note").textContent = msg; $("#note").classList.toggle("warn", warn); };

/* ── the image half ─────────────────────────────────────────────────── */
let renderer = null, app = null, frozen = false;
const fallback = { imgs: [], front: 0 };

async function bootRenderer() {
  if (!globalThis.PIXI) return "PIXI v7 not loaded (cdnjs unreachable?)";
  let mod;
  try { mod = await import("/scripts/features/theatre/render/shot-renderer.mjs"); }
  catch (e) { return "shot-renderer.mjs not importable: " + (e?.message ?? e); }
  try {
    app = new PIXI.Application({ resizeTo: window, backgroundAlpha: 1, backgroundColor: 0x000000, antialias: false, autoDensity: true, resolution: devicePixelRatio || 1 });
    $("#frame").append(app.view);
    renderer = new mod.ShotRenderer(PIXI, { width: FRAME.width, height: FRAME.height });
    app.stage.addChild(renderer.backdrop, renderer.container);
    // ?framing=fit&pad=5 — the camera's own maths (camera.mjs frameView), the backdrop fed the view as the host does.
    const { frameView } = await import("/scripts/features/theatre/camera.mjs");
    const q = new URLSearchParams(location.search);
    const framing = { mode: q.get("framing") === "fit" ? "fit" : "fill", padding: Number(q.get("pad")) || 0 };
    const fit = () => {
      const v = frameView({ x: 0, y: 0, width: FRAME.width, height: FRAME.height }, innerWidth, innerHeight, framing);
      const k = v.scale;
      const x = (innerWidth - FRAME.width * k) / 2, y = (innerHeight - FRAME.height * k) / 2;
      for (const c of [renderer.container, renderer.backdrop]) { c.scale.set(k); c.position.set(x, y); }
      renderer.setView({ x: -x / k, y: -y / k, width: innerWidth / k, height: innerHeight / k });
    };
    fit(); addEventListener("resize", fit);
    app.ticker.add(() => { if (!frozen) renderer.update(app.ticker.deltaMS); });
    renderer.preload(SHOTS.map((s) => s.src));
    return null;
  } catch (e) {
    try { app?.destroy(true); } catch {}
    app = null; renderer = null;
    return "ShotRenderer failed: " + (e?.message ?? e);
  }
}

function fallbackShow(shot, tl, startAt, settle) {
  if (!fallback.imgs.length) for (let i = 0; i < 2; i++) { const im = document.createElement("img"); im.className = "fb"; $("#frame").append(im); fallback.imgs.push(im); }
  if (tl.image.mode === "none") return;
  const inc = fallback.imgs[1 - fallback.front], out = fallback.imgs[fallback.front];
  inc.src = shot.src; inc.style.zIndex = 2; out.style.zIndex = 1;
  inc.getAnimations().forEach((a) => a.cancel());
  const dur = settle ? 1 : Math.max(1, tl.image.dur);
  const a = inc.animate([{ opacity: 0 }, { opacity: 1 }], { delay: settle ? 0 : tl.image.at, duration: dur, fill: "both" });
  a.currentTime = performance.now() - startAt;
  fallback.front = 1 - fallback.front;
  fallback.last = a;
}

/* ── the DOM half ───────────────────────────────────────────────────── */
const overlay = new TitleOverlay();
overlay.mount();

/* ── harness state ──────────────────────────────────────────────────── */
let index = SHOTS.length - 1, style = "centre", prevIndex = index, letterbox = 0, lastCue = null;

function timeline(kind, shot, s, k) {
  const t = timelineFor(kind === "card" ? "interlude" : s, {
    hold: TIMING.hold, letterbox, fromLetterbox: letterbox,
    letters: [...(shot?.title ?? "")].length, title: hasTitle(shot),
  });
  return scaleTimeline(t, k);
}

function cue({ kind = "shot", shot = index, s = style, settle = $("#st").checked, startAt = performance.now() + 60 } = {}) {
  const k = Number($("#ms").value);
  document.body.style.setProperty("--gl-motion-scale", String(k));
  const sh = SHOTS[shot];
  const tl = timeline(kind, sh, s, k);
  const face = FACES[$("#face").value];
  const tag = $("#tg").checked ? [sh.title, sh.subtitle.split("\\u00b7")[0].trim()].filter(Boolean).join(" \\u00b7 ") : null;
  if (kind === "shot" && s !== "interlude") {
    prevIndex = index; index = shot;
    if (renderer) { frozen = false; renderer.show(sh, { timeline: tl, startAt, settle }); }
    else fallbackShow(sh, tl, startAt, settle);
  }
  const k2 = kind === "shot" && s === "interlude" ? "card" : kind;
  overlay.play({ kind: k2, style: k2 === "card" ? "interlude" : s, title: titleOf(sh), face, cardText: CARD_TEXT, letterbox, tag },
    { timeline: tl, startAt, settle, scale: k });
  lastCue = { kind, shot, s, tl, startAt };
  paint();
}

/* Seek: rebuild the cue from the previous shot and freeze both halves at ms. */
window.__theatreSeek = (ms) => {
  if (!lastCue) return;
  const { kind, shot, s, tl } = lastCue;
  if (kind === "shot" && s !== "interlude") {
    const startAt = performance.now() - ms;
    if (renderer) {
      renderer.show(SHOTS[prevIndex], { timeline: tl, startAt, settle: true });
      renderer.update(0);
      renderer.show(SHOTS[shot], { timeline: tl, startAt, settle: false });
      renderer.update(0);
      frozen = true;
    } else if (fallback.last) { fallback.last.pause(); fallback.last.currentTime = ms; }
  }
  overlay.seek(ms);
  lastCue.frozenAt = ms;
  return { ms, total: tl.total };
};
window.__theatrePlay = () => {
  if (!lastCue) return;
  if (renderer && lastCue.frozenAt !== undefined) { renderer.show(SHOTS[lastCue.shot], { timeline: lastCue.tl, startAt: performance.now() - lastCue.frozenAt }); }
  frozen = false;
  fallback.last?.play();
  overlay.resume();
};
window.__theatreCue = (o = {}) => {
  if (o.style) style = o.style;
  if (o.face) $("#face").value = o.face;
  if (o.letterbox !== undefined) { $("#lb").value = String(o.letterbox); letterbox = Number(o.letterbox); }
  if (o.tag !== undefined) $("#tg").checked = !!o.tag;
  if (o.scale !== undefined) $("#ms").value = String(o.scale);
  cue({ kind: o.kind ?? "shot", shot: o.shot ?? (index + 1) % SHOTS.length, settle: !!o.settle });
  return lastCue.tl.total;
};
window.__theatre = { overlay, get renderer() { return renderer; }, SHOTS };

/* ── dock ───────────────────────────────────────────────────────────── */
function paint() {
  document.querySelectorAll("#thumbs img").forEach((im, i) => im.classList.toggle("on", i === index));
  document.querySelectorAll("#styles button").forEach((b) => b.classList.toggle("on", b.dataset.k === style));
}
SHOTS.forEach((s, i) => { const im = Object.assign(new Image(), { src: s.src, title: s.title }); im.onclick = () => cue({ shot: i }); $("#thumbs").append(im); });
for (const k of STYLES) {
  const b = Object.assign(document.createElement("button"), { textContent: k }); b.dataset.k = k;
  b.onclick = () => { style = k; cue({ shot: k === "interlude" ? index : (index + 1) % SHOTS.length }); };
  $("#styles").append(b);
}
for (const k of FACE_KEYS) $("#face").append(Object.assign(document.createElement("option"), { value: k, textContent: k }));
$("#face").onchange = () => cue({ kind: "title" });
$("#lb").onchange = () => { letterbox = Number($("#lb").value); overlay.setLetterbox(letterbox); };
$("#sg").onchange = () => document.body.classList.toggle("show-stage", $("#sg").checked);
$("#replay").onclick = () => { index = prevIndex; cue({ shot: lastCue?.shot ?? 0 }); };
$("#again").onclick = () => cue({ kind: "title" });
$("#card").onclick = () => cue({ kind: "card" });
$("#black").onclick = () => overlay.setBlack(true);
$("#clear").onclick = () => { overlay.clearTitle(); overlay.setBlack(false); };
addEventListener("keydown", (e) => {
  if (e.key === "h" || e.key === "H") $("#dock").classList.toggle("hidden");
  if (e.key === "ArrowRight") cue({ shot: (index + 1) % SHOTS.length });
  if (e.key === "ArrowLeft") cue({ shot: (index + SHOTS.length - 1) % SHOTS.length });
});

const err = await bootRenderer();
if (err) note("Image layer: plain <img> crossfade fallback \\u2014 " + err, true);
else note("Image layer: ShotRenderer (PIXI " + PIXI.VERSION + ") \\u00b7 H hides the dock \\u00b7 \\u2190/\\u2192 shots \\u00b7 __theatreSeek(ms)");
if (!SHOTS.length) note("No shots in .preview/theatre/", true);
else {
  // Start on the last shot, settled, then cut to the first.
  if (renderer) renderer.show(SHOTS[index], { timeline: timeline("shot", SHOTS[index], "cut", 1), startAt: performance.now(), settle: true });
  else fallbackShow(SHOTS[index], timeline("shot", SHOTS[index], "cut", 1), performance.now(), true);
  // ?style=&face=&shot=&letterbox=&tag=1&kind=&scale=&seek=ms&chrome=0 drives one cue for headless shots.
  const q = new URLSearchParams(location.search);
  if (q.has("seek") || q.has("style") || q.has("kind")) {
    if (q.get("chrome") === "0") { $("#dock").classList.add("hidden"); $("#note").style.display = "none"; }
    const loads = renderer ? Promise.all(SHOTS.map((s) => renderer.load(s.src))) : Promise.resolve();
    const wait = Promise.race([loads, new Promise((r) => setTimeout(r, 4000))]);
    wait.then(() => {
      __theatreCue({ style: q.get("style") ?? "centre", face: q.get("face") ?? undefined, shot: Number(q.get("shot") ?? 0),
        letterbox: q.has("letterbox") ? Number(q.get("letterbox")) : undefined, tag: q.get("tag") === "1", kind: q.get("kind") ?? "shot",
        scale: q.has("scale") ? Number(q.get("scale")) : undefined });
      if (q.has("seek")) __theatreSeek(Number(q.get("seek")));
      document.title = "ready";
    });
  } else setTimeout(() => cue({ shot: 0 }), 400);
}
</script>
</body>
</html>
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html);
console.log(`wrote ${OUT} (${SHOTS.length} shots)`);
