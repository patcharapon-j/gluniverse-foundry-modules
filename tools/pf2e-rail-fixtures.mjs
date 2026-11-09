/**
 * tools/pf2e-rail-fixtures.mjs — synthetic rail models for the PF2e HUD.
 *
 * Every state the preview page draws, in exactly the shape the view takes
 * (scripts/features/pf2e-rail/view.mjs). SYNTHETIC: the characters are
 * PF2e's iconics with invented sheets, the rules text is paraphrased, and
 * nothing here was read off a real actor. The art is the PF2e system's own,
 * copied by the preview script from a local install when one exists; with
 * none, `art()` returns null and the rail draws its empty fields.
 *
 * Pure. Each state is `build(art)` → a model; `sk` on a player model is the
 * skill finder's input (skills, the target as the party knows it, pins),
 * which the host turns into `deck.skills` and the finder through
 * scripts/features/pf2e-rail/skill-actions.mjs, exactly as Foundry will.
 */

const party = (art, skip) => [
  { id: "kyra", name: "Kyra", img: art("iconics/Kyra.webp"), hp: [61, 61], ac: 22, hero: [1, 3] },
  { id: "ezren", name: "Ezren", img: art("iconics/Ezren.webp"), hp: [29, 52], temp: 6, ac: 20, hero: [2, 3] },
  { id: "merisiel", name: "Merisiel", img: art("iconics/Merisiel.webp"), hp: [11, 58], ac: 24, hero: [0, 3], note: "Frightened 2" },
  { id: "valeros", name: "Valeros", img: art("iconics/Valeros.webp"), hp: [68, 76], temp: 5, ac: 23, hero: [2, 3] },
].filter((s) => s.id !== skip);

/* ── skills ─────────────────────────────────────────────────────────
   A character's skills as the finder takes them: the sixteen, plus
   Perception and the saves (Seek rolls Perception, Grab an Edge Reflex). */
const SKILL_NAMES = {
  acrobatics: "Acrobatics", arcana: "Arcana", athletics: "Athletics", crafting: "Crafting", deception: "Deception", diplomacy: "Diplomacy",
  intimidation: "Intimidation", medicine: "Medicine", nature: "Nature", occultism: "Occultism", performance: "Performance", religion: "Religion",
  society: "Society", stealth: "Stealth", survival: "Survival", thievery: "Thievery",
};
const skillSet = (ranks, { perception, saves, unarmed }) => {
  const out = {};
  for (const [slug, name] of Object.entries(SKILL_NAMES)) {
    const [rank, mod] = ranks[slug] ?? [0, 1];
    out[slug] = { slug, name, rank, mod, kind: "skill" };
  }
  out.perception = { slug: "perception", name: "Perception", rank: 2, mod: perception };
  for (const [k, v] of Object.entries(saves)) out[k] = { slug: k, name: k[0].toUpperCase() + k.slice(1), rank: 2, mod: v };
  if (unarmed != null) out.unarmed = { slug: "unarmed", name: "Unarmed", rank: 2, mod: unarmed };
  return out;
};

/* The Ogre Warrior as the party knows it: Reflex learned exactly from a
   save, Will narrowed to a range, Fortitude never tested. */
const OGRE = (art) => ({
  name: "Ogre Warrior", img: art("iconics/Ulka.webp"), known: "AC 17 · Ref 16 · Will 13–15",
  defences: { fortitude: null, reflex: 16, will: { lo: 13, hi: 15 }, perception: 17, stealth: null, deception: null },
  recallSkill: "society", recallDC: 18,
});

const ITEMS = (art) => [
  { id: "elixir", name: "Minor Elixir of Life", img: art("equipment/alchemical-items/alchemical-elixirs/elixir-of-life.webp"), cost: 1, qty: 2 },
  { id: "potion", name: "Healing Potion", img: art("equipment/consumables/potions/healing-potion.webp"), cost: 1, qty: 1 },
  { id: "fire", name: "Alchemist's Fire", img: art("equipment/alchemical-items/alchemical-bombs/alchemists-fire.webp"), cost: 1, qty: 3 },
  { id: "smoke", name: "Smokestick", img: art("equipment/alchemical-items/alchemical-tools/smokestick.webp"), cost: 1, qty: 1 },
  { id: "holy", name: "Holy Water", img: art("equipment/consumables/other-consumables/holy-water.webp"), cost: 1, qty: 2 },
  { id: "antidote", name: "Antidote", img: art("equipment/alchemical-items/alchemical-elixirs/antidote.webp"), cost: 1, qty: 1 },
  { id: "scroll", name: "Scroll of Heal", img: art("equipment/consumables/other-consumables/spell-scroll.webp"), cost: 2, qty: 1 },
];

