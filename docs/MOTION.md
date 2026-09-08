# Suite motion

The suite uses local Anime.js 4.5.0 for authored presentation sequences. Shared CSS motion remains in `styles/gl-motion.css`; PIXI/WebGL renderers keep their own frame clocks. The vendored files are unmodified upstream ESM modules with the MIT license and package integrity recorded in `scripts/vendor/animejs/README.md`. Foundry loads them directly, without a build or CDN.

Import animation APIs through `scripts/core/motion.mjs`. Resolve decorative duration with `motionDuration(ms, root)` so it follows the existing suite/feature motion scale. For detached markup, resolve inherited settings from its eventual mounted scope. Feature-specific timing multipliers still belong to the feature.

Use `createMotionOwner()` for a disposable root, or explicit named channels where one element has independent layout/content/visibility work. Register timelines with `autoplay: false`, finish building and tracking them, then play. This also makes zero-duration callbacks safe. Clear/revert before replacing DOM or closing UI. Reversion does not remove external event listeners, stop sound/media, destroy GPU resources, or settle a queue; the feature must do that explicitly. Keep final-state and cancellation handlers idempotent.

One system must own a given element/property while it animates. Suppress conflicting CSS transitions/keyframes only on the animated targets. Keep positioning transforms separate from decorative motion, or animate the complete transform consistently. Remove temporary clipping when a panel's depth layers need to overflow after arrival.

| Feature | Motion ownership |
| --- | --- |
| Insight | Edge/cut/card/content reveal and audio cues share a timeline; dismissal freezes the reveal, preserves centering and releases the queue once. |
| Stage | Visibility, slot content, layout and exit have separate cancellable channels; new actor assignments invalidate pending swaps. |
| Initiative | Rail movement uses existing FLIP variables and round continuity; collect ghosts and per-kind splashes own cleanup. |
| Clocks Tracker | Delving reels land on stored results before discard reveal; HUD width animation releases intrinsic sizing after settling. |
| Stream Pacer | Dire Peril title cascade, stage fade and indicator handoff share a timeline; dismissal invalidates pending rendering immediately. |
| Critical | One paused, seekable Anime.js beat sheet drives both portrait and video presentation from their existing renderer clocks; watchdogs release the queue in hidden tabs. |
| Destiny Dice | Fresh results reveal once; repeat/historical renders remain static, with body motion tiers available before chat DOM attachment. |
| Timer | Entrance, urgency emphasis and expiry accents are decorative. Remaining time, pause and expiry continue to derive from authoritative state. |

Do not use animation progress to compute game state, determine dice results, enforce permissions, or time network operations. Do not add OS motion preference checks; retain the suite's explicit in-app settings.

## Verification

Run the normal repository syntax and JSON/manifest checks, then:

```sh
node tools/clocks-pacer-motion-check.mjs
node tools/critical-timer-motion-check.mjs
node tools/insight-destiny-motion-check.mjs
node tools/stream-pacer-safety-check.mjs
node tools/insight-preview.mjs
node tools/preview-server.mjs 8937
```

Open `http://127.0.0.1:8937/tools/templates/motion-preview.html` and select **Run browser checks**. These import the production classes and actual Anime.js modules to exercise replacement, interruption, zero motion, outcomes, endpoint styles and cleanup. The workshop also offers Timer, delving pool, Peril and Critical presentation controls. The Insight link opens a multi-preset preview using production rendering.

The workshop supplies lightweight Foundry fixtures. It verifies browser presentation, not live multiplayer synchronization, Dice So Nice playback, GPU performance, or every Foundry window layout. Before release, smoke-test those integrations in a world with the eight features enabled, including long localized labels, rapid turns, repeated reveals and scene changes. No frame-rate improvement is claimed from the library migration alone.

`tools/insight-preview.mjs --artifact=<path>` exports a portable **static settled-state reference**, explicitly labeled as such. Animation previews require the local server and production modules.
