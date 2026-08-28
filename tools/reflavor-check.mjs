#!/usr/bin/env node
/**
 * Reflavor consistency check.
 *
 * Everything covered here fails SILENTLY in a real session:
 *
 *  - the payload TEACHES the importer's grammar, section by section. If a field
 *    label is renamed in importer.js and not here, the model is taught a field
 *    the parser has never heard of. That breaks every reflavour at once, and to
 *    the GM it reads as the model getting worse, not as a bug;
 *  - a section grammar keyed on a heading the exporter never emits is grammar
 *    that can never be shown, so a real section silently ships undocumented;
 *  - benchmark rows are only comparable with a stat block if BOTH are
 *    un-flattened. `Benchmarks.resolve()` subtracts level under PWoL, so one
 *    call to it here would make every comparison wrong by the creature's level
 *    with nothing on screen to say so;
 *  - the output contract is the only thing keeping prose out of the paste, and
 *    the parser reads `Key: value` under any heading. If the fence rule ever
 *    goes missing from the payload, a change summary starts rewriting stat
 *    blocks;
 *  - and rung 4 must never reach a hazard, whose benchmark tables do not exist
 *    in this repository at all.
 *
 * Usage: node tools/reflavor-check.mjs
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEATURE = join(ROOT, "scripts/features/statsblock-import");

const problems = [];
const notes = [];
const fail = (msg) => problems.push(msg);
const note = (msg) => notes.push(msg);

const prompt = await import(join(FEATURE, "reflavor-prompt.js"));
const {
  RUNGS,
  SECTION_GRAMMAR,
  SECTION_HEADINGS,
  HAZARD_MAX_RUNG,
  buildReflavorPayload,
  classifyTier,
  rungsFor,
  sectionsUsed,
} = prompt;

const importerSrc = readFileSync(join(FEATURE, "importer.js"), "utf8");
const promptSrc = readFileSync(join(FEATURE, "reflavor-prompt.js"), "utf8");
const reflavorSrc = readFileSync(join(FEATURE, "reflavor.js"), "utf8");
const lang = JSON.parse(readFileSync(join(ROOT, "lang/statsblock-import.en.json"), "utf8"));

/* ------------------------------- 1. the grammar we teach is the real one -- */

/**
 * Every `Foo:` label in SECTION_GRAMMAR must appear as a literal in
 * importer.js. The exporter writes these labels and the parser reads them, so
 * a rename on either side lands in that file.
 */
const KNOWN_ABSENT = new Set([
  // Written by the parser's own key normalisation rather than by an exporter
  // literal; slugify() folds the space, so no `Cash Out:` literal exists.
  "Cash Out",
]);

let checkedLabels = 0;
for (const [section, lines] of Object.entries(SECTION_GRAMMAR)) {
  for (const line of lines) {
    const m = line.match(/^([A-Z][A-Za-z ]*?):/);
    if (!m) continue;
    const label = m[1];
    checkedLabels++;
    if (KNOWN_ABSENT.has(label)) continue;
    if (!importerSrc.includes(`${label}: `) && !importerSrc.includes(`"${label}"`)) {
      fail(`grammar for "${section}" teaches field \`${label}:\`, which no longer appears in importer.js`);
    }
  }
}

/* ------------------------- 2. every heading we key on is one we can emit -- */

for (const [heading, key] of Object.entries(SECTION_HEADINGS)) {
  const title = heading.replace(/\b\w/g, (c) => c.toUpperCase());
  if (!importerSrc.includes(`"## ${title}"`)) {
    fail(`SECTION_HEADINGS maps "${heading}", but importer.js never emits "## ${title}"`);
  }
  if (!SECTION_GRAMMAR[key]?.length) {
    fail(`SECTION_HEADINGS maps "${heading}" to grammar key "${key}", which has no lines`);
  }
}

// And the reverse: grammar that can never be reached is grammar nobody sees.
const reachable = new Set([...Object.values(SECTION_HEADINGS), "head", "hazardHead"]);
for (const key of Object.keys(SECTION_GRAMMAR)) {
  if (!reachable.has(key)) fail(`SECTION_GRAMMAR has "${key}", which sectionsUsed() can never select`);
}

/* -------------------------------------- 3. benchmarks must be raw rows --- */

if (/Benchmarks\.(resolve|modifier)\b/.test(promptSrc)) {
  fail(
    "reflavor-prompt.js calls Benchmarks.resolve()/modifier(), which subtract level under " +
      "Proficiency-without-Level. Benchmark rows sit beside un-flattened stat block numbers " +
      "and must come from Benchmarks.rawRow()."
  );
}
if (!/Benchmarks\.rawRow\b/.test(promptSrc)) {
  fail("reflavor-prompt.js never calls Benchmarks.rawRow() — the benchmark block has no source");
}
if (!readFileSync(join(ROOT, "scripts/features/clocks-tracker/support/benchmarks.js"), "utf8").includes("static rawRow(")) {
  fail("Benchmarks.rawRow() is gone from benchmarks.js; the benchmark block cannot be built un-flattened");
}

