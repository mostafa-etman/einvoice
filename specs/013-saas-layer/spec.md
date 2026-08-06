# Feature Specification: SaaS Layer (Plans, Billing & Super-Admin)

**Feature Branch**: `013-saas-layer`

**Created**: 2026-08-01

**Status**: Clarified

**Input**: User description: "Feature: SaaS layer.
- Subscription plans + quotas (limits on documents/branches/devices) and ENFORCE them.
- Super-admin console: provision/suspend/activate tenants, monitor usage, impersonate for support (audited).
- Billing integration (Stripe or a local gateway) and email notifications.
- Self-service onboarding.
Frontend: plans & billing pages, super-admin console, onboarding flow."

## Clarifications

### Session 2026-08-01

- Q: What counts toward the document quota, and what is the period?
  → A: **Monthly issued documents only** for v1. **Received/purchases do not**
  consume quota (optional inbound limit may be added later). Quota period is a
  fixed **calendar month** (customer-clear). **Invalid/rejected** documents do
  **not** count (customer got no value). Optionally track **submission
  attempts** separately to guard against abuse (does not replace the issued
  quota).
- Q: Which payment provider path for v1?
  → A: **Provider abstraction** with **Stripe first** (test mode for v1 flow
  validation). An **Egyptian local gateway** (Paymob/Fawry/Kashier-class) is
  **required** for real Egyptian merchants (Stripe cannot collect local
  payments for them) and MUST be addable as the next adapter **without a
  rewrite**. Abstraction ships now; local gateway wiring follows Stripe.
- Q: What can impersonating operators do?
  → A: **Read-only by default**, always audited, visible operator banner, and
  tenant notification. Explicit **break-glass write** mode requires a typed
  reason, extra audit entry, and a **time-limited** session. Every
  impersonation action (read or write) is fully logged. Sessions **auto-expire**;
  start/end + reason are always in the audit log.
- Q: What is the plan catalog shape for v1?
  → A: Four named plans — **Free**, **Starter**, **Pro**, **Enterprise** —
  each with **numeric quotas** for documents (calendar-month issued), branches,
  and devices (exact numbers seeded at planning / catalog config).
- Q: When and against what is quota enforced?
  → A: **At request time** (before the exceeding create/issue/register
  succeeds), using **Phase 10 metering** — the usage-analytics meters
  (`011-usage-analytics`), especially calendar-month **`issued`** for document
  quota — not a separate counter. Branch/device limits use active counts at
  request time.
- Q: Confirm impersonation and billing guardrails for planning?
  → A: Impersonation remains **fully audited** and **time-limited** (as above).
  Billing remains **Stripe test mode first** with a **local gateway adapter**
  next on the same abstraction.
- Q: What default numeric quotas seed Free / Starter / Pro / Enterprise?
  → A: **Free** 100 issued docs / 1 branch / 1 device; **Starter** 500 / 3 / 3;
  **Pro** 2000 / 10 / 10; **Enterprise** 20000 / 50 / 50 (calendar-month issued
  documents; concurrent branches; concurrent devices). Super-admin overrides
  remain allowed.
- Q: Which timezone defines the calendar-month document quota boundary?
  → A: **Africa/Cairo** (Egypt local calendar month).
- Q: How can customers get onto Enterprise?
  → A: **Sales-assisted only** — request / contact sales; super-admin assigns
  Enterprise. Free, Starter, and Pro remain self-serve (in-app checkout where
  paid).
- Q: Which plan does self-service onboarding land on by default?
  → A: **Free** (no payment required to finish onboarding). Paid upgrades
  (Starter/Pro) happen via Plans & Billing afterward.
- Q: After past-due grace ends without payment, what access remains?
  → A: **Read-only** product access; writes/issue/register blocked; **Plans &
  Billing** remains usable to pay. Data retained until payment or operator
  activate/suspend policies apply.
- Q: Analyze remediation (2026-08-01) — impersonation action logging scope?
  → A: **Full logging** of every impersonated tenant API **read and write**
  (no sampling). Exempt only non-tenant infrastructure probes (e.g. health).
