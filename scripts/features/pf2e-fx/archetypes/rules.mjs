/**
 * Spellsprite — which archetype an item plays (docs/SPELLSPRITE_ARCHETYPES.md).
 *
 * An archetype is one animation reused across every document that means the
 * same thing: one grab for 806 Grabs and 1,253 grabbing Strikes, one rage for
 * barbarian Rage and every NPC Berserk. It is chosen here from signals the
 * document already carries (slug, name, traits, function, item type) and
 * drawn by archetypes/index.mjs, which takes the spec's size, material and
 * outcome as its parameters. An item with no archetype plays its function's
 * generic form exactly as before.
 *
 * Pure: no game, no DOM. semantics.mjs calls `pickArch` from `depictSpec`.
 */

const MIND = ["hinder", "control"];

/**
 * Every archetype: `func` (and `material`, when the action names none) is what
 * it implies when it rescues a silent action, `fits` the functions it may take
 * over (none: any). A name alone never moves a spell across functions: See
 * Invisibility is a detect, not a vanish.
 */
export const ARCH = Object.freeze({
  // the hinder split (catalogue §4 row 1)
  hex: { func: "hinder", fits: MIND }, fear: { func: "hinder", fits: MIND }, charm: { func: "control", fits: MIND },
  slow: { func: "hinder", fits: MIND }, sleep: { func: "hinder", fits: MIND }, blind: { func: "hinder", fits: MIND },
  // body: grabs, maneuvers, strike preludes
  grab: { func: "control", rescue: true }, trip: { func: "control", rescue: true }, shove: { func: "control", rescue: true },
  rend: { func: "harm", rescue: true }, charge: { func: "support", rescue: true }, flurry: { func: "support", rescue: true },
  // self: rage and stance
  rage: { func: "support", rescue: true, fits: ["support", "protect", "neutral", "hinder"] },
  stance: { func: "support", rescue: true, fits: ["support", "protect", "neutral"] },
  // vital rise, drinking, light, fortune, vanishing
  rise: { func: "restore", fits: ["restore"] }, drink: { func: null },
  light: { func: "support", fits: ["support", "neutral", "conceal"] }, fortune: { func: "support", fits: ["support", "neutral", "protect"] },
  vanish: { func: "conceal", fits: ["conceal", "support", "neutral"] },
  // P1 (catalogue §4 rows 12–20): drawn in shift.mjs, ward.mjs, veil.mjs; routed below
  polymorph: { func: "transform", material: "arcane", rescue: true, fits: ["transform", "support", "neutral"] },
  teleport: { func: "teleport", material: "arcane", rescue: true, fits: ["teleport", "movement", "neutral", "support"] },
  haste: { func: "support", fits: ["support", "movement", "neutral"] },
  fly: { func: "movement", material: "air", rescue: true, fits: ["movement", "support", "neutral"] },
  ward: { func: "protect", material: "force", rescue: true, fits: ["protect", "support", "neutral"] },
  dispel: { func: "support", fits: ["control", "support", "neutral", "hinder", "protect"] },
  detect: { func: "detect", fits: ["detect", "neutral", "support"] },
  conceal: { func: "conceal", fits: ["conceal", "support", "neutral", "terrain"] },
  drain: { func: "restore", material: "void", rescue: true, fits: ["restore", "hinder", "neutral", "support", "harm", "hazard"] },
  summon: { func: "summon", fits: ["summon", "neutral", "support"] },
});
export const ARCH_VOCAB = Object.freeze(Object.keys(ARCH));

const slugify = (v) => String(v ?? "").trim().toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const re = (words) => new RegExp(`(^|-)(${words.join("|")})(-|$)`);