/* ------------------------------------- 4. rung 4 never reaches a hazard -- */

const hazardRungs = rungsFor("hazard");
if (hazardRungs.some((r) => r.order > HAZARD_MAX_RUNG)) {
  fail(`rungsFor("hazard") offers a rung above ${HAZARD_MAX_RUNG}; no hazard benchmark tables exist`);
}
if (rungsFor("npc").length !== RUNGS.length) {
  fail("rungsFor(\"npc\") does not offer every rung");
}

const hazardPayload = buildReflavorPayload({
  markdown: "# Trap\nType: hazard\nLevel: 5\nAC: 22\n\n## Attacks\n\n### Spike\nType: melee\nBonus: +14\n",
  name: "Trap",
  kind: "hazard",
  level: 5,
  rung: "rebuild",
  concept: "a censer trap",
  stats: { ac: 22 },
});
if (!hazardPayload.includes("**None available.**")) {
  fail("a hazard at rung 3 did not get the no-benchmarks notice — it may have been given creature rows");
}
if (/### Level \d+ \(current\)/.test(hazardPayload)) {
  fail("a hazard payload contains creature benchmark rows");
}

/* -------------------------------------------- 5. the output contract ----- */

const npcMarkdown = [
  "# Barrow Troll",
  "Level: 8",
  "Rarity: common",
  "Size: lg",
  "Traits: giant, troll",
  "Perception: +16",
  "AC: 26",
  "Fortitude: +18",
  "Reflex: +12",
  "Will: +14",
  "HP: 180",
  "Speed: 30 feet",
  "Description: A troll.",
  "",
  "## Attacks",
  "",
  "### Jaws",
  "Type: melee",
  "Bonus: +18",
  "Damage: 2d10+9 piercing",
  "Traits: reach-10",
  "Description: Bites.",
  "",
  "## Actions",
  "",
  "### Frenzy",
  "Type: action",
  "Actions: 2",
  "Category: offensive",
  "Traits: rage",
  "Description: Rages.",
  "",
  "## Spellcasting",
  "",
  "### Primal Innate",
  "Tradition: primal",
  "Type: innate",
  "Ability: cha",
  "DC: 24",
  "Attack: +16",
  "Description:",
  "- 3: Fireball",
].join("\n");

const stats = { ac: 26, fortitude: 18, reflex: 12, will: 14, perception: 16, strikeBonus: 18, hasStrikes: true, spellDC: 24 };

for (const rung of RUNGS) {
  const payload = buildReflavorPayload({
    markdown: npcMarkdown,
    name: "Barrow Troll",
    kind: "npc",
    level: 8,
    rung: rung.key,
    concept: "a bog-cult flagellant",
    targetLevel: 12,
    stats,
  });

  if (!payload.includes("```markdown")) fail(`rung "${rung.key}": payload does not fence the stat block`);
  if (!/one\*{0,2} fenced code block/i.test(payload)) {
    fail(`rung "${rung.key}": payload has lost the single-fence instruction`);
  }
  if (!/outside\*{0,2} the fence/i.test(payload)) {
    fail(`rung "${rung.key}": payload no longer tells the model to keep prose outside the fence`);
  }
  if (!payload.includes("Reproduce every line you are not changing")) {
    fail(`rung "${rung.key}": payload has lost the do-not-drop-lines rule; omission deletes on import`);
  }
  if (!payload.includes("a bog-cult flagellant")) fail(`rung "${rung.key}": the GM's concept is missing`);
  if (!payload.includes(npcMarkdown.trimEnd())) fail(`rung "${rung.key}": the stat block is not reproduced verbatim`);

  // The grammar shown must be exactly the sections this stat block uses.
  const used = sectionsUsed(npcMarkdown, { kind: "npc" });
  if (!used.includes("spellcasting")) fail("sectionsUsed() missed ## Spellcasting");
  if (used.includes("engine")) fail("sectionsUsed() invented ## Engine on a stat block without one");
  if (payload.includes("Resource: <name>")) {
    fail(`rung "${rung.key}": engine grammar shipped for a creature with no ## Engine section`);
  }
  if (!payload.includes("Tradition: arcane | divine | occult | primal")) {
    fail(`rung "${rung.key}": spellcasting grammar missing though the stat block has that section`);
  }

  const wantsBenchmarks = rung.order >= 3;
  const hasBenchmarks = payload.includes("## Benchmarks");
  if (wantsBenchmarks !== hasBenchmarks) {
    fail(`rung "${rung.key}": benchmark block ${hasBenchmarks ? "present" : "absent"}, expected the opposite`);
  }
  if (hasBenchmarks && !payload.includes("un-flattened")) {
    fail(`rung "${rung.key}": benchmark block does not state that its rows are un-flattened`);
  }
  if (rung.order >= 4 && !payload.includes("### Level 12 (target)")) {
    fail(`rung "${rung.key}": no target-level rows, so the intended delta is invisible`);
  }
  if (rung.order === 3 && payload.includes("(target)")) {
    fail(`rung "${rung.key}": target-level rows shipped for a rung that cannot change level`);
  }
  if (hasBenchmarks && !payload.includes("HP has no row here")) {
    fail(`rung "${rung.key}": the HP gap is not admitted, so silence reads as permission`);
  }
}