const tabs = (o) => [
  ...(o.spells ? [{ key: "spells", count: o.spells.cards.filter((c) => !c.socket && !c.spent).length }] : []),
  { key: "actions", count: o.actions?.list?.length ?? 0 },
  { key: "skills" },
  { key: "items", count: o.items?.list?.length ?? 0 },
];
const deck = (tab, o) => ({ tab, ...o, tabs: tabs(o) });

const EXPLORE = [{ id: "search", name: "Search", on: true }, { id: "avoid-notice", name: "Avoid Notice" }, { id: "detect-magic", name: "Detect Magic" }, { id: "scout", name: "Scout" }];

/* ── the martial: Valeros, a fighter with a shield, on his turn after one
   Strike — two actions left and the next attack at −5 ── */
function martial(art, o = {}) {
  return {
    role: "player", mode: "encounter",
    turnbar: { mode: "encounter", mine: true, round: 2, economy: { max: 3, spent: 1, reaction: true }, map: 1 },
    plinth: {
      kind: "character", name: "Valeros", sub: "Fighter 5", speed: "25 ft", cutout: art("iconics/ValerosFull.webp"),
      frameable: true, hero: [2, 3], hp: [68, 76], turn: true,
      conds: [{ slug: "off-guard", name: "Off-Guard", icon: art("conditions/off-guard.webp"), tone: "danger" }],
    },
    vitals: {
      ac: 23, hp: { value: 68, max: 76, temp: 5 }, classDC: 21, perception: 12,
      saves: { fortitude: 13, reflex: 11, will: 9 },
      shield: { name: "Steel Shield", hp: 14, max: 20, hardness: 5, bt: 10, ac: 2, raised: false },
    },
    strikes: { list: [
      { id: "longsword", name: "Longsword", img: art("equipment/weapons/longsword.webp"), variants: ["+14", "+9", "+4"], damage: "1d8+4 slashing", critical: "2d8+8 slashing" },
      { id: "shortbow", name: "Shortbow", img: art("equipment/weapons/shortbow.webp"), variants: ["+12", "+7", "+2"], damage: "1d6 piercing", critical: "2d6 piercing", ready: false },
      { id: "fist", name: "Fist", img: art("unarmed-attacks/fist.webp"), variants: ["+12", "+8", "+4"], damage: "1d4+4 bludgeoning", critical: "2d4+8 bludgeoning" },
    ] },
    deck: deck("skills", {
      actions: { toggles: [], list: [
        { id: "sudden-charge", name: "Sudden Charge", cost: 2 },
        { id: "exacting-strike", name: "Exacting Strike", cost: 1 },
        { id: "aoo", name: "Reactive Strike", cost: "r" },
        { id: "shield-block", name: "Shield Block", cost: "r" },
        { id: "intimidating-strike", name: "Intimidating Strike", cost: 2 },
        { id: "power-attack", name: "Power Attack", cost: 2 },
        { id: "knockdown", name: "Knockdown", cost: 2 },
      ] },
      skills: { query: "" },
      items: { list: ITEMS(art) },
    }),
    sk: {
      skills: skillSet({ acrobatics: [1, 10], athletics: [2, 15], intimidation: [2, 13], crafting: [1, 8], diplomacy: [1, 7], medicine: [1, 6], society: [1, 6], survival: [1, 8], stealth: [1, 10] },
        { perception: 12, saves: { fortitude: 13, reflex: 11, will: 9 }, unarmed: 12 }),
      lores: [{ slug: "warfare-lore", name: "Warfare Lore", rank: 1, mod: 8 }],
      target: OGRE(art), pins: ["demoralize"],
    },
    util: {},
    stack: party(art, "valeros"),
    ...o,
  };
}

