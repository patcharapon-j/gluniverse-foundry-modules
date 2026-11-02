/**
 * tools/theatre-apps-preview.mjs — write a preview page for Theatre's GM apps.
 *
 * The page renders the REAL views (scripts/features/theatre/apps/filmstrip-view.mjs
 * and editor-view.mjs) with the REAL strings (lang/theatre*.en.json) over the
 * REAL stylesheet. Only the editor's window frame and the canvas behind the
 * docked filmstrip are lookalikes; everything the GM reads and presses is the
 * shipped markup.
 *
 * Pictures are not in the repository: it uses whatever is in .preview/theatre
 * and .preview/stage/bg (gitignored; see tools/theatre-preview.mjs and
 * tools/stage-preview.mjs).
 *
 *   node tools/theatre-apps-preview.mjs [--out=.preview/theatre-apps.html]
 *   node tools/preview-server.mjs            # then /.preview/theatre-apps.html
 *
 * Serve it: a file:// page does not run its module script.
 *
 * URL parameters (all optional):
 *   app=both|filmstrip|editor   which app to draw (default both)
 *   tab=shot|scene              the editor's tab
 *   collapsed=1                 the filmstrip folded to its transport
 *   dirty=1                     the edited shot carries an unsaved draft
 *   black=1                     nothing on air
 *   empty=1                     a Theatre scene with no shots
 *   q=<text>                    a search in both apps
 *   w= h=                       the editor window's size (default 1000×700)
 *
 * Clicking a frame, a row or a tab re-renders on it. Nothing writes.
 */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = resolve(ROOT, arg("out") ?? ".preview/theatre-apps.html");

