# Devices API Permissions

**Feature**: `006-desktop-signing-agent`

## New permission codes

| Code | Description |
|------|-------------|
| `devices.view` | List devices, view last seen / status |
| `devices.manage` | Create/revoke pairing codes, unpair devices |

## Related (existing)

| Code | Use in this feature |
|------|---------------------|
| `documents.manage` | Send document for signature |
| `documents.view` | See signed status / signatures metadata |

## Default role matrix (delta)

| Role | devices.view | devices.manage |
|------|--------------|----------------|
| Owner | yes | yes |
| Admin | yes | yes |
| Accountant | yes | no |
| Viewer | no | no |

Agent calls authenticate with **device token**, not user JWT (separate guard).
