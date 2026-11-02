// Stream Pacer — lifecycle and the controller.
//
// Where state lives, and why (docs/STREAM_PACER.md has the long version):
//
//   a player's status, hand order, "I saw it" and ready answer
//       → a flag on that player's own User document. Every client already has
//         every User, so a late joiner, a reload and a reset all converge on the
//         same truth with no socket message that could be missed.
//   the GM's call, the room's mood, spotlight marks
//       → world settings only a GM can write.
//   presence (is the window visible?), nudges, safety lights, check-ins
//       → the suite socket, attested by the server, with `recipients` so a light
//         only ever travels to a GM who may see it.
//
// Nothing runs at import time except definitions.

import { emitSocket, onSocket } from '../../core/socket.mjs';
import { registerQuickProvider } from '../../core/quick-palette.mjs';
import { matchesQuery } from '../../core/util.mjs';
import { MODULE_ID, FEATURE_ID, FLAG, STATUS, CALL, MOOD, LIGHT, TIMING, COUNTDOWN_PRESETS } from './const.js';
import {
  registerSettings, setRefresher, isBarsExempt, isPerilExempt, isSafetyExempt,
  captureLocalSafetyExemption
} from './settings.js';
import * as M from './model.js';
import { perilHTML } from './render.js';
import { SignalBand, playPerilSplash } from './band.js';
import { PacerHud } from './hud.js';
import { Reach, playCue, desktopState, toggleDesktop } from './alerts.js';
import { SafetyDesk } from './safety.js';

export { registerSettings };

const L = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const get = (key, fallback = null) => {
  try { return game.settings.get(MODULE_ID, key); } catch { return fallback; }
};
const now = () => game.time.serverTime;
const randomID = () => foundry.utils.randomID();
const HEARD_KEY = `${MODULE_ID}.sp.heard`;

let ctl = null;

/* ── lifecycle ──────────────────────────────────────────────────────────── */

export function onInit() {
  registerKeybindings();
  registerQuickProvider(QUICK_PROVIDER);

  // A reset belongs to a scene CHANGE: the GM activating a different scene.
  // The old feature reset on canvasReady, which also fires when a GM merely
  // views a scene, so a GM peeking at the next map wiped the table's hands.
  Hooks.on('updateScene', (scene, changes) => {
    if (changes?.active !== true || !ctl) return;
    if (game.users.activeGM?.id !== game.user.id) return;
    if (!get('sp.resetOnSceneChange', true)) return;
    ctl.resetTable({ keepMood: false });
  });

  Hooks.on('updateUser', (user, changes) => {
    if (!ctl) return;
    if (changes.flags?.[MODULE_ID] !== undefined || 'name' in changes || 'color' in changes) ctl.refresh();
  });

  // Joining and leaving is not a document update: `active` is set from the
  // server's activity event, which raises userConnected and never updateUser.
  Hooks.on('userConnected', (user, connected) => {
    if (!ctl) return;
    ctl.refresh();
    // a GM arriving rebuilds their board from the table's own reports
    if (user.isGM && connected && user.id !== game.user.id) ctl.announce();
    // the last GM leaving: close the check-in, nobody can read an answer
    if (user.isGM && !connected && !game.users.some((u) => u.isGM && u.active)) ctl.desk?.closeAsk();
  });
}

