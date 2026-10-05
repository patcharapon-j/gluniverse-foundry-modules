/**
 * tools/spotlight-roll-preview.mjs — write the Spotlight Roll visual-pass page.
 *
 * Drives the SHIPPED director, backdrop, overlay, stylesheet and lang file
 * (tools/spotlight-roll/preview.mjs). The die is a three.js stand-in for
 * Dice So Nice (there is no Foundry here), but its motion is the shipped
 * tumble model and its schedule the shipped timeline, so what you judge for
 * feel is what will run.
 *
 *   node tools/spotlight-roll-preview.mjs [--out=.preview/spotlight.html]
 *   node tools/preview-server.mjs        # then /.preview/spotlight.html
 *
 * SERVE it from the repository root: a file:// page does not execute its
 * module script. Seek, don't wait (the Browser pane throttles frames):
 *   ?layout=single|group3|group6|opposed &scenario=… &dc=shown|hidden|never
 *   &fortune=… &view=full|sealed &skin=… &render=webgl|css &motion=1
 *   &seek=<ms> &stagger=<ms> &arrive=<ms> &dock=0 &reroll=1
 * or window.__spotSeek(ms) / __spotArrive(ms) / __spotPlay().
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice(6) : ".preview/spotlight.html");
const THREE = "https://cdn.jsdelivr.net/npm/three@0.169.0";

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spotlight Roll preview</title>
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" href="/styles/spotlight-roll.css">
<link rel="stylesheet" href="/styles/spotlight-roll-app.css">
<script type="importmap">{ "imports": { "three": "${THREE}/build/three.module.js", "three/addons/": "${THREE}/examples/jsm/" } }</script>
<style>
  /* Harness chrome only — none of this ships. */
  html, body { margin: 0; height: 100%; overflow: hidden; background: #05070a; color: var(--gl-text); font-family: var(--gl-display); }
  /* Stand-in for the Foundry board the overlay sits on. */
  #board { position: fixed; inset: 0; background: url(/.preview/theatre/setup.webp) center / cover, #10141b; filter: saturate(0.9); }
  #board::after { content: ""; position: absolute; inset: 0; background:
    linear-gradient(90deg, rgb(var(--gl-tint-light) / 0.04) 1px, transparent 1px) 0 0 / 64px 64px,
    linear-gradient(rgb(var(--gl-tint-light) / 0.04) 1px, transparent 1px) 0 0 / 64px 64px; }
  #dock { position: fixed; z-index: 9999; left: 50%; bottom: 10px; translate: -50% 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
    max-width: calc(100vw - 32px); box-sizing: border-box; padding: 8px 10px; background: var(--gl-scrim); border: 1px solid var(--gl-hair); font-size: var(--gl-fs-sm); }
  #dock.hidden { display: none; }
  #dock button, #dock select { font: inherit; font-size: var(--gl-fs-sm); color: var(--gl-text); background: rgb(var(--gl-tint-light) / 0.06);
    border: 1px solid rgb(var(--gl-tint-light) / 0.14); padding: 4px 8px; cursor: pointer; }
  #dock button.on { border-color: var(--gl-accent); background: color-mix(in srgb, var(--gl-accent) 28%, transparent); }
  #dock label { color: var(--gl-text-dim); display: flex; gap: 5px; align-items: center; }
  #perf { position: fixed; z-index: 9999; right: 10px; top: 8px; font-family: var(--gl-tech); font-size: var(--gl-fs-xs); color: var(--gl-text-faint); }
  #err { position: fixed; z-index: 10000; left: 10px; top: 10px; max-width: 50vw; max-height: 60vh; overflow: auto; white-space: pre-wrap;
    font: 11px/1.4 var(--gl-tech); color: var(--gl-hazard-hot); background: rgb(0 0 0 / 0.8); padding: 8px; border: 1px solid var(--gl-hazard); }
</style>
</head>
<body>
<div id="board"></div>
<div id="glsr" class="glsr gl-type">
  <canvas class="glsr-bg"></canvas>
  <div class="glsr-cssbg"></div>
  <div class="glsr-back"></div>
  <canvas class="glsr-dice"></canvas>
  <div class="glsr-front"></div>
</div>
<div id="dock"></div>
<div id="perf"></div>
<pre id="err" class="err" hidden></pre>
<script type="module">
window.addEventListener("error", (e) => { const el = document.getElementById("err"); el.hidden = false; el.textContent += (e.message || e) + "\\n"; });
window.addEventListener("unhandledrejection", (e) => { const el = document.getElementById("err"); el.hidden = false; el.textContent += (e.reason?.stack || e.reason) + "\\n"; });
import("/tools/spotlight-roll/preview.mjs");
</script>
</body>
</html>
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html);
console.log("wrote " + OUT);
