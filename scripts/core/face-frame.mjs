/**
 * GLUniverse Suite — shared face locator.
 *
 * Finds the head in character, creature and token art so portraits can be framed on
 * it, using the vendored face-frame library (two YOLO head detectors for anime and
 * realistic art, plus OWLv2 for creatures when the GM enables it and WebGPU is
 * available). One locator serves every feature: images are analysed one at a time,
 * in the background, and the result is cached per image path.
 *
 * Caches, read in this order:
 *  - the world cache (`core.faceFrameCache`), written only by a GM client, so players
 *    and the stream client reuse the GM's results without downloading any model;
 *  - this browser's storage, for anything the world cache does not have yet.
 *
 * A player's client asks the active GM to analyse an image it needs and waits for the
 * world cache before analysing it locally, so players only download models when no GM
 * is online or the GM's client cannot run them.
 *
 * Models and onnxruntime's WebAssembly load from `Data/face-frame-models/` first and
 * fall back to Hugging Face and jsDelivr, so an offline world only needs that folder
 * (see scripts/vendor/face-frame/README.md). Nothing loads until a feature asks.
 */

import { SUITE_ID, suitePath, warn } from "./const.mjs";
import { emitSocket, onSocket } from "./socket.mjs";
import * as lib from "../vendor/face-frame/face-frame.mjs";
import { compactResult, coverPlacement, cropFor, isFaceEntry, PRESETS, viewBoxStyle } from "./face-frame-math.mjs";

export const SETTING_FACE_FRAME = "core.faceFrame";
export const SETTING_FACE_FRAME_CACHE = "core.faceFrameCache";

/** GM choice: which detectors run. */
export const FACE_FRAME_MODES = Object.freeze({ off: "off", heads: "heads", creatures: "creatures" });

const LOCAL_KEY = `${SUITE_ID}.faceFrame.v1`;
const LOCAL_LIMIT = 400;
const WORLD_LIMIT = 800;
const WORLD_WRITE_DELAY = 4000;
const MODELS_DIR = "face-frame-models";
const ORT_VERSION = "1.30.0";
const ORT_PROBE = "ort-wasm-simd-threaded.asyncify.wasm";
const SOCKET_TAG = "core.faceFrame";
/** How long a player waits for the GM's result before analysing an image itself. */
const GM_WAIT_MS = 45000;

export function registerFaceFrameSettings() {
  game.settings.register(SUITE_ID, SETTING_FACE_FRAME, {
    name: "GLS.config.faceFrame.name",
    hint: "GLS.config.faceFrame.hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      [FACE_FRAME_MODES.off]: "GLS.config.faceFrame.off",
      [FACE_FRAME_MODES.heads]: "GLS.config.faceFrame.heads",
      [FACE_FRAME_MODES.creatures]: "GLS.config.faceFrame.creatures"
    },
    default: FACE_FRAME_MODES.heads,
    onChange: () => faceLocator.reset()
  });

  game.settings.register(SUITE_ID, SETTING_FACE_FRAME_CACHE, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: value => faceLocator.adoptWorld(value)
  });
}

const SOCKET_OPS = new Set(["request", "forget", "result"]);

/**
 * Player <-> GM messages. Players send `request` and `forget`; the active GM answers each with a
 * `result` (the entry, or null when its analysis failed). Called once at ready, after the socket
 * dispatcher is wired.
 */
export function initFaceFrameSocket() {
  onSocket(SOCKET_TAG, payload => faceLocator.handleSocket(payload), { validate: isSocketPayload });
}

export function isSocketPayload(payload) {
  return SOCKET_OPS.has(payload?.op)
    && typeof payload.src === "string" && payload.src.length > 0 && payload.src.length <= 2048
    && (payload.op !== "result" || payload.entry === null || isFaceEntry(payload.entry));
}

/** True when an actor, prototype token or placed token in this world shows `src`. */
function isWorldArt(src) {
  for (const actor of game.actors ?? []) {
    if (actor.img === src || actor.prototypeToken?.texture?.src === src) return true;
  }
  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens ?? []) {
      if (token.texture?.src === src || token.actor?.img === src) return true;
    }
  }
  return false;
}

