/**
 * GLUniverse Suite — Recall Knowledge: parsing the model's reply.
 *
 * The counterpart to prompt.mjs. The grammar it emits is the grammar this
 * reads; tools/recall-check.mjs asserts the round trip so the two cannot drift
 * apart silently — a drifted grammar surfaces as a parse failure the GM will
 * misread as "the model got it wrong".
 *
 * Deliberately strict about STRUCTURE and forgiving about NOISE. A language
 * model reliably produces the right headings and reliably decorates them: it
 * wraps the whole reply in a fence, hard-wraps a paragraph across lines, adds a
 * bullet marker it was told not to use, bolds a lead-in, appends a closing
 * "Let me know if you'd like...". None of that should cost the GM a paste, so
 * all of it is absorbed. What is NOT absorbed is an empty ladder — silently
 * storing half a ladder is worse than refusing it.
 *
 * v2 reads one PARAGRAPH per competence band. A v1 reply (three tiers of
 * bullets) is still recognised and converted, so a GM with an old chat window
 * open is not stranded; see `parseLegacyLadder`.
 */

import { HEADINGS } from "./prompt.mjs";
import { BAND_KEYS, GRAMMAR_VERSION, PARAGRAPH_WORDS, TIER_KEYS } from "./constants.mjs";

/** v1 headings, kept only so an old reply still parses into the new shape. */
const LEGACY_HEADINGS = Object.freeze({
  everyone: "Everyone knows",
  might: "One might know",
  few: "Very few know",
  misremembered: "Misremembered",
});

/** Heading text -> band key, matched case- and punctuation-insensitively. */
const HEADING_LOOKUP = new Map(
  Object.entries(HEADINGS).map(([key, label]) => [normalizeHeading(label), key])
);
const LEGACY_LOOKUP = new Map(
  Object.entries(LEGACY_HEADINGS).map(([key, label]) => [normalizeHeading(label), key])
);

