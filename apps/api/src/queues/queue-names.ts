/** BullMQ queue names for submission + bulk import/export. Jobs always carry tenantId. */
export const QUEUE_SIGN = 'sign' as const;
export const QUEUE_SUBMIT = 'submit' as const;
export const QUEUE_POLL = 'poll' as const;
export const QUEUE_IMPORT = 'import' as const;
export const QUEUE_EXPORT = 'export' as const;
export const QUEUE_PACKAGE_POLL = 'package-poll' as const;
export const QUEUE_USAGE_ROLLUP = 'usage-rollup' as const;
export const QUEUE_USAGE_EXPORT = 'usage-export' as const;
export const QUEUE_BACKUP = 'backup' as const;
export const QUEUE_RESTORE = 'restore' as const;
export const QUEUE_TENANT_EXPORT = 'tenant-export' as const;
export const QUEUE_BACKUP_SCHEDULE = 'backup-schedule' as const;
/** SaaS layer (013): transactional email + past-due grace sweep. */
export const QUEUE_EMAIL_SEND = 'email-send' as const;
export const QUEUE_BILLING_PAST_DUE = 'billing-past-due' as const;

export type PipelineQueueName =
  | typeof QUEUE_SIGN
  | typeof QUEUE_SUBMIT
  | typeof QUEUE_POLL
  | typeof QUEUE_IMPORT
  | typeof QUEUE_EXPORT
  | typeof QUEUE_PACKAGE_POLL
  | typeof QUEUE_USAGE_ROLLUP
  | typeof QUEUE_USAGE_EXPORT
  | typeof QUEUE_BACKUP
  | typeof QUEUE_RESTORE
  | typeof QUEUE_TENANT_EXPORT
  | typeof QUEUE_BACKUP_SCHEDULE
  | typeof QUEUE_EMAIL_SEND
  | typeof QUEUE_BILLING_PAST_DUE;

export type TenantScopedJobData = {
  tenantId: string;
};

export type SubmitJobData = TenantScopedJobData & {
  submissionId: string;
};

export type PollJobData = TenantScopedJobData & {
  submissionId: string;
  documentId: string;
  submissionDocumentId: string;
};

export type SignBridgeJobData = TenantScopedJobData & {
  documentId: string;
  documentVersion: number;
};

export type ImportJobData = TenantScopedJobData & {
  importJobId: string;
  phase: 'validate' | 'run';
};

export type ExportJobData = TenantScopedJobData & {
  exportJobId: string;
};

export type PackagePollJobData = TenantScopedJobData & {
  etaPackageRequestId: string;
  exportJobId: string;
};

export type UsageRollupJobData = TenantScopedJobData & {
  fromDate: string;
  toDate: string;
  timeZone?: string;
};

export type UsageExportJobData = TenantScopedJobData & {
  usageExportJobId: string;
};

export type BackupJobData = TenantScopedJobData & {
  backupJobId: string;
};

export type RestoreJobData = TenantScopedJobData & {
  restoreJobId: string;
};

export type TenantExportJobData = TenantScopedJobData & {
  tenantExportJobId: string;
};

export type EmailSendJobData = TenantScopedJobData & {
  emailOutboxId: string;
};

export type BillingPastDueJobData = {
  tick: true;
};

/** Stub processors — full BullMQ wiring lands with US1 worker tasks. */
export const queueStubs = {
  [QUEUE_SIGN]: { name: QUEUE_SIGN, processor: 'SignProcessorStub' },
  [QUEUE_SUBMIT]: { name: QUEUE_SUBMIT, processor: 'SubmitProcessorStub' },
  [QUEUE_POLL]: { name: QUEUE_POLL, processor: 'PollProcessorStub' },
  [QUEUE_IMPORT]: { name: QUEUE_IMPORT, processor: 'ImportProcessorStub' },
  [QUEUE_EXPORT]: { name: QUEUE_EXPORT, processor: 'ExportProcessorStub' },
  [QUEUE_PACKAGE_POLL]: {
    name: QUEUE_PACKAGE_POLL,
    processor: 'PackagePollProcessorStub',
  },
  [QUEUE_USAGE_ROLLUP]: {
    name: QUEUE_USAGE_ROLLUP,
    processor: 'UsageRollupProcessor',
  },
  [QUEUE_USAGE_EXPORT]: {
    name: QUEUE_USAGE_EXPORT,
    processor: 'UsageExportProcessor',
  },
} as const;
