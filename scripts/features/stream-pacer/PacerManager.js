import { MODULE_ID, PLAYER_STATUS, GM_SIGNAL, SAFETY_STATUS, isSafetyExempt, isLocallySafetyExempt } from './settings.js';
import { SocketHandler } from './socket-handler.js';

class PacerManagerClass {
  constructor() {
    this._playerStates = {};
    this._gmSignal = GM_SIGNAL.NONE;
    this._countdownEnd = null;
    this._countdownInterval = null;
    this._direPerilActive = false;
    // Campfire Scene: a calm, GM-declared "relax and roleplay" interlude. Like
    // Dire Peril it's a sticky boolean reveal, but it also carries an optional
    // soft countdown (_campfireEnd = ms timestamp, or null for an open scene).
    this._campfireActive = false;
    this._campfireEnd = null;
    this._campfireInterval = null;
    this._subscribers = new Set();
    this._handRaiseCallbacks = new Set();
    this._direPerilCallbacks = new Set();
    this._campfireCallbacks = new Set();
    this._safetyLightCallbacks = new Set();
    this._notifyPending = false;

    // Safety traffic lights. Every player carries a standing light (green by
    // default) that they set from their HUD; the GM is the only client that
    // retains everyone else's. Lights intentionally never enter Foundry
    // settings — they are live session state, and a client that reloads
    // re-announces its own light rather than reading a stored one.
    //
    // Player clients keep ONLY their own entry here; the socket layer and
    // receiveSafetyLight() both refuse to store another player's light for a
    // non-GM client.
    this._safetyLights = {};

    // A GM-driven "please set your light" request. While active, players see
    // the mid-screen banner + the arrow pointing at their HUD light, and the
    // GM tracks who has answered since the request opened.
    this._safetyRequest = this._emptySafetyRequest();

    // Spotlight tracker: per-user { accrued: seconds, activeSince: ms|null }.
    // A user "in the light" carries an activeSince timestamp; their live total
    // is accrued + (now - activeSince). This lets a toggled-in player keep
    // accruing across a reload with no running counter to persist.
    this._spotlight = {};
    this._spotlightInterval = null;
    this._spotlightSaveTimeout = null;
  }

  initialize() {
    // Load persisted state if GM
    if (game.user.isGM) {
      this.loadFromSettings();
      this.loadSpotlight();
    }
  }

  // --- Subscriber Pattern ---

  subscribe(callback) {
    this._subscribers.add(callback);
    return () => this._subscribers.delete(callback);
  }

  /**
   * Register a callback for hand-raise events
   * @param {Function} callback - Called with userId when a player raises their hand
   * @returns {Function} Unsubscribe function
   */
  onHandRaise(callback) {
    this._handRaiseCallbacks.add(callback);
    return () => this._handRaiseCallbacks.delete(callback);
  }

  /**
   * Notify all hand-raise callbacks
   * @param {string} userId - The user who raised their hand
   */
  _notifyHandRaise(userId) {
    for (const callback of this._handRaiseCallbacks) {
      try {
        callback(userId);
      } catch (e) {
        console.error(`${MODULE_ID} | Hand raise callback error:`, e);
      }
    }
  }

  /**
   * Register a callback for Dire Peril declare/dismiss events.
   * @param {Function} callback - Called with ({ active, animate }) on state change
   * @returns {Function} Unsubscribe function
   */
  onDirePeril(callback) {
    this._direPerilCallbacks.add(callback);
    return () => this._direPerilCallbacks.delete(callback);
  }

  _notifyDirePeril(active, { animate = true } = {}) {
    for (const callback of this._direPerilCallbacks) {
      try {
        callback({ active, animate });
      } catch (e) {
        console.error(`${MODULE_ID} | Dire Peril callback error:`, e);
      }
    }
  }

  /**
   * Register a callback for Campfire Scene declare/dismiss events.
   * @param {Function} callback - Called with ({ active, animate, end }) on change
   * @returns {Function} Unsubscribe function
   */
  onCampfire(callback) {
    this._campfireCallbacks.add(callback);
    return () => this._campfireCallbacks.delete(callback);
  }

  _notifyCampfire(active, { animate = true } = {}) {
    const end = this._campfireEnd;
    for (const callback of this._campfireCallbacks) {
      try {
        callback({ active, animate, end });
      } catch (e) {
        console.error(`${MODULE_ID} | Campfire callback error:`, e);
      }
    }
  }

