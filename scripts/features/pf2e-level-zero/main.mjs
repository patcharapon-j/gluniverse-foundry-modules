import { SUITE_ID } from "../../core/const.mjs";
import { LevelZeroSheet } from "./sheet.mjs";

const PREFIX = "l0.";
const FLAG_CONFIG = `${PREFIX}config`;
const FLAG_KIND = `${PREFIX}kind`;
const FLAG_SLOT = `${PREFIX}slot`;
const FLAG_SIGNATURE = `${PREFIX}signature`;
const FLAG_FUNDS = `${PREFIX}startingFundsGranted`;
const EFFECT_KIND = "proficiencies";
const ENTRY_KIND = "spellcasting";
const CANTRIP_KIND = "cantrip";
const POWERFUL_FIST_KIND = "powerfulFist";

const MARTIAL_CLASSES = new Set(["barbarian", "champion", "fighter", "ranger", "rogue"]);
const SPELLCASTER_CLASSES = new Set(["bard", "cleric", "druid", "sorcerer", "wizard"]);
const SPELLCASTING_ABILITIES = { bard: "cha", cleric: "wis", druid: "wis", sorcerer: "cha", wizard: "int" };
const FIXED_TRADITIONS = { bard: "occult", cleric: "divine", druid: "primal", wizard: "arcane" };
const syncTimers = new Map();
const syncing = new Set();
const packIndexes = new Map();

export const APPRENTICE_CLASSES = {
  martial: [...MARTIAL_CLASSES],
  spellcaster: [...SPELLCASTER_CLASSES],
};

export function isLevelZeroActor(actor) {
  if (game.system?.id !== "pf2e" || actor?.type !== "character") return false;
  const level = Number(actor.level ?? actor.system?.details?.level?.value);
  return Number.isInteger(level) && level === 0;
}

export function defaultConfig() {
  return {
    simpleWeapon: "",
    skills: [],
    apprentice: "none",
    classSlug: "",
    classSkills: [],
    martialWeapon: "",
    tradition: "arcane",
    castingStyle: "prepared",
    cantrips: [null, null],
  };
}

export function getConfig(actor) {
  const stored = actor?.getFlag?.(SUITE_ID, FLAG_CONFIG) ?? {};
  const config = foundry.utils.mergeObject(defaultConfig(), stored, { inplace: false });
  config.skills = [...new Set((config.skills ?? []).filter((s) => typeof s === "string"))];
  config.classSkills = [...new Set((config.classSkills ?? []).filter((s) => typeof s === "string"))];
  config.cantrips = Array.from({ length: 2 }, (_, index) => config.cantrips?.[index] ?? null);
  return config;
}

export function requiredSkillCount(actor) {
  return Math.max(0, 2 + Math.trunc(Number(actor?.abilities?.int?.mod ?? actor?.system?.abilities?.int?.mod) || 0));
}

export function classSlugFor(config) {
  if (config.apprentice === "alchemist") return "alchemist";
  if (config.apprentice === "monk") return "monk";
  if (config.apprentice === "martial" && MARTIAL_CLASSES.has(config.classSlug)) return config.classSlug;
  if (config.apprentice === "spellcaster" && SPELLCASTER_CLASSES.has(config.classSlug)) return config.classSlug;
  return "";
}

function suiteFlags(kind, extra = {}) {
  return { [SUITE_ID]: { l0: { kind, ...extra } } };
}

function ownedItems(actor, kind = null) {
  return actor.items.filter((item) => {
    const itemKind = item.getFlag?.(SUITE_ID, FLAG_KIND);
    return itemKind && (kind === null || itemKind === kind);
  });
}

function upgrade(path, value = 1) {
  return { key: "ActiveEffectLike", mode: "upgrade", path, value };
}

function weaponProficiency(slug, label) {
  return {
    key: "MartialProficiency",
    kind: "attack",
    slug: `level-zero-${slug}`,
    label,
    definition: [`item:base:${slug}`],
    value: 1,
    visible: true,
  };
}

