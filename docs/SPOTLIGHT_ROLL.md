# Spotlight Roll

The GM calls for a check and every screen goes cinematic. A glass stele rises,
the roller's own Dice So Nice die hovers in front of it, they throw, it
tumbles in place and lands on the real result, the hidden DC unveils, each
modifier flies into the die while its face counts up, and PF2e's degree lands.
Then PF2e's own chat card is posted.

Feature id `spotlight-roll`, setting prefix `dr.`, PF2e only, needs Dice So
Nice 6.x (and therefore Foundry v14).

## What a request can be

| Layout | Who | DC |
|---|---|---|
| single | one roller | optional; shown / hidden until the reveal / never shown |
| group | 2 to 6 rollers, each throws when ready | one shared DC; a summary line ("3 of 5 succeed") |
| opposed | one roller against a targeted creature | the defender's own statistic DC, read live |

Checks: skills, lores, saves, Perception, flat checks, and free formulas
(d4, d6, d8, d10, d12, d20, d100; up to six dice). Fortune and misfortune roll
two d20s and the dropped one shatters away. A situational bonus rides the roll
as a circumstance modifier. Who sees the result: everyone, the roller and the
GM, or the GM only (blind).

The GM opens a request from the suite's scene-control group ("Spotlight a
roll"), or from a macro:

```js
game.modules.get("gluniverse-foundry-modules").api.features["spotlight-roll"].request({
  layout: "single",
  check: { kind: "skill", slug: "athletics", label: "Athletics" },
  title: "Force the portcullis",
  dc: { value: 24, mode: "hidden" },          // shown | hidden | never
  audience: "all",                            // all | roller | gm
  fortune: "none",                            // none | fortune | misfortune
  bonus: 0,
  rollers: [{ actor, token }],
  defender: null,                             // { actor, statistic: "fortitude" } for opposed
});
```

## How it is put together

```
GM's client (the conductor)          every client (the stage)
  open request ─► dr.active ───────►  mount the stele, build the DSN dice, warm
  probe chips through PF2e            player presses Roll / toggles a chip
                ◄── socket intent ─── (addressed to the GM; server-attested sender)
  roll through PF2e, hold the card
  result ─── socket, recipients ───►  entitled screens: the real throw
  sealed ─── socket, recipients ───►  everyone else: a sealed throw
  post PF2e's card at the degree beat
```

**The GM rolls everything.** Players press Roll; the GM's client makes the roll
through PF2e. That is what lets a hidden DC and a blind result stay on the GM's
client: the world setting `dr.active` reaches every client, so it carries the
request, each slot's chips and when each slot was thrown, and never a result or
a DC players may not see (`request-model.mjs`). Results travel on the suite
socket with `recipients`, which Foundry's server filters, so a player left out
never receives the payload at all. The GM must be online, which a GM-called
request implies.

**Intents are trusted on the server's word.** Foundry v14's server appends the
emitting user's id to every custom socket event it relays. `core/socket.mjs`
hands that to handlers as `meta.attested`; the conductor resolves intents on it
and checks the sender may act on that slot (the GM, or an owner of the actor).

**Everything on screen is a function of time since the throw.** The GM stamps
each throw with a server time (`game.time.serverTime + CUE_LEAD_MS`) and every
client converts it to its own clock, so screens agree on the frame, a late
joiner settles to where things are, and the preview can seek.

## The roll itself (`pf2e-roll.mjs`)

- `Statistic#roll({ skipDialog, createMessage: false, callback })`. The callback
  hands over the exact message data, which is held and posted when the degree
  lands, with `flags.dice-so-nice.skip` (or DSN rolls the die again on the
  board) and the suite's `spotlight` flag (Critical stands down for it).
- Chip toggles cannot be set before a roll: `Modifier#test()` resets `ignored`
  and the stacking rules re-pick the attribute. `Check.roll` is wrapped and, for
  our identifier only, `calculateTotal` is shadowed so the choices are applied
  after PF2e's own pass, the same thing PF2e's dialog does.
- The probe that fills the chips goes down the same path and returns null
  inside the wrapper, before anything is evaluated.
- The degree shown is PF2e's final one (`roll.options.degreeOfSuccess`), which
  already includes degree adjustments such as Juggernaut. The printed rule in
  `core/pf2e-degree.mjs` is only used for free formulas and the preview.
- PF2e 8.4 has no `rollMode` argument; the audience is applied to the held data.
- Hero Point reroll: `Check.rerollFromMessage(message, { resource: "hero-points",
  keep: "new" })`. PF2e deletes the old card and creates the reroll card at once;
  that creation is caught, held, and posted when the reroll's degree lands.

## The dice (`dsn-host.mjs`)

The roller's own DSN dice, built by DSN's factory with the roller's (and the
actor's) appearance inside a `DiceScene` under its own renderer cache key
(`glSpotlight`), never thrown. `tumble.mjs` poses them: two random body axes
spin down to zero at the landing, so the die ends exactly on its face for any
seed, then rocks once or twice and settles. The landed face is relabelled with
the running total, one 256px tile at a time on a cloned material. See the
file's header for why `DiceScene` and not `DiceBox`, why geometry is never
disposed, and the atlas tile maths.

## Smoothness

- The backdrop program is linked and drawn once at 1×1 during idle time after
  ready (`KHR_parallel_shader_compile` where present, polled on a timer, not on
  animation frames, which a background tab starves).
- The dice and their materials are built when a request arrives, before anyone
  can throw; the click shows a charge-up while the GM resolves the throw.
- `SHED_ORDER = ["rays", "backdrop"]`: under load the fragment drops its rays,
  then the WebGL backdrop gives way to the CSS one, which carries every beat.

## Checks and preview

```bash
node tools/spotlight-roll-check.mjs
```

```bash
node tools/spotlight-roll-preview.mjs && node tools/preview-server.mjs
```

Then open `/.preview/spotlight.html`. The preview drives the shipped director,
backdrop, overlay, stylesheet and lang file; only the dice are a three.js
stand-in (`tools/spotlight-roll/die.mjs`). URL parameters: `layout`
(single, group3, group6, opposed), `scenario`, `dc` (shown, hidden, never),
`fortune`, `view` (full, sealed), `render` (webgl, css), `seek`, `stagger`,
`arrive`, `dock=0`, `reroll=1`.

`api.inspect()` reports what this screen's stage is doing in a live session.
