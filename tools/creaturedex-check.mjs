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
 *   • An ability with no `system.category` must be DEFERRED, not guessed at,
 *     and the store must not keep it until somebody's entry is truly complete:
 *     the store is a world setting every client reads.
 *
 *   • The store holds RENDERED SNAPSHOTS, not pointers, and redacting the last
 *     holder of a section drops its snapshot. The ledger is pure, so this
 *     drives the real writes instead of reading the source for them.
 *
 *   • A lie is invisible to its holder. The player's model carries no `false`
 *     state, the markup a lie draws is byte-identical to the truth's, and the
 *     reveal notice a lie posts is the one a truth posts.
 *
 *   • A sealed section is a name and nothing else. Rows, a count or a snapshot
 *     on a sealed plate is knowledge the player did not buy.
 *
 *   • The doctoring pass never drifts by zero and never touches an immunity.
 *
 *   • Dynamic i18n families (`GLDEX.section.*`, `GLDEX.row.*`, `GLDEX.kind.*`,
 *     the notes the model names) render as raw keys when one is missing.
 *
 *   • The scoped skin (docs/adr/0005-creaturedex-skin.md) lives only under the
 *     feature's roots, and every suite token it reads exists.
 *
 * Usage: node tools/creaturedex-check.mjs
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEATURE_DIR = "scripts/features/pf2e-creaturedex";
const FEATURE = join(ROOT, FEATURE_DIR);

const problems = [];
const fail = (msg) => problems.push(msg);
const read = (p) => readFileSync(join(ROOT, p), "utf8");
// A bare Windows path is not a URL the ESM loader accepts; this check used to
// die on its first import there, before checking anything.
const load = (file) => import(pathToFileURL(join(FEATURE, file)).href);

const rules = await load("rules.mjs");
const sectionsMod = await load("sections.mjs");
const constants = await load("constants.mjs");
const identity = await load("identity.mjs");
const ledger = await load("ledger.mjs");
const model = await load("model.mjs");
const render = await load("render.mjs");

const { isComplete, missingSections, aidBonus } = rules;
const { buildSections, abilitySection, subjectKind, availableSections } = sectionsMod;
const { SECTIONS, ALL_SECTION_KEYS, OUTCOME, SETTINGS, PREFIX, PARTY_KEY } = constants;

const lang = JSON.parse(read("lang/pf2e-creaturedex.en.json"));
const has = (key) => Object.prototype.hasOwnProperty.call(lang, key);
const used = new Set();
const t = (key, data) => {
  used.add(key);
  const s = lang[key] ?? key;
  return data ? s.replace(/\{(\w+)\}/g, (m, k) => (k in data ? String(data[k]) : m)) : s;
};
const ctx = { t, enrich: async (html) => String(html ?? "") };

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
if (PARTY_KEY !== "party") fail("constants: PARTY_KEY changed, and old worlds' reads name it");
const storeSrc = read(`${FEATURE_DIR}/store.mjs`);
if (!/const KEY = "dex\.knowledge";/.test(storeSrc)) fail("store: the knowledge setting key moved, so every world's dex reads empty");

/* ── 2. Pure rule logic ──────────────────────────────────────────────────── */

if (!isComplete(["a", "b"], ["a", "b"])) fail("rules: knowing every available section completes the dex");
if (isComplete(["a"], ["a", "b"])) fail("rules: a missing section is not a complete dex");
if (!isComplete(["a"], ["a"])) fail("rules: a one-section subject completes on one reveal");
if (isComplete([], [])) fail("rules: a subject with no sections must never read as complete");
if (missingSections(["a"], ["a", "b"]).join() !== "b") fail("rules: missingSections must report what is left");

if (aidBonus(OUTCOME.critSuccess) !== 2) fail("aid: a critical success is +2");
if (aidBonus(OUTCOME.critSuccess, "master") !== 3) fail("aid: a master's critical success is +3");
if (aidBonus(OUTCOME.critSuccess, "legendary") !== 4) fail("aid: a legendary critical success is +4");
if (aidBonus(OUTCOME.success) !== 1) fail("aid: a success is +1");
if (aidBonus(OUTCOME.success, "legendary") !== 1) fail("aid: rank scales the critical success only");
if (aidBonus(OUTCOME.failure) !== 0) fail("aid: a failure grants nothing");
if (aidBonus(OUTCOME.critFailure) !== -1) fail("aid: a critical failure is a -1 PENALTY, not a zero");

/* The doctoring pass. A drift of zero is a "lie" that is the truth on the one
   row the player checks; an immunity must survive in BOTH directions. */
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
const stream = (seed) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

for (const seed of [1, 7, 99, 12345, 777777]) {
  const lie = rules.doctorSection(TRUTH, { rng: stream(seed) });
  const val = (k) => lie.rows.find((r) => r.key === k)?.value;
  const truth = (k) => TRUTH.rows.find((r) => r.key === k)?.value;
  if (val("immunities") !== truth("immunities")) fail(`doctor(seed ${seed}): immunities were altered — never, in either direction`);
  if (val("resistances") !== truth("resistances")) fail(`doctor(seed ${seed}): resistances shifted with the IWR option off`);
  for (const key of ["ac", "saves", "hp"]) {
    if (val(key) === truth(key)) fail(`doctor(seed ${seed}): ${key} came back unchanged, so the "lie" is the truth on that row`);
  }
  const ac = Number(val("ac"));
  if (!Number.isFinite(ac) || Math.abs(ac - 21) > 2) fail(`doctor(seed ${seed}): AC drifted ${ac - 21}, outside ±2`);
  const hp = Number(val("hp"));
  if (!Number.isFinite(hp) || Math.abs(hp - 90) > 90 * 0.25) fail(`doctor(seed ${seed}): HP drifted outside ±20%`);
  const dmg = lie.strikes.melee[0].damage;
  if (!/^2d(6|10) \+?7 piercing$|^2d(6|10)\+7 piercing$/.test(dmg)) fail(`doctor(seed ${seed}): damage die moved more than one step (${dmg})`);
}
{
  const lie = rules.doctorSection(TRUTH, { rng: stream(3), iwr: true });
  const val = (k) => lie.rows.find((r) => r.key === k)?.value;
  if (val("immunities") !== "poison, precision") fail("doctor: the IWR option must not unlock immunities");
  if (val("resistances") === "fire 10") fail("doctor: with the IWR option on, a resistance must actually move");
}
/* And structurally: an immunity list is words with no digits, so routing it
   into the numeric drift passes every value check while saying in the source
   that immunities are fair game. */
{
  const doctorSrc = read(`${FEATURE_DIR}/rules.mjs`);
  const body = doctorSrc.slice(doctorSrc.indexOf("export function doctorSection"));
  const sw = body.slice(body.indexOf("switch (row.key)"), body.indexOf("return row;"));
  if (!sw) fail("doctor: the doctoring switch could not be found, so the immunity pin reads nothing");
  if (/case "immunities"/.test(sw)) fail("doctor: `immunities` is a case the doctoring switch mutates — it must never be");
}

