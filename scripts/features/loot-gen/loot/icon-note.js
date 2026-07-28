/**
 * Icon-note helper — builds the GM-only **Midjourney** prompt that rides along
 * in every generated item's GM notes (DESIGN: GMs swap art after the fact). The
 * block is one copy-pasteable `/imagine` line.
 *
 * Design rule: the image generator has ZERO context — no campaign, no game
 * system, no idea what a "resilient rune" or the "invested" trait is. So the
 * prompt must name a concrete physical object and describe how it *looks*, in
 * plain English. Everything mechanical is either translated into a visual cue
 * (fire → ember glow, rare → ornate masterwork with a magical sheen) or dropped.
 *
 * Two sources feed the appearance: an explicit `hint` the LLM may author
 * (workshop `iconPrompt` / decorator `icon`), else the item's own facts (base
 * item, category, rarity, traits, flavor). Always returns something usable —
 * even a plain compendium pick gets a full prompt.
 */

/* Midjourney tail — composition, render style, then the parameter block. Kept
 * as constants so every item in a hoard produces a visually consistent set. */
const COMPOSITION = "single object centred and filling the frame, three-quarter view, "
  + "plain dark slate background, painterly digital fantasy art, dramatic rim lighting, "
  + "crisp fine detail, high contrast, game inventory art";
const MJ_PARAMS = "--ar 1:1 --style raw --v 7";
const MJ_NEGATIVE = "--no text, letters, numbers, watermark, signature, logo, border, frame, "
  + "hands, people, collage, multiple objects";

/**
 * When a creature portrait rides along as an image reference, say plainly what
 * it is *for*. Portraits in a world come in every style there is — anime, pixel
 * art, 3D render — and none of that belongs on the item. The low `--iw` is the
 * lever that actually holds the style back; the sentence tells the model (and
 * the GM) the intent.
 */
const REF_GUARD = "the reference image is the creature this item came from — take only its "
  + "anatomy, materials, colours and mood from it, never its art style";
const MJ_REF_WEIGHT = "--iw 0.5";

/** Build the plain-text Midjourney prompt for an item. */
export function iconPromptText(info = {}) {
  const { name, type, rarity, traits, flavor, hint, baseItem, category, group } = info;
  const noun = objectNoun({ type, baseItem, category, group, name });
  const parts = [`Square fantasy RPG item icon of ${subject(name, noun)}`];

  const look = appearance({ hint, flavor });
  if (look) parts.push(look);
  else parts.push(defaultMaterial(type, noun)); // no authored look — give it something concrete

  const quality = rarityLook(rarity);
  if (quality) parts.push(quality);
  parts.push(...traitCues(traits));
  parts.push(COMPOSITION);

  const ref = imageRef(info.ref);
  if (ref) parts.push(REF_GUARD);
  const params = ref ? `${MJ_PARAMS} ${MJ_REF_WEIGHT}` : MJ_PARAMS;

  // Midjourney reads image prompts first, then the text, then the parameters.
  return `${ref ? `${ref} ` : ""}${parts.join(", ")} ${params} ${MJ_NEGATIVE}`;
}

/**
 * An image-prompt URL, or "" — only absolute http(s) URLs are usable by
 * Midjourney, and anything else would just be noise pasted into a prompt.
 */
function imageRef(url) {
  const u = clean(url, 400);
  return /^https?:\/\/\S+$/i.test(u) ? u : "";
}

/**
 * Wrap the prompt in the GM-note HTML block folded into a description. Kept
 * visually distinct (a labelled aside) and HTML-escaped. Returns "" if blank.
 */
export function iconNoteHtml(info = {}) {
  const prompt = iconPromptText(info);
  if (!prompt) return "";
  // A local Foundry URL is useless to Midjourney, so say so where it's pasted.
  const refNote = imageRef(info.ref)
    ? `<p class="gllg-icon-note-hint">${esc(i18n("GLLG.icon.refHint", "The leading URL is the source creature's portrait, used as an image reference. Midjourney must be able to reach it — if your Foundry isn't public, upload the portrait to Midjourney and use that URL instead."))}</p>`
    : "";
  return `<aside class="gllg-icon-note" data-visibility="gm">`
    + `<p class="gllg-icon-note-head"><i class="fa-solid fa-palette"></i> <strong>${esc(i18n("GLLG.icon.head", "GM — Midjourney icon prompt"))}</strong></p>`
    + `<p class="gllg-icon-note-body">${esc(prompt)}</p>`
    + `<p class="gllg-icon-note-hint">${esc(i18n("GLLG.icon.hint", "Copy the line above into Midjourney (/imagine). It is written for a generator that knows nothing about your campaign — edit freely."))}</p>`
    + refNote
    + `</aside>`;
}

/* ------------------------------ subject ------------------------------ */

