import { escapeHTML as escapeHtml } from "../../core/util.mjs";

// Ported into the GLUniverse Suite. Everything that used to live under the
// standalone package id now uses the single suite id, and every settings/flag
// key is prefixed with the feature prefix ("sbi.") to avoid cross-feature
// collisions. See docs/FEATURE_CONTRACT.md.
const MODULE_ID = "gluniverse-foundry-modules";
const FEATURE_ID = "statsblock-import";
const PREFIX = "sbi.";
const SETTING_MOTION_TIER = `${PREFIX}motionTier`;
const IMPORT_FOLDER = "Imported NPCs";
// Flag keys are prefixed so they don't collide with other features sharing the
// `gluniverse-foundry-modules` flag scope on the same document.
const FLAG_SOURCE = `${PREFIX}sourceMarkdown`;
const FLAG_PARSED = `${PREFIX}parsedData`;
const FLAG_IMPORTED = `${PREFIX}imported`;

// Build a `flags` payload for the suite scope from prefixed (dotted) flag keys,
// expanding "sbi.foo" into the nested shape that `getFlag(MODULE_ID, "sbi.foo")`
// reads back. Keeps document flags consistent with the suite flag scope rules.
function suiteFlags(entries) {
  return { [MODULE_ID]: foundry.utils.expandObject(entries) };
}
// Update-mode keys. Display labels are localized at render time (the lang layer
// is not ready at module-evaluation time).
const IMPORT_MODES = {
  replaceMatching: "GLSBI.modes.replaceMatching",
  replaceAll: "GLSBI.modes.replaceAll",
  appendOnly: "GLSBI.modes.appendOnly",
  coreOnly: "GLSBI.modes.coreOnly",
  itemsOnly: "GLSBI.modes.itemsOnly"
};

const SIZE_MAP = {
  tiny: "tiny",
  sm: "sm",
  small: "sm",
  med: "med",
  medium: "med",
  lg: "lg",
  large: "lg",
  huge: "huge",
  grg: "grg",
  gargantuan: "grg"
};

const SAVE_MAP = {
  fort: "fortitude",
  fortitude: "fortitude",
  ref: "reflex",
  reflex: "reflex",
  will: "will"
};

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
// Fallback lists used only when CONFIG.PF2E is unavailable (e.g. headless parse).
const DAMAGE_TYPES = ["acid", "bleed", "bludgeoning", "cold", "electricity", "fire", "force", "mental", "piercing", "poison", "precision", "slashing", "sonic", "spirit", "vitality", "void"];
const DAMAGE_CATEGORIES = ["persistent", "precision", "splash"];
const CONDITION_WORDS = ["blinded", "broken", "clumsy", "concealed", "confused", "controlled", "dazzled", "deafened", "doomed", "drained", "dying", "encumbered", "enfeebled", "fascinated", "fatigued", "fleeing", "frightened", "grabbed", "hidden", "immobilized", "invisible", "off-guard", "paralyzed", "persistent-damage", "petrified", "prone", "quickened", "restrained", "sickened", "slowed", "stunned", "stupefied", "unconscious", "undetected", "unfriendly", "unnoticed", "wounded"];
const RULE_KEY_FALLBACK = ["ActiveEffectLike", "AdjustDegreeOfSuccess", "AdjustModifier", "AdjustStrike", "Aura", "BaseSpeed", "ChoiceSet", "CreatureSize", "CriticalSpecialization", "DamageDice", "DamageAlteration", "DexterityModifierCap", "Sense", "FastHealing", "FlatModifier", "GrantItem", "Immunity", "ItemAlteration", "MartialProficiency", "MultipleAttackPenalty", "Note", "Resistance", "RollNote", "RollOption", "Strike", "Striking", "TempHP", "TokenImage", "TokenLight", "TokenMark", "Weakness", "WeaponPotency"];

// Read enumerations from the live PF2e system config so validation tracks the
// installed system version instead of drifting against hardcoded lists.
function pf2eConfigKeys(path, fallback = []) {
  const config = globalThis.CONFIG?.PF2E;
  const target = String(path).split(".").reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), config);
  const keys = target && typeof target === "object" ? Object.keys(target) : [];
  return keys.length ? keys : fallback;
}

function getDamageTypeList() {
  return pf2eConfigKeys("damageTypes", DAMAGE_TYPES);
}

function getDamageTypeSet() {
  return new Set(getDamageTypeList().map(slugify));
}

function getConditionSlugs() {
  const manager = globalThis.game?.pf2e?.ConditionManager;
  if (Array.isArray(manager?.conditionsSlugs) && manager.conditionsSlugs.length) return manager.conditionsSlugs;
  return pf2eConfigKeys("conditionTypes", CONDITION_WORDS);
}

function getRuleElementKeys() {
  const all = globalThis.game?.pf2e?.RuleElements?.all;
  const keys = all instanceof Map ? [...all.keys()] : (all && typeof all === "object" ? Object.keys(all) : []);
  return new Set(keys.length ? keys : RULE_KEY_FALLBACK);
}

// ---------------------------------------------------------------------------
// Suite lifecycle. The feature does NOTHING at import time except define things;
// the adapter (index.mjs) calls these from the suite registry.
// ---------------------------------------------------------------------------

/** Always run at init so the menu/setting exist even when the feature is off. */
export function registerSettings() {
  game.settings.registerMenu(MODULE_ID, `${PREFIX}openImporter`, {
    name: "GLSBI.settings.menu.name",
    label: "GLSBI.settings.menu.label",
    hint: "GLSBI.settings.menu.hint",
    icon: "fa-solid fa-file-import",
    type: PF2EStatBlockImporter,
    restricted: true
  });

  // Etched Glass motion tiers (§6.4 of the GL Universe design language).
  game.settings.register(MODULE_ID, SETTING_MOTION_TIER, {
    name: "GLSBI.settings.motionTier.name",
    hint: "GLSBI.settings.motionTier.hint",
    scope: "client",
    config: true,
    type: String,
    choices: { reduced: "GLSBI.settings.motionTier.reduced", default: "GLSBI.settings.motionTier.default", cinematic: "GLSBI.settings.motionTier.cinematic" },
    default: "default",
    onChange: () => Object.values(ui.windows ?? {}).forEach((app) => app instanceof PF2EStatBlockImporter && app.render({ force: false }))
  });
}

/** Run at init only when enabled & available. Wire Foundry hooks here. */
export function onInit() {
  Hooks.on("getActorContextOptions", (_app, options) => {
    options.push({
      name: "GLSBI.contextMenu.import",
      icon: '<i class="fa-solid fa-file-import"></i>',
      condition: () => game.user?.isGM && game.system.id === "pf2e",
      callback: (target) => {
        const li = target instanceof HTMLElement ? target : target?.[0];
        const actorId = li?.dataset.entryId ?? li?.dataset.documentId;
        const actor = game.actors.get(actorId);
        if (!actor || !["npc", "hazard"].includes(actor.type)) {
          ui.notifications.warn(game.i18n.localize("GLSBI.notify.targetTypeOnly"));
          return;
        }
        const importer = new PF2EStatBlockImporter();
        importer.setTargetActor(actor.id);
        importer.render({ force: true });
      }
    });
  });
}

/** Run at ready only when enabled & available. */
export function onReady() {
  if (game.system.id !== "pf2e") {
    ui.notifications?.warn(game.i18n.localize("GLSBI.notify.requiresPf2e"));
  }
}

/** Public API surface, exposed by the adapter on the suite module. */
export const api = {
  open: () => new PF2EStatBlockImporter().render({ force: true }),
  parse: parseStrictMarkdown,
  exportActor: exportActorToMarkdown
};

