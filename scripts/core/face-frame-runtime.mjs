/**
 * GLUniverse Suite — the face locator's detection runtime.
 *
 * Everything that turns an image URL into a cache entry: fetching and decoding the art,
 * loading onnxruntime-web and the two head detectors, and running them. It needs no DOM
 * and no Foundry global, so the same code runs in `face-frame-worker.mjs` (the normal path,
 * off the main thread) and, where a module worker with OffscreenCanvas is unavailable, on
 * the main thread through `pause` hooks that yield between stages.
 *
 * Both paths produce the entry through `compactResult`, so their results are identical.
 */

import * as lib from "../vendor/face-frame/face-frame.mjs";
import { compactResult } from "./face-frame-math.mjs";

/** Keep equal to the bundled onnxruntime-web (see scripts/vendor/face-frame/README.md). */
export const ORT_VERSION = "1.30.0";
const ORT_PROBE = "ort-wasm-simd-threaded.asyncify.wasm";
const ORT_MODULE = new URL("../vendor/face-frame/ort.webgpu.min.mjs", import.meta.url).href;

/**
 * @typedef {object} FramerConfig
 * @property {string} modelsUrl  Absolute URL of `Data/face-frame-models` (no trailing slash).
 * @property {boolean} creatures Whether the OWLv2 creature pass may run (it still needs WebGPU).
 */

/**
 * Builds a framer for `config`. `pause` (optional) is awaited before and after every model
 * run and before each session is created, so a main-thread caller can yield to rendering.
 * @param {FramerConfig} config
 * @param {{pause?: () => Promise<void>}} [hooks]
 */
export async function createFramer(config, { pause } = {}) {
  const wasmPaths = await resolveWasmPaths(`${config.modelsUrl}/ort/`);
  const adapter = await gpuAdapter();
  return lib.createWebFramer({
    sources: [lib.localSource(config.modelsUrl), lib.remoteSource],
    wasmPaths,
    // Probing for an adapter (not just `navigator.gpu`) keeps a GPU-less browser from
    // failing a WebGPU session per model before falling back to WebAssembly.
    devices: adapter ? ["webgpu", "wasm"] : ["wasm"],
    loadOrt: () => loadOrt(wasmPaths, adapter, pause),
    // Creatures need OWLv2, which is only practical on WebGPU; the library keeps it off otherwise.
    ...(config.creatures && adapter ? {} : { tier2: false })
  });
}

/** Fetches, decodes and analyses one image. Resolves with a FaceEntry (without its mode). */
export async function analyseUrl(framer, url, { pause } = {}) {
  const px = await loadPixels(url);
  await pause?.();
  return compactResult(await framer.detect(px));
}

/** True where this context can decode art off-DOM (always needed in the worker). */
export function canDecodeOffscreen() {
  return typeof OffscreenCanvas === "function" && typeof createImageBitmap === "function";
}

/**
 * The library's decoder (fetch with CORS, `createImageBitmap` without premultiplying or
 * colour conversion, one `getImageData`), with a DOM canvas standing in for OffscreenCanvas
 * on a main thread that lacks it. Both give the same pixels.
 */
async function loadPixels(url) {
  if (canDecodeOffscreen() || typeof document === "undefined") return lib.loadPixels(url);
  const res = await fetch(url, { mode: "cors" }).catch(() => fetch(url, { mode: "cors", cache: "reload" }));
  if (!res.ok) throw new Error(`face-frame: ${url} returned HTTP ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    return { data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/** onnxruntime's WebAssembly from the local models folder when it is there, else the CDN. */
export async function resolveWasmPaths(local) {
  try {
    const res = await fetch(`${local}${ORT_PROBE}`, { method: "HEAD" });
    if (res.ok) return local;
  } catch {
    // Not served locally.
  }
  return `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
}

async function gpuAdapter() {
  try {
    return (await globalThis.navigator?.gpu?.requestAdapter()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Threads need SharedArrayBuffer, i.e. a cross-origin isolated context; Foundry is normally
 * not one. When it is, use half the cores (at most 4), leaving the rest to the page.
 */
function wasmThreads() {
  if (!globalThis.crossOriginIsolated) return 1;
  const cores = globalThis.navigator?.hardwareConcurrency || 2;
  return Math.min(4, Math.max(1, Math.ceil(cores / 2)));
}

async function loadOrt(wasmPaths, adapter, pause) {
  const ort = await import(ORT_MODULE);
  ort.env.wasm.wasmPaths = wasmPaths;
  ort.env.wasm.numThreads = wasmThreads();
  // Already off the main thread in the worker; the main-thread fallback yields instead.
  ort.env.wasm.proxy = false;
  if (adapter) ort.env.webgpu.adapter = adapter;
  return pause ? yieldingOrt(ort, pause) : ort;
}

/**
 * The parts of onnxruntime the library uses (`env`, `Tensor`, `InferenceSession.create`,
 * `session.run/inputNames/outputNames`), with `pause` awaited around each heavy step, so a
 * main-thread detection is several shorter tasks instead of one long one.
 */
function yieldingOrt(ort, pause) {
  return {
    env: ort.env,
    Tensor: ort.Tensor,
    InferenceSession: {
      async create(...args) {
        await pause();
        const session = await ort.InferenceSession.create(...args);
        await pause();
        return {
          get inputNames() { return session.inputNames; },
          get outputNames() { return session.outputNames; },
          release: () => session.release(),
          async run(...runArgs) {
            await pause();
            const out = await session.run(...runArgs);
            await pause();
            return out;
          }
        };
      }
    }
  };
}
