import type { FormEvent } from 'react';
import type { useTranslations } from 'next-intl';
import type { CustomerWrite } from '@/lib/api/customers';
import type { EtaCodeEntry } from '@/lib/api/eta-codes';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ADDRESS_FIELDS } from './customer-list-utils';

export function CustomerForm({
  form,
  onChange,
  countries,
  locale,
  t,
  error,
  formId,
  onSubmit,
}: {
  form: CustomerWrite;
  onChange: (next: CustomerWrite) => void;
  countries: EtaCodeEntry[];
  locale: string;
  t: ReturnType<typeof useTranslations<'customers'>>;
  error: string | null;
  formId: string;
  onSubmit: () => void;
}) {
  const idHint =
    form.type === 'B'
      ? t('idHintB')
      : form.type === 'P'
        ? t('idHintP')
        : t('idHintF');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  const countryOptions: EtaCodeEntry[] = countries.length
    ? countries
    : [
        {
          code: 'EG',
          nameEn: 'Egypt',
          nameAr: 'مصر',
          parentCode: null,
          meta: null,
        },
      ];

  return (
    <form id={formId} className="space-y-token-md" onSubmit={handleSubmit} data-testid="customer-form">
      <div className="grid gap-token-md sm:grid-cols-2">
        <Select
          label={t('type')}
          value={form.type}
          onChange={(e) => onChange({ ...form, type: e.target.value })}
        >
          <option value="B">{t('typeB')}</option>
          <option value="P">{t('typeP')}</option>
          <option value="F">{t('typeF')}</option>
        </Select>
        <Input
          label={t('registrationId')}
          hint={idHint}
          className="font-en"
          dir="ltr"
          value={form.registrationId}
          onChange={(e) => onChange({ ...form, registrationId: e.target.value })}
        />
        <Input
          label={t('name')}
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
        />
        <Input
          label={t('nameEn')}
          dir="ltr"
          value={form.nameEn ?? ''}
          onChange={(e) => onChange({ ...form, nameEn: e.target.value })}
        />
        <Input
          label={t('code')}
          className="font-en"
          dir="ltr"
          value={form.code ?? ''}
          onChange={(e) => onChange({ ...form, code: e.target.value })}
        />
        <Input
          label={t('email')}
          className="font-en"
          dir="ltr"
          type="email"
          value={form.email ?? ''}
          onChange={(e) => onChange({ ...form, email: e.target.value })}
        />
        <Input
          label={t('phone')}
          className="font-en"
          dir="ltr"
          value={form.phone ?? ''}
          onChange={(e) => onChange({ ...form, phone: e.target.value })}
        />
      </div>

      <h3 className="m-0 text-token-sm font-semibold text-foreground">{t('address')}</h3>
      <div className="grid gap-token-md sm:grid-cols-2">
        <Select
          label={t('country')}
          value={form.address.country ?? 'EG'}
          onChange={(e) =>
            onChange({
              ...form,
              address: { ...form.address, country: e.target.value },
            })
          }
        >
          {countryOptions.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {locale === 'ar' && c.nameAr ? c.nameAr : c.nameEn}
            </option>
          ))}
        </Select>
        {ADDRESS_FIELDS.map(([key, labelKey]) => (
          <Input
            key={key}
            label={t(labelKey)}
            value={form.address[key] ?? ''}
            onChange={(e) =>
              onChange({
                ...form,
                address: { ...form.address, [key]: e.target.value },
              })
            }
          />
        ))}
        <div className="sm:col-span-2">
          <Input
            label={t('additionalInformation')}
            value={form.address.additionalInformation ?? ''}
            onChange={(e) =>
              onChange({
                ...form,
                address: {
                  ...form.address,
                  additionalInformation: e.target.value,
                },
              })
            }
          />
        </div>
      </div>

      {error ? (
        <p className="m-0 text-token-sm font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
