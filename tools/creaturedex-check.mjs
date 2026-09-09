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
 *   • An ability with no `system.category` must be DEFERRED, not guessed at.
 *     PF2e's schema defaults that field to null and its own NPC sheet never
 *     reads it, so most bestiary abilities arrive untagged; a guess from the
 *     action cost gets a majority right and the rest *leak* — an offensive
 *     ability filed under Defense hands a player exactly what they did not buy,
 *     and the stat block still looks ordinary.
 *
 *   • The store holds RENDERED SNAPSHOTS, not pointers. Foundry hands every
 *     client the full Actor document, so a window that redacted a live actor
 *     would be drawing a lock on the player's own screen over data one console
 *     call away. Degrade the store back into "which sections were bought" and
 *     the feature becomes theatre while every screen still looks right.
 *
 *   • Knowledge is keyed by the creature's *kind*, not its document. Key it by
 *     `actor.uuid` and every duplicate and unlinked token becomes its own
 *     creature, so the party re-learns the same goblin in every dungeon and
 *     completes none of them.
 *
 *   • A lie is authored, and the pass that generates one must never touch an
 *     immunity. Removing one empties a character's whole kit into something
 *     that was never going to care; inventing one stops them trying at all.
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

const { isComplete, missingSections, aidBonus } = rules;
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

/* The doctoring pass, which is the only place this feature invents a number.

   Two properties matter and neither is visible in a diff. A drift of zero is a
   "lie" that is the truth, on the one row the player happens to check, with the
   GM unable to see it from the dialog. And an immunity must survive in BOTH
   directions: removing one is the case the design brief named, and adding one
   costs the same character the same kit from the other side. */
const TRUTH = {
  key: "defense",
  rows: [
    { key: "ac", value: "21" },
    { key: "saves", value: "Fort +14, Ref +10, Will +8" },
    { key: "hp", value: "90" },
    { key: "immunities", value: "poison, precision" },
    { key: "resistances", value: "fire 10" },
  ],
  strikes: { melee: [{ name: "jaws", bonus: "+14", damage: "2d8+7 piercing" }], ranged: [] },
};

// A deterministic stream, so a miss here is reproducible rather than flaky.
const stream = (seed) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

for (const seed of [1, 7, 99, 12345, 777777]) {
  const lie = rules.doctorSection(TRUTH, { rng: stream(seed) });
  const val = (k) => lie.rows.find((r) => r.key === k)?.value;
  const truth = (k) => TRUTH.rows.find((r) => r.key === k)?.value;

  if (val("immunities") !== truth("immunities")) {
    fail(`doctor(seed ${seed}): immunities were altered — never, in either direction`);
  }
  // Off by default, so a resistance must be left alone unless asked for.
  if (val("resistances") !== truth("resistances")) {
    fail(`doctor(seed ${seed}): resistances shifted with the IWR option off`);
  }
  for (const key of ["ac", "saves", "hp"]) {
    if (val(key) === truth(key)) {
      fail(`doctor(seed ${seed}): ${key} came back unchanged, so the "lie" is the truth on that row`);
    }
  }
  const ac = Number(val("ac"));
  if (!Number.isFinite(ac) || Math.abs(ac - 21) > 2) fail(`doctor(seed ${seed}): AC drifted ${ac - 21}, outside ±2`);
  const hp = Number(val("hp"));
  if (!Number.isFinite(hp) || Math.abs(hp - 90) > 90 * 0.25) fail(`doctor(seed ${seed}): HP drifted outside ±20%`);
  const dmg = lie.strikes.melee[0].damage;
  if (!/^2d(6|10) \+?7 piercing$|^2d(6|10)\+7 piercing$/.test(dmg)) {
    fail(`doctor(seed ${seed}): damage die moved more than one step (${dmg})`);
  }
}

// With the option on, an IWR row may move — but the immunity still may not.
{
  const lie = rules.doctorSection(TRUTH, { rng: stream(3), iwr: true });
  const val = (k) => lie.rows.find((r) => r.key === k)?.value;
  if (val("immunities") !== "poison, precision") fail("doctor: the IWR option must not unlock immunities");
  if (val("resistances") === "fire 10") fail("doctor: with the IWR option on, a resistance must actually move");
}

