/**
 * Shared UI number display helpers.
 * Thin wrappers around @einvoice/eta-core display formatters.
 *
 * DISPLAY ONLY — never use for form field values that are submitted to the API/ETA,
 * or anywhere that feeds signed canonical content. Keep raw numeric strings in inputs.
 */

export {
  formatMoneyDisplay,
  formatQuantityDisplay,
} from '@einvoice/eta-core';
