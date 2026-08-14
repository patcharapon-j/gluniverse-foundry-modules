# Designing the kit

The design half of this skill. Replaces `engine-design.md`.

> Give every significant NPC one readable **kit** of five fixed slots, put the
> creature's changing state in **Postures** rather than in the GM's head, and
> point at least one slot at something the *party* does.

The kit supplies the **vertical** axis: build a resource, enter a state, mark a
target, prepare a payoff. The **Combo** supplies the **horizontal** axis: allies,
enemies, positioning, statuses and objects create openings another creature
converts. PF2e supplies bounded math, the three-action economy, reactions,
conditions and degrees of success.

## What v2 fixes

The previous system failed at the table in three measurable ways. Every rule in
this file traces back to one of them.

| Failure | Cause | Fix |
|---|---|---|
| **Volume** | four NPCs each running a private engine | one engine-bearing creature per side |
| **Payoff mismatch** | Ultimates arriving after the fight was decided | Ultimates arrive from a Posture, not a round count |
| **Explanation overhead** | the cost of *teaching* an engine to players | the explanation-cost budget, and Postures as self-announcing state |

Tracking was never the problem — Foundry counts correctly. **Explaining** was.

Two further defects the audit found in the shipped sheets, both now ruled out:

- **Self-feeding engines.** When the Signature *is* the gain condition, the
  resource is a round counter in costume. Two of four sheets had zero
  PC-enableable gain, which means the GM was running solo characters beside the
  party. The Combo slot exists to make that structurally impossible.
- **A forced minor conversion.** See "The conversion rule" below. It was the
  wrong play on four sheets out of four.

## Complexity is the spine, not the ceiling

HSR and Endfield characters live inside closed digital rules: the designer knows
every legal input, target and interaction. A tabletop NPC exists in an open
fictional world. Players cut ropes, bargain, collapse bridges, weaponise
furniture, redirect hazards and invent approaches no sheet could enumerate.

A significant PF2e NPC should therefore be **more complex in possibility space**
than its videogame inspiration, while remaining easier to administer than a PC.
**Add complexity outward before adding it inward.**

| Layer | Question it answers | Desired complexity |
|---|---|---|
| Kit | What builds and cashes out the identity? | One tightly connected resource or state |
| Tactical choices | What meaningfully different things can it do now? | Two or three routine lines with contextual value |
| Resolution | How can outcomes vary? | Degrees of success, conditions, counterplay |
| Cross-pillar use | How does the identity matter outside initiative? | Exploration, social, chase, hazard, downtime |
| World response | How can the environment interact with it? | Objects, terrain, access, information, relationships |

"More complex" is never permission for several unrelated meters, nested duration
tracking, or a dozen rotation buttons. The goal is **combinatorial and fictional
depth on a stable mechanical core**.

Beware the trap the last rewrite fell into: **thematic coherence is not the same
as low table load.** One shipped sheet deleted six poison doses and fifteen
prepared spell slots — real bloat — and still rose from roughly 8 trackable
states to 17, because the replacement complexity was *related* to the theme.
Coherence and load are separate budgets. Spend both deliberately.

## The two-section sheet

A sheet has two halves, and only one of them costs the GM anything to learn.

| Section | What it holds | How it grows |
|---|---|---|
| **Kit** | the five bespoke slots | **fixed by tier — never grows.** Level adds riders to existing slots. |
| **Chassis** | stock PF2e: `Reactive Strike`, real spells, gear, `Grab`, `Trample`, `Frightful Presence` | grows freely with level |

This is the resolution to "a level 15 lieutenant should have more going on than a
level 3 one". It should — but all of that growth belongs in material a GM already
knows. A fifth-rank spell and a `Reactive Strike` cost zero comprehension. A
sixth bespoke ability costs a paragraph of reading in the middle of a fight.

It also turns the old "70% stock, 30% invented" guidance from a vibe into a
structural boundary: **the Chassis is the 70%.**

## The five slots

One printed ability may fill two slots. Nothing may add a sixth.

| Slot | Axis it owns | `Function:` tag |
|---|---|---|
| **Signature** | offense **or** control — the frequent action expressing its pressure | `signature` |
| **Combo** | team-facing. **This is the Reaction slot.** | `Combo Trigger` |
| **Ultimate** | must combine **two** payoff axes | `ultimate` |
| **Talent** ×2 | defense and utility. **One must have an out-of-combat use.** | none, or `engine` on whichever carries the resource |

