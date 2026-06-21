import { MODULE_ID, PLAYER_STATUS, GM_SIGNAL } from './settings.js';
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
    this._notifyPending = false;

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
      campfireRemaining: this.getCampfireRemaining()
    };
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

  /**
   * Toggle a player in or out of the current spotlight. Crediting is live:
   * toggling out folds the elapsed time into the accrued total.
   */
  setSpotlight(userId, active, broadcast = true) {
    if (!game.user.isGM && broadcast) return;

    const entry = this._spotlight[userId] || (this._spotlight[userId] = { accrued: 0, activeSince: null });
    if (active && !entry.activeSince) {
      entry.activeSince = Date.now();
    } else if (!active && entry.activeSince) {
      entry.accrued = (entry.accrued || 0) + Math.max(0, (Date.now() - entry.activeSince) / 1000);
      entry.activeSince = null;
    } else {
      return; // no-op — already in the requested state
    }

    if (broadcast) {
      SocketHandler.emitSpotlightUpdate(userId, entry.accrued, entry.activeSince);
    }

    this._updateSpotlightInterval();
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
    const players = [];
    for (const user of game.users) {
      if (user.isGM || !user.active) continue;
      players.push({
        userId: user.id,
        name: user.name,
        seconds: this._spotlightSeconds(this._spotlight[user.id]),
        active: this.isSpotlightActive(user.id)
      });
    }

    const count = players.length;
    const total = players.reduce((sum, p) => sum + p.seconds, 0);
    const average = count > 0 ? total / count : 0;
    const max = players.reduce((m, p) => Math.max(m, p.seconds), 0);

    // Hold judgement until the table has accrued a little history, so the
    // first player to get any time isn't instantly branded "underserved".
    const MIN_TOTAL = 60;   // seconds of table-wide spotlight before judging
    const DEFICIT = 0.25;   // flag at 25% or more below the table average
    const canJudge = count >= 2 && total >= MIN_TOTAL && average > 0;

    let suggestion = null;
    for (const p of players) {
      p.pct = max > 0 ? Math.round((p.seconds / max) * 100) : 0;
      const deficit = average > 0 ? (average - p.seconds) / average : 0;
      p.deficitPct = Math.round(deficit * 100);
      p.underserved = canJudge && deficit >= DEFICIT;

      // Suggest the most-underserved player who is currently out of the light.
      if (p.underserved && !p.active) {
        if (suggestion === null || p.seconds < suggestion.seconds) suggestion = p;
      }
    }

    return {
      players,
      hasPlayers: count > 0,
      nextUp: suggestion
        ? { userId: suggestion.userId, name: suggestion.name, deficitPct: suggestion.deficitPct }
        : null
    };
  }

  _updateSpotlightInterval() {
    const anyActive = this._spotlightActiveCount() > 0;
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

  receiveSpotlightUpdate(userId, accrued, activeSince) {
    this._spotlight[userId] = { accrued: accrued || 0, activeSince: activeSince || null };
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
