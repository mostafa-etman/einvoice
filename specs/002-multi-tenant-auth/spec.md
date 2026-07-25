# Feature Specification: Multi-Tenant Core & Authentication

**Feature Branch**: `002-multi-tenant-auth`

**Created**: 2026-07-20

**Status**: Clarified

**Input**: User description: "Feature: Multi-tenant core and authentication. Entities: Tenant, User, Role, Permission (RBAC), Membership (user↔tenant with role), Branch (basic), AuditLog. Auth: email/password with JWT access + refresh tokens; tenant onboarding (create tenant + owner). Enforce tenant isolation via Postgres Row-Level Security using a tenant_id set per request. Frontend: unified app shell with the design system, i18n (Arabic default + English) with RTL/LTR switching, responsive layout, auth pages (login/register), tenant & branch switcher, users & roles management screens."

## Clarifications

### Session 2026-07-20

- Q: Which password hashing algorithm MUST be used? → A: argon2id
- Q: How are refresh tokens delivered and rotated? → A: httpOnly secure cookies; rotate on each use
- Q: How is RLS tenant context applied per request? → A: `SET LOCAL app.tenant_id` per request inside a transaction
- Q: Which default roles are seeded per tenant? → A: Owner, Admin, Accountant, Viewer
- Q: What is the default i18n locale/direction? → A: Arabic (RTL)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Register, create tenant, and sign in (Priority: P1)

A new business owner registers with email and password, creates their organization
(tenant), and becomes its owner. They can sign in again later and receive a
session that keeps them authenticated across requests.

**Why this priority**: Without onboarding and authentication, no other tenant
features are usable. This is the MVP gateway.

**Independent Test**: Complete register → create tenant as owner → log out →
log in with the same credentials and access the authenticated app shell.

**Acceptance Scenarios**:

1. **Given** a visitor is not authenticated, **When** they register with a valid
   email and password, **Then** a user account is created and they can proceed to
   tenant onboarding.
2. **Given** an authenticated user with no tenant yet (or during onboarding),
   **When** they create a tenant with a valid name, **Then** the tenant is
   created, they become its owner member, and a default branch is available.
3. **Given** valid credentials for an existing user, **When** they sign in,
   **Then** they receive an authenticated session (short-lived access token plus
   refresh token in an httpOnly secure cookie) and land in the app shell for an
   allowed tenant.
4. **Given** invalid credentials, **When** they attempt to sign in, **Then**
   access is denied with a clear error and no session is issued.
5. **Given** an authenticated session with an expiring access token, **When**
   the client refreshes using the httpOnly refresh cookie, **Then** a new access
   token is issued and the refresh token is rotated (prior refresh value no
   longer works) without requiring password re-entry.

---

### User Story 2 - Tenant isolation enforced on every request (Priority: P1)

While working inside a tenant, a user only sees and changes data belonging to
that tenant. The system sets tenant context per request and database policies
block cross-tenant reads/writes even if application checks are bypassed.

**Why this priority**: Constitution-mandated isolation; leakage is
release-blocking for a multi-tenant SaaS.

**Independent Test**: Create two tenants with separate users/data; authenticate
as tenant A and verify tenant B’s users/branches/roles are inaccessible; prove
isolation with automated tests including database-level enforcement.

**Acceptance Scenarios**:

1. **Given** an authenticated user acting in tenant A, **When** they list users,
   roles, or branches, **Then** only tenant A records are returned.
2. **Given** an authenticated user acting in tenant A, **When** they attempt to
   access a resource ID belonging to tenant B, **Then** the system denies access
   (not found or forbidden) and does not return tenant B data.
3. **Given** a request without a valid tenant context for a tenant-scoped
   operation, **When** the API handles it, **Then** the operation is rejected.
4. **Given** automated isolation tests, **When** they run against the database
   with `app.tenant_id` set via `SET LOCAL` for tenant A inside a transaction,
   **Then** queries cannot return tenant B rows for tenant-scoped tables.

