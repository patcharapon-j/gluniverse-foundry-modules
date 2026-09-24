/**
 * Performance — snapshots, the 30-second benchmark, and GM report pulls.
 *
 * A report is what turns "it feels slow on Sam's laptop" into a number the GM
 * can compare against last week's. It is informational only: nothing a report
 * says is ever acted on, so a forged one (Foundry's module socket carries no
 * attested sender) can at worst mislabel a row in the GM's own window.
 */

import { Budget } from "../../core/budget.mjs";
import { emitSocket, onSocket } from "../../core/socket.mjs";
import { FEATURE_ID, MSG } from "./constants.mjs";
import { Perf, setDetailedProbes } from "./runtime.mjs";
import { Patches } from "./patches.mjs";

const BENCH_MS = 30000;
const LONGTASK_WINDOW_MS = 60000;

/* ── Long tasks ──────────────────────────────────────────────────────── */

/** @type {{ start: number, duration: number }[]} */
const _longTasks = [];
let _observer = null;

export function watchLongTasks() {
  if (_observer || typeof PerformanceObserver !== "function") return;
  try {
    _observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) _longTasks.push({ start: e.startTime, duration: e.duration });
      const cutoff = performance.now() - LONGTASK_WINDOW_MS;
      while (_longTasks.length && _longTasks[0].start < cutoff) _longTasks.shift();
    });
    _observer.observe({ type: "longtask", buffered: false });
  } catch {
    // Not every engine exposes long tasks; the overlay just shows none.
    _observer = null;
  }
}

export function unwatchLongTasks() {
  _observer?.disconnect();
  _observer = null;
  _longTasks.length = 0;
}

/** Long tasks within the last `ms`. */
export function longTasks(ms = 10000) {
  const cutoff = performance.now() - ms;
  const recent = _longTasks.filter((t) => t.start >= cutoff);
  return { count: recent.length, ms: Math.round(recent.reduce((a, t) => a + t.duration, 0)) };
}

/* ── Snapshot ─────────────────────────────────────────────────────────── */

// An empty window reads 0; a report must say "no data", not "0 ms".
const round = (n, d = 1) => (Number.isFinite(n) && n !== 0 ? Math.round(n * 10 ** d) / 10 ** d : null);

/** The GPU's name, where the browser will say. It is how the GM finds the one
 *  integrated-graphics laptop at the table. */
function gpuName() {
  try {
    const gl = canvas?.app?.renderer?.gl;
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null;
  } catch {
    return null;
  }
}

function sceneFacts() {
  const s = canvas?.scene;
  if (!s) return null;
  return {
    name: s.name,
    tokens: s.tokens?.size ?? 0,
    walls: s.walls?.size ?? 0,
    lights: s.lights?.size ?? 0,
    tiles: s.tiles?.size ?? 0,
    grid: s.grid?.size ?? null,
  };
}

/**
 * A point-in-time report of this client.
 * @param {object} [extra]  merged over the top (the benchmark adds its series)
 */
export function snapshot(extra = {}) {
  const [i50, i95, i99] = Budget.intervals([0.5, 0.95, 0.99]);
  const [w50, w95, w99] = Budget.work([0.5, 0.95, 0.99]);
  const st = Perf.state;
  return {
    v: 1,
    at: Date.now(),
    user: { id: game.user?.id ?? null, name: game.user?.name ?? null },
    foundry: game.version ?? null,
    system: game.system ? `${game.system.id} ${game.system.version}` : null,
    tier: st?.tier ?? null,
    auto: !!st?.auto,
    choice: st?.choice ?? null,
    floor: st?.floor ?? null,
    targetFps: st?.targetFps ?? null,
    displayHz: round(Perf.displayHz),
    dpr: round(window.devicePixelRatio, 2),
    resolution: round(canvas?.app?.renderer?.resolution, 2),
    perfMode: canvas?.performance?.mode ?? null,
    gpu: gpuName(),
    fps: i50 ? round(1000 / i50) : null,
    interval: { p50: round(i50), p95: round(i95), p99: round(i99) },
    work: { p50: round(w50), p95: round(w95), p99: round(w99) },
    reflexSteps: Budget.steps,
    longTasks: longTasks(10000),
    ladders: Budget.ladders().map((l) => ({ id: l.id, level: l.level, length: l.length })),
    patches: Patches.status(),
    scene: sceneFacts(),
    ...extra,
  };
}

/* ── Benchmark ───────────────────────────────────────────────────────── */

let _bench = null;

export function benchmarking() {
  return !!_bench;
}

/**
 * Record 30 s of this client, then save the report and keep it as the one the
 * GM pulls. Resolves with the report.
 * @param {(fraction: number) => void} [onProgress]
 */
