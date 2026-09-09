#!/usr/bin/env node
/**
 * Creaturedex consistency check.
 *
 * Everything below fails *silently* in a live session, which is the bar for
 * being in here at all:
 *
 *   • A section key is DATA. It is written into world knowledge the moment a
 *     GM reveals anything, so renaming one does not throw — it forgets every
 *     creature the party has ever learned, on the next load, with no error.
 *
 *   • A field routed to the wrong section reads as the GM revealing the wrong
 *     thing. The book prints an exact field list per section and this is the
 *     only place that list is checked against the code.
 *
 *   • An ability with no `system.category` falls back to its action type. Get
 *     that fallback wrong and a homebrew creature's reaction lands under
 *     Offense, which looks like a perfectly ordinary stat block.
 *
 *   • The reveal socket is the one place in this suite where a *player's* click
 *     writes world state. A raw Foundry socket carries no attested identity, so
 *     the executing GM has to re-derive every claim from shared documents. If
 *     that ever degrades to trusting the payload, a player can hand themselves
 *     a completed creaturedex for anything on the board and no screen looks
 *     wrong.
 *
 *   • Knowledge is keyed by the *base* actor. Key it by `actor.uuid` and every
 *     unlinked token becomes its own creature, so the party re-learns the same
 *     goblin eight times and loses all of it when the scene resets.
 *
 *   • Two whole i18n families (`GLDEX.section.*`, `GLDEX.row.*`) are built at
 *     runtime from data, so nothing else catches a missing one — it renders as
 *     the raw key in the middle of a stat block.
 *
 *   • `.gl-btn` declares no font size and states its padding in `em`, so an
 *     unsized button takes the host's type and its padding inflates with it.
 *
 * Usage: node tools/creaturedex-check.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEATURE = join(ROOT, "scripts/features/pf2e-creaturedex");

const problems = [];
const fail = (msg) => problems.push(msg);
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const rules = await import(join(FEATURE, "rules.mjs"));
const sectionsMod = await import(join(FEATURE, "sections.mjs"));
const constants = await import(join(FEATURE, "constants.mjs"));

const { revealCount, outcomeEffect, isComplete, missingSections, aidBonus, rollSection, canAttempt } = rules;
const { buildSections, abilitySection, subjectKind, availableSections } = sectionsMod;
const { SECTIONS, ALL_SECTION_KEYS, OUTCOME, SETTINGS, PREFIX } = constants;

/* ── 1. The keys are data ────────────────────────────────────────────────── */

const EXPECTED = {
  creature: ["characteristics", "defense", "offense"],
  hazard: ["complexity", "disable", "routine"],
};
for (const [kind, keys] of Object.entries(EXPECTED)) {
  const actual = SECTIONS[kind].map((s) => s.key);
  if (actual.join(",") !== keys.join(",")) {
    fail(
      `sections: the ${kind} keys are [${actual.join(", ")}] but stored knowledge names [${keys.join(", ")}]. ` +
        "Renaming a section key forgets every creature the party has learned, silently."
    );
  }
}
// The book prints the sections in a fixed order and the window renders in it.
if (SECTIONS.creature[0].key !== "characteristics" || SECTIONS.creature[2].key !== "offense") {
  fail("sections: the creature sections are out of the book's printed order");
}

/* ── 2. Pure rule logic ──────────────────────────────────────────────────── */

if (revealCount(OUTCOME.critSuccess) !== 2) fail("rules: a critical success reveals two sections");
if (revealCount(OUTCOME.success) !== 1) fail("rules: a success reveals one section");
if (revealCount(OUTCOME.failure) !== 0) fail("rules: a failure reveals none");
if (revealCount(OUTCOME.critFailure) !== 0) fail("rules: a critical failure reveals no TRUE section");

