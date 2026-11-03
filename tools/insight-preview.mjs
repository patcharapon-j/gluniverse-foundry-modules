/**
 * tools/insight-preview.mjs — a live preview page for the Insight arrival.
 *
 * The feature is what a whole screen does when a message lands, and none of it
 * shows in a diff. So the page loads the REAL stylesheets and the REAL
 * templates, and plays every row through the SHIPPED renderer
 * (module/notification.mjs). The stage clock is therefore the runtime's by
 * construction: this file declares no timings of its own, and the beat list it
 * prints is read out of the renderer's exported TIMINGS.
 *
 *   node tools/insight-preview.mjs [--out=.preview/insight.html] [--artifact=<path>]
 *   node tools/preview-server.mjs 8973      # then /.preview/insight.html
 *
 * SERVE it. A file:// page loads the CSS but not the module script, so every
 * card stays hidden at its pre-arrival values and the reveal looks broken.
 *
 * URL params: `speed=normal|fast|instant`, `only=a,b` (rows to play).
 *
 * Each row draws a fixed 1200×675 "screen" scaled to fit. `position: fixed`
 * resolves against a transformed ancestor, so the stage fills that box exactly
 * as it fills a viewport, with no change to the shipped CSS.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice(6) : ".preview/insight.html");

/* The shipped presets and the shipped clock. Both modules touch no Foundry
   global at module scope, so they import cleanly here; a mirror of either
   would drift on the next retune and the page would flatter a look nobody ships. */
const { getPresets } = await import("../scripts/features/insight/module/themes.mjs");
const { TIMINGS, DURATIONS } = await import("../scripts/features/insight/module/notification.mjs");
const { safeBody, composeBody } = await import("../scripts/features/insight/module/body.mjs");
const { sharedLabel } = await import("../scripts/features/insight/module/recipients.mjs");
const PRESETS = Object.fromEntries(Object.entries(getPresets()).map(([id, cfg]) => [id, cfg.vars]));

const LANG = JSON.parse(await readFile(resolve(ROOT, "lang/insight.en.json"), "utf8"));

/**
 * The small subset of Handlebars the two templates use: comments, {{#if}}
 * (with {{else}}), {{#each}} over an array of objects, {{localize}},
 * {{{triple}}}, {{plain}} and {{this.x}}.
 */
