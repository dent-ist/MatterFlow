import { MfPreset } from './mf-preset';

describe('MfPreset', () => {
  it('sets every dialog and drawer title to 16 px / 600 (S18, #619)', () => {
    const title = (MfPreset as { components?: { dialog?: { title?: Record<string, string> } } })
      .components?.dialog?.title;
    expect(title).toEqual({ fontSize: 'var(--mf-fs-lg)', fontWeight: '600' });
  });

  it('reads the design tokens instead of colour literals (UI-01, #954)', () => {
    const json = JSON.stringify(MfPreset);
    for (const token of [
      '--mf-primary',
      '--mf-focus',
      '--mf-surface',
      '--mf-border-strong',
      '--mf-toast-success-bg',
      '--mf-danger',
    ]) {
      expect(json).toContain(`var(${token})`);
    }
    // Everything outside the scale steps is a token: the focus ring, the toasts, the buttons and the surfaces.
    const semantic = JSON.stringify((MfPreset as { semantic?: unknown }).semantic);
    expect(semantic).not.toContain('#B45309');
    const own = MfPreset as { components?: { toast?: unknown; button?: unknown } };
    expect(JSON.stringify([own.components?.toast, own.components?.button])).not.toMatch(
      /#[0-9A-F]{6}/,
    );
  });
});
