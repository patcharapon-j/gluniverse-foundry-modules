/**
 * tools/time-tracker-preview.mjs — write a live preview of the time HUD.
 *
 * The page runs the SHIPPED `GlctHud` (apps/hud.js), its Handlebars template
 * and the shipped stylesheets, inside small Foundry stand-ins: an ApplicationV2
 * that renders a part and wires `data-action`, a settings store, a calendar
 * built from the shipped Ourolyn preset, and the shipped weather and delving
 * libraries. Nothing drawn on the page is a lookalike.
 *
 *   node tools/time-tracker-preview.mjs [--out=.preview/time.html] [--old]
 *   node tools/preview-server.mjs 8971      # then open /.preview/time.html
 *
 * SERVE it: a file:// page does not execute its module script.
 *
 *   ?wx=storm        the weather kind on the bar (any kind in weather/presets.js; "none" hides it)
 *   &delve=1         a delve is running (the turn + resource view)
 *   &collapsed=1     the compact pill
 *   &gm=0            a player's view (no dock)
 *   &h=13.5          hour of the day
 *   &mission=1       a mission countdown is live
 *   &impl=old        origin/main's code and styles (needs --old)
 *   &seek=11         freeze the weather loop at 11 s (headless stills)
 *   &glitch=1        the GM's temporal distortion is on
 *   &view=hud        what else to open beside the bar, each the shipped app:
 *                    weather (the Hex Flower window), calendar (with a day
 *                    selected), events, wxeditor, delveditor, caledit, modcfg,
 *                    shiftnames, cards (the weather and delve chat cards)
 *
 * Templates are compiled with the real Handlebars (from a CDN, as the stream
 * preview does), so every app's template renders as Foundry would render it.
 *
 * `--old` extracts origin/main's scripts, styles, templates and lang into
 * .preview/old/ so the same page can show the before.
 */
import { writeFile, mkdir, rm } from "node:fs/promises";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice(6) : ".preview/time.html");

if (process.argv.includes("--old")) {
  const dest = resolve(ROOT, ".preview/old");
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  execSync(`git archive origin/main scripts styles templates lang module.json assets/fonts | tar -x -C "${dest.replace(/\\/g, "/")}"`, { cwd: ROOT, stdio: "inherit", shell: "bash" });
}

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Time HUD preview</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/handlebars.js/4.7.8/handlebars.min.js"></script>
<script>
  const BASE = new URLSearchParams(location.search).get("impl") === "old" ? "/.preview/old/" : "/";
  for (const s of ["gl-fonts", "gl-tokens", "gl-motion", "clocks-tracker-hud", "clocks-tracker-weather", "clocks-tracker-delving"])
    document.write('<link rel="stylesheet" href="' + BASE + 'styles/' + s + '.css">');
