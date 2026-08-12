# stream-pacer-safety-lights

## Purpose

The traffic-light safety tool inside Stream Pacer: each player carries a standing
green/yellow/red light, the GM can open a table-wide check-in that asks everyone
to set it, and a raised light is surfaced to the GM until it is lowered. This
capability also defines which users are exempt from every part of that surface, so
a Foundry login whose screen is captured for a stream never broadcasts the table's
private safety signals.

## Requirements

### Requirement: Every player carries a standing safety light

Each non-GM user SHALL have a safety light with exactly one of three values —
green, yellow, red — defaulting to green. The light is a standing signal, not a
reply: it persists after a check-in closes and is only changed by its owner or by
a GM-initiated reset. The light SHALL be session-only and never written to
persistent world data, because it is private table state that must not survive as
a record.

#### Scenario: A player has never touched their light

- **WHEN** the GM's board is rendered for a player who has set nothing
- **THEN** that player reads as green

#### Scenario: A player raises their light

- **WHEN** a player selects yellow or red
- **THEN** every GM client shows that player at the selected colour, and the
  colour remains after any open check-in closes

#### Scenario: A player attempts to set someone else's light

- **WHEN** a client tries to broadcast a light for a user other than itself
- **THEN** the change is rejected and nothing is broadcast

#### Scenario: The world is reloaded

- **WHEN** every client reconnects
- **THEN** no light is restored from persisted data; the GM's board is rebuilt
  only from what the still-connected players re-announce

### Requirement: The GM can open a table-wide check-in

A GM SHALL be able to open and close a check-in that asks every non-exempt player
to set their light, and SHALL be able to see how many have answered. Opening a
check-in SHALL NOT change anyone's light.

#### Scenario: The GM opens a check-in

- **WHEN** the GM activates the check-in control
- **THEN** every non-exempt player client shows an on-screen ask with a way to
  answer it, and no light value changes

#### Scenario: A player answers

- **WHEN** a player sets their light while a check-in is open — including
  re-selecting the colour they already had
- **THEN** they count as having answered, and the GM's answered-of-total readout
  advances

#### Scenario: The GM closes the check-in

- **WHEN** the GM deactivates the check-in control
- **THEN** the ask disappears from every player client and every light is left
  exactly as it stands

#### Scenario: The last GM disconnects while a check-in is open

- **WHEN** no GM remains connected
- **THEN** the ask closes on every client, so no player is left facing a question
  nobody can receive, and no light is changed

### Requirement: A raised light is surfaced to the GM until lowered

A light that is not green SHALL remain visible to every GM client independently of
whether a check-in is open, and a red light SHALL be escalated more prominently
than a yellow one. This surfacing SHALL NOT depend on the GM looking at any
particular panel.

#### Scenario: A player goes yellow with no check-in open

- **WHEN** a player raises yellow while no check-in is running
- **THEN** the GM is alerted and the player remains listed as raised until the
  light is lowered or reset

#### Scenario: A player goes red

- **WHEN** a player raises red
- **THEN** the GM's alert escalates beyond the yellow presentation and an audible
  cue is played on GM clients that have the safety cue enabled

#### Scenario: A GM joins or reloads mid-session

- **WHEN** a GM client connects and no other GM is already connected
- **THEN** any check-in orphaned by the previous GM client is closed, connected
  players re-announce their lights, and the GM's board reflects every raised
  light without any player action

### Requirement: The GM can reset every light to green

A GM SHALL be able to clear all lights back to green in one deliberate action,
confirmed before it takes effect. No automatic event — including a scene change or
a reset of the pacing state — SHALL clear a raised light.

#### Scenario: The GM resets the lights

- **WHEN** the GM confirms the safety-light reset
- **THEN** every light returns to green on every client

#### Scenario: The scene changes while a light is raised

- **WHEN** the active scene changes and pacing state is auto-reset
- **THEN** raised safety lights are untouched

### Requirement: Named users can be exempt from the safety-light surface

The GM SHALL be able to name users who see no part of the traffic-light safety
tool. The exemption SHALL be stored world-side, SHALL be empty by default, and
SHALL be independent of the existing pacing-bar and Dire Peril exemptions, so any
combination of the three is expressible.

This reverses the tool's previous guarantee that a check-in reaches every
connected player. That guarantee is replaced by: a check-in reaches every
connected player who is not explicitly exempt. The exemption exists for capture
and overlay logins, which are puppets rather than participants; exempting a real
person removes their only channel for signalling distress, and the configuration
surface SHALL say so.