/* Name/slug signals, checked against the slug (hyphenated). Order matters: first match wins. */
const BY_SLUG = [
  ["drink", null], // consumables are decided by type below; listed for order only
  ["grab", re(["grab", "improved-grab", "grapple", "grappling", "constrict", "swallow-whole", "engulf", "seize", "clutch", "snatch", "wrap", "pin"])],
  ["trip", re(["trip", "knockdown", "improved-knockdown", "sweep-the-legs", "leg-sweep", "takedown", "topple", "tail-sweep", "trip-up"])],
  ["shove", re(["shove", "push", "improved-push", "trample", "reposition", "bull-rush", "overrun", "knockback", "buffet", "throw-rock", "fling", "hurl"])],
  ["rend", re(["rend", "rip", "tear", "maul", "savage", "eviscerate"])],
  ["charge", re(["charge", "pounce", "sudden-charge", "lunge", "dash", "leap-attack", "rush", "powerful-charge", "flying-strike", "swoop", "dive"])],
  ["flurry", re(["flurry", "frenzy", "flurry-of-blows", "double-slice", "twin-takedown", "draconic-frenzy", "whirlwind", "multiattack", "multiple-attacks", "fury", "barrage", "blitz"])],
  ["rage", re(["rage", "raging", "berserk", "berserker", "mighty-rage", "blood-frenzy", "fanatical-frenzy", "wrath", "furious", "rampage"])],
  ["vanish", re(["invisibility", "invisible", "vanish", "disappear", "disappearance", "fade-from-view", "blend-into-shadows"])],
  ["light", re(["light", "glow", "dancing-lights", "illuminate", "radiant-glow", "luminous"])],
  ["fortune", re(["sure-strike", "true-strike", "guidance", "bless", "fortune", "lucky", "good-fortune", "inspire", "heroism"])],
  ["sleep", re(["sleep", "slumber", "drowsy", "lullaby", "sleep-gaze"])],
  ["blind", re(["blind", "blindness", "dazzle", "dazzling", "flash", "glitterdust", "color-spray"])],
  ["slow", re(["slow", "hold", "paralyze", "paralyzing", "freeze", "petrify", "entangle", "web", "root", "immobilize", "stagger"])],
  ["charm", re(["charm", "dominate", "suggestion", "command", "compel", "possess", "possession", "enthrall", "beguile", "mind-control"])],
  ["fear", re(["fear", "frightful-presence", "terrify", "terror", "dread", "horrify", "scare", "phantasmal", "intimidat", "demoralize"])],
  ["hex", re(["curse", "hex", "bane", "doom", "malediction", "jinx", "evil-eye", "ill-omen", "misfortune"])],
  // P1 (catalogue §4 rows 12–20). `fits` keeps each on its own function: a Shield Bash is harm, Dispelling Globe terrain
  ["drain", re(["drink-blood", "blood-drain", "drain-blood", "consume-flesh", "feast", "feed", "feeding", "gnaw", "devour", "devour-soul", "siphon", "siphon-life", "life-siphon", "drain-life", "drain-vigor", "drain-thoughts", "drain-qi", "drain-essence", "draining-touch", "drink-essence", "soul-drain", "life-drain", "leech", "vampiric"])],
  ["dispel", re(["dispel", "dispel-magic", "dispelling", "disjunction", "defensive-dispel"])],
  ["ward", re(["shield", "shields", "shielding", "shield-block", "block", "deflect", "deflection", "deflecting", "dodge", "parry", "riposte", "sidestep", "ward", "warding", "protection", "aegis", "barrier", "bulwark", "counterspell", "spell-reflection", "reflect-spell", "ferocity", "diehard", "shake-it-off", "remove-a-condition", "last-stand", "mage-armor", "mystic-armor", "stoneskin", "sanctuary", "resist-energy"])],
  ["teleport", re(["teleport", "teleportation", "translocate", "dimension-door", "dimension-hop", "dimensional-hop", "blink", "phase-out", "phase-step", "phase-jump", "shadow-step", "shadow-jump", "mist-step", "skip-between", "abundant-step", "flicker", "transpose", "plane-shift"])],
  ["polymorph", re(["change-shape", "shapechange", "shape-change", "change-form", "turn-to-mist", "vapor-form", "gaseous-form", "mist-form", "swarm-shape", "swarm-form", "wild-shape", "alter-self", "shift-form", "liquefy"])],
  ["fly", re(["fly", "flight", "take-flight", "levitate", "levitation", "air-walk", "feather-fall", "wind-walk", "jump"])],
  ["haste", re(["haste", "hasted", "tailwind", "longstrider", "speed-surge", "speed-boost", "expeditious-retreat", "swiftness", "freedom-of-movement", "unfettered-movement"])],
  ["summon", re(["summon", "create-undead", "animate-dead", "conjure-minion", "call-minion"])],
];

/*
 * Never these, whatever the name or function says: a spellshape is not a feed, a
 * mark is not a detect sweep (Seek is secret; Hunt Prey marks a target), a swatter
 * does not fly, a climb is not a haste, a trance is not a veil.
 */
const NOT = Object.freeze({
  drain: re(["drain-bonded-item", "drain-soul-cage", "spell-feedback", "leech-clip"]),
  fly: re(["fly-swatter", "flying-kick", "flying-strike", "time-jump", "fight-or-flight"]),
  haste: re(["water-walk", "spider-climb", "swim", "climb", "burrow"]),
  detect: re(["hunt-prey", "devise-a-stratagem", "seek", "point-out", "exploit-vulnerability"]),
  ward: re(["final-spite", "shield-bash", "shield-spikes"]),
  conceal: re(["hypnotize", "hypnotic-pattern"]),
});

/* Trait signals: the function's own split when no name speaks. */
const BY_TRAIT = [
  ["rage", ["rage"]], ["stance", ["stance"]], ["flurry", ["flourish"]],
  ["sleep", ["sleep"]], ["fear", ["fear"]], ["charm", ["possession", "incapacitation"]],
  ["hex", ["curse", "misfortune"]], ["fortune", ["fortune"]], ["light", ["light"]],
  ["conceal", ["darkness"]], ["drain", ["disease", "poison"]],
];

