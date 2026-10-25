/**
 * Spellglass — one area, drawn with PIXI's own vector primitives.
 *
 * No program of ours runs on the GPU: there is no shader, no filter and no
 * texture atlas, and so nothing to compile, warm, lose or fall back from. An
 * area is Graphics (fill, rim, glow, brackets, echo) and TilingSprites of the
 * function's pattern, baked once per session on a 2D canvas, under a Graphics
 * mask of the covered squares. Every frame after the landing only moves
 * numbers that PIXI already batches: alphas, a tile offset, a rotation and a
 * scale. A look that does not move asks for no frames at all.
 *
 * Two layers, because Foundry sorts Tokens between them:
 *   ground   under Tokens — fill, pattern, blocked hatch, seams, glow, chevrons
 *   overlay  over Tokens — the rim, its flare, the brackets, the echo, marks
 * Nothing that veils a creature is in the overlay: only hairlines.
 *
 * Pure: PIXI is handed in and nothing here reads `game`, `canvas`, `ui`,
 * `Hooks` or `foundry`, so the preview page drives this exact file.
 */

import { TIMING, alertLevel, echoPhase } from "../anim.mjs";
import { SIZES, BLOCKED_PATTERN } from "./look.mjs";
import {
  areaOutline, chevronMarks, convexCorners, dashes, dotsAlong, partialLoops,
} from "./outline.mjs";
import { TILE, paintPattern } from "./patterns.mjs";

const INK = 0x020306;
const ALERT_GAIN = Object.freeze({ heartbeat: 1, strobe: 1, throb: 0.85, breathe: 0.55, none: 0 });
const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const smooth = (t) => t * t * (3 - 2 * t);

/* ---- shared pattern tiles ------------------------------------------------ */

const TILES = new WeakMap();

/** The baked tile for `id`, shared by every area on this PIXI instance. */
export function patternTexture(PIXI, id) {
  let map = TILES.get(PIXI);
  if (!map) TILES.set(PIXI, map = new Map());
  const cached = map.get(id);
  if (cached && !cached.baseTexture?.destroyed) return cached;
  const tile = globalThis.document.createElement("canvas");
  tile.width = tile.height = TILE;
  paintPattern(tile.getContext("2d"), id, TILE);
  const texture = PIXI.Texture.from(tile);
  const base = texture.baseTexture;
  /* A power-of-two tile repeats in hardware, so mipmaps are safe here: there
     is no fract() seam for a derivative spike to land on. */
  base.wrapMode = PIXI.WRAP_MODES?.REPEAT ?? base.wrapMode;
  base.mipmap = PIXI.MIPMAP_MODES?.ON ?? base.mipmap;
  base.scaleMode = PIXI.SCALE_MODES?.LINEAR ?? base.scaleMode;
  map.set(id, texture);
  return texture;
}

/** Free every baked tile (canvas teardown). Areas must be gone first. */
export function releasePatternTextures(PIXI) {
  const map = TILES.get(PIXI);
  if (!map) return;
  for (const texture of map.values()) {
    try { texture.destroy(true); } catch { /* already gone */ }
  }
  map.clear();
}

/* ---- drawing helpers ----------------------------------------------------- */

function strokeLoops(gfx, loops) {
  for (const loop of loops) {
    if (loop.length < 2) continue;
    gfx.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i++) gfx.lineTo(loop[i][0], loop[i][1]);
    gfx.closePath();
  }
}

function strokePaths(gfx, paths) {
  for (const path of paths) {
    if (path.length < 4) continue;
    gfx.moveTo(path[0], path[1]);
    for (let i = 2; i < path.length; i += 2) gfx.lineTo(path[i], path[i + 1]);
  }
}

function line(PIXI, width, color, alpha, round = false) {
  return {
    width, color, alpha,
    cap: round ? PIXI.LINE_CAP?.ROUND ?? "round" : PIXI.LINE_CAP?.BUTT ?? "butt",
    join: round ? PIXI.LINE_JOIN?.ROUND ?? "round" : PIXI.LINE_JOIN?.MITER ?? "miter",
  };
}

function node(PIXI, name) {
  const container = new PIXI.Container();
  container.name = name;
  container.eventMode = "none";
  return container;
}