/* ── the prepared caster: Ezren, wizard 7, waiting for Kyra to finish ── */
const SP = (id, name, rank, cost, extra = {}) => ({ id, name, rank, cost, img: null, ...extra });
function prepared(art, o = {}) {
  const img = (n) => art(`spells/${n}.webp`);
  return {
    role: "player", mode: "encounter",
    turnbar: { mode: "encounter", mine: false, current: "Kyra", round: 2, economy: { max: 3, spent: 0, reaction: true }, map: 0 },
    plinth: { kind: "character", name: "Ezren", sub: "Wizard 7", speed: "25 ft", cutout: art("iconics/EzrenFull.webp"), frameable: true, hero: [1, 3], hp: [29, 52] },
    vitals: { ac: 21, hp: { value: 29, max: 52, temp: 6 }, classDC: 25, perception: 13, saves: { fortitude: 11, reflex: 13, will: 16 } },
    strikes: { list: [
      { id: "staff", name: "Staff", img: art("equipment/weapons/staff.webp"), variants: ["+9", "+4", "−1"], damage: "1d4 bludgeoning", critical: "2d4 bludgeoning" },
    ] },
    deck: deck("spells", {
      spells: {
        rank: 3, dc: 25, atk: 15, focus: [1, 1],
        ranks: [
          { key: "c", cards: 5 }, { key: 1, cards: 3, slots: [2, 3] }, { key: 2, cards: 3, slots: [3, 3] },
          { key: 3, cards: 4, slots: [2, 4] }, { key: 4, cards: 3, slots: [3, 3] }, { key: "f", cards: 1 },
        ],
        cards: [
          SP("electric-arc", "Electric Arc", "c", 2, { img: img("electric-arc") }), SP("tkp", "Telekinetic Projectile", "c", 2, { img: img("telekinetic-projectile") }),
          SP("shield", "Shield", "c", 1, { img: img("shield") }),
          SP("fireball-a", "Fireball", 3, 2, { img: img("fireball"), slot: 0 }), SP("fireball-b", "Fireball", 3, 2, { img: img("fireball"), slot: 1, spent: true }),
          SP("haste", "Haste", 3, 2, { img: img("haste"), slot: 2, spent: true }), SP("slow", "Slow", 3, 2, { img: img("slow"), slot: 3 }),
          SP("mm", "Force Barrage", 1, "1-3", { img: img("magic-missile") }), SP("grease", "Grease", 1, 2, { img: img("grease") }), SP("mm2", "Force Barrage", 1, "1-3", { img: img("magic-missile"), spent: true }),
          SP("invis", "Invisibility", 2, 2, { img: img("invisibility") }), SP("dispel", "Dispel Magic", 2, 2, { img: img("dispel-magic") }), SP("soothe", "Soothe", 2, 2, { img: img("soothe") }),
          SP("lb", "Lightning Bolt", 4, 2, { img: img("lightning-bolt"), heightened: 4 }), SP("fear", "Fear", 4, 2, { img: img("fear"), heightened: 4 }), SP("fb4", "Fireball", 4, 2, { img: img("fireball"), heightened: 4 }),
          SP("force-bolt", "Force Bolt", "f", 1, { img: img("magic-missile") }),
        ],
      },
      actions: { toggles: [], list: [
        { id: "drain", name: "Drain Bonded Item", cost: "f", freq: { used: 0, max: 1, per: "day" } },
        { id: "reach", name: "Reach Spell", cost: 1 },
        { id: "widen", name: "Widen Spell", cost: 1 },
        { id: "counterspell", name: "Counterspell", cost: "r" },
      ] },
      skills: { query: "" },
      items: { list: ITEMS(art).slice(1, 4) },
    }),
    sk: {
      skills: skillSet({ arcana: [3, 17], crafting: [2, 15], occultism: [2, 15], society: [2, 15], nature: [1, 11], religion: [1, 11], diplomacy: [1, 9], medicine: [1, 10] },
        { perception: 13, saves: { fortitude: 11, reflex: 13, will: 16 } }),
      target: OGRE(art), pins: ["recall-knowledge"],
    },
    util: {},
    stack: party(art, "ezren"),
    ...o,
  };
}

/* ── the spontaneous caster: Seoni, exploring; rank 2 with a socket ──── */
function spontaneous(art, o = {}) {
  const base = prepared(art);
  const img = (n) => art(`spells/${n}.webp`);
  const spells = {
    rank: 2, dc: 26, atk: 16, focus: [2, 2],
    ranks: [{ key: "c", cards: 5 }, { key: 1, cards: 4, slots: [4, 4] }, { key: 2, cards: 3, slots: [1, 4] }, { key: 3, cards: 4, slots: [4, 4] }, { key: 4, cards: 2, slots: [2, 3] }, { key: "f", cards: 2 }],
    cards: [
      SP("invis", "Invisibility", 2, 2, { img: img("invisibility") }), SP("blessing", "Blessing of Defiance", 2, 2, { img: img("blessing-of-defiance") }),
      SP("hymn", "Hymn of Healing", 2, 2, { img: img("hymn-of-healing") }), { socket: true, rank: 2, id: "s1" },
    ],
  };
  return {
    ...base, mode: "exploration",
    turnbar: { mode: "exploration", activities: [{ id: "detect-magic", name: "Detect Magic", on: true }, ...EXPLORE.filter((x) => x.id !== "detect-magic").map((x) => ({ ...x, on: false }))] },
    plinth: { kind: "character", name: "Seoni", sub: "Sorcerer 7", speed: "25 ft", cutout: art("iconics/SeoniFull.webp"), frameable: true, hero: [3, 3], hp: [44, 52] },
    vitals: { ac: 21, hp: { value: 44, max: 52 }, classDC: 26, perception: 12, saves: { fortitude: 12, reflex: 13, will: 15 } },
    deck: deck("spells", { ...base.deck, spells }),
    sk: { ...base.sk, target: null },
    stack: party(art, null).slice(0, 3),
    ...o,
  };
}

