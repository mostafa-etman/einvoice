/** Convert a stored YouTube/watch URL into an iframe-safe https embed src. */
export function toTutorialEmbedUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;

  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  if (host === 'youtu.be') {
    const id = parsed.pathname.split('/').filter(Boolean)[0];
    return youtubeEmbed(id);
  }
  if (
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'youtube-nocookie.com'
  ) {
    if (parsed.pathname.startsWith('/embed/')) {
      const id = parsed.pathname.split('/')[2];
      return youtubeEmbed(id);
    }
    if (parsed.pathname.startsWith('/shorts/')) {
      const id = parsed.pathname.split('/')[2];
      return youtubeEmbed(id);
    }
    const fromQuery = parsed.searchParams.get('v');
    if (fromQuery) return youtubeEmbed(fromQuery);
    return null;
  }
  return parsed.toString();
}

function youtubeEmbed(id: string | undefined): string | null {
  if (!id || !/^[A-Za-z0-9_-]{6,}$/.test(id)) return null;
  return `https://www.youtube.com/embed/${id}`;
}
