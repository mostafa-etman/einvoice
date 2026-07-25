import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('documents preview smoke', () => {
  it('has preview panel copy', () => {
    expect(en.documents.previewJson).toBeTruthy();
    expect(en.documents.previewCanonical).toBeTruthy();
    expect(ar.documents.previewCanonical).toBeTruthy();
  });
});
