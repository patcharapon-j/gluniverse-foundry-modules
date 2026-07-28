#!/usr/bin/env node
/**
 * Headless check for PF2e stat blocks written in the Statsblock Import grammar.
 *
 *   node tools/parse-check.mjs <file.md> [more.md ...]
 *   node tools/parse-check.mjs --samples
 *
 * The importer normally runs inside Foundry, so this stubs the handful of
 * globals its parser touches (`game.i18n`, `foundry.utils`, `CONFIG.PF2E`) and
 * calls the exported `api.parse`. With no live PF2E config the parser falls
 * back to its own bundled enumerations, which is exactly what we want here:
 * the check stays honest about the grammar without depending on an install.
 *
 * This is a validation aid in the spirit of the `node --check` one-liners in
 * CLAUDE.md — no package.json, no dependencies, no build step.
 *
 * Exit code 0 when every input parses without errors, 1 otherwise.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// --- Foundry / PF2e stubs ---------------------------------------------------
// Minimal, and deliberately not clever: if the parser starts needing more than
// this, that is a signal it has grown a dependency on the live environment.

const LANG = loadLang();

function loadLang() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.join(here, "..", "lang", "statsblock-import.en.json");
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function format(key, data = {}) {
  const template = LANG[key];
  if (!template) return `[${key}] ${JSON.stringify(data)}`;
  return template.replace(/\{(\w+)\}/g, (_match, name) => (name in data ? String(data[name]) : `{${name}}`));
}

globalThis.game = {
  i18n: { localize: (key) => LANG[key] ?? key, format },
  settings: { get: () => "default" },
  actors: [],
  system: { id: "pf2e" }
};

globalThis.CONFIG = { PF2E: {} };
globalThis.CONST = { TOKEN_DISPOSITIONS: { NEUTRAL: 0, HOSTILE: -1 }, TOKEN_DISPLAY_MODES: { OWNER_HOVER: 2, OWNER: 3 } };

globalThis.foundry = {
  utils: {
    expandObject(source) {
      const out = {};
      for (const [key, value] of Object.entries(source ?? {})) {
        const parts = key.split(".");
        let node = out;
        while (parts.length > 1) {
          const part = parts.shift();
          node[part] ??= {};
          node = node[part];
        }
        node[parts[0]] = value;
      }
      return out;
    },
    mergeObject(original, other, { inplace = true } = {}) {
      const target = inplace ? original : structuredClone(original);
      for (const [key, value] of Object.entries(other ?? {})) {
        if (value && typeof value === "object" && !Array.isArray(value) && target[key] && typeof target[key] === "object") {
          target[key] = foundry.utils.mergeObject(target[key], value, { inplace: false });
        } else {
          target[key] = value;
        }
      }
      return target;
    }
  },
  applications: { api: { ApplicationV2: class {} } }
};

// --- Reporting --------------------------------------------------------------

const RESET = "[0m";
const paint = (code, text) => (process.stdout.isTTY ? `[${code}m${text}${RESET}` : text);
const red = (text) => paint(31, text);
const yellow = (text) => paint(33, text);
const green = (text) => paint(32, text);
const dim = (text) => paint(90, text);

function describe(npc) {
  const bits = [npc.kind, `level ${npc.level}`];
  const counts = [
    npc.attacks.length ? `${npc.attacks.length} attack(s)` : "",
    npc.actions.length ? `${npc.actions.length} action(s)` : "",
    npc.phases?.length ? `${npc.phases.length} phase(s)` : "",
    npc.spellcasting.length ? `${npc.spellcasting.length} spell entry(s)` : "",
    npc.effects.length ? `${npc.effects.length} effect(s)` : "",
    npc.inventory.length ? `${npc.inventory.length} item(s)` : ""
  ].filter(Boolean);
  if (npc.engine) bits.push(`engine: ${npc.engine.tier}/${npc.engine.allegiance}`);
  if (npc.recallKnowledge?.length) bits.push(`${npc.recallKnowledge.length} RK rung(s)`);
  return `${bits.join(", ")}${counts.length ? ` — ${counts.join(", ")}` : ""}`;
}

function report(label, parsed) {
  const { npc, errors, warnings } = parsed;
  const ok = errors.length === 0;
  const tag = ok ? green("OK  ") : red("ERR ");
  console.log(`${tag} ${label} ${dim("·")} ${npc.name || "(unnamed)"} ${dim(`(${describe(npc)})`)}`);
  for (const error of errors) console.log(`     ${red("error")}   ${error}`);
  for (const warning of warnings) console.log(`     ${yellow("warning")} ${warning}`);
  return ok;
}

// --- Description rendering --------------------------------------------------
//
// Descriptions carry a little Markdown (paragraphs, `- ` lists, `---`, `**bold**`)
// and may embed PF2e inline enrichers verbatim. Two things have to hold: the
// enrichers must survive untouched, and the render → export → render cycle must
// not drift, or every round trip through the exporter degrades the formatting.

function renderSelfTest() {
  const { toHtml, toSource } = api.render;
  const failures = [];
  const expect = (label, actual, expected) => {
    if (actual !== expected) failures.push(`${label}\n       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`);
  };
  const contains = (label, haystack, needle) => {
    if (!haystack.includes(needle)) failures.push(`${label}\n       missing ${JSON.stringify(needle)} in ${JSON.stringify(haystack)}`);
  };

  expect("blank line splits paragraphs", toHtml("One.\n\nTwo."), "<p>One.</p>\n<p>Two.</p>");
  expect("single newline is a line break", toHtml("a\nb"), "<p>a<br>b</p>");
  expect("bullet list", toHtml("- one\n- two"), "<ul><li>one</li><li>two</li></ul>");
  expect("lead-in plus bullets", toHtml("Choose one:\n- pull\n- step"), "<p>Choose one:</p><ul><li>pull</li><li>step</li></ul>");
  expect("horizontal rule", toHtml("A.\n\n---\n\nB."), "<p>A.</p>\n<hr />\n<p>B.</p>");
  expect("hand-written bold", toHtml("**Requirements** Two Routes."), "<p><strong>Requirements</strong> Two Routes.</p>");
  contains("auto-bolds a leading keyword", toHtml("Trigger An ally is hit."), "<strong>Trigger</strong> ");
  contains("auto-bolds a degree of success", toHtml("Critical Success Unaffected."), "<strong>Critical Success</strong> ");

  const uuid = "@UUID[Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg]{Off-Guard}";
  const damage = "@Damage[(2d6+7)[slashing]]{2d6+7 slashing}";
  contains("hand-written @Damage survives", toHtml(damage), damage);
  contains("hand-written @UUID survives", toHtml(uuid), uuid);
  expect("@UUID is not wrapped twice", (toHtml(uuid).match(/@UUID\[/g) ?? []).length, 1);
  contains("@Template survives", toHtml("@Template[burst|distance:15]"), "@Template[burst|distance:15]");
  contains("plain prose DC still auto-links", toHtml("a DC 21 Reflex save"), "@Check[type:reflex|dc:21");

  const normalize = (html) => html.replace(/>\s+</g, "><").trim();
  const cases = [
    "**Trigger** An ally within 30 feet is hit.\n\n**Effect** The ally Steps.",
    "Choose one:\n- pull the target 5 feet\n- Razor Steps",
    "First.\n\n---\n\nSecond.",
    `He deals ${damage} and the target is ${uuid}.`
  ];
  for (const [index, source] of cases.entries()) {
    const first = toHtml(source);
    const roundTripped = toSource(first);
    const second = toHtml(roundTripped);
    expect(`round trip #${index + 1} renders the same HTML`, normalize(second), normalize(first));
    expect(`round trip #${index + 1} reaches a fixed point`, toSource(second), roundTripped);
  }

  const ok = failures.length === 0;
  console.log(`${ok ? green("OK  ") : red("ERR ")} render ${dim("·")} description formatting ${dim("(paragraphs, lists, emphasis, inline enrichers, round trip)")}`);
  for (const failure of failures) console.log(`     ${red("error")}   ${failure}`);
  return ok;
}

// --- Entry ------------------------------------------------------------------

const importerUrl = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "features", "statsblock-import", "importer.js"));
const { api } = await import(importerUrl.href);

const args = process.argv.slice(2);
if (!args.length) {
  console.error("usage: node tools/parse-check.mjs <file.md> [...]   |   --samples");
  process.exit(2);
}

let failed = 0;
let checked = 0;

if (args.includes("--samples")) {
  // The two Load Sample buttons are the format's in-app documentation; checking
  // them here is what stops the docs drifting away from the parser.
  for (const [name, build] of Object.entries(api.samples)) {
    checked += 1;
    if (!report(`sample:${name}`, api.parse(build()))) failed += 1;
  }
  checked += 1;
  if (!renderSelfTest()) failed += 1;
} else {
  for (const file of args) {
    checked += 1;
    if (!report(path.basename(file), api.parse(readFileSync(file, "utf8")))) failed += 1;
  }
}

console.log(dim(`\n${checked} checked, ${failed} with errors`));
process.exit(failed ? 1 : 0);
