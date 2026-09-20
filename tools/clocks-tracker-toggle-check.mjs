#!/usr/bin/env node
/**
 * GLUniverse Suite — Clocks & Tracker enable-toggle check.
 *
 *   node tools/clocks-tracker-toggle-check.mjs
 *
 * The time engine is an ordinary, switch-off-able feature: a campaign that
 * tracks no in-game time turns it off in the Control Center and the calendar,
 * the time HUD, the trackers, the weather walk and the delve all go with it.
 * Both halves of that fail SILENTLY.
 *
 *   · `core: true` on the adapter is not an error and shows nothing in a diff —
 *     the Control Center simply draws a "Core" chip where the switch was, and
 *     the feature is undisableable again with no message anywhere.
 *
 *   · `registerSettings()` always runs, disabled or not, and several of those
 *     settings carry side-effecting onChange handlers. The engine's internal
 *     `timeHud` node is a `ct.moduleConfig` key, NOT one of the three promoted
 *     sub-features, so nothing else resolves it through the suite registry:
 *     without the gate in `Features.on`, a GM opening Module Configuration in a
 *     world that turned the engine off flips `timeHud`, `applyModuleConfig()`
 *     opens a time HUD, and that HUD has no calendar installed behind it
 *     (`applyCalendar()` runs in onInit) and no runtime hooks feeding it.
 *
 * So the gate is driven here rather than read: the real registry and the real
 * `Features` bridge, under a stubbed Foundry, across the engine's own tree.
 *
 * The engine is also only ONE of the two features this folder ships. Resource
 * Trackers runs with the engine off, and that split has its own silent failures,
 * driven in the second half of this file:
 *
 *   · the engine gate must NOT cover a promoted node, or the dock goes dark in a
 *     world that deliberately runs only the trackers while the Control Center
 *     still shows the feature switched on;
 *   · `clocks-trackers` must keep its own `onInit`/`onReady`, because the
 *     registry runs a feature's own lifecycle and nothing else — wiring that
 *     lives in the parent's is a feature that cannot be enabled by itself;
 *   · Weather and Delving must KEEP `requiresFeature`: a delve is drawn inside
 *     the time HUD and a weather walk is stepped by the engine's
 *     `updateWorldTime` hook, so ungating them leaves both switched on with
 *     nothing drawing and nothing walking;
 *   · the scene-control group, the chat tagging and the keybindings are shared,
 *     so they must be wired exactly ONCE however many halves are enabled and in
 *     whichever order — `game.keybindings.register` throws on a duplicate key,
 *     which would abort the second half's init;
 *   · and every branch of that shared hook has to ask `Features`, never a
 *     store's own `enabled` getter, which reads its world setting directly: in
 *     a trackers-only world those getters still say yes and put a weather button
 *     on the scene controls for a feature that is not running.
 * Three properties beside it that a world would pay for:
 *   · with nothing stored the engine is ON, which is what every existing world
 *     reads (their moduleConfig blob has no `clocks-tracker` key);
 *   · switching it off writes no `ct.*` data — a world can turn it back on and
 *     find its calendar, trackers and weather exactly as they were;
 *   · `Features.self()` keeps reporting the true stored state, because that is
 *     what the Module Configuration editor draws its rows from — an editor that
 *     showed every row off would lose the GM's configuration on screen.
 *
 * Zero failures required. Exits non-zero otherwise.
 */

import fs from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";

const HERE = new URL("..", import.meta.url);
const SUITE = "gluniverse-foundry-modules";
const read = (rel) => fs.readFileSync(new URL(rel, HERE), "utf8");
/** Source with comments removed — a rule about what the CODE does must not be
 *  answered by a sentence describing it. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let failures = 0;
const check = (name, cond, extra = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { console.log(`FAIL   ${name} ${extra}`); failures++; }
};

/* ------------------------------ source shape ------------------------------ */

const adapter = read("scripts/features/clocks-tracker/index.mjs");
check("the adapter does not claim to be core",
  /\bcore:\s*false\b/.test(adapter) && !/\bcore:\s*true\b/.test(adapter));
check("the adapter still ships enabled", /\bdefaultEnabled:\s*true\b/.test(adapter));

