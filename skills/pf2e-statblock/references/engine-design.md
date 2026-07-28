# Designing the engine

The design half of this skill. Distilled from *PF2e NPC Combat Engine — HSR and
Endfield Toolkit*, which is the authority when this file is ambiguous.

> Give every significant NPC one readable personal engine, then connect that
> engine to creatures and the battlefield through triggers.

The engine supplies the **vertical** axis: build a resource, enter a state, mark
a target, prepare a payoff. Triggers supply the **horizontal** axis: allies,
enemies, positioning, statuses and objects create openings another ability
converts. PF2e supplies bounded math, the three-action economy, reactions,
conditions and degrees of success.

## What each tier owes

| Tier | Required design | Used for |
|---|---|---|
| `background` | One Signature or one gimmick. No `## Engine` section. | Groups, incidental opposition |
| `standard` | Signature, plus a simple Trigger **or** a light Engine with a limited payoff | Ordinary named combatants |
| `elite` | Two complementary Signatures, Trigger, Engine with a minor spend, Signature Utility, Ultimate | Recurring allies, rivals, lieutenants |
| `boss` | The full elite kit plus phase evolution or a secondary pattern | Solo and set-piece encounters |

Do not give a `background` NPC an Ultimate. Do not ship an `elite` or `boss`
without all four tracked functions tagged — `tools/parse-check.mjs` warns when
you do.

## The six functions

One printed ability may perform two functions.

1. **Primary Signature** — the frequent action expressing its main pressure. Tag `signature`.
2. **Pivot Signature** — a competing action solving a *different* thematic problem. Tag `signature`.
3. **Trigger** — a reaction or occasional free action fired by an observable event. Tag `trigger`.
4. **Engine** — the rule that gains, changes, protects and offers a minor way to spend the resource. Tag `engine`.
5. **Signature Utility** — a bounded, identity-specific rules exception. **No tag.**
6. **Ultimate** — the earned climax that cashes out the engine. Tag `ultimate`.

The test is not "do all the abilities use the same resource". The NPC must face
a recurring choice between **building**, **converting** and **committing** it.

## Build procedure

### 1. Write the combat promise

> This NPC **[verb]** so that **[battlefield result]**, and reaches their climax
> when **[earned trigger]**.

This becomes `Promise:` in the `## Engine` section. One sentence, under 280
characters.

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

### 3. Choose one thematic engine

Name it something that belongs to the NPC: Heat, Evidence, Rage, Open Routes,
Prophecy, Debt, Rhythm, Hunger, Static, Verdict. That name goes in `Resource:`.

**Choose the resource shape before the cap. A cap of 3 is not a default.**

| Shape | Size | Best for | Ultimate relationship |
|---|---:|---|---|
| Binary readiness | 0–1 | Ignition, guard, transformation, loaded shot | Require and consume it |
| Threshold state | 0–2 | Routes, stances, completed setup | Require without spending, or consume one |
| Short tactical pool | 0–3/4 | Frequent build-vs-convert decisions | Spend a fixed portion |
| Deep execution pool | 0–5 to 0–8 | Many small events, stored attacks | Spend a fixed 2–4, do not empty |
| Placed marks / objects | 1–3 on the field | Devices, prophecies, zones, prey | Consume specific pieces or require a pattern |
| Threshold without currency | bloodied, broken, exposed | Berserkers, phase changes | Trigger from the state; nothing is spent |

Rules that matter:

- Start at 0 unless a prepared opening visibly establishes part of it.
- Gain **at most once per round** for small pools.
- The Ultimate should arrive in **rounds 2–3** of ordinary play.
- Resources unlock options or state changes. They do **not** stack repeated
  bonuses to attack, AC, saves and damage.
- A short or deep pool needs a **minor conversion** — a way to spend 1 for an
  immediate tactical answer. That conversion may delay the Ultimate by no more
  than one round.
- **An Ultimate cannot generate the resource that paid for it.**

Engine prompts to reskin (gain → threshold → cash-out):

| Prompt | Gain | Threshold | Cash-out |
|---|---|---|---|
| Hunter | Ally attacks marked prey | 3 Pursuit of 5 | Chain / pursue prey |
| Guardian | Prevent or accept damage | 1 Ready state | Team rescue / fortress |
| Berserker | Takes damage or spends HP | Bloodied, or 3 Rage | Short transformation |
| Investigator | PCs reveal weakness or Recall Knowledge | 3 of up to 6 Evidence | Expose flaw |
| Courier | Allies turn movement into safety | 2 Routes, retained | Coordinated reposition |
| Prophet | A declared event occurs | 3 Omens | Fulfilled prediction |
| Elementalist | Apply or convert marks | 3 of up to 5 Inflictions | Reaction field / burst |
| Commander | A designated ally succeeds | 1 Order Ready | Duplicate or improve an ally action |
| Performer | Different allies contribute | 4 Rhythm | Team performance window |
| Summoner | Owner and summon alternate | 2 Bond states | Combined attack / state |
| Engineer | Places objects | 3 devices | Detonate the network |
| Executioner | Target gains conditions or drops low | 3 of up to 5 Sentence | Focused finisher |
| Scavenger *(neutral)* | Any creature drops an item, falls, leaves cover | 3 Greed | Grab the prize and disengage |
| Wildcard *(neutral)* | Any creature within 30 ft is critically hit | 3 Panic | Flip allegiance or flee |
| Rival crew *(shared)* | The crew completes objective steps | 3 Score | Seize the objective and exit |