  /**
   * Register a callback for safety-light changes. Fires on every accepted
   * light, local or remote, so the GM's alert layer and audio cue can react
   * to an escalation the moment it lands.
   * @param {Function} callback - Called with ({ userId, status, previous, escalated })
   * @returns {Function} Unsubscribe function
   */
  onSafetyLight(callback) {
    this._safetyLightCallbacks.add(callback);
    return () => this._safetyLightCallbacks.delete(callback);
  }

  _notifySafetyLight(detail) {
    for (const callback of this._safetyLightCallbacks) {
      try {
        callback(detail);
      } catch (e) {
        console.error(`${MODULE_ID} | Safety light callback error:`, e);
      }
    }
  }

  _notifySubscribers() {
    // Use requestAnimationFrame to batch updates and prevent UI freezing
    if (this._notifyPending) return;
    this._notifyPending = true;

    requestAnimationFrame(() => {
      this._notifyPending = false;
      const state = this.getState();
      for (const callback of this._subscribers) {
        try {
          callback(state);
        } catch (e) {
          console.error(`${MODULE_ID} | Subscriber error:`, e);
        }
      }
    });
  }

  // --- State Getters ---

  getState() {
    // Count players with hands raised
    const handRaisedCount = Object.values(this._playerStates)
      .filter(status => status === PLAYER_STATUS.HAND_RAISED).length;

    return {
      playerStates: { ...this._playerStates },
      gmSignal: this._gmSignal,
      countdownEnd: this._countdownEnd,
      countdownRemaining: this.getCountdownRemaining(),
      handRaisedCount,
      direPerilActive: this._direPerilActive,
      campfireActive: this._campfireActive,
      campfireEnd: this._campfireEnd,
      campfireRemaining: this.getCampfireRemaining(),
      safetyRequest: this.getSafetyRequest(),
      safetyLights: { ...this._safetyLights },
      mySafetyLight: this.getSafetyLight(game.user.id)
    };
  }

  _emptySafetyRequest() {
    return { id: null, active: false, acknowledged: {} };
  }

  getSafetyRequest() {
    return {
      id: this._safetyRequest.id,
      active: this._safetyRequest.active === true,
      acknowledged: { ...this._safetyRequest.acknowledged }
    };
  }

  getActivePlayerIds() {
    return game.users
      .filter(user => !user.isGM && user.active)
      .map(user => user.id);
  }

  getPlayerStatus(userId) {
    return this._playerStates[userId] || PLAYER_STATUS.ENGAGED;
  }

  getAllPlayerStates() {
    const states = {};
    // Get all active players (non-GM)
    for (const user of game.users) {
      if (!user.isGM && user.active) {
        states[user.id] = {
          userId: user.id,
          name: user.name,
          status: this._playerStates[user.id] || PLAYER_STATUS.ENGAGED
        };
      }
    }
    return states;
  }

  getCountdownRemaining() {
    if (!this._countdownEnd) return null;
    const remaining = Math.max(0, Math.ceil((this._countdownEnd - Date.now()) / 1000));
    return remaining;
  }

  /** Seconds left on the campfire timer, or null when the scene has no timer. */
  getCampfireRemaining() {
    if (!this._campfireEnd) return null;
    return Math.max(0, Math.ceil((this._campfireEnd - Date.now()) / 1000));
  }

  // --- Player Actions ---

  setPlayerStatus(userId, status, broadcast = true) {
    const previousStatus = this._playerStates[userId];
    this._playerStates[userId] = status;

    // Detect hand raise event (status changed TO hand_raised)
    if (status === PLAYER_STATUS.HAND_RAISED && previousStatus !== PLAYER_STATUS.HAND_RAISED) {
      this._notifyHandRaise(userId);
    }

    if (broadcast) {
      SocketHandler.emitPlayerStatusChange(userId, status);
    }

    this._notifySubscribers();
    this._saveToSettings();
  }

  // --- Safety traffic lights (session-only) ---

  /** A player's standing light. Everyone starts — and stays — green until set. */
  getSafetyLight(userId) {
    return this._safetyLights[userId] || SAFETY_STATUS.GREEN;
  }

