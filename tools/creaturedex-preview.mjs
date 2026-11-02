#!/usr/bin/env node
/**
 * Creaturedex — a browser-backed look at every surface.
 *
 * Nothing here is a copy of the module. Fixture creatures go through the real
 * extractor (`sections.mjs`), the real ledger writes (`ledger.mjs`), the real
 * view model (`model.mjs`) and the real markup (`render.mjs`), localised from
 * the real language file, and the page loads the shipped stylesheet. So what
 * you judge here is what a table gets: whether a sealed plate reads as sealed
 * beside a revealed one, whether a lie is invisible to its holder and loud to
 * the GM, and whether the three section hues carry meaning at a glance.
 *
 * Usage: node tools/creaturedex-preview.mjs [--out=.preview/dex.html]
 *        node tools/preview-server.mjs 8953
 *        /.preview/dex.html            every frame
 *        /.preview/dex.html?only=gm    one frame (player, gm, unseal, complete,
 *                                      hazard, empty, narrow, falsify, draft, chat)
 *        ...&seek=300                  pause every animation at 300 ms
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice("--out=".length) : ".preview/dex.html");

const mod = (p) => import(pathToFileURL(join(ROOT, p)).href);
const { buildSections } = await mod("scripts/features/pf2e-creaturedex/sections.mjs");
const L = await mod("scripts/features/pf2e-creaturedex/ledger.mjs");
const { dexModel, falsifyModel, noticeModel } = await mod("scripts/features/pf2e-creaturedex/model.mjs");
const R = await mod("scripts/features/pf2e-creaturedex/render.mjs");
const { doctorSection } = await mod("scripts/features/pf2e-creaturedex/rules.mjs");

const LANG = JSON.parse(readFileSync(join(ROOT, "lang/pf2e-creaturedex.en.json"), "utf8"));
const t = (key, data) => {
  const s = LANG[key] ?? key;
  return data ? s.replace(/\{(\w+)\}/g, (m, k) => (k in data ? String(data[k]) : m)) : s;
};
const ctx = { t, enrich: async (html) => String(html ?? "") };

/* ── fixtures: plain objects shaped like PF2e actors ─────────────────────── */