/* ---------------------------------------- 6. the rungs stay a real ladder */

const orders = RUNGS.map((r) => r.order);
if (orders.join() !== [...orders].sort((a, b) => a - b).join()) fail("RUNGS are not in ascending order");
if (new Set(orders).size !== orders.length) fail("two rungs share an order");
for (const rung of RUNGS) {
  if (!rung.permits?.length) fail(`rung "${rung.key}" permits nothing`);
  if (!rung.freezes?.length) fail(`rung "${rung.key}" freezes nothing — every rung has a floor`);
  if (!rung.summary) fail(`rung "${rung.key}" has no summary`);
}
// Rung 1 must not permit anything numeric, or "Reskin" stops meaning anything.
const reskin = RUNGS[0];
if (!reskin.freezes.some((f) => /every number/i.test(f))) {
  fail('the first rung no longer freezes "every number"; Reskin has lost its guarantee');
}

/* ------------------------------------------- 7. tier classification ------ */

const row = { extreme: 30, high: 27, moderate: 26, low: 24 };
const cases = [
  [27, "high", true],
  [28, "between high and extreme", false],
  [31, "above extreme", false],
  [23, "below low", false],
];
for (const [value, expected, exact] of cases) {
  const got = classifyTier(value, row);
  if (!got) { fail(`classifyTier(${value}) returned nothing`); continue; }
  if (got.label !== expected) fail(`classifyTier(${value}) said "${got.label}", expected "${expected}"`);
  if (got.exact !== exact) fail(`classifyTier(${value}).exact was ${got.exact}, expected ${exact}`);
}
if (classifyTier(null, row) !== null) fail("classifyTier(null) should return null, not a tier");

/* ------------------------------------------------------- 8. i18n keys ---- */

const referenced = new Set();
for (const src of [reflavorSrc]) {
  for (const m of src.matchAll(/"(GLSBI\.reflavor\.[A-Za-z0-9_.]+)"/g)) referenced.add(m[1]);
  for (const m of src.matchAll(/`GLSBI\.reflavor\.rung\.\$\{[^}]+\}`/g)) void m;
}
// Dynamic family: the rung labels are built as `GLSBI.reflavor.rung.${key}`.
for (const rung of RUNGS) referenced.add(`GLSBI.reflavor.rung.${rung.key}`);
// Referenced from importer.js rather than the dialog.
referenced.add("GLSBI.reflavor.notify.forcedReplaceAll");

for (const key of [...referenced].sort()) {
  if (!(key in lang)) fail(`i18n key referenced but not defined: ${key}`);
}
const defined = Object.keys(lang).filter((k) => k.startsWith("GLSBI.reflavor."));
const unused = defined.filter((k) => !referenced.has(k));
if (unused.length) note(`${unused.length} reflavor lang key(s) defined but not referenced: ${unused.join(", ")}`);

/* ------------------------------- 9. the fence strip is still in the parser */

if (!importerSrc.includes("function stripCodeFence(")) {
  fail("stripCodeFence() is gone from importer.js — a copied fence lands in the last ability's description");
}
if (!/const original = stripCodeFence\(/.test(importerSrc)) {
  fail("parseStrictMarkdown no longer routes its source through stripCodeFence()");
}

/* ---------------------------- 10. the compendium resolver stays in place -- */

if (!importerSrc.includes("export function resolveDirectoryDocument(")) {
  fail("resolveDirectoryDocument() is gone; compendium rows resolve against game.actors and fail");
}
// Narrow to ROW resolution. The two remaining `game.actors.get(actorId)` calls
// read the importer's own target selector, which is built from world actors
// only and is correct as it stands.
if (/li\?\.dataset[\s\S]{0,160}?game\.actors\.get/.test(importerSrc)) {
  fail("importer.js still resolves a context-menu ROW directly from game.actors — that misfires on compendium rows");
}
if (!importerSrc.includes("resolveDirectoryDocument(app, li)")) {
  fail("importer.js registers a context entry that does not resolve through resolveDirectoryDocument()");
}
if (!reflavorSrc.includes("resolveDirectoryDocument(app, li)")) {
  fail("the reflavor context entry no longer resolves through resolveDirectoryDocument()");
}

/* --------------------------------------------------------- report -------- */

for (const n of notes) console.log(`note   ${n}`);
for (const p of problems) console.log(`PROBLEM ${p}`);
console.log(
  problems.length
    ? `\nreflavor-check: ${problems.length} problem(s)`
    : `\nreflavor-check: OK (${RUNGS.length} rungs, ${Object.keys(SECTION_GRAMMAR).length} sections, ${checkedLabels} grammar fields, ${referenced.size} i18n keys)`
);
process.exit(problems.length ? 1 : 0);