- Q: Analyze remediation — impersonation vs platform-admin escalation?
  → A: Impersonation credential is limited to the target **user’s** permissions;
  **never** `isPlatformOperator`; **403** on all `/platform-admin/*` and on
  nested impersonation / plan-quota assign / suspend-activate via that
  credential.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Self-service onboarding onto a plan (Priority: P1)

A new customer signs up, creates their organization, and completes a guided
onboarding flow that establishes the organization owner, basic profile, and an
active **Free** subscription. They land in the product ready to work within
Free quotas—without waiting for a platform operator to provision them manually.

**Why this priority**: Self-service signup is the growth path for a SaaS; without
it, every tenant depends on manual provisioning.

**Independent Test**: Complete signup and onboarding as a new user, confirm an
organization exists with an assigned plan and visible quota remaining, then
confirm a second new signup creates a separate isolated organization.

**Acceptance Scenarios**:

1. **Given** a visitor who is not yet registered, **When** they complete
   registration and onboarding, **Then** an organization is created with an
   owner membership and an assigned **Free** plan with Free quotas (100/1/1
   unless overridden).
2. **Given** a user mid-onboarding, **When** they leave and return before
   finishing, **Then** they resume incomplete steps without creating a duplicate
   organization.
3. **Given** onboarding completed on Free, **When** the owner later chooses
   Starter or Pro and payment succeeds, **Then** the subscription becomes
   active on that plan; **When** payment fails or is cancelled, **Then** they
   remain on Free with clear next steps (no silent paid access).
4. **Given** a completed onboarding on the Free plan, **When** the owner opens
   Plans & Billing, **Then** they see Free with quotas 100 issued documents /
   1 branch / 1 device (or the effective entitlements if overridden) and
   renewal/status information.

---

### User Story 2 - Plans with enforced quotas (Priority: P1)

An organization is bound to one of the catalog plans **Free**, **Starter**,
**Pro**, or **Enterprise**, each with **numeric quotas** for **documents**,
**branches**, and **devices**. Document quota for v1 counts **successfully
issued** documents in the current **Africa/Cairo calendar month** only—
**received/purchases do not consume** document quota; **invalid/rejected**
documents do not count. The product **enforces** those limits **at request
time** using **Phase 10 metering** (usage-analytics meters, especially
`issued`): actions that would exceed a quota are blocked before they succeed,
with a clear explanation and an upgrade path. Usage against quotas is visible
to authorized tenant users and stays consistent with that metering.

**Why this priority**: Quotas without enforcement are marketing theater; hard
limits are the commercial control plane of the SaaS layer.

**Independent Test**: Assign a plan with known low limits; create resources up to
each limit; confirm the next create/register attempt for documents, branches,
and devices is blocked with a user-visible reason and does not persist the
excess resource. Confirm invalid/rejected and received documents do not reduce
remaining issued quota.

**Acceptance Scenarios**:

1. **Given** an organization under a Free/Starter/Pro/Enterprise plan whose
   calendar-month `issued` meter (Phase 10 metering) has reached the plan’s
   document quota, **When** they attempt an action that would issue another
   document, **Then** the request is refused **at request time** with a clear
   message and upgrade/contact guidance, and no excess issued document is
   persisted.
2. **Given** invalid/rejected outbound documents and received/purchase
   documents in the same month, **When** quota usage is displayed or enforced,
   **Then** those documents do not consume the issued document quota.
3. **Given** branch count at the plan limit, **When** a user attempts to create
   another branch, **Then** the action is refused and existing branches remain
   usable.
4. **Given** registered devices at the plan limit, **When** a user attempts to
   register another device, **Then** the action is refused; unregistering a
   device frees capacity for a new registration.
5. **Given** a user viewing Plans & Billing (or quota indicators in the app),
   **When** quotas are partially consumed, **Then** remaining and used amounts
   for documents (calendar month issued), branches, and devices are shown
   accurately.
6. **Given** a user without billing-view permission, **When** they open Plans &
   Billing, **Then** access is denied; quota enforcement still applies to their
   create actions.
7. **Given** the Africa/Cairo calendar month rolls over, **When** the new month
   begins in that timezone, **Then** issued document quota usage resets for the
   new month without stuck blocks from the prior month’s count.

