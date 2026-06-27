import { MODULE_ID, registerSettings } from './settings.js';
import { ensureSuiteGroup } from '../../core/scene-controls.mjs';
import { initializeSocket, requestStateSync } from './socket-handler.js';
import { StageManager } from './StageManager.js';
import { StageOverlay } from './StageOverlay.js';
import { CommsOverlay } from './CommsOverlay.js';
import { GMPanel } from './GMPanel.js';

export { registerSettings };

// The public API object. Created lazily in `onReady`, but defined here so the
// adapter can hand the suite a stable reference and `globalThis.GLUniverseStage`
// can mirror it. Methods resolve their state at call time.
export const api = {
    openPanel: () => {
        if (!game.user.isGM) {
            ui.notifications.warn('Only the GM can open the Stage Director panel.');
            return;
        }
        new GMPanel().render({ force: true });
    },
    getManager: () => StageManager.getInstance(),
    getOverlay: () => game.modules.get(MODULE_ID)?.stageOverlay ?? null,
    getCommsOverlay: () => game.modules.get(MODULE_ID)?.commsOverlay ?? null
};

/** Everything that used to run in the standalone module's `init` hook. */
export function onInit() {
    console.log(`${MODULE_ID} | Initializing GLUniverse Stage`);

    // Add scene control button for GM under the suite's own top-level group.
    Hooks.on('getSceneControlButtons', (controls) => {
        if (!game.user.isGM) return;

        const group = ensureSuiteGroup(controls);
        if (group) {
            group.tools.gluniverseStage = {
                name: 'gluniverseStage',
                title: 'GLUniverse Stage Director',
                icon: 'fa-solid fa-theater-masks',
                order: Object.keys(group.tools).length,
                button: true,
                visible: true,
                onChange: () => {
                    const existing = foundry.applications.instances.get('gluniverse-stage-panel');
                    if (existing) existing.close();
                    else new GMPanel().render({ force: true });
                }
            };
        }
    });
}

/** Everything that used to run in the standalone module's `ready` hook. */
export function onReady() {
    console.log(`${MODULE_ID} | Ready`);

    const mod = game.modules.get(MODULE_ID);

    // Create the stage overlay (all clients)
    const overlay = new StageOverlay();
    overlay.render();
    mod.stageOverlay = overlay;

    // Create the comms / call-in overlay (all clients)
    const commsOverlay = new CommsOverlay();
    commsOverlay.render();
    mod.commsOverlay = commsOverlay;

    // Create the stage manager (singleton)
    const mgr = StageManager.getInstance();
    mod.stageManager = mgr;

    // Initialize socket communication
    initializeSocket(
        // onStageUpdate
        (state) => overlay.applyState(state),
        // onAnimation
        (slotIndex, animation) => overlay.playAnimation(slotIndex, animation),
        // onCommsUpdate
        (state) => commsOverlay.applyState(state)
    );

    // If GM, load saved state into overlays immediately
    if (game.user.isGM) {
        overlay.applyState(mgr.getFullState());
        commsOverlay.applyState(mgr.getFullCommsState());
    } else {
        // Players request sync from GM (stage + comms)
        requestStateSync();
    }

    // Expose API (keep the original global for backwards compatibility).
    globalThis.GLUniverseStage = api;
}
