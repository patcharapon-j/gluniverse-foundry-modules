#!/usr/bin/env node
/**
 * Hexcrawl: the UI preview (every surface that is not the map).
 *
 * Drives the SHIPPED apps, tooltip, arrival card, import window and dialogs
 * under Node with Foundry stubbed just enough to construct them: each app's own
 * `_prepareContext` builds the context, the shipped Handlebars template renders
 * it, and the shipped `tooltipHTML` / `arrivalHTML` / `rollEncounter` write the
 * play surfaces. Nothing is restated, so the page cannot flatter a copy. The
 * page links the shipped stylesheets over the preview server, at 1:1.
 *
 *   node tools/hexcrawl-ui-preview.mjs [--out=.preview/hexcrawl-ui.html]
 *        [--foundry=<Foundry's resources/app>]   (Handlebars + Foundry's own CSS)
 *   node tools/preview-server.mjs
 *   → http://localhost:8931/.preview/hexcrawl-ui.html
 *
 * With a Foundry install found, its `foundry2.css` and Font Awesome are copied
 * beside the page, so every control is drawn over Foundry's element-level
 * styles exactly as in a world: a sheet that only looks right without them is
 * the bug this preview exists to show. `?only=<id,id>` keeps a subset;
 * `?ground=parchment` lays the chat cards on a light log.
 */

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = resolve(ROOT, arg("out") ?? ".preview/hexcrawl-ui.html");
const FOUNDRY = [arg("foundry"), process.env.FOUNDRY_APP, "C:/Program Files/Foundry Virtual Tabletop/resources/app", "/opt/foundryvtt/resources/app"]
  .find((p) => p && existsSync(join(p, "public", "css", "foundry2.css")));

/* ── Handlebars (Foundry's own copy, else one installed beside the repo) ── */
let Handlebars;
try {
  Handlebars = createRequire(FOUNDRY ? join(FOUNDRY, "package.json") : join(ROOT, "package.json"))("handlebars");
} catch {
  console.error("hexcrawl-ui-preview: Handlebars not found. Pass --foundry=<Foundry's resources/app> (or set FOUNDRY_APP).");
  process.exit(1);
}

/* ── i18n from the shipped lang files ── */
const flat = (o, p = "", out = {}) => {
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k;
    if (v && typeof v === "object") flat(v, key, out); else out[key] = v;
  }
  return out;
};
const LANG = {};
for (const f of ["en.json", ...readdirSync(join(ROOT, "lang")).filter((f) => /^hexcrawl.*\.en\.json$/.test(f))]) {
  Object.assign(LANG, flat(JSON.parse(readFileSync(join(ROOT, "lang", f), "utf8"))));
}
const localize = (k) => LANG[k] ?? k;
const format = (k, data = {}) => localize(k).replace(/\{(\w+)\}/g, (_, n) => (n in data ? String(data[n]) : `{${n}}`));
Handlebars.registerHelper("localize", (key, opts) => (opts?.hash && Object.keys(opts.hash).length ? format(key, opts.hash) : localize(key)));

