'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function ReasonDialog({
  open,
  title,
  description,
  label,
  confirmLabel,
  danger = false,
  required = true,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  label: ReactNode;
  confirmLabel?: ReactNode;
  danger?: boolean;
  required?: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const t = useTranslations('common.actions');
  const [value, setValue] = useState('');

  useEffect(() => {
    if (open) setValue('');
  }, [open]);

  const canSubmit = !required || value.trim().length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={!canSubmit}
            onClick={() => {
              if (!canSubmit) return;
              onSubmit(value);
              setValue('');
            }}
          >
            {confirmLabel ?? t('confirm')}
          </Button>
        </>
      }
    >
      <Input label={label} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
    </Modal>
  );
}