function buildRules(config) {
  const rules = [
    upgrade("system.perception.rank"),
    upgrade("system.saves.fortitude.rank"),
    upgrade("system.saves.reflex.rank"),
    upgrade("system.saves.will.rank"),
    upgrade("system.proficiencies.attacks.unarmed.rank"),
    upgrade("system.proficiencies.defenses.unarmored.rank"),
  ];

  if (config.simpleWeapon) rules.push(weaponProficiency(config.simpleWeapon, weaponLabel(config.simpleWeapon)));
  for (const skill of [...new Set([...config.skills, ...config.classSkills])]) {
    if (skill in (CONFIG.PF2E?.skills ?? {})) rules.push(upgrade(`system.skills.${skill}.rank`));
  }

  if (config.apprentice === "martial") {
    rules.push(upgrade("system.proficiencies.attacks.simple.rank"));
    rules.push(upgrade("system.proficiencies.defenses.light.rank"));
    if (config.martialWeapon) rules.push(weaponProficiency(config.martialWeapon, weaponLabel(config.martialWeapon)));
  }

  if (config.apprentice === "alchemist") {
    rules.push(upgrade("system.resources.crafting.infusedReagents.max"));
    rules.push({
      key: "CraftingAbility",
      slug: "level-zero-advanced-alchemy",
      label: "GL0.apprentice.alchemist",
      resource: "infusedReagents",
      isAlchemical: true,
      isDailyPrep: true,
      maxItemLevel: 1,
      craftableItems: ["item:trait:alchemical", "item:trait:infused"],
    });
  }

  return rules;
}

function effectSource(config) {
  const rules = buildRules(config);
  const signature = JSON.stringify(rules);
  return {
    name: game.i18n.localize("GL0.effect.name"),
    type: "effect",
    img: "systems/pf2e/icons/default-icons/effect.svg",
    flags: suiteFlags(EFFECT_KIND, { signature }),
    system: {
      description: { value: `<p>${game.i18n.localize("GL0.effect.description")}</p>`, gm: "" },
      rules,
      slug: "gluniverse-level-zero-proficiencies",
      level: { value: 0 },
      traits: { value: [], otherTags: [] },
      duration: { value: -1, unit: "unlimited", expiry: null, sustained: false },
      tokenIcon: { show: false },
      unidentified: false,
      start: { value: 0, initiative: null },
      fromSpell: false,
    },
  };
}

function weaponLabel(slug) {
  const key = CONFIG.PF2E?.baseWeaponTypes?.[slug] ?? slug;
  return game.i18n.localize(key);
}

async function getPackIndex(collection, fields = []) {
  const cacheKey = `${collection}:${fields.join(",")}`;
  if (packIndexes.has(cacheKey)) return packIndexes.get(cacheKey);
  const pack = game.packs.get(collection);
  if (!pack) return [];
  const index = await pack.getIndex({ fields });
  packIndexes.set(cacheKey, index);
  return index;
}

export async function getWeaponOptions(category) {
  const index = await getPackIndex("pf2e.equipment-srd", ["type", "system.category", "system.baseItem"]);
  const slugs = new Set(index
    .filter((entry) => entry.type === "weapon" && entry.system?.category === category)
    .map((entry) => entry.system?.baseItem)
    .filter(Boolean));
  return [...slugs]
    .map((slug) => ({ value: slug, label: weaponLabel(slug) }))
    .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
}

export async function resolveClassSkills(slug) {
  if (!slug) return [];
  const pack = game.packs.get("pf2e.classes");
  if (!pack) return [];
  const index = await getPackIndex(pack.collection, ["system.slug"]);
  const entry = index.find((candidate) => candidate.system?.slug === slug);
  const document = entry ? await pack.getDocument(entry._id) : null;
  return [...new Set(document?.system?.trainedSkills?.value ?? [])];
}

async function syncEffect(actor, config) {
  const effects = ownedItems(actor, EFFECT_KIND);
  const source = effectSource(config);
  const [effect, ...duplicates] = effects;
  if (duplicates.length) await actor.deleteEmbeddedDocuments("Item", duplicates.map((item) => item.id), { render: false });
  const signature = source.flags[SUITE_ID].l0.signature;
  if (effect && effect.getFlag(SUITE_ID, FLAG_SIGNATURE) !== signature) {
    await effect.update({
      name: source.name,
      img: source.img,
      "system.description": source.system.description,
      "system.rules": source.system.rules,
      "system.slug": source.system.slug,
      [`flags.${SUITE_ID}.l0.signature`]: signature,
    }, { render: false });
  } else if (!effect) {
    await actor.createEmbeddedDocuments("Item", [source], { render: false });
  }
}

async function findCompendiumItem(collection, slug) {
  const pack = game.packs.get(collection);
  if (!pack) return null;
  const index = await getPackIndex(pack.collection, ["system.slug"]);
  const entry = index.find((candidate) => candidate.system?.slug === slug);
  return entry ? pack.getDocument(entry._id) : null;
}

