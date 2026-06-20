import { PacerManager } from './PacerManager.js';
import { onSocket, emitSocket } from '../../core/socket.mjs';

const FEATURE_ID = 'stream-pacer';

const EVENTS = {
  PLAYER_STATUS_CHANGE: 'playerStatusChange',
  GM_SOFT_SIGNAL: 'gmSoftSignal',
  GM_HARD_COUNTDOWN: 'gmHardCountdown',
  GM_FLOOR_OPEN: 'gmFloorOpen',
  GM_CANCEL_SIGNAL: 'gmCancelSignal',
  REQUEST_STATE: 'requestState',
  SYNC_STATE: 'syncState',
  RESET_ALL: 'resetAll',
  DIRE_PERIL_DECLARE: 'direPerilDeclare',
  DIRE_PERIL_DISMISS: 'direPerilDismiss',
  SPOTLIGHT_UPDATE: 'spotlightUpdate',
  SPOTLIGHT_RESET: 'spotlightReset'
};

class SocketHandlerClass {
  constructor() {
    this._syncReceived = false;
    this._syncRetryTimer = null;
    this._syncRetriesLeft = 0;
  }

  initialize() {
    onSocket(FEATURE_ID, (data) => this._handleMessage(data));

    // Request current state from GM when joining. Retry a few times in case
    // the GM's socket handler isn't registered yet when we fire the first one.
    if (!game.user.isGM) {
      this._syncReceived = false;
      this._syncRetriesLeft = 4;
      this._scheduleSyncRequest(500);
    }
  }

  _scheduleSyncRequest(delay) {
    clearTimeout(this._syncRetryTimer);
    this._syncRetryTimer = setTimeout(() => {
      if (this._syncReceived || !game.users.find(u => u.isGM && u.active)) {
        // Either we got the sync or there's no GM online to answer.
        clearTimeout(this._syncRetryTimer);
        this._syncRetryTimer = null;
        return;
      }
      this.requestState();
      if (this._syncRetriesLeft-- > 0) {
        this._scheduleSyncRequest(1500);
      }
    }, delay);
  }

  _handleMessage(data) {
    const { event, payload, senderId } = data;

    // Foundry's socket emit is a broadcast — ignore our own messages so we
    // don't double-apply state we already set locally.
    if (senderId === game.user.id) return;

    // GM-only events must originate from a GM client.
    const senderIsGM = game.users.get(senderId)?.isGM === true;

    switch (event) {
      case EVENTS.PLAYER_STATUS_CHANGE:
        PacerManager.receivePlayerStatusChange(payload.userId, payload.status);
        break;

      case EVENTS.GM_SOFT_SIGNAL:
        if (!senderIsGM) break;
        PacerManager.receiveGmSoftSignal();
        break;

      case EVENTS.GM_HARD_COUNTDOWN:
        if (!senderIsGM) break;
        PacerManager.receiveGmHardCountdown(payload.countdownEnd);
        break;

      case EVENTS.GM_FLOOR_OPEN:
        if (!senderIsGM) break;
        PacerManager.receiveGmFloorOpen();
        break;

      case EVENTS.GM_CANCEL_SIGNAL:
        if (!senderIsGM) break;
        PacerManager.receiveGmCancelSignal();
        break;

      case EVENTS.REQUEST_STATE:
        // Only GM responds to state requests
        if (game.user.isGM) {
          this._sendSyncState(senderId);
        }
        break;

      case EVENTS.SYNC_STATE:
        // Only process if this message is for us and came from a GM
        if (senderIsGM && payload.targetUserId === game.user.id) {
          this._syncReceived = true;
          clearTimeout(this._syncRetryTimer);
          this._syncRetryTimer = null;
          PacerManager.receiveSyncState(payload.state);
        }
        break;

      case EVENTS.RESET_ALL:
        if (!senderIsGM) break;
        PacerManager.receiveResetAll();
        break;

      case EVENTS.DIRE_PERIL_DECLARE:
        if (!senderIsGM) break;
        PacerManager.receiveDirePerilDeclare();
        break;

      case EVENTS.DIRE_PERIL_DISMISS:
        if (!senderIsGM) break;
        PacerManager.receiveDirePerilDismiss();
        break;

      case EVENTS.SPOTLIGHT_UPDATE:
        if (!senderIsGM) break;
        PacerManager.receiveSpotlightUpdate(payload.userId, payload.accrued, payload.activeSince);
        break;

      case EVENTS.SPOTLIGHT_RESET:
        if (!senderIsGM) break;
        PacerManager.receiveSpotlightReset();
        break;
    }
  }

  _emit(event, payload = {}) {
    emitSocket(FEATURE_ID, {
      event,
      payload,
      senderId: game.user.id
    });
  }

  // --- Emit Methods ---

  emitPlayerStatusChange(userId, status) {
    this._emit(EVENTS.PLAYER_STATUS_CHANGE, { userId, status });
  }

  emitGmSoftSignal() {
    this._emit(EVENTS.GM_SOFT_SIGNAL);
  }

  emitGmHardCountdown(countdownEnd) {
    this._emit(EVENTS.GM_HARD_COUNTDOWN, { countdownEnd });
  }

  emitGmFloorOpen() {
    this._emit(EVENTS.GM_FLOOR_OPEN);
  }

  emitGmCancelSignal() {
    this._emit(EVENTS.GM_CANCEL_SIGNAL);
  }

  requestState() {
    this._emit(EVENTS.REQUEST_STATE);
  }

  _sendSyncState(targetUserId) {
    const state = PacerManager.getState();
    this._emit(EVENTS.SYNC_STATE, {
      targetUserId,
      state: {
        playerStates: state.playerStates,
        gmSignal: state.gmSignal,
        countdownEnd: state.countdownEnd,
        direPerilActive: state.direPerilActive
      }
    });
  }

  emitResetAll() {
    this._emit(EVENTS.RESET_ALL);
  }

  emitDirePerilDeclare() {
    this._emit(EVENTS.DIRE_PERIL_DECLARE);
  }

  emitDirePerilDismiss() {
    this._emit(EVENTS.DIRE_PERIL_DISMISS);
  }

  emitSpotlightUpdate(userId, accrued, activeSince) {
    this._emit(EVENTS.SPOTLIGHT_UPDATE, { userId, accrued, activeSince });
  }

  emitSpotlightReset() {
    this._emit(EVENTS.SPOTLIGHT_RESET);
  }
}

export const SocketHandler = new SocketHandlerClass();
