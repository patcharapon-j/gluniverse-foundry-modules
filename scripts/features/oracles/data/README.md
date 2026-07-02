# Oracles feature — pack data schema

This directory holds one subdirectory per **oracle pack**. Each pack's
`index.mjs` default-exports a pack object. Data files are plain ES modules —
no build step, loaded lazily via dynamic `import()` only when the pack is
enabled in the world.

Table **vocabulary is data, not UI** — entries stay raw English and are NOT
localized (see CLAUDE.md). Only panel chrome goes through `GLORACLE.*` keys.

## Pack object

```js
export default {
  id: "starforged",                 // pack id — permanent once shipped
  label: "Starforged (Sci-Fi)",     // display label (data, not localized)
  attribution: "Contains material from Ironsworn: Starforged by Shawn Tomkin, licensed under CC BY 4.0.",
  // OPTIONAL single context axis. Tables may carry per-context range columns.
  context: {
    key: "region",
    label: "Region",
    values: [
      { id: "terminus", label: "Terminus" },
      { id: "outlands", label: "Outlands" },
      { id: "expanse", label: "Expanse" },
    ],
    default: "terminus",
  },
  // Tier-1 slot bindings: slot id -> table id in THIS pack. All 8 slots are
  // mandatory for a genre pack (the core pack has none).
  // Slots: character, place, settlement, faction, creature, encounter,
  //        location-theme, complication
  slots: {
    character: "character-first-look",
    place: "planet-class",
    // ...
  },
  tables: [ /* Table objects, display order = declaration order */ ],
};
```

## Table object

```js
{
  id: "space-sighting",             // pack-local id, kebab-case, permanent
  name: "Space Sighting",           // display name (data, not localized)
  category: "Space Encounters",     // browser-tree group heading
  // EITHER `words` (uniform 1-result-per-roll table) ...
  words: ["Abandon", "Acquire", /* exactly N entries; roll = index+1 */],
  // ... OR `entries` (ranged rows; see below) ...
  entries: [ /* Entry objects */ ],
  // ... OR `compose` (virtual table: rolls each part, joins results).
  compose: ["core:action", "core:theme"],
}
```

The die size is implicit: `words.length`, or the highest range ceiling in
`entries`. Ranges must cover `1..max` contiguously with no gaps or overlaps.

## Entry object

```js
{
  range: [36, 40],                  // inclusive; use [7, 7] for a single value
  // OPTIONAL per-context columns (pack must declare `context`). When present
  // for a table, EVERY entry of that table must carry `ranges` for every
  // context value; `range` becomes the fallback (use the first context's).
  // An explicit `null` (or an omitted key, e.g. `expanse: null`) means the
  // row does not exist in that context (the source prints "--"); the other
  // columns must still cover 1..max contiguously on their own.
  ranges: { terminus: [36, 40], outlands: [36, 38], expanse: [36, 37] },
  text: "Settlement",               // display text — required unless rollTimes
  ref: "settlement-location",       // OPTIONAL: roll another table.
                                    //   unqualified = same pack;
                                    //   qualified   = "core:descriptor" / "<packId>:<tableId>"
  auto: false,                      // ref resolution: true = roll it inline
                                    // immediately; false/omitted = offer a
                                    // "roll →" button (GM drills manually).
                                    // RULE: auto when the ref completes this
                                    // single prompt; manual when it opens a
                                    // whole new generator.
  compose: ["core:descriptor", "core:focus"],  // OPTIONAL: roll several tables,
                                    // join with " · ". Always auto.
  rollTimes: 2,                     // OPTIONAL: reroll THIS table N more times
                                    // ("Roll twice"). Always auto; duplicate
                                    // rows are rerolled once, then kept.
}
```

## Authoring rules

- Every genre pack fills all 8 Tier-1 slots. Tier-2 extras are free-form.
- Keep entry text short and evocative (1–8 words), as printed in the source
  for ported packs; original wording for authored packs — never copy text
  from non-open game books, and never use trademarked setting names in ids,
  table names, or entry text.
- CC-BY sources (Ironsworn, Starforged, Delve) keep their exact wording and
  get an `attribution` string on the pack.
- `d100` is the norm; smaller dice are fine where the source/design wants
  them (die size is implicit from coverage).
- IDs are permanent. Choose them like API names.
