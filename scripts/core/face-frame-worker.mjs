/**
 * GLUniverse Suite — face locator worker.
 *
 * A dedicated module worker that fetches, decodes and analyses art for the face locator,
 * so none of that (full-resolution pixel reads, transparency and ring scans, the resize
 * to 640 and both YOLO runs) blocks the Foundry client. Started by `face-frame.mjs`
 * with `new Worker(new URL(...), { type: "module" })`; not listed in module.json, and
 * must not be, since loading it on the page would run it on the main thread.
 *
 * Protocol (one job at a time; the locator's queue is serial):
 *   worker -> page  {type: "ready", ok}                 once, after the imports resolve
 *   page -> worker  {type: "detect", id, url, config}   config: FramerConfig
 *   worker -> page  {type: "result", id, entry}  |  {type: "result", id, error}
 *
 * A framer is kept per config, like the main-thread locator kept one per mode; a failed
 * load stays failed until the config changes or the locator replaces this worker.
 */

import { analyseUrl, canDecodeOffscreen, createFramer } from "./face-frame-runtime.mjs";

let framerKey = null;
let framerPromise = null;

self.addEventListener("message", async ({ data }) => {
  if (data?.type !== "detect") return;
  const { id, url, config } = data;
  try {
    const key = JSON.stringify(config);
    if (key !== framerKey) {
      framerKey = key;
      framerPromise = createFramer(config);
      framerPromise.catch(() => {});
    }
    const entry = await analyseUrl(await framerPromise, url);
    self.postMessage({ type: "result", id, entry });
  } catch (error) {
    self.postMessage({ type: "result", id, error: String(error?.stack ?? error?.message ?? error) });
  }
});

// `ok: false` (no OffscreenCanvas in workers here) sends the locator to its main-thread fallback.
self.postMessage({ type: "ready", ok: canDecodeOffscreen() });
