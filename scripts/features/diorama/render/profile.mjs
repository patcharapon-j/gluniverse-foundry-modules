/**
 * Diorama — the view's own frame readout: GPU time per frame, CPU time per
 * frame, draw calls, triangles, frames and shadow-map renders per second, and
 * the shed rung in force. Pure (no game/canvas/foundry): it reads the WebGL2
 * context the renderer hands it.
 *
 * It costs nothing until someone looks. The renderer only times frames while
 * the Graphics panel's readout or the perf overlay is open
 * (`DioramaRenderer#setProfiling`, `Budget.profiling`); otherwise a frame pays
 * two integer increments.
 *
 * GPU time is EXT_disjoint_timer_query_webgl2: one TIME_ELAPSED query around
 * each drawn frame, read back frames later when it says it is ready. Nothing
 * here ever waits on the GPU (no getQueryParameter on a result that is not
 * available, no finish). A disjoint event (a context switch, a clock change)
 * throws away every result in flight. Without the extension the readout says
 * "n/a"; browsers hide it on some machines on purpose.
 */

/** Queries in flight before the oldest is dropped unread (never waited on). */
const MAX_PENDING = 6;
/** Samples kept for the averages. */
const WINDOW = 30;
/** The window "per second" counts over (ms). */
const RATE_MS = 1000;

/** A ring of numbers with a mean. */
class Ring {
  constructor(n) { this.a = new Float64Array(n); this.n = 0; this.i = 0; }
  push(v) { this.a[this.i] = v; this.i = (this.i + 1) % this.a.length; this.n = Math.min(this.n + 1, this.a.length); }
  get mean() {
    if (!this.n) return null;
    let s = 0;
    for (let k = 0; k < this.n; k++) s += this.a[k];
    return s / this.n;
  }
  clear() { this.n = 0; this.i = 0; }
}

/** A ring of timestamps: how many fall in the last RATE_MS. */
class Rate {
  constructor(n = 512) { this.t = new Float64Array(n); this.n = 0; this.i = 0; }
  push(at) { this.t[this.i] = at; this.i = (this.i + 1) % this.t.length; this.n = Math.min(this.n + 1, this.t.length); }
  perSecond(now) {
    let c = 0;
    for (let k = 0; k < this.n; k++) if (now - this.t[k] <= RATE_MS) c++;
    return c;
  }
  clear() { this.n = 0; this.i = 0; }
}

export class GpuTimer {
  /** @param {WebGL2RenderingContext|null} gl */
  constructor(gl) {
    this.gl = gl ?? null;
    let ext = null;
    try { ext = this.gl?.getExtension?.("EXT_disjoint_timer_query_webgl2") ?? null; } catch { ext = null; }
    this.ext = ext && typeof this.gl.createQuery === "function" ? ext : null;
    this.free = [];
    this.pending = [];
    this.active = null;
    this.ms = new Ring(WINDOW);
  }

  get supported() { return !!this.ext; }

  begin() {
    if (!this.ext || this.active) return;
    const gl = this.gl;
    const q = this.free.pop() ?? gl.createQuery();
    if (!q) return;
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
    while (this.pending.length > MAX_PENDING) this.gl.deleteQuery(this.pending.shift());
  }

  /** Read back whatever is ready, oldest first; stop at the first that is not. Never blocks. */
  poll() {
    if (!this.ext || !this.pending.length) return;
    const gl = this.gl;
    const ready = [];
    while (this.pending.length && gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)) ready.push(this.pending.shift());
    // A disjoint event voids every result in flight, ready or not.
    const disjoint = !!gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    if (disjoint) { ready.push(...this.pending); this.pending.length = 0; }
    for (const q of ready) {
      if (!disjoint) this.ms.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      this.free.push(q);
    }
  }

  /** Mean GPU ms per frame over the window, or null (no extension, nothing yet). */
  get mean() { return this.ext ? this.ms.mean : null; }

  dispose() {
    if (!this.gl) return;
    if (this.active && this.ext) { try { this.gl.endQuery(this.ext.TIME_ELAPSED_EXT); } catch { /* lost */ } }
    for (const q of [...this.free, ...this.pending, this.active]) if (q) { try { this.gl.deleteQuery(q); } catch { /* lost */ } }
    this.free = []; this.pending = []; this.active = null;
  }
}

/**
 * The renderer's readout while profiling: one per renderer, made on first use.
 * `frame(o)` after each drawn frame, `shadow(at)` per shadow-map render.
 */
export class FrameProfile {
  /** @param {WebGL2RenderingContext|null} gl */
  constructor(gl) {
    this.gpu = new GpuTimer(gl);
    this.cpu = new Ring(WINDOW);
    this.frames = new Rate();
    this.shadows = new Rate();
    this.calls = 0;
    this.triangles = 0;
  }

  /** @param {{at:number, cpuMs:number, calls:number, triangles:number}} o */
  frame({ at, cpuMs, calls, triangles }) {
    this.gpu.poll();
    this.frames.push(at);
    this.cpu.push(cpuMs);
    this.calls = calls;
    this.triangles = triangles;
  }

  shadow(at) { this.shadows.push(at); }

  /**
   * @param {number} now  clock ms
   * @param {{level:number, of:number, name:string|null}} shed
   */
  read(now, shed) {
    this.gpu.poll();
    return {
      gpuMs: this.gpu.mean,
      gpuSupported: this.gpu.supported,
      cpuMs: this.cpu.mean,
      fps: this.frames.perSecond(now),
      shadowsPerSec: this.shadows.perSecond(now),
      calls: this.calls,
      triangles: this.triangles,
      shed,
    };
  }

  dispose() { this.gpu.dispose(); }
}