---

### User Story 3 - Use the authenticated app shell (i18n & switchers) (Priority: P1)

An authenticated user works inside a unified, responsive app shell that uses the
design system, defaults to Arabic (RTL) with English (LTR) available, and can
switch active tenant and branch when they have access to more than one.

**Why this priority**: Day-one UX and bilingual RTL readiness are constitution
requirements; switchers are required for multi-tenant/branch operation.

**Independent Test**: Sign in, confirm Arabic-default shell with RTL, switch to
English/LTR, switch tenant and branch when memberships allow, and confirm layout
works on mobile and desktop widths.

**Acceptance Scenarios**:

1. **Given** an authenticated user, **When** they open the app, **Then** they
   see a unified shell (navigation + content) using the shared design system.
2. **Given** the app’s default locale, **When** the user first lands (or has no
   locale preference), **Then** Arabic is the default and the layout is RTL.
3. **Given** an authenticated user, **When** they switch language to English,
   **Then** copy updates and layout switches to LTR (and back to RTL for Arabic).
4. **Given** a user belonging to multiple tenants, **When** they use the tenant
   switcher, **Then** active tenant context changes and subsequent data reflects
   the selected tenant.
5. **Given** a tenant with multiple branches, **When** they use the branch
   switcher, **Then** the active branch context updates for the session/UI.
6. **Given** a narrow viewport, **When** they use the shell, **Then** navigation
   and primary actions remain usable (responsive layout).

---

### User Story 4 - Manage users, roles, and permissions (Priority: P2)

A tenant owner (or permitted role) invites/manages members, assigns roles, and
views/adjusts role permissions within their tenant so access follows least
privilege.

**Why this priority**: RBAC is required for safe multi-user tenants, but comes
after a single owner can already operate (P1).

**Independent Test**: As owner, create/list members, assign roles, verify a
member without manage-users permission cannot change roles; confirm permission
checks on protected actions.

**Acceptance Scenarios**:

1. **Given** an owner (or user with manage-users permission), **When** they open
   users management, **Then** they see members of the current tenant only.
2. **Given** manage-users permission, **When** they add or update a membership
   with a role (Owner, Admin, Accountant, Viewer, or other allowed tenant roles),
   **Then** the member’s effective permissions match that role.
3. **Given** roles management access, **When** they view roles and permissions,
   **Then** they see at least the seeded Owner, Admin, Accountant, and Viewer
   roles and their associated permissions.
4. **Given** a member without manage-users permission, **When** they attempt to
   change another user’s role, **Then** the action is denied.
5. **Given** a permission change, **When** the affected user next performs a
   protected action, **Then** authorization reflects the updated role permissions.

---

### User Story 5 - Security and admin actions are audited (Priority: P2)

Security-relevant actions (sign-in success/failure, tenant creation, membership
and role changes, tenant/branch switches where applicable) are written to an
append-oriented audit log with actor, tenant, timestamp, action, and outcome.

**Why this priority**: Constitution audit-first requirement; needed for
regulated operations but secondary to being able to sign in and isolate data.

**Independent Test**: Perform login, failed login, tenant create, and role
assignment; verify corresponding audit entries exist with required fields and
cannot be edited via normal APIs.

**Acceptance Scenarios**:

1. **Given** a successful or failed sign-in, **When** the attempt completes,
   **Then** an audit entry records actor (if known), action, outcome, and time.
2. **Given** tenant creation or membership/role changes, **When** they succeed,
   **Then** audit entries are recorded for the acting user and tenant.
3. **Given** existing audit entries, **When** a normal client tries to modify or
   delete them, **Then** the system rejects the change (append-oriented).

---

### Edge Cases

- Duplicate email on registration — reject with a clear, non-enumerating-safe
  message strategy consistent with security practice.
- Refresh token presented after rotation or logout — deny refresh and require
  sign-in (rotation-on-use; reuse of an old cookie value fails).
