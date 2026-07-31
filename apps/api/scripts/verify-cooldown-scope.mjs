/**
 * Live check that the ETA duplicate cooldown is scoped per document.
 *
 * Sets a cooldown on document A (scoped to A's own payload hash), then calls the
 * real submit endpoint for A and for a different document B. B must not be
 * blocked by A's cooldown. Never reaches ETA: B is picked so it fails a later
 * gate (status), and A is blocked before any POST.
 *
 * Usage: node apps/api/scripts/verify-cooldown-scope.mjs <internalIdA> <internalIdB>
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { canonicalSerialize, parseEtaDocument } from '@einvoice/eta-core';

const API = process.env.API_BASE_URL ?? 'http://localhost:3001';
const EMAIL = process.env.SEED_OWNER_EMAIL ?? 'owner@test.local';
const PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'Password123!';

const [internalA, internalB] = process.argv.slice(2);
if (!internalA || !internalB) {
  console.error('usage: verify-cooldown-scope.mjs <internalIdA> <internalIdB>');
  process.exit(2);
}

function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', 'infra-postgres-1', 'psql', '-U', 'einvoice', '-d', 'einvoice', '-t', '-A', '-c', sql],
    { encoding: 'utf8' },
  ).trim();
}

function loadDoc(internalId) {
  const row = psql(
    `SELECT id || E'\\x1f' || tenant_id || E'\\x1f' || status || E'\\x1f' || coalesce(eta_payload_text,'') FROM documents WHERE internal_id='${internalId}'`,
  );
  const [id, tenantId, status, payloadText] = row.split('\x1f');
  if (!id) throw new Error(`document ${internalId} not found`);
  return { id, tenantId, status, payloadText };
}

/** Same identity the service uses: canonical bytes without signatures. */
function payloadHash(payloadText) {
  if (!payloadText) return null;
  const doc = parseEtaDocument(payloadText);
  delete doc.signatures;
  return createHash('sha256').update(canonicalSerialize(doc), 'utf8').digest('hex');
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

async function submit(token, tenantId, documentId) {
  const res = await fetch(`${API}/documents/${documentId}/submit`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-id': tenantId,
      'content-type': 'application/json',
    },
  });
  const text = await res.text();
  let code = null;
  try {
    code = JSON.parse(text)?.code ?? JSON.parse(text)?.message?.code ?? null;
  } catch {
    /* non-JSON */
  }
  return { status: res.status, code, body: text.slice(0, 300) };
}

const A = loadDoc(internalA);
const B = loadDoc(internalB);
const token = await login();

const hashA = payloadHash(A.payloadText);
const until = new Date(Date.now() + 5 * 60_000);
psql(
  `UPDATE documents SET submit_cooldown_until='${until.toISOString()}', submit_cooldown_payload_hash=${hashA ? `'${hashA}'` : 'NULL'} WHERE id='${A.id}'`,
);
console.log(`A = ${internalA} (${A.status}) cooldown until ${until.toISOString()}`);
console.log(`    scoped to payload hash ${hashA?.slice(0, 16)}…`);
console.log(`B = ${internalB} (${B.status}) no cooldown\n`);

const aBlocked = await submit(token, A.tenantId, A.id);
console.log(`1. submit A while in cooldown  -> ${aBlocked.status} ${aBlocked.code ?? ''}`);
console.log(
  `   ${aBlocked.code === 'ETA_DUPLICATE_COOLDOWN' ? 'PASS: A is blocked by its own cooldown' : 'FAIL: expected ETA_DUPLICATE_COOLDOWN'}`,
);

const bResult = await submit(token, B.tenantId, B.id);
const bBlockedByCooldown = bResult.code === 'ETA_DUPLICATE_COOLDOWN';
console.log(`\n2. submit different document B -> ${bResult.status} ${bResult.code ?? ''}`);
console.log(
  `   ${bBlockedByCooldown ? "FAIL: B was blocked by A's cooldown" : "PASS: B is NOT blocked by A's cooldown"}`,
);
console.log(`   ${bResult.body}`);

// Move A's window into the past: it must auto-expire with no manual reset.
psql(
  `UPDATE documents SET submit_cooldown_until=now() - interval '1 second' WHERE id='${A.id}'`,
);
const aAfter = await submit(token, A.tenantId, A.id);
console.log(`\n3. submit A after window elapsed -> ${aAfter.status} ${aAfter.code ?? ''}`);
console.log(
  `   ${aAfter.code === 'ETA_DUPLICATE_COOLDOWN' ? 'FAIL: still blocked after expiry' : 'PASS: cooldown auto-expired (no manual reset)'}`,
);
const cleared = psql(
  `SELECT coalesce(submit_cooldown_until::text,'null') || ' / ' || coalesce(submit_cooldown_payload_hash,'null') FROM documents WHERE id='${A.id}'`,
);
console.log(`   stored cooldown after gate: ${cleared}`);

psql(
  `UPDATE documents SET submit_cooldown_until=NULL, submit_cooldown_payload_hash=NULL, submit_in_flight=false, submit_in_flight_since=NULL WHERE id IN ('${A.id}','${B.id}')`,
);
console.log('\ncleaned up test cooldown state');