function graphics(PIXI, name) {
  const gfx = new PIXI.Graphics();
  gfx.name = name;
  gfx.eventMode = "none";
  return gfx;
}

/* ---- the area ------------------------------------------------------------ */

export class AreaView {
  /**
   * @param PIXI      the PIXI namespace (v7)
   * @param geometry  regionGeometry() output
   * @param cells     regionCells() output (the rules texture data)
   * @param look      composeLook() output
   * @param zoom      the stage scale the strokes are first built for
   */
  constructor(PIXI, { geometry, cells, look, zoom = 1 }) {
    this.PIXI = PIXI;
    this.geometry = geometry;
    this.look = look;
    this.outline = areaOutline(geometry, cells);
    this.zoom = zoom > 0 ? zoom : 1;
    this.offset = { x: 0, y: 0 };
    this.markRects = [];
    this.ground = node(PIXI, "gl-aoe-area-ground");
    this.overlay = node(PIXI, "gl-aoe-area-overlay");
    this.buildBody();
    this.buildStrokes();
  }

  /** True when the look moves on its own once it has landed. */
  get animated() {
    const L = this.look;
    return L.pace > 0 && (L.alert !== "none" || L.drift > 0 || L.spin > 0 || L.sweep
      || ["dashed", "dotted", "chain", "tape"].includes(L.rim) || this.chevrons.children.length > 0);
  }

  drawArea(gfx, color, alpha = 1) {
    const { outline } = this;
    gfx.beginFill(color, alpha);
    if (outline.lattice) for (const [x, y, w, h] of outline.rects) gfx.drawRect(x, y, w, h);
    else for (const loop of outline.loops) gfx.drawPolygon(loop.flat());
    gfx.endFill();
  }

  /** Everything that does not depend on the zoom: fill, mask, patterns. */
  buildBody() {
    const { PIXI, look: L, outline, geometry: geo } = this;
    const g = geo.grid;
    const box = outline.box ?? geo.bounds;
    const pad = g;
    this.box = { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 };

    this.fill = graphics(PIXI, "fill");
    this.drawArea(this.fill, L.bodyInt);
    this.fill.alpha = L.fill;

    this.mask = graphics(PIXI, "mask");
    this.drawArea(this.mask, 0xffffff);
    this.patterns = node(PIXI, "patterns");
    this.patterns.mask = this.mask;

    /* The same tile in ink, a hair down and right, under the lit one: on a
       dark map it is invisible, on a parchment map it is what keeps a pale
       pattern from washing out into the floor. */
    this.shadow = this.tiling(L.pattern, L.span, INK, Math.min(0.75, L.patternAlpha * 0.9));
    this.shadow.glAoeShift = SIZES.shadowOffset / L.span;
    this.primary = this.tiling(L.pattern, L.span, L.hotInt, L.patternAlpha);
    this.patterns.addChild(this.shadow, this.primary);
    this.secondary = null;
    if (L.secondary) {
      this.secondary = this.tiling(L.secondary.pattern, L.secondary.span, L.secondary.colorInt, L.patternAlpha * 0.55);
      /* Half a tile off the primary, so two patterns read as two marks rather
         than as one busier mark. */
      this.secondary.glAoeShift = 0.5;
      this.patterns.addChild(this.secondary);
    }
    this.sweep = null;
    if (L.sweep) {
      this.sweep = graphics(PIXI, "sweep");
      const r = outline.extent + g;
      const slices = 10, width = Math.PI * 0.42;
      for (let i = 0; i < slices; i++) {
        const a1 = 0, a0 = -width * (1 - i / slices);
        this.sweep.beginFill(L.hotInt, 0.025 + 0.03 * (i / slices));
        this.sweep.moveTo(0, 0);
        this.sweep.arc(0, 0, r, a0, a1);
        this.sweep.lineTo(0, 0);
        this.sweep.endFill();
      }
      this.sweep.lineStyle(line(PIXI, Math.max(2, g * 0.025), L.hotInt, 0.6));
      this.sweep.moveTo(0, 0);
      this.sweep.lineTo(r, 0);
      this.sweep.position.set(geo.origin.x, geo.origin.y);
      this.patterns.addChild(this.sweep);
    }

    this.blocked = null;
    if (outline.blocked.rects.length) {
      const blocked = node(PIXI, "blocked");
      const shade = graphics(PIXI, "blocked-shade");
      shade.beginFill(INK, 0.5);
      for (const [x, y, w, h] of outline.blocked.rects) shade.drawRect(x, y, w, h);
      shade.endFill();
      const mask = graphics(PIXI, "blocked-mask");
      mask.beginFill(0xffffff, 1);
      for (const [x, y, w, h] of outline.blocked.rects) mask.drawRect(x, y, w, h);
      mask.endFill();
      const hatch = node(PIXI, "blocked-hatch");
      hatch.mask = mask;
      hatch.addChild(this.tiling(BLOCKED_PATTERN, 0.5, L.hotInt, 0.42));
      blocked.addChild(shade, mask, hatch);
      this.blocked = blocked;
    }

    this.seams = graphics(PIXI, "seams");
    this.glow = graphics(PIXI, "glow");
    this.glow.blendMode = PIXI.BLEND_MODES?.ADD ?? this.glow.blendMode;
    this.chevrons = node(PIXI, "chevrons");
    this.ground.addChild(this.glow, this.fill, this.mask, this.patterns);
    if (this.blocked) this.ground.addChild(this.blocked);
    this.ground.addChild(this.seams, this.chevrons);

    this.rim = node(PIXI, "rim");
    this.pen = graphics(PIXI, "pen");
    this.flare = graphics(PIXI, "flare");
    this.flare.blendMode = PIXI.BLEND_MODES?.ADD ?? this.flare.blendMode;
    this.brackets = graphics(PIXI, "brackets");
    this.echoRing = graphics(PIXI, "echo");
    this.echoRing.pivot.set(geo.origin.x, geo.origin.y);
    this.echoRing.position.set(geo.origin.x, geo.origin.y);
    this.echoRing.visible = false;
    this.marks = graphics(PIXI, "marks");
    this.overlay.addChild(this.echoRing, this.flare, this.rim, this.pen, this.brackets, this.marks);
  }

