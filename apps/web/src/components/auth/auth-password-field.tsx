'use client';

import { useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { EyeIcon, EyeOffIcon, LockIcon } from './auth-icons';

export function AuthPasswordField({
  registration,
  error,
  autoComplete,
  showStrength,
  value,
}: {
  registration: UseFormRegisterReturn;
  error?: string;
  autoComplete: string;
  showStrength?: boolean;
  value?: string;
}) {
  const t = useTranslations('auth');
  const [visible, setVisible] = useState(false);
  const [caps, setCaps] = useState(false);
  const length = value?.length ?? 0;
  const strength = length === 0 ? 0 : length < 8 ? 40 : 100;

  const { ref, ...rest } = registration;

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    setCaps(e.getModifierState('CapsLock'));
  };

  return (
    <div>
      <Input
        ref={ref}
        {...rest}
        label={t('password')}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        error={error}
        iconStart={<LockIcon />}
        iconEnd={
          <button
            type="button"
            className="rounded-sm text-foreground-muted hover:text-foreground"
            aria-pressed={visible}
            aria-label={visible ? t('hidePassword') : t('showPassword')}
            onClick={() => setVisible((v) => !v)}
          >
            {visible ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        }
        onKeyUp={onKey}
        onKeyDown={onKey}
      />
      {caps ? <p className="mb-token-sm text-token-xs text-warning">{t('capsLock')}</p> : null}
      {showStrength && length > 0 ? (
        <div className="mb-token-md">
          <Progress value={strength} max={100} label={t('passwordStrength')} />
          <p className="mt-token-2xs text-token-xs text-foreground-muted">
            {length < 8 ? t('passwordTooShort') : t('passwordReady')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
