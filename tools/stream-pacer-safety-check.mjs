#!/usr/bin/env node
/**
 * GLUniverse Suite — Stream Pacer safety-exemption check.
 *
 *   node tools/stream-pacer-safety-check.mjs
 *
 * The traffic-light safety tool can be hidden from named users, because the
 * account whose screen is captured for a stream must never broadcast the table's
 * private safety signals. Every part of that gating fails *silently*: a missed
 * surface looks perfectly correct on the developer's own screen and only appears
 * on the recording. This asserts the agreements a diff cannot show you:
 *
 *   · The exemption form has FOUR sites that must agree on each column's prefix
 *     — the setting registration, the save handler's `startsWith` branch, the
 *     form context flag, and the template's `name=` attribute. A column added
 *     without a save branch renders, ticks, submits, and stores nothing.
 *   · Every safety surface in module.js must be constructed INSIDE the
 *     `if (!isSafetySurfaceExempt)` gate. The list here is enumerated, so a new
 *     surface added outside a gate fails this check rather than the stream.
 *   · The GM roster chip in pacer-hud.hbs carries safety colour outside anything
 *     named "safety", and its branch must be keyed on `showSafetyLights`, not on
 *     `isGM`. Merely dropping the values makes it WORSE: an absent
 *     `safetyAcknowledged` makes `{{#unless}}` add `awaiting-light` to every row,
 *     and an absent `safetyLight` emits a bare `light-` class.
 *   · The two liveness rules are not interchangeable — the local "am I exempt?"
 *     answer is a snapshot taken at onReady, while "is user X exempt?" must be
 *     read per call or a GM connected before the list changed counts a capture
 *     login as unanswered forever.
 *   · The hint has to keep saying that exempting a real person removes their
 *     only way to signal distress. That sentence is a requirement, not prose.
 *
 * Pure Node, no dependencies, no browser. What it CANNOT do is prove the
 * rendered result — it is a source-shape check, not a semantic one. The only
 * real verification is a session with the capture login signed in.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const SETTINGS = read("scripts/features/stream-pacer/settings.js");
const MODULE = read("scripts/features/stream-pacer/module.js");
const MANAGER = read("scripts/features/stream-pacer/PacerManager.js");
const HUD = read("scripts/features/stream-pacer/PacerHUD.js");
const FORM = read("templates/stream-pacer/exempt-users.hbs");
const PANEL = read("templates/stream-pacer/pacer-hud.hbs");
const LANG = JSON.parse(read("lang/stream-pacer.en.json"));

const problems = [];
const fail = (msg) => problems.push(msg);

/** Strip block comments and whole-line `//` comments so brace matching is safe. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Body of the first `{` at or after `from`, by brace matching. */
function blockAfter(src, from) {
  const open = src.indexOf("{", from);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  return "";
}

/** Body of a named method/function declaration, e.g. `getSafetyRoster(`. */
function bodyOf(src, name) {
  const at = src.search(new RegExp(`(^|\\s)${name}\\s*\\(`, "m"));
  return at === -1 ? null : blockAfter(src, at);
}

/**
 * Index of a setting's `game.settings.register(...)` call — not its `.set(...)`,
 * which for these keys comes first in the file.
 */
const registrationOf = (key) => SETTINGS.indexOf(`register(MODULE_ID, '${key}'`);

/** Resolve a dotted i18n key against the lang file. */
const localizes = (key) => key.split(".").reduce((o, k) => (o == null ? o : o[k]), LANG) !== undefined;

/* ── 1. The three exemption columns: four sites must agree ────────────── */

const COLUMNS = [
  { prefix: "bars", setting: "sp.exemptUsers", ctx: "isExempt", column: "ExemptBarsColumn" },
  { prefix: "peril", setting: "sp.perilExemptUsers", ctx: "isPerilExempt", column: "ExemptPerilColumn" },
  { prefix: "safety", setting: "sp.safetyExemptUsers", ctx: "isSafetyExempt", column: "ExemptSafetyColumn" }
];

const saveBody = bodyOf(stripComments(SETTINGS), "saveExemptUsers");
if (!saveBody) fail("settings.js: saveExemptUsers() not found — the save-handler checks below cannot run.");

const formCtxBody = (() => {
  const at = SETTINGS.indexOf("class ExemptUsersConfig");
  if (at === -1) return null;
  return bodyOf(stripComments(SETTINGS.slice(at)), "_prepareContext");
})();
if (!formCtxBody) fail("settings.js: ExemptUsersConfig._prepareContext() not found — the form-context checks cannot run.");

