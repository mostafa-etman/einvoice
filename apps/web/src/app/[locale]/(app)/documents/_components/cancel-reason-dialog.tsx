'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';

export function CancelReasonDialog({
  open,
  loading,
  onClose,
  onConfirm,
}: {
  open: boolean;
  loading?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const t = useTranslations('documents');
  const tActions = useTranslations('common.actions');
  const [reason, setReason] = useState('');

  return (
    <Modal
      open={open}
      onClose={() => {
        setReason('');
        onClose();
      }}
      title={t('cancelReasonLabel')}
      description={t('cancelReasonPrompt')}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={loading}
            onClick={() => {
              setReason('');
              onClose();
            }}
          >
            {tActions('cancel')}
          </Button>
          <Button
            variant="danger"
            loading={loading}
            onClick={() => {
              onConfirm(reason);
              setReason('');
            }}
          >
            {t('cancelDocument')}
          </Button>
        </>
      }
    >
      <Input
        label={t('cancelReasonLabel')}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        autoComplete="off"
      />
    </Modal>
  );
}
