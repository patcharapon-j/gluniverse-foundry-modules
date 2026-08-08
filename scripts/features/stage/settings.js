// Ported into the GLUniverse Suite: all settings/flags/sockets register under
// the single installed package id, and every setting key is prefixed with the
// feature prefix to avoid cross-feature collisions.
export const MODULE_ID = 'gluniverse-foundry-modules';
export const FEATURE_ID = 'stage';
const PREFIX = 'stage.';

/** Prefix a bare setting key with the feature prefix. */
function k(key) {
    return `${PREFIX}${key}`;
}

/**
 * Push the current post-processing configuration into the live overlay.
 * Settings register unconditionally (even when the feature is disabled), so
 * this has to tolerate there being no overlay yet.
 */
function notifyPostFXConfig() {
    const overlay = game.modules.get(MODULE_ID)?.stageOverlay;
    overlay?.updatePostFXConfig?.();
}

export function registerSettings() {
    // Stage height as percentage of viewport
    game.settings.register(MODULE_ID, k('stageHeight'), {
        name: game.i18n.localize('GLSTAGE.settings.stageHeight.name'),
        hint: game.i18n.localize('GLSTAGE.settings.stageHeight.hint'),
        scope: 'world',
        config: true,
        type: Number,
        default: 40,
        range: { min: 20, max: 100, step: 5 },
        onChange: () => {
            const overlay = game.modules.get(MODULE_ID)?.stageOverlay;
            if (overlay) overlay.updateLayout();
        }
    });

    // Stage width as percentage of viewport
    game.settings.register(MODULE_ID, k('stageWidth'), {
        name: game.i18n.localize('GLSTAGE.settings.stageWidth.name'),
        hint: game.i18n.localize('GLSTAGE.settings.stageWidth.hint'),
        scope: 'world',
        config: true,
        type: Number,
        default: 100,
        range: { min: 30, max: 100, step: 5 },
        onChange: () => {
            const overlay = game.modules.get(MODULE_ID)?.stageOverlay;
            if (overlay) overlay.updateLayout();
        }
    });

    // Stage-wide X offset (vw) — shifts entire stage horizontally
    game.settings.register(MODULE_ID, k('stageXOffset'), {
        scope: 'world',
        config: false,
        type: Number,
        default: 0,
        onChange: () => {
            const overlay = game.modules.get(MODULE_ID)?.stageOverlay;
            if (overlay) overlay.updateLayout();
        }
    });

    // Stage-wide Y offset (pixels) — shifts all characters vertically
    game.settings.register(MODULE_ID, k('stageYOffset'), {
        scope: 'world',
        config: false,
        type: Number,
        default: 0,
        onChange: () => {
            const overlay = game.modules.get(MODULE_ID)?.stageOverlay;
            if (overlay) overlay.updateLayout();
        }
    });

    // --- Character art post-processing ---

    // Master on/off. World-scoped: the GM decides the table's look.
    game.settings.register(MODULE_ID, k('ppEnabled'), {
        name: game.i18n.localize('GLSTAGE.settings.ppEnabled.name'),
        hint: game.i18n.localize('GLSTAGE.settings.ppEnabled.hint'),
        scope: 'world',
        config: true,
        type: Boolean,
        default: true,
        onChange: () => notifyPostFXConfig()
    });

    // One master strength dial. Deliberately not split into separate grade and
    // rim knobs — most GMs move both together, and two dials double the tuning
    // surface for no gain. Fine-tuning happens live in the Stage Director panel.
    game.settings.register(MODULE_ID, k('ppIntensity'), {
        name: game.i18n.localize('GLSTAGE.settings.ppIntensity.name'),
        hint: game.i18n.localize('GLSTAGE.settings.ppIntensity.hint'),
        scope: 'world',
        config: true,
        type: Number,
        default: 60,
        range: { min: 0, max: 100, step: 5 },
        onChange: () => notifyPostFXConfig()
    });

    // Which shading model the lighting uses. World-scoped alongside the strength
    // dial, because it is a decision about the table's art: a cast drawn in a
    // cel/anime style and a cast of painted portraits want different answers, and
    // mixing the two per client would put two looks on one stage.
    game.settings.register(MODULE_ID, k('ppStyle'), {
        name: game.i18n.localize('GLSTAGE.settings.ppStyle.name'),
        hint: game.i18n.localize('GLSTAGE.settings.ppStyle.hint'),
        scope: 'world',
        config: true,
        type: String,
        choices: {
            realistic: game.i18n.localize('GLSTAGE.settings.ppStyle.realistic'),
            cel: game.i18n.localize('GLSTAGE.settings.ppStyle.cel')
        },
        default: 'realistic',
        onChange: () => notifyPostFXConfig()
    });

    // Per-player escape hatch. Client-scoped so someone on a weak machine can
    // kill the shader without having to argue with the GM about the look.
    game.settings.register(MODULE_ID, k('ppQuality'), {
        name: game.i18n.localize('GLSTAGE.settings.ppQuality.name'),
        hint: game.i18n.localize('GLSTAGE.settings.ppQuality.hint'),
        scope: 'client',
        config: true,
        type: String,
        choices: {
            auto: game.i18n.localize('GLSTAGE.settings.ppQuality.auto'),
            off: game.i18n.localize('GLSTAGE.settings.ppQuality.off')
        },
        default: 'auto',
        onChange: () => notifyPostFXConfig()
    });

    // --- Comms / Call-In overlay ---

    // Visual theme for the call-in overlay
    game.settings.register(MODULE_ID, k('commsTheme'), {
        name: game.i18n.localize('GLSTAGE.settings.commsTheme.name'),
        hint: game.i18n.localize('GLSTAGE.settings.commsTheme.hint'),
        scope: 'world',
        config: true,
        type: String,
        choices: {
            scifi: game.i18n.localize('GLSTAGE.settings.commsTheme.scifi'),
            ethereal: game.i18n.localize('GLSTAGE.settings.commsTheme.ethereal'),
            minimal: game.i18n.localize('GLSTAGE.settings.commsTheme.minimal')
        },
        default: 'scifi',
        onChange: () => {
            const overlay = game.modules.get(MODULE_ID)?.commsOverlay;
            if (overlay) overlay.updateLayout();
        }
    });

    // Which screen edge the call-in stack anchors to
    game.settings.register(MODULE_ID, k('commsEdge'), {
        name: game.i18n.localize('GLSTAGE.settings.commsEdge.name'),
        hint: game.i18n.localize('GLSTAGE.settings.commsEdge.hint'),
        scope: 'world',
        config: true,
        type: String,
        choices: {
            right: game.i18n.localize('GLSTAGE.settings.commsEdge.right'),
            left: game.i18n.localize('GLSTAGE.settings.commsEdge.left')
        },
        default: 'right',
        onChange: () => {
            const overlay = game.modules.get(MODULE_ID)?.commsOverlay;
            if (overlay) overlay.updateLayout();
        }
    });

    // How the call-in stack anchors vertically: centred, from the top, or from
    // the bottom. The vertical offset below is then measured relative to it.
    game.settings.register(MODULE_ID, k('commsVAlign'), {
        name: game.i18n.localize('GLSTAGE.settings.commsVAlign.name'),
        hint: game.i18n.localize('GLSTAGE.settings.commsVAlign.hint'),
        scope: 'world',
        config: true,
        type: String,
        choices: {
            centered: game.i18n.localize('GLSTAGE.settings.commsVAlign.centered'),
            top: game.i18n.localize('GLSTAGE.settings.commsVAlign.top'),
            bottom: game.i18n.localize('GLSTAGE.settings.commsVAlign.bottom')
        },
        default: 'centered',
        onChange: () => {
            const overlay = game.modules.get(MODULE_ID)?.commsOverlay;
            if (overlay) overlay.updateLayout();
        }
    });

    // Width of each call-in card (px)
    game.settings.register(MODULE_ID, k('commsFrameWidth'), {
        name: game.i18n.localize('GLSTAGE.settings.commsFrameWidth.name'),
        hint: game.i18n.localize('GLSTAGE.settings.commsFrameWidth.hint'),
        scope: 'world',
        config: true,
        type: Number,
        default: 170,
        range: { min: 110, max: 300, step: 10 },
        onChange: () => {
            const overlay = game.modules.get(MODULE_ID)?.commsOverlay;
            if (overlay) overlay.updateLayout();
        }
    });

    // Spacing of the stack away from its screen edge (px)
    game.settings.register(MODULE_ID, k('commsEdgeOffset'), {
        name: game.i18n.localize('GLSTAGE.settings.commsEdgeOffset.name'),
        hint: game.i18n.localize('GLSTAGE.settings.commsEdgeOffset.hint'),
        scope: 'world',
        config: true,
        type: Number,
        default: 18,
        range: { min: 0, max: 200, step: 2 },
        onChange: () => {
            const overlay = game.modules.get(MODULE_ID)?.commsOverlay;
            if (overlay) overlay.updateLayout();
        }
    });

    // Vertical offset of the stack relative to its anchor (vh): nudges from the
    // centre, or sets the gap from the top/bottom edge when anchored there.
    game.settings.register(MODULE_ID, k('commsTopOffset'), {
        name: game.i18n.localize('GLSTAGE.settings.commsTopOffset.name'),
        hint: game.i18n.localize('GLSTAGE.settings.commsTopOffset.hint'),
        scope: 'world',
        config: true,
        type: Number,
        default: 0,
        range: { min: -40, max: 40, step: 1 },
        onChange: () => {
            const overlay = game.modules.get(MODULE_ID)?.commsOverlay;
            if (overlay) overlay.updateLayout();
        }
    });

    // Hidden setting: current call-in state
    game.settings.register(MODULE_ID, k('commsState'), {
        scope: 'world',
        config: false,
        type: Object,
        default: {
            visible: false,
            calls: [],
            speakingCall: null
        }
    });

    // Hidden setting: actor library (GM configured actors)
    game.settings.register(MODULE_ID, k('actorLibrary'), {
        scope: 'world',
        config: false,
        type: Array,
        default: []
    });

    // Hidden setting: current stage state
    game.settings.register(MODULE_ID, k('stageState'), {
        scope: 'world',
        config: false,
        type: Object,
        default: {
            visible: false,
            slots: [],
            highlightedSlot: -1
        }
    });
}

export function getSetting(key) {
    return game.settings.get(MODULE_ID, k(key));
}

export function setSetting(key, value) {
    return game.settings.set(MODULE_ID, k(key), value);
}