/* ── 3. The book's field lists ───────────────────────────────────────────── */

const ability = (name, category, actionType = "action") => ({
  name,
  system: { category, actionType: { value: actionType }, actions: { value: 1 }, traits: { value: [] }, description: { value: "<p>text</p>" } },
});

const NPC = {
  type: "npc",
  name: "Fixture",
  img: "fixture.webp",
  uuid: "Actor.fixture",
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

const BOOK = {
  characteristics: ["level", "rarity", "size", "traits", "perception", "languages", "skills", "attributes"],
  defense: ["ac", "saves", "hp", "immunities", "weaknesses", "resistances"],
  offense: ["speed"],
};
for (const [section, fields] of Object.entries(BOOK)) {
  for (const field of fields) if (!rowKeys(section).includes(field)) fail(`sections: "${field}" is missing from ${section} — the book prints it there`);
}
for (const [section, fields] of Object.entries(BOOK)) {
  for (const other of Object.keys(BOOK)) {
    if (other === section) continue;
    for (const field of fields) if (rowKeys(other).includes(field)) fail(`sections: "${field}" appears in both ${section} and ${other}`);
  }
}

if (abilitySection(ability("x", "interaction")) !== "characteristics") fail("sections: an interaction ability belongs to Characteristics");
if (abilitySection(ability("x", "defensive")) !== "defense") fail("sections: a defensive ability belongs to Defense");
if (abilitySection(ability("x", "offensive")) !== "offense") fail("sections: an offensive ability belongs to Offense");
for (const type of ["reaction", "passive", "action", "free"]) {
  if (abilitySection(ability("x", null, type)) !== null) {
    fail(`sections: an uncategorised ${type} is being guessed at rather than deferred, which leaks it into a section nobody bought`);
  }
}
for (const name of ["Attack of Opportunity", "Reactive Strike", "Reactive Strike (Jaws Only)"]) {
  if (abilitySection(ability(name, "defensive", "reaction")) !== "offense") fail(`sections: "${name}" must sit under Offense — it is a Strike`);
  if (abilitySection(ability(name, null, "reaction")) !== "offense") fail(`sections: an untagged "${name}" must still route to Offense`);
}
if (abilitySection(ability("Shield Block", "defensive", "reaction")) !== "defense") fail("sections: the named-ability map is routing abilities it has no entry for");
const OVERRIDDEN = { ...ability("x", null, "action"), flags: { "gluniverse-foundry-modules": { "dex.section": "defense" } } };
if (abilitySection(OVERRIDDEN) !== "defense") fail("sections: a per-item GM override must beat everything");
const OVERRIDDEN_NAMED = { ...ability("Reactive Strike", "defensive", "reaction"), flags: { "gluniverse-foundry-modules": { "dex.section": "characteristics" } } };
if (abilitySection(OVERRIDDEN_NAMED) !== "characteristics") fail("sections: a per-item GM override must beat the named-ability map too");
if (!built.deferred?.length) fail("sections: buildSections drops uncategorised abilities instead of deferring them");

if (!byKey.offense?.strikes?.melee?.length) fail("sections: melee strikes are missing from Offense");
if (!byKey.offense?.strikes?.ranged?.length) fail("sections: a `melee` item carrying a range is a RANGED strike");

const BARE = { type: "npc", system: { details: {}, traits: {}, attributes: {}, saves: {}, abilities: {} }, itemTypes: {}, items: [] };
for (const section of buildSections(BARE).sections) {
  for (const row of section.rows) if (row.value === "") fail(`sections: ${section.key} prints an empty "${row.key}" row, which reads as "none"`);
}

const HAZARD = {
  type: "hazard",
  name: "Pit",
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
for (const key of EXPECTED.hazard) if (!hazKeys.includes(key)) fail(`sections: the hazard table is missing "${key}"`);
const hazRows = Object.fromEntries(haz.sections.map((s) => [s.key, s.rows.map((r) => r.key)]));
for (const field of ["ac", "saves", "hardness", "hp"]) {
  if (!hazRows.disable?.includes(field)) fail(`sections: "${field}" belongs to a hazard's Disable and Trigger`);
}
if (!hazRows.complexity?.includes("stealth")) fail("sections: Stealth belongs to a hazard's Complexity and Stealth");
if (subjectKind({ type: "character" }) !== null) fail("sections: a PC is not a creaturedex subject");
if (availableSections(NPC).length !== 3) fail("sections: a full creature offers three sections");

/* ── 4. Nothing watches a roll ───────────────────────────────────────────── */

for (const gone of ["chat.mjs", "reveal.mjs"]) {
  if (existsSync(join(FEATURE, gone))) fail(`${gone} is back: reveals are the GM's click, not a Recall Knowledge hook`);
}
const featureFiles = readdirSync(FEATURE).filter((f) => f.endsWith(".mjs"));
const src = Object.fromEntries(featureFiles.map((f) => [f, read(`${FEATURE_DIR}/${f}`)]));
for (const [needle, why] of [
  [/renderChatMessage(HTML)?\b/, "a chat-card hook is back"],
  [/emitSocket|onSocket|game\.socket/, "a socket is back, and this feature has no payload it could safely trust"],
  [/context\??\.outcome/, "a roll outcome is being read"],
]) {
  for (const [file, text] of Object.entries(src)) if (needle.test(text)) fail(`${file}: ${why} — the reveal is the GM's click`);
}

/* ── 5. Identity ─────────────────────────────────────────────────────────── */

const { dexKey, slugify } = identity;
const COMPENDIUM = { name: "Goblin Warrior", _stats: { compendiumSource: "Compendium.pf2e.pathfinder-bestiary.Actor.abc" }, system: { details: { level: { value: 1 } } } };
const WORLD_COPY = { name: "Goblin Warrior", _stats: {}, system: { details: { level: { value: 1 } } } };
const IMPORTED = { name: "goblin  warrior", _stats: {}, system: { details: { level: { value: 1 } } } };
const ELITE = { name: "Goblin Warrior", _stats: {}, system: { details: { level: { value: 3 } } } };
if (dexKey(COMPENDIUM) !== "Compendium.pf2e.pathfinder-bestiary.Actor.abc") fail("identity: the compendium source must win");
if (dexKey(WORLD_COPY) !== dexKey(IMPORTED)) fail("identity: two spellings of the same world creature must land on one key");
if (dexKey(WORLD_COPY) === dexKey(ELITE)) fail("identity: a level-shifted variant must key separately");
if (slugify("Sløugh's  Wärden!") !== "sloughs-warden") fail(`identity: slugify does not normalise (got ${slugify("Sløugh's  Wärden!")})`);
const TOKEN_ACTOR = { isToken: true, token: { baseActor: WORLD_COPY }, name: "Goblin Warrior (2)", _stats: {}, system: {} };
if (dexKey(TOKEN_ACTOR) !== dexKey(WORLD_COPY)) fail("identity: an unlinked token must resolve to its base actor");

/* ── 6. The ledger, driven ───────────────────────────────────────────────── */

const S = "subject.fixture";
const snapOf = (actor) => {
  const b = buildSections(actor);
  return {
    snapshots: Object.fromEntries(b.sections.map((s) => [s.key, s])),
    meta: { name: actor.name, img: actor.img, kind: b.kind, available: b.sections.map((s) => s.key), uuid: actor.uuid, deferred: b.deferred },
  };
};
const fx = snapOf(NPC);
const LIE = { key: "defense", rows: [{ key: "ac", value: "17" }] };
const {
  applyReveal, applyFalse, applyRedact, applyRefresh, applyForget, scrubDeferred,
  knownIn, falseIn, truthIn, ownerRecord, subjectsIn,
} = ledger;

{
  // A whole-party reveal is a fan-out. The shared row is refused outright.
  if (applyReveal({}, S, PARTY_KEY, ["defense"], fx.snapshots, fx.meta) !== null) {
    fail("ledger: a reveal to PARTY_KEY was written — a shared row reads back only while Party Knowledge is on");
  }
  const fan = applyReveal({}, S, ["a", "b"], ["defense"], fx.snapshots, fx.meta, false);
  for (const who of ["a", "b"]) if (!knownIn(fan, S, who, false).includes("defense")) fail(`ledger: the fan-out did not reach ${who}`);
  if (fan?.[S]?.owners?.[PARTY_KEY]) fail("ledger: a fan-out wrote a party row");
  // Party Knowledge is a READ: the same data, flipped, invents and destroys nothing.
  const solo = applyReveal({}, S, "a", ["defense"], fx.snapshots, fx.meta, false);
  if (knownIn(solo, S, "b", false).length) fail("ledger: a character who was not told knows the section with Party Knowledge off");
  if (!knownIn(solo, S, "b", true).includes("defense")) fail("ledger: Party Knowledge does not union the owners");
  if (JSON.stringify(solo) !== JSON.stringify(applyReveal({}, S, "a", ["defense"], fx.snapshots, fx.meta, false))) {
    fail("ledger: the same reveal wrote two different dexes");
  }

  // The store holds the rendered snapshot it was handed.
  if (JSON.stringify(truthIn(solo, S, "defense")) !== JSON.stringify(fx.snapshots.defense)) fail("ledger: the truth snapshot was not stored as handed over");
  if (truthIn(solo, S, "offense")) fail("ledger: a section nobody was told has a stored snapshot");

  // A lie sits beside the truth, never over it.
  if (applyFalse(solo, S, "a", "defense", LIE, null, fx.meta, false) !== null) fail("ledger: a lie overwrote a section the character knows truly");
  const lied = applyFalse(solo, S, ["a", "b"], "defense", LIE, null, fx.meta, false);
  if (!lied) fail("ledger: a lie to a mixed audience recorded nothing");
  else {
    if (ownerRecord(lied[S].owners.a).false.defense) fail("ledger: the truth-holder in a mixed audience was handed the lie too");
    if (!ownerRecord(lied[S].owners.b).false.defense) fail("ledger: the character who did not know was not told the lie");
    if (JSON.stringify(truthIn(lied, S, "defense")) !== JSON.stringify(fx.snapshots.defense)) fail("ledger: recording a lie touched the stored truth");
    if (falseIn(lied, S, "b", true).length) fail("ledger: under Party Knowledge a lie outlives the truth somebody holds");
    // Learning the truth later replaces the lie.
    const corrected = applyReveal(lied, S, "b", ["defense"], fx.snapshots, fx.meta, false);
    if (ownerRecord(corrected[S].owners.b).false.defense) fail("ledger: a section learned truly kept the lie it replaced");
  }

  // Redacting the last holder drops the snapshot; redacting one of two does not.
  const two = applyReveal({}, S, ["a", "b"], ["defense"], fx.snapshots, fx.meta, false);
  const one = applyRedact(two, S, "a", "defense", false);
  if (!truthIn(one, S, "defense")) fail("ledger: redacting one of two holders dropped the other's snapshot");
  const none = applyRedact(one, S, "b", "defense", false);
  if (truthIn(none, S, "defense")) fail("ledger: redacting the last holder left the truth snapshot in the store");
  if (applyRedact(two, S, "nobody", "defense", false) !== null) fail("ledger: redacting a character who holds nothing wrote a change");

  // A lie is cleared by the same control.
  const cleared = applyRedact(lied, S, "b", "defense", false);
  if (cleared && falseIn(cleared, S, "b", false).length) fail("ledger: clearing a lie left it in place");

  // Held-back abilities are stored only once somebody is truly complete.
  const partial = applyReveal({}, S, "a", ["characteristics", "defense"], fx.snapshots, fx.meta, false);
  if (partial[S].meta.deferred?.length) fail("ledger: held-back abilities were stored before anybody completed the entry");
  const done = applyReveal(partial, S, "a", ["offense"], fx.snapshots, fx.meta, false);
  if (!done[S].meta.deferred?.length) fail("ledger: a true completion did not store the held-back abilities");
  const undone = applyRedact(done, S, "a", "offense", false);
  if (undone[S].meta.deferred?.length) fail("ledger: redacting a completion left the held-back abilities in the store");
  // A lie never earns them.
  const believed = applyFalse(partial, S, "a", "offense", LIE, null, fx.meta, false);
  if (believed[S].meta.deferred?.length) fail("ledger: completing an entry with a lie stored the held-back abilities");
  // And old worlds are scrubbed.
  const legacy = JSON.parse(JSON.stringify(partial));
  legacy[S].meta.deferred = fx.meta.deferred;
  const scrubbed = scrubDeferred(legacy);
  if (!scrubbed || scrubbed[S].meta.deferred.length) fail("ledger: scrubDeferred leaves unearned abilities in an old world");
  if (scrubDeferred(done) !== null) fail("ledger: scrubDeferred drops abilities somebody earned");
  // Earned only through the union: kept while Party Knowledge is on, dropped once it is off.
  let split = applyReveal({}, S, "a", ["characteristics", "defense"], fx.snapshots, fx.meta, true);
  split = applyReveal(split, S, "b", ["offense"], fx.snapshots, fx.meta, true);
  if (!split[S].meta.deferred?.length) fail("ledger: a completion by the party's union did not store the held-back abilities");
  if (scrubDeferred(split, true) !== null) fail("ledger: scrubDeferred drops abilities the party earned with Party Knowledge on");
  const off = scrubDeferred(split, false);
  if (off?.[S]?.meta?.deferred?.length !== 0) {
    fail("ledger: with Party Knowledge off, abilities nobody earned alone stay in a store every client reads");
  } else {
    // ...and switching it back on earns them again, read back off the live creature.
    const on = ledger.applyDeferred(off, S, fx.meta.deferred, true);
    if (!on?.[S]?.meta?.deferred?.length) fail("ledger: switching Party Knowledge back on never restores the held-back abilities");
    if (JSON.stringify(on?.[S]?.sections) !== JSON.stringify(off[S].sections)) fail("ledger: restoring held-back abilities rewrote the section snapshots");
    if (ledger.applyDeferred(off, S, fx.meta.deferred, false) !== null) fail("ledger: held-back abilities were restored to an entry nobody earned");
  }
  if (!/applyDeferred\(/.test(storeSrc) || !/settleDeferred\(\)/.test(src["index.mjs"])) {
    fail("index/store: nothing restores held-back abilities when Party Knowledge earns them again");
  }
  // The actor lookups are async. A dex or a rule read before them and written
  // after undoes whatever the GM did meanwhile (a redaction, the setting itself).
  const settle = storeSrc.slice(storeSrc.indexOf("export async function settleDeferred"));
  const lastAwait = settle.lastIndexOf("await fromUuid");
  if (lastAwait < 0 || settle.lastIndexOf("readAll()") < lastAwait || settle.lastIndexOf("partyMode()") < lastAwait) {
    fail("store: settleDeferred writes a dex or a Party Knowledge value it read before the actor lookups");
  }

  // Refresh re-takes only what is held, and never a lie.
  const fresh = { ...fx.snapshots, defense: { ...fx.snapshots.defense, rows: [{ key: "ac", value: "99" }] }, offense: { key: "offense", rows: [] } };
  const refreshed = applyRefresh(lied, S, fresh, fx.meta, false);
  if (truthIn(refreshed, S, "defense")?.rows?.[0]?.value !== "99") fail("ledger: refresh did not re-take a held snapshot");
  if (truthIn(refreshed, S, "offense")) fail("ledger: refresh handed out a section nobody bought");
  if (JSON.stringify(falseIn(refreshed, S, "b", false)[0]?.snapshot) !== JSON.stringify(LIE)) fail("ledger: refresh rewrote a lie");

  if (applyForget(two, S)?.[S]) fail("ledger: forget left the subject behind");
  // Older worlds stored lies as an array.
  const old = ownerRecord({ sections: ["characteristics"], false: [{ section: "defense", snapshot: LIE, from: null }] });
  if (!old.false.defense) fail("ledger: an old world's array of lies no longer reads");
  if (!subjectsIn({ [S]: { owners: { b: { sections: [], false: { defense: { snapshot: LIE } } } } } }).includes(S)) {
    fail("ledger: a subject known only by a lie is missing from the shelf");
  }
  for (const [name, fn] of Object.entries({ applyReveal, applyFalse, applyRedact })) {
    const before = JSON.stringify(two);
    fn(two, S, "a", "defense", LIE);
    if (JSON.stringify(two) !== before) fail(`ledger: ${name} mutated the dex it was handed`);
  }
}

/* ── 7. The model and the markup: what a viewer can tell ─────────────────── */

const PCS = [{ id: "a", name: "Seri" }, { id: "b", name: "Brack" }];
const meta = { ...fx.meta, deferred: [] };
{
  // The same snapshot handed over as a truth and as a lie must draw identically
  // for its holder. Anything that differs is a tell.
  const asTruth = applyReveal({}, S, ["a"], ["characteristics", "defense", "offense"], fx.snapshots, meta, false);
  let asLie = applyReveal({}, S, ["a"], ["characteristics", "offense"], fx.snapshots, meta, false);
  asLie = applyFalse(asLie, S, ["a"], "defense", fx.snapshots.defense, null, meta, false);
  const player = (data) => model.dexModel({ data, isGM: false, party: false, characters: [PCS[0]], subject: S });
  const pT = player(asTruth);
  const pL = player(asLie);
  const walk = (o, f) => (o && typeof o === "object" ? (f(o), Object.values(o).forEach((v) => walk(v, f))) : null);
  walk(pL, (o) => {
    if (o.state === "false") fail("model: a player's model carries a `false` state");
    if (o.isLie) fail("model: a player's model marks a lie");
    if (o.believed) fail("model: a player's model says the entry is only believed complete");
    if (o.tone === "lie") fail("model: a player's model carries the GM's lie note");
  });
  const draw = async (m) => (await render.prepareDetail(m.detail, ctx), render.dexHTML(m, { t }));
  const hT = await draw(pT);
  const hL = await draw(pL);
  if (hT !== hL) fail("render: a lie draws differently from the truth for its holder, so a player can see it is a lie");

  // The GM sees the truth beside it.
  const gm = model.dexModel({ data: asLie, isGM: true, party: false, characters: PCS, ownerId: "a", subject: S });
  const def = gm.detail.sections.find((s) => s.key === "defense");
  if (def.state !== "false" || !def.isLie) fail("model: the GM's model does not mark the lie");
  if (!gm.detail.believed || gm.detail.complete) fail("model: the GM's model calls a lie-completed entry truly complete");
  if (def.canFalsify) fail("model: Falsify is offered on a section that is already false");
  if (!def.canClear || !def.canReveal) fail("model: a false section must offer Reveal (the truth) and Redact");
  const gmHTML = await draw(gm);
  if (!gmHTML.includes("gldex-section-lie")) fail("render: the GM's view does not label the lie");

  // A sealed section is a name and nothing else.
  const partial = applyReveal({}, S, ["a"], ["characteristics"], fx.snapshots, meta, false);
  const pm = model.dexModel({ data: partial, isGM: false, party: false, characters: [PCS[0]], subject: S });
  for (const s of pm.detail.sections.filter((x) => x.state === "sealed")) {
    if (s.snapshot) fail(`model: the sealed ${s.key} carries a snapshot`);
  }
  await render.prepareDetail(pm.detail, ctx);
  for (const s of pm.detail.sections.filter((x) => x.state === "sealed")) {
    if (/gldex-row|gldex-ability/.test(s.html)) fail(`render: the sealed ${s.key} plate draws rows, which leaks its shape`);
  }
  if (pm.detail.sections.some((s) => s.state === "sealed" && (s.canReveal || s.canFalsify || s.canClear))) fail("model: a player is offered a GM control");
  const pmHTML = render.dexHTML(pm, { t });
  if (/data-action="(revealSection|falsifySection|clearSection|refreshSubject|forgetSubject)"/.test(pmHTML)) fail("render: a player's window draws a GM control");

  // Held-back abilities print on a true completion only.
  const withDeferred = { ...fx.meta };
  const trueDone = applyReveal({}, S, ["a"], ["characteristics", "defense", "offense"], fx.snapshots, withDeferred, false);
  const td = model.dexModel({ data: trueDone, isGM: false, party: false, characters: [PCS[0]], subject: S });
  if (!td.detail.deferred.length) fail("model: a true completion does not print the held-back abilities");

  // A player's shelf lists only what their read holds something about.
  const other = applyReveal({}, "subject.other", ["b"], ["characteristics"], fx.snapshots, meta, false);
  const shelf = model.dexModel({ data: other, isGM: false, party: false, characters: [PCS[0]] });
  if (shelf.shelf.entries.length) fail("model: a player's shelf shows a creature their character never learned");
  // Party Knowledge is a READ rule: it never widens who a GM's write lands on.
  const pick = model.resolveOwner({ isGM: true, party: true, characters: PCS, ownerId: "a" });
  if (pick.everyone || pick.readKey !== "a") fail("model: under Party Knowledge the GM's one-character pick became Everyone, so a reveal writes to the whole party");
  if (!model.dexModel({ data: {}, isGM: true, party: true, characters: PCS }).owners.some((o) => o.id === "a")) {
    fail("model: under Party Knowledge the GM cannot pick one character to reveal to");
  }
  // A player never reads for the party key.
  const own = model.resolveOwner({ isGM: false, party: true, characters: PCS, ownerId: PARTY_KEY });
  if (own.readKey === PARTY_KEY) fail("model: a player can read for the party key");
}

/* The reveal notice: a lie posts what a truth posts, and only to who was told. */
{
  const users = [{ id: "gm", isGM: true, owns: [] }, { id: "u1", isGM: false, owns: ["a"] }, { id: "u2", isGM: false, owns: ["b"] }];
  const n = model.noticeModel({ section: "defense", subjectName: "Fixture", owners: [PCS[0]], everyone: false, party: false, users });
  if (!n.whisper || !n.whisper.includes("gm") || !n.whisper.includes("u1") || n.whisper.includes("u2")) {
    fail("notice: a reveal to one character is not whispered to that player and the GMs alone");
  }
  if (model.noticeModel({ section: "defense", owners: PCS, everyone: true, users }).whisper !== null) fail("notice: a reveal to everyone is whispered");
  if (model.noticeModel({ section: "defense", owners: [PCS[0]], party: true, users }).whisper !== null) fail("notice: under Party Knowledge a reveal is whispered");
  const head = model.noticeModel.toString();
  const params = head.slice(head.indexOf("{"), head.indexOf("})") + 1);
  const noticeArgs = [...params.matchAll(/(\w+)\s*(?:=[^,}]*)?\s*[,}]/g)].map((m) => m[1]).join(" ");
  if (!noticeArgs || /lie|truth|false|honest/i.test(noticeArgs)) fail("notice: the notice model takes a truth flag, so a lie could post a different card");
  for (const file of ["app.mjs", "falsify.mjs"]) {
    if (!/afterHandover\(/.test(src[file] ?? "")) fail(`${file}: a handover does not post the shared notice, so a lie and a truth arrive differently`);
  }
  if (/ChatMessage\.create/.test(src["app.mjs"] + src["falsify.mjs"])) fail("app/falsify: a chat message is posted outside afterHandover");
}

/* ── 8. Purity, and the module-scope contract ────────────────────────────── */

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
for (const file of ["ledger.mjs", "model.mjs", "render.mjs", "sections.mjs", "rules.mjs", "identity.mjs", "constants.mjs"]) {
  const code = stripComments(src[file] ?? "");
  const hit = code.match(/\b(game|foundry|canvas|ui|Hooks|document|window)\s*[.?[]/);
  if (hit) fail(`${file}: reaches \`${hit[1]}\`, so the check and the preview draw a copy nobody ships`);
}
// resource-bars resolves CreaturedexApp.mayView through a lazy import() that
// fails closed BECAUSE app.mjs reads foundry at module scope. Keep both halves.
if (!/^const \{ ApplicationV2 \} = foundry\.applications\.api;/m.test(src["app.mjs"])) fail("app: the module-scope ApplicationV2 read moved");
if (!/export class CreaturedexApp/.test(src["app.mjs"])) fail("app: CreaturedexApp is no longer exported, so resource-bars' name gate fails closed forever");
if (!/static FalsifyApp|function FalsifyApp|const FalsifyApp|FalsifyApp\s*=/.test(src["falsify.mjs"]) || /^const \{ ApplicationV2 \}/m.test(src["falsify.mjs"])) {
  fail("falsify: the dialog class must be built in a memoised factory, not at module scope");
}

/* ── 9. Settings, prefixes and i18n ──────────────────────────────────────── */

const indexSrc = src["index.mjs"];
const registered = new Set();
for (const m of indexSrc.matchAll(/game\.settings\.register\(\s*SUITE_ID\s*,\s*(?:SETTINGS\.([A-Za-z]+)|"([^"]+)")/g)) registered.add(m[1] ? SETTINGS[m[1]] : m[2]);
for (const [name, key] of Object.entries(SETTINGS)) {
  if (!key.startsWith(PREFIX)) fail(`settings: "${key}" does not begin with "${PREFIX}"`);
  if (!registered.has(key)) fail(`settings: SETTINGS.${name} ("${key}") is declared but never registered — reading it throws`);
}
if ("enabled" in SETTINGS) fail("settings: SETTINGS.enabled is back — the registry owns this feature's toggle");
if (!registered.has("dex.knowledge")) fail("settings: the dex store itself is not registered");
for (const key of Object.values(SETTINGS)) {
  const stem = key.slice(PREFIX.length);
  for (const suffix of ["name", "hint"]) if (!has(`GLDEX.settings.${stem}.${suffix}`)) fail(`i18n: GLDEX.settings.${stem}.${suffix} is missing`);
}

// Built at runtime from data.
for (const key of ALL_SECTION_KEYS) if (!has(`GLDEX.section.${key}`)) fail(`i18n: GLDEX.section.${key} is missing`);
const rowKeysUsed = new Set(["melee", "ranged", "spells", "innate", "focus", "ritual"]);
for (const s of [...built.sections, ...haz.sections]) for (const r of s.rows) rowKeysUsed.add(r.key);
for (const key of rowKeysUsed) if (!has(`GLDEX.row.${key}`)) fail(`i18n: GLDEX.row.${key} is missing — it renders as a raw key mid stat block`);
for (const kind of ["creature", "hazard"]) if (!has(`GLDEX.kind.${kind}`)) fail(`i18n: GLDEX.kind.${kind} is missing`);
for (const key of ["both", "prose", "sections"]) if (!has(`GLDEX.delivery.${key}`)) fail(`i18n: GLDEX.delivery.${key} is missing`);

// Static keys, swept out of every source.
const sources = Object.values(src).join("\n");
for (const match of sources.matchAll(/["'`](GLDEX\.[A-Za-z0-9_.]+)["'`]/g)) {
  if (!match[1].endsWith(".") && !has(match[1])) fail(`i18n: ${match[1]} is referenced but not defined`);
}
if (!has("GLS.feature.pf2e-creaturedex.title") || !has("GLS.feature.pf2e-creaturedex.hint")) fail("i18n: the feature has no title/hint");

/* ── 10. Every surface, drawn: classes, buttons and keys ─────────────────── */

const css = read("styles/pf2e-creaturedex.css");
const surfaces = [];
{
  const full = applyReveal({}, S, ["a"], ["characteristics", "defense", "offense"], fx.snapshots, fx.meta, false);
  let mixed = applyReveal({}, S, ["a"], ["characteristics"], fx.snapshots, meta, false);
  mixed = applyFalse(mixed, S, ["a"], "defense", LIE, null, meta, false);
  const many = Array.from({ length: 8 }, (_, i) => `subject.${i}`).reduce(
    (d, k) => applyReveal(d, k, ["a"], ["characteristics"], fx.snapshots, { ...meta, name: `Fixture ${k}` }, false),
    mixed
  );
  const models = [
    model.dexModel({ data: mixed, isGM: true, party: false, characters: PCS, ownerId: PARTY_KEY, subject: S, live: { deferredCount: 2 } }),
    model.dexModel({ data: many, isGM: true, party: false, characters: PCS, ownerId: "a", subject: S, fresh: ["defense"], entering: true }),
    model.dexModel({ data: full, isGM: false, party: true, characters: [PCS[0]], subject: S }),
    model.dexModel({ data: mixed, isGM: false, party: false, characters: PCS, ownerId: "a", subject: S }),
    model.dexModel({ data: {}, isGM: false, party: true, characters: [PCS[0]] }),
  ];
  for (const m of models) {
    await render.prepareDetail(m.detail, ctx);
    surfaces.push(render.dexHTML(m, { t }));
  }
  const truth = fx.snapshots.defense;
  surfaces.push(render.falsifyHTML(model.falsifyModel({ ctx: { section: "defense", name: "X", toName: "Seri" }, candidates: [{ id: "c", name: "C", level: 2 }], sourceId: "c", truth }), { t }));
  surfaces.push(render.falsifyHTML(model.falsifyModel({ ctx: { section: "defense", name: "X" }, mode: "doctor", draft: rules.doctorSection(truth, { rng: stream(4) }), truth, iwr: true }), { t }));
  surfaces.push(render.noticeHTML(model.noticeModel({ section: "offense", subjectName: "X", owners: [PCS[0]], complete: true, users: [] }), { t }));
  surfaces.push(render.noticeHTML(model.noticeModel({ section: "routine", subjectName: "X", owners: PCS, everyone: true, users: [] }), { t }));

  // The harvested draft drops an emptied row rather than printing "none".
  const harvested = model.harvestDraft({ rows: [{ key: "ac", value: "20" }, { key: "hp", value: "80" }] }, { hp: "  " });
  if (harvested.rows.some((r) => r.key === "hp")) fail("falsify: a row the GM emptied is sent as an empty value, which reads as \"none\"");
}
const drawn = surfaces.join("\n");

// Every key a surface asked for exists.
for (const key of used) if (!has(key)) fail(`i18n: ${key} is asked for by a surface and missing — it renders as a raw key`);
for (const note of ["GLDEX.app.everyoneNote", "GLDEX.app.completeNote", "GLDEX.app.believedNote", "GLDEX.app.deferred"]) {
  if (!has(note)) fail(`i18n: ${note} is a note the model names and it is missing`);
}

// Every class a surface draws has a rule behind it.
const classes = new Set();
for (const m of drawn.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) if (c.startsWith("gldex-")) classes.add(c);
/* Classes that carry no rule of their own on purpose: hooks for actions and for
   PF2e Odds, a body its parent lays out, and two lines styled through the
   element they sit in. Anything NOT here that has lost its rule lost a surface. */
const UNSTYLED_BY_DESIGN = new Set([
  "gldex-section-body", "gldex-toggle", "gldex-reveal", "gldex-redact", "gldex-falsify",
  "gldex-refresh", "gldex-forget", "gldex-nomatch", "gldex-sealed-line",
]);
for (const cls of classes) {
  if (UNSTYLED_BY_DESIGN.has(cls)) continue;
  if (!new RegExp("\\." + cls + "(?![a-z0-9-])").test(css)) fail(`styles: .${cls} is drawn and has no rule anywhere, so it renders unstyled`);
}

// Every button a surface draws is sized by the feature. Foundry and `.gl-btn`
// both leave a button's type to its host: 14px in a chat card, more on a sheet.
const sizedReset = /:is\(\.gldex-root, \.gldex-lie-root\) :is\(button, input, select\) \{[^}]*font-size:\s*\d+px/.test(css);
if (!sizedReset) fail("styles: the controls reset no longer sizes buttons, so every one takes its host's type");
for (const m of drawn.matchAll(/<button\b[^>]*>/g)) {
  if (/\bgl-btn\b/.test(m[0])) fail("render: a `.gl-btn` is drawn; it carries no size of its own, so it inflates in a chat card");
}
if (/<button\b/.test(surfaces.filter((s) => s.includes("gldex-card")).join(""))) fail("render: the chat notice draws a button, which no reset in a chat log sizes");

// The anchors PF2e Odds hangs its "observed" line from.
for (const anchor of ['class="gldex-detail-head"', 'class="gldex-tool gldex-forget" data-action="forgetSubject" data-key=', 'data-section="defense"']) {
  if (!drawn.includes(anchor)) fail(`render: PF2e Odds' dex hint anchors on ${anchor}, which the window no longer draws`);
}

// Every control is wired to an action the application registers.
const actionsBlock = (file) => src[file].slice(src[file].indexOf("actions: {"), src[file].indexOf("}", src[file].indexOf("actions: {")));
const registeredActions = new Set([...actionsBlock("app.mjs").matchAll(/(\w+):/g), ...actionsBlock("falsify.mjs").matchAll(/(\w+):/g)].map((m) => m[1]));
for (const m of drawn.matchAll(/data-action="(\w+)"/g)) {
  if (!registeredActions.has(m[1])) fail(`render: data-action="${m[1]}" is drawn and not registered, so that button does nothing`);
}

/* ── 11. The scoped skin (docs/adr/0005-creaturedex-skin.md) ─────────────── */

if (!existsSync(join(ROOT, "docs/adr/0005-creaturedex-skin.md"))) fail("docs: the skin's ADR is missing");
const cssCode = stripComments(css);
if (/:root/.test(cssCode)) fail("styles: the skin writes to :root, which repaints every feature loaded after it");
for (const m of cssCode.matchAll(/(--gl-[a-z0-9-]+)\s*:/g)) fail(`styles: ${m[1]} is redeclared — a foundation token belongs to gl-tokens.css alone`);
for (const m of cssCode.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)) if (!m[1].startsWith("gldex-")) fail(`styles: @keyframes ${m[1]} is not prefixed gldex-, and keyframe names are global`);
for (const m of cssCode.matchAll(/(?:animation|transition)[a-z-]*\s*:\s*([^;]+);/g)) {
  if (/\b\d+(\.\d+)?m?s\b/.test(m[1])) fail(`styles: a raw duration (${m[1].trim()}) ignores the motion tier`);
  if (/cubic-bezier|\bease(-in|-out|-in-out)?\b|\blinear\b/.test(m[1].replace(/var\([^)]*\)/g, ""))) fail(`styles: a raw easing (${m[1].trim()})`);
}
if (/rgba\(\s*255\s*,\s*255\s*,\s*255/.test(cssCode)) fail("styles: a raw white veil; use a tint channel");
if (/prefers-reduced-motion/.test(cssCode + sources)) fail("styles/scripts: the suite does not honour the OS reduced-motion preference");
for (const m of cssCode.matchAll(/backdrop-filter\s*:\s*([^;]+);/g)) {
  if (!/--gl-blur|--gl-glass-k/.test(m[1]) && !/none/.test(m[1])) fail("styles: a backdrop blur ignores the player's glass tier");
}
if (/@import|@font-face/.test(cssCode)) fail("styles: an @import or @font-face in a feature sheet");
// Every --gldex- token is declared only on the feature's roots.
for (const rule of cssCode.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
  if (!/--gldex-[a-z0-9-]+\s*:/.test(rule[2])) continue;
  if (!/\.gldex/.test(rule[1])) fail(`styles: --gldex-* is declared outside the feature's roots (${rule[1].trim()})`);
}
// Every suite token the skin reads exists, or the property silently drops.
const tokens = read("styles/gl-tokens.css") + read("styles/gl-motion.css");
for (const name of new Set([...cssCode.matchAll(/var\((--gl-[a-z0-9-]+)/g)].map((m) => m[1]))) {
  if (!new RegExp(name + "\\s*:").test(tokens)) fail(`styles: ${name} is read and declared nowhere, so its property is dropped`);
}
for (const name of new Set([...cssCode.matchAll(/var\((--gldex-[a-z0-9-]+)/g)].map((m) => m[1]))) {
  if (["--gldex-i"].includes(name)) continue;
  if (!new RegExp(name + "\\s*:").test(cssCode)) fail(`styles: ${name} is read and never declared`);
}

/* ── 12. Registration, and every road in ─────────────────────────────────── */

const manifest = JSON.parse(read("module.json"));
if (!manifest.styles.includes("styles/pf2e-creaturedex.css")) fail("module.json: the stylesheet is not listed");
if (!manifest.languages.some((l) => l.path === "lang/pf2e-creaturedex.en.json")) fail("module.json: the language file is not listed");
if (!read("scripts/features/index.mjs").includes("pf2e-creaturedex")) fail("roster: the adapter is never imported");
if (existsSync(join(ROOT, "templates/pf2e-creaturedex"))) {
  if (readdirSync(join(ROOT, "templates/pf2e-creaturedex")).length) fail("templates: a template is back, and nothing renders it");
}

const appSrc = src["app.mjs"];
const bodyOf = (name, text = appSrc) => {
  const at = text.indexOf(name);
  if (at < 0) return "";
  const end = text.indexOf("\n  }", at);
  return end < 0 ? text.slice(at) : text.slice(at, end);
};
const writeKeys = bodyOf("get writeKeys()");
if (!/partyCharacters\(\)/.test(writeKeys)) fail("app: writeKeys does not fan out to partyCharacters()");
if (/partyMode/.test(bodyOf("get everyone()"))) fail("app: `everyone` follows Party Knowledge, so a read rule widens a write to the whole party");
if (/PARTY_KEY/.test(writeKeys)) fail("app: writeKeys names PARTY_KEY, which only reads back while Party Knowledge is on");
if (!/PARTY_KEY/.test(bodyOf("get readKey()"))) fail("app: readKey no longer resolves the whole-party view");

const mayView = bodyOf("static mayView(actor)");
if (!/game\.user\.isGM/.test(mayView) || !/knownSections/.test(mayView) || !/falseSections/.test(mayView)) {
  fail("app: mayView no longer gates a non-GM on knowledge (both true and false sections)");
}
if (!/return\s+known\s*\?\s*key\s*:\s*null/.test(mayView)) fail("app: mayView returns a subject for a creature nothing is known about");
if (!/mayView\(/.test(bodyOf("static openForActor(actor)"))) fail("app: openForActor bypasses mayView");
if (!/mayView\(/.test(bodyOf("static followTarget(actor)"))) fail("app: followTarget bypasses mayView");
if (!/mayOpen\(\)/.test(bodyOf("static refreshOpen()"))) fail("app: a live redraw keeps a window open after the player's access was switched off");

for (const [needle, why] of [
  [/^\s+registerKeybinding\(\);/m, "the open-target keybinding is declared but never called"],
  [/^\s+registerTokenHud\(\);/m, "the token HUD button is declared but never registered"],
  [/^\s+registerContextMenu\(\);/m, "the actor-directory entry is declared but never registered"],
  [/^\s+registerSceneControl\(\);/m, "the scene control is declared but never registered"],
  [/^\s+registerLiveRefresh\(\);/m, "an open dex no longer redraws when the GM reveals something"],
  [/Hooks\.on\("targetToken"/, "an open window no longer follows the user's target"],
  [/Hooks\.on\("updateSetting"/, "nothing redraws an open dex after a write"],
  [/ensureSuiteGroup\(controls\)/, "the scene control is not in the suite's group (v13 renamed Foundry's own `token` group)"],
  [/bindSuiteToolClicks\(/, "the scene control's button resolves through onChange alone, so a second click does nothing"],
]) {
  if (!needle.test(indexSrc)) fail(`index: ${why}`);
}
const pointed = indexSrc.slice(indexSrc.indexOf("function pointedActor"), indexSrc.indexOf("function registerKeybinding"));
for (const source of ["targets", "controlled", "hover"]) if (!pointed.includes(source)) fail(`index: pointedActor ignores \`${source}\``);
for (const [fn, label] of [["function registerTokenHud", "token HUD button"], ["function registerContextMenu", "actor-directory entry"]]) {
  const start = indexSrc.indexOf(fn);
  const body = indexSrc.slice(start, indexSrc.indexOf("\n}", start));
  if (!/mayView\(/.test(body)) fail(`index: the ${label} is drawn without asking mayView, so it identifies creatures nobody knows`);
}
const keybinding = indexSrc.slice(indexSrc.indexOf("function registerKeybinding"), indexSrc.indexOf("function registerTokenHud"));
if (!/openForActor\(/.test(keybinding)) fail("index: the keybinding opens without openForActor, so it skips mayView");
if (/^Hooks\.on\(/m.test(indexSrc)) fail("index: a hook is registered at import time, so the feature is live even when disabled");
for (const [file, text] of Object.entries(src)) {
  if (file !== "index.mjs" && /^(Hooks\.on|game\.settings\.register)\(/m.test(text)) fail(`${file}: a side effect at import time`);
}

/* ── 13. The preview draws the module, not a copy ────────────────────────── */

const previewPath = "tools/creaturedex-preview.mjs";
if (!existsSync(join(ROOT, previewPath))) fail("preview: tools/creaturedex-preview.mjs is missing — the docs point at it");
else {
  const preview = read(previewPath);
  for (const mod of ["render.mjs", "model.mjs", "ledger.mjs", "sections.mjs"]) {
    if (!preview.includes(`pf2e-creaturedex/${mod}`)) fail(`preview: it does not import ${mod}, so it draws a copy nobody ships`);
  }
  const emitted = new Set([...classes, ...[...sources.matchAll(/gldex-[a-z-]+/g)].map((m) => m[0])]);
  for (const cls of new Set([...preview.matchAll(/gldex-[a-z-]+/g)].map((x) => x[0]))) {
    if (!emitted.has(cls)) fail(`preview: .${cls} appears in the preview but nothing in the module emits it`);
  }
  for (const frame of ["player", "gm", "unseal", "complete", "hazard", "empty", "falsify", "draft", "chat"]) {
    if (!new RegExp(`"${frame}"`).test(preview)) fail(`preview: the ${frame} frame is gone, so nobody looks at that surface`);
  }
}

/* ── report ──────────────────────────────────────────────────────────────── */

if (problems.length) {
  console.log(`creaturedex: ${problems.length} problem(s)\n`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exitCode = 1;
} else {
  console.log("creaturedex: no problems found");
}
