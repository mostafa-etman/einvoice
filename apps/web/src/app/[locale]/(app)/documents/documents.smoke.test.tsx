import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('documents smoke', () => {
  it('has documents authoring labels', () => {
    expect(en.documents.new).toBeTruthy();
    expect(en.documents.lines).toBeTruthy();
    expect(ar.documents.save).toBeTruthy();
    expect(ar.nav.documents).toBeTruthy();
  });
});