export function onReady() {
  // Three independent exemptions, read once here because they decide what is
  // ever constructed: the band and the HUD, the Dire Peril splash, and the whole
  // traffic-light tool. A change applies on that client's next reload; the
  // questions other clients ask about this user are read live.
  const isExempt = isBarsExempt(game.user.id);
  const isPerilSurfaceExempt = isPerilExempt(game.user.id);
  const isSafetySurfaceExempt = captureLocalSafetyExemption();

  ctl = new Controller({ isExempt, isPerilSurfaceExempt });

  // Every safety surface lives behind this gate. A capture login must never put
  // the table's private safety signals on the recording, and the GM rights it is
  // sometimes given change nothing: without a desk there is no lamp, no lane, no
  // red frame, no cue, and the senders' recipient lists leave it out.
  if (!isSafetySurfaceExempt) {
    ctl.desk = new SafetyDesk({
      isGM: game.user.isGM,
      emit: (payload, recipients) => emitSocket(FEATURE_ID, payload, { recipients }),
      gmRecipients: () => safeGMs(),
      playerRecipients: () => game.users.filter((u) => u.active && !u.isGM && !isSafetyExempt(u.id)).map((u) => u.id),
      isExempt: (id) => isSafetyExempt(id),
      isGMUser: (id) => !!game.users.get(id)?.isGM,
      now,
      refresh: () => ctl?.refresh()
    });
  }

  onSocket(FEATURE_ID, (payload, _claimed, meta) => ctl?.receive(payload, meta?.attested ?? null));
  setRefresher(() => ctl?.refresh());
  ctl.start();

  game.streamPacer = ctl.api;
}

/** Active GMs who may hear a safety light. Read live, per message. */
function safeGMs() {
  return game.users.filter((u) => u.isGM && u.active && u.id !== game.user.id && !isSafetyExempt(u.id)).map((u) => u.id);
}

/* ── the controller ─────────────────────────────────────────────────────── */

class Controller {
  constructor({ isExempt, isPerilSurfaceExempt }) {
    this.isExempt = isExempt;
    this.isPerilSurfaceExempt = isPerilSurfaceExempt;
    this.desk = null;
    this.band = null;
    this.hud = null;
    this.reach = null;
    this.presence = {};
    this.prev = null;
    this.heard = readHeard();
    this._frame = 0;
    this._clock = 0;
    this._lastSecond = null;
    this._timeup = null;
    this._seenTimer = 0;
    this._handAt = {};
    this._nudgeAt = {};
    this._splash = null;
    this.api = this._api();
  }

  start() {
    this.reach = new Reach({
      onPresence: (state) => {
        this.sendPresence(state);
        this.refresh();
      }
    });
    if (!this.isExempt) {
      this.band = new SignalBand({ L, onAction: (a, d) => this.act(a, d) });
      this.hud = new PacerHud({
        L,
        onAction: (a, d) => this.act(a, d),
        position: get('sp.hudPosition'),
        onMove: (pos) => game.settings.set(MODULE_ID, 'sp.hudPosition', pos)
      });
    }
    // a GM reloading alone: no board survives a reload, so close any orphaned
    // ask and ask the table to report again
    if (game.user.isGM && !game.users.some((u) => u.isGM && u.active && u.id !== game.user.id)) {
      emitSocket(FEATURE_ID, { t: 'askEnd', id: null });
      emitSocket(FEATURE_ID, { t: 'roll' });
    }
    if (!game.user.isGM) {
      // say hello: presence, light, and "is a check-in running?"
      this.announce();
      const gms = game.users.filter((u) => u.isGM && u.active).map((u) => u.id);
      if (gms.length) emitSocket(FEATURE_ID, { t: 'hello' }, { recipients: gms });
    }
    this.refresh();
  }

  /** Coalesce every reason to redraw into one pass per frame. */
  refresh() {
    if (this._frame) return;
    // A hidden tab gets no animation frames, and a player with the tab in the
    // background is exactly who a call's sound and notification are for. The
    // timer runs there (throttled); whichever fires first does the pass.
    const run = () => {
      if (!this._frame) return;
      cancelAnimationFrame(this._frame);
      clearTimeout(this._frameTimer);
      this._frame = 0;
      this._render();
    };
    this._frame = requestAnimationFrame(run);
    this._frameTimer = setTimeout(run, 100);
  }

