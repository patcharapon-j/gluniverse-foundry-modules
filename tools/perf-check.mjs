#!/usr/bin/env node
/**
 * GLUniverse Suite — Performance consistency check.
 *
 *   node tools/perf-check.mjs
 *
 * Everything the Performance feature does fails SILENTLY when it breaks. A tier
 * row missing a field inherits whatever the code defaulted to, which is a
 * quality decision nobody made. A core patch that installs on a Foundry it was
 * not written for breaks sheets in worlds that never opened the overlay. A
 * feature that kept its own frame-time average sheds on its own clock while the
 * overlay says the table is fine. A runtime-built i18n key renders as the raw
 * key in a GM's Control Center. None of that throws; this is the only place it
 * is caught.
 *
 * It drives the pure modules (the budget, the tier table, the governor, the
 * patch evaluator) and reads the rest as source. It cannot show you a frame —
 * `tools/perf-bench.mjs` measures, and only a live session proves the patches.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const load = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

const problems = [];
let passed = 0;
const fail = (where, msg) => problems.push(`${where}: ${msg}`);
const ok = (cond, where, msg) => (cond ? passed++ : fail(where, msg));

const section = async (title, fn) => {
  const before = problems.length;
  try {
    await fn();
  } catch (e) {
    fail(title, `threw: ${e?.stack ?? e}`);
  }
  console.log(`${problems.length === before ? "✓" : "✗"} ${title}`);
};

function walk(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const budgetMod = await load("scripts/core/budget.mjs");
const tiersMod = await load("scripts/features/perf/tiers.mjs");
const govMod = await load("scripts/features/perf/governor.mjs");
const constMod = await load("scripts/features/perf/constants.mjs");
const LANG = JSON.parse(read("lang/perf.en.json"));
const PERF_SRC = walk("scripts/features/perf").filter((f) => f.endsWith(".mjs"));

/* ══════════════════════════════════════════════════════════════════════ */

await section("the tier table states every field on every row", () => {
  const { TIERS, TIER_TABLE, TIER_FIELDS, LIVE_FIELDS } = tiersMod;
  for (const id of TIERS) {
    const row = TIER_TABLE[id];
    ok(!!row, "tiers.mjs", `no row for "${id}"`);
    if (!row) continue;
    for (const f of TIER_FIELDS) ok(f in row, "tiers.mjs", `"${id}" does not state "${f}" — it would inherit a default nobody chose`);
    for (const f of Object.keys(row)) ok(TIER_FIELDS.includes(f), "tiers.mjs", `"${id}" states "${f}", which TIER_FIELDS does not list`);
  }
  for (const f of LIVE_FIELDS) ok(TIER_FIELDS.includes(f), "tiers.mjs", `LIVE_FIELDS lists unknown field "${f}"`);
  ok(!LIVE_FIELDS.includes("perfMode") && !LIVE_FIELDS.includes("resolution"), "tiers.mjs",
    "perfMode and resolution force a redraw; Auto must never move them mid-scene");
});

await section("tiers only ever get cheaper down the table", () => {
  const { TIERS, TIER_TABLE } = tiersMod;
  const glass = ["full", "light", "none"];
  const ambient = ["always", "still", "off"];
  const res = ["native", "reduced", "base"];
  const visionRank = (v) => (v === "full" ? 0 : v === "snap" ? 1000 : Number(v));
  for (let i = 1; i < TIERS.length; i++) {
    const a = TIER_TABLE[TIERS[i - 1]], b = TIER_TABLE[TIERS[i]], at = `${TIERS[i - 1]} → ${TIERS[i]}`;
    ok(b.shedFloor >= a.shedFloor, "tiers.mjs", `${at}: shedFloor goes down`);
    ok(b.supersampleFloor >= a.supersampleFloor, "tiers.mjs", `${at}: supersampleFloor goes down`);
    ok(glass.indexOf(b.glass) >= glass.indexOf(a.glass), "tiers.mjs", `${at}: glass gets heavier`);
    ok(ambient.indexOf(b.ambient) >= ambient.indexOf(a.ambient), "tiers.mjs", `${at}: ambient gets busier`);
    ok(res.indexOf(b.resolution) >= res.indexOf(a.resolution), "tiers.mjs", `${at}: resolution goes up`);
    ok(visionRank(b.vision) >= visionRank(a.vision), "tiers.mjs", `${at}: sight is recomputed more often`);
    ok(b.glRelease <= a.glRelease, "tiers.mjs", `${at}: idle contexts are held longer`);
    ok(!(a.zoomBlur === false && b.zoomBlur === true), "tiers.mjs", `${at}: zoom blur comes back`);
    if (a.idleFps > 0) ok(b.idleFps > 0 && b.idleFps <= a.idleFps, "tiers.mjs", `${at}: the idle rate goes up`);
  }
  for (const id of TIERS) {
    for (const f of ["glass", "ambient", "resolution"]) {
      const allowed = { glass, ambient, resolution: res }[f];
      ok(allowed.includes(TIER_TABLE[id][f]), "tiers.mjs", `"${id}".${f} = "${TIER_TABLE[id][f]}" is not one of ${allowed.join("/")}`);
    }
  }
});

