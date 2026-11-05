#!/usr/bin/env node
/**
 * Roll Cards — every state the stream's roll card and status card can be in, side by side.
 *
 * The overlay preview (`tools/stream-preview.mjs`) shows a capture frame with a handful of cards in their
 * stacks. This page is the card gallery behind it: one cell per state (every degree, a blind roll, a
 * pending total, a spell, an action, a plain roll, every quote style, a damage-only card, no art, a
 * reroll, the Daggerheart duality and its tones, and the status card's chips), each the shipped
 * `RollCard` or `StatusCard` over the shipped stylesheets, on a stand-in map.
 *
 * URL parameters:
 *   scale=<n>   the card scale, as `ChatOverlay#applySettings` writes it for a 1920px frame
 *               (default 0.5, the shipped `cardScale`)
 *   play        play every entrance instead of drawing the settled cards
 *   only=<ids>  comma-separated cell ids to draw (the `data-cell` on each cell)
 *   floor=light a light map under the cards instead of the dark one
 *
 * Serve it; a file:// page does not run its module script:
 *
 *   node tools/roll-cards-preview.mjs && node tools/preview-server.mjs 8979
 *   → http://localhost:8979/.preview/roll-cards.html
 *
 * `document.body.dataset.done` is set once every card has settled.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice("--out=".length) : ".preview/roll-cards.html");

const html = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Roll Cards preview</title>
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" href="/styles/stream.css">
<link rel="stylesheet" href="/styles/stream-cards.css">
<link rel="stylesheet" href="/styles/stream-cards-daggerheart.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/pixi.js/7.4.2/pixi.min.js"></script>
<style>
  /* Page chrome only: none of this ships. */
  html, body { margin: 0; }
  body {
    min-height: 100vh; color: #ddd; font: 12px/1.4 system-ui, sans-serif;
    background:
      radial-gradient(40% 38% at 30% 62%, rgb(110 84 50 / .55), transparent 70%),
      radial-gradient(50% 45% at 72% 30%, #3a5230, transparent 75%),
      radial-gradient(90% 80% at 50% 50%, #2c3a24, #121710);
    background-attachment: fixed;
  }
  body.pv-light { background: radial-gradient(90% 80% at 50% 50%, #d9cba8, #b7a57c); color: #222; }
  .pv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--pv-col, 300px), 1fr)); gap: 22px 26px; padding: 22px; }
  .pv-cell { min-width: 0; }
  .pv-cap { margin: 0 0 6px; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; opacity: .75; }
  .pv-stack { display: grid; gap: 6px; justify-items: start; }
</style></head>
<body>
<script type="module">
import { RollCard } from "/scripts/features/stream-cards/cards/roll-card.js";
import { StatusCard } from "/scripts/features/stream-cards/cards/status-card.js";

const qs = new URLSearchParams(location.search);
const scale = Number(qs.get("scale")) || 0.5;
const play = qs.has("play");
const only = qs.get("only")?.split(",").filter(Boolean) ?? null;
if (qs.get("floor") === "light") document.body.classList.add("pv-light");
document.body.style.setProperty("--glus-rc-scale", String(scale));
document.body.style.setProperty("--pv-col", Math.max(220, 28 * 19.2 * scale + 20) + "px");

/* Portraits are drawn here, never shipped art. */
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
  ogre: portrait("#4a5a2a", "#151a0c", "#8f9a5a", "#2a2e18")
};

