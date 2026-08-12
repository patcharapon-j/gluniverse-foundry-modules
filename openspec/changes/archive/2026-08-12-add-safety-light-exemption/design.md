## Context

See `proposal.md` — Why. Design-relevant current state only:

Stream Pacer's two existing exemptions are world-scoped arrays of user ids, read
**once** in `onReady` into two booleans that decide whether a surface is
constructed at all. Nothing re-reads them; a change applies on that client's next
reload.

The safety surfaces are imperative DOM, not declarative: `SafetyRequestOverlay`
appends elements to `document.body`, drives a `requestAnimationFrame` loop to keep
its arrow glued to a draggable HUD, and toggles a `body.sp-safety-request` class
that `styles/stream-pacer.css:890` uses to dim unrelated pacer surfaces. It also
has an active countermeasure to the bars exemption: `_syncHudPresence()` detects
the absent light control and grows a replacement lamp cluster on the banner.

The GM's safety data reaches the screen by two different paths, which matters
because only one of them looks like "the safety panel":

```
_prepareContext(state)
├── players[]  ──→ pacer-hud.hbs:19  class="… light-{{safetyLight}}
│                                          {{#unless safetyAcknowledged}}awaiting-light{{/unless}}"
│                                    title="… — {{safetyLightTitle}}"
└── safety     ──→ pacer-hud.hbs:1    class="… safety-alert-{{safety.hudAlert}}"
                   pacer-hud.hbs:110  the check-in toggle button
                   pacer-hud.hbs:134  the raised-light board + reset
```

`getSafetyRoster()` walks `game.users` and skips GMs, so the roster leak this
change fixes only exists when the capture login holds *player* rights.

There is no test runner. Every surface here fails silently: a missed gate looks
correct on the developer's own screen and only appears on the recording.

## Goals / Non-Goals

**Goals:**

- Suppress every safety surface on an exempt client with one world-side tick and
  zero configuration on the exempt machine.
- Keep the fix additive: with an empty list, no code path behaves differently.
- Make a missed surface fail loudly at check time rather than silently on stream.

**Non-Goals:**

- Runtime application of the exemption. Tearing down these overlays live (rAF
  loop, body class, appended nodes) is a materially larger change than the
  behaviour it would buy, and the two sibling exemptions have the same
  reload boundary. Consistency wins.
- Any CSS change. Gating is by non-construction, so no token, keyframe, or
  class-prefix rule is engaged.
- Reworking how safety state is synchronised. Exempt clients keep receiving
  socket traffic; they simply render nothing from it.

## Decisions

### One list, one meaning: "no safety surface at all"

A single boolean per user rather than separate knobs for the player ask and the GM
alert.

*Why:* the target is one capture login, and the failure mode is a leak. Every
additional knob is another way to half-cover the account and believe it is
covered. The user's requirement was "hide all".

*Alternative considered:* two columns (hide-ask / hide-alert). Rejected — no
scenario was identified that wants one without the other, and it doubles the
surface the guard tool must reason about.

### Two questions, one setting, deliberately different liveness

The setting answers two questions that must not share an implementation:

| Question | Asked by | Liveness | Why |
|---|---|---|---|
| "am **I** exempt?" | the exempt client, about itself | snapshot at `onReady` | Decides whether surfaces are ever constructed. Matches both sibling exemptions. |
| "is **user X** exempt?" | a GM client, about someone else | read per call | A GM connected *before* the setting changed would otherwise keep counting the puppet forever, with no reload of its own to fix it. |

So a small `isSafetyExempt(userId)` helper exported from `settings.js`, called
once in `module.js` for the local snapshot and per-user inside
`getSafetyRoster()`.

*Cost of the per-call read:* `game.settings.get` is an in-memory map lookup and
the roster is table-sized, against a board that already rebuilds on every manager
notification (including each countdown tick) behind a signature check. Not worth
caching, and a cache is exactly what would reintroduce the staleness.

### Gate by not constructing, never by hiding

Do not add a `body.sp-safety-exempt` class with CSS overrides.

