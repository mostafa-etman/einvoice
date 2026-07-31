/**
 * Proof for ITIDA 4043: show that field order changes the ETA digest, and that
 * the exact-bytes pipeline keeps signing and sending identical.
 *
 * Usage:
 *   node apps/api/scripts/prove-signed-bytes.mjs <document-id>
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  attachSignatures,
  canonicalWithoutSignatures,
  isRoundTripStable,
  parseEtaDocument,
  serializeEtaDocument,
} from '@einvoice/eta-core';

const documentId = process.argv[2];
if (!documentId) {
  console.error('usage: prove-signed-bytes.mjs <document-id>');
  process.exit(2);
}

function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', 'infra-postgres-1', 'psql', '-U', 'einvoice', '-d', 'einvoice', '-t', '-A', '-c', sql],
    { encoding: 'utf8' },
  ).trim();
}

const sha256 = (text) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

const jsonbPayload = psql(
  `SELECT eta_payload_json::text FROM documents WHERE id='${documentId}'`,
);
const payloadText = psql(
  `SELECT coalesce(eta_payload_text,'') FROM documents WHERE id='${documentId}'`,
);
const canonicalPreview = psql(
  `SELECT coalesce(canonical_preview,'') FROM documents WHERE id='${documentId}'`,
);

console.log('document:', documentId);
console.log();

const jsonbCanonical = canonicalWithoutSignatures(JSON.parse(jsonbPayload));
console.log('[jsonb copy]        keys reordered by Postgres — the 4043 cause');
console.log('  canonical sha256 :', sha256(jsonbCanonical));
console.log('  first keys       :', Object.keys(JSON.parse(jsonbPayload)).slice(0, 6).join(','));
console.log();

if (canonicalPreview) {
  console.log('[builder canonical] ETA schema field order (canonical_preview)');
  console.log('  canonical sha256 :', sha256(canonicalPreview));
}
console.log();

if (!payloadText) {
  console.log('[exact bytes]       eta_payload_text is EMPTY — save the document again');
  process.exit(0);
}

const document = parseEtaDocument(payloadText);
const canonical = canonicalWithoutSignatures(document);

console.log('[exact bytes]       eta_payload_text — signed AND submitted');
console.log('  round-trip stable:', isRoundTripStable(payloadText));
console.log('  canonical sha256 :', sha256(canonical));
console.log('  matches preview  :', canonicalPreview ? sha256(canonical) === sha256(canonicalPreview) : 'n/a');
console.log('  first keys       :', Object.keys(document).slice(0, 6).join(','));
console.log();

const outbound = attachSignatures(document, [{ signatureType: 'I', value: 'PLACEHOLDER' }]);
console.log('outgoing bytes canonical digest equals signing digest:',
  sha256(canonicalWithoutSignatures(outbound)) === sha256(canonical));
console.log('serialize(outgoing) starts with signed bytes prefix   :',
  serializeEtaDocument(outbound).startsWith(payloadText.slice(0, payloadText.length - 1)));
