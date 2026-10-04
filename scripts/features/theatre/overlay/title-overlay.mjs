/**
 * Theatre — the DOM half of a cue: black, letterbox bars, scrims, the title,
 * the interlude card and the corner tag.
 *
 * PURE DOM: no `game`, `canvas`, `foundry`, `ui` or `Hooks`. The preview page
 * (tools/theatre-preview.mjs) drives this exact file, so anything that reads the
 * world here would have to be reimplemented there.
 *
 * Timing. Every beat BETWEEN renderers (when black lands, when the title
 * arrives, when it leaves) comes from the scaled timeline the caller passes —
 * `timelineFor()` + `scaleTimeline()` in ../timeline.mjs. What happens INSIDE a
 * beat (the rules opening half a second into the title, one letter after
 * another) is `BEATS` below, the one place those offsets are written, and it is
 * multiplied by the same motion scale the timeline was (`opts.scale`, or read
 * back off the timeline when the caller does not say).
 *
 * WAAPI fill rule. The first animation of a property on an element fills
 * "both"; every later one on the same element and property fills "forwards".
 * A later animation's BACKWARD fill would otherwise hold its own `from` from
 * t = 0 and override the earlier one for its whole delay.
 *
 * Every animation's clock is the cue's: it is created with `delay` = the beat's
 * time from the cue start and its `startTime` set so t = 0 is `startAt`
 * (performance.now() based). A client that is a little late therefore simply
 * joins mid-flight; `settle` jumps to the end state with nothing animated.
 */

import { FACES, DEFAULT_FACE, TIMING } from "../constants.mjs";
import { timelineFor, scaleTimeline, segmentValue, CREDIT_LETTER_STAGGER } from "../timeline.mjs";

export const OVERLAY_ID = "glth-overlay";

/** The voice an interlude card is set in, whatever the title face (an italic serif reads as narration). */
export const CARD_FACE = "cormorant";

/**
 * The letterbox bars are this fraction of the viewport tall at rest and are
 * scaled down to the value (transform only — no layout per frame). Credits
 * close them to 0.505, so they overlap in the middle.
 */
export const BAR_SPAN = 0.51;

/**
 * Intra-beat offsets and durations (ms at motion scale 1), relative to the
 * beat the timeline gives. The ONE place these numbers live.
 */
export const BEATS = Object.freeze({
  centre: Object.freeze({
    trackFrom: 1.1, blur: 8,                        // name: tracking (em) collapses over timeline.title.arrive
    ruleAt: 500, ruleDur: 1800,
    eyebrowAt: 900, eyebrowDur: 1000, eyebrowRise: 8,
    subAt: 1100, subDur: 1000, subRise: 8,
  }),
  chapter: Object.freeze({
    eyebrowAt: 0, eyebrowDur: 900, eyebrowSlide: 24,
    nameAt: 200, nameDur: 1300, nameSlide: 16,
    underlineAt: 900, underlineDur: 1000,
    subAt: 1000, subDur: 1500, subTrackExtra: 0.4,
  }),
  credits: Object.freeze({
    letterDur: 800, letterRise: 10, letterBlur: 4,  // stagger: CREDIT_LETTER_STAGGER (timeline.mjs)
    subGap: 200, subDur: 1000,
  }),
  wipe: Object.freeze({
    eyebrowAt: 0, eyebrowDur: 800,
    wordAt: 100, wordStagger: 170, wordDur: 1000,
    subAt: 600, subDur: 1100, subRise: 6,
  }),
  card: Object.freeze({ trackFrom: 0.3, blur: 6 }),
  out: Object.freeze({ blur: 6 }),
  scrim: Object.freeze({ lead: 300, inDur: 900 }),
  tag: Object.freeze({ inDur: 900, outDur: 400, slide: 10 }),
  black: Object.freeze({ dur: 700 }),                // setBlack()
  letterbox: Object.freeze({ dur: 900 }),            // setLetterbox()
  clear: Object.freeze({ dur: 500 }),                // clearTitle()
  fitWidth: 0.88,                                    // a title never sets wider than this fraction of the viewport
});

