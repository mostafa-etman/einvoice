---

description: "Task list template for feature implementation"
---

# Tasks: [FEATURE NAME]

**Input**: Design documents from `/specs/[###-feature-name]/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: MANDATORY per constitution Principle I. Every user-visible change MUST
include automated test tasks mapped to acceptance criteria. Include ETA
canonical serialization parity tests when signing/serialization is in scope.

**Organization**: Tasks are grouped by user story to enable independent
implementation and testing of each story. Each story/phase MUST cover Backend +
Frontend (+ desktop agent when signing is touched) before the next phase.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Backend**: `backend/src/`, `backend/tests/`
- **Frontend**: `frontend/src/`, `frontend/tests/`
- **Desktop agent**: `desktop-agent/src/`, `desktop-agent/tests/` (incl. shared vectors)
- **Infra**: `infra/` (Compose, Traefik, env templates)
- Paths shown below are illustrative — adjust to plan.md structure

<!--
  ============================================================================
  IMPORTANT: The tasks below are SAMPLE TASKS for illustration purposes only.

  The /speckit-tasks command MUST replace these with actual tasks based on:
  - User stories from spec.md (with their priorities P1, P2, P3...)
  - Feature requirements from plan.md
  - Entities from data-model.md
  - Endpoints from contracts/

  Tasks MUST be organized by user story so each story can be:
  - Implemented independently
  - Tested independently
  - Delivered as an MVP increment

  DO NOT keep these sample tasks in the generated tasks.md file.
  ============================================================================
-->

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Create project structure per implementation plan
- [ ] T002 Initialize [language] project with [framework] dependencies
- [ ] T003 [P] Configure linting and formatting tools

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

Examples of foundational tasks (adjust based on your project):

- [ ] T004 Setup PostgreSQL schema, Prisma migrations, and RLS policies
- [ ] T005 [P] Implement authentication/authorization + tenant context
- [ ] T006 [P] Setup API routing, TLS-terminated ingress assumptions, middleware
- [ ] T007 Create base tenant-scoped models all stories depend on
- [ ] T008 Configure structured logging, audit log pipeline, and error handling
- [ ] T009 Setup per-environment config (sandbox ETA first; secrets encrypted at rest)
- [ ] T010 [P] Frontend design system + next-intl (ar/en, RTL) scaffolding

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - [Title] (Priority: P1) 🎯 MVP

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 1 (REQUIRED) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T011 [P] [US1] Contract/API test for [endpoint] in backend/tests/contract/
- [ ] T012 [P] [US1] Integration test for [user journey] in backend/tests/integration/
- [ ] T013 [P] [US1] Frontend test for [UI flow] in frontend/tests/
- [ ] T014 [P] [US1] (If signing) Serialization parity test vs shared vectors

### Implementation for User Story 1

- [ ] T015 [P] [US1] Backend: tenant-scoped model/migration + RLS policies
- [ ] T016 [P] [US1] Backend: service/API for [capability]
- [ ] T017 [US1] Backend: audit log events for [actions]
- [ ] T018 [US1] Frontend: UI using design system + next-intl (ar/en, RTL)
- [ ] T019 [US1] (If signing) Desktop agent changes + vector sync
- [ ] T020 [US1] Validation, error handling, and tenant-context enforcement

**Checkpoint**: User Story 1 meets Definition of Done (BE + FE [+ agent] + tests)

---

## Phase 4: User Story 2 - [Title] (Priority: P2)

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 2 (REQUIRED) ⚠️

- [ ] T021 [P] [US2] Contract/API test in backend/tests/contract/
- [ ] T022 [P] [US2] Integration test in backend/tests/integration/
- [ ] T023 [P] [US2] Frontend test in frontend/tests/

### Implementation for User Story 2

- [ ] T024 [P] [US2] Backend model/API (RLS-safe)
- [ ] T025 [US2] Frontend UI (design system + i18n)
- [ ] T026 [US2] Audit + validation
- [ ] T027 [US2] Integrate with User Story 1 components (if needed)

**Checkpoint**: Stories 1 AND 2 each meet Definition of Done independently

---

## Phase 5: User Story 3 - [Title] (Priority: P3)

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 3 (REQUIRED) ⚠️

- [ ] T028 [P] [US3] Contract/API test in backend/tests/contract/
- [ ] T029 [P] [US3] Integration test in backend/tests/integration/
- [ ] T030 [P] [US3] Frontend test in frontend/tests/

### Implementation for User Story 3

- [ ] T031 [P] [US3] Backend model/API (RLS-safe)
- [ ] T032 [US3] Frontend UI (design system + i18n)
- [ ] T033 [US3] Audit + validation

**Checkpoint**: All user stories independently meet Definition of Done

---

[Add more user story phases as needed, following the same pattern]

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] TXXX [P] Documentation updates in docs/
- [ ] TXXX Code cleanup and refactoring
- [ ] TXXX Performance optimization across all stories
- [ ] TXXX [P] Additional unit/regression tests in backend/tests/unit/ and frontend/tests/
- [ ] TXXX Security hardening (secrets, RLS review, audit coverage)
- [ ] TXXX Confirm sandbox-first ETA config; no hardcoded schemas/URLs/creds
- [ ] TXXX Run quickstart.md validation
- [ ] TXXX Definition of Done review before next phase

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - May integrate with US1 but should be independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - May integrate with US1/US2 but should be independently testable

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Models/migrations (with RLS) before services
- Services before endpoints
- Backend and frontend for the story before claiming Done
- Core implementation before integration
- Story Definition of Done complete before next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- All tests for a user story marked [P] can run in parallel
- Models within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Contract/API test for [endpoint] in backend/tests/contract/"
Task: "Integration test for [user journey] in backend/tests/integration/"
Task: "Frontend test for [UI flow] in frontend/tests/"

# Launch backend + frontend scaffolding in parallel:
Task: "Backend: tenant-scoped model/migration + RLS policies"
Task: "Frontend: UI using design system + next-intl (ar/en, RTL)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Story 3 → Test independently → Deploy/Demo
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1
   - Developer B: User Story 2
   - Developer C: User Story 3
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
