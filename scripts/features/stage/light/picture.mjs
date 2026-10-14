/**
 * Stage light — the picture's own look.
 *
 * Pure. Theatre frames and grades a shot before anybody stands in front of it:
 * a crop point (`focus`) and a treatment (exposure, saturation, tint, blur).
 * While the stage is up Stage draws that picture itself, so it has to draw the
 * SAME picture — crop and grade — or bringing the cast on visibly re-frames and
 * re-grades the room, and the cast is lit by a room nobody is looking at.
 *
 * `light.picture` carries it. It is the picture's, not the light's: `mood: off`
 * and `strength: 0` leave it on (the identity rig is the cast unlit, not the
 * shot ungraded), and a GM's light dials never move it.
 *
 * The grade is applied to ENCODED sRGB values, in Theatre's order (gain,
 * saturation about Rec.709 luma, a luma-preserving tint wash), because that is
 * what Theatre's shader does to the same texture — any other space draws a
 * different picture at the same numbers. The vignette and letterbox are not
 * carried: Stage frames its own, and Theatre's bars ride its overlay above it.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, lo, hi, fallback) => {
  const n = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
};
const hex = (v, fallback) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v).toLowerCase() : fallback);

/** A picture drawn exactly as it is: centred, ungraded, sharp. */
export const NEUTRAL_PICTURE = Object.freeze({
  focus: Object.freeze({ x: 0.5, y: 0.5 }),
  exposure: 0,
  saturation: 1,
  tint: "#000000",
  tintAmount: 0,
  blur: 0,
});

/** Total. The ranges are Theatre's treatment ranges. */
export function normalizePicture(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const f = r.focus && typeof r.focus === "object" ? r.focus : {};
  return {
    focus: { x: num(f.x, 0, 1, 0.5), y: num(f.y, 0, 1, 0.5) },
    exposure: num(r.exposure, -2, 2, 0),
    saturation: num(r.saturation, 0, 2, 1),
    tint: hex(r.tint, "#000000"),
    tintAmount: num(r.tintAmount, 0, 1, 0),
    blur: num(r.blur, 0, 1, 0),
  };
}

/** Whether the grade changes no pixel (focus and blur are not pixels). */
export function isNeutralGrade(p) {
  const n = normalizePicture(p);
  return n.exposure === 0 && n.saturation === 1 && n.tintAmount === 0;
}

/** Tint colour pre-divided by its own luminance (Theatre's `tintVector`). */
export function tintVector(h) {
  const n = parseInt(String(h ?? "#000000").slice(1), 16) || 0;
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return l > 1e-3 ? [r / l, g / l, b / l] : [0, 0, 0];
}

/** The shader's numbers: [gain, saturation, tint amount, 0] and the tint vector. */
export function pictureUniforms(p) {
  const n = normalizePicture(p);
  return {
    grade: [n.exposure === 0 ? 1 : 2 ** n.exposure, n.saturation, n.tintAmount, 0],
    tint: n.tintAmount > 0 ? tintVector(n.tint) : [0, 0, 0],
  };
}

/** The neutral uniforms, for a backdrop whose stand-in texture is already graded. */
export const NEUTRAL_UNIFORMS = Object.freeze({ grade: Object.freeze([1, 1, 0, 0]), tint: Object.freeze([0, 0, 0]) });

/**
 * Grade an RGBA byte buffer in place, exactly as the backdrop shader grades the
 * sharp texture. A neutral grade touches nothing.
 */
export function gradeBytes(data, p) {
  if (isNeutralGrade(p)) return data;
  const { grade: [gain, sat, amt], tint } = pictureUniforms(p);
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    if (gain !== 1) { r *= gain; g *= gain; b *= gain; }
    if (sat !== 1) {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = Math.max(l + (r - l) * sat, 0); g = Math.max(l + (g - l) * sat, 0); b = Math.max(l + (b - l) * sat, 0);
    }
    if (amt > 0) {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r += (tint[0] * l - r) * amt; g += (tint[1] * l - g) * amt; b += (tint[2] * l - b) * amt;
    }
    data[i] = Math.round(clamp(r, 0, 1) * 255);
    data[i + 1] = Math.round(clamp(g, 0, 1) * 255);
    data[i + 2] = Math.round(clamp(b, 0, 1) * 255);
  }
  return data;
}

/**
 * The key a prepared backdrop is held under. Everything that changes what is
 * prepared or where it is cropped is in it, so two shots of one image with
 * different looks never share a backdrop; a plain picture keeps its bare src.
 */
export function pictureKey(src, p) {
  if (!src) return null;
  const n = normalizePicture(p);
  const parts = [];
  if (n.focus.x !== 0.5 || n.focus.y !== 0.5) parts.push(`f${n.focus.x.toFixed(4)},${n.focus.y.toFixed(4)}`);
  if (!isNeutralGrade(n)) parts.push(`g${n.exposure},${n.saturation},${n.tint},${n.tintAmount}`);
  return parts.length ? `${src}#gl-picture:${parts.join(";")}` : src;
}

/** The lite renderer's approximation (it has no tint). */
export function pictureFilter(p) {
  const n = normalizePicture(p);
  const f = [];
  if (n.exposure !== 0) f.push(`brightness(${(2 ** n.exposure).toFixed(4)})`);
  if (n.saturation !== 1) f.push(`saturate(${n.saturation})`);
  return f.join(" ");
}
