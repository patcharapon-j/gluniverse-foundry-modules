/**
 * Diorama view — Foundry's own Token HUD, over the 3D view.
 *
 * Right-clicking a standee binds `canvas.tokens.hud` exactly as
 * PlaceableObject#_onClickRight does in 2D (control, then bind or close), so
 * every control on it is Foundry's (and the system's and modules'): bars,
 * elevation, status effects, movement action, visibility, target, combat.
 *
 * WHERE. #hud is a canvas-sized box that HeadsUpDisplayContainer#align moves
 * and scales with the 2D stage (left / top = canvas.primary's global position,
 * `transform: scale(stage.scale)`, origin top left), and
 * BasePlaceableHUD#_updatePosition puts the HUD on the token's 2D bounds inside
 * it. While the view is open, `_updatePosition` is shadowed on the HUD instance:
 * the box is the standee's on screen (head to the far edge of its base, the
 * base's width), clamped to a size the HUD's columns read at, and stated in
 * #hud's own units: local = (client px − #hud's client origin) / S, with the
 * HUD itself at scale 1 / S, so its controls are drawn at their native CSS size
 * whatever the hidden 2D board is zoomed to. Re-placed when the 3D camera moves,
 * when the token refreshes (Foundry calls setPosition itself) and when the 2D
 * stage pans under the view.
 *
 * ABOVE. #hud comes before #board at the board's layer and the view after it at
 * the same layer, so the view covers it. While the HUD is open in 3D, #hud
 * carries `gldio-hud-3d` (styles/diorama.css): one step above the view, with
 * everything else in it (chat bubbles, the 2D ruler's labels, placed for the
 * hidden 2D board) hidden.
 *
 * Nothing here runs at import; the Input that owns this installs and disposes it.
 */

import { err, warn } from "../../../core/const.mjs";
import { distToQ } from "../terrain/model.mjs";
import * as Seam from "./seams.mjs";
import { el, isGM, t } from "./util.mjs";

/** The HUD's box on screen, client px: never so small its columns collide, never a wall. */
const BOX = Object.freeze({ minW: 72, maxW: 220, minH: 84, maxH: 280 });
/** Marks the shadowing `_updatePosition`, so only ours is ever removed. */
const OURS = Symbol("gldio-hud-position");
const LIFT = "gldio-hud-3d";

const hudEl = () => globalThis.document?.getElementById("hud") ?? null;

/** May this user open the HUD of this token (Token#_canHUD's permission half)? */
export function mayHud(tok, user = globalThis.game?.user) {
  if (!tok || !user) return false;
  return !!user.isGM || !!tok.actor?.testUserPermission?.(user, "OWNER");
}

/**
 * The HUD position for a standee's screen box, in #hud's own units. Pure.
 * @param {{left:number, top:number, right:number, bottom:number}} box  client px
 * @param {{left:number, top:number}} origin  #hud's top-left, client px
 * @param {number} scale  the 2D stage's scale (#hud's transform)
 */
export function hudPosition(box, origin, scale) {
  const S = Number(scale) > 0 ? Number(scale) : 1;
  const w = Math.max(BOX.minW, Math.min(BOX.maxW, box.right - box.left));
  const h = Math.max(BOX.minH, Math.min(BOX.maxH, box.bottom - box.top));
  const cx = (box.left + box.right) / 2, cy = (box.top + box.bottom) / 2;
  return {
    left: (cx - w / 2 - origin.left) / S,
    top: (cy - h / 2 - origin.top) / S,
    width: w,
    height: h,
    scale: 1 / S,
  };
}

/** Lazily open the standee settings (view/standee-app.mjs). A missing module warns, never throws. */
async function openStandee(actor) {
  let m = null;
  try { m = await import("./standee-app.mjs"); } catch (e) { warn("diorama: the standee settings are unavailable", e); }
  if (typeof m?.openStandeeConfig !== "function") { ui.notifications?.warn(t("GLDIO.hud.standeeFailed")); return; }
  try { await m.openStandeeConfig(actor); } catch (e) { err("diorama: the standee settings failed to open", e); }
}

