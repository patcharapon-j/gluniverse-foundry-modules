// Stream Pacer — the Signal Band: the lanes along the top of the screen.
//
// A keyed renderer over model.lanes(). A lane that keeps its key keeps its
// element, so its arrival never replays; a new key is an arrival (the plate
// wipes in along the cut and a light sweeps it once); a changed `stamp` on a
// kept lane flares it again (a new hand, a nudge); a key that disappears plays
// its exit and then leaves the DOM.
//
// Reads no `game`: the preview page drives this file as shipped.

import { animate, createMotionOwner, motionDuration } from '../../core/motion.mjs';
import { laneInnerHTML, laneClass, laneSignature } from './render.js';
import { clockText } from './model.js';
import { MOTION, TIMING } from './const.js';

const EASE_OUT = 'outExpo';
// exits are short and decelerate too: an ease-in exit reads as a stall
const EASE_EXIT = 'outCubic';

export class SignalBand {
  /**
   * @param {object} o
   * @param {(key:string, data?:object) => string} o.L  localize
   * @param {(action:string, data:DOMStringMap, laneKey:string) => void} o.onAction
   * @param {HTMLElement} [o.parent]
   */
  constructor({ L, onAction, parent = document.body }) {
    this.L = L;
    this.onAction = onAction;
    this.root = document.createElement('div');
    this.root.id = 'sp-band';
    this.root.className = 'sp-root sp-band gl-type';
    this.root.innerHTML = '<div class="sp-aura" aria-hidden="true"><i class="sp-aura-core"></i><i class="sp-aura-flare"></i></div>'
      + '<div class="sp-lanes" role="region"></div>';
    this.root.querySelector('.sp-lanes').setAttribute('aria-label', L('STREAM_PACER.Band.Region'));
    this.aura = this.root.querySelector('.sp-aura');
    this.list = this.root.querySelector('.sp-lanes');
    parent.appendChild(this.root);
    /** @type {Map<string, {el:HTMLElement, sig:string, stamp:string, motion:object, leaving:boolean}>} */
    this.items = new Map();
    this.auraMotion = createMotionOwner();
    this._onClick = (ev) => {
      const btn = ev.target.closest('[data-sp-action]');
      if (!btn || btn.disabled) return;
      const lane = btn.closest('.sp-lane');
      this.onAction(btn.dataset.spAction, btn.dataset, lane?.dataset.key ?? '');
    };
    this.root.addEventListener('click', this._onClick);
  }

  /** Draw these lanes. `now` is server time (ms). */
  update(lanes, now) {
    const seen = new Set();
    let before = null;
    // walk in reverse so each lane can be inserted before the one after it
    for (let i = lanes.length - 1; i >= 0; i--) {
      const lane = lanes[i];
      seen.add(lane.key);
      let item = this.items.get(lane.key);
      const sig = laneSignature(lane, this.L);
      if (!item || item.leaving) {
        if (item?.leaving) this._drop(lane.key);
        item = this._create(lane, now, sig);
      } else {
        if (item.sig !== sig) {
          item.el.className = laneClass(lane);
          item.el.innerHTML = laneInnerHTML(lane, this.L, now);
          item.sig = sig;
          this._syncProgress(item.el, lane, now);
        }
        if (item.stamp !== lane.stamp) {
          item.stamp = lane.stamp;
          this.flare(lane.key);
        }
      }
      // a fresh lane is not in the list yet, and its nextElementSibling is null too
      if (item.el.parentNode !== this.list || item.el.nextElementSibling !== before) this.list.insertBefore(item.el, before);
      before = item.el;
    }
    for (const [key, item] of this.items) if (!seen.has(key) && !item.leaving) this._leave(key);
    this._aura(lanes);
    this.tick(now);
  }

  /** Move the clocks. Called every second while a countdown runs. */
  tick(now) {
    for (const el of this.list.querySelectorAll('[data-sp-clock]')) {
      const ends = Number(el.dataset.ends);
      const t = clockText(Math.ceil((ends - now) / 1000));
      if (el.textContent !== t) el.textContent = t;
    }
  }

  /** Flare one lane (and the aura behind the band). */
  flare(key) {
    const item = this.items.get(key);
    if (!item || item.leaving) return;
    const sweep = item.el.querySelector('.sp-lane-sweep');
    if (sweep) item.motion.add(animate(sweep, { translateX: ['-120%', '420%'], opacity: [0, 1, 0], duration: motionDuration(MOTION.flareSweep, this.root), ease: 'inOutQuad' }));
    const plate = item.el.querySelector('.sp-lane-plate');
    if (plate) item.motion.add(animate(plate, { scale: [1, 1.025, 1], duration: motionDuration(MOTION.flarePulse, this.root), ease: 'outQuad' }));
    this._auraFlare();
  }

  destroy() {
    this.root.removeEventListener('click', this._onClick);
    for (const item of this.items.values()) item.motion.clear();
    this.auraMotion.clear();
    this.items.clear();
    this.root.remove();
  }

  /* ── internals ── */

