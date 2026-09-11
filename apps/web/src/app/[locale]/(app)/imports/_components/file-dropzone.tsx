'use client';

import { useRef, useState, type DragEvent } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';

const ACCEPT =
  '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function isAcceptedFile(file: File) {
  const name = file.name.toLowerCase();
  return name.endsWith('.csv') || name.endsWith('.xlsx');
}

export function FileDropzone({
  disabled,
  busy,
  label,
  hint,
  typesHint,
  onFile,
}: {
  disabled?: boolean;
  busy?: boolean;
  label: string;
  hint: string;
  typesHint: string;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function takeFile(file: File | undefined | null) {
    if (!file || disabled || busy) return;
    if (!isAcceptedFile(file)) return;
    onFile(file);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    takeFile(e.dataTransfer.files[0]);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled && !busy) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        'rounded-lg border-2 border-dashed px-token-lg py-token-xl text-center',
        over ? 'border-brand bg-brand-muted' : 'border-border bg-surface',
      )}
    >
      <p className="m-0 text-token-sm text-foreground-muted">{hint}</p>
      <p className="mt-token-xs text-token-xs text-foreground-subtle">
        {typesHint}{' '}
        <span className="font-en" dir="ltr">
          .csv, .xlsx
        </span>
      </p>
      <div className="mt-token-md">
        <Button
          type="button"
          disabled={disabled || busy}
          loading={busy}
          onClick={() => inputRef.current?.click()}
        >
          {label}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          aria-label={label}
          disabled={disabled || busy}
          onChange={(e) => {
            takeFile(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
