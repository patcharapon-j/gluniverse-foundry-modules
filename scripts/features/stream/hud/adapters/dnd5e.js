/**
 * D&D 5e data provider for the Party HUD.
 *
 * Each method reads from a live Actor document and returns plain, serializable
 * values — the GM computes these and broadcasts them to the stream client, so
 * nothing here may return live document references. Every read is defensive:
 * sheets vary across dnd5e versions and homebrew, and a missing field must
 * degrade to a sane blank rather than throw.
 */

const ABILITY_ORDER = ["str", "dex", "con", "int", "wis", "cha"];

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const dnd5eAdapter = {
  id: "dnd5e",

  /** True when this actor is a PC-style sheet the HUD can meaningfully show. */
  supportsActor(actor) {
    return Boolean(actor && (actor.type === "character" || actor.type === "npc"));
  },

  getName(actor) {
    return actor?.name ?? "";
  },

  getPortrait(actor) {
    return actor?.img || actor?.prototypeToken?.texture?.src || "icons/svg/mystery-man.svg";
  },

  getHP(actor) {
    const hp = actor?.system?.attributes?.hp ?? {};
    return { value: num(hp.value), max: num(hp.max), temp: num(hp.temp) };
  },

  getAC(actor) {
    return num(actor?.system?.attributes?.ac?.value, null);
  },

  /** Multiclass-aware "Warlock 5" / "Warlock 3 / Fighter 2" style string. */
  getClassLevel(actor) {
    const classes = actor?.itemTypes?.class ?? [];
    if (classes.length) {
      return classes
        .map(cls => ({ name: cls.name, levels: num(cls.system?.levels, 1) }))
        .sort((a, b) => b.levels - a.levels)
        .map(cls => `${cls.name} ${cls.levels}`)
        .join(" / ");
    }
    const level = num(actor?.system?.details?.level);
    return level ? `Level ${level}` : "";
  },

  getRace(actor) {
    const race = actor?.system?.details?.race;
    return (actor?.itemTypes?.race?.[0]?.name) ?? race?.name ?? (typeof race === "string" ? race : "") ?? "";
  },

  /**
   * The actor's signature class resource: Warlock pact slots first (the
   * reference card's "Pact"), then a configured primary resource.
   */
  getPrimaryResource(actor) {
    const pact = actor?.system?.spells?.pact;
    if (pact && num(pact.max) > 0) {
      return { label: game.i18n.localize("GLUNIVERSE_STREAM.hud.resource.pact"), value: num(pact.value), max: num(pact.max), level: num(pact.level) };
    }
    const primary = actor?.system?.resources?.primary;
    if (primary && num(primary.max) > 0) {
      return { label: primary.label || game.i18n.localize("GLUNIVERSE_STREAM.hud.resource.generic"), value: num(primary.value), max: num(primary.max) };
    }
    return null;
  },

  getAbilities(actor) {
    const abilities = actor?.system?.abilities ?? {};
    const config = CONFIG?.DND5E?.abilities ?? {};
    return ABILITY_ORDER.filter(key => abilities[key]).map(key => {
      const label = config[key]?.abbreviation ?? config[key]?.label ?? key;
      return {
        key,
        label: String(label).toUpperCase(),
        value: num(abilities[key]?.value, 10),
        mod: num(abilities[key]?.mod)
      };
    });
  },

  getConditions(actor) {
    const effects = actor?.temporaryEffects ?? [];
    return effects
      .filter(effect => effect && effect.disabled !== true && effect.isSuppressed !== true)
      .map(effect => ({
        id: effect.id ?? effect.name,
        label: effect.name ?? "",
        img: effect.img || effect.icon || "icons/svg/aura.svg"
      }));
  },

  isDefeated(actor) {
    const hp = actor?.system?.attributes?.hp ?? {};
    if (num(hp.max) > 0 && num(hp.value) <= 0) return true;
    return Boolean(actor?.statuses?.has?.("dead"));
  }
};
