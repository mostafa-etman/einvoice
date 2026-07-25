# Feature Specification: Tenant Settings

**Feature Branch**: `003-tenant-settings`

**Created**: 2026-07-20

**Status**: Clarified

**Input**: User description: "Feature: Tenant settings. Multi-branch management (CRUD, per-branch data like ETA branch/activity codes). Multi-currency: currency list + exchange rates (manual + optional provider), default currency per tenant/branch. ETA credentials: store per tenant (and optionally per branch) ClientId/ClientSecret ENCRYPTED at rest; store taxpayer registration number and activity code; support intermediary onbehalfof. Item codes module: manage product/service codes (EGS/GS1) locally, ready to sync with ETA code APIs. Frontend: settings screens for branches, currencies, ETA credentials (with a Test Connection placeholder), and item codes."

## Clarifications

### Session 2026-07-20

- Q: How MUST ETA Client Secrets (and equivalent secrets) be encrypted at rest, and where does the master key live? → A: libsodium sealed boxes; master key from env/KMS; never log secrets
- Q: How are secrets presented in the UI after save, and can operators replace them? → A: Show secrets masked in UI; allow rotate
- Q: What is in-scope for exchange rates in this feature vs later? → A: Manual rates now; provider adapter interface for later
- Q: Which item code types MUST the catalog support? → A: EGS and GS1 only

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Manage branches for the organization (Priority: P1)

An Owner or Admin opens Settings → Branches and creates, updates, or deactivates
branches for their tenant. Each branch can store ETA-related branch attributes
such as branch identity and activity code used later for invoicing. At least one
default/main branch remains available for operations.

**Why this priority**: Branches are the operational unit for multi-location
taxpayers; credentials, currency defaults, and later documents hang off branch
context. Without branch CRUD, other settings cannot be applied correctly.

**Independent Test**: As Owner in a tenant with a default branch, create a second
branch with ETA branch/activity fields, edit it, set/unset default, and verify
the branch switcher lists only active branches for that tenant.

**Acceptance Scenarios**:

1. **Given** an authenticated Owner/Admin in a tenant, **When** they create a
   branch with a name and optional ETA branch/activity fields, **Then** the
   branch is saved for that tenant only and appears in the branch list and
   switcher.
2. **Given** an existing branch, **When** they update its name or ETA branch
   attributes, **Then** changes persist and are visible on reload.
3. **Given** multiple branches, **When** they mark one as the default branch,
   **Then** exactly one default branch exists for the tenant and the previous
   default is cleared.
4. **Given** a non-default branch that is not required by other open work,
   **When** they deactivate or delete it per product rules, **Then** it no
   longer appears as selectable for new work, and the default branch cannot be
   removed while it is the only active branch.
5. **Given** a user without branch-manage permission, **When** they attempt to
   create or change branches, **Then** the action is denied.

---

### User Story 2 - Configure currencies and exchange rates (Priority: P1)

An Owner or Admin maintains the tenant’s currency list, sets a tenant default
currency (and optionally a per-branch default), and enters exchange rates
**manually**. A defined **provider adapter interface** exists so a future
external rate provider can plug in without redesigning the rate model; this
feature does not ship a live provider implementation. Users can see which
manual rate applies for a currency pair and effective date.

**Why this priority**: Multi-currency is required before invoicing in mixed
currency environments common to Egyptian exporters/importers.

**Independent Test**: Enable EGP as tenant default and USD as additional
currency; add a manual EGP↔USD rate; set a branch to prefer USD; verify lists
and defaults in Settings and that unauthorized users cannot change rates.

**Acceptance Scenarios**:

1. **Given** a tenant, **When** an authorized user adds a currency from a
   standard catalog (e.g. EGP, USD, EUR), **Then** it appears in the tenant
   currency list without duplicating the same code.
2. **Given** multiple currencies, **When** they set the tenant default
   currency, **Then** that currency is used as the fallback when a branch has
   no override.
3. **Given** a branch, **When** they set a branch default currency, **Then**
   that branch uses its default for new documents/settings display while other
   branches keep theirs or the tenant default.
4. **Given** two currencies on the tenant, **When** they enter a manual
   exchange rate with an effective date (and optional expiry), **Then** the
   rate is stored with source “manual” and returned when asking for that pair
   on that date.
5. **Given** the rate-provider extension point, **When** an implementer later
   adds a provider adapter, **Then** they can supply rates through the same
   retrieval contract without changing the manual-rate UX of this feature;
   in this feature the UI may show provider sync as unavailable/future-only.
