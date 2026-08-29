/**
 * GLUniverse Suite — Recall Knowledge: the band model.
 *
 * The feature stores one short read-aloud paragraph per Flatfinder competence
 * band and hands the GM exactly the one their player's roll landed in. It
 * deliberately computes NO DCs: under Proficiency-without-Level the level-based
 * DC collapses to a seven-point band across levels 0-20 and rarity dominates
 * it, so the number carries almost no signal. The band does.
 *
 * v1 stored three cumulative tiers of bullets, named after the "Everyone knows
 * / One might know / Very few know" device from Stonetop by Jeremy Strandberg
 * (Lampblack & Brimstone). Those headings are retired, but the shape of the
 * climb they describe still governs what each band is about, and the credit
 * stands; see docs/RECALL_KNOWLEDGE.md.
 */

export const FEATURE_ID = "pf2e-recall";
export const FEATURE_PREFIX = "rk";

/** Flag key holding the authored ladder (scope SUITE_ID). */
export const FLAG_LADDER = "rk.ladder";
/** Flag key holding the persisted free-text generation context. */
export const FLAG_CONTEXT = "rk.context";
/** Flag key caching this actor's mistaken-identity pick, so a lie stays stable. */
export const FLAG_MISTAKEN = "rk.mistaken";

/**
 * The v1 tier keys, kept only so a stored v1 ladder can still be read and a v1
 * reply can still be pasted. Nothing renders them: v2 authors the eight bands
 * below directly. See parse.mjs parseLegacyLadder() and store.mjs
 * bandsFromLegacy().
 */
export const TIER_KEYS = Object.freeze(["everyone", "might", "few"]);


/**
 * The eight authored bands — the v2 model, and the one the payload asks for.
 *
 * v1 authored three cumulative tiers of bullets and derived eight table
 * experiences from them. That worked on paper and failed at the table: at the
 * top bands the GM was handed nine or ten bullets to read out mid-combat, which
 * is not something anyone does. v2 authors ONE paragraph per band, so whatever
 * the roll, the GM reads exactly one paragraph aloud.
 *
 * The paragraph is COMPLETE, not merely standalone: from Passable up, each one
 * carries everything the rungs below it would have told the player, compressed
 * into a clause each, before adding its own layer. v1 was right that knowledge
 * accumulates; it was only wrong about making the GM assemble it at the table.
 * See BAND_WORDS below for what that costs in length.
 *
 * Order mirrors COMPETENCE_BANDS in features/flatfinder/constants.js, shallowest
 * first. It is duplicated here rather than imported so this module stays free of
 * cross-feature dependencies; tools/recall-check.mjs asserts the two agree.
 */
export const BAND_KEYS = Object.freeze([
  "disastrous",
  "inept",
  "poor",
  "passable",
  "solid",
  "impressive",
  "remarkable",
  "phenomenal",
]);

/**
 * Word budget per band, [min, max]. The budget CLIMBS, and it has to.
 *
 * v2.0 gave every band the same 25-70 words and told the model each paragraph
 * had to "stand alone". It read that as "say only what this rung adds", so a
 * Remarkable roll returned the secret with no identification, no weakness and
 * no tactics — the GM had the payoff and none of the setup, and the only way
 * to give the player a complete answer was to read the lower bands too. That
 * is precisely the reading-two-paragraphs failure the band model exists to
 * remove.
 *
 * v2.1 makes the true bands CUMULATIVE: each one carries everything the rungs
 * below it would have told the player, compressed, plus its own new layer. A
 * paragraph that carries five layers cannot also fit in fifty words, so the
 * ceiling rises with the rung.
 *
 * The ceiling is still load-bearing — this is read aloud, and roughly seventy
 * words is about fifteen seconds of speech — but it is not the same ceiling at
 * every rung. The common rolls stay brisk; the rare ones are allowed to stop
 * the table, because that is what they are for. Phenomenal at 180 is about
 * thirty-five seconds, which is affordable exactly because almost nobody rolls
 * it. The lower layers still arrive as a clause each rather than re-told at
 * their own length, and the newest layer always gets the most words.
 *
 * The bottom two bands are false answers and accumulate nothing, so they stay
 * short: a joke and a wrong belief are both worse for being padded.
 */
