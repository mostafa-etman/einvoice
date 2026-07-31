# Permissions: Submission Pipeline

**Feature**: `007-submission-pipeline`

## Decision (MVP)

Reuse existing document permissions — no new codes required for v1:

| Permission | Submission capabilities |
|------------|-------------------------|
| `documents.view` | List submissions/documents, view drilldown, download PDF, view status events |
| `documents.manage` | Submit / Submit batch, retry, cancel, reject, update submission settings |

## Role matrix impact

| Role | Effect |
|------|--------|
| Owner / Admin / Accountant | Already have `documents.manage` → full lifecycle |
| Viewer | `documents.view` only → read-only dashboard |

## Future (optional)

If product later separates filing ops from document editing:

| Code | Purpose |
|------|---------|
| `submissions.view` | Dashboard read |
| `submissions.manage` | Submit / retry / cancel / reject |

Not required for this feature's DoD.

## Webhook endpoints

No JWT permission — authenticated via tenant webhook ApiKey (see
[eta-webhooks.md](./eta-webhooks.md)).
