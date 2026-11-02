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
 *
 * While Diorama's 3D view covers the board, the stage transform names a spot on a board nobody can
 * see, so bubbles are placed from the view instead (`tokenAnchor`, `project`) on animation frames,
 * which follow its camera and a hopping standee. The bubble layer stacks above the view (z sticky
 * over the view's z base). A token with no standee on this viewer's board gets no bubble.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { Features } from "../../core/registry.mjs";
import { rpModeOf } from "../../core/rp-mode.mjs";
import { isConfiguredStreamUser } from "../stream/settings.js";
import { CSS } from "./constants.mjs";
import {
  STACK,
  TYPING,
  canView,
  isInCharacter,
  laneBox,
  lifetimeMs,
  onScreen,
  overlayScale,
  pushStack,
  routeLine,
  textOf
} from "./model.mjs";
import { bubbleLineHTML, bubbleTailHTML, laneLineHTML, typingHTML } from "./render.mjs";
import { identityOf, viewsAsAudience } from "./identity.mjs";
import { overlaysOn, streamBubblesOn } from "./settings.mjs";

/** How long a line takes to leave, matching `--gl-d-glide` in the stylesheet. */
const LEAVE_MS = 540;

const parse = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

/**
 * Diorama's api while its 3D view is open on this client, else null (feature off, absent, closed).
 * Every access is guarded: this feature never depends on Diorama being there.
 */
function diorama() {
  try {
    const api = game.modules.get(SUITE_ID)?.api?.features?.diorama;
    return api?.isOpen?.() ? api : null;
  } catch {
    return null;
  }
}

const finitePoint = (p) => (p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null);

class Overlay {
  layer = null;
  lane = null;
  /** `${tokenId}:${place}` → { tokenId, place, mode, el, stackEl, lines: [{ id, el, timer }] } */
  stacks = new Map();
  /** tokenId → { el, timer }: the "…" over a token whose player is writing. */
  typers = new Map();
  laneLines = [];
  /** The PIXI ticker callback (the 2D board). */
  #tick = null;
  /** The animation frame placing bubbles over Diorama's 3D view, while it is open. */
  #raf = 0;

  /* ── a new line ─────────────────────────────────────────────────────── */

  show(message) {
    const mode = rpModeOf(message?.flags);
    if (!isInCharacter(mode)) return;
    // The line has arrived: the "…" that announced it has done its job.
    if (message.speaker?.token) this.typing(message.speaker.token, false);
    const canRead = canView({
      whisper: message.whisper,
      blind: message.blind,
      authorId: message.author?.id ?? null,
      viewerId: game.user?.id ?? null,
      viewerIsGM: Boolean(game.user?.isGM),
      audience: viewsAsAudience()
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

  /**
   * The "…" over a token, up or down. Whoever sent it has already been checked (`typing.mjs`); every
   * ping restarts the expiry, so a writer who vanishes mid-sentence takes theirs down by themselves.
   */
  typing(tokenId, on) {
    const current = this.typers.get(tokenId);
    if (!on) {
      if (!current) return;
      clearTimeout(current.timer);
      this.typers.delete(tokenId);
      this.#leave(current.el);
      this.#listen();
      return;
    }
    if (current) {
      clearTimeout(current.timer);
      current.timer = setTimeout(() => this.typing(tokenId, false), TYPING.expire);
      return;
    }
    this.#mount();
    const el = parse(typingHTML());
    el.classList.add("glrp-enter");
    this.layer.append(el);
    this.typers.set(tokenId, { el, timer: setTimeout(() => this.typing(tokenId, false), TYPING.expire) });
    this.#listen();
    this.#place();
  }

  /** The canvas went away (scene change, teardown): tokens' lines go with it. The lane stays. */
  clearTokens() {
    for (const stack of [...this.stacks.values()]) {
      for (const line of [...stack.lines]) clearTimeout(line.timer);
      stack.el.remove();
    }
    this.stacks.clear();
    for (const typer of this.typers.values()) {
      clearTimeout(typer.timer);
      typer.el.remove();
    }
    this.typers.clear();
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
    const dio = diorama();
    if (dio) {
      // The view covers the window; a token with no standee there is not on screen.
      const point = token.visible ? this.#point3d(dio, token, "above") : null;
      const viewport = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      return { onScene: true, visible: Boolean(token.visible), onScreen: onScreen(point, viewport) };
    }
    const rect = canvas.app?.view?.getBoundingClientRect?.();
    const point = rect ? this.#screenPoint(token, "above", rect) : null;
    const viewport = rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null;
    return { onScene: true, visible: Boolean(token.visible), onScreen: onScreen(point, viewport) };
  }

  /**
   * Where a token's line hangs in the 3D view, client px, or null when its token has no standee on
   * this viewer's board. "above" is over the standee's head; "below" is its feet on the 3D ground.
   */
  #point3d(dio, token, place) {
    let head = null;
    try {
      head = finitePoint(dio.tokenAnchor?.(token.id));
    } catch {
      return null;
    }
    if (!head || place === "above") return head;
    const c = token.center ?? { x: token.x, y: token.y };
    try {
      return finitePoint(dio.project?.(c.x, c.y, Number(token.document?.elevation) || 0));
    } catch {
      return null;
    }
  }

  /** Screen px per scene px around a token in the 3D view: the stage scale's equivalent. */
  #scale3d(dio, token) {
    const size = canvas?.grid?.size || canvas?.dimensions?.size || 100;
    const c = token.center ?? { x: token.x, y: token.y };
    const e = Number(token.document?.elevation) || 0;
    try {
      const o = finitePoint(dio.project?.(c.x, c.y, e));
      const ax = finitePoint(dio.project?.(c.x + size, c.y, e));
      const ay = finitePoint(dio.project?.(c.x, c.y + size, e));
      if (!o || !ax || !ay) return 1;
      return (Math.hypot(ax.x - o.x, ax.y - o.y) + Math.hypot(ay.x - o.x, ay.y - o.y)) / 2 / size;
    } catch {
      return 1;
    }
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
      if (stack.lines.length) return;
      // A stack replaced by one of another shape (a Think over a token whose Say is still leaving) is no
      // longer in the map, but its element is still in the layer: it goes too, or every switch between
      // Say and Think over one token left an invisible husk behind for the rest of the session.
      stack.el.remove();
      if (this.stacks.get(stack.key) !== stack) return;
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

  /**
   * Over the hotbar and clear of it, centred where the hotbar is centred (the space left of the
   * sidebar), never under the sidebar. Foundry moves the hotbar when the chat notifications open and
   * the sidebar when it collapses, so this is measured on every new line (`laneBox`).
   */
  #placeLane() {
    const rect = (id) => {
      const r = document.getElementById(id)?.getBoundingClientRect?.();
      return r && r.width > 0 && r.height > 0 ? r : null;
    };
    const hotbar = rect("hotbar");
    const sidebar = rect("sidebar");
    const box = laneBox({ width: innerWidth, height: innerHeight, hotbar, sidebarLeft: sidebar ? sidebar.left : null });
    this.lane.style.left = `${box.center}px`;
    this.lane.style.width = `${box.width}px`;
    this.lane.style.bottom = `${box.bottom}px`;
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

  /**
   * Run placement while anything is up: the PIXI ticker for the board, and animation frames while
   * Diorama's 3D view is open (its camera and standees move with no canvas frame behind them). Each
   * loop notices the view opening or closing and hands over, re-placing at once.
   */
  #listen() {
    const ticker = canvas?.app?.ticker;
    const busy = this.stacks.size > 0 || this.typers.size > 0;
    if (busy && !this.#tick && ticker) {
      this.#tick = () => {
        if (diorama()) this.#listen();
        else this.#place();
      };
      ticker.add(this.#tick);
    } else if (!busy && this.#tick) {
      ticker?.remove(this.#tick);
      this.#tick = null;
    }
    const over3d = busy && Boolean(diorama());
    if (over3d && !this.#raf) this.#raf = requestAnimationFrame(this.#frame3d);
    else if (!over3d && this.#raf) {
      cancelAnimationFrame(this.#raf);
      this.#raf = 0;
    }
  }

  #frame3d = () => {
    this.#raf = 0;
    this.#place();
    this.#listen();
  };

  #place() {
    const dio = diorama();
    if (dio) return this.#place3d(dio);
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
    for (const [tokenId, typer] of this.typers) {
      const token = canvas.tokens?.get(tokenId);
      // Over the token's top-right corner, clear of the balloon that will replace it.
      if (!token || !token.visible) {
        typer.el.style.visibility = "hidden";
        continue;
      }
      const p = canvas.stage.worldTransform.apply({ x: token.x + (token.w ?? 0), y: token.y });
      typer.el.style.visibility = "";
      typer.el.style.translate = `${Math.round(rect.left + p.x)}px ${Math.round(rect.top + p.y)}px`;
      typer.el.style.setProperty("--glrp-scale", scale.toFixed(3));
    }
  }

  /**
   * Placement over Diorama's 3D view. A token Foundry hides from this viewer, or one with no standee
   * on their board, gets no bubble and no pill: hiding here is privacy as much as layout.
   */
  #place3d(dio) {
    const hide = (el) => {
      el.style.visibility = "hidden";
    };
    for (const stack of this.stacks.values()) {
      const token = canvas?.tokens?.get(stack.tokenId);
      const p = token?.visible ? this.#point3d(dio, token, stack.place) : null;
      if (!p) {
        hide(stack.el);
        continue;
      }
      stack.el.style.visibility = "";
      stack.el.style.translate = `${Math.round(p.x)}px ${Math.round(p.y)}px`;
      stack.el.style.setProperty("--glrp-scale", overlayScale(this.#scale3d(dio, token)).toFixed(3));
    }
    for (const [tokenId, typer] of this.typers) {
      const token = canvas?.tokens?.get(tokenId);
      const head = token?.visible ? this.#point3d(dio, token, "above") : null;
      if (!head) {
        hide(typer.el);
        continue;
      }
      // Beside the standee's head, where the board puts it at the token's top-right corner.
      const px = this.#scale3d(dio, token);
      const x = head.x + ((token.w ?? 0) / 2) * px;
      typer.el.style.visibility = "";
      typer.el.style.translate = `${Math.round(x)}px ${Math.round(head.y)}px`;
      typer.el.style.setProperty("--glrp-scale", overlayScale(px).toFixed(3));
    }
  }
}

export const overlay = new Overlay();