/** Which scrim sits behind which title placement. */
const SCRIM_FOR = Object.freeze({ centre: "mid", cut: "mid", chapter: "low", credits: "low", wipe: "high" });
const TITLE_LAYOUT = Object.freeze({ centre: "centre", cut: "centre", chapter: "chapter", credits: "credits", wipe: "wipe", interlude: "centre" });

const now = () => performance.now();
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const em = (v) => `${v}em`;
const parseEm = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? n : 0; };

/** Resolve a FACES entry from an entry or a key. */
export function resolveFace(face) {
  if (face && typeof face === "object" && face.family) return face;
  return FACES[face] ?? FACES[DEFAULT_FACE];
}

/** Apply a face (or a secondary) to an element's inline style. */
function setVoice(node, v) {
  node.style.fontFamily = v.family;
  node.style.fontWeight = String(v.weight);
  node.style.fontStretch = v.stretch ?? "100%";
  node.style.fontStyle = v.style ?? "normal";
  node.style.letterSpacing = v.track ?? "0";
  node.style.textTransform = v.upper ? "uppercase" : "none";
}

/**
 * The motion scale a timeline was built with: its title (or card) exit
 * duration against the same style's unscaled one. 1 when nothing can be read.
 */
export function inferScale(timeline) {
  if (!timeline) return 1;
  const base = timelineFor(timeline.style ?? "centre");
  const pairs = [[timeline.title?.outDur, base.title?.outDur], [timeline.card?.outDur, base.card?.outDur]];
  for (const [a, b] of pairs) if (Number.isFinite(a) && Number.isFinite(b) && b > 0) return a / b;
  return 1;
}

export class TitleOverlay {
  /**
   * @param {object} [o]
   * @param {HTMLElement} [o.root=document.body]  Where #glth-overlay is mounted.
   * @param {number} [o.zIndex]  Overrides the stylesheet's z-index (above Stage's overlay, below Foundry UI).
   */
  constructor({ root = null, zIndex = null } = {}) {
    this.root = root;
    this.zIndex = zIndex;
    this.node = null;
    /** @type {{anim: Animation, el: Element, props: string[], cue: boolean}[]} */
    this._anims = [];
    /** el → Set of properties already animated in this cue (the fill rule). */
    this._seen = new WeakMap();
    this._k = 1;                 // motion scale of the last cue
    this._letterbox = 0;         // resting bar fraction
    this._black = 0;             // resting black
    this._tagText = null;
    this._last = null;           // last play() arguments, for seek()
    this._frozen = false;
    this._onVisibility = () => { if (document.visibilityState === "visible") this._resync(); };
  }

  /* ── lifecycle ─────────────────────────────────────────────────────── */

  mount() {
    if (this.node?.isConnected) return this.node;
    const host = this.root ?? document.body;
    document.getElementById(OVERLAY_ID)?.remove();
    const n = el("div", "glth-overlay gl-type");
    n.id = OVERLAY_ID;
    n.setAttribute("aria-hidden", "true");
    if (Number.isFinite(this.zIndex)) n.style.zIndex = String(this.zIndex);
    this.$ = {
      scrims: { mid: el("div", "glth-scrim glth-scrim--mid"), low: el("div", "glth-scrim glth-scrim--low"), high: el("div", "glth-scrim glth-scrim--high") },
      tag: el("div", "glth-tag"),
      black: el("div", "glth-black"),
      barTop: el("div", "glth-bar glth-bar--top"),
      barBottom: el("div", "glth-bar glth-bar--bottom"),
      title: el("div", "glth-title"),
      card: el("div", "glth-card"),
    };
    for (const b of [this.$.barTop, this.$.barBottom]) {
      b.style.height = `${BAR_SPAN * 100}%`;
      b.style.transform = "scaleY(0)";
    }
    n.append(...Object.values(this.$.scrims), this.$.tag, this.$.black, this.$.barTop, this.$.barBottom, this.$.title, this.$.card);
    host.append(n);
    this.node = n;
    document.addEventListener("visibilitychange", this._onVisibility);
    this._applyRest();
    return n;
  }

