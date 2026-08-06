import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('platform admin page smoke', () => {
  it('has admin console copy in both locales', () => {
    expect(en.admin.title).toBeTruthy();
    expect(en.admin.provision).toBeTruthy();
    expect(en.admin.impersonate).toBeTruthy();
    expect(en.admin.accessDenied).toBeTruthy();
    expect(ar.admin.suspend).toBeTruthy();
    expect(ar.admin.breakGlass).toBeTruthy();
  });
});
