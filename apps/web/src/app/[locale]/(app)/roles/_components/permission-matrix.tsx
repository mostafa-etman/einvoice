'use client';

import { Checkbox } from '@/components/ui/checkbox';

export function PermissionMatrix({
  groups,
  labels,
  groupLabel,
  selectAllLabel,
  checked,
  disabled,
  onToggle,
  onToggleGroup,
}: {
  groups: Array<{ id: string; codes: string[] }>;
  labels: Record<string, string>;
  groupLabel: (id: string) => string;
  selectAllLabel: string;
  checked: Set<string>;
  disabled: boolean;
  onToggle: (code: string, on: boolean) => void;
  onToggleGroup: (codes: string[], on: boolean) => void;
}) {
  return (
    <div className="mt-token-lg space-y-token-md">
      {groups.map((group) => {
        const allOn = group.codes.every((c) => checked.has(c));
        return (
          <fieldset
            key={group.id}
            className="rounded-lg border border-border p-token-sm"
            disabled={disabled}
          >
            <legend className="px-token-xs font-medium text-foreground">{groupLabel(group.id)}</legend>
            <div className="mb-token-sm">
              <Checkbox
                label={selectAllLabel}
                checked={allOn}
                disabled={disabled}
                onChange={(e) => onToggleGroup(group.codes, e.target.checked)}
              />
            </div>
            <ul className="m-0 list-none space-y-token-xs p-0">
              {group.codes.map((code) => (
                <li key={code}>
                  <Checkbox
                    disabled={disabled}
                    checked={checked.has(code)}
                    onChange={(e) => onToggle(code, e.target.checked)}
                    label={
                      <span>
                        <span className="block">{labels[code] ?? code}</span>
                        <span className="font-en text-token-xs text-foreground-subtle" dir="ltr">
                          {code}
                        </span>
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}