if (outcomeEffect(OUTCOME.critFailure).kind !== "false") {
  fail("rules: a critical failure must produce a false section, not nothing");
}
// The "It's Not a Secret" sidebar removes the effect *entirely*: a table that
// can see the die cannot be lied to by it, so a quieter lie is not the fix.
if (outcomeEffect(OUTCOME.critFailure, { noSecret: true }).kind !== "none") {
  fail("rules: with secret checks off, a critical failure must teach nothing at all rather than a quieter lie");
}
if (outcomeEffect(OUTCOME.success, { noSecret: true }).count !== 1) {
  fail("rules: 'no secret checks' must not touch any outcome but the critical failure");
}

if (!isComplete(["a", "b"], ["a", "b"])) fail("rules: knowing every available section completes the dex");
if (isComplete(["a"], ["a", "b"])) fail("rules: a missing section is not a complete dex");
// "you need only reveal the number of sections it has available"
if (!isComplete(["a"], ["a"])) fail("rules: a one-section subject completes on one reveal");
// A subject with nothing to learn must not hand out Discerning Aid.
if (isComplete([], [])) fail("rules: a subject with no sections must never read as complete");
if (missingSections(["a"], ["a", "b"]).join() !== "b") fail("rules: missingSections must report what is left");

// Aid's own table, keyed on the rank of the skill the recall was made with.
if (aidBonus(OUTCOME.critSuccess) !== 2) fail("aid: a critical success is +2");
if (aidBonus(OUTCOME.critSuccess, "master") !== 3) fail("aid: a master's critical success is +3");
if (aidBonus(OUTCOME.critSuccess, "legendary") !== 4) fail("aid: a legendary critical success is +4");
if (aidBonus(OUTCOME.success) !== 1) fail("aid: a success is +1");
if (aidBonus(OUTCOME.success, "legendary") !== 1) fail("aid: rank scales the critical success only");
if (aidBonus(OUTCOME.failure) !== 0) fail("aid: a failure grants nothing");
if (aidBonus(OUTCOME.critFailure) !== -1) fail("aid: a critical failure is a -1 PENALTY, not a zero");

const KEYS3 = ["characteristics", "defense", "offense"];
if (rollSection(1, KEYS3) !== "characteristics") fail("rules: 1 on the d4 names the first section");
if (rollSection(3, KEYS3) !== "offense") fail("rules: 3 on the d4 names the third section");
if (rollSection(4, KEYS3) !== null) fail("rules: 4 on the d4 lets the player choose");
// A simple hazard has fewer sections than the die can name; that has to read as
// free choice, or a one-section subject would be harder to learn than a dragon.
if (rollSection(3, ["complexity"]) !== null) fail("rules: a die past the last section must fall back to a free choice");
if (rollSection(null, KEYS3) !== null) fail("rules: no die means a free choice");

if (!canAttempt(0, 0)) fail("rules: the first attempt is always allowed");
if (canAttempt(1, 0)) fail("rules: a second attempt needs an observed turn");
if (!canAttempt(1, 1)) fail("rules: one observed turn pays for one repeat");
if (canAttempt(2, 1)) fail("rules: one observed turn must not pay for two repeats");

/* ── 3. The book's field lists ───────────────────────────────────────────── */

const ability = (name, category, actionType = "action") => ({
  name,
  system: { category, actionType: { value: actionType }, actions: { value: 1 }, traits: { value: [] }, description: { value: "" } },
});

const NPC = {
  type: "npc",
  name: "Fixture",
  system: {
    details: { level: { value: 5 }, languages: { value: ["common"] } },
    traits: { rarity: "uncommon", size: { value: "lg" }, value: ["beast"] },
    perception: { mod: 12, senses: [{ type: "darkvision" }] },
    skills: { athletics: { base: 14 } },
    abilities: { str: { mod: 5 }, dex: { mod: 2 }, con: { mod: 4 }, int: { mod: -2 }, wis: { mod: 1 }, cha: { mod: 0 } },
    saves: { fortitude: { value: 14 }, reflex: { value: 10 }, will: { value: 8 } },
    attributes: {
      ac: { value: 21 },
      hp: { max: 90 },
      speed: { value: 30, otherSpeeds: [{ type: "fly", value: 40 }] },
      immunities: [{ type: "fire" }],
      weaknesses: [{ type: "cold", value: 5 }],
      resistances: [{ type: "piercing", value: 3 }],
    },
  },
  itemTypes: {
    action: [
      ability("Chat", "interaction"),
      ability("Thick Hide", "defensive", "passive"),
      ability("Pounce", "offensive"),
      ability("Uncategorised Reaction", null, "reaction"),
      ability("Uncategorised Action", null, "action"),
    ],
    melee: [
      { name: "jaws", system: { bonus: { value: 15 }, damageRolls: { a: { damage: "2d8+7", damageType: "piercing" } }, traits: { value: ["reach"] } } },
      { name: "spit", system: { range: { increment: 30 }, bonus: { value: 13 }, damageRolls: {}, traits: { value: [] } } },
    ],
    spellcastingEntry: [],
    spell: [],
  },
  items: [],
};

