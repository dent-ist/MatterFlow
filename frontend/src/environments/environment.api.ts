import type { AppEnvironment } from './environment.model';

/** Development against the real API (`npm run start:api`): GET /api/v1/me instead of the stub. */
export const environment: AppEnvironment = {
  production: false,
  authProvider: 'api',
  stubScenario: 'director',
  apiBaseUrl: '/api/v1',
  helpContact: '',
};