### 4. Build the decision surface

On its turn the NPC should see at least two credible lines: **build**,
**convert**, **commit**, and sometimes a **utility wildcard**. If one activity is
correct on ~70%+ of turns regardless of circumstances, the NPC is
under-designed. Cap it at four routine combat activities.

### 5. Build complementary Signatures

Usually two two-action activities, leaving a flexible third action for PF2e
basics (Stride, Strike, Interact).

- Neither Signature is a strict upgrade over the other.
- At least one builds or preserves the engine.
- At least one offers a minor conversion, or improves when resource is spent.
- Each has at most two immediate choices after it resolves.

Templates: Move + Strike · Mark + pressure · Protect + counter-setup · Zone +
choice · Place object · Sequence (stage 1 enables stage 2) · Conversion
(consume a mark for damage, movement, control or sustain).

### 6. Build the Signature Utility

**Do not print permission to do what the fiction already allows.** Any creature
can move debris, seek a route or improvise. A Signature Utility must give a
concrete rules exception:

- a defined use window (action, reaction, trigger, preparation, exploration);
- mechanical leverage (action economy, movement, targeting, range, degree of
  success, terrain, information);
- bounded scope (target, distance, duration, frequency);
- an identity another NPC could not reproduce by describing a sensible action;
- optional contact with the main engine — never a second resource.

**Deletion test:** remove the ability and replay the situation. If the NPC gets
substantially the same result with the same check and positioning, it is not an
ability yet.

### 7. Build the Trigger

Impactful damage, movement, protection or control uses the **Reaction**.
Resource bookkeeping can be a free action or passive. Default frequency: **once
per round**. Key off broad, observable PF2e events — a critical success, forced
movement, frightened, fire damage, healing, a successful Escape, an ally
dropping to 0 HP, an object created or destroyed. Never build recursive trigger
chains.

### 8. Build the Ultimate

It must feel categorically stronger than either Signature — it seizes the scene
for a moment, not "the normal action but +2".

| Payment model | Use when | Avoid when |
|---|---|---|
| Consume binary readiness | The state is readable and re-earnable | It also powers every routine action |
| Require, do not spend | Routes or setup fictionally remain | The resource represents fuel or ammunition |
| Fixed partial spend | Pool holds 4+ and routine conversions also spend | Remaining points have no purpose |
| Spend all | Gain is fast, or the Ultimate ends the loop | Gain is once/round from the same 3-point pool |
| Consume marks / objects | The pieces are the visible tell | Destroying them already makes it unreliable |
| No payment, state trigger | Bloodied, broken, rescue, phase engines | It would fire without earned setup |

**Availability test.** Estimate opening resource `S`, expected gain through
round 2 `G`, and likely routine spending `M`. The Ultimate is credible when
`S + G − M` meets its cost by round 2 or 3. Then test one realistic turn where
the NPC uses its attractive minor conversion: if that single spend pushes the
Ultimate past round 4, lower the cost or raise the gain.

Defaults: **two actions**; once per encounter; earned by visible thematic
events, never by round count; combines **two payoff axes** (damage + control,
movement + protection, transformation + action compression, healing +
cleansing); leaves an encounter-level change behind.

Three-action Ultimates are reserved for vulnerable channels. Reactive Ultimates
are rare.

### 9. Telegraph and counterplay (enemies)

Every enemy Ultimate needs all four, and they map onto `## Engine` fields:

1. **Tell** → `Tell:` — visible charge, stance, zone, object, spoken countdown.
2. **Threat** → `Threat:` — what happens if the players ignore it.
3. **At least two responses** → `Counterplay:` — interrupt, move, cleanse a
   mark, destroy an object, protect a target, force early activation, redirect.
4. **Changed result** — successful counterplay cancels, weakens, narrows,
   delays or redirects it.

Boss Ultimates may be inevitable, but their outcome must stay influenceable.

### 10. PF2e-native math

See `references/benchmarks.md` for the tables. The rules that bite:

- Use **creature** benchmarks, not PC construction.
- HP has no Extreme band; saves and Perception have a Terrible band.
- Below level 11, more than one Extreme stat is a deliberate exception.
- **Use the right damage column** — Strikes, reactions, area-with-a-basic-save
  and constant/aura damage all price differently.
- Use standard conditions before inventing numerical modifiers. Avoid invisible
  passive math; thresholds should change *behaviour*.
- Anything that can stun, paralyse, dominate or otherwise remove a PC from play
  carries the **incapacitation** trait.
