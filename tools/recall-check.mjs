#!/usr/bin/env node
/**
 * Recall Knowledge consistency check.
 *
 * Everything covered here fails SILENTLY in a real session:
 *
 *  - a grammar that drifts between prompt.mjs and parse.mjs surfaces to the GM
 *    as "the model got it wrong", not as an error;
 *  - a band with no reveal rule falls through to DEFAULT_REVEAL and quietly
 *    shows the wrong depth;
 *  - a missing i18n key renders as the raw key, and the two DYNAMIC key
 *    families here (`GLRK.mode.*`, `GLRK.parse.warn.emptyTier.*`) are built at
 *    runtime, so nothing but this tool will catch a gap;
 *  - and the big one: if this feature's `privateNotes` mirror heading ever
 *    equals statsblock-import's, that module's exporter scrapes our tiered
 *    prose and round-trips it back out as DC-keyed entries. Silent corruption
 *    of a documented format.
 *
 * Usage: node tools/recall-check.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEATURE = join(ROOT, "scripts/features/pf2e-recall");

const problems = [];
const notes = [];
const fail = (msg) => problems.push(msg);
const note = (msg) => notes.push(msg);

/* ------------------------------------------------------------ imports --- */

const { BAND_KEYS, BAND_REVEAL, DEFAULT_REVEAL, GRAMMAR_VERSION, PARAGRAPH_WORDS } = await import(
  join(FEATURE, "constants.mjs")
);
const { HEADINGS, VERSION_MARK, buildPayload } = await import(join(FEATURE, "prompt.mjs"));
const { parseLadder, formatLadder } = await import(join(FEATURE, "parse.mjs"));
const { flattenEnrichers, capText } = await import(join(FEATURE, "extract.mjs"));
const { pickMistakenIdentity } = await import(join(FEATURE, "mistaken.mjs"));

const lang = JSON.parse(readFileSync(join(ROOT, "lang/pf2e-recall.en.json"), "utf8"));
const statsblockLang = JSON.parse(
  readFileSync(join(ROOT, "lang/statsblock-import.en.json"), "utf8")
);

/* ------------------------------------------- 1. the heading collision --- */

const ours = lang["GLRK.notes.ladder"];
const theirs = statsblockLang["GLSBI.notes.recallKnowledge"];
if (!ours) fail("GLRK.notes.ladder is missing — the privateNotes mirror has no heading.");
if (!theirs) note("GLSBI.notes.recallKnowledge not found; collision check skipped.");
if (ours && theirs && ours.trim().toLowerCase() === theirs.trim().toLowerCase()) {
  fail(
    `Mirror heading collides with statsblock-import ("${ours}"). Its exporter will ` +
      `scrape this feature's tiered ladder and round-trip it as DC-keyed entries.`
  );
}

/* ------------------------------------------------- 2. band coverage ----- */

