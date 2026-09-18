import {
  lastUuidAfterAccept,
  lastUuidAfterReject,
  isStructuralChainTip,
} from './receipt-chain';

describe('receipt POS chain on submit', () => {
  it('advances lastReceiptUuid only when this receipt is the tip or follows previous', () => {
    expect(lastUuidAfterAccept('', 'aaa', '')).toBe('aaa');
    expect(lastUuidAfterAccept('prev', 'aaa', 'prev')).toBe('aaa');
    expect(lastUuidAfterAccept('aaa', 'aaa', 'prev')).toBe('aaa');
    expect(lastUuidAfterAccept('other', 'aaa', 'prev')).toBe('other');
  });

  it('rolls back the tip on reject and leaves a later chain alone', () => {
    expect(lastUuidAfterReject('aaa', 'aaa', 'prev')).toBe('prev');
    expect(lastUuidAfterReject('later', 'aaa', 'prev')).toBe('later');
  });

  it('treats a receipt as tip when nothing points at it as previousUuid', () => {
    expect(isStructuralChainTip('a', ['', 'x'])).toBe(true);
    expect(isStructuralChainTip('a', ['a'])).toBe(false);
  });
});
