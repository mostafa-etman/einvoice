import { BadRequestException } from '@nestjs/common';

export function requireTenant(header: string | undefined): string {
  if (!header) {
    throw new BadRequestException('X-Tenant-Id header is required');
  }
  return header;
}