const pc = (name, player, img) => ({ actor: { name, isNpc: false, img, imgKind: "portrait", focus: null }, player: { name: player } });
const npc = (name, img, badgeKey) => ({ actor: { name, isNpc: true, img, imgKind: "portrait", focus: null }, player: null, badgeKey });
const base = { originKey: null, isReroll: false, visibility: "public", target: null, action: null, roll: null, spell: null, damage: null, text: null, fx: null };
const check = (who, action, roll, extra = {}) => ({ ...base, ...who, kind: "check", action: { label: null, labelKey: null, sub: null, map: 0, ...action }, roll, ...extra });
const SERI = pc("Seri Valen", "Mint", ART.seri);
const BRAM = pc("Bram Holt", "Tee", ART.bram);
const JO = pc("Jo", "Jo", ART.jo);
const OGRE = npc("Ogre Warrior", ART.ogre);
const NOART = pc("Wren of the Hollow Oak", "Pim", null);
const say = (who, style, body, runs) => ({ ...base, ...who, kind: "text", action: { labelKey: { speech: "Says", emote: "Emotes", thought: "Thinks", narration: "Narration", ooc: "OutOfCharacter" }[style] }, text: { style, body, runs } });
const dh = (who, out, hope, fear, extra = {}) => ({
  ...base, ...who, kind: "check", tone: out === "crit" ? "crit-success" : out === "none" ? "none" : out,
  action: { label: "Agility", sub: "Sneak past" },
  roll: { total: hope + fear + 2, outcomeKey: { hope: "WithHope", fear: "WithFear", crit: "Critical", none: null }[out], dc: 14, dcVisible: true },
  duality: { hope, fear, hopeDie: "d12", fearDie: "d12", out }, ...extra
});
const status = (key, actor, changes) => ({ status: { key, actor, changes } });
const chg = (id, name, direction, value = null, kind = "condition") => ({ id, slug: id, name, kind, img: null, value, direction, eased: false });

const CELLS = [
  ["crit", "Critical success, crack and crit damage", { model: check(SERI, { label: "Strike: Longsword" }, { natural: 20, total: 31, dc: 17, dcVisible: true, degree: 3 }, { target: { name: "Ogre Warrior" }, fx: "gold" }),
    damage: { total: 22, crit: true, parts: [{ type: "slashing", amount: 18 }, { type: "fire", amount: 4 }] } }],
  ["success", "Success against a DC", { model: check(JO, { label: "Athletics", sub: "Grapple" }, { natural: 14, total: 23, dc: 19, dcVisible: true, degree: 2 }, { target: { name: "Ogre Warrior" } }) }],
  ["failure", "Failure, multiple attack", { model: check(BRAM, { label: "Strike: Maul", map: "−5" }, { natural: 9, total: 15, dc: 21, dcVisible: true, degree: 1 }, { target: { name: "Ogre Warrior" } }) }],
  ["fumble", "Critical failure, NPC, crack", { model: check(OGRE, { label: "Strike: Ogre Hook" }, { natural: 1, total: 9, dc: null, dcVisible: false, degree: 0 }, { target: { name: "Bram Holt" }, fx: "red" }) }],
  ["blind", "A player's own blind roll", { model: check(SERI, { label: "Recall Knowledge", sub: "Arcana" }, { natural: 20, total: null, dc: null, dcVisible: false, degree: null }, { visibility: "ownBlind", fx: "gold" }) }],
  ["pending", "Total still counting", { pending: true, model: check(JO, { label: "Stealth" }, { natural: 12, total: 19, dc: 18, dcVisible: true, degree: 2 }) }],
  ["lean", "No DC, no degree", { model: check(BRAM, { labelKey: "Initiative", sub: "Perception" }, { natural: 11, total: 17, dc: null, dcVisible: false, degree: null }) }],
  ["reroll", "A reroll", { reroll: true, model: check(SERI, { label: "Will Save", sub: "Fear" }, { natural: 17, total: 24, dc: 20, dcVisible: true, degree: 2 }) }],
  ["cast", "A spell cast", { model: { ...base, ...SERI, kind: "cast", spell: { name: "Fireball", rank: 3, tradition: "arcane", dc: 24, save: { statistic: "reflex", basic: true } } } }],
  ["action", "An action from a sheet", { model: { ...base, ...JO, kind: "action", action: { label: "Demoralize", cost: { value: 1 } } } }],
  ["roll", "A plain roll", { model: { ...base, ...BRAM, kind: "roll", action: { labelKey: "PlainRoll" }, roll: { total: 11, formula: "2d6+3", natural: null } } }],
  ["damage", "Damage with no attack card", { model: { ...base, ...OGRE, kind: "damage", damage: { total: 14, crit: false, parts: [{ type: "bludgeoning", amount: 10 }, { type: "cold", amount: 4 }] } } }],
  ["noart", "No art: the monogram", { model: check(NOART, { label: "Nature" }, { natural: 8, total: 18, dc: 15, dcVisible: true, degree: 2 }) }],
  ["speech", "Speech with an aside", { model: say(SERI, "speech", "Hold the line! draws her blade Run!", [{ text: "Hold the line!" }, { text: "draws her blade", aside: true, closes: true, opens: true }, { text: "Run!" }]) }],
  ["emote", "An emote", { model: say(BRAM, "emote", "leans on the maul and laughs.") }],
  ["thought", "A thought", { model: say(JO, "thought", "If the ogre turns now, we are all done for.") }],
  ["narration", "Narration", { model: say({ actor: { name: "Narrator", isNpc: false, img: null }, player: null }, "narration", "The archive doors groan open.") }],
  ["ooc", "Out of character", { model: say(JO, "ooc", "brb, getting snacks") }],
  ["dh-hope", "Daggerheart: with Hope", { model: dh(SERI, "hope", 9, 4) }],
  ["dh-fear", "Daggerheart: with Fear, the GM took it", { model: dh(BRAM, "fear", 3, 11, { chips: [{ id: "fear", labelKey: "PlusFear" }] }) }],
  ["dh-crit", "Daggerheart: critical", { model: dh(JO, "crit", 7, 7, { fx: "gold" }), damage: { total: 19, crit: true, critKey: "CritMax", parts: [{ type: "magic", label: "magic", icon: "wand-sparkles", amount: 19 }] } }],
  ["dh-react", "Daggerheart: reaction roll", { model: dh(SERI, "none", 5, 8, { action: { labelKey: "ReactionRoll" } }) }],
  ["dh-hit", "Daggerheart: adversary hit", { model: check(npc("Cave Ogre", ART.ogre, "Adversary"), { label: "Club" }, { natural: 16, total: 21, dc: 12, dcKey: "Evasion", dcVisible: true, outcomeKey: "Hit" }, { tone: "hit", target: { name: "Seri Valen" } }) }],
  ["dh-miss", "Daggerheart: adversary miss", { model: check(npc("Cave Ogre", ART.ogre, "Adversary"), { label: "Club" }, { natural: 4, total: 9, dc: 12, dcKey: "Evasion", dcVisible: true, outcomeKey: "Miss" }, { tone: "miss", target: { name: "Seri Valen" } }) }],
  ["status-npc", "Status: conditions arriving on an NPC", status("ogre", OGRE.actor, [chg("off-guard", "Off-Guard", "gained"), chg("frightened", "Frightened", "gained", 2)])],
  ["status-clear", "Status: easing and ending", status("seri", SERI.actor, [chg("frightened", "Frightened", "lowered", 1), chg("prone", "Prone", "lost")])],
  ["status-effect", "Status: an effect, no art", status("wren", NOART.actor, [chg("inspire", "Courageous Anthem", "gained", null, "effect")])]
];