---

### User Story 3 - Plans & billing self-service for tenant owners (Priority: P1)

An Owner (or other authorized billing role) opens Plans & Billing to see
available plans, compare quotas, upgrade or downgrade (subject to rules), manage
payment method / invoices where applicable, and receive email notifications for
subscription and payment events (activation, renewal success/failure, upcoming
renewal, plan change, payment past due, and approaching/exceeded quota).

**Why this priority**: Without self-service plan changes and billing visibility,
support becomes a bottleneck and revenue operations stall.

**Independent Test**: As an authorized owner, view plans, change to a higher
plan (with successful payment if required), confirm quotas update and email is
sent; simulate a failed renewal and confirm status and notification.

**Acceptance Scenarios**:

1. **Given** an authorized billing user, **When** they open Plans & Billing,
   **Then** they see current plan, status, quota usage, and a catalog of
   available plans with quotas and prices.
2. **Given** a successful upgrade among Free/Starter/Pro, **When** the change
   completes, **Then** new quotas apply immediately (or at the documented
   effective time), status reflects the new plan, and a confirmation email is
   sent to billing contacts.
2a. **Given** an authorized billing user viewing Enterprise, **When** they
   choose Enterprise, **Then** they are guided to contact sales / request
   Enterprise (no in-app self-checkout that activates Enterprise alone).
3. **Given** a downgrade that would put current usage over the target plan’s
   quotas, **When** the user attempts it, **Then** the change is blocked until
   usage is reduced or they choose a plan that fits.
4. **Given** a payment failure on renewal, **When** the provider reports failure,
   **Then** the subscription enters a clearly labeled past-due state, the user
   is notified by email, and after the grace window without payment the tenant
   becomes **read-only** (writes/issue/register blocked) while **Plans &
   Billing** remains usable to restore paid access; data is retained.
5. **Given** approaching document quota (e.g. ≥80% used), **When** the threshold
   is crossed, **Then** an email warning is sent at most once per threshold per
   period (no notification spam).

---

### User Story 4 - Super-admin provisions, suspends, and activates tenants (Priority: P1)

A platform super-admin uses a dedicated console (not the tenant app shell) to
provision organizations, assign or override plans, suspend tenants (blocking
normal tenant access), and reactivate them. They can monitor usage across
tenants (aligned with usage analytics meters) to support sales and operations.

**Why this priority**: Operators need a control plane for sales-led provisioning,
abuse handling, and account recovery independent of tenant self-service.

**Independent Test**: As super-admin, provision a tenant with a plan, confirm
tenant users can sign in; suspend the tenant and confirm tenant access is
blocked; activate again and confirm access resumes; confirm a normal tenant
admin cannot open the super-admin console.

**Acceptance Scenarios**:

1. **Given** a super-admin, **When** they provision a new tenant with owner
   contact and plan, **Then** the organization exists, the owner can complete
   access, and the assigned plan quotas apply.
2. **Given** an active tenant, **When** the super-admin suspends it with a
   reason, **Then** tenant users cannot perform normal authenticated product
   actions, an audit record is written, and the tenant is labeled Suspended in
   the console.
3. **Given** a suspended tenant, **When** the super-admin activates it, **Then**
   access resumes under the current plan and an audit record is written.
4. **Given** a super-admin viewing tenant list/detail, **When** they open usage
   monitoring for a tenant, **Then** they see quota usage and key usage meters
   for that tenant only (no silent mixing of tenants in one row’s figures).
5. **Given** a tenant Owner or Admin (not super-admin), **When** they attempt to
   open the super-admin console or its actions, **Then** access is denied.

---

### User Story 5 - Audited impersonation for support (Priority: P2)

A super-admin starts a **time-limited** impersonation session to assist a
tenant user. Sessions are **read-only by default**, always show a visible
impersonation banner to the operator, notify the tenant, and audit start/end
with reason. An explicit **break-glass write** mode requires a typed reason,
an extra audit entry, and remains time-bounded. Every impersonated action
(read or write) is fully logged. Impersonation cannot bypass platform-level
suspension without an explicit activate, and cannot escalate to super-admin
privileges inside the tenant.

