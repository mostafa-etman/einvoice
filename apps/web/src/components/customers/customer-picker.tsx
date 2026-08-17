'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import {
  createCustomer,
  searchCustomers,
  type Customer,
} from '@/lib/api/customers';
import { ApiError } from '@/lib/api/client';
import type { AddressInput } from '@/lib/api/documents';

type ReceiverState = {
  type: string;
  id: string;
  name: string;
  address: AddressInput;
};

type Props = {
  receiver: ReceiverState;
  onPick: (receiver: ReceiverState) => void;
  disabled?: boolean;
};

export function CustomerPicker({ receiver, onPick, disabled }: Props) {
  const t = useTranslations('customers');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [pickedLabel, setPickedLabel] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      void searchCustomers(q, 15)
        .then((res) => {
          setResults(res.items);
          setOpen(true);
        })
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const saveAsCustomer = useMutation({
    mutationFn: () =>
      createCustomer({
        type: receiver.type,
        registrationId: receiver.id,
        name: receiver.name,
        address: receiver.address,
        isActive: true,
      }),
    onSuccess: (c) => {
      setSaveErr(null);
      setSaveMsg(t('savedAsCustomer', { name: c.name }));
      setPickedLabel(`${c.name} · ${c.registrationId}`);
    },
    onError: (err) => {
      setSaveMsg(null);
      setSaveErr(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : t('errorGeneric'),
      );
    },
  });

  const canSave =
    Boolean(receiver.id?.trim() && receiver.name?.trim() && receiver.type) &&
    !disabled;

  return (
    <div className="space-y-token-sm rounded border border-dashed border-border bg-background/50 p-token-sm">
      <label className="block text-token-sm">
        {t('pickerLabel')}
        <input
          className="mt-token-xs block w-full rounded border border-border bg-surface px-token-sm py-token-sm"
          placeholder={t('pickerPlaceholder')}
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setPickedLabel(null);
            setSaveMsg(null);
            setSaveErr(null);
          }}
          onFocus={() => {
            if (results.length) setOpen(true);
          }}
        />
      </label>
      {pickedLabel ? (
        <p className="text-token-xs text-foreground/70">
          {t('picked', { label: pickedLabel })}
        </p>
      ) : null}
      {open && results.length > 0 ? (
        <div className="max-h-48 overflow-auto rounded border border-border bg-surface">
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              className="block w-full border-b border-border px-token-sm py-token-xs text-start text-token-xs hover:bg-brand-muted"
              onClick={() => {
                onPick(c.receiver);
                setPickedLabel(`${c.name} · ${c.registrationId}`);
                setQuery('');
                setResults([]);
                setOpen(false);
                setSaveMsg(null);
                setSaveErr(null);
              }}
            >
              <span className="font-medium">{c.name}</span>
              {c.nameEn ? (
                <span className="ms-token-sm text-foreground/60" dir="ltr">
                  {c.nameEn}
                </span>
              ) : null}
              <span className="ms-token-sm font-mono text-foreground/70" dir="ltr">
                {c.registrationId}
              </span>
              {c.code ? (
                <span className="ms-token-sm text-foreground/60" dir="ltr">
                  {c.code}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      <p className="text-token-xs text-foreground/60">{t('pickerHint')}</p>
      <div className="flex flex-wrap items-center gap-token-sm">
        <button
          type="button"
          disabled={!canSave || saveAsCustomer.isPending}
          className="rounded border border-border px-token-sm py-token-xs text-token-xs disabled:opacity-50"
          onClick={() => saveAsCustomer.mutate()}
        >
          {t('saveCurrentReceiver')}
        </button>
        {saveMsg ? (
          <span className="text-token-xs text-foreground/70">{saveMsg}</span>
        ) : null}
        {saveErr ? (
          <span className="text-token-xs text-red-700">{saveErr}</span>
        ) : null}
      </div>
    </div>
  );
}
