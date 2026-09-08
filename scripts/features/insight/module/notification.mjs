// module/notification.mjs — Notification renderer and animation lifecycle

import { SUITE_ID, featurePath } from "../../../core/const.mjs";
import { animate, createTimeline, stagger, motionDuration, createMotionOwner } from "../../../core/motion.mjs";
import { applyTheme } from "./themes.mjs";
import { playSound, playCustomSound } from "./sound.mjs";

const notificationDisposers = new WeakMap();

/** Dispose a replaced host immediately and release its queue slot exactly once. */
export function disposeNotification(el) { notificationDisposers.get(el)?.(); }

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

  // One clock owns the ceremony and its audio cues. Pausing it on dismissal
  // prevents a late reveal (or sound) from racing the exit.
  el.classList.add("insight-anime");
  const owner = createMotionOwner();
  const duration = ms => speed === "instant" ? 0 : motionDuration(ms, el);
  const position = ms => speed === "instant" ? 0 : motionDuration(ms, el);
  let ambient = null;
  let dismissed = false;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    owner.clear();
    notificationDisposers.delete(el);
    el.remove();
    onDismiss?.();
  };
  notificationDisposers.set(el, finish);
  const reveal = owner.add(createTimeline({ autoplay: false, onComplete: () => {
    if (duration(2600) > 0 && !dismissed && !finished) ambient = owner.add(animate(edge, {
      opacity: [1, .78], duration: duration(2600), alternate: true, loop: true, ease: "inOutSine",
    }));
  } }));
  reveal.call(() => {
    edge.classList.add("insight-visible");
    if (customSound) playCustomSound(customSound);
    else playSound("impact", data.theme);
  }, 0);
  reveal.add(edge, { opacity: [0, 1], duration: duration(320), ease: "outCubic" }, 0);
  reveal.call(() => {
    notification.classList.add("insight-visible");
    line.classList.add("insight-visible");
    if (!customSound) playSound("line", data.theme);
  }, position(timing.line));
  reveal.add(notification, {
    opacity: [0, 1],
    transform: ["translate(-50%, -50%) translateY(16px) scale(.965)", "translate(-50%, -50%) translateY(0px) scale(1)"],
    duration: duration(500), ease: "outCubic",
  }, position(timing.line));
  reveal.add(line, { scaleX: [0, 1], duration: duration(480), ease: "outExpo" }, position(timing.line));
  reveal.call(() => {
    card.classList.add("insight-visible");
    bgBack.classList.add("insight-glitch");
    if (!customSound) playSound("reveal", data.theme);
  }, position(timing.card));
  reveal.add(card, { opacity: [0, 1], clipPath: ["inset(50% 0 50% 0)", "inset(0% 0 0% 0)"], duration: duration(620), ease: "outExpo", onComplete: () => card.style.removeProperty("clip-path") }, position(timing.card));
  reveal.add(contentEls, { opacity: [0, 1], translate: ["0 9px", "0 0px"], duration: duration(420), delay: stagger(position(timing.contentStagger)), ease: "outCubic" }, position(timing.contentStart));

  const dismissBtn = el.querySelector(".insight-dismiss");
  dismissBtn.addEventListener("click", () => {
    if (dismissed) return;
    dismissed = true;
    dismissBtn.disabled = true;
    reveal.pause();
    ambient?.pause();
    // Keep current interpolated values for an uninterrupted early dismissal.
    const exit = owner.add(createTimeline({ autoplay: false, onComplete: finish }));
    exit.add(notification, { opacity: 0, transform: [notification.style.transform || "translate(-50%, -50%) translateY(0px) scale(1)", "translate(-50%, -50%) translateY(-18px) scale(1)"], duration: duration(320), ease: "inCubic" }, 0);
    exit.add(edge, { opacity: 0, duration: duration(560), ease: "inOutCubic" }, 0);
    exit.play();
  });
  reveal.play();
  return el;
}
