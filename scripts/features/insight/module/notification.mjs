// module/notification.mjs — the arrival.
//
// One anime.js timeline owns every beat and the three sound cues, so a beat is
// either on that clock or it does not happen; CSS holds only resting states.
// Nothing here reads a stylesheet keyframe, which is what used to let a renamed
// class drop a beat on somebody else's screen with nothing reported.
//
// The order is the point. The SCREEN EDGE lands first and alone: a player
// looking at their sheet, or at the far side of the map, gets the alert in the
// corner of their eye a beat before anything asks to be read. Then the cut
// draws, the card opens down out of it, and the words arrive in reading order.

import { SUITE_ID, featurePath } from "../../../core/const.mjs";
import { animate, createTimeline, stagger, motionDuration, createMotionOwner } from "../../../core/motion.mjs";
import { applyTheme } from "./themes.mjs";
import { playSound, playCustomSound } from "./sound.mjs";

const notificationDisposers = new WeakMap();

/** Dispose a stage at once and release its queue slot exactly once. */
export function disposeNotification(el) { notificationDisposers.get(el)?.(); }

/**
 * When each beat starts (ms from arrival, before the motion tier).
 * Exported so tools/insight-preview.mjs prints the shipped clock, never its own.
 */
export const TIMINGS = Object.freeze({
  normal: Object.freeze({ edge: 0, line: 200, card: 380, contentStart: 560, contentStagger: 70 }),
  fast: Object.freeze({ edge: 0, line: 100, card: 190, contentStart: 280, contentStagger: 35 }),
  instant: Object.freeze({ edge: 0, line: 0, card: 0, contentStart: 0, contentStagger: 0 }),
});

/** How long each beat runs (ms, before the motion tier). */
export const DURATIONS = Object.freeze({
  glow: 420, veil: 700, rim: 320, cut: 380, open: 540, sweep: 820, content: 380,
  breathe: 2400, exitCard: 260, exitCut: 220, exitEdge: 480,
});

/** The speed setting scales the suite's motion tier; instant skips it. */
const SPEED_SCALE = Object.freeze({ normal: 1, fast: 0.5, instant: 0 });

/** Client setting → the class that scales the edge light. */
export const INTENSITY_CLASS = Object.freeze({
  full: null,
  subtle: "insight-intensity-subtle",
  off: "insight-intensity-off",
});

/** Content, in the order it arrives: the order it is read. */
export const CONTENT_ORDER = Object.freeze([
  ".insight-tag",
  ".insight-private",
  ".insight-title",
  ".insight-image",
  ".insight-body",
  ".insight-foot",
]);

/**
 * Read a client setting, tolerating one that is not registered (a world
 * upgraded from a build before it existed still has to render).
 */
