/**
 * Theatre — Canvas mode: a cut becomes the scene background.
 *
 * In Canvas mode a Theatre scene is an ordinary Foundry scene that the GM
 * re-backgrounds on every cut: the shot's picture at its own size, on a padded
 * surround coloured from the picture itself (its average, a touch darker), with
 * the camera free for everyone. Theatre's own layer and camera lock stay off.
 *
 * Changing `scene.background` redraws the whole canvas — a flash and a stall —
 * so a cut is sequenced around full black (main.mjs plays the client half):
 *
 *   1. the GM writes the cue (th.state), as in Frame mode; every client dips to black
 *   2. at full black the GM writes the layout (size, padding, colour, background)
 *   3. then `th.state.drawn = seq`; a client reveals once its canvas has redrawn
 *
 * The maths here is pure (no `game`, no `canvas`), so the check tool imports it.
 * `measureSource` touches the DOM and Foundry's texture loader, and only on the
 * GM's client.
 */

/** Canvas-mode shapes. */
export const CANVAS = Object.freeze({
  lightness: 0.72,   // the surround's OKLab lightness against the picture's average: "a touch darker"
  chroma: 0.85,      // and a little less saturated, so the picture stays the subject
  padding: 0.25,     // Foundry's own default padding: the surround shows around the picture
  fallback: "#000000",
  thumb: 32,         // the picture is averaged from a thumb × thumb draw
});

/* ── OKLab (pure) ───────────────────────────────────────────────────────── */

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** Linear sRGB (0..1 each) → OKLab [L, a, b]. */
export function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

/** OKLab [L, a, b] → linear sRGB (unclamped). */
export function oklabToLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

const hex2 = (v) => Math.round(Math.max(0, Math.min(1, toSrgb(Math.max(0, v)))) * 255).toString(16).padStart(2, "0");

/**
 * The surround colour for a picture whose average colour, in LINEAR sRGB, is
 * `avg`: the same hue, darker and a little less saturated. A missing or broken
 * average gives the fallback.
 * @param {number[]} avg  [r, g, b] linear, 0..1
 * @returns {string} "#rrggbb"
 */
export function surroundColor(avg) {
  if (!Array.isArray(avg) || avg.length < 3 || !avg.every((v) => Number.isFinite(v))) return CANVAS.fallback;
  const [L, a, b] = linearToOklab(avg.map((v) => Math.max(0, Math.min(1, v))));
  const out = oklabToLinear([L * CANVAS.lightness, a * CANVAS.chroma, b * CANVAS.chroma]);
  return `#${out.map(hex2).join("")}`;
}

/**
 * The average colour of RGBA pixel data, in linear sRGB, weighted by alpha.
 * @param {ArrayLike<number>} data  RGBA bytes
 * @returns {number[] | null}  null for fully transparent data
 */
export function averageLinear(data) {
  let r = 0, g = 0, b = 0, w = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (!(a > 0)) continue;
    r += toLinear(data[i] / 255) * a;
    g += toLinear(data[i + 1] / 255) * a;
    b += toLinear(data[i + 2] / 255) * a;
    w += a;
  }
  return w > 0 ? [r / w, g / w, b / w] : null;
}

/** The sRGB hex of a linear average (for a readout). */
export const linearToHex = (avg) => `#${avg.map(hex2).join("")}`;

/**
 * The scene layout Canvas mode writes for a picture `width` × `height`.
 * The background itself is written separately (it lives on a Level in v14).
 */
export function canvasLayout({ width, height }, color) {
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    padding: CANVAS.padding,
    backgroundColor: color,
  };
}

/* ── Measuring a source (GM client, DOM) ────────────────────────────────── */

/** src → Promise<{ width, height, color } | null> */
const _measured = new Map();

/**
 * The natural size of an image or video and its surround colour. Resolves to
 * null when it cannot be loaded; a picture that loads but cannot be read (a
 * cross-origin image without CORS taints the canvas) keeps its size and gets
 * the fallback colour. Cached per source.
 * @param {string} src
 * @param {{ warn?: (...a:any[]) => void }} [o]
 */
export function measureSource(src, { warn = () => {} } = {}) {
  const key = String(src ?? "");
  if (!key) return Promise.resolve(null);
  let p = _measured.get(key);
  if (!p) {
    p = measure(key, warn).catch((e) => { warn(`could not measure ${key}`, e); return null; });
    _measured.set(key, p);
    p.then((r) => { if (!r) _measured.delete(key); });
  }
  return p;
}

async function measure(src, warn) {
  const load = globalThis.foundry?.canvas?.loadTexture ?? globalThis.loadTexture;
  if (typeof load !== "function") return null;
  const tex = await load(src);
  const bt = tex?.baseTexture;
  const el = bt?.resource?.source ?? null;
  const width = el?.videoWidth || el?.naturalWidth || bt?.realWidth || tex?.width || 0;
  const height = el?.videoHeight || el?.naturalHeight || bt?.realHeight || tex?.height || 0;
  if (!(width > 0 && height > 0)) return null;
  let color = CANVAS.fallback;
  try {
    const n = CANVAS.thumb;
    const c = document.createElement("canvas");
    c.width = n; c.height = n;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(el, 0, 0, n, n);
    color = surroundColor(averageLinear(ctx.getImageData(0, 0, n, n).data));
  } catch (e) {
    warn(`could not read the colours of ${src} (a cross-origin image needs CORS); the surround falls back to black.`, e);
  }
  return { width, height, color };
}
