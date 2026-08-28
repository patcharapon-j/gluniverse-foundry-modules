/**
 * GLUniverse Suite — Reflavor: the clipboard payload.
 *
 * The payload is SELF-CONTAINED. It carries the exported stat block, the
 * grammar for exactly the sections that stat block uses, the rules of the
 * chosen rung, and — at the rebuilding rungs — the Building Creatures rows the
 * numbers have to stay honest against. A GM can paste it into any chat with
 * nothing installed.
 *
 * Everything in here is ENGLISH DATA, not copy. It is parse/format vocabulary
 * that `parseStrictMarkdown` depends on: a translated field name teaches the
 * model a field the parser has never heard of, and every reflavor then fails to
 * import at once. Only the dialog's own labels are localized. Same rule, and
 * the same reason, as `pf2e-recall/prompt.mjs`.
 *
 * Kept free of Foundry globals so `tools/reflavor-check.mjs` can import it.
 */

import { Benchmarks } from "../clocks-tracker/support/benchmarks.js";

/** Bumped when the rung rules or the output contract change meaning. */
export const REFLAVOR_GRAMMAR_VERSION = 1;

/* ------------------------------------------------------------------ rungs -- */

/**
 * The ladder, defined by WHAT MAY MOVE rather than by how creative to be.
 *
 * A model cannot calibrate "change it a moderate amount", but it can obey "do
 * not change any number". Each rung inherits everything the rung below it
 * permits, which is stated explicitly in the payload rather than implied.
 */
export const RUNGS = Object.freeze([
  {
    key: "reskin",
    order: 1,
    /** Rendered as the task line. */
    summary: "Reskin — new identity, identical mechanics.",
    permits: [
      "The creature's name on the `# ` line.",
      "Every `Description:` value, on the head and inside every `###` block.",
    ],
    freezes: [
      "Every number anywhere in the document.",
      "Every `Traits:` line. Traits are mechanical in PF2e — they drive weaknesses, resistances and automation — so they are not flavour and do not move at this rung.",
      "Every `###` block name, and the number and order of the blocks.",
      "Every other field value: `Type:`, `Bonus:`, `Damage:`, `Range:`, `Area:`, `Actions:`, `Category:`, `Quantity:`, `Duration:`, `Radius:`, and all `RuleElements:`.",
    ],
  },
  {
    key: "retheme",
    order: 2,
    summary: "Retheme — new identity and new surface mechanics, same maths.",
    permits: [
      "Everything the Reskin rung permits.",
      "Every `###` block name.",
      "Every `Traits:` line, provided the replacement traits are real PF2e traits.",
      "Damage types inside `Damage:` (`2d6 fire` may become `2d6 cold`).",
      "Condition names inside descriptions (`frightened` may become `clumsy`).",
    ],
    freezes: [
      "Every numeric value, without exception: dice counts and faces, bonuses, DCs, ranges, areas, action counts, quantities, level, HP, AC, saves, speeds, skills and ability modifiers.",
      "The number of `###` blocks in each section, and each block's `Type:` and `Actions:`.",
      "A damage-type swap keeps its dice exactly: `2d6 fire` to `2d6 cold`, never to `3d6 cold`.",
    ],
  },
  {
    key: "rebuild",
    order: 3,
    summary: "Rebuild — a new kit at the same power.",
    permits: [
      "Everything the Retheme rung permits.",
      "Replacing, adding or removing `###` blocks in `## Attacks`, `## Actions` and `## Effects`.",
      "Rewriting `RuleElements:` to match the new abilities.",
      "Changing which spells a `## Spellcasting` entry lists.",
    ],
    freezes: [
      "`Level:` does not change.",
      "Every statistic stays in the benchmark tier column it currently occupies. The rows are given below; match the tier, not the exact number.",
      "A `## Spellcasting` entry's `DC:` and `Attack:` do not change.",
      "The action economy stays comparable: the same number of `Type: reaction` blocks, and no more three-action abilities than the creature started with.",
    ],
  },
  {
    key: "retune",
    order: 4,
    summary: "Retune — the same concept rebuilt at a different level.",
    permits: [
      "Everything the Rebuild rung permits.",
      "`Level:` changes to the target level given below.",
      "Every number moves to the target level's row, staying in the tier column it currently occupies.",
      "`Damage:` dice move to the strike-damage row for the target level at the same tier.",
    ],
    freezes: [
      "The tier column each statistic sits in. A creature with a High AC and a Moderate Fortitude keeps that shape at the new level; it does not become uniformly High.",
      "The action economy stays comparable: the same number of `Type: reaction` blocks, and no more three-action abilities than the creature started with.",
      "A strike keeps its damage types. Moving to a new damage row changes the dice, not what the dice are made of.",
      "The creature stays the same kind of thing. This rung changes its level, not the concept above.",
    ],
  },
]);

