import type { AddressInput } from '@/lib/api/documents';
import type { CustomerWrite } from '@/lib/api/customers';

export const PAGE_SIZE = 25;

export const emptyAddress = (): AddressInput => ({
  country: 'EG',
  governate: '',
  regionCity: '',
  street: '',
  buildingNumber: '',
});

export const emptyForm = (): CustomerWrite => ({
  type: 'B',
  registrationId: '',
  name: '',
  nameEn: '',
  address: emptyAddress(),
  code: '',
  email: '',
  phone: '',
  isActive: true,
});

export const ADDRESS_FIELDS = [
  ['governate', 'governate'],
  ['regionCity', 'regionCity'],
  ['street', 'street'],
  ['buildingNumber', 'buildingNumber'],
  ['postalCode', 'postalCode'],
  ['floor', 'floor'],
  ['room', 'room'],
  ['landmark', 'landmark'],
] as const;

export type ActiveFilter = 'all' | 'true' | 'false';
