import fs from 'node:fs';
import path from 'node:path';
import {
  EXPORT_COLUMN_MESSAGE_PATHS,
  EXPORT_DOC_FIELDS,
  exportColumnHeaders,
  exportColumnLabel,
} from './export-column-labels';

function lookup(messages: Record<string, unknown>, dotted: string): string {
  const parts = dotted.split('.');
  let cur: unknown = messages;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return '';
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'string' ? cur : '';
}

describe('export column labels reuse web i18n', () => {
  const en = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../../../web/src/messages/en.json'),
      'utf8',
    ),
  ) as Record<string, unknown>;
  const ar = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../../../web/src/messages/ar.json'),
      'utf8',
    ),
  ) as Record<string, unknown>;

  it('matches canonical application strings for every export column', () => {
    for (const field of EXPORT_DOC_FIELDS) {
      const key = EXPORT_COLUMN_MESSAGE_PATHS[field];
      expect(exportColumnLabel(field, 'en')).toBe(lookup(en, key));
      expect(exportColumnLabel(field, 'ar')).toBe(lookup(ar, key));
    }
  });

  it('keeps legacy field-name headers when locale is omitted', () => {
    expect(exportColumnHeaders()).toEqual([...EXPORT_DOC_FIELDS]);
  });

  it('does not mix languages in a locale set', () => {
    const arHeaders = exportColumnHeaders('ar');
    const enHeaders = exportColumnHeaders('en');
    expect(arHeaders).toContain('رقم الفاتورة');
    expect(arHeaders).toContain('تاريخ الإصدار');
    expect(arHeaders).toContain('نوع المستند');
    expect(arHeaders).not.toContain('Invoice #');
    expect(enHeaders).toContain('Invoice #');
    expect(enHeaders).toContain('Issue date');
    expect(enHeaders).toContain('Document type');
    expect(enHeaders).not.toContain('رقم الفاتورة');
  });
});
