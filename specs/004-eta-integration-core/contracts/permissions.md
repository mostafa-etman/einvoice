# ETA Integration Permissions

**Feature**: `004-eta-integration-core`

Reuses codes from feature 003 (no new permission codes required):

| Code | This feature |
|------|----------------|
| `settings.eta.view` | Connection status; list document types/versions |
| `settings.eta.manage` | Test Connection; force refresh document types from ETA |

Role matrix unchanged: Owner/Admin have both; Viewer/Accountant lack ETA view/
manage by default.
