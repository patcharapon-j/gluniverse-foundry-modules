# Boss Creatures

The *Adventures+* Boss Creatures rules (pp. 48–55), as a promoted sub-feature of
**PF2e Variant Rules**. Toggle: Control Center → PF2e Variant Rules → Boss
Creatures. Off by default, like every rule in that group.

A boss is an ordinary PF2e NPC with a profile flag on it. Nothing about the
creature is destroyed by marking it: the base level and base Hit Points are
captured before anything is scaled, and unmarking restores exactly those figures
rather than dividing the inflated ones back out.

---

## What marking does

| | Greater | Supreme |
|---|---|---|
| Hit Points | ×1.5 | ×2 |
| Creature level | +2 | +4 |
| XP value | ×2 | ×3 |
| Turns per round | 2 | 3 |

Plus, on both: a **Boss DC** (a very hard DC of the *base* creature's level), a
**boss modifier** (Boss DC − 10), and the two actions every boss has — Telegraph
and Shrug It Off — created as real PF2e ability items.

Everything else about the creature is left alone, which is the book's own
position: "Boss's typically have the same defenses as the base creature."

## Building one

The panel has its own tab on the NPC sheet, after Notes, and is GM-only. Pick a
tier, then add up to three Boss Abilities from the catalogue and one Downfall per
ability.

The tab is this feature's own, not one of PF2e's: AppV1 binds a sheet's tab
handler before the render hook fires, so a link injected from a module is
invisible to it. The page is therefore activated by hand, and Foundry's own tab
state is deliberately never told this tab's name, since it has to keep naming a
real tab for the next render to restore anything. The simple NPC sheet has no
tab strip at all, and there the panel is still appended inline.

Each ability becomes a real `action` item on the actor with its PF2e action cost,
its traits, and a description whose numbers are computed for *this* boss — the
Boss DC, the damage dice, the resistance, the appendage count. Removing the
ability deletes the item.

Downfalls are items too, one passive each, named for their trigger and carrying
the GM's own note. That is what puts them on the main tab beside the creature's
other passives, and it is also how they reach **Recall Knowledge**: the book's
rule for discovering a boss's Downfalls is a Recall Knowledge check, and that
feature reads a creature's ability items, so as items they arrive there without a
second integration. The brief additionally carries a `Boss` line — the tier, the
level it counts as, and how many turns a round it takes — which is the most
useful thing a party can learn about one and is invisible in a statblock.

Downfalls are the party's lever. Each has a trigger type (the book's seven, plus
the "critical hit or failed save" one every boss carries) and a free-text note
saying what actually sets it off at your table. The panel reports when the counts
do not balance rather than refusing to save a half-built boss.

## During a fight

The panel grows a live section while the boss is in an encounter: one button per
Downfall, the current defence penalty, and the telegraph control.

Triggering a Downfall applies a −1 penalty to AC and all three saves, climbing to
−3 as *separate* Downfalls land, and disrupts whatever the boss had telegraphed.
It posts a public chat card, because a Downfall the party cannot see is a lever
with no feedback on it. The penalty clears at the beginning of the boss's next
initial turn and by nothing else — a boss cannot Shrug It Off.

Telegraphing also posts publicly. "As long as creatures can sense the target of a
Telegraph, they know the target of a Telegraphed Boss Ability", and a telegraph
nobody was told about is just the boss taking a free turn.

## Initiative

Which mechanism runs depends on the rail's mode, and they are mutually exclusive.

**Card mode** already models a multi-turn actor: the per-actor `init.cardConfig`
flag carries a `turns` count and the deal gives that actor that many slots.
Marking a boss writes the count and stops there.

**Standard mode** has no such thing — nothing in the suite wraps
`Combat#setupTurns`, subclasses `Combatant`, or mutates `combat.turns`. So a boss
gets N−1 extra real Combatant documents pointing at the same actor and token,
each flagged as its Nth turn. Foundry sorts and walks them like any other entry,
and every other module that reads the tracker sees an ordinary turn order.
Nothing is patched.

