/**
 * Theatre — the one statement of when everything in a transition happens.
 *
 * Pure. Three independent renderers play a cue — the PIXI shot layer (the
 * image), the DOM overlay (black, bars, title, card) and Stage (the character
 * relight) — and they only agree because they all read this. A beat moved here
 * moves everywhere; a beat restated anywhere else drifts.
 *
 * Every time is ms from the cue's start, at motion scale 1. Callers multiply by
 * the motion scale (`scaleTimeline`) — never a time here.
 *
 * Image modes (the shot layer):
 *   swap  — the incoming shot replaces the outgoing one instantly at `at` (hidden by black or bars)
 *   push  — incoming dissolves in from scale 1.14 with a brief soft bloom; outgoing eases back to 0.96
 *   wipe  — a soft diagonal edge sweeps the incoming shot across; outgoing dims to 0.55
 *   cut   — a 120ms crossfade, effectively a hard cut
 *   none  — the image does not change (interlude card)
 *
 * Segments are { at, dur, from, to } on a 0..1 value (black opacity, bar height
 * as a fraction of the frame height).
 */

import { TIMING } from "./constants.mjs";

const seg = (at, dur, from, to) => ({ at, dur, from, to });

/** How long the credits title takes to arrive, which depends on its length. */
export const CREDIT_LETTER_STAGGER = 48;

/**
 * @param {string} style            STYLES key
 * @param {object} [o]
 * @param {number} [o.hold]         title hold in ms (after the title has arrived)
 * @param {number} [o.letterbox]    the resting letterbox, 0..0.2 per bar
 * @param {number} [o.fromLetterbox] the letterbox before this cue (bars ease between them)
 * @param {number} [o.letters]      title length, for the credits stagger
 * @param {boolean} [o.title]       false when the shot has no title text (no title beats)
 */
export function timelineFor(style, { hold = TIMING.hold, letterbox = 0, fromLetterbox = letterbox, letters = 12, title = true } = {}) {
  const t = {
    style,
    image: { mode: "swap", at: 0, dur: 0 },
    black: [],
    bars: [seg(0, 900, fromLetterbox, letterbox)],
    relight: { at: 0, dur: 620 },
    title: null,
    card: null,
    total: 0,
  };

  switch (style) {
    case "chapter":
      t.image = { mode: "push", at: 0, dur: 1900 };
      t.relight = { at: 300, dur: 1300 };
      t.title = { at: 900, arrive: 1900 };
      break;
    case "credits": {
      const open = Math.max(letterbox, 0.11);
      t.image = { mode: "swap", at: 760, dur: 0 };
      t.bars = [seg(0, 700, fromLetterbox, 0.505), seg(1000, 1600, 0.505, open)];
      t.relight = { at: 720, dur: 240 };          // wholly inside the closed bars (700..1000)
      t.title = { at: 1700, arrive: 800 + Math.max(1, letters) * CREDIT_LETTER_STAGGER + 1000 };
      t.creditsBars = { top: open, bottom: Math.max(open, 0.15) };
      break;
    }
    case "wipe":
      t.image = { mode: "wipe", at: 0, dur: 1500 };
      t.relight = { at: 400, dur: 800 };
      t.title = { at: 1100, arrive: 1700 };
      break;
    case "cut":
      t.image = { mode: "cut", at: 0, dur: 120 };
      t.relight = { at: 0, dur: 120 };
      t.title = { at: 250, arrive: 2400 };
      break;
    case "interlude":
      t.image = { mode: "none", at: 0, dur: 0 };
      t.black = [seg(0, 900, 0, 1), seg(900 + 2200 + hold, 1400, 1, 0)];
      t.relight = { at: 920, dur: 240 };          // wholly inside full black (900..)
      t.card = { at: 700, arrive: 2200, outAt: 700 + 2200 + hold - 1000, outDur: 1200 };
      break;
    case "centre":
    default:
      t.image = { mode: "swap", at: 750, dur: 0 };
      t.black = [seg(0, 700, 0, 1), seg(1000, 1600, 1, 0)];
      t.relight = { at: 720, dur: 240 };          // wholly inside full black (700..1000)
      t.title = { at: 1500, arrive: 2400 };
      break;
  }

  if (t.title) {
    if (!title) t.title = null;
    else { t.title.outAt = t.title.at + t.title.arrive + hold; t.title.outDur = 1300; }
  }
  // Credits hand the bars back to the resting letterbox once the title has gone.
  if (style === "credits") {
    const back = (t.title?.outAt ?? 2600) + 400;
    t.bars.push(seg(back, 1200, t.creditsBars.top, letterbox));
  }

  const ends = [
    t.image.at + t.image.dur,
    t.relight.at + t.relight.dur,
    ...t.black.map((s) => s.at + s.dur),
    ...t.bars.map((s) => s.at + s.dur),
    t.title ? t.title.outAt + t.title.outDur : 0,
    t.card ? t.card.outAt + t.card.outDur : 0,
  ];
  t.total = Math.max(...ends);
  return t;
}