for (const col of COLUMNS) {
  const reg = registrationOf(col.setting);
  if (reg === -1) {
    fail(`settings.js never registers '${col.setting}'.`);
  } else {
    const block = blockAfter(SETTINGS, reg);
    for (const [label, re] of [
      ["scope: 'world'", /scope:\s*'world'/],
      ["config: false", /config:\s*false/],
      ["type: Array", /type:\s*Array/],
      ["default: []", /default:\s*\[\s*\]/]
    ]) {
      if (!re.test(block)) fail(`'${col.setting}' is not registered with ${label} — the exemption would not behave like its siblings.`);
    }
  }

  if (saveBody && !saveBody.includes(`startsWith('${col.prefix}-')`)) {
    fail(`saveExemptUsers() has no "${col.prefix}-" branch, so that column submits and stores nothing.`);
  }
  if (saveBody && !saveBody.includes(`'${col.setting}'`)) {
    fail(`saveExemptUsers() never writes '${col.setting}'.`);
  }
  if (formCtxBody && !new RegExp(`\\b${col.ctx}\\s*:`).test(formCtxBody)) {
    fail(`ExemptUsersConfig._prepareContext() never emits "${col.ctx}", so that column always renders unticked.`);
  }
  if (!FORM.includes(`name="${col.prefix}-{{id}}"`)) {
    fail(`exempt-users.hbs has no <input name="${col.prefix}-{{id}}">.`);
  }
  if (!new RegExp(`\\{\\{#if ${col.ctx}\\}\\}checked`).test(FORM)) {
    fail(`exempt-users.hbs never checks "${col.ctx}", so an existing exemption renders as unticked and un-ticks itself on save.`);
  }
  if (!FORM.includes(`STREAM_PACER.Settings.${col.column}`)) {
    fail(`exempt-users.hbs has no header cell localizing STREAM_PACER.Settings.${col.column}.`);
  }
}

// The reverse direction: nothing may exist at only one of the four sites.
const declared = new Set(COLUMNS.map((c) => c.prefix));
for (const m of FORM.matchAll(/name="([a-z]+)-\{\{id\}\}"/g)) {
  if (!declared.has(m[1])) fail(`exempt-users.hbs offers a "${m[1]}-" column this check does not know about — add it to COLUMNS here, and confirm saveExemptUsers() stores it.`);
}
for (const m of (saveBody ?? "").matchAll(/startsWith\('([a-z]+)-'\)/g)) {
  if (!declared.has(m[1])) fail(`saveExemptUsers() reads a "${m[1]}-" prefix this check does not know about — add it to COLUMNS here.`);
}

/* ── 2. Every safety surface sits inside the exemption gate ───────────── */

const MODULE_SRC = stripComments(MODULE);

// Bodies of every `if (!isSafetySurfaceExempt)` in onReady.
const gates = [];
for (const m of MODULE_SRC.matchAll(/if\s*\(\s*!\s*isSafetySurfaceExempt\s*\)/g)) {
  gates.push(blockAfter(MODULE_SRC, m.index));
}
if (!gates.length) fail("module.js has no `if (!isSafetySurfaceExempt)` gate at all — every safety surface is on stream.");

if (!/captureLocalSafetyExemption\(\)/.test(MODULE_SRC)) {
  fail("module.js never calls captureLocalSafetyExemption(), so the local snapshot stays false and no gate can ever close.");
}

// Enumerated, so a surface added later without a gate fails here.
const SURFACES = [
  { find: "new SafetyRequestOverlay(", what: "the player check-in banner (and its fallback lamps, and the body.sp-safety-request dimming)" },
  { find: "new SafetyLightPanel(", what: "the player's own traffic light" },
  { find: "new SafetyAlertOverlay(", what: "the GM alert pill and the escalated viewport treatment" },
  { find: "PacerManager.onSafetyLight(", what: "the escalation chime subscription" }
];

for (const surface of SURFACES) {
  const total = MODULE_SRC.split(surface.find).length - 1;
  if (total === 0) {
    fail(`module.js no longer constructs \`${surface.find}\` — this check is stale, or ${surface.what} was removed.`);
    continue;
  }
  const gated = gates.filter((g) => g.includes(surface.find)).length;
  if (gated < total) {
    fail(`module.js: \`${surface.find}\` appears ${total}× but only ${gated}× inside an \`if (!isSafetySurfaceExempt)\` gate — ${surface.what} would still reach a safety-exempt client.`);
  }
}

/* ── 3. The two liveness rules, and the roster filter ─────────────────── */

const isExemptBody = bodyOf(stripComments(SETTINGS), "export function isSafetyExempt");
if (!isExemptBody) {
  fail("settings.js does not export isSafetyExempt(userId).");
} else if (!isExemptBody.includes("game.settings.get")) {
  fail("isSafetyExempt() does not read the setting on each call. A cache here goes stale on a GM that was already connected when the list changed, and it would count a capture login as unanswered forever.");
}

if (!/export function isLocallySafetyExempt/.test(SETTINGS) || !/export function captureLocalSafetyExemption/.test(SETTINGS)) {
  fail("settings.js must export both captureLocalSafetyExemption() (the onReady snapshot) and isLocallySafetyExempt() (its reader).");
}

const rosterBody = bodyOf(stripComments(MANAGER), "getSafetyRoster");
if (!rosterBody) fail("PacerManager: getSafetyRoster() not found.");
else if (!rosterBody.includes("isSafetyExempt(")) {
  fail("getSafetyRoster() does not filter safety-exempt users, so a capture login inflates `total` and sits in `pending` forever — no check-in can read as complete.");
}
if (rosterBody && rosterBody.includes("isLocallySafetyExempt(")) {
  fail("getSafetyRoster() must ask about EACH user (isSafetyExempt), not about the local client (isLocallySafetyExempt).");
}

