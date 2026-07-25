import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  NEXT_PUBLIC_API_URL: z.string().url(),
  NEXT_PUBLIC_DEFAULT_LOCALE: z.enum(['en', 'ar']).default('ar'),
});

export type WebEnv = z.infer<typeof envSchema>;

export function loadWebEnv(env: NodeJS.ProcessEnv = process.env): WebEnv {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const missing = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${missing}`);
  }
  return result.data;
}
