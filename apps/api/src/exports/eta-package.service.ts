import {
  EtaDocumentPackageClient,
  mapEtaPackageStatus,
  type EtaPackageRequestBody,
} from '../eta/eta-document-package.client';

export type PackageRoundTripResult = {
  requestId: string;
  localStatus: 'READY' | 'ERROR' | 'DELETED' | 'STALLED';
  packageObjectKey?: string;
  packageByteSize?: number;
  polls: number;
};

export type StorePackageFn = (args: {
  requestId: string;
  zip: Buffer;
}) => Promise<{ objectKey: string }>;

/**
 * Request → poll Get Package Requests until ready → Get Document Package → store.
 * Get Package Requests is the canonical status path (FR-013).
 */
export class EtaPackageService {
  constructor(
    private readonly client: EtaDocumentPackageClient,
    private readonly store: StorePackageFn,
    private readonly opts: {
      pollInitialMs?: number;
      pollMaxMs?: number;
      maxPolls?: number;
      sleep?: (ms: number) => Promise<void>;
    } = {},
  ) {}

  async requestAndDownload(args: {
    accessToken: string;
    body: EtaPackageRequestBody;
  }): Promise<PackageRoundTripResult> {
    const { requestId } = await this.client.requestDocumentPackage(
      args.accessToken,
      args.body,
    );

    const sleep =
      this.opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    let delay = this.opts.pollInitialMs ?? 5;
    const maxDelay = this.opts.pollMaxMs ?? 50;
    const maxPolls = this.opts.maxPolls ?? 40;
    let polls = 0;

    while (polls < maxPolls) {
      polls += 1;
      const list = await this.client.getPackageRequests(args.accessToken, {
        pageNo: 1,
        pageSize: 50,
      });
      const mine = list.find((x) => x.requestId === requestId);
      if (!mine) {
        await sleep(delay);
        delay = Math.min(delay * 2, maxDelay);
        continue;
      }
      const mapped = mapEtaPackageStatus(mine.status);
      if (mapped === 'ERROR' || mapped === 'DELETED') {
        return { requestId, localStatus: mapped, polls };
      }
      if (mapped === 'READY') {
        const got = await this.client.getDocumentPackage(
          args.accessToken,
          requestId,
        );
        if (!got.ready) {
          await sleep(delay);
          delay = Math.min(delay * 2, maxDelay);
          continue;
        }
        const stored = await this.store({ requestId, zip: got.zip });
        return {
          requestId,
          localStatus: 'READY',
          packageObjectKey: stored.objectKey,
          packageByteSize: got.zip.byteLength,
          polls,
        };
      }
      await sleep(delay);
      delay = Math.min(delay * 2, maxDelay);
    }

    return { requestId, localStatus: 'STALLED', polls };
  }
}