Slot-typing is what enforces the offense/defense/control/utility mix. You cannot
ship an all-damage kit, because the Talent slots are typed.

Two slots from v1 are **deleted as mandatory**: the Pivot Signature and the
Signature Utility. Both were owed by every elite, and together they are where
elite sheets became unreadable. A Pivot Signature is now optional and lives in
the Chassis if it is stock; a Signature Utility is now the *optional utility
accent* below.

### The Combo and the reaction, by tier

| Tier | How it works |
|---|---|
| `standard` | The Combo **is** the creature's reaction. One per round, total. |
| `elite`, `boss` | The Combo is **its own once-per-round slot.** The normal reaction stays free for Chassis reactions — `Reactive Strike`, `Nimble Dodge`, `Shield Block`. |

The split exists because of who pulls the trigger. **A Combo is fired by someone
else's action** — usually a PC's. If the creature can be forced to spend that
reaction defending itself, the party's setup is wasted through no decision of
their own, and the Combo stops being something they can rely on. That is not an
interesting trade; it is a tax.

At `standard` the squeeze is fine, because a simple NPC choosing between
self-preservation and the team play is a real decision and the sheet is small
enough to hold it.

**Budget guard rail.** If the Chassis reaction also deals damage — `Reactive
Strike` — then it *and* the Combo both count against the reaction damage column
in `benchmarks.md`. A defensive Chassis reaction costs nothing, which is why
`Nimble Dodge` and `Shield Block` are the natural pairings and `Reactive Strike`
needs paying for.

The Combo is still a *rename* of the old Trigger slot rather than an addition, so
migration stays nearly free. The consequence is the point: every creature that
used to have a self-facing Trigger must now aim it at something **someone else**
does.

See `references/combo-menu.md` for the trigger palette.

### The optional utility accent

A significant NPC may carry **one** compact utility ability outside the five
slots when it creates a tactical axis the kit does not already provide — smoke,
illumination, scouting, opening or sealing access, temporary terrain,
communication, dispelling, interacting with a hazard.

An accent should:

- cost one action, and be once per encounter or gated behind a narrow condition;
- require **no second resource** and no independent subsystem;
- solve a *different* problem rather than improve the damage rotation;
- optionally accept a minor spend from the kit's resource for a longer or
  stronger effect;
- create a real reason to preserve the flexible third action.

If it is routinely mandatory, fold it into the Signature. If it is rarely
relevant even in its intended scene, delete it or broaden its trigger.

**Deletion test:** remove it and replay the situation. If the NPC reaches
substantially the same result with the same check and positioning, it was not an
ability yet.

## Tier matrix

| Tier | Kit slots | Postures | Combo | Ultimate | Resource | Explanation cap |
|---|---|---|---|---|---|---|
| `background` | 1 | 1 | no | no | none | **1 sentence** |
| `standard` | 2 | 2 | yes | yes — once per encounter, **no resource** | none, or binary 0–1 | **3** |
| `elite` | 4 + 2 talents | 3 | yes | yes | 0–2 threshold | **5** |
| `boss` | 4 + 2 talents | 3–4 **per phase** | yes | yes | full pool + Break | **8** |

**Only `boss` may exceed a 0–2 resource.** A 0–5 pool on a creature that dies in
three rounds was the original sin.

A `standard` Ultimate with no resource is not a downgrade. Endfield's cheapest
Ultimates cost 80 energy and hit for 1000% — cost buys **frequency**, and
frequency is a personality trait. A once-per-fight Ultimate fired from a Posture
is what lets a two-slot NPC still feel like a character.

## Budgets

Three budgets, all hard, all declared in the report.

### 1. Statistical trade-offs

Start from the real default — Moderate defences, **High** attack, **High** spell
DC, **High** best skill — then spend deviations. See `benchmarks.md`.

| Tier | Deviations |
|---|---|
| `background`, `standard` | 1 |
| `elite` | 2 |
| `boss` | 3 |

Extreme costs two and must be paid for by a Low or Terrible elsewhere. Every
`elite` and `boss` needs at least one Low stat — that is where the counterplay
lives.

### 2. Explanation cost

Measured empirically across four shipped sheets:

> **sentences ≈ 3 + (2 × gain branches) + 3 if the kit introduces a new board object**