const built = buildSections(NPC);
if (built.kind !== "creature") fail("sections: an npc must use the creature table");

const byKey = Object.fromEntries(built.sections.map((s) => [s.key, s]));
const rowKeys = (key) => (byKey[key]?.rows ?? []).map((r) => r.key);

// pp. 78: the book's own field list, per section.
const BOOK = {
  characteristics: ["level", "rarity", "size", "traits", "perception", "languages", "skills", "attributes"],
  defense: ["ac", "saves", "hp", "immunities", "weaknesses", "resistances"],
  offense: ["speed"],
};
for (const [section, fields] of Object.entries(BOOK)) {
  for (const field of fields) {
    if (!rowKeys(section).includes(field)) {
      fail(`sections: "${field}" is missing from ${section} — the book prints it there`);
    }
  }
}
// A field in two sections is worse than a field in none: the player buys one
// section and silently receives part of another.
for (const [section, fields] of Object.entries(BOOK)) {
  for (const other of Object.keys(BOOK)) {
    if (other === section) continue;
    for (const field of fields) {
      if (rowKeys(other).includes(field)) fail(`sections: "${field}" appears in both ${section} and ${other}`);
    }
  }
}

// PF2e's own category is the book's three headings under other names.
if (abilitySection(ability("x", "interaction")) !== "characteristics") fail("sections: an interaction ability belongs to Characteristics");
if (abilitySection(ability("x", "defensive")) !== "defense") fail("sections: a defensive ability belongs to Defense");
if (abilitySection(ability("x", "offensive")) !== "offense") fail("sections: an offensive ability belongs to Offense");
// The fallback, which is what homebrew and importers actually hit.
if (abilitySection(ability("x", null, "reaction")) !== "defense") fail("sections: an uncategorised reaction falls back to Defense");
if (abilitySection(ability("x", null, "passive")) !== "defense") fail("sections: an uncategorised passive falls back to Defense");
if (abilitySection(ability("x", null, "action")) !== "offense") fail("sections: an uncategorised action falls back to Offense");

if (!byKey.offense?.strikes?.melee?.length) fail("sections: melee strikes are missing from Offense");
if (!byKey.offense?.strikes?.ranged?.length) fail("sections: a `melee` item carrying a range is a RANGED strike");

// An absent row must stay absent: printing "Weaknesses —" tells the player
// there are none, which is knowledge they did not buy.
const BARE = { type: "npc", system: { details: {}, traits: {}, attributes: {}, saves: {}, abilities: {} }, itemTypes: {}, items: [] };
const bare = buildSections(BARE);
for (const section of bare.sections) {
  for (const row of section.rows) {
    if (row.value === "") fail(`sections: ${section.key} prints an empty "${row.key}" row, which reads as "none"`);
  }
}

