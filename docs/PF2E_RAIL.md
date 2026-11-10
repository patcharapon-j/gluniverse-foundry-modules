# PF2e HUD (`pf2e-rail`) — the wiring

Status: **built and run in a live v14 / PF2e 8.7 session** (a scratch data
folder, GM and one player). The design — view, drive, skin, fixtures, preview —
is settled and recorded in `docs/adr/0013-pf2e-rail-skin.md`; this file is the
seam between that pure rail and Foundry.

| | |
|---|---|
| Feature | `pf2e-rail`, prefix `ph.`, i18n `GLRAIL.*`, PF2e only, off by default |
| Check | `node tools/pf2e-rail-check.mjs` (zero problems) |
| Preview | `node tools/pf2e-rail-preview.mjs && node tools/preview-server.mjs` |

## Who gets which rail

`subject.mjs` decides, from what the screen has in hand:

- a **player character** (controlled, else the user's own character) → the
  full rail; a **familiar or a player-owned NPC** → the slim rail;
- on the GM's screen, a controlled **NPC or hazard** → the creature or hazard
  panel, plus a hand of every non-PC token on the scene, hostile first; nothing
  controlled → the hand alone (the empty plate is drawn only when the scene has
  no creatures at all). A GM controlling a PC gets that PC's player rail.
- `ph.gmRail` off hides the GM rail on that screen.

It never mounts on the **stream login** (`isConfiguredStreamUser`, read through
the stream feature's setting, which exists whether or not that feature is on),
and never beside **pf2e-hud** — the GM is warned once a session.

## Readers (`read.mjs`, pure)

An actor in, the fixture shape out (`tools/pf2e-rail-fixtures.mjs` is the
contract; the check holds every reader to it path for path).

- **Strikes** are `actor.system.actions` (id = index). Each variant's modifier
  is read off PF2e's own label, damage formulas come from
  `damage({ getFormula: true })` (the host caches them per actor until the actor
  or an item on it changes).
- **Blasts** are `new game.pf2e.ElementalBlast(actor).configs`. An actor with no
  `flags.pf2e.kineticist.elementalBlast` gets PF2e's fallback config, whose MAP
  labels are empty: the steps are then the blast statistic's own modifier at
  0/−5/−10.
- **Spells** come from `entry.getSheetData()` for each regular entry, addressed
  `<entry>.<spell>.<rank>.<slot>`; an empty prepared slot is a socket.
- **Items** are physical items with the `consumable` trait and a quantity —
  PF2e files Chalk and Rations as consumables too; the trait is what separates
  a potion from them. They are held as a hand of the same compact card as the
  spells (80 × 112, the Daggerheart card's 1 : 1.4), what is left on the
  pennant where a spell carries its rank, laid nearly flat.
- **Down and observing** are states of the whole rail. A dying or dead
  character's rail carries `data-down`: the strikes and deck dim behind the
  dying plate, and the gems, checks and drawers stay lit. A rail the user
  does not own is `data-readonly`: the host ignores every press but opening
  or closing a drawer and the fold, so every other press stops answering
  the pointer (a spell still peeks on hover) and the nameplate says
  Observing.
- **Reload** is PF2e Ranged Combat's, drawn only while that module runs: a
  weapon whose `system.reload.value` is 1 or more gets a Reload press beside
  its name, lit while it is empty. Loaded is the module's Loaded effect aimed
  at the weapon (`flags["pf2e-ranged-combat"].targetId`), or, under PF2e's own
  ammunition, a round among the weapon's sub-items.
- **Spell cards** are put down (`spent`) only when the card was its own
  resource: a prepared slot cast, or an innate spell out of uses. Cantrips,
  focus spells and a spontaneous or flexible caster's spells stay in the hand;
  PF2e marks a whole spontaneous rank `expended` when its slots run out, and
  that is the rank's count on the pennant, not the cards.
- **Foes**: disposition is read off `token.document`, never the placeable.
- **Hazard Disable** text runs through `inlineText`, so
  `@Check[thievery|dc:18]` reads "Thievery DC 18" instead of printing raw.
- **The target** is the target *as the party knows it*: `knownStat` from
  PF2e Odds' ledger, as a range, unless `seesTruth()` or the target is an ally.

`readPlayer` does not put the skill suggestions on the deck: the host adds
them in `compose()` (`withSkills`), because they follow the MAP step, and the
MAP step is a **driven** value. In the reader it would turn every attack into a
shape change and a re-render.

## The host (`host.mjs`)

Renders on a shape change (`shape.mjs` `shapeOf`), drives on a value change
(`liveOf` → `drive.mjs`). Every hook schedules one refresh per frame, with a
`TIMING.refreshFallback` timer beside the `requestAnimationFrame`: a background
tab starves frames, and without the timer the rail never draws there.

It mounts `#gph-host` at `--gl-z-hud` in the bottom-left corner, running to
the right edge of `#ui-middle`. While a rail is drawn it hides `#hotbar`
(`ph.hideHotbar`; the Macros drawer shows the user's hotbar) and Foundry's
player list `#players` (`ph.hidePlayers`; a kept list keeps the corner and
the rail starts beside it), gives both back when it is not, and publishes the rail's top edge as
`--gph-rail-top` on `body`. `/` opens the finder from the canvas only (never
while somebody types).

**Putting things away.** Escape closes a peek or a drawer and is *eaten* when
it does: left to Foundry the same key also releases the controlled token, and
on the GM's screen the rail with it. A press anywhere off the rail closes a
drawer or a peek too. The finder is the exception and stays open through it,
because targeting a token on the canvas is part of using it.

**Tooltips.** The view states what a press is in `title` (it is pure, and the
preview has nothing else). On Foundry the host moves every `title` to
`data-tooltip-text` as markup lands (one MutationObserver on `#gph-host`), so
they open as Foundry's own tooltips, above the press, in half the time.
Always `-text`, never `data-tooltip`: that one is rendered as HTML, and item
and macro names are whatever a player typed. A redraw puts away a tooltip
standing on a node it is about to replace.

**Cards stand for tokens.** Resting on a card in the GM's hand or on a party
seat lights that token on the canvas, the way the combat tracker's rows do
(`_onHoverIn`, only for a token the viewer can see); picking a creature the
screen is not showing pans to it. A redraw and an unmount let a lit token go,
since the card that lit it never hears the pointer leave.

**The wheel** over the spell dial or the hand turns the rank, one step a
gesture (`TIMING.wheelStep`). Nowhere else on the rail does it mean anything.

Stored: the portrait frame in the actor flag `ph.frame`; the finder's pins in
the user flag `ph.pins` (`{ [actorId]: slug[] }`); `ph.folded`, `ph.gmRail`,
`ph.hideHotbar` and `ph.hidePlayers` are client settings. **The action economy is stored nowhere**:
`turn.mjs` keeps a tally per actor on this screen, refilled when the combat's
`id:round:turn` key names a new turn of that actor, spent only in a started
encounter. It is a reminder, never a rule.

## What every press calls

No press opens a dialog of the HUD's own. Where PF2e shows its
`CheckModifiersDialog`, that is PF2e following the user's own setting.

| Press | PF2e call |
|---|---|
| Perception / save / skill | `actor.perception.roll` / `actor.saves[k].roll` / `actor.skills[slug].roll` |
| Strike step | `strike.variants[i].roll({ event })`; MAP then steps |
| Damage / crit | `strike.damage({ event })` / `strike.critical({ event })` |
| Blast step / damage | `ElementalBlast#attack({ element, damageType, melee, mapIncreases })` / `#damage` |
| Skill action (finder, deck) | `game.pf2e.actions.get(slug).use({ actors, statistic, multipleAttackPenalty, event })`, else PF2e's legacy function of that name; Earn Income → `game.pf2e.actions.earnIncome(actor)` |
| Spell card | `entry.cast(spell, { rank, slotId })` |
| Action / feat (peek Use) | `game.pf2e.rollItemMacro(uuid, event)` — PF2e spends the frequency and applies the self-effect |
| Post (peek) | `item.toMessage` / `spell.toMessage` |
| Toggle / stance | `actor.toggleRollOption(domain, option, itemId, value)` |
| Raise | `game.pf2e.actions.raiseAShield({ actors, event })` |
| Reload (PF2e Ranged Combat) | `game.pf2eRangedCombat.reload()` — the module picks the weapon (it asks only when several could be loaded) and the actor (an open sheet, else the controlled token, else the user's character); the actions are spent on its `pf2eRangedCombatReload` hook |
| Item | `item.consume()`; resting on the card peeks (text, what is left, Use and Post), as a spell does |
| Hit Points (the numeral) | a field in the numeral's place: `−12` / `+5` → `actor.modifyTokenAttribute("attributes.hp", ±n, true)`, which is PF2e's `applyDamage` (temporary Hit Points first, dying after), as the token HUD's own field does; a bare number → `actor.update` clamped to 0…max. Owners only; the GM's creature panel has it too |
| Rest | `game.pf2e.actions.restForTheNight` |
| Macro | `macro.execute()`; the drawer's foot steps Foundry's own hotbar pages (`ui.hotbar.cyclePage`) |
| Hero point | `actor.update({ "system.resources.heroPoints.value" })` |
| Exploration activity | `actor.update({ "system.exploration": [id] })` (one at a time) |
| Seat | GM: control that PC's token; player: open the sheet they can observe |
| Foe | control that token |

`presses.mjs` lists every `data-*` handle and `data-act` the view draws; the
check refuses one without a handler, and every finder slug PF2e's bundle does
not define.

## The light (`light.mjs`)

The rail's one moment that is not feedback. One WebGL2 canvas is prepended
to the `.gph` root after every render (the node and its context survive a
render) and stacked under `.gph-rail` (`z-index` 1 over 0): the plates are
opaque, so the light shows only on and above their edges, and the figure and
the held cards stay in front of it without a mask.

- **"in"** plays when your turn comes round (beside `D.ignite`) and when you
  get up from dying: a paper spark leaves the portrait, runs every plate's
  top edge left to right (fast, slowing at the far end), and lit smoke and
  sparks rise behind it.
- **"out"** plays when you go down (`relight(was, now)`; dying to dead plays
  nothing): the same pass in red, heavier with smoke, and the strikes and the
  deck dim (`is-going-down`) the moment it reaches them.
- **"home"** plays when your turn ends (going down outranks it): dimmer
  (`HOME_GAIN`) and quicker (`HOME_PACE`), it runs right to left, speeding
  up, and gathers behind the figure on the plinth.
- **On the GM's screen** a creature's turn plays "in" in its disposition's
  colour (`LIGHT_TONE`: red hostile, green friendly, steel neutral), and its
  card in the hand rises (`is-called`) and stays standing while the turn is
  its. The GM's turn key is read every refresh; the first read plays nothing.
- Each plate's edge flashes as the spark arrives: the host writes
  `--gph-lit-d` per plate from the inverse of the shader's own easing, so
  the CSS and the shader agree.
- The plate edges are measured at the start of a pass and handed to the
  shader as spans; every edge lights what stands above it and falls off past
  its ends, and the brightest wins, so no wall appears where two plates meet.
- Shed first (`SHED_ORDER = ["light"]`), registered with `Surfaces`,
  compiled in idle time after the first attach, motion claimed only while it
  plays, length `--gl-d-cinematic × 1.6` through the motion tier. Never on a
  folded rail or a hidden tab.

`pf2e-rail-check` pins the uniforms (every declared one written and looked
up), the stacking, the shed, the transition table and the purity. It cannot
compile GLSL: serve the preview and look (`&light=in|out&lt=0..1` holds a
frame).

## The moments (`moments.mjs`)

Everything the rail plays once is decided in one place: `momentsOf(was, now,
{ fresh })` compares the rail that was drawn with the one about to be (same
subject only; a change of rail plays nothing), and `playMoments` plays the
answer. `fresh` is the host's "a turn just started" (`Turn#sync` for a
player, a changed turn key for the GM). The preview calls the same two.

| Change | Moment |
|---|---|
| Your turn starts | the ignition and the light "in" |
| Your turn ends | the light goes home |
| You go down / get up | the light "out" / "in" |
| You become next (`upNext`, `turnbar.next`) | the bar knocks twice and its label pops |
| A Hero Point is spent | the gem cracks; with a roll echoed in the last `TIMING.rerollWindow`, its light streaks to that press and lands amber |
| A dying bead is lit / put out | it burns and the rail's edges flicker red / it exhales |
| A creature's turn (GM) | the light in its disposition, its card rises |

**On deck** is a state, not a moment: while the turn after the current one
is yours (`upNext` over `combat.turns`, skipping the defeated where core's
`skipDefeated` does), the turn bar's label reads "You're next" in an
outlined paper slab, the diamonds you are about to have are drawn in paper and
its top edge breathes. Whose turn it is now rides the title and the screen
reader. The canvas light never plays for it. An observer's rail is somebody
else's character, so the bar names them ("Valeros is next", "Valeros's turn",
`turnbar.observer`) and never says "you".

**A Hero Point's reroll** is PF2e's `rerollFromMessage`: it lowers the
points first, deletes the old message and posts a new one whose check context
carries `isReroll`. The host keeps the press the last roll echoed on
(`lastEcho`), so the spend streaks there and the reroll echoes there, both
within `TIMING.rerollWindow`.

**The dying beads** follow the dying value, whatever moved it: a recovery
check, a hit while dying (which burns, as it should), healing. Death plays no
bead; stabilising is the light coming back.

## The MAP steps

The strike row's three MAP steps are three equal presses, and none is lit,
sized or marked by the step you are on: the turn bar prints the MAP, and the
row keeps still while attacks land, so every bonus reads at a glance. (A
live step that grew, faded and slid was tried and taken out: too much moved
to judge a number by.)

## The echo (`echo.mjs`)

A roll's total (and its degree, where PF2e would show it: `seesTruth()` or the
metagame "results" setting) prints on the press that made it, when the message
arrives within twelve seconds from the same user for the same actor. Never on the stream
login, never for a blind roll (PF2e's secret trait — even on the GM's screen,
where the card already has it), never for a whisper this viewer is not in.