A "new board object" is anything the players must be taught to see: a path map,
a light map, a mark set, a placed-device network, a second bar.

Run it backwards and the caps in the tier matrix bite hard:

- an **elite** gets **one** gain branch and **no** new board object;
- a **boss** gets one gain branch plus **one** board object — and that object is
  the Break bar, which is already budgeted.

The cheapest fixes, in order: collapse a two-branch gain to one (−2 sentences),
then do not introduce a board object (−3 flat). Neither costs damage, defences
or fiction.

**Explanation cost and tracking load are different problems and rank
differently.** A sheet can be cheap to explain and expensive to run, or the
reverse. Check both.

### 3. Tracking load

Count every distinct thing the GM holds simultaneously: resource counters, marks
on creatures, Postures, once-per-round flags, duration timers, cooldowns.
Target: **8 or fewer** at `elite`. Postures do not count as tracking load —
Foundry shows the badge — but a *timer inside* a Posture does.

## Build procedure

### 1. Write the combat promise

> This NPC **[verb]** so that **[battlefield result]**, and reaches their climax
> when **[earned trigger]**.

Becomes `Promise:` in `## Engine`. One sentence, under 280 characters. Every
sheet gets one, resource or not — it is what makes the sheet skimmable in six
months.

### 2. Choose role and pressure

| Role | Frequent output | Ultimate output |
|---|---|---|
| Striker | Focused damage, pursuit, execute setup | Burst, transformation, chained attack |
| Defender | Interception, shield, body-blocking, punishment | Team rescue, fortress state, redirected catastrophe |
| Controller | Forced movement, terrain, action denial, marks | Battlefield rewrite, mass displacement, lockdown |
| Healer / sustainer | Recovery tied to action or positioning | Recovery plus cleansing, revival window |
| Amplifier | Mark, expose weakness, improve a category of action | Team burst window, duplicated Signature |
| Vanguard / initiator | Opens routes, restores tempo | Resets positioning, enables a coordinated assault |
| Hybrid | Converts between two outputs | A brief state where both halves operate |

Then pick the creature's place on the **applier / payoff** axis, which Endfield
makes explicit and PF2e has no word for:

- an **applier** puts conditions onto targets and rarely cashes them in;
- a **payoff** consumes a condition someone else applied, for a burst;
- a **self-contained** creature does both, and needs no partner to function.

A pair of appliers is a dull fight. A pair of payoffs is a stalled one. Name the
axis before writing abilities.

### 3. Choose the resource — or none at all

Name it something that belongs to the NPC: Heat, Evidence, Rage, Open Routes,
Prophecy, Debt, Rhythm, Hunger, Static, Verdict. That name goes in `Resource:`.

**Choose the shape before the cap. A cap of 3 is not a default.**

| Shape | Size | Best for | Ultimate relationship |
|---|---|---|---|
| No resource | — | `background`, `standard`, all standard allies | Once per encounter, fired from a Posture |
| Binary readiness | 0–1 | Ignition, guard, loaded shot | Require and consume it |
| Threshold state | 0–2 | Routes, stances, completed setup | Require without spending, or consume one |
| Placed marks / objects | 1–3 on the field | Devices, prophecies, zones, prey | Consume specific pieces, or require a pattern |
| Deep pool | 0–5 to 0–8 | **`boss` only** | Spend a fixed 2–4; do not empty |
| Threshold without currency | bloodied, exposed | Berserkers, phase changes | Trigger from the state; nothing is spent |

Rules that bite:

- **Start at 0** unless a prepared opening visibly establishes part of it.
- Gain **at most once per round**, and from **exactly one branch**. Two gain
  branches costs two sentences of explanation and buys almost nothing.
- **The gain condition must be an event a PC causes, or one the creature visibly
  performs on screen.** Banned: ticking off board state nobody was watching —
  "ends its turn adjacent to a corpse", "an ally within 60 feet was healed".
  This is the single rule that removes explanation overhead, because a resource
  the party *feeds* is a resource they learn by playing.
- **The Signature may not be the gain condition.** If pressing the button fills
  the bar, the bar is a round counter. At least one gain branch must run through
  the Combo or through a PC action.
- Resources unlock **options and state changes**. They do not stack repeated
  bonuses to attack, AC, saves and damage.
