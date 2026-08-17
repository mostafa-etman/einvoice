import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('users & roles pages smoke', () => {
  it('has users and roles copy for both locales', () => {
    expect(en.users.title).toBeTruthy();
    expect(en.roles.title).toBeTruthy();
    expect(en.roles.perm['customers.view']).toBeTruthy();
    expect(en.roles.groups.customers).toBeTruthy();
    expect(ar.users.forbidden).toBeTruthy();
    expect(ar.roles.permissions).toBeTruthy();
    expect(ar.roles.perm['customers.manage']).toBeTruthy();
  });
});
