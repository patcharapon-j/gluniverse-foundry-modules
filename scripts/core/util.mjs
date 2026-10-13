/**
 * GLUniverse Suite — shared pure helpers.
 *
 * Small, framework-light utilities that several features had each re-declared
 * (clamp / integer-coercion / hex validation / ranged random). Consolidated here
 * so the behaviour stays identical everywhere and there is one place to fix.
 * Keep this module dependency-free and side-effect-free.
 */

/** Clamp `n` into the inclusive range [lo, hi]. */
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** Finite numeric coercion followed by clamp; fallback when coercion fails. */
export const clampNumber = (value, lo, hi, fallback = lo) => {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, lo, hi) : fallback;
};

/** Clamp to [0, 1], coercing non-finite input to 0. */
export const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(+n) ? +n : 0));

/** Truncating integer coercion with a fallback for non-finite input. */
export const toInt = (v, fallback = 0) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : fallback;
};

/** Return `v` if it is a `#rrggbb` colour string, else `fallback`. */
export const hex6 = (v, fallback) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : fallback);

/** Uniform random float in [a, b). */
export const randRange = (a, b) => a + Math.random() * (b - a);

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escape the five HTML-significant characters for safe interpolation into markup. */
export const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);

/** HTML escaping is sufficient for values interpolated inside quoted attributes. */
export const escapeAttr = escapeHTML;

/* ── Search ─────────────────────────────────────────────────────────────── */

/** Lower-case, accent-free, single-spaced text for searching. */
export function foldText(v) {
  return String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** True when every word of `query` appears somewhere in `text`. An empty query matches all. */
export function matchesQuery(text, query) {
  const words = foldText(query).split(" ").filter(Boolean);
  const hay = foldText(text);
  return words.every((w) => hay.includes(w));
}

/**
 * How well `query` matches: 0 = no match (or an empty query), higher is better.
 * Every word must appear in `text`; a word found in `name` scores above one
 * found only in the rest, a word starting a word of `name` higher still, and
 * `name` starting with the whole query highest. Used to put the row a GM is
 * typing towards first.
 */
export function matchScore(name, text, query) {
  const q = foldText(query);
  const words = q.split(" ").filter(Boolean);
  if (!words.length) return 0;
  const n = foldText(name);
  const hay = `${n} ${foldText(text)}`;
  let score = 1;
  for (const w of words) {
    if (!hay.includes(w)) return 0;
    if (n.startsWith(w) || n.includes(` ${w}`)) score += 3;
    else if (n.includes(w)) score += 2;
  }
  if (n === q) score += 8;
  else if (n.startsWith(q)) score += 5;
  return score;
}
