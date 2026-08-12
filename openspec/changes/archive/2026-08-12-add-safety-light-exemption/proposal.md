## Why

Stream Pacer already lets a GM hide the pacing bars and the Dire Peril splash from
named users, because a table usually runs a dedicated Foundry login whose view is
captured by OBS. The traffic-light safety tool has no such exemption — it was
deliberately built to defeat one. `onReady` initializes `SafetyRequestOverlay`
outside the bars exemption on the stated grounds that "a safety ask must reach
every active player", and `SafetyRequestOverlay._syncHudPresence()` reacts to a
missing HUD by *growing its own lamp cluster* on the banner. The result is that
the capture account — the one client that must never show it — gets the loudest
version of the safety UI, and every safety check-in is broadcast to the audience.

The same account also skews the GM's own board: `getSafetyRoster()` counts every
active non-GM user, so a puppet login sits in `pending` forever and the GM's
response readout can never reach `n / n`.

## What Changes

- Add a third world-scoped exemption list, `sp.safetyExemptUsers`, alongside
  `sp.exemptUsers` and `sp.perilExemptUsers`.
- Add a third checkbox column ("Hide Safety Lights") to the existing
  `ExemptUsersConfig` form, so all three exemptions stay one GM-side dialog.
- A safety-exempt client renders none of the traffic-light surfaces, whether that
  client holds player or GM permissions — the capture account sometimes has GM
  rights, so player-only gating would leave the red viewport vignette and the
  raised-light board on stream.
- A safety-exempt user is excluded from the GM-facing safety roster, so they no
  longer inflate `total` or sit permanently in `pending`.
- The escalation chime is covered by the exemption, not left to the existing
  client-scoped `sp.safetyAudioEnabled`. The point of a world-scoped exempt list
  is that the GM configures it from their own seat; a surface that still needs a
  per-client tick defeats that and puts the tone into the stream's audio capture
  until someone remembers to log in as the puppet.
- Reverse the "a safety ask reaches every player" invariant to "unless that user
  is explicitly safety-exempt", and update the code comment and the settings hint
  that currently promise the opposite. Opt-in and empty by default, so no
  existing world changes behaviour.
- Add `tools/stream-pacer-safety-check.mjs`: assert that every safety surface is
  gated. Each surface here fails *silently* — a missed gate looks fine on the
  GM's screen and only shows up on the recording.

Not in scope: any exemption for the hand-raise chime or sidebar, changing when
exemptions take effect (all three remain snapshotted at `onReady`, so a change
applies on that client's next reload), and any ability for an exempt user to
still signal — a capture login is a puppet, not a person.

## Capabilities

### New Capabilities

- `stream-pacer-safety-lights`: The traffic-light safety tool — the player's
  standing light, the GM's table-wide check-in request, the GM-facing alert
  surfaces, and which users are exempt from all of it. Flat path to match the
  project's existing single-level spec layout.

### Modified Capabilities

<!-- None. No existing spec covers Stream Pacer; `suite-framework` describes the
     core adapter contract and is unaffected. -->

## Impact

Code, all under `scripts/features/stream-pacer/` unless noted:

- `settings.js` — register `sp.safetyExemptUsers`; extend `saveExemptUsers()` and
  `ExemptUsersConfig._prepareContext()`; export an `isSafetyExempt(userId)` helper.
- `module.js` — snapshot the local exemption; gate `SafetyRequestOverlay`,
  `SafetyLightPanel`, `SafetyAlertOverlay` and the `onSafetyLight` chime hookup.
- `PacerManager.js` — exclude exempt users in `getSafetyRoster()`; return early
  from `announceSafetyLight()` when the local user is exempt.
- `PacerHUD.js` — return an inert safety context from `_prepareSafetyContext()`
  and drop the per-player `safetyLight` fields when locally exempt.
- `index.mjs` — no change. The `legacy.settings` map imports values from the
  pre-suite standalone module, and the safety tool post-dates that port (which is
  why `sp.safetyAudioEnabled` is absent from the map too). A new key with no
  standalone ancestor has nothing to import.
- `templates/stream-pacer/exempt-users.hbs` — third column.
- `templates/stream-pacer/pacer-hud.hbs` — the GM roster chip carries
  `light-<colour>` / `awaiting-light` and names the colour in its `title`; both
  must fall away when locally exempt.
- `lang/stream-pacer.en.json` — new keys; rewrite `ExemptUsersHint` for three
  columns.
- `tools/stream-pacer-safety-check.mjs` — new guard.
- `docs/` — no binding doc covers Stream Pacer; nothing to update.

No CSS changes: every surface is gated by not constructing it, so no token,
keyframe, or class-prefix rules are engaged. No new settings appear on Foundry's
native sheet (`config: false`, reached through the existing registered menu).
