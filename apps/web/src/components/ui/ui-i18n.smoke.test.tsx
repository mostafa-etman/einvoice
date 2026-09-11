import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('P1 i18n keys', () => {
  it('adds primitive state and action keys in both locales', () => {
    expect(en.common.states.loading).toBeTruthy();
    expect(en.common.actions.close).toBeTruthy();
    expect(en.ui.paginationSummary).toContain('{page}');
    expect(ar.common.states.loading).toBeTruthy();
    expect(ar.common.actions.confirm).toBeTruthy();
    expect(ar.ui.filterReset).toBeTruthy();
  });
});
