# Arcane Surge

The Sea of Stars makes magic unreliable. An eligible casting in an unstable area
rolls one d20 against the area's stability; rolling at or under the threshold
surges. The surge banners the spell's own card, tears the screen, and posts a
severity card the GM *or* the caster can roll.

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

**Stable produces nothing at all** — no die, no banner, no card, no cracks. The
die's *appearance* is therefore itself the sign that the party is somewhere
unstable, which is step one of the draft's procedure for free. The crack shader
is inert at chaos 0 in the GLSL, not merely skipped by the host: an invariant
that holds only because of the code that avoids exercising it is not an
invariant, and every level change cross-fades straight through chaos 0.

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

## Where the controls live

The **stability chip** is a readout under the weather in the time-tracker HUD's
date cell (the bar's height is fixed, so the pair is sized to fit it), and
it is also where the instability is *drawn* — see the crack layer below. A GM
clicking it gets a level picker: four names and four markers, nothing else.
Descriptions under them made the popover taller than the HUD it hangs off and
told a GM what they already know; the prose lives on the hover instead. The
picker is positioned after mount and flipped when it would open off-screen — the
HUD is draggable, so a popover pinned unconditionally below its anchor runs off
the edge as soon as the bar is not near the top-left.

**Steady the Spell** and **Invite the Surge** live on the character sheet’s
spellcasting tab, because that is where a caster already is when they choose a
spell — a control anywhere else is one the table stops using by session four.
They are **two buttons**. An earlier version wrapped them in a bordered panel
with a header, the current level, the effective level a steadied cast would
resolve at, the row an invited one would be read against, and a line of
explanatory prose — five pieces of chrome around two toggles, wedged into the
top of a spell list somebody is scrolling. All of it survives on the tooltips,
resolved through the real rules, where it costs nothing until it is wanted.

The armed state is scoped to **that actor**, not just to the user, so a player
running two characters cannot steady one and silently steady the other’s next
spell.

A **GM right-click entry** on any chat card forces a surge onto it. The
automatic check can only see what PF2e tells it; this covers macros, spell-like
abilities, rituals, and anything the GM decides should count. It rolls no d20 —
the GM has already decided — and the banner records that it was applied by hand,
so the table can tell a ruling from a roll.

## Transport — three channels, on purpose

| What | How | Why not a socket |
|---|---|---|
| Stability level | world setting `onChange` | Fires on every client already. The suite's weather works the same way. |
| A player-cast surge | the chat message flag | Every client renders the card, sees a fresh flag, and plays. Free and self-healing. |
| A GM releasing a held NPC surge | `emitSocket` | The message is old by then, its freshness window has expired everywhere, and a flag update alone would play nothing. **This is the only job the socket has.** |

## The three visual layers

They have very different budgets and that difference is the whole design.

**Cracks** run for hours, inside the stability chip. A weave of threads running
through the label that names the level: loosening at Fraying, parting at Unbound,
snapping into splayed fibres at Unraveling, reaching further around the label as
it worsens. It is **deliberately not** the suite's glass fracture from
`core/fx-glsl.mjs`. It ran that field once, and a world coming apart then read as
one more thing being broken, since a broken creature's token, its initiative card
and its health bar all carry that crack. Pauses on `document.hidden`. Under load it sheds `drift`, which stops
the clock and leaves the cracks — what degrades must be the motion, never the
state. Measured cost at chip size: **0.001 ms per draw**.

Three things about it are load-bearing and none are obvious:

- **The weave is centred on the label.** Anchored on the level marker, at the
  left, the falloff left a splat over one end of the word and a dark tail at the
  other, because one end of a wide strip is much further away than the other.
- **Chaos is spent on spread and looseness, not on thread size.** The strip is a
  couple of dozen pixels tall; finer threads there buy mush. The threads are one
  device pixel wide at every level.
- **The field has a fixed CSS-pixel scale** (`CRACK_FIELD_PX`), never the
  strip's own height. Tied to the height, a shorter chip shrinks the weave with
  it and the pattern reads as squashed. A smaller chip shows less of it instead.

### Why this is not a full-screen veil any more

It was one, and the version before this hugged the four screen edges. The
problem with a session-long layer over the board is not cost, it is *place*: it
competes with the map for exactly the space the play happens in. Quiet enough to
live with for three hours, it read as haze; loud enough to read as a threat, it
was something a GM had to look through all evening. Neither is a setting you can
tune your way out of.

The state belongs where the state is **named**. The chip already says
"Unraveling"; cracking the glass around that word says the same thing, is never
between a GM and a token, and costs about a thousandth of the fill rate.

**Surge** runs for 1.8 seconds, **live**, at full device resolution, composed at
2× and box-averaged down. A vortex tearing open: spiral arms curved by a `log(r)`
angle offset, a shock racing outward, filaments whipping off it, with the word
struck across the middle. Deliberately nothing like the suite's golden glass
fracture — no Voronoi, no crack lines. Sits at `--gl-z-splash`. Scaled by
**stability level, not severity**, because severity has not been rolled yet, so
what it can honestly express is the state of the world.

**Verdict** runs for 1.2 seconds when the severity card resolves, and is the
OPPOSITE motion: concentric rings collapsing *inward* onto the centre, one per
tier step, in the tier's own hue over the arcane bed. The two can never read as
the same effect played twice.

### Why live, when it used to be baked

The first version pre-baked 24 frames, following `initiative`'s break splash,
whose comment blamed a visible hiccup on the per-frame cost of a full-screen
procedural field. That diagnosis was incomplete. The dominant cost was the
**first use** of the program — drivers defer real compilation and specialization
until a draw needs it — not the steady per-frame cost. Baking hid that by paying
it at load, but it also froze each effect into a filmstrip that visibly repeats,
pinned the source to a fixed resolution, and held the frames in VRAM.

`warm()` pays the same cost at load, off-screen, without any of that. Both
features now do it, and `arcane-surge-check.mjs` fails the build if either loses
its warm-up or starts baking again. On top of that the supersampler steps its
quality down only after this machine has actually missed two frames in a row —
full fidelity by default, degraded on evidence rather than on assumption.

Measured in the preview harness at real chip size (143×60 device px), mean alpha
out of 255 across the whole strip, and at the two ends versus the centre:

| Level | mean | centre | ends | lit |
|---|---|---|---|---|
| Stable | 0 | 0 | 0 / 0 | 0% |
| Fraying | 3.0 | 5.8 | 0.2 / 0 | 5% |
| Unbound | 14.8 | 25.7 | 4.0 / 3.5 | 16% |
| Unraveling | 29.4 | 39.4 | 21.9 / 16.9 | 22% |

Stable is *exactly* zero, and the two ends stay within a few points of each
other at every level — that symmetry is what centring the impact bought. Warm
cost 1–8 ms per program; worst live beat frame ~9 ms at 2× supersampling.

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
level's face layout — one die type wearing several appearances.

## Colour, and the one place it is stated twice

WebGL cannot read a CSS custom property, so the ramp is derived from the palette
mirror in `core/theme.mjs` by `palette.mjs` — never written out as hexes here.
Both hosts re-read it through `onThemeChange()`, and the burst additionally
re-reads it every frame, so a retheme lands on the next frame with nothing to
invalidate.

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
three-way uniform agreement across all four shader programs, `SHED_ORDER`
bidirectional completeness, the JS↔CSS duration mirrors, the z-band and
pointer-events of both drawn layers, every runtime-built i18n key, the die's
defensive registration, and the one-casting-one-check / one-card-one-roll
guards. Two of its sections exist for things this pass got wrong on the way in:
the cracks must *not* run the shared break fracture, and each
stability level's hue must be one statement — `LEVEL_KEYS` and the
`.glas-level-*` accent remaps naming the same token, with no two levels naming
the same one. The first draft had `unbound` on `--gl-holo-b`, which
`gl-tokens.css` aliases to `--gl-violet`, so the ladder's two most dangerous
rungs rendered in exactly the same colour.

```bash
node tools/gen-surge-textures.mjs && node tools/gen-surge-textures.mjs --check
```

The die faces are generated, not drawn. `--sheet=/tmp/surge.png` renders a
contact sheet of everything that ships, over a checkerboard so the two carriers
below are visible for what they are.

**There is no painted colour on these dice.** Every face carries relief and
light and nothing else, so what the table sees is Dice So Nice's own frosted
glass being cut and lit rather than a picture of glass laid over it. Two files
exist purely to make that possible, and both look like mistakes:

- **`clear.png`** — fully transparent, used as the `labels` entry for all twenty
  faces. DSN draws a face's `bumpMaps` and `emissiveMaps` *only* inside the
  branch it takes when that face's label resolves to an image; a text label
  (including `""`) goes down a path that writes glyphs into all three canvases
  and never reads those maps. An image label is the price of per-face relief,
  and a transparent one is how you pay it without painting anything. Replacing
  it with `""` silently removes the whirlpool from every die.
- **`surface.png`** — pure white, the colorset texture's albedo, composited
  `multiply`, which is the identity. DSN draws a texture's `bump` only inside
  the same block that draws its `source`, so a bump-only texture has to be a
  white texture.

Both are asserted by `--check` and by `arcane-surge-check.mjs`, because both
would render perfectly while being wrong.

### The bump map is also the transmission mask

This is the one that actually shipped broken, and it is the reason every level
in the baker is where it is.

For `glass` — and for `frosted` and `resin`, the other two transmissive
materials — DSN binds the *finished bump canvas* a second time as the material's
`transmissionMap` (`usesTransmissionMask` in `DiceFactory`) and reads it through
one line of its own patched shader chunk:

```glsl
material.transmission *= smoothstep(0.6, 0.9, texture(transmissionMap, uv).r)
```

So the height field is not only depth. It is the glass/solid decision, on a hard
curve with nothing usable in the middle:

| bump level | what it renders as |
|---|---|
| ≥ 0.9 (230) | fully transmissive — the body of the die |
| 0.6 – 0.9 | partial transmission, which reads as fog |
| ≤ 0.6 (153) | fully opaque — the figure you are meant to read |

DSN's own numerals are drawn at `#555555` on a `#FFFFFF` field, which is that
contract stated in the module's source. Ours agrees with it: the frost field
rides at ~248 and grains without leaving the band, the rings cut to ~120 and the
whirlpool to ~65, so a surge face is an opaque figure suspended in clear glass
rather than a shallow dent in it.

**The first version put its field at 141.** That is a legible height map, a
perfectly ordinary contact sheet, and 94% of every face below the bottom of the
curve — `transmission` was zero everywhere, the glass was not glass, and what
the table got was an opaque near-black solid with no albedo on it. Nothing
errored. `--check` now measures the median of every bump against the top of the
band and the floor against the bottom, and separately requires `surface-bump` —
which tiles under *every* face of every die wearing the colorset, including the
severity d10s — to stay wholly inside the band, because one dark pixel there is
a permanent opaque smear repeated across the whole table.

Two smaller consequences of the same material:

- **The body colour has to have light in it.** A transmissive material carries
  its tint through the whole casting rather than painting it on the surface, so
  a near-black background is not a dark glass die, it is a void with an opaque
  figure floating in it. `arcane-surge-check.mjs` refuses an `ink*` token there.
- **Bump and emissive maps both live behind DSN's "realistic lighting"**, which
  Foundry's own Low performance mode turns off. There is no normal map and no
  emissive map at all in that branch, and a die carrying nothing else is twenty
  identical faces — silently. `registerDiceSoNice` reads the merged DSN config
  and, with lighting off, registers the colorset and the frost but *not* the
  face presets, leaving DSN's own internally-generated `du` preset standing:
  that one labels each face from `getResultLabel`, so the die says which faces
  surge in words. Worse-looking than relief, better than blank. Registering ours
  would replace it — `DiceFactory.register` overwrites the standard system's
  entry for a type rather than sitting beside it — so this has to be a decision
  made before registration, not at roll time.

### Emission is not a local cost

The severity d100 has no per-face maps to carry emission (a colorset has no
emissive *map* slot; that belongs to a preset), so its one channel would be
`emissiveLabels: true`, lighting DSN's own numeral canvas. It used to have it.
It does not any more, and the reason is measured rather than aesthetic.

**Any** non-black `emissive` on **any** material in the dice scene switches the
whole canvas onto DSN's bloom path for the length of the throw.
`DiceScene.compositorRender` walks the scene each frame looking for one, and on
finding it renders the scene a *second* time through `bloomComposer` and puts
that through `UnrealBloomPass` — five downsample blurs and five upsample blurs
— before compositing. And because these dice are transmissive, each of those
scene renders drags a `renderTransmissionPass` with it: three.js sizes that
target to the **full viewport**, forces at least **4× MSAA** on it, and
regenerates its **entire mipmap chain**, every frame. So one glowing numeral
roughly doubles the per-frame cost of every die on the table.

The surge d20 pays it, because a glyph that does not glow is not a glyph — and
its preset sets `emissive` directly, which takes precedence over the colorset
anyway. The severity d100 does not need to: its numerals are white, outlined in
`ink0`, on black glass. The check tool holds the *invariant* rather than the
implementation — the colorset must either light its labels **or** sit on a body
below 0.15 relative luminance. Lighten the glass again and it asks for the glow
back.

### The presets have to be warmed

A DSN preset loads nothing when it is registered. Its images are fetched inside
`DiceFactory.create()`, at the first throw, and `loadTextureType` walks the list
with one `await` per entry — for a preset like this one that is sixty serial
round-trips (twenty labels, twenty bumps, twenty emissive maps), times three
level systems, in the middle of an animation.

DSN 6.2.9 added `dice3d.preloadPresets(systemId)` for exactly this case and says
so in its own source: presets a user never selects in their appearance settings
"load lazily on the first roll and cause visible lag". All three of ours are
presets nobody selects. **Not calling it was the lag**, and the check tool now
refuses a registration that does not.

It does not cover everything, and the remainder is worth knowing about.
`createMaterial` still bakes each material's normal map out of the finished
bump atlas the first time it is used, and that is a 2048² Sobel run in
JavaScript on the main thread — **measured at 370–520 ms per material** — once
per level system. That one is DSN's own, shared by every die in the world with
realistic lighting on, and there is no public seam to warm it through. The only
lever on it is registering fewer systems, and the per-level face counts are what
make three of them necessary.

For scale, on the same machine the feature's own full-screen shaders measure
**0.89 ms** (surge) and **0.37 ms** (verdict) per frame at their worst shipping
size — 5120×2880, the supersampler's top rung — and the HUD crack strip 0.010 ms.
The live beats are not where the time goes.

### A d20 face is not centred in its texture tile

DSN lays its faces out as 256px tiles in one atlas and draws a label image
across a whole tile, 1:1. So the square the baker draws **is** a tile — but the
geometry sampling it is a triangle, and the triangle is not concentric with the
square. Read off the `uv` attribute of DSN's own d20 model (`DICE_MODELS.d20`
in `engine/DiceModels.js`), all twenty faces land in their tile identically:

