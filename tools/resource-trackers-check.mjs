/**
 * GLUniverse Suite: Resource Trackers consistency check.
 *
 *   node tools/resource-trackers-check.mjs
 *
 * Everything here fails silently in Foundry:
 *   · a row with a missing or duplicated id renders and then edits, rolls or
 *     deletes the wrong tracker (ids are repaired on read, deterministically);
 *   · two quick clicks that both read 3 both write 4 (writes are queued);
 *   · a player's chat message can carry any pool count it likes (the GM
 *     re-derives the count from the faces, against the pool as it stands);
 *   · a render module that reads the world makes the preview a second copy;
 *   · Resource Trackers importing the time engine breaks a trackers-only world;
 *   · a runtime-built i18n key with no entry prints the key itself;
 *   · an editor field whose name drifts from the reader saves a default;
 *   · a skin rule outside the feature's root repaints the rest of Foundry.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = new URL("../", import.meta.url);
const ROOT = fileURLToPath(HERE);
const read = (p) => readFileSync(new URL(p, HERE), "utf8").replace(/\r\n/g, "\n");
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

let failures = 0, passes = 0;
function check(name, ok, detail = "") {
  if (ok) { passes++; return; }
  failures++;
  console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
}
const section = (s) => console.log(`\n${s}`);

const F = "scripts/features/clocks-tracker";
const FILES = {
  model: `${F}/trackers/tracker-model.js`,
  view: `${F}/trackers/view.js`,
  render: `${F}/trackers/tracker-render.js`,
  roll: `${F}/trackers/pool-roll.js`,
  store: `${F}/trackers/trackers.js`,
  actor: `${F}/trackers/actor-trackers.js`,
  hud: `${F}/apps/tracker-hud.js`,
  sheet: `${F}/apps/tracker-sheet.js`,
  editor: `${F}/apps/tracker-editor.js`,
};

/* ------------------------------- structure ------------------------------- */
section("purity and the engine split");

