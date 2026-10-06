# Combat Intro

A cinematic, full-screen start to a PF2e encounter. The GM presses **Cinematic
start** in the initiative rail's header; every client plays the same sequence:

1. **intro** (timed) — party versus hostiles, the encounter title, the threat.
2. **rolling** (waits for people) — each PC's card with the owner's own Dice So
   Nice die, a statistic picker and modifier chips; NPCs answer in one GM
   volley, grouped by kind, their totals sealed.
3. **sorting** (timed) — the GM commits every value in one batch, the cards
   travel into PF2e's own order (`combat.turns`).
4. **handoff** (timed) — the cards collapse into the rail, which plays its
   arrival, and the GM calls `combat.startCombat()`.

Feature id `combat-intro`, setting prefix `ci.`, i18n namespace `GLCI.*`. It
requires the `initiative` feature, PF2e and Dice So Nice 6.x. The skin is the
initiative feature's world setting `init.skin` (`etched` | `aegis`); both the
cinematic and the tracker follow it. See docs/adr/0001-scoped-skins.md.

## Contracts

These are the seams between the files. Everything below fails silently when
two sides disagree, and `tools/combat-intro-check.mjs` pins each one.

### One timeline

`scripts/features/combat-intro/timeline.mjs` is the only statement of when
anything happens. Skins change how a beat looks, never when it lands. Every
phase is a function of `serverNow - state.at`.

### Public state

`ci.state`, a flag on the Combat, read only through `normalizeState`
(`state-model.mjs`). It never holds a total, a natural, a degree, an NPC's
modifiers or a hidden combatant. Results travel on the suite socket with
`recipients`: full to `entitled` users (GMs; everyone for a PC), sealed to the
rest. Intents are honoured only on `meta.attested` and `mayAct`.

### Pure modules

`constants.mjs`, `timeline.mjs`, `state-model.mjs`, `director.mjs`,
`overlay.mjs`, `backdrop.mjs`, `sound.mjs` and everything under `skins/` hold no
reference to `game`, `canvas`, `foundry`, `ui` or `Hooks`. The preview page
and the check tool import them directly. `main.mjs` and `pf2e-init.mjs` are
the only Foundry/PF2e glue.

### Director (director.mjs)

```js
const director = new Director({
  root, layers: { bg, cssbg, back, dice, front, gm },
  overlay,            // default export of overlay.mjs
  dice,               // DsnDiceHost from spotlight-roll/dsn-host.mjs (or the preview stand-in)
  backdrop,           // Backdrop from backdrop.mjs, or null (CSS only)
  skin,               // a skin module (skins/etched.mjs | skins/aegis.mjs)
  ladder,             // Budget.ladder(...) or null
  i18n: { t, f },
  palette,            // () => { accent, hot, ink, warn } sRGB 0..1, read from the skinned root
  motion,             // motion scale
  sound,              // { cue(name) } from sound.mjs, or null
  now,                // () => performance.now()
  serverNow,          // () => game.time.serverTime (preview: a fake clock)
  viewer,             // { userId, isGM, role: "gm" | "player" | "spectator" }
  mayAct,             // (slot) => boolean
  onIntent,           // ({ op: "stat"|"toggle"|"throw", slotId, ... }) => void
  onGm,               // (action: "rest"|"skip"|"cancel"|"rollFor", { slotId? }) => void
  railRect,           // () => DOMRect-like of the rail, or null (handoff target)
});
await director.mount(state);          // builds DOM for state.skin, creates every die
director.setState(state, { totals }); // new flag value; totals: Map<slotId, number> once committed
director.applyResult(result, localAt);// a normalized result (full or sealed), cue at localAt
director.frame({ width, height, dpr });
director.handoffRects();              // [{ combatantId, rect: { left, top, width, height } }]
director.destroy();
```

PC slots get one d20 with `appearanceUserId`'s Dice So Nice appearance. NPC
slots get one small d20 each. A sealed result lands on a meaningless face.

### DOM skeleton (overlay.mjs)

Both skins style the same markup. Class names are a contract with
`styles/combat-intro.css` (base + etched) and `styles/combat-intro-aegis.css`
(everything under `.glci[data-skin="aegis"]`).