  _create(lane, now, sig) {
    const el = document.createElement('section');
    el.className = laneClass(lane);
    el.dataset.key = lane.key;
    el.setAttribute('role', 'status');
    el.innerHTML = laneInnerHTML(lane, this.L, now);
    const item = { el, sig, stamp: lane.stamp, motion: createMotionOwner(), leaving: false };
    this.items.set(lane.key, item);
    this._syncProgress(el, lane, now);
    // arrival: the lane drops out of the top edge and wipes open left to right.
    // The wipe clips the lane root, never the plate: the plate's chamfer is a
    // clip-path of its own, and the finished wipe leaves no clip behind.
    const d = (ms) => motionDuration(ms, this.root);
    item.motion.add(animate(el, {
      opacity: { to: [0, 1], duration: d(MOTION.laneIn) },
      translateY: { to: ['-18px', '0px'], duration: d(MOTION.laneIn) },
      clipPath: { to: ['inset(0% 100% 0% 0%)', 'inset(0% 0% 0% 0%)'], duration: d(MOTION.laneWipe) },
      ease: EASE_OUT,
      onComplete: () => el.style.removeProperty('clip-path')
    }));
    const tag = el.querySelector('.sp-lane-tag');
    if (tag) item.motion.add(animate(tag, { translateX: ['-24px', '0px'], duration: d(MOTION.laneIn), delay: d(MOTION.laneTagDelay), ease: EASE_OUT }));
    const sweep = el.querySelector('.sp-lane-sweep');
    if (sweep) item.motion.add(animate(sweep, { translateX: ['-120%', '420%'], opacity: [0, 1, 0], duration: d(MOTION.sweep), delay: d(MOTION.sweepDelay), ease: 'inOutQuad' }));
    this._auraFlare();
    return item;
  }

  _leave(key) {
    const item = this.items.get(key);
    if (!item) return;
    item.leaving = true;
    item.el.classList.add('is-leaving');
    item.motion.add(animate(item.el, {
      opacity: [1, 0], translateY: ['0px', '-12px'], duration: motionDuration(MOTION.laneOut, this.root), ease: EASE_EXIT,
      onComplete: () => this._drop(key)
    }));
  }

  _drop(key) {
    const item = this.items.get(key);
    if (!item) return;
    item.motion.clear();
    item.el.remove();
    this.items.delete(key);
  }

  /** The countdown's hairline drains on the compositor; it only needs to know where it started. */
  _syncProgress(el, lane, now) {
    const bar = el.querySelector('[data-sp-progress]');
    if (!bar || !lane.clock) return;
    const elapsed = Math.max(0, now - lane.clock.at);
    bar.style.setProperty('--sp-elapsed', `${elapsed}ms`);
  }

  _aura(lanes) {
    const top = lanes.find((l) => !l.calm) ?? lanes[0] ?? null;
    const a = this.aura;
    const tone = top ? top.tone : 'none';
    if (a.dataset.tone !== tone) {
      for (const c of [...a.classList]) if (c.startsWith('sp-tone-')) a.classList.remove(c);
      if (top) a.classList.add(`sp-tone-${tone}`);
      a.dataset.tone = tone;
    }
    a.classList.toggle('is-on', !!top);
    a.classList.toggle('is-urgent', lanes.some((l) => l.urgent));
    a.classList.toggle('is-calm', !!top && lanes.every((l) => l.calm));
    // A red light nobody has looked at frames the whole screen. Only a safety
    // lane can raise it, and only a client with a safety desk draws one.
    this.root.classList.toggle('has-frame', lanes.some((l) => l.kind === 'safety' && l.tone === 'red' && l.urgent));
  }

  _auraFlare() {
    const flare = this.aura.querySelector('.sp-aura-flare');
    if (!flare) return;
    this.auraMotion.clear();
    this.auraMotion.add(animate(flare, { opacity: [0, 1, 0], scaleY: [0.6, 1.15, 1], duration: motionDuration(MOTION.aura, this.root), ease: 'outQuad' }));
  }
}

/** The Dire Peril splash: one beat, then it lifts and the band's peril lane stays. */
export function playPerilSplash({ html, onDone, parent = document.body }) {
  const el = document.createElement('div');
  el.className = 'sp-root sp-peril gl-type';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = html;
  parent.appendChild(el);
  const owner = createMotionOwner();
  const d = (ms) => motionDuration(ms, el);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    owner.clear();
    el.remove();
    onDone?.();
  };
  owner.add(animate(el.querySelector('.sp-peril-veil'), { opacity: [0, 1], duration: d(MOTION.perilVeil), ease: 'outQuad' }));
  owner.add(animate(el.querySelector('.sp-peril-cut'), { scaleX: [0, 1], opacity: [0, 1], duration: d(MOTION.perilCut), delay: d(MOTION.perilCutDelay), ease: EASE_OUT }));
  owner.add(animate(el.querySelectorAll('.sp-peril-ch'), {
    opacity: [0, 1], translateY: ['0.35em', '0em'], filter: ['blur(10px)', 'blur(0px)'],
    duration: d(MOTION.perilChar), delay: (_, i) => d(MOTION.perilCharDelay + i * MOTION.perilCharStagger), ease: EASE_OUT
  }));
  owner.add(animate(el.querySelector('.sp-peril-sub'), { opacity: [0, 1], translateY: ['8px', '0px'], duration: d(MOTION.perilSub), delay: d(MOTION.perilSubDelay), ease: EASE_OUT }));
  owner.add(animate(el, {
    opacity: [1, 0], duration: d(TIMING.perilLift), delay: d(TIMING.perilHold), ease: EASE_EXIT,
    onComplete: finish
  }));
  el.addEventListener('click', finish, { once: true });
  return { el, finish };
}
