/**
 * The odds badge on the targeting line.
 *
 * ## Where a badge appears
 *
 * Exactly where a targeting line does. With `stream-targets` on, its
 * controller announces the lines it draws (`TARGETS_HOOKS.linesChanged`) and a
 * badge is hung on each — so a badge never names a token that client cannot
 * see, because the line already refused to. With the line feature off, the
 * badge falls back to the honest minimum: the user's own token to their own
 * targets (and, for the GM in combat, the acting combatant to the GM's).
 *
 * ## What it is
 *
 * DOM, not PIXI. Text at 9–34px with tabular figures, hatching and chips is
 * what the DOM is good at and a canvas is not, and the suite's tokens apply
 * as-is. It sits in one fixed layer above the board and is moved on the
 * canvas ticker to follow the target token through pans and zooms; nothing in
 * it animates per frame except its position.
 *
 * ## Full and compact
 *
 * A table full of lines would be a wall of plates, so a badge is the full
 * strip only while it matters — on its roller's turn, while either token or
 * the badge is hovered, and out of combat (where there are few lines and no
 * turns) — and the compact `60%` tag otherwise (Q21).
 */

import { Budget } from "../../core/budget.mjs";
import { warn } from "../../core/const.mjs";
import { Suite } from "../../core/registry.mjs";
import { motionScale } from "../../core/theme.mjs";
import { TARGETS_HOOKS } from "../stream-targets/settings.js";
import { TARGETS_FEATURE_ID } from "../stream/constants.js";
import { FEATURE_ID, SETTINGS, SHED_ORDER, TIMING } from "./constants.mjs";
import { DEGREE_KEYS } from "../../core/pf2e-odds.mjs";
import { badgeHTML, compactHTML, playLanding, updateBadge } from "./render.mjs";
import { get } from "./settings.mjs";
import { onTrackerChange, stepMap } from "./tracker.mjs";
import { modelFor } from "./view.mjs";

const L = (key) => {
  if (typeof key !== "string" || !key) return "";
  const s = game.i18n.localize(key);
  return s;
};

const tokenById = (id) => canvas?.tokens?.get(id) ?? null;

