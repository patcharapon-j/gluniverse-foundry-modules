/**
 * Diorama view — pointer and wheel input on the renderer canvas.
 *
 * Every action writes ordinary Foundry documents through Foundry's own API,
 * so 2D and 3D never disagree and Foundry (plus the movement wrapper) decides
 * what is legal:
 *
 *   left click token          control (shift adds / removes)
 *   left click ground         release all
 *   left drag own token       path preview, drop = TokenDocument#move
 *   double click token        sheet
 *   right click token         token menu
 *   left / right click door   Foundry's DoorControl rules
 *   long press / Alt+click    ping
 *   Ctrl+drag ground          ruler
 *   right / middle drag       pan; wheel = zoom
 *   hover a token             distance + terrain cover from the controlled one
 */

import { SUITE_ID } from "../../../core/const.mjs";
import { PALETTE } from "../../../core/theme.mjs";
import { CAMERA, FLAG_ALTITUDE, TIMING } from "../constants.mjs";
import { distToQ, qToDist } from "../terrain/model.mjs";
import { pathCellsTo } from "./snapshot.mjs";
import * as Seam from "./seams.mjs";
import { t, isGM, userColor } from "./util.mjs";

/** Pointer travel (client px) before a press becomes a drag. */
const DRAG_PX = 5;
/** A press held this long without moving pings. */
const LONG_PRESS_MS = 550;
/** Wheel delta → zoom factor. */
const WHEEL_K = 0.0015;

const sysId = () => globalThis.game?.system?.id ?? "";

/** A movement readout tone (rules/systems.mjs) as a path colour. */
export function toneColor(tone) {
  return { warn: PALETTE.warn, hazard: PALETTE.hazard, peril: PALETTE.peril }[tone] ?? PALETTE.info;
}

let _pingSeq = 0;

export class Input {
  /**
   * @param {object} ctx
   * @param {HTMLCanvasElement} ctx.canvas
   * @param {() => object} ctx.r          the renderer
   * @param {() => Scene} ctx.scene
   * @param {() => object} ctx.grid       gridOf(scene)
   * @param {() => object} ctx.terrain
   * @param {import("./hud.mjs").Hud} ctx.hud
   * @param {(patch:object) => void} ctx.setOverlays
   * @param {(id:string|null) => void} ctx.onHover
   * @param {() => boolean} ctx.asPlayers
   * @param {() => void} [ctx.cameraMoved]
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.down = null;
    this.hoverId = null;
    this.drag = null;
    this.ruler = null;
    this.pings = [];
    this.hoverRaf = 0;
    this.lastMove = null;
    this.longTimer = 0;
    this.anchors = new Map();
    this.hoverCellKey = "";
    const c = ctx.canvas;
    this.listeners = [
      [c, "pointerdown", (e) => this.onDown(e)],
      [c, "pointermove", (e) => this.onMove(e)],
      [c, "pointerup", (e) => this.onUp(e)],
      [c, "pointercancel", () => this.cancel()],
      [c, "pointerleave", () => { if (!this.down) { this.setHover(null); this.setHoverCell(null); } }],
      [c, "dblclick", (e) => this.onDouble(e)],
      [c, "wheel", (e) => this.onWheel(e), { passive: false }],
      [c, "contextmenu", (e) => e.preventDefault()],
    ];
    for (const [n, ev, fn, opt] of this.listeners) n.addEventListener(ev, fn, opt);
  }

  get r() { return this.ctx.r(); }

  pick(ev) {
    try { return this.r?.pick(ev.clientX, ev.clientY) ?? null; } catch { return null; }
  }

  token(id) { return id ? globalThis.canvas?.tokens?.get(id) ?? null : null; }

  /* ──────────────────────────── pointer ──────────────────────────── */

