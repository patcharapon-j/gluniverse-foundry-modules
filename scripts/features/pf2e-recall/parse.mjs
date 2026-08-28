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
 * wraps the whole reply in a fence, swaps `-` for `*`, bolds a lead-in, adds a
 * closing "Let me know if you'd like...". None of that should cost the GM a
 * paste, so all of it is absorbed. What is NOT absorbed is a missing tier or an
 * empty ladder — those are reported, because silently storing half a ladder is
 * worse than refusing it.
 */

import { HEADINGS } from "./prompt.mjs";
import { GRAMMAR_VERSION, TIER_KEYS } from "./constants.mjs";

/** Heading text -> tier key, matched case- and punctuation-insensitively. */
const HEADING_LOOKUP = new Map(
  Object.entries(HEADINGS).map(([key, label]) => [normalizeHeading(label), key])
);

function normalizeHeading(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip a wrapping code fence, which models add unprompted about half the time. */
function unfence(source) {
  const text = String(source ?? "").trim();
  const fence = text.match(/^```[a-z]*\n([\s\S]*?)\n?```$/i);
  return fence ? fence[1] : text;
}

/** Clean one bullet: drop the marker, a bold lead-in colon, and stray emphasis. */
function cleanBullet(line) {
  return String(line)
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\*\*([^*]+)\*\*\s*[—:-]\s*/, "$1 — ")
    .replace(/\s+/g, " ")
    .trim();
}

const isBullet = (line) => /^\s*[-*+]\s+\S/.test(line);
const isHeading = (line) => /^\s{0,3}#{1,6}\s+\S/.test(line);
const headingText = (line) => line.replace(/^\s{0,3}#{1,6}\s+/, "").trim();

/**
 * Parse a model reply into a ladder.
 *
 * @returns {{
 *   ok: boolean,
 *   name: string|null,
 *   version: number|null,
 *   tiers: Record<string, string[]>,
 *   misremembered: string|null,
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
  if (version == null) {
    warnings.push("GLRK.parse.warn.noVersion");
  } else if (version !== GRAMMAR_VERSION) {
    warnings.push("GLRK.parse.warn.versionMismatch");
  }

  const titleLine = text.match(/^\s{0,3}#\s+Recall Knowledge:\s*(.+)$/im);
  const name = titleLine ? titleLine[1].trim() : null;
  if (!name) warnings.push("GLRK.parse.warn.noTitle");

  const tiers = Object.fromEntries(TIER_KEYS.map((k) => [k, []]));
  let misremembered = null;
  let current = null;
  let sawAnyHeading = false;

  for (const raw of text.split(/\r?\n/)) {
    if (isHeading(raw)) {
      const key = HEADING_LOOKUP.get(normalizeHeading(headingText(raw)));
      // An unrecognised heading closes the previous section rather than
      // letting its bullets leak into the wrong tier.
      current = key ?? null;
      if (key) sawAnyHeading = true;
      continue;
    }
    if (!current || !isBullet(raw)) continue;
    const value = cleanBullet(raw);
    if (!value) continue;
    if (current === "misremembered") {
      if (misremembered == null) misremembered = value;
      else warnings.push("GLRK.parse.warn.extraMisremembered");
    } else {
      tiers[current].push(value);
    }
  }

  if (!sawAnyHeading) errors.push("GLRK.parse.error.noHeadings");
  const empty = TIER_KEYS.filter((k) => !tiers[k].length);
  if (empty.length === TIER_KEYS.length) errors.push("GLRK.parse.error.empty");
  else for (const key of empty) warnings.push(`GLRK.parse.warn.emptyTier.${key}`);
  if (!misremembered) warnings.push("GLRK.parse.warn.noMisremembered");

  return { ok: !errors.length, name, version, tiers, misremembered, warnings, errors };
}

/** Serialise a stored ladder back to the grammar, for export and round-trip tests. */
export function formatLadder(ladder, name) {
  const lines = [`# Recall Knowledge: ${name ?? ladder?.name ?? ""}`, `<!-- glrk:${GRAMMAR_VERSION} -->`, ""];
  for (const key of TIER_KEYS) {
    lines.push(`## ${HEADINGS[key]}`);
    for (const bullet of ladder?.tiers?.[key] ?? []) lines.push(`- ${bullet}`);
    lines.push("");
  }
  lines.push(`## ${HEADINGS.misremembered}`);
  if (ladder?.misremembered) lines.push(`- ${ladder.misremembered}`);
  return lines.join("\n").trim() + "\n";
}
