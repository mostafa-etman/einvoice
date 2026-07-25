export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { loadWebEnv } = await import('./config/env');
    loadWebEnv();
  }
}