- User belongs to zero tenants after register (if onboarding deferred) — force
  onboarding before tenant-scoped screens.
- User removed from a tenant while session still active — subsequent
  tenant-scoped calls fail authorization.
- Switching to a tenant/branch the user is not a member of — denied.
- Missing or forged tenant context on API — rejected; RLS still blocks data
  because `app.tenant_id` is unset or wrong for the transaction.
- Password too weak — reject at registration/change with clear rules.
- Concurrent role permission edits — last write wins or conflict handled
  predictably without cross-tenant effects.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow users to register with email and password.
- **FR-002**: System MUST authenticate users with email/password and issue
  short-lived access tokens plus refresh tokens. Refresh tokens MUST be delivered
  only via httpOnly Secure cookies and MUST rotate on each successful refresh
  use (previous refresh credential becomes invalid).
- **FR-003**: System MUST allow an authenticated user to create a tenant and
  become its owner via a membership with the Owner role.
- **FR-004**: System MUST create a basic default branch when a tenant is created.
- **FR-005**: System MUST model Tenant, User, Role, Permission, Membership
  (user↔tenant with role), Branch, and AuditLog.
- **FR-006**: System MUST enforce RBAC so protected actions require appropriate
  permissions for the active tenant membership. Each new tenant MUST be seeded
  with default roles: Owner, Admin, Accountant, and Viewer.
- **FR-007**: System MUST enforce isolation with PostgreSQL Row-Level Security on
  all tenant-scoped tables. For every tenant-scoped request, the API MUST run
  work in a database transaction and set `app.tenant_id` with `SET LOCAL` for
  that transaction (defense in depth with application checks).
- **FR-008**: System MUST prevent cross-tenant data access; leakage is a
  release-blocking defect.
- **FR-009**: Users MUST be able to sign out, clearing/invalidating the refresh
  cookie so prior refresh credentials cannot be reused.
- **FR-010**: Frontend MUST provide login and register pages.
- **FR-011**: Frontend MUST provide a unified authenticated app shell using the
  shared design system, responsive across supported breakpoints.
- **FR-012**: Frontend MUST default to Arabic (RTL) and support English (LTR),
  including in-app locale switching.
- **FR-013**: Frontend MUST provide tenant and branch switchers for users with
  multiple accessible tenants/branches.
- **FR-014**: Frontend MUST provide users management and roles management
  screens for permitted users within the active tenant.
- **FR-015**: System MUST write append-oriented audit log entries for
  authentication events and administrative changes (tenant create, membership,
  role/permission changes at minimum).
- **FR-016**: Passwords MUST be hashed with argon2id before storage; plaintext
  passwords MUST NEVER be stored. Tokens and secrets MUST NOT appear in logs or
  client bundles beyond what the client must hold for its own session (access
  token handling as designed; refresh remains httpOnly cookie-only).
- **FR-017**: Automated tests MUST cover: registration/login/refresh-with-rotation;
  tenant onboarding; RLS via `SET LOCAL app.tenant_id` / cross-tenant denial;
  RBAC allow/deny for seeded roles; locale default Arabic + switch to English;
  and critical audit events.
- **FR-018**: This feature MUST NOT implement ETA document flows, signing agent
  changes, or invoicing/receipt business logic.
- **FR-019**: After a successful refresh, presenting the previous refresh cookie
  value MUST fail (detect reuse / block rotation chain as applicable).

### Constitution Constraints *(mandatory — map applicable principles)*

- **CC-001 Reliability/Audit**: Acceptance criteria + automated tests required;
  AuditLog for auth and admin actions (FR-015).
- **CC-002 Security**: argon2id password hashing; JWT access tokens; refresh in
  httpOnly Secure cookies with rotation-on-use; least-privilege RBAC; TLS via
  existing stack; no secrets in git/logs; authZ on all protected routes.
