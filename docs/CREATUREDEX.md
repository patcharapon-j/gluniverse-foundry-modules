# Creaturedex

*Adventures+* pp. 77–79, implemented as `features/pf2e-creaturedex`.

A stat block is three sections, not one fact. Recall Knowledge buys them one at
a time, the party keeps what it learns, and learning all three grants the
Discerning Aid reaction. Every optional reading the book prints in a sidebar is
a setting rather than a decision baked into the code, because the book prints
them as choices for the table.

## The section tables

| Creature | Colour | Holds |
|---|---|---|
| Characteristics | green | level, rarity, size, traits, Perception, Languages, Skills, attribute modifiers, Items, interaction abilities |
| Defense | blue | AC, saving throws, HP, immunities, weaknesses, resistances, automatic and reactive abilities |
| Offense | red | Speed, Melee, Ranged, spells of every kind, offensive and proactive abilities |

| Hazard | Colour | Holds |
|---|---|---|
| Complexity and Stealth | green | level, complexity, rarity, traits, Stealth, description |
| Disable and Trigger | blue | AC, saving throws, Hardness, HP, IWR, the disable text, the trigger |
| Routine and Reset | red | the routine, its actions, the reset |

**PF2e already sorts an NPC's abilities into exactly these three.**
`system.category` is `interaction` / `defensive` / `offensive`, which are the
book's own headings under other names, so an ability routes itself. Where a
category is absent — homebrew, an importer that never set one — the ability is
**deferred to completion** rather than guessed at: a guess from the action cost
gets a majority right and the rest leak, handing a player who bought Defense an
offensive ability while the stat block still looks perfectly ordinary.

Two things beat PF2e's category. A GM's per-item override, which is what an
override is for; and a short map of abilities whose section is a *fact* rather
than an inference. Only **Attack of Opportunity** — *Reactive Strike* after the
remaster — is on it. PF2e tags it `defensive` because Paizo's stat block prints
it in the Defense block, and it is a Strike: what a player buys with Offense is
"what happens if I move past this thing", so leaving it under Defense means the
player who paid for the section it belongs to never sees it. The map is keyed on
the name with any parenthetical qualifier stripped ("Reactive Strike (Jaws
Only)"), so it is English-only by construction — in a translated world the
ability falls back to PF2e's category, which is where it would have gone anyway,
and the per-item override is the way through.

**Section keys are data.** They are written into world knowledge the moment a GM
reveals anything. Renaming one does not throw; it forgets every creature the
party has ever learned, on the next load, silently. Add keys, never rename them.

## What a roll buys, at the table

| Outcome | Effect |
|---|---|
| Critical success | two sections, the player's choice |
| Success | one section, the player's choice |
| Failure | nothing |
| Critical failure | one section, false |

This is the book's rule and it is what the GM applies. The module does not read
it: nothing here watches a roll, and the reveal is the GM's click. See below.

A false section is stored beside the true ones and **rendered identically to its
holder**. It carries a marker only in the GM's view. That asymmetry is the whole
mechanic: a lie a player can see is not a lie. It is also the only place in this
feature where two people looking at the same window see different things.

A lie never overwrites a section already known truly. A bad roll should fail to
add something, not destroy something the player earned.

## The sidebars, as settings

- **Party knowledge** — one member's success completes the dex for everyone.
  Writes always land on the character who earned them; this setting changes only
  how a read is *resolved*, unioning every owner instead of reading one. So it
  can be turned on and off mid-campaign without inventing or destroying a single
  fact, which a shared-pool-on-write design could not manage in either direction.
- **Recall Knowledge delivery** — prose only, sections only, or both, for a world
  that also runs `features/pf2e-recall`. Explicit rather than accidental: the
  prose saying "you sense it is dangerous" beside a card printing AC 24 is two
  disagreeing answers to one roll.
- **Doctoring may alter resistances** — off by default. See below.

The book's other two sidebars, *It's Not a Secret* and the 1d4 section pick, both
describe how to resolve a roll. Since nothing here resolves one, they are the
GM's ruling rather than a setting: a table dropping the critical-failure lie
simply does not press Falsify.

## The GM reveals; nothing watches a roll

