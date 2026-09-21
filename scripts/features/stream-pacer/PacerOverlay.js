import { GM_SIGNAL, PLAYER_STATUS } from './settings.js';
import { PacerManager } from './PacerManager.js';
import { DossierCard } from './DossierCard.js';
import { CueAudio } from './CueAudio.js';
import { escapeHTML } from '../../core/util.mjs';

// How long a wrap-up or countdown holds the centre before it docks at the top.
// Long enough to read the title and hear the cue, short enough that the card
// is gone before it gets in the way of the scene it is wrapping up.
const ARRIVAL_HOLD_MS = 4000;
// After this the arrival keyframes have all finished; the class is dropped so
// a later redraw (a tally change) does not replay them.
const ARRIVAL_SETTLE_MS = 1400;
// Countdown thresholds: the card turns hazard-red at 10s, ticks the last 5.
const CRITICAL_AT = 10;
const TICK_FROM = 5;

// One icon per meaning, used by both the card's header and the dock's tag, so
// a docked pill is recognisable from its icon before its text is read.
const ICON = {
  soft: 'fa-solid fa-hourglass-half',
  countdown: 'fa-solid fa-stopwatch',
  ready: 'fa-solid fa-list-check',
  allReady: 'fa-solid fa-circle-check',
  youReady: 'fa-solid fa-circle-check',
  hand: 'fa-solid fa-hand'
};

const L = (key) => game.i18n.localize(`STREAM_PACER.Panel.${key}`);
const F = (key, data) => game.i18n.format(`STREAM_PACER.Panel.${key}`, data);

