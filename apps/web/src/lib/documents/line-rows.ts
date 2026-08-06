/**
 * Stable row identity for editable invoice line lists.
 *
 * Lines are ordered and otherwise indistinguishable (two identical lines are
 * legal), so React keys and remove actions cannot use the array index: removing
 * a middle row would make every later row inherit the previous row's DOM state.
 * The row key is UI-only and is stripped before the line is sent to the API.
 */

export type RowKeyed<T> = T & { rowKey: string };

let counter = 0;

export function newRowKey(): string {
  counter += 1;
  return `line-${counter}`;
}

export function withRowKey<T extends object>(line: T): RowKeyed<T> {
  return { ...line, rowKey: newRowKey() };
}

export function withRowKeys<T extends object>(lines: T[]): RowKeyed<T>[] {
  return lines.map((line) => withRowKey(line));
}

export function removeRowByKey<T extends { rowKey: string }>(rows: T[], rowKey: string): T[] {
  return rows.filter((row) => row.rowKey !== rowKey);
}

export function stripRowKey<T extends { rowKey: string }>(row: T): Omit<T, 'rowKey'> {
  const { rowKey: _rowKey, ...rest } = row;
  return rest;
}
