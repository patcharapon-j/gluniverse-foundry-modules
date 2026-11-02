/**
 * Diorama — standees: cut-out figures on round bases.
 *
 * A card turns about its vertical axis to face the camera and leans back about
 * its feet to meet the camera's pitch (MAX_LEAN), so it reads at its own
 * proportions from any angle. Its silhouette carries a crisp dark outline in
 * device pixels (CARD_FRAG), recoloured by state: targeted (the targeting
 * user's colour, thicker, glowing) > controlled (gold) > hovered (accent) >
 * rest (ink). Where something hides the figure, an x-ray copy draws that line
 * and a faint silhouette, so it still reads. Under it: a dark base with a
 * disposition ring, an outer turn ring (gold current, green next), a hover glow,
 * a contact shadow, the target reticle and, in halo mode, the effect chips along
 * the camera-facing front of the ring. Above it: one plate canvas with target
 * pips, bars and (out of halo mode) condition icons, which always faces the
 * camera and is never hidden behind terrain.
 *
 * Card size (cardLayout): the whole art is the creature's height, unless the
 * token carries art marks (artTop / artBottom), when the head-to-feet span is,
 * the feet line stands on the base and art above the head draws above it.
 *
 * Position changes tween with a hop per grid step (TIMING.standeeStep); state
 * changes (outline, lift) follow with frame-rate independent damping.
 *
 * Token life (render/life.mjs, the `life` frame option): the whole miniature
 * hops step by step on a gravity arc, falls off ledges under gravity, squashes
 * its card a little at every contact and springs back, and raises a dust puff
 * where it lands (render/dust.mjs, shed as "standeeDust"). A flyer breathes on
 * its stand (shed with "standeeSway") and its shadow softens with altitude.
 * Off, a move is the old linear slide with a card-only bounce.
 */

import * as THREE from "./three.mjs";
import { TIMING } from "../constants.mjs";
import { PALETTE, lighten, mix } from "../../../core/theme.mjs";
import { MATERIALS, cssRgb } from "./materials.mjs";
import { composeCard, drawChips, drawPlate, loadDrawable, maskHit, shadowCanvas, shadowSoftCanvas, HALO_MAX, PLATE_PX } from "./art.mjs";
import { clamp01, ease } from "./tween.mjs";
import { DUST, SQUASH, hoverPose, planMove, poseAt, squashAt } from "./life.mjs";
import { DustLayer } from "./dust.mjs";

const BASE_H = 0.07;
const SWAY = 0.014;
const PLATE_W = 1.15;
const MAX_STEPS = 12;
/**
 * The orthographic camera looks down at the board, so an upright card shows at
 * cos(pitch) of its height: 57% at the default 55°. Cards lean back about their
 * feet to face the camera's pitch, capped so a top-down view does not lay them
 * flat into whatever stands behind them.
 */
const MAX_LEAN = (60 * Math.PI) / 180;
/**
 * Display scale of the figure card only. A creature's height rules (cover,
 * occlusion, sight) use its real height; the card is drawn this much taller so a
 * Medium figure reads at about 1.6 cells on a busy painted map.
 */
export const FIGURE_SCALE = 1.35;
/** In the air from 1 q (a quarter cell) above the ground: world units are cells. */
const FLY_MIN = 0.25;
/** A picked-up miniature: how high it rides above its square (cells). */
export const HOLD_LIFT = 1.5;
/** The flight stand's glass foot. */
const STAND_FOOT = "#dcecff";
/** It rises past that and settles back (fraction of HOLD_LIFT), and bobs this much in the hand (cells). */
const HOLD_OVERSHOOT = 0.12;
const HOLD_BOB = 0.035;
/** How far the card stretches as it leaves the table (fraction of its height). */
const HOLD_STRETCH = 0.07;
/** A hold's tone (view/input.mjs: what setting it down here costs) → the colour of the squares it lands on. */
const HOLD_TONES = Object.freeze({ info: PALETTE.info, warn: PALETTE.warn, hazard: PALETTE.hazard, peril: PALETTE.peril });
/** 1/s: how fast a held miniature follows the hand, and its swing the hand's speed. */
const HOLD_FOLLOW = 20;
const HOLD_SWING = 9;
/** Radians of lean per cell/s of hand speed, and the most it leans. */
const HOLD_LEAN = 0.05;
const HOLD_LEAN_MAX = 0.32;
/** Outline width by state, device px; the targeted line also glows. */
export const OUTLINE_PX = Object.freeze({ rest: 2, hovered: 2.25, controlled: 2.5, targeted: 3.5 });
/** The card quad is grown by this many device px each side for line and glow. */
const MARGIN_PX = OUTLINE_PX.targeted + 6 + 3;
/** 1/s: how fast the outline, glow and hover lift follow a state change. */
const FOLLOW = 12;
/** Effect-halo chip size (cells), and the most chips on the inner arc. */
export const CHIP = 0.22;
const HALO_INNER = 7;
/** The reticle ring's radius in its quad (RETICLE_FRAG's R). */
const RETICLE_R = 0.62;
/** Arrow breathe amplitude, device px. */
const BREATHE_PX = 1.5;
const _dir = new THREE.Vector3();

/** Disposition → ring colour. Foundry numbers or names. */
export function dispositionColor(d) {
  switch (d) {
    case 1: case "friendly": return PALETTE.info;
    case -1: case "hostile": return PALETTE.hazard;
    case -2: case "secret": return PALETTE.violet;
    default: return PALETTE.warn;
  }
}

/** Turn → outer ring colour, or null. */
export const turnColor = (turn) => (turn === "current" ? PALETTE.signal : turn === "next" ? PALETTE.good : null);

const unitQuad = () => new THREE.PlaneGeometry(1, 1);

/** A target colour (CSS string, or [r,g,b] in 0..1 or 0..255) → [r,g,b] 0..1. */
export function targetRgb(c) {
  if (Array.isArray(c) && c.length >= 3) {
    const v = c.slice(0, 3).map(Number);
    if (v.every(Number.isFinite)) {
      const k = v.some((x) => x > 1) ? 1 / 255 : 1;
      return v.map((x) => Math.max(0, Math.min(1, x * k)));
    }
  }
  return cssRgb(typeof c === "string" ? c : null, PALETTE.signal);
}

/**
 * A TokenState's art marks (artTop / artBottom: the top of the head and the
 * soles of the feet, fractions 0..1 of the art's height), rounded so they key
 * a card cache steadily, or null when it has none usable. Pure.
 * @returns {{top:number, bottom:number}|null}
 */
export function cardMarks(t) {
  if (t?.artTop == null || t?.artBottom == null) return null;
  const top = Number(t.artTop), bottom = Number(t.artBottom);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || top < 0 || bottom > 1 || bottom - top < 0.01) return null;
  const r = (v) => Math.round(v * 10000) / 10000;
  return { top: r(top), bottom: r(bottom) };
}

/**
 * The card's size (cells) and how far it sinks below the base top. Unmarked
 * art: the whole card is the figure, FIGURE_SCALE × the creature's height,
 * narrowed (and so shortened) to 1.25 × its footprint. Marked art: the span
 * from the head line to the feet line is FIGURE_SCALE × the height, whatever the
 * width (the GM marked it), and the card drops by its clear border so the feet
 * line stands on the base. Pure.
 * @param {{aspect?:number, figure?:number, foot?:number}|null} card  composeCard's result
 * @param {number} heightCells  @param {number} width  footprint, cells
 * @returns {{h:number, w:number, foot:number}}
 */
