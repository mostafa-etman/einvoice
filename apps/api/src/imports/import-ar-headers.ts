/** Keep in sync with IMPORT_TAX_SLOTS in import-schema.ts */
const TAX_SLOTS = 5;

/** Arabic display titles (without the required-field marker). */
export const IMPORT_AR_HEADERS: Record<string, string> = {
  internalID: 'الرقم الداخلي',
  dateTimeIssued: 'تاريخ الإصدار',
  documentType: 'نوع المستند',
  branchCode: 'كود الفرع',
  currencyCode: 'عملة البيع',
  taxpayerActivityCode: 'كود النشاط',
  serviceDeliveryDate: 'تاريخ تسليم الخدمة',
  purchaseOrderReference: 'رقم أمر الشراء',
  purchaseOrderDescription: 'وصف أمر الشراء',
  salesOrderReference: 'رقم أمر البيع',
  salesOrderDescription: 'وصف أمر البيع',
  proformaInvoiceNumber: 'رقم الفاتورة المبدئية',
  extraDiscountAmount: 'خصم إضافي على المستند',
  references: 'الرقم المرجعي للمستند الأصلي',
  receiverType: 'نوع المستلم',
  receiverId: 'رقم تسجيل المستلم',
  receiverName: 'اسم المستلم',
  receiverCountry: 'دولة المستلم',
  receiverGovernate: 'محافظة المستلم',
  receiverRegionCity: 'مدينة المستلم',
  receiverStreet: 'شارع المستلم',
  receiverBuildingNumber: 'مبنى المستلم',
  receiverPostalCode: 'الرمز البريدي للمستلم',
  receiverFloor: 'دور المستلم',
  receiverRoom: 'غرفة المستلم',
  receiverLandmark: 'علامة مميزة للمستلم',
  receiverAdditionalInformation: 'معلومات عنوان إضافية للمستلم',
  description: 'وصف الصنف',
  itemType: 'نوع كود الصنف',
  itemCode: 'كود الصنف',
  unitType: 'وحدة القياس',
  quantity: 'الكمية',
  unitPrice: 'سعر الوحدة',
  discountAmount: 'قيمة الخصم',
  discountRate: 'نسبة الخصم',
  internalCode: 'الكود الداخلي للصنف',
  amountSold: 'المبلغ بالعملة المباعة',
  currencyExchangeRate: 'سعر التحويل إلى الجنيه',
  weightUnitType: 'وحدة الوزن',
  weightQuantity: 'كمية الوزن',
  paymentBankName: 'اسم البنك',
  paymentBankAddress: 'عنوان البنك',
  paymentBankAccountNo: 'رقم الحساب البنكي',
  paymentBankAccountIBAN: 'رقم الآيبان',
  paymentSwiftCode: 'سويفت',
  paymentTerms: 'شروط الدفع',
  deliveryApproach: 'أسلوب التسليم',
  deliveryPackaging: 'التغليف',
  deliveryDateValidity: 'صلاحية التسليم',
  deliveryExportPort: 'ميناء التصدير',
  deliveryCountryOfOrigin: 'بلد المنشأ',
  deliveryGrossWeight: 'الوزن الإجمالي',
  deliveryNetWeight: 'الوزن الصافي',
  deliveryTerms: 'شروط التسليم',
};

for (let n = 1; n <= TAX_SLOTS; n++) {
  IMPORT_AR_HEADERS[`taxType${n}`] = `نوع الضريبة ${n}`;
  IMPORT_AR_HEADERS[`taxSubType${n}`] = `النوع الفرعي ${n}`;
  IMPORT_AR_HEADERS[`taxRate${n}`] = `نسبة الضريبة ${n}`;
  IMPORT_AR_HEADERS[`taxAmount${n}`] = `قيمة الضريبة ${n}`;
}

export function arabicHeaderForField(key: string, required: boolean): string {
  const ar = IMPORT_AR_HEADERS[key] ?? key;
  return required ? `${ar} (*)` : ar;
}