const RUNG_BY_KEY = new Map(RUNGS.map((r) => [r.key, r]));

export const rungByKey = (key) => RUNG_BY_KEY.get(key) ?? null;

/** Rung 4 retunes against tables that exist only for creatures. */
export const HAZARD_MAX_RUNG = 3;

export function rungsFor(kind) {
  return kind === "hazard" ? RUNGS.filter((r) => r.order <= HAZARD_MAX_RUNG) : RUNGS.slice();
}

/* ---------------------------------------------------------------- grammar -- */

/**
 * The field grammar, one entry per section the exporter can emit.
 *
 * These field labels are the parser's, not ours. `tools/reflavor-check.mjs`
 * asserts every one of them still appears in `importer.js`, because a rename
 * there would leave this teaching the model a field that no longer parses —
 * which breaks every reflavor at once and reads, to the GM, as the model
 * getting worse.
 */
export const SECTION_GRAMMAR = Object.freeze({
  head: [
    "Level: <integer>",
    "Rarity: common | uncommon | rare | unique",
    "Size: tiny | sm | med | lg | huge | grg",
    "Traits: <comma-separated traits>",
    "Perception: +N; Senses: <sense> <range> feet, ...",
    "Languages: <comma-separated>",
    "Skills: <skill> +N, <skill> +N",
    "Abilities: STR +N, DEX +N, CON +N, INT +N, WIS +N, CHA +N",
    "AC: <integer>",
    "Fortitude: +N",
    "Reflex: +N",
    "Will: +N",
    "HP: <integer>",
    "Immunities: <type>, ...            (omit the line if none)",
    "Weaknesses: <type> <value>, ...    (omit the line if none)",
    "Resistances: <type> <value>, ...   (omit the line if none)",
    "Speed: <n> feet, <mode> <n> feet",
    "Description: <prose>",
  ],
  hazardHead: [
    "Type: hazard",
    "Complexity: simple | complex",
    "Stealth: +N; <details>",
    "Hardness: <integer>",
    "Disable: <prose>",
    "Routine: <prose>",
    "Reset: <prose>",
  ],
  attacks: [
    "### <name>",
    "Type: melee | ranged",
    "Bonus: +N",
    "Damage: <dice> <type> plus <dice> <type>",
    "Range: <n> feet                    (ranged only)",
    "Area: <n>-foot <shape>             (only if the strike has one)",
    "Traits: <comma-separated>",
    "Effects: <comma-separated>         (only if the strike has any)",
    "Description: <prose>",
  ],
  actions: [
    "### <name>",
    "Type: action | reaction | free | passive",
    "Actions: 1 | 2 | 3",
    "Category: offensive | defensive | interaction",
    "Traits: <comma-separated>",
    "Description: <prose>",
  ],
  phases: [
    "### <name>",
    "Trigger: <prose>",
    "Traits: <comma-separated>",
    "Description: <prose>",
  ],
  spellcasting: [
    "### <name>",
    "Tradition: arcane | divine | occult | primal",
    "Type: innate | prepared | spontaneous | focus",
    "Ability: cha | int | wis | str | dex | con",
    "DC: <integer>",
    "Attack: +N",
    "Description:",
    "- <rank>: <spell>, <spell>",
    "- Cantrips: <spell>, <spell>",
    "- At Will: <spell>",
  ],
  inventory: [
    "### <name>",
    "Type: weapon | armor | shield | consumable | equipment | backpack | treasure",
    "Level: <integer>",
    "Quantity: <integer>",
    "Traits: <comma-separated>",
    "Description: <prose>",
  ],
  effects: [
    "### <name>",
    "Traits: <comma-separated>",
    "Radius: <n> feet",
    "Duration: <n> <unit> | unlimited",
    "Description: <prose>",
  ],
  engine: [
    "Resource: <name>",
    "Tier: <tier>",
    "Allegiance: <allegiance>",
    "Charges: <integer>",
    "Ready: <mode>",
    "Threshold: <integer>",
    "Gain: <prose>",
    "Cash Out: <prose>",
    "Tell: <prose>",
    "Threat: <prose>",
    "Counterplay: <prose>",
  ],
  recallKnowledge: ["DC <n> (<skills>): <text>"],
});

