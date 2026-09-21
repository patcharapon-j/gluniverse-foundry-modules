/**
 * Hexcrawl — Font Awesome glyph lookup for the canvas.
 *
 * DOM only (no game/canvas/foundry), so the runtime host and the preview page
 * import the SAME resolver: a preview carrying its own copy would keep working
 * against the CDN's Font Awesome 6 while Foundry's Font Awesome 7 broke — which
 * is exactly how the "\" / \"" in every landmark diamond shipped.
 */

const iconCache = new Map();
let iconProbeHost = null;

/** The first quoted string in a CSS value (`"\f54c" / ""` → the glyph). */
export function firstCssString(v) {
  const m = /^\s*(["'])((?:\\.|(?!\1).)*)\1/.exec(String(v ?? ""));
  return m ? m[2] : "";
}
/** `\f54c` → the character (custom properties keep CSS escapes as text). */
export function unescapeCss(s) {
  return String(s ?? "").replace(/\\([0-9a-f]{1,6})\s?/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\(.)/g, "$1");
}

/** fa class → { char, fontFamily, fontWeight } read off the live stylesheet. */
export function resolveIcon(faClass) {
  if (!faClass || typeof faClass !== "string") return null;
  if (iconCache.has(faClass)) return iconCache.get(faClass);
  let out = null;
  try {
    if (!iconProbeHost) {
      iconProbeHost = document.createElement("div");
      iconProbeHost.setAttribute("aria-hidden", "true");
      iconProbeHost.style.cssText = "position:absolute;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;";
      document.body.appendChild(iconProbeHost);
    }
    const el = document.createElement("i");
    el.className = faClass;
    iconProbeHost.appendChild(el);
    const cs = getComputedStyle(el, "::before");
    // Font Awesome 7 (Foundry v14) writes `content: var(--fa) / ""` — the glyph
    // plus an alt text — so the computed value is `"\f54c" / ""`, not one string.
    // Stripping quotes off the ends left `" / "` in the icon; take the FIRST CSS
    // string instead, and fall back to the --fa custom property (unparsed, so its
    // escape is still text) when a browser reports content differently.
    const char = firstCssString(cs.content) || unescapeCss(firstCssString(getComputedStyle(el).getPropertyValue("--fa")));
    // Read everything BEFORE removing the probe: a CSSStyleDeclaration is live,
    // and a detached element reports an empty font — PIXI then draws the glyph in
    // its default face, a missing-glyph box inside every diamond.
    const fontFamily = cs.fontFamily || getComputedStyle(el).fontFamily;
    const fontWeight = cs.fontWeight || getComputedStyle(el).fontWeight || "900";
    el.remove();
    if (char && fontFamily) out = { char: [...char][0], fontFamily, fontWeight };
  } catch { out = null; }
  // A miss is cached too — but only once fonts are settled, or an early miss
  // (stylesheet still loading) would stick for the session.
  if (out || document.fonts?.status === "loaded") iconCache.set(faClass, out);
  return out;
}
