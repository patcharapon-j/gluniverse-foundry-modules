#!/usr/bin/env node
/**
 * GLUniverse Suite — Arcane Surge consistency check.
 *
 *   node tools/arcane-surge-check.mjs
 *
 * Everything this covers fails *silently*. None of it raises; all of it renders.
 *
 *   • The odds live in three places — the level config (threshold), the die
 *     presets (how many faces carry a glyph), and the texture baker (how many
 *     glyph faces it writes). If they disagree the die is a LIE about its own
 *     probability, and it looks completely correct while telling it.
 *   • Severity bands are cumulative upper bounds. Non-monotonic bounds produce a
 *     zero-or-negative-width tier that simply never comes up — a tier the GM
 *     configured and will never once see.
 *   • A shader that will not compile degrades to no overlay rather than erroring.
 *     A uniform declared in the GLSL and never written from JS holds its initial
 *     value forever, so the effect renders, just frozen.
 *   • JS timing constants mirror CSS duration tokens. A drifted pair unmounts
 *     the burst before or after its own animation, which reads as a flicker.
 *   • The level names are built into i18n keys at RUNTIME (`GLAS.level.<id>`),
 *     so a missing key renders the raw key string and nothing else catches it.
 *   • An animated behaviour missing from SHED_ORDER never degrades under load.
 *   • A severity card that can be rolled twice turns one casting into two
 *     verdicts — the exact thing the draft forbids.
 *
 * Zero problems required.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const problems = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);

const FEATURE = "scripts/features/pf2e-arcane-surge";

const constants = await import(`../${FEATURE}/constants.mjs`);
const levels = await import(`../${FEATURE}/levels.mjs`);
const shader = await import(`../${FEATURE}/shader.mjs`);
const anim = await import(`../${FEATURE}/anim.mjs`);

const {
  DEFAULT_LEVEL_CONFIG,
  LEVELS,
  ROWS,
  ROW_INVITED_UNRAVELING,
  TIERS,
  MAX_THRESHOLD,
  BURST_MS,
  FLOURISH_MS,
  SURGE_DIE_DENOMINATION,
} = constants;

/* ══════════════════════════════════════════════════════════════════════
   1. The odds are one number, stated in three places
   ══════════════════════════════════════════════════════════════════════
   `threshold` is simultaneously the d20 result that surges, the count of glyph
   faces baked onto that level's die, and the count the DSN preset asks the
   baker for. Any two of them agreeing is not enough. */

const config = levels.resolveConfig();
const dsnSrc = read(`${FEATURE}/dsn.mjs`);
const bakerSrc = read("tools/gen-surge-textures.mjs");

for (const level of LEVELS) {
  const threshold = config[level].threshold;
  if (threshold !== DEFAULT_LEVEL_CONFIG[level].threshold) {
    fail("odds", `resolveConfig() changed the default threshold for "${level}"`);
  }
  if (levels.glyphFaces(level, config) !== threshold) {
    fail("odds", `glyphFaces("${level}") disagrees with its threshold (${threshold})`);
  }
  if (threshold < 0 || threshold > MAX_THRESHOLD) {
    fail("odds", `"${level}" threshold ${threshold} is outside 0..${MAX_THRESHOLD}`);
  }
}

if (config.stable.threshold !== 0) fail("odds", "Stable must never surge (threshold must be 0)");
if (levels.rollingLevels(config).includes("stable")) fail("odds", "Stable is listed as a rolling level");