/* ── the kineticist: Nahoa, Quickened — four actions this turn ───────── */
function kineticist(art, o = {}) {
  return {
    role: "player", mode: "encounter",
    turnbar: { mode: "encounter", mine: true, round: 3, economy: { max: 4, spent: 0, reaction: true, note: "Quickened", tone: "good" }, map: 0 },
    plinth: { kind: "character", name: "Nahoa", sub: "Kineticist 6", speed: "30 ft", cutout: art("iconics/NahoaFull.webp"), frameable: true, hero: [0, 3], hp: [71, 78], turn: true },
    vitals: { ac: 23, hp: { value: 71, max: 78 }, classDC: 24, perception: 13, saves: { fortitude: 15, reflex: 12, will: 11 } },
    strikes: { list: [
      { id: "blast-water", kind: "blast", name: "Elemental Blast · Water", short: "Water", img: art("actions/elemental-blast/water.webp"), variants: ["+15", "+10", "+5"], damage: "2d8+4 bludgeoning", critical: "4d8+8 bludgeoning" },
      { id: "blast-water-r", kind: "blast", name: "Water Blast · Ranged", short: "Water 30 ft", img: art("actions/elemental-blast/water.webp"), variants: ["+15", "+10", "+5"], damage: "2d8 bludgeoning", critical: "4d8 bludgeoning" },
      { id: "fist", name: "Fist", img: art("unarmed-attacks/fist.webp"), variants: ["+12", "+8", "+4"], damage: "1d4+2 bludgeoning", critical: "2d4+4 bludgeoning" },
      { id: "dagger", name: "Dagger", img: art("equipment/weapons/dagger.webp"), variants: ["+12", "+8", "+4"], damage: "1d4+2 piercing", critical: "2d4+4 piercing" },
    ] },
    deck: deck("actions", {
      actions: {
        toggles: [{ id: "aura", label: "Kinetic Aura", on: true }, { id: "overflow", label: "Overflow", on: false }, { id: "two-hand", label: "Two-Element", on: false }],
        list: [
          { id: "channel", name: "Channel Elements", cost: 1 },
          { id: "oceans-balm", name: "Ocean's Balm", cost: 1, freq: { used: 1, max: 1, per: "10 min" } },
          { id: "tidal-hands", name: "Tidal Hands", cost: 2 },
          { id: "shard-strike", name: "Hail of Splinters", cost: 2 },
          { id: "base-kinesis", name: "Base Kinesis", cost: 1 },
          { id: "timber-sentinel", name: "Timber Sentinel", cost: 1 },
          { id: "dash-of-herbs", name: "Dash of Herbs", cost: 1, freq: { used: 0, max: 1, per: "hour" } },
          { id: "stance-kinetic", name: "Aura Junction", stance: true, active: true, cost: 1 },
        ],
      },
      skills: { query: "" },
      items: { list: ITEMS(art).slice(0, 3) },
    }),
    sk: {
      skills: skillSet({ athletics: [2, 14], acrobatics: [1, 11], nature: [2, 12], survival: [1, 10], diplomacy: [1, 8], medicine: [1, 9] },
        { perception: 13, saves: { fortitude: 15, reflex: 12, will: 11 }, unarmed: 12 }),
      target: OGRE(art), pins: [],
    },
    util: {},
    stack: party(art, null).slice(1),
    ...o,
  };
}

/* ── the companion: Droogami, on the slim creature rail ──────────────── */
function companion(art, o = {}) {
  return {
    role: "player", slim: true, mode: "encounter",
    turnbar: { mode: "encounter", mine: false, current: "Lini", round: 1, economy: { max: 2, spent: 0, reaction: false }, map: 0 },
    plinth: { kind: "npc", name: "Droogami", sub: "Snow Leopard · Lini's companion", cutout: art("iconics/DroogamiFull.webp"), frameable: true, hp: [48, 54] },
    vitals: { ac: 22, hp: { value: 48, max: 54 }, perception: 12, saves: { fortitude: 13, reflex: 14, will: 10 } },
    strikes: { list: [
      { id: "jaws", name: "Jaws", img: art("unarmed-attacks/jaws.webp"), variants: ["+13", "+8", "+3"], damage: "1d10+4 piercing", critical: "2d10+8 piercing" },
      { id: "claw", name: "Claw", img: art("unarmed-attacks/claw.webp"), variants: ["+13", "+9", "+5"], damage: "1d6+4 slashing", critical: "2d6+8 slashing" },
    ] },
    deck: deck("actions", { actions: { toggles: [], list: [{ id: "support", name: "Support", cost: 1 }, { id: "pounce", name: "Feline Pounce", cost: 1 }] }, skills: { query: "" }, items: { list: [] } }),
    sk: { skills: skillSet({ acrobatics: [1, 12], athletics: [1, 11], stealth: [2, 14], survival: [1, 9] }, { perception: 12, saves: { fortitude: 13, reflex: 14, will: 10 }, unarmed: 13 }), target: OGRE(art), pins: [] },
    stack: [{ id: "lini", name: "Lini", img: art("iconics/Lini.webp"), hp: [40, 52], ac: 21, hero: [1, 3] }],
    ...o,
  };
}

