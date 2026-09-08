/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import middleware, { config } from './middleware';

function run(path: string, acceptLanguage?: string) {
  const headers = new Headers();
  if (acceptLanguage) headers.set('accept-language', acceptLanguage);
  return middleware(
    new NextRequest(`https://eta.erp-esafe.com${path}`, { headers }),
  );
}

function locationPath(res: Response): string {
  const loc = res.headers.get('location') ?? '';
  try {
    return new URL(loc).pathname;
  } catch {
    return loc;
  }
}

describe('i18n middleware redirects', () => {
  it('matcher includes /, locale prefixes, and unprefixed paths', () => {
    expect(config.matcher).toContain('/');
    expect(config.matcher.some((m) => m.includes('(ar|en)'))).toBe(true);
    expect(config.matcher.some((m) => m.includes('(?!api|_next|_vercel'))).toBe(
      true,
    );
  });

  it('redirects / to /ar when Accept-Language is missing or Arabic', () => {
    const none = run('/');
    expect(none.status).toBeGreaterThanOrEqual(300);
    expect(none.status).toBeLessThan(400);
    expect(locationPath(none)).toBe('/ar');

    const ar = run('/', 'ar,en;q=0.8');
    expect(locationPath(ar)).toBe('/ar');
  });

  it('redirects / to /en when Accept-Language prefers English', () => {
    const res = run('/', 'en-US,en;q=0.9');
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(locationPath(res)).toBe('/en');
  });

  it('redirects /login to a localized /login', () => {
    const ar = run('/login');
    expect(ar.status).toBeGreaterThanOrEqual(300);
    expect(ar.status).toBeLessThan(400);
    expect(locationPath(ar)).toBe('/ar/login');

    const en = run('/login', 'en');
    expect(locationPath(en)).toBe('/en/login');
  });

  it('keeps /ar and /en without bouncing to the other locale', () => {
    const ar = run('/ar');
    const en = run('/en');
    expect(locationPath(ar) === '/en' || ar.status < 300).toBe(true);
    expect(locationPath(en) === '/ar' || en.status < 300).toBe(true);
    expect(locationPath(ar)).not.toBe('/en');
    expect(locationPath(en)).not.toBe('/ar');
  });
});
