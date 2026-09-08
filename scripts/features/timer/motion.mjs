/** Decorative beats only. The authoritative countdown never uses this clock. */
import { animate, createTimeline, createMotionOwner, motionDuration } from "../../core/motion.mjs";

export class TimerMotion {
  constructor(root) {
    this.root = root;
    this.entrance = createMotionOwner();
    this.accent = createMotionOwner();
  }

  reveal() {
    this.clear();
    const root = this.root;
    const ms = n => motionDuration(n, root);
    if (!ms(420)) return;
    const timeline = this.entrance.add(createTimeline({ autoplay: false }));
    timeline
      .add(root.querySelector('.gltimer-face'), { y: [-7, 0], duration: ms(420), ease: 'out(4)' }, 0)
      .add(root.querySelector('.gltimer-sheen-light'), { x: ['-130%', '130%'], opacity: [0, 0.85, 0], duration: ms(920), ease: 'inOut(3)' }, 0);
    timeline.play();
  }

  emphasize(expired = false) {
    this.accent.clear();
    const root = this.root;
    const ms = n => motionDuration(n, root);
    if (!ms(420)) return;
    if (expired) {
      const timeline = this.accent.add(createTimeline({ autoplay: false }));
      timeline
        .add(root.querySelector('.gltimer-impact'), { opacity: [0.9, 0], scale: [0.98, 1.17], duration: ms(760), ease: 'out(4)' }, 0)
        .add(root.querySelector('.gltimer-main'), { scale: [1.06, 1], duration: ms(540), ease: 'out(5)' }, ms(55));
      timeline.play();
    } else {
      this.accent.add(animate(root.querySelector('.gltimer-main'), { scale: [1, 1.035, 1], duration: ms(420), ease: 'inOut(3)' }));
    }
  }

  clear() { this.entrance.clear(); this.accent.clear(); }
}
