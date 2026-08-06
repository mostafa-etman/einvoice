import {
  classifyConflictingPaths,
  isOverlappingClash,
} from './conflict-classify';

describe('conflict-classify (T036)', () => {
  it('detects overlapping receiver.name', () => {
    const paths = classifyConflictingPaths(
      { receiver: { name: 'A' }, internalId: '1' },
      { receiver: { name: 'B' }, internalId: '1' },
    );
    expect(paths).toContain('receiver.name');
  });

  it('no clash when revisions match', () => {
    const r = isOverlappingClash(
      2,
      2,
      { receiver: { name: 'A' } },
      { receiver: { name: 'B' } },
    );
    expect(r.clash).toBe(false);
  });

  it('clash when stale revision and paths overlap', () => {
    const r = isOverlappingClash(
      1,
      2,
      { receiver: { name: 'A' }, lines: [] },
      { receiver: { name: 'B' }, lines: [] },
    );
    expect(r.clash).toBe(true);
  });
});