  snapshot() {
    const users = game.users.map((u) => ({
      id: u.id,
      name: u.name,
      color: u.color?.css ?? String(u.color ?? ''),
      isGM: u.isGM,
      active: u.active,
      exempt: { bars: isBarsExempt(u.id), peril: isPerilExempt(u.id), safety: isSafetyExempt(u.id) },
      pacer: u.getFlag(MODULE_ID, FLAG)
    }));
    return M.normalizeSnapshot({
      now: now(),
      me: { id: game.user.id, isGM: game.user.isGM },
      users,
      call: get('sp.call'),
      mood: get('sp.mood'),
      spotlight: get('sp.spotlight'),
      presence: { ...this.presence, [game.user.id]: this.reach?.state },
      safety: this.desk ? this.desk.snapshot() : { show: false },
      text: { perilTag: get('sp.perilTextTag', ''), perilSubtitle: get('sp.perilTextSubtitle', '') }
    });
  }

  _render() {
    const next = this.snapshot();
    this._arrive(next);
    if (this.band) this.band.update(M.lanes(next), next.now);
    if (this.hud) this.hud.update(M.hudModel(next, { collapsed: get('sp.hudCollapsed', false), sound: get('sp.sound', true), desktop: desktopState() }));
    this._watchSeen(next);
    this._syncClock(next);
    this.prev = next;
  }

  _arrive(next) {
    const a = M.arrivals(this.prev, next, this.heard);
    for (const id of a.ids) this.heard.add(id);
    if (a.ids.length) writeHeard(this.heard);
    const t = Date.now();
    const sounds = a.sounds.filter((cue) => {
      if (cue !== 'hand') return true;
      if (t - (this._handAt.last ?? 0) < TIMING.handCooldown) return false;
      this._handAt.last = t;
      return true;
    });
    // one cue per pass is plenty; the loudest news wins
    const cue = PRIORITY.find((c) => sounds.includes(c));
    const note = a.notify[0];
    if (cue || note) {
      const title = note ? L(note.k, note.d) : L('STREAM_PACER.Hud.Title');
      this.reach?.alert({ cue, title, body: L('STREAM_PACER.Notify.Body') });
    }
    if (a.perilSplash && !this.isPerilSurfaceExempt) this._playPeril();
  }

  _playPeril() {
    this._splash?.finish();
    const text = (key, fallback) => (get(key, '') || L(fallback));
    this._splash = playPerilSplash({
      html: perilHTML({
        dire: text('sp.perilTextDire', 'STREAM_PACER.Peril.Dire'),
        peril: text('sp.perilTextPeril', 'STREAM_PACER.Peril.Peril'),
        subtitle: text('sp.perilTextSubtitle', 'STREAM_PACER.Peril.Subtitle')
      }),
      onDone: () => { this._splash = null; }
    });
  }

  /** A call on a screen someone is looking at, for long enough, counts as seen. */
  _watchSeen(s) {
    const me = M.meUser(s);
    const due = !!(this.band && s.call && !s.me.isGM && me && M.isTargeted(s, me.id)
      && me.pacer.seen?.call !== s.call.id && this.reach?.looking);
    if (!due) {
      clearTimeout(this._seenTimer);
      this._seenTimer = 0;
      return;
    }
    if (this._seenTimer) return;
    const id = s.call.id;
    this._seenTimer = setTimeout(() => {
      this._seenTimer = 0;
      const cur = this.snapshot();
      const mine = M.meUser(cur);
      if (cur.call?.id === id && this.reach?.looking && mine?.pacer.seen?.call !== id) this.writeMine({ seen: { call: id, ack: false } });
    }, TIMING.seenDwell);
  }

  /** The countdown: the band's clock every second, ticks at the end, one cue at zero. */
  _syncClock(s) {
    const running = s.call?.kind === CALL.COUNTDOWN;
    if (!running) {
      clearInterval(this._clock);
      this._clock = 0;
      this._lastSecond = null;
      return;
    }
    if (this._clock) return;
    this._clock = setInterval(() => this._tick(), 250);
    this._tick();
  }