The extra turns are placed by the book's rotation — a Greater boss's second turn
after 2 party members have acted, a Supreme boss's after 1 and 3 — re-derived for
the real party size, because those numbers are stated for a party of four and
taken literally would put two boss turns back to back at a table of five.

On the rail a boss is a different size and a different material, not just a
different colour.

**Size, because size is the only cue that survives a glance.** A boss card is
taller and reaches further across the rail than the creatures around it, and a
Supreme boss further than a Greater. That is a description rather than an
emphasis: this card owns two or three of the round's slots, so it occupying more
of the round's rail is the truth about it. Its extra turns are deliberately
smaller than its own initial turn and still larger than an ordinary card, because
the initial turn is the one that clears Downfalls.

**Shape.** The silhouette is cut at two opposite corners, deeper for Supreme; the
frame is doubled, a rim and a second faint rule inside a dark gutter; it is
struck as corner brackets at the two corners the cut does not touch; and the
bottom edge is a measured rule rather than a plain line. All of it is
recognisable with the colour taken away.

**Material.** A slow, viscous liquid fills the whole card, pale filaments folding
through it, and it is drawn *underneath* the portrait: the boss's portrait is
masked so the creature dissolves into it at the edges, and what shows through is
the liquid. The creature is standing in the thing rather than in front of it.

Two rules have to agree for any of that to be visible and neither errors alone.
The canvas is parked below the portrait layer — over it, the effect is a coloured
film on somebody's face, which is the overlay this deliberately stopped being.
And the portrait has to stay masked: it is a full-bleed opaque cover image, so
without the mask the canvas is hidden completely and the card looks exactly like
a boss on a machine with no WebGL. The mask is the one that will be lost, because
it reads as a cosmetic vignette and deleting it costs nothing visible in the
frame it is deleted in. The check tool requires both.

The accent is `--gl-tyrant`, a purple that exists for this and nothing else. Both
purples already on the rail were taken: `--gl-violet` means "secret, hidden,
mystery" and paints the scrambled cards, `--gl-orchid` is the dying accent, so a
boss on either would be exactly the colour of a hidden combatant or a downed
party member. Both tiers share the hue and differ in weight, and the card already
states the tier where it counts, since its extra entries read "Turn 2 of 3"
against a Greater's "Turn 2 of 2".

The liquid runs on the same `CardFXManager` that draws the guard-break and dying
effects, so a boss card costs one more program and no new machinery. It replaced
a sigil of two counter-rotating rings of engraved ticks, which was wrong in a way
worth recording: concentric marks on a rectangular card read as a target pasted
onto it, they carry nothing the card does not already say, and at rail size two
of them are a smudge with a hole in the middle. A material has no such problem —
there is nothing to centre and nothing to miss.

How the liquid is made: the field is warped by a flow of its own before it is
sampled. One level of that is marble; feeding the warp back into the sample point
is what makes it fold into itself, and folding is what separates a liquid from a
cloud. Ridging the result leaves only the crests, which is the *surface* of the
liquid rather than its density — thin pale filaments over a body held in shadow.
Both the flow and the sample drift, on different axes at different rates, so it
never repeats and never obviously loops.

Three deliberate choices about cost, since this is on screen for the whole
encounter rather than for a moment. The octave count is local (3) rather than the
shared helper's 5: there is no fine structure here to resolve and the extra
octaves are invisible under a portrait. There are four noise calls, not the six a
two-level warp wants. And there is no `uTexel` anywhere — nothing here is
*struck*, so nothing needs a hairline sized in device pixels; the filaments are a
power of the fold, so their width comes from the field's gradient and they gain
pixels on a HiDPI display rather than losing them, which is the failure the
device-pixel rule exists to prevent.

It is also the quietest effect in that file, deliberately. A boss holds two or
three slots of every round, so anything that flickered would be the loudest thing
on screen for half the encounter; an extra turn takes it at a little over half
strength again, since its card is the busiest on the rail. It yields to break and
dying, which are states of the current fight and the more urgent thing to say.

## Flatfinder and Proficiency-without-Level

Three seams, and each of them fails silently if it is got wrong.

