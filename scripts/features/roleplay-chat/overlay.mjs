/**
 * Roleplay Chat — bubbles over tokens and the caption lane.
 *
 * Every client draws its own copy of every line, decided on its own screen: whether this viewer may
 * read the message at all, whether the speaker's token is on the scene they are looking at, visible to
 * them, and on their screen. A line with no token to hang from goes to the caption lane at the bottom
 * of the screen instead, so a line is never lost because the speaker could not be drawn. The rules are
 * `routeLine` and `canView` in `model.mjs`.
 *
 * Bubbles are DOM in one fixed layer over the canvas, under Foundry's interface, placed on the PIXI
 * ticker from the stage transform so they follow a moving token and every pan and zoom. The ticker
 * callback exists only while something is up.
 */

import { Features } from "../../core/registry.mjs";
import { rpModeOf } from "../../core/rp-mode.mjs";
import { isConfiguredStreamUser } from "../stream/settings.js";
import { CSS } from "./constants.mjs";
import {
  STACK,
  canView,
  isInCharacter,
  lifetimeMs,
  onScreen,
  overlayScale,
  pushStack,
  routeLine,
  textOf
} from "./model.mjs";
import { bubbleLineHTML, bubbleTailHTML, laneLineHTML } from "./render.mjs";
import { identityOf } from "./identity.mjs";
import { overlaysOn, streamBubblesOn } from "./settings.mjs";

/** How long a line takes to leave, matching `--gl-d-glide` in the stylesheet. */
const LEAVE_MS = 540;

const parse = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

class Overlay {
  layer = null;
  lane = null;
  /** `${tokenId}:${place}` → { tokenId, place, mode, el, stackEl, lines: [{ id, el, timer }] } */
  stacks = new Map();
  laneLines = [];
  #tick = null;

  /* ── a new line ─────────────────────────────────────────────────────── */

  show(message) {
    const mode = rpModeOf(message?.flags);
    if (!isInCharacter(mode)) return;
    const canRead = canView({
      whisper: message.whisper,
      blind: message.blind,
      authorId: message.author?.id ?? null,
      viewerId: game.user?.id ?? null,
      viewerIsGM: Boolean(game.user?.isGM)
    });
    const token = this.#tokenFor(message);
    const route = routeLine({
      mode,
      canRead,
      overlaysOn: overlaysOn(),
      suppressed: Features.on("stream") && isConfiguredStreamUser() && !streamBubblesOn(),
      token: token ? this.#tokenFacts(token) : null
    });
    if (!route) return;
    const who = identityOf(message);
    const text = textOf(message.content);
    if (!text) return;
    const line = { id: message.id, mode, name: who.name, img: who.img, text, life: lifetimeMs(text) };
    this.#mount();
    if (route === "caption") this.#pushLane(line);
    else this.#pushToken(token, route === "under" ? "below" : "above", line);
  }

  /** A deleted message takes its line with it, wherever it is. */
  forget(messageId) {
    for (const stack of this.stacks.values()) {
      for (const line of stack.lines.filter((l) => l.id === messageId)) this.#dropTokenLine(stack, line);
    }
    for (const line of this.laneLines.filter((l) => l.id === messageId)) this.#dropLaneLine(line);
  }

  /** The canvas went away (scene change, teardown): tokens' lines go with it. The lane stays. */
  clearTokens() {
    for (const stack of [...this.stacks.values()]) {
      for (const line of [...stack.lines]) clearTimeout(line.timer);
      stack.el.remove();
    }
    this.stacks.clear();
    this.#listen();
  }

  destroy() {
    this.clearTokens();
    for (const line of this.laneLines) clearTimeout(line.timer);
    this.laneLines = [];
    this.layer?.remove();
    this.lane?.remove();
    this.layer = this.lane = null;
  }

  /* ── tokens ─────────────────────────────────────────────────────────── */

