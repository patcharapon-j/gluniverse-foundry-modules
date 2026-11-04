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
  perilStage: 4200,       // the Dire Peril splash, declare to unmount; every CSS beat is a share of it
  perilFade: 300,         // the stage's own fade, ending exactly at perilStage
  perilFieldFade: 600,    // the WebGL field starts its CSS fade this long before the stage ends
  perilFieldTail: 50,     // and its loop stops this long after
  tickFrom: 5,            // countdown ticks in its last N seconds (seconds, not ms)
  urgentFrom: 10,         // countdown turns urgent in its last N seconds (seconds)
  nudgeCooldown: 2500,    // a GM cannot knock on one player faster than this
  extend: 30000,          // "+30s" on a running countdown
  tickerPerChar: 210,     // running text speed: one character's travel
  tickerMin: 9000,        // and the shortest loop it may take
  tickerFill: 90          // a ticker repeats its phrases until one copy is this many characters
});

/**
 * Every animation length in the band and the Dire Peril title, in ms at
 * motion scale 1. They pass through motionDuration() on use; nothing in
 * band.js writes a literal. The rest of the splash is CSS keyframes laid out
 * as shares of TIMING.perilStage.
 */
export const MOTION = Object.freeze({
  laneIn: 540,        // the lead's tag slides in behind its wipe
  flareSweep: 900,    // the light that crosses a lane on a flare
  flarePulse: 420,
  laneOut: 260,
  slot: 380,          // a lane opening or closing its slot in the stack
  aura: 1400,         // the aura's flare behind the band
  // the lead: it arrives as one hard wipe with its light riding the edge; a
  // queue row only slides in
  leadWipe: 420,
  leadRise: 460,      // the headline rises out of the wipe
  leadRiseDelay: 120,
  queueIn: 320,
  promote: 420,       // a queue row that becomes the lead
  knock: 280,         // the clock's knock, once a second in its last seconds
  hit: 480,           // time up: the lead takes the hit
  lockIn: 560,        // everyone answered: the faces lock in one after another
  lockInStagger: 70,
  countKnock: 320,    // a tally that moves (2/4 to 3/4)
  // the Dire Peril title: one authored rhythm, whatever the words' lengths
  perilLine1At: 820,       // "Dire" starts landing
  perilLine2At: 1220,      // "Peril" starts landing
  perilLetter: 380,        // one letter's slide out of blur
  perilLetterStagger: 45,  // the gap between letters,
  perilLetterSpread: 420   // squeezed so a long word lands within this
});

/**
 * The Dire Peril field (the WebGL backdrop behind the splash), in seconds of
 * its own clock. The shader's second slam ring is pinned to the title's impact
 * inside the FRAG source; these are the envelope the JS drives.
 */
export const PERIL_FIELD = Object.freeze({
  burst: 0.9,          // the impact ring crosses the screen in this long
  burstMax: 1.2,       // and is pushed off screen past it
  intensityFloor: 0.45, // the sustained energy after the spike
  intensityDecay: 2.2  // how fast the spike falls to it
});

/** The field sheds before anything else: without it the splash is its CSS alone. */
export const SHED_ORDER = Object.freeze(['perilField']);

/** Marks are drawn as pips up to this many, then as a number. */
export const PIP_CAP = 5;