/* And the same rule, structurally.

   The behavioural test above cannot bite on its own: a PF2e immunity list is
   words (`poison, precision`) with no digits in it, so routing `immunities`
   into the numeric-drift branch changes nothing and passes every value check
   while stating in the source that immunities are fair game. The next row
   shape that carries a number would then start drifting. So the switch itself
   is pinned: `immunities` must never appear as a case it mutates. */
{
  const doctorSrc = read("scripts/features/pf2e-creaturedex/rules.mjs");
  const body = doctorSrc.slice(doctorSrc.indexOf("export function doctorSection"));
  const sw = body.slice(body.indexOf("switch (row.key)"), body.indexOf("return row;"));
  if (/case "immunities"/.test(sw)) {
    fail("doctor: `immunities` is a case the doctoring switch mutates — it must never be, in either direction");
  }
}

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
/* An untagged ability must route NOWHERE. PF2e's schema defaults `category` to
   null and its own NPC sheet never reads the field, so most bestiary abilities
   arrive untagged — a guess from the action cost gets a majority right and the
   rest LEAK, handing a player who bought Defense an offensive ability while the
   stat block still looks entirely ordinary. Null is what lets buildSections
   hold them back until the entry is complete, at which point there is nothing
   left to leak. */
for (const type of ["reaction", "passive", "action", "free"]) {
  if (abilitySection(ability("x", null, type)) !== null) {
    fail(`sections: an uncategorised ${type} is being guessed at rather than deferred, which leaks it into a section nobody bought`);
  }
}
// A GM's own override still wins outright — that is what an override is for.
const OVERRIDDEN = { ...ability("x", null, "action"), flags: { "gluniverse-foundry-modules": { "dex.section": "defense" } } };
if (abilitySection(OVERRIDDEN) !== "defense") fail("sections: a per-item GM override must beat everything");
// And a deferred ability has to actually come out somewhere, or it is deleted
// rather than held back.
if (!buildSections(NPC).deferred) fail("sections: buildSections drops uncategorised abilities instead of deferring them");

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

/* ── 4. Nothing watches a roll ───────────────────────────────────────────── */

/* The reveal is the GM's click. That was a deliberate scope decision and it is
   one a later change could quietly undo by "helpfully" wiring the chat card
   back up — which would put a player's click on the write path of a world
   setting and re-introduce a socket that has to re-derive every claim it is
   handed. The absence is the invariant, so the absence is what is pinned. */
for (const gone of ["chat.mjs", "reveal.mjs"]) {
  if (existsSync(join(FEATURE, gone))) {
    fail(`${gone} is back: reveals are the GM's click, not a Recall Knowledge hook`);
  }
}
const appSrcEarly = read("scripts/features/pf2e-creaturedex/app.mjs");
const idxEarly = read("scripts/features/pf2e-creaturedex/index.mjs");
for (const [needle, why] of [
  [/renderChatMessageHTML/, "a chat-card hook is back"],
  [/emitSocket|onSocket/, "a socket is back, and this feature has no payload it could safely trust"],
  [/flags\.pf2e\.context\.outcome|context\?\.outcome/, "a roll outcome is being read"],
]) {
  for (const [where, src] of [["app.mjs", appSrcEarly], ["index.mjs", idxEarly]]) {
    if (needle.test(src)) fail(`${where}: ${why} — the reveal is the GM's click`);
  }
}

/* ── 5. Identity, and the snapshot store ─────────────────────────────────── */

/* A dex entry is a creature KIND. The compendium source is that identity where
   it exists, because it is what survives every copy made from the entry; the
   name-and-level slug is the fallback for a world actor or an imported one.
   Keying on `actor.uuid` would file the compendium goblin, the world duplicate
   and the imported one separately — three monsters to Foundry, one to the
   fiction, and a dex that is never completed. */
const identity = await import(join(FEATURE, "identity.mjs"));
const { dexKey, slugify } = identity;

const COMPENDIUM = { name: "Goblin Warrior", _stats: { compendiumSource: "Compendium.pf2e.pathfinder-bestiary.Actor.abc" }, system: { details: { level: { value: 1 } } } };
const WORLD_COPY = { name: "Goblin Warrior", _stats: {}, system: { details: { level: { value: 1 } } } };
const IMPORTED = { name: "goblin  warrior", _stats: {}, system: { details: { level: { value: 1 } } } };
const ELITE = { name: "Goblin Warrior", _stats: {}, system: { details: { level: { value: 3 } } } };

if (dexKey(COMPENDIUM) !== "Compendium.pf2e.pathfinder-bestiary.Actor.abc") {
  fail("identity: the compendium source must win, or every copy of a bestiary entry is its own creature");
}
if (dexKey(WORLD_COPY) !== dexKey(IMPORTED)) {
  fail("identity: two spellings of the same world creature must land on one key");
}
if (dexKey(WORLD_COPY) === dexKey(ELITE)) {
  fail("identity: a level-shifted variant must key separately — the ordinary goblin's AC must not answer for the elite");
}
if (slugify("Sløugh's  Wärden!") !== "sloughs-warden") {
  fail(`identity: slugify does not normalise (got ${slugify("Sløugh's  Wärden!")})`);
}
// An unlinked token carries a synthetic actor naming the TOKEN.
const TOKEN_ACTOR = { isToken: true, token: { baseActor: WORLD_COPY }, name: "Goblin Warrior (2)", _stats: {}, system: {} };
if (dexKey(TOKEN_ACTOR) !== dexKey(WORLD_COPY)) {
  fail("identity: an unlinked token must resolve to its base actor, or every copy on the map is its own creature");
}

