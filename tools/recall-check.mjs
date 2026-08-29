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

const {
  BAND_KEYS,
  BAND_REVEAL,
  BAND_WORDS,
  CARRY_FROM,
  DEFAULT_PRESENTATION,
  DEFAULT_REVEAL,
  GRAMMAR_VERSION,
  OVERLONG_FACTOR,
  PRESENTATIONS,
  presentationByKey,
} = await import(
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
    disastrous:
      "Nothing surfaces. You are reasonably confident it is some kind of very large heron — the legs, mostly — and that herons are protected in this county, so somebody is about to be fined.",
    inept:
      "You know this one. Daylight turns them to stone: the standing stones scattered across the uplands are all trolls who misjudged the hour, and every child up there can point out which is which. Nobody has ever seen one abroad at noon.",
    poor:
      "There is something in the barrow country that opens graves. You have heard it called a troll, though that word gets used for anything large and unpleasant, and the accounts do not agree — a giant, a wight, a bear that walks upright. What they agree on is the digging.",
    passable:
      "That is a barrow troll. The Hillfolk blame them for every opened grave in the uplands and the blame is mostly earned: they dig, they take what the dead were buried with, and they are strong enough that nobody argues about it. Big, grey, and unhurried.",
    solid:
      "That is a barrow troll — the thing the Hillfolk blame for their opened graves, and rightly. It digs, it takes, and it is strong enough that nobody argues. The one thing worth knowing is fire: cut it and the wound closes over while you watch, but burn it and the wound stays. Steel alone is a long night's work.",
    impressive:
      "That is a barrow troll, blamed across the uplands for its opened graves, and the fight turns on one thing. Cut it and the wound closes while you watch; burn it and the wound stays shut. It is enormously strong and hits like a falling tree, but it is slow to see a trick coming, so a feint lands where force will not. Nothing draws it more than a few dozen paces from the mound. It always turns back.",
    remarkable:
      "That is a barrow troll, the thing the Hillfolk blame for their opened graves. Cut it and the wound closes over; only fire keeps one shut. It is terribly strong, slow to see a trick coming, and it never strays more than a few dozen paces from the mound it circles. What the stories leave out is that it was a person. Grave-wardens were sworn to their barrows for life up here, and one of them kept the oath past dying. The grey thing on the mound is the warden, still at his post, and the grave he guards is his own.",
    phenomenal:
      "That is a barrow troll, and everything the uplands say about it is true: it opens graves, it takes what was buried, and steel does nothing lasting — a cut closes while you watch, and only fire keeps a wound shut. It is strong, slow to see a trick coming, and it never strays more than a few dozen paces from the mound. It was a man once. The grave-wardens were sworn to their barrows for life, and this one kept the oath past dying, so the grave he circles is his own. The name cut above that door is Aelric Vane, which is the name your patron has been paying for word of since before he hired you, and he has never once said why.",
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

/* The word budget is what a GM can say aloud without skimming, and since v2.1
   it climbs: the deep bands carry the shallow ones and are legitimately longer.
   Two things must hold, and neither is visible in a running session. */
{
  let previous = null;
  for (const key of BAND_KEYS) {
    const budget = BAND_WORDS[key];
    if (!budget) {
      fail(`Band "${key}" has no BAND_WORDS budget; the payload would print "undefined-undefined words".`);
      continue;
    }
    const [minWords, maxWords] = budget;
    if (!(minWords < maxWords)) fail(`BAND_WORDS.${key} is not a range.`);
    // Monotonic, because the payload presents the budgets as a ladder: a rung
    // allowed FEWER words than the one below it cannot carry the one below it,
    // and the model will resolve that contradiction by dropping the carry —
    // which is the exact v2.0 failure this rewrite exists to remove.
    if (previous && maxWords < previous[1]) {
      fail(`BAND_WORDS.${key} (max ${maxWords}) is tighter than the shallower band above it (max ${previous[1]}).`);
    }
    previous = budget;

    // The sample is the only worked example in this repository, so it has to
    // obey the budget it documents — under-length teaches a fragment just as
    // firmly as over-length teaches a monologue.
    const words = sample.bands[key].split(/\s+/).filter(Boolean).length;
    if (words > maxWords) fail(`Sample band "${key}" is ${words} words, past its ${maxWords}-word budget.`);
    if (words < minWords) fail(`Sample band "${key}" is ${words} words, under its ${minWords}-word floor.`);
  }
  for (const key of Object.keys(BAND_WORDS)) {
    if (!BAND_KEYS.includes(key)) fail(`BAND_WORDS has "${key}", which is not a band.`);
  }
}

/* Cumulative, not just distinct: from Passable up, a band must still tell the
   player what the thing IS. The sample is the only example a reader of this
   file gets, and an example that shows the top bands leading with the secret
   alone teaches the failure back. Checked as "the subject is named", which is
   the cheapest observable proxy for carrying the identification. */
{
  const CUMULATIVE_FROM = BAND_KEYS.indexOf("passable");
  for (const key of BAND_KEYS.slice(CUMULATIVE_FROM)) {
    if (!/barrow troll/i.test(sample.bands[key])) {
      fail(`Sample band "${key}" never identifies the subject; it reads as a fragment of an answer, not a whole one.`);
    }
  }
  const deep = sample.bands[BAND_KEYS[BAND_KEYS.length - 1]];
  if (!/fire/i.test(deep)) {
    fail("The sample's deepest band drops the weakness the middle bands established; it is not cumulative.");
  }
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

/* ------------------------------------ 3b. the presentations table -------- */

/* Each presentation is a table of what CHANGES, and the payload prints every
   field. A row missing one renders as "undefined" in the GM's clipboard, which
   is both unreadable and unfixable from inside Foundry. */
{
  const seenKeys = new Set();
  for (const style of PRESENTATIONS) {
    for (const field of ["key", "label", "speaker", "evidence", "falsehood", "address"]) {
      if (!style[field] || !String(style[field]).trim()) {
        fail(`Presentation "${style.key ?? "?"}" has no ${field}; the payload would print undefined.`);
      }
    }
    if (seenKeys.has(style.key)) fail(`Two presentations share the key "${style.key}".`);
    seenKeys.add(style.key);
  }
  if (!seenKeys.has(DEFAULT_PRESENTATION)) {
    fail(`DEFAULT_PRESENTATION "${DEFAULT_PRESENTATION}" is not in the table.`);
  }
  if (presentationByKey("no-such-presentation").key !== DEFAULT_PRESENTATION) {
    fail("presentationByKey did not fall back to the default; a stale flag would throw at read time.");
  }
  // "types, never numbers" is a load-bearing rule, and exactly one presentation
  // is documented as its exception. A second one arriving unnoticed would quietly
  // turn the feature back into the stat readout it exists to replace.
  const numeric = PRESENTATIONS.filter((style) => style.numbers).map((style) => style.key);
  if (numeric.join() !== "readout") {
    fail(`Presentations permitting numbers should be exactly [readout], found [${numeric.join(",")}].`);
  }
  if (!BAND_KEYS.includes(CARRY_FROM)) fail(`CARRY_FROM "${CARRY_FROM}" is not a band.`);
  if (!(OVERLONG_FACTOR > 1)) fail("OVERLONG_FACTOR must leave a paragraph some slack.");
}

/* ------------------------------------ 3c. the cumulative detector -------- */

/* The detector must fire on the v2.0 failure and stay silent on a good ladder.
   Both halves matter: a detector that never fires is decoration, and one that
   fires on healthy prose gets ignored on the day it is right. */
{
  const ladderFrom = (bands) => {
    const body = BAND_KEYS.flatMap((key) => ["", `## ${HEADINGS[key]}`, bands[key]]);
    return [`# Recall Knowledge: ${sample.name}`, VERSION_MARK, ...body].join("\n");
  };

  const good = parseLadder(ladderFrom(sample.bands));
  if (good.warnings.includes("GLRK.parse.warn.notCumulative")) {
    fail("The cumulative detector fired on the sample, which IS cumulative — it would cry wolf on every good ladder.");
  }

  // Each deep band written as only what that rung adds: the v2.0 shape.
  const fragmented = {
    ...sample.bands,
    impressive: "Fire is the only thing that keeps a wound shut on it, and it is slow to see a trick coming, so misdirection lands where force will not.",
    remarkable: "He was a grave-warden once, sworn to a post he would not abandon even after death took the rest of his village.",
    phenomenal: "Ask your patron about the name cut above that door; he has been paying for word of it since before he hired you.",
  };
  const bad = parseLadder(ladderFrom(fragmented));
  if (!bad.warnings.includes("GLRK.parse.warn.notCumulative")) {
    fail("A ladder whose deep bands drop everything beneath them did not warn; the v2.0 failure would store silently.");
  }
  if (!bad.ok) fail("The cumulative warning must not refuse the paste; it is a heuristic, not a structural error.");
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

/* The presentation is baked into the paragraphs, so every field of the chosen
   one has to actually reach the model. A field silently dropped here produces a
   ladder in the wrong voice with nothing to show it went wrong. */
for (const style of PRESENTATIONS) {
  const styled = buildPayload(brief, {
    presentation: { key: style.key, note: "the ship's medical scanner, terse" },
  });
  for (const field of ["label", "speaker", "evidence", "falsehood", "address"]) {
    if (!styled.includes(style[field])) {
      fail(`Payload for presentation "${style.key}" dropped its ${field}.`);
    }
  }
  if (!styled.includes("the ship's medical scanner, terse")) {
    fail(`Payload for presentation "${style.key}" dropped the GM's own note.`);
  }
  // The numbers exception must be stated where the rule is, not left implied.
  const statesException = /stated exception/.test(styled);
  if (style.numbers !== statesException) {
    fail(`Presentation "${style.key}" and the payload disagree about the numbers exception.`);
  }
}

/* An unknown key must still produce a usable payload: a world whose default
   setting names a presentation this build no longer ships still has to prep. */
if (!buildPayload(brief, { presentation: { key: "gone" } }).includes(
  presentationByKey(DEFAULT_PRESENTATION).speaker
)) {
  fail("An unrecognised presentation key did not fall back to the default in the payload.");
}

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
// "carries" is the v2.1 instruction: without it the model writes each band as
// only what that rung adds, and the top bands come back as a payoff with no
// setup — unusable at a table that reads exactly one paragraph.
for (const needle of [
  "Output format",
  "types, never numbers",
  "Never invert",
  "carries everything the bands below it",
  "words) —",
  // The tone floor: without these two the model narrates the character's
  // feelings and tells the player what to do, which is the GM's job twice over.
  "No interiority",
  "No advice",
  "How this reaches the player",
]) {
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
// Presentation labels are built at runtime from the table (and from the settings
// choices map), so nothing but this enumeration would catch a missing one.
for (const style of PRESENTATIONS) referenced.add(`GLRK.presentation.${style.key}`);

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
