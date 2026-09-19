#!/usr/bin/env node
/**
 * GLUniverse Stream — consistency check for `stream`, `stream-cards` and
 * `stream-targets`.
 *
 * Everything here fails *silently*. A feature→feature import that stops
 * resolving is a ReferenceError on one code path nobody walks in a preview; a
 * hook name spelled two ways stops the camera reframing while every frame still
 * draws; a legacy remap pointing at an unregistered key restores nothing and
 * looks like it worked; the crack re-forking from core changes a creature's
 * Broken card and a stream critical into two different cracks with nothing
 * reported; and the card feed registering one phase late leaves the overlay
 * cloning chat cards forever.
 *
 * Source-shape checks only. It cannot prove what a session renders.
 *
 *   node tools/stream-check.mjs
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, normalize } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const FEATURES = ["stream", "stream-cards", "stream-targets"];

const problems = [];
const fail = (msg) => problems.push(msg);
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function walk(dir, out = []) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(js|mjs)$/.test(name)) out.push(rel);
  }
  return out;
}

const sources = FEATURES.flatMap((f) => walk(`scripts/features/${f}`));

/* ---------------------------------------------------------------- imports -- */
// A feature→feature import is allowed here, but only because the modules it
// reaches for are side-effect-free. If one stops resolving nothing errors until
// the code path runs.
function exportsOf(rel) {
  const s = strip(read(rel));
  const names = new Set();
  for (const m of s.matchAll(/export\s+(?:async\s+)?(?:function|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of s.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of s.matchAll(/export\s*\{([^}]*)\}/g))
    for (const part of m[1].split(",")) {
      const t = part.trim();
      if (t) names.add((t.split(/\s+as\s+/)[1] ?? t).trim());
    }
  return names;
}

for (const f of sources) {
  const s = strip(read(f));
  for (const m of s.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'](\.[^"']+)["']/g)) {
    const target = normalize(join(dirname(f), m[2]));
    if (!existsSync(join(ROOT, target))) {
      fail(`${f}: import target does not exist: ${m[2]}`);
      continue;
    }
    const have = exportsOf(target);
    for (const part of m[1].split(",")) {
      const t = part.trim();
      if (!t) continue;
      const name = t.split(/\s+as\s+/)[0].trim();
      if (!have.has(name)) fail(`${f}: imports "${name}" from ${m[2]}, which does not export it`);
    }
  }
}