  onDown(ev) {
    if (this.ctx.hud.menuOpen) this.ctx.hud.closeMenu();
    try { this.ctx.canvas.setPointerCapture(ev.pointerId); } catch { /* fine */ }
    const hit = this.pick(ev);
    this.down = {
      button: ev.button, x: ev.clientX, y: ev.clientY, lx: ev.clientX, ly: ev.clientY,
      hit, shift: ev.shiftKey, ctrl: ev.ctrlKey || ev.metaKey, alt: ev.altKey, moved: false, pinged: false,
    };
    if (ev.button !== 0) return;
    if (hit?.type === "ground" && this.down.ctrl) {
      this.ruler = { a: { x: hit.x, y: hit.y, zQ: hit.zQ }, b: { x: hit.x, y: hit.y, zQ: hit.zQ } };
      return;
    }
    if (hit?.type === "ground" && this.down.alt) {
      this.down.pinged = true;
      this.ping(hit);
      return;
    }
    if (hit?.type === "token") {
      const tok = this.token(hit.id);
      if (tok?.document?.isOwner) this.down.dragToken = tok;
      return;
    }
    if (!hit || hit.type === "ground") {
      this.longTimer = setTimeout(() => {
        this.longTimer = 0;
        if (this.down && !this.down.moved && hit?.type === "ground") { this.down.pinged = true; this.ping(hit); }
      }, LONG_PRESS_MS);
    }
  }

  onMove(ev) {
    const d = this.down;
    if (!d) { this.lastMove = ev; this.queueHover(); return; }
    if (!d.moved && Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > DRAG_PX) {
      d.moved = true;
      this.clearLong();
    }
    const dx = ev.clientX - d.lx, dy = ev.clientY - d.ly;
    d.lx = ev.clientX; d.ly = ev.clientY;
    if (d.button === 1 || d.button === 2) { if (d.moved) this.panBy(dx, dy); return; }
    if (d.button !== 0 || !d.moved) return;
    if (this.ruler) { this.updateRuler(ev); return; }
    if (d.dragToken) this.updateDrag(ev, d.dragToken);
  }

  async onUp(ev) {
    const d = this.down;
    this.down = null;
    this.clearLong();
    try { this.ctx.canvas.releasePointerCapture(ev.pointerId); } catch { /* fine */ }
    if (!d) return;
    if (d.button === 0) {
      if (this.ruler) { this.clearRuler(); return; }
      if (this.drag) { await this.commitDrag(); return; }
      if (d.moved || d.pinged) return;
      this.click(d.hit, ev);
      return;
    }
    if (d.button === 2 && !d.moved) {
      if (d.hit?.type === "token") this.tokenMenu(d.hit.id, ev);
      else if (d.hit?.type === "door") this.doorRight(d.hit.id, ev);
    }
  }

  onDouble(ev) {
    const hit = this.pick(ev);
    if (hit?.type !== "token") return;
    const actor = this.token(hit.id)?.actor;
    if (actor?.testUserPermission(game.user, "LIMITED")) actor.sheet?.render(true);
  }

  onWheel(ev) {
    ev.preventDefault();
    const r = this.r;
    if (!r) return;
    const cam = r.getCamera();
    const zoom = Math.max(CAMERA.minZoom, Math.min(CAMERA.maxZoom, (cam.zoom || 1) * Math.exp(-ev.deltaY * WHEEL_K)));
    r.setCamera({ ...cam, zoom }, { animate: false });
    r.requestRender();
    this.ctx.cameraMoved?.();
  }

  cancel() {
    const had = !!(this.drag || this.ruler || this.down);
    this.down = null;
    this.clearLong();
    this.clearDrag();
    this.clearRuler();
    return had;
  }

  clearLong() {
    if (this.longTimer) clearTimeout(this.longTimer);
    this.longTimer = 0;
  }

  /* ──────────────────────────── clicks ──────────────────────────── */

  click(hit, ev) {
    if (hit?.type === "token") {
      const tok = this.token(hit.id);
      if (!tok) return;
      if (ev.shiftKey && tok.controlled) tok.release();
      else tok.control({ releaseOthers: !ev.shiftKey });
      return;
    }
    if (hit?.type === "door") { this.doorLeft(hit.id, ev); return; }
    globalThis.canvas?.tokens?.releaseAll?.();
  }

