// Stream Pacer — the pure model.
//
// Everything a screen shows is decided here, from one snapshot of the world, and
// nothing here reads the world: no `game`, `canvas`, `foundry`, `ui` or `Hooks`.
// That is what lets the preview page and tools/stream-pacer-check.mjs drive the
// exact code that ships. The controller builds the snapshot; render.js turns the
// result into markup.
//
// Text leaves this module as i18n references ({ k, d }), never as strings, so the
// check tool can prove every key a lane can produce exists.

import {
  STATUS, CALL, MOOD, ANSWER, LIGHT, LIGHT_RANK, REACH, PRESENCE,
  LANE_ORDER, TIMING, PIP_CAP
} from './const.js';

const T = (k, d) => (d ? { k, d } : { k });
const P = 'STREAM_PACER.';

/* ── Normalizers: every stored value comes back through one of these ───── */

const str = (v) => (typeof v === 'string' && v ? v : null);
const num = (v) => (Number.isFinite(v) ? v : null);

/** A player's flag, whatever shape it was stored in. */
export function normalizePlayer(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const status = Object.values(STATUS).includes(r.status) ? r.status : STATUS.ENGAGED;
  const seen = r.seen && str(r.seen.call) ? { call: r.seen.call, ack: r.seen.ack === true } : null;
  const answer = r.answer && str(r.answer.call) && Object.values(ANSWER).includes(r.answer.value)
    ? { call: r.answer.call, value: r.answer.value }
    : null;
  return {
    status,
    at: status === STATUS.ENGAGED ? null : num(r.at) ?? 0,
    seen,
    answer
  };
}

/** The GM's current call, or null. */
export function normalizeCall(raw) {
  if (!raw || typeof raw !== 'object' || !str(raw.id)) return null;
  if (!Object.values(CALL).includes(raw.kind)) return null;
  const targets = Array.isArray(raw.targets) ? raw.targets.filter(str) : null;
  return {
    id: raw.id,
    kind: raw.kind,
    at: num(raw.at) ?? 0,
    ends: raw.kind === CALL.COUNTDOWN ? num(raw.ends) : null,
    targets: targets && targets.length ? targets : null
  };
}

/** The room's mood, or null. */
export function normalizeMood(raw) {
  if (!raw || typeof raw !== 'object' || !str(raw.id)) return null;
  if (!Object.values(MOOD).includes(raw.kind)) return null;
  return { id: raw.id, kind: raw.kind, at: num(raw.at) ?? 0 };
}

/** Spotlight marks: whole, non-negative counts per user id. */
export function normalizeSpotlight(raw) {
  const marks = {};
  const src = raw && typeof raw === 'object' && raw.marks && typeof raw.marks === 'object' ? raw.marks : {};
  for (const [id, n] of Object.entries(src)) {
    const v = Math.max(0, Math.floor(Number(n) || 0));
    if (v) marks[id] = v;
  }
  return { marks };
}

/** Normalize a whole snapshot in place of its raw parts. */
export function normalizeSnapshot(s) {
  const users = (s.users ?? []).map((u) => ({
    id: u.id,
    name: u.name ?? '?',
    color: u.color ?? null,
    isGM: !!u.isGM,
    active: !!u.active,
    exempt: { bars: !!u.exempt?.bars, peril: !!u.exempt?.peril, safety: !!u.exempt?.safety },
    pacer: normalizePlayer(u.pacer)
  }));
  const safety = s.safety ?? {};
  return {
    now: s.now ?? 0,
    me: { id: s.me?.id ?? null, isGM: !!s.me?.isGM },
    users,
    call: normalizeCall(s.call),
    mood: normalizeMood(s.mood),
    spotlight: normalizeSpotlight(s.spotlight),
    presence: s.presence ?? {},
    safety: {
      show: !!safety.show,
      lights: safety.lights ?? {},
      ask: safety.ask && str(safety.ask.id) ? { id: safety.ask.id, at: num(safety.ask.at) ?? 0 } : null,
      mine: Object.values(LIGHT).includes(safety.mine) ? safety.mine : LIGHT.GREEN,
      answered: !!safety.answered,
      seen: safety.seen ?? null
    },
    text: { perilTag: s.text?.perilTag ?? '', perilSubtitle: s.text?.perilSubtitle ?? '' }
  };
}

