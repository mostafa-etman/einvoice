import { Module, Global } from '@nestjs/common';
import * as Minio from 'minio';
import { loadEnv } from '../config/env';
import {
  MinioArtifactStore,
  tenantArtifactKey,
  type PutArtifactInput,
  type PutArtifactResult,
} from './minio-artifact.store';
import { notifyStoragePut } from './storage-hooks';

export const MINIO_CLIENT = 'MINIO_CLIENT';
export const MINIO_BUCKET = 'MINIO_BUCKET';

@Global()
@Module({
  providers: [
    {
      provide: MINIO_CLIENT,
      useFactory: () => {
        const env = loadEnv();
        return new Minio.Client({
          endPoint: env.MINIO_ENDPOINT,
          port: env.MINIO_PORT,
          useSSL: env.MINIO_USE_SSL,
          accessKey: env.MINIO_ACCESS_KEY,
          secretKey: env.MINIO_SECRET_KEY,
        });
      },
    },
    {
      provide: MINIO_BUCKET,
      useFactory: () => process.env.MINIO_BUCKET?.trim() || 'einvoice',
    },
    {
      provide: MinioArtifactStore,
      useFactory: (client: Minio.Client, bucket: string) => {
        const ensureBucket = async () => {
          const exists = await client.bucketExists(bucket).catch(() => false);
          if (!exists) await client.makeBucket(bucket, '');
        };
        void ensureBucket();
        return new MinioArtifactStore(bucket, async (args) => {
          await ensureBucket();
          await client.putObject(args.bucket, args.key, args.body, args.body.length, {
            'Content-Type': args.contentType,
          });
        });
      },
      inject: [MINIO_CLIENT, MINIO_BUCKET],
    },
    {
      provide: 'ArtifactStorage',
      useFactory: (client: Minio.Client, bucket: string, store: MinioArtifactStore) => ({
        async put(input: PutArtifactInput) {
          const result = await store.put(input);
          void notifyStoragePut(input.tenantId);
          return result;
        },
        async get(tenantId: string, kind: string, objectId: string): Promise<Buffer> {
          const key = tenantArtifactKey(tenantId, kind, objectId);
          const stream = await client.getObject(bucket, key);
          const chunks: Buffer[] = [];
          for await (const chunk of stream) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          return Buffer.concat(chunks);
        },
        async getByKey(key: string): Promise<Buffer> {
          const stream = await client.getObject(bucket, key);
          const chunks: Buffer[] = [];
          for await (const chunk of stream) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          return Buffer.concat(chunks);
        },
        async putByKey(key: string, body: Buffer, contentType: string): Promise<PutArtifactResult> {
          await client.putObject(bucket, key, body, body.length, {
            'Content-Type': contentType,
          });
          const tenantMatch = /^tenants\/([^/]+)\//.exec(key);
          if (tenantMatch?.[1]) void notifyStoragePut(tenantMatch[1]);
          return { bucket, key, contentType, byteSize: body.byteLength };
        },
        async removeByKey(key: string): Promise<void> {
          await client.removeObject(bucket, key).catch(() => undefined);
        },
        tenantArtifactKey,
        bucket,
      }),
      inject: [MINIO_CLIENT, MINIO_BUCKET, MinioArtifactStore],
    },
  ],
  exports: [MinioArtifactStore, MINIO_CLIENT, MINIO_BUCKET, 'ArtifactStorage'],
})
export class StorageModule {}

export type ArtifactStorage = {
  put: (input: PutArtifactInput) => Promise<PutArtifactResult>;
  get: (tenantId: string, kind: string, objectId: string) => Promise<Buffer>;
  getByKey: (key: string) => Promise<Buffer>;
  putByKey: (
    key: string,
    body: Buffer,
    contentType: string,
  ) => Promise<PutArtifactResult>;
  removeByKey: (key: string) => Promise<void>;
  tenantArtifactKey: typeof tenantArtifactKey;
  bucket: string;
};
