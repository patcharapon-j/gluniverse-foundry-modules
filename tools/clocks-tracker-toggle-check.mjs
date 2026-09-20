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
import { execFileSync } from "node:child_process";

const HERE = new URL("..", import.meta.url);
const SUITE = "gluniverse-foundry-modules";
const read = (rel) => fs.readFileSync(new URL(rel, HERE), "utf8");

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

const bridge = read("scripts/features/clocks-tracker/features.js");
check("Features.on is gated on the engine's own toggle",
  /\bon\(path\)\s*\{[^}]*engineEnabled\(\)/.test(bridge));
check("the gate resolves through the suite registry",
  /Suite\.enabled\(ENGINE_FEATURE\)/.test(bridge));
check("Features.self is NOT gated (the editor draws stored state)",
  !/\bself\(path\)\s*\{\s*if\s*\(!engineEnabled\(\)\)/.test(bridge));

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
Suite.register({ id: "clocks-tracker", title: "GLS.feature.clocks-tracker.title", settingPrefix: "ct.", core: false, defaultEnabled: true });
registerSubFeatures();
check("the roster validates (no unknown/cyclic gate)", Suite.validate() === true);

store.set(`${SUITE}.moduleConfig`, {});      // the suite's feature toggles
store.set(`${SUITE}.ct.moduleConfig`, {});   // the engine's internal tree
store.set(`${SUITE}.ct.weatherEnabled`, true);
store.set(`${SUITE}.ct.delvingEnabled`, true);
store.set(`${SUITE}.ct.sceneTint`, true);
store.set(`${SUITE}.ct.sheetTrackersEnabled`, true);

const ENGINE_PATHS = ["timeHud", "timeHud.calendar", "timeHud.calendar.events", "timeHud.gmControls",
                      "trackers", "trackers.dock", "trackers.sheet", "weather", "weather.hudChip", "delving"];

check("nothing stored → the engine is on (what existing worlds read)",
  Suite.enabled("clocks-tracker") === true);
check("nothing stored → every engine path resolves on",
  ENGINE_PATHS.every((p) => Features.on(p) === true),
  ENGINE_PATHS.filter((p) => !Features.on(p)).join(", "));

await Suite.setEnabled("clocks-tracker", false);

check("the toggle actually stores off", Suite.enabled("clocks-tracker") === false);
check("engine off → EVERY engine path resolves off",
  ENGINE_PATHS.every((p) => Features.on(p) === false),
  ENGINE_PATHS.filter((p) => Features.on(p)).join(", "));
check("engine off → the promoted sub-features are unavailable",
  ["clocks-trackers", "clocks-weather", "clocks-delving"]
    .every((id) => !Suite.available(Suite.get(id)) && !Suite.enabled(id)));
check("engine off → each sub-feature reports WHY it is locked",
  ["clocks-trackers", "clocks-weather", "clocks-delving"]
    .every((id) => typeof Suite.unavailableReason(Suite.get(id)) === "string"));
check("engine off → the editor still reads the stored tree",
  Features.self("timeHud") === true && Features.self("timeHud.calendar") === true);
check("engine off → no ct.* world data was rewritten",
  store.get(`${SUITE}.ct.weatherEnabled`) === true &&
  store.get(`${SUITE}.ct.delvingEnabled`) === true &&
  Object.keys(store.get(`${SUITE}.ct.moduleConfig`)).length === 0);

await Suite.setEnabled("clocks-tracker", true);
check("switching back on restores the whole tree",
  Suite.enabled("clocks-tracker") === true && ENGINE_PATHS.every((p) => Features.on(p) === true));

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

console.log(failures ? `\n${failures} problem(s)` : "\nall clocks-tracker toggle checks passed");
process.exit(failures ? 1 : 0);