#### Scenario: A user is exempted from safety lights only

- **WHEN** a user is marked safety-exempt but not bar-exempt or peril-exempt
- **THEN** that client still shows the pacing bars and the Dire Peril reveal, and
  shows no safety-light surface

#### Scenario: A user is exempted from the bars only

- **WHEN** a user is marked bar-exempt but not safety-exempt
- **THEN** that client still receives check-ins and still has a way to answer one,
  even though it has no pacing HUD to host the controls

#### Scenario: No user is exempted

- **WHEN** the safety exemption list is empty, as it is on any world that has not
  been configured
- **THEN** every client behaves exactly as it did before this capability existed

#### Scenario: The GM reads the configuration surface

- **WHEN** the GM opens the exemption settings
- **THEN** the safety column is described as being for capture or overlay logins,
  and states that exempting a person removes their means of signalling distress

### Requirement: A safety-exempt client shows no safety-light surface at any permission level

On a client whose user is safety-exempt, no traffic-light surface SHALL be
presented, and this SHALL hold whether that user has player or GM permissions — a
capture login is sometimes given GM rights so it can see the whole board. The
surfaces covered SHALL include, without exception: the player's own light
controls; the on-screen check-in ask and any fallback controls it would otherwise
grow when no light control is present; any dimming or visual change to unrelated
Stream Pacer surfaces that would signal a check-in is running; the GM-facing
raised-light alert and its escalated full-viewport treatment; the GM's
raised-light board and answered-of-total readout; the GM's check-in and reset
controls; the per-player safety colouring and wording carried on the GM's general
player roster; and the audible escalation cue.

#### Scenario: A safety-exempt player client during a check-in

- **WHEN** a check-in is open and a safety-exempt player client is connected
- **THEN** nothing on that screen indicates a check-in is running, and no
  unrelated Stream Pacer surface changes appearance

#### Scenario: A safety-exempt GM client while a light is red

- **WHEN** a player raises red and a safety-exempt GM client is connected
- **THEN** that client shows no alert, no escalated viewport treatment, no
  raised-light board, and no safety colouring on any player row, and plays no cue

#### Scenario: A safety-exempt GM client's own controls

- **WHEN** a safety-exempt GM client is connected
- **THEN** it offers no check-in control and no light-reset control, so its screen
  never reveals a check-in by the state of a button

#### Scenario: A non-exempt GM client is connected at the same time

- **WHEN** a light is raised while both an exempt and a non-exempt GM client are
  connected
- **THEN** the non-exempt GM sees the full alert, board, roster colouring and cue,
  unaffected by the other client's exemption

### Requirement: A safety-exempt user is excluded from the GM's safety roster

A safety-exempt user SHALL NOT appear in the GM-facing safety roster, SHALL NOT
count toward the total or answered-of-total readout, and SHALL NOT appear as
awaiting an answer. Without this, a capture login would sit permanently unanswered
and no check-in could ever read as complete.

#### Scenario: A check-in with one exempt login connected

- **WHEN** four participating players and one safety-exempt login are connected,
  and all four players answer
- **THEN** the GM's readout reads four of four and reports nobody outstanding

#### Scenario: An exempt login's light is broadcast anyway

- **WHEN** a safety-exempt client's light value reaches a GM client through the
  session's light synchronisation
- **THEN** that user is still absent from the roster, the board, and every tally

#### Scenario: A user's exemption is removed

- **WHEN** the GM un-marks a user as safety-exempt
- **THEN** that user reappears in the roster and counts toward the totals again on
  the GM's next board update, without the GM reloading

### Requirement: Safety exemption requires no configuration on the exempt client

Because the exempt client is typically an unattended capture login, marking a user
safety-exempt SHALL be sufficient on its own. No setting stored per-client SHALL
have to be changed on the exempt machine for any covered surface — including the
audible cue — to be suppressed.

#### Scenario: A capture login is exempted from the GM's own seat

- **WHEN** the GM marks the capture login safety-exempt without signing in as it
- **THEN** every covered surface on that login is suppressed, including the
  audible cue, once the exemption is in effect on that client

#### Scenario: The exemption is applied to a connected client

- **WHEN** a user is marked safety-exempt while that client is already connected
- **THEN** the exemption takes effect on that client's next reload, consistent
  with the existing pacing-bar and Dire Peril exemptions
