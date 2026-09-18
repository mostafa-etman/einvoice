import en from '@/messages/en.json';
import ar from '@/messages/ar.json';

describe('receipts smoke', () => {
  it('has builder and validation copy in both locales', () => {
    for (const messages of [en, ar]) {
      expect(messages.receipts.title).toBeTruthy();
      expect(messages.receipts.sectionExtra).toBeTruthy();
      expect(messages.receipts.returnReceipt).toBeTruthy();
      expect(messages.receipts.send).toBeTruthy();
      expect(messages.receipts.b2cRequired).toBeTruthy();
      expect(messages.receipts.previewPrint).toBeTruthy();
      expect(messages.receipts.paymentMethod).toBeTruthy();
      expect(messages.receipts.receiptTypeHelp).toBeTruthy();
      expect(messages.receipts.buyerIdHelp).toContain('150');
      expect(messages.receipts.validation.internalCode).toBeTruthy();
      expect(messages.receipts.validation.paymentMethod).toBeTruthy();
      expect(messages.receipts.validation.orderDeliveryMode).toBeTruthy();
      expect(messages.nav.receipts).toBeTruthy();
      expect(messages.settingsCompany.posSerialScope).toBeTruthy();
      expect(messages.settingsCompany.posSerialPerBranchHelp).toBeTruthy();
      expect(messages.settingsPosDevices.serialScopeHint).toBeTruthy();
    }
  });
});
