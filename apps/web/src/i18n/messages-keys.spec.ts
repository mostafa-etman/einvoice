import ar from '@/messages/ar.json';
import en from '@/messages/en.json';

function keysContainingDot(value: unknown, path = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const found: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (key.includes('.')) {
      found.push(nextPath);
    }
    found.push(...keysContainingDot(child, nextPath));
  }
  return found;
}

describe('next-intl message keys', () => {
  it('does not use "." in en.json or ar.json object keys', () => {
    expect(keysContainingDot(en)).toEqual([]);
    expect(keysContainingDot(ar)).toEqual([]);
  });
});