- **No complete extra turns.** Use a specified quickened action, a Reaction, a
  free Step or Interact, or a commanded minion.
- No long save-or-lose. A failed save must leave meaningful participation.
- Summons and second bodies take the **minion** trait and share action economy.

### 11. Reuse the native chassis first

- **Troops** are the official Background/minion chassis for mob waves — 16
  squares, public HP thresholds at 2/3 and 1/3, Form Up. A troop is already a
  public-threshold engine; do not rebuild it.
- **Complex hazards** are the official chassis for battlefield objects, evolving
  zones and detonation networks. An Engineer-style object network should take
  hazard numbers and hazard XP.
- **Elite / Weak adjustments** rescale a finished NPC one level without redesign
  (±2 to AC, attacks, DCs, saves, skills; ±2 damage, ±4 on limited-use
  abilities). Caveat: they suit physical-combat creatures — retune an engine
  NPC's payoff numbers by hand.
- **Non-combat level** is where cross-pillar identity lives; an NPC can have a
  higher social or crafting level than its combat level.

## Allied, neutral and enemy sheets differ

| Question | Allied NPC | Enemy NPC |
|---|---|---|
| Purpose | Create options, participate in any role | Create a problem the PCs can read and solve |
| Trigger | Responds to broad PC events | Responds to player choices or battlefield state |
| Ultimate | Collaborative; PCs help earn or improve it | Telegraphed; PCs can cancel, weaken, redirect, endure |
| Information | Resource and triggers always visible | Engine becomes explicit after observation or Recall Knowledge |
| Target turn length | ~30–45 seconds for a significant ally | Standard enemy fast; bosses may take longer |

Allied NPCs are **not** restricted to support — a striker ally may be the
biggest damage source, provided the party can enable, direct, protect or exploit
it rather than watch the GM play a solo character.

Allied and neutral engines **skip the Recall Knowledge ladder** — their
resources are simply visible.

### Neutral / third-party (`Allegiance: neutral`)

1. **Side-agnostic engine.** The resource keys off *events*, not teams: "gain 1
   Panic when any creature within 30 feet is critically hit". Both sides can
   feed or starve it — that is the gameplay.
2. **Published agenda plus a visible flip threshold.** One line of targeting
   rule, at most one defection trigger, stated as a tell. Never a hidden loyalty
   tracker.
3. **Budget by expected net contribution**, and re-budget at the flip. The worst
   case must never push the encounter more than one threat tier above intended.
4. **Escort / protect targets are objectives on a hazard chassis**, not
   combatants: low defences, zero offensive functions, one engine-relevant
   behaviour.
5. **A rival party runs one shared engine** — one group resource, Standard-tier
   individual sheets, and an Ultimate that is an *exit or objective seizure*,
   never a TPK tool.

## Boss phases

At half HP or after the first Ultimate:

- evolve or replace one Signature;
- change how the same resource is gained or spent;
- introduce a new counterplay problem;
- do **not** fully heal, auto-erase conditions, or reset player progress unless
  the encounter math budgeted it.

## Prepared openings

If the NPC prepared the encounter, pick exactly one: begin with 1 resource;
begin with a mark placed; place one battlefield object; gain favourable
position; or enable a first-round Signature rider. If surprised, remove it.

## Recall Knowledge ladder (significant enemies only)

Pre-write at least two rungs into `## Recall Knowledge`:

- **Success** reveals the Engine's gain condition — "it grows hotter when injured".
- **Critical success** reveals the Trigger's condition, or the Ultimate's tell
  and one counter — "breaking a vent cools it".

Skill by creature trait, DC by level and rarity; a matching Lore uses the easier
DC.

## Final validation checklist

Run this before emitting. Every "no" needs a fix or a stated reason.

- Can a GM explain this NPC in two sentences?
- One internal engine, not several unrelated currencies?
- Do the Primary and Pivot Signatures solve meaningfully different problems?
- At least two credible choices per turn instead of one default rotation?
- Can the resource be converted for an immediate benefit *and* saved for the Ultimate?
- Does the Signature Utility pass the deletion test?
- Does the identity have at least one use outside combat?
- Does the Trigger use a broad observable event, at most once per round?
- Does the resource *shape* fit the fiction, with a deliberately chosen cap?
- Does the Ultimate's payment model fit that shape?
- After one realistic conversion, can the Ultimate still arrive by round 3–4?
- Is the Ultimate a state, choice or opportunity — not only extra damage?
- For enemies: are the Tell and at least two counterplay routes explicit?
- Does every failed save preserve meaningful participation?
- Are extra turns replaced with narrow action compression?
- Do the numbers match the right benchmark column, including the reaction and
  constant-damage adjustments?
- Do lockdown effects carry `incapacitation`, and summons carry `minion`?
- Could a troop, complex hazard, or elite/weak adjustment have replaced this
  custom design?
- Is a combat-capable ally budgeted as an additional party member?
- For enemies: is the Recall Knowledge ladder pre-written?
- For neutrals: is the engine side-agnostic, the agenda one readable line, and
  the flip threshold visible?