  /** DoorControl#_onMouseDown, restated. */
  doorLeft(id, ev) {
    const wall = globalThis.canvas?.walls?.get(id);
    const doc = wall?.document;
    if (!doc || !game.user.can("WALL_DOORS")) return;
    const DS = CONST.WALL_DOOR_STATES;
    if (!isGM() && doc.door === CONST.WALL_DOOR_TYPES.SECRET) return;
    // A player works only a door Foundry would show them a control for: not one in an unseen room.
    if (!isGM() && !wall.doorControl?.isVisible) return;
    if (game.paused && !isGM()) { ui.notifications.warn("GAME.PausedWarning", { localize: true }); return; }
    const sound = !(isGM() && ev.altKey);
    if (doc.ds === DS.LOCKED) { wall._playDoorSound?.("test"); return; }
    doc.update({ ds: doc.ds === DS.CLOSED ? DS.OPEN : DS.CLOSED }, { sound });
  }

  /** DoorControl#_onRightDown: the GM locks and unlocks a closed door. */
  doorRight(id, ev) {
    if (!isGM()) return;
    const doc = globalThis.canvas?.walls?.get(id)?.document;
    if (!doc) return;
    const DS = CONST.WALL_DOOR_STATES;
    if (doc.ds === DS.OPEN) return;
    doc.update({ ds: doc.ds === DS.LOCKED ? DS.CLOSED : DS.LOCKED }, { sound: !ev.altKey });
  }

  ping(hit) {
    const at = { x: hit.x, y: hit.y };
    try { globalThis.canvas?.ping?.(at); } catch { /* outside the rect */ }
    const p = { id: `ping-${++_pingSeq}`, x: hit.x, y: hit.y, zQ: hit.zQ ?? 0, color: userColor(game.user) ?? undefined };
    this.pings.push(p);
    this.ctx.setOverlays({ pings: this.pings.slice() });
    setTimeout(() => {
      this.pings = this.pings.filter((q) => q !== p);
      this.ctx.setOverlays({ pings: this.pings.slice() });
    }, TIMING.ping);
  }

  /* ──────────────────────────── token menu ──────────────────────────── */

  tokenMenu(id, ev) {
    const tok = this.token(id);
    const doc = tok?.document;
    if (!doc) return;
    const gm = isGM();
    const owner = !!doc.isOwner;
    const items = [];
    items.push({
      icon: "fa-solid fa-bullseye",
      label: t(tok.isTargeted ? "GLDIO.menu.untarget" : "GLDIO.menu.target"),
      run: () => tok.setTarget(!tok.isTargeted, { releaseOthers: false }),
    });
    if (tok.actor?.testUserPermission(game.user, "LIMITED")) {
      items.push({ icon: "fa-solid fa-id-card", label: t("GLDIO.menu.sheet"), run: () => tok.actor.sheet?.render(true) });
    }
    if (gm || owner) {
      items.push({
        icon: "fa-solid fa-swords",
        label: t(doc.inCombat ? "GLDIO.menu.leaveCombat" : "GLDIO.menu.joinCombat"),
        run: () => doc.toggleCombatant?.(),
      });
    }
    if (gm) {
      items.push({
        icon: doc.hidden ? "fa-solid fa-eye" : "fa-solid fa-eye-slash",
        label: t(doc.hidden ? "GLDIO.menu.show" : "GLDIO.menu.hide"),
        run: () => doc.update({ hidden: !doc.hidden }),
      });
    }
    if (owner) {
      const step = this.ctx.grid().distance || 5;
      const units = this.ctx.grid().units ?? "";
      items.push({ icon: "fa-solid fa-arrow-up", label: t("GLDIO.menu.altUp", { step, units }), run: () => this.setAltitude(doc, step) });
      if (Seam.altitude(doc) > 0) {
        items.push({ icon: "fa-solid fa-arrow-down", label: t("GLDIO.menu.altDown", { step, units }), run: () => this.setAltitude(doc, -step) });
      }
    }
    this.ctx.hud.menu({ x: ev.clientX, y: ev.clientY }, items);
  }

  setAltitude(doc, delta) {
    const alt = Math.max(0, Seam.altitude(doc) + delta);
    const ground = Seam.groundDist(this.ctx.scene(), doc.x, doc.y, doc.width, doc.height);
    return doc.update({ elevation: ground + alt, [`flags.${SUITE_ID}.${FLAG_ALTITUDE}`]: alt });
  }

