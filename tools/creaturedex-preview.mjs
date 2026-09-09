#!/usr/bin/env node
/**
 * Creaturedex — a browser-backed look at the two surfaces.
 *
 * The dex window and the offer card are both built from the suite's own tokens
 * against a host that supplies their type size, and neither can be judged from
 * a diff: the thing you are checking is whether a sealed section reads as
 * *sealed* beside a revealed one, and whether the three section colours carry
 * meaning at a glance. That is a look, not an assertion.
 *
 * The markup here mirrors `templates/pf2e-creaturedex/dex.hbs` and the offer
 * dialog built in `falsify.mjs`. `tools/creaturedex-check.mjs` refuses any
 * `gldex-` class in this file that neither of those actually emits, so a
 * preview cannot drift into showing a window the module does not build.
 *
 * Usage: node tools/creaturedex-preview.mjs [--out=.preview/dex.html]
 *        node tools/preview-server.mjs 8953
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice("--out=".length) : ".preview/dex.html");

const row = (key, value) =>
  `<div class="gldex-row"><span class="gldex-row-key">${key}</span><span class="gldex-row-val">${value}</span></div>`;

const ability = (name, cost, traits, body) => `
  <div class="gldex-ability">
    <div class="gldex-ability-head">
      <span class="gldex-ability-name">${name}</span>
      <span class="gldex-cost">${cost}</span>
      <span class="gldex-traits">${traits.map((t) => `<span class="gldex-trait">${t}</span>`).join("")}</span>
    </div>
    <div class="gldex-ability-body">${body}</div>
  </div>`;

const controls = (known, lie) => {
  const parts = [];
  if (!known) parts.push(`<button type="button" class="gl-btn gldex-toggle">Reveal</button>`);
  if (!known && !lie) parts.push(`<button type="button" class="gl-btn gldex-falsify">Falsify</button>`);
  if (known || lie) parts.push(`<button type="button" class="gl-btn gldex-toggle">Redact</button>`);
  return `<span class="gldex-controls">${parts.join("")}</span>`;
};

const section = (key, label, state, body, { gm = false, known = false, lie = false } = {}) => `
  <article class="gldex-section" data-section="${key}" data-state="${state}">
    <header class="gldex-section-head">
      <span class="gldex-section-label">${label}</span>
      ${lie ? `<span class="gldex-section-lie">False</span>` : ""}
      ${gm ? controls(known, lie) : ""}
    </header>
    <div class="gldex-section-body">${body}</div>
  </article>`;

const sealed = (label) =>
  `<div class="gldex-sealed"><i class="fa-solid fa-lock"></i><span>${label} not yet learned.</span></div>`;

const CHARACTERISTICS =
  row("Level", "5") +
  row("Rarity", "uncommon") +
  row("Size", "Large") +
  row("Traits", "beast, amphibious") +
  row("Perception", "+12; darkvision") +
  row("Languages", "Aklo") +
  row("Skills", "athletics +14, stealth +11") +
  row("Attribute Modifiers", "Str +5, Dex +2, Con +4, Int −2, Wis +1, Cha +0") +
  ability("Wary", "", ["emotion"], "<p>It watches the water line and will not be drawn far from it.</p>");

const DEFENSE =
  row("AC", "21") +
  row("Saving Throws", "Fortitude +14, Reflex +10, Will +8") +
  row("HP", "90") +
  row("Immunities", "fire") +
  row("Weaknesses", "cold 5") +
  row("Resistances", "piercing 3") +
  ability("Thick Hide", "", ["passive"], "<p>Reduce the first instance of slashing damage each round by 3.</p>");

const OFFENSE =
  row("Speed", "30 feet, swim 40 feet") +
  row("Melee", '<strong>jaws</strong> <span class="gldex-num">+15</span> (reach) <span class="gldex-dmg">2d8+7 piercing</span>') +
  row("Ranged", '<strong>spit</strong> <span class="gldex-num">+13</span> 30 ft. <span class="gldex-dmg">2d6 acid</span>') +
  `<div class="gldex-row"><span class="gldex-row-key">Innate Spells</span><span class="gldex-row-val"><em>primal, DC 22</em>
     <div class="gldex-spell-rank"><span>Rank 3</span> hydraulic push</div>
     <div class="gldex-spell-rank"><span>Cantrips</span> gouging claw</div></span></div>` +
  ability("Pounce", "◆", ["move"], "<p>Stride, then Strike. If it began hidden the target is off-guard.</p>");

const entry = (name, count, total, on, complete) => `
  <button type="button" class="gldex-entry${on ? " is-on" : ""}${complete ? " is-complete" : ""}">
    <img class="gldex-entry-img" src="data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" fill="#243044"/></svg>`
    )}" alt="">
    <span class="gldex-entry-meta">
      <span class="gldex-entry-name">${name}</span>
      <span class="gldex-entry-count">${count} / ${total}</span>
    </span>
    ${complete ? `<i class="fa-solid fa-certificate gldex-entry-seal"></i>` : ""}
  </button>`;

const window_ = (title, { gm }) => `
<div class="preview-frame">
  <div class="preview-label">${title}</div>
  <div class="gldex-root gl-glass gl-type">
    <header class="gldex-bar">
      <span class="gldex-bar-title">Creaturedex</span>
      ${
        gm
          ? `<span class="gldex-owners">
               <button type="button" class="gl-btn gldex-owner is-on">Everyone</button>
               <button type="button" class="gl-btn gldex-owner">Seri Voss</button>
               <button type="button" class="gl-btn gldex-owner">Brack</button>
               <button type="button" class="gl-btn gldex-owner">Ondine</button>
             </span>`
          : `<span class="gldex-bar-owner">Seri Voss</span>`
      }
      <span class="gldex-bar-tag">Party knowledge</span>
    </header>
    <div class="gldex-body">
      <nav class="gldex-shelf">
        ${entry("Mire Drake", gm ? 3 : 2, 3, true, gm)}
        ${entry("Toll-Keeper", 1, 3, false, false)}
        ${entry("Collapsing Bridge", 2, 3, false, false)}
      </nav>
      <section class="gldex-detail">
        <header class="gldex-detail-head">
          <img class="gldex-detail-img" src="data:image/svg+xml;utf8,${encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52"><rect width="52" height="52" fill="#243044"/></svg>`
          )}" alt="">
          <div class="gldex-detail-meta">
            <h2 class="gldex-detail-name">Mire Drake</h2>
            <span class="gldex-detail-kind">Creature</span>
          </div>
          ${gm ? `<div class="gldex-detail-tools"><button type="button" class="gl-btn gldex-refresh">Refresh</button><button type="button" class="gl-btn gldex-forget">Forget</button></div>` : ""}
        </header>
        ${gm ? `<p class="gldex-scope">Revealing here writes to every member of the party at once. What is shown is everything anyone knows.</p>` : ""}
        ${gm ? `<p class="gldex-complete">Creaturedex complete. Discerning Aid may be used against this creature.</p>` : ""}
        ${section("characteristics", "Characteristics", "known", CHARACTERISTICS, { gm, known: true })}
        ${section("defense", "Defense", gm ? "false" : "known", DEFENSE, { gm, known: false, lie: gm })}
        ${section("offense", "Offense", gm ? "known" : "sealed", gm ? OFFENSE : sealed("Offense"), { gm, known: gm })}
      </section>
    </div>
  </div>
</div>`;

const lie = `
<div class="preview-frame">
  <div class="preview-label">Falsify — authoring a lie, before it lands</div>
  <div class="gl-glass gldex-lie-root">
    <p class="gldex-lie-lead">Author an incorrect stat block for <strong>Defense</strong> &middot; <strong>Mire Drake</strong></p>
    <div class="gldex-lie-modes">
      <button type="button" class="gl-btn gldex-lie-mode">Borrow a creature</button>
      <button type="button" class="gl-btn gldex-lie-mode is-on">Doctor the truth</button>
    </div>
    <p class="gldex-lie-note">Numbers drift within bounds. Immunities are never touched in either direction: hiding one costs a character their whole kit, and inventing one stops them trying at all.</p>
    <div class="gldex-lie-actions">
      <button type="button" class="gl-btn gldex-lie-gen">Generate</button>
    </div>
    <div class="gldex-lie-draft">
      <p class="gldex-lie-note">Edit anything before it lands. This is the last screen that shows the lie before a player does.</p>
      <label class="gldex-lie-row"><span class="gldex-lie-key">AC</span><input type="text" value="19"></label>
      <label class="gldex-lie-row"><span class="gldex-lie-key">Saving Throws</span><input type="text" value="Fortitude +12, Reflex +11, Will +7"></label>
      <label class="gldex-lie-row"><span class="gldex-lie-key">HP</span><input type="text" value="72"></label>
      <label class="gldex-lie-row"><span class="gldex-lie-key">Immunities</span><input type="text" value="poison"></label>
      <ul class="gldex-lie-extras"><li>2 abilit(y/ies) carried through as generated</li></ul>
    </div>
    <footer class="gldex-lie-foot">
      <button type="button" class="gl-btn gldex-lie-send">Send the lie</button>
    </footer>
  </div>
</div>`;

const card = `
<div class="preview-frame preview-chat">
  <div class="preview-label">Chat card — announcement</div>
  <section class="gldex-card" data-section="offense">
    <p class="gldex-card-line">Seri Voss learns the Offense of Mire Drake.</p>
  </section>
  <section class="gldex-card" data-section="defense" data-complete="true">
    <p class="gldex-card-line">Brack learns the Defense of Toll-Keeper.</p>
    <p class="gldex-card-done">Toll-Keeper: creaturedex complete.</p>
  </section>
</div>`;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Creaturedex</title>
<link rel="stylesheet" href="../styles/gl-fonts.css">
<link rel="stylesheet" href="../styles/gl-tokens.css">
<link rel="stylesheet" href="../styles/gl-motion.css">
<link rel="stylesheet" href="../styles/pf2e-creaturedex.css">
<style>
  body { margin:0; padding:24px; background:var(--gl-ink-0); color:var(--gl-text);
         font-family:var(--gl-display); display:flex; flex-wrap:wrap; gap:24px; align-items:flex-start; }
  .preview-frame { display:flex; flex-direction:column; gap:8px; }
  .preview-label { font-family:var(--gl-tech); font-size:9px; letter-spacing:.12em;
                   text-transform:uppercase; color:var(--gl-text-faint); }
  /* The dex is an ApplicationV2 window; the preview supplies the frame's box. */
  .preview-frame > .gldex-root { width:720px; height:660px; border:1px solid var(--gl-edge); }
  /* A chat card inherits the log's type size, which is what makes an unsized
     button in one look wrong. Reproduce it rather than guessing. */
  .preview-chat { width:340px; font-size:14px; }
  /* The Falsify dialog is an ApplicationV2 window; supply its box the same way. */
  .preview-frame > .gldex-lie-root { width:560px; border:1px solid var(--gl-edge); }
</style></head><body>
${window_("Player view — one section sealed", { gm: false })}
${window_("GM view — everyone selected, three controls, the lie labelled", { gm: true })}
<div style="display:flex;flex-direction:column;gap:24px">
  ${card}
  ${lie}
</div>
</body></html>`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT}`);