  tiling(id, span, tint, alpha) {
    const { PIXI, box, geometry: geo } = this;
    const sprite = new PIXI.TilingSprite(patternTexture(PIXI, id), box.width, box.height);
    sprite.eventMode = "none";
    sprite.position.set(box.x, box.y);
    sprite.tint = tint;
    sprite.alpha = alpha;
    const scale = geo.grid * span / TILE;
    sprite.tileScale.set(scale, scale);
    sprite.glAoeShift = 0;
    sprite.glAoeSpanPx = geo.grid * span;
    this.placeTile(sprite, 0, 0);
    return sprite;
  }

  /**
   * Put the tile's origin on the area's origin (so a spin turns the pattern
   * about it) and on the world grid (so a static pattern sits square on the
   * map's squares), then slide it `along` px and turn it `turn` radians.
   */
  placeTile(sprite, along, turn) {
    const geo = this.geometry;
    const span = sprite.glAoeSpanPx;
    const shift = sprite.glAoeShift * span;
    const dir = geo.shapeId === 1 || geo.shapeId === 3 ? geo.direction : Math.PI / 4;
    const t = sprite.tileTransform;
    t.position.set(
      geo.origin.x - sprite.x + shift + Math.cos(dir) * along,
      geo.origin.y - sprite.y + shift + Math.sin(dir) * along,
    );
    t.rotation = turn;
  }