  /**
   * The GM-facing roster: every active, non-exempt player with their light and
   * whether they have touched it since the current request opened.
   *
   * A safety-exempt user is left out entirely, so `total`, `pending`, `raised`
   * and the answered-of-total readout all follow from this one filter. Without
   * it a capture login would sit unanswered forever and no check-in could ever
   * read as complete. The exemption is read live here (not from the local
   * snapshot) so a GM already connected when the list changed picks it up on its
   * next board update, with no reload of its own.
   */
  getSafetyRoster() {
    const request = this._safetyRequest;
    const roster = [];
    for (const user of game.users) {
      if (user.isGM || !user.active) continue;
      if (isSafetyExempt(user.id)) continue;
      const status = this.getSafetyLight(user.id);
      roster.push({
        userId: user.id,
        name: user.name,
        status,
        isGreen: status === SAFETY_STATUS.GREEN,
        isYellow: status === SAFETY_STATUS.YELLOW,
        isRed: status === SAFETY_STATUS.RED,
        acknowledged: request.active ? request.acknowledged[user.id] === true : true
      });
    }
    return roster;
  }

  /** Tally of the current lights + how many still owe the GM an answer. */
  getSafetySummary() {
    const roster = this.getSafetyRoster();
    return {
      players: roster,
      total: roster.length,
      green: roster.filter(p => p.isGreen).length,
      yellow: roster.filter(p => p.isYellow).length,
      red: roster.filter(p => p.isRed).length,
      pending: roster.filter(p => !p.acknowledged).length,
      // "Raised" is the attention set: anything the GM should look at.
      raised: roster.filter(p => !p.isGreen)
    };
  }

  /**
   * Set a light. Players may only set their own (that is the only case that
   * broadcasts); the GM's copy of everyone else's light arrives through
   * receiveSafetyLight().
   */
  setSafetyLight(userId, status, broadcast = true) {
    if (!Object.values(SAFETY_STATUS).includes(status)) return false;
    if (broadcast && userId !== game.user.id) return false;

    const previous = this.getSafetyLight(userId);
    this._safetyLights[userId] = status;
    // Touching the light at all answers an open request, even when the player
    // re-affirms the same colour — that acknowledgement is the point.
    if (this._safetyRequest.active) this._safetyRequest.acknowledged[userId] = true;

    if (broadcast) SocketHandler.emitSafetyLight(userId, status, this._safetyRequest.id);

    this._notifySafetyLight({
      userId,
      status,
      previous,
      escalated: status !== SAFETY_STATUS.GREEN && status !== previous
    });
    this._notifySubscribers();
    return true;
  }

  /** GM: open the table-wide "set your light" request. */
  startSafetyRequest(broadcast = true) {
    if (!game.user.isGM && broadcast) return false;
    if (this._safetyRequest.active) return false;

    const id = foundry.utils.randomID();
    this._safetyRequest = { id, active: true, acknowledged: {} };
    if (broadcast) SocketHandler.emitSafetyRequestStart(id);
    this._notifySubscribers();
    return true;
  }

  /** GM: close the request. Lights themselves are left exactly as they are. */
  stopSafetyRequest(broadcast = true) {
    if (!game.user.isGM && broadcast) return false;
    if (!this._safetyRequest.active) return false;

    this._safetyRequest = this._emptySafetyRequest();
    if (broadcast) SocketHandler.emitSafetyRequestStop();
    this._notifySubscribers();
    return true;
  }

  /** The GM's traffic-light button is a plain toggle. */
  toggleSafetyRequest() {
    return this._safetyRequest.active ? this.stopSafetyRequest() : this.startSafetyRequest();
  }

  /**
   * GM: put every light back to green. Deliberately separate from resetAll —
   * a scene change must never quietly clear a player's red.
   */
  resetSafetyLights(broadcast = true) {
    if (!game.user.isGM && broadcast) return false;

    this._safetyLights = {};
    if (broadcast) SocketHandler.emitSafetyLightsReset();
    this._notifySafetyLight({ userId: null, status: SAFETY_STATUS.GREEN, previous: null, escalated: false });
    this._notifySubscribers();
    return true;
  }

  /**
   * Re-broadcast this client's own light. Used when a GM joins (or reloads)
   * and needs to rebuild the board it never persisted.
   */
  announceSafetyLight() {
    if (game.user.isGM) return;
    // A safety-exempt client has no light of its own to report — it never shows
    // the controls that would set one. Staying quiet keeps it out of the board
    // the GM is rebuilding; the roster filter is the authoritative gate.
    if (isLocallySafetyExempt()) return;
    SocketHandler.emitSafetyLight(game.user.id, this.getSafetyLight(game.user.id), this._safetyRequest.id);
  }

