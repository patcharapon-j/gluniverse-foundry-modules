#!/usr/bin/env node
/**
 * Ink and Signal — specimen page for the core `--gl-is-*` family.
 *
 * Writes a page that loads the SHIPPED gl-fonts.css, gl-tokens.css and
 * gl-motion.css and draws every primitive the family defines: the ink ramp,
 * the tones, the signal hues, the type scale, the state tokens, the cut scale,
 * the shared controls, and the same set again on the paper ground. Every
 * value printed is read back from the computed style, so the page shows what
 * core says, never a copy of it. A contrast grid checks each text tone
 * against each ink step on both grounds.
 *
 *   node tools/ink-signal-preview.mjs [--out=.preview/ink-signal.html]
 *   node tools/preview-server.mjs
 *   → http://localhost:8931/.preview/ink-signal.html
 *
 * Serve it from the repository root; the stylesheets are linked relatively.
 * See DESIGN.md and docs/adr/0012-ink-and-signal-core.md.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice("--out=".length) : ".preview/ink-signal.html");
const rel = relative(dirname(OUT), ROOT).replaceAll("\\", "/") || ".";

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ink and Signal</title>
<link rel="stylesheet" href="${rel}/styles/gl-fonts.css">
<link rel="stylesheet" href="${rel}/styles/gl-tokens.css">
<link rel="stylesheet" href="${rel}/styles/gl-motion.css">
<style>
  body { margin: 0; background: var(--gl-is-ink-0); color: var(--gl-is-text); font: 500 var(--gl-is-t-body)/1.45 var(--gl-is-font); }
  .glis-spec { padding: 28px 32px 48px; background: var(--gl-is-ink-0); color: var(--gl-is-text); }
  .glis-spec.gl-is-paper { border-top: 1px solid var(--gl-is-line-strong); }
  .glis-head { display: flex; align-items: baseline; gap: 16px; margin-bottom: 24px; }
  .glis-head h1 { margin: 0; font-size: var(--gl-is-t-display); font-weight: 750; letter-spacing: -0.01em; }
  .glis-head p { margin: 0; color: var(--gl-is-dim); font-size: var(--gl-is-t-lead); }
  .glis-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; }
  .glis-card { background: var(--gl-is-ink-1); box-shadow: inset 0 0 0 1px var(--gl-is-line); padding: 16px;
    clip-path: polygon(0 0, 100% 0, 100% calc(100% - var(--gl-is-cut)), calc(100% - var(--gl-is-cut)) 100%, 0 100%); }
  .glis-card h2 { margin: 0 0 12px; font-size: var(--gl-is-t-title); font-weight: 700; }
  .glis-wide { grid-column: 1 / -1; }
  .glis-meta { font-size: var(--gl-is-t-meta); color: var(--gl-is-faint); }
  .glis-num { font-family: var(--gl-is-num); font-size: var(--gl-is-t-meta); color: var(--gl-is-dim); }

  .glis-ramp { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
  .glis-sw { height: 56px; box-shadow: inset 0 0 0 1px var(--gl-is-line); }
  .glis-swl { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
  .glis-tones { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px; }
  .glis-tone { display: flex; flex-direction: column; gap: 4px; }
  .glis-tone .glis-sw { height: 36px; }

  .glis-type { display: flex; flex-direction: column; gap: 10px; }
  .glis-type > div { display: grid; grid-template-columns: 76px 1fr; align-items: baseline; gap: 12px; }

  .glis-btn { display: inline-flex; align-items: center; justify-content: center; min-height: 32px; padding: 0 12px;
    border: 0; background: var(--gl-is-ink-3); color: var(--gl-is-text); font: 600 var(--gl-is-t-body)/1 var(--gl-is-font);
    box-shadow: inset 0 0 0 1px var(--gl-is-line); cursor: pointer;
    clip-path: polygon(0 0, 100% 0, 100% calc(100% - var(--gl-is-cut-sm)), calc(100% - var(--gl-is-cut-sm)) 100%, 0 100%);
    transition: background var(--gl-d-brisk) var(--gl-ease), translate var(--gl-d-brisk) var(--gl-ease), scale var(--gl-d-brisk) var(--gl-ease); }
  .glis-btn:hover, .glis-btn.is-hover { background: var(--gl-is-ink-4); translate: 0 var(--gl-lift); }
  .glis-btn:active, .glis-btn.is-press { scale: var(--gl-is-press); }
  .glis-btn:disabled { opacity: var(--gl-is-disabled); cursor: default; translate: none; background: var(--gl-is-ink-3); }
  .glis-btn:focus-visible, .glis-btn.is-focus { outline: var(--gl-is-focus-ring); outline-offset: var(--gl-is-focus-offset); clip-path: none; }
  .glis-btn.is-primary { background: var(--gl-is-paper); color: var(--gl-is-on-slab); box-shadow: none; }
  .glis-states { display: flex; flex-wrap: wrap; gap: 14px 12px; align-items: flex-end; }
  .glis-states figure { margin: 0; display: flex; flex-direction: column; gap: 6px; }

  .glis-rows { display: flex; flex-direction: column; }
  .glis-row { display: flex; justify-content: space-between; padding: 8px 10px; box-shadow: inset 0 -1px 0 var(--gl-is-line); }
  .glis-row.is-hover { background: var(--gl-is-hover); }
  .glis-row.is-selected { background: var(--gl-is-selected); box-shadow: inset 0 -1px 0 var(--gl-is-line), inset 2px 0 0 var(--gl-is-amber); }

  .glis-tag { display: inline-flex; align-items: center; min-height: 20px; padding: 0 12px 0 7px;
    font: 700 var(--gl-is-t-meta)/1 var(--gl-is-font); letter-spacing: 0.08em; text-transform: uppercase;
    background: var(--glis-tone); color: var(--gl-is-on-slab); clip-path: polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0 100%); }
  .glis-tags { display: flex; flex-wrap: wrap; gap: 8px; }

  .glis-cuts { display: flex; gap: 14px; align-items: flex-end; }
  .glis-cut { width: 84px; height: 56px; background: var(--gl-is-ink-4);
    clip-path: polygon(0 0, 100% 0, 100% calc(100% - var(--c)), calc(100% - var(--c)) 100%, 0 100%); }

  .glis-field { display: flex; flex-direction: column; gap: 6px; max-width: 280px; }
  .glis-field label { font-size: var(--gl-is-t-meta); color: var(--gl-is-dim); font-weight: 600; }
  .glis-field input { height: 32px; padding: 0 10px; border: 0; background: var(--gl-is-ink-0); color: var(--gl-is-text);
    font: 500 var(--gl-is-t-body)/1 var(--gl-is-font); box-shadow: inset 0 0 0 1px var(--gl-is-line-strong); }
  .glis-field input:focus-visible { outline: var(--gl-is-focus-ring); outline-offset: var(--gl-is-focus-offset); }
  .glis-seg { display: inline-flex; background: var(--gl-is-ink-0); box-shadow: inset 0 0 0 1px var(--gl-is-line); padding: 2px; gap: 2px; }
  .glis-seg button { border: 0; min-height: 28px; padding: 0 12px; background: transparent; color: var(--gl-is-dim);
    font: 600 var(--gl-is-t-body)/1 var(--gl-is-font); cursor: pointer; }
  .glis-seg button[aria-pressed="true"] { background: var(--gl-is-ink-4); color: var(--gl-is-text); }

  .glis-plate { background: var(--gl-is-ink-2); box-shadow: inset 0 0 0 1px var(--gl-is-line); padding: 14px 16px;
    clip-path: polygon(0 0, 100% 0, 100% calc(100% - var(--gl-is-cut-lg)), calc(100% - var(--gl-is-cut-lg)) 100%, 0 100%); }
  .glis-plate strong { display: block; font-size: var(--gl-is-t-display); font-weight: 750; font-family: var(--gl-is-num); }

  .glis-contrast { width: 100%; border-collapse: collapse; font-size: var(--gl-is-t-meta); }
  .glis-contrast th, .glis-contrast td { padding: 6px 8px; text-align: center; box-shadow: inset 0 -1px 0 var(--gl-is-line); }
  .glis-contrast th { color: var(--gl-is-dim); font-weight: 600; }
  .glis-contrast td { font-family: var(--gl-is-num); }
  .glis-contrast td.is-fail { color: var(--gl-is-red); }
</style>
</head>
<body>
  <section class="glis-spec" data-ground="ink"></section>
  <section class="glis-spec gl-is-paper" data-ground="paper"></section>
<script>
const INKS = [0, 1, 2, 3, 4, 5, 6].map((n) => "--gl-is-ink-" + n);
const TONES = ["text", "paper", "dim", "faint", "steel", "on-slab"].map((n) => "--gl-is-" + n);
const SIGNALS = ["amber", "red", "green", "ember", "info"].map((n) => "--gl-is-" + n);
const TYPE = [["display", 750], ["title", 700], ["lead", 600], ["body", 500], ["meta", 700]];
const CUTS = ["cut-lg", "cut", "cut-sm", "cut-xs"];

const probe = (root, prop) => {
  const el = document.createElement("i");
  el.style.color = "var(" + prop + ")";
  root.append(el);
  const c = getComputedStyle(el).color; el.remove();
  return c;
};
const rgb = (c) => (c.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
const hex = (c) => "#" + rgb(c).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const lum = (c) => { const [r, g, b] = rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const varOf = (root, prop) => getComputedStyle(root).getPropertyValue(prop).trim();

for (const root of document.querySelectorAll(".glis-spec")) {
  const paper = root.dataset.ground === "paper";
  const sw = (prop) => '<div class="glis-tone"><div class="glis-sw" style="background:var(' + prop + ')"></div><span class="glis-meta">' + prop.replace("--gl-is-", "") + '</span><span class="glis-num">' + hex(probe(root, prop)) + "</span></div>";
  root.innerHTML = \`
  <div class="glis-head"><h1>\${paper ? "Paper ground" : "Ink and Signal"}</h1>
    <p>\${paper ? "The same roles on <code>.gl-is-paper</code>, for hosts known to be light." : "Core <code>--gl-is-*</code> tokens, read back from the shipped gl-tokens.css."}</p></div>
  <div class="glis-grid">
    <div class="glis-card glis-wide"><h2>Ink ramp</h2>
      <div class="glis-ramp">\${INKS.map((p) => '<div><div class="glis-sw" style="background:var(' + p + ')"></div><div class="glis-swl"><span class="glis-meta">' + p.replace("--gl-is-", "") + '</span><span class="glis-num">' + hex(probe(root, p)) + "</span></div></div>").join("")}</div></div>
    <div class="glis-card"><h2>Tones</h2><div class="glis-tones">\${TONES.map(sw).join("")}</div></div>
    <div class="glis-card"><h2>Signals</h2><div class="glis-tones">\${SIGNALS.map(sw).join("")}</div>
      <div class="glis-tags" style="margin-top:14px">\${SIGNALS.map((p) => '<span class="glis-tag" style="--glis-tone:var(' + p + ')">' + p.replace("--gl-is-", "") + "</span>").join("")}</div></div>
    <div class="glis-card"><h2>Type scale</h2><div class="glis-type">\${TYPE.map(([n, w]) => '<div><span class="glis-num">' + n + " " + varOf(root, "--gl-is-t-" + n) + '</span><span style="font-size:var(--gl-is-t-' + n + ');font-weight:' + w + (n === "meta" ? ";letter-spacing:0.1em;text-transform:uppercase" : "") + '">Round 3, the goblin war band</span></div>').join("")}
      <div><span class="glis-num">num</span><span style="font-family:var(--gl-is-num);font-size:var(--gl-is-t-title)">DC 24 · +17 · 63%</span></div></div></div>
    <div class="glis-card"><h2>Control states</h2><div class="glis-states">
      \${[["", "rest"], ["is-hover", "hover"], ["is-press", "press"], ["is-focus", "focus"], ["disabled", "disabled"], ["is-primary", "primary"]].map(([c, l]) => '<figure><button class="glis-btn ' + (c === "disabled" ? "" : c) + '"' + (c === "disabled" ? " disabled" : "") + ">Roll check</button><figcaption class=\\"glis-meta\\">" + l + "</figcaption></figure>").join("")}</div>
      <div class="glis-rows" style="margin-top:16px">
        <div class="glis-row"><span>Seri Ashveil</span><span class="glis-num">rest</span></div>
        <div class="glis-row is-hover"><span>Brann Coldwater</span><span class="glis-num">--gl-is-hover</span></div>
        <div class="glis-row is-selected"><span>Ilya of the Reeds</span><span class="glis-num">--gl-is-selected</span></div></div></div>
    <div class="glis-card"><h2>Cut scale</h2><div class="glis-cuts">\${CUTS.map((c) => '<figure style="margin:0;display:flex;flex-direction:column;gap:6px"><div class="glis-cut" style="--c:var(--gl-is-' + c + ')"></div><span class="glis-meta">' + c + '</span><span class="glis-num">' + varOf(root, "--gl-is-" + c) + "</span></figure>").join("")}</div>
      <p class="glis-meta" style="margin:12px 0 0">cut-lg on slabs and answer plates, cut on panels, cut-sm on controls, cut-xs on tags. Radius \${varOf(root, "--gl-is-radius")} for anything round.</p></div>
    <div class="glis-card"><h2>Fields and pickers</h2>
      <div class="glis-field"><label for="glis-n-\${root.dataset.ground}">Encounter name</label><input id="glis-n-\${root.dataset.ground}" value="Ambush at the ford"></div>
      <div class="glis-seg" style="margin-top:14px"><button aria-pressed="false">Trivial</button><button aria-pressed="true">Moderate</button><button aria-pressed="false">Severe</button></div></div>
    <div class="glis-card"><h2>Answer plate</h2><div class="glis-plate"><span class="glis-meta">Fate Chart, chaos 5</span><strong>Yes</strong><span style="color:var(--gl-is-dim)">Likely, rolled 34 against 50.</span></div></div>
    <div class="glis-card glis-wide"><h2>Text contrast</h2><table class="glis-contrast"><thead><tr><th></th>\${INKS.map((p) => "<th>" + p.replace("--gl-is-", "") + "</th>").join("")}</tr></thead>
      <tbody>\${["--gl-is-text", "--gl-is-dim", "--gl-is-faint", "--gl-is-steel", ...SIGNALS].map((t) => "<tr><th>" + t.replace("--gl-is-", "") + "</th>" + INKS.map((p) => { const r = ratio(probe(root, t), probe(root, p)); return '<td class="' + (r < 4.5 ? "is-fail" : "") + '">' + r.toFixed(2) + "</td>"; }).join("") + "</tr>").join("")}</tbody></table>
      <p class="glis-meta" style="margin:10px 0 0">Red cells are under 4.5:1. Faint is for ink-0 to ink-3 only.</p></div>
  </div>\`;
}
</script>
</body>
</html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, page);
console.log(`wrote ${relative(ROOT, OUT)} — serve with: node tools/preview-server.mjs, then /${relative(ROOT, OUT).replaceAll("\\", "/")}`);