const grid = document.createElement("div");
grid.className = "pv-grid";
document.body.append(grid);

const label = () => null;
const settle = async (card, spec) => {
  if (play) {
    await card.enter();
    if (spec.damage) await card.addDamage(spec.damage);
    return;
  }
  if (!card.setPending) return;
  card.setPending(!!spec.pending);
  const total = card.element.querySelector(".glus-rc-total");
  if (total) total.textContent = card.headlineValue();
  if (!spec.pending && spec.model.fx) card.climax();
  if (spec.reroll) await card.update(spec.model, { reroll: true });
  if (spec.damage) {
    await card.addDamage(spec.damage);
    // The count-up may still be ticking; land it on the real total once it has stopped.
    await new Promise((r) => setTimeout(r, 1500));
    const t = card.element.querySelector(".glus-rc-damage-total");
    if (t) t.textContent = spec.damage.total;
  }
};

await Promise.all(CELLS.filter(([id]) => !only || only.includes(id)).map(async ([id, caption, spec]) => {
  const cell = document.createElement("section");
  cell.className = "pv-cell";
  cell.dataset.cell = id;
  cell.innerHTML = '<p class="pv-cap"></p><div class="pv-stack"></div>';
  cell.querySelector(".pv-cap").textContent = caption;
  grid.append(cell);
  const card = spec.status ? new StatusCard(spec.status, { label }) : new RollCard(spec.model, { label });
  cell.querySelector(".pv-stack").append(card.element);
  await settle(card, spec);
}));
document.body.dataset.done = "";
</script>
</body></html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log("wrote " + OUT);