const subs = read("scripts/features/clocks-tracker/sub-features.mjs");
const trackerBlock = subs.slice(subs.indexOf('id: "clocks-trackers"'), subs.indexOf('id: "clocks-weather"'));
check("Resource Trackers does not gate on the engine",
  trackerBlock.length > 0 && !/requiresFeature\s*:/.test(trackerBlock));
check("Resource Trackers carries its own lifecycle",
  /onInit\(\)/.test(trackerBlock) && /onReady\(\)/.test(trackerBlock));
check("Weather and Delving still gate on the engine",
  (subs.match(/requiresFeature:\s*"clocks-tracker"/g) ?? []).length === 2);
check("the adapter hands Resource Trackers its lifecycle",
  /registerSubFeatures\(\{[^}]*onTrackersInit[^}]*onTrackersReady[^}]*\}\)/.test(
    code("scripts/features/clocks-tracker/index.mjs")));
check("sub-features.mjs stays loadable under plain Node",
  !/from\s+"\.\/module\.js"/.test(code("scripts/features/clocks-tracker/sub-features.mjs")));

const bridge = read("scripts/features/clocks-tracker/features.js");
check("Features.on is gated on the engine's own toggle",
  /\bon\(path\)\s*\{[^}]*engineEnabled\(\)/.test(bridge));
check("the gate resolves through the suite registry",
  /Suite\.enabled\(ENGINE_FEATURE\)/.test(bridge));