```
.glci[data-skin][data-phase][data-render="webgl|css"][data-role="gm|player|spectator"]
  canvas.glci-bg   .glci-cssbg   .glci-back   .glci-dice   .glci-front   .glci-gm
  .glci-intro
    .glci-intro-eyebrow  .glci-intro-title  .glci-intro-versus  .glci-intro-motto
    .glci-roster > .glci-roster-side[data-side="party|hostiles"] > .glci-roster-item (img, .glci-roster-name, .glci-roster-count)
    .glci-threat[data-severity]
  .glci-table
    .glci-party > .glci-card[data-slot][data-state="waiting|thrown|landed"][data-may-act="0|1"]
      .glci-card-art > img   .glci-card-die (die anchor)   .glci-card-name   .glci-card-total
      .glci-stats > .glci-chip[data-stat][aria-pressed]  details.glci-more > .glci-chip[data-stat]
      .glci-mods > .glci-chip[data-mod][aria-pressed]
      button.glci-roll[data-action="throw"]   button.glci-rollfor[data-gm="rollFor"]
    .glci-hostiles > .glci-volley[data-group]
      .glci-volley-art > img  .glci-volley-name  .glci-volley-count
      .glci-volley-dice > .glci-mini-die[data-slot][data-state]
  .glci-sort > .glci-rank[data-slot] (.glci-rank-n, .glci-rank-total)
  .glci-gm > button.glci-gm-btn[data-gm="rest|skip|cancel"]
```

### Backdrop prelude and skins

`backdrop.mjs` owns one WebGL2 full-screen pass. Its PRELUDE declares:

```glsl
uniform vec2  uRes;        // drawing-buffer px
uniform float uTime;       // seconds, wraps every 64 s (whole turns only)
uniform float uPhase;      // 0 intro, 1 rolling, 2 sorting, 3 handoff
uniform float uBeat;       // beat index inside the timed phase
uniform float uBeatT;      // 0..1 inside that beat
uniform float uPhaseT;     // 0..1 inside a timed phase (rolling: 0)
uniform vec4  uAnchors[12];// xy = centre (drawing-buffer px, origin top-left), z = size px, w = 0 wait / 1 thrown / 2 landed
uniform float uAnchorN;
uniform vec3  uAccent; uniform vec3 uHot; uniform vec3 uInk; uniform vec3 uWarn;
uniform float uShed;       // shed level from the Budget ladder
uniform float uIntensity;  // 0..1 master fade of the whole backdrop
out vec4 outColor;
```

A skin module's default export:

```js
export default {
  id: "aegis",
  fragment,          // GLSL ES 3.00 appended after PRELUDE; defines void main() writing outColor
  uniforms,          // [{ name, type: "float"|"vec2"|"vec3"|"vec4", count? }] the skin's own
  write(u, f),       // f = { phase, beat, beatName, beatT, phaseT, time, dpr, width, height, anchors,
                     //       anchorFx (48 floats: s since throw, s since land, sealed), severity (0..4 | -1),
                     //       curves, allows(name), palette } → set its uniforms on u
  SHED_ORDER,        // names this skin can shed, most expensive first
  sounds,            // { [cue]: "assets/combat-intro/<skin>/<file>" } relative to the module root; main.mjs prefixes modules/<id>/
};
```

Every uniform a skin declares must be written by `write`, and every one it
writes must be declared. A shader that fails to compile drops the sequence to
CSS (`data-render="css"`) rather than erroring.

### Backdrop

`new Backdrop(canvas)`, `await compile(skin)` (polls a timer, never animation
frames: a background tab starves rAF), `ok`, `report`, `release()`,
`await restore(freshCanvas)`, `resize(w, h, dpr)`, `frame(uniforms)`.
`programUniforms(skin)` lists every uniform the linked program uses.

### The rail

The initiative feature owns the skin (`init.skin`) and never imports this one.
Its header asks `api.features["combat-intro"].canStart(combat)` and calls
`start(combat)`; it re-renders on `gluniverse.combatIntro.ready`. At the end of
the handoff every client raises `gluniverse.combatIntro.handoff` with
`{ combatId, late, cards: [{ combatantId, rect }] }`; the rail holds it for 6 s
and, on the `started` update, plays its arrival from those rects instead of the
round splash.

## PF2e

Initiative rolls through a fresh `ActorInitiative` built from
`actor.initiative.constructor` with the slot's statistic, so the `initiative`
domain (Scout, Incredible Initiative) applies. Its `statistic.roll()` is called
with `createMessage: false`; `ActorInitiative#roll` is never used, because it
writes the tracker at once. Modifier toggles ride Spotlight Roll's `Check.roll`
wrapper through `pendCheck` (libWrapper allows one wrapper per package per
target). The values are committed in one `setMultipleInitiatives` call when the
last die has landed; PF2e's held cards post then (an NPC's whispered to the GMs,
a hidden one blind). The sort plays `combat.turns` read back afterwards, so
PF2e's tie-break and boss extra turns decide the order. GM-hidden combatants
never get a card: they are rolled silently with their sheet's statistic at the
commit.

## Checking it

```bash
node tools/combat-intro-check.mjs
```

```bash
node tools/combat-intro-preview.mjs && node tools/preview-server.mjs
```

Then open `/.preview/combat-intro.html` (params `skin`, `phase`, `seek`,
`view`, `render`, `late`, `threat`; `window.__ciSeek(phase, ms)`).
`node tools/combat-intro-aegis-sheet.mjs` renders the Aegis beats to a contact
sheet, and `node tools/gen-combat-intro-sounds.mjs --check` confirms the
generated Etched cue set.
