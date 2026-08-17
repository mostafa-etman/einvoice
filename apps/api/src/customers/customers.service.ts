import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import {
  customerToEtaReceiver,
  normalizeCustomerWrite,
  type CustomerWriteInput,
} from './customer-validation';

@Injectable()
export class CustomersService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenantId: string,
    query: {
      q?: string;
      type?: string;
      active?: boolean;
      sortBy?: string;
      sortDir?: 'asc' | 'desc';
      cursor?: string;
      limit?: number;
    } = {},
  ) {
    const take = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
    const sortBy = ['name', 'registrationId', 'code', 'updatedAt', 'createdAt'].includes(
      query.sortBy ?? '',
    )
      ? (query.sortBy as 'name' | 'registrationId' | 'code' | 'updatedAt' | 'createdAt')
      : 'name';
    const sortDir = query.sortDir === 'desc' ? 'desc' : 'asc';

    const where: Prisma.CustomerWhereInput = {
      tenantId,
      ...(query.type ? { type: query.type.toUpperCase() } : {}),
      ...(query.active !== undefined ? { isActive: query.active } : {}),
      ...(query.q?.trim()
        ? {
            OR: [
              { name: { contains: query.q.trim(), mode: 'insensitive' } },
              { nameEn: { contains: query.q.trim(), mode: 'insensitive' } },
              {
                registrationId: {
                  contains: query.q.trim().replace(/\s+/g, ''),
                  mode: 'insensitive',
                },
              },
              { code: { contains: query.q.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const rows = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.customer.findMany({
        where,
        orderBy: [{ [sortBy]: sortDir }, { id: 'asc' }],
        take: take + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    );

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    return {
      items: page.map((c) => this.toDto(c)),
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    };
  }

  /** Compact search for invoice picker (active only). */
  async search(tenantId: string, q: string, limit = 20) {
    const term = q.trim();
    if (!term) {
      return { items: [] as ReturnType<CustomersService['toDto']>[] };
    }
    const rows = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.customer.findMany({
        where: {
          tenantId,
          isActive: true,
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { nameEn: { contains: term, mode: 'insensitive' } },
            {
              registrationId: {
                contains: term.replace(/\s+/g, ''),
                mode: 'insensitive',
              },
            },
            { code: { contains: term, mode: 'insensitive' } },
          ],
        },
        orderBy: [{ name: 'asc' }],
        take: Math.min(Math.max(limit, 1), 50),
      }),
    );
    return { items: rows.map((c) => this.toDto(c)) };
  }

  async get(tenantId: string, id: string) {
    const row = await this.tenantPrisma.withTenant(tenantId, (tx) =>
      tx.customer.findFirst({ where: { id, tenantId } }),
    );
    if (!row) throw new NotFoundException('Customer not found');
    return this.toDto(row);
  }

  async create(tenantId: string, actorUserId: string, input: CustomerWriteInput) {
    const data = normalizeCustomerWrite(input);
    try {
      const row = await this.tenantPrisma.withTenant(tenantId, (tx) =>
        tx.customer.create({
          data: {
            tenantId,
            type: data.type,
            registrationId: data.registrationId,
            name: data.name,
            nameEn: data.nameEn,
            addressJson: data.address as Prisma.InputJsonValue,
            code: data.code,
            email: data.email,
            phone: data.phone,
            isActive: data.isActive,
          },
        }),
      );
      await this.audit.write({
        action: 'customers.create',
        outcome: 'success',
        actorUserId,
        tenantId,
        resourceType: 'customer',
        resourceId: row.id,
      });
      return this.toDto(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          'A customer with this type and registration ID already exists',
        );
      }
      throw err;
    }
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: CustomerWriteInput,
  ) {
    const data = normalizeCustomerWrite(input);
    try {
      const row = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
        const existing = await tx.customer.findFirst({ where: { id, tenantId } });
        if (!existing) throw new NotFoundException('Customer not found');
        return tx.customer.update({
          where: { id },
          data: {
            type: data.type,
            registrationId: data.registrationId,
            name: data.name,
            nameEn: data.nameEn,
            addressJson: data.address as Prisma.InputJsonValue,
            code: data.code,
            email: data.email,
            phone: data.phone,
            isActive: data.isActive,
          },
        });
      });
      await this.audit.write({
        action: 'customers.update',
        outcome: 'success',
        actorUserId,
        tenantId,
        resourceType: 'customer',
        resourceId: row.id,
      });
      return this.toDto(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          'A customer with this type and registration ID already exists',
        );
      }
      throw err;
    }
  }

  async deactivate(tenantId: string, actorUserId: string, id: string) {
    const row = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.customer.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Customer not found');
      return tx.customer.update({
        where: { id },
        data: { isActive: false },
      });
    });
    await this.audit.write({
      action: 'customers.deactivate',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'customer',
      resourceId: row.id,
    });
    return this.toDto(row);
  }

  /** Exact ETA receiver shape for invoice autofill / payload comparison. */
  toEtaReceiver(customer: {
    type: string;
    registrationId: string;
    name: string;
    addressJson: unknown;
  }) {
    return customerToEtaReceiver(customer);
  }

  private toDto(row: {
    id: string;
    tenantId: string;
    type: string;
    registrationId: string;
    name: string;
    nameEn: string | null;
    addressJson: Prisma.JsonValue;
    code: string | null;
    email: string | null;
    phone: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const address =
      row.addressJson && typeof row.addressJson === 'object'
        ? (row.addressJson as Record<string, unknown>)
        : {};
    return {
      id: row.id,
      type: row.type,
      registrationId: row.registrationId,
      name: row.name,
      nameEn: row.nameEn,
      address,
      code: row.code,
      email: row.email,
      phone: row.phone,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      /** Ready-to-use document.receiver object (ETA shape). */
      receiver: customerToEtaReceiver(row),
    };
  }
}
