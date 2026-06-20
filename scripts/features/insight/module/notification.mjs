// module/notification.mjs — Notification renderer and animation lifecycle

import { SUITE_ID, featurePath } from "../../../core/const.mjs";
import { applyTheme } from "./themes.mjs";
import { playSound, playCustomSound } from "./sound.mjs";

/**
 * Timing presets for animation stages (milliseconds).
 * Each value is the delay from the start of the animation.
 */
const TIMINGS = {
  normal: {
    line: 100,
    card: 600,
    contentStart: 900,
    contentStagger: 150,
    dismissDelay: 400,
  },
  fast: {
    line: 50,
    card: 300,
    contentStart: 450,
    contentStagger: 80,
    dismissDelay: 200,
  },
  instant: {
    line: 0,
    card: 0,
    contentStart: 0,
    contentStagger: 0,
    dismissDelay: 0,
  },
};

/**
 * Render a notification to the screen with three-stage animation.
 * @param {object} data - Notification payload
 * @param {string} data.id - Unique notification ID
 * @param {string} data.title - Notification title
 * @param {string} data.body - HTML body content
 * @param {string} [data.sense] - Sense label (e.g., "Perception")
 * @param {string} [data.image] - Optional image URL
 * @param {string} [data.theme] - Optional theme override
 * @param {Function} onDismiss - Called when the notification is dismissed
 * @returns {HTMLElement} The notification container element
 */
export async function renderNotification(data, onDismiss) {
  // Derive an Etched-Glass serial designator (§4.2) from the notification id.
  const serial = String(data.id ?? "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(-4)
    .toUpperCase()
    .padStart(4, "0");

  // Load and render template (v13+ namespaced; global renderTemplate is deprecated in v14)
  const templatePath = featurePath("insight", "templates/notification.hbs");
  const html = await foundry.applications.handlebars.renderTemplate(templatePath, { ...data, serial });

  // Create container and insert into DOM
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  const el = wrapper.firstElementChild;

  // Apply animation speed class
  const speed = game.settings.get(SUITE_ID, "insight.animationSpeed");
  if (speed !== "normal") el.classList.add(`insight-speed-${speed}`);

  // Apply theme CSS variables
  applyTheme(el, data.theme);

  // Insert into document body
  document.body.appendChild(el);

  // Get timing preset
  const timing = TIMINGS[speed] ?? TIMINGS.normal;

  // Cache element references
  const line = el.querySelector(".insight-fracture-line");
  const card = el.querySelector(".insight-fracture-card");
  const bgBack = el.querySelector(".insight-fracture-bg-back");
  // Cascade stagger order (§6.2) — each element lights as the sheen crosses it.
  const contentEls = [
    el.querySelector(".insight-icon"),
    el.querySelector(".insight-sense"),
    el.querySelector(".insight-serial"),
    el.querySelector(".insight-title"),
    el.querySelector(".insight-divider"),
    el.querySelector(".insight-image"),
    el.querySelector(".insight-body"),
    el.querySelector(".insight-datastrip"),
    el.querySelector(".insight-dismiss"),
  ].filter(Boolean);

  // Check for custom sound file in settings
  const customSound = game.settings.get(SUITE_ID, "insight.soundFile");

  // Stage 1: Line slides in + container becomes visible
  setTimeout(() => {
    el.classList.add("insight-visible");
    line.classList.add("insight-visible");
    if (customSound) {
      playCustomSound(customSound);
    } else {
      playSound("line", data.theme);
    }
  }, timing.line);

  // Stage 2: Card expands + back panel begins glitch
  setTimeout(() => {
    card.classList.add("insight-visible");
    bgBack.classList.add("insight-glitch");
    if (!customSound) playSound("reveal", data.theme);
  }, timing.card);

  // Stage 3: Content fades in with stagger
  contentEls.forEach((contentEl, i) => {
    setTimeout(() => {
      contentEl.classList.add("insight-fade-in");
    }, timing.contentStart + (i * timing.contentStagger));
  });

  // Dismiss handler
  const dismissBtn = el.querySelector(".insight-dismiss");
  dismissBtn.addEventListener("click", () => {
    dismissNotification(el, onDismiss);
  });

  return el;
}

/**
 * Dismiss a notification with exit animation, then remove from DOM.
 * @param {HTMLElement} el - The notification element
 * @param {Function} onDismiss - Callback after removal
 */
function dismissNotification(el, onDismiss) {
  el.classList.add("insight-dismissing");
  el.addEventListener("transitionend", () => {
    el.remove();
    onDismiss?.();
  }, { once: true });

  // Safety fallback — remove after 600ms if transitionend doesn't fire
  setTimeout(() => {
    if (el.parentNode) {
      el.remove();
      onDismiss?.();
    }
  }, 600);
}