  /** Everything sized in screen pixels: rebuilt when the zoom moves. */
  buildStrokes() {
    const { PIXI, look: L, outline, geometry: geo } = this;
    const k = 1 / this.zoom;
    const g = geo.grid;
    const loops = outline.loops;

    this.seams.clear();
    if (outline.lattice && outline.seams.length) {
      this.seams.lineStyle(line(PIXI, SIZES.seamPx * k, L.hotInt, 0.26));
      for (const [x0, y0, x1, y1] of outline.seams) { this.seams.moveTo(x0, y0); this.seams.lineTo(x1, y1); }
    }
    if (outline.blocked.loops.length) {
      this.seams.lineStyle(line(PIXI, 1.4 * k, L.hotInt, 0.55));
      for (const loop of outline.blocked.loops) strokePaths(this.seams, dashes(loop, 10 * k, 0.55));
    }

    this.glow.clear();
    SIZES.glowPx.forEach((px, i) => {
      this.glow.lineStyle(line(PIXI, px * k, L.bodyInt, clamp01(SIZES.glowAlpha[i] * L.glow), true));
      strokeLoops(this.glow, loops);
    });

    for (const child of this.chevrons.removeChildren()) child.destroy();
    for (const path of chevronMarks(geo)) {
      const chev = graphics(PIXI, "chevron");
      chev.lineStyle(line(PIXI, (SIZES.chevronPx + 2) * k, INK, 0.5, true));
      strokePaths(chev, [path]);
      chev.lineStyle(line(PIXI, SIZES.chevronPx * k, L.accentInt, 1, true));
      strokePaths(chev, [path]);
      this.chevrons.addChild(chev);
    }

    this.buildRim(k);

    this.flare.clear();
    this.flare.lineStyle(line(PIXI, L.rimPx * 3.2 * k, L.accentInt, 0.9, true));
    strokeLoops(this.flare, loops);

    this.brackets.clear();
    if (L.brackets) {
      const corners = loops.flatMap((loop) => convexCorners(loop));
      for (const [width, color, alpha] of [[(SIZES.bracketPx + 2.4) * k, INK, 0.7], [SIZES.bracketPx * k, L.accentInt, 1]]) {
        this.brackets.lineStyle(line(PIXI, width, color, alpha));
        for (const c of corners) {
          const a = Math.min(SIZES.bracketArm * g, c.armIn * 0.45);
          const b = Math.min(SIZES.bracketArm * g, c.armOut * 0.45);
          this.brackets.moveTo(c.x + c.back[0] * a, c.y + c.back[1] * a);
          this.brackets.lineTo(c.x, c.y);
          this.brackets.lineTo(c.x + c.fwd[0] * b, c.y + c.fwd[1] * b);
        }
      }
    }

    this.echoRing.clear();
    this.echoRing.lineStyle(line(PIXI, SIZES.echoPx * k, L.accentInt, 1, true));
    strokeLoops(this.echoRing, loops);

    this.drawMarks();
    this.penAt = -1;
  }

  /** The tactical boundary. Every style keeps an unbroken line under it. */
  buildRim(k) {
    const { PIXI, look: L, outline } = this;
    const loops = outline.loops;
    for (const child of this.rim.removeChildren()) child.destroy();
    this.chase = [];
    const w = L.rimPx * k;

    const base = graphics(PIXI, "rim-base");
    base.lineStyle(line(PIXI, w + SIZES.keylinePx * 2 * k, INK, 0.72));
    strokeLoops(base, loops);
    const continuous = { solid: 1, double: 1, dashed: 0.4, dotted: 0.35, chain: 0.4, tape: 1 }[L.rim] ?? 1;
    if (L.rim === "double") {
      base.lineStyle(line(PIXI, w * 2.4, L.hotInt, L.rimAlpha));
      strokeLoops(base, loops);
      base.lineStyle(line(PIXI, w * 0.85, INK, 0.9));
      strokeLoops(base, loops);
    } else if (L.rim === "tape") {
      base.lineStyle(line(PIXI, w, L.accentInt, L.rimAlpha));
      strokeLoops(base, loops);
    } else {
      base.lineStyle(line(PIXI, L.rim === "solid" ? w : w * 0.6, L.hotInt, L.rimAlpha * continuous));
      strokeLoops(base, loops);
    }
    this.rim.addChild(base);

    const set = (name) => { const gfx = graphics(PIXI, name); this.rim.addChild(gfx); this.chase.push(gfx); return gfx; };
    const period = SIZES.dashPx * 3 * k;
    if (L.rim === "dashed") {
      for (let i = 0; i < 3; i++) {
        const gfx = set(`rim-dash-${i}`);
        gfx.lineStyle(line(PIXI, w, L.hotInt, L.rimAlpha));
        for (const loop of loops) strokePaths(gfx, dashes(loop, period, 0.24, i / 3));
      }
    } else if (L.rim === "dotted") {
      const sets = [set("rim-dot-0"), set("rim-dot-1"), set("rim-dot-2")];
      sets.forEach((gfx) => gfx.beginFill(L.hotInt, L.rimAlpha));
      for (const loop of loops) {
        dotsAlong(loop, SIZES.dotGapPx * k).forEach((p, i) => sets[i % 3].drawCircle(p.x, p.y, w * 0.85));
      }
      sets.forEach((gfx) => gfx.endFill());
    } else if (L.rim === "chain") {
      const links = set("rim-links");
      links.lineStyle(line(PIXI, w, L.hotInt, L.rimAlpha, true));
      for (const loop of loops) strokePaths(links, dashes(loop, period, 0.5, 0));
      const knots = set("rim-knots");
      knots.beginFill(L.hotInt, L.rimAlpha);
      for (const loop of loops) {
        for (const path of dashes(loop, period, 0.001, 0.75)) knots.drawCircle(path[0], path[1], w * 1.1);
      }
      knots.endFill();
    } else if (L.rim === "tape") {
      for (let i = 0; i < 2; i++) {
        const gfx = set(`rim-tape-${i}`);
        gfx.lineStyle(line(PIXI, w * 0.98, INK, 0.92));
        for (const loop of loops) strokePaths(gfx, dashes(loop, w * 4, 0.5, i * 0.5));
      }
    }
  }

