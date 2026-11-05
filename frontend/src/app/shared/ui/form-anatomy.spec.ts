import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string): string => readFileSync(join(process.cwd(), file), 'utf8');

/** The body of the first rule in `css` that starts with `selector`. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(selector);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('one form layout (D-35, D-30, #1156)', () => {
  const mixins = source('src/styles/_form-mixins.scss');
  const forms = source('src/styles/_forms.scss');
  const field = source('src/app/shared/ui/form-field.scss');

  it('the label is 13 / 600 in the text colour, the help 13 muted, the error 13 danger with an icon row', () => {
    const label = rule(mixins, '@mixin mf-field-label {');
    expect(label).toContain('color: var(--mf-text)');
    expect(label).toContain('font-size: var(--mf-fs-sm)');
    expect(label).toContain('font-weight: var(--mf-fw-semibold)');
    expect(rule(mixins, '@mixin mf-field-help {')).toContain('color: var(--mf-text-muted)');
    const error = rule(mixins, '@mixin mf-field-error {');
    expect(error).toContain('color: var(--mf-danger)');
    expect(error).toContain('font-size: var(--mf-fs-sm)');
    expect(rule(mixins, '@mixin mf-field-req {')).toContain('font-weight: 400');
  });

  it('label, control, help and error are 4 px apart and a field is 480 px wide at most', () => {
    const stack = rule(mixins, '@mixin mf-field-stack {');
    expect(stack).toContain('gap: var(--mf-s1)');
    expect(stack).toContain('max-width: var(--mf-field-max, 480px)');
  });

  it('mf-text-field (form-field.scss), the global classes and .mf-label all read the same mixins', () => {
    expect(field).toContain('@include forms.mf-field-label');
    expect(field).toContain('@include forms.mf-field-error');
    expect(forms).toContain('@include m.mf-field-stack');
    expect(rule(forms, '.mf-label {')).toContain('@include m.mf-field-label');
    expect(rule(forms, '.mf-form-fields {')).toContain('gap: var(--mf-s4)');
  });

  it('two columns only in a Large dialog or on a page 1100 px wide and more', () => {
    expect(rule(forms, '.mf-form-grid {')).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(forms).toMatch(/@media \(min-width: 1100px\) \{\s*\.mf-form-grid--page/);
  });

  it('the page action bar is right aligned with the primary last; Delete or a note starts the row', () => {
    const fixed = source('src/styles/_fixed-page.scss');
    expect(rule(fixed, '.mf-form-actions--sticky {')).toContain('justify-content: flex-end');
    expect(rule(fixed, '.mf-form-actions__start {')).toContain('margin-right: auto');
  });

  it('no form says "(optional)" any more (an optional field carries no mark)', () => {
    for (const file of [
      'src/app/shared/availability/absences/absence-dialog.ts',
      'src/app/shared/availability/set-out-of-office-dialog.ts',
      'src/app/features/admin/holidays/holiday-dialog.ts',
      'src/app/features/admin/holidays/calendar-dialog.ts',
      'src/app/features/my-matters/ui/event-dialog.ts',
      'src/app/features/assets/disposition/asset-disposition-dialog.ts',
      'src/app/features/tasks/detail/task-action-dialogs.ts',
    ]) {
      expect(source(file), file).not.toContain('(optional)');
    }
  });
});
