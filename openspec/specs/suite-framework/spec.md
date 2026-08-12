# suite-framework

## Purpose

The core framework that every GLUniverse Suite feature obeys: one installed
package id, feature state isolated by key prefix, a lifecycle that keeps disabled
features completely inert, a single multiplexed socket channel, and one grouped
settings surface. This capability describes the contract between the suite core
(`scripts/core/`) and the 27 feature adapters — not the behaviour of any
individual feature.

## Requirements

### Requirement: All persisted state registers under the single package id

Every setting, document flag, socket channel, and bundled asset path the suite
uses SHALL resolve under the single package id `gluniverse-foundry-modules`
(`SUITE_ID`). Foundry only permits a package to register under its own id, so the
former per-module namespaces collapse onto this one.

#### Scenario: A feature stores a setting

- **WHEN** a feature registers or reads a setting
- **THEN** the namespace is `gluniverse-foundry-modules`, never the feature's own
  id and never the id of the standalone module it was ported from

#### Scenario: A feature stores a document flag

- **WHEN** a feature writes a flag on an actor, item, or chat message
- **THEN** the flag scope is `gluniverse-foundry-modules`

#### Scenario: A feature resolves a bundled asset or template path

- **WHEN** a feature builds a path to one of its own templates or assets
- **THEN** the path resolves under
  `modules/gluniverse-foundry-modules/features/<featureId>/…`, preferably via the
  `featurePath()` helper rather than a hand-written string

### Requirement: Feature state is isolated by key prefix

Because all features share one namespace, collision avoidance is by prefix. Every
setting and flag key a feature writes SHALL carry that feature's assigned prefix,
and each feature MUST declare the prefix or prefixes it owns as `settingPrefix` in
its registration so its configuration is always attributable to it.

#### Scenario: Two features need the same conceptual setting

- **WHEN** two features each store a setting that would naturally be called
  `enabled`
- **THEN** the stored keys differ by their owning feature's prefix (for example
  `ff.enabled` and `dd.enabled`) and neither overwrites the other

#### Scenario: A feature's declared prefix does not cover a key it registered

- **WHEN** `buildCatalog()` encounters a suite setting whose key matches no
  feature's declared `settingPrefix`
- **THEN** the setting is still hidden from Foundry's native sheet, a warning is
  logged, and the setting is unreachable from the Control Center

#### Scenario: A sub-feature claims keys nested inside its parent's prefix

- **WHEN** a promoted sub-feature declares a longer prefix nested inside its
  parent's catch-all prefix (for example `ct.weather` inside `ct.`)
- **THEN** prefix rules resolve longest-first so the sub-feature claims its own
  keys before the parent engine does

### Requirement: A disabled feature is completely inert

A feature that is disabled or unavailable SHALL have no observable effect on the
running client beyond the existence of its settings entries. A feature adapter
MUST NOT register Foundry `Hooks` or open UI at import time.

#### Scenario: A feature module is imported

- **WHEN** `scripts/features/index.mjs` imports a feature adapter
- **THEN** the adapter only calls `Suite.register(...)`, and registers no Foundry
  `Hooks` and opens no UI at import time

#### Scenario: A feature is disabled at init and ready

- **WHEN** a feature's resolved enable state is false
- **THEN** neither its `onInit` nor its `onReady` is called

#### Scenario: A feature is enabled but unavailable

- **WHEN** a feature is toggled on but its required game system or module is
  absent
- **THEN** neither its `onInit` nor its `onReady` is called

### Requirement: Settings exist regardless of enable state

Every feature's `registerSettings` SHALL run at init unconditionally, so a
feature's toggles and editor menus exist even while the feature itself is off.

#### Scenario: Registering settings for a disabled feature

- **WHEN** `Suite.registerAllSettings()` runs at init
- **THEN** every feature's `registerSettings` is called regardless of its enable
  state or availability, so all of its toggles and menus exist

#### Scenario: A feature's settings registration throws

- **WHEN** one feature's `registerSettings` throws
- **THEN** the error is logged against that feature id and the remaining features
  still register their settings

### Requirement: Availability is gated on game system and required modules