/** `## Heading` in the exported markdown → key in SECTION_GRAMMAR. */
export const SECTION_HEADINGS = Object.freeze({
  attacks: "attacks",
  actions: "actions",
  phases: "phases",
  spellcasting: "spellcasting",
  inventory: "inventory",
  effects: "effects",
  engine: "engine",
  "recall knowledge": "recallKnowledge",
});

/** Titles as the exporter writes them, for the locked-section rules. */
const LOCKED_SECTIONS = ["## Engine", "## Phases", "## Recall Knowledge"];

/**
 * Which sections this stat block actually uses.
 *
 * Read off the exported text rather than off the actor, so the grammar we
 * teach can never describe a section the payload does not contain.
 */
export function sectionsUsed(markdown, { kind = "npc" } = {}) {
  const used = kind === "hazard" ? ["head", "hazardHead"] : ["head"];
  for (const line of String(markdown ?? "").split("\n")) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (!m) continue;
    const key = SECTION_HEADINGS[m[1].toLowerCase()];
    if (key && !used.includes(key)) used.push(key);
  }
  return used;
}

/* ------------------------------------------------------------- benchmarks -- */

/**
 * Which benchmark row each head statistic is read against. HP is deliberately
 * absent: the Building Creatures HP table is not embedded in this suite, and
 * inventing a row is worse than admitting the gap.
 */
const HEAD_BENCHMARKS = Object.freeze([
  { label: "AC", stat: "ac", read: (b) => b.ac },
  { label: "Fortitude", stat: "save", read: (b) => b.fortitude },
  { label: "Reflex", stat: "save", read: (b) => b.reflex },
  { label: "Will", stat: "save", read: (b) => b.will },
  { label: "Perception", stat: "perception", read: (b) => b.perception },
]);

/**
 * Where `value` sits among a row of tier thresholds.
 *
 * Reports "between" honestly rather than snapping to the nearest column. A
 * creature sitting between High and Extreme told it is simply "High" will be
 * anchored a whole tier low at rung 3, and the GM has no way to see that
 * happen. Saying so lets the model hold the real position — and lets it notice
 * when this classification disagrees with the number printed beside it.
 */
export function classifyTier(value, row) {
  // Number(null) is 0 and Number("") is 0, so an absent statistic would
  // otherwise classify as "below low" rather than being skipped — a creature
  // with no spell DC would be told its spell DC is dangerously weak.
  if (value == null || value === "" || !row) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const cols = Object.entries(row).sort((a, b) => b[1] - a[1]);
  const exact = cols.find(([, v]) => v === n);
  if (exact) return { tier: exact[0], exact: true, label: exact[0] };
  if (n > cols[0][1]) return { tier: cols[0][0], exact: false, label: `above ${cols[0][0]}` };
  const last = cols[cols.length - 1];
  if (n < last[1]) return { tier: last[0], exact: false, label: `below ${last[0]}` };
  for (let i = 0; i < cols.length - 1; i++) {
    if (n < cols[i][1] && n > cols[i + 1][1]) {
      return { tier: cols[i + 1][0], exact: false, label: `between ${cols[i + 1][0]} and ${cols[i][0]}` };
    }
  }
  return null;
}

