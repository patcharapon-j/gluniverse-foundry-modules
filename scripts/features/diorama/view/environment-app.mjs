/**
 * Diorama — the GM's scene environment panel: time of day, weather, wind, fog,
 * clouds, river flow and the ground's wetness and snow, with presets as a
 * starting point. Opened from the view's toolbar (GM only).
 *
 *   openEnvironment(scene)
 *
 * Every change is live: a slider writes the scene flag at most every
 * WRITE_MS while it moves and once more when it is let go, through
 * writeEnvironment (a forced replacement). The view redraws from updateScene.
 * Where time or weather come from somewhere else (Foundry's darkness, the
 * calendar), the panel says so above the controls they override.
 *
 * The ApplicationV2 subclass is built in a memoised factory: nothing here
 * touches `foundry` at import.
 */

import { WEATHER_KINDS, PRESETS, PRESET_KEYS, DEFAULT_ENV, normalizeEnv, applyPreset, formatHour } from "../environment.mjs";
import { readEnvironment, writeEnvironment, environmentSources } from "./environment-source.mjs";
import { el, isGM, setting, t } from "./util.mjs";

/** Throttle for live writes while a slider moves, ms. */
const WRITE_MS = 200;

/** Time shortcuts: lang GLDIO.env.at.<key>. */
export const SHORTCUTS = Object.freeze([["dawn", 6.2], ["noon", 12], ["dusk", 17.6], ["night", 23]]);

/**
 * The sliders, by section. `path` is the flag path; lang GLDIO.env.field.<name>.
 * `fmt` is the readout: pct (0..1 as %), deg (a compass direction), hour.
 */
export const SECTIONS = Object.freeze([
  { name: "weather", rows: [{ name: "intensity", path: "weather.intensity", min: 0, max: 1, step: 0.05, fmt: "pct" }] },
  { name: "wind", rows: [
    { name: "windDir", path: "wind.dir", min: 0, max: 355, step: 5, fmt: "deg" },
    { name: "windStrength", path: "wind.strength", min: 0, max: 1, step: 0.05, fmt: "pct" },
  ] },
  { name: "air", rows: [
    { name: "clouds", path: "clouds", min: 0, max: 1, step: 0.05, fmt: "pct" },
    { name: "fogDensity", path: "fog.density", min: 0, max: 1, step: 0.05, fmt: "pct" },
    { name: "fogHeight", path: "fog.height", min: 0, max: 1, step: 0.05, fmt: "pct" },
  ] },
  { name: "water", rows: [
    { name: "flowDir", path: "water.dir", min: 0, max: 355, step: 5, fmt: "deg" },
    { name: "flowSpeed", path: "water.speed", min: 0, max: 1, step: 0.05, fmt: "pct" },
  ] },
  { name: "ground", rows: [
    { name: "wetness", path: "wetness", min: 0, max: 1, step: 0.05, fmt: "pct" },
    { name: "snow", path: "snow", min: 0, max: 1, step: 0.05, fmt: "pct" },
  ] },
]);
const ROWS = new Map(SECTIONS.flatMap((s) => s.rows).map((r) => [r.path, r]));

const getPath = (o, p) => p.split(".").reduce((a, k) => a?.[k], o);
function setPath(o, p, v) {
  const ks = p.split(".");
  let a = o;
  for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]] ??= {};
  a[ks[ks.length - 1]] = v;
}

function readout(row, v) {
  if (row.fmt === "pct") return `${Math.round(v * 100)}%`;
  if (row.fmt === "deg") return `${Math.round(v)}°`;
  return String(v);
}

let _Class = null;
let _app = null;