**Why this priority**: Support needs to reproduce issues safely; unaudited
impersonation is a severe trust and compliance risk.

**Independent Test**: Start read-only impersonation, perform a read, confirm
writes are blocked; enable break-glass with typed reason, perform one write,
confirm extra audit; end or wait for auto-expire; verify banner, tenant email,
and start/end audit; verify a non–super-admin cannot impersonate.

**Acceptance Scenarios**:

1. **Given** a super-admin and a target tenant user, **When** impersonation
   starts with a stated reason, **Then** the session is read-only by default,
   shows a clear impersonation indicator, notifies tenant owner/security
   contacts, and writes an audit event (actor, target, tenant, reason, start
   time, expiry).
2. **Given** an active read-only impersonation session, **When** the operator
   attempts a write action, **Then** the write is refused unless break-glass
   write mode has been explicitly enabled.
3. **Given** an active session, **When** the operator enables break-glass write
   with a typed reason, **Then** writes allowed under the target user’s
   permissions become possible for the remaining session time, and an extra
   audit entry records the mode change (reason, time).
4. **Given** an active impersonation session, **When** the super-admin ends it
   or it auto-expires, **Then** control returns to the super-admin identity,
   further impersonated actions fail, and an end/expiry audit event is written.
5. **Given** a suspended tenant, **When** a super-admin attempts impersonation
   without activating the tenant, **Then** impersonation into normal product use
   is refused (or limited to a documented read-only support mode if offered).
6. **Given** any impersonation-related action (start, end, break-glass, read, or
   write), **When** compliance reviews the audit log, **Then** they can answer
   who impersonated whom, when, why, mode (read-only vs write), what was done,
   and when the session ended.
7. **Given** an active impersonation session (read-only or break-glass write),
   **When** the operator presents the impersonation-scoped credential against
   any `/platform-admin/*` route, attempts to start another impersonation,
   assign plans/quotas, or suspend/activate tenants, **Then** every such
   attempt is **denied (403)**: the session is limited to the **impersonated
   user’s tenant permissions only**, MUST NOT carry or inherit
   `isPlatformOperator`, and MUST NOT grant platform-admin capabilities.

---

### User Story 6 - Email notifications for SaaS lifecycle events (Priority: P2)

The platform sends transactional emails for onboarding completion, plan changes,
payment success/failure, past-due warnings, suspension/activation by operators,
quota threshold warnings, and impersonation start (to the tenant’s security /
owner contacts where appropriate). Emails are available in Arabic and English
per recipient locale preference.

**Why this priority**: Billing and access changes must not be silent; email is
the out-of-band channel customers expect.

**Independent Test**: Trigger each major lifecycle event in a test environment
and confirm the correct recipients receive a localized message with accurate
plan/status facts (no other tenant’s data).

**Acceptance Scenarios**:

1. **Given** a successful plan change or payment event, **When** it completes,
   **Then** billing contacts receive a confirmation email in their preferred
   language.
2. **Given** payment failure or approaching suspension, **When** the condition
   occurs, **Then** owners/billing contacts are emailed with remediation steps.
3. **Given** operator suspend or activate, **When** the action completes,
   **Then** owner contacts are notified (unless a documented silent legal hold
   exception applies).
4. **Given** impersonation start, **When** the session begins, **Then** owner
   and/or security contacts for that tenant are notified that support access
   started (including approximate time and operator identity suitable for
   customers—not raw secrets).

---

### Edge Cases

- Payment past due past grace — tenant is read-only except Plans & Billing;
  restoring payment restores write access without data loss.
- Payment provider is temporarily unavailable during checkout or renewal —
  user sees a safe failure, no partial “paid” entitlement without confirmed
  payment.
- Webhook/event from the payment provider arrives twice — subscription state
  remains correct (idempotent application of provider events).
- Tenant deletes branches/devices to free quota, then retries create —
  capacity updates before the next attempt is accepted.
- Clock boundary for document quotas (Africa/Cairo calendar month end) — issued
  usage resets for the new month without double-charging or stuck blocks.
