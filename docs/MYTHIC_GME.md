# Mythic GME

A GM's oracle for the Mythic Game Master Emulator 2nd Edition. It works in any
game system and is off by default. The GM opens it from the suite's scene
controls or from the quick palette (Ctrl+K, type "likely", "event", a table
name).

## What it does

- Ask: type a question (optional) and press one of the nine odds. Each odds
  button shows its chance of a Yes at the current Chaos Factor, and its exact
  bands on hover. Enter in the question box asks at the last odds used.
- Random Events: rolled automatically when a Fate roll triggers one (a Control
  Center setting), or on demand.
- Scene: test the expected scene, end a scene in or out of control (which
  moves the Chaos Factor), roll a Scene Adjustment.
- Meaning: Actions, Descriptions and every bundled elements table, searchable.
- Lists: Threads and Characters, up to 25 rows each, a row weighing up to 3.
  A Random Event about an NPC or a thread picks its row from here.
- The log keeps the last 50 rolls. Each can be whispered to the GMs or shown
  to the table as a chat card.

## The rules it pins

All of it lives in `rules.mjs` and `tools/mythic-gme-check.mjs` restates it
independently.

- Fate Chart. A cell is three numbers: Exceptional Yes at or under the first,
  Yes at or under the second, Exceptional No at or over the third. The chart is
  one diagonal: one step of odds is one step of Chaos Factor. The exceptional
  bands are a fifth of each side. 50/50 at Chaos 5 is 10 / 50 / 91.
- Random Event: doubles (11 to 99) whose digit is at or under the Chaos
  Factor. 100 is not doubles.
- Chaos Factor: 1 to 9, starting at 5. In control lowers it by one, out of
  control raises it by one.
- Expected scene: d10 at or under the Chaos Factor changes the scene. Odd
  alters it (a Scene Adjustment is rolled), even interrupts it (a Random
  Event is rolled).
- Scene Adjustment: d10, 7 and up means two adjustments, rolled again and
  rerolling 7 and up.
- Event Focus: d100 over the book's twelve bands.

## The meaning tables

`data/tables.mjs` is generated data and is not edited by hand. Its four
`MEANING` columns were filed one place off: `action1` is Actions Table 2,
`action2` is Descriptions Table 1, `descriptor1` is Descriptions Table 2 and
`descriptor2` is the Locations elements table. Actions Table 1 (the verbs) is
not in the file. Before the remake an Action roll paired a noun with an adverb
and a Description roll paired an adjective with a place.

`catalog.mjs` is the only reader of those columns and names them for what they
are. Locations joins the elements tables. Actions Table 1 is not bundled; a GM
who owns the book can drop a RollTable on the Meaning page to link it (a world
setting holding the table's UUID). Until then an Actions roll reads Table 2
alone and says so. The Objects elements table is not in the file either.

## Privacy

- Rolls are silent. No chat message, no dice, no socket. Nothing leaves the
  GM's client until the GM posts a card.
- A whisper goes to every GM except the stream login (a GM account the
  players watch) and always to the poster. "Show the table" posts publicly.
- The log, the lists and the panel's memory are client settings: world
  settings reach every client, and a list of threads and NPCs is the GM's
  prep. The Chaos Factor is a world setting and only a GM can change it.

## Files

`rules.mjs`, `catalog.mjs`, `oracle.mjs` (a roll as a log entry, and reading
old entries back), `lists.mjs`, `model.mjs` and `render.mjs` are pure and load
under Node. `store.mjs` is the only reader and writer of settings, and queues
its writes so two quick clicks are two steps. `session.mjs` rolls and logs,
`chat.mjs` posts, `app.mjs` is the window and `main.mjs` the wiring.

Log entries store dice and keys, never text, so they read in the GM's
language. Entries written before the remake were finished English strings and
are kept as `legacy` entries, drawn as they were.

## Checking it

```bash
node tools/mythic-gme-check.mjs
node tools/mythic-gme-preview.mjs && node tools/preview-server.mjs 8983
```

Then `/.preview/mythic.html` (`?only=ask|event|scene|meaning|linked|lists|empty|wild|chat`,
`&seek=200` to freeze the arrival). The skin is
`docs/adr/0009-mythic-gme-skin.md`.