The book's trigger is a Recall Knowledge check. The module's trigger is the GM
pressing a button, and that is deliberate.

Knowledge gets granted at a real table for reasons a die roll does not cover: a
check made out of character, a creature nobody targeted, something a player
worked out and was simply told, a correction after a misclick. Wiring the reveal
to a roll would make all of those the exceptions rather than the ordinary case,
and it would put a player's click on the write path of a world setting — which
then needs a socket that re-derives every claim it is handed, because a raw
Foundry socket carries no attested identity. None of that machinery exists here
and its absence is pinned, so a later change cannot quietly reintroduce it.

So there is no offer card, no spend ledger, no repeat-attempt counter. There is a
panel with three rows.

## Where knowledge lives, and why

One world setting (`dex.knowledge`), not document flags. Knowledge is a relation
between a character and a creature and a flag can only live on one end of it: on
the creature it is wiped by re-importing the bestiary entry, and on the character
it is writable by that character's own player — the person it is being kept from.

### Identity is the creature's kind

An entry is keyed by the **compendium source** where the actor has one, falling
back to a normalised name-and-level slug. Both come back as one opaque `dexKey`,
so the fallback is invisible downstream.

One goblin warrior can exist in a world three ways at once — the compendium
entry, a world duplicate with the link severed, and something `statsblock-import`
built. Those are one monster to the fiction and three documents to Foundry, and
keying on `actor.uuid` would file each separately: the party fights goblins in
three dungeons, learns goblins three times and completes none of them.

The level is part of the slug on purpose. An elite variant a GM built by hand is
arguably a different creature, and the ordinary goblin's AC should not silently
answer for the one that hits harder.

### The store holds snapshots, not pointers

This is the load-bearing decision and it is a privacy one.

Foundry hands every client the full Actor document. A player who holds no
permission on a creature can still read `actor.system` from the console. So a dex
that stored *which* sections were bought and then rendered them out of the live
actor would be drawing a lock on the player's own screen, over data sitting one
line of console away — security theatre, and the exact failure this design
exists to avoid.

A section is therefore rendered **by the GM's client, at reveal time**, and the
result is what the store keeps. The store then contains precisely what has been
handed over and nothing else, so a curious player who reads it directly learns
exactly what they were told. That is the only kind of honesty that survives
somebody looking.

Two consequences follow. Snapshots are taken **post-flatten**, because
`pf2e-flatten` rewrites NPC numbers in Proficiency-without-Level worlds and the
player should see the numbers that will really apply at their table. And a
revealed section is a **memory**, not a live view: a creature the GM buffed last
session *should* surprise the party. `Refresh` on the entry is for the other
case, where the GM fixed something and wants the dex to stop disagreeing with the
thing on the board.

Redacting the last holder of a section drops its stored snapshot too, so the
store keeps its one guarantee: it contains only what somebody was told.

## Authoring a lie

A false section is stored beside the true one and **rendered identically to its
holder**, marked only in the GM's view. That asymmetry is the mechanic, not an
oversight: a lie a player can see is not a lie.

The Falsify dialog is the book's two methods, verbatim:

- **Borrow** takes another creature's corresponding section and files it under
  this creature's name. Fast, and the lie is a *real* stat block — its numbers
  agree with each other because they were always somebody's numbers.
- **Doctor** perturbs this creature's own section. AC, saves and Perception drift
  by up to 2; HP by up to 20%; Speed by 5; a damage die moves exactly one step
  along d4–d12. Weaknesses and resistances move only behind a setting.

Two rules inside the doctoring pass are load-bearing and neither is visible in a
diff.

**A drift is never zero.** A pass that rolls 0 on the one row a player happens to
check has produced a lie that is the truth, and the GM cannot see that from the
dialog. Every row it touches actually moves.

**Immunities are never altered, in either direction.** Removing one is the case
the design brief named: the poison-focused rogue empties their whole kit into a
creature that was never going to care, and a random pass chose that outcome
rather than the GM. Adding a false one costs exactly the same thing from the
other side, since the rogue reads it and never tries at all. A lie about AC costs
a turn and a lie about a weakness costs a spell slot, which are the rule working;
a lie about an immunity costs a character concept. The switch is pinned so that
immunities cannot be routed into the drift even when the row would happen to
carry no digits to move.

