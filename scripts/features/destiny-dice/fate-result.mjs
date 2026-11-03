/**
 * The fate strip in the chat log: drawn on every render, played once.
 *
 * Rendering is independent of rolling. The die has landed before the flag is
 * written, so every client draws the strip from the flag alone, and a reload, a
 * scroll or an edit draws the same strip settled.
 *
 * The arrival plays only for a fate young enough to be news (TIMING.revealWindow)
 * and only once per fate per client. Its durations are the suite's motion scale
 * times this feature's own Animation Style. That tier used to be written onto
 * <body> as the suite-wide `--gl-motion-scale`, which retimed every feature in
 * the suite whenever a player picked Cinematic for their dice, and then this
 * file multiplied it in a second time. It is local now.
 */

import { createMotionOwner, createTimeline, motionDuration, stagger } from "../../core/motion.mjs";
import { MOTION_SCALE } from "../../core/theme.mjs";
import { FLAGS, MODULE_ID, REVEAL, TIMING } from "./constants.mjs";
import { normalizeFate } from "./fate.mjs";
import { fateModel, renderFateStrip } from "./view.mjs";
import { activePreset, motionTier, t } from "./settings.mjs";

const revealed = new Map();
const owners = new WeakMap();
const now = () => globalThis.game?.time?.serverTime ?? Date.now();

export function registerFateRendering() {
  Hooks.on("renderChatMessageHTML", attachFateStrip);
}

/** Whether this viewer may see the check's degree: PF2e's own rule for its card. */
function seesOutcome() {
  const g = globalThis.game;
  return !!g?.user?.isGM || g?.pf2e?.settings?.metagame?.results !== false;
}

function attachFateStrip(message, html) {
  const root = html instanceof HTMLElement ? html : html?.[0] ?? null;
  const content = root?.querySelector?.(".message-content");
  if (!content) return;

  content.querySelectorAll(".glddf-fate-strip, .glddf-fate-result").forEach((node) => {
    owners.get(node)?.clear();
    node.remove();
  });

  // A blind or whispered check this viewer may not read gets no strip either:
  // the face and its bonus would tell them what the card hides.
  if (message?.isContentVisible === false) return;
  const fate = normalizeFate(message?.getFlag?.(MODULE_ID, FLAGS.fate));
  if (!fate) return;

  content.insertAdjacentHTML("beforeend", renderFateStrip(fateModel(fate, { preset: activePreset(), t, seesOutcome: seesOutcome() })));
  const strip = content.querySelector(".glddf-fate-strip");
  if (!strip || !isNews(message, fate)) return;
  reveal(strip);
}

function isNews(message, fate) {
  const at = fate.appliedAt;
  const age = now() - at;
  if (!Number.isFinite(at) || age < -TIMING.revealWindow || age >= TIMING.revealWindow || fate.accepted === false) return false;
  const stamp = now();
  for (const [key, expires] of revealed) if (expires <= stamp) revealed.delete(key);
  const identity = `${message.id}:${at}:${fate.face}`;
  if (revealed.has(identity)) return false;
  revealed.set(identity, stamp + TIMING.revealWindow);
  return true;
}

/**
 * The arrival. One timeline: the slab, then the die tumbling onto its face, the
 * rule drawing down the edge, the words, and last the number and the shift.
 */
function reveal(strip) {
  const root = strip.isConnected ? strip : document.body;
  const tier = MOTION_SCALE[motionTier()] ?? 1;
  const d = (ms) => motionDuration(ms, root) * tier;
  if (d(REVEAL.slab) <= 0) return;

  const reduced = motionTier() === "reduced";
  const owner = createMotionOwner();
  owners.set(strip, owner);
  strip.classList.add("glddf-anime-reveal");
  const done = () => {
    owner.clear();
    strip.classList.remove("glddf-anime-reveal");
    owners.delete(strip);
  };
  const tl = owner.add(createTimeline({ autoplay: false, onComplete: done }));
  const q = (sel) => strip.querySelectorAll(sel);

  tl.add(strip, { opacity: [0, 1], translateY: [reduced ? 0 : 6, 0], duration: d(REVEAL.slab), ease: "outCubic" }, 0);
  if (!reduced) {
    tl.add(q(".glddf-fate-rule"), { scaleY: [0, 1], duration: d(REVEAL.rule), ease: "outExpo" }, 0);
    tl.add(q(".glddf-fate-face"), { opacity: [0, 1], rotate: [-90, 0], scale: [0.55, 1], duration: d(REVEAL.die), ease: "outBack(1.6)" }, d(REVEAL.dieAt));
    tl.add(q(".glddf-fate-kicker, .glddf-fate-name"), {
      opacity: [0, 1], translateX: [-6, 0], duration: d(REVEAL.text), delay: stagger(d(REVEAL.textStep)), ease: "outCubic",
    }, d(REVEAL.textAt));
    tl.add(q(".glddf-fate-bonus"), { opacity: [0, 1], scale: [0.7, 1], duration: d(REVEAL.bonus), ease: "outBack(2)" }, d(REVEAL.bonusAt));
    tl.add(q(".glddf-fate-shift"), { opacity: [0, 1], translateY: [4, 0], duration: d(REVEAL.shift), ease: "outCubic" }, d(REVEAL.shiftAt));
  }
  tl.play();
}
