/**
 * Spellsprite — layers onto canvases. DOM only (no `game`, no PIXI), shared by
 * the 2D host, the Diorama host and the preview page.
 *
 * A `Blit` owns one small canvas per layer, sized to the box that was drawn
 * (rounded up to 32 art pixels so a growing effect does not reallocate every
 * frame). Each canvas holds art pixels 1:1; the caller scales it by a whole
 * number with nearest sampling.
 */

const BUCKET = 32;
const up = (n) => Math.max(BUCKET, Math.ceil(n / BUCKET) * BUCKET);

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined" && typeof document === "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
}

export class LayerCanvas {
  constructor() { this.canvas = makeCanvas(BUCKET, BUCKET); this.ctx = this.canvas.getContext("2d"); this.img = null; this.x = 0; this.y = 0; this.w = 0; this.h = 0; this.empty = true; this.version = 0; }

  ensure(w, h) {
    const cw = up(w), ch = up(h);
    if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; this.img = null; }
    if (!this.img) this.img = this.ctx.createImageData(this.canvas.width, this.canvas.height);
  }

  /**
   * Copy the drawn box of a layer. `write(out, stride, box)` fills RGBA.
   * The canvas then covers art pixels [x, x + w) × [y, y + h) of the buffer.
   */
  update(src, write) {
    const box = src.box.empty ? null : { x0: Math.max(0, src.box.x0), y0: Math.max(0, src.box.y0), x1: Math.min(src.w - 1, src.box.x1), y1: Math.min(src.h - 1, src.box.y1) };
    if (!box || box.x1 < box.x0 || box.y1 < box.y0) {
      if (!this.empty) { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); this.empty = true; this.version++; }
      return false;
    }
    const w = box.x1 - box.x0 + 1, h = box.y1 - box.y0 + 1;
    this.ensure(w, h);
    this.img.data.fill(0);
    write(this.img.data, this.img.width, box);
    this.ctx.putImageData(this.img, 0, 0);
    this.x = box.x0; this.y = box.y0; this.w = w; this.h = h; this.empty = false; this.version++;
    return true;
  }
}

export class Blit {
  constructor() { this.flat = new LayerCanvas(); this.stand = new LayerCanvas(); this.light = new LayerCanvas(); }

  /** Refresh all three canvases from a painted `Layers`. */
  update(L, bright) {
    this.flat.update(L.flat, (out, stride, box) => L.flat.toRGBA(out, stride, box));
    this.stand.update(L.stand, (out, stride, box) => L.stand.toRGBA(out, stride, box));
    this.light.update(L.light, (out, stride, box) => L.light.toRGBA(out, stride, box, bright));
  }

  /**
   * Draw one layer onto a 2D context at k screen pixels per art pixel, the
   * buffer's art pixel (0, 0) landing at (ox, oy).
   */
  draw(ctx, layer, k, ox = 0, oy = 0, composite = "source-over") {
    const c = this[layer];
    if (c.empty) return;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = composite;
    ctx.drawImage(c.canvas, 0, 0, c.w, c.h, ox + c.x * k, oy + c.y * k, c.w * k, c.h * k);
    ctx.restore();
  }
}
