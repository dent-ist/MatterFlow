import { Api, BASE_URL } from './support/api';
import { Seeder } from './support/seed';

/**
 * Runs once before the workers: fails fast with a clear message when the stack is not up, signs the System Admin in (first sign-in
 * provisions and bootstraps the account) and creates one throwaway set of records so the API is warm before tests run in parallel.
 */
export default async function globalSetup(): Promise<void> {
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    try {
      ready = (await fetch(`${BASE_URL}/health/ready`)).ok;
    } catch {
      /* not listening yet */
    }
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) {
    throw new Error(
      `The stack is not ready at ${BASE_URL}. Start it with "npm run e2e" (frontend/e2e/run-local.sh) or set E2E_BASE_URL.`,
    );
  }

  const admin = await Api.as();
  try {
    const me = await admin.get('/api/v1/me');
    if (!me.isSystemAdmin) {
      throw new Error(
        'The e2e admin account is not a System Admin; start the API with Bootstrap__SystemAdmins__0=ke\\kekim.',
      );
    }
    const seed = new Seeder(admin);
    await seed.task(await seed.world());
  } finally {
    await admin.dispose();
  }
}
