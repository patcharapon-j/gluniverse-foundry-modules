/**
 * Stage — the director: state and time in, a frame out.
 *
 * Pure. Everything that moves on the stage moves here, on a clock the caller
 * owns (`step(now)`): characters walking to their marks, entering and leaving,
 * turning to face each other, the focus pull onto whoever speaks, the camera's
 * push into a close-up, the gestures, the breath, a firelit room's flicker, and
 * the relight when the scene's light changes. The renderer draws whatever frame
 * comes out and decides nothing; the preview page runs this same class.
 *
 * Geometry is in CSS pixels of the viewport, y down. In the wide shot the
 * camera is the identity; a close-up moves the camera, never the figures.
 */

import { identityRig, lerpRig } from "./light/rig.mjs";
import { coverMap } from "./light/backdrop.mjs";

/** Base durations (ms) before the motion scale. */
export const TIMING = Object.freeze({
  show: 520,
  hide: 420,
  enter: 680,
  exit: 460,
  move: 760,
  depth: 760,
  focus: 460,
  turn: 420,
  push: 1050,
  relight: 1400,
  backdrop: 900,
  // A silhouette falls fast; the reveal is the GM's beat and takes its time.
  mask: 500,
  reveal: 2600,
  react: { nod: 560, shake: 520, hop: 520, tremble: 1000, lean: 900 },
});

/** Ambient behaviours, cheapest to lose first (bound to Budget.ladder by the host). */
export const SHED_ORDER = Object.freeze(["grain", "flicker", "breath", "halo", "focusBlur", "shadows"]);

/** Breath: a whole number of breaths per minute so the loop never steps. */
const BREATH_PERIOD = 4000;

/* ── easing and tweens ──────────────────────────────────────────────── */

export const ease = {
  linear: (t) => t,
  out: (t) => 1 - (1 - t) ** 3,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  in: (t) => t * t * t,
  sine: (t) => 0.5 - 0.5 * Math.cos(Math.PI * t),
};

/** One animated number. Retargeting mid-flight starts from where it is. */
export class Tween {
  constructor(value = 0) {
    this.from = value; this.to = value; this.t0 = 0; this.dur = 0; this.ease = ease.inOut;
  }
  value(now) {
    if (this.dur <= 0 || now >= this.t0 + this.dur) return this.to;
    if (now <= this.t0) return this.from;
    return this.from + (this.to - this.from) * this.ease((now - this.t0) / this.dur);
  }
  busy(now) { return this.dur > 0 && now < this.t0 + this.dur; }
  set(to, now, dur, fn = ease.inOut, delay = 0) {
    if (to === this.to && !this.busy(now)) { this.from = to; return; }
    this.from = this.value(now);
    this.to = to;
    this.t0 = now + Math.max(0, delay);
    this.dur = Math.max(0, dur);
    this.ease = fn;
    if (this.dur === 0 && delay <= 0) this.from = to;
  }
  snap(v) { this.from = this.to = v; this.dur = 0; }
}

/* ── gestures ───────────────────────────────────────────────────────── */

const bump = (p) => Math.sin(Math.PI * Math.min(1, Math.max(0, p)));

/**
 * A gesture's offset at progress p (0..1): [dx, dy, rotation, breath], with
 * dx/dy as fractions of the figure's height. `toward` is +1 when the stage
 * centre is to the figure's right.
 */
export function gesture(kind, p, toward = 1) {
  const q = Math.min(1, Math.max(0, p));
  switch (kind) {
    case "nod": return [0, 0.012 * Math.abs(Math.sin(q * Math.PI * 2)), 0, -0.006 * bump(q)];
    case "shake": return [0.018 * Math.sin(q * Math.PI * 8) * (1 - q), 0, 0.006 * Math.sin(q * Math.PI * 8) * (1 - q), 0];
    case "hop": {
      const up = q < 0.15 ? 0 : 4 * ((q - 0.15) / 0.85) * (1 - (q - 0.15) / 0.85);
      const squash = q < 0.15 ? -0.025 * bump(q / 0.15) : 0.012 * up;
      return [0, -0.07 * up, 0, squash];
    }
    case "tremble": {
      const env = bump(q);
      return [0.004 * Math.sin(q * 110) * env, 0.002 * Math.sin(q * 83) * env, 0.004 * Math.sin(q * 97) * env, 0];
    }
    case "lean": {
      const e = q < 0.3 ? ease.out(q / 0.3) : q > 0.75 ? 1 - ease.inOut((q - 0.75) / 0.25) : 1;
      return [0.03 * toward * e, 0, 0.035 * toward * e, 0.008 * e];
    }
    default: return [0, 0, 0, 0];
  }
}