/* ── dying: Valeros knocked out on the ogre's turn ───────────────────── */
function dying(art) {
  const m = martial(art);
  m.turnbar = { mode: "encounter", mine: false, current: "Ogre Warrior", round: 3, economy: { max: 3, spent: 0, reaction: false }, map: 0 };
  m.plinth = { ...m.plinth, turn: false, hp: [0, 76], dying: { value: 2, max: 4 },
    conds: [{ slug: "unconscious", name: "Unconscious", icon: art("conditions/unconscious.webp"), tone: "danger" },
      { slug: "wounded", name: "Wounded", value: 1, icon: art("conditions/wounded.webp"), tone: "danger" },
      { slug: "prone", name: "Prone", icon: art("conditions/prone.webp") }] };
  m.vitals = { ...m.vitals, hp: { value: 0, max: 76, temp: 0 } };
  m.deck = { ...m.deck, tab: "actions" };
  return m;
}

/* ── the GM: an ogre and its goblins, the party above ────────────────── */
const FOES = (art) => [
  { id: "ogre", name: "Ogre Warrior", level: 3, img: art("iconics/Ulka.webp"), hp: [50, 50], disp: "hostile" },
  { id: "g1", name: "Goblin Warrior", level: -1, img: art("iconics/Fumbus.webp"), hp: [6, 6], disp: "hostile" },
  { id: "g2", name: "Goblin Warrior", level: -1, img: art("iconics/Fumbus.webp"), hp: [1, 6], disp: "hostile" },
  { id: "g3", name: "Goblin Warrior", level: -1, img: art("iconics/Fumbus.webp"), hp: [0, 6], disp: "hostile", state: "dead" },
  { id: "pyro", name: "Goblin Pyro", level: 1, img: art("iconics/Whirp.webp"), hp: [14, 18], disp: "hostile" },
  { id: "guard", name: "Watch Officer", level: 2, img: art("iconics/Seelah.webp"), hp: [30, 32], disp: "friendly" },
];
function gm(art, o = {}) {
  return {
    role: "gm",
    plinth: { kind: "npc", name: "Ogre Warrior", sub: "Level 3 · Large Giant", img: art("iconics/UlkaFull.webp"), cutout: art("iconics/UlkaFull.webp"), hp: [50, 50], fold: true },
    creature: {
      name: "Ogre Warrior", level: 3, ac: 17, hp: { value: 50, max: 50 }, perception: 7, saves: { fortitude: 13, reflex: 6, will: 4 }, recallDC: 18,
      strikes: [
        { id: "ogre-hook", name: "Ogre Hook", variants: ["+12", "+7", "+2"], damage: "1d10+7 piercing" },
        { id: "javelin", name: "Javelin", variants: ["+8", "+3", "−2"], damage: "1d6+7 piercing" },
      ],
      abilities: [
        { id: "aoo", name: "Reactive Strike", cost: "r" },
        { id: "sweep", name: "Sweeping Hook", cost: 2 },
        { id: "menace", name: "Brutal Menace", cost: 1 },
      ],
    },
    foes: { foes: FOES(art), selected: "ogre" },
    /* the GM sees every defence: the finder is the creature's own skill actions against the targeted PC */
    sk: {
      skills: skillSet({ athletics: [2, 12], intimidation: [1, 7], survival: [1, 5] }, { perception: 7, saves: { fortitude: 13, reflex: 6, will: 4 }, unarmed: 12 }),
      target: { name: "Valeros", img: art("iconics/Valeros.webp"), known: "AC 23 · Fort 23 · Ref 21 · Will 19", defences: { fortitude: 23, reflex: 21, will: 19, perception: 22, stealth: 20, deception: 11 }, recallSkill: null },
      pins: [],
    },
    stack: party(art, null),
    ...o,
  };
}
function hazard(art) {
  return gm(art, {
    plinth: { kind: "hazard", name: "Spear Launcher", sub: "Level 2 · Mechanical Trap", img: art("hazards/serpent-ward-curse-of-potent-poison.webp"), fold: true },
    creature: null,
    hazard: { name: "Spear Launcher", level: 2, stealthDC: 20, ac: 18, hardness: 8, hp: { value: 32, max: 32 },
      disable: "Thievery DC 18 (trained) on the floor plate, or Thievery DC 20 on the wall slot.",
      abilities: [{ id: "spear", name: "Spear", cost: "r" }, { id: "rearm", name: "Rearm", cost: 3 }] },
    foes: { foes: FOES(art).slice(0, 4), selected: null },
  });
}
function gmEmpty(art) {
  return { role: "gm", plinth: { kind: "npc", name: "Game Master", sub: "No creature selected", fold: true }, stack: party(art, null) };
}

