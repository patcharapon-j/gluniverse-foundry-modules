/**
 * tools/weather-fx-preview.mjs — write a live gallery of every weather kind and
 * every delving atmosphere, drawn by the SHIPPED renderer.
 *
 * The page imports `scripts/features/clocks-tracker/weather/effects.js` and the
 * kind/stage libraries over a preview server, so each strip is the code Foundry
 * runs. `--old` also copies origin/main's renderer into .preview/old/ so the
 * page can show it beside the new one (`?impl=old`).
 *
 *   node tools/weather-fx-preview.mjs [--out=.preview/weather.html] [--old]
 *   node tools/preview-server.mjs 8971      # then open /.preview/weather.html
 *
 * SERVE it: a file:// page does not execute its module script.
 *
 *   ?impl=old        origin/main's renderer (needs --old)
 *   ?only=storm,fog  just these kinds / stage looks
 *   ?seek=12.5       freeze the loop at this many seconds (headless stills)
 *   ?size=bar|chip   only one host size
 *
 * `window.__wx` exposes the effects for headless use.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice(6) : ".preview/weather.html");

if (process.argv.includes("--old")) {
  const copy = async (rel, to) => {
    const src = execFileSync("git", ["show", `origin/main:${rel}`], { cwd: ROOT, encoding: "utf8" });
    const dest = resolve(ROOT, ".preview/old", to ?? rel);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, src);
  };
  await copy("scripts/features/clocks-tracker/weather/effects.js");
  await copy("scripts/core/util.mjs");
}

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Weather FX preview</title>
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<style>
  html, body { margin: 0; background: var(--gl-ink-0); color: var(--gl-text); font-family: var(--gl-display); }
  main { padding: 18px 22px; display: grid; grid-template-columns: repeat(3, max-content); gap: 14px 22px; }
  h1 { grid-column: 1 / -1; margin: 0 0 4px; font: 600 13px/1 var(--gl-tech); letter-spacing: .2em; text-transform: uppercase; color: var(--gl-text-dim); }
  .row { display: flex; align-items: center; gap: 10px; }
  .lbl { width: 108px; font: 600 11px/1.3 var(--gl-tech); letter-spacing: .08em; text-transform: uppercase; color: var(--gl-text-dim); }
  .lbl b { display: block; color: var(--gl-text); font-weight: 600; letter-spacing: .04em; }
  .host { position: relative; overflow: hidden; background: linear-gradient(180deg, #14161b, #0c0d10); border: 1px solid rgb(255 255 255 / .08); }
  .bar { width: 300px; height: 54px; border-radius: 10px; }
  .chip { width: 62px; height: 50px; border-radius: 9px; }
  .host canvas { position: absolute; inset: 0; }
  #err { position: fixed; left: 8px; bottom: 8px; color: #ff6b6b; font: 12px monospace; white-space: pre; }
</style></head>
<body><main id="m"></main><pre id="err" class="err"></pre>
<script type="module">
const q = new URLSearchParams(location.search);
const impl = q.get("impl") === "old" ? "/.preview/old/scripts/features/clocks-tracker/weather/effects.js" : "/scripts/features/clocks-tracker/weather/effects.js";
const errEl = document.getElementById("err");
window.addEventListener("error", (e) => { errEl.textContent += (e.message || e) + "\\n"; });
const origWarn = console.warn;
console.warn = (...a) => { errEl.textContent += a.map(String).join(" ") + "\\n"; origWarn(...a); };
try {
  const { WeatherEffect } = await import(impl);
  const { KINDS, effectFromKind } = await import("/scripts/features/clocks-tracker/weather/presets.js");
  const { STAGE_LOOKS } = await import("/scripts/features/clocks-tracker/delving/presets.js");
  const only = q.get("only")?.split(",");
  const size = q.get("size");
  const rows = [
    ...Object.keys(KINDS).map((k) => ({ key: k, label: KINDS[k].label, spec: effectFromKind(k), group: "weather" })),
    ...Object.entries(STAGE_LOOKS).map(([k, l]) => ({ key: k, label: l.label, spec: l.effect, group: "delving" }))
  ].filter((r) => !only || only.includes(r.key));
  const m = document.getElementById("m");
  const h = document.createElement("h1");
  h.textContent = "Weather FX · " + (q.get("impl") === "old" ? "origin/main" : "this branch");
  m.append(h);
  const fx = [];
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = '<span class="lbl"><b></b></span>';
    row.querySelector("b").textContent = r.label;
    row.querySelector(".lbl").append(r.spec.archetype);
    for (const cls of ["bar", "chip"]) {
      if (size && size !== cls) continue;
      const host = document.createElement("div");
      host.className = "host " + cls;
      row.append(host);
      fx.push({ host, spec: r.spec });
    }
    m.append(row);
  }
  await new Promise((r) => requestAnimationFrame(r));
  const live = fx.map(({ host, spec }) => { const e = WeatherEffect.create(host, spec); e?.resize(); e?.resume(); return e; });
  window.__wx = live;
  const seek = q.get("seek");
  if (seek != null && typeof WeatherEffect.seek === "function") {
    // Hold the shared clock on one frame, with a strike in every storm.
    WeatherEffect.seek(Number(seek) || 0);
    for (const e of live) if (e?.model?.look === "storm") { e._strike(0.8); e._draw(); }
  }
  document.body.dataset.ready = "1";
} catch (e) { errEl.textContent += (e.stack || e) + "\\n"; }
</script></body></html>
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html);
console.log("wrote " + OUT);
