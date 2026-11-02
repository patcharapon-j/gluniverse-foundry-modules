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
 * Position changes tween with a hop per grid step (TIMING.standeeStep); state
 * changes (outline, lift) follow with frame-rate independent damping.
 */

import * as THREE from "./three.mjs";
import { TIMING } from "../constants.mjs";
import { PALETTE, lighten, mix } from "../../../core/theme.mjs";
import { MATERIALS, cssRgb } from "./materials.mjs";
import { composeCard, drawChips, drawPlate, loadDrawable, maskHit, shadowCanvas, HALO_MAX, PLATE_PX } from "./art.mjs";
import { clamp01, lerp } from "./tween.mjs";

const BASE_H = 0.07;
const HOP = 0.14;
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
    root.add(shadow, glow, turn, base, ring, reticle, plate, ...chips);
    // Flight: a glass stand down to the ground, its foot, and the squares below.
    // Never in SHADOW_LAYER or the casters scene: clear glass casts nothing.
    const stand = new THREE.Group();
    stand.visible = false;
    const column = new THREE.Mesh(this.geo.column, MATERIALS.glass(shared));
    column.userData.tokenId = id;
    column.renderOrder = 4;
    const foot = new THREE.Mesh(this.geo.flat, MATERIALS.ring(shared, { color: "#dcecff", inner: 0, outer: 0.92, soft: 0.06, fill: 1, opacity: 0.22 }));
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
      id, root, body, base, ring, turn, glow, shadow, card, plate, caster,
      stand, column, foot, footRim, footprint, flying: false,
      xray, aura, margin, reticle, chips, chipMat, chipCanvas: null, chipTex: null, chipCount: 0, haloSig: "",
      look: null, lookTo: null,
      state: null, artUrl: null, cardData: null,
      move: null, pos: null, phase: (hashStr(id) % 1000) / 1000 * Math.PI * 2,
      plateSig: "", plateCanvas: null, plateTex: null, plateH: 0, cardH: 1, cardW: 1,
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
    if (!e.pos) e.pos = { ...target };
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
    if (!e.move) e.pos = { ...target };
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
    // art
    const url = t.art ? String(t.art) : "";
    const artKey = `${url}|${url ? "" : t.name ?? ""}`;
    if (artKey !== e.artUrl) {
      this.releaseArt(e.artUrl);
      e.artUrl = artKey;
      e.card.visible = false;
      this.acquireArt(artKey, url, t.name).then((entry) => {
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
    const p = clamp01((now - e.move.t0) / e.move.ms);
    const { from, to } = e.move;
    const fg = Number.isFinite(from.g) ? from.g : from.y, tg = Number.isFinite(to.g) ? to.g : to.y;
    return { x: lerp(from.x, to.x, p), z: lerp(from.z, to.z, p), y: lerp(from.y, to.y, p), g: lerp(fg, tg, p) };
  }

  layoutCard(e) {
    const aspect = e.cardData?.aspect ?? 0.7;
    let h = e.heightCells * FIGURE_SCALE, w = h * aspect;
    const maxW = e.width * 1.25 * FIGURE_SCALE;
    if (w > maxW) { h *= maxW / w; w = maxW; }
    e.cardH = h; e.cardW = w;
    e.card.scale.set(w, h, 1);
    if (e.plateH) {
      const pw = PLATE_W;
      e.plate.scale.set(pw, pw * e.plateH, 1);
      e.plate.position.y = BASE_H + h + 0.1 + (pw * e.plateH) / 2;
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

  /** Place the flight stand (or hide it) for the standee's current position. */
  placeStand(e, p) {
    const g = Number.isFinite(p.g) ? p.g : p.y;
    const alt = p.y - g;
    const flying = StandeesLayer.isFlying(p.y, g);
    e.flying = flying;
    e.stand.visible = flying;
    const r = (e.width ?? 1) * 0.4;
    const k = flying ? 1 / (1 + alt * 0.45) : 1;
    // The contact shadow stays on the ground, smaller and fainter the higher up.
    e.shadow.position.y = (flying ? g - p.y : 0) + 0.008;
    e.shadow.scale.set(r * 3.1 * (0.5 + 0.5 * k), 1, r * 3.1 * (0.5 + 0.5 * k));
    e.shadow.material.uniforms.uOpacity.value = (e.shadowOpacity ?? 0.9) * (0.35 + 0.65 * k);
    // the reticle marks the ground under the target, flying or not
    e.reticle.position.y = (flying ? g - p.y : 0) + 0.022;
    if (!flying) return;
    const dy = g - p.y;
    const rc = 0.045 * Math.sqrt(e.width ?? 1);
    e.column.position.y = dy;
    e.column.scale.set(rc, Math.max(0.01, alt), rc);
    e.column.material.uniforms.uGround.value = g;
    const fr = 0.3 * Math.sqrt(e.width ?? 1);
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

  acquireArt(key, url, name) {
    let a = this.art.get(key);
    if (!a) {
      a = { refs: 0, texture: null, card: null, promise: null };
      a.promise = (url ? loadDrawable(url) : Promise.resolve(null)).then((img) => {
        let card;
        try { card = composeCard(img, name); } catch { card = composeCard(null, name); }
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
    for (const m of [e.base, e.ring, e.turn, e.glow, e.shadow, e.card, e.xray, e.aura, e.plate, e.caster,
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
  frame(now, camera, yaw, sway, { pxWorld = this.pxWorld, markers = true } = {}) {
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
      let p = e.pos, hop = 0;
      if (e.move) {
        const k = clamp01((now - e.move.t0) / e.move.ms);
        p = this.current(e, now);
        if (e.move.hops) hop = HOP * Math.abs(Math.sin(Math.PI * e.move.hops * k));
        if (k >= 1) { e.pos = { ...e.move.to }; e.move = null; p = e.pos; } else active = true;
      }
      e.root.position.set(p.x, p.y, p.z);
      e.body.position.y = hop;
      this.placeStand(e, p);
      // YXZ: turn to the camera's yaw, then lean back about the card's own x axis.
      e.card.rotation.order = "YXZ";
      e.card.rotation.set(-lean, yaw, 0);
      e.body.rotation.z = 0;
      if (sway && e.root.visible) {
        e.body.rotation.set(0, 0, Math.sin(t * 1.25 + e.phase) * SWAY);
        e.card.rotation.y = yaw + Math.sin(t * 0.8 + e.phase * 1.7) * SWAY * 0.6;
      } else {
        e.body.rotation.set(0, 0, 0);
      }
      e.plate.quaternion.copy(camera.quaternion);
      // Above the card's leaned top, along the card's own up axis.
      const along = (e.cardH ?? 1) + 0.1 + (PLATE_W * (e.plateH ?? 0)) / 2;
      const back = Math.sin(lean) * along;
      e.plate.position.set(-back * Math.sin(yaw), BASE_H + Math.cos(lean) * along, -back * Math.cos(yaw));
      this.placeCaster(e, p, hop, sunYaw);
    }
    this.lean = lean;
    this.yaw = yaw;
    this.targeted = targeted;
    return active;
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
    const y = p.y + BASE_H + hop;
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
    const cards = [], bases = [];
    for (const e of this.entries.values()) {
      if (!e.root.visible) continue;
      if (e.card.visible) cards.push(e.card);
      bases.push(e.base);
      if (e.stand.visible) bases.push(e.column);   // the glass stand picks its flyer
    }
    const hits = raycaster.intersectObjects([...cards, ...bases], false);
    for (const h of hits) {
      const id = h.object.userData.tokenId;
      const e = this.entries.get(id);
      if (!e) continue;
      if (h.object === e.card && h.uv && !maskHit(e.cardData?.mask, h.uv.x, h.uv.y)) continue;
      return id;
    }
    return null;
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
    const lean = this.lean ?? 0, yaw = this.yaw ?? 0, along = (e.cardH ?? 1) * 0.58;
    const back = Math.sin(lean) * along;
    out.set(p.x - back * Math.sin(yaw), p.y + e.body.position.y + BASE_H + Math.cos(lean) * along, p.z - back * Math.cos(yaw));
    return true;
  }

  /** World anchor above a token's head (for labels). */
  headOf(id) {
    const e = this.entries.get(id);
    if (!e) return null;
    // The card's leaned top, which is where it reads on screen.
    const lean = this.lean ?? 0, yaw = this.yaw ?? 0;
    const back = Math.sin(lean) * e.cardH;
    return new THREE.Vector3(
      e.root.position.x - back * Math.sin(yaw),
      e.root.position.y + BASE_H + Math.cos(lean) * e.cardH,
      e.root.position.z - back * Math.cos(yaw),
    );
  }

  dispose() {
    for (const id of [...this.entries.keys()]) this.drop(id);
    this.casters.clear();
    for (const g of Object.values(this.geo)) (Array.isArray(g) ? g : [g]).forEach((x) => x.dispose());
    this.shadowTex?.dispose();
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