/* ── stress states: the cases a real world brings and a tidy sample hides.
   Long names everywhere, a crowded deck, many lores, no target, low Hit
   Points with a stack of conditions, and a GM hand of a dozen creatures. ── */
function stress(art) {
  const m = martial(art);
  const img = (n) => art(`spells/${n}.webp`);
  return {
    ...m,
    turnbar: { mode: "encounter", mine: true, round: 11, economy: { max: 3, spent: 2, reaction: false }, map: 2 },
    plinth: {
      kind: "character", name: "Seraphine Valcourt-Ashenmoor", sub: "Champion 14", speed: "20 ft", cutout: art("iconics/SeelahFull.webp"),
      frameable: true, hero: [0, 3], hp: [14, 212], turn: true,
      conds: [
        { slug: "frightened", name: "Frightened", value: 3, icon: art("conditions/frightened.webp"), tone: "danger" },
        { slug: "clumsy", name: "Clumsy", value: 2, icon: art("conditions/clumsy.webp"), tone: "danger" },
        { slug: "persistent", name: "Persistent Fire", value: 2, icon: art("conditions/persistent-damage.webp"), tone: "danger" },
        { slug: "off-guard", name: "Off-Guard", icon: art("conditions/off-guard.webp"), tone: "danger" },
        { slug: "quickened", name: "Quickened", icon: art("conditions/quickened.webp"), tone: "good" },
      ],
    },
    vitals: {
      ac: 36, hp: { value: 14, max: 212, temp: 0 }, classDC: 33, perception: 24,
      saves: { fortitude: 28, reflex: 22, will: 27 },
      shield: { name: "Sturdy Shield (Major)", hp: 0, max: 240, hardness: 20, bt: 120, ac: 2, raised: true, broken: true },
    },
    strikes: { list: [
      { id: "greatsword", name: "+2 Greater Striking Holy Greatsword", short: "Greatsword", img: art("equipment/weapons/greatsword.webp"), variants: ["+28", "+23", "+18"], damage: "3d12+11 slashing, 1d6 spirit", critical: "6d12+22 slashing, 2d6 spirit" },
      { id: "crossbow", name: "+2 Greater Striking Heavy Crossbow", short: "Heavy Crossbow", img: art("equipment/weapons/heavy-crossbow.webp"), variants: ["+26", "+21", "+16"], damage: "3d10+4 piercing", critical: "6d10+8 piercing", reload: { cost: 2, loaded: false } },
      { id: "javelin", name: "Returning Javelin", short: "Javelin", img: art("equipment/weapons/javelin.webp"), variants: ["+24", "+19", "+14"], damage: "3d6+9 piercing", critical: "6d6+18 piercing", ready: false },
      { id: "fist", name: "Fist", img: art("unarmed-attacks/fist.webp"), variants: ["+24", "+20", "+16"], damage: "1d4+9 bludgeoning", critical: "2d4+18 bludgeoning" },
      { id: "shield-bash", name: "Shield Bash", img: art("equipment/shields/steel-shield.webp"), variants: ["+24", "+19", "+14"], damage: "1d6+9 bludgeoning", critical: "2d6+18 bludgeoning" },
      { id: "dagger", name: "Silver Dagger", img: art("equipment/weapons/dagger.webp"), variants: ["+22", "+18", "+14"], damage: "1d4+9 piercing", critical: "2d4+18 piercing" },
    ] },
    deck: deck("actions", {
      spells: { rank: "f", dc: 33, atk: 23, focus: [1, 3], ranks: [{ key: "f", cards: 3 }], cards: [
        SP("lay", "Lay on Hands", "f", 1, { img: img("lay-on-hands") }), SP("shields", "Shields of the Spirit", "f", 1, { img: img("shields-of-the-spirit") }),
        SP("litany", "Litany Against Wrath", "f", 1, { img: img("litany-against-wrath"), spent: true }),
      ] },
      actions: {
        toggles: [{ id: "aura", label: "Aura of Righteousness", on: true }, { id: "blade", label: "Blade of Justice", on: false }],
        list: [
          { id: "retributive", name: "Retributive Strike", cost: "r" },
          { id: "shield-block", name: "Shield Block", cost: "r" },
          { id: "champions-reaction", name: "Glimpse of Redemption", cost: "r", freq: { used: 1, max: 1, per: "round" } },
          { id: "lay-on-hands", name: "Lay on Hands", cost: 1 },
          { id: "divine-grace", name: "Divine Grace", cost: "r" },
          { id: "smite", name: "Smite Evil", cost: 1, freq: { used: 0, max: 1, per: "10 min" } },
          { id: "attack-of-opportunity", name: "Reactive Strike", cost: "r" },
          { id: "quick-shield", name: "Quick Shield Block", cost: "f" },
          { id: "shield-warden", name: "Shield Warden", cost: "r" },
          { id: "aura-of-faith", name: "Aura of Faith", cost: "f" },
          { id: "loyal-warhorse", name: "Command Loyal Warhorse", cost: 1 },
          { id: "dive", name: "Divine Reflexes", cost: "r" },
          { id: "sacred-shield", name: "Sacred Defender", cost: 2, freq: { used: 1, max: 1, per: "day" } },
          { id: "stance-unbreakable", name: "Unbreakable Bulwark Stance", stance: true, active: true, cost: 1 },
        ],
      },
      skills: { query: "" },
      items: { list: [...ITEMS(art), ...ITEMS(art).map((i) => ({ ...i, id: `${i.id}-2`, name: `Greater ${i.name}`, qty: 1 }))] },
    }),
    sk: {
      skills: skillSet({ athletics: [4, 30], diplomacy: [3, 24], religion: [3, 25], intimidation: [2, 21], medicine: [2, 22], society: [1, 15], acrobatics: [1, 14], crafting: [1, 15], survival: [1, 16], occultism: [1, 15] },
        { perception: 24, saves: { fortitude: 28, reflex: 22, will: 27 }, unarmed: 24 }),
      lores: [
        { slug: "warfare-lore", name: "Warfare Lore", rank: 2, mod: 21 }, { slug: "iomedae-lore", name: "Iomedae Lore", rank: 2, mod: 21 },
        { slug: "absalom-lore", name: "Absalom Lore", rank: 1, mod: 15 }, { slug: "heraldry-lore", name: "Heraldry Lore", rank: 1, mod: 15 },
        { slug: "fiend-lore", name: "Fiend Lore", rank: 1, mod: 15 }, { slug: "mercantile-lore", name: "Mercantile Lore", rank: 1, mod: 15 },
      ],
      target: null, pins: ["demoralize", "grapple", "trip", "treat-wounds", "request"],
    },
    stack: [...party(art, "valeros"),
      { id: "harsk", name: "Harsk", img: art("iconics/Harsk.webp"), hp: [0, 88], ac: 30, hero: [0, 3], note: "Dying 3" },
      { id: "lem", name: "Lem", img: art("iconics/Lem.webp"), hp: [96, 96], ac: 31, hero: [3, 3] }],
  };
}

