# Scope Boundary Checklist

**Purpose**: Confirm foundation ships no product business logic
**Feature**: [spec.md](../spec.md)

- [x] CHK001 No invoicing / receipt submission flows
- [x] CHK002 No tenant product features or RLS policies
- [x] CHK003 No authentication product flows
- [x] CHK004 `eta-core` is stub-only (no live ETA calls / serialization)
- [x] CHK005 Agent has no signing / PKCS#11 / BouncyCastle wiring