  #tokenFor(message) {
    const speaker = message?.speaker;
    if (!canvas?.ready || !speaker?.token || speaker.scene !== canvas.scene?.id) return null;
    return canvas.tokens?.get(speaker.token) ?? null;
  }

  #tokenFacts(token) {
    const rect = canvas.app?.view?.getBoundingClientRect?.();
    const point = rect ? this.#screenPoint(token, "above", rect) : null;
    const viewport = rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null;
    return { onScene: true, visible: Boolean(token.visible), onScreen: onScreen(point, viewport) };
  }

  #screenPoint(token, place, rect) {
    const c = token.center ?? { x: token.x, y: token.y };
    const h = token.h ?? 0;
    const p = canvas.stage.worldTransform.apply({ x: c.x, y: place === "above" ? token.y : token.y + h });
    return { x: rect.left + p.x, y: rect.top + p.y };
  }

  #pushToken(token, place, line) {
    const key = `${token.id}:${place}`;
    let stack = this.stacks.get(key);
    if (!stack || stack.mode !== (place === "below" ? "do" : line.mode)) {
      // A stack is one shape: a Say balloon and a Think cloud over the same token do not share a tail.
      if (stack) for (const old of [...stack.lines]) this.#dropTokenLine(stack, old);
      stack = this.#buildStack(token.id, place, place === "below" ? "do" : line.mode);
      this.stacks.set(key, stack);
    }
    // A line arriving while the last one is leaving keeps the stack (and its tail) up.
    stack.el.classList.remove("glrp-leaving");
    line.el = parse(bubbleLineHTML(line));
    line.el.classList.add("glrp-enter");
    stack.stackEl.append(line.el);
    const { list, evicted } = pushStack(stack.lines, line, STACK.token);
    stack.lines = list;
    for (const old of evicted) this.#dropTokenLine(stack, old, { keepInList: true });
    this.#markOld(stack.lines);
    line.timer = setTimeout(() => this.#dropTokenLine(stack, line), line.life);
    this.#listen();
    this.#place();
  }

  #buildStack(tokenId, place, mode) {
    const el = document.createElement("div");
    el.className = `glrp-bub glrp-bub--${place}`;
    el.dataset.glrpMode = mode;
    const stackEl = document.createElement("div");
    stackEl.className = "glrp-bub-stack";
    el.append(stackEl);
    const tail = bubbleTailHTML(mode);
    if (tail) el.append(parse(tail));
    this.layer.append(el);
    return { key: `${tokenId}:${place}`, tokenId, place, mode, el, stackEl, lines: [] };
  }

  #dropTokenLine(stack, line, { keepInList = false } = {}) {
    clearTimeout(line.timer);
    if (!keepInList) stack.lines = stack.lines.filter((l) => l !== line);
    this.#leave(line.el, () => {
      if (stack.lines.length || this.stacks.get(stack.key) !== stack) return;
      stack.el.remove();
      this.stacks.delete(stack.key);
      this.#listen();
    });
    if (!keepInList) this.#markOld(stack.lines);
    if (!stack.lines.length) stack.el.classList.add("glrp-leaving");
  }

  /* ── the caption lane ───────────────────────────────────────────────── */

  #pushLane(line) {
    line.el = parse(laneLineHTML(line));
    line.el.dataset.glrpMode = line.mode;
    line.el.classList.add("glrp-enter");
    this.lane.append(line.el);
    const { list, evicted } = pushStack(this.laneLines, line, STACK.lane);
    this.laneLines = list;
    for (const old of evicted) this.#dropLaneLine(old, { keepInList: true });
    this.#markOld(this.laneLines);
    line.timer = setTimeout(() => this.#dropLaneLine(line), line.life);
    this.#placeLane();
  }

  #dropLaneLine(line, { keepInList = false } = {}) {
    clearTimeout(line.timer);
    if (!keepInList) this.laneLines = this.laneLines.filter((l) => l !== line);
    this.#leave(line.el);
    if (!keepInList) this.#markOld(this.laneLines);
  }

  /** Clear of the hotbar, which Foundry moves when the chat notifications open. */
  #placeLane() {
    const hotbar = document.getElementById("hotbar");
    const top = hotbar?.getBoundingClientRect?.().top;
    const bottom = Number.isFinite(top) && top > 0 ? Math.max(12, innerHeight - top + 14) : 84;
    this.lane.style.bottom = `${Math.round(bottom)}px`;
  }

  /* ── shared ─────────────────────────────────────────────────────────── */

  /** Every line but the newest is dimmed. */
  #markOld(lines) {
    lines.forEach((l, i) => l.el?.classList.toggle("glrp-old", i < lines.length - 1));
  }

  #leave(el, done) {
    if (!el || el.classList.contains("glrp-leaving")) return done?.();
    el.classList.remove("glrp-enter");
    el.classList.add("glrp-leaving");
    const finish = () => {
      el.remove();
      done?.();
    };
    el.addEventListener("animationend", finish, { once: true });
    setTimeout(finish, LEAVE_MS + 100);
  }

  #mount() {
    if (!this.layer?.isConnected) {
      this.layer = document.createElement("div");
      this.layer.id = CSS.layer;
      this.layer.className = `${CSS.layer} gl-type`;
      this.layer.setAttribute("aria-hidden", "true");
      document.body.append(this.layer);
    }
    if (!this.lane?.isConnected) {
      this.lane = document.createElement("div");
      this.lane.id = CSS.lane;
      this.lane.className = `${CSS.lane} gl-type`;
      this.lane.setAttribute("role", "log");
      this.lane.setAttribute("aria-live", "polite");
      document.body.append(this.lane);
    }
  }

  #listen() {
    const ticker = canvas?.app?.ticker;
    if (this.stacks.size && !this.#tick && ticker) {
      this.#tick = () => this.#place();
      ticker.add(this.#tick);
    } else if (!this.stacks.size && this.#tick) {
      ticker?.remove(this.#tick);
      this.#tick = null;
    }
  }

  #place() {
    const rect = canvas?.app?.view?.getBoundingClientRect?.();
    if (!rect || !canvas.stage) return;
    const scale = overlayScale(canvas.stage.scale?.x ?? 1);
    for (const stack of this.stacks.values()) {
      const token = canvas.tokens?.get(stack.tokenId);
      // A token that went out of this viewer's sight takes its bubble out of sight with it.
      if (!token || !token.visible) {
        stack.el.style.visibility = "hidden";
        continue;
      }
      const p = this.#screenPoint(token, stack.place, rect);
      stack.el.style.visibility = "";
      stack.el.style.translate = `${Math.round(p.x)}px ${Math.round(p.y)}px`;
      stack.el.style.setProperty("--glrp-scale", scale.toFixed(3));
    }
  }
}

export const overlay = new Overlay();
