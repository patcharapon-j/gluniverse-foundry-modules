/**
 * The odds on the targeting line.
 *
 * ## Where they appear
 *
 * Exactly where a targeting line does. With `stream-targets` on, its
 * controller announces the lines it draws (`TARGETS_HOOKS.linesChanged`) and
 * the odds hang on each, so they never name a token that client cannot see,
 * because the line already refused to. With the line feature off, they fall
 * back to the honest minimum: the user's own token to their own targets (and,
 * for the GM in combat, the acting combatant to the GM's).
 *
 * ## The tag and the plate
 *
 * Every line carries a TAG: the chance and the word for what it is the chance
 * of, sitting on the line itself a little short of the head, with a rule in
 * the line's own colour. The path is `stream-targets`' own geometry for the
 * same two tokens (line-place.mjs), so the tag is on the line the canvas
 * draws. A table full of lines stays a row of small figures.
 *
 * The PLATE (the skyline, the chips, the GM's line) opens off the tag on the
 * bow side of the arc only while it matters: on its roller's turn, while
 * either token or the tag is hovered, and out of combat (where there are few
 * lines and no turns). Under load it is shed back to the tag.
 *
 * DOM, not PIXI: tabular figures, hatching and chips are what the DOM is good
 * at. One fixed layer above the board, moved on the canvas ticker; a frame
 * whose camera, tokens and sizes are all where they were writes nothing.
 *
 * ## Holding through a roll
 *
 * A roll changes what the odds would say (a narrowed AC, a used reaction, an
 * item consumed) and a number that moves while the die is still in the air
 * reads as the badge rolling the dice. So from the moment a check is posted
 * until it has landed (dice-highlight.mjs `release`, after the stamp), every
 * line naming its roller or its target holds the numbers it had. Recomputes
 * still happen; they wait in `view.pending` and are drawn on release.
 */

import { Budget } from "../../core/budget.mjs";
import { SUITE_ID, warn } from "../../core/const.mjs";
import { Suite } from "../../core/registry.mjs";
import { motionScale } from "../../core/theme.mjs";
import { createPath } from "../stream-targets/targeting/target-geometry.js";
import { TARGETS_HOOKS } from "../stream-targets/settings.js";
import { TARGETS_FEATURE_ID } from "../stream/constants.js";
import { FEATURE_ID, SETTINGS, SHED_ORDER, TIMING } from "./constants.mjs";
import { lineCss, linePath, placeLines, straightAnchor, tagAnchor } from "./line-place.mjs";
import { badgeHTML, compactHTML, playLanding, playTagLanding, sameModel, updateBadge } from "./render.mjs";
import { get } from "./settings.mjs";
import { onTrackerChange } from "./tracker.mjs";
import { modelFor, nameFor } from "./view.mjs";

const L = (key) => {
  if (typeof key !== "string" || !key) return "";
  return game.i18n.localize(key);
};

const tokenById = (id) => canvas?.tokens?.get(id) ?? null;

/**
 * Diorama's 3D view covers the board, where the 2D stage transform names the
 * wrong spot: ask it where the standee is (null while closed or off).
 */
function dioramaAnchor(tokenId) {
  try { return game.modules.get(SUITE_ID)?.api?.features?.diorama?.tokenAnchor?.(tokenId) ?? null; } catch { return null; }
}

/** One element from a markup string. */
function fromHTML(html) {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.firstElementChild;
}

export class LineBadges {
  /** pairKey → { sourceId, targetId, el, tag, plate, model, full, color, path, tagBox, plateBox, at } */
  views = new Map();
  layer = null;
  hovered = new Set();
  linePairs = null;
  ladder = null;
  #tick = null;
  #timer = null;
  #seq = 0;
  /** The numbers the last placement was made from; an unchanged frame writes nothing. */
  #sig = [];
  #nextSig = [];
  /** messageId → { actors: Set<actorId>, timer } — rolls in flight. */
  #holds = new Map();