**The boss level is never written to the actor.** `pf2e-flatten` implements PWoL
by adding a custom modifier equal to minus the actor's stored level and refreshing
it whenever that level changes. Storing the +2/+4 would make it subtract that much
again from every check and DC the boss makes, so a Supreme boss would come out
four points *worse* than the creature it was built from — in PWoL worlds only,
with every number on its sheet looking entirely ordinary. Flatfinder's own
Elite/Weak handling documents the same trap.

**The Boss DC carries the world's flattening offset.** A Boss DC is a static
number computed from the level table, so nothing in `pf2e-flatten` can reach it.
In a PWoL world the PCs' saves are flattened by their own level while this DC
would not be, leaving every save against the boss about a level too hard. The
actor's own flattening value is folded in when the DC is computed, and the panel
says so under the figure.

**The level bump and the XP factor reach Flatfinder by different routes.** The
encounter-budget badge already derives XP from the level difference, so feeding it
the boss level *and* multiplying by the tier would count the boss twice. The bump
goes only to the incapacitation maths — which is what the book says it is for —
and the multiplier only to the budget.

Each is separately switchable, because each lands on a different table's toes.

## Scope

Some of the book's material is a GM tool rather than something to automate.

**Underlings ship no code.** Their defences are a stat block change (Hit Points
equal to twice the base creature's level, and a rewritten critical-failure rule),
which is a creature you build once and reuse, not a rule that needs a hook. The
abilities that reference underlings name them in their text.

**The abilities themselves are not automated.** Marking a boss creates the ability
items with the right costs, traits and numbers; using one is the GM reading the
card and applying it, exactly as with every other NPC ability in PF2e. This
feature computes and presents; it does not roll for anyone.

**The rule text is paraphrased, not reproduced.** The catalogue carries each
ability's mechanics, action cost, traits and computed figures in this project's
own wording with a page reference. Buy the book.

## Validation

```bash
node tools/pf2e-variant-rules-check.mjs
```

Zero problems required. Beyond the general rule checks it pins, for this feature:
that no module writes `system.details.level.value`; that the level-based DC table
matches PF2e's own, read out of the installed system bundle (the steps widen to +2
above level 20, which is where a hand-typed copy goes wrong); that the Boss DC
carries the flattening offset and never falls below 1; that the two Downfall locks
stay separate; that no rotation ever places two boss turns in succession or in the
same slot at any party size from 1 to 8; that an extra turn never sorts at or
above the boss's own initiative; that every ability's rule text spends exactly the
scale keys its entry declares and no others; that every trait written to an item
is one PF2e actually knows; and that `writeHp` writes the maximum in its own
update before the value, since `CreaturePF2e#_preUpdate` clamps an incoming
`hp.value` against the maximum the actor has at that moment.

One live-world failure is worth stating outright, because nothing about it is
subtle once it happens and nothing about it is visible before. An extra turn is a
real Combatant carrying the boss's own actor and token, so it passes every "is
this a boss?" test in the feature. Syncing one gives it extra turns of its own,
each of which fires `createCombatant` and syncs again: the encounter doubles its
boss entries per pass. In testing that reached about 1800 combatants and hung the
client. Both the hook filter and `syncBossTurns` itself refuse an extra turn now,
and the check tool requires both.

It also requires that a boss card out-measure an ordinary one **in both
layouts**. The narrow block below 720px restates the card height at
`.gluni-card .gluni-card-surface`, which ties the boss rules on specificity and
beats them on order, so a boss on a small screen silently came out exactly the
size of the creatures it towers over while the desktop rail looked correct.

For the look, the preview generator writes a page that renders the panel and a
**mixed** rail — a boss standing among the ordinary cards it is meant to
out-measure, which is the only way that claim can be judged — and compiles the
real `FX_FRAG_TYRANT` in a real WebGL context, reporting the compile log rather
than swallowing it. A fragment shader that fails to compile degrades to nothing
drawn: the card renders perfectly and the effect is simply absent.

```bash
node tools/boss-preview.mjs --out=.preview/boss.html && node tools/preview-server.mjs 8951
```

Serve it. A `file://` page does not execute its module script, so opening the
output directly gives you cards with no liquid in them and no error either.

Neither the check tool nor the preview can prove how any of this behaves in a live
encounter; that needs a session.
