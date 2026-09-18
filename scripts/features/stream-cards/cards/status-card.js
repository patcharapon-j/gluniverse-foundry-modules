/**
 * The PF2e status card: what just happened to a creature that was not a roll.
 *
 * Deliberately the *damage row's* size rather than the roll card's. A condition is a consequence, and
 * on a stream a consequence that arrives at the same weight as the roll that caused it reads as a
 * second roll. It sits in the same stack, under the same lifetime, with the same hairline and the same
 * framed art, so it is plainly the same feature speaking more quietly.
 *
 * It renders a StatusCardModel (see `pf2e/read-status.js`) and owns its motion. It never reads Foundry
 * documents; the reader builds the model.
 *
 * Contract with the chat overlay: `element`, `exit()` and `destroy()`, the same three the roll card
 * offers, because the overlay owns the stack and removes both kinds the same way.
 */

import { remove } from "../../stream/motion/engine.js";
import { isFocus, placement, squareFocus } from "../framing/focus-math.js";
import { CSS_SNAP, EASE_EXIT, EASE_OUT, EASE_POP, EASE_SNAP, el, tween, waapi } from "./card-motion.js";
import { statusTone } from "../pf2e/read-status.js";

const DEFAULT_LABELS = {
  Gained: "gained",
  Raised: "raised",
  Lowered: "eased",
  Lost: "ended",
  NPC: "NPC"
};

/** The mark beside a status: arriving, rising, falling, gone. */
const DIRECTION_MARKS = {
  gained: "+",
  raised: "▲",
  lowered: "▼",
  lost: "−"
};

const DIRECTION_LABEL_KEYS = {
  gained: "Gained",
  raised: "Raised",
  lowered: "Lowered",
  lost: "Lost"
};

export class StatusCard {
  /**
   * @param {object} model   StatusCardModel from the PF2e status reader.
   * @param {object} [options]
   * @param {(key: string) => string} [options.label]  Localises a label key; defaults to English.
   * @param {{peek: Function, request: Function, watch?: Function}} [options.framer]
   */
  constructor(model, { label, framer } = {}) {
    this.label = (key) => label?.(key) ?? DEFAULT_LABELS[key] ?? key;
    this.framer = framer ?? null;
    this.model = model;
    this.destroyed = false;
    this.element = this.buildShell();
    this.render(model);
  }

  buildShell() {
    const root = el("div", "glus-sc");
    const strip = el("div", "glus-sc-strip");
    const frame = el("div", "glus-sc-art-frame");
    const art = el("img", "glus-sc-art");
    art.alt = "";
    art.decoding = "async";
    frame.append(art);
    strip.append(
      frame,
      el("span", "glus-sc-monogram"),
      el("span", "glus-sc-name"),
      el("div", "glus-sc-chips"),
      el("div", "glus-sc-hair")
    );
    root.append(strip);
    this.strip = strip;
    return root;
  }

  q(selector) {
    return this.element.querySelector(selector);
  }

  /** Pixels per design unit, read from the card's own width (22u) so it tracks the overlay's scale. */
  unit() {
    return (this.element.getBoundingClientRect().width || 422.4) / 22;
  }

  render(model) {
    this.model = model;
    const root = this.element;
    root.dataset.tone = statusTone(model.changes);
    root.toggleAttribute("data-npc", !!model.actor?.isNpc);

    const art = this.q(".glus-sc-art");
    const img = model.actor?.img ?? null;
    if (img && art.getAttribute("src") !== img) art.src = img;
    else if (!img) art.removeAttribute("src");
    this.q(".glus-sc-art-frame").dataset.kind = model.actor?.imgKind === "token" ? "token" : "portrait";
    root.toggleAttribute("data-no-art", !img);
    this.q(".glus-sc-monogram").textContent = (model.actor?.name ?? "?").trim().charAt(0).toUpperCase() || "?";
    this.frameArt(img, model.actor?.focus);

    this.q(".glus-sc-name").textContent = model.actor?.name ?? "";
    this.q(".glus-sc-chips").replaceChildren(...model.changes.map((change) => this.buildChip(change)));
  }

  buildChip(change) {
    const chip = el("span", "glus-sc-chip");
    chip.dataset.direction = change.direction;
    chip.dataset.kind = change.kind;
    if (change.slug) chip.dataset.slug = change.slug;
    if (change.img) {
      const icon = el("img", "glus-sc-chip-icon");
      icon.src = change.img;
      icon.alt = "";
      icon.decoding = "async";
      chip.append(icon);
    }
    chip.append(el("span", "glus-sc-chip-mark", DIRECTION_MARKS[change.direction] ?? ""));
    chip.append(el("span", "glus-sc-chip-name", change.name));
    if (change.value !== null) {
      chip.dataset.valued = "";
      chip.append(el("b", "glus-sc-chip-value", change.value));
    }
    chip.append(el("span", "glus-sc-chip-state", this.label(DIRECTION_LABEL_KEYS[change.direction] ?? "Gained")));
    return chip;
  }

