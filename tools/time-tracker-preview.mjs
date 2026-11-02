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

  /* ---------------- a tiny Handlebars: if / unless / else / localize / vars ---------------- */
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function parse(src) {
    src = src.replace(/{{!--[\\s\\S]*?--}}/g, "").replace(/{{![\\s\\S]*?}}/g, "");
    const root = { kids: [] }, stack = [root];
    const re = /{{([#/]?)(\\w+)?\\s*([^}]*)}}/g;
    let last = 0, m;
    while ((m = re.exec(src))) {
      stack.at(-1).kids.push(src.slice(last, m.index));
      last = re.lastIndex;
      const [, sig, name, arg] = m;
      if (sig === "#") { const n = { block: name, arg: arg.trim(), kids: [], alt: null }; stack.at(-1).kids.push(n); stack.push(n); }
      else if (sig === "/") stack.pop();
      else if (name === "else") { const n = stack.at(-1); n.alt = []; n.kids = n.kids; n.inAlt = true; }
      else stack.at(-1)[stack.at(-1).inAlt ? "alt" : "kids"].push({ tag: name, arg: arg.trim() });
    }
    stack.at(-1).kids.push(src.slice(last));
    return root;
  }
  function run(node, ctx) {
    let out = "";
    for (const k of node.kids ?? []) {
      if (typeof k === "string") out += k;
      else if (k.block) {
        const v = k.arg.split(".").reduce((o, p) => o?.[p], ctx);
        const truthy = k.block === "unless" ? !v : !!v;
        out += truthy ? run({ kids: k.kids }, ctx) : run({ kids: k.alt ?? [] }, ctx);
      } else if (k.tag === "localize") out += esc(localize(k.arg.replace(/^['"]|['"]$/g, "")));
      else out += esc([k.tag, ...(k.arg ? [k.arg] : [])].join(".").split(".").reduce((o, p) => o?.[p], ctx));
    }
    return out;
  }
  // else markers land in the open block's alt list
  const compile = (src) => { const tree = parse(src); return (ctx) => run(tree, ctx); };

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
      if (!this.element) {
        const el = document.createElement(this.options.tag || "div");
        if (this.options.id) el.id = this.options.id;
        el.classList.add("application", ...(this.options.classes ?? []));
        el.addEventListener("click", (ev) => {
          const t = ev.target.closest("[data-action]");
          const fn = t && this.options.actions[t.dataset.action];
          if (fn) fn.call(this, ev, t);
        });
        document.body.append(el);
        this.element = el;
      }
      this.element.innerHTML = out;
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
  S(SETTINGS.hudGlitch, false);
  S(SETTINGS.events, [{ id: "e1", name: "Harvest Moon", month: 3, day: 9, scope: "day", visibleToPlayers: true }]);
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
  document.body.dataset.ready = "1";
} catch (e) { report(e.stack || e); }
</script></body></html>
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html);
console.log("wrote " + OUT);
