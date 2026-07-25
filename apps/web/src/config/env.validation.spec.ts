import { loadWebEnv } from './env';

describe('loadWebEnv', () => {
  const valid: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    PORT: '3000',
    NEXT_PUBLIC_API_URL: 'https://api.localhost',
    NEXT_PUBLIC_DEFAULT_LOCALE: 'ar',
  };

  it('loads valid configuration', () => {
    expect(loadWebEnv(valid).NEXT_PUBLIC_API_URL).toBe('https://api.localhost');
  });

  it('fails fast when NEXT_PUBLIC_API_URL is missing', () => {
    const rest: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      PORT: '3000',
      NEXT_PUBLIC_DEFAULT_LOCALE: 'ar',
    };
    expect(() => loadWebEnv(rest)).toThrow(/NEXT_PUBLIC_API_URL/i);
  });
});