class PF2EStatBlockImporter extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "gluniverse-pf2e-statblock-importer",
    classes: ["gluniverse-pf2e-importer"],
    tag: "section",
    window: {
      title: "GLSBI.window.title",
      icon: "fa-solid fa-file-import",
      resizable: true
    },
    position: {
      width: 1000,
      height: 760
    }
  };

  #source = "";
  #parsed = null;
  #validation = null;
  #updateMode = "replaceMatching";
  #targetActorId = null;

  setTargetActor(actorId) {
    this.#targetActorId = actorId;
  }

  async _renderHTML() {
    const element = document.createElement("div");
    element.className = "gluni-importer";
    element.innerHTML = this.#renderAppHtml();
    return element;
  }

  _replaceHTML(result, element) {
    element.replaceChildren(result);
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    this.#applyMotionTier(root);
    root.querySelector("textarea[name='source']")?.addEventListener("input", (event) => {
      this.#source = event.currentTarget.value;
    });
    root.querySelector("button[data-action='parse']")?.addEventListener("click", () => this.#parseAndRender());
    root.querySelector("button[data-action='sample']")?.addEventListener("click", () => {
      this.#source = sampleStatBlock();
      this.#parseAndRender();
    });
    root.querySelector("button[data-action='create']")?.addEventListener("click", () => this.#createActor());
    root.querySelector("button[data-action='update']")?.addEventListener("click", () => this.#updateActor());
    root.querySelector("button[data-action='export']")?.addEventListener("click", () => this.#exportSelectedActor());
    root.querySelector("button[data-action='insertRuleHelper']")?.addEventListener("click", () => this.#insertRuleHelper());
    root.querySelector("select[name='updateMode']")?.addEventListener("change", (event) => {
      this.#updateMode = event.currentTarget.value;
    });
  }

  #applyMotionTier(root) {
    const node = root?.closest?.(".application") ?? root;
    if (!node) return;
    const tier = game.settings.get(MODULE_ID, SETTING_MOTION_TIER) ?? "default";
    node.classList.remove("gl-motion-reduced", "gl-motion-default", "gl-motion-cinematic");
    node.classList.add(`gl-motion-${tier}`);
  }

  #renderAppHtml() {
    const actors = game.actors.filter((actor) => ["npc", "hazard"].includes(actor.type)).sort((a, b) => a.name.localeCompare(b.name));
    const actorOptions = actors.map((actor) => `<option value="${escapeHtml(actor.id)}" ${this.#targetActorId === actor.id ? "selected" : ""}>${escapeHtml(actor.name)}</option>`).join("");
    const modeOptions = Object.entries(IMPORT_MODES).map(([value, labelKey]) => `<option value="${value}" ${this.#updateMode === value ? "selected" : ""}>${escapeHtml(game.i18n.localize(labelKey))}</option>`).join("");
    const t = (key) => escapeHtml(game.i18n.localize(key));
    return `
      <header class="gluni-header">
        <div class="gluni-header-main">
          <p class="gluni-kicker">${t("GLSBI.dialog.kicker")}</p>
          <h1><i class="fa-solid fa-file-import"></i> ${t("GLSBI.dialog.heading")}</h1>
          <p class="gluni-subtitle">${t("GLSBI.dialog.subtitle")}</p>
        </div>
        <div class="gluni-meta">
          <span class="gluni-serial">GLU·SB // INTAKE·0001</span>
          <span class="gluni-cmyk" aria-hidden="true"><span></span><span></span><span></span><span></span></span>
          <span class="gluni-data-strip" aria-hidden="true"></span>
        </div>
      </header>
      <div class="gluni-body">
        <section class="gluni-input">
          <label class="gluni-field gluni-field-grow">
            <span class="gluni-label">${t("GLSBI.dialog.sourceLabel")}</span>
            <textarea name="source" spellcheck="false" placeholder="${t("GLSBI.dialog.sourcePlaceholder")}">${escapeHtml(this.#source)}</textarea>
          </label>
          <div class="gluni-actions">
            <button class="gluni-primary" type="button" data-action="parse"><i class="fa-solid fa-magnifying-glass-chart"></i> ${t("GLSBI.dialog.parsePreview")}</button>
            <button type="button" data-action="sample"><i class="fa-solid fa-wand-magic-sparkles"></i> ${t("GLSBI.dialog.loadSample")}</button>
          </div>

          <label class="gluni-field">
            <span class="gluni-label">${t("GLSBI.dialog.updateModeLabel")}</span>
            <select name="updateMode">${modeOptions}</select>
          </label>

          <fieldset class="gluni-rule-helper">
            <legend>${t("GLSBI.dialog.ruleHelperLegend")}</legend>
            <div class="gluni-rule-grid">
              <select name="ruleHelperType">
                <option value="FlatModifier">FlatModifier</option>
                <option value="RollOption">RollOption</option>
                <option value="Aura">Aura</option>
                <option value="Note">Note</option>
                <option value="GrantItem">GrantItem</option>
              </select>
              <input type="text" name="ruleHelperSelector" placeholder="${t("GLSBI.dialog.ruleHelperSelectorPlaceholder")}">
              <input type="text" name="ruleHelperValue" placeholder="${t("GLSBI.dialog.ruleHelperValuePlaceholder")}">
            </div>
            <button type="button" data-action="insertRuleHelper"><i class="fa-solid fa-plus"></i> ${t("GLSBI.dialog.insertRuleElement")}</button>
          </fieldset>

          <div class="gluni-actions gluni-target">
            <button class="gluni-primary" type="button" data-action="create" ${this.#parsed?.valid ? "" : "disabled"}><i class="fa-solid fa-plus"></i> ${t("GLSBI.dialog.createNpc")}</button>
            <select name="targetActor">${actorOptions}</select>
            <button type="button" data-action="update" ${this.#parsed?.valid ? "" : "disabled"}><i class="fa-solid fa-pen-to-square"></i> ${t("GLSBI.dialog.update")}</button>
            <button type="button" data-action="export"><i class="fa-solid fa-file-export"></i> ${t("GLSBI.dialog.export")}</button>
          </div>

          <p class="gluni-hint">${t("GLSBI.dialog.hint")}</p>
        </section>
        <section class="gluni-preview">${renderPreview(this.#parsed, this.#validation)}</section>
      </div>
    `;
  }

  async #parseAndRender() {
    this.#parsed = parseStrictMarkdown(this.#source);
    this.#validation = await validateParsed(this.#parsed);
    this.render({ force: true });
  }

  async #createActor() {
    if (!this.#requireParsed()) return;
    const folder = await getOrCreateFolder();
    const actorData = await buildActorSource(this.#parsed.npc, this.#source);
    actorData.folder = folder?.id ?? null;
    const actor = await Actor.create(actorData, { renderSheet: false });
    await importItems(actor, this.#parsed.npc, { mode: "appendOnly" });
    await actor.sheet.render(true);
    ui.notifications.info(game.i18n.format(actor.type === "hazard" ? "GLSBI.notify.createdHazard" : "GLSBI.notify.createdNpc", { name: actor.name }));
  }

  async #updateActor() {
    if (!this.#requireParsed()) return;
    const actorId = this.element.querySelector("select[name='targetActor']")?.value;
    const actor = game.actors.get(actorId);
    if (!actor || !["npc", "hazard"].includes(actor.type)) {
      ui.notifications.warn(game.i18n.localize("GLSBI.notify.selectActorUpdate"));
      return;
    }
    if (actor.type !== resolveActorType(this.#parsed.npc)) {
      ui.notifications.warn(game.i18n.format("GLSBI.notify.typeMismatch", { parsedType: resolveActorType(this.#parsed.npc), actorType: actor.type }));
      return;
    }
    if (this.#updateMode !== "itemsOnly") {
      const actorData = await buildActorSource(this.#parsed.npc, this.#source);
      delete actorData.name;
      delete actorData.type;
      delete actorData.prototypeToken;
      await actor.update(actorData);
    }
    if (this.#updateMode !== "coreOnly") await importItems(actor, this.#parsed.npc, { mode: this.#updateMode });
    await actor.sheet.render(true);
    ui.notifications.info(game.i18n.format("GLSBI.notify.updated", { actorType: actor.type, name: actor.name }));
  }

  async #exportSelectedActor() {
    const actorId = this.element.querySelector("select[name='targetActor']")?.value;
    const actor = game.actors.get(actorId);
    if (!actor || !["npc", "hazard"].includes(actor.type)) {
      ui.notifications.warn(game.i18n.localize("GLSBI.notify.selectActorExport"));
      return;
    }
    this.#source = exportActorToMarkdown(actor);
    await this.#parseAndRender();
    ui.notifications.info(game.i18n.format("GLSBI.notify.exported", { actorType: actor.type, name: actor.name }));
  }

  #insertRuleHelper() {
    const root = this.element;
    const textarea = root.querySelector("textarea[name='source']");
    if (!textarea) return;
    const type = root.querySelector("select[name='ruleHelperType']")?.value ?? "FlatModifier";
    const selector = root.querySelector("input[name='ruleHelperSelector']")?.value?.trim() ?? "";
    const value = root.querySelector("input[name='ruleHelperValue']")?.value?.trim() ?? "";
    const rule = buildRuleHelperObject(type, selector, value);
    const insert = `\nRuleElements:\n- ${JSON.stringify(rule)}\n`;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    textarea.value = `${textarea.value.slice(0, start)}${insert}${textarea.value.slice(end)}`;
    this.#source = textarea.value;
    textarea.focus();
  }

  #requireParsed() {
    if (!this.#parsed) {
      ui.notifications.warn(game.i18n.localize("GLSBI.notify.parseFirst"));
      return false;
    }
    if (!this.#parsed.valid) {
      ui.notifications.error(game.i18n.localize("GLSBI.notify.fixErrors"));
      return false;
    }
    return true;
  }
}

function parseStrictMarkdown(source) {
  const npc = createEmptyNpc();
  const warnings = [];
  const errors = [];
  const original = String(source ?? "");
  const markdown = looksLikeStrictMarkdown(original) ? original : convertLooseToStrict(original, warnings);
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let section = "core";
  let block = null;
  let multilineKey = null;

  const finishBlock = () => {
    if (!block) return;
    normalizeBlock(block, npc, warnings);
    block = null;
    multilineKey = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const h1 = line.match(/^#\s+(.+)$/);
    const h2 = line.match(/^##\s+(.+)$/);
    const h3 = line.match(/^###\s+(.+)$/);

    if (h1) {
      finishBlock();
      npc.name = h1[1].trim();
      continue;
    }

    if (h2) {
      finishBlock();
      section = slugify(h2[1]);
      continue;
    }

    if (h3) {
      finishBlock();
      block = { section, name: h3[1].trim(), fields: {}, description: [], rulesText: [], ruleHelpersText: [] };
      continue;
    }

    if (!line.trim()) {
      if (multilineKey && block) block[multilineKey].push("");
      continue;
    }

    const kv = parseKeyValue(line);
    if (block) {
      if (multilineKey && line.trim().match(/^[-*]\s+/)) {
        block[multilineKey].push(line.trim());
        continue;
      }
      if (kv) {
        const key = slugify(kv.key);
        if (["description", "effect", "text"].includes(key)) {
          multilineKey = "description";
          if (kv.value) block.description.push(kv.value);
        } else if (["ruleelements", "rules", "rule-elements"].includes(key)) {
          multilineKey = "rulesText";
          if (kv.value) block.rulesText.push(kv.value);
        } else if (["rulehelpers", "rule-helpers", "automationhelpers", "automation-helpers"].includes(key)) {
          multilineKey = "ruleHelpersText";
          if (kv.value) block.ruleHelpersText.push(kv.value);
        } else {
          multilineKey = null;
          block.fields[key] = kv.value;
        }
      } else if (multilineKey) {
        block[multilineKey].push(line.trim());
      }
      continue;
    }

    if (kv) parseTopLevelField(section, kv.key, kv.value, npc, warnings);
  }
  finishBlock();

  validateNpc(npc, errors, warnings);
  return { npc, warnings, errors, valid: errors.length === 0 };
}

function createEmptyNpc() {
  return {
    name: "",
    kind: "npc",
    level: 1,
    rarity: "common",
    size: "med",
    traits: [],
    description: "",
    image: "",
    // Hazard-only fields (ignored for NPC actors).
    hazard: { stealth: { value: 0, details: "" }, hardness: 0, complex: false, disable: "", routine: "", reset: "" },
    perception: { mod: 0, details: "", senses: [] },
    languages: { value: [], details: "" },
    skills: {},
    abilities: Object.fromEntries(ABILITY_KEYS.map((key) => [key, 0])),
    ac: { value: 10, details: "" },
    saves: { fortitude: 0, reflex: 0, will: 0 },
    hp: { value: 10, details: "" },
    speed: { value: 25, otherSpeeds: [], details: "" },
    immunities: [],
    weaknesses: [],
    resistances: [],
    attacks: [],
    actions: [],
    spellcasting: [],
    inventory: [],
    effects: [],
    notes: []
  };
}

function parseTopLevelField(section, key, value, npc, warnings) {
  const slug = slugify(key);
  const target = slugify(section);
  if (target === "abilities" && ABILITY_KEYS.includes(slug.slice(0, 3))) {
    npc.abilities[slug.slice(0, 3)] = parseSignedInt(value);
    return;
  }
  if (target === "skills") {
    parseSkills(value ? `${key}: ${value}` : key, npc);
    return;
  }
  if (["defense", "defenses"].includes(target)) {
    parseDefenseField(slug, value, npc);
    return;
  }
  switch (slug) {
    case "name": npc.name = value.trim(); break;
    case "kind": case "statblock": case "stat-block": {
      const k = slugify(value);
      if (k === "hazard") npc.kind = "hazard";
      else if (["npc", "creature", "monster"].includes(k)) npc.kind = "npc";
      break;
    }
    case "type": {
      const k = slugify(value);
      if (k === "hazard") npc.kind = "hazard";
      else if (["npc", "creature", "monster"].includes(k)) npc.kind = "npc";
      break;
    }
    case "stealth": npc.hazard.stealth = { value: parseSignedInt(value), details: value.replace(/^[-+]?\d+\s*;?\s*/i, "").trim() }; break;
    case "hardness": npc.hazard.hardness = Math.max(0, parseSignedInt(value)); break;
    case "complexity": npc.hazard.complex = /complex/i.test(value); break;
    case "complex": npc.hazard.complex = /^(true|yes|complex|1)$/i.test(value.trim()); break;
    case "disable": npc.hazard.disable = value.trim(); break;
    case "routine": npc.hazard.routine = value.trim(); break;
    case "reset": npc.hazard.reset = value.trim(); break;
    case "level": npc.level = parseSignedInt(value); break;
    case "rarity": npc.rarity = slugify(value) || "common"; break;
    case "size": npc.size = SIZE_MAP[slugify(value)] ?? "med"; break;
    case "traits": npc.traits = splitList(value).map(slugify).filter(Boolean); break;
    case "description": npc.description = value.trim(); break;
    case "image": npc.image = value.trim() || npc.image; break;
    case "perception": parsePerception(value, npc); break;
    case "senses": npc.perception.senses = parseSenses(value); break;
    case "languages": parseLanguages(value, npc); break;
    case "skills": parseSkills(value, npc); break;
    case "abilities": parseAbilities(value, npc); break;
    case "str": case "strength": npc.abilities.str = parseSignedInt(value); break;
    case "dex": case "dexterity": npc.abilities.dex = parseSignedInt(value); break;
    case "con": case "constitution": npc.abilities.con = parseSignedInt(value); break;
    case "int": case "intelligence": npc.abilities.int = parseSignedInt(value); break;
    case "wis": case "wisdom": npc.abilities.wis = parseSignedInt(value); break;
    case "cha": case "charisma": npc.abilities.cha = parseSignedInt(value); break;
    case "ac": npc.ac = parseValueDetails(value); break;
    case "fort": case "fortitude": npc.saves.fortitude = parseSignedInt(value); break;
    case "ref": case "reflex": npc.saves.reflex = parseSignedInt(value); break;
    case "will": npc.saves.will = parseSignedInt(value); break;
    case "hp": npc.hp = parseValueDetails(value); break;
    case "speed": parseSpeed(value, npc); break;
    case "immunities": npc.immunities = parseIWR(value, false, warnings); break;
    case "weaknesses": npc.weaknesses = parseIWR(value, true, warnings); break;
    case "resistances": npc.resistances = parseIWR(value, true, warnings); break;
    case "note": case "notes": npc.notes.push(value.trim()); break;
    default:
      if (value.match(/\bAC\b|\bFort\b|\bHP\b/i)) parseCompoundStats(`${key}: ${value}`, npc);
      else warnings.push(game.i18n.format("GLSBI.parse.ignoredField", { field: key, section }));
  }
}

function parseDefenseField(slug, value, npc) {
  if (slug === "ac") npc.ac = parseValueDetails(value);
  else if (slug === "hp") npc.hp = parseValueDetails(value);
  else if (SAVE_MAP[slug]) npc.saves[SAVE_MAP[slug]] = parseSignedInt(value);
  else parseCompoundStats(`${slug}: ${value}`, npc);
}

function normalizeBlock(block, npc, warnings) {
  const fields = block.fields;
  const description = block.description.join("\n").trim();
  const rules = [...parseRuleElements(block.rulesText, warnings), ...parseRuleHelpers(block.ruleHelpersText, warnings)];
  const section = block.section;
  if (["attacks", "strikes", "melee-attacks", "ranged-attacks"].includes(section)) {
    const attackType = fields.type || fields.kind || (section.includes("ranged") ? "ranged" : "melee");
    npc.attacks.push({
      name: block.name,
      type: slugify(attackType),
      bonus: parseSignedInt(fields.bonus || fields.attack || fields.modifier || "0"),
      damage: fields.damage || "",
      damageRolls: parseDamageRolls(fields.damage || "", warnings, block.name),
      traits: splitList(fields.traits).map(slugify).filter(Boolean),
      effects: splitList(fields.effects || fields.attackeffects).map(slugify).filter(Boolean),
      range: parseDistance(fields.range),
      area: parseArea(fields.area),
      action: slugify(fields.action || "strike"),
      description,
      rules
    });
    return;
  }
  if (["actions", "abilities", "reactions", "free-actions", "passives"].includes(section)) {
    npc.actions.push({
      name: block.name,
      actionType: normalizeActionType(fields.type || fields.actiontype || section),
      actions: parseActionCount(fields.actions || fields.cost || fields.glyph || "1"),
      category: slugify(fields.category || "offensive") || "offensive",
      traits: splitList(fields.traits).map(slugify).filter(Boolean),
      frequency: fields.frequency || "",
      description,
      rules
    });
    return;
  }
  if (["spells", "spellcasting"].includes(section)) {
    npc.spellcasting.push({
      name: block.name,
      tradition: slugify(fields.tradition || firstWord(block.name) || "arcane"),
      prepared: normalizePrepared(fields.type || fields.prepared || fields.kind || "innate"),
      ability: normalizeAbility(fields.ability || "cha"),
      dc: parseSignedInt(fields.dc || fields.spelldc || "0"),
      attack: parseSignedInt(fields.attack || fields.spellattack || "0"),
      slots: parseSlots(fields.slots || ""),
      spells: parseSpellLines(fields.spells, description),
      description,
      rules
    });
    return;
  }
  if (["inventory", "items", "gear"].includes(section)) {
    npc.inventory.push({
      name: block.name,
      type: normalizeInventoryType(fields.type || fields.category || "equipment"),
      quantity: Math.max(1, parseSignedInt(fields.quantity || "1")),
      level: Math.max(0, parseSignedInt(fields.level || "0")),
      source: fields.source || fields.compendium || "",
      traits: splitList(fields.traits).map(slugify).filter(Boolean),
      description,
      rules
    });
    return;
  }
  if (["effects", "auras", "effects-auras", "automation"].includes(section)) {
    const isAura = section.includes("aura") || fields.radius || fields.range;
    npc.effects.push({
      name: block.name,
      isAura,
      level: Math.max(1, parseSignedInt(fields.level || String(npc.level || 1))),
      duration: fields.duration || "unlimited",
      badge: parseBadge(fields.badge || fields.value),
      traits: splitList(fields.traits).map(slugify).filter(Boolean),
      radius: parseDistance(fields.radius || fields.range),
      description,
      rules: isAura && !rules.some((rule) => rule.key === "Aura") ? [buildAuraRule(fields, block.name), ...rules].filter(Boolean) : rules
    });
    return;
  }
  warnings.push(game.i18n.format("GLSBI.parse.ignoredBlock", { name: block.name, section }));
}

function resolveActorType(npc) {
  if (npc.kind === "hazard") return "hazard";
  if (npc.traits?.includes("hazard")) return "hazard";
  const h = npc.hazard ?? {};
  if (h.disable || h.routine || h.reset || h.hardness || h.stealth?.value) return "hazard";
  return "npc";
}

function validateNpc(npc, errors, warnings) {
  npc.kind = resolveActorType(npc);
  const label = game.i18n.localize(npc.kind === "hazard" ? "GLSBI.label.hazard" : "GLSBI.label.npc");
  if (!npc.name) errors.push(game.i18n.format("GLSBI.parse.missingName", { label }));
  if (!Number.isInteger(npc.level)) errors.push(game.i18n.localize("GLSBI.parse.missingLevel"));
  if (!npc.ac.value) warnings.push(game.i18n.localize("GLSBI.parse.acDefault"));
  if (!npc.hp.value) warnings.push(game.i18n.localize("GLSBI.parse.hpDefault"));
  if (npc.kind === "hazard") {
    if (!npc.hazard.disable) warnings.push(game.i18n.localize("GLSBI.parse.noDisable"));
  } else if (!npc.attacks.length && !npc.actions.length && !npc.spellcasting.length) {
    warnings.push(game.i18n.localize("GLSBI.parse.noAutomation"));
  }
}

async function buildActorSource(npc, source) {
  const actorType = resolveActorType(npc);
  const art = await findCreatureArt(npc.name);
  const img = npc.image || art?.img || `systems/pf2e/icons/default-icons/${actorType}.svg`;
  const base = actorType === "hazard" ? buildHazardActorSource(npc, source) : buildNpcActorSource(npc, source);
  base.img = img;
  base.prototypeToken = buildPrototypeToken(npc, actorType, art);
  base.flags = suiteFlags({ [FLAG_SOURCE]: source, [FLAG_PARSED]: npc });
  return base;
}

function buildNpcActorSource(npc, source) {
  const publicNotes = [npc.description, ...npc.notes].filter(Boolean).map((p) => `<p>${autoLinkText(escapeHtml(p))}</p>`).join("\n");
  return {
    name: npc.name,
    type: "npc",
    system: {
      traits: {
        value: npc.traits,
        rarity: npc.rarity,
        size: { value: npc.size }
      },
      abilities: Object.fromEntries(ABILITY_KEYS.map((key) => [key, { mod: npc.abilities[key] ?? 0 }])),
      attributes: {
        ac: { value: npc.ac.value, details: npc.ac.details },
        hp: { value: npc.hp.value, max: npc.hp.value, details: npc.hp.details },
        speed: npc.speed,
        immunities: npc.immunities,
        weaknesses: npc.weaknesses,
        resistances: npc.resistances
      },
      perception: {
        mod: npc.perception.mod,
        details: npc.perception.details,
        senses: npc.perception.senses,
        vision: true
      },
      saves: {
        fortitude: { value: npc.saves.fortitude, saveDetail: "" },
        reflex: { value: npc.saves.reflex, saveDetail: "" },
        will: { value: npc.saves.will, saveDetail: "" }
      },
      skills: buildSkills(npc.skills),
      details: {
        level: { value: npc.level },
        languages: npc.languages,
        publicNotes,
        privateNotes: `<section><h3>${escapeHtml(game.i18n.localize("GLSBI.notes.importedSource"))}</h3><pre>${escapeHtml(source)}</pre></section>`
      }
    }
  };
}

function buildHazardActorSource(npc, source) {
  const html = (text) => (text ? `<p>${autoLinkText(escapeHtml(text))}</p>` : "");
  const description = [npc.description, ...npc.notes].filter(Boolean).map((p) => `<p>${autoLinkText(escapeHtml(p))}</p>`).join("\n");
  return {
    name: npc.name,
    type: "hazard",
    system: {
      traits: {
        value: npc.traits.filter((trait) => trait !== "hazard"),
        rarity: npc.rarity,
        size: { value: npc.size }
      },
      attributes: {
        ac: { value: npc.ac.value, details: npc.ac.details },
        hp: { value: npc.hp.value, max: npc.hp.value, temp: 0, details: npc.hp.details, brokenThreshold: 0 },
        hardness: npc.hazard.hardness,
        stealth: { value: npc.hazard.stealth.value, details: npc.hazard.stealth.details },
        immunities: npc.immunities,
        weaknesses: npc.weaknesses,
        resistances: npc.resistances,
        emitsSound: false
      },
      saves: {
        fortitude: { value: npc.saves.fortitude },
        reflex: { value: npc.saves.reflex },
        will: { value: npc.saves.will }
      },
      details: {
        level: { value: npc.level },
        isComplex: !!npc.hazard.complex,
        description,
        disable: html(npc.hazard.disable),
        routine: html(npc.hazard.routine),
        reset: html(npc.hazard.reset)
      }
    }
  };
}

function buildPrototypeToken(npc, actorType, art) {
  const scale = { tiny: 0.5, sm: 1, med: 1, lg: 2, huge: 3, grg: 4 };
  const dimension = scale[npc.size] ?? 1;
  const token = {
    width: dimension,
    height: dimension,
    actorLink: false,
    disposition: actorType === "hazard" ? CONST.TOKEN_DISPOSITIONS.NEUTRAL : CONST.TOKEN_DISPOSITIONS.HOSTILE,
    displayName: CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
    displayBars: CONST.TOKEN_DISPLAY_MODES.OWNER,
    sight: { enabled: actorType !== "hazard" },
    flags: { pf2e: { linkToActorSize: true, autoscale: true } }
  };
  if (art?.tokenSrc) token.texture = { src: art.tokenSrc };
  return token;
}

async function importItems(actor, npc, { mode = "replaceMatching" } = {}) {
  const sources = [];
  sources.push(...npc.attacks.map(buildMeleeItem));
  sources.push(...npc.actions.map(buildActionItem));
  sources.push(...(await Promise.all(npc.inventory.map(buildInventoryItem))));
  sources.push(...npc.effects.map(buildEffectItem));

  const spellEntrySources = npc.spellcasting.map(buildSpellcastingEntryItem);
  const sourceKeys = new Set([...sources, ...spellEntrySources].map(itemKey));
  const imported = actor.items.filter((item) => item.getFlag(MODULE_ID, FLAG_IMPORTED));

  if (mode === "replaceAll") {
    const ids = imported.map((item) => item.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
  } else if (mode === "replaceMatching") {
    const matching = imported.filter((item) => sourceKeys.has(itemKey(item)));
    const matchingEntryIds = new Set(matching.filter((item) => item.type === "spellcastingEntry").map((item) => item.id));
    const childSpells = imported.filter((item) => item.type === "spell" && matchingEntryIds.has(item.system.location?.value));
    const ids = [...matching, ...childSpells].map((item) => item.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
  }

  const existingKeys = new Set(actor.items.filter((item) => item.getFlag(MODULE_ID, FLAG_IMPORTED)).map(itemKey));
  const filteredSources = mode === "appendOnly" ? sources.filter((source) => !existingKeys.has(itemKey(source))) : sources;
  if (filteredSources.length) await actor.createEmbeddedDocuments("Item", filteredSources);
  await importSpellcasting(actor, npc.spellcasting, { mode });
}

function buildMeleeItem(attack) {
  const system = {
    description: { value: htmlDescription(attack.description), gm: "" },
    rules: attack.rules,
    slug: slugify(attack.name),
    traits: { value: attack.traits, otherTags: [] },
    action: attack.action || "strike",
    bonus: { value: attack.bonus },
    attackEffects: { value: attack.effects },
    damageRolls: attack.damageRolls,
    range: attack.type === "ranged" ? { increment: attack.range || 30, max: null } : null,
    area: attack.area,
    subjectToMAP: true
  };
  return importedItem({ name: attack.name, type: "melee", img: attack.type === "ranged" ? "systems/pf2e/icons/default-icons/ranged.svg" : "systems/pf2e/icons/default-icons/melee.svg", system });
}

function buildActionItem(action) {
  const system = {
    description: { value: htmlDescription(action.description), gm: "" },
    rules: action.rules,
    slug: slugify(action.name),
    traits: { value: action.traits, otherTags: [] },
    actionType: { value: action.actionType },
    actions: { value: action.actionType === "action" ? action.actions : null },
    category: action.category || "offensive"
  };
  if (action.frequency) system.frequency = parseFrequency(action.frequency);
  return importedItem({ name: action.name, type: "action", img: actionIcon(action.actionType, action.actions), system });
}

async function buildInventoryItem(item) {
  const matched = item.source ? await itemSourceFromCompendiums(item.name, { type: item.type, packHint: item.source }) : await itemSourceFromCompendiums(item.name, { type: item.type });
  const fallback = {
    name: item.name,
    type: item.type,
    img: `systems/pf2e/icons/default-icons/${item.type}.svg`,
    system: {
      description: { value: htmlDescription(item.description), gm: "" },
      rules: item.rules,
      slug: slugify(item.name),
      level: { value: item.level },
      quantity: item.quantity,
      traits: { value: item.traits, rarity: "common", otherTags: [] }
    }
  };
  const source = matched ?? fallback;
  delete source._id;
  source.name = item.name;
  source.system ??= {};
  source.system.quantity = item.quantity;
  source.system.rules = item.rules.length ? item.rules : (source.system.rules ?? []);
  if (item.description) source.system.description = { value: htmlDescription(item.description), gm: source.system.description?.gm ?? "" };
  return importedItem(source);
}

function buildEffectItem(effect) {
  return importedItem({
    name: effect.name,
    type: "effect",
    img: "systems/pf2e/icons/default-icons/effect.svg",
    system: {
      description: { value: htmlDescription(effect.description), gm: "" },
      rules: effect.rules,
      slug: slugify(effect.name),
      level: { value: effect.level },
      traits: { value: effect.traits, otherTags: [] },
      duration: parseDuration(effect.duration),
      badge: effect.badge,
      tokenIcon: { show: true },
      unidentified: false,
      start: { value: 0, initiative: null },
      fromSpell: false
    }
  });
}

function importedItem(source) {
  return foundry.utils.mergeObject(source, { flags: suiteFlags({ [FLAG_IMPORTED]: true }) }, { inplace: false });
}

function buildSpellcastingEntryItem(entry) {
  return importedItem({
    name: entry.name,
    type: "spellcastingEntry",
    img: "systems/pf2e/icons/default-icons/spellcastingEntry.svg",
    system: {
      description: { value: htmlDescription(entry.description), gm: "" },
      rules: entry.rules,
      slug: slugify(entry.name),
      ability: { value: entry.ability },
      tradition: { value: entry.tradition },
      prepared: { value: entry.prepared },
      spelldc: { value: entry.attack, dc: entry.dc },
      showSlotlessLevels: { value: true },
      proficiency: { value: 1 },
      slots: buildSpellSlots(entry)
    }
  });
}

async function importSpellcasting(actor, entries, { mode = "replaceMatching" } = {}) {
  const existingKeys = new Set(actor.items.filter((item) => item.getFlag(MODULE_ID, FLAG_IMPORTED)).map(itemKey));
  for (const entry of entries) {
    const entrySource = buildSpellcastingEntryItem(entry);
    if (mode === "appendOnly" && existingKeys.has(itemKey(entrySource))) continue;
    const [createdEntry] = await actor.createEmbeddedDocuments("Item", [entrySource]);
    const spellSources = [];
    for (const spell of entry.spells) {
      const source = await spellSourceFromCompendium(spell.name);
      if (!source) continue;
      delete source._id;
      source.system.location = buildSpellLocation(spell, createdEntry.id);
      if (Number.isInteger(spell.level)) source.system.level = { value: spell.level };
      source.flags ??= {};
      source.flags[MODULE_ID] = foundry.utils.mergeObject(
        source.flags[MODULE_ID] ?? {},
        suiteFlags({ [FLAG_IMPORTED]: true, [`${PREFIX}originalName`]: spell.name, [`${PREFIX}frequency`]: spell.frequency })[MODULE_ID]
      );
      spellSources.push(source);
    }
    if (spellSources.length) await actor.createEmbeddedDocuments("Item", spellSources);
  }
}

async function spellSourceFromCompendium(name) {
  const match = await findCompendiumItem(name, { type: "spell", packHint: "pf2e.spells-srd" });
  if (!match) {
    ui.notifications.warn(game.i18n.format("GLSBI.notify.spellNotFound", { name }));
    return null;
  }
  const document = await match.pack.getDocument(match.entry._id);
  return document.toObject();
}

async function itemSourceFromCompendiums(name, options = {}) {
  const match = await findCompendiumItem(name, options);
  if (!match) return null;
  const document = await match.pack.getDocument(match.entry._id);
  return document.toObject();
}

const INDEX_CACHE = new Map();
const ACTOR_INDEX_CACHE = new Map();

async function getItemPackIndex(pack) {
  if (INDEX_CACHE.has(pack.collection)) return INDEX_CACHE.get(pack.collection);
  const index = await pack.getIndex({ fields: ["name", "type", "system.slug"] });
  INDEX_CACHE.set(pack.collection, index);
  return index;
}

function matchNormalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/['’]/g, "")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isPrefixWordMatch(a, b) {
  return a.startsWith(`${b} `) || b.startsWith(`${a} `);
}

function itemPacks(packHint) {
  const all = game.packs.filter((pack) => pack.documentName === "Item");
  if (packHint) {
    const hinted = all.filter((pack) => pack.collection === packHint || pack.metadata?.id === packHint || pack.collection.includes(packHint));
    if (hinted.length) return hinted;
  }
  return all.filter((pack) => pack.metadata?.packageName === "pf2e");
}

async function findCompendiumItem(name, { type = null, packHint = "" } = {}) {
  if (!globalThis.game?.packs) return null;
  const target = matchNormalize(name);
  if (!target) return null;
  const targetSlug = slugify(name);
  const packs = itemPacks(packHint);
  // First honor the requested type; if that yields nothing, retry ignoring type
  // so a loose "equipment" default can still resolve to a weapon/armor entry.
  for (const requireType of (type ? [type, null] : [null])) {
    let fuzzy = null;
    for (const pack of packs) {
      const index = await getItemPackIndex(pack);
      for (const candidate of index) {
        if (requireType && candidate.type !== requireType) continue;
        const candName = matchNormalize(candidate.name);
        if (!candName) continue;
        if (candName === target || (candidate.system?.slug && slugify(candidate.system.slug) === targetSlug)) return { pack, entry: candidate };
        if (isPrefixWordMatch(target, candName) && (!fuzzy || candName.length < matchNormalize(fuzzy.entry.name).length)) fuzzy = { pack, entry: candidate };
      }
    }
    if (fuzzy) return fuzzy;
  }
  return null;
}

async function findCreatureArt(name) {
  if (!globalThis.game?.packs || !name) return null;
  const target = matchNormalize(name);
  if (!target) return null;
  const usable = (path) => (path && !String(path).includes("default-icons") && !String(path).includes("mystery-man") ? path : null);
  const packs = game.packs.filter((pack) => pack.documentName === "Actor" && pack.metadata?.packageName === "pf2e");
  for (const pack of packs) {
    let index = ACTOR_INDEX_CACHE.get(pack.collection);
    if (!index) {
      index = await pack.getIndex({ fields: ["name", "img", "prototypeToken.texture.src"] });
      ACTOR_INDEX_CACHE.set(pack.collection, index);
    }
    const entry = index.find((candidate) => matchNormalize(candidate.name) === target);
    if (!entry) continue;
    const img = usable(entry.img);
    const tokenSrc = usable(entry.prototypeToken?.texture?.src);
    if (img || tokenSrc) return { img, tokenSrc };
  }
  return null;
}

function itemKey(item) {
  return `${item.type}:${slugify(item.system?.slug ?? item.slug ?? item.name)}`;
}

function buildSpellSlots(entry) {
  const slots = Object.fromEntries(Array.from({ length: 11 }, (_value, rank) => [`slot${rank}`, { prepared: [], value: 0, max: 0 }]));
  for (const spell of entry.spells) {
    if (!Number.isInteger(spell.level)) continue;
    const rank = Math.min(10, Math.max(0, Number(spell.level) || 0));
    const slot = slots[`slot${rank}`];
    const count = spell.slots ?? entry.slots[rank] ?? (entry.prepared === "prepared" ? 1 : 0);
    slot.max = Math.max(slot.max, count);
    slot.value = Math.max(slot.value, count);
  }
  for (const [rank, count] of Object.entries(entry.slots)) {
    const slot = slots[`slot${rank}`];
    if (!slot) continue;
    slot.max = Math.max(slot.max, count);
    slot.value = Math.max(slot.value, count);
  }
  return slots;
}

function buildSpellLocation(spell, entryId) {
  const location = { value: entryId };
  if (spell.signature) location.signature = true;
  if (spell.heightened) location.heightenedLevel = spell.heightened;
  if (spell.frequency === "at-will" || spell.frequency === "constant") location.uses = { value: -1, max: -1, per: "day" };
  else if (spell.uses) location.uses = { value: spell.uses, max: spell.uses, per: spell.per ?? "day" };
  return location;
}

function renderPreview(parsed, validation = null) {
  const t = (key) => escapeHtml(game.i18n.localize(key));
  if (!parsed) return `<div class="gluni-empty-preview" data-kind="standby"><i class="fa-solid fa-scroll"></i><h2>${t("GLSBI.preview.standbyTitle")}</h2><p>${game.i18n.localize("GLSBI.preview.standbyHint")}</p></div>`;
  const { npc, warnings, errors } = parsed;
  const actorType = resolveActorType(npc);
  const serial = `${t(actorType === "hazard" ? "GLSBI.preview.serialHazard" : "GLSBI.preview.serialNpc")}·LV / ${String(npc.level ?? 0).padStart(2, "0")}`;
  const chips = (values) => `<span class="gluni-chip-list">${values.map((v) => `<span class="gluni-chip">${escapeHtml(v)}</span>`).join("")}</span>`;
  const hazardCard = actorType === "hazard" ? `
    <div class="gluni-preview-card">
      <h3>${t("GLSBI.preview.hazardHeading")}</h3>
      <p><strong>${t("GLSBI.preview.stealth")}</strong> ${signed(npc.hazard.stealth.value)} &nbsp; <strong>${t("GLSBI.preview.hardness")}</strong> ${npc.hazard.hardness} &nbsp; <strong>${t("GLSBI.preview.complexity")}</strong> ${t(npc.hazard.complex ? "GLSBI.preview.complex" : "GLSBI.preview.simple")}</p>
      ${npc.hazard.disable ? `<p><strong>${t("GLSBI.preview.disable")}</strong> ${escapeHtml(npc.hazard.disable)}</p>` : ""}
    </div>` : "";
  return `
    <div class="gluni-preview-inner" data-kind="${actorType}">
    <div class="gluni-preview-title">
      <p class="gluni-eyebrow">${t(actorType === "hazard" ? "GLSBI.preview.parsedPreviewHazard" : "GLSBI.preview.parsedPreviewNpc")} <span class="gluni-serial">${serial}</span></p>
      <h2>${escapeHtml(npc.name || game.i18n.localize("GLSBI.preview.unnamed"))}</h2>
    </div>
    ${errors.map((error) => `<p class="gluni-notice gluni-error">${escapeHtml(error)}</p>`).join("")}
    ${warnings.map((warning) => `<p class="gluni-notice gluni-warning">${escapeHtml(warning)}</p>`).join("")}
    <table class="gluni-stat-table">
      <tr><th>${t("GLSBI.preview.level")}</th><td>${npc.level}</td><th>${t("GLSBI.preview.rarity")}</th><td>${escapeHtml(npc.rarity)}</td></tr>
      <tr><th>${t("GLSBI.preview.size")}</th><td>${escapeHtml(npc.size)}</td><th>${t("GLSBI.preview.traits")}</th><td>${chips(npc.traits)}</td></tr>
      <tr><th>${t("GLSBI.preview.perception")}</th><td>${signed(npc.perception.mod)}</td><th>${t("GLSBI.preview.languages")}</th><td>${chips(npc.languages.value)}</td></tr>
      <tr><th>${t("GLSBI.preview.ac")}</th><td>${npc.ac.value}</td><th>${t("GLSBI.preview.hp")}</th><td>${npc.hp.value}</td></tr>
      <tr><th>${t("GLSBI.preview.fort")}</th><td>${signed(npc.saves.fortitude)}</td><th>${t("GLSBI.preview.ref")}</th><td>${signed(npc.saves.reflex)}</td></tr>
      <tr><th>${t("GLSBI.preview.will")}</th><td>${signed(npc.saves.will)}</td><th>${t("GLSBI.preview.speed")}</th><td>${escapeHtml(game.i18n.format("GLSBI.preview.speedValue", { value: npc.speed.value }))}</td></tr>
    </table>
    <div class="gluni-preview-card">
      <h3>${t("GLSBI.preview.abilities")}</h3>
      <p class="gluni-ability-row">${ABILITY_KEYS.map((key) => `<span><strong>${key.toUpperCase()}</strong> ${signed(npc.abilities[key])}</span>`).join("")}</p>
    </div>
    <div class="gluni-preview-card">
      <h3>${t("GLSBI.preview.skills")}</h3>
      <p>${Object.entries(npc.skills).map(([key, value]) => `${escapeHtml(key)} ${signed(value)}`).join(", ") || t("GLSBI.preview.none")}</p>
    </div>
    <h3>${t("GLSBI.preview.automationItems")}</h3>
    <table class="gluni-stat-table gluni-automation-table">
      <tr><th>${t("GLSBI.preview.attacks")}</th><td>${npc.attacks.length}</td><th>${t("GLSBI.preview.actions")}</th><td>${npc.actions.length}</td></tr>
      <tr><th>${t("GLSBI.preview.spellcasting")}</th><td>${npc.spellcasting.length}</td><th>${t("GLSBI.preview.inventory")}</th><td>${npc.inventory.length}</td></tr>
      <tr><th>${t("GLSBI.preview.effectsAuras")}</th><td>${npc.effects.length}</td><th>${t("GLSBI.preview.ruleElements")}</th><td>${countRules(npc)}</td></tr>
    </table>
    ${hazardCard}
    ${renderValidation(validation)}
    ${renderNamedList(t("GLSBI.preview.attacks"), npc.attacks)}
    ${renderNamedList(t("GLSBI.preview.actions"), npc.actions)}
    ${renderNamedList(t("GLSBI.preview.spellcasting"), npc.spellcasting)}
    ${renderNamedList(t("GLSBI.preview.effects"), npc.effects)}
    </div>
  `;
}

function renderValidation(validation) {
  const t = (key) => escapeHtml(game.i18n.localize(key));
  if (!validation) return `<div class="gluni-preview-card"><h3>${t("GLSBI.validation.heading")}</h3><p class="gluni-muted">${t("GLSBI.validation.runsAfterParsing")}</p></div>`;
  const list = (title, values, className = "") => values.length ? `<h4>${title}</h4><ul class="gluni-validation-list ${className}">${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>` : "";
  return `
    <div class="gluni-preview-card gluni-validation-card">
    <h3>${t("GLSBI.validation.heading")}</h3>
    ${list(t("GLSBI.validation.errors"), validation.errors, "gluni-error")}
    ${list(t("GLSBI.validation.warnings"), validation.warnings, "gluni-warning")}
    ${list(t("GLSBI.validation.compendiumMatches"), validation.matches)}
    ${!validation.errors.length && !validation.warnings.length ? `<p class="gluni-muted">${t("GLSBI.validation.noIssues")}</p>` : ""}
    </div>
  `;
}

function renderNamedList(title, values) {
  if (!values.length) return "";
  return `<div class="gluni-preview-card"><h3>${title}</h3><ul class="gluni-named-list">${values.map((value) => `<li><strong>${escapeHtml(value.name)}</strong>${value.traits?.length ? `<span>${escapeHtml(value.traits.join(", "))}</span>` : ""}</li>`).join("")}</ul></div>`;
}

function countRules(npc) {
  return [...npc.attacks, ...npc.actions, ...npc.spellcasting, ...npc.inventory, ...npc.effects].reduce((total, item) => total + (item.rules?.length ?? 0), 0);
}

async function validateParsed(parsed) {
  const result = { errors: [], warnings: [], matches: [] };
  if (!parsed?.npc) return result;
  const { npc } = parsed;
  const traitSet = pf2eTraitSet();
  const damageTypes = getDamageTypeSet();
  const ruleKeys = getRuleElementKeys();

  for (const trait of collectTraits(npc)) {
    if (traitSet.size && !traitSet.has(trait)) result.warnings.push(game.i18n.format("GLSBI.validation.unknownTrait", { trait }));
  }
  for (const attack of npc.attacks) {
    for (const roll of Object.values(attack.damageRolls)) {
      if (!damageTypes.has(roll.damageType)) result.warnings.push(game.i18n.format("GLSBI.validation.unknownDamageType", { name: attack.name, damageType: roll.damageType }));
    }
    for (const effect of attack.effects) {
      if (!isKnownAttackEffect(effect)) result.warnings.push(game.i18n.format("GLSBI.validation.unresolvedAttackEffect", { effect }));
    }
  }
  for (const rule of collectRules(npc)) {
    if (!rule?.key) result.errors.push(game.i18n.localize("GLSBI.validation.ruleMissingKey"));
    else if (!ruleKeys.has(rule.key)) result.warnings.push(game.i18n.format("GLSBI.validation.unknownRuleKey", { key: rule.key }));
  }
  for (const entry of npc.spellcasting) {
    for (const spell of entry.spells) {
      const match = await findCompendiumItem(spell.name, { type: "spell", packHint: "pf2e.spells-srd" });
      if (match) result.matches.push(game.i18n.format("GLSBI.validation.spellMatch", { name: spell.name, pack: match.pack.collection }));
      else result.warnings.push(game.i18n.format("GLSBI.validation.spellNotFound", { name: spell.name }));
    }
  }
  for (const item of npc.inventory) {
    const match = await findCompendiumItem(item.name, { type: item.type, packHint: item.source });
    if (match) result.matches.push(game.i18n.format("GLSBI.validation.itemMatch", { name: item.name, pack: match.pack.collection }));
    else result.warnings.push(game.i18n.format("GLSBI.validation.itemGeneric", { type: item.type, name: item.name }));
  }
  return result;
}

function collectTraits(npc) {
  return [...npc.traits, ...npc.attacks.flatMap((item) => item.traits), ...npc.actions.flatMap((item) => item.traits), ...npc.inventory.flatMap((item) => item.traits), ...npc.effects.flatMap((item) => item.traits)];
}

function collectRules(npc) {
  return [...npc.attacks, ...npc.actions, ...npc.spellcasting, ...npc.inventory, ...npc.effects].flatMap((item) => item.rules ?? []);
}

function pf2eTraitSet() {
  const pf2e = globalThis.CONFIG?.PF2E ?? {};
  const keys = Object.keys(pf2e).filter((key) => key.toLowerCase().includes("trait"));
  return new Set(keys.flatMap((key) => Object.keys(pf2e[key] ?? {})).map(slugify));
}

function isKnownAttackEffect(effect) {
  const config = globalThis.CONFIG?.PF2E?.attackEffects ?? {};
  return !Object.keys(config).length || effect in config || getConditionSlugs().includes(effect);
}

function parseKeyValue(line) {
  const match = line.match(/^[-*]?\s*([A-Za-z][A-Za-z0-9 /_-]*):\s*(.*)$/);
  return match ? { key: match[1].trim(), value: match[2].trim() } : null;
}

function parseCompoundStats(text, npc) {
  for (const part of text.split(/;|,/)) {
    const kv = parseKeyValue(part.trim());
    if (kv) parseTopLevelField("defense", kv.key, kv.value, npc, []);
  }
}

function parsePerception(value, npc) {
  npc.perception.mod = parseSignedInt(value);
  const sensesMatch = value.match(/senses?:\s*(.+)$/i);
  if (sensesMatch) npc.perception.senses = parseSenses(sensesMatch[1]);
  npc.perception.details = value.replace(/^[-+]?\d+\s*;?\s*/i, "").trim();
}

function parseSenses(value) {
  return splitList(value).map((sense) => {
    const match = sense.match(/^(.+?)\s+(\d+)\s*(?:feet|ft\.?)/i);
    return match ? { type: slugify(match[1]), acuity: "imprecise", range: Number(match[2]) } : { type: slugify(sense), acuity: "precise" };
  });
}

function parseLanguages(value, npc) {
  const parts = splitList(value);
  npc.languages.value = parts.map(slugify).filter(Boolean);
  npc.languages.details = value;
}

function parseSkills(value, npc) {
  const text = value.replace(/^skills?:\s*/i, "");
  for (const part of text.split(/,|;/)) {
    const match = part.trim().match(/^(.+?)\s*:?\s*([-+]\d+)$/);
    if (match) npc.skills[slugify(match[1])] = Number(match[2]);
  }
}

function parseAbilities(value, npc) {
  for (const part of value.split(/,|;/)) {
    const match = part.trim().match(/^(str|dex|con|int|wis|cha)\s*:?\s*([-+]\d+)$/i);
    if (match) npc.abilities[match[1].toLowerCase()] = Number(match[2]);
  }
}

function parseValueDetails(value) {
  const number = parseSignedInt(value);
  return { value: number, details: value.replace(/^[-+]?\d+\s*;?\s*/i, "").trim() };
}

function parseSpeed(value, npc) {
  const parts = splitList(value);
  const main = parts.shift() ?? value;
  npc.speed.value = parseDistance(main) || 25;
  npc.speed.details = value;
  npc.speed.otherSpeeds = parts.map((part) => ({ type: slugify(part.replace(/\d+.*/, "").trim()), value: parseDistance(part) || 0 })).filter((speed) => speed.type && speed.value);
}

function parseIWR(value, withValue, warnings) {
  return splitList(value).map((part) => {
    const match = part.match(/^(.+?)\s+(\d+)$/);
    const type = slugify(match ? match[1] : part);
    if (!type) return null;
    if (withValue && !match) warnings.push(game.i18n.format("GLSBI.parse.iwrNoValue", { entry: part }));
    return withValue ? { type, value: Number(match?.[2] ?? 1), exceptions: [] } : { type, exceptions: [] };
  }).filter(Boolean);
}

function parseRuleElements(lines, warnings) {
  const text = lines.join("\n").trim();
  if (!text || text.toLowerCase() === "none") return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (_error) {
    const rules = [];
    for (const line of lines) {
      const trimmed = line.replace(/^[-*]\s*/, "").trim();
      if (!trimmed) continue;
      try {
        rules.push(JSON.parse(trimmed));
      } catch (_err) {
        warnings.push(game.i18n.format("GLSBI.parse.ruleElementsNotJson", { text: trimmed }));
      }
    }
    return rules;
  }
}

function parseRuleHelpers(lines, warnings) {
  const rules = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/^[-*]\s*/, "").trim();
    if (!line) continue;
    const [, type, text = ""] = line.match(/^(\S+)\s*(.*)$/) ?? [];
    const values = parseHelperValues(text);
    const selector = values.selector ?? values.domain ?? values.radius ?? "";
    const value = values.value ?? values.option ?? values.uuid ?? values.text ?? "";
    const rule = buildRuleHelperObject(type, selector, value, values);
    if (rule.key) rules.push(rule);
    else warnings.push(game.i18n.format("GLSBI.parse.unknownRuleHelper", { type }));
  }
  return rules;
}

function parseHelperValues(text) {
  const matches = [...String(text).matchAll(/([A-Za-z][A-Za-z0-9_-]*)=/g)];
  const values = {};
  for (let index = 0; index < matches.length; index += 1) {
    const key = slugify(matches[index][1]);
    const start = matches[index].index + matches[index][0].length;
    const end = matches[index + 1]?.index ?? text.length;
    values[key] = text.slice(start, end).trim().replace(/^"|"$/g, "");
  }
  return values;
}

function buildRuleHelperObject(type, selector, value, extra = {}) {
  const key = String(type ?? "").trim();
  if (key === "FlatModifier") return { key, selector: selector || "all", value: Number(value) || 0, type: extra.type ?? "untyped" };
  if (key === "RollOption") return { key, domain: selector || "all", option: value || "option" };
  if (key === "Aura") return { key, radius: Number(selector) || 5, traits: splitList(value).map(slugify).filter(Boolean), effects: [] };
  if (key === "Note") return { key, selector: selector || "all", text: value || "" };
  if (key === "GrantItem") return { key, uuid: value || selector || "" };
  return { key };
}

function buildAuraRule(fields, name) {
  const radius = parseDistance(fields.radius || fields.range);
  if (!radius) return null;
  return {
    key: "Aura",
    slug: slugify(name),
    radius,
    traits: splitList(fields.traits).map(slugify).filter((trait) => trait !== "aura"),
    effects: []
  };
}

function parseSpellLines(fieldValue, description) {
  const text = [fieldValue, description].filter(Boolean).join("\n");
  const spells = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/^[-*]\s*/, "").trim();
    const match = line.match(/^(constant|at[- ]?will|cantrips?|\d+\s*\/\s*day|\d+)(?:st|nd|rd|th)?(?:\s*\((\d+)\s*slots?\))?\s*:?\s*(.+)$/i);
    if (!match) continue;
    const label = match[1].toLowerCase().replace(/\s+/g, "");
    const level = label.startsWith("cantrip") ? 0 : (label === "at-will" || label === "atwill" || label === "constant" || label.includes("/day") ? null : Number(label));
    const frequency = label === "constant" ? "constant" : (label === "at-will" || label === "atwill" ? "at-will" : (label.includes("/day") ? "daily" : "slot"));
    const uses = label.includes("/day") ? Number(label.match(/\d+/)?.[0] ?? 1) : null;
    const slots = match[2] ? Number(match[2]) : null;
    for (const rawName of splitList(match[3])) spells.push(parseSpellName(rawName, { level, frequency, uses, slots }));
  }
  return spells;
}

function parseSpellName(value, defaults) {
  const metadata = [...String(value).matchAll(/\(([^)]+)\)/g)].map((match) => match[1].toLowerCase());
  const name = String(value).replace(/\s*\([^)]+\)/g, "").trim();
  const heightened = Number(metadata.find((part) => part.includes("heightened"))?.match(/\d+/)?.[0] ?? 0) || null;
  return {
    ...defaults,
    name,
    signature: metadata.some((part) => part.includes("signature")),
    heightened
  };
}

function parseSlots(value) {
  const slots = {};
  for (const part of splitList(value)) {
    const match = part.match(/(\d+)\s*(?::|=|-)\s*(\d+)/);
    if (match) slots[Number(match[1])] = Number(match[2]);
  }
  return slots;
}

function buildSkills(skills) {
  const configSkills = CONFIG.PF2E?.skills ?? {};
  const result = {};
  for (const [name, value] of Object.entries(skills)) {
    const slug = skillSlug(name, configSkills);
    if (slug in configSkills) result[slug] = { base: value };
    else result[name] = { base: value };
  }
  return result;
}

function skillSlug(name, configSkills) {
  const slug = slugify(name);
  if (slug in configSkills) return slug;
  const normalized = slug.replace(/-/g, "");
  return Object.keys(configSkills).find((key) => slugify(game.i18n.localize(configSkills[key].label)) === slug || key === normalized) ?? slug;
}

function htmlDescription(text) {
  if (!text) return "";
  return text.split(/\n{2,}/).map((paragraph) => `<p>${autoLinkText(escapeHtml(paragraph.trim()).replace(/\n/g, "<br>"))}</p>`).join("\n");
}

function autoLinkText(text) {
  let enriched = text;
  enriched = enriched.replace(/\b(DC)\s+(\d+)\s+(Fortitude|Fort|Reflex|Ref|Will)\b/gi, (_match, _dc, dc, save) => `@Check[type:${SAVE_MAP[slugify(save)]}|dc:${dc}|showDC:all]`);
  enriched = enriched.replace(/\b(Fortitude|Fort|Reflex|Ref|Will)\s+DC\s+(\d+)\b/gi, (_match, save, dc) => `@Check[type:${SAVE_MAP[slugify(save)]}|dc:${dc}|showDC:all]`);
  const damageTypes = getDamageTypeList();
  const damageRe = new RegExp(`\\b(\\d+d\\d+(?:\\s*[+\\-]\\s*\\d+)?)\\s+(${damageTypes.join("|")})\\s+damage\\b`, "gi");
  enriched = enriched.replace(damageRe, (_match, formula, type) => `@Damage[(${formula.replace(/\s+/g, "")})[${slugify(type)}]]{${formula} ${type} damage}`);
  for (const condition of getConditionSlugs()) {
    const label = titleCase(condition.replace(/-/g, " "));
    const uuid = conditionUuid(condition);
    const pattern = new RegExp(`\\b${condition.replace(/-/g, "[- ]")}\\b`, "gi");
    enriched = enriched.replace(pattern, (match, offset, full) => {
      if (full.slice(Math.max(0, offset - 12), offset).includes("@UUID[")) return match;
      return `@UUID[${uuid}]{${label}}`;
    });
  }
  return enriched;
}

function conditionUuid(slug) {
  try {
    const manager = game.pf2e?.ConditionManager;
    if (manager?.conditionsSlugs?.includes(slug)) {
      const condition = manager.getCondition(slug);
      return condition?._stats?.compendiumSource ?? condition?.uuid ?? `Compendium.pf2e.conditionitems.Item.${slug}`;
    }
  } catch (_error) {
    return `Compendium.pf2e.conditionitems.Item.${slug}`;
  }
  return `Compendium.pf2e.conditionitems.Item.${slug}`;
}

function parseDamageRolls(value, warnings = [], attackName = "attack") {
  const text = String(value ?? "").replace(/\bplus\b/gi, ",");
  const damageTypes = getDamageTypeSet();
  const rolls = {};
  let index = 0;
  for (const part of text.split(/,|;/).map((piece) => piece.trim()).filter(Boolean)) {
    const match = part.match(/(\d+d\d+(?:\s*[+\-]\s*\d+)?|\d+)\s+(?:(persistent|precision|splash|critical-only|crit-only)\s+)?([a-z -]+?)(?:\s+damage)?$/i);
    if (!match) {
      warnings.push(game.i18n.format("GLSBI.parse.damagePart", { part, name: attackName }));
      continue;
    }
    const formula = match[1].replace(/\s+/g, "");
    const categorySlug = slugify(match[2] ?? "");
    const typeSlug = slugify(match[3]);
    const damageType = damageTypes.has(typeSlug) ? typeSlug : "bludgeoning";
    const category = DAMAGE_CATEGORIES.includes(categorySlug) ? categorySlug : null;
    if (["critical-only", "crit-only"].includes(categorySlug)) warnings.push(game.i18n.format("GLSBI.parse.criticalOnly", { name: attackName }));
    rolls[index === 0 ? "main" : `extra${index}`] = { damage: formula, damageType, category };
    index += 1;
  }
  return rolls;
}

function parseFrequency(value) {
  const max = parseSignedInt(value) || 1;
  const per = value.match(/per\s+(round|minute|hour|day)/i)?.[1]?.toLowerCase() ?? "day";
  return { max, value: max, per };
}

function parseDuration(value) {
  const slug = slugify(value);
  if (["unlimited", "encounter"].includes(slug)) return { value: slug === "unlimited" ? -1 : 1, unit: slug, expiry: null, sustained: false };
  const match = String(value).match(/(\d+)\s*(rounds?|minutes?|hours?|days?|turns?)/i);
  const unitMap = { round: "rounds", turn: "rounds", minute: "minutes", hour: "hours", day: "days" };
  const unit = unitMap[(match?.[2] ?? "round").toLowerCase().replace(/s$/, "")] ?? "rounds";
  return { value: Number(match?.[1] ?? 1), unit, expiry: "turn-start", sustained: false };
}

function parseBadge(value) {
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? { type: "counter", value: number, min: 1, max: null, labels: null, loop: false } : null;
}

function parseArea(value) {
  if (!value) return null;
  const match = String(value).match(/(\d+)\s*(?:foot|feet|ft\.?)?\s*(burst|cone|emanation|line)/i);
  return match ? { value: Number(match[1]), type: slugify(match[2]) } : null;
}

function parseDistance(value) {
  const match = String(value ?? "").match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function parseSignedInt(value) {
  const match = String(value ?? "").match(/[-+]?\d+/);
  return match ? Number(match[0]) : 0;
}

function parseActionCount(value) {
  const text = String(value).toLowerCase();
  if (text.includes("three") || text.includes("3")) return 3;
  if (text.includes("two") || text.includes("2")) return 2;
  return 1;
}

function normalizeActionType(value) {
  const slug = slugify(value);
  if (slug.includes("reaction")) return "reaction";
  if (slug.includes("free")) return "free";
  if (slug.includes("passive")) return "passive";
  return "action";
}

function normalizePrepared(value) {
  const slug = slugify(value);
  if (["prepared", "spontaneous", "innate", "focus", "ritual"].includes(slug)) return slug;
  return "innate";
}

function normalizeAbility(value) {
  const slug = slugify(value).slice(0, 3);
  return ABILITY_KEYS.includes(slug) ? slug : "cha";
}

function normalizeInventoryType(value) {
  const slug = slugify(value);
  return ["weapon", "armor", "shield", "consumable", "equipment", "backpack", "treasure"].includes(slug) ? slug : "equipment";
}

function actionIcon(type, actions) {
  if (type === "reaction") return "systems/pf2e/icons/actions/Reaction.webp";
  if (type === "free") return "systems/pf2e/icons/actions/FreeAction.webp";
  if (type === "passive") return "systems/pf2e/icons/actions/Passive.webp";
  return `systems/pf2e/icons/actions/${actions ?? 1}Action.webp`;
}

async function getOrCreateFolder() {
  const existing = game.folders.find((folder) => folder.type === "Actor" && folder.name === IMPORT_FOLDER);
  return existing ?? Folder.create({ name: IMPORT_FOLDER, type: "Actor" });
}

function splitList(value) {
  return String(value ?? "").split(/,|;/).map((part) => part.trim()).filter(Boolean);
}

function slugify(value) {
  return String(value ?? "").trim().toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function firstWord(value) {
  return String(value ?? "").trim().split(/\s+/)[0];
}

function signed(value) {
  return Number(value) >= 0 ? `+${Number(value)}` : String(Number(value));
}

function titleCase(value) {
  return String(value).replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function exportActorToMarkdown(actor) {
  if (actor.type === "hazard") return exportHazardToMarkdown(actor);
  const system = actor.system;
  const lines = [
    `# ${actor.name}`,
    `Level: ${system.details?.level?.value ?? 1}`,
    `Rarity: ${system.traits?.rarity ?? "common"}`,
    `Size: ${system.traits?.size?.value ?? "medium"}`,
    `Traits: ${(system.traits?.value ?? []).join(", ")}`,
    `Perception: ${signed(system.perception?.mod ?? 0)}${system.perception?.senses?.length ? `; Senses: ${formatSenses(system.perception.senses)}` : ""}`,
    `Languages: ${(system.details?.languages?.value ?? system.languages?.value ?? []).join(", ")}`,
    `Skills: ${formatSkills(system.skills ?? {})}`,
    `Abilities: ${ABILITY_KEYS.map((key) => `${key.toUpperCase()} ${signed(system.abilities?.[key]?.mod ?? 0)}`).join(", ")}`,
    `AC: ${system.attributes?.ac?.value ?? 10}`,
    `Fortitude: ${signed(system.saves?.fortitude?.value ?? 0)}`,
    `Reflex: ${signed(system.saves?.reflex?.value ?? 0)}`,
    `Will: ${signed(system.saves?.will?.value ?? 0)}`,
    `HP: ${system.attributes?.hp?.max ?? system.attributes?.hp?.value ?? 10}`,
    formatIWR("Immunities", system.attributes?.immunities),
    formatIWR("Weaknesses", system.attributes?.weaknesses),
    formatIWR("Resistances", system.attributes?.resistances),
    `Speed: ${formatSpeed(system.attributes?.speed)}`,
    `Description: ${stripHtml(system.details?.publicNotes ?? "")}`
  ].filter(Boolean);

  const attacks = actor.items.filter((item) => item.type === "melee");
  if (attacks.length) lines.push("", "## Attacks", ...attacks.flatMap(exportAttack));
  const actions = actor.items.filter((item) => item.type === "action");
  if (actions.length) lines.push("", "## Actions", ...actions.flatMap(exportAction));
  const entries = actor.items.filter((item) => item.type === "spellcastingEntry");
  if (entries.length) lines.push("", "## Spellcasting", ...entries.flatMap((entry) => exportSpellcasting(entry, actor)));
  const inventory = actor.items.filter((item) => ["weapon", "armor", "shield", "consumable", "equipment", "backpack", "treasure"].includes(item.type));
  if (inventory.length) lines.push("", "## Inventory", ...inventory.flatMap(exportInventory));
  const effects = actor.items.filter((item) => item.type === "effect");
  if (effects.length) lines.push("", "## Effects", ...effects.flatMap(exportEffect));
  return `${lines.join("\n")}\n`;
}

function exportHazardToMarkdown(actor) {
  const system = actor.system;
  const lines = [
    `# ${actor.name}`,
    "Type: hazard",
    `Level: ${system.details?.level?.value ?? 1}`,
    `Rarity: ${system.traits?.rarity ?? "common"}`,
    `Size: ${system.traits?.size?.value ?? "medium"}`,
    `Traits: ${(system.traits?.value ?? []).join(", ")}`,
    `Complexity: ${system.details?.isComplex ? "complex" : "simple"}`,
    `Stealth: ${signed(system.attributes?.stealth?.value ?? 0)}${system.attributes?.stealth?.details ? `; ${system.attributes.stealth.details}` : ""}`,
    `AC: ${system.attributes?.ac?.value ?? 10}`,
    `Fortitude: ${signed(system.saves?.fortitude?.value ?? 0)}`,
    `Reflex: ${signed(system.saves?.reflex?.value ?? 0)}`,
    `Will: ${signed(system.saves?.will?.value ?? 0)}`,
    `Hardness: ${system.attributes?.hardness ?? 0}`,
    `HP: ${system.attributes?.hp?.max ?? system.attributes?.hp?.value ?? 0}`,
    formatIWR("Immunities", system.attributes?.immunities),
    formatIWR("Weaknesses", system.attributes?.weaknesses),
    formatIWR("Resistances", system.attributes?.resistances),
    `Description: ${stripHtml(system.details?.description ?? "")}`,
    system.details?.disable ? `Disable: ${stripHtml(system.details.disable)}` : "",
    system.details?.routine ? `Routine: ${stripHtml(system.details.routine)}` : "",
    system.details?.reset ? `Reset: ${stripHtml(system.details.reset)}` : ""
  ].filter(Boolean);
  const attacks = actor.items.filter((item) => item.type === "melee");
  if (attacks.length) lines.push("", "## Attacks", ...attacks.flatMap(exportAttack));
  const actions = actor.items.filter((item) => item.type === "action");
  if (actions.length) lines.push("", "## Actions", ...actions.flatMap(exportAction));
  return `${lines.join("\n")}\n`;
}

function exportAttack(item) {
  const system = item.system;
  return [
    "",
    `### ${item.name}`,
    `Type: ${system.range ? "ranged" : "melee"}`,
    `Bonus: ${signed(system.bonus?.value ?? 0)}`,
    `Damage: ${formatDamageRolls(system.damageRolls ?? {})}`,
    system.range?.increment ? `Range: ${system.range.increment} feet` : "",
    system.area ? `Area: ${system.area.value}-foot ${system.area.type}` : "",
    `Traits: ${(system.traits?.value ?? []).join(", ")}`,
    (system.attackEffects?.value ?? []).length ? `Effects: ${system.attackEffects.value.join(", ")}` : "",
    `Description: ${stripHtml(system.description?.value ?? "")}`,
    formatRules(system.rules)
  ].filter(Boolean);
}

function exportAction(item) {
  const system = item.system;
  return ["", `### ${item.name}`, `Type: ${system.actionType?.value ?? "action"}`, `Actions: ${system.actions?.value ?? 1}`, `Category: ${system.category ?? "offensive"}`, `Traits: ${(system.traits?.value ?? []).join(", ")}`, `Description: ${stripHtml(system.description?.value ?? "")}`, formatRules(system.rules)].filter(Boolean);
}

function exportSpellcasting(entry, actor) {
  const spells = actor.items.filter((item) => item.type === "spell" && item.system.location?.value === entry.id);
  const grouped = new Map();
  for (const spell of spells) {
    const rank = spell.system.level?.value ?? 0;
    const label = spell.system.location?.uses?.max === -1 ? "At Will" : (rank === 0 ? "Cantrips" : String(rank));
    const suffix = spell.system.location?.signature ? " (signature)" : "";
    grouped.set(label, [...(grouped.get(label) ?? []), `${spell.name}${suffix}`]);
  }
  return [
    "",
    `### ${entry.name}`,
    `Tradition: ${entry.system.tradition?.value ?? "arcane"}`,
    `Type: ${entry.system.prepared?.value ?? "innate"}`,
    `Ability: ${entry.system.ability?.value ?? "cha"}`,
    `DC: ${entry.system.spelldc?.dc ?? 0}`,
    `Attack: ${signed(entry.system.spelldc?.value ?? 0)}`,
    "Description:",
    ...Array.from(grouped.entries()).map(([rank, names]) => `- ${rank}: ${names.join(", ")}`),
    formatRules(entry.system.rules)
  ].filter(Boolean);
}

function exportInventory(item) {
  const system = item.system;
  return ["", `### ${item.name}`, `Type: ${item.type}`, `Level: ${system.level?.value ?? 0}`, `Quantity: ${system.quantity ?? 1}`, `Traits: ${(system.traits?.value ?? []).join(", ")}`, `Description: ${stripHtml(system.description?.value ?? "")}`, formatRules(system.rules)].filter(Boolean);
}

function exportEffect(item) {
  const system = item.system;
  const aura = (system.rules ?? []).find((rule) => rule.key === "Aura");
  return ["", `### ${item.name}`, `Traits: ${(system.traits?.value ?? []).join(", ")}`, aura?.radius ? `Radius: ${aura.radius} feet` : "", `Duration: ${formatDuration(system.duration)}`, `Description: ${stripHtml(system.description?.value ?? "")}`, formatRules(system.rules)].filter(Boolean);
}

function formatDamageRolls(rolls) {
  return Object.values(rolls).map((roll) => `${roll.damage} ${roll.category ? `${roll.category} ` : ""}${roll.damageType}`).join(" plus ");
}

function formatSkills(skills) {
  return Object.entries(skills).map(([key, value]) => `${key} ${signed(value.base ?? value.mod ?? value.value ?? 0)}`).join(", ");
}

function formatSenses(senses) {
  return senses.map((sense) => `${sense.type}${sense.range ? ` ${sense.range} feet` : ""}`).join(", ");
}

function formatIWR(label, values = []) {
  return values.length ? `${label}: ${values.map((entry) => `${entry.type}${entry.value ? ` ${entry.value}` : ""}`).join(", ")}` : "";
}

function formatSpeed(speed) {
  const other = (speed?.otherSpeeds ?? []).map((entry) => `${entry.type} ${entry.value} feet`);
  return [`${speed?.value ?? 25} feet`, ...other].join(", ");
}

function formatDuration(duration) {
  if (!duration) return "unlimited";
  if (duration.value === -1) return "unlimited";
  return `${duration.value ?? 1} ${duration.unit ?? "round"}`;
}

function formatRules(rules = []) {
  return rules.length ? `RuleElements:\n${rules.map((rule) => `- ${JSON.stringify(rule)}`).join("\n")}` : "";
}

function stripHtml(value) {
  return String(value ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Loose / published stat block support
//
// Accepts the standard published PF2e layout (Archives of Nethys / Monster Core
// text) and converts it into the strict Markdown the parser already understands,
// so both NPCs and hazards share a single downstream pipeline.
// ---------------------------------------------------------------------------

const LOOSE_RARITIES = new Set(["common", "uncommon", "rare", "unique"]);
const LOOSE_SIZES = new Set(["tiny", "small", "medium", "large", "huge", "gargantuan"]);
const LOOSE_ALIGNMENTS = new Set(["lg", "ng", "cg", "ln", "n", "cn", "le", "ne", "ce", "any"]);

function looksLikeStrictMarkdown(text) {
  return /^\s*#\s+\S/m.test(String(text ?? ""));
}

function normalizeActionGlyphs(line) {
  return String(line)
    .replace(/\bsingle action\b/gi, "one-action")
    .replace(/[➊①]/g, " [one-action] ")
    .replace(/[➋②]/g, " [two-actions] ")
    .replace(/[➌③]/g, " [three-actions] ");
}

function readActionToken(line) {
  const match = line.match(/\[\s*(free[\s-]?action|reaction|one[\s-]?action|two[\s-]?actions?|three[\s-]?actions?|1\s?action|2\s?actions?|3\s?actions?)\s*\]/i);
  if (!match) return null;
  const token = match[1].toLowerCase();
  let type = "action";
  let count = 1;
  if (token.includes("free")) type = "free";
  else if (token.includes("reaction")) type = "reaction";
  else if (token.includes("two") || token.includes("2")) count = 2;
  else if (token.includes("three") || token.includes("3")) count = 3;
  return { type, count, index: match.index, length: match[0].length };
}

function readPassiveAbility(line) {
  const match = line.match(/^([A-Z][A-Za-z'’-]+(?:\s+[A-Za-z'’-]+){0,4})\s+\(([a-z][a-z0-9,\s-]*)\)\s*(.*)$/);
  return match ? { name: match[1].trim(), traits: match[2].trim(), rest: match[3].trim() } : null;
}

function parseLooseHeader(line) {
  let match = line.match(/^(.*?)[\s–—-]*\b(creature|hazard|npc)\b\s*(-?\d+)\s*$/i);
  if (match) return { name: match[1].replace(/[\s–—-]+$/, "").trim(), kind: /hazard/i.test(match[2]) ? "hazard" : "npc", level: Number(match[3]) };
  match = line.match(/^(.*\S)\s+(-?\d+)\s*$/);
  if (match) return { name: match[1].trim(), kind: "npc", level: Number(match[2]) };
  return { name: line.trim(), kind: "npc", level: null };
}

function parseLooseTraitLine(line, core) {
  const tokens = line.split(/[,]/).flatMap((part) => part.trim().split(/\s+/)).map((token) => token.trim()).filter(Boolean);
  const traits = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (LOOSE_RARITIES.has(lower)) core.rarity = lower;
    else if (LOOSE_SIZES.has(lower)) core.size = lower;
    else if (LOOSE_ALIGNMENTS.has(lower)) continue;
    else traits.push(lower);
  }
  if (traits.length) core.traits = traits;
}

function mapLooseDefenseLine(line, out) {
  for (const segment of line.split(";")) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const keyword = slugify(trimmed.match(/^([A-Za-z]+)/)?.[1] ?? "");
    if (["immunities", "weaknesses", "resistances"].includes(keyword)) {
      out.push(`${titleCase(keyword)}: ${trimmed.replace(/^[A-Za-z]+\s*/, "").trim()}`);
      continue;
    }
    for (const piece of trimmed.split(",")) {
      const token = piece.trim();
      const kv = token.match(/^([A-Za-z]+)\s+(.*)$/);
      if (!kv) continue;
      const key = slugify(kv[1]);
      const rest = kv[2].trim();
      if (key === "ac") out.push(`AC: ${rest}`);
      else if (["fort", "fortitude"].includes(key)) out.push(`Fortitude: ${rest}`);
      else if (["ref", "reflex"].includes(key)) out.push(`Reflex: ${rest}`);
      else if (key === "will") out.push(`Will: ${rest}`);
      else if (key === "hp") out.push(`HP: ${rest.replace(/\(.*?\)/g, "").trim()}`);
      else if (key === "hardness") out.push(`Hardness: ${rest}`);
    }
  }
}

function buildLooseAttackBlock(line) {
  const type = /^ranged/i.test(line) ? "ranged" : "melee";
  let rest = line.replace(/^(melee|ranged)\b/i, "").trim();
  const token = readActionToken(rest);
  if (token) rest = (rest.slice(0, token.index) + rest.slice(token.index + token.length)).trim();
  const damageMatch = rest.match(/,?\s*Damage\s+(.*)$/i);
  let damageText = damageMatch ? damageMatch[1].trim() : "";
  if (damageMatch) rest = rest.slice(0, damageMatch.index).trim();
  const head = rest.match(/^(.*?)\s*([+-]\d+)\s*(?:\(([^)]*)\))?\s*$/);
  const name = (head?.[1] ?? rest).trim() || "Attack";
  const bonus = head?.[2] ?? "+0";
  const parenItems = splitList(head?.[3] ?? "");
  const traits = [];
  let range = null;
  for (const item of parenItems) {
    const reach = item.match(/reach\s+(\d+)/i);
    const increment = item.match(/range(?:\s+increment)?\s+(\d+)/i);
    if (reach) traits.push(`reach-${reach[1]}`);
    else if (increment) range = Number(increment[1]);
    else traits.push(slugify(item));
  }
  const damageSegments = damageText ? damageText.split(/\bplus\b/i).map((part) => part.trim()).filter(Boolean) : [];
  const damageParts = [];
  const effects = [];
  for (const segment of damageSegments) {
    if (/^\d/.test(segment) || /\d+d\d+/.test(segment)) damageParts.push(segment);
    else effects.push(slugify(segment));
  }
  const block = ["", `### ${name}`, `Type: ${type}`, `Bonus: ${bonus}`];
  if (damageParts.length) block.push(`Damage: ${damageParts.join(" plus ")}`);
  if (range) block.push(`Range: ${range} feet`);
  if (traits.length) block.push(`Traits: ${traits.join(", ")}`);
  if (effects.length) block.push(`Effects: ${effects.join(", ")}`);
  return block;
}

function buildLooseSpellBlock(line) {
  const dc = line.match(/\bDC\s+(\d+)/i)?.[1];
  const attack = line.match(/\battack\s+([+-]?\d+)/i)?.[1];
  const headMatch = line.match(/^(.*?spells|.*?rituals|.*?focus)\b/i);
  const header = (headMatch?.[1] ?? "Spells").replace(/\s+(DC|attack).*/i, "").trim();
  const headerSlug = slugify(header);
  const tradition = ["arcane", "divine", "occult", "primal"].find((t) => headerSlug.includes(t)) ?? "arcane";
  const type = ["prepared", "spontaneous", "innate", "focus", "ritual"].find((t) => headerSlug.includes(t)) ?? "innate";
  const body = line.slice((headMatch?.[0]?.length ?? 0)).replace(/^[^;]*?(DC\s+\d+(,\s*attack\s+[+-]?\d+)?)?/i, "");
  const block = ["", `### ${header || "Spells"}`, `Tradition: ${tradition}`, `Type: ${type}`];
  if (dc) block.push(`DC: ${dc}`);
  if (attack) block.push(`Attack: ${attack}`);
  block.push("Description:");
  for (const rawSegment of body.split(";")) {
    const segment = rawSegment.trim();
    if (!segment) continue;
    let m = segment.match(/^(\d+)(?:st|nd|rd|th)?\b\s*(?:\((\d+)\s*slots?\))?\s*(.+)$/i);
    if (m) { block.push(`- ${m[1]}${m[2] ? ` (${m[2]} slots)` : ""}: ${m[3].trim()}`); continue; }
    m = segment.match(/^cantrips?\b(?:\s*\((\d+)(?:st|nd|rd|th)?\))?\s*:?\s*(.+)$/i);
    if (m) { block.push(`- Cantrips: ${m[2].trim()}`); continue; }
    m = segment.match(/^(constant|at[\s-]?will)\b(?:\s*\((\d+)(?:st|nd|rd|th)?\))?\s*:?\s*(.+)$/i);
    if (m) { block.push(`- ${/constant/i.test(m[1]) ? "Constant" : "At Will"}: ${m[3].trim()}`); continue; }
  }
  return block;
}

function flushLooseAction(action, actionText) {
  if (!action) return;
  const block = ["", `### ${action.name}`, `Type: ${action.type}`];
  if (action.type === "action") block.push(`Actions: ${action.count}`);
  if (action.traits) block.push(`Traits: ${action.traits}`);
  const description = action.descLines.join(" ").trim();
  if (description) block.push(`Description: ${description}`);
  actionText.push(...block);
}

function convertLooseToStrict(text, warnings = []) {
  warnings.push(game.i18n.localize("GLSBI.parse.looseReader"));
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n").map((line) => normalizeActionGlyphs(line).trim());
  const core = { rarity: "common", size: "medium", traits: [] };
  const coreLines = [];
  const attackText = [];
  const actionText = [];
  const spellText = [];
  const inventory = [];
  const descParts = [];
  let header = null;
  let sawTraitLine = false;
  let pendingAction = null;
  let pendingField = null;

  const flushPending = () => {
    flushLooseAction(pendingAction, actionText);
    pendingAction = null;
    if (pendingField) {
      coreLines.push(`${pendingField.label}: ${pendingField.lines.join(" ").trim()}`);
      pendingField = null;
    }
  };

  for (const line of lines) {
    if (!line) { continue; }
    if (!header) { header = parseLooseHeader(line); continue; }

    const keyword = line.match(/^([A-Za-z][A-Za-z-]*)\b/)?.[1]?.toLowerCase() ?? "";
    const isAbilityLine = /\b(str|dex|con|int|wis|cha)\b.*\b(str|dex|con|int|wis|cha)\b/i.test(line) && /^(str|dex|con|int|wis|cha)\b/i.test(line);

    if (!sawTraitLine) {
      sawTraitLine = true;
      const knownStart = ["perception", "languages", "skills", "items", "ac", "hp", "hardness", "speed", "melee", "ranged", "stealth", "disable", "routine", "reset", "trigger", "effect"].includes(keyword);
      if (!knownStart && !isAbilityLine && !/[:+]/.test(line)) { parseLooseTraitLine(line, core); continue; }
    }

    if (/^(melee|ranged)\b/i.test(line)) { flushPending(); attackText.push(...buildLooseAttackBlock(line)); continue; }
    if (/spells\b/i.test(line) && /\bDC\s+\d+/i.test(line)) { flushPending(); spellText.push(...buildLooseSpellBlock(line)); continue; }
    if (/(focus\s+spells|rituals)\b/i.test(line)) { flushPending(); spellText.push(...buildLooseSpellBlock(line)); continue; }

    if (keyword === "perception") {
      flushPending();
      const value = line.replace(/^perception\b\s*/i, "");
      const [mod, ...senses] = value.split(";");
      coreLines.push(`Perception: ${mod.trim()}`);
      if (senses.length) coreLines.push(`Senses: ${senses.join(";").trim()}`);
      continue;
    }
    if (keyword === "languages") { flushPending(); coreLines.push(`Languages: ${line.replace(/^languages?\b\s*/i, "")}`); continue; }
    if (keyword === "skills") { flushPending(); coreLines.push(`Skills: ${line.replace(/^skills?\b\s*/i, "")}`); continue; }
    if (isAbilityLine) { flushPending(); coreLines.push(`Abilities: ${line}`); continue; }
    if (keyword === "items") { flushPending(); inventory.push(...splitList(line.replace(/^items?\b\s*/i, "")).map((name) => name.replace(/\([^)]*\)/g, "").trim()).filter(Boolean)); continue; }
    if (keyword === "stealth") { flushPending(); coreLines.push(`Stealth: ${line.replace(/^stealth\b\s*/i, "")}`); continue; }
    if (keyword === "speed") { flushPending(); coreLines.push(`Speed: ${line.replace(/^speed\b\s*/i, "")}`); continue; }
    if (keyword === "ac" || keyword === "hp" || keyword === "hardness") { flushPending(); mapLooseDefenseLine(line, coreLines); continue; }
    if (["disable", "routine", "reset"].includes(keyword)) {
      flushPending();
      pendingField = { label: titleCase(keyword), lines: [line.replace(/^[A-Za-z]+\b\s*/i, "").trim()] };
      continue;
    }

    const actionToken = readActionToken(line);
    if (actionToken) {
      flushPending();
      const name = line.slice(0, actionToken.index).trim() || "Ability";
      const after = line.slice(actionToken.index + actionToken.length).trim();
      const traitMatch = after.match(/^\(([^)]*)\)\s*(.*)$/);
      pendingAction = { name, type: actionToken.type, count: actionToken.count, traits: traitMatch ? traitMatch[1].trim() : "", descLines: traitMatch ? [traitMatch[2]] : [after] };
      continue;
    }

    const passive = readPassiveAbility(line);
    if (passive && sawTraitLine) {
      flushPending();
      pendingAction = { name: passive.name, type: "passive", count: 1, traits: passive.traits, descLines: [passive.rest] };
      continue;
    }

    if (pendingAction) pendingAction.descLines.push(line);
    else if (pendingField) pendingField.lines.push(line);
    else descParts.push(line);
  }
  flushPending();

  const out = [`# ${header?.name ?? "Imported Stat Block"}`];
  if (header?.kind === "hazard") out.push("Type: hazard");
  if (Number.isInteger(header?.level)) out.push(`Level: ${header.level}`);
  out.push(`Rarity: ${core.rarity}`, `Size: ${core.size}`);
  if (core.traits.length) out.push(`Traits: ${core.traits.join(", ")}`);
  out.push(...coreLines);
  if (descParts.length) out.push(`Description: ${descParts.join(" ").trim()}`);
  if (attackText.length) out.push("", "## Attacks", ...attackText);
  if (actionText.length) out.push("", "## Actions", ...actionText);
  if (spellText.length) out.push("", "## Spellcasting", ...spellText);
  if (inventory.length) out.push("", "## Inventory", ...inventory.flatMap((name) => ["", `### ${name}`, "Type: equipment"]));
  return out.join("\n");
}

function sampleStatBlock() {
  return `# Ember Drake Warden
Level: 5
Rarity: uncommon
Size: medium
Traits: dragon, fire
Perception: +13; Senses: darkvision, smoke vision
Languages: Common, Draconic
Skills: Acrobatics +12, Athletics +14, Intimidation +13, Stealth +10
Abilities: STR +5, DEX +3, CON +4, INT +0, WIS +2, CHA +4
AC: 22
Fortitude: +15
Reflex: +12
Will: +11
HP: 78
Immunities: fire
Weaknesses: cold 5
Speed: 25 feet, fly 40 feet
Description: A disciplined drake trained to guard volcanic sanctums.

## Attacks
### Jaws
Type: melee
Bonus: +15
Damage: 2d8+7 piercing
Traits: magical, reach-10
Effects: grabbed
Description: On a critical hit, the target is frightened 1.

### Tail
Type: melee
Bonus: +13
Damage: 2d6+7 bludgeoning
Traits: agile, reach-10

## Actions
### Breath Weapon
Type: action
Actions: 2
Traits: arcane, evocation, fire
Description: The warden breathes fire in a 30-foot cone. Creatures in the area take 6d6 fire damage with a DC 22 Reflex save.
RuleElements: []

## Spellcasting
### Arcane Innate Spells
Tradition: arcane
Type: innate
Ability: cha
DC: 22
Attack: +14
Description:
- Cantrips: detect magic, light
- 2: obscuring mist
- 1: fear

## Inventory
### Warden Collar
Type: equipment
Level: 5
Traits: invested, magical
Description: The collar marks the drake as a bonded guardian.

## Effects
### Heat Shimmer Aura
Traits: aura, fire, visual
Radius: 10 feet
Description: Creatures in the aura are concealed by wavering heat.
RuleElements:
- {"key":"Aura","radius":10,"traits":["fire","visual"],"effects":[]}
`;
}
