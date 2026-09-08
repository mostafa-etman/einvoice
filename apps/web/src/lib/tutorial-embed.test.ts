import { toTutorialEmbedUrl } from '@/lib/tutorial-embed';

describe('toTutorialEmbedUrl', () => {
  it('hides empty or invalid values', () => {
    expect(toTutorialEmbedUrl(null)).toBeNull();
    expect(toTutorialEmbedUrl('')).toBeNull();
    expect(toTutorialEmbedUrl('   ')).toBeNull();
    expect(toTutorialEmbedUrl('not-a-url')).toBeNull();
    expect(toTutorialEmbedUrl('http://youtube.com/watch?v=abc1234')).toBeNull();
  });

  it('converts YouTube watch / share / shorts links to embed', () => {
    expect(toTutorialEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    );
    expect(toTutorialEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    );
    expect(toTutorialEmbedUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    );
    expect(toTutorialEmbedUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    );
  });
});
