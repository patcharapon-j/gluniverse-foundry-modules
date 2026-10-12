/**
 * Stage light — reading a backdrop.
 *
 * Pure: takes a small RGBA buffer of the backdrop (sRGB bytes) and returns what
 * the picture says about its light. No DOM, no GL; the check tool drives it with
 * synthetic pictures under Node.
 *
 * The model this feeds is a compositor's, not a renderer's. A backdrop is a
 * PAINTING of a room, and the cast stands in front of it — so everything bright
 * in the picture is BEHIND the characters. A window, a lamp, a sunset: each of
 * those reaches a character as a rim on the edge that faces it, never as a key
 * on the face. What lights the front of a character is the room as a whole: the
 * colour and level of its ambient, the ceiling above and the floor below, and
 * whichever side of the room is brighter. Reading it that way is what makes a
 * character walked across the stage pick up a lamp as they pass it.
 *
 * Every colour out of here is LINEAR light, [r, g, b] in 0..1.
 */

export const PROBE_W = 64;
export const PROBE_H = 36;

/** sRGB byte → linear float, tabled once. */
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

const smoothstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

const avg = (acc, n) => (n > 0 ? [acc[0] / n, acc[1] / n, acc[2] / n] : [0, 0, 0]);

/**
 * How far a colour's hue can be believed, 0..1, from its linear luminance. A
 * near-black colour's channels are a few 8-bit codes each, so their RATIO is
 * quantisation noise: the black of a dim tavern measured as a "teal" and
 * turned every dark coat on stage green. Below ~0.5% luminance the hue fades
 * to neutral; above ~3% it is trusted fully.
 */
export function hueTrust(l) {
  const t = Math.min(1, Math.max(0, (l - 0.004) / (0.03 - 0.004)));
  return t * t * (3 - 2 * t);
}

/** A colour's hue direction at unit luminance, its saturation softened. */
export function chroma(c, keep = 1) {
  const l = lum(c);
  if (l <= 1e-6) return [1, 1, 1];
  keep *= hueTrust(l);
  const t = [c[0] / l, c[1] / l, c[2] / l];
  // Pull toward white until no channel exceeds `cap`: a saturated light read
  // straight off a sunset paints a face pure orange, which is never wanted.
  const cap = 1.9;
  const peak = Math.max(t[0], t[1], t[2]);
  const k = peak > cap ? (cap - 1) / (peak - 1) : 1;
  const out = t.map((v) => 1 + (v - 1) * k * keep);
  const l2 = lum(out);
  return out.map((v) => v / l2);
}

/** The neutral probe: a flat grey studio. A backdrop that cannot be read uses it. */
export function neutralProbe(color = [0.18, 0.18, 0.18]) {
  const c = color.slice(0, 3);
  return {
    ok: false,
    mean: c, meanLum: lum(c), sky: c, ground: c, left: c, right: c, haze: c,
    shadow: c.map((v) => v * 0.08), white: c.map((v) => Math.min(1, v * 3)),
    contrast: 1,
    lights: [],
    side: 0,
    warmth: 0,
    saturation: 0.35,
    hue: [1, 1, 1],
  };
}

/**
 * Read a backdrop.
 *
 * @param {{data: ArrayLike<number>, width: number, height: number}} img  RGBA bytes
 * @returns probe — see `neutralProbe` for the shape. `lights` holds up to three
 *   bright regions, strongest first: { x, y } in picture fractions (y down),
 *   `color` (chroma at unit luminance), `power` (how far it stands above the
 *   room, 0..1) and `size` (fraction of the picture it covers).
 */