/* ── the director ───────────────────────────────────────────────────── */

const hash01 = (s) => {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return (h % 10000) / 10000;
};

export class Director {
  /**
   * @param {object} opts
   * @param {(ms:number) => number} [opts.scale]  motion scale (the suite's tier)
   * @param {(name:string) => boolean} [opts.allows]  shed ladder: may this behaviour run
   * @param {() => boolean} [opts.breathe]  the world's idle breath switch (off by default)
   */
  constructor({ scale = (ms) => ms, allows = () => true, breathe = () => false } = {}) {
    this.scale = scale;
    this.allows = allows;
    this.breathe = breathe;
    this.view = { w: 1920, h: 1080 };
    this.layout = { figure: 0.92, floor: 0, width: 0.86, nameplates: "close" };
    this.cast = new Map();
    this.arts = new Map();
    this.figs = new Map();
    this.state = { visible: false, shot: "wide", cut: "push", focus: null, close: null, on: [] };
    this.show = new Tween(0);
    this.close = new Tween(0);
    this.cam = { x: new Tween(960), y: new Tween(540), zoom: new Tween(1) };
    this.rooms = new Map();
    this.bg = { from: null, to: null, fade: new Tween(1) };
    this._rigFrom = identityRig();
    this._rigTo = identityRig();
    this._rigT0 = 0;
    this._rigDur = 0;
    this._now = 0;
  }

  d(ms) { return this.scale(ms); }

  /** A new view size: the camera lands where the current shot now puts it. */
  setView(w, h) {
    this.view = { w: Math.max(1, w), h: Math.max(1, h) };
    const closeOn = this.state.shot === "close" ? this.state.close : null;
    const target = closeOn ? this.closeCamera(closeOn) : { x: this.view.w / 2, y: this.view.h / 2, zoom: 1 };
    this.cam.x.snap(target.x);
    this.cam.y.snap(target.y);
    this.cam.zoom.snap(target.zoom);
  }

  setLayout(layout) { this.layout = { ...this.layout, ...layout }; }

  /** @param {Map<string, object>|object[]} cast  normalized members */
  setCast(cast) {
    this.cast = new Map((Array.isArray(cast) ? cast : [...cast.values()]).map((m) => [m.id, m]));
  }

  /**
   * What the host learned about a piece of art: its aspect, the shape grid's
   * padding and texel, its opaque bounds and the head.
   */
  setArt(src, info) { this.arts.set(src, info); }

  /** The room numbers of the backdrop being drawn (light/backdrop.mjs `roomOf`). */
  get room() {
    return this.rooms.get(this.bg.to) ?? { lum: 0.16, floorColor: [0.02, 0.02, 0.03], aspect: 16 / 9 };
  }

  /**
   * Show the backdrop held under `key` (its numbers in `room`), cross-fading
   * from the one on now over the same window a relight takes, so a cue that
   * changes the picture and the light lands them together.
   */
  setBackdrop(key, room, now, { delayMs = 0, durationMs, immediate = false } = {}) {
    if (room) this.rooms.set(key, room);
    if (key === this.bg.to) return;
    // A change that lands mid-fade fades from the picture that was arriving.
    this.bg.from = immediate || !this.bg.to ? null : this.bg.to;
    this.bg.to = key;
    if (this.bg.from) {
      this.bg.fade.snap(0);
      this.bg.fade.set(1, now, Math.max(0, durationMs ?? this.d(TIMING.backdrop)), ease.inOut, delayMs);
    } else {
      this.bg.fade.snap(1);
    }
  }

  /** Backdrop keys a frame may still draw; the host can free any other. */
  backdropsInUse() { return [this.bg.from, this.bg.to].filter(Boolean); }

