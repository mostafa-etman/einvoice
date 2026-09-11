import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('customers smoke', () => {
  it('has customers nav and module labels', () => {
    expect(en.nav.customers).toBeTruthy();
    expect(en.customers.title).toBeTruthy();
    expect(en.customers.create).toBeTruthy();
    expect(en.customers.edit).toBeTruthy();
    expect(en.customers.deactivate).toBeTruthy();
    expect(en.customers.searchPlaceholder).toBeTruthy();
    expect(en.customers.retryLoad).toBeTruthy();
    expect(en.customers.emptyFiltered).toBeTruthy();
    expect(ar.nav.customers).toBeTruthy();
    expect(ar.customers.createTitle).toBeTruthy();
    expect(ar.customers.editTitle).toBeTruthy();
  });
});
