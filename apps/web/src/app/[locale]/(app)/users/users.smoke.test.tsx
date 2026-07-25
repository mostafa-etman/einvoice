import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('users & roles pages smoke', () => {
  it('has users and roles copy for both locales', () => {
    expect(en.users.title).toBeTruthy();
    expect(en.roles.title).toBeTruthy();
    expect(ar.users.forbidden).toBeTruthy();
    expect(ar.roles.permissions).toBeTruthy();
  });
});