  /** Change the light, easing over `durationMs` after `delayMs`. */
  setRig(rig, now, { delayMs = 0, durationMs, immediate = false } = {}) {
    this._rigFrom = this.rigAt(now);
    this._rigTo = rig;
    this._rigT0 = now + Math.max(0, delayMs);
    this._rigDur = immediate ? 0 : Math.max(0, durationMs ?? this.d(TIMING.relight));
    if (immediate) this._rigFrom = rig;
  }

  rigAt(now) {
    if (this._rigDur <= 0 || now >= this._rigT0 + this._rigDur) return now < this._rigT0 ? this._rigFrom : this._rigTo;
    if (now <= this._rigT0) return this._rigFrom;
    return lerpRig(this._rigFrom, this._rigTo, ease.inOut((now - this._rigT0) / this._rigDur));
  }

  /** Where a character's art should face: toward the middle of the stage. */
  facing(member, mark) {
    let f = 1;
    if (member.faces === "left" && mark.x < 0.46) f = -1;
    if (member.faces === "right" && mark.x > 0.54) f = -1;
    return mark.flip ? -f : f;
  }

  /**
   * Apply a new stage state. Everything animates from wherever it is now.
   * @param {object} state  normalized (model.mjs)
   */
  setState(state, now, { immediate = false } = {}) {
    const prev = this.state;
    this.state = state;
    const D = (ms) => (immediate ? 0 : this.d(ms));

    this.show.set(state.visible ? 1 : 0, now, D(state.visible ? TIMING.show : TIMING.hide), state.visible ? ease.out : ease.inOut);

    const on = new Map(state.on.map((m) => [m.id, m]));
    for (const [id, f] of this.figs) {
      if (on.has(id)) continue;
      if (f.leaving) continue;
      f.leaving = true;
      f.alpha.set(0, now, D(TIMING.exit), ease.inOut);
      f.slide.set(f.side * 0.04, now, D(TIMING.exit), ease.in);
    }
    for (const mark of state.on) {
      const member = this.cast.get(mark.id);
      let f = this.figs.get(mark.id);
      if (!f) {
        // Enter from the nearer wing.
        const side = mark.x < 0.5 ? -1 : 1;
        f = {
          id: mark.id, side, leaving: false,
          alpha: new Tween(0), slide: new Tween(side * 0.05), x: new Tween(mark.x), depth: new Tween(mark.depth),
          turn: new Tween(member ? this.facing(member, mark) : 1), lit: new Tween(0), dim: new Tween(0),
          mask: new Tween(mark.masked ? 1 : 0),
          reacts: [], phase: hash01(mark.id),
        };
        this.figs.set(mark.id, f);
        f.alpha.set(1, now, D(TIMING.enter), ease.out);
        f.slide.set(0, now, D(TIMING.enter), ease.out);
      } else if (f.leaving) {
        f.leaving = false;
        f.alpha.set(1, now, D(TIMING.enter), ease.out);
        f.slide.set(0, now, D(TIMING.enter), ease.out);
      }
      f.side = mark.x < 0.5 ? -1 : 1;
      f.x.set(mark.x, now, D(TIMING.move));
      f.depth.set(mark.depth, now, D(TIMING.depth));
      if (member) f.turn.set(this.facing(member, mark), now, D(TIMING.turn));
      const lit = state.focus === mark.id ? 1 : 0;
      const dim = state.focus && state.focus !== mark.id ? 1 : 0;
      f.mask.set(mark.masked ? 1 : 0, now, D(mark.masked ? TIMING.mask : TIMING.reveal), mark.masked ? ease.inOut : ease.sine);
      f.lit.set(lit, now, D(TIMING.focus));
      f.dim.set(dim, now, D(TIMING.focus));
    }

    // The camera.
    const closeOn = state.shot === "close" ? state.close : null;
    const push = state.cut === "cut" || immediate ? 0 : this.d(TIMING.push);
    const target = closeOn ? this.closeCamera(closeOn, state) : { x: this.view.w / 2, y: this.view.h / 2, zoom: 1 };
    const changed = (prev.shot === "close" ? prev.close : null) !== closeOn;
    const dur = changed ? push : D(TIMING.move);
    this.cam.x.set(target.x, now, dur);
    this.cam.y.set(target.y, now, dur);
    this.cam.zoom.set(target.zoom, now, dur);
    this.close.set(closeOn ? 1 : 0, now, changed ? (push ? push * 0.6 : 0) : dur, ease.inOut, closeOn && push ? push * 0.15 : 0);
  }