function gmHorde(art) {
  const foes = [];
  const kinds = [["Goblin Warrior", -1, "Fumbus"], ["Hobgoblin Archer Sergeant", 3, "Ulka"], ["Bugbear Thug", 2, "Ulka"], ["Goblin War Chanter", 1, "Whirp"]];
  for (let i = 0; i < 14; i++) {
    const [name, level, art_] = kinds[i % kinds.length];
    const max = 8 + level * 12 + 8;
    foes.push({ id: `f${i}`, name, level, img: art(`iconics/${art_}.webp`), hp: [Math.max(0, max - i * 5), max], disp: i === 13 ? "friendly" : "hostile", ...(i === 5 ? { state: "dead" } : {}) });
  }
  return gm(art, {
    plinth: { kind: "npc", name: "Hobgoblin Archer Sergeant", sub: "Level 3 · Medium Humanoid", img: art("iconics/UlkaFull.webp"), cutout: art("iconics/UlkaFull.webp"), hp: [38, 52], fold: true },
    creature: {
      name: "Hobgoblin Archer Sergeant", level: 3, ac: 19, hp: { value: 38, max: 52 }, perception: 10, saves: { fortitude: 11, reflex: 12, will: 7 }, recallDC: 20,
      strikes: [
        { id: "composite", name: "Composite Longbow", variants: ["+12", "+7", "+2"], damage: "1d8+3 piercing, deadly d10" },
        { id: "shortsword", name: "Shortsword", variants: ["+11", "+7", "+3"], damage: "1d6+4 piercing" },
        { id: "dagger", name: "Dagger (thrown)", variants: ["+11", "+7", "+3"], damage: "1d4+4 piercing" },
        { id: "fist", name: "Fist", variants: ["+11", "+7", "+3"], damage: "1d4+4 bludgeoning" },
        { id: "kick", name: "Kick", variants: ["+10", "+6", "+2"], damage: "1d4+4 bludgeoning" },
      ],
      abilities: [
        { id: "volley", name: "Volley Fire Command", cost: 2 }, { id: "formation", name: "Formation Training", cost: "f" },
        { id: "aoo", name: "Reactive Strike", cost: "r" }, { id: "rally", name: "Rallying Bark", cost: 1 }, { id: "point-blank", name: "Point-Blank Shot", cost: 1 },
      ],
    },
    foes: { foes, selected: "f1" },
  });
}