/**
 * The opening noun phrase: the physical object first (so the generator commits
 * to drawing the right *thing*), then the item's name as a theme clause — its
 * words carry the mood ("Frostbite Fang", "Shadowsilk"). The name is dropped
 * when it says nothing the object noun doesn't already ("a longsword — the
 * Longsword").
 */
function subject(name, noun) {
  const nm = artName(name);
  if (!nm || saysNothingNew(nm, noun)) return `${article(noun)} ${noun}`;
  return `${article(noun)} ${noun} — the ${nm}`;
}

/** True when every meaningful word of the name already appears in the noun. */
function saysNothingNew(name, noun) {
  const nounWords = new Set(words(noun));
  return words(name).every(w => nounWords.has(w) || nounWords.has(`${w}s`) || nounWords.has(w.replace(/s$/, "")));
}

const STOPWORDS = new Set(["a", "an", "the", "of", "and", "with", "in", "on", "for", "to"]);

function words(s) {
  return slugWords(s).split(/[^a-z0-9]+/).filter(w => w && !STOPWORDS.has(w));
}

function article(noun) {
  return /^[aeiou]/i.test(String(noun ?? "").trim()) ? "an" : "a";
}

/**
 * Strip the bookkeeping an item name carries for the rules engine but which
 * means nothing to an image generator: potency prefixes ("+1 Striking"),
 * parenthetical grades ("(Greater)"), quantity prefixes.
 */
function artName(name) {
  let s = clean(name, 120);
  s = s.replace(/\([^)]*\)/g, " ");            // "(Greater)", "(Type II)"
  s = s.replace(/^[+-]\d+\s*/, "");            // "+1 "
  s = s.replace(/\b(?:greater|lesser|moderate|major|minor|true|standard)\b\s+(?=striking|resilient|potency)/gi, "");
  s = s.replace(/\b(?:striking|resilient|potency)\b/gi, ""); // rune bookkeeping
  s = s.replace(/^\d+\s*[x×]\s*/i, "");        // "3x "
  return clean(s, 80);
}

/* --------------------------- object identity --------------------------- */

/**
 * The concrete physical thing to draw. Prefer the system's own base item /
 * category / group (a "hand crossbow" is drawable; "weapon" is not), and fall
 * back to a generic-but-still-physical noun per item type.
 */
function objectNoun({ type, baseItem, category, group, name } = {}) {
  const t = String(type ?? "").toLowerCase();

  const base = slugWords(baseItem);
  if (base) return t === "armor" ? armorPhrase(base) : base;

  const cat = slugWords(category);
  if (t === "consumable") return CONSUMABLE_NOUNS[cat] ?? CONSUMABLE_NOUNS[slugWords(group)] ?? "small potion vial or folded scroll";
  if (t === "armor") return armorPhrase(ARMOR_GROUPS[slugWords(group)] ?? cat);
  if (t === "weapon") {
    const g = slugWords(group);
    if (g && g !== "brawling") return g === "firearm" ? "flintlock firearm" : g;
    if (cat === "unarmed") return "pair of fighting gauntlets";
  }
  if (cat && cat !== "unarmed" && cat !== "simple" && cat !== "martial" && cat !== "advanced") return cat;

  // Nothing structured left. Loose types (treasure, gear, containers) usually
  // name the object in the item name itself — "Drowned Guild Ledger" is a
  // ledger — so mine the name's head noun before falling back to a generic.
  if (LOOSE_TYPES.has(t)) {
    const fromName = nounFromName(name);
    if (fromName) return fromName;
  }
  return TYPE_NOUNS[t] ?? "curious magical trinket";
}

/** Types whose generic noun is so vague that the item name is a better guess. */
const LOOSE_TYPES = new Set(["", "treasure", "loot", "equipment", "container", "backpack", "tool", "kit"]);

/**
 * Head noun of an item name: the word before " of " ("Elixir of Life" →
 * elixir), else the last word ("Drowned Guild Ledger" → ledger). Null when
 * that word is too short to be a thing worth drawing.
 */
function nounFromName(name) {
  const all = slugWords(artName(name)).split(/\s+/).filter(Boolean);
  const ofAt = all.indexOf("of");
  const head = words((ofAt > 0 ? all.slice(0, ofAt) : all).join(" ")).pop();
  return head && head.length > 3 ? head : null;
}

/** Generic-but-drawable fallback per item type (PF2e and 5e type vocabularies). */
const TYPE_NOUNS = {
  weapon: "sword-like weapon",
  armor: "suit of armor",
  equipment: "piece of adventuring gear",
  shield: "shield",
  consumable: "small potion vial or folded scroll",
  treasure: "piece of valuable treasure",
  loot: "piece of valuable treasure",
  backpack: "leather backpack",
  container: "sturdy chest",
  tool: "craftsman's tool",
  kit: "packed toolkit",
  ammo: "bundle of ammunition",
  ammunition: "bundle of ammunition"
};

