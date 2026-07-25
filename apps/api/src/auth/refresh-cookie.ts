import { serialize, type CookieSerializeOptions } from 'cookie';
import type { Response } from 'express';
import type { ApiEnv } from '../config/env';

/**
 * Refresh-cookie attributes for credentialed calls from https://web.localhost
 * to https://api.localhost.
 *
 * Why Partitioned (CHIPS)?
 * Chromium treats sibling `*.localhost` hosts as **cross-site** (localhost is not
 * a normal eTLD+1). A cross-site Set-Cookie with only SameSite=None; Secure is
 * blocked by third-party cookie phaseout unless it includes **Partitioned**.
 * DevTools shows a warning on the Set-Cookie line, e.g.:
 *   "This Set-Cookie was blocked because it had the \"SameSite=None\" attribute
 *    but did not have the \"Partitioned\" attribute"
 * (wording varies by Chrome version).
 *
 * Settled attributes (local HTTPS via Traefik):
 * - HttpOnly, Secure, SameSite=None, Path=/
 * - Partitioned (when COOKIE_PARTITIONED=true) — required for cross-site storage
 * - Domain omitted — host-only on api.localhost (Domain=.localhost is often rejected)
 */
export function buildRefreshSerializeOptions(
  env: ApiEnv,
  forClear = false,
): CookieSerializeOptions {
  const options: CookieSerializeOptions = {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    path: '/',
  };
  if (!forClear) {
    // cookie.serialize maxAge is in **seconds** (unlike Express res.cookie ms)
    options.maxAge = env.REFRESH_TTL_DAYS * 24 * 60 * 60;
  } else {
    options.maxAge = 0;
    options.expires = new Date(0);
  }
  if (env.COOKIE_DOMAIN?.trim()) {
    options.domain = env.COOKIE_DOMAIN.trim();
  }
  if (env.COOKIE_PARTITIONED) {
    options.partitioned = true;
  }
  return options;
}

export function setRefreshCookieHeader(
  res: Response,
  env: ApiEnv,
  raw: string,
): void {
  res.append(
    'Set-Cookie',
    serialize(env.REFRESH_COOKIE_NAME, raw, buildRefreshSerializeOptions(env)),
  );
}

export function clearRefreshCookieHeader(res: Response, env: ApiEnv): void {
  res.append(
    'Set-Cookie',
    serialize(env.REFRESH_COOKIE_NAME, '', buildRefreshSerializeOptions(env, true)),
  );
}

/** Alias kept for unit tests / callers */
export function buildRefreshCookieOptions(env: ApiEnv, forClear = false) {
  return buildRefreshSerializeOptions(env, forClear);
}