  /** Fire a gesture. */
  react(id, kind, now) {
    const f = this.figs.get(id);
    if (!f || f.leaving) return false;
    const base = TIMING.react[kind];
    if (!base) return false;
    f.reacts = f.reacts.filter((r) => now < r.t0 + r.dur);
    f.reacts.push({ kind, t0: now, dur: this.d(base) });
    return true;
  }

  /* ── geometry ──────────────────────────────────────────────────────── */

  /** The figure's art rectangle (unpadded), in world px, at a mark. */
  place(member, art, x, depth) {
    const { w: W, h: H } = this.view;
    const L = this.layout;
    const b = art?.bounds ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
    const opaque = Math.max(0.05, b.y1 - b.y0);
    const depthK = 1 - 0.22 * depth;
    const figH = H * L.figure * (member?.height ?? 1) * depthK;
    const imgH = figH / opaque;
    const imgW = imgH * (art?.aspect ?? 0.66);
    const floorY = H * (1 - L.floor) - depth * H * 0.075;
    const top = floorY - b.y1 * imgH - (member?.offsetY ?? 0) * figH;
    // The opaque centre stands on the mark, not the canvas centre: art is
    // rarely centred in its own file.
    const cx = W * (0.5 + (x - 0.5) * L.width);
    const opaqueMid = (b.x0 + b.x1) / 2;
    const left = cx - opaqueMid * imgW + (member?.offsetX ?? 0) * (b.x1 - b.x0) * imgW;
    return { left, top, w: imgW, h: imgH, figH, floorY, opaqueMid };
  }

  /** The head, in world px, for a member on stage. */
  headOf(id) {
    const member = this.cast.get(id);
    const art = member && this.arts.get(member.image);
    const mark = this.state.on.find((m) => m.id === id);
    if (!member || !art || !mark) return null;
    const r = this.place(member, art, mark.x, mark.depth);
    const face = member.face ?? art.face ?? art.head ?? { x: 0.5, y: 0.14, h: 0.16 };
    const f = this.facing(member, mark);
    // Mirrored about the opaque centre, which stays on the mark (see step).
    const fx = f < 0 ? 2 * r.opaqueMid - face.x : face.x;
    return { x: r.left + fx * r.w, y: r.top + face.y * r.h, h: face.h * r.h, facing: f };
  }

  /** The close-up camera on one character: their face at the upper third. */
  closeCamera(id) {
    const head = this.headOf(id);
    if (!head) return { x: this.view.w / 2, y: this.view.h / 2, zoom: 1 };
    const { w: W, h: H } = this.view;
    const zoom = Math.max(1.15, Math.min(4.5, (H * 0.3) / Math.max(1, head.h)));
    // Leave looking room: the face sits off-centre, away from where it looks.
    const sx = W * (0.5 - 0.1 * (head.facing || 0) * (this.cast.get(id)?.faces === "front" ? 0 : 1));
    const sy = H * 0.4;
    return { x: head.x - (sx - W / 2) / zoom, y: head.y - (sy - H / 2) / zoom, zoom };
  }

  /* ── the frame ─────────────────────────────────────────────────────── */

  busy(now) {
    if (this.show.busy(now) || this.close.busy(now)) return true;
    if (this.cam.x.busy(now) || this.cam.y.busy(now) || this.cam.zoom.busy(now)) return true;
    if (this._rigDur > 0 && now < this._rigT0 + this._rigDur) return true;
    if (this.bg.from && this.bg.fade.busy(now)) return true;
    for (const f of this.figs.values()) {
      if (f.alpha.busy(now) || f.slide.busy(now) || f.x.busy(now) || f.depth.busy(now)) return true;
      if (f.turn.busy(now) || f.lit.busy(now) || f.dim.busy(now) || f.mask.busy(now)) return true;
      if (f.reacts.some((r) => now < r.t0 + r.dur)) return true;
    }
    return false;
  }

