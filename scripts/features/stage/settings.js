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
            cel: game.i18n.localize('GLSTAGE.settings.ppStyle.cel'),
            rim: game.i18n.localize('GLSTAGE.settings.ppStyle.rim')
        },
        default: 'realistic',
        onChange: () => notifyPostFXConfig()
    });

    // --- The reference match ---
    //
    // Four dials, and the reason there are four rather than one is the whole
    // point of them. A single "match the background" slider gives a GM who does
    // not like the result nothing to do but turn it down, which throws away the
    // three parts that were working. Split, the failure names itself: a cast
    // that has gone too far is a different complaint from a figure that has been
    // flattened, and each has its own slider sitting next to it.
    //
    // All four are inert at 0, and 0 across all four is the look this feature
    // had before any of it existed — so a world that dislikes the whole idea can
    // return to the previous behaviour exactly rather than approximately.

    // The one most GMs actually want. "Why does this character look pasted on"
    // is a colour-temperature complaint far more often than anything else.
    game.settings.register(MODULE_ID, k('ppMatchCast'), {
        name: game.i18n.localize('GLSTAGE.settings.ppMatchCast.name'),
        hint: game.i18n.localize('GLSTAGE.settings.ppMatchCast.hint'),
        scope: 'world',
        config: true,
        type: Number,
        default: 70,
        range: { min: 0, max: 100, step: 5 },
        onChange: () => notifyPostFXConfig()
    });

    game.settings.register(MODULE_ID, k('ppMatchSat'), {
        name: game.i18n.localize('GLSTAGE.settings.ppMatchSat.name'),
        hint: game.i18n.localize('GLSTAGE.settings.ppMatchSat.hint'),
        scope: 'world',
        config: true,
        type: Number,
        default: 60,
        range: { min: 0, max: 100, step: 5 },
        onChange: () => notifyPostFXConfig()
    });

    // Lower than cast, deliberately. Level and contrast move the art's own
    // drawing rather than the light on it, and a portrait's contrast is a
    // decision its artist made — overriding that wholesale is how a grade starts
    // damaging the thing it was meant to seat.
    game.settings.register(MODULE_ID, k('ppMatchBright'), {
        name: game.i18n.localize('GLSTAGE.settings.ppMatchBright.name'),
        hint: game.i18n.localize('GLSTAGE.settings.ppMatchBright.hint'),
        scope: 'world',
        config: true,
        type: Number,
        default: 50,
        range: { min: 0, max: 100, step: 5 },
        onChange: () => notifyPostFXConfig()
    });

    game.settings.register(MODULE_ID, k('ppMatchTone'), {
        name: game.i18n.localize('GLSTAGE.settings.ppMatchTone.name'),
        hint: game.i18n.localize('GLSTAGE.settings.ppMatchTone.hint'),
        scope: 'world',
        config: true,
        type: Number,
        default: 50,
        range: { min: 0, max: 100, step: 5 },
        onChange: () => notifyPostFXConfig()
    });

    // How hard skin resists the two chromatic dials above. Default high: a
    // viewer's tolerance for a shifted skin tone is far narrower than for any
    // other colour in the frame, because it is the one hue everybody has a
    // lifetime of reference for. Turning this down is a legitimate choice for a
    // cast that isn't human, which is why it is a dial and not a constant.
    game.settings.register(MODULE_ID, k('ppSkinGuard'), {
        name: game.i18n.localize('GLSTAGE.settings.ppSkinGuard.name'),
        hint: game.i18n.localize('GLSTAGE.settings.ppSkinGuard.hint'),
        scope: 'world',
        config: true,
        type: Number,
        default: 75,
        range: { min: 0, max: 100, step: 5 },
        onChange: () => notifyPostFXConfig()
    });

    // --- The light kit ---
    //
    // These two are multipliers over whatever the chosen style already says, so
    // 100 is "the style's own balance" rather than a fixed quantity — a GM
    // turning the wrap up on a cel stage still gets cel proportions.

    game.settings.register(MODULE_ID, k('ppWrap'), {
        name: game.i18n.localize('GLSTAGE.settings.ppWrap.name'),
        hint: game.i18n.localize('GLSTAGE.settings.ppWrap.hint'),
        scope: 'world',
        config: true,
        type: Number,
        default: 100,
        range: { min: 0, max: 200, step: 10 },
        onChange: () => notifyPostFXConfig()
    });

    game.settings.register(MODULE_ID, k('ppBacklight'), {
        name: game.i18n.localize('GLSTAGE.settings.ppBacklight.name'),
        hint: game.i18n.localize('GLSTAGE.settings.ppBacklight.hint'),
        scope: 'world',
        config: true,
        type: Number,
        default: 100,
        range: { min: 0, max: 200, step: 10 },
        onChange: () => notifyPostFXConfig()
    });

    // Blank means "derive it from the room", which is what all three colour
    // overrides do until a GM says otherwise. An unparseable value is treated as
    // blank rather than rejected — a half-typed hex must not black out the cast.
    game.settings.register(MODULE_ID, k('ppBacklightColor'), {
        name: game.i18n.localize('GLSTAGE.settings.ppBacklightColor.name'),
        hint: game.i18n.localize('GLSTAGE.settings.ppBacklightColor.hint'),
        scope: 'world',
        config: true,
        type: String,
        default: '',
        onChange: () => notifyPostFXConfig()
    });

    game.settings.register(MODULE_ID, k('ppFillColor'), {
        name: game.i18n.localize('GLSTAGE.settings.ppFillColor.name'),
        hint: game.i18n.localize('GLSTAGE.settings.ppFillColor.hint'),
        scope: 'world',
        config: true,
        type: String,
        default: '',
        onChange: () => notifyPostFXConfig()
    });

    // Spill reach. 100 is the falloff the shader had before it was adjustable.
    game.settings.register(MODULE_ID, k('ppGlowRadius'), {
        name: game.i18n.localize('GLSTAGE.settings.ppGlowRadius.name'),
        hint: game.i18n.localize('GLSTAGE.settings.ppGlowRadius.hint'),
        scope: 'world',
        config: true,
        type: Number,
        default: 100,
        range: { min: 25, max: 200, step: 5 },
        onChange: () => notifyPostFXConfig()
    });

    // How bright the art has to be just inside the outline before it throws any
    // light at all. 0 clears everything but true black, so the dial starts inert
    // and raising it confines the glow to what is actually lit.
    game.settings.register(MODULE_ID, k('ppGlowSense'), {
        name: game.i18n.localize('GLSTAGE.settings.ppGlowSense.name'),
        hint: game.i18n.localize('GLSTAGE.settings.ppGlowSense.hint'),
        scope: 'world',
        config: true,
        type: Number,
        default: 0,
        range: { min: 0, max: 100, step: 5 },
        onChange: () => notifyPostFXConfig()
    });

    // Absolute rather than a multiplier, and off by default: halation is a
    // statement about a *lens*, and none of the three styles is one. It is the
    // one term here a table has to ask for.
    game.settings.register(MODULE_ID, k('ppHalation'), {
        name: game.i18n.localize('GLSTAGE.settings.ppHalation.name'),
        hint: game.i18n.localize('GLSTAGE.settings.ppHalation.hint'),
        scope: 'world',
        config: true,
        type: Number,
        default: 0,
        range: { min: 0, max: 100, step: 5 },
        onChange: () => notifyPostFXConfig()
    });

    game.settings.register(MODULE_ID, k('ppHalationColor'), {
        name: game.i18n.localize('GLSTAGE.settings.ppHalationColor.name'),
        hint: game.i18n.localize('GLSTAGE.settings.ppHalationColor.hint'),
        scope: 'world',
        config: true,
        type: String,
        default: '',
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