/* An illusion that hides or fakes something is a veil; one that frightens, charms or only makes a sound is not. */
const NOT_VEIL = ["mental", "emotion", "fear", "incapacitation", "sleep", "linguistic"];
const veils = (t, slug) => !/(^|-)silence(-|$)/.test(slug) && (t.has("darkness")
  || ((t.has("illusion") || t.has("shadow")) && !NOT_VEIL.some((x) => t.has(x)) && (t.has("visual") || !t.has("auditory"))));

/* The function's own archetype, when no name or trait spoke. */
const BY_FUNC = Object.freeze({
  restore: () => "rise", hinder: () => "hex",
  transform: () => "polymorph", teleport: () => "teleport", summon: () => "summon",
  movement: () => "haste", detect: () => "detect",
  conceal: (item, t, slug) => (veils(t, slug) ? "conceal" : null),
  // a creature's defensive heading files ripostes and tail sweeps too: only a spell or a consumable wards by function alone
  protect: (item) => (item.type === "spell" || item.type === "consumable" ? "ward" : null),
});

/**
 * The archetype for a finished spec, or null.
 * @param {object} item   the item (or a skill action's stand-in)
 * @param {object} spec   the spec so far: func, kind, silent, delivery, craft
 * @param {Set<string>} traits
 * @returns {{arch: string, src: string} | null}
 */
export function pickArch(item, spec, traits = new Set()) {
  if (!item || spec.craft) return null;
  // a Strike plays its own delivery; a condition loop its overlay
  if (spec.kind === "strike" || spec.kind === "condition" || spec.kind === "tick") return null;
  const t = traits instanceof Set ? traits : new Set(traits);
  const sys = item.system ?? {};
  const slug = slugify(sys.slug || item.slug || item.name);
  // a potion or elixir is drunk: the motion, then its function's form
  const cat = slugify(sys.category ?? sys.consumableType?.value ?? "");
  if (item.type === "consumable" && (cat === "potion" || cat === "elixir" || t.has("potion") || t.has("elixir")) && !spec.silent) return { arch: "drink", src: "type" };
  if (spec.silent && spec.silent !== "no-function") return null;
  // a signal its archetype refuses (a name on the wrong function) says nothing: the next one is asked
  const ok = (arch) => !NOT[arch]?.test(slug);
  for (const [arch, rx] of BY_SLUG) if (rx && rx.test(slug) && ok(arch)) { const a = accept(arch, spec, "slug", item); if (a) return a; }
  for (const [arch, ts] of BY_TRAIT) if (ts.some((x) => t.has(x)) && ok(arch)) { const a = accept(arch, spec, "trait", item); if (a) return a; }
  // the generic forms with an archetype of their own
  if (spec.silent) return null;
  const arch = BY_FUNC[spec.func]?.(item, t, slug) ?? null;
  return arch && ok(arch) && (!P1.has(arch) || GENERIC.has(spec.delivery)) ? { arch, src: "func" } : null;
}

/** Archetypes a damaging ability may take, and only in place of a generic form (never a real delivery): Ghoul Fever's bloom seeps, Blood Drain's jaws bite. */
const BODY = new Set(["grab", "trip", "shove", "charge", "flurry", "drain"]);
const GENERIC = new Set([null, undefined, "form", "bloom"]);
/** These stand in for a generic form only: Wall of Force keeps its wall, Prying Eye its gaze, a dispelling roar its voice. */
const P1 = new Set(["polymorph", "teleport", "haste", "fly", "ward", "dispel", "detect", "conceal", "drain", "summon"]);

/** A silent action is lifted only by an archetype that rescues; a playing one takes any. */
function accept(arch, spec, src, item) {
  // a feed is named; a poison trait alone (Toxic Skin) is no reason to lift a silent action
  if (spec.silent === "no-function") { if (!ARCH[arch]?.rescue || (arch === "drain" && src === "trait")) return null; return { arch, src }; }
  if (ARCH[arch].fits && !ARCH[arch].fits.includes(spec.func)) return null;
  if ((spec.func === "harm" || spec.func === "hazard") && !(BODY.has(arch) && GENERIC.has(spec.delivery))) return null;
  if (P1.has(arch) && !GENERIC.has(spec.delivery)) return null;
  // an affliction seeps into one creature: a poison cloud or a plague burst keeps its area
  if (arch === "drain" && src === "trait" && spec.area) return null;
  // a poison is applied, a drug is drunk: only a consumable poison seeps
  if (arch === "drain" && src === "trait" && item?.type === "consumable" && String(item.system?.category ?? "") !== "poison") return null;
  return { arch, src };
}
