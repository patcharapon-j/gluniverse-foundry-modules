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

/* ------------------------------------------------------------------ report -- */
if (problems.length) {
  console.error(`stream-check: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n`);
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log(`stream-check: OK (${sources.length} sources, ${FEATURES.length} features)`);