6. **Given** a user without currency-manage permission, **When** they attempt
   to change currencies or rates, **Then** the action is denied.

---

### User Story 3 - Store ETA credentials securely (Priority: P1)

An Owner or Admin configures ETA API Client ID and Client Secret for the tenant
(and optionally overrides per branch). Client Secrets are encrypted at rest
using **libsodium sealed boxes**, with the **master key supplied from
environment or KMS**—never derived from user passwords. Secrets MUST **never
appear in logs**. After save, the UI shows the secret **masked**; operators can
**rotate** the secret via an explicit rotate/replace control. They also store
taxpayer registration number, activity code, and intermediary “on behalf of”
identity. A “Test Connection” control is a non-live placeholder.

**Why this priority**: Constitution requires encrypted ETA credentials; without
them, later document submission cannot proceed. Security of secrets is
release-blocking.

**Independent Test**: Save tenant credentials and registration fields; confirm
secret is masked on read and absent from logs; rotate the secret and confirm
the new value is stored encrypted and still masked; optionally save a branch
override; run “Test Connection” placeholder; verify audit of credential changes
without logging secret values.

**Acceptance Scenarios**:

1. **Given** an authorized user, **When** they save tenant ETA Client ID and
   Client Secret plus registration number and activity code, **Then** the data
   is stored for the tenant, the Client Secret is sealed with libsodium using
   the configured master key, and subsequent reads show a masked secret (never
   the full plaintext).
2. **Given** a saved Client Secret, **When** the user chooses Rotate/Replace
   and submits a new secret, **Then** the previous ciphertext is replaced, the
   UI continues to show a mask, and an audit event records rotation without
   secret values.
3. **Given** tenant-level credentials exist, **When** they save optional
   branch-level Client ID/Secret or registration overrides, **Then** branch
   settings take precedence for that branch and other branches continue to use
   tenant defaults.
4. **Given** intermediary mode is enabled, **When** they supply the required
   on-behalf-of taxpayer identity fields, **Then** those fields are stored and
   visible (non-secret) on the settings screen.
5. **Given** saved credentials, **When** they click “Test Connection”, **Then**
   the system runs the placeholder flow (validates that required fields are
   present and returns a clear “not live / placeholder” outcome) without
   calling production ETA and without exposing secrets in the UI or logs.
6. **Given** credential create/update/rotate/delete, **When** the change
   completes, **Then** an audit event records who changed which non-secret
   fields / that a secret was set or rotated, and outcome—never the plaintext
   or ciphertext secret material in logs or audit payloads.
7. **Given** a user without ETA-credentials permission, **When** they open or
   mutate credential settings, **Then** access is denied (or secrets are fully
   hidden and mutations blocked).

---

### User Story 4 - Manage local item codes (EGS/GS1) (Priority: P2)

An authorized user maintains a local catalog of product/service codes limited to
types **EGS** and **GS1**: create, update, deactivate, and search. The module is
structured so a future ETA code-API sync can attach without redesign; this
feature does not require a successful live sync with ETA.

**Why this priority**: Needed before line items can reference compliant codes;
can follow P1 settings but should ship in the same settings area.

**Independent Test**: Create EGS and GS1 codes with descriptions; reject any
other type; search/filter; deactivate a code; confirm tenant isolation and that
a “Sync with ETA” control is present as disabled/placeholder.

**Acceptance Scenarios**:

1. **Given** an authorized user, **When** they create an item code with type
   EGS or GS1, code value, and description, **Then** it is stored for the
   tenant and listed in Settings → Item codes.
2. **Given** a create/update with a type other than EGS or GS1, **When** they
   submit, **Then** the system rejects the request.
3. **Given** existing codes, **When** they search by code or description,
   **Then** matching active (and optionally inactive) rows are returned.
4. **Given** an item code, **When** they update description or deactivate it,
   **Then** changes persist and deactivated codes are excluded from default
   pickers used later for documents.
5. **Given** the item codes screen, **When** they view sync controls, **Then**
   they see a clear placeholder for ETA code sync stating that live sync is out
   of scope for this feature.
6. **Given** two tenants, **When** each manages item codes, **Then** neither
   can see or edit the other’s codes.

---

### User Story 5 - Settings navigation in the bilingual shell (Priority: P2)

An authenticated user with appropriate permissions opens a Settings area from
the app shell (Arabic RTL default and English LTR) with screens for Branches,
Currencies, ETA credentials, and Item codes. Unauthorized users do not see
manage actions they cannot perform.

**Why this priority**: Delivers full-stack constitution expectation; settings
must be reachable and localized.