  // --- GM Actions ---

  activateSoftSignal(broadcast = true) {
    if (!game.user.isGM && broadcast) return;

    this._gmSignal = GM_SIGNAL.SOFT;
    this._countdownEnd = null;
    this._clearCountdownInterval();

    if (broadcast) {
      SocketHandler.emitGmSoftSignal();
    }

    this._notifySubscribers();
    this._saveToSettings();
  }

  startCountdown(duration = null, broadcast = true) {
    if (!game.user.isGM && broadcast) return;

    const countdownDuration = duration || game.settings.get(MODULE_ID, 'sp.defaultCountdown');
    this._gmSignal = GM_SIGNAL.COUNTDOWN;
    this._countdownEnd = Date.now() + (countdownDuration * 1000);

    this._clearCountdownInterval();
    this._countdownInterval = setInterval(() => this._tickCountdown(), 1000);

    if (broadcast) {
      SocketHandler.emitGmHardCountdown(this._countdownEnd);
    }

    this._notifySubscribers();
    this._saveToSettings();
  }

  openFloor(broadcast = true) {
    if (!game.user.isGM && broadcast) return;

    this._gmSignal = GM_SIGNAL.FLOOR_OPEN;
    this._countdownEnd = null;
    this._clearCountdownInterval();

    if (broadcast) {
      SocketHandler.emitGmFloorOpen();
    }

    this._notifySubscribers();
    this._saveToSettings();
  }

  cancelSignal(broadcast = true) {
    if (!game.user.isGM && broadcast) return;

    this._gmSignal = GM_SIGNAL.NONE;
    this._countdownEnd = null;
    this._clearCountdownInterval();

    if (broadcast) {
      SocketHandler.emitGmCancelSignal();
    }

    this._notifySubscribers();
    this._saveToSettings();
  }

  resetAll(broadcast = true) {
    if (!game.user.isGM && broadcast) return;

    this._playerStates = {};
    this._gmSignal = GM_SIGNAL.NONE;
    this._countdownEnd = null;
    this._direPerilActive = false;
    this._campfireActive = false;
    this._campfireEnd = null;
    this._clearCountdownInterval();
    this._clearCampfireInterval();

    if (broadcast) {
      SocketHandler.emitResetAll();
    }

    this._notifyDirePeril(false);
    this._notifyCampfire(false);
    this._notifySubscribers();
    this._saveToSettings();
  }

  declareDirePeril(broadcast = true) {
    if (!game.user.isGM && broadcast) return;
    if (this._direPerilActive) return; // already active — ignore re-triggers

    this._direPerilActive = true;

    if (broadcast) {
      SocketHandler.emitDirePerilDeclare();
    }

    this._notifyDirePeril(true);
    this._notifySubscribers();
    this._saveToSettings();
  }

  dismissDirePeril(broadcast = true) {
    if (!game.user.isGM && broadcast) return;
    if (!this._direPerilActive) return;

    this._direPerilActive = false;

    if (broadcast) {
      SocketHandler.emitDirePerilDismiss();
    }

    this._notifyDirePeril(false);
    this._notifySubscribers();
    this._saveToSettings();
  }

  // --- Campfire Scene ---

  /**
   * Declare a Campfire Scene. Optionally pass a duration in seconds to run a
   * soft countdown; omit (or pass null/0) for an open-ended scene.
   */
  declareCampfire(durationSec = null, broadcast = true) {
    if (!game.user.isGM && broadcast) return;
    if (this._campfireActive) return; // already lit — ignore re-triggers

    this._campfireActive = true;
    this._campfireEnd = durationSec ? Date.now() + durationSec * 1000 : null;

    this._clearCampfireInterval();
    if (this._campfireEnd) {
      this._campfireInterval = setInterval(() => this._tickCampfire(), 1000);
    }

    if (broadcast) {
      SocketHandler.emitCampfireDeclare(this._campfireEnd);
    }

    this._notifyCampfire(true);
    this._notifySubscribers();
    this._saveToSettings();
  }

  dismissCampfire(broadcast = true) {
    if (!game.user.isGM && broadcast) return;
    if (!this._campfireActive) return;

    this._campfireActive = false;
    this._campfireEnd = null;
    this._clearCampfireInterval();

    if (broadcast) {
      SocketHandler.emitCampfireDismiss();
    }

    this._notifyCampfire(false);
    this._notifySubscribers();
    this._saveToSettings();
  }