A feature whose required game system or companion module is absent SHALL be
treated as unavailable and MUST NOT run, and the suite SHALL be able to state a
localized reason so the feature reads as locked rather than broken.

#### Scenario: The world runs the wrong game system

- **WHEN** a feature declares one or more required system ids and
  `game.system.id` is not among them
- **THEN** the feature is unavailable and its unavailability reason names the
  required system(s)

#### Scenario: A required companion module is missing or inactive

- **WHEN** a feature declares a required module id that is not installed or not
  active
- **THEN** the feature is unavailable and its unavailability reason names that
  module

### Requirement: Sub-features gate on their parent feature

A feature that declares `requiresFeature` SHALL be unavailable while that parent
feature is not enabled, and the roster MUST be rejected at init when those
dependency edges are cyclic or name an unknown feature.

#### Scenario: The parent engine is disabled

- **WHEN** a feature declares `requiresFeature` and that parent feature is not
  enabled
- **THEN** the sub-feature is unavailable and its reason names the parent by its
  localized title

#### Scenario: The dependency graph contains a cycle

- **WHEN** `Suite.validate()` runs at init over a roster whose `requiresFeature`
  edges form a cycle
- **THEN** it throws, naming the feature where the cycle was detected

#### Scenario: A feature requires an unknown feature

- **WHEN** `Suite.validate()` finds a `requiresFeature` id that no registered
  feature provides
- **THEN** it throws, naming both the feature and the unknown dependency

### Requirement: Core features cannot be disabled

A feature declared `core: true` SHALL always resolve as enabled while it is
available, and a request to disable it MUST NOT persist anything.

#### Scenario: Attempting to disable a core feature

- **WHEN** `setEnabled(id, false)` is called for a feature declared `core: true`
- **THEN** nothing is persisted and the feature remains enabled

### Requirement: Setting-backed toggles apply without a reload

Most enable toggles live in a shared config blob and take effect on reload. A
feature that supplies `enableSet` SHALL have its toggle written through to the
underlying world setting so that engine's existing `onChange` side effects still
fire, and such a change SHALL take effect immediately.

#### Scenario: Flipping a setting-backed toggle

- **WHEN** a feature supplying `enableSet` is toggled in the Control Center
- **THEN** the write goes through `enableSet` to the underlying world setting, the
  engine's existing `onChange` side effects run, and the change takes effect
  immediately

#### Scenario: The UI indicates which toggles are live

- **WHEN** the Control Center renders a feature that supplies `enableSet`
- **THEN** that feature reports as applying live, and features backed only by the
  shared config blob do not

#### Scenario: A setting-backed read fails before settings are ready

- **WHEN** a feature's `enableGet` throws because settings are not yet available
- **THEN** the feature's `defaultEnabled` value is used instead of propagating the
  error

### Requirement: One multiplexed socket channel, tagged by feature

A feature MUST NOT call `game.socket` directly. All suite traffic SHALL travel on
one channel with every payload tagged by its owning feature id, and that routing
metadata MUST NOT be treated as authenticated identity.

#### Scenario: A feature emits to other clients

- **WHEN** a feature emits through `emitSocket(featureId, payload)`
- **THEN** the message carries a `__feature` tag and is delivered only to the
  handler registered for that feature id

#### Scenario: A payload collides with routing metadata

- **WHEN** a payload passed to `emitSocket` contains a reserved key
  (`__feature` or `__claimedSender`)
- **THEN** that key is stripped before emit so feature data cannot forge routing
  metadata

#### Scenario: A feature reads the sender id

- **WHEN** a handler receives the claimed sender user id
- **THEN** it is treated as routing and de-duplication metadata only, and never
  used to grant a permission, because raw Foundry module sockets provide no
  server-attested identity

#### Scenario: An inbound payload fails a handler's validator

- **WHEN** a handler was registered with a validator and the validator does not
  return true for a payload
- **THEN** the handler is not invoked

#### Scenario: A socket handler throws or rejects

- **WHEN** a handler throws synchronously or returns a rejecting promise
- **THEN** the error is logged against that feature id and the dispatcher keeps
  running for subsequent messages

