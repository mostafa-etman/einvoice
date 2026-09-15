'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createTenant } from '@/lib/api/tenants';
import { ApiError } from '@/lib/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useMutationToast } from '@/components/ui/use-mutation-toast';
import { FALLBACK_WHATSAPP_URL } from '@/lib/support-whatsapp';

const schema = z.object({
  name: z.string().min(2),
  taxRegistrationNumber: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

function limitWhatsAppUrl(err: ApiError): string | null {
  const body = err.body;
  if (typeof body !== 'object' || !body || !('whatsappUrl' in body)) return null;
  const url = (body as { whatsappUrl?: unknown }).whatsappUrl;
  return typeof url === 'string' && url.trim() ? url : null;
}

export default function CreateCompanyPage() {
  const t = useTranslations('shell');
  const ta = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useMutationToast();
  const [error, setError] = useState<string | null>(null);
  const [whatsappUrl, setWhatsappUrl] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });
  const { ref: nameRef, ...nameField } = register('name');
  const { ref: taxRef, ...taxField } = register('taxRegistrationNumber');

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    setWhatsappUrl(null);
    try {
      const created = await createTenant(values.name, {
        taxRegistrationNumber: values.taxRegistrationNumber?.trim() || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ['tenants'] });
      if (created.activationStatus === 'ACTIVE') {
        router.push(`/${locale}/settings/eta-credentials`);
      } else {
        router.push(`/${locale}`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const msg = typeof err.message === 'string' && err.message ? err.message : ta('companyLimit');
        setError(msg);
        setWhatsappUrl(limitWhatsAppUrl(err) ?? FALLBACK_WHATSAPP_URL);
        toast.error(err, msg);
        return;
      }
      setError(ta('errorGeneric'));
      toast.error(err, ta('errorGeneric'));
    }
  });

  return (
    <div className="mx-auto max-w-lg" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <PageHeader title={t('createCompanyTitle')} subtitle={t('createCompanyHint')} />
      <Card>
        <CardBody>
          <form className="flex flex-col" onSubmit={onSubmit}>
            <Input
              label={ta('tenantName')}
              type="text"
              error={errors.name ? ta('fillCompanyFirst') : undefined}
              {...nameField}
              ref={nameRef}
            />
            <Input
              label={ta('taxRegistrationNumber')}
              type="text"
              inputMode="numeric"
              dir="ltr"
              autoComplete="off"
              hint={t('createCompanyTaxHint')}
              {...taxField}
              ref={taxRef}
            />
            {error ? (
              <p
                className="mb-token-md rounded-md border border-danger/30 bg-danger-muted px-token-sm py-token-sm text-token-sm text-danger"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            {whatsappUrl ? (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-token-md inline-flex items-center justify-center rounded-button bg-brand px-button-x py-button-y text-button font-medium text-on-dark shadow-xs hover:bg-brand-strong"
              >
                {t('createCompanyLimitWhatsApp')}
              </a>
            ) : null}
            <Button type="submit" size="lg" block loading={isSubmitting}>
              {t('createCompany')}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