- High volume of invalid/rejected submissions — do not consume issued quota;
  optional submission-attempt tracking can still flag abuse for operators.
- Operator enables break-glass write then leaves the session open — session
  still auto-expires; write capability ends with the session.
- Local payment gateway not yet wired while Stripe test adapter is live —
  Egyptian production collection waits on the local adapter; abstraction must
  already accept a second provider without redesigning subscription state.
- Super-admin assigns a custom quota override above/below the catalog plan —
  enforcement uses the effective entitlements, and the override is audited.
- Downgrade scheduled for period end while still over target quotas —
  change does not take effect until usage fits, or is cancelled with notice.
- User tries to register during onboarding with an email already owning a
  tenant — clear error; no cross-linking of organizations without invitation
  flows already defined elsewhere.
- Impersonation token/session stolen or left open — sessions expire; ending
  from the console invalidates further impersonated actions.
- Tenant on free/trial with paid features attempted — paid-only capabilities
  remain gated by plan entitlements, not only numeric quotas.

## Requirements *(mandatory)*

### Functional Requirements

**Plans & entitlements**

- **FR-001**: System MUST maintain a catalog whose v1 self-serve/commercial
  plans include at least **Free**, **Starter**, **Pro**, and **Enterprise**,
  each with commercial status (available/hidden/retired), pricing presentation,
  and **numeric quotas** for documents (calendar-month issued), branches, and
  devices. Default seed quotas MUST be: **Free** 100/1/1, **Starter** 500/3/3,
  **Pro** 2000/10/10, **Enterprise** 20000/50/50 (issued documents / branches /
  devices). **Free**, **Starter**, and **Pro** MUST be self-serve (in-app plan
  selection/checkout where paid). **Enterprise** MUST be **sales-assisted
  only** (contact/request sales; super-admin assigns)—not completable via
  in-app paid checkout alone.
- **FR-002**: Every organization MUST have exactly one effective subscription
  state at a time (plan + status such as trial, active, past_due, suspended,
  cancelled) that determines entitlements.
- **FR-003**: System MUST compute and expose current quota usage vs limits for
  documents, branches, and devices to authorized tenant users and super-admins,
  reading document usage from **Phase 10 metering** (usage-analytics
  `issued` / related meters)—not a parallel document counter.
- **FR-004**: Document quota MUST count **successfully issued** documents in
  the current **calendar month** in the **Africa/Cairo** timezone only.
  **Received/purchase** documents MUST NOT consume document quota in v1.
  **Invalid/rejected** documents MUST NOT count toward the quota. The system
  MAY track submission attempts separately for abuse monitoring without
  treating those attempts as quota consumption.
- **FR-005**: Branch and device quotas MUST be enforced as concurrent active
  counts (create/register blocked at limit; delete/unregister frees capacity).
- **FR-006**: System MUST enforce quotas **at request time**: before a
  create/issue/register that would exceed a limit succeeds, the request MUST be
  **refused** with a clear, user-visible reason (no silent truncate or partial
  create). Document checks MUST use Phase 10 metering (`issued` for the current
  calendar month in **Africa/Cairo**).
- **FR-007**: Super-admins MUST be able to assign a catalog plan and/or
  temporary quota overrides to a tenant; overrides MUST be audited and visible
  in the console.

**Billing & payments**

- **FR-008**: System MUST expose a **payment provider abstraction** so
  subscription checkout, customer/payment-method references, invoices, and
  status webhooks are provider-agnostic at the product layer. **v1 MUST ship
  Stripe in test/sandbox mode** to exercise the billing flow. An **Egyptian
  local gateway** adapter (Paymob/Fawry/Kashier-class) MUST be design-supported
  as the next adapter without rewriting subscription or entitlement models—
  required for real Egyptian merchant collection because Stripe cannot serve
  that local-payment need.
- **FR-009**: System MUST support self-service plan upgrade and downgrade among
  **Free**, **Starter**, and **Pro** with rules that prevent downgrades that
  would leave current usage over the target plan’s quotas. Selecting
  **Enterprise** MUST route to a sales-assisted path (not silent self-checkout
  activation).