/* The store keeps what was handed over, not a pointer to read it back from. */
const storeSrc = read("scripts/features/pf2e-creaturedex/store.mjs");
for (const [needle, why] of [
  [/export async function reveal\(subject, owner, keys, snapshots/, "reveal must take the rendered snapshots it is storing"],
  [/export function trueSnapshot|export const trueSnapshot/, "the truth snapshot must be readable back out"],
  [/export async function refresh\(/, "the GM needs a way to re-take a stale snapshot"],
]) {
  if (!needle.test(storeSrc)) fail(`store: ${why}`);
}
/* Redacting the last holder of a section must drop the stored truth with it, or
   the store keeps content nobody was told — which is the one guarantee it has. */
if (!/delete\s+data\[subject\]\?\.sections\?\.\[section\]/.test(storeSrc)) {
  fail("store: redact leaves the truth snapshot behind after the last holder loses the section");
}
/* And the window must not read the creature to draw a section. */
const appSrcSnap = read("scripts/features/pf2e-creaturedex/app.mjs");
if (/renderSection\(\s*section\s*\)/.test(appSrcSnap)) {
  fail("app: a section is being rendered from the live actor rather than from its stored snapshot");
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
for (const key of ["both", "prose", "sections"]) {
  if (!has(`GLDEX.delivery.${key}`)) fail(`i18n: GLDEX.delivery.${key} is missing — it is a settings choice label`);
}

// Static keys, swept out of the source so a rename on one side is caught.
const sources = [
  "scripts/features/pf2e-creaturedex/app.mjs",
  "scripts/features/pf2e-creaturedex/falsify.mjs",
  "scripts/features/pf2e-creaturedex/render.mjs",
  "scripts/features/pf2e-creaturedex/aid.mjs",
  "scripts/features/pf2e-creaturedex/index.mjs",
  "templates/pf2e-creaturedex/dex.hbs",
  "templates/pf2e-creaturedex/falsify.hbs",
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
for (const surface of ["gldex-root", "gldex-lie-root"]) {
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
  for (const suffix of ["line", "done"]) emitted.add(`gldex-card-${suffix}`);
  const preview = read(previewPath);
  /* Every class the preview draws must have a rule behind it.

     This is the third direction and it is the one that bit: deleting a block of
     CSS around a class that is still emitted leaves the element rendering as
     bare text on the page, which no "is this class invented?" sweep can see and
     which reads in a diff as removing something unused. */
  /* Classes that deliberately carry no rule of their own: the three buttons take
     everything from `.gl-btn` plus the surface sizing rule above, and the section
     body is a bare container its parent lays out. Anything NOT listed here that
     has lost its rule has lost a surface. */
  const UNSTYLED_BY_DESIGN = new Set(["gldex-toggle", "gldex-refresh", "gldex-lie-gen", "gldex-section-body"]);
  for (const cls of new Set([...preview.matchAll(/gldex-[a-z-]+/g)].map((x) => x[0]))) {
    if (UNSTYLED_BY_DESIGN.has(cls)) continue;
    // The class has to appear as a selector token of its own, not only as a
    // longer name or an attribute-qualified variant: `.gldex-card[data-section]`
    // rules survived the block that gave `.gldex-card` its box being deleted,
    // and a \b test called that styled.
    if (!new RegExp("\\." + cls + "(?![a-z0-9-\\[])").test(css)) {
      fail(`styles: .${cls} is drawn by the preview and has no rule anywhere, so it renders unstyled`);
    }
  }
  /* The sweep below only refuses classes the preview INVENTS. A control the
     module ships and the preview never draws is the opposite drift and is
     invisible to it, so the surfaces that get judged here are named. */
  for (const shown of ["gldex-refresh", "gldex-forget", "gldex-lie-root", "gldex-lie-send", "gldex-card"]) {
    if (!preview.includes(shown)) {
      fail(`preview: .${shown} is shipped but the preview never draws it, so nobody ever looks at it`);
    }
  }
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
if (!/return\s+known\s*\?\s*key\s*:\s*null/.test(mayView)) {
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
