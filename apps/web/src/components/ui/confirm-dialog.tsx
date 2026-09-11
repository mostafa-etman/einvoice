'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from './modal';
import { Button } from './button';
import { Input } from './input';

export type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  danger?: boolean;
  typedConfirmation?: string;
  loading?: boolean;
};

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger = false,
  typedConfirmation,
  loading = false,
}: ConfirmDialogProps) {
  const t = useTranslations('common.actions');
  const tu = useTranslations('ui');
  const [typed, setTyped] = useState('');
  const needsType = Boolean(typedConfirmation);
  const canConfirm = !needsType || typed === typedConfirmation;

  return (
    <Modal
      open={open}
      onClose={() => {
        setTyped('');
        onClose();
      }}
      title={title ?? tu('confirmTitle')}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {cancelLabel ?? t('cancel')}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={!canConfirm || loading}
            loading={loading}
            onClick={() => {
              if (!canConfirm) return;
              onConfirm();
              setTyped('');
            }}
          >
            {confirmLabel ?? t('confirm')}
          </Button>
        </>
      }
    >
      {needsType && typedConfirmation ? (
        <Input
          label={tu('typedConfirmHint', { value: typedConfirmation })}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
        />
      ) : null}
    </Modal>
  );
}
