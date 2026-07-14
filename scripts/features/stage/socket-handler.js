import { FEATURE_ID } from './settings.js';
import { onSocket, emitSocket as suiteEmit } from '../../core/socket.mjs';

const ALLOWED_ANIMATIONS = new Set(['bounce', 'shake', 'flip', 'nod', 'jiggle', 'fadeIn', 'slideIn']);

export const SOCKET_EVENTS = {
    UPDATE_STAGE: 'updateStage',
    UPDATE_COMMS: 'updateComms',
    TRIGGER_ANIMATION: 'triggerAnimation',
    REQUEST_SYNC: 'requestSync',
    SYNC_STATE: 'syncState'
};

let _onStageUpdate = null;
let _onAnimation = null;
let _onCommsUpdate = null;

export function initializeSocket(onStageUpdate, onAnimation, onCommsUpdate) {
    _onStageUpdate = onStageUpdate;
    _onAnimation = onAnimation;
    _onCommsUpdate = onCommsUpdate;
    // Route through the suite's unified socket dispatcher. The whole suite shares
    // one channel; payloads are tagged with `__feature` by `emitSocket`, and the
    // dispatcher delivers them to this single handler which keeps the module's
    // own internal message-type routing intact.
    onSocket(FEATURE_ID, handleSocketMessage);
}

export function emitSocket(data) {
    suiteEmit(FEATURE_ID, data);
    // Foundry does not echo a client's own emit back to it, so handle locally.
    handleLocalMessage(data);
}

function handleSocketMessage(data, senderId) {
    if (senderId === game.user.id) return;

    switch (data.type) {
        case SOCKET_EVENTS.UPDATE_STAGE:
            if (!isSenderGM(senderId) || !data.state || typeof data.state !== 'object') return;
            if (_onStageUpdate) _onStageUpdate(data.state);
            break;
        case SOCKET_EVENTS.UPDATE_COMMS:
            if (!isSenderGM(senderId) || !data.state || typeof data.state !== 'object') return;
            if (_onCommsUpdate) _onCommsUpdate(data.state);
            break;
        case SOCKET_EVENTS.TRIGGER_ANIMATION:
            if (!isSenderGM(senderId) || !Number.isInteger(data.slotIndex) || !ALLOWED_ANIMATIONS.has(data.animation)) return;
            if (_onAnimation) _onAnimation(data.slotIndex, data.animation);
            break;
        case SOCKET_EVENTS.REQUEST_SYNC:
            handleSyncRequest(data, senderId);
            break;
        case SOCKET_EVENTS.SYNC_STATE:
            if (!isSenderGM(senderId) || !data.state || typeof data.state !== 'object') return;
            if (data.targetId && data.targetId !== game.user.id) return;
            if (_onStageUpdate) _onStageUpdate(data.state);
            if (data.commsState && typeof data.commsState === 'object' && _onCommsUpdate) {
                _onCommsUpdate(data.commsState);
            }
            break;
    }
}

function isSenderGM(senderId) {
    return game.users?.get(senderId)?.isGM === true;
}

function handleLocalMessage(data) {
    switch (data.type) {
        case SOCKET_EVENTS.UPDATE_STAGE:
            if (_onStageUpdate) _onStageUpdate(data.state);
            break;
        case SOCKET_EVENTS.UPDATE_COMMS:
            if (_onCommsUpdate) _onCommsUpdate(data.state);
            break;
        case SOCKET_EVENTS.TRIGGER_ANIMATION:
            if (_onAnimation) _onAnimation(data.slotIndex, data.animation);
            break;
    }
}

function handleSyncRequest(data, senderId) {
    if (!game.user.isGM) return;
    const mod = game.modules.get('gluniverse-foundry-modules');
    const stageManager = mod?.stageManager;
    if (!stageManager) return;

    suiteEmit(FEATURE_ID, {
        type: SOCKET_EVENTS.SYNC_STATE,
        targetId: senderId,
        state: stageManager.getFullState(),
        commsState: stageManager.getFullCommsState()
    });
}

export function requestStateSync() {
    if (!game.user.isGM) {
        emitSocket({ type: SOCKET_EVENTS.REQUEST_SYNC });
    }
}
