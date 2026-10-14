import type { AppEnvironment } from './environment.model';

/** Development defaults: no backend needed (typed stub /me provider). */
export const environment: AppEnvironment = {
  production: false,
  authProvider: 'stub',
  stubScenario: 'director',
  apiBaseUrl: '/api/v1',
  helpContact: '',
};
