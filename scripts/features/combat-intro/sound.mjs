/**
 * Combat Intro — the cue player.
 *
 * Web Audio, one decode per file, one voice per cue. The director calls
 * `cue(name)` once per beat boundary; a cue that fires again before its
 * minimum gap is dropped, and a cue that is still ringing is cut by its own
 * retrigger rather than stacked, so a twelve-creature volley landing in one
 * frame is one clack and not a wall of them.
 *
 * A cue with no path, a path that fails to load, or no AudioContext at all is
 * a silent no-op: sound is decoration and must never stall a beat.
 *
 * Pure: no `game`. `fetch` and the AudioContext constructor are injectable so
 * the check tool can drive it under Node.
 */
import { CUES } from "./constants.mjs";

export const MIN_GAP_MS = 70;

/**
 * @param {object} o
 * @param {Record<string,string>} o.paths   cue → URL
 * @param {number} [o.volume]               0..1
 * @param {boolean} [o.enabled]
 * @param {typeof AudioContext} [o.AudioContextCtor]
 * @param {typeof fetch} [o.fetchFn]
 * @param {() => number} [o.now]
 */
export function createSoundPlayer({
  paths = {}, volume = 0.8, enabled = true,
  AudioContextCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  fetchFn = globalThis.fetch?.bind(globalThis), now = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  let ctx = null, gain = null, disposed = false;
  const buffers = new Map();    // cue → Promise<AudioBuffer|null>
  const voices = new Map();     // cue → AudioBufferSourceNode
  const last = new Map();       // cue → ms

  const context = () => {
    if (ctx || disposed || !AudioContextCtor) return ctx;
    try {
      ctx = new AudioContextCtor();
      gain = ctx.createGain();
      gain.gain.value = Math.max(0, Math.min(1, Number(volume) || 0));
      gain.connect(ctx.destination);
    } catch { ctx = null; }
    return ctx;
  };

  const load = (name) => {
    if (buffers.has(name)) return buffers.get(name);
    const url = paths[name];
    const c = context();
    const p = !url || !c || !fetchFn ? Promise.resolve(null)
      : fetchFn(url).then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((ab) => (ab ? c.decodeAudioData(ab) : null))
        .catch(() => null);
    buffers.set(name, p);
    return p;
  };

  return {
    /** Decode every cue up front, so the first beat is not the one that waits on a fetch. */
    preload() {
      if (!enabled) return Promise.resolve();
      return Promise.all(CUES.filter((c) => paths[c]).map(load)).then(() => undefined);
    },

    cue(name) {
      if (!enabled || disposed || !paths[name]) return;
      const t = now();
      if (t - (last.get(name) ?? -Infinity) < MIN_GAP_MS) return;
      last.set(name, t);
      const c = context();
      if (!c) return;
      if (c.state === "suspended") c.resume?.().catch?.(() => {});
      load(name).then((buf) => {
        if (!buf || disposed) return;
        try { voices.get(name)?.stop(); } catch { /* already ended */ }
        const src = c.createBufferSource();
        src.buffer = buf;
        src.connect(gain);
        src.onended = () => { if (voices.get(name) === src) voices.delete(name); };
        voices.set(name, src);
        src.start();
      });
    },

    setVolume(v) { if (gain) gain.gain.value = Math.max(0, Math.min(1, Number(v) || 0)); else volume = v; },

    dispose() {
      disposed = true;
      for (const v of voices.values()) { try { v.stop(); } catch { /* ended */ } }
      voices.clear();
      buffers.clear();
      try { ctx?.close?.(); } catch { /* closed */ }
      ctx = null;
    },
  };
}
