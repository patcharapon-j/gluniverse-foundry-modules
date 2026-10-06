/**
 * Combat Intro — the Aegis text scramble, as a pure function of time.
 *
 * The audience app's `scramble()` (src/fx/scramble.ts) decodes a line like a
 * signal locking on: every character churns through block glyphs, then they
 * settle left to right. That version runs on a ticker with Math.random, so two
 * clients never show the same frame and a late joiner cannot land mid-decode.
 * This one is seeded and seekable instead: the same (text, t, seed) is the same
 * string on every client, so the director can drive it off the shared timeline.
 *
 * Pure: no timers, no DOM, no `game`.
 *
 *   scrambleAt(text, t, { seed = 0, rate = 30, duration = 900, glyphs = GLYPHS, blank = true })
 *     text      the final string
 *     t         progress 0..1 through the decode (≤ 0: blank or churn, ≥ 1: `text`)
 *     seed      any number; pick one per line (e.g. the sequence id hashed) so lines differ
 *     rate      glyph changes per second of decode
 *     duration  the decode's length in ms (only used to turn t into glyph frames)
 *     glyphs    the churn alphabet
 *     blank     true: at t ≤ 0 every character is a space (nothing on screen yet)
 *   returns the string to print this frame (same length as `text`, spaces kept).
 *
 * Character i settles at t = 0.15 + 0.85 · i / length, the audience timing.
 */

export const GLYPHS = "▚▞▙▟█▓▒░<>/\\#%&@$01";

/** A small integer hash: stable across engines, no Math.random. */
function hash(a, b, c) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function scrambleAt(text, t, { seed = 0, rate = 30, duration = 900, glyphs = GLYPHS, blank = true } = {}) {
  const chars = [...String(text ?? "")];
  const n = chars.length;
  if (!n) return "";
  if (!(t > 0)) return blank ? " ".repeat(n) : churn(chars, 0, seed, glyphs);
  if (t >= 1) return chars.join("");
  const frame = Math.floor((t * duration * rate) / 1000);
  const g = [...glyphs];
  const s = Math.floor(Number(seed) || 0);
  return chars
    .map((ch, i) => {
      if (ch === " ") return " ";
      if (t >= 0.15 + (0.85 * i) / n) return ch;
      return g[Math.floor(hash(s, i, frame) * g.length)];
    })
    .join("");
}

function churn(chars, frame, seed, glyphs) {
  const g = [...glyphs];
  const s = Math.floor(Number(seed) || 0);
  return chars.map((ch, i) => (ch === " " ? " " : g[Math.floor(hash(s, i, frame) * g.length)])).join("");
}

export default scrambleAt;
