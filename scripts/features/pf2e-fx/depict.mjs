/**
 * Spellsprite — depiction: the delivery, motif, props and flavor axes of an
 * FxSpec (docs/SPELLSPRITE_LOOK.md is the contract). Pure: no `game`,
 * `canvas`, `foundry`, `ui` or `Hooks`; the coverage and check tools drive it
 * over the real compendium under plain Node.
 *
 * Every resolver here emits only values listed in constants.mjs
 * (DELIVERY_VOCAB, MOTIF_VOCAB, PROP_VOCAB, FLAVOR_VOCAB) and says where each
 * answer came from: "curated" | "structure" | "name" | "trait" | "default".
 *
 * Names are read as nouns: lower-cased, parentheticals dropped ("Jaws
 * (Agile)"), split on anything that is not a letter or digit, each token made
 * singular. Multi-word phrases are looked up before single words.
 */

import { DELIVERY_VOCAB, MOTIF_VOCAB, PROP_VOCAB, FLAVOR_VOCAB, TRADITIONS } from "./constants.mjs";

const DELIVERY_SET = new Set(DELIVERY_VOCAB);
const MOTIF_SET = new Set(MOTIF_VOCAB);
const PROP_SET = new Set(PROP_VOCAB);
const FLAVOR_SET = new Set(FLAVOR_VOCAB);

const asArray = (v) => (v instanceof Set ? [...v] : Array.isArray(v) ? v : v && typeof v === "object" ? Object.keys(v).filter((k) => v[k]) : []);
const slugify = (v) => String(v ?? "").trim().toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const sysOf = (item) => { try { return item?.system ?? {}; } catch { return {}; } };
/** "a b c" strings to a frozen lookup of word → value. */
const lex = (table) => Object.freeze(Object.fromEntries(Object.entries(table).flatMap(([v, words]) => words.trim().split(/\s+/).map((w) => [w.replace(/_/g, " "), v]))));

/* ── names ─────────────────────────────────────────────────────────────── */

const IRREGULAR = Object.freeze({
  teeth: "tooth", feet: "foot", hooves: "hoof", leaves: "leaf", knives: "knife", wolves: "wolf", axes: "axe", lives: "life",
  glasses: "glass", mice: "mouse", geese: "goose", women: "woman", men: "man", children: "child", staves: "staff", dice: "die",
  scythes: "scythe", spikes: "spike", spines: "spine", vines: "vine", flames: "flame", stones: "stone", runes: "rune",
  blades: "blade", tongues: "tongue", horses: "horse", noses: "nose", bones: "bone", ashes: "ash", lashes: "lash", bushes: "bush",
  missiles: "missile", tentacles: "tentacle", mandibles: "mandible", spittles: "spittle", needles: "needle", bristles: "bristle",
  nettles: "nettle", eyes: "eye", shuriken: "shuriken", series: "series", species: "species", chaos: "chaos", aegis: "aegis",
  iris: "iris", abyss: "abyss", cutlasses: "cutlass", mass: "mass", hydraulics: "hydraulic", pincers: "pincer", wings: "wing",
  pliers: "pliers", scissors: "scissors", shears: "shears", tresses: "tress", entrails: "entrails", guts: "guts", manacles: "manacle",
  fumes: "fume", ashes: "ash", lancers: "lancer", crows: "crow", ravens: "raven", bats: "bat", rats: "rat", wasps: "wasp", bees: "bee",
  spores: "spore", seeds: "seed", words: "word", notes: "note", chords: "chord",
});
const NO_SINGULAR = /(ss|us|is|ys|os)$/;