await section("Quality changes nothing and Balanced changes nothing visible", () => {
  const { TIER_TABLE } = tiersMod;
  const q = TIER_TABLE.quality, b = TIER_TABLE.balanced;
  ok(q.perfMode === null && q.resolution === "native" && q.idleFps === 0 && q.vision === "full" && q.shedFloor === 0
    && q.supersampleFloor === 0 && q.glass === "full" && q.ambient === "always" && q.zoomBlur === true,
  "tiers.mjs", "Quality must be the identity: every field at Foundry's own / the suite's shipped behaviour");
  ok(b.perfMode === null && b.resolution === "native" && b.shedFloor === 0 && b.supersampleFloor === 0
    && b.glass === "full" && b.zoomBlur === true,
  "tiers.mjs", "Balanced is the default and promises no visible change; a visual trade belongs at Performance");
  ok(tiersMod.DEFAULT_TIER === "balanced", "tiers.mjs", "the default tier must be Balanced");
});

await section("a floor clamps and Auto only ever moves live fields", () => {
  const { resolveTier, floorFor, isCapture, TIERS, TIER_TABLE, LIVE_FIELDS, AUTO, AUTO_RANGE } = tiersMod;
  for (const floor of TIERS) {
    for (const choice of TIERS) {
      const r = resolveTier({ choice, floor });
      ok(TIERS.indexOf(r.tier) >= TIERS.indexOf(floor), "tiers.mjs", `choice ${choice} under floor ${floor} ran ${r.tier}, better than the floor`);
      ok(TIERS.indexOf(r.tier) >= TIERS.indexOf(choice), "tiers.mjs", `choice ${choice} under floor ${floor} ran ${r.tier}, better than chosen`);
    }
    for (const autoTier of AUTO_RANGE) {
      const r = resolveTier({ choice: AUTO, floor, autoTier });
      ok(r.auto, "tiers.mjs", "Auto did not report itself as auto");
      ok(TIERS.indexOf(r.tier) >= TIERS.indexOf(floor), "tiers.mjs", `Auto ran ${r.tier} above floor ${floor}`);
      for (const f of Object.keys(r.values)) {
        const expect = LIVE_FIELDS.includes(f) ? TIER_TABLE[r.tier][f] : TIER_TABLE[r.baseline][f];
        ok(Object.is(r.values[f], expect), "tiers.mjs", `Auto at ${autoTier}/${floor}: "${f}" came from the wrong row`);
      }
    }
  }
  const floorObj = { max: "balanced", users: { cap: { max: "quality", capture: true }, slow: { max: "potato" } } };
  ok(floorFor(floorObj, "cap") === "quality", "tiers.mjs", "a per-user row must replace the world floor upward too");
  ok(floorFor(floorObj, "slow") === "potato", "tiers.mjs", "a per-user row must replace the world floor downward");
  ok(floorFor(floorObj, "anyone") === "balanced", "tiers.mjs", "a user with no row must get the world floor");
  ok(floorFor({}, "anyone") === "quality", "tiers.mjs", "an empty floor must allow Quality");
  ok(isCapture(floorObj, "cap") && !isCapture(floorObj, "slow"), "tiers.mjs", "capture flag misread");
  ok(tiersMod.resolutionFor("reduced", 2) === 1.5 && tiersMod.resolutionFor("reduced", 1) === 1
    && tiersMod.resolutionFor("base", 2) === 1 && tiersMod.resolutionFor("native", 2) === 2
    && tiersMod.resolutionFor("reduced", 1.25) === 1,
  "tiers.mjs", "resolutionFor must never go below 1 nor above the user's own");
});