export class FaceLocator {
  constructor() {
    /** src -> FaceEntry | null (null: analysed, nothing usable) */
    this.local = loadLocal();
    /** src -> FaceEntry, the GM-shared results */
    this.world = null;
    /** src -> Promise */
    this.inflight = new Map();
    /** Sources whose failure may be temporary: never written to storage. */
    this.unsaved = new Set();
    this.queue = [];
    this.draining = false;
    this.framerPromise = null;
    this.worldTimer = null;
    this.listeners = new Set();
    this.warned = false;
    /** src -> resolver, for player requests waiting on the GM */
    this.worldWaiters = new Map();
    /** src -> FaceEntry, GM answers this session, until the world cache catches up */
    this.replied = new Map();
    /** src -> the world entry a player forgot, ignored until the world cache changes it */
    this.ignored = new Map();
    this.sharePending = false;
  }

  get mode() {
    try {
      return game.settings.get(SUITE_ID, SETTING_FACE_FRAME);
    } catch {
      return FACE_FRAME_MODES.off;
    }
  }

  get enabled() {
    return this.mode !== FACE_FRAME_MODES.off;
  }

  /** The cached entry, null (analysed, no head), or undefined when not analysed yet. */
  peek(src) {
    if (!src || !this.enabled) return null;
    if (!this.ignored.has(src)) {
      const shared = this.worldCache()[src];
      if (isFaceEntry(shared) && this.isCurrent(shared)) return shared;
    }
    const replied = this.replied.get(src);
    if (replied && this.isCurrent(replied)) return replied;
    if (!this.local.has(src)) return undefined;
    const entry = this.local.get(src);
    return entry === null || this.isCurrent(entry) ? entry : undefined;
  }

  /**
   * False for "no head" found without the creature pass while creatures are now enabled: that
   * art gets a second look. Entries record the mode they were analysed in.
   */
  isCurrent(entry) {
    return !(this.mode === FACE_FRAME_MODES.creatures && entry.k !== "s" && entry.m !== FACE_FRAME_MODES.creatures);
  }