  // The campfire timer only needs to fire once, at expiry. Display ticking is
  // owned by the overlay, so we deliberately avoid _notifySubscribers here to
  // keep the GM HUD from re-rendering (and restarting its animations) each second.
  _tickCampfire() {
    const remaining = this.getCampfireRemaining();
    if (remaining !== null && remaining <= 0) {
      // GM owns the authoritative dismiss + broadcast; other clients clear their
      // own interval and wait for the GM's socket message.
      this._clearCampfireInterval();
      if (game.user.isGM) this.dismissCampfire();
    }
  }

  _clearCampfireInterval() {
    if (this._campfireInterval) {
      clearInterval(this._campfireInterval);
      this._campfireInterval = null;
    }
  }

  // --- Spotlight Tracker (GM-facing) ---

  /** Live total seconds in the spotlight for one user. */
  _spotlightSeconds(entry) {
    if (!entry) return 0;
    let seconds = entry.accrued || 0;
    if (entry.activeSince) {
      seconds += Math.max(0, (Date.now() - entry.activeSince) / 1000);
    }
    return seconds;
  }

  isSpotlightActive(userId) {
    return !!this._spotlight[userId]?.activeSince;
  }

  _spotlightActiveCount() {
    return Object.values(this._spotlight).filter(e => e.activeSince).length;
  }

  /** Current spotlight tracking mode: 'time' (accrued seconds) or 'count'. */
  _spotlightMode() {
    return game.settings.get(MODULE_ID, 'sp.spotlightMode') || 'time';
  }

  /**
   * Toggle a player in or out of the current spotlight. Crediting is live:
   * toggling out folds the elapsed time into the accrued total.
   */
  setSpotlight(userId, active, broadcast = true) {
    if (!game.user.isGM && broadcast) return;

    const entry = this._spotlight[userId] || (this._spotlight[userId] = { accrued: 0, activeSince: null, count: 0 });
    if (active && !entry.activeSince) {
      entry.activeSince = Date.now();
    } else if (!active && entry.activeSince) {
      entry.accrued = (entry.accrued || 0) + Math.max(0, (Date.now() - entry.activeSince) / 1000);
      entry.activeSince = null;
    } else {
      return; // no-op — already in the requested state
    }

    if (broadcast) {
      SocketHandler.emitSpotlightUpdate(userId, entry.accrued, entry.activeSince, entry.count || 0);
    }

    this._updateSpotlightInterval();
    this._notifySubscribers();
    this._saveSpotlight();
  }

  /**
   * Count-mode spotlight: nudge a player's tally up or down. Left-click in the
   * HUD adds (delta +1), right-click reduces (delta -1). Never drops below 0.
   */
  adjustSpotlightCount(userId, delta, broadcast = true) {
    if (!game.user.isGM && broadcast) return;

    const entry = this._spotlight[userId] || (this._spotlight[userId] = { accrued: 0, activeSince: null, count: 0 });
    const next = Math.max(0, (entry.count || 0) + delta);
    if (next === (entry.count || 0)) return; // no-op (e.g. reducing below 0)
    entry.count = next;

    if (broadcast) {
      SocketHandler.emitSpotlightUpdate(userId, entry.accrued || 0, entry.activeSince || null, entry.count);
    }

    this._notifySubscribers();
    this._saveSpotlight();
  }

  resetSpotlight(broadcast = true) {
    if (!game.user.isGM && broadcast) return;

    this._spotlight = {};

    if (broadcast) {
      SocketHandler.emitSpotlightReset();
    }

    this._updateSpotlightInterval();
    this._notifySubscribers();
    this._saveSpotlight();
  }

