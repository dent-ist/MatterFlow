import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { INTEGRATION_CHIPS, StatusChip } from './status-chip';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatusChip],
  template: `
    <mf-status-chip id="c" kind="integration" code="CONNECTED" />
    <mf-status-chip id="n" kind="integration" code="NOT_SET_UP" />
    <mf-status-chip id="t" kind="integration" code="NOT_TESTED" />
    <mf-status-chip id="f" kind="integration" code="FAILED" />
    <mf-status-chip id="d" kind="integration" code="DISABLED" />
    <mf-status-chip id="s" kind="integration" code="SECRET_SOON" label="Expires in 21 days" />
    <mf-status-chip id="u" kind="integration" code="SOMETHING_NEW" />
  `,
})
class Host {}

describe('mf-status-chip, integration kind (#1395)', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('writes the word and an icon for every status, never colour alone', async () => {
    const el = await setup();
    const chip = (id: string) => el.querySelector<HTMLElement>(`#${id} .chip`)!;
    for (const [id, word, icon] of [
      ['c', 'Connected', 'pi-check-circle'],
      ['n', 'Not Set Up', 'pi-info-circle'],
      ['t', 'Not Tested', 'pi-question-circle'],
      ['f', 'Failed', 'pi-times-circle'],
      ['d', 'Disabled', 'pi-ban'],
    ]) {
      expect(chip(id).textContent, id).toContain(word);
      expect(chip(id).querySelector('i.pi')!.classList.contains(icon), id).toBe(true);
    }
  });

  it('uses the shared tones: healthy for Connected, information for Not Set Up, red for Failed, amber for an expiring secret', async () => {
    const el = await setup();
    const tone = (id: string) =>
      el.querySelector<HTMLElement>(`#${id} .chip`)!.getAttribute('data-tone');
    expect(tone('c')).toBe('disp-active');
    expect(tone('n')).toBe('info');
    expect(tone('f')).toBe('disp-disposed');
    expect(tone('d')).toBe('disp-inactive');
    expect(tone('s')).toBe('disp-pending');
  });

  it('a label replaces the words of the chip; an unknown code is drawn neutral with its own text', async () => {
    const el = await setup();
    expect(el.querySelector('#s .chip')!.textContent).toContain('Expires in 21 days');
    expect(el.querySelector('#u .chip')!.textContent).toContain('SOMETHING_NEW');
    expect(el.querySelector('#u .chip')!.getAttribute('data-tone')).toBe('disp-inactive');
  });

  it('every entry has an icon and a word', () => {
    for (const [code, c] of Object.entries(INTEGRATION_CHIPS)) {
      expect(c.icon, code).toMatch(/^pi-/);
      expect(c.label.length, code).toBeGreaterThan(2);
    }
  });
});
