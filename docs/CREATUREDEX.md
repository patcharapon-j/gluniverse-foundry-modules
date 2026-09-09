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
category is absent — homebrew, an importer that never set one — the action type
decides: a reaction or a passive is defensive, anything else offensive. That
fallback is the part worth checking after a change, because getting it wrong
puts a real ability in the wrong section and the stat block still looks
perfectly ordinary.

**Section keys are data.** They are written into world knowledge the moment a GM
reveals anything. Renaming one does not throw; it forgets every creature the
party has ever learned, on the next load, silently. Add keys, never rename them.

## What a roll buys

| Outcome | Effect |
|---|---|
| Critical success | two sections, the player's choice |
| Success | one section, the player's choice |
| Failure | nothing |
| Critical failure | one section, false |

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
- **No secret checks** — removes the critical-failure effect *entirely*, so a bad
  roll teaches nothing rather than a quieter lie. A table that can see the die
  cannot be fooled by it.
- **Roll for the section** — 1d4, where 1–3 names the section and 4 is a free
  choice. The die is rolled **once, when the card is stamped**, and stored. A
  "roll" recomputed at render time is not a roll: it would differ between two
  players looking at one card and change on every re-render.

## Where knowledge lives, and why

One world setting (`dex.knowledge`), not document flags. Knowledge is a relation
between a character and a creature and a flag can only live on one end of it: on
the creature it is wiped by re-importing the bestiary entry, and on the character
it is writable by that character's own player — the person it is being kept from.

Entries are keyed by the **base actor's** UUID, so eight goblins in a room are
one creature to learn and the entry survives the tokens being deleted.

Nothing stores a copy of the stat block. A revealed section is drawn out of the
live actor every time the window opens, so retuning a creature does not leave the
party holding a transcript of what it used to be.

## The socket is the one place a player writes world state

The book gives the *choice* to the player, so the offer card is shown to the
roller. Only a GM client can write a world setting, so the click travels over the
suite socket and is executed by the active GM.

A raw Foundry module socket carries no server-attested identity and no authority:
any client can emit any payload. The executing GM therefore ignores everything in
the payload except three pointers — which message, which character, which section
— and re-answers every question from shared documents:

- does that message exist, and what outcome does *it* record?
- how many sections does that outcome buy, and how many has this card already
  paid out (a flag on the message itself)?
- does the sending user actually own that character?
- does the subject even have that section?

If that ever degrades into trusting the payload, a player can hand themselves a
completed creaturedex for anything on the board and no screen looks wrong.
`tools/creaturedex-check.mjs` pins each of those five checks by name.

## Discerning Aid

Granted once, on a character's first completed dex, as a real Item so that
"counts as the Aid reaction for all purposes" means something and other effects
can find it. The *requirement* is per-subject; the *access* is not, so it is
never taken back — an item that appears and disappears between fights reads as a
bug. Deleting it is a choice, and the flag means it is not silently re-granted.

The bonus is Aid's own table (+1 on a success; +2 on a critical success, +3 for a
master, +4 for a legendary; −1 on a critical failure), keyed on the rank of the
skill the *Recall Knowledge* was made with, not the skill the ally is rolling.

## Repeat attempts are advisory

The book lets a character try again once they have watched the creature take a
turn. Turns are counted as they *end*, per encounter, and an attempt has to be
paid for by one of them — counting "has it acted at all" would let a single
observed turn unlock an unlimited run of retries in the same round.

Nothing blocks a roll. The card says whether the attempt is a repeat and leaves
the ruling with the GM, which is the same assist-mode stance Chip Damage and
Dents take.

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
receives part of another), pins the five socket checks, the base-actor key, both
runtime-built i18n families, and that every button is sized.

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
