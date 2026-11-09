/**
 * Diorama — standee art: loading, the die-cut card, the head plate.
 *
 * Everything here runs in a browser only (it draws on 2D canvases), but nothing
 * runs at import, so the module loads under Node.
 *
 * Art is loaded once per URL (the card made from it is per URL and marks, in
 * render/standees.mjs). A WebGL upload of a tainted canvas throws a
 * SecurityError inside the render, so every image is drawn on a scratch canvas
 * and read back first: a tainted or failed image falls back to a plain card
 * with a silhouette, never to an exception.
 */

import { PALETTE, mix, withAlpha } from "../../../core/theme.mjs";

/** Card texture height, px. */
const CARD_PX = 512;
/**
 * Transparent border around the art, as a fraction of the card height. The
 * outline is drawn by the card shader in screen pixels (CARD_FRAG), so the
 * texture carries the bare art and only enough clear texels that the edge
 * samples (and the smaller mip levels) read as empty.
 */
const PAD = 0.016;

const hasDom = () => typeof document !== "undefined" && typeof Image !== "undefined";

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** True when the canvas can be read back (and so uploaded to WebGL). */
export function readable(c) {
  try {
    c.getContext("2d").getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

const VIDEO_RE = /\.(webm|mp4|m4v|ogv)(\?|#|$)/i;

/** @type {Map<string, Promise<HTMLImageElement|HTMLCanvasElement|null>>} */
const imageCache = new Map();

/**
 * Load an image (or the first frame of a video) once per URL. Resolves to a
 * drawable that is NOT tainted, or null.
 */
export function loadDrawable(url) {
  if (!url || !hasDom()) return Promise.resolve(null);
  const key = String(url);
  let p = imageCache.get(key);
  if (p) return p;
  p = (VIDEO_RE.test(key) ? loadVideoFrame(key) : loadImage(key)).then((img) => {
    if (!img) return null;
    const w = img.naturalWidth || img.videoWidth || img.width;
    const h = img.naturalHeight || img.videoHeight || img.height;
    if (!w || !h) return null;
    const scale = Math.min(1, 1024 / Math.max(w, h));
    const c = canvas(w * scale, h * scale);
    try { c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); } catch { return null; }
    return readable(c) ? c : null;
  }).catch(() => null);
  imageCache.set(key, p);
  return p;
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    if (!/^(data|blob):/i.test(src)) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function loadVideoFrame(src) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.preload = "auto";
    const done = (ok) => { v.onloadeddata = v.onerror = v.onseeked = null; resolve(ok ? v : null); };
    v.onloadeddata = () => { try { v.currentTime = 0.01; } catch { done(true); } };
    v.onseeked = () => done(true);
    v.onerror = () => done(false);
    v.src = src;
  });
}

