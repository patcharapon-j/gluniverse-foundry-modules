/**
 * Stage light — the shape of a piece of art.
 *
 * Pure. A character portrait is a flat painting with a silhouette. The
 * silhouette is enough to light it as if it had a body: blur the alpha and the
 * blurred edge slopes the way the figure's surface would turn away from the
 * camera, so its gradient is a normal; blur it wider and the dips are the
 * places a body occludes itself (between arm and torso, under the chin). That
 * is a stylized relight, not a physical one, and it is the right kind for
 * painted art: it adds the light of the room without fighting the light the
 * artist already painted.
 *
 * Computed once per art on a small grid with the art padded on every side, so
 * the blurs run past the outline (the halo and the cast shadow live there).
 *
 *   R  alpha blurred at EDGE   — edge normals, rim width, the halo
 *   G  alpha blurred at BODY   — roundness, ambient occlusion
 *   B  alpha blurred at SOFT   — the cast shadow's footprint
 *   A  the alpha itself, at grid resolution
 */

/** Padding on each side, as a fraction of the art's own width/height. */
export const SHAPE_PAD = 0.12;
/** Grid height for the art itself (the padded grid is taller). */
export const SHAPE_H = 160;
/** Blur radii, as fractions of the art's height. */
export const EDGE_R = 0.018;
export const BODY_R = 0.07;
export const SOFT_R = 0.035;

/** Grid size for an art of the given aspect (w / h). */
export function shapeGrid(aspect) {
  const ah = SHAPE_H;
  const aw = Math.max(8, Math.round(ah * Math.max(0.1, Math.min(4, aspect || 0.66))));
  const pw = Math.round(aw * SHAPE_PAD);
  const ph = Math.round(ah * SHAPE_PAD);
  return { w: aw + pw * 2, h: ah + ph * 2, artW: aw, artH: ah, padX: pw, padY: ph };
}

/** One box-blur pass along a line, radius r, in place via scratch. */
function boxLine(src, dst, n, stride, offset, r) {
  if (r < 1) {
    for (let i = 0; i < n; i++) dst[offset + i * stride] = src[offset + i * stride];
    return;
  }
  const inv = 1 / (2 * r + 1);
  let acc = 0;
  for (let i = -r; i <= r; i++) acc += src[offset + Math.min(n - 1, Math.max(0, i)) * stride];
  for (let i = 0; i < n; i++) {
    dst[offset + i * stride] = acc * inv;
    const add = Math.min(n - 1, i + r + 1);
    const sub = Math.max(0, i - r);
    acc += src[offset + add * stride] - src[offset + sub * stride];
  }
}

/** Approximate Gaussian: three box passes each way. */
export function blur(field, w, h, radius) {
  const r = Math.max(0, Math.round(radius / 1.73));
  let a = Float32Array.from(field);
  let b = new Float32Array(field.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) boxLine(a, b, w, 1, y * w, r);
    [a, b] = [b, a];
    for (let x = 0; x < w; x++) boxLine(a, b, h, w, x, r);
    [a, b] = [b, a];
  }
  return a;
}

/** Edges of the art (inside the padding) whose row/column is this covered count as cut. */
export const CUT_COVER = 0.04;

/**
 * A copy of the alpha with every edge the art is cut by extended through the
 * padding (each padding cell takes the alpha of the nearest art cell on that
 * edge). Edges the art does not touch are left alone.
 */
export function continueEdges(alpha, w, h, grid) {
  const out = Float32Array.from(alpha);
  const { padX: px, padY: py, artW: aw, artH: ah } = grid;
  const x0 = px, x1 = px + aw - 1, y0 = py, y1 = py + ah - 1;
  const cover = (get, n) => { let c = 0; for (let i = 0; i < n; i++) c += get(i) > 0.5 ? 1 : 0; return c / n; };
  const bottom = cover((i) => alpha[y1 * w + x0 + i], aw) > CUT_COVER;
  const top = cover((i) => alpha[y0 * w + x0 + i], aw) > CUT_COVER;
  const left = cover((i) => alpha[(y0 + i) * w + x0], ah) > CUT_COVER;
  const right = cover((i) => alpha[(y0 + i) * w + x1], ah) > CUT_COVER;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inX = x >= x0 && x <= x1;
      const inY = y >= y0 && y <= y1;
      if (inX && inY) continue;
      const cx = Math.min(x1, Math.max(x0, x));
      const cy = Math.min(y1, Math.max(y0, y));
      const pass = (y > y1 ? bottom : y < y0 ? top : true) && (x > x1 ? right : x < x0 ? left : true);
      if (pass) out[y * w + x] = alpha[cy * w + cx];
    }
  }
  return out;
}

/**
 * Build the shape field.
 *
 * @param {{data: ArrayLike<number>, width: number, height: number}} padded
 *   RGBA bytes of the art drawn into the padded grid from `shapeGrid`
 * @param {{padX:number, padY:number, artW:number, artH:number}} grid
 * @returns {{ data: Uint8Array, width: number, height: number, bounds: object, head: object, coverage: number }}
 */
export function buildShape(padded, grid) {
  const { data, width: w, height: h } = padded;
  const n = w * h;
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) alpha[i] = data[i * 4 + 3] / 255;

  // Art cropped by its own frame (a figure cut at the knees) does not end
  // there: the body goes on out of the picture. Where the art touches an edge,
  // carry it on into the padding before blurring, or the cut gets an outline
  // of rim light and a band of occlusion that no body would have.
  const solid = continueEdges(alpha, w, h, grid);
  const edge = blur(solid, w, h, EDGE_R * grid.artH);
  const body = blur(solid, w, h, BODY_R * grid.artH);
  const soft = blur(alpha, w, h, SOFT_R * grid.artH);

  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = Math.round(edge[i] * 255);
    out[i * 4 + 1] = Math.round(body[i] * 255);
    out[i * 4 + 2] = Math.round(soft[i] * 255);
    out[i * 4 + 3] = Math.round(alpha[i] * 255);
  }

  // Opaque bounds in ART fractions (0..1 over the unpadded art), and a guess at
  // the head for when the face locator has nothing: the top of the figure,
  // centred on the upper body's mass.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, cover = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] < 0.5) continue;
      cover++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  const toArtX = (x) => (x - grid.padX) / grid.artW;
  const toArtY = (y) => (y - grid.padY) / grid.artH;
  let bounds = { x0: 0, y0: 0, x1: 1, y1: 1 };
  let head = { x: 0.5, y: 0.14, h: 0.16 };
  if (cover > 0) {
    bounds = { x0: toArtX(x0), y0: toArtY(y0), x1: toArtX(x1 + 1), y1: toArtY(y1 + 1) };
    const fh = bounds.y1 - bounds.y0;
    // Mass of the top eighth of the figure → head centre.
    const yHead1 = y0 + Math.max(2, Math.round((y1 - y0) * 0.13));
    let sx = 0, m = 0;
    for (let y = y0; y <= yHead1; y++) for (let x = x0; x <= x1; x++) {
      const a = alpha[y * w + x];
      sx += x * a; m += a;
    }
    head = {
      x: m > 0 ? toArtX(sx / m + 0.5) : (bounds.x0 + bounds.x1) / 2,
      y: bounds.y0 + fh * 0.075,
      h: Math.max(0.05, fh * 0.13),
    };
  }
  return { data: out, width: w, height: h, bounds, head, coverage: cover / n };
}