  /**
   * Build the fairness summary the GM HUD renders: per-player totals, bar
   * scaling, the "underserved" flag, and a "spotlight next" suggestion.
   * Roster mirrors getAllPlayerStates — active non-GM players — while accrued
   * time persists for anyone who has stepped away.
   */
  getSpotlightSummary() {
    const mode = this._spotlightMode();
    const players = [];
    for (const user of game.users) {
      if (user.isGM || !user.active) continue;
      const entry = this._spotlight[user.id];
      // `value` is the fairness metric in whichever unit the mode tracks:
      // seconds in the light (time mode) or tally of spotlight moments (count).
      const value = mode === 'count'
        ? (entry?.count || 0)
        : this._spotlightSeconds(entry);
      players.push({
        userId: user.id,
        name: user.name,
        value,
        // In count mode a player is "lit" when they have at least one tally;
        // in time mode it tracks the running in-the-light timer.
        active: mode === 'count' ? value > 0 : this.isSpotlightActive(user.id)
      });
    }

    const count = players.length;
    const total = players.reduce((sum, p) => sum + p.value, 0);
    const average = count > 0 ? total / count : 0;
    const max = players.reduce((m, p) => Math.max(m, p.value), 0);

    // Hold judgement until the table has accrued a little history, so the
    // first player to get any time isn't instantly branded "underserved".
    // The threshold is unit-aware: ~a minute of time, or a few tallies.
    const MIN_TOTAL = mode === 'count' ? 3 : 60;
    const DEFICIT = 0.25;   // flag at 25% or more below the table average
    const canJudge = count >= 2 && total >= MIN_TOTAL && average > 0;

    let suggestion = null;
    for (const p of players) {
      p.pct = max > 0 ? Math.round((p.value / max) * 100) : 0;
      const deficit = average > 0 ? (average - p.value) / average : 0;
      p.deficitPct = Math.round(deficit * 100);
      p.underserved = canJudge && deficit >= DEFICIT;

      // Suggest the most-underserved player who is currently out of the light.
      if (p.underserved && !p.active) {
        if (suggestion === null || p.value < suggestion.value) suggestion = p;
      }
    }

    return {
      mode,
      players,
      hasPlayers: count > 0,
      nextUp: suggestion
        ? { userId: suggestion.userId, name: suggestion.name, deficitPct: suggestion.deficitPct }
        : null
    };
  }

  _updateSpotlightInterval() {
    // Don't keep a per-second timer alive when the tracker is hidden — stale
    // "in the light" entries would otherwise force a full HUD re-render each
    // second even though the panel isn't shown.
    const enabled = game.settings.get(MODULE_ID, 'sp.spotlightEnabled');
    // Only time mode has a running clock to refresh; count mode is event-driven.
    const live = enabled && this._spotlightMode() === 'time';
    const anyActive = live && this._spotlightActiveCount() > 0;
    if (anyActive && !this._spotlightInterval) {
      // Tick once a second so the live timers and deficit bars refresh.
      this._spotlightInterval = setInterval(() => this._notifySubscribers(), 1000);
    } else if (!anyActive && this._spotlightInterval) {
      clearInterval(this._spotlightInterval);
      this._spotlightInterval = null;
    }
  }

  loadSpotlight() {
    try {
      const saved = game.settings.get(MODULE_ID, 'sp.spotlightState');
      if (saved && saved.players) {
        this._spotlight = saved.players;
        this._updateSpotlightInterval();
      }
    } catch (e) {
      console.warn(`${MODULE_ID} | Failed to load spotlight state:`, e);
    }
  }

  _saveSpotlight() {
    if (!game.user.isGM) return;

    // Toggles are infrequent, but debounce anyway to coalesce rapid clicks.
    clearTimeout(this._spotlightSaveTimeout);
    this._spotlightSaveTimeout = setTimeout(() => {
      this._spotlightSaveTimeout = null;
      game.settings.set(MODULE_ID, 'sp.spotlightState', { players: this._spotlight });
    }, 300);
  }

  receiveSpotlightUpdate(userId, accrued, activeSince, count) {
    this._spotlight[userId] = { accrued: accrued || 0, activeSince: activeSince || null, count: count || 0 };
    this._updateSpotlightInterval();
    this._notifySubscribers();
    if (game.user.isGM) this._saveSpotlight();
  }

  receiveSpotlightReset() {
    this._spotlight = {};
    this._updateSpotlightInterval();
    this._notifySubscribers();
    if (game.user.isGM) this._saveSpotlight();
  }

  receiveSafetyRequestStart(id) {
    if (typeof id !== 'string' || !id) return;
    if (this._safetyRequest.active && this._safetyRequest.id === id) return;
    this._safetyRequest = { id, active: true, acknowledged: {} };
    this._notifySubscribers();
  }

  receiveSafetyRequestStop() {
    if (!this._safetyRequest.active) return;
    this._safetyRequest = this._emptySafetyRequest();
    this._notifySubscribers();
  }

