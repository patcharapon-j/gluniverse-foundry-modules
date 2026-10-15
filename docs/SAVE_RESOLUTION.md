# Save Resolution (`pf2e-saves`)

Status: **built, not yet run in a live session.** Passes
`tools/pf2e-saves-check.mjs`. Designed in the PF2e Odds grilling session
(`docs/PF2E_ODDS.md`, Q1–Q36); this file records what was built and where it
departs from that design.

One flow for every save spell: who is in the area (or targeted), each
creature's save, the damage rolled once and applied per creature at its
degree's multiplier through PF2e's own IWR, the spell's conditions by degree,
and a Revert for every Apply.

## Shape

| file | role |
| --- | --- |
| `constants.mjs` | ids, keys, the basic and plain multiplier tables |
| `model.mjs` | **pure**: the session, its normaliser, membership, matching, the apply preview, effect parsing, apply/revert planning, who sees what |
| `render.mjs` | **pure**: one renderer for both hosts (panel and chat card) |
| `main.mjs` | the Foundry half: the conductor, rolling, apply/revert, the card, the socket |
| `panel.mjs` | the ApplicationV2 window, built in a memoised factory |

## The session

- **Where it lives.** A session is a chat card (the "session card") carrying
  the flag `sv.session`. The card is the anchor, the audit trail, and a compact
  host for the rows.
- **One writer.** The active GM's client (the "conductor") writes it, one write
  at a time through `mutate()`, which re-reads the flag before each write.
- **It carries no results.** A row holds the **id of the message** with its
  save (`rollId`), never a degree, a total, a natural or a multiplier.
  - Every viewer reads the result off that message through the gate PF2e's
    card uses, `landingOf()` from `pf2e-odds/landing.mjs`.
  - That gate includes PF2e's metagame "show results" setting, the
    breakdown/natural setting, whispers, and the stream login's rule (public
    rolls only).
  - The author of a save also reads their own card in full.
- **The undo record** is message and item ids plus earlier condition values.
  All of that is already visible on the creature.
- **Normalising.** `normalizeSession` is the only reader, so a result field
  written by mistake is dropped on the way back out.
- **A creature players cannot name** (PF2e `playersCanSeeName === false`, or a
  hidden token) is stored with no name and no art. The GM's view reads the
  live token.
- **Hidden tokens** are rows marked `hidden`. They are drawn for the truth
  only, which is not a secrecy boundary: token documents reach every client
  anyway.

## Opening a session

- **The button.** "Resolve saves" sits beside PF2e's own save button on a spell
  card. It is shown to the GM and to the caster's owner.
- **Who opens it.** The GM's click opens the session directly. The caster's
  owner sends `{castId, targets}` over the socket to the active GM, who checks
  the **attested** sender: it must be a GM or own the caster.
- **Who is in it.**
  - **The area comes first:** the cast's own Regions (`flags.pf2e.messageId`)
    run through `pf2e-aoe`'s `pf2eCoverage()`, imported directly.
    - A token is in the area if any occupied cell
      (`getOccupiedGridSpaceOffsets`) is covered.
    - A token is **Blocked** if none of its cells is covered but one is cut
      off from the origin. Blocked creatures are listed greyed, with one-click
      add.
    - On a non-square grid, coverage falls back to Foundry's own covered
      offsets.
  - **With no area**, the session uses the requester's current targets.
  - **The GM can edit the list:** add their targets, or remove any row that
    has not been applied.
