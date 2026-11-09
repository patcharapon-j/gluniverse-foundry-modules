/**
 * Spellsprite — semantics: plain PF2e data to the semantic half of an FxSpec.
 * Pure: no `game`, `canvas`, `foundry`, `ui` or `Hooks`. The coverage tool and
 * the check tool drive it over the real compendium packs under plain Node.
 *
 * What this decides (compile.mjs's header defines the full FxSpec):
 *
 *   kind       "attack" | "save" | "area" | "strike" | "auto" | "self" | "condition" | "tick"
 *   func       a Spellglass function (constants.mjs FUNCTIONS)
 *   material   a Spellglass material, accent a second one or null
 *   rank       1..10 (a spell's cast rank; otherwise level / 2)
 *   tradition  "arcane" | "divine" | "occult" | "primal" | null
 *   weapon     { style, ranged, splash, heavy } | null   (constants.mjs WEAPON_STYLES;
 *              heavy: a two-handed weapon, which swings with more weight)
 *   craft      "medicine" | null: a mundane skill that must not read as magic
 *   area       { shape, r, len, width } | null    SQUARES (5 ft = 1); no position
 *   mode       how a PF2e degree maps to an outcome: "attack" | "save" | null
 *
 * plus `silent` (null, or why this plays nothing: a passive feat, a gear item,
 * a detection-state condition) and `why` (where each axis came from, for the
 * coverage report). Positions, targets, outcome and privacy are read.mjs's.
 *
 * Material and function start from Spellglass's classifier (pf2e-aoe), which is
 * the suite's one closed vocabulary; the rules here add what it does not need:
 * NPC strike damage rolls, property runes, inline @Damage / @Template markup on
 * actions and creature abilities, heal/harm against undead, the misleading
 * spells, and weapon styles. Every input yields a spec; unknowns resolve to
 * func "neutral", material "neutral". Nothing here throws.
 */

import { classify } from "../pf2e-aoe/classifier.mjs";
import { CONDITIONS } from "./conditions.mjs";
import { FUNCTIONS, MATERIALS, TRADITIONS } from "./constants.mjs";
import { ARCH, pickArch } from "./archetypes/rules.mjs";
import { BASE_GROUP, STYLE_OF, actionDelivery, baseItemOf, flavorOf, inVocab, motifOf, nameElement, propsOf, strikeDelivery } from "./depict.mjs";

const MATERIAL_SET = new Set(MATERIALS);
const FUNCTION_SET = new Set(FUNCTIONS);
const PHYSICAL = new Set(["bludgeoning", "piercing", "slashing", "bleed", "precision"]);

/* ── small helpers ─────────────────────────────────────────────────────── */

const asArray = (v) => (v instanceof Set ? [...v] : Array.isArray(v) ? v : v && typeof v === "object" ? Object.keys(v).filter((k) => v[k]) : []);
const slugify = (v) => String(v ?? "").trim().toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const kebab = (v) => String(v ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const clampInt = (v, a, b) => Math.max(a, Math.min(b, Math.round(Number(v) || 0)));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

function sysOf(item) {
  try { return item?.system ?? {}; } catch { return {}; }
}

/** An item's trait set, slugs only. */
export function traitsOf(item) {
  const sys = sysOf(item);
  return new Set(asArray(sys.traits?.value).map((t) => slugify(t)).filter(Boolean));
}

export function slugOf(item) {
  const sys = sysOf(item);
  return slugify(item?.slug ?? sys.slug ?? item?.name);
}

function descriptionOf(item, opts) {
  if (typeof opts?.description === "string") return opts.description;
  const d = sysOf(item).description;
  return typeof d === "string" ? d : typeof d?.value === "string" ? d.value : "";
}

/* ── damage ────────────────────────────────────────────────────────────── */

const DAMAGE_MATERIAL = Object.freeze({
  fire: "fire", cold: "cold", electricity: "electricity", acid: "acid", poison: "poison",
  sonic: "sonic", force: "force", vitality: "vitality", void: "void", spirit: "spirit",
  mental: "mental", bludgeoning: "kinetic", piercing: "kinetic", slashing: "kinetic",
  bleed: "kinetic", precision: "kinetic", untyped: "arcane",
  // legacy (pre-remaster) types still found in older world data
  positive: "vitality", negative: "void", good: "holy", evil: "unholy", lawful: "spirit", chaotic: "spirit",
});
const DAMAGE_TYPES = new Set(Object.keys(DAMAGE_MATERIAL));

/** Inline `@Damage[...]` payloads → [{type, kinds, persistent}]. Structured markup, not prose. */
export function inlineDamage(text) {
  const out = [];
  if (!text || typeof text !== "string") return out;
  const re = /@Damage\[((?:[^\[\]]|\[[^\[\]]*\])*)\]/g;
  let m;
  while ((m = re.exec(text))) {
    const body = m[1].split("|")[0];
    for (const tag of body.matchAll(/\[([a-z ,-]+)\]/gi)) {
      const words = tag[1].toLowerCase().split(",").map((w) => w.trim());
      const type = words.find((w) => DAMAGE_TYPES.has(w));
      const healing = words.includes("healing");
      if (!type && !healing) continue;
      out.push({ type: type ?? "vitality", kinds: new Set([healing ? "healing" : "damage"]), persistent: words.includes("persistent"), splash: words.includes("splash") });
    }
  }
  return out;
}

/** Every damage instance an item carries: [{type, kinds:Set, persistent, splash}]. */
export function damageOf(item, opts = {}) {
  const sys = sysOf(item);
  const out = [];
  const push = (type, kinds, extra = {}) => {
    const t = slugify(type);
    if (!DAMAGE_TYPES.has(t)) return;
    out.push({ type: t, kinds: new Set(kinds?.length ? kinds : ["damage"]), persistent: !!extra.persistent, splash: !!extra.splash });
  };
  try {
    if (item?.type === "melee" || sys.damageRolls) {
      for (const r of Object.values(sys.damageRolls ?? {})) push(r?.damageType, null, { persistent: r?.category === "persistent", splash: r?.category === "splash" });
    }
    const d = sys.damage;
    if (d && typeof d === "object") {
      if (typeof d.damageType === "string") {
        // weapon
        push(d.damageType);
        if (d.persistent?.type) push(d.persistent.type, null, { persistent: true });
        if (num(sys.splashDamage?.value) > 0) push(d.damageType, null, { splash: true });
      } else if (typeof d.type === "string" && ("formula" in d || "kind" in d)) {
        // consumable
        push(d.type, [d.kind === "healing" ? "healing" : "damage"]);
      } else {
        // spell: { id: { type, kinds, category } }
        for (const e of Object.values(d)) {
          if (!e || typeof e !== "object") continue;
          push(e.type, asArray(e.kinds), { persistent: e.category === "persistent", splash: e.category === "splash" });
        }
      }
    }
    if (!out.length) out.push(...inlineDamage(descriptionOf(item, opts)));
  } catch { /* fall through with what we have */ }
  return out;
}

/* ── areas ─────────────────────────────────────────────────────────────── */

const AREA_SHAPES = Object.freeze({ burst: "burst", cone: "cone", line: "line", emanation: "emanation", cube: "cube", square: "cube", cylinder: "burst", circle: "burst", ring: "burst" });

/** A PF2e area in feet to the spec's area in squares. */
export function areaFromFeet(type, feet, widthFeet = null) {
  const shape = AREA_SHAPES[slugify(type)];
  if (!shape) return null;
  const ft = num(feet) && num(feet) > 0 ? num(feet) : 5;
  const sq = ft / 5;
  if (shape === "cone") return { shape, r: sq * 0.5, len: sq, width: null };
  if (shape === "line") return { shape, r: 0.5, len: sq, width: Math.max(1, (num(widthFeet) || 5) / 5) };
  if (shape === "cube") return { shape, r: Math.max(0.5, sq / 2), len: null, width: null };
  return { shape, r: Math.max(0.5, sq), len: null, width: null };
}

/** Inline `@Template[cone|distance:40]` / `@Template[type:line|distance:30|width:10]`. */
export function inlineTemplate(text) {
  if (!text || typeof text !== "string") return null;
  const m = /@Template\[([^\]]*)\]/.exec(text);
  if (!m) return null;
  const parts = m[1].split("|").map((p) => p.trim());
  let type = null, distance = null, width = null;
  for (const p of parts) {
    const [k, v] = p.includes(":") ? p.split(":").map((s) => s.trim()) : [null, p];
    if (k === "type" || (!k && AREA_SHAPES[slugify(v)])) type = v;
    else if (k === "distance") distance = v;
    else if (k === "width") width = v;
  }
  return type ? areaFromFeet(type, distance, width) : null;
}