  /** T: target the hovered token (shift keeps other targets). */
  targetHovered(shift) {
    const tok = this.token(this.hoverId);
    if (!tok) return false;
    tok.setTarget(!tok.isTargeted, { releaseOthers: !shift });
    return true;
  }

  /* ──────────────────────────── camera ──────────────────────────── */

  /**
   * Pan so the ground follows the pointer. The screen → map Jacobian is read
   * off the renderer's own projection at the camera target, so this holds at
   * any yaw, pitch and zoom without knowing the camera's maths.
   */
  panBy(dxs, dys) {
    const r = this.r;
    if (!r) return;
    const cam = r.getCamera();
    const tg = cam?.target;
    if (!tg) return;
    const size = this.ctx.grid().size || 100;
    const z = Number.isFinite(tg.zQ) ? tg.zQ : this.groundQ(tg.x, tg.y);
    const p0 = r.project(tg.x, tg.y, z), px = r.project(tg.x + size, tg.y, z), py = r.project(tg.x, tg.y + size, z);
    if (!p0 || !px || !py) return;
    const a = (px.x - p0.x) / size, b = (py.x - p0.x) / size;
    const c = (px.y - p0.y) / size, d = (py.y - p0.y) / size;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-9) return;
    const wx = (d * dxs - b * dys) / det, wy = (-c * dxs + a * dys) / det;
    const dims = globalThis.canvas?.dimensions;
    const W = dims?.width ?? Infinity, H = dims?.height ?? Infinity;
    const target = { ...tg, x: Math.max(0, Math.min(W, tg.x - wx)), y: Math.max(0, Math.min(H, tg.y - wy)) };
    r.setCamera({ ...cam, target }, { animate: false });
    r.requestRender();
    this.ctx.cameraMoved?.();
  }

  groundQ(x, y) {
    const terrain = this.ctx.terrain();
    try { return terrain ? terrain.groundAt(x, y, this.ctx.grid().size) : 0; } catch { return 0; }
  }

  /* ──────────────────────────── ruler ──────────────────────────── */

  updateRuler(ev) {
    const hit = this.pick(ev);
    if (hit?.type !== "ground") return;
    this.ruler.b = { x: hit.x, y: hit.y, zQ: hit.zQ };
    const g = this.ctx.grid();
    const { a, b } = this.ruler;
    let distance = 0;
    try {
      distance = canvas.grid.measurePath([
        { x: a.x, y: a.y, elevation: qToDist(a.zQ ?? 0, g.distance) },
        { x: b.x, y: b.y, elevation: qToDist(b.zQ ?? 0, g.distance) },
      ]).distance;
    } catch { distance = 0; }
    const text = Seam.distanceText({ systemId: sysId(), distance, gridDistance: g.distance, units: g.units, t }).text;
    this.ctx.setOverlays({ ruler: { a, b } });
    this.place("ruler", { x: b.x, y: b.y, zQ: b.zQ ?? 0 }, [text]);
  }

  clearRuler() {
    if (!this.ruler) return;
    this.ruler = null;
    this.ctx.setOverlays({ ruler: null });
    this.unplace("ruler");
  }

  /* ──────────────────────────── drag / path ──────────────────────────── */

  updateDrag(ev, tok) {
    const doc = tok.document;
    const g = this.ctx.grid();
    const size = g.size;
    if (!this.drag) {
      const start = { i: Math.round(doc._source.y / size), j: Math.round(doc._source.x / size) };
      const w = Math.max(1, Math.round(doc.width)), h = Math.max(1, Math.round(doc.height));
      this.drag = { tok, cells: [start], anchor: { i: Math.floor((h - 1) / 2), j: Math.floor((w - 1) / 2) }, key: "" };
    }
    const hit = this.pick(ev);
    let x, y;
    if (hit?.type === "ground") { x = hit.x; y = hit.y; }
    else if (hit?.type === "token") { const o = this.token(hit.id); x = o?.center?.x; y = o?.center?.y; }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const cell = { i: Math.floor(y / size) - this.drag.anchor.i, j: Math.floor(x / size) - this.drag.anchor.j };
    const cells = pathCellsTo(this.drag.cells, cell);
    const key = cells.map((c) => `${c.i},${c.j}`).join(";");
    if (key === this.drag.key) return;
    this.drag.cells = cells;
    this.drag.key = key;
    this.showPath();
  }

  /** Waypoints for the drag's cells (index 0 = the start). */
  waypoints(drag = this.drag) {
    const { tok, cells } = drag;
    const doc = tok.document;
    const size = this.ctx.grid().size;
    const scene = this.ctx.scene();
    const alt = Seam.altitude(doc);
    const action = doc.movementAction ?? "walk";
    return cells.map((c) => {
      const x = c.j * size, y = c.i * size;
      return { x, y, elevation: Seam.groundDist(scene, x, y, doc.width, doc.height) + alt, action };
    });
  }

  showPath() {
    const { tok, cells } = this.drag;
    const doc = tok.document;
    const g = this.ctx.grid();
    const wps = this.waypoints();
    wps[0] = { x: doc._source.x, y: doc._source.y, elevation: doc._source.elevation ?? doc.elevation, action: wps[0].action };
    let result = null;
    try { result = cells.length > 1 ? tok.measureMovementPath(wps) : null; } catch { result = null; }
    const systemId = sysId();
    const spd = Seam.speed(tok.actor, systemId, wps[0].action);
    const read = (distance, cost) => Seam.movementText({ systemId, speed: spd, distance, cost, units: g.units, gridDistance: g.distance, t });
    const segs = result?.segments ?? [];
    const tones = [];
    let cd = 0, cc = 0;
    for (let k = 0; k < cells.length - 1; k++) {
      const s = segs[k];
      cd += Number(s?.distance) || 0;
      cc += Number.isFinite(Number(s?.cost)) ? Number(s.cost) : (s ? Infinity : 0);
      tones.push(read(cd, cc).tone);
    }
    const w = Number(doc.width) || 1, h = Number(doc.height) || 1;
    // Segment k → k+1 is coloured by points[k+1].color (render/overlays.mjs).
    const points = wps.map((p, k) => ({
      x: p.x + (w * g.size) / 2,
      y: p.y + (h * g.size) / 2,
      zQ: distToQ(p.elevation, g.distance),
      color: toneColor(k ? tones[k - 1] : tones[0]),
    }));
    const an = Seam.analyze(this.ctx.terrain(), cells, g);
    const marks = [
      ...an.climbs.map((c) => ({ i: c.i, j: c.j, color: PALETTE.warn, alpha: 0.45 })),
      ...an.falls.map((f) => ({ i: f.i, j: f.j, color: PALETTE.hazard, alpha: 0.45 })),
    ];
    this.ctx.setOverlays({ path: { points, color: toneColor(tones[0]) }, marks });

    const total = result ? read(result.distance, result.cost) : null;
    const lines = total ? [total.text] : [];
    for (const c of an.climbs) lines.push(t("GLDIO.path.climb", { distance: Math.round(c.riseDist * 10) / 10, units: g.units }));
    for (const f of an.falls) {
      const s = Seam.fallText({ systemId, dropDist: f.dropDist, intoWater: f.intoWater, units: g.units, t });
      if (s) lines.push(s);
    }
    const end = points[points.length - 1];
    if (end) this.place("path", { x: end.x, y: end.y, zQ: end.zQ + 1 }, lines, total?.tone ?? "info");
    else this.unplace("path");
  }

  async commitDrag() {
    const drag = this.drag;
    this.clearDrag();
    if (!drag || drag.cells.length < 2) return;
    const doc = drag.tok.document;
    if (game.paused && !isGM()) { ui.notifications.warn("GAME.PausedWarning", { localize: true }); return; }
    const wps = this.waypoints(drag).slice(1);
    wps.forEach((w, k) => { w.snapped = true; w.explicit = k === wps.length - 1; w.checkpoint = k === wps.length - 1; });
    const last = wps[wps.length - 1];
    let ok = false;
    try { ok = await doc.move(wps, { showRuler: false }); } catch (e) { console.error(e); ok = false; }
    if (!ok && (doc._source.x !== last.x || doc._source.y !== last.y)) ui.notifications.warn(t("GLDIO.move.stopped"));
  }

  clearDrag() {
    if (!this.drag) return;
    this.drag = null;
    this.ctx.setOverlays({ path: null, marks: [] });
    this.unplace("path");
  }

  /* ──────────────────────────── hover ──────────────────────────── */

  queueHover() {
    if (this.hoverRaf) return;
    this.hoverRaf = requestAnimationFrame(() => {
      this.hoverRaf = 0;
      const ev = this.lastMove;
      if (!ev) return;
      const hit = this.pick(ev);
      this.setHover(hit?.type === "token" ? hit.id : null);
      this.setHoverCell(hit?.type === "ground" ? { i: hit.i, j: hit.j } : null);
    });
  }

  /** The hovered token: a standee state (TokenState.hovered), not an overlay. */
  setHover(id) {
    if (id === this.hoverId) { if (id) this.hoverLabel(); return; }
    this.hoverId = id;
    this.ctx.onHover(id);
    this.hoverLabel();
  }

  /** The hovered ground cell (render/overlays.mjs `hover`). */
  setHoverCell(cell) {
    const key = cell ? `${cell.i},${cell.j}` : "";
    if (key === this.hoverCellKey) return;
    this.hoverCellKey = key;
    this.ctx.setOverlays({ hover: cell });
  }

  /** Distance and terrain cover from the controlled token to the hovered one. */
  hoverLabel() {
    const target = this.token(this.hoverId);
    const from = globalThis.canvas?.tokens?.controlled?.[0] ?? null;
    if (!target || !from || from === target || this.ctx.asPlayers()) { this.unplace("hover"); return; }
    const g = this.ctx.grid();
    let distance = 0;
    try {
      distance = canvas.grid.measurePath([
        { x: from.center.x, y: from.center.y, elevation: Number(from.document.elevation) || 0 },
        { x: target.center.x, y: target.center.y, elevation: Number(target.document.elevation) || 0 },
      ]).distance;
    } catch { distance = 0; }
    const lines = [Seam.distanceText({ systemId: sysId(), distance, gridDistance: g.distance, units: g.units, t }).text];
    const cv = Seam.cover(from, target);
    let tone = "info";
    if (cv) {
      if (!cv.lineOfSight) { lines.push(t("GLDIO.cover.noSight")); tone = "hazard"; }
      else if (cv.cover && cv.cover !== "none") { lines.push(t(`GLDIO.cover.${cv.cover}`)); tone = "warn"; }
    }
    const zTop = distToQ(Number(target.document.elevation) || 0, g.distance) + Seam.heightQ(target, g.distance);
    this.place("hover", { x: target.center.x, y: target.center.y, zQ: zTop + 1 }, lines, tone);
  }

  /** Show a label anchored at a world point; kept so a camera move can re-place it. */
  place(id, world, lines, tone = "info") {
    this.anchors.set(id, { world, lines, tone });
    this.ctx.hud.label(id, this.r?.project(world.x, world.y, world.zQ) ?? null, lines, tone);
  }

  unplace(id) {
    this.anchors.delete(id);
    this.ctx.hud.hideLabel(id);
  }

  /** Re-project every live label (the camera or a token moved). */
  relabel() {
    if (this.hoverId) this.hoverLabel();
    for (const [id, a] of this.anchors) this.ctx.hud.label(id, this.r?.project(a.world.x, a.world.y, a.world.zQ) ?? null, a.lines, a.tone);
  }

  dispose() {
    this.cancel();
    if (this.hoverRaf) cancelAnimationFrame(this.hoverRaf);
    for (const [n, ev, fn, opt] of this.listeners) n.removeEventListener(ev, fn, opt);
    this.listeners = [];
  }
}

/** The cover family this view builds keys from (`GLDIO.cover.<key>`). */
export const COVER_KEYS = Object.freeze(["standard", "greater"]);
