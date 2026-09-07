# Arcane Surge

The Sea of Stars makes magic unreliable. An eligible casting in an unstable area
rolls one d20 against the area's stability; rolling at or under the threshold
surges. The surge banners the spell's own card, tears the screen for two
seconds, and posts a severity card the GM *or* the caster can roll.

This feature deliberately implements the **procedure** and none of the
**content**. The four d100 theme collections live outside the module; the
severity card names the tier and stops. Interpretation is the GM's.

## The model

```
area level ──(steadied? one step down)──► effective level
                                            │
                   ┌────────────────────────┴───────────────────┐
            ordinary casting                             invited casting
            roll 1d20 ≤ threshold                        surges outright,
            → surge                                      row escalates one
                   └────────────────────────┬───────────────────┘
                                            ▼
                                   severity row → 1d100 → tier
```

| Level | d20 surges on | Glyph faces on its die |
|---|---|---|
| Stable | never — no check at all | — (never rolled) |
| Fraying | 1 | 1 |
| Unbound | 1–4 | 4 |
| Unraveling | 1–8 | 8 |

Severity rows are **cumulative upper bounds** on a d100, which is how the draft's
table expresses "None": a tier sharing a bound with the one above it has zero
width and never comes up.

| Row | Minor | Major | Catastrophic | Reality Breach |
|---|---|---|---|---|
| Fraying | 90 | 100 | 100 | 100 |
| Unbound | 55 | 90 | 100 | 100 |
| Unraveling | 20 | 65 | 99 | 100 |
| Invited in Unraveling | 20 | 65 | 95 | 100 |

Every number above is GM-editable from the Control Center. The names are not.

## The load-bearing decisions

**The die's glyph count IS the threshold.** Fraying carries one glyph, Unbound
four, Unraveling eight, so the die a player watches tumble is the odds they are
facing and landing glyph-up is the result with no arithmetic in between. That
number lives in three places — the level config, the DSN preset builder, and the
texture baker's coverage check — and `tools/arcane-surge-check.mjs` refuses to
let them drift. A disagreement renders perfectly while making the die a lie
about its own probability.

**An invited casting throws no d20.** Inviting is a guaranteed surge; rolling a
die whose result is predetermined would misrepresent the odds the die exists to
show. The banner reads INVITED and goes straight to the burst.

**Stable produces nothing at all** — no die, no banner, no card, no overlay. The
die's *appearance* is therefore itself the sign that the party is somewhere
unstable, which is step one of the draft's procedure for free. The ambient
shader is inert at chaos 0 in the GLSL, not merely torn down by the host: an
invariant that holds only because of the code that avoids exercising it is not
an invariant, and a cross-fade passes through chaos 0.

**One casting, one check.** A PF2e spell can post a cast card, an attack roll and
a damage roll, and every one of them reaches `createChatMessage` on every
connected client. Two independent guards: the check keys on `flags.pf2e.casting`,
and an origin-uuid dedup window backstops the paths that do not produce a card
shaped the way you would hope. A double surge is the worst failure this feature
has — it doubles the drama and the GM cannot tell which one was real.

**Exactly one client rolls.** The caster's own client if they own the actor
(so Dice So Nice launches the throw from their seat), otherwise the lowest-id
active GM. Every client computes the same election and all but one bail out.

**Every NPC check is the GM's alone — including the ones that pass.** A surge on
an NPC casting rolls privately, banners GM-only, and animates nothing until the
GM presses Release. But the *passed* checks are private too: a public "the weave
held" on an enemy's spell announces that the GM's monsters are being checked at
all, and prints the level it was checked against, which is exactly what conceal
exists to prevent. The gate is `playerCast`, not `held`.

**Conceal redacts the banner, not just the chip.** While stability is concealed,
a player's own banner omits the level name and the die face. A surge they
experience is the intended way to find out; a label reading "Unraveling" on their
own spell card is not.

**Releasing a held surge plays from exactly one path.** Foundry does not echo a
socket to its sender, so the releasing GM would otherwise be the only person at
the table not to see the burst — it is played locally as well, the way
`locations` runs its own travel payload after emitting it. The flag is marked
`releasedAt` so the render path stands down permanently; without that, a release
inside the freshness window plays twice on every player.

**Severity is public, including the number and the band it was read against.** A
card a player is allowed to press cannot hide its own result, and a table that
can see "94 on the Unbound row" understands the system rather than only
receiving verdicts from it.

## Transport — three channels, on purpose

| What | How | Why not a socket |
|---|---|---|
| Stability level | world setting `onChange` | Fires on every client already. The suite's weather works the same way. |
| A player-cast surge | the chat message flag | Every client renders the card, sees a fresh flag, and plays. Free and self-healing. |
| A GM releasing a held NPC surge | `emitSocket` | The message is old by then, its freshness window has expired everywhere, and a flag update alone would play nothing. **This is the only job the socket has.** |

## The two visual layers

They have very different budgets and that difference is the whole design.

**Ambient** runs for hours. Two octaves of value noise and one domain warp — no
Voronoi, no five-octave fbm. Half device resolution (it is a soft low-alpha veil
with no hard edge in it). Pauses on `document.hidden`. Sits at `--gl-z-sticky`,
above the board and **below every piece of Foundry chrome**, because a haze over
the sidebar and hotbar for three hours would make the interface unusable. Under
load it sheds `drift`, which stops the clock and leaves the veil — what degrades
must be the motion, never the state.

