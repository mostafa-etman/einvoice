/**
 * MinIO artifact store wrapper (T011) — tenant-prefixed object keys.
 * Full S3 client wiring deferred; key layout is the contract for US5 PDF storage.
 */

export function tenantArtifactKey(
  tenantId: string,
  kind: string,
  objectId: string,
): string {
  const safeKind = kind.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeId = objectId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `tenants/${tenantId}/artifacts/${safeKind}/${safeId}`;
}

export type PutArtifactInput = {
  tenantId: string;
  kind: string;
  objectId: string;
  contentType: string;
  body: Buffer;
};

export type PutArtifactResult = {
  bucket: string;
  key: string;
  contentType: string;
  byteSize: number;
};

export class MinioArtifactStore {
  constructor(
    private readonly bucket: string,
    private readonly putObject: (args: {
      bucket: string;
      key: string;
      body: Buffer;
      contentType: string;
    }) => Promise<void>,
  ) {}

  async put(input: PutArtifactInput): Promise<PutArtifactResult> {
    const key = tenantArtifactKey(input.tenantId, input.kind, input.objectId);
    await this.putObject({
      bucket: this.bucket,
      key,
      body: input.body,
      contentType: input.contentType,
    });
    return {
      bucket: this.bucket,
      key,
      contentType: input.contentType,
      byteSize: input.body.byteLength,
    };
  }
}
