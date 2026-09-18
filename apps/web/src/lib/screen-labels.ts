/** next-intl treats dots as nested paths, so catalog keys like `documents.detail` become `documents_detail`. */
export function screenMessageKey(screenKey: string): string {
  return screenKey.replace(/\./g, '_');
}