/** PF2e consumable categories → an object a generator can actually picture. */
const CONSUMABLE_NOUNS = {
  potion: "glass potion vial with a corked stopper",
  elixir: "corked elixir bottle",
  oil: "small oil flask",
  poison: "narrow vial of poison",
  drug: "small vial of powder",
  mutagen: "bulbous mutagen bottle",
  scroll: "rolled parchment scroll with a wax seal",
  talisman: "small talisman charm on a cord",
  wand: "slender wand",
  ammo: "bundle of arrows",
  ammunition: "bundle of arrows",
  snare: "coiled trap kit of cord and hooks",
  bomb: "round alchemical bomb with a fuse",
  gadget: "small clockwork gadget",
  tool: "craftsman's tool",
  toolkit: "packed toolkit",
  other: "small magical trinket",
  scrolls: "rolled parchment scroll with a wax seal"
};

/** PF2e armor groups → the material a generator should draw. */
const ARMOR_GROUPS = {
  cloth: "padded cloth",
  leather: "studded leather",
  chain: "chainmail",
  composite: "banded composite",
  plate: "steel plate",
  wood: "carved wooden",
  skeletal: "bone",
  unarmored: "layered travelling clothes"
};

function armorPhrase(desc) {
  const d = clean(desc, 40);
  if (!d) return "suit of armor";
  if (/\b(armor|armour|mail|plate|clothes|robe|shirt)\b/i.test(d)) return `suit of ${d}`;
  return `suit of ${d} armor`;
}

/* ------------------------------ appearance ------------------------------ */

/** The "what it looks like" clause: authored hint first, then item flavor. */
function appearance({ hint, flavor } = {}) {
  const h = stripBoilerplate(hint);
  if (h) return clean(h, 220);
  const f = stripBoilerplate(firstSentences(flavor, 2));
  return f ? clean(f, 180) : "";
}

/**
 * LLM hints often arrive already dressed as a prompt ("Square fantasy item icon
 * of …") or carrying their own parameters. Strip that so we don't stack two
 * lots of framing and two lots of `--ar`.
 */
function stripBoilerplate(s) {
  let out = clean(s, 400);
  if (!out) return "";
  out = out.replace(/\s--\s*\S[\s\S]*$/, " ");                    // trailing --ar 1:1 --v 7 --no …
  out = out.replace(/^(?:a\s+|an\s+|the\s+)?(?:square\s+|round\s+)?(?:fantasy\s+)?(?:rpg\s+)?(?:game\s+)?(?:item\s+|inventory\s+)?(?:icon|image|picture|illustration|render|artwork|art)\s+(?:of|showing|depicting)\s+/i, "");
  out = out.replace(/[,.\s]*\bno\s+(?:text|border|watermark|background|frame)[^,.]*/gi, "");
  // Midjourney reads comma-separated clauses; fold sentence breaks into commas.
  out = out.replace(/[.;]\s+(\S)/g, (_, c) => `, ${c.toLowerCase()}`);
  return clean(out, 400).replace(/[.,;\s]+$/, "");
}

/**
 * Concrete materials, used only when nothing authored a look — a generator with
 * no context needs to be told what the thing is made of. Matched on the object
 * noun first (a scroll is parchment, not glass), type second.
 */
const NOUN_MATERIALS = [
  [/scroll|parchment|map|deed|letter/, "aged parchment, faded ink, cracked red wax seal"],
  [/book|ledger|tome|grimoire|codex/, "worn leather binding, brass clasps, gilt page edges"],
  [/vial|bottle|flask|potion|elixir|mutagen|oil|poison/, "hand-blown glass, corked stopper, weathered paper label"],
  [/ring|amulet|pendant|talisman|charm|necklace|brooch/, "cast precious metal, set gemstone, fine chain"],
  [/wand|staff|rod|sceptre|scepter/, "carved dark wood, metal ferrule, inset stone"],
  [/bow|crossbow|sling/, "laminated wood, waxed cord, blackened steel fittings"],
  [/coin|gem|jewel|crown|goblet|idol|reliquary/, "polished gold and cut gemstones"],
  [/lantern|lamp|candle/, "pitted brass and smoked glass"],
  [/key|lockpick|gear|clockwork/, "tarnished brass and fine steel teeth"],
  [/chest|coffer|box|casket/, "banded oak, iron corners, heavy lock"],
  [/cloak|robe|vestment|cloth|garment|hood/, "heavy dyed cloth, embroidered hem, worn edges"],
  [/boot|glove|gauntlet|belt|bracer|pouch|pack|satchel/, "tooled leather, brass buckles, road wear"],
  [/mask|helm|circlet/, "beaten metal, leather lining, engraved brow"],
  [/drum|horn|flute|lute|instrument/, "polished wood, taut hide, silver banding"]
];