function renderTemplate(src, ctx) {
  let out = src.replace(/\{\{!--[\s\S]*?--\}\}/g, "");
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const get = (scope, path) => path.replace(/^this\./, "").split(".").reduce((o, k) => (o == null ? undefined : o[k]), scope);

  out = out.replace(/\{\{#each ([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_m, key, body) =>
    (get(ctx, key) ?? []).map((item) => renderTemplate(body, { ...ctx, ...item, this: item })).join(""));

  const ifRe = /\{\{#if ([\w.]+)\}\}((?:(?!\{\{#if)[\s\S])*?)(?:\{\{else\}\}((?:(?!\{\{#if)[\s\S])*?))?\{\{\/if\}\}/g;
  for (let pass = 0; pass < 6 && ifRe.test(out); pass++) {
    ifRe.lastIndex = 0;
    out = out.replace(ifRe, (_m, key, yes, no) => {
      const v = get(ctx, key);
      return (Array.isArray(v) ? v.length : v) ? yes : no ?? "";
    });
  }

  out = out.replace(/\{\{localize "([^"]+)"\}\}/g, (_m, k) => esc(LANG[k] ?? k));
  out = out.replace(/\{\{\{([\w.]+)\}\}\}/g, (_m, k) => get(ctx, k) ?? "");
  out = out.replace(/\{\{([\w.]+)\}\}/g, (_m, k) => esc(get(ctx, k)));
  return out;
}

/* A stand-in picture for the image row: a dim room, drawn inline. */
const IMAGE = "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="260" viewBox="0 0 640 260">` +
  `<defs><radialGradient id="g" cx="62%" cy="40%" r="70%"><stop offset="0" stop-color="#6d5a44"/><stop offset=".55" stop-color="#2a2420"/><stop offset="1" stop-color="#0d0c0c"/></radialGradient></defs>` +
  `<rect width="640" height="260" fill="url(#g)"/><rect x="360" y="40" width="70" height="170" fill="#0b0a0a" opacity=".85"/>` +
  `<circle cx="395" cy="70" r="5" fill="#e9c27a"/></svg>`);

const SAMPLES = {
  whisper: {
    id: "insight-1730000000-a4f2",
    body: safeBody("<p>The hairs on the back of your neck rise. Something behind the shrine has been <b>watching you</b> since you crossed the threshold, and it has just decided you are worth the trouble.</p>"),
  },
  titled: {
    id: "insight-1730000001-9c1d",
    title: "You recognise the sigil",
    sense: "Perception",
    shared: sharedLabel(["Bram", "Seri"], (k, d) => LANG[k].replace(/\{(\w+)\}/g, (_m, n) => d[n]), "en"),
    body: safeBody("<p>It is the same mark that was burned into the cellar door in Vethkar, the one your sister told you never to open. <i>Whoever is here has been here before you.</i></p>"),
    pending: 2,
  },
  divine: {
    id: "insight-1730000002-77b0",
    title: "A warmth behind the ribs",
    sense: "Divine Sense",
    body: safeBody("<p>Your god is paying attention. Not approving: <b>attending</b>. The difference will matter before this room is finished with you.</p>"),
  },
  recall: {
    // Exactly the shape Recall Knowledge hands over: no title, a fixed label.
    id: "insight-1730000003-3e10",
    sense: "Recall Knowledge",
    body: safeBody("<p>Barrow trolls regrow what you cut off unless it is burned or soaked in acid. The one at the back is <strong>older than the barrow</strong>, and it remembers who built it.</p>"),
  },
  image: {
    id: "insight-1730000004-c0de",
    title: "The far door is open",
    sense: "Perception",
    image: IMAGE,
    body: composeBody("Light spills across the floor from the room beyond.\n\nIt was shut when you came in."),
  },
};

/** Each row of the sheet: one simulated screen. */
const ROWS = [
  { key: "a", note: "Full edge · Dreadlight · titled, shared with two others, two more waiting", sample: "titled", preset: "dreadlight", intensity: "full" },
  { key: "b", note: "Full edge · Fantasy accent", sample: "divine", preset: "fantasy", intensity: "full" },
  { key: "c", note: "Recall Knowledge hand-off · no title, fixed label", sample: "recall", preset: "dreadlight", intensity: "full" },
  { key: "d", note: "Subtle edge · no vignette, half burn · with a picture", sample: "image", preset: "dreadlight", intensity: "subtle" },
  { key: "e", note: "Edge off · the card carries it alone", sample: "whisper", preset: "fantasy", intensity: "off" },
];

const template = await readFile(resolve(ROOT, "templates/insight/notification.hbs"), "utf8");
const composeTpl = await readFile(resolve(ROOT, "templates/insight/compose-dialog.hbs"), "utf8");

const rows = ROWS.map((r) => ({ ...r, html: renderTemplate(template, SAMPLES[r.sample]), data: SAMPLES[r.sample] }));
const detail = renderTemplate(template, SAMPLES.titled);

const compose = (ctx) => `<div class="application insight-compose mock-window" data-preset="dreadlight">
  <header class="window-header"><h1 class="window-title">${LANG["INSIGHT.ComposeTitle"]}</h1></header>
  <section class="window-content">${renderTemplate(composeTpl, ctx)}</section>
</div>`;
const COMPOSE_FULL = compose({
  hasPlayers: true,
  people: [
    { id: "u1", name: "Aoife", color: "#e0703b", selected: true },
    { id: "u2", name: "Bram", color: "#4fa3d9", selected: false },
    { id: "u3", name: "Seri", color: "#9bd46a", selected: true },
    { id: "u4", name: "Tomas (GM)", color: "#c39cf0", selected: false },
  ],
  sense: "Perception",
  message: "The hairs on your neck rise.",
  sendLabel: LANG["INSIGHT.ComposeSendCount"].replace("{count}", "2"),
  shared: true,
  soloPick: false,
});
const COMPOSE_EMPTY = compose({
  hasPlayers: false, people: [], sense: "", message: "",
  sendLabel: LANG["INSIGHT.ComposeSend"], shared: false, soloPick: true,
});

/* The beat list, read off the shipped clock. */
const beats = (t) => [
  [t.edge, "The edge. The room dims, the accent rises from all four sides, one hairline traces the screen."],
  [t.line, "The cut draws out from the centre, wider than the card."],
  [t.card, "The card opens down out of the cut and one light crosses it."],
  [t.contentStart, `The words arrive in reading order, ${t.contentStagger} ms apart: label, who can see it, title, picture, body, the control.`],
];

const page = `<!doctype html>
<meta charset="utf-8">
<title>Insight preview</title>
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" href="/styles/insight.css">
<style>
  html, body { margin: 0; background: #05070a; }
  body { padding: 0 0 60px; font-family: system-ui, sans-serif; color: #eef1f7; }
  header.bar {
    position: sticky; top: 0; z-index: 500;
    display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
    padding: 12px 16px; background: rgb(5 7 10 / .94);
    border-bottom: 1px solid rgb(255 255 255 / .14);
    font: 700 11px/1 system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase;
  }
  header.bar button, header.bar select {
    font: inherit; color: #eef1f7; padding: 8px 10px; cursor: pointer;
    background: rgb(255 255 255 / .08); border: 1px solid rgb(255 255 255 / .22);
  }
  header.bar .muted { opacity: .5; }
  .caption { padding: 22px 16px 8px; font: 700 11px/1.5 system-ui, sans-serif; letter-spacing: .1em; text-transform: uppercase; color: #8b97ac; }
  .caption b { color: #eef1f7; }

  .fit { width: 100%; overflow: hidden; }
  .screen {
    position: relative; width: 1200px; height: 675px;
    transform-origin: top left; overflow: hidden; isolation: isolate;
    /* a lit map, not pure black: over black every glow flatters itself */
    background:
      radial-gradient(70% 55% at 30% 28%, #3b4a3a, transparent 70%),
      radial-gradient(60% 50% at 78% 74%, #4a3a2c, transparent 72%),
      repeating-linear-gradient(0deg, rgb(255 255 255 / .05) 0 1px, transparent 1px 74px),
      repeating-linear-gradient(90deg, rgb(255 255 255 / .05) 0 1px, transparent 1px 74px),
      #1c2219;
  }
  .screen.parchment {
    background:
      radial-gradient(80% 70% at 40% 40%, #d9c79f, #a8915f 75%),
      #c2ad7f;
  }
  .mock-sidebar { position: absolute; right: 0; top: 0; bottom: 0; width: 300px; background: rgb(0 0 0 / .5); border-left: 1px solid rgb(255 255 255 / .09); }
  .mock-hotbar { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; gap: 5px; }
  .mock-hotbar i { width: 50px; height: 50px; border: 1px solid rgb(255 255 255 / .13); background: rgb(0 0 0 / .45); }
  .mock-token { position: absolute; width: 104px; height: 104px; border-radius: 50%; border: 2px solid rgb(255 255 255 / .3); background: radial-gradient(circle at 36% 30%, #7d6a55, #35281c); }

  .detail { transform: translateZ(0); position: relative; height: 470px; overflow: hidden; background: #0c1017; }
  .detail .insight-edge { display: none; }

  .compose-row { display: flex; gap: 32px; flex-wrap: wrap; padding: 16px; background: #0c1017; }
  .mock-window { width: 400px; box-shadow: 0 0 0 1px rgb(255 255 255 / .1), 0 20px 50px rgb(0 0 0 / .6); }
  .mock-window .window-header { display: flex; align-items: center; height: 34px; padding: 0 12px; }
  .mock-window .window-title { margin: 0; }
  .mock-window button { font: inherit; }
</style>

<header class="bar">
  <span class="muted">insight</span>
  <button id="replay">Replay ⏎</button>
  <select id="speed">
    <option value="normal">Normal</option>
    <option value="fast">Fast</option>
    <option value="instant">Instant</option>
  </select>
  <span class="muted" id="fit"></span>
</header>

${rows.map((r) => `<section data-row="${r.key}"><div class="caption"><b>${r.key.toUpperCase()}</b> · ${r.note}</div>
<div class="fit"><div class="screen${r.key === "e" ? " parchment" : ""}" data-screen="${r.key}" data-preset="${r.preset}" data-intensity="${r.intensity}">
  <div class="mock-sidebar"></div>
  <div class="mock-hotbar"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
  <div class="mock-token" style="left: 20%; top: 30%"></div>
  <div class="mock-token" style="left: 31%; top: 62%"></div>
  <template>${r.html}</template>
  <script type="application/json">${JSON.stringify(r.data)}</script>
</div></div></section>`).join("\n")}

<section data-row="f"><div class="caption"><b>F</b> · The card at 1:1</div>
<div class="detail" data-screen="f" data-preset="dreadlight" data-intensity="off">
  <template>${detail}</template>
  <script type="application/json">${JSON.stringify(SAMPLES.titled)}</script>
</div></section>

<section data-row="g"><div class="caption"><b>G</b> · The GM's compose window, with players connected and alone</div>
<div class="compose-row">${COMPOSE_FULL}${COMPOSE_EMPTY}</div></section>

<script type="module">
import { renderNotification, disposeNotification } from "/scripts/features/insight/module/notification.mjs";
import { applyTheme } from "/scripts/features/insight/module/themes.mjs";
const params = new URLSearchParams(location.search);
const speedSel = document.getElementById("speed");
if (params.get("speed")) speedSel.value = params.get("speed");
const only = params.get("only")?.split(",");
if (only) for (const s of document.querySelectorAll("[data-row]")) s.hidden = !only.includes(s.dataset.row);
if (params.get("zoom")) document.body.style.zoom = params.get("zoom");
const boxes = [...document.querySelectorAll("[data-screen]")].filter((b) => !only || only.includes(b.dataset.screen));
let currentBox;
let generation = 0;
const LANG = ${JSON.stringify({ "INSIGHT.Queued": LANG["INSIGHT.Queued"] })};
globalThis.game = {
  settings: { get: (_id, key) => ({
    "insight.animationSpeed": speedSel.value,
    "insight.edgeIntensity": currentBox?.dataset.intensity,
    "insight.soundEnabled": false,
    "insight.theme": currentBox?.dataset.preset ?? "dreadlight",
  })[key] },
  i18n: {
    localize: (k) => LANG[k] ?? k,
    format: (k, d) => (LANG[k] ?? k).replace(/\\{(\\w+)\\}/g, (_m, x) => d[x]),
  },
};
globalThis.foundry = { applications: { handlebars: { renderTemplate: async () => currentBox.querySelector("template").innerHTML } } };

for (const w of document.querySelectorAll(".mock-window")) applyTheme(w, w.dataset.preset);

function fitScreens() {
  const width = document.documentElement.clientWidth;
  const z = Math.min(1, width / 1200);
  for (const s of document.querySelectorAll(".screen")) {
    s.style.transform = "scale(" + z + ")";
    s.parentElement.style.height = Math.round(675 * z) + "px";
  }
  document.getElementById("fit").textContent = "screen 1200×675 @ " + z.toFixed(2) + "×";
}

async function play() {
  const run = ++generation;
  for (const box of boxes) {
    const previous = box.querySelector(".insight-stage");
    if (previous) disposeNotification(previous);
    currentBox = box;
    const data = JSON.parse(box.querySelector('script[type="application/json"]').textContent);
    const el = await renderNotification({ ...data, theme: box.dataset.preset });
    if (run !== generation) { disposeNotification(el); return; }
    box.appendChild(el);
  }
}

document.getElementById("replay").addEventListener("click", play);
speedSel.addEventListener("change", play);
addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.target.closest?.("textarea")) play(); });
addEventListener("resize", fitScreens);
fitScreens();
play();
</script>
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, page, "utf8");
const rel = OUT.slice(ROOT.length).replace(/\\/g, "/");
console.log("wrote " + OUT);
console.log("serve it:  node tools/preview-server.mjs 8973");
console.log("then open: http://localhost:8973/" + rel);

/* ────────────────────────────────────────────────────────────────────────
   --artifact=<path>: a portable, settled-state reference. It inlines the same
   stylesheets and shows every row at rest (`insight-settled`), so it opens
   anywhere without a server. It is derived from the page above, and its beat
   list is the shipped clock, so the two cannot describe different designs.
   ──────────────────────────────────────────────────────────────────────── */
const artifactArg = process.argv.find((a) => a.startsWith("--artifact="));
if (artifactArg) {
  const ART = resolve(ROOT, artifactArg.slice(11));
  const sheets = [];
  for (const f of ["styles/gl-tokens.css", "styles/gl-motion.css", "styles/insight.css"]) {
    sheets.push("/* ==== " + f + " ==== */\n" + (await readFile(resolve(ROOT, f), "utf8")));
  }
  const settledScript = `<script>
const presets = ${JSON.stringify(PRESETS)};
for (const box of document.querySelectorAll("[data-screen]")) {
  const stage = box.querySelector("template").content.firstElementChild.cloneNode(true);
  stage.classList.add("insight-settled");
  if (box.dataset.intensity !== "full") stage.classList.add("insight-intensity-" + box.dataset.intensity);
  for (const [key, value] of Object.entries(presets[box.dataset.preset])) stage.style.setProperty(key, value);
  stage.querySelector(".insight-dismiss").disabled = true;
  box.appendChild(stage);
}
for (const w of document.querySelectorAll(".mock-window")) for (const [k, v] of Object.entries(presets[w.dataset.preset])) w.style.setProperty(k, v);
function fit() {
  const z = Math.min(1, document.querySelector(".fit").clientWidth / 1200);
  for (const s of document.querySelectorAll(".screen")) { s.style.transform = "scale(" + z + ")"; s.parentElement.style.height = Math.round(675 * z) + "px"; }
}
addEventListener("resize", fit); fit();
</script>`;
  const body = page
    .replace(/<script type="module">[\s\S]*?<\/script>/, settledScript)
    .replace(/<header class="bar">[\s\S]*?<\/header>/, "")
    .replace(/^<!doctype html>\n<meta charset="utf-8">\n<title>[^<]*<\/title>\n/, "")
    .replace(/<link rel="stylesheet" href="\/styles\/[^"]*">\n/g, "");
  const t = TIMINGS.normal;
  const intro = `<div style="max-width:64ch;padding:32px 16px 4px;line-height:1.55;color:#c9ced8">
  <h1 style="margin:0 0 12px;font-size:28px;color:#f3f5f9">Insight arrival</h1>
  <p>One private message on one player's screen. The edge lands first and alone, then the cut, then the card, then the words. These frames are the <b>settled state</b>; serve the repository preview to watch the motion.</p>
  <ul style="padding-left:18px">${beats(t).map(([ms, what]) => `<li><b>${ms} ms</b> · ${what}</li>`).join("")}
  <li><b>then</b> · The edge breathes on a ${DURATIONS.breathe} ms cycle until the player acknowledges.</li></ul>
</div>`;
  const head = [
    '<meta charset="utf-8">',
    "<title>Insight Arrival</title>",
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,wdth,wght@6..144,25..151,1..1000&display=swap">',
    "<style>", sheets.join("\n\n"), "</style>",
  ].join("\n");
  await mkdir(dirname(ART), { recursive: true });
  await writeFile(ART, head + "\n" + intro + body, "utf8");
  console.log("wrote " + ART + "  (portable settled-state reference)");
}
