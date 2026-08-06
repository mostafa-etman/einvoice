import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('purchases smoke', () => {
  it('has purchases nav and module labels', () => {
    expect(en.nav.purchases).toBeTruthy();
    expect(en.purchases.title).toBeTruthy();
    expect(en.purchases.syncNow).toBeTruthy();
    expect(en.purchases.accept).toBeTruthy();
    expect(en.purchases.reject).toBeTruthy();
    expect(en.purchases.localPreview).toBeTruthy();
    expect(en.purchases.downloadPdf).toBeTruthy();
    expect(en.purchases.issuer).toBeTruthy();
    expect(en.purchases.receiver).toBeTruthy();
    expect(en.purchases.longId).toBeTruthy();
    expect(ar.nav.purchases).toBeTruthy();
    expect(ar.purchases.kindInvoice).toBeTruthy();
    expect(ar.purchases.localPreview).toBeTruthy();
    expect(ar.purchases.downloadPdf).toBeTruthy();
  });
});