async function syncPowerfulFist(actor, config) {
  const existing = ownedItems(actor, POWERFUL_FIST_KIND);
  if (config.apprentice !== "monk") {
    if (existing.length) await actor.deleteEmbeddedDocuments("Item", existing.map((item) => item.id), { render: false });
    return;
  }
  if (existing.length) return;
  const feature = await findCompendiumItem("pf2e.classfeatures", "powerful-fist");
  if (!feature) {
    ui.notifications.warn(game.i18n.localize("GL0.powerfulFistMissing"));
    return;
  }
  const source = feature.toObject();
  delete source._id;
  source.flags = foundry.utils.mergeObject(source.flags ?? {}, suiteFlags(POWERFUL_FIST_KIND));
  await actor.createEmbeddedDocuments("Item", [source], { render: false });
}

function emptySlots() {
  return Object.fromEntries(Array.from({ length: 11 }, (_, rank) => [
    `slot${rank}`,
    { prepared: [], value: 0, max: 0 },
  ]));
}

function entrySource(config) {
  const traditionKey = CONFIG.PF2E?.magicTraditions?.[config.tradition] ?? config.tradition;
  const tradition = game.i18n.localize(traditionKey);
  const ability = SPELLCASTING_ABILITIES[config.classSlug] ?? "cha";
  const slots = emptySlots();
  if (config.castingStyle === "prepared") {
    slots.slot0.max = 2;
    slots.slot0.value = 2;
  }
  const signature = JSON.stringify({ tradition: config.tradition, castingStyle: config.castingStyle, ability });
  return {
    name: game.i18n.format("GL0.spellcasting.name", { tradition }),
    type: "spellcastingEntry",
    img: "systems/pf2e/icons/default-icons/spellcastingEntry.svg",
    flags: suiteFlags(ENTRY_KIND, { signature }),
    system: {
      description: { value: `<p>${game.i18n.localize("GL0.apprentice.spellcasterHint")}</p>`, gm: "" },
      rules: [],
      slug: `level-zero-${config.tradition}-apprentice`,
      ability: { value: ability },
      tradition: { value: config.tradition },
      prepared: { value: config.castingStyle, flexible: false },
      spelldc: { value: 0, dc: 0 },
      showSlotlessLevels: { value: true },
      proficiency: { value: 1 },
      slots,
    },
  };
}

async function syncSpellcasting(actor, config) {
  const entries = ownedItems(actor, ENTRY_KIND);
  const cantrips = ownedItems(actor, CANTRIP_KIND);
  if (config.apprentice !== "spellcaster") {
    const ids = [...entries, ...cantrips].map((item) => item.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids, { render: false });
    return;
  }

  const desiredEntry = entrySource(config);
  const entrySignature = desiredEntry.flags[SUITE_ID].l0.signature;
  let [entry, ...duplicateEntries] = entries;
  if (duplicateEntries.length) await actor.deleteEmbeddedDocuments("Item", duplicateEntries.map((item) => item.id), { render: false });
  if (!entry) {
    [entry] = await actor.createEmbeddedDocuments("Item", [desiredEntry], { render: false });
  } else if (entry.getFlag(SUITE_ID, FLAG_SIGNATURE) !== entrySignature) {
    await entry.update({
      name: desiredEntry.name,
      "system.description": desiredEntry.system.description,
      "system.slug": desiredEntry.system.slug,
      "system.ability.value": desiredEntry.system.ability.value,
      "system.tradition.value": config.tradition,
      "system.prepared.value": config.castingStyle,
      "system.prepared.flexible": false,
      "system.proficiency.value": 1,
      [`flags.${SUITE_ID}.l0.signature`]: entrySignature,
    }, { render: false });
  }

  const bySlot = new Map(cantrips.map((item) => [Number(item.getFlag(SUITE_ID, FLAG_SLOT)), item]));
  const prepared = [];
  for (let slot = 0; slot < 2; slot += 1) {
    const uuid = config.cantrips[slot];
    const current = bySlot.get(slot);
    const currentUuid = current?._stats?.compendiumSource ?? current?.getFlag(SUITE_ID, `${PREFIX}sourceUuid`);
    if (!uuid) {
      if (current) await current.delete({ render: false });
      prepared.push({ id: null, expended: false });
      continue;
    }
    if (current && currentUuid === uuid) {
      if (current.system.location.value !== entry.id) await current.update({ "system.location.value": entry.id }, { render: false });
      prepared.push({ id: current.id, expended: false });
      continue;
    }
    if (current) await current.delete({ render: false });
    const spell = await fromUuid(uuid);
    if (spell?.type !== "spell" || !spell.isCantrip) {
      prepared.push({ id: null, expended: false });
      continue;
    }
    const source = spell.toObject();
    delete source._id;
    source.system.location = { value: entry.id };
    source.flags = foundry.utils.mergeObject(source.flags ?? {}, suiteFlags(CANTRIP_KIND, { slot, sourceUuid: uuid }));
    const [created] = await actor.createEmbeddedDocuments("Item", [source], { render: false });
    prepared.push({ id: created?.id ?? null, expended: false });
  }

  const preparedStyle = config.castingStyle === "prepared";
  const desiredSlot = {
    max: preparedStyle ? 2 : 0,
    value: preparedStyle ? 2 : 0,
    prepared: preparedStyle ? prepared : [],
  };
  const currentSlot = entry._source.system.slots.slot0;
  const currentComparable = {
    max: currentSlot.max,
    value: currentSlot.value,
    prepared: currentSlot.prepared ?? [],
  };
  if (JSON.stringify(currentComparable) !== JSON.stringify(desiredSlot)) {
    await entry.update({
      "system.slots.slot0.max": desiredSlot.max,
      "system.slots.slot0.value": desiredSlot.value,
      "system.slots.slot0.prepared": desiredSlot.prepared,
    }, { render: false });
  }
}