  wire() {
    this.ladder = Budget.ladder(FEATURE_ID, SHED_ORDER);
    Hooks.on("canvasReady", () => {
      this.#mount();
      this.refresh();
    });
    Hooks.on("canvasTearDown", () => this.#unmount());
    Hooks.on(TARGETS_HOOKS.linesChanged, (pairs) => {
      this.linePairs = Array.isArray(pairs) ? pairs : [];
      this.refresh();
    });
    Hooks.on("hoverToken", (token, hovered) => {
      const id = token?.document?.id;
      if (!id) return;
      if (hovered) this.hovered.add(id);
      else this.hovered.delete(id);
      this.#applySizes();
    });
    // A token deleted while hovered never sends its hover-out; left in the set
    // it would hold every plate on its lines open for the rest of the scene.
    Hooks.on("deleteToken", (doc) => {
      if (doc?.id && this.hovered.delete(doc.id)) this.#applySizes();
    });
    for (const hook of ["combatTurnChange", "combatStart", "deleteCombat", "controlToken"]) Hooks.on(hook, () => this.refresh());
    onTrackerChange(() => this.refresh());
    if (canvas?.ready) this.#mount();
    this.refresh();
  }

  /** Debounced: recompute every line's model and redraw what changed. */
  refresh() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#sync().catch((e) => warn("pf2e-odds | badge sync failed", e)), TIMING.debounce);
  }

