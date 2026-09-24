/**
 * Performance — the measurement overlay.
 *
 * A per-client readout of what this machine is actually doing. Everything it
 * shows is read from the shared budget, the probes and the override list; it
 * computes nothing of its own, so it cannot disagree with what a report saves.
 *
 * It repaints twice a second, never per frame: an overlay that measured frame
 * time by adding a DOM write to every frame would be measuring itself. Text
 * goes in through `textContent` only.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { Budget } from "../../core/budget.mjs";
import { SETTINGS } from "./constants.mjs";
import { Perf, setDetailedProbes } from "./runtime.mjs";
import { Overrides } from "./overrides.mjs";
import { Patches } from "./patches.mjs";
import { benchmarking, lastReport, longTasks, runBenchmark, saveReport, watchLongTasks } from "./report.mjs";

const REPAINT_MS = 500;
/** Per-browser convenience only: where this player left the overlay. */
const POSITION_KEY = "gluniverse.perf.overlayPosition";
const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "—");

let _el = null;
let _timer = 0;
let _spentAvg = {};
let _lastDrain = 0;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function row(label, value, cls = "") {
  const r = el("div", `glperf-row ${cls}`.trim());
  r.append(el("span", "glperf-k", label), el("span", "glperf-v gl-numeric", value));
  return r;
}

function tierLabel(state) {
  if (!state) return "—";
  const tier = L(`GLPERF.tier.${state.tier}`);
  return state.auto ? L("GLPERF.overlay.auto", { tier }) : tier;
}

function build() {
  const root = el("section", "glperf-overlay gl-glass gl-type");
  root.id = "glperf-overlay";
  root.setAttribute("aria-live", "off");

  const head = el("header", "glperf-head");
  const title = el("span", "glperf-title gl-tech-label", L("GLPERF.overlay.title"));
  const chip = el("span", "glperf-chip");
  chip.dataset.ref = "tier";
  const close = el("button", "glperf-icon gl-btn");
  close.type = "button";
  close.dataset.tooltip = L("GLPERF.overlay.close");
  close.setAttribute("aria-label", L("GLPERF.overlay.close"));
  close.append(el("i", "fa-solid fa-xmark"));
  close.addEventListener("click", () => game.settings.set(SUITE_ID, SETTINGS.overlay, false));
  head.append(title, chip, close);
  draggable(root, head);

  const body = el("div", "glperf-body");
  body.dataset.ref = "body";

  const foot = el("footer", "glperf-foot");
  const bench = el("button", "glperf-bench gl-btn", L("GLPERF.overlay.record"));
  bench.type = "button";
  bench.dataset.ref = "bench";
  bench.addEventListener("click", async () => {
    if (benchmarking()) return;
    bench.disabled = true;
    const report = await runBenchmark((f) => {
      bench.textContent = L("GLPERF.overlay.recording", { pct: Math.round(f * 100) });
    });
    bench.disabled = false;
    bench.textContent = L("GLPERF.overlay.record");
    saveReport(report);
    paint();
  });
  const save = el("button", "glperf-save gl-btn", L("GLPERF.overlay.save"));
  save.type = "button";
  save.dataset.ref = "save";
  save.addEventListener("click", () => {
    const r = lastReport();
    if (r) saveReport(r);
  });
  foot.append(bench, save);

  root.append(head, body, foot);
  return root;
}

function readPosition() {
  try {
    const p = JSON.parse(window.localStorage.getItem(POSITION_KEY) ?? "null");
    return p && Number.isFinite(p.left) && Number.isFinite(p.top) ? p : null;
  } catch {
    return null;
  }
}

function writePosition(p) {
  try { window.localStorage.setItem(POSITION_KEY, JSON.stringify(p)); } catch { /* storage refused */ }
}

/** Keep a position on screen: a window resized smaller than where the overlay
 *  was left must not strand it out of reach. */
function clampToViewport(root, left, top) {
  const w = root.offsetWidth || 272, h = root.offsetHeight || 120;
  return {
    left: Math.max(0, Math.min(window.innerWidth - w, left)),
    top: Math.max(0, Math.min(window.innerHeight - Math.min(h, 60), top)),
  };
}

function place(root, p) {
  const { left, top } = clampToViewport(root, p.left, p.top);
  root.style.left = `${left}px`;
  root.style.top = `${top}px`;
}

function draggable(root, handle) {
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("button")) return;
    const rect = root.getBoundingClientRect();
    const dx = event.clientX - rect.left, dy = event.clientY - rect.top;
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("is-dragging");
    const move = (e) => place(root, { left: e.clientX - dx, top: e.clientY - dy });
    const up = (e) => {
      handle.releasePointerCapture(e.pointerId);
      handle.classList.remove("is-dragging");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      const r = root.getBoundingClientRect();
      writePosition({ left: r.left, top: r.top });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
}

