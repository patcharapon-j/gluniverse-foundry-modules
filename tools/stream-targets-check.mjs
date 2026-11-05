#!/usr/bin/env node
/**
 * Targeting lines — consistency check.
 *
 * Everything here fails silently: a filter pass that costs a frame on every
 * client and draws nothing wrong, a loop that runs forever with no motion
 * claim (Balanced then stutters it), a hairline sized in world units that
 * vanishes zoomed out, a timing constant nothing reads, a set announced on
 * every sight refresh (the odds re-price and Diorama redraws per frame), and
 * a panel string that reads English in every language.
 *
 *   node tools/stream-targets-check.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");

const problems = [];
let checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) problems.push(msg);
};

const lineSrc = strip(read("scripts/features/stream-targets/targeting/target-line.js"));
const linesSrc = strip(read("scripts/features/stream-targets/targeting/target-lines.js"));

/* ── cost ─────────────────────────────────────────────────────────────── */

ok(!/BlurFilter|\.filters\s*=/.test(lineSrc + linesSrc), "the line runs a PIXI filter: a full pass per frame for a soft edge the bed already draws");
ok(!/loop:\s*(true|-?\d)/.test(lineSrc + linesSrc), "the line loops an animation: a landed line is still, and a loop needs a motion claim it does not hold");
ok(/Budget\.claimMotion\(/.test(linesSrc), "the controller never claims motion: Balanced's idle rate drop stutters the launch");
ok(/claimMotion\(false\)/.test(linesSrc), "the controller never releases its motion claim");

/* ── hairlines ────────────────────────────────────────────────────────── */

const hl = lineSrc.match(/function hairlineWidth\(zoom, resolution\) \{\s*return ([^;]+);/)?.[1] ?? "";
ok(/1 \/ \(zoom \* /.test(hl) && /resolution/.test(hl), "a hairline is not one device pixel (1 / (zoom × resolution))");
ok((lineSrc.match(/hairlineWidth\(/g) ?? []).length >= 3, "the line and the origin ring both size their hairlines through hairlineWidth");

/* ── timing ───────────────────────────────────────────────────────────── */

const { TARGET_LINE_MOTION } = await import(pathToFileURL(join(ROOT, "scripts/features/stream-targets/targeting/line-motion.js")).href);
ok(Object.isFrozen(TARGET_LINE_MOTION), "TARGET_LINE_MOTION is not frozen");
for (const [key, value] of Object.entries(TARGET_LINE_MOTION)) {
  ok(Number.isFinite(value) && value > 0, `TARGET_LINE_MOTION.${key} is not a positive duration`);
  ok(new RegExp(`\\.${key}\\b`).test(lineSrc + linesSrc), `TARGET_LINE_MOTION.${key} is never read: a timing nobody plays`);
}
ok(TARGET_LINE_MOTION.lockDelayMs + TARGET_LINE_MOTION.lockMs >= TARGET_LINE_MOTION.launchMs, "the brackets lock before the line lands");
ok(TARGET_LINE_MOTION.headFadeOutMs < TARGET_LINE_MOTION.retractMs * 0.25, "the head trails a withdrawing body");
ok(!/\b(duration|delay):\s*\d/.test(lineSrc + linesSrc), "a literal duration in the line: it ignores TARGET_LINE_MOTION");

/* ── the announcement other features listen to ────────────────────────── */

ok(/if \(signature === this\.announced\) return;/.test(linesSrc), "linesChanged fires on every sync: the odds re-price and Diorama redraws on every sight refresh");
ok(/Hooks\.callAll\(TARGETS_HOOKS\.linesChanged,[\s\S]{0,200}sourceId, targetId, color: style\?\.color/.test(linesSrc), "the linesChanged payload changed shape: { sourceId, targetId, color } is what the odds and Diorama read");
ok(/#announce\(new Map\(\)\)/.test(linesSrc), "teardown never announces the empty set: the odds and Diorama keep lines that are gone");

/* ── Ink and Signal ───────────────────────────────────────────────────── */

// The canvas cannot read a custom property, so its colours come from the JS
// mirror of `--gl-is-*`. A mirror that drifted from gl-tokens.css paints the
// line in a colour no other surface uses, and nothing reports it.
const { INK_SIGNAL, hexToInt } = await import(pathToFileURL(join(ROOT, "scripts/core/theme.mjs")).href);
const tokensCss = read("styles/gl-tokens.css");
const darkRoot = tokensCss.slice(0, tokensCss.indexOf(".gl-is-paper"));
const camel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
for (const m of darkRoot.matchAll(/--gl-is-([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
  const key = camel(m[1]);
  ok(INK_SIGNAL?.[key]?.toLowerCase() === m[2].toLowerCase(), `theme.mjs INK_SIGNAL.${key} is ${INK_SIGNAL?.[key]}, gl-tokens.css says ${m[2]}`);
}

// No hue is restated in the line: the ink rim and paper hairline are the core's.
ok(!/0x[0-9a-f]{6}\b/i.test(lineSrc + linesSrc), "the line hardcodes a colour: take it from INK_SIGNAL in core/theme.mjs");
ok(/INK_SIGNAL\.ink0/.test(lineSrc) && /INK_SIGNAL\.paper/.test(lineSrc), "the line's ink and paper are not INK_SIGNAL.ink0 / .paper");

// Each relationship is a signal with one job: red is danger to the party,
// green is help, info is a fact with no verdict, steel is the quiet unknown.
const { DEFAULT_TARGETING_SETTINGS: D } = await import(pathToFileURL(join(ROOT, "scripts/features/stream/constants.js")).href);
const want = { colorFriendlyToHostile: "info", colorHostileToFriendly: "red", colorSameSide: "green", colorOther: "steel" };
for (const [key, tone] of Object.entries(want)) {
  ok(D[key] === INK_SIGNAL[tone], `the ${key} default is ${D[key]}, not Ink and Signal's ${tone} (${INK_SIGNAL[tone]})`);
}
ok(new Set(Object.keys(want).map((k) => D[k])).size === 4, "two relationship defaults share a colour: a player cannot tell them apart");

/* ── the panel ────────────────────────────────────────────────────────── */

const hbs = read("templates/stream-targets/section.hbs");
const lang = JSON.parse(read("lang/stream-targets.en.json"));
const bare = hbs.replace(/\{\{[\s\S]*?\}\}/g, "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
ok(!/[A-Za-z]{2,}/.test(bare), `section.hbs prints English outside localize: "${bare.slice(0, 80)}"`);
for (const m of hbs.matchAll(/localize "([^"]+)"/g)) ok(m[1] in lang, `section.hbs localizes ${m[1]}, which the lang file does not have`);

if (problems.length) {
  console.log(problems.map((p) => `✗ ${p}`).join("\n"));
  console.log(`\n${problems.length} problem(s), ${checks} checks`);
  process.exit(1);
}
console.log(`stream-targets: ${checks} checks, 0 problems`);