const announceBody = bodyOf(stripComments(MANAGER), "announceSafetyLight");
if (!announceBody) fail("PacerManager: announceSafetyLight() not found.");
else if (!announceBody.includes("isLocallySafetyExempt(")) {
  fail("announceSafetyLight() does not stop a safety-exempt client re-broadcasting its own light when a GM joins or reloads.");
}

const hudSafetyBody = bodyOf(stripComments(HUD), "_prepareSafetyContext");
if (!hudSafetyBody) fail("PacerHUD: _prepareSafetyContext() not found.");
else if (!hudSafetyBody.includes("isLocallySafetyExempt(")) {
  fail("_prepareSafetyContext() does not return an inert context when locally exempt. It is the single choke point for the container's `safety-alert-*` tier class, so the panel would still change appearance when a light is raised.");
}

/* ── 4. The HUD template's safety branches are guarded ────────────────── */

// Tokens that must never render on a safety-exempt client. Each is expected on a
// line guarded by showSafetyLights — either on the line itself, or (for block
// openers) on one of the two lines above it.
const GUARDED = [
  "safetyLight",
  "safetyLightTitle",
  "safetyAcknowledged",
  "awaiting-light",
  'class="p-light"',
  "safety-check-btn",
  "safety-results-sec"
];

const panelLines = PANEL.split(/\r?\n/);
for (const [i, line] of panelLines.entries()) {
  if (line.trimStart().startsWith("{{!--")) continue;
  for (const token of GUARDED) {
    if (!line.includes(token)) continue;
    const window = panelLines.slice(Math.max(0, i - 2), i + 1).join("\n");
    if (!window.includes("showSafetyLights")) {
      fail(`pacer-hud.hbs:${i + 1} renders "${token}" with no showSafetyLights guard within two lines — it would reach a safety-exempt GM client.`);
    }
  }
}

if (/\{\{#if\s+\.\.\/isGM\}\}light-/.test(PANEL)) {
  fail("pacer-hud.hbs still keys the roster chip's safety colour on ../isGM. A safety-exempt GM client would show it.");
}
if (/\{\{#if isGM\}\}\{\{#if safety\.show\}\}/.test(PANEL)) {
  fail("pacer-hud.hbs still keys the raised-light board on isGM alone.");
}
if (!/showSafetyLights,/.test(HUD)) {
  fail("PacerHUD._prepareContext() does not put `showSafetyLights` in the template context, so every guard added to pacer-hud.hbs is permanently false.");
}
if (!/showSafetyLights\s*=\s*game\.user\.isGM\s*&&\s*!isLocallySafetyExempt\(\)/.test(HUD)) {
  fail("PacerHUD: showSafetyLights must be `game.user.isGM && !isLocallySafetyExempt()` — anything looser leaks, anything tighter hides the board from every GM.");
}

/* ── 5. Every referenced i18n key resolves ────────────────────────────── */

for (const src of [
  { name: "exempt-users.hbs", text: FORM },
  { name: "pacer-hud.hbs", text: PANEL }
]) {
  for (const m of src.text.matchAll(/localize\s+['"]([\w.]+)['"]/g)) {
    if (!localizes(m[1])) fail(`${src.name} localizes "${m[1]}", which lang/stream-pacer.en.json does not define — Foundry would print the raw key.`);
  }
}

for (const col of COLUMNS) {
  const reg = registrationOf(col.setting);
  if (reg === -1) continue;
  for (const m of blockAfter(SETTINGS, reg).matchAll(/'(STREAM_PACER\.[\w.]+)'/g)) {
    if (!localizes(m[1])) fail(`'${col.setting}' is registered with "${m[1]}", which lang/stream-pacer.en.json does not define.`);
  }
}

// The warning in the hint is a requirement, not prose: exempting a real person
// removes their only channel for signalling distress, and the GM must be told.
const HINTS = [
  ["Settings.ExemptUsersHint", LANG.STREAM_PACER?.Settings?.ExemptUsersHint],
  ["Settings.SafetyExemptUsersHint", LANG.STREAM_PACER?.Settings?.SafetyExemptUsersHint]
];
for (const [key, text] of HINTS) {
  if (!text) {
    fail(`lang/stream-pacer.en.json is missing ${key}.`);
    continue;
  }
  if (!/capture/i.test(text)) fail(`${key} no longer says the safety exemption is meant for capture/overlay logins.`);
  if (!/distress/i.test(text)) fail(`${key} no longer warns that exempting a real person removes their means of signalling distress. That sentence is required by the spec.`);
}

/* ── Report ───────────────────────────────────────────────────────────── */

console.log(
  `checked ${COLUMNS.length} exemption columns, ${SURFACES.length} safety surfaces, ` +
  `${gates.length} gate${gates.length === 1 ? "" : "s"}, ${GUARDED.length} guarded template tokens`
);
if (problems.length) {
  for (const p of problems) console.log(`FAIL  ${p}`);
  console.log(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}`);
  process.exit(1);
}
console.log("OK");