for (const k of ["model", "view", "render"]) {
  const src = code(FILES[k]);
  const hit = src.match(/\b(game|foundry|ui|Hooks|canvas|CONFIG)\s*[.?[]/);
  check(`${k} reaches no world`, !hit, hit?.[0]);
}
check("the model reaches no DOM", !/\b(document|window)\s*\./.test(code(FILES.model)));
check("the view model reaches no DOM", !/\b(document|window)\s*\./.test(code(FILES.view)));

const ENGINE = /from\s+["'][^"']*(calendar\/|weather\/|delving\/|engine\.js|time-math\.js|apps\/hud\.js|apps\/calendar|apps\/weather)/;
for (const [k, p] of Object.entries(FILES)) {
  const m = read(p).match(ENGINE);
  check(`${k} imports nothing of the time engine`, !m, m?.[0]);
}

const shell = read("templates/clocks-tracker/tracker-hud.hbs");
check("the dock template draws the shared shell", /\{\{\{shell\}\}\}/.test(shell));
check("the dock passes the shell to its template", /shell:\s*dockShellHTML\(/.test(code(FILES.hud)));
const manifest = JSON.parse(read("module.json"));
check("module.json loads the skin", manifest.styles.includes("styles/clocks-tracker-trackers.css"));
check("the old sheet stylesheet is gone", !existsSync(new URL("styles/clocks-tracker-tracker-sheet.css", HERE)));
check("the GM persists pool results from the document socket, not a module socket",
  /Hooks\.on\("createChatMessage"/.test(code(FILES.store)) && !/game\.socket/.test(code(FILES.store)));
check("the sheet tab is keyed by UUID (an unlinked token shares its actor's id)",
  /_mounts\.set\(actor\.uuid/.test(code(FILES.sheet)) && /this\.actor\?\.uuid/.test(code(FILES.actor)));
check("our tab's click never reaches Foundry's Tabs",
  /link\.addEventListener\("click"[\s\S]{0,120}stopPropagation\(\)/.test(code(FILES.sheet)));

/* --------------------------------- model --------------------------------- */
section("model");

const M = await import(new URL(FILES.model, HERE));
const V = await import(new URL(FILES.view, HERE));
const { TRACKER_TYPES } = await import(new URL(`${F}/const.js`, HERE));

{
  const raw = [
    { type: "clock", name: "A", slices: 6, value: 2, order: 2 },
    { id: "dup", type: "point", name: "B", value: 1, order: 1 },
    { id: "dup", type: "point", name: "C", value: 9, order: 3 },
    { id: "  ", type: "task", title: "D", boxes: 4, value: 1, order: 4 },
    null, "junk",
    { id: "x", type: "nonsense", value: "7" },
  ];
  const a = M.normalizeList(raw), b = M.normalizeList(raw);
  const ids = a.map((t) => t.id);
  check("every tracker gets an id", ids.every((x) => typeof x === "string" && x.length > 0), ids.join(","));
  check("ids are unique", new Set(ids).size === ids.length, ids.join(","));
  check("repaired ids are deterministic (the id a row renders is the id its click resolves)",
    JSON.stringify(ids) === JSON.stringify(b.map((t) => t.id)));
  check("the first holder of an id keeps it", a.find((t) => t.name === "B")?.id === "dup");
  check("non-objects are dropped", a.length === 5);
  check("an unknown type reads as a point", a.find((t) => t.id === "x")?.type === "point");
  check("display order follows `order`", a.map((t) => t.name ?? t.title).slice(1).join("") === "BACD",
    a.map((t) => t.name ?? t.title).join(","));
  check("the stored list is not mutated", raw[0].id === undefined);
}
{
  const t = M.sanitizeTracker({ type: "point", value: 50, min: 10, max: 2 });
  check("swapped bounds are put back in order", t.min === 2 && t.max === 10 && t.value === 10);
  const c = M.sanitizeTracker({ type: "clock", slices: 99, value: -3 });
  check("a clock is clamped", c.slices === 24 && c.value === 0);
  const p = M.sanitizeTracker({ type: "pool", count: 4, current: 9, discard: 80, size: 6 });
  check("a pool is clamped", p.current === 4 && p.discard === 6);
  const s = M.sanitizeTracker({ type: "separator", prominent: true, label: "  x " });
  check("a separator is never prominent", s.prominent === false && s.label === "x");
  const pt = M.makeNewTracker("point", {}, [], () => "id");
  check("a step past a point's bound reports no change", !M.stepTracker({ ...pt, max: 0, value: 0 }, +1));
  check("a step moves a clock", (() => { const k = M.makeNewTracker("clock", { slices: 4 }, [], () => "k"); return M.stepTracker(k, 2) && k.value === 2; })());
  const list = [{ id: "a", order: 0 }, { id: "b", order: 1 }];
  check("an unchanged reorder writes nothing", M.reorderList(list, ["a", "b"]) === false);
  check("a reorder moves", M.reorderList(list, ["b", "a"]) === true && list[0].order === 1);
}

section("pool results");
{
  const pool = M.sanitizeTracker({ id: "p", type: "pool", size: 6, count: 6, discard: 2, current: 4, playerRoll: true });
  const good = { faces: [1, 3, 6, 2], size: 6, discard: 2, current: 4 };
  check("a fitting result re-derives its count", M.verifyPoolResult(pool, good) === 2);
  check("the count a message carries is ignored", M.verifyPoolResult(pool, { ...good, current: 4 }) === 2);
  check("a stale result (the pool moved since) is refused", M.verifyPoolResult(pool, { ...good, faces: [6, 6, 6] }) === null);
  check("an impossible face is refused", M.verifyPoolResult(pool, { ...good, faces: [7, 1, 1, 1] }) === null);
  check("a non-integer face is refused", M.verifyPoolResult(pool, { ...good, faces: [1.5, 1, 1, 1] }) === null);
  check("a different die size is refused", M.verifyPoolResult(pool, { ...good, size: 8 }) === null);
  check("a different threshold is refused", M.verifyPoolResult(pool, { ...good, discard: 1 }) === null);
  check("a result with no faces (an old card) is refused", M.verifyPoolResult(pool, { current: 0 }) === null);
  check("a non-pool is refused", M.verifyPoolResult({ type: "clock" }, good) === null);
}

/* ---------------------------------- view ---------------------------------- */
section("view");
{
  const list = M.normalizeList([
    { id: "a", type: "point", name: "A", value: 3, max: 5, order: 1 },
    { id: "b", type: "clock", name: "B", slices: 4, value: 4, bad: true, order: 2, visibleToPlayers: false },
    { id: "c", type: "pool", name: "C", size: 6, count: 3, current: 0, order: 3 },
    { id: "d", type: "task", title: "D", boxes: 3, value: 3, order: 4 },
    { id: "e", type: "hazard", title: "E", boxes: 3, value: 3, order: 5 },
    { id: "f", type: "separator", label: "", order: 6 },
  ]);
  const gm = V.listView(list, { isGM: true, canWrite: true });
  const pl = V.listView(list, { isGM: false, canWrite: false });
  check("a GM sees every row, hidden ones marked", gm.rows.length === 6 && gm.rows.find((r) => r.id === "b").hidden);
  check("a player sees no hidden row", !pl.rows.some((r) => r.id === "b"));
  check("a player never sees a hidden mark", !pl.rows.some((r) => r.hidden));
  check("a player has no menu and no steppers", pl.rows.every((r) => !r.menu && !r.canStep));
  check("a player cannot roll a closed pool", !pl.rows.find((r) => r.id === "c").rollable);
  check("a player with nothing to see gets no dock", V.listView([], { isGM: false }).show === false);
  check("a GM with nothing gets the empty dock", V.listView([], { isGM: true, canWrite: true }).show === true);
  const tags = gm.rows.map((r) => r.tag);
  check("a filled bad clock reads doom", gm.rows.find((r) => r.id === "b").tag === "doom");
  check("an empty pool reads empty and cannot roll", gm.rows.find((r) => r.id === "c").tag === "empty" && !gm.rows.find((r) => r.id === "c").canRoll);
  check("a full task reads done, a full hazard sprung", tags.includes("done") && tags.includes("sprung"));
  check("every tag has a key", gm.rows.every((r) => !r.tag || V.TAGS[r.tag]));
  check("every tone is known", gm.rows.every((r) => V.TONES.includes(r.tone)));
  check("separators are not counted", gm.count === 5);
  check("a sheet view never marks anything hidden or prominent",
    V.listView(list.map((t) => ({ ...t, prominent: true })), { isGM: true, canWrite: true, sheet: true }).rows.every((r) => !r.hidden && !r.prominent));
  check("a value change keeps the row's shape (it animates in place)",
    V.rowView({ ...list[0], value: 4 }, { isGM: true, canWrite: true }).sig === V.rowView(list[0], { isGM: true, canWrite: true }).sig);
  check("delta text", V.deltaText(3, 5) === "+2" && V.deltaText(5, 3) === "−2" && V.deltaText(1, 1) === "");
}

/* --------------------------------- stores --------------------------------- */
section("stores");

// A Foundry-shaped stand-in: settings land after a tick, like a server round trip.
const SUITE = "gluniverse-foundry-modules";
const settings = new Map();
let writes = 0;
const hooks = new Map();
const gmUser = { id: "gm", isGM: true, active: true };
const player = { id: "pl", isGM: false, active: true };
globalThis.game = {
  user: gmUser,
  users: Object.assign([gmUser, player], { get: (id) => [gmUser, player].find((u) => u.id === id) }),
  i18n: { localize: (k) => k, format: (k) => k },
  settings: {
    get: (ns, k) => structuredClone(settings.get(`${ns}.${k}`)),
    set: async (ns, k, v) => { await new Promise((r) => setTimeout(r, 5)); writes++; settings.set(`${ns}.${k}`, structuredClone(v)); },
  },
};
globalThis.Hooks = { on: (n, f) => hooks.set(n, f), callAll() {} };
globalThis.ui = { notifications: { warn() {} } };

const { TrackerStore } = await import(new URL(FILES.store, HERE));
settings.set(`${SUITE}.ct.trackers`, [
  { id: "c", type: "clock", name: "C", slices: 8, value: 0, order: 0 },
  { id: "p", type: "pool", name: "P", size: 6, count: 6, discard: 2, current: 4, playerRoll: false, order: 1 },
]);
await Promise.all([TrackerStore.step("c", 1), TrackerStore.step("c", 1), TrackerStore.step("c", 1)]);
check("three quick steps land as three (writes are queued)", TrackerStore.get("c").value === 3, `value ${TrackerStore.get("c").value}`);
writes = 0;
await TrackerStore.reorder(["c", "p"]);
check("a reorder that changes nothing writes nothing", writes === 0);
await TrackerStore.step("c", 99);
await TrackerStore.step("c", 1);
check("a step past the end writes nothing", writes === 1);

TrackerStore.registerHandlers();
const onCreate = hooks.get("createChatMessage");
check("the GM listens for pool cards", typeof onCreate === "function");
const card = (author, flag) => ({ author, flags: { [SUITE]: { ct: { poolRoll: true, trackerId: "p", ...flag } } } });
const settle = () => new Promise((r) => setTimeout(r, 40));

onCreate(card(player, { faces: [1, 1, 1, 1], size: 6, discard: 2, current: 0 }));
await settle();
check("a player cannot spend a pool the GM did not open", TrackerStore.get("p").current === 4);

onCreate(card(gmUser, { faces: [1, 2, 3, 6], size: 6, discard: 2, current: 4 }));
await settle();
check("a GM roll persists the count its faces give, not the flag's", TrackerStore.get("p").current === 2);

onCreate(card(gmUser, { faces: [6, 6, 6, 6], size: 6, discard: 2, current: 4 }));
await settle();
check("a stale card (rolled against 4 dice, pool now 2) is refused", TrackerStore.get("p").current === 2);

await TrackerStore.update("p", { playerRoll: true });
onCreate(card(player, { faces: [5, 1], size: 6, discard: 2, current: 2 }));
await settle();
check("a player may spend a pool the GM opened", TrackerStore.get("p").current === 1);

onCreate({ author: gmUser, flags: { [SUITE]: { ct: { poolRoll: true, trackerId: "p", actorPool: true, faces: [1], size: 6, discard: 2 } } } });
await settle();
check("a sheet pool's card never reaches the world store", TrackerStore.get("p").current === 1);

await TrackerStore.setTo("c", "min");
globalThis.game.user = player;
await TrackerStore.step("c", 1);
check("a player cannot write the world list", TrackerStore.get("c").value === 0);
globalThis.game.user = gmUser;

await TrackerStore.update("c", { id: "hijack", type: "pool" });
check("an update cannot change a tracker's id or type", TrackerStore.get("c")?.type === "clock");

{
  const { ActorTrackerStore } = await import(new URL(FILES.actor, HERE));
  const flags = new Map();
  const actor = {
    id: "same", uuid: "Actor.same", isOwner: true,
    getFlag: (_ns, k) => structuredClone(flags.get(k) ?? []),
    update: async (data) => {
      await new Promise((r) => setTimeout(r, 5));
      for (const [k, v] of Object.entries(data)) flags.set(k.replace(`flags.${SUITE}.`, ""), structuredClone(v));
    },
  };
  const s = new ActorTrackerStore(actor);
  await s.create("clock", { name: "Oath", slices: 4 });
  const id = s.all[0].id;
  await Promise.all([s.step(id, 1), s.step(id, 1)]);
  check("sheet steps are queued too", s.get(id).value === 2, `value ${s.get(id).value}`);
  await s.setTo(id, "max");
  check("fill goes to the top of the range", s.get(id).value === 4);
  await s.setTo(id, "min");
  check("clear goes to the bottom", s.get(id).value === 0);
  await s.duplicate(id);
  check("a duplicate gets its own id", new Set(s.all.map((t) => t.id)).size === 2);
  check("a sheet store writes nothing for a non-owner", await new ActorTrackerStore({ ...actor, isOwner: false }).step(id, 1) === false);
}

/* --------------------------------- editor --------------------------------- */
section("editor");
{
  globalThis.foundry = { applications: { api: { DialogV2: {} } }, utils: { escapeHTML: (s) => String(s) } };
  const { TrackerEditor, FIELDS_BY_TYPE } = await import(new URL(FILES.editor, HERE));
  const samples = {
    point: { name: "Alarm", value: 4, min: 0, max: 9 },
    clock: { name: "Ritual", slices: 8, value: 5, bad: true },
    pool: { name: "Torches", count: 6, size: 8, discard: 3, current: 2, playerRoll: true },
    task: { title: "Lock", subtitle: "DC 22", boxes: 5, value: 2 },
    hazard: { title: "Roof", subtitle: "Each round", boxes: 7, value: 6 },
    separator: { label: "Party" },
  };
  for (const type of TRACKER_TYPES) {
    check(`the editor knows which fields a ${type} shows`, Array.isArray(FIELDS_BY_TYPE[type]));
    const t = M.makeNewTracker(type, { ...samples[type], prominent: type !== "separator", visibleToPlayers: false }, [], () => "e");
    const html = TrackerEditor._form(t, { creating: true, isActor: false });
    const elements = { type: { value: type } };
    for (const m of html.matchAll(/<input type="(\w+)" name="(\w+)"([^>]*)>/g)) {
      const [, kind, name, rest] = m;
      const value = /value="([^"]*)"/.exec(rest)?.[1] ?? "";
      elements[name] = { value, checked: kind === "checkbox" && /\schecked/.test(rest) };
    }
    for (const f of FIELDS_BY_TYPE[type]) check(`the ${type} form has a "${f}" input`, !!elements[f]);
    const back = M.sanitizeTracker({ ...TrackerEditor._read({ elements }, false), id: "e", order: t.order });
    const same = Object.keys(samples[type]).every((k) => back[k] === t[k]);
    check(`a ${type} round-trips through the form`, same && back.visibleToPlayers === false,
      JSON.stringify(Object.fromEntries(Object.keys(samples[type]).map((k) => [k, [t[k], back[k]]]))));
    const actorHtml = TrackerEditor._form(t, { creating: false, isActor: true });
    check(`a sheet ${type} shows no dock-only field`, !/name="(playerRoll|prominent|visibleToPlayers)"/.test(actorHtml));
  }
}

/* ---------------------------------- i18n ---------------------------------- */
section("i18n");
{
  const lang = { ...JSON.parse(read("lang/en.json")), ...JSON.parse(read("lang/clocks-tracker.en.json")) };
  const keys = new Set();
  for (const p of Object.values(FILES)) for (const m of read(p).matchAll(/["'`](GLCT\.[A-Za-z0-9_.]+)["'`]/g)) keys.add(m[1]);
  for (const k of keys) check(`"${k}" resolves`, k in lang);
  for (const type of TRACKER_TYPES) check(`GLCT.tracker.types.${type} resolves`, `GLCT.tracker.types.${type}` in lang);
  for (const [tag, key] of Object.entries(V.TAGS)) check(`tag "${tag}" resolves`, key in lang);
  const ours = Object.entries(lang).filter(([k]) => k.startsWith("GLCT.tracker."));
  const dash = ours.filter(([k, v]) => /—/.test(v) && !k.startsWith("GLCT.tracker.settings."));
  check("no em dash in the tracker strings people read", !dash.length, dash.map(([k]) => k).join(", "));
}

/* ---------------------------------- card ---------------------------------- */
section("pool card");
{
  globalThis.document = undefined;
  const R = await import(new URL(FILES.render, HERE));
  const html = R.poolCardHTML(V.poolCardView({ name: "<img src=x onerror=alert(1)>", faces: [1, 6], size: 6, discard: 2, before: 2 }), (k) => k);
  check("a pool name is escaped on the card", !html.includes("<img") && html.includes("&lt;img"));
  check("the card keeps its stored class prefix", html.startsWith('<div class="glct-trk-skin glct-trk-card'));
}

/* ---------------------------------- skin ---------------------------------- */
section("skin");
{
  const css = read("styles/clocks-tracker-trackers.css");
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const ROOTS = /^(\.glct-trk-skin|#glct-tracker-hud|\.glct-trk-tab-btn|\.glct-trk-dialog|\.chat-message\.glct-pool-msg(:has\(\.glct-trk-card\)| \.glct-trk-card))/;
  const selectors = [];
  for (const m of bare.matchAll(/([^{}@;]+)\{/g)) {
    const sel = m[1].trim();
    if (!sel || /^(from|to|\d+%|media|keyframes|supports|container)\b/.test(sel) || sel.startsWith("@")) continue;
    for (const part of sel.split(/,(?![^(]*\))/)) selectors.push(part.trim());
  }
  const stray = selectors.filter((s) => !ROOTS.test(s) && !/^(\d+%|from|to)(\s*,\s*\d+%)*$/.test(s) && !/^\(hover/.test(s));
  check("every rule sits under the feature's roots", !stray.length, stray.slice(0, 6).join(" | "));
  check("nothing is written on :root", !/:root/.test(bare));
  const decl = [...bare.matchAll(/(--gl-[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
  check("no foundation token is redeclared", !decl.length, decl.join(", "));
  const frames = [...bare.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  check("every keyframe is prefixed glct-trk-", frames.every((n) => n.startsWith("glct-trk-")), frames.join(", "));
  const raw = [...bare.matchAll(/(?:transition|animation)[^;]*?\b\d+(?:\.\d+)?m?s\b/g)].map((m) => m[0]);
  check("no raw duration", !raw.length, raw.join(" | "));
  const ease = [...bare.matchAll(/(?:transition|animation)[^;]*\b(ease-in|ease-out|ease-in-out|cubic-bezier)\b/g)].map((m) => m[0]);
  const bareEase = [...bare.matchAll(/(?:transition|animation):[^;]*\s(ease|linear)\s*[;,]/g)].map((m) => m[0]);
  check("no raw easing", !ease.length && !bareEase.length, [...ease, ...bareEase].join(" | "));
  check("no white veil", !/rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(bare));
  for (const m of bare.matchAll(/backdrop-filter:\s*([^;]+)/g)) {
    check("a backdrop blur follows the glass level", /none|var\(--gl-glass-k\)|var\(--gl-blur\)/.test(m[1]), m[1]);
  }
  check("no animation loops forever", !/infinite/.test(bare));
  // every trk- class the renderer and shells emit has a rule
  const src = read(FILES.render);
  const emitted = new Set([...src.matchAll(/["' ](trk-[a-z0-9-]+)/g)].map((m) => m[1]));
  // Hooks for the reconciler and the sheet's own root, not looks.
  const UNSTYLED = new Set(["trk-list", "trk-sign", "trk-sheet","trk-btn-dec", "trk-btn-inc", "trk-btn-more", "trk-btn-reset"]);
  const missing = [...emitted].filter((c) => !UNSTYLED.has(c) && !c.endsWith("-") && !new RegExp(`\\.${c}(?![a-z0-9-])`).test(bare));
  check("every class the renderer emits is styled", !missing.length, missing.join(", "));
}

console.log(failures ? `\n${failures} problem(s), ${passes} passed` : `\nresource-trackers-check: 0 problems, ${passes} assertions passed.`);
process.exit(failures ? 1 : 0);