function formatClock(seconds) {
  const s = Math.max(0, seconds ?? 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The pacing signals — wrap-up, countdown and the ready check — drawn as a
 * solid Dossier card in the middle of the screen, with a compact pill docked
 * at top-centre once the card has made its point.
 *
 *   wrap-up / countdown  arrive centred with a cue, hold, then dock
 *   ready check          stays centred until the player answers; the answer
 *                        docks it as an undoable "You're ready" pill
 *   late join / reload   no reveal and no sound — straight to where it rests
 *
 * Not constructed at all for a bars-exempt login (see module.js), which is
 * what keeps every panel and every cue off a stream capture.
 */
export class PacerOverlay {
  constructor() {
    this._card = null;
    this._dock = null;
    this._unsubscribe = null;
    this._key = null;
    this._holdTimer = null;
    this._settleTimer = null;
    this._lastRender = null;
    this._lastDock = null;
    this._lastTick = null;
    // GM only: the ready-check card tucked into the dock by choice.
    this._minimised = false;
    // Player only: "answered" as last drawn, so a change is noticed once.
    this._answered = null;
  }

  initialize() {
    this._card = new DossierCard({ onAction: (id) => this._onAction(id) });

    this._dock = document.createElement('div');
    this._dock.className = 'sp-dz-dock gl-type';
    this._dock.addEventListener('click', (event) => {
      const button = event.target.closest('[data-dock-action]');
      if (button) this._onAction(button.dataset.dockAction);
    });
    document.body.appendChild(this._dock);

    this._unsubscribe = PacerManager.subscribe((state) => this._update(state));
    this._update(PacerManager.getState());
  }

  // --- State → presentation --------------------------------------------------

  _update(state) {
    const signal = state.gmSignal;
    const key = signal === GM_SIGNAL.NONE
      ? 'none'
      : `${signal}|${state.readyCheckId ?? ''}|${signal === GM_SIGNAL.COUNTDOWN ? state.countdownEnd : ''}`;

    if (key !== this._key) {
      this._key = key;
      this._enter(state);
    } else {
      this._refresh(state);
    }
  }

  /** A different signal (or a new instance of one) has arrived. */
  _enter(state) {
    clearTimeout(this._holdTimer);
    this._holdTimer = null;
    this._minimised = false;
    this._answered = null;
    this._lastTick = null;
    this._lastRender = null;
    this._lastDock = null;

    const signal = state.gmSignal;
    if (signal === GM_SIGNAL.NONE) {
      this._card.close();
      this._hideDock();
      return;
    }

    const live = state.signalLive === true;
    this._render(state);

    if (live) CueAudio.play(signal === GM_SIGNAL.READY_CHECK ? 'readyCheck' : signal === GM_SIGNAL.SOFT ? 'soft' : 'countdown');

    if (signal === GM_SIGNAL.READY_CHECK) {
      // A player who has already answered this check (a reload, or an answer
      // that landed in the same frame as the check) goes straight to the pill.
      this._answered = this._myAnswer(state);
      if (this._answered) this._toDock(state);
      else this._toCentre({ animate: live });
      return;
    }

    // Wrap-up and countdown.
    if (live) {
      this._toCentre({ animate: true });
      this._holdTimer = setTimeout(() => {
        this._holdTimer = null;
        this._toDock(PacerManager.getState());
      }, ARRIVAL_HOLD_MS);
    } else {
      this._toDock(state);
    }
  }

  /** Same signal, new detail: a tick, a tally change, a player's answer. */
  _refresh(state) {
    const signal = state.gmSignal;
    if (signal === GM_SIGNAL.NONE) return;

    if (signal === GM_SIGNAL.COUNTDOWN) {
      const remaining = state.countdownRemaining;
      const clock = formatClock(remaining);
      this._card.setTimer(clock);
      const dockClock = this._dock.querySelector('.sp-dz-dock-clock');
      if (dockClock) dockClock.textContent = clock;
      this._setCritical(remaining !== null && remaining <= CRITICAL_AT);

      if (remaining !== null && remaining >= 1 && remaining <= TICK_FROM && remaining !== this._lastTick) {
        this._lastTick = remaining;
        CueAudio.play(remaining === 1 ? 'tickFinal' : 'tick');
      }
      return;
    }

    if (signal === GM_SIGNAL.READY_CHECK) {
      this._render(state);
      if (game.user.isGM) return;

      const answered = this._myAnswer(state);
      if (answered === this._answered) return;
      const wasAnswered = !!this._answered;
      this._answered = answered;
      if (answered) this._toDock(state);
      else if (wasAnswered) this._toCentre({ animate: true });
    }
  }

  _myAnswer(state) {
    if (game.user.isGM) return null;
    const status = state.playerStates[game.user.id];
    return status === PLAYER_STATUS.READY || status === PLAYER_STATUS.HAND_RAISED ? status : null;
  }

  _toCentre({ animate }) {
    this._hideDock();
    this._card.open({ animate });
    clearTimeout(this._settleTimer);
    if (animate) {
      this._settleTimer = setTimeout(() => this._card.card.classList.remove('is-arriving'), ARRIVAL_SETTLE_MS);
    }
  }

  _toDock(state) {
    this._card.dock();
    this._renderDock(state);
    this._dock.classList.add('is-open');
  }

  _hideDock() {
    this._dock.classList.remove('is-open');
  }

  _setCritical(on) {
    const tone = on ? 'hazard' : 'cyan';
    if (this._card.card.dataset.tone !== tone) this._card.card.dataset.tone = tone;
    if (this._dock.dataset.tone !== tone) this._dock.dataset.tone = tone;
    this._card.setFlag('is-critical', on);
    this._dock.classList.toggle('is-critical', on);
  }

  // --- Drawing ---------------------------------------------------------------

  _render(state) {
    const spec = this._spec(state);
    // Only touch the DOM when something visible changed, so an unrelated
    // subscriber tick (a spotlight timer, a safety light) never flickers it.
    const signature = JSON.stringify(spec);
    if (signature !== this._lastRender) {
      this._lastRender = signature;
      this._card.render(spec);
    }
    if (state.gmSignal === GM_SIGNAL.READY_CHECK) {
      this._card.setFlag('is-all-ready', game.user.isGM && PacerManager.getReadyTally().allReady);
      if (this._dock.classList.contains('is-open')) this._renderDock(state);
    }
  }

  _spec(state) {
    const signal = state.gmSignal;

    if (signal === GM_SIGNAL.SOFT) {
      return {
        tone: 'amber',
        icon: ICON.soft,
        label: L('Soft.Label'),
        code: L('Soft.Code'),
        kicker: L('Soft.Kicker'),
        title: game.i18n.localize('STREAM_PACER.SoftSignalMessage'),
        guide: escapeHTML(L('Soft.Guide'))
      };
    }

    if (signal === GM_SIGNAL.COUNTDOWN) {
      const remaining = state.countdownRemaining;
      return {
        tone: remaining !== null && remaining <= CRITICAL_AT ? 'hazard' : 'cyan',
        icon: ICON.countdown,
        label: L('Countdown.Label'),
        code: L('Countdown.Code'),
        kicker: L('Countdown.Kicker'),
        title: L('Countdown.Title'),
        timer: formatClock(remaining),
        guide: escapeHTML(L('Countdown.Guide'))
      };
    }

    // Ready check.
    const tally = PacerManager.getReadyTally();
    const footer = [
      F('Ready.CountReady', { ready: tally.ready, total: tally.total }),
      tally.hands ? F('Ready.CountHands', { n: tally.hands }) : ''
    ];

    if (game.user.isGM) {
      const done = tally.allReady;
      return {
        tone: 'green',
        icon: done ? ICON.allReady : ICON.ready,
        label: done ? L('Ready.AllLabel') : L('Ready.Label'),
        code: L('Ready.Code'),
        kicker: done ? L('Ready.AllKicker') : L('Ready.GmKicker'),
        title: done ? L('Ready.AllTitle') : L('Ready.Title'),
        guide: escapeHTML(tally.total ? L('Ready.GmGuide') : L('Ready.NoPlayers')),
        actions: [
          { id: 'minimise', label: L('Ready.Minimise'), icon: 'fa-solid fa-down-left-and-up-right-to-center', variant: 'ghost' },
          { id: 'close', label: L('Ready.Close'), icon: 'fa-solid fa-xmark', variant: done ? 'go' : 'ghost' }
        ],
        tally: tally.players,
        footer
      };
    }

    const ready = `<em>${escapeHTML(L('Ready.ReadyWord'))}</em>`;
    const hand = `<em>${escapeHTML(L('Ready.HandWord'))}</em>`;
    return {
      tone: 'green',
      icon: ICON.ready,
      label: L('Ready.Label'),
      code: L('Ready.Code'),
      kicker: L('Ready.Kicker'),
      title: L('Ready.Title'),
      // The two <em> words are pre-escaped markup; the sentence around them is
      // localised text, escaped piecewise so a translation cannot inject HTML.
      guide: `${escapeHTML(L('Ready.GuideDone'))} ${escapeHTML(L('Ready.GuidePress'))} ${ready}.<br>`
        + `${escapeHTML(L('Ready.GuideMore'))} ${escapeHTML(L('Ready.GuideSay'))} ${hand}.`,
      actions: [
        { id: 'ready', label: L('Ready.ReadyButton'), icon: 'fa-solid fa-check', variant: 'go' },
        { id: 'hand', label: L('Ready.HandButton'), icon: 'fa-solid fa-hand', variant: 'hand' }
      ],
      footer
    };
  }

  _renderDock(state) {
    const signal = state.gmSignal;
    let dock;

    if (signal === GM_SIGNAL.SOFT) {
      dock = { tone: 'amber', icon: ICON.soft, tag: L('Soft.Tag'), text: game.i18n.localize('STREAM_PACER.SoftSignalMessage') };
    } else if (signal === GM_SIGNAL.COUNTDOWN) {
      const remaining = state.countdownRemaining;
      dock = {
        tone: remaining !== null && remaining <= CRITICAL_AT ? 'hazard' : 'cyan',
        icon: ICON.countdown,
        tag: L('Countdown.Tag'),
        text: L('Countdown.Title'),
        clock: formatClock(remaining)
      };
    } else if (signal === GM_SIGNAL.READY_CHECK) {
      const tally = PacerManager.getReadyTally();
      if (game.user.isGM) {
        dock = {
          tone: 'green',
          icon: tally.allReady ? ICON.allReady : ICON.ready,
          tag: L('Ready.Tag'),
          text: tally.allReady
            ? L('Ready.AllTitle')
            : `${F('Ready.CountReady', { ready: tally.ready, total: tally.total })}${tally.hands ? ` · ${F('Ready.CountHands', { n: tally.hands })}` : ''}`,
          button: { id: 'expand', label: L('Ready.Expand') }
        };
      } else if (this._answered === PLAYER_STATUS.HAND_RAISED) {
        dock = { tone: 'amber', icon: ICON.hand, confirm: true, tag: L('Ready.HandTag'), text: L('Ready.HandWaiting'), button: { id: 'undo', label: L('Ready.LowerHand') } };
      } else {
        dock = { tone: 'green', icon: ICON.youReady, confirm: true, tag: L('Ready.YouTag'), text: L('Ready.YouWaiting'), button: { id: 'undo', label: L('Ready.Undo') } };
      }
    } else {
      return;
    }

    const signature = JSON.stringify(dock);
    if (signature === this._lastDock) return;
    this._lastDock = signature;

    this._dock.dataset.tone = dock.tone;
    this._dock.classList.toggle('is-critical', dock.tone === 'hazard');
    this._dock.innerHTML = `
      <span class="sp-dz-dock-tag">${dock.icon ? `<i class="${escapeHTML(dock.icon)} sp-dz-dock-icon${dock.confirm ? ' is-confirm' : ''}" aria-hidden="true"></i>` : ''}${escapeHTML(dock.tag)}</span>
      <span class="sp-dz-dock-text">${escapeHTML(dock.text)}</span>
      ${dock.clock ? `<span class="sp-dz-dock-clock">${escapeHTML(dock.clock)}</span>` : ''}
      ${dock.button ? `<button type="button" class="sp-dz-dock-btn" data-dock-action="${escapeHTML(dock.button.id)}">${escapeHTML(dock.button.label)}</button>` : ''}`;
  }

  // --- Actions ---------------------------------------------------------------

  _onAction(id) {
    const me = game.user.id;
    switch (id) {
      case 'ready':
        PacerManager.setPlayerStatus(me, PLAYER_STATUS.READY);
        break;
      case 'hand':
        PacerManager.setPlayerStatus(me, PLAYER_STATUS.HAND_RAISED);
        break;
      case 'undo':
        PacerManager.setPlayerStatus(me, PLAYER_STATUS.ENGAGED);
        break;
      case 'minimise':
        if (!game.user.isGM) break;
        this._minimised = true;
        this._toDock(PacerManager.getState());
        break;
      case 'expand':
        if (!game.user.isGM) break;
        this._minimised = false;
        this._toCentre({ animate: false });
        break;
      case 'close':
        if (game.user.isGM) PacerManager.cancelSignal();
        break;
    }
  }

  destroy() {
    clearTimeout(this._holdTimer);
    clearTimeout(this._settleTimer);
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._card?.destroy();
    this._card = null;
    this._dock?.remove();
    this._dock = null;
  }
}