const rowText = (row) =>
  Object.entries(row)
    .sort((a, b) => b[1] - a[1])
    .map(([tier, v]) => `${tier} ${v}`)
    .join(" · ");

/**
 * The benchmark block for rungs 3 and 4.
 *
 * Rows are RAW — never flattened — because they sit beside the stat block's own
 * stored numbers, which are un-flattened on disk even in a world running
 * `pf2e-flatten`. Flattening one column and not the other would make every
 * comparison wrong by the creature's level.
 */
export function benchmarkBlock(stats, level, targetLevel = null) {
  const out = [
    "## Benchmarks",
    "",
    "Building Creatures rows for the statistics this creature has. Numbers are",
    "**un-flattened** — they are directly comparable with the stat block above,",
    "including in a Proficiency-without-Level game, where the stat block's own",
    "numbers are stored un-flattened too. Do not subtract level from either.",
    "",
  ];

  const section = (lvl, heading) => {
    const lines = [heading, ""];
    for (const entry of HEAD_BENCHMARKS) {
      const value = entry.read(stats);
      if (value == null) continue;
      const row = Benchmarks.rawRow(entry.stat, lvl);
      if (!row) continue;
      const where = lvl === level ? classifyTier(value, row) : null;
      lines.push(
        `- **${entry.label}** — ${rowText(row)}` +
          (where ? `  → this creature's ${value} is **${where.label}**` : "")
      );
    }
    if (stats.strikeBonus != null) {
      const row = Benchmarks.rawRow("attack", lvl);
      const where = lvl === level ? classifyTier(stats.strikeBonus, row) : null;
      if (row) {
        lines.push(
          `- **Strike attack** — ${rowText(row)}` +
            (where ? `  → its best strike ${stats.strikeBonus >= 0 ? "+" : ""}${stats.strikeBonus} is **${where.label}**` : "")
        );
      }
    }
    const damage = Benchmarks.rawRow("damage", lvl);
    if (damage && stats.hasStrikes) {
      lines.push(`- **Strike damage** — ${Object.entries(damage).map(([t, v]) => `${t} ${v}`).join(" · ")}`);
    }
    if (stats.spellDC != null) {
      const row = Benchmarks.rawRow("dc", lvl);
      const where = lvl === level ? classifyTier(stats.spellDC, row) : null;
      if (row) {
        lines.push(
          `- **Spell DC** — ${rowText(row)}` +
            (where ? `  → its DC ${stats.spellDC} is **${where.label}**` : "")
        );
      }
    }
    return lines;
  };

  out.push(...section(level, `### Level ${level} (current)`));
  if (targetLevel != null && targetLevel !== level) {
    out.push("", ...section(targetLevel, `### Level ${targetLevel} (target)`));
  }
  out.push(
    "",
    "**HP has no row here.** The Building Creatures HP table is not carried by",
    "this module, so nothing above constrains it. Scale HP in proportion to the",
    "level change and say in your notes what you scaled it from and to."
  );
  return out.join("\n");
}

/**
 * Rung 3 leans on the benchmark rows to mean "same power, new kit". Hazards
 * have no rows here — the Building Creatures hazard tables are not embedded in
 * this suite — so they get an explicit floor instead of fabricated columns.
 * Naming the gap is the point: a silent omission would read as permission.
 */
const HAZARD_NO_BENCHMARKS = [
  "## Benchmarks",
  "",
  "**None available.** This is a hazard, and the Building Creatures hazard",
  "tables are not carried by this module. Nothing here tells you what a",
  "level-appropriate number looks like, so do not move one on a guess:",
  "",
  "- Keep every statistic at its current value: AC, Hardness, HP, all three",
  "  saves, Stealth, and every attack bonus and damage expression.",
  "- Change what the hazard *does*, not how hard it hits.",
].join("\n");

/* ----------------------------------------------------------------- payload -- */

