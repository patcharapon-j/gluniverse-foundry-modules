#!/usr/bin/env node
/**
 * PF2e Variant Rules — a browser-backed look at every surface.
 *
 * These panels land in two hosts that supply their own type size: a chat card
 * (14px) and a PF2e item or actor sheet (16px). `.gl-btn` declares no font size
 * and states its padding in `em`, so a control that looks correct in a
 * standalone page can be half again too large in the place it actually ships —
 * that is not visible in a diff and was reported from a real table twice. Every
 * panel here is drawn inside a host box at the size it really gets.
 *
 * The markup mirrors what the feature emits;
 * `tools/pf2e-variant-rules-check.mjs` refuses any `glvr-` class here that
 * nothing in the source or the templates actually builds.
 *
 * Usage: node tools/variant-rules-preview.mjs [--out=.preview/variant.html]
 *        node tools/preview-server.mjs 8954
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice("--out=".length) : ".preview/variant.html");

const cell = (n, state) => `<span class="glvr-dent-cell${state ? ` ${state}` : ""}">${n}</span>`;

const dentPanel = (state, dents, destroyed, editable) => {
  const cells = Array.from({ length: destroyed }, (_, i) => {
    const n = i + 1;
    if (n > dents) return cell(n, "");
    return cell(n, n >= Math.ceil(destroyed / 2) ? "is-broken" : "is-hit");
  }).join("");

  const controls = editable
    ? `<button type="button" class="gl-btn glvr-dent-less">&minus;</button>
       <input type="number" class="glvr-dent-set" value="${dents}" min="0" max="${destroyed}" step="1">
       <span class="glvr-dent-of">/ ${destroyed}</span>
       <button type="button" class="gl-btn glvr-dent-more">+</button>`
    : `<span class="glvr-dent-count">${dents} / ${destroyed}</span>`;

  return `<section class="glvr-dent-panel" data-state="${state}">
    <header class="glvr-dent-head">
      <span class="glvr-dent-title">Dents</span>
      <span class="glvr-dent-state">${state}</span>
    </header>
    <div class="glvr-dent-track">${cells}</div>
    <footer class="glvr-dent-foot">
      ${controls}
      <span class="glvr-dent-scale">${Math.ceil(destroyed / 2)} broken · ${destroyed} destroyed</span>
    </footer>
  </section>`;
};

const repair = `
<section class="glvr-dent-repair">
  <header class="glvr-dent-head"><span class="glvr-dent-title">Repair</span></header>
  <p class="glvr-dent-line">A successful Repair removes 1 dent.</p>
  <div class="glvr-dent-fixes">
    <button type="button" class="gl-btn glvr-dent-fix">Sturdy Shield <span class="glvr-dent-fix-n">3</span></button>
    <button type="button" class="gl-btn glvr-dent-fix">Longsword <span class="glvr-dent-fix-n">1</span></button>
  </div>
</section>`;

const chip = `
<section class="glvr-chip">
  <div class="glvr-chip-row">
    <span class="glvr-chip-tag">Chip</span>
    <span class="glvr-chip-num">5</span>
    <span class="glvr-chip-meta">
      <span class="glvr-chip-what">slashing · Ambush Scout</span>
      <span class="glvr-chip-calc">level 7 → 5</span>
    </span>
    <span class="glvr-chip-acts">
      <button type="button" class="gl-btn gl-btn-accent glvr-chip-apply">Apply</button>
      <button type="button" class="gl-btn glvr-chip-dismiss">✕</button>
    </span>
  </div>
  <div class="glvr-chip-types">
    <button type="button" class="glvr-chip-type" aria-pressed="false">slashing</button>
    <button type="button" class="glvr-chip-type" aria-pressed="true">fire</button>
  </div>
</section>`;

const careful = `
<div class="glvr-careful-post">
  <button type="button" class="gl-btn gl-btn-accent glvr-careful-max">Maximize to 14</button>
</div>`;

const rest = `
<section class="glvr-rest">
  <header class="glvr-rest-head">Lasting Wounds</header>
  <p class="glvr-rest-line">Wounded survives the night. Three creatures still carry it:</p>
  <ul class="glvr-rest-list"><li>Seri Voss — wounded 2</li><li>Brack — wounded 1</li></ul>
</section>`;

const NUM = (label, value, name) => `
  <label class="glvr-cfg-field"><span>${label}</span>
    <input type="number" name="${name}" value="${value}" step="1"></label>`;

const MATERIALS = [
  ["Abysium", 0], ["Adamantine", 2], ["Cold Iron", 0], ["Dawnsilver", 0],
  ["Djezet", 0], ["Dragonhide", 1], ["Dreamweb", 0], ["Duskwood", 0],
  ["Grisantian Pelt", 0], ["Inubrix", -1], ["Keep-Stone", 0], ["Noqual", 0],
  ["Orichalcum", 3], ["Peachwood", 0], ["Siccatite", 0], ["Silver", 0],
];

const config = `
<div class="glvr-cfg-root gl-glass gl-type">
  <p class="glvr-cfg-lead">The book's rule is 2 dents broken, 4 destroyed, doubled for a sturdy shield. Everything on this sheet is your table's, and the shipped values are the printed rule exactly.</p>

  <fieldset class="glvr-cfg-block">
    <legend>Thresholds</legend>
    <div class="glvr-cfg-grid">
      ${NUM("Dents to broken", 2, "broken")}
      ${NUM("Dents to destroyed", 4, "destroyed")}
      ${NUM("Sturdy shield multiplier", 2, "sturdyMultiplier")}
    </div>
    <p class="glvr-cfg-note">The broken rung is always kept below the destroyed one.</p>
  </fieldset>

  <fieldset class="glvr-cfg-block">
    <legend>Categories that dent</legend>
    <div class="glvr-cfg-types">
      ${["Weapon", "Armor", "Shield", "Equipment", "Backpack", "Book", "Consumable", "Treasure", "Ammunition"]
        .map(
          (t, i) =>
            `<label class="glvr-cfg-check"><input type="checkbox" ${i < 6 ? "checked" : ""}><span>${t}</span></label>`
        )
        .join("")}
    </div>
    <p class="glvr-cfg-note">PF2e gives almost no item any Hit Points, so this list is what decides where a dent track appears.</p>
  </fieldset>

  <fieldset class="glvr-cfg-block">
    <legend>Extra dents by grade</legend>
    <div class="glvr-cfg-grid">
      ${NUM("Low-grade", 0, "grades.low")}${NUM("Standard-grade", 0, "grades.standard")}${NUM("High-grade", 1, "grades.high")}
    </div>
  </fieldset>

  <fieldset class="glvr-cfg-block">
    <legend>Extra dents by material</legend>
    <div class="glvr-cfg-materials">
      ${MATERIALS.map(([label, v], i) => NUM(label, v, `materials.m${i}`)).join("")}
    </div>
    <p class="glvr-cfg-note">Extra dents are added to the destroyed rung; the broken rung takes half, rounded down.</p>
  </fieldset>

  <footer class="glvr-cfg-foot">
    <button type="button" class="gl-btn glvr-cfg-reset">Reset to the book</button>
    <button type="submit" class="gl-btn gl-btn-accent glvr-cfg-save">Save</button>
  </footer>
</div>`;

const frame = (label, size, body, width = 340) => `
<div class="preview-frame">
  <div class="preview-label">${label}</div>
  <div class="preview-host" style="font-size:${size};width:${width}px">${body}</div>
</div>`;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Variant Rules</title>
<link rel="stylesheet" href="../styles/gl-fonts.css">
<link rel="stylesheet" href="../styles/gl-tokens.css">
<link rel="stylesheet" href="../styles/gl-motion.css">
<link rel="stylesheet" href="../styles/pf2e-variant-rules.css">
<style>
  body { margin:0; padding:24px; background:var(--gl-ink-0); color:var(--gl-text);
         font-family:var(--gl-display); display:flex; flex-wrap:wrap; gap:24px; align-items:flex-start; }
  .preview-frame { display:flex; flex-direction:column; gap:8px; }
  .preview-label { font-family:var(--gl-tech); font-size:9px; letter-spacing:.12em;
                   text-transform:uppercase; color:var(--gl-text-faint); }
  /* The host box is the point: a chat card is 14px and a PF2e sheet is 16px,
     and every control inside inherits that. */
  .preview-host { border:1px dashed rgba(255,255,255,.14); padding:12px; }
  /* Mirrors ApplicationV2's window-content: a fixed box that scrolls, so the
     preview shows exactly what the real window shows and clips what it clips. */
  .preview-config { width:620px; height:700px; overflow-y:auto; border:1px solid var(--gl-edge); font-size:16px; }
</style></head><body>

<div style="display:flex;flex-direction:column;gap:24px">
  ${frame("Item sheet — Details tab (16px host)", "16px", dentPanel("dented", 1, 4, true), 420)}
  ${frame("Item sheet — a sturdy shield, 8 rungs", "16px", dentPanel("broken", 5, 8, true), 420)}
  ${frame("Item sheet — a player's read-only view", "16px", dentPanel("destroyed", 4, 4, false), 420)}
</div>

<div style="display:flex;flex-direction:column;gap:24px">
  ${frame("Chat card (14px host)", "14px", chip)}
  ${frame("Chat card", "14px", repair)}
  ${frame("Chat card", "14px", careful)}
  ${frame("Chat card", "14px", rest)}
</div>

<div class="preview-frame">
  <div class="preview-label">Dent configuration sheet</div>
  <div class="preview-config">${config}</div>
</div>

</body></html>`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT}`);
