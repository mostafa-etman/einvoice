export type EtaConnectionStatus = {
  connected: boolean;
  setupRequired: boolean;
  expiresAt: string | null;
  scope: string | null;
  /** Human label: sandbox | production | custom */
  environment: string | null;
  /** Tenant enum: SANDBOX | PRODUCTION */
  activeEnvironment?: 'SANDBOX' | 'PRODUCTION';
  lastTestOutcome: 'success' | 'failure' | 'never';
  lastTestMessage: string | null;
  settingsPath: string;
  /**
   * Present only on successful Test Connection when a token was acquired.
   * Controllers may strip this for browser responses; sandbox tests assert it.
   */
  accessToken?: string;
};

export const ETA_SETTINGS_PATH = '/settings/eta-credentials';
export const ETA_SETUP_CODE = 'ETA_CREDENTIALS_SETUP_REQUIRED';
