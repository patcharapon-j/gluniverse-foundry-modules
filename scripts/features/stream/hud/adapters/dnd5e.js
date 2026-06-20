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
   * The actor's named class resources, in display priority. Warlock pact slots
   * lead (the reference card's "Pact"), followed by the sheet's configured
   * resources (ki, rage, sorcery points, bardic inspiration, …). Each entry is
   * `kind: "pips"` when small enough to draw as dots, else a `"counter"`.
   */
  getResources(actor) {
    const out = [];
    const pact = actor?.system?.spells?.pact;
    if (pact && num(pact.max) > 0) {
      out.push({
        key: "pact",
        label: game.i18n.localize("GLUNIVERSE_STREAM.hud.resource.pact"),
        value: num(pact.value),
        max: num(pact.max),
        kind: "pips"
      });
    }
    const resources = actor?.system?.resources ?? {};
    for (const slot of ["primary", "secondary", "tertiary"]) {
      const r = resources[slot];
      if (!r || num(r.max) <= 0) continue;
      out.push({
        key: slot,
        label: r.label || game.i18n.localize("GLUNIVERSE_STREAM.hud.resource.generic"),
        value: num(r.value),
        max: num(r.max),
        kind: num(r.max) <= 12 ? "pips" : "counter"
      });
    }
    return out;
  },

  /** Leveled spell slots (1–9) the actor actually has, for the slot tracker. */
  getSpellSlots(actor) {
    const spells = actor?.system?.spells ?? {};
    const out = [];
    for (let level = 1; level <= 9; level += 1) {
      const slot = spells[`spell${level}`];
      if (slot && num(slot.max) > 0) out.push({ level, value: num(slot.value), max: num(slot.max) });
    }
    return out;
  },

  /** Whether the character currently holds Heroic Inspiration. */
  getInspiration(actor) {
    return Boolean(actor?.system?.attributes?.inspiration);
  },

  /** Bloodied = at or below half max HP (and still up), per the 2024 rules. */
  isBloodied(actor) {
    const hp = actor?.system?.attributes?.hp ?? {};
    const max = num(hp.max);
    const value = num(hp.value);
    return max > 0 && value > 0 && value <= Math.floor(max / 2);
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
        mod: num(abilities[key]?.mod),
        proficient: num(abilities[key]?.proficient) > 0
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