  /** Resolves with the image's entry (or null), analysing it first if needed. */
  request(src) {
    // Vector icons (Foundry's defaults) have no face to find.
    if (/\.svg(?:[?#]|$)/i.test(src ?? "")) return Promise.resolve(null);
    const known = this.peek(src);
    if (known !== undefined) return Promise.resolve(known);
    if (this.inflight.has(src)) return this.inflight.get(src);
    const promise = this.awaitGM(src).then(shared => {
      if (shared === undefined) {
        return new Promise(resolve => {
          this.queue.push({ src, resolve });
          this.drain();
        });
      }
      this.notify(src, shared);
      return shared;
    });
    this.inflight.set(src, promise);
    promise.finally(() => {
      if (this.inflight.get(src) === promise) this.inflight.delete(src);
    });
    return promise;
  }

  /**
   * On a player's client with a GM online: ask the GM to analyse `src` and resolve with its result
   * once it reaches the world cache, or undefined after a while (the caller then analyses locally).
   */
  awaitGM(src) {
    const gm = game.users?.activeGM;
    if (!gm || gm === game.user) return Promise.resolve(undefined);
    return new Promise(resolve => {
      const done = entry => {
        clearTimeout(timer);
        this.worldWaiters.delete(src);
        resolve(entry);
      };
      const timer = setTimeout(() => done(undefined), GM_WAIT_MS);
      this.worldWaiters.set(src, done);
      emitSocket(SOCKET_TAG, { op: "request", src });
    });
  }

  handleSocket(payload) {
    const { op, src } = payload;
    // Results only resolve a waiting request on a client that asked, and are only as trusted as
    // the framing they change: a forged one can at worst misframe a portrait for one session.
    if (op === "result") return this.gmReplied(src, payload.entry);
    if (game.users?.activeGM !== game.user || !this.enabled) return;
    // Sender identity is not attested, so only analyse art the world already uses: a player
    // must not be able to make the GM's browser fetch arbitrary URLs.
    if (!isWorldArt(src)) return;
    if (op === "forget") this.forget(src);
    this.answer(src);
  }

  /** A GM's result for a request this client is waiting on. Null means analyse locally. */
  gmReplied(src, entry) {
    const done = this.worldWaiters.get(src);
    if (!done) return;
    if (!entry || !this.isCurrent(entry)) return done(undefined);
    this.replied.set(src, entry);
    done(entry);
  }

  /** GM side: analyse (or look up) `src`, answer the players, and make sure the world cache has it. */
  answer(src) {
    this.request(src).then(entry => {
      emitSocket(SOCKET_TAG, { op: "result", src, entry: entry ?? null });
      const shared = this.worldCache()[src];
      if (entry && !(isFaceEntry(shared) && this.isCurrent(shared))) this.shareSoon();
    });
  }

  /** Queues images so they are framed before they are first shown. */
  prescan(sources) {
    for (const src of new Set(sources)) if (src) this.request(src);
  }

  /** True when this image's last analysis failed in a way that may not last (network, CORS, models). */
  failedRecently(src) {
    return this.unsaved.has(src);
  }

  /** Called with (src, entry) whenever an analysis finishes. Returns an unsubscribe function. */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Forgets one image (e.g. its file was replaced under the same path) and re-analyses on next request. */
  async forget(src) {
    this.local.delete(src);
    this.unsaved.delete(src);
    this.replied.delete(src);
    this.saveLocal();
    const world = this.worldCache();
    if (!game.user?.isGM) {
      // Only a GM can change the world cache: skip its entry here until the GM's new one lands.
      if (src in world) this.ignored.set(src, JSON.stringify(world[src]));
      if (game.users?.activeGM) emitSocket(SOCKET_TAG, { op: "forget", src });
      return;
    }
    if (src in world) {
      const next = { ...world };
      delete next[src];
      this.world = next;
      await game.settings.set(SUITE_ID, SETTING_FACE_FRAME_CACHE, next);
    }
  }

  /** Drops the loaded models (the detection mode changed) and every session-only failure. */
  reset() {
    this.framerPromise = null;
    this.warned = false;
    for (const src of this.unsaved) this.local.delete(src);
    this.unsaved.clear();
  }

  adoptWorld(value) {
    this.world = value && typeof value === "object" ? value : {};
    for (const [src, before] of [...this.ignored]) {
      if (JSON.stringify(this.world[src]) !== before && this.world[src]) this.ignored.delete(src);
    }
    for (const src of [...this.replied.keys()]) {
      if (isFaceEntry(this.world[src])) this.replied.delete(src);
    }
    for (const [src, done] of [...this.worldWaiters]) {
      const entry = this.world[src];
      if (!isFaceEntry(entry) || !this.isCurrent(entry) || this.ignored.has(src)) continue;
      done(entry);
    }
  }

  notify(src, entry) {
    for (const listener of this.listeners) {
      try {
        listener(src, entry);
      } catch (error) {
        warn("Face framing listener failed", error);
      }
    }
  }

  worldCache() {
    if (!this.world) {
      try {
        this.adoptWorld(game.settings.get(SUITE_ID, SETTING_FACE_FRAME_CACHE));
      } catch {
        return {};
      }
    }
    return this.world;
  }

  async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const { src, resolve } = this.queue.shift();
        if (!this.enabled) {
          // Turned off while queued: nothing was analysed, so nothing is remembered.
          this.inflight.delete(src);
          resolve(null);
          continue;
        }
        let entry = null;
        let persist = true;
        try {
          entry = await this.analyse(src);
        } catch (error) {
          // A load, CORS or model failure may not last: keep the default framing for this session only.
          persist = false;
          if (!this.warned) warn(`Face framing unavailable (first failure: ${src}); portraits keep their default framing`, error);
          this.warned = true;
        }
        this.remember(src, entry, persist);
        this.inflight.delete(src);
        resolve(entry);
        this.notify(src, entry);
        // Give rendering a breath between images.
        await new Promise(r => setTimeout(r, 30));
      }
    } finally {
      this.draining = false;
    }
  }

  async analyse(src) {
    const mode = this.mode;
    const framer = await this.framer();
    const px = await lib.loadPixels(new URL(src, document.baseURI).href);
    return { ...compactResult(await framer.detect(px)), m: mode };
  }

  framer() {
    this.framerPromise ??= (async () => {
      const models = route(MODELS_DIR);
      const wasmPaths = await resolveWasmPaths(`${models}/ort/`);
      return lib.createWebFramer({
        sources: [lib.localSource(models), lib.remoteSource],
        wasmPaths,
        loadOrt: () => import(route(suitePath("scripts/vendor/face-frame/ort.webgpu.min.mjs"))),
        // Creatures need OWLv2, which is only practical on WebGPU; the library keeps it off otherwise.
        ...(this.mode === FACE_FRAME_MODES.creatures ? {} : { tier2: false })
      });
    })();
    // A failed load (offline, no models) is retried on the next request after a reset, not per image.
    this.framerPromise.catch(() => {});
    return this.framerPromise;
  }

