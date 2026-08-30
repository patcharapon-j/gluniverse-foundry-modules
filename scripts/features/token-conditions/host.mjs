/**
 * GLUniverse Suite — token conditions: the canvas host.
 *
 * One container on `canvas.interface`, one quad per plate, one bloom filter over
 * the lot. The arrangement, and every reason for it, is the resource bar's:
 *
 *   1. **One filter, not one per token.** A filter on a token allocates a render
 *      texture per token per frame; in a forty-token encounter that is the most
 *      expensive thing this feature could possibly do.
 *   2. **World space, never token children.** Tokens rotate. A rail must not, and
 *      parenting it to the token would mean counter-rotating every plate on
 *      every frame of every turn.
 *   3. **One container is one place to hide everything**, which is what makes the
 *      permission gate a single test rather than a per-plate one.
 */

import { warn } from "../../core/const.mjs";
import { createBloomFilter } from "../../core/bloom.mjs";
import { hexToRgbFloat } from "../../core/theme.mjs";
import { PlateAnim, SHED_AT, SHED_ORDER, UNSHED_AT } from "./anim.mjs";
import {
  blankTexture, getIconTexture, getTextAtlas, resetIcons, resetTextAtlas,
  runsGeometry, runWidth, TEXT_FRAGMENT_SHADER, TEXT_VERTEX_SHADER,
} from "./atlas.mjs";
import { FLAGS, LAYOUT, PLATE } from "./constants.mjs";
import { flatten, offsetFor, readToken } from "./data.mjs";
import { FRAGMENT_SHADER, INSET, FORM, VERTEX_SHADER } from "./shader.mjs";
import { TONES, DEFAULT_TONE } from "./tone.mjs";
import { canViewLabels, canViewPlates } from "./visibility.mjs";

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * `canvas.interface` sorts its children and every Foundry layer declares a
 * zIndex; a container left at the default 0 sorts *under* the tokens layer,
 * where a token's hover box and target reticle live. The symptom is narrow and
 * easy to miss — everything looks right until you hover, and then the border is
 * drawn straight over the rail.
 *
 * 901 sits one above the resource bars, so on the rare token whose rail and bar
 * overlap (a tiny creature with a long nudge) the plate is in front rather than
 * half-buried, and both stay under the controls layer at 1000. Never put
 * something you cannot click in front of something you can.
 */
const CONTAINER_Z = 901;

/** World pixels of slack around the viewport, so a plate's bloom cannot pop. */
const CULL_PAD = 96;

/* The plate's interior proportions live in constants.mjs, because the GLSL, the
   label layout here and the preview harness all measure against them. */
const {
  iconHalf: ICON_HALF, iconOfBody: ICON_OF_BODY, iconPad: ICON_PAD,
  tabHalfX: TAB_HALF_X, tabOfBody: TAB_OF_BODY, tabHalfY: TAB_HALF_Y,
  nameOfPlate: NAME_OF_PLATE, tabOfPlate: TAB_OF_PLATE,
} = PLATE;

const NAME_INK = [0.90, 0.93, 0.98];
const TAB_INK = [0.02, 0.03, 0.05];
const TAIL_INK = [0.72, 0.78, 0.88];
const EDGE_INK = [0.02, 0.03, 0.05];

const TONE_RGB = {};
for (const [key, tone] of Object.entries(TONES)) {
  TONE_RGB[key] = { body: new Float32Array(hexToRgbFloat(tone.body)), hot: new Float32Array(hexToRgbFloat(tone.hot)) };
}
const toneOf = (key) => TONE_RGB[key] ?? TONE_RGB[DEFAULT_TONE];

function unitQuad() {
  return new PIXI.Geometry()
    .addAttribute("aVertexPosition", [0, 0, 1, 0, 1, 1, 0, 1], 2)
    .addAttribute("aUvs", [0, 0, 1, 0, 1, 1, 0, 1], 2)
    .addIndex([0, 1, 2, 0, 2, 3]);
}