export class LineBadges {
  /** pairKey → { sourceId, targetId, el, model, full, seq } */
  views = new Map();
  layer = null;
  hovered = new Set();
  linePairs = null;
  ladder = null;
  #tick = null;
  #timer = null;
  #seq = 0;

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
    for (const hook of ["combatTurnChange", "combatStart", "deleteCombat", "controlToken"]) Hooks.on(hook, () => this.refresh());
    onTrackerChange(() => this.refresh());
    Hooks.on("createChatMessage", (message) => this.land(message));
    if (canvas?.ready) this.#mount();
    this.refresh();
  }

  /** Debounced: recompute every badge's model and redraw. */
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

  /** The pairs this client should badge. */
  #pairs() {
    if (this.#linesOn()) return this.linePairs ?? [];
    const out = [];
    const targets = [...(game.user?.targets ?? [])];
    if (!targets.length) return out;
    const combat = game.combat?.started ? game.combat : null;
    const own = canvas.tokens?.controlled?.[0] ?? game.user?.character?.getActiveTokens?.()?.[0] ?? null;
    const acting = combat && game.user.isGM ? canvas.tokens?.get(combat.combatant?.tokenId) : null;
    const source = acting ?? own;
    if (!source) return out;
    for (const t of targets) if (t.id !== source.id) out.push({ sourceId: source.document.id, targetId: t.document.id });
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
    if (!model) {
      if (view) this.#drop(key, view);
      return;
    }
    const opts = { t: L, target: target.document?.name ?? target.name ?? "", motion: this.#motion() };
    if (!view) {
      const el = document.createElement("div");
      el.className = "glod-line";
      el.dataset.pair = key;
      el.innerHTML = badgeHTML(model, opts) + compactHTML(model);
      this.#bind(el, pair);
      this.layer.append(el);
      view = { ...pair, el, model, full: null };
      this.views.set(key, view);
      return;
    }
    const plate = view.el.querySelector(".glod-badge");
    if (plate && this.ladder?.allows("narrowBeat") !== false) updateBadge(plate, view.model, model, opts);
    else if (plate) plate.outerHTML = badgeHTML(model, opts);
    const tag = view.el.querySelector(".glod-tag");
    if (tag) tag.outerHTML = compactHTML(model);
    view.model = model;
  }

  #bind(el, pair) {
    el.addEventListener("pointerenter", () => {
      this.hovered.add(`badge:${pair.sourceId}>${pair.targetId}`);
      this.#applySizes();
    });
    el.addEventListener("pointerleave", () => {
      this.hovered.delete(`badge:${pair.sourceId}>${pair.targetId}`);
      this.#applySizes();
    });
    el.addEventListener("click", (event) => {
      const chip = event.target.closest?.('[data-action="glod-map"]');
      if (!chip) return;
      event.stopPropagation();
      const actor = tokenById(pair.sourceId)?.actor;
      if (actor?.isOwner) stepMap(actor);
    });
  }

  /** Full or compact, per Q21; and shed to compact under load. */
  #applySizes() {
    const combat = game.combat?.started ? game.combat : null;
    const actingToken = combat?.combatant?.tokenId ?? null;
    const shedExpanded = this.ladder?.allows("expanded") === false;
    const shedGlass = this.ladder?.allows("glass") === false;
    for (const [key, view] of this.views) {
      const hovered = this.hovered.has(view.sourceId) || this.hovered.has(view.targetId) || this.hovered.has(`badge:${key}`);
      const turn = !combat || actingToken === view.sourceId;
      const full = hovered || (turn && !shedExpanded);
      if (full !== view.full) {
        view.full = full;
        view.el.classList.toggle("is-full", full);
        view.el.classList.toggle("is-compact", !full);
      }
      view.el.classList.toggle("is-flat", shedGlass);
    }
  }

  #motion() {
    try {
      return motionScale(this.layer);
    } catch {
      return 1;
    }
  }

  /* ── following the token ─────────────────────────────────────────────── */

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
    this.#position();
  }

  #position() {
    const view = canvas?.app?.view;
    const stage = canvas?.stage;
    if (!view || !stage) return;
    const rect = view.getBoundingClientRect?.() ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const wt = stage.worldTransform;
    for (const v of this.views.values()) {
      const target = tokenById(v.targetId);
      if (!target || !target.visible) {
        v.el.style.visibility = "hidden";
        continue;
      }
      // Anchor at the target's lower-right shoulder: off the art, clear of the
      // reticle the line lands on and of the resource bars under the token.
      const c = target.center ?? { x: target.x, y: target.y };
      const w = target.w ?? 0;
      const h = target.h ?? 0;
      const p = wt.apply({ x: c.x + w * 0.5, y: c.y - h * 0.1 });
      const x = Math.round(rect.left + p.x + 10);
      const y = Math.round(rect.top + p.y);
      const box = v.el.getBoundingClientRect();
      const cx = Math.min(Math.max(8, x), innerWidth - box.width - 8);
      const cy = Math.min(Math.max(8, y), innerHeight - box.height - 8);
      v.el.style.visibility = "";
      v.el.style.transform = `translate(${cx}px, ${cy}px)`;
    }
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
    this.layer?.remove();
    this.layer = null;
  }

  /**
   * A check on this line resolved: stamp its degree on the plate and mark the
   * face that came up. Only what this client could read on the card itself —
   * a blind roll stamps nothing, and a degree PF2e hides from players (its
   * metagame "results" setting) is not stamped for them either.
   */
  land(message) {
    if (this.ladder?.allows("landBeat") === false || !message?.isContentVisible || message.blind) return;
    const ctx = message.flags?.pf2e?.context;
    const roll = message.rolls?.[0];
    const sourceId = message.speaker?.token;
    const targetId = String(ctx?.target?.token ?? "").split(".").pop();
    if (!ctx || !roll || !sourceId || !targetId) return;
    const plate = this.views.get(`${sourceId}>${targetId}`)?.el.querySelector(".glod-badge");
    if (!plate) return;
    const degree = DEGREE_KEYS.indexOf(ctx.outcome ?? "");
    const resultsShown = game.user.isGM || !!game.pf2e?.settings?.metagame?.results;
    const face = roll.dice?.find((d) => d.faces === 20)?.total ?? null;
    if (!Number.isInteger(face)) return;
    const stamps = ctx.type === "attack-roll" || ctx.type === "spell-attack-roll" ? "attack" : "check";
    playLanding(plate, { face, degree: resultsShown && degree >= 0 ? degree : null, stamps, t: L, motion: this.#motion() });
  }

  /** The landing beat on every badge whose roller is this actor (PR 2 drives it). */
  badgesFor(actorId) {
    return [...this.views.values()].filter((v) => tokenById(v.sourceId)?.actor?.id === actorId).map((v) => v.el.querySelector(".glod-badge"));
  }
}