async function cleanup(actor) {
  const ids = ownedItems(actor).map((item) => item.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids, { render: false });
}

export async function syncActor(actor, { render = true } = {}) {
  if (game.system?.id !== "pf2e" || actor?.type !== "character" || syncing.has(actor.id)) return;
  if (!actor.canUserModify?.(game.user, "update")) return;
  syncing.add(actor.id);
  try {
    if (!isLevelZeroActor(actor)) {
      await cleanup(actor);
      return;
    }
    const config = getConfig(actor);
    await syncEffect(actor, config);
    await syncPowerfulFist(actor, config);
    await syncSpellcasting(actor, config);
  } catch (error) {
    console.error(`${SUITE_ID} | Level 0 sync failed`, error);
    ui.notifications.error(game.i18n.format("GL0.error.sync", { message: error?.message ?? String(error) }));
  } finally {
    syncing.delete(actor.id);
    if (render) actor.sheet?.render?.();
  }
}

export function scheduleSync(actor, delay = 40) {
  if (game.system?.id !== "pf2e" || actor?.type !== "character") return;
  clearTimeout(syncTimers.get(actor.id));
  syncTimers.set(actor.id, setTimeout(() => {
    syncTimers.delete(actor.id);
    syncActor(actor);
  }, delay));
}

export async function saveConfig(actor, config) {
  const previous = getConfig(actor);
  const classSlug = classSlugFor(config);
  config.classSlug = classSlug;
  if (config.apprentice === "spellcaster" && FIXED_TRADITIONS[classSlug]) config.tradition = FIXED_TRADITIONS[classSlug];
  config.classSkills = await resolveClassSkills(classSlug);
  await actor.setFlag(SUITE_ID, FLAG_CONFIG, config);
  await syncActor(actor, { render: false });
  if (config.apprentice === "alchemist" && previous.apprentice !== "alchemist") {
    await actor.update({ "system.resources.crafting.infusedReagents.value": 1 }, { render: false });
  }
  actor.sheet?.render?.();
}

export async function setCantrip(actor, slot, uuid) {
  const config = getConfig(actor);
  config.cantrips[slot] = uuid;
  await saveConfig(actor, config);
}

export async function addStartingMoney(actor) {
  if (actor.getFlag(SUITE_ID, FLAG_FUNDS)) return false;
  await actor.inventory.addCoins({ gp: 5 });
  await actor.setFlag(SUITE_ID, FLAG_FUNDS, true);
  actor.sheet?.render?.();
  return true;
}

export function startingMoneyGranted(actor) {
  return actor.getFlag(SUITE_ID, FLAG_FUNDS) === true;
}

export function onReady() {
  LevelZeroSheet.register();
  Hooks.on("updateActor", (actor) => scheduleSync(actor));
  for (const hook of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(hook, (item) => {
      const actor = item?.parent;
      if (actor?.type === "character" && (isLevelZeroActor(actor) || item.getFlag?.(SUITE_ID, FLAG_KIND))) scheduleSync(actor);
    });
  }
  if (game.user.isGM) {
    for (const actor of game.actors.filter((candidate) => candidate.type === "character" && isLevelZeroActor(candidate))) scheduleSync(actor, 250);
  }
}
