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
  SUBJECT_TYPES,
  TELL_WINDOW,
  presentationByKey,
  presentationForText,
} = await import(
  join(FEATURE, "constants.mjs")
);
const { HEADINGS, VERSION_MARK, buildPayload } = await import(join(FEATURE, "prompt.mjs"));
const { parseLadder, formatLadder } = await import(join(FEATURE, "parse.mjs"));
const { flattenEnrichers, capText, subjectBrief } = await import(join(FEATURE, "extract.mjs"));
const { pickMistakenIdentity } = await import(join(FEATURE, "mistaken.mjs"));
const { inlineMarkdownToHtml, stripInlineMarkdown } = await import(join(FEATURE, "markdown.mjs"));
const { buildInsightMessage, playerFacingText } = await import(join(FEATURE, "share.mjs"));

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
      "That is a barrow troll, the thing the Hillfolk blame for their opened graves. Cut it and the wound closes over; only fire keeps one shut. It is terribly strong, slow to see a trick coming, and it never strays far from the mound it circles. What the stories leave out is that it was a person: grave-wardens were sworn to their barrows for life up here, and one kept the oath past dying. The grey thing on the mound is the warden, and the grave is his own.",
    phenomenal:
      "That is a barrow troll, and the uplands have it right — it opens graves, it takes what was buried, and steel does nothing lasting, since a cut closes while you watch and only fire keeps a wound shut. It is strong, slow to see a trick coming, and never strays far from the mound. It was a man once, a grave-warden who kept his oath past dying, so the grave he circles is his own. The name cut above that door is Aelric Vane, which your patron has been paying for word of since before he hired you.",
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
    if (!BAND_WORDS[key] || !BAND_KEYS.includes(key)) {
      fail(`BAND_WORDS has "${key}", which is not a band.`);
    }
  }
}

/* --------------------------------- 3a. length must not name the rung ---- */

