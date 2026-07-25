<!--
Sync Impact Report
- Version change: (unfilled template) → 1.0.0
- Modified principles: N/A (initial ratification from template placeholders)
- Added sections:
  - Core Principles I–VIII (Reliability & Audit, Security by Default,
    Multi-Tenant Isolation, ETA Canonical Serialization Parity,
    Runtime ETA Configuration, Sandbox-First Environments,
    Unified UX & i18n, Phased Full-Stack Delivery)
  - Technology Baseline
  - Definition of Done
  - Governance
- Removed sections: template placeholder tokens only
- Templates requiring updates:
  - .specify/templates/plan-template.md ✅ updated
  - .specify/templates/spec-template.md ✅ updated
  - .specify/templates/tasks-template.md ✅ updated
  - .specify/templates/checklist-template.md ✅ no change needed
  - .cursor/skills/speckit-tasks/SKILL.md ✅ updated (tests mandatory)
- Follow-up TODOs: none
-->

# eInvoice Constitution

## Core Principles

### I. Reliability-First & Audit-First

Every user-visible change MUST include explicit acceptance criteria and
automated tests that exercise those criteria. Auditability is a first-class
product requirement: security-relevant and business-relevant actions MUST be
recorded in an append-oriented audit log with actor, tenant, timestamp, action,
and outcome. Features without testable acceptance criteria MUST NOT ship.

**Rationale**: ETA e-invoicing is a regulated, high-stakes domain; silent
failures and untraceable changes are unacceptable in production.

### II. Security by Default

All ETA credentials, API secrets, certificates, and comparable secrets MUST be
encrypted at rest. Access MUST follow least privilege. All external and
inter-service traffic MUST use TLS. Audit logging of authentication,
authorization, credential use, and configuration changes is mandatory.
Secrets MUST NEVER appear in source control, logs, or client-side bundles.

**Rationale**: Compromise of tenant ETA credentials or signing material has
direct legal and financial impact.

### III. Multi-Tenant Isolation

Tenant data isolation is mandatory. PostgreSQL Row-Level Security (RLS) MUST
enforce tenant boundaries for all tenant-scoped tables. Application code MUST
set and verify tenant context on every request/job; defense in depth is
required (app checks + RLS). Cross-tenant data leakage is a release-blocking
defect. Shared infrastructure (Redis, MinIO, queues) MUST use tenant-scoped
keys/prefixes or equivalent isolation controls.

**Rationale**: A multi-tenant SaaS without hard isolation is not market-ready.

### IV. ETA Canonical Serialization Parity

The ETA canonical serialization used for document signing MUST be implemented
identically in the NestJS backend and the .NET 8 desktop signing agent.
Both implementations MUST be verified against the same known test vectors in
CI. Any change to serialization logic MUST update shared vectors and pass
parity tests before merge.

**Rationale**: Signature mismatches between agent and backend cause rejected
submissions and are extremely costly to diagnose in production.

### V. Runtime ETA Configuration (No Hardcoding)

ETA document type schemas/versions MUST be loaded from ETA at runtime (or from
a cache refreshed from ETA), not hardcoded. Base URLs, credentials, and
certificate/material configuration MUST live in per-environment configuration.
Source code MUST NOT embed production or sandbox URLs, document schemas, or
credentials as literals used for live calls.

**Rationale**: ETA schemas and endpoints change; hardcoded values create
outages and compliance drift.

### VI. Sandbox-First Environments

Development and CI MUST target the ETA sandbox/preprod environment by default.
Production configuration MUST be a separate, explicitly provisioned environment
with distinct secrets, URLs, and promotion controls. Features that call ETA
MUST be validated against sandbox before any production enablement.

**Rationale**: Accidental production ETA traffic during development is
unacceptable.

### VII. Unified UX, i18n & Responsive UI

The product MUST use a single design system (Tailwind + shadcn/ui conventions)
from day one. Arabic and English MUST be supported via next-intl, including
correct RTL layout for Arabic. UI MUST be responsive across supported
breakpoints. New UI MUST NOT introduce one-off visual systems or
locale-unaware copy.

**Rationale**: Egyptian market readiness requires bilingual RTL-capable UX
and consistent product polish.

### VIII. Phased Full-Stack Delivery

Every delivery phase MUST ship Backend + Frontend (+ Desktop Agent when the
phase touches signing) together with automated tests, and MUST meet the
Definition of Done before the next phase begins. Partial vertical slices that
leave one tier untested or incomplete do not satisfy phase completion.

**Rationale**: Backend-only or UI-only increments hide integration risk until
too late for a regulated SaaS.

## Technology Baseline

The approved stack is normative unless Governance amends this constitution:

- **Backend**: NestJS, PostgreSQL with Prisma and RLS, Redis/BullMQ, MinIO
- **Frontend**: Next.js 15, Tailwind CSS, shadcn/ui, next-intl, TanStack Query
- **Desktop signing agent**: .NET 8, BouncyCastle, PKCS#11/CSP
- **Deployment**: Docker Compose on a VPS with Traefik terminating TLS

Deviations MUST be documented in the feature plan Complexity Tracking table
with justification and a simpler alternative that was rejected.

## Definition of Done

A phase or user story is Done only when all of the following hold:

1. Acceptance criteria are written and mapped to automated tests.
2. Backend, frontend, and (if in scope) desktop agent changes for the slice
   are implemented and integrated.
3. Automated tests pass in CI (unit, integration/contract as applicable,
   including serialization parity vectors when signing is touched).
4. Tenant isolation, secret handling, and audit-log requirements for the
   slice are satisfied and covered by tests or reviewed checklists.
5. ETA-facing work is validated against sandbox/preprod configuration.
6. UI changes respect the design system, i18n (ar/en + RTL), and responsive
   requirements.
7. No unresolved constitution violations remain in the feature plan gate.

## Governance

This constitution supersedes conflicting conventions in specs, plans, tasks,
and ad-hoc practice. When artifacts conflict with these principles, the
artifacts MUST be amended—not the principles—unless an explicit constitution
amendment is ratified.

**Amendments**: Require a documented proposal (what changes, why, migration
impact), version bump per semantic versioning below, update of
`.specify/memory/constitution.md`, and propagation to dependent templates
and Spec Kit skills when gates or mandatory practices change.

**Versioning**:

- **MAJOR**: Remove or redefine a principle in a backward-incompatible way
- **MINOR**: Add a principle/section or materially expand guidance
- **PATCH**: Clarifications, wording, and non-semantic refinements

**Compliance**: Every `/speckit-plan` Constitution Check MUST evaluate these
principles as release gates. `/speckit-analyze` and `/speckit-converge` treat
MUST violations as CRITICAL. Code review and CI MUST block merges that
knowingly violate Principles I–VI; Principles VII–VIII are also merge gates
for user-facing and phased delivery work respectively.

**Runtime guidance**: Prefer project specs under `specs/` and this
constitution over informal chat instructions when they conflict.

**Version**: 1.0.0 | **Ratified**: 2026-07-20 | **Last Amended**: 2026-07-20
