/**
 * tools/director-preview.mjs — write a preview page for Stage's Director panel.
 *
 * The page renders the REAL view (scripts/features/stage/apps/director-view.mjs)
 * with the REAL strings (lang/stage.en.json) over the REAL stylesheet, inside a
 * stand-in ApplicationV2 frame. Only the frame is a lookalike; everything the
 * GM reads and presses is the shipped markup.
 *
 * Art is not in the repository: it uses whatever `tools/stage-preview.mjs
 * --assets=<dir>` copied into .preview/stage/{cast,bg} (gitignored).
 *
 *   node tools/director-preview.mjs [--out=.preview/director.html]
 *   node tools/preview-server.mjs            # then /.preview/director.html
 *
 * Serve it: a file:// page does not run its module script.
 *
 * URL parameters (all optional):
 *   tab=stage|cast|light|comms   castView=edit|lineup
 *   mood=<mood>                  the light's mood (default dusk)
 *   close=0                      no close-up on screen
 *   empty=1                      nobody cast, nothing on stage
 *   w= h=                        the window's size (default 920×720)
 *   foundry=1                    also load Foundry's own sheet from
 *                                .preview/foundry/css/foundry2.css when it is
 *                                there, so element-level styling can be judged
 *
 * Clicking a tab re-renders on it. Nothing else writes; this is a still.
 */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = resolve(ROOT, arg("out") ?? ".preview/director.html");
const ASSET_DIR = resolve(ROOT, ".preview/stage");

async function list(dir, exts) {
  try { return (await readdir(dir)).filter((f) => exts.includes(extname(f).toLowerCase())).sort(); } catch { return []; }
}
const art = (await list(resolve(ASSET_DIR, "cast"), [".png", ".webp"])).map((f) => ({ name: basename(f, extname(f)), src: `/.preview/stage/cast/${f}` }));
const bgs = (await list(resolve(ASSET_DIR, "bg"), [".png", ".webp", ".jpg", ".jpeg"])).map((f) => `/.preview/stage/bg/${f}`);
if (!art.length) console.warn("director-preview: no art in .preview/stage/cast — run tools/stage-preview.mjs --assets=<dir> first");

/* Demo identities; the art is cycled under them. */
const PEOPLE = [
  { name: "Captain Kael Varro", title: "The Dawnward", height: 1.08 },
  { name: "Mira Sel", title: "Navigator", height: 0.94 },
  { name: "Brannoc", title: "Captain of the Watch", height: 1.18 },
  { name: "Ismay Vale", title: "Archivist", height: 0.9 },
  { name: "Elder Moro", title: "Keeper of the Well", height: 0.86 },
  { name: "Vhessa", title: "", height: 1.02 },
];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Stage director preview</title>
<link rel="stylesheet" href="/.preview/foundry/fonts/fontawesome/css/all.min.css">
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/stage-director.css">
<style>
  html, body { margin: 0; height: 100%; background: #2a2b31; }
  body { display: grid; place-items: center; }
  .application { position: relative; display: flex; flex-direction: column; }
  .window-header { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px; flex: none; }
  .window-title { flex: 1; margin: 0; font: inherit; }
  .window-content { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  #err { position: fixed; left: 8px; bottom: 8px; color: #f88; font: 12px monospace; white-space: pre; }
</style></head>
<body>
<section class="application glstage-dir-app" id="glstage-director">
  <header class="window-header"><i class="fa-solid fa-theater-masks"></i><h1 class="window-title">Stage Director</h1>
    <button type="button" class="header-control fa-solid fa-xmark" aria-label="Close"></button></header>
  <section class="window-content"></section>
</section>
<pre id="err"></pre>
<script type="module">
const ART = ${JSON.stringify(art)};
const BGS = ${JSON.stringify(bgs)};
const PEOPLE = ${JSON.stringify(PEOPLE)};
const q = new URLSearchParams(location.search);
const err = (m) => { document.getElementById("err").textContent += m + "\\n"; };
window.onerror = (m) => err(String(m));
window.onunhandledrejection = (e) => err(String(e.reason));

if (q.get("foundry") === "1") {
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.href = "/.preview/foundry/css/foundry2.css";
  document.head.prepend(l);
  document.body.classList.add("theme-dark", "game");
}

const V = await import("/scripts/features/stage/apps/director-view.mjs");
const M = await import("/scripts/features/stage/model.mjs");
const R = await import("/scripts/features/stage/light/rig.mjs");
const lang = await (await fetch("/lang/stage.en.json")).json();
const look = (key) => key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), lang);
const L = (key, data) => {
  const s = look(key);
  if (typeof s !== "string") return key;
  return data ? s.replace(/\\{(\\w+)\\}/g, (_, k) => (k in data ? String(data[k]) : "{" + k + "}")) : s;
};

const empty = q.get("empty") === "1";
const cast = empty ? [] : M.normalizeCast(PEOPLE.map((p, i) => ({
  id: "c" + i, ...p, image: ART.length ? ART[i % ART.length].src : "",
  actorUuid: i === 1 ? "Actor.demo" : "",
  face: i === 0 ? { x: 0.5, y: 0.17, h: 0.18 } : null,
})));
const ids = cast.map((m) => m.id);
const state = M.normalizeState(empty ? {} : {
  visible: true,
  on: [{ id: "c0", x: 0.26, depth: 0.1 }, { id: "c1", x: 0.5, depth: 0.55 }, { id: "c2", x: 0.76, depth: 0, flip: true }, { id: "c3", x: 0.62, depth: 0.85, masked: true }],
  focus: "c0",
  ...(q.get("close") === "0" ? {} : { shot: "close", close: "c0", cut: "push" }),
}, ids);
const comms = M.normalizeComms(empty ? {} : { visible: true, calls: [{ callId: "k1", castId: "c4" }, { callId: "k2", castId: "c5" }], speaking: "k1" }, ids);
const light = R.normalizeLight({ mood: q.get("mood") ?? "dusk", angle: q.get("mood") === "night" ? -40 : null, flicker: true });
const view = { tab: q.get("tab") ?? "stage", sel: "c2", castSel: "c0", castView: q.get("castView") ?? "edit", q: { stage: "", cast: "", comms: "" } };

const app = document.getElementById("glstage-director");
app.style.width = (Number(q.get("w")) || 920) + "px";
app.style.height = (Number(q.get("h")) || 720) + "px";
const content = app.querySelector(".window-content");
const draw = () => {
  const model = V.directorModel({
    cast, state, layout: M.normalizeLayout({}), comms, commsLayout: M.normalizeCommsLayout({ style: "clean" }),
    scene: { id: "s", name: "The Gilded Hall" }, light, backdrop: BGS[0] ?? "", view,
  }, L);
  content.innerHTML = V.renderDirector(model, L);
};
draw();
content.addEventListener("click", (ev) => {
  const t = ev.target.closest("[data-action]");
  if (!t) return;
  if (t.dataset.action === "stageTab") { view.tab = t.dataset.tab; draw(); }
  else if (t.dataset.action === "castView") { view.castView = t.dataset.value; draw(); }
  else if (t.dataset.action === "castSelect") { view.castSel = t.dataset.id; view.castView = "edit"; draw(); }
});
window.__directorReady = true;
</script>
</body></html>`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html);
console.log(`wrote ${OUT}`);