**Independent Test**: Navigate Settings in Arabic and English; confirm all four
areas render; switch locale and verify labels/direction; confirm Viewer cannot
mutate restricted settings.

**Acceptance Scenarios**:

1. **Given** an Owner/Admin, **When** they open Settings, **Then** they can
   navigate to Branches, Currencies, ETA credentials, and Item codes screens.
2. **Given** Arabic locale, **When** they view Settings, **Then** layout is
   RTL and copy is Arabic; **When** they switch to English, **Then** layout is
   LTR and copy is English.
3. **Given** a Viewer (or role lacking manage permissions), **When** they
   access Settings, **Then** they cannot perform create/update/delete on
   restricted resources (UI hides or disables actions; API still enforces).

---

### Edge Cases

- Attempt to delete or deactivate the only active / default branch is rejected
  with a clear message.
- Duplicate currency code or duplicate item code (same type+value) for a tenant
  is rejected.
- Saving ETA credentials with an empty Client Secret on a normal update means
  “keep existing secret”; rotation requires the explicit rotate/replace control
  with a new secret value.
- Exchange rate with inverted or zero rate is rejected; overlapping effective
  date ranges for the same pair are rejected in v1.
- Branch without its own ETA credentials falls back to tenant credentials;
  branch with partial override merges non-secret fields from tenant where not
  overridden.
- Cross-tenant access by ID returns not found or forbidden with no data leak.
- “Test Connection” when required fields are missing explains what is missing
  without calling ETA.
- Missing or invalid encryption master key (env/KMS) MUST fail closed: secret
  write/read operations error without writing plaintext secrets to durable
  storage or logs.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow authorized users to create, read, update, and
  deactivate/delete branches within their tenant, including name, default flag,
  and ETA-related branch attributes (branch code/identity and activity code as
  applicable).
- **FR-002**: System MUST ensure each tenant has exactly one default branch at
  all times among active branches.
- **FR-003**: System MUST allow authorized users to manage a tenant currency
  list (add/remove from an allowed catalog) and set a tenant default currency.
- **FR-004**: System MUST allow an optional default currency override per
  branch.
- **FR-005**: System MUST allow authorized users to create and update **manual**
  exchange rates for currency pairs with an effective date (and optional end
  date), and retrieve the applicable rate for a pair and date.
- **FR-006**: System MUST define a stable **exchange-rate provider adapter
  interface** for future providers; this feature MUST NOT depend on a live
  external provider, and manual rates MUST remain fully usable.
- **FR-007**: System MUST store ETA Client ID and Client Secret per tenant, and
  optionally per branch. Client Secrets MUST be encrypted at rest with
  **libsodium sealed boxes**; the **master key MUST come from environment or
  KMS**. Secrets MUST **never be logged** (including audit payloads). After
  save, reads MUST return a **masked** representation only.
- **FR-007a**: System MUST allow authorized users to **rotate** (replace) a
  stored Client Secret via an explicit rotate action; empty secret on ordinary
  update MUST keep the existing secret.
- **FR-008**: System MUST store taxpayer registration number and activity code
  at tenant level and allow branch-level overrides where provided.
- **FR-009**: System MUST support intermediary “on behalf of” configuration
  fields so a taxpayer can operate as an intermediary with the represented
  party’s identity stored as non-secret settings data.
- **FR-010**: System MUST provide a “Test Connection” action on the ETA
  credentials screen that validates presence of required configuration and
  returns a clear placeholder/non-live result (no production ETA calls in this
  feature).
- **FR-011**: System MUST allow authorized users to CRUD local item codes with
  type **EGS or GS1 only**, code value, description, and active flag;
  uniqueness per tenant of (type, code). Other types MUST be rejected.
- **FR-012**: System MUST present an ETA item-code sync placeholder indicating
  readiness for a future sync feature without performing live ETA code APIs in
  this feature.
- **FR-013**: System MUST enforce permission checks for viewing and managing
  each settings area (branches, currencies/rates, ETA credentials, item codes)
  consistent with tenant RBAC.
- **FR-014**: System MUST isolate all settings data by tenant (defense in depth
  including database tenant policies for new tenant-scoped entities).
- **FR-015**: System MUST write audit events for create/update/delete/rotate of
  branches, currencies/rates, ETA credential settings (without secret values),
  and item codes.
- **FR-016**: Users MUST be able to access the four settings screens from the
  authenticated app shell with Arabic and English UI, including correct RTL/LTR.

### Constitution Constraints *(mandatory — map applicable principles)*