  /** Brackets around each Token standing in the area, world px rects. */
  setTokenMarks(rects) {
    this.markRects = (rects ?? []).map((r) => [...r]);
    this.drawMarks();
  }

  drawMarks() {
    const { PIXI, look: L } = this;
    const k = 1 / this.zoom;
    const gfx = this.marks;
    gfx.clear();
    gfx.position.set(-this.offset.x, -this.offset.y);
    if (!this.markRects.length) return;
    for (const [width, color, alpha] of [[(SIZES.markPx + 2.2) * k, INK, 0.65], [SIZES.markPx * k, L.accentInt, 1]]) {
      gfx.lineStyle(line(PIXI, width, color, alpha));
      for (const [x, y, w, h] of this.markRects) {
        const arm = Math.min(w, h) * 0.24;
        const inset = Math.min(w, h) * 0.04;
        for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x + w, y + h, -1, -1], [x, y + h, 1, -1]]) {
          const px = cx + sx * inset, py = cy + sy * inset;
          gfx.moveTo(px + sx * arm, py);
          gfx.lineTo(px, py);
          gfx.lineTo(px, py + sy * arm);
        }
      }
    }
  }

  /** Rigid translation, for a token-attached area following its Token. */
  translate(dx, dy) {
    this.offset.x = dx;
    this.offset.y = dy;
    this.ground.position.set(dx, dy);
    this.overlay.position.set(dx, dy);
    this.marks.position.set(-dx, -dy);
  }

  /**
   * Write one frame.
   *   time      seconds since the area appeared
   *   enter     0 → 1 through the entrance; eased is its pen curve
   *   presence  1 → 0 through the exit
   *   shock     the trigger beat, 0 at rest; pulse its 0 → 1 progress or -1
   *   zoom      the stage scale (strokes rebuild past a 6% change)
   *   shed      behaviours shed off the front of SHED_ORDER
   *   still     motion tier "none"
   *   motionScale  the motion tier's duration scale
   */
  update({ time = 0, enter = 1, eased = 1, presence = 1, shock = 0, pulse = -1, zoom = this.zoom, shed = 0, still = false, motionScale = 1 } = {}) {
    const L = this.look;
    if (zoom > 0 && Math.abs(zoom / this.zoom - 1) > 0.06) { this.zoom = zoom; this.buildStrokes(); }
    const moving = !still && L.pace > 0;
    const gain = ALERT_GAIN[L.alert] ?? 0;
    const a = moving ? alertLevel(L.alert, time, L.period) * gain : 0;
    const drawing = !still && L.enter === "draw" && enter < 1;
    const flash = still ? 0 : Math.max(L.enter === "flash" ? (1 - enter) ** 2 : 0, shock);
    const ink = drawing ? eased : 1;

    this.ground.alpha = presence;
    this.overlay.alpha = presence;
    this.fill.alpha = Math.min(0.9, L.fill * ink * (1 + 0.45 * a + 1.8 * flash));
    this.patterns.alpha = Math.min(1, ink * (0.82 + 0.3 * a + 0.6 * flash));

    const glowOn = shed < 5;
    this.glow.visible = glowOn;
    this.glow.alpha = Math.min(1, ink * (0.72 + 0.28 * a + flash));
    this.flare.visible = glowOn;
    this.flare.alpha = Math.min(1, (L.alert === "none" ? 0 : 0.1 + 0.75 * a) + flash * 0.9);

    const drift = moving && shed < 3;
    const along = drift ? L.drift * time * this.geometry.grid : 0;
    const turn = drift ? L.spin * time : 0;
    this.placeTile(this.shadow, along, turn);
    this.placeTile(this.primary, along, turn);
    if (this.secondary) {
      this.secondary.visible = shed < 4;
      this.placeTile(this.secondary, -along * 0.6, -turn);
    }
    if (this.sweep) {
      this.sweep.visible = shed < 4;
      this.sweep.rotation = moving ? time * 1.35 * L.pace : -Math.PI / 6;
    }

    const lit = this.chase.length;
    if (lit) {
      if (L.rim === "tape") {
        const flip = moving && shed < 3 ? Math.floor(time / Math.max(0.2, L.period / 2)) % 2 : 0;
        this.chase.forEach((gfx, i) => { gfx.alpha = i === flip ? 1 : 0; });
      } else {
        const phase = drift ? time * L.pace * 1.6 : 0;
        this.chase.forEach((gfx, i) => {
          const w = 0.5 + 0.5 * Math.cos(Math.PI * 2 * (phase - i / lit));
          gfx.alpha = drift ? 0.3 + 0.7 * w : 1;
        });
      }
    }

    const chevrons = this.chevrons.children;
    chevrons.forEach((chev, i) => {
      chev.alpha = ink * (moving ? 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(Math.PI * 2 * (i * 0.16 - time * L.pace * 0.9))) : 0.8);
    });

    if (drawing) {
      if (Math.abs(this.penAt - eased) > 0.004) this.drawPen(eased);
      this.pen.visible = true;
      this.rim.visible = false;
      this.brackets.alpha = 0;
    } else {
      this.pen.visible = false;
      this.rim.visible = true;
      this.brackets.alpha = 1;
    }

    let echo = pulse >= 0 ? pulse : -1;
    if (echo < 0 && !still && L.enter === "flash" && enter < 1) echo = enter;
    if (echo < 0 && moving && L.echo && shed < 2) {
      echo = echoPhase(L.alert, time, L.period, Math.min(L.period * 0.9, TIMING.echo / 1000 * Math.max(0.3, motionScale)));
    }
    if (echo >= 0 && echo < 1) {
      const reach = SIZES.echoReach * this.geometry.grid / Math.max(1, this.outline.extent);
      const s = 1 + reach * smooth(echo);
      this.echoRing.visible = true;
      this.echoRing.scale.set(s, s);
      this.echoRing.alpha = (1 - echo) ** 1.5 * 0.95;
    } else this.echoRing.visible = false;

    this.marks.visible = shed < 1;
  }

  drawPen(fraction) {
    const { PIXI, look: L } = this;
    const k = 1 / this.zoom;
    const paths = partialLoops(this.outline.loops, fraction);
    this.pen.clear();
    this.pen.lineStyle(line(PIXI, (L.rimPx + SIZES.keylinePx * 2) * k, INK, 0.72, true));
    strokePaths(this.pen, paths);
    this.pen.lineStyle(line(PIXI, L.rimPx * 1.3 * k, L.hotInt, 1, true));
    strokePaths(this.pen, paths);
    /* The nib: a bright point where the pen is. */
    this.pen.lineStyle(0);
    this.pen.beginFill(L.accentInt, 1);
    for (const path of paths) this.pen.drawCircle(path.at(-2), path.at(-1), L.rimPx * 2.2 * k);
    this.pen.endFill();
    this.penAt = fraction;
  }

  destroy() {
    for (const root of [this.ground, this.overlay]) {
      if (!root || root.destroyed) continue;
      if (root.parent) root.parent.removeChild(root);
      /* Children only: the pattern tiles are shared and outlive any one area. */
      try { root.destroy({ children: true, texture: false, baseTexture: false }); } catch { /* noop */ }
    }
  }
}
