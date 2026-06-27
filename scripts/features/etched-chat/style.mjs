/**
 * GLUniverse Suite — Etched-Glass Chat Theme: DOM styling handler.
 *
 * The `renderChatMessageHTML` (+ legacy `renderChatMessage`) handler. It is the
 * SOLE classifier: it stamps the marker, mounts the diorama portrait layer (with
 * per-actor framing), the natural-d20 chip on check cards, and the fracture
 * canvas (animated when the message id is in `freshIds`, otherwise the static
 * cracked still). Idempotent on re-render. See research.md §A.
 */

import { classifyMessage } from "./classify.mjs";
import { fxRenderer } from "./fx-card.mjs";
import { freshIds } from "./module.mjs";
import { getFrame, applyFrame } from "./frame.mjs";

/** Categories whose dice-total shows the natural-d20 chip (d20 checks only). */
const D20_CHIP_CATEGORIES = new Set(["check", "save", "action"]);

/** Normalize the v13 HTMLElement / legacy jQuery handler arg to an element. */
function rootOf(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  if (html?.element instanceof HTMLElement) return html.element;
  return null;
}

/** Resolve the speaker actor document for a message (or null). */
function resolveActor(message) {
  try {
    if (message?.actor) return message.actor;
    const actorId = message?.speaker?.actor;
    if (actorId && game.actors) return game.actors.get(actorId) ?? null;
  } catch {
    /* defensive */
  }
  return null;
}

/** Resolve a portrait image URL for the diorama bleed, or null. */
function resolvePortrait(message, actor, root) {
  try {
    const tokenImg = message?.token?.texture?.src;
    const img = tokenImg || actor?.prototypeToken?.texture?.src || actor?.img;
    if (img) return img;
  } catch {
    /* defensive */
  }
  const domImg = root?.querySelector(".message-header img, header img");
  return domImg?.getAttribute("src") || null;
}

/** Ensure the diorama portrait layer (an <img> we can object-position + zoom). */
function mountPortrait(root, src, frame) {
  let layer = root.querySelector(":scope > .glec-portrait");
  if (!src || !frame.enabled) {
    layer?.remove();
    root.classList.remove("glec-has-art");
    return;
  }
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "glec-portrait";
    layer.setAttribute("aria-hidden", "true");
    const img = document.createElement("img");
    img.alt = "";
    layer.appendChild(img);
    root.insertBefore(layer, root.firstChild);
  }
  layer.style.opacity = "";
  const img = layer.querySelector("img");
  if (img.getAttribute("src") !== src) img.setAttribute("src", src);
  applyFrame(layer, frame);
  root.classList.add("glec-has-art");
}

/** Prepend the natural-d20 face chip to a check card's dice-total (or remove). */
function mountD20Chip(message, root, category) {
  const total = root.querySelector(".dice-total");
  if (!total) return;
  const drop = () => total.querySelector(":scope > .glec-d20")?.remove();
  if (!D20_CHIP_CATEGORIES.has(category)) return drop();
  const roll = message.rolls?.[0];
  const d20 = roll?.dice?.find((d) => Number(d.faces) === 20);
  if (!d20) return drop();
  const res = d20.results?.find((r) => r.active && !r.discarded) ?? d20.results?.[0];
  const face = Number(res?.result);
  if (!Number.isFinite(face)) return drop();
  let chip = total.querySelector(":scope > .glec-d20");
  if (!chip) {
    chip = document.createElement("span");
    chip.className = "glec-d20";
    chip.setAttribute("aria-hidden", "true");
    total.insertBefore(chip, total.firstChild);
  }
  chip.textContent = String(face);
  chip.classList.toggle("glec-nat-max", face === 20);
  chip.classList.toggle("glec-nat-min", face === 1);
}

/** Ensure / update the fracture FX over the card for a fractured tier. */
function mountFracture(message, root, color) {
  if (!fxRenderer.ensureRenderer()) {
    root.querySelector(":scope > canvas.glec-fx")?.remove();
    root.classList.add("glec-crack-css");
    return;
  }
  root.classList.remove("glec-crack-css");
  let canvas = root.querySelector(":scope > canvas.glec-fx");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.className = "glec-fx";
    canvas.setAttribute("aria-hidden", "true");
    root.appendChild(canvas);
  }
  if (canvas.dataset.glecPainted) return; // never replay; static still stays
  if (freshIds.has(message.id)) {
    freshIds.delete(message.id);
    canvas.dataset.glecPainted = "anim";
    fxRenderer.mountAnimated(canvas, { color });
  } else {
    canvas.dataset.glecPainted = "static";
    fxRenderer.mountStatic(canvas, { color });
  }
}

/** Visibility badge metadata: FA icon + i18n key (with English fallback). */
const VIS_BADGE = {
  public: { icon: "fa-eye", key: "GLEC.vis.public", fallback: "Public" },
  gm: { icon: "fa-user-secret", key: "GLEC.vis.gm", fallback: "GM" },
  blind: { icon: "fa-eye-slash", key: "GLEC.vis.blind", fallback: "Blind GM" },
  self: { icon: "fa-user", key: "GLEC.vis.self", fallback: "Self" },
  private: { icon: "fa-lock", key: "GLEC.vis.private", fallback: "Private" },
};

/** Stamp a small visibility pill into the header metadata (idempotent). */
function mountVisBadge(root, visibility) {
  const meta = VIS_BADGE[visibility] ?? VIS_BADGE.public;
  const header = root.querySelector(":scope > .message-header, :scope > header");
  if (!header) return;
  let badge = header.querySelector(":scope .glec-vis");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "glec-vis";
    const slot = header.querySelector(".message-metadata");
    if (slot) slot.insertBefore(badge, slot.firstChild);
    else header.appendChild(badge);
  }
  const label = game.i18n?.localize?.(meta.key);
  const text = label && label !== meta.key ? label : meta.fallback;
  badge.innerHTML = `<i class="fa-solid ${meta.icon}" aria-hidden="true"></i><span>${text}</span>`;
  badge.dataset.glecVis = visibility;
}

/**
 * renderChatMessageHTML / renderChatMessage handler.
 * @param {ChatMessage} message
 * @param {HTMLElement|JQuery} html
 */
export function applyStyle(message, html) {
  if (game.system?.id !== "pf2e") return;
  const root = rootOf(html);
  if (!root) return;

  const { tier, fracture, category, visibility } = classifyMessage(message);

  root.classList.add("glec-card");
  root.dataset.glecTier = tier;
  root.dataset.glecCategory = category;
  root.dataset.glecVis = visibility ?? "public";
  if (fracture) root.dataset.glecFrac = fracture;
  else delete root.dataset.glecFrac;

  const actor = resolveActor(message);
  const src = resolvePortrait(message, actor, root);
  mountPortrait(root, src, getFrame(actor));
  mountD20Chip(message, root, category);
  mountVisBadge(root, visibility ?? "public");

  if (tier === "fracture-gold" || tier === "fracture-red") {
    mountFracture(message, root, fracture);
  } else {
    root.querySelector(":scope > canvas.glec-fx")?.remove();
    root.classList.remove("glec-crack-css");
  }
}
