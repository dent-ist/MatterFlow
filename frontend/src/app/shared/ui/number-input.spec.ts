import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NumberInput, numberProblem } from './number-input';

describe('numberProblem', () => {
  it('accepts 1 to 5 digits, including leading zeros and surrounding whitespace', () => {
    for (const ok of ['1', '343', '00343', '12345', ' 343 ', '0343']) {
      expect(numberProblem(ok, 'client number')).toBeNull();
    }
  });

  it('uses the copy-deck messages', () => {
    expect(numberProblem('', 'client number')).toBe('Enter a client number.');
    expect(numberProblem('   ', 'matter number')).toBe('Enter a matter number.');
    expect(numberProblem('12a', 'client number')).toBe('Use digits only.');
    expect(numberProblem('-5', 'client number')).toBe('Use digits only.');
    expect(numberProblem('123456', 'client number')).toBe('Use at most 5 digits.');
    expect(numberProblem('0', 'client number')).toBe('A number cannot be all zeros.');
    expect(numberProblem('00000', 'client number')).toBe('A number cannot be all zeros.');
  });
});

describe('mf-number-input', () => {
  let fixture: ComponentFixture<NumberInput>;
  const el = (): HTMLElement => fixture.nativeElement;
  const input = (): HTMLInputElement => el().querySelector('input')!;

  async function type(value: string): Promise<void> {
    input().value = value;
    input().dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function blur(): Promise<void> {
    input().dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    fixture = TestBed.createComponent(NumberInput);
    fixture.componentRef.setInput('label', 'Client number');
    fixture.componentRef.setInput('noun', 'client number');
    fixture.componentRef.setInput('inputId', 'client-number');
    await fixture.whenStable();
  });

  it('previews the zero-padded value while typing', async () => {
    await type('343');

    expect(el().querySelector('[data-preview]')?.textContent).toContain('Will be saved as 00343.');
    expect(input().value).toBe('343');
  });

  it('normalizes the text on blur', async () => {
    await type('343');
    await blur();

    expect(input().value).toBe('00343');
    expect(fixture.componentInstance.value()).toBe('00343');
  });

  it('adds the combined-reference preview supplied by the parent', async () => {
    fixture.componentRef.setInput('extraPreview', 'Combined reference: 00343-00012');
    await type('12');

    expect(el().querySelector('[data-preview]')?.textContent).toContain(
      'Combined reference: 00343-00012',
    );
  });

  it('shows format errors after blur and keeps the text', async () => {
    await type('12a');
    expect(el().querySelector('[role=alert]')).toBeNull(); // not before the field is touched
    await blur();

    expect(el().querySelector('[role=alert]')?.textContent).toContain('Use digits only.');
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(input().value).toBe('12a');
    expect(el().querySelector('[data-preview]')).toBeNull();

    await type('123456');
    await blur();
    expect(el().querySelector('[role=alert]')?.textContent).toContain('Use at most 5 digits.');
  });

  it('shows required errors when the parent says the form was submitted', async () => {
    fixture.componentRef.setInput('showErrors', true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el().querySelector('[role=alert]')?.textContent).toContain('Enter a client number.');
  });

  it('shows a server error until the user edits the text', async () => {
    fixture.componentRef.setInput('serverError', 'Client 00343 already exists.');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().querySelector('[role=alert]')?.textContent).toContain(
      'Client 00343 already exists.',
    );

    await type('344');
    expect(el().querySelector('[role=alert]')).toBeNull();
  });

  it('labels the field as required and links help text', async () => {
    fixture.componentRef.setInput('help', 'Enter 1 to 5 digits.');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el().querySelector('label')?.textContent).toContain('(required)');
    expect(input().getAttribute('aria-describedby')).toContain('client-number-help');
  });
});