const OUTPUT_CONTRACT = [
  "## How to reply",
  "",
  "Put the complete reflavoured stat block in **one** fenced code block tagged",
  "`markdown`, and nothing else inside that fence — no preamble, no commentary,",
  "no notes, not even a blank explanatory line.",
  "",
  "Write your summary of what you changed **outside** the fence, as ordinary",
  "prose, before or after it. Write as much of it as is useful.",
  "",
  "This split is not a style preference. The importer's parser reads any",
  "`Key: value` line it finds, whatever heading it sits under, so a single line",
  "of commentary inside the fence — `Level: raised to 8`, say — silently",
  "rewrites the creature. Keeping prose outside the fence is what makes the",
  "paste safe.",
  "",
  "Reproduce every line you are not changing **exactly as written**, including",
  "sections you were told not to touch. The importer builds the new creature",
  "from this text alone: a line you drop is a line the creature loses.",
].join("\n");

/**
 * Build the clipboard payload.
 *
 * @param {object} opts
 * @param {string} opts.markdown   the exported stat block, verbatim
 * @param {string} opts.name       the source creature's name
 * @param {string} opts.kind       "npc" | "hazard"
 * @param {number} opts.level      the source creature's level
 * @param {string} opts.rung       a RUNGS key
 * @param {string} opts.concept    the GM's free-text steer
 * @param {number|null} opts.targetLevel  rung 4 only
 * @param {object} opts.stats      head statistics, for the benchmark block
 */
export function buildReflavorPayload({
  markdown = "",
  name = "",
  kind = "npc",
  level = 1,
  rung = "reskin",
  concept = "",
  targetLevel = null,
  stats = {},
} = {}) {
  const spec = rungByKey(rung) ?? RUNGS[0];
  const used = sectionsUsed(markdown, { kind });
  const kindWord = kind === "hazard" ? "hazard" : "creature";
  const present = LOCKED_SECTIONS.filter((title) =>
    new RegExp(`^${title}\\s*$`, "m").test(markdown)
  );

  const out = [
    `# Task: reflavour a Pathfinder 2e ${kindWord}`,
    `<!-- glrf:${REFLAVOR_GRAMMAR_VERSION} -->`,
    "",
    `I am the GM of a Pathfinder 2e (Remaster) game. Below is **${name}**, exported`,
    "from my Foundry world in the format my importer reads. I want it reflavoured,",
    "and I will paste your reply straight back into that importer.",
    "",
    `## The rung: ${spec.summary}`,
    "",
    "**You may change:**",
    "",
    ...spec.permits.map((line) => `- ${line}`),
    "",
    "**You must not change:**",
    "",
    ...spec.freezes.map((line) => `- ${line}`),
  ];

  if (present.length) {
    const rule =
      spec.order <= 2
        ? "Reproduce these sections **verbatim**, character for character. They drive automation this reflavour is not touching."
        : spec.order === 3
          ? "You may rename things inside these sections to match the new concept, but do not change any of their mechanics, numbers or structure."
          : "You may retune these sections to the target level, keeping their structure.";
    out.push("", `**Special sections present: ${present.join(", ")}.** ${rule}`);
  }

  if (concept.trim()) {
    out.push(
      "",
      "## What I want it to become",
      "",
      "This is the most important instruction here. Prefer it over anything generic:",
      "",
      concept.trim()
    );
  }

  out.push(
    "",
    "## The format",
    "",
    "The stat block below is already in the target format, so follow its shape.",
    "These are the fields the importer accepts for the sections it uses. A field",
    "it does not list is one the importer will silently drop.",
    ""
  );
  for (const key of used) {
    const lines = SECTION_GRAMMAR[key];
    if (!lines?.length) continue;
    out.push("```", ...lines, "```", "");
  }

  if (spec.order >= 3) {
    out.push(
      kind === "hazard"
        ? HAZARD_NO_BENCHMARKS
        : benchmarkBlock(stats, level, spec.order >= 4 ? targetLevel : null),
      ""
    );
  }

  out.push(OUTPUT_CONTRACT, "", "---", "", "## The stat block", "", "```markdown", markdown.trimEnd(), "```");

  return out.join("\n");
}