- **CC-003 Tenant Isolation**: Mandatory Postgres RLS on tenant-scoped tables;
  per-request transaction sets `app.tenant_id` via `SET LOCAL`; app + RLS
  defense in depth.
- **CC-004 ETA Serialization**: N/A — no signing/serialization in this feature.
- **CC-005 Runtime ETA Config**: N/A — no ETA live calls; do not hardcode ETA
  endpoints if any placeholders appear in env only.
- **CC-006 Sandbox-First**: N/A for ETA calls; non-prod configs remain separate
  from production secrets (JWT signing keys per environment).
- **CC-007 UX/i18n**: Design system shell; Arabic default (RTL) + English (LTR);
  responsive auth and management screens.
- **CC-008 Full-Stack Phase**: Ships API + web together with tests; desktop
  agent unchanged/out of scope for this feature.

### Key Entities

- **Tenant**: Organization/account boundary; owns branches, roles, memberships;
  all tenant-scoped data keyed by tenant id.
- **User**: Global identity (email/password credentials); may belong to multiple
  tenants via memberships.
- **Membership**: Links a user to a tenant with exactly one role for that tenant
  (or equivalent single primary role model); tenant-scoped.
- **Role**: Named set of permissions within a tenant. Every tenant is seeded
  with Owner, Admin, Accountant, and Viewer; further customization may be
  allowed within tenant policy later.
- **Permission**: Discrete capability string/code used for authorization checks.
- **Branch**: Basic organizational subunit under a tenant; tenant-scoped.
- **AuditLog**: Append-oriented record of security/admin actions with actor,
  tenant (when applicable), timestamp, action, outcome; not user-editable.
- **Refresh Session**: Server-side refresh credential referenced by an httpOnly
  Secure cookie; rotated on each successful refresh.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user can register, create a tenant as owner, and reach the
  authenticated shell in under 5 minutes following the happy path.
- **SC-002**: 100% of automated cross-tenant isolation tests pass (no tenant B
  data visible under tenant A context at API or database policy layer).
- **SC-003**: 100% of sampled protected admin actions enforce RBAC (allow with
  permission, deny without) in automated tests.
- **SC-004**: First load of the authenticated shell uses Arabic + RTL by
  default; switching to English yields LTR within one navigation action.
- **SC-005**: On a mobile-width viewport, login, register, and shell primary
  navigation remain usable without horizontal scrolling of core controls.
- **SC-006**: After sign-out, or after refresh rotation, presenting the prior
  refresh cookie value fails in automated tests.
- **SC-007**: Audit entries exist for successful login, failed login, tenant
  creation, and role assignment in automated or scripted verification.
- **SC-008**: Automated tests confirm passwords are verified against argon2id
  hashes (plaintext never persisted) and that tenant-scoped DB access uses
  transaction-scoped `app.tenant_id` via `SET LOCAL`.

## Assumptions

- Builds on the existing project foundation (API, web, Postgres, design tokens,
  i18n plumbing); this feature adds auth and multi-tenant domain behavior.
- Arabic is the **default** locale for the product app (RTL); English is
  optional via switcher (LTR). Foundation marketing landing may still use its
  own default where separate.
- Email verification and password-reset flows are out of scope for this feature
  unless added later; registration activates the account immediately.
- Platform/super-admin (cross-tenant operator console) is out of scope.
- Default seeded roles per tenant are exactly: Owner, Admin, Accountant, Viewer
  (permission matrices defined at planning time).
- A user may belong to multiple tenants; active tenant is selected via switcher
  (or sole membership is auto-selected).
- Branch is intentionally basic (name + tenant association + switcher); advanced
  org hierarchy is out of scope.
- Desktop signing agent is unchanged in this feature.
- Access tokens are short-lived (e.g., bearer for API); refresh tokens live only
  in httpOnly Secure cookies and rotate on every refresh.
- Audit log is queryable by permitted tenant admins in a later iteration if not
  included now; creation of entries is mandatory in this feature even if UI is
  minimal or admin-only API.
