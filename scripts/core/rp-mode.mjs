/**
 * GLUniverse Suite — the Roleplay Chat mode flag, as every reader sees it.
 *
 * Pure: no `game`, no DOM, importable under plain Node. Three features read this one flag and none of
 * them may import another for it:
 *
 *   - `roleplay-chat` writes it on every line typed through its switch;
 *   - `stream` files a cloned chat card under its chat-filter row (`chat-filter.mjs`);
 *   - `stream-cards` reads it into a text card (`stream-cards/text/read-text.js`).
 *
 * `stream` must never import a child, and the stream readers must work in a world where Roleplay Chat
 * is switched off (its flags stay on every message it ever wrote), so the contract lives in core.
 *
 * Storage. The flag is written nested — `flags[SUITE_ID].rp.mode` — which is the shape Foundry persists
 * for `setFlag(SUITE_ID, "rp.mode", …)` and what `getFlag` reads back. A literal dotted key
 * (`flags[SUITE_ID]["rp.mode"]`) is accepted too, because Foundry does not agree with itself about the
 * shape a dotted flag key takes on the way in (see the stream director channel in CLAUDE.md), and a
 * reader that matched only one shape would read every line as untagged on the other.
 */

import { SUITE_ID } from "./const.mjs";

/** The setting/flag prefix Roleplay Chat owns. */
export const RP_PREFIX = "rp.";

/** The flag key, under SUITE_ID. */
export const RP_MODE_FLAG = `${RP_PREFIX}mode`;

/**
 * Every mode a line can carry.
 *
 *   say       spoken aloud, in character
 *   do        something the character does, narrated in the third person
 *   think     a thought, shown to everyone (the table is the audience, not the other characters)
 *   narrator  the GM speaking as nobody: scene narration
 *   ooc       table talk
 */
export const RP_MODES = Object.freeze(["say", "do", "think", "narrator", "ooc"]);

/** The modes that are in character. */
export const RP_IC_MODES = Object.freeze(["say", "do", "think", "narrator"]);

/** The mode a stored value means, or null when it is not one of ours. */
export function rpModeOf(flags) {
  const scope = flags && typeof flags === "object" ? flags[SUITE_ID] : null;
  if (!scope || typeof scope !== "object") return null;
  const value = scope.rp && typeof scope.rp === "object" ? scope.rp.mode : scope[RP_MODE_FLAG];
  return RP_MODES.includes(value) ? value : null;
}

/** The flags object a new message carries for a mode. */
export function rpModeFlags(mode) {
  if (!RP_MODES.includes(mode)) throw new Error(`Unknown roleplay mode: ${mode}`);
  return { [SUITE_ID]: { rp: { mode } } };
}

/* ── asides ────────────────────────────────────────────────────────────────── */

/**
 * `*draws her blade*` inside a spoken line is an action, not words: "Hold the line! *draws her blade*
 * Run!" Roleplay Chat's log, bubble and caption lane and the stream's text card all set it apart from
 * what is said, so the rule lives here beside the mode it belongs to. The message keeps the stars as
 * typed, so nothing is lost on a client without either feature.
 *
 * A star pair holds at least one non-space character, no newline and no markup, and `**` is never an
 * aside. A star touching a Latin letter or a digit on its outside is arithmetic, not an aside: "2*3*4".
 * Thai runs words together, so a Thai letter beside a star does not count against it.
 */
const ASIDE = /(?<![A-Za-z0-9*])\*(?!\*)([^*\n<>]*[^*\s<>][^*\n<>]*)\*(?![A-Za-z0-9*])/g;

/**
 * A line cut into what is said and what is done, in order. Said pieces keep their spacing; an aside's
 * own text is trimmed.
 *
 * @returns {{aside: boolean, text: string}[]}
 */
export function splitAsides(text) {
  const source = typeof text === "string" ? text : "";
  const parts = [];
  let at = 0;
  for (const match of source.matchAll(ASIDE)) {
    if (match.index > at) parts.push({ aside: false, text: source.slice(at, match.index) });
    parts.push({ aside: true, text: match[1].trim() });
    at = match.index + match[0].length;
  }
  if (at < source.length) parts.push({ aside: false, text: source.slice(at) });
  return parts.length ? parts : [{ aside: false, text: source }];
}

/** True when a line holds an aside. */
export function hasAsides(text) {
  return splitAsides(text).some((part) => part.aside);
}

/**
 * The pieces as they are laid out. The spaces either side of an aside are dropped, because each
 * renderer spaces an aside itself (in a quoted line the space belongs outside the quote mark it closes:
 * “Hold the line!” draws her blade “Run!”), and said pieces left blank are dropped. On an aside,
 * `closes` means words come just before it and `opens` that words come just after it: the quote marks a
 * quoted line draws around the aside. A line that starts or ends on an aside has no outer mark there.
 *
 * @returns {{aside: boolean, text: string, closes?: boolean, opens?: boolean}[]}
 */
const WORDY = /[\p{L}\p{N}]/u;

export function asideRuns(text) {
  const parts = splitAsides(text);
  if (!parts.some((part) => part.aside)) return parts;
  const runs = [];
  parts.forEach((part, i) => {
    if (part.aside) return runs.push({ ...part });
    let said = part.text;
    if (parts[i - 1]?.aside) said = said.trimStart();
    if (parts[i + 1]?.aside) said = said.trimEnd();
    if (!said) return;
    // Punctuation with no words is not something said: "the door is *trembling*." ends on the aside,
    // not on a quoted "." of its own. It joins the aside it touches.
    const prev = runs[runs.length - 1];
    if (!WORDY.test(said) && prev?.aside) prev.text += said;
    else if (!WORDY.test(said) && parts[i + 1]?.aside) parts[i + 1] = { ...parts[i + 1], text: said + parts[i + 1].text };
    else runs.push({ aside: false, text: said });
  });
  runs.forEach((run, i) => {
    if (!run.aside) return;
    run.closes = runs[i - 1]?.aside === false;
    run.opens = runs[i + 1]?.aside === false;
  });
  return runs;
}

/** Whether a quoted line opens and closes on words (true) or on an aside (false). */
export function quoteEdges(runs) {
  return { opens: runs[0]?.aside !== true, closes: runs[runs.length - 1]?.aside !== true };
}
