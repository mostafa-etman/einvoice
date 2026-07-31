/** BullMQ queue names for submission + bulk import/export. Jobs always carry tenantId. */
export const QUEUE_SIGN = 'sign' as const;
export const QUEUE_SUBMIT = 'submit' as const;
export const QUEUE_POLL = 'poll' as const;
export const QUEUE_IMPORT = 'import' as const;
export const QUEUE_EXPORT = 'export' as const;
export const QUEUE_PACKAGE_POLL = 'package-poll' as const;

export type PipelineQueueName =
  | typeof QUEUE_SIGN
  | typeof QUEUE_SUBMIT
  | typeof QUEUE_POLL
  | typeof QUEUE_IMPORT
  | typeof QUEUE_EXPORT
  | typeof QUEUE_PACKAGE_POLL;

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
} as const;