  unmount() {
    document.removeEventListener("visibilitychange", this._onVisibility);
    this._cancel(() => true, false);
    this.node?.remove();
    this.node = null;
    this.$ = null;
  }

  /* ── public beats ──────────────────────────────────────────────────── */

  /**
   * Play the DOM half of a cue.
   * @param {object} cue
   * @param {"shot"|"title"|"card"|"black"|"clear"} [cue.kind="shot"]
   * @param {string} [cue.style]          STYLES key (defaults to the timeline's)
   * @param {{eyebrow?:string,title?:string,subtitle?:string}} [cue.title]
   * @param {object|string} [cue.face]    FACES entry (or key)
   * @param {string} [cue.cardText]       interlude text
   * @param {number} [cue.letterbox]      resting letterbox after this cue (default: the timeline's last bar value)
   * @param {string|null} [cue.tag]       corner tag text; null hides it
   * @param {object} opts
   * @param {object} opts.timeline        scaled timeline (timelineFor + scaleTimeline)
   * @param {number} [opts.startAt]       performance.now()-based cue start
   * @param {boolean} [opts.settle=false] show the end state, animate nothing
   * @param {number} [opts.scale]         the motion scale the timeline was built with (else inferred)
   */
  play(cue = {}, { timeline = null, startAt = now(), settle = false, scale } = {}) {
    if (!this.node) this.mount();
    const kind = cue.kind ?? "shot";
    const style = cue.style ?? timeline?.style ?? "centre";
    const k = Number.isFinite(scale) ? scale : inferScale(timeline);
    this._k = k;
    this._last = { cue: { ...cue }, opts: { timeline, startAt, settle, scale: k } };
    this._frozen = false;
    this._tagText = cue.tag ?? null;

    if (kind === "black") return this.setBlack(true, { animate: !settle });
    if (kind === "clear") { this.clearTitle({ animate: !settle }); return this.setBlack(false, { animate: !settle }); }

    // A new cue owns every element: freeze whatever is on screen where it is, then start over.
    // A re-announce owns only the title layers — a dip or bars still running keep running.
    const layers = [this.$.title, this.$.card, this.$.tag, ...Object.values(this.$.scrims)];
    const owned = kind === "title" ? (a) => layers.some((n) => n === a.el || n.contains(a.el)) : () => true;
    this._cancel(owned, true);
    if (kind !== "title") this._seen = new WeakMap();
    this._clearTitleDom();

    let tl = timeline ?? scaleTimeline(timelineFor(style), k);
    if (kind === "card" && !tl.card) tl = scaleTimeline(timelineFor("interlude", { hold: TIMING.hold }), k);
    const face = resolveFace(cue.face);

    if (settle) return this._settle(kind, tl, cue);

    const clock = { startAt };
    this._hideTag(clock);

    if (kind === "shot") {
      this._playBlack(tl.black, clock);
      this._playBars(tl, clock, cue.letterbox);
      if (tl.card) this._playCard(cue.cardText ?? "", tl.card, clock, k);
      if (tl.title && this._hasText(cue.title)) this._playTitle(style, cue.title, face, tl.title, clock, k, 0);
      this._showTag(tl.total + TIMING.tagDelay * k, clock, k);
    } else if (kind === "title") {
      // Re-announce: the title beats alone, pulled forward so the scrim leads by its usual margin.
      const beat = tl.title ?? scaleTimeline(timelineFor(TITLE_LAYOUT[style] === "centre" ? "centre" : style), k).title;
      if (beat && this._hasText(cue.title)) {
        const shift = BEATS.scrim.lead * k - beat.at;
        this._playTitle(style === "interlude" ? "centre" : style, cue.title, face, beat, clock, k, shift);
        this._showTag(beat.outAt + beat.outDur + shift + TIMING.tagDelay * k, clock, k);
      }
    } else if (kind === "card") {
      this._playBlack(tl.black, clock);
      this._playCard(cue.cardText ?? "", tl.card, clock, k);
      this._showTag(tl.total + TIMING.tagDelay * k, clock, k);
    }
  }