  _tick() {
    const call = M.normalizeCall(get('sp.call'));
    if (!call || call.kind !== CALL.COUNTDOWN) return this._syncClock({ call: null });
    const t = now();
    this.band?.tick(t);
    const left = M.secondsLeft(call, t);
    if (left === this._lastSecond) return;
    const prev = this._lastSecond;
    this._lastSecond = left;
    if (prev === null) return;
    const s = this.prev;
    const aimed = s && !s.me.isGM && M.isTargeted(s, s.me.id);
    if (left > 0 && left <= TIMING.tickFrom && aimed && !this.isExempt) playCue('tick');
    if (left === 0 && this._timeup !== call.id) {
      this._timeup = call.id;
      if (!this.isExempt && (aimed || game.user.isGM)) this.reach?.alert({ cue: 'timeup', title: L('STREAM_PACER.Notify.timeup'), body: L('STREAM_PACER.Notify.Body') });
    }
    // the lane changes tone at these two moments
    if (left === TIMING.urgentFrom || left === 0) this.refresh();
  }

  /* ── writes ── */

  async writeMine(patch) {
    return this.writeUser(game.user, patch);
  }

  async writeUser(user, patch) {
    const cur = M.normalizePlayer(user.getFlag(MODULE_ID, FLAG));
    const next = { ...cur, ...patch };
    if ('status' in patch) next.at = patch.status === STATUS.ENGAGED ? null : now();
    // every field written, every time: a nested update merges, so a field left
    // out would keep its old value forever
    const full = { status: next.status, at: next.at ?? null, seen: next.seen ?? null, answer: next.answer ?? null };
    return user.update({ [`flags.${MODULE_ID}.${FLAG}`]: full });
  }

  async writeMany(users, patch) {
    const updates = users.map((u) => {
      const cur = M.normalizePlayer(u.getFlag(MODULE_ID, FLAG));
      const next = { ...cur, ...patch };
      if ('status' in patch) next.at = patch.status === STATUS.ENGAGED ? null : now();
      return { _id: u.id, [`flags.${MODULE_ID}.${FLAG}`]: { status: next.status, at: next.at ?? null, seen: next.seen ?? null, answer: next.answer ?? null } };
    });
    if (updates.length) await User.implementation.updateDocuments(updates);
  }

  async setCall(call) {
    if (!game.user.isGM) return;
    await game.settings.set(MODULE_ID, 'sp.call', call ?? {});
  }

  async startCall(kind, { seconds = null, targets = null } = {}) {
    const t = now();
    await this.setCall({
      id: randomID(), kind, at: t,
      ends: kind === CALL.COUNTDOWN ? t + Math.max(10, seconds ?? get('sp.defaultCountdown', 60)) * 1000 : null,
      targets
    });
  }

  async setMood(kind) {
    if (!game.user.isGM) return;
    const cur = M.normalizeMood(get('sp.mood'));
    const next = kind && cur?.kind !== kind ? { id: randomID(), kind, at: now() } : {};
    await game.settings.set(MODULE_ID, 'sp.mood', next);
  }

  /** Marks are read-modify-write, so a double click ("a big spotlight") is queued, not raced. */
  mark(userId, delta) {
    if (!game.user.isGM) return;
    this._marks = (this._marks ?? Promise.resolve()).then(async () => {
      const sp = M.normalizeSpotlight(get('sp.spotlight'));
      const n = Math.max(0, (sp.marks[userId] ?? 0) + delta);
      if (n) sp.marks[userId] = n; else delete sp.marks[userId];
      await game.settings.set(MODULE_ID, 'sp.spotlight', { marks: sp.marks });
    }).catch((e) => console.error(e));
    return this._marks;
  }

  /** Lower every hand and hold, end the call and (unless kept) the mood. */
  async resetTable({ keepMood = true } = {}) {
    if (!game.user.isGM) return;
    const raised = game.users.filter((u) => !u.isGM && M.normalizePlayer(u.getFlag(MODULE_ID, FLAG)).status !== STATUS.ENGAGED);
    await this.writeMany(raised, { status: STATUS.ENGAGED });
    await this.setCall(null);
    if (!keepMood) await game.settings.set(MODULE_ID, 'sp.mood', {});
  }

