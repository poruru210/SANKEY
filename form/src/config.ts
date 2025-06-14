export interface FormFieldDefinition {
  label: string;
  type: 'text' | 'select';
  required: boolean;
  options?: string[];
  validation?: 'number' | 'email';
}

export interface FormFields {
  EA_NAME: FormFieldDefinition;
  ACCOUNT_NUMBER: FormFieldDefinition;
  BROKER: FormFieldDefinition;
  EMAIL: FormFieldDefinition;
  X_ACCOUNT: FormFieldDefinition;
}

export interface Config {
  WEBHOOK_URL: string;
  TEST_NOTIFICATION_URL: string;
  RESULT_NOTIFICATION_URL: string;
  USER_ID: string;
  JWT_SECRET: string;
  FORM_FIELDS: FormFields;
}

export interface FormData {
  eaName: string;
  accountNumber: string;
  broker: string;
  email: string;
  xAccount: string;
  integrationTestId?: string;
}

export interface WebhookResponse {
  success: boolean;
  response?: any;
  error?: string;
}

export interface NotificationData {
  userId: string;
  applicationId: string;
  licenseId: string;
  licenseValue?: string;
  testId?: string;
}

export interface TestResult {
  success: boolean;
  timestamp: string;
  details: string;
  gasProjectId?: string;
}

export interface LicenseData {
  userId: string;
  applicationId: string;
  licenseId: string;
  licenseValue?: string;
  testId?: string;
  receivedAt: Date;
}
