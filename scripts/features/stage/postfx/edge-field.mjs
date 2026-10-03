/**
 * Stage character grade — the silhouette's edge field.
 *
 * Pure: no `game`, no `canvas`, no DOM, no WebGL. The check tool imports this
 * under plain Node and the browser harness compares the GPU against it.
 *
 * What it is, and why the rim needs one.
 *
 * A rim light is a band of light inside the figure's outline, on the side of the
 * outline that faces the lamp. Both halves of that sentence are statements about
 * *distance to the outline* and *which way the outline faces*, and the art's
 * alpha channel answers neither question: it says only whether a pixel is
 * covered. The old rim guessed at both by blurring the silhouette, shifting the
 * blur toward the light and subtracting — which lights wherever coverage changes
 * along the light's direction, including every soft interior gradient the blur
 * happens to reach. That is the bleed: hair, a cloak's inner folds and any
 * semi-transparent paint lit up in the middle of the figure, nowhere near an
 * edge, and no dial could turn it off because it *was* the model.
 *
 * So both questions are answered once, exactly, per asset:
 *
 *   distance   an exact euclidean distance transform of the silhouette, inward
 *              and outward. The band is a function of it, which makes the band
 *              *provably* zero past its width: a pixel deeper in than the dial
 *              is not lit, whatever the art does there.
 *   direction  the gradient of that distance field — the outline's true outward
 *              normal. Dotted with the light it gives the side facing the lamp,
 *              smoothly, with none of the scalloping a ring of taps leaves.
 *
 * The field is built on the CPU, once per asset, during `StageGL.prepare` —
 * where suspending is allowed — and uploaded as one RGBA8 texture the shader
 * reads with a single tap:
 *
 *   R, G   the outward normal, stored around NORMAL_MID
 *   B      distance inward from the outline, in units of FIELD_RANGE
 *   A      distance outward from the outline, in units of FIELD_RANGE
 *
 * All four channels are smooth near the outline, which is the only place the rim
 * reads them, so the texture's own bilinear filter is the right filter and half
 * resolution is plenty — see FIELD_SCALE.
 */

/**
 * The largest distance the field records, in units of the art's **height**.
 * Past it both distances saturate, which is harmless: the rim's width dial is
 * measured in the same units and cannot exceed it, so a saturated texel is
 * always outside the band.
 *
 * It is also the quantisation: one 8-bit step is FIELD_RANGE / 255 of the art's
 * height, about a third of a pixel on a 1280-tall render. A band is tens of
 * pixels wide, so that is far finer than anything the rim can show.
 */
export const FIELD_RANGE = 0.06;

/**
 * The field's resolution, as a fraction of the art's.
 *
 * A distance field is smooth by construction — it changes by at most one unit
 * per unit of distance — so halving its resolution costs it nothing a band tens
 * of pixels wide could show, and saves three quarters of both the transform's
 * work and the texture's memory. (The art texture is already the larger of the
 * two VRAM costs; this keeps the field from doubling it.)
 */
export const FIELD_SCALE = 0.5;

/** Coverage at or above this is inside the figure. */
export const ALPHA_THRESHOLD = 0.5;

/**
 * The code the normal's two signed channels are stored around, and the scale
 * either side of it.
 *
 * 127 and 127, not the obvious `g * 0.5 + 0.5`: an 8-bit channel has 256 codes
 * and therefore no centre, so that mapping has no code for zero — it rounds to
 * 128, which decodes to +1/255. An outline whose normal is exactly
 * perpendicular to the light then faces it by four thousandths, and "an edge
 * facing away from the lamp is never lit" becomes "almost never". The amount of
 * light involved cannot move a byte; the difference between an exact rule and a
 * nearly exact one can, because the nearly exact one stops being checkable.
 * Spending one of the 256 codes makes zero exact.
 */
export const NORMAL_MID = 127;
export const NORMAL_SCALE = 127;

/** A distance no edge can be at. Finite on purpose: the transform divides by
 *  differences of these, and Infinity - Infinity is NaN. */
const INF = 1e20;

