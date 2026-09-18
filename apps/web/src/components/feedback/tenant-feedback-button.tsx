'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { APP_SCREEN_KEYS, isTenantAdminRole, matchAppScreen, stripLocalePrefix } from '@einvoice/shared';
import { screenMessageKey } from '@/lib/screen-labels';
import { ApiError } from '@/lib/api/client';
import { submitFeedback } from '@/lib/api/feedback';
import { useTenant } from '@/lib/tenant-provider';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useMutationToast } from '@/components/ui/use-mutation-toast';

export function TenantFeedbackButton() {
  const { roleName } = useTenant();
  if (!roleName || !isTenantAdminRole({ name: roleName })) return null;
  return <TenantFeedbackDialog />;
}

function TenantFeedbackDialog() {
  const t = useTranslations('feedback');
  const tScreens = useTranslations('screens');
  const pathname = usePathname() ?? '/';
  const locale = useLocale();
  const toast = useMutationToast();
  const currentKey = matchAppScreen(pathname);
  const [open, setOpen] = useState(false);
  const [screenKey, setScreenKey] = useState(currentKey);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) {
      setScreenKey(matchAppScreen(pathname));
    }
  }, [open, pathname]);

  const routePath = useMemo(() => stripLocalePrefix(pathname), [pathname]);

  const mutation = useMutation({
    mutationFn: () =>
      submitFeedback({
        screenKey,
        routePath,
        note: note.trim(),
      }),
    onSuccess: () => {
      setNote('');
      setOpen(false);
      toast.created();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err : new Error(String(err))),
  });

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {t('button')}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('title')}
        description={t('hint')}
        size="lg"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              loading={mutation.isPending}
              disabled={!note.trim()}
              onClick={() => mutation.mutate()}
            >
              {t('submit')}
            </Button>
          </>
        }
      >
        <form
          className="space-y-token-md"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <Select
            label={t('screen')}
            value={screenKey}
            onChange={(e) => setScreenKey(e.target.value as typeof screenKey)}
          >
            {APP_SCREEN_KEYS.map((key) => (
              <option key={key} value={key}>
                {tScreens(screenMessageKey(key))}
              </option>
            ))}
          </Select>
          <p className="m-0 text-token-xs text-foreground-muted">
            {t('currentRoute')}:{' '}
            <span className="font-en" dir="ltr">
              {routePath}
            </span>
          </p>
          <Textarea
            label={t('note')}
            rows={8}
            required
            value={note}
            onChange={(e) => setNote(e.target.value)}
            dir={locale === 'ar' ? 'rtl' : 'ltr'}
          />
        </form>
      </Modal>
    </>
  );
}