- **CC-001 Reliability/Audit**: Acceptance scenarios above are testable; audit
  events required for settings mutations (FR-015), including secret rotation
  without secret material.
- **CC-002 Security**: Client Secrets encrypted at rest via libsodium sealed
  boxes; master key from env/KMS; never log secrets; masked UI + rotate
  (FR-007, FR-007a); TLS; least privilege via RBAC (FR-013).
- **CC-003 Tenant Isolation**: All new settings entities are tenant-scoped with
  app checks + RLS (FR-014).
- **CC-004 ETA Serialization**: N/A — this feature stores configuration and
  local codes only; no document signing/canonical serialization.
- **CC-005 Runtime ETA Config**: Credentials and taxpayer identifiers are
  stored as runtime tenant/branch configuration, not hardcoded (FR-007–009).
- **CC-006 Sandbox-First**: Test Connection MUST NOT call production ETA; any
  future live test MUST target sandbox/preprod by environment (FR-010).
- **CC-007 UX/i18n**: Settings UI in ar/en with RTL/LTR in the existing design
  system (FR-016, User Story 5).
- **CC-008 Full-Stack Phase**: Backend APIs + frontend settings screens for all
  four areas ship together; agent signing not required for this feature.

### Key Entities *(include if feature involves data)*

- **Branch** (extended): Tenant-scoped location/unit; name; default flag; active
  flag; ETA branch identity/code; activity code; optional default currency
  reference.
- **TenantCurrency**: Links a tenant to an enabled currency code; marks tenant
  default.
- **ExchangeRate**: Tenant-scoped rate between two currencies; source
  **manual** in this feature; effective from/to; shaped so a future provider
  adapter can supply rates without changing the core pair/date model.
- **ExchangeRateProviderAdapter** (interface only): Extension point for future
  external rate sources; no live adapter required in this feature.
- **EtaCredentialSet**: Tenant-scoped (and optional branch-scoped) Client ID +
  Client Secret ciphertext (libsodium sealed box); registration number;
  activity code; intermediary / on-behalf-of fields.
- **ItemCode**: Tenant-scoped product/service code; type **EGS|GS1 only**; code
  value; description; active flag; optional sync status fields reserved for
  future ETA sync without requiring live sync now.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An Owner can create a second branch with ETA branch attributes and
  see it in the switcher within 3 minutes of opening Settings.
- **SC-002**: An Owner can set tenant default currency and enter one manual
  exchange rate, then confirm the rate is returned for that pair/date, within
  5 minutes.
- **SC-003**: After saving or rotating ETA Client Secret, settings load shows
  only a masked value (never full plaintext); automated tests prove
  encryption-at-rest (sealed box), masking on read, rotation, and zero secret
  material in logs/audit samples (100% of those tests pass).
- **SC-004**: “Test Connection” completes with a clear placeholder outcome in
  under 5 seconds of user click without contacting production ETA.
- **SC-005**: An Owner can add at least 10 item codes (mix of EGS and GS1 only)
  and find one via search in under 2 minutes; invalid types are rejected.
- **SC-006**: Cross-tenant isolation tests for branches, currencies, rates,
  credentials, and item codes show zero cross-tenant reads in automated suites.
- **SC-007**: Settings screens are usable in both Arabic (RTL) and English
  (LTR); primary labels are present in both locales.
- **SC-008**: Unauthorized roles fail mutation attempts for restricted settings
  with a clear denial (UI and API) in automated permission tests.

## Assumptions

- Builds on multi-tenant auth (tenants, memberships, RBAC, existing Branch
  entity, app shell, ar/en i18n).
- Default manage permissions: Owner and Admin can manage all settings areas;
  Accountant may view currencies/item codes as needed for their work; Viewer
  has read-only or no access to ETA secrets—exact matrix aligned with existing
  permission codes where possible, extended only as needed.
- Currency catalog for v1 is a fixed set of common codes (at least EGP, USD,
  EUR); free-text arbitrary currency codes are out of scope.
- Exchange rate overlap policy: overlapping active ranges for the same pair are
  rejected in v1.
- Branch ETA credentials override tenant credentials when present; otherwise
  tenant credentials apply.
- “Test Connection” and “Sync item codes with ETA” are explicit placeholders—
  no live ETA API integration in this feature.
- Soft-delete/deactivate is preferred over hard-delete when historical documents
  may reference branches or item codes; hard-delete allowed only when unused.
- Agent desktop signing and invoice document issuance remain out of scope.
- Master key provisioning (which env var / which KMS) is an operations concern
  for planning; the product rule is env-or-KMS, fail closed if unavailable.
