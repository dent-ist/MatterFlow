import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DISPOSITION_CHIPS, StatusChip } from './status-chip';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatusChip],
  template: `
    <mf-status-chip id="a" kind="disposition" code="ACTIVE" />
    <mf-status-chip id="i" kind="disposition" code="INACTIVE" label="Archived" />
    <mf-status-chip id="p" kind="disposition" code="PENDING_DISPOSITION" />
    <mf-status-chip id="d" kind="disposition" code="DISPOSED" />
    <mf-status-chip id="u" kind="disposition" code="SOMETHING_NEW" />
    <mf-status-chip id="t" code="IN_PROGRESS" />
  `,
})
class Host {}

describe('mf-status-chip, disposition kind (TH-06, #988)', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('writes the word and an icon for each of the four dispositions, never colour alone', async () => {
    const el = await setup();
    const chip = (id: string) => el.querySelector<HTMLElement>(`#${id} .chip`)!;
    expect(chip('a').textContent).toContain('Active');
    expect(chip('a').dataset['tone']).toBe('disp-active');
    expect(chip('a').querySelector('i.pi-check-circle')?.getAttribute('aria-hidden')).toBe('true');
    expect(chip('p').textContent).toContain('Pending disposition');
    expect(chip('p').querySelector('i.pi-clock')).not.toBeNull();
    expect(chip('d').textContent).toContain('Disposed');
    expect(chip('d').querySelector('i.pi-trash')).not.toBeNull();
    for (const code of Object.keys(DISPOSITION_CHIPS)) {
      expect(DISPOSITION_CHIPS[code].icon).toMatch(/^pi-/);
      expect(DISPOSITION_CHIPS[code].label.length).toBeGreaterThan(2);
    }
  });

  it('a page may change the words (Archived) and an unknown code keeps a neutral look with its own text', async () => {
    const el = await setup();
    expect(el.querySelector('#i .chip')!.textContent).toContain('Archived');
    expect(el.querySelector('#i .chip')!.getAttribute('data-tone')).toBe('disp-inactive');
    expect(el.querySelector('#u .chip')!.textContent).toContain('SOMETHING_NEW');
    expect(el.querySelector('#u .chip')!.getAttribute('data-tone')).toBe('disp-inactive');
  });

  it('the default kind is still the task status', async () => {
    const el = await setup();
    expect(el.querySelector('#t .chip')!.getAttribute('data-tone')).toBe('progress');
    expect(el.querySelector('#t .chip')!.textContent).toContain('In Progress');
  });
});