/** Bounding box of pixels with alpha above a threshold. */
function opaqueBounds(c) {
  const ctx = c.getContext("2d");
  const { width: w, height: h } = c;
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** The generic figure drawn on a card whose art could not be used. */
function fallbackFigure(name) {
  const c = canvas(300, 460);
  const g = c.getContext("2d");
  const body = mix(PALETTE.textDim, PALETTE.ink3, 0.35);
  g.fillStyle = body;
  g.beginPath(); g.arc(150, 92, 70, 0, Math.PI * 2); g.fill();
  g.beginPath();
  g.moveTo(40, 460); g.lineTo(62, 250);
  g.quadraticCurveTo(150, 168, 238, 250);
  g.lineTo(260, 460); g.closePath(); g.fill();
  const letter = String(name ?? "").trim().charAt(0).toUpperCase();
  if (letter) {
    g.fillStyle = withAlpha(PALETTE.text, 0.85);
    g.font = "700 120px Oxanium, system-ui, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(letter, 150, 330);
  }
  return c;
}

/**
 * Where the art's opaque pixels start and end, as fractions 0..1 of its height
 * (the lines an unmarked standee is sized by), or null when nothing is opaque.
 * @param {HTMLCanvasElement} c  a readable drawable
 */
export function artBounds(c) {
  const b = c && c.height ? opaqueBounds(c) : null;
  return b ? { top: b.y / c.height, bottom: (b.y + b.h) / c.height } : null;
}

/**
 * The part of marked art that goes on the card, in source px: everything above
 * the feet line (art below it is cut off), trimmed of clear columns and of clear
 * rows above both the art and the head line. Null when the marks cannot be used.
 * @returns {{x:number, y:number, w:number, h:number, top:number}|null}  top: the head line, px from y
 */
function markedCrop(src, marks) {
  const H0 = src.height;
  const foot = Math.round(marks.bottom * H0);
  const head = Math.round(marks.top * H0);
  if (foot - head < 2 || foot > H0) return null;
  const above = canvas(src.width, foot);
  above.getContext("2d").drawImage(src, 0, 0, src.width, foot, 0, 0, src.width, foot);
  const b = opaqueBounds(above);
  if (!b) return null;
  const y = Math.min(b.y, head);
  return { x: b.x, y, w: b.w, h: foot - y, top: head - y };
}

/**
 * Compose the card: the art, trimmed to its opaque bounds, on a clear border.
 *
 * With marks (`{top, bottom}`, fractions of the art's height: the top of the
 * head and the soles of the feet), the art below the feet line is cut off, so
 * the feet line is the card's art bottom, and the card reports `figure`, the
 * fraction of its height from the feet line to the head line, and `foot`, the
 * feet line's height above the card's bottom edge (the clear border). The
 * standee sizes the card so `figure` is the creature's height and lowers it by
 * `foot`, so the feet stand on the base; art above the head line (a raised
 * sword, a hat) draws above the height. Without marks (or on the fallback
 * figure) the card is exactly what it always was, and both are absent.
 * @param {HTMLCanvasElement|null} art  a readable drawable, or null for the fallback
 * @param {string} [name]
 * @param {{top:number, bottom:number}|null} [marks]
 * @returns {{canvas:HTMLCanvasElement, aspect:number, mask:{w:number,h:number,data:Uint8Array}, fallback:boolean,
 *   figure?:number, foot?:number}}
 */
export function composeCard(art, name, marks = null) {
  const fallback = !art;
  let src = art ?? fallbackFigure(name);
  const crop = !fallback && marks ? markedCrop(src, marks) : null;
  let headPx = 0;
  if (crop) {
    const c = canvas(crop.w, crop.h);
    c.getContext("2d").drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    src = c;
    headPx = crop.top;
  } else {
    // Trim transparent padding so the feet sit on the base.
    const b = opaqueBounds(src);
    if (b && (b.w < src.width || b.h < src.height)) {
      const c = canvas(b.w, b.h);
      c.getContext("2d").drawImage(src, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
      src = c;
    }
  }
  const H = CARD_PX;
  const pad = Math.max(4, Math.round(H * PAD));
  const artH = H - pad * 2;
  const artW = Math.max(8, Math.round((src.width / src.height) * artH));
  const W = artW + pad * 2;
  const out = canvas(W, H);
  const g = out.getContext("2d");
  g.drawImage(src, pad, pad, artW, artH);
  const marked = crop ? { figure: ((src.height - headPx) / src.height) * (artH / H), foot: pad / H } : {};
  // A coarse alpha mask for picking.
  const mw = 48, mh = Math.max(8, Math.round((48 * H) / W));
  const m = canvas(mw, mh);
  const mg = m.getContext("2d");
  mg.drawImage(out, 0, 0, mw, mh);
  const md = mg.getImageData(0, 0, mw, mh).data;
  const data = new Uint8Array(mw * mh);
  for (let i = 0; i < data.length; i++) data[i] = md[i * 4 + 3];
  return { canvas: out, aspect: W / H, mask: { w: mw, h: mh, data }, fallback, ...marked };
}

/** True when uv (0..1, v up) lands on the card's paper. */
export function maskHit(mask, u, v) {
  if (!mask) return true;
  const x = Math.min(mask.w - 1, Math.max(0, Math.floor(u * mask.w)));
  const y = Math.min(mask.h - 1, Math.max(0, Math.floor((1 - v) * mask.h)));
  return mask.data[y * mask.w + x] > 100;
}

/* ---------------------------------------------------------------- head plate */

const PLATE_W = 256;
const ICON = 40;
const GAP = 6;
/** One target mark's square, px of the plate canvas (PLATE_W wide). */
export const MARK = 58;
/** Marks drawn in a row before the rest fold into a "+N" chip. */
export const MARKS_MAX = 4;

/**
 * Lay out and draw the plate above a standee's head: one target mark per user
 * targeting it, in that user's colour, then condition icons with value badges.
 * The marks lead because "who is aiming at this" is the fact a table looks for
 * first; a token's bars are the 2D canvas's own, drawn by the view
 * (view/bar-layer.mjs), never here. Icons that have not loaded yet are drawn as
 * an empty tile; the caller redraws once they arrive.
 * @param {HTMLCanvasElement|null} into  reused when given
 * @param {{targets:string[], conditions:{icon:string,value?:any}[]}} s
 * @param {(url:string) => (HTMLCanvasElement|null|undefined)} icon  sync lookup
 * @returns {{canvas:HTMLCanvasElement, height:number}|null}  null when empty
 */
export function drawPlate(into, s, icon) {
  const targets = (s.targets ?? []).filter(Boolean);
  const conditions = (s.conditions ?? []).filter((c) => c && c.icon).slice(0, 10);
  if (!targets.length && !conditions.length) return null;
  const perRow = Math.floor((PLATE_W + GAP) / (ICON + GAP));
  const condRows = Math.ceil(conditions.length / perRow);
  let h = 0;
  if (targets.length) h += MARK + GAP;
  h += condRows * (ICON + GAP);
  h = Math.max(8, h + 4);
  const c = into ?? canvas(PLATE_W, h);
  c.width = PLATE_W;
  c.height = Math.ceil(h);
  const g = c.getContext("2d");
  g.clearRect(0, 0, c.width, c.height);
  let y = 0;
  if (targets.length) {
    const over = targets.length > MARKS_MAX ? targets.length - (MARKS_MAX - 1) : 0;
    const shown = over ? targets.slice(0, MARKS_MAX - 1) : targets;
    const n = shown.length + (over ? 1 : 0);
    let x = (PLATE_W - (n * MARK + (n - 1) * GAP)) / 2;
    for (const col of shown) { targetMark(g, x, y, MARK, col); x += MARK + GAP; }
    if (over) moreChip(g, x, y, MARK, over);
    y += MARK + GAP;
  }
  for (let r = 0; r < condRows; r++) {
    const row = conditions.slice(r * perRow, (r + 1) * perRow);
    const w = row.length * (ICON + GAP) - GAP;
    let x = (PLATE_W - w) / 2;
    for (const cond of row) {
      g.fillStyle = withAlpha(PALETTE.ink1, 0.82);
      round(g, x, y, ICON, ICON, 8); g.fill();
      g.strokeStyle = withAlpha(PALETTE.text, 0.28); g.lineWidth = 1.5;
      round(g, x + 0.75, y + 0.75, ICON - 1.5, ICON - 1.5, 7.5); g.stroke();
      const img = icon(cond.icon);
      if (img) { try { g.drawImage(img, x + 5, y + 5, ICON - 10, ICON - 10); } catch { /* drawn later */ } }
      const v = cond.value;
      if (v !== undefined && v !== null && v !== "" && v !== false) {
        const txt = String(v).slice(0, 3);
        g.font = "700 15px Oxanium, system-ui, sans-serif";
        const bw = Math.max(18, g.measureText(txt).width + 8);
        const bx = x + ICON - bw + 4, by = y + ICON - 14;
        g.fillStyle = PALETTE.ink0;
        round(g, bx, by, bw, 18, 9); g.fill();
        g.strokeStyle = PALETTE.signal; g.lineWidth = 1.5; g.stroke();
        g.fillStyle = PALETTE.textBright;
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(txt, bx + bw / 2, by + 9.5);
      }
      x += ICON + GAP;
    }
    y += ICON + GAP;
  }
  return { canvas: c, height: c.height };
}

/**
 * One target mark in a user's colour: a ring crossed by four sight ticks and a
 * centre dot, cut on an ink disc and edged in ink, so the colour reads on pale
 * stone and dark earth alike.
 */
function targetMark(g, x, y, m, color) {
  const cx = x + m / 2, cy = y + m / 2;
  g.fillStyle = withAlpha(PALETTE.ink0, 0.72);
  g.beginPath(); g.arc(cx, cy, m * 0.5, 0, Math.PI * 2); g.fill();
  const ring = m * 0.3, tick0 = m * 0.12, tick1 = m * 0.45;
  const path = () => {
    g.beginPath();
    g.arc(cx, cy, ring, 0, Math.PI * 2);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      g.moveTo(cx + dx * tick0, cy + dy * tick0);
      g.lineTo(cx + dx * tick1, cy + dy * tick1);
    }
  };
  g.lineCap = "round";
  path(); g.strokeStyle = PALETTE.ink0; g.lineWidth = m * 0.16; g.stroke();
  path(); g.strokeStyle = color || PALETTE.signal; g.lineWidth = m * 0.085; g.stroke();
  g.beginPath(); g.arc(cx, cy, m * 0.065, 0, Math.PI * 2);
  g.fillStyle = color || PALETTE.signal; g.fill();
  g.lineWidth = m * 0.04; g.strokeStyle = PALETTE.ink0; g.stroke();
}

/** "+N": more users aim here than the row has marks for. */
function moreChip(g, x, y, m, n) {
  const cx = x + m / 2, cy = y + m / 2;
  g.fillStyle = withAlpha(PALETTE.ink0, 0.82);
  g.beginPath(); g.arc(cx, cy, m * 0.5, 0, Math.PI * 2); g.fill();
  g.strokeStyle = withAlpha(PALETTE.text, 0.5); g.lineWidth = 2;
  g.beginPath(); g.arc(cx, cy, m * 0.5 - 2, 0, Math.PI * 2); g.stroke();
  g.fillStyle = PALETTE.textBright;
  g.font = `700 ${Math.round(m * 0.36)}px Oxanium, system-ui, sans-serif`;
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(`+${n}`, cx, cy + 1);
}

/* ---------------------------------------------------------------- effect halo */

/** One halo chip's square in the atlas, px. */
export const CHIP_PX = 64;
/** Most chips a halo draws. */
export const HALO_MAX = 12;

/**
 * Draw the effect-halo chips into one atlas row, slot i = condition i: a dark
 * disc with a thin rim, the icon clipped round, the value in a corner pip.
 * Icons that have not loaded yet leave the disc empty; the caller redraws.
 * @param {HTMLCanvasElement|null} into  reused when given
 * @param {{icon:string,value?:any}[]} conditions
 * @param {(url:string) => (HTMLCanvasElement|null|undefined)} icon
 * @returns {{canvas:HTMLCanvasElement, count:number}}
 */
export function drawChips(into, conditions, icon) {
  const list = (conditions ?? []).filter((c) => c && c.icon).slice(0, HALO_MAX);
  const c = into ?? canvas(CHIP_PX * HALO_MAX, CHIP_PX);
  if (c.width !== CHIP_PX * HALO_MAX) c.width = CHIP_PX * HALO_MAX;
  if (c.height !== CHIP_PX) c.height = CHIP_PX;
  const g = c.getContext("2d");
  g.clearRect(0, 0, c.width, c.height);
  const R = CHIP_PX / 2 - 6;
  list.forEach((cond, i) => {
    const cx = i * CHIP_PX + CHIP_PX / 2, cy = CHIP_PX / 2 - 1;
    g.fillStyle = withAlpha(PALETTE.ink0, 0.5);
    disc(g, cx, cy + 2, R + 1.5); g.fill();
    g.fillStyle = withAlpha(PALETTE.ink1, 0.94);
    disc(g, cx, cy, R); g.fill();
    const img = icon(cond.icon);
    if (img) {
      g.save();
      disc(g, cx, cy, R - 3); g.clip();
      const s = (R - 5) * 2;
      try { g.drawImage(img, cx - s / 2, cy - s / 2, s, s); } catch { /* drawn later */ }
      g.restore();
    }
    g.strokeStyle = withAlpha(PALETTE.text, 0.5); g.lineWidth = 2;
    disc(g, cx, cy, R - 1); g.stroke();
    const v = cond.value;
    if (v !== undefined && v !== null && v !== "" && v !== false) {
      const txt = String(v).slice(0, 2);
      const pr = 10.5, px = cx + R - 6, py = cy + R - 6;
      g.fillStyle = PALETTE.ink0;
      disc(g, px, py, pr); g.fill();
      g.strokeStyle = PALETTE.signal; g.lineWidth = 2; g.stroke();
      g.fillStyle = PALETTE.textBright;
      g.font = "700 14px Oxanium, system-ui, sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(txt, px, py + 1);
    }
  });
  return { canvas: c, count: list.length };
}

function disc(g, x, y, r) {
  g.beginPath();
  g.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2);
  g.closePath();
}