- **FR-010**: System MUST apply provider-reported payment success and failure
  idempotently so duplicate events do not corrupt subscription state.
- **FR-011**: System MUST retain tenant data when a subscription is past due or
  suspended. After the past-due **grace window** without successful payment,
  tenant product access MUST become **read-only** (create/issue/register and
  other writes blocked) while **Plans & Billing** MUST remain usable to pay and
  restore entitlements. Restrictions MUST be reversible on payment or operator
  activate. Operator **suspend** remains a separate, stronger control.

**Onboarding**

- **FR-012**: System MUST provide a self-service onboarding flow that creates
  the organization, owner membership, and initial **Free** subscription without
  requiring payment or a prior super-admin provision step.
- **FR-013**: System MUST allow super-admin provisioning as an alternate path
  for sales-assisted onboarding (same underlying tenant + plan model).
- **FR-014**: Onboarding and Plans & Billing UIs MUST support Arabic and English
  with correct RTL/LTR layout and responsive layout.

**Super-admin console**

- **FR-015**: System MUST provide a super-admin console to list/search tenants,
  view detail (plan, status, quota usage, key usage meters), provision,
  suspend, and activate tenants.
- **FR-016**: Super-admin capabilities MUST be restricted to platform operator
  accounts; tenant roles MUST NOT grant super-admin console access.
- **FR-017**: Suspend and activate MUST record audit events including actor,
  tenant, timestamp, action, reason, and outcome.
- **FR-018**: Super-admins MUST be able to monitor per-tenant usage in a way
  consistent with usage analytics meters (no inventing a conflicting second
  source of truth for the same meters).

**Impersonation**

- **FR-019**: Super-admins MUST be able to start and end **time-limited**
  impersonation of a tenant user with a required reason and a visible
  impersonation banner. Sessions MUST be **read-only by default**.
- **FR-019a**: System MUST support an explicit **break-glass write** mode that
  requires a typed reason, records an extra audit entry for the mode change,
  remains within the session time limit, and still restricts the operator to
  the target user’s tenant permissions (no super-admin escalation).
- **FR-019b**: Every impersonated **tenant API** action — **both reads and
  writes** — MUST be fully logged to the audit trail as
  `platform.impersonation.action` (real operator actor, impersonated user,
  tenant, action/route, mode, time, outcome). **No sampling** of business
  reads or writes. Exempt only non-tenant infrastructure probes that are not
  product APIs (e.g. health/livez); those MUST NOT be treated as a license to
  omit logging of document, billing, settings, or other tenant routes.
- **FR-020**: Impersonation start, end, auto-expiry, denial, and break-glass
  enablement MUST be audited (including reason); owner/security contacts MUST
  be notified by email when impersonation starts. After TTL expiry or explicit
  end, further use of the impersonation credential MUST be denied and audited
  as denial/expiry.
- **FR-021**: Impersonation MUST restrict the operator to the **impersonated
  user’s permissions only**. The impersonation credential MUST **never**
  carry or inherit `isPlatformOperator`, MUST **never** authorize
  `/platform-admin/*` (including starting another impersonation, assigning
  plans/quotas, or suspend/activate), and MUST NOT silently bypass tenant
  suspension. Sessions MUST auto-expire; ending or expiry MUST invalidate
  further impersonated actions.

**Email notifications**

- **FR-022**: System MUST send transactional emails for: onboarding completion,
  plan change, payment success, payment failure / past due, operator
  suspend/activate, quota threshold warnings, and impersonation start.
- **FR-023**: Notification emails MUST respect recipient language preference
  (ar/en) and MUST NOT include secrets (credentials, raw payment provider
  secrets, or impersonation tokens).

**Permissions & audit**

- **FR-024**: Tenant billing/plan management MUST be permission-gated (default:
  Owner; additional roles only if explicitly granted).
- **FR-025**: All plan assignments, payment-driven status changes, quota
  overrides, suspend/activate, and impersonation lifecycle events MUST be
  written to the audit log with actor, tenant (when applicable), timestamp,
  action, and outcome.