  /** Resting letterbox, 0..0.2 of the viewport height per bar. */
  setLetterbox(fraction, { animate = true } = {}) {
    if (!this.node) this.mount();
    const f = Math.max(0, Math.min(0.5, Number(fraction) || 0));
    this._letterbox = f;
    this.node.style.setProperty("--glth-lb", String(f));
    for (const bar of [this.$.barTop, this.$.barBottom]) {
      const from = this._barValue(bar);
      this._cancel((a) => a.el === bar, true);
      if (!animate) { bar.style.transform = `scaleY(${f / BAR_SPAN})`; continue; }
      this._run(bar, [{ transform: `scaleY(${from / BAR_SPAN})` }, { transform: `scaleY(${f / BAR_SPAN})` }],
        { duration: BEATS.letterbox.dur * this._k, easing: this._ease(f > from ? "sharp" : "ease") }, { cue: false });
    }
  }

  /** Cut to black (on) or lift it (off). */
  setBlack(on, { animate = true } = {}) {
    if (!this.node) this.mount();
    const to = on ? 1 : 0;
    this._black = to;
    const b = this.$.black;
    const from = this._opacity(b);
    this._cancel((a) => a.el === b, true);
    if (on) this._hideTag({ startAt: now() });
    if (!animate) { b.style.opacity = String(to); if (!on) this._showTag(0, { startAt: now() }, this._k, true); return; }
    this._run(b, [{ opacity: from }, { opacity: to }],
      { duration: BEATS.black.dur * this._k, easing: this._ease(on ? "exit" : "ease") }, { cue: false });
    if (!on) this._showTag(BEATS.black.dur * this._k, { startAt: now() }, this._k);
  }

  /** Take the title and any card off screen. */
  clearTitle({ animate = true } = {}) {
    if (!this.node) return;
    const nodes = [this.$.title, this.$.card, ...Object.values(this.$.scrims)];
    if (!animate) { this._cancel((a) => nodes.some((n) => n === a.el || n.contains(a.el)), false); this._clearTitleDom(); return; }
    for (const n of nodes) {
      const from = this._opacity(n);
      if (from <= 0) continue;
      this._run(n, [{ opacity: from }, { opacity: 0 }], { duration: BEATS.clear.dur * this._k, easing: this._ease("exit"), fill: "forwards" }, { cue: false });
    }
  }

  /** Freeze every beat of the last cue at `ms` after its start (inspection). Replays the cue first. */
  seek(ms) {
    if (!this._last) return;
    const { cue, opts } = this._last;
    this.play(cue, { ...opts, startAt: now(), settle: false });
    this._frozen = true;
    for (const { anim } of this._anims) { anim.pause(); anim.currentTime = Math.max(0, ms); }
  }

  /** Let a seeked cue run on from where it was frozen. */
  resume() {
    this._frozen = false;
    for (const { anim } of this._anims) anim.play();
  }

  /** Total length of the last cue (ms), for scrubbers. */
  get duration() {
    return this._last?.opts.timeline?.total ?? 0;
  }

  /* ── cue parts ─────────────────────────────────────────────────────── */

  _hasText(t) { return !!(t && (t.eyebrow || t.title || t.subtitle)); }