#### Scenario: A message arrives for a feature with no handler

- **WHEN** a payload's `__feature` tag matches no registered handler — for
  example because the receiving client has that feature disabled
- **THEN** the message is ignored without error

### Requirement: One feature's failure does not abort the lifecycle

With 27 features sharing one entry point, a failure in one feature's lifecycle
phase SHALL be contained: it MUST be logged against that feature and MUST NOT
prevent the remaining enabled features from running that phase.

#### Scenario: A feature throws during a lifecycle phase

- **WHEN** a feature's `onInit` or `onReady` throws or rejects
- **THEN** the error is logged against that feature id and the remaining enabled
  features still run that phase

#### Scenario: A feature phase is slow

- **WHEN** a feature's lifecycle phase takes longer than 500ms
- **THEN** a warning is logged naming the feature, the phase, and the elapsed time

### Requirement: The Control Center is the only settings surface

Every suite setting SHALL be hidden from Foundry's native Settings sheet and
presented through the suite's own grouped Control Center instead. Hiding a setting
MUST NOT change its stored behaviour.

#### Scenario: Cataloguing settings at init

- **WHEN** `buildCatalog()` runs after all features have registered
- **THEN** every suite setting is recorded against its owning feature and then
  flipped to non-configurable so none appear in Foundry's native Settings sheet

#### Scenario: Reading and writing a catalogued setting

- **WHEN** a setting has been hidden by the catalog
- **THEN** its behaviour is unchanged and it remains fully readable and writable
  through `game.settings.get` / `set` — only its presentation moved

#### Scenario: Reaching the suite from Foundry's own UI

- **WHEN** a user opens Foundry's native module settings
- **THEN** the suite's Feature Manager menu is the single native entry point and
  every other suite menu has been removed from that list

#### Scenario: Suite-level settings that belong to no feature

- **WHEN** a setting belongs to the suite as a whole rather than to any one
  feature
- **THEN** it is collected into a dedicated section the Control Center renders
  pinned above the per-feature list

### Requirement: Feature registration is unique and ordered

Feature ids SHALL be unique across the roster and a registration without an id
MUST be rejected. The order features are presented in SHALL follow adapter import
order rather than any separately maintained list.

#### Scenario: Two adapters claim the same feature id

- **WHEN** `Suite.register` is called with an id that is already registered
- **THEN** the duplicate is ignored and a warning is logged

#### Scenario: An adapter registers without an id

- **WHEN** `Suite.register` is called with a definition that has no id
- **THEN** it is ignored and a warning is logged

#### Scenario: Ordering the Control Center

- **WHEN** the Control Center lists features
- **THEN** the order follows the import order in `scripts/features/index.mjs`,
  with a parent engine's promoted sub-features grouped immediately below it

### Requirement: Migration from the standalone modules runs once and never clobbers

Worlds that used the separate GLUniverse modules hold values under old package ids
that are no longer registered. Those values SHALL be imported once per feature and
MUST NOT overwrite a value already set in the world.

#### Scenario: A legacy setting is present and its suite key is unset

- **WHEN** migration runs and a feature's `legacy.settings` map names an old key
  that exists in storage while the corresponding suite key is still unset
- **THEN** the old value is written to the prefixed suite key

#### Scenario: The GM already set a value

- **WHEN** the corresponding suite key already holds a value
- **THEN** migration leaves it alone

#### Scenario: One feature's migration fails

- **WHEN** a feature's migration throws
- **THEN** the per-feature completion ledger does not mark that feature done, so
  it is retried on a later load instead of being hidden behind a globally
  completed migration

### Requirement: The suite exposes a stable API at ready

Once the `ready` phase has completed, the suite SHALL expose its registry, its
enable-state mirror, and each feature's own declared api on
`game.modules.get(SUITE_ID).api`.

#### Scenario: Another module inspects the suite

- **WHEN** the `ready` lifecycle phase has completed
- **THEN** `game.modules.get("gluniverse-foundry-modules").api` exposes the
  registry, the enable-state mirror, and a map of feature id to that feature's own
  declared api (or null)