/* ── Who counts ─────────────────────────────────────────────────────────── */

/** The people the pacer is about: players, never GMs, never a capture login. */
export const players = (s) => s.users.filter((u) => !u.isGM && !u.exempt.bars);
export const activePlayers = (s) => players(s).filter((u) => u.active);
export const userById = (s, id) => s.users.find((u) => u.id === id) ?? null;
export const meUser = (s) => userById(s, s.me.id);

/** Who a call is aimed at: its named targets, or every active player. */
export function callTargets(s) {
  if (!s.call) return [];
  const pool = players(s);
  if (!s.call.targets) return pool.filter((u) => u.active);
  return pool.filter((u) => s.call.targets.includes(u.id));
}

export const isTargeted = (s, id) => callTargets(s).some((u) => u.id === id);

/** Seconds left on a countdown, never negative; null for any other call. */
export function secondsLeft(call, now) {
  if (!call || call.kind !== CALL.COUNTDOWN || !Number.isFinite(call.ends)) return null;
  return Math.max(0, Math.ceil((call.ends - now) / 1000));
}

/** "m:ss". */
export function clockText(seconds) {
  const v = Math.max(0, Math.floor(seconds ?? 0));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

/** How far the current call reached one player. */
export function reachOf(s, user) {
  if (!user.active) return REACH.OFFLINE;
  // an answer to this call is proof it arrived, whatever the seen flag says
  if (s.call && user.pacer.answer?.call === s.call.id) return REACH.ACK;
  if (s.call && user.pacer.seen?.call === s.call.id) return user.pacer.seen.ack ? REACH.ACK : REACH.SEEN;
  const p = s.presence[user.id];
  if (p === PRESENCE.AWAY) return REACH.AWAY;
  if (p === PRESENCE.IDLE) return REACH.IDLE;
  return REACH.HERE;
}
const reached = (r) => r === REACH.SEEN || r === REACH.ACK;

/** Active targets the call has not reached yet: the people a nudge is for. */
export function unseenTargets(s) {
  return callTargets(s).filter((u) => u.active && !reached(reachOf(s, u)));
}

/**
 * Hands in the order they went up. Only people who are here: a flag left up by
 * someone who disconnected stays stored and comes back with them, but the GM
 * cannot call on an empty chair.
 */
export function handQueue(s) {
  return activePlayers(s)
    .filter((u) => u.pacer.status === STATUS.HAND)
    .sort((a, b) => a.pacer.at - b.pacer.at || a.name.localeCompare(b.name));
}
export const holds = (s) => activePlayers(s).filter((u) => u.pacer.status === STATUS.HOLD);

/** The ready check's tally over the people it was asked of. */
export function readyTally(s) {
  const out = { ready: [], wait: [], silent: [], total: 0, all: false };
  if (!s.call || s.call.kind !== CALL.READY) return out;
  for (const u of callTargets(s)) {
    if (!u.active) continue;
    out.total++;
    const a = u.pacer.answer?.call === s.call.id ? u.pacer.answer.value : null;
    if (a === ANSWER.READY) out.ready.push(u);
    else if (a === ANSWER.WAIT) out.wait.push(u);
    else out.silent.push(u);
  }
  out.all = out.total > 0 && out.ready.length === out.total;
  return out;
}

/** Safety lights the GM board holds for people who may raise one. */
export function raisedLights(s) {
  if (!s.me.isGM || !s.safety.show) return [];
  const out = [];
  for (const u of players(s)) {
    if (u.exempt.safety) continue;
    const l = s.safety.lights[u.id]?.light;
    if (LIGHT_RANK[l] > 0) out.push({ user: u, light: l });
  }
  return out.sort((a, b) => LIGHT_RANK[b.light] - LIGHT_RANK[a.light] || a.user.name.localeCompare(b.user.name));
}

/** The check-in roster: everyone who may answer, and what they said. */
export function checkinRoster(s) {
  const rows = [];
  for (const u of activePlayers(s)) {
    if (u.exempt.safety) continue;
    const l = s.safety.lights[u.id];
    rows.push({ user: u, light: l?.ask === s.safety.ask?.id ? l.light : null });
  }
  return { rows, answered: rows.filter((r) => r.light).length, total: rows.length };
}

const person = (u, state) => ({ id: u.id, name: u.name, color: u.color, initial: initialOf(u.name), state });
export function initialOf(name) {
  const t = String(name ?? '').trim();
  if (!t) return '?';
  const [ch] = Array.from(t);
  return ch.toLocaleUpperCase();
}
const names = (list) => list.map((u) => u.name).join(', ');

/* ── The band: one lane per thing the table needs to know right now ───── */

/**
 * Lanes for this viewer, highest priority first. Each lane:
 *   key     stable identity (a new key is an arrival)
 *   stamp   changes when the same lane should flare again (a new hand, a nudge)
 *   kind, tone, icon, label, title, ticker (running text), clock, count,
 *   people, actions, urgent (aura pulses), calm (aura rests, ticker slows)
 */
export function lanes(raw) {
  const s = normalizeSnapshot(raw);   // idempotent, so a normalized snapshot passes through unchanged
  const me = meUser(s);
  if (!me || me.exempt.bars) return [];
  const out = [];
  const gm = s.me.isGM;

  /* safety — the GM's board, and the player's private check-in */
  if (gm && s.safety.show) {
    const raised = raisedLights(s);
    if (raised.length) {
      const red = raised.some((r) => r.light === LIGHT.RED);
      const sig = raised.map((r) => `${r.user.id}:${r.light}`).join('|');
      const acknowledged = s.safety.seen === sig;
      out.push({
        key: 'safety', stamp: sig, kind: 'safety', tone: red ? 'red' : 'amber', icon: 'fa-solid fa-traffic-light',
        label: T(P + 'Band.Safety'),
        title: T(P + 'Band.SafetyTitle', { names: names(raised.map((r) => r.user)) }),
        ticker: raised.map((r) => T(P + `Band.SafetyLight.${r.light}`, { name: r.user.name })),
        clock: null, count: null,
        people: raised.map((r) => person(r.user, r.light)),
        actions: acknowledged ? [] : [{ id: 'safety-seen', k: P + 'Action.SafetySeen', icon: 'fa-solid fa-eye', style: 'primary' }],
        urgent: red && !acknowledged, calm: acknowledged
      });
    }
    if (s.safety.ask) {
      const roster = checkinRoster(s);
      out.push({
        key: `checkin:${s.safety.ask.id}`, stamp: '', kind: 'checkin', tone: 'paper', icon: 'fa-solid fa-hand-holding-heart',
        label: T(P + 'Band.CheckIn'),
        title: T(P + 'Band.CheckInGM'),
        ticker: [T(P + 'Band.CheckInGMTicker')],
        clock: null,
        count: T(P + 'Band.Answered', { n: roster.answered, total: roster.total }),
        people: roster.rows.map((r) => person(r.user, r.light ?? 'pending')),
        actions: [{ id: 'end-ask', k: P + 'Action.EndCheckIn', icon: 'fa-solid fa-xmark', style: 'ghost' }],
        urgent: false, calm: roster.answered === roster.total && roster.total > 0
      });
    }
  } else if (!gm && s.safety.show && s.safety.ask && !s.safety.answered) {
    out.push({
      key: `checkin:${s.safety.ask.id}`, stamp: '', kind: 'checkin', tone: 'paper', icon: 'fa-solid fa-hand-holding-heart',
      label: T(P + 'Band.CheckIn'),
      title: T(P + 'Band.CheckInPlayer'),
      ticker: [T(P + 'Band.CheckInPlayerTicker')],
      clock: null, count: null, people: [],
      actions: [LIGHT.GREEN, LIGHT.YELLOW, LIGHT.RED].map((light) => ({
        id: 'light', light, k: P + `Light.${light}`, icon: 'fa-solid fa-circle', style: 'lamp', pressed: s.safety.mine === light
      })),
      urgent: false, calm: false
    });
  }

  /* peril */
  if (s.mood?.kind === MOOD.PERIL && !me.exempt.peril) {
    out.push({
      key: `peril:${s.mood.id}`, stamp: '', kind: 'peril', tone: 'red', icon: 'fa-solid fa-skull',
      label: T(P + 'Band.Peril'),
      title: s.text.perilTag ? { raw: s.text.perilTag } : T(P + 'Peril.Tag'),
      ticker: [s.text.perilSubtitle ? { raw: s.text.perilSubtitle } : T(P + 'Peril.Subtitle'), T(P + 'Band.PerilTicker')],
      clock: null, count: null, people: [],
      actions: gm ? [{ id: 'end-mood', k: P + 'Action.EndPeril', icon: 'fa-solid fa-xmark', style: 'ghost' }] : [],
      urgent: false, calm: false
    });
  }

  /* the GM's call */
  if (s.call) out.push(callLane(s, me));

  /* hands */
  if (gm) {
    const queue = handQueue(s);
    const waiting = holds(s);
    if (queue.length) {
      const first = queue[0];
      out.push({
        key: 'hands', stamp: String(Math.max(...queue.map((u) => u.pacer.at))), kind: 'hands', tone: 'paper', icon: 'fa-solid fa-hand',
        label: queue.length > 1 ? T(P + 'Band.HandsMany', { n: queue.length }) : T(P + 'Band.HandsOne'),
        title: T(P + 'Band.HandsTitle', { name: first.name }),
        ticker: [
          ...queue.map((u, i) => T(P + 'Band.HandsQueue', { n: i + 1, name: u.name })),
          ...waiting.map((u) => T(P + 'Band.HoldOne', { name: u.name }))
        ],
        clock: null, count: null,
        people: queue.map((u) => person(u, 'hand')).concat(waiting.map((u) => person(u, 'hold'))),
        actions: [
          { id: 'call-on', user: first.id, k: P + 'Action.CallOn', d: { name: first.name }, icon: 'fa-solid fa-microphone', style: 'primary' },
          ...(queue.length > 1 ? [{ id: 'lower-all', k: P + 'Action.LowerAll', icon: 'fa-solid fa-hand-point-down', style: 'ghost' }] : [])
        ],
        urgent: false, calm: false
      });
    } else if (waiting.length) {
      out.push({
        key: 'hands', stamp: '', kind: 'hands', tone: 'steel', icon: 'fa-solid fa-hourglass-half',
        label: T(P + 'Band.Hold'),
        title: T(P + 'Band.HoldTitle', { names: names(waiting) }),
        ticker: waiting.map((u) => T(P + 'Band.HoldOne', { name: u.name })),
        clock: null, count: null,
        people: waiting.map((u) => person(u, 'hold')),
        actions: [{ id: 'clear-holds', k: P + 'Action.ClearHolds', icon: 'fa-solid fa-check', style: 'ghost' }],
        urgent: false, calm: true
      });
    }
  } else if (me.pacer.status !== STATUS.ENGAGED) {
    const pos = handQueue(s).findIndex((u) => u.id === me.id) + 1;
    const hand = me.pacer.status === STATUS.HAND;
    out.push({
      key: `mine:${me.pacer.status}`, stamp: '', kind: 'mine', tone: hand ? 'paper' : 'steel',
      icon: hand ? 'fa-solid fa-hand' : 'fa-solid fa-hourglass-half',
      label: T(P + (hand ? 'Band.MyHand' : 'Band.MyHold')),
      title: hand ? T(P + 'Band.MyHandTitle', { n: Math.max(1, pos) }) : T(P + 'Band.MyHoldTitle'),
      ticker: [T(P + (hand ? 'Band.MyHandTicker' : 'Band.MyHoldTicker'))],
      clock: null, count: null, people: [],
      actions: [{ id: 'status', status: STATUS.ENGAGED, k: P + (hand ? 'Action.Lower' : 'Action.ImGood'), icon: 'fa-solid fa-check', style: 'ghost' }],
      urgent: false, calm: true
    });
  }

  /* campfire */
  if (s.mood?.kind === MOOD.CAMPFIRE) {
    out.push({
      key: `campfire:${s.mood.id}`, stamp: '', kind: 'campfire', tone: 'ember', icon: 'fa-solid fa-fire',
      label: T(P + 'Band.Campfire'),
      title: T(P + 'Band.CampfireTitle'),
      ticker: [T(P + 'Band.CampfireTicker'), T(P + 'Band.CampfireTicker2')],
      clock: null, count: null, people: [],
      actions: gm ? [{ id: 'end-mood', k: P + 'Action.EndCampfire', icon: 'fa-solid fa-xmark', style: 'ghost' }] : [],
      urgent: false, calm: true
    });
  }

  return out.sort((a, b) => LANE_ORDER.indexOf(a.kind) - LANE_ORDER.indexOf(b.kind));
}

function callLane(s, me) {
  const c = s.call;
  const gm = s.me.isGM;
  const targets = callTargets(s);
  const mine = !gm && targets.some((u) => u.id === me.id);
  const left = secondsLeft(c, s.now);
  const expired = c.kind === CALL.COUNTDOWN && left === 0;
  const urgentClock = c.kind === CALL.COUNTDOWN && left !== null && left <= TIMING.urgentFrom;
  const myReach = mine ? reachOf(s, me) : null;
  const acked = myReach === REACH.ACK;
  const named = c.targets ? names(targets) : null;

  const lane = {
    key: `call:${c.id}`, stamp: '', kind: 'call', call: c.kind,
    tone: 'amber', icon: 'fa-solid fa-flag-checkered',
    label: T(P + `Band.Call.${c.kind}`),
    title: null, ticker: [], clock: null, count: null, people: [], actions: [],
    urgent: false, calm: false
  };

  if (c.kind === CALL.WRAP) {
    lane.title = named ? T(P + 'Band.WrapNamed', { names: named }) : T(P + 'Band.WrapTitle');
    lane.ticker = [T(P + 'Band.WrapTicker'), T(P + 'Band.WrapTicker2')];
  } else if (c.kind === CALL.COUNTDOWN) {
    lane.icon = 'fa-solid fa-stopwatch';
    lane.clock = { ends: c.ends, at: c.at };
    lane.title = expired ? T(P + 'Band.TimeUp') : (named ? T(P + 'Band.CountdownNamed', { names: named }) : T(P + 'Band.CountdownTitle'));
    lane.ticker = expired ? [T(P + 'Band.TimeUpTicker')] : [T(P + 'Band.CountdownTicker'), T(P + 'Band.WrapTicker2')];
    if (expired) { lane.label = T(P + 'Band.Time'); lane.tone = 'red'; }
    else if (urgentClock) lane.tone = 'red';
    lane.urgent = urgentClock || expired;
  } else if (c.kind === CALL.READY) {
    const tally = readyTally(s);
    lane.tone = tally.all ? 'green' : 'paper';
    lane.icon = tally.all ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-question';
    if (tally.all) lane.label = T(P + 'Band.AllReady');
    lane.title = T(P + (tally.all ? 'Band.AllReadyTitle' : 'Band.ReadyTitle'));
    lane.ticker = tally.all ? [T(P + 'Band.AllReadyTicker')] : [T(P + 'Band.ReadyTicker')];
    lane.count = T(P + 'Band.ReadyCount', { n: tally.ready.length, total: tally.total });
    if (gm) {
      lane.people = [
        ...tally.ready.map((u) => person(u, 'ready')),
        ...tally.wait.map((u) => person(u, 'wait')),
        ...tally.silent.map((u) => person(u, reachOf(s, u)))
      ];
      lane.actions = [tally.all
        ? { id: 'end-call', k: P + 'Action.MoveOn', icon: 'fa-solid fa-forward', style: 'primary' }
        : { id: 'end-call', k: P + 'Action.EndCall', icon: 'fa-solid fa-xmark', style: 'ghost' }];
      if (!tally.all && unseenTargets(s).length) lane.actions.unshift({ id: 'nudge-unseen', k: P + 'Action.NudgeUnseen', d: { n: unseenTargets(s).length }, icon: 'fa-solid fa-hand-back-fist', style: 'ghost' });
      lane.calm = tally.all;
    } else if (mine) {
      const a = me.pacer.answer?.call === c.id ? me.pacer.answer.value : null;
      lane.actions = [
        { id: 'answer', value: ANSWER.READY, k: P + 'Action.Ready', icon: 'fa-solid fa-check', style: 'primary', pressed: a === ANSWER.READY },
        { id: 'answer', value: ANSWER.WAIT, k: P + 'Action.NotYet', icon: 'fa-solid fa-hourglass-half', style: 'ghost', pressed: a === ANSWER.WAIT }
      ];
      lane.calm = a === ANSWER.READY || tally.all;
    } else {
      lane.calm = true;
    }
    return lane;
  }

  // wrap and countdown share their GM and player halves
  if (gm) {
    const unseen = unseenTargets(s);
    const reachedN = targets.filter((u) => reached(reachOf(s, u))).length;
    lane.people = targets.map((u) => person(u, reachOf(s, u)));
    lane.count = T(P + 'Band.Reached', { n: reachedN, total: targets.filter((u) => u.active).length });
    if (unseen.length) lane.actions.push({ id: 'nudge-unseen', k: P + 'Action.NudgeUnseen', d: { n: unseen.length }, icon: 'fa-solid fa-hand-back-fist', style: 'primary' });
    if (c.kind === CALL.COUNTDOWN && !expired) lane.actions.push({ id: 'extend', k: P + 'Action.Extend', icon: 'fa-solid fa-plus', style: 'ghost' });
    lane.actions.push({ id: 'end-call', k: P + (expired ? 'Action.Done' : 'Action.EndCall'), icon: 'fa-solid fa-xmark', style: 'ghost' });
  } else if (mine) {
    if (!acked) lane.actions.push({ id: 'ack', k: P + 'Action.GotIt', icon: 'fa-solid fa-check', style: 'primary' });
    lane.calm = acked && !lane.urgent;
  } else {
    // the table can see who was asked, quietly
    lane.tone = lane.urgent ? lane.tone : 'steel';
    lane.calm = true;
  }
  return lane;
}

/* ── The HUD ────────────────────────────────────────────────────────────── */

/** View model for the HUD. `opts` carries client-only preferences. */
export function hudModel(raw, opts = {}) {
  const s = normalizeSnapshot(raw);
  const me = meUser(s);
  const base = {
    gm: s.me.isGM,
    collapsed: !!opts.collapsed,
    showSafety: s.safety.show,
    sound: opts.sound !== false,
    desktop: opts.desktop ?? 'unsupported'
  };
  if (!me) return { ...base, rows: [] };

  if (!s.me.isGM) {
    return {
      ...base,
      status: me.pacer.status,
      light: s.safety.mine,
      handPos: handQueue(s).findIndex((u) => u.id === me.id) + 1
    };
  }

  const queue = handQueue(s);
  const marks = s.spotlight.marks;
  const list = players(s).filter((u) => u.active || marks[u.id]);
  const counts = list.map((u) => marks[u.id] ?? 0);
  const max = counts.length ? Math.max(...counts) : 0;
  const min = counts.length ? Math.min(...counts) : 0;
  const rows = list
    .map((u) => {
      const n = marks[u.id] ?? 0;
      return {
        id: u.id,
        name: u.name,
        initial: initialOf(u.name),
        color: u.color,
        active: u.active,
        status: u.pacer.status,
        handPos: u.pacer.status === STATUS.HAND ? queue.findIndex((q) => q.id === u.id) + 1 : 0,
        presence: u.active ? (s.presence[u.id] ?? PRESENCE.HERE) : 'offline',
        reach: s.call && isTargeted(s, u.id) ? reachOf(s, u) : null,
        light: s.safety.show && !u.exempt.safety ? (s.safety.lights[u.id]?.light ?? null) : null,
        marks: n,
        pips: n <= PIP_CAP ? Array.from({ length: PIP_CAP }, (_, i) => i < n) : null,
        // the quiet one: at least two marks behind whoever has the most
        quiet: list.length > 1 && max - n >= 2 && n === min
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  return {
    ...base,
    rows,
    call: s.call ? { kind: s.call.kind } : null,
    mood: s.mood ? { kind: s.mood.kind } : null,
    ask: !!s.safety.ask,
    hands: queue.length,
    unseen: s.call ? unseenTargets(s).length : 0
  };
}

/* ── What changed: the controller's arrivals, decided here so they are testable ── */

/**
 * The cues a viewer should hear for a change from `prev` to `next` (both
 * normalized snapshots). `heard` is the set of ids this client has already
 * announced. Returns { sounds: [cue], notify: [{ k, d }], perilSplash, ids }.
 */
export function arrivals(prev, next, heard = new Set()) {
  const out = { sounds: [], notify: [], perilSplash: false, ids: [] };
  const me = meUser(next);
  if (!me) return out;
  const gm = next.me.isGM;
  const fresh = (id) => id && !heard.has(id);
  const quiet = (at) => next.now - at > TIMING.lateQuiet && !prev;

  // The mood first: a capture login hidden from the band may still show the
  // Dire Peril reveal (the two exemptions are separate on purpose).
  const m = next.mood;
  if (m && fresh(m.id)) {
    out.ids.push(m.id);
    const blocked = m.kind === MOOD.PERIL ? me.exempt.peril : me.exempt.bars;
    if (!blocked && !quiet(m.at)) {
      out.sounds.push(m.kind);
      if (m.kind === MOOD.PERIL) out.perilSplash = true;
      if (!gm && !me.exempt.bars) out.notify.push(T(P + `Notify.${m.kind}`));
    }
  }
  if (me.exempt.bars) return out;

  const c = next.call;
  if (c && fresh(c.id)) {
    out.ids.push(c.id);
    const aimed = !gm && isTargeted(next, me.id);
    if (aimed && !quiet(c.at)) {
      out.sounds.push(c.kind);
      out.notify.push(T(P + `Notify.${c.kind}`));
    }
  }

  if (!gm && next.safety.show && next.safety.ask && fresh(next.safety.ask.id)) {
    out.ids.push(next.safety.ask.id);
    out.sounds.push('checkin');
    out.notify.push(T(P + 'Notify.checkin'));
  }

  if (gm && prev) {
    // a hand that went up since the last snapshot
    for (const u of handQueue(next)) {
      const before = prev.users.find((p) => p.id === u.id)?.pacer;
      if (before?.status === STATUS.HAND && before.at === u.pacer.at) continue;
      out.sounds.push('hand');
      out.notify.push(T(P + 'Notify.hand', { name: u.name }));
      out.ids.push(`hand:${u.id}`);
    }
    // the ready check resolving
    const was = readyTally(prev);
    const now = readyTally(next);
    if (now.all && !(was.all && prev.call?.id === next.call?.id)) out.sounds.push('allready');
    // a safety light going up
    if (next.safety.show) {
      for (const r of raisedLights(next)) {
        const before = prev.safety.lights?.[r.user.id]?.light ?? LIGHT.GREEN;
        if (LIGHT_RANK[r.light] > LIGHT_RANK[before]) {
          out.sounds.push(r.light);
          out.notify.push(T(P + `Notify.${r.light}`, { name: r.user.name }));
        }
      }
    }
  }
  return out;
}
