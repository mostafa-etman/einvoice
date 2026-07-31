/**
 * Merge stored CAdES signatures into the ETA document object for POST.
 * Shallow copy only — does not re-canonicalize (FR-008).
 */
export function buildSignedEtaPayload(
  etaPayloadJson: Record<string, unknown>,
  signaturesJson: unknown,
): Record<string, unknown> {
  const sigs = Array.isArray(signaturesJson) ? signaturesJson : [];
  return {
    ...etaPayloadJson,
    signatures: sigs.map((raw) => {
      const s = raw as { signatureType?: string; value?: string };
      return {
        signatureType: s.signatureType ?? 'I',
        value: s.value ?? '',
      };
    }),
  };
}