- **FR-026**: Out of scope for this feature: public marketing website CMS,
  multi-currency price books beyond what the payment provider and plan catalog
  present, partner/reseller hierarchies, and usage-based overage auto-charging
  beyond plan quotas (overages are blocked, not billed as extras, unless later
  specified).

### Constitution Constraints *(mandatory — map applicable principles)*

- **CC-001 Reliability/Audit**: Acceptance scenarios above map to automated
  tests; plan changes, payments status transitions, suspend/activate, quota
  refusals, and impersonation lifecycle MUST be audited.
- **CC-002 Security**: Payment provider secrets and webhook signing material
  MUST be encrypted/configured as secrets (never in client bundles or source);
  impersonation sessions MUST be time-limited and visibly indicated; least
  privilege for billing vs super-admin.
- **CC-003 Tenant Isolation**: Subscription, invoices references, quota usage,
  and billing contacts are tenant-scoped; RLS (or equivalent platform-operator
  bypass only in super-admin paths with explicit checks) MUST prevent
  cross-tenant leakage; usage monitoring is per-tenant.
- **CC-004 ETA Serialization**: N/A — no change to canonical serialization or
  signing.
- **CC-005 Runtime ETA Config**: N/A — no ETA schema/URL hardcoding introduced.
- **CC-006 Sandbox-First**: Payment adapters MUST use test/sandbox mode in
  non-production (Stripe test mode for v1); no live charges from development/CI.
  Local gateway production enablement remains a separate, explicit promotion.
- **CC-007 UX/i18n**: Onboarding, Plans & Billing, and super-admin console MUST
  use the design system, ar/en via next-intl, RTL for Arabic, responsive layout.
- **CC-008 Full-Stack Phase**: Backend entitlements/billing/webhooks + Frontend
  onboarding, Plans & Billing, and super-admin console ship together with tests;
  desktop agent only as needed for device-quota enforcement surfaces already in
  product.

### Key Entities *(include if feature involves data)*

- **Plan**: Commercial package; v1 catalog includes **Free**, **Starter**,
  **Pro**, **Enterprise**, each with visibility, price presentation, and
  **numeric quotas**. Default seeds: Free 100/1/1, Starter 500/3/3, Pro
  2000/10/10, Enterprise 20000/50/50 (calendar-month issued documents / max
  branches / max devices). Free/Starter/Pro are self-serve; Enterprise is
  sales-assisted (super-admin assign). Optional feature flags/entitlements
  beyond numeric quotas.
- **Subscription**: Per-organization binding to a plan with status (trial,
  active, past_due, suspended, cancelled), period boundaries, and effective
  entitlements (including operator overrides).
- **QuotaUsage**: Current consumption vs limits for **calendar-month issued**
  documents, active branches, and active devices; aligned with usage analytics
  `issued` (and related) meters where applicable. Invalid/rejected and
  received do not reduce issued quota in v1.
- **PaymentProviderBinding**: Tenant linkage to an external payment provider
  via the billing abstraction (provider id, customer/payment-method
  references); no raw card data stored in-app. Supports Stripe first and a
  subsequent Egyptian local gateway adapter without model rewrite.
- **InvoiceRef**: Record of provider invoices/charges for display and support
  (amounts, status, period, provider reference ids).
- **PlatformOperator (Super-Admin)**: Platform-level identity authorized for the
  super-admin console; not a tenant role.
- **ImpersonationSession**: Time-bounded support session linking operator →
  target user/tenant; default **read-only** mode; optional **break-glass
  write** with typed reason; start/end/expiry and per-action audit trail.
- **TenantLifecycleAction**: Provision, suspend, activate metadata (reason,
  actor) for console history and audit.
- **BillingNotification**: Outbound transactional email events tied to
  subscription/lifecycle (for delivery tracking and deduplication of threshold
  warnings).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new customer can complete self-service onboarding (register →
  organization → plan) in under 10 minutes in a guided test script.
- **SC-002**: 100% of attempted document/branch/device creates that would exceed
  plan quotas are blocked in acceptance tests, with a user-visible reason each
  time.
- **SC-003**: After a successful plan upgrade in test, new quotas are visible and
  enforceable within 1 minute.
