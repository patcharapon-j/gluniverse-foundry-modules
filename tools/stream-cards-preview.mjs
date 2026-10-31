#!/usr/bin/env node
/**
 * Stream cards — a browser-backed look at every card kind the PF2e stream draws.
 *
 * The page IMPORTS the shipped `RollCard` and `StatusCard` and links the shipped
 * stylesheets (gl-fonts, gl-tokens, gl-motion, stream, stream-cards), so what you
 * judge is what ships. The models are hand-built in the shape the PF2e readers
 * hand over (see `pf2e/read-message.js` and `pf2e/read-status.js`); nothing here
 * restates a card's markup or its motion.
 *
 * What it shows:
 *   • checks at every degree: a critical success with its damage merged under it,
 *     a success, a failure, and an NPC's critical failure;
 *   • a saving throw, a spell cast, an action, two plain rolls (one with a natural
 *     d20, one without);
 *   • every quote style: speech, emote, ooc, and the two narrated styles the
 *     Roleplay Chat feature emits, thought and narration;
 *   • a player's own blind roll, a creature with no art (the monogram);
 *   • a status card with one chip and with three;
 *   • the wrapper a cloned chat card gets on a non-PF2e world, around a stand-in
 *     for Foundry's own chat message;
 *   • Daggerheart: a roll With Hope, one With Fear (the "+1 Fear" chip arrives
 *     after it lands, as the GM's claim does), a critical, a reaction, an attack
 *     with its damage merged under it, an adversary's hit and miss, a posted
 *     feature with its price, and typed Say, Do and Think lines. These are NOT
 *     hand-built: each is a real-shaped message from
 *     `tests/fixtures/daggerheart/messages.mjs` (the same ones the tests read)
 *     put through the shipped Daggerheart reader, so the page shows what the
 *     reader decides.
 *
 * URL parameters:
 *   still        the settled final state: no entrance, crits already cracked,
 *                damage already merged (the crit row still drops in once)
 *   scale=<n>    the overlay's card scale (`--glus-rc-scale`); 0.5 is the shipped
 *                default at 1080p, 1 is the design size. Default 1.
 *   bg=bright    a pale floor instead of the dark map, to judge the glass
 *   only=dh      the Daggerheart columns alone
 *
 * The crit crack is the real shader through the real renderer, which needs PIXI
 * v7 the way Foundry provides it. The page loads it from cdnjs (as the Theatre
 * preview does); offline, the crack stands down to its glow, exactly as it does
 * on a client with no WebGL, and the page says so.
 *
 * Serve it — a file:// page does not run its module script:
 *
 *   node tools/stream-cards-preview.mjs && node tools/preview-server.mjs 8962
 *   → http://localhost:8962/.preview/stream-cards.html?still&scale=0.5
 *
 * `document.body.dataset.done` is set once every card has finished arriving.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice("--out=".length) : ".preview/stream-cards.html");

const html = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Stream cards — preview</title>
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" href="/styles/stream.css">
<link rel="stylesheet" href="/styles/stream-cards.css">
<link rel="stylesheet" href="/styles/stream-cards-daggerheart.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/pixi.js/7.4.2/pixi.min.js"></script>
<style>
  /* Page chrome only: none of this ships. */
  html, body { margin: 0; }
  body {
    min-height: 100vh; box-sizing: border-box; padding: 22px 24px 40px;
    color: var(--gl-text); font: 13px/1.4 "Google Sans Flex", system-ui, sans-serif;
    background:
      radial-gradient(60% 50% at 25% 70%, rgb(92 72 44 / .45), transparent 70%),
      radial-gradient(70% 60% at 75% 25%, #33452c, transparent 75%),
      radial-gradient(90% 80% at 50% 50%, #26331f, #10150e);
  }
  body[data-bg="bright"] { background: linear-gradient(135deg, #cfc6ad, #e9e3d2 55%, #b9c4b0); }
  .pv-head { display: flex; gap: 18px; align-items: baseline; margin: 0 0 16px; }
  .pv-head h1 { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--gl-text-dim); }
  .pv-note { color: var(--gl-text-dim); }
  body[data-bg="bright"] .pv-head h1, body[data-bg="bright"] .pv-note, body[data-bg="bright"] .pv-col h2 { color: #3b4250; }
  .pv-grid { display: flex; flex-wrap: wrap; gap: 26px 34px; align-items: flex-start; }
  .pv-col h2 { margin: 0 0 8px; font-size: 11px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--gl-text-dim); }
  /* The overlay root, released from its fixed corner so each column flows. */
  .pv-col .gluniverse-stream-chat-root { position: relative; top: auto; left: auto; width: auto; max-width: none; transform: none; }
  /* A stand-in for Foundry's own chat message inside the cloned-card wrapper. */
  .pv-msg { padding: 8px 10px 10px; background: #1a1b23; color: #d6d8e0; font: 13px/1.4 "Segoe UI", sans-serif; }
  .pv-msg header { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
  .pv-msg header b { color: #fff; }
  .pv-msg header time { margin-left: auto; font-size: 11px; color: #7d8292; }
  .pv-msg .dice { margin-top: 6px; padding: 6px; text-align: center; font-size: 20px; font-weight: 700; background: #23242e; border: 1px solid #34374a; border-radius: 3px; }
  .pv-section { margin: 30px 0 10px; font-size: 12px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--gl-text-dim); }
  body[data-only="dh"] .pv-pf2e { display: none; }
  body[data-only="dh"] .pv-section { margin-top: 0; }
</style></head>
<body>
<div class="pv-head"><h1>Stream cards</h1><span class="pv-note" id="note"></span></div>
<div class="pv-grid pv-pf2e">
  <div class="pv-col"><h2>Checks and saves</h2><div class="gluniverse-stream-chat-root position-top-left" id="col-checks"></div></div>
  <div class="pv-col"><h2>Casts, actions, rolls, blind, no art</h2><div class="gluniverse-stream-chat-root position-top-left" id="col-other"></div></div>
  <div class="pv-col"><h2>Chat text</h2><div class="gluniverse-stream-chat-root position-top-left" id="col-text"></div></div>
  <div class="pv-col"><h2>Status cards · cloned chat card (non-PF2e)</h2><div class="gluniverse-stream-chat-root position-top-left" id="col-status"></div></div>
</div>
<h2 class="pv-section">Daggerheart · real messages through the shipped reader</h2>
<div class="pv-grid">
  <div class="pv-col"><h2>Duality rolls</h2><div class="gluniverse-stream-chat-root position-top-left" id="col-dh-duality"></div></div>
  <div class="pv-col"><h2>Attack and damage · adversary</h2><div class="gluniverse-stream-chat-root position-top-left" id="col-dh-attack"></div></div>
  <div class="pv-col"><h2>Feature · typed lines</h2><div class="gluniverse-stream-chat-root position-top-left" id="col-dh-other"></div></div>
</div>
<script type="module">
import { RollCard } from "/scripts/features/stream-cards/cards/roll-card.js";
import { StatusCard } from "/scripts/features/stream-cards/cards/status-card.js";
import { readMessage as readDaggerheart } from "/scripts/features/stream-cards/daggerheart/read-message.js";
import * as DH from "/tests/fixtures/daggerheart/messages.mjs";

const qs = new URLSearchParams(location.search);
const still = qs.has("still");
const scale = Number(qs.get("scale")) || 1;
if (qs.get("bg") === "bright") document.body.dataset.bg = "bright";
if (qs.get("only") === "dh") document.body.dataset.only = "dh";
document.documentElement.style.setProperty("--glus-rc-scale", String(scale));
document.getElementById("note").textContent =
  "scale " + scale + (still ? " · still" : " · live entrance") +
  (globalThis.PIXI ? " · crack: PIXI " + PIXI.VERSION : " · crack: PIXI unavailable, glow only");

/* Portraits are drawn here, never shipped art: a gradient field, a head and shoulders. */
const portrait = (a, b, skin, hair) => "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
  '<stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient></defs>' +
  '<rect width="200" height="200" fill="url(#g)"/><path d="M40 200c4-46 30-70 60-70s56 24 60 70z" fill="' + skin + '" opacity=".9"/>' +
  '<ellipse cx="100" cy="84" rx="34" ry="40" fill="' + skin + '"/>' +
  '<path d="M64 80c0-30 18-46 38-46s36 16 36 44c-8-14-22-20-36-20s-28 8-38 22z" fill="' + hair + '"/></svg>');
const ART = {
  seri: portrait("#3b5b8c", "#141c2c", "#e2b48f", "#2a1a12"),
  bram: portrait("#7a3d2a", "#1f120d", "#c08a65", "#5a3a1c"),
  jo: portrait("#2d6b5f", "#0e1f1c", "#d9a785", "#c9c1b0"),
  ogre: portrait("#4a5a2a", "#151a0c", "#8f9a5a", "#2a2e18"),
  mira: portrait("#5b3b7c", "#1a1226", "#e8c2a0", "#d9b25a")
};
const icon = (glyph, hue) => "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="' + hue + '" opacity=".85"/>' +
  '<text x="16" y="21" text-anchor="middle" font-size="15" font-family="sans-serif" font-weight="700" fill="#111">' + glyph + '</text></svg>');

const pc = (name, player, img, imgKind = "portrait") => ({ actor: { name, isNpc: false, img, imgKind, focus: null }, player: { name: player } });
const npc = (name, img, imgKind = "token") => ({ actor: { name, isNpc: true, img, imgKind, focus: null }, player: null });
const SERI = pc("Seri Valen", "Mint", ART.seri);
const BRAM = pc("Bram Holt", "Tee", ART.bram);
const JO = pc("Jo", "Jo", ART.jo);
const MIRA = pc("Mira Ashgrove", "Pat", ART.mira);
const OGRE = npc("Ogre Warrior", ART.ogre, "portrait");

const base = { originKey: null, isReroll: false, visibility: "public", target: null, action: null, roll: null, spell: null, damage: null, text: null, fx: null };
const model = (who, fields) => ({ ...base, ...who, ...fields });
const check = (who, action, roll, extra = {}) =>
  model(who, { kind: "check", action: { label: null, labelKey: null, sub: null, map: 0, ...action }, roll: { formula: undefined, ...roll }, ...extra });
const text = (who, labelKey, style, body) => model(who, { kind: "text", action: { label: null, labelKey, sub: null, map: 0 }, text: { body, style } });

const CARDS = {
  checks: [
    { model: check(SERI, { label: "Strike: Longsword" }, { natural: 20, total: 31, dc: 17, dcVisible: true, degree: 3 }, { target: { name: "Ogre Warrior" }, fx: "gold" }),
      damage: { total: 22, crit: true, parts: [{ type: "slashing", amount: 18 }, { type: "fire", amount: 4 }] } },
    { model: check(JO, { label: "Athletics", sub: "Grapple" }, { natural: 14, total: 23, dc: 19, dcVisible: true, degree: 2 }, { target: { name: "Ogre Warrior" } }) },
    { model: check(BRAM, { label: "Stealth" }, { natural: 6, total: 15, dc: 18, dcVisible: true, degree: 1 }) },
    { model: check(OGRE, { label: "Strike: Ogre Hook" }, { natural: 1, total: 9, dc: null, dcVisible: false, degree: 0 }, { target: { name: "Bram Holt" }, fx: "red" }) },
    { model: check(BRAM, { label: "Reflex Save", sub: "Fireball" }, { natural: 12, total: 19, dc: 21, dcVisible: true, degree: 1 }) },
    { model: check(MIRA, { label: "Will Save", sub: "Fear" }, { natural: 17, total: 26, dc: 20, dcVisible: true, degree: 2 }) }
  ],
  other: [
    { model: model(SERI, { kind: "cast", action: { label: "Fireball", labelKey: null, sub: null, map: 0 },
        spell: { name: "Fireball", tradition: "arcane", rank: 3, isCantrip: false, dc: 21, save: { statistic: "reflex", basic: true }, attackBonus: null } }) },
    { model: model(MIRA, { kind: "cast", action: { label: "Divine Lance", labelKey: null, sub: null, map: 0 },
        spell: { name: "Divine Lance", tradition: "divine", rank: 2, isCantrip: true, dc: null, save: null, attackBonus: 14 } }) },
    { model: model(JO, { kind: "action", action: { label: "Sudden Charge", labelKey: null, sub: null, map: 0, cost: { type: "action", value: 2 } } }) },
    { model: check(SERI, { label: null, labelKey: "PlainRoll", sub: "14" }, { natural: 14, total: 21, dc: null, dcVisible: false, degree: null, formula: "1d20+7" }, { kind: "roll" }) },
    { model: check(BRAM, { label: "Healing Potion", sub: "4 · 6" }, { natural: null, total: 13, dc: null, dcVisible: false, degree: null, formula: "2d6+3" }, { kind: "roll" }) },
    { model: model(JO, { kind: "check", visibility: "ownBlind", action: { label: "Recall Knowledge", labelKey: null, sub: "Arcana", map: 0 },
        roll: { natural: null, total: null, dc: null, dcVisible: false, degree: null } }) },
    { model: check(npc("Shrouded Figure", null), { label: "Deception", sub: "Lie" }, { natural: 11, total: 24, dc: null, dcVisible: false, degree: null }) }
  ],
  text: [
    { model: text(BRAM, "Says", "speech", "Hold the line! If that ogre gets past me, run for the bridge.") },
    { model: text(SERI, "Emotes", "emote", "draws her blade and steps between Bram and the ogre.") },
    { model: text(JO, "OutOfCharacter", "ooc", "brb grabbing water, keep going") },
    { model: text(SERI, "Thinks", "thought", "This is a terrible plan.") },
    { model: text({ actor: { name: "Narrator", isNpc: false, img: null, imgKind: "portrait", focus: null }, player: { name: "GM" } }, "Narrates", "narration",
        "The torches gutter as something vast shifts beneath the water.") }
  ]
};

const STATUS = [
  { key: "bram", actor: { name: "Bram Holt", isNpc: false, img: ART.bram, imgKind: "portrait", focus: null },
    changes: [{ id: "a", slug: "frightened", name: "Frightened", kind: "condition", img: null, value: 2, direction: "gained", eased: false }] },
  { key: "ogre", actor: { name: "Ogre Warrior", isNpc: true, img: ART.ogre, imgKind: "portrait", focus: null },
    changes: [
      { id: "b", slug: "off-guard", name: "Off-Guard", kind: "condition", img: icon("!", "#ffb12d"), value: null, direction: "gained", eased: false },
      { id: "c", slug: "frightened", name: "Frightened", kind: "condition", img: null, value: 1, direction: "lowered", eased: true },
      { id: "d", slug: "grabbed", name: "Grabbed", kind: "condition", img: null, value: null, direction: "lost", eased: true }
    ] },
  { key: "shade", actor: { name: "Shrouded Figure", isNpc: true, img: null, imgKind: "token", focus: null },
    changes: [{ id: "e", slug: "bless", name: "Bless", kind: "effect", img: null, value: null, direction: "gained", eased: false }] }
];

/*
 * Daggerheart. Every model is the shipped reader's answer to a fixture message; only the art is swapped
 * for a drawn portrait. A spec's damage is the reader's own damage model for the message that follows
 * the attack, and "later" is the same message after the GM's Fear was claimed onto it.
 */
const dhActor = (fixture, img) => ({ ...fixture, img });
const ARIA = dhActor(DH.ARIA, ART.seri);
const KESS = dhActor(DH.KESS, ART.jo);
const BRUTE = dhActor(DH.BRUTE, ART.ogre);
const read = (snapshot) => {
  const result = readDaggerheart(snapshot);
  if (!result) throw new Error("the Daggerheart reader returned nothing for " + snapshot.raw._id);
  return result;
};
const fearRoll = DH.duality({ h: 3, f: 10, mod: 2, label: "Instinct", actor: KESS, dc: 14 });
const DAGGERHEART = {
  duality: [
    { model: read(DH.duality({ h: 9, f: 4, mod: 2, label: "Agility", actor: ARIA, dc: 12 })) },
    { model: read(fearRoll), later: read(DH.withFlags(fearRoll, { claimed: { fear: true } })) },
    { model: read(DH.duality({ h: 7, f: 7, mod: 3, label: "Presence", actor: ARIA })) },
    { model: read(DH.duality({ h: 8, f: 2, mod: 1, label: "Finesse", actor: KESS, rxn: true, dc: 13 })) }
  ],
  attack: [
    { model: read(DH.duality({ h: 10, f: 6, mod: 2, label: "Longsword", actor: ARIA, attack: true, dc: 13 })),
      damage: read(DH.damage({ rolls: [7, 3], die: "d10", bonus: 3, actor: ARIA })).damage },
    { model: read(DH.duality({ h: 11, f: 11, mod: 2, label: "Arcane Bolt", actor: KESS, attack: true })),
      damage: read(DH.damage({ rolls: [5], die: "d8", bonus: 2, dtype: "magic", crit: true, actor: KESS })).damage },
    { model: read(DH.adversary({ d20: [16], mod: 3, label: "Thorned Fist", actor: BRUTE, target: KESS.name, dc: 11, foeTarget: { isPc: true },
        token: { name: BRUTE.name, textureSrc: BRUTE.img, displayName: 50 } })),
      damage: read(DH.damage({ rolls: [6, 2], die: "d8", bonus: 2, actor: BRUTE, isGM: true })).damage },
    { model: read(DH.adversary({ d20: [4], mod: 3, label: "Thorned Fist", actor: BRUTE, target: ARIA.name, dc: 12, foeTarget: { isPc: true } })) }
  ],
  other: [
    { model: read(DH.feature({ actor: ARIA })) },
    { model: read(DH.feature({ actor: KESS, name: "Cloaked", feature: "", type: "classFeature", actions: [{ kind: "pay-cost", stress: 1 }] })) },
    { model: read(DH.typed({ body: "Stay behind me. Whatever comes out of that door, it answers to me first.", actor: ARIA })) },
    { model: read(DH.typed({ body: "draws her blade and steps into the doorway.", style: 3, rpMode: "do", actor: ARIA })) },
    { model: read(DH.typed({ body: "If this goes wrong, it goes wrong on me.", rpMode: "think", actor: KESS })) }
  ]
};

/* The labels the Roleplay Chat feature will hand over; the card falls back to the key otherwise. */
const LABELS = { Thinks: "Thinks", Narrates: "Narration" };
const label = (key) => LABELS[key];

/** The settled state, reached without the entrance: what a card looks like once it has landed. */
async function settle(card, spec) {
  card.setPending(false);
  const total = card.element.querySelector(".glus-rc-total");
  if (total) total.textContent = card.headlineValue();
  if (spec.later) card.setChips(spec.later);
  // A duality die's two faces are set by its spin, which a still never runs.
  for (const value of card.element.querySelectorAll(".glus-rc-dd-value")) value.textContent = spec.model.duality[value.dataset.side];
  if (spec.model.fx === "gold" || spec.model.fx === "red") card.climax();
  if (!spec.damage) return;
  await card.addDamage(spec.damage);
  // The count-up's last write is a timer; under a virtual-time screenshot budget it can be left mid-count.
  const damageTotal = card.element.querySelector(".glus-rc-damage-total");
  if (damageTotal) damageTotal.textContent = spec.damage.total;
}

async function mountRolls(root, list, offset) {
  // Live, a card joins the stack on its turn and enters at once, as the feed does: appended early it
  // would sit fully drawn until its entrance began.
  const jobs = list.map((spec, i) => new Promise((done) => {
    const card = new RollCard(spec.model, { label });
    if (still) {
      root.append(card.element);
      return settle(card, spec).then(done);
    }
    setTimeout(async () => {
      root.append(card.element);
      await card.enter();
      if (spec.damage) await card.addDamage(spec.damage);
      // The GM's claim lands a moment after the card, as an update to the message it shows.
      if (spec.later) await new Promise((r) => setTimeout(r, 700)).then(() => card.setChips(spec.later));
      done();
    }, offset + i * 220);
  }));
  return Promise.all(jobs);
}

function mountStatus(root, list, offset) {
  return Promise.all(list.map((spec, i) => new Promise((done) => {
    const card = new StatusCard(spec, { label: () => null });
    if (still) {
      root.append(card.element);
      return done();
    }
    setTimeout(() => {
      root.insertBefore(card.element, root.querySelector(".gluniverse-stream-chat-card"));
      card.enter().then(done);
    }, offset + i * 220);
  })));
}

/* The cloned-card wrapper on a non-PF2e world: only the wrapper is ours, the message is Foundry's. */
function mountCloned(root) {
  const card = document.createElement("div");
  card.className = "gluniverse-stream-chat-card chat-popout";
  card.style.width = "calc(22 * 19.2px * var(--glus-rc-scale, 1))";
  card.style.marginLeft = "calc(2.4 * 19.2px * var(--glus-rc-scale, 1))";
  card.innerHTML = '<div class="pv-msg"><header><b>Seri Valen</b><time>now</time></header>Athletics check<div class="dice">17</div></div>';
  root.append(card);
}

const ready = Promise.all([
  mountRolls(document.getElementById("col-checks"), CARDS.checks, 200),
  mountRolls(document.getElementById("col-other"), CARDS.other, 320),
  mountRolls(document.getElementById("col-text"), CARDS.text, 440),
  mountStatus(document.getElementById("col-status"), STATUS, 560),
  mountRolls(document.getElementById("col-dh-duality"), DAGGERHEART.duality, 200),
  mountRolls(document.getElementById("col-dh-attack"), DAGGERHEART.attack, 320),
  mountRolls(document.getElementById("col-dh-other"), DAGGERHEART.other, 440)
]).then(() => { document.body.dataset.done = ""; });
mountCloned(document.getElementById("col-status"));
globalThis.__streamCardsReady = ready;
</script>
</body></html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log("wrote " + OUT);
