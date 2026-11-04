// Stream Pacer — the Signal Band: the lanes along the top of the screen.
//
// A keyed renderer over model.lanes(). A lane that keeps its key keeps its
// element, so its arrival never replays; a new key is an arrival (the plate
// wipes in along the cut and a light sweeps it once); a changed `stamp` on a
// kept lane flares it again (a new hand, a nudge); a key that disappears plays
// its exit and then leaves the DOM.
//
// Reads no `game`: the preview page drives this file as shipped.

import { animate, createMotionOwner, createTimeline, motionDuration, stagger } from '../../core/motion.mjs';
import { laneInnerHTML, laneClass, laneSignature, text } from './render.js';
import { clockText } from './model.js';
import { MOTION, TIMING } from './const.js';

const EASE_OUT = 'outExpo';
// exits are short and decelerate too: an ease-in exit reads as a stall
const EASE_EXIT = 'outCubic';

/** A call everyone answered: the ready check all ready, the check-in all in. */
const isComplete = (lane) => (lane.kind === 'call' && lane.call === 'ready' && lane.tone === 'green')
  || (lane.kind === 'checkin' && lane.calm);
const leadOf = (lanes) => lanes.find((l) => !l.calm || isComplete(l)) ?? null;
// the flex gap between lanes (#sp-band .sp-lanes); a lane opening or closing its slot moves by its height plus this
const LANE_GAP = 6;

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
    const fresh = new Set();
    // The lead is the first lane that is not calm: the one thing the table must
    // read right now, drawn taller than the queue under it. A calm lane never
    // leads, except a call everyone answered: that is the payoff, and "Move on"
    // is the GM's next click, so it keeps the stage it earned.
    const lead = leadOf(lanes)?.key ?? null;
    let before = null;
    // walk in reverse so each lane can be inserted before the one after it
    for (let i = lanes.length - 1; i >= 0; i--) {
      const lane = lanes[i];
      seen.add(lane.key);
      let item = this.items.get(lane.key);
      const sig = laneSignature(lane, this.L);
      if (!item || item.leaving) {
        if (item?.leaving) this._drop(lane.key);
        item = this._create(lane, now, sig, lane.key === lead);
        fresh.add(lane.key);
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
    // `is-lead` is set after any re-render (which rewrites className), and never
    // on a leaving lane, so a lane exits at the size it had. `item.lead`
    // remembers it across that rewrite, so a promotion is told from a re-render.
    for (const [key, item] of this.items) {
      if (item.leaving) continue;
      const leads = key === lead;
      item.el.classList.toggle('is-lead', leads);
      if (leads && !item.lead && !fresh.has(key)) this._promote(item);
      item.lead = leads;
    }
    // the moments, each played on the transition and never on arrival: a late
    // joiner sees the state, not a celebration of something that happened
    // before they looked
    for (const lane of lanes) {
      const item = this.items.get(lane.key);
      if (!item || item.leaving) continue;
      const expired = !!lane.clock && now >= lane.clock.ends;
      const done = isComplete(lane);
      const count = lane.count ? text(lane.count, this.L) : '';
      if (!fresh.has(lane.key)) {
        if (expired && !item.expired) this._hit(item);
        if (done && !item.done) this._lockIn(item);
        else if (count && item.count && count !== item.count) this._countKnock(item);
      }
      item.expired = expired;
      item.done = done;
      item.count = count;
    }
    // A new lane opens its slot rather than shoving the lanes under it down in
    // one frame: it starts with its height pulled out of the flow and lets it go.
    // Skipped when it is the only lane, where nothing would move.
    if (fresh.size && this.items.size > fresh.size) {
      for (const key of fresh) {
        const el = this.items.get(key).el;
        const rest = getComputedStyle(el).marginBottom;
        this.items.get(key).motion.add(animate(el, {
          marginBottom: [`${-(el.offsetHeight + LANE_GAP)}px`, rest], duration: motionDuration(MOTION.slot, this.root), ease: EASE_OUT,
          onComplete: () => el.style.removeProperty('margin-bottom')
        }));
      }
    }
    this._aura(lanes, lead);
    this.tick(now);
  }

  /** Move the clocks. Called every second while a countdown runs. */
  tick(now) {
    for (const el of this.list.querySelectorAll('[data-sp-clock]')) {
      const ends = Number(el.dataset.ends);
      const t = clockText(Math.ceil((ends - now) / 1000));
      if (el.textContent === t) continue;
      el.textContent = t;
      // in its last seconds the clock knocks once a second, the beat the tick
      // sound plays on (the second turning, not a loop of its own)
      const laneEl = el.closest('.sp-lane');
      if (!laneEl?.classList.contains('is-urgent') || laneEl.classList.contains('is-leaving') || ends <= now) continue;
      const item = this.items.get(laneEl.dataset.key);
      item?.motion.add(animate(el, { scale: [1.16, 1], duration: motionDuration(MOTION.knock, this.root), ease: EASE_EXIT }));
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

  _create(lane, now, sig, lead) {
    const el = document.createElement('section');
    el.className = laneClass(lane);
    if (lead) el.classList.add('is-lead');
    el.dataset.key = lane.key;
    el.setAttribute('role', 'status');
    el.innerHTML = laneInnerHTML(lane, this.L, now);
    const item = { el, sig, stamp: lane.stamp, motion: createMotionOwner(), leaving: false, lead };
    this.items.set(lane.key, item);
    this._syncProgress(el, lane, now);
    const d = (ms) => motionDuration(ms, this.root);
    const tag = el.querySelector('.sp-lane-tag');
    const sweep = el.querySelector('.sp-lane-sweep');
    if (lead) {
      // The lead arrives as one hard wipe, left to right, with its light riding
      // the open edge, then its headline rises out of it. The wipe clips the
      // lane root, never the plate: the plate's chamfer is a clip-path of its
      // own, and the finished wipe leaves no clip behind.
      item.motion.add(animate(el, {
        opacity: { to: [0, 1], duration: d(MOTION.leadWipe) / 2 },
        clipPath: { to: ['inset(0% 100% 0% 0%)', 'inset(0% 0% 0% 0%)'], duration: d(MOTION.leadWipe) },
        ease: EASE_OUT,
        onComplete: () => el.style.removeProperty('clip-path')
      }));
      if (tag) item.motion.add(animate(tag, { translateX: ['-24px', '0px'], duration: d(MOTION.laneIn), ease: EASE_OUT }));
      if (sweep) item.motion.add(animate(sweep, { translateX: ['-120%', '420%'], opacity: [1, 1, 0], duration: d(MOTION.leadWipe) * 1.4, ease: EASE_OUT }));
      this._rise(item, d(MOTION.leadRiseDelay));
      this._auraFlare();
    } else {
      // a queue row only drops into its slot: the lead has the stage
      item.motion.add(animate(el, { opacity: [0, 1], translateY: ['-10px', '0px'], duration: d(MOTION.queueIn), ease: EASE_OUT }));
    }
    return item;
  }

  /** The headline rises into place: on a lead's arrival and on a promotion. */
  _rise(item, delay = 0) {
    const head = item.el.querySelector('.sp-lane-headline');
    if (head) item.motion.add(animate(head, { opacity: [0, 1], translateY: ['10px', '0px'], duration: motionDuration(MOTION.leadRise, this.root), delay, ease: EASE_OUT }));
  }

  /** A queue row that becomes the lead: it grows into place (CSS), its headline rises and its light crosses once. */
  _promote(item) {
    this._rise(item);
    const sweep = item.el.querySelector('.sp-lane-sweep');
    if (sweep) item.motion.add(animate(sweep, { translateX: ['-120%', '420%'], opacity: [0, 1, 0], duration: motionDuration(MOTION.promote, this.root) * 2, ease: 'inOutQuad' }));
    this._auraFlare();
  }

  /** Time up: the clock reaches zero and the lane takes the hit, once. */
  _hit(item) {
    const d = (ms) => motionDuration(ms, this.root);
    const plate = item.el.querySelector('.sp-lane-plate');
    if (plate) item.motion.add(animate(plate, { translateX: ['0px', '-7px', '6px', '-3px', '0px'], duration: d(MOTION.hit), ease: 'outQuad' }));
    for (const clock of item.el.querySelectorAll('[data-sp-clock]')) item.motion.add(animate(clock, { scale: [1.3, 1], duration: d(MOTION.hit), ease: EASE_OUT }));
    this.flare(item.el.dataset.key);
  }

  /**
   * Everyone answered: the faces lock in left to right, the way the answers
   * came together, the new mark on the tag lands, and the light crosses once.
   * Sized for something that happens a few times a session, not every click.
   */
  _lockIn(item) {
    const d = (ms) => motionDuration(ms, this.root);
    const faces = item.el.querySelectorAll('.sp-people .sp-face');
    if (faces.length) item.motion.add(animate(faces, { scale: [1, 1.28, 1], translateY: ['0px', '-3px', '0px'], duration: d(MOTION.lockIn), delay: stagger(d(MOTION.lockInStagger)), ease: 'outQuad' }));
    const icon = item.el.querySelector('.sp-lane-tag i');
    if (icon) item.motion.add(animate(icon, { scale: [0.4, 1.2, 1], rotate: ['-30deg', '0deg'], duration: d(MOTION.lockIn), ease: EASE_OUT }));
    this.flare(item.el.dataset.key);
  }

  /** A tally that moved: the number knocks, so a glance catches the change. */
  _countKnock(item) {
    for (const el of item.el.querySelectorAll('.sp-lane-count, .sp-lane-head-sub.is-count')) {
      item.motion.add(animate(el, { scale: [1.14, 1], duration: motionDuration(MOTION.countKnock, this.root), ease: EASE_EXIT }));
    }
  }

  _leave(key) {
    const item = this.items.get(key);
    if (!item) return;
    item.leaving = true;
    item.el.classList.add('is-leaving');
    const d = (ms) => motionDuration(ms, this.root);
    item.motion.add(animate(item.el, { opacity: [1, 0], translateY: ['0px', '-12px'], duration: d(MOTION.laneOut), ease: EASE_EXIT }));
    // and closes its slot, so the lanes under it slide up instead of jumping
    item.motion.add(animate(item.el, {
      marginBottom: [getComputedStyle(item.el).marginBottom, `${-(item.el.offsetHeight + LANE_GAP)}px`],
      duration: d(MOTION.slot), ease: EASE_EXIT,
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

  _aura(lanes, leadKey = null) {
    const top = lanes.find((l) => l.key === leadKey) ?? lanes[0] ?? null;
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

/** The two title lines: when each starts landing, and the axis it slides on. */
const PERIL_LINES = [
  ['.sp-pk-line-1 .sp-pk-l', 'perilLine1At', 'y', -18],
  ['.sp-pk-line-2 .sp-pk-l', 'perilLine2At', 'x', 18]
];

/**
 * The Dire Peril splash: one full-screen beat over the WebGL field, then it
 * fades and the band's peril lane stays. The scenery is the stylesheet's:
 * every keyframe is a share of `--sp-peril-stage`, which is written here from
 * TIMING.perilStage so the CSS and the unmount below are one length. The title
 * letters are anime.js, one authored rhythm whatever the words' lengths. The
 * stage never takes a click; the table keeps playing under it.
 *
 * @param {object} o
 * @param {string} o.html                 perilStageHTML()
 * @param {{play:(ms:number)=>boolean, stop:()=>void}|null} [o.field]  the WebGL backdrop, if any
 * @param {() => void} [o.onDone]
 * @param {HTMLElement} [o.parent]
 */
export function playPerilSplash({ html, field = null, onDone, parent = document.body }) {
  const el = document.createElement('div');
  el.className = 'sp-root sp-peril gl-type';
  el.setAttribute('aria-hidden', 'true');
  parent.appendChild(el);
  const d = (ms) => motionDuration(ms, el);
  const stage = d(TIMING.perilStage);
  const fade = Math.min(stage, d(TIMING.perilFade));
  el.style.setProperty('--sp-peril-stage', `${stage}ms`);
  el.innerHTML = html;
  field?.play(stage);
  const owner = createMotionOwner();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    owner.clear();
    field?.stop();
    el.remove();
    onDone?.();
  };
  // one timeline, positioned from the declare: the title, the fade, the unmount
  const timeline = owner.add(createTimeline({ autoplay: false }));
  for (const [selector, at, axis, offset] of PERIL_LINES) {
    const letters = el.querySelectorAll(selector);
    if (!letters.length) continue;
    timeline.add(letters, {
      opacity: [0, 1], [axis]: [offset, 0], filter: ['blur(5px)', 'blur(0px)'],
      delay: stagger(d(Math.min(MOTION.perilLetterStagger, MOTION.perilLetterSpread / letters.length))),
      duration: d(MOTION.perilLetter), ease: 'outExpo'
    }, d(MOTION[at]));
  }
  timeline.add(el, { opacity: [1, 0], duration: fade, ease: 'inOutSine' }, stage - fade);
  timeline.call(finish, stage);
  timeline.play();
  // `timeline` lets the preview seek the splash for stills; nothing else uses it
  return { el, finish, timeline };
}