Whatever is generated is **editable before it is sent**. That screen is the last
one showing the lie before a player sees it, and no automatic pass is good enough
to skip it. A section already false refuses a second lie, which would change
nothing while looking like it worked.

## Getting to a creature

Four roads, because a player owns none of the creatures in the dex and so has no
gesture the canvas will give them: double-click opens a sheet they lack
permission for, right-click summons a HUD they cannot raise, and the token's
context menu is the GM's.

- **A scene control**, under Token controls, opening the browsable shelf. This is
  the "what have we learned" moment, which is not attached to any one creature.
- **`K`**, rebindable and unbound in core Foundry, opening the entry for whatever
  the user is pointing at: their target first, then a controlled token, then a
  hover. All three matter — a player aiming a spell has a target, a summoner has
  a controlled token, and "point at it" is a hover.
- **A token HUD button** and an **actor-directory right-click**, for the GM's
  "this creature" moment, which is sometimes a token and sometimes a sidebar row.
- **An already-open window follows the target**, silently. A dex that appeared
  while you were aiming a spell would be a window nobody asked for.

All of them go through `CreaturedexApp.mayView`, which answers nothing for a
creature the party knows nothing about. An unknown creature's entry would print
its **actor** name and portrait, and a GM who hid a token's name did so on
purpose, so "nothing learned" is the honest answer rather than a window that
quietly identifies the thing the party is looking at. Knowing a *lie* counts: a
player told one cannot see that it is false, so refusing to open there would be
the module losing the only thing they were given.

## Discerning Aid

Granted once, on a character's first completed dex, as a real Item so that
"counts as the Aid reaction for all purposes" means something and other effects
can find it. The *requirement* is per-subject; the *access* is not, so it is
never taken back — an item that appears and disappears between fights reads as a
bug. Deleting it is a choice, and the flag means it is not silently re-granted.

The bonus is Aid's own table (+1 on a success; +2 on a critical success, +3 for a
master, +4 for a legendary; −1 on a critical failure), keyed on the rank of the
skill the *Recall Knowledge* was made with, not the skill the ally is rolling.

## Its relationship with the Recall Knowledge feature

`features/pf2e-recall` deliberately computes no DCs and prints no numbers: it
hands the GM one paragraph to read aloud. This feature is the other half — the
book calls it "a simulationist ruleset". They compose rather than compete: the
ladder is what the GM *says*, the dex is what the party can *look up*. Neither
reads the other's storage and either runs alone.

## Validation

```bash
node tools/creaturedex-check.mjs
```

Zero problems required. It exercises the pure rules, feeds a fixture creature and
hazard through the extractor and asserts every field the book names lands in the
section the book puts it in (and in **only** that section — a field in two
sections is worse than a field in none, because the player buys one and silently
receives part of another), pins the doctoring bounds and the immunity rule (behaviourally *and*
structurally, since a PF2e immunity list carries no digits for a numeric drift to
move), the three-way identity keying, that the store keeps snapshots and drops
one when its last holder loses it, both runtime-built i18n families, that every
button is sized, that a whole-party reveal fans out to the members rather than
writing a shared bucket, that all three section controls survive the trip from
context flag to template branch to registered action, and that every road in from
the board still asks `mayView`.

It also pins an **absence**. `chat.mjs`, `reveal.mjs`, a chat-card hook, a socket
and any read of a roll outcome are all refused outright, because "helpfully"
wiring the reveal back to a Recall Knowledge card is a change that would look
like an improvement in its own diff while putting a player's click back on the
write path of a world setting.

It cannot show you how any of it looks. For that:

```bash
node tools/creaturedex-preview.mjs --out=.preview/dex.html && node tools/preview-server.mjs 8953
```

**Serve it** — a `file://` page will not load the stylesheets the same way. The
page shows the player view beside the GM view, so the sealed plate can be judged
against a revealed section, and both chat cards at a real chat card's 14px type,
which is the only size at which an unsized button looks wrong. The check tool
refuses any `gldex-` class in the preview that the module does not actually
emit, so it cannot drift into showing a window that does not exist.
