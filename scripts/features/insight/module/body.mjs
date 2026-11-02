// module/body.mjs — what an Insight card may print, and how a typed message becomes it.
//
// The card prints its body with a triple-stache, because a message is allowed a
// little emphasis. So whatever reaches the template has to be safe already, and
// "safe" cannot be the sender's promise: the body crosses the socket, and the
// receiving client is the only one that can decide what it will put on its own
// screen. Every road in (the compose dialog, Recall Knowledge, the api) goes
// through `safeBody` on the RECEIVING side.
//
// The rule is an allow-list of bare inline tags and paragraphs. A tag with any
// attribute is not on it (an attribute is where `onerror=` and `style=` live),
// so it is printed as text instead. Entities that are already well formed pass
// through untouched, which is what keeps Recall Knowledge's escaped paragraph
// (`&amp;`, `&#39;`) from being escaped a second time into visible noise.
//
// Pure: no DOM, no Foundry, so tools/insight-check.mjs drives it under Node.

/** Tags a body may carry, bare (no attributes). */
export const BODY_TAGS = Object.freeze(["p", "br", "b", "strong", "i", "em", "u", "s", "del", "code"]);

const TAG = new RegExp(`^<(/?)(${BODY_TAGS.join("|")})\\s*(/?)>`, "i");
const ENTITY = /^&(?:#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/i;
const ESC = { "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "&": "&amp;" };

/** Longest body a card will print. A wall of text is not a whisper. */
export const BODY_MAX = 4000;

/**
 * Reduce arbitrary markup to the allow-list.
 * @param {unknown} html
 * @returns {string}
 */
export function safeBody(html) {
  const src = String(html ?? "").slice(0, BODY_MAX);
  let out = "";
  for (let i = 0; i < src.length; ) {
    const ch = src[i];
    if (ch === "<") {
      const m = TAG.exec(src.slice(i));
      if (m) {
        const name = m[2].toLowerCase();
        out += name === "br" ? "<br>" : `<${m[1]}${name}>`;
        i += m[0].length;
        continue;
      }
    } else if (ch === "&") {
      const m = ENTITY.exec(src.slice(i));
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    out += ESC[ch] ?? ch;
    i += 1;
  }
  return out;
}

/**
 * A message typed into the compose dialog, as a body.
 *
 * The textarea is plain prose with line breaks, plus the `<b>`/`<i>` the hint
 * offers. A blank line starts a new paragraph and a single break stays a break,
 * which is what the GM saw while typing; without this every line ran together.
 * @param {unknown} text
 * @returns {string}
 */
export function composeBody(text) {
  const paragraphs = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs.map((p) => `<p>${safeBody(p).replace(/\n/g, "<br>")}</p>`).join("");
}

/** True when a body would print nothing a player could read. */
export function isBlankBody(html) {
  return !String(html ?? "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}