export const BAND_WORDS = Object.freeze({
  disastrous: Object.freeze([15, 45]),
  inept: Object.freeze([30, 60]),
  poor: Object.freeze([30, 60]),
  passable: Object.freeze([30, 65]),
  solid: Object.freeze([50, 90]),
  impressive: Object.freeze([70, 120]),
  remarkable: Object.freeze([90, 150]),
  phenomenal: Object.freeze([110, 180]),
});

/**
 * The band the carry starts at.
 *
 * Below it there is nothing true to carry: Disastrous holds no true fact at
 * all, Inept is confidently wrong, and Poor is the floor of true knowledge.
 * Both the payload and the parser's cumulative check read this, so the ladder
 * cannot be taught one shape and checked against another.
 */
export const CARRY_FROM = "passable";

/**
 * How far past its budget a stored paragraph may run before the parser says so.
 *
 * Slack for a good paragraph that lands a little long, not a second budget. At
 * the old flat 70-word ceiling 1.5x meant 105 words; against Phenomenal's 180
 * it would mean 270, which is not a warning, it is a rubber stamp.
 */
export const OVERLONG_FACTOR = 1.25;

/**
 * How the knowledge REACHES the player — the presentation, not the band.
 *
 * The eight bands say how much is known. This says who is speaking and what
 * the knowing is made of: a character's memory, a console log, a vision. It is
 * baked in at authoring time because the module holds no runtime model access
 * — the payload is copied out and the reply pasted back — so a paragraph
 * cannot be re-voiced at read time. What is stored was authored this way.
 *
 * There is ONE field for this in the UI: a box the GM writes in. The presets
 * below fill that box in a click and bring their own scaffolding with them, but
 * they never outrank it — whatever the GM has written is the presentation, and
 * a preset whose sentence the GM has edited away is no longer describing what
 * they asked for. See renderPresentation() in prompt.mjs for the precedence.
 *
 * Each entry is a TABLE OF WHAT CHANGES, not an adjective, for the reason
 * statsblock-import's RUNGS states outright: a model cannot calibrate "make it
 * feel like a terminal", but it can obey "the system is never unsure; it is
 * wrong with total confidence". The fields are deliberately few and each one
 * does work in the payload:
 *
 *   text      - the one sentence the preset types into the GM's box. The box is
 *               the field; the presets are only a fast way to fill it.
 *   speaker   - who or what is talking, and to whom
 *   evidence  - what the knowledge is MADE of at every true band
 *   falsehood - how it goes wrong at Disastrous and Inept. This is the field
 *               that earns the table: a terminal does not misremember and an
 *               augury does not repeat gossip, so a single generic "be wrong
 *               in flavour" rule visibly breaks the moment the presentation
 *               stops being a person.
 *   address   - the addressee the presentation implies, which is the one
 *               existing rule a presentation may overrule (see prompt.mjs)
 *   numbers   - the documented exception to "types, never numbers"
 *
 * NAMING: this is deliberately not called a mode or a source. BAND_REVEAL
 * already owns `mode` (blank/wrong/hedged/clean/lead/bonus) and resolveReveal
 * returns `wrongSource`; a second `mode` in the same feature would be misread
 * within a month.
 */
