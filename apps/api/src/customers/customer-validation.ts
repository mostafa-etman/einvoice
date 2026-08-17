import { BadRequestException } from '@nestjs/common';

export type CustomerReceiverType = 'B' | 'P' | 'F';

export type CustomerAddressInput = {
  country?: string;
  governate?: string;
  regionCity?: string;
  street?: string;
  buildingNumber?: string;
  postalCode?: string;
  floor?: string;
  room?: string;
  landmark?: string;
  additionalInformation?: string;
};

export type CustomerWriteInput = {
  type: string;
  registrationId: string;
  name: string;
  nameEn?: string | null;
  address: CustomerAddressInput;
  code?: string | null;
  email?: string | null;
  phone?: string | null;
  isActive?: boolean;
};

const TYPES = new Set<CustomerReceiverType>(['B', 'P', 'F']);

/** Normalize and validate a customer write payload against ETA receiver rules. */
export function normalizeCustomerWrite(input: CustomerWriteInput): {
  type: CustomerReceiverType;
  registrationId: string;
  name: string;
  nameEn: string | null;
  address: CustomerAddressInput;
  code: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
} {
  const type = String(input.type ?? '').trim().toUpperCase() as CustomerReceiverType;
  if (!TYPES.has(type)) {
    throw new BadRequestException('type must be B (Company), P (Person), or F (Foreign)');
  }

  const registrationId = String(input.registrationId ?? '')
    .trim()
    .replace(/\s+/g, '');
  if (!registrationId) {
    throw new BadRequestException('registrationId is required');
  }
  validateRegistrationId(type, registrationId);

  const name = String(input.name ?? '').trim();
  if (!name) {
    throw new BadRequestException('name is required');
  }

  const address = sanitizeAddress(input.address);
  if (!address.country) {
    throw new BadRequestException('address.country is required');
  }

  // Domestic parties need a usable Egyptian address for ETA invoices.
  if ((type === 'B' || type === 'P') && address.country === 'EG') {
    for (const key of ['governate', 'regionCity', 'street', 'buildingNumber'] as const) {
      if (!address[key]?.trim()) {
        throw new BadRequestException(`address.${key} is required for Egyptian ${type === 'B' ? 'companies' : 'persons'}`);
      }
    }
  }

  const email = optionalTrim(input.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException('email is invalid');
  }

  return {
    type,
    registrationId,
    name,
    nameEn: optionalTrim(input.nameEn),
    address,
    code: optionalTrim(input.code),
    email,
    phone: optionalTrim(input.phone),
    isActive: input.isActive !== false,
  };
}

function validateRegistrationId(type: CustomerReceiverType, id: string) {
  if (type === 'B') {
    // Egyptian tax registration number: 9 digits.
    if (!/^\d{9}$/.test(id)) {
      throw new BadRequestException(
        'Company tax registration number must be exactly 9 digits',
      );
    }
    return;
  }
  if (type === 'P') {
    // Egyptian national ID: 14 digits.
    if (!/^\d{14}$/.test(id)) {
      throw new BadRequestException('Person national ID must be exactly 14 digits');
    }
    return;
  }
  // Foreign: non-empty alphanumeric-ish id (passport / foreign tax id).
  if (id.length < 3 || id.length > 50) {
    throw new BadRequestException('Foreign ID must be between 3 and 50 characters');
  }
}

function sanitizeAddress(raw: CustomerAddressInput | undefined): CustomerAddressInput {
  const src = raw ?? {};
  const out: CustomerAddressInput = {};
  for (const key of [
    'country',
    'governate',
    'regionCity',
    'street',
    'buildingNumber',
    'postalCode',
    'floor',
    'room',
    'landmark',
    'additionalInformation',
  ] as const) {
    const v = optionalTrim(src[key]);
    if (v) out[key] = v;
  }
  if (out.country) out.country = out.country.toUpperCase();
  return out;
}

function optionalTrim(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}

/** Map a customer row to the exact ETA receiver object shape used on documents. */
export function customerToEtaReceiver(customer: {
  type: string;
  registrationId: string;
  name: string;
  addressJson: unknown;
}): {
  type: string;
  id: string;
  name: string;
  address: CustomerAddressInput;
} {
  const address =
    customer.addressJson && typeof customer.addressJson === 'object'
      ? (customer.addressJson as CustomerAddressInput)
      : {};
  return {
    type: customer.type,
    id: customer.registrationId,
    name: customer.name,
    address: { ...address },
  };
}
