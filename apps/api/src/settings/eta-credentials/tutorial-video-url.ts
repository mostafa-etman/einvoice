import { BadRequestException } from '@nestjs/common';

const MAX_URL_LENGTH = 2000;

/** Empty string clears the setting. Non-empty must be https. */
export function parseTutorialVideoUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_URL_LENGTH) {
    throw new BadRequestException('eta_tutorial_video_url_too_long');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BadRequestException('eta_tutorial_video_url_invalid');
  }
  if (parsed.protocol !== 'https:') {
    throw new BadRequestException('eta_tutorial_video_url_https_required');
  }
  return parsed.toString();
}