</script>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #0b0d0c; }
  #map { position: fixed; inset: 0; background:
    linear-gradient(rgb(255 255 255 / 0.035) 1px, transparent 1px) 0 0 / 70px 70px,
    linear-gradient(90deg, rgb(255 255 255 / 0.035) 1px, transparent 1px) 0 0 / 70px 70px,
    radial-gradient(40% 50% at 30% 60%, #2a3324, transparent 70%),
    radial-gradient(35% 40% at 70% 35%, #3a3022, transparent 70%),
    radial-gradient(60% 60% at 50% 50%, #1c211b, #0b0d0c); }
  #err { position: fixed; left: 8px; bottom: 8px; color: #ff6b6b; font: 12px monospace; white-space: pre; z-index: 99; }
  #glct-hud { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 30; }
  /* A stand-in for Foundry's own window frame, so a framed app sits where it would. */
  .pv-stage { position: fixed; top: 220px; left: 0; right: 0; bottom: 0; display: flex; gap: 18px; justify-content: center; align-items: flex-start; flex-wrap: wrap; overflow: auto; padding: 0 18px 18px; z-index: 20; }
  .pv-stage > .application { position: relative !important; inset: auto !important; transform: none !important; }
  .application.pv-framed { display: flex; flex-direction: column; background: #0b0a13; color: #e7e6ef; border: 1px solid #302f3d; border-radius: 6px; box-shadow: 0 0 20px #000; font: 14px/1.4 "Signika", system-ui, sans-serif; }
  .application.pv-framed > .window-header { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 10px; border-bottom: 1px solid #302f3d; font-weight: 700; }
  .application.pv-framed > .window-header .window-title { flex: 1; margin: 0; font-size: 14px; }
  .application.pv-framed > .window-content { padding: 12px; overflow: auto; }
  .pv-chat { width: 300px; background: #0b0a13; border: 1px solid #302f3d; padding: 6px; display: flex; flex-direction: column; gap: 8px; }
  .pv-chat .chat-message { background: #1a1922; border: 1px solid #302f3d; border-radius: 5px; padding: 8px; color: #e7e6ef; font: 14px/1.4 system-ui, sans-serif; }
  .pv-chat .message-header { display: flex; justify-content: space-between; font-size: 12px; }
  .pv-chat .message-metadata { display: flex; }
</style></head>
<body><div id="map"></div><pre id="err" class="err"></pre>
<script type="module">
const q = new URLSearchParams(location.search);
const BASE = q.get("impl") === "old" ? "/.preview/old/" : "/";
const errEl = document.getElementById("err");
const report = (m) => { errEl.textContent += m + "\\n"; };
window.addEventListener("error", (e) => report(e.message || e));
window.addEventListener("unhandledrejection", (e) => report(e.reason?.stack || e.reason));

try {
  /* ---------------- i18n ---------------- */
  const labels = {};
  const manifest = await fetch(BASE + "module.json").then((r) => r.json());
  for (const lang of manifest.languages) Object.assign(labels, await fetch(BASE + lang.path).then((r) => r.json()));
  const localize = (k) => labels[k] ?? k;
  const format = (k, d = {}) => localize(k).replace(/{(\\w+)}/g, (_, n) => d[n] ?? "");

  /* ---------------- Handlebars: the real one, with Foundry's localize helper ---------------- */
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  Handlebars.registerHelper("localize", (k, opts) => Object.keys(opts?.hash ?? {}).length ? format(k, opts.hash) : localize(k));
  Handlebars.registerHelper("json", (v) => JSON.stringify(v, null, 2));
  const compile = (src) => Handlebars.compile(src);

  /* ---------------- Foundry stand-ins ---------------- */
  const values = new Map();
  const S = (k, v) => values.set(k, v);
  const hooks = new Map(); let hookId = 0;
  globalThis.Hooks = {
    on(n, fn) { const id = ++hookId; if (!hooks.has(n)) hooks.set(n, new Map()); hooks.get(n).set(id, fn); return id; },
    once(n, fn) { return this.on(n, fn); },
    off(n, id) { hooks.get(n)?.delete(id); },
    call(n, ...a) { for (const fn of hooks.get(n)?.values() ?? []) fn(...a); return true; },
    callAll(n, ...a) { return this.call(n, ...a); }
  };
  globalThis.ui = { notifications: { info() {}, warn: console.warn, error: console.error }, controls: null };
  globalThis.CONFIG = { time: {} };
  const deepClone = (o) => (o === undefined ? o : structuredClone(o));
  class ApplicationV2 {
    static DEFAULT_OPTIONS = {};
    static PARTS = {};
    constructor(options = {}) {
      const chain = [];
      for (let c = this.constructor; c && c !== Object; c = Object.getPrototypeOf(c)) chain.unshift(c.DEFAULT_OPTIONS ?? {});
      this.options = Object.assign({}, ...chain, options);
      this.options.actions = Object.assign({}, ...chain.map((o) => o.actions ?? {}));
      this.element = null; this.rendered = false;
    }
    async _prepareContext() { return {}; }
    async _onRender() {}
    async _onClose() {}
    async render() {
      const ctx = await this._prepareContext({});
      let out = "";
      for (const p of Object.values(this.constructor.PARTS)) {
        const path = p.template.replace("modules/" + manifest.id + "/", BASE);
        out += compile(await fetch(path).then((r) => r.text()))(ctx);
      }
      const framed = this.options.window?.frame !== false;
      if (!this.element) {
        const el = document.createElement(this.options.tag || "div");
        if (this.options.id) el.id = this.options.id;
        el.classList.add("application", ...(this.options.classes ?? []));
        if (framed) {
          el.classList.add("pv-framed");
          const w = this.options.position?.width;
          if (typeof w === "number") el.style.width = w + "px";
          const title = localize(this.options.window?.title ?? "");
          el.innerHTML = '<header class="window-header"><h1 class="window-title">' + esc(title) + '</h1><button type="button" class="header-control fa-solid fa-xmark"></button></header><section class="window-content"></section>';
        }
        el.addEventListener("click", (ev) => {
          const t = ev.target.closest("[data-action]");
          const fn = t && this.options.actions[t.dataset.action];
          if (fn) fn.call(this, ev, t);
        });
        (framed ? (document.querySelector(".pv-stage") ?? document.body) : document.body).append(el);
        this.element = el;
      }
      (framed ? this.element.querySelector(".window-content") : this.element).innerHTML = out;
      this.rendered = true;
      await this._onRender(ctx, {});
      return this;
    }
    async close() { await this._onClose({}); this.element?.remove(); this.element = null; this.rendered = false; }
    setPosition() {}
  }
  const DialogV2 = { confirm: async () => false, prompt: async () => null, wait: async () => null };
  globalThis.foundry = {
    utils: { deepClone, randomID: () => Math.random().toString(36).slice(2, 18), escapeHTML: esc, mergeObject: (a, b) => Object.assign(a, b) },
    applications: { api: { ApplicationV2, HandlebarsApplicationMixin: (B) => class extends B {}, DialogV2 }, instances: new Map() }
  };

  /* ---------------- a calendar from the shipped preset ---------------- */
  const { PRESETS, DEFAULT_PRESET } = await import(BASE + "scripts/features/clocks-tracker/calendar/presets.js");
  const cfg = PRESETS[DEFAULT_PRESET];
  const months = cfg.months.values, days = cfg.days.values, seasons = cfg.seasons?.values ?? [];
  const perYear = months.reduce((a, m) => a + (m.days ?? 0), 0);
  const calendar = {
    ...cfg,
    months: { values: months }, days: { ...cfg.days, values: days }, seasons: { values: seasons },
    timeToComponents(t) {
      const d = Math.floor(t / 86400), sod = t - d * 86400;
      const year = Math.floor(d / perYear) + (cfg.years?.yearZero ?? 0);
      let doy = ((d % perYear) + perYear) % perYear, month = 0;
      while (month < months.length - 1 && doy >= months[month].days) { doy -= months[month].days; month++; }
      const season = Math.max(0, seasons.findIndex((s) => {
        const a = s.monthStart, b = s.monthEnd, m = month + 1;
        return a <= b ? m >= a && m <= b : m >= a || m <= b;
      }));
      return { year, day: ((d % perYear) + perYear) % perYear, month, dayOfMonth: doy, dayOfWeek: (((cfg.years?.firstWeekday ?? 0) + d) % days.length + days.length) % days.length,
        hour: Math.floor(sod / 3600), minute: Math.floor((sod % 3600) / 60), second: sod % 60, season };
    },
    componentsToTime(c) { return ((c.year - (cfg.years?.yearZero ?? 0)) * perYear + (c.day ?? 0)) * 86400 + (c.hour ?? 0) * 3600 + (c.minute ?? 0) * 60 + (c.second ?? 0); }
  };
  const hour = Number(q.get("h") ?? 13.5);
  const time = {
    worldTime: (4711 * perYear + 96) * 86400 + Math.round(hour * 6) * 600,
    calendar,
    get components() { return calendar.timeToComponents(this.worldTime); },
    async advance(s) { this.worldTime += s; GlctHud.refreshState(); },
    async set(t) { this.worldTime = t; GlctHud.refreshState(); }
  };
  const isGM = q.get("gm") !== "0";
  globalThis.game = {
    user: { id: "u1", isGM, name: "GM" },
    users: Object.assign([{ id: "u1", isGM: true, active: true }], { activeGM: { id: "u1" } }),
    settings: {
      get(_id, k) { if (values.has(k)) return values.get(k); throw new Error("unset " + k); },
      async set(_id, k, v) { values.set(k, v); return v; },
      register() {}, registerMenu() {}
    },
    i18n: { localize, format, lang: "en" },
    time, combat: null, dice: null, modules: new Map(), system: { id: "pf2e" }
  };

  /* ---------------- the scene ---------------- */
  const { SETTINGS } = await import(BASE + "scripts/features/clocks-tracker/const.js");
  const { makeDefaultWeather, effectFromKind, KINDS } = await import(BASE + "scripts/features/clocks-tracker/weather/presets.js");
  const { makeDefaultDelving } = await import(BASE + "scripts/features/clocks-tracker/delving/presets.js");
  S(SETTINGS.moduleConfig, {});
  S(SETTINGS.hudCollapsed, q.get("collapsed") === "1");
  S(SETTINGS.hudVisibleToPlayers, true);
  S(SETTINGS.shiftLevelMode, false);
  S(SETTINGS.hudGlitch, q.get("glitch") === "1");
  // Events around today, so the badge, the calendar bands and the detail panel all have rows.
  const now = time.components, mo = now.month, td = now.dayOfMonth + 1;
  S(SETTINGS.events, [
    { id: "e1", name: "Harvest Moon", month: mo, day: td, scope: "day", visibleToPlayers: true, notePublic: "The whole valley lights its lanterns." },
    { id: "e2", name: "Caravan to Ourolyn", month: mo, day: Math.max(1, td - 1), endMonth: mo, endDay: td + 3, scope: "range", visibleToPlayers: true, pinned: true },
    { id: "e3", name: "The Duke's Tithe", month: mo, day: td + 5, scope: "day", visibleToPlayers: false, notePrivate: "The tithe is short by a third." },
    { id: "e4", name: "Month of Ash", month: mo, scope: "month", visibleToPlayers: true }
  ]);
  S(SETTINGS.mission, q.get("mission") === "1" ? { active: true, target: time.worldTime + 600 * 22, label: "Reach the pass", kind: "deadline" } : { active: false });
  const kind = q.get("wx") ?? "storm";
  S(SETTINGS.weatherEnabled, kind !== "none");
  if (kind !== "none") {
    const w = makeDefaultWeather();
    const region = w.regions[w.activeRegion];
    const k = KINDS[kind] ? kind : "storm";
    for (const s of Object.values(region.climate.seasons ?? {})) {
      const i = region.state.currentIndex;
      if (s?.hexes?.[i]) s.hexes[i] = { ...s.hexes[i], label: KINDS[k].label, icon: KINDS[k].icon, temperature: KINDS[k].temperature, effect: effectFromKind(k) };
    }
    S(SETTINGS.weather, w);
  }
  S(SETTINGS.delvingEnabled, q.get("delve") === "1");
  S(SETTINGS.delving, { ...makeDefaultDelving(), active: q.get("delve") === "1" });

  // The suite roster is not built here; answer the promoted sub-features the
  // way a world with them switched on (or the delve off) would.
  const { Suite } = await import(BASE + "scripts/core/registry.mjs");
  Suite.enabled = (id) => ({ "clocks-weather": kind !== "none", "clocks-delving": q.get("delve") === "1", "clocks-trackers": false })[id] ?? true;

  const { GlctHud } = await import(BASE + "scripts/features/clocks-tracker/apps/hud.js");
  window.GlctHud = GlctHud;
  await GlctHud.open();
  const seek = q.get("seek");
  if (seek != null) {
    const fx = await import(BASE + "scripts/features/clocks-tracker/weather/effects.js");
    fx.WeatherEffect.seek?.(Number(seek) || 0);
    const i = GlctHud.instance;
    for (const e of [i?._wx, i?._dx]) if (e?.model?.look === "storm") { e._strike(0.8); e._draw(); }
  }

  /* ---------------- the other surfaces, each the shipped app ---------------- */
  const view = q.get("view") ?? "hud";
  if (view !== "hud") {
    const stage = document.createElement("div");
    stage.className = "pv-stage";
    document.body.append(stage);
    const app = (f) => import(BASE + "scripts/features/clocks-tracker/apps/" + f);
    globalThis.ChatMessage = { implementation: { getSpeaker: () => ({}), create: async () => null } };
    if (view === "weather") {
      const { WeatherHud } = await app("weather-hud.js");
      await WeatherHud.open();
      const el = document.getElementById("glct-weather-hud");
      if (el) { el.style.position = "fixed"; el.style.left = "calc(50% - 144px)"; el.style.top = "220px"; }
    } else if (view === "calendar") {
      const { CalendarView } = await app("calendar-view.js");
      await CalendarView.show();
      const cell = document.querySelector('.glct-calendar .cal-cell[data-day="' + td + '"]');
      cell?.click();
    } else if (view === "events") {
      const { EventsEditor } = await app("events-editor.js");
      await EventsEditor.show();
    } else if (view === "wxeditor") {
      const { WeatherEditor } = await app("weather-editor.js");
      await WeatherEditor.show();
    } else if (view === "delveditor") {
      const { DelvingEditor } = await app("delving-editor.js");
      await DelvingEditor.show();
    } else if (view === "caledit") {
      const { CalendarEditor } = await app("calendar-editor.js");
      await CalendarEditor.show();
    } else if (view === "modcfg") {
      const { ModuleConfigEditor } = await app("module-config-editor.js");
      await ModuleConfigEditor.show();
    } else if (view === "shiftnames") {
      const { ShiftNamesEditor } = await app("shift-names-editor.js");
      await ShiftNamesEditor.show();
    } else if (view === "cards") {
      const { WeatherEngine } = await import(BASE + "scripts/features/clocks-tracker/weather/engine.js");
      const { DelvingStore } = await import(BASE + "scripts/features/clocks-tracker/delving/delving-store.js");
      const w = game.settings.get("", SETTINGS.weather);
      const region = w?.regions?.[w.activeRegion];
      const season = region ? WeatherEngine.resolveSeason(region.climate, Object.keys(region.climate.seasons ?? {})[0]) : null;
      const at = region?.state?.currentIndex ?? 9;
      const hex = season?.hexes?.[at] ?? { label: "Storm", icon: "fa-solid fa-cloud-bolt", effect: effectFromKind("storm") };
      const ominous = { ...hex, label: "Blood Rain", description: "Red rain hisses where it lands.", effectNote: "Exposure: DC 18 Fortitude each hour.", effect: { ...hex.effect, ominous: true, tintGlow: "#ff4d5a" } };
      const cards = [
        WeatherEngine._cardHtml({ hex: { ...hex, description: hex.description ?? "Thunder rolls down the valley." }, index: at, seasonName: "Spring", meta: { from: 4, dir: "upperRight", roll: 7 } }),
        WeatherEngine._cardHtml({ hex: ominous, index: at, seasonName: "Spring", meta: {} }),
        DelvingStore._cardHtml({ turn: 4, label: "Turn", featuredId: "a", header: true, rolls: [
          { id: "a", name: "Torches", icon: "fa-solid fa-fire", tint: "#ff9a3c", faces: [6, 2, 1, 5], discard: 2, size: 6, stageName: "Guttering", remaining: 2, stageShift: true },
          { id: "b", name: "Rations", icon: "fa-solid fa-bread-slice", tint: "#9aa3b0", faces: [], discard: 0, size: 6, stageName: "Starving", empty: true, terminal: true, terminalName: "Famine", ominous: true }
        ] })
      ];
      const log = document.createElement("div");
      log.className = "pv-chat";
      log.id = "chat-log";
      for (const [i, c] of cards.entries()) {
        const msg = document.createElement("div");
        msg.className = "chat-message " + (i < 2 ? "glct-weather-msg" : "glct-delve-msg");
        msg.innerHTML = '<header class="message-header"><span class="message-sender">GM</span><span class="message-metadata"><time>2m ago</time></span></header><div class="message-content">' + c + "</div>";
        log.append(msg);
      }
      stage.append(log);
    }
  }
  document.body.dataset.ready = "1";
} catch (e) { report(e.stack || e); }
</script></body></html>
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html);
console.log("wrote " + OUT);