function setting(key, fallback) {
  try {
    const value = game.settings.get(SUITE_ID, key);
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function localize(key, data) {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
}

/**
 * Show how many cards are waiting behind this one. The count is written, never
 * animated, so a burst of sends cannot stack motion on the card being read.
 * @param {HTMLElement} el - the stage
 * @param {number} count
 */
export function setPending(el, count) {
  const slot = el?.querySelector?.(".insight-queue");
  if (!slot) return;
  const n = Math.max(0, Number(count) || 0);
  slot.hidden = n === 0;
  slot.textContent = n ? localize("INSIGHT.Queued", { count: n }) : "";
}

/**
 * Render a notification: the screen edge, the cut, the card.
 * @param {object} data - card data (module/socket.mjs `cardData`) plus `pending`
 * @param {Function} [onDismiss] - called once, when the stage is gone
 * @returns {Promise<HTMLElement>} the stage
 */
export async function renderNotification(data, onDismiss) {
  const templatePath = featurePath("insight", "templates/notification.hbs");
  const html = await foundry.applications.handlebars.renderTemplate(templatePath, data);

  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  const el = wrapper.firstElementChild;

  const speed = Object.hasOwn(SPEED_SCALE, setting("insight.animationSpeed", "normal"))
    ? setting("insight.animationSpeed", "normal") : "normal";
  const intensityClass = INTENSITY_CLASS[setting("insight.edgeIntensity", "full")];
  if (intensityClass) el.classList.add(intensityClass);
  applyTheme(el, data.theme);
  setPending(el, data.pending);

  document.body.appendChild(el);

  const timing = TIMINGS[speed];
  const scale = SPEED_SCALE[speed];
  // Durations follow the speed setting; positions are already per tier (TIMINGS).
  const ms = (n) => (scale === 0 ? 0 : motionDuration(n * scale, el));
  const at = (n) => (scale === 0 ? 0 : motionDuration(n, el));

  const edge = el.querySelector(".insight-edge");
  const veil = el.querySelector(".insight-edge-veil");
  const glow = el.querySelector(".insight-edge-glow");
  const rim = el.querySelector(".insight-edge-rim");
  const notification = el.querySelector(".insight-notification");
  const cut = el.querySelector(".insight-cut");
  const card = el.querySelector(".insight-card");
  const sweep = el.querySelector(".insight-sweep");
  const content = CONTENT_ORDER.map((s) => el.querySelector(s)).filter(Boolean);
  const dismissBtn = el.querySelector(".insight-dismiss");

  const customSound = setting("insight.soundFile", "");
  const cue = (stage) => {
    if (customSound) { if (stage === "impact") playCustomSound(customSound); }
    else playSound(stage, data.theme);
  };

  // One owner for every animation, so a dismissal or a dispose reverts them all.
  const owner = createMotionOwner();
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
    if (dismissed || finished) return;
    el.classList.add("insight-settled");
    // Take the keyboard only when nobody else has it: a player typing in chat
    // keeps their caret, and anyone else can answer with Enter or Space. No
    // ring for a focus nobody asked for; Tab still draws one.
    const active = document.activeElement;
    if (!active || active === document.body) dismissBtn?.focus?.({ preventScroll: true, focusVisible: false });
    const breathe = ms(DURATIONS.breathe);
    if (breathe > 0) ambient = owner.add(animate(glow, {
      opacity: [1, 0.72], duration: breathe, alternate: true, loop: true, ease: "inOutSine",
    }));
  } }));

  // 1 · the edge
  reveal.call(() => cue("impact"), at(timing.edge));
  reveal.add(edge, { opacity: [0, 1], duration: ms(DURATIONS.rim), ease: "outCubic" }, at(timing.edge));
  reveal.add(glow, { opacity: [0, 1], duration: ms(DURATIONS.glow), ease: "outExpo" }, at(timing.edge));
  reveal.add(veil, { opacity: [0, 1], duration: ms(DURATIONS.veil), ease: "outCubic" }, at(timing.edge));
  reveal.add(rim, { opacity: [0, 1], duration: ms(DURATIONS.rim), ease: "outCubic" }, at(timing.edge));

  // 2 · the cut
  reveal.call(() => cue("line"), at(timing.line));
  reveal.add(notification, { opacity: [0, 1], duration: ms(DURATIONS.rim), ease: "outCubic" }, at(timing.line));
  reveal.add(cut, { opacity: [0, 1], scaleX: [0, 1], duration: ms(DURATIONS.cut), ease: "outExpo" }, at(timing.line));

  // 3 · the card opens down out of the cut, and one light crosses it
  reveal.call(() => cue("reveal"), at(timing.card));
  reveal.add(card, {
    opacity: [0, 1], "--insight-open": [0, 1], translateY: [-6, 0],
    duration: ms(DURATIONS.open), ease: "outExpo",
  }, at(timing.card));
  reveal.add(sweep, { opacity: [0, 1, 0], translateX: ["-120%", "460%"], duration: ms(DURATIONS.sweep), ease: "inOutSine" }, at(timing.card));

  // 4 · the words, in reading order
  reveal.add(content, {
    opacity: [0, 1], translateY: [6, 0],
    duration: ms(DURATIONS.content), delay: stagger(at(timing.contentStagger)), ease: "outCubic",
  }, at(timing.contentStart));

  dismissBtn?.addEventListener("click", () => {
    if (dismissed || finished) return;
    dismissed = true;
    dismissBtn.disabled = true;
    el.classList.add("insight-leaving");
    reveal.pause();
    ambient?.pause();
    // From wherever the arrival is: an early acknowledgement leaves from the
    // values on screen, not from the settled ones.
    const exit = owner.add(createTimeline({ autoplay: false, onComplete: finish }));
    exit.add(notification, { opacity: 0, translateY: -10, duration: ms(DURATIONS.exitCard), ease: "inCubic" }, 0);
    exit.add(cut, { scaleX: 0, duration: ms(DURATIONS.exitCut), ease: "inCubic" }, 0);
    exit.add(edge, { opacity: 0, duration: ms(DURATIONS.exitEdge), ease: "inOutCubic" }, 0);
    exit.play();
  });

  reveal.play();
  return el;
}