export const PRESENTATIONS = Object.freeze([
  Object.freeze({
    key: "recall",
    label: "What the character remembers",
    text: "What the character themselves remembers.",
    speaker: "You, the GM, narrating to the character who rolled.",
    evidence:
      "The character's own memory — what they were taught, what they overheard, what they once saw and half kept.",
    falsehood:
      "Misremembering: a rumour repeated as fact, a name garbled in the telling, two similar creatures confused for one another.",
    address: "Address the character directly as \"you\".",
    numbers: false,
  }),
  Object.freeze({
    key: "investigation",
    label: "What they work out on the spot",
    text: "What they work out on the spot, from the thing in front of them.",
    speaker:
      "You, the GM, narrating to the character as they examine the thing in front of them.",
    evidence:
      "Physical evidence present in the scene: remains, tracks, droppings, damage, smell, what it did to the room and what it left behind.",
    falsehood:
      "A confident misreading of real evidence. The marks are genuinely there; the conclusion drawn from them is wrong.",
    address:
      "Address the character directly as \"you\", and anchor every band to something they can actually point at.",
    numbers: false,
  }),
  Object.freeze({
    key: "archive",
    label: "Research: books, records, an expert",
    text: "Research — a book, a record, or an expert answering.",
    speaker:
      "The source itself — a book, a record, a scholar answering — quoted or closely paraphrased.",
    evidence:
      "Written or remembered scholarship: a catalogue entry, a monograph, a marginal note, a traveller's account, an expert's reply.",
    falsehood:
      "An outdated or superseded entry, a confident account of a different species, or the facing page mistaken for this one.",
    address:
      "Write about the subject in the third person. The character is the reader here, not the one being addressed.",
    numbers: false,
  }),
  Object.freeze({
    key: "terminal",
    label: "A console, datapad or system log",
    text: "A console, datapad or system log.",
    speaker: "The system. No narrator and no addressee — output on a screen.",
    evidence:
      "Records the system holds: catalogue entries, sensor returns, incident logs, maintenance notes, timestamps, whatever a machine would actually have stored.",
    falsehood:
      "A corrupted record, a redacted field, or a confident match against the wrong specimen. The system is never unsure; it is wrong with total confidence.",
    address:
      "No addressee at all. Do not say \"you\" — nothing here is speaking to anyone.",
    numbers: false,
  }),
  Object.freeze({
    key: "divination",
    label: "A vision, augury or spirit answering",
    text: "A vision, an augury, or a spirit answering.",
    speaker:
      "You, the GM, describing what the character is shown rather than what they know.",
    evidence:
      "Images, impressions and answers that arrive whole and unbidden. They are true; they are not always legible.",
    falsehood:
      "A true image, misread. Never a false vision — the vision does not lie, the reading of it does.",
    address:
      "Address the character directly as \"you\", but as someone being shown a thing, not someone recalling it.",
    numbers: false,
  }),
  Object.freeze({
    key: "readout",
    label: "A bestiary or game-style stat readout",
    text: "A bestiary entry or game-style stat readout.",
    speaker:
      "A game system's own entry, quoted deliberately — a bestiary page, a scanner panel, a codex record.",
    evidence:
      "Catalogued statistics and rules text, presented as a record rather than as speech.",
    falsehood:
      "A typo'd entry, an erratum, or a first-edition line that a later printing quietly corrected.",
    address:
      "No addressee. This is an entry being read, not a person being spoken to.",
    // The one documented exception to "types, never numbers". A readout that
    // refuses to print a number is not a readout, and a GM who picks this
    // preset has asked for the stat block on purpose.
    numbers: true,
  }),
]);

/** Fallback presentation, and the world default's own default. */
export const DEFAULT_PRESENTATION = "recall";

const PRESENTATION_BY_KEY = new Map(PRESENTATIONS.map((p) => [p.key, p]));

/** Look up a presentation, falling back to the baseline rather than throwing. */
export const presentationByKey = (key) =>
  PRESENTATION_BY_KEY.get(key) ?? PRESENTATION_BY_KEY.get(DEFAULT_PRESENTATION);

/** Flag key holding `{key, text}` — the GM's own words, and the preset behind them. */
export const FLAG_PRESENTATION = "rk.presentation";

