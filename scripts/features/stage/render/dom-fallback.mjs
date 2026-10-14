/**
 * Stage — the lite renderer.
 *
 * For a client with no WebGL2, or whose player chose "lite": the same frame
 * from the same director, drawn as plain images. The choreography is identical
 * (entrances, marks, the close-up push, gestures, focus); the lighting is not
 * there, and the backdrop is drawn sharp. Pure DOM, no Foundry.
 */

const cssUrl = (src) => `url("${String(src).replace(/["\\\n]/g, (c) => `\\${c}`)}")`;

export class DomStage {
  /** @param {HTMLElement} root  the stage root; a layer is added under it */
  constructor(root) {
    this.layer = document.createElement("div");
    this.layer.className = "glstage-fallback";
    root.prepend(this.layer);
    // The room, in its own layer so the picture arriving can be stacked over
    // the one leaving (frame order), whatever order they were created in.
    this.backLayer = document.createElement("div");
    this.layer.prepend(this.backLayer);
    this.backs = new Map();
    this.imgs = new Map();
    this.srcOf = new Map();
    this.filterOf = new Map();
  }

  /**
   * Remember which picture a backdrop key draws, and the CSS filter that stands
   * in for its grade (light/picture.mjs `pictureFilter`; there is no tint here).
   */
  setBackdrop(key, src, filter = "") {
    this.srcOf.set(key, src);
    this.filterOf.set(key, filter);
  }
  dropBackdrop(key) {
    this.srcOf.delete(key);
    this.filterOf.delete(key);
    this.backs.get(key)?.remove();
    this.backs.delete(key);
  }

  draw(frame) {
    const { w: W, h: H } = frame.view;
    const cam = frame.camera;
    const toScreen = (x, y) => [(x - cam.x) * cam.zoom + W / 2, (y - cam.y) * cam.zoom + H / 2];

    // The room.
    const liveBacks = new Set();
    let order = 0;
    for (const b of frame.backdrops ?? []) {
      const src = this.srcOf.get(b.key);
      if (!src) continue;
      liveBacks.add(b.key);
      let el = this.backs.get(b.key);
      if (!el) {
        el = document.createElement("div");
        el.className = "glstage-fallback-back";
        el.style.backgroundImage = cssUrl(src);
        el.style.filter = this.filterOf.get(b.key) ?? "";
        this.backs.set(b.key, el);
      }
      const at = this.backLayer.children[order] ?? null;
      if (at !== el) this.backLayer.insertBefore(el, at);
      order++;
      // map: screen uv → picture uv (scale, offset); invert to place the picture.
      const [sx, sy, ox, oy] = b.map;
      el.style.width = `${W / sx}px`;
      el.style.height = `${H / sy}px`;
      el.style.transform = `translate(${(-ox / sx) * W}px, ${(-oy / sy) * H}px)`;
      el.style.opacity = String(b.alpha);
    }
    for (const [key, el] of this.backs) if (!liveBacks.has(key)) { el.remove(); this.backs.delete(key); }

    // The cast, back to front.
    const live = new Set();
    frame.figures.forEach((f, i) => {
      live.add(f.id);
      let img = this.imgs.get(f.id);
      if (!img || img.dataset.src !== f.key) {
        img?.remove();
        img = document.createElement("img");
        img.alt = "";
        img.decoding = "async";
        img.src = f.key;
        img.dataset.src = f.key;
        this.layer.append(img);
        this.imgs.set(f.id, img);
      }
      const [rx, ry, rw, rh] = f.rect;
      const [pu, pv] = f.pad;
      const w = rw * (1 - 2 * pu);
      const h = rh * (1 - 2 * pv);
      const [x, y] = toScreen(rx + pu * rw + f.motion[0], ry + pv * rh + f.motion[1]);
      img.style.width = `${w * cam.zoom}px`;
      img.style.height = `${h * cam.zoom}px`;
      img.style.zIndex = String(i + 1);
      img.style.transform = `translate(${x}px, ${y}px) rotate(${f.motion[2]}rad) scale(${f.flip}, ${1 + f.motion[3]})`;
      img.style.opacity = String(f.alpha);
      const dim = f.dim * (1 - f.lit);
      // A silhouette is the picture taken down to its shape.
      const level = (1 - dim * 0.42) * (1 - (f.mask ?? 0) * 0.95);
      img.style.filter = level < 0.99 ? `brightness(${level}) saturate(${1 - Math.max(dim * 0.35, f.mask ?? 0)})` : "";
    });
    for (const [id, img] of this.imgs) if (!live.has(id)) { img.remove(); this.imgs.delete(id); }
  }

  destroy() { this.layer.remove(); }
}