  nudge(userIds) {
    if (!game.user.isGM) return;
    const t = Date.now();
    const to = userIds.filter((id) => {
      if (t - (this._nudgeAt[id] ?? 0) < TIMING.nudgeCooldown) return false;
      this._nudgeAt[id] = t;
      return game.users.get(id)?.active;
    });
    if (!to.length) return;
    emitSocket(FEATURE_ID, { t: 'nudge', call: M.normalizeCall(get('sp.call'))?.id ?? null }, { recipients: to });
    const names = to.map((id) => game.users.get(id)?.name).filter(Boolean).join(', ');
    ui.notifications?.info(L('STREAM_PACER.Notify.Nudged', { names }));
  }

  sendPresence(state = this.reach?.state) {
    if (game.user.isGM || !state) return;
    const gms = game.users.filter((u) => u.isGM && u.active).map((u) => u.id);
    if (gms.length) emitSocket(FEATURE_ID, { t: 'presence', state }, { recipients: gms });
  }

  /** Report everything a GM's board is built from. */
  announce() {
    this.sendPresence();
    this.desk?.announce();
  }

  /* ── the wire ── */

  receive(p, sender) {
    if (!p || typeof p.t !== 'string' || !sender) return;
    if (this.desk?.receive(p, sender)) return;
    const fromGM = !!game.users.get(sender)?.isGM;
    switch (p.t) {
      case 'presence':
        if (!game.user.isGM || !['here', 'idle', 'away'].includes(p.state)) return;
        this.presence[sender] = p.state;
        this.refresh();
        return;
      case 'hello':
        if (!game.user.isGM) return;
        this.desk?.replyHello(sender);
        return;
      case 'roll':
        if (fromGM) this.announce();
        return;
      case 'nudge': {
        if (!fromGM || this.isExempt) return;
        const s = this.prev;
        this.reach?.alert({ cue: 'nudge', title: L('STREAM_PACER.Notify.nudge'), body: L('STREAM_PACER.Notify.Body') });
        if (s?.call) this.band?.flare(`call:${s.call.id}`);
        return;
      }
      default:
    }
  }

  /* ── what the buttons do ── */

  async act(action, data = {}) {
    const s = this.prev ?? this.snapshot();
    const call = s.call;
    try {
      switch (action) {
        // a player's own state
        case 'status': return this.writeMine({ status: Object.values(STATUS).includes(data.status) ? data.status : STATUS.ENGAGED });
        case 'ack': return call && this.writeMine({ seen: { call: call.id, ack: true } });
        case 'answer': return call && this.writeMine({ answer: { call: call.id, value: data.value }, seen: { call: call.id, ack: true } });
        case 'light': return this.desk?.setLight(data.light);
        case 'sound': return game.settings.set(MODULE_ID, 'sp.sound', !get('sp.sound', true));
        case 'desktop': { await toggleDesktop(); return this.refresh(); }
        case 'collapse': { await game.settings.set(MODULE_ID, 'sp.hudCollapsed', !get('sp.hudCollapsed', false)); return this.refresh(); }

        // the GM's calls
        case 'wrap': return call?.kind === CALL.WRAP && !call.targets ? this.setCall(null) : this.startCall(CALL.WRAP);
        case 'wrap-one': return this.startCall(CALL.WRAP, { targets: [data.user] });
        case 'countdown': return this.startCall(CALL.COUNTDOWN, { seconds: Number(data.seconds) || null });
        case 'ready': return call?.kind === CALL.READY ? this.setCall(null) : this.startCall(CALL.READY);
        case 'end-call': return this.setCall(null);
        case 'extend': return call?.kind === CALL.COUNTDOWN && this.setCall({ ...get('sp.call'), ends: Math.max(call.ends, now()) + TIMING.extend });
        case 'nudge-unseen': return this.nudge(M.unseenTargets(s).map((u) => u.id));
        case 'nudge': return this.nudge([data.user]);
        case 'campfire': return this.setMood(MOOD.CAMPFIRE);
        case 'peril': return this.setMood(MOOD.PERIL);
        case 'end-mood': return game.user.isGM && game.settings.set(MODULE_ID, 'sp.mood', {});

        // hands and marks
        case 'call-on': { const u = game.users.get(data.user); return u && game.user.isGM && this.writeUser(u, { status: STATUS.ENGAGED }); }
        case 'lower-all': return this.writeMany(game.users.filter((u) => !u.isGM && M.normalizePlayer(u.getFlag(MODULE_ID, FLAG)).status !== STATUS.ENGAGED), { status: STATUS.ENGAGED });
        case 'clear-holds': return this.writeMany(game.users.filter((u) => !u.isGM && M.normalizePlayer(u.getFlag(MODULE_ID, FLAG)).status === STATUS.HOLD), { status: STATUS.ENGAGED });
        case 'mark': return this.mark(data.user, 1);
        case 'unmark': return this.mark(data.user, -1);
        case 'reset-marks': {
          const ok = await foundry.applications.api.DialogV2.confirm({
            window: { title: L('STREAM_PACER.Hud.ResetMarks') },
            content: `<p>${L('STREAM_PACER.Hud.ResetMarksConfirm')}</p>`
          });
          return ok && game.settings.set(MODULE_ID, 'sp.spotlight', { marks: {} });
        }

        // safety
        case 'ask': return this.desk?.startAsk(randomID());
        case 'end-ask': return this.desk?.endAsk();
        case 'safety-seen': {
          const sig = M.raisedLights(s).map((r) => `${r.user.id}:${r.light}`).join('|');
          return this.desk?.acknowledge(sig);
        }
        default:
      }
    } catch (e) {
      console.error(`${MODULE_ID} | stream-pacer | ${action} failed`, e);
      ui.notifications?.error(L('STREAM_PACER.Notify.Failed'));
    }
  }