check("Features.self is NOT gated (the editor draws stored state)",
  !/\bself\(path\)\s*\{\s*if\s*\(!engineEnabled\(\)\)/.test(bridge));
check("the gate exempts promoted nodes (they answer for themselves)",
  /!\(top in PROMOTED\)\s*&&\s*!engineEnabled\(\)/.test(bridge));

const moduleSrc = code("scripts/features/clocks-tracker/module.js");
check("no shared surface reads a store's own enabled getter",
  !/(WeatherStore|DelvingStore)\.enabled/.test(moduleSrc),
  (moduleSrc.match(/(WeatherStore|DelvingStore)\.enabled/g) ?? []).join(", "));

/* ------------------------------- behaviour -------------------------------- */

const store = new Map();
globalThis.game = {
  system: { id: "pf2e" },
  release: { generation: 13 },
  user: { isGM: true },
  modules: new Map(),
  i18n: { localize: (k) => k, format: (k) => k },
  settings: {
    get: (ns, key) => {
      const k = `${ns}.${key}`;
      if (!store.has(k)) throw new Error(`unregistered setting ${k}`);
      return store.get(k);
    },
    set: async (ns, key, value) => store.set(`${ns}.${key}`, value),
  },
};
globalThis.Hooks = { on() {}, once() {}, callAll() {} };

const { Suite } = await import(new URL("scripts/core/registry.mjs", HERE));
const { registerSubFeatures } = await import(new URL("scripts/features/clocks-tracker/sub-features.mjs", HERE));
const { Features } = await import(new URL("scripts/features/clocks-tracker/features.js", HERE));

// Stand-in for the adapter's own registration — the real one imports module.js,
// which pulls in the HUDs and the whole Foundry surface. Everything the registry
// reads about the feature is right here, and the source check above pins it to
// what the adapter actually declares.
const lifecycle = { engineInit: 0, engineReady: 0, trackerInit: 0, trackerReady: 0 };
Suite.register({
  id: "clocks-tracker",
  title: "GLS.feature.clocks-tracker.title",
  settingPrefix: "ct.",
  core: false,
  defaultEnabled: true,
  onInit() { lifecycle.engineInit++; },
  async onReady() { lifecycle.engineReady++; },
});
// The real adapter hands these over from module.js; the source check above pins
// that it does. Here they are counters, so the registry's own phase runner
// reports which half actually ran.
registerSubFeatures({
  onTrackersInit: () => { lifecycle.trackerInit++; return { stub: true }; },
  onTrackersReady: async () => { lifecycle.trackerReady++; },
});
check("the roster validates (no unknown/cyclic gate)", Suite.validate() === true);

store.set(`${SUITE}.moduleConfig`, {});      // the suite's feature toggles
store.set(`${SUITE}.ct.moduleConfig`, {});   // the engine's internal tree
store.set(`${SUITE}.ct.weatherEnabled`, true);
store.set(`${SUITE}.ct.delvingEnabled`, true);
store.set(`${SUITE}.ct.sceneTint`, true);
store.set(`${SUITE}.ct.sheetTrackersEnabled`, true);

const TIME_PATHS = ["timeHud", "timeHud.calendar", "timeHud.calendar.events", "timeHud.gmControls",
                    "weather", "weather.hudChip", "delving"];
const TRACKER_PATHS = ["trackers", "trackers.dock", "trackers.sheet"];
const ALL_PATHS = [...TIME_PATHS, ...TRACKER_PATHS];
const off = (paths) => paths.filter((x) => !Features.on(x)).join(", ");
const on = (paths) => paths.filter((x) => Features.on(x)).join(", ");

check("nothing stored → the engine is on (what existing worlds read)",
  Suite.enabled("clocks-tracker") === true);
check("nothing stored → every path resolves on",
  ALL_PATHS.every((x) => Features.on(x) === true), off(ALL_PATHS));

await Suite.setEnabled("clocks-tracker", false);

check("the toggle actually stores off", Suite.enabled("clocks-tracker") === false);
check("engine off → every TIME path resolves off",
  TIME_PATHS.every((x) => Features.on(x) === false), on(TIME_PATHS));
check("engine off → the TRACKER paths still resolve ON",
  TRACKER_PATHS.every((x) => Features.on(x) === true), off(TRACKER_PATHS));
check("engine off → Resource Trackers is available, enabled and unlocked",
  Suite.available(Suite.get("clocks-trackers")) &&
  Suite.enabled("clocks-trackers") &&
  Suite.unavailableReason(Suite.get("clocks-trackers")) === null);
check("engine off → Weather and Delving are unavailable",
  ["clocks-weather", "clocks-delving"]
    .every((id) => !Suite.available(Suite.get(id)) && !Suite.enabled(id)));
check("engine off → Weather and Delving report WHY they are locked",
  ["clocks-weather", "clocks-delving"]
    .every((id) => typeof Suite.unavailableReason(Suite.get(id)) === "string"));
check("engine off → the editor still reads the stored tree",
  Features.self("timeHud") === true && Features.self("timeHud.calendar") === true);
check("engine off → no ct.* world data was rewritten",
  store.get(`${SUITE}.ct.weatherEnabled`) === true &&
  store.get(`${SUITE}.ct.delvingEnabled`) === true &&
  Object.keys(store.get(`${SUITE}.ct.moduleConfig`)).every((k) => k === "trackers"));

// Resolving on is only half of it — the registry has to actually RUN the dock's
// own lifecycle in that world, which it does only because the feature declares
// one. A sub-feature wired from its parent's onInit resolves on here and then
// never initialises, which is the whole failure this split exists to avoid.
const runPhases = async () => {
  lifecycle.engineInit = lifecycle.engineReady = lifecycle.trackerInit = lifecycle.trackerReady = 0;
  await Suite.runPhase("onInit");
  await Suite.runPhase("onReady");
};

await runPhases();
check("engine off → the engine's own lifecycle never runs",
  lifecycle.engineInit === 0 && lifecycle.engineReady === 0);
check("engine off → Resource Trackers still initialises and readies",
  lifecycle.trackerInit === 1 && lifecycle.trackerReady === 1);

await Suite.setEnabled("clocks-trackers", false);
check("both off → every path in the folder resolves off",
  ALL_PATHS.every((x) => Features.on(x) === false), on(ALL_PATHS));
await runPhases();
check("both off → nothing in the folder initialises",
  lifecycle.engineInit === 0 && lifecycle.trackerInit === 0);
await Suite.setEnabled("clocks-trackers", true);

await Suite.setEnabled("clocks-tracker", true);
check("switching the engine back on restores the whole tree",
  Suite.enabled("clocks-tracker") === true && ALL_PATHS.every((x) => Features.on(x) === true),
  off(ALL_PATHS));
await runPhases();
check("both on → both lifecycles run exactly once",
  lifecycle.engineInit === 1 && lifecycle.trackerInit === 1 &&
  lifecycle.engineReady === 1 && lifecycle.trackerReady === 1);

/* --------------------- the pre-registry / tooling path --------------------- */
// A check tool importing one of these modules directly never builds the roster,
// and there the engine has to behave as it did when it could not be switched
// off — an unregistered feature means "no roster", not "the GM said no". This
// runs in a CHILD process because a query-string re-import would still resolve
// the same registry module, and this process has a populated one.
const bare = `
globalThis.game = { settings: { get() { throw new Error("no settings"); } } };
const { Features } = await import(${JSON.stringify(String(new URL("scripts/features/clocks-tracker/features.js", HERE)))});
process.exit(Features.on("timeHud") === true ? 0 : 3);
`;
let bareOk = false;
try {
  execFileSync(process.execPath, ["--input-type=module", "-e", bare], { stdio: "pipe" });
  bareOk = true;
} catch { /* non-zero exit → gated shut */ }
check("unregistered roster fails OPEN", bareOk);

/* ------------------ the two lifecycles, driven in a vm -------------------- */
// module.js is what actually wires the halves, and it cannot be imported under
// plain Node — its HUDs read `foundry.applications.api` at module scope. So it
// is executed with its imports stripped and its collaborators injected, the
// technique tools/clocks-pacer-motion-check.mjs uses on this same feature.

const moduleSource = read("scripts/features/clocks-tracker/module.js")
  .replace(/^import .*;$/gm, "")
  .replace(/^export \{[^}]*\};$/gm, "")
  .replace(/^export (async )?function/gm, "$1function");