function defaultMaterial(type, noun) {
  for (const [re, material] of NOUN_MATERIALS) if (re.test(noun)) return material;
  switch (String(type ?? "").toLowerCase()) {
    case "weapon": return "forged steel blade, leather-wrapped grip, chipped and scratched from use";
    case "armor": return "layered plates and straps, riveted buckles, scuffed metal";
    case "shield": return "banded rim, painted face, scarred central boss";
    case "consumable": return "hand-blown glass, corked stopper, weathered paper label";
    case "treasure":
    case "loot": return "polished gold and cut gemstones";
    case "tool":
    case "kit": return "worn hardwood and blackened iron fittings";
    default: return "worn leather, dark wood and blackened iron";
  }
}

/** Rarity → craftsmanship and magical presence, never the word "rare" itself. */
function rarityLook(rarity) {
  switch (String(rarity ?? "").toLowerCase().replace(/\s+/g, " ").trim()) {
    case "common": return "plain workmanlike craftsmanship, no enchantment";
    case "uncommon": return "finely crafted with restrained ornament";
    case "rare": return "ornate masterwork with precious inlay and a faint magical sheen";
    case "very rare": return "elaborate masterwork, precious inlay, glowing enchantment";
    case "unique":
    case "legendary":
    case "artifact": return "legendary artifact, intricate ornamentation, radiant magical aura";
    default: return "";
  }
}

/**
 * Game traits → visual cues. Whitelist only: an image generator can draw
 * "wreathed in ember light", it cannot draw "invested" or "interact", and
 * feeding it that jargon just adds noise. Unmapped traits are dropped.
 */
const TRAIT_CUES = {
  fire: "wreathed in ember light and drifting sparks",
  cold: "rimed with frost and pale blue ice",
  electricity: "arcing blue-white sparks",
  lightning: "arcing blue-white sparks",
  acid: "beaded green corrosion",
  sonic: "shimmering rings in the air around it",
  force: "translucent violet energy",
  void: "leaking cold black-violet gloom",
  negative: "leaking cold black-violet gloom",
  vitality: "soft golden-green glow",
  positive: "soft golden-green glow",
  holy: "warm golden radiance, gilded filigree",
  good: "warm golden radiance, gilded filigree",
  radiant: "haloed in clean white light",
  unholy: "sooty black surfaces with a red inner glow",
  evil: "sooty black surfaces with a red inner glow",
  mental: "faint violet aura",
  poison: "sickly green residue",
  shadow: "trailing wisps of dark smoke",
  darkness: "trailing wisps of dark smoke",
  illusion: "faintly translucent with prismatic edges",
  arcane: "etched with glowing blue runes",
  divine: "gold leaf and radiant sigils",
  occult: "eerie violet sigils",
  primal: "living wood, moss and vine",
  earth: "raw stone and unrefined ore",
  air: "wind-carved and weightless",
  water: "wet gleam and flowing forms",
  metal: "polished bright alloy",
  wood: "richly carved grain",
  bone: "pale carved bone",
  undead: "grave-tarnished with bone-pale accents",
  necromancy: "grave-tarnished with bone-pale accents",
  fey: "iridescent and dew-bright",
  dragon: "scaled with clawed motifs",
  alchemical: "chemical stains and alchemical residue",
  clockwork: "brass gears and rivets",
  tech: "brass gears and rivets",
  fungus: "pale fungal growth",
  plant: "sprouting leaves and creeping vine",
  ice: "rimed with frost and pale blue ice",
  spirit: "faintly ghostlit"
};

function traitCues(traits) {
  if (!Array.isArray(traits)) return [];
  const out = [];
  for (const t of traits) {
    const cue = TRAIT_CUES[clean(t, 24).toLowerCase()];
    if (cue && !out.includes(cue)) out.push(cue);
    if (out.length === 3) break;               // keep the prompt readable
  }
  return out;
}

/* ------------------------------ helpers ------------------------------ */

/** "hand-crossbow" / "Hand_Crossbow" → "hand crossbow". */
function slugWords(s) {
  return clean(s, 60).replace(/[_-]+/g, " ").replace(/\s+/g, " ").toLowerCase();
}

function firstSentences(s, n) {
  const txt = clean(s, 400);
  if (!txt) return "";
  const hits = txt.match(/[^.!?]+[.!?]?/g);
  return hits ? hits.slice(0, n).join(" ").trim() : txt;
}

function clean(s, max) {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function escRe(s) {
  return String(s ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Localize with a literal fallback — this module also runs outside Foundry. */
function i18n(key, fallback) {
  const s = globalThis.game?.i18n?.localize?.(key);
  return s && s !== key ? s : fallback;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
