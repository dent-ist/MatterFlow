import { test as base } from './fixtures';
import { buildUniverse, SensitiveUniverse } from './sensitive-universe';

/**
 * `test` with the sensitive-matter universe (support/sensitive-universe.ts): built once per worker through the admin API. The specs that
 * use it skip themselves when the go-live switch is off (`Features__SensitiveMatterAccess`, see run-local.sh), because without the rule
 * there is nothing to hide.
 */
export const test = base.extend<object, { universe: SensitiveUniverse }>({
  universe: [
    async ({ seed, personas, admin }, use) => {
      await use(await buildUniverse(seed, personas, admin));
    },
    { scope: 'worker', timeout: 180_000 },
  ],
});

export { expect } from './fixtures';

/** Call in `beforeEach`: skips the test when the rule is off, so the ordinary suite (switch off) stays green. */
export function requireRule(
  universe: SensitiveUniverse,
  skip: (condition: boolean, reason: string) => void,
): void {
  skip(
    !universe.ruleOn,
    'The sensitive-matter rule is off: start the API with Features__SensitiveMatterAccess=true (run-local.sh does it for sensitive-*.spec.ts).',
  );
}