/**
 * Canvas mode (canvas-mode.mjs): every cut that changes the picture is a dip to
 * black, a canvas redraw of unknown length behind it, then a reveal. So a cue
 * there is TWO timelines, each played from its own start:
 *   dip    — from the cue's start: black rises; the relight lands wholly inside full black
 *   reveal — from the moment this client's canvas has redrawn: black lifts, the
 *            style's own title (and, for credits, its bars) plays
 */
export const CANVAS_BEATS = Object.freeze({
  dip: 700,          // black rises over this long
  lift: 1600,        // and lifts over this long once the canvas is ready
  titleAt: 500,      // the title starts this far into the reveal
});

/** @returns {{ dip: object, reveal: object }} the two halves, at motion scale 1 */
export function canvasTimelines(style, o = {}) {
  const base = timelineFor(style, o);
  const letterbox = o.letterbox ?? 0;
  const from = o.fromLetterbox ?? letterbox;
  const dip = {
    style,
    image: { mode: "none", at: 0, dur: 0 },
    black: [seg(0, CANVAS_BEATS.dip, 0, 1)],
    bars: [seg(0, CANVAS_BEATS.dip, from, from)],
    relight: { at: CANVAS_BEATS.dip + 20, dur: 240 },   // wholly inside full black (700..)
    title: null,
    card: null,
    total: CANVAS_BEATS.dip + 260,
  };
  const shift = base.title ? base.title.at - CANVAS_BEATS.titleAt : 0;
  const title = base.title ? { ...base.title, at: base.title.at - shift, outAt: base.title.outAt - shift } : null;
  let bars = [seg(0, 900, from, letterbox)];
  if (style === "credits") {
    const back = base.bars[base.bars.length - 1];
    bars = [seg(0, 900, from, base.creditsBars.top), { ...back, at: Math.max(900, back.at - shift) }];
  }
  const reveal = {
    ...base,
    image: { mode: "none", at: 0, dur: 0 },
    black: [seg(0, CANVAS_BEATS.lift, 1, 0)],
    bars,
    relight: { at: 0, dur: 0 },
    title,
    card: null,
  };
  reveal.total = Math.max(
    CANVAS_BEATS.lift,
    ...bars.map((g) => g.at + g.dur),
    title ? title.outAt + title.outDur : 0,
  );
  return { dip, reveal };
}

/** Multiply every time in a timeline by the motion scale. Returns a new object. */
export function scaleTimeline(t, k = 1) {
  if (k === 1) return t;
  const s = (x) => (typeof x === "number" ? x * k : x);
  const segs = (list) => list.map((g) => ({ ...g, at: s(g.at), dur: s(g.dur) }));
  const beat = (b) => (b ? Object.fromEntries(Object.entries(b).map(([key, v]) => [key, key === "mode" ? v : s(v)])) : b);
  return {
    ...t,
    image: beat(t.image),
    black: segs(t.black),
    bars: segs(t.bars),
    relight: beat(t.relight),
    title: beat(t.title),
    card: beat(t.card),
    total: s(t.total),
  };
}

/** The value of a segment list at time `ms` (the last segment that has started wins). */
export function segmentValue(list, ms, ease = (x) => x) {
  let v = null;
  for (const g of list) {
    if (ms < g.at) { if (v === null) v = g.from; break; }
    const p = g.dur > 0 ? Math.min(1, (ms - g.at) / g.dur) : 1;
    v = g.from + (g.to - g.from) * ease(p);
  }
  return v ?? (list[0]?.from ?? 0);
}