- **Catch-up.** A save or damage roll already in chat for the cast (from
  PF2e's own buttons) is filed against the new session.

## Rolling

- **Through PF2e itself.** Each row's save is rolled with
  `actor.saves[slug].check.roll({dc, item: spell, origin: caster, identifier})`.
  - The spell at cast rank comes from the cast card's `item`, so
    incapacitation and spell roll options apply.
  - A player gets PF2e's own dialog, as their settings say.
- **Departure from the design.** The design said rolls would go through
  Spotlight's `rollSlot`. They don't: `rollSlot` holds the card and passes no
  item or origin.
- **Rolls are matched, not routed.** The conductor watches `createChatMessage`
  and files a saving throw to a row by our identifier
  (`gluniverse-saves:<session>:<row>`), or by the spell's origin uuid plus the
  token. That means **PF2e's own save button on the spell card resolves a row
  too.**
  - Two rows of one actor are never guessed between.
  - Another session's identifier is never filed.
  - A player can only file a save for a creature they own.
- **The GM** has "Roll all NPCs", which skips the dialog and uses the GM's
  current message mode.
- **A hero-point reroll** deletes the old card and creates a new one. The
  deletion unfiles the row and the new card refiles it.

## Damage and Apply

- **Rolled once, from the spell.** "Roll damage" calls
  `spell.rollDamage(click)`. Any damage roll from that spell is filed against
  the session, until something has been applied. After that, a new roll never
  replaces the one the applied rows used.
- **Apply mirrors PF2e's `applyDamageFromMessage`:**
  - `DamageRoll#alter(mult, 0)` for the multiplier, as PF2e's half and double
    buttons use it;
  - origin and target roll options;
  - the contextual clone;
  - `applyDamage({skipIWR: false, …})`.

  It is deliberately not `pf2e-variant-rules`' `applyFlatDamage`, which skips
  IWR.
- **Multipliers.**
  - A basic save is ×2 / ×1 / ×½ / ×0.
  - A non-basic save defaults to ×1 / ×1 / ×0 / ×0.
  - The GM can change the default per degree (remembered) or per row. The
    per-row override lives in the panel's memory only: a stored multiplier
    would name the degree.
- **The preview** ("Takes 9 · resist fire 5") is PF2e's IWR order restated
  over each IWR's own `test()`: immunity zeroes, then the highest weakness
  adds, then the highest resistance subtracts, never below 0. It is only a
  preview; the HP change that counts is PF2e's.
- **Effects by degree.**
  - **Parsing.** They are parsed from the spell's raw description: condition
    and effect `@UUID` links between a degree's `<strong>` label and the next
    label or `<hr>`, so a Heightened link is never read as an outcome.
  - **Editing.** The GM confirms or edits them in the drawer, and the answer is
    remembered as `sv.config` on the spell.
  - **Conditions never stack.** A higher value raises the existing one, with
    the old value recorded. A lower value does nothing. A missing condition is
    created, with its id recorded.
  - **Spell effects** are created once each, with an origin context.

## Revert

- **What it undoes.**
  - The damage, through PF2e's `undoDamage` on the damage-taken card, which is
    then marked `isReverted`. A card already reverted with PF2e's own button
    is skipped.
  - Items the Apply created are deleted, and raised values are put back.
  - Anything already gone stays gone.
- **Where it is.** Revert is per row and for all rows, in the panel and on the
  card.
- **How long it lasts.** It stays live until the encounter it was applied in is
  deleted, or for 10 minutes outside an encounter.

## Visibility

- **The panel** opens by itself for the GM who opened the session and for the
  caster's player.
- **Everyone else** sees the card. Players roll their own creatures from it.
- **GM controls** (Apply, the multiplier, the preview, the effects drawer, list
  edits) appear only for a GM who sees the truth.
- **The stream login** holds GM rights and gets the player's view.

## Still to prove in a live session

- `DamageRoll#alter` on a real spell roll, and the damage-taken card being
  found by actor uuid right after `applyDamage`;
- that `flags.pf2e.origin.uuid` on a save rolled from PF2e's own spell-card
  button is the cast-rank spell's uuid, and that `modifierName` is the save
  slug;
- `getOccupiedGridSpaceOffsets` matching `pf2eCoverage` offsets on a real
  scene, including Large creatures and emanations;
- `spell.rollDamage(new MouseEvent("click"))` from the panel;
- the session card re-rendering through `ui.chat.updateMessage` when a save
  lands.

## Check and preview

```bash
node tools/pf2e-saves-check.mjs
node tools/pf2e-saves-preview.mjs && node tools/preview-server.mjs   # /.preview/saves.html
```
