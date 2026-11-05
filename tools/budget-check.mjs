#!/usr/bin/env node
/**
 * GLUniverse Suite — shared frame budget check.
 *
 *   node tools/budget-check.mjs
 *
 * The budget (`core/budget.mjs`), the WebGL surface registry
 * (`core/gl-surfaces.mjs`) and every feature's SHED_ORDER fail SILENTLY when
 * they drift. A feature that keeps its own frame-time average sheds on its own
 * clock. A SHED_ORDER nothing binds never degrades. A WebGL context nobody
 * registers is never paused or released. A backdrop blur written in bare pixels
 * ignores the glass tokens. None of that throws; this is where it is caught.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
    const rel = join(dir, name).replaceAll("\\", "/");
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const budgetMod = await load("scripts/core/budget.mjs");

/* ══════════════════════════════════════════════════════════════════════ */

await section("the shared budget ships the old policy and behaves like the old ladders", () => {
  const { Budget, LOCAL_POLICY, thresholdsFor, RESUME_GAP_MS, COOL_FRAMES } = budgetMod;
  Budget._reset();
  const t = thresholdsFor(LOCAL_POLICY.targetFps);
  ok(Math.abs(t.shedAt - 22) < 0.1 && Math.abs(t.unshedAt - 15) < 0.1, "budget.mjs",
    `the default policy must shed at 22 ms and recover at 15 ms (the shipped pair), got ${t.shedAt.toFixed(1)} / ${t.unshedAt.toFixed(1)}`);
  ok(Budget.policy === LOCAL_POLICY, "budget.mjs", "a fresh budget must run LOCAL_POLICY");
  ok(LOCAL_POLICY.shedFloor === 0 && LOCAL_POLICY.glRelease === 0 && LOCAL_POLICY.pauseHidden === false,
    "budget.mjs", "LOCAL_POLICY must have no floor, never release a context and never pause on a hidden page");

  const ladder = Budget.ladder("test", ["a", "b", "c"]);
  ok(!Budget.running, "budget.mjs", "the frame loop must not start where requestAnimationFrame does not exist");
  for (let i = 0; i < 50; i++) Budget.sample(16);
  ok(ladder.level === 0 && ladder.allows("a"), "budget.mjs", "a 60 fps machine shed something");
  for (let i = 0; i < 60; i++) Budget.sample(40);
  ok(ladder.level === 3 && !ladder.allows("c"), "budget.mjs", "a 25 fps machine did not shed the whole ladder");
  ok(ladder.allows("unlisted"), "budget.mjs", "a behaviour the ladder does not list must always run");
  Budget.sample(5000);
  ok(Budget.frames > 0 && Budget.frameMs < RESUME_GAP_MS, "budget.mjs", "a resume gap was fed to the average");
  const steps = Budget.steps;
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

await section("the suite sheds on one clock and holds no unregistered GPU context", () => {
  const featureSrc = walk("scripts/features").filter((f) => /\.(m?js)$/.test(f));
  // A private rolling frame-time average is a second clock: it sheds on its own
  // schedule while the shared ladders say something else.
  const ema = /(\b[\w.]+)\s*=\s*\1\s*\*\s*0?\.\d+\s*\+\s*(\w*(?:dt|ms|frame|delta)\w*)\s*\*\s*0?\.\d+/i;
  for (const f of featureSrc) {
    const src = stripComments(read(f));
    const m = ema.exec(src);
    ok(!m, f, `keeps a private frame-time average (\`${m?.[0]}\`) — shed through Budget.ladder() in core/budget.mjs`);
    ok(!/\b(?:SHED_AT|UNSHED_AT)\b/.test(src), f, "defines its own shed thresholds; they come from the budget's policy");
  }
  // Every shed order is bound to the shared budget somewhere in its feature.
  const byFeature = new Map();
  for (const f of featureSrc) {
    const dir = f.split("/").slice(0, 3).join("/");
    if (!byFeature.has(dir)) byFeature.set(dir, []);
    byFeature.get(dir).push(stripComments(read(f)));
  }
  let shedding = 0;
  for (const [dir, srcs] of byFeature) {
    const all = srcs.join("\n");
    if (/export const SHED_ORDER/.test(all)) {
      shedding++;
      ok(/Budget\.ladder\(/.test(all), dir, "exports a SHED_ORDER that nothing binds to Budget.ladder() — it never sheds");
    }
    if (/getContext\(\s*["'`]webgl|new PIXI\.Application\(/.test(all)) {
      ok(/Surfaces\.register\(/.test(all), dir, "creates its own WebGL context but never registers it with Surfaces — it is never paused or released");
    }
  }
  ok(shedding > 0, "scripts/features", "found no SHED_ORDER at all; the walk is reading the wrong tree");
});

await section("every backdrop blur follows the glass tokens", () => {
  const tokens = read("styles/gl-tokens.css");
  ok(/--gl-glass-k:\s*1;/.test(tokens), "gl-tokens.css", "--gl-glass-k is not declared at :root");
  ok(/--gl-blur:\s*\d+px;/.test(tokens), "gl-tokens.css", "--gl-blur is not declared");
  for (const f of walk("styles").filter((x) => x.endsWith(".css") && !x.endsWith("gl-tokens.css"))) {
    const css = read(f);
    for (const m of css.matchAll(/(?:-webkit-)?backdrop-filter:\s*([^;}]*)/g)) {
      const blurs = [...m[1].matchAll(/blur\(([^()]*(?:\([^()]*\))?[^()]*)\)/g)].map((b) => b[1]);
      for (const b of blurs) {
        ok(/var\(--gl-blur\)|var\(--gl-glass-k\)/.test(b), f,
          `backdrop blur(${b}) ignores the glass tokens — write it as var(--gl-blur) or calc(Npx * var(--gl-glass-k))`);
      }
    }
  }
});

/* ══════════════════════════════════════════════════════════════════════ */

console.log("");
if (problems.length) {
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} problem(s), ${passed} assertion(s) passed.`);
  process.exit(1);
}
console.log(`budget-check: 0 problems, ${passed} assertions passed.`);
