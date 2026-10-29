import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_VERSION, versionLabel, versionName } from './app-version';

describe('app version (MM-44, #940)', () => {
  it('is the "version" of the root package.json, the one place to bump it', () => {
    const root = JSON.parse(readFileSync(resolve(process.cwd(), '..', 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(APP_VERSION).toBe(root.version);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('shows "v0.1.1" and says "Version 0.1.1"', () => {
    expect(versionLabel('0.1.1')).toBe('v0.1.1');
    expect(versionName('0.1.1')).toBe('Version 0.1.1');
    expect(versionLabel()).toBe(`v${APP_VERSION}`);
  });
});