function normalizeHeading(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pull the ladder out of a fenced reply.
 *
 * Models fence the document unprompted about half the time, and routinely add
 * "Let me know if you'd like these pitched differently!" after the closing
 * marker. v1 only ever collected BULLET lines, so trailing chatter fell on the
 * floor for free. v2 collects prose, so it does not: left alone, the closing
 * marker and the sign-off are appended to the last band's paragraph and the GM
 * reads them aloud.
 *
 * So: prefer the first fenced block that actually contains the title line, fall
 * back to a fence wrapping the whole reply, and otherwise take the text as-is.
 */
function unfence(source) {
  const text = String(source ?? "").trim();
  for (const match of text.matchAll(/```[a-z]*\n([\s\S]*?)\n?```/gi)) {
    if (/^\s{0,3}#\s+Recall Knowledge:/im.test(match[1])) return match[1];
  }
  const whole = text.match(/^```[a-z]*\n([\s\S]*?)\n?```$/i);
  return whole ? whole[1] : text;
}

const isHeading = (line) => /^\s{0,3}#{1,6}\s+\S/.test(line);
const headingText = (line) => line.replace(/^\s{0,3}#{1,6}\s+/, "").trim();
const isBullet = (line) => /^\s*[-*+]\s+\S/.test(line);

/**
 * Fold the lines collected under one heading into a single spoken paragraph.
 *
 * Absorbs the decorations a model adds despite being told not to: a bullet
 * marker, a bolded lead-in, a stray blank line mid-paragraph, and a band name
 * echoed back as a label. Hard-wrapped lines are rejoined, because a paragraph
 * split across three source lines is still one paragraph.
 */
function foldParagraph(lines, key) {
  const text = lines
    .map((line) => line.replace(/^\s*[-*+]\s+/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  // "**Solid** — you recognise…" / "Solid: you recognise…" → drop the label.
  const label = HEADINGS[key];
  const labelPattern = new RegExp(`^\\*{0,2}${label}\\*{0,2}\\s*[—:-]\\s*`, "i");
  return text.replace(labelPattern, "").replace(/^\*\*([^*]+)\*\*\s*[—:-]\s*/, "$1 — ").trim();
}

const wordCount = (text) => (String(text ?? "").trim().match(/\S+/g) ?? []).length;

/**
 * Parse a model reply into a ladder.
 *
 * @returns {{
 *   ok: boolean,
 *   name: string|null,
 *   version: number|null,
 *   bands: Record<string, string>,
 *   warnings: string[],
 *   errors: string[]
 * }}
 */
export function parseLadder(source) {
  const text = unfence(source);
  const warnings = [];
  const errors = [];

  const versionMark = text.match(/<!--\s*glrk:(\d+)\s*-->/i);
  const version = versionMark ? Number(versionMark[1]) : null;
  if (version == null) warnings.push("GLRK.parse.warn.noVersion");
  else if (version !== GRAMMAR_VERSION) warnings.push("GLRK.parse.warn.versionMismatch");

  const titleLine = text.match(/^\s{0,3}#\s+Recall Knowledge:\s*(.+)$/im);
  const name = titleLine ? titleLine[1].trim() : null;
  if (!name) warnings.push("GLRK.parse.warn.noTitle");

  const collected = Object.fromEntries(BAND_KEYS.map((k) => [k, []]));
  let current = null;
  let sawAnyHeading = false;
  let sawLegacyHeading = false;

  for (const raw of text.split(/\r?\n/)) {
    if (isHeading(raw)) {
      const heading = normalizeHeading(headingText(raw));
      const key = HEADING_LOOKUP.get(heading);
      // An unrecognised heading closes the previous section rather than letting
      // its prose leak into the wrong band.
      current = key ?? null;
      if (key) sawAnyHeading = true;
      else if (LEGACY_LOOKUP.has(heading)) sawLegacyHeading = true;
      continue;
    }
    if (!current) continue;
    const line = raw.trim();
    if (!line) continue;
    // The version comment and horizontal rules are structure, not prose.
    if (/^<!--/.test(line) || /^-{3,}$/.test(line) || /^```/.test(line)) continue;
    collected[current].push(line);
  }

  if (!sawAnyHeading) {
    // A v1 reply has none of our headings but all of the old ones. Convert it
    // rather than refusing: the GM should not have to re-prompt for a document
    // they already have.
    if (sawLegacyHeading) return parseLegacyLadder(text, { name, version, warnings });
    errors.push("GLRK.parse.error.noHeadings");
  }

  const bands = {};
  for (const key of BAND_KEYS) {
    const folded = foldParagraph(collected[key], key);
    if (folded) bands[key] = folded;
  }

  const missing = BAND_KEYS.filter((k) => !bands[k]);
  if (missing.length === BAND_KEYS.length) errors.push("GLRK.parse.error.empty");
  else for (const key of missing) warnings.push(`GLRK.parse.warn.emptyBand.${key}`);

  // Two identical bands mean two rolls that play the same, which is the one
  // thing this rewrite exists to prevent. Cheap to detect, invisible otherwise.
  const seen = new Map();
  for (const [key, value] of Object.entries(bands)) {
    const fingerprint = value.toLowerCase().replace(/[^a-z0-9 ]+/g, "").trim();
    if (seen.has(fingerprint)) warnings.push("GLRK.parse.warn.duplicateBand");
    else seen.set(fingerprint, key);
  }

  const [, maxWords] = PARAGRAPH_WORDS;
  // A generous multiple of the budget: a paragraph slightly over is fine read
  // aloud, but one at twice the budget is the v1 failure returning by the back
  // door, and the GM should know before they are mid-combat with it.
  if (Object.values(bands).some((v) => wordCount(v) > maxWords * 1.5)) {
    warnings.push("GLRK.parse.warn.longBand");
  }

  return { ok: !errors.length, name, version, bands, warnings, errors };
}

/**
 * Convert a v1 (three-tier, bulleted) reply into the band shape.
 *
 * The mapping mirrors what v1's BAND_REVEAL did at read time, so a converted
 * ladder plays as close to the original as the new shape allows. Bullets are
 * joined into a paragraph — imperfect prose, but readable, and the GM can
 * regenerate whenever they like.
 */
function parseLegacyLadder(text, { name, version, warnings }) {
  const tiers = Object.fromEntries(TIER_KEYS.map((k) => [k, []]));
  let misremembered = null;
  let current = null;

  for (const raw of text.split(/\r?\n/)) {
    if (isHeading(raw)) {
      current = LEGACY_LOOKUP.get(normalizeHeading(headingText(raw))) ?? null;
      continue;
    }
    if (!current || !isBullet(raw)) continue;
    const value = raw
      .replace(/^\s*[-*+]\s+/, "")
      .replace(/^\*\*([^*]+)\*\*\s*[—:-]\s*/, "$1 — ")
      .replace(/\s+/g, " ")
      .trim();
    if (!value) continue;
    if (current === "misremembered") misremembered ??= value;
    else tiers[current].push(value);
  }

  const join = (list) => list.map((s) => (/[.!?]$/.test(s) ? s : `${s}.`)).join(" ");
  const bands = {};
  if (misremembered) bands.inept = misremembered;
  if (tiers.everyone.length) {
    bands.poor = join(tiers.everyone.slice(0, 2));
    bands.passable = join(tiers.everyone);
  }
  if (tiers.might.length) {
    bands.solid = join(tiers.might.slice(0, 1));
    bands.impressive = join(tiers.might);
  }
  if (tiers.few.length) {
    bands.remarkable = join(tiers.few.slice(0, 1));
    bands.phenomenal = join(tiers.few);
  }

  const errors = Object.keys(bands).length ? [] : ["GLRK.parse.error.empty"];
  return {
    ok: !errors.length,
    name,
    version,
    bands,
    warnings: [...warnings, "GLRK.parse.warn.convertedFromV1"],
    errors,
  };
}

/** Serialise a stored ladder back to the grammar, for export and round-trip tests. */
export function formatLadder(ladder, name) {
  const lines = [
    `# Recall Knowledge: ${name ?? ladder?.name ?? ""}`,
    `<!-- glrk:${GRAMMAR_VERSION} -->`,
    "",
  ];
  for (const key of BAND_KEYS) {
    lines.push(`## ${HEADINGS[key]}`);
    const text = ladder?.bands?.[key];
    if (text) lines.push(text);
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}