export function runBenchmark(onProgress) {
  if (_bench) return _bench.promise;
  const intervals = [];
  const work = [];
  const spent = {};
  watchLongTasks();
  const wasProfiling = Budget.profiling;
  Budget.setProfiling(true);
  setDetailedProbes(true);
  Budget.drainSpent();

  let last = 0;
  let raf = 0;
  const started = performance.now();
  const lt0 = performance.now();
  const workAtStart = Budget.workSamples;

  const promise = new Promise((resolve) => {
    const frame = (now) => {
      if (last) {
        const dt = now - last;
        if (dt > 0 && dt < 1000) intervals.push(dt);
      }
      last = now;
      const elapsed = now - started;
      onProgress?.(Math.min(1, elapsed / BENCH_MS));
      if (elapsed < BENCH_MS) {
        raf = requestAnimationFrame(frame);
        return;
      }
      for (const [k, v] of Object.entries(Budget.drainSpent())) spent[k] = (spent[k] ?? 0) + v;
      const [w50, w95, w99] = Budget.work([0.5, 0.95, 0.99], Math.max(0, Budget.workSamples - workAtStart));
      work.push({ p50: w50, p95: w95, p99: w99 });
      Budget.setProfiling(wasProfiling);
      if (!wasProfiling) setDetailedProbes(false);
      const sorted = intervals.slice().sort((a, b) => a - b);
      const q = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : 0;
      const frames = intervals.length || 1;
      const report = snapshot({
        benchmark: {
          seconds: BENCH_MS / 1000,
          frames: intervals.length,
          fps: round(intervals.length / (BENCH_MS / 1000)),
          interval: { p50: round(q(0.5)), p95: round(q(0.95)), p99: round(q(0.99)), max: round(sorted.at(-1) ?? 0) },
          work: work[0] ? { p50: round(work[0].p50), p95: round(work[0].p95), p99: round(work[0].p99) } : null,
          /* ms per frame, per subsystem — the "which one ate the frame" row */
          spent: Object.fromEntries(Object.entries(spent).map(([k, v]) => [k, round(v / frames, 2)])),
          longTasks: longTasks(performance.now() - lt0),
        },
      });
      _lastReport = report;
      _bench = null;
      resolve(report);
    };
    raf = requestAnimationFrame(frame);
  });
  _bench = { promise, cancel: () => cancelAnimationFrame(raf) };
  return promise;
}

export function saveReport(report) {
  const who = (report.user?.name ?? "client").replace(/[^\w-]+/g, "_");
  foundry.utils.saveDataToFile(JSON.stringify(report, null, 2), "application/json", `glu-performance-${who}-${report.at}.json`);
}

/* ── GM pulls ────────────────────────────────────────────────────────── */

let _lastReport = null;
/** userId → report, on the GM's client only */
const _received = new Map();
/** @type {Set<() => void>} */
const _receivedListeners = new Set();

export function lastReport() {
  return _lastReport;
}

export function receivedReports() {
  return _received;
}

export function onReportReceived(fn) {
  _receivedListeners.add(fn);
  return () => _receivedListeners.delete(fn);
}

function storeReport(userId, report) {
  _received.set(userId, report);
  for (const fn of _receivedListeners) {
    try { fn(userId); } catch { /* a listener's problem */ }
  }
}

/**
 * GM → one user (or everyone, with `null`). A socket never delivers to its own
 * sender, so the GM's own row is filled from this client directly.
 */
export function requestReport(userId = null) {
  if (!game.user?.isGM) return;
  if (userId === null || userId === game.user.id) storeReport(game.user.id, currentReport());
  if (userId === game.user.id) return;
  emitSocket(FEATURE_ID, { type: MSG.request, target: userId, from: game.user.id });
}

/** The benchmark's report if it is recent, otherwise a fresh snapshot: a GM
 *  asking "how is Sam doing" right now should not get last week's run. */
function currentReport() {
  return _lastReport && Date.now() - _lastReport.at < 10 * 60000 ? _lastReport : snapshot();
}

const validPayload = (p) =>
  p && typeof p === "object" && (p.type === MSG.request || p.type === MSG.report);

export function wireSocket() {
  onSocket(FEATURE_ID, (payload, senderId) => {
    if (payload.type === MSG.request) {
      if (payload.target && payload.target !== game.user.id) return;
      if (typeof payload.from !== "string" || !game.users.get(payload.from)?.isGM) return;
      emitSocket(FEATURE_ID, { type: MSG.report, to: payload.from, report: currentReport() });
      return;
    }
    if (payload.type === MSG.report) {
      if (!game.user.isGM || payload.to !== game.user.id) return;
      if (!payload.report || typeof payload.report !== "object" || !senderId) return;
      storeReport(senderId, payload.report);
    }
  }, { validate: validPayload });
}