  _playBlack(segs, clock) {
    const b = this.$.black;
    const cur = this._opacity(b);
    if (!segs?.length) {
      // A shot always ends visible unless the GM cut to black.
      if (cur > 0) this._run(b, [{ opacity: cur }, { opacity: 0 }], { duration: BEATS.black.dur * this._k, easing: this._ease("ease") }, clock);
      this._black = 0;
      return;
    }
    segs.forEach((g, i) => {
      const from = i === 0 ? cur : g.from;
      this._run(b, [{ opacity: from }, { opacity: g.to }],
        { delay: g.at, duration: Math.max(1, g.dur), easing: this._ease(g.to > from ? "exit" : "ease") }, clock);
    });
    this._black = segs[segs.length - 1].to;
  }

  _barLists(tl, rest) {
    const top = tl.bars ?? [];
    let bottom = top;
    if (tl.creditsBars) {
      const { top: open, bottom: low } = tl.creditsBars;
      bottom = top.map((g) => ({ ...g, from: g.from === open ? low : g.from, to: g.to === open ? low : g.to }));
    }
    if (Number.isFinite(rest) && top.length) {
      const fix = (l) => l.map((g, i) => (i === l.length - 1 ? { ...g, to: rest } : g));
      return { top: fix(top), bottom: fix(bottom) };
    }
    return { top, bottom };
  }

  _playBars(tl, clock, rest) {
    const lists = this._barLists(tl, rest);
    for (const [bar, segs] of [[this.$.barTop, lists.top], [this.$.barBottom, lists.bottom]]) {
      const cur = this._barValue(bar);
      segs.forEach((g, i) => {
        const from = i === 0 ? cur : g.from;
        if (i === 0 && Math.abs(from - g.to) < 1e-4 && segs.length === 1) return;
        this._run(bar, [{ transform: `scaleY(${from / BAR_SPAN})` }, { transform: `scaleY(${g.to / BAR_SPAN})` }],
          { delay: g.at, duration: Math.max(1, g.dur), easing: this._ease(g.to > from ? "sharp" : "ease") }, clock);
      });
    }
    const last = lists.top[lists.top.length - 1];
    if (last) { this._letterbox = last.to; this.node.style.setProperty("--glth-lb", String(last.to)); }
  }

