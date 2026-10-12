/**
 * tools/stage-preview.mjs — write a live preview page for the Stage.
 *
 * The page drives the REAL modules over the preview server — the director, the
 * renderer, the light probe and rig, the asset preparation — never a lookalike,
 * which would flatter whichever copy was touched last. The backdrop is drawn as
 * by the stage itself, as it is at the table: the stage draws its own room.
 *
 * Art is not in the repository. Point the tool at a folder holding
 *   cast/*.png|webp   transparent character art
 *   bg/*.jpg|png|webp backdrops
 * and it copies them into .preview/stage/ (gitignored):
 *
 *   node tools/stage-preview.mjs --assets=<dir> [--out=.preview/stage.html]
 *   node tools/preview-server.mjs        # then /.preview/stage.html
 *
 * URL parameters (all optional):
 *   bg=<name>             backdrop
 *   cast=a,b,c            who is on stage, left to right
 *   x=0.2,0.5,0.8         their marks          depth=0,0,0.5   their rows
 *   focus=<name>          who is speaking
 *   shot=wide|close       close=<name>         the close-up subject
 *   mood=auto|day|…|off   strength=0..1        darkness=0..1
 *   match= key= rim= glow= blur= grain=   the light's dials (light/rig.mjs)
 *   t=<ms>                freeze the clock at t ms after the page set its state
 *                         (entrances run from 0; t=4000 is settled)
 *   from=<shot>           start in this shot and cut to `shot` at 0, to seek a push
 *   mask=a,b              these characters stand as silhouettes
 *   reveal=a,b            these start as silhouettes and are revealed at 0
 *   loop=1                with reveal=: mask and reveal again on a loop
 *   split=1               left half unlit, right half lit
 *   ui=0                  hide the control strip (for screenshots)
 *   view=1..5             debug: normals · rim light · occlusion · the light alone · outline+halo
 *
 * window.__stageReady is true once every picture is prepared and a frame drawn.
 */
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = resolve(ROOT, arg("out") ?? ".preview/stage.html");
const ASSET_DIR = resolve(ROOT, ".preview/stage");

async function list(dir, exts) {
  try { return (await readdir(dir)).filter((f) => exts.includes(extname(f).toLowerCase())).sort(); } catch { return []; }
}

const src = arg("assets");
if (src) {
  for (const sub of ["cast", "bg"]) {
    await mkdir(resolve(ASSET_DIR, sub), { recursive: true });
    for (const f of await list(resolve(src, sub), [".png", ".webp", ".jpg", ".jpeg"])) await copyFile(resolve(src, sub, f), resolve(ASSET_DIR, sub, f));
  }
}
const cast = (await list(resolve(ASSET_DIR, "cast"), [".png", ".webp"])).map((f) => ({ name: basename(f, extname(f)), src: `/.preview/stage/cast/${f}` }));
const bgs = (await list(resolve(ASSET_DIR, "bg"), [".png", ".webp", ".jpg", ".jpeg"])).map((f) => ({ name: basename(f, extname(f)), src: `/.preview/stage/bg/${f}` }));
if (!cast.length || !bgs.length) console.warn("stage-preview: no art in .preview/stage/{cast,bg} — pass --assets=<dir>");

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Stage preview</title>
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" href="/styles/stage.css">
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  #ui { position: fixed; left: 8px; top: 8px; z-index: 50; display: flex; flex-wrap: wrap; gap: 4px; max-width: 70vw;
        font: 12px system-ui; color: #ddd; background: rgb(0 0 0 / 0.55); padding: 6px; border-radius: 4px; }
  #ui button, #ui select { font: inherit; }
  #err { position: fixed; right: 8px; top: 8px; z-index: 60; color: #f88; font: 12px monospace; white-space: pre; }
  .split #unlit { clip-path: inset(0 50% 0 0); }
  #unlit { display: none; }
  .split #unlit { display: block; }
</style></head>
<body>
<div id="stage-host"></div>
<div id="ui"></div>
<pre id="err"></pre>
<script type="module">
import { StageGL } from "/scripts/features/stage/render/gl.mjs";
import { Director } from "/scripts/features/stage/director.mjs";
import { prepareArt, prepareBackdrop } from "/scripts/features/stage/render/assets.mjs";
import { resolveRig } from "/scripts/features/stage/light/rig.mjs";
import { roomOf } from "/scripts/features/stage/light/backdrop.mjs";
import { normalizeState, normalizeCast, normalizeLayout } from "/scripts/features/stage/model.mjs";
import { mountStageDom } from "/scripts/features/stage/stage-dom.mjs";

const CAST = ${JSON.stringify(cast)};
const BGS = ${JSON.stringify(bgs)};
const q = new URLSearchParams(location.search);
const csv = (k, d) => (q.get(k) ?? d).split(",").filter(Boolean);
const err = (m) => { document.getElementById("err").textContent += m + "\\n"; };
window.onerror = (m) => err(String(m));

const bg = BGS.find((b) => b.name === q.get("bg")) ?? BGS[0];
const names = csv("cast", CAST.slice(0, 3).map((c) => c.name).join(","));
const xs = csv("x", "").map(Number);
const ds = csv("depth", "").map(Number);
const load = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });

if (q.get("split") === "1") document.body.classList.add("split");
if (q.get("ui") === "0") document.getElementById("ui").style.display = "none";

const dom = mountStageDom(document.getElementById("stage-host"));
const lit = dom.canvas; lit.id = "lit";
const unlit = lit.cloneNode(); unlit.id = "unlit"; lit.after(unlit);