- **An Ultimate can never generate the resource that paid for it.**

**Placed objects are the cheapest resource shape there is** — Endfield leans on
them heavily (thrown lances that get recalled, whirlpools that get consumed) and
they cost nothing to track because the counter is physically on the board. Reach
for them before reaching for a number. They do, however, count as a board object
against the explanation budget, so a `boss` running placed objects has spent its
one allowance and cannot also have a Break bar.

### The conversion rule

**Do not force a minor conversion.** Binary, threshold, placed-object and
bloodied engines are **exempt** — do not add a spend merely to satisfy a
template.

This corrects a real defect. The v1 checklist demanded a minor conversion
universally, and on all four shipped sheets the Spend-1 option was the *wrong*
play, because spending dropped the creature below a threshold its own riders
required. Build-versus-convert was fake four times out of four.

A minor conversion is correct only for a **deep pool** (`boss` only), where
points have somewhere else to go. When present, it may delay the Ultimate by no
more than one round.

### 4. Build the Signature

One two-action activity, leaving a flexible third action for PF2e basics.

- At most two immediate choices after it resolves.
- It preserves or spends the resource; it does not generate it (see above).
- Templates: Move + Strike · Mark + pressure · Protect + counter-setup · Zone +
  choice · Place object · Sequence (stage 1 enables stage 2) · Conversion.

At `elite` and above a second Signature is permitted but not owed. If you add
one, it must solve a **different thematic problem** and neither may be a strict
upgrade over the other. If it is stock PF2e, it belongs in the Chassis and costs
nothing against the kit.

### 5. Build the Combo

The reaction, aimed outward. Full guidance in `references/combo-menu.md`. In
brief:

- **Prefer a condition over a moment.** A condition sits on the token and cannot
  be missed; a moment can pass unnoticed at a live table.
- Triggers may key off **PC actions or other creatures' actions** — enemies may
  combo off each other, which is how a warband reads as a squad rather than a
  pile of statblocks.
- Bespoke partner-locked triggers are legal where the pairing **is** the design:
  a duo boss, a rival crew, a bonded mount.
- **For allies, the PC who triggered it decides whether it fires.** No action
  cost, no roll. That is the whole "press the button" feeling, and it means an
  ally never consumes GM decision time.
- Priced on the reaction damage column. Once per round.
- At `elite` and above it does not consume the creature's reaction — give that
  creature a stock defensive reaction from the Chassis and let the two coexist.

### 6. Build the Talents

Two passives. One is defensive, one is utility, and **at least one must function
outside combat.**

Out-of-combat capability belongs on a Talent specifically because a passive
already works in exploration and downtime without inventing a mode switch. This
replaces v1's "does the identity have a use outside combat?" checklist item with
something structural.

Whichever Talent carries the resource rule takes `Function: engine`.

### 7. Build the Ultimate

Categorically stronger than the Signature — it seizes the scene for a moment,
not "the normal action but +2".

| Payment model | Use when | Avoid when |
|---|---|---|
| Consume binary readiness | The state is readable and re-earnable | It also powers every routine action |
| Require, do not spend | Routes or setup fictionally remain | The resource represents fuel or ammunition |
| Fixed partial spend | Deep pool, and routine conversions also spend | Remaining points have no purpose |
| Consume marks / objects | The pieces are the visible tell | Destroying them already makes it unreliable |
| No payment, Posture trigger | `standard` tier, bloodied, rescue, phase kits | It would fire without earned setup |

Defaults: **two actions**; once per encounter; earned by visible thematic events,
never by round count; combines **two payoff axes** (damage + control, movement +
protection, transformation + action compression, healing + cleansing); leaves an
encounter-level change behind. Three-action Ultimates are reserved for vulnerable
channels. Reactive Ultimates are rare.

**Availability test.** Estimate opening resource `S`, expected gain through round
2 `G`, and likely routine spending `M`. The Ultimate is credible when `S + G − M`
meets its cost by round 2 or 3. Then replay one realistic turn where the NPC
takes its most attractive alternative line: if that pushes the Ultimate past
round 4, lower the cost or raise the gain.

One shipped sheet's Ultimate arrived "often never". Run the test.

### 8. Build the Postures

See `references/postures.md`. Every tier gets at least one. The Posture is where
the creature's changing state lives, and — because Foundry renders it as a badge
on the token — it is also the telegraph, which is why it costs nothing to
explain.