  _api() {
    return {
      raiseHand: () => this.act('status', { status: STATUS.HAND }),
      needTime: () => this.act('status', { status: STATUS.HOLD }),
      lower: () => this.act('status', { status: STATUS.ENGAGED }),
      wrapUp: (userId = null) => (userId ? this.act('wrap-one', { user: userId }) : this.startCall(CALL.WRAP)),
      countdown: (seconds) => this.startCall(CALL.COUNTDOWN, { seconds }),
      readyCheck: () => this.startCall(CALL.READY),
      endCall: () => this.setCall(null),
      campfire: () => this.setMood(MOOD.CAMPFIRE),
      peril: () => this.setMood(MOOD.PERIL),
      endMood: () => this.act('end-mood'),
      mark: (userId, delta = 1) => this.mark(userId, delta),
      reset: () => this.resetTable(),
      snapshot: () => this.snapshot()
    };
  }
}

/** Which cue wins when several arrive in one pass. */
const PRIORITY = ['red', 'peril', 'yellow', 'checkin', 'wrap', 'countdown', 'ready', 'nudge', 'hand', 'allready', 'campfire'];

/* ── a client's memory of what it already announced ── */

function readHeard() {
  try { return new Set(JSON.parse(sessionStorage.getItem(HEARD_KEY) ?? '[]')); } catch { return new Set(); }
}
function writeHeard(set) {
  try { sessionStorage.setItem(HEARD_KEY, JSON.stringify([...set].slice(-64))); } catch { /* storage may be blocked */ }
}

/* ── keybindings and the quick palette ──────────────────────────────────── */

