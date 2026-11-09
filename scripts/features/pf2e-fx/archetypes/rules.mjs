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
 * Every archetype: `func` is the function it implies when it rescues a silent
 * action, `fits` the functions it may take over (none: any). A name alone never
 * moves a spell across functions: See Invisibility is a detect, not a vanish.
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
  ["vanish", re(["invisibility", "invisible", "vanish", "disappear", "fade-from-view", "blend-into-shadows"])],
  ["light", re(["light", "glow", "dancing-lights", "illuminate", "radiant-glow", "luminous"])],
  ["fortune", re(["sure-strike", "true-strike", "guidance", "bless", "fortune", "lucky", "good-fortune", "inspire", "heroism"])],
  ["sleep", re(["sleep", "slumber", "drowsy", "lullaby", "sleep-gaze"])],
  ["blind", re(["blind", "blindness", "dazzle", "dazzling", "flash", "glitterdust", "color-spray"])],
  ["slow", re(["slow", "hold", "paralyze", "paralyzing", "freeze", "petrify", "entangle", "web", "root", "immobilize", "stagger"])],
  ["charm", re(["charm", "dominate", "suggestion", "command", "compel", "possess", "possession", "enthrall", "beguile", "mind-control"])],
  ["fear", re(["fear", "frightful-presence", "terrify", "terror", "dread", "horrify", "scare", "phantasmal", "intimidat", "demoralize"])],
  ["hex", re(["curse", "hex", "bane", "doom", "malediction", "jinx", "evil-eye", "ill-omen", "misfortune"])],
];

/* Trait signals: the function's own split when no name speaks. */
const BY_TRAIT = [
  ["rage", ["rage"]], ["stance", ["stance"]], ["flurry", ["flourish"]],
  ["sleep", ["sleep"]], ["fear", ["fear"]], ["charm", ["possession", "incapacitation"]],
  ["hex", ["curse", "misfortune"]], ["fortune", ["fortune"]], ["light", ["light"]],
];

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
  for (const [arch, rx] of BY_SLUG) if (rx && rx.test(slug)) return accept(arch, spec, "slug");
  for (const [arch, ts] of BY_TRAIT) if (ts.some((x) => t.has(x))) return accept(arch, spec, "trait");
  // the generic forms with an archetype of their own
  if (!spec.silent && spec.func === "restore") return { arch: "rise", src: "func" };
  if (!spec.silent && spec.func === "hinder") return { arch: "hex", src: "func" };
  return null;
}

/** Archetypes a damaging ability may take, and only in place of a generic form (never a real delivery). */
const BODY = new Set(["grab", "trip", "shove", "charge", "flurry"]);
const GENERIC = new Set([null, undefined, "form", "bloom"]);

/** A silent action is lifted only by an archetype that rescues; a playing one takes any. */
function accept(arch, spec, src) {
  if (spec.silent === "no-function") { if (!ARCH[arch]?.rescue) return null; return { arch, src }; }
  if (ARCH[arch].fits && !ARCH[arch].fits.includes(spec.func)) return null;
  if ((spec.func === "harm" || spec.func === "hazard") && !(BODY.has(arch) && GENERIC.has(spec.delivery))) return null;
  return { arch, src };
}
