/**
 * Run the real pre-submit digest self-check against a stored document.
 *
 * Usage:
 *   node apps/api/scripts/check-document-digest.mjs <internalId|document-id>
 *
 * Uses the compiled API build so the script and the submission pipeline share
 * one implementation (run `pnpm --filter @einvoice/api build` if dist is stale).
 */
import { execFileSync } from 'node:child_process';
import { attachSignatures, parseEtaDocument } from '@einvoice/eta-core';
import {
  etaDocumentDigest,
  extractCadesMessageDigest,
  verifySignedDigest,
} from '../dist/submissions/cades-digest.js';

const key = process.argv[2];
if (!key) {
  console.error('usage: check-document-digest.mjs <internalId|document-id>');
  process.exit(2);
}

function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', 'infra-postgres-1', 'psql', '-U', 'einvoice', '-d', 'einvoice', '-t', '-A', '-c', sql],
    { encoding: 'utf8' },
  ).trim();
}

const isUuid = /^[0-9a-f-]{36}$/i.test(key);
const where = isUuid ? `id='${key}'` : `internal_id='${key}'`;

const row = psql(
  `SELECT coalesce(eta_payload_text,'') || E'\\x1f' || coalesce(signatures_json::text,'[]') FROM documents WHERE ${where}`,
);
const [payloadText, signaturesJson] = row.split('\x1f');

if (!payloadText) {
  console.log('eta_payload_text is empty — save the document again before signing.');
  process.exit(1);
}

const document = parseEtaDocument(payloadText);
const signatures = JSON.parse(signaturesJson);
const { canonical, digestHex } = etaDocumentDigest(document);

console.log('document        :', key);
console.log('canonical length:', canonical.length);
console.log('canonical sha256:', digestHex);
console.log('signatures      :', signatures.length);

for (const [i, sig] of signatures.entries()) {
  const embedded = extractCadesMessageDigest(sig.value);
  console.log(`  [${i}] type=${sig.signatureType} message-digest=${embedded ?? 'none'}`);
  console.log(`       matches canonical digest: ${embedded === digestHex}`);
}

const outbound = attachSignatures(document, signatures);
const result = verifySignedDigest(outbound);
console.log();
console.log('pre-submit self-check:', result.ok ? 'PASS' : `BLOCK — ${result.reason}`);