/* ── peeks and drawer bodies the preview opens on request ────────────── */
export const PEEKS = {
  strike: (art, t) => ({
    anchor: '[data-strike="longsword"].gph-stn', model: {
      name: "Longsword", from: "Strike · held in one hand · <b>+14</b>",
      traits: ["Versatile P", "Sword"], lines: [["Damage", "1d8+4 slashing"], ["Critical", "2d8+8 slashing"], ["Range", "Melee"]],
      actions: [{ id: "grip", label: "Two hands", cost: 1 }, { id: "post", label: "Post" }],
    } }),
  spell: () => ({
    anchor: '[data-spell="fireball-a"]', model: {
      name: "Fireball", from: "Rank 3 · Arcane prepared · <b>DC 25</b>",
      traits: ["Concentrate", "Fire", "Manipulate"], lines: [["Range", "500 feet"], ["Area", "20-foot burst"], ["Defense", "basic Reflex"]],
      text: "<p>A roaring blast of fire detonates at a spot you designate, dealing <strong>6d6 fire damage</strong>.</p><p><strong>Heightened (+1)</strong> The damage increases by 2d6.</p>",
      actions: [{ id: "cast", label: "Cast", cost: 2, primary: true }, { id: "post", label: "Post" }],
    } }),
  action: () => ({
    anchor: '[data-action="sudden-charge"]', model: {
      name: "Sudden Charge", from: "Fighter feat 1",
      traits: ["Flourish", "Open"], text: "<p>With a quick sprint, you dash up to your foe and swing. Stride twice. If you end your movement within melee reach of at least one enemy, you can make a melee Strike against that enemy.</p>",
      actions: [{ id: "use", label: "Use", cost: 2, primary: true }, { id: "post", label: "Post" }],
    } }),
};

export const DRAWER_BODIES = {
  inventory: (V, t, art) => ({ title: t("GLRAIL.drawer.inventory"), note: "4 Bulk of 9", body: V.DLIST({ rows: [
    { head: "Consumables" }, { key: "i:elixir", act: true, name: "Minor Elixir of Life", icon: art("equipment/consumables/elixirs/elixir-of-life.webp"), n: "×2", meta: "Use" },
    { key: "i:potion", act: true, name: "Lesser Healing Potion", n: "×1", meta: "Use" },
    { head: "Worn and held" }, { key: "i:longsword", act: true, name: "+1 Striking Longsword", meta: "Held, one hand", n: "1" },
    { key: "i:shield", act: true, name: "Steel Shield", meta: "Held", n: "1" }, { key: "i:armor", act: true, name: "Full Plate", meta: "Worn", n: "4" },
  ] }, t) }),
  effects: (V, t, art) => ({ title: t("GLRAIL.drawer.effects"), body: V.DLIST({ rows: [
    { key: "e:inspire", name: "Courageous Anthem", icon: art("spells/courageous-anthem.webp"), meta: "+1 status to attacks and damage", tag: "1 rd" },
    { key: "e:offguard", name: "Off-Guard", icon: art("conditions/off-guard.webp"), meta: "−2 circumstance to AC", tag: "Flanked" },
  ] }, t) }),
  rest: (V, t) => ({ title: t("GLRAIL.drawer.rest"), body: V.REST(t) }),
  macros: (V, t, art) => ({ title: t("GLRAIL.drawer.macros"), body: V.MACROS({ page: 1, slots: [
    { id: "m1", name: "Demoralize", img: art("actions/Empty.webp") }, { id: "m2", name: "Treat Wounds", img: null }, { id: "m3", name: "Group Perception", img: null },
    null, null, null, null, null, null, null] }, t) }),
  foes: (V, t, art, model) => ({ title: t("GLRAIL.drawer.foes"), note: String(model.foes?.foes?.length ?? 0), body: V.DLIST({ rows: (model.foes?.foes ?? []).map((f) => ({
    key: `foe:${f.id}`, act: true, name: f.name, icon: f.img, meta: `Level ${f.level} · ${f.disp}`, n: f.hp ? `${f.hp[0]}/${f.hp[1]}` : null })) }, t) }),
  ranks: (V, t, art, model) => ({ title: t("GLRAIL.spell.hand"), note: "DC 25 · +15", body: V.RANKS(model.deck?.spells, t) }),
};

export const STATES = { martial, prepared, spontaneous, kineticist, companion, dying, gm, hazard, "gm-empty": gmEmpty, stress, "gm-horde": gmHorde };