export function areaOf(item, opts = {}) {
  const sys = sysOf(item);
  const a = sys.area;
  if (a && typeof a === "object" && a.type) return areaFromFeet(a.type, a.value);
  // A spell states its area in data (variants included); a template in its text
  // belongs to another way of casting it (Heal's three-action emanation).
  if (item?.type === "spell" || "area" in sys) return null;
  return inlineTemplate(descriptionOf(item, opts));
}

/* ── outcomes ──────────────────────────────────────────────────────────── */

const DEGREES = ["criticalFailure", "failure", "success", "criticalSuccess"];

/**
 * A PF2e degree (name or 0..3) to the effect's outcome.
 *   mode "attack": the ROLLER's degree (attacks, maneuvers): crit / hit / miss
 *   mode "save":   the TARGET's save: critical failure is the effect's crit
 */
export function outcomeFrom(degree, mode) {
  const d = typeof degree === "number" ? degree : DEGREES.indexOf(String(degree ?? ""));
  if (!(d >= 0 && d <= 3)) return "neutral";
  if (mode === "save") return d === 0 ? "crit" : d === 1 ? "hit" : "miss";
  if (mode === "attack") return d === 3 ? "crit" : d === 2 ? "hit" : "miss";
  return "neutral";
}

/* ── curated ───────────────────────────────────────────────────────────── */

/** Spells and actions whose traits mislead or say nothing. Wins over every rule. */
export const FX_CURATED = Object.freeze({
  // force darts: no attack, no save, always land
  "magic-missile": { func: "harm", material: "force", kind: "auto", delivery: "darts" },
  "force-barrage": { func: "harm", material: "force", kind: "auto", delivery: "darts" },
  "telekinetic-projectile": { func: "harm", material: "force" },
  "chromatic-ray": { func: "harm", material: "light", accent: "fire" },
  "prismatic-spray": { material: "light", accent: "fire" },
  "prismatic-ray": { material: "light", accent: "fire" },
  "haste": { func: "movement", material: "air" },
  "slow": { func: "hinder", material: "arcane" },
  "invisibility": { func: "conceal", material: "illusion" },
  "invisibility-sphere": { func: "conceal", material: "illusion" },
  "fly": { func: "movement", material: "air" },
  "dimension-door": { func: "teleport", material: "arcane", kind: "self" },
  "translocate": { func: "teleport", material: "arcane", kind: "self" },
  "teleport": { func: "teleport", material: "arcane", kind: "self" },
  "shield": { func: "protect", material: "force", kind: "self" },
  "mystic-armor": { func: "protect", material: "force", kind: "self" },
  "mage-armor": { func: "protect", material: "force", kind: "self" },
  "fear": { func: "hinder", material: "mental" },
  "sanctuary": { func: "protect", material: "holy" },
  "light": { func: "support", material: "light" },
  "guidance": { func: "support", material: "light" },
  "sure-strike": { func: "support", material: "arcane", kind: "self" },
  "true-strike": { func: "support", material: "arcane", kind: "self" },
  "stabilize": { func: "restore", material: "vitality" },
  "enlarge": { func: "transform", material: "arcane" },
  "shrink": { func: "transform", material: "arcane" },
  "read-aura": { func: "detect", material: "arcane" },
  "see-the-unseen": { func: "detect", material: "light" },
  "see-invisibility": { func: "detect", material: "light" },
  "dispel-magic": { func: "control", material: "arcane" },
  "blur": { func: "conceal", material: "illusion" },
  "mirror-image": { func: "conceal", material: "illusion" },
  "fire-shield": { func: "protect", material: "fire", kind: "self" },
  "stoneskin": { func: "protect", material: "earth" },
  "mountain-resilience": { func: "protect", material: "earth" },
  "resist-energy": { func: "protect", material: "arcane" },
  "obscuring-mist": { func: "conceal", material: "water" },
  "fog-cloud": { func: "conceal", material: "water" },
  "web": { func: "terrain", material: "plant" },
  "grease": { func: "terrain", material: "water" },
  "spiritual-weapon": { func: "harm", material: "spirit" },
  "spiritual-armament": { func: "harm", material: "spirit" },
  "message": { func: "support", material: "mental" },
  "prestidigitation": { func: "support", material: "arcane" },
  "sleep": { func: "hinder", material: "mental" },
  "command": { func: "hinder", material: "mental" },
  "charm": { func: "hinder", material: "mental" },
  "calm": { func: "hinder", material: "mental" },
  "paralyze": { func: "hinder", material: "mental" },
  "dominate": { func: "control", material: "mental" },
  "wall-of-fire": { func: "terrain", material: "fire", area: { shape: "line", r: 0.5, len: 12, width: 1 } },
  // actions (the Actions pack and creature abilities)
  "raise-a-shield": { func: "protect", material: "kinetic", kind: "self" },
  "take-cover": { func: "protect", material: "earth", kind: "self" },
  "rage": { func: "support", material: "fire", kind: "self" },
  // medicine is a kit, not a spell (craft): the patient is the target, not the medic (with no target it falls back to the medic)
  "treat-wounds": { func: "restore", material: "vitality", kind: "auto", craft: "medicine" },
  "battle-medicine": { func: "restore", material: "vitality", kind: "auto", craft: "medicine" },
  "administer-first-aid": { func: "restore", material: "vitality", kind: "auto", craft: "medicine" },
  "treat-poison": { func: "restore", material: "vitality", kind: "auto", craft: "medicine" },
  "treat-disease": { func: "restore", material: "vitality", kind: "auto", craft: "medicine" },
  "lay-on-hands": { func: "restore", material: "vitality" },
  "demoralize": { func: "hinder", material: "mental", kind: "attack" },
  "bon-mot": { func: "hinder", material: "mental", kind: "attack" },
  "feint": { func: "conceal", material: "illusion", kind: "attack" },
  "create-a-diversion": { func: "conceal", material: "illusion", kind: "self" },
  "trip": { func: "control", material: "kinetic", kind: "attack" },
  "grapple": { func: "control", material: "kinetic", kind: "attack" },
  "shove": { func: "control", material: "force", kind: "attack" },
  "reposition": { func: "control", material: "kinetic", kind: "attack" },
  "disarm": { func: "control", material: "metal", kind: "attack" },
  "escape": { func: "support", material: "kinetic", kind: "self" },
  "force-open": { func: "control", material: "earth", kind: "self" },
  "tumble-through": { func: "support", material: "air", kind: "self" },
  "maneuver-in-flight": { func: "support", material: "air", kind: "self" },
  "high-jump": { func: "support", material: "air", kind: "self" },
  "long-jump": { func: "support", material: "air", kind: "self" },
  "leap": { func: "support", material: "air", kind: "self" },
  "seek": { func: "detect", material: "light", kind: "self" },
  "point-out": { func: "detect", material: "light", kind: "self" },
  "hunt-prey": { func: "detect", material: "kinetic" },
  "devise-a-stratagem": { func: "detect", material: "mental" },
  "aid": { func: "support", material: "light" },
  "perform": { func: "support", material: "sonic", kind: "self" },
  "overdrive": { func: "support", material: "electricity", kind: "self" },
  "recall-knowledge": { silent: "no-visual" },
  // the Strike it grants posts (and plays) on its own
  "attack-of-opportunity": { silent: "strike-plays" },
  // a creature's Power Attack card announces the Strike that follows; the Strike plays
  "power-attack": { silent: "strike-plays" },
  "vicious-swing": { silent: "strike-plays" },
  "furious-power-attack": { silent: "strike-plays" },
  "reactive-strike": { silent: "strike-plays" },
  "sense-motive": { silent: "secret" },
  "hide": { silent: "secret" },
  "sneak": { silent: "secret" },
  "avoid-notice": { silent: "secret" },
  "palm-an-object": { silent: "secret" },
  "steal": { silent: "secret" },
});