  /**
   * A light arriving over the socket. Only the GM retains other players'
   * lights; a player client stores nothing but its own.
   */
  receiveSafetyLight(userId, status, requestId = null) {
    if (!Object.values(SAFETY_STATUS).includes(status)) return;
    if (!game.user.isGM && userId !== game.user.id) return;

    const previous = this.getSafetyLight(userId);
    this._safetyLights[userId] = status;
    // Accept the acknowledgement for the request we currently know about; a
    // stale id (the player answered a request we already closed) does not.
    if (this._safetyRequest.active && (!requestId || requestId === this._safetyRequest.id)) {
      this._safetyRequest.acknowledged[userId] = true;
    }

    this._notifySafetyLight({
      userId,
      status,
      previous,
      escalated: status !== SAFETY_STATUS.GREEN && status !== previous
    });
    this._notifySubscribers();
  }

  receiveSafetyLightsReset() {
    this._safetyLights = {};
    this._notifySafetyLight({ userId: null, status: SAFETY_STATUS.GREEN, previous: null, escalated: false });
    this._notifySubscribers();
  }

  /** A GM asked the table to re-announce; only players answer. */
  receiveSafetyLightRequest() {
    this.announceSafetyLight();
  }

  // --- State Sync (for socket updates) ---

  receivePlayerStatusChange(userId, status) {
    const previousStatus = this._playerStates[userId];
    this._playerStates[userId] = status;

    // Detect hand raise event from remote player
    if (status === PLAYER_STATUS.HAND_RAISED && previousStatus !== PLAYER_STATUS.HAND_RAISED) {
      this._notifyHandRaise(userId);
    }

    this._notifySubscribers();
    if (game.user.isGM) {
      this._saveToSettings();
    }
  }

  receiveGmSoftSignal() {
    this._gmSignal = GM_SIGNAL.SOFT;
    this._countdownEnd = null;
    this._clearCountdownInterval();
    this._notifySubscribers();
  }

  receiveGmHardCountdown(countdownEnd) {
    this._gmSignal = GM_SIGNAL.COUNTDOWN;
    this._countdownEnd = countdownEnd;

    this._clearCountdownInterval();
    this._countdownInterval = setInterval(() => this._tickCountdown(), 1000);
    this._notifySubscribers();
  }

  receiveGmCancelSignal() {
    this._gmSignal = GM_SIGNAL.NONE;
    this._countdownEnd = null;
    this._clearCountdownInterval();
    this._notifySubscribers();
  }

  receiveGmFloorOpen() {
    this._gmSignal = GM_SIGNAL.FLOOR_OPEN;
    this._countdownEnd = null;
    this._clearCountdownInterval();
    this._notifySubscribers();
  }

  receiveResetAll() {
    this._playerStates = {};
    this._gmSignal = GM_SIGNAL.NONE;
    this._countdownEnd = null;
    this._direPerilActive = false;
    this._campfireActive = false;
    this._campfireEnd = null;
    this._clearCountdownInterval();
    this._clearCampfireInterval();
    this._notifyDirePeril(false);
    this._notifyCampfire(false);
    this._notifySubscribers();
  }

  receiveDirePerilDeclare() {
    if (this._direPerilActive) return;
    this._direPerilActive = true;
    this._notifyDirePeril(true);
    this._notifySubscribers();
    if (game.user.isGM) {
      this._saveToSettings();
    }
  }

  receiveDirePerilDismiss() {
    if (!this._direPerilActive) return;
    this._direPerilActive = false;
    this._notifyDirePeril(false);
    this._notifySubscribers();
    if (game.user.isGM) {
      this._saveToSettings();
    }
  }

  receiveCampfireDeclare(campfireEnd) {
    if (this._campfireActive) return;
    this._campfireActive = true;
    this._campfireEnd = campfireEnd || null;

    this._clearCampfireInterval();
    if (this._campfireEnd) {
      this._campfireInterval = setInterval(() => this._tickCampfire(), 1000);
    }

    this._notifyCampfire(true);
    this._notifySubscribers();
    if (game.user.isGM) {
      this._saveToSettings();
    }
  }

  receiveCampfireDismiss() {
    if (!this._campfireActive) return;
    this._campfireActive = false;
    this._campfireEnd = null;
    this._clearCampfireInterval();
    this._notifyCampfire(false);
    this._notifySubscribers();
    if (game.user.isGM) {
      this._saveToSettings();
    }
  }

