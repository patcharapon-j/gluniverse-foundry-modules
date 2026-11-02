// Stream Pacer — constants. Pure: no Foundry globals, safe to import under Node.

export const FEATURE_ID = 'stream-pacer';
export const MODULE_ID = 'gluniverse-foundry-modules';

/**
 * A player's public pacing state lives on their own User document under this
 * flag. The key is deliberately undotted: Foundry disagrees with itself about
 * the shape a dotted flag key takes in an update diff (see docs/STREAM.md), and
 * every read here goes back to the document anyway.
 */
export const FLAG = 'spPacer';

/** What a player is telling the table, at any time. */
export const STATUS = Object.freeze({
  ENGAGED: 'engaged',
  HAND: 'hand',
  HOLD: 'hold'
});

/** What the GM is asking of the table. One at a time. */
export const CALL = Object.freeze({
  WRAP: 'wrap',
  COUNTDOWN: 'countdown',
  READY: 'ready'
});

/** The room's mood. One at a time, independent of the call. */
export const MOOD = Object.freeze({
  CAMPFIRE: 'campfire',
  PERIL: 'peril'
});

/** A player's answer to a ready check. */
export const ANSWER = Object.freeze({
  READY: 'ready',
  WAIT: 'wait'
});

/** The traffic light. Green is "I'm fine" and is the resting state. */
export const LIGHT = Object.freeze({
  GREEN: 'green',
  YELLOW: 'yellow',
  RED: 'red'
});
export const LIGHT_RANK = Object.freeze({ green: 0, yellow: 1, red: 2 });

/**
 * How far a call reached one player. Ordered from worst to best, which is the
 * order the GM's "who missed it" read wants.
 */
export const REACH = Object.freeze({
  OFFLINE: 'offline',
  AWAY: 'away',
  IDLE: 'idle',
  HERE: 'here',
  SEEN: 'seen',
  ACK: 'ack'
});

/** Window presence, as each client reports it. */
export const PRESENCE = Object.freeze({
  HERE: 'here',   // visible and focused
  IDLE: 'idle',   // visible, another window focused
  AWAY: 'away'    // tab hidden or window minimised
});

/**
 * Every cue the feature can play, mapped to its file in assets/stream-pacer/.
 * Sources (Boombox Studio) and loudness are recorded in docs/STREAM_PACER.md.
 */
export const SOUNDS = Object.freeze({
  hand: 'hand.ogg',
  wrap: 'wrap.ogg',
  countdown: 'countdown.ogg',
  tick: 'tick.ogg',
  timeup: 'timeup.ogg',
  ready: 'ready.ogg',
  allready: 'allready.ogg',
  campfire: 'campfire.ogg',
  peril: 'peril.ogg',
  nudge: 'nudge.ogg',
  checkin: 'checkin.ogg',
  yellow: 'yellow.ogg',
  red: 'red.ogg'
});

/** Every lane kind the band can draw, in priority order (top first). */
export const LANE_ORDER = Object.freeze([
  'safety', 'checkin', 'peril', 'call', 'hands', 'mine', 'campfire'
]);

/** Lane tones. Each one is a scoped CSS class, `sp-tone-<tone>`. */
export const TONES = Object.freeze(['paper', 'amber', 'red', 'ember', 'green', 'steel']);

/** Countdown lengths the GM can start with one click, in seconds. */
export const COUNTDOWN_PRESETS = Object.freeze([60, 120, 300]);

/** Every wait in the feature, in ms. Nothing else in the feature writes one. */
export const TIMING = Object.freeze({
  seenDwell: 1200,        // a call on a visible, focused screen this long counts as seen
  handCooldown: 3000,     // one hand chime per player per window
  presenceDebounce: 400,  // presence reports coalesce
  titleFlash: 1100,       // document title alternation period
  lateQuiet: 20000,       // a call older than this when we load arrives without a sound
  perilHold: 2600,        // the Dire Peril splash, start to lift
  perilLift: 700,         // the lift itself
  tickFrom: 5,            // countdown ticks in its last N seconds (seconds, not ms)
  urgentFrom: 10,         // countdown turns urgent in its last N seconds (seconds)
  nudgeCooldown: 2500,    // a GM cannot knock on one player faster than this
  extend: 30000,          // "+30s" on a running countdown
  tickerPerChar: 210,     // running text speed: one character's travel
  tickerMin: 9000,        // and the shortest loop it may take
  tickerFill: 90          // a ticker repeats its phrases until one copy is this many characters
});

/**
 * Every animation length in the band and the splash, in ms at motion scale 1.
 * They pass through motionDuration() on use; nothing in band.js writes a literal.
 */
export const MOTION = Object.freeze({
  laneIn: 540,        // a lane drops in
  laneWipe: 620,      // and wipes open along the cut
  laneTagDelay: 60,
  sweep: 1100,        // the light that crosses a new lane once
  sweepDelay: 180,
  flareSweep: 900,    // the same light, on a flare
  flarePulse: 420,
  laneOut: 260,
  aura: 1400,         // the aura's flare behind the band
  perilVeil: 420,
  perilCut: 520,
  perilCutDelay: 160,
  perilChar: 620,
  perilCharDelay: 260,
  perilCharStagger: 38,
  perilSub: 520,
  perilSubDelay: 900
});

/** Marks are drawn as pips up to this many, then as a number. */
export const PIP_CAP = 5;
