export interface AppEnvironment {
  production: boolean;
  /** 'stub' = in-memory /me provider (no backend); 'api' = real GET /api/v1/me. */
  authProvider: 'stub' | 'api';
  /** Scenario the stub starts with (switchable at runtime via the dev-auth banner). */
  stubScenario: string;
  apiBaseUrl: string;
  /** Firm-configured help contact for Access Pending; the line is omitted when empty. */
  helpContact: string;
}