/** The field's own dimensions for art of `width` x `height`. */
export function fieldSize(width, height) {
  return [
    Math.max(1, Math.round(Math.max(width, 1) * FIELD_SCALE)),
    Math.max(1, Math.round(Math.max(height, 1) * FIELD_SCALE)),
  ];
}

/**
 * Felzenszwalb and Huttenlocher's exact distance transform of a 1D sampled
 * function. Writes squared distances into `d`.
 *
 * Exact rather than a chamfer approximation because the rim's direction is the
 * *gradient* of the result: a chamfer transform's error is anisotropic — largest
 * along the diagonals — so its gradient carries a bias, which shows up as a rim
 * a little brighter on four diagonal arcs of every curve. An exact transform has
 * no preferred direction.
 */
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = 0;
    // Pop the parabolas this one hides, then push it.
    for (;;) {
      const vk = v[k];
      s = (f[q] + q * q - (f[vk] + vk * vk)) / (2 * q - 2 * vk);
      if (k > 0 && s <= z[k]) k--;
      else break;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/**
 * The exact euclidean distance transform of a sampled function: for every cell,
 * `min over j of sqrt(|i − j|² + cost[j])`. Rows then columns, which is exact
 * for the squared euclidean metric.
 *
 * `cost` is squared distances, which is what lets a seed sit *between* cells:
 * a seed at 0 is a cell the outline runs through, and a seed at t² is one it
 * passes t away from. INF is "not a seed".
 *
 * @param {Float64Array} cost  Squared seed distances, INF where there is none.
 */
export function distanceTransform(cost, w, h) {
  const sq = Float64Array.from(cost);

  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = sq[row + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) sq[row + x] = d[x];
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = sq[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) sq[y * w + x] = d[y];
  }

  const out = new Float64Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(sq[i]);
  return out;
}

/** The least coverage gradient a cell straddling the outline is credited with.
 *  A correctly sampled coverage field ramps by about 1 across the edge; a mask
 *  with no antialiasing at all reports half that through a central difference,
 *  and without a floor its sub-pixel offset would come out twice too far. */
const EDGE_GRAD_MIN = 0.5;

/**
 * The signed distance to the outline, in cells: negative inside, positive
 * outside, zero on the outline itself.
 *
 * Seeded at **sub-pixel** positions, which is the difference between a rim that
 * fades out cleanly and one that fades out in dashes.
 *
 * Thresholding coverage at 0.5 and transforming the result would put every seed
 * at a cell centre, so the field outside the figure is the lower envelope of a
 * cone around each of them. Its value is then wrong by up to half a cell, in a
 * pattern that repeats along the outline — once per cell the outline steps down
 * — and a half-cell ripple with a period of a few cells has a *gradient* of
 * several tenths. That is the direction the rim lights from. Near the light's
 * terminator, where a tenth of direction is the difference between lit and
 * unlit, it draws the fading rim as a row of detached dashes. Smoothing cannot
 * reach it: the ripple's period grows with how shallow the outline is, so the
 * blur that would remove it on a shoulder is wide enough to erase a finger.
 *
 * Coverage already carries the answer. A cell whose neighbour is on the other
 * side of the threshold is a cell the outline passes through, and how far from
 * its centre it passes is `(coverage − ½) / |∇coverage|`. Seeding each of those
 * cells with that distance — the transform takes a sampled function, not just a
 * set, so this costs nothing but the seeding — lets the field start from where
 * the outline really is rather than from the nearest cell centre. The half-cell
 * correction the binary version needed is then exactly what falls out of a
 * hard-edged mask, and anti-aliased art does better still.
 */