const members = normalizeCast(names.map((n) => {
  const c = CAST.find((x) => x.name === n);
  return { id: n.replace(/[^A-Za-z0-9_-]/g, ""), name: n.replace(/^./, (s) => s.toUpperCase()), title: "", image: c?.src, faces: "front" };
}));
const layout = normalizeLayout({ figure: Number(q.get("figure") ?? 0.92), nameplates: q.get("nameplates") ?? "close" });

const renderers = [];
for (const [canvas, strength] of [[lit, null], [unlit, 0]]) {
  const gl = new StageGL(canvas);
  if (!gl.init()) { err("StageGL: " + gl.report); continue; }
  renderers.push({ gl, strength, director: new Director() });
}

let maps = null;
let bgImage = null;
try { ({ maps, image: bgImage } = prepareBackdrop(await load(bg.src))); } catch (e) { err("backdrop: " + e); }
for (const m of members) {
  try {
    const p = prepareArt(await load(m.image));
    for (const r of renderers) { r.gl.setArt(m.image, p.image, p.shape); r.director.setArt(m.image, p.info); }
  } catch (e) { err("art " + m.name + ": " + e); }
}

const light = { mood: q.get("mood") ?? "auto" };
for (const k of ["strength", "match", "key", "rim", "glow", "blur", "grain"]) if (q.has(k)) light[k] = Number(q.get(k));
const darkness = Number(q.get("darkness") ?? 0);
const id = (n) => n?.replace(/[^A-Za-z0-9_-]/g, "") ?? null;
const idList = (k) => new Set((q.get(k) ?? "").split(",").map(id).filter(Boolean));
const masks = idList("mask");
const reveals = idList("reveal");
const stateFor = (shot, before = false) => normalizeState({
  visible: true, shot, cut: q.get("cut") ?? "push",
  focus: id(q.get("focus")), close: id(q.get("close") ?? q.get("focus") ?? names[0]),
  on: members.map((m, i) => ({ id: m.id, x: Number.isFinite(xs[i]) ? xs[i] : undefined, depth: ds[i], masked: masks.has(m.id) || (before && reveals.has(m.id)) })),
}, members.map((m) => m.id));
// Unplaced marks spread evenly.
const spread = (s) => ({ ...s, on: s.on.map((m, i) => ({ ...m, x: Number.isFinite(xs[i]) ? xs[i] : (s.on.length === 1 ? 0.5 : 0.18 + 0.64 * i / (s.on.length - 1)) })) });

const T0 = 1000;
for (const r of renderers) {
  const d = r.director;
  d.setView(innerWidth, innerHeight);
  d.setLayout(layout);
  d.setCast(members);
  if (maps) {
    r.gl.setBackdrop(bg.name, maps, bgImage);
    d.setBackdrop(bg.name, roomOf(maps), 0, { immediate: true });
  }
  r.gl.setSize(innerWidth, innerHeight, Math.min(devicePixelRatio || 1, 2));
  const rig = resolveRig(r.strength === 0 ? { mood: "off" } : light, maps?.probe, { darkness });
  if (q.get("debug") === "1" && r.strength !== 0) err(JSON.stringify({ probe: maps?.probe, rig }, (k, v) => typeof v === "number" ? Math.round(v * 1000) / 1000 : v));
  d.setRig(rig, 0, { immediate: true });
  const from = q.get("from");
  if (from || reveals.size) d.setState(spread(stateFor(from ?? q.get("shot") ?? "wide", true)), 0, { immediate: true });
  d.setState(spread(stateFor(q.get("shot") ?? "wide")), T0, {});
}

const frozen = q.has("t") ? T0 + Number(q.get("t")) : null;
const start = performance.now();
let drew = false;
function frame() {
  const now = frozen ?? (T0 + performance.now() - start);
  for (const r of renderers) {
    const f = r.director.step(now);
    f.debug = Number(q.get("view") ?? 0);
    r.gl.draw(f);
    if (r === renderers[0]) dom.update(f);
  }
  if (!drew) { drew = true; window.__stageReady = true; }
  if (frozen === null) requestAnimationFrame(frame);
}
frame();

// A reveal on a loop: revealed, held, masked again, held.
if (q.get("loop") === "1" && reveals.size) {
  let masked = false;
  setInterval(() => {
    masked = !masked;
    const now = T0 + performance.now() - start;
    for (const r of renderers) r.director.setState(spread(stateFor(q.get("shot") ?? "wide", masked)), now);
  }, 3400);
}

// Controls.
const ui = document.getElementById("ui");
const link = (label, patch) => {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = () => { const u = new URLSearchParams(location.search); for (const [k, v] of Object.entries(patch)) v === null ? u.delete(k) : u.set(k, v); location.search = u; };
  ui.append(b);
};
for (const b of BGS) link("bg:" + b.name, { bg: b.name });
for (const m of ["auto", "day", "golden", "dusk", "night", "fire", "neon", "storm", "off"]) link("mood:" + m, { mood: m });
link("wide", { shot: "wide", from: "close", t: null });
for (const m of members) link("close:" + m.name, { shot: "close", close: m.name, from: "wide", t: null });
for (const m of members) link("focus:" + m.name, { focus: m.name });
for (const m of members) link("reveal:" + m.name, { reveal: m.name, mask: null, t: null });
link("split", { split: q.get("split") === "1" ? "0" : "1" });
</script>
</body></html>
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html);
console.log(`wrote ${OUT} — ${cast.length} cast, ${bgs.length} backdrops. Serve: node tools/preview-server.mjs, then /${OUT.slice(ROOT.length).replace(/\\\\/g, "/")}`);