const portrait = (a, b, glyph) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="g" cx=".5" cy=".35" r=".8"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient></defs>` +
      `<rect width="64" height="64" fill="url(#g)"/><path d="${glyph}" fill="rgba(0,0,0,.55)"/></svg>`
  );
const BEAST = "M10 56c4-14 10-22 22-24-6-4-8-10-6-16 4 4 8 5 12 4 6-1 10 3 12 8 2 6-1 12-6 15 6 3 9 8 10 13z";
const FIGURE = "M20 64c0-14 4-22 12-24-5-3-7-8-6-13 1-6 6-9 11-8 6 1 9 7 8 13-1 4-3 7-6 9 8 2 12 10 12 23z";
const ARCH = "M6 64V30c0-12 12-20 26-20s26 8 26 20v34H46V34c0-7-6-12-14-12s-14 5-14 12v30z";

const ability = (name, category, html, { actionType = "action", actions = 1, traits = [] } = {}) => ({
  name,
  system: { category, actionType: { value: actionType }, actions: { value: actions }, traits: { value: traits }, description: { value: html } },
});

const DRAKE = {
  type: "npc",
  name: "Mire Drake",
  img: portrait("#4c6b5a", "#0d1612", BEAST),
  uuid: "Actor.mire",
  system: {
    details: { level: { value: 5 }, languages: { value: ["Aklo", "Draconic"] } },
    traits: { rarity: "uncommon", size: { value: "lg" }, value: ["amphibious", "dragon"] },
    perception: { mod: 12, senses: [{ type: "darkvision" }, { type: "scent (imprecise) 30 feet" }] },
    skills: { athletics: { base: 14 }, stealth: { base: 11 }, survival: { base: 10 } },
    abilities: { str: { mod: 5 }, dex: { mod: 2 }, con: { mod: 4 }, int: { mod: -2 }, wis: { mod: 1 }, cha: { mod: 0 } },
    saves: { fortitude: { value: 14 }, reflex: { value: 10 }, will: { value: 8 } },
    attributes: {
      ac: { value: 21 },
      hp: { max: 90 },
      speed: { value: 30, otherSpeeds: [{ type: "swim", value: 40 }] },
      immunities: [{ type: "acid" }, { type: "paralyzed" }],
      weaknesses: [{ type: "cold", value: 5 }],
      resistances: [{ type: "piercing", value: 3 }],
    },
  },
  itemTypes: {
    action: [
      ability("Marsh Sense", "interaction", "<p>It knows the shape of any creature standing in water within 60 feet.</p>", { actionType: "passive" }),
      ability("Thick Hide", "defensive", "<p>Reduce the first slashing damage it takes each round by 3.</p>", { actionType: "passive" }),
      ability("Reactive Strike", "defensive", "<p>Trigger: a creature within reach uses a manipulate or move action. It makes a jaws Strike.</p>", { actionType: "reaction" }),
      ability("Bog Breath", "offensive", "<p>A 30-foot cone of reeking acid. <strong>DC 22 basic Reflex</strong>, 6d6 acid. It can't use Bog Breath again for 1d4 rounds.</p>", { actions: 2, traits: ["acid", "arcane"] }),
      ability("Drag Under", null, "<p>Swallows a grabbed creature into the silt beneath the water.</p>", { actions: 1, traits: ["attack"] }),
    ],
    melee: [
      { name: "jaws", system: { bonus: { value: 15 }, damageRolls: { a: { damage: "2d8+7", damageType: "piercing" } }, traits: { value: ["reach 10 feet"] }, attackEffects: { value: ["grab"] } } },
      { name: "spit", system: { range: { increment: 30 }, bonus: { value: 13 }, damageRolls: { a: { damage: "2d6", damageType: "acid" } }, traits: { value: [] } } },
    ],
    spellcastingEntry: [{ id: "inn", name: "Primal Innate Spells", system: { prepared: { value: "innate" }, spelldc: { dc: 22, value: 14 }, tradition: { value: "primal" } } }],
    spell: [
      { name: "hydraulic push", system: { location: { value: "inn" }, level: { value: 3 }, traits: { value: [] } } },
      { name: "gouging claw", system: { location: { value: "inn" }, level: { value: 1 }, traits: { value: ["cantrip"] } } },
    ],
  },
  items: [],
};

const KEEPER = {
  type: "npc",
  name: "Toll-Keeper",
  img: portrait("#6b5a7a", "#120d18", FIGURE),
  uuid: "Actor.toll",
  system: {
    details: { level: { value: 3 }, languages: { value: ["Common"] } },
    traits: { rarity: "common", size: { value: "med" }, value: ["human", "humanoid"] },
    perception: { mod: 9 },
    skills: { intimidation: { base: 10 }, society: { base: 8 } },
    abilities: { str: { mod: 3 }, dex: { mod: 1 }, con: { mod: 2 }, int: { mod: 1 }, wis: { mod: 2 }, cha: { mod: 3 } },
    saves: { fortitude: { value: 9 }, reflex: { value: 6 }, will: { value: 10 } },
    attributes: { ac: { value: 18 }, hp: { max: 45 }, speed: { value: 25 } },
  },
  itemTypes: {
    action: [
      ability("Exact the Toll", "interaction", "<p>Names a price. A creature that refuses is off-guard to it until it next pays.</p>", { actions: 1 }),
      ability("Lantern Ward", "defensive", "<p>Gains a +2 circumstance bonus to AC against creatures in its lantern's light.</p>", { actionType: "passive" }),
      ability("Sweep", "offensive", "<p>Strikes twice with its pike against two different creatures.</p>", { actions: 2 }),
      ability("Ledger of Debts", null, "<p>Once per day, names one creature that owes it. That creature is frightened 1.</p>", { actions: 1, traits: ["mental"] }),
    ],
    melee: [{ name: "pike", system: { bonus: { value: 11 }, damageRolls: { a: { damage: "1d10+5", damageType: "piercing" } }, traits: { value: ["reach"] } } }],
  },
  items: [{ type: "weapon", name: "pike", system: { quantity: 1 } }, { type: "equipment", name: "iron lantern", system: { quantity: 1 } }],
};

const BRIDGE = {
  type: "hazard",
  name: "Collapsing Bridge",
  img: portrait("#6a5a44", "#14100a", ARCH),
  uuid: "Actor.bridge",
  system: {
    details: {
      level: { value: 2 },
      isComplex: false,
      description: "<p>Rotten planks over a forty-foot drop.</p>",
      disable: "<p>Athletics DC 18 to brace the span, or Crafting DC 20 to shore it.</p>",
      routine: "<p>The span gives way. Everyone on it falls.</p>",
      reset: "The bridge must be rebuilt.",
    },
    traits: { rarity: "common", value: ["environmental", "trap"] },
    attributes: { ac: { value: 16 }, hp: { max: 30 }, hardness: 5, stealth: { value: 10, details: "(trained)" } },
    saves: { fortitude: { value: 10 }, reflex: { value: 4 } },
  },
  itemTypes: { action: [ability("Give Way", null, "<p><strong>Trigger</strong> More than 100 Bulk crosses the center.</p>", { actionType: "reaction" })] },
  items: [],
};

const SHELF = ["Barrow Wight", "Cinder Imp", "Fen Hag", "Glass Serpent", "Hollow Knight", "Lamp Moth"].map((name, i) => ({
  type: "npc",
  name,
  img: portrait(["#5a4a6b", "#6b4a4a", "#4a5a6b", "#4a6b6b", "#5a5a5a", "#6b6b4a"][i], "#0a0a0f", i % 2 ? BEAST : FIGURE),
  uuid: `Actor.s${i}`,
  system: {
    details: { level: { value: i + 1 } },
    traits: { rarity: "common", value: ["beast"] },
    perception: { mod: 6 + i },
    saves: { fortitude: { value: 8 } },
    attributes: { ac: { value: 15 + i }, hp: { max: 20 + i * 10 }, speed: { value: 25 } },
    abilities: {},
  },
  itemTypes: { action: [], melee: [{ name: "claw", system: { bonus: { value: 8 + i }, damageRolls: { a: { damage: "1d6+3", damageType: "slashing" } }, traits: { value: [] } } }] },
  items: [],
}));

const PCS = [
  { id: "seri", name: "Seri Voss" },
  { id: "brack", name: "Brack" },
  { id: "ondine", name: "Ondine" },
];
const ALL = PCS.map((p) => p.id);

const snap = (actor) => {
  const { kind, sections, deferred } = buildSections(actor);
  const available = sections.map((s) => s.key);
  return {
    snapshots: Object.fromEntries(sections.map((s) => [s.key, s])),
    meta: { name: actor.name, img: actor.img, kind, available, uuid: actor.uuid, deferred },
  };
};
const key = (a) => `slug.${a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${a.system.details.level.value}`;

/* ── the dex: built by the real writes, in the order a table would ───────── */

function reveal(data, actor, owners, sections, party) {
  const s = snap(actor);
  return L.applyReveal(data, key(actor), owners, sections, s.snapshots, s.meta, party) ?? data;
}

function buildDex(party) {
  let d = {};
  d = reveal(d, DRAKE, ALL, ["characteristics"], party);
  // Defense, told to the whole party as a lie: the doctored truth.
  const truth = snap(DRAKE);
  let seed = 11;
  const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const lie = doctorSection(truth.snapshots.defense, { rng });
  d = L.applyFalse(d, key(DRAKE), ALL, "defense", lie, null, truth.meta, party) ?? d;
  d = reveal(d, KEEPER, ALL, ["characteristics", "defense", "offense"], party);
  d = reveal(d, BRIDGE, ["seri"], ["complexity", "disable"], party);
  SHELF.forEach((a, i) => {
    d = reveal(d, a, ALL, ["characteristics", "defense", "offense"].slice(0, (i % 3) + 1), party);
  });
  return d;
}

const DEX = buildDex(true);
const DEX_SOLO = buildDex(false);

async function windowFrame(id, label, model, { width = 780, height = 700 } = {}) {
  await R.prepareDetail(model.detail, ctx);
  return frame(
    id,
    label,
    `<div class="application gldex gldex-app preview-window" style="width:${width}px;height:${height}px">` +
      `<header class="window-header"><i class="window-icon fa-solid fa-book-skull"></i><h1 class="window-title">${t("GLDEX.app.title")}</h1></header>` +
      `<section class="window-content">${R.dexHTML(model, { t })}</section></div>`
  );
}

const frame = (id, label, body) =>
  `<figure class="preview-frame" data-frame="${id}"><figcaption class="preview-label">${label}</figcaption>${body}</figure>`;

const frames = [];

frames.push(
  await windowFrame(
    "player",
    "Player · Party knowledge · Defense is a lie (they cannot tell) · Offense sealed",
    dexModel({ data: DEX, isGM: false, party: true, characters: [PCS[0]], subject: key(DRAKE) })
  )
);

frames.push(
  await windowFrame(
    "gm",
    "GM · per-character picker · the lie labelled · three controls per section",
    dexModel({
      data: DEX_SOLO,
      isGM: true,
      party: false,
      characters: PCS,
      ownerId: "party",
      subject: key(DRAKE),
      live: { deferredCount: 1 },
    })
  )
);

frames.push(
  await windowFrame(
    "unseal",
    "Player · Offense learned while the window is open (seek=300 freezes the unseal)",
    dexModel({
      data: reveal(DEX, DRAKE, ALL, ["offense"], true),
      isGM: false,
      party: true,
      characters: [PCS[0]],
      subject: key(DRAKE),
      fresh: ["offense"],
    })
  )
);

frames.push(
  await windowFrame(
    "complete",
    "Player · a true completion prints the held-back abilities",
    dexModel({ data: DEX, isGM: false, party: true, characters: [PCS[0]], subject: key(KEEPER) })
  )
);

frames.push(
  await windowFrame(
    "hazard",
    "Player · two characters, Party knowledge off · a hazard",
    dexModel({ data: DEX_SOLO, isGM: false, party: false, characters: PCS.slice(0, 2), ownerId: "seri", subject: key(BRIDGE) })
  )
);

frames.push(await windowFrame("empty", "Player · nothing learned yet", dexModel({ data: {}, isGM: false, party: true, characters: [PCS[2]] }), { height: 360 }));

frames.push(
  await windowFrame(
    "narrow",
    "Player · a narrow window",
    dexModel({ data: DEX, isGM: false, party: true, characters: [PCS[0]], subject: key(DRAKE), query: "" }),
    { width: 470, height: 700 }
  )
);

/* The Falsify dialog, before and after a draft. */
const drakeTruth = snap(DRAKE).snapshots.defense;
let seed2 = 5;
const rng2 = () => ((seed2 = (seed2 * 1103515245 + 12345) % 2147483648) / 2147483648);
const draft = doctorSection(drakeTruth, { rng: rng2 });
const falsifyCtx = { section: "defense", name: "Mire Drake", toName: "Everyone" };
const dialog = (id, label, m) =>
  frame(
    id,
    label,
    `<div class="application gldex gldex-falsify-app preview-window" style="width:600px">` +
      `<header class="window-header"><i class="window-icon fa-solid fa-mask"></i><h1 class="window-title">${t("GLDEX.falsify.title")}</h1></header>` +
      `<section class="window-content">${R.falsifyHTML(m, { t })}</section></div>`
  );
const candidates = [{ id: "a", name: "Fen Hag", level: 3 }, { id: "b", name: "Toll-Keeper", level: 3 }];
frames.push(dialog("falsify", "Falsify · borrow, before a draft", falsifyModel({ ctx: falsifyCtx, mode: "borrow", candidates, sourceId: "b", truth: drakeTruth })));
frames.push(
  dialog(
    "draft",
    "Falsify · doctored, row by row beside the truth",
    falsifyModel({ ctx: falsifyCtx, mode: "doctor", candidates, draft, truth: drakeTruth, iwr: false })
  )
);

/* Chat notices, at a real chat log's 14px. The last is a card from before the remake. */
const users = [{ id: "gm", isGM: true, owns: [] }, { id: "u1", isGM: false, owns: ["seri"] }];
const notice = (o) => R.noticeHTML(noticeModel({ users, ...o }), { t });
frames.push(
  frame(
    "chat",
    "Reveal notices · a lie posts exactly what a truth posts",
    `<div class="preview-chat">` +
      `<div class="preview-msg">${notice({ section: "offense", subjectName: "Mire Drake", owners: [PCS[0]], everyone: false, party: false })}</div>` +
      `<div class="preview-msg">${notice({ section: "defense", subjectName: "Mire Drake", owners: PCS, everyone: true, party: true })}</div>` +
      `<div class="preview-msg">${notice({ section: "routine", subjectName: "Collapsing Bridge", owners: PCS, everyone: true, party: true, complete: true })}</div>` +
      `<div class="preview-msg"><div class="gldex-card" data-section="characteristics" data-complete="false"><div class="gldex-card-line">Brack learns the Characteristics of Toll-Keeper.</div></div></div>` +
      `</div>`
  )
);

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Creaturedex preview</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<link rel="stylesheet" href="../styles/gl-fonts.css">
<link rel="stylesheet" href="../styles/gl-tokens.css">
<link rel="stylesheet" href="../styles/gl-motion.css">
<link rel="stylesheet" href="../styles/pf2e-creaturedex.css">
<style>
  /* Stand-ins for Foundry's own frame and canvas. Nothing here styles a gldex- class. */
  body { margin:0; padding:24px; background:#1b1d22 radial-gradient(1200px 700px at 30% 20%, #2a2f2a, #121315); color:#ddd;
         font-family:system-ui, sans-serif; display:flex; flex-wrap:wrap; gap:28px; align-items:flex-start; }
  body.only { padding:28px; display:block; }
  body.only .preview-frame:not(.is-only) { display:none; }
  .preview-frame { margin:0; display:flex; flex-direction:column; gap:8px; }
  .preview-label { font:600 10px/1 system-ui, sans-serif; letter-spacing:.1em; text-transform:uppercase; color:#8a8d98; }
  .preview-window { position:relative; display:flex; flex-direction:column; overflow:hidden; }
  .preview-window .window-header { display:flex; align-items:center; gap:8px; height:34px; padding:0 12px; flex:none; }
  .preview-window .window-title { margin:0; border:0; flex:1; }
  .preview-window .window-content { flex:1; min-height:0; display:flex; flex-direction:column; }
  .preview-chat { width:300px; padding:8px; background:#0e0f13; font-size:14px; display:flex; flex-direction:column; gap:8px; }
  .preview-msg { padding:6px; background:#17181d; border:1px solid #26272e; }
</style></head><body>
${frames.join("\n")}
<script>
  const q = new URLSearchParams(location.search);
  const only = q.get("only");
  if (only) {
    document.body.classList.add("only");
    document.querySelector('[data-frame="' + only + '"]')?.classList.add("is-only");
  }
  // The app scrolls a freshly learned plate into view for a player; so does the preview.
  document.querySelectorAll(".gldex-section.is-fresh").forEach((el) => el.scrollIntoView({ block: "nearest" }));
  const seek = q.get("seek");
  if (seek != null) {
    const at = Number(seek) || 0;
    requestAnimationFrame(() => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = at; }));
  }
</script>
</body></html>`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT}`);