  remember(src, entry, persist) {
    this.local.delete(src);
    this.local.set(src, entry);
    while (this.local.size > LOCAL_LIMIT) this.local.delete(this.local.keys().next().value);
    if (!persist) {
      this.unsaved.add(src);
      return;
    }
    this.unsaved.delete(src);
    this.saveLocal();
    if (entry && game.user?.isGM) this.shareSoon();
  }

  saveLocal() {
    try {
      const saved = [...this.local].filter(([key]) => !this.unsaved.has(key));
      localStorage.setItem(LOCAL_KEY, JSON.stringify(saved));
    } catch {
      // Storage full or blocked: the in-memory cache still serves this session.
    }
  }

  /** Writes this GM's new results to the world cache now, then at most once per WORLD_WRITE_DELAY. */
  shareSoon() {
    if (this.worldTimer) {
      this.sharePending = true;
      return;
    }
    this.share();
    this.worldTimer = setTimeout(() => {
      this.worldTimer = null;
      if (!this.sharePending) return;
      this.sharePending = false;
      this.shareSoon();
    }, WORLD_WRITE_DELAY);
  }

  async share() {
    const next = { ...this.worldCache() };
    let changed = false;
    for (const [src, entry] of this.local) {
      if (!entry || this.unsaved.has(src) || !this.isCurrent(entry)) continue;
      if (isFaceEntry(next[src]) && this.isCurrent(next[src])) continue;
      next[src] = entry;
      changed = true;
    }
    if (!changed) return;
    const keys = Object.keys(next);
    for (const key of keys.slice(0, Math.max(0, keys.length - WORLD_LIMIT))) delete next[key];
    this.world = next;
    try {
      await game.settings.set(SUITE_ID, SETTING_FACE_FRAME_CACHE, next);
    } catch (error) {
      warn("Could not share face framing results", error);
    }
  }
}

/**
 * Frames an `<img>` (with `object-fit: cover`) on the head in its art, once known. `frame` is a
 * library preset name or `{aspect, headRatio, eyeLine}`. The image keeps its stylesheet framing
 * until then, and when no head is found. Parents need not clip: the crop uses `object-view-box`,
 * or only `object-position` where that is unsupported.
 */
export function frameImage(img, frame) {
  const src = img?.getAttribute("src");
  if (!src || !faceLocator.enabled) return;
  img.dataset.glFaceSrc = src;
  const apply = entry => {
    if (img.dataset.glFaceSrc !== src || img.getAttribute("src") !== src) return;
    const crop = entry && cropFor(entry, frame);
    if (!crop) return;
    if (VIEW_BOX) {
      Object.assign(img.style, viewBoxStyle(crop, entry.w, entry.h));
      img.style.objectPosition = "50% 50%";
      return;
    }
    const aspect = typeof frame === "string" ? PRESETS[frame].aspect : frame.aspect;
    const { x, y } = coverPlacement(crop, entry.w, entry.h, aspect, 1, { zoom: false });
    img.style.objectFit = "cover";
    img.style.objectPosition = `${x}% ${y}%`;
  };
  const known = faceLocator.peek(src);
  if (known !== undefined) apply(known);
  else faceLocator.request(src).then(apply);
}

/** frameImage for every match of `selector` under `root`. */
export function frameImages(root, selector, frame) {
  root?.querySelectorAll?.(selector).forEach(img => frameImage(img, frame));
}

const VIEW_BOX = globalThis.CSS?.supports?.("object-view-box", "inset(0% 0% 0% 0%)") ?? false;

/** onnxruntime's WebAssembly from the local models folder when it is there, else the CDN. */
async function resolveWasmPaths(local) {
  try {
    const res = await fetch(`${local}${ORT_PROBE}`, { method: "HEAD" });
    if (res.ok) return local;
  } catch {
    // Not served locally.
  }
  return `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
}

function route(path) {
  return foundry.utils.getRoute(path);
}

function loadLocal() {
  try {
    const entries = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]");
    return new Map(Array.isArray(entries) ? entries.filter(([, v]) => v === null || isFaceEntry(v)) : []);
  } catch {
    return new Map();
  }
}

/** The one locator for this client. */
export const faceLocator = new FaceLocator();
