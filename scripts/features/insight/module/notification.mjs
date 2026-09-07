// module/notification.mjs — Notification renderer and animation lifecycle

import { SUITE_ID, featurePath } from "../../../core/const.mjs";
import { applyTheme } from "./themes.mjs";
import { playSound, playCustomSound } from "./sound.mjs";

/**
 * Timing presets for animation stages (milliseconds), as delays from the start.
 *
 * The order is the point: the SCREEN EDGE lands first and alone. A player
 * looking at their own sheet, or at the far side of the canvas, gets the
 * alert in their peripheral vision a beat before anything asks to be read.
 * Only then does the cut open and the card unfold into it.
 */
const TIMINGS = {
  normal: {
    edge: 0,
    line: 280,
    card: 760,
    contentStart: 1060,
    contentStagger: 110,
  },
  fast: {
    edge: 0,
    line: 140,
    card: 380,
    contentStart: 530,
    contentStagger: 60,
  },
  instant: {
    edge: 0,
    line: 0,
    card: 0,
    contentStart: 0,
    contentStagger: 0,
  },
};

/** Client setting → the class that scales the edge light. */
const INTENSITY_CLASS = {
  full: null,
  subtle: "insight-intensity-subtle",
  off: "insight-intensity-off",
};

/**
 * Read a setting that may not be registered yet (a world upgraded from a
 * build before the setting existed still has to render).
 * @param {string} key
 * @param {*} fallback
 */
function setting(key, fallback) {
  try {
    const value = game.settings.get(SUITE_ID, key);
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

/**
 * Render a notification to the screen: screen-edge alert, then the card.
 * @param {object} data - Notification payload
 * @param {string} data.id - Unique notification ID
 * @param {string} data.title - Notification title
 * @param {string} data.body - HTML body content
 * @param {string} [data.sense] - Sense label (e.g., "Perception")
 * @param {string} [data.image] - Optional image URL
 * @param {string} [data.theme] - Optional accent preset override
 * @param {Function} onDismiss - Called when the notification is dismissed
 * @returns {HTMLElement} The stage element
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
  const speed = setting("insight.animationSpeed", "normal");
  if (speed !== "normal") el.classList.add(`insight-speed-${speed}`);

  // Apply edge intensity class
  const intensityClass = INTENSITY_CLASS[setting("insight.edgeIntensity", "full")];
  if (intensityClass) el.classList.add(intensityClass);

  // Apply preset CSS custom properties (accent channel + body voice)
  applyTheme(el, data.theme);

  // Insert into document body
  document.body.appendChild(el);

  // Get timing preset
  const timing = TIMINGS[speed] ?? TIMINGS.normal;

  // Cache element references
  const edge = el.querySelector(".insight-edge");
  const notification = el.querySelector(".insight-notification");
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
  const customSound = setting("insight.soundFile", "");

  const timers = [];
  const at = (delay, fn) => timers.push(setTimeout(fn, delay));

  // Stage 0: the screen edge takes the light. This is the alert.
  at(timing.edge, () => {
    edge.classList.add("insight-visible");
    if (customSound) playCustomSound(customSound);
    else playSound("impact", data.theme);
  });

  // Stage 1: the cut opens across the view
  at(timing.line, () => {
    notification.classList.add("insight-visible");
    line.classList.add("insight-visible");
    if (!customSound) playSound("line", data.theme);
  });

  // Stage 2: Card expands + back panel begins its drift
  at(timing.card, () => {
    card.classList.add("insight-visible");
    bgBack.classList.add("insight-glitch");
    if (!customSound) playSound("reveal", data.theme);
  });

  // Stage 3: Content fades in with stagger
  contentEls.forEach((contentEl, i) => {
    at(timing.contentStart + (i * timing.contentStagger), () => {
      contentEl.classList.add("insight-fade-in");
    });
  });

  // Dismiss handler
  const dismissBtn = el.querySelector(".insight-dismiss");
  dismissBtn.addEventListener("click", () => {
    for (const t of timers) clearTimeout(t);
    dismissNotification(el, onDismiss);
  });

  return el;
}

/**
 * Dismiss a notification with exit animation, then remove from DOM.
 * @param {HTMLElement} el - The stage element
 * @param {Function} onDismiss - Callback after removal
 */
function dismissNotification(el, onDismiss) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.remove();
    onDismiss?.();
  };

  el.classList.add("insight-dismissing");
  // The card and the edge fade on different curves; wait for the last one.
  el.querySelector(".insight-edge")?.addEventListener("transitionend", finish, { once: true });

  // Safety fallback — the edge may be display:none under the "off" intensity,
  // in which case no transition ever fires.
  setTimeout(finish, 900);
}