export function cardLayout(card, heightCells, width) {
  const aspect = card?.aspect ?? 0.7;
  const fig = Number(card?.figure);
  if (Number.isFinite(fig) && fig > 0) {
    const h = (heightCells * FIGURE_SCALE) / Math.min(1, fig);
    return { h, w: h * aspect, foot: Math.max(0, Number(card.foot) || 0) * h };
  }
  let h = heightCells * FIGURE_SCALE, w = h * aspect;
  const maxW = width * 1.25 * FIGURE_SCALE;
  if (w > maxW) { h *= maxW / w; w = maxW; }
  return { h, w, foot: 0 };
}

/**
 * The outline a token's state asks for. Priority: targeted > controlled >
 * hovered > rest. Pure, for the check tool.
 * @returns {{state:string, rgb:number[], xray:number[], width:number, glow:number}}
 */
export function outlineLook(t) {
  const target = Array.isArray(t?.targets) && t.targets.length ? t.targets[0] : null;
  if (target != null) {
    const c = targetRgb(target);
    return { state: "targeted", rgb: c, xray: c, width: OUTLINE_PX.targeted, glow: 1 };
  }
  if (t?.controlled) {
    const c = cssRgb(PALETTE.signal);
    return { state: "controlled", rgb: c, xray: c, width: OUTLINE_PX.controlled, glow: 0 };
  }
  if (t?.hovered) {
    const c = cssRgb(lighten(PALETTE.accent, 0.35));
    return { state: "hovered", rgb: c, xray: c, width: OUTLINE_PX.hovered, glow: 0 };
  }
  // Ink on the card; a hidden figure's line must read on a dark wall, so its
  // x-ray is a pale ink.
  return { state: "rest", rgb: cssRgb(PALETTE.ink0), xray: cssRgb(mix(PALETTE.ink3, PALETTE.textDim, 0.7)), width: OUTLINE_PX.rest, glow: 0 };
}

/**
 * Where effect-halo chip k of n sits: which arc, and its angle off the
 * camera-facing front (radians, negative = screen left). Even spread from the
 * front centre outward, left to right; past the inner arc's capacity the rest
 * wrap to a second, larger arc. Pure, for the check tool.
 * @returns {{arc:0|1, angle:number, radius:number}}
 */
export function haloSlot(k, n, ringR) {
  const r0 = ringR;
  const step0 = (CHIP * 1.06) / r0;
  // as many as fit within ±62° of the front (a shallow arc that stays below
  // the figure's feet), 3..HALO_INNER
  const cap = Math.max(3, Math.min(HALO_INNER, Math.floor((2 * 1.08) / step0) + 1));
  const inner = Math.min(n, cap);
  if (k < inner) return { arc: 0, angle: (k - (inner - 1) / 2) * step0, radius: r0 };
  const r1 = r0 + CHIP * 1.1;
  const m = n - inner, j = k - inner;
  return { arc: 1, angle: (j - (m - 1) / 2) * ((CHIP * 1.06) / r1), radius: r1 };
}

export class StandeesLayer {
  /**
   * @param {object} shared  shared lit uniforms
   * @param {() => void} onChange  called when async art lands
   */
  constructor(shared, onChange) {
    this.shared = shared;
    this.onChange = onChange;
    this.group = new THREE.Group();
    this.group.name = "dio.standees";
    this.facing = { value: new THREE.Vector3(0, 0, 1) };
    this.size = 100;
    this.entries = new Map();
    /** url → { promise, card, texture, refs } */
    this.art = new Map();
    /** url → readable canvas | null (icons) */
    this.icons = new Map();
    this.iconWait = new Set();
    this.ghosts = true;
    this.geo = {
      card: (() => { const g = new THREE.PlaneGeometry(1, 1); g.translate(0, 0.5, 0); return g; })(),
      quad: unitQuad(),
      flat: (() => { const g = unitQuad(); g.rotateX(-Math.PI / 2); return g; })(),
      base: new THREE.CylinderGeometry(1, 1.04, BASE_H, 40, 1),
      // the flight stand's glass column: unit radius, y 0..1, no caps
      column: new THREE.CylinderGeometry(1, 1, 1, 24, 1, true),
      // effect-halo chips: one quad per atlas slot (uv x narrowed to slot i)
      chips: Array.from({ length: HALO_MAX }, (_, i) => {
        const g = unitQuad();
        const uv = g.attributes.uv;
        for (let v = 0; v < uv.count; v++) uv.setX(v, (i + uv.getX(v)) / HALO_MAX);
        return g;
      }),
    };
    this.geo.base.translate(0, BASE_H / 2, 0);
    this.geo.column.translate(0, 0.5, 0);
    const sc = shadowCanvas();
    this.shadowTex = sc ? new THREE.CanvasTexture(sc) : null;
    const ss = shadowSoftCanvas();
    this.shadowSoftTex = ss ? new THREE.CanvasTexture(ss) : null;
    /** Landing dust, one pool for every standee. */
    this.dust = new DustLayer(shared);
    this.group.add(this.dust.group);
    /** (x, z) cells → the ground there (cells) or NaN; the renderer's rules ground. */
    this.ground = null;
    /** Token life, landing dust and flyer hover, as the last frame was told. */
    this._life = true;
    this._dust = true;
    this._hover = true;
    this._hv = { dy: 0, roll: 0 };
    /**
     * Shadow casters: one upright copy of each card turned to face the sun,
     * alpha-tested so the cast shadow is the figure's silhouette. They live in
     * their own scene because the shadow pass draws the main scene with one
     * override material, which would cast every card as a rectangle.
     */
    this.casters = new THREE.Scene();
    this.casters.name = "dio.casters";
    /** True when a caster moved or changed shape since the last shadow pass. */
    this.castersDirty = true;
    /** World units per device pixel, written by the renderer each frame. */
    this.pxWorld = 0.01;
    /** True while a reticle is up (the renderer claims motion for its breathe). */
    this.targeted = false;
    this._lastNow = 0;
  }

  setGridSize(size) { this.size = size || 100; }

  /**
   * Where the ground is, so a walk follows stairs and finds the ledge it steps
   * off: (x, z) in cells → ground height in cells, or NaN where unknown.
   * Without it a drop past a step falls at the last step of the move.
   */
  setGround(fn) { this.ground = typeof fn === "function" ? fn : null; }

  /** The ground under a figure `w` cells wide at (x, z): the highest it covers. */
  groundUnder(x, z, w) {
    const f = this.ground;
    if (!f) return NaN;
    let g = f(x, z);
    if (w > 1.25) {
      const o = w / 2 - 0.25;
      for (let a = -1; a <= 1; a += 2) for (let b = -1; b <= 1; b += 2) {
        const v = f(x + a * o, z + b * o);
        if (Number.isFinite(v) && !(v <= g)) g = v;
      }
    }
    return g;
  }

  setGhosts(on) {
    this.ghosts = on !== false;
    for (const e of this.entries.values()) this.applyLook(e);
  }

