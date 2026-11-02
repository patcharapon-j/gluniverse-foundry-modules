/**
 * The PF2e status card: what just happened to a creature that was not a roll.
 *
 * Deliberately the *damage row's* size rather than the roll card's. A condition is a consequence, and
 * on a stream a consequence that arrives at the same weight as the roll that caused it reads as a
 * second roll. It sits in the same stack, under the same lifetime, with the same fading top rule and the
 * same chamfered plate and framed art (struck square here), so it is plainly the same feature speaking
 * more quietly.
 *
 * A chip names its direction with a mark and, for a value, the value itself. The direction word is
 * printed only for a status that ended: "gained", "raised" and "eased" restate the mark, and the room
 * they took is what pushed a two-chip card's second chip off its edge.
 *
 * It renders a StatusCardModel (see `pf2e/read-status.js`) and owns its motion. It never reads Foundry
 * documents; the reader builds the model.
 *
 * Contract with the chat overlay: `element`, `exit()` and `destroy()`, the same three the roll card
 * offers, because the overlay owns the stack and removes both kinds the same way.
 */

import { remove } from "../../stream/motion/engine.js";
import { isFocus, placement, squareFocus } from "../framing/focus-math.js";
import {
  CSS_UNFOLD,
  EASE_EXIT,
  EASE_OUT,
  EASE_POP,
  EASE_SNAP,
  PLATE_CLIP,
  PLATE_CLIP_FOLDED,
  collapse,
  el,
  sideOf,
  timing,
  tween,
  waapi
} from "./card-motion.js";
import { statusTone } from "../pf2e/read-status.js";

const DEFAULT_LABELS = {
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

/**
 * The strip's resting shape (`.glus-sc-strip` in stream-cards.css): the roll card's chamfered plate.
 * The unfold starts on the folded copy and ends on this one, so the strip never changes shape as it lands.
 */
const STRIP_CLIP = PLATE_CLIP;
const STRIP_CLIP_FOLDED = PLATE_CLIP_FOLDED;

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
    if (change.direction === "lost") chip.append(el("span", "glus-sc-chip-state", this.label("Lost")));
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

  /** Entrance: the top rule draws, the strip unfolds downwards, then each chip lands in turn. */
  async enter() {
    const u = this.unit();
    const d = timing(this.element);
    const side = sideOf(this.element);
    tween(this.element, { opacity: [0, 1], translateX: [side * 0.8 * u, 0], duration: d("statusIn"), ease: EASE_OUT });
    tween(this.q(".glus-sc-hair"), { scaleX: [0, 1], duration: d("statusRuleIn"), ease: EASE_SNAP });
    tween(this.q(".glus-sc-art-frame"), { opacity: [0, 1], scale: [1.12, 1], duration: d("statusArtIn"), delay: d("statusArtDelay"), ease: EASE_OUT });
    tween(this.q(".glus-sc-name"), { opacity: [0, 1], translateX: [-0.3 * u, 0], duration: d("statusNameIn"), delay: d("statusNameDelay"), ease: EASE_OUT });
    await waapi(
      this.strip,
      [
        { clipPath: STRIP_CLIP_FOLDED, transform: `translateY(${-0.5 * u}px)` },
        { clipPath: STRIP_CLIP, transform: "none" }
      ],
      { duration: d("statusUnfold"), easing: CSS_UNFOLD }
    );
    if (this.destroyed) return;
    this.strip.getAnimations?.().forEach((a) => a.cancel());
    this.strip.style.clipPath = "";
    const stagger = d("statusChipStagger");
    [...this.element.querySelectorAll(".glus-sc-chip")].forEach((chip, index) => this.popChip(chip, index * stagger, d));
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
    const d = timing(this.element);
    const stagger = d("statusFoldStagger");
    let index = 0;
    for (const chip of this.element.querySelectorAll(".glus-sc-chip")) {
      if (before.has(chipKey(chip))) continue;
      this.popChip(chip, index++ * stagger, d);
    }
  }

  popChip(chip, delay = 0, d = timing(this.element)) {
    tween(chip, {
      opacity: [0, 1],
      translateY: [0.4 * this.unit(), 0],
      scale: [{ from: 0.9, to: 1.04, duration: d("statusChipUp") }, { to: 1, duration: d("statusChipDown") }],
      delay,
      ease: EASE_POP
    });
  }

  /** Slides out toward the stack's edge and closes the gap it leaves. Resolves once it is gone. */
  async exit() {
    const root = this.element;
    if (!root.isConnected) return this.destroy();
    const u = this.unit();
    const d = timing(root);
    await tween(root, { opacity: [1, 0], translateX: [0, sideOf(root) * 1.2 * u], duration: d("statusExitSlide"), ease: EASE_EXIT });
    await collapse(root, d("statusExitCollapse"));
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