| | |
|---|---|
| apex | (0.5006, 0.0010) |
| base | y = 0.8635, x 0.003 → 0.999 |
| centroid | **(0.5006, 0.5760)** |
| incircle | **r = 0.2875** of the tile |

Apex *up*, because the label texture is bound with `flipY = false`, so v runs
down the canvas the same way a canvas y does.

Two things follow, and the first pass here had both wrong. **The centre of the
face is at y = 0.576, not 0.5** — a triangle's centroid sits a third of its
height up from the base — so art centred on the square is struck an eighth of a
tile toward the apex. And **the largest circle that fits is the incircle**,
0.575 in the ±1 face coordinates the baker works in; anything wider runs off two
of the three edges. The concentric grooves were struck at 0.62 about the
square's centre, which is outside the incircle *and* off the face's own centre,
so every ring on the die was clipped by two of its own edges, twenty times over.

None of this shows in the contact sheet, which prints squares. `--check` scans
the face instead: any pixel carrying a mark must fall inside `FACE_TRIANGLE`.
That is a stronger test than a radius would be — an off-centre mark *within* the
incircle still fails it, which is exactly the half of this defect a radius check
would have missed.

### The glass and the mark are one statement

`DIE_KEYS` in `palette.mjs` names three palette keys — `body`, `edge`, `glyph` —
and neither of the two files that render the die states a colour of its own.