  /**
   * @param {string} style   placement (centre/cut/chapter/credits/wipe)
   * @param {number} shift   ms added to every beat (re-announce pulls the title forward)
   */
  _playTitle(style, text, face, beat, clock, k, shift) {
    const layout = TITLE_LAYOUT[style] ?? "centre";
    const t = this.$.title;
    t.className = `glth-title glth-title--${layout}`;
    t.classList.toggle("glth-title--serif-secondary", !face.secondary.upper);
    const parts = this._buildTitle(layout, text, face);
    this._fit(parts.name, face);

    const at = beat.at + shift;
    const B = BEATS[layout] ?? BEATS.centre;
    const E = this._ease("ease"), SHARP = this._ease("sharp");
    const run = (n, frames, delay, dur, easing = E) => n && this._run(n, frames, { delay: at + delay * k, duration: Math.max(1, dur * k), easing }, clock);

    // Scrim leads the title and leaves with it.
    const scrim = this.$.scrims[SCRIM_FOR[style] ?? "mid"];
    this._run(scrim, [{ opacity: 0 }, { opacity: 1 }], { delay: at - BEATS.scrim.lead * k, duration: BEATS.scrim.inDur * k, easing: E }, clock);
    this._run(scrim, [{ opacity: 1 }, { opacity: 0 }], { delay: beat.outAt + shift, duration: beat.outDur, easing: this._ease("exit") }, clock);

    this._run(t, [{ opacity: 0 }, { opacity: 1 }], { delay: at, duration: 1, easing: "linear" }, clock);

    if (layout === "centre") {
      if (parts.name) this._run(parts.name, [
        { letterSpacing: em(B.trackFrom), opacity: 0, filter: `blur(${B.blur}px)` },
        { letterSpacing: face.track, opacity: 1, filter: "blur(0px)" },
      ], { delay: at, duration: Math.max(1, beat.arrive), easing: E }, clock);
      for (const r of parts.rules) run(r, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], B.ruleAt, B.ruleDur);
      run(parts.eyebrow, [{ opacity: 0, transform: `translateY(${-B.eyebrowRise}px)` }, { opacity: 1, transform: "none" }], B.eyebrowAt, B.eyebrowDur);
      run(parts.sub, [{ opacity: 0, transform: `translateY(${B.subRise}px)` }, { opacity: 1, transform: "none" }], B.subAt, B.subDur);
    } else if (layout === "chapter") {
      run(parts.eyebrow, [{ opacity: 0, transform: `translateX(${-B.eyebrowSlide}px)` }, { opacity: 1, transform: "none" }], B.eyebrowAt, B.eyebrowDur);
      run(parts.name, [
        { clipPath: "inset(-20% 100% -20% 0)", transform: `translateX(${-B.nameSlide}px)` },
        { clipPath: "inset(-20% 0% -20% 0)", transform: "none" },
      ], B.nameAt, B.nameDur, SHARP);
      run(parts.underline, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], B.underlineAt, B.underlineDur);
      const track = parseEm(face.secondary.track);
      run(parts.sub, [{ opacity: 0, letterSpacing: em(track + B.subTrackExtra) }, { opacity: 1, letterSpacing: face.secondary.track }], B.subAt, B.subDur);
    } else if (layout === "credits") {
      const letters = parts.pieces;
      letters.forEach((c, i) => run(c, [
        { opacity: 0, transform: `translateY(${B.letterRise}px)`, filter: `blur(${B.letterBlur}px)` },
        { opacity: 1, transform: "none", filter: "blur(0px)" },
      ], i * CREDIT_LETTER_STAGGER, B.letterDur));
      run(parts.sub, [{ opacity: 0 }, { opacity: 1 }], letters.length * CREDIT_LETTER_STAGGER + B.subGap, B.subDur);
    } else if (layout === "wipe") {
      run(parts.eyebrow, [{ opacity: 0 }, { opacity: 1 }], B.eyebrowAt, B.eyebrowDur);
      parts.pieces.forEach((w, i) => run(w, [{ transform: "translateY(105%)" }, { transform: "none" }], B.wordAt + i * B.wordStagger, B.wordDur));
      run(parts.sub, [{ opacity: 0, transform: `translateY(${B.subRise}px)` }, { opacity: 1, transform: "none" }], B.subAt, B.subDur);
    }

    this._run(t, [{ opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: `blur(${BEATS.out.blur}px)` }],
      { delay: beat.outAt + shift, duration: Math.max(1, beat.outDur), easing: this._ease("exit") }, clock);
  }

  _buildTitle(layout, text, face) {
    const t = this.$.title;
    t.replaceChildren();
    const parts = { name: null, eyebrow: null, sub: null, rules: [], underline: null, pieces: [] };
    if (text.eyebrow && layout !== "credits") {
      parts.eyebrow = el("div", "glth-title__eyebrow", text.eyebrow);
      setVoice(parts.eyebrow, face.secondary);
    }
    if (text.title) {
      parts.name = el("div", "glth-title__name");
      setVoice(parts.name, face);
      if (layout === "credits") {
        for (const ch of [...text.title]) {
          const p = el("span", "glth-title__piece", ch === " " ? " " : ch);
          parts.pieces.push(p);
          parts.name.append(p);
        }
      } else if (layout === "wipe") {
        text.title.split(/\s+/).filter(Boolean).forEach((w, i) => {
          if (i) parts.name.append(document.createTextNode(" "));
          const mask = el("span", "glth-title__mask");
          const word = el("span", "glth-title__piece", w);
          mask.append(word);
          parts.pieces.push(word);
          parts.name.append(mask);
        });
      } else parts.name.textContent = text.title;
    }
    if (text.subtitle) {
      parts.sub = el("div", "glth-title__sub", text.subtitle);
      setVoice(parts.sub, face.secondary);
    }
    if (layout === "centre") {
      parts.rules = [el("div", "glth-title__rule"), el("div", "glth-title__rule")];
      t.append(...[parts.eyebrow, parts.rules[0], parts.name, parts.rules[1], parts.sub].filter(Boolean));
    } else if (layout === "chapter") {
      if (parts.name) parts.underline = el("div", "glth-title__underline");
      t.append(...[parts.eyebrow, parts.name, parts.underline, parts.sub].filter(Boolean));
    } else {
      t.append(...[parts.eyebrow, parts.name, parts.sub].filter(Boolean));
    }
    return parts;
  }

  /** Shrink a title that would set wider than BEATS.fitWidth of the viewport (measured at its resting tracking). */
  _fit(name, face) {
    if (!name) return;
    name.style.fontSize = "";
    const max = (this.node.clientWidth || window.innerWidth) * BEATS.fitWidth;
    name.style.letterSpacing = face.track;
    const w = name.scrollWidth;
    if (w > max && w > 0) {
      const px = parseFloat(getComputedStyle(name).fontSize) || 0;
      if (px) name.style.fontSize = `${Math.floor(px * (max / w))}px`;
    }
  }

  _playCard(text, beat, clock, k) {
    const c = this.$.card;
    const face = resolveFace(CARD_FACE).secondary;
    c.replaceChildren(el("div", "glth-card__text", text));
    const inner = c.firstChild;
    setVoice(inner, face);
    if (!text) return;
    const B = BEATS.card;
    this._run(inner, [
      { opacity: 0, letterSpacing: em(B.trackFrom), filter: `blur(${B.blur}px)` },
      { opacity: 1, letterSpacing: face.track, filter: "blur(0px)" },
    ], { delay: beat.at, duration: Math.max(1, beat.arrive), easing: this._ease("ease") }, clock);
    this._run(inner, [{ opacity: 1 }, { opacity: 0 }], { delay: beat.outAt, duration: Math.max(1, beat.outDur), easing: this._ease("exit") }, clock);
  }

  _hideTag(clock) {
    const tag = this.$.tag;
    const from = this._opacity(tag);
    this._cancel((a) => a.el === tag, true);
    if (from > 0) this._run(tag, [{ opacity: from }, { opacity: 0 }], { duration: BEATS.tag.outDur * this._k, easing: this._ease("exit"), fill: "forwards" }, clock);
    else tag.style.opacity = "0";
  }

  _showTag(at, clock, k, instant = false) {
    const tag = this.$.tag;
    if (!this._tagText) { tag.textContent = ""; return; }
    tag.textContent = this._tagText;
    if (instant) { this._cancel((a) => a.el === tag, false); tag.style.opacity = "1"; tag.style.transform = "none"; return; }
    this._run(tag, [{ opacity: 0, transform: `translateX(${-BEATS.tag.slide}px)` }, { opacity: 1, transform: "none" }],
      { delay: at, duration: BEATS.tag.inDur * k, easing: this._ease("ease"), fill: "forwards" }, clock);
  }

  /** End state, nothing animated (late joiner / stale cue). */
  _settle(kind, tl, cue) {
    const blackEnd = tl.black?.length ? tl.black[tl.black.length - 1].to : 0;
    const b = this.$.black;
    if (kind === "shot" || kind === "card") { b.style.opacity = String(blackEnd); this._black = blackEnd; }
    if (kind === "shot") {
      const lists = this._barLists(tl, cue.letterbox);
      const end = (l) => (l.length ? l[l.length - 1].to : this._letterbox);
      this.$.barTop.style.transform = `scaleY(${end(lists.top) / BAR_SPAN})`;
      this.$.barBottom.style.transform = `scaleY(${end(lists.bottom) / BAR_SPAN})`;
      this._letterbox = end(lists.top);
      this.node.style.setProperty("--glth-lb", String(this._letterbox));
    }
    for (const s of Object.values(this.$.scrims)) s.style.opacity = "0";
    this._showTag(0, { startAt: now() }, this._k, true);
  }

  /** Static state after a cue, used on mount. */
  _applyRest() {
    this.node.style.setProperty("--glth-lb", String(this._letterbox));
    this.$.black.style.opacity = String(this._black);
    for (const s of Object.values(this.$.scrims)) s.style.opacity = "0";
    this.$.tag.style.opacity = "0";
    this.$.title.style.opacity = "0";
  }

  _clearTitleDom() {
    this.$.title.replaceChildren();
    this.$.title.style.opacity = "0";
    this.$.title.className = "glth-title";
    this.$.card.replaceChildren();
    for (const s of Object.values(this.$.scrims)) s.style.opacity = "0";
  }

  /* ── animation plumbing ────────────────────────────────────────────── */

  /**
   * One animation on the cue clock. `fill` follows the rule in the header
   * unless the caller pins it.
   * @param {object|{startAt:number}} clock  cue clock, or { cue:false } for a free-standing animation that starts now
   */
  _run(node, frames, options, clock) {
    const props = [...new Set(frames.flatMap((f) => Object.keys(f)).filter((p) => p !== "offset" && p !== "easing"))];
    let seen = this._seen.get(node);
    if (!seen) this._seen.set(node, (seen = new Set()));
    const fill = options.fill ?? (props.some((p) => seen.has(p)) ? "forwards" : "both");
    props.forEach((p) => seen.add(p));
    const anim = node.animate(frames, { fill, ...options, delay: options.delay ?? 0 });
    // Anchor to the cue on performance.now(), never via document.timeline: a
    // hidden tab's timeline is stale (it only advances on rendered frames), so
    // `startTime = timeline + offset` jumps a backgrounded player's cue ahead by
    // however long the tab has been hidden. `_resync` re-anchors on return.
    const startAt = clock?.startAt;
    if (Number.isFinite(startAt)) anim.currentTime = now() - startAt;
    if (this._frozen) anim.pause();
    this._anims.push({ anim, el: node, props, cue: clock?.cue !== false, startAt: Number.isFinite(startAt) ? startAt : now() });
    return anim;
  }

  /**
   * Cancel animations matching `pred`. With `commit`, the element keeps the
   * value it was showing (so the next cue starts from where this one left it).
   */
  _cancel(pred, commit) {
    const keep = [];
    const hit = [];
    for (const a of this._anims) (pred(a) ? hit : keep).push(a);
    if (commit) {
      // Commit in creation order so the topmost (latest) animation's value wins.
      for (const a of hit) {
        if (!a.el.isConnected) continue;
        try { a.anim.commitStyles(); } catch { /* not rendered */ }
      }
    }
    for (const a of hit) a.anim.cancel();
    this._anims = keep;
    for (const a of hit) this._seen.get(a.el)?.clear();
  }

  /** Put every running animation back on its cue's clock (after the tab was hidden). */
  _resync() {
    if (this._frozen) return;
    const t = now();
    for (const a of this._anims) {
      try { a.anim.currentTime = t - a.startAt; } catch { /* cancelled */ }
    }
  }

  _opacity(node) {
    const v = parseFloat(getComputedStyle(node).opacity);
    return Number.isFinite(v) ? v : 0;
  }

  _barValue(bar) {
    try {
      const m = new DOMMatrixReadOnly(getComputedStyle(bar).transform);
      return Math.max(0, m.d) * BAR_SPAN;
    } catch { return this._letterbox; }
  }

  /** An easing token from gl-tokens.css, read live (so a retheme reaches it). */
  _ease(kind) {
    const name = { ease: "--gl-ease", exit: "--gl-exit", sharp: "--gl-ease-sharp", inout: "--gl-ease-inout" }[kind] ?? "--gl-ease";
    const v = getComputedStyle(this.node ?? document.documentElement).getPropertyValue(name).trim();
    return v || (kind === "exit" ? "ease-in" : "ease-out");
  }
}

/** Value of a segment list at `ms` — re-exported so callers inspecting the overlay need one import. */
export { segmentValue };