*Why:* non-construction makes two leaks disappear for free — the
`body.sp-safety-request` class is never toggled (so unrelated pacer surfaces never
dim, which is itself a tell that a check-in is running), and the fallback lamp
cluster is never grown. CSS hiding would leave the rAF anchor loop running and the
body class flipping, and a display-toggled node can still be caught mid-frame by a
capture pipeline.

### The GM roster chip needs an explicit template guard, not absent data

Dropping `safetyLight` / `safetyAcknowledged` from the per-player context makes the
leak **worse**, not better: `pacer-hud.hbs:19` emits `light-{{safetyLight}}`
unconditionally under `../isGM`, so an absent value yields a bare `light-` class,
and `{{#unless safetyAcknowledged}}` on an absent value *adds* `awaiting-light` to
every player row.

So: carry an explicit flag in the HUD context and guard that template branch on
it, in addition to omitting the values. This is the single most likely thing to be
half-fixed, because it does not live in anything called "safety".

### Suppress the chime by gating the subscription, not the AudioManager

Gate the `PacerManager.onSafetyLight(...)` hookup in `module.js` rather than
touching `AudioManager`. The manager stays intact for the hand-raise chime, which
is out of scope, and there is no new interaction between two audio paths.

This is also why the exemption — not the existing client-scoped
`sp.safetyAudioEnabled` — owns the cue: see `proposal.md`.

### `_prepareSafetyContext()` returns an inert context when locally exempt

Return the shape the template already handles for "nothing to show" (no
`hudAlert`, `show` false, `requested` false) rather than making the template
tolerate a missing `safety` object. Keeps every existing `{{#if}}` valid and means
the container class, the toggle button and the board all fall away from one
change.

### A grep-grade guard tool, honestly scoped

`tools/stream-pacer-safety-check.mjs` asserts the contract points that fail
silently:

1. The four places that must agree on the exemption prefixes — the settings
   registration, the save handler's `startsWith` branches, the form context, and
   the template's `name=` attributes. A column added later without a matching
   save branch stores nothing, silently.
2. Every known safety surface construction site in `module.js` sits inside the
   safety-exemption gate — an enumerated list, so adding a surface without gating
   it fails the check.
3. The template's safety branches (container class, roster chip, toggle button,
   board) are each guarded.
4. Every i18n key the new column references resolves in
   `lang/stream-pacer.en.json`.

*What it cannot do:* prove the rendered result. It is a source-shape check, not a
semantic one. The only real verification is a session with the capture login
signed in, which the tasks call out separately.

## Risks / Trade-offs

- **A real person is exempted and silently loses their only distress channel.**
  → The hint states it plainly (spec requires this). Default is empty. Weak but
  real backstop: the roster exclusion makes the mistake *visible* — the GM's total
  drops by one, so a human who vanishes from the board is noticeable in a way a
  merely-silent client would not be.
- **A surface is missed and only surfaces on the recording.** → The guard tool
  enumerates surfaces rather than pattern-matching for the word "safety"; the
  roster chip is called out explicitly above because it is the one that does not
  read as a safety surface. Plus a manual pass with the capture login.
- **Snapshot-at-`onReady` surprises a GM who expects an immediate effect.** →
  Consistent with both siblings; the hint says a reload is needed. Accepted rather
  than mitigated.
- **Exempt client's own light still reaches GM clients.** → Suppressing
  `announceSafetyLight()` on an exempt client removes the common path, but a
  co-GM's earlier broadcast can still leave an entry in the lights map. The roster
  filter is the authoritative gate, so this is cosmetic: at worst the HUD's render
  signature changes and the board re-renders identically. Not worth a second
  filter.
- **Roster exclusion changes an existing GM-visible readout.** → Only ever when
  the list is non-empty, which no existing world has. Empty-list behaviour is
  bit-identical to today.

## Migration Plan

No data migration. `sp.safetyExemptUsers` registers with `default: []`, so every
existing world is unchanged until a GM ticks a box.

Deliberately **not** added to `index.mjs`'s `legacy.settings` map: that map imports
from the pre-suite standalone module and the safety tool post-dates the port —
which is why `sp.safetyAudioEnabled` is absent from it too. A key with no
standalone ancestor has nothing to import (`migration.mjs:91` would skip it
anyway).

Rollback is reverting the commit; the orphaned setting is inert and unread.