const flatfinderSrc = readFileSync(
  join(ROOT, "scripts/features/flatfinder/constants.js"),
  "utf8"
);
const bandKeys = [...flatfinderSrc.matchAll(/\{\s*key:\s*"([a-z]+)"\s*,\s*min:/g)].map((m) => m[1]);
if (bandKeys.length !== 8) {
  fail(`Expected 8 competence bands in flatfinder/constants.js, found ${bandKeys.length}.`);
}
for (const key of bandKeys) {
  if (!BAND_REVEAL[key]) fail(`Band "${key}" has no BAND_REVEAL entry; it would fall through to the default.`);
}
for (const key of Object.keys(BAND_REVEAL)) {
  if (!bandKeys.includes(key)) fail(`BAND_REVEAL has "${key}", which is not a Flatfinder band.`);
}
// BAND_KEYS is duplicated from Flatfinder so this module carries no cross-feature
// import. Duplication is only safe while the two agree, including in ORDER — the
// payload lists the bands shallowest-first and the model reads that ordering as
// the shape of the ladder.
if (BAND_KEYS.join() !== bandKeys.join()) {
  fail(`BAND_KEYS ${BAND_KEYS.join(",")} disagrees with Flatfinder's ${bandKeys.join(",")}.`);
}
for (const [key, rule] of Object.entries(BAND_REVEAL)) {
  if (!rule.mode) fail(`Band "${key}" has no delivery mode.`);
  if ("depth" in rule) fail(`Band "${key}" still carries a depth; v2 derives no content from it.`);
}
if (!DEFAULT_REVEAL.mode) fail("DEFAULT_REVEAL has no mode; a missing Flatfinder would render nothing.");

/* ------------------------------------------------- 3. grammar round trip */

const sample = {
  name: "Barrow Troll",
  bands: {
    disastrous: "You have absolutely no idea. You are fairly sure it is not a kind of bird.",
    inept: "You are certain these things turn to stone in daylight, which is why nobody sees them at noon.",
    poor: "You have heard the barrow country blamed for emptied graves, though you could not swear to what does the emptying.",
    passable: "That is a barrow troll. The Hillfolk blame them for every opened grave in the uplands, and the blame is mostly earned.",
    solid: "A barrow troll. Fire is the thing: burn it and the wounds stay shut, otherwise it simply knits itself together and comes on again.",
    impressive: "A barrow troll, and the fight turns on fire. Cut it and it closes; burn it and it does not. It is strong but slow to see a trick coming, so misdirection lands where force will not.",
    remarkable: "A barrow troll, and it was a person once. This one was a Hillfolk grave-warden who would not leave his post, and the barrow it guards is its own.",
    phenomenal: "A barrow troll, and it was a grave-warden who would not leave his post. The barrow is his own, and the name cut above the door is one your patron has been looking for.",
  },
};

const round = parseLadder(formatLadder(sample, sample.name));
if (!round.ok) fail(`Round trip failed: ${round.errors.join(", ")}`);
if (round.name !== sample.name) fail(`Round trip lost the title (${round.name}).`);
if (round.version !== GRAMMAR_VERSION) fail(`Round trip version ${round.version} != ${GRAMMAR_VERSION}.`);
for (const key of BAND_KEYS) {
  if (round.bands[key] !== sample.bands[key]) fail(`Round trip altered band "${key}".`);
}
if (round.warnings.length) fail(`Round trip warned: ${round.warnings.join(", ")}`);

/* Every band must resolve to its OWN paragraph. Two bands reading the same is
   the exact failure this rewrite exists to remove, and it is invisible unless
   asserted: the panel renders a duplicate perfectly happily. */
{
  const seen = new Map();
  for (const key of BAND_KEYS) {
    const text = sample.bands[key];
    if (seen.has(text)) fail(`Bands "${seen.get(text)}" and "${key}" are identical.`);
    seen.set(text, key);
  }
}

/* The word budget is the whole point of v2: it is what a GM can say aloud
   without skimming. A sample that breaks its own rule is a bad example to
   assert against. */
{
  const [minWords, maxWords] = PARAGRAPH_WORDS;
  for (const key of BAND_KEYS) {
    const words = sample.bands[key].split(/\s+/).filter(Boolean).length;
    if (words > maxWords * 1.5) fail(`Sample band "${key}" is ${words} words, far past the ${maxWords}-word budget.`);
  }
  if (minWords >= maxWords) fail("PARAGRAPH_WORDS is not a range.");
}

/* Trailing chatter must not reach the last paragraph.
   Models routinely close the fence and then add "Let me know if you'd like
   these pitched differently!". v1 was immune for free — it only ever collected
   bullet lines — but v2 collects prose, so an unguarded parser appends the
   sign-off to the Phenomenal band and the GM reads it out at the table. */
{
  const body = [
    "# Recall Knowledge: Barrow Troll",
    "<!-- glrk:2 -->",
    ...BAND_KEYS.flatMap((key) => ["", `## ${HEADINGS[key]}`, `The ${key} answer.`]),
  ].join("\n");
  for (const [shape, source] of [
    ["fenced with a sign-off", `\`\`\`markdown\n${body}\n\`\`\`\n\nLet me know if you'd like these pitched differently!`],
    ["fenced with a preamble", `Here you go!\n\n\`\`\`markdown\n${body}\n\`\`\``],
    ["no fence at all", body],
  ]) {
    const parsed = parseLadder(source);
    if (!parsed.ok) fail(`A reply ${shape} failed to parse.`);
    const last = parsed.bands[BAND_KEYS[BAND_KEYS.length - 1]] ?? "";
    if (last !== "The phenomenal answer.") {
      fail(`A reply ${shape} leaked into the last band: "${last}".`);
    }
  }
}

/* A v1 ladder must still parse. A GM with an old chat window open should not
   be stranded, and silently refusing their paste would look like a bug. */
{
  const legacy = [
    "# Recall Knowledge: Barrow Troll",
    "<!-- glrk:1 -->",
    "",
    "## Everyone knows",
    "- Blamed for every emptied grave.",
    "- Enormous and hunched.",
    "",
    "## One might know",
    "- Fire stops it knitting itself back together.",
    "",
    "## Very few know",
    "- It was a Hillfolk grave-warden.",
    "",
    "## Misremembered",
    "- They turn to stone in daylight.",
  ].join("\n");
  const converted = parseLadder(legacy);
  if (!converted.ok) fail("A v1 ladder no longer parses; existing chat logs would be refused.");
  if (!converted.bands.inept) fail("v1 conversion dropped the misremembered line.");
  if (!converted.bands.passable) fail("v1 conversion dropped the shallow tier.");
  if (!converted.warnings.includes("GLRK.parse.warn.convertedFromV1")) {
    fail("v1 conversion happened silently; the GM should be told to regenerate.");
  }
}

/* --------------------------- 4. the payload teaches the grammar it reads */

const brief = {
  kind: "creature", name: "Barrow Troll", subtitle: "Troll · Level 5", rarity: "uncommon",
  traits: ["giant"], fields: { AC: 21 }, prose: { text: "", truncated: false },
  sections: [
    { title: "Attacks", entries: [{ name: "Jaws", meta: "melee · attack +18", text: "Bites." }] },
    { title: "Spellcasting", entries: [{ name: "Innate", meta: "primal · DC 24", text: "Rank 3: Fireball" }] },
  ],
};
const payload = buildPayload(brief, {});

/* The statblock is what the middle bands ("how it fights and how it dies") are
   written from. A section silently dropped by the renderer costs the model the
   only data that makes those bands answerable, and nothing else would catch it. */
for (const section of brief.sections) {
  if (!payload.includes(`### ${section.title}`)) {
    fail(`Payload dropped the "${section.title}" section.`);
  }
  for (const entry of section.entries) {
    if (!payload.includes(entry.name)) fail(`Payload dropped entry "${entry.name}".`);
    if (entry.meta && !payload.includes(entry.meta)) {
      fail(`Payload dropped the meta line for "${entry.name}" (cost/bonus/damage).`);
    }
    if (entry.text && !payload.includes(entry.text)) {
      fail(`Payload dropped the description for "${entry.name}".`);
    }
  }
}
if (!payload.includes(VERSION_MARK)) fail("Payload omits the version marker the parser looks for.");
for (const [key, heading] of Object.entries(HEADINGS)) {
  if (!payload.includes(`## ${heading}`)) fail(`Payload never shows the "${key}" heading (${heading}).`);
}
// The payload must stand alone: a GM pasting into claude.ai has no skill installed.
for (const needle of ["Output format", "types, never numbers", "Never invert"]) {
  if (!payload.includes(needle)) fail(`Payload lost a load-bearing instruction: "${needle}".`);
}
// And the grammar it prints must actually parse.
const fenced = payload.match(/```markdown\n([\s\S]*?)\n```/);
if (!fenced) fail("Payload no longer contains a fenced markdown template.");
else {
  const skeleton = parseLadder(fenced[1]);
  if (!skeleton.ok) fail(`The template the payload prints does not parse: ${skeleton.errors.join(", ")}`);
}

/* ------------------------------------------------- 5. enrichers --------- */

for (const [input, want] of [
  ["@Damage[2d6[fire]]", "2d6 fire"],
  ["@Check[reflex|dc:24]", "Reflex DC 24"],
  ["@Template[burst|distance:20]", "20-foot burst"],
  ["@UUID[Compendium.pf2e.x.Actor.Troll]{Troll}", "Troll"],
]) {
  const got = flattenEnrichers(input).trim();
  if (got !== want) fail(`Enricher "${input}" -> "${got}", expected "${want}".`);
}
if (/@[A-Za-z]+\[/.test(flattenEnrichers("@Damage[1d6[acid]] and @Check[will|dc:10]"))) {
  fail("Enricher syntax survived flattening; raw markup would reach the payload.");
}
if (!capText("x".repeat(50), 10).truncated) fail("capText failed to report truncation.");

/* ------------------------------------------------- 6. mistaken identity - */

const mk = (name, level, traits, size, rarity = "common") => ({
  uuid: `Actor.${name}`, name,
  system: { details: { level: { value: level } }, traits: { rarity, size: { value: size }, value: traits } },
});
const troll = mk("Troll", 5, ["giant", "troll"], "lg");
if (pickMistakenIdentity(troll, [mk("Beast", 5, ["beast"], "lg")]) !== null)
  fail("A candidate sharing no traits was accepted.");
if (pickMistakenIdentity(troll, [mk("Named", 5, ["giant", "troll"], "lg", "unique")]) !== null)
  fail("A unique creature was offered as a misidentification.");
if (pickMistakenIdentity(troll, [mk("Tiny", 5, ["giant"], "tiny")]) !== null)
  fail("The size gate let through a candidate two steps away.");
if (pickMistakenIdentity(troll, []) !== null) fail("An empty pool did not yield null.");
{
  const pool = [mk("FarKin", 14, ["giant", "troll"], "lg"), mk("NearOgre", 5, ["giant"], "lg")];
  if (pickMistakenIdentity(troll, pool)?.name !== "FarKin")
    fail("Level distance outranked shared traits; kind must dominate.");
  const a = pickMistakenIdentity(troll, pool)?.uuid;
  const b = pickMistakenIdentity(troll, [...pool].reverse())?.uuid;
  if (a !== b) fail("The pick depends on candidate order; it must be stable across clients.");
}

/* ------------------------------------------------- 7. i18n -------------- */

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.(mjs|js|hbs)$/.test(entry.name)) out.push(path);
  }
  return out;
}

