import { MODULE_ID, FEATURE_ID, PLAYER_STATUS, GM_SIGNAL } from './settings.js';
import { PacerManager } from './PacerManager.js';
import { featurePath } from '../../core/const.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class PacerHUD extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this._unsubscribe = null;
    this._isDragging = false;
    this._dragStartX = 0;
    this._dragStartY = 0;
    this._elementStartLeft = 0;
    this._elementStartTop = 0;
    this._boundOnMouseMove = this._onMouseMove.bind(this);
    this._boundOnMouseUp = this._onMouseUp.bind(this);
    this._positionRestored = false;
    this._currentLeft = null;
    this._currentTop = null;
    // Tracks the structural state of the last full render and the applied
    // urgency tier, so countdown ticks can update the timer in place instead
    // of re-rendering (which would restart the panel's CSS animations).
    this._lastSignature = null;
    this._countdownUrgency = null;
  }

  static DEFAULT_OPTIONS = {
    id: 'stream-pacer-hud',
    classes: ['stream-pacer'],
    position: {
      width: 'auto',
      height: 'auto'
    },
    window: {
      frame: false,
      positioned: true
    }
  };

  static PARTS = {
    main: {
      template: featurePath(FEATURE_ID, 'templates/pacer-hud.hbs')
    }
  };

  async _prepareContext(options) {
    const state = PacerManager.getState();
    const playerStates = PacerManager.getAllPlayerStates();

    // Format player states for template
    const players = Object.values(playerStates).map(p => ({
      ...p,
      isEngaged: p.status === PLAYER_STATUS.ENGAGED,
      isHandRaised: p.status === PLAYER_STATUS.HAND_RAISED,
      isNeedTime: p.status === PLAYER_STATUS.NEED_TIME,
      isReady: p.status === PLAYER_STATUS.READY,
      statusIcon: this._getStatusIcon(p.status),
      statusClass: this._getStatusClass(p.status),
      statusTitle: game.i18n.localize(`STREAM_PACER.Status.${p.status}`)
    }));

    // Current user's status
    const myStatus = PacerManager.getPlayerStatus(game.user.id);

    // Countdown formatting
    const countdownRemaining = state.countdownRemaining;
    let formattedCountdown = null;
    let countdownUrgency = 'normal';

    if (countdownRemaining !== null) {
      const minutes = Math.floor(countdownRemaining / 60);
      const seconds = countdownRemaining % 60;
      formattedCountdown = `${minutes}:${seconds.toString().padStart(2, '0')}`;

      if (countdownRemaining <= 10) {
        countdownUrgency = 'critical';
      } else if (countdownRemaining <= 30) {
        countdownUrgency = 'warning';
      }
    }

    // Spotlight tracker — GM-only fairness view, hideable via setting.
    let spotlight = null;
    if (game.user.isGM && game.settings.get(MODULE_ID, 'sp.spotlightEnabled')) {
      const summary = PacerManager.getSpotlightSummary();
      const isCount = summary.mode === 'count';
      spotlight = {
        show: summary.hasPlayers,
        isCount,
        players: summary.players.map(p => ({
          userId: p.userId,
          name: p.name,
          active: p.active,
          underserved: p.underserved,
          pct: p.pct,
          formatted: PacerHUD._formatSpotlightValue(p.value, summary.mode)
        })),
        nextUp: summary.nextUp
          ? {
              name: summary.nextUp.name,
              deficitLabel: game.i18n.format('STREAM_PACER.Spotlight.Deficit', { pct: summary.nextUp.deficitPct })
            }
          : null
      };
    }

    return {
      isGM: game.user.isGM,
      players,
      spotlight,
      myStatus,
      myStatusEngaged: myStatus === PLAYER_STATUS.ENGAGED,
      myStatusHandRaised: myStatus === PLAYER_STATUS.HAND_RAISED,
      myStatusNeedTime: myStatus === PLAYER_STATUS.NEED_TIME,
      myStatusReady: myStatus === PLAYER_STATUS.READY,
      gmSignal: state.gmSignal,
      isSoftSignal: state.gmSignal === GM_SIGNAL.SOFT,
      isCountdown: state.gmSignal === GM_SIGNAL.COUNTDOWN,
      isFloorOpen: state.gmSignal === GM_SIGNAL.FLOOR_OPEN,
      hasActiveSignal: state.gmSignal !== GM_SIGNAL.NONE,
      formattedCountdown,
      countdownUrgency,
      handRaisedCount: state.handRaisedCount,
      direPerilActive: state.direPerilActive,
      campfireActive: state.campfireActive,
      PLAYER_STATUS,
      GM_SIGNAL
    };
  }

  // m:ss formatter shared by the template context and the in-place tick path.
  static _formatDuration(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(s / 60);
    const seconds = s % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  // Format a spotlight metric for display: m:ss in time mode, a bare tally in
  // the more abstract count mode.
  static _formatSpotlightValue(value, mode) {
    if (mode === 'count') return String(Math.max(0, Math.round(value)));
    return PacerHUD._formatDuration(value);
  }

  _getStatusIcon(status) {
    switch (status) {
      case PLAYER_STATUS.HAND_RAISED:
        return 'fa-hand';
      case PLAYER_STATUS.NEED_TIME:
        return 'fa-brain';
      case PLAYER_STATUS.READY:
        return 'fa-circle-check';
      case PLAYER_STATUS.ENGAGED:
      default:
        return 'fa-hourglass-half';
    }
  }

  _getStatusClass(status) {
    switch (status) {
      case PLAYER_STATUS.HAND_RAISED:
        return 'status-hand-raised';
      case PLAYER_STATUS.NEED_TIME:
        return 'status-need-time';
      case PLAYER_STATUS.READY:
        return 'status-ready';
      case PLAYER_STATUS.ENGAGED:
      default:
        return 'status-engaged';
    }
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);

    // Subscribe to manager updates
    this._unsubscribe = PacerManager.subscribe((state) => {
      if (!this.rendered) return;
      // During a countdown, only the remaining seconds change each tick. A full
      // re-render replaces the DOM and restarts the panel's CSS animations, so
      // update the timer in place when nothing structural has changed.
      if (this._canUpdateInPlace(state)) {
        this._updateInPlace(state);
      } else {
        this.render(false);
      }
    });
  }

  // Dispatch the per-second tick to whichever live elements are present, so a
  // ticking spotlight or countdown updates text in place rather than forcing a
  // full re-render (which would restart the panel's CSS animations).
  _updateInPlace(state) {
    if (state.gmSignal === GM_SIGNAL.COUNTDOWN) this._updateCountdownInPlace(state);
    if (game.user.isGM) this._updateSpotlightInPlace();
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._setupListeners();
    
    // Setup drag listeners (needs to happen after each render since template is rebuilt)
    this._setupDragListeners();
    
    // Restore saved position (only on first render) or re-apply current position
    if (!this._positionRestored) {
      this._restorePosition();
      this._positionRestored = true;
    } else {
      // Re-apply position after re-render
      this._reapplyPosition();
    }

    // Record what this full render represents so subsequent countdown ticks
    // can decide whether an in-place update is sufficient.
    this._lastSignature = this._structuralSignature(PacerManager.getState());
    this._countdownUrgency = context?.countdownUrgency ?? null;
  }

  // A fingerprint of everything the template renders except the countdown
  // seconds. If this is unchanged between updates, only the timer ticked.
  _structuralSignature(state) {
    const players = PacerManager.getAllPlayerStates();
    const playerSig = Object.values(players)
      .map(p => `${p.userId}:${p.status}`)
      .sort()
      .join('|');
    // The spotlight roster and active set are structural; the seconds, bars,
    // and underserved flags tick in place and are deliberately excluded.
    let spotlightSig = '';
    if (game.user.isGM) {
      spotlightSig = PacerManager.getSpotlightSummary().players
        .map(p => `${p.userId}:${p.active ? 1 : 0}`)
        .sort()
        .join('|');
    }

    return [
      state.gmSignal,
      state.direPerilActive,
      state.campfireActive,
      state.handRaisedCount,
      PacerManager.getPlayerStatus(game.user.id),
      playerSig,
      spotlightSig
    ].join('#');
  }

  _canUpdateInPlace(state) {
    if (this._lastSignature === null) return false;
    if (this._lastSignature !== this._structuralSignature(state)) return false;

    const countdownTicking = state.gmSignal === GM_SIGNAL.COUNTDOWN
      && !!this.element?.querySelector('.countdown-timer');
    const spotlightTicking = game.user.isGM
      && !!this.element?.querySelector('.spotlight-sec')
      && PacerManager.getSpotlightSummary().players.some(p => p.active);

    return countdownTicking || spotlightTicking;
  }

  _updateCountdownInPlace(state) {
    const root = this.element?.querySelector('#stream-pacer-container');
    if (!root) {
      this.render(false);
      return;
    }

    const remaining = state.countdownRemaining;
    const timerEl = root.querySelector('.countdown-timer');
    if (timerEl && remaining !== null) {
      const minutes = Math.floor(remaining / 60);
      const seconds = remaining % 60;
      timerEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    // Swap urgency tier only when it actually changes, so the escalation
    // animation isn't restarted on every tick within the same tier.
    const urgency = remaining === null
      ? 'normal'
      : remaining <= 10 ? 'critical' : remaining <= 30 ? 'warning' : 'normal';
    if (urgency !== this._countdownUrgency) {
      root.classList.remove('urgency-normal', 'urgency-warning', 'urgency-critical');
      root.classList.add(`urgency-${urgency}`);
      this._countdownUrgency = urgency;
    }
  }

  // Refresh the spotlight timers, deficit bars, underserved flags, and the
  // "next up" nudge without rebuilding the section. The roster and active set
  // are part of the structural signature, so the rows here are guaranteed to
  // exist and only their numbers/flags change.
  _updateSpotlightInPlace() {
    const section = this.element?.querySelector('.spotlight-sec');
    if (!section) return;

    const summary = PacerManager.getSpotlightSummary();
    const byId = new Map(summary.players.map(p => [p.userId, p]));

    section.querySelectorAll('.sl-row').forEach(row => {
      const p = byId.get(row.dataset.userId);
      if (!p) return;
      const timeEl = row.querySelector('.sl-time');
      if (timeEl) timeEl.textContent = PacerHUD._formatSpotlightValue(p.value, summary.mode);
      const fill = row.querySelector('.sl-bar-fill');
      if (fill) fill.style.width = `${p.pct}%`;
      row.classList.toggle('is-underserved', !!p.underserved);
    });

    const nextEl = section.querySelector('.spotlight-next');
    if (nextEl) {
      if (summary.nextUp) {
        nextEl.classList.remove('is-hidden');
        const nameEl = nextEl.querySelector('.sl-next-name');
        const deficitEl = nextEl.querySelector('.sl-next-deficit');
        if (nameEl) nameEl.textContent = summary.nextUp.name;
        if (deficitEl) {
          deficitEl.textContent = game.i18n.format('STREAM_PACER.Spotlight.Deficit', { pct: summary.nextUp.deficitPct });
        }
      } else {
        nextEl.classList.add('is-hidden');
      }
    }
  }

  _setupListeners() {
    const html = this.element;
    if (!html) return;

    // Remove old click handler if exists
    if (html._pacerClickHandler) {
      html.removeEventListener('click', html._pacerClickHandler);
    }

    // Add new click handler
    html._pacerClickHandler = (event) => {
      const target = event.target.closest('[data-action]');
      if (!target) return;

      const action = target.dataset.action;

      switch (action) {
        case 'set-status':
          const status = target.dataset.status;
          PacerManager.setPlayerStatus(game.user.id, status);
          break;
        case 'soft-signal':
          if (game.user.isGM) PacerManager.activateSoftSignal();
          break;
        case 'start-countdown':
          if (game.user.isGM) this._showCountdownDialog();
          break;
        case 'open-floor':
          if (game.user.isGM) PacerManager.openFloor();
          break;
        case 'cancel-signal':
          if (game.user.isGM) PacerManager.cancelSignal();
          break;
        case 'reset-all':
          if (game.user.isGM) PacerManager.resetAll();
          break;
        case 'declare-peril':
          if (game.user.isGM) PacerManager.declareDirePeril();
          break;
        case 'declare-campfire':
          if (game.user.isGM) this._showCampfireDialog();
          break;
        case 'spotlight-toggle': {
          if (!game.user.isGM) break;
          const userId = target.dataset.userId;
          // Count mode: left-click adds a tally (right-click reduces, handled
          // by the contextmenu listener). Time mode: toggle in/out of the light.
          if (game.settings.get(MODULE_ID, 'sp.spotlightMode') === 'count') {
            PacerManager.adjustSpotlightCount(userId, 1);
          } else {
            PacerManager.setSpotlight(userId, !PacerManager.isSpotlightActive(userId));
          }
          break;
        }
        case 'spotlight-reset':
          if (game.user.isGM) this._confirmSpotlightReset();
          break;
      }
    };
    html.addEventListener('click', html._pacerClickHandler);

    // Right-click on a spotlight row reduces that player's tally in count mode.
    if (html._pacerContextHandler) {
      html.removeEventListener('contextmenu', html._pacerContextHandler);
    }
    html._pacerContextHandler = (event) => {
      const target = event.target.closest('[data-action="spotlight-toggle"]');
      if (!target || !game.user.isGM) return;
      if (game.settings.get(MODULE_ID, 'sp.spotlightMode') !== 'count') return;
      event.preventDefault();
      PacerManager.adjustSpotlightCount(target.dataset.userId, -1);
    };
    html.addEventListener('contextmenu', html._pacerContextHandler);
  }

  async _showCountdownDialog() {
    const defaultDuration = game.settings.get(MODULE_ID, 'sp.defaultCountdown');
    const defaultMinutes = Math.floor(defaultDuration / 60);

    const content = `
      <form>
        <div class="form-group">
          <label>${game.i18n.localize('STREAM_PACER.CountdownDuration')}</label>
          <div class="form-fields">
            <input type="number" name="minutes" value="${defaultMinutes}" min="1" style="width: 60px">
            <span>${game.i18n.localize('STREAM_PACER.Minutes')}</span>
          </div>
        </div>
      </form>
    `;

    const readMinutes = (root) => {
      const input = root?.querySelector?.('[name="minutes"]');
      return parseInt(input?.value) || defaultMinutes || 1;
    };

    const start = async (minutes) => {
      const seconds = Math.max(minutes, 1) * 60;
      PacerManager.startCountdown(seconds);
    };

    await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize('STREAM_PACER.StartCountdown') },
      content,
      buttons: [
        {
          action: 'start',
          label: game.i18n.localize('STREAM_PACER.Start'),
          icon: 'fas fa-play',
          default: true,
          callback: (_event, _button, dialog) => start(readMinutes(dialog.element))
        },
        {
          action: 'cancel',
          label: game.i18n.localize('STREAM_PACER.Cancel'),
          icon: 'fas fa-times'
        }
      ],
      rejectClose: false
    });
  }

  // Light a Campfire Scene, optionally with a soft timer. A blank/zero duration
  // declares an open-ended scene the GM closes by hand.
  async _showCampfireDialog() {
    const content = `
      <form>
        <p class="notes">${game.i18n.localize('STREAM_PACER.Campfire.DialogHint')}</p>
        <div class="form-group">
          <label>${game.i18n.localize('STREAM_PACER.Campfire.TimerLabel')}</label>
          <div class="form-fields">
            <input type="number" name="minutes" value="0" min="0" style="width: 60px">
            <span>${game.i18n.localize('STREAM_PACER.Minutes')}</span>
          </div>
        </div>
      </form>
    `;

    const readMinutes = (root) => {
      const input = root?.querySelector?.('[name="minutes"]');
      const n = parseInt(input?.value);
      return Number.isFinite(n) && n > 0 ? n : 0;
    };

    const light = (minutes) => {
      const seconds = minutes > 0 ? minutes * 60 : null;
      PacerManager.declareCampfire(seconds);
    };

    await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize('STREAM_PACER.Campfire.DialogTitle') },
      content,
      buttons: [
        {
          action: 'light',
          label: game.i18n.localize('STREAM_PACER.Campfire.LightButton'),
          icon: 'fas fa-fire',
          default: true,
          callback: (_event, _button, dialog) => light(readMinutes(dialog.element))
        },
        {
          action: 'cancel',
          label: game.i18n.localize('STREAM_PACER.Cancel'),
          icon: 'fas fa-times'
        }
      ],
      rejectClose: false
    });
  }

  // A session's spotlight tracking is costly to lose, so confirm before wiping.
  async _confirmSpotlightReset() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('STREAM_PACER.Spotlight.ResetTitle') },
      content: `<p>${game.i18n.localize('STREAM_PACER.Spotlight.ResetConfirm')}</p>`,
      rejectClose: false,
      modal: true
    });
    if (confirmed) PacerManager.resetSpotlight();
  }

  _onClose(options) {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    // Clean up drag listeners
    document.removeEventListener('mousemove', this._boundOnMouseMove);
    document.removeEventListener('mouseup', this._boundOnMouseUp);
    super._onClose(options);
  }

  /**
   * Setup drag functionality for the HUD
   */
  _setupDragListeners() {
    const dragHandle = this.element.querySelector('.drag-handle');
    if (!dragHandle) return;

    // _onRender fires on every subscriber notification (once per countdown tick).
    // Dedupe by storing the handler on the element and removing it before re-adding.
    if (dragHandle._pacerDragHandler) {
      dragHandle.removeEventListener('mousedown', dragHandle._pacerDragHandler);
    }

    dragHandle._pacerDragHandler = (e) => {
      e.preventDefault();
      this._isDragging = true;
      this._dragStartX = e.clientX;
      this._dragStartY = e.clientY;

      // Get current position
      const rect = this.element.getBoundingClientRect();
      this._elementStartLeft = rect.left;
      this._elementStartTop = rect.top;

      // Add dragging class
      this.element.classList.add('dragging');

      // Add document listeners
      document.addEventListener('mousemove', this._boundOnMouseMove);
      document.addEventListener('mouseup', this._boundOnMouseUp);
    };

    dragHandle.addEventListener('mousedown', dragHandle._pacerDragHandler);
  }

  /**
   * Handle mouse move during drag
   */
  _onMouseMove(e) {
    if (!this._isDragging) return;

    const deltaX = e.clientX - this._dragStartX;
    const deltaY = e.clientY - this._dragStartY;

    let newLeft = this._elementStartLeft + deltaX;
    let newTop = this._elementStartTop + deltaY;

    // Constrain to viewport
    const rect = this.element.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width;
    const maxTop = window.innerHeight - rect.height;

    newLeft = Math.max(0, Math.min(newLeft, maxLeft));
    newTop = Math.max(0, Math.min(newTop, maxTop));

    // Store current position
    this._currentLeft = newLeft;
    this._currentTop = newTop;

    // Apply position with positioned class
    this.element.classList.add('positioned');
    this.element.style.left = `${newLeft}px`;
    this.element.style.top = `${newTop}px`;
  }

  /**
   * Handle mouse up to end drag
   */
  _onMouseUp() {
    if (!this._isDragging) return;

    this._isDragging = false;
    this.element.classList.remove('dragging');

    // Remove document listeners
    document.removeEventListener('mousemove', this._boundOnMouseMove);
    document.removeEventListener('mouseup', this._boundOnMouseUp);

    // Save position
    this._savePosition();
  }

  /**
   * Save current position to settings
   */
  _savePosition() {
    const rect = this.element.getBoundingClientRect();
    game.settings.set(MODULE_ID, 'sp.hudPosition', {
      left: rect.left,
      top: rect.top
    });
  }

  /**
   * Restore position from settings
   */
  _restorePosition() {
    try {
      const pos = game.settings.get(MODULE_ID, 'sp.hudPosition');
      if (pos && pos.left !== null && pos.top !== null) {
        // Validate position is within viewport
        const rect = this.element.getBoundingClientRect();
        let left = pos.left;
        let top = pos.top;

        // Constrain to current viewport
        const maxLeft = window.innerWidth - rect.width;
        const maxTop = window.innerHeight - rect.height;

        left = Math.max(0, Math.min(left, maxLeft));
        top = Math.max(0, Math.min(top, maxTop));

        // Store and apply position
        this._currentLeft = left;
        this._currentTop = top;
        
        this.element.classList.add('positioned');
        this.element.style.left = `${left}px`;
        this.element.style.top = `${top}px`;
      }
    } catch (e) {
      console.warn(`${MODULE_ID} | Failed to restore HUD position:`, e);
    }
  }

  /**
   * Re-apply saved position after re-render
   */
  _reapplyPosition() {
    if (this._currentLeft !== null && this._currentTop !== null) {
      this.element.classList.add('positioned');
      this.element.style.left = `${this._currentLeft}px`;
      this.element.style.top = `${this._currentTop}px`;
    }
  }

  /**
   * Override setPosition to prevent FoundryVTT from resetting our custom position
   * This is called internally by ApplicationV2 during render cycles
   */
  setPosition(position = {}) {
    // If we have a custom position set, ignore any position changes from the framework
    if (this._currentLeft !== null && this._currentTop !== null) {
      // Re-apply our saved position instead
      this._reapplyPosition();
      return;
    }
    
    // Otherwise, let the parent handle it normally
    return super.setPosition(position);
  }
}
