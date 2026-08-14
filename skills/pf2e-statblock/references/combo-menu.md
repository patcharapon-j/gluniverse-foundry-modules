# The Combo slot

A **Combo** is the kit's team-facing slot: a reaction that fires off something
**another creature** does. It is mandatory above `background`.

It is the old Trigger slot, renamed and pointed outward — a rename rather than an
addition, so the sheet does not grow, and `benchmarks.md` already has a reaction
damage column to price it on.

**Whether it consumes the creature's reaction depends on tier:**

| Tier | |
|---|---|
| `standard` | The Combo **is** the reaction. One per round, total. |
| `elite`, `boss` | Its own once-per-round slot. The reaction stays free for a stock Chassis reaction. |

A Combo is fired by *someone else's* action. If the creature can be forced to
spend that reaction defending itself, the party's setup is wasted through no
decision of their own — a tax, not a trade. Give every `elite` and `boss` a stock
defensive reaction (`Nimble Dodge`, `Shield Block`) so the two never compete. If
the Chassis reaction deals damage — `Reactive Strike` — pay for both against the
reaction damage column.

> The old Trigger slot asked "what does this creature react to?"
> The Combo slot asks **"what does the party get to do because this creature is
> here?"** — which is the question that never got asked, and the reason two
> shipped allies had zero PC-enableable gain and played as solo characters
> beside the party.

## The rules

| | |
|---|---|
| Frequency | **Once per round.** Its own slot at `elite`+; the reaction itself at `standard`. |
| Cost to the trigger | **Nothing.** No action, no roll, no resource from the PC. |
| Pricing | The **reaction** damage column in `benchmarks.md`, not the Strike column. |
| Who decides — **ally** | **The PC who triggered it.** They may decline. |
| Who decides — **enemy** | It fires automatically when triggered. |
| Who decides — **neutral** | Fires automatically; the trigger must be side-agnostic. |

That ally rule is the whole "press the button" feeling. The trigger *arms* the
Combo and the player who set it up chooses to cash it — which costs the GM no
decision time at all, and gives players a reason to go hunting for the trigger.

## The palette

Twelve canonical triggers. This is a **palette, not a whitelist** — see
"Going off-menu" below. But start here, because every entry is an event PF2e
generates constantly, every player already understands, and none needs
explaining.

**Prefer the top half.** A *condition* sits visibly on the token and persists
across turns, so the Combo cannot silently whiff. A *moment* can pass unnoticed
at a live table.

### Conditions on a target — the preferred half

| # | Trigger | Fed by | Best for |
|---|---|---|---|
| 1 | A creature within 30 ft **becomes off-guard** | almost every class | the default. Flanking, feints, Hide, most debuffs |
| 2 | A creature within 30 ft **is frightened** | Demoralize, spells, `Frightful Presence` | fear-themed kits; rewards an Intimidation build |
| 3 | A creature within 30 ft **is taking persistent damage** | alchemists, casters, oils | ongoing-damage payoffs; naturally elemental |
| 4 | A creature within 30 ft is **prone, grabbed, restrained or immobilized** | Athletics builds, grapplers, animal companions | control payoffs; the martial lane |
| 5 | A creature within 30 ft is **below half Hit Points** | everyone, eventually | executioners, closers. Cheap and reliable — arguably *too* reliable at high levels |
| 6 | A creature within 30 ft has **any condition at value 2 or higher** | stacking debuffers | escalation kits. Broad, so pair it with a narrow payoff |

### Moments — use when the fiction wants a reaction, not a state

| # | Trigger | Fed by | Best for |
|---|---|---|---|
| 7 | A creature **critically hits** | everyone | universal, high-drama, impossible to miss at the table |
| 8 | A creature **succeeds at an Athletics maneuver** (Trip, Shove, Grapple, Disarm) | martials | makes maneuvers worth the action they cost |
| 9 | A creature is **force-moved** — pushed, pulled, or knocked prone | Shove, spells, hazards | pursuit and repositioning kits |
| 10 | A creature **casts a spell** of a named trait or rank | casters | elemental and tradition-flavoured pairings |
| 11 | A creature **restores Hit Points** to another creature | healers | sustain kits, and it gives healers a combat lane |
| 12 | The **first creature each round** to succeed at **Recall Knowledge** | everyone | makes RK worth an action; doubles as a Break lane on bosses |