- **SC-004**: Super-admins can provision, suspend, and activate a tenant in under
  3 minutes total in a guided operator script, with audit entries for each
  action.
- **SC-005**: 100% of impersonation start/end/expiry and break-glass enablement
  events in tests produce audit records that identify operator, target user,
  tenant, reason, mode (read-only vs write), and timestamps; write attempts in
  default read-only mode are refused; **100% of distinct tenant API mutations
  (and reads) exercised under the session each produce their own
  `platform.impersonation.action` audit row**; post-expiry requests are denied;
  impersonation credentials cannot call `/platform-admin/*` or inherit
  `isPlatformOperator`.
- **SC-006**: In cross-tenant tests, a user or operator view never shows another
  tenant’s subscription, invoices, or quota figures.
- **SC-007**: For each required lifecycle email type, a test trigger results in
  a correctly localized (ar or en) message to the expected recipients with
  accurate plan/status facts.
- **SC-008**: Duplicate payment-provider events applied in tests leave
  subscription status identical to applying the event once (no double
  entitlement or stuck state).
- **SC-009**: At least 90% of authorized testers in a usability pass can find
  current plan, usage vs quotas, and upgrade action on Plans & Billing without
  assistance.
- **SC-011**: In past-due-after-grace tests, write/issue/register attempts are
  refused while Plans & Billing payment recovery remains available and existing
  data remains readable.

## Assumptions

- Builds on existing multi-tenant auth, memberships, branches, devices, audit
  log, and usage analytics metering (document/API/storage meters feed or align
  with quota displays where applicable).
- Document quota v1 = **Africa/Cairo** calendar-month **issued** only;
  received/purchases out of quota; invalid/rejected out of quota; optional
  inbound document limit is a later enhancement. Submission-attempt counters
  for abuse are optional and distinct from billed quota.
- Quota enforcement is **request-time** against **Phase 10 metering**
  (usage-analytics / `011-usage-analytics` meters). Default catalog quotas:
  Free 100/1/1, Starter 500/3/3, Pro 2000/10/10, Enterprise 20000/50/50
  (issued docs / branches / devices); operators may override per tenant.
- Billing uses a provider abstraction: Stripe (test) validates the flow in v1;
  Egyptian local gateway (Paymob/Fawry/Kashier-class) is the production path for
  Egyptian merchants and must plug in without rewriting entitlements.
- Default tenant billing permission is Owner; finer-grained billing roles may be
  added in planning without changing the requirement that access is gated.
- Free and/or time-bounded trial plans exist in the catalog so onboarding can
  complete without immediate payment. **Self-service onboarding defaults to
  Free**. Paid plans (Starter/Pro) require successful payment (or operator
  comp) before paid entitlements apply. **Enterprise** is assigned by
  super-admin after sales, not via self-serve checkout.
- Past-due subscriptions receive a short grace window (default: 3 days) with
  warnings; after grace without payment, access is **read-only** (writes
  blocked; Plans & Billing still usable). Data retention continues while
  past-due/read-only or operator-suspended unless a later retention policy says
  otherwise.
- Quota warning emails fire at 80% and 100% of document quota per calendar
  month (deduplicated); branch/device limits warn on blocked attempt and
  optionally at 100% active capacity.
- Impersonation default session length is short (planning default: 30 minutes)
  with auto-expire; break-glass write does not extend beyond the session
  expiry unless explicitly renewed with a new reason.
- Device quota applies to registered signing/agent devices already modeled in
  the product; it does not invent a new device type.
- Super-admin console is a distinct operator surface; it reuses the design
  system and i18n but is not exposed as a normal tenant sidebar item.
- Marketing site, reseller portals, custom enterprise contracts beyond plan
  overrides, and automatic overage billing are out of scope.
- Email delivery uses the platform’s existing or planned transactional mail
  channel; deliverability tuning (SPF/DKIM) is an operations concern documented
  at planning time.
- Usage analytics remain the system of record for meter history; this feature
  consumes those meters for quota enforcement and operator monitoring rather
  than maintaining a conflicting parallel document counter—except where planning
  documents a single shared enforcement read model.
