/**
 * Hexcrawl renderer — the look, as numbers.
 *
 * Pure. Every proportion is a fraction of the hex circumradius R so the map
 * reads the same on a 50px grid and a 200px one; every hairline is a count of
 * DEVICE pixels, converted by `hairline()` against the live zoom and device
 * pixel ratio (a world-unit hairline is 2px on a retina screen and deleted on
 * an ordinary one). Colours are derived from the injected palette and the
 * terrain's own data colour — nothing here is a suite hue.
 */

import { hexToInt, lighten, mix } from "../../../core/theme.mjs";

/** Proportions of R. */
export const GEO = Object.freeze({
  gutter: 0.045,       // gap between neighbouring fog tiles (each side)
  channel: 0.04,       // half the dark channel between two regions (each side, from the edge)
  rimInset: 0.1,       // a region's rim runs this far inside its outline (line centre)
  regionRim: 0.05,     // region rim width
  seamWidth: 0.014,    // the faint seam between two hexes of one region
  bevel: 0.14,         // inset of the lit inner bevel from the hex edge
  rimWidth: 0.022,
  bevelWidth: 0.034,
  glyphWidth: 0.052,
  glyphScale: 0.55 / 10, // world units per glyph unit
  glyphY: -0.06,
  pipY: 0.43,
  pipSize: 0.062,
  pipGap: 0.17,
  fogDashWidth: 0.02,
  qScale: 0.042,        // "?" glyph scale (glyph units → R)
  lmGlyphY: -0.4,
  lmGlyphScale: 0.52,
  lmPipY: -0.68,
  lmBadgeY: 0.12,
  lmBadge: 0.235,        // half-diagonal of a landmark diamond, before its own size
  lmBadgeWidth: 0.028,
  lmUnseenDash: 0.42,    // dash period of a GM-only badge's rim, in badge half-diagonals
  lmUnseenHatch: 0.3,    // hatch spacing inside one, same units
  lmLabelY: 0.42,
  veinWidth: 0.026,
  veinGlow: 0.085,
  traceWidth: 0.034,
  partyGlow: 0.075,
  trailDot: 0.055,
  labelName: 0.235,
  labelSub: 0.155,
  labelLmName: 0.155,
  labelIcon: 0.24,
  fogQSize: 0.36,        // the fog "?" — region-label face, font size in R
  iconSize: 0.8,         // an image icon's longer side, in R
  // An icon's two baked shadows (blur radius in SOURCE-image px, offset down in R):
  // a tight contact shadow that grounds it and a wide ambient one that lifts it
  // off a busy texture. Soft, never a hard offset copy — that reads as clip-art.
  iconContactBlur: 5,
  iconContactDrop: 0.012,
  iconAmbientBlur: 26,
  iconAmbientDrop: 0.045,
  blightPixel: 22,       // blight overlay: pixel-art cells per hex radius
});

/** Device-pixel counts for hairlines. */
export const HAIR = Object.freeze({
  border: 1.25,
  hatch: 1.1,
  sight: 2.2,
  staged: 1.5,
  party: 2.2,
});

/** Alphas. */
export const ALPHA = Object.freeze({
  tintFill: 0.35,
  bevel: 0.75,
  maskBevel: 0.35,
  border: 0.45,
  fogDash: 0.45,
  fogQ: 0.17,
  seam: 0.55,
  maskSeam: 0.45,
  rim: 0.95,
  maskRim: 0.6,
  iconContact: 0.55,
  iconAmbient: 0.7,
  maskIcon: 0.78,
  blight: 0.95,
  maskBlight: 0.6,
  maskDash: 0.28,
  hatchVeilHidden: 0.42,
  hatchVeilMasked: 0.16,
  hatchHidden: 0.55,
  hatchMasked: 0.32,
  // A landmark the party cannot see yet, in the GM view: the same language as
  // the hex hatch, so "hatched = mine alone" means one thing on this map.
  lmUnseenBody: 0.72,
  lmUnseenRim: 0.7,
  lmUnseenHatch: 0.38,
  lmUnseenMark: 0.5,     // its icon and caption
});