/* The budgets are also an ANTI-TELL, and that half is invisible in a session:
   a ladder whose deep bands run four times the length of its shallow ones
   renders perfectly and plays perfectly, and the table still learns within a
   session that a long answer means a good roll. From then on the player knows
   how they did before a single fact lands, which flattens the two rungs that
   depend on not knowing — the hedged answer and the confidently wrong one.

   Three properties, none of which any other check would notice: adjacent bands
   must share legal lengths, the true bands must share a window at least
   TELL_WINDOW words wide, and the whole ladder must stay inside a bounded
   spread. */
{
  for (let i = 1; i < BAND_KEYS.length; i++) {
    const [lowMin, lowMax] = BAND_WORDS[BAND_KEYS[i - 1]] ?? [];
    const [highMin, highMax] = BAND_WORDS[BAND_KEYS[i]] ?? [];
    if (![lowMin, lowMax, highMin, highMax].every(Number.isFinite)) continue;
    if (highMin > lowMax) {
      fail(
        `BAND_WORDS.${BAND_KEYS[i]} (${highMin}-${highMax}) cannot overlap ` +
          `${BAND_KEYS[i - 1]} (${lowMin}-${lowMax}); the length alone would name the rung.`
      );
    }
  }

  // The true bands — Poor up. The two false ones carry nothing, so holding
  // their floors to Phenomenal's would mean padding a joke.
  const trueBands = BAND_KEYS.slice(BAND_KEYS.indexOf("poor"));
  const floor = Math.max(...trueBands.map((k) => BAND_WORDS[k][0]));
  const ceiling = Math.min(...trueBands.map((k) => BAND_WORDS[k][1]));
  if (ceiling - floor < TELL_WINDOW) {
    fail(
      `The true bands share only ${Math.max(0, ceiling - floor)} words of legal length ` +
        `(${floor}-${ceiling}); TELL_WINDOW asks for ${TELL_WINDOW}. A paragraph's length ` +
        `should not say which rung wrote it.`
    );
  }
  if (!(TELL_WINDOW > 0)) fail("TELL_WINDOW must be a real window.");

  // A bounded spread, stated as a ratio so it survives a rewrite of the
  // budgets: the deepest band may be longer than the shallowest true one, but
  // not so much longer that the difference is audible across the table.
  const deepest = BAND_WORDS[BAND_KEYS[BAND_KEYS.length - 1]][1];
  const shallowestTrue = BAND_WORDS.poor[1];
  if (deepest > shallowestTrue * 1.75) {
    fail(
      `Phenomenal's ceiling (${deepest}) is more than 1.75x Poor's (${shallowestTrue}). ` +
        `That gap is audible: the table hears the roll before it hears the answer.`
    );
  }

  // And the same numbers must reach a GM who prompts through the skill rather
  // than the panel. skills/pf2e-recall/SKILL.md restates the budget in prose
  // and in its own copy of the output template; a build that retunes
  // BAND_WORDS and leaves either behind teaches the model the old ladder, and
  // the only symptom is prose that runs long at the top — which reads as the
  // model ignoring instructions.
  const skill = readFileSync(join(ROOT, "skills/pf2e-recall/SKILL.md"), "utf8");
  for (const key of BAND_KEYS) {
    const [min, max] = BAND_WORDS[key];
    if (!skill.includes(`${min}-${max} words`) && !skill.includes(`${min}–${max}`)) {
      fail(`skills/pf2e-recall/SKILL.md never states ${key}'s ${min}-${max} word budget.`);
    }
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
    for (const field of ["key", "label", "text", "speaker", "evidence", "falsehood", "address"]) {
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
  // The box is matched back to a preset by its SENTENCE, so two presets sharing
  // one sentence would make that lookup arbitrary, and a preset whose sentence
  // does not round-trip could never be recognised as itself again.
  for (const style of PRESENTATIONS) {
    if (presentationForText(style.text)?.key !== style.key) {
      fail(`Preset "${style.key}" is not recognised from its own sentence.`);
    }
    if (presentationForText(` ${style.text.toUpperCase()} `)?.key !== style.key) {
      fail(`Preset "${style.key}" stops being itself over whitespace or capitals.`);
    }
  }
  if (presentationForText("something a GM typed") !== null) {
    fail("Arbitrary text matched a preset; the GM's own words would be overwritten by scaffolding.");
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

/* One field, and the GM's words outrank the preset behind them.
   Three cases, and the precedence between them is the whole feature: a preset
   taken as offered brings its scaffolding as fact; a preset written over brings
   it as background, ranked below the GM; free text brings none and asks the
   model to derive the same four things. Getting this wrong is silent — the
   payload simply argues with itself and the ladder comes back confused. */
const WINS = "my words win";
const DERIVE = "Work out from that description";

for (const style of PRESENTATIONS) {
  // 1. the preset's own sentence, untouched.
  const asOffered = buildPayload(brief, {
    presentation: { key: style.key, text: style.text },
  });
  for (const field of ["speaker", "evidence", "falsehood", "address"]) {
    if (!asOffered.includes(style[field])) {
      fail(`Payload for preset "${style.key}" taken as offered dropped its ${field}.`);
    }
  }
  if (!asOffered.includes(style.text)) fail(`Payload for preset "${style.key}" dropped its own sentence.`);
  if (asOffered.includes(WINS)) {
    fail(`Payload for preset "${style.key}" ranked its scaffolding below words the GM never wrote.`);
  }
  if (asOffered.includes(DERIVE)) {
    fail(`Payload for preset "${style.key}" asked the model to derive fields it was handed.`);
  }

  // 2. the same preset, written over by the GM.
  const written = "A cracked bronze mirror that answers in someone else's voice.";
  const overridden = buildPayload(brief, { presentation: { key: style.key, text: written } });
  if (!overridden.includes(written)) fail(`Payload dropped the GM's own words over preset "${style.key}".`);
  if (!overridden.includes(WINS)) {
    fail(`Payload kept preset "${style.key}" as fact under words that replaced it; the two would argue.`);
  }
  if (!overridden.includes(style.speaker)) {
    fail(`Payload dropped preset "${style.key}"'s scaffolding entirely; it is still worth offering as background.`);
  }

  // The numbers exception belongs to the preset's own sentence, not to a key
  // left lying behind text that no longer describes a readout.
  const exceptionShown = /stated exception/.test(asOffered);
  if (style.numbers !== exceptionShown) {
    fail(`Preset "${style.key}" and the payload disagree about the numbers exception.`);
  }
  if (/stated exception/.test(overridden)) {
    fail(`Preset "${style.key}" licensed numbers under words the GM wrote over it with.`);
  }
}

/* 3. free text nobody picked: no scaffolding to hand over, so the model is
   asked the same four questions rather than left to assume a person is
   speaking — which is what it does by default, and which is wrong for five of
   the six presets. */
{
  const free = buildPayload(brief, {
    presentation: { key: null, text: "A dead god mumbling in your sleep." },
  });
  if (!free.includes("A dead god mumbling in your sleep.")) fail("Payload dropped free-typed presentation text.");
  if (!free.includes(DERIVE)) fail("Free-typed presentation did not ask the model to derive speaker/evidence/falsehood.");
  if (free.includes(presentationByKey(DEFAULT_PRESENTATION).speaker)) {
    fail("Free-typed presentation silently inherited the default preset's scaffolding.");
  }
}

/* 4. an empty box is the baseline, not the absence of a presentation. An
   unknown key must still prep: a world whose default setting names a
   presentation this build no longer ships is somebody's Tuesday. */
{
  const empty = buildPayload(brief, { presentation: { key: DEFAULT_PRESENTATION, text: "" } });
  if (!empty.includes(presentationByKey(DEFAULT_PRESENTATION).speaker)) {
    fail("An empty presentation box did not fall back to the default preset.");
  }
  if (empty.includes(DERIVE)) fail("An empty box asked the model to derive fields the fallback already supplies.");

  if (!buildPayload(brief, { presentation: { key: "gone", text: "" } }).includes(
    presentationByKey(DEFAULT_PRESENTATION).speaker
  )) {
    fail("An unrecognised presentation key did not fall back to the default in the payload.");
  }
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

/* ------------------------------------------- 4b. inline markdown -------- */

/**
 * Every `<` in a rendered string that does not open one of the four tags this
 * renderer is allowed to produce.
 *
 * A regex for "looks dangerous" would pass on the interesting cases: escaped
 * text legitimately still READS as `onerror="alert(1)"` once its angle brackets
 * are `&lt;`, and that is safe. What matters is whether a TAG survived, so the
 * check is on the angle bracket rather than on the words inside it.
 */
const ALLOWED_TAGS = /^<\/?(strong|em|del|code)>/;
const strayTags = (html) =>
  [...String(html).matchAll(/<[^>]*>?/g)].map((m) => m[0]).filter((tag) => !ALLOWED_TAGS.test(tag));

/* The ladder arrives through a chat window, so it arrives as markdown whatever
   the payload asks for. Every failure here is silent in its own way: an
   unrendered marker means the GM reads "asterisk asterisk barrow troll" aloud,
   and an unescaped one means the clipboard can put live markup into a GM's
   panel and into an actor's privateNotes. */
{
  const cases = [
    ["**bold**", "<strong>bold</strong>", "bold"],
    ["*emphasis*", "<em>emphasis</em>", "emphasis"],
    ["***both***", "<strong><em>both</em></strong>", "both"],
    ["__bold__", "<strong>bold</strong>", "bold"],
    ["~~struck~~", "<del>struck</del>", "struck"],
    ["`SPEC-4471-B`", "<code>SPEC-4471-B</code>", "SPEC-4471-B"],
    // A code span is literal: the markers inside it are characters.
    ["`a*b*c`", "<code>a*b*c</code>", "a*b*c"],
    // So is a backslash-escaped marker.
    ["\\*not emphasis\\*", "*not emphasis*", "*not emphasis*"],
    // Identifiers are not emphasis, however many underscores they carry.
    ["snake_case_name", "snake_case_name", "snake_case_name"],
    // A link's label is the readable half; the target is noise read aloud.
    ["[the record](https://example.test/x)", "the record", "the record"],
  ];
  for (const [input, wantHtml, wantText] of cases) {
    const html = inlineMarkdownToHtml(input);
    if (!html.includes(wantHtml)) fail(`Markdown "${input}" rendered as "${html}", expected "${wantHtml}".`);
    const text = stripInlineMarkdown(input);
    if (text !== wantText) fail(`Markdown "${input}" stripped to "${text}", expected "${wantText}".`);
  }

  // Escaping happens BEFORE any markup is produced. This is the load-bearing
  // one: the input is a clipboard paste, and the panel renders it unescaped.
  for (const hostile of [
    '<script>alert(1)</script>',
    '<img src=x onerror="alert(1)">',
    '<a href="javascript:alert(1)">x</a>',
    '**<b>bold</b>**',
  ]) {
    const html = inlineMarkdownToHtml(hostile);
    const stray = strayTags(html);
    if (stray.length) {
      fail(`Markdown rendering let a tag through: "${hostile}" -> "${stray.join(", ")}".`);
    }
  }

  // Prose with no markers must survive both passes untouched, or every stored
  // ladder in every existing world is quietly rewritten the first time it is
  // read back.
  const plain = sample.bands.passable;
  if (stripInlineMarkdown(plain) !== plain) fail("Stripping altered a paragraph containing no markers.");
  if (inlineMarkdownToHtml(plain) !== plain) fail("Rendering altered a paragraph containing no markers.");

  // The parser keeps inline markers and drops block ones. Both halves matter:
  // dropping the inline markers silently rewrites the GM's document, and
  // keeping the block ones puts a bullet into a paragraph read aloud.
  const decorated = [
    "# Recall Knowledge: Barrow Troll",
    VERSION_MARK,
    ...BAND_KEYS.flatMap((key) => [
      "",
      `## ${HEADINGS[key]}`,
      key === "solid" ? "> - That is a **barrow troll**, and *fire* is the lever." : `The ${key} answer.`,
    ]),
  ].join("\n");
  const parsedDecorated = parseLadder(decorated);
  if (parsedDecorated.bands.solid !== "That is a **barrow troll**, and *fire* is the lever.") {
    fail(`Block markers survived (or inline ones did not): "${parsedDecorated.bands.solid}".`);
  }

  // The word count is what the GM SAYS, so markers must not spend the budget.
  // With the v2.3 ceilings this is the difference between a warning and none.
  const marked = `**${"word ".repeat(20).trim()}**`;
  const bare = "word ".repeat(20).trim();
  if (stripInlineMarkdown(marked).split(/\s+/).length !== bare.split(/\s+/).length) {
    fail("Markers count as spoken words; the overlong warning would fire on formatting.");
  }
}

/* ------------------------------------------- 4c. the Insight hand-off --- */

/* One band, one player, one press of a button. What must never travel with it
   is everything the GM's own panel shows around the paragraph: the band, the
   delivery mode, the subject's name. Each of those tells the player how well
   they rolled, which is the same tell the budgets above exist to suppress —
   and it is invisible from the GM's side of the screen, because the GM sees
   the panel and never sees the card. */
{
  const paragraph = sample.bands.remarkable;
  const message = buildInsightMessage({
    band: "remarkable",
    mode: "clean",
    modeLabel: "As written",
    text: paragraph,
    html: inlineMarkdownToHtml(paragraph),
    hasText: true,
    wrong: null,
    wrongSource: null,
    wrongName: null,
  });
  if (!message) fail("An authored band produced no Insight message.");
  else {
    if (message.title !== null) fail("The Insight card carries a title; every title here names the rung.");
    for (const leak of ["remarkable", "Remarkable", "As written", HEADINGS.remarkable]) {
      if (message.body.includes(leak) || String(message.sense).includes(leak)) {
        fail(`The Insight message leaks "${leak}" — the player would be reading their own roll.`);
      }
    }
    if (!message.body.includes("barrow troll")) fail("The Insight message dropped the paragraph itself.");
  }

  // Insight prints the body unescaped, so what this builds must already be safe.
  const hostile = buildInsightMessage({ text: '<img src=x onerror="alert(1)">A **fact**.' });
  const stray = strayTags(hostile?.body ?? "").filter((tag) => !/^<\/?p>$/.test(tag));
  if (stray.length) {
    fail(
      `The Insight body forwarded raw markup (${stray.join(", ")}); Insight renders it with a triple-stache.`
    );
  }
  if (!hostile?.body.includes("<strong>fact</strong>")) fail("The Insight body did not render markdown.");

  // The two fallbacks are re-voiced, not forwarded. The panel's wording for
  // them is addressed to the GM about the character ("They are fairly sure…"),
  // which is an instruction to the GM, not a line to say to a player.
  const mistaken = playerFacingText({
    text: null,
    wrong: "They are fairly sure it is Hill Giant, and will act on that.",
    wrongSource: "mistaken",
    wrongName: "Hill Giant",
  });
  if (!mistaken || !mistaken.includes("Hill Giant")) fail("The mistaken-identity hand-off lost the name.");
  if (mistaken?.includes("They are")) fail("The mistaken-identity hand-off forwarded the GM-facing sentence.");
  const blank = playerFacingText({ text: null, wrongSource: "none", wrong: "Nothing comes to mind. They draw a blank." });
  if (!blank) fail("A blank band had nothing to send; the player should still be told they drew one.");
  if (blank?.includes("They draw")) fail("The blank hand-off forwarded the GM-facing sentence.");

  // Nothing written, nothing sent: the panel hides the control on this, so a
  // message built here would be a card with an empty body.
  if (buildInsightMessage(null) !== null) fail("A missing reveal still produced a message.");
  if (buildInsightMessage({ text: "   ", wrongSource: null }) !== null) {
    fail("A blank paragraph still produced a message.");
  }

  // The i18n keys share.mjs falls back on must exist for a real session, and
  // the fallback text must match what ships — a divergence here means the
  // check is asserting on prose no GM ever sees.
  for (const [key, fallback] of [
    ["GLRK.insight.sense", "Recall Knowledge"],
    ["GLRK.insight.blank", "Nothing comes to mind."],
    ["GLRK.insight.mistaken", "You are fairly sure it is {name}."],
  ]) {
    if (lang[key] !== fallback) {
      fail(`share.mjs falls back to "${fallback}" for ${key}, but lang says "${lang[key]}".`);
    }
  }
}

/* ------------------------------------------- 4d. journal pages ---------- */

/* A page of a journal is a subject in its own right. Without an extractor of
   its own it fell to `subjectBrief` returning null, which the panel reports as
   "that document type cannot be summarised" — and with one but no kind word,
   the payload asks the model to write about a "subject", which is exactly the
   generic ladder this feature exists to avoid. */
{
  if (!SUBJECT_TYPES.includes("JournalEntryPage")) {
    fail("JournalEntryPage is not a subject type; the page right-click would refuse to open.");
  }
  const page = subjectBrief({
    documentName: "JournalEntryPage",
    uuid: "JournalEntry.abc.JournalEntryPage.def",
    name: "The Hollow Kings",
    type: "text",
    parent: { name: "Barrow Country" },
    text: { content: "<p>Nine barrows, and the ninth is <strong>empty</strong>.</p>" },
  });
  if (!page) fail("subjectBrief has no extractor for a journal page.");
  else {
    if (!page.prose?.text.includes("Nine barrows")) fail("The page extractor dropped the page's own prose.");
    if (!page.subtitle.includes("Barrow Country")) {
      fail("The page extractor dropped the entry it belongs to; the model cannot tell it is one of a set.");
    }
    const pagePayload = buildPayload(page, {});
    if (!pagePayload.includes("place, group or topic")) {
      fail(`A page brief (kind "${page.kind}") has no kind word; the payload says "subject".`);
    }
    if (!pagePayload.includes("The Hollow Kings")) fail("A page payload dropped the page's name.");
  }

  // Every subject type must have an extractor, not just this one — a type
  // reachable from a menu with no extractor behind it is a dead menu item.
  for (const type of SUBJECT_TYPES) {
    const stub = {
      Actor: { documentName: "Actor", name: "x", type: "npc", system: {}, itemTypes: {}, items: [] },
      JournalEntry: { documentName: "JournalEntry", name: "x", pages: [] },
      JournalEntryPage: { documentName: "JournalEntryPage", name: "x", type: "text", text: {} },
      Item: { documentName: "Item", name: "x", type: "weapon", system: {} },
      Scene: { documentName: "Scene", name: "x", tokens: [] },
    }[type];
    if (!stub) {
      fail(`No stub for subject type "${type}"; extend this check when adding one.`);
      continue;
    }
    if (!subjectBrief({ ...stub, uuid: `${type}.x` })) fail(`Subject type "${type}" has no extractor.`);
  }
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