  /** The idle breath: the world's switch, then the shed ladder. */
  _breathing() { return this.allows("breath") && this.breathe(); }

  /** Whether anything would move with nothing changing (breath, flicker). */
  ambient() {
    if (this.show.to <= 0) return false;
    if (this.allows("grain") && this._rigTo.grain > 0) return true;
    if (!this.figs.size) return false;
    return this._breathing() || (this.allows("flicker") && this._rigTo.flicker > 0);
  }

  step(now) {
    this._now = now;
    const { w: W, h: H } = this.view;
    const show = this.show.value(now);
    const close = this.close.value(now);
    const rig = this.rigAt(now);
    const camera = { x: this.cam.x.value(now), y: this.cam.y.value(now), zoom: this.cam.zoom.value(now) };
    const closeId = this.state.shot === "close" ? this.state.close : null;

    const figures = [];
    for (const [id, f] of this.figs) {
      const a = f.alpha.value(now);
      if (f.leaving && !f.alpha.busy(now) && a <= 0.001) { this.figs.delete(id); continue; }
      const member = this.cast.get(id);
      const art = member && this.arts.get(member.image);
      if (!member || !art) continue;
      const x = f.x.value(now);
      const depth = f.depth.value(now);
      const r = this.place(member, art, x, depth);
      const turn = f.turn.value(now);
      const sign = turn < 0 ? -1 : 1;
      const width = Math.max(0.04, Math.abs(turn));

      // Gestures + breath.
      const toward = x < 0.5 ? 1 : -1;
      let dx = f.slide.value(now) * W, dy = 0, rot = 0, breath = 0;
      f.reacts = f.reacts.filter((g) => now < g.t0 + g.dur);
      for (const g of f.reacts) {
        const o = gesture(g.kind, (now - g.t0) / g.dur, toward);
        dx += o[0] * r.figH; dy += o[1] * r.figH; rot += o[2]; breath += o[3];
      }
      if (this._breathing()) breath += 0.0045 * Math.sin((now / BREATH_PERIOD + f.phase) * Math.PI * 2);

      const padU = art.padU ?? 0.1;
      const padV = art.padV ?? 0.1;
      const qw = (r.w / (1 - 2 * padU)) * width;
      const qh = r.h / (1 - 2 * padV);
      // The quad mirrors (and narrows through a turn) about its own centre;
      // shift it so the opaque centre, not the file's, stays on the mark.
      const cx = r.left + r.w / 2 + (1 - sign * width) * (r.opaqueMid - 0.5) * r.w;
      const rect = [cx - qw / 2, r.top - padV * qh, qw, qh];

      const lit = f.lit.value(now);
      const dim = f.dim.value(now);
      // In a close-up, everyone but its subject leaves the frame.
      const inClose = closeId === id ? 1 : 1 - close;
      const alpha = a * show * inClose;
      const blurOK = this.allows("focusBlur");
      const b = art.bounds ?? { x0: 0, x1: 1, y1: 1 };
      const footX = sign < 0 ? 1 - (b.x0 + b.x1) / 2 : (b.x0 + b.x1) / 2;
      figures.push({
        id,
        key: member.image,
        name: member.name,
        title: member.title,
        rect,
        flip: sign,
        motion: [dx, dy, rot, breath],
        alpha,
        dim,
        lit,
        mask: f.mask.value(now),
        depth,
        lod: blurOK ? dim * 1.1 * (1 - close) + depth * 0.5 : 0,
        pad: [padU, padV],
        shapeTexel: art.shapeTexel ?? [1 / 64, 1 / 64],
        foot: [r.left + ((b.x0 + b.x1) / 2) * r.w + dx, r.floorY + dy, (b.x1 - b.x0) * r.w * width, r.figH],
        footUV: [footX, b.y1],
        throw: [0.16, -0.25 * (x - 0.5)],
        sort: depth * 10 - lit,
        artPx: [r.w * width * camera.zoom, r.h * camera.zoom],
        screen: this.toScreen([cx + dx, r.top + dy], camera),
        screenH: r.h * camera.zoom,
      });
    }
    figures.sort((p, q) => q.sort - p.sort);

    const flicker = this.allows("flicker") && rig.flicker > 0
      ? 1 + rig.flicker * 0.08 * (Math.sin(now * 0.0113) * 0.5 + Math.sin(now * 0.0271 + 1.3) * 0.3 + Math.sin(now * 0.0537 + 2.1) * 0.2)
      : 1;

    // The backdrop: cover-fit, pushed in a quarter as far as the camera (it is
    // further away) and centred where the face is. The env and bloom the cast
    // samples follow it exactly, so what lights a character is what is drawn
    // behind them.
    const head = closeId ? this.headOf(closeId) : null;
    const focus = head ? [Math.min(0.9, Math.max(0.1, head.x / W)), Math.min(0.9, Math.max(0.1, head.y / H))] : [0.5, 0.5];
    const bgZoom = 1.02 + (camera.zoom - 1) * 0.25 + 0.06 * close;
    const mapOf = (key) => coverMap(this.view, this.rooms.get(key)?.aspect ?? 16 / 9, { zoom: bgZoom, focus, unit: true });
    let fade = this.bg.from ? this.bg.fade.value(now) : 1;
    if (this.bg.from && fade >= 1 && !this.bg.fade.busy(now)) { this.bg.from = null; fade = 1; }
    const room = this.room;
    const backdrops = [];
    const veils = [];
    const glow = rig.glow * show;
    if (this.bg.from) {
      const m = mapOf(this.bg.from);
      backdrops.push({ key: this.bg.from, map: m, alpha: show });
      veils.push({ key: this.bg.from, map: m, amount: glow * (1 - fade) });
    }
    const toMap = this.bg.to ? mapOf(this.bg.to) : null;
    if (this.bg.to) {
      backdrops.push({ key: this.bg.to, map: toMap, alpha: show * (this.bg.from ? fade : 1) });
      veils.push({ key: this.bg.to, map: toMap, amount: glow * fade });
    }
    const envMap = coverMap(this.view, room.aspect, { zoom: bgZoom, focus });

    return {
      time: now,
      view: { w: W, h: H },
      camera,
      rig: { ...rig, halo: this.allows("halo") ? rig.halo : 0 },
      roomLum: room.lum,
      envKey: this.bg.to,
      envMap,
      flicker,
      shadowAmount: this.allows("shadows") ? 1 - close : 0,
      backdrops,
      bg: {
        blur: rig.blur + (Math.max(rig.blur, 0.85) - rig.blur) * close,
        bloom: rig.bloom,
        level: rig.bgLevel,
        tint: rig.bgTint,
        haze: rig.bgHaze,
        hazeColor: rig.haze,
      },
      veils,
      grain: this.allows("grain") ? rig.grain * show : 0,
      strokePx: Math.max(1.25, (2 * H) / 1080) * (1 + 0.4 * close),
      close: { amount: close * show },
      floor: { amount: 0.28 * show * (1 - close) * Math.min(1, figures.length), color: room.floorColor, top: 0.6 },
      vignette: (0.14 + 0.28 * close) * show,
      bars: 0.085 * close * show,
      figures,
      focus: this.state.focus,
      closeId,
      nameplate: this.nameplate(figures, close, show),
    };
  }

  toScreen(p, camera) {
    return [(p[0] - camera.x) * camera.zoom + this.view.w / 2, (p[1] - camera.y) * camera.zoom + this.view.h / 2];
  }

  /** Which name card, if any, and how present it is. */
  nameplate(figures, close, show) {
    const mode = this.layout.nameplates;
    if (mode === "off" || show <= 0) return null;
    const closeId = this.state.shot === "close" ? this.state.close : null;
    const id = closeId ?? (mode === "focus" ? this.state.focus : null);
    if (!id) return null;
    const f = figures.find((x) => x.id === id);
    // An unrevealed character has no name yet; the card arrives with the reveal.
    if (!f || f.mask >= 0.999) return null;
    const amount = (closeId ? close : f.lit) * (1 - f.mask);
    return { id, name: f.name, title: f.title, amount: amount * show, close: !!closeId, anchor: f.screen };
  }
}
