# 0013 · The PF2e HUD rail's skin

Status: proposed (2026-11-09). Builds on 0001 and 0012.

## Context

`pf2e-rail` ("PF2e HUD") is a bottom rail for playing a PF2e turn without the
sheet: the character on a plinth, vitals, strikes, a tabbed deck (Spells,
Actions, Skills, Items), a utility column, and the skill finder, the rail's
hero. On the GM's screen the rail shows the creature or hazard panel and a hand
of every non-PC token on the scene. It started from gluniverse-daggerheart's
bottom HUD and was deliberately not held to it: PF2e's turn is three actions
and a reaction, so the rail is laid out around the action economy.

It sits over the canvas on every player's screen and on the stream capture, so
it has to read over any map, dark or parchment, and never move the scene.

## Decision

- The skin is Ink and Signal (0012), aliased as `--gph-*` on the `.gph` root.
  Every rule sits under `.gph`, nothing is written on `:root`, no foundation
  token is redeclared, and every keyframe and registered property is prefixed
  `gph-` / `--gph-`.
- **Signals have one job each.** Amber is the Hero Points and nothing else.
  Red is danger: Hit Points under a quarter (`LOW_HEALTH_AT`, shared with the
  resource bars), dying, a broken shield, a hostile creature, and a critical
  failure in the odds bar. Green is a friendly creature, a critical success,
  and the extra action Quickened grants. Info blue is temporary Hit Points.
  Paper is whatever is active or selected: your turn, the actions you have
  left, the MAP step the next attack rolls at, the open tab, a stance you are
  in.
- **Proficiency ranks wear PF2e's own hues** (the system sheet's
  `--color-proficiency-*`): untrained slate, trained navy, expert purple,
  master bronze, legendary oxblood, lifted in OKLCH from the sheet's parchment
  darks so they read on ink, as `--gph-rank-0…4` on `.gph`. Purple breaks
  the No Violet Rule and bronze and oxblood sit near amber and red, so the
  exception is held narrow: the hues appear only as PF2e's rank badge (a
  filled letter, T/E/M/L, white on the hue) and as the 2px rule under a skill
  column's head. Numbers stay white, as on the sheet. The letter carries the
  rank; the hue makes it findable at a glance and matches what every PF2e
  player already reads on their sheet. They are identity, not signals, and
  nothing else may borrow them.
- **The halo is a readout, not a glow.** The No Glow Rule refuses light as
  decoration. The plinth's amber light behind the figure is the Hero Point
  pool drawn as light: its strength is linear in the points held, zero points
  is no light at all, and it goes out while the character is dying. It is the
  only light on the rail, and nothing else may borrow it.
- **The rail is 112px and never taller**: four rows of 24px presses in every
  plate (strikes, actions with their toggles), which is what a PF2e character
  reaches for in a turn. It was 96px (three rows) and was raised once, on
  purpose, for that fourth row. Every plate stands on the same four rows
  (24px, 2px apart, 5px in from the top and the foot), so a baseline runs
  straight across the rail; a plate with fewer rows starts at the top one.
  Only objects rise above it: the figure on the
  plinth, the held spell cards, the turn bar (a 26px tab on the strikes
  plate), and panels a press opens (the finder, a drawer, a peek).
- **The skill finder is grouped by skill, and compact.** One column per skill
  the character has an action in, best modifier first; the column head is the
  plain skill check, so the modifier is printed once; each action is one
  24px line (picture, name, cost, the chance on the right). A trained-only
  action under an untrained skill is not drawn. A column shows six (pins
  first) and the untrained column starts folded; typing opens everything.
  The chance is the only coloured text in it: green at 70% or better, red at
  30% or worse, plain between (a range is green only when all of it clears
  70%, red only when all of it is under 30%), ?? where the party has not
  learned the DC. The foot says the selected action in words (its roll,
  the defence and DC or "not yet learned", the chance, a secret roll), so
  the keyboard gets what the pointer gets from a tooltip. A pin is its own
  mark, a pin beside the chance, never a round pip by the cost.
- **Action pictures are game-icons.net silhouettes** (CC BY 3.0), filled with
  `currentColor` so they take the rail's ink and paper, generated into
  `action-icons.mjs` by `tools/gen-pf2e-rail-icons.mjs` and credited in
  `assets/pf2e-rail/CREDITS.md`. PF2e ships no picture per skill action.
- **A strike prints what the weapon is**, PF2e's base item ("Greatsword"),
  or a blast's element and range ("Water 30 ft"); the runed name is the
  title and the peek. Cut from its end, a runed name loses exactly the word
  that tells two rows apart.
- **The GM's hand holds ten.** Past that the last card is a count that opens
  the whole list; the selected creature always keeps its card, sits on top,
  and the cards after it step aside so no pennant or name start is covered.
  A duplicate's number is glued to its last word, and a crowded hand sets
  names small and three lines deep so each card's name shows whole.
- **Action costs are PF2e's diamonds and nothing else is.** One, two and three
  actions are filled diamonds, the reaction PF2e's arrow, the free action a
  hollow diamond, and the turn bar's pips are the same mark. Every other count
  on the rail (spell slots, frequency, dying beads) is a round pip, so a cost
  is never read as a count. Hero Points are amber diamonds because the system
  prints them that way.
- **Motion is from the shared tokens and plays for everyone** (no
  `prefers-reduced-motion`, per CLAUDE.md). The authored moment is the turn
  ignition: when the turn comes round, the bar's edge sweeps paper and the
  diamonds light in turn. Around it: a diamond drains when an action is spent,
  the next-MAP marker slides under the strike presses, a lost length of Hit
  Points stays lit red and drains after the fill, a heal sweeps up from green,
  the deck's tab marker travels, a cast card leaves the hand upward, a roll
  echoes its total on the press that made it, and the dying beads beat. The
  finder rises with its columns arriving in turn and each rank rule drawing
  in; its selection slides between actions rather than jumping; a fresh pin
  pops. The numeral and chip-trail tweens read `--gl-d-*` from the element, so the motion
  tier reaches them too.

### The narrow order

The grilling agreed an order for narrow screens: the drawers fold to one tile,
then the actions plate folds, then the hand tightens; the plinth, the vitals
and the strikes never collapse. The tabbed deck replaced the drawers and the
separate actions plate, so the order is restated for the rail as built:

1. Under 1260px of rail, the deck's tabs drop their labels to icons.
2. Under 1080px, the plinth narrows to 128px and the strikes plate to 250px
   (the strike's icon goes; its name and every number stay), the deck's rows,
   keys and tiles fit whole columns only, and the spell hand closes into a
   pile behind its dial.

The vitals never narrow, because their four checks are the numbers a GM calls
for without warning. A plate never shows a column cut by its edge: the deck's
grids place as many whole columns as fit and leave the rest under the expand
press.

## Consequences

- The rail reads the same over any map and on the stream, since every surface
  is an ink plate with its own hairlines.
- A new signal use (say, a colour for persistent damage) is a change to this
  record, not a local choice.
- The halo exception is narrow on purpose: if a second light appears on the
  rail, the exception no longer holds and the No Glow Rule applies to both.
- Phase 2 (the Foundry wiring) adds `tools/pf2e-rail-check.mjs`, which pins the
  scoping, the signal uses and the narrow order recorded here.