function round(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Plate width in px (for world sizing). */
export const PLATE_PX = PLATE_W;

/** A soft radial contact shadow. */
export function shadowCanvas() {
  if (!hasDom()) return null;
  const c = canvas(128, 128);
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, withAlpha(PALETTE.ink0, 0.7));
  grad.addColorStop(0.55, withAlpha(PALETTE.ink0, 0.35));
  grad.addColorStop(1, withAlpha(PALETTE.ink0, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return c;
}

/**
 * The wide, soft half of a raised figure's shadow: no core, a long falloff.
 * Faded in with altitude under the contact shadow, so the shadow of a flyer
 * reads softer the higher it is.
 */
export function shadowSoftCanvas() {
  if (!hasDom()) return null;
  const c = canvas(128, 128);
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 63);
  grad.addColorStop(0, withAlpha(PALETTE.ink0, 0.42));
  grad.addColorStop(0.4, withAlpha(PALETTE.ink0, 0.3));
  grad.addColorStop(0.75, withAlpha(PALETTE.ink0, 0.1));
  grad.addColorStop(1, withAlpha(PALETTE.ink0, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return c;
}

/**
 * The landing-dust mote's two tones, as [offset, r, g, b, alpha] with the
 * colour a 0..1 multiplier on the material's tint. The core is darker and a
 * little warmer than the tint, so a puff reads on pale stone; the rim is the
 * tint at full value, so it reads on dark earth. It is a shading ramp, not a
 * colour: the hue still comes from the palette through the material.
 */
export const DUST_RAMP = [
  [0, 0.44, 0.39, 0.33, 0.85],
  [0.45, 0.58, 0.53, 0.46, 0.7],
  [0.75, 0.95, 0.93, 0.9, 0.3],
  [1, 1, 1, 1, 0],
];

/**
 * One mote of landing dust: a soft disc with a darker warm core and a lighter
 * rim (DUST_RAMP), tinted and faded by its material. Clean and round, never
 * photographic grain.
 */
export function dustCanvas() {
  if (!hasDom()) return null;
  const c = canvas(64, 64);
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 31);
  const b = (v) => Math.round(v * 255);
  for (const [o, r, gr, bl, a] of DUST_RAMP) grad.addColorStop(o, `rgba(${b(r)},${b(gr)},${b(bl)},${a})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}