/** Skill-check actions (`action:<slug>` on a check) that play nothing unless curated above. */
const SILENT_ACTIONS = new Set([
  "stride", "step", "interact", "ready", "sustain", "sustain-a-spell", "dismiss", "release", "drop-prone", "stand",
  "crawl", "climb", "swim", "burrow", "squeeze", "balance", "mount", "arrest-a-fall", "grab-an-edge", "delay",
  "request", "coerce", "make-an-impression", "gather-information", "impersonate", "lie", "subsist", "earn-income",
  "craft", "repair", "identify-magic", "identify-alchemy", "learn-a-spell", "decipher-writing", "borrow-an-arcane-spell",
  "command-an-animal", "conceal-an-object", "disable-a-device", "pick-a-lock", "track", "cover-tracks", "sense-direction",
  "create-forgery", "squeeze", "strike", "cast-a-spell", "activate-an-item",
]);

/* ── material ──────────────────────────────────────────────────────────── */

const TRAIT_MATERIAL = Object.freeze({
  fire: "fire", cold: "cold", electricity: "electricity", acid: "acid", poison: "poison",
  sonic: "sonic", force: "force", vitality: "vitality", void: "void", spirit: "spirit",
  holy: "holy", unholy: "unholy", light: "light", darkness: "shadow", shadow: "shadow", mental: "mental",
  emotion: "mental", fear: "mental", illusion: "illusion", air: "air", earth: "earth", water: "water", wood: "wood",
  metal: "metal", plant: "plant", fungus: "fungal", fungal: "fungal", death: "void", disease: "poison",
  healing: "vitality", teleportation: "arcane", polymorph: "arcane", morph: "arcane", curse: "unholy",
  positive: "vitality", negative: "void", good: "holy", evil: "unholy", sleep: "mental", auditory: "sonic",
  divination: "arcane", scrying: "arcane", detection: "arcane", revelation: "light", possession: "spirit",
  incorporeal: "spirit", ghost: "spirit", undead: "void", fiend: "unholy", celestial: "holy",
  elemental: "earth", fey: "plant", ooze: "acid", radiation: "poison", aberration: "mental",
});

