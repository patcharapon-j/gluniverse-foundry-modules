/**
 * GLUniverse Suite — Recall Knowledge: inline markdown.
 *
 * The ladder is authored in a chat window and arrives through the GM's
 * clipboard, so it arrives as MARKDOWN whatever the payload asks for. Models
 * bold the creature's name, italicise a quoted title, wrap a system designation
 * in backticks and em-dash their way through a sentence — none of which the
 * payload can reliably forbid, and none of which is worth refusing a paste
 * over.
 *
 * Before this module the panel rendered the stored paragraph with Handlebars'
 * own escaping, so the GM read `**barrow troll**` aloud, asterisks and all, and
 * the `privateNotes` mirror wrote the same markers into the actor sheet. The
 * fix is to keep the markers in STORAGE — they are the GM's text, and they
 * round-trip back out through `formatLadder` — and to render them at the places
 * a human reads them.
 *
 * Deliberately INLINE-only. There are no block constructs here (no lists, no
 * headings, no paragraphs): a band is one paragraph by contract, the parser
 * already folds block structure away, and a renderer that grew block support
 * would quietly re-admit the bulleted ladder v2 exists to remove.
 *
 * Everything is escaped BEFORE any markup is produced, so a reply containing
 * `<script>` or an `onerror=` attribute renders as text. Nothing here trusts
 * the clipboard.
 *
 * Pure and Foundry-free (`escapeHTML` is a string function), so
 * tools/recall-check.mjs exercises it under plain Node.
 */

import { escapeHTML } from "../../core/util.mjs";

/**
 * Placeholder delimiter for spans that must survive the emphasis passes intact.
 *
 * A private-use code point: it cannot appear in text pasted from a chat window,
 * and `escapeHTML` neither produces nor removes it, so a token can never be
 * forged by the very input it is protecting.
 */
const MASK = "";

/** Characters markdown lets an author escape with a backslash. */
const ESCAPABLE = /\\([\\`*_~[\]()#-])/g;

/** One placed token: the delimiter, a kind letter, an index, the delimiter. */
const MASK_TOKEN = new RegExp(`${MASK}([ce])(\\d+)${MASK}`, "g");

/**
 * Pull code spans and backslash-escaped characters out of the source.
 *
 * Both are LITERAL by definition: `*` inside a code span is an asterisk, and
 * `\*` is an asterisk the author asked for. Masking them before the emphasis
 * passes is the only way to keep either from being eaten as a marker.
 */
function mask(source) {
  const spans = [];
  const push = (kind, value) => `${MASK}${kind}${spans.push({ kind, value }) - 1}${MASK}`;
  const masked = String(source)
    .replace(/`+([^`]+?)`+/g, (_m, body) => push("c", body))
    .replace(ESCAPABLE, (_m, ch) => push("e", ch));
  return { masked, spans };
}

/** Put the masked spans back, escaped, once no marker pass can reach them. */
function unmask(text, spans, { html }) {
  return text.replace(MASK_TOKEN, (_m, _kind, index) => {
    const span = spans[Number(index)];
    if (!span) return "";
    if (!html) return span.value;
    return span.kind === "c" ? `<code>${escapeHTML(span.value)}</code>` : escapeHTML(span.value);
  });
}

/**
 * The emphasis passes, in the one order that works.
 *
 * Triple markers first — `***x***` is bold *and* italic, and a `**` pass run
 * ahead of it leaves a stray asterisk on each side — then double, then single.
 * The underscore form of single emphasis is word-bounded, because prose is full
 * of `snake_case` identifiers and file names that are not emphasis at all.
 */
function emphasise(text, { html }) {
  const wrap = (tag, inner) => (html ? `<${tag}>${inner}</${tag}>` : inner);
  return text
    // [label](target) — the label is the readable half. A URL read aloud is
    // noise, and a live link in a GM panel is an invitation to navigate away
    // mid-scene.
    .replace(/\[([^\]\n]+?)\]\(([^)\s]*)\)/g, "$1")
    .replace(/\*\*\*([^*]+?)\*\*\*/g, (_m, v) => wrap("strong", wrap("em", v)))
    .replace(/___([^_]+?)___/g, (_m, v) => wrap("strong", wrap("em", v)))
    .replace(/\*\*([^*]+?)\*\*/g, (_m, v) => wrap("strong", v))
    .replace(/__([^_]+?)__/g, (_m, v) => wrap("strong", v))
    .replace(/(^|[\s("'])\*([^*\n]+?)\*(?=$|[\s.,;:!?)"'—])/g, (_m, lead, v) => lead + wrap("em", v))
    .replace(/(^|[\s("'])_([^_\n]+?)_(?=$|[\s.,;:!?)"'—])/g, (_m, lead, v) => lead + wrap("em", v))
    .replace(/~~([^~]+?)~~/g, (_m, v) => wrap("del", v));
}

function transform(source, { html }) {
  const raw = String(source ?? "");
  if (!raw.trim()) return "";
  const { masked, spans } = mask(raw);
  const base = html ? escapeHTML(masked) : masked;
  return unmask(emphasise(base, { html }), spans, { html });
}

/**
 * Render one paragraph of inline markdown as safe HTML.
 *
 * The result is a fragment, not a block: the caller supplies the element it
 * lands in, so the same string can be the panel's read-aloud paragraph, a
 * paragraph in the `privateNotes` mirror, or an Insight notification body.
 */
export const inlineMarkdownToHtml = (source) => transform(source, { html: true });

/**
 * The same text with its markers removed and nothing marked up.
 *
 * For the places that need characters rather than markup: the matrix preview
 * (which counts words and clamps to two lines, where `**` would both eat the
 * budget and show through), and any plain-text hand-off.
 */
export const stripInlineMarkdown = (source) => transform(source, { html: false });
