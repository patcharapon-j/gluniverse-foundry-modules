/**
 * PF2e "Building Creatures" benchmark tables (Gamemastery Guide), embedded so a
 * support's ability numbers can be computed from a single GM-entered level + a
 * proficiency tier — no linked actor required.
 *
 * Source: Archives of Nethys, "Building Creatures" statistics tables. Rows run
 * from creature level −1 to 24. Perception and Saving Throws share one scale.
 *
 * Resolver respects PF2e's Proficiency-Without-Level variant: when that setting
 * is on, the creature's level is subtracted from every d20-based statistic and
 * DC (damage is unaffected). On non-PF2e systems the variant simply reads false.
 */

import { SUPPORT_TIERS } from "../const.js";

const LEVEL_MIN = -1;
const LEVEL_MAX = 24;

/* Each array is indexed by (level − LEVEL_MIN); columns follow the tier order
   noted above the table. Missing tiers (e.g. spells have no Low/Terrible) are
   resolved by clamping to the nearest available column. */

// Perception & Saving Throws — [Extreme, High, Moderate, Low, Terrible]
const PERCEPTION_SAVE = [
  [9,8,5,2,0],[10,9,6,3,1],[11,10,7,4,2],[12,11,8,5,3],[14,12,9,6,4],[15,14,11,8,6],
  [17,15,12,9,7],[18,17,14,11,8],[20,18,15,12,10],[21,19,16,13,11],[23,21,18,15,12],
  [24,22,19,16,14],[26,24,21,18,15],[27,25,22,19,16],[29,26,23,20,18],[30,28,25,22,19],
  [32,29,26,23,20],[33,30,28,25,22],[35,32,29,26,23],[36,33,30,27,24],[38,35,32,29,26],
  [39,36,33,30,27],[41,38,35,32,28],[43,39,36,33,30],[44,40,37,34,31],[46,42,38,36,32]
];

// Skills — [Extreme, High, Moderate, Low] (Low column uses the upper of its range)
const SKILL = [
  [8,5,4,2],[9,6,5,3],[10,7,6,4],[11,8,7,5],[13,10,9,7],[15,12,10,8],
  [16,13,12,10],[18,15,13,11],[20,17,15,13],[21,18,16,14],[23,20,18,16],
  [25,22,19,17],[26,23,21,19],[28,25,22,20],[30,27,24,22],[31,28,25,23],
  [33,30,27,25],[35,32,28,26],[36,33,30,28],[38,35,31,29],[40,37,33,31],
  [41,38,34,32],[43,40,36,34],[45,42,37,35],[46,43,38,36],[48,45,40,38]
];

// Armor Class — [Extreme, High, Moderate, Low]
const AC = [
  [18,15,14,12],[19,16,15,13],[19,16,15,13],[21,18,17,15],[22,19,18,16],[24,21,20,18],
  [25,22,21,19],[27,24,23,21],[28,25,24,22],[30,27,26,24],[31,28,27,25],[33,30,29,27],
  [34,31,30,28],[36,33,32,30],[37,34,33,31],[39,36,35,33],[40,37,36,34],[42,39,38,36],
  [43,40,39,37],[45,42,41,39],[46,43,42,40],[48,45,44,42],[49,46,45,43],[51,48,47,45],
  [52,49,48,46],[54,51,50,48]
];

// Spell / class / effect DC — [Extreme, High, Moderate]
const SPELL_DC = [
  [19,16,13],[19,16,13],[20,17,14],[22,18,15],[23,20,17],[25,21,18],
  [26,22,19],[27,24,21],[29,25,22],[30,26,23],[32,28,25],[33,29,26],
  [34,30,27],[36,32,29],[37,33,30],[39,34,31],[40,36,33],[41,37,34],
  [43,38,35],[44,40,37],[46,41,38],[47,42,39],[48,44,41],[50,45,42],
  [51,46,43],[52,48,45]
];

// Spell attack bonus — [Extreme, High, Moderate]
const SPELL_ATTACK = [
  [11,8,5],[11,8,5],[12,9,6],[14,10,7],[15,12,9],[17,13,10],
  [18,14,11],[19,16,13],[21,17,14],[22,18,15],[24,20,17],[25,21,18],
  [26,22,19],[28,24,21],[29,25,22],[31,26,23],[32,28,25],[33,29,26],
  [35,30,27],[36,32,29],[38,33,30],[39,34,31],[40,36,33],[42,37,34],
  [43,38,35],[44,40,37]
];

// Strike attack bonus — [Extreme, High, Moderate, Low]
const STRIKE_ATTACK = [
  [10,8,6,4],[10,8,6,4],[11,9,7,5],[13,11,9,7],[14,12,10,8],[16,14,12,9],
  [17,15,13,11],[19,17,15,12],[20,18,16,13],[22,20,18,15],[23,21,19,16],[25,23,21,17],
  [27,24,22,19],[28,26,24,20],[29,27,25,21],[31,29,27,23],[32,30,28,24],[34,32,30,25],
  [35,33,31,27],[37,35,33,28],[38,36,34,29],[40,38,36,31],[41,39,37,32],[43,41,39,33],
  [44,42,40,35],[46,44,42,36]
];

