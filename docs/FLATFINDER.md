# Flatfinder

Flatfinder is a Proficiency without Level ruleset for PF2e. This feature does
the parts of it a table would otherwise do by hand: it names a skill check's
competence band, rates a fight against the PWoL XP table, applies Flatfinder's
incapacitation rule, and takes the level out of static DCs.

## What it draws

- **The competence badge**, on a skill check's chat card (and Perception, in
  the "all" mode). A ladder of eight bars, lit up to the band, and the band's
  name. Lore checks go up a band, a natural 20 up one and a natural 1 down one;
  each shift is a chip on the card, so a 19 reading Impressive says why. A card
  that just arrived climbs its ladder once; the log drawing old cards on load
  does not.
- **The threat strip**, at the top of the combat tracker, for the GM. The
  rating, the XP against that rating's budget, a meter with one equal segment
  per rating, the party it was rated for and how far the fight is from the
  next rating. Click it for what each creature is worth (Elite, Weak, boss,
  hazard, minion and "off the table" tags) and the XP award.
- **The encounter planner**, a window for building a fight before it is on the
  board. Drop creatures, hazards or a whole folder in from the Actors sidebar
  or a compendium, set counts and Elite/Weak, set the party by hand or let it
  follow the Party, or copy the tracker's fight. Open it from the strip, the
  quick palette (Ctrl+K) or `game.modules.get("gluniverse-foundry-modules").api.features.flatfinder.openPlanner()`.
  The plan is kept per GM client.

## The rules

All of them are pure functions in `rules.mjs`, held to PF2e's own numbers by
`tools/flatfinder-check.mjs`.

- **Creature XP** is the PWoL table (GMG), keyed by the creature's level minus
  the party's, clamped at ±7. A complex hazard counts as a creature; a simple
  hazard is a fifth of one, the same ratio as PF2e's standard tables.
- **Budgets** are 40/60/80/120/160 for four characters, ±10/15/20/30/40 per
  character more or fewer.
- **The rating** is the mildest budget that holds the XP: 70 XP for four is
  Moderate. The standalone module rounded the other way.
- **Elite and Weak** count as ±2 levels from the level the creature was built
  at. PF2e's own button moves the live level by 1 (by 2 at the edges), so the
  standalone module's "live level ± 1" read +3 for an Elite level 0.
- **Bosses** reach the budget through their XP factor (×2 Greater, ×3 Supreme)
  and never through their level bump, which is for incapacitation only. A
  boss's extra turns are real combatants carrying its own actor; each creature
  counts once (docs/BOSS_RULES.md).
- **The party** is the player characters in the encounter (minions, familiars
  and eidolons excluded), else the Party actor's, else an assumed level 1 party
  of four. The strip says which.
- **Incapacitation** replaces the core rule whenever the levels are known: a
  target that outlevels the source gains twice the difference, max +10, and
  PF2e's degree step goes either way. A spell is twice its rank; an NPC ability
  with no level of its own is its creature's Flatfinder level.

PWoL in these worlds is pf2e-flatten's `all`-selector modifier, not PF2e's
`variants.pwol` setting, which stays off. Nothing here reads that setting.
PF2e's own tracker metrics read the standard XP table for the same reason, so
the strip hides them while it is drawn.

## Files

`rules.mjs`, `encounter-model.mjs`, `view.mjs`, `planner-store.mjs` and
`constants.js` are pure: no `game`, no DOM. `encounter.js`, `competence.js`,
`adjustments.js`, `incapacitation.js` and `flatten.js` read the world;
`planner.mjs` is the window; `flatfinder.js` wires the hooks. The skin is
`styles/flatfinder.css` (docs/adr/0010-flatfinder-skin.md).

## Checks

```bash
node tools/flatfinder-check.mjs
node tools/flatfinder-preview.mjs && node tools/preview-server.mjs 8982
```

Then `/.preview/flatfinder.html` (`?view=chat|tracker|planner`, `fresh=1`
for the entrance motion). Recall Knowledge reads the band list, so run
`node tools/recall-check.mjs` too after touching `constants.js`.