/** Name words, the last resort for material only (never function). */
const NAME_MATERIAL = [
  [/\b(lightning|electri\w*|shock\w*|spark\w*|storm\w*|thunderbolt|volt\w*|galvan\w*)/, "electricity"],
  [/\b(fire(s|ball|bolt|storm|brand)?\b|fiery|flam(e|es|ing)\b|burn\w*|blaz\w*|inferno|ember\w*|scorch\w*|lava|magma|heat\b|pyr[eo]\w*|ignit\w*|sear(s|ing)?\b|smolder\w*|ash(es|en)?\b|kindl\w*|immolat\w*)/, "fire"],
  [/\b(frost\w*|ice|icy|cold|freez\w*|frozen|snow\w*|chill\w*|winter\w*|rime|glaci\w*|hail\w*|blizzard)/, "cold"],
  [/\b(acid\w*|corros\w*|caustic|dissolv\w*|melt\w*)/, "acid"],
  [/\b(poison\w*|venom\w*|toxi\w*|noxious|plague\w*|disease\w*|sicken\w*|blight\w*|rot(s|ting|ten)?\b|miasma)/, "poison"],
  [/\b(thunder\w*|sonic|sound\w*|shriek\w*|scream\w*|roar\w*|howl\w*|songs?\b|sing(s|ing)?\b|wail\w*|shout\w*|boom\w*|resonan\w*|vibrat\w*|cacophon\w*)/, "sonic"],
  [/\b(force|telekin\w*|kinetic)/, "force"],
  [/\b(heal\w*|life|living|vital\w*|restor\w*|mend\w*|cure|regenerat\w*|revive\w*|soothe\w*|renew\w*)/, "vitality"],
  [/\b(death|necro\w*|wither\w*|drain\w*|decay\w*|void|grave\w*|harm|corpse\w*|bone\w*|undeath|soul ?eat\w*|life ?drain)/, "void"],
  [/\b(holy|divine|sacred|celestial|angel\w*|smite\w*|bless\w*|sanct\w*|consecrat\w*|purif\w*|judg\w*|heaven\w*)/, "holy"],
  [/\b(unholy|fiend\w*|demon\w*|devil\w*|infernal|abyss\w*|profan\w*|curse\w*|hex\w*|damn\w*|hell\w*|blasphem\w*|desecrat\w*)/, "unholy"],
  [/\b(spirit\w*|soul\w*|ghost\w*|ectoplasm\w*|astral|ethereal|phantom|haunt\w*|possess\w*)/, "spirit"],
  [/\b(light|radian\w*|sun(s|light|beam|burst)?\b|glow\w*|dazzl\w*|bright\w*|flare|shin(e|es|ing)\b|prism\w*|rainbow|colou?r(s|ful)?\b|daylight|lumin\w*|stars?\b|starlight|starlit|moon\w*|gleam\w*)/, "light"],
  [/\b(shadow\w*|dark\w*|shade\w*|gloom\w*|night\w*|umbra\w*|black|dusk|eclipse)/, "shadow"],
  [/\b(mind\w*|psych\w*|thought\w*|dream\w*|nightmare\w*|fear\w*|terror\w*|frighten\w*|charm\w*|daz(e|ed|ing|zle)\b|mental|mad(ness)?\b|confus\w*|domin\w*|telepath\w*|enthrall\w*|beguil\w*|captivat\w*|insan\w*|memor\w*|demoraliz\w*|intimidat\w*|frightful|menac\w*|horr\w*|despair\w*|gaze|glare|stare)/, "mental"],
  [/\b(illus\w*|phantasm\w*|mirage|disguis\w*|invisib\w*|vanish\w*|glamer\w*|veil\w*|figment\w*|image\w*|blur\w*|decept\w*|trick\w*|mimic\w*|camoufl\w*)/, "illusion"],
  [/\b(wind(s|y)?\b|air|gust\w*|breez\w*|whirl\w*|cyclone|tornado|fly|flying|flight|feather\w*|levitat\w*|wings?\b|tempest|gale|vortex|dive|swoop\w*)/, "air"],
  [/\b(earth\w*|stone\w*|rock\w*|quake\w*|mud|sand\w*|dust\w*|crystal\w*|tremor\w*|burrow\w*|boulder\w*|petrif\w*|gravel|pebble\w*|tunnel\w*|trample\w*|stomp\w*|crush\w*)/, "earth"],
  [/\b(water\w*|waves?\b|tides?\b|tidal|rain(s|storm)?\b|flood\w*|drown\w*|aqua\w*|sea|ocean\w*|mist(s|y)?\b|fog\w*|ink\b|splash\w*|swim\w*|brine|torrent\w*|steam\w*|geyser\w*)/, "water"],
  [/\b(wood(s|en)?\b|trees?\b|bark\b|branch\w*|timber|logs?\b|oak\w*)/, "wood"],
  [/\b(metal\w*|iron\w*|steel\w*|blades?\b|silver\w*|gold(en)?\b|rust\w*|chains?\b|shrapnel|razor\w*)/, "metal"],
  [/\b(plant\w*|vines?\b|thorn\w*|flower\w*|leaf|leaves|roots?\b|briar\w*|brambl\w*|grass\w*|seeds?\b|petal\w*|entangl\w*|pollen|verdan\w*|sap\b|weeds?\b)/, "plant"],
  [/\b(fung\w*|mushroom\w*|spore\w*|mold\w*|mould\w*|lichen)/, "fungal"],
  [/\b(arcane|magic\w*|rune\w*|spell\w*|glyph\w*|mystic\w*|eldritch|sigil\w*|wizard\w*|arcan\w*|counterspell\w*|antimagic)/, "arcane"],
];

export function materialFromName(name) {
  const n = String(name ?? "").toLowerCase();
  for (const [re, m] of NAME_MATERIAL) if (re.test(n)) return m;
  return null;
}

const RUNE_MATERIAL = Object.freeze({
  flaming: "fire", ashen: "fire", frost: "cold", shock: "electricity", conducting: "electricity", energizing: "electricity",
  corrosive: "acid", thundering: "sonic", shockwave: "sonic", holy: "holy", unholy: "unholy", hopeful: "holy",
  "ghost-touch": "spirit", astral: "spirit", wounding: "kinetic", serrating: "kinetic", fearsome: "mental",
  nightmare: "mental", impactful: "force", crushing: "force", brilliant: "light", decaying: "void", deathdrinking: "void",
  earthbinding: "earth", rooting: "plant", disrupting: "vitality", "bolkas-blessing": "vitality", fanged: "kinetic",
});

/** Property runes on a weapon → materials, most significant first. */
export function runeMaterials(item) {
  const props = asArray(sysOf(item).runes?.property);
  const out = [];
  for (const p of props) {
    const k = kebab(p).replace(/^(greater|major|true|lesser|moderate)-/, "");
    const m = RUNE_MATERIAL[k];
    if (m && !out.includes(m)) out.push(m);
  }
  return out;
}

const TRADITION_MATERIAL = Object.freeze({ arcane: "arcane", divine: "light", occult: "mental", primal: "plant" });
/** What a function looks like when nothing names a material. */
const FUNC_MATERIAL = Object.freeze({
  harm: "kinetic", hazard: "kinetic", hinder: "kinetic", control: "kinetic", support: "kinetic", protect: "force",
  restore: "vitality", conceal: "shadow", terrain: "earth", detect: "light", summon: "spirit",
});

