MediaPipe Tasks Vision 1.0.1, Apache-2.0, Google.

Face detection for the `stream-cards` feature: portrait art is framed on the
face it finds, falling back to `../smartcrop/` when it finds none. Bundled
locally — a Foundry world is routinely run offline or on a LAN, so nothing here
may reach the network at runtime.

Files:

- `vision_bundle.mjs` — the published ESM bundle, **patched**. See `PATCHES.md`.
- `wasm/vision_wasm_internal.{js,wasm}` — the Emscripten runtime it loads.
- `blaze_face_short_range.tflite` — the detector model.

Retain LICENSE when updating. **Re-apply the patch in `PATCHES.md` on every
update**: without it the loader collides with Foundry's own global `Module` and
face detection fails at load, which degrades silently to the smartcrop fallback
rather than erroring.

Source: https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-1.0.1.tgz