/**
 * The preset a piece of typed text still is, or null.
 *
 * Compared loosely (case and trailing punctuation are not meaning) because the
 * question being asked is "has the GM written their own thing here?", and a
 * stray full stop is not the GM writing their own thing.
 */
const normalizeText = (value) =>
  String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/, "");

const PRESENTATION_BY_TEXT = new Map(
  PRESENTATIONS.map((style) => [normalizeText(style.text), style])
);

export const presentationForText = (text) =>
  PRESENTATION_BY_TEXT.get(normalizeText(text)) ?? null;

/**
 * Strict lookup: null for "no preset", where presentationByKey() would hand
 * back the baseline.
 *
 * The difference is load-bearing. A null key means nobody picked a preset, so
 * there is no scaffolding to offer behind the GM's words and the payload has to
 * ask for it instead; falling back to the baseline there would quietly tell the
 * model a character is speaking when the GM described a machine.
 */
export const presentationForKey = (key) => PRESENTATION_BY_KEY.get(key) ?? null;

/**
 * Competence band -> how the answer is DELIVERED.
 *
 * In v2 the band no longer selects content — every band has its own authored
 * paragraph, and that paragraph is the answer. What survives here is delivery:
 *   blank  - nothing came to mind at all
 *   wrong  - a confidently wrong belief
 *   hedged - true in outline, uncertain in detail
 *   clean  - said plainly
 *   lead   - said plainly, with a sense that more exists
 *   bonus  - said plainly, and the GM is invited to add their own secret
 *
 * Modes repeat across bands and that is correct now: three bands deliver
 * "clean" and are still entirely distinct, because they are three different
 * paragraphs. In v1 the mode had to carry that distinctness alone, which is why
 * the check used to assert every (depth, mode) pair was unique. Depth is gone;
 * the uniqueness that matters is now between the paragraphs themselves.
 *
 * Band keys mirror COMPETENCE_BANDS in features/flatfinder/constants.js. That
 * module already maps a PF2e skill-check total onto a band (with Lore +1,
 * nat 20 +1, nat 1 -1); this table is the only thing added on top.
 *
 * `blank` vs `wrong` follows Flatfinder's own band flavour rather than
 * collapsing the bottom two: "Unbelievably bad" is comically disconnected from
 * the question, where "Gross" is wrong but engaged. Giving nothing at all is
 * also explicitly permitted by the remaster on a critical failure, so the
 * bottom rung stays rules-legal as well as distinct. In practice a trained
 * character cannot reach `blank` at all — which is the point: it is what
 * happens when someone is entirely out of their depth.
 */
export const BAND_REVEAL = Object.freeze({
  disastrous: Object.freeze({ mode: "blank" }),
  inept: Object.freeze({ mode: "wrong" }),
  poor: Object.freeze({ mode: "hedged" }),
  passable: Object.freeze({ mode: "clean" }),
  solid: Object.freeze({ mode: "clean" }),
  impressive: Object.freeze({ mode: "lead" }),
  remarkable: Object.freeze({ mode: "clean" }),
  phenomenal: Object.freeze({ mode: "bonus" }),
});

/** Fallback when Flatfinder is absent or the band is unrecognised. */
export const DEFAULT_REVEAL = Object.freeze({ mode: "clean" });

/** Document types the feature can build a ladder for. */
export const SUBJECT_TYPES = Object.freeze(["Actor", "JournalEntry", "Item", "Scene"]);

/**
 * Hard ceiling on extracted prose per subject, in characters.
 *
 * A long journal will happily serialise to 50k+ characters, which produces
 * mush rather than lore. Truncation is always announced in the payload so the
 * GM knows the model did not see everything.
 */
export const EXTRACT_CHAR_CAP = 8000;

/** Grammar version stamped into the payload and checked on parse. */
export const GRAMMAR_VERSION = 2;
