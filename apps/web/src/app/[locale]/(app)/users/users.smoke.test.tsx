import en from '@/messages/en.json';
import ar from '@/messages/ar.json';
import { getPermissionLabels } from '@/i18n/permission-labels';

describe('users & roles pages smoke', () => {
  it('has users and roles copy for both locales', () => {
    expect(en.users.title).toBeTruthy();
    expect(en.roles.title).toBeTruthy();
    expect(getPermissionLabels('en')['customers.view']).toBeTruthy();
    expect(en.roles.groups.customers).toBeTruthy();
    expect(ar.users.forbidden).toBeTruthy();
    expect(ar.roles.permissions).toBeTruthy();
    expect(getPermissionLabels('ar')['customers.manage']).toBeTruthy();
  });
});