export function probeImage(img) {
  const { data, width: w, height: h } = img ?? {};
  if (!data || !(w > 0) || !(h > 0) || data.length < w * h * 4) return neutralProbe();

  const n = w * h;
  const rgb = new Float32Array(n * 3);
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255;
    const r = LIN[data[i * 4]] * a;
    const g = LIN[data[i * 4 + 1]] * a;
    const b = LIN[data[i * 4 + 2]] * a;
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
    L[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  const band = (x0, x1, y0, y1) => {
    const acc = [0, 0, 0];
    let m = 0;
    for (let y = Math.floor(y0 * h); y < Math.ceil(y1 * h); y++) {
      for (let x = Math.floor(x0 * w); x < Math.ceil(x1 * w); x++) {
        const i = y * w + x;
        acc[0] += rgb[i * 3]; acc[1] += rgb[i * 3 + 1]; acc[2] += rgb[i * 3 + 2];
        m++;
      }
    }
    return avg(acc, m);
  };

  const mean = band(0, 1, 0, 1);
  const meanLum = lum(mean);

  // Percentiles of luminance, for the black and white points.
  const sorted = Float32Array.from(L).sort();
  const pct = (q) => sorted[Math.min(n - 1, Math.max(0, Math.floor(q * (n - 1))))];
  const median = pct(0.5);
  const p03 = pct(0.03);
  const p97 = pct(0.97);

  const pick = (pred) => {
    const acc = [0, 0, 0];
    let m = 0;
    for (let i = 0; i < n; i++) {
      if (!pred(L[i])) continue;
      acc[0] += rgb[i * 3]; acc[1] += rgb[i * 3 + 1]; acc[2] += rgb[i * 3 + 2];
      m++;
    }
    return avg(acc, m);
  };
  const shadow = pick((l) => l <= p03 + 1e-6);
  const white = pick((l) => l >= p97 - 1e-6);

  // Bright regions. A cell is "light" when it stands well above the room's
  // median; connected cells form one light. Flood fill on the small grid.
  const floor = Math.max(median * 2.2, pct(0.9), 0.02);
  const label = new Int32Array(n).fill(-1);
  const regions = [];
  for (let s = 0; s < n; s++) {
    if (label[s] !== -1 || L[s] < floor) continue;
    const id = regions.length;
    const reg = { wsum: 0, x: 0, y: 0, c: [0, 0, 0], cells: 0, peak: 0 };
    const stack = [s];
    label[s] = id;
    while (stack.length) {
      const i = stack.pop();
      const x = i % w;
      const y = (i / w) | 0;
      const wt = L[i] - floor * 0.5;
      reg.wsum += wt; reg.x += (x + 0.5) * wt; reg.y += (y + 0.5) * wt;
      reg.c[0] += rgb[i * 3] * wt; reg.c[1] += rgb[i * 3 + 1] * wt; reg.c[2] += rgb[i * 3 + 2] * wt;
      reg.cells++;
      reg.peak = Math.max(reg.peak, L[i]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (label[j] === -1 && L[j] >= floor) { label[j] = id; stack.push(j); }
      }
    }
    regions.push(reg);
  }
  const room = Math.max(median, 1e-4);
  const lights = regions
    .filter((r) => r.wsum > 0)
    .map((r) => {
      const c = [r.c[0] / r.wsum, r.c[1] / r.wsum, r.c[2] / r.wsum];
      // Power: how far above the room it stands (log ratio), weighted by size,
      // so one bright pixel is a sparkle and a whole window is a light.
      const ratio = Math.log2(Math.max(1, r.peak / room));
      const size = r.cells / n;
      return {
        x: r.x / r.wsum / w,
        y: r.y / r.wsum / h,
        color: chroma(c, 0.85),
        // A bright patch low in the picture is usually a lit surface (snow, a
        // floor under a lamp), not a light: it counts for less.
        power: Math.min(1, (ratio / 5) * Math.min(1, Math.sqrt(size * 40))) * (1 - 0.6 * smoothstep(0.5, 0.9, r.y / r.wsum / h)),
        size,
      };
    })
    .filter((l) => l.power > 0.04)
    .sort((a, b) => b.power - a.power)
    .slice(0, 3);

  // How colourful the picture is, 0 (grey) .. 1: mean of (max - min) / max in display values.
  // The room's hue: what its COLOURED paint is, weighted by how coloured and
  // how visible each pixel is. The plain mean is the wrong answer for a
  // painting — a dark wood-panelled carriage with white windows averages to a
  // grey-brown, while what the eye reads, and what the cast should take, is
  // the amber of the wood and the lamps.
  let satSum = 0;
  const hueAcc = [0, 0, 0];
  let hueW = 0;
  for (let i = 0; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const mx = Math.max(r, g, b);
    if (mx <= 8) continue;
    const sat = (mx - Math.min(r, g, b)) / mx;
    satSum += sat;
    const l = L[i];
    if (l <= 1e-5) continue;
    const w = sat * sat * Math.sqrt(mx / 255);
    hueAcc[0] += (rgb[i * 3] / l) * w; hueAcc[1] += (rgb[i * 3 + 1] / l) * w; hueAcc[2] += (rgb[i * 3 + 2] / l) * w;
    hueW += w;
  }
  const saturation = satSum / n;
  const hueRaw = hueW > 1e-6 ? [hueAcc[0] / hueW, hueAcc[1] / hueW, hueAcc[2] / hueW] : [1, 1, 1];
  const hl = lum(hueRaw);
  const hue = hl > 1e-6 ? hueRaw.map((v) => v / hl) : [1, 1, 1];

  const left = band(0, 0.4, 0, 1);
  const right = band(0.6, 1, 0, 1);
  const ll = lum(left);
  const rl = lum(right);
  // Which side of the room is brighter, -1 (left) .. 1 (right).
  const side = ll + rl > 1e-5 ? Math.max(-1, Math.min(1, (rl - ll) / (rl + ll) * 2)) : 0;

  // Warmth of the strongest light, -1 (cold) .. 1 (fire). Firelight flickers.
  const key = lights[0]?.color ?? chroma(mean);
  const warmth = Math.max(-1, Math.min(1, (key[0] - key[2]) / 1.2));

  return {
    ok: true,
    mean,
    meanLum,
    sky: band(0, 1, 0, 0.3),
    ground: band(0, 1, 0.72, 1),
    left,
    right,
    haze: band(0, 1, 0.35, 0.65),
    shadow,
    white,
    contrast: Math.max(1, (p97 + 0.002) / (p03 + 0.002)),
    lights,
    side,
    warmth,
    saturation,
    hue,
  };
}

/**
 * Rebuild a probe from a stored copy (structured-clone safe: arrays only).
 * Total, like every reader here.
 */
export function normalizeProbe(raw) {
  if (!raw || typeof raw !== "object" || raw.ok !== true) return neutralProbe();
  const col = (v, f) => (Array.isArray(v) && v.length >= 3 && v.every((x) => Number.isFinite(x)) ? v.slice(0, 3).map((x) => Math.max(0, x)) : f);
  const base = neutralProbe();
  const out = { ...base, ok: true };
  for (const k of ["mean", "sky", "ground", "left", "right", "haze", "shadow", "white"]) out[k] = col(raw[k], base[k]);
  out.meanLum = lum(out.mean);
  out.contrast = Number.isFinite(raw.contrast) ? Math.max(1, raw.contrast) : 1;
  out.side = Number.isFinite(raw.side) ? Math.max(-1, Math.min(1, raw.side)) : 0;
  out.warmth = Number.isFinite(raw.warmth) ? Math.max(-1, Math.min(1, raw.warmth)) : 0;
  out.saturation = Number.isFinite(raw.saturation) ? Math.max(0, Math.min(1, raw.saturation)) : 0.35;
  {
    const h = col(raw.hue, null);
    const hl = h ? lum(h) : 0;
    out.hue = hl > 1e-6 ? h.map((v) => v / hl) : chroma(out.mean);
  }
  out.lights = (Array.isArray(raw.lights) ? raw.lights : []).slice(0, 3).map((l) => ({
    x: Number.isFinite(l?.x) ? l.x : 0.5,
    y: Number.isFinite(l?.y) ? l.y : 0.2,
    color: col(l?.color, [1, 1, 1]),
    power: Number.isFinite(l?.power) ? Math.max(0, Math.min(1, l.power)) : 0,
    size: Number.isFinite(l?.size) ? Math.max(0, l.size) : 0,
  }));
  return out;
}