export function singular(word) {
  const w = String(word ?? "");
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (w.length <= 3 || NO_SINGULAR.test(w)) return w;
  if (/ies$/.test(w)) return `${w.slice(0, -3)}y`;
  if (/(ch|sh|x|z)es$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}

/** A name's noun tokens, singular, parentheticals and modifiers like "+1" dropped. */
export function nameTokens(name) {
  return String(name ?? "").toLowerCase()
    .replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ")
    .replace(/['’]/g, "").split(/[^a-z0-9]+/).filter((t) => t && !/^\d+$/.test(t)).map(singular);
}

/**
 * The first lexicon hit in a token list: phrases (up to four words) before
 * single words, scanning from the head noun (the last token) back to the
 * front unless `order` is "first".
 */
function lookup(tokens, table, { order = "last", skip = null } = {}) {
  // "Staff of Fire": the head noun is the one before "of"
  const of = order === "last" ? tokens.indexOf("of") : -1;
  if (of > 0) {
    // a phrase that spans the "of" ("Flame of Justice") is read whole
    const whole = lookup(tokens, table, { order: "whole", skip });
    if (whole && whole.i < of && whole.i + whole.n > of) return whole;
    const head = lookup(tokens.slice(0, of), table, { order, skip });
    if (head) return head;
    const tail = lookup(tokens.slice(of + 1), table, { order, skip });
    if (tail) return { ...tail, i: tail.i + of + 1 };
  }
  const hits = [];
  for (let n = 4; n >= 1; n--) {
    for (let i = 0; i + n <= tokens.length; i++) {
      const key = tokens.slice(i, i + n).join(" ");
      const v = table[key];
      if (v && !(skip && skip(v))) hits.push({ v, i, n, key });
    }
    if (hits.length) break;
  }
  // a compound word ends in a known noun: "Electrowhip", "Dreamscythe", "Gearblade"
  if (!hits.length) {
    for (let i = 0; i < tokens.length; i++) {
      for (let k = 3; k <= tokens[i].length - 4; k++) {
        const key = singular(tokens[i].slice(k));
        const v = table[key];
        if (v && !(skip && skip(v))) { hits.push({ v, i, n: 1, key }); break; }
      }
    }
  }
  if (!hits.length) return null;
  hits.sort((a, b) => (order === "first" ? a.i - b.i : (b.i + b.n) - (a.i + a.n)));
  if (order === "whole") return hits.find((h) => h.key.split(" ").includes("of")) ?? hits[0];
  return hits[0];
}

/* ── base items ────────────────────────────────────────────────────────── */

/**
 * Every base weapon in PF2e 8.5.1's packs, by group (generated from the
 * equipment pack and every actor's weapons; the coverage tool lists any base
 * item it meets that is missing here). NPC strikes rarely carry their group,
 * so a strike named "Keen Returning Hatchet" finds its hatchet here.
 */
const BASE_BY_GROUP = Object.freeze({
  axe: "adze battle-axe battle-saddle boarding-axe butchering-axe dwarven-war-axe greataxe hand-adze hatchet mambele orc-necksplitter palstave panabas",
  bomb: "alchemical-bomb",
  bow: "bow-staff composite-longbow composite-shortbow crescent-cross daikyu gakgung hongali-hornbow lancer longbow mikazuki phalanx-piercer shield-bow shortbow",
  brawling: "amphisbaena-handwraps bladed-gauntlet bloodknuckles dragon-handwraps fangwire gauntlet handwraps-of-mighty-blows knuckle-duster pantograph-gauntlet piston-gauntlets restorative-handwraps spiked-gauntlet tekko-kagi thorn-whip tonfa",
  club: "aklys battle-lute bo-staff boomerang club exquisite-sword-cane-sheath fighting-stick frying-pan gada gaff greatclub griffon-cane juggling-club khakkhara leiomano light-mace mace macuahuitl maul-spade morningstar nightstick nunchaku probing-cane reinforced-stock reinforced-wheels rungu sap staff tetsubo thundermace war-gavel whip-staff",
  crossbow: "alchemical-crossbow arbalest backpack-ballista crossbow gauntlet-bow hand-crossbow heavy-crossbow repeating-crossbow repeating-hand-crossbow repeating-heavy-crossbow rotary-bow sukgung taw-launcher",
  dart: "atlatl blowgun chakri dart dart-umbrella harpoon javelin rope-dart shuriken stiletto-pen tamchal-chakram war-javelin wrist-launcher",
  firearm: "air-repeater arquebus axe-musket barricade-buster big-boom-gun black-powder-knuckle-dusters blunderbuss cane-pistol clan-pistol coat-pistol dagger-pistol double-barreled-musket double-barreled-pistol dragon-mouth-pistol drake-rifle-acid drake-rifle-cold drake-rifle-electricity drake-rifle-fire drake-rifle-poison dueling-pistol dwarven-scattergun explosive-dogslicer fire-lance flingflenser flintlock-musket flintlock-pistol ghosthands-comet gnome-amalgam-musket gun-sword hammer-gun hand-cannon harmona-gun jezail kaldemashs-lament long-air-repeater mace-multipistol mithral-tree pepperbox piercing-wind rapier-pistol rowan-rifle shield-pistol shobhad-longrifle slide-pistol spider-gun spider-gun-greater spider-gun-major spike-launcher spoon-gun tentacle-cannon tentacle-cannon-greater tentacle-cannon-major three-peaked-tree triggerbrand",
  flail: "bladed-diabolo bladed-scarf combat-fishing-pole combat-grapnel combat-lure dwarven-dorn-dergar fire-poi flail flying-talon gnome-flickmace meteor-hammer monkeys-fist poi sansetsukon scorpion-whip scourge shauth-lash spiked-chain spirit-thresher three-section-naginata urumi war-flail whip whip-claw zhuazhi-bang",
  hammer: "earthbreaker gnome-hooked-hammer light-hammer long-hammer maul orc-skewermaul warhammer",
  knife: "bayonet bladed-hoop chakram clan-dagger claw-blade corset-knife dagger feng-huo-lun fighting-fan flyssa kama karambit katar kris kukri kusarigama lion-scythe main-gauche orc-knuckle-dagger piranha-kiss sai scizore shauth-blade shears sickle starknife throwing-knife tri-bladed-katar visap war-razor wheel-spikes wish-knife",
  pick: "greatpick light-pick ogre-hook pick switchscythe tricky-pick",
  polearm: "bec-de-corbin boarding-pike capturing-spetum donchak fauchard fighting-oar glaive grannys-hedge-trimmer guisarme halberd horsechopper naginata ranseur scythe shuan-ji",
  shield: "shield-boss shield-spikes",
  sling: "backpack-catapult bola halfling-sling-staff kestros sling spraysling sun-sling thunder-sling wrecker",
  spear: "breaching-pike broadspear dancers-spear dueling-spear elven-branched-spear filchers-fork forked-bipod gill-hook injection-spear lance longspear spear trident war-lance",
  sword: "aldori-dueling-sword asp-coil bastard-sword bladesweeper butterfly-sword buugeng chain-sword dandpatta dogslicer elven-curve-blade exquisite-sword-cane falcata falchion gladius greatsword hook-sword jiu-huan-dao kalis katana khopesh liuyedao longsword machete nodachi polytool rapier rhoka-sword sawtooth-saber scimitar serithtial shortsword sickle-saber spiral-rapier sword-cane talwar temple-sword tengu-gale-blade umbrella-injector wakizashi wheel-blades wish-blade zulfikar",
});
/**
 * Starfinder 2e base weapons (PF2e 8.5 defines the groups; the items ship in
 * foundryvtt/pf2e's packs/sf2e, read 2026-11-02). Base items that are also a
 * natural word ("talon", "knife", "hammer") are left to their group.
 */
const SF2E_BASE_BY_GROUP = Object.freeze({
  axe: "doshko fangblade molten-edge plasma-doshko unseen-saw",
  brawling: "assassins-garrote crimson-claw hardlight-handwraps ivory-chompers",
  club: "bone-scepter shock-truncheon skitterstaff wrackstaff",
  corrosive: "acid-dart-rifle adhesive-dispenser biotic-equalizer degeneration-derringer disintegration-lash liquidator reality-ripper",
  crossbow: "crossbolter",
  cryo: "blockthrower cryo-carbine frostmaw numbing-beam-pistol numbing-beam-rifle subliminator thermal-dynafan zero-cannon zero-knife zero-pistol",
  dart: "card-slinger disc-thrower force-needle honor-enforcer injection-shotgun waspslicer",
  flail: "battle-ribbon electroflail monowhip neural-lash vertebralis-thorn",
  flame: "flamethrower skyfire-sword",
  grenade: "grenade-launcher magefoil-grenade szynegation-grenade frag-grenade incendiary-grenade flash-grenade electromag-grenade",
  hammer: "mass-distributed-hammer",
  knife: "aucturnite-chakram laserdisc shooting-starknife tailblade",
  laser: "aeon-rifle aeon-storm artillery-laser grapnel-pick laser-pistol laser-rifle pneumatic-basher rotolaser",
  mental: "meme-cannon phoboverge psyche-pistol",
  pick: "fractal-hook runic-pick",
  plasma: "ionized-slag-lobber plasma-cannon plasma-caster starfall-pistol",
  polearm: "cryopike painglaive spellcarver",
  projectile: "autotarget-rifle battleglove binary-blaster breaching-gun caramel-cannon gyrojet-pistol hardlight-launcher machine-gun magnetar-rifle reaction-breacher rotating-pistol scattergun semi-auto-pistol stellar-cannon",
  shock: "arc-emitter arc-pistol arc-rifle ball-lightning-cannon frytech-rifle polyglove pulsecaster-pistol shock-pad singing-coil skyfire-volt-caster voltaic-rifle",
  sniper: "assassin-rifle coil-rifle disintegration-rifle injection-rifle seeker-rifle shirren-eye-rifle",
  sonic: "boom-pistol boom-shot chordpocalypse dirge-pistol pulse-gauntlet replica-zo-microphone screamer sonic-rifle streetsweeper",
  spear: "atomic-spear plasma-pike singing-spear syringe-skewer",
  sword: "dueling-sword grindblade nano-edge-rapier phase-cutlass plasma-sword puzzleblade quantum-reaver",
});
/** SF2e base items that are also plain words: read from data, never from a name ("Talon" is a claw). */
const DATA_ONLY_BASE = Object.freeze({ grenade: "grenade", baton: "club", knife: "knife", talon: "knife", hammer: "hammer" });
export const BASE_GROUP = Object.freeze({
  ...Object.fromEntries([BASE_BY_GROUP, SF2E_BASE_BY_GROUP].flatMap((t) => Object.entries(t).flatMap(([g, s]) => s.split(" ").map((b) => [b, g])))),
  ...DATA_ONLY_BASE,
});
const BASE_TOKENS = Object.freeze(Object.fromEntries(Object.keys(BASE_GROUP).filter((b) => !DATA_ONLY_BASE[b]).map((b) => [b.split("-").map(singular).join(" "), b])));

/** A base item whose shape is not its group's. */
const BASE_DELIVERY = Object.freeze({
  whip: "lash", "scorpion-whip": "lash", "thorn-whip": "lash", "shauth-lash": "lash", urumi: "lash", "bladed-scarf": "lash", "whip-claw": "lash",
  "combat-fishing-pole": "lash", "combat-lure": "lash",
  javelin: "thrown", "war-javelin": "thrown", harpoon: "thrown", chakri: "thrown", "tamchal-chakram": "thrown", chakram: "thrown",
  boomerang: "thrown", "throwing-knife": "thrown", atlatl: "thrown", bola: "thrown",
  blowgun: "dart", dart: "dart", shuriken: "dart", "stiletto-pen": "dart", "wrist-launcher": "dart", "rope-dart": "dart", "dart-umbrella": "dart",
  "backpack-catapult": "rock", wrecker: "rock",
  "spider-gun": "net", "spider-gun-greater": "net", "spider-gun-major": "net",
  "fire-lance": "jet", "spike-launcher": "dart",
  "lance": "thrust", "war-lance": "thrust", "lion-scythe": "sweep", scythe: "sweep", switchscythe: "sweep",
  "dwarven-scattergun": "pellets", blunderbuss: "pellets", scattergun: "pellets", "injection-shotgun": "pellets",
  "disintegration-lash": "lash", monowhip: "lash", "neural-lash": "lash", "battle-ribbon": "lash", "vertebralis-thorn": "lash",
  "grenade-launcher": "grenade", "assassins-garrote": "squeeze",
});

/** A base item's own motif. */
const BASE_MOTIF = Object.freeze({
  whip: "whip", "scorpion-whip": "whip", "thorn-whip": "thorn", "spiked-chain": "chain", "chain-sword": "chain", blowgun: "needle",
  "meteor-hammer": "comet", "spider-gun": "web", "spider-gun-greater": "web", "spider-gun-major": "web", "tentacle-cannon": "serpent",
  "dragon-mouth-pistol": "dragon", "ghosthands-comet": "comet", "battle-lute": "note", "harmona-gun": "note", "fighting-fan": "feather",
  starknife: "star", "sun-sling": "sun", "mithral-tree": "tree", "three-peaked-tree": "tree",
});

/** The base item a weapon or strike is: its own field, its slug, then its name. */
export function baseItemOf(item) {
  const sys = sysOf(item);
  const hit = lookup(nameTokens(item?.name), BASE_TOKENS);
  for (const v of [sys.baseItem, sys.slug]) {
    const s = slugify(v);
    // the data names the base; the name's matching words are still the weapon, not a motif
    if (s && BASE_GROUP[s]) return { base: s, src: "structure", span: hit?.v === s ? [hit.i, hit.i + hit.n] : null };
  }
  return hit ? { base: hit.v, src: "name", span: [hit.i, hit.i + hit.n] } : null;
}

/* ── deliveries ────────────────────────────────────────────────────────── */

const MELEE_DELIVERIES = new Set(["swing", "chop", "smash", "thrust", "sweep", "stab", "peck", "flail", "lash", "fist", "bash",
  "rake", "jaws", "gore", "sting", "stomp", "buffet", "slam", "pincer", "grasp", "squeeze"]);
const RANGED_DELIVERIES = new Set(["arrow", "bolt", "bullet", "pellets", "slug", "stone", "dart", "thrown", "rock", "bomb", "grenade",
  "laser", "plasma", "zap", "sonicwave", "jet", "mindbeam", "spit", "net", "missile", "ray", "orb"]);

/** PF2e and SF2e weapon groups: [melee, ranged] delivery. */
const GROUP_DELIVERY = Object.freeze({
  sword: ["swing", "thrown"], axe: ["chop", "thrown"], club: ["smash", "thrown"], hammer: ["smash", "thrown"],
  spear: ["thrust", "thrown"], polearm: ["thrust", "thrown"], knife: ["stab", "thrown"], pick: ["peck", "thrown"],
  flail: ["flail", "thrown"], brawling: ["fist", "thrown"], shield: ["bash", "thrown"],
  bow: ["smash", "arrow"], crossbow: ["smash", "bolt"], firearm: ["smash", "bullet"], sling: ["smash", "stone"],
  dart: ["stab", "dart"], bomb: ["bomb", "bomb"],
  // Starfinder 2e
  projectile: ["smash", "bullet"], sniper: ["smash", "slug"], laser: ["smash", "laser"], plasma: ["smash", "plasma"],
  shock: ["smash", "zap"], sonic: ["smash", "sonicwave"], flame: ["smash", "jet"], cryo: ["smash", "jet"],
  corrosive: ["smash", "jet"], poison: ["smash", "jet"], mental: ["smash", "mindbeam"], grenade: ["grenade", "grenade"],
});
export const WEAPON_GROUPS = Object.freeze(Object.keys(GROUP_DELIVERY));
const RANGED_GROUPS = new Set(["bow", "crossbow", "firearm", "sling", "projectile", "sniper", "laser", "plasma", "shock", "sonic", "flame", "cryo", "corrosive", "poison", "mental"]);

/**
 * Attack names to deliveries: the body part or the weapon a creature hits
 * with. 13,100 NPC strikes were read to build this.
 */
const STRIKE_NOUNS = lex({
  rake: "claw talon rake scratch nail hook grasping_claw fingernail razor_claw tail_claw",
  jaws: "jaw bite fang beak mandible maw tooth mouth snout gnash chomp muzzle sucker gullet lamprey nibble gnaw tusked_jaw",
  lash: "tail tentacle tongue tendril vine whip frond stalk lash tress hair beard feeler cilium cilia rope noose scarf sash ribbon streamer root creeper ivy tail_lash cord tether strand thread wire leash chain_lash flagellum hairs entrails guts gut intestine",
  gore: "horn tusk antler gore horned_crown crest ram_horn",
  sting: "stinger sting barb spine quill needle proboscis spike thorn splinter syringe bristle ovipositor stake",
  stomp: "hoof foot leg stomp kick boot paw trample heel talon_foot",
  buffet: "wing pinion feather",
  slam: "slam body pseudopod limb branch arm headbutt head forehead trunk shell carapace knuckle elbow knee punch fist slap bulk mass blow wave_slam stump hand_slam rock_fist shoulder hip rump belly butt appendage wheel incorporeal_wheel " +
    // an elemental's or a spirit's blow: the body of the thing hitting
    "wave gust wind crash surge shock spark flame fire sunfire thunderbolt discharge power crushing_power tornado lunge charge shove ram tackle",
  pincer: "pincer nipper chela claw_pincer pliers",
  grasp: "hand touch grasp caress finger grip clutch palm kiss ghostly_hand spectral_hand shadow_hand web",
  squeeze: "constrict coil crush embrace engulf envelop wrap squeeze hug enfold smother manacle",
  swing: "sword blade saber sabre cutlass edge falchion leaf flame_of_justice polearm scissors shears",
  chop: "axe cleaver hatchet",
  smash: "hammer mace club cudgel maul mallet gavel baton rod staff cane pipe wrench bat stick pan shovel broom book mug bottle tankard ladle rolling_pin crutch log plank lute tome " +
    "rock stone meat hunk door torch flagon pin bowling_pin anchor paddle sleeve table furniture gun long_gun comet bell cobblestone",
  thrust: "spear pike trident lance pitchfork fork harpoon bayonet bowsprit pen fountain_pen quill_pen",
  sweep: "scythe glaive halberd",
  stab: "dagger knife stiletto dirk scalpel shiv athame jambiya scissor shear chisel corkscrew awl icepick dagger_finger shard bone_shard tube",
  peck: "pick",
  flail: "flail chain",
  bash: "shield shield_bash",
});
/** Ranged attack names. */
const RANGED_NOUNS = lex({
  arrow: "arrow bow longbow shortbow",
  bolt: "crossbow ballista",
  bullet: "gun pistol rifle musket firearm bullet cannon revolver carbine shot pepperbox blaster handgun cannon_blast long_gun arm_cannon",
  pellets: "scattergun shotgun blunderbuss scatter_gun buckshot pellet flak flak_thrower shrapnel",
  slug: "sniper longrifle railgun coilgun",
  stone: "sling slingstone pebble",
  dart: "dart shuriken needle quill spine thorn stinger barb spike splinter shard bristle seed pinion feather icicle swarm swarm_strike",
  thrown: "javelin throw toss fling hurl hurled debris fruit coal chair table bottle mug furniture pot teacup spear axe knife dagger hatchet hammer coin card harrow_card object telekinetic_object corpse pitch chakram disc discus blade",
  rock: "rock boulder cobblestone rubble brick stone_chunk meteor_fragment chunk",
  bomb: "bomb flask vial bottled_lightning thunderstone tanglefoot_bag goblinfire alchemist_fire acid_flask frost_vial smoke_bomb blight_bomb skunk_bomb pod spore_pod seedpod explosive_pod",
  grenade: "grenade",
  laser: "laser laser_beam laser_rifle laser_pistol",
  plasma: "plasma",
  zap: "shock spark arc zap electrocution lightning thunderbolt discharge electrical_discharge static live_wire volt",
  sonicwave: "shriek screech scream sonic refrain reverberation song wail howl chord note pulse ultrasonic bell word squeal vocalization snap",
  jet: "jet spray stream squirt flamethrower geyser hose spout wave gust wind crash torch",
  mindbeam: "mental_blast thoughtbarb mind_spike psychic_blast thought psychic_lance",
  spit: "spit spittle glob globule vomit spew bile phlegm splatter venom cough guts spore wad blob sludge",
  net: "web net snare bola_web lasso",
  missile: "missile rocket",
  ray: "beam ray eye_beam eye_ray gaze eye sunfire",
  orb: "orb ball mote wisp foxfire sphere globe bolt blast flame fire firebolt flare glyph star",
});

/** Spell and ability names that refine a harm delivery. */
const HARM_NOUNS = lex({
  darts: "barrage volley missile darts dart needle shard splinter swarm_of hail_of salvo rain_of_arrows",
  fall: "strike fall rain meteor comet column pillar downpour hail rockfall avalanche collapse descent smite deluge cascade starfall sunfall moonbeam skyfall plummet crash_down",
  breath: "breath exhale exhalation belch",
  spit: "spit spittle vomit spew bile",
  gaze: "gaze glance stare glare eye look",
  voice: "word roar shout song scream shriek howl cry command call voice utterance proclamation screech wail chant curse_word rebuke bark croak bellow whisper laugh laughter hymn dirge chorus verse refrain decree",
  touch: "touch grasp hand caress kiss embrace",
  orb: "ball orb sphere globe bolt projectile mote missile bead",
  ray: "ray beam lance",
  wall: "wall",
  net: "web net",
  squeeze: "constrict crush engulf envelop squeeze",
  zap: "arc",
});

/** Ability names, read whole: what a creature's named action does. */
const ABILITY_NOUNS = lex({
  breath: "breath_weapon breath exhale",
  stomp: "trample stomp stampede",
  squeeze: "constrict greater_constrict crush engulf envelop wrap_in_coil tighten_coil squirming_embrace smother coil",
  rake: "rend eager_rend rip_and_tear eviscerate claw_flurry frenzied_slash furious_claw rip_flesh savage flense",
  jaws: "swallow_whole fast_swallow bite gnaw savage_jaw lunging_bite wicked_bite avenging_bite ferocious_gnaw worry blood_drain drink_blood suck_blood feast death_roll",
  thrust: "skewer impale pierce_armor",
  grasp: "seize capture efficient_capture cling attach drag_below drag grab",
  slam: "powerful_charge stampeding_shove sudden_shove charge shove",
  spit: "spit spray_acid acid_spit spew vomit",
  gaze: "gaze glance focus_gaze stare",
  voice: "roar shriek howl scream screech moan croak cry wail bellow utterance proclamation laugh whisper",
  rock: "throw_rock hurl_rock",
  net: "web hurl_net",
  lash: "tail_lash tail_sweep twisting_tail tail_thrash thrash",
  buffet: "wing_thrash wing_buffet wing_rebuff",
  slam: "ground_slam body_slam berserk_slam",
  gore: "gore impaling_charge boar_charge",
  burst: "explode explosion detonate self_destruct",
});

/** A breath's area: the whole mouth's shape. */
const BREATH_RE = /\b(breath|breathes|exhale|exhales)\b/;

/** A spell or ability's name says it falls from the sky. */
const isFallName = (tokens) => !!lookup(tokens, HARM_NOUNS, { skip: (v) => v !== "fall" });

/* ── strikes ───────────────────────────────────────────────────────────── */

const strikeDamage = (damage) => damage.find((e) => ["bludgeoning", "piercing", "slashing"].includes(e.type))?.type ?? null;

/**
 * A Strike's delivery. `ranged` is the attack's own answer (a thrown dagger is
 * a melee weapon thrown).
 * @returns {{ delivery, src, base, group }}
 */
export function strikeDelivery(item, { ranged = false, damage = [], traits = new Set(), linked = null } = {}) {
  const sys = sysOf(item);
  const lsys = linked ? sysOf(linked) : {};
  const isNpc = item?.type === "melee";
  const tokens = nameTokens(item?.name);
  // an NPC strike's linked weapon (flags.pf2e.linkedWeapon) knows its group
  const linkedBase = slugify(lsys.baseItem);
  const based = baseItemOf(item) ?? (linkedBase && BASE_GROUP[linkedBase] ? { base: linkedBase, src: "structure" } : null);
  const ownGroup = slugify(sys.group) || slugify(lsys.group);
  const group = ownGroup || (based ? BASE_GROUP[based.base] : null);
  const groupSrc = ownGroup ? "structure" : based?.src ?? null;
  for (const t of asArray(lsys.traits?.value)) traits = new Set([...traits, slugify(t)]);
  const physical = strikeDamage(damage);
  const scatter = [...traits].some((t) => /^scatter(-\d+)?$/.test(t));
  const out = (delivery, src) => ({ delivery, src, base: based?.base ?? null, group: group || null });

  // a creature's or an ancestry's natural attack is named for the body part
  const natural = isNpc || traits.has("unarmed");
  if (ranged) {
    if (based && BASE_DELIVERY[based.base] && RANGED_DELIVERIES.has(BASE_DELIVERY[based.base])) return out(BASE_DELIVERY[based.base], based.src);
    if (group && GROUP_DELIVERY[group]) {
      let d = GROUP_DELIVERY[group][1];
      // SF2e's scattergun carries `area-cone`, PF2e's blunderbuss `scatter-N`
      if (d === "bullet" && (scatter || traits.has("area-cone"))) d = "pellets";
      if (d === "thrown" && natural) {
        const n = lookup(tokens, RANGED_NOUNS);
        if (n) return out(n.v, "name");
      }
      return out(d, groupSrc);
    }
    const n = lookup(tokens, RANGED_NOUNS);
    if (n) {
      let d = n.v;
      // a bolt or a blast is a crossbow quarrel only when it pierces
      if (d === "orb" && /^(bolt)$/.test(n.key) && physical === "piercing") d = "bolt";
      if (d === "bullet" && scatter) d = "pellets";
      return out(d, "name");
    }
    const m = lookup(tokens, STRIKE_NOUNS);
    if (m) return out(m.v === "sting" ? "dart" : "thrown", "name");
    return out(physical ? "thrown" : "ray", "default");
  }
  // melee
  if (natural) {
    const n = lookup(tokens, STRIKE_NOUNS);
    // a base weapon named in full ("Hook Sword", "Hand Adze") outranks one of its words
    if (n && !(based && BASE_TOKENS_LEN(based) >= Math.max(2, n.n))) {
      // a character's own unarmed blow is a fist, not a creature's slam
      return out(!isNpc && n.v === "slam" ? "fist" : n.v, "name");
    }
  }
  if (based && BASE_DELIVERY[based.base] && MELEE_DELIVERIES.has(BASE_DELIVERY[based.base])) return out(BASE_DELIVERY[based.base], based.src);
  if (group && GROUP_DELIVERY[group] && !RANGED_GROUPS.has(group) && group !== "bomb" && group !== "grenade") {
    let d = GROUP_DELIVERY[group][0];
    if (group === "polearm") d = physical === "slashing" ? "sweep" : physical === "bludgeoning" ? "smash" : "thrust";
    if (group === "sword" && physical === "piercing") d = "thrust";
    if (group === "dart") d = "stab";
    return out(d, groupSrc);
  }
  const n = lookup(tokens, STRIKE_NOUNS);
  if (n) return out(n.v, "name");
  // "False Weapon", "Ghostly Weapon": a weapon, shaped by what it deals
  if (tokens.some((t) => t === "weapon" || t === "armament")) return out(physical === "piercing" ? "thrust" : physical === "bludgeoning" ? "smash" : "swing", "name");
  if (group && GROUP_DELIVERY[group]) {
    // a ranged weapon swung in melee (a gun-sword's blade, a bow's limb)
    return out(physical === "slashing" ? "swing" : physical === "piercing" ? "stab" : "smash", groupSrc);
  }
  return out(physical === "slashing" ? "swing" : physical === "piercing" ? "thrust" : physical === "bludgeoning" ? "smash" : "slam", "default");
}
const NATURAL = new Set(["rake", "jaws", "lash", "gore", "sting", "stomp", "buffet", "slam", "pincer", "grasp", "squeeze"]);
const BASE_TOKENS_LEN = (based) => based.base.split("-").length;

/** The old weapon style a delivery reads as (constants.mjs WEAPON_STYLES). */
export const STYLE_OF = Object.freeze({
  swing: "slash", chop: "slash", sweep: "slash", smash: "bludgeon", flail: "bludgeon", bash: "bludgeon", lash: "bludgeon",
  thrust: "pierce", stab: "pierce", peck: "pierce", gore: "pierce", sting: "pierce", fist: "unarmed", grasp: "unarmed",
  rake: "claw", pincer: "claw", jaws: "bite", stomp: "bludgeon", buffet: "bludgeon", slam: "bludgeon", squeeze: "bludgeon",
  arrow: "ranged", bolt: "ranged", bullet: "ranged", pellets: "ranged", slug: "ranged", stone: "ranged", laser: "ranged",
  plasma: "ranged", zap: "ranged", sonicwave: "ranged", jet: "ranged", mindbeam: "ranged", spit: "ranged", net: "ranged",
  missile: "ranged", ray: "ranged", orb: "ranged",
  thrown: "thrown", dart: "thrown", rock: "thrown", bomb: "thrown", grenade: "thrown",
});

/* ── harm, hazards and forms ───────────────────────────────────────────── */

/**
 * A spell's or an ability's delivery.
 * @param {object} ctx { kind, func, area, traits, damage, isSpell, hazard, sys }
 */
export function actionDelivery(item, ctx) {
  const { kind, func, area, traits } = ctx;
  const sys = ctx.sys ?? sysOf(item);
  const tokens = nameTokens(item?.name);
  const name = tokens.join(" ");
  const harm = func === "harm" || func === "hazard";
  const range = String(sys.range?.value ?? "").toLowerCase();
  const touchRange = /^touch|reach/.test(range.trim());
  const breath = BREATH_RE.test(name) || tokens.includes("exhale");
  const auditory = traits.has("auditory") || traits.has("linguistic");
  const ability = !ctx.isSpell;
  const named = (table, filter) => lookup(tokens, table, filter ? { skip: (v) => !filter(v) } : {});

  // a creature's named action, read whole: Breath Weapon, Trample, Constrict
  if (ability) {
    const a = named(ABILITY_NOUNS);
    if (a && (harm || ["breath", "gaze", "voice", "net", "squeeze", "spit"].includes(a.v))) {
      if (a.v === "breath" && area && !["cone", "line"].includes(area.shape)) return { delivery: area.shape === "emanation" ? "emanation" : "breath", src: "name" };
      return { delivery: a.v, src: "name" };
    }
  }
  const wallName = /^wall-of-|-wall$/.test(slugify(item?.name)) || !!named(HARM_NOUNS, (v) => v === "wall");
  if (wallName) return { delivery: "wall", src: "name" };
  if (!harm) {
    if (traits.has("aura") || (area?.shape === "emanation" && ability && sys.actionType?.value === "passive")) return { delivery: "aura", src: "trait" };
    if (named(HARM_NOUNS, (v) => v === "gaze")) return { delivery: "gaze", src: "name" };
    if (breath && area) return { delivery: "breath", src: "name" };
    if (auditory && named(HARM_NOUNS, (v) => v === "voice")) return { delivery: "voice", src: "trait" };
    return { delivery: "form", src: "default" };
  }
  if (area) {
    const s = area.shape;
    if (s === "cone" || s === "line") {
      if (breath) return { delivery: "breath", src: "name" };
      if (named(HARM_NOUNS, (v) => v === "spit")) return { delivery: "breath", src: "name" };
      return { delivery: s, src: "structure" };
    }
    if (s === "emanation") {
      if (traits.has("aura")) return { delivery: "aura", src: "trait" };
      if (auditory && named(HARM_NOUNS, (v) => v === "voice")) return { delivery: "voice", src: "name" };
      return { delivery: "emanation", src: "structure" };
    }
    if (isFallName(tokens)) return { delivery: "fall", src: "name" };
    const ranged = !!range && !/^(touch|self|varies|--?)$/.test(range.trim()) && !/emanation/.test(range);
    if (ranged && ctx.isSpell) return { delivery: "lob", src: "structure" };
    if (ranged && named(RANGED_NOUNS, (v) => ["bomb", "grenade", "rock", "thrown"].includes(v))) return { delivery: "lob", src: "name" };
    return { delivery: "burst", src: "structure" };
  }
  // a single target
  const n = named(HARM_NOUNS);
  if (n && n.v !== "fall" && n.v !== "wall") {
    if (n.v === "voice" || n.v === "gaze" || n.v === "touch" || n.v === "squeeze") return { delivery: n.v, src: "name" };
    return { delivery: n.v, src: "name" };
  }
  if (n?.v === "fall") return { delivery: "fall", src: "name" };
  if (auditory) return { delivery: "voice", src: "trait" };
  if (touchRange) return { delivery: "touch", src: "structure" };
  if (kind === "attack") return { delivery: "ray", src: "structure" };
  if (ability) {
    const s = named(STRIKE_NOUNS) ?? named(RANGED_NOUNS);
    if (s) return { delivery: s.v, src: "name" };
  }
  if (kind === "save") return { delivery: "bloom", src: "structure" };
  // a harm spell with no range and no target is worn: a body of fire, a mantle
  if (ctx.isSpell && !range.trim() && !String(sys.target?.value ?? "").trim()) return { delivery: "aura", src: "structure" };
  return { delivery: ctx.hazard ? "burst" : "bloom", src: "default" };
}

/* ── motifs ────────────────────────────────────────────────────────────── */

const MOTIF_NOUNS = lex({
  blade: "blade sword saber sabre knife dagger sickle scythe razor cutlass edge glaive scimitar katana falchion cleaver saw buzz_saw",
  weapon: "weapon armament arm_of armory arsenal",
  spear: "spear lance javelin pike trident harpoon lancer",
  arrow: "arrow quarrel",
  hammer: "hammer mallet maul gavel",
  chain: "chain shackle fetter manacle",
  whip: "whip rope lasso lash",
  needle: "needle pin dart sting stinger",
  hand: "hand palm finger grasp grip grasping",
  fist: "fist punch knuckle",
  claw: "claw talon",
  jaws: "jaw maw fang tooth bite mouth",
  eye: "eye gaze glance stare",
  heart: "heart",
  skull: "skull",
  bones: "bone bony skeleton skeletal ossuary",
  blood: "blood vein bloody",
  wing: "wing",
  feather: "feather plume pinion",
  storm: "storm tempest thunderstorm stormburst blizzard",
  cloud: "cloud",
  rain: "rain hail downpour deluge",
  wind: "wind gust gale breeze zephyr",
  tornado: "tornado whirlwind cyclone vortex twister maelstrom whirlpool",
  lightning: "lightning thunderbolt thunderstrike",
  sun: "sun solar sunburst sunlight dawn daylight sunbeam sunfire eclipse",
  moon: "moon lunar moonlight moonbeam moonburst",
  star: "star starlight constellation nova starfall stellar firework skyrocket asterism",
  comet: "comet meteor meteorite",
  stone: "stone rock boulder pebble rubble gravel earth quake earthquake fissure scree sand",
  crystal: "crystal gem diamond prism glass prismatic shard coral",
  spike: "spike stake icicle skewer",
  wave: "wave tide tsunami surge flood torrent hydraulic geyser fountain spout undertow",
  bubble: "bubble foam froth slime muck",
  mist: "mist fog vapor vapour steam haze",
  smoke: "smoke soot smog fume ash fumarole",
  vine: "vine creeper ivy tendril",
  thorn: "thorn briar bramble splinter",
  root: "root",
  flower: "flower blossom petal bloom rose lotus",
  leaf: "leaf foliage",
  tree: "tree oak timber pine",
  spore: "spore mushroom fungus mold pollen",
  ghost: "ghost ghostly spectral phantom spectre specter wraith apparition poltergeist",
  rune: "rune runic",
  glyph: "glyph sigil symbol seal brand mark sign",
  word: "word utterance decree edict insult retort invective rebuke referendum",
  note: "song note melody music chord hymn tune refrain anthem ballad lullaby dirge cacophony aria choir canticle lament",
  bell: "bell chime toll gong",
  mirror: "mirror reflection",
  door: "door portal gate gateway rift",
  mask: "mask",
  crown: "crown tiara diadem",
  coin: "coin",
  card: "card deck harrow tarot",
  serpent: "serpent snake viper asp cobra",
  dragon: "dragon drake wyrm draconic",
  beast: "beast wolf bear lion hound",
  swarm: "swarm locust insect bee hornet wasp vermin crow raven bat rat murmuration",
  web: "web cobweb",
  flame: "flame blaze ember coal",
  orb: "orb ball sphere globe mote wisp fireball snowball",
  ray: "ray beam",
  shield: "shield aegis bulwark",
  wall: "wall rampart barricade",
});

const PHRASE_MOTIF = Object.freeze({ "chain lightning": "chain", "ghostly hand": "hand", "spiritual armament": "weapon", "spiritual weapon": "weapon", "hydraulic push": "wave" });

/** Motifs a delivery already draws: naming them again adds nothing. */
const DELIVERY_MOTIF = Object.freeze({ wall: "wall", ray: "ray", orb: "orb", laser: "ray", gaze: "eye" });

const GROUP_MOTIF = Object.freeze({ sword: "blade", knife: "blade", axe: "blade", polearm: "blade", spear: "spear", hammer: "hammer", bow: "arrow", crossbow: "arrow", flail: "chain", dart: "needle", shield: "shield" });
const DELIVERY_BODY_MOTIF = Object.freeze({ rake: "claw", jaws: "jaws", fist: "fist", grasp: "hand", buffet: "wing", gore: "spike", sting: "needle", squeeze: "serpent", net: "web", arrow: "arrow", bolt: "arrow" });
const TRAIT_MOTIF = Object.freeze({ fungus: "spore" });

/**
 * What a document depicts.
 * @param {{ delivery, group, base, strike, traits }} ctx
 */
export function motifOf(item, ctx = {}) {
  let tokens = nameTokens(item?.name);
  // the words of a base weapon's name are the weapon, not a motif ("Hand Crossbow")
  const span = ctx.strike ? baseItemOf(item)?.span : null;
  if (span) tokens = [...tokens.slice(0, span[0]), ...tokens.slice(span[1])];
  // "Breath Weapon" is a breath, not a weapon
  tokens = tokens.filter((t, i) => !(t === "weapon" && tokens[i - 1] === "breath"));
  const joined = tokens.join(" ");
  for (const [p, m] of Object.entries(PHRASE_MOTIF)) if (new RegExp(`\\b${p}\\b`).test(joined)) return { motif: m, src: "name" };
  const redundant = DELIVERY_MOTIF[ctx.delivery];
  const hit = lookup(tokens, MOTIF_NOUNS, { order: "first", skip: (v) => v === redundant || !MOTIF_SET.has(v) });
  if (hit) return { motif: hit.v, src: "name" };
  if (ctx.base && BASE_MOTIF[ctx.base]) return { motif: BASE_MOTIF[ctx.base], src: "structure" };
  if (ctx.strike) {
    const body = DELIVERY_BODY_MOTIF[ctx.delivery];
    if (body) return { motif: body, src: "structure" };
    if (ctx.group && GROUP_MOTIF[ctx.group]) return { motif: GROUP_MOTIF[ctx.group], src: "structure" };
  }
  for (const t of ctx.traits ?? []) if (TRAIT_MOTIF[t]) return { motif: TRAIT_MOTIF[t], src: "trait" };
  return { motif: null, src: "none" };
}

/* ── props ─────────────────────────────────────────────────────────────── */

const TRAIT_PROP = Object.freeze({
  automatic: "automatic", concussive: "concussive", kickback: "kickback", splash: "splash", sweep: "sweep", agile: "agile",
  forceful: "forceful", backstabber: "backstabber", unwieldy: "unwieldy", tech: "tech", reach: "reach", magical: "magical",
  incapacitation: "incapacitation", fortune: "fortune", misfortune: "misfortune", auditory: "auditory", visual: "visual",
  linguistic: "linguistic", emotion: "emotion", fear: "fear", curse: "curse", polymorph: "polymorph", teleportation: "teleportation",
  summon: "summon", healing: "healing", nonlethal: "nonlethal", holy: "holy", unholy: "unholy", death: "death", light: "light",
  darkness: "darkness", poison: "poison", disease: "disease", area: "area",
});
const PREFIX_PROP = [[/^deadly-/, "deadly"], [/^fatal(-aim)?-/, "fatal"], [/^scatter(-\d+)?$/, "scatter"], [/^volley-/, "volley"], [/^reach-\d+$/, "reach"],
  [/^two-hand-/, "heavy"], [/^boost-/, "boost"], [/^area-/, "area"]];
const PRECIOUS = /^(cold-iron|silver|adamantine|dawnsilver|mithral|orichalcum|djezet|inubrix|noqual|siccatite|sovereign-steel|abysium|duskwood|peachwood|keep-stone|sisterstone|warpglass|dreamweb)/;
const PRECIOUS_NAME = /\b(cold iron|silver|adamantine|dawnsilver|mithral|orichalcum)\b/;

/** Props: how hard and how big. */
export function propsOf(item, ctx = {}) {
  const sys = sysOf(item);
  const out = new Set();
  const srcs = new Set();
  const add = (p, src) => { if (PROP_SET.has(p)) { out.add(p); srcs.add(src); } };
  for (const t of ctx.traits ?? []) {
    if (TRAIT_PROP[t]) add(TRAIT_PROP[t], "trait");
    for (const [re, p] of PREFIX_PROP) if (re.test(t)) add(p, "trait");
  }
  if (slugify(sys.usage?.value) === "held-in-two-hands") add("heavy", "structure");
  if ((num(sys.splashDamage?.value) ?? 0) > 0 || (ctx.damage ?? []).some((e) => e.splash)) add("splash", "structure");
  if ((ctx.damage ?? []).some((e) => e.persistent)) add("persistent", "structure");
  if ((num(sys.runes?.potency) ?? 0) > 0 || asArray(sys.runes?.property).length) add("magical", "structure");
  if (PRECIOUS.test(slugify(sys.material?.type)) || PRECIOUS_NAME.test(String(item?.name ?? "").toLowerCase())) add("precious", "structure");
  if (ctx.power) add("power", "structure");
  const rank = num(ctx.rank);
  if (ctx.scale !== false && rank) {
    if (ctx.cantrip || rank <= 1) add("minor", "rank");
    else if (rank >= 7) add("major", "rank");
  }
  return { props: [...out].sort(), src: srcs.size ? [...srcs].sort().join("+") : "none" };
}

/* ── flavor ────────────────────────────────────────────────────────────── */

/** A trait that names the wind-up outright, before the class does. */
const TRAIT_FLAVOR = Object.freeze({
  rage: "rage", impulse: "impulse", finisher: "finisher", stance: "stance", composition: "composition", spellshape: null,
  apparition: "apparition", esoterica: null, eidolon: "eidolon", tactic: "command", flourish: null, "unstable": "overdrive",
  thrall: "necromancy", rune: "rune", "sanctified": "judgment", "psyche": "psyche", "amp": "psyche", "overflow": "impulse",
});
const CLASS_FLAVOR = Object.freeze({
  barbarian: "rage", monk: "flurry", kineticist: "impulse", gunslinger: "gun", swashbuckler: "finisher", magus: "spellstrike",
  inventor: "overdrive", bard: "composition", ranger: "hunt", rogue: "sneak", champion: "judgment", thaumaturge: "esoterica",
  psychic: "psyche", animist: "apparition", necromancer: "necromancy", runesmith: "rune", commander: "command",
  guardian: "guard", exemplar: "exemplar", summoner: "eidolon",
});
/** Signature actions named outright (an NPC's Rage carries no class trait). */
const SLUG_FLAVOR = Object.freeze({
  rage: "rage", "flurry-of-blows": "flurry", spellstrike: "spellstrike", overdrive: "overdrive", "hunt-prey": "hunt",
  "sneak-attack": "sneak", "devise-a-stratagem": null, "exploit-vulnerability": "esoterica", "unleash-psyche": "psyche",
  "channel-elements": "impulse", "elemental-blast": "impulse", "base-kinesis": "impulse", "trick-attack": "sneak",
  "intimidating-strike": null, "stoke-the-flames": null, "inspire-courage": "composition", "courageous-anthem": "composition",
});

/** Who is doing it: the class signature, then the tradition. */
export function flavorOf(item, ctx = {}) {
  const traits = ctx.traits ?? new Set();
  const type = item?.type;
  if (type === "weapon" || type === "melee") return { flavor: null, src: "none" };
  const slug = slugify(sysOf(item).slug ?? item?.name);
  if (SLUG_FLAVOR[slug]) return { flavor: SLUG_FLAVOR[slug], src: "name" };
  for (const [t, f] of Object.entries(TRAIT_FLAVOR)) if (f && traits.has(t)) return { flavor: f, src: "trait" };
  if (traits.has("cleric") && (traits.has("holy") || traits.has("unholy") || traits.has("sanctified"))) return { flavor: "judgment", src: "trait" };
  for (const [c, f] of Object.entries(CLASS_FLAVOR)) if (traits.has(c)) return { flavor: f, src: "trait" };
  if (ctx.tradition && TRADITIONS.includes(ctx.tradition) && (ctx.spell || ctx.tradition === ctx.castingTradition)) return { flavor: ctx.tradition, src: "tradition" };
  return { flavor: null, src: "none" };
}

/* ── elements in names ─────────────────────────────────────────────────── */

/**
 * Strict element words: a name that says what the effect is made of. Narrower
 * than semantics.mjs's NAME_MATERIAL (which also reads "trample" as earth):
 * this one may override physical damage, so it holds only real elements.
 */
const NAME_ELEMENT = [
  [/\b(cold iron|air repeater)\b/, null],
  [/\b(fire|fiery|flame|flames|flaming|burning|ember|embers|inferno|lava|magma|blaze|blazing|scorching|pyre|searing|molten|hellfire|witchflame|sunfire|firebrand|fireball|firebolt|flamebolt)\b/, "fire"],
  [/\b(frost|frosty|ice|icy|freezing|frozen|snow|rime|glacial|hail|blizzard|cryo|icicle|chill|chilling|frostbite)\b/, "cold"],
  [/\b(lightning|electric|electrical|electricity|shock|shocking|spark|sparks|voltaic|galvanic|thunderbolt|storm)\b/, "electricity"],
  [/\b(acid|acidic|caustic|corrosive)\b/, "acid"],
  [/\b(poison|poisoned|poisonous|venom|venomous|toxic)\b/, "poison"],
  [/\b(thunder|sonic|thunderous)\b/, "sonic"],
  [/\b(stone|earthen|earth|crystal|obsidian|granite|mud)\b/, "earth"],
  [/\b(water|aqueous|tidal|brine|hydraulic)\b/, "water"],
  [/\b(wind|gust|gale|air)\b/, "air"],
  [/\b(shadow|umbral|shade)\b/, "shadow"],
  [/\b(radiant|sunlight|luminous)\b/, "light"],
  [/\b(holy|sacred|celestial)\b/, "holy"],
  [/\b(unholy|infernal|abyssal)\b/, "unholy"],
  [/\b(ghostly|spectral|spirit|phantom|ectoplasmic)\b/, "spirit"],
  [/\b(void|necrotic|withering)\b/, "void"],
  [/\b(psychic|mind|mental)\b/, "mental"],
  [/\b(wooden|wood)\b/, "wood"],
  [/\b(thorny|vine|bramble)\b/, "plant"],
];

/** The element a name states, or null. "Cold iron" is a metal, not cold. */
export function nameElement(name) {
  const n = String(name ?? "").toLowerCase().replace(/\([^)]*\)/g, " ");
  for (const [re, m] of NAME_ELEMENT) if (re.test(n)) return m;
  return null;
}

/* ── vocab guard ───────────────────────────────────────────────────────── */

/** Clamp a depiction to the closed vocabularies (never emit an unlisted value). */
export function inVocab({ delivery = null, motif = null, props = [], flavor = null }) {
  return {
    delivery: DELIVERY_SET.has(delivery) ? delivery : null,
    motif: MOTIF_SET.has(motif) ? motif : null,
    props: asArray(props).filter((p) => PROP_SET.has(p)),
    flavor: FLAVOR_SET.has(flavor) ? flavor : null,
  };
}

export const _lexicons = Object.freeze({ STRIKE_NOUNS, RANGED_NOUNS, HARM_NOUNS, ABILITY_NOUNS, MOTIF_NOUNS, BASE_GROUP, BASE_DELIVERY, GROUP_DELIVERY, CLASS_FLAVOR, TRAIT_FLAVOR, SLUG_FLAVOR, STYLE_OF });