function paint() {
  if (!_el) return;
  const state = Perf.state;
  _el.querySelector('[data-ref="tier"]').textContent = tierLabel(state);
  _el.dataset.tier = state?.tier ?? "";
  _el.querySelector('[data-ref="save"]').disabled = !lastReport();

  const [i50, i95, i99] = Budget.intervals([0.5, 0.95, 0.99]);
  const [w50, w95] = Budget.work([0.5, 0.95]);
  const lt = longTasks(10000);

  // Attribution is drained into a smoothed per-frame average so one noisy
  // half-second does not reorder the list.
  const now = performance.now();
  const frames = Math.max(1, Math.round((now - (_lastDrain || now - REPAINT_MS)) / (i50 || 16.7)));
  _lastDrain = now;
  const drained = Budget.drainSpent();
  const keys = new Set([...Object.keys(_spentAvg), ...Object.keys(drained)]);
  for (const k of keys) _spentAvg[k] = (_spentAvg[k] ?? 0) * 0.6 + ((drained[k] ?? 0) / frames) * 0.4;

  const body = _el.querySelector('[data-ref="body"]');
  const frag = document.createDocumentFragment();

  frag.append(row(L("GLPERF.overlay.fps"), `${i50 ? fmt(1000 / i50, 0) : "—"} / ${state?.targetFps ?? "—"}`, i95 > (Budget.thresholds.budgetMs * 1.2) ? "is-over" : ""));
  frag.append(row(L("GLPERF.overlay.frame"), `${fmt(i50)} · ${fmt(i95)} · ${fmt(i99)} ms`));
  frag.append(row(L("GLPERF.overlay.work"), `${fmt(w50)} · ${fmt(w95)} ms`));
  frag.append(row(L("GLPERF.overlay.longTasks"), L("GLPERF.overlay.longTasksValue", { count: lt.count, ms: lt.ms }), lt.count ? "is-warn" : ""));
  frag.append(row(L("GLPERF.overlay.reflex"), String(Budget.steps)));

  const ladders = Budget.ladders();
  if (ladders.length) {
    frag.append(el("div", "glperf-sub gl-tech-label", L("GLPERF.overlay.ladders")));
    for (const l of ladders) frag.append(row(l.id, `${l.level} / ${l.length}`, l.level ? "is-warn" : ""));
  }

  const spent = Object.entries(_spentAvg).filter(([, v]) => v >= 0.05).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (spent.length) {
    frag.append(el("div", "glperf-sub gl-tech-label", L("GLPERF.overlay.spent")));
    for (const [k, v] of spent) frag.append(row(L(`GLPERF.probe.${k}`) === `GLPERF.probe.${k}` ? k : L(`GLPERF.probe.${k}`), `${fmt(v, 2)} ms`));
  }

  const overrides = Overrides.list();
  if (overrides.length) {
    frag.append(el("div", "glperf-sub gl-tech-label", L("GLPERF.overlay.overrides")));
    for (const o of overrides) {
      frag.append(row(L(`GLPERF.override.${o.key}`), L("GLPERF.overlay.overrideValue", { value: o.value, own: o.own })));
    }
  }

  const patches = Patches.status().filter((p) => p.state !== "active" && p.state !== "idle");
  if (patches.length) {
    frag.append(el("div", "glperf-sub gl-tech-label", L("GLPERF.overlay.patches")));
    for (const p of patches) {
      const r = row(L(`GLPERF.patch.${p.id}.name`), L(`GLPERF.patchState.${p.state}`), `is-${p.state}`);
      if (p.reason) r.dataset.tooltip = p.reason;
      frag.append(r);
    }
  }

  body.replaceChildren(frag);
}

export const Overlay = {
  get open() {
    return !!_el;
  },

  show() {
    if (_el) return;
    watchLongTasks();
    Budget.setProfiling(true);
    setDetailedProbes(true);
    _spentAvg = {};
    _lastDrain = 0;
    _el = build();
    document.body.append(_el);
    const saved = readPosition();
    if (saved) place(_el, saved);
    paint();
    _timer = window.setInterval(paint, REPAINT_MS);
  },

  hide() {
    if (!_el) return;
    window.clearInterval(_timer);
    _timer = 0;
    _el.remove();
    _el = null;
    if (!benchmarking()) {
      setDetailedProbes(false);
      Budget.setProfiling(false);
    }
  },

  sync() {
    let on = false;
    try { on = !!game.settings.get(SUITE_ID, SETTINGS.overlay); } catch { on = false; }
    if (on) this.show();
    else this.hide();
  },

  repaint() {
    paint();
  },
};