// Strike damage dice — [Extreme, High, Moderate, Low]
const STRIKE_DAMAGE = [
  ["1d6+1","1d4+1","1d4","1d4"],["1d6+3","1d6+2","1d4+2","1d4+1"],["1d8+4","1d6+3","1d6+2","1d4+2"],
  ["1d12+4","1d10+4","1d8+4","1d6+3"],["1d12+8","1d10+6","1d8+6","1d6+5"],["2d10+7","2d8+5","2d6+5","2d4+4"],
  ["2d12+7","2d8+7","2d6+6","2d4+6"],["2d12+10","2d8+9","2d6+8","2d4+7"],["2d12+12","2d10+9","2d8+8","2d6+6"],
  ["2d12+15","2d10+11","2d8+9","2d6+8"],["2d12+17","2d10+13","2d8+11","2d6+9"],["2d12+20","2d12+13","2d10+11","2d6+10"],
  ["2d12+22","2d12+15","2d10+12","2d8+10"],["3d12+19","3d10+14","3d8+12","3d6+10"],["3d12+21","3d10+16","3d8+14","3d6+11"],
  ["3d12+24","3d10+18","3d8+15","3d6+13"],["3d12+26","3d12+17","3d10+14","3d6+14"],["3d12+29","3d12+18","3d10+15","3d6+15"],
  ["3d12+31","3d12+19","3d10+16","3d6+16"],["3d12+34","3d12+20","3d10+17","3d6+17"],["4d12+29","4d10+20","4d8+17","4d6+14"],
  ["4d12+32","4d10+22","4d8+19","4d6+15"],["4d12+34","4d10+24","4d8+20","4d6+17"],["4d12+37","4d10+26","4d8+22","4d6+18"],
  ["4d12+39","4d12+24","4d10+20","4d6+19"],["4d12+42","4d12+26","4d10+22","4d6+21"]
];

/** stat key → { table, columns } where columns lists the tiers that table has. */
const STAT_TABLES = {
  perception:  { table: PERCEPTION_SAVE, cols: ["extreme","high","moderate","low","terrible"], kind: "mod" },
  save:        { table: PERCEPTION_SAVE, cols: ["extreme","high","moderate","low","terrible"], kind: "mod" },
  skill:       { table: SKILL,           cols: ["extreme","high","moderate","low"],             kind: "mod" },
  ac:          { table: AC,              cols: ["extreme","high","moderate","low"],             kind: "dc"  },
  dc:          { table: SPELL_DC,        cols: ["extreme","high","moderate"],                   kind: "dc"  },
  spellAttack: { table: SPELL_ATTACK,    cols: ["extreme","high","moderate"],                   kind: "mod" },
  attack:      { table: STRIKE_ATTACK,   cols: ["extreme","high","moderate","low"],             kind: "mod" },
  damage:      { table: STRIKE_DAMAGE,   cols: ["extreme","high","moderate","low"],             kind: "dice" }
};

const clampLevel = (lvl) => Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, Math.trunc(Number(lvl) || 0)));

/** Pick the column for `tier`, falling back to the nearest tier the table has. */
function columnFor(spec, tier) {
  if (spec.cols.includes(tier)) return spec.cols.indexOf(tier);
  // Walk the global tier order from the requested tier toward an available one.
  const order = SUPPORT_TIERS;
  const start = Math.max(0, order.indexOf(tier));
  for (let d = 0; d < order.length; d++) {
    const lo = order[start - d], hi = order[start + d];
    if (lo && spec.cols.includes(lo)) return spec.cols.indexOf(lo);
    if (hi && spec.cols.includes(hi)) return spec.cols.indexOf(hi);
  }
  return spec.cols.length - 1;
}

export class Benchmarks {
  /** True when the PF2e Proficiency-Without-Level variant is active.
   *  Modern PF2e exposes this as a boolean at game.pf2e.settings.variants.pwol.enabled;
   *  older builds stored a string setting "proficiencyVariant". Check both so the
   *  numbers subtract level on any PF2e version (and false off-PF2e). */
  static get proficiencyWithoutLevel() {
    try {
      const pwol = game.pf2e?.settings?.variants?.pwol?.enabled;
      if (typeof pwol === "boolean") return pwol;
    } catch { /* fall through */ }
    try {
      const v = game.settings.get("pf2e", "proficiencyVariant");
      return v === "ProficiencyWithoutLevel" || v === true;
    } catch { return false; }
  }

  /**
   * Resolve a stat to its concrete value at `level` and `tier`.
   * - "mod" stats return a signed number (e.g. +18) as a Number.
   * - "dc" stats return a DC Number.
   * - "damage" returns a dice expression string (e.g. "2d8+9").
   * d20-based stats and DCs honour Proficiency-Without-Level (subtract level);
   * damage never does.
   */
  static resolve(stat, level, tier = "moderate") {
    const spec = STAT_TABLES[stat];
    if (!spec) return null;
    const row = spec.table[clampLevel(level) - LEVEL_MIN];
    if (!row) return null;
    const val = row[columnFor(spec, tier)];
    if (spec.kind === "dice") return val;
    let n = Number(val);
    if (this.proficiencyWithoutLevel) n -= clampLevel(level);
    return n;
  }

  /** Convenience: a save/skill/attack modifier as a "+N" / "−N" string. */
  static modifier(stat, level, tier) {
    const n = this.resolve(stat, level, tier);
    if (typeof n !== "number") return null;
    return (n >= 0 ? "+" : "−") + Math.abs(n);
  }

  static get levelRange() { return { min: LEVEL_MIN, max: LEVEL_MAX }; }
}