function makeClass() {
  const { ApplicationV2 } = foundry.applications.api;

  return class DioramaEnvironmentApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "gldio-env",
      classes: ["gldio-env", "gl-type"],
      tag: "form",
      window: { title: "GLDIO.env.title", icon: "fa-solid fa-cloud-sun-rain", resizable: true },
      position: { width: 420, height: 720 },
      actions: {
        preset: DioramaEnvironmentApp._onPreset,
        at: DioramaEnvironmentApp._onAt,
        reset: DioramaEnvironmentApp._onReset,
        done: DioramaEnvironmentApp._onDone,
      },
    };

    scene = null;
    draft = normalizeEnv(null);
    #timer = 0;
    #pending = false;

    bind(scene) {
      if (scene !== this.scene) this.#flush();
      this.scene = scene;
      this.draft = readEnvironment(scene);
    }

    async _renderHTML() {
      const E = this.draft;
      const src = environmentSources();
      const root = el("div", { class: "gldio-env-body" });
      root.append(el("p", { class: "gldio-env-hint", text: t("GLDIO.env.hint") }));

      // presets
      const chips = el("div", { class: "gldio-env-chips" });
      for (const k of PRESET_KEYS) {
        const on = E.preset === k;
        chips.append(el("button", {
          type: "button", class: `gl-btn gldio-env-chip${on ? " is-on" : ""}`, "aria-pressed": on ? "true" : "false",
          dataset: { action: "preset", preset: k },
        }, [el("i", { class: PRESETS[k].icon }), el("span", { text: t(`GLDIO.env.preset.${k}`) })]));
      }
      root.append(this.#section("presets", [chips]));

      // time of day
      const time = [];
      if (src.time === "darkness") time.push(this.#note("GLDIO.env.note.timeDarkness"));
      else if (src.time === "calendar") time.push(this.#note(src.timeLive ? "GLDIO.env.note.timeCalendar" : "GLDIO.env.note.timeCalendarOff"));
      if (setting("dio.dayNight", true) === false) time.push(this.#note("GLDIO.env.note.dayNightOff"));
      const table = E.hour === null;
      time.push(el("label", { class: "gldio-env-check" }, [
        el("input", { type: "checkbox", name: "tableLight", checked: table }),
        el("span", { text: t("GLDIO.env.field.tableLight") }),
      ]));
      time.push(this.#slider({ name: "hour", path: "hour", min: 0, max: 23.75, step: 0.25, fmt: "hour" }, table ? 12 : E.hour, table));
      const at = el("div", { class: "gldio-env-shortcuts" });
      for (const [k, h] of SHORTCUTS) {
        at.append(el("button", { type: "button", class: "gl-btn gldio-env-at", dataset: { action: "at", hour: String(h) } }, [el("span", { text: t(`GLDIO.env.at.${k}`) })]));
      }
      time.push(at);
      root.append(this.#section("time", time));

      // weather and the rest
      for (const s of SECTIONS) {
        const body = [];
        if (s.name === "weather") {
          if (src.weather === "calendar") body.push(this.#note(src.weatherLive ? "GLDIO.env.note.weatherCalendar" : "GLDIO.env.note.weatherCalendarOff"));
          const sel = el("select", { name: "weather.kind" });
          for (const k of WEATHER_KINDS) {
            sel.append(el("option", { value: k, selected: E.weather.kind === k, text: t(`GLDIO.env.kind.${k}`) }));
          }
          body.push(el("label", { class: "gldio-env-row" }, [el("span", { class: "gldio-env-label", text: t("GLDIO.env.field.kind") }), sel]));
        }
        for (const r of s.rows) body.push(this.#slider(r, getPath(E, r.path), s.name === "weather" && E.weather.kind === "clear"));
        root.append(this.#section(s.name, body));
      }

      const foot = el("footer", { class: "gldio-env-foot" }, [
        el("button", { type: "button", class: "gl-btn gldio-env-btn", dataset: { action: "reset" } }, [el("i", { class: "fa-solid fa-rotate-left" }), el("span", { text: t("GLDIO.env.btn.reset") })]),
        el("button", { type: "button", class: "gl-btn gldio-env-btn", dataset: { action: "done" } }, [el("i", { class: "fa-solid fa-check" }), el("span", { text: t("GLDIO.env.btn.done") })]),
      ]);
      root.append(foot);
      return root;
    }

    _replaceHTML(result, content) {
      content.replaceChildren(result);
    }

    #section(name, children) {
      return el("section", { class: "gldio-env-section" }, [el("h3", { class: "gldio-env-head", text: t(`GLDIO.env.section.${name}`) }), ...children]);
    }

    #note(key) {
      return el("p", { class: "gldio-env-note" }, [el("i", { class: "fa-solid fa-circle-info" }), el("span", { text: t(key) })]);
    }

    #slider(row, value, disabled = false) {
      const out = el("output", { class: "gldio-env-out", text: row.fmt === "hour" ? formatHour(value) : readout(row, value) });
      const children = [el("span", { class: "gldio-env-label", text: t(`GLDIO.env.field.${row.name}`) })];
      const input = el("input", { type: "range", name: row.path, min: row.min, max: row.max, step: row.step, value, disabled });
      children.push(input);
      if (row.fmt === "deg") {
        const arrow = el("i", { class: "fa-solid fa-arrow-up gldio-env-arrow" });
        arrow.style.transform = `rotate(${value}deg)`;
        children.push(el("span", { class: "gldio-env-dir" }, [arrow, out]));
      } else children.push(out);
      return el("label", { class: "gldio-env-row" }, children);
    }

    // The window element outlives re-renders: listen once.
    _onFirstRender(context, options) {
      super._onFirstRender?.(context, options);
      this.element.addEventListener("input", (ev) => this.#onInput(ev, false));
      this.element.addEventListener("change", (ev) => this.#onInput(ev, true));
      this.element.addEventListener("submit", (ev) => ev.preventDefault());
    }

    _onClose(options) {
      this.#flush();
      super._onClose?.(options);
    }

    #onInput(ev, settled) {
      const input = ev.target;
      const name = input?.name;
      if (!name) return;
      const E = this.draft;
      let rerender = false;
      if (name === "tableLight") {
        E.hour = input.checked ? null : 12;
        rerender = true;
      } else if (name === "hour") {
        E.hour = Number(input.value);
        this.#show(input, formatHour(E.hour));
      } else if (name === "weather.kind") {
        const was = E.weather.kind;
        E.weather.kind = input.value;
        if (was === "clear" && input.value !== "clear") E.weather.intensity = 0.6;
        rerender = true;
      } else if (ROWS.has(name)) {
        const row = ROWS.get(name);
        const v = Number(input.value);
        setPath(E, name, v);
        this.#show(input, readout(row, v));
        if (row.fmt === "deg") {
          const arrow = input.parentElement?.querySelector(".gldio-env-arrow");
          if (arrow) arrow.style.transform = `rotate(${v}deg)`;
        }
      } else return;
      E.preset = "custom";
      this.draft = normalizeEnv(E);
      this.#queue(settled);
      if (rerender) this.render();
    }

    #show(input, text) {
      const out = input.parentElement?.querySelector(".gldio-env-out");
      if (out) out.textContent = text;
    }

    /** Write now (settled) or at most every WRITE_MS while a slider moves. */
    #queue(now) {
      this.#pending = true;
      if (now) { this.#flush(); return; }
      if (this.#timer) return;
      this.#timer = setTimeout(() => { this.#timer = 0; this.#flush(); }, WRITE_MS);
    }

    #flush() {
      if (this.#timer) { clearTimeout(this.#timer); this.#timer = 0; }
      if (!this.#pending || !this.scene) return;
      this.#pending = false;
      writeEnvironment(this.scene, this.draft).catch((e) => console.error("GLUniverse Suite | diorama environment write failed", e));
    }

    static _onPreset(_ev, target) {
      const key = target?.dataset?.preset;
      if (!PRESETS[key]) return;
      // a preset is the sky and the weather; the river stays this map's own
      const next = applyPreset(key);
      next.water = { ...this.draft.water };
      this.draft = next;
      this.#queue(true);
      this.render();
    }

    static _onAt(_ev, target) {
      const h = Number(target?.dataset?.hour);
      if (!Number.isFinite(h)) return;
      this.draft.hour = h;
      this.draft.preset = "custom";
      this.#queue(true);
      this.render();
    }

    static _onReset() {
      this.draft = normalizeEnv({ ...DEFAULT_ENV, water: { ...this.draft.water } });
      this.#queue(true);
      this.render();
    }

    static _onDone() {
      this.#flush();
      this.close();
    }
  };
}

/** Open the panel on a scene (GM only). */
export function openEnvironment(scene) {
  if (!isGM() || !scene) return null;
  _Class ??= makeClass();
  _app ??= new _Class();
  _app.bind(scene);
  _app.render({ force: true });
  return _app;
}