function makePlateMesh() {
  const uniforms = {
    uTime: 0, uTexel: 0, uAspect: 1,
    uForm: FORM.plate, uEnter: 0, uFlash: 0, uPulse: 0, uSel: 0, uSeed: 0,
    uLife: 1, uLifeOn: 0, uSustain: 0, uRedact: 0, uArt: 0, uBadge: 0,
    uTone: new Float32Array(TONE_RGB[DEFAULT_TONE].body),
    uToneHot: new Float32Array(TONE_RGB[DEFAULT_TONE].hot),
    uIconUv: new Float32Array([0, 0, 1, 1]),
    uIconBox: new Float32Array([0, 0, 0.001, 0.001]),
    uIcon: blankTexture(),
  };
  const mesh = new PIXI.Mesh(unitQuad(), PIXI.Shader.from(VERTEX_SHADER, FRAGMENT_SHADER, uniforms));
  mesh.blendMode = PIXI.BLEND_MODES?.NORMAL ?? "normal";
  return mesh;
}

/** One token's rail. */
class RailEntry {
  constructor(token, host) {
    this.token = token;
    this.host = host;
    this.group = new PIXI.Container();
    this.group.eventMode = "none";
    /** key → { mesh, anim, state, seed } */
    this.plates = new Map();
    this.tail = null;
    this.tailAnim = null;
    this.textMesh = null;
    this.textKey = "";
    /** Eased 0..1 toward whether this token's labels are showing. */
    this.sel = 0;
    this.selTarget = 0;
    this.reading = null;
    this.hidden = 0;
    this.split = 0;
  }

  destroy() {
    this.group.destroy({ children: true });
    this.plates.clear();
  }

  /** Whether any part of this rail still needs frames. */
  get hot() {
    if (Math.abs(this.sel - this.selTarget) > 0.004) return true;
    if (this.tailAnim?.hot) return true;
    for (const plate of this.plates.values()) {
      if (plate.anim.hot) return true;
      /* A gauge counts down and a warning breathes, both without any event to
         arm them, so an entry carrying either is hot for as long as it exists. */
      if (plate.state.lifeOn || plate.state.pulse) return true;
    }
    return false;
  }
}

class RailHost {
  constructor() {
    this.entries = new Map();
    this.container = null;
    this.bloom = null;
    this.opts = {};
    this.motionScale = 1;
    this.ticking = false;
    this.frameMs = 16;
    this.shed = 0;
    this._tick = this.tick.bind(this);
    this._lastTime = 0;
  }

  /* ── Settings mirror ─────────────────────────────────────────────────── */

  configure(opts) {
    this.opts = opts;
    this.motionScale = opts.motionScale;
    for (const entry of this.entries.values()) {
      for (const plate of entry.plates.values()) plate.anim.motionScale = opts.motionScale;
      if (entry.tailAnim) entry.tailAnim.motionScale = opts.motionScale;
    }
    this.applyBloom();
  }

  applyBloom() {
    if (!this.container) return;
    if (this.opts.bloom) {
      if (!this.bloom) this.bloom = createBloomFilter();
      if (this.bloom) {
        this.syncFilterResolution();
        /* Nothing here has a geometric edge to antialias — every shape in a
           plate is an SDF the fragment shader already resolves against px, and
           the labels are alpha-blended from an atlas. Multisampling the filter
           target would resolve an extra buffer every frame for no difference. */
        this.bloom.multisample = PIXI.MSAA_QUALITY?.NONE ?? 0;
      }
      this.container.filters = this.bloom ? [this.bloom] : null;
    } else {
      this.container.filters = null;
    }
  }

  /**
   * `PIXI.Filter` defaults its resolution to 1, not to the renderer's, and the
   * filter system sizes its intermediate textures from the filter rather than
   * from the target. Left alone, the whole rail renders at half the device
   * pixels on any HiDPI display and is scaled back up: nothing errors, the
   * plates are simply soft, and softer the further you zoom in. Re-read rather
   * than set once, because moving the window to a display with a different
   * pixel ratio changes it.
   */
  syncFilterResolution() {
    const dpr = canvas?.app?.renderer?.resolution;
    if (this.bloom && Number.isFinite(dpr) && dpr > 0) this.bloom.resolution = dpr;
  }

  /* ── Lifecycle ───────────────────────────────────────────────────────── */