/** Run one or both halves of the lifecycle and report everything they wired. */
function drive({ features = {}, halves = ["engine", "trackers"] }) {
  const log = { hooks: [], keys: [], styles: [], sheet: 0, calendar: 0, handlers: 0, dock: 0, hud: 0 };
  const el = () => ({
    rel: "", href: "", dataset: {}, style: {},
    classList: { add() {}, remove() {}, contains: () => false },
    appendChild() {}, remove() {}, after() {}, querySelector: () => null,
  });
  const ctx = vm.createContext({
    console,
    MODULE_ID: SUITE,
    // Every SETTINGS.x answers with its own name; the code only uses them as keys.
    SETTINGS: new Proxy({}, { get: (_t, k) => String(k) }),
    HOOKS: {},
    document: {
      createElement: el,
      head: { appendChild: (link) => log.styles.push(link.href) },
      querySelector: (sel) => {
        const m = /styles\/(clocks-tracker-[a-z-]+\.css)/.exec(String(sel));
        return m && log.styles.some((href) => href.includes(m[1])) ? el() : null;
      },
      getElementById: () => null,
      body: { after() {} },
    },
    Hooks: { on: (name) => log.hooks.push(name) },
    game: {
      user: { isGM: true },
      i18n: { localize: (k) => k },
      // Foundry refuses a second registration of the same key, so a second
      // wiring pass is a hard failure here rather than a silent duplicate.
      keybindings: {
        register: (_ns, key) => {
          if (log.keys.includes(key)) throw new Error(`duplicate keybinding: ${key}`);
          log.keys.push(key);
        },
      },
      settings: { get: () => { throw new Error("unset"); } },   // setting() falls back
    },
    Features: { on: (path) => !!features[path] },
    applyCalendar: () => { log.calendar++; },
    TimeEngine: { getState: () => ({ watch: { glow: "#000" } }), advanceStep() {} },
    GlctHud: { instance: null, open: async () => { log.hud++; }, refreshState() {}, settleDelveRoll() {} },
    TrackerHud: { instance: null, open: async () => { log.dock++; }, refresh() {} },
    TrackerStore: { registerHandlers: () => { log.handlers++; } },
    TrackerSheet: { register: () => { log.sheet++; } },
    WeatherEngine: { evaluate: async () => {} },
    WeatherHud: { toggle() {} },
    // Deliberately TRUE in every run: a surface that reads these instead of
    // asking Features is exactly the bug, so the stub always says yes.
    WeatherStore: { enabled: true },
    DelvingStore: { enabled: true, active: true, setActive() {}, advanceTurn() {} },
    DiceSlot: { mount: () => null },
    ensureSuiteGroup: (controls) => (controls.suite ??= { tools: {} }),
    registerSettings: () => {},
  });
  vm.runInContext(moduleSource, ctx);
  for (const half of halves) (half === "engine" ? ctx.onInit : ctx.onTrackersInit)();
  return { ctx, log };
}