export function signedDistance(alpha, w, h) {
  const at = (x, y) => alpha[Math.min(Math.max(y, 0), h - 1) * w + Math.min(Math.max(x, 0), w - 1)] ?? 0;
  const seeds = new Float64Array(w * h).fill(INF);
  const inside = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = alpha[i] ?? 0;
      const on = a >= ALPHA_THRESHOLD;
      inside[i] = on ? 1 : 0;
      const crosses =
        (at(x - 1, y) >= ALPHA_THRESHOLD) !== on ||
        (at(x + 1, y) >= ALPHA_THRESHOLD) !== on ||
        (at(x, y - 1) >= ALPHA_THRESHOLD) !== on ||
        (at(x, y + 1) >= ALPHA_THRESHOLD) !== on;
      if (!crosses) continue;
      const gx = (at(x + 1, y) - at(x - 1, y)) * 0.5;
      const gy = (at(x, y + 1) - at(x, y - 1)) * 0.5;
      const g = Math.max(Math.hypot(gx, gy), EDGE_GRAD_MIN);
      const t = Math.min(Math.abs(a - ALPHA_THRESHOLD) / g, 1);
      seeds[i] = t * t;
    }
  }

  // One transform of that sampled function: the distance from every cell to the
  // nearest point of the outline, rather than to the nearest cell it runs
  // through. Signed by which side of the threshold the cell is on.
  const d = distanceTransform(seeds, w, h);
  const signed = new Float64Array(w * h);
  for (let i = 0; i < signed.length; i++) signed[i] = inside[i] ? -d[i] : d[i];
  return signed;
}

/**
 * Smoothing passes over the signed field before anything is read off it, with
 * the binomial kernel below. Four passes is a Gaussian of 2 cells.
 *
 * The second half of the fix {@link signedDistance} describes, and it has to be
 * the second half. Sub-pixel seeding takes most of the ripple out of the
 * direction the rim lights from, but not all: the transform still composes a
 * seed's own offset with a whole number of cells travelled, which is only exact
 * when the two are perpendicular. What is left is small enough for a blur to
 * finish. A blur alone could not have done it — the unseeded ripple's period
 * grows with how shallow the outline is, so the blur that would flatten it on a
 * shoulder is wider than the features it is meant to be protecting.
 *
 * Blurring a distance field is close to free of distortion, which is what makes
 * it safe here rather than a smudge: the field is locally linear, and a blur
 * leaves a linear function exactly where it was. It only moves the zero
 * crossing where the outline curves, by about σ²κ/2 — two cells of smoothing on
 * a head-sized curve is a twentieth of a cell.
 */
export const SMOOTH_PASSES = 4;

/** The smoothing kernel, separable, normalised by its own sum. */
const SMOOTH_KERNEL = Object.freeze([1, 4, 6, 4, 1]);

/** One separable pass of SMOOTH_KERNEL over a float field, edges clamped. */
function smoothPass(src, w, h) {
  const k = SMOOTH_KERNEL;
  const r = (k.length - 1) / 2;
  const sum = k.reduce((a, b) => a + b, 0);
  const mid = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += src[y * w + Math.min(Math.max(x + i, 0), w - 1)] * k[i + r];
      mid[y * w + x] = acc / sum;
    }
  }
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += mid[Math.min(Math.max(y + i, 0), h - 1) * w + x] * k[i + r];
      out[y * w + x] = acc / sum;
    }
  }
  return out;
}

/**
 * The edge field of a silhouette.
 *
 * @param {Float32Array|number[]} alpha  Coverage 0..1, row-major, w x h.
 * @param {number} w  The field's width, in field pixels.
 * @param {number} h  The field's height, in field pixels.
 * @returns {{width:number, height:number, bytes:Uint8Array}} RGBA8, as the
 *          header describes it: the normal in RG, inward distance in B,
 *          outward in A.
 */
