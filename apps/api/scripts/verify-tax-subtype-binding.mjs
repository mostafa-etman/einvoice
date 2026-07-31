/**
 * Live check that the selected (taxType, subType) pair is what lands in the ETA
 * payload, and that a pair whose subtype belongs to another tax type is refused
 * by validation instead of being silently submitted.
 *
 * Usage: node apps/api/scripts/verify-tax-subtype-binding.mjs
 */
import { execFileSync } from 'node:child_process';

const API = process.env.API_BASE_URL ?? 'http://localhost:3001';
const EMAIL = process.env.SEED_OWNER_EMAIL ?? 'owner@test.local';
const PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'Password123!';

function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', 'infra-postgres-1', 'psql', '-U', 'einvoice', '-d', 'einvoice', '-t', '-A', '-c', sql],
    { encoding: 'utf8' },
  ).trim();
}

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return body.accessToken ?? body.access_token;
}

function api(token, tenantId) {
  return async (path, init = {}) => {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': tenantId,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body };
  };
}

function draft(branchId, itemCode, internalId, tax) {
  return {
    kind: 'INVOICE',
    branchId,
    currencyCode: 'EGP',
    issueDateTime: new Date().toISOString(),
    internalId,
    version: 0,
    receiver: { type: 'B', name: 'Subtype Binding Check' },
    lines: [
      {
        description: 'Service',
        itemType: 'EGS',
        itemCode,
        unitType: 'EA',
        quantity: '1',
        unitPrice: '150.00',
        discountAmount: '0.00',
        taxes: [tax],
      },
    ],
  };
}

function payloadSubtypes(payloadText) {
  const doc = JSON.parse(payloadText);
  return (doc.invoiceLines ?? []).flatMap((l) =>
    (l.taxableItems ?? []).map((t) => `${t.taxType}/${t.subType}@${t.rate}`),
  );
}

const token = await login();
const tenantId = psql(
  `SELECT m.tenant_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email='${EMAIL}' LIMIT 1`,
);
const branchId = psql(
  `SELECT id FROM branches WHERE tenant_id='${tenantId}' AND is_active ORDER BY created_at LIMIT 1`,
);
const itemCode = psql(
  `SELECT code FROM item_codes WHERE tenant_id='${tenantId}' AND is_active ORDER BY created_at LIMIT 1`,
);
const call = api(token, tenantId);

const validSubtypes = psql(
  `SELECT string_agg(code, ', ' ORDER BY code) FROM eta_code_entries WHERE catalog_kind='TAX_SUBTYPE' AND parent_code='T3' AND is_active`,
);
console.log(`valid T3 subtypes in catalog: ${validSubtypes}`);

const internalId = `TAXBIND-${Date.now()}`;
const created = await call('/documents', {
  method: 'POST',
  body: JSON.stringify(draft(branchId, itemCode, internalId, {
    taxType: 'T3',
    subType: 'Tbl02',
    rate: '1.50',
  })),
});
if (created.status >= 300) throw new Error(`create failed: ${created.status} ${JSON.stringify(created.body)}`);
const docId = created.body.id;

const stored = psql(`SELECT eta_payload_text FROM documents WHERE id='${docId}'`);
const emitted = payloadSubtypes(stored);
console.log(`selected T3/Tbl02@1.50 -> payload ${emitted.join(', ')}`);
const pairOk = emitted.length === 1 && emitted[0].startsWith('T3/Tbl02@');

const mismatch = await call(`/documents/${docId}`, {
  method: 'PUT',
  body: JSON.stringify({
    ...draft(branchId, itemCode, internalId, { taxType: 'T3', subType: 'Mn01', rate: '1.50' }),
    version: created.body.version,
  }),
});
const validated = await call(`/documents/${docId}/validate`, { method: 'POST' });
const issues = Array.isArray(validated.body?.issues) ? validated.body.issues : [];
const mismatchIssue = issues.find((i) => i.code === 'TAX_SUBTYPE_PARENT_MISMATCH');
console.log(
  `T3/Mn01 (Mn01 is a T10 subtype) -> validate ok=${validated.body?.ok} issue=${mismatchIssue?.message ?? 'none'}`,
);
if (!mismatchIssue) {
  console.log(`  all issues: ${JSON.stringify(issues)}`);
  console.log(`  update status: ${mismatch.status} ${JSON.stringify(mismatch.body).slice(0, 200)}`);
}

psql(`DELETE FROM documents WHERE id='${docId}'`);

const ok = pairOk && mismatch.status < 300 && validated.body?.ok === false && Boolean(mismatchIssue);
console.log(ok ? 'PASS: exact selected pair emitted; foreign subtype blocked' : 'FAIL');
process.exit(ok ? 0 : 1);