function registerKeybindings() {
  const bind = (key, def) => {
    try { game.keybindings.register(MODULE_ID, key, def); } catch (e) { console.warn(`${MODULE_ID} | stream-pacer | keybinding ${key}`, e); }
  };
  bind('sp.raiseHand', {
    name: 'STREAM_PACER.Keys.RaiseHand', hint: 'STREAM_PACER.Keys.RaiseHandHint',
    editable: [{ key: 'KeyH', modifiers: ['Alt'] }],
    onDown: () => {
      if (!ctl || game.user.isGM) return false;
      const mine = M.normalizePlayer(game.user.getFlag(MODULE_ID, FLAG));
      ctl.act('status', { status: mine.status === STATUS.HAND ? STATUS.ENGAGED : STATUS.HAND });
      return true;
    }
  });
  bind('sp.wrapUp', {
    name: 'STREAM_PACER.Keys.WrapUp', hint: 'STREAM_PACER.Keys.WrapUpHint', restricted: true,
    editable: [{ key: 'KeyW', modifiers: ['Alt'] }],
    onDown: () => { if (!ctl || !game.user.isGM) return false; ctl.act('wrap'); return true; }
  });
  bind('sp.readyCheck', {
    name: 'STREAM_PACER.Keys.ReadyCheck', hint: 'STREAM_PACER.Keys.ReadyCheckHint', restricted: true,
    editable: [{ key: 'KeyR', modifiers: ['Alt'] }],
    onDown: () => { if (!ctl || !game.user.isGM) return false; ctl.act('ready'); return true; }
  });
  bind('sp.endCall', {
    name: 'STREAM_PACER.Keys.EndCall', hint: 'STREAM_PACER.Keys.EndCallHint', restricted: true,
    editable: [],
    onDown: () => { if (!ctl || !game.user.isGM) return false; ctl.act('end-call'); return true; }
  });
}

const QUICK_PROVIDER = {
  id: FEATURE_ID,
  order: 40,
  label: 'STREAM_PACER.Quick.Group',
  icon: 'fa-solid fa-gauge-high',
  available: () => !!ctl && !!game.user?.isGM,
  search(query) {
    const go = (act, data) => async () => ctl?.act(act, data);
    const items = [
      { key: 'wrap', title: L('STREAM_PACER.Hud.Wrap'), icon: 'fa-solid fa-flag-checkered', run: go('wrap') },
      ...COUNTDOWN_PRESETS.map((sec) => ({ key: `cd${sec}`, title: L('STREAM_PACER.Hud.CountdownFor', { m: sec / 60 }), icon: 'fa-solid fa-stopwatch', run: go('countdown', { seconds: sec }) })),
      { key: 'ready', title: L('STREAM_PACER.Hud.Ready'), icon: 'fa-solid fa-circle-question', run: go('ready') },
      { key: 'end', title: L('STREAM_PACER.Action.EndCall'), icon: 'fa-solid fa-xmark', run: go('end-call') },
      { key: 'campfire', title: L('STREAM_PACER.Hud.Campfire'), icon: 'fa-solid fa-fire', run: go('campfire') },
      { key: 'peril', title: L('STREAM_PACER.Hud.Peril'), icon: 'fa-solid fa-skull', run: go('peril') },
      { key: 'hands', title: L('STREAM_PACER.Hud.ClearHands'), icon: 'fa-solid fa-hand-point-down', run: go('lower-all') },
      ...(ctl?.desk ? [{ key: 'ask', title: L('STREAM_PACER.Hud.CheckIn'), icon: 'fa-solid fa-hand-holding-heart', run: go(ctl.desk.ask ? 'end-ask' : 'ask') }] : []),
      ...game.users.filter((u) => u.active && !u.isGM && !isBarsExempt(u.id)).flatMap((u) => [
        { key: `wrap-${u.id}`, title: L('STREAM_PACER.Action.WrapOne', { name: u.name }), icon: 'fa-solid fa-flag-checkered', run: go('wrap-one', { user: u.id }) },
        { key: `nudge-${u.id}`, title: L('STREAM_PACER.Action.Nudge', { name: u.name }), icon: 'fa-solid fa-hand-back-fist', run: go('nudge', { user: u.id }) },
        { key: `mark-${u.id}`, title: L('STREAM_PACER.Quick.Mark', { name: u.name }), icon: 'fa-solid fa-star', run: go('mark', { user: u.id }) }
      ])
    ];
    const run = L('STREAM_PACER.Quick.Run');
    return items
      .filter((i) => !query || matchesQuery(i.title, query))
      .slice(0, 12)
      .map((i) => ({ key: i.key, title: i.title, sub: L('GLS.feature.stream-pacer.title'), icon: i.icon, actions: [{ id: 'run', label: run, icon: 'fa-solid fa-play', mod: '' }], run: i.run }));
  }
};
