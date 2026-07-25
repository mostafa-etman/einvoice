import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { AuditService } from '../../audit/audit.service';

function rangesOverlap(
  aFrom: Date,
  aTo: Date | null,
  bFrom: Date,
  bTo: Date | null,
): boolean {
  const aEnd = aTo?.getTime() ?? Number.POSITIVE_INFINITY;
  const bEnd = bTo?.getTime() ?? Number.POSITIVE_INFINITY;
  return aFrom.getTime() < bEnd && bFrom.getTime() < aEnd;
}

@Injectable()
export class ExchangeRatesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(
    tenantId: string,
    filters?: { base?: string; quote?: string; asOf?: string },
  ) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.exchangeRate.findMany({
        where: {
          ...(filters?.base ? { baseCurrencyCode: filters.base } : {}),
          ...(filters?.quote ? { quoteCurrencyCode: filters.quote } : {}),
        },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (!filters?.asOf) {
        return rows.map(serializeRate);
      }
      const asOf = new Date(filters.asOf);
      const match = rows.find((r) => {
        if (r.effectiveFrom > asOf) return false;
        if (r.effectiveTo && r.effectiveTo <= asOf) return false;
        return true;
      });
      return match ? [serializeRate(match)] : [];
    });
  }

  async create(
    tenantId: string,
    actorUserId: string,
    input: {
      baseCurrencyCode: string;
      quoteCurrencyCode: string;
      rate: string;
      effectiveFrom: string;
      effectiveTo?: string | null;
    },
  ) {
    const rate = parseRate(input.rate);
    const effectiveFrom = new Date(input.effectiveFrom);
    const effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;
    if (effectiveTo && effectiveTo <= effectiveFrom) {
      throw new BadRequestException('effectiveTo must be after effectiveFrom');
    }

    const created = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      await this.assertNoOverlap(
        tx,
        tenantId,
        input.baseCurrencyCode,
        input.quoteCurrencyCode,
        effectiveFrom,
        effectiveTo,
      );
      return tx.exchangeRate.create({
        data: {
          tenantId,
          baseCurrencyCode: input.baseCurrencyCode,
          quoteCurrencyCode: input.quoteCurrencyCode,
          rate,
          source: 'MANUAL',
          effectiveFrom,
          effectiveTo,
        },
      });
    });

    await this.audit.write({
      action: 'settings.exchange_rate.create',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'exchange_rate',
      resourceId: created.id,
      metadata: {
        base: created.baseCurrencyCode,
        quote: created.quoteCurrencyCode,
      },
    });
    return serializeRate(created);
  }

  async update(
    tenantId: string,
    actorUserId: string,
    id: string,
    input: {
      baseCurrencyCode: string;
      quoteCurrencyCode: string;
      rate: string;
      effectiveFrom: string;
      effectiveTo?: string | null;
    },
  ) {
    const rate = parseRate(input.rate);
    const effectiveFrom = new Date(input.effectiveFrom);
    const effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;

    const updated = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.exchangeRate.findFirst({
        where: { id, tenantId },
      });
      if (!existing) {
        throw new NotFoundException('Exchange rate not found');
      }
      await this.assertNoOverlap(
        tx,
        tenantId,
        input.baseCurrencyCode,
        input.quoteCurrencyCode,
        effectiveFrom,
        effectiveTo,
        id,
      );
      return tx.exchangeRate.update({
        where: { id },
        data: {
          baseCurrencyCode: input.baseCurrencyCode,
          quoteCurrencyCode: input.quoteCurrencyCode,
          rate,
          effectiveFrom,
          effectiveTo,
        },
      });
    });

    await this.audit.write({
      action: 'settings.exchange_rate.update',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'exchange_rate',
      resourceId: updated.id,
    });
    return serializeRate(updated);
  }

  async remove(tenantId: string, actorUserId: string, id: string) {
    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.exchangeRate.findFirst({
        where: { id, tenantId },
      });
      if (!existing) {
        throw new NotFoundException('Exchange rate not found');
      }
      await tx.exchangeRate.delete({ where: { id } });
    });
    await this.audit.write({
      action: 'settings.exchange_rate.delete',
      outcome: 'success',
      actorUserId,
      tenantId,
      resourceType: 'exchange_rate',
      resourceId: id,
    });
  }

  private async assertNoOverlap(
    tx: Prisma.TransactionClient,
    tenantId: string,
    base: string,
    quote: string,
    from: Date,
    to: Date | null,
    excludeId?: string,
  ) {
    const others = await tx.exchangeRate.findMany({
      where: {
        tenantId,
        baseCurrencyCode: base,
        quoteCurrencyCode: quote,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    for (const other of others) {
      if (rangesOverlap(from, to, other.effectiveFrom, other.effectiveTo)) {
        throw new BadRequestException(
          'Overlapping exchange rate period for this currency pair',
        );
      }
    }
  }
}

function parseRate(raw: string): Prisma.Decimal {
  const rate = new Prisma.Decimal(raw);
  if (rate.lte(0)) {
    throw new BadRequestException('rate must be greater than 0');
  }
  return rate;
}

function serializeRate(row: {
  id: string;
  baseCurrencyCode: string;
  quoteCurrencyCode: string;
  rate: Prisma.Decimal;
  source: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}) {
  return {
    id: row.id,
    baseCurrencyCode: row.baseCurrencyCode,
    quoteCurrencyCode: row.quoteCurrencyCode,
    rate: row.rate.toFixed(),
    source: row.source,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
  };
}