function pickMaterial(item, ctx) {
  const scores = new Map();
  const why = new Map();
  const add = (m, w, src) => {
    if (!MATERIAL_SET.has(m) || m === "neutral") return;
    scores.set(m, (scores.get(m) ?? 0) + w);
    if (!why.has(m)) why.set(m, src);
  };
  const { traits, damage, curated, strike } = ctx;
  if (curated?.material) add(curated.material, 1000, "curated");
  if (curated?.accent) add(curated.accent, 400, "curated");
  if (strike) runeMaterials(item).forEach((m, i) => add(m, 90 - i * 5, "rune"));
  const holyish = traits.has("holy") ? "holy" : traits.has("unholy") ? "unholy" : null;
  let physical = false;
  for (const e of damage) {
    let m = DAMAGE_MATERIAL[e.type];
    if (m === "spirit" && holyish) m = holyish;
    // physical damage is the default look, counted once: "piercing and
    // slashing" must not outvote the darkness trait on the same spell
    if (PHYSICAL.has(e.type)) { if (physical) continue; physical = true; }
    const w = PHYSICAL.has(e.type) ? 40 : e.kinds.has("healing") ? 80 : e.persistent ? 60 : 72;
    add(m, w, "damage");
  }
  if (ctx.classified && ctx.classified !== "neutral") add(ctx.classified, 30, "classifier");
  for (const t of traits) if (TRAIT_MATERIAL[t]) add(TRAIT_MATERIAL[t], ["emotion", "fear", "healing", "auditory", "teleportation", "polymorph", "morph", "divination", "elemental", "fey", "ooze", "aberration", "undead", "fiend", "celestial", "incorporeal"].includes(t) ? 24 : 48, "trait");
  const byName = materialFromName(item?.name);
  if (byName) add(byName, 20, "name");
  if (ctx.tradition === "arcane" && ctx.spell) add("arcane", 8, "tradition");
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) {
    // Nothing structured says what it is made of: the tradition's colour for a
    // spell, then what its function usually looks like.
    const fallback = (ctx.spell && TRADITION_MATERIAL[ctx.tradition])
      || (ctx.consumable && (ctx.traits.has("alchemical") ? "water" : ctx.traits.has("magical") ? "arcane" : null))
      || FUNC_MATERIAL[ctx.func]
      // a spell with no tradition (a ritual, a class focus spell): the glyph look
      || (ctx.spell ? "arcane" : null);
    if (fallback) return { material: fallback, accent: null, src: ctx.spell && TRADITION_MATERIAL[ctx.tradition] ? "tradition" : "function" };
    return { material: "neutral", accent: null, src: "none" };
  }
  let [m, w] = ranked[0];
  let src = why.get(m);
  // The damage colours it, the name shapes it: an element the name states is
  // the accent; and plain physical damage yields to it ("Stone Fist" is earth).
  const element = curated?.material ? null : nameElement(item?.name);
  const named = element && MATERIAL_SET.has(element) && element !== "neutral" ? element : null;
  if (named && m === "kinetic" && src !== "rune") { m = named; w = scores.get(named) ?? w; src = "name"; }
  const second = ranked.find(([k, s]) => k !== m && k !== "kinetic" && s >= Math.max(40, w * 0.55));
  const accent = curated?.accent ?? (named && named !== m ? named : second?.[0] ?? null);
  return { material: m, accent, src };
}

/* ── function ──────────────────────────────────────────────────────────── */

/** Spells whose whole point is getting somewhere faster, higher or over something. */
const MOVEMENT_SLUG = /^(fly|haste|longstrider|jump|tailwind|spider-climb|water-walk|air-walk|feather-fall|levitate|freedom-of-movement|expeditious-retreat|wind-walk|swim|swiftness|speed)(-|$)/;

const HINDER_TRAITS =["incapacitation", "emotion", "fear", "mental", "misfortune", "curse", "disease", "sleep", "poison", "death", "possession"];

/** Traits that hinder only when there is something to resist: a mental buff carries them too. */
const SOFT_HINDER = new Set(["mental", "emotion"]);