/** Mix amounts. */
export const MIXES = Object.freeze({
  fill: 0.66,          // terrain → ink
  maskFill: 0.78,
  glyphLift: 0.35,     // terrain → white
  pipLift: 0.45,
  maskGlyphLift: 0.08,
  blightLean: 0.4,     // terrain → dark violet
  regionTint: 0.6,     // bevel terrain → region colour
});

/** Hatch spacing in R. */
export const HATCH = Object.freeze({ hidden: 0.15, masked: 0.27 });

/** Hexes per chunk side for the static layer. */
export const CHUNK = 8;

/** Beyond this many simultaneously changed hexes a setMap snaps (a whole-map reveal). */
export const ANIM_CAP = 600;

/** UI settle, not motion: how long zoom must rest before hairlines and text re-raster. */
export const ZOOM_SETTLE_MS = 140;
/** Text re-rasterises only when its target resolution drifts past this ratio. */
export const TEXT_RES_DRIFT = 0.25;
export const TEXT_RES_MAX = 4;

/** One hairline, `n` device pixels wide, in world units. */
export const hairline = (n, zoom, dpr) => n / Math.max(1e-3, zoom * dpr);

/** Per-renderer colour cache: terrain colour → derived ints. */
export function makeColors(palette) {
  const cache = new Map();
  const ink = palette.ink2;
  const violetDark = mix(palette.violet, ink, 0.45);
  const tile = (color, { blight = false, region = null, masked = false } = {}) => {
    const id = `${color}|${blight ? 1 : 0}|${region ?? ""}|${masked ? 1 : 0}`;
    let c = cache.get(id);
    if (c) return c;
    const base = blight ? mix(color, violetDark, MIXES.blightLean) : color;
    const bevel = region ? mix(base, region, MIXES.regionTint) : base;
    c = masked
      ? {
        fill: hexToInt(mix(base, ink, MIXES.maskFill)),
        rim: hexToInt(mix(base, ink, 0.55)),
        bevel: hexToInt(bevel),
        glyph: hexToInt(lighten(mix(base, ink, 0.25), MIXES.maskGlyphLift)),
        pip: hexToInt(lighten(base, 0.2)),
      }
      : {
        fill: hexToInt(mix(base, ink, MIXES.fill)),
        rim: hexToInt(mix(base, ink, 0.35)),
        sheen: hexToInt(mix(base, ink, 0.5)),
        bevel: hexToInt(bevel),
        glyph: hexToInt(lighten(base, MIXES.glyphLift)),
        pip: hexToInt(lighten(base, MIXES.pipLift)),
        hover: hexToInt(lighten(bevel, 0.5)),
      };
    cache.set(id, c);
    return c;
  };
  // A landmark's own colour (null → the signal hue every badge used to draw in).
  const lmCache = new Map();
  const landmark = (color) => {
    const id = color ?? "";
    let c = lmCache.get(id);
    if (c) return c;
    const base = color || palette.warn;
    const lift = lighten(base, 0.4);
    c = { rim: hexToInt(base), lift: hexToInt(lift), css: lift };
    lmCache.set(id, c);
    return c;
  };
  return {
    tile,
    landmark,
    ink0: hexToInt(palette.ink0),
    ink1: hexToInt(palette.ink1),
    ink2: hexToInt(ink),
    ink3: hexToInt(palette.ink3),
    text: hexToInt(palette.text),
    textDim: hexToInt(palette.textDim),
    accent: hexToInt(palette.accent),
    accentLift: hexToInt(lighten(palette.accent, 0.35)),
    warn: hexToInt(palette.warn),
    warnLift: hexToInt(lighten(palette.warn, 0.4)),
    violet: hexToInt(palette.violet),
    violetHot: hexToInt(palette.violetHot ?? lighten(palette.violet, 0.5)),
    bruise: hexToInt(mix(palette.violet, ink, 0.72)),
    trace: hexToInt(mix(palette.text, palette.accent, 0.35)),
    hatch: hexToInt(mix(palette.textDim, ink, 0.35)),
    regionBorder: (hex) => hexToInt(hex ? lighten(hex, 0.25) : palette.text),
    /** A region rim whose colour is withheld (silhouette): neutral. */
    silRim: hexToInt(mix(palette.textDim, ink, 0.25)),
    css: {
      text: palette.text,
      textDim: palette.textDim,
      ink0: palette.ink0,
      warnLift: lighten(palette.warn, 0.4),
    },
  };
}