await section("the shared budget ships the old policy and behaves like the old ladders", () => {
  const { Budget, LOCAL_POLICY, thresholdsFor, RESUME_GAP_MS, COOL_FRAMES } = budgetMod;
  Budget._reset();
  const t = thresholdsFor(LOCAL_POLICY.targetFps);
  ok(Math.abs(t.shedAt - 22) < 0.1 && Math.abs(t.unshedAt - 15) < 0.1, "budget.mjs",
    `the default policy must shed at 22 ms and recover at 15 ms (the shipped pair), got ${t.shedAt.toFixed(1)} / ${t.unshedAt.toFixed(1)}`);

  const ladder = Budget.ladder("test", ["a", "b", "c"]);
  ok(!Budget.running, "budget.mjs", "the frame loop must not start where requestAnimationFrame does not exist");
  for (let i = 0; i < 50; i++) Budget.sample(16);
  ok(ladder.level === 0 && ladder.allows("a"), "budget.mjs", "a 60 fps machine shed something");
  for (let i = 0; i < 60; i++) Budget.sample(40);
  ok(ladder.level === 3 && !ladder.allows("c"), "budget.mjs", "a 25 fps machine did not shed the whole ladder");
  ok(ladder.allows("unlisted"), "budget.mjs", "a behaviour the ladder does not list must always run");
  Budget.sample(5000);
  ok(Budget.frames > 0 && Budget.frameMs < RESUME_GAP_MS, "budget.mjs", "a resume gap was fed to the average");
  let steps = Budget.steps;
  for (let i = 0; i < 30; i++) Budget.sample(10);
  ok(Budget.steps === steps, "budget.mjs", "the reflex recovered within 30 frames — it must hold for COOL_FRAMES");
  for (let i = 0; i < COOL_FRAMES * 40; i++) Budget.sample(10);
  ok(Budget.steps === 0 && ladder.level === 0, "budget.mjs", "a recovered machine never took its effects back");

  Budget.setPolicy({ shedFloor: 1 });
  ok(ladder.level === 1, "budget.mjs", "a policy floor was not applied");
  const own = Budget.ladder("own", ["a", "b", "c"], { minShed: () => 2 });
  ok(own.level === 2, "budget.mjs", "a ladder's own minimum and the policy floor must combine as a max, not a sum");
  Budget.setPolicy({ shedFloor: Infinity });
  ok(ladder.level === 3, "budget.mjs", "an Infinity floor must shed the whole ladder");
  Budget.setPolicy(null);
  ok(Budget.policy === LOCAL_POLICY && ladder.level === 0, "budget.mjs", "setPolicy(null) must restore the shipped policy");

  const seen = [];
  const off = Budget.onChange((why) => seen.push(why));
  Budget.setAmbient(false);
  ok(!Budget.ambientAllowed && seen.includes("ambient"), "budget.mjs", "ambient stillness did not notify");
  off();
  const m = Budget.measure("x", () => 7);
  ok(m() === 7, "budget.mjs", "measure() changed a callback's return value");
  Budget.setProfiling(true);
  m();
  ok("x" in Budget.drainSpent(), "budget.mjs", "measure() attributed nothing while profiling");
  Budget._reset();
});

await section("the governor steps down fast, up slowly, and never on intervals alone", () => {
  const { Governor, GOVERNOR, targetFpsFor } = govMod;
  const budgetMs = 1000 / 60;
  const run = (g, ms, m, from = 0) => {
    let moves = 0, t = from;
    for (; t < from + ms; t += GOVERNOR.cadenceMs) moves += g.step(t, m);
    return { moves, t };
  };
  const slow = { intervalP95: 33, workP95: 30, workSamples: 200 };
  const fine = { intervalP95: 16.7, workP95: 4, workSamples: 200 };
  const vsync = { intervalP95: 16.7, workP95: 0, workSamples: 0 };

  let g = new Governor({ budgetMs });
  let r = run(g, GOVERNOR.downAfterMs - GOVERNOR.cadenceMs * 2, slow);
  ok(r.moves === 0, "governor.mjs", "stepped down before downAfterMs");
  r = run(g, GOVERNOR.cadenceMs * 4, slow, r.t);
  ok(g.index === 1, "governor.mjs", "did not step down after sustained stutter");
  r = run(g, GOVERNOR.settleMs - GOVERNOR.cadenceMs, slow, r.t);
  ok(g.index === 1, "governor.mjs", "stepped again inside the settle period");

  g = new Governor({ budgetMs });
  g.index = 2;
  r = run(g, GOVERNOR.upAfterMs - GOVERNOR.cadenceMs * 2, fine);
  ok(g.index === 2, "governor.mjs", "stepped up before upAfterMs");
  run(g, GOVERNOR.cadenceMs * 4, fine, r.t);
  ok(g.index === 1, "governor.mjs", "did not step up after sustained headroom");

  g = new Governor({ budgetMs });
  g.index = 2;
  run(g, 60000, vsync);
  ok(g.index === 2, "governor.mjs", "stepped up with no work samples — intervals cannot show headroom");

  g = new Governor({ budgetMs });
  run(g, 60000, { intervalP95: 17.5, workP95: 12, workSamples: 200 });
  ok(g.index === 0, "governor.mjs", "rAF jitter at exactly the target stepped a capable machine down");

  ok(targetFpsFor("display", 144, 60) === 60 && targetFpsFor("display", 50, 60) === 50
    && targetFpsFor("30", 144, 60) === 30 && targetFpsFor("bogus", 60, 60) === 60,
  "governor.mjs", "targetFpsFor misread a setting");
});