/* ── Foundry, stubbed just enough to construct the shipped apps ── */
const apps = [];
const dialogs = [];
const messages = [];
const merge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) {
    if (k === "classes") out.classes = [...(a?.classes ?? []), ...v];
    else if (v && typeof v === "object" && !Array.isArray(v) && typeof v !== "function") out[k] = merge(a?.[k] ?? {}, v);
    else out[k] = v;
  }
  return out;
};
class ApplicationV2 {
  constructor(options = {}) {
    let opts = {};
    const chain = [];
    for (let c = this.constructor; c && c !== Object; c = Object.getPrototypeOf(c)) if (Object.hasOwn(c, "DEFAULT_OPTIONS")) chain.unshift(c.DEFAULT_OPTIONS);
    for (const o of chain) opts = merge(opts, o);
    this.options = merge(opts, options);
    this.position = { ...this.options.position };
  }
  get id() { return this.options.id; }
  get title() { return localize(this.options.window?.title ?? ""); }
  async _prepareContext() { return {}; }
  render() { apps.push(this); return this; }
  bringToFront() {}
  close() {}
}
class DialogV2 {
  static async wait(o) { dialogs.push(o); return null; }
  static async prompt(o) { dialogs.push(o); return null; }
  static async confirm(o) { dialogs.push(o); return false; }
}
globalThis.foundry = {
  applications: { api: { ApplicationV2, HandlebarsApplicationMixin: (B) => B, DialogV2 }, instances: new Map() },
  utils: { randomID: () => "preview", flattenObject: (o) => o, expandObject: (o) => o },
};
globalThis.Hooks = { on: () => 0, off() {}, callAll() {}, once() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.CONFIG = { sounds: {} };
globalThis.fromUuidSync = () => null;
const user = { isGM: true, id: "gm" };
globalThis.game = { i18n: { localize, format }, user, users: [user], settings: { get: () => undefined }, scenes: { get: () => scene } };
globalThis.ChatMessage = { create: async (d) => { messages.push(d); return d; } };
globalThis.Roll = class { constructor(f) { this.formula = f; } async evaluate() { this.dice = [{ results: [{ result: 1 }, { result: 4 }, { result: 6 }] }]; return this; } };

const imp = (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const { SUITE_ID } = await imp("scripts/core/const.mjs");
const C = await imp("scripts/features/hexcrawl/constants.mjs");
const I = await imp("scripts/features/hexcrawl/import.mjs");
const M = await imp("scripts/features/hexcrawl/model.mjs");
const { HexStore } = await imp("scripts/features/hexcrawl/store.mjs");

/* ── the sample: the import format's own example, filled out ── */
const example = I.exampleImport();
const parsed = I.parseImport(example);
const map = parsed.map;
const key = (i, j) => `${i},${j}`;
map.hexes[key(2, 1)] = { ...map.hexes[key(2, 1)], nt: "The stair is rotten past the second landing.",
  lm: [...(map.hexes[key(2, 1)]?.lm ?? []), { icon: "fa-solid fa-skull", label: "Ogre's larder", vis: "gm", journal: null, color: null, size: 1 }] };
map.hexes[key(5, 2)] = { ...(map.hexes[key(5, 2)] ?? {}), st: "masked", mk: { p: "sight" } };
map.hexes[key(7, 5)] = { ...(map.hexes[key(7, 5)] ?? {}), bd: true };
map.regions.whisperwood.notes = "The wolves answer to the hag at the wood's heart.";
map.regions.ashwaste = { id: "ashwaste", name: "The Ashen Waste", nk: false, t: "ashfield", rt: 4, bl: true, color: null };
for (const k of [key(3, 2), key(3, 3), key(4, 3)]) map.hexes[k] = { ...(map.hexes[k] ?? {}), rg: "ashwaste", st: "revealed" };
const scene = {
  id: "scene", name: example.scene.name, grid: { type: C.HEX_TYPES?.HEXODDQ ?? 2, size: 100 },
  flags: { [SUITE_ID]: { [C.FLAGS.enabled]: true, [C.FLAGS.map]: map, [C.FLAGS.moves]: [{ id: "m1", leg: "0", seconds: 172800 }] } },
  getFlag(scope, k) { return this.flags[scope]?.[k]; },
};
globalThis.canvas = { scene };
const adapter = { keyAt: () => null, inBounds: () => true };
const store = new HexStore(scene, adapter);
HexStore.current = store;
store.staged = new Set([key(5, 2), key(6, 2), key(6, 3)]);

/* ── render every app the way Foundry would ── */
const A = await imp("scripts/features/hexcrawl/apps/index.mjs");
const TEMPLATES = Object.fromEntries(readdirSync(join(ROOT, "templates", "hexcrawl"))
  .map((f) => [basename(f, ".hbs"), Handlebars.compile(readFileSync(join(ROOT, "templates", "hexcrawl", f), "utf8"))]));

const frame = (app, body, { id, note, width } = {}) => {
  const o = app.options;
  const tag = o.tag ?? "div";
  const w = width ?? o.position?.width ?? 420;
  const h = typeof o.position?.height === "number" ? `height:${o.position.height}px;` : "";
  return { id, note, html: `<${tag} class="application themed theme-dark ${(o.classes ?? []).join(" ")}" style="position:relative;inset:auto;width:${w}px;${h}">`
    + `<header class="window-header"><i class="window-icon ${o.window?.icon ?? ""}"></i><h1 class="window-title">${Handlebars.escapeExpression(app.title)}</h1>`
    + `<button type="button" class="header-control icon fa-solid fa-xmark"></button></header>`
    + `<section class="window-content">${body}</section></${tag}>` };
};
async function renderApp(open, { id, note, setup } = {}) {
  apps.length = 0;
  foundry.applications.instances.clear();
  // The icon picker resolves only when an icon is chosen; it has rendered by then.
  await Promise.race([open(), new Promise((r) => setTimeout(r, 50))]);
  const app = apps.at(-1);
  if (!app) throw new Error(`${id}: nothing rendered`);
  setup?.(app);
  const ctx = await app._prepareContext({});
  const tplName = basename(app.constructor.PARTS.main.template, ".hbs");
  return frame(app, TEMPLATES[tplName](ctx), { id, note });
}
const brush = (tool, value = null, stage = false) => () => { store.brush = { tool, value, stage }; };

const shots = [];
const pal = async (id, note, b) => { b(); shots.push(await renderApp(() => A.openPalette(), { id, note })); };
await pal("palette-terrain", "Palette · terrain brush, three hexes staged", brush("terrain", "forest", true));
await pal("palette-rating", "Palette · rating brush", brush("rating", 3));
await pal("palette-state", "Palette · state brush on a mask preset", brush("state", "sight"));
await pal("palette-region", "Palette · region brush (picking)", brush("region", "whisperwood"));
await pal("palette-toggle", "Palette · blight brush, nothing staged", () => { brush("blight", true)(); store.staged = new Set(); });
store.staged = new Set([key(5, 2)]);
shots.push(await renderApp(() => A.openHexEditor(key(2, 1)), { id: "hex-landmarks", note: "Hex editor · two landmarks, one the party cannot see" }));
shots.push(await renderApp(() => A.openHexEditor(key(5, 2)), { id: "hex-masked", note: "Hex editor · a masked hex" }));
shots.push(await renderApp(() => A.openHexEditor(key(7, 5)), { id: "hex-border", note: "Hex editor · a border hex" }));
shots.push(await renderApp(() => A.openRegionEditor("whisperwood"), { id: "region", note: "Region editor" }));
shots.push(await renderApp(() => A.openSceneSettings(), { id: "scene-settings", note: "Scene settings" }));
shots.push(await renderApp(() => A.openTerrainManager(), { id: "terrains", note: "Terrain manager · a custom terrain open",
  setup: (app) => { app.selected = "ashfield"; } }));
shots.push(await renderApp(() => A.pickIcon({ icon: "fa-solid fa-tower-observation" }), { id: "icons", note: "Landmark icon picker" }));

/* ── the import window: the example checked, then a broken paste ── */
const ID = await imp("scripts/features/hexcrawl/import-dialog.mjs");
for (const [id, note, text] of [
  ["import", "Import · the example, checked", JSON.stringify({ ...example, scene: { ...example.scene, weather: "fog" }, layout: { ...example.layout, rows: [...example.layout.rows, "..??.."] } }, null, 2)],
  ["import-error", "Import · not JSON", "{ \"format\": \"glhex-map\", "],
]) {
  apps.length = 0;
  const app = ID.openImportDialog();
  app.text = text;
  app.parsed = null; app.error = null;
  try { app.parsed = I.parseImport(text); } catch (e) { app.error = e.message; }
  shots.push(frame(app, await app._renderHTML(), { id, note, width: 560 }));
  globalThis.__imp = null;
}

/* ── dialogs ── */
const dialogFrame = (o, { id, note }) => ({ id, note, html: `<dialog open class="application dialog themed theme-dark ${(o.classes ?? []).join(" ")}" style="position:relative;inset:auto;width:${o.position?.width ?? 400}px">`
  + `<header class="window-header"><i class="window-icon ${o.window?.icon ?? ""}"></i><h1 class="window-title">${Handlebars.escapeExpression(o.window?.title ?? "")}</h1><button type="button" class="header-control icon fa-solid fa-xmark"></button></header>`
  + `<form class="window-content"><div class="dialog-content standard-form">${o.content}</div><footer class="form-footer">`
  + (o.buttons ?? [o.ok ?? { action: "ok", label: "OK", default: true }]).map((b) => `<button type="button" data-action="${b.action ?? "ok"}" class="${b.default ? "default" : ""}" ${b.default ? "autofocus" : ""}>${b.icon ? `<i class="${b.icon}"></i>` : ""}<span>${Handlebars.escapeExpression(b.label)}</span></button>`).join("")
  + `</footer></form></dialog>` });
const SS = await imp("scripts/features/hexcrawl/scene-setup.mjs");
await SS.openSceneDialog();
shots.push(dialogFrame(dialogs.at(-1), { id: "scene-dialog", note: "Scene dialog" }));

/* ── tooltips: what each viewer is handed ── */
const T = await imp("scripts/features/hexcrawl/tooltip.mjs");
const tip = (id, note, k, { gm = true, vap = false, pinned = false } = {}) => {
  user.isGM = gm; store.viewAsPlayers = vap;
  const html = T.tooltipHTML(store, k);
  user.isGM = true; store.viewAsPlayers = false;
  shots.push({ id, note, html: html ? `<div class="glhex-tooltip is-visible${pinned ? " is-pinned" : ""}" style="position:relative;left:auto;top:auto">${html}</div>` : `<p class="pv-none">(nothing: this viewer is handed no tooltip)</p>` });
};
tip("tip-gm", "Tooltip · GM, a revealed hex with landmarks and notes", key(2, 1));
tip("tip-gm-pinned", "Tooltip · GM, pinned on the blighted waste", key(3, 3), { pinned: true });
tip("tip-gm-masked", "Tooltip · GM, a masked hex", key(5, 2));
tip("tip-player-masked", "Tooltip · player, the same masked hex", key(5, 2), { gm: false });
tip("tip-player", "Tooltip · player, the watchtower hex", key(2, 1), { gm: false });
tip("tip-border", "Tooltip · GM, a border hex", key(7, 5));

/* ── chat: the arrival card and both encounter results ── */
const AR = await imp("scripts/features/hexcrawl/arrival.mjs");
const chat = (id, note, content) => shots.push({ id, note, chat: true, html: `<li class="chat-message message flexcol"><header class="message-header flexrow"><h4 class="message-sender">${localize("GLHEX.card.speaker")}</h4></header><div class="message-content">${content}</div></li>` });
chat("card-arrival", "Arrival card", AR.arrivalHTML(scene, { to: key(2, 1), cost: 3, advanced: true }));
await AR.rollEncounter({ formula: "3d6", trigger: 1, key: key(2, 1), scene: "scene" });
chat("card-roll-hit", "Encounter roll · triggered", messages.at(-1).content);
globalThis.Roll = class { constructor(f) { this.formula = f; } async evaluate() { this.dice = [{ results: [{ result: 3 }, { result: 5 }] }]; return this; } };
await AR.rollEncounter({ formula: "2d6", trigger: 1, key: key(1, 1), scene: "scene" });
chat("card-roll-quiet", "Encounter roll · quiet", messages.at(-1).content);

/* ── the page ── */
mkdirSync(dirname(OUT), { recursive: true });
const rel = relative(dirname(OUT), ROOT).replaceAll("\\", "/") || ".";
let foundryCss = "";
if (FOUNDRY) {
  const dest = join(dirname(OUT), "foundry");
  mkdirSync(join(dest, "css"), { recursive: true });
  copyFileSync(join(FOUNDRY, "public", "css", "foundry2.css"), join(dest, "css", "foundry2.css"));
  cpSync(join(FOUNDRY, "public", "fonts"), join(dest, "fonts"), { recursive: true });
  foundryCss = `<link rel="stylesheet" href="foundry/fonts/fontawesome/css/all.min.css"><link rel="stylesheet" href="foundry/css/foundry2.css">`;
}
const manifest = JSON.parse(readFileSync(join(ROOT, "module.json"), "utf8"));
const sheets = manifest.styles.filter((s) => /gl-(fonts|tokens|motion)|hexcrawl/.test(s)).map((s) => `<link rel="stylesheet" href="${rel}/${s}">`).join("");
const page = `<!doctype html><html><head><meta charset="utf-8"><title>Hexcrawl UI preview</title>${foundryCss}${sheets}
<style>
  body.pv { margin: 0; padding: 24px; background: #2a2d33; color: #ccc; font: 13px system-ui, sans-serif; overflow: auto; }
  .pv-grid { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 28px; }
  .pv-shot { display: flex; flex-direction: column; gap: 8px; }
  .pv-shot > h2 { margin: 0; font: 600 12px system-ui, sans-serif; color: #9aa; letter-spacing: 0.02em; }
  .pv-chat { width: 300px; padding: 8px; background: var(--color-cool-5, #1a1c22); list-style: none; margin: 0; }
  body.pv-parchment .pv-chat { background: #e8dfcc; }
  .pv-none { color: #8a8; font-style: italic; }
  #glhex-palette, .application { margin: 0; }
</style></head>
<body class="pv vtt game theme-dark">
<div class="pv-grid">
${shots.map((s) => `<section class="pv-shot" data-id="${s.id}"><h2>${s.note}</h2>${s.chat ? `<ol class="pv-chat chat-log">${s.html}</ol>` : s.html}</section>`).join("\n")}
</div>
<script>
  const q = new URLSearchParams(location.search);
  const only = q.get("only")?.split(",");
  if (only) for (const s of document.querySelectorAll(".pv-shot")) if (!only.includes(s.dataset.id)) s.remove();
  if (q.get("ground") === "parchment") document.body.classList.add("pv-parchment");
  if (q.get("zoom")) document.body.style.zoom = q.get("zoom");
</script>
</body></html>`;
writeFileSync(OUT, page);
console.log(`wrote ${relative(ROOT, OUT)} (${shots.length} surfaces${FOUNDRY ? ", over Foundry's own CSS" : ", WITHOUT Foundry's CSS"}) — serve with: node tools/preview-server.mjs, then /${relative(ROOT, OUT).replaceAll("\\", "/")}`);