  #enabled() {
    return !!get(SETTINGS.lineBadge, true) && !!canvas?.ready;
  }

  #linesOn() {
    try {
      return Suite.enabled(TARGETS_FEATURE_ID);
    } catch {
      return false;
    }
  }

  /** The pairs this client should price. */
  #pairs() {
    // A token targeting itself draws its brackets and nothing to price.
    if (this.#linesOn()) return (this.linePairs ?? []).filter((p) => p.sourceId !== p.targetId);
    const out = [];
    const targets = [...(game.user?.targets ?? [])];
    if (!targets.length) return out;
    const combat = game.combat?.started ? game.combat : null;
    const own = canvas.tokens?.controlled?.[0] ?? game.user?.character?.getActiveTokens?.()?.[0] ?? null;
    const acting = combat && game.user.isGM ? canvas.tokens?.get(combat.combatant?.tokenId) : null;
    const source = acting ?? own;
    if (!source) return out;
    for (const t of targets) if (t.id !== source.id) out.push({ sourceId: source.document.id, targetId: t.document.id, color: null });
    return out;
  }

  async #sync() {
    if (!this.#enabled()) {
      this.#clear();
      return;
    }
    this.#mount();
    const seq = ++this.#seq;
    const pairs = this.#pairs();
    const wanted = new Set(pairs.map((p) => `${p.sourceId}>${p.targetId}`));
    for (const [key, view] of this.views) if (!wanted.has(key)) this.#drop(key, view);

    await Promise.all(
      pairs.map(async (p) => {
        const key = `${p.sourceId}>${p.targetId}`;
        const source = tokenById(p.sourceId);
        const target = tokenById(p.targetId);
        if (!source?.actor || !target?.actor) return;
        let model = null;
        try {
          model = await modelFor({ roller: source.actor, rollerToken: source, target });
        } catch (error) {
          warn("pf2e-odds | could not price a line", error);
        }
        if (seq !== this.#seq) return;
        this.#draw(key, p, model, target);
      })
    );
    this.#applySizes();
    this.#listen();
  }

  #draw(key, pair, model, target) {
    let view = this.views.get(key);
    // A roll in flight on this line: keep what the badge said when it was thrown.
    if (view && this.#held(pair)) {
      view.pending = true;
      return;
    }
    if (!model) {
      if (view) this.#drop(key, view);
      return;
    }
    const color = lineCss(pair.color);
    const opts = { t: L, target: nameFor(target, target.actor), motion: this.#motion() };
    if (!view) {
      const el = document.createElement("div");
      el.className = "glod-line";
      el.dataset.pair = key;
      el.innerHTML = compactHTML(model, { t: L }) + badgeHTML(model, opts);
      this.#bind(el, key);
      this.layer.append(el);
      view = { ...pair, el, model, target: opts.target, full: null, color: null, path: createPath(), tagBox: null, plateBox: null, at: [] };
      this.views.set(key, view);
      this.#paint(view, color);
      return;
    }
    this.#paint(view, color);
    // A refresh that changed nothing draws nothing: no rebuilt tag, no replayed beat.
    if (sameModel(view.model, model) && view.target === opts.target) return;
    const plate = view.el.querySelector(".glod-badge");
    if (plate && this.ladder?.allows("narrowBeat") !== false) updateBadge(plate, view.model, model, opts);
    else if (plate) plate.outerHTML = badgeHTML(model, opts);
    // The tag keeps its element, so a landing stamp in progress on it survives.
    const tag = view.el.querySelector(".glod-tag");
    const fresh = fromHTML(compactHTML(model, { t: L }));
    if (tag && fresh) {
      tag.dataset.state = fresh.dataset.state;
      tag.innerHTML = fresh.innerHTML;
    }
    view.model = model;
    view.target = opts.target;
    view.tagBox = null;
    view.plateBox = null;
  }

  /** The tag's rule in the line's own colour; paper with no line behind it. */
  #paint(view, color) {
    if (color === view.color) return;
    view.color = color;
    if (color) view.el.style.setProperty("--glod-line", color);
    else view.el.style.removeProperty("--glod-line");
  }

  #bind(el, key) {
    // Leaving waits a beat: the pointer crosses the gap between the tag and
    // the plate on its way from one to the other, and an instant close would
    // take the plate away before it arrives.
    let leave = null;
    el.addEventListener("pointerenter", () => {
      clearTimeout(leave);
      this.hovered.add(`badge:${key}`);
      this.#applySizes();
    });
    el.addEventListener("pointerleave", () => {
      clearTimeout(leave);
      leave = setTimeout(() => {
        this.hovered.delete(`badge:${key}`);
        this.#applySizes();
      }, TIMING.debounce);
    });
  }

  /* ── holding through a roll ──────────────────────────────────────────── */

  #held(pair) {
    if (!this.#holds.size) return false;
    const ids = [tokenById(pair.sourceId)?.actor?.id, tokenById(pair.targetId)?.actor?.id].filter(Boolean);
    for (const h of this.#holds.values()) if (ids.some((id) => h.actors.has(id))) return true;
    return false;
  }

  /**
   * A check was posted: hold every line naming its roller or its target until
   * `release`. Returns whether anything is held, so the landing knows to wait
   * for the die even when it has no beat of its own to play.
   */
  hold(message) {
    const ctx = message?.flags?.pf2e?.context;
    if (!ctx || ctx.type === "damage-roll" || ctx.type === "damage-taken" || !message.rolls?.[0]) return false;
    const actors = new Set();
    if (message.actor?.id) actors.add(message.actor.id);
    const targetToken = String(ctx.target?.token ?? "").split(".").pop();
    const targetActor = (targetToken && tokenById(targetToken)?.actor) || (ctx.target?.actor ? fromUuidSync(ctx.target.actor) : null);
    if (targetActor?.id) actors.add(targetActor.id);
    const touches = [...this.views.values()].some((v) => [tokenById(v.sourceId)?.actor?.id, tokenById(v.targetId)?.actor?.id].some((id) => id && actors.has(id)));
    if (!touches) return false;
    clearTimeout(this.#holds.get(message.id)?.timer);
    const timer = setTimeout(() => this.release(message.id), TIMING.holdMax);
    this.#holds.set(message.id, { actors, timer });
    return true;
  }

  /** The roll has landed (or never will here): draw what waited, after `delay`. */
  release(messageId, delay = 0) {
    const h = this.#holds.get(messageId);
    if (!h) return;
    clearTimeout(h.timer);
    h.timer = setTimeout(() => {
      this.#holds.delete(messageId);
      if ([...this.views.values()].some((v) => v.pending)) {
        for (const v of this.views.values()) v.pending = false;
        this.refresh();
      }
    }, Math.max(0, delay));
  }

  /** Plate or tag alone; and shed to the tag under load. */
  #applySizes() {
    const combat = game.combat?.started ? game.combat : null;
    const actingToken = combat?.combatant?.tokenId ?? null;
    const shedExpanded = this.ladder?.allows("expanded") === false;
    const shedGlass = this.ladder?.allows("glass") === false;
    for (const [key, view] of this.views) {
      const hovered = this.hovered.has(view.sourceId) || this.hovered.has(view.targetId) || this.hovered.has(`badge:${key}`);
      const turn = !combat || actingToken === view.sourceId;
      const full = hovered || (turn && !shedExpanded);
      view.acting = !!combat && actingToken === view.sourceId;
      view.hot = hovered;
      if (full !== view.full) {
        view.full = full;
        view.el.classList.toggle("is-full", full);
        view.el.classList.toggle("is-compact", !full);
        view.el.style.zIndex = full ? "2" : "";
        view.plateBox = null;
      }
      view.el.classList.toggle("is-flat", shedGlass);
    }
    this.#sig.length = 0;
  }

  #motion() {
    try {
      return motionScale(this.layer);
    } catch {
      return 1;
    }
  }

  /* ── following the line ──────────────────────────────────────────────── */

  #listen() {
    const ticker = canvas?.app?.ticker;
    if (!ticker) return;
    if (this.views.size && !this.#tick) {
      this.#tick = () => this.#position();
      ticker.add(this.#tick);
    } else if (!this.views.size && this.#tick) {
      ticker.remove(this.#tick);
      this.#tick = null;
    }
    this.#sig.length = 0;
    this.#position();
  }

  /** Everything a placement reads, as numbers; equal to last frame's means nothing moved. */
  #unchanged(rect, wt) {
    const s = this.#nextSig;
    s.length = 0;
    s.push(rect.left, rect.top, innerWidth, innerHeight, wt.a, wt.b, wt.c, wt.d, wt.tx, wt.ty);
    for (const v of this.views.values()) {
      const a = tokenById(v.sourceId);
      const b = tokenById(v.targetId);
      s.push(a?.center?.x, a?.center?.y, a?.w, a?.h, a?.visible ? 1 : 0, b?.center?.x, b?.center?.y, b?.w, b?.h, b?.visible ? 1 : 0, v.full ? 1 : 0, v.tagBox ? 1 : 0, v.plateBox ? 1 : 0);
      // Both standees: the straight run under Diorama moves with either end.
      for (const id of [v.sourceId, v.targetId]) {
        const anchor = dioramaAnchor(id);
        s.push(anchor ? 1 : 0, anchor?.x, anchor?.y);
      }
    }
    const prev = this.#sig;
    const same = prev.length === s.length && s.every((n, i) => Object.is(n, prev[i]));
    this.#nextSig = prev;
    this.#sig = s;
    return same;
  }

  #position() {
    const canvasView = canvas?.app?.view;
    const stage = canvas?.stage;
    if (!canvasView || !stage || !this.views.size) return;
    const rect = canvasView.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    const wt = stage.worldTransform;
    if (this.#unchanged(rect, wt)) return;
    const grid = canvas.grid?.size ?? canvas.dimensions?.size ?? 100;

    // Measure everything that needs it first, then write: interleaving a read
    // with the previous element's write forces a layout per line per frame.
    // Layout sizes, not getBoundingClientRect: a tag measured mid-entry carries
    // its `scale(0.86)` and would be placed and collided too small for good.
    for (const v of this.views.values()) {
      if (!v.tagBox) v.tagBox = layoutSize(v.el.querySelector(".glod-tag"));
      if (v.full && !v.plateBox) v.plateBox = layoutSize(v.el.querySelector(".glod-badge"));
    }

    const items = [];
    const obstacles = [];
    const seen = new Set();
    const onBoard = !this.#diorama();
    for (const v of this.views.values()) {
      const source = tokenById(v.sourceId);
      const target = tokenById(v.targetId);
      if (!source || !target || !source.visible || !target.visible || !v.tagBox) {
        v.el.style.visibility = "hidden";
        continue;
      }
      const at = this.#anchors(v, source, target, grid, wt, rect);
      const plate = v.full && v.plateBox ? { w: v.plateBox.width, h: v.plateBox.height } : null;
      items.push({ v, at, w: v.tagBox.width, h: v.tagBox.height, plate });
      if (onBoard) for (const token of [source, target]) if (!seen.has(token)) {
        seen.add(token);
        obstacles.push(screenBox(token, wt, rect));
      }
    }
    // The acting creature's lines and the one under the cursor choose first;
    // the rest slide back along their own lines to stay clear of them.
    items.sort((a, b) => rank(b.v) - rank(a.v));
    const spots = placeLines(items, { w: innerWidth, h: innerHeight }, { obstacles });
    items.forEach((item, i) => {
      const { v } = item;
      const placed = spots[i];
      if (!placed) {
        v.el.style.visibility = "hidden";
        return;
      }
      v.el.style.visibility = "";
      if (placed.side && v.el.dataset.side !== placed.side) v.el.dataset.side = placed.side;
      // The individual `translate` property, never `transform`: the entry
      // animations (fill `both`) own `transform`, and a filled animation
      // outranks an inline style, which would pin every tag to 0,0.
      const tag = v.el.querySelector(".glod-tag");
      if (tag) tag.style.translate = `${placed.tag.x}px ${placed.tag.y}px`;
      const plateEl = v.el.querySelector(".glod-badge");
      if (plateEl && placed.plate) plateEl.style.translate = `${placed.plate.x}px ${placed.plate.y}px`;
    });
  }

  /**
   * `share → screen point and bow normal` for one line. On the board it is
   * the canvas line's own path; under Diorama's 3D view a straight run between
   * the two standees, since the 2D path names the wrong spot there.
   */
  /** Whether Diorama's 3D view is over the board (it answers for any token it draws). */
  #diorama() {
    for (const v of this.views.values()) if (dioramaAnchor(v.targetId)) return true;
    return false;
  }

  #anchors(v, source, target, grid, wt, rect) {
    const head = dioramaAnchor(v.targetId);
    const tail = head ? dioramaAnchor(v.sourceId) : null;
    if (head && tail) return (share) => straightAnchor(tail, head, Math.min(share, 0.8));
    const path = linePath(
      { from: source.center, to: target.center, sourceSize: Math.max(source.w, source.h), targetSize: Math.max(target.w, target.h), gridSize: grid },
      v.path
    );
    const out = { x: 0, y: 0, nx: 0, ny: 1, arc: 0 };
    return (share) => {
      const a = tagAnchor(path, share, grid, out);
      const nx = wt.a * a.nx + wt.c * a.ny;
      const ny = wt.b * a.nx + wt.d * a.ny;
      const n = Math.hypot(nx, ny) || 1;
      return {
        x: rect.left + wt.a * a.x + wt.c * a.y + wt.tx,
        y: rect.top + wt.b * a.x + wt.d * a.y + wt.ty,
        nx: nx / n,
        ny: ny / n,
      };
    };
  }

  /* ── lifecycle ───────────────────────────────────────────────────────── */

  #mount() {
    if (this.layer?.isConnected) return;
    const layer = document.createElement("div");
    layer.id = "glod-lines";
    layer.className = "glod-lines gl-type";
    document.body.append(layer);
    this.layer = layer;
  }

  #drop(key, view) {
    view.el.classList.add("is-leaving");
    const el = view.el;
    setTimeout(() => el.remove(), TIMING.leave * Math.max(0, this.#motion()));
    this.views.delete(key);
    // Removed under the cursor, it never hears its pointerleave.
    this.hovered.delete(`badge:${key}`);
  }

  #clear() {
    for (const [key, view] of this.views) this.#drop(key, view);
    this.#listen();
  }

  #unmount() {
    this.#clear();
    if (this.#tick) {
      canvas?.app?.ticker?.remove(this.#tick);
      this.#tick = null;
    }
    // The next scene's tokens are new objects; ids hovered here mean nothing there.
    this.hovered.clear();
    this.layer?.remove();
    this.layer = null;
  }

  /** Whether a landing would show on a line here (dice-highlight.mjs asks before it waits). */
  hasLine(landing) {
    return !!landing?.sourceId && !!landing.targetId && this.views.has(`${landing.sourceId}>${landing.targetId}`);
  }

  /**
   * A check on this line resolved: stamp its degree on the plate and mark the
   * face that came up, or, with the plate closed, on the tag the table is
   * looking at. dice-highlight.mjs calls it once the die has come to rest (or
   * at once, without Dice So Nice); what may be shown is landing.mjs's to decide.
   */
  land(landing, motion = this.#motion()) {
    if (this.ladder?.allows("landBeat") === false || !this.hasLine(landing)) return;
    const view = this.views.get(`${landing.sourceId}>${landing.targetId}`);
    const plate = view?.el.querySelector(".glod-badge");
    if (view?.full && plate) playLanding(plate, { face: landing.face, degree: landing.degree, stamps: landing.stamps, t: L, motion });
    else playTagLanding(view?.el.querySelector(".glod-tag"), { degree: landing.degree, stamps: landing.stamps, t: L, motion });
  }

  /** The plates whose roller is this actor. */
  badgesFor(actorId) {
    return [...this.views.values()].filter((v) => tokenById(v.sourceId)?.actor?.id === actorId).map((v) => v.el.querySelector(".glod-badge"));
  }
}

/** An element's untransformed size; null while it is not laid out. */
function layoutSize(el) {
  if (!el || !el.offsetWidth) return null;
  return { width: el.offsetWidth, height: el.offsetHeight };
}

/** A token's square on screen, which an open plate keeps off. */
function screenBox(token, wt, rect) {
  const c = token.center ?? { x: token.x + token.w / 2, y: token.y + token.h / 2 };
  const x = rect.left + wt.a * c.x + wt.c * c.y + wt.tx;
  const y = rect.top + wt.b * c.x + wt.d * c.y + wt.ty;
  const w = Math.abs(wt.a) * (token.w ?? 0);
  const h = Math.abs(wt.d) * (token.h ?? 0);
  return { x: x - w / 2, y: y - h / 2, w, h };
}

/** Who picks a spot on the line first. */
function rank(v) {
  return (v.hot ? 4 : 0) + (v.acting ? 2 : 0) + (v.full ? 1 : 0);
}