### 9. Telegraph and counterplay (enemies)

Every enemy Ultimate needs all four, mapping onto `## Engine` fields:

1. **Tell** → `Tell:` — usually just *the Posture it is standing in*.
2. **Threat** → `Threat:` — what happens if the players ignore it.
3. **At least two responses** → `Counterplay:` — interrupt, move, cleanse a mark,
   destroy an object, protect a target, force early activation, redirect.
4. **Changed result** — successful counterplay cancels, weakens, narrows, delays
   or redirects it.

Boss Ultimates may be inevitable; their outcome must stay influenceable.

### 10. PF2e-native math

See `benchmarks.md`. The rules that bite:

- Use **creature** benchmarks, not PC construction.
- HP has no Extreme band; saves and Perception have a Terrible band.
- Below level 11, more than one Extreme stat is a deliberate exception.
- **Use the right damage column** — Strikes, reactions, area-with-a-basic-save
  and constant/aura damage all price differently. The Combo prices as a reaction.
- Use standard conditions before inventing numerical modifiers. Thresholds should
  change *behaviour*, not add invisible passive math.
- Anything that can stun, paralyse, dominate or otherwise remove a PC from play
  carries **incapacitation**. This also gives you Endfield's "elites and bosses
  shrug off hard control while still taking stacks" for free — no invention
  needed.
- **No complete extra turns.** Use a specified quickened action, a Reaction, a
  free Step or Interact, or a commanded minion.
- No long save-or-lose. A failed save must leave meaningful participation.
- Summons and second bodies take **minion** and share action economy.

### 11. Reuse the native chassis first

- **Troops** are the official Background/minion chassis for mob waves — 16
  squares, public HP thresholds at 2/3 and 1/3, Form Up. A troop is already a
  public-threshold engine; do not rebuild it.
- **Complex hazards** are the official chassis for battlefield objects, evolving
  zones and detonation networks. Take hazard numbers and hazard XP.
- **Elite / Weak adjustments** rescale a finished NPC one level without redesign
  (±2 to AC, attacks, DCs, saves, skills; ±2 damage, ±4 on limited-use
  abilities). They suit physical-combat creatures — retune a kit's payoff numbers
  by hand.
- **Non-combat level** is where cross-pillar identity lives; an NPC may have a
  higher social or crafting level than its combat level.

## Allied, neutral and enemy sheets differ

| Question | Allied NPC | Enemy NPC |
|---|---|---|
| Purpose | Create options, participate in any role | Create a problem the PCs can read and solve |
| Combo | The triggering **PC decides** whether it fires | Fires automatically when triggered |
| Ultimate | **A PC spends it**, free action. The GM never does. | Telegraphed; PCs can cancel, weaken, redirect, endure |
| Information | Resource and Postures simply visible | Posture visible; the *map* is learned by Recall Knowledge |
| Turn length | ~5 seconds (`standard`) to ~30 (`elite`) | Standard fast; bosses may take longer |

Allied NPCs are **not** restricted to support — a striker ally may be the biggest
damage source, provided the party can enable, direct, protect or exploit it
rather than watch the GM play a solo character.

Allied and neutral kits **skip the Recall Knowledge ladder** — their state is
simply visible.

### Running an ally

| | `standard` ally | `elite` ally |
|---|---|---|
| Default routine | **Stride / Strike only.** Zero decisions. | 3-rung Posture ladder |
| Resource | **none** | 0–2, fed by PC actions |
| Ultimate | once per encounter, PC-triggered | earned, PC-triggered |
| Encounter budget | **half a body** | **full body** |

An elite ally keeps a ladder because **the ladder is its characterisation** — a
companion who always shields the lowest-HP PC is saying something about
themselves. A standard ally should cost the GM nothing at all.

An escort or protect target is an **objective on a hazard chassis**, not a
combatant: low defences, zero offensive slots, one kit-relevant behaviour. It
counts as **zero bodies**.

### Neutral / third-party (`Allegiance: neutral`)

1. **Side-agnostic Combo.** The trigger keys off *events*, not teams: "when any
   creature within 30 feet is critically hit". Both sides can feed or starve it.
2. **Published agenda plus a visible flip threshold.** One line of targeting
   rule, at most one defection trigger, stated as a tell. Never a hidden loyalty
   tracker.