const sources = [...walk(FEATURE), join(ROOT, "templates/pf2e-recall/app.hbs")];
const referenced = new Set();
for (const file of sources) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/["'`](GLRK\.[A-Za-z0-9_.]+)["'`]/g)) referenced.add(m[1]);
  for (const m of text.matchAll(/\{\{localize\s+"(GLRK\.[A-Za-z0-9_.]+)"/g)) referenced.add(m[1]);
}

// Dynamic families: built at runtime, so they are enumerated rather than scanned.
for (const rule of Object.values(BAND_REVEAL)) referenced.add(`GLRK.mode.${rule.mode}`);
referenced.add(`GLRK.mode.${DEFAULT_REVEAL.mode}`);
for (const key of BAND_KEYS) referenced.add(`GLRK.parse.warn.emptyBand.${key}`);

for (const key of [...referenced].sort()) {
  if (!(key in lang)) fail(`i18n key referenced but not defined: ${key}`);
}
const unused = Object.keys(lang).filter((k) => !referenced.has(k));
if (unused.length) note(`${unused.length} lang key(s) defined but not referenced: ${unused.join(", ")}`);

/* ------------------------------------------------- report --------------- */

for (const n of notes) console.log(`note   ${n}`);
for (const p of problems) console.log(`PROBLEM ${p}`);
console.log(
  problems.length
    ? `\nrecall-check: ${problems.length} problem(s)`
    : `\nrecall-check: OK (${bandKeys.length} bands, grammar v${GRAMMAR_VERSION}, ${referenced.size} i18n keys)`
);
process.exit(problems.length ? 1 : 0);