await section("every core patch is gated on generation and on the method it was written against", async () => {
  const { PATCHES, VERIFIED_GENERATIONS } = constMod;
  ok(VERIFIED_GENERATIONS.length > 0, "constants.mjs", "VERIFIED_GENERATIONS is empty");
  const src = PERF_SRC.map((f) => [f, stripComments(read(f))]);
  const defines = [];
  for (const [f, s] of src) {
    for (const m of s.matchAll(/Patches\.define\(\{([\s\S]*?)\n\s*\}\)/g)) defines.push([f, m[1]]);
  }
  for (const { id, core } of PATCHES) {
    if (!core) continue;
    const found = defines.filter(([, body]) => new RegExp(`id:\\s*"${id}"`).test(body));
    ok(found.length === 1, "patches", `core patch "${id}" is defined ${found.length} times (want exactly 1)`);
    for (const [f, body] of found) {
      ok(/target:\s*"[\w.]+"/.test(body), f, `"${id}" has no dotted target`);
      ok(/signature:\s*("[^"]{8,}"|'[^']{8,}')/.test(body), f, `"${id}" has no integrity signature (≥ 8 chars) — it would install over anything`);
    }
  }
  for (const [f, body] of defines) {
    const id = /id:\s*"(\w+)"/.exec(body)?.[1];
    ok(PATCHES.some((p) => p.id === id && p.core), f, `Patches.define("${id}") is not a core patch in PATCHES`);
  }

  // Drive the evaluator: wrong generation, missing target, tampered method.
  globalThis.game = { release: { generation: 99 }, modules: new Map() };
  globalThis.__glperfProbe = { pristine() { return "the pristine body marker"; } };
  const { Patches } = await load("scripts/features/perf/patches.mjs");
  const def = { id: "appRender", target: "__glperfProbe.pristine", signature: "pristine body marker" };
  ok(Patches._evaluate(def)[0] === "version", "patches.mjs", "installed on an unverified Foundry generation");
  globalThis.game.release.generation = VERIFIED_GENERATIONS[0];
  ok(Patches._evaluate(def)[0] === "ok", "patches.mjs", "refused a pristine method on a verified generation");
  ok(Patches._evaluate({ ...def, target: "__glperfProbe.nope" })[0] === "missing", "patches.mjs", "did not notice a missing target");
  globalThis.__glperfProbe.pristine = function () { return "someone else's wrapper"; };
  ok(Patches._evaluate(def)[0] === "conflict", "patches.mjs", "installed over a method another module replaced");
  globalThis.game.modules.set("overlapping-module", { active: true });
  globalThis.__glperfProbe.pristine = function () { return "the pristine body marker"; };
  ok(Patches._evaluate({ ...def, overlaps: ["overlapping-module"] })[0] === "conflict", "patches.mjs", "ignored an overlapping module");
  delete globalThis.game;
  delete globalThis.__glperfProbe;
});

await section("the suite sheds on one clock and holds no idle GPU context", () => {
  const featureSrc = walk("scripts/features").filter((f) => /\.(m?js)$/.test(f) && !f.startsWith("scripts/features/perf/"));
  // A private rolling frame-time average is a second clock: it sheds on its own
  // schedule while the overlay (and a GM's floor) say something else.
  const ema = /(\b[\w.]+)\s*=\s*\1\s*\*\s*0?\.\d+\s*\+\s*(\w*(?:dt|ms|frame|delta)\w*)\s*\*\s*0?\.\d+/i;
  for (const f of featureSrc) {
    const src = stripComments(read(f));
    const m = ema.exec(src);
    ok(!m, f, `keeps a private frame-time average (\`${m?.[0]}\`) — shed through Budget.ladder() in core/budget.mjs`);
    ok(!/\b(?:SHED_AT|UNSHED_AT)\b/.test(src) || f.endsWith("tools"), f, "defines its own shed thresholds; they come from the budget's policy");
  }
  // Every shed order is bound to the shared budget somewhere in its feature.
  const byFeature = new Map();
  for (const f of featureSrc) {
    const dir = f.split("/").slice(0, 3).join("/");
    if (!byFeature.has(dir)) byFeature.set(dir, []);
    byFeature.get(dir).push(stripComments(read(f)));
  }
  for (const [dir, srcs] of byFeature) {
    const all = srcs.join("\n");
    if (/export const SHED_ORDER/.test(all)) {
      ok(/Budget\.ladder\(/.test(all), dir, "exports a SHED_ORDER that nothing binds to Budget.ladder() — it never sheds");
    }
    const contexts = /getContext\(\s*["'`]webgl|new PIXI\.Application\(/.test(all);
    if (contexts) {
      ok(/Surfaces\.register\(/.test(all), dir, "creates its own WebGL context but never registers it with Surfaces — it is never paused or released");
    }
  }
});

await section("every runtime-built GLPERF key exists", () => {
  const { TIERS, AUTO } = tiersMod;
  const { PATCHES, TARGETS } = constMod;
  const need = [];
  for (const t of [AUTO, ...TIERS]) need.push(`GLPERF.tier.${t}`);
  for (const t of TARGETS) need.push(`GLPERF.target.${t}`);
  for (const { id } of PATCHES) need.push(`GLPERF.patch.${id}.name`, `GLPERF.patch.${id}.clientName`, `GLPERF.patch.${id}.hint`);
  for (const s of ["active", "off", "idle", "version", "conflict", "missing", "error"]) need.push(`GLPERF.patchState.${s}`);
  const all = PERF_SRC.map(read).join("\n");
  for (const m of all.matchAll(/Overrides\.set\(\s*"(\w+)"/g)) need.push(`GLPERF.override.${m[1]}`);
  for (const m of all.matchAll(/\[\s*"(\w+)",\s*-?[\d.]+,\s*-?[\d.]+\s*\]/g)) need.push(`GLPERF.probe.${m[1]}`);
  need.push("GLPERF.probe.canvas");
  for (const k of need) ok(k in LANG, "lang/perf.en.json", `missing "${k}" — built at runtime, renders as the raw key`);
});

await section("every literal GLPERF key resolves", () => {
  const files = [...PERF_SRC, ...walk("templates/perf")];
  for (const f of files) {
    const s = read(f);
    for (const m of s.matchAll(/["'](GLPERF\.[\w.]+)["']/g)) {
      const k = m[1];
      if (/\.$/.test(k)) continue;
      ok(k in LANG, f, `"${k}" is not in lang/perf.en.json`);
    }
  }
});

await section("settings, form names and sizing", () => {
  const index = read("scripts/features/perf/index.mjs");
  for (const [name, key] of Object.entries(constMod.SETTINGS)) {
    ok(new RegExp(`SETTINGS\\.${name}\\b`).test(index), "index.mjs", `setting "${key}" is never registered`);
  }
  for (const key of Object.values(constMod.SETTINGS)) ok(key.startsWith(constMod.PREFIX), "constants.mjs", `"${key}" does not carry the perf. prefix`);
  ok(/settingPrefix:\s*"perf\."/.test(index), "index.mjs", "settingPrefix must be \"perf.\" or the Control Center cannot route the settings");
  ok(/registerMenu\(SUITE_ID,\s*MENUS\.floor/.test(index), "index.mjs", "the floor sheet has no menu — a GM could only reach it from the console");

  const form = read("templates/perf/floor.hbs");
  ok(/name="users\.\{\{id\}\}\.max"/.test(form) && /name="users\.\{\{id\}\}\.capture"/.test(form), "floor.hbs",
    "per-user fields must be dotted (users.<id>.max) or Foundry's form parser drops them and the save stores nothing");
  const css = read("styles/perf.css");
  ok(/\.gl-btn[^{]*\{[^}]*font-size/.test(css), "perf.css", ".gl-btn declares no font-size; the feature must size its own buttons");
  ok(!/backdrop-filter:\s*blur/.test(css), "perf.css", "the overlay must never blur the canvas it is measuring");
  const runtime = stripComments(read("scripts/features/perf/runtime.mjs"));
  ok(!/game\.settings\.set\(\s*["']core["']/.test(PERF_SRC.map((f) => stripComments(read(f))).join("\n")), "perf",
    "the feature must never write a core setting — it overrides at runtime so switching it off restores the user's own");
  ok(/isCaptureClient[\s\S]*?stream\.streamUserId/.test(runtime), "runtime.mjs", "the stream feature's capture login is not treated as a capture client");
});

/* ══════════════════════════════════════════════════════════════════════ */

console.log("");
if (problems.length) {
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} problem(s), ${passed} assertion(s) passed.`);
  process.exit(1);
}
console.log(`perf-check: 0 problems, ${passed} assertions passed.`);