const HAZARD = {
  type: "hazard",
  system: {
    details: { level: { value: 3 }, isComplex: true, description: "<p>x</p>", disable: "<p>y</p>", routine: "<p>z</p>", reset: "one minute" },
    traits: { rarity: "common", value: ["trap"] },
    attributes: { ac: { value: 18 }, hp: { max: 40 }, hardness: 8, stealth: { value: 12 } },
    saves: { fortitude: { value: 11 }, reflex: { value: 9 }, will: { value: 5 } },
  },
  itemTypes: { action: [] },
  items: [],
};
const haz = buildSections(HAZARD);
if (haz.kind !== "hazard") fail("sections: a hazard must use the hazard table");
const hazKeys = haz.sections.map((s) => s.key);
for (const key of EXPECTED.hazard) {
  if (!hazKeys.includes(key)) fail(`sections: the hazard table is missing "${key}"`);
}
const hazRows = Object.fromEntries(haz.sections.map((s) => [s.key, s.rows.map((r) => r.key)]));
for (const field of ["ac", "saves", "hardness", "hp"]) {
  if (!hazRows.disable?.includes(field)) fail(`sections: "${field}" belongs to a hazard's Disable and Trigger`);
}
if (!hazRows.complexity?.includes("stealth")) fail("sections: Stealth belongs to a hazard's Complexity and Stealth");

if (subjectKind({ type: "character" }) !== null) fail("sections: a PC is not a creaturedex subject");
if (availableSections(NPC).length !== 3) fail("sections: a full creature offers three sections");

/* ── 4. The socket may not trust its payload ─────────────────────────────── */

const revealSrc = read("scripts/features/pf2e-creaturedex/reveal.mjs");
const applyBody = revealSrc.slice(revealSrc.indexOf("export async function applyReveal"));
const applyEnd = applyBody.indexOf("\n}");
const apply = applyEnd < 0 ? applyBody : applyBody.slice(0, applyEnd);

for (const [needle, why] of [
  ["game.user?.isGM", "a non-GM client cannot write world state, so the guard has to be here"],
  ["game.messages", "the offer must be re-read from the message, never taken from the payload"],
  ["testUserPermission", "the asking user must actually own the character the knowledge is filed under"],
  ["offer.remaining", "an offer already spent must not pay out twice"],
  ["available.includes(section)", "a section the subject does not have must be refused"],
  [
    "SUBJECT_FLAG",
    "the card must be one this feature stamped, and the claimed creature and character must be the ones it " +
      "stamped — otherwise any message carrying an outcome, a player's own attack roll included, is a valid ticket",
  ],
  ["stamp.uuid !== subjectUuid", "the claimed subject must match the stamp rather than be taken on trust"],
  ["stamp.owner !== ownerId", "the claimed character must match the stamp rather than be taken on trust"],
]) {
  if (!apply.includes(needle)) {
    fail(`reveal: applyReveal no longer checks \`${needle}\` — ${why}`);
  }
}
if (!/activeGM/.test(revealSrc)) {
  fail("reveal: the socket handler must run on exactly one GM, or two logged-in GMs both apply the same reveal");
}

/* ── 5. Identity ─────────────────────────────────────────────────────────── */

const storeSrc = read("scripts/features/pf2e-creaturedex/store.mjs");
const keyBody = storeSrc.slice(storeSrc.indexOf("export function subjectKey"));
if (!/baseActor/.test(keyBody.slice(0, keyBody.indexOf("\n}")))) {
  fail(
    "store: subjectKey does not resolve an unlinked token to its base actor, so every token becomes its own creature"
  );
}

/* ── 6. Settings, prefixes and i18n ──────────────────────────────────────── */

const indexSrc = read("scripts/features/pf2e-creaturedex/index.mjs");
const lang = JSON.parse(read("lang/pf2e-creaturedex.en.json"));
const has = (key) => Object.prototype.hasOwnProperty.call(lang, key);