  receiveSyncState(state) {
    this._playerStates = state.playerStates || {};
    this._gmSignal = state.gmSignal || GM_SIGNAL.NONE;
    this._countdownEnd = state.countdownEnd || null;
    this._direPerilActive = state.direPerilActive === true;
    this._campfireActive = state.campfireActive === true;
    this._campfireEnd = state.campfireEnd || null;
    this._safetyRequest = state.safetyRequest?.active === true
      ? {
          id: typeof state.safetyRequest.id === 'string' ? state.safetyRequest.id : null,
          active: true,
          acknowledged: { ...(state.safetyRequest.acknowledged || {}) }
        }
      : this._emptySafetyRequest();

    // The sender already trimmed this to what we're allowed to hold: every
    // light for a GM, only our own for a player.
    const lights = state.safetyLights || {};
    this._safetyLights = {};
    for (const [userId, status] of Object.entries(lights)) {
      if (!Object.values(SAFETY_STATUS).includes(status)) continue;
      if (!game.user.isGM && userId !== game.user.id) continue;
      this._safetyLights[userId] = status;
    }

    this._clearCountdownInterval();
    if (this._gmSignal === GM_SIGNAL.COUNTDOWN && this._countdownEnd) {
      this._countdownInterval = setInterval(() => this._tickCountdown(), 1000);
    }

    this._clearCampfireInterval();
    if (this._campfireActive && this._campfireEnd) {
      this._campfireInterval = setInterval(() => this._tickCampfire(), 1000);
    }

    // Late-join: surface peril + campfire state to the overlays without replaying
    // the reveal animation.
    this._notifyDirePeril(this._direPerilActive, { animate: false });
    this._notifyCampfire(this._campfireActive, { animate: false });
    this._notifySubscribers();
  }

  // --- Internal Helpers ---

  _tickCountdown() {
    const remaining = this.getCountdownRemaining();
    if (remaining <= 0) {
      // Always clear our own interval. Only the GM broadcasts the cancel;
      // non-GM clients wait for the GM's socket event to arrive.
      this._clearCountdownInterval();
      if (game.user.isGM) {
        this.cancelSignal();
        return;
      }
    }
    this._notifySubscribers();
  }

  _clearCountdownInterval() {
    if (this._countdownInterval) {
      clearInterval(this._countdownInterval);
      this._countdownInterval = null;
    }
  }

  loadFromSettings() {
    try {
      const saved = game.settings.get(MODULE_ID, 'sp.pacerState');
      if (saved) {
        this._playerStates = saved.playerStates || {};
        this._gmSignal = saved.gmSignal || GM_SIGNAL.NONE;
        this._countdownEnd = saved.countdownEnd || null;
        this._direPerilActive = saved.direPerilActive === true;
        this._campfireActive = saved.campfireActive === true;
        this._campfireEnd = saved.campfireEnd || null;

        // Restart countdown interval if needed
        if (this._gmSignal === GM_SIGNAL.COUNTDOWN && this._countdownEnd) {
          if (this._countdownEnd > Date.now()) {
            this._countdownInterval = setInterval(() => this._tickCountdown(), 1000);
          } else {
            // Countdown expired while offline
            this._gmSignal = GM_SIGNAL.NONE;
            this._countdownEnd = null;
          }
        }

        // Restart the campfire timer, or close a scene whose timer lapsed offline.
        if (this._campfireActive && this._campfireEnd) {
          if (this._campfireEnd > Date.now()) {
            this._campfireInterval = setInterval(() => this._tickCampfire(), 1000);
          } else {
            this._campfireActive = false;
            this._campfireEnd = null;
          }
        }
      }
    } catch (e) {
      console.warn(`${MODULE_ID} | Failed to load settings:`, e);
    }
  }

  _saveToSettings() {
    if (!game.user.isGM) return;

    // Debounce rapid bursts (e.g. players toggling status during a countdown)
    // into a single DB write, while still flushing on a fresh state.
    clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(() => {
      this._saveTimeout = null;
      game.settings.set(MODULE_ID, 'sp.pacerState', {
        playerStates: this._playerStates,
        gmSignal: this._gmSignal,
        countdownEnd: this._countdownEnd,
        direPerilActive: this._direPerilActive,
        campfireActive: this._campfireActive,
        campfireEnd: this._campfireEnd
      });
    }, 300);
  }
}

export const PacerManager = new PacerManagerClass();