export function buildEdgeField(alpha, w, h) {
  let signed = signedDistance(alpha, w, h);
  for (let i = 0; i < SMOOTH_PASSES; i++) signed = smoothPass(signed, w, h);

  // Distances are recorded in units of the art's height, which is what the
  // rim's dials are in — so the band is the same depth down the side of a tall
  // portrait as across the top of it, without the shader knowing the aspect.
  const perPixel = 1 / h / FIELD_RANGE;
  const bytes = new Uint8Array(w * h * 4);
  const at = (x, y) => signed[Math.min(Math.max(y, 0), h - 1) * w + Math.min(Math.max(x, 0), w - 1)];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // Central differences on the smoothed, *unclamped* signed field.
      // Unclamped so the normal is a true unit vector right up to the outline;
      // clamping first would put a flat region a few pixels in and a crease at
      // its boundary. Smoothed for the reason SMOOTH_PASSES gives.
      let gx = (at(x + 1, y) - at(x - 1, y)) * 0.5;
      let gy = (at(x, y + 1) - at(x, y - 1)) * 0.5;
      // Zero in exactly two places, and both are correct. On the medial axis
      // the nearest outline is in two directions at once and they cancel. And
      // in a raster with no outline at all — art with no transparency, the
      // ordinary rectangular portrait — the field is constant, so there is no
      // gradient and the rim lights nothing, which is the honest answer: the
      // only edges such a picture has are the ones its own frame cut.
      const len = Math.hypot(gx, gy);
      if (len > 1e-6) {
        gx /= len;
        gy /= len;
      } else {
        gx = 0;
        gy = 0;
      }
      const d = signed[i];
      const p = i * 4;
      bytes[p] = NORMAL_MID + Math.round(gx * NORMAL_SCALE);
      bytes[p + 1] = NORMAL_MID + Math.round(gy * NORMAL_SCALE);
      bytes[p + 2] = Math.round(Math.min(Math.max(-d * perPixel, 0), 1) * 255);
      bytes[p + 3] = Math.round(Math.min(Math.max(d * perPixel, 0), 1) * 255);
    }
  }
  return { width: w, height: h, bytes };
}

/**
 * Box-average the alpha channel of RGBA pixel data down to the field's size.
 *
 * Averaged rather than point-sampled: a one-pixel lace hole or a hair strand a
 * point sample drops is an edge the field would not know about, and the rim
 * would run straight across it.
 */
export function alphaForField(data, W, H, w, h) {
  const out = new Float32Array(w * h);
  const sx = W / w;
  const sy = H / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.min(Math.floor(y * sy), H - 1);
    const y1 = Math.max(y0 + 1, Math.min(H, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.min(Math.floor(x * sx), W - 1);
      const x1 = Math.max(x0 + 1, Math.min(W, Math.ceil((x + 1) * sx)));
      let sum = 0;
      let n = 0;
      for (let j = y0; j < y1; j++) {
        for (let i = x0; i < x1; i++) {
          sum += data[(j * W + i) * 4 + 3];
          n++;
        }
      }
      out[y * w + x] = n ? sum / n / 255 : 0;
    }
  }
  return out;
}

/** The whole field from the art's RGBA pixel data. */
export function edgeFieldFrom(data, W, H) {
  const [w, h] = fieldSize(W, H);
  return buildEdgeField(alphaForField(data, W, H, w, h), w, h);
}

/**
 * Sample the field, decoded.
 *
 * Bilinear between texel centres and clamped at the edges — exactly what a
 * GL_LINEAR / CLAMP_TO_EDGE texture does, so the reference and the shader read
 * the same numbers out of the same bytes.
 *
 * Interpolated in the byte domain and decoded afterwards, which is what keeps
 * NORMAL_MID's exact zero exact: four corners of 127 interpolate to 127 for any
 * weights, and 127 decodes to 0 and not to a rounding of it.
 *
 * @returns {[number, number, number, number]} `[nx, ny, inward, outward]`: the
 *          normal in -1..1, both distances in units of FIELD_RANGE.
 */
export function sampleEdgeField(field, u, v) {
  const { width: W, height: H, bytes } = field;
  const tx = Math.min(Math.max(u * W - 0.5, 0), W - 1);
  const ty = Math.min(Math.max(v * H - 0.5, 0), H - 1);
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const x1 = Math.min(x0 + 1, W - 1);
  const y1 = Math.min(y0 + 1, H - 1);
  const fx = tx - x0;
  const fy = ty - y0;
  const out = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const a = bytes[(y0 * W + x0) * 4 + k];
    const b = bytes[(y0 * W + x1) * 4 + k];
    const c = bytes[(y1 * W + x0) * 4 + k];
    const d = bytes[(y1 * W + x1) * 4 + k];
    out[k] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  return [(out[0] - NORMAL_MID) / NORMAL_SCALE, (out[1] - NORMAL_MID) / NORMAL_SCALE, out[2] / 255, out[3] / 255];
}