// Registration is written as `register(SUITE_ID, SETTINGS.party, …)`, so the
// key string never appears in the adapter. Resolve the constant's *property*
// name back to its value rather than looking for the literal, which would pass
// for any setting whose name happened to be a substring of something else.
const registered = new Set();
for (const m of indexSrc.matchAll(/game\.settings\.register\(\s*SUITE_ID\s*,\s*(?:SETTINGS\.([A-Za-z]+)|"([^"]+)")/g)) {
  registered.add(m[1] ? SETTINGS[m[1]] : m[2]);
}
for (const [name, key] of Object.entries(SETTINGS)) {
  if (!key.startsWith(PREFIX)) {
    fail(`settings: "${key}" does not begin with "${PREFIX}", so the Control Center cannot reach it`);
  }
  if (!registered.has(key)) {
    fail(`settings: SETTINGS.${name} ("${key}") is declared but never registered — reading it throws`);
  }
}
if ("enabled" in SETTINGS) {
  fail("settings: SETTINGS.enabled is back — the registry owns this feature's toggle, so a second store drifts from it");
}
if (!registered.has("dex.knowledge")) {
  fail("settings: the dex store itself is not registered, so every read and write of it throws");
}
// Every setting this feature declares is a configurable one: the toggle itself
// belongs to the registry, not to a key here.
for (const key of Object.values(SETTINGS)) {
  const stem = key.slice(PREFIX.length);
  for (const suffix of ["name", "hint"]) {
    if (!has(`GLDEX.settings.${stem}.${suffix}`)) fail(`i18n: GLDEX.settings.${stem}.${suffix} is missing`);
  }
}

// Built at runtime from data, so nothing else catches a gap.
for (const key of ALL_SECTION_KEYS) {
  if (!has(`GLDEX.section.${key}`)) fail(`i18n: GLDEX.section.${key} is missing — the section renders as a raw key`);
}
const rowKeysUsed = new Set();
for (const s of [...built.sections, ...haz.sections]) for (const r of s.rows) rowKeysUsed.add(r.key);
for (const extra of ["melee", "ranged", "spells", "innate", "focus", "ritual"]) rowKeysUsed.add(extra);
for (const key of rowKeysUsed) {
  if (!has(`GLDEX.row.${key}`)) fail(`i18n: GLDEX.row.${key} is missing — it renders as a raw key mid stat block`);
}
for (const kind of ["creature", "hazard"]) {
  if (!has(`GLDEX.kind.${kind}`)) fail(`i18n: GLDEX.kind.${kind} is missing`);
}
for (const kind of ["reveal", "false", "none"]) {
  if (!has(`GLDEX.offer.${kind}`)) fail(`i18n: GLDEX.offer.${kind} is missing`);
}

// Static keys, swept out of the source so a rename on one side is caught.
const sources = [
  "scripts/features/pf2e-creaturedex/app.mjs",
  "scripts/features/pf2e-creaturedex/chat.mjs",
  "scripts/features/pf2e-creaturedex/reveal.mjs",
  "scripts/features/pf2e-creaturedex/render.mjs",
  "scripts/features/pf2e-creaturedex/aid.mjs",
  "scripts/features/pf2e-creaturedex/index.mjs",
  "templates/pf2e-creaturedex/dex.hbs",
].map(read).join("\n");
for (const match of sources.matchAll(/["'`](GLDEX\.[A-Za-z0-9_.]+)["'`]/g)) {
  if (!has(match[1])) fail(`i18n: ${match[1]} is referenced but not defined`);
}
if (!has("GLS.feature.pf2e-creaturedex.title") || !has("GLS.feature.pf2e-creaturedex.hint")) {
  fail("i18n: the feature has no title/hint, so its Control Center row is blank");
}

/* ── 7. Registration ─────────────────────────────────────────────────────── */

const manifest = JSON.parse(read("module.json"));
if (!manifest.styles.includes("styles/pf2e-creaturedex.css")) fail("module.json: the stylesheet is not listed");
if (!manifest.languages.some((l) => l.path === "lang/pf2e-creaturedex.en.json")) {
  fail("module.json: the language file is not listed");
}
if (!read("scripts/features/index.mjs").includes("pf2e-creaturedex")) {
  fail("roster: the adapter is never imported, so the feature does not exist");
}
if (!existsSync(join(ROOT, "templates/pf2e-creaturedex/dex.hbs"))) fail("templates: dex.hbs is missing");

/* ── 8. Every button is sized ────────────────────────────────────────────── */

const css = read("styles/pf2e-creaturedex.css");
// A selector LIST has to be split before it is read. Matching the whole
// prelude in one go silently credits only its first selector, which is how this
// check first passed a stylesheet that sized both surfaces and reported one.
const sized = [];
for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
  if (!/font-size:/.test(rule[2])) continue;
  for (const selector of rule[1].split(",")) {
    const m = selector.match(/\.(gldex-[a-z-]+)\s+\.gl-btn\s*$/);
    if (m) sized.push(m[1]);
  }
}
for (const surface of ["gldex-root", "gldex-offer"]) {
  if (!sized.includes(surface)) {
    fail(
      `styles: .${surface} .gl-btn declares no font-size, so its buttons take the host's type ` +
        "(14px in a chat card, more in a sheet) beside 9-11px labels, with em padding that inflates to match"
    );
  }
}
// The template uses no subexpression helpers on purpose: `eq` and `concat` are
// not helpers Foundry has always shipped, and a missing one throws inside the
// render and takes the whole window down rather than degrading.
const hbs = read("templates/pf2e-creaturedex/dex.hbs");
for (const helper of ["(eq ", "(concat ", "(ne ", "(and ", "(or "]) {
  if (hbs.includes(helper)) fail(`templates: dex.hbs uses the \`${helper.trim().slice(1)}\` subexpression helper`);
}

/* ── 9. The preview shows the window the module actually builds ──────────── */

// A preview that has drifted is worse than none: it is the surface this feature
// is judged on, and a class it invents renders unstyled there while looking
// deliberate. Every `gldex-` class it uses must be one the template or the
// source actually emits.
const previewPath = "tools/creaturedex-preview.mjs";
if (!existsSync(join(ROOT, previewPath))) {
  fail("preview: tools/creaturedex-preview.mjs is missing — the docs point at it");
} else {
  const emitted = new Set();
  for (const text of [hbs, sources]) {
    for (const m of text.matchAll(/gldex-[a-z-]+/g)) emitted.add(m[0]);
  }
  // Classes the renderer builds by concatenation, which the sweep above cannot
  // see as whole tokens.
  for (const suffix of ["head", "title", "subject", "line", "picks", "pick", "note", "foot"]) {
    emitted.add(`gldex-offer-${suffix}`);
  }
  const preview = read(previewPath);
  for (const m of new Set([...preview.matchAll(/gldex-[a-z-]+/g)].map((x) => x[0]))) {
    if (!emitted.has(m)) fail(`preview: .${m} appears in the preview but nothing in the module emits it`);
  }
}

/* ── 10. Whole-party reveal, the three GM controls, and the roads in ─────── */

const appSrc = read("scripts/features/pf2e-creaturedex/app.mjs");
const bodyOf = (name, src = appSrc) => {
  const at = src.indexOf(name);
  if (at < 0) return "";
  const end = src.indexOf("\n  }", at);
  return end < 0 ? src.slice(at) : src.slice(at, end);
};

// Party Knowledge is a *read* — a union over the owners — so that flipping the
// setting off never invents or destroys a fact. The GM's "Everyone" mode has to
// obey the same rule going the other way: a reveal to the party writes one row
// per character, because a shared `party` bucket would read back only while the
// setting was on and would vanish the moment a table turned it off, taking
// every creature the party learned that way with it.
const writeKeys = bodyOf("get writeKeys()");
if (!/partyCharacters\(\)/.test(writeKeys)) {
  fail("app: writeKeys does not fan out to partyCharacters(), so a whole-party reveal writes somewhere per-character reads cannot see");
}
if (/return\s*\[\s*PARTY_KEY/.test(writeKeys) || /owners?\s*=\s*PARTY_KEY/.test(writeKeys)) {
  fail("app: writeKeys writes to the PARTY_KEY bucket, which only reads back while Party Knowledge is on");
}
// The read side keeps using PARTY_KEY, which is what makes the union happen.
if (!/PARTY_KEY/.test(bodyOf("get readKey()"))) {
  fail("app: readKey no longer resolves the whole-party view, so 'Everyone' shows one character's knowledge");
}

// Three controls, three states, and every one of them has to survive the round
// trip from context flag to template branch to registered action. A flag the
// template never reads is a control that does not exist; an action name the
// application does not register is a button that silently does nothing.
const actionsBlock = appSrc.slice(appSrc.indexOf("actions: {"), appSrc.indexOf("static PARTS"));
for (const [flag, action] of [
  ["canReveal", "revealSection"],
  ["canFalsify", "falsifySection"],
  ["canClear", "clearSection"],
]) {
  if (!new RegExp(`${flag}:`).test(appSrc)) fail(`app: the section context no longer produces \`${flag}\``);
  if (!hbs.includes(`{{#if ${flag}}}`)) fail(`templates: dex.hbs never branches on \`${flag}\`, so that control is unreachable`);
  if (!hbs.includes(`data-action="${action}"`)) fail(`templates: dex.hbs has no button wired to \`${action}\``);
  if (!new RegExp(`${action}:`).test(actionsBlock)) fail(`app: \`${action}\` is not a registered action, so its button does nothing`);
}
// Falsify must refuse a section that is already false. Writing a second lie over
// the first is a click that changes nothing while looking like it worked.
if (!/canFalsify:\s*!isKnown && !lie/.test(appSrc)) {
  fail("app: canFalsify is not gated on both `!isKnown` and `!lie`");
}

// A player may only open a creature the party has learned something about, and
// "something" has to include a *lie*: a player who was told one and nothing else
// cannot see that it is false, so an entry that refuses to open is the module
// losing the one thing they were given.
const mayView = bodyOf("static mayView(actor)");
if (!/game\.user\.isGM/.test(mayView) || !/knownSections/.test(mayView) || !/falseSections/.test(mayView)) {
  fail("app: mayView no longer gates a non-GM on knowledge (both true and false sections), so it identifies unknown creatures");
}
if (!/return\s+known\s*\?\s*uuid\s*:\s*null/.test(mayView)) {
  fail("app: mayView returns a subject for a creature nothing is known about");
}
if (!/mayView\(/.test(bodyOf("static openForActor(actor)"))) {
  fail("app: openForActor bypasses mayView");
}

// The roads onto the canvas. Each of them fails silently when it is dropped: the
// keybinding stops answering, the HUD button stops appearing, and an open window
// stops following the target — none of which errors.
for (const [needle, why] of [
  [/^\s+registerKeybinding\(\);/m, "the open-target keybinding is declared but never called"],
  [/^\s+registerTokenHud\(\);/m, "the token HUD button is declared but never registered"],
  [/Hooks\.on\("targetToken"/, "an open window no longer follows the user's target"],
]) {
  if (!needle.test(indexSrc)) fail(`index: ${why}`);
}
// Both entry points resolve a creature the same way, and all three sources
// matter: a player aiming a spell has a target, a summoner has a controlled
// token, and "point at it" is a hover. Drop one and the key does nothing for
// that gesture while working everywhere else.
const pointed = indexSrc.slice(indexSrc.indexOf("function pointedActor"), indexSrc.indexOf("function registerKeybinding"));
for (const source of ["targets", "controlled", "hover"]) {
  if (!pointed.includes(source)) fail(`index: pointedActor ignores \`${source}\`, so that gesture opens nothing`);
}
// The HUD icon is drawn only where it can lead somewhere. On an unknown creature
// it is a button whose only possible answer is "nothing learned".
if (!/mayView\(/.test(indexSrc.slice(indexSrc.indexOf("function registerTokenHud")))) {
  fail("index: the token HUD button is drawn without asking mayView, so it appears on creatures it cannot open");
}
// Nothing here may run at import time — a disabled feature must stay inert.
if (/^Hooks\.on\(/m.test(indexSrc)) {
  fail("index: a hook is registered at import time, so the feature is live even when disabled");
}

/* ── report ──────────────────────────────────────────────────────────────── */

if (problems.length) {
  console.log(`creaturedex: ${problems.length} problem(s)\n`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exitCode = 1;
} else {
  console.log("creaturedex: no problems found");
}
