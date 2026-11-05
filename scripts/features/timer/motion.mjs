/**
 * Decorative beats only. The authoritative countdown never uses this clock.
 *
 * The same moments Stream Pacer plays on its countdown lane, so a table that
 * runs both reads one language: the plate arrives as one hard wipe with its
 * light on the edge, a tier change flares it, the clock knocks once a second
 * in its last ten, and time up lands as a hit. Lengths are `TIMER_MOTION`.
 */
import { animate, createTimeline, createMotionOwner, motionDuration } from "../../core/motion.mjs";
import { TIMER_MOTION } from "./view.mjs";

const EASE_OUT = "outExpo";
// a knock decelerates too: an ease-in reads as a stall
const EASE_EXIT = "outCubic";

export class TimerMotion {
  constructor(root) {
    this.root = root;
    this.entrance = createMotionOwner();
    this.accent = createMotionOwner();
    this.beat = createMotionOwner();
  }

  /** The plate arrives: one hard wipe left to right, the tag slides in behind
   *  it and the light rides the open edge. The wipe clips the HUD root, never
   *  the plate, whose chamfer is a clip-path of its own; the finished wipe
   *  leaves no clip behind. */
  reveal() {
    this.clear();
    const root = this.root;
    const ms = (n) => motionDuration(n, root);
    if (!ms(TIMER_MOTION.wipe)) return;
    const timeline = this.entrance.add(createTimeline({ autoplay: false }));
    timeline
      .add(root, {
        clipPath: ["inset(0% 100% 0% 0%)", "inset(0% 0% 0% 0%)"],
        duration: ms(TIMER_MOTION.wipe),
        ease: EASE_OUT,
        onComplete: () => root.style?.removeProperty?.("clip-path"),
      }, 0)
      .add(root.querySelector(".gltimer-tag"), { x: [-24, 0], duration: ms(TIMER_MOTION.tagIn), ease: EASE_OUT }, 0)
      .add(root.querySelector(".gltimer-face"), { y: [8, 0], opacity: [0, 1], duration: ms(TIMER_MOTION.tagIn), ease: EASE_OUT }, ms(TIMER_MOTION.wipe) * 0.3)
      .add(root.querySelector(".gltimer-sheen-light"), { x: ["-120%", "420%"], opacity: [1, 1, 0], duration: ms(TIMER_MOTION.wipe) * 1.4, ease: EASE_OUT }, 0);
    timeline.play();
  }

  /** A tier change flares the plate; time up (`expired`) lands as a hit. */
  emphasize(expired = false) {
    this.accent.clear();
    const root = this.root;
    const ms = (n) => motionDuration(n, root);
    if (!ms(TIMER_MOTION.flare)) return;
    const timeline = this.accent.add(createTimeline({ autoplay: false }));
    if (expired) {
      timeline
        .add(root.querySelector(".gltimer-plate"), { x: [0, -7, 6, -3, 0], duration: ms(TIMER_MOTION.hit), ease: "outQuad" }, 0)
        .add(root.querySelector(".gltimer-main"), { scale: [1.3, 1], duration: ms(TIMER_MOTION.hit), ease: EASE_OUT }, 0)
        .add(root.querySelector(".gltimer-impact"), { opacity: [1, 0], duration: ms(TIMER_MOTION.hit) * 1.5, ease: EASE_OUT }, 0)
        .add(root.querySelector(".gltimer-sheen-light"), { x: ["-120%", "420%"], opacity: [0, 1, 0], duration: ms(TIMER_MOTION.sweep), ease: "inOutQuad" }, 0);
    } else {
      timeline
        .add(root.querySelector(".gltimer-plate"), { scale: [1, 1.025, 1], duration: ms(TIMER_MOTION.flare), ease: "outQuad" }, 0)
        .add(root.querySelector(".gltimer-sheen-light"), { x: ["-120%", "420%"], opacity: [0, 1, 0], duration: ms(TIMER_MOTION.sweep), ease: "inOutQuad" }, 0);
    }
    timeline.play();
  }

  /** The clock knocks: once a second in its last ten, on the beat the tick plays. */
  knock() {
    const root = this.root;
    const d = motionDuration(TIMER_MOTION.knock, root);
    if (!d) return;
    this.beat.clear();
    this.beat.add(animate(root.querySelector(".gltimer-face"), { scale: [1.16, 1], duration: d, ease: EASE_EXIT }));
  }

  clear() { this.entrance.clear(); this.accent.clear(); this.beat.clear(); }
}
