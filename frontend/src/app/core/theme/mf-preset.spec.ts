import { MfPreset } from './mf-preset';

describe('MfPreset', () => {
  it('sets every dialog and drawer title to 16 px / 600 (S18, #619)', () => {
    const title = (MfPreset as { components?: { dialog?: { title?: Record<string, string> } } })
      .components?.dialog?.title;
    expect(title).toEqual({ fontSize: 'var(--mf-fs-lg)', fontWeight: '600' });
  });
});