function pickFunc(item, ctx) {
  const { traits, damage, curated, slug, area, sys } = ctx;
  if (curated?.func) return { func: curated.func, src: "curated" };
  const harmful = damage.filter((e) => e.kinds.has("damage"));
  const healing = damage.filter((e) => e.kinds.has("healing"));
  if (healing.length || harmful.length) {
    // heal/harm: one spell, two answers, decided by who is on the other end
    const both = healing.length && harmful.length;
    if (both) {
      const vital = damage.some((e) => e.type === "vitality" || e.type === "positive");
      const restoreLiving = vital ? !ctx.targetUndead : !!ctx.targetUndead;
      return { func: restoreLiving ? "restore" : "harm", src: "damage" };
    }
    if (healing.length) return { func: ctx.targetUndead && healing.some((e) => e.type === "vitality") ? "harm" : "restore", src: "damage" };
    return { func: traits.has("trap") || ctx.hazard ? "hazard" : "harm", src: "damage" };
  }
  // Spellglass has no word for these three, so they are read before its classifier
  if (traits.has("teleportation")) return { func: "teleport", src: "trait" };
  if (traits.has("polymorph") || traits.has("morph")) return { func: "transform", src: "trait" };
  if (MOVEMENT_SLUG.test(slug)) return { func: "movement", src: "slug" };
  if (ctx.classifiedFunc && ctx.classifiedFunc !== "neutral" && ctx.classifiedConfidence !== "low") return { func: ctx.classifiedFunc, src: "classifier" };
  if (traits.has("summon") || traits.has("summoned") || /^summon-|-summon/.test(slug)) return { func: "summon", src: "trait" };
  if (/^wall-of-|-wall$/.test(slug)) return { func: "terrain", src: "slug" };
  if (traits.has("healing")) return { func: "restore", src: "trait" };
  if (["detection", "scrying", "revelation", "prediction", "divination"].some((t) => traits.has(t))) return { func: "detect", src: "trait" };
  if (traits.has("illusion") || traits.has("darkness") || traits.has("shadow")) return { func: "conceal", src: "trait" };
  if (/(^|-)(ward|wards|warding|protection|barrier|shield|armor|aegis|bulwark|resistance|resist)(-|$)/.test(slug)) return { func: "protect", src: "slug" };
  const save = sys.defense?.save?.statistic ?? (/@Check\[(fortitude|reflex|will)/i.exec(ctx.description)?.[1] ?? null);
  const hinders = HINDER_TRAITS.filter((t) => traits.has(t));
  if (hinders.length && !save && !sys.defense?.passive && hinders.every((t) => SOFT_HINDER.has(t))) return { func: "support", src: "trait-soft" };
  if (hinders.length) return { func: "hinder", src: "trait" };
  if (save || sys.defense?.passive) return { func: "hinder", src: "defense" };
  if (traits.has("fortune") || traits.has("aura") || traits.has("stance")) return { func: "support", src: "trait" };
  if (area) return { func: ctx.spell ? "terrain" : sys.category === "offensive" ? "harm" : "terrain", src: "area" };
  // a creature ability's own heading (PF2e: interaction / defensive / offensive)
  if (sys.category === "defensive" && !ctx.spell) return { func: "protect", src: "category" };
  if (sys.category === "offensive" && !ctx.spell) return { func: traits.has("attack") ? "harm" : "hinder", src: "category" };
  if (ctx.spell) {
    const target = String(sys.target?.value ?? "").toLowerCase();
    if (/willing|ally|allies|\byou\b|creature touched|1 creature/.test(target) || !String(sys.range?.value ?? "").trim()) return { func: "support", src: "target" };
  }
  if (traits.has("attack")) return { func: "harm", src: "trait" };
  // a trap's triggered or active ability is the trap going off
  if (ctx.hazard && sys.actionType?.value && sys.actionType.value !== "passive") return { func: "hazard", src: "hazard" };
  return { func: "neutral", src: "none" };
}

/* ── rank and tradition ────────────────────────────────────────────────── */

export function rankOf(item, opts = {}) {
  const sys = sysOf(item);
  if (item?.type === "spell") {
    const cast = num(opts.castRank) ?? num(sys.location?.heightenedLevel);
    const traits = traitsOf(item);
    if (cast) return clampInt(cast, 1, 10);
    if ((traits.has("cantrip") || traits.has("focus")) && num(opts.actorLevel)) return clampInt(Math.ceil(num(opts.actorLevel) / 2), 1, 10);
    return clampInt(num(sys.level?.value) ?? 1, 1, 10);
  }
  const level = Math.max(num(sys.level?.value) ?? 0, num(opts.actorLevel) ?? 0);
  return clampInt(Math.ceil(level / 2), 1, 10);
}

export function traditionOf(item, opts = {}) {
  const t = opts.casting?.tradition ?? opts.tradition ?? null;
  if (TRADITIONS.includes(t)) return t;
  const sys = sysOf(item);
  const listed = asArray(sys.traits?.traditions).filter((x) => TRADITIONS.includes(x));
  if (listed.length) return listed[0];
  for (const tr of traitsOf(item)) if (TRADITIONS.includes(tr)) return tr;
  return null;
}

/* ── weapon style ──────────────────────────────────────────────────────── */

const RANGED_GROUPS = new Set(["bow", "crossbow", "firearm", "sling", "projectile", "sniper", "laser", "plasma", "shock", "sonic", "flame", "cryo", "corrosive", "poison", "mental", "grenade"]);

/**
 * A Strike's delivery and the weapon style it reads as (depict.mjs STYLE_OF).
 * `opts.ranged` is the attack's own answer when the message knows it (a thrown
 * dagger is a melee weapon thrown).
 */
function strikeOf(item, opts = {}) {
  const sys = sysOf(item);
  const traits = traitsOf(item);
  // PF2e reads an NPC strike's range from its data or its range/thrown trait
  const rangeTrait = [...traits].some((t) => /^(range(-increment)?|thrown)-\d+$/.test(t));
  const linked = opts.weapon && typeof opts.weapon === "object" ? opts.weapon : null;
  const isNpc = item?.type === "melee";
  const ownGroup = slugify(sys.group) || slugify(sysOf(linked).group) || BASE_GROUP[baseItemOf(item)?.base] || "";
  const group = ownGroup;
  const rangedOnly = (RANGED_GROUPS.has(group) || group === "bomb") && !traits.has("combination");
  const itemRanged = isNpc
    ? !!(num(sys.range?.increment) || num(sys.range?.max) || rangeTrait || rangedOnly)
    : (num(sys.range) ?? 0) > 0 || rangedOnly;
  const ranged = typeof opts.ranged === "boolean" ? opts.ranged : itemRanged;
  const heavy = !ranged && (slugify(sys.usage?.value) === "held-in-two-hands" || [...traits].some((t) => /^two-hand-d\d+$/.test(t)));
  const splash = group === "bomb" || traits.has("bomb") || traits.has("splash") || (num(sys.splashDamage?.value) ?? 0) > 0;
  const d = strikeDelivery(item, { ranged, damage: damageOf(item), traits, linked });
  const style = STYLE_OF[d.delivery] ?? (ranged ? "ranged" : "unarmed");
  // the group rides along so a renderer can tell black powder (firearm) from an SF2e gun (projectile)
  return { weapon: { style, ranged, splash, heavy, group: group || null }, delivery: d.delivery, src: d.src, base: d.base, group: d.group };
}

/** A Strike's style: `{ style, ranged, splash, heavy }` (constants.mjs WEAPON_STYLES). */
export function weaponStyleOf(item, opts = {}) {
  return strikeOf(item, opts).weapon;
}

/* ── the entry points ──────────────────────────────────────────────────── */

/** A consumable with one of these does something worth drawing. */
const CONSUMABLE_TRAITS = ["magical", "alchemical", "potion", "elixir", "talisman", "oil", "mutagen", "bomb", "snare", "trap", "gadget", "fulu", "spellheart", "scroll", "wand", "drug", "poison", "healing", "precious"];

const GEAR_TYPES = new Set(["armor", "shield", "backpack", "treasure", "kit", "equipment", "book", "ammo", "lore", "ancestry", "heritage", "background", "class", "deity", "effect", "campaignFeature", "spellcastingEntry"]);

function blank(extra = {}) {
  return { kind: "auto", func: "neutral", material: "neutral", accent: null, rank: 1, tradition: null, weapon: null, area: null, mode: null, condition: null, slug: null, silent: null, craft: null, delivery: null, motif: null, props: [], flavor: null, arch: null, why: {}, ...extra };
}

/**
 * The look axes (docs/SPELLSPRITE_LOOK.md) on top of a finished spec. A silent
 * spec keeps its motif, props and flavor (what it would show) but no delivery.
 */
function depictSpec(item, spec, ctx) {
  const curated = ctx.curated ?? {};
  const traits = ctx.traits ?? new Set();
  let delivery = null, dsrc = "none";
  if (curated.delivery) { delivery = curated.delivery; dsrc = "curated"; }
  else if (spec.silent) { delivery = null; }
  else if (ctx.strikeInfo) { delivery = ctx.strikeInfo.delivery; dsrc = ctx.strikeInfo.src; }
  else {
    const d = actionDelivery(item, { kind: spec.kind, func: spec.func, area: spec.area, traits, damage: ctx.damage ?? [], isSpell: !!ctx.spell, hazard: !!ctx.hazard, sys: ctx.sys });
    delivery = d.delivery; dsrc = d.src;
  }
  const m = curated.motif !== undefined ? { motif: curated.motif, src: "curated" } : motifOf(item, { delivery, base: ctx.strikeInfo?.base, group: ctx.strikeInfo?.group, strike: !!ctx.strikeInfo, traits });
  const p = propsOf(item, { traits, damage: ctx.damage ?? [], rank: spec.rank, cantrip: traits.has("cantrip"), scale: !spec.silent && ctx.scale !== false });
  const f = curated.flavor !== undefined ? { flavor: curated.flavor, src: "curated" } : flavorOf(item, { traits, tradition: spec.tradition, spell: !!ctx.spell });
  const v = inVocab({ delivery, motif: m.motif, props: p.props, flavor: f.flavor });
  const out = { ...spec, ...v, arch: null, why: { ...spec.why, delivery: v.delivery ? dsrc : "none", motif: v.motif ? m.src : "none", props: p.src, flavor: v.flavor ? f.src : "none", arch: "none" } };
  const a = curated.arch !== undefined ? (curated.arch ? { arch: curated.arch, src: "curated" } : null) : pickArch(item, out, traits);
  if (!a) return out;
  out.arch = a.arch; out.why.arch = a.src;
  // an archetype that rescues lifts a costed action out of silence (Mighty Rage, Flurry of Blows, Pounce)
  if (out.silent === "no-function") { out.silent = null; out.func = ARCH[a.arch].func ?? out.func; out.kind = out.kind === "auto" ? "self" : out.kind; out.why.func = "arch"; }
  return out;
}

/**
 * An item's semantics.
 *
 * @param {object} item     an Item document or its plain source (`system` read only)
 * @param {object} [opts]
 *   use          "strike" (an attack roll with this item) | "cast" | "action" | undefined
 *   ranged       the Strike was ranged (message domains), overrides the item
 *   castRank     the cast rank (flags.pf2e.origin.castRank)
 *   casting      flags.pf2e.casting ({ tradition })
 *   tradition    the caster's spellcasting entry tradition
 *   actorLevel   the acting creature's level
 *   targetUndead the (first) target is undead — flips heal/harm
 *   hazard       the actor is a hazard
 *   weapon       an NPC strike's linked weapon item (MeleePF2e#linkedWeapon): its group and base item
 *   description  override the description text
 */
export function describeItem(item, opts = {}) {
  try {
    return describeItemUnsafe(item, opts);
  } catch (error) {
    return blank({ silent: null, why: { error: String(error?.message ?? error) } });
  }
}

function describeItemUnsafe(item, opts) {
  if (!item || typeof item !== "object") return blank({ why: { item: "none" } });
  const sys = sysOf(item);
  const type = item.type;
  // a scroll or wand casts its spell
  if (type === "consumable" && sys.spell && typeof sys.spell === "object") {
    const spell = sys.spell;
    return describeItemUnsafe(spell, { ...opts, castRank: opts.castRank ?? spell.system?.location?.heightenedLevel ?? spell.system?.level?.value, use: "cast" });
  }
  const slug = slugOf(item);
  const traits = traitsOf(item);
  const description = descriptionOf(item, opts);
  const curated = FX_CURATED[slug] ?? null;
  const isSpell = type === "spell";
  const isStrike = opts.use === "strike" || type === "melee" || (type === "weapon" && opts.use !== "action");
  const rank = rankOf(item, opts);
  const tradition = traditionOf(item, opts);
  const base = { slug, rank, tradition };

  if (curated?.silent) return depictSpec(item, blank({ ...base, silent: curated.silent, why: { silent: "curated" } }), { traits, curated, sys });

  if (GEAR_TYPES.has(type) && !isStrike) return blank({ ...base, silent: "gear", why: { silent: "type" } });

  const damage = damageOf(item, { description });
  let classified = null;
  try {
    classified = classify(item, { item, origin: { damage: damage.map((e) => ({ type: e.type })) } });
  } catch { classified = null; }
  const ctx = {
    traits, damage, curated, slug, sys, description, tradition, spell: isSpell, strike: isStrike,
    targetUndead: !!opts.targetUndead, hazard: !!opts.hazard,
    classified: classified?.candidate?.material ?? null,
    classifiedFunc: classified?.semantics?.function ?? null,
    classifiedConfidence: classified?.confidence ?? "low",
    area: null,
  };

  const done = (spec) => depictSpec(item, spec, ctx);

  if (isStrike) {
    const strike = strikeOf(item, { ranged: opts.ranged, weapon: opts.weapon });
    const weapon = strike.weapon;
    ctx.strikeInfo = strike;
    const { material, accent, src } = pickMaterial(item, ctx);
    return done(blank({
      ...base, kind: "strike", func: "harm", material: material === "neutral" ? "kinetic" : material, accent, weapon, mode: "attack",
      area: weapon.splash && weapon.ranged ? { shape: "burst", r: 1, len: null, width: null } : null,
      why: { kind: "strike", func: "strike", material: material === "neutral" ? "default" : src },
    }));
  }

  const area = curated?.area ?? areaOf(item, { description });
  ctx.area = area;
  let { func, src: funcSrc } = pickFunc(item, ctx);
  ctx.consumable = type === "consumable";
  if (ctx.consumable) {
    // mundane supplies (rations, chalk, candles) post a card and show nothing
    if (!damage.length && !area && !CONSUMABLE_TRAITS.some((t) => traits.has(t))) return done(blank({ ...base, silent: "gear", why: { silent: "mundane" } }));
    if (func === "neutral") { func = traits.has("healing") ? "restore" : "support"; funcSrc = "consumable"; }
  }
  ctx.func = func;
  const { material, accent, src: matSrc } = pickMaterial(item, ctx);

  // Actions, feats and abilities play only with something to show.
  if (!isSpell && type !== "consumable") {
    const passive = sys.actionType?.value === "passive" || (type === "feat" && !sys.actionType?.value) || (type === "feat" && sys.actionType?.value === "passive");
    if ((passive && !area && !damage.length && !curated) || (func === "neutral" && !area && !damage.length)) {
      return done(blank({ ...base, func, material, accent, silent: passive ? "passive" : "no-function", why: { func: funcSrc, material: matSrc } }));
    }
  }

  // consumables: potions and elixirs act on the drinker; bombs are Strikes (weapons) above
  if (type === "consumable") {
    const category = slugify(sys.category);
    if (["ammo", "ammunition"].includes(category)) return done(blank({ ...base, silent: "gear", why: { silent: "ammo" } }));
    const drunk = ["potion", "elixir", "drug", "food", "oil", "mutagen", "tea", "medicine"].includes(category) || traits.has("potion") || traits.has("elixir") || traits.has("mutagen");
    if (drunk || (!damage.some((e) => e.kinds.has("damage")) && !area)) {
      return done(blank({ ...base, kind: "self", func, material, accent, area: null, why: { kind: "consumable", func: funcSrc, material: matSrc } }));
    }
  }

  const kind = curated?.kind ?? kindFor(item, { sys, traits, area, func, damage, isSpell, description });
  const mode = kind === "attack" ? "attack" : kind === "save" || kind === "area" ? "save" : null;
  return done(blank({ ...base, kind, func, material, accent, area, mode, craft: curated?.craft ?? null, why: { kind: curated?.kind ? "curated" : "structure", func: funcSrc, material: matSrc } }));
}

function kindFor(item, { sys, traits, area, func, damage, isSpell, description }) {
  if (area) return "area";
  const attack = traits.has("attack") || slugify(sys.defense?.passive?.statistic) === "ac";
  if (attack && (isSpell || damage.length)) return "attack";
  const save = sys.defense?.save?.statistic ?? /@Check\[(fortitude|reflex|will)/i.exec(description)?.[1];
  if (save) return "save";
  if (func === "harm" || func === "hazard") return "auto";
  if (isSpell) {
    const target = String(sys.target?.value ?? "").toLowerCase();
    const range = String(sys.range?.value ?? "").trim().toLowerCase();
    if (target === "you" || (!range && !target)) return "self";
    return "auto";
  }
  return "self";
}

/** A skill action rolled as a check (`action:<slug>` on the message), e.g. Trip, Demoralize. */
export function describeSkillAction(actionSlug, traits = []) {
  const slug = slugify(actionSlug);
  const t = new Set(asArray(traits).map(slugify));
  const item = { name: slug.replace(/-/g, " "), type: "action", system: { slug } };
  const curated = FX_CURATED[slug];
  // a skill action is a check against a creature: auditory and linguistic ones are said
  const said = t.has("auditory") || t.has("linguistic");
  const done = (spec) => depictSpec(item, spec, { traits: t, scale: false, curated: { ...(curated ?? {}), ...(spec.silent || curated?.delivery ? {} : { delivery: said ? "voice" : "form" }) } });
  const fix = (spec) => { const r = done(spec); if (r.delivery && !curated?.delivery) r.why = { ...r.why, delivery: said ? "trait" : "default" }; return r; };
  if (curated?.silent) return fix(blank({ slug, silent: curated.silent, why: { silent: "curated" } }));
  if (curated) return fix(blank({ slug, kind: curated.kind ?? "attack", func: curated.func ?? "neutral", material: curated.material ?? "neutral", accent: curated.accent ?? null, mode: (curated.kind ?? "attack") === "attack" ? "attack" : null, craft: curated.craft ?? null, why: { kind: "curated", func: "curated", material: "curated" } }));
  if (SILENT_ACTIONS.has(slug)) return fix(blank({ slug, silent: "no-visual", why: { silent: "list" } }));
  if (t.has("attack")) return fix(blank({ slug, kind: "attack", func: "control", material: "kinetic", mode: "attack", why: { func: "trait", material: "default" } }));
  const m = [...t].map((x) => TRAIT_MATERIAL[x]).find(Boolean) ?? materialFromName(slug.replace(/-/g, " "));
  if (t.has("mental") || t.has("emotion") || t.has("fear")) return fix(blank({ slug, kind: "attack", func: "hinder", material: m ?? "mental", mode: "attack", why: { func: "trait", material: "trait" } }));
  return fix(blank({ slug, silent: "no-function", why: { silent: "unknown" } }));
}

/** The kineticist's elements, each a material of its own. */
const BLAST_ELEMENTS = new Set(["air", "earth", "fire", "metal", "water", "wood"]);

/**
 * An Elemental Blast's attack. PF2e posts it as an attack roll whose origin is
 * the impulse (an `action` item), with the chosen element, damage type and
 * reach in `context.identifier` (`air.electricity.ranged.1`). The impulse alone
 * reads as a generic control form, so the blast is described from that choice:
 * an energy damage type is the material (air dealing electricity is lightning),
 * physical damage keeps the element (air dealing slashing is a gust).
 * @param {object} item   the impulse
 * @param {{element?: string, damageType?: string, melee?: boolean}} blast
 */
export function describeBlast(item, { element = null, damageType = null, melee = false } = {}) {
  const el = BLAST_ELEMENTS.has(slugify(element)) ? slugify(element)
    : asArray(sysOf(item)?.traits?.value).map(slugify).find((t) => BLAST_ELEMENTS.has(t)) ?? null;
  const dt = slugify(damageType);
  const material = dt && !PHYSICAL.has(dt) && MATERIAL_SET.has(dt) ? dt : el ?? "kinetic";
  const base = describeItem(item, { use: "cast" });
  return {
    ...base, kind: "attack", func: "harm", material, mode: "attack", silent: null,
    delivery: melee ? "touch" : "orb", flavor: base.flavor ?? "impulse",
    why: { ...base.why, kind: "blast", func: "blast", material: dt && material === dt ? "blast-damage" : "blast-element", delivery: "blast" },
  };
}

/** PF2e conditions that are states of knowledge or attitude, not something to draw. */
export const SILENT_CONDITIONS = Object.freeze(new Set([
  "hostile", "unfriendly", "indifferent", "friendly", "helpful", "observed", "hidden", "undetected", "unnoticed",
  "encumbered", "controlled", "broken", "wounded", "cursebound",
]));

const CONDITION_LOOK = Object.freeze({
  blinded: ["hinder", "shadow"], clumsy: ["hinder", "kinetic"], concealed: ["conceal", "illusion"], confused: ["hinder", "mental"],
  dazzled: ["hinder", "light"], deafened: ["hinder", "sonic"], doomed: ["hinder", "void"], drained: ["hinder", "void"],
  dying: ["hinder", "void"], enfeebled: ["hinder", "kinetic"], fascinated: ["hinder", "mental"], fatigued: ["hinder", "air"],
  fleeing: ["hinder", "mental"], frightened: ["hinder", "mental"], grabbed: ["control", "kinetic"], immobilized: ["control", "earth"],
  invisible: ["conceal", "illusion"], "off-guard": ["hinder", "kinetic"], paralyzed: ["control", "arcane"], petrified: ["control", "earth"],
  prone: ["hinder", "kinetic"], quickened: ["support", "air"], restrained: ["control", "metal"], sickened: ["hinder", "poison"],
  slowed: ["hinder", "arcane"], stunned: ["hinder", "light"], stupefied: ["hinder", "mental"], unconscious: ["hinder", "mental"],
  "persistent-damage": ["harm", "kinetic"],
});

/**
 * A condition loop.
 * @param {string} slug     PF2e condition slug
 * @param {object} [opts]   { value, damageType } — damageType for persistent damage
 */
export function describeCondition(slug, opts = {}) {
  const s = slugify(slug);
  const value = num(opts.value);
  if (SILENT_CONDITIONS.has(s)) return blank({ kind: "condition", slug: s, condition: { slug: s, value }, silent: "state", why: { silent: "list", delivery: "none", motif: "none", props: "none", flavor: "none" } });
  const [func, mat] = CONDITION_LOOK[s] ?? ["hinder", "neutral"];
  let material = CONDITIONS[s]?.material ?? mat;
  let damageType = null;
  if (s === "persistent-damage") {
    damageType = slugify(opts.damageType) || null;
    material = DAMAGE_MATERIAL[damageType] ?? material;
  }
  return blank({
    kind: "condition", func, material, slug: s,
    condition: { slug: s, value, ...(damageType ? { damageType } : {}) },
    rank: clampInt(Math.max(1, value ?? 1), 1, 10),
    delivery: "condition", props: s === "persistent-damage" ? ["persistent"] : [],
    why: {
      kind: "condition", func: CONDITION_LOOK[s] ? "table" : "default", material: CONDITIONS[s]?.material ? "overlay" : CONDITION_LOOK[s] ? "table" : "default",
      delivery: "structure", motif: "none", props: s === "persistent-damage" ? "structure" : "none", flavor: "none",
    },
  });
}

/** A persistent damage tick (the end-of-turn roll). */
export function describeTick(damageType, opts = {}) {
  const t = slugify(damageType);
  const c = describeCondition("persistent-damage", { damageType: t, value: opts.value });
  return { ...c, kind: "tick", func: "harm", delivery: "tick", why: { ...c.why, kind: "tick" } };
}

/** For the check and coverage tools. */
export const _internal = Object.freeze({ DAMAGE_MATERIAL, TRAIT_MATERIAL, RUNE_MATERIAL, CONDITION_LOOK, FUNCTION_SET });