const count = (list, x) => list.filter((v) => v === x).length;
const TRACKERS_ON = { trackers: true, "trackers.dock": true, "trackers.sheet": true };

/* --- a trackers-only world: the dock wires itself, the engine stays absent --- */
let run = drive({ features: TRACKERS_ON, halves: ["trackers"] });
check("trackers only → the scene-control group is wired",
  count(run.log.hooks, "getSceneControlButtons") === 1);
check("trackers only → the keybindings are registered", run.log.keys.length > 0);
check("trackers only → the dock's stylesheet is injected",
  run.log.styles.some((h) => h.includes("clocks-tracker-hud.css")) &&
  run.log.styles.some((h) => h.includes("clocks-tracker-tracker-sheet.css")));
check("trackers only → the PF2e sheet tab is wired", run.log.sheet === 1);
check("trackers only → no calendar is installed", run.log.calendar === 0);
check("trackers only → no world-time hook is wired",
  count(run.log.hooks, "updateWorldTime") === 0);
await run.ctx.onTrackersReady();
check("trackers only → pool persistence is wired and the dock opens",
  run.log.handlers === 1 && run.log.dock === 1);
check("trackers only → the time HUD is never opened", run.log.hud === 0);

/* --- both halves, in either order: everything shared is wired exactly once --- */
for (const halves of [["engine", "trackers"], ["trackers", "engine"]]) {
  const label = halves.join(" then ");
  let both = null;
  try {
    both = drive({ features: { ...TRACKERS_ON, timeHud: true }, halves });
  } catch (e) {
    check(`both halves (${label}) wire without a duplicate`, false, e.message);
    continue;
  }
  check(`both halves (${label}) wire without a duplicate`, true);
  check(`both halves (${label}) → one scene-control hook`,
    count(both.log.hooks, "getSceneControlButtons") === 1);
  check(`both halves (${label}) → one chat-tagging pair`,
    count(both.log.hooks, "renderChatMessageHTML") === 1 &&
    count(both.log.hooks, "renderChatMessage") === 1);
  check(`both halves (${label}) → one world-time hook`,
    count(both.log.hooks, "updateWorldTime") === 1);
  check(`both halves (${label}) → the shared stylesheet is injected once`,
    both.log.styles.filter((h) => h.includes("clocks-tracker-hud.css")).length === 1);
  check(`both halves (${label}) → the calendar is installed once`, both.log.calendar === 1);
}

/* --- the scene controls in a trackers-only world --- */
// The stores above say weather and delving are enabled, because in a real world
// they would: their getters read `ct.weatherEnabled` / `ct.delvingEnabled`, which
// a GM who switched the engine off never touched.
run = drive({ features: TRACKERS_ON, halves: ["trackers"] });
let controls = {};
run.ctx.onGetSceneControlButtons(controls);
let tools = Object.keys(controls.suite?.tools ?? {});
check("trackers only → the dock's scene tool is offered",
  tools.includes("glct-tracker-toggle"));
check("trackers only → no tool is offered for a half that is not running",
  !tools.some((t) => ["glct-toggle", "glct-weather-toggle", "glct-delving-toggle"].includes(t)),
  tools.join(", "));

// …and the gate is not simply always-false: with those features on, their tools
// come back.
run = drive({ features: { ...TRACKERS_ON, timeHud: true, weather: true, delving: true } });
controls = {};
run.ctx.onGetSceneControlButtons(controls);
tools = Object.keys(controls.suite?.tools ?? {});
check("everything on → every scene tool is offered",
  ["glct-toggle", "glct-tracker-toggle", "glct-weather-toggle", "glct-delving-toggle"]
    .every((t) => tools.includes(t)), tools.join(", "));

console.log(failures ? `\n${failures} problem(s)` : "\nall clocks-tracker toggle checks passed");
process.exit(failures ? 1 : 0);
