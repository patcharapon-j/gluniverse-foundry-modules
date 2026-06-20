import { MODULE_ID, getSetting, setSetting } from './settings.js';
import { emitSocket, SOCKET_EVENTS } from './socket-handler.js';

const DEFAULT_ACTOR_IMAGE = 'icons/svg/mystery-man.svg';

function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(Math.max(number, min), max);
}

function cleanString(value, fallback, maxLength = 512) {
    const string = String(value ?? fallback ?? '').trim();
    return (string || fallback || '').slice(0, maxLength);
}

const COMMS_THEMES = ['scifi', 'ethereal', 'minimal'];
// New actors get a rich-red tint enabled by default (the primary comms look).
const DEFAULT_COMMS_TINT = '#c1121f';

// Per-actor comms theme: '' means "inherit the world default setting".
function cleanCommsTheme(value) {
    const string = String(value ?? '').trim();
    return COMMS_THEMES.includes(string) ? string : '';
}

// Per-actor comms tint: a #rrggbb hex, or '' for the theme's own default tint.
function cleanTint(value) {
    const string = String(value ?? '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(string) ? string : '';
}

function normalizeActorData(data = {}) {
    return {
        name: cleanString(data.name, 'New Actor', 160),
        image: cleanString(data.image, DEFAULT_ACTOR_IMAGE, 1024),
        scale: clampNumber(data.scale, 0.1, 5, 1.0),
        offsetX: clampNumber(data.offsetX, -500, 500, 0),
        offsetY: clampNumber(data.offsetY, -500, 500, 0),
        // Comms-specific framing (independent of the stage scale/offset) so the
        // portrait can be placed precisely inside the call-in card. Free-form
        // with generous limits.
        commsScale: clampNumber(data.commsScale, 0.1, 10, 1.0),
        commsOffsetX: clampNumber(data.commsOffsetX, -1000, 1000, 0),
        commsOffsetY: clampNumber(data.commsOffsetY, -1000, 1000, 0),
        commsTheme: cleanCommsTheme(data.commsTheme),
        commsTint: cleanTint(data.commsTint) || DEFAULT_COMMS_TINT,
        measureHidden: data.measureHidden === true
    };
}

function normalizeActorUpdates(updates = {}) {
    const normalized = {};
    if ('name' in updates) normalized.name = cleanString(updates.name, 'New Actor', 160);
    if ('image' in updates) normalized.image = cleanString(updates.image, DEFAULT_ACTOR_IMAGE, 1024);
    if ('scale' in updates) normalized.scale = clampNumber(updates.scale, 0.1, 5, 1.0);
    if ('offsetX' in updates) normalized.offsetX = clampNumber(updates.offsetX, -500, 500, 0);
    if ('offsetY' in updates) normalized.offsetY = clampNumber(updates.offsetY, -500, 500, 0);
    if ('commsScale' in updates) normalized.commsScale = clampNumber(updates.commsScale, 0.1, 10, 1.0);
    if ('commsOffsetX' in updates) normalized.commsOffsetX = clampNumber(updates.commsOffsetX, -1000, 1000, 0);
    if ('commsOffsetY' in updates) normalized.commsOffsetY = clampNumber(updates.commsOffsetY, -1000, 1000, 0);
    if ('commsTheme' in updates) normalized.commsTheme = cleanCommsTheme(updates.commsTheme);
    if ('commsTint' in updates) normalized.commsTint = cleanTint(updates.commsTint);
    if ('measureHidden' in updates) normalized.measureHidden = updates.measureHidden === true;
    return normalized;
}

function normalizeSlotUpdates(updates = {}) {
    const normalized = {};
    if ('zIndex' in updates) normalized.zIndex = Math.round(clampNumber(updates.zIndex, -10, 10, 0));
    return normalized;
}

/**
 * Manages the actor library and stage state.
 * GM-only operations emit socket events to sync all clients.
 */
export class StageManager {
    static instance = null;

    static getInstance() {
        if (!this.instance) this.instance = new StageManager();
        return this.instance;
    }

    constructor() {
        this._callbacks = new Set();
    }

    // --- Actor Library (CRUD) ---

    getActors() {
        return foundry.utils.deepClone(getSetting('actorLibrary') || []);
    }

    async addActor({ name, image, scale = 1.0, offsetX = 0, offsetY = 0 }) {
        const actors = this.getActors();
        const id = foundry.utils.randomID();
        actors.push({ id, ...normalizeActorData({ name, image, scale, offsetX, offsetY }) });
        await setSetting('actorLibrary', actors);
        this._notifySubscribers();
        return id;
    }

    async updateActor(id, updates) {
        const actors = this.getActors();
        const idx = actors.findIndex(a => a.id === id);
        if (idx === -1) return;
        const normalizedUpdates = normalizeActorUpdates(updates);
        if (!Object.keys(normalizedUpdates).length) return;
        Object.assign(actors[idx], normalizedUpdates);
        await setSetting('actorLibrary', actors);

        // If this actor is on stage, update stage too
        const state = this.getStageState();
        let stageChanged = false;
        for (const slot of state.slots) {
            if (slot.actorId === id) {
                slot.actor = actors[idx];
                stageChanged = true;
            }
        }
        if (stageChanged) {
            await this._saveAndBroadcastStage(state);
        }

        // If this actor is on a call, rebroadcast comms so the overlay picks up
        // the new image/name (full state re-resolves actor data).
        const commsState = this.getCommsState();
        if (commsState.calls.some(c => c.actorId === id)) {
            await this._saveAndBroadcastComms(commsState);
        }

        this._notifySubscribers();
    }

    async removeActor(id) {
        let actors = this.getActors();
        actors = actors.filter(a => a.id !== id);
        await setSetting('actorLibrary', actors);

        // Remove from stage if present
        const state = this.getStageState();
        for (const slot of state.slots) {
            if (slot.actorId === id) {
                slot.actorId = null;
                slot.actor = null;
            }
        }
        if (state.highlightedSlot >= 0) {
            const hSlot = state.slots[state.highlightedSlot];
            if (!hSlot || !hSlot.actorId) state.highlightedSlot = -1;
        }
        await this._saveAndBroadcastStage(state);

        // Drop any calls for the removed actor.
        const commsState = this.getCommsState();
        const before = commsState.calls.length;
        commsState.calls = commsState.calls.filter(c => c.actorId !== id);
        if (commsState.calls.length !== before) {
            if (commsState.speakingCall && !commsState.calls.some(c => c.callId === commsState.speakingCall)) {
                commsState.speakingCall = commsState.calls[0]?.callId ?? null;
            }
            if (commsState.calls.length === 0) commsState.visible = false;
            await this._saveAndBroadcastComms(commsState);
        }

        this._notifySubscribers();
    }

    getActorById(id) {
        const actors = this.getActors();
        return actors.find(a => a.id === id) || null;
    }

    // --- Stage State ---

    getStageState() {
        const state = foundry.utils.deepClone(getSetting('stageState') || {
            visible: false,
            slots: [],
            highlightedSlot: -1
        });
        // Backfill slotId on existing slots missing it (migration)
        for (const slot of state.slots) {
            if (!slot.slotId) slot.slotId = foundry.utils.randomID();
        }
        return state;
    }

    getFullState() {
        const state = this.getStageState();
        state.stageHeight = getSetting('stageHeight');
        state.stageWidth = getSetting('stageWidth');
        state.stageXOffset = getSetting('stageXOffset');
        state.stageYOffset = getSetting('stageYOffset');
        // Resolve actor data for each slot
        const actors = this.getActors();
        for (const slot of state.slots) {
            if (slot.actorId) {
                slot.actor = actors.find(a => a.id === slot.actorId) || null;
            }
        }
        return state;
    }

    async setStageVisible(visible) {
        const state = this.getStageState();
        state.visible = visible;
        await this._saveAndBroadcastStage(state);
        this._notifySubscribers();
    }

    async addSlot() {
        const state = this.getStageState();
        state.slots.push({ slotId: foundry.utils.randomID(), actorId: null, actor: null, position: 'center' });
        await this._saveAndBroadcastStage(state);
        this._notifySubscribers();
    }

    async removeSlot(index) {
        const state = this.getStageState();
        if (index < 0 || index >= state.slots.length) return;
        state.slots.splice(index, 1);
        if (state.highlightedSlot === index) state.highlightedSlot = -1;
        else if (state.highlightedSlot > index) state.highlightedSlot--;
        await this._saveAndBroadcastStage(state);
        this._notifySubscribers();
    }

    async reorderSlots(fromIndex, toIndex) {
        const state = this.getStageState();
        if (fromIndex < 0 || fromIndex >= state.slots.length) return;
        if (toIndex < 0 || toIndex >= state.slots.length) return;
        if (fromIndex === toIndex) return;

        const [moved] = state.slots.splice(fromIndex, 1);
        state.slots.splice(toIndex, 0, moved);

        // Adjust highlight index to follow the highlighted slot
        if (state.highlightedSlot === fromIndex) {
            state.highlightedSlot = toIndex;
        } else if (state.highlightedSlot >= 0) {
            if (fromIndex < state.highlightedSlot && toIndex >= state.highlightedSlot) {
                state.highlightedSlot--;
            } else if (fromIndex > state.highlightedSlot && toIndex <= state.highlightedSlot) {
                state.highlightedSlot++;
            }
        }

        await this._saveAndBroadcastStage(state);
        this._notifySubscribers();
    }

    async updateSlot(slotIndex, updates) {
        const state = this.getStageState();
        if (slotIndex < 0 || slotIndex >= state.slots.length) return;
        const normalizedUpdates = normalizeSlotUpdates(updates);
        if (!Object.keys(normalizedUpdates).length) return;
        Object.assign(state.slots[slotIndex], normalizedUpdates);
        await this._saveAndBroadcastStage(state);
        this._notifySubscribers();
    }

    async assignActorToSlot(slotIndex, actorId) {
        const state = this.getStageState();
        if (slotIndex < 0 || slotIndex >= state.slots.length) return;
        const actor = actorId ? this.getActorById(actorId) : null;
        state.slots[slotIndex].actorId = actor ? actor.id : null;
        state.slots[slotIndex].actor = actor;
        await this._saveAndBroadcastStage(state);
        this._notifySubscribers();
    }

    async setHighlight(slotIndex) {
        const state = this.getStageState();
        const index = Number(slotIndex);
        state.highlightedSlot = Number.isInteger(index) && index >= 0 && index < state.slots.length ? index : -1;
        await this._saveAndBroadcastStage(state);
        this._notifySubscribers();
    }

    async clearStage() {
        const state = this.getStageState();
        state.slots = [];
        state.highlightedSlot = -1;
        await this._saveAndBroadcastStage(state);
        this._notifySubscribers();
    }

    // --- Comms / Call-In State ---

    getCommsState() {
        const state = foundry.utils.deepClone(getSetting('commsState') || {
            visible: false,
            calls: [],
            speakingCall: null
        });
        if (!Array.isArray(state.calls)) state.calls = [];
        // Backfill callId on existing entries missing it (migration)
        for (const call of state.calls) {
            if (!call.callId) call.callId = foundry.utils.randomID();
        }
        return state;
    }

    getFullCommsState() {
        const state = this.getCommsState();
        const actors = this.getActors();
        for (const call of state.calls) {
            call.actor = call.actorId ? (actors.find(a => a.id === call.actorId) || null) : null;
        }
        return state;
    }

    async setCommsVisible(visible) {
        const state = this.getCommsState();
        state.visible = visible === true;
        await this._saveAndBroadcastComms(state);
        this._notifySubscribers();
    }

    async addCall(actorId) {
        const actor = actorId ? this.getActorById(actorId) : null;
        if (!actor) return null;
        const state = this.getCommsState();

        // Re-ringing an actor already on the line just makes them the speaker.
        const existing = state.calls.find(c => c.actorId === actor.id);
        if (existing) {
            state.speakingCall = existing.callId;
            state.visible = true;
            await this._saveAndBroadcastComms(state);
            this._notifySubscribers();
            return existing.callId;
        }

        const callId = foundry.utils.randomID();
        state.calls.push({ callId, actorId: actor.id });
        state.visible = true;
        if (!state.speakingCall) state.speakingCall = callId;
        await this._saveAndBroadcastComms(state);
        this._notifySubscribers();
        return callId;
    }

    async hangUp(callId) {
        const state = this.getCommsState();
        const idx = state.calls.findIndex(c => c.callId === callId);
        if (idx === -1) return;
        state.calls.splice(idx, 1);
        if (state.speakingCall === callId) {
            state.speakingCall = state.calls[0]?.callId ?? null;
        }
        if (state.calls.length === 0) state.visible = false;
        await this._saveAndBroadcastComms(state);
        this._notifySubscribers();
    }

    async setSpeaker(callId) {
        const state = this.getCommsState();
        if (callId && !state.calls.some(c => c.callId === callId)) return;
        // Toggle: clicking the current speaker clears it.
        state.speakingCall = state.speakingCall === callId ? null : (callId || null);
        await this._saveAndBroadcastComms(state);
        this._notifySubscribers();
    }

    async reorderCalls(fromIndex, toIndex) {
        const state = this.getCommsState();
        if (fromIndex < 0 || fromIndex >= state.calls.length) return;
        if (toIndex < 0 || toIndex >= state.calls.length) return;
        if (fromIndex === toIndex) return;
        const [moved] = state.calls.splice(fromIndex, 1);
        state.calls.splice(toIndex, 0, moved);
        await this._saveAndBroadcastComms(state);
        this._notifySubscribers();
    }

    async clearComms() {
        const state = this.getCommsState();
        state.calls = [];
        state.speakingCall = null;
        state.visible = false;
        await this._saveAndBroadcastComms(state);
        this._notifySubscribers();
    }

    async _saveAndBroadcastComms(state) {
        // Strip resolved actor data before saving (only persist actorId).
        const toSave = foundry.utils.deepClone(state);
        for (const call of toSave.calls) delete call.actor;
        await setSetting('commsState', toSave);

        // Broadcast full state with resolved actors.
        emitSocket({
            type: SOCKET_EVENTS.UPDATE_COMMS,
            state: this.getFullCommsState()
        });
    }

    triggerAnimation(slotIndex, animation) {
        if (!game.user.isGM) return;
        emitSocket({
            type: SOCKET_EVENTS.TRIGGER_ANIMATION,
            slotIndex,
            animation
        });
    }

    // --- Internal ---

    async _saveAndBroadcastStage(state) {
        // Strip resolved actor data before saving (only save actorId)
        const toSave = foundry.utils.deepClone(state);
        for (const slot of toSave.slots) {
            delete slot.actor;
        }
        await setSetting('stageState', toSave);

        // Broadcast full state with resolved actors
        const fullState = this.getFullState();
        emitSocket({
            type: SOCKET_EVENTS.UPDATE_STAGE,
            state: fullState
        });
    }

    subscribe(callback) {
        this._callbacks.add(callback);
    }

    unsubscribe(callback) {
        this._callbacks.delete(callback);
    }

    _notifySubscribers() {
        for (const cb of this._callbacks) {
            try { cb(); } catch (err) {
                console.error(`${MODULE_ID} | Subscriber error:`, err);
            }
        }
    }
}
