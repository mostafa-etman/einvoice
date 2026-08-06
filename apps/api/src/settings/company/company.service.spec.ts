import { BadRequestException } from '@nestjs/common';
import { CompanySettingsService } from './company.service';

describe('CompanySettingsService logo upload', () => {
  const tenantId = '11111111-1111-1111-1111-111111111111';
  let stored: { key?: string; body?: Buffer; contentType?: string } = {};
  let tenantRow: Record<string, unknown> = {
    id: tenantId,
    name: 'Workspace',
    legalName: 'Legal Co',
    issuerType: 'B',
    logoObjectKey: null,
    logoContentType: null,
    logoByteSize: null,
    logoUpdatedAt: null,
  };

  const tx = {
    tenant: {
      findUnique: async () => ({ ...tenantRow }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        tenantRow = { ...tenantRow, ...data };
        return tenantRow;
      },
    },
    branch: {
      findFirst: async () => ({
        id: 'b1',
        name: 'Main',
        etaBranchCode: '0',
        activityCode: '6201',
        addressCountry: 'EG',
        addressGovernate: 'Cairo',
        addressRegionCity: 'Cairo',
        addressStreet: 'Street',
        addressBuildingNumber: '1',
        addressPostalCode: null,
        addressFloor: null,
        addressRoom: null,
        addressLandmark: null,
        addressAdditionalInformation: null,
      }),
    },
  };

  const artifacts = {
    put: async (input: {
      tenantId: string;
      kind: string;
      objectId: string;
      contentType: string;
      body: Buffer;
    }) => {
      stored = {
        key: `tenants/${input.tenantId}/artifacts/${input.kind}/${input.objectId}`,
        body: input.body,
        contentType: input.contentType,
      };
      return {
        bucket: 'einvoice',
        key: stored.key!,
        contentType: input.contentType,
        byteSize: input.body.byteLength,
      };
    },
    getByKey: async () => stored.body!,
    removeByKey: async () => {
      stored = {};
    },
  };

  const service = new CompanySettingsService(
    { withTenant: (_t: string, fn: (t: typeof tx) => unknown) => fn(tx) } as never,
    { write: async () => undefined } as never,
    artifacts as never,
  );

  beforeEach(() => {
    stored = {};
    tenantRow = {
      id: tenantId,
      name: 'Workspace',
      legalName: 'Legal Co',
      issuerType: 'B',
      logoObjectKey: null,
      logoContentType: null,
      logoByteSize: null,
      logoUpdatedAt: null,
    };
    process.env.TENANT_LOGO_MAX_BYTES = '1048576';
  });

  it('rejects unsupported MIME types', async () => {
    await expect(
      service.uploadLogo(tenantId, 'u1', {
        buffer: Buffer.from('not-an-image'),
        mimetype: 'application/pdf',
        originalname: 'x.pdf',
        size: 12,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects oversized files', async () => {
    process.env.TENANT_LOGO_MAX_BYTES = '10';
    await expect(
      service.uploadLogo(tenantId, 'u1', {
        buffer: Buffer.alloc(20),
        mimetype: 'image/png',
        originalname: 'big.png',
        size: 20,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores PNG and returns profile with logo metadata', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const profile = await service.uploadLogo(tenantId, 'u1', {
      buffer: png,
      mimetype: 'image/png',
      originalname: 'logo.png',
      size: png.length,
    });
    expect(profile.logo?.contentType).toBe('image/png');
    expect(profile.logo?.byteSize).toBe(png.length);
    expect(stored.key).toContain('/branding/logo');
    const bytes = await service.getLogoBytes(tenantId);
    expect(bytes.buffer.equals(png)).toBe(true);
  });

  it('clears logo on remove', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    await service.uploadLogo(tenantId, 'u1', {
      buffer: png,
      mimetype: 'image/png',
      originalname: 'logo.png',
      size: png.length,
    });
    const cleared = await service.removeLogo(tenantId, 'u1');
    expect(cleared.logo).toBeNull();
  });
});
