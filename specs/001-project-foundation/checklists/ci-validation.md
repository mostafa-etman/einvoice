# CI Validation Checklist

**Purpose**: Confirm GitHub Actions runs lint, typecheck, test, and build
**Feature**: [spec.md](../spec.md)

- [x] CHK001 Workflow `.github/workflows/ci.yml` defines lint step
- [x] CHK002 Workflow defines typecheck step
- [x] CHK003 Workflow defines test step (JS + agent)
- [x] CHK004 Workflow defines build step (JS + agent)
- [x] CHK005 Deliberate failing test would fail the pipeline (CI runs `turbo run test` / `dotnet test` non-zero on failure)