async function list(dir, rel) {
  try {
    return (await readdir(dir)).filter((f) => [".png", ".webp", ".jpg", ".jpeg", ".webm", ".mp4"].includes(extname(f).toLowerCase())).sort().map((f) => `${rel}/${f}`);
  } catch { return []; }
}
const pics = [...await list(resolve(ROOT, ".preview/theatre"), "/.preview/theatre"), ...await list(resolve(ROOT, ".preview/stage/bg"), "/.preview/stage/bg")];
if (!pics.length) console.warn("theatre-apps-preview: no pictures in .preview/theatre or .preview/stage/bg; frames will be blank");

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Theatre apps preview</title>
<link rel="stylesheet" href="/.preview/foundry/fonts/fontawesome/css/all.min.css">
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/theatre-apps.css">
<style>
  html, body { margin: 0; height: 100%; background: #1b1c21; overflow: hidden; }
  body { background: #1b1c21 center / cover no-repeat; }
  body::after { content: ""; position: fixed; inset: 0; background: rgb(0 0 0 / 0.35); pointer-events: none; }
  .glth-editor.application { display: flex; flex-direction: column; z-index: 1; }
  .glth-editor.application { position: absolute; left: 50%; top: 24px; translate: -50% 0; }
  .glth-editor .window-header { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px; flex: none; }
  .window-title { flex: 1; margin: 0; font: inherit; }
  .window-content { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .glth-filmstrip { z-index: 2; }
  [hidden] { display: none !important; }
  .header-control { width: 24px; height: 24px; background: none; border: 0; color: #9a9caa; cursor: pointer; }
  #err { position: fixed; left: 8px; top: 8px; z-index: 9; color: #f88; font: 12px monospace; white-space: pre; }
</style></head>
<body>
<section class="application glth-app glth-editor" id="glth-editor">
  <header class="window-header"><i class="fa-solid fa-clapperboard"></i><h1 class="window-title">Theatre shots</h1>
    <button type="button" class="header-control fa-solid fa-xmark" aria-label="Close"></button></header>
  <section class="window-content"></section>
</section>
<div class="application glth-app glth-filmstrip" id="glth-filmstrip"></div>
<pre id="err"></pre>
<script type="module">
const PICS = ${JSON.stringify(pics)};
const q = new URLSearchParams(location.search);
const err = (m) => { document.getElementById("err").textContent += m + "\\n"; };
window.onerror = (m) => err(String(m));
window.onunhandledrejection = (e) => err(String(e.reason));

const FV = await import("/scripts/features/theatre/apps/filmstrip-view.mjs");
const EV = await import("/scripts/features/theatre/apps/editor-view.mjs");
const M = await import("/scripts/features/theatre/model.mjs");
const lang = Object.assign({}, ...(await Promise.all(["theatre", "theatre-apps"].map((n) => fetch("/lang/" + n + ".en.json").then((r) => r.json())))));
const look = (key) => (key in lang ? lang[key] : key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), lang));
const L = (key, data) => {
  const s = look(key);
  if (typeof s !== "string") return key;
  return data ? s.replace(/\\{(\\w+)\\}/g, (_, k) => (k in data ? String(data[k]) : "{" + k + "}")) : s;
};

const pic = (i) => (PICS.length ? PICS[i % PICS.length] : "");
const empty = q.get("empty") === "1";
const folders = M.normalizeFolders(empty ? [] : [
  { id: "f1", name: "Act I: The Docks", color: "#d98c3a" },
  { id: "f2", name: "Act II: Below", color: "#5f8fd6" },
]);
const shots = M.orderShots(M.normalizeShots(empty ? [] : [
  { id: "s1", src: pic(0), eyebrow: "Act I", title: "The Gilded Hall", subtitle: "Evening of the first day", folder: "f1", notes: "Open on the empty hall. Let the music run before anyone speaks.", grade: { mood: "dusk" } },
  { id: "s2", src: pic(1), title: "Harbour Gate", style: "wipe", folder: "f1", focus: { x: 0.3, y: 0.5 } },
  { id: "s3", src: pic(2), eyebrow: "Later", title: "The Drowned Chapel", subtitle: "Night of the second day", folder: "f2", treatment: { exposure: -0.35, saturation: 0.8, vignette: 0.4, tint: "#3a5a8c", tintAmount: 0.25 } },
  { id: "s4", src: pic(3), title: "Cistern <&> Stairs", folder: "f2", style: "interlude" },
  { id: "s5", src: "", folder: "f2" },
  { id: "s6", src: pic(4), title: "Epilogue", subtitle: "Three days later", style: "credits", notes: "" },
]), folders);
const config = M.normalizeConfig({ style: "centre", hold: 4500, letterbox: 0.06, tag: true, mode: "frame" });
const black = q.get("black") === "1";
const state = M.normalizeState(empty || black ? {} : { shotId: "s1", cue: { seq: 4, at: 0, kind: "shot", shotId: "s1", style: "centre" } });
document.body.style.backgroundImage = state.shotId && pic(0) ? "url(" + JSON.stringify(pic(0)) + ")" : "none";

const which = q.get("app") ?? "both";
const view = {
  selectedId: empty ? null : "s3",
  editId: empty ? null : "s3",
  filter: FV.ALL,
  query: q.get("q") ?? "",
  tab: q.get("tab") === "scene" ? "scene" : "shot",
};
const draft = q.get("dirty") === "1" && view.editId ? { id: view.editId, values: { title: "The Drowned Chapel (draft)", eyebrow: "Much later" } } : null;

const film = document.getElementById("glth-filmstrip");
const ed = document.getElementById("glth-editor");
ed.style.width = (Number(q.get("w")) || 1000) + "px";
ed.style.height = (Number(q.get("h")) || 700) + "px";
film.hidden = which === "editor";
ed.hidden = which === "filmstrip";
if (which === "editor") document.body.style.backgroundImage = "none";

const draw = () => {
  film.innerHTML = FV.renderFilmstrip(FV.filmstripModel({
    shots, folders, config, state, selectedId: view.selectedId, filter: view.filter, query: view.query,
    collapsed: q.get("collapsed") === "1", goStyle: "", freePan: false, canFreePan: true, face: "gsflex",
  }, L), L);
  ed.querySelector(".window-content").innerHTML = EV.renderEditor(EV.editorModel({
    shots, folders, config, state, selectedId: view.editId, draft, collapsed: new Set(), query: view.query,
    tab: view.tab, stage: true, face: "gsflex", shake: 0.2,
  }, L), L);
  // The picker's crop frame, as editor.mjs #bindFocus paints it.
  const box = ed.querySelector("[data-focus]"), media = box?.querySelector(".glth-focus-media");
  const paint = () => {
    const crop = box.querySelector("[data-focus-crop]"), iw = media.naturalWidth, ih = media.naturalHeight;
    const fx = Number(ed.querySelector('[name="focus.x"]').value), fy = Number(ed.querySelector('[name="focus.y"]').value);
    if (!(iw > 0 && ih > 0)) return;
    box.style.setProperty("--glth-ar", String(iw / ih));
    const r = M.coverRect(iw, ih, 1920, 1080, { x: fx, y: fy });
    Object.assign(crop.style, { left: (-r.x / r.scale / iw) * 100 + "%", top: (-r.y / r.scale / ih) * 100 + "%", width: (1920 / r.scale / iw) * 100 + "%", height: (1080 / r.scale / ih) * 100 + "%" });
    crop.hidden = false;
  };
  if (media?.complete) paint(); else media?.addEventListener("load", paint);
  // A stand-in for the apps' own filter pass (#applyFilter): hide what the folder filter or the search drops.
  const needle = view.query.trim().toLowerCase();
  for (const el of film.querySelectorAll(".glth-frame[data-id], .glth-slate")) {
    const inFolder = view.filter === FV.ALL || el.dataset.folder === view.filter;
    const hit = !needle || !el.dataset.haystack || el.dataset.haystack.includes(needle);
    el.hidden = !(inFolder && hit) || (el.matches(".glth-slate") && view.filter !== FV.ALL);
  }
  if (needle) for (const el of ed.querySelectorAll(".glth-row[data-haystack]")) el.hidden = !el.dataset.haystack.includes(needle);
};
draw();
document.addEventListener("click", (ev) => {
  const t = ev.target.closest("[data-action]");
  if (!t) return;
  if (t.matches(".glth-frame")) { view.selectedId = t.dataset.id; draw(); }
  else if (t.matches(".glth-row")) { view.editId = t.dataset.id; draw(); }
  else if (t.dataset.tab) { view.tab = t.dataset.tab; draw(); }
  else if (t.dataset.folderFilter != null) { view.filter = t.dataset.folderFilter; draw(); }
});
window.__theatreAppsReady = true;
</script>
</body></html>`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html);
console.log(`wrote ${OUT}`);