### Two more, for enemies specifically

Enemy Combos may key off **other enemies**, which is how a warband reads as a
squad rather than a pile of statblocks:

- **An allied creature within 30 ft applies a condition to a PC** — the classic
  applier → payoff handoff. A caster marks, a brute cashes in.
- **An allied creature within 30 ft is reduced to 0 HP** — grief, escalation,
  or a retreat trigger. Also the cleanest way to make killing the mooks *matter*
  rather than just being chores.

## Pairing patterns

Name the creature's place on the applier/payoff axis before writing the Combo.

| Pattern | Applier does | Payoff does |
|---|---|---|
| **Mark and detonate** | applies a condition | Combo consumes it for burst |
| **Setup and execute** | drops the target below a threshold | Combo triggers a finisher |
| **Open and enter** | force-moves or displaces | Combo repositions into the gap |
| **Expose and punish** | makes the target off-guard | Combo strikes at advantage |
| **Contain and collect** | immobilises | Combo applies an area effect that could not otherwise land |

A pair of appliers is a dull fight. A pair of payoffs is a stalled one. Check the
encounter, not just the sheet.

**The best example already in the vault** is `Shadow Pursuit`'s trigger —
*"…or is moved away from him"*. A PC Shoves the target, and the ally buys a free
teleport-and-Strike. The PC was going to Shove anyway; the Combo converts an
action they already wanted into someone else's turn. That is the target shape.

## Going off-menu

Legal, under two conditions:

1. **The event is observable** — a person at the table can see it happen without
   being told to watch for it.
2. **It is not a passive occurrence.** A PC-action trigger must be a critical
   result or a declared activity. "When a PC moves" is not a trigger; "when a PC
   Strides more than 15 feet in one action" is borderline; "when a PC Steps out
   of the creature's reach" is fine.

### Bespoke, partner-locked triggers

A Combo may name a **specific other creature** when the pairing *is* the design:

- a **duo boss** where the two halves are meant to be fought together;
- a **rival crew** running one shared resource;
- a **bonded pair** — rider and mount, master and construct, twins.

Outside those cases, do not creature-lock a trigger. A creature-locked Combo on a
lone lieutenant is an ability that never fires.

## Anti-patterns

| Don't | Why |
|---|---|
| Trigger off the creature's **own** action | That is a Signature with extra steps, and it re-creates the self-feeding engine defect |
| Trigger off board state nobody watches | "when a creature ends its turn adjacent to a corpse" — costs two sentences of explanation and fires by accident |
| Chain Combos | Never let one Combo satisfy another's trigger. Recursive reaction chains are unresolvable at speed |
| Compound conditions | "when a creature is both frightened **and** off-guard" — halves the fire rate and doubles the explanation |
| Price it as a Strike | It is a reaction. Use the reaction column, or the creature out-damages its band |
| Give an ally a Combo the party cannot feed | Check that at least two PCs in the actual party can trigger it. A persistent-damage Combo in a party with no alchemist or caster is a dead slot |

## Writing it

```markdown
### Riptide Answer
Type: reaction
Traits: water
Function: Combo Trigger
Description: *The water she is standing in leaves without her, and arrives
somewhere else first.*

**Trigger** A creature within 30 feet becomes off-guard.

**Effect** Flow Steps up to 10 feet toward the triggering creature and makes a
Cutlass Strike against it. On a hit, she gains 1 Tide.
```

`Function: Combo Trigger` substring-matches the importer's `trigger` role, so it
records correctly without a code change. See `grammar.md`.

## Checklist

- Does it point at something **another creature** does?
- Is it a condition rather than a moment — or is there a reason it is a moment?
- Can at least two members of the actual party trigger it?
- Is it priced on the reaction damage column, once per round?
- At `elite` and above: does the creature carry a stock **defensive** reaction in
  its Chassis, so the Combo and the reaction are not the same slot?
- If that Chassis reaction deals damage, is it paid for in the damage budget?
- For an ally: does the triggering PC decide whether it fires?
- For an enemy: does it fire automatically, and is that fair to read?
- For a neutral: is the trigger side-agnostic?
- Does it avoid satisfying another Combo's trigger?
- If it is creature-locked, is the pairing genuinely the design?