**Burst** runs for 2.4 seconds and is **baked, never live**. `initiative`'s break
splash already paid to learn that a full-screen procedural fracture costs a
visible hiccup per frame, and this fires at the one moment a hitch is least
forgivable. The shader renders 24 frames into textures once per level; playback
is one textured triangle per frame. Sits at `--gl-z-splash`. Scaled by
**stability level, not severity** — severity is rolled later, by which time the
burst is over, so what the burst can honestly express is the state of the world.
The tier gets its own shorter second beat when the card resolves.

Measured in the preview harness, ambient mean alpha by level: Stable 0 (exactly),
Fraying 3.2, Unbound 8.0, Unraveling 14.4 out of 255. Bake cost: 4–7 ms for 24
frames.

## Chat surfaces

The banner injects into the **spell's own card** — one casting, one card. It
renders on a pass as well as a surge, because a banner that only appears when
something happened spoils itself by existing. It is a deliberate visual sibling
of `destiny-dice`'s fate strip, in its own `glas-*` namespace, and inserts *after*
it so the mechanical adjustment reads before the cosmic consequence. Both use
remove-then-reinsert idempotence, so they cannot fight.

The severity card auto-posts unrolled. That waiting button is most of the
tension, and it means the roll cannot be forgotten.

## The die

`CONFIG.Dice.terms` is a global single-character namespace shared with every
other module in the world, and a collision is silent — the later registration
overwrites the earlier and both modules keep running, one of them now rolling
somebody else's die. This takes `u` (`1du`) only after reading whether `u` is
free, and otherwise falls back to a plain `1d20` read identically. **The DSN half
of that fallback matters as much as the roll half**: if the letter was refused,
`du` is another module's die, and registering a preset for it would repaint
*their* dice with our blank and surge faces — which looks like a bug in their
module, not ours. Registration is skipped entirely in that case.

The die also carries the level it was rolled against, stamped onto the term by
`stampLevel()`. Without it the die cannot label its own face: the same number is
a surge at Unraveling and a blank at Fraying, so an unstamped die would print a
verdict in the roll tooltip that disagrees with the banner beside it.

Dice So Nice is a **soft** dependency: without it there is no tumbling die, and
the banner, the burst and the severity card all still work.

Three DSN *systems*, one per rolling level, each carrying a `du` preset with that
level's face layout — the same trick `pf2e-damage-dice` uses to get several
appearances out of one die type.

## Colour, and the one place it is stated twice

WebGL cannot read a CSS custom property, so the ramp is derived from the palette
mirror in `core/theme.mjs` by `palette.mjs` — never written out as hexes here.
Both hosts re-read it through `onThemeChange()`, and the burst additionally
throws its baked frames away on a retheme, because the palette is burned into
them.

`anim.mjs` carries a literal copy of those floats, and that is deliberate: the
preview page inlines that file as source with no module resolution available to
it. It is genuine drift risk — two statements of one colour — so the check tool
asserts the copy still equals `hexToRgbFloat(PALETTE[…])`, and separately that no
feature file restates a suite colour as a live hex.

## This feature owns no motion tier

`applyMotionTier()` writes the suite-global `--gl-motion-scale`. A second feature
applying its own preference would silently retime Loot Gen, Destiny Dice and
Statsblock Import — the three the design system says own that control. The check
tool fails the build if this feature ever calls it.

## Validation

```bash
node tools/arcane-surge-check.mjs
```

Zero problems required. It pins the odds↔glyph-count↔bands agreement, band
monotonicity and the tier windows the draft's tone depends on (Fraying reaches
Major but never Catastrophic; inviting in Unraveling must actually be more
dangerous than not inviting), the exposure rules, hostile-config repair, the
three-way uniform agreement for all three shader programs, `SHED_ORDER`
bidirectional completeness, the JS↔CSS duration mirrors, the z-band and
pointer-events of both full-screen layers, every runtime-built i18n key, the
die's defensive registration, and the one-casting-one-check / one-card-one-roll
guards.

```bash
node tools/gen-surge-textures.mjs && node tools/gen-surge-textures.mjs --check
```

The die faces are generated, not drawn. `--sheet=/tmp/surge.png` renders a
contact sheet of all six maps; the groove is a **bump** feature, so review it
there rather than in the albedo.

```bash
node tools/arcane-surge-preview.mjs --out=.preview/surge.html
node tools/preview-server.mjs
```

**Serve it** — a `file://` page does not execute its module script, so the
shaders never compile and you see an empty box rather than a failure. The page
compiles the real shaders in a real WebGL context and drives them with the real
animation model. It cannot tell you how any of it reads over real map art at a
real table; that needs a session.

## Not implemented, deliberately

- **The four d100 theme collections.** Outside the module by decision.
- **Per-region stability.** The level is one world-global value the GM sets by
  hand, so "use the stability at the caster's position" and the bleed-zone rule
  are hand-operated rather than enforced. Scene Regions would enforce them and
  are a whole second feature.
- **No DCs are computed anywhere.** The severity tier is a prompt for the GM, not
  a mechanical effect. The surge never cancels the spell — ordinary misses,
  saves, disruption and counteracting all still work normally.
