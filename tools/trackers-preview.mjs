/**
 * tools/trackers-preview.mjs: write a live preview page for Resource Trackers.
 *
 * The page imports the SHIPPED modules (tracker-model.js, view.js,
 * tracker-render.js, and the editor's form builder) and the shipped stylesheets
 * over a preview server. The dock skeleton is dockShellHTML, the rows are the
 * keyed TrackerList, the card is poolCardHTML: the files Foundry loads.
 *
 *   node tools/trackers-preview.mjs [--out=.preview/trackers.html]
 *   node tools/preview-server.mjs [port]      # then open /.preview/trackers.html
 *
 * SERVE it: a file:// page does not execute its module script.
 *
 *   ?scene=gm        the GM's dock: every type, a prominent row, a hidden one
 *   ?scene=player    the same table from a player's seat
 *   ?scene=compact   the GM's dock, compact
 *   ?scene=sheet     a PC's private tab on a sheet
 *   ?scene=editor    the editor, creating a clock
 *   ?scene=edit      the editor, editing a pool (a dock-only field shown)
 *   ?scene=card      two pool cards in a chat log (one spent dry)
 *   ?scene=empty     a GM's dock with nothing on it yet
 *   &step=1          after the first paint, change several values once (the
 *                    frame a screenshot catches is mid-change)
 *   &live=1          keep changing values, so the motion can be watched
 *
 * `window.__trackers` exposes { set(scene), bump(id, delta), list } for headless use.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice(6) : ".preview/trackers.html");

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Resource Trackers preview</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" href="/styles/clocks-tracker-trackers.css">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #0b0d0c; font-family: "Signika", system-ui, sans-serif; }
  #map { position: fixed; inset: 0; background:
    linear-gradient(rgb(255 255 255 / 0.035) 1px, transparent 1px) 0 0 / 70px 70px,
    linear-gradient(90deg, rgb(255 255 255 / 0.035) 1px, transparent 1px) 0 0 / 70px 70px,
    radial-gradient(40% 50% at 30% 60%, #2a3324, transparent 70%),
    radial-gradient(35% 40% at 70% 35%, #3a3022, transparent 70%),
    radial-gradient(60% 60% at 50% 50%, #1c211b, #0b0d0c); }
  #controls { position: fixed; left: 10px; top: 80px; display: flex; flex-direction: column; gap: 6px; }
  #controls i { width: 36px; height: 36px; display: grid; place-items: center; background: #1b1b1fd9; border: 1px solid #ffffff1a; border-radius: 5px; color: #c9c9d0; font-size: 15px; }
  #sidebar { position: fixed; right: 0; top: 0; bottom: 0; width: 300px; background: #121214e6; border-left: 1px solid #ffffff14; }
  #sidebar .tabs { height: 36px; border-bottom: 1px solid #ffffff14; }
  #hotbar { position: fixed; bottom: 10px; left: 50%; transform: translateX(-50%); display: flex; gap: 4px; }
  #hotbar i { width: 46px; height: 46px; background: #1b1b1fd9; border: 1px solid #ffffff1a; border-radius: 4px; }
  /* the dock sits left of the sidebar here, where a table would keep it */
  #glct-tracker-hud { right: 316px; top: 70px; }
  /* a stand-in PF2e sheet */
  .pf-sheet { position: fixed; left: 90px; top: 50px; width: 640px; height: 700px; display: grid; grid-template-columns: 52px 1fr;
    background: #e9e2d2; border-radius: 6px; box-shadow: 0 16px 50px #000b; overflow: hidden; }
  .pf-sheet nav { background: #2d1a14; display: flex; flex-direction: column; gap: 4px; padding: 10px 6px; }
  .pf-sheet nav a { width: 40px; height: 36px; display: grid; place-items: center; color: #d9c7a5; border-radius: 4px; }
  .pf-sheet nav a.active { background: #5e0000; color: #fff; }
  .pf-sheet .sheet-body { position: relative; }
  .pf-sheet .tab { display: none; height: 100%; }
  .pf-sheet .tab.active { display: block; }
  .pf-sheet .pf-head { height: 72px; background: linear-gradient(90deg, #5e0000, #3b0a0a); color: #fff; font: 700 22px Signika, sans-serif; display: flex; align-items: center; padding: 0 18px; }
  /* a stand-in editor window and chat log */
  .fake-dialog { position: fixed; left: 50%; top: 60px; translate: -50% 0; width: 400px; }
  .fake-dialog .window-header { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; }
  .fake-dialog .window-header i { font-size: 12px; }
  .fake-dialog .form-footer { display: flex; }
  .fake-dialog .form-footer button { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
  #chat { position: fixed; right: 0; top: 36px; width: 300px; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
  #chat .chat-message { background: #1d1d22; border: 1px solid #ffffff14; border-radius: 5px; color: #ddd; font: 13px Signika, sans-serif; }
  #chat .message-header { display: flex; justify-content: space-between; }
  #chat .message-metadata { display: flex; gap: 6px; }
  #err { position: fixed; left: 8px; bottom: 70px; color: #ff6b6b; font: 12px monospace; white-space: pre; z-index: 999; }
</style></head>
<body>
<div id="map"></div>
<div id="controls"><i class="fa-solid fa-user"></i><i class="fa-solid fa-ruler"></i><i class="fa-solid fa-lightbulb"></i><i class="fa-solid fa-gem"></i></div>
<div id="sidebar"><div class="tabs"></div></div>
<div id="hotbar">${"<i></i>".repeat(10)}</div>
<div id="stage"></div>
<div id="err"></div>
<script type="module">
const q = new URLSearchParams(location.search);
const LANG = Object.assign({},
  await (await fetch("/lang/en.json")).json().catch(() => ({})),
  await (await fetch("/lang/clocks-tracker.en.json")).json());
const L = (k, d) => {
  const s = LANG[k];
  if (s === undefined) { console.warn("missing i18n", k); return k; }
  return d ? s.replace(/\\{(\\w+)\\}/g, (_, x) => d[x] ?? "") : s;
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// The editor module reads foundry.applications.api at import and the escape
// helper at call time; the rest of what it touches is in the shipped files.
globalThis.foundry = { applications: { api: { DialogV2: {}, ApplicationV2: class {}, HandlebarsApplicationMixin: (c) => c } }, utils: { escapeHTML: esc } };
globalThis.game = { i18n: { localize: (k) => L(k), format: (k, d) => L(k, d) } };

try {
  const { normalizeList, stepTracker, setTrackerValue } = await import("/scripts/features/clocks-tracker/trackers/tracker-model.js");
  const { listView, poolCardView } = await import("/scripts/features/clocks-tracker/trackers/view.js");
  const { TrackerList, dockShellHTML, sheetShellHTML, paintShell, poolCardHTML } = await import("/scripts/features/clocks-tracker/trackers/tracker-render.js");

  const TABLE = [
    { id: "alarm", type: "point", order: 1, name: "Alarm", value: 7, min: 0, max: 10, prominent: true },
    { id: "ritual", type: "clock", order: 2, name: "Ritual completes", slices: 6, value: 4 },
    { id: "cult", type: "clock", order: 3, name: "The cult arrives", slices: 8, value: 8, bad: true },
    { id: "sep", type: "separator", order: 4, label: "Party" },
    { id: "torch", type: "pool", order: 5, name: "Torches", size: 6, count: 6, discard: 2, current: 4, playerRoll: true },
    { id: "insp", type: "point", order: 6, name: "Inspiration", value: 2, min: null, max: null, visibleToPlayers: false },
    { id: "lock", type: "task", order: 7, title: "Pick the lock", subtitle: "Thievery DC 22, one box per success", boxes: 5, value: 2 },
    { id: "hall", type: "hazard", order: 8, title: "Ceiling collapse", subtitle: "Each round in the hall", boxes: 8, value: 5 },
  ];
  const SHEET = [
    { id: "focus", type: "pool", order: 1, name: "Focus", size: 6, count: 3, discard: 1, current: 3 },
    { id: "vow", type: "clock", order: 2, name: "Oath to the river", slices: 4, value: 1 },
    { id: "sepb", type: "separator", order: 3, label: "Downtime" },
    { id: "craft", type: "task", order: 4, title: "Craft a +1 striking rune", subtitle: "4 days of work", boxes: 4, value: 3 },
    { id: "debt", type: "point", order: 5, name: "Debt to the guild", value: -40, min: null, max: null },
  ];

  const stage = document.getElementById("stage");
  const state = { list: [], view: null, ui: null };

  function mountDock({ isGM, compact, data }) {
    const app = document.createElement("div");
    app.id = "glct-tracker-hud";
    app.className = "glct glct-trk-skin";
    app.innerHTML = dockShellHTML({ canWrite: isGM, compact }, L);
    stage.append(app);
    const list = new TrackerList(app.querySelector("[data-rows]"), {
      L, variant: "dock",
      onAction: ({ act, id }) => {
        if (act === "inc") bump(id, +1);
        else if (act === "dec") bump(id, -1);
        else if (act === "roll") roll(id);
        else if (act === "reset") { const t = state.list.find((x) => x.id === id); setTrackerValue(t, t.count); repaint(); }
      },
    });
    state.list = normalizeList(data);
    state.ui = { app, list, ctx: { isGM, canWrite: isGM, compact } };
    repaint(false);
  }

  function mountSheet() {
    const sheet = document.createElement("div");
    sheet.className = "pf-sheet";
    sheet.innerHTML = '<nav><a><i class="fa-solid fa-user"></i></a><a><i class="fa-solid fa-swords"></i></a><a><i class="fa-solid fa-backpack"></i></a><a class="active"><i class="fa-solid fa-list-check"></i></a></nav>'
      + '<div class="sheet-body"><section class="tab active glct-trk-tab glct-trk-skin"></section></div>';
    stage.append(sheet);
    const section = sheet.querySelector("section");
    section.innerHTML = sheetShellHTML({ canWrite: true }, L);
    const list = new TrackerList(section.querySelector("[data-rows]"), { L, variant: "sheet", onAction: ({ act, id }) => {
      if (act === "inc") bump(id, +1); else if (act === "dec") bump(id, -1); else if (act === "roll") roll(id);
    } });
    state.list = normalizeList(SHEET);
    state.ui = { app: section, list, ctx: { isGM: false, canWrite: true, sheet: true } };
    repaint(false);
  }

  function repaint(animate = true) {
    const { app, list, ctx } = state.ui;
    const view = listView(state.list, ctx);
    list.update(view, { animate });
    paintShell(app, view);
    app.hidden = !view.show;
  }

  function bump(id, d) {
    const t = state.list.find((x) => x.id === id);
    if (t && stepTracker(t, d)) repaint(true);
  }

  function roll(id) {
    const t = state.list.find((x) => x.id === id);
    if (!t || t.current <= 0) return;
    const faces = Array.from({ length: t.current }, (_, i) => ((i * 5 + 3) % t.size) + 1);
    setTrackerValue(t, faces.filter((v) => v > t.discard).length);
    repaint(true);
  }

  async function mountEditor(edit) {
    const { TrackerEditor } = await import("/scripts/features/clocks-tracker/apps/tracker-editor.js");
    const { makeNewTracker } = await import("/scripts/features/clocks-tracker/trackers/tracker-model.js");
    const t = edit ? normalizeList([TABLE[4]])[0] : makeNewTracker("clock", { name: "Reinforcements arrive", slices: 8, value: 3, bad: true });
    const store = { isActor: false };
    const dlg = document.createElement("div");
    dlg.className = "application fake-dialog glct-trk-skin glct-trk-dialog";
    dlg.innerHTML = '<header class="window-header"><i class="fa-solid ' + (edit ? "fa-pen" : "fa-plus") + '"></i><h1 class="window-title" style="margin:0;font-size:14px">'
      + esc(edit ? L("GLCT.tracker.edit") + " \\u00b7 " + L("GLCT.tracker.types.pool") : L("GLCT.tracker.add")) + '</h1></header>'
      + '<form class="window-content">' + TrackerEditor._form(t, { creating: !edit, isActor: false })
      + '<footer class="form-footer"><button type="submit" data-action="save"><i class="fa-solid fa-check"></i>' + esc(L(edit ? "GLCT.tracker.save" : "GLCT.tracker.create"))
      + '</button><button type="button" data-action="cancel"><i class="fa-solid fa-xmark"></i>' + esc(L("GLCT.tracker.cancel")) + '</button></footer></form>';
    stage.append(dlg);
    TrackerEditor._wire(dlg, t, false);
  }

  function mountCards() {
    const chat = document.createElement("div");
    chat.id = "chat";
    const card = (name, faces, size, discard) => '<li class="chat-message glct-pool-msg"><header class="message-header"><h4 class="message-sender">' + esc(name)
      + '</h4><span class="message-metadata"><time>1m ago</time><a><i class="fa-solid fa-trash"></i></a></span></header><div class="message-content">'
      + poolCardHTML(poolCardView({ name, faces, size, discard, before: faces.length }), L) + '</div></li>';
    chat.innerHTML = card("Torches", [5, 2, 6, 1, 4, 3], 6, 2) + card("Rations", [1, 2, 1], 6, 2);
    stage.append(chat);
  }

  function set(scene) {
    stage.replaceChildren();
    if (scene === "player") mountDock({ isGM: false, compact: false, data: TABLE });
    else if (scene === "compact") mountDock({ isGM: true, compact: true, data: TABLE });
    else if (scene === "empty") mountDock({ isGM: true, compact: false, data: [] });
    else if (scene === "sheet") mountSheet();
    else if (scene === "editor") return mountEditor(false);
    else if (scene === "edit") return mountEditor(true);
    else if (scene === "card") mountCards();
    else mountDock({ isGM: true, compact: false, data: TABLE });
  }

  await set(q.get("scene") ?? "gm");
  window.__trackers = { set, bump, get list() { return state.list; } };

  const STEPS = [["alarm", 1], ["ritual", 2], ["lock", 1], ["hall", 3], ["insp", 9], ["torch", -1]];
  if (q.get("step") && state.ui) setTimeout(() => {
    for (const [id, d] of STEPS) if (id === "torch") roll(id); else bump(id, d);
  }, 300);
  if (q.get("live") && state.ui) {
    let i = 0;
    setInterval(() => { const [id, d] = STEPS[i++ % STEPS.length]; bump(id, i % 2 ? d : -d); }, 1400);
  }
} catch (e) {
  document.getElementById("err").textContent = e.stack;
}
</script></body></html>
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html);
console.log(`wrote ${OUT}`);