  /** The same framing the roll card uses, re-struck as a square (see focus-math's squareFocus). */
  frameArt(img, manual) {
    this.unwatchArt?.();
    this.unwatchArt = null;
    this.artSrc = img ?? null;
    if (!img) return this.applyFocus(null);
    if (isFocus(manual)) return this.applyFocus(manual);
    const update = (focus) => {
      if (!this.destroyed && this.artSrc === img && !isFocus(this.model.actor?.focus)) this.applyFocus(focus);
    };
    this.unwatchArt = this.framer?.watch?.(img, update) ?? null;
    const known = this.framer?.peek(img);
    if (known !== undefined) return this.applyFocus(known);
    this.applyFocus(null);
    this.framer?.request(img).then(update);
  }

  applyFocus(focus) {
    const frame = this.q(".glus-sc-art-frame");
    const art = this.q(".glus-sc-art");
    if (!isFocus(focus)) {
      frame.removeAttribute("data-framed");
      return;
    }
    const { scale, left, top } = placement(squareFocus(focus));
    art.style.setProperty("--glus-sc-art-scale", scale);
    art.style.setProperty("--glus-sc-art-left", left);
    art.style.setProperty("--glus-sc-art-top", top);
    frame.setAttribute("data-framed", "");
  }

  /** Entrance: the hairline draws, the strip unfolds downwards, then each chip lands in turn. */
  async enter() {
    const u = this.unit();
    tween(this.element, { opacity: [0, 1], translateX: [-0.8 * u, 0], duration: 380, ease: EASE_OUT });
    tween(this.q(".glus-sc-hair"), { scaleX: [0, 1], duration: 300, ease: EASE_SNAP });
    tween(this.q(".glus-sc-art-frame"), { opacity: [0, 1], scale: [1.18, 1], duration: 520, delay: 60, ease: EASE_OUT });
    tween(this.q(".glus-sc-name"), { opacity: [0, 1], translateX: [-0.4 * u, 0], duration: 320, delay: 80, ease: EASE_OUT });
    await waapi(
      this.strip,
      [
        { clipPath: "inset(0 0 100% 0)", transform: `translateY(${-0.6 * u}px)` },
        { clipPath: "inset(0 0 0% 0)", transform: "none" }
      ],
      { duration: 340, easing: CSS_SNAP }
    );
    if (this.destroyed) return;
    this.strip.getAnimations?.().forEach((a) => a.cancel());
    this.strip.style.clipPath = "";
    [...this.element.querySelectorAll(".glus-sc-chip")].forEach((chip, index) => this.popChip(chip, index * 80));
  }

  /**
   * Another change to the same creature, folded into this card.
   *
   * The whole chip row is rebuilt because folding can *remove* a row — a condition that arrived and
   * ended inside one card's life — and only the chips that are actually new are animated, so a row
   * already on screen does not flinch every time its neighbour changes.
   */
  addChanges(changes) {
    if (this.destroyed) return;
    const before = new Set([...this.element.querySelectorAll(".glus-sc-chip")].map(chipKey));
    this.render({ ...this.model, changes });
    let index = 0;
    for (const chip of this.element.querySelectorAll(".glus-sc-chip")) {
      if (before.has(chipKey(chip))) continue;
      this.popChip(chip, index++ * 60);
    }
  }

  popChip(chip, delay = 0) {
    tween(chip, {
      opacity: [0, 1],
      translateY: [0.5 * this.unit(), 0],
      scale: [{ from: 0.86, to: 1.06, duration: 200 }, { to: 1, duration: 160 }],
      delay,
      ease: EASE_POP
    });
  }

  /** Slides out and collapses its height so the stack closes up. Resolves once it is gone. */
  async exit() {
    const root = this.element;
    if (!root.isConnected) return this.destroy();
    const u = this.unit();
    await tween(root, { opacity: [1, 0], translateX: [0, -1.4 * u], duration: 260, ease: EASE_EXIT });
    const height = root.getBoundingClientRect().height;
    root.style.overflow = "hidden";
    await tween(root, { height: [`${height}px`, "0px"], duration: 220, ease: EASE_OUT });
    this.destroy();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unwatchArt?.();
    try {
      remove(this.element.querySelectorAll("*"));
      remove(this.element);
    } catch (_error) {
      // Nothing was animating.
    }
    this.element.remove();
  }
}

/** A chip's identity for the entrance diff: what it is about, not what it says. */
function chipKey(chip) {
  return `${chip.dataset.kind}|${chip.dataset.slug ?? chip.querySelector(".glus-sc-chip-name")?.textContent ?? ""}`;
}