export class TokenHud3D {
  /**
   * @param {object} ctx
   * @param {() => object} ctx.r                 the renderer
   * @param {() => object} ctx.grid
   * @param {(id:string) => {x:number, y:number}|null} [ctx.anchor]  a standee's head, client px
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.hooks = [];
    this.installed = false;
    /** The token whose HUD was opened from its standee (placed in 3D), else null. */
    this.mine = null;
  }

  get hud() { return globalThis.canvas?.tokens?.hud ?? null; }

  /** The token the HUD is bound to while it is shown, else null. */
  get bound() {
    const h = this.hud;
    return h?.rendered && h.object ? h.object : null;
  }

  install() {
    if (this.installed) return;
    const hud = this.hud;
    if (!hud) return;
    this.installed = true;
    // A HUD left open on the 2D board is placed for a board nobody can see now.
    if (hud.rendered) hud.close();
    if (Object.hasOwn(hud, "_updatePosition") && hud._updatePosition?.[OURS]) delete hud._updatePosition;
    const self = this;
    const shadow = function (position) {
      const p = self.position(this.object);
      if (!p) return Object.getPrototypeOf(this)._updatePosition.call(this, position);
      return Object.assign(position, p);
    };
    shadow[OURS] = true;
    hud._updatePosition = shadow;
    const on = (name, fn) => this.hooks.push([name, Hooks.on(name, fn)]);
    // Only a HUD opened from a standee is placed in 3D; one opened on the 2D map
    // window (view/peek.mjs) keeps Foundry's own 2D placement under the hole.
    on("renderTokenHUD", (app, element) => {
      if (app !== this.hud) return;
      const mine = this.mine && this.mine === app.object?.id;
      this.lift(mine);
      if (mine) this.addStandeeButton(app, element);
    });
    on("closeTokenHUD", (app) => { if (app === this.hud) { this.lift(false); this.mine = null; } });
  }

  lift(on) {
    hudEl()?.classList.toggle(LIFT, !!on);
  }

  /** The HUD position for a token's standee, or null (then Foundry's own 2D placement). */
  position(tok) {
    const r = this.ctx.r?.();
    const g = this.ctx.grid?.();
    const doc = tok?.document;
    const host = hudEl();
    if (!this.mine || this.mine !== doc?.id) return null;
    if (!r || !g || !doc || !host || !Number.isFinite(tok.center?.x)) return null;
    const size = g.size || 100, dist = g.distance || 5;
    const c = tok.center;
    const footQ = distToQ(Number(doc.elevation) || 0, dist);
    const w = (Number(doc.width) || 1) * size, h = (Number(doc.height) || 1) * size;
    const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
      .map(([dx, dy]) => r.project(c.x + dx, c.y + dy, footQ));
    pts.push(this.ctx.anchor?.(doc.id) ?? r.project(c.x, c.y, footQ + Seam.heightQ(tok, dist)));
    if (!pts.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))) return null;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const box = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
    const o = host.getBoundingClientRect();
    return hudPosition(box, { left: o.left, top: o.top }, globalThis.canvas?.stage?.scale?.x);
  }

  /**
   * Right-click on a standee: what PlaceableObject#_onClickRight does in 2D.
   * @returns {boolean} whether this user may open its HUD
   */
  toggle(tok, { shift = false } = {}) {
    const hud = this.hud;
    if (!hud || !tok || !mayHud(tok)) return false;
    const layer = globalThis.canvas?.tokens;
    if (layer && !layer.active) layer.activate();
    tok.control({ releaseOthers: !tok.controlled && !shift });
    if (tok.hasActiveHUD && this.mine === tok.id) { hud.close(); return true; }
    this.mine = tok.id;
    hud.bind(tok).catch((e) => err("diorama: the token HUD failed to open", e));
    return true;
  }

  /** Put an open HUD back on its standee (the camera, the token or the 2D stage moved). */
  follow() {
    if (this.bound) this.hud.setPosition();
  }

  /** @returns {boolean} whether a HUD was open */
  close() {
    if (!this.bound) return false;
    this.hud.close();
    return true;
  }

  /** One more control, only in 3D: the standee's art and height, for its owner or the GM. */
  addStandeeButton(app, element) {
    const actor = app.object?.actor ?? app.document?.actor ?? null;
    if (!actor || !(isGM() || actor.testUserPermission?.(game.user, "OWNER"))) return;
    const col = element?.querySelector?.(".col.left") ?? element?.querySelector?.(".col.right");
    if (!col || col.querySelector(".gldio-hud-standee")) return;
    const label = t("GLDIO.standee.menu");
    const btn = el("button", { type: "button", class: "control-icon gldio-hud-standee", "aria-label": label, "data-tooltip": "" },
      [el("i", { class: "fa-solid fa-person", inert: true })]);
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      btn.blur(); // a button in the HUD's form holds the keyboard from Foundry's keybindings
      openStandee(actor);
    });
    col.append(btn);
  }

  dispose() {
    for (const [name, id] of this.hooks) Hooks.off(name, id);
    this.hooks = [];
    const hud = this.hud;
    try { if (this.bound) hud.close(); } catch (e) { err("diorama: closing the token HUD", e); }
    if (hud && Object.hasOwn(hud, "_updatePosition") && hud._updatePosition?.[OURS]) delete hud._updatePosition;
    this.lift(false);
    this.installed = false;
  }
}
