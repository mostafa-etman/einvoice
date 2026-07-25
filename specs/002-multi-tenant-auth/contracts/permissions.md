# Permission Catalog & Seed Matrix

## Permission codes

| Code | Description |
|------|-------------|
| `tenant.manage` | Rename/archive tenant settings |
| `members.view` | List tenant members |
| `members.manage` | Add/update/remove members and assign roles |
| `roles.view` | List roles and permissions |
| `roles.manage` | Change role permission sets (non-system constraints apply) |
| `branches.view` | List branches |
| `branches.manage` | Create/update branches |
| `audit.view` | Read audit log |
| `billing.view` | View billing (future) |
| `billing.manage` | Manage billing (future) |

## Seed matrix

| Permission | Owner | Admin | Accountant | Viewer |
|------------|:-----:|:-----:|:----------:|:------:|
| `tenant.manage` | ✓ | | | |
| `members.manage` | ✓ | ✓ | | |
| `members.view` | ✓ | ✓ | ✓ | ✓ |
| `roles.manage` | ✓ | ✓ | | |
| `roles.view` | ✓ | ✓ | | ✓ |
| `branches.manage` | ✓ | ✓ | | |
| `branches.view` | ✓ | ✓ | ✓ | ✓ |
| `audit.view` | ✓ | ✓ | | |
| `billing.view` | ✓ | ✓ | ✓ | |
| `billing.manage` | ✓ | | ✓ | |

System roles (`is_system=true`) cannot be deleted. Owner membership cannot be
removed if it would leave the tenant with zero Owners (enforced in services).
