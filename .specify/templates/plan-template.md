# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]

**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  Defaults below match the eInvoice constitution Technology Baseline.
  Replace only where the feature genuinely differs; justify deviations in
  Complexity Tracking.
-->

**Language/Version**: TypeScript (NestJS + Next.js 15); C# / .NET 8 (desktop agent)

**Primary Dependencies**: NestJS, Prisma, BullMQ, Next.js 15, Tailwind, shadcn/ui, next-intl, TanStack Query, BouncyCastle, PKCS#11/CSP

**Storage**: PostgreSQL (Prisma + RLS), Redis, MinIO

**Testing**: Automated unit/integration/contract tests required for user-visible changes; ETA canonical serialization parity tests when signing is touched

**Target Platform**: Linux VPS (Docker Compose + Traefik/TLS); Windows desktop signing agent

**Project Type**: Multi-tenant SaaS web application + desktop signing agent

**Performance Goals**: [domain-specific, e.g., p95 API latency targets, queue throughput or NEEDS CLARIFICATION]

**Constraints**: Tenant RLS isolation; secrets encrypted at rest; TLS everywhere; ETA sandbox/preprod by default; no hardcoded ETA schemas/URLs/creds

**Scale/Scope**: [domain-specific, e.g., tenants, docs/day, concurrent signers or NEEDS CLARIFICATION]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Reliability & Audit**: Acceptance criteria + automated tests planned for every user-visible change; audit events identified for security/business actions
- **II. Security by Default**: Secrets/ETA creds encrypted at rest; least privilege; TLS; no secrets in repo/logs/clients
- **III. Multi-Tenant Isolation**: Tenant-scoped data uses Postgres RLS; request/job tenant context defined; no cross-tenant paths
- **IV. Serialization Parity**: If signing/serialization is in scope, shared test vectors and backend↔agent parity coverage planned
- **V. Runtime ETA Config**: Document types/versions loaded from ETA (or ETA-refreshed cache); URLs/creds/certs are per-environment config only
- **VI. Sandbox-First**: Feature targets ETA sandbox/preprod; production config remains separate
- **VII. UX/i18n**: UI uses design system; ar/en + RTL; responsive behavior specified
- **VIII. Phased Full-Stack DoD**: Phase ships Backend + Frontend (+ agent if signing) with tests; Definition of Done checklist acknowledged
- **Stack**: Plan stays within Technology Baseline or records justified Complexity Tracking entries

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace with the concrete layout for this feature.
  Default multi-tenant SaaS layout below; remove unused trees and expand
  real paths. The delivered plan must not include Option labels.
-->

```text
backend/
├── src/
│   ├── modules/
│   ├── prisma/
│   └── common/
└── tests/
    ├── unit/
    ├── integration/
    └── contract/

frontend/
├── src/
│   ├── app/
│   ├── components/
│   ├── messages/          # next-intl locales (ar/en)
│   └── lib/
└── tests/

desktop-agent/             # .NET 8 signing agent (when in scope)
├── src/
└── tests/
    └── vectors/           # shared ETA canonical serialization vectors

infra/                     # Docker Compose, Traefik, env templates
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