  /**
   * @param {object[]} tokens TokenState[]
   * @param {number} now
   * @param {boolean} animate
   */
  set(tokens, now, animate = true) {
    const seen = new Set();
    for (const t of Array.isArray(tokens) ? tokens : []) {
      if (!t || t.id == null) continue;
      const id = String(t.id);
      seen.add(id);
      let e = this.entries.get(id);
      if (!e) e = this.build(id);
      this.update(e, t, now, animate);
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.drop(id);
  }

  build(id) {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const shared = this.shared;
    const base = new THREE.Mesh(this.geo.base, MATERIALS.solid(shared, { color: PALETTE.ink2 }));
    base.userData.tokenId = id;
    const ring = new THREE.Mesh(this.geo.flat, MATERIALS.ring(shared, { inner: 0.8, outer: 0.97, soft: 0.03 }));
    ring.position.y = BASE_H + 0.004;
    const turn = new THREE.Mesh(this.geo.flat, MATERIALS.ring(shared, { inner: 0.86, outer: 0.98, soft: 0.04 }));
    turn.position.y = 0.012;
    const glow = new THREE.Mesh(this.geo.flat, MATERIALS.ring(shared, { inner: 0.5, outer: 0.95, soft: 0.2, fill: 1, additive: true, opacity: 0.35 }));
    glow.position.y = 0.01;
    const shadow = new THREE.Mesh(this.geo.flat, MATERIALS.unlit(shared, { map: this.shadowTex, color: "#ffffff", opacity: 0.9 }));
    shadow.position.y = 0.008;
    shadow.renderOrder = 2;
    // the soft, wide half of the shadow, faded in with altitude (placeShadowSoft)
    const shadowSoft = new THREE.Mesh(this.geo.flat, MATERIALS.unlit(shared, { map: this.shadowSoftTex, color: "#ffffff", opacity: 0 }));
    shadowSoft.position.y = 0.007;
    shadowSoft.renderOrder = 2;
    shadowSoft.visible = false;
    // The card, its x-ray (drawn only where hidden) and its glow: one program,
    // three modes, one margin uniform shared by reference.
    const margin = { value: new THREE.Vector2(0, 0) };
    const card = new THREE.Mesh(this.geo.card, MATERIALS.card(shared, { facing: this.facing, margin }));
    card.position.y = BASE_H;
    card.userData.tokenId = id;
    card.visible = false;
    const xray = new THREE.Mesh(this.geo.card, MATERIALS.card(shared, { facing: this.facing, margin, mode: "xray" }));
    xray.renderOrder = 29;
    const aura = new THREE.Mesh(this.geo.card, MATERIALS.card(shared, { facing: this.facing, margin, mode: "glow" }));
    aura.renderOrder = 6;
    aura.visible = false;
    for (const m of [xray, aura]) { m.raycast = () => {}; m.frustumCulled = false; }
    card.frustumCulled = false;
    card.add(xray, aura);
    const plate = new THREE.Mesh(this.geo.quad, MATERIALS.unlit(shared, { depthTest: false }));
    plate.renderOrder = 30;
    plate.visible = false;
    // The target reticle on the ground, and the effect-halo chips on the ring.
    const reticle = new THREE.Mesh(this.geo.flat, MATERIALS.reticle(shared));
    reticle.renderOrder = 3;
    reticle.visible = false;
    const chipMat = MATERIALS.unlit(shared);
    chipMat.depthWrite = false;
    const chips = this.geo.chips.map((g) => {
      const m = new THREE.Mesh(g, chipMat);
      m.renderOrder = 7;
      m.visible = false;
      m.scale.set(CHIP, CHIP, 1);
      return m;
    });
    body.add(card);
    root.add(shadowSoft, shadow, glow, turn, base, ring, reticle, plate, ...chips);
    // Flight: a glass stand down to the ground, its foot, and the squares below.
    // Never in SHADOW_LAYER or the casters scene: clear glass casts nothing.
    const stand = new THREE.Group();
    stand.visible = false;
    const column = new THREE.Mesh(this.geo.column, MATERIALS.glass(shared));
    column.userData.tokenId = id;
    column.renderOrder = 4;
    const foot = new THREE.Mesh(this.geo.flat, MATERIALS.ring(shared, { color: STAND_FOOT, inner: 0, outer: 0.92, soft: 0.06, fill: 1, opacity: 0.22 }));
    const footRim = new THREE.Mesh(this.geo.flat, MATERIALS.ring(shared, { color: "#ffffff", inner: 0.84, outer: 0.95, soft: 0.04, opacity: 0.7 }));
    const footprint = new THREE.Mesh(this.geo.flat, MATERIALS.footprint(shared));
    footprint.renderOrder = 1;
    foot.renderOrder = 2; footRim.renderOrder = 3;
    stand.add(footprint, foot, footRim, column);
    root.add(stand);
    this.group.add(root);
    const caster = new THREE.Mesh(this.geo.card, new THREE.MeshBasicMaterial({
      alphaTest: 0.5, side: THREE.DoubleSide, colorWrite: false,
    }));
    caster.visible = false;
    caster.matrixAutoUpdate = true;
    this.casters.add(caster);
    const e = {
      id, root, body, base, ring, turn, glow, shadow, shadowSoft, card, plate, caster,
      // token life: the pose a move writes each frame, the last contact's squash, the hover's weight
      pose: { x: 0, z: 0, y: 0, g: 0, lift: 0, hop: 0, seg: -1 }, squash: { t0: 0, amp: 0 }, hoverW: -1,
      stand, column, foot, footRim, footprint, flying: false,
      xray, aura, margin, reticle, chips, chipMat, chipCanvas: null, chipTex: null, chipCount: 0, haloSig: "",
      look: null, lookTo: null,
      state: null, artUrl: null, cardData: null,
      move: null, pos: null, phase: (hashStr(id) % 1000) / 1000 * Math.PI * 2,
      plateSig: "", plateCanvas: null, plateTex: null, plateH: 0, cardH: 1, cardW: 1, cardFoot: 0,
    };
    this.entries.set(id, e);
    return e;
  }

  update(e, t, now, animate) {
    const S = this.size;
    const target = { x: Number(t.x) / S, z: Number(t.y) / S, y: Number(t.footQ ?? 0) / 4 };
    if (!Number.isFinite(target.x) || !Number.isFinite(target.z)) { target.x = 0; target.z = 0; }
    if (!Number.isFinite(target.y)) target.y = 0;
    // g: the ground under it. A missing groundQ means "standing on it".
    const gq = Number(t.groundQ);
    target.g = t.groundQ != null && Number.isFinite(gq) ? gq / 4 : target.y;
    // Just set down: the token's old position may still be arriving; it is not a move.
    const aw = e.awaitMove;
    const stale = !!aw && now < aw.until && Math.hypot(target.x - aw.from.x, target.z - aw.from.z) < 0.02
      && Math.abs(target.y - aw.from.y) < 0.02;
    if (aw && !stale) e.awaitMove = null;
    if (e.hold) e.heldTarget = { ...target };
    else if (stale) aw.last = { ...target }; // kept: if the move never comes, it goes back there (frame)
    else if (!e.pos) e.pos = { ...target };
    else if (target.x !== e.move?.to.x || target.z !== e.move?.to.z || target.y !== e.move?.to.y) {
      const from = this.current(e, now);
      const d = Math.hypot(target.x - from.x, target.z - from.z);
      if (!animate || d < 1e-4 && Math.abs(target.y - from.y) < 1e-4) {
        e.move = null; e.pos = { ...target };
      } else {
        const steps = Math.max(1, Math.min(MAX_STEPS, Math.round(d)));
        e.move = { from, to: target, t0: now, ms: TIMING.standeeStep * steps, hops: d >= 0.5 ? steps : 0 };
      }
    }
    if (!e.move && !e.hold && !stale) e.pos = { ...target };
    const width = Math.max(0.25, Number(t.widthCells) || 1);
    e.width = width;
    const r = width * 0.4;
    e.base.scale.set(r, 1, r);
    e.ring.scale.set(r * 2, 1, r * 2);
    e.turn.scale.set(r * 2.5, 1, r * 2.5);
    e.glow.scale.set(r * 3, 1, r * 3);
    e.shadow.scale.set(r * 3.1, 1, r * 3.1);
    e.heightCells = Math.max(0.3, (Number(t.heightQ) || 4) / 4);
    e.state = t;
    // art: one card per url and marks, so two actors sharing art with different marks each get their own
    const url = t.art ? String(t.art) : "";
    const marks = url ? cardMarks(t) : null;
    const artKey = `${url}|${url ? "" : t.name ?? ""}|${marks ? `${marks.top},${marks.bottom}` : ""}`;
    if (artKey !== e.artUrl) {
      this.releaseArt(e.artUrl);
      e.artUrl = artKey;
      e.card.visible = false;
      this.acquireArt(artKey, url, t.name, marks).then((entry) => {
        if (e.artUrl !== artKey || !this.entries.has(e.id) || !entry.texture) return;
        e.cardData = entry.card;
        for (const m of [e.card, e.xray, e.aura]) m.material.uniforms.uCard.value = entry.texture;
        e.card.visible = true;
        e.caster.material.map = entry.texture;
        e.caster.material.needsUpdate = true;
        this.castersDirty = true;
        this.layoutCard(e);
        this.onChange?.();
      });
    }
    this.layoutCard(e);
    this.applyLook(e);
    this.updatePlate(e);
    this.updateHalo(e);
  }

  current(e, now) {
    if (!e.move) return { ...e.pos };
    const q = poseAt(this.planOf(e), now - e.move.t0, e.pose, this._life);
    return { x: q.x, z: q.z, y: q.y, g: q.g };
  }

  /**
   * The move's plan (render/life.mjs), built on first use: a move started
   * anywhere (update, endHold) is planned from where it starts, with the ground
   * along its path. Its duration is the plan's (a fall takes longer than a step).
   */
  planOf(e) {
    const m = e.move;
    if (m.plan) return m.plan;
    const w = e.width ?? 1;
    const ground = this.ground ? (x, z) => this.groundUnder(x, z, w) : null;
    m.plan = planMove(m.from, m.to, { stepMs: TIMING.standeeStep, fallMs: TIMING.standeeFall, flyer: !!e.flying, maxSteps: MAX_STEPS, ground });
    m.ms = Math.max(1, m.plan.ms);
    m.contact = 0;
    return m.plan;
  }

  /**
   * Advance a move to `now`: fire every contact it passed (at the moment it
   * happened), then write the pose into e.pose. @returns {object|null} the
   * pose, or null when the move just ended (e.pos is then where it stands)
   */
  stepMove(e, now) {
    const m = e.move;
    const plan = this.planOf(e);
    const tms = now - m.t0;
    const segs = plan.segs;
    while (m.contact < segs.length && segs[m.contact].t1 <= tms) {
      const s = segs[m.contact++];
      this.touchDown(e, m.t0 + s.t1, s.x1, s.g1, s.z1, s.land, s.dust);
    }
    if (tms >= m.ms) {
      e.pos = { ...m.to };
      e.move = null;
      return null;
    }
    return poseAt(plan, tms, e.pose, this._life);
  }

  /**
   * A contact: the card squashes by `amp` and springs back, and dust rises at
   * (x, y, z) with `dust` strength. `at` is when it happened (ms), so a frame
   * that arrives late still shows it at the right point of its life.
   */
  touchDown(e, at, x, y, z, amp, dust) {
    if (!this._life) return;
    if (amp > 0) { e.squash.t0 = at; e.squash.amp = amp; }
    if (dust > 0 && this._dust && e.root.visible && !e.state?.ghost) this.dust.emit(x, y, z, (e.width ?? 1) * 0.4, dust, at);
  }

  layoutCard(e) {
    const l = cardLayout(e.cardData, e.heightCells, e.width);
    e.cardH = l.h; e.cardW = l.w; e.cardFoot = l.foot;
    e.card.scale.set(l.w, l.h, 1);
    e.card.position.y = BASE_H - l.foot;
    if (e.plateH) {
      const pw = PLATE_W;
      e.plate.scale.set(pw, pw * e.plateH, 1);
      e.plate.position.y = BASE_H + l.h - l.foot + 0.1 + (pw * e.plateH) / 2;
    }
  }

  applyLook(e) {
    const t = e.state;
    if (!t) return;
    const ghost = !!t.ghost;
    const shown = (t.visible !== false || ghost) && (!ghost || this.ghosts);
    e.root.visible = shown;
    const disp = dispositionColor(t.disposition);
    const ru = e.ring.material.uniforms;
    ru.uColor.value.set(...rgb(t.controlled ? lighten(disp, 0.35) : disp));
    ru.uOpacity.value = t.controlled ? 1 : 0.82;
    ru.uInner.value = t.controlled ? 0.68 : 0.8;
    const tc = turnColor(t.turn);
    e.turn.visible = !!tc;
    if (tc) e.turn.material.uniforms.uColor.value.set(...rgb(tc));
    e.glow.visible = !!t.hovered || !!t.controlled;
    e.glow.material.uniforms.uColor.value.set(...rgb(disp));
    e.glow.material.uniforms.uOpacity.value = t.hovered ? 0.45 : 0.22;
    const cu = e.card.material.uniforms;
    cu.uGhost.value = ghost ? 1 : 0;
    cu.uOpacity.value = ghost ? 0.4 : 1;
    e.card.material.transparent = ghost;
    e.card.material.depthWrite = !ghost;
    e.card.material.alphaToCoverage = !ghost;
    // Outline, glow and lift: a target the frame loop damps towards.
    const o = outlineLook(t);
    const to = { r: o.rgb[0], g: o.rgb[1], b: o.rgb[2], xr: o.xray[0], xg: o.xray[1], xb: o.xray[2],
      w: o.width, glow: o.glow, lift: t.hovered ? 0.14 : t.controlled ? 0.06 : 0 };
    e.lookTo = to;
    if (!e.look) e.look = { ...to };
    e.xray.visible = !ghost;
    // the reticle: under a targeted token, in the first targeter's colour
    e.reticle.visible = o.state === "targeted" && !ghost;
    if (e.reticle.visible) {
      e.reticle.material.uniforms.uColor.value.set(...o.rgb);
      const R = (e.width ?? 1) * 0.55 + 0.08;
      e.reticle.scale.set((2 * R) / RETICLE_R, 1, (2 * R) / RETICLE_R);
    }
    e.base.material.uniforms.uOpacity.value = ghost ? 0.4 : 1;
    e.base.material.transparent = ghost;
    e.shadowOpacity = ghost ? 0.35 : 0.9;
    e.shadow.material.uniforms.uOpacity.value = e.shadowOpacity;
    // the flight stand: glass lightly tinted by disposition, the squares in it
    const gk = ghost ? 0.4 : 1;
    e.column.material.uniforms.uColor.value.set(...rgb(disp));
    e.column.material.uniforms.uOpacity.value = gk;
    e.foot.material.uniforms.uOpacity.value = 0.22 * gk;
    e.footRim.material.uniforms.uOpacity.value = 0.7 * gk;
    e.footprint.material.uniforms.uColor.value.set(...rgb(t.controlled ? lighten(disp, 0.25) : disp));
    e.footprint.material.uniforms.uOpacity.value = (t.hovered || t.controlled ? 1 : 0.8) * gk;
  }

  /**
   * Is this standee in the air? Flying = its feet at least 1 q above the ground
   * under it. Pure, for the check tool.
   */
  static isFlying(footY, groundY) {
    return Number.isFinite(footY) && Number.isFinite(groundY) && footY - groundY >= FLY_MIN - 1e-6;
  }

  /**
   * The squares a creature of `width` cells covers, centred at x/z (cells):
   * whole cells, snapped to the grid. Pure, for the check tool.
   * @returns {{n:number, x0:number, z0:number}}
   */
  static footprintOf(x, z, width) {
    const n = Math.max(1, Math.round(Number(width) || 1));
    return { n, x0: Math.round(x - n / 2), z0: Math.round(z - n / 2) };
  }

  /**
   * Place the flight stand (or hide it) for the standee's current position.
   * A miniature in the hand hangs over where it will land: the stand's tether
   * down to a filled spot and the squares it covers, all in the colour of its
   * hold's tone (red where setting it down is out of reach), on every screen
   * that draws the hold.
   */
  placeStand(e, p, held = false) {
    const g = Number.isFinite(p.g) ? p.g : p.y;
    const alt = p.y - g;
    const airborne = StandeesLayer.isFlying(p.y, g);
    // A held miniature keeps what it was (a flyer stays grabbable by its foot).
    const flying = held ? e.flying && airborne : airborne;
    e.flying = held ? e.flying : flying;
    const landing = held && !!e.hold && airborne;
    e.stand.visible = flying || landing;
    if (landing) {
      const col = rgb(HOLD_TONES[e.hold.tone] ?? HOLD_TONES.info);
      e.column.material.uniforms.uColor.value.set(...col);
      e.foot.material.uniforms.uColor.value.set(...col);
      e.foot.material.uniforms.uOpacity.value = 0.4;
      e.footRim.material.uniforms.uColor.value.set(...col);
      e.footRim.material.uniforms.uOpacity.value = 1;
      e.footprint.material.uniforms.uColor.value.set(...col);
      e.footprint.material.uniforms.uOpacity.value = 1;
    }
    const r = (e.width ?? 1) * 0.4;
    const k = airborne ? 1 / (1 + alt * 0.45) : 1;
    // The contact shadow stays on the ground, smaller and fainter the higher up.
    e.shadow.position.y = (airborne ? g - p.y : 0) + 0.008;
    e.shadow.scale.set(r * 3.1 * (0.5 + 0.5 * k), 1, r * 3.1 * (0.5 + 0.5 * k));
    e.shadow.material.uniforms.uOpacity.value = (e.shadowOpacity ?? 0.9) * (0.35 + 0.65 * k);
    // the reticle marks the ground under the target, flying or not
    e.reticle.position.y = (airborne ? g - p.y : 0) + 0.022;
    if (!flying && !landing) return;
    const dy = g - p.y;
    const rc = (landing ? 0.03 : 0.045) * Math.sqrt(e.width ?? 1);
    e.column.position.y = dy;
    e.column.scale.set(rc, Math.max(0.01, alt), rc);
    e.column.material.uniforms.uGround.value = g;
    const fr = (landing ? 0.44 : 0.3) * Math.sqrt(e.width ?? 1);
    e.foot.position.y = dy + 0.014; e.foot.scale.set(fr, 1, fr);
    e.footRim.position.y = dy + 0.016; e.footRim.scale.set(fr, 1, fr);
    const f = StandeesLayer.footprintOf(p.x, p.z, e.width);
    e.footprint.position.set(f.x0 + f.n / 2 - p.x, dy + 0.012, f.z0 + f.n / 2 - p.z);
    e.footprint.scale.set(f.n, 1, f.n);
    e.footprint.material.uniforms.uSize.value = f.n;
  }

  updatePlate(e) {
    const t = e.state;
    // In halo mode the conditions sit on the ring; the plate keeps pips and bars.
    const conditions = t.halo ? [] : t.conditions ?? [];
    const sig = JSON.stringify([t.targets ?? [], conditions, t.bars ?? [],
      conditions.map((c) => (this.icons.has(c?.icon) ? 1 : 0))]);
    if (sig === e.plateSig) return;
    e.plateSig = sig;
    for (const c of conditions) if (c?.icon) this.wantIcon(c.icon);
    if (typeof document === "undefined") return;
    const drawn = drawPlate(e.plateCanvas, { targets: t.targets, bars: t.bars, conditions }, (url) => this.icons.get(url));
    if (!drawn) { e.plate.visible = false; e.plateH = 0; return; }
    e.plateCanvas = drawn.canvas;
    e.plateH = drawn.height / PLATE_PX;
    if (!e.plateTex || e.plateTex.image !== drawn.canvas
      || e.plateTex.image.width !== e.plateTexW || e.plateTex.image.height !== e.plateTexH) {
      e.plateTex?.dispose();
      e.plateTex = new THREE.CanvasTexture(drawn.canvas);
      e.plateTex.anisotropy = 4;
      e.plateTexW = drawn.canvas.width; e.plateTexH = drawn.canvas.height;
    }
    e.plateTex.needsUpdate = true;
    const u = e.plate.material.uniforms;
    u.uTex.value = e.plateTex; u.uUseTex.value = 1;
    e.plate.visible = true;
    this.layoutCard(e);
  }

  /**
   * The effect halo: in halo mode, t.conditions as round chips along the
   * camera-facing front of the base ring (placed per frame in placeHalo).
   */
  updateHalo(e) {
    const t = e.state;
    const list = t.halo ? (t.conditions ?? []).filter((c) => c && c.icon).slice(0, HALO_MAX) : [];
    const sig = JSON.stringify([list, list.map((c) => (this.icons.has(c.icon) ? 1 : 0))]);
    if (sig === e.haloSig) return;
    e.haloSig = sig;
    for (const c of list) this.wantIcon(c.icon);
    e.chipCount = list.length;
    for (let i = 0; i < e.chips.length; i++) e.chips[i].visible = false;
    if (!list.length || typeof document === "undefined") return;
    const drawn = drawChips(e.chipCanvas, list, (url) => this.icons.get(url));
    if (e.chipTex?.image !== drawn.canvas) {
      e.chipTex?.dispose();
      e.chipTex = new THREE.CanvasTexture(drawn.canvas);
      e.chipTex.anisotropy = 4;
    }
    e.chipCanvas = drawn.canvas;
    e.chipTex.needsUpdate = true;
    const u = e.chipMat.uniforms;
    u.uTex.value = e.chipTex; u.uUseTex.value = 1;
  }

  /** Place the halo chips for the camera's yaw: billboards on the ring's front. */
  placeHalo(e, yaw, camera) {
    const n = e.chipCount;
    if (!n || !e.root.visible || e.state?.ghost) {
      for (let i = 0; i < e.chips.length; i++) e.chips[i].visible = false;
      return;
    }
    const ringR = (e.width ?? 1) * 0.4 + 0.1;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);     // towards the camera
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);    // screen right
    for (let i = 0; i < e.chips.length; i++) {
      const c = e.chips[i];
      if (i >= n) { c.visible = false; continue; }
      const s = haloSlot(i, n, ringR);
      const ca = Math.cos(s.angle) * s.radius, sa = Math.sin(s.angle) * s.radius;
      c.position.set(fx * ca + rx * sa, CHIP * 0.42, fz * ca + rz * sa);
      c.quaternion.copy(camera.quaternion);
      c.visible = true;
    }
  }

  wantIcon(url) {
    if (this.icons.has(url) || this.iconWait.has(url)) return;
    this.iconWait.add(url);
    loadDrawable(url).then((c) => {
      this.iconWait.delete(url);
      this.icons.set(url, c);
      for (const e of this.entries.values()) {
        if ((e.state?.conditions ?? []).some((x) => x?.icon === url)) {
          e.plateSig = ""; this.updatePlate(e);
          e.haloSig = ""; this.updateHalo(e);
        }
      }
      this.onChange?.();
    });
  }

  acquireArt(key, url, name, marks = null) {
    let a = this.art.get(key);
    if (!a) {
      a = { refs: 0, texture: null, card: null, promise: null };
      a.promise = (url ? loadDrawable(url) : Promise.resolve(null)).then((img) => {
        let card;
        try { card = composeCard(img, name, marks); } catch { card = composeCard(null, name); }
        a.card = card;
        a.texture = new THREE.CanvasTexture(card.canvas);
        a.texture.anisotropy = 4;
        return a;
      }).catch(() => a);   // no DOM (Node): no card, never an unhandled rejection
      this.art.set(key, a);
    }
    a.refs++;
    return a.promise;
  }

  releaseArt(key) {
    if (!key) return;
    const a = this.art.get(key);
    if (!a) return;
    if (--a.refs > 0) return;
    this.art.delete(key);
    a.promise.then(() => a.texture?.dispose());
  }

  drop(id) {
    const e = this.entries.get(id);
    if (!e) return;
    this.group.remove(e.root);
    this.casters.remove(e.caster);
    this.castersDirty = true;
    for (const m of [e.base, e.ring, e.turn, e.glow, e.shadow, e.shadowSoft, e.card, e.xray, e.aura, e.plate, e.caster,
      e.column, e.foot, e.footRim, e.footprint, e.reticle]) m.material.dispose();
    e.chipMat.dispose();
    e.chipTex?.dispose();
    e.plateTex?.dispose();
    this.releaseArt(e.artUrl);
    this.entries.delete(id);
  }

  /**
   * Per frame: billboards, moves, sway.
   * @returns {boolean} true while something moves
   */
  frame(now, camera, yaw, sway, { pxWorld = this.pxWorld, markers = true, life = true, dust = true, hover = true } = {}) {
    this._life = life !== false;
    this._dust = this._life && dust !== false;
    this._hover = this._life && hover !== false;
    if (!this._dust) this.dust.clear();
    this.facing.value.set(Math.sin(yaw), 0, Math.cos(yaw));
    camera.getWorldDirection(_dir);
    const lean = Math.min(MAX_LEAN, Math.max(0, Math.asin(Math.max(-1, Math.min(1, -_dir.y)))));
    const k = this.shared.uKeyDir.value;
    const sunYaw = Math.atan2(k.x, k.z);
    let active = false;
    const t = now / 1000;
    const dt = this._lastNow ? Math.max(0, Math.min(0.1, (now - this._lastNow) / 1000)) : 1;
    this._lastNow = now;
    const follow = 1 - Math.exp(-FOLLOW * dt);
    if (Number.isFinite(pxWorld) && pxWorld > 0) this.pxWorld = pxWorld;
    const marginW = MARGIN_PX * this.pxWorld;
    // The reticle arrows' breathe: a whole sine per TIMING.reticleBreathe.
    const P = TIMING.reticleBreathe;
    const breathe = markers ? BREATHE_PX * Math.sin(((now % P) / P) * Math.PI * 2) : 0;
    let targeted = false;
    for (const e of this.entries.values()) {
      if (this.followLook(e, follow)) active = true;
      e.margin.value.set(marginW / Math.max(0.05, e.cardW), marginW / Math.max(0.05, e.cardH));
      if (e.reticle.visible && e.root.visible) {
        targeted = true;
        e.reticle.rotation.y = yaw;
        e.reticle.material.uniforms.uBreathe.value = breathe;
      }
      this.placeHalo(e, yaw, camera);
      // Set down and the move never came (Foundry refused it): back to where the token is.
      const aw = e.awaitMove;
      if (aw) {
        if (now < aw.until) active = true;
        else {
          e.awaitMove = null;
          const to = aw.last ?? aw.from;
          const d = Math.hypot(to.x - e.pos.x, to.z - e.pos.z);
          if (d > 1e-4 || Math.abs(to.y - e.pos.y) > 1e-4) {
            const steps = Math.max(1, Math.min(MAX_STEPS, Math.round(d)));
            e.move = { from: { ...e.pos }, to: { ...to }, t0: now, ms: TIMING.standeeStep * steps, hops: d >= 0.5 ? steps : 0 };
            active = true;
          }
        }
      }
      let p = e.pos, hop = 0, lift = 0;
      if (e.hold && this.stepHold(e, now, dt)) active = true;
      const h = e.hold;
      if (h) {
        p = { x: h.x, z: h.z, y: h.y + h.lift + (h.bob ?? 0), g: h.g };
      } else if (e.move) {
        // life: the whole miniature hops (lift); off: the old card-only bounce (hop)
        const q = this.stepMove(e, now);
        if (q) { p = q; lift = q.lift; hop = q.hop; active = true; } else p = e.pos;
      }
      e.root.position.set(p.x, p.y, p.z);
      e.body.position.y = hop;
      this.placeStand(e, p, !!h);
      // A flyer breathes on its stand; never while in the hand.
      if (this.stepHover(e, now, dt, !h)) active = true;
      const rise = lift + (e.hoverW > 0 ? this._hv.dy * e.hoverW : 0);
      this.placeShadowSoft(e, p);
      if (rise !== 0) this.raise(e, rise, lift);
      // the card's squash since its last contact, springing back
      // in the hand: a stretch as it leaves the table (negative squash)
      const s = h ? -(h.stretch ?? 0) : squashAt(e.squash.amp, now - e.squash.t0);
      if (h || s > 0) active = true; else e.squash.amp = 0;
      e.body.scale.set(1 + s * 0.5, 1 - s, 1 + s * 0.5);
      // YXZ: turn to the camera's yaw, then lean back about the card's own x axis.
      e.card.rotation.order = "YXZ";
      e.card.rotation.set(-lean, yaw, 0);
      e.body.rotation.z = 0;
      if (h) {
        // Carried: the figure leans into the hand's motion, as a mini held by its top does.
        const cl = (v) => Math.max(-HOLD_LEAN_MAX, Math.min(HOLD_LEAN_MAX, v * HOLD_LEAN));
        e.body.rotation.set(cl(h.vz), 0, cl(-h.vx));
      } else if (sway && e.root.visible) {
        e.body.rotation.set(0, 0, Math.sin(t * 1.25 + e.phase) * SWAY);
        e.card.rotation.y = yaw + Math.sin(t * 0.8 + e.phase * 1.7) * SWAY * 0.6;
      } else {
        e.body.rotation.set(0, 0, 0);
      }
      if (!h && e.hoverW > 0) e.body.rotation.z += this._hv.roll * e.hoverW;
      e.plate.quaternion.copy(camera.quaternion);
      // Above the card's leaned top, along the card's own up axis.
      const along = (e.cardH ?? 1) - (e.cardFoot ?? 0) + 0.1 + (PLATE_W * (e.plateH ?? 0)) / 2;
      const back = Math.sin(lean) * along;
      e.plate.position.set(-back * Math.sin(yaw), BASE_H + Math.cos(lean) * along, -back * Math.cos(yaw));
      // the hover is left out of the cast shadow: it would redraw the shadow map every frame
      this.placeCaster(e, p, hop + lift, sunYaw);
    }
    if (this.dust.frame(now, camera)) active = true;
    this.lean = lean;
    this.yaw = yaw;
    this.targeted = targeted;
    return active;
  }

  /**
   * A flyer's hover weight follows 1 while it may hover (a flyer on its stand,
   * not in the hand, hover allowed) and 0 otherwise, damped so it never snaps
   * in or out; this._hv is this entry's breathe and roll at full weight.
   * @returns {boolean} true while the hover moves or fades
   */
  stepHover(e, now, dt, free) {
    const want = this._hover && free && e.flying && e.root.visible ? 1 : 0;
    if (e.hoverW < 0) e.hoverW = want;   // first frame: start where it should be
    else if (e.hoverW !== want) {
      e.hoverW += (want - e.hoverW) * (1 - Math.exp(-FOLLOW * dt));
      if (Math.abs(want - e.hoverW) < 1e-3) e.hoverW = want;
    }
    if (e.hoverW > 0) hoverPose(now, e.phase, this._hv);
    else { this._hv.dy = 0; this._hv.roll = 0; }
    return e.hoverW > 0;
  }

  /**
   * Raise the figure by `dy` (a hop's lift plus the hover) while everything that
   * marks the ground stays on it: the shadows, the reticle, and a flyer's stand,
   * whose column reaches up to the raised feet. A hopping walker's contact
   * shadow tightens and fades a little while it is off the table.
   */
  raise(e, dy, lift) {
    e.root.position.y += dy;
    e.shadow.position.y -= dy;
    e.shadowSoft.position.y -= dy;
    e.reticle.position.y -= dy;
    if (lift > 0) {
      const k = Math.max(0.6, 1 - lift * 2.2);
      e.shadow.scale.x *= k; e.shadow.scale.z *= k;
      e.shadow.material.uniforms.uOpacity.value *= k;
    }
    if (!e.stand.visible) return;
    e.column.position.y -= dy;
    e.column.scale.y = Math.max(0.01, e.column.scale.y + dy);
    e.foot.position.y -= dy;
    e.footRim.position.y -= dy;
    e.footprint.position.y -= dy;
  }

  /**
   * The soft half of the ground shadow: under a figure in the air (a flyer, or
   * one in the hand), wider and stronger the higher it is, while the contact
   * shadow above it shrinks and fades (placeStand). Together they read as a
   * shadow that softens with altitude.
   */
  placeShadowSoft(e, p) {
    const s = e.shadowSoft;
    const g = Number.isFinite(p.g) ? p.g : p.y;
    const alt = p.y - g;
    if (!e.root.visible || !StandeesLayer.isFlying(p.y, g)) { s.visible = false; return; }
    const k = 1 / (1 + alt * 0.45);
    const r = (e.width ?? 1) * 0.4;
    const w = r * 3.1 * (1.15 + 0.9 * (1 - k));
    s.visible = true;
    s.position.y = g - p.y + 0.007;
    s.scale.set(w, 1, w);
    s.material.uniforms.uOpacity.value = (e.shadowOpacity ?? 0.9) * (1 - k) * 0.7;
  }

  /**
   * Damp the outline, glow and lift towards their target (x += (to - x) * k,
   * k = 1 - e^(-FOLLOW·dt)), then write them. @returns {boolean} still moving
   */
  followLook(e, k) {
    const to = e.lookTo, cur = e.look;
    if (!to || !cur) return false;
    let moving = false;
    for (const key in to) {
      const d = to[key] - cur[key];
      if (Math.abs(d) < 1e-3) cur[key] = to[key];
      else { cur[key] += d * k; moving = true; }
    }
    const cu = e.card.material.uniforms;
    cu.uOutline.value.set(cur.r, cur.g, cur.b, cur.w);
    cu.uLift.value = cur.lift;
    const au = e.aura.material.uniforms;
    au.uOutline.value.set(cur.r, cur.g, cur.b, cur.w);
    au.uGlow.value = cur.glow * 0.85;
    e.aura.visible = cur.glow > 0.01 && !e.state?.ghost;
    e.xray.material.uniforms.uOutline.value.set(cur.xr, cur.xg, cur.xb, cur.w);
    return moving;
  }

  /** Stand a card's shadow caster upright at its feet, turned to the sun. */
  placeCaster(e, p, hop, sunYaw) {
    const c = e.caster;
    const ghost = !!e.state?.ghost;
    const vis = e.root.visible && e.card.visible && !ghost && !!c.material.map;
    const y = p.y + BASE_H - (e.cardFoot ?? 0) + hop;
    const sig = vis ? `${p.x.toFixed(3)},${y.toFixed(3)},${p.z.toFixed(3)},${e.cardW.toFixed(3)},${e.cardH.toFixed(3)},${sunYaw.toFixed(3)}` : "";
    if (sig === e.casterSig) return;
    e.casterSig = sig;
    this.castersDirty = true;
    c.visible = vis;
    if (!vis) return;
    c.position.set(p.x, y, p.z);
    c.rotation.set(0, sunYaw, 0);
    c.scale.set(e.cardW, e.cardH, 1);
  }

  get count() { return this.entries.size; }

  /**
   * Raycast cards then bases. @returns {string|null} token id
   */
  pick(raycaster) {
    return this.pickPart(raycaster)?.id ?? null;
  }

  /**
   * Raycast every part a hand could grab a miniature by: the card, the base,
   * and for a flyer its glass stand and the foot and squares on the ground
   * under it. `part` is "air" for a flyer's card, base or stand (it moves at
   * its altitude) and "ground" for anything on the table. `exclude`: a token
   * id to see through (the one in the hand).
   * @returns {{id:string, part:"air"|"ground"}|null}
   */
  pickPart(raycaster, exclude = null) {
    const objs = [], owner = new Map();
    const add = (o, e, part) => { objs.push(o); owner.set(o, { e, part }); };
    for (const e of this.entries.values()) {
      if (!e.root.visible || e.id === exclude) continue;
      const air = e.flying ? "air" : "ground";
      if (e.card.visible) add(e.card, e, air);
      add(e.base, e, air);
      if (e.stand.visible) {
        add(e.column, e, "air");
        add(e.foot, e, "ground");
        add(e.footprint, e, "ground");
      }
    }
    const hits = raycaster.intersectObjects(objs, false);
    for (const h of hits) {
      const o = owner.get(h.object);
      if (!o) continue;
      const { e, part } = o;
      if (h.object === e.card && h.uv && !maskHit(e.cardData?.mask, h.uv.x, h.uv.y)) continue;
      return { id: e.id, part };
    }
    return null;
  }

  /**
   * A miniature in a hand. `hold` = { x, y (px, foot centre), footQ, phase }:
   * phase "carry" lifts it off the table and follows (x, y) with damping;
   * "drop" lowers it onto (x, y, footQ) and lets go. null lets go at once.
   * While held, a token update only records where Foundry put it; the hand
   * hands the figure back to the ordinary move when it lands.
   */
  setHold(id, hold, now = performance.now()) {
    const e = this.entries.get(String(id));
    if (!e) return;
    if (!hold) { this.endHold(e, now); return; }
    const S = this.size;
    const to = { x: Number(hold.x) / S, z: Number(hold.y) / S, y: Number(hold.footQ ?? 0) / 4 };
    if (!Number.isFinite(to.x) || !Number.isFinite(to.z)) return;
    if (!Number.isFinite(to.y)) to.y = 0;
    const gq = Number(hold.groundQ);
    to.g = hold.groundQ != null && Number.isFinite(gq) ? gq / 4 : to.y;
    if (!e.hold) {
      const from = this.current(e, now);
      e.move = null;
      e.heldTarget = null;
      e.awaitMove = null;
      // where the token stood when it was picked up: until Foundry says otherwise, that is old news
      e.heldFrom = e.pos ? { ...e.pos } : { ...from };
      e.hold = { x: from.x, z: from.z, y: from.y, g: Number.isFinite(from.g) ? from.g : from.y,
        lift: 0, vx: 0, vz: 0, to, phase: "carry", t0: now };
    }
    const h = e.hold;
    h.to = to;
    h.tone = HOLD_TONES[hold.tone] ? hold.tone : "info";
    if (hold.phase === "drop" && h.phase !== "drop") { h.phase = "drop"; h.t0 = now; h.liftAt = h.lift; }
    else if (hold.phase !== "drop" && h.phase === "drop") { h.phase = "carry"; h.t0 = now; }
    this.onChange?.();
  }

  endHold(e, now) {
    const h = e.hold;
    if (!h) return;
    e.hold = null;
    // the landing spot goes back to being the flight stand's (applyLook's colours)
    e.footRim.material.uniforms.uColor.value.set(1, 1, 1);
    e.foot.material.uniforms.uColor.value.set(...rgb(STAND_FOOT));
    this.applyLook(e);
    const at = { x: h.x, z: h.z, y: h.y + h.lift, g: h.g };
    const target = e.heldTarget;
    const from = e.heldFrom;
    e.heldTarget = null;
    e.heldFrom = null;
    const near = (a, b) => !!a && !!b && Math.hypot(a.x - b.x, a.z - b.z) < 0.02 && Math.abs(a.y - b.y) < 0.02;
    // Set down somewhere new before the move has come back from Foundry: stay on the
    // square it was set down on, and let the token's old position (still arriving
    // in refreshes) not walk it back, for a moment.
    if (!near(at, from) && (!target || near(target, from))) {
      e.pos = { ...at, y: h.y };
      e.awaitMove = { from: { ...from }, until: now + TIMING.holdAwait };
      return;
    }
    if (!target) { e.pos = { ...at, y: h.y }; return; }
    const d = Math.hypot(target.x - at.x, target.z - at.z);
    if (d < 0.02 && Math.abs(target.y - h.y) < 0.02 && h.lift < 0.02) { e.pos = { ...target }; return; }
    // Foundry put it somewhere other than where the hand let go (a wall stopped it): walk there.
    const steps = Math.max(1, Math.min(MAX_STEPS, Math.round(d)));
    e.move = { from: at, to: target, t0: now, ms: TIMING.standeeStep * steps, hops: d >= 0.5 ? steps : 0 };
  }

  /** Step a held miniature one frame. @returns {boolean} still moving */
  stepHold(e, now, dt) {
    const h = e.hold;
    const k = 1 - Math.exp(-HOLD_FOLLOW * dt);
    const px = h.x, pz = h.z;
    h.x += (h.to.x - h.x) * k;
    h.z += (h.to.z - h.z) * k;
    h.y += (h.to.y - h.y) * k;
    h.g += (h.to.g - h.g) * k;
    const vx = dt > 0 ? (h.x - px) / dt : 0, vz = dt > 0 ? (h.z - pz) / dt : 0;
    const kv = 1 - Math.exp(-HOLD_SWING * dt);
    h.vx += (vx - h.vx) * kv; h.vz += (vz - h.vz) * kv;
    if (h.phase === "carry") {
      // up past its height and back: picked up by a hand, not raised on a lift
      const u = clamp01((now - h.t0) / TIMING.liftUp);
      const rise = HOLD_LIFT * (ease.outCubic(u) + HOLD_OVERSHOOT * Math.sin(Math.PI * u));
      h.lift = u < 1 ? Math.max(h.lift * (1 - u), rise) : HOLD_LIFT;
      h.stretch = HOLD_STRETCH * Math.sin(Math.PI * clamp01(u * 1.4));
      // a hand is never quite still: one slow breath per TIMING.holdBob
      h.bob = u < 1 ? 0 : HOLD_BOB * Math.sin(((now - h.t0 - TIMING.liftUp) / TIMING.holdBob) * Math.PI * 2);
    } else {
      h.stretch = 0;
      h.bob = 0;
      const u = clamp01((now - h.t0) / TIMING.liftDrop);
      // falls under gravity (ease in), with one small settle at the end
      const fall = (h.liftAt ?? HOLD_LIFT) * (1 - u * u);
      const settle = u > 0.82 ? Math.sin(((u - 0.82) / 0.18) * Math.PI) * 0.025 : 0;
      h.lift = Math.max(0, fall) + settle;
      if (u >= 1) {
        h.x = h.to.x; h.z = h.to.z; h.y = h.to.y; h.g = h.to.g; h.lift = 0;
        // set down on the table: a landing (a flyer set down at its altitude is not one)
        if (!StandeesLayer.isFlying(h.y, h.g)) this.touchDown(e, h.t0 + TIMING.liftDrop, h.x, h.y, h.z, SQUASH.drop, DUST.drop);
        this.endHold(e, now);
        return true;
      }
    }
    // in the hand it bobs, so it asks for frames until it is set down
    return true;
  }

  /**
   * A target line's anchor, written into `out` (no allocation): "chest" is
   * where the leaned card's chest reads on screen, "base" the top of the base.
   * @returns {boolean} false when the token is not on the board or not shown
   */
  anchorOf(id, which, out) {
    const e = this.entries.get(String(id));
    if (!e || !e.root.visible) return false;
    const p = e.root.position;
    if (which === "base") { out.set(p.x, p.y + BASE_H + 0.02, p.z); return true; }
    const lean = this.lean ?? 0, yaw = this.yaw ?? 0, along = ((e.cardH ?? 1) - (e.cardFoot ?? 0)) * 0.58;
    const back = Math.sin(lean) * along;
    out.set(p.x - back * Math.sin(yaw), p.y + e.body.position.y + BASE_H + Math.cos(lean) * along, p.z - back * Math.cos(yaw));
    return true;
  }

  /** World anchor above a token's head (for labels). */
  headOf(id) {
    const e = this.entries.get(id);
    // a standee this viewer is not shown anchors nothing (bubbles, badges, the HUD)
    if (!e || !e.root.visible) return null;
    // The card's leaned top, which is where it reads on screen.
    const lean = this.lean ?? 0, yaw = this.yaw ?? 0;
    const top = e.cardH - (e.cardFoot ?? 0);
    const back = Math.sin(lean) * top;
    return new THREE.Vector3(
      e.root.position.x - back * Math.sin(yaw),
      e.root.position.y + BASE_H + Math.cos(lean) * top,
      e.root.position.z - back * Math.cos(yaw),
    );
  }

  dispose() {
    for (const id of [...this.entries.keys()]) this.drop(id);
    this.casters.clear();
    for (const g of Object.values(this.geo)) (Array.isArray(g) ? g : [g]).forEach((x) => x.dispose());
    this.shadowTex?.dispose();
    this.shadowSoftTex?.dispose();
    this.dust.dispose();
    for (const a of this.art.values()) a.promise.then(() => a.texture?.dispose());
    this.art.clear();
  }
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function rgb(hex) {
  const c = new THREE.Color();
  c.setStyle(hex, THREE.NoColorSpace);
  return [c.r, c.g, c.b];
}