  attach() {
    if (this.container) return;
    const layer = canvas?.interface ?? canvas?.tokens;
    if (!layer) {
      warn("token-conditions | no interface layer to attach to; the rail will not draw");
      return;
    }
    this.container = new PIXI.Container();
    this.container.eventMode = "none";
    this.container.sortableChildren = false;
    /* Set before the addChild so the parent is marked dirty once. */
    this.container.zIndex = CONTAINER_Z;
    layer.addChild(this.container);
    this.applyBloom();
    this.refreshAll();
  }

  detach() {
    this.stopTicker();
    for (const entry of this.entries.values()) entry.destroy();
    this.entries.clear();
    try {
      this.container?.destroy({ children: true });
    } catch {
      /* canvasTearDown may already have destroyed the parent layer out from
         under us; there is nothing left to release and nothing to report. */
    }
    this.container = null;
    this.bloom = null;
    resetTextAtlas();
    resetIcons();
  }

  /* ── Entries ─────────────────────────────────────────────────────────── */

  refreshAll() {
    if (!this.container || !canvas?.tokens) return;
    const seen = new Set();
    for (const token of canvas.tokens.placeables) {
      seen.add(token.id);
      this.refreshToken(token);
    }
    for (const [id, entry] of this.entries) {
      if (!seen.has(id)) { entry.destroy(); this.entries.delete(id); }
    }
    this.cull();
    this.syncTicker();
  }

  remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.destroy();
    this.entries.delete(id);
    this.syncTicker();
  }

  /**
   * Position only — no data read.
   *
   * `refreshToken` fires on every frame of a drag, and a full refresh walks the
   * actor's items and resolves an origin UUID per effect. Moving a token is not
   * a state change.
   */
  reposition(token) {
    const entry = this.entries.get(token?.id);
    if (!entry) return;
    this.layout(entry);
    this.cullEntry(entry);
  }

  /**
   * Read a token's state and reconcile the rail against it.
   *
   * Reconciliation rather than rebuild: a plate that is still present keeps its
   * mesh, its animation and its seed, so a creature that gains a seventh
   * condition does not re-print the six it already had.
   */
  refreshToken(token) {
    if (!this.container || !token?.id) return;

    const allowed = canViewPlates(token);
    const reading = allowed ? readToken(token, this.opts) : null;

    if (!reading) {
      this.remove(token.id);
      return;
    }

    let entry = this.entries.get(token.id);
    if (!entry) {
      entry = new RailEntry(token, this);
      this.container.addChild(entry.group);
      this.entries.set(token.id, entry);
    }
    entry.token = token;

    /* The GM's cap, floored by what this token's square can actually hold. The
       tail already exists to say "and N more"; letting it absorb the overflow is
       how the block stays on its own square without the setting having to know
       anything about grid sizes or creature sizes. */
    const cap = Math.min(this.opts.maxPlates, this.capacityFor(token));
    const { plates, hidden, split } = flatten(reading, cap);
    entry.reading = plates;
    entry.hidden = hidden;
    entry.split = split;

    const wanted = new Set(plates.map((p) => p.key));

    /* Retire what is gone. The mesh stays until its print has run backwards; a
       plate that vanishes on the frame its condition is removed reads as a
       glitch rather than as a removal. */
    for (const [key, plate] of entry.plates) {
      if (!wanted.has(key)) plate.anim.retarget(0);
    }

    for (const state of plates) {
      let plate = entry.plates.get(state.key);
      if (!plate) {
        const mesh = makePlateMesh();
        entry.group.addChild(mesh);
        plate = {
          mesh,
          anim: new PlateAnim({ motionScale: this.motionScale }),
          state,
          /* Per-plate, so two plates on one token never breathe in lockstep —
             a rank of synchronised pulses reads as one flashing object. */
          seed: Math.random() * 10,
          icon: null,
        };
        entry.plates.set(state.key, plate);
      } else {
        plate.anim.retarget(1);
      }
      plate.state = state;
      if (plate.icon !== state.img) {
        plate.icon = state.img;
        plate.mesh.shader.uniforms.uIcon = getIconTexture(state.img);
      }
    }

    /* The tail is a plate like any other, so it prints and un-prints with the
       same beat rather than appearing and disappearing. */
    if (hidden > 0 && !entry.tail) {
      entry.tail = makePlateMesh();
      entry.tail.shader.uniforms.uForm = FORM.tail;
      entry.group.addChild(entry.tail);
      entry.tailAnim = new PlateAnim({ motionScale: this.motionScale });
    }
    if (entry.tailAnim) entry.tailAnim.retarget(hidden > 0 ? 1 : 0);

    entry.selTarget = canViewLabels(token, this.opts.labels) ? 1 : 0;
    if (this.motionScale <= 0) entry.sel = entry.selTarget;

    this.layout(entry);
    this.cullEntry(entry);
    this.syncTicker();
  }

  /* ── Layout ──────────────────────────────────────────────────────────── */

  /** The scene's grid size, with a floor so a broken scene cannot divide by it. */
  get grid() {
    const g = canvas?.grid?.size ?? canvas?.dimensions?.size;
    return Number.isFinite(g) && g > 4 ? g : 100;
  }

  /**
   * The packed block's dimensions for one token, in world pixels.
   *
   * Shared by the layout and by `capacityFor`, because the number of plates a
   * token can hold and the places they go are the same arithmetic asked twice.
   * Derived from the *grid* and the token's square, never from its artwork: a
   * creature scaled to 1.4 is still standing in one square, and a block sized
   * off the art would be a different size on every token.
   */
  metrics(token) {
    const doc = token?.document;
    const grid = this.grid;
    const scale = this.opts.scale;
    const size = clamp(LAYOUT.plate * grid * scale, LAYOUT.minPx, LAYOUT.maxPx);
    const gap = LAYOUT.gap * grid * scale;
    const margin = LAYOUT.margin * grid * scale;
    const foot = LAYOUT.foot * grid * scale;
    const tw = (doc?.width ?? 1) * grid;
    const th = (doc?.height ?? 1) * grid;
    const pitch = size + gap;
    /* +gap on both, because n plates span n*pitch - gap: the last one needs no
       gap after it, and rounding without that term loses a whole row on a token
       that fits exactly. */
    const rows = clamp(Math.floor((th - margin - foot + gap) / pitch), 1, LAYOUT.rowsMax);
    const cols = Math.max(1, Math.min(LAYOUT.colsMax,
      Math.floor((tw - margin * 2 + gap) / pitch)));
    return { grid, scale, size, gap, margin, foot, tw, th, pitch, rows, cols };
  }

  /**
   * How many plates this token's square can actually hold.
   *
   * The cap the GM set is a ceiling, not a promise: a Tiny familiar on a 64px
   * grid has room for six plates however high the setting goes, and drawing
   * twelve would put half of them on the creature standing next to it. Taking
   * the smaller of the two is what keeps "the rail stays on its own square"
   * true at every token size rather than only at the one it was tuned on.
   */
  capacityFor(token) {
    const m = this.metrics(token);
    return Math.max(1, m.rows * m.cols);
  }

  /**
   * Place every quad in this entry, in world pixels.
   *
   * Two arrangements, cross-faded by `entry.sel`:
   *
   *   **Packed** (sel 0) — a block of small plates inside the token's own
   *   square, filling column-first from the chosen flank so that "the worst
   *   thing is first" is still read top-down. This is the resting state, and it
   *   never leaves the token's footprint.
   *
   *   **Expanded** (sel 1) — one column of larger plates hung outside the
   *   flank, each showing its name. This one is free to overflow onto the
   *   squares around it, because it only exists while the cursor is on the
   *   token and it goes away the moment the cursor leaves.
   *
   * Both endpoints are computed in full and interpolated — position *and* size —
   * rather than the block being eased into place from the packed layout alone.
   * The two arrangements are different shapes, not one shape at two scales, and
   * lerping between two complete answers is the only way each plate arrives
   * where it belongs from wherever it happened to be.
   */
  layout(entry) {
    const token = entry.token;
    const doc = token?.document;
    if (!doc) return;

    const { grid, scale, size, gap, margin, tw, pitch, rows, cols } = this.metrics(token);
    const sel = entry.sel;
    const left = this.opts.side !== "right";

    const ox = offsetFor(token, FLAGS.offsetX, this.opts.offsetX) * grid;
    const oy = offsetFor(token, FLAGS.offsetY, this.opts.offsetY) * grid;

    /* The group's origin is the token's top-left corner, so the two flanks are
       one layout mirrored through `tw` rather than two sets of arithmetic. */
    entry.group.position.set((doc.x ?? token.x ?? 0) + ox, (doc.y ?? token.y ?? 0) + oy);

    /* The expanded endpoint's own metrics. The block trades size for density;
       expanding gives the size back, so a name is read at the size it was drawn
       for rather than at the size a nine-plate creature could spare. */
    const selSize = size * LAYOUT.selScale;
    const selGap = gap * LAYOUT.selScale;
    const selGroupGap = LAYOUT.groupGap * grid * scale * LAYOUT.selScale;
    const wide = selSize * this.wideFactor(entry, selSize);

    /* The plate as it is *this* frame. Everything below anchors to these, so a
       flank edge stays glued to the flank for the whole of the unfold. */
    const w = size + (wide - size) * sel;
    const h = size + (selSize - size) * sel;
    const bleed = INSET * h;

    const list = entry.reading ?? [];
    const hasTail = !!(entry.tail && entry.hidden > 0);
    const n = list.length + (hasTail ? 1 : 0);

    /* Where conditions end and effects begin. In the expanded column that seam
       is a wider gap; in the packed block it is a column break, so the two kinds
       never share a column and position still carries "these are different
       kinds of thing" — the property the whole two-group split exists for.

       The break costs the blank slots that finish the condition column, so it is
       only taken when the result still fits the block. On a token crowded enough
       that it does not, the groups run together: at that density the room is
       better spent on the plates themselves than on the seam between them. */
    const splitIdx = entry.split;
    const wantBreak = splitIdx > 0 && splitIdx < n;
    const pad = wantBreak ? (rows - (splitIdx % rows)) % rows : 0;
    const broke = wantBreak && n + pad <= rows * cols;
    const gapSlots = broke ? pad : 0;
    const splitCol = broke ? Math.ceil(splitIdx / rows) : -1;
    const groupGapX = (LAYOUT.groupGap - LAYOUT.gap) * grid * scale;

    /* Packed: column-first. Deliberately not clamped to `cols` — capacity is
       enforced where the reading is flattened, and a column too many is a plate
       sitting just off the token, where a clamp would put two plates in exactly
       the same place and one of them would simply never be seen. */
    const packed = (i, pw) => {
      const slot = i + (i >= splitIdx ? gapSlots : 0);
      const col = Math.floor(slot / rows);
      const row = slot - col * rows;
      const cx = margin + col * pitch + (splitCol >= 0 && col >= splitCol ? groupGapX : 0);
      return { x: left ? cx : tw - cx - pw, y: margin + row * pitch };
    };

    /* Expanded: one column, hung off the flank, top-aligned with the token. */
    const ys = [];
    let ey = 0;
    for (let i = 0; i < n; i++) {
      if (i === splitIdx && i > 0) ey += selGroupGap - selGap;
      ys.push(ey);
      ey += selSize + selGap;
    }
    const expanded = (i, pw) => ({
      x: left ? -(margin + pw) : tw + margin,
      y: ys[i] ?? ey,
    });

    entry.plateSize = size;
    entry.wide = wide;
    entry.tokenW = tw;
    /* The expanded column's measured height, for the cull. */
    entry.stack = ey;

    /**
     * Seat one quad and hand back the box every later anchor is measured in.
     *
     * The box is the single source of truth for where anything on this plate
     * is: the shader works in `p` (one unit = the quad's height, x scaled by
     * aspect) and the labels are laid out in local pixels, and a counter
     * positioned from two separately-derived versions of the same geometry is
     * how a digit ends up half off its own badge. Everything below converts
     * through `box`.
     */
    const place = (mesh, px, py, pw, ph) => {
      const qw = pw + bleed * 2;
      const qh = ph + bleed * 2;
      const x = px - bleed;
      const yTop = py - bleed;
      const aspect = qw / qh;

      mesh.position.set(x, yTop);
      mesh.width = qw;
      mesh.height = qh;

      const u = mesh.shader.uniforms;
      u.uAspect = aspect;
      u.uTexel = this.texelFor(mesh);

      /* Where the sigil sits, in p. Its half-extent is a fraction of the
         *body's* half-height, so a 16px plate and a 46px one carry the same
         proportion of sigil rather than the same number of pixels. */
      const bbX = aspect / 2 - INSET;
      const bbY = 0.5 - INSET;
      const ih = Math.min(ICON_HALF, bbY * ICON_OF_BODY);
      const icx = -bbX + ih + ICON_PAD;
      u.uIconBox[0] = icx;
      u.uIconBox[1] = 0;
      u.uIconBox[2] = ih;
      u.uIconBox[3] = ih;

      return { x, y: yTop, qw, qh, aspect, bbX, bbY, ih, icx };
    };

    /* Plates on their way out are no longer in the reading; they hold their last
       position rather than collapsing the block under them. */
    for (let i = 0; i < list.length; i++) {
      const plate = entry.plates.get(list[i].key);
      if (!plate) continue;
      const a = packed(i, w);
      const b = expanded(i, w);
      plate.box = place(plate.mesh, lerp(a.x, b.x, sel), lerp(a.y, b.y, sel), w, h);
    }

    if (hasTail) {
      /* Square in both arrangements: it is a count, not a name, so there is
         nothing for the extra width to hold. */
      const i = list.length;
      const a = packed(i, h);
      const b = expanded(i, h);
      entry.tailBox = place(entry.tail, lerp(a.x, b.x, sel), lerp(a.y, b.y, sel), h, h);
    } else {
      entry.tailBox = null;
    }

    this.writeText(entry, h, sel);
  }

  /** p-space → the group's local pixels, where y runs downward. */
  static toLocal(box, px, py) {
    return {
      x: box.x + (px / box.aspect + 0.5) * box.qw,
      y: box.y + (0.5 - py) * box.qh,
    };
  }

  /**
   * How wide an expanded plate gets, as a multiple of its expanded edge.
   *
   * Measured from the longest name actually on this token rather than fixed, so
   * a rail of short names does not reserve room for "UNCONSCIOUS", and capped so
   * one long name on a large creature cannot reach across the map.
   */
  wideFactor(entry, size) {
    if (!entry.reading?.length) return 1;
    let longest = 0;
    const nameSize = size * NAME_OF_PLATE;
    for (const state of entry.reading) {
      if (!state.name) continue;
      longest = Math.max(longest, runWidth([{ text: state.name.toUpperCase(), size: nameSize, track: nameSize * 0.09 }]));
    }
    if (longest <= 0) return 1;
    /* size covers the sigil and its two pads; tabRoom keeps the counter clear of
       the last letter. Both are measured against the plate's edge so a block of
       16px plates and one of 46px plates expand by the same proportion. */
    return clamp((size + longest + size * LAYOUT.tabRoom) / size, 1, LAYOUT.wideMax);
  }

  /**
   * One text mesh for the whole rail: every name and every counter in one
   * geometry.
   *
   * Keyed on everything that changes the layout — the labels, the counters, the
   * size and the expansion — because the obvious key is the text alone, and that
   * is exactly what a size change does not alter. Keyed that way the plates
   * resize and the labels stay where they were until the creature's next
   * condition change, which reads as a broken setting rather than as a stale
   * cache.
   */
  writeText(entry, size, sel) {
    /* Not `sel > 0`: a name laid out against the expanded width while the plate
       is still nearly square hangs off the end of it. Below the threshold the
       plate is opening and carries its sigil alone. */
    const showNames = sel >= LAYOUT.nameAt;
    const runs = [];
    const parts = [];
    const nameSize = size * NAME_OF_PLATE;
    const tabSize = size * TAB_OF_PLATE;

    for (const state of entry.reading ?? []) {
      const plate = entry.plates.get(state.key);
      if (!plate?.box) continue;
      const box = plate.box;

      if (showNames && state.name) {
        /* Just clear of the sigil: its right edge plus the same pad the sigil
           itself was placed with, converted out of the p-space the shader put it
           in rather than re-derived from the plate's width. */
        const at = RailHost.toLocal(box, box.icx + box.ih + ICON_PAD, 0);
        runs.push({
          parts: [{ text: state.name.toUpperCase(), size: nameSize, ink: NAME_INK, track: nameSize * 0.09 }],
          x: at.x, mid: at.y, align: "left",
        });
        parts.push(state.name);
      }

      if (state.badgeText) {
        /* Dead centre of the tab the shader cut in the bottom-right corner,
           computed from the shader's own two constants rather than from a second
           set that happens to agree today. */
        const nbx = Math.min(TAB_HALF_X, box.bbX * TAB_OF_BODY);
        const at = RailHost.toLocal(box, box.bbX - nbx, -box.bbY + TAB_HALF_Y);
        runs.push({
          parts: [{ text: state.badgeText, size: tabSize, ink: TAB_INK }],
          x: at.x, mid: at.y, align: "center",
        });
        parts.push(state.badgeText);
      }
    }

    if (entry.hidden > 0 && entry.tailBox) {
      const at = RailHost.toLocal(entry.tailBox, 0, 0);
      runs.push({
        parts: [{ text: "+" + entry.hidden, size: size * NAME_OF_PLATE, ink: TAIL_INK, track: size * 0.02 }],
        x: at.x, mid: at.y, align: "center",
      });
      parts.push("+" + entry.hidden);
    }

    const key = parts.join("\u0000") + "|" + size.toFixed(2) + "|" + sel.toFixed(2) + "|" + (showNames ? 1 : 0);
    if (key === entry.textKey && entry.textMesh) return;
    entry.textKey = key;

    const geometry = runs.length ? runsGeometry(runs) : null;
    if (!geometry) {
      entry.textMesh?.destroy();
      entry.textMesh = null;
      return;
    }
    if (!entry.textMesh) {
      const shader = PIXI.Shader.from(TEXT_VERTEX_SHADER, TEXT_FRAGMENT_SHADER, {
        uAtlas: getTextAtlas().texture,
        uEdge: new Float32Array(EDGE_INK),
        uOpacity: 1,
      });
      entry.textMesh = new PIXI.Mesh(geometry, shader);
      entry.textMesh.blendMode = PIXI.BLEND_MODES?.NORMAL ?? "normal";
      entry.group.addChild(entry.textMesh);
    } else {
      const old = entry.textMesh.geometry;
      entry.textMesh.geometry = geometry;
      old?.destroy();
    }
  }

  /**
   * One device pixel in the quad's UV space, taken from the mesh's own world
   * transform so it follows the zoom.
   *
   * The prelude's whole contract rests on this: `uTexel = 0` leaves every clamp
   * inert, so a mesh whose transform is not ready yet degrades to the unfiltered
   * look rather than to a blank quad.
   */
  texelFor(mesh) {
    const renderer = canvas?.app?.renderer;
    if (!renderer) return 0;
    const scale = canvas?.stage?.scale?.x ?? 1;
    const widthPx = mesh.width * scale * (renderer.resolution ?? 1);
    return widthPx > 1 ? 1 / widthPx : 0;
  }

  /* ── Culling ─────────────────────────────────────────────────────────── */

  /**
   * A filtered container measures itself from its children on every render and
   * sizes the bloom's intermediate textures from that measurement, whether or
   * not anything is animating. One token parked in the far corner of a large
   * scene therefore sizes those textures to the whole distance between them.
   * `renderable` is honoured in `calculateBounds` as well as in the render, so
   * one flag fixes the measurement and the draw call together.
   */
  cull() {
    for (const entry of this.entries.values()) this.cullEntry(entry);
  }

  cullEntry(entry) {
    const view = canvas?.app?.renderer?.screen;
    const stage = canvas?.stage;
    if (!view || !stage) return;
    const p = entry.group.position;
    const s = stage.scale?.x ?? 1;
    const sx = p.x * s + (stage.position?.x ?? 0);
    const sy = p.y * s + (stage.position?.y ?? 0);
    /* The origin is the token's top-left, and an expanded plate hangs a full
       plate width past whichever flank it is on — so the reach has to carry the
       token's own width too, or a right-hand rail on a Huge creature pops. */
    const reach = ((entry.wide ?? 64) + (entry.tokenW ?? 0)) * s + CULL_PAD;
    /* The expanded column is the tall arrangement, and `stack` is its measured
       height; the packed block is always shorter than the token. */
    const drop = ((entry.stack ?? 0) + (entry.plateSize ?? 32)) * s + CULL_PAD;
    entry.group.renderable =
      sx > -reach && sx < view.width + reach && sy > -drop && sy < view.height + drop;
  }

  /* ── The ticker ──────────────────────────────────────────────────────── */

  syncTicker() {
    let hot = false;
    for (const entry of this.entries.values()) {
      if (entry.hot) { hot = true; break; }
    }
    if (hot && !this.ticking) {
      this.ticking = true;
      this._lastTime = performance.now();
      canvas?.app?.ticker?.add(this._tick);
    } else if (!hot && this.ticking) {
      this.stopTicker();
    }
  }

  stopTicker() {
    if (!this.ticking) return;
    canvas?.app?.ticker?.remove(this._tick);
    this.ticking = false;
  }

  tick() {
    const now = performance.now();
    const dt = Math.min(64, now - this._lastTime);
    this._lastTime = now;

    /* A rolling average rather than the frame itself: one long frame from
       somebody else's texture upload must not shed an effect the machine can
       comfortably afford. */
    this.frameMs += (dt - this.frameMs) * 0.12;
    if (this.frameMs > SHED_AT && this.shed < SHED_ORDER.length) this.shed++;
    else if (this.frameMs < UNSHED_AT && this.shed > 0) this.shed--;

    const time = now / 1000;
    let anyHot = false;

    for (const entry of this.entries.values()) {
      entry.sel += (entry.selTarget - entry.sel) * Math.min(1, dt / 130);
      let layoutDirty = Math.abs(entry.sel - entry.selTarget) > 0.004;

      for (const [key, plate] of entry.plates) {
        plate.anim.step(dt);
        if (plate.anim.dead) {
          plate.mesh.destroy();
          entry.plates.delete(key);
          layoutDirty = true;
        }
      }
      entry.tailAnim?.step(dt);

      if (layoutDirty) this.layout(entry);
      this.writeUniforms(entry, time);
      if (entry.hot) anyHot = true;
    }

    if (!anyHot) this.stopTicker();
  }

  /** True while an effect is still inside the shed budget. */
  allows(effect) {
    const i = SHED_ORDER.indexOf(effect);
    return i < 0 || i >= this.shed;
  }

  writeUniforms(entry, time) {
    const breath = this.allows("breath") ? 1 : 0;
    const flashOn = this.allows("flash") ? 1 : 0;

    for (const state of entry.reading ?? []) {
      const plate = entry.plates.get(state.key);
      if (!plate) continue;
      const u = plate.mesh.shader.uniforms;
      const tone = toneOf(state.tone);
      u.uTime = time;
      u.uEnter = plate.anim.enter;
      u.uFlash = plate.anim.flash * flashOn;
      u.uSel = entry.sel;
      u.uSeed = plate.seed;
      u.uTone = tone.body;
      u.uToneHot = tone.hot;
      u.uBadge = state.badgeText ? 1 : 0;
      u.uRedact = state.redacted ? 1 : 0;
      u.uArt = state.art;
      u.uLifeOn = state.life === null ? 0 : 1;
      u.uLife = state.life === null ? 1 : state.life;
      u.uSustain = state.sustained ? 1 : 0;
      /* Dying and about-to-expire share one channel and one clock. They are the
         same message — something on this creature is about to change — and two
         warnings at different rates read as two unrelated alarms. */
      const pulse = state.slug === "dying" || (state.expiring && state.life !== null);
      u.uPulse = pulse ? breath : 0;
      /* Cached on the plate so `RailEntry#hot` can ask whether anything still
         needs frames without walking the reading again. */
      plate.state.pulse = pulse;
      plate.state.lifeOn = state.life !== null;
      u.uTexel = this.texelFor(plate.mesh);
    }

    if (entry.tail && entry.tailAnim) {
      const u = entry.tail.shader.uniforms;
      const tone = toneOf(DEFAULT_TONE);
      u.uTime = time;
      u.uEnter = entry.tailAnim.enter;
      u.uFlash = entry.tailAnim.flash * flashOn;
      u.uSel = 0;
      u.uBadge = 0;
      u.uRedact = 0;
      u.uLifeOn = 0;
      u.uPulse = 0;
      /* The tail is a count, not a condition: its tone is dimmed most of the way
         to ink so a plate that says "there are four more" never outshines the
         four it stands in for. */
      u.uTone = tone.body;
      u.uToneHot = tone.hot;
      u.uTexel = this.texelFor(entry.tail);
    }
  }
}

export const host = new RailHost();
