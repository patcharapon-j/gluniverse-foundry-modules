GLUniverse face-frame 0.1.0 (core build) and onnxruntime-web 1.30.0 (`ort.webgpu.min.mjs`, MIT, Microsoft).

Head detection for portrait framing, used by `scripts/core/face-frame.mjs`: two YOLOv11
head detectors (anime and realistic art) and, for creatures, OWLv2 on WebGPU.

Files:

- `face-frame.mjs` — `pnpm build:vendor` output from the face-frame repo
  (`dist-vendor/face-frame.js`), unmodified. onnxruntime-web is not bundled into it; the
  suite passes `loadOrt` pointing at the file below.
- `ort.webgpu.min.mjs` — `onnxruntime-web/dist/ort.webgpu.min.mjs`, unmodified. It loads
  its WebAssembly runtime (`ort-wasm-simd-threaded.asyncify.{mjs,wasm}`, ~27 MB) from
  `wasmPaths` at runtime, which is why neither is committed here.

Nothing large is committed. At runtime the locator loads, in order:

1. `Data/face-frame-models/` in Foundry's user data (models, and `ort/` for the
   WebAssembly runtime). Fill it with `pnpm models` in the face-frame repo and copy
   `models/*` there; with it in place a world needs no network.
2. Hugging Face (models) and jsDelivr (WebAssembly runtime), cached by the browser.

| Model | Size | License |
|---|---|---|
| deepghs `anime_head_detection/head_detect_v2.0_s_yv11` | 38 MB | AGPL-3.0 (Ultralytics YOLO) |
| deepghs `real_head_detection/head_detect_v0_s_yv11` | 38 MB | AGPL-3.0 (Ultralytics YOLO) |
| `Xenova/owlv2-base-patch16-ensemble` fp16 (creatures, WebGPU only) | 308 MB | Apache-2.0 |

Unlike `../mediapipe`, the ORT loader needs no patch: its Emscripten glue is built as an
ES module factory and never reads or writes the global `Module` that Foundry defines.

Update: rebuild in the face-frame repo, copy both files, bump the versions above, and
keep `ORT_VERSION` in `scripts/core/face-frame.mjs` equal to the bundled onnxruntime-web.