/* ------------------------------------------------------- dependency direction */
// `stream` must never import a child. The chat overlay reaches roll cards
// through a slot precisely so this edge does not exist; restore it and the
// three-way split becomes a cycle.
for (const f of walk("scripts/features/stream")) {
  const s = strip(read(f));
  if (/from\s+["']\.\.\/stream-(cards|targets)\//.test(s)) {
    fail(`${f}: \`stream\` imports a child feature — use a slot in extensions.mjs instead`);
  }
}

/* ------------------------------------------------------------- hook names -- */
// Under the suite id an un-namespaced hook is a name any feature could raise,
// and an emitter/listener mismatch is silent.
for (const f of sources) {
  const s = strip(read(f));
  for (const m of s.matchAll(/Hooks\.(?:on|once|callAll)\(\s*`\$\{MODULE_ID\}\.([A-Za-z0-9_.]*)`/g)) {
    fail(`${f}: ad-hoc hook name \`\${MODULE_ID}.${m[1]}\` — use the HOOKS map so emitter and listener cannot drift`);
  }
}

/* --------------------------------------------------------------- lifecycle -- */
// The chat overlay asks for a feed in its constructor, during `stream`'s
// onReady. Phases run in registration order, so a feed registered from
// `stream-cards`' onReady arrives too late — forever.
{
  const s = strip(read("scripts/features/stream-cards/index.mjs"));
  const onInit = s.match(/onInit\(\)\s*\{([\s\S]*?)\n  \}/);
  const onReady = s.match(/onReady\(\)\s*\{([\s\S]*?)\n  \}/);
  if (!onInit || !/registerCardFeed\(/.test(onInit[1])) {
    fail("stream-cards/index.mjs: registerCardFeed must be called from onInit — from onReady it is one phase too late and the overlay keeps a null feed");
  }
  if (onReady && /registerCardFeed\(/.test(onReady[1])) {
    fail("stream-cards/index.mjs: registerCardFeed is called from onReady, which runs after the overlay is built");
  }
}

// No feature may act at import time.
for (const f of sources) {
  const s = strip(read(f));
  for (const m of s.matchAll(/^(Hooks\.(?:on|once)\(|game\.settings\.register)/gm)) {
    fail(`${f}: "${m[1]}" at module scope — a disabled feature must be inert, not merely idle`);
  }
}

/* ---------------------------------------------------------------- the crack -- */
// The standalone module forked core/fx-glsl.mjs verbatim. A fourth copy that is
// currently identical is the worst state: it looks right until it silently is
// not.
{
  const s = strip(read("scripts/features/stream-cards/fx/crack-glsl.js"));
  for (const block of ["FX_GLSL_NOISE", "FX_GLSL_BREAK_FIELD", "FX_GLSL_BREAK_PULSE"]) {
    if (!new RegExp(`import[\\s\\S]*?\\b${block}\\b[\\s\\S]*?core/fx-glsl\\.mjs`).test(s)) {
      fail(`stream-cards/fx/crack-glsl.js: ${block} must be imported from core/fx-glsl.mjs, never restated`);
    }
    if (new RegExp(`(export\\s+)?const\\s+${block}\\s*=`).test(s)) {
      fail(`stream-cards/fx/crack-glsl.js: ${block} is declared locally — that is the fork coming back`);
    }
  }
  if (/const\s+SUPERSAMPLE\s*=/.test(strip(read("scripts/features/stream-cards/fx/crack-renderer.js")))) {
    fail("stream-cards/fx/crack-renderer.js: SUPERSAMPLE re-declared — import FX_SUPERSAMPLE from core/fx-glsl.mjs");
  }
  // The colours must come from core too, or gold drifts between a creature's
  // Broken card and a stream critical.
  if (!/FX_BREAK_COLORS/.test(s)) {
    fail("stream-cards/fx/crack-glsl.js: crack colours must come from core's FX_BREAK_COLORS");
  }
}

/* ------------------------------------------------ every shader uniform is written */
// A uniform declared in GLSL and never written from JS silently holds whatever
// the driver started it at.
{
  const glsl = read("scripts/features/stream-cards/fx/crack-glsl.js");
  const frag = glsl.match(/FX_FRAG_ROLL_CARD_BREAK = `([\s\S]*?)`;/);
  if (!frag) fail("stream-cards/fx/crack-glsl.js: could not find FX_FRAG_ROLL_CARD_BREAK");
  else {
    const declared = new Set();
    for (const m of frag[1].matchAll(/uniform\s+\w+\s+([^;]+);/g))
      for (const n of m[1].split(",")) declared.add(n.trim());
    declared.delete("uSampler"); // PIXI binds this itself
    const host = read("scripts/features/stream-cards/fx/crack-renderer.js");
    for (const u of declared) {
      if (!new RegExp(`\\b${u}\\b`).test(host)) {
        fail(`crack-renderer.js: uniform ${u} is declared in the shader but never written — it will hold its initial value forever`);
      }
    }
  }
}

/* ------------------------------------------------------------ setting prefixes */
// The catalog routes on settingPrefix. A key whose prefix does not match its
// feature is hidden from Foundry's sheet *and* absent from the Control Center,
// i.e. reachable only from the console.
const PREFIX_OF = { stream: "stream.", "stream-cards": "stream.card", "stream-targets": "tgt." };
for (const f of FEATURES) {
  const adapter = strip(read(`scripts/features/${f}/index.mjs`));
  const m = adapter.match(/settingPrefix:\s*([A-Za-z0-9_]+)/);
  if (!m) fail(`${f}/index.mjs: no settingPrefix declared`);
}
{
  // stream.card must be strictly longer than stream., or the catalog's
  // longest-first sort hands the child's keys to the parent.
  if (!PREFIX_OF["stream-cards"].startsWith(PREFIX_OF.stream)) {
    fail("stream-cards prefix must nest inside stream's");
  }
  if (PREFIX_OF["stream-cards"].length <= PREFIX_OF.stream.length) {
    fail("stream-cards prefix must be strictly longer than stream's, or the catalog routes its keys to the parent");
  }
}

/* --------------------------------------------------------- legacy migration -- */
// A remap whose target is not a registered key is skipped in silence.
{
  const registered = new Set();
  const st = strip(read("scripts/features/stream/settings.js"));
  const block = st.match(/const SETTINGS = \{([\s\S]*?)\n\};/);
  if (block) for (const m of block[1].matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)) registered.add("stream." + m[1]);
  const tg = strip(read("scripts/features/stream-targets/settings.js"));
  for (const m of tg.matchAll(/(\w+): `\$\{PREFIX\}(\w+)`/g)) registered.add("tgt." + m[2]);
  const cd = strip(read("scripts/features/stream-cards/settings.js"));
  for (const m of cd.matchAll(/(\w+): `\$\{CARDS_PREFIX\}\.(\w+)`/g)) registered.add("stream.card." + m[2]);

  const RESOLVE = {
    "SETTINGS.settings": "tgt.settings",
    "SETTINGS.showLines": "tgt.showLines",
    "SETTINGS.defaultRollArt": "stream.card.defaultRollArt",
  };
  for (const f of FEATURES) {
    const s = strip(read(`scripts/features/${f}/index.mjs`));
    const m = s.match(/legacy: \{[\s\S]*?settings: \{([\s\S]*?)\},/);
    if (!m) continue;
    for (const line of m[1].split("\n")) {
      const mm = line.match(/^\s*([A-Za-z0-9_]+):\s*(.+?),\s*$/);
      if (!mm) continue;
      const target = RESOLVE[mm[2]] ?? mm[2].replace(/^"|"$/g, "");
      if (!registered.has(target)) {
        fail(`${f}/index.mjs: legacy remap ${mm[1]} -> ${target}, which no feature registers — the migration would restore nothing`);
      }
    }
  }
}

/* --------------------------------------------------- the attested write path -- */
// The two settings that decide who the feature answers to must never be
// delegable, or one forged request is a permanent escalation.
{
  const s = strip(read("scripts/features/stream/director-auth.mjs"));
  const keys = s.match(/DELEGABLE_KEYS = Object\.freeze\(new Set\(\[([\s\S]*?)\]\)\)/);
  if (!keys) fail("director-auth.mjs: could not find DELEGABLE_KEYS");
  else {
    for (const forbidden of ["streamUserId", "trustedDirectorUserIds"]) {
      if (new RegExp(`\\b${forbidden}\\b`).test(keys[1])) {
        fail(`director-auth.mjs: ${forbidden} is delegable — it decides who the feature answers to and must stay GM-only`);
      }
    }
  }
  // Authority must come from the document the change arrived on, never from
  // anything inside the payload.
  if (/request\.(userId|user|senderId|author)\b/.test(s)) {
    fail("director-auth.mjs: an identity is read out of the request payload — authority must come from the User document it arrived on");
  }
  if (!/delegationRefused\s*=\s*true/.test(s)) {
    fail("director-auth.mjs: no fail-closed path — a refused self-flag write must disable delegation, not fall back to something weaker");
  }

  // The whole channel rides flags whose keys contain a dot (`stream.request`).
  // Foundry does not agree with itself about the shape such a key arrives in —
  // `setFlag` sends the literal dotted key, `getFlag`/`unsetFlag` treat it as a
  // nested path — so bracketing it off `changes` matches under one shape and
  // matches nothing under the other. That is the entire feature doing nothing,
  // with no error on any console, which is exactly how it shipped.
  if (/changes\s*\??\.\s*flags\s*\??\.\s*\[\s*SUITE_ID\s*\]\s*\??\.\s*\[\s*(?:REQUEST_FLAG|COMMAND_FLAG)\s*\]/.test(s)) {
    fail("director-auth.mjs: a flag is bracketed off the change by its dotted key — accept both shapes and read the value off the document");
  }
  // And a change is a diff: the same command twice differs only in `at`, so the
  // second one carries no `command` at all. The value has to come off the
  // document, where it is whole.
  if (!/getFlag\(SUITE_ID,\s*flagKey\)/.test(s)) {
    fail("director-auth.mjs: the flag value is not read back off the User document — a repeat request arrives as a partial diff and is dropped");
  }
}

/* ------------------------------------------- what a trusted director can reach -- */
// Appointing a director does nothing unless every road in opens for one. Each of
// these fails silently: the GM's own screen is correct in all of them.
{
  // The Control Center shows no editors and no world settings to a non-GM, so
  // the scene control is a director's only way in — and a `button` tool resolves
  // through `onChange`, which fires only when the active tool *changes*.
  const main = strip(read("scripts/features/stream/main.js"));
  if (!/bindSuiteToolClicks\(/.test(main)) {
    fail("stream/main.js: the control-room scene tool binds no click handler — a `button` tool swallows repeat clicks and the panel opens once per session at best");
  }
  // A settings menu whose `type` is not an Application subclass is rejected by
  // `registerMenu`, and `Suite.registerAllSettings` catches the throw. Every
  // setting this feature owns is `config: false`, so the cost is a Control
  // Center section with no settings and no button: a feature with no way in.
  if (/type:\s*StreamControlRoomShim\b/.test(main)) {
    fail("stream/main.js: the control-room menu type is a bare class — `registerMenu` rejects anything that is not a FormApplication/ApplicationV2 subclass, and the throw is swallowed");
  }
  // Tracked tokens are a scene flag with a delegated write path of its own, so
  // the canvas button that sets them is a director's, not the GM's alone.
  const tracking = strip(read("scripts/features/stream/token-tracking.js"));
  if (/addHudButton\([^)]*\)\s*\{\s*if\s*\(\s*!\s*game\.user\s*\??\.\s*isGM\s*\)/.test(tracking)) {
    fail("stream/token-tracking.js: the token-HUD tracking button is gated on isGM — a director can see the tracking list and not add to it");
  }
  // Editing and reading are different questions, and the panel used to compute
  // the answer and never use it: a director who could not save got live-looking
  // controls that threw every edit away without a word.
  const panel = read("templates/stream/director.hbs");
  if (!/\{\{#if readOnly\}\}/.test(panel) || !/<fieldset[^>]*\{\{#if readOnly\}\}disabled/.test(panel)) {
    fail("templates/stream/director.hbs: the panel is not disabled when this client cannot save — an edit permission computed and not used is an edit that vanishes silently");
  }
  // A section whose feature refuses a non-GM has to say so, or it is the same
  // silent discard one level down.
  for (const [feature, setter] of [["stream-cards", "setDefaultRollArt"], ["stream-targets", "setTargetingSettings"]]) {
    const index = strip(read(`scripts/features/${feature}/index.mjs`));
    const settings = strip(read(`scripts/features/${feature}/settings.js`));
    if (!new RegExp(`${setter}[\\s\\S]{0,200}isGM`).test(settings)) continue; // gained a delegated path
    if (!/registerPanelSection\(\{[\s\S]*?gmOnly:\s*true/.test(index)) {
      fail(`${feature}/index.mjs: its panel section does not declare gmOnly, but its setters refuse a non-GM — a director's edits there disappear in silence`);
    }
  }
}

// No feature may open a raw socket: the suite multiplexes one channel.
for (const f of sources) {
  if (/game\.socket\s*\??\.\s*(on|emit)\b/.test(strip(read(f)))) {
    fail(`${f}: touches game.socket directly — use emitSocket/onSocket from core/socket.mjs`);
  }
}

/* --------------------------------------------------------- reduced motion --- */
// The suite ignores the OS preference by standing rule; Foundry's own
// photosensitive mode is a deliberate user choice and is honoured.
for (const f of sources) {
  const s = strip(read(f));
  if (/prefers-reduced-motion/.test(s)) {
    fail(`${f}: reads the OS prefers-reduced-motion query, which the suite deliberately ignores`);
  }
}
if (!/photosensitiveMode/.test(strip(read("scripts/features/stream/motion/engine.js")))) {
  fail("stream/motion/engine.js: photosensitiveMode check is gone — that one is a deliberate user choice and is kept");
}

/* ------------------------------------------------------------- the engine --- */
// The anime.js engine is shared with a dozen features.
for (const f of sources) {
  const s = strip(read(f));
  if (/useDefaultMainLoop|engine\.(update|pause|wake)\s*\(/.test(s)) {
    fail(`${f}: drives the shared anime.js engine — canvas sync belongs in a PIXI ticker callback, not in the engine's main loop`);
  }
}

/* ------------------------------------------------------------------- i18n --- */
{
  const lang = {};
  for (const f of FEATURES) Object.assign(lang, JSON.parse(read(`lang/${f}.en.json`)));
  const files = [...sources];
  for (const f of FEATURES) {
    const dir = `templates/${f}`;
    if (existsSync(join(ROOT, dir))) for (const n of readdirSync(join(ROOT, dir))) files.push(`${dir}/${n}`);
  }
  for (const f of files) {
    const s = read(f);
    for (const m of s.matchAll(/["'`](GLUNIVERSE_STREAM\.[A-Za-z0-9_.]+)["'`]/g)) {
      if (!(m[1] in lang)) fail(`${f}: i18n key ${m[1]} is not defined`);
    }
    for (const m of s.matchAll(/["'`](GLS\.feature\.[A-Za-z0-9_.-]+)["'`]/g)) {
      if (!(m[1] in lang)) fail(`${f}: i18n key ${m[1]} is not defined`);
    }
  }
  // The settings loop builds its keys at runtime, so nothing else catches these.
  const st = strip(read("scripts/features/stream/settings.js"));
  const block = st.match(/const SETTINGS = \{([\s\S]*?)\n\};/);
  if (block) {
    for (const m of block[1].matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)) {
      for (const part of ["name", "hint"]) {
        const key = `GLUNIVERSE_STREAM.settings.${m[1]}.${part}`;
        if (!(key in lang)) fail(`stream/settings.js: runtime-built i18n key ${key} is not defined`);
      }
    }
  }
}

/* ------------------------------------------------------------------- CSS ---- */
for (const f of ["styles/stream.css", "styles/stream-cards.css", "styles/stream-targets.css"]) {
  const s = read(f);
  if (/@font-face/.test(s)) fail(`${f}: @font-face — gl-fonts.css is the only place faces are declared`);
  if (/@import\s+url\(['"]?http/.test(s)) fail(`${f}: network @import`);
  for (const m of s.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)) {
    if (/^gl-/.test(m[1])) fail(`${f}: @keyframes ${m[1]} uses the bare gl- prefix, which silently overrides the shared pool`);
  }
  // Foundation tokens are global: redeclaring one repaints every feature after it.
  for (const m of s.matchAll(/^\s*(--gl-(?:ink|text|hair|edge|surface|etch|display|tech|tint)[a-z0-9-]*)\s*:/gm)) {
    fail(`${f}: redeclares foundation token ${m[1]} outside gl-tokens.css`);
  }
}

/* --------------------------------------------------- the roll card's headline */
// The die is already drawn with its natural result on it in the widest type on
// the card. "Result", "Natural 20" and "Natural 1" restated that number beside
// it, in the room the skill, spell, action and target on the left had to give
// up — and that left-hand line is the one thing a viewer cannot reconstruct from
// anything else on screen. They are gone; nothing here would notice them coming
// back, because a card with a redundant label in it renders perfectly.
{
  const card = strip(read("scripts/features/stream-cards/cards/roll-card.js"));
  for (const gone of ["Result", "Natural20", "Natural1"]) {
    if (new RegExp(`["'\`]${gone}["'\`]`).test(card)) {
      fail(`stream-cards/cards/roll-card.js: the "${gone}" label is back — the die beside it already says the number, and the room it takes comes out of the skill/spell/action line`);
    }
  }
  const lang = JSON.parse(read("lang/stream-cards.en.json"));
  for (const gone of ["Result", "Natural20", "Natural1"]) {
    if (`GLUNIVERSE_STREAM.rollCard.${gone}` in lang) {
      fail(`lang/stream-cards.en.json: GLUNIVERSE_STREAM.rollCard.${gone} is back — nothing renders it, and a label nothing renders is an invitation to render it`);
    }
  }
  // A check with no heading in its flavor falls back to a key, not to PF2e's raw
  // context type: "flat-check" is an identifier, not a phrase to put on a stream.
  const reader = strip(read("scripts/features/stream-cards/pf2e/read-message.js"));
  const keys = reader.match(/CHECK_TYPE_KEYS = Object\.freeze\(\{([\s\S]*?)\}\)/);
  if (!keys) fail("stream-cards/pf2e/read-message.js: could not find CHECK_TYPE_KEYS");
  else {
    const names = [...keys[1].matchAll(/:\s*"([A-Za-z]+)"/g)].map((m) => m[1]);
    if (!names.length) fail("read-message.js: CHECK_TYPE_KEYS is empty — every accepted check type needs a label behind it");
    for (const name of names) {
      // Built at runtime from the model, so nothing else catches a missing one.
      if (!(`GLUNIVERSE_STREAM.rollCard.${name}` in lang)) {
        fail(`lang/stream-cards.en.json: GLUNIVERSE_STREAM.rollCard.${name} is not defined — a check with no heading would headline with the key itself`);
      }
      if (!new RegExp(`\\b${name}:`).test(card)) {
        fail(`roll-card.js: DEFAULT_LABELS has no ${name} — the English fallback is what a world with no translation loaded shows`);
      }
    }
  }
  if (/label:\s*isSpellAttack \? derived\.item\.name : heading \?\? context\.type/.test(reader)) {
    fail("read-message.js: a check's headline falls back to PF2e's raw context type — hand over a CHECK_TYPE_KEYS key instead");
  }
}

/* ------------------------------------------- the degree is not gated on a DC */
// PF2e resolves the outcome itself and records it on the message and on the roll;
// where it puts the DC is its own business. A flat check — the DC 11 off a
// Concealed card, the DC 5 off Stupefied, a recovery check — is the case where
// the two part company, so requiring `context.dc` before reading the outcome left
// every flat check on the stream with no Success and no Failure on it while the
// card rendered perfectly.
{
  const reader = strip(read("scripts/features/stream-cards/pf2e/read-message.js"));
  const check = reader.match(/function readCheck\([\s\S]*?\n\}/);
  if (!check) fail("stream-cards/pf2e/read-message.js: could not find readCheck");
  else {
    if (/dcValue === null \?\s*null\s*:/.test(check[0])) {
      fail("read-message.js: the degree of success is gated on a DC being in the message context — that silences every flat check");
    }
    if (!/degreeOf\(/.test(check[0])) {
      fail("read-message.js: readCheck must resolve its degree through degreeOf, which reads PF2e's own outcome first");
    }
  }
  const degree = reader.match(/export function degreeOf\([\s\S]*?\n\}/);
  if (!degree) fail("read-message.js: could not find degreeOf");
  else if (!/context\?\.outcome/.test(degree[0]) || !/degreeOfSuccess/.test(degree[0])) {
    fail("read-message.js: degreeOf must read the outcome PF2e recorded, on the message and on the roll, before anything else");
  }
  // Deriving a degree is for flat checks alone: they have no critical degrees, so
  // the comparison is the whole answer. Every other type's ±10 bands and its
  // natural-20 shift are the system's to apply, and a guess here would put a
  // degree on the stream that the player's own chat card does not carry.
  else if (!/flat-check/.test(degree[0])) {
    fail("read-message.js: degreeOf derives a degree without naming flat-check — no other check type may be guessed at");
  }
}

/* ------------------------------------------------------------ status cards -- */
// Everything below fails silently: a gate nobody reads is a switch that does
// nothing, a switch with no control is a setting reachable only from the console,
// and a status card that announces a creature no player can see looks entirely
// correct on the GM's own screen.
{
  const settings = strip(read("scripts/features/stream-cards/settings.js"));
  const block = settings.match(/DEFAULT_STATUS_UPDATES = Object\.freeze\(\{([\s\S]*?)\n\}\)/);
  if (!block) fail("stream-cards/settings.js: could not find DEFAULT_STATUS_UPDATES");
  else {
    const rows = [...block[1].matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
    const lang = JSON.parse(read("lang/stream-cards.en.json"));
    const consumers = ["scripts/features/stream-cards/pf2e/read-status.js", "scripts/features/stream-cards/pf2e/status-feed.js"]
      .map((f) => strip(read(f)))
      .join("\n");
    const form = read("templates/stream-cards/section.hbs");
    for (const row of rows) {
      if (!new RegExp(`["'\\[.]${row}\\b`).test(consumers)) {
        fail(`stream-cards: status setting "${row}" is registered but nothing reads it — a switch that does nothing`);
      }
      if (!form.includes(`name="statusUpdates.${row}"`)) {
        fail(`templates/stream-cards/section.hbs: no control for status setting "${row}" — a GM could only reach it from the console`);
      }
      const key = `GLUNIVERSE_STREAM.statusCard.settings.${row}`;
      if (!(key in lang)) fail(`lang/stream-cards.en.json: runtime-built i18n key ${key} is not defined`);
    }
    // The panel's form parser builds a nested patch from the dotted name only.
    for (const m of form.matchAll(/name="statusUpdates\.([A-Za-z0-9_]+)"/g)) {
      if (!rows.includes(m[1])) {
        fail(`templates/stream-cards/section.hbs: control for statusUpdates.${m[1]}, which no setting row backs — the panel would save a key the sanitizer drops`);
      }
    }
    // No row may be a way to switch observability off. It is not an audience
    // preference: a card about a creature the GM has hidden is a leak, and the one
    // test that stops it has to be unreachable from the panel.
    for (const forbidden of ["observable", "hidden", "showHidden", "includeHidden", "offScene"]) {
      if (rows.includes(forbidden)) {
        fail(`stream-cards/settings.js: status setting "${forbidden}" would let a GM switch off the observability test — that test is not a preference`);
      }
    }
  }

  const reader = strip(read("scripts/features/stream-cards/pf2e/read-status.js"));
  if (!/actor\.observable/.test(reader)) {
    fail("stream-cards/pf2e/read-status.js: the observability test is gone — a condition is a document change every client is told about, hidden token or not");
  }
  const snapshot = strip(read("scripts/features/stream-cards/pf2e/status-snapshot.js"));
  if (!/hidden/.test(snapshot)) {
    fail("stream-cards/pf2e/status-snapshot.js: observability no longer consults a token's hidden state");
  }

  // `preUpdateItem` fires only on the client that made the change, which is never
  // the stream client. Relying on it leaves every value change reading as an
  // arrival, with an arrow that may point the wrong way.
  const watch = strip(read("scripts/features/stream-cards/pf2e/status-watch.js"));
  if (/preUpdateItem/.test(watch)) {
    fail("stream-cards/pf2e/status-watch.js: preUpdateItem only fires on the acting client, never the stream — remember the previous value in the feed instead");
  }
  if (!/Hooks\.on\("updateItem"/.test(watch)) {
    fail("stream-cards/pf2e/status-watch.js: no updateItem listener — a condition's value could never be seen to move");
  }
  // The overlay is rebuilt every time stream mode is toggled, so listeners owned
  // by a feed instance pile up one set per toggle.
  if (/Hooks\.on\(/.test(strip(read("scripts/features/stream-cards/pf2e/status-feed.js")))) {
    fail("stream-cards/pf2e/status-feed.js: registers a hook — the feed is rebuilt per overlay, so its listeners would accumulate one set per stream-mode toggle");
  }
  const adapter = strip(read("scripts/features/stream-cards/index.mjs"));
  if (!/registerStatusHooks\(\)/.test(adapter)) {
    fail("stream-cards/index.mjs: registerStatusHooks is never called — status cards would have nothing to listen to");
  }

  // A card focus is struck for the roll card's 8.2:4.4 art box. Handed straight to
  // a square thumbnail it shows a face pushed left and a lot of shoulder, which
  // reads as the framing not working rather than as the wrong box.
  const card = strip(read("scripts/features/stream-cards/cards/status-card.js"));
  if (!/placement\(squareFocus\(/.test(card)) {
    fail("stream-cards/cards/status-card.js: the thumbnail must place squareFocus(focus), not the card's own focus — that focus is shaped for a 8.2:4.4 box");
  }
}

/* ------------------------------------------ the overlay's managed-card seam -- */
// A record the feed pushes onto the stack may carry a card that animates itself
// off it and reports back so the feed can drop the message ids, timers and
// framing watches behind it. Spelled differently on the two sides the card still
// disappears on cue, and everything it was holding leaks for the session.
{
  const overlay = strip(read("scripts/features/stream/chat-overlay.js"));
  if (!/record\.card\b/.test(overlay) || !/record\.card\.exit\(\)/.test(overlay) || !/record\.card\.destroy\(\)/.test(overlay)) {
    fail("stream/chat-overlay.js: the managed-card property is not `record.card` — the feeds push that name");
  }
  if (/record\.rollCard/.test(overlay)) {
    fail("stream/chat-overlay.js: still reaches for `record.rollCard` — status cards travel the same path and would never be torn down");
  }
  const feed = strip(read("scripts/features/stream-cards/pf2e/roll-card-feed.js"));
  if (!/\bcard,/.test(feed) || /rollCard:/.test(feed)) {
    fail("stream-cards/pf2e/roll-card-feed.js: the record's card must be pushed as `card`, the name the overlay reads");
  }
  if (!/statusKey !== undefined/.test(feed)) {
    fail("stream-cards/pf2e/roll-card-feed.js: forget() no longer routes status records to the status feed — it would walk a roll card's message ids on a record that has none");
  }
}

/* ------------------------------------------- the status card stays secondary */
// A condition is a consequence. At the roll card's weight it reads as a second
// roll, and the two cards then compete for the same glance. The damage row is the
// size that says "this belongs to what you just saw".
{
  const css = read("styles/stream-cards.css");
  const heightOf = (selector) => {
    const rule = css.match(new RegExp(`\\${selector} \\{([\\s\\S]*?)\\n\\}`));
    const height = rule?.[1].match(/height: calc\(([0-9.]+) \* var\(--u\)\)/);
    return height ? Number(height[1]) : null;
  };
  const main = heightOf(".glus-rc-main");
  const damage = heightOf(".glus-rc-damage");
  const status = heightOf(".glus-sc-strip");
  if (main === null || damage === null || status === null) {
    fail("styles/stream-cards.css: could not read the strip heights (.glus-rc-main, .glus-rc-damage, .glus-sc-strip)");
  } else {
    if (status >= main) fail(`styles/stream-cards.css: the status strip (${status}u) is not smaller than the roll card's (${main}u) — a consequence at the same weight as its cause reads as a second roll`);
    if (status > damage * 1.25) fail(`styles/stream-cards.css: the status strip (${status}u) has grown well past the damage row it is sized against (${damage}u)`);
  }
}

/* ------------------------------------------------------------------ report -- */
if (problems.length) {
  console.error(`stream-check: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n`);
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log(`stream-check: OK (${sources.length} sources, ${FEATURES.length} features)`);
