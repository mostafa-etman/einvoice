import { parseTutorialVideoUrl } from './tutorial-video-url';

describe('parseTutorialVideoUrl', () => {
  it('treats blank as hidden', () => {
    expect(parseTutorialVideoUrl(null)).toBeNull();
    expect(parseTutorialVideoUrl('')).toBeNull();
    expect(parseTutorialVideoUrl('   ')).toBeNull();
  });

  it('accepts https YouTube URLs', () => {
    expect(parseTutorialVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toContain(
      'youtube.com',
    );
  });

  it('rejects non-https', () => {
    expect(() => parseTutorialVideoUrl('http://www.youtube.com/watch?v=abc')).toThrow(
      /https_required/,
    );
    expect(() => parseTutorialVideoUrl('not-a-url')).toThrow(/invalid/);
  });
});
