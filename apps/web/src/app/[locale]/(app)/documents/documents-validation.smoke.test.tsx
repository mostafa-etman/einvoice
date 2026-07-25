import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('documents validation smoke', () => {
  it('has validation copy', () => {
    expect(en.documents.validationOk).toBeTruthy();
    expect(en.documents.validationFailed).toBeTruthy();
    expect(ar.documents.validate).toBeTruthy();
  });
});
