# Encounter budget

Use this whenever the request mentions a party — level, size, or "for my
group". It turns "here is a statblock" into "here is an encounter you can run".
Skip it silently when no party is given; do not interrogate the user for it.

## Creature XP by level difference

XP a single creature costs, relative to **party level**:

| Creature level | XP |
|---|---|
| Party level − 4 | 10 |
| Party level − 3 | 15 |
| Party level − 2 | 20 |
| Party level − 1 | 30 |
| Party level | 40 |
| Party level + 1 | 60 |
| Party level + 2 | 80 |
| Party level + 3 | 120 |
| Party level + 4 | 160 |

A creature more than 4 levels below the party is worth no XP and should not be
in the encounter. A creature more than 4 above the party is not an encounter,
it is a scene.

## Threat budgets

For a party of **four**. Adjust per extra or missing player using the last
column.

| Threat | Budget (4 PCs) | Per additional / fewer PC |
|---|---|---|
| Trivial | 40 | ± 10 |
| Low | 60 | ± 15 |
| Moderate | 80 | ± 20 |
| Severe | 120 | ± 30 |
| Extreme | 160 | ± 40 |

Severe is the standard "real fight". Extreme should be rare, announced, and
survivable only with good play.

## Hazards

- **Complex hazard** — costs the same XP as a creature of that level.
- **Simple hazard** — costs one fifth of that: 2 / 3 / 4 / 6 / 8 / 12 / 16 / 24
  / 32 across the same level-difference range.

A targetable engine zone (an Engineer's device network, a boss's pyre rings)
should be budgeted as a hazard rather than handwaved.

## Allied NPCs

A combat-meaningful ally is **not** subtracted from the enemy side. It adds
character adjustments to the budget (Trivial +10, Low +15, Moderate +20, Severe
+30, Extreme +40) and you scale the *enemies up*. How many adjustments depends
on the tier:

| Ally | Counts as | Why |
|---|---|---|
| `elite` ally | **a full body** — one whole adjustment | Runs a 3-rung Posture ladder and a real resource |
| `standard` ally | **half a body** — half an adjustment, rounded up when it is the only one | Auto-attacks and does nothing else unless a PC presses something |
| Escort / protect target | **zero** | A hazard-chassis objective, not a combatant. Award XP for the objective instead. |

So five PCs plus one elite ally is six bodies; five PCs plus two standard allies
is also six. This matters most against a solo boss, where body count is exactly
what breaks the XP table — see `boss-design.md` §1.

An ally two or more levels below the party can be halved again or ignored. XP
awards still use the four-character listing.

## Neutral wildcards

Budget a true wildcard at **half an enemy's weight**, or as a complex hazard's
XP. Then check the worst case: if it turns on the party at the worst moment, the
encounter must not rise more than one threat tier above the intended one. If it
does, lower its level or narrow its flip condition.

## Solo bosses

A single creature at party level + 3 or + 4 eats the whole Severe/Extreme budget
and brings one turn against the party's four. That is the action-economy problem
every solo boss has. When you emit one, say so and offer at least one of:

- **Minions.** Spend the remaining budget on two to four creatures 3–4 levels
  below the party. They die fast, which is the point — they buy the boss turns.
- **Action compression on the boss.** A once-per-round free action, a strong
  Reaction, or a Trigger that fires off-turn. Never a full extra turn.
- **A complex hazard** sharing the boss's initiative, which effectively gives
  the opposition a second turn without a second statblock.
- **Phases** (see `## Phases` in the grammar) so the fight changes shape rather
  than repeating one rotation until the HP runs out.

## Worked example

> A level 12 boss against four level 10 PCs.

- Boss is party level + 2 → **80 XP**.
- Severe budget for 4 PCs is **120 XP**. 40 XP remain.
- 40 XP buys two creatures at party level − 2 (level 8, 20 XP each), or one at
  party level − 1 (level 9, 30 XP) plus a simple hazard.
- Verdict: a Severe encounter with room for a small supporting cast. Without
  minions the boss faces four actions per round against its three — flag the
  action-economy relief above.

Report it in that shape: creature XP, threat tier, what the remainder buys, and
any warning. Three or four lines, not an essay.
