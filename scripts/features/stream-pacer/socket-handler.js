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
  CAMPFIRE_DECLARE: 'campfireDeclare',
  CAMPFIRE_DISMISS: 'campfireDismiss',
  SPOTLIGHT_UPDATE: 'spotlightUpdate',
  SPOTLIGHT_RESET: 'spotlightReset',
  SAFETY_REQUEST_START: 'safetyRequestStart',
  SAFETY_REQUEST_STOP: 'safetyRequestStop',
  SAFETY_LIGHT: 'safetyLight',
  SAFETY_LIGHTS_RESET: 'safetyLightsReset',
  SAFETY_LIGHT_REQUEST: 'safetyLightRequest'
};

class SocketHandlerClass {
  constructor() {
    this._syncReceived = false;
    this._syncRetryTimer = null;
    this._syncRetriesLeft = 0;
  }

  initialize() {
    onSocket(FEATURE_ID, (data, senderId) => this._handleMessage(data, senderId));

    // Request current state from GM when joining. Retry a few times in case
    // the GM's socket handler isn't registered yet when we fire the first one.
    // Co-GMs also need a live-state sync: safety check-ins intentionally are
    // not persisted, but every active GM may view and manage one.
    this._syncReceived = false;
    this._syncRetriesLeft = 4;
    this._scheduleSyncRequest(500);
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

  _handleMessage(data, senderId) {
    const { event, payload = {} } = data;

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

      case EVENTS.CAMPFIRE_DECLARE:
        if (!senderIsGM) break;
        PacerManager.receiveCampfireDeclare(payload.campfireEnd);
        break;

      case EVENTS.CAMPFIRE_DISMISS:
        if (!senderIsGM) break;
        PacerManager.receiveCampfireDismiss();
        break;

      case EVENTS.SPOTLIGHT_UPDATE:
        if (!senderIsGM) break;
        PacerManager.receiveSpotlightUpdate(payload.userId, payload.accrued, payload.activeSince, payload.count);
        break;

      case EVENTS.SPOTLIGHT_RESET:
        if (!senderIsGM) break;
        PacerManager.receiveSpotlightReset();
        break;

      case EVENTS.SAFETY_REQUEST_START:
        if (!senderIsGM) break;
        PacerManager.receiveSafetyRequestStart(payload.requestId);
        break;

      case EVENTS.SAFETY_REQUEST_STOP:
        if (!senderIsGM) break;
        PacerManager.receiveSafetyRequestStop();
        break;

      case EVENTS.SAFETY_LIGHT:
        // A player may only announce their own light. The transport is a
        // Foundry broadcast, so every client hears it — but the manager only
        // retains other users' lights on a GM client.
        if (senderIsGM || payload.userId !== senderId) break;
        PacerManager.receiveSafetyLight(payload.userId, payload.status, payload.requestId ?? null);
        break;

      case EVENTS.SAFETY_LIGHTS_RESET:
        if (!senderIsGM) break;
        PacerManager.receiveSafetyLightsReset();
        break;

      case EVENTS.SAFETY_LIGHT_REQUEST:
        // A GM rebuilding its board after a reload. Only players answer.
        if (!senderIsGM) break;
        PacerManager.receiveSafetyLightRequest();
        break;
    }
  }

  _emit(event, payload = {}) {
    emitSocket(FEATURE_ID, {
      event,
      payload
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
    const targetIsGM = game.users.get(targetUserId)?.isGM === true;
    // Co-GMs get the whole board; a player gets nothing but their own light
    // and the bare fact that a request is open.
    const safetyLights = targetIsGM
      ? state.safetyLights
      : (state.safetyLights[targetUserId] ? { [targetUserId]: state.safetyLights[targetUserId] } : {});
    const safetyRequest = targetIsGM
      ? state.safetyRequest
      : { ...state.safetyRequest, acknowledged: {} };
    this._emit(EVENTS.SYNC_STATE, {
      targetUserId,
      state: {
        playerStates: state.playerStates,
        gmSignal: state.gmSignal,
        countdownEnd: state.countdownEnd,
        direPerilActive: state.direPerilActive,
        campfireActive: state.campfireActive,
        campfireEnd: state.campfireEnd,
        safetyRequest,
        safetyLights
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

  emitCampfireDeclare(campfireEnd) {
    this._emit(EVENTS.CAMPFIRE_DECLARE, { campfireEnd });
  }

  emitCampfireDismiss() {
    this._emit(EVENTS.CAMPFIRE_DISMISS);
  }

  emitSpotlightUpdate(userId, accrued, activeSince, count) {
    this._emit(EVENTS.SPOTLIGHT_UPDATE, { userId, accrued, activeSince, count });
  }

  emitSpotlightReset() {
    this._emit(EVENTS.SPOTLIGHT_RESET);
  }

  emitSafetyRequestStart(requestId) {
    this._emit(EVENTS.SAFETY_REQUEST_START, { requestId });
  }

  emitSafetyRequestStop() {
    this._emit(EVENTS.SAFETY_REQUEST_STOP);
  }

  emitSafetyLight(userId, status, requestId = null) {
    this._emit(EVENTS.SAFETY_LIGHT, { userId, status, requestId });
  }

  emitSafetyLightsReset() {
    this._emit(EVENTS.SAFETY_LIGHTS_RESET);
  }

  emitSafetyLightRequest() {
    this._emit(EVENTS.SAFETY_LIGHT_REQUEST);
  }
}

export const SocketHandler = new SocketHandlerClass();