That is not tidiness. **The body and the glyph are only meaningful against each
other, and they are produced in completely different places**: the body reaches
Dice So Nice as a colorset field in `dsn.mjs`, while the glyph is baked into an
emissive PNG by `tools/gen-surge-textures.mjs` and does not exist at runtime at
all. Written separately, they landed on the same colour within one commit — the
die was the feature's `--gl-accent` teal and so was the whirlpool, so the single
thing the die exists to say was invisible, and each half looked entirely correct
in its own file.

**The body is black glass** (`ink1` #080b11). On a transmissive material the
tint is carried through the whole casting rather than painted on the surface, so
this does not render as a black *surface* — it renders as smoked glass, the
frost still catching light and everything behind the die dimmed rather than
coloured. An earlier pass used `apex`, a lit violet, on the reasoning that a
near-black body would come out as a void. That reasoning held only while the die
had nothing else in it; with the glyph emitting and the frost lit, black is the
material the die wanted.

What it costs is the hue axis, and that is the thing to hold on to: **at this
value a hue is not a colour anybody can see**, so the mark can no longer read
against the body by *being* a different hue. It reads by **value** instead —
0.77 of relative luminance between them, blowing to white at the eye. So the
check measures both axes and requires one of them: ≥ 45° of hue **or** ≥ 0.35 of
value. It also requires the glyph to out-value the body, since the glyph is a
light source burning inside it.

And it requires the **edge** to out-value the body by ≥ 0.2. That one is what
black glass made necessary: DSN paints the bevels between the faces with
`DIE_KEYS.edge`, and on a dark die that is the only thing giving the shape a
silhouette against the table. `violet` rather than `violetHot` — on black the
pale one was the loudest thing on the die.

The glyph deliberately stays in the **cool** arcane family rather than going hot.
The severity tiers own amber and red (`TIER_KEYS`: cyan, warn, warnDeep,
hazard), so a surge glyph in `warn` would announce a Major before the severity
has been rolled.

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