// The preset builder must derive its face layout from the shared helper rather
// than hardcoding a count beside it.
if (!/glyphFaces\s*\(/.test(dsnSrc)) {
  fail("dsn.mjs", "die presets do not call glyphFaces() — the face count can drift from the threshold");
}
if (!/glyphFaces\s*\(/.test(bakerSrc) && !/threshold/.test(bakerSrc)) {
  fail("gen-surge-textures.mjs", "the baker does not read thresholds — its face set can drift from the odds");
}

/* ══════════════════════════════════════════════════════════════════════
   2. Severity bands stay monotonic, complete, and reachable-where-intended
   ══════════════════════════════════════════════════════════════════════ */

for (const row of ROWS) {
  const bands = config[row].bands;
  if (!bands) {
    fail("bands", `row "${row}" has no bands`);
    continue;
  }
  let floor = 0;
  for (const tier of TIERS) {
    if (!Number.isInteger(bands[tier])) fail("bands", `row "${row}" tier "${tier}" is not an integer`);
    if (bands[tier] < floor) fail("bands", `row "${row}" tier "${tier}" bound dips below the previous tier`);
    floor = bands[tier];
  }
  if (bands[TIERS[TIERS.length - 1]] !== 100) {
    fail("bands", `row "${row}" does not end at 100 — some d100 results fall off the end`);
  }

  // Every d100 result must resolve to exactly one tier.
  for (let roll = 1; roll <= 100; roll++) {
    const tier = levels.severityTier(roll, bands);
    if (!TIERS.includes(tier)) fail("bands", `row "${row}" roll ${roll} resolved to "${tier}"`);
  }
}

// The draft's defining shape: Fraying reaches Major but never Catastrophic or
// Breach without an invitation. If this ever inverts, the tone of the whole
// subsystem changes and nothing else would report it.
{
  const fraying = config.fraying.bands;
  if (levels.tierWindow("catastrophic", fraying)) fail("bands", "Fraying can reach Catastrophic without invitation");
  if (levels.tierWindow("breach", fraying)) fail("bands", "Fraying can reach Reality Breach without invitation");
  if (!levels.tierWindow("major", fraying)) fail("bands", "Fraying can never reach Major");

  const unbound = config.unbound.bands;
  if (!levels.tierWindow("catastrophic", unbound)) fail("bands", "Unbound can never reach Catastrophic");
  if (levels.tierWindow("breach", unbound)) fail("bands", "Unbound can reach Reality Breach without invitation");

  const unraveling = config.unraveling.bands;
  const breach = levels.tierWindow("breach", unraveling);
  if (!breach) fail("bands", "Unraveling can never reach Reality Breach");

  const invited = config[ROW_INVITED_UNRAVELING].bands;
  const invitedBreach = levels.tierWindow("breach", invited);
  if (!invitedBreach) fail("bands", "Invited-in-Unraveling can never reach Reality Breach");
  // Inviting must be more dangerous than not inviting, or the temptation the
  // whole mechanic rests on is a lie.
  if (breach && invitedBreach && invitedBreach[1] - invitedBreach[0] <= breach[1] - breach[0]) {
    fail("bands", "inviting in Unraveling is no more likely to breach than not inviting");
  }
}

/* ══════════════════════════════════════════════════════════════════════
   3. Exposure resolution — the rules the draft is explicit about
   ══════════════════════════════════════════════════════════════════════ */

{
  const stable = levels.resolveExposure("stable", "none", config);
  if (stable.rollsDie || stable.autoSurge) fail("exposure", "Stable rolls or surges");

  // Steadying is one step down; Fraying steadied is Stable, i.e. no check.
  if (levels.resolveExposure("fraying", "steadied", config).rollsDie) {
    fail("exposure", "a steadied casting in Fraying still rolls (it should be Stable)");
  }
  if (levels.resolveExposure("unbound", "steadied", config).effective !== "fraying") {
    fail("exposure", "steadying in Unbound does not reduce to Fraying");
  }
  if (levels.resolveExposure("unraveling", "steadied", config).effective !== "unbound") {
    fail("exposure", "steadying in Unraveling does not reduce to Unbound");
  }

  // Inviting escalates the ROW, guarantees a surge, and throws no die.
  const invitedFraying = levels.resolveExposure("fraying", "invited", config);
  if (invitedFraying.row !== "unbound") fail("exposure", "inviting in Fraying does not use the Unbound row");
  if (!invitedFraying.autoSurge) fail("exposure", "inviting does not guarantee a surge");
  if (invitedFraying.rollsDie) fail("exposure", "an invited casting throws a d20 whose result is predetermined");

  if (levels.resolveExposure("unbound", "invited", config).row !== "unraveling") {
    fail("exposure", "inviting in Unbound does not use the Unraveling row");
  }
  if (levels.resolveExposure("unraveling", "invited", config).row !== ROW_INVITED_UNRAVELING) {
    fail("exposure", "inviting in Unraveling does not use the invited row");
  }
  // Nothing to invite where the world is solid.
  if (levels.resolveExposure("stable", "invited", config).autoSurge) {
    fail("exposure", "inviting succeeds in Stable, where no instability exists");
  }
  // The two choices cannot stack; invited must win over a stale steadied flag.
  const both = levels.resolveExposure("unraveling", "invited", config);
  if (both.steadied) fail("exposure", "a casting resolved as both steadied and invited");
}

/* ══════════════════════════════════════════════════════════════════════
   4. Hostile config is repaired, not trusted
   ══════════════════════════════════════════════════════════════════════ */

{
  const wild = levels.resolveConfig({
    unbound: { threshold: 999, bands: { minor: 80, major: 20, catastrophic: 50, breach: 3 } },
    stable: { threshold: 7 },
  });
  if (wild.unbound.threshold > MAX_THRESHOLD) fail("config", "an out-of-range threshold survived resolveConfig()");
  if (wild.stable.threshold !== 0) fail("config", "a stored threshold made Stable surge");
  let floor = 0;
  for (const tier of TIERS) {
    if (wild.unbound.bands[tier] < floor) fail("config", "non-monotonic stored bands survived resolveConfig()");
    floor = wild.unbound.bands[tier];
  }
  if (wild.unbound.bands.breach !== 100) fail("config", "repaired bands do not end at 100");
}

/* ══════════════════════════════════════════════════════════════════════
   5. Shader uniforms: declared in GLSL, listed in the table, written from JS
   ══════════════════════════════════════════════════════════════════════
   Any two of the three agreeing is not enough. A uniform present in the GLSL
   and the table but never written holds its initial value for the life of the
   context — the effect renders, just frozen, and nothing reports it. */

for (const [label, frag, uniforms, hostRel] of [
  ["ambient", shader.AMBIENT_FRAG, shader.AMBIENT_UNIFORMS, `${FEATURE}/ambient.mjs`],
  ["burst", shader.BURST_FRAG, shader.BURST_UNIFORMS, `${FEATURE}/burst.mjs`],
  // Playback runs an entirely separate program. A uniform missing here would
  // leave every baked frame drawn at whatever opacity the driver happened to
  // start with — which is usually zero, i.e. an invisible burst.
  ["blit", shader.BLIT_FRAG, shader.BLIT_UNIFORMS, `${FEATURE}/burst.mjs`],
]) {
  const hostSrc = read(hostRel);
  const declared = new Set([...frag.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]));

  for (const name of uniforms) {
    if (!declared.has(name)) fail(`${label} shader`, `"${name}" is in the uniform table but not declared in the GLSL`);
    if (!hostSrc.includes(name)) fail(`${label} shader`, `"${name}" is never looked up or written from ${hostRel}`);
  }
  for (const name of declared) {
    if (!uniforms.includes(name)) fail(`${label} shader`, `"${name}" is declared in the GLSL but missing from the uniform table`);
  }
  // A shader that fails to compile degrades to nothing, so the host must say so
  // rather than assuming success.
  if (!/COMPILE_STATUS/.test(hostSrc) || !/LINK_STATUS/.test(hostSrc)) {
    fail(`${label} shader`, `${hostRel} does not check compile and link status — a broken shader would fail silently`);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   5b. Stable is inert in the SHADER, not only in the host
   ══════════════════════════════════════════════════════════════════════
   `chaosFor("stable")` is 0 and the host tears the overlay down there, so a
   shader that still paints at chaos 0 would never be seen in a session — until
   a cross-fade passes through it, or somebody reuses the shader somewhere that
   does not tear down. This is a source-shape proxy for a render the pure-Node
   tool cannot perform: the alpha must be MULTIPLIED by uChaos, not offset by it.
   `tools/arcane-surge-preview.mjs` is where it can actually be measured. */

{
  if (levels.chaosFor("stable") !== 0) fail("ambient", "chaosFor('stable') is not 0");
  const alphaLine = shader.AMBIENT_FRAG.match(/float\s+alpha\s*=\s*([^;]+);/);
  if (!alphaLine) fail("ambient shader", "no alpha expression found");
  else if (!/\buChaos\s*\*/.test(alphaLine[1])) {
    fail("ambient shader", "alpha is not scaled by uChaos — the veil is still painted at Stable");
  }
}

/* ══════════════════════════════════════════════════════════════════════
   6. Load shedding is bidirectionally complete
   ══════════════════════════════════════════════════════════════════════ */

{
  const order = anim.SHED_ORDER;
  if (!Array.isArray(order) || !order.length) fail("anim.mjs", "SHED_ORDER is empty");
  const hosts = [read(`${FEATURE}/ambient.mjs`), read(`${FEATURE}/burst.mjs`)].join("\n");
  const gated = new Set([...hosts.matchAll(/allows\(\s*["'](\w+)["']\s*\)/g)].map((m) => m[1]));
  for (const name of gated) {
    if (!order.includes(name)) fail("anim.mjs", `"${name}" is gated on but missing from SHED_ORDER — it never degrades`);
  }
  for (const name of order) {
    if (!gated.has(name)) fail("anim.mjs", `SHED_ORDER lists "${name}" but nothing gates on it`);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   7. JS timing mirrors its CSS duration token
   ══════════════════════════════════════════════════════════════════════ */

{
  const css = read("styles/pf2e-arcane-surge.css");
  const tokens = read("styles/gl-tokens.css");
  const tokenMs = (name) => {
    const m = tokens.match(new RegExp(`--gl-d-${name}:\\s*calc\\((\\d+)ms`));
    return m ? Number(m[1]) : null;
  };
  // The burst runs for a deliberate multiple of the cinematic token; the
  // flourish is exactly the splash token. Both must stay tied to the token.
  const cinematic = tokenMs("cinematic");
  const splash = tokenMs("splash");
  if (cinematic && BURST_MS % cinematic !== 0) {
    fail("timing", `BURST_MS (${BURST_MS}) is not a multiple of --gl-d-cinematic (${cinematic}ms)`);
  }
  if (splash && FLOURISH_MS !== splash) {
    fail("timing", `FLOURISH_MS (${FLOURISH_MS}) does not equal --gl-d-splash (${splash}ms)`);
  }
  // The overlay must sit below Foundry's chrome; the burst above it. A session
  // -long overlay over the sidebar would make the UI unusable for hours.
  if (!/\.glas-ambient\b[^}]*z-index:\s*var\(--gl-z-sticky\)/s.test(css)) {
    fail("css", ".glas-ambient must use --gl-z-sticky so the sidebar stays usable");
  }
  if (!/\.glas-burst\b[^}]*z-index:\s*var\(--gl-z-splash\)/s.test(css)) {
    fail("css", ".glas-burst must use --gl-z-splash");
  }
  for (const cls of ["glas-ambient", "glas-burst"]) {
    const block = css.match(new RegExp(`\\.${cls}\\b[^{]*\\{([^}]*)\\}`, "s"));
    if (!block || !/pointer-events:\s*none/.test(block[1])) {
      fail("css", `.${cls} must set pointer-events: none or it will eat clicks`);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════
   8. Runtime-built i18n keys resolve
   ══════════════════════════════════════════════════════════════════════
   `GLAS.level.<id>`, `GLAS.tier.<id>` and `GLAS.mode.<id>` are assembled from
   enum values at runtime. Nothing else in the repo checks them. */

{
  const lang = JSON.parse(read("lang/pf2e-arcane-surge.en.json"));
  const has = (key) => key.split(".").reduce((node, part) => (node == null ? undefined : node[part]), lang) !== undefined;

  for (const level of LEVELS) {
    if (!has(`GLAS.level.${level}`)) fail("i18n", `missing GLAS.level.${level}`);
    if (!has(`GLAS.levelHint.${level}`)) fail("i18n", `missing GLAS.levelHint.${level}`);
  }
  for (const row of ROWS) if (!has(`GLAS.row.${row}`)) fail("i18n", `missing GLAS.row.${row}`);
  for (const tier of TIERS) {
    if (!has(`GLAS.tier.${tier}`)) fail("i18n", `missing GLAS.tier.${tier}`);
    if (!has(`GLAS.tierHint.${tier}`)) fail("i18n", `missing GLAS.tierHint.${tier}`);
  }
  for (const mode of ["none", "steadied", "invited"]) {
    if (!has(`GLAS.mode.${mode}`)) fail("i18n", `missing GLAS.mode.${mode}`);
  }

  // The Control Center's entry for this feature. Held as FLAT keys in the
  // feature's own lang file, which is the convention every other feature here
  // follows — putting them in lang/en.json would work but would scatter one
  // feature's strings across two files.
  for (const key of ["GLS.feature.pf2e-arcane-surge.title", "GLS.feature.pf2e-arcane-surge.hint"]) {
    if (lang[key] === undefined) fail("i18n", `missing ${key} in lang/pf2e-arcane-surge.en.json`);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   9. The die takes its denomination defensively
   ══════════════════════════════════════════════════════════════════════
   `CONFIG.Dice.terms` is a global single-character namespace shared with every
   other module. Overwriting an occupied letter breaks the other module's die
   with no error on either side. */

{
  const dieSrc = read(`${FEATURE}/die.mjs`);
  const write = dieSrc.search(/CONFIG\.Dice\.terms\[[^\]]*\]\s*=/);
  const readBack = dieSrc.search(/CONFIG\.Dice\.terms\[[^\]]*\]\s*(?!=)/);
  if (write < 0) fail("die.mjs", "does not register into CONFIG.Dice.terms");
  // The invariant is ordering, not spelling: the term must be READ before it is
  // written, so an occupied letter can be detected instead of clobbered.
  else if (readBack < 0 || readBack >= write) {
    fail("die.mjs", `takes "${SURGE_DIE_DENOMINATION}" without first reading whether another module holds it`);
  }
  if (!dieSrc.includes("SURGE_DIE_FALLBACK_NOTATION")) {
    fail("die.mjs", "has no plain-d20 fallback for a denomination collision");
  }
}

/* ══════════════════════════════════════════════════════════════════════
   10. One casting, one check; one card, one severity roll
   ══════════════════════════════════════════════════════════════════════ */

{
  const checkSrc = read(`${FEATURE}/check.mjs`);
  const sevSrc = read(`${FEATURE}/severity.mjs`);

  if (!/casting/.test(checkSrc)) fail("check.mjs", "does not key on flags.pf2e.casting");
  if (!/origin/.test(checkSrc)) fail("check.mjs", "has no origin-uuid dedup — one casting could check twice");
  if (!/isReroll/.test(checkSrc)) fail("check.mjs", "does not reject rerolls");
  for (const context of ["damage-taken", "self-effect-applied"]) {
    if (!checkSrc.includes(context)) fail("check.mjs", `does not reject the "${context}" context`);
  }
  // Every client sees createChatMessage; exactly one must act. The invariant is
  // that the handler bails out on any client that is not the elected one.
  if (!/!==\s*game\.user\.id\s*\)\s*return/.test(checkSrc)) {
    fail("check.mjs", "does not bail out on clients that are not the elected roller — every client would roll its own result");
  }
  if (!/testUserPermission(?:\s*\?\.)?\s*\(\s*\w+\s*,\s*["']OWNER["']\s*\)/.test(checkSrc)) {
    fail("check.mjs", "does not decide public-vs-private by OWNER-level actor ownership");
  }

  if (!/getFlag|flags/.test(sevSrc)) fail("severity.mjs", "does not read its result back from a flag");
  if (!/inFlight|_pending|lock/i.test(sevSrc)) {
    fail("severity.mjs", "has no in-flight guard — two simultaneous presses would both roll");
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Report
   ══════════════════════════════════════════════════════════════════════ */

if (problems.length) {
  console.error(`\narcane-surge-check: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n`);
  for (const line of problems) console.error(`  • ${line}`);
  console.error("");
  process.exitCode = 1;
} else {
  console.log("arcane-surge-check: no problems");
}