3. **Budget by expected net contribution**, and re-budget at the flip. The worst
   case must never push the encounter more than one threat tier above intended.
4. **A rival party runs one shared resource.** `standard` individual sheets, and
   an Ultimate that is an *exit or objective seizure* — never a TPK tool.

## Recurring NPCs: how a rival grows

A rival who returns three levels later gets **two** changes, authored up front:

1. **Rank riders** — printed on the sheet as `Rank 2:` / `Rank 3:` lines that
   switch on when they return. Endfield's own model: *"Ultimate improved: …"*.
   This is what makes their numbers different.
2. **A new Posture** — this is what makes them *feel* different. The party
   learned the old map, and now it is wrong. One new Posture communicates growth
   more legibly than any stat bump, and it costs one paragraph at authoring time.

Riders change the numbers; the Posture changes the behaviour. Behaviour is what
the party actually learned, so that is what has to change.

## Recall Knowledge ladder (significant enemies only)

The Posture is a public badge, so the old payoff — revealing the gain condition —
has been eaten by the design. Reveal **the map** instead:

- **Success** reveals the **edges**: what shifts it between Postures, and what
  waits in the one it has not entered.
- **Critical success** reveals the **Combo trigger** — how to feed it, or starve
  it.

This turns Recall Knowledge into scouting rather than trivia, and it pays twice:
first Recall Knowledge of the round is one of the four Break lanes in
`boss-design.md`.

Skill by creature trait, DC by level and rarity; a matching Lore uses the easier
DC. Pre-write at least two rungs.

## Prepared openings

If the NPC prepared the encounter, pick exactly one: begin with 1 resource; begin
with a mark placed; place one battlefield object; begin in a Posture other than
the first; or enable a first-round Signature rider. If surprised, remove it.

## Final validation checklist

Every "no" needs a fix or a stated reason.

**Readability**
- Can a GM explain this NPC in two sentences?
- Is the explanation cost within the tier cap? Count it: `3 + 2×branches + 3×objects`.
- Is tracking load 8 or fewer distinct simultaneous states?
- Does the Kit have **exactly** its tier's slot count, with all growth in the Chassis?

**The kit**
- Does the Signature own offense or control, the Talents defense and utility?
- Does at least one Talent work outside combat?
- Does the Ultimate combine two payoff axes — a state, choice or opportunity, not
  only extra damage?
- Is there an optional utility accent, and does it pass the deletion test?

**The engine**
- Exactly one gain branch?
- Is the gain condition PC-caused or visibly performed on screen?
- Is the Signature *not* the gain condition?
- Does the resource shape fit the fiction, with a deliberately chosen cap?
- Is the cap 0–2 or smaller, unless this is a `boss`?
- Does the Ultimate's payment model fit the shape?
- Is the kit **exempt** from minor conversion — and if a conversion is present, is
  this a deep pool where it makes sense?
- After one realistic alternative line, can the Ultimate still arrive by round 3–4?
- Does the Ultimate avoid generating the resource that paid for it?

**The Combo**
- Does it point at something *another creature* does?
- Is it a condition rather than a moment, or is there a reason it is a moment?
- Is it priced on the reaction damage column, once per round?
- At `elite` and above: does the creature have a **stock defensive reaction** in
  the Chassis, so its reaction and its Combo are not the same slot?
- If the Chassis reaction deals damage, is it paid for in the damage budget?
- For allies: does the triggering PC decide whether it fires?

**Postures**
- Does every tier have at least its minimum count?
- Does each Posture's ladder end in an unconditional rung?
- Is the name outside `CONDITION_WORDS`?

**PF2e**
- Do the numbers match the right benchmark column?
- Do lockdown effects carry `incapacitation`, and summons `minion`?
- Are extra turns replaced with narrow action compression?
- Does every failed save preserve meaningful participation?
- Could a troop, complex hazard, or elite/weak adjustment have replaced this?

**Encounter**
- Is there **exactly one** engine-bearing creature on this side?
- Is a `standard` ally budgeted as half a body, an `elite` ally as a full one,
  and an escort as zero?
- For enemies: are the Tell and at least two counterplay routes explicit?
- For enemies: is the Recall Knowledge ladder pre-written, revealing edges then
  the Combo trigger?
- For neutrals: is the Combo side-agnostic, the agenda one readable line, and the
  flip threshold visible?
